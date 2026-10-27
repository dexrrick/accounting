import type {
  AuthorityPresentedIssue,
  AuthorityPresentedSource,
  AuthorityPresentedWorkstream
} from '../utils/authorityEvidencePresentation';
import { groupExactIssueClaimsByDocument } from '../utils/authorityEvidencePresentation';
import { cleanHtmlText } from './sourceAdapters';
import { defaultTargetDateResolver, TargetDateResolver } from './targetDateResolver';

export interface AcraMomPracticalRuleRequest {
  authority: string;
  topicId: string;
  query: string;
  subject: string;
  sourceText: string;
  officialUrl?: string;
}

export interface AcraMomPracticalRuleEvidence {
  authority: 'ACRA' | 'MOM';
  text: string;
  title: string;
  officialUrl: string;
}

export type AcraMomPracticalRuleId = 'ACRA_AGM' | 'ACRA_ANNUAL_RETURN' | 'MOM_PART_IV_OVERTIME';

export interface AcraMomPracticalRuleMetadata {
  id: AcraMomPracticalRuleId;
  authority: 'ACRA' | 'MOM';
  officialUrl: string;
  population: string;
  rule: string;
  conditions: string[];
  exceptions: string[];
  requiredFacts: string[];
  effectiveDateEvidence: string;
  limitations: string[];
}

export const ACRA_AGM_DUE_DATES_URL = 'https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/holding-annual-general-meetings/due-dates-requirements/';
export const ACRA_ANNUAL_RETURN_DUE_DATES_URL = 'https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/filing-annual-returns-companies/deadline-requirements/';
export const MOM_OVERTIME_URL = 'https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days';

