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
  | 'ACRA_REGISTERED_OFFICE_REQUIREMENTS'
  | 'IRAS_COMPANY_TAX_RECORD_RETENTION'
  | 'IRAS_COMPANY_APPROVED_DONATIONS'
  | 'CPF_CONTRIBUTION_REFUND_DEADLINES'
  | 'CPF_CONTRIBUTION_RECORD_RECTIFICATIONS'
  | 'MOM_ITEMISED_PAYSLIP_REQUIREMENTS'
  | 'MAS_LFMC_KEY_APPOINTMENTS'
  | 'MAS_VCFM_CHANGE_NOTIFICATIONS'
  | 'MAS_VCFM_BUSINESS_CESSATION';

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
const CPF_RECTIFICATIONS_URL = 'https://www.cpf.gov.sg/employer/compliance-and-rectifications';
const IRAS_DONATIONS_URL = 'https://www.iras.gov.sg/taxes/corporate-income-tax/income-deductions-for-companies/business-expenses/tax-treatment-of-business-expenses-(a-f)';
const ACRA_REGISTERED_OFFICE_URL = 'https://www.acra.gov.sg/register/business/registering-different-business-structures/local-company/registering-via-bizfile/';
const MOM_PAYSLIPS_URL = 'https://www.mom.gov.sg/employment-practices/salary/itemised-payslips';
const MAS_LFMC_TOOLKIT_URL = 'https://www.mas.gov.sg/-/media/mas-media-library/regulation/guidance/cmi/compliance-toolkits-for-fund-management-companies/sfa-compliance-toolkit-lfmcs29-may-2026-clean.pdf';
const MAS_VCFM_TOOLKIT_URL = 'https://www.mas.gov.sg/-/media/mas-media-library/regulation/guidance/cmi/compliance-toolkits-for-fund-management-companies/sfa-compliance-toolkit--vcfms29-may-2026-clean.pdf';

