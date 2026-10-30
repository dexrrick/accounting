import type {
  AuthorityPresentedIssue,
  AuthorityPresentedSource,
  AuthorityPresentedWorkstream
} from '../utils/authorityEvidencePresentation';
import { groupExactIssueClaimsByDocument } from '../utils/authorityEvidencePresentation';
import { defaultTargetDateResolver, TargetDateResolver } from './targetDateResolver';
import { hasConflictingMasNoticeIdentity, masSfa04N24CommencementScope } from './statutoryCommencementScope';

export interface IrasMasKnowledgeRequest {
  authority: string;
  topicId: string;
  query: string;
  subject: string;
  sourceText: string;
  officialUrl?: string;
}

export interface IrasMasKnowledgeEvidence {
  authority: 'IRAS' | 'MAS';
  text: string;
  title: string;
  officialUrl: string;
}

export type IrasMasKnowledgeRuleId =
  | 'IRAS_GST_STAFF_MEDICAL_INPUT_TAX'
  | 'IRAS_GST_MOTOR_CAR_INPUT_TAX'
  | 'IRAS_ECI_PRACTICAL_WAIVER'
  | 'IRAS_WHT_SERVICES'
  | 'IRAS_WHT_FILING_DATE'
  | 'MAS_SFA_MISCONDUCT_REPORTING_2027'
  | 'MAS_LFMC_TOOLKIT_SCOPE';

export type IrasMasKnowledgeFixtureKind = 'IRAS_NATIVE_HTML_PAGE' | 'IRAS_VISIBLE_PAGE_EXCERPT'
  | 'MAS_OFFICIAL_NOTICE_PDF_VISIBLE_TEXT_EXCERPT' | 'MAS_LFMC_TOOLKIT_NATIVE_PDF';

export interface IrasMasKnowledgeRuleMetadata {
  id: IrasMasKnowledgeRuleId;
  authority: 'IRAS' | 'MAS';
  topicIds: readonly string[];
  officialUrl: string;
  title: string;
  fixture: string;
  nativePdfFixture?: string;
  fixtureKind: IrasMasKnowledgeFixtureKind;
  authorityAndProvisions: readonly string[];
  population: string;
  rule: string;
  conditions: readonly string[];
  exceptions: readonly string[];
  requiredFacts: readonly string[];
  effectiveDateEvidence: string;
  limitations: readonly string[];
}

const IRAS_MEDICAL_URL = 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax';
const IRAS_MOTOR_URL = IRAS_MEDICAL_URL;
const IRAS_ECI_URL = 'https://www.iras.gov.sg/taxes/corporate-income-tax/estimated-chargeable-income-(eci)-filing';
const IRAS_WHT_SERVICES_URL = 'https://www.iras.gov.sg/taxes/withholding-tax/payments-to-non-resident-company/payments-that-are-subject-to-withholding-tax';
const IRAS_WHT_DATE_URL = 'https://www.iras.gov.sg/taxes/withholding-tax/withholding-tax-filing/withholding-tax-filing-and-payment-due-date';
const MAS_MISCONDUCT_URL = 'https://www.mas.gov.sg/-/media/mas-media-library/regulation/notices/cmg/notice-sfa-04-n24/notice-sfa-04-n24-reporting-of-misconduct-of-representatives.pdf?hash=C027656887BDCD18A5742523AA08B2A1&sc_lang=en';
const MAS_LFMC_TOOLKIT_URL = 'https://www.mas.gov.sg/-/media/mas-media-library/regulation/guidance/cmi/compliance-toolkits-for-fund-management-companies/sfa-compliance-toolkit-lfmcs29-may-2026-clean.pdf';

