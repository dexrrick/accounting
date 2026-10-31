import type {
  AuthorityPresentedIssue,
  AuthorityPresentedSource,
  AuthorityPresentedWorkstream
} from '../utils/authorityEvidencePresentation';
import { groupExactIssueClaimsByDocument } from '../utils/authorityEvidencePresentation';
import { cleanHtmlText, cleanHtmlTextPreservingTableCells } from './sourceAdapters';
import { getAcraAnnualReturnDeadlineTablePassage } from './acraAnnualReturnFilingRule';
import { acraOfficerCommencementScope } from './statutoryCommencementScope';
import { defaultTargetDateResolver } from './targetDateResolver';
import { parseCompanyFyeDate } from './companyFyeDate';
import { selectAcraSmallCompanyAuditFactsQuotes, supportsAcraSmallCompanyAuditFacts } from './momAcraMasCoverageRules';

export interface AcraMomKnowledgeRuleRequest {
  authority: string;
  topicId: string;
  query: string;
  subject: string;
  sourceText: string;
  officialUrl?: string;
}

export type AcraAuditExemptionContextRequest = Pick<AcraMomKnowledgeRuleRequest,
  'authority' | 'topicId' | 'query' | 'subject' | 'officialUrl'>;

type RuleId = 'ACRA_AR_OFFICER_PARTICULARS_20261020' | 'ACRA_ANNUAL_RETURN_FILING_PROCESS'
  | 'ACRA_XBRL_FINANCIAL_STATEMENT_TEMPLATES' | 'ACRA_AGM_DEADLINES' | 'ACRA_AR_DEADLINES'
  | 'ACRA_AUDIT_EXEMPTION' | 'ACRA_FYE_CHANGE' | 'ACRA_OFFICER_UPDATE' | 'ACRA_AR_EXTENSION' | 'ACRA_SECRETARY_APPOINTMENT'
  | 'MOM_ANNUAL_LEAVE_ENTITLEMENT'
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
const ACRA_AGM_URL = 'https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/holding-annual-general-meetings/due-dates-requirements/';
const ACRA_FYE_URL = 'https://www.acra.gov.sg/register/business/registering-different-business-structures/local-company/choosing-a-companys-financial-year-end/';
const ACRA_AR_DEADLINES_URL = 'https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/filing-annual-returns-companies/deadline-requirements/';
const ACRA_AUDIT_EXEMPTIONS_URL = 'https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/preparing-financial-statements/audit-exemptions/';
const ACRA_OFFICERS_URL = 'https://www.acra.gov.sg/register/business/registering-different-business-structures/local-company/appointing-company-directors-other-key-officers/';
const ACRA_OFFICER_UPDATES_URL = 'https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/maintaining-local-companys-information-registers/updating-company-information-officers-shareholders/';
const ACRA_AR_EXTENSION_URL = 'https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/filing-annual-returns-companies/applying-for-an-extension-of-time/';
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
    queryPattern: /(?=[\s\S]*\b(?:annual[- ]returns?|annual filing|return)\b)(?=[\s\S]*\b(?:officers?|directors?|secretar(?:y|ies)|auditors?|ceos?|chief executive|particulars?|member count|officer[- ]confirm(?:ation)?|new question)\b)/i,
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
    queryPattern: /\bannual[- ]returns?\b[\s\S]{0,160}\b(?:how|steps?|process|file|filing|prepare|checklist|documents?|bizfile|who may|who can)\b|\b(?:how|steps?|process|prepare|checklist|documents?|bizfile|who may|who can)\b[\s\S]{0,160}\bannual[- ]returns?\b|\b(?:xbrl|financial statements?)\b[\s\S]{0,180}\b(?:director|directors)['’]? statements?\b[\s\S]{0,100}\b(?:sign|signature|signing)\b/i,
    subjectPattern: /\bannual[- ]return\b/i
  },
  {
    id: 'ACRA_XBRL_FINANCIAL_STATEMENT_TEMPLATES', authority: 'ACRA', topicIds: ['acra_xbrl', 'acra_financial_statements'], officialUrl: ACRA_XBRL_URL,
    title: 'Financial statements: Filing requirements & exemptions', fixtureFile: 'acra-xbrl-native.html',
    population: 'Singapore-incorporated companies required to file financial statements; template varies by company type, size and regulatory status',
    provisions: ['Companies Act section 201A for dormant relevant company exemption; other categories are described in ACRA guidance without section numbers in the cited passage.'],
    rule: 'ACRA says all Singapore-incorporated companies must prepare financial statements, except dormant relevant companies, and must file them unless exempted. A solvent exempt private company may qualify not to file; dormant-relevant-company relief requires all Companies Act section 201A conditions. Newly incorporated or inactive status alone is not listed as an exemption in this guidance. For required filings, ACRA lists simplified XBRL plus an authorised PDF for smaller and non-publicly accountable companies; XBRL FSH (Banks) or XBRL FSH (Insurance) plus an authorised PDF for the regulated bank, finance and insurance group; PDF only for companies limited by guarantee or companies approved to use other standards; and Full XBRL without a separate PDF copy for all other Singapore-incorporated companies required to file financial statements. “Smaller” requires both current-year revenue and assets not exceeding S$500,000. “Non-publicly accountable” also excludes listed and specified regulated entity types. ACRA labels technical resources as applying from 19 October 2026 onwards and identifies ACRA Taxonomy 2026 resources.',
    effectiveFrom: '2026-10-19',
    conditions: ['A company must first determine whether it is required to file financial statements; dormant relevant companies and solvent EPCs may qualify for separate financial-statement exceptions.', 'Small-company revenue and asset thresholds must both be met; group consolidation and currency translation details apply under the ACRA definitions page.', 'The Full/Simplified/FSH/PDF template depends on the company’s exact status and regulatory category.'],
    exceptions: ['Dormant relevant companies need not prepare/file only if all Companies Act section 201A requirements are met, including the assets, dormancy and listing/subsidiary conditions.', 'A solvent EPC meeting an EPC definition may elect not to file financial statements but may file voluntarily; its annual-return solvency declaration still applies.', 'Foreign companies with Singapore branches and some individually approved cases are addressed elsewhere on the ACRA filing guidance and are not classified by this local-company rule summary.'],
    requiredFacts: ['Local/foreign incorporation, company form and whether it is a company limited by guarantee.', 'Required-to-file/exempt status, dormancy history, listed/subsidiary status and group assets.', 'Current-year revenue and assets, consolidation and currency facts.', 'Public-accountability or MAS regulatory status.', 'EPC status and solvency, where relevant.'],
    effectiveDateEvidence: 'The ACRA page explicitly labels “XBRL filing requirements (from 19 October 2026 onwards)” and points to ACRA Taxonomy 2026. The page itself is marked last updated 20 October 2026. Only the labeled XBRL boundary is used for transition-date claims; publication/retrieval dates do not establish another rule’s effective date.',
    limitations: ['Does not determine an individual company’s template without classification facts.', 'The complete definitions and section 201A eligibility must be checked against ACRA’s linked guidance and law.', 'Do not apply the current page or 19 October 2026 XBRL boundary to a historical filing unless the relevant year-specific official source supports it.'],
    requiredSourceTerms: ['xbrl filing requirements (from 19 october 2026 onwards)', 'all singapore-incorporated companies must', 'dormant relevant companies', 'section 201a', 'smaller and non-publicly accountable companies', 'simplified xbrl financial statements', 'banks, finance and insurance companies', 'xbrl fsh (banks)', 'companies limited by guarantee', 'all other singapore-incorporated companies', 'full xbrl financial statements', 'revenue for the current financial year does not exceed $500,000', 'total assets for the current financial year do not exceed $500,000', 'fewer than 20 members', 'you can choose to file financial statements voluntarily', 'solvent epcs which voluntarily choose to file', 'your company is non-publicly accountable if it is'],
    quoteMatchers: [/All Singapore-incorporated companies must:[\s\S]{0,180}unless exempted\./i, /A company meeting all requirements under section 201A[^.]*\./i, /Smaller and non-publicly accountable companies[^.]*\./i, /A smaller company meets both tests:[^.]*\./i, /Banks, finance and insurance companies[^.]*\./i, /Companies limited by guarantee[^.]*\./i, /All other Singapore-incorporated companies[^.]*\./i, /You do not need to file financial statements if you meet these criteria\./i, /However, you can choose to file financial statements voluntarily\./i, /Solvent EPCs which voluntarily choose to file\b/i],
    queryPattern: /\b(?:xbrl|taxonomy)\b[\s\S]{0,150}\b(?:filing|requirements?|template|full|simplified|financial statement|fs|from|effective|effective date)\b|\b(?:filing|requirements?|template|full|simplified|financial statement|effective date)\b[\s\S]{0,150}\b(?:xbrl|taxonomy)\b|\bfinancial statements?\b[\s\S]{0,120}\b(?:prepar\w*|file|filing|omit|exempt\w*|dormant|newly incorporat\w*)\b|\b(?:prepar\w*|file|filing|omit|exempt\w*|dormant|newly incorporat\w*)\b[\s\S]{0,120}\bfinancial statements?\b/i,
    subjectPattern: /\b(?:xbrl|financial statement(?:s)? filing(?: template| requirement)?|financial statement preparation|dormant company accounts?)\b/i
  },
  {
    id: 'ACRA_AGM_DEADLINES', authority: 'ACRA', topicIds: ['acra_agm'], officialUrl: ACRA_AGM_URL,
    title: 'Due dates and requirements for annual general meetings (AGMs)', fixtureFile: 'acra-agm-native.html',
    population: 'Singapore companies, subject to listed and private-company AGM exceptions',
    provisions: ['ACRA’s current company guidance; AGM deadline table explicitly applies to financial years ending on or after 31 August 2018.'],
    rule: 'For financial years ending on or after 31 August 2018, listed companies must hold an AGM within four months after FYE and non-listed companies within six months. A private company may skip the AGM if it meets a stated exemption or all members pass a resolution to dispense with it. Exempt or dispensed status does not remove the obligation to declare AGM details in its annual return; members retain the published rights to request a meeting.',
    conditions: ['Determine FYE and listed/non-listed status.', 'A private-company exemption and a unanimous resolution to dispense with an AGM are distinct routes; the conditions differ.', 'A member may request an AGM up to 14 days before the six-month deadline; after receiving financial statements, a member or auditor may request a general meeting within 14 days.'],
    exceptions: ['This ACRA page applies its deadline table to financial years ending on or after 31 August 2018.', 'The deadline page directs companies to apply for an extension of time before the AGM due date; check ACRA’s linked AGM extension-of-time page for the process and duration. Approval and eligibility remain separate questions.'],
    requiredFacts: ['Financial year-end and year of the period.', 'Listed, non-listed and private-company status.', 'Any exemption, unanimous dispensation resolution, member or auditor request, and extension decision.'],
    effectiveFrom: '2018-08-31', effectiveDateEvidence: 'The source labels the table “AGM deadlines: FY ending on or after 31 August 2018.”',
    limitations: ['Does not infer an entity’s exemption, unanimous resolution or extension approval.', 'Do not use this table for periods ending before the stated boundary.'],
    requiredSourceTerms: ['agm deadlines: fy ending on or after 31 august 2018', 'listed companies', 'within four months after fye', 'non-listed companies', 'within six months after fye', 'send financial statements to all members within five months after the fye', 'all members pass a resolution to dispense with the agm', 'declare your agm details', 'up to 14 days before the sixth month deadline'],
    quoteMatchers: [/AGM deadlines: FY ending on or after 31 August 2018[\s\S]{0,230}?Non-listed companies[\s\S]{0,80}?FYE\./i, /Private companies do not need to hold an AGM if they meet any of these criteria:[\s\S]{0,250}?Dormant/i, /Note: You must declare your AGM details[^.]*\./i],
    queryPattern: /\b(?:agm|annual general meeting)\b[\s\S]{0,180}\b(?:deadline|due|when|within|time|requirement|must|usual)\b|\b(?:deadline|due|when|within|usual)\b[\s\S]{0,180}\b(?:agm|annual general meeting)\b/i,
    subjectPattern: /\b(?:agm|annual general meeting|annual meeting)\b/i
  },
  {
    id: 'ACRA_AR_DEADLINES', authority: 'ACRA', topicIds: ['acra_annual-returns'], officialUrl: ACRA_AR_DEADLINES_URL,
    title: 'Deadline & requirements for annual returns', fixtureFile: 'acra-annual-return-deadlines-native.html',
    population: 'Companies that remain live with ACRA',
    provisions: ['ACRA annual-return filing and statutory deadline guidance; this page does not establish the rule’s historical commencement.'],
    rule: 'A live Singapore company must file an annual return each year, including if inactive or dormant or granted an IRAS tax waiver. The general deadline is five months after FYE for listed companies and seven months for non-listed companies. A company with share capital that keeps a branch register outside Singapore generally has an additional month. The filing deadline is separate from AGM compliance and tax filing.',
    conditions: ['Determine whether the company remains live, its listing status, FYE, share capital and any overseas branch register.', 'The filing date is calculated from the applicable period after FYE.'],
    exceptions: ['Inactivity and an IRAS tax-filing waiver do not remove the ACRA annual-return duty while the company is live.', 'This rule does not determine whether financial statements are exempt from filing.'],
    requiredFacts: ['Entity live status and type.', 'FYE and filing period.', 'Listed status, share capital and branch register maintained outside Singapore.'],
    effectiveDateEvidence: 'The annual-return deadline page does not state a historical commencement boundary.',
    limitations: ['The general deadlines here describe current guidance; a past filing year requires evidence for that year.', 'Check ACRA for a company-specific deadline and any approved extension.'],
    requiredSourceTerms: ['all companies in singapore must file annual returns with acra', 'listed companies | within five months after fye', 'listed companies with: a share capital an overseas branch register | within six months after fye', 'non-listed companies | within seven months after fye', 'non-listed companies with: a share capital an overseas branch register | within eight months after fye', 'annual return even if your company is', 'inactive or dormant', 'granted a tax waiver'],
    quoteMatchers: [/All companies in Singapore must file annual returns with ACRA[^.]*\./i, /Listed companies must file[^.]*\./i, /Non-listed companies must file[^.]*\./i, /Companies with a branch register outside Singapore[^.]*\./i],
    queryPattern: /^(?![\s\S]*\b(?:extension|eot|extend\w*|more time|more months|additional time|extra time)\b)(?:[\s\S]*\bannual[- ]returns?\b[\s\S]{0,180}\b(?:deadline|due|when|file|filing|within|months?|late|listed|private|usual)\b|[\s\S]*\b(?:deadline|due|when|file|filing|listed|private)\b[\s\S]{0,180}\bannual[- ]returns?\b)/i,
    subjectPattern: /\b(?:annual[- ]returns?|annual return deadline)\b/i
  },
  {
    id: 'ACRA_AUDIT_EXEMPTION', authority: 'ACRA', topicIds: ['acra_small_company', 'acra_audit-requirements'], officialUrl: ACRA_AUDIT_EXEMPTIONS_URL,
    title: 'Audit exemptions: Small company concept', fixtureFile: 'acra-audit-exemptions-native.html',
    population: 'Singapore private companies, including companies that are part of a group',
    provisions: ['ACRA states that its small-company audit exemption applies to financial years beginning on or after 1 July 2015.'],
    rule: 'Small-company audit exemption requires the entity to be a private company in the financial year and to meet at least two of the three quantitative criteria for each of the immediate past two consecutive financial years: revenue no more than S$10 million, assets no more than S$10 million, or no more than 50 full-time employees at FYE. A company that is less than two years old is assessed against criteria in its current year. A group also has to meet the separate consolidated small-group criteria.',
    conditions: ['Two of three criteria must hold for both immediately preceding consecutive financial years for an established company; “this year and last year” does not always establish that period.', 'The Singapore company and the entire group (including foreign entities) must each satisfy their respective test where the company is part of a group.', 'A qualifying company remains qualified until it ceases to be private or no longer meets at least two criteria over the immediate past two consecutive financial years.'],
    exceptions: ['The current-year test applies to a newly incorporated private company less than two years old.', 'A separate dormant-company audit exemption may apply; do not confuse audit exemption with relief from preparing financial statements or filing an annual return.'],
    requiredFacts: ['Private-company status during the financial year.', 'Revenue, total assets and full-time employee count for the immediate past two consecutive financial years.', 'If part of a group, the consolidated figures and entire-group scope.', 'Whether the company is newly incorporated or another audit exception is being considered.'],
    effectiveFrom: '2015-07-01', effectiveDateEvidence: 'ACRA expressly says the audit exemption applies to financial years beginning on or after 1 July 2015.',
    limitations: ['A company-specific conclusion needs two financial years’ facts and, for a group, consolidated facts.', 'Audit exemption does not exempt a company from keeping proper records, preparing financial statements, annual-return filing or tax filing.'],
    requiredSourceTerms: ['applies to financial years beginning on or after 1 july 2015', 'private company in the financial year', 'at least two of these quantitative criteria for the immediate past two consecutive financial years', 'total annual revenue of $10 million or less', 'total assets of $10 million or less', '50 employees or fewer', 'if your company is newly incorporated', 'less than two years old', 'your entire group (including foreign entities)'],
    quoteMatchers: [/To qualify for audit exemption as a small company[^.]*\./i, /Your company meets at least two[^.]*consecutive financial years:/i, /If your company is newly incorporated[^.]*two years old\./i, /Your entire group \(including foreign entities\)[\s\S]{0,200}?two consecutive financial years:/i],
    queryPattern: /\b(?:audit|auditor|audited|audit exemption)\b[\s\S]{0,180}\b(?:small|private|criteria|qualif\w*|exempt\w*|revenue|assets|employee|two|group|company|thresholds?|measures?)\b|\b(?:small[- ]company|small company|private company|quantitative criteria|audit exemption thresholds?)\b[\s\S]{0,180}\b(?:audit|exemption|qualif\w*|criteria|thresholds?|measures?|one|two|years?)\b/i,
    subjectPattern: /\b(?:audit|auditor|small company|private company)\b/i
  },
  {
    id: 'ACRA_FYE_CHANGE', authority: 'ACRA', topicIds: ['acra-entity-information-changes'], officialUrl: ACRA_FYE_URL,
    title: 'Step 4.2: Choosing a company’s financial year end (FYE)', fixtureFile: 'acra-fye-native.html',
    population: 'Singapore local companies changing their financial year end',
    provisions: ['ACRA company FYE selection and change guidance.'],
    rule: 'A company cannot change its FYE if it has already missed the applicable deadline for its AGM, annual return or sending its financial statements. FYE changes are otherwise subject to ACRA notification and to approval in the circumstances ACRA lists.',
    conditions: ['The company may change only its current or previous financial year.', 'ACRA approval is required if the new financial year would be longer than 18 months or if the company changed its FYE on or after 31 August 2018 and wants to change again within five years.'],
    exceptions: ['Whether a deadline was missed depends on the company’s AGM, annual-return and financial-statement due dates and whether an applicable extension was approved.'],
    requiredFacts: ['Company FYE, relevant reporting year, AGM/annual-return/financial-statement deadlines and whether any extension was approved.', 'Proposed FYE and previous FYE changes.'],
    effectiveDateEvidence: 'The guide was updated 29 January 2026; it expressly states the restrictions on the FYE change service but gives no separate commencement date for those instructions.',
    limitations: ['This is current ACRA guidance; the page does not establish historic application or whether ACRA would approve a particular proposed change.'],
    requiredSourceTerms: ['you can only change your current or previous financial year', 'you cannot change your fye if you missed the deadlines for your agm, ar, or sending of financial statements', 'your new financial year will be longer than 18 months', 'you changed your fye on or after 31 august 2018', 'want to change it again within five years'],
    quoteMatchers: [/You can only change your current or previous financial year\./i, /You cannot change your FYE if you missed[^.]*\./i, /You need ACRA['’]s approval if:[\s\S]{0,170}?within five years\./i],
    queryPattern: /\b(?:fye|financial year end)\b[\s\S]{0,180}\b(?:change|chang\w*|move|shift|extend|time|deadline|missed|late)\b|\b(?:change|chang\w*|move|shift|missed|late)\b[\s\S]{0,180}\b(?:fye|financial year end)\b/i,
    subjectPattern: /\b(?:financial year|fye|entity information|change)\b/i
  },
  {
    id: 'ACRA_OFFICER_UPDATE', authority: 'ACRA', topicIds: ['acra-entity-information-changes', 'acra_company-secretary'], officialUrl: ACRA_OFFICER_UPDATES_URL,
    title: 'Updating company information, officers & shareholders', fixtureFile: 'acra-updating-company-information-native.html',
    population: 'Singapore local companies and their directors and secretaries',
    provisions: ['ACRA current company-information and position-holder update guidance.'],
    rule: 'Report applicable company-information and officer particulars changes through Bizfile within 14 days. ACRA specifically lists a change to a position holder’s residential address; waiting for the next annual return does not satisfy that separate update deadline.',
    conditions: ['The 14-day updates described include a registered-office address change, changes to company officers/directors who join or leave, and changes to position-holder particulars such as a residential address.', 'Check the specific entity-change row for the applicable trigger and filing.'],
    exceptions: ['For a director’s resignation, first check the constitution and whether at least one ordinarily resident director remains. That is a separate condition from the reporting deadline.'],
    requiredFacts: ['What company or officer particular changed and the date of change.', 'For a director resignation, the constitution and whether another ordinarily resident director remains.'],
    effectiveDateEvidence: 'ACRA’s page is marked last updated 19 October 2026; it does not state a separate effective date for the listed update procedures.',
    limitations: ['Current page guidance; historical changes require contemporaneous evidence.', 'Does not decide whether a particular office-holder can resign without replacement.'],
    requiredSourceTerms: ['within 14 days to avoid penalties', 'update your entity information within 14 days', 'registered office address', 'company officers or directors who join or leave', 'update the appointment or withdrawal of position holders within 14 days', 'position holder details within 14 days', 'residential address'],
    quoteMatchers: [/Learn how to update any changes[^.]*\./i, /Update your entity information within 14 days[^.]*:/i, /Update the appointment or withdrawal of position holders within 14 days\./i, /Position holder details within 14 days if any of these changes:/i],
    queryPattern: /\b(?:company secretary|director|officer|position holder|residential address)\b[\s\S]{0,180}\b(?:residential address|particulars?|resign\w*|resignation|change|changed|update|withdraw\w*|leave|within 14 days)\b|\b(?:residential address|particulars?|resign\w*|resignation|changed|update|withdraw\w*|leave|within 14 days)\b[\s\S]{0,180}\b(?:company secretary|director|officer|position holder|residential address)\b/i,
    subjectPattern: /\b(?:officer|director|secretary|residential address|particulars?|entity information)\b/i
  },
  {
    id: 'ACRA_AR_EXTENSION', authority: 'ACRA', topicIds: ['acra_annual-returns', 'acra_agm'], officialUrl: ACRA_AR_EXTENSION_URL,
    title: 'Applying for an extension of time (EOT) to file annual returns', fixtureFile: 'acra-annual-return-extension-native.html',
    population: 'Singapore local companies with an annual-return deadline not yet passed',
    provisions: ['ACRA’s annual-return EOT guidance; the company selects an EOT for an AGM, an annual return or both.'],
    rule: 'A company may apply for a 60-day extension of its annual-return filing deadline, subject to ACRA’s eligibility and application decision. It must apply before the annual-return deadline; ACRA advises applying at least 14 working days early, and an application cannot be made online after the deadline has passed. An annual-return extension does not itself grant an AGM extension: the company must separately apply for the AGM or select both, and an approval is required.',
    conditions: ['ACRA states annual-return EOT eligibility for companies whose FYE is on or after 31 August 2018 and whose deadline has not passed.', 'Each annual-return EOT application costs S$200; processing is usually up to 14 working days and may take longer.', 'The eService lets the applicant request an AGM extension, an annual-return extension or both.'],
    exceptions: ['Further extensions require a separate application and are unlikely without strong supporting reasons.', 'An application does not establish approval or remove any other AGM or financial-statement duty.'],
    requiredFacts: ['Annual-return and AGM deadlines, FYE, whether the relevant deadline has passed, which obligation needs an extension and application status.'],
    effectiveFrom: '2018-08-31', effectiveDateEvidence: 'ACRA says the company’s FYE must be on or after 31 August 2018 to qualify for the annual-return EOT described on this page.',
    limitations: ['Does not predict whether ACRA will approve a particular request.', 'This annual-return EOT evidence does not establish a company’s AGM exemption.'],
    requiredSourceTerms: ['apply for a 60-day extension to file your annual return', 'at least 14 working days before your deadline', 'cannot be submitted online once the deadline has passed', 'has not passed the annual return deadline', 'has a financial year ending (fye) on or after 31 august 2018', 'extension of time for agm(s175) / ar(s197)', 'whether your company is listed on the singapore exchange', 'select whether your eot is for filing an annual return, holding an agm, or both'],
    quoteMatchers: [/Apply for a 60-day extension to file your annual return\./i, /EOT applications cannot be submitted online once the deadline has passed\./i, /Your company may apply for an EOT if it:[\s\S]{0,190}?31 August 2018\./i, /select whether your EOT is for filing an annual return[^.]*\./i],
    queryPattern: /\b(?:annual[- ]return|annual return)\b[\s\S]{0,150}\b(?:extension|eot|more time|two months|60[- ]day)\b|\b(?:extension|eot|more time|two months|60[- ]day)\b[\s\S]{0,150}\b(?:annual[- ]return|annual return)\b/i,
    subjectPattern: /\b(?:annual return|extension|filing requirement)\b/i
  },
  {
    id: 'ACRA_SECRETARY_APPOINTMENT', authority: 'ACRA', topicIds: ['acra_company-secretary', 'acra_directors'], officialUrl: ACRA_OFFICERS_URL,
    title: 'Step 4.3: Choosing company directors & other key officers', fixtureFile: 'acra-officers-native.html',
    population: 'Singapore-incorporated companies and their company directors and secretaries',
    provisions: ['ACRA’s current key-officers guidance on the Companies Act appointment requirements.'],
    rule: 'A company secretary must be appointed within six months of successful company registration, and the position cannot be vacant for more than six months. The secretary must be a natural person who meets the stated local-residency rules. The sole director cannot also act as the company secretary.',
    conditions: ['The secretary is a required officer; check eligibility and residency independently of the appointment deadline.', 'The single-director restriction applies where the only director would also be the secretary.'],
    exceptions: ['ACRA’s page does not establish an extension or waiver of the appointment requirement.'],
    requiredFacts: ['Successful registration date, current secretary, number of directors and which director is ordinarily resident.', 'Candidate’s status as an individual and compliance with local residency eligibility.'],
    effectiveDateEvidence: 'ACRA’s page is marked last updated 29 January 2026 and states the six-month appointment rule. It does not give a separate commencement date for the rule.',
    limitations: ['Current guidance; do not project this page onto an unverified historical incorporation period.', 'A company-specific eligibility assessment requires the officer facts listed above.'],
    requiredSourceTerms: ['every company must have at least one company director and one company secretary', 'secretary must be appointed within six months of successful registration', 'position cannot be empty for more than six months', 'not be the same person as the sole director', 'be a real person (not a company)', 'singapore citizen, singapore permanent resident'],
    quoteMatchers: [/A secretary must be appointed within six months of successful registration\./i, /Eligibility requirements[\s\S]{0,250}?Not be the same person as the sole director\./i],
    queryPattern: /\b(?:company secretary|secretary)\b[\s\S]{0,180}\b(?:appoint\w*|within|deadline|sole director|same person|vacan\w*|empty|incorporat\w*|registration)\b|\b(?:appoint\w*|deadline|sole director|same person|within)\b[\s\S]{0,180}\b(?:company secretary|secretary)\b/i,
    subjectPattern: /\b(?:secretary|director|officer)\b/i
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
    subjectPattern: /\b(?:sick|hospitali[sz]ation)\b[\s\S]{0,40}\bleave\b/i
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
    queryPattern: /\bpublic[- ]holida(?:y|ys)\b[\s\S]{0,180}\b(?:entitl|paid|pay|work|off|day|rate|employment act)\b|\b(?:entitl|paid|pay|work|off|day|rate)\b[\s\S]{0,180}\bpublic[- ]holida(?:y|ys)\b/i,
    subjectPattern: /\bpublic[- ]holida(?:y|ys)\b/i
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
  if (rule.id === 'ACRA_AR_OFFICER_PARTICULARS_20261020' && acraOfficerCommencementScope(query)) return false;
  const years = [...query.matchAll(/\b(?:19|20)\d{2}\b/g)].map(match => match[0]);
  const fyeDateText = parseCompanyFyeDate(query);
  const fyeDate = fyeDateText ? new Date(fyeDateText + 'T00:00:00.000Z') : undefined;
  const fyeTime = fyeDate?.getTime();
  const agmBoundary = Date.UTC(2018, 7, 31);
  const historicalRuleIntent = /\b(?:historical|historically|prior rules?|previous rules?|former requirements?|what applied|at that time|then-applicable|past rules?)\b/i.test(query);
  const currentAuditCriteriaFacts = rule.id === 'ACRA_AUDIT_EXEMPTION'
    && /\bmeet\w*\b[\s\S]{0,120}\bcriteria\b[\s\S]{0,100}\bthis year\b[\s\S]{0,40}\blast year\b/i.test(query);
  const currentAcraDeadlineFact = defaultTargetDateResolver.resolveAuthorityEvidenceDate(query).dateRole === 'CURRENT_WORKFLOW_FACT';
  if (rule.id === 'ACRA_AGM_DEADLINES' && currentAcraDeadlineFact && fyeTime !== undefined && fyeTime >= agmBoundary
      && fyeTime <= Date.UTC(2026, 11, 31)) return false;
  if (rule.id === 'ACRA_AR_DEADLINES' && currentAcraDeadlineFact && fyeDate
      && fyeDate.getUTCFullYear() >= 2025 && fyeDate.getUTCFullYear() <= 2026) return false;
  if (rule.id === 'ACRA_AR_EXTENSION' && fyeDate && fyeTime !== undefined && fyeTime >= agmBoundary
      && fyeTime <= Date.UTC(2026, 11, 31) && !historicalRuleIntent) return false;
  const auditStartDate = parseAcraDate(query, new RegExp(String.raw`\b(?:financial year|fy)\b[\s\S]{0,30}\b(?:beginning|starting|starts|commencing)\b[\s\S]{0,15}(${ACRA_DATE_CAPTURE})\b`, 'i'));
  if (rule.id === 'ACRA_AUDIT_EXEMPTION' && auditStartDate && auditStartDate.getTime() >= Date.UTC(2015, 6, 1)
      && !historicalRuleIntent) return false;
  if (rule.id === 'ACRA_SECRETARY_APPOINTMENT' && years.length === 1 && years[0] === '2026' && !historicalRuleIntent) {
    const registrationDate = parseAcraDate(query, new RegExp(String.raw`\b(?:incorporated|registered|registration)\b[\s\S]{0,90}?\b(?:on\s+)?(${ACRA_DATE_CAPTURE})\b`, 'i'));
    if (registrationDate && registrationDate.getTime() <= Date.UTC(2026, 11, 31)) return false;
  }
  if (rule.id === 'ACRA_OFFICER_UPDATE' && years.length === 0 &&
      /\b(?:next year['’]s annual return|wait until next year|next annual return)\b/i.test(query)) return false;
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
  if (!currentAuditCriteriaFacts && /\b(?:historical|historic|previous|prior|past|former|superseded|last financial year|next|coming|upcoming)\b/i.test(query)) return true;
  if (!currentAuditCriteriaFacts && /\b(?:last|previous|prior|past|next|coming|upcoming)\s+(?:\d+\s+)?(?:days?|weeks?|months?|quarters?|years?|financial years?|reporting periods?)\b/i.test(query)) return true;
  if (/\b(?:my|our)\s+(?:company|employee|employer|annual leave|sick leave|public holiday|final salary|termination)\b/i.test(query)) return false;
  return false;
}

function recognizeRule(input: Pick<AcraMomKnowledgeRuleRequest, 'authority' | 'topicId' | 'query' | 'subject'>): Rule | undefined {
  return RULES.find(rule => input.authority === rule.authority && rule.topicIds.includes(input.topicId)
    && rule.queryPattern.test(input.query) && rule.subjectPattern.test(input.subject));
}

/** True only for a current, registered audit-exemption request tied to its official ACRA URL. */
export function isAcraAuditExemptionContextRequest(input: AcraAuditExemptionContextRequest): boolean {
  const rule = recognizeRule(input);
  return rule?.id === 'ACRA_AUDIT_EXEMPTION' && exactOfficialUrl(input.officialUrl, rule.officialUrl)
    && !queryHasUnsupportedDate(input.query, rule);
}

function canonicalSourceProofText(rule: Rule, text: string): string {
  if (rule.id !== 'ACRA_AR_DEADLINES') return text;
  return text.replace(/(^|\s)[•◦▪](?=\s)/g, '$1 ')
    .replace(/\ba share capital;\s*an overseas branch register;\s*(?=\|)/gi,
      'a share capital an overseas branch register ')
    .replace(/\s+/g, ' ').trim();
}

function sourceSupports(rule: Rule, sourceText: string): boolean {
  if (rule.id === 'ACRA_AUDIT_EXEMPTION' && !supportsAcraSmallCompanyAuditFacts(sourceText)) return false;
  const text = canonicalSourceProofText(rule, cleanSourceText(sourceText));
  if (rule.id === 'ACRA_ANNUAL_RETURN_FILING_PROCESS' && !hasExactAcraAnnualReturnFee(text)) return false;
  if (rule.id === 'ACRA_XBRL_FINANCIAL_STATEMENT_TEMPLATES' && !hasExactAcraXbrlThresholds(text)) return false;
  if (rule.id === 'MOM_SICK_LEAVE_ENTITLEMENT' && !hasExactSickLeaveSchedule(text)) return false;
  if (rule.id === 'MOM_ANNUAL_LEAVE_ENTITLEMENT' && !hasExactAnnualLeaveProbationQualification(text)) return false;
  return hasRequiredSourceTerms(rule, text) && !sourceHasContradiction(rule, text);
}

function hasRequiredSourceTerms(rule: Rule, text: string): boolean {
  const rowTerms = rule.requiredSourceTerms.filter(term => term.includes('|'));
  const simpleTerms = rule.requiredSourceTerms.filter(term => !rowTerms.includes(term));
  return simpleTerms.every(term => text.includes(term.toLowerCase()))
    && rowTerms.every(term => {
      const source = /^listed companies\b/i.test(term)
        ? text.replace(/\bnon-listed companies\b/gi, 'nonlist companies') : text;
      const visibleRows = source.replace(/\s*\|\s*/g, ' ');
      return source.includes(term.toLowerCase())
        || visibleRows.includes(term.replace(/\s*\|\s*/g, ' ').toLowerCase());
    });
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
    ACRA_AGM_DEADLINES: /(?<!non[- ])\blisted companies\s*\|\s*within six months after fye|\bnon-listed companies\s*\|\s*within four months after fye|\bagm deadlines\b[^.]{0,100}\b(?:five|5|seven|7) months after fye/i,
    ACRA_AR_DEADLINES: /(?<!non[- ])\blisted companies\s*\|\s*within seven months after fye|\bnon-listed companies\s*\|\s*within five months after fye|(?<!non[- ])\blisted companies[^\n|]{0,60}\|[^\n|]{0,10}\|\s*within seven months after fye/i,
    ACRA_AUDIT_EXEMPTION: /\bsmall company audit exemption\b[^.]{0,120}\b(?:one|1) quantitative criteri(?:a|on)\b|\bimmediate past two consecutive financial years\b[^.]{0,120}\bcurrent financial year only\b/i,
    ACRA_FYE_CHANGE: /\byou can change your fye after (?:missing|you miss|you have missed) the deadline\b|\bmissed the deadlines?[^.]{0,80}\bfye can still be changed\b/i,
    ACRA_OFFICER_UPDATE: /\b(?:officer|position holder|residential address)[^.]{0,100}\b(?:does not need to|need not|not required to) (?:be updated|be filed|be reported)\b/i,
    ACRA_AR_EXTENSION: /\b(?:annual return|annual returns)[^.]{0,100}\b(?:30|ninety|90)[- ]day extension\b|\bcan apply[^.]{0,100}\bafter the deadline has passed\b/i,
    ACRA_SECRETARY_APPOINTMENT: /\bsole director\b[^.]{0,80}\b(?:can|may) (?:also )?(?:be|act as|serve as) (?:the )?(?:company )?secretary\b|\bsecretary is optional\b/i,
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
  if (rule.id === 'ACRA_AUDIT_EXEMPTION' && !supportsAcraSmallCompanyAuditFacts(input.sourceText)) return false;
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
  const annualReturnDeadlineTablePassage = rule.id === 'ACRA_AR_DEADLINES' && !htmlInput
    ? getAcraAnnualReturnDeadlineTablePassage(input.sourceText)
    : undefined;
  const statements = [...new Set([
    ...(annualReturnDeadlineTablePassage ? [annualReturnDeadlineTablePassage] : []),
    ...rawText.split(/\r?\n+/).map(value => value.trim()).filter(Boolean),
    ...rawText.split(/(?<=[.!?])\s+/).map(value => value.trim()).filter(Boolean)
  ])];
  let rowPremiseSpansBlocks = false;
  const quotes = rule.quoteMatchers.flatMap(pattern => {
    const statement = statements.find(value => pattern.test(value));
    return statement ? [statement] : [];
  });
  const quoteText = [...quotes];
  const selected = cleanSourceText(quoteText.join('\n'));
  for (const term of rule.requiredSourceTerms) {
    const visibleTerm = term.replace(/\s*\|\s*/g, ' ').toLowerCase();
    const canonicalSelected = canonicalSourceProofText(rule, selected);
    if (canonicalSelected.includes(term.toLowerCase()) || canonicalSelected.replace(/\s*\|\s*/g, ' ').includes(visibleTerm)) continue;
    const matchingStatement = statements.find(value => {
      const text = canonicalSourceProofText(rule, cleanSourceText(value));
      return text.includes(term.toLowerCase()) || text.replace(/\s*\|\s*/g, ' ').includes(visibleTerm);
    });
    if (!matchingStatement) {
      if (rule.id === 'ACRA_AR_DEADLINES' && term.includes('|')) {
        rowPremiseSpansBlocks = true;
        continue;
      }
      return [];
    }
    quoteText.push(matchingStatement);
  }
  const uniqueQuotes = [...new Set(quoteText)];
  const selectedSourceText = uniqueQuotes.join('\n');
  if (uniqueQuotes.every(value => value.length <= 5_000) && sourceSupports(rule, selectedSourceText)
      && (rule.id !== 'ACRA_AUDIT_EXEMPTION' || supportsAcraSmallCompanyAuditFacts(selectedSourceText))) return uniqueQuotes;
  if (rule.id === 'ACRA_AUDIT_EXEMPTION') {
    if (!htmlInput && input.sourceText.length <= 5_000 && sourceSupports(rule, input.sourceText)
        && supportsAcraSmallCompanyAuditFacts(input.sourceText)) return [input.sourceText];
    const auditQuotes = selectAcraSmallCompanyAuditFactsQuotes(input.sourceText);
    if (auditQuotes.length > 0 && sourceSupports(rule, auditQuotes.join('\n'))
        && supportsAcraSmallCompanyAuditFacts(auditQuotes.join('\n'))) return auditQuotes;
  }
  return rowPremiseSpansBlocks && rule.id === 'ACRA_AR_DEADLINES' && !htmlInput && input.sourceText.length <= 5_000
    ? [input.sourceText] : [];
}

/** Reports an explicit source contradiction for an owned family so broader fallbacks can be vetoed. */
export function hasAcraMomKnowledgeContradiction(input: AcraMomKnowledgeRuleRequest): boolean {
  const rule = recognizeRule(input);
  if (!rule) return false;
  return sourceHasContradiction(rule, canonicalSourceProofText(rule, cleanSourceText(input.sourceText)));
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

function answerText(rule: Rule, query: string): string {
  const scope = rule.id === 'ACRA_AR_OFFICER_PARTICULARS_20261020'
    ? acraOfficerCommencementScope(query) : undefined;
  const commencementClarification = scope?.filingDate
    ? scope.filingDate < '2026-10-20'
      ? 'The stated commencement does not make this new change applicable to the filing date supplied before 20 October 2026. This notice does not establish the complete requirements that governed that earlier filing.'
      : 'For a filing dated 20 October 2026 or later, the notice states that this change applies from its commencement date.'
    : scope
      ? 'The notice states that the new change applies from 20 October 2026; it does not establish what requirements governed filings before that date.'
      : '';
  let application = '';
  if (rule.id === 'ACRA_SECRETARY_APPOINTMENT') {
    const registrationDate = parseAcraDate(query, new RegExp(String.raw`\b(?:incorporated|registered|registration)\b[\s\S]{0,90}?\b(?:on\s+)?(${ACRA_DATE_CAPTURE})\b`, 'i'));
    const deadline = registrationDate ? addMonths(registrationDate, 6) : undefined;
    if (deadline) application = ` The stated registration date reaches its six-month appointment deadline on ${formatAcraDate(deadline)}.`;
  }
  if ([ 'ACRA_AGM_DEADLINES', 'ACRA_AR_DEADLINES' ].includes(rule.id)) {
    const fyeDateText = parseCompanyFyeDate(query);
    const fye = fyeDateText ? new Date(fyeDateText + 'T00:00:00.000Z') : undefined;
    const companyType = acraCompanyTypeForDeadline(query);
    const monthCount = rule.id === 'ACRA_AGM_DEADLINES' ? companyType === 'listed' ? 4 : 6
      : companyType === 'listed' ? 5 : 7;
    const deadline = fye && companyType ? addMonths(fye, monthCount) : undefined;
    if (deadline && companyType && fye) {
      const period = rule.id === 'ACRA_AGM_DEADLINES' ? 'AGM' : 'annual return';
      if (rule.id === 'ACRA_AR_DEADLINES') {
        const branchRegisterStatus = acraAnnualReturnBranchRegisterStatus(query);
        const branchDeadline = addMonths(fye, monthCount + 1);
        application = branchRegisterStatus === 'APPLIES'
          ? ` For the stated FYE and company type, the annual-return date is ${formatAcraDate(branchDeadline)} because the question also states share capital and an overseas branch register.`
          : branchRegisterStatus === 'EXCLUDED'
            ? ` For the stated FYE and company type, the annual-return date is ${formatAcraDate(deadline)}; the additional month does not apply on the stated company facts.`
            : ` For the stated FYE and company type, the general annual-return date is ${formatAcraDate(deadline)}. If the company has share capital and maintains an overseas branch register, one additional month applies, making the date ${formatAcraDate(branchDeadline)}.`;
      } else {
        application = ` For the stated FYE, the ${period} date is ${formatAcraDate(deadline)}, using the ${monthCount}-month rule for the identified company type.`;
      }
    }
  }
  return `${rule.rule} ${rule.conditions.join(' ')} ${rule.exceptions.join(' ')} A case-specific conclusion requires: ${rule.requiredFacts.join(' ')} ${rule.limitations.join(' ')} ${commencementClarification}${application}`.trim();
}

const ACRA_DATE_CAPTURE = String.raw`(?:\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+20\d{2}|\d{1,2}[/-]\d{1,2}[/-]20\d{2}|20\d{2}-\d{2}-\d{2})`;

function acraAnnualReturnBranchRegisterStatus(query: string): 'APPLIES' | 'EXCLUDED' | 'UNKNOWN' {
  const sentences = query.split(/[.!?;\n]+/).map(sentence => sentence.trim()).filter(Boolean);
  let affirmativeCompanyFacts = false;
  let excludedCompanyFacts = false;
  for (const sentence of sentences) {
    if (!/^\s*(?:it|we|our(?:\s+(?:private|listed|non[- ]listed|singapore(?:-incorporated)?))*\s+company|the(?:\s+(?:private|listed|non[- ]listed|singapore(?:-incorporated)?))*\s+company|this company)\b/i.test(sentence) ||
        /\b(?:if|whether|assuming|provided|unless|another|other|different|second|subsidiary|affiliate|competitor)\b/i.test(sentence) ||
        (sentence.match(/\bcompanies?\b/gi) || []).length > 1) continue;

    const shareCapitalExcluded = /\b(?:no|without)\b[^.!?;]{0,35}\bshare capital\b|\b(?:does not|doesn't|do not|don't)\s+have\b[^.!?;]{0,35}\bshare capital\b/i.test(sentence);
    const branchRegisterExcluded = /\b(?:no|without)\b[^.!?;]{0,60}\b(?:overseas|outside singapore)\b[^.!?;]{0,35}\bbranch register\b|\b(?:no|without)\b[^.!?;]{0,35}\bbranch register\b[^.!?;]{0,35}\b(?:overseas|outside singapore)\b|\b(?:does not|doesn't|do not|don't)\s+(?:have|keep|maintain)\b[^.!?;]{0,70}\bbranch register\b/i.test(sentence);
    if (shareCapitalExcluded || branchRegisterExcluded) excludedCompanyFacts = true;

    const hasShareCapital = /\b(?:has|have|with)\b[^.!?;]{0,35}\bshare capital\b/i.test(sentence);
    const hasOverseasBranchRegister = /\b(?:has|keeps?|maintains?)\b[^.!?;]{0,60}\b(?:overseas|outside singapore)\b[^.!?;]{0,35}\bbranch register\b|\b(?:has|keeps?|maintains?)\b[^.!?;]{0,35}\bbranch register\b[^.!?;]{0,35}\b(?:overseas|outside singapore)\b/i.test(sentence);
    if (hasShareCapital && hasOverseasBranchRegister) affirmativeCompanyFacts = true;
  }
  return excludedCompanyFacts ? 'EXCLUDED' : affirmativeCompanyFacts ? 'APPLIES' : 'UNKNOWN';
}

function acraCompanyTypeForDeadline(query: string): 'listed' | 'non-listed' | undefined {
  if (/\b(?:another|other|second|different|competitor)\s+(?:listed\s+|non[- ]listed\s+|private\s+)?company\b/i.test(query)) return undefined;
  const privateOrNonListed = /\bprivate company\b|\bnon[- ]listed company\b/i.test(query);
  const listed = /(?<!non[- ])\blisted company\b/i.test(query) && !/\bnot\s+(?:a\s+)?listed company\b/i.test(query);
  if (privateOrNonListed === listed) return undefined;
  return listed ? 'listed' : 'non-listed';
}

function parseAcraDate(query: string, pattern: RegExp): Date | undefined {
  const matches = [...query.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length !== 1) return undefined;
  const match = matches[0][1];
  if (!match) return undefined;
  const dateText = match.trim();
  let year: number;
  let month: number;
  let day: number;
  const namedMonth = /^(\d{1,2})\s+([a-z]+)\s+(20\d{2})$/i.exec(dateText);
  const numericDayFirst = /^(\d{1,2})[/-](\d{1,2})[/-](20\d{2})$/.exec(dateText);
  const iso = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(dateText);
  if (namedMonth) {
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    year = Number(namedMonth[3]);
    month = monthNames.indexOf(namedMonth[2].toLowerCase().slice(0, 3));
    day = Number(namedMonth[1]);
  } else if (numericDayFirst) {
    day = Number(numericDayFirst[1]);
    month = Number(numericDayFirst[2]) - 1;
    year = Number(numericDayFirst[3]);
  } else if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]) - 1;
    day = Number(iso[3]);
  } else return undefined;
  const parsed = new Date(Date.UTC(year, month, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month || parsed.getUTCDate() !== day) return undefined;
  if (/\b(?:another|other|second|different|competitor)\s+(?:listed\s+|non[- ]listed\s+|private\s+)?company\b/i.test(query)) return undefined;
  const matchedAt = matches[0].index ?? 0;
  const dateAt = matchedAt + matches[0][0].indexOf(match);
  const lead = query.slice(Math.max(0, dateAt - 60), dateAt);
  if (/\b(?:not|never)\s+(?:yet\s+)?(?:been\s+)?(?:incorporated|registered)\b/i.test(lead)) return undefined;
  return parsed;
}

function addMonths(date: Date, count: number): Date {
  const targetMonth = date.getUTCMonth() + count;
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(date.getUTCFullYear(), targetMonth, Math.min(date.getUTCDate(), lastDay)));
}

function formatAcraDate(date: Date): string {
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
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
  return { authority: rule.authority, title: source.title, officialUrl: rule.officialUrl, text: answerText(rule, query) };
}
