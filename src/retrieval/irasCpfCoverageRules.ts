import type {
  AuthorityPresentedIssue,
  AuthorityPresentedSource,
  AuthorityPresentedWorkstream
} from '../utils/authorityEvidencePresentation';
import { groupExactIssueClaimsByDocument } from '../utils/authorityEvidencePresentation';

export interface CoverageRuleRequest {
  authority: string;
  topicId: string;
  query: string;
  subject: string;
  sourceText: string;
  officialUrl?: string;
}

export interface IrasCpfCoverageEvidence {
  authority: 'IRAS' | 'CPF';
  text: string;
  title: string;
  officialUrl: string;
}

type CoverageRule = 'IRAS_GST_FILING' | 'CPF_DUE_DATE' | 'CPF_RATE_FACTORS';

const IRAS_GST_URL = 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/filing-gst/gst-filing-due-dates-and-requests-for-extension';
const CPF_DUE_DATE_URL = 'https://www.cpf.gov.sg/service/article/when-is-the-due-date-for-cpf-contributions';
const CPF_ENFORCEMENT_URL = 'https://www.cpf.gov.sg/employer/compliance-and-rectifications/enforcement-and-penalties-for-non-compliance';
const CPF_RATE_FACTORS_URL = 'https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay';

function visibleText(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|header|footer|button|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/(?:p|li|tr|table|div|section|article|h[1-6]|ul|ol|main|dt|dd)\s*>/gi, '\n')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

