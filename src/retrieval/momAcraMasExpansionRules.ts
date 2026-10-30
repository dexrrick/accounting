import type {
  AuthorityPresentedIssue,
  AuthorityPresentedSource,
  AuthorityPresentedWorkstream
} from '../utils/authorityEvidencePresentation';
import { groupExactIssueClaimsByDocument } from '../utils/authorityEvidencePresentation';
import { defaultTargetDateResolver, TargetDateResolver } from './targetDateResolver';

export interface MomAcraMasExpansionRuleRequest {
  authority: string;
  topicId: string;
  query: string;
  subject: string;
  sourceText: string;
  officialUrl?: string;
}

export interface MomAcraMasExpansionRuleEvidence {
  authority: 'MOM' | 'ACRA' | 'MAS';
  text: string;
  title: string;
  officialUrl: string;
}

type ExpansionRule = 'MOM_SALARY_DEDUCTIONS' | 'ACRA_SECRETARY_REQUIREMENTS' |
  'MAS_VCFM_ANNUAL_DECLARATION' | 'MAS_VCFM_NIL_MISCONDUCT_RETURN' | 'MAS_VCFM_TOOLKIT_SCOPE';
type ExpansionAuthority = MomAcraMasExpansionRuleEvidence['authority'];

const MOM_DEDUCTIONS_URL = 'https://www.mom.gov.sg/employment-practices/salary/salary-deductions';
const ACRA_SECRETARY_URL = 'https://www.acra.gov.sg/register/business/registering-different-business-structures/local-company/appointing-company-directors-other-key-officers/';
const MAS_VCFM_TOOLKIT_URL = 'https://www.mas.gov.sg/-/media/mas-media-library/regulation/guidance/cmi/compliance-toolkits-for-fund-management-companies/sfa-compliance-toolkit--vcfms29-may-2026-clean.pdf';
const MAS_VCFM_MISCONDUCT_FAQ_URL = 'https://www.mas.gov.sg/-/media/mas/regulations-and-financial-stability/regulations-guidance-and-licensing/financial-advisers/faq/faqs-on-misconduct-reporting-notices-under-the-faa-ia-and-sfa.pdf';
export { MAS_VCFM_TOOLKIT_URL };
const MAX_QUOTE_LENGTH = 5_000;

function visibleText(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/(?:p|li|tr|table|div|section|article|h[1-6]|ul|ol|main|dt|dd|th|td)\s*>/gi, '\n\n')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&rsquo;/gi, '’')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&rdquo;/gi, '”')
    .replace(/&ldquo;/gi, '“')
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_entity, hex: string | undefined, decimal: string | undefined) => {
      const codePoint = Number.parseInt(hex ?? decimal ?? '', hex ? 16 : 10);
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint) : ' ';
    })
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hasNonCurrentHistoricalScope(query: string): boolean {
  const currentYear = TargetDateResolver.CURRENT_SYSTEM_DATE.slice(0, 4);
  const mentionedYears = [...query.matchAll(/\b(?:19|20)\d{2}\b/g)].map(match => match[0]);
  return !mentionedYears.every(year => year === currentYear)
    || /\b(?:historical|historic|previous|prior year|former|old|superseded)\b/i.test(query);
}

function hasPersonalOrHistoricalScope(query: string): boolean {
  return hasNonCurrentHistoricalScope(query)
    || /\b(?:my|our|this|these)\s+(?:company|employer|employee|salary|fund|fund manager|secretary)\b/i.test(query)
    || /\b(?:calculate|compute|estimate|how much|what amount|amount of deduction|eligible (?:person|candidate) for this role)\b/i.test(query);
}

function isCurrentVcfmNilFaqQuestion(query: string): boolean {
  const currentYear = TargetDateResolver.CURRENT_SYSTEM_DATE.slice(0, 4);
  const mentionedYears = [...query.matchAll(/\b(?:19|20)\d{2}\b/g)].map(match => match[0]);
  return mentionedYears.every(year => year === currentYear || year === '2027')
    && !/\b(?:which rules? applied|what applied|historical|historic|previous|prior|former|superseded|before|as at|at that time)\b/i.test(query);
}

