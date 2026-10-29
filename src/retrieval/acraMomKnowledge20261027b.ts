import type {
  AuthorityPresentedIssue,
  AuthorityPresentedSource,
  AuthorityPresentedWorkstream
} from '../utils/authorityEvidencePresentation';
import { groupExactIssueClaimsByDocument } from '../utils/authorityEvidencePresentation';
import { cleanHtmlText, cleanHtmlTextPreservingTableCells } from './sourceAdapters';

export interface AcraMomKnowledgeRuleRequest {
  authority: string;
  topicId: string;
  query: string;
  subject: string;
  sourceText: string;
  officialUrl?: string;
}

type RuleId = 'ACRA_AR_OFFICER_PARTICULARS_20261020' | 'ACRA_ANNUAL_RETURN_FILING_PROCESS'
  | 'ACRA_XBRL_FINANCIAL_STATEMENT_TEMPLATES' | 'MOM_ANNUAL_LEAVE_ENTITLEMENT'
  | 'MOM_SICK_LEAVE_ENTITLEMENT' | 'MOM_PUBLIC_HOLIDAY_PAY' | 'MOM_FINAL_SALARY_DEADLINES';

export interface AcraMomKnowledgeRuleMetadata {
  id: RuleId;
  authority: 'ACRA' | 'MOM';
  topicIds: readonly string[];
  officialUrl: string;
  title: string;
  fixtureFile: string;
  population: string;
  provisions: readonly string[];
  rule: string;
  conditions: readonly string[];
  exceptions: readonly string[];
  requiredFacts: readonly string[];
  /** Present only where the cited page states an explicit scope date. */
  effectiveFrom?: string;
  effectiveDateEvidence: string;
  limitations: readonly string[];
}

const ACRA_OFFICER_URL = 'https://www.acra.gov.sg/news-events/news-announcements/commencement-of-key-changes-under-the-corporate-and-accounting-laws--amendment--act-2025-on-20-october-2026/';
const ACRA_ANNUAL_RETURN_STEPS_URL = 'https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/filing-annual-returns-companies/steps-to-file/';
const ACRA_XBRL_URL = 'https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/filing-financial-statements-in-xbrl-format/requirements-exemptions/';
const MOM_ANNUAL_LEAVE_URL = 'https://www.mom.gov.sg/employment-practices/leave/annual-leave/eligibility-and-entitlement';
const MOM_SICK_LEAVE_URL = 'https://www.mom.gov.sg/employment-practices/leave/sick-leave/eligibility-and-entitlement';
const MOM_PUBLIC_HOLIDAYS_URL = 'https://www.mom.gov.sg/employment-practices/public-holidays-entitlement-and-pay';
const MOM_FINAL_SALARY_URL = 'https://www.mom.gov.sg/employment-practices/salary/paying-salary';

type Rule = AcraMomKnowledgeRuleMetadata & {
  requiredSourceTerms: readonly string[];
  quoteMatchers: readonly RegExp[];
  queryPattern: RegExp;
  subjectPattern: RegExp;
};

