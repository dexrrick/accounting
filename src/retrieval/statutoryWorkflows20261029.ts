import type {
  AuthorityPresentedIssue,
  AuthorityPresentedSource,
  AuthorityPresentedWorkstream
} from '../utils/authorityEvidencePresentation';
import { groupExactIssueClaimsByDocument } from '../utils/authorityEvidencePresentation';
import { cleanHtmlText, cleanHtmlTextPreservingTableCells } from './sourceAdapters';
import { defaultTargetDateResolver, hasHistoricalStatutoryVersionIntent, TargetDateResolver } from './targetDateResolver';

export interface StatutoryWorkflowRequest {
  authority: string;
  topicId: string;
  query: string;
  subject: string;
  sourceText: string;
  officialUrl?: string;
}

export type StatutoryWorkflowRuleId =
  | 'ACRA_ENTITY_INFORMATION_UPDATE_DEADLINES'
  | 'IRAS_COMPANY_TAX_RECORD_RETENTION'
  | 'CPF_CONTRIBUTION_REFUND_DEADLINES'
  | 'MOM_ITEMISED_PAYSLIP_REQUIREMENTS'
  | 'MAS_LFMC_KEY_APPOINTMENTS';

export interface StatutoryWorkflowRule {
  id: StatutoryWorkflowRuleId;
  authority: 'ACRA' | 'IRAS' | 'CPF' | 'MOM' | 'MAS';
  topicIds: readonly string[];
  officialUrl: string;
  title: string;
  fixtureFile: string;
  fixtureKind: 'RETAINED_NATIVE_OFFICIAL_HTML' | 'RETAINED_NATIVE_OFFICIAL_PDF';
  population: string;
  provisions: readonly string[];
  rule: string;
  conditions: readonly string[];
  exceptions: readonly string[];
  requiredFacts: readonly string[];
  effectiveDateEvidence: string;
  limitations: readonly string[];
}

type Rule = StatutoryWorkflowRule & {
  requiredSourceTerms: readonly string[];
  quoteMatchers: readonly RegExp[];
  contradictionPatterns: readonly RegExp[];
  queryPattern: RegExp;
  subjectPattern: RegExp;
};

const ACRA_ENTITY_URL = 'https://www.acra.gov.sg/resources/guides-forms/updating-entitys-information/';
const IRAS_RECORDS_URL = 'https://www.iras.gov.sg/taxes/corporate-income-tax/basics-of-corporate-income-tax/record-keeping-requirements';
const CPF_REFUNDS_URL = 'https://www.cpf.gov.sg/employer/compliance-and-rectifications/applying-for-refund-of-cpf-contributions';
const MOM_PAYSLIPS_URL = 'https://www.mom.gov.sg/employment-practices/salary/itemised-payslips';
const MAS_LFMC_TOOLKIT_URL = 'https://www.mas.gov.sg/-/media/mas-media-library/regulation/guidance/cmi/compliance-toolkits-for-fund-management-companies/sfa-compliance-toolkit-lfmcs29-may-2026-clean.pdf';

/**
 * Source-backed workflow guidance for five current administrative procedures.
 * These records are retrieval pointers and proof contracts; their metadata does
 * not admit or activate a source. Every displayed explanation still requires
 * exact-URL, issue-bound quotes from one verified source revision.
 */
