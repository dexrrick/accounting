import type {
  AuthorityPresentedIssue,
  AuthorityPresentedSource,
  AuthorityPresentedWorkstream
} from '../utils/authorityEvidencePresentation';
import { groupExactIssueClaimsByDocument } from '../utils/authorityEvidencePresentation';
import { TargetDateResolver, defaultTargetDateResolver } from './targetDateResolver';

export interface CoverageRuleRequest {
  authority: string;
  topicId: string;
  query: string;
  subject: string;
  sourceText: string;
  referenceDate?: string;
}

export interface MomAcraMasCoverageEvidence {
  authority: 'MOM' | 'ACRA' | 'MAS';
  text: string;
  title: string;
  officialUrl: string;
}

type CoverageRule = 'MOM_FINAL_SALARY' | 'ACRA_SMALL_COMPANY' | 'MAS_VCFM' | 'MAS_CLASS_EXEMPTION';
type CoverageAuthority = MomAcraMasCoverageEvidence['authority'];

const MOM_SALARY_URL = 'https://www.mom.gov.sg/employment-practices/salary/paying-salary';
const ACRA_AUDIT_URL = 'https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/preparing-financial-statements/audit-exemptions/';
const MAS_LICENSING_URL = 'https://www.mas.gov.sg/regulation/capital-markets/apply-for-licensing-or-registration-of-capital-market-entities/fund-management-licensing';
const MAX_QUOTE_LENGTH = 3_200;

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
    .replace(/&hellip;/gi, '…')
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_entity, hex: string | undefined, decimal: string | undefined) => {
      const codePoint = Number.parseInt(hex ?? decimal ?? '', hex ? 16 : 10);
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : ' ';
    })
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function currentGeneralQuestion(query: string, referenceDate = TargetDateResolver.CURRENT_SYSTEM_DATE): boolean {
  const currentYear = referenceDate.slice(0, 4);
  const mentionedYears = [...query.matchAll(/\b(?:19|20)\d{2}\b/g)].map(match => match[0]);
  const resolvedDate = defaultTargetDateResolver.resolveTargetDate(query, referenceDate);
  const dateIsUsedAsHistoricalCutoff = /\b(?:before|prior to|earlier than)\s+(?:the\s+)?(?:\d{1,2}[/-]\d{1,2}[/-]20\d{2}|20\d{2}-\d{2}-\d{2}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+20\d{2})\b/i.test(query);
  const hasRelativeHistoricalPeriod = /\b(?:last|previous|prior|preceding|past)\s+(?:\d+\s+)?(?:days?|weeks?|months?|quarters?|years?|financial years?|reporting periods?)\b|\b(?:yesterday|the day before|earlier this (?:week|month|quarter|year))\b/i.test(query);
  return mentionedYears.every(year => year === currentYear)
    && !(resolvedDate.source === 'EXPLICIT' && resolvedDate.targetDate !== referenceDate)
    && !dateIsUsedAsHistoricalCutoff
    && !hasRelativeHistoricalPeriod
    && !/\b(?:historical|historic|previous|prior year|former|old|superseded)\b/i.test(query)
    && !/\bbefore\s+(?:the\s+)?(?:19|20)\d{2}\b/i.test(query)
    && !/\b(?:calculate|compute|estimate|how much|rate|percentage|specific (?:company|employee|firm)|my (?:company|employee|firm)|our (?:company|employee|firm))\b/i.test(query);
}