const RULES: readonly Rule[] = [
  {
    id: 'ACRA_AR_OFFICER_PARTICULARS_20261020', authority: 'ACRA', topicIds: ['acra-annual-return-officer-particulars'],
    officialUrl: ACRA_OFFICER_URL,
    title: 'Commencement of key Corporate and Accounting Laws changes on 20 October 2026',
    fixtureFile: 'acra-officer-particulars.txt', population: 'Companies filing annual returns; guarantee companies also have a member-count confirmation',
    provisions: ['Corporate and Accounting Laws (Amendment) Act 2025 commencement notice; the notice does not enumerate the amending Act sections.'],
    rule: 'From 20 October 2026, an annual-return filer must confirm that current particulars already provided to ACRA are accurate for directors, chief executive officers (CEOs), secretaries, auditors and relevant members. These particulars include names, identification details, nationality, contact address, appointment dates, registered office address and shareholding details where applicable. The form separately asks whether any individual performs the CEO role. A company limited by guarantee must confirm its latest-reported total member count.',
    effectiveFrom: '2026-10-20',
    conditions: ['Applies to annual returns filed from the expressly stated commencement date.', 'Check ACRA-recorded particulars and update inaccurate particulars in Bizfile before filing.', 'The CEO question concerns individuals performing the role; the ACRA notice does not limit it to a title or appointed position.'],
    exceptions: ['Companies limited by guarantee have an additional total-number-of-members confirmation.', 'The notice does not say the CEO question or officer-particulars confirmation changes the underlying duty to appoint or register officers.'],
    requiredFacts: ['For a particular filing: filing date, company type, existing ACRA particulars, whether individuals perform the CEO role, and whether the company is limited by guarantee.'],
    effectiveDateEvidence: 'The official ACRA notice states the commencement date as 20 October 2026. This explicit date supports the transition; it is not inferred from the notice publication or retrieval date.',
    limitations: ['General change explanation only; does not verify what particulars are currently recorded for an entity.', 'Do not apply this change to filings submitted before 20 October 2026 without contemporaneous evidence.', 'The notice gives examples of particulars and says “where applicable”; it is not a field-by-field eform schema.'],
    requiredSourceTerms: ['commence on 20 october 2026', 'will need to confirm that the latest particulars provided to acra are accurate', 'directors, chief executive officers, secretaries, auditors and relevant members', 'identification details, nationality, contact address, appointment dates, registered office address', 'additional question in the annual return eform', 'individuals performing the role of chief executive officer', 'companies limited by guarantee', 'total number of members'],
    quoteMatchers: [/The next phase of amendments[^.]*commence on 20 October 2026\./i, /Companies filing annual returns[^.]*relevant members\./i, /These include particulars[^.]*where applicable\./i, /There will also be an additional question[^.]*company\./i, /For companies limited by guarantee[^.]*accurate\./i],
    queryPattern: /(?=[\s\S]*\b(?:annual[- ]returns?|annual filing)\b)(?=[\s\S]*\b(?:officers?|directors?|secretar(?:y|ies)|auditors?|ceos?|chief executive|particulars?|member count)\b)/i,
    subjectPattern: /\b(?:annual returns?|officer particular|director|secretary|auditor|chief executive|ceo)\b/i
  },
  {
    id: 'ACRA_ANNUAL_RETURN_FILING_PROCESS', authority: 'ACRA', topicIds: ['acra_annual-returns'],
    officialUrl: ACRA_ANNUAL_RETURN_STEPS_URL, title: 'Steps to file an annual return', fixtureFile: 'acra-annual-return-steps.txt',
    population: 'Singapore local companies and their authorised company-officer or CSP filers',
    provisions: ['ACRA Bizfile annual-return filing process guidance. The page describes the process and does not replace statutory filing-deadline rules.'],
    rule: 'A company officer such as a director or secretary may file a company annual return, or a corporate service provider may file for it. The filer logs in to Bizfile as a Business User through Corppass, checks the company type, registered office address, business activities, company officers, shareholder/share-capital particulars, charges and statutory-register requirements, updates inaccurate entity details before continuing, checks financial-statement duties, and completes company-type declarations and AGM/financial-statement/register sections. The eform asks whether an individual performs the CEO role; a yes answer requires that CEO to be appointed and reflected as a Position Holder. AGM details must be entered even where the company was exempt or dispensed with the AGM. One director signs the directors’ statement for a single-director company; at least two directors sign where there is more than one. The filer reviews, declares and pays the stated S$60 fee. The page also says all overdue annual returns must be filed first when more than one financial year is overdue.',
    conditions: ['Filing is through Bizfile’s File annual returns eService; the company data and applicable form sections depend on company type and reporting-period status.', 'If full XBRL financial statements are filed, a PDF copy is not required; otherwise a complete PDF copy is required for the cases stated on the page.', 'AGM details are declared whether the company held an AGM, was exempt or dispensed with one.'],
    exceptions: ['Financial-statement filing exemptions and exceptions depend on the separate ACRA financial-statement rules.', 'This process page does not establish the statutory annual-return deadline or a historical filing process.'],
    requiredFacts: ['Entity type and financial-year end.', 'Company type and status for the financial period.', 'Current officer, shareholder, share, office, activity and charge information.', 'Financial-statement filing status, AGM status, director count, and RORC/ROND/RONS obligations.'],
    effectiveDateEvidence: 'The process page is marked last updated 19 October 2026. That page-update date is not a legal effective date and is not used to establish the process for an earlier filing.',
    limitations: ['This is a general process summary, not confirmation of a particular entity’s statutory filing obligation, deadline, eligibility or completed filing.', 'The current step sequence and stated S$60 transaction fee may change; year-specific filing process is not established by the page.'],
    requiredSourceTerms: ['company officers', 'corporate service provider', 'registered office address', 'details of company officers', 'details of shareholders and shares', 'must update it before you file', 'check if your company needs to file financial statements', 'select "business user" to log in via corppass', 'file annual returns', 'check that the entity information is correct and up to date', 'ceo', 'must declare your agm details', 'one director only', 'at least two directors', 'need to file all overdue returns first'],
    quoteMatchers: [/Company officers[^.]*annual returns\./i, /Ensure these company details[^.]*registered charges or loans\./i, /If anything is incorrect[^.]*before you file\./i, /Log in to Bizfile[^.]*select Start\./i, /Indicate whether individuals perform the role of CEO[^.]*Annual Return\./i, /AGM details[^.]*include its date\./i, /If the company has one director[^.]*must sign\./i, /Fees\s*[:|]\s*\$60(?:\.00)?(?=[.\s]|$)/i, /If the company has not filed[^.]*first\./i],
    queryPattern: /\bannual[- ]returns?\b[\s\S]{0,160}\b(?:how|steps?|process|file|filing|prepare|checklist|documents?|bizfile|who may|who can)\b|\b(?:how|steps?|process|prepare|checklist|documents?|bizfile|who may|who can)\b[\s\S]{0,160}\bannual[- ]returns?\b/i,
    subjectPattern: /\bannual[- ]return\b/i
  },
  {
    id: 'ACRA_XBRL_FINANCIAL_STATEMENT_TEMPLATES', authority: 'ACRA', topicIds: ['acra_xbrl'], officialUrl: ACRA_XBRL_URL,
    title: 'Financial statements: Filing requirements and exemptions', fixtureFile: 'acra-xbrl-requirements.txt',
    population: 'Singapore-incorporated companies required to file financial statements; template varies by company type, size and regulatory status',
    provisions: ['Companies Act section 201A for dormant relevant company exemption; other categories are described in ACRA guidance without section numbers in the cited passage.'],
    rule: 'The ACRA guidance lists simplified XBRL plus an authorised PDF for smaller and non-publicly accountable companies; XBRL FSH (Banks) or XBRL FSH (Insurance) plus an authorised PDF for the regulated bank, finance and insurance group; PDF only for companies limited by guarantee or companies approved to use other standards; and Full XBRL for all other Singapore-incorporated companies required to file financial statements. “Smaller” requires both current-year revenue and assets not exceeding S$500,000. “Non-publicly accountable” also excludes listed and specified regulated entity types. The dormant-relevant-company and solvent-EPC financial-statement exceptions have separate qualification conditions. ACRA labels technical resources as applying from 19 October 2026 onwards and identifies ACRA Taxonomy 2026 resources.',
    effectiveFrom: '2026-10-19',
    conditions: ['A company must first determine whether it is required to file financial statements; dormant relevant companies and solvent EPCs may qualify for separate financial-statement exceptions.', 'Small-company revenue and asset thresholds must both be met; group consolidation and currency translation details apply under the ACRA definitions page.', 'The Full/Simplified/FSH/PDF template depends on the company’s exact status and regulatory category.'],
    exceptions: ['Dormant relevant companies need not prepare/file only if all Companies Act section 201A requirements are met, including the assets, dormancy and listing/subsidiary conditions.', 'A solvent EPC meeting an EPC definition may elect not to file financial statements but may file voluntarily; its annual-return solvency declaration still applies.', 'Foreign companies with Singapore branches and some individually approved cases are addressed elsewhere on the ACRA filing guidance and are not classified by this local-company rule summary.'],
    requiredFacts: ['Local/foreign incorporation, company form and whether it is a company limited by guarantee.', 'Required-to-file/exempt status, dormancy history, listed/subsidiary status and group assets.', 'Current-year revenue and assets, consolidation and currency facts.', 'Public-accountability or MAS regulatory status.', 'EPC status and solvency, where relevant.'],
    effectiveDateEvidence: 'The ACRA page explicitly labels “XBRL filing requirements (from 19 October 2026 onwards)” and points to ACRA Taxonomy 2026. The page itself is marked last updated 20 October 2026. Only the labeled XBRL boundary is used for transition-date claims; publication/retrieval dates do not establish another rule’s effective date.',
    limitations: ['Does not determine an individual company’s template without classification facts.', 'The complete definitions and section 201A eligibility must be checked against ACRA’s linked guidance and law.', 'Do not apply the current page or 19 October 2026 XBRL boundary to a historical filing unless the relevant year-specific official source supports it.'],
    requiredSourceTerms: ['xbrl filing requirements (from 19 october 2026 onwards)', 'all singapore-incorporated companies must', 'dormant relevant companies', 'section 201a', 'smaller and non-publicly accountable companies', 'simplified xbrl financial statements', 'banks, finance and insurance companies', 'xbrl fsh (banks)', 'companies limited by guarantee', 'all other singapore-incorporated companies', 'full xbrl financial statements', 'revenue for the current financial year does not exceed $500,000', 'total assets for the current financial year do not exceed $500,000', 'fewer than 20 members', 'solvent exempt private company', 'your company is non-publicly accountable if it is'],
    quoteMatchers: [/All Singapore-incorporated companies must:[\s\S]{0,180}unless exempted\./i, /A company meeting all requirements under section 201A[^.]*\./i, /Smaller and non-publicly accountable companies[^.]*\./i, /A smaller company meets both tests:[^.]*\./i, /Banks, finance and insurance companies[^.]*\./i, /Companies limited by guarantee[^.]*\./i, /All other Singapore-incorporated companies[^.]*\./i, /Solvent EPCs that voluntarily file[^.]*\./i, /ACRA labels the technical resources[^.]*\./i],
    queryPattern: /\b(?:xbrl|taxonomy)\b[\s\S]{0,150}\b(?:filing|requirements?|template|full|simplified|financial statement|fs|from|effective|effective date)\b|\b(?:filing|requirements?|template|full|simplified|financial statement|effective date)\b[\s\S]{0,150}\b(?:xbrl|taxonomy)\b/i,
    subjectPattern: /\b(?:xbrl|financial statement filing template)\b/i
  },
  {
    id: 'MOM_ANNUAL_LEAVE_ENTITLEMENT', authority: 'MOM', topicIds: ['mom_annual_leave'], officialUrl: MOM_ANNUAL_LEAVE_URL,
    title: 'Annual leave eligibility and entitlement', fixtureFile: 'mom-annual-leave.txt', population: 'Employees covered by the Employment Act who have served the employer at least three months',
    provisions: ['Employment Act annual-leave guidance; the registry associates this statutory subject with section 88A, but the cited page excerpt does not itself give a section reference.'],
    rule: 'An Employment Act-covered employee becomes entitled to paid annual leave after at least 3 months; being on probation does not remove that entitlement. For 3 to 12 months of service, the entitlement is based on completed months worked even if the employee is still on probation. The minimum annual entitlement rises by one day per year from 7 days in year one to 14 days from year eight. The official formula is completed months of service divided by 12, multiplied by the annual leave entitlement; fractions less than one-half of a day round down, while half or more rounds up to one day. Approved unpaid leave is excluded; service during a resignation notice period counts.',
    conditions: ['The Employment Act must cover the employee and at least three months’ service must be completed; probation does not remove entitlement after this threshold.', 'For 3 to 12 months of service, pro-rating uses completed months even if the employee is still on probation; a partial, incomplete service month is disregarded.', 'The minimum table follows year of service beginning on the employment start date.'],
    exceptions: ['For employees outside the Employment Act, use contractual terms; this page does not establish their statutory entitlement.', 'Annual leave on half-working days, unused-leave carry-forward/forfeiture and termination encashment have separate rules.'],
    requiredFacts: ['Employment Act coverage and start date.', 'Completed service months and service year.', 'Annual contractual entitlement, approved unpaid-leave periods, and notice period if pro-rating.'],
    effectiveDateEvidence: 'Current MOM guidance does not state an effective date for the displayed table. Historical entitlement for a named past year is unresolved from this page alone.',
    limitations: ['States the general statutory minimum and pro-rating method; it does not calculate an individual balance without the listed facts.', 'The current page’s retrieval or update date is not treated as legal commencement.'],
    requiredSourceTerms: ['covered by the employment act', 'at least 3 months', '1st | 7', '2nd | 8', '3rd | 9', '4th | 10', '5th | 11', '6th | 12', '7th | 13', '8th and thereafter | 14', 'completed months of service', '(number of completed months of service ÷ 12 months) × number of days of annual leave entitlement', 'fraction of a day is less than one-half, round it down', 'if it is half or more, round it up to one day', 'approved unpaid leave', 'notice period is included'],
    quoteMatchers: [/If you are covered by the Employment Act[^.]*\./i, /3 to 12 months(?:\s*\|\s*|\s+)Based on the number of completed months you have worked\. This applies even if you['\u2019]re still on probation\./i, /Year of service \| Days of leave[\s\S]{0,120}8th and thereafter \| 14/i, /Annual leave is pro-rated using this formula:[^.]*entitlement\./i, /If the fraction of a day[^.]*\./i, /If it is half or more[^.]*\./i, /You should exclude periods of approved unpaid leave[^.]*\./i, /If you have resigned, your notice period is included[^.]*leave\./i],
    queryPattern: /\b(?:annual leave|paid leave)\b[\s\S]{0,150}\b(?:eligib\w*|entitl\w*|minimum|days?|pro.?rat\w*|calculat\w*|round\w*|service|unpaid|notice)\b|\b(?:eligib\w*|entitl\w*|minimum|days?|pro.?rat\w*|calculat\w*|round\w*)\b[\s\S]{0,150}\bannual leave\b/i,
    subjectPattern: /\bannual leave\b/i
  },
  {
    id: 'MOM_SICK_LEAVE_ENTITLEMENT', authority: 'MOM', topicIds: ['mom_sick_leave'], officialUrl: MOM_SICK_LEAVE_URL,
    title: 'Sick leave eligibility and entitlement', fixtureFile: 'mom-sick-leave.txt', population: 'Employees covered by the Employment Act after at least three months with the employer',
    provisions: ['Employment Act sick-leave guidance; the registry associates this statutory subject with section 89, but the cited page excerpt does not itself give a section reference.'],
    rule: 'An Employment Act-covered employee with at least 3 months’ service who informs, or tries to inform, the employer within 48 hours may qualify for paid outpatient sick and hospitalisation leave on the applicable medical certification. The example entitlement is 5 days of outpatient sick leave and 15 days of hospitalisation leave at month 3; 8 outpatient and 30 hospitalisation days at month 4; 11 outpatient and 45 hospitalisation days at month 5; and from month 6, 14 days of outpatient leave and 60 days of hospitalisation leave. The 60-day hospitalisation cap includes outpatient leave.',
    conditions: ['The Employment Act applies, at least 3 months of service are completed, and the employer is notified or attempted to be notified within 48 hours.', 'Outpatient leave requires a registered medical or dental practitioner’s certification.', 'Hospitalisation leave must meet the specified care/quarantine conditions and certification requirements.'],
    exceptions: ['The 60 hospitalisation days include the 14 outpatient days; they are not 60 days in addition to outpatient leave.', 'Historical table application is not established by this current page.', 'Cosmetic procedures are not required paid sick leave under the page.'],
    requiredFacts: ['Employment Act coverage, employment start date and service months completed.', 'When the employer was informed, qualifying medical certificate and whether care satisfies the hospitalisation definition.', 'Outpatient and hospitalisation leave already taken in the relevant entitlement year.'],
    effectiveDateEvidence: 'Current MOM guidance does not state an effective date for the displayed table. Historical entitlement is unresolved from this page alone.',
    limitations: ['General entitlement only; case eligibility and remaining balance require the listed employee, notice, certification and leave-use facts.', 'Do not infer the applicable historical table from page retrieval date.'],
    requiredSourceTerms: ['covered under the employment act', 'served your employer for at least 3 months', 'within 48 hours', 'registered under the medical registration act or dental registration act', '3 | 13 may | 5 | 15', '4 | 13 june | 8 | 30', '5 | 13 july | 11 | 45', '6 and thereafter | 13 august | 14 | 60', '60 days of paid hospitalisation leave includes the 14 days paid outpatient sick leave entitlement'],
    quoteMatchers: [/An employee covered by the Employment Act[^.]*absence\./i, /A registered medical or dental practitioner[^.]*leave\./i, /3 completed months:[^.]*\./i, /4 completed months:[^.]*\./i, /5 completed months:[^.]*\./i, /6 months and thereafter:[^.]*\./i, /The 60 days of hospitalisation leave[^.]*leave\./i, /The Employment Act requires an employee[^.]*48 hours\./i],
    queryPattern: /\b(?:sick|medical|hospitali[sz]ation) leave\b[\s\S]{0,150}\b(?:eligib\w*|entitl\w*|days?|month|pro.?rat\w*|calculat\w*|inform\w*|limit\w*|48 hours|certificate|mc)\b|\b(?:eligib\w*|entitl\w*|days?|pro.?rat\w*|calculat\w*|inform\w*|certificate)\b[\s\S]{0,150}\b(?:sick|hospitali[sz]ation) leave\b/i,
    subjectPattern: /\b(?:sick|hospitali[sz]ation) leave\b/i
  },
  {
    id: 'MOM_PUBLIC_HOLIDAY_PAY', authority: 'MOM', topicIds: ['mom-public-holidays'], officialUrl: MOM_PUBLIC_HOLIDAYS_URL,
    title: 'Public holidays: entitlement and pay', fixtureFile: 'mom-public-holidays.txt', population: 'Employees covered by the Employment Act; contractual terms govern employees outside its coverage',
    provisions: ['Employment Act public-holiday guidance. No Act section number is supplied by this source excerpt.'],
    rule: 'An Employment Act-covered employee has 11 paid public holidays each year. If a holiday falls on the rest day, the following working day will be a paid public holiday; if it falls on a non-working day, another day off or an extra day at the gross rate is due. Working on a public holiday ordinarily earns holiday gross pay plus an additional day at the basic rate; overtime applies beyond normal hours. By mutual agreement, the day may be substituted. Part IV coverage limits which employees may use time off in lieu.',
    conditions: ['Distinguish a holiday on a working day, non-working day, or rest day.', 'For holiday gross pay, the employee must not be absent without consent or reasonable excuse on the working day immediately before or after the holiday; authorised leave on either day is permitted. No holiday pay is due when the holiday itself falls during approved unpaid leave.', 'Additional basic-rate pay is the default for working on the holiday; substitute-holiday arrangements require mutual agreement.'],
    exceptions: ['An employee outside Employment Act coverage is governed by the contract.', 'Time off in lieu of hours worked is available only to employees not covered by Part IV under the stated arrangement.', 'Rest-day pay and any excess-hours overtime are separate entitlements.'],
    requiredFacts: ['Employment Act and Part IV coverage.', 'Work schedule and whether the date is a working, non-working or rest day.', 'Whether the employee worked, hours worked, agreed substitution/time-off arrangements, and relevant absence or unpaid-leave facts.'],
    effectiveDateEvidence: 'Current MOM guidance gives no explicit effective-date boundary for the general entitlement. Historical application is unresolved from this source alone.',
    limitations: ['Does not decide a specific date’s gazetted holiday status or compute holiday pay without schedule and wage facts.', 'Does not replace separate rest-day, overtime or part-time rules.'],
    requiredSourceTerms: ['covered by the employment act', '11 paid public holidays', 'you were not absent on the working day immediately before or after a holiday without consent or a reasonable excuse', 'you are on authorised leave (e.g. sick leave, annual leave, unpaid leave) on the day immediately before or after a holiday', 'not entitled to holiday pay if the holiday falls on your approved unpaid leave', 'falls on a rest day', 'following working day will be a paid public holiday', 'non-working day', 'one extra day', 'gross rate', 'work on a public holiday', 'extra day', 'basic rate', 'part 4'],
    quoteMatchers: [/If covered by the Employment Act[^.]*year\./i, /The gazetted holidays are[^.]*Christmas Day\./i, /You are entitled to your gross rate of pay on a public holiday, if:[\s\S]*?You are on authorised leave[^.]*\./i, /You are not entitled to holiday pay if the holiday falls on your approved unpaid leave\./i, /If a holiday falls on a non-working day[^.]*in lieu\./i, /If it falls on a rest day[^.]*paid holiday\./i, /By default, an employee required to work[^.]*\./i, /Time off in lieu may be used[^.]*Part IV\./i, /An employee not covered by the Employment Act[^.]*contract\./i],
    queryPattern: /\bpublic holida(?:y|ys)\b[\s\S]{0,180}\b(?:entitl|paid|pay|work|off|day|rate|employment act)\b|\b(?:entitl|paid|pay|work|off|day|rate)\b[\s\S]{0,180}\bpublic holida(?:y|ys)\b/i,
    subjectPattern: /\bpublic holida(?:y|ys)\b/i
  },
  {
    id: 'MOM_FINAL_SALARY_DEADLINES', authority: 'MOM', topicIds: ['mom-salary-payment'], officialUrl: MOM_FINAL_SALARY_URL,
    title: 'Paying salary: final salary deadlines', fixtureFile: 'mom-final-salary.txt', population: 'Employees covered by the Employment Act and their employers',
    provisions: ['Employment Act salary-payment guidance; cited page does not specify relevant section numbers for the four termination deadlines.'],
    rule: 'MOM distinguishes final wages by how employment ends: where an employee serves required resignation notice, pay on the last day of employment; resignation without notice, within 7 days of the last day of employment; misconduct dismissal, on the last day of employment or within 3 working days from dismissal if that is not possible; and employer termination, on the last day of employment or within 3 working days from termination if that is not possible.',
    conditions: ['The rule is for employees covered by the Employment Act.', 'Determine which of the four termination paths applies; resignation with notice and without notice have different deadlines.'],
    exceptions: ['Foreign employees leaving employment have a separate tax clearance withholding requirement, which may withhold salary and leave pay for up to 30 days after the cessation notice to the Comptroller.', 'Commission-payment timing may depend on contract, policies or practices.', 'The current page does not establish historical applicability.'],
    requiredFacts: ['Employment Act coverage and whether employee resigned with notice, resigned without notice, was dismissed for misconduct, or was terminated by the employer.', 'Last employment day or termination/dismissal date.', 'Any foreign-employee tax-clearance notice and contract-specific commission terms.'],
    effectiveDateEvidence: 'The current MOM page states these payment timelines but gives no effective date for them. Past termination cases need contemporaneous statutory evidence.',
    limitations: ['General rule summary; does not decide a dispute about notice validity, breach, misconduct, wrongful dismissal or amounts owed.', 'Tax-clearance withholding is a separate issue and depends on the foreign employee and cessation-notice facts.'],
    requiredSourceTerms: ['final salary payment could vary', 'employee resigns and serves the required notice period | on the last day of employment', 'employee resigns and does not serve the notice period | within 7 days of the last day of employment', 'dismissal on grounds of misconduct | on the last day of employment. if this is not possible, then within 3 working days from date of dismissal', 'employer terminates the contract | on the last day of employment. if this is not possible, then within 3 working days from date of termination', 'up to 30 days', 'tax clearance'],
    quoteMatchers: [/Employee resigns and serves the required notice period[^\n]*/i, /Employee resigns and does not serve the notice period[^\n]*/i, /Dismissal on grounds of misconduct[^\n]*\n/i, /Employer terminates the contract[^\n]*\n/i, /For a foreign employee leaving employment[^.]*\./i],
    queryPattern: /\b(?:final|last)\s+(?:salary|pay|wages?)\b[\s\S]{0,180}\b(?:resign\w*|terminat\w*|dismiss\w*|misconduct|notice\w*|when|deadline|within|paid)\b|\b(?:resign\w*|terminat\w*|dismiss\w*|misconduct|notice\w*)\b[\s\S]{0,180}\b(?:final|last)\s+(?:salary|pay|wages?)\b/i,
    subjectPattern: /\b(?:final|last)\s+(?:salary|pay|wages?)\b[\s\S]{0,100}\b(?:terminat\w*|resign\w*|dismiss\w*|notice\w*)\b|\b(?:terminat\w*|resign\w*|dismiss\w*|notice\w*)\b[\s\S]{0,100}\b(?:final|last)\s+(?:salary|pay|wages?)\b/i
  }
];

export const ACRA_MOM_KNOWLEDGE_RULES_20261027B: readonly AcraMomKnowledgeRuleMetadata[] = Object.freeze(
  RULES.map(({ requiredSourceTerms: _requiredSourceTerms, quoteMatchers: _quoteMatchers, queryPattern: _queryPattern, subjectPattern: _subjectPattern, ...metadata }) => metadata)
);

export const ACRA_MOM_KNOWLEDGE_SOURCE_CATALOG_20261027B = Object.freeze(RULES.map(rule => ({
  authority: rule.authority, topicId: rule.topicIds[0], url: rule.officialUrl, title: rule.title,
  fixtureFile: rule.fixtureFile, ...(rule.effectiveFrom ? { effectiveFrom: rule.effectiveFrom } : {})
})));

function cleanSourceText(value: string): string {
  const hasHtml = /<(?:!doctype|html|head|body|main|article|section|div|p|table|tr|td|li|h[1-6])\b/i.test(value);
  const visible = hasHtml
    ? (/<table\b/i.test(value) ? cleanHtmlTextPreservingTableCells(value) : cleanHtmlText(value))
    : value;
  return visible
    .replace(/\u00a0/g, ' ').replace(/[\t\f\v ]+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1').replace(/\s+/g, ' ').trim().toLowerCase();
}

function exactOfficialUrl(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  try {
    const url = new URL(actual);
    const canonical = `${url.origin.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
    const wanted = new URL(expected);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      && canonical === `${wanted.origin}${wanted.pathname.replace(/\/+$/, '')}`;
  } catch { return false; }
}

function queryHasUnsupportedDate(query: string, rule: Rule): boolean {
  const years = [...query.matchAll(/\b(?:19|20)\d{2}\b/g)].map(match => match[0]);
  const explicitDates = [...new Set([...query.matchAll(/\b(?:\d{1,2}\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,)?\s+\d{4}\b|\b\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/gi)].map(match => match[0].toLowerCase().replace(/,/g, '').replace(/\s+/g, ' ').trim()))];
  const allowedBoundary = rule.id === 'ACRA_AR_OFFICER_PARTICULARS_20261020' ? '20 october 2026'
    : rule.id === 'ACRA_XBRL_FINANCIAL_STATEMENT_TEMPLATES' ? '19 october 2026' : undefined;
  const transitionQuestion = Boolean(allowedBoundary && explicitDates.length === 1 && explicitDates[0] === allowedBoundary
    && /\b(?:from|on|effective|commenc\w*)\s+\d{1,2}\s+october\s+2026\b/i.test(query));
  const currentOfficerChangeExplanation = rule.id === 'ACRA_AR_OFFICER_PARTICULARS_20261020' &&
    years.length > 0 && years.every(year => year === '2026') && /\boctober\s+2026\b/i.test(query) &&
    /\bannual[- ]return\b/i.test(query) && /\b(?:change|commenc\w*)\b/i.test(query) &&
    /\b(?:ceo|chief executive|officer particulars?)\b/i.test(query) &&
    /\b(?:does|what|which|ask|require)\b/i.test(query) &&
    !/\b(?:filed|submitted|lodged|filing date|our company|my company|historical|prior|previous|past)\b/i.test(query);
  if (currentOfficerChangeExplanation) return false;
  if (years.length > 0 && (!transitionQuestion || years.some(year => year !== '2026'))) return true;
  if (explicitDates.length > 0 && !transitionQuestion) return true;
  if (transitionQuestion && /\b(?:was|were|has|have|had|my|our|this company's|a specific|the return filed)\b[\s\S]{0,90}\b(?:filed|submitted|lodged|applicable|applied)\b/i.test(query)) return true;
  if (/\b(?:historical|historic|previous|prior|past|former|superseded|last financial year|next|coming|upcoming)\b/i.test(query)) return true;
  if (/\b(?:last|previous|prior|past|next|coming|upcoming)\s+(?:\d+\s+)?(?:days?|weeks?|months?|quarters?|years?|financial years?|reporting periods?)\b/i.test(query)) return true;
  if (/\b(?:my|our)\s+(?:company|employee|employer|annual leave|sick leave|public holiday|final salary|termination)\b/i.test(query)) return false;
  return false;
}

function recognizeRule(input: Pick<AcraMomKnowledgeRuleRequest, 'authority' | 'topicId' | 'query' | 'subject'>): Rule | undefined {
  return RULES.find(rule => input.authority === rule.authority && rule.topicIds.includes(input.topicId)
    && rule.queryPattern.test(input.query) && rule.subjectPattern.test(input.subject));
}

function sourceSupports(rule: Rule, sourceText: string): boolean {
  const text = cleanSourceText(sourceText);
  if (rule.id === 'ACRA_ANNUAL_RETURN_FILING_PROCESS' && !hasExactAcraAnnualReturnFee(text)) return false;
  if (rule.id === 'ACRA_XBRL_FINANCIAL_STATEMENT_TEMPLATES' && !hasExactAcraXbrlThresholds(text)) return false;
  if (rule.id === 'MOM_SICK_LEAVE_ENTITLEMENT' && !hasExactSickLeaveSchedule(text)) return false;
  if (rule.id === 'MOM_ANNUAL_LEAVE_ENTITLEMENT' && !hasExactAnnualLeaveProbationQualification(text)) return false;
  return hasRequiredSourceTerms(rule, text) && !sourceHasContradiction(rule, text);
}

function hasRequiredSourceTerms(rule: Rule, text: string): boolean {
  const rowTerms = rule.id === 'MOM_FINAL_SALARY_DEADLINES'
    ? rule.requiredSourceTerms.filter(term => term.includes('|')) : [];
  const simpleTerms = rule.requiredSourceTerms.filter(term => !rowTerms.includes(term));
  const visibleRows = text.replace(/\s*\|\s*/g, ' ');
  return simpleTerms.every(term => text.includes(term.toLowerCase()))
    && rowTerms.every(term => text.includes(term.toLowerCase()) || visibleRows.includes(term.replace(/\s*\|\s*/g, ' ').toLowerCase()));
}

function hasExactAcraAnnualReturnFee(text: string): boolean {
  const fee = acraAnnualReturnFee(text);
  return fee === '60' || fee === '60.00';
}

function acraAnnualReturnFee(text: string): string | undefined {
  return text.match(/\bfees?\s*[:|]\s*\$\s*(\d+(?:\.\d+)?)/i)?.[1];
}

function hasExactAcraXbrlThresholds(text: string): boolean {
  const amount = String.raw`\$\s*([\d,]+(?:\.\d+)?)`;
  const amountBoundary = String.raw`(?=$|\s|[,;:!?)]|\.(?=\s|$))`;
  const revenue = new RegExp(String.raw`\brevenue for the current financial year does not exceed\s*${amount}${amountBoundary}`, 'i').exec(text)?.[1];
  const assets = new RegExp(String.raw`\btotal assets for the current financial year do not exceed\s*${amount}${amountBoundary}`, 'i').exec(text)?.[1];
  return revenue === '500,000' && assets === '500,000';
}

function hasExactSickLeaveSchedule(text: string): boolean {
  const expected = ['3|13may|5|15', '4|13june|8|30', '5|13july|11|45', '6andthereafter|13august|14|60'];
  const rows = [...text.matchAll(/\b(3|4|5|6 and thereafter)\s*\|\s*(13 may|13 june|13 july|13 august)\s*\|\s*(\d+)\s*\|\s*(\d+)\b/g)];
  return expected.every(row => rows.some(match => match[0].replace(/\s+/g, '').toLowerCase() === row));
}

function hasExactAnnualLeaveProbationQualification(text: string): boolean {
  return /\b3 to 12 months(?:\s*\|\s*|\s+)based on the number of completed months you have worked\.\s*this applies even if you['\u2019]re still on probation\./i.test(text);
}

function hasReversedAnnualLeaveProbationCondition(text: string): boolean {
  return /\b(?:annual leave|leave entitlement)\b[^.!?]{0,120}\b(?:only|solely)\b[^.!?]{0,60}\b(?:after|once|following|until)\b[^.!?]{0,50}\bprobation\b/i.test(text)
    || /\b(?:during|while|on)\s+(?:the\s+)?probation(?:ary)?\b[^.!?]{0,100}\b(?:not entitled|no entitlement|not eligible|ineligible|cannot|no annual leave)\b/i.test(text)
    || /\b(?:not entitled|no entitlement|not eligible|ineligible|cannot)\b[^.!?]{0,100}\bannual leave\b[^.!?]{0,80}\b(?:during|while|on|until|after)\b[^.!?]{0,40}\bprobation\b/i.test(text);
}

function hasChangedSickLeaveSchedule(text: string): boolean {
  const expected = new Set(['3|13may|5|15', '4|13june|8|30', '5|13july|11|45', '6andthereafter|13august|14|60']);
  return [...text.matchAll(/\b(3|4|5|6 and thereafter)\s*\|\s*(13 may|13 june|13 july|13 august)\s*\|\s*(\d+)\s*\|\s*(\d+)\b/g)]
    .some(match => !expected.has(match[0].replace(/\s+/g, '').toLowerCase()));
}

function sourceHasContradiction(rule: Rule, text: string): boolean {
  if (rule.id === 'ACRA_ANNUAL_RETURN_FILING_PROCESS') {
    const fee = acraAnnualReturnFee(text);
    if (fee !== undefined && fee !== '60' && fee !== '60.00') return true;
  }
  if (rule.id === 'ACRA_XBRL_FINANCIAL_STATEMENT_TEMPLATES') {
    const values = [...text.matchAll(/\b(?:revenue for the current financial year does not exceed|total assets for the current financial year do not exceed)\s*\$\s*([\d,]+(?:\.\d+)?)/gi)];
    if (values.some(match => match[1] !== '500,000')) return true;
  }
  if (rule.id === 'MOM_SICK_LEAVE_ENTITLEMENT' && hasChangedSickLeaveSchedule(text)) return true;
  if (rule.id === 'MOM_ANNUAL_LEAVE_ENTITLEMENT' && hasReversedAnnualLeaveProbationCondition(text)) return true;
  const checks: Record<RuleId, RegExp> = {
    ACRA_AR_OFFICER_PARTICULARS_20261020: /\b(?:will not commence|does not commence) on 20 october 2026|\bcommence on (?!20 october 2026)\d{1,2} october 20\d{2}|(?:no need to|does not need to|will not need to|must not) confirm[^.]{0,100}(?:particulars|annual return)|there will be no additional question\b|total number of members[^.]{0,80}\b(?:inaccurate|not accurate)\b/i,
    ACRA_ANNUAL_RETURN_FILING_PROCESS: /\b(?:anyone|any person) can file\b[^.]{0,80}\b(?:without|no) (?:corppass|authori[sz]ation)\b|must not update[^.]{0,80}\bbefore you file|agm details need not be declared|all overdue returns need not be filed first|file annual returns[^.]{0,80}\bfree\b|multiple directors:[^\n.]{0,80}\bone director\b/i,
    ACRA_XBRL_FINANCIAL_STATEMENT_TEMPLATES: /\b(?:full|simplified) xbrl[^.]{0,120}\b(?:not required|does not need|must not|instead of)\b|(?:revenue|assets)[^.]{0,90}(?<!not )exceeds? \$500,000\b|from 20 october 2026 onwards/i,
    MOM_ANNUAL_LEAVE_ENTITLEMENT: /\b1st \| (?!7\b)\d+\b|\bannual leave[^.]{0,100}\b(?:first year|1st year)[^.]{0,30}\b(?:6|8|10|14) days\b|number of completed months of service ÷\s*(?!12\b)\d+\s+months|fraction of a day is less than one-half[^.]{0,50}\bround(?:ed)? (?:it )?up\b|if it is half or more[^.]{0,50}\bround(?:ed)? (?:it )?down\b/i,
    MOM_SICK_LEAVE_ENTITLEMENT: /\b3 \| 13 may \| (?!5 \| 15)\d+ \| \d+\b|\b(?:14|60) days[^.]{0,100}\b(?:in addition to|separate from|excludes?)\b|\bwithin (?:24|72) hours\b|\b3 completed months[^.]{0,80}\b(?:14|60) days\b/i,
    MOM_PUBLIC_HOLIDAY_PAY: /\b(?:10|12) paid public holidays\b|\brest day[^.]{0,100}\b(?:same day|no replacement|not entitled to another day)\b|\badditional day[^.]{0,80}\bgross rate\b|you were absent on the working day immediately before or after a holiday with consent and a reasonable excuse/i,
    MOM_FINAL_SALARY_DEADLINES: /\bemployee resigns and serves the required notice period[^\n|]{0,20}\|\s*within \d+ days\b|\bemployee resigns and does not serve the notice period[^\n|]{0,20}\|\s*within (?!7 days)\d+ days\b|\bdismissal on grounds of misconduct[^\n]{0,120}\bwithin (?!3 working days)\d+ working days\b|\bemployer terminates the contract[^\n]{0,120}\bwithin (?!3 working days)\d+ working days\b|\bdismissal on grounds of misconduct[^\n]{0,120}\bwithin (?:7|14) days\b|\bemployer terminates the contract[^\n]{0,120}\bwithin (?:7|14) days\b/i
  };
  return checks[rule.id].test(text);
}

/** Proves only the enumerated ACRA/MOM rule when the corresponding official source is complete. */
export function supportAcraMomKnowledgeRule(input: AcraMomKnowledgeRuleRequest): boolean | undefined {
  const rule = recognizeRule(input);
  if (!rule) return undefined;
  if (queryHasUnsupportedDate(input.query, rule)
      || (input.officialUrl !== undefined && !exactOfficialUrl(input.officialUrl, rule.officialUrl))) return false;
  if (rule.id === 'MOM_ANNUAL_LEAVE_ENTITLEMENT') {
    const text = cleanSourceText(input.sourceText);
    if (sourceHasContradiction(rule, text)) return false;
    if (!hasExactAnnualLeaveProbationQualification(text) && hasRequiredSourceTerms(rule, text)) return undefined;
  }
  return sourceSupports(rule, input.sourceText);
}

/** Returns bounded passages from the source only if every material premise is present. */
export function selectAcraMomKnowledgeQuotes(input: AcraMomKnowledgeRuleRequest): string[] {
  const rule = recognizeRule(input);
  if (!rule || !exactOfficialUrl(input.officialUrl, rule.officialUrl) || supportAcraMomKnowledgeRule(input) !== true) return [];
  const htmlInput = /<(?:!doctype|html|head|body|main|article|section|div|p|table|tr|td|li|h[1-6])\b/i.test(input.sourceText);
  const rawText = htmlInput
    ? (/<table\b/i.test(input.sourceText)
      ? cleanHtmlTextPreservingTableCells(input.sourceText).replace(/\n{2,}/g, ' ').replace(/\s*\|\s*/g, ' ').replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').trim()
      : cleanHtmlText(input.sourceText))
    : input.sourceText;
  const statements = [...new Set([
    ...rawText.split(/\r?\n+/).map(value => value.trim()).filter(Boolean),
    ...rawText.split(/(?<=[.!?])\s+/).map(value => value.trim()).filter(Boolean)
  ])];
  const quotes = rule.quoteMatchers.flatMap(pattern => {
    const statement = statements.find(value => pattern.test(value));
    return statement ? [statement] : [];
  });
  const quoteText = [...quotes];
  const selected = cleanSourceText(quoteText.join('\n'));
  for (const term of rule.requiredSourceTerms) {
    const visibleTerm = term.replace(/\s*\|\s*/g, ' ').toLowerCase();
    if (selected.includes(term.toLowerCase()) || selected.replace(/\s*\|\s*/g, ' ').includes(visibleTerm)) continue;
    const matchingStatement = statements.find(value => {
      const text = cleanSourceText(value);
      return text.includes(term.toLowerCase()) || text.replace(/\s*\|\s*/g, ' ').includes(visibleTerm);
    });
    if (!matchingStatement) return [];
    quoteText.push(matchingStatement);
  }
  const uniqueQuotes = [...new Set(quoteText)];
  return uniqueQuotes.every(value => value.length <= 5_000) && sourceSupports(rule, uniqueQuotes.join('\n'))
    ? uniqueQuotes : [];
}

/** Reports an explicit source contradiction for an owned family so broader fallbacks can be vetoed. */
export function hasAcraMomKnowledgeContradiction(input: AcraMomKnowledgeRuleRequest): boolean {
  const rule = recognizeRule(input);
  if (!rule) return false;
  return sourceHasContradiction(rule, cleanSourceText(input.sourceText));
}

/** Identifies the source pointers required to satisfy a known rule family. */
export function acraMomKnowledgePointers(input: Pick<AcraMomKnowledgeRuleRequest, 'authority' | 'topicId' | 'query' | 'subject'>): string[] {
  const rule = recognizeRule(input);
  return rule ? [rule.officialUrl] : [];
}

function ruleForPresentedIssue(query: string, authority: string, subject: string): Rule | undefined {
  return RULES.find(rule => rule.authority === authority && rule.queryPattern.test(query) && rule.subjectPattern.test(subject));
}

function issueSubjectMatches(rule: Rule, subject: string): boolean {
  return rule.subjectPattern.test(subject);
}

function sourceFor(rule: Rule, source: AuthorityPresentedSource, issueId: string): boolean {
  return source.provenance === 'LIVE_EXTERNAL' && !source.validTo && source.officialUrl === rule.officialUrl
    && groupExactIssueClaimsByDocument(source, issueId)
      .some(group => sourceSupports(rule, group.map(claim => claim.text).join('\n')));
}

function answerText(rule: Rule): string {
  return `${rule.rule} ${rule.conditions.join(' ')} ${rule.exceptions.join(' ')} A case-specific conclusion requires: ${rule.requiredFacts.join(' ')} ${rule.limitations.join(' ')}`;
}

/** Adds a general rule explanation only when verified issue-bound claims from one exact official source support it. */
export function getAcraMomKnowledgeEvidence(
  query: string,
  stream: AuthorityPresentedWorkstream,
  issue: AuthorityPresentedIssue
): { authority: 'ACRA' | 'MOM'; title: string; officialUrl: string; text: string } | undefined {
  const rule = ruleForPresentedIssue(query, stream.authority, issue.subject);
  if (!rule || queryHasUnsupportedDate(query, rule)) return undefined;
  const expectedDomain = rule.authority === 'ACRA' ? 'ACRA_CORPORATE' : 'MOM_EMPLOYMENT';
  const populations = rule.authority === 'ACRA' ? ['Company', 'COMPANY']
    : ['Employee', 'EMPLOYEE', 'Employer', 'EMPLOYER', 'Not established'];
  if (stream.domain !== expectedDomain || !populations.includes(issue.population)
      || !['NOT_REQUIRED', 'UNRESOLVED'].includes(issue.applicationStatus)
      || issue.population === 'Not established' &&
        (!['EXPLAIN_RULE', 'CHECK_ELIGIBILITY'].includes(issue.operation) ||
          issue.operation === 'CHECK_ELIGIBILITY' && issue.applicationStatus !== 'UNRESOLVED')
      || issue.evidenceStatus !== 'VERIFIED'
      || !['EXPLAIN_RULE', 'CHECK_ELIGIBILITY', 'FILING_REQUIREMENT'].includes(issue.operation)
      || !issueSubjectMatches(rule, issue.subject)
      || !stream.issues.some(candidate => candidate.id === issue.id && candidate.evidenceStatus === 'VERIFIED')) return undefined;
  const source = stream.sources.find(candidate => sourceFor(rule, candidate, issue.id));
  if (!source) return undefined;
  return { authority: rule.authority, title: source.title, officialUrl: rule.officialUrl, text: answerText(rule) };
}