export const STATUTORY_WORKFLOW_RULES_20261029: readonly Rule[] = Object.freeze([
  {
    id: 'ACRA_ENTITY_INFORMATION_UPDATE_DEADLINES', authority: 'ACRA', topicIds: ['acra-entity-information-changes'],
    officialUrl: ACRA_ENTITY_URL, title: 'Updating an entity’s information', fixtureFile: 'acra-entity-updates.html',
    fixtureKind: 'RETAINED_NATIVE_OFFICIAL_HTML',
    population: 'Entities registered with ACRA; a separate 30-day deadline applies to foreign companies',
    provisions: ['ACRA entity-information update guidance; the cited page does not identify a statutory section number.'],
    rule: 'ACRA says registered entities must notify it of changes within 14 days from the date of change; foreign companies have 30 days. The listed details include the entity email address and registered office address. The time limit runs from the change, so the annual return is not a substitute for making a required update within that period.',
    conditions: ['The 14-day period applies to registered entities except foreign companies, for which the page gives 30 days.', 'The source lists entity name, email address, business activities, registered office and other entity information; the steps vary by information category.'],
    exceptions: ['The page distinguishes foreign companies and does not establish every filing duty for officers, share capital, annual returns, VCCs or historical periods.'],
    requiredFacts: ['Entity type and the category of information changed.', 'The date of the change and any category-specific filing facts.'],
    effectiveDateEvidence: 'The captured page does not state a legal commencement date. Its retrieval date is not treated as an effective date.',
    limitations: ['A calendar deadline requires a confirmed change date and entity category.', 'For an entity-specific answer, confirm the applicable filing route.'],
    requiredSourceTerms: [
      'All registered entities must notify ACRA of any changes within 14 days from the date of change, except foreign companies which have 30 days.',
      'Within 14 days from the date of the change', 'Within 30 days from the date of the change',
      'Entity email address', 'Registered office address'
    ],
    quoteMatchers: [
      /All registered entities must notify ACRA of any changes within 14 days from the date of change, except foreign companies which have 30 days\./i,
      /Filing deadlines[\s\S]{0,120}All registered entities\s*(?:\|\s*)?Within 14 days from the date of the change[\s\S]{0,120}Foreign companies\s*(?:\|\s*)?Within 30 days from the date of the change/i,
      /Entity email address[\s\S]{0,220}Registered office address/i
    ],
    contradictionPatterns: [
      /(?:all registered entities|registered entities)[^.!?\n]{0,100}\b(?:15|10) days\b/i,
      /foreign companies[^.!?\n]{0,100}\b(?:14|15|60) days\b/i,
      /foreign companies[^.!?\n]{0,100}\b(?:30|thirty) days\b[^.!?\n]{0,100}\b(?:14|fourteen) days\b/i
    ],
    queryPattern: /\b(?:entity information|registered entities?|registered office|entity email|business email|company email|email address|business activities|update\w*|changes? to (?:our|the|an) entity)\b/i,
    subjectPattern: /\b(?:entity information|registered entity|registered office|entity email|email address|business activities|entity update|change of entity information|notification deadline)\b/i
  },
  {
    id: 'IRAS_COMPANY_TAX_RECORD_RETENTION', authority: 'IRAS', topicIds: ['iras-company-record-retention'],
    officialUrl: IRAS_RECORDS_URL, title: 'Record Keeping Requirements', fixtureFile: 'iras-company-records.html',
    fixtureKind: 'RETAINED_NATIVE_OFFICIAL_HTML',
    population: 'Companies keeping records and supporting documents connected with their business and corporate income tax',
    provisions: ['IRAS corporate income tax record-keeping guidance; no Act section number is added from the cited page.'],
    rule: 'A company must retain source documents, accounting records and schedules, bank statements and other transaction-connected business records for at least five years from the relevant Year of Assessment (YA). IRAS gives examples: records for YA 2019 are retained to 31 December 2023, while records for YA 2023 are retained to 31 December 2027. For a company struck off and dissolved, the officer immediately before dissolution keeps the books and papers for at least five years after dissolution; for a wound-up company, the liquidator does so for at least five years from dissolution.',
    conditions: ['Use the relevant YA for ordinary company tax records; the page’s examples distinguish December and non-December financial-year ends.', 'After dissolution, the source identifies a different responsible person and starts the five-year period from dissolution.'],
    exceptions: ['This is corporate income tax record guidance, not the separate GST record-retention rule.', 'The ordinary YA period does not replace the separate dissolution-date duties for struck-off or wound-up companies.'],
    requiredFacts: ['The relevant YA and financial-year period.', 'Whether the company was struck off and dissolved or wound up, and its dissolution date.'],
    effectiveDateEvidence: 'The captured current page gives duration examples but no separate legal commencement date. Capture/update dates do not establish historic legal-version applicability.',
    limitations: ['The source examples explain ordinary YA retention; they do not determine every record-specific retention requirement.', 'A company-specific last-retention date requires the correct YA or dissolution date.'],
    requiredSourceTerms: [
      'source documents, accounting records and schedules, bank statements',
      'Your company must retain its records for at least 5 years from the relevant YA.',
      '2019 1 Jan 2018 to 31 Dec 2018 31 Dec 2023', '2023 1 Jan 2022 to 31 Dec 2022 31 Dec 2027',
      '2019 1 Oct 2017 to 30 Sep 2018 31 Dec 2023', '2023 1 Oct 2021 to 30 Sep 2022 31 Dec 2027',
      'Struck Off Companies', 'officer of the company immediately before its dissolution',
      'at least 5 years after the date on which the company was dissolved', 'Wound Up Companies',
      'liquidator of the company', 'at least 5 years from the date of dissolution of the company'
    ],
    quoteMatchers: [
      /Your company must maintain proper records of its financial transactions and retain the source documents, accounting records and schedules, bank statements[^.]{0,260}Year of Assessment \(YA\)\./i,
      /Your company must retain its records for at least 5 years from the relevant YA\./i,
      /Example 1:[\s\S]{0,600}2019[\s\S]{0,180}31 Dec 2023[\s\S]{0,300}2023[\s\S]{0,180}31 Dec 2027/i,
      /Example 2:[\s\S]{0,600}2019[\s\S]{0,180}31 Dec 2023[\s\S]{0,300}2023[\s\S]{0,180}31 Dec 2027/i,
      /Struck Off Companies[\s\S]{0,500}officer of the company immediately before its dissolution[\s\S]{0,250}at least 5 years after the date on which the company was dissolved/i,
      /Wound Up Companies[\s\S]{0,400}liquidator of the company[\s\S]{0,250}at least 5 years from the date of dissolution of the company/i
    ],
    contradictionPatterns: [
      /records?[^.!?\n]{0,100}\bat least (?:6|3) years from the relevant YA\b/i,
      /struck off[^.!?\n]{0,220}\bat least (?:6|3) years after[^.!?\n]{0,70}dissolv/i,
      /wound up[^.!?\n]{0,220}\bat least (?:6|3) years from[^.!?\n]{0,70}dissolv/i
    ],
    queryPattern: /\b(?:corporate tax|company tax|income tax|business records?|accounting records?|source documents?|invoices?|books and papers|record[- ]keeping|records? retention|record custod(?:y|ian)|dissolv\w*|struck off|wound up|keep (?:our|the|company) records?)\b/i,
    subjectPattern: /\b(?:company (?:tax )?record|corporate (?:tax )?record|business record|books and papers|record retention|record[- ]keeping|record custod|dissolv\w*|wound up|struck off)\b/i
  },
  {
    id: 'CPF_CONTRIBUTION_REFUND_DEADLINES', authority: 'CPF', topicIds: ['cpf-adjustments-refunds'],
    officialUrl: CPF_REFUNDS_URL, title: 'Applying for refund of CPF contributions', fixtureFile: 'cpf-refunds.html',
    fixtureKind: 'RETAINED_NATIVE_OFFICIAL_HTML',
    population: 'Employers applying to refund wrongly paid CPF contributions for employees',
    provisions: ['CPF Board employer refund application guidance; the page describes submission process and does not independently interpret CPF Act provisions.'],
    rule: 'Refund requests for CPF contributions generally must be made immediately and no later than one year from payment; the “PAYMENTS RECEIVED ON” field identifies the payment date. For conditional wages, the one-year period instead runs from when the wages are due to be repaid to the employer, as stated in employment terms or a mutual agreement, and that date must be entered in the application. Before applying, the employer must return the employee share directly to the employee. CPF Board effects refunds only to the extent of funds available in the employee’s CPF account. Excess Additional Wage ceiling contributions should be claimed promptly; excess CPF Annual Limit contributions paid from 2023 are automatically refunded to the employer’s Direct Debit Account from February 2024.',
    conditions: ['The general and entire-submission application deadline is one year from contribution payment, using the “PAYMENTS RECEIVED ON” record field.', 'Conditional-wage refunds use the repayment due date, not the contribution payment date.', 'The employer must first return the employee share where applicable; refunds depend on funds available in employee CPF accounts.'],
    exceptions: ['Excess Additional Wage ceiling contributions are a prompt-application category.', 'CPF Annual Limit excess contributions paid from 2023 are refunded automatically to the employer from February 2024; this is distinct from an application for an AW-ceiling refund.'],
    requiredFacts: ['Refund category and CPF payment date.', 'For conditional wages, the contractual or mutually agreed repayment due date.', 'Whether the employee share was returned and funds remain available in CPF account(s).', 'For AW or annual-limit excess, the relevant year and excess category.'],
    effectiveDateEvidence: 'The page’s annual-limit statement explicitly starts in February 2024 and applies to excess paid from 2023. Other page-update dates are not treated as effective dates.',
    limitations: ['Do not infer a refund deadline when the payment date, conditional-wage repayment date or calendar anniversary is unclear.', 'The source does not establish that a particular refund application will be accepted or the amount CPF Board will refund.'],
    requiredSourceTerms: [
      'Any request for refund of CPF contributions paid must be made immediately and no later than one year from the date of payment of the CPF contributions.',
      'PAYMENTS RECEIVED ON', 'field in your record of payment to determine the date of payment',
      'conditional wages must be made immediately and no later than one year from the date wages are supposed to be repaid to the employer',
      'date stated in the terms of employment or based on mutual agreement', 'refund the employee’s share of CPF contributions',
      'before submitting the application', 'Refund is subject to availability of funds', 'available funds in the employee’s CPF account',
      'apply for a refund of the CPF contributions made promptly', 'From February 2024',
      "refunded automatically to the employer's Direct Debit Account", 'excess contributions paid from year 2023'
    ],
    quoteMatchers: [
      /Any request for refund of CPF contributions paid must be made immediately and no later than one year from the date of payment of the CPF contributions\.[\s\S]{0,220}PAYMENTS RECEIVED ON[\s\S]{0,120}field in your record of payment to determine the date of payment\./i,
      /Any request for refund of CPF contributions paid on conditional wages must be made immediately and no later than one year from the date wages are supposed to be repaid to the employer[\s\S]{0,330}terms of employment or based on mutual agreement/i,
      /You’re responsible to refund the employee’s share of CPF contributions[^.]*before submitting the application\./i,
      /Refund is subject to availability of funds[\s\S]{0,200}available funds in the employee’s CPF account/i,
      /Refund of payments made in excess of Additional Wage ceiling[\s\S]{0,320}apply for a refund[^.]*promptly\./i,
      /Refund of contributions paid in excess of CPF Annual Limit[\s\S]{0,300}From February 2024[^.]*refunded automatically[^.]*Direct Debit Account[\s\S]{0,140}excess contributions paid from year 2023/i
    ],
    contradictionPatterns: [
      /refund of CPF contributions paid[^.!?\n]{0,160}\bno later than (?:two|2|six|6) years\b/i,
      /conditional wages[^.!?\n]{0,160}\bfrom the date of payment\b/i,
      /annual limit[^.!?\n]{0,220}\b(?:must apply|application required|not refunded automatically)\b/i,
      /AW ceiling[^.!?\n]{0,220}\brefunded automatically\b/i
    ],
    queryPattern: /\b(?:cpf|central provident fund)\b[\s\S]{0,180}\b(?:refund\w*|overpaid|overpayment|excess contribution|wrongly paid|mistaken contribution|paid in error|repayment|recover\w*|money back)\b|\b(?:refund\w*|overpaid|overpayment|excess contribution|mistaken contribution|recover\w*|money back)\b[\s\S]{0,180}\b(?:cpf|central provident fund)\b/i,
    subjectPattern: /\b(?:cpf|contribution|refund|repayment)\b/i
  },
  {
    id: 'MOM_ITEMISED_PAYSLIP_REQUIREMENTS', authority: 'MOM', topicIds: ['mom-itemised-payslips'],
    officialUrl: MOM_PAYSLIPS_URL, title: 'Itemised pay slips', fixtureFile: 'mom-payslips.html',
    fixtureKind: 'RETAINED_NATIVE_OFFICIAL_HTML',
    population: 'Employees covered by the Employment Act and their employers',
    provisions: ['Employment Act coverage as stated by MOM. No section number is added from the captured page.'],
    rule: 'Employers must issue itemised pay slips to employees covered by the Employment Act together with payment. If that is not possible, the payslip must be given within three working days of payment. For termination or dismissal, the payslip must be given together with outstanding salary. MOM allows a soft or hard copy (including handwritten); a soft copy can be delivered electronically.',
    conditions: ['The requirement applies to employees covered by the Employment Act.', 'MOM permits soft or hard copy, including handwritten.', 'The fallback is three working days after payment only when the employer cannot give it with payment.'],
    exceptions: ['Items that do not apply need not be shown; MOM’s page gives overtime items as an example.', 'This rule does not calculate final-salary deadlines or determine Employment Act coverage for a particular worker.'],
    requiredFacts: ['Employment Act coverage.', 'Payment date, whether a pay slip was provided with payment, and any termination/dismissal with outstanding salary.'],
    effectiveDateEvidence: 'The page states that the itemised-payslip duty begins on 1 April 2016. This does not establish that every detailed condition in the current page applied unchanged from that date.',
    limitations: ['Three working days are not converted into calendar days.', 'The captured page does not establish current coverage of a particular worker.'],
    requiredSourceTerms: [
      'From 1 April 2016, all employers must issue itemised pay slips to employees covered by the Employment Act.',
      'Employers must issue itemised pay slips to all employees covered by the Employment Act.',
      'Pay slips must include the items below, unless an item is not applicable.',
      'if overtime pay does not apply to you, your pay slip need not include items 9 to 11',
      'Give together with payment to employee.',
      'If unable to give together, to be given within three working days of payment.',
      'In the case of termination or dismissal, must give pay slip together with outstanding salary.',
      'Format | Soft or hard copy (including handwritten)'
    ],
    quoteMatchers: [
      /From 1 April 2016, all employers must issue itemised pay slips to employees covered by the Employment Act\./i,
      /Employers must issue itemised pay slips to all employees covered by the Employment Act\./i,
      /Pay slips must include the items below, unless an item is not applicable\.[\s\S]{0,200}if overtime pay does not apply to you, your pay slip need not include items 9 to 11\./i,
      /Give together with payment to employee\.[\s\S]{0,200}If unable to give together, to be given within three working days of payment\./i,
      /In the case of termination or dismissal, must give pay slip together with outstanding salary\./i,
      /Format\s*\|\s*Soft or hard copy \(including handwritten\)/i
    ],
    contradictionPatterns: [
      /within (?:five|5|three) calendar days of payment/i,
      /within (?:five|5) working days of payment/i,
      /termination or dismissal[^.!?\n]{0,180}\b(?:within 3 days|after the final pay date)\b/i,
      /itemised pay slips? (?:are|is) optional/i
    ],
    queryPattern: /\b(?:itemi[sz]ed (?:pay ?slips?|statements?)|pay ?slips?|payslips?)\b/i,
    subjectPattern: /\b(?:itemi[sz]ed pay ?slip|pay ?slip|payslip)\b/i
  },
  {
    id: 'MAS_LFMC_KEY_APPOINTMENTS', authority: 'MAS', topicIds: ['mas-lfmc-key-appointments'],
    officialUrl: MAS_LFMC_TOOLKIT_URL, title: 'Compliance Toolkit for Licensed Fund Management Companies',
    fixtureFile: 'mas-lfmc-toolkit.pdf', fixtureKind: 'RETAINED_NATIVE_OFFICIAL_PDF',
    population: 'Licensed Fund Management Companies (LFMCs)',
    provisions: ['MAS LFMC Compliance Toolkit requirement 3, which cites section 96 of the Securities and Futures Act and regulation 12 of the Securities and Futures (Licensing and Conduct of Business) Regulations.'],
    rule: 'The current MAS LFMC Compliance Toolkit row 3 says an LFMC must seek prior MAS approval using Form 11 before appointing a Chief Executive Officer or Director, or before changing a Director’s appointment nature from Non-Executive to Executive; already being on the board does not remove approval for that change. Row 17 is a separate subsequent notification: it covers CEO or Director resignation, an Executive-to-Non-Executive change, changed CEO/Director particulars, and changed business interests or shareholdings provided in Form 11. Row 17 gives “As soon as practicable” for these notifications; its additional no-later-than-14-days limit is specifically attached to the resignation in item (i).',
    conditions: ['The toolkit applies to Licensed Fund Management Companies and identifies the SFA and LCBR requirements in its scope.', 'Row 3 calls for prior approval; row 17 separately concerns subsequent notifications and must not be substituted for row 3. Its 14-day time limit applies to item (i), resignation.'],
    exceptions: ['This toolkit is not exhaustive and excludes requirements outside the SFA and fund-level requirements.', 'The toolkit revision date is not a legal commencement date; this summary does not establish historic requirements.'],
    requiredFacts: ['Whether the firm is an LFMC.', 'Whether the person is a CEO or Director and whether the action is an initial appointment, Director nature change, resignation or later particulars change.'],
    effectiveDateEvidence: 'The retained PDF identifies its issue/revision dates only; neither those dates nor row 17’s update note establishes legal commencement for row 3.',
    limitations: ['General current toolkit guidance only; verify the applicable SFA provisions, licence conditions and current MAS requirements for a specific LFMC.', 'Do not apply this row to VCFMs or other CMS licence holders without a source covering that regime.'],
    requiredSourceTerms: [
      'Compliance Toolkit aims to provide guidance', 'Relevant to: | LFMCs',
      '3 To seek MAS’ approval', 'Form 11 - Appointment', 'Prior | to | the', 'appointment of a Chief Executive Officer',
      'Section 96 of the SFA', 'Regulation 12 of',
      '(CEO) or Director;', 'nature of Director appointment from Non-',
      '17 To notify MAS of', 'resignation of CEO', 'As soon as practicable', 'for (i), no later than',
      '14 days from the date of', 'the resignation', 'nature of the appointment of a Director',
      'Executive to one that is', 'Non-Executive',
      'change in particulars', 'provided in Form 11'
    ],
    quoteMatchers: [
      /3 To seek MAS’ approval[\s\S]{0,1000}Form 11[\s\S]{0,240}Prior\s*\|\s*to\s*\|\s*the[\s\S]{0,500}Section 96 of the SFA[\s\S]{0,500}Regulation 12 of[\s\S]{0,300}\(CEO\) or Director;[\s\S]{0,300}nature of Director appointment from Non-[\s\S]{0,200}Executive to Executive[\s\S]{0,200}Executive to Executive/i,
      /17 To notify MAS of \(i\)[\s\S]{0,300}resignation of CEO[\s\S]{0,300}As soon as practicable[\s\S]{0,250}for \(i\), no later than[\s\S]{0,250}nature of the appointment of a Director[\s\S]{0,250}14 days from the date of[\s\S]{0,250}from one that is Executive to one that is[\s\S]{0,150}the resignation[\s\S]{0,150}Non-Executive[\s\S]{0,1600}provided in Form 11/i,
      /Relevant to:\s*\|\s*LFMCs/i
    ],
    contradictionPatterns: [
      /3 To seek MAS’ approval[\s\S]{0,900}\b(?:after|following)\s*\|?\s*(?:the\s*\|?\s*)?appointment\b/i,
      /3 To seek MAS’ approval[\s\S]{0,1000}Form 11[\s\S]{0,250}\b(?:after|following)\s*\|\s*the\b/i,
      /row 3[^.!?\n]{0,220}\bnotification\b/i,
      /17 To notify MAS[^\n]{0,900}\bprior approval\b/i
    ],
    queryPattern: /\b(?:LFMC|licensed fund management company|fund manager)\b[\s\S]{0,220}\b(?:appoint\w*|appointment|CEO|director|Form 11|executive|non.executive|role change|nature of (?:the )?appointment)\b|\b(?:appoint\w*|appointment|CEO|director|Form 11|executive\s*(?:to|into|becomes?)\s*non.executive|non.executive\s*(?:to|into|becomes?)\s*executive|nature of (?:the )?appointment)\b[\s\S]{0,220}\b(?:LFMC|licensed fund management company)\b/i,
    subjectPattern: /\b(?:LFMC|fund management|CEO|director|Form 11|key appointment)\b/i
  }
]);