function isAcraSecretaryCompanyFactRequest(query: string): boolean {
  const companyFacts = /\b(?:our|this|the)\s+(?:(?:singapore|private|public|local)\s+){0,2}company\b/i.test(query)
    && /\b(?:incorporated|registered|registration)\b/i.test(query)
    && /\b(?:one|sole|single|only)\s+director\b/i.test(query)
    && /\bcompany\s+secretar(?:y|ies)\b/i.test(query);
  const asksKnownSecretaryRequirement = /\b(?:become|act as|same person|appoint\w*|appointment|leave|keep|empty|vacan\w*|within|deadline)\b/i.test(query)
    && /\b(?:six|6)\s+months?\b|\bannual return\b/i.test(query);
  return companyFacts && asksKnownSecretaryRequirement;
}

function isBoundedAcraSecretaryCompanyFactQuestion(query: string): boolean {
  const outOfScopeEntity = /\b(?:foreign compan(?:y|ies)|overseas[- ]incorporated|incorporated overseas|variable capital compan(?:y|ies)|\bvcc\b|sole proprietorship|partnership|limited liability partnership|business trust)\b/i.test(query);
  const referenceDate = TargetDateResolver.CURRENT_SYSTEM_DATE;
  const resolvedDate = defaultTargetDateResolver.resolveTargetDate(query, referenceDate);
  const explicitHistoricalCutoff = /\b(?:before|prior to|earlier than)\s+(?:(?:the|date of)\s+)?(?:\d{1,2}[/-]\d{1,2}[/-]20\d{2}|20\d{2}-\d{2}-\d{2}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+20\d{2})\b/i.test(query);
  const relativeHistoricalPeriod = /\b(?:last|previous|prior|past)\s+(?:\d+\s+)?(?:days?|weeks?|months?|quarters?|years?|financial years?|reporting periods?)\b|\b(?:yesterday|the day before|earlier this (?:week|month|quarter|year))\b/i.test(query);
  return isAcraSecretaryCompanyFactRequest(query) && !outOfScopeEntity
    && !hasNonCurrentHistoricalScope(query)
    && !(resolvedDate.source === 'EXPLICIT' && resolvedDate.targetDate !== referenceDate)
    && !explicitHistoricalCutoff && !relativeHistoricalPeriod;
}

function recognizeRule(input: Pick<MomAcraMasExpansionRuleRequest,
  'authority' | 'topicId' | 'query' | 'subject'>): ExpansionRule | undefined {
  const text = `${input.query}\n${input.subject}`;
  if (input.authority === 'MOM' && input.topicId === 'mom-salary-payment'
    && /\bsalary\s+deductions?\b|\bdeduct(?:ion|ions|ing)?\b[^.!?]{0,70}\bsalary\b/i.test(input.query)
    && /\b(?:deduction|deductions|deduct|permitted|allowed|allowable|rules?)\b/i.test(input.query)
    && /\b(?:salary|wage)\b/i.test(input.subject)
    && /\b(?:deduction|deductions|deduct)\b/i.test(input.subject)) {
    return 'MOM_SALARY_DEDUCTIONS';
  }

  if (input.authority === 'ACRA' && input.topicId === 'acra_company-secretary'
    && /\b(?:company\s+secretar(?:y|ies)|secretary)\b/i.test(input.query)
    && (/\b(?:eligible|eligibility|qualif\w*|who can|who may|requirements?|residen(?:t|cy|ce)|vacan(?:cy|t)|appoint(?:ment|ed)?|deadline|fine|duties|responsibilities)\b/i.test(input.query)
      || isAcraSecretaryCompanyFactRequest(input.query))
    && /\b(?:company\s+secretar(?:y|ies)|secretary)\b/i.test(input.subject)) {
    return 'ACRA_SECRETARY_REQUIREMENTS';
  }

  if (input.authority === 'MAS' && ['mas-regulatory-reporting', 'mas-vcfm'].includes(input.topicId)
    && /\b(?:vcfm|venture capital fund manager)\b/i.test(text)) {
    const annualQuestion = /\b(?:annual declarations?|form\s*25\s*a|annual returns?)\b/i.test(input.query);
    const nilQuestion = /\b(?:nil[- ]return|no misconduct|nil[- ]misconduct|declaration of nil return|misconduct return)\b/i.test(input.query);
    const scopeQuestion = /\b(?:toolkit|checklist|scope|fund[- ]level|outside the sfa|all fund returns?|all obligations?|(?:all|every) (?:reporting )?obligations?)\b/i.test(input.query)
      && /\b(?:toolkit scope|checklist|scope|fund[- ]level|all fund returns?|funds? (?:we|it|the manager) manage|outside the sfa|all obligations?)\b/i.test(input.subject);
    if (scopeQuestion) return 'MAS_VCFM_TOOLKIT_SCOPE';
    const subjectAsksAnnual = /\b(?:annual declaration|form\s*25\s*a|annual return)\b/i.test(input.subject);
    const subjectAsksNil = /\b(?:nil return|misconduct)\b/i.test(input.subject);
    if (annualQuestion && subjectAsksAnnual) return 'MAS_VCFM_ANNUAL_DECLARATION';
    if (nilQuestion && subjectAsksNil) return 'MAS_VCFM_NIL_MISCONDUCT_RETURN';
    if (annualQuestion && !nilQuestion) return 'MAS_VCFM_ANNUAL_DECLARATION';
    if (nilQuestion && !annualQuestion) return 'MAS_VCFM_NIL_MISCONDUCT_RETURN';
  }
  return undefined;
}