function normalized(value: string): string {
  return visibleText(value).normalize('NFKD').replace(/[^a-z0-9$%]+/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function hasHistoricalScope(query: string): boolean {
  return /\b(?:19|20)\d{2}\b|\b(?:historical|historic|previous|prior|former|old|superseded|before\s+\d{4})\b/i.test(query);
}

function hasPersonalOrCalculationScope(query: string): boolean {
  return /\b(?:my|our|this)\s+(?:business|company|employee|salary|contribution|cpf)|\b(?:calculate|compute|estimate|how much|amount payable|personal rate|eligible|eligibility|qualify|qualification)\b/i.test(query);
}

function isOutOfScope(query: string): boolean {
  return hasHistoricalScope(query) || hasPersonalOrCalculationScope(query);
}

function ruleFor(input: Pick<CoverageRuleRequest, 'authority' | 'topicId' | 'query' | 'subject'>): CoverageRule | undefined {
  const text = `${input.query}\n${input.subject}`;
  if (input.authority === 'IRAS' && input.topicId === 'iras-gst-filing-deadlines' &&
      /\b(?:gst|goods and services tax)\b/i.test(text) &&
      /\b(?:fil(?:e|ing)|return|f5|nil|due|deadline|extension|extend|accounting period|quarter)\b/i.test(input.query)) {
    return 'IRAS_GST_FILING';
  }
  if (input.authority === 'CPF' && input.topicId === 'cpf-contribution-due-dates' &&
      /\bcpf\b/i.test(text) && /\b(?:contribution|contributions)\b/i.test(text) &&
      /\b(?:when|due|deadline|date|pay|payment|remit|remittance)\b/i.test(input.query)) {
    return 'CPF_DUE_DATE';
  }
  if (input.authority === 'CPF' && ['cpf_contribution_rates', 'cpf-pr-contribution-rates'].includes(input.topicId) &&
      /\bcpf\b/i.test(text) && /\b(?:factor|depends|determine|vary|information|different)\b/i.test(input.query) &&
      !/\b(?:what\s+(?:are|is)\s+(?:the\s+)?(?:current\s+)?(?:cpf\s+)?rates?|what\s+(?:rate|percentage)|\d+(?:\.\d+)?\s*%|rate\s+table)\b/i.test(input.query)) {
    return 'CPF_RATE_FACTORS';
  }
  return undefined;
}

function asksGstExtension(query: string): boolean {
  return /\b(?:extension|extend|more time|late filing|filing late)\b/i.test(query);
}

function isFalseFramed(statement: string): boolean {
  return /\b(?:false|incorrect|untrue|not true)\s+that\b/i.test(statement);
}

function gstStatements(text: string): string[] {
  return visibleText(text).toLowerCase().split(/(?<=[.!?])\s+/).filter(Boolean);
}

function provesGstFiling(text: string, query: string): boolean {
  const sourceStatements = gstStatements(text);
  const isRelatedGstStatement = (statement: string) =>
    /\b(?:gst|nil|return|giro|extensions?|working days|supporting documents|late filing penalties|outstanding gst f5)\b/.test(statement);
  const falseFramedGstClaim = sourceStatements.some(statement =>
    isRelatedGstStatement(statement) && isFalseFramed(statement));
  const hasReturnDue = sourceStatements.some(statement =>
    /\b(?:gst return|return and payment)\b.{0,100}\b(?:due|file|pay)\b.{0,100}\b1 month after the end of (?:your|the) accounting period\b/.test(statement));
  const hasGiroDueDate = sourceStatements.some(statement =>
    /\bif you pay via giro\b.{0,140}\b(?:15th|15) day of the month after the payment due date\b/.test(statement));
  const hasGiroWeekendRule = sourceStatements.some(statement =>
    /\bdeduction date falls on a weekend or public holiday\b.{0,100}\bnext working day\b/.test(statement));
  const hasSeparateGiroTimetable = hasGiroDueDate && hasGiroWeekendRule;
  const hasNilDuty = sourceStatements.some(statement =>
    /\b(?:must|have to|should) file a?\s*["“]?nil["”]? return\b.{0,110}\b(?:even if|even when)\b.{0,80}\bno business activity\b/.test(statement)
      || /\bfile a?\s*["“]?nil["”]? return\b.{0,110}\b(?:even if|even when)\b.{0,80}\bno business activity\b/.test(statement));
  const contradictsNilDuty = sourceStatements.some(statement => /\bnil\s+(?:gst\s+)?returns?\b/.test(statement)
    && (isFalseFramed(statement) ||
      /\b(?:not required|not needed|optional|need not|does not have to|do not have to|don't have to|no need to|not necessary)\b/.test(statement)));
  const contradictsReturnDeadline = sourceStatements.some(statement =>
    /\b(?:gst return|return and payment)\b/.test(statement) && /\b(?:due|file|pay)\b/.test(statement) &&
    (isFalseFramed(statement) ||
      /\b(?:not|never|does not|do not|doesn't|don't|cannot|can't)\b.{0,110}\b(?:due|file|pay)\b/.test(statement)));
  const contradictsGiroTimetable = sourceStatements.some(statement =>
    /\b(?:giro|deduction date)\b/.test(statement) && /\b(?:deduct|deduction|15th|next working day)\b/.test(statement) &&
    (isFalseFramed(statement) ||
      /\b(?:no|not|never|does not|do not|doesn't|don't|cannot|can't)\b.{0,100}\b(?:deduct|deduction|15th|next working day)\b/.test(statement)));
  const conflictingDeadline = sourceStatements.some(statement => /\b(?:gst returns?|return and payment)\b/.test(statement)
    && /\b(?:due|file)\b/.test(statement)
    && /\b(?:2|two|3|three|4|four|5|five) months? after the end of/.test(statement));
  if (!hasReturnDue || !hasNilDuty || !hasSeparateGiroTimetable || contradictsNilDuty ||
      contradictsReturnDeadline || contradictsGiroTimetable || conflictingDeadline || falseFramedGstClaim) return false;
  if (!asksGstExtension(query)) return true;
  const hasGeneralRefusal = sourceStatements.some(statement =>
    /\bextensions?\b/.test(statement) &&
    /\b(?:generally not granted|not generally granted|generally will not be granted)\b/.test(statement));
  const generallyGrantedContradiction = sourceStatements.some(statement =>
    /\bextensions?\b/.test(statement) && /\b(?:generally|usually|normally)\s+(?:are\s+)?granted\b/.test(statement));
  const restrictedGrounds = sourceStatements.some(statement =>
    /\bwe may grant an extension only if\b/.test(statement) && /\bacceptable reasons\b/.test(statement));
  const unrestrictedGroundsContradiction = sourceStatements.some(statement =>
    /\bextensions?\b/.test(statement) &&
    /\b(?:regardless of|without regard to|not limited to|no need to meet)\b.{0,100}\b(?:acceptable )?reasons?\b/.test(statement));
  const requestProcedure = sourceStatements.some(statement =>
    /\bsubmit your extension request form\b/.test(statement) &&
    /\bat least 5 working days before the filing due date\b/.test(statement) &&
    /\btogether with all required supporting documents\b/.test(statement));
  const deniedProcedure = sourceStatements.some(statement =>
    /\b(?:extension request|supporting documents|5 working days)\b/.test(statement) &&
    /\b(?:not necessary|not required|need not|no need to|without requiring|without submitting)\b/.test(statement) ||
    /\bno (?:supporting )?documents (?:are )?required\b/.test(statement));
  const penaltyCondition = sourceStatements.some(statement =>
    /\bif your request is not approved before the due date\b/.test(statement) &&
    /\blate filing penalties will apply\b/.test(statement));
  const penaltyDenial = sourceStatements.some(statement =>
    /\blate filing penalties\b/.test(statement) &&
    /\b(?:will not|would not|do not|does not|won't|wouldn't|not)\b.{0,50}\bapply\b/.test(statement));
  const f5Requirement = sourceStatements.some(statement =>
    /\byou will also be required to file the outstanding gst f5 immediately\b/.test(statement));
  const f5RequirementDenial = sourceStatements.some(statement =>
    /\b(?:outstanding gst f5|gst f5)\b/.test(statement) &&
    /\b(?:not required|need not|no need to|will not be required|does not have to|do not have to)\b/.test(statement));
  const automaticApprovalContradiction = sourceStatements.some(statement =>
    /\b(?:extension|extension request|request)\b/.test(statement) &&
    /\b(?:automatically approved|automatically granted|approval is automatic|approved by default|pre-?approved|no approval is required|no approval is needed)\b/.test(statement) &&
    !/\b(?:not|never|isn't|is not)\s+(?:automatically approved|automatically granted|automatic)\b/.test(statement));
  return hasGeneralRefusal && !generallyGrantedContradiction && restrictedGrounds &&
    !unrestrictedGroundsContradiction && requestProcedure && !deniedProcedure &&
    penaltyCondition && !penaltyDenial && f5Requirement && !f5RequirementDenial &&
    !automaticApprovalContradiction;
}

function provesCpfDueDate(text: string): boolean {
  const source = normalized(text);
  const sourceStatements = visibleText(text).toLowerCase().split(/(?<=[.!?])\s+/).filter(Boolean);
  const conflictingLegalDate = sourceStatements.some(statement => /\b(?:cpf )?contributions?\b/.test(statement)
    && /\b(?:legal due|due date)\b/.test(statement)
    && /\b(?:14th|fourteenth)\b/.test(statement));
  const negatedLegalDate = sourceStatements.some(statement => /\bcpf contributions?\b/.test(statement) &&
    /\b(?:due date|last day|calendar month)\b/.test(statement) &&
    (/\b(?:false|incorrect|not true)\s+that\b/.test(statement) ||
      /\b(?:not|never|does not|do not|doesn't|don't|cannot|can't)\b.{0,110}\b(?:due|last day|calendar month)\b/.test(statement)));
  const negatedEnforcementDate = sourceStatements.some(statement =>
    /\b(?:enforcement action|employers?)\b/.test(statement) && /\b(?:14th|fourteenth)\b/.test(statement) &&
    /\b(?:false|incorrect|not true)\s+that\b|\b(?:no|not|never|does not|do not|doesn't|don't|cannot|can't)\b.{0,90}\b(?:enforcement|action|by|14th|fourteenth)\b/.test(statement));
  const negatedWeekendAdjustment = sourceStatements.some(statement => /\b(?:next|following) working day\b/.test(statement) &&
    /\b(?:false|incorrect|not true)\s+that\b|\b(?:not|never|does not|do not|doesn't|don't|cannot|can't)\b.{0,90}\b(?:next|following) working day\b/.test(statement));
  const falseFramedCpfClaim = sourceStatements.some(statement =>
    /\b(?:cpf|contribution|contributions|enforcement|14th|interest|working day)\b/.test(statement) &&
    isFalseFramed(statement));
  const excludedInterest = sourceStatements.some(isDeniedCpfInterestStatement);
  return !conflictingLegalDate
    && !negatedLegalDate
    && !negatedEnforcementDate
    && !negatedWeekendAdjustment
    && !falseFramedCpfClaim
    && !excludedInterest
    && /\bdue date for cpf contributions? is on the last day of the calendar month\b/.test(source)
    && /\b(?:enforcement action|employers?)\b.{0,140}\b(?:by|after) the 14(?:th)? of the following month\b/.test(source)
    && /\b(?:next working day|following working day)\b.{0,100}\b(?:saturday|sunday|public holiday)\b/.test(source)
    && hasPositiveCpfInterestStatement(text);
}

function provesCpfRateFactors(text: string): boolean {
  const source = normalized(text);
  const sourceStatements = visibleText(text).toLowerCase().split(/(?<=[.!?])\s+/).filter(Boolean);
  const factors = /\b(?:contribution )?rates? vary based on\b.{0,180}\b(?:citizenship status|citizenship)\b.{0,110}\bage group\b.{0,110}\b(?:total wages|wages)\b/.test(source);
  const thresholdsAndOwnership = /\bsingapore citizens?\b/.test(source)
    && /\bsingapore permanent residents?\b/.test(source)
    && /\bfirst two years? of (?:spr|permanent resident) status\b/.test(source)
    && /\btotal wages?\b/.test(source)
    && /\bas an employer\b.{0,100}\brequired to pay cpf contributions for (?:your|the) employees\b/.test(source)
    && /\b(?:you and your employee|employer and employee)\b.{0,100}\bcan jointly apply\b.{0,90}\bhigher rate\b/.test(source);
  const negatedFactorClaim = sourceStatements.some(statement =>
    /\b(?:cpf )?contribution rates?\b/.test(statement) && /\b(?:vary|based on|depend|determined)\b/.test(statement) &&
    (/\b(?:false|incorrect|not true)\s+that\b/.test(statement) ||
      /\b(?:not|never|does not|do not|doesn't|don't|cannot|can't)\b.{0,90}\b(?:vary|based on|depend|determine)\b/.test(statement)));
  const negatedPrYearOrJointOption = sourceStatements.some(statement =>
    /\b(?:first two years?|first year|second year|spr status|permanent resident)\b/.test(statement) &&
    /\b(?:rate|rates|jointly apply|higher rate)\b/.test(statement) &&
    /\b(?:false|incorrect|not true)\s+that\b|\b(?:not|never|does not|do not|doesn't|don't|cannot|can't|unable to)\b.{0,100}\b(?:apply|higher rate|rate table|rates)\b/.test(statement));
  return factors && thresholdsAndOwnership && !negatedFactorClaim && !negatedPrYearOrJointOption;
}

/** True only for qualitative rate-factor requests; numeric schedules remain unsupported. */
export function isIrasCpfQualitativeRateFactorRequest(input: CoverageRuleRequest): boolean {
  return ruleFor(input) === 'CPF_RATE_FACTORS' && !isOutOfScope(input.query);
}

function provesRule(rule: CoverageRule, sourceText: string, query: string): boolean {
  if (rule === 'IRAS_GST_FILING') return provesGstFiling(sourceText, query);
  if (rule === 'CPF_DUE_DATE') return provesCpfDueDate(sourceText);
  return provesCpfRateFactors(sourceText);
}

function isExactOfficialUrl(actualValue: string | undefined, expectedValue: string): boolean {
  if (!actualValue) return false;
  try {
    const actual = new URL(actualValue);
    const expected = new URL(expectedValue);
    return actual.protocol === 'https:' && !actual.username && !actual.password && !actual.port &&
      !actual.search && !actual.hash && actual.origin === expected.origin &&
      actual.pathname.replace(/\/$/, '') === expected.pathname.replace(/\/$/, '');
  } catch {
    return false;
  }
}

function isCpfEnforcementUrl(value: string | undefined): boolean {
  return isExactOfficialUrl(value, CPF_ENFORCEMENT_URL);
}

function hasCpfMinimumInterestQualification(text: string): boolean {
  const statements = visibleText(text).toLowerCase().split(/(?<=[.!?])\s+/).filter(Boolean);
  const deniedQualification = statements.some(statement => /\bminimum\b/.test(statement) &&
    (isFalseFramed(statement) ||
      /\bnot\s+(?:be\s+)?subject to (?:a |the )?minimum\b/.test(statement) ||
      /\bno minimum (?:amount|charge)\b/.test(statement) ||
      /\bminimum\b.{0,60}\b(?:does not|do not|doesn't|don't|never|not)\b.{0,40}\b(?:apply|charge|impose|require|payable)\b/.test(statement)));
  if (deniedQualification) return false;
  return statements.some(statement => /\b(?:late payment )?interest\b/.test(statement) &&
    /\b1\.5%? per month\b/.test(statement) &&
    /\bsubject to a minimum amount of \$5\b/.test(statement) &&
    !isFalseFramed(statement) && !isDeniedCpfInterestStatement(statement) &&
    !/\bnot\s+(?:be\s+)?subject to (?:a |the )?minimum\b/.test(statement));
}

function isDeniedCpfInterestStatement(statement: string): boolean {
  return /\b(?:late payment )?interest\b/.test(statement) &&
    (isFalseFramed(statement) ||
      /\b(?:exclude[sd]?|excluding|without|does not include|do not include|not include)\b.{0,110}\b(?:impos|charg|interest)\w*\b/.test(statement) ||
      /\b(?:does not|do not|doesn't|don't|did not|never|will not|will never)\b.{0,100}\b(?:charge|impose|apply|include)\b.{0,80}\binterest\b/.test(statement) ||
      /\bno (?:late payment )?interest\b.{0,80}\b(?:charged|payable|imposed|applied)\b/.test(statement) ||
      /\binterest\b.{0,80}\b(?:not charged|not payable|not imposed|does not apply|do not apply|is not applied)\b/.test(statement));
}

function hasPositiveCpfInterestStatement(text: string): boolean {
  const statements = visibleText(text).toLowerCase().split(/(?<=[.!?])\s+/).filter(Boolean);
  return statements.some(statement => /\b(?:late payment )?interest\b/.test(statement) &&
    /\b1\.5%? per month\b/.test(statement) &&
    /\b(?:first day after|day after) the due date\b/.test(statement) &&
    !isFalseFramed(statement) && !isDeniedCpfInterestStatement(statement));
}

/** Returns a fail-closed proof for rules in this narrow IRAS/CPF scope. */
export function supportIrasCpfCoverageRule(input: CoverageRuleRequest): boolean | undefined {
  const rule = ruleFor(input);
  if (!rule) return undefined;
  if (isOutOfScope(input.query)) return false;
  if (rule === 'IRAS_GST_FILING' && !/\b(?:gst|goods and services tax|filing)\b/i.test(input.subject)) return false;
  if (rule === 'CPF_DUE_DATE' && !/\bcpf\b.{0,70}\b(?:contribution|payment|due)\b/i.test(input.subject)) return false;
  if (rule === 'CPF_RATE_FACTORS' && !/\bcpf\b.{0,70}\b(?:rate|contribution|factor)\b/i.test(input.subject)) return false;
  const completeSourceProof = provesRule(rule, input.sourceText, input.query);
  if (rule === 'CPF_DUE_DATE' && isCpfEnforcementUrl(input.officialUrl)) {
    return completeSourceProof && hasCpfMinimumInterestQualification(input.sourceText);
  }
  return completeSourceProof;
}

function relevantQuoteSpan(rule: CoverageRule, sourceText: string, query: string, officialUrl?: string): string | undefined {
  const text = /<\/?[a-z][^>]*>/i.test(sourceText) ? visibleText(sourceText) : sourceText.trim();
  if (!provesRule(rule, text, query) ||
      rule === 'CPF_DUE_DATE' && isCpfEnforcementUrl(officialUrl) &&
        !hasCpfMinimumInterestQualification(text)) return undefined;
  if (rule === 'CPF_RATE_FACTORS') {
    // Keep the answer evidence in the source's qualitative explanation. The
    // contribution tables elsewhere on this page contain numeric schedules,
    // which this answer path is not permitted to reproduce.
    const start = /cpf contribution rates vary based on/i.exec(text);
    const endPattern = /different rates apply (?:for different wage bands|to different age groups and wage bands)\./ig;
    let end: RegExpExecArray | null;
    let lastEnd: RegExpExecArray | undefined;
    while ((end = endPattern.exec(text))) {
      if (start && end.index > start.index) lastEnd = end;
    }
    if (!start || !lastEnd) return undefined;
    return text.slice(start.index, lastEnd.index + lastEnd[0].length).trim();
  }
  const patterns = rule === 'IRAS_GST_FILING'
    ? asksGstExtension(query)
      ? [
        /you must file a?\s*[“"]?nil[”"]? return even if you had no business activity during the accounting period\./i,
        /your gst return and payment are due 1 month after the end of (?:your|the) accounting period\.(?:[^.!?]*[.!?]){1,3}/i,
        /extensions? are generally not granted\.[^.!?]*/i,
        /we may grant an extension only if[^.!?]*/i,
        /submit your extension request form at least 5 working days before the filing due date[^.!?]*/i,
        /if your request is not approved before the due date[^.!?]*[.!?](?:[^.!?]*[.!?])?/i
      ]
      : [
        /you must file a?\s*[“"]?nil[”"]? return even if you had no business activity during the accounting period\./i,
        /your gst return and payment are due 1 month after the end of (?:your|the) accounting period\.(?:[^.!?]*[.!?]){1,3}/i
      ]
    : rule === 'CPF_DUE_DATE'
      ? [/the due date for cpf contributions is on the last day of the calendar month\)?\.(?:[^.!?]*[.!?]){1,4}/i]
      : [];
  const matches = patterns.map(pattern => pattern.exec(text));
  if (matches.some(match => !match)) return undefined;
  const start = Math.min(...matches.map(match => match!.index));
  const end = Math.max(...matches.map(match => match!.index + match![0].length));
  const quote = text.slice(start, end).trim();
  if (rule === 'CPF_DUE_DATE' && isCpfEnforcementUrl(officialUrl) &&
      !hasCpfMinimumInterestQualification(quote)) return undefined;
  return quote.length <= 3_200 ? quote : undefined;
}

/** Selects one complete exact source span, after the whole official page proves the answer. */
export function selectIrasCpfCoverageQuotes(input: CoverageRuleRequest): string[] {
  const rule = ruleFor(input);
  if (!rule || supportIrasCpfCoverageRule(input) !== true) return [];
  const quote = relevantQuoteSpan(rule, input.sourceText, input.query, input.officialUrl);
  return quote && quote.length <= 3_200 ? [quote] : [];
}

function expectedSource(rule: CoverageRule, source: AuthorityPresentedSource): boolean {
  if (source.provenance !== 'LIVE_EXTERNAL' || source.validTo) return false;
  if (rule === 'IRAS_GST_FILING') return isExactOfficialUrl(source.officialUrl, IRAS_GST_URL);
  if (rule === 'CPF_DUE_DATE') return isExactOfficialUrl(source.officialUrl, CPF_DUE_DATE_URL) ||
    isExactOfficialUrl(source.officialUrl, CPF_ENFORCEMENT_URL);
  return isExactOfficialUrl(source.officialUrl, CPF_RATE_FACTORS_URL);
}

function evidenceText(rule: CoverageRule, query: string): string {
  if (rule === 'IRAS_GST_FILING') {
    const dueDate = 'A GST return and any tax due are generally due one month after the accounting period ends. A nil return is still required when there was no business activity. For GIRO, deduction is on the 15th of the month after the payment due date, shifted to the next working day if it falls on a weekend or public holiday.';
    if (!asksGstExtension(query)) return dueDate;
    return `${dueDate} Extensions are generally not granted; IRAS considers only acceptable reasons, requires a request with supporting documents at least five working days before the due date, and if the request is not approved before the due date, late filing penalties apply and the outstanding GST F5 must be filed immediately.`;
  }
  if (rule === 'CPF_DUE_DATE') {
    const dueDate = 'CPF contributions are legally due on the last day of the calendar month. The 14th of the following month is the enforcement cut-off; if that date falls on a Saturday, Sunday or public holiday, the next working day applies. These are distinct dates.';
    return dueDate;
  }
  return 'CPF contribution rates depend on citizenship or permanent-resident status (including the applicable PR year), age group, and total wages or wage band. Use the rate table effective for the contribution period being assessed. For employees in their first two years of permanent-resident status, the employer and employee may jointly apply for a higher contribution rate under CPF’s options. This is a general explanation and does not determine an employee’s rate or calculate contributions.';
}

function matchingDocumentClaims(rule: CoverageRule, source: AuthorityPresentedSource, issueId: string, query: string): boolean {
  return groupExactIssueClaimsByDocument(source, issueId).some(group => {
    const claimTexts = group.map(claim => claim.text);
    const claimText = claimTexts.join('\n');
    if (rule === 'CPF_DUE_DATE' && isCpfEnforcementUrl(source.officialUrl)) {
      return provesCpfDueDate(claimText) && hasCpfMinimumInterestQualification(claimText);
    }
    return provesRule(rule, claimText, query);
  });
}

/** Builds a short answer only from exact, current, same-issue and same-document quotes. */
export function getIrasCpfCoverageEvidence(
  query: string,
  stream: AuthorityPresentedWorkstream,
  issue: AuthorityPresentedIssue
): IrasCpfCoverageEvidence | undefined {
  const topicId = stream.authority === 'IRAS' ? 'iras-gst-filing-deadlines'
    : /\b(?:rates?|rate factor|what determines|why .* different .* rates?)\b/i.test(query) ? 'cpf_contribution_rates'
      : 'cpf-contribution-due-dates';
  const rule = ruleFor({ authority: stream.authority, topicId, query, subject: issue.subject });
  if (!rule || (rule !== 'IRAS_GST_FILING' && rule !== 'CPF_DUE_DATE' && rule !== 'CPF_RATE_FACTORS')) return undefined;
  if (isOutOfScope(query)) return undefined;
  const authority = rule === 'IRAS_GST_FILING' ? 'IRAS' : 'CPF';
  const domain = authority === 'IRAS' ? 'IRAS_GST' : 'CPF_PAYROLL';
  const expectedPopulations = rule === 'CPF_RATE_FACTORS' ? ['Employer', 'Employee']
    : authority === 'IRAS' ? ['Company'] : ['Employer'];
  const expectedOperation = rule === 'IRAS_GST_FILING' ? ['EXPLAIN_RULE', 'FILING_REQUIREMENT']
    : ['EXPLAIN_RULE', 'FILING_REQUIREMENT'];
  if (stream.authority !== authority || stream.domain !== domain ||
      !expectedOperation.includes(issue.operation) ||
      !expectedPopulations.includes(issue.population) ||
      issue.evidenceStatus !== 'VERIFIED' ||
      !stream.issues.some(item => item.id === issue.id && item.evidenceStatus === 'VERIFIED')) return undefined;
  for (const source of stream.sources) {
    if (!expectedSource(rule, source) || !matchingDocumentClaims(rule, source, issue.id, query)) continue;
    const text = rule === 'CPF_DUE_DATE' && isCpfEnforcementUrl(source.officialUrl)
      ? `${evidenceText(rule, query)} Late-payment interest is 1.5% per month from the day after the due date, subject to a minimum amount of $5.`
      : evidenceText(rule, query);
    return { authority, text, title: source.title, officialUrl: source.officialUrl! };
  }
  return undefined;
}