export const STATUTORY_WORKFLOW_RULES_METADATA_20261029: readonly StatutoryWorkflowRule[] = STATUTORY_WORKFLOW_RULES_20261029;

function recognizeRule(input: Pick<StatutoryWorkflowRequest, 'authority' | 'topicId' | 'query' | 'subject'>): Rule | undefined {
  return STATUTORY_WORKFLOW_RULES_20261029.find(rule => rule.authority === input.authority
    && rule.topicIds.includes(input.topicId) && rule.queryPattern.test(input.query) && rule.subjectPattern.test(input.subject));
}

function cleanedSource(sourceText: string): string {
  if (!/<(?:!doctype|html|head|body|main|article|section|div|p|table|tr|td|li|h[1-6])\b/i.test(sourceText)) {
    return sourceText.replace(/\r/g, '').replace(/[\t ]+\n/g, '\n').trim();
  }
  return (/<table\b/i.test(sourceText) ? cleanHtmlTextPreservingTableCells(sourceText) : cleanHtmlText(sourceText))
    .replace(/\r/g, '').replace(/\n{2,}/g, '\n').trim();
}

function sourceStatements(sourceText: string): string[] {
  const clean = cleanedSource(sourceText);
  return [...new Set(clean.split(/\n+/).flatMap(line => line.split(/(?<=[.!?])\s+/))
    .map(value => value.trim()).filter(Boolean))];
}