function isCurrentGeneralQuestion(query: string): boolean {
  const referenceDate = TargetDateResolver.CURRENT_SYSTEM_DATE;
  const resolvedDate = defaultTargetDateResolver.resolveTargetDate(query, referenceDate);
  const explicitHistoricalCutoff = /\b(?:before|prior to|earlier than)\s+(?:(?:the|date of)\s+)?(?:\d{1,2}[/-]\d{1,2}[/-]20\d{2}|20\d{2}-\d{2}-\d{2}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+20\d{2})\b/i.test(query);
  const relativeHistoricalPeriod = /\b(?:last|previous|prior|past)\s+(?:\d+\s+)?(?:days?|weeks?|months?|quarters?|years?|financial years?|reporting periods?)\b|\b(?:yesterday|the day before|earlier this (?:week|month|quarter|year))\b/i.test(query);
  return !hasPersonalOrHistoricalScope(query)
    && !(resolvedDate.source === 'EXPLICIT' && resolvedDate.targetDate !== referenceDate)
    && !explicitHistoricalCutoff
    && !relativeHistoricalPeriod;
}

function boundedSection(text: string, startMarker: string, endMarker: string, useLastStart = false): string {
  const start = useLastStart ? text.lastIndexOf(startMarker) : text.indexOf(startMarker);
  if (start < 0) return '';
  const end = text.indexOf(endMarker, start + startMarker.length);
  return text.slice(start, end < 0 ? undefined : end);
}

function momDeductionSections(text: string): { damage: string; amenities: string; advances: string; migrant: string } {
  return {
    damage: boundedSection(text, 'damage or loss of money or goods', 'for supplying accommodation that you have accepted'),
    amenities: boundedSection(text, 'for supplying amenities and services', 'for recovering advances, loans'),
    advances: boundedSection(text, 'for recovering advances, loans, overpaid salary or unearned employment benefits', 'for cpf contributions'),
    migrant: boundedSection(text,
      'your employer can only reduce your salaries, or increase or make new deductions to your salaries, if:',
      'what\'s next', true)
  };
}

function normalizedSource(source: string): string {
  return visibleText(source).toLowerCase().replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
}

function masReportingRow(source: string, rule: 'MAS_VCFM_ANNUAL_DECLARATION' | 'MAS_VCFM_NIL_MISCONDUCT_RETURN'): string {
  if (rule === 'MAS_VCFM_ANNUAL_DECLARATION') {
    return span(source, /\b16\s+to submit an annual declaration on changes\b/i,
      /\b17\s+to report to mas\b/i) || '';
  }
  return span(source, /\b18\s+to submit an annual declaration\b/i,
    /\b19\s+to submit to mas\b/i) || '';
}

function masVcfmScopePassage(sourceText: string): string | undefined {
  return span(sourceText, /This\s+Compliance\s+Toolkit\s+aims\s+to\s+provide\s+guidance\s+on:/i,
    /VCFMs\s+are\s+welcomed\s+to\s+provide\s+suggestions\s+on\s+this\s+toolkit\s+using\s+the\s+Guided\s+Form\s+at\s+Contact\s+Us\./i);
}

function masVcfmNilFaqPassage(sourceText: string): string | undefined {
  return span(sourceText,
    /\b13\s+Are\s+FIs\s+required\s+to\s+submit\s+to\s+MAS\s+a\s+declaration\s+of\s+nil\s+return\s+of\s+misconduct\s+of\s+representatives\s+or\s+broking\s+staff\s+for\s+the\s+calendar\s+year\s+ended\s+31\s+December\s+2026\?/i,
    /Under\s+the\s+Misconduct\s+Reporting\s+Notices,\s+which\s+take\s+effect\s+on\s+1\s+January\s+2027,\s+FIs\s+are\s+not\s+required\s+to\s+submit\s+to\s+MAS\s+a\s+declaration\s+of\s+nil\s+return\s+of\s+misconduct\s+of\s+representatives\s+or\s+broking\s+staff\./i);
}

