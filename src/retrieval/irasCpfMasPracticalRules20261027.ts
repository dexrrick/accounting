import type {
  AuthorityPresentedIssue,
  AuthorityPresentedSource,
  AuthorityPresentedWorkstream
} from '../utils/authorityEvidencePresentation';
import { groupExactIssueClaimsByDocument } from '../utils/authorityEvidencePresentation';
import { defaultTargetDateResolver, TargetDateResolver } from './targetDateResolver';

export interface IrasCpfMasPracticalRuleRequest {
  authority: string;
  topicId: string;
  query: string;
  subject: string;
  sourceText: string;
  officialUrl?: string;
}

export interface IrasCpfMasPracticalRuleEvidence {
  authority: 'IRAS' | 'CPF' | 'MAS';
  text: string;
  title: string;
  officialUrl: string;
}

export type IrasCpfMasPracticalRuleId =
  | 'IRAS_GST_STANDARD_RATED'
  | 'IRAS_GST_ZERO_RATED'
  | 'IRAS_GST_EXEMPT'
  | 'IRAS_GST_OUT_OF_SCOPE'
  | 'CPF_EMPLOYEE_COVERAGE'
  | 'CPF_CONTRIBUTION_COMPUTATION'
  | 'MAS_LFMC_FINANCIAL_RETURNS'
  | 'MAS_LFMC_CHANGE_NOTIFICATION';

export type IrasCpfMasPracticalSourceFixtureKind =
  | 'RAW_HTML_CAPTURE'
  | 'WEB_READ_LAYOUT_ADAPTED_VISIBLE_EXCERPT'
  | 'WEB_READ_PDF_VISIBLE_EXCERPT_LAYOUT_ADAPTED'
  | 'NATIVE_PDF_EXTRACT';

export interface IrasCpfMasPracticalRuleMetadata {
  id: IrasCpfMasPracticalRuleId;
  authority: 'IRAS' | 'CPF' | 'MAS';
  topicIds: readonly string[];
  officialUrl: string;
  title: string;
  fixtureFile: string;
  fixtureKind: IrasCpfMasPracticalSourceFixtureKind;
  population: string;
  rule: string;
  conditions: readonly string[];
  exceptions: readonly string[];
  requiredFacts: readonly string[];
  effectiveDateEvidence: string;
  limitations: readonly string[];
}

const IRAS_GST_STANDARD_RATED_URL = 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/charging-gst-(output-tax)/when-to-charge-goods-and-services-tax-(gst)';
const IRAS_GST_ZERO_RATED_URL = 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/filing-gst/completing-gst-returns';
const IRAS_GST_EXEMPT_URL = 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/basics-of-gst/goods-and-services-tax-(gst)-what-it-is-and-how-it-works';
const IRAS_GST_OUT_OF_SCOPE_URL = 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/charging-gst-(output-tax)/when-is-gst-not-charged/out-of-scope-supplies';
const CPF_EMPLOYEE_COVERAGE_URL = 'https://www.cpf.gov.sg/employer/employer-obligations/who-should-receive-cpf-contributions';
const CPF_CONTRIBUTION_COMPUTATION_URL = 'https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay';
const MAS_LFMC_TOOLKIT_URL = 'https://www.mas.gov.sg/-/media/mas-media-library/regulation/guidance/cmi/compliance-toolkits-for-fund-management-companies/sfa-compliance-toolkit-lfmcs29-may-2026-clean.pdf';