/** Source URLs, legal dates and scope are kept with the rule; fixtures identify their retained capture form. */
export const IRAS_MAS_KNOWLEDGE_RULES_20261027B: readonly IrasMasKnowledgeRuleMetadata[] = Object.freeze([
  {
    id: 'IRAS_GST_STAFF_MEDICAL_INPUT_TAX', authority: 'IRAS', topicIds: ['iras-gst-input-tax', 'iras-gst-blocked-input-tax'],
    officialUrl: IRAS_MEDICAL_URL, title: 'Conditions for Claiming Input Tax',
    fixture: 'iras-mas-input-tax-native.html', fixtureKind: 'IRAS_NATIVE_HTML_PAGE',
    authorityAndProvisions: ['GST (General) Regulations regulation 26, as identified in IRAS guidance'],
    population: 'GST-registered businesses claiming GST on staff medical expenses',
    rule: 'Staff medical input tax is generally blocked by regulation 26. Subject to ordinary input-tax conditions, IRAS lists expenses obligatory under WICA or a qualifying IRA collective agreement. For medical treatment connected to a work-related health risk or requirement for expenses incurred on or after 1 October 2021, the detailed conditions require either Singapore written law concerning the treatment/facility/practitioner or COVID-19 treatment required by a government/public-authority written advisory.',
    conditions: ['The claim must still meet the general conditions for input tax.', 'For the post-1 October 2021 work-risk route, the applicable written-law or COVID-19 advisory limb must also be met.'],
    exceptions: ['An ordinary staff health benefit does not by itself meet the described criteria.', 'IRAS specifically says Primary Care Plan expenses do not qualify on the described facts.'],
    requiredFacts: ['Expense and treatment date.', 'Whether WICA or an applicable collective agreement makes the expense obligatory.', 'If relying on the later exception, the work-related health risk/requirement and whether the claim relies on written law or COVID-19 advisory treatment.', 'GST registration, business use and supporting invoice/claim facts.'],
    effectiveDateEvidence: 'IRAS expressly says the work-related health-risk exception applies to medical treatment for expenses incurred on or after 1 October 2021. This does not establish a historical rule for other periods.',
    limitations: ['The retained fixture is the complete native IRAS page response captured on 26 October 2026; the capture date does not establish legal applicability.', 'This states the regulation 26 general rule and listed exception criteria, not a case conclusion or complete input-tax eligibility determination.', 'The linked table summary says “written law or advisory”; the page’s detailed condition limits its advisory limb to COVID-19 treatment. Do not omit that qualification.', 'Do not extend the post-2021 exception to unrelated medical, insurance or private expenses.']
  },
  {
    id: 'IRAS_GST_MOTOR_CAR_INPUT_TAX', authority: 'IRAS', topicIds: ['iras-gst-input-tax', 'iras-gst-blocked-input-tax', 'iras-gst-motor-vehicles'],
    officialUrl: IRAS_MOTOR_URL, title: 'Conditions for Claiming Input Tax — Motor Vehicles',
    fixture: 'iras-mas-input-tax-native.html', fixtureKind: 'IRAS_NATIVE_HTML_PAGE',
    authorityAndProvisions: ['GST (General) Regulations regulations 25(1) and 27, as identified in IRAS guidance'],
    population: 'GST-registered businesses incurring motor-car and motor-vehicle expenses',
    rule: 'Purchase and running input tax on a motor car is generally disallowed under regulation 27 unless the vehicle is excluded from the regulation 25(1) definition or a stated situation falls outside regulation 27. IRAS describes eligible pay-per-trip chauffeured private-hire transport from 1 April 2022, third-party use expenses from 1 January 2023, and other vehicles such as lorries, vans and motorcycles that are not motor cars, in each case subject to ordinary input-tax conditions.',
    conditions: ['A stated exception remains subject to the ordinary conditions for claiming input tax.', 'Connected-person use additionally requires expense recovery and a recovery that is not ancillary to a primary supply; a partial recovery limits the claim to the recovered part.'],
    exceptions: ['Cars physically or economically used by the claimant or its employees remain disallowed.', 'Connected-person car expenses remain disallowed unless both express recovery conditions are met.', 'A private-hire transport exception concerns a chauffeured point-A-to-point-B pay-per-trip service and valid invoice evidence, not purchase or lease of a car.'],
    requiredFacts: ['Whether the expense is car acquisition/running expense or transport service.', 'Vehicle category and who used the car, including physical and economic use.', 'For private-hire transport, pay-per-trip service and valid tax invoice.', 'For third-party/connected-person use, user relationship, recovery amount, and whether recovery is ancillary.'],
    effectiveDateEvidence: 'IRAS expressly dates the private-hire service exception from 1 April 2022 and the cited third-party/connected-person rules from 1 January 2023. These displayed dates do not establish unrelated historical motor-car rules.',
    limitations: ['The retained fixture is the complete native IRAS page response captured on 26 October 2026; the capture date does not establish legal applicability.', 'Does not classify a particular vehicle against the statutory definition or establish the complete rules for every motor-vehicle arrangement.', 'Do not infer transaction-period treatment from the page retrieval date.']
  },
  {
    id: 'IRAS_ECI_PRACTICAL_WAIVER', authority: 'IRAS', topicIds: ['iras-cit-eci', 'iras-investment-holding-company'],
    officialUrl: IRAS_ECI_URL, title: 'Estimated Chargeable Income (ECI) Filing',
    fixture: 'iras-mas-eci-native.html', fixtureKind: 'IRAS_NATIVE_HTML_PAGE',
    authorityAndProvisions: ['IRAS ECI filing guidance; the displayed excerpt identifies Income Tax Act 1947 section 43(2) for one named REIT category and sections 35(14), 35(12), and 35(12A) for the stated unit-trust note'],
    population: 'Singapore companies determining ECI filing obligations for a Year of Assessment',
    rule: 'A company generally files ECI within 3 months after financial year-end unless it meets the filing waiver or is specifically not required to file. The general waiver requires BOTH annual revenue of S$5 million or less for the financial year and nil ECI for the YA, measured before partial/start-up tax exemption. Revenue means the company’s main source of income; for an investment holding company it is investment income. Nil ECI alone, a book loss alone, or revenue alone does not establish the waiver.',
    conditions: ['Both waiver tests must be met for the relevant YA.', 'If the company is in a listed category specifically not required to file, that is a separate route from the general waiver.', 'A qualifying waiver is self-assessed; the source says no IRAS confirmation or notice is needed.'],
    exceptions: ['A company with nil ECI but annual revenue above S$5 million must still file.', 'Revenue at or below S$5 million with positive ECI must still file.', 'The displayed category list includes foreign ship owners/charterers with a shipping return, foreign universities, designated/approved CPF unit trusts, qualifying section 43(2) REITs, and cases specifically waived by IRAS.'],
    requiredFacts: ['Applicable financial year-end and YA.', 'Revenue from the principal/main income source (investment income for an investment holding company).', 'Tax ECI before partial/start-up exemption, not accounting profit or post-exemption taxable amount.', 'Whether a specifically excluded/waived entity category applies.'],
    effectiveDateEvidence: 'The official page provides current general wording and a worked example explicitly labelled for FYE 30 June 2024; that example is not taken as a complete historical effective-date statement for the current threshold.',
    limitations: ['The $5 million threshold and current examples are not projected to a historical or future YA without period-specific evidence.', 'ECI is taxable profits after tax-allowable expenses, not a direct synonym for accounting profit.', 'Does not calculate ECI or conclude the company-specific waiver without YA, revenue and tax-computation facts.', 'The retained fixture is the complete native IRAS page response captured on 26 October 2026; the capture date is not used as a legal applicability date.']
  },
  {
    id: 'IRAS_WHT_SERVICES', authority: 'IRAS', topicIds: ['iras-withholding-tax', 'iras-withholding-tax-management-fees'],
    officialUrl: IRAS_WHT_SERVICES_URL, title: 'Payments that are subject to withholding tax',
    fixture: 'iras-mas-wht-services-native.html', fixtureKind: 'IRAS_NATIVE_HTML_PAGE',
    authorityAndProvisions: ['Income Tax Act 1947 section 12(7)(b) and (c), as described in the linked IRAS service-payment guidance; treaty relief depends on the relevant DTA'],
    population: 'Singapore payers paying specified service/management income to a non-resident company',
    rule: 'For covered technical or management services paid to a non-resident company, WHT applies to fees attributable to work done in Singapore. Work performed partly overseas is apportioned to its Singapore-work portion. IRAS states a current 17% prevailing Corporate Income Tax rate on gross Singapore service fees, subject to the applicable DTA and facts; overseas electronic services without staff sent to Singapore are described as performed outside Singapore.',
    conditions: ['Identify whether the payee is a non-resident company and whether the payment is technical/management service income in scope.', 'Determine where work was physically performed and allocate mixed-location fees.', 'Review the payee’s residence, any Singapore permanent establishment, and the relevant DTA before applying a rate.'],
    exceptions: ['Services provided electronically from overseas without sending staff are stated to be performed outside Singapore.', 'Relevant DTAs can change treatment/rates, including permanent-establishment and technical-services provisions.', 'The old cost-pooling administrative concession applied only to payments liable before 1 November 2022; IRAS says it was withdrawn for payments liable on/after that date.'],
    requiredFacts: ['Payee legal/person type and tax residence.', 'Nature of service and contractual scope.', 'Singapore versus overseas work and basis for apportionment.', 'Service provision year, payment due/credit/actual dates, DTA and permanent-establishment facts.', 'Whether payer bears tax and must gross up the contractual payment.'],
    effectiveDateEvidence: 'The cited page states the cost-pooling concession boundary of 1 November 2022. The 17% rate is shown as the prevailing rate, without a complete historical rate table in this excerpt; it is not applied to historical/future service years by retrieval date.',
    limitations: ['The cited page’s service-rate example is for non-resident companies; non-resident individuals/professionals have separate rules.', 'The 17% prevailing rate is not universal: DTA provisions and relevant facts may change treatment.', 'The retained page does not provide a complete treaty-specific rate table or the full statutory analysis for every payment type.']
  },
  {
    id: 'IRAS_WHT_FILING_DATE', authority: 'IRAS', topicIds: ['iras-withholding-tax', 'iras-wht-filing-payment-due-date', 'iras-wht-deemed-payment-date', 'iras-wht-treaty-relief'],
    officialUrl: IRAS_WHT_DATE_URL, title: 'Withholding Tax (WHT) filing and payment due date',
    fixture: 'iras-mas-wht-deadline-native.html', fixtureKind: 'IRAS_NATIVE_HTML_PAGE',
    authorityAndProvisions: ['IRAS WHT filing and payment guidance'],
    population: 'Singapore payers required to file WHT on payments to non-residents',
    rule: 'File and pay WHT by the 15th of the second month from the IRAS-defined date of payment. For most payments that date is the earliest of contractual due date (or invoice date if no agreement, ignoring credit terms), credit to an account designated by the non-resident, and actual payment. Director fees have a separate entitlement timing rule.',
    conditions: ['Use the statutory/IRAS defined payment date rather than automatically using cash remittance date.', 'For director fees, distinguish arrears approval from advance approval before finding the earliest entitlement date.'],
    exceptions: ['WHT must still be filed when an applicable DTA or ARI reduces the rate to zero.', 'GIRO deduction is normally the 25th of the month the tax is due, moved to the next working day for a weekend/public holiday.', 'Eligible multiple payments for the same engagement to a non-resident professional/public entertainer within 60 days may be consolidated under the stated conditions.'],
    requiredFacts: ['Payment type and any director-fee status.', 'Contract payment-due date, invoice date, credit date and actual payment date.', 'Payee/person and whether a special consolidation or exemption applies.', 'Applicable tax due month and public holidays for GIRO.'],
    effectiveDateEvidence: 'IRAS page says last updated 14 August 2026 but the excerpt does not state a complete historical effective period; it is treated as current general guidance only.',
    limitations: ['Does not calculate an actual calendar due date without payment facts and calendar context.', 'The page does not enumerate every special payment rule or replace payment-specific guidance.', 'An exemption from WHT amount does not by itself remove the stated filing requirement.']
  },
  {
    id: 'MAS_SFA_MISCONDUCT_REPORTING_2027', authority: 'MAS', topicIds: ['mas-regulatory-reporting'],
    officialUrl: MAS_MISCONDUCT_URL, title: 'Notice SFA 04-N24 — Reporting of Misconduct of Representatives',
    fixture: 'iras-mas-misconduct.txt', nativePdfFixture: 'iras-mas-misconduct-native.pdf',
    fixtureKind: 'MAS_OFFICIAL_NOTICE_PDF_VISIBLE_TEXT_EXCERPT',
    authorityAndProvisions: ['Securities and Futures Act 2001 sections 99(1)(a)–(d) and 101(1); Notice SFA 04-N24 paragraphs 1, 2, 5, 20 and 21'],
    population: 'Holders of a capital markets services licence and persons exempt under SFA section 99(1)(a), (b), (c) or (d), regarding their current/former representatives',
    rule: 'Notice SFA 04-N24 takes effect on 1 January 2027. It applies to CMS licence holders and persons exempt under SFA section 99(1)(a)–(d), for misconduct by their current or former representatives. A CMI must submit a Misconduct Report no later than 21 calendar days after first having reasonable grounds to believe the representative committed misconduct, or such longer period as MAS allows in writing. Paragraphs 20–21 set transition rules for matters with pre-2027 reasonable grounds or reports already filed/due under the cancelled notice.',
    conditions: ['The subject is a current representative, or a former representative concerning misconduct during the representative period.', 'The 21-calendar-day period starts when the CMI first has reasonable grounds to believe the representative committed misconduct.', 'A longer reporting period applies only if the Authority allows it in writing.'],
    exceptions: ['For defined unfiled pre-2027 matters, paragraph 20 requires a report within 21 calendar days after 1 January 2027, or a longer period allowed in writing.', 'Paragraph 21 keeps the cancelled Notice applicable where a report was submitted before 1 January 2027 or was required by 31 December 2026.'],
    requiredFacts: ['Whether the entity is a CMS licence holder or exempt under SFA section 99(1)(a)–(d).', 'Whether the subject was a representative when the alleged conduct occurred.', 'The date first reasonable grounds arose.', 'Whether a report was submitted under the cancelled Notice before 1 January 2027 or was due by 31 December 2026.'],
    effectiveDateEvidence: 'The Notice itself says it takes effect on 1 January 2027, cancels SFA 04-N11 that day, and states transitional provisions for pre-2027 matters. The notice issue date (30 December 2025) is not treated as its effective date.',
    limitations: ['This bounded rule covers the Notice commencement, covered CMI population, initial Misconduct Report deadline and transitional provisions only; it does not explain Investigation Reports, Update Reports or all misconduct categories.', 'It is manager-level reporting about representatives and does not establish fund/VCC-level return requirements or QDC reporting.', 'The retained visible-text excerpt is limited to paragraphs 1, 2, 5, 20 and 21; the native official PDF is the primary document.', 'A company-specific conclusion requires the CMI status, representative period, reasonable-grounds date and transition facts.']
  },
  {
    id: 'MAS_LFMC_TOOLKIT_SCOPE', authority: 'MAS', topicIds: ['mas-lfmc'],
    officialUrl: MAS_LFMC_TOOLKIT_URL, title: 'Compliance Toolkit for Licensed Fund Management Companies',
    fixture: 'mas-lfmc-native-extract.txt', nativePdfFixture: 'mas-lfmc-toolkit.pdf',
    fixtureKind: 'MAS_LFMC_TOOLKIT_NATIVE_PDF',
    authorityAndProvisions: ['MAS LFMC SFA Compliance Toolkit, page 2 scope description; no statutory section is attributed to the toolkit.'],
    population: 'Licensed fund management companies using this SFA compliance toolkit',
    rule: 'MAS describes this toolkit as a reference to common applications, forms and submissions under the Securities and Futures Act that apply to LFMCs. MAS expressly says the toolkit is not exhaustive and excludes obligations outside the SFA and fund-level requirements, such as the Code of Collective Investment Schemes.',
    conditions: ['The scope statement applies to this LFMC toolkit and its stated SFA coverage.'],
    exceptions: ['This toolkit cannot be treated as a complete checklist of LFMC obligations, obligations outside the SFA, or fund-level requirements.'],
    requiredFacts: ['The applicable fund-level rules and other legislation must be identified separately for the relevant activities and fund.'],
    effectiveDateEvidence: 'The retained PDF is the version last revised 29 May 2026; its revision date identifies the document version, not the commencement of every requirement.',
    limitations: ['Do not generalise this LFMC toolkit scope to VCFMs, other licence classes or every MAS regulatory obligation.']
  }
]);