function recognizedRule(input: Pick<CoverageRuleRequest, 'authority' | 'topicId' | 'query' | 'subject'>): CoverageRule | undefined {
  const query = input.query;
  const subject = input.subject;

  if (input.authority === 'MOM' && input.topicId === 'mom-salary-payment'
    && /\b(?:salary|pay)\b/i.test(query)
    && /\b(?:final|last salary|resign\w*|dismiss\w*|terminat\w*)\b/i.test(query)
    && /\b(?:salary|pay|payment|deadline|due|when|how soon|what date|timing)\b/i.test(query)
    && /\b(?:salary|pay|employment|resign\w*|dismiss\w*|terminat\w*)\b/i.test(subject)) {
    return 'MOM_FINAL_SALARY';
  }

  if (input.authority === 'ACRA' && ['acra_small_company', 'acra_audit-requirements'].includes(input.topicId)
    && /\b(?:audit|auditor)\b/i.test(query) && /\b(?:small company|audit exemption|audit exempt|exempt from audit)\b/i.test(query)
    && /\b(?:audit|small company|exemption)\b/i.test(subject)) {
    return 'ACRA_SMALL_COMPANY';
  }

  if (input.authority === 'MAS' && input.topicId === 'mas-vcfm'
    && /\b(?:vcfm|venture capital fund manager|venture capital funds?|vc funds?)\b/i.test(query)
    && /\b(?:what|which|how|differ|difference|explain|mean|regime|simplified|criteria|eligible|apply|licen[cs]e|path)\b/i.test(query)
    && /\b(?:vcfm|venture capital)\b/i.test(subject)) {
    if (/\b(?:portfolio percentage|portfolio composition|qualifying investments|investment threshold|fund size|number of investors|detailed eligibility|quantitative criteria)\b/i.test(query)) {
      return undefined;
    }
    return 'MAS_VCFM';
  }

  if (input.authority === 'MAS' && input.topicId === 'mas-fund-management-exemptions'
    && /\b(?:class\s+exemptions?|exempt(?:ions?|ed)?|without (?:an? )?(?:mas )?licen[cs]e)\b/i.test(query)
    && /\b(?:fund|manager|management|related corporation|related family)\b/i.test(query)
    && /\b(?:exempt|licen[cs]e|fund)\b/i.test(subject)) {
    return 'MAS_CLASS_EXEMPTION';
  }
  return undefined;
}

function requestedRule(input: Pick<CoverageRuleRequest, 'authority' | 'topicId' | 'query' | 'subject' | 'referenceDate'>): CoverageRule | undefined {
  return currentGeneralQuestion(input.query, input.referenceDate) ? recognizedRule(input) : undefined;
}

function contiguousSourceSpan(sourceText: string, startPattern: RegExp, endPattern: RegExp): string | undefined {
  const startMatch = startPattern.exec(sourceText);
  if (!startMatch || startMatch.index < 0) return undefined;
  endPattern.lastIndex = startMatch.index + startMatch[0].length;
  const endMatch = endPattern.exec(sourceText);
  if (!endMatch || endMatch.index < 0) return undefined;
  const quote = sourceText.slice(startMatch.index, endMatch.index + endMatch[0].length).trim();
  return quote.length <= MAX_QUOTE_LENGTH ? quote : undefined;
}