function normalizedSourceTerms(value: string): string {
  return value.replace(/\s*\|\s*/g, ' ').replace(/\s+/g, ' ').toLowerCase();
}

function sourceContradicts(rule: Rule, sourceText: string): boolean {
  const clean = cleanedSource(sourceText);
  return rule.contradictionPatterns.some(pattern => pattern.test(clean));
}

function sourceProves(rule: Rule, sourceText: string): boolean {
  return !sourceContradicts(rule, sourceText) && hasAllRequiredTerms(rule, sourceText)
    && hasAllRequiredQuotes(rule, sourceText);
}

function hasAllRequiredTerms(rule: Rule, sourceText: string): boolean {
  const clean = normalizedSourceTerms(cleanedSource(sourceText));
  return rule.requiredSourceTerms.every(term => clean.includes(normalizedSourceTerms(term)));
}

function hasAllRequiredQuotes(rule: Rule, sourceText: string): boolean {
  const clean = cleanedSource(sourceText);
  return rule.quoteMatchers.every(pattern => pattern.test(clean));
}

function scopeAllowsCurrentRule(query: string): boolean {
  if (hasHistoricalStatutoryVersionIntent(query)) return false;
  const resolution = defaultTargetDateResolver.resolveAuthorityEvidenceDate(query);
  const currentYear = TargetDateResolver.CURRENT_SYSTEM_DATE.slice(0, 4);
  const hasNonCurrentYear = [...query.matchAll(/\b(?:19|20)\d{2}\b/g)].some(match => match[0] !== currentYear);
  if (hasNonCurrentYear && resolution.dateRole !== 'CURRENT_WORKFLOW_FACT') return false;
  return resolution.source === 'NONE' || !resolution.targetDate;
}