function hasConflict(source: string, rule: ExpansionRule): boolean {
  const text = visibleText(source).toLowerCase();
  if (/\b(?:it is false that|it is not true that|it is incorrect that|it is not the case that|does not state that)\b/i.test(text)) {
    return true;
  }
  if (rule === 'MOM_SALARY_DEDUCTIONS') {
    const { damage, amenities, advances, migrant } = momDeductionSections(text);
    const hasWrongDamageLimit = [...damage.matchAll(/(\d+)\s*%/g)].some(match => match[1] !== '25');
    const hasWrongAmenitiesLimit = [...amenities.matchAll(/(\d+)\s*%/g)].some(match => match[1] !== '25');
    const hasWrongAdvanceLimit = [...advances.matchAll(/(\d+)\s*%/g)].some(match => match[1] !== '25');
    return hasWrongDamageLimit || hasWrongAmenitiesLimit || hasWrongAdvanceLimit
      || /\b(?:employer|employers)\b[^.!?]{0,100}\b(?:(?:is|are)\s+(?:allowed|permitted)\s+to|(?:may|can))\s+(?:deduct|recover)\b[^.!?]{0,100}\blevy\b/i.test(migrant)
      || /\bdeduct(?:ion|ions)?\b[^.!?]{0,80}\b(?:liquidated damages|employment levy|levy costs)\b[^.!?]{0,70}\b(?:allowed|permitted|may|can)\b/i.test(text);
  }
  if (rule === 'ACRA_SECRETARY_REQUIREMENTS') {
    return /\bsecretary\b[^.!?]{0,100}\b(?:does not have to be|need not be|may be)\b[^.!?]{0,50}\b(?:real person|individual|resident|sole director)\b/i.test(text)
      || /\bsecretary\b[^.!?]{0,100}\b(?:can|may) be the same person as\b[^.!?]{0,40}\bsole director\b/i.test(text)
      || /\b(?:can|may) be the same person as the sole director\b/i.test(text)
      || /\bposition\b[^.!?]{0,80}\bmay be empty for more than\b[^.!?]{0,30}\b6 months\b/i.test(text)
      || /\bsecretary\b[^.!?]{0,80}\b(?:must|may) be appointed\b[^.!?]{0,40}\bwithin (?:one|1|three|3|twelve|12) months\b/i.test(text);
  }
  if (rule === 'MAS_VCFM_ANNUAL_DECLARATION') {
    const row = normalizedSource(masReportingRow(source, rule));
    const deadline = row.match(/\bwithin\s+(\d+|one|two|three|four|five|six)\s+months?\s+after\b/i)?.[1]?.toLowerCase();
    return Boolean(deadline && deadline !== '1' && deadline !== 'one');
  }
  if (rule === 'MAS_VCFM_NIL_MISCONDUCT_RETURN') {
    const faq = normalizedSource(masVcfmNilFaqPassage(source) || '');
    if (faq) {
      return /\byes\b[\s\S]{0,220}\b(?:mas requires|fis are required to submit)[\s\S]{0,220}\bnil return\b[\s\S]{0,160}\bcalendar year ending 31 december 2026\b/i.test(faq)
        || /under the misconduct reporting notices[\s\S]{0,180}\bfis are required to submit[\s\S]{0,120}\bnil return\b/i.test(faq);
    }
    return false;
  }
  if (rule === 'MAS_VCFM_TOOLKIT_SCOPE') {
    return /(?:this )?toolkit (?:is|remains) exhaustive/i.test(text)
      || /toolkit[^.!?]{0,100}(?:covers|includes) all fund[- ]level requirements/i.test(text);
  }
  return false;
}