function momFinalSalaryFacts(text: string): boolean {
  const source = visibleText(text).toLowerCase();
  const facts = [
    /if you are covered by the employment act[\s\S]{0,180}salary[\s\S]{0,100}at least once a month/i,
    /employee resigns and serves the required notice period[\s\S]{0,180}on the last day of employment/i,
    /employee resigns and does not serve the notice period[\s\S]{0,180}within 7 days of the last day of employment/i,
    /dismissal on grounds of misconduct[\s\S]{0,250}on the last day of employment[\s\S]{0,150}if this is not possible, then within 3 working days from date of dismissal/i,
    /employer terminates the contract[\s\S]{0,250}on the last day of employment[\s\S]{0,150}if this is not possible, then within 3 working days from date of termination/i,
    /if your contract involves commission[\s\S]{0,200}depends on what is in your employment contract or existing policies or practices/i,
    /foreign employee[\s\S]{0,260}withhold all your monies due to you for tax clearance for up to 30 days[\s\S]{0,150}notice of the cessation of your employment to the comptroller of income tax/i
  ];
  if (!facts.every(pattern => pattern.test(source))) return false;
  const commissionStart = source.indexOf('if your contract involves commission');
  const commissionSection = commissionStart >= 0 ? source.slice(commissionStart, commissionStart + 300) : '';
  const taxClearanceStart = source.indexOf('foreign employee');
  const taxClearanceSection = taxClearanceStart >= 0 ? source.slice(taxClearanceStart, taxClearanceStart + 420) : '';
  const monthlyDutyNegated = /\b(?:employer|company)\b[^.!?]{0,60}\b(?:not|never|cannot|can't)\b[^.!?]{0,60}\bpay\b[^.!?]{0,50}\bat least once a month\b/i.test(source);
  const commissionTimingNegated = /\b(?:does not|doesn't|never|not)\s+depend(?:s)?\b/i.test(commissionSection)
    || /\bdepends?\b[^.!?]{0,80}\b(?:not|never|cannot|can't)\b/i.test(commissionSection);
  const taxClearanceDutyNegated = /\b(?:your employer|employer)\b[^.!?]{0,80}\b(?:not required|not obliged|not expected|no obligation|no duty|does not have to|doesn't have to|cannot|can't|never)\b[^.!?]{0,50}\bwithhold\b/i.test(taxClearanceSection)
    || /\bwithhold\b[^.!?]{0,50}\b(?:not|never)\b/i.test(taxClearanceSection);
  const expectedCases = [
    /employee resigns and serves the required notice period[\s\S]{0,180}on the last day of employment/i,
    /employee resigns and does not serve the notice period[\s\S]{0,180}within 7 days of the last day of employment/i,
    /dismissal on grounds of misconduct[\s\S]{0,250}within 3 working days from date of dismissal/i,
    /employer terminates the contract[\s\S]{0,250}within 3 working days from date of termination/i
  ];
  const scenarios = [
    { marker: /employee resigns and serves the required notice period/gi, days: 0, working: false },
    { marker: /employee resigns and does not serve the notice period/gi, days: 7, working: false },
    { marker: /dismissal on grounds of misconduct/gi, days: 3, working: true },
    { marker: /employer terminates the contract/gi, days: 3, working: true }
  ];
  const headings = [...source.matchAll(/(?:employee resigns and (?:serves|does not serve) the required notice period|employee resigns and does not serve the notice period|dismissal on grounds of misconduct|employer terminates the contract)/gi)]
    .map(match => match.index ?? 0);
  const hasConflictingScenario = scenarios.some(({ marker, days, working }) =>
    [...source.matchAll(marker)].some(match => {
      const start = match.index ?? 0;
      const nextHeading = headings.find(offset => offset > start);
      const context = source.slice(start, nextHeading ?? Math.min(source.length, start + 420));
      const intervalPattern = /within (\d+) (working )?days/gi;
      return [...context.matchAll(intervalPattern)].some(interval =>
        Number(interval[1]) !== days || Boolean(interval[2]) !== working);
    }));
  const hasNegatedScenarioDeadline = scenarios.some(({ marker }) =>
    [...source.matchAll(marker)].some(match => {
      const start = match.index ?? 0;
      const nextHeading = headings.find(offset => offset > start);
      const context = source.slice(start, nextHeading ?? Math.min(source.length, start + 420));
      const paymentContext = context.slice(match[0].length)
        .replace(/\bif this is not possible,\s*then\b/gi, '');
      return /\b(?:not|never|cannot|can't)\b[^.!?]{0,35}\b(?:on the last day of employment|within \d+ (?:working )?days)\b/i.test(paymentContext)
        || /\b(?:on the last day of employment|within \d+ (?:working )?days)\b[^.!?]{0,35}\b(?:not|never|false|incorrect)\b/i.test(paymentContext);
    }));
  return expectedCases.every(pattern => pattern.test(source))
    && !hasConflictingScenario
    && !monthlyDutyNegated
    && !commissionTimingNegated
    && !taxClearanceDutyNegated
    && !hasNegatedScenarioDeadline;
}

function textBetween(source: string, startPattern: RegExp, endPattern: RegExp): string | undefined {
  const flags = [...new Set(`${startPattern.flags.replace(/[gy]/g, '')}g`.split(''))].join('');
  const start = [...source.matchAll(new RegExp(startPattern.source, flags))].at(-1);
  if (!start) return undefined;
  const afterStart = source.slice(start.index + start[0].length);
  const end = endPattern.exec(afterStart);
  return end ? source.slice(start.index, start.index + start[0].length + end.index) : undefined;
}

function hasSingleTenMillionCriterion(section: string, criterion: 'total annual revenue' | 'total assets'): boolean {
  const matches = [...section.matchAll(new RegExp(`${criterion} of \\$([0-9]+) million or less`, 'gi'))];
  if (matches.length !== 1 || matches[0][1] !== '10') return false;

  const match = matches[0];
  const previousBoundary = Math.max(
    section.lastIndexOf('.', match.index),
    section.lastIndexOf('!', match.index),
    section.lastIndexOf('?', match.index),
    section.lastIndexOf(';', match.index),
    section.lastIndexOf('\n', match.index)
  );
  const after = section.slice(match.index + match[0].length);
  const nextBoundary = after.search(/[.!?;\n]/);
  const before = section.slice(previousBoundary + 1, match.index).trim();
  const clause = section.slice(previousBoundary + 1,
    nextBoundary < 0 ? undefined : match.index + match[0].length + nextBoundary);
  const deniedBefore = /\b(?:not|never|no longer|incorrect|false|does not|do not|cannot|can't)\s*[:,]?$/i.test(before);
  const deniedAfter = /^(?:(?:is|are|was|were)\s+)?(?:not|never|no longer|incorrect|false|not accepted|no longer accepted)\b/i.test(after.trimStart())
    || /^(?:does not|do not|doesn't|don't|cannot|can't)\s+(?:qualify|count|apply|meet|pass|satisfy)\b/i.test(after.trimStart())
    || /^(?:no longer|not)\s+(?:qualif\w*|accepted|valid|a criterion|a qualifying criterion)\b/i.test(after.trimStart());
  const deniedCriterion = deniedBefore || deniedAfter
    || /\b(?:is|are|was|were)\s+(?:not|never|no longer|incorrect|false)\b[^.!?;\n]{0,70}\b(?:qualifying|criterion|criteria|threshold|valid|apply|meet|met)\b/i.test(clause)
    || /\b(?:not|never|no longer|incorrect|false)\b[^.!?;\n]{0,70}\b(?:qualifying|criterion|criteria|threshold|valid|apply|meet|met)\b/i.test(clause);
  return !deniedCriterion;
}

function hasSingleFiftyEmployeeCriterion(section: string): boolean {
  const matches = [...section.matchAll(/\b([0-9]+) employees or fewer\b/gi)];
  const negatesThreshold = /\b(?:not|never|no longer|does not|do not|cannot|can't)\b[^.!?]{0,40}\b50 employees or fewer\b/i.test(section)
    || /\b50 employees or fewer\b[^.!?]{0,40}\b(?:not|never|incorrect|false)\b/i.test(section);
  return matches.length === 1 && matches[0][1] === '50' && !negatesThreshold;
}

function acraSmallCompanyFacts(text: string): boolean {
  const source = visibleText(text).toLowerCase();
  const smallCompanyStart = /to qualify for audit exemption as a small company/i;
  const companyCriteriaStart = /your company meets at least two of these quantitative criteria for the immediate past two consecutive financial years/i;
  const companyIntroduction = textBetween(source, smallCompanyStart, companyCriteriaStart);
  const companyCriteria = textBetween(source, companyCriteriaStart, /detailed exemption criteria|if your company is newly incorporated/i);
  const newCompanySection = textBetween(source,
    /if your company is newly incorporated \(less than two years old\)/i,
    /if your company is part of a group/i);
  const groupSection = textBetween(source,
    /if your company is part of a group/i,
    /maintaining your exemption status/i);
  const groupCriteriaStart = /your entire group \(including foreign entities\) meets at least two of these quantitative criteria for the immediate past two consecutive financial years/i;
  const groupCriteria = groupSection ? textBetween(groupSection, groupCriteriaStart, /note: the audit exemption applies/i) : undefined;
  const maintainingSection = textBetween(source, /maintaining your exemption status/i, /frequently asked questions/i);
  const companyMaintenance = maintainingSection && /once your company qualifies as a small company, you remain qualified in subsequent financial years unless:/i.test(maintainingSection) &&
    /you cease to be a private company at any time during a financial year/i.test(maintainingSection) &&
    /you do not meet at least two out of three criteria for the immediate past two consecutive financial years/i.test(maintainingSection);
  const groupMaintenance = maintainingSection && /once your group qualifies as a small group, it remains qualified for subsequent financial years/i.test(maintainingSection) &&
    /until it does not meet at least two out of three criteria for the immediate past two consecutive financial years/i.test(maintainingSection);
  const hasNegatedMaintenance = Boolean(maintainingSection &&
    /\b(?:do not|does not|never|no longer|cannot|can't)\b[^.!?]{0,80}\bremain(?:s)? qualified\b/i.test(maintainingSection));
  const contradictsCriteriaCount = /\b(?:all|each of the)\s+(?:2|two|3|three)\b.{0,50}\b(?:criteria|tests|thresholds)\b.{0,100}\b(?:must|required|need)\b/i.test(source)
    || /\bonly one\b.{0,70}\b(?:criterion|criteria|test|threshold)\b.{0,80}\b(?:enough|sufficient|required|must)\b/i.test(source);
  if (!companyIntroduction || !companyCriteria || !newCompanySection || !groupSection || !groupCriteria || !maintainingSection ||
    !companyMaintenance || !groupMaintenance) return false;
  return !hasNegatedMaintenance && !contradictsCriteriaCount
    && /financial years beginning on or after 1 july 2015/.test(source)
    && /meet both of these criteria/.test(companyIntroduction)
    && /your company is a private company in the financial year/.test(companyIntroduction)
    && !/\b(?:not|never|no longer)\b[^.!?]{0,40}\bprivate company in the financial year/i.test(companyIntroduction)
    && /at least two of these quantitative criteria for the immediate past two consecutive financial years/.test(companyCriteria)
    && hasSingleTenMillionCriterion(companyCriteria, 'total annual revenue')
    && hasSingleTenMillionCriterion(companyCriteria, 'total assets')
    && hasSingleFiftyEmployeeCriterion(companyCriteria)
    && /full-time employees at the end of your financial year/.test(companyCriteria)
    && /you qualify for audit exemption if you meet the criteria in the current financial year/i.test(newCompanySection)
    && !/\b(?:do not|does not|will not|cannot|can't)\b[^.!?]{0,60}\bqualify for audit exemption\b/i.test(newCompanySection)
    && /you need to meet both of these conditions to qualify for audit exemption/i.test(groupSection)
    && /your singapore company or subsidiary qualifies as a small company/i.test(groupSection)
    && !/\b(?:not|does not|do not|never|no longer)\b[^.!?]{0,70}\bsingapore company or subsidiary qualifies as a small company/i.test(groupSection)
    && /at least two of these quantitative criteria for the immediate past two consecutive financial years/.test(groupCriteria)
    && hasSingleTenMillionCriterion(groupCriteria, 'total annual revenue')
    && hasSingleTenMillionCriterion(groupCriteria, 'total assets')
    && hasSingleFiftyEmployeeCriterion(groupCriteria)
    && /full-time employees at the end of your financial year/.test(groupCriteria)
    && /does not change your financial statement filing requirements/.test(source);
}

function masVcfmFacts(text: string): boolean {
  const source = visibleText(text).toLowerCase();
  const contradictsApplication = /(?:cannot|can't|may not|is not eligible to|is ineligible to)\s+(?:apply|enter|use)[^.!?]{0,100}\b(?:vcfm|venture capital fund manager)\b/i.test(source)
    || /\b(?:vcfm|venture capital fund manager)\b[^.!?]{0,100}\b(?:not available|not permitted)\b/i.test(source);
  return !contradictsApplication
    && /if your company solely manages venture capital funds, it may apply to be an lfmc that operates under the simplified venture capital fund manager \(vcfm\) regime/.test(source)
    && /when we assess your company to be an lfmc or vcfm, mas considers factors such as:/.test(source)
    && /credibility and substantiveness of the business model and plan/.test(source)
    && /effectiveness of risk management and compliance controls/.test(source)
    && /fund management track record and expertise/.test(source)
    && /fitness and propriety of the applicant, its shareholders and directors/.test(source)
    && /relevant minimum financial requirements prescribed under the sfa/.test(source)
    && /dedicated and secure office space/.test(source)
    && /vcfms are subject to a simplified set of admission criteria[\s\S]{0,150}appendix 4/.test(source);
}

function masClassExemptionFacts(text: string): boolean {
  const source = visibleText(text).toLowerCase();
  const contradictsClassExemption = /\b(?:related corporation|related family member|related entities)\b[^.!?]{0,100}\b(?:automatically exempt|automatically does not require a licence|automatically need not be licensed)\b/i.test(source)
    || /\bclass exemption\b[^.!?]{0,100}\b(?:must|is required to)\b[^.!?]{0,60}\b(?:hold|obtain|apply for) a licence\b/i.test(source);
  const examplesSection = textBetween(source,
    /examples of companies that may be eligible for exemption include those that:/i,
    /you can find more information on exemptions under section 99/i);
  const relatedCorporationExample = examplesSection && textBetween(examplesSection,
    /manage assets for related corporations/i,
    /manage a pool of immovable assets/i);
  const immovableAssetExample = examplesSection && textBetween(examplesSection,
    /manage a pool of immovable assets/i,
    /manage a pool of non-capital markets products/i);
  const nonCapitalProductsStart = examplesSection?.lastIndexOf('manage a pool of non-capital markets products') ?? -1;
  const nonCapitalProductsExample = nonCapitalProductsStart >= 0 ? examplesSection!.slice(nonCapitalProductsStart) : undefined;
  if (!examplesSection || !relatedCorporationExample || !immovableAssetExample || !nonCapitalProductsExample) return false;
  const managementNegated = /\b(?:do not|does not|not|never|cannot|can't)\b[^.!?]{0,40}\bmanage\b/i;
  const investorEligibilityNegated = /\b(?:not\s+|non[-\s]?|un)(?:accredited|institutional)\b/i;
  const listExampleContradiction = managementNegated.test(examplesSection)
    || investorEligibilityNegated.test(immovableAssetExample)
    || investorEligibilityNegated.test(nonCapitalProductsExample);
  return !contradictsClassExemption
    && /if your company is able to operate under an existing class exemption, it does not require a licence/.test(source)
    && /examples of companies that may be eligible for exemption include those that:/.test(source)
    && !listExampleContradiction
    && /manage assets for related corporations or related family members/.test(relatedCorporationExample)
    && /manage a pool of immovable assets for accredited and institutional investors/.test(immovableAssetExample)
    && /manage a pool of non-capital markets products for accredited and institutional investors/.test(nonCapitalProductsExample)
    && /exemptions under section 99 of the sfa/.test(source)
    && /paragraph 5 of the second schedule to the securities and futures \(licensing and conduct of business\) regulations/.test(source);
}

function proves(rule: CoverageRule, text: string): boolean {
  // Positive excerpts are insufficient when the same bounded source explicitly
  // labels the answer premise false. Fail closed on direct contradiction framing.
  if (/\b(?:it is false that|it is not true that|it is incorrect that|it is not the case that|does not state that)\b/i
    .test(visibleText(text))) return false;
  switch (rule) {
    case 'MOM_FINAL_SALARY': return momFinalSalaryFacts(text);
    case 'ACRA_SMALL_COMPANY': return acraSmallCompanyFacts(text);
    case 'MAS_VCFM': return masVcfmFacts(text);
    case 'MAS_CLASS_EXEMPTION': return masClassExemptionFacts(text);
  }
}

function paragraphsForRule(rule: CoverageRule, text: string): string[] {
  const source = visibleText(text);
  if (rule === 'MOM_FINAL_SALARY') {
    const completeSalarySection = contiguousSourceSpan(source,
      /if you are covered by the employment act[\s\S]{0,180}salary[\s\S]{0,100}at least once a month/i,
      /the monies include your salary, leave pay, etc\./i);
    return completeSalarySection ? [completeSalarySection] : [];
  }
  if (rule === 'ACRA_SMALL_COMPANY') {
    const completeAuditRule = contiguousSourceSpan(source,
      /to qualify for audit exemption as a small company/i,
      /no, it does not change your financial statement filing requirements\./i);
    return completeAuditRule ? [completeAuditRule] : [];
  }
  if (rule === 'MAS_VCFM') {
    const route = contiguousSourceSpan(source,
      /if your company solely manages venture capital funds/i,
      /appendix 4 of the aforementioned guidelines\s*\.?/i);
    return [route].filter((item): item is string => Boolean(item));
  }
  const exemption = contiguousSourceSpan(source,
    /if your company is able to operate under an existing class exemption/i,
    /paragraph 5 of the second schedule to the securities and futures \(licensing and conduct of business\) regulations\s*\.?/i);
  return [exemption].filter((item): item is string => Boolean(item));
}

/** Full fetched-source proof. False for an owned but incomplete or contradictory request. */
export function supportMomAcraMasCoverageRule(input: CoverageRuleRequest): boolean | undefined {
  const rule = recognizedRule(input);
  if (!rule) return undefined;
  return currentGeneralQuestion(input.query, input.referenceDate) && proves(rule, input.sourceText);
}

/** Selects exact bounded passages. The complete-source proof runs before any quote can support an answer. */
export function selectMomAcraMasCoverageQuotes(input: CoverageRuleRequest): string[] {
  const rule = requestedRule(input);
  if (!rule || supportMomAcraMasCoverageRule(input) !== true) return [];
  return paragraphsForRule(rule, input.sourceText).filter(quote => quote.length <= MAX_QUOTE_LENGTH);
}

function expectedSource(authority: CoverageAuthority, source: AuthorityPresentedSource): boolean {
  if (source.provenance !== 'LIVE_EXTERNAL' || source.validTo) return false;
  const expectedUrl = authority === 'MOM' ? MOM_SALARY_URL : authority === 'ACRA' ? ACRA_AUDIT_URL : MAS_LICENSING_URL;
  try {
    const url = new URL(source.officialUrl || '');
    const expected = new URL(expectedUrl);
    return url.protocol === 'https:' && url.hostname === expected.hostname && url.pathname === expected.pathname;
  } catch {
    return false;
  }
}

function authorityAndDomain(rule: CoverageRule): { authority: CoverageAuthority; domain: string; sourceUrl: string } {
  if (rule === 'MOM_FINAL_SALARY') return { authority: 'MOM', domain: 'MOM_EMPLOYMENT', sourceUrl: MOM_SALARY_URL };
  if (rule === 'ACRA_SMALL_COMPANY') return { authority: 'ACRA', domain: 'ACRA_CORPORATE', sourceUrl: ACRA_AUDIT_URL };
  return { authority: 'MAS', domain: 'MAS_FUNDS', sourceUrl: MAS_LICENSING_URL };
}

function answerText(rule: CoverageRule): string {
  if (rule === 'MOM_FINAL_SALARY') {
    return 'For employees covered by the Employment Act, final salary is due on the last employment day when required notice is served; within 7 days of the last employment day when the employee resigns without notice; and, after misconduct dismissal or employer termination, on the last day or, if that is not possible, within 3 working days from dismissal or termination. Commission timing follows the employment contract or existing policies or practices. For a foreign employee leaving employment, the employer must withhold monies due for tax clearance for up to 30 days after notifying the Comptroller of Income Tax; this can affect when salary is released.';
  }
  if (rule === 'ACRA_SMALL_COMPANY') {
    return 'ACRA’s small-company audit exemption generally requires a company to be private in the financial year and meet at least 2 of 3 size criteria for the immediate past two consecutive financial years: annual revenue of S$10 million or less, total assets of S$10 million or less, and 50 or fewer full-time employees at financial-year end. A newly incorporated company (less than two years old) has a current-financial-year route. For a group company, both the company itself and the whole group, including foreign entities, must meet at least 2 criteria for the immediate past two consecutive financial years. Once a company qualifies, it remains qualified in later financial years unless it ceases to be private or does not meet at least 2 of the 3 size criteria for the immediate past two consecutive financial years. Once a group qualifies as a small group, it remains qualified in subsequent financial years until it does not meet at least 2 of the 3 size criteria for the immediate past two consecutive financial years. The exemption applies to financial years beginning on or after 01/07/2015 and does not remove financial-statement filing duties. Actual eligibility depends on the company and group facts.';
  }
  if (rule === 'MAS_VCFM') {
    return 'At a high level, MAS describes a VCFM as an LFMC that operates under a simplified VCFM regime. A company that solely manages venture capital funds may apply to use this route. MAS says VCFMs follow simplified admission criteria; the cited page points to Appendix 4 but does not give a full side-by-side comparison or its detailed criteria. The route requires an application and is not automatic eligibility. MAS also considers the business model and risks, risk and compliance controls, track record and expertise, fitness and propriety, minimum financial requirements, and dedicated secure office arrangements; check Appendix 4 before deciding whether a particular manager qualifies.';
  }
  return 'A fund manager does not become exempt merely because it manages assets for a related corporation or family member. MAS says a company operating under an existing class exemption does not require a licence, and gives related-corporation or family assets, certain immovable-asset pools, and certain non-capital-markets-product pools for accredited or institutional investors as examples that may be eligible. The specific exemption conditions under section 99 of the SFA and paragraph 5 of the Regulations must be checked before concluding that a particular manager is exempt.';
}

/** Renders only from current official-page quotes bound to this exact issue and fetched document revision. */
export function getMomAcraMasCoverageEvidence(
  query: string,
  stream: AuthorityPresentedWorkstream,
  issue: AuthorityPresentedIssue
): MomAcraMasCoverageEvidence | undefined {
  const topicId = inferTopicId(stream.authority, query, issue.subject);
  const rule = requestedRule({ authority: stream.authority, topicId, query, subject: issue.subject });
  if (!rule) return undefined;
  const expected = authorityAndDomain(rule);
  const expectedPopulations = rule === 'MOM_FINAL_SALARY' ? ['Employee', 'Employer'] : ['Company'];
  if (!expectedPopulations.includes(issue.population) || !issueSubjectMatches(rule, issue.subject) ||
      !stream.issues.some(candidate => candidate.id === issue.id)) return undefined;
  if (stream.authority !== expected.authority || stream.domain !== expected.domain ||
      issue.evidenceStatus !== 'VERIFIED' ||
      !['NOT_REQUIRED', 'UNRESOLVED'].includes(issue.applicationStatus) ||
      !['EXPLAIN_RULE', 'CHECK_ELIGIBILITY', 'FILING_REQUIREMENT'].includes(issue.operation)) return undefined;

  for (const source of stream.sources) {
    if (!expectedSource(expected.authority, source) || source.officialUrl !== expected.sourceUrl) continue;
    const provesBoundClaims = groupExactIssueClaimsByDocument(source, issue.id)
      .some(group => proves(rule, group.map(claim => claim.text).join('\n\n')));
    if (provesBoundClaims) {
      return { authority: expected.authority, text: answerText(rule), title: source.title, officialUrl: source.officialUrl! };
    }
  }
  return undefined;
}

function inferTopicId(authority: string, query: string, subject: string): string {
  if (authority === 'MOM') return 'mom-salary-payment';
  if (authority === 'ACRA') return 'acra_small_company';
  if (/\b(?:vcfm|venture capital)\b/i.test(subject) && !/\b(?:class\s+exemption|exempt(?:ion|ed)?)\b/i.test(subject)) return 'mas-vcfm';
  if (/\b(?:class\s+exemptions?|exempt(?:ions?|ed)?|related corporation|related family)\b/i.test(subject + ' ' + query)) {
    return 'mas-fund-management-exemptions';
  }
  return 'mas-vcfm';
}

function issueSubjectMatches(rule: CoverageRule, subject: string): boolean {
  if (rule === 'MOM_FINAL_SALARY') return /\b(?:final|last|resignation|resign\w*|dismiss\w*|terminat\w*)\b/i.test(subject)
    && /\b(?:salary|pay)\b/i.test(subject)
    && !/\b(?:deductions?|overtime|salary period|salary frequency|pay slip)\b/i.test(subject);
  if (rule === 'ACRA_SMALL_COMPANY') return /\b(?:audit|small company|exemption)\b/i.test(subject)
    && !/\b(?:annual return|agm|company secretary|company formation)\b/i.test(subject);
  if (rule === 'MAS_VCFM') return /\b(?:vcfm|venture capital)\b/i.test(subject)
    && !/\b(?:class exemption|related corporation)\b/i.test(subject);
  return (/\b(?:class exemptions?|fund management exemptions?)\b/i.test(subject) ||
    /\brelated[-\s]+corporation\b[^.!?]{0,100}\bautomatically exempt\b/i.test(subject))
    && !/\b(?:vcfm|venture capital admission)\b/i.test(subject);
}