export const ACRA_MOM_PRACTICAL_RULES_20261027: readonly AcraMomPracticalRuleMetadata[] = Object.freeze([
  {
    id: 'ACRA_AGM', authority: 'ACRA', officialUrl: ACRA_AGM_DUE_DATES_URL, population: 'Singapore companies; AGM exemptions/dispensation apply only to specified private companies',
    rule: 'For financial years ending on or after 31 August 2018, listed companies generally hold an AGM within four months after FYE and non-listed companies within six months after FYE.',
    conditions: ['Determine FYE and listed/non-listed status.', 'For private-company exemption where accounts are sent, send financial statements to all members within five months after FYE.', 'For the dormant-company exemption, the company must be dormant, not listed and not a subsidiary of a listed company; assets must not exceed S$500,000 (consolidated value if an ultimate parent).', 'AGM details must still be declared in the annual return whether the company held, was exempt from or dispensed with an AGM.'],
    exceptions: ['Private company may dispense with an AGM by resolution passed by all members and may handle AGM matters by written resolutions.', 'Even an exempt or dispensed-with AGM can be requested by a member up to 14 days before the six-month deadline; an AGM must then be held within six months of FYE.', 'A member or auditor may request a meeting within 14 days of receiving financial statements; the company must hold a general meeting within 14 days after that request.', 'The page says an extension application must be made before the AGM due date; the linked process page is needed for other extension requirements.'],
    requiredFacts: ['FYE and intended AGM period.', 'Whether listed, private or non-listed.', 'Whether dormant, a subsidiary of a listed company, and total assets (consolidated assets if ultimate parent).', 'Whether financial statements were sent to every member and when.', 'Any unanimous dispensation resolution, timely member/auditor request or extension application and its status.'],
    effectiveDateEvidence: 'ACRA labels the deadline table as applying to financial years ending on or after 31 August 2018; page says last updated 11 February 2026 and site copyright updated 23 October 2026.',
    limitations: ['Does not compute a calendar due date or establish whether a particular company is exempt.', 'This helper does not conclude a company-specific historical AGM application; it states the displayed boundary only as a general rule.', 'Private-company exemption, member safeguards and extension requirements must be assessed separately.']
  },
  {
    id: 'ACRA_ANNUAL_RETURN', authority: 'ACRA', officialUrl: ACRA_ANNUAL_RETURN_DUE_DATES_URL, population: 'Singapore companies while listed as live with ACRA',
    rule: 'A live Singapore company files an annual return with ACRA each year. Deadline is within five months after FYE for a listed company and seven months for a non-listed company; six/eight months applies where the company has share capital and an overseas branch register.',
    conditions: ['Determine FYE and whether the company is listed.', 'For the additional month, establish that the company has share capital and an overseas branch register.', 'Annual-return details include company particulars and, when required, share information and financial statements.'],
    exceptions: ['The cited ACRA page expressly says inactivity/dormancy and an IRAS tax-filing waiver do not remove the annual-return duty while the company remains live.', 'Companies whose status is not live are outside this stated annual filing rule; this source does not explain cessation/strike-off procedure.'],
    requiredFacts: ['Company live status.', 'FYE.', 'Listed/non-listed status.', 'Whether it has share capital and keeps a branch register overseas.', 'Whether financial statements are required for that filing.'],
    effectiveDateEvidence: 'ACRA page says last updated 14 May 2026 and site copyright updated 23 October 2026. The displayed page does not state a complete historical effective-date boundary.',
    limitations: ['Historical filing applicability is unresolved from this page alone; do not project the current table onto a historical filing.', 'Does not calculate a due date or determine the filing type/financial-statement attachment for a specific entity.', 'Not the separate IRAS corporate tax return obligation.']
  },
  {
    id: 'MOM_PART_IV_OVERTIME', authority: 'MOM', officialUrl: MOM_OVERTIME_URL, population: 'Employees covered by Part IV of the Employment Act and their employers',
    rule: 'Part IV overtime pay generally covers non-workmen with monthly basic salary not exceeding S$2,600 and workmen with monthly basic salary not exceeding S$4,500. Covered overtime is paid at no less than 1.5 times hourly basic rate, within 14 days after the salary period; the usual monthly overtime cap is 72 hours.',
    conditions: ['Part IV scope must first be established; it excludes managers and executives.', 'Overtime means work beyond normal hours, excluding breaks.', 'For a monthly-rated employee, hourly basic rate is (12 × monthly basic pay)/(52 × 44); daily- and piece-rated employees use their respective basic-pay/hour bases.', 'The non-workman overtime rate is capped at a monthly salary of S$2,600 or S$13.60 per hour.'],
    exceptions: ['The 72-hour monthly cap may be exceeded only with an MOM exemption; specified types of work are not granted exemption.', 'Rest-day and public-holiday work is generally outside the 72-hour overtime count, except excess hours beyond the usual daily hours, which are included.', 'Specified emergency, essential-service, urgent plant/machinery and unforeseeable-interruption cases modify the 12-hour daily limit; an approved exemption is required for working over 12 hours (up to 14 hours).', 'Part-time employees have a separate overtime calculation and are not fully covered by this rule summary.'],
    requiredFacts: ['Employee job duties and workman/non-workman status.', 'Manager/executive status and other Part IV coverage facts.', 'Monthly basic salary (not gross salary), salary period, normal hours, and overtime hours.', 'Monthly/daily/piece-rate pay basis.', 'Rest-day or public-holiday hours and any approved exemption.'],
    effectiveDateEvidence: 'Current MOM public guidance was opened on 27 October 2026. That page does not display an explicit effective date for thresholds; historical thresholds are not established by this evidence.',
    limitations: ['General coverage and calculation rule only; an individual entitlement or amount remains unresolved until employee classification, basic pay and hours are known.', 'Not a full guide to part-time, public-holiday, rest-day, shift-arrangement or other Employment Act exceptions.', 'Do not apply today’s displayed thresholds to a historical period without contemporaneous authority evidence.']
  }
]);

type Rule = typeof ACRA_MOM_PRACTICAL_RULES_20261027[number];