function momDeductionFacts(source: string): boolean {
  const text = visibleText(source).toLowerCase();
  const { damage, amenities, advances, migrant } = momDeductionSections(text);
  return /covered by the employment act/.test(text)
    && /employer can deduct your salary only for specific reasons/.test(text)
    && /absence from work/.test(text)
    && /damage or loss/.test(damage)
    && /hold an inquiry to determine if you are directly at fault/.test(damage)
    && /not make any deductions until you have had (?:the )?opportunity to explain/.test(damage)
    && /25%/.test(damage)
    && /one.time lump sum/.test(damage)
    && /accommodation that you have accepted/.test(text)
    && /amenities and services/.test(amenities)
    && /commissioner for labour has authorised and you have accepted/.test(amenities)
    && /commissioner for labour/.test(amenities)
    && /must get approval from the commissioner for labour/.test(amenities)
    && /must not exceed the value/.test(amenities)
    && /25%/.test(amenities)
    && /advances, loans, overpaid salary or unearned employment benefits/.test(advances)
    && /not more than 12 months/.test(advances)
    && /25%/.test(advances)
    && /correct month.s salary/.test(text)
    && /registered co.operative society/.test(text)
    && /written consent/.test(text)
    && /benefit the employee/.test(text)
    && /withdraw your written consent at any time/.test(text)
    && /liquidated damages/.test(text)
    && /cannot deduct more than 50%/.test(text)
    && /does not include deductions/.test(text)
    && /this does not include deductions made for:[\s\S]{0,300}absence from work[\s\S]{0,300}recovery of advances, loans, overpaid salary or unearned employment benefits[\s\S]{0,300}registered co-operative societies/.test(text)
    && /final salary payment/.test(text)
    && /work permit holders/.test(migrant)
    && /ep or s pass holders/.test(migrant)
    && /written consent[\s\S]{0,220}inform mom/.test(migrant)
    && /wp online/.test(migrant)
    && /one month before the salary is reduced/.test(text)
    && /costs related to your employment/.test(migrant)
    && /medical insurance/.test(migrant)
    && /levy payment/.test(migrant)
    && /your employer is not allowed to deduct your salary to recover levy costs/.test(text)
    && /not allowed to make deductions[\s\S]{0,500}costs related to your employment[\s\S]{0,300}levy payment/.test(migrant);
}

function acraSecretaryFacts(source: string): boolean {
  const text = visibleText(source).toLowerCase();
  return /every company must have at least one company director and one company secretary/.test(text)
    && /secretary must be appointed within six months of successful registration/.test(text)
    && /position cannot be empty for more than six months/.test(text)
    && /fine of up to \$?1,000/.test(text)
    && /company secretary must:[\s\S]{0,100}be a real person \(not a company\)/.test(text)
    && /singapore citizen, singapore permanent resident, or someone who meets local residency rules/.test(text)
    && /not be the same person as the sole director/.test(text)
    && /maintaining their local company.s information and registers/.test(text)
    && /organising meetings and taking notes/.test(text)
    && /reminding directors about annual filing deadlines/.test(text)
    && /updating everyone on (?:any )?new rules/.test(text);
}

function masVcfmAnnualDeclarationFacts(source: string): boolean {
  const text = normalizedSource(masReportingRow(source, 'MAS_VCFM_ANNUAL_DECLARATION'));
  return /\b16 to submit an annual declaration on changes\b/.test(text)
    && /key appointments/.test(text)
    && /assets under/.test(text)
    && /management/.test(text)
    && /investor types/.test(text)
    && /numbers/.test(text)
    && /fund types/.test(text)
    && /deals/.test(text)
    && /form 25a/.test(text)
    && /within 1 month after/.test(text)
    && /financial year end/.test(text)
    && /regulation 14\(6\)/.test(text)
    && /\blcbr\b/.test(text);
}

function masVcfmNilMisconductFacts(source: string): boolean {
  const text = normalizedSource(masVcfmNilFaqPassage(source) || '');
  return /\b13 are fis required to submit to mas a declaration of nil return of misconduct of representatives or broking staff for the calendar year ended 31 december 2026\?/.test(text)
    && /no\. mas does not require fis to submit a declaration of nil return of misconduct of representatives or broking staff for the calendar year ending 31 december 2026/.test(text)
    && /notwithstanding the requirement under paragraph 6 of the following notices/.test(text)
    && /sfa 04.n11 notice on reporting of misconduct of representatives by holders of capital markets services licence and exempt financial institutions/.test(text)
    && /under the misconduct reporting notices, which take effect on 1 january 2027, fis are not required to submit to mas a declaration of nil return of misconduct of representatives or broking staff/.test(text);
}