export const IRAS_MAS_KNOWLEDGE_SOURCE_CATALOG_20261027B = Object.freeze(IRAS_MAS_KNOWLEDGE_RULES_20261027B.map(rule => ({
  authority: rule.authority, topicId: rule.topicIds[0], topicIds: rule.topicIds,
  url: rule.officialUrl, title: rule.title, fixture: rule.fixture, fixtureKind: rule.fixtureKind,
  ...(rule.nativePdfFixture ? { nativePdfFixture: rule.nativePdfFixture } : {})
})));

type Rule = typeof IRAS_MAS_KNOWLEDGE_RULES_20261027B[number];
const MAX_QUERY_LENGTH = 800;
const MAX_PASSAGE_LENGTH = 5_000;

function plainText(value: string): string {
  return value.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/(?:p|li|tr|table|div|section|article|h[1-6]|ul|ol|main|dt|dd|th|td)\s*>/gi, '\n')
    .replace(/<br\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\u00a0/g, ' ')
    .replace(/[\t\f\v ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function queryText(input: Pick<IrasMasKnowledgeRequest, 'query' | 'subject'>): string {
  return `${input.query}\n${input.subject}`.slice(0, MAX_QUERY_LENGTH * 2);
}

function isCompleteIhcEciWaiverQuestion(query: string): boolean {
  const text = query.toLowerCase();
  return /\binvestment holding company\b/i.test(text) &&
    /\b(?:eci|estimated chargeable income)\b/i.test(text) &&
    /\bwaiv\w*\b/i.test(text) &&
    /\bdividends?\b/i.test(text) && /\binterest\b/i.test(text) &&
    /\brevenue\b/i.test(text) &&
    /\b(?:accounting|book) loss\b/i.test(text) && /\bnil eci\b/i.test(text) &&
    !/[?;]\s*\S/.test(query) && !/\b(?:separately|another question|separate issue)\b/i.test(text);
}

function isMedicalInsurancePremiumPremise(input: Pick<IrasMasKnowledgeRequest, 'query' | 'subject'>): boolean {
  return /\binsurance\s+premiums?\b|\b(?:medical|health|accident)\s+insurance\b|\binsurance\s+(?:policy|policies)\s+for\s+(?:medical|health|accident)\b/i.test(queryText(input));
}

type GstInputFamily = 'medical' | 'motor' | 'compound' | undefined;

function gstInputFamily(text: string, topicId: string): GstInputFamily {
  const hasGstClaim = /\b(?:input tax|input gst|gst claim|claim gst|gst)\b/i.test(text);
  if (!hasGstClaim) return undefined;
  const medicalAllowed = ['iras-gst-input-tax', 'iras-gst-blocked-input-tax'].includes(topicId);
  const motorAllowed = ['iras-gst-input-tax', 'iras-gst-blocked-input-tax', 'iras-gst-motor-vehicles'].includes(topicId);
  const medical = medicalAllowed && ( /\b(?:medical|health screening|primary care plan|pcp|work injury compensation)\b/i.test(text)
    || isMedicalInsurancePremiumPremise({ query: text, subject: '' }));
  const motor = motorAllowed && /\b(?:motor car|motor vehicle|private hire car|company car|vehicle expense|car expense|expenses? (?:for|of|on) (?:a\s+)?subsidiary(?:'s|’s)?\s+car)\b/i.test(text);
  if (medical && motor) return 'compound';
  if (medical) return 'medical';
  if (motor) return 'motor';
  return undefined;
}

function hasGstInputScopeConflict(input: Pick<IrasMasKnowledgeRequest, 'authority' | 'topicId' | 'query' | 'subject'>): boolean {
  if (input.authority !== 'IRAS') return false;
  const subjectFamily = gstInputFamily(input.subject, input.topicId);
  const queryFamily = gstInputFamily(input.query, input.topicId);
  return subjectFamily === 'compound' || queryFamily === 'compound'
    || Boolean(subjectFamily && queryFamily && subjectFamily !== queryFamily);
}

function namedRule(input: Pick<IrasMasKnowledgeRequest, 'authority' | 'topicId' | 'query' | 'subject'>): Rule | undefined {
  const text = queryText(input);
  if (input.authority === 'MAS' && input.topicId === 'mas-lfmc' &&
      /\b(?:lfmc|licensed fund management company|licensed investment manager)\b/i.test(text) &&
      /\b(?:toolkit|checklist)\b/i.test(text) &&
      /\b(?:complete|comprehensive|all duties|fund.level|outside (?:the )?sfa|non.sfa|scope)\b/i.test(text) &&
      !/\b(?:vcfm|venture capital fund manager|other licence class)\b/i.test(text)) {
    return IRAS_MAS_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'MAS_LFMC_TOOLKIT_SCOPE');
  }
  if (input.authority === 'IRAS') {
    // The issue/concept subject owns the family. The original query can clarify
    // a generic subject, but cannot redirect an already specific subject.
    const subjectFamily = gstInputFamily(input.subject, input.topicId);
    if (subjectFamily === 'medical') return IRAS_MAS_KNOWLEDGE_RULES_20261027B[0];
    if (subjectFamily === 'motor') return IRAS_MAS_KNOWLEDGE_RULES_20261027B[1];
    if (subjectFamily === 'compound') return undefined;
    const queryFamily = gstInputFamily(input.query, input.topicId);
    if (queryFamily === 'medical') return IRAS_MAS_KNOWLEDGE_RULES_20261027B[0];
    if (queryFamily === 'motor') return IRAS_MAS_KNOWLEDGE_RULES_20261027B[1];
    if (queryFamily === 'compound') return undefined;
  }
  if (input.authority === 'IRAS' &&
      (input.topicId === 'iras-cit-eci' ||
        input.topicId === 'iras-investment-holding-company' && isCompleteIhcEciWaiverQuestion(input.query)) &&
      /\b(?:eci|estimated chargeable income)\b/i.test(text) &&
      /\b(?:waiv\w*|nil|revenue|profit|loss|threshold|eligib\w*|qualif\w*|condition\w*|exempt\w*)\b/i.test(text)) {
    return IRAS_MAS_KNOWLEDGE_RULES_20261027B[2];
  }
  const isWhtQuestion = /\b(?:wht|withholding tax)\b/i.test(text);
  if (input.authority === 'IRAS' && ['iras-withholding-tax', 'iras-withholding-tax-management-fees'].includes(input.topicId)
      && isWhtQuestion && /\b(?:service|management|consultancy|technical|professional)\b/i.test(text)
      && /\b(?:non[- ]resident|overseas|foreign|Singapore|performed|rendered|where|rate|work)\b/i.test(text)) {
    return IRAS_MAS_KNOWLEDGE_RULES_20261027B[3];
  }
  if (input.authority === 'IRAS' && ['iras-withholding-tax', 'iras-wht-filing-payment-due-date', 'iras-wht-deemed-payment-date', 'iras-wht-treaty-relief'].includes(input.topicId)
      && isWhtQuestion && ( /\b(?:due date|deadline|when to file|date of payment|second month|file by|payment date)\b/i.test(text)
        || (/\b(?:treaty|DTA|ARI|zero[- ]rate|exempt(?:ed|ion)?)\b/i.test(text)
          && /\b(?:fil\w*|submit\w*|return|lodge\w*|obligation|required)\b/i.test(text)))) {
    return IRAS_MAS_KNOWLEDGE_RULES_20261027B[4];
  }
  if (input.authority === 'MAS' && input.topicId === 'mas-regulatory-reporting'
      && /\b(?:misconduct|representative misconduct|misconduct report)\b/i.test(text)
      && /\b(?:representative|CMS licence|capital markets services|SFA 04-N24|new notice|1 January 2027|2027)\b/i.test(text)) {
    return IRAS_MAS_KNOWLEDGE_RULES_20261027B[5];
  }
  return undefined;
}

function hasNonCurrentScope(query: string, rule: Rule): boolean {
  if (rule.id === 'MAS_SFA_MISCONDUCT_REPORTING_2027' && masSfa04N24CommencementScope(query)) return false;
  if (query.length > MAX_QUERY_LENGTH || /\b(?:historical|historic|last year|previous|prior period|past period|former rule|superseded rule)\b/i.test(query)) return true;
  const asksLegalVersion = /\b(?:effective(?: date)?|in force|came into force|took effect|commenced on|which law applied|governed by|legal|statutory)\b/i.test(query);
  const hasDatedWhtPayment = rule.id === 'IRAS_WHT_FILING_DATE' && !asksLegalVersion &&
    /\b(?:paid|pay|payment|date of payment)\b/i.test(query) &&
    /\b\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+2026\b|\b2026[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}[-/]\d{1,2}[-/]2026\b/i.test(query);
  const years = [...query.matchAll(/\b(?:19|20)\d{2}\b/g)].map(match => Number(match[0]));
  const currentYear = Number(TargetDateResolver.CURRENT_SYSTEM_DATE.slice(0, 4));
  if (rule.id === 'MAS_SFA_MISCONDUCT_REPORTING_2027') {
    const newNoticeOnly = /\b(?:2027|1\s+(?:jan(?:uary)?)\s+2027|SFA\s*04[-–]N24|new (?:notice|requirement|rule))\b/i.test(query);
    const knownTransition = /\b(?:before|prior to)\s+1\s+(?:jan(?:uary)?)\s+2027\b/i.test(query);
    return !newNoticeOnly || years.some(year => year !== 2026 && year !== 2027)
      || (years.includes(2026) && !knownTransition && !/\b(?:filed|deadline|due by)\s+(?:in\s+)?2026\b/i.test(query));
  }
  if (years.some(year => year !== currentYear)) {
    const evidencedBoundary = rule.id === 'IRAS_GST_STAFF_MEDICAL_INPUT_TAX'
      ? years.every(year => year === 2021) && /\b(?:from|on or after|effective)\b/i.test(query)
      : rule.id === 'IRAS_GST_MOTOR_CAR_INPUT_TAX'
        ? years.every(year => year === 2022 || year === 2023) && /\b(?:from|on or after|effective|exception began)\b/i.test(query)
        : false;
    if (!evidencedBoundary) return true;
  }
  if (/\b(?:future|upcoming|next|thereafter|before|after|for|during)\s+(?:19|20)\d{2}\b/i.test(query)) return true;
  const resolved = defaultTargetDateResolver.resolveTargetDate(query, TargetDateResolver.CURRENT_SYSTEM_DATE);
  return resolved.source === 'EXPLICIT' && resolved.targetDate !== TargetDateResolver.CURRENT_SYSTEM_DATE
    && !((rule.id === 'IRAS_GST_STAFF_MEDICAL_INPUT_TAX' && resolved.targetDate === '2021-10-01')
      || (rule.id === 'IRAS_GST_MOTOR_CAR_INPUT_TAX' && ['2022-04-01', '2023-01-01'].includes(resolved.targetDate ?? ''))
      || (hasDatedWhtPayment && resolved.targetDate?.startsWith(`${currentYear}-`)));
}

function toolkitScopePassagePatterns(): RegExp[] {
  return [
    /This Compliance Toolkit aims to provide guidance on:[\s\S]{0,500}?Applications for approvals from MAS;[\s\S]{0,300}?Notifications to be submitted to MAS;[\s\S]{0,300}?Regulatory submissions to MAS[\s\S]{0,160}?applicable to LFMCs/i,
    /This compliance toolkit aims to provide LFMCs with a simple reference[^.]{0,250}?applicable to LFMCs\.[\s\S]{0,180}?However, it is not exhaustive,[\s\S]{0,220}?all legislations and requirements that are applicable to them\./i,
    /For the avoidance of doubt, this toolkit excludes reporting obligations that fall outside the SFA; as well as fund-level requirements \(e\.g\. Code of Collective Investment Scheme\)\./i
  ];
}

function passagePatterns(rule: Rule): RegExp[] {
  switch (rule.id) {
    case 'IRAS_GST_STAFF_MEDICAL_INPUT_TAX': return [
      /Input tax claims are disallowed under Regulation 26 of the GST \(General\) Regulations\./i,
      /However, subject to the conditions for input tax claim, these claims are allowed if:[\s\S]{0,650}?mandated by written law or advisory\s*\./i,
      /the medical treatment in respect of expenses incurred on or after 1 Oct 2021 is provided in connection with any health risk or requirement arising on account of the nature of the work required of your staff or his work environment; and[\s\S]{0,900}?Government or a public authority of Singapore\./i,
      /No, GST incurred on PCP will not be claimable\.[\s\S]{0,650}?will not be claimable\./i,
      /Can I claim the GST charged on medical examinations incurred for the purpose of renewing my employees[’'] work permits\?\s*No, the input tax on such examinations is blocked as medical expenses under Regulation 26 of the GST \(General\) Regulations\./i
    ];
    case 'IRAS_GST_MOTOR_CAR_INPUT_TAX': return [
      /Input tax claims on purchase and running expenses of motor cars are disallowed under Regulation 27[\s\S]{0,700}?conditions for input tax claim\./i,
      /Yes, from 1 Apr 2022 onwards,[\s\S]{0,550}?GST has been charged on the services\./i,
      /Yes, from 1 Jan 2023, where you incur expenses on a motor car that is used by a third party,[\s\S]{0,550}?conditions for claiming input tax are met/i,
      /Input tax claims on motor car expenses for cars used by you or your employees are disallowed under Regulation 27[\s\S]{0,500}?economic use[\s\S]{0,250}?fee\)\./i,
      /No, from 1 Jan 2023, where you incur expenses on a motor car used by a person connected to you[\s\S]{0,600}?primary supply made by you to the connected person\./i,
      /Yes, input tax claims are allowed on motor vehicles[\s\S]{0,250}?conditions for claiming input tax are met\./i
    ];
    case 'IRAS_ECI_PRACTICAL_WAIVER': return [
      /ECI is an estimate of your company's taxable profits \(after deducting tax-allowable expenses\) for a Year of Assessment \(YA\)\./i,
      /Your company has to file ECI within 3 months from the end of your financial year unless:[\s\S]{0,250}?specifically not required to file ECI\./i,
      /Your company does not need to file ECI in any Year of Assessment \(YA\) when both criteria are met:[\s\S]{0,1200}?start-up companies\s*\./i,
      /Revenue refers to a company's main source of income[\s\S]{0,350}?investment income \(e\.g\. dividend income and interest income\)\./i,
      /Your company is required to self-assess if it qualifies for the ECI filing waiver\./i,
      /If your company falls within 1 of the following categories, it does not need to file ECI:[\s\S]{0,650}?Cases specifically granted the waiver to furnish ECI by IRAS/i,
      /If your company's ECI is nil and its annual revenue is more than \$5 million, you are still required to file the ECI\./i
    ];
    case 'IRAS_WHT_SERVICES': return [
      /Where payment is made to a non-resident company for the installation of equipment[\s\S]{0,760}?work done in Singapore\s*\./i,
      /Similarly, where payment is made to a non-resident company for the management[\s\S]{0,300}?work done in Singapore\./i,
      /However, if the non-resident company provides the services via electronic means from overseas[\s\S]{0,300}?withholding tax is not applicable\./i,
      /Where cost reimbursement payment is made on or before 31 Oct 2022 to a non-resident related party for services rendered in Singapore under a cost-pooling arrangement,[\s\S]{0,300}?withholding tax is not applicable on such payment\.[\s\S]{0,220}?With effect from 1 Nov 2022, this administrative concession will be withdrawn\. Withholding tax will be applicable to any cost reimbursement payment liable to be made on or after 1 Nov 2022[\s\S]{0,220}?cost-pooling arrangement\./i,
      /For services performed in Singapore, withholding tax is to be imposed at the prevailing Corporate Income Tax rate of 17%[\s\S]{0,550}?will be refunded\./i,
      /If the company is a resident of a jurisdiction with which Singapore has an Avoidance of Double Tax Agreement \(DTA\)[\s\S]{0,200}?provision of the DTA\./i,
      /if the services are rendered wholly or partly outside Singapore, only the payment attributable to the services rendered in Singapore is subject to withholding tax\./i
    ];
    case 'IRAS_WHT_FILING_DATE': return [
      /WHT must be filed even if the payment to a non-resident is exempted under the Avoidance of Double Taxation Agreement \(DTA\) or Approved Royalties Incentive \(ARI\)\./i,
      /As a payer, you must file and pay WHT to IRAS by the 15\s*(?:th)?\s+of the second month from the date of payment to the non-resident\s*\./i,
      /The date of payment is defined as the earliest of the following dates:[\s\S]{0,600}?date of actual payment/i,
      /For director's fees\s+(?:[•◦▪]\s*)*When the payment is due and payable under the following scenarios:[\s\S]{0,1600}?Director's fees approved in arrears[\s\S]{0,800}?the date the fees are voted and approved at the company's AGM\.[\s\S]{0,500}?Director's fees approved in advance[\s\S]{0,700}?as and when he renders his services\./i,
      /If you are on GIRO for WHT payment, the GIRO deduction date is on the 25th[\s\S]{0,250}?next working day\./i,
      /If you have made multiple payments to the same non-resident professional[\s\S]{0,350}?public entertainer\./i
    ];
    case 'MAS_SFA_MISCONDUCT_REPORTING_2027': return [
      /1\s*\|?\s*This Notice \(excluding the Annexes\) is issued pursuant to section 101\(1\) of the Securities and Futures Act 2001 \("the Act"\) and takes effect from 1 January 2027\.[\s\S]{0,260}?Notice No\. SFA 04-N11 issued on 26 November 2010 is cancelled with effect from 1 January 2027\./i,
      /2\s*\|?\s*This Notice shall apply to all holders of a capital markets services \("CMS"\) licence and persons who are exempt from holding a CMS licence under section 99\(1\)\(a\), \(b\), \(c\) or \(d\) of the Act\. It sets out the reporting requirements for the misconduct of their representatives and former representatives\./i,
      /5\s*\|?\s*If a CMI has reasonable grounds to believe that[\s\S]{0,1200}?no later than 21 calendar days, or such longer period as the Authority may allow in writing, after the date on which the CMI first has reasonable grounds to believe that which is mentioned in sub-paragraph \(a\) or \(b\)\./i,
      /20\s*\|?\s*Despite paragraph 5, where a CMI[\s\S]{0,1800}?has not submitted to the Authority a Misconduct Report[\s\S]{0,700}?the CMI must submit to the Authority a Misconduct Report in relation to the misconduct under this Notice[\s\S]{0,500}?no later than 21 calendar days, or such longer period as the Authority may allow in writing, after 1 January 2027\./i,
      /21\s*\|?\s*This Notice does not apply to or in relation to any of the following[\s\S]{0,1800}?the Cancelled Notice as in force immediately before 1 January 2027 continues to apply to or in relation to any of the following as if this Notice has not been issued:[\s\S]{0,1300}?any case for which a CMI submitted a Misconduct Report under the Cancelled Notice[\s\S]{0,500}?any case for which a CMI was required under the Cancelled Notice to submit a Misconduct Report[\s\S]{0,500}?by 31 December 2026,[\s\S]{0,500}?any electronic system which may be established by the Authority in place of MASNET\./i
    ];
    case 'MAS_LFMC_TOOLKIT_SCOPE': return toolkitScopePassagePatterns();
  }
}

function normalized(value: string): string { return plainText(value).replace(/\s+/g, ' ').trim(); }

function extracts(rule: Rule, sourceText: string): string[] {
  const source = normalized(sourceText);
  const patterns = rule.id === 'MAS_LFMC_TOOLKIT_SCOPE' ? toolkitScopePassagePatterns() : passagePatterns(rule);
  const slices = patterns.map(pattern => pattern.exec(source)?.[0]?.trim()).filter((value): value is string => Boolean(value));
  return slices.length === patterns.length && slices.every(slice => slice.length <= MAX_PASSAGE_LENGTH) ? [...new Set(slices)] : [];
}

function contradicts(rule: Rule, sourceText: string): boolean {
  const text = normalized(sourceText).toLowerCase();
  switch (rule.id) {
    case 'IRAS_GST_STAFF_MEDICAL_INPUT_TAX': return /input tax (?:claims? )?(?:is|are) not disallowed under regulation 26|staff medical expenses are always claimable/i.test(text);
    case 'IRAS_GST_MOTOR_CAR_INPUT_TAX': return /purchase and running expenses of motor cars are not disallowed|motor car expenses? (?:used by you or your employees )?are not disallowed under regulation 27/i.test(text);
    case 'IRAS_ECI_PRACTICAL_WAIVER': return /(?:either|one of) (?:the following )?criteria is (?:met|required)|nil eci alone (?:means|qualifies for) (?:the )?waiver/i.test(text);
    case 'IRAS_WHT_SERVICES': return /services performed in singapore[^.]{0,140}withholding tax is not applicable|only the overseas work[^.]{0,100}subject to withholding tax|services performed in singapore[^.]{0,130}\b(?:10|15|20) percent\b/i.test(text);
    case 'IRAS_WHT_FILING_DATE': return /(?:no need|not required) to file wht[^.]{0,120}(?:dta|ari)|wht (?:is )?due by the 15th of the following month/i.test(text);
    case 'MAS_SFA_MISCONDUCT_REPORTING_2027': return /takes effect from 1 january 2026|no later than 14 calendar days[^.]{0,100}(?:misconduct report|reasonable grounds)|does not apply to former representatives|the CMI must not submit a Misconduct Report/i.test(text);
    case 'MAS_LFMC_TOOLKIT_SCOPE': return /(?:toolkit|checklist) (?:is|remains) exhaustive|covers? all (?:fund.level|non.sfa|outside the sfa) requirements/i.test(text);
  }
}

function exactUrl(actual: string | undefined, expected: string): boolean {
  if (!actual) return true;
  try {
    const url = new URL(actual);
    const target = new URL(expected);
  return url.protocol === 'https:' && url.hostname === target.hostname && url.pathname.replace(/\/$/, '') === target.pathname.replace(/\/$/, '')
      && url.search === target.search && !url.username && !url.password && !url.port && !url.hash;
  } catch { return false; }
}

export function supportIrasMasKnowledgeRule(request: IrasMasKnowledgeRequest): boolean | undefined {
  const rule = namedRule(request);
  if (!rule) return undefined;
  if (rule.id === 'MAS_SFA_MISCONDUCT_REPORTING_2027' && hasConflictingMasNoticeIdentity(request.query)) return false;
  if (hasGstInputScopeConflict(request)) return false;
  if (rule.id === 'IRAS_GST_STAFF_MEDICAL_INPUT_TAX' && isMedicalInsurancePremiumPremise(request)) return false;
  if (rule.id === 'MAS_LFMC_TOOLKIT_SCOPE' && request.officialUrl !== undefined && request.officialUrl !== rule.officialUrl) return false;
  if (!exactUrl(request.officialUrl, rule.officialUrl) || hasNonCurrentScope(request.query, rule)) return false;
  const text = normalized(request.sourceText);
  const requiredPassageCount = rule.id === 'MAS_LFMC_TOOLKIT_SCOPE'
    ? toolkitScopePassagePatterns().length : passagePatterns(rule).length;
  return !contradicts(rule, text) && extracts(rule, text).length === requiredPassageCount;
}

export function selectIrasMasKnowledgeQuotes(request: IrasMasKnowledgeRequest): string[] {
  const rule = namedRule(request);
  if (!rule || supportIrasMasKnowledgeRule(request) !== true) return [];
  return extracts(rule, request.sourceText);
}

/** Scoped to these six specific families so current adjacent proof is untouched. */
export function hasIrasMasKnowledgeContradiction(request: IrasMasKnowledgeRequest): boolean {
  if (hasGstInputScopeConflict(request)) return true;
  const rule = namedRule(request);
  return Boolean(rule && ((rule.id === 'IRAS_GST_STAFF_MEDICAL_INPUT_TAX' && isMedicalInsurancePremiumPremise(request))
    || (rule.id === 'MAS_SFA_MISCONDUCT_REPORTING_2027' && hasConflictingMasNoticeIdentity(request.query))
    || (rule.id === 'MAS_SFA_MISCONDUCT_REPORTING_2027' && hasNonCurrentScope(request.query, rule))
    || contradicts(rule, request.sourceText)));
}

export function irasMasKnowledgePointers(request: IrasMasKnowledgeRequest): Array<Pick<IrasMasKnowledgeRuleMetadata, 'authority' | 'topicIds' | 'officialUrl' | 'title'>> {
  return IRAS_MAS_KNOWLEDGE_RULES_20261027B.filter(rule => rule.authority === request.authority && rule.topicIds.includes(request.topicId))
    .map(({ authority, topicIds, officialUrl, title }) => ({ authority, topicIds, officialUrl, title }));
}

function sourceFor(rule: Rule, source: AuthorityPresentedSource, issueId: string): boolean {
  if (source.provenance !== 'LIVE_EXTERNAL' || source.validTo || source.officialUrl !== rule.officialUrl) return false;
  const completeGroups = groupExactIssueClaimsByDocument(source, issueId);
  return completeGroups.some(group => supportIrasMasKnowledgeRule({
    authority: rule.authority,
    topicId: rule.topicIds[0],
    query: proofQuery(rule),
    subject: proofSubject(rule),
    officialUrl: rule.officialUrl,
    sourceText: group.map(claim => claim.text).join('\n\n')
  }) === true);
}

/** General rule text is presented only after issue-bound exact quotes verify from one fetched document revision. */
export function getIrasMasKnowledgeEvidence(
  query: string,
  stream: AuthorityPresentedWorkstream,
  issue: AuthorityPresentedIssue
): IrasMasKnowledgeEvidence | undefined {
  if (hasGstInputScopeConflict({ authority: stream.authority, topicId: 'iras-gst-input-tax', query, subject: issue.subject })) return undefined;
  if (stream.authority === 'IRAS' && isMedicalInsurancePremiumPremise({ query, subject: issue.subject })
      && namedRule({ authority: 'IRAS', topicId: 'iras-gst-input-tax', query, subject: issue.subject })?.id === 'IRAS_GST_STAFF_MEDICAL_INPUT_TAX') return undefined;
  const resolved = IRAS_MAS_KNOWLEDGE_RULES_20261027B.find(candidate => {
    if (candidate.authority !== stream.authority) return false;
    return namedRule({ authority: stream.authority, topicId: candidate.topicIds[0], query, subject: issue.subject })?.id === candidate.id;
  });
  if (!resolved || stream.authority !== resolved.authority
      || (resolved.id === 'MAS_SFA_MISCONDUCT_REPORTING_2027' && hasConflictingMasNoticeIdentity(query))
      || hasNonCurrentScope(query, resolved)) return undefined;
  // Authority workstreams use IRAS_CORPORATE_TAX for ECI/WHT; issue topic/domain
  // semantics remain specific to IRAS income tax and are not rewritten here.
  const expectedDomain = resolved.authority === 'IRAS'
    ? resolved.id.startsWith('IRAS_GST_') ? 'IRAS_GST' : 'IRAS_CORPORATE_TAX'
    : 'MAS_FUNDS';
  if (stream.domain !== expectedDomain || issue.population !== 'Company'
      || !['NOT_REQUIRED', 'UNRESOLVED'].includes(issue.applicationStatus)
      || issue.evidenceStatus !== 'VERIFIED' || !['EXPLAIN_RULE', 'CHECK_ELIGIBILITY', 'FILING_REQUIREMENT'].includes(issue.operation)
      || !stream.issues.some(candidate => candidate.id === issue.id && candidate.evidenceStatus === 'VERIFIED')) return undefined;
  const source = stream.sources.find(candidate => sourceFor(resolved, candidate, issue.id));
  if (!source) return undefined;
  return { authority: resolved.authority, title: source.title, officialUrl: resolved.officialUrl, text: answerText(resolved, query) };
}

function proofQuery(rule: Rule): string {
  switch (rule.id) {
    case 'IRAS_GST_STAFF_MEDICAL_INPUT_TAX': return 'Can a GST-registered business claim input tax on staff medical expenses?';
    case 'IRAS_GST_MOTOR_CAR_INPUT_TAX': return 'How does input tax work for a business motor car?';
    case 'IRAS_ECI_PRACTICAL_WAIVER': return 'When does a company qualify for an ECI filing waiver?';
    case 'IRAS_WHT_SERVICES': return 'Does WHT apply to service fees paid to a non-resident company?';
    case 'IRAS_WHT_FILING_DATE': return 'What is the WHT filing and payment due date?';
    case 'MAS_SFA_MISCONDUCT_REPORTING_2027': return 'What does Notice SFA 04-N24 require from 1 January 2027?';
    case 'MAS_LFMC_TOOLKIT_SCOPE': return 'Does the LFMC toolkit cover all requirements including obligations outside the SFA and fund-level duties?';
  }
}

function proofSubject(rule: Rule): string {
  switch (rule.id) {
    case 'IRAS_GST_STAFF_MEDICAL_INPUT_TAX': return 'GST input tax on employee medical expenses';
    case 'IRAS_GST_MOTOR_CAR_INPUT_TAX': return 'GST input tax on motor cars and vehicle exceptions';
    case 'IRAS_ECI_PRACTICAL_WAIVER': return 'ECI filing waiver eligibility requirements';
    case 'IRAS_WHT_SERVICES': return 'Withholding tax on non-resident service payments';
    case 'IRAS_WHT_FILING_DATE': return 'Withholding tax filing and payment deadline';
    case 'MAS_SFA_MISCONDUCT_REPORTING_2027': return 'SFA 04-N24 reporting of misconduct by representatives from 1 January 2027';
    case 'MAS_LFMC_TOOLKIT_SCOPE': return 'MAS LFMC toolkit scope and fund-level requirements';
  }
}

function answerText(rule: Rule, query: string): string {
  switch (rule.id) {
    case 'IRAS_GST_STAFF_MEDICAL_INPUT_TAX': return 'IRAS states that staff medical input tax is generally disallowed under regulation 26 of the GST (General) Regulations. Subject to the ordinary input-tax conditions, the stated exceptions are expenses obligatory under WICA or a qualifying Industrial Relations Act collective agreement; or, for expenses incurred on or after 1 October 2021, treatment connected with a work-related health risk or requirement and required under relevant Singapore written law. For the advisory limb, IRAS specifies treatment related to COVID-19 and required under a written advisory of the Government or a Singapore public authority. IRAS specifically says Primary Care Plan expenses do not meet the described work-related exception. A claim needs the expense date, legal/collective-agreement basis, work-related risk and mandate evidence, GST registration and invoice facts.';
    case 'IRAS_GST_MOTOR_CAR_INPUT_TAX': return 'IRAS generally disallows input tax on a motor car’s purchase and running costs under regulation 27, unless the vehicle is outside the regulation 25(1) motor-car definition or a specific exception applies. Its examples include qualifying chauffeured pay-per-trip transport services from 1 April 2022; qualifying costs for cars used by a third party from 1 January 2023; and vehicles such as lorries, vans and motorcycles that are not motor cars. Costs for cars used physically or economically by you or your employees remain disallowed. For a connected person’s car, the claimant must recover the expense and the recovery must not be ancillary to a primary supply; partial recovery limits the claim to the recovered portion. If only half the expenses are recovered, the exception permits input tax only to the extent of that half, not the unrecovered half. All exceptions remain subject to the ordinary claim conditions and records.';
    case 'IRAS_ECI_PRACTICAL_WAIVER': return 'IRAS generally requires ECI filing within three months after FYE. The general waiver requires both annual revenue of S$5 million or less for that financial year and nil ECI for the YA, with ECI measured before partial or start-up exemption. Revenue is the company’s main source of income; for an investment holding company it is investment income. A nil ECI or book loss alone does not qualify a company whose relevant revenue exceeds S$5 million; likewise, revenue below the threshold does not qualify when ECI is positive. IRAS gives separate entity categories that need not file and says companies self-assess the waiver. To assess a particular YA, confirm FYE, principal/investment revenue, pre-exemption ECI and any specifically excluded category.';
    case 'IRAS_WHT_SERVICES': return 'IRAS says WHT applies to specified service and management fees paid to a non-resident company to the extent attributable to work done in Singapore; a mixed Singapore/overseas engagement must be apportioned. Services supplied electronically from overseas without sending staff are described as performed outside Singapore. The current page states the prevailing 17% Corporate Income Tax rate on gross service fees for Singapore work, but the applicable DTA, payee residence and permanent-establishment facts may change the rate or treatment. IRAS also says the old related-party cost-pooling concession was withdrawn for payments liable on or after 1 November 2022. Specific treatment requires the payee type and residence, service scope/location, DTA and relevant dates.';
    case 'IRAS_WHT_FILING_DATE': return 'IRAS requires WHT filing and payment by the 15th of the second month after its defined date of payment. For most payments, use the earliest of the contractual due date (or invoice date if there is no agreement, ignoring credit terms), credit to an account designated by the non-resident, and actual payment. Director fees have separate timing rules based on arrears/advance approval, entitlement, credit and actual payment. WHT still must be filed when a DTA or ARI makes the rate zero. GIRO is normally deducted on the 25th of the due month, or the next working day if that date is a weekend/public holiday. The exact deadline requires the payment type and all relevant dates.';
    case 'MAS_SFA_MISCONDUCT_REPORTING_2027': {
      const scope = masSfa04N24CommencementScope(query);
      const clarification = scope?.refersTo2026Matter
        ? 'The ordinary SFA 04-N24 rule is not yet in effect for an October or December 2026 matter. The 2027 notice does not by itself establish what earlier reporting duty applied or prove that none existed. Paragraph 21 must be checked first: it continues the cancelled Notice for matters with a report already submitted before 1 January 2027 or due by 31 December 2026. Paragraph 20 applies only to its separate pre-2027 reasonable-grounds cases not covered by that paragraph 21 transition.'
        : 'The notice’s stated commencement is 1 January 2027; this source does not establish what reporting duties applied before that date.';
      return `MAS Notice SFA 04-N24 takes effect on 1 January 2027. It applies to CMS licence holders and persons exempt under SFA section 99(1)(a)–(d), for misconduct by their representatives and former representatives. A CMI must submit a Misconduct Report no later than 21 calendar days after the date it first has reasonable grounds to believe the current or former representative committed misconduct during the representative period, unless the Authority allows a longer period in writing. Paragraph 21 keeps the cancelled Notice applicable where a report was submitted before 1 January 2027 or was required by 31 December 2026. Paragraph 20 addresses a pre-2027 reasonable-grounds case where no Misconduct Report in the form set out in the cancelled Notice had been submitted by 1 January 2027: the report under SFA 04-N24 is due within 21 calendar days after 1 January 2027, or a longer period allowed in writing. A case-specific conclusion requires the CMI status, representative period, reasonable-grounds date and transition facts. ${clarification}`;
    }
    case 'MAS_LFMC_TOOLKIT_SCOPE': return 'The MAS LFMC toolkit is a reference for common SFA approvals, notifications and regulatory submissions applicable to LFMCs. MAS says it is not exhaustive and expressly excludes obligations outside the SFA and fund-level requirements, such as the Code of Collective Investment Schemes. It therefore is not a complete checklist for all duties affecting a managed fund. Identify applicable fund-level requirements and other legislation separately. This scope statement applies to the LFMC toolkit; it does not establish the scope of VCFM or other licence-class toolkits.';
  }
}