/** Returns undefined for an unowned issue and false for a known rule without complete exact-source proof. */
export function supportStatutoryWorkflowRule(request: StatutoryWorkflowRequest): boolean | undefined {
  const rule = recognizeRule(request);
  if (!rule) return undefined;
  if (!scopeAllowsCurrentRule(request.query)
      || (request.officialUrl !== undefined && request.officialUrl !== rule.officialUrl)
      || sourceContradicts(rule, request.sourceText)) return false;
  return sourceProves(rule, request.sourceText);
}

/** Returns all bounded, directly matched premises only when they jointly prove the owned family. */
export function selectStatutoryWorkflowQuotes(request: StatutoryWorkflowRequest): string[] {
  const rule = recognizeRule(request);
  if (!rule || request.officialUrl !== rule.officialUrl || supportStatutoryWorkflowRule(request) !== true) return [];
  const clean = cleanedSource(request.sourceText);
  const statements = sourceStatements(request.sourceText);
  const quotes = rule.quoteMatchers.map(pattern => pattern.exec(clean)?.[0]).filter((value): value is string => Boolean(value));
  const selected = [...quotes];
  for (const term of rule.requiredSourceTerms) {
    if (normalizedSourceTerms(selected.join(' ')).includes(normalizedSourceTerms(term))) continue;
    const statement = statements.find(value => normalizedSourceTerms(value).includes(normalizedSourceTerms(term)));
    if (!statement) return [];
    selected.push(statement);
  }
  const unique = [...new Set(selected)];
  return unique.every(quote => quote.length <= 5_000)
    && rule.requiredSourceTerms.every(term => normalizedSourceTerms(unique.join('\n')).includes(normalizedSourceTerms(term)))
    && !sourceContradicts(rule, unique.join('\n')) ? unique : [];
}