function proves(rule: ExpansionRule, source: string): boolean {
  if (hasConflict(source, rule)) return false;
  switch (rule) {
    case 'MOM_SALARY_DEDUCTIONS': return momDeductionFacts(source);
    case 'ACRA_SECRETARY_REQUIREMENTS': return acraSecretaryFacts(source);
    case 'MAS_VCFM_ANNUAL_DECLARATION': return masVcfmAnnualDeclarationFacts(source);
    case 'MAS_VCFM_NIL_MISCONDUCT_RETURN': return masVcfmNilMisconductFacts(source);
    case 'MAS_VCFM_TOOLKIT_SCOPE': {
      const scope = normalizedSource(masVcfmScopePassage(source) || '');
      return /compliance toolkit aims to provide guidance on/.test(scope)
        && /common applications, forms and submissions pursuant to the sfa/.test(scope)
        && /applicable to vcfms/.test(scope)
        && /it is not exhaustive/.test(scope)
        && /excludes reporting obligations that fall outside the sfa/.test(scope)
        && /fund[- ]level requirements/.test(scope)
        && /relevant to: vcfms/.test(normalizedSource(source));
    }
  }
}

function span(sourceText: string, start: RegExp, end: RegExp): string | undefined {
  const source = visibleText(sourceText);
  const first = start.exec(source);
  if (!first || first.index < 0) return undefined;
  const afterStart = source.slice(first.index + first[0].length);
  const last = end.exec(afterStart);
  if (!last || last.index < 0) return undefined;
  const selected = source.slice(first.index,
    first.index + first[0].length + last.index + last[0].length).trim();
  return selected.length <= MAX_QUOTE_LENGTH ? selected : undefined;
}

function spanFromLast(sourceText: string, startMarker: string, end: RegExp): string | undefined {
  const source = visibleText(sourceText);
  const start = source.toLowerCase().lastIndexOf(startMarker.toLowerCase());
  if (start < 0) return undefined;
  const afterStart = source.slice(start + startMarker.length);
  const last = end.exec(afterStart);
  const selected = source.slice(start, last && last.index >= 0
    ? start + startMarker.length + last.index + last[0].length : undefined).trim();
  return selected.length <= MAX_QUOTE_LENGTH ? selected : undefined;
}

function selectedQuotes(rule: ExpansionRule, sourceText: string): string[] {
  if (rule === 'MOM_SALARY_DEDUCTIONS') {
    const generalDeductions = span(sourceText, /if you are covered by the employment act/i,
      /your employer can only reduce your salaries, or increase or make new deductions to your salaries, if:/i);
    const migrantDeductions = spanFromLast(sourceText,
      'your employer can only reduce your salaries, or increase or make new deductions to your salaries, if:', /what.s next/i);
    return generalDeductions && migrantDeductions ? [generalDeductions, migrantDeductions] : [];
  }
  if (rule === 'ACRA_SECRETARY_REQUIREMENTS') {
    const quote = span(sourceText, /every company must have at least one company director and one company secretary/i,
      /updating everyone on (?:any )?new rules/i);
    return quote ? [quote] : [];
  }
  if (rule === 'MAS_VCFM_ANNUAL_DECLARATION') {
    const quote = span(sourceText, /\b16\s+to submit an annual declaration on changes\b/i,
      /\b17\s+to report to mas\b/i);
    return quote ? [quote] : [];
  }
  if (rule === 'MAS_VCFM_TOOLKIT_SCOPE') {
    const quote = masVcfmScopePassage(sourceText);
    const population = /Relevant to:\s*(?:\|\s*)?VCFMs/i.exec(visibleText(sourceText))?.[0];
    return quote && population ? [quote, population] : [];
  }
  const quote = masVcfmNilFaqPassage(sourceText);
  return quote ? [quote] : [];
}

/** Full official-source proof. Undefined means unowned; false means incomplete or contradictory. */
export function supportMomAcraMasExpansionRule(input: MomAcraMasExpansionRuleRequest): boolean | undefined {
  const rule = recognizeRule(input);
  if (!rule) return undefined;
  if (!isCurrentGeneralQuestion(input.query) &&
      !(rule === 'ACRA_SECRETARY_REQUIREMENTS' && isBoundedAcraSecretaryCompanyFactQuestion(input.query)) &&
      !(rule === 'MAS_VCFM_NIL_MISCONDUCT_RETURN' && isCurrentVcfmNilFaqQuestion(input.query))) return false;
  if (input.officialUrl && input.officialUrl !== sourceUrl(rule)) return false;
  return proves(rule, input.sourceText);
}

/** Explicitly reversed source wording is distinct from an incomplete source excerpt. */
export function hasMomAcraMasExpansionContradiction(input: MomAcraMasExpansionRuleRequest): boolean {
  const rule = recognizeRule(input);
  return rule ? hasConflict(input.sourceText, rule) : false;
}