export const IRAS_CPF_MAS_PRACTICAL_RULES_20261027: readonly IrasCpfMasPracticalRuleMetadata[] = Object.freeze([
  {
    id: 'IRAS_GST_STANDARD_RATED', authority: 'IRAS', topicIds: ['iras-gst-standard-rated-supplies'],
    officialUrl: IRAS_GST_STANDARD_RATED_URL, title: 'When to charge Goods and Services Tax (GST)',
    fixtureFile: 'iras-gst-standard-rated.html', fixtureKind: 'RAW_HTML_CAPTURE',
    population: 'GST-registered businesses making supplies in Singapore',
    rule: 'A GST-registered business generally charges the prevailing 9% GST on local sales of goods and services unless the supply qualifies for a stated zero-rating or exemption.',
    conditions: ['The person making the supply is GST-registered.', 'The sale is a supply of goods or services made in Singapore.', 'The prevailing standard rate shown in the current IRAS guidance is 9%.'],
    exceptions: ['Exported goods and qualifying international services are taxable supplies charged at 0%.', 'Specified supplies are exempt and do not bear GST.'],
    requiredFacts: ['GST registration status and effective date.', 'What is supplied and the place of supply.', 'Whether a zero-rating or statutory exemption applies.'],
    effectiveDateEvidence: 'The official page viewed on 27 October 2026 displays 9% as the prevailing rate but the retained excerpt gives no effective-date boundary. The retrieval date is not treated as the rate commencement date.',
    limitations: ['Does not decide the place or time of supply, customer accounting, deemed supplies, registration duties, or a transaction-specific zero-rating/exemption.', 'Historical and future rates are not established by this current page.']
  },
  {
    id: 'IRAS_GST_ZERO_RATED', authority: 'IRAS', topicIds: ['iras-gst-zero-rating'],
    officialUrl: IRAS_GST_ZERO_RATED_URL, title: 'Completing GST Return',
    fixtureFile: 'iras-gst-zero-rated.html', fixtureKind: 'WEB_READ_LAYOUT_ADAPTED_VISIBLE_EXCERPT',
    population: 'GST-registered businesses making goods exports or international services',
    rule: 'Zero-rating applies to exported goods and international services that meet the statutory criteria; it is not available merely because the customer is overseas.',
    conditions: ['Goods must be exported, with sufficient export documentation and ability to confirm export at time of supply.', 'A service must qualify as an international service under the relevant rules.'],
    exceptions: ['Not all services provided to overseas customers qualify for zero-rating.', 'When export or international-service criteria are not met, the zero rate cannot be applied; determine the applicable category from the facts.'],
    requiredFacts: ['Whether goods or services are supplied.', 'For goods, the export time, destination, delivery chain, and supporting export documents.', 'For services, the nature and recipient facts required by the international-service rules.'],
    effectiveDateEvidence: 'The current official return-completion page was read on 27 October 2026. The excerpt states no historical effective period for the zero-rating conditions.',
    limitations: ['Does not enumerate every international-service category, export exception, or required document.', 'A customer address outside Singapore alone does not establish a zero-rated supply.', 'Historical treatment is unresolved without period-specific authority evidence.']
  },
  {
    id: 'IRAS_GST_EXEMPT', authority: 'IRAS', topicIds: ['iras-gst-exempt-supplies', 'iras-gst-zero-rating'],
    officialUrl: IRAS_GST_EXEMPT_URL, title: 'Goods and Services Tax (GST): What it is and how it works',
    fixtureFile: 'iras-gst-basics-native.html', fixtureKind: 'RAW_HTML_CAPTURE',
    population: 'GST-registered businesses making supplies specifically exempted under the GST Act',
    rule: 'Exempt supplies are specifically exempted under the GST Act and are not charged GST; they are distinct from taxable standard-rated and zero-rated supplies and from out-of-scope supplies.',
    conditions: ['A supply is exempt only where it falls within a category specifically exempted under the GST Act.', 'IRAS gives residential property and investment precious metal examples for goods, and financial services and digital payment tokens for services.'],
    exceptions: ['The listed examples are broad categories, not a determination that every related transaction is exempt.', 'The excerpt does not establish related input-tax recovery consequences.'],
    requiredFacts: ['Exact supply, underlying rights or property, and any transaction-specific statutory exception.', 'Place and capacity of the parties where relevant to the statutory category.'],
    effectiveDateEvidence: 'The official GST overview viewed on 27 October 2026 identifies digital payment token exemption from 1 January 2020; the other listed category descriptions do not establish a complete historical rule period.',
    limitations: ['Does not provide detailed exemption definitions or determine a specific financial, property, precious-metal, or token transaction.', 'Does not determine input-tax apportionment or recovery.', 'Historical/future application is not decided by the current overview.']
  },
  {
    id: 'IRAS_GST_OUT_OF_SCOPE', authority: 'IRAS', topicIds: ['iras-gst-out-of-scope-supplies'],
    officialUrl: IRAS_GST_OUT_OF_SCOPE_URL, title: 'Out-of-scope Supplies',
    fixtureFile: 'iras-gst-out-of-scope.html', fixtureKind: 'WEB_READ_LAYOUT_ADAPTED_VISIBLE_EXCERPT',
    population: 'Businesses making transactions outside the scope of the Singapore GST Act',
    rule: 'Out-of-scope supplies fall outside the GST Act; no GST is charged and the supplies described by IRAS are not reported in the GST return.',
    conditions: ['Examples include goods moved directly from a place outside Singapore to another place outside Singapore.', 'Some sales of overseas goods are out of scope while the goods remain within the same Free Trade Zone or Zero GST Warehouse.', 'Non-business activities without payment or expectation of return are private transactions treated as out of scope.'],
    exceptions: ['GST may become chargeable when goods are subsequently removed from an FTZ or Zero GST Warehouse.', 'The examples do not establish that every transaction involving overseas parties is out of scope.'],
    requiredFacts: ['Where the goods originate, move, and are delivered.', 'Whether goods remain in the same qualifying zone/warehouse.', 'Whether a transaction is a non-business private activity and whether consideration is expected.'],
    effectiveDateEvidence: 'The current official page was read on 27 October 2026; the selected text does not state historical effective boundaries.',
    limitations: ['Does not determine a particular goods movement or private-use transaction.', 'Does not cover deemed supplies, imports, reverse charge, or all transactions with an overseas party.', 'Historical/future application is not established.']
  },
  {
    id: 'CPF_EMPLOYEE_COVERAGE', authority: 'CPF', topicIds: ['cpf-employee-coverage'],
    officialUrl: CPF_EMPLOYEE_COVERAGE_URL, title: 'Who should receive CPF contributions',
    fixtureFile: 'cpf-employee-coverage.html', fixtureKind: 'RAW_HTML_CAPTURE',
    population: 'Employers and employees working in Singapore',
    rule: 'An employee generally includes a person employed in Singapore under a contract of service; employers contribute CPF for Singapore Citizens and Permanent Residents earning total wages above S$50 per month. Full-time, part-time, temporary, and contract employees are included.',
    conditions: ['Employee status is assessed under the CPF Act definition stated in the guidance.', 'The ordinary coverage rule applies to Singapore Citizens and Singapore Permanent Residents with monthly total wages exceeding S$50.', 'Part-time, temporary, and contract terms do not alone exclude an employee.'],
    exceptions: ['Foreigners who are not Singapore Citizens or Permanent Residents are exempt from receiving CPF contributions under this guidance.', 'Students who satisfy the stated school and exemption criteria are exempt.', 'The source identifies employees of the UN Organisation and its Singapore-based agencies/institutions/related organisations as exempt.'],
    requiredFacts: ['Whether there is a contract of service and where the employment is carried out.', 'Citizenship/PR status and relevant monthly total wages.', 'For a student exemption, institution and all applicable criteria.', 'Whether the organisation falls within the stated UN category.'],
    effectiveDateEvidence: 'CPF Board page last updated 22 June 2026. That update date is not an effective date; the excerpt provides no complete historical applicability period.',
    limitations: ['Does not decide ambiguous employee/contractor status, overseas secondments, interns, seafarer cases beyond the stated rule, or every student qualification.', 'Does not calculate contributions or determine platform-worker rules.', 'Historical status/rates require date-specific evidence.']
  },
  {
    id: 'CPF_CONTRIBUTION_COMPUTATION', authority: 'CPF', topicIds: ['cpf-contribution-computation'],
    officialUrl: CPF_CONTRIBUTION_COMPUTATION_URL, title: 'How much CPF contributions to pay',
    fixtureFile: 'cpf-contribution-computation.html', fixtureKind: 'RAW_HTML_CAPTURE',
    population: 'Employers calculating CPF for Singapore Citizen and Singapore Permanent Resident employees',
    rule: 'CPF contribution computation selects a rate table using citizenship/PR year, age group, and wage band; applies the rate to monthly total wages subject to separate OW and AW ceilings; then rounds the total and employee share under CPF Board guidance.',
    conditions: ['The employer ordinarily contributes for Singapore Citizens and Permanent Residents earning total wages above S$50 per month.', 'CPF contribution rates depend on citizenship status, age group, and total wages.', 'First-year SPR status begins on conversion; the second and third years begin on the first day of the month after the first and second anniversaries respectively.', 'Age-band rates change from the first day of the month after the relevant 55th, 60th, 65th, or 70th birthday.', 'Monthly total wages consist of Ordinary Wages and Additional Wages, subject to different ceilings.', 'The rate applies to total wages subject to CPF; the employer remits both employer and employee shares.'],
    exceptions: ['For monthly wages above S$50 and not more than S$500 there is no employee share, but the employer share remains payable.', 'The employee share cents are always dropped; total contributions are rounded to the nearest dollar with 50 cents rounded upward.', 'First- and second-year SPRs may jointly apply for specified higher contribution rates.'],
    requiredFacts: ['Citizenship and exact PR conversion date/status year.', 'Age on the relevant contribution month and birth date.', 'Ordinary and Additional Wages and the relevant month/year-specific ceilings.', 'Wage band, applicable contribution table, and any agreed higher SPR contribution option.'],
    effectiveDateEvidence: 'CPF Board page last updated 19 October 2026. It displays a current rate table from 1 January 2026 and separately announces changes from 1 January 2027. This rule explanation gives no historical calculation or future rate.',
    limitations: ['This is the computation sequence and wage-band exception, not an amount or numeric rate calculation.', 'Exact rates require the applicable contribution-year tables and complete employee payroll facts.', 'Historical and future contributions cannot be calculated from this current summary.']
  },
  {
    id: 'MAS_LFMC_FINANCIAL_RETURNS', authority: 'MAS', topicIds: ['mas-regulatory-reporting'],
    officialUrl: MAS_LFMC_TOOLKIT_URL, title: 'Compliance Toolkit for Licensed Fund Management Companies',
    fixtureFile: 'mas-lfmc-native-extract.txt', fixtureKind: 'NATIVE_PDF_EXTRACT',
    population: 'Licensed Fund Management Companies (LFMCs) covered by the SFA compliance toolkit',
    rule: 'The MAS toolkit says LFMCs submit quarterly financial Forms 1 and 2 within 14 days after each quarter end under Regulation 27 of the FMR, and audited annual returns (Forms 1 to 6 and the stated audited accounts/auditor materials) within five months after financial year end under section 107 of the SFA and Regulation 27 of the FMR.',
    conditions: ['Quarterly return: Form 1 Statement of Assets and Liabilities and Form 2 Statement of Financial Resources, Total Risk Requirement and Aggregate Indebtedness.', 'Annual return package: Forms 1 to 4, Form 5 Auditor’s Report, and Form 6 Auditor’s Certification.', 'Annual supporting materials include audited Profit and Loss Account and Balance Sheet made up to FYE and auditor’s report, including management letter if any.', 'Annual deadline is within five months from FYE.'],
    exceptions: ['The toolkit is expressly non-exhaustive and excludes SFA-external reporting obligations and fund-level requirements.', 'It applies to LFMCs; the excerpt does not establish identical requirements for VCFMs, CMS licensees carrying other regulated activities, or fund-level reports.'],
    requiredFacts: ['Whether the entity is an LFMC in scope of the SFA toolkit.', 'Quarter end or financial year end.', 'Applicable return type and any other activity-specific, licence-condition, or fund-level requirement.'],
    effectiveDateEvidence: 'The official PDF says issued 2 October 2020 and last revised 29 May 2026. This identifies the toolkit version, not the legal commencement date of every cited requirement.',
    limitations: ['Does not calculate filing dates or cover every MAS/SFA/FMR obligation.', 'Annual package is described from the current toolkit row; confirm current MAS-Tx instructions and primary legislation when filing.', 'Historical/future requirements are not established by this version.']
  },
  {
    id: 'MAS_LFMC_CHANGE_NOTIFICATION', authority: 'MAS', topicIds: ['mas-regulatory-reporting'],
    officialUrl: MAS_LFMC_TOOLKIT_URL, title: 'Compliance Toolkit for Licensed Fund Management Companies',
    fixtureFile: 'mas-lfmc-native-extract.txt', fixtureKind: 'NATIVE_PDF_EXTRACT',
    population: 'Licensed Fund Management Companies (LFMCs) covered by the SFA compliance toolkit',
    rule: 'The toolkit says an LFMC must notify MAS of a change of name or principal place of business within 14 days from the change, using a Notice for Change in Particulars under section 93 of the SFA.',
    conditions: ['The particulars changed are the LFMC name or principal place of business.', 'Deadline is within 14 days from the date of change.', 'The listed submission is Notice for Change in Particulars via the Entity Activities & Particulars MAS-Tx category.'],
    exceptions: ['The cited row was updated in August 2024; it does not state that Form 10 is the applicable notification for these entity particulars.', 'This toolkit is non-exhaustive and does not cover all SFA-external or fund-level obligations.'],
    requiredFacts: ['Whether the entity is an LFMC in scope.', 'Whether its name or principal place of business changed and on what date.', 'Current MAS-Tx submission instructions.'],
    effectiveDateEvidence: 'The toolkit identifies its current version as last revised 29 May 2026 and marks this row updated in August 2024; neither date is treated as the legal effective date.',
    limitations: ['Does not establish notification rules for director, representative, shareholder, controller, other particulars or other regulated entities.', 'Does not calculate the calendar deadline or establish historical applicability.', 'Confirm the current MAS-Tx form/category and underlying licence conditions for a filing.']
  }
]);