/** Explicit contradictory text can veto broader statutory fallbacks for a recognized family. */
export function hasStatutoryWorkflowContradiction(request: StatutoryWorkflowRequest): boolean {
  const rule = recognizeRule(request);
  return Boolean(rule && sourceContradicts(rule, request.sourceText));
}

export function statutoryWorkflowPointers(input: Pick<StatutoryWorkflowRequest, 'authority' | 'topicId' | 'query' | 'subject'>): string[] {
  const rule = recognizeRule(input);
  return rule ? [rule.officialUrl] : [];
}

function sourceFor(rule: Rule, source: AuthorityPresentedSource, issueId: string): boolean {
  return source.provenance === 'LIVE_EXTERNAL' && !source.validTo && source.officialUrl === rule.officialUrl
    && groupExactIssueClaimsByDocument(source, issueId)
      .some(group => sourceProves(rule, group.map(claim => claim.text).join('\n')));
}

function answerText(rule: Rule, query: string): string {
  const application = rule.id === 'ACRA_ENTITY_INFORMATION_UPDATE_DEADLINES'
    ? acraForeignCompanyDeadlineApplication(query)
    : rule.id === 'IRAS_COMPANY_TAX_RECORD_RETENTION'
      ? irasRecordRetentionApplication(query)
      : undefined;
  return `${rule.rule} ${rule.conditions.join(' ')} ${rule.exceptions.join(' ')} For case-specific application, consider: ${rule.requiredFacts.join(' ')} ${rule.limitations.join(' ')}${application ? ` ${application}` : ''}`;
}