/** Returns exact bounded source passages only after the entire source proves all required conditions. */
export function selectMomAcraMasExpansionQuotes(input: MomAcraMasExpansionRuleRequest): string[] {
  const rule = recognizeRule(input);
  if (!rule || supportMomAcraMasExpansionRule(input) !== true) return [];
  return selectedQuotes(rule, input.sourceText);
}

function sourceUrl(rule: ExpansionRule): string {
  if (rule === 'MOM_SALARY_DEDUCTIONS') return MOM_DEDUCTIONS_URL;
  if (rule === 'ACRA_SECRETARY_REQUIREMENTS') return ACRA_SECRETARY_URL;
  if (rule === 'MAS_VCFM_NIL_MISCONDUCT_RETURN') return MAS_VCFM_MISCONDUCT_FAQ_URL;
  return MAS_VCFM_TOOLKIT_URL;
}

/** A VCFM-specific issue cannot borrow a different licence class's source. */
export function expectedMasVcfmExpansionSource(input: MomAcraMasExpansionRuleRequest): string | undefined {
  const rule = recognizeRule(input);
  return rule?.startsWith('MAS_VCFM_') ? sourceUrl(rule) : undefined;
}

function answerText(rule: ExpansionRule): string {
  if (rule === 'MOM_SALARY_DEDUCTIONS') {
    return 'For an employee covered by the Employment Act, salary deductions are limited to authorised reasons. They include absence; damage or loss after an inquiry establishes the employee’s direct fault and gives the employee an opportunity to explain, capped at 25% of one month’s salary in a lump sum; accepted accommodation or approved amenities and services, where total deductions cannot exceed their value or 25% of salary for the period; advance instalments spread over no more than 12 months and advance or loan instalments capped at 25% of salary for the period; full recovery of overpaid salary or unearned benefits; the employee’s CPF share from the correct month; cooperative payments with written consent; and other employee-benefiting deductions with revocable written consent. The 50% cap per salary period excludes deductions for absence, recovery of advances, loans, overpaid salary or unearned benefits, and consented payments to registered co-operatives; authorised deductions on final salary may exceed it. For migrant workers, salary reductions or new deductions require written consent and MOM notification: Work Permit holders use WP Online, while EP and S Pass holders require an EP eService request one month before the reduction. Employers cannot make deductions for employment costs such as medical insurance or levy payments. Whether a particular deduction is allowed depends on its purpose and circumstances.';
  }
  if (rule === 'ACRA_SECRETARY_REQUIREMENTS') {
    return 'ACRA’s guide says every company must have a company secretary, appointed within six months of successful registration, and the position cannot remain vacant for more than six months. The director may face a fine of up to S$1,000 if the vacancy exceeds that period. The guide says the secretary must be a real person who is a Singapore citizen, permanent resident, or otherwise meets the local residency rules; the sole director cannot also be the company secretary. The secretary’s administrative role includes maintaining company information and registers, organising and recording meetings, reminding directors of annual filing deadlines, and updating them on new rules. This overview is not a complete statutory eligibility check: verify the Companies Act requirements for residence, non-debarment and knowledge or experience, plus any additional public-company qualifications, before concluding that a candidate qualifies. See section 171: https://sso.agc.gov.sg/Act/CoA1967?ProvIds=pr171-';
  }
  if (rule === 'MAS_VCFM_ANNUAL_DECLARATION') {
    return 'MAS’s current VCFM compliance toolkit says a venture capital fund manager must submit Form 25A, an annual declaration of changes to key appointments, assets under management, investor types and numbers, fund types, and deals, within one month after its financial year end. The toolkit cites Regulation 14(6) of the Securities and Futures (Licensing and Conduct of Business) Regulations. The due date for a specific manager depends on its financial year end.';
  }
  if (rule === 'MAS_VCFM_NIL_MISCONDUCT_RETURN') {
    return 'MAS FAQ 13 says that financial institutions covered by SFA 04-N11 are not required to submit a nil misconduct declaration for the calendar year ending 31 December 2026, notwithstanding the existing Notice wording. The Misconduct Reporting Notices effective 1 January 2027 also do not require nil declarations. If you mean a different reporting year, identify that calendar year: this FAQ passage does not establish its deadline.';
  }
  return 'MAS describes the VCFM toolkit as a reference for common applications, forms and submissions under the Securities and Futures Act. MAS says it is not exhaustive and expressly excludes reporting obligations outside the SFA and fund-level requirements. Therefore, Form 25A does not establish that every reporting obligation of each managed fund is complete. Identify applicable fund-level requirements separately for each fund and relevant activity; this source does not provide a complete fund-level checklist.';
}

