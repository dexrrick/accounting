import type { QueryDomain, StatutoryAuthority } from '../types/accounting';

export type CoveragePriority = 'P1' | 'P2' | 'P3';
export type CoverageStatus = 'MISSING' | 'PLANNED' | 'IMPLEMENTING' | 'PARTIAL' | 'VALIDATED' | 'STALE' | 'HISTORICAL';

export interface SingaporeKnowledgeDomainDefinition {
  id: string;
  title: string;
  authorities: readonly StatutoryAuthority[];
  /** Coarse source-record domain(s), retained while source records migrate. */
  legacyDomains: readonly QueryDomain[];
}

/** Fine-grained knowledge taxonomy. QueryDomain remains the source-record contract. */
export const SINGAPORE_DOMAIN_TAXONOMY = {
  ACCOUNTING_SFRS: { id: 'ACCOUNTING_SFRS', title: 'Singapore Financial Reporting Standards (International)', authorities: ['ACRA'], legacyDomains: ['ACCOUNTING_SFRS'] },
  ACCOUNTING_FRS: { id: 'ACCOUNTING_FRS', title: 'Singapore Financial Reporting Standards', authorities: ['ACRA'], legacyDomains: ['ACCOUNTING_SFRS'] },
  ACCOUNTING_SMALL_ENTITIES: { id: 'ACCOUNTING_SMALL_ENTITIES', title: 'Singapore Financial Reporting Standard for Small Entities', authorities: ['ACRA'], legacyDomains: ['ACCOUNTING_SFRS'] },
  ACRA_COMPANIES: { id: 'ACRA_COMPANIES', title: 'ACRA and Companies Act', authorities: ['ACRA'], legacyDomains: ['ACRA_CORP'] },
  ACRA_VCC: { id: 'ACRA_VCC', title: 'Variable Capital Companies', authorities: ['ACRA'], legacyDomains: ['ACRA_CORP'] },
  ACRA_CSP: { id: 'ACRA_CSP', title: 'Corporate Service Providers', authorities: ['ACRA'], legacyDomains: ['ACRA_CORP'] },
  IRAS_CORPORATE_TAX: { id: 'IRAS_CORPORATE_TAX', title: 'IRAS Corporate Income Tax', authorities: ['IRAS'], legacyDomains: ['IRAS_TAX'] },
  IRAS_GST: { id: 'IRAS_GST', title: 'IRAS Goods and Services Tax', authorities: ['IRAS'], legacyDomains: ['IRAS_GST'] },
  IRAS_EMPLOYER_TAX: { id: 'IRAS_EMPLOYER_TAX', title: 'IRAS Employer and Employment Income', authorities: ['IRAS'], legacyDomains: ['IRAS_TAX'] },
  IRAS_INDIVIDUAL_TAX: { id: 'IRAS_INDIVIDUAL_TAX', title: 'IRAS Individual Income Tax', authorities: ['IRAS'], legacyDomains: ['IRAS_TAX'] },
  IRAS_PROPERTY_TAX: { id: 'IRAS_PROPERTY_TAX', title: 'IRAS Property Tax', authorities: ['IRAS'], legacyDomains: ['IRAS_TAX'] },
  IRAS_STAMP_DUTY: { id: 'IRAS_STAMP_DUTY', title: 'IRAS Stamp Duty', authorities: ['IRAS'], legacyDomains: ['IRAS_TAX'] },
  IRAS_CRS_FATCA: { id: 'IRAS_CRS_FATCA', title: 'Singapore CRS and FATCA', authorities: ['IRAS'], legacyDomains: ['IRAS_TAX'] },
  MOM_EMPLOYMENT: { id: 'MOM_EMPLOYMENT', title: 'MOM Employment Standards', authorities: ['MOM'], legacyDomains: ['MOM_EMPLOYMENT'] },
  MOM_WORK_PASSES: { id: 'MOM_WORK_PASSES', title: 'MOM Work Passes', authorities: ['MOM'], legacyDomains: ['MOM_EMPLOYMENT'] },
  MOM_FOREIGN_WORKFORCE: { id: 'MOM_FOREIGN_WORKFORCE', title: 'MOM Foreign Workforce and Levies', authorities: ['MOM'], legacyDomains: ['MOM_EMPLOYMENT'] },
  CPF_CONTRIBUTIONS: { id: 'CPF_CONTRIBUTIONS', title: 'CPF Contributions and Wage Ceilings', authorities: ['CPF'], legacyDomains: ['CPF_BOARD'] },
  CPF_PAYROLL_LEVIES: { id: 'CPF_PAYROLL_LEVIES', title: 'Payroll Levies and Self-Help Group Contributions', authorities: ['CPF'], legacyDomains: ['CPF_BOARD'] },
  MAS_FUND_MANAGEMENT: { id: 'MAS_FUND_MANAGEMENT', title: 'MAS Fund Management Regulation', authorities: ['MAS'], legacyDomains: ['MAS_FUNDS'] },
  MAS_FAMILY_OFFICE: { id: 'MAS_FAMILY_OFFICE', title: 'MAS Family Office and Fund Incentives', authorities: ['MAS'], legacyDomains: ['MAS_FUNDS'] },
  MAS_REGULATORY_REPORTING: { id: 'MAS_REGULATORY_REPORTING', title: 'MAS Regulatory Reporting and Governance', authorities: ['MAS'], legacyDomains: ['MAS_FUNDS'] },
  MAS_AML: { id: 'MAS_AML', title: 'MAS AML and CFT Requirements', authorities: ['MAS'], legacyDomains: ['MAS_FUNDS'] },
  CUSTOMS: { id: 'CUSTOMS', title: 'Singapore Customs and Trade', authorities: ['CUSTOMS'], legacyDomains: ['GENERAL'] },
  MULTI_AUTHORITY: { id: 'MULTI_AUTHORITY', title: 'Multi-authority Topics', authorities: ['IRAS', 'MOM', 'CPF', 'ACRA', 'MAS', 'CUSTOMS'], legacyDomains: ['MULTI_AUTHORITY'] },
  GENERAL: { id: 'GENERAL', title: 'General or Unclassified', authorities: [], legacyDomains: ['GENERAL'] }
} as const satisfies Record<string, SingaporeKnowledgeDomainDefinition>;

export type SingaporeKnowledgeDomain = keyof typeof SINGAPORE_DOMAIN_TAXONOMY;

export type CoverageCheck =
  | 'SOURCE_PROVENANCE'
  | 'RETRIEVAL_EVALUATION'
  | 'TEMPORAL_VALIDITY'
  | 'ACCOUNTING_OR_CALCULATION_RULE'
  | 'MISSING_FACT_GUARD'
  | 'REGRESSION_TEST';

/**
 * Canonical topic metadata. A catalog entry or source link alone never means
 * the underlying rule is validated or can be used as evidence.
 */
export interface SingaporeCoverageTopic {
  id: string;
  title: string;
  domainId: SingaporeKnowledgeDomain;
  priority: CoveragePriority;
  status: CoverageStatus;
  authorities: StatutoryAuthority[];
  /** Legacy source-record domains used by the current retriever. */
  legacyDomains: QueryDomain[];
  /** Source links are listed only when the existing registry has that exact ID. */
  sourceRecordIds: string[];
  requiredChecks: CoverageCheck[];
  /** Search metadata consumed by classification and retrieval. */
  keywords: string[];
  /** Narrow query-only patterns for realistic phrasing that cannot be represented as stable lexical phrases. */
  queryPatterns?: string[];
  /** Exact body phrases required before mapped source content can cover this topic. */
  requiredContentTerms?: string[];
  /** Phrase-level negatives prevent a keyword hit from misclassifying nearby concepts. */
  exclusionKeywords: string[];
  /** Broad taxonomy entries can help route discovery without being required evidence coverage. */
  routingOnly?: boolean;
  /** Shared concept ID for legacy/new topic aliases that should count once in ranking. */
  canonicalConceptId?: string;
  actOrStandard?: string;
  sectionMatch?: string;
  /** Key in semanticAccountingRules; resolver hydrates the criteria from there. */
  semanticCriteriaKey?: string;
  /** Original broad Phase 7 pack(s) this granular topic is replacing. */
  legacyPackIds?: string[];
  /** Source-map metadata routes retrieval; it does not prove paragraph-level coverage. */
  subdomain?: string;
  shortDescription?: string;
  aliases?: string[];
  canonicalSourceId?: string;
  canonicalSourceUrl?: string;
  pageTitle?: string;
  /** URL identity/reachability verification is separate from content verification. */
  urlVerificationStatus?: 'VERIFIED' | 'CANDIDATE' | 'REJECTED';
  urlVerifiedDate?: string;
  urlVerificationMethod?: 'OFFICIAL_HTML_PAGE_TITLE_AND_TOPIC_CHECK';
  urlVerificationEvidence?: string;
  paragraphHints?: string[];
  sectionHints?: string[];
  relatedTopicIds?: string[];
  effectiveFrom?: string;
  effectiveTo?: string;
  lastVerifiedDate?: string;
  lastSuccessfulFetch?: string;
  contentFingerprint?: string;
  lifecycleState?: 'ACTIVE' | 'CANDIDATE' | 'STAGED' | 'REJECTED';
}

const fullTopicPackChecks: CoverageCheck[] = [
  'SOURCE_PROVENANCE',
  'RETRIEVAL_EVALUATION',
  'TEMPORAL_VALIDITY',
  'ACCOUNTING_OR_CALCULATION_RULE',
  'MISSING_FACT_GUARD',
  'REGRESSION_TEST'
];

/**
 * Keep compatibility IDs, but set canonicalConceptId when legacy/new IDs are
 * synonyms. Related parent/child concepts keep separate IDs; for example, the
 * GST registration obligation and its retrospective/prospective turnover tests
 * remain independently scoreable despite shared search vocabulary.
 */
interface TopicSpec {
  id: string;
  title: string;
  domainId: SingaporeKnowledgeDomain;
  keywords?: string[];
  queryPatterns?: string[];
  requiredContentTerms?: string[];
  exclusionKeywords?: string[];
  routingOnly?: boolean;
  canonicalConceptId?: string;
  priority?: CoveragePriority;
  status?: CoverageStatus;
  authorities?: StatutoryAuthority[];
  sourceRecordIds?: string[];
  actOrStandard?: string;
  sectionMatch?: string;
  semanticCriteriaKey?: string;
  legacyPackIds?: string[];
  subdomain?: string;
  shortDescription?: string;
  aliases?: string[];
  canonicalSourceId?: string;
  canonicalSourceUrl?: string;
  pageTitle?: string;
  urlVerificationStatus?: 'VERIFIED' | 'CANDIDATE' | 'REJECTED';
  urlVerifiedDate?: string;
  urlVerificationMethod?: 'OFFICIAL_HTML_PAGE_TITLE_AND_TOPIC_CHECK';
  urlVerificationEvidence?: string;
  paragraphHints?: string[];
  sectionHints?: string[];
  relatedTopicIds?: string[];
  effectiveFrom?: string;
  effectiveTo?: string;
  lastVerifiedDate?: string;
  lastSuccessfulFetch?: string;
  contentFingerprint?: string;
  lifecycleState?: 'ACTIVE' | 'CANDIDATE' | 'STAGED' | 'REJECTED';
}

function topic(spec: TopicSpec): SingaporeCoverageTopic {
  const domain = SINGAPORE_DOMAIN_TAXONOMY[spec.domainId];
  return {
    id: spec.id,
    title: spec.title,
    domainId: spec.domainId,
    priority: spec.priority ?? 'P2',
    status: spec.status ?? 'MISSING',
    authorities: spec.authorities ?? [...domain.authorities],
    legacyDomains: [...domain.legacyDomains],
    sourceRecordIds: spec.sourceRecordIds ?? [],
    requiredChecks: [...fullTopicPackChecks],
    keywords: spec.keywords ?? [],
    ...(spec.queryPatterns ? { queryPatterns: [...spec.queryPatterns] } : {}),
    ...(spec.requiredContentTerms ? { requiredContentTerms: [...spec.requiredContentTerms] } : {}),
    exclusionKeywords: spec.exclusionKeywords ?? [],
    ...(spec.routingOnly ? { routingOnly: true } : {}),
    ...(spec.canonicalConceptId ? { canonicalConceptId: spec.canonicalConceptId } : {}),
    ...(spec.actOrStandard ? { actOrStandard: spec.actOrStandard } : {}),
    ...(spec.sectionMatch ? { sectionMatch: spec.sectionMatch } : {}),
    ...(spec.semanticCriteriaKey ? { semanticCriteriaKey: spec.semanticCriteriaKey } : {}),
    ...(spec.legacyPackIds ? { legacyPackIds: spec.legacyPackIds } : {}),
    ...(spec.subdomain ? { subdomain: spec.subdomain } : {}),
    ...(spec.shortDescription ? { shortDescription: spec.shortDescription } : {}),
    ...(spec.aliases ? { aliases: [...spec.aliases] } : {}),
    ...(spec.canonicalSourceId ? { canonicalSourceId: spec.canonicalSourceId } : {}),
    ...(spec.canonicalSourceUrl ? { canonicalSourceUrl: spec.canonicalSourceUrl } : {}),
    ...(spec.pageTitle ? { pageTitle: spec.pageTitle } : {}),
    ...(spec.urlVerificationStatus ? { urlVerificationStatus: spec.urlVerificationStatus } : {}),
    ...(spec.urlVerifiedDate ? { urlVerifiedDate: spec.urlVerifiedDate } : {}),
    ...(spec.urlVerificationMethod ? { urlVerificationMethod: spec.urlVerificationMethod } : {}),
    ...(spec.urlVerificationEvidence ? { urlVerificationEvidence: spec.urlVerificationEvidence } : {}),
    ...(spec.paragraphHints ? { paragraphHints: [...spec.paragraphHints] } : {}),
    ...(spec.sectionHints ? { sectionHints: [...spec.sectionHints] } : {}),
    ...(spec.relatedTopicIds ? { relatedTopicIds: [...spec.relatedTopicIds] } : {}),
    ...(spec.effectiveFrom ? { effectiveFrom: spec.effectiveFrom } : {}),
    ...(spec.effectiveTo ? { effectiveTo: spec.effectiveTo } : {}),
    ...(spec.lastVerifiedDate ? { lastVerifiedDate: spec.lastVerifiedDate } : {}),
    ...(spec.lastSuccessfulFetch ? { lastSuccessfulFetch: spec.lastSuccessfulFetch } : {}),
    ...(spec.contentFingerprint ? { contentFingerprint: spec.contentFingerprint } : {}),
    ...(spec.lifecycleState ? { lifecycleState: spec.lifecycleState } : {})
  };
}

/** Directly inspected first-party IRAS pages. These entries route retrieval only. */
export interface IrasSourceMapDefinition {
  id: string;
  topicIds: readonly string[];
  domainId: Extract<SingaporeKnowledgeDomain, `IRAS_${string}`>;
  canonicalSourceUrl: string;
  pageTitle: string;
  subdomain: string;
  shortDescription: string;
  urlVerificationStatus: 'VERIFIED';
  urlVerifiedDate: string;
  urlVerificationMethod: 'OFFICIAL_HTML_PAGE_TITLE_AND_TOPIC_CHECK';
  urlVerificationEvidence: string;
}

const IRAS_URL_VERIFICATION_DATE = '2026-09-26';
const IRAS_URL_VERIFICATION_METHOD = 'OFFICIAL_HTML_PAGE_TITLE_AND_TOPIC_CHECK' as const;
const irasSourceMap = (
  id: string,
  domainId: IrasSourceMapDefinition['domainId'],
  topicIds: readonly string[],
  canonicalSourceUrl: string,
  pageTitle: string,
  subdomain: string,
  shortDescription: string,
  urlVerifiedDate = IRAS_URL_VERIFICATION_DATE
): IrasSourceMapDefinition => ({
  id,
  domainId,
  topicIds,
  canonicalSourceUrl,
  pageTitle,
  subdomain,
  shortDescription,
  urlVerificationStatus: 'VERIFIED',
  urlVerifiedDate,
  urlVerificationMethod: IRAS_URL_VERIFICATION_METHOD,
  urlVerificationEvidence: `Directly opened the official IRAS page; final URL, page title and relevant topic were confirmed on ${urlVerifiedDate}.`
});

/**
 * Narrow IRAS source map. Each URL below was opened on the official IRAS host
 * and checked against its page title and relevant topic. The records generated
 * from this catalog remain URL-routing pointers, not evidence of tax claims.
 */