function acraForeignCompanyDeadlineApplication(query: string): string | undefined {
  if (!/\b(?:registered in Singapore as (?:a )?foreign compan(?:y|ies)|we are (?:an? )?(?:overseas[- ]incorporated )?foreign compan(?:y|ies)|(?:our|the) compan(?:y|ies) (?:is|are) (?:an? )?foreign compan(?:y|ies))\b/i.test(query) ||
      /\b(?:not|never|isn't|aren't|not sure|unclear|whether|maybe|possibly)\b[^.!?;]{0,60}\bforeign compan(?:y|ies)\b/i.test(query)) return undefined;
  const dayCountPattern = String.raw`(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty[- ]one|twenty[- ]two|twenty[- ]three|twenty[- ]four|twenty[- ]five|twenty[- ]six|twenty[- ]seven|twenty[- ]eight|twenty[- ]nine|twenty|thirty)`;
  const parseElapsedDays = (clause: string): { days: number; index: number } | undefined => {
    const match = new RegExp(String.raw`\b${dayCountPattern}\s+days?\s+ago\b`, 'i').exec(clause);
    if (!match) return undefined;
    const before = clause.slice(0, match.index);
    if (/\b(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[ -]$/i.test(before) ||
        /\b(?:one|two|three|four|five|six|seven|eight|nine) hundred(?: and)?[ -]$/i.test(before)) return undefined;
    const elapsed = match[1];
    const words: Record<string, number> = {
      one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
      ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
      seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, 'twenty-one': 21, 'twenty one': 21,
      'twenty-two': 22, 'twenty two': 22, 'twenty-three': 23, 'twenty three': 23,
      'twenty-four': 24, 'twenty four': 24, 'twenty-five': 25, 'twenty five': 25,
      'twenty-six': 26, 'twenty six': 26, 'twenty-seven': 27, 'twenty seven': 27,
      'twenty-eight': 28, 'twenty eight': 28, 'twenty-nine': 29, 'twenty nine': 29, thirty: 30
    };
    const days = /^\d+$/.test(elapsed) ? Number(elapsed) : words[elapsed.toLowerCase()];
    return Number.isInteger(days) ? { days, index: match.index } : undefined;
  };
  const changeClause = query.split(/[.!?;]+/).find(clause =>
    /\b(?:change\w*|updat\w*)\b/i.test(clause) &&
    /\b(?:registered office|entity email|business email|company email|business activities|entity information|registered address|office address)\b/i.test(clause) &&
    parseElapsedDays(clause) !== undefined);
  if (!changeClause) return undefined;
  const elapsed = parseElapsedDays(changeClause);
  if (!elapsed || elapsed.days > 30) return undefined;
  const beforeElapsed = changeClause.slice(0, elapsed.index);
  const lastChange = [...beforeElapsed.matchAll(/\b(?:change\w*|updat\w*)\b/gi)].at(-1);
  if (!lastChange || /\b(?:resign\w*|quit\w*|terminat\w*|dismiss\w*|paid|paying|contribut\w*|discover\w*|found|submitted|filed|joined|left)\b/i.test(beforeElapsed.slice(lastChange.index! + lastChange[0].length))) return undefined;
  return `On the stated facts, ${elapsed.days} days is within the foreign-company 30-day period, so the company is not yet late. Notify ACRA within that period.`;
}

function irasRecordRetentionApplication(query: string): string | undefined {
  const ya = /\b(?:YA|Year of Assessment)\s*(20\d{2})\b/i.exec(query)?.[1];
  if (!ya) return undefined;
  const endYear = Number(ya) + 4;
  if (!Number.isSafeInteger(endYear) || endYear < 2000 || endYear > 9999) return undefined;
  const disposal = /\b(?:shred|destroy|discard|dispose of)\w*\b[^.!?;\n]{0,80}?\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/i.exec(query);
  let application = `For YA ${ya}, retain the records through at least 31 December ${endYear}.`;
  if (disposal) {
    const day = Number(disposal[1]), month = Number(disposal[2]), year = Number(disposal[3]);
    const proposed = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isFinite(proposed.getTime()) || proposed.getUTCFullYear() !== year || proposed.getUTCMonth() !== month - 1 || proposed.getUTCDate() !== day) return undefined;
    const limit = new Date(Date.UTC(endYear, 11, 31));
    if (proposed <= limit) application += ` The proposed disposal date ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year} is before the end of that period, so do not shred the records then.`;
  }
  if (/\b(?:tax return|return)\b[^.!?;]{0,50}\b(?:filed|filing|submitted|completed)\b|\b(?:filed|filing|submitted|completed)\b[^.!?;]{0,50}\b(?:tax return|return)\b/i.test(query)) {
    application += ' Filing the tax return does not end the retention period.';
  }
  return application;
}