function expectedSource(rule: ExpansionRule, source: AuthorityPresentedSource): boolean {
  return source.provenance === 'LIVE_EXTERNAL' && !source.validTo && source.officialUrl === sourceUrl(rule);
}

function ruleAuthority(rule: ExpansionRule): ExpansionAuthority {
  if (rule === 'MOM_SALARY_DEDUCTIONS') return 'MOM';
  if (rule === 'ACRA_SECRETARY_REQUIREMENTS') return 'ACRA';
  return 'MAS';
}

function issueSubjectMatches(rule: ExpansionRule, subject: string): boolean {
  if (rule === 'MOM_SALARY_DEDUCTIONS') return /\b(?:salary|wage)\b/i.test(subject)
    && /\b(?:deduction|deductions|deduct)\b/i.test(subject);
  if (rule === 'ACRA_SECRETARY_REQUIREMENTS') return /\b(?:company )?secretar(?:y|ies)\b/i.test(subject);
  if (rule === 'MAS_VCFM_ANNUAL_DECLARATION') return /\b(?:vcfm|venture capital fund manager)\b/i.test(subject)
    && /\b(?:annual declarations?|form 25a|annual returns?)\b/i.test(subject);
  if (rule === 'MAS_VCFM_NIL_MISCONDUCT_RETURN') return /\b(?:vcfm|venture capital fund manager)\b/i.test(subject)
    && /\b(?:nil return|misconduct)\b/i.test(subject);
  return /\b(?:vcfm|venture capital fund manager)\b/i.test(subject)
    && /\b(?:toolkit scope|fund.level requirements)\b/i.test(subject);
}

/** Renders only from current, exact-URL, issue-bound official claims in one fetched document revision. */
export function getMomAcraMasExpansionEvidence(
  query: string,
  stream: AuthorityPresentedWorkstream,
  issue: AuthorityPresentedIssue
): MomAcraMasExpansionRuleEvidence | undefined {
  const rule = recognizeRule({ authority: stream.authority, topicId: inferTopicId(stream.authority),
    query, subject: issue.subject });
  if (!rule || (!isCurrentGeneralQuestion(query) &&
      !(rule === 'ACRA_SECRETARY_REQUIREMENTS' && isBoundedAcraSecretaryCompanyFactQuestion(query)) &&
      !(rule === 'MAS_VCFM_NIL_MISCONDUCT_RETURN' && isCurrentVcfmNilFaqQuestion(query)))) return undefined;
  const authority = ruleAuthority(rule);
  const expectedDomain = rule === 'ACRA_SECRETARY_REQUIREMENTS' ? 'ACRA_CORPORATE'
    : rule.startsWith('MAS_VCFM_')
      ? 'MAS_FUNDS' : 'MOM_EMPLOYMENT';
  const expectedPopulations = rule === 'MOM_SALARY_DEDUCTIONS' ? ['Employee', 'Employer'] : ['Company'];
  if (stream.authority !== authority || stream.domain !== expectedDomain
    || !expectedPopulations.includes(issue.population)
    || issue.evidenceStatus !== 'VERIFIED'
    || !['NOT_REQUIRED', 'UNRESOLVED'].includes(issue.applicationStatus)
    || !['EXPLAIN_RULE', 'CHECK_ELIGIBILITY', 'FILING_REQUIREMENT'].includes(issue.operation)
    || !issueSubjectMatches(rule, issue.subject)
    || !stream.issues.some(candidate => candidate.id === issue.id)) return undefined;

  for (const source of stream.sources) {
    if (!expectedSource(rule, source)) continue;
    const boundSourceText = groupExactIssueClaimsByDocument(source, issue.id)
      .map(group => group.map(claim => claim.text).join('\n\n'));
    if (boundSourceText.some(text => proves(rule, text))) {
      return { authority, text: answerText(rule), title: source.title, officialUrl: sourceUrl(rule) };
    }
  }
  return undefined;
}

function inferTopicId(authority: string): string {
  if (authority === 'MOM') return 'mom-salary-payment';
  if (authority === 'ACRA') return 'acra_company-secretary';
  if (authority === 'MAS') return 'mas-regulatory-reporting';
  return '';
}