export const IRAS_SOURCE_MAP_DEFINITIONS: readonly IrasSourceMapDefinition[] = [
  irasSourceMap('IRAS_CIT_RATE_SOURCE_MAP', 'IRAS_CORPORATE_TAX', ['iras-cit-tax-rate', 'iras-cit-sute', 'iras-cit-pte'],
    'https://www.iras.gov.sg/quick-links/tax-rates/corporate-income-tax-rates',
    'Corporate Income Tax Rates', 'corporate-income-tax', 'IRAS corporate income tax rate and exemption-scheme overview.'),
  irasSourceMap('IRAS_CIT_ECI_SOURCE_MAP', 'IRAS_CORPORATE_TAX', ['iras-cit-eci'],
    'https://www.iras.gov.sg/taxes/corporate-income-tax/estimated-chargeable-income-(eci)-filing',
    'Estimated Chargeable Income (ECI) Filing', 'corporate-income-tax', 'IRAS filing guidance for Estimated Chargeable Income.'),
  irasSourceMap('IRAS_CIT_BASIS_FILING_SOURCE_MAP', 'IRAS_CORPORATE_TAX', ['iras-cit-basis-period', 'iras-cit-filing-deadlines', 'iras-cit-eci'],
    'https://www.iras.gov.sg/taxes/corporate-income-tax/basics-of-corporate-income-tax/basic-guide-to-corporate-income-tax-for-companies',
    'Basic Guide to Corporate Income Tax for Companies', 'corporate-income-tax', 'IRAS guidance on corporate basis periods, Years of Assessment and corporate return filing due dates.'),
  irasSourceMap('IRAS_CIT_RETURNS_SOURCE_MAP', 'IRAS_CORPORATE_TAX', ['iras-cit-returns'],
    'https://www.iras.gov.sg/taxes/corporate-income-tax/form-c-s-form-c-s-(lite)-form-c-filing/overview-of-form-c-s-form-c-s-(lite)-form-c',
    'Overview of Form C-S/ Form C-S (Lite)/ Form C', 'corporate-income-tax', 'IRAS overview of corporate income tax return types and eligibility.'),
  irasSourceMap('IRAS_CIT_EXPENSES_SOURCE_MAP', 'IRAS_CORPORATE_TAX', ['iras-cit-deductibility', 'iras-cit-disallowed-expenses'],
    'https://www.iras.gov.sg/taxes/corporate-income-tax/income-deductions-for-companies/business-expenses',
    'Business Expenses', 'corporate-income-tax', 'IRAS overview of deductible and non-deductible business expenses.'),
  irasSourceMap('IRAS_CIT_CAPITAL_ALLOWANCES_SOURCE_MAP', 'IRAS_CORPORATE_TAX', ['iras-capital-allowances'],
    'https://www.iras.gov.sg/taxes/corporate-income-tax/income-deductions-for-companies/claiming-allowances/capital-allowances',
    'Capital Allowances', 'corporate-income-tax', 'IRAS guidance on capital allowances, including Sections 19 and 19A.'),
  irasSourceMap('IRAS_CIT_RR_SOURCE_MAP', 'IRAS_CORPORATE_TAX', ['iras-cit-renovation-refurbishment'],
    'https://www.iras.gov.sg/taxes/corporate-income-tax/income-deductions-for-companies/business-expenses/tax-treatment-of-business-expenses-(m-r)',
    'Tax Treatment of Business Expenses (M-R)', 'corporate-income-tax', 'IRAS business-expense guidance containing the Section 14N renovation and refurbishment treatment.'),
  irasSourceMap('IRAS_CIT_UNUTILISED_ITEMS_SOURCE_MAP', 'IRAS_CORPORATE_TAX', ['iras-cit-loss-carry-forward', 'iras-cit-loss-carry-back', 'iras-substantial-shareholding-test', 'iras-cit-donations'],
    'https://www.iras.gov.sg/taxes/corporate-income-tax/income-deductions-for-companies/unutilised-items-(capital-allowances-trade-losses-donations)',
    'Unutilised Items (Capital Allowances, Trade Losses & Donations)', 'corporate-income-tax', 'IRAS guidance on carry-forward, carry-back, shareholding tests and group relief of unutilised items.'),
  irasSourceMap('IRAS_CIT_GROUP_RELIEF_SOURCE_MAP', 'IRAS_CORPORATE_TAX', ['iras-group-relief'],
    'https://www.iras.gov.sg/taxes/corporate-income-tax/income-deductions-for-companies/claiming-reliefs/group-relief',
    'Group Relief', 'corporate-income-tax', 'IRAS corporate group-relief guidance.'),
  irasSourceMap('IRAS_WHT_RATES_SOURCE_MAP', 'IRAS_CORPORATE_TAX', ['iras-withholding-tax', 'iras-withholding-tax-management-fees', 'iras-withholding-tax-interest-royalties'],
    'https://www.iras.gov.sg/taxes/withholding-tax/basics-of-withholding-tax/types-of-payment-and-withholding-tax-rates',
    'Types of Payment & the Applicable Withholding Tax Rates', 'withholding-tax', 'IRAS administrative guidance by payment type, including interest, royalties and service or management fees.'),
  irasSourceMap('IRAS_WHT_SCOPE_SOURCE_MAP', 'IRAS_CORPORATE_TAX', ['iras-withholding-tax', 'iras-withholding-tax-management-fees', 'iras-withholding-tax-interest-royalties'],
    'https://www.iras.gov.sg/taxes/withholding-tax/payments-to-non-resident-company/payments-that-are-subject-to-withholding-tax',
    'Payments that are subject to withholding tax', 'withholding-tax', 'IRAS guidance on payment categories that may trigger withholding tax for non-resident companies.'),
  irasSourceMap('IRAS_WHT_OVERVIEW_SOURCE_MAP', 'IRAS_CORPORATE_TAX', ['iras-withholding-tax'],
    'https://www.iras.gov.sg/taxes/withholding-tax/basics-of-withholding-tax/overview-of-withholding-tax-(WHT)',
    'Overview of Withholding Tax (WHT)', 'withholding-tax', 'IRAS overview of payer and non-resident recipient obligations, filing and payment.'),
  irasSourceMap('IRAS_WHT_DUE_DATE_SOURCE_MAP', 'IRAS_CORPORATE_TAX', ['iras-wht-deemed-payment-date', 'iras-wht-filing-payment-due-date', 'iras-wht-treaty-relief'],
    'https://www.iras.gov.sg/taxes/withholding-tax/withholding-tax-filing/withholding-tax-filing-and-payment-due-date',
    'Withholding Tax (WHT) Filing and Payment Due Date', 'withholding-tax', 'IRAS guidance on deemed payment dates, filing and payment deadlines, director-fee timing and treaty-exempt filing.'),
  irasSourceMap('IRAS_CIT_RESIDENCY_SOURCE_MAP', 'IRAS_CORPORATE_TAX', ['iras-corporate-tax-residency'],
    'https://www.iras.gov.sg/taxes/corporate-income-tax/basics-of-corporate-income-tax/tax-residency-of-a-company-certificate-of-residence',
    'Tax Residency of a Company/ Certificate of Residence', 'corporate-income-tax', 'IRAS guidance on company tax residence and certificates of residence.'),
  irasSourceMap('IRAS_CIT_FOREIGN_INCOME_SOURCE_MAP', 'IRAS_CORPORATE_TAX', ['iras-foreign-sourced-income', 'iras-section-13-exemptions'],
    'https://www.iras.gov.sg/taxes/corporate-income-tax/income-deductions-for-companies/companies-receiving-foreign-income',
    'Companies Receiving Foreign Income', 'corporate-income-tax', 'IRAS guidance on specified foreign income received in Singapore and exemption conditions.'),
  irasSourceMap('IRAS_CIT_FOREIGN_TAX_CREDIT_SOURCE_MAP', 'IRAS_CORPORATE_TAX', ['iras-foreign-tax-credit'],
    'https://www.iras.gov.sg/taxes/corporate-income-tax/income-deductions-for-companies/claiming-reliefs/foreign-tax-credit',
    'Foreign Tax Credit', 'corporate-income-tax', 'IRAS guidance on foreign tax credit, including double-tax relief under applicable agreements.'),
  irasSourceMap('IRAS_TRANSFER_PRICING_SOURCE_MAP', 'IRAS_CORPORATE_TAX', ['iras-transfer-pricing', 'iras-transfer-pricing-documentation', 'iras-related-party-loans'],
    'https://www.iras.gov.sg/taxes/corporate-income-tax/specific-topics/transfer-pricing',
    'Transfer Pricing', 'corporate-income-tax', 'IRAS transfer-pricing guidance for related-party transactions, documentation and loans.'),
  irasSourceMap('IRAS_GST_REGISTRATION_SOURCE_MAP', 'IRAS_GST', ['gst_compulsory_registration', 'iras-gst-turnover-tests'],
    'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/gst-registration-deregistration/do-i-need-to-register-for-gst',
    'Do I need to register for GST', 'goods-services-tax', 'IRAS guidance on compulsory and voluntary GST registration.'),
  irasSourceMap('IRAS_GST_VOLUNTARY_REGISTRATION_SOURCE_MAP', 'IRAS_GST', ['iras-gst-voluntary-registration'],
    'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/gst-registration-deregistration/applying-for-gst-registration',
    'Applying for GST registration', 'goods-services-tax', 'IRAS application guidance, including voluntary registration conditions and process details.'),
  irasSourceMap('IRAS_GST_CHARGING_SOURCE_MAP', 'IRAS_GST', ['iras-gst-standard-rated-supplies'],
    'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/charging-gst-(output-tax)/when-to-charge-goods-and-services-tax-(gst)',
    'When to Charge Goods and Services Tax (GST)', 'goods-services-tax', 'IRAS overview of the standard-rate rule and exceptions to charging GST.'),
  irasSourceMap('IRAS_GST_ZERO_RATED_EXPORT_SOURCE_MAP', 'IRAS_GST', ['iras-gst-zero-rating', 'iras-gst-export-documentation'],
    'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/charging-gst-(output-tax)/when-to-charge-0-gst-(zero-rate)/exporting-of-goods',
    'Exporting of Goods', 'goods-services-tax', 'IRAS guidance on zero-rating goods exports and required supporting evidence.'),
  irasSourceMap('IRAS_GST_ZERO_RATED_SERVICES_SOURCE_MAP', 'IRAS_GST', ['iras-gst-zero-rating'],
    'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/charging-gst-(output-tax)/when-to-charge-0-gst-(zero-rate)/providing-international-services',
    'Providing international services', 'goods-services-tax', 'IRAS guidance on international services that may qualify for zero-rating.'),
  irasSourceMap('IRAS_GST_EXEMPT_SOURCE_MAP', 'IRAS_GST', ['iras-gst-exempt-supplies', 'iras-gst-partial-exemption'],
    'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/charging-gst-(output-tax)/when-is-gst-not-charged/supplies-exempt-from-gst',
    'Supplies Exempt from GST', 'goods-services-tax', 'IRAS guidance on exempt supplies and input-tax recovery where exempt supplies are made.'),
  irasSourceMap('IRAS_GST_OUT_OF_SCOPE_SOURCE_MAP', 'IRAS_GST', ['iras-gst-out-of-scope-supplies'],
    'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/charging-gst-(output-tax)/when-is-gst-not-charged/out-of-scope-supplies',
    'Out-of-scope Supplies', 'goods-services-tax', 'IRAS guidance on transactions outside the scope of the GST Act.'),
  irasSourceMap('IRAS_GST_INPUT_TAX_SOURCE_MAP', 'IRAS_GST', ['iras-gst-input-tax', 'iras-gst-entertainment'],
    'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax',
    'Conditions for Claiming Input Tax', 'goods-services-tax', 'IRAS input-tax conditions and disallowed or blocked input-tax scenarios.'),
  irasSourceMap('IRAS_GST_MOTOR_VEHICLES_SOURCE_MAP', 'IRAS_GST', ['iras-gst-blocked-input-tax', 'iras-gst-motor-vehicles'],
    'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/common-scenarios---do-i-claim-gst/purchase-and-sale-of-motor-vehicles',
    'Purchase and Sale of Motor Vehicles', 'goods-services-tax', 'IRAS motor-vehicle GST guidance on blocked motor-car input tax and claimable input tax for other vehicles.'),
  irasSourceMap('IRAS_GST_IMPORTED_SERVICES_SOURCE_MAP', 'IRAS_GST', ['iras-gst-imported-services', 'iras-gst-low-value-goods'],
    'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/gst-and-digital-economy/local-businesses',
    'Local businesses importing services and importing or supplying low-value goods', 'goods-services-tax', 'IRAS guidance on reverse charge and overseas vendor registration for local businesses.'),
  irasSourceMap('IRAS_GST_TIME_OF_SUPPLY_SOURCE_MAP', 'IRAS_GST', ['iras-gst-time-of-supply'],
    'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/charging-gst-(output-tax)/when-to-report-supplies-in-gst-returns',
    'When to Report Supplies in GST Returns', 'goods-services-tax', 'IRAS guidance on time-of-supply rules and GST reporting periods.'),
  irasSourceMap('IRAS_GST_INVOICING_SOURCE_MAP', 'IRAS_GST', ['iras-gst-input-tax', 'iras-gst-credit-notes', 'iras-gst-tax-invoice-record-keeping'],
    'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/basics-of-gst/invoicing-price-display-and-record-keeping/invoicing-customers',
    'Invoicing Customers', 'goods-services-tax', 'IRAS guidance on tax invoices, credit notes and supporting records.'),
  irasSourceMap('IRAS_GST_CUSTOMER_ACCOUNTING_SOURCE_MAP', 'IRAS_GST', ['iras-gst-customer-accounting'],
    'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/charging-gst-(output-tax)/when-to-charge-goods-and-services-tax-(gst)/customer-accounting-for-prescribed-goods',
    'Customer Accounting for Prescribed Goods', 'goods-services-tax', 'IRAS guidance on prescribed goods, customer accounting, invoicing and reporting.'),
  irasSourceMap('IRAS_GST_OVR_SOURCE_MAP', 'IRAS_GST', ['iras-gst-ovr', 'iras-gst-low-value-goods'],
    'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/gst-and-digital-economy/overseas-businesses',
    'Overseas businesses supplying remote services and low-value goods to Singapore', 'goods-services-tax', 'IRAS Overseas Vendor Registration guidance for remote services, low-value goods and electronic marketplaces.'),
  irasSourceMap('IRAS_GST_BAD_DEBT_SOURCE_MAP', 'IRAS_GST', ['gst_bad_debt_relief'],
    'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/charging-gst-(output-tax)/common-scenarios---do-i-charge-gst/bad-debt-relief',
    'Bad Debt Relief', 'goods-services-tax', 'IRAS guidance on eligibility and claiming GST bad-debt relief.'),
  irasSourceMap('IRAS_GST_DUE_DATES_SOURCE_MAP', 'IRAS_GST', ['iras-gst-filing-deadlines'],
    'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/filing-gst/due-dates-and-requests-for-extension',
    'Due Dates and Requests for Extension', 'goods-services-tax', 'IRAS guidance on GST return filing and payment due dates.'),
  irasSourceMap('IRAS_IR21_SOURCE_MAP', 'IRAS_EMPLOYER_TAX', ['iras-employer-ir21'],
    'https://www.iras.gov.sg/taxes/individual-income-tax/employers/tax-clearance-for-foreign-spr-employees-(ir21)/tax-clearance-for-employees',
    'Tax Clearance for Employees', 'employer-tax', 'IRAS detailed employer guidance on when Form IR21 is required, the one-month filing timing, withholding monies and exceptions.'),
  irasSourceMap('IRAS_AIS_IR8A_SOURCE_MAP', 'IRAS_EMPLOYER_TAX', ['iras-ais-employment-income', 'iras-stock-options'],
    'https://www.iras.gov.sg/taxes/individual-income-tax/employers/auto-inclusion-scheme-(ais)-for-employment-income/reporting-employee-earnings-(ir8a-appendix-8a-appendix-8b)',
    'Reporting Employee Earnings (IR8A, App 8A/8B)', 'employer-tax', 'IRAS employer reporting guidance for employment income and related annual forms.'),
  irasSourceMap('IRAS_EMPLOYMENT_INCOME_TIMING_SOURCE_MAP', 'IRAS_EMPLOYER_TAX', ['iras-directors-fees', 'iras-employee-bonus-timing'],
    'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/what-is-taxable-what-is-not/employment-income/salary-bonus-director\'s-fee-commission-and-others',
    'Employment Income (Salary, bonus, director\'s fee)', 'employer-tax', 'IRAS guidance on contractual, contingent, advance and non-contractual bonus timing and director-fee assessment timing.'),
  irasSourceMap('IRAS_PERSONAL_RELIEF_CAP_SOURCE_MAP', 'IRAS_INDIVIDUAL_TAX', ['iras-individual-relief-cap'],
    'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-reliefs-rebates-and-deductions/tax-reliefs',
    'Tax Reliefs', 'individual-income-tax', 'IRAS overview of the overall personal income tax relief cap.', '2026-09-29'),
  irasSourceMap('IRAS_CPF_EMPLOYEE_RELIEF_SOURCE_MAP', 'IRAS_INDIVIDUAL_TAX', ['iras-individual-cpf-relief'],
    'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-reliefs-rebates-and-deductions/tax-reliefs/central-provident-fund(cpf)-relief-for-employees',
    'Central Provident Fund (CPF) Relief for employees', 'individual-income-tax', 'IRAS guidance on CPF Relief for compulsory employee contributions.', '2026-09-29'),
  irasSourceMap('IRAS_SRS_RELIEF_SOURCE_MAP', 'IRAS_INDIVIDUAL_TAX', ['iras-individual-srs-relief'],
    'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/special-tax-schemes/srs-contributions',
    'SRS contributions and tax relief', 'individual-income-tax', 'IRAS guidance on Supplementary Retirement Scheme tax relief.', '2026-09-29'),
  irasSourceMap('IRAS_PARENT_RELIEF_SOURCE_MAP', 'IRAS_INDIVIDUAL_TAX', ['iras-individual-parent-relief'],
    'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-reliefs-rebates-and-deductions/tax-reliefs/parent-relief-parent-relief-(disability)',
    'Parent Relief/Parent Relief (Disability)', 'individual-income-tax', 'IRAS guidance on Parent Relief eligibility.', '2026-09-29'),
  irasSourceMap('IRAS_GRANDPARENT_CAREGIVER_RELIEF_SOURCE_MAP', 'IRAS_INDIVIDUAL_TAX', ['iras-individual-grandparent-caregiver-relief'],
    'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-reliefs-rebates-and-deductions/tax-reliefs/grandparent-caregiver-relief',
    'Grandparent Caregiver Relief', 'individual-income-tax', 'IRAS guidance on Grandparent Caregiver Relief eligibility.', '2026-09-29'),
  irasSourceMap('IRAS_WMCR_SOURCE_MAP', 'IRAS_INDIVIDUAL_TAX', ['iras-individual-wmcr'],
    'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-reliefs-rebates-and-deductions/tax-reliefs/working-mother%27s-child-relief-(wmcr)',
    "Working Mother's Child Relief (WMCR)", 'individual-income-tax', 'IRAS guidance on Working Mother\'s Child Relief eligibility.', '2026-09-29'),
  irasSourceMap('IRAS_QCR_SOURCE_MAP', 'IRAS_INDIVIDUAL_TAX', ['iras-individual-qcr'],
    'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-reliefs-rebates-and-deductions/tax-reliefs/qualifying-child-relief-(qcr)-child-relief-(disability)',
    'Qualifying Child Relief (QCR)/Child Relief (Disability)', 'individual-income-tax', 'IRAS guidance on Qualifying Child Relief eligibility.', '2026-09-29'),
  irasSourceMap('IRAS_BENEFITS_IN_KIND_SOURCE_MAP', 'IRAS_EMPLOYER_TAX', ['iras-employment-benefits'],
    'https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/tax-principles-and-flexible-benefits',
    'Tax Principles and Flexible Benefits', 'employer-tax', 'IRAS guidance on taxable employment benefits and benefits-in-kind reporting.')
];