/**
 * Source-backed workflow guidance for bounded statutory procedures and conditions.
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
    queryPattern: /\b(?:entity information|registered entities?|registered office|entity email|business email|company email|email address|business activities)\b[^.!?;\n]{0,160}\b(?:chang\w*|updat\w*|notif\w*|deadline)\b|\b(?:chang\w*|updat\w*|notif\w*|deadline)\b[^.!?;\n]{0,160}\b(?:entity information|registered entities?|registered office|entity email|business email|company email|email address|business activities)\b/i,
    subjectPattern: /^(?!.*\b(?:office access|access hours|public access|office hours|registered office requirements|registered office location|records and notices)\b)(?=.*\b(?:entity information|registered entity|registered office|entity email|email address|business activities|entity update|change of entity information|notification deadline)\b)/i
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
    queryPattern: /\b(?:corporate tax|company tax|income tax|business records?|accounting records?|source documents?|bank statements?|invoices?|books and papers|record[- ]keeping|records? retention|record custod(?:y|ian)|dissolv\w*|struck off|wound up|keep (?:our|the|company) records?)\b/i,
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
    subjectPattern: /^(?!.*\b(?:rectif\w*|wrong wages?|underpaid|underpayment|contribution records?|adjustment)\b)(?=.*\b(?:cpf|contribution|refund|repayment)\b)/i
  },
  {
    id: 'MOM_ITEMISED_PAYSLIP_REQUIREMENTS', authority: 'MOM', topicIds: ['mom-itemised-payslips'],
    officialUrl: MOM_PAYSLIPS_URL, title: 'Itemised pay slips', fixtureFile: 'mom-payslips.html',
    fixtureKind: 'RETAINED_NATIVE_OFFICIAL_HTML',
    population: 'Employees covered by the Employment Act and their employers',
    provisions: ['Employment Act coverage as stated by MOM. No section number is added from the captured page.'],
    rule: 'Employers must issue itemised pay slips to employees covered by the Employment Act together with payment. If that is not possible, the pay slip must be given within three working days of payment. For termination or dismissal, it must be given together with outstanding salary. MOM allows a soft or hard copy, including handwritten. The pay slip must include the employer and employee names, payment date, basic salary, salary period, applicable allowances, other payments, deductions and total net salary; overtime hours, pay and period are included where applicable. If payments are made more than once a month, pay slips may be consolidated, but the consolidated slip must show all payments since the last slip. Employers must retain issued pay slips: the latest two years for current employees, and the last two years for ex-employees for one year after they leave.',
    conditions: ['The requirements apply to employees covered by the Employment Act.', 'Only applicable pay slip items need to be shown; overtime items 9 to 11 need not be included when overtime pay does not apply.', 'The fallback is three working days after payment only when the employer cannot give the pay slip with payment.', 'Consolidation is permitted for multiple monthly payments, but must include every payment since the previous slip.'],
    exceptions: ['Items that do not apply need not be shown; MOM’s page gives overtime items as an example.', 'This rule does not calculate final-salary deadlines or determine Employment Act coverage for a particular worker.'],
    requiredFacts: ['Employment Act coverage.', 'Salary period, payment date and pay components applicable to the employee.', 'Whether pay slips are consolidated, whether overtime applies, current or former employee status, and the employee’s departure date if applicable.'],
    effectiveDateEvidence: 'The page states that the itemised-payslip duty begins on 1 April 2016. This does not establish that every detailed condition in the current page applied unchanged from that date.',
    limitations: ['Three working days are not converted into calendar days.', 'The captured page does not establish current coverage of a particular worker or calculate a case-specific final salary.'],
    requiredSourceTerms: [
      'From 1 April 2016, all employers must issue itemised pay slips to employees covered by the Employment Act.',
      'Employers must issue itemised pay slips to all employees covered by the Employment Act.',
      'Pay slips must include the items below, unless an item is not applicable.',
      'if overtime pay does not apply to you, your pay slip need not include items 9 to 11',
      'Give together with payment to employee.',
      'If unable to give together, to be given within three working days of payment.',
      'In the case of termination or dismissal, must give pay slip together with outstanding salary.',
      'Format | Soft or hard copy (including handwritten)',
      'If payments are made more than once a month, employers can consolidate pay slips.',
      'The consolidated pay slip must contain details of all payments made since the last pay slip.',
      'Full name of employer.', 'Full name of employee.', 'Basic salary', 'Start and end date of salary period.',
      'Allowances paid for salary period', 'Any other additional payment for each salary period',
      'Deductions made for each salary period', 'Net salary paid in total.',
      'Employers must keep a record of all pay slips issued.', 'For current employees: Latest two years.',
      'For ex-employees: Last two years, to be kept for one year after the employee leaves employment.'
    ],
    quoteMatchers: [
      /From 1 April 2016, all employers must issue itemised pay slips to employees covered by the Employment Act\./i,
      /Employers must issue itemised pay slips to all employees covered by the Employment Act\./i,
      /Pay slips must include the items below, unless an item is not applicable\.[\s\S]{0,200}if overtime pay does not apply to you, your pay slip need not include items 9 to 11\./i,
      /Give together with payment to employee\.[\s\S]{0,200}If unable to give together, to be given within three working days of payment\./i,
      /In the case of termination or dismissal, must give pay slip together with outstanding salary\./i,
      /Format\s*\|\s*Soft or hard copy \(including handwritten\)/i,
      /If payments are made more than once a month, employers can consolidate pay slips\.[\s\S]{0,220}The consolidated pay slip must contain details of all payments made since the last pay slip\./i,
      /Items to include[\s\S]{0,2400}Full name of employer\.[\s\S]{0,240}Full name of employee\.[\s\S]{0,2200}Net salary paid in total\./i,
      /Employers must keep a record of all pay slips issued\.[\s\S]{0,250}For current employees:\s*Latest two years\.[\s\S]{0,250}For ex-employees:\s*Last two years, to be kept for one year after the employee leaves employment\./i
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
  },
  {
    id: 'IRAS_COMPANY_APPROVED_DONATIONS', authority: 'IRAS', topicIds: ['iras-cit-donations'],
    officialUrl: IRAS_DONATIONS_URL, title: 'Tax Treatment of Business Expenses (A-F)',
    fixtureFile: 'iras-donations-native.html', fixtureKind: 'RETAINED_NATIVE_OFFICIAL_HTML',
    population: 'Companies computing Singapore corporate income tax',
    provisions: ['IRAS corporate income tax business-expense guidance; the cited page does not identify a statutory section number.'],
    rule: 'Donations are non-deductible expenses in arriving at adjusted profit. For donations made from 1 January 2016 through 31 December 2029, a company may claim a deduction of 2.5 times the amount donated to an approved Institution of a Public Character (IPC) or the Singapore Government to benefit the local community. The company must provide its UEN to the approved IPC. IRAS says approved donation amounts are pre-filled in Form C-S, Form C-S (Lite) or Form C based on information obtained from IPCs. In the tax computation, add back all donations, then deduct 2.5 times approved donations; the deduction is on a preceding-financial-year basis.',
    conditions: ['The 2.5-times deduction applies to donations made from 1 January 2016 through 31 December 2029 under the captured current guidance.', 'The donee must be an approved IPC or the Singapore Government, and a Government donation must benefit the local community.', 'For an IPC donation, the company must provide its UEN to the IPC to receive the deduction.', 'Approved donations are considered on a preceding-financial-year basis.'],
    exceptions: ['Donations outside the approved-donation category remain non-deductible business expenses under this cited rule.', 'This record does not cover individual income-tax donations, other incentive schemes, tax-exemption computation, or whether a named donee is currently approved.'],
    requiredFacts: ['Donation date and financial year.', 'Donee identity and current approved-IPC status, or whether a Singapore Government donation benefits the local community.', 'Donation amount and the amount recorded by IRAS; whether the company provided its UEN to the IPC.'],
    effectiveDateEvidence: 'The captured IRAS page states the 2.5-times relief applies to donations made 1 January 2016 through 31 December 2029 and says the end date was extended in Budget 2026. The page does not establish the rule before 2016 or after 2029.',
    limitations: ['This guidance does not calculate the company’s adjusted profit, chargeable income or tax deduction amount.', 'Confirm that the donee and donation are eligible and reconcile the amount with the applicable YA before filing.'],
    requiredSourceTerms: [
      'Donations are non-deductible expenses as they are not incurred in the production of income.',
      'donations made from 1 Jan 2016 to 31 Dec 2029', 'tax deduction of 2.5 times the amount donated',
      'approved Institution of a Public Character (IPC) or the Singapore Government to benefit the local community',
      'required to provide its Unique Entity Number (UEN) to the approved IPC',
      'approved donation amounts will be pre-filled in the Form C-S/ Form C-S (Lite)/ Form C',
      'Add back all donations made (approved donations or otherwise)',
      'Claim a tax deduction of 2.5 times the amount of approved donations.',
      'Tax deduction on approved donations is allowable on a preceding financial year basis.'
    ],
    quoteMatchers: [
      /Donations\s+Donations are non-deductible expenses as they are not incurred in the production of income\.[\s\S]{0,700}donations made from 1 Jan 2016 to 31 Dec 2029[\s\S]{0,600}approved Institution of a Public Character \(IPC\) or the Singapore Government to benefit the local community/i,
      /Your company is required to provide its Unique Entity Number \(UEN\) to the approved IPC[\s\S]{0,450}approved donation amounts will be pre-filled in the Form C-S\/ Form C-S \(Lite\)\/ Form C/i,
      /Step 1: Add back all donations made \(approved donations or otherwise\)[\s\S]{0,500}Step 2: Claim a tax deduction of 2\.5 times the amount of approved donations\.[\s\S]{0,250}preceding financial year basis/i
    ],
    contradictionPatterns: [
      /all donations (?:are|remain) deductible/i,
      /approved donations[^.!?\n]{0,160}\b(?:1\.5|three) times\b/i,
      /the 2\.5 times deduction[^.!?\n]{0,140}\b(?:after|beyond) 31 Dec 2029\b/i
    ],
    queryPattern: /\b(?:donat\w*|give|gave|giving|gift)\b[\s\S]{0,180}\b(?:corporate income tax|company tax|tax computation|tax deduction|Form C-S|Form C|approved IPC|Singapore Government|IPC|UEN|deduct\w*)\b|\b(?:corporate income tax|company tax|tax computation|tax deduction)\b[\s\S]{0,180}\b(?:donat\w*|give|gave|giving|gift|approved IPC|IPC)\b/i,
    subjectPattern: /\b(?:corporate income tax|company tax|tax computation|donation|approved IPC)\b/i
  },
  {
    id: 'CPF_CONTRIBUTION_RECORD_RECTIFICATIONS', authority: 'CPF', topicIds: ['cpf-record-rectifications'],
    officialUrl: CPF_RECTIFICATIONS_URL, title: 'Compliance and rectifications',
    fixtureFile: 'cpf-rectifications-native.html', fixtureKind: 'RETAINED_NATIVE_OFFICIAL_HTML',
    population: 'Employers correcting CPF contribution or wage records for employees',
    provisions: ['CPF Board employer compliance and rectification guidance; the cited page does not assign statutory section numbers to the listed application choices.'],
    rule: 'Rectification depends on the error. Employers must rectify omitted or underpaid CPF contributions immediately, using the usual monthly contribution submission for arrears; delay can increase late-payment interest. If wages were declared incorrectly, inform CPF Board and ensure future submissions are accurate. For overpaid contributions, apply for a refund or adjustment. A refund returns excess money, while an adjustment changes the contribution record; CPF Board lists changing the contribution month or year, CPF Submission Number, or payment recipient as adjustment examples.',
    conditions: ['Underpayment or omitted contributions are rectified immediately through the normal monthly submission process.', 'Incorrect declared wages should be reported to CPF Board; future submissions must be accurate.', 'For overpayment, choose refund when seeking excess money back or adjustment when correcting the contribution record.'],
    exceptions: ['This procedure guide does not determine the correct wage classification, contribution rate, or amount owed in a particular payroll case.', 'Overpaid contribution refunds remain subject to the separate refund process and its conditions.'],
    requiredFacts: ['What was wrong: contribution amount, wages declared, contribution month/year, CSN or recipient.', 'The affected employee, correct wage and contribution period, payment details, and whether money should be returned or only the record changed.'],
    effectiveDateEvidence: 'The captured compliance page was last updated 4 November 2025 but states no separate legal commencement date. The capture and update dates do not establish historical application.',
    limitations: ['No contribution amount, refund deadline, or case acceptance is calculated by this general rectification rule.', 'Use the current application route for the employer type and error category.'],
    requiredSourceTerms: [
      'You will need to rectify any omission or underpayment of CPF contributions immediately.',
      'submit these CPF contribution arrears in the same way that you submit your monthly CPF contribution submissions',
      'higher late payment interest on the outstanding CPF contributions',
      'If you have overpaid CPF contributions for your employee(s), you can apply for a refund/an adjustment.',
      'If you have declared wages incorrectly, you should inform the CPF Board and ensure that wages are accurately declared in future CPF submissions.',
      'You can apply for a refund if you are seeking a return of the monies paid in excess or in error to your employees.',
      'You can apply for an adjustment if you want to change the contributions record.',
      'changing of contributions month and year, CPF Submission Number (CSN) or payment recipient'
    ],
    quoteMatchers: [
      /You will need to rectify any omission or underpayment of CPF contributions immediately\.[\s\S]{0,500}submit these CPF contribution arrears in the same way that you submit your monthly CPF contribution submissions[\s\S]{0,500}higher late payment interest on the outstanding CPF contributions\./i,
      /If you have overpaid CPF contributions for your employee\(s\), you can apply for a refund\/an adjustment\./i,
      /If you have declared wages incorrectly, you should inform the CPF Board and ensure that wages are accurately declared in future CPF submissions\./i,
      /You can apply for a refund if you are seeking a return of the monies paid in excess or in error to your employees\.[\s\S]{0,700}You can apply for an adjustment if you want to change the contributions record\.[\s\S]{0,400}changing of contributions month and year, CPF Submission Number \(CSN\) or payment recipient/i
    ],
    contradictionPatterns: [
      /underpaid CPF contributions[^.!?\n]{0,160}\b(?:may wait|can wait|only after a refund)\b/i,
      /wrong wages declared[^.!?\n]{0,180}\b(?:no need to inform|do not need to inform)\b/i,
      /adjustment of contributions paid[^.!?\n]{0,180}\b(?:returns?|refunds?) the money to the employer/i
    ],
    queryPattern: /\b(?:cpf|central provident fund)\b[\s\S]{0,180}\b(?:rectif\w*|wrong wages?|wages? declared incorrectly|underpaid|underpayment|overpaid|overpayment|adjust(?:ment)? the record|contribution record)\b|\b(?:rectif\w*|wrong wages?|wages? declared incorrectly|underpaid|underpayment|overpaid|overpayment|adjust(?:ment)? the record|contribution record)\b[\s\S]{0,180}\b(?:cpf|central provident fund)\b/i,
    subjectPattern: /\b(?:CPF|contribution)\b[\s\S]{0,100}\b(?:rectif\w*|wage records?|overpayment|underpayment|adjustment)\b/i
  },
  {
    id: 'ACRA_REGISTERED_OFFICE_REQUIREMENTS', authority: 'ACRA', topicIds: ['acra_registered-office'],
    officialUrl: ACRA_REGISTERED_OFFICE_URL, title: 'Registering a local company via Bizfile',
    fixtureFile: 'acra-registered-office-native.html', fixtureKind: 'RETAINED_NATIVE_OFFICIAL_HTML',
    population: 'Local companies registering with ACRA via Bizfile',
    provisions: ['ACRA local-company registration guidance; the cited page does not identify a Companies Act section for these particulars.'],
    rule: 'For a local company, the registered office is the official Singapore address where ACRA and others can send communications and notices and where company records and registers are kept. It must be open to the public for at least three hours on each business day and open and accessible during normal business hours on each business day. It need not be the place where the company carries on its business activities.',
    conditions: ['The page is guidance for local-company registration via Bizfile.', 'The source states both a minimum of three public-access hours each business day and public access during normal business hours.', 'The registered office may differ from the place where business is carried on.'],
    exceptions: ['This source does not establish registered-office requirements for foreign companies, LLPs, VCCs or other entity types.'],
    requiredFacts: ['Entity type and whether it is a local company.', 'The proposed Singapore address, public-access hours on business days, and where company records and registers will be kept.'],
    effectiveDateEvidence: 'The captured registration guide does not state a legal commencement date. Its retrieval date is not treated as an effective date.',
    limitations: ['This is ACRA guidance for local-company registration; it does not establish every ongoing filing duty or requirements for other entity classes.', 'A specific address conclusion requires the entity type, address and access arrangements.'],
    requiredSourceTerms: [
      'Office hours', 'Must be open to the public for at least three hours on each business day.',
      'Registered office address', 'ACRA and others can send communications and notices to your company.',
      'You must keep your company records and registers.', 'Must be a Singapore address.',
      'Must be open and accessible to the public during normal business hours on each business day.',
      'Does not have to be the same place where you run your business activities.'
    ],
    quoteMatchers: [
      /Office hours\s+Must be open to the public for at least three hours on each business day\.[\s\S]{0,180}public access and delivery of legal papers\./i,
      /Registered office address[\s\S]{0,850}Must be a Singapore address\.[\s\S]{0,240}Must be open and accessible to the public during normal business hours on each business day\.[\s\S]{0,250}Does not have to be the same place where you run your business activities\./i
    ],
    contradictionPatterns: [
      /registered office address[^.!?\n]{0,180}\b(?:need not|does not need to|not required to) be accessible\b/i,
      /registered office[^.!?\n]{0,180}\b(?:must|has to) be (?:the )?same (?:place|address) where (?:the )?business operates/i,
      /registered office[^.!?\n]{0,180}\b(?:foreign companies|LLPs|VCCs)\b/i
    ],
    queryPattern: /\b(?:registered office|office hours)\b[\s\S]{0,180}\b(?:access\w*|Singapore address|public|three hours|business hours|records|registers|same place|location|requirements?)\b|\b(?:access\w*|Singapore address|public|three hours|business hours|records|registers|requirements?)\b[\s\S]{0,180}\bregistered office\b/i,
    subjectPattern: /^(?=.*\b(?:ACRA|local compan\w*|registered office|office hours)\b)(?=.*\b(?:access|requirements?|location|records?|notices|public)\b)/i
  },
  {
    id: 'MAS_VCFM_CHANGE_NOTIFICATIONS', authority: 'MAS', topicIds: ['mas-vcfm-change-notifications'],
    officialUrl: MAS_VCFM_TOOLKIT_URL, title: 'Compliance Toolkit for Venture Capital Fund Managers',
    fixtureFile: 'mas-vcfm-toolkit.pdf', fixtureKind: 'RETAINED_NATIVE_OFFICIAL_PDF',
    population: 'Venture Capital Fund Managers (VCFMs)',
    provisions: ['MAS VCFM Compliance Toolkit row 11, identified as a licence condition. The row does not cite a separate statutory section.'],
    rule: 'A VCFM must notify MAS using Form 23A within 14 days from the date of a change to particulars of the VCFM, including its name, principal place of business, contact details, shareholdings or organisational chart, or particulars of its CEO, directors or shareholders, including resignations and appointments.',
    conditions: ['This notification is for VCFMs and covers the particulars listed in row 11.', 'The toolkit states a 14-day period from the change; it does not say that the period is 14 working days.', 'Form 23A is a notification; this row does not state that it replaces any separate prior-approval requirement.'],
    exceptions: ['This row is not the LFMC Form 11 appointment rule and does not establish a duty for other CMS licence categories.', 'The toolkit revision/update date does not establish the historical legal commencement of this licence condition.'],
    requiredFacts: ['Confirm that the manager is a VCFM.', 'What particular changed, the person or entity affected, and the date of change.'],
    effectiveDateEvidence: 'The PDF marks row 11 as updated in December 2024 but does not state when the licence condition commenced. That update note is not used to answer historical-law questions.',
    limitations: ['The toolkit gives a bounded row 11 summary, not every VCFM reporting duty or a historical legal-version determination.', 'No date arithmetic is applied without an unambiguous change date.'],
    requiredSourceTerms: [
      '11 To notify MAS of any change in:', 'particulars of a VCFM', 'limited to change in name, principal',
      'particulars of its CEO, Directors, and', 'shareholders, including resignation and', 'appointments',
      'Form 23A', 'in Particulars for', 'Venture Capital', 'Fund Managers',
      'Within 14 days from the date', 'of change', 'Licence condition'
    ],
    quoteMatchers: [
      /\b11\s+(?:\|\s*)?To notify MAS of any change in:[\s\S]{0,2500}?(?=\b12\s+(?:\|\s*)?To notify MAS on suspension|$)/i
    ],
    contradictionPatterns: [
      /Form 23A[^.!?\n]{0,180}\b(?:prior approval|before the change)\b/i,
      /within 14 working days from the date of change/i,
      /VCFM particulars[^.!?\n]{0,180}\bno notification required\b/i
    ],
    queryPattern: /\b(?:VCFM|venture capital fund manager)\b[\s\S]{0,220}\b(?:Form\s*23A|change in particulars|particulars|change of (?:name|contact|shareholding)|resign\w*|appoint\w*)\b|\b(?:Form\s*23A|change in particulars)\b[\s\S]{0,220}\b(?:VCFM|venture capital fund manager)\b/i,
    subjectPattern: /\b(?:VCFM|venture capital fund manager|Form\s*23A|change in particulars)\b/i
  },
  {
    id: 'MAS_VCFM_BUSINESS_CESSATION', authority: 'MAS', topicIds: ['mas-vcfm-business-cessation'],
    officialUrl: MAS_VCFM_TOOLKIT_URL, title: 'Compliance Toolkit for Venture Capital Fund Managers',
    fixtureFile: 'mas-vcfm-toolkit.pdf', fixtureKind: 'RETAINED_NATIVE_OFFICIAL_PDF',
    population: 'Venture Capital Fund Managers (VCFMs)',
    provisions: ['MAS VCFM Compliance Toolkit row 6, which cites section 93 of the Securities and Futures Act and regulation 11 of the Securities and Futures (Licensing and Conduct of Business) Regulations.'],
    rule: 'A VCFM must submit Form 7, Notice of Cessation of Business, if it ceases to carry on any or all regulated activities. For cessation, the toolkit says to notify MAS within 14 days after the cessation and accompany Form 7 with an audit certification, in no prescribed format, that the VCFM has fully discharged all customer obligations. A VCFM that has not commenced any or all regulated activities by the end of six months from the CMS licence grant must submit Form 7 immediately after that six-month period ends.',
    conditions: ['The cessation deadline applies to cessation of any or all regulated activities.', 'The non-commencement rule applies when any or all regulated activities have not commenced by the end of six months from the licence grant.', 'Form 7 cessation filing includes the stated audit certification of discharged customer obligations.'],
    exceptions: ['This is a VCFM notification in the toolkit; it does not say that Form 7 is a prior-approval application.', 'The toolkit does not establish the same process for an LFMC or another CMS licence category.'],
    requiredFacts: ['Confirm the licence holder is a VCFM.', 'Whether the event is cessation or non-commencement, the regulated activity affected, and the cessation date or CMS licence grant date.', 'For cessation, whether the required customer-obligations audit certification is available.'],
    effectiveDateEvidence: 'The captured PDF identifies row 6 and its cited SFA/LCBR references but does not establish a historical effective date. The PDF revision date is not used as the legal commencement date.',
    limitations: ['Do not calculate the non-commencement date without the CMS licence grant date or convert “immediately” into an invented day count.', 'This bounded rule does not cover other VCFM notifications, winding-up duties or client-specific cessation consequences.'],
    requiredSourceTerms: [
      '6 To notify MAS where a VCFM:', 'ceases to carry on business in any or all', 'regulated activities',
      'has not commenced business in any or', 'all regulated activities by the end of the',
      'period of 6 months from the date of the', 'grant of the licence',
      'Form 7', 'audit', 'certification', 'fully discharged all', 'customer obligations',
      'within 14 days after the', 'cessation of any or all', 'immediately after the end of',
      '6 months from the date of', 'the grant of the CMS licence',
      'Section 93 of the SFA', 'and Regulation 11 of', 'the LCBR'
    ],
    quoteMatchers: [
      /\b6\s+(?:\|\s*)?To notify MAS where a VCFM:[\s\S]{0,3500}?(?=\b7\s+(?:\|\s*)?To notify MAS of any matter|$)/i
    ],
    contradictionPatterns: [
      /VCFM cessation[^.!?\n]{0,180}\b(?:prior approval|before cessation)\b/i,
      /non.commencement[^.!?\n]{0,180}\bwithin 14 days after the cessation\b/i,
      /Form 7[^.!?\n]{0,200}\bno audit certification\b/i
    ],
    queryPattern: /\b(?:VCFM|venture capital fund manager)\b[\s\S]{0,220}\b(?:Form\s*7|cessation|ceases? to carry|not commenced|non.commencement|six months|6 months)\b|\b(?:Form\s*7|cessation|non.commencement)\b[\s\S]{0,220}\b(?:VCFM|venture capital fund manager)\b/i,
    subjectPattern: /\b(?:VCFM|venture capital fund manager|Form\s*7|cessation|non.commencement)\b/i
  }
]);

export const STATUTORY_WORKFLOW_RULES_METADATA_20261029: readonly StatutoryWorkflowRule[] = STATUTORY_WORKFLOW_RULES_20261029;

function recognizeRule(input: Pick<StatutoryWorkflowRequest, 'authority' | 'topicId' | 'query' | 'subject'>): Rule | undefined {
  return STATUTORY_WORKFLOW_RULES_20261029.find(rule => rule.authority === input.authority
    && rule.topicIds.includes(input.topicId) && rule.queryPattern.test(input.query) && rule.subjectPattern.test(input.subject));
}

function cleanedSource(sourceText: string): string {
  if (!/<(?:!doctype|html|head|body|main|article|section|div|p|table|tr|td|li|h[1-6])\b/i.test(sourceText)) {
    return sourceText.replace(/\r/g, '').replace(/[\t ]+/g, ' ').replace(/ +\n/g, '\n').trim();
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
  const source = cleanedSource(sourceText);
  // PDF cells are interleaved by line. Require every premise inside the
  // numbered row, so another row cannot supply a missing form or deadline.
  const rowScoped = rule.id === 'MAS_VCFM_CHANGE_NOTIFICATIONS' || rule.id === 'MAS_VCFM_BUSINESS_CESSATION';
  const clean = normalizedSourceTerms(rowScoped ? rule.quoteMatchers[0].exec(source)?.[0] || '' : source);
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
  const changeClauses = query.split(/[.!?;]+/).filter(clause =>
    /\b(?:change\w*|updat\w*)\b/i.test(clause) &&
    /\b(?:registered office|entity email|business email|company email|business activities|entity information|registered address|office address)\b/i.test(clause) &&
    parseElapsedDays(clause) !== undefined);
  if (changeClauses.length !== 1) return undefined;
  const changeClause = changeClauses[0];
  // A single sentence may describe more than one separately timed change.
  // Without a date-to-change association, the oldest deadline cannot safely
  // be inferred from whichever date happens to appear first.
  if ([...query.matchAll(/\b(?:change\w*|updat\w*)\b/gi)].length > 1 ||
      [...changeClause.matchAll(new RegExp(String.raw`\b${dayCountPattern}\s+days?\s+ago\b`, 'gi'))].length > 1) return undefined;
  const elapsed = parseElapsedDays(changeClause);
  if (!elapsed || elapsed.days > 30) return undefined;
  const beforeElapsed = changeClause.slice(0, elapsed.index);
  const lastChange = [...beforeElapsed.matchAll(/\b(?:change\w*|updat\w*)\b/gi)].at(-1);
  if (!lastChange || /\b(?:resign\w*|quit\w*|terminat\w*|dismiss\w*|paid|paying|contribut\w*|discover\w*|found|submitted|filed|joined|left)\b/i.test(beforeElapsed.slice(lastChange.index! + lastChange[0].length))) return undefined;
  return `On the stated facts, ${elapsed.days} days is within the foreign-company 30-day period, so the company is not yet late. Notify ACRA within that period.`;
}

function irasRecordRetentionApplication(query: string): string | undefined {
  const yearsOfAssessment = [...new Set([...query.matchAll(/\b(?:YA|Year of Assessment)\s*(20\d{2})\b/gi)].map(match => match[1]))];
  if (yearsOfAssessment.length > 1) return undefined;
  const ya = yearsOfAssessment[0];
  const endYear = ya ? Number(ya) + 4 : undefined;
  if (endYear !== undefined && (!Number.isSafeInteger(endYear) || endYear < 2000 || endYear > 9999)) return undefined;

  const explicitDatePattern = String.raw`(?:\d{1,2}[/-]\d{1,2}[/-]20\d{2}|20\d{2}-\d{2}-\d{2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+20\d{2})`;
  const dissolutionDatePattern = new RegExp(String.raw`\b(?:dissolved|dissolution)\b\s*(?:(?:on|date\s*(?:is|was|of)?|was|is)\s*:?\s*)?(${explicitDatePattern})`, 'gi');
  const dissolutionDates = [...query.matchAll(dissolutionDatePattern)].map(match => match[1]);
  if (dissolutionDates.length > 1) return undefined;
  const dissolutionDate = dissolutionDates[0];
  const disposalDatePattern = new RegExp(String.raw`\b(?:shred\w*|destroy\w*|discard\w*|dispose of)\b[^0-9.!?;\n]{0,70}(${explicitDatePattern})`, 'gi');
  const disposalDates = [...query.matchAll(disposalDatePattern)].map(match => match[1]);
  if (disposalDates.length > 1) return undefined;

  const deadlines: Array<{ date: string; description: string }> = [];
  if (ya && endYear !== undefined) deadlines.push({ date: `${endYear}-12-31`, description: `the YA-based period for YA ${ya}` });
  if (dissolutionDate) {
    const dissolutionIso = strictSuppliedDateIso(dissolutionDate);
    if (!dissolutionIso || dissolutionIso.slice(5) === '02-29') return undefined;
    const dissolutionDeadline = new Date(`${dissolutionIso}T00:00:00Z`);
    dissolutionDeadline.setUTCFullYear(dissolutionDeadline.getUTCFullYear() + 5);
    if (!Number.isFinite(dissolutionDeadline.getTime())) return undefined;
    deadlines.push({ date: dissolutionDeadline.toISOString().slice(0, 10), description: `the five-year post-dissolution period from ${formatSingaporeDate(dissolutionIso)}` });
  }
  if (!deadlines.length) return undefined;
  const deadline = deadlines.reduce((latest, candidate) => candidate.date > latest.date ? candidate : latest);
  let application = deadlines.length > 1
    ? `The YA-based period for YA ${ya} ends on 31 December ${endYear}, and ${deadlines[1].description} ends on ${formatSingaporeDate(deadlines[1].date)}. Apply the later minimum and retain the records through at least ${formatSingaporeDate(deadline.date)}.`
    : ya
      ? `For YA ${ya}, retain the records through at least 31 December ${endYear}.`
      : `The dissolution-based period runs for at least five years, through ${formatSingaporeDate(deadline.date)}. The relevant YA is also needed to compare the ordinary YA-based retention period before concluding when the records may safely be destroyed.`;
  if (!dissolutionDate && /\b(?:dissolv\w*|struck off|wound up)\b/i.test(query)) {
    application += ' The dissolution date is not reliably stated, so the separate post-dissolution period cannot be compared; do not treat the YA-based period as sufficient for destruction.';
  }
  if (disposalDates.length === 1) {
    const proposedIso = strictSuppliedDateIso(disposalDates[0]);
    if (!proposedIso) return undefined;
    if (proposedIso <= deadline.date) {
      application += deadlines.length > 1
        ? ` The proposed disposal date ${formatSingaporeDate(proposedIso)} is before the later applicable period ends, so do not shred the records then.`
        : ` The proposed disposal date ${formatSingaporeDate(proposedIso)} is before the end of that period, so do not shred the records then.`;
    }
  }
  if (/\b(?:tax return|return)\b[^.!?;]{0,50}\b(?:filed|filing|submitted|completed)\b|\b(?:filed|filing|submitted|completed)\b[^.!?;]{0,50}\b(?:tax return|return)\b/i.test(query)) {
    application += ' Filing the tax return does not end the retention period.';
  }
  return application;
}

function formatSingaporeDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

function cpfRefundDateApplication(query: string): string | undefined {
  const datePattern = String.raw`(\d{1,2}[/-]\d{1,2}[/-]20\d{2}|20\d{2}-\d{2}-\d{2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+20\d{2})`;
  const explicitlyUnconditionalBonus = /\b(?:unconditional|non[- ]repayable)\s+(?:joining\s+)?bonus\b/i.test(query);
  const explicitlyConditional = /\bconditional\s+(?:joining\s+)?bonus\b|\bconditional wages?\b/i.test(query);
  const conditionClauses = query.split(/[.!?;\n]+/);
  const negativeBonusCondition = /\b(?:bonus|wages?|payment)\b[^.!?\n]{0,80}\b(?:not|never|isn't|wasn't)\s+(?:subject to|conditional on)\b[^.!?\n]{0,80}\b(?:repayment|service|employment|retention|performance|condition)\b/i;
  const hasNoOriginalServiceCondition = conditionClauses.some(clause =>
    negativeBonusCondition.test(clause) || /\bno\s+(?:original\s+)?(?:service|employment|retention|performance|repayment)\s+condition\b/i.test(clause))
    || /\b(?:not subject to|not conditional on)\b[^.!?;\n]{0,80}\b(?:any\s+)?(?:service|employment|retention|performance)\s+condition\b/i.test(query);
  const positiveBonusRepaymentCondition = /\b(?:joining\s+)?bonus\b[^.!?\n]{0,140}\b(?:subject to|conditional on|paid on condition that|repayable if|repayable upon|becomes? repayable if|becomes? repayable upon|must be repaid if|has to be repaid if|must be returned if|has to be returned if|must be given back if|has to be given back if)\b[^.!?\n]{0,100}\b(?:repayment|repay|return|give back|resign\w*|leav\w*|depart\w*|service|employment|retention|performance|condition)\b|\b(?:repayment|service|employment|retention|performance)\s+condition\b[^.!?\n]{0,80}\b(?:joining\s+)?bonus\b/i;
  const crossSentenceBonusRepaymentCondition = /\b(?:joining|sign[- ]on|retention)\s+bonus\b[\s\S]{0,100}\b(?:it|this|the bonus)\b[\s\S]{0,60}\b(?:repay\w*|return\w*|give back|pay back|reclaim\w*)\b[\s\S]{0,100}\b(?:if|when|upon|unless)\b[\s\S]{0,100}\b(?:resign\w*|leav\w*|depart\w*|fail\w*|service|employment|retention)\b/i;
  const bonusRepaymentCondition = conditionClauses.some(clause =>
    positiveBonusRepaymentCondition.test(clause) && !negativeBonusCondition.test(clause))
    || crossSentenceBonusRepaymentCondition.test(query);
  const conditionalEvidence = explicitlyConditional || bonusRepaymentCondition;
  const explicitlyNotConditional = /\b(?:not|isn't|wasn't)\s+(?:a\s+)?conditional\s+(?:payment|(?:joining\s+)?bonus|wages?)\b|\b(?:payment|(?:joining\s+)?bonus|wages?)\s+(?:is|was)\s+not\s+conditional\b/i.test(query);
  const ordinaryDuplicate = /\bordinary\s+(?:joining\s+)?bonus\b|\b(?:payroll|payment) duplicat(?:ion|ed)\b|\bpaid\s+(?:the\s+)?(?:joining\s+)?bonus\s+(?:twice|again)\b/i.test(query);
  const conflictingConditionalFacts = conditionalEvidence && (explicitlyUnconditionalBonus || explicitlyNotConditional || ordinaryDuplicate || hasNoOriginalServiceCondition);
  if (conflictingConditionalFacts) return undefined;
  const explicitlyOrdinaryFacts = explicitlyUnconditionalBonus || explicitlyNotConditional || ordinaryDuplicate || hasNoOriginalServiceCondition;
  const mentionsWage = /\b(?:bonus|wages?|salary|remuneration|payroll payment)\b/i.test(query);
  const mentionsRepayment = /\b(?:repay\w*|return\w*|give back|pay back|reclaim\w*)\b/i.test(query);
  const mentionsServiceCondition = /\b(?:conditional|condition|service|employment|retention|resign\w*|leav\w*|depart\w*|early)\b/i.test(query);
  const ambiguousRepaymentDate = conditionClauses.some(clause => {
    if (!/\b(?:repay\w*|repayment|repayable)\b/i.test(clause)) return false;
    const dates = [...clause.matchAll(new RegExp(datePattern, 'gi'))];
    return dates.length > 1 ||
      /\b(?:unclear|uncertain|not sure|unknown|cannot determine|don't know|do not know|either|alternatively)\b/i.test(clause);
  });
  if (!conditionalEvidence && !explicitlyOrdinaryFacts && mentionsWage && mentionsRepayment && ambiguousRepaymentDate) {
    return undefined;
  }
  if (!conditionalEvidence && !explicitlyOrdinaryFacts && mentionsWage && mentionsRepayment && mentionsServiceCondition) {
    return undefined;
  }
  const conditional = conditionalEvidence && !explicitlyUnconditionalBonus && !explicitlyNotConditional && !ordinaryDuplicate;
  let suppliedDate: string | undefined;
  if (conditional) {
    const wageReference = String.raw`(?:(?:conditional\s+)?(?:(?:joining|sign[- ]on|retention)\s+)?bonus|(?:conditional\s+)?wages?)`;
    const dateSuffix = String.raw`\s*${datePattern}`;
    const repaymentDateClauses = conditionClauses.filter(clause =>
      /\b(?:repay\w*|repayment|repayable)\b/i.test(clause) &&
      [...clause.matchAll(new RegExp(datePattern, 'gi'))].length > 0);
    const hasCompetingRepaymentDates = repaymentDateClauses.some(clause =>
      [...clause.matchAll(new RegExp(datePattern, 'gi'))].length > 1 ||
      /\b(?:unclear|uncertain|not sure|unknown|cannot determine|don't know|do not know|either|alternatively)\b/i.test(clause));
    if (hasCompetingRepaymentDates) return undefined;
    const hasUnownedRepaymentDate = repaymentDateClauses.some(clause => {
      const trimmed = clause.replace(/^\s*(?:CPF refund deadline:\s*)?/i, '').trim();
      const bareGenericStart = /^(?:the\s+)?(?:repayment due date|(?:repayment|repayable)\s+(?:is|was|becomes?)\s+due)\b/i.test(trimmed);
      const explicitlyWageOwned = new RegExp(String.raw`\b${wageReference}\s+repayment\s+(?:due date|(?:is|was|becomes?)\s+due)\b`, 'i').test(trimmed) ||
        /\b(?:bonus|wages?|salary|remuneration|payroll payment)\b/i.test(trimmed);
      const unambiguousEmployeePronoun = /\bemployee\s+(?:must|has to|is required to)\s+repay\s+(?:it|this)\b/i.test(trimmed);
      return !bareGenericStart && !explicitlyWageOwned && !unambiguousEmployeePronoun;
    });
    if (hasUnownedRepaymentDate) return undefined;
    const dueDatePatterns = [
      new RegExp(String.raw`\b${wageReference}\s+repayment due date\b[^.!?;\n]{0,40}\b(?:is|was|of|:)?${dateSuffix}`, 'gi'),
      new RegExp(String.raw`(?:^|[.!?;\n])\s*(?:CPF refund deadline:\s*)?(?:the\s+)?repayment due date\b[^.!?;\n]{0,40}\b(?:is|was|of|:)?${dateSuffix}`, 'gi'),
      new RegExp(String.raw`\bunder (?:the )?(?:terms of employment|employment terms|employment agreement|employment contract)\b[^.!?;\n]{0,120}\b(?:had|has|have|was|were) to repay\s+(?:the\s+)?${wageReference}\s+on${dateSuffix}`, 'gi'),
      new RegExp(String.raw`\b${wageReference}\s+repayment\s+(?:is|was|becomes?)\s+due\b[^.!?;\n]{0,100}\bon${dateSuffix}`, 'gi'),
      new RegExp(String.raw`(?:^|[.!?;\n])\s*(?:CPF refund deadline:\s*)?(?:the\s+)?(?:repayment|repayable)\s+(?:is|was|becomes?)\s+due\b[^.!?;\n]{0,100}\bon${dateSuffix}`, 'gi'),
      // A pronoun is safe only when the question describes a single repayable
      // wage and no separate loan, advance or debt that could own the date.
      new RegExp(String.raw`\b(?:the\s+)?employee\s+(?:must|has to|is required to)\s+repay\s+(?:it|this|(?:the\s+)?(?:conditional\s+)?(?:(?:joining|sign[- ]on|retention)\s+)?bonus|the\s+conditional wages?)\s+on${dateSuffix}`, 'gi')
    ];
    const hasSeparateDebt = /\b(?:loan|advance|debt)\b/i.test(query);
    const hasSeparateNonWageRepayment = /\b(?:training|course|education|recruitment|relocation|equipment|uniform|accommodation|housing|travel)\s+(?:expenses?|costs?|fees?)\b[^.!?;\n]{0,120}\b(?:repay\w*|repaid|return\w*|due)\b|\b(?:repay\w*|repayment)\b[^.!?;\n]{0,120}\b(?:training|course|education|recruitment|relocation|equipment|uniform|accommodation|housing|travel)\s+(?:expenses?|costs?|fees?)\b/i.test(query);
    const namedBonusKinds = new Set([...query.matchAll(/\b(joining|sign[- ]on|retention|performance|completion|annual)\s+bonus\b/gi)]
      .map(match => match[1].toLowerCase().replace(/[- ]/g, ' ')));
    const hasSeparateWageTransactions = namedBonusKinds.size > 1
      || /\b(?:another|second|separate|different|multiple|several|two)\b[^.!?;\n]{0,60}\b(?:bonus|wages?|payment|transaction)\b/i.test(query)
      || /\bbonus\b[^.!?;\n]{0,100}\b(?:and|plus|as well as)\b[^.!?;\n]{0,80}\bbonus(?:es)?\b/i.test(query);
    const dueDates = dueDatePatterns.flatMap(pattern => [...query.matchAll(pattern)].map(match => match[1]));
    const conflictingDueDateLanguage = /\b(?:mutual agreement|contractual|agreed)\b[^.!?;\n]{0,100}\brepayment due date\b/i.test(query);
    if (dueDates.length !== 1 || conflictingDueDateLanguage || hasSeparateDebt || hasSeparateNonWageRepayment || hasSeparateWageTransactions) return undefined;
    suppliedDate = dueDates[0];
  } else {
    const paymentRecordLabels = [...query.matchAll(/\bPAYMENTS RECEIVED ON\b/gi)];
    if (paymentRecordLabels.length !== 1) return undefined;
    const paymentDateStart = paymentRecordLabels[0].index! + paymentRecordLabels[0][0].length;
    suppliedDate = new RegExp(String.raw`^\s*:?\s*${datePattern}`, 'i').exec(query.slice(paymentDateStart))?.[1];
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
  const domainsByAuthority: Record<Rule['authority'], readonly string[]> = {
    ACRA: ['ACRA_CORPORATE'], IRAS: ['IRAS_CORPORATE_TAX'], CPF: ['CPF_PAYROLL', 'CPF_CONTRIBUTIONS'],
    MOM: ['MOM_EMPLOYMENT'], MAS: ['MAS_FUNDS', 'MAS_REGULATORY_REPORTING']
  };
  const populationsByAuthority: Record<Rule['authority'], readonly string[]> = {
    ACRA: ['Company', 'COMPANY'], IRAS: ['Company', 'COMPANY'], CPF: ['Employer', 'EMPLOYER'],
    MOM: ['Employer', 'EMPLOYER', 'Employee', 'EMPLOYEE'], MAS: ['Company', 'COMPANY']
  };
  if (!['NOT_REQUIRED', 'UNRESOLVED'].includes(issue.applicationStatus) || issue.evidenceStatus !== 'VERIFIED'
      || !['EXPLAIN_RULE', 'CHECK_ELIGIBILITY', 'FILING_REQUIREMENT'].includes(issue.operation)
      || !stream.issues.some(candidate => candidate.id === issue.id && candidate.evidenceStatus === 'VERIFIED')) return undefined;
  const rule = STATUTORY_WORKFLOW_RULES_20261029.find(candidate => candidate.authority === stream.authority
    && candidate.queryPattern.test(query) && candidate.subjectPattern.test(issue.subject)
    && scopeAllowsCurrentRule(query) && domainsByAuthority[candidate.authority].includes(stream.domain)
    && populationsByAuthority[candidate.authority].includes(issue.population)
    && stream.sources.some(candidateSource => sourceFor(candidate, candidateSource, issue.id)));
  if (!rule) return undefined;
  const source = stream.sources.find(candidate => sourceFor(rule, candidate, issue.id));
  if (!source) return undefined;
  const text = answerText(rule, query);
  const dateApplication = rule.id === 'CPF_CONTRIBUTION_REFUND_DEADLINES' ? cpfRefundDateApplication(query) : undefined;
  return { authority: rule.authority, title: source.title || rule.title, officialUrl: rule.officialUrl,
    text: dateApplication ? `${text} ${dateApplication}` : text };
}