function cpfRefundDateApplication(query: string): string | undefined {
  const datePattern = String.raw`(\d{1,2}[/-]\d{1,2}[/-]20\d{2}|20\d{2}-\d{2}-\d{2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+20\d{2})`;
  const conditional = /\b(?:conditional wages?|conditional bonus|joining bonus|repayable (?:wages?|bonus)|bonus[^.!?;\n]{0,60}\b(?:repayable|repayment)|(?:repayable|repayment)[^.!?;\n]{0,60}\bbonus|bonus subject to repayment|wages? subject to repayment)\b/i.test(query);
  let suppliedDate: string | undefined;
  if (conditional) {
    const contractualDueDate = new RegExp(String.raw`(?:\bunder (?:the )?employment terms\b[^.!?;\n]{0,100}\b(?:had|has|have|was|were) to repay\b[^.!?;\n]{0,100}\bon\s+${datePattern}|\b(?:contractual|mutually agreed|agreed) repayment due date\b[^.!?;\n]{0,40}\b(?:is|was|of|:)?\s*${datePattern}|\b(?:employment terms|employment agreement|mutual agreement)\b[^.!?;\n]{0,100}\b(?:repayment|repay\w*|wages? due to be repaid)\b[^.!?;\n]{0,60}\b(?:due on|due date (?:is|as)|on)\s+${datePattern})`, 'gi');
    const dueDates = [...query.matchAll(contractualDueDate)].map(match => match[1] || match[2] || match[3]);
    if (dueDates.length !== 1) return undefined;
    suppliedDate = dueDates[0];
  } else {
    suppliedDate = new RegExp(String.raw`\bPAYMENTS RECEIVED ON\b\s*:?\s*${datePattern}`, 'i').exec(query)?.[1];
  }
  if (!suppliedDate) return undefined;
  const suppliedIso = strictSuppliedDateIso(suppliedDate);
  if (!suppliedIso) return undefined;
  const resolved = defaultTargetDateResolver.resolveTargetDate(suppliedDate);
  if (!resolved.targetDate || resolved.confidence !== 'HIGH' || resolved.targetDate !== suppliedIso) return undefined;
  const original = new Date(`${resolved.targetDate}T00:00:00Z`);
  if (!Number.isFinite(original.getTime()) || original.toISOString().slice(0, 10) !== resolved.targetDate ||
      resolved.targetDate.slice(5, 7) === '02' && resolved.targetDate.slice(8, 10) === '29') return undefined;
  const deadline = new Date(`${resolved.targetDate}T00:00:00Z`);
  deadline.setUTCFullYear(deadline.getUTCFullYear() + 1);
  if (!Number.isFinite(deadline.getTime())) return undefined;
  const deadlineIso = deadline.toISOString().slice(0, 10);
  if (new Date(`${deadlineIso}T00:00:00Z`).toISOString().slice(0, 10) !== deadlineIso) return undefined;
  const formatDate = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  return conditional
    ? `For the supplied conditional-wage repayment due date of ${formatDate(resolved.targetDate)}, the one-year outer limit is ${formatDate(deadlineIso)}.`
    : `The payment record’s “PAYMENTS RECEIVED ON” date is ${formatDate(resolved.targetDate)}, making the one-year outer limit ${formatDate(deadlineIso)}; discovery of the error does not restart that period.`;
}

function strictSuppliedDateIso(value: string): string | undefined {
  let year: number, month: number, day: number;
  let match = /^(\d{1,2})[/-](\d{1,2})[/-](20\d{2})$/.exec(value);
  if (match) [, day, month, year] = match.map(Number);
  else if ((match = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(value))) {
    [, year, month, day] = match.map(Number);
  } else if ((match = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(20\d{2})$/i.exec(value))) {
    const monthNumber = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
      .indexOf(match[2].slice(0, 3).toLowerCase()) + 1;
    day = Number(match[1]);
    year = Number(match[3]);
    month = monthNumber;
  } else return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Renders a general explanation only from exact-URL, issue-bound quotes in one verified document revision. */
export function getStatutoryWorkflowEvidence(
  query: string,
  stream: AuthorityPresentedWorkstream,
  issue: AuthorityPresentedIssue
): { authority: Rule['authority']; title: string; officialUrl: string; text: string } | undefined {
  const rule = STATUTORY_WORKFLOW_RULES_20261029.find(candidate => candidate.authority === stream.authority
    && candidate.queryPattern.test(query) && candidate.subjectPattern.test(issue.subject));
  if (!rule || !scopeAllowsCurrentRule(query)) return undefined;
  const domainsByAuthority: Record<Rule['authority'], readonly string[]> = {
    ACRA: ['ACRA_CORPORATE'], IRAS: ['IRAS_CORPORATE_TAX'], CPF: ['CPF_PAYROLL', 'CPF_CONTRIBUTIONS'],
    MOM: ['MOM_EMPLOYMENT'], MAS: ['MAS_FUNDS']
  };
  const populationsByAuthority: Record<Rule['authority'], readonly string[]> = {
    ACRA: ['Company', 'COMPANY'], IRAS: ['Company', 'COMPANY'], CPF: ['Employer', 'EMPLOYER'],
    MOM: ['Employer', 'EMPLOYER', 'Employee', 'EMPLOYEE'], MAS: ['Company', 'COMPANY']
  };
  if (!domainsByAuthority[rule.authority].includes(stream.domain) || !populationsByAuthority[rule.authority].includes(issue.population)
      || !['NOT_REQUIRED', 'UNRESOLVED'].includes(issue.applicationStatus) || issue.evidenceStatus !== 'VERIFIED'
      || !['EXPLAIN_RULE', 'CHECK_ELIGIBILITY', 'FILING_REQUIREMENT'].includes(issue.operation)
      || !stream.issues.some(candidate => candidate.id === issue.id && candidate.evidenceStatus === 'VERIFIED')) return undefined;
  const source = stream.sources.find(candidate => sourceFor(rule, candidate, issue.id));
  if (!source) return undefined;
  const text = answerText(rule, query);
  const dateApplication = rule.id === 'CPF_CONTRIBUTION_REFUND_DEADLINES' ? cpfRefundDateApplication(query) : undefined;
  return { authority: rule.authority, title: source.title || rule.title, officialUrl: rule.officialUrl,
    text: dateApplication ? `${text} ${dateApplication}` : text };
}