const irasSourceMapsByTopic = new Map<string, IrasSourceMapDefinition[]>();
for (const definition of IRAS_SOURCE_MAP_DEFINITIONS) {
  for (const topicId of definition.topicIds) {
    const topicMaps = irasSourceMapsByTopic.get(topicId) ?? [];
    topicMaps.push(definition);
    irasSourceMapsByTopic.set(topicId, topicMaps);
  }
}

const topicSpecs: TopicSpec[] = [
  // Existing resolver IDs and lexical/semantic metadata are kept intact.
  { id: 'mom_annual_leave', title: 'Paid Annual Leave', domainId: 'MOM_EMPLOYMENT', priority: 'P1', status: 'PARTIAL', keywords: ['annual leave', 'leave entitlement', 'vacation days', 'paid leave', 'section 88a'], actOrStandard: 'Employment Act 1968', sectionMatch: '88a' },
  { id: 'mom_sick_leave', title: 'Outpatient Sick & Hospitalisation Leave', domainId: 'MOM_EMPLOYMENT', priority: 'P1', status: 'PARTIAL', keywords: ['sick leave', 'medical leave', 'hospitalisation leave', 'hospitalization', 'mc', 'section 89'], actOrStandard: 'Employment Act 1968', sectionMatch: '89' },
  { id: 'mom_overtime', title: 'Overtime & Working Hours (Part IV)', domainId: 'MOM_EMPLOYMENT', priority: 'P1', status: 'PARTIAL', keywords: ['overtime', 'part iv', 'working hours', 'rest day', '1.5 times', 'section 38'], actOrStandard: 'Employment Act 1968', sectionMatch: '38', canonicalConceptId: 'mom-part-iv-overtime' },
  { id: 'cpf_wage_ceiling', title: 'CPF Ordinary Wage Ceiling', domainId: 'CPF_CONTRIBUTIONS', priority: 'P1', status: 'IMPLEMENTING', keywords: ['cpf ceiling', 'ordinary wage ceiling', 'ow ceiling', 'cpf limit', 'monthly ceiling'], actOrStandard: 'Central Provident Fund Act 1953', sectionMatch: 'first schedule', sourceRecordIds: ['CPF_WAGE_CEILINGS_2026'], legacyPackIds: ['cpf-and-sdl-payroll'] },
  { id: 'cpf_contribution_rates', title: 'CPF Tiered Contribution Rates by Age', domainId: 'CPF_CONTRIBUTIONS', priority: 'P1', status: 'IMPLEMENTING', keywords: ['cpf rate', 'cpf contribution', 'employee contribution', 'employer contribution', 'age 55'], actOrStandard: 'Central Provident Fund Act 1953', sectionMatch: 'rates', sourceRecordIds: ['CPF_RATES_BY_AGE_2026'], legacyPackIds: ['cpf-and-sdl-payroll'] },
  { id: 'gst_compulsory_registration', title: 'GST Compulsory Registration Threshold', domainId: 'IRAS_GST', priority: 'P1', status: 'IMPLEMENTING', keywords: ['gst registration', 'compulsory registration', '1 million turnover', '1m turnover', 'gst threshold', 'taxable turnover', 'taxable supplies', 'liable to be registered', 'retrospective test', 'prospective test'], exclusionKeywords: ['gst registration number'], actOrStandard: 'Goods and Services Tax Act 1993', sectionMatch: 'first schedule', sourceRecordIds: ['GST_REGISTRATION_COMPULSORY_THRESHOLD'], legacyPackIds: ['gst-registration-and-input-tax'] },
  { id: 'gst_reverse_charge', title: 'GST Reverse Charge on Imported Services', domainId: 'IRAS_GST', priority: 'P1', status: 'IMPLEMENTING', keywords: ['reverse charge', 'imported services', 'b2b imported', 'section 14'], actOrStandard: 'Goods and Services Tax Act 1993', sectionMatch: '14', sourceRecordIds: ['GST_SEC14_REVERSE_CHARGE'], legacyPackIds: ['gst-registration-and-input-tax'], canonicalConceptId: 'gst-reverse-charge-imported-services' },
  { id: 'gst_bad_debt_relief', title: 'GST Bad Debt Relief', domainId: 'IRAS_GST', priority: 'P2', status: 'MISSING', keywords: ['bad debt relief', 'bad debt', 'insolvent customer', 'regulations 82', 'reg 82'], actOrStandard: 'Goods and Services Tax (General) Regulations', sectionMatch: '82', semanticCriteriaKey: 'gst_bad_debt_relief' },
  { id: 'cit_section_14', title: 'Section 14 Tax Deductibility', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', status: 'IMPLEMENTING', keywords: ['section 14', 'wholly and exclusively', 'business expense tax deduction', 'deductible expense'], actOrStandard: 'Income Tax Act 1947', sectionMatch: '14', semanticCriteriaKey: 'cit_section_14', sourceRecordIds: ['ITA_SEC14_GENERAL_DEDUCTION'], legacyPackIds: ['corporate-tax-adjustments'] },
  { id: 'cit_loss_relief', title: 'Tax Loss Carry-Forward & Carry-Back', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', status: 'PARTIAL', keywords: ['loss carry forward', 'loss carry back', 'unabsorbed losses', 'section 37', 'section 37e', 'tax losses', 'unutilized tax losses'], actOrStandard: 'Income Tax Act 1947', sectionMatch: '37', semanticCriteriaKey: 'cit_loss_relief' },
  { id: 'acra_small_company', title: 'Small Company Audit Exemption Criteria', domainId: 'ACRA_COMPANIES', priority: 'P1', status: 'PARTIAL', keywords: ['small company', 'audit exemption', 'audit exempt', '13th schedule', 'revenue 10m', 'assets 10m'], actOrStandard: 'Companies Act 1967', sectionMatch: 'thirteenth schedule' },
  { id: 'acra_record_retention', title: 'Accounting Records Retention Period', domainId: 'ACRA_COMPANIES', priority: 'P1', status: 'IMPLEMENTING', keywords: ['retention of records', 'keep records', '5 years', 'five years', 'accounting records', 'section 199'], actOrStandard: 'Companies Act 1967', sectionMatch: '199', sourceRecordIds: ['ACRA_SEC199_RECORD_RETENTION'], legacyPackIds: ['share-capital-and-corporate-records'] },
  { id: 'acra_financial_statements', title: 'Financial Statements Presentation', domainId: 'ACRA_COMPANIES', priority: 'P1', status: 'PARTIAL', keywords: ['financial statements', 'presentation of accounts', 'section 201', 'true and fair view'], actOrStandard: 'Companies Act 1967', sectionMatch: '201' },
  { id: 'sfrsi_intangibles_cap', title: 'SFRS(I) 1-38 Development Cost Capitalisation', domainId: 'ACCOUNTING_SFRS', priority: 'P1', status: 'PARTIAL', keywords: ['development cost', 'capitalisation', 'intangible asset', 'research vs development', 'technical feasibility', 'paragraph 57', '§57'], actOrStandard: 'SFRS(I) 1-38', sectionMatch: '57', semanticCriteriaKey: 'sfrsi_intangibles_cap' },
  { id: 'sfrsi_leases', title: 'SFRS(I) 16 Lease Capitalisation', domainId: 'ACCOUNTING_SFRS', priority: 'P1', status: 'PLANNED', keywords: ['right of use', 'rou asset', 'lease liability', 'incremental borrowing rate', 'sfrs(i) 16', 'ifrs 16'], actOrStandard: 'SFRS(I) 16', sectionMatch: '22', semanticCriteriaKey: 'sfrsi_leases', sourceRecordIds: ['IFRS16_LEASE_INCEPTION', 'IFRS16_SUBSEQUENT_MEASUREMENT'], legacyPackIds: ['lease-accounting'] },
  { id: 'sfrsi_ppe', title: 'SFRS(I) 1-16 PPE & Depreciation', domainId: 'ACCOUNTING_SFRS', priority: 'P1', status: 'PARTIAL', keywords: ['ppe', 'catch up depreciation', 'derecognition', 'trade in machinery', 'carrying amount', 'sfrs(i) 1-16'], actOrStandard: 'SFRS(I) 1-16', sectionMatch: '55', semanticCriteriaKey: 'sfrsi_ppe' },
  { id: 'acra_share_capital', title: 'Companies Act 1967 Section 68 / 63 Share Capital & Allotment', domainId: 'ACRA_COMPANIES', priority: 'P1', status: 'IMPLEMENTING', keywords: ['share capital', 'allotment', 'no par value', 'unpaid shares', 'section 68', 'section 63', 'own company share'], actOrStandard: 'Companies Act 1967', sectionMatch: '68', semanticCriteriaKey: 'acra_share_capital', sourceRecordIds: ['ACRA_SEC68_NO_PAR_VALUE_SHARES'], legacyPackIds: ['share-capital-and-corporate-records'] },
  { id: 'sfrsi_own_equity', title: 'SFRS(I) 1-32 Own Equity Presentation vs Financial Assets', domainId: 'ACCOUNTING_SFRS', priority: 'P2', status: 'PARTIAL', keywords: ['equity instrument', 'own shares', 'sfrs(i) 1-32', 'ias 32', 'share capital equity'], actOrStandard: 'SFRS(I) 1-32', sectionMatch: '33', semanticCriteriaKey: 'sfrsi_own_equity' },
  { id: 'sfrsi_financial_instruments', title: 'SFRS(I) 9 Financial Assets & Investments', domainId: 'ACCOUNTING_SFRS', priority: 'P1', status: 'PARTIAL', keywords: ['financial asset', 'financial instrument', 'marketable securities', 'shares in other company', 'fvtoci', 'fvtpl', 'amortised cost', 'sfrs(i) 9'], actOrStandard: 'SFRS(I) 9', sectionMatch: '4.1', semanticCriteriaKey: 'sfrsi_financial_instruments', canonicalConceptId: 'sfrsi-financial-asset-classification', sourceRecordIds: ['IFRS9_DEBT_CLASSIFICATION', 'IFRS9_INITIAL_MEASUREMENT', 'IFRS9_EQUITY_CLASSIFICATION', 'SFRSI9_2026_CLASSIFICATION_AMENDMENTS', 'SFRSI9_ADOPTION'] },

  // Financial reporting coverage framework. Status records availability, not a conclusion about a rule.
  { id: 'sfrsi_presentation-financial-statements', title: 'Presentation of Financial Statements', domainId: 'ACCOUNTING_SFRS', priority: 'P1', keywords: ['presentation of financial statements', 'statement of financial position', 'statement of comprehensive income', 'sfrs(i) 1-1', 'ias 1'] },
  { id: 'sfrsi_accounting-policies-estimates-errors', title: 'Accounting Policies, Estimates and Errors', domainId: 'ACCOUNTING_SFRS', priority: 'P1', keywords: ['accounting policy', 'change in accounting estimate', 'prior period error', 'sfrs(i) 1-8', 'ias 8'] },
  { id: 'sfrsi_subsequent-events', title: 'Events after the Reporting Period', domainId: 'ACCOUNTING_SFRS', priority: 'P2', keywords: ['subsequent event', 'events after reporting period', 'adjusting event', 'sfrs(i) 1-10', 'ias 10'] },
  { id: 'sfrsi_cash-flows', title: 'Statement of Cash Flows', domainId: 'ACCOUNTING_SFRS', priority: 'P2', keywords: ['cash flow statement', 'cash flows', 'sfrs(i) 1-7', 'ias 7'] },
  { id: 'sfrsi_inventories', title: 'Inventories', domainId: 'ACCOUNTING_SFRS', priority: 'P1', keywords: ['inventory valuation', 'net realisable value', 'net realizable value', 'cost of inventories', 'sfrs(i) 1-2', 'ias 2'] },
  { id: 'sfrsi_impairment', title: 'Impairment of Assets', domainId: 'ACCOUNTING_SFRS', priority: 'P1', keywords: ['impairment of assets', 'impairment of an asset', 'asset impaired', 'test for impairment', 'impairment test', 'impairment testing', 'impairment assessment', 'impairment loss', 'cash generating unit', 'recoverable amount', 'goodwill impairment', 'sfrs(i) 1-36', 'ias 36'] },
  { id: 'sfrsi_provisions-contingencies', title: 'Provisions and Contingent Liabilities', domainId: 'ACCOUNTING_SFRS', priority: 'P1', keywords: ['warranty provision', 'provision for warranties', 'provision for decommissioning', 'provision for legal claims', 'recognise a provision', 'recognize a provision', 'contingent liability', 'contingent asset', 'onerous contract', 'sfrs(i) 1-37', 'ias 37'] },
  { id: 'sfrsi_income-taxes', title: 'Income Taxes and Deferred Tax', domainId: 'ACCOUNTING_SFRS', priority: 'P1', keywords: ['deferred tax', 'temporary difference', 'income taxes', 'sfrs(i) 1-12', 'ias 12'] },
  { id: 'sfrsi_foreign-currencies', title: 'Foreign Currency Transactions and Translation', domainId: 'ACCOUNTING_SFRS', priority: 'P1', keywords: ['foreign currency', 'functional currency', 'exchange difference', 'translation reserve', 'sfrs(i) 1-21', 'ias 21'] },
  { id: 'sfrsi_related-parties', title: 'Related Party Disclosures', domainId: 'ACCOUNTING_SFRS', priority: 'P2', keywords: ['related party', 'related parties', 'key management personnel', 'sfrs(i) 1-24', 'ias 24'] },
  { id: 'sfrsi_employee-benefits', title: 'Employee Benefits', domainId: 'ACCOUNTING_SFRS', priority: 'P1', keywords: ['employee benefits', 'defined benefit', 'defined contribution', 'sfrs(i) 1-19', 'ias 19'] },
  { id: 'sfrsi_government-grants', title: 'Government Grants', domainId: 'ACCOUNTING_SFRS', priority: 'P2', keywords: ['government grant', 'government assistance', 'sfrs(i) 1-20', 'ias 20'] },
  { id: 'sfrsi_borrowing-costs', title: 'Borrowing Costs', domainId: 'ACCOUNTING_SFRS', priority: 'P2', keywords: ['borrowing costs', 'capitalise borrowing costs', 'qualifying asset', 'sfrs(i) 1-23', 'ias 23'] },
  { id: 'sfrsi_investment-property', title: 'Investment Property', domainId: 'ACCOUNTING_SFRS', priority: 'P2', keywords: ['investment property', 'fair value model property', 'sfrs(i) 1-40', 'ias 40'] },
  { id: 'sfrsi_financial-asset-classification', title: 'Financial Asset Classification and Measurement', domainId: 'ACCOUNTING_SFRS', priority: 'P1', keywords: ['fvtpl', 'fvoci', 'amortised cost', 'business model test', 'contractual cash flows', 'financial asset classification'], canonicalConceptId: 'sfrsi-financial-asset-classification', actOrStandard: 'SFRS(I) 9', sourceRecordIds: ['IFRS9_DEBT_CLASSIFICATION', 'IFRS9_INITIAL_MEASUREMENT', 'IFRS9_EQUITY_CLASSIFICATION', 'SFRSI9_ADOPTION'] },
  { id: 'sfrsi_expected-credit-losses', title: 'Expected Credit Losses', domainId: 'ACCOUNTING_SFRS', priority: 'P1', keywords: ['expected credit loss', 'ecl', 'loss allowance', 'simplified approach', 'financial instrument impairment'], actOrStandard: 'SFRS(I) 9', sourceRecordIds: ['IFRS9_ECL_GENERAL', 'SFRSI9_ADOPTION'] },
  { id: 'sfrsi_revenue_recognition', title: 'Revenue Recognition and Contract Balances', domainId: 'ACCOUNTING_SFRS', priority: 'P1', status: 'PLANNED', keywords: ['revenue recognition', 'contract asset', 'contract liability', 'performance obligation', 'sfrs(i) 15', 'ifrs 15'], actOrStandard: 'SFRS(I) 15', sourceRecordIds: ['SFRS_I_15_REVENUE'], legacyPackIds: ['revenue-recognition'] },
  { id: 'sfrsi_lease_subsequent-measurement', title: 'Lease Subsequent Measurement and Modifications', domainId: 'ACCOUNTING_SFRS', priority: 'P1', status: 'PLANNED', keywords: ['lease subsequent measurement', 'lease modification', 'lease remeasurement', 'rou depreciation'], actOrStandard: 'SFRS(I) 16', sourceRecordIds: ['IFRS16_SUBSEQUENT_MEASUREMENT'], legacyPackIds: ['lease-accounting'] },
  { id: 'sfrsi_associates', title: 'Investments in Associates', domainId: 'ACCOUNTING_SFRS', priority: 'P1', keywords: ['investment in an associate', 'investment in associate', 'investments in associates', 'accounting for associates', 'significant influence', 'equity method associate', 'sfrs(i) 1-28', 'ias 28'], status: 'PARTIAL', sourceRecordIds: ['SFRSI128_SOURCE_MAP', 'SFRSI_FRAMEWORK_ACRA'] },
  { id: 'sfrsi_joint-ventures', title: 'Joint Arrangements and Joint Ventures', domainId: 'ACCOUNTING_SFRS', priority: 'P2', keywords: ['joint venture', 'joint operation', 'joint arrangement', 'sfrs(i) 1-11', 'ifrs 11'], status: 'PARTIAL', sourceRecordIds: ['SFRSI11_SOURCE_MAP', 'SFRSI_FRAMEWORK_ACRA'] },
  { id: 'sfrsi_subsidiaries-consolidation', title: 'Subsidiaries and Consolidated Financial Statements', domainId: 'ACCOUNTING_SFRS', priority: 'P1', keywords: ['account for a subsidiary', 'subsidiary accounting', 'subsidiary consolidation', 'subsidiary be consolidated', 'subsidiary should be consolidated', 'consolidate a subsidiary', 'consolidate my subsidiary', 'consolidate subsidiaries', 'consolidation accounting', 'control of an investee', 'consolidated financial statements', 'sfrs(i) 10', 'ifrs 10'], status: 'PARTIAL', sourceRecordIds: ['SFRSI10_SOURCE_MAP', 'SFRSI_FRAMEWORK_ACRA'] },
  { id: 'sfrsi_business-combinations', title: 'Business Combinations', domainId: 'ACCOUNTING_SFRS', priority: 'P1', keywords: ['business combination', 'acquisition method', 'acquisition date', 'sfrs(i) 3', 'ifrs 3'], status: 'PARTIAL', sourceRecordIds: ['SFRSI3_SOURCE_MAP', 'SFRSI_FRAMEWORK_ACRA'] },
  { id: 'sfrsi_step-acquisitions', title: 'Step Acquisitions', domainId: 'ACCOUNTING_SFRS', priority: 'P1', keywords: ['step acquisition', 'previously held interest', 'remeasure previously held', 'associate to subsidiary'] },
  { id: 'sfrsi_loss-of-control', title: 'Disposal and Loss of Control', domainId: 'ACCOUNTING_SFRS', priority: 'P2', keywords: ['loss of control', 'deconsolidation', 'disposal of subsidiary', 'retained interest'] },
  { id: 'sfrsi_non-controlling-interests', title: 'Non-controlling Interests', domainId: 'ACCOUNTING_SFRS', priority: 'P2', keywords: ['non-controlling interest', 'nci', 'minority interest'] },
  { id: 'sfrsi_goodwill', title: 'Goodwill Recognition and Measurement', domainId: 'ACCOUNTING_SFRS', priority: 'P1', keywords: ['goodwill recognition', 'goodwill measurement', 'goodwill be measured', 'measure goodwill', 'goodwill be recognized', 'goodwill be recognised', 'recognize goodwill', 'recognise goodwill', 'goodwill impairment', 'bargain purchase', 'business combination goodwill'] },
  { id: 'sfrsi_held-for-sale', title: 'Non-current Assets Held for Sale', domainId: 'ACCOUNTING_SFRS', priority: 'P2', keywords: ['held for sale', 'disposal group', 'sfrs(i) 5', 'ifrs 5'], aliases: ['IFRS 5 Non-current Assets Held for Sale and Discontinued Operations'], actOrStandard: 'SFRS(I) 5', pageTitle: 'IFRS 5 Non-current Assets Held for Sale and Discontinued Operations' },
  { id: 'sfrsi_fair-value-measurement', title: 'Fair Value Measurement', domainId: 'ACCOUNTING_SFRS', priority: 'P1', keywords: ['fair value measurement', 'valuation technique', 'level 1 input', 'level 2 input', 'level 3 input', 'sfrs(i) 13', 'ifrs 13'] },
  { id: 'sfrsi_share-based-payments', title: 'Share-based Payment', domainId: 'ACCOUNTING_SFRS', priority: 'P2', keywords: ['share-based payment', 'share based payment', 'share option expense', 'equity-settled award', 'ifrs 2'] },
  { id: 'sfrsi_treasury-shares', title: 'Treasury Shares and Own Equity Transactions', domainId: 'ACCOUNTING_SFRS', priority: 'P2', keywords: ['treasury shares', 'repurchase own shares', 'own equity transaction', 'sfrs(i) 1-32'] },
  { id: 'frs_standard-selection', title: 'Selection Between SFRS(I), FRS and Small Entities Frameworks', domainId: 'ACCOUNTING_FRS', priority: 'P2', keywords: ['frs framework', 'sfrs(i) framework', 'which accounting framework', 'financial reporting framework'] },
  { id: 'frs_small-entities', title: 'SFRS for Small Entities', domainId: 'ACCOUNTING_SMALL_ENTITIES', priority: 'P2', keywords: ['sfrs for small entities', 'small entities standard', 'small entity financial reporting'] },

  // ACRA and Companies Act coverage.
  { id: 'acra_company-incorporation', title: 'Company Incorporation Requirements', domainId: 'ACRA_COMPANIES', priority: 'P1', keywords: ['incorporate a company', 'company incorporation', 'register a company with acra'] },
  { id: 'acra_directors', title: 'Company Director Requirements and Duties', domainId: 'ACRA_COMPANIES', priority: 'P1', keywords: ['company director', 'director duties', 'local resident director', 'appoint director'] },
  { id: 'acra_company-secretary', title: 'Company Secretary Appointment and Duties', domainId: 'ACRA_COMPANIES', priority: 'P1', keywords: ['company secretary', 'appoint secretary', 'secretary appointment'] },
  { id: 'acra_registered-office', title: 'Registered Office Requirements', domainId: 'ACRA_COMPANIES', priority: 'P2', keywords: ['registered office', 'registered address', 'office address for company'] },
  { id: 'acra_share-allotments', title: 'Share Allotments and Issue of Shares', domainId: 'ACRA_COMPANIES', priority: 'P1', keywords: ['share allotment', 'allot shares', 'issue shares', 'return of allotment'] },
  { id: 'acra_share-transfers', title: 'Share Transfers', domainId: 'ACRA_COMPANIES', priority: 'P1', keywords: ['share transfer', 'transfer shares', 'instrument of transfer'] },
  { id: 'acra_preference-shares', title: 'Preference Shares and Share Classes', domainId: 'ACRA_COMPANIES', priority: 'P2', keywords: ['preference shares', 'share class rights', 'class of shares'] },
  { id: 'acra_treasury-shares', title: 'Company Own Shares and Treasury Shares', domainId: 'ACRA_COMPANIES', priority: 'P2', keywords: ['company own shares', 'treasury shares companies act', 'share buyback'] },
  { id: 'acra_capital-reductions', title: 'Share Capital Reductions', domainId: 'ACRA_COMPANIES', priority: 'P1', status: 'IMPLEMENTING', keywords: ['capital reduction', 'reduce share capital', 'section 78b'], actOrStandard: 'Companies Act 1967', sectionMatch: '78B', sourceRecordIds: ['ACRA_SEC78B_CAPITAL_REDUCTION'], legacyPackIds: ['share-capital-and-corporate-records'] },
  { id: 'acra_dividends-distributions', title: 'Dividends and Distributions', domainId: 'ACRA_COMPANIES', priority: 'P1', keywords: ['company dividend', 'dividend distribution', 'lawful dividend'] },
  { id: 'acra_agm', title: 'Annual General Meetings', domainId: 'ACRA_COMPANIES', priority: 'P1', keywords: ['annual general meeting', 'agm requirements', 'hold agm'] },
  { id: 'acra_annual-returns', title: 'Annual Returns', domainId: 'ACRA_COMPANIES', priority: 'P1', keywords: ['annual return filing', 'file annual return', 'acra annual return'] },
  { id: 'acra_xbrl', title: 'XBRL Financial Statement Filing', domainId: 'ACRA_COMPANIES', priority: 'P2', keywords: ['xbrl filing', 'xbrl financial statements', 'acra xbrl'] },
  { id: 'acra_audit-requirements', title: 'Statutory Audit Requirements', domainId: 'ACRA_COMPANIES', priority: 'P1', keywords: ['statutory audit', 'company audit requirement', 'appoint auditor'] },
  { id: 'acra_dormant-companies', title: 'Dormant Company Requirements', domainId: 'ACRA_COMPANIES', priority: 'P2', keywords: ['dormant company', 'dormant companies act', 'dormant company filing'] },
  { id: 'acra_accounting-records', title: 'Company Accounting Records', domainId: 'ACRA_COMPANIES', priority: 'P1', keywords: ['company accounting records', 'keep accounting records', 'section 199 records'] },
  { id: 'acra_rorc', title: 'Register of Registrable Controllers', domainId: 'ACRA_COMPANIES', priority: 'P1', keywords: ['rorc', 'register of registrable controllers', 'registrable controller register'] },
  { id: 'acra_nominee-arrangements', title: 'Nominee Director and Shareholder Disclosures', domainId: 'ACRA_COMPANIES', priority: 'P2', keywords: ['nominee director', 'nominee shareholder', 'nominee arrangements'] },
  { id: 'acra_striking-off', title: 'Company Striking-off', domainId: 'ACRA_COMPANIES', priority: 'P2', keywords: ['strike off company', 'striking off', 'company striking-off'] },
  { id: 'acra_liquidation', title: 'Company Winding Up and Liquidation', domainId: 'ACRA_COMPANIES', priority: 'P2', keywords: ['company liquidation', 'winding up a company', 'liquidation requirements'] },
  { id: 'acra_vcc', title: 'Variable Capital Company Requirements', domainId: 'ACRA_VCC', priority: 'P1', keywords: ['vcc', 'variable capital company', 'vcc requirements', 'vcc act', 'vcc sub-fund'] },
  { id: 'acra_corporate-service-providers', title: 'Corporate Service Provider Obligations', domainId: 'ACRA_CSP', priority: 'P2', keywords: ['corporate service provider', 'csp obligations', 'corporate service providers act'] },

  // IRAS corporate income tax, including investment and fund-related topics.
  { id: 'iras-cit-tax-rate', title: 'Corporate Income Tax Rate', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', keywords: ['corporate tax rate', 'corporate income tax rate', 'tax rate for company'] },
  { id: 'iras-cit-basis-period', title: 'Corporate Tax Basis Period and Year of Assessment', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', keywords: ['corporate basis period', 'basis period tax', 'year of assessment company', 'corporate tax YA'] },
  { id: 'iras-cit-filing-deadlines', title: 'Corporate Income Tax Filing Due Dates', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', keywords: ['corporate tax filing deadline', 'corporate return due date', 'form c filing due date', 'eci filing due date'] },
  { id: 'iras-cit-eci', title: 'Estimated Chargeable Income Filing', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', keywords: ['eci', 'estimated chargeable income', 'file eci'] },
  { id: 'iras-cit-returns', title: 'Form C-S, Form C-S Lite and Form C', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', keywords: ['form c-s', 'form c-s lite', 'form c corporate tax', 'corporate tax return'], sourceRecordIds: ['IRAS_FORM_CS_LITE_CRITERIA'] },
  { id: 'iras-cit-disallowed-expenses', title: 'Prohibited Deductions and Non-deductible Expenses', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', keywords: ['non-deductible expense', 'non-deductible threshold', 'prohibited deduction', 'section 15 deduction', 'entertainment expense tax', 'entertainment expenses', 'company passenger motor car expenses', 's-plate passenger car tax deduction'], queryPatterns: [String.raw`\b(?:s-plate|passenger (?:motor )?car)\b[\s\S]{0,120}\b(?:deduct\w*|tax deduction|capital allowances?)\b`], actOrStandard: 'Income Tax Act 1947', sectionMatch: '15', sourceRecordIds: ['ITA_SEC15_PROHIBITED_DEDUCTIONS', 'ITA_SEC15_1_K_MOTOR_CAR'], legacyPackIds: ['corporate-tax-adjustments'] },
  { id: 'iras-cit-deductibility', title: 'Corporate Tax Deductibility', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', status: 'IMPLEMENTING', keywords: ['tax deductibility', 'deductibility', 'tax deductible', 'deductible for tax', 'staff welfare expense tax', 'staff welfare', 'entertainment expenses'], queryPatterns: [String.raw`\b(?:expense|cost|payment|fee)\b[\s\S]{0,100}\b(?:tax deduction|deductible for tax|tax deductible)\b`, String.raw`\b(?:tax deduction|deductible for tax|tax deductible)\b[\s\S]{0,100}\b(?:expense|cost|payment|fee)\b`, String.raw`\brenovat\w*\b[\s\S]{0,100}\b(?:tax|deduct\w*|claim\w*|immediate(?:ly)?)\b`], actOrStandard: 'Income Tax Act 1947', sectionMatch: '14', sourceRecordIds: ['ITA_SEC14_GENERAL_DEDUCTION'], legacyPackIds: ['corporate-tax-adjustments'] },
  { id: 'iras-capital-allowances', title: 'Capital Allowances under Sections 19 and 19A', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', status: 'IMPLEMENTING', keywords: ['capital allowance', 'section 19', 'section 19a', 'accelerated capital allowance'], actOrStandard: 'Income Tax Act 1947', sectionMatch: '19/19A', sourceRecordIds: ['ITA_SEC19_19A_CAPITAL_ALLOWANCES'], legacyPackIds: ['corporate-tax-adjustments'] },
  { id: 'iras-cit-renovation-refurbishment', title: 'Renovation and Refurbishment Deductions', domainId: 'IRAS_CORPORATE_TAX', priority: 'P2', keywords: ['renovation and refurbishment', 'r&r deduction', 'renovation tax deduction', 'section 14n', '14n deduction'], queryPatterns: [String.raw`\brenovat\w*\b[\s\S]{0,100}\b(?:deduct\w*|claim\w*|immediate(?:ly)?)\b`, String.raw`\b(?:deduct\w*|claim\w*|immediate(?:ly)?)\b[\s\S]{0,100}\brenovat\w*\b`], sourceRecordIds: ['ITA_SEC14N_RENOVATION_REFURBISHMENT_PRE2025', 'ITA_SEC14N_RENOVATION_REFURBISHMENT'] },
  { id: 'iras-cit-sute', title: 'Start-up Tax Exemption', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', keywords: ['sute', 'start-up tax exemption', 'startup tax exemption'] },
  { id: 'iras-cit-pte', title: 'Partial Tax Exemption', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', keywords: ['pte', 'partial tax exemption', 'partial tax exempt'] },
  { id: 'iras-cit-donations', title: 'Tax Treatment of Donations', domainId: 'IRAS_CORPORATE_TAX', priority: 'P2', keywords: ['corporate donation', 'donation deduction company', 'tax deduction for donations'] },
  { id: 'iras-cit-loss-carry-forward', title: 'Carry-forward of Tax Losses and Capital Allowances', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', keywords: ['loss carry-forward', 'loss carry forward', 'capital allowance carry forward', 'unabsorbed capital allowance'], queryPatterns: [String.raw`\b(?:prior|previous|preceding|last|earlier)[\s-]+(?:financial\s+|basis\s+|tax\s+)?(?:year|ya)\s+(?:trade\s+)?losses?\b`, String.raw`\b(?:trade\s+)?losses?\b[\s\S]{0,80}\b(?:from|of)\s+(?:the\s+)?(?:prior|previous|preceding|last|earlier)[\s-]+(?:financial\s+|basis\s+|tax\s+)?(?:year|ya)\b`], aliases: ['Unutilised trade losses', 'Unutilised capital allowances'], sourceRecordIds: ['ITA_SEC37_LOSS_CARRY_FORWARD'] },
  { id: 'iras-cit-loss-carry-back', title: 'Carry-back Relief', domainId: 'IRAS_CORPORATE_TAX', priority: 'P2', keywords: ['carry-back relief', 'carry back tax loss', 'loss carry-back'], queryPatterns: [String.raw`\bcarry(?:[-\s]+)back\b[\s\S]{0,100}\b(?:unabsorbed\s+)?(?:trade\s+)?losses?\b[\s\S]{0,100}\b(?:immediately\s+)?(?:preceding|prior|previous)\s+ya\b`] },
  { id: 'iras-group-relief', title: 'Group Relief', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', keywords: ['group relief', 'transfer losses within group', 'group relief claim'] },
  { id: 'iras-substantial-shareholding-test', title: 'Substantial Shareholding Test for Loss Carry-forward', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', keywords: ['substantial shareholding test', 'shareholding test tax losses', 'continuous ownership tax loss'], queryPatterns: [String.raw`\b(?:prior|previous|preceding|last)[\s-]+(?:financial\s+|basis\s+|tax\s+)?(?:year|ya)\s+(?:trade\s+)?losses?\b`, String.raw`\b(?:carry forward|use|claim|utili[sz]e)\b[\s\S]{0,100}\b(?:trade\s+)?losses?\b`], aliases: ['Shareholding Test'], sourceRecordIds: ['ITA_SEC37_LOSS_CARRY_FORWARD'] },
  { id: 'iras-withholding-tax', title: 'Withholding Tax on Payments to Non-residents', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', keywords: ['withholding tax', 'wht', 'section 45 withholding', 'non-resident payment'] },
  { id: 'iras-wht-deemed-payment-date', title: 'Withholding Tax Deemed Payment Date', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', keywords: ['withholding tax deemed payment', 'wht date of payment', 'when wht is due and payable', 'withholding tax accrual date'], queryPatterns: [String.raw`\b(?:wht|withholding tax)\b[\s\S]{0,80}\b(?:treated as paid|deemed (?:payment|paid|date))\b`] },
  { id: 'iras-wht-filing-payment-due-date', title: 'Withholding Tax Filing and Payment Due Date', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', keywords: ['withholding tax filing due date', 'wht payment deadline', 'pay withholding tax to iras'], queryPatterns: [String.raw`\b(?:wht|withholding tax)\b[\s\S]{0,180}\b(?:filing due|payment due|due date|deadline)\b`] },
  { id: 'iras-wht-treaty-relief', title: 'Withholding Tax Treaty Relief and Exemption', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', keywords: ['withholding tax treaty relief', 'wht tax treaty rate', 'dta withholding tax exemption'], queryPatterns: [String.raw`\b(?:wht|withholding tax)\b[\s\S]{0,200}\b(?:treaty relief|treaty|dta)\b`] },
  { id: 'iras-foreign-tax-credit', title: 'Foreign Tax Credit and Double Tax Relief', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', keywords: ['foreign tax credit', 'claim foreign tax credit', 'double tax relief foreign tax credit', 'foreign tax paid singapore credit'], exclusionKeywords: ['form c-s', 'form c-s lite'] },
  { id: 'iras-withholding-tax-management-fees', title: 'Withholding Tax on Management and Service Fees', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', keywords: ['management fee withholding tax', 'service fee withholding tax', 'consultancy fee non-resident'], queryPatterns: [String.raw`\b(?:management|service|consultancy)\s+fees?\b[\s\S]{0,140}\b(?:wht|withholding tax)\b`, String.raw`\b(?:wht|withholding tax)\b[\s\S]{0,140}\b(?:management|service|consultancy)\s+fees?\b`], sourceRecordIds: ['ITA_SEC45A_WITHHOLDING_TAX_ROYALTIES'] },
  { id: 'iras-withholding-tax-interest-royalties', title: 'Withholding Tax on Interest and Royalties', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', keywords: ['interest withholding tax', 'royalty withholding tax', 'royalties paid overseas'], queryPatterns: [String.raw`\binterest\b[\s\S]{0,140}\b(?:wht|withholding tax)\b`, String.raw`\b(?:wht|withholding tax)\b[\s\S]{0,140}\binterest\b`], sourceRecordIds: ['ITA_SEC45_WITHHOLDING_TAX'] },
  { id: 'iras-double-tax-agreements', title: 'Double Tax Agreements and Treaty Relief', domainId: 'IRAS_CORPORATE_TAX', priority: 'P2', keywords: ['double tax agreement', 'dta', 'tax treaty'] },
  { id: 'iras-corporate-tax-residency', title: 'Company Tax Residency', domainId: 'IRAS_CORPORATE_TAX', priority: 'P2', keywords: ['company tax residency', 'tax resident company', 'corporate tax residence'] },
  { id: 'iras-foreign-sourced-income', title: 'Foreign-sourced Income and Exemptions', domainId: 'IRAS_CORPORATE_TAX', priority: 'P2', keywords: ['foreign-sourced income', 'foreign sourced income', 'foreign income exemption'] },
  { id: 'iras-section-13-exemptions', title: 'Section 13 Corporate Tax Exemptions', domainId: 'IRAS_CORPORATE_TAX', priority: 'P2', keywords: ['section 13 exemption', 'section 13 tax exemption', 'foreign income section 13'] },
  { id: 'iras-transfer-pricing', title: 'Transfer Pricing and Related-party Transactions', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', keywords: ['transfer pricing', 'related-party transaction', 'related party transaction', 'arm’s length', 'arm\'s length'] },
  { id: 'iras-transfer-pricing-documentation', title: 'Transfer Pricing Documentation', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', keywords: ['transfer pricing documentation', 'tpd', 'contemporaneous documentation', 'documentation threshold'] },
  { id: 'iras-related-party-loans', title: 'Related-party Loans and Arm’s-length Interest', domainId: 'IRAS_CORPORATE_TAX', priority: 'P2', keywords: ['related-party loan', 'related party loan', 'intercompany loan interest', 'arm\'s length interest'] },
  { id: 'iras-disposal-gains', title: 'Tax Treatment of Gains and Losses on Disposal', domainId: 'IRAS_CORPORATE_TAX', priority: 'P2', keywords: ['gain on disposal tax', 'loss on disposal tax', 'tax treatment of disposal gains'] },
  { id: 'iras-section-13w', title: 'Section 13W Exemption', domainId: 'IRAS_CORPORATE_TAX', priority: 'P2', keywords: ['section 13w', '13w exemption', '13w share disposal'], sourceRecordIds: ['ITA_SEC13W_EQUITY_DISPOSAL_SAFE_HARBOUR', 'ITA_SEC13W_EQUITY_DISPOSAL_2026'] },
  { id: 'iras-investment-holding-company', title: 'Investment Holding Company Tax Topics', domainId: 'IRAS_CORPORATE_TAX', priority: 'P2', keywords: ['investment holding company tax', 'investment holding company', 'ihc tax'] },
  { id: 'iras-fund-tax-incentives-13o', title: 'Section 13O Fund Tax Incentive', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', keywords: ['13o', 'section 13o', '13o tax incentive', '13o scheme'] },
  { id: 'iras-fund-tax-incentives-13u', title: 'Section 13U Fund Tax Incentive', domainId: 'IRAS_CORPORATE_TAX', priority: 'P1', keywords: ['13u', 'section 13u', '13u tax incentive', '13u scheme'] },
  { id: 'iras-family-office-tax', title: 'Family Office Tax Topics', domainId: 'IRAS_CORPORATE_TAX', priority: 'P2', keywords: ['family office tax', 'family office tax treatment'] },

  // IRAS GST.
  { id: 'iras-gst-voluntary-registration', title: 'Voluntary GST Registration', domainId: 'IRAS_GST', priority: 'P1', keywords: ['voluntary gst registration', 'apply for gst voluntarily', 'voluntary gst registration conditions'] },
  { id: 'iras-gst-turnover-tests', title: 'Retrospective and Prospective GST Registration Tests', domainId: 'IRAS_GST', priority: 'P1', keywords: ['retrospective test', 'prospective test', 'taxable turnover', 'gst turnover test', 'taxable supplies', 'reasonable grounds for believing'], sourceRecordIds: ['GST_REGISTRATION_COMPULSORY_THRESHOLD'] },
  { id: 'iras-gst-standard-rated-supplies', title: 'Standard-rated Supplies', domainId: 'IRAS_GST', priority: 'P1', keywords: ['standard-rated supply', 'standard rated supplies', 'standard rate gst'], queryPatterns: [String.raw`\b(?:gst|gst rate|rate)\b[\s\S]{0,100}\b(?:invoice\w*|invoic\w*)\b[\s\S]{0,180}\b(?:payment|paid|receiv\w*|receipt)\b`, String.raw`\b(?:invoice\w*|invoic\w*)\b[\s\S]{0,180}\b(?:payment|paid|receiv\w*|receipt)\b[\s\S]{0,100}\b(?:gst|rate)\b`] },
  { id: 'iras-gst-zero-rating', title: 'Zero-rated Supplies and Export Eligibility', domainId: 'IRAS_GST', priority: 'P1', keywords: ['zero-rated', 'zero rated', 'zero-rating', 'zero rating gst', 'section 21(3)'] },
  { id: 'iras-gst-exempt-supplies', title: 'Exempt Supplies', domainId: 'IRAS_GST', priority: 'P1', keywords: ['exempt supply', 'exempt supplies', 'exempt from gst'] },
  { id: 'iras-gst-out-of-scope-supplies', title: 'Out-of-scope Supplies', domainId: 'IRAS_GST', priority: 'P2', keywords: ['out-of-scope supply', 'out of scope supply', 'outside scope gst'], queryPatterns: [String.raw`\bservices?\b[\s\S]{0,140}\b(?:overseas|outside singapore)\b[\s\S]{0,140}\b(?:out[ -]of[ -]scope|zero[ -]?rated)\b`, String.raw`\b(?:out[ -]of[ -]scope|zero[ -]?rated)\b[\s\S]{0,140}\bservices?\b[\s\S]{0,140}\b(?:overseas|outside singapore)\b`] },
  { id: 'iras-gst-input-tax', title: 'Input Tax Claims and Tax Invoice Requirements', domainId: 'IRAS_GST', priority: 'P1', keywords: ['input tax claim', 'tax invoice requirements', 'claim input gst', 'input gst', 'claimed tax invoices', 'input taxes'], queryPatterns: [String.raw`\b(?:gst|input tax|input gst)\b[\s\S]{0,140}\b(?:meals?|dining|entertainment)\b[\s\S]{0,100}\b(?:customers?|clients?|suppliers?)\b`, String.raw`\b(?:meals?|dining|entertainment)\b[\s\S]{0,140}\b(?:customers?|clients?|suppliers?)\b[\s\S]{0,100}\b(?:gst|input tax|input gst)\b`] },
  { id: 'iras-gst-blocked-input-tax', title: 'Blocked Input Tax', domainId: 'IRAS_GST', priority: 'P1', keywords: ['blocked input tax', 'motor car input tax', 'club subscription input tax', 'regulation 26'], queryPatterns: [String.raw`\b(?:passenger\s+(?:motor\s+)?car|s-plate)\b[\s\S]{0,140}\b(?:gst|input tax|input gst)\b`, String.raw`\b(?:gst|input tax|input gst)\b[\s\S]{0,140}\b(?:passenger\s+(?:motor\s+)?car|s-plate)\b`], actOrStandard: 'Goods and Services Tax (General) Regulations', sectionMatch: '26 and 27', sourceRecordIds: ['GST_REG26_BLOCKED_INPUT_TAX'], legacyPackIds: ['gst-registration-and-input-tax'] },
  { id: 'iras-gst-partial-exemption', title: 'Partial Exemption and De Minimis Rules', domainId: 'IRAS_GST', priority: 'P2', keywords: ['partial exemption gst', 'de minimis', 'de minimis rule'] },
  { id: 'iras-gst-imported-services', title: 'GST on Imported Services', domainId: 'IRAS_GST', priority: 'P1', keywords: ['imported services', 'services from overseas vendor', 'overseas services gst'], canonicalConceptId: 'gst-reverse-charge-imported-services' },
  { id: 'iras-gst-ovr', title: 'Overseas Vendor Registration for Remote Services and Low-value Goods', domainId: 'IRAS_GST', priority: 'P1', keywords: ['overseas vendor registration', 'ovr remote services', 'ovr low-value goods', 'overseas digital services gst'] },
  { id: 'iras-gst-customer-accounting', title: 'GST Customer Accounting for Prescribed Goods', domainId: 'IRAS_GST', priority: 'P1', keywords: ['gst customer accounting', 'prescribed goods customer accounting', 'customer accounting tax invoice'] },
  { id: 'iras-gst-tax-invoice-record-keeping', title: 'GST Tax Invoices and Record Keeping', domainId: 'IRAS_GST', priority: 'P1', keywords: ['gst tax invoice requirements', 'gst record keeping', 'retain tax invoices gst', 'gst records retention'] },
  { id: 'iras-gst-low-value-goods', title: 'GST on Low-value Goods', domainId: 'IRAS_GST', priority: 'P2', keywords: ['low-value goods', 'low value goods', 'lvg gst'] },
  { id: 'iras-gst-time-of-supply', title: 'Time of Supply', domainId: 'IRAS_GST', priority: 'P1', keywords: ['time of supply', 'tax point gst', 'when to account for gst'], queryPatterns: [String.raw`\b(?:invoice\w*|invoic\w*)\b[\s\S]{0,180}\b(?:payment|paid|receiv\w*|receipt)\b[\s\S]{0,140}\b(?:gst|rate)\b`, String.raw`\b(?:gst|rate)\b[\s\S]{0,140}\b(?:invoice\w*|invoic\w*)\b[\s\S]{0,180}\b(?:payment|paid|receiv\w*|receipt)\b`] },
  { id: 'iras-gst-credit-notes', title: 'Credit Notes and GST Adjustments', domainId: 'IRAS_GST', priority: 'P2', keywords: ['gst credit note', 'credit note gst', 'output tax adjustment'] },
  { id: 'iras-gst-trade-ins', title: 'GST Treatment of Trade-ins', domainId: 'IRAS_GST', priority: 'P2', keywords: ['trade-in gst', 'trade in gst', 'trade-in transaction'] },
  { id: 'iras-gst-reimbursements', title: 'Reimbursements and Disbursements', domainId: 'IRAS_GST', priority: 'P2', keywords: ['gst reimbursement', 'gst disbursement', 'reimbursements and disbursements'] },
  { id: 'iras-gst-employee-expenses', title: 'GST on Employee Expenses', domainId: 'IRAS_GST', priority: 'P2', keywords: ['employee expense gst', 'staff expense input tax', 'employee reimbursement gst'] },
  { id: 'iras-gst-entertainment', title: 'GST on Entertainment and Meals', domainId: 'IRAS_GST', priority: 'P2', keywords: ['entertainment input tax', 'meals gst claim', 'business entertainment gst'], requiredContentTerms: ['entertainment expenses', 'name of person entertained', 'purpose of entertainment'], queryPatterns: [String.raw`\b(?:gst|input tax|input gst)\b[\s\S]{0,140}\b(?:meals?|dining|entertainment)\b[\s\S]{0,100}\b(?:customers?|clients?|suppliers?|business)\b`, String.raw`\b(?:meals?|dining|entertainment)\b[\s\S]{0,140}\b(?:customers?|clients?|suppliers?|business)\b[\s\S]{0,100}\b(?:gst|input tax|input gst)\b`] },
  { id: 'iras-gst-motor-vehicles', title: 'GST on Motor Vehicles', domainId: 'IRAS_GST', priority: 'P1', keywords: ['motor vehicle gst', 'motor car input tax', 'car gst claim'], queryPatterns: [String.raw`\b(?:passenger\s+(?:motor\s+)?car|s-plate)\b[\s\S]{0,140}\b(?:gst|input tax|input gst)\b`, String.raw`\b(?:gst|input tax|input gst)\b[\s\S]{0,140}\b(?:passenger\s+(?:motor\s+)?car|s-plate)\b`], aliases: ['Purchase and Sale of Motor Vehicles', 'motor vehicle input tax'], actOrStandard: 'Goods and Services Tax (General) Regulations', sectionMatch: 'Regulation 25(1) and 27' },
  { id: 'iras-gst-export-documentation', title: 'Export Documentation and Zero-rating Evidence', domainId: 'IRAS_GST', priority: 'P1', keywords: ['export documentation gst', 'export evidence', 'proof of export', 'documentation criteria', 'exported goods', 'cross-border digital services'] },
  { id: 'iras-gst-groups', title: 'GST Group Registration', domainId: 'IRAS_GST', priority: 'P2', keywords: ['gst group', 'gst group registration', 'group registration gst'] },
  { id: 'iras-gst-qualifying-funds', title: 'GST Remission for Qualifying Funds', domainId: 'IRAS_GST', priority: 'P2', keywords: ['qualifying fund gst', 'fund gst remission', 'gst remission fund'] },
  { id: 'iras-gst-filing-deadlines', title: 'GST Return and Payment Due Dates', domainId: 'IRAS_GST', priority: 'P1', keywords: ['gst filing deadline', 'gst return due date', 'gst payment due date', 'accounting period gst return'] },

  // IRAS employer, individual, property and stamp duty.
  { id: 'iras-ais-employment-income', title: 'Auto-Inclusion Scheme and Employment Income Reporting', domainId: 'IRAS_EMPLOYER_TAX', priority: 'P1', keywords: ['ais', 'auto-inclusion scheme', 'auto inclusion scheme', 'ir8a', 'ir8s'], queryPatterns: [String.raw`\bbonus\b[\s\S]{0,140}\b(?:report\w*|payroll|ir8a|employment income)\b`, String.raw`\b(?:report\w*|payroll|ir8a|employment income)\b[\s\S]{0,140}\bbonus\b`] },
  { id: 'iras-employer-ir21', title: 'Tax Clearance for Foreign Employees — IR21', domainId: 'IRAS_EMPLOYER_TAX', priority: 'P1', keywords: ['ir21', 'tax clearance foreign employee', 'tax clearance for non-singapore citizen', 'withhold monies employee'], aliases: ['Tax Clearance for Employees'] },
  { id: 'iras-employment-benefits', title: 'Benefits in Kind and Employment Benefits Reporting', domainId: 'IRAS_EMPLOYER_TAX', priority: 'P2', keywords: ['benefits-in-kind', 'benefits in kind', 'employee benefits tax reporting'] },
  { id: 'iras-employee-bonus-timing', title: 'Tax Timing of Employment Bonuses', domainId: 'IRAS_EMPLOYER_TAX', priority: 'P1', keywords: ['employment bonus tax timing', 'when bonus is taxable', 'bonus entitlement year of assessment', 'contractual bonus tax'], queryPatterns: [String.raw`\bbonus\b[\s\S]{0,140}\b(?:report\w*|payroll|ir8a|taxable|year of assessment)\b`, String.raw`\b(?:report\w*|payroll|ir8a|taxable|year of assessment)\b[\s\S]{0,140}\bbonus\b`], aliases: ['Taxes on Bonuses', 'Contractual Bonus', 'Non-contractual Bonus'] },
  { id: 'iras-directors-fees', title: 'Directors’ Fees for Tax Reporting', domainId: 'IRAS_EMPLOYER_TAX', priority: 'P2', keywords: ['directors fees tax', 'director fee reporting', 'directors’ fees'] },
  { id: 'iras-stock-options', title: 'Employee Stock Options and Share Benefits', domainId: 'IRAS_EMPLOYER_TAX', priority: 'P2', keywords: ['employee stock option tax', 'stock options employment income', 'share award tax'] },
  { id: 'iras-individual-tax-residency', title: 'Individual Tax Residency and Days of Presence', domainId: 'IRAS_INDIVIDUAL_TAX', priority: 'P1', keywords: ['tax residency', 'tax resident individual', 'singapore tax resident', 'tax resident in singapore', '183-day', '183 day', 'non-resident employment income'] },
  { id: 'iras-individual-overseas-employment', title: 'Individual Tax Treatment of Working Outside Singapore', domainId: 'IRAS_INDIVIDUAL_TAX', priority: 'P1', keywords: ['working outside singapore', 'overseas employment individual', 'employee posted overseas', 'overseas employment income', 'overseas secondment tax', 'overseas employment'], aliases: ['Overseas employment', 'Working outside Singapore'], queryPatterns: [String.raw`\b(?:work(?:ing)?|employment|secondment|posted)\b[\s\S]{0,100}\b(?:overseas|outside singapore|abroad)\b`] },
  { id: 'iras-individual-foreign-employment-income', title: 'Individual Foreign-sourced Employment Income', domainId: 'IRAS_INDIVIDUAL_TAX', priority: 'P1', keywords: ['individual foreign-sourced employment income', 'foreign sourced employment income', 'foreign employment income individual', 'foreign-sourced income', 'foreign sourced income', 'employment services rendered overseas', 'income from overseas employment'], aliases: ['Taxable overseas employment income', 'Overseas employment'], queryPatterns: [String.raw`\b(?:work(?:ing)?|employment|secondment|posted)\b[\s\S]{0,100}\b(?:overseas|outside singapore|abroad)\b`] },
  { id: 'iras-individual-foreign-tax-credit', title: 'Individual Foreign Tax Credit and Double Tax Relief', domainId: 'IRAS_INDIVIDUAL_TAX', priority: 'P1', keywords: ['individual foreign tax credit', 'foreign tax credit individual', 'foreign tax credit', 'claim foreign tax credit individual', 'double taxation relief', 'double tax relief individual', 'taxed in the foreign country', 'taxed twice on the same income'], aliases: ['Claiming foreign tax credit'] },
  { id: 'iras-individual-double-tax-agreements', title: 'Individual Double Tax Agreement Relief', domainId: 'IRAS_INDIVIDUAL_TAX', priority: 'P1', keywords: ['individual double tax agreement', 'individual dta relief', 'employment income dta exemption', 'dependent services treaty relief', 'double taxation relief individual', 'individual double taxation relief', 'double taxation agreements'], aliases: ['Claiming exemptions under Avoidance of Double Taxation Agreements', 'Double Taxation Agreements (DTA)'], queryPatterns: [String.raw`\b(?:double[ -]tax(?:ation)?|dta|tax treaty)\b[\s\S]{0,100}\b(?:relief|exemption|employment|income|foreign|overseas)\b`, String.raw`\b(?:relief|exemption|employment|income|foreign|overseas)\b[\s\S]{0,100}\b(?:double[ -]tax(?:ation)?|dta|tax treaty)\b`] },
  { id: 'iras-individual-certificate-of-residence', title: 'Certificate of Residence for Individuals', domainId: 'IRAS_INDIVIDUAL_TAX', priority: 'P2', keywords: ['individual certificate of residence', 'apply for certificate of residence', 'certificate of residence individual', 'cor for dta benefits'], aliases: ['Apply for COR'], queryPatterns: [String.raw`\b(?:certificate of residence|\bcor\b)[\s\S]{0,80}\b(?:dta|treaty|individual|tax resident)\b`] },
  { id: 'iras-individual-reliefs', title: 'Individual Tax Relief Eligibility', domainId: 'IRAS_INDIVIDUAL_TAX', priority: 'P2', routingOnly: true, keywords: ['personal tax relief', 'individual tax relief', 'srs contribution relief', 'working mother child relief', 'qualifying child relief', 'cpf cash top-up relief'] },
  { id: 'iras-individual-relief-cap', title: 'Overall Personal Income Tax Relief Cap', domainId: 'IRAS_INDIVIDUAL_TAX', priority: 'P2', keywords: ['personal relief cap', 'overall relief cap', 'aggregate tax relief cap', 'personal income tax relief cap'] },
  { id: 'iras-individual-cpf-relief', title: 'CPF Relief for Employees', domainId: 'IRAS_INDIVIDUAL_TAX', priority: 'P2', keywords: ['cpf relief for employees', 'mandatory cpf contributions', 'compulsory cpf contributions'] },
  { id: 'iras-individual-srs-relief', title: 'Supplementary Retirement Scheme Relief', domainId: 'IRAS_INDIVIDUAL_TAX', priority: 'P2', keywords: ['srs relief', 'supplementary retirement scheme relief'] },
  { id: 'iras-individual-parent-relief', title: 'Parent Relief', domainId: 'IRAS_INDIVIDUAL_TAX', priority: 'P2', keywords: ['parent relief', 'parent relief disability'] },
  { id: 'iras-individual-grandparent-caregiver-relief', title: 'Grandparent Caregiver Relief', domainId: 'IRAS_INDIVIDUAL_TAX', priority: 'P2', keywords: ['grandparent caregiver relief', 'caregiver relief'] },
  { id: 'iras-individual-wmcr', title: "Working Mother's Child Relief", domainId: 'IRAS_INDIVIDUAL_TAX', priority: 'P2', keywords: ['working mother child relief', 'wmcr'] },
  { id: 'iras-individual-qcr', title: 'Qualifying Child Relief', domainId: 'IRAS_INDIVIDUAL_TAX', priority: 'P2', keywords: ['qualifying child relief', 'qcr'] },
  { id: 'iras-property-tax-annual-value', title: 'Property Tax and Annual Value', domainId: 'IRAS_PROPERTY_TAX', priority: 'P1', keywords: ['property tax', 'annual value', 'owner-occupied property tax', 'non-owner-occupied property tax'] },
  { id: 'iras-stamp-duty-bsd', title: 'Buyer’s Stamp Duty', domainId: 'IRAS_STAMP_DUTY', priority: 'P1', keywords: ['bsd', 'buyers stamp duty', 'buyer’s stamp duty', 'buyer stamp duty'] },
  { id: 'iras-stamp-duty-absd', title: 'Additional Buyer’s Stamp Duty', domainId: 'IRAS_STAMP_DUTY', priority: 'P1', keywords: ['absd', 'additional buyers stamp duty', 'additional buyer’s stamp duty'] },
  { id: 'iras-stamp-duty-ssd', title: 'Seller’s Stamp Duty', domainId: 'IRAS_STAMP_DUTY', priority: 'P2', keywords: ['ssd', 'seller stamp duty', 'seller’s stamp duty'] },
  { id: 'iras-stamp-duty-remissions', title: 'Stamp Duty Remissions', domainId: 'IRAS_STAMP_DUTY', priority: 'P2', keywords: ['stamp duty remission', 'absd remission', 'married couple remission', 'housing developer remission'] },
  { id: 'iras-stamp-duty-leases', title: 'Stamp Duty on Leases and Average Annual Rent', domainId: 'IRAS_STAMP_DUTY', priority: 'P1', keywords: ['lease stamp duty', 'aar', 'average annual rent', 'e-stamping', 'lease duty'] },
  { id: 'iras-property-tax-use-status', title: 'Property Tax Use and Occupation Classification', domainId: 'IRAS_PROPERTY_TAX', priority: 'P2', keywords: ['owner occupied', 'owner-occupied', 'non-owner occupied', 'property use status'] },

  // MOM employment standards and foreign workforce.
  { id: 'mom-employment-act-coverage', title: 'Employment Act Coverage', domainId: 'MOM_EMPLOYMENT', priority: 'P1', keywords: ['employment act coverage', 'covered by employment act', 'employee categorization', 'employee category under employment act'] },
  { id: 'mom-part-iv-overtime', title: 'Part IV Working Hours and Overtime Eligibility', domainId: 'MOM_EMPLOYMENT', priority: 'P1', keywords: ['part iv', 'overtime eligibility', 'overtime pay', 'working hours limit', 'hours of work'], canonicalConceptId: 'mom-part-iv-overtime' },
  { id: 'mom-salary-payment', title: 'Salary Periods, Payment and Deductions', domainId: 'MOM_EMPLOYMENT', priority: 'P1', keywords: ['salary payment', 'salary period', 'salary deductions', 'deduct salary', 'when must salary be paid'] },
  { id: 'mom-rest-days', title: 'Rest Days and Rest-day Pay', domainId: 'MOM_EMPLOYMENT', priority: 'P1', keywords: ['rest day', 'rest-day pay', 'work on rest day'] },
  { id: 'mom-public-holidays', title: 'Public Holiday Entitlements and Pay', domainId: 'MOM_EMPLOYMENT', priority: 'P1', keywords: ['public holiday pay', 'public holiday entitlement', 'work on public holiday'] },
  { id: 'mom-leave-entitlements', title: 'Employment Leave Entitlements', domainId: 'MOM_EMPLOYMENT', priority: 'P1', keywords: ['leave entitlement', 'annual leave progression', 'sick leave entitlement', 'hospitalisation leave'], exclusionKeywords: ['annual leave', 'sick leave', 'hospitalisation leave'] },
  { id: 'mom-maternity-leave', title: 'Maternity Leave', domainId: 'MOM_EMPLOYMENT', priority: 'P1', keywords: ['maternity leave', 'maternity benefit'] },
  { id: 'mom-paternity-leave', title: 'Paternity Leave', domainId: 'MOM_EMPLOYMENT', priority: 'P1', keywords: ['paternity leave', 'government-paid paternity leave'] },
  { id: 'mom-shared-parental-leave', title: 'Shared Parental Leave', domainId: 'MOM_EMPLOYMENT', priority: 'P2', keywords: ['shared parental leave', 'parental leave'] },
  { id: 'mom-childcare-leave', title: 'Childcare and Infant-care Leave', domainId: 'MOM_EMPLOYMENT', priority: 'P1', keywords: ['childcare leave', 'infant-care leave', 'infant care leave'] },
  { id: 'mom-termination-notice', title: 'Termination Notice and Salary in Lieu', domainId: 'MOM_EMPLOYMENT', priority: 'P1', keywords: ['termination notice', 'notice period employment', 'salary in lieu of notice', 'notice pay'] },
  { id: 'mom-retrenchment', title: 'Retrenchment and Retrenchment Notifications', domainId: 'MOM_EMPLOYMENT', priority: 'P1', keywords: ['retrenchment', 'retrenchment notification', 'notify mom retrenchment'] },
  { id: 'mom-key-employment-terms', title: 'Key Employment Terms and Employment Records', domainId: 'MOM_EMPLOYMENT', priority: 'P1', keywords: ['key employment terms', 'ket', 'employment records', 'salary records'] },
  { id: 'mom-flexible-work-arrangements', title: 'Flexible Work Arrangement Requests', domainId: 'MOM_EMPLOYMENT', priority: 'P2', keywords: ['flexible work arrangement', 'fwa', 'tripartite guidelines flexible work', 'flexible work requests'] },
  { id: 'mom-progressive-wage-model', title: 'Progressive Wage Model', domainId: 'MOM_EMPLOYMENT', priority: 'P1', keywords: ['progressive wage model', 'pwm', 'progressive wages'] },
  { id: 'mom-employment-claims-tadm', title: 'Employment Claims and TADM Mediation', domainId: 'MOM_EMPLOYMENT', priority: 'P2', keywords: ['tadm', 'tripartite alliance for dispute management', 'employment claim mediation', 'employment claims'] },
  { id: 'mom-work-passes-employment-pass', title: 'Employment Pass', domainId: 'MOM_WORK_PASSES', priority: 'P1', keywords: ['employment pass', 'ep eligibility', 'employment pass criteria'] },
  { id: 'mom-work-passes-s-pass', title: 'S Pass', domainId: 'MOM_WORK_PASSES', priority: 'P1', keywords: ['s pass', 's-pass', 's pass eligibility'] },
  { id: 'mom-work-passes-work-permit', title: 'Work Permit', domainId: 'MOM_WORK_PASSES', priority: 'P1', keywords: ['work permit', 'foreign worker permit', 'work permit eligibility'] },
  { id: 'mom-foreign-workforce-drc', title: 'Foreign Workforce Dependency Ratio Ceilings', domainId: 'MOM_FOREIGN_WORKFORCE', priority: 'P1', keywords: ['drc', 'dependency ratio ceiling', 'dependency ratio ceilings', 'foreign worker quota', 'quota by sector'] },
  { id: 'mom-foreign-worker-levy', title: 'Foreign Worker Levy', domainId: 'MOM_FOREIGN_WORKFORCE', priority: 'P1', keywords: ['foreign worker levy', 'foreign worker levies', 'fwl', 'levy tier'] },
  { id: 'mom-work-pass-quotas', title: 'Work Pass Quotas', domainId: 'MOM_FOREIGN_WORKFORCE', priority: 'P1', keywords: ['work pass quota', 'foreign worker quota', 'quota for work permits'] },

  // CPF and payroll levies.
  { id: 'cpf-pr-contribution-rates', title: 'CPF Rates for Permanent Residents by PR Year', domainId: 'CPF_CONTRIBUTIONS', priority: 'P1', keywords: ['pr first year cpf', 'pr second year cpf', 'pr third year cpf', 'permanent resident cpf rate'] },
  { id: 'cpf-ordinary-wages', title: 'CPF Treatment of Ordinary Wages', domainId: 'CPF_CONTRIBUTIONS', priority: 'P1', keywords: ['ordinary wages', 'ordinary wage cpf', 'ow cpf'] },
  { id: 'cpf-additional-wages', title: 'CPF Treatment of Additional Wages', domainId: 'CPF_CONTRIBUTIONS', priority: 'P1', keywords: ['additional wages', 'additional wage cpf', 'aw cpf', 'bonus cpf'] },
  { id: 'cpf-additional-wage-ceiling', title: 'CPF Additional Wage Ceiling', domainId: 'CPF_CONTRIBUTIONS', priority: 'P1', keywords: ['aw ceiling', 'additional wage ceiling', 'cpf additional wage limit'] },
  { id: 'cpf-contribution-due-dates', title: 'CPF Contribution Due Dates and Late Payment', domainId: 'CPF_CONTRIBUTIONS', priority: 'P1', keywords: ['cpf due date', 'late cpf payment', 'cpf payment deadline'] },
  { id: 'cpf-adjustments-refunds', title: 'CPF Adjustments and Refunds', domainId: 'CPF_CONTRIBUTIONS', priority: 'P2', keywords: ['cpf contribution adjustment', 'cpf refund', 'refund cpf contribution'] },
  { id: 'cpf-bonus-backpay', title: 'CPF Treatment of Bonus and Back-pay', domainId: 'CPF_CONTRIBUTIONS', priority: 'P1', keywords: ['bonus cpf', 'back-pay cpf', 'backpay cpf', 'cpf on bonus'] },
  { id: 'cpf-notice-pay-leave-encashment', title: 'CPF on Notice Pay and Leave Encashment', domainId: 'CPF_CONTRIBUTIONS', priority: 'P2', keywords: ['cpf notice pay', 'cpf leave encashment', 'cpf salary in lieu'] },
  { id: 'cpf-allowances', title: 'CPF Treatment of Allowances', domainId: 'CPF_CONTRIBUTIONS', priority: 'P2', keywords: ['cpf on allowance', 'allowances cpf', 'cpf contributions allowances'] },
  { id: 'cpf-contribution-rounding', title: 'CPF Contribution Rounding', domainId: 'CPF_CONTRIBUTIONS', priority: 'P2', keywords: ['cpf rounding', 'rounding cpf contribution', 'cpf contribution calculation rounding'] },
  { id: 'cpf-skills-development-levy', title: 'Skills Development Levy', domainId: 'CPF_PAYROLL_LEVIES', priority: 'P1', keywords: ['skills development levy', 'sdl', 'sdl levy'], sourceRecordIds: ['CPF_SDL_SKILLS_DEVELOPMENT_LEVY'], status: 'IMPLEMENTING', legacyPackIds: ['cpf-and-sdl-payroll'] },
  { id: 'cpf-self-help-group-contributions', title: 'Self-help Group Payroll Contributions', domainId: 'CPF_PAYROLL_LEVIES', priority: 'P2', keywords: ['self-help group contribution', 'sinda', 'cdac', 'mbmf', 'ecf', 'shg contribution'] },
  { id: 'cpf-cash-top-up-tax-relief', title: 'CPF Cash Top-ups and Related Tax Relief Routing', domainId: 'CPF_CONTRIBUTIONS', priority: 'P2', authorities: ['CPF', 'IRAS'], keywords: ['cpf cash top-up', 'cpf cash top up', 'cash top-up to cpf', 'cash top up to cpf'] },

  // MAS fund management, family office, reporting and AML/CFT.
  { id: 'mas-cms-licence', title: 'Capital Markets Services Licence', domainId: 'MAS_FUND_MANAGEMENT', priority: 'P1', keywords: ['cms licence', 'capital markets services licence', 'capital markets services license'] },
  { id: 'mas-lfmc', title: 'Licensed Fund Management Company', domainId: 'MAS_FUND_MANAGEMENT', priority: 'P1', keywords: ['lfmc', 'licensed fund management company', 'fund management licence'] },
  { id: 'mas-vcfm', title: 'Venture Capital Fund Manager', domainId: 'MAS_FUND_MANAGEMENT', priority: 'P2', keywords: ['vcfm', 'venture capital fund manager', 'venture capital fund management'] },
  { id: 'mas-fund-management-exemptions', title: 'Fund Management Licensing Exemptions', domainId: 'MAS_FUND_MANAGEMENT', priority: 'P1', keywords: ['fund manager exemption', 'fund management exemption', 'exempt fund manager'] },
  { id: 'mas-single-family-office', title: 'Single Family Office Regulation', domainId: 'MAS_FAMILY_OFFICE', priority: 'P1', keywords: ['single family office', 'sfo', 'family office exemption'] },
  { id: 'mas-family-office-13o', title: 'MAS Requirements Relating to Section 13O Funds', domainId: 'MAS_FAMILY_OFFICE', priority: 'P1', keywords: ['13o', 'section 13o', '13o fund', '13o family office'] },
  { id: 'mas-family-office-13u', title: 'MAS Requirements Relating to Section 13U Funds', domainId: 'MAS_FAMILY_OFFICE', priority: 'P1', keywords: ['13u', 'section 13u', '13u fund', '13u family office'] },
  { id: 'mas-material-changes', title: 'Material Change Notifications', domainId: 'MAS_FAMILY_OFFICE', priority: 'P2', keywords: ['material change mas', 'material changes fund incentive', 'notify mas material change'] },
  { id: 'mas-vcc-fund-structures', title: 'VCC Fund Structures and Sub-funds', domainId: 'MAS_FAMILY_OFFICE', priority: 'P1', keywords: ['vcc fund structure', 'vcc sub-fund', 'vcc umbrella'] },
  { id: 'mas-fund-administration', title: 'Fund Administration', domainId: 'MAS_FUND_MANAGEMENT', priority: 'P2', keywords: ['fund administration', 'fund administrator mas', 'fund admin requirements'] },
  { id: 'mas-nav-valuation-governance', title: 'NAV and Valuation Governance', domainId: 'MAS_REGULATORY_REPORTING', priority: 'P1', keywords: ['nav governance', 'fund valuation governance', 'valuation policy fund'] },
  { id: 'mas-outsourcing', title: 'Outsourcing Requirements', domainId: 'MAS_REGULATORY_REPORTING', priority: 'P2', keywords: ['mas outsourcing', 'outsourcing requirements fund manager', 'outsourcing arrangement'] },
  { id: 'mas-regulatory-reporting', title: 'Regulatory Reporting', domainId: 'MAS_REGULATORY_REPORTING', priority: 'P1', keywords: ['mas regulatory reporting', 'regulatory return fund manager', 'mas reporting requirements'] },
  { id: 'mas-quarterly-fund-data-collection', title: 'Quarterly Fund Data Collection', domainId: 'MAS_REGULATORY_REPORTING', priority: 'P2', status: 'MISSING', keywords: ['qdc', 'quarterly fund data collection', 'basic qdc', 'full qdc', 'qdc reporting through mas-tx'] },
  { id: 'mas-aml-cft', title: 'AML and CFT Requirements for Regulated Entities', domainId: 'MAS_AML', priority: 'P1', keywords: ['aml', 'cft', 'anti-money laundering', 'anti money laundering', 'mas aml'] },
  { id: 'mas-notices-guidelines', title: 'MAS Notices and Guidelines', domainId: 'MAS_REGULATORY_REPORTING', priority: 'P2', keywords: ['mas notice', 'mas guideline', 'mas notices', 'mas guidelines'] },

  // Singapore Customs.
  { id: 'customs-import-procedures', title: 'Import Procedures', domainId: 'CUSTOMS', priority: 'P2', keywords: ['import procedures customs', 'import goods singapore', 'customs import'] },
  { id: 'customs-import-gst', title: 'Import GST and Customs', domainId: 'CUSTOMS', priority: 'P1', keywords: ['import gst', 'customs import gst', 'gst on imported goods'] },
  { id: 'customs-export-procedures', title: 'Export Procedures', domainId: 'CUSTOMS', priority: 'P2', keywords: ['export procedures customs', 'customs export', 'export goods singapore'] },
  { id: 'customs-permits-tradenet', title: 'Customs Permits and TradeNet', domainId: 'CUSTOMS', priority: 'P2', keywords: ['customs permit', 'tradenet', 'trade net permit'] },
  { id: 'customs-valuation', title: 'Customs Valuation', domainId: 'CUSTOMS', priority: 'P2', keywords: ['customs valuation', 'customs value', 'customs declared value'] },
  { id: 'customs-dutiable-goods', title: 'Dutiable Goods', domainId: 'CUSTOMS', priority: 'P2', keywords: ['dutiable goods', 'customs duty goods', 'excise duty goods'] },
  { id: 'customs-temporary-imports', title: 'Temporary Imports', domainId: 'CUSTOMS', priority: 'P3', keywords: ['temporary import', 'temporary imports customs'] },
  { id: 'customs-ftz', title: 'Free Trade Zones', domainId: 'CUSTOMS', priority: 'P3', keywords: ['free trade zone', 'ftz', 'free-trade zone'] },
  { id: 'customs-zero-gst-warehouse', title: 'Zero-GST Warehouses', domainId: 'CUSTOMS', priority: 'P3', keywords: ['zero-gst warehouse', 'zero gst warehouse', 'zg warehouse'] },

  // Singapore CRS and FATCA compliance.
  { id: 'iras-crs-fatca-financial-institution', title: 'Financial Institution Classification', domainId: 'IRAS_CRS_FATCA', priority: 'P2', keywords: ['financial institution classification crs', 'reporting financial institution', 'fatca financial institution'] },
  { id: 'iras-crs-fatca-reporting-fi', title: 'Reporting Financial Institution Status', domainId: 'IRAS_CRS_FATCA', priority: 'P2', keywords: ['reporting fi', 'reporting financial institution status'] },
  { id: 'iras-crs-fatca-non-reporting-fi', title: 'Non-reporting Financial Institution Status', domainId: 'IRAS_CRS_FATCA', priority: 'P3', keywords: ['non-reporting fi', 'non-reporting financial institution'] },
  { id: 'iras-crs-fatca-investment-entity', title: 'Investment Entity Classification', domainId: 'IRAS_CRS_FATCA', priority: 'P2', keywords: ['investment entity crs', 'investment entity fatca'] },
  { id: 'iras-crs-fatca-active-nfe', title: 'Active NFE Classification', domainId: 'IRAS_CRS_FATCA', priority: 'P2', keywords: ['active nfe', 'active non-financial entity'] },
  { id: 'iras-crs-fatca-passive-nfe', title: 'Passive NFE and Controlling Persons', domainId: 'IRAS_CRS_FATCA', priority: 'P2', keywords: ['passive nfe', 'passive non-financial entity', 'controlling persons crs'] },
  { id: 'iras-fatca-framework', title: 'Singapore FATCA Framework', domainId: 'IRAS_CRS_FATCA', priority: 'P2', keywords: ['fatca', 'singapore fatca', 'fatca model 1'] },
  { id: 'iras-crs-framework', title: 'Common Reporting Standard Framework', domainId: 'IRAS_CRS_FATCA', priority: 'P2', keywords: ['crs', 'common reporting standard', 'crs reporting singapore'] },
  { id: 'iras-crs-fatca-registration', title: 'CRS and FATCA Registration', domainId: 'IRAS_CRS_FATCA', priority: 'P2', keywords: ['crs registration', 'fatca registration', 'register for fatca'] },
  { id: 'iras-crs-fatca-due-diligence', title: 'CRS and FATCA Due Diligence', domainId: 'IRAS_CRS_FATCA', priority: 'P2', keywords: ['crs due diligence', 'fatca due diligence', 'account due diligence'] },
  { id: 'iras-crs-fatca-account-classification', title: 'Financial Account Classification', domainId: 'IRAS_CRS_FATCA', priority: 'P2', keywords: ['account classification crs', 'classify financial account fatca'] },
  { id: 'iras-crs-fatca-reporting', title: 'CRS and FATCA Reporting and Nil Returns', domainId: 'IRAS_CRS_FATCA', priority: 'P2', keywords: ['crs reporting deadline', 'fatca reporting deadline', 'crs nil return', 'fatca nil return'] },
  { id: 'iras-crs-fatca-self-certification', title: 'Entity Self-certification', domainId: 'IRAS_CRS_FATCA', priority: 'P3', keywords: ['entity self-certification', 'crs self-certification', 'fatca self-certification'] }
];

const sourceMapStandards = {
  sfrsi10: {
    instrument: 'SFRS(I) 10 — Consolidated Financial Statements',
    sourceId: 'SFRSI10_SOURCE_MAP',
    url: 'https://www.ifrs.org/issued-standards/list-of-standards/ifrs-10-consolidated-financial-statements/',
    pageTitle: 'IFRS 10 Consolidated Financial Statements',
    subdomain: 'Consolidation and control'
  },
  sfrsi3: {
    instrument: 'SFRS(I) 3 — Business Combinations',
    sourceId: 'SFRSI3_SOURCE_MAP',
    url: 'https://www.ifrs.org/issued-standards/list-of-standards/ifrs-3-business-combinations/',
    pageTitle: 'IFRS 3 Business Combinations',
    subdomain: 'Business combinations'
  },
  sfrsi128: {
    instrument: 'SFRS(I) 1-28 — Investments in Associates and Joint Ventures',
    sourceId: 'SFRSI128_SOURCE_MAP',
    url: 'https://www.ifrs.org/issued-standards/list-of-standards/ias-28-investments-in-associates-and-joint-ventures/',
    pageTitle: 'IAS 28 Investments in Associates and Joint Ventures',
    subdomain: 'Associates and equity accounting'
  },
  sfrsi11: {
    instrument: 'SFRS(I) 11 — Joint Arrangements',
    sourceId: 'SFRSI11_SOURCE_MAP',
    url: 'https://www.ifrs.org/issued-standards/list-of-standards/ifrs-11-joint-arrangements/',
    pageTitle: 'IFRS 11 Joint Arrangements',
    subdomain: 'Joint arrangements'
  }
} as const;

interface MappedTopicDefinition {
  id: string;
  title: string;
  keywords: string[];
  queryPatterns?: string[];
  related?: string[];
  standards?: string[];
}

function mappedTopic(standardKey: keyof typeof sourceMapStandards, definition: MappedTopicDefinition): TopicSpec {
  const source = sourceMapStandards[standardKey];
  const standards = definition.standards ?? [standardKey];
  const sources = standards.map(key => sourceMapStandards[key as keyof typeof sourceMapStandards]);
  return {
    id: definition.id,
    title: definition.title,
    domainId: 'ACCOUNTING_SFRS',
    priority: 'P1',
    status: 'PARTIAL',
    // Short titles such as "goodwill" and "control" are retrieval aliases,
    // but too broad as classification triggers in unrelated regulatory questions.
    keywords: [...new Set(definition.keywords)],
    ...(definition.queryPatterns ? { queryPatterns: [...definition.queryPatterns] } : {}),
    aliases: [...new Set([definition.title, ...definition.keywords])],
    authorities: ['ACRA'],
    sourceRecordIds: [...new Set([...sources.map(item => item.sourceId), 'SFRSI_FRAMEWORK_ACRA'])],
    actOrStandard: standards.map(key => sourceMapStandards[key as keyof typeof sourceMapStandards].instrument).join('; '),
    subdomain: source.subdomain,
    shortDescription: `Routes ${definition.title} questions to an official standard overview. The mapped page is not paragraph-level SFRS(I) text.`,
    canonicalSourceId: source.sourceId,
    canonicalSourceUrl: source.url,
    pageTitle: source.pageTitle,
    paragraphHints: [],
    sectionHints: [definition.title, ...definition.keywords],
    relatedTopicIds: definition.related ?? [],
    lastVerifiedDate: '2026-09-25',
    lifecycleState: 'ACTIVE'
  };
}

// Cross-standard transition topics require an affirmative purchase of an
// additional interest followed by obtaining control. This avoids treating
// missing-fact wording such as "no additional shares were acquired" as a step
// acquisition merely because it mentions the equity method.
const EQUITY_ACCOUNTED_CONTROL_ACQUISITION_PATTERN = String.raw`(?=[\s\S]*\b(?:equity[- ]accounted|equity method|associate)\b)(?=[\s\S]*\b(?:acquir\w*|bought|purchas\w*)\b[\s\S]{0,90}\b(?:another|additional|further)\b[\s\S]{0,40}(?:\b\d+(?:\.\d+)?\s*%(?!\w)|\bshares?\b|\binterest\b|\bstake\b))(?=[\s\S]*\b(?:obtain\w*|gain\w*|achiev\w*)\s+control\b)(?![\s\S]*\b(?:no|not|never|without)\b[\s\S]{0,40}\b(?:obtain\w*|gain\w*|achiev\w*)\s+control\b)`;

const consolidationTopicSpecs: TopicSpec[] = [
  // SFRS(I) 10 — granular routing topics; hints are descriptive only and contain no invented paragraph numbers.
  ...[
    { id: 'sfrsi10-control', title: 'Control', keywords: ['control of an investee', 'control assessment', 'investor controls investee'], queryPatterns: [String.raw`\b(?:retain|retaining)\b[\s\S]{0,50}\bcontrol\b`, String.raw`\bcontrols?\s+(?:the\s+)?investee\b`, String.raw`\bpotential\s+voting\s+rights?\b`, String.raw`\bobtained\s+control\b`], related: ['sfrsi10-power', 'sfrsi10-variable-returns', 'sfrsi10-ability-to-affect-returns'] },
    { id: 'sfrsi10-power', title: 'Power', keywords: ['relevant activities', 'power over investee', 'decision making rights'], queryPatterns: [String.raw`\bdirects?\s+the\s+relevant\s+operating\s+decisions\b`, String.raw`\bpotential\s+voting\s+rights?\b`, String.raw`\bpower\s+over\s+the\s+investee\b`], related: ['sfrsi10-control', 'sfrsi10-potential-voting-rights'] },
    { id: 'sfrsi10-variable-returns', title: 'Variable returns', keywords: ['exposure to variable returns', 'returns from investee'], related: ['sfrsi10-control', 'sfrsi10-ability-to-affect-returns'] },
    { id: 'sfrsi10-ability-to-affect-returns', title: 'Ability to affect returns', keywords: ['link between power and returns', 'use power to affect returns'], related: ['sfrsi10-control', 'sfrsi10-power', 'sfrsi10-variable-returns'] },
    { id: 'sfrsi10-de-facto-control', title: 'De facto control', keywords: ['less than majority voting rights', 'practical ability to direct', 'dispersed other shareholders'], queryPatterns: [String.raw`\bremaining\s+shares\s+(?:are\s+)?widely\s+dispersed\b`], related: ['sfrsi10-control', 'sfrsi10-power'] },
    { id: 'sfrsi10-potential-voting-rights', title: 'Potential voting rights', keywords: ['convertible instruments', 'substantive potential voting rights', 'share options', 'options over shares'], queryPatterns: [String.raw`\bpotential\s+voting\s+rights?\b`, String.raw`\boption\s+to\s+acquire\s+another\s+\d+(?:\.\d+)?\s*%`], related: ['sfrsi10-control', 'sfrsi10-power'] },
    { id: 'sfrsi10-acquisition-control-date', title: 'Acquisition and control date', keywords: ['date control is obtained', 'when control begins', 'acquisition date control'], queryPatterns: [String.raw`\bability to direct relevant activities\b`], related: ['sfrsi3-acquisition-date', 'sfrsi-associate-to-subsidiary', 'sfrsi-step-acquisition'] },
    { id: 'sfrsi10-consolidation', title: 'Consolidation', keywords: ['consolidated financial statements', 'consolidate subsidiary', 'consolidation procedures'], queryPatterns: [String.raw`\binvestee be consolidated\b`], related: ['sfrsi10-control', 'sfrsi10-nci', 'sfrsi10-intragroup-eliminations'] },
    { id: 'sfrsi10-nci', title: 'Non-controlling interests', keywords: ['non controlling interest', 'non-controlling interest', 'minority interest'], related: ['sfrsi3-nci', 'sfrsi10-ownership-changes', 'sfrsi10-loss-of-control'] },
    { id: 'sfrsi10-ownership-changes', title: 'Changes in ownership interests', keywords: ['partial disposal without loss of control', 'ownership change while retaining control', 'non-controlling interest change'], queryPatterns: [String.raw`\bownership\s+change\s+presented\b`, String.raw`\b(?:sell|sells|sold|dispose|disposes|disposed)\b[\s\S]{0,100}\b(?:retain|retaining)\b[\s\S]{0,50}\bcontrol\b`], related: ['sfrsi10-nci', 'sfrsi10-loss-of-control'] },
    { id: 'sfrsi10-loss-of-control', title: 'Loss of control', keywords: ['disposal of subsidiary', 'deconsolidation', 'retained interest after loss of control'], queryPatterns: [String.raw`\b(?:sell|sells|sold|dispose|disposes|disposed)\b[\s\S]{0,100}\b(?:lose|loss of)\s+control\b`], related: ['sfrsi10-ownership-changes', 'sfrsi128-significant-influence', 'sfrsi128-equity-method'] },
    { id: 'sfrsi10-intragroup-eliminations', title: 'Intra-group eliminations', keywords: ['intragroup balances', 'intra-group transactions', 'unrealised profits in consolidation'], related: ['sfrsi10-consolidation'] }
  ].map(item => mappedTopic('sfrsi10', item)),

  // SFRS(I) 3 — acquisition method routing; no paragraph-level claims are encoded here.
  ...[
    { id: 'sfrsi3-business-combination', title: 'Identifying a business combination', keywords: ['acquired set is a business', 'business or asset acquisition', 'definition of a business'], related: ['sfrsi3-acquisition-method'] },
    { id: 'sfrsi3-acquisition-method', title: 'Acquisition method', keywords: ['accounting for business combination', 'acquisition accounting'], queryPatterns: [String.raw`(?=[\s\S]*\bdefinition of a business\b)(?=[\s\S]*\bequity method\b)(?=[\s\S]*\b(?:acquir\w*|obtain\w*\s+control)\b)`], related: ['sfrsi3-acquirer', 'sfrsi3-acquisition-date', 'sfrsi3-identifiable-net-assets', 'sfrsi3-goodwill'] },
    { id: 'sfrsi3-acquirer', title: 'Acquirer', keywords: ['identify the acquirer', 'accounting acquirer'], related: ['sfrsi10-control', 'sfrsi3-acquisition-date'] },
    { id: 'sfrsi3-acquisition-date', title: 'Acquisition date', keywords: ['date acquirer obtains control', 'business combination date'], queryPatterns: [String.raw`\bacquisition-date measurements?\b`], related: ['sfrsi10-acquisition-control-date', 'sfrsi3-acquirer'] },
    { id: 'sfrsi3-consideration', title: 'Consideration transferred', keywords: ['consideration transferred', 'purchase consideration', 'contingent payment'], queryPatterns: [String.raw`\bconsideration transferred\b`], related: ['sfrsi3-goodwill', 'sfrsi3-contingent-consideration'] },
    { id: 'sfrsi3-identifiable-net-assets', title: 'Identifiable net assets', keywords: ['identifiable assets acquired', 'liabilities assumed', 'acquisition-date fair values'], queryPatterns: [String.raw`\bidentifiable net assets\b`, String.raw`\bacquisition-date measurements?\b`], related: ['sfrsi3-goodwill', 'sfrsi3-bargain-purchase'] },
    { id: 'sfrsi3-nci', title: 'Non-controlling interests', keywords: ['measure nci', 'non controlling interests at acquisition'], queryPatterns: [String.raw`(?=[\s\S]*\bnon[- ]controlling interests?\b)(?=[\s\S]*\b(?:business combination|acquisition(?:[- ]date)?|at acquisition|acquired control|acquisition accounting)\b)`], related: ['sfrsi10-nci', 'sfrsi3-goodwill'] },
    { id: 'sfrsi3-goodwill', title: 'Goodwill', keywords: ['calculate goodwill', 'goodwill on acquisition', 'goodwill calculation'], queryPatterns: [String.raw`\bhow much goodwill\b`, String.raw`\bacquisition-date measurements?\b`], related: ['sfrsi3-consideration', 'sfrsi3-identifiable-net-assets', 'sfrsi3-nci', 'sfrsi3-bargain-purchase'] },
    { id: 'sfrsi3-bargain-purchase', title: 'Bargain purchase', keywords: ['bargain purchase gain', 'negative goodwill'], related: ['sfrsi3-identifiable-net-assets', 'sfrsi3-goodwill'] },
    { id: 'sfrsi3-acquisition-costs', title: 'Acquisition-related costs', keywords: ['acquisition costs', 'deal fees', 'advisory and legal costs business combination'], related: ['sfrsi3-acquisition-method'] },
    { id: 'sfrsi3-contingent-consideration', title: 'Contingent consideration', keywords: ['earn-out', 'contingent consideration payable'], related: ['sfrsi3-consideration', 'sfrsi3-measurement-period'] },
    { id: 'sfrsi3-step-acquisition', title: 'Step acquisition', keywords: ['previously held equity interest', 'associate becomes subsidiary', 'remeasure existing interest'], queryPatterns: [
      EQUITY_ACCOUNTED_CONTROL_ACQUISITION_PATTERN,
      String.raw`(?=[\s\S]*\b(?:goodwill|bargain purchase)\b)(?=[\s\S]*\b(?:not provided|missing|unknown|not specified)\b)(?=[\s\S]*\b(?:fair value of any )?previously held (?:equity )?interest\b)`
    ], related: ['sfrsi10-control', 'sfrsi128-to-subsidiary', 'sfrsi-associate-to-subsidiary'] },
    { id: 'sfrsi3-measurement-period', title: 'Measurement period', keywords: ['provisional acquisition accounting', 'measurement period adjustment'], related: ['sfrsi3-acquisition-date', 'sfrsi3-identifiable-net-assets'] }
  ].map(item => mappedTopic('sfrsi3', item)),

  // SFRS(I) 1-28 — investment-in-associate topics.
  ...[
    { id: 'sfrsi128-significant-influence', title: 'Significant influence', keywords: ['ability to participate in financial and operating policy decisions', 'influence over investee', 'associate assessment'], queryPatterns: [String.raw`\bparticipate\s+in\s+decisions\s+about\s+(?:its\s+)?financial\s+and\s+operating\s+policies\b`, String.raw`\b20\s*%\s+threshold\s+conclusive\b`, String.raw`\bdo\s+not\s+participate\s+in\s+policy\s+decisions\b`, String.raw`\bcannot\s+obtain\s+the\s+information\s+needed\s+to\s+influence\b`, String.raw`\bsignificant influence over (?:an )?investee\b`, String.raw`\bboard representation\b[\s\S]{0,100}\bparticipation in policy decisions\b`], related: ['sfrsi128-20-percent-presumption', 'sfrsi128-equity-method'] },
    { id: 'sfrsi128-20-percent-presumption', title: '20% significant-influence presumption', keywords: ['20 percent voting power', '20% ownership', 'below 20 percent influence', 'over 20 percent without influence'], queryPatterns: [String.raw`\bbelow\s+20\s*%(?!\w)`, String.raw`\b(?:ownership|holding)\b[\s\S]{0,30}\bbelow\s+20\s*%(?!\w)`, String.raw`\b20\s*%\s+threshold\s+conclusive\b`], related: ['sfrsi128-significant-influence'] },
    { id: 'sfrsi128-equity-method', title: 'Equity method', keywords: ['equity accounting', 'associate accounting method'], queryPatterns: [String.raw`\b(?:applied|apply|applying)\s+(?:the\s+)?equity method\b`, String.raw`\bequity[- ]accounted\b`], related: ['sfrsi128-share-of-profit-oci', 'sfrsi128-distributions', 'sfrsi128-losses'] },
    { id: 'sfrsi128-share-of-profit-oci', title: 'Share of profit and OCI', keywords: ['share of associate profit', 'share of associate other comprehensive income', 'associate OCI'], related: ['sfrsi128-equity-method', 'sfrsi128-losses'] },
    { id: 'sfrsi128-distributions', title: 'Distributions received', keywords: ['dividend from associate', 'associate distribution'], related: ['sfrsi128-equity-method'] },
    { id: 'sfrsi128-losses', title: 'Share of losses', keywords: ['associate losses', 'equity method losses', 'net investment in associate'], related: ['sfrsi128-equity-method', 'sfrsi128-impairment'] },
    { id: 'sfrsi128-impairment', title: 'Impairment interaction', keywords: ['impairment of associate investment', 'impairment equity method investment'], related: ['sfrsi128-losses', 'sfrsi128-disposal'] },
    { id: 'sfrsi128-disposal', title: 'Disposal of an associate', keywords: ['sell associate investment', 'partial disposal associate'], related: ['sfrsi128-cessation-influence', 'sfrsi10-loss-of-control'] },
    { id: 'sfrsi128-cessation-influence', title: 'Cessation of significant influence', keywords: ['cease to be associate', 'loss of significant influence'], related: ['sfrsi128-disposal', 'sfrsi10-control'] },
    { id: 'sfrsi128-to-subsidiary', title: 'Associate becomes subsidiary', keywords: ['associate becomes a subsidiary', 'associate to subsidiary', 'obtain control of associate'], queryPatterns: [EQUITY_ACCOUNTED_CONTROL_ACQUISITION_PATTERN], related: ['sfrsi-associate-to-subsidiary', 'sfrsi3-step-acquisition', 'sfrsi10-acquisition-control-date'], standards: ['sfrsi128', 'sfrsi10', 'sfrsi3'] }
  ].map(item => mappedTopic('sfrsi128', item)),

  // SFRS(I) 11 — arrangement classification and accounting.
  ...[
    { id: 'sfrsi11-joint-control', title: 'Joint control', keywords: ['contractually agreed sharing of control', 'shared control arrangement'], queryPatterns: [String.raw`\bunanimously consent to relevant decisions\b`, String.raw`\bshare unanimous control\b`], related: ['sfrsi11-unanimous-consent', 'sfrsi11-joint-operation', 'sfrsi11-joint-venture'] },
    { id: 'sfrsi11-unanimous-consent', title: 'Unanimous consent', keywords: ['unanimous consent of parties', 'decisions about relevant activities'], queryPatterns: [String.raw`\bunanimously consent to relevant decisions\b`], related: ['sfrsi11-joint-control'] },
    { id: 'sfrsi11-joint-operation', title: 'Joint operation', keywords: ['joint operation', 'joint operator', 'account for joint operation'], related: ['sfrsi11-rights-to-assets', 'sfrsi11-obligations-for-liabilities', 'sfrsi11-accounting-treatment'] },
    { id: 'sfrsi11-joint-venture', title: 'Joint venture', keywords: ['joint venture', 'joint venturer', 'account for joint venture'], related: ['sfrsi11-rights-to-net-assets', 'sfrsi11-accounting-treatment'] },
    { id: 'sfrsi11-rights-to-assets', title: 'Rights to assets', keywords: ['direct rights to assets', 'rights to individual assets joint arrangement'], queryPatterns: [String.raw`\bdirect rights to specified assets\b`], related: ['sfrsi11-joint-operation'] },
    { id: 'sfrsi11-obligations-for-liabilities', title: 'Obligations for liabilities', keywords: ['direct obligations for liabilities', 'responsible for liabilities joint arrangement'], queryPatterns: [String.raw`\bdirect obligations for specified liabilities\b`], related: ['sfrsi11-joint-operation'] },
    { id: 'sfrsi11-rights-to-net-assets', title: 'Rights to net assets', keywords: ['rights to net assets of arrangement', 'separate vehicle rights net assets'], queryPatterns: [String.raw`\brights? to (?:the )?vehicle(?:'s|’s) net assets\b`], related: ['sfrsi11-joint-venture'] },
    { id: 'sfrsi11-accounting-treatment', title: 'Accounting treatment', keywords: ['recognition of joint operation assets liabilities revenue expenses', 'equity method joint venture'], queryPatterns: [String.raw`\bjoint (?:operation|venture)\b[\s\S]{0,150}\baccount(?:ing|ed for)\b`], related: ['sfrsi11-joint-operation', 'sfrsi11-joint-venture', 'sfrsi128-equity-method'] }
  ].map(item => mappedTopic('sfrsi11', item)),

  // Explicit cross-standard routing keys for transitions and questions spanning more than one standard.
  mappedTopic('sfrsi10', { id: 'sfrsi-associate-to-subsidiary', title: 'Associate-to-subsidiary transition', keywords: ['associate becomes subsidiary during the year', 'associate converted to subsidiary', 'equity-accounted investment acquired additional interest and obtained control', 'equity-accounted; acquired', 'equity-accounted and acquired additional shares', 'additional shares obtained control', 'previously equity-accounted investment obtains control'], queryPatterns: [EQUITY_ACCOUNTED_CONTROL_ACQUISITION_PATTERN], related: ['sfrsi128-to-subsidiary', 'sfrsi3-step-acquisition', 'sfrsi10-acquisition-control-date'], standards: ['sfrsi128', 'sfrsi3', 'sfrsi10'] }),
  mappedTopic('sfrsi3', { id: 'sfrsi-step-acquisition', title: 'Step acquisition across reporting dates', keywords: ['step acquisition', 'increase an existing investment until control', 'equity-accounted holding acquired further interest to obtain control', 'equity-accounted; acquired'], related: ['sfrsi3-step-acquisition', 'sfrsi10-acquisition-control-date', 'sfrsi128-cessation-influence'], standards: ['sfrsi3', 'sfrsi10'] }),
  mappedTopic('sfrsi10', { id: 'sfrsi-loss-of-control', title: 'Loss of control on disposal', keywords: ['disposal resulting in loss of control', 'sell subsidiary and retain an interest'], related: ['sfrsi10-loss-of-control', 'sfrsi128-significant-influence'], standards: ['sfrsi10'] }),
  mappedTopic('sfrsi3', { id: 'sfrsi-goodwill-bargain-purchase', title: 'Goodwill or bargain purchase', keywords: ['goodwill or bargain purchase', 'goodwill with missing facts', 'bargain purchase in acquisition'], related: ['sfrsi3-goodwill', 'sfrsi3-bargain-purchase', 'sfrsi3-identifiable-net-assets'], standards: ['sfrsi3'] }),
  mappedTopic('sfrsi11', { id: 'sfrsi-joint-arrangement-classification', title: 'Joint operation versus joint venture', keywords: ['joint operation versus joint venture', 'classify joint arrangement', 'rights and obligations arrangement'], related: ['sfrsi11-joint-operation', 'sfrsi11-joint-venture', 'sfrsi11-joint-control'], standards: ['sfrsi11'] })
];

function topicWithIrasSourceMaps(spec: TopicSpec): SingaporeCoverageTopic {
  const sources = irasSourceMapsByTopic.get(spec.id);
  if (!sources?.length) return topic(spec);
  const primary = sources[0];
  return topic({
    ...spec,
    sourceRecordIds: [...new Set([...(spec.sourceRecordIds ?? []), ...sources.map(source => source.id)])],
    subdomain: primary.subdomain,
    shortDescription: primary.shortDescription,
    canonicalSourceId: primary.id,
    canonicalSourceUrl: primary.canonicalSourceUrl,
    pageTitle: primary.pageTitle,
    urlVerificationStatus: primary.urlVerificationStatus,
    urlVerifiedDate: primary.urlVerifiedDate,
    urlVerificationMethod: primary.urlVerificationMethod,
    urlVerificationEvidence: primary.urlVerificationEvidence
  });
}

export const SINGAPORE_COVERAGE_REGISTRY: SingaporeCoverageTopic[] = [...topicSpecs, ...consolidationTopicSpecs].map(topicWithIrasSourceMaps);

export const LEGACY_COVERAGE_PACK_MAPPINGS: Record<string, string[]> = Object.fromEntries(
  [...new Set(SINGAPORE_COVERAGE_REGISTRY.flatMap(item => item.legacyPackIds ?? []))].map(packId => [
    packId,
    SINGAPORE_COVERAGE_REGISTRY.filter(item => item.legacyPackIds?.includes(packId)).map(item => item.id)
  ])
);

export function getCoverageTopicsByPriority(priority: CoveragePriority): SingaporeCoverageTopic[] {
  return SINGAPORE_COVERAGE_REGISTRY.filter(topic => topic.priority === priority);
}

export function getCoverageTopicById(id: string): SingaporeCoverageTopic | undefined {
  return SINGAPORE_COVERAGE_REGISTRY.find(topic => topic.id === id);
}

export function getCoverageTopicsByDomain(domainId: SingaporeKnowledgeDomain): SingaporeCoverageTopic[] {
  return SINGAPORE_COVERAGE_REGISTRY.filter(topic => topic.domainId === domainId);
}

export function getCoverageTopicsByIds(ids: readonly string[]): SingaporeCoverageTopic[] {
  const wanted = new Set(ids);
  return SINGAPORE_COVERAGE_REGISTRY.filter(topic => wanted.has(topic.id));
}