function visibleText(value: string): string {
  return value.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/(?:p|li|tr|table|div|section|article|h[1-6]|ul|ol|main|dt|dd|th|td)\s*>/gi, '\n')
    .replace(/<br\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;|&apos;/gi, "'").replace(/&times;/gi, '×').replace(/&ndash;/gi, '–')
    .replace(/\u00a0/g, ' ').replace(/[\t\f\v ]+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function extractedSourceText(value: string): string {
  return /<(?:!doctype|html|head|body|main|article|section|div|p|table|tr|td|li|h[1-6])\b/i.test(value)
    ? cleanHtmlText(value)
    : value.trim();
}

function isCurrentGeneralQuestion(query: string, rule: Rule): boolean {
  const currentYear = TargetDateResolver.CURRENT_SYSTEM_DATE.slice(0, 4);
  const years = [...query.matchAll(/\b(?:19|20)\d{2}\b/g)].map(match => match[0]);
  const allowedAgmBoundary = rule.id === 'ACRA_AGM'
    && /\b(?:on or after|from)\s+31\s+august\s+2018\b/i.test(query)
    && /\b(?:deadlines?|due|requirements?|hold|when)\b/i.test(query)
    && !/\b(?:what was|applied in|historical|historic|past|previous|prior|former|superseded|last financial year|fye\s+\d{4}|financial year (?:ended|ending)\s+(?!on or after))\b/i.test(query)
    && years.every(year => year === '2018');
  if (years.some(year => year !== currentYear) && !allowedAgmBoundary) return false;
  if (/\b(?:historical|historic|past|previous|prior|former|superseded|last financial year)\b/i.test(query)) return false;
  if (/\b(?:next|coming|upcoming)\s+(?:year|month|quarter|financial year|fye|reporting period)\b/i.test(query)) return false;
  if (/\b(?:before|after)\s+(?:19|20)\d{2}\b/i.test(query) && !allowedAgmBoundary) return false;
  const resolved = defaultTargetDateResolver.resolveTargetDate(query);
  if (resolved.targetDate && resolved.targetDate !== TargetDateResolver.CURRENT_SYSTEM_DATE && !allowedAgmBoundary) return false;
  const asksForDeadlineDay = /\blast day\s+(?:to|for)\b/i.test(query);
  if (!asksForDeadlineDay && /\b(?:last|previous|prior|past)\s+(?:\d+\s+)?(?:days?|weeks?|months?|quarters?|years?|financial years?|reporting periods?)\b/i.test(query)) return false;
  return true;
}

function hasNonCurrentDateScope(query: string): boolean {
  const currentYear = Number(TargetDateResolver.CURRENT_SYSTEM_DATE.slice(0, 4));
  const years = [...query.matchAll(/\b(?:19|20)\d{2}\b/g)].map(match => Number(match[0]));
  return years.some(year => year !== currentYear)
    || /\b(?:historical|historic|past|previous|prior|former|superseded|last financial year|next|coming|upcoming)\b/i.test(query)
    || /\b(?:before|after)\s+(?:19|20)\d{2}\b/i.test(query);
}

function recognizeRule(input: Pick<AcraMomPracticalRuleRequest, 'authority' | 'topicId' | 'query' | 'subject'>): Rule | undefined {
  const text = `${input.query}\n${input.subject}`;
  if (input.authority === 'ACRA' && input.topicId === 'acra_agm'
      && /\b(?:agm|annual general meeting|annual meetings?|shareholder meeting)\b/i.test(text)
      && /\b(?:agm|annual general meeting|meeting)\b/i.test(input.subject)) {
    return ACRA_MOM_PRACTICAL_RULES_20261027[0];
  }
  // The existing ACRA duty and deadline paths have narrower, source-shape
  // contracts (one complete duty block or one complete deadline table). This
  // additive family owns the extra eligibility questions that need dormant,
  // waiver, or overseas-branch-register conditions; simple duty/deadline
  // questions remain with those established paths.
  const asksAnnualReturnException = /\b(?:dormant|inactive|stopped trading|ceased trading|iras|inland revenue authority|tax[- ]filing waiver|tax waiver)\b/i.test(text)
    || /\bshare capital\b[\s\S]{0,100}\b(?:overseas )?branch register\b|\b(?:overseas )?branch register\b[\s\S]{0,100}\bshare capital\b/i.test(text);
  const isAnnualReturnQuestion = /\b(?:annual[-\s]?returns?|annual filing|acra filing)\b/i.test(text)
    && /\b(?:annual[-\s]?returns?|annual filing|acra filing)\b/i.test(input.subject);
  if (input.authority === 'ACRA' && input.topicId === 'acra_annual-returns'
      && (asksAnnualReturnException || (isAnnualReturnQuestion && hasNonCurrentDateScope(input.query)))
      && isAnnualReturnQuestion
  ) {
    return ACRA_MOM_PRACTICAL_RULES_20261027[1];
  }
  if (input.authority === 'MOM' && ['mom-part-iv-overtime', 'mom_overtime'].includes(input.topicId)
      && /\b(?:overtime|part\s*iv|working hours|hours of work)\b/i.test(text)
      && /\b(?:overtime|part\s*iv|workman|hours? of work|work(?:ing)? beyond|payment rate)\b/i.test(input.query)
      && /\b(?:overtime|part\s*iv|workman|employee)\b/i.test(input.subject)) {
    return ACRA_MOM_PRACTICAL_RULES_20261027[2];
  }
  return undefined;
}

function exactOfficialUrl(actual: string | undefined, expected: string): boolean {
  if (!actual) return true;
  try {
    const url = new URL(actual);
    const wanted = new URL(expected);
    return url.protocol === 'https:' && url.hostname === wanted.hostname && url.pathname === wanted.pathname
      && !url.search && !url.hash && !url.username && !url.password;
  } catch {
    return false;
  }
}

function requiredRuleFacts(rule: Rule, rawSource: string): boolean {
  const text = visibleText(rawSource).toLowerCase();
  return practicalQuotePatterns(rule).every(pattern => pattern.test(text));
}

/** Each selector returns only a continuous slice of the official page's cleaned text. */
function practicalQuotePatterns(rule: Rule): RegExp[] {
  if (rule.id === 'ACRA_AGM') return [
    /agm deadlines: fy ending on or after 31 august 2018[\s\S]{0,350}?listed companies[\s\S]{0,150}?within four months after fye[\s\S]{0,180}?non-listed companies[\s\S]{0,150}?within six months after fye/i,
    /private companies do not need to hold an agm if they meet any of these criteria:[\s\S]{0,160}?send financial statements to all members within five months after the fye\.[\s\S]{0,180}?dormant, not listed \(or not a subsidiary of a listed company\), and has total assets of \$500,000 or less \(consolidated value if it is an ultimate parent\)\./i,
    /private companies can:[\s\S]{0,120}?choose not to hold agms if all members pass a resolution to dispense with the agm\.[\s\S]{0,100}?handle agm matters through written resolutions instead\./i,
    /note: you must declare your agm details when you file an annual return\. this applies whether you held an agm, were exempt or dispensed with holding an agm\./i,
    /even if your company is exempt or has dispensed with agms, members can still request one:[\s\S]{0,1200}?when they can request: up to 14 days before the sixth month deadline\. this deadline is six months after the fye\.[\s\S]{0,180}?what you must do: hold an agm within six months after the fye\.[\s\S]{0,220}?you may apply for an extension of time before this deadline, if needed\.[\s\S]{0,350}?when they can request: within 14 days of receiving financial statements[\s\S]{0,120}?what you must do: hold a general meeting within 14 days of the request\./i
  ];
  if (rule.id === 'ACRA_ANNUAL_RETURN') return [
    /an annual return is an online form you have to file with acra\.[\s\S]{0,550}?share information and financial statements \(if required\)/i,
    /all companies registered in singapore must file an annual return with acra each year\. this applies as long as your company is listed as [“"]live[”"] with us\.[\s\S]{0,300}?you must file an annual return even if your company is:[\s\S]{0,100}?inactive or dormant[\s\S]{0,130}?granted a tax waiver by the inland revenue authority of singapore \(iras\)/i,
    /your deadline for filing the annual return is based on:[\s\S]{0,250}?listed companies[\s\S]{0,130}?within five months after fye[\s\S]{0,150}?listed companies with:[\s\S]{0,150}?a share capital[\s\S]{0,100}?an overseas branch register[\s\S]{0,100}?within six months after fye[\s\S]{0,150}?non-listed companies[\s\S]{0,130}?within seven months after fye[\s\S]{0,150}?non-listed companies with:[\s\S]{0,150}?a share capital[\s\S]{0,100}?an overseas branch register[\s\S]{0,100}?within eight months after fye/i
  ];
  return [
    /the hours of work guidelines apply only to those covered under part 4 of the employment act\.[\s\S]{0,180}?part 4 of the employment act does not cover managers and executives\.[\s\S]{0,180}?if you are not covered under part 4 of the employment act, your terms and conditions of employment will be according to your employment contract\./i,
    /overtime work is all work in excess of the normal hours of work \(excluding breaks\)\.[\s\S]{0,180}?you can claim overtime if you are:[\s\S]{0,140}?a non-workman earning a monthly basic salary of \$2,600 or less\.[\s\S]{0,140}?a workman earning a monthly basic salary of \$4,500 or less\.[\s\S]{0,180}?generally, a workman is someone whose work involves mainly manual labour\.[\s\S]{0,180}?the overtime rate payable for non-workmen is capped at the salary level of \$2,600, or an hourly rate of \$13\.60\./i,
    /for overtime work, your employer must pay you at least 1\.5 times the hourly basic rate of pay\. payment must be made within 14 days after the last day of the salary period\.[\s\S]{0,750}?monthly-rated employee[\s\S]{0,140}?\(12 x monthly basic rate of pay\) \/ \(52 x 44\)[\s\S]{0,180}?daily-rated employee[\s\S]{0,140}?daily pay at the basic rate \/ working hours per day[\s\S]{0,180}?piece-rated employee[\s\S]{0,180}?total weekly pay at the basic rate of pay \/ total number of hours worked in the week/i,
    /as an employee, you are not allowed to work more than 12 hours a day\.[\s\S]{0,600}?working more than 12 hours a day \(overtime exemption\)[\s\S]{0,220}?if an employer requires employees to work more than 12 hours a day \(up to a maximum of 14 hours\), they must apply for an overtime exemption\./i,
    /an employee can only work up to 72 overtime hours in a month\.[\s\S]{0,180}?employers can apply for an exemption if they require employees to work more than the 72 hours of overtime in a month\.[\s\S]{0,160}?these work activities will not be granted exemption\./i,
    /work on rest day or public holidays is not counted in the 72-hour overtime limit, except for work done beyond the usual daily working hours on those days\. such extra hours are included in the 72-hour limit\./i
  ];
}

function hasContradiction(rule: Rule, textValue: string): boolean {
  const text = visibleText(textValue).toLowerCase();
  if (rule.id === 'ACRA_AGM') return /agm deadlines[^.]{0,80}(?:within )?(?:five|5|seven|7) months after fye/.test(text)
    || /(?:all|every) private companies? (?:must|have to) hold an agm in every case/.test(text)
    || /(?:dormant|inactive) companies? (?:are|is) automatically exempt from (?:all )?agms?/.test(text)
    || /(?:a member|an auditor) (?:cannot|may not) request an agm/.test(text)
    || /members cannot request an agm/.test(text)
    || /companies? (?:do not (?:have to )?|don't have to |need not |are not required to )declare (?:their )?agm details when (?:they )?(?:file|filing) an annual return/.test(text);
  if (rule.id === 'ACRA_ANNUAL_RETURN') {
    const contradiction = /annual return[^.]{0,100}\b(?:not required|need not be filed|exempt)\b[^.]{0,80}\b(?:dormant|inactive|iras tax waiver)\b/;
    const dormantExemption = /\b(?:dormant|inactive) companies?[^.]{0,120}\b(?:do not need to|don't need to|do not|don't|need not|are not required to) (?:file|submit) (?:an? )?annual returns?\b/;
    const wrongNonListed = /\bnon-listed companies\s+(?:file|must file|have to file)(?: annual returns?)? within (?:five|5) months after fye/;
    const wrongListed = /\blisted companies\s+(?:file|must file|have to file)(?: annual returns?)? within (?:seven|7) months after fye/;
    return contradiction.test(text) || dormantExemption.test(text) || wrongNonListed.test(text) || wrongListed.test(text);
  }
  const checks = [
    /part\s*(?:4|iv)[^.]{0,100}\b(?:includes|covers) managers and executives/,
    /non-workman earning a monthly basic salary of \$4,500 or less/,
    /(?<!non-)\bworkman earning a monthly basic salary of \$2,600 or less/,
    /overtime[^.]{0,120}\b(?:one|1|two|2) times? (?:the )?hourly basic/,
    /72 overtime hours[^.]{0,80}\b(?:unlimited|no monthly limit)/
  ];
  return checks.some(check => check.test(text));
}

/** Contradiction-only signal for the additive regression/pipeline helper. */
export function hasAcraMomPracticalContradiction(input: AcraMomPracticalRuleRequest): boolean {
  const rule = recognizeRule(input);
  return rule ? hasContradiction(rule, input.sourceText) : false;
}

/** Owns only the enumerated full-rule families; incomplete source cannot assert the complete explanation. */
export function supportAcraMomPracticalRule(input: AcraMomPracticalRuleRequest): boolean | undefined {
  const rule = recognizeRule(input);
  if (!rule) return undefined;
  if (!isCurrentGeneralQuestion(input.query, rule) || !exactOfficialUrl(input.officialUrl, rule.officialUrl)) return false;
  return !hasContradiction(rule, input.sourceText) && requiredRuleFacts(rule, input.sourceText);
}

/** Returns exact excerpts of the page's cleaned text only after the complete rule passes. */
export function selectAcraMomPracticalQuotes(input: AcraMomPracticalRuleRequest): string[] {
  const rule = recognizeRule(input);
  if (!rule || !exactOfficialUrl(input.officialUrl, rule.officialUrl)
      || supportAcraMomPracticalRule(input) !== true) return [];
  const text = extractedSourceText(input.sourceText);
  const patterns = practicalQuotePatterns(rule);
  const slices = patterns.map(pattern => pattern.exec(text)?.[0].trim()).filter((quote): quote is string => Boolean(quote));
  return slices.length === patterns.length ? slices : [];
}

function ruleForPresentedIssue(query: string, authority: string, subject: string): Rule | undefined {
  if (authority === 'ACRA') {
    const agm = recognizeRule({ authority, topicId: 'acra_agm', query, subject });
    if (agm) return agm;
    return recognizeRule({ authority, topicId: 'acra_annual-returns', query, subject });
  }
  if (authority === 'MOM') return recognizeRule({ authority, topicId: 'mom-part-iv-overtime', query, subject });
  return undefined;
}

function issueSubjectMatches(rule: Rule, subject: string): boolean {
  return rule.id === 'ACRA_AGM' ? /\b(?:agm|annual general meeting|annual meeting|meeting)\b/i.test(subject)
    : rule.id === 'ACRA_ANNUAL_RETURN' ? /\b(?:annual[-\s]?returns?|annual filing|acra filing)\b/i.test(subject)
      : /\b(?:overtime|part\s*iv|workman|employee)\b/i.test(subject);
}

function sourceFor(rule: Rule, source: AuthorityPresentedSource, issueId: string): boolean {
  return source.provenance === 'LIVE_EXTERNAL' && !source.validTo && source.officialUrl === rule.officialUrl
    && groupExactIssueClaimsByDocument(source, issueId).some(group => requiredRuleFacts(rule, group.map(claim => claim.text).join('\n\n')));
}

/** General rules may be shown with application unresolved; source claims must be issue-bound and from one fetched revision. */
export function getAcraMomPracticalEvidence(
  query: string,
  stream: AuthorityPresentedWorkstream,
  issue: AuthorityPresentedIssue
): AcraMomPracticalRuleEvidence | undefined {
  const rule = ruleForPresentedIssue(query, stream.authority, issue.subject);
  if (!rule || !isCurrentGeneralQuestion(query, rule)) return undefined;
  const authority = rule.authority;
  const domain = authority === 'ACRA' ? 'ACRA_CORPORATE' : 'MOM_EMPLOYMENT';
  const populations = authority === 'ACRA' ? ['Company'] : ['Employee', 'Employer'];
  if (stream.authority !== authority || stream.domain !== domain || !populations.includes(issue.population)
      || !['NOT_REQUIRED', 'UNRESOLVED'].includes(issue.applicationStatus)
      || issue.evidenceStatus !== 'VERIFIED' || !['EXPLAIN_RULE', 'CHECK_ELIGIBILITY', 'FILING_REQUIREMENT'].includes(issue.operation)
      || !issueSubjectMatches(rule, issue.subject)
      || !stream.issues.some(candidate => candidate.id === issue.id && candidate.evidenceStatus === 'VERIFIED')) return undefined;
  const source = stream.sources.find(candidate => sourceFor(rule, candidate, issue.id));
  if (!source) return undefined;
  return { authority, title: source.title, officialUrl: rule.officialUrl, text: answerText(rule) };
}

function answerText(rule: Rule): string {
  if (rule.id === 'ACRA_AGM') return 'ACRA’s current guidance states that, for financial years ending on or after 31 August 2018, listed companies generally hold an AGM within four months after FYE and non-listed companies within six months. A private company may be exempt if it sends its financial statements to all members within five months after FYE, or if it is dormant, not listed (and not a subsidiary of a listed company), and has assets of S$500,000 or less (consolidated for an ultimate parent). It may also dispense with an AGM by a resolution passed by all members. Even then, a member can request an AGM up to 14 days before the six-month deadline; the company must hold it within six months after FYE. A member or auditor may request a general meeting within 14 days of receiving the financial statements, and the company must hold that meeting within 14 days of the request. The page says an extension application must be made before the due date but does not state its duration or all conditions. AGM details must be declared in the annual return even if no AGM was held. A specific conclusion depends on FYE, listing/private status, dormancy, group status, assets, delivery of statements, resolutions, requests and any extension application.';
  if (rule.id === 'ACRA_ANNUAL_RETURN') return 'ACRA’s current guidance requires each company that remains live with ACRA to file an annual return each year, including an inactive or dormant company and a company granted an IRAS tax-filing waiver. The current deadline is five months after FYE for a listed company or seven months for a non-listed company; the corresponding period is six or eight months if the company has share capital and an overseas branch register. Applying the deadline requires the company’s live status, FYE, listing status and branch-register facts. The cited current guidance does not establish historical applicability.';
  return 'MOM’s current guidance applies Part IV rules only to employees covered by Part IV; managers and executives are excluded, while contractual terms apply outside Part IV. For overtime, the stated groups are non-workmen with monthly basic pay of S$2,600 or less and workmen with monthly basic pay of S$4,500 or less; a workman generally does mainly manual labour. The non-workman overtime rate is capped at S$2,600 salary, or S$13.60 hourly. Overtime is work beyond normal hours excluding breaks and is paid at least 1.5 times the hourly basic rate within 14 days after the salary period. Hourly basic pay is calculated as (12 × monthly basic pay)/(52 × 44) for monthly-rated employees, daily basic pay divided by daily working hours for daily-rated employees, and weekly basic pay divided by weekly hours for piece-rated employees. The usual cap is 72 overtime hours in a month; employers must apply for an exemption to exceed it, and MOM identifies work activities for which an exemption will not be granted. Rest-day/public-holiday work is excluded from the 72-hour count except hours beyond the usual daily hours, which count. A separate rule requires an exemption for work beyond 12 hours in a day (up to 14 hours), subject to the stated circumstances. A specific entitlement or amount depends on job duties, Part IV coverage, workman status, basic salary, normal hours, pay basis, hours worked, and applicable exemptions. The current page does not establish historical thresholds.';
}