export const IRAS_CPF_MAS_PRACTICAL_SOURCE_CATALOG = Object.freeze(IRAS_CPF_MAS_PRACTICAL_RULES_20261027.map(rule => ({
  authority: rule.authority,
  topicId: rule.topicIds[0],
  url: rule.officialUrl,
  title: rule.title,
  fixtureFile: rule.fixtureFile,
  fixtureKind: rule.fixtureKind
})));

const MAX_QUOTE_LENGTH = 4_500;

function visibleText(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/(?:p|li|tr|table|div|section|article|h[1-6]|ul|ol|main|dt|dd|th|td)\s*>/gi, '\n')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/\u00a0/g, ' ').replace(/[\t\f\v ]+/g, ' ')
    .replace(/(\d)\s+(st|nd|rd|th)\b/gi, '$1$2')
    .replace(/\s+([,.;:!?])/g, '$1').replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function isCurrentGeneralQuestion(query: string): boolean {
  const currentDate = TargetDateResolver.CURRENT_SYSTEM_DATE;
  const currentYear = currentDate.slice(0, 4);
  if (/\b(?:historical|historic|past|previous|prior|former|superseded|future|upcoming|thereafter|hereafter|last financial year)\b/i.test(query)) return false;
  if (/\b(?:last|previous|prior|past|next|coming|following)\s+(?:\d+\s+)?(?:days?|weeks?|months?|quarters?|years?|financial years?|reporting periods?|tax years?)\b/i.test(query)) return false;
  if ([...query.matchAll(/\b(?:19|20)\d{2}\b/g)].some(match => match[0] !== currentYear)) return false;
  const dateComparison = /\b(?:before|prior to|after|following|until|through)\s+(?:the year\s+)?(?:(?:[0-3]?\d\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+)?((?:19|20)\d{2})\b/gi;
  if ([...query.matchAll(dateComparison)].some(match => match[1] === currentYear)) return false;
  if (/\b(?:last|previous|prior|past)\s+(?:\d+\s+)?(?:days?|weeks?|months?|quarters?|years?|financial years?|reporting periods?)\b/i.test(query)) return false;
  const resolved = defaultTargetDateResolver.resolveTargetDate(query, currentDate);
  return resolved.source !== 'EXPLICIT' || resolved.targetDate === currentDate;
}

function recognizesRule(input: Pick<IrasCpfMasPracticalRuleRequest, 'authority' | 'topicId' | 'query' | 'subject'>): IrasCpfMasPracticalRuleMetadata | undefined {
  const { authority, topicId, query, subject } = input;
  const text = `${query}\n${subject}`;
  const topicRules = IRAS_CPF_MAS_PRACTICAL_RULES_20261027.filter(rule => rule.authority === authority && rule.topicIds.includes(topicId));
  if (topicRules.length === 0) return undefined;

  if (authority === 'IRAS') {
    if (!/\b(?:gst|goods and services tax)\b/i.test(text)) return undefined;
    if (/\bexempt\b/i.test(text) && /\bzero[- ]rat(?:e|ed|ing)\b/i.test(text)) {
      const comparison = topicRules.find(rule => rule.id === 'IRAS_GST_EXEMPT');
      if (comparison) return comparison;
    }
    if (topicRules.some(rule => rule.id === 'IRAS_GST_STANDARD_RATED')
        && /\b(?:standard[- ]rated|standard rate|when to charge gst|charge gst on local sales)\b/i.test(text)) return topicRules.find(rule => rule.id === 'IRAS_GST_STANDARD_RATED');
    if (topicRules.some(rule => rule.id === 'IRAS_GST_ZERO_RATED')
        && /\b(?:zero[- ]rat(?:e|ed|ing)|export(?:ed|s)? goods?|international services?|overseas customers?)\b/i.test(text)) return topicRules.find(rule => rule.id === 'IRAS_GST_ZERO_RATED');
    if (topicRules.some(rule => rule.id === 'IRAS_GST_EXEMPT')
        && /\b(?:exempt supplies?|supplies? exempt|exempt from gst)\b/i.test(text)) return topicRules.find(rule => rule.id === 'IRAS_GST_EXEMPT');
    if (topicRules.some(rule => rule.id === 'IRAS_GST_OUT_OF_SCOPE')
        && /\b(?:out[- ]of[- ]scope|outside the scope|outside scope of gst|third[- ]country sales?|free trade zones?|zero gst warehouses?)\b/i.test(text)) return topicRules.find(rule => rule.id === 'IRAS_GST_OUT_OF_SCOPE');
  }

  if (authority === 'CPF'
      && /\b(?:comput\w*|calculat\w*|round(?:ing)?|low[- ]wage|wage threshold|how much cpf|contribution factors?|employee share|employer share|rate table|(?:above|below|between|exceeding|not more than|up to)\s+(?:s\$)?\$?\d)/i.test(text)
      && /\b(?:cpf|contribution)\b/i.test(text)) {
    const computationRule = topicRules.find(rule => rule.id === 'CPF_CONTRIBUTION_COMPUTATION');
    if (computationRule) return computationRule;
  }
  if (authority === 'CPF'
      && /\b(?:who should receive|who is entitled|who qualifies|who is covered|coverage|contract of service|part[- ]time|foreigners?|student exemption|citizens?|permanent residents?)\b/i.test(text)
      && /\b(?:cpf|contributions?|employment|employee|contract of service)\b/i.test(text)) {
    const coverageRule = topicRules.find(rule => rule.id === 'CPF_EMPLOYEE_COVERAGE');
    if (coverageRule) return coverageRule;
  }
  if (authority === 'MAS'
      && /\b(?:lfmc|licensed fund manager|filing calendar|regulatory reporting)\b/i.test(text)
      && /\b(?:quarterly|annual|yearly|financial|forms?\s*[1-6]|regulatory returns?|filings?|reporting|calendar)\b/i.test(text)
      && /\b(?:mas|lfmc|fund manager)\b/i.test(text)) {
    const financialRule = topicRules.find(rule => rule.id === 'MAS_LFMC_FINANCIAL_RETURNS');
    if (financialRule) return financialRule;
  }
  if (authority === 'MAS'
      && /\blfmc\b/i.test(text)
      && /\b(?:change of name|name change|changed (?:its |the )?name|business address|principal[- ](?:place|business)|main office)\b/i.test(text)
      && /\b(?:notify|notification|notice|report|told|deadline|within|14 days|form|how soon)\b/i.test(text)) {
    const changeRule = topicRules.find(rule => rule.id === 'MAS_LFMC_CHANGE_NOTIFICATION');
    if (changeRule) return changeRule;
  }
  return undefined;
}

function exactOfficialUrl(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  try {
    const url = new URL(actual);
    const wanted = new URL(expected);
    return url.protocol === 'https:' && url.hostname === wanted.hostname && url.pathname === wanted.pathname
      && !url.search && !url.hash && !url.username && !url.password;
  } catch {
    return false;
  }
}

function requiredPatterns(rule: IrasCpfMasPracticalRuleMetadata): readonly RegExp[] {
  switch (rule.id) {
    case 'IRAS_GST_STANDARD_RATED': return [
      /gst is charged at the prevailing rate of 9%/i,
      /gst-registered businesses must charge gst on all sales of goods and services made in singapore/i,
      /the following supplies are exceptions to the requirement to charge gst at the prevailing rate of 9%/i,
      /for exports of goods, gst is charged at 0% \(zero-rate\)\. zero-rated supplies are considered taxable supplies/i,
      /gst does not need to be charged on exempt supplies/i
    ];
    case 'IRAS_GST_ZERO_RATED': return [
      /goods: you cannot apply zero-rating if you are unable to confirm that the goods will be exported at the time of supply, or if you do not have sufficient export documentation/i,
      /services: zero-rating is not allowed if the service does not meet the criteria for an international service under the relevant rules/i,
      /supplies of international services as listed in section 21\(3\) of gst act/i,
      /providing international services \(not all services provided to overseas customers are zero-rated supplies\)/i
    ];
    case 'IRAS_GST_EXEMPT': return [
      /gst is only chargeable on taxable supplies, of which there are 2 types/i,
      /standard-rated supplies that are charged at the prevailing rate of gst \(i\.e\. 9%\); and zero-rated supplies that are charged at the rate of 0%/i,
      /exempt supplies: these are supplies specifically exempted from gst, under the gst act/i,
      /out-of-scope supplies: these are supplies that fall outside the scope of the gst act/i,
      /sale and rental of unfurnished residential property/i,
      /importation and local supply of investment precious metals/i,
      /financial services/i,
      /digital payment tokens/i
    ];
    case 'IRAS_GST_OUT_OF_SCOPE': return [
      /out-of-scope supplies include sale of goods not brought into singapore, sales of overseas goods within free trade zones and zero gst warehouses, and private transactions\. you do not charge gst on such supplies and do not report them in your gst return/i,
      /when you sell goods that are delivered directly from a place outside singapore to another place outside singapore, such supplies are out of scope/i,
      /when you sell overseas goods stored in an ftz to another party who receives them within the same ftz, such supplies are out of scope/i,
      /when goods are subsequently removed from the ftz, gst may be chargeable/i,
      /when you sell overseas goods stored in a zg warehouse to another party who receives them within the same warehouse, such supplies are out of scope/i,
      /when goods are subsequently removed from the zg warehouse, there may be gst implications/i,
      /non-business activities carried out without payment or any expectation of return from the recipients are treated as out-of-scope supplies/i
    ];
    case 'CPF_EMPLOYEE_COVERAGE': return [
      /under the cpf act, an employee is defined as/i,
      /a person who is employed in singapore under a contract of service/i,
      /a singapore citizen who is employed under a contract of service or other agreement entered into in singapore as a master, seaman or apprentice in any vessel/i,
      /an employee can be employed on the following terms:\s*full-time\s+part-time\s+temporary\s+contract/i,
      /employees who are singapore citizens or singapore permanent residents earning total wages of more than \$50 per month/i,
      /students who fulfil exemption criteria\s+from certain schools, madrasahs, private, or overseas tertiary education institutions/i,
      /foreigners?\s*persons who are not singapore citizens or singapore permanent residents/i,
      /employees of the united nations \(un\)\s+employees of the un organisation, or any agency, institution or related organisation of the un organisation that is located in singapore/i
    ];
    case 'CPF_CONTRIBUTION_COMPUTATION': return [
      /cpf contribution rates vary based on your employee['\u2019]s citizenship status, age group, and total wages/i,
      /singapore citizens or singapore permanent residents and who are earning total wages of more than \$50 per month/i,
      /table 1: singapore citizen or singapore permanent resident \(spr\) from the third year of spr status/i,
      /table 2: spr in the first year of spr status/i,
      /table 3: spr in the second year of spr status/i,
      /the first year begins on the day of spr conversion\s+the second year begins on the first day of the month after the first anniversary of spr conversion\s+the third year begins on the first day of the month after the second anniversary of spr conversion/i,
      /new contribution rates apply from the first day of the month after the employee['\u2019]s 55\s*th, 60\s*th, 65\s*th or 70\s*th birthday/i,
      /different rates apply for different wage bands/i,
      /total wages are made up of an employee['\u2019]s ordinary wages and additional wages\. different ceilings apply to ordinary wages and additional wages/i,
      /the total cpf contributions comprise both your share as the employer and your employee['\u2019]s share/i,
      /if your employee earns above \$50 but not more than \$500 per month, there is no employee['\u2019]s share of cpf contributions\. you will still need to pay the employer['\u2019]s share/i,
      /please round off the total cpf contributions to the nearest dollar\. cents should be dropped for amounts less than 50 cents, and amounts of 50 cents and above should be treated as an additional dollar\. the cents should always be dropped for the employee['\u2019]s share of cpf contributions/i
    ];
    case 'MAS_LFMC_FINANCIAL_RETURNS':
    case 'MAS_LFMC_CHANGE_NOTIFICATION': return [];
  }
}

/** Native PDF rows remain bounded by their adjacent row numbers, including
 * the annual row's continuation across a page break. Column labels are not
 * invented or required: every selected span comes from the extracted PDF. */
function nativeMasQuotes(rule: IrasCpfMasPracticalRuleMetadata, sourceText: string): string[] {
  const text = visibleText(sourceText).replace(/\s+/g, ' ').trim();
  const scope = /this compliance toolkit aims to provide LFMCs with a simple reference[\s\S]{0,1400}?relevant to:\s*\|?\s*LFMCs/i.exec(text)?.[0];
  const version = /version:\s*\|?\s*issued on 2 october 2020\s*\(last revised on 29 may 2026\)/i.exec(text)?.[0];
  if (!scope || !version || !/not exhaustive/i.test(scope)
      || !/excludes reporting obligations that fall outside the SFA\s*;\s*as well as fund-level requirements/i.test(scope)) return [];
  const row = (number: number, next: number): string | undefined => {
    const start = new RegExp(`\\b${number}\\s+To\\s+(?:submit|notify)\\s+`, 'i').exec(text);
    if (!start) return undefined;
    const tail = text.slice(start.index);
    const end = new RegExp(`\\b${next}\\s+To\\s+(?:submit|notify|report)\\s+`, 'i').exec(tail);
    // The selected row can be re-proved on its own without quoting the start
    // of a different obligation. Its last complete cell is a second boundary.
    const terminal = number === 13 ? /Particulars\)/i.exec(tail)
      : number === 37 ? /Indebtedness/i.exec(tail)
        : /Letter\s*\(if any\)/i.exec(tail);
    if (!end && !terminal) return undefined;
    const span = tail.slice(0, end ? end.index : terminal!.index + terminal![0].length).trim();
    return span.length < MAX_QUOTE_LENGTH ? span : undefined;
  };
  const plain = (span: string): string => span.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
  const includesAll = (span: string, patterns: RegExp[]): boolean => patterns.every(pattern => pattern.test(plain(span)));
  if (rule.id === 'MAS_LFMC_CHANGE_NOTIFICATION') {
    const change = row(13, 14);
    // The PDF extractor preserves table rows with line-wise column interleaving.
    // All these cells belong to row 13; no deadline can be borrowed from row 14.
    const requirements = [/To notify MAS of a change of name or a/i, /change of principal place of business/i,
      /Notice for Change in/i, /Particulars/i, /Within 14 days from/i, /the date of change/i,
      /Section 93 of the SFA/i, /MAS\s*[-–]\s*Tx/i, /Entity Activities &/i];
    return change && includesAll(change, requirements) && !/within (?!14\b)\d+ days/i.test(plain(change))
      ? [scope, version, change] : [];
  }
  const quarter = row(37, 38);
  const annual = row(38, 39);
  const quarterlyFacts = [/quarterly financial returns/i, /Form 1\s*[-–]\s*Statement of/i, /Assets and Liabilities/i,
    /Form 2\s*[-–]\s*Statement of/i, /Financial Resources,/i, /Total Risk Requirement/i,
    /and Aggregate/i, /Indebtedness/i, /Within 14 days from/i, /the end of each/i, /quarter/i,
    /Regulation 27 of the/i, /FMR/i, /MAS\s*[-–]\s*Tx/i, /Regular Data/i, /Returns/i];
  const annualFacts = [/audited annual financial returns/i, /and auditor['’]s report/i,
    /Form 1\s*[-–]\s*Statement of/i, /Assets and Liabilities/i,
    /Form 2\s*[-–]\s*Statement of/i, /Financial Resources,/i, /Total Risk Requirement/i,
    /and Aggregate/i, /Indebtedness/i,
    /Form 3\s*[-–]\s*Statement related to the Accounts of a Holder of a CMS Licence/i,
    /Form 4\s*[-–]\s*Statement relating to the Accounts of a Holder of a CMS Licence\s*[-–]\s*Supplementary Information/i,
    /Form 5\s*[-–]\s*Auditor['’]s Report\s*[-–]\s*For a Holder of a CMS Licence/i,
    /Form 6\s*[-–]\s*Auditor['’]s Certification\s*[-–]\s*For a Holder of a CMS Licence/i,
    /Within 5 months from/i, /the end of the financial/i, /year/i, /Section 107 of the SFA/i,
    /Regulation 27 of/i, /the FMR/i, /Audited Profit and Loss Account and Balance Sheet/i,
    /including Management Letter\s*\(if any\)/i];
  return quarter && annual && includesAll(quarter, quarterlyFacts) && includesAll(annual, annualFacts)
    && !/within (?!14\b)\d+ days/i.test(plain(quarter)) && !/within (?!5\b)\d+ months/i.test(plain(annual))
    ? [scope, version, quarter, annual] : [];

}

function proofText(rule: IrasCpfMasPracticalRuleMetadata, sourceText: string): string {
  let text = visibleText(sourceText);
  if (rule.id === 'IRAS_GST_EXEMPT') {
    const start = text.toLowerCase().lastIndexOf('types of taxable supplies and their gst rates');
    if (start >= 0) {
      text = text.slice(start);
      const end = text.toLowerCase().indexOf('who must register for gst');
      if (end >= 0) text = text.slice(0, end);
    }
  }
  return text.replace(/\s+/g, ' ').trim();
}

function requiredRuleFacts(rule: IrasCpfMasPracticalRuleMetadata, sourceText: string): boolean {
  if (rule.authority === 'MAS') return nativeMasQuotes(rule, sourceText).length > 0;
  const text = proofText(rule, sourceText);
  return requiredPatterns(rule).every(pattern => pattern.test(text));
}

function hasContradiction(rule: IrasCpfMasPracticalRuleMetadata, sourceText: string): boolean {
  const text = visibleText(sourceText).toLowerCase();
  if (/\b(?:it is false that|it is not true that|it is incorrect that|it is not the case that|does not state that)\b/.test(text)) return true;
  switch (rule.id) {
    case 'IRAS_GST_STANDARD_RATED': return /gst is charged at the prevailing rate of 9%[^.!?]{0,100}\b(?:all supplies|including exempt|even if exempt)\b/.test(text)
      || /(?:exempt|zero-rated) supplies?[^.!?]{0,80}\b(?:must|are required to) be charged at 9%/i.test(text);
    case 'IRAS_GST_ZERO_RATED': return /(?<!not )\b(?:all|every) services? provided to overseas customers?[^.!?]{0,100}\b(?:are|is) zero-rated/i.test(text)
      || /goods?[^.!?]{0,100}\bzero-rating (?:is allowed|applies)\b[^.!?]{0,100}\bwithout (?:export|documents?)/i.test(text);
    case 'IRAS_GST_EXEMPT': return /exempt supplies?[^.!?]{0,100}\b(?:are|is) (?:standard-rated|zero-rated)/i.test(text)
      || /(?:exempt supplies?|out-of-scope supplies?)[^.!?]{0,100}\b(?:must|are required to) charge gst/i.test(text);
    case 'IRAS_GST_OUT_OF_SCOPE': return /out-of-scope supplies?[^.!?]{0,100}\b(?:charge gst|report in (?:the )?gst return)/i.test(text)
      || /goods? (?:removed|taken) from (?:the )?(?:ftz|zg warehouse)[^.!?]{0,100}\bnever (?:attract|incur) gst/i.test(text);
    case 'CPF_EMPLOYEE_COVERAGE': return /part-time employees?[^.!?]{0,100}\b(?:are excluded|do not receive cpf|are not eligible)/i.test(text)
      || /foreigners?[^.!?]{0,100}\b(?:must receive|are entitled to) cpf contributions/i.test(text)
      || /employees earning (?:exactly )?\$50 or less[^.!?]{0,100}\b(?:must|have to) receive cpf contributions/i.test(text);
    case 'CPF_CONTRIBUTION_COMPUTATION': return /(?:employee|employee['\u2019]s) share[^.!?]{0,140}\b(?:payable|contributed)\b[^.!?]{0,60}\b(?:above )?\$50[^.!?]{0,40}\b(?:not more than|up to) \$500/i.test(text)
      || /employee['\u2019]s share[^.!?]{0,120}\b(?:round|keep|retain) cents/i.test(text)
      || /total cpf contributions[^.!?]{0,120}\bround(?:ed)? down to the nearest dollar/i.test(text);
    case 'MAS_LFMC_FINANCIAL_RETURNS': return /quarterly financial returns[^.!?]{0,100}\bwithin (?:five|5) months/i.test(text)
      || /annual financial returns[^.!?]{0,100}\bwithin (?:14|fourteen) days/i.test(text)
      || /toolkit excludes (?:all )?fund-level requirements[^.!?]{0,100}\bno other sfa returns/i.test(text);
    case 'MAS_LFMC_CHANGE_NOTIFICATION': return /change of name[^.!?]{0,120}\b(?:form 10|notice of cessation|no notification required)/i.test(text)
      || /change of principal place of business[^.!?]{0,120}\b(?:form 10|no notification required)/i.test(text);
  }
}

/** Owns only the listed current rule families and exact official sources. */
export function supportIrasCpfMasPracticalRule(input: IrasCpfMasPracticalRuleRequest): boolean | undefined {
  const rule = recognizesRule(input);
  if (!rule) return undefined;
  if (!isCurrentGeneralQuestion(input.query) || (input.officialUrl !== undefined && !exactOfficialUrl(input.officialUrl, rule.officialUrl))) return false;
  return !hasContradiction(rule, input.sourceText) && requiredRuleFacts(rule, input.sourceText);
}

/** Returns bounded source passages only when the full family has passed its proof checks. */
export function selectIrasCpfMasPracticalQuotes(input: IrasCpfMasPracticalRuleRequest): string[] {
  const rule = recognizesRule(input);
  if (!rule || !exactOfficialUrl(input.officialUrl, rule.officialUrl)
      || supportIrasCpfMasPracticalRule(input) !== true) return [];
  if (rule.authority === 'MAS') return nativeMasQuotes(rule, input.sourceText);
  const text = proofText(rule, input.sourceText);
  const quotes = requiredPatterns(rule).map(pattern => text.match(pattern)?.[0]?.trim());
  if (quotes.some(quote => !quote || quote.length > MAX_QUOTE_LENGTH)) return [];
  return quotes as string[];
}

export function hasIrasCpfMasPracticalContradiction(input: IrasCpfMasPracticalRuleRequest): boolean {
  const rule = recognizesRule(input);
  return rule ? hasContradiction(rule, input.sourceText) : false;
}

function issueSubjectMatches(rule: IrasCpfMasPracticalRuleMetadata, subject: string): boolean {
  switch (rule.authority) {
    case 'IRAS': return /\b(?:gst|supply|supplies|zero[- ]rat|exempt|standard[- ]rat|out[- ]of[- ]scope)\b/i.test(subject);
    case 'CPF': return /\b(?:cpf|contribution|employee|employer|wage)\b/i.test(subject);
    case 'MAS': return /\b(?:mas|lfmc|licensed fund management|financial return|regulatory reporting|notification)\b/i.test(subject);
  }
}

function sourceFor(rule: IrasCpfMasPracticalRuleMetadata, source: AuthorityPresentedSource, issueId: string): boolean {
  if (source.provenance !== 'LIVE_EXTERNAL' || source.validTo || source.officialUrl !== rule.officialUrl) return false;
  return groupExactIssueClaimsByDocument(source, issueId).some(group => {
    const text = group.map(claim => claim.text).join('\n\n');
    return requiredRuleFacts(rule, text) && !hasContradiction(rule, text);
  });
}

function answerText(rule: IrasCpfMasPracticalRuleMetadata): string {
  switch (rule.id) {
    case 'IRAS_GST_STANDARD_RATED': return 'IRAS’s current general rule is that a GST-registered business charges the prevailing 9% GST on sales of goods and services made in Singapore. That rule has exceptions: qualifying exports and international services are zero-rated, and specified supplies are exempt. A particular sale needs the supplier’s registration status, nature and place of supply, and any applicable exception assessed before its GST category is concluded.';
    case 'IRAS_GST_ZERO_RATED': return 'IRAS treats exported goods and services that qualify as international services as zero-rated taxable supplies. For goods, the business must be able to confirm export at the time of supply and retain sufficient export documents. For services, the service must meet the international-service criteria. An overseas customer alone does not make a service zero-rated. The exact transaction and relevant export or service facts are needed to determine its treatment.';
    case 'IRAS_GST_EXEMPT': return 'IRAS distinguishes zero-rated supplies, which remain taxable supplies charged at 0%, from exempt supplies, which are specifically exempted under the GST Act. Broad examples include residential-property sales or rentals and investment precious metals for goods, and financial services or digital payment tokens for services. These are categories, not blanket treatment for every related transaction; the exact supply and any statutory exception are needed to decide whether it is exempt. This summary does not determine input-tax recovery.';
    case 'IRAS_GST_OUT_OF_SCOPE': return 'IRAS describes out-of-scope supplies as transactions outside the scope of GST: the cited examples are not charged GST and are not reported in the GST return. They include third-country goods sales, some transfers of overseas goods within the same FTZ or Zero GST Warehouse, and private non-business activity without payment or expectation of return. GST may become chargeable when goods leave a zone or warehouse. The movement and transaction facts are needed for a particular supply.';
    case 'CPF_EMPLOYEE_COVERAGE': return 'CPF Board generally treats a person employed in Singapore under a contract of service as an employee; full-time, part-time, temporary and contract work arrangements can qualify. Employers generally contribute for Singapore Citizens and Permanent Residents earning more than S$50 total wages a month. The cited guidance exempts foreigners, students who meet the stated criteria, and specified Singapore-based United Nations employees. A particular worker’s CPF coverage depends on the actual employment relationship, citizenship or PR status, monthly wages and any applicable student or organisation exemption.';
    case 'CPF_CONTRIBUTION_COMPUTATION': return 'CPF Board’s computation steps use citizenship and SPR year, age group, wage band, and monthly total wages subject to the separate Ordinary and Additional Wage ceilings. For a covered employee earning wages above S$50 but not more than S$500 a month, the employee share is nil while the employer share remains due. Total contributions are rounded to the nearest dollar; cents are always dropped from the employee share. An amount cannot be established without the contribution period, current rate table, exact PR conversion and age dates, wage components, and applicable ceilings.';
    case 'MAS_LFMC_FINANCIAL_RETURNS': return 'MAS’s 29 May 2026 SFA compliance toolkit states that an LFMC files quarterly Forms 1 and 2 within 14 days after each quarter end under Regulation 27 of the FMR. It also lists annual audited Forms 1 to 6 and the audited Profit and Loss Account, Balance Sheet and auditor’s report (including a management letter, if any) within five months after financial year end under section 107 of the SFA and Regulation 27 of the FMR. The toolkit says it is non-exhaustive and excludes obligations outside the SFA and fund-level requirements. Confirm the entity’s LFMC scope, reporting period, and current MAS-Tx instructions before applying these deadlines. A complete reporting calendar also needs the licence and manager regime, regulated activities, fund types and reporting periods, plus checks for event-triggered notifications and duties outside this toolkit. One quarterly financial return does not establish that all MAS duties are discharged.';
    case 'MAS_LFMC_CHANGE_NOTIFICATION': return 'MAS’s 29 May 2026 SFA toolkit says an LFMC must notify MAS within 14 days after a change of name or principal place of business, using a Notice for Change in Particulars under section 93 of the SFA. The relevant MAS-Tx category is Entity Activities & Particulars. This rule is for the LFMC entity changes shown in the toolkit; confirm LFMC status, the change date, and current submission instructions. The toolkit is non-exhaustive and excludes fund-level and non-SFA reporting.';
  }
}

/** General rules may be shown while application remains unresolved; exact issue-bound claims must come from one source revision. */
export function getIrasCpfMasPracticalEvidence(
  query: string,
  stream: AuthorityPresentedWorkstream,
  issue: AuthorityPresentedIssue
): IrasCpfMasPracticalRuleEvidence | undefined {
  const rule = recognizesRule({ authority: stream.authority, topicId: ruleByTopicIdForIssue(stream.authority, query, issue.subject),
    query, subject: issue.subject });
  if (!rule || !isCurrentGeneralQuestion(query)) return undefined;
  const expectedDomain = rule.authority === 'IRAS' ? 'IRAS_GST'
    : rule.authority === 'CPF' ? 'CPF_PAYROLL' : 'MAS_FUNDS';
  const allowedPopulations = rule.authority === 'CPF' ? ['Employee', 'Employer'] : ['Company'];
  if (stream.authority !== rule.authority || stream.domain !== expectedDomain
      || !allowedPopulations.includes(issue.population)
      || !['NOT_REQUIRED', 'UNRESOLVED'].includes(issue.applicationStatus)
      || issue.evidenceStatus !== 'VERIFIED'
      || !['EXPLAIN_RULE', 'CHECK_ELIGIBILITY', 'FILING_REQUIREMENT'].includes(issue.operation)
      || !issueSubjectMatches(rule, issue.subject)
      || !stream.issues.some(candidate => candidate.id === issue.id && candidate.evidenceStatus === 'VERIFIED')) return undefined;
  const source = stream.sources.find(candidate => sourceFor(rule, candidate, issue.id));
  if (!source) return undefined;
  const reportingRegimeLimit = rule.id === 'MAS_LFMC_FINANCIAL_RETURNS' && /\b(?:vcfm|venture capital fund manager)\b/i.test(query)
    ? 'The cited toolkit addresses ordinary LFMC reporting. A VCFM must check its own applicable framework; the ordinary LFMC financial-return checklist cannot be transplanted automatically. ' : '';
  return { authority: rule.authority, title: source.title, officialUrl: rule.officialUrl, text: reportingRegimeLimit + answerText(rule) };
}

function ruleByTopicIdForIssue(authority: string, query: string, subject: string): string {
  if (authority === 'IRAS') {
    const text = `${query}\n${subject}`.toLowerCase();
    if (/\bexempt\b/.test(text) && /\bzero[- ]rat(?:e|ed|ing)\b/.test(text)) return 'iras-gst-exempt-supplies';
    if (/\b(?:zero[- ]rat(?:e|ed|ing)|international services?|overseas customers?|export(?:ed|s)? goods?)\b/.test(text)) return 'iras-gst-zero-rating';
    if (/\b(?:exempt supplies?|supplies? exempt|exempt from gst)\b/.test(text)) return 'iras-gst-exempt-supplies';
    if (/\b(?:out[- ]of[- ]scope|outside the scope|third[- ]country sales?|free trade zones?|zero gst warehouses?)\b/.test(text)) return 'iras-gst-out-of-scope-supplies';
    return 'iras-gst-standard-rated-supplies';
  }
  if (authority === 'CPF') {
    return /\b(?:comput\w*|calculat\w*|round(?:ing)?|low[- ]wage|employee.*(?:share|deduction)|employer share|contribution factors?)\b/i.test(`${query} ${subject}`)
      ? 'cpf-contribution-computation' : 'cpf-employee-coverage';
  }
  if (authority === 'MAS') {
    return 'mas-regulatory-reporting';
  }
  return '';
}
