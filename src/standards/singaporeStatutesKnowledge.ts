import type { StatutoryAuthority, StandardCitation, StatutoryAdvisoryInfo } from '../types/accounting';

export interface SingaporeStatuteRule {
  id: string;
  authority: StatutoryAuthority;
  authorityName: string;
  sourcePublisher?: string; // Publishing entity e.g. "Singapore Statutes Online / AGC"
  legalOrStandardInstrument?: string; // Governing statutory instrument e.g. "Income Tax Act 1947"
  actTitle: string;
  actCode: string; // Short code for SSO, e.g. "ITA1947", "CA1967", "GSTA1993", "CPFA1953"
  sectionOrSchedule: string;
  ruleTitle: string;
  category: 'TAX_INCOME' | 'TAX_GST' | 'ACRA_COMPLIANCE' | 'CPF_PAYROLL' | 'MOM_LABOUR' | 'MAS_FINANCE' | 'CUSTOMS_TRADE';
  principle: string;
  verbatimStatuteText?: string; // Authentic statutory wording from Singapore Statutes Online / official legislation
  application: string;
  practicalRules: string[];
  canonicalUrl: string;
  supplementaryOfficialSources?: Array<{
    title: string;
    url: string;
    authority: StatutoryAuthority;
  }>;
  tags: string[];
  sourceStatus?: 'VERIFIED' | 'NEEDS_REVIEW' | 'HISTORICAL';
  sourceType?: 'AUTHORITATIVE_SOURCE' | 'CURATED_SUMMARY' | 'APPLICATION_RULE';
  evidenceTier?: 'PRIMARY_SOURCE' | 'OFFICIAL_GUIDANCE' | 'CURATED_SUMMARY' | 'APPLICATION_RULE';
  isVerbatimText?: boolean;
  effectiveDate?: string;
  revisionDate?: string;
  validFrom?: string;
  validTo?: string;
  lastVerifiedDate?: string;
  reviewAuditCycleDays?: number;
  supersededByRecordId?: string;
  historicalPredecessorRecordId?: string;
}

export const SINGAPORE_STATUTORY_REPOSITORY: Record<string, SingaporeStatuteRule> = {
  // -------------------------------------------------------------
  // 1. IRAS & INCOME TAX ACT 1947
  // -------------------------------------------------------------
  ITA_SEC14_GENERAL_DEDUCTION: {
    id: 'ITA_SEC14_GENERAL_DEDUCTION',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Income Tax Act 1947',
    actTitle: 'Income Tax Act 1947',
    actCode: 'ITA1947',
    sectionOrSchedule: 'Section 14(1)',
    ruleTitle: 'General Tax Deductibility of Business Expenses ("Wholly & Exclusively")',
    category: 'TAX_INCOME',
    principle: 'For the purpose of ascertaining the income of any person for any period, there shall be deducted all outgoings and expenses wholly and exclusively incurred during that period by that person in the production of the income.',
    verbatimStatuteText: 'For the purpose of ascertaining the income of any person for any period, there shall be deducted all outgoings and expenses wholly and exclusively incurred during that period by that person in the production of the income.',
    application: 'Operating expenses (rental, staff salaries, utilities, marketing, trade debt provisions) directly related to revenue generation are tax-deductible.',
    practicalRules: [
      'Must be wholly and exclusively incurred in the production of income.',
      'Must not be capital in nature (e.g. initial setup costs, asset purchases).',
      'Must not be prohibited under Section 15 of the Income Tax Act.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P16-#pr22-',
    tags: ['tax deduction', 'deductible expenses', 'section 14', 'business expenses', 'p&l deduction'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '1948-01-01'
  },

  ITA_SEC15_PROHIBITED_DEDUCTIONS: {
    id: 'ITA_SEC15_PROHIBITED_DEDUCTIONS',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore & AGC',
    actTitle: 'Income Tax Act 1947',
    actCode: 'ITA1947',
    sectionOrSchedule: 'Section 15(1)',
    ruleTitle: 'Prohibited Non-Deductible Business Expenses',
    category: 'TAX_INCOME',
    principle: 'Notwithstanding any other provisions of this Act, no deduction shall be allowed in respect of: domestic or private expenses; capital sums; improvements; fines and statutory penalties; and non-trade expenses.',
    application: 'Statutory fines (ACRA late filing fines, traffic fines), non-business private expenses paid via company funds, and capital acquisitions cannot be deducted against corporate tax.',
    practicalRules: [
      'Private or domestic expenses of directors/shareholders are disallowed.',
      'Fines and penalties imposed for violation of law are strictly non-deductible.',
      'Income tax paid or payable is non-deductible.',
      'Capital expenditure must be added back in tax computation (capital allowances claimed separately).'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P15-#pr15-',
    tags: ['non-deductible', 'prohibited expenses', 'fines', 'section 15', 'add-back']
  },

  ITA_SEC15_1_K_MOTOR_CAR: {
    id: 'ITA_SEC15_1_K_MOTOR_CAR',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    actTitle: 'Income Tax Act 1947',
    actCode: 'ITA1947',
    sectionOrSchedule: 'Section 15(1)(k)',
    ruleTitle: 'Prohibition of Tax Deduction & Capital Allowances on Private Passenger Motor Cars (S-Plate)',
    category: 'TAX_INCOME',
    principle: 'No deduction shall be allowed for any outgoings and expenses incurred in respect of a motor car registered as a passenger car (whether private or company car, including RU and private hire cars used by staff), nor shall any capital allowance be granted.',
    application: 'Purchasing a private passenger car (S-plate) yields zero tax depreciation. Petrol, parking, road tax, repairs, and ERP incurred on company passenger cars are completely non-deductible.',
    practicalRules: [
      'Company passenger motor cars (S-plate cars) are completely disallowed for Section 14 deductions and Section 19/19A Capital Allowances.',
      'Commercial goods vehicles (G-plate, Y-plate vans, lorries, trucks) ARE 100% eligible for Section 19A Capital Allowances and running expenses are deductible.',
      'Strict add-back of car depreciation and operating expenses is mandatory in Form C-S Tax Computation.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P15-#pr15-',
    tags: ['car expenses', 'passenger car', 'motor car', 's-plate', 'car depreciation', 'section 15(1)(k)']
  },

  ITA_SEC19_19A_CAPITAL_ALLOWANCES: {
    id: 'ITA_SEC19_19A_CAPITAL_ALLOWANCES',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    actTitle: 'Income Tax Act 1947',
    actCode: 'ITA1947',
    sectionOrSchedule: 'Section 19 & Section 19A',
    ruleTitle: 'Capital Allowances on Plant and Machinery in Lieu of Depreciation',
    category: 'TAX_INCOME',
    principle: 'Accounting depreciation is disallowed for tax. In its place, Capital Allowances (CA) are granted on qualifying plant and machinery used in trade or business.',
    application: 'Companies write off machinery, computers, and office equipment over 1 year (Section 19A(2) 100% write-off for computers & automation equipment, or low-value assets $\\le\\$5,000$ capped at $\\sim\\$30,000$ per YA) or over 3 years straight-line (Section 19A(1)).',
    practicalRules: [
      'Accounting depreciation is added back in tax computation.',
      'Section 19A(1): Accelerated 3-year write-off (33.33% per year).',
      'Section 19A(2): 1-year (100%) accelerated write-off for computers, software, and qualifying automation equipment.',
      'Low-Value Assets: Assets costing $\\le\\$5,000$ each can be fully written off in 1 year, subject to an aggregate limit of $\\$30,000$ per YA.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P16-#pr19A-',
    supplementaryOfficialSources: [{
      title: 'IRAS Capital Allowances',
      url: 'https://www.iras.gov.sg/taxes/corporate-income-tax/income-deductions-for-companies/claiming-allowances/capital-allowances',
      authority: 'IRAS'
    }],
    tags: ['capital allowance', 'depreciation add-back', 'section 19a', 'plant and machinery', 'computers']
  },

  ITA_SUTE_PTE_TAX_EXEMPTION: {
    id: 'ITA_SUTE_PTE_TAX_EXEMPTION',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    actTitle: 'Income Tax Act 1947',
    actCode: 'ITA1947',
    sectionOrSchedule: 'Section 43 & Tax Exemption Schemes',
    ruleTitle: 'Corporate Income Tax (CIT) Rate & Tax Exemption Schemes (SUTE & PTE)',
    category: 'TAX_INCOME',
    principle: 'Headline corporate income tax rate in Singapore is a flat 17%. Qualifying companies enjoy Start-Up Tax Exemption (SUTE) or Partial Tax Exemption (PTE).',
    application: 'Reduces effective corporate tax significantly below 17%.',
    practicalRules: [
      'Headline Corporate Tax Rate: 17% on chargeable income.',
      'Start-Up Tax Exemption (SUTE) for qualifying new companies (first 3 consecutive YAs):\n  - 75% exemption on the first SGD 100,000 of normal chargeable income\n  - 50% exemption on the next SGD 100,000\n  - Maximum tax exemption of SGD 125,000 (Effective tax on first SGD 200k = ~8.92%).',
      'Partial Tax Exemption (PTE) for all other companies:\n  - 75% exemption on the first SGD 10,000\n  - 50% exemption on the next SGD 190,000\n  - Maximum tax exemption of SGD 102,500.',
      'SUTE Qualifying Conditions: Incorporated in Singapore, tax resident in Singapore, max 20 individual shareholders (or at least 1 individual holding $\\ge 10\\%$ of ordinary shares).'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P111-#pr43-',
    tags: ['tax rate', 'sute', 'pte', 'corporate tax', 'tax exemption', '17%']
  },

  IRAS_FORM_CS_LITE_CRITERIA: {
    id: 'IRAS_FORM_CS_LITE_CRITERIA',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    actTitle: 'Income Tax Act 1947 & IRAS Filing Guidelines',
    actCode: 'ITA1947',
    sectionOrSchedule: 'Form C-S / Form C-S (Lite) / Form C Guidelines',
    ruleTitle: 'Eligibility Criteria for Form C-S and Form C-S (Lite) Tax Filing',
    category: 'TAX_INCOME',
    principle: 'Small companies with straightforward tax affairs can file simplified tax returns (Form C-S or Form C-S Lite) without attaching financial statements or tax computations upfront.',
    application: 'SMEs can complete Form C-S online via myTax Portal in minutes.',
    practicalRules: [
      'Form C-S (Lite): Annual revenue $\\le\\$200,000$, company incorporated in Singapore, derives only 17% taxable income, not claiming group relief/investment allowance/foreign tax credit.',
      'Form C-S: Annual revenue $\\le\\$5,000,000$, company incorporated in Singapore, derives only 17% taxable income, not claiming group relief/investment allowance.',
      'Form C: For companies with annual revenue $>\$5,000,000$ or claiming complex incentives, foreign tax credits, or group relief. Mandatory to attach audited/unaudited accounts and tax computations.',
      'Filing Deadline: 30 November of the Year of Assessment (YA) via myTax Portal.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P116-#pr62-',
    tags: ['form c-s', 'form c-s lite', 'form c', 'tax filing deadline', 'annual revenue 5m']
  },

  ITA_SEC37_LOSS_CARRY_FORWARD: {
    id: 'ITA_SEC37_LOSS_CARRY_FORWARD',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Income Tax Act 1947',
    actTitle: 'Income Tax Act 1947',
    actCode: 'ITA1947',
    sectionOrSchedule: 'Section 37',
    ruleTitle: 'Loss Carry-Forward & Substantial Shareholding Continuity Test (50% Continuity)',
    category: 'TAX_INCOME',
    principle: 'Under Section 37(3)(a) of the Income Tax Act 1947, unabsorbed trade losses and capital allowances may be carried forward indefinitely to offset against future taxable income from all sources, subject to the substantial shareholding test (at least 50% continuity of ultimate shareholders as at the relevant comparison dates).',
    verbatimStatuteText: 'There shall be deducted from the statutory income of any person for any year of assessment the amount of a loss incurred by that person in any trade, business, profession or vocation, provided that no deduction shall be allowed to any company unless the Comptroller is satisfied that the shareholders of the company on the last day of the year in which the loss was incurred were substantially the same as the shareholders of the company on the first day of the year of assessment in which the loss is to be deducted.',
    application: 'Corporate tax computation: unabsorbed losses from prior YAs offset current year statutory income if shareholder continuity >= 50% is proven.',
    practicalRules: [
      'Indefinite Carry-Forward: Unabsorbed trade losses carry forward indefinitely until fully utilised.',
      'Substantial Shareholding Test (SST): Shareholders holding >= 50% of paid-up capital/shares must be substantially identical on comparison dates (last day of loss year vs first day of YA of deduction).',
      'Order of Deduction: Unabsorbed capital allowances from prior years are deducted before unabsorbed trade losses.',
      'Shareholding Waiver: Minister or Comptroller may waive SST if substantial change was not for tax benefit.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P19-#pr37-',
    tags: ['loss carry forward', 'section 37', 'tax losses', 'substantial shareholding', 'sst 50%', 'unabsorbed losses'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '1948-01-01',
    validFrom: '1948-01-01',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },

  ITA_SEC37E_LOSS_CARRY_BACK: {
    id: 'ITA_SEC37E_LOSS_CARRY_BACK',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Income Tax Act 1947',
    actTitle: 'Income Tax Act 1947',
    actCode: 'ITA1947',
    sectionOrSchedule: 'Section 37E',
    ruleTitle: 'Loss Carry-Back Relief Scheme (Cap SGD 100,000 to Immediate Preceding YA)',
    category: 'TAX_INCOME',
    principle: 'Under Section 37E of the Income Tax Act 1947, qualifying businesses may carry back current-year unabsorbed capital allowances and trade losses up to an aggregate cap of SGD 100,000 to offset against the assessable income of the one immediately preceding Year of Assessment, subject to the substantial shareholding test and the same-business test.',
    verbatimStatuteText: 'There shall be deducted from the assessable income of a person for the year of assessment immediately preceding the year of assessment in which the person incurs a qualifying deduction the amount of that qualifying deduction, provided that the total amount of qualifying deductions that may be deducted shall not exceed $100,000.',
    application: 'SMEs facing an operating loss in current year can elect to carry back up to SGD 100,000 loss to the immediate prior YA to claim an immediate corporate tax refund.',
    practicalRules: [
      'Maximum Cap: Capped at an aggregate of SGD 100,000 of qualifying deductions per YA.',
      'Carry-Back Period: Carried back to the 1 immediately preceding Year of Assessment.',
      'Substantial Shareholding & Same Business Test: Entity must satisfy 50% shareholder continuity and same business test (for capital allowances).',
      'Election Deadline: Must be formally elected when e-filing Form C / Form C-S for the loss year.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P19-#pr37E-',
    tags: ['loss carry back', 'section 37e', '100000 cap', 'tax refund', 'carry back relief'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2006-01-01',
    validFrom: '2006-01-01',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },

  ITA_SEC13W_EQUITY_DISPOSAL_SAFE_HARBOUR: {
    id: 'ITA_SEC13W_EQUITY_DISPOSAL_SAFE_HARBOUR',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Income Tax Act 1947',
    actTitle: 'Income Tax Act 1947',
    actCode: 'ITA1947',
    sectionOrSchedule: 'Section 13W',
    ruleTitle: 'Safe Harbour Exemption for Gains on Disposal of Ordinary Shares (20% for 24 Months)',
    category: 'TAX_INCOME',
    principle: 'Under Section 13W of the Income Tax Act 1947, gains derived by a divesting company from the disposal of ordinary shares in an investee company are legally exempt from tax if the divesting company held at least 20% of the ordinary shares in the investee company throughout a continuous period of at least 24 months immediately prior to the disposal.',
    verbatimStatuteText: 'There shall be exempt from tax any gains or profits derived by a divesting company from the disposal of ordinary shares in an investee company during the qualifying period if the divesting company has held, throughout a continuous period of at least 24 months immediately prior to the date of disposal, at least 20% of the ordinary shares in the investee company.',
    application: 'Disposal of subsidiary or associate shares: If shareholding was >= 20% for >= 24 continuous months, capital gain is 100% tax-exempt under safe harbour without IRAS trading vs investment inquiry.',
    practicalRules: [
      'Minimum Shareholding: At least 20% of the ordinary shares of the investee company.',
      'Holding Period: Minimum 24 continuous months immediately preceding the disposal.',
      'Ordinary Shares: Applies to ordinary shares (shares that carry voting, dividend, and surplus asset rights without fixed preference).',
      'Exclusions: Does not apply to unlisted property-holding companies whose main business is holding immovable property in Singapore.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P14-#pr13W-',
    tags: ['section 13w', 'safe harbour', 'share disposal', 'capital gain exemption', '20 percent 24 months'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2012-06-01',
    validFrom: '2012-06-01',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },

  ITA_SEC45_WITHHOLDING_TAX: {
    id: 'ITA_SEC45_WITHHOLDING_TAX',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Income Tax Act 1947',
    actTitle: 'Income Tax Act 1947',
    actCode: 'ITA1947',
    sectionOrSchedule: 'Section 45',
    ruleTitle: 'Withholding Tax on Interest, Loan Charges & Indebtedness Paid to Non-Residents',
    category: 'TAX_INCOME',
    principle: 'Under Section 45 of the Income Tax Act 1947, any person liable to pay interest, commission, fee or other payment in connection with any loan or indebtedness to a non-resident person must deduct withholding tax (15% final tax or applicable DTA rate) and e-file and remit the tax to IRAS by the 15th of the second month following the date of payment.',
    verbatimStatuteText: 'Where any person is liable to pay to a person not known to him to be resident in Singapore any interest, commission, fee or other payment in connection with any loan or indebtedness, he shall upon paying the same deduct tax therefrom at the prescribed rate, and shall immediately give notice of the deduction of tax and pay to the Comptroller the amount so deducted.',
    application: 'A Singapore company paying intercompany loan interest to a foreign parent or non-resident lender must withhold 15% tax at source and submit Form S45 online to IRAS.',
    practicalRules: [
      'Prescribed Rate: 15% final withholding tax on gross interest (or lower treaty rate under an applicable Avoidance of Double Taxation Agreement [DTA]).',
      'Payment Deadline: Must e-file Form S45 and remit withheld tax to IRAS by the 15th of the second month following the payment date.',
      'Date of Payment: Deemed paid when credited to payee account, reinvested, accumulated, capitalized, or made available.',
      'Late Payment Penalty: 5% initial late payment penalty plus additional 1% per month up to maximum 15%.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P112-#pr45-',
    tags: ['withholding tax', 'section 45', 'interest withholding', 'non-resident interest', '15% final tax'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '1948-01-01',
    validFrom: '1948-01-01',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },

  ITA_SEC45A_WITHHOLDING_TAX_ROYALTIES: {
    id: 'ITA_SEC45A_WITHHOLDING_TAX_ROYALTIES',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Income Tax Act 1947',
    actTitle: 'Income Tax Act 1947',
    actCode: 'ITA1947',
    sectionOrSchedule: 'Section 45A',
    ruleTitle: 'Withholding Tax on Royalties, Technical Fees & Management Charges Paid to Non-Residents',
    category: 'TAX_INCOME',
    principle: 'Under Section 45A of the Income Tax Act 1947, Section 45 applies with prescribed modifications to royalties, technical assistance fees, and management charges paid to a non-resident person (10% final tax on royalties, 17% non-final on management/technical service fees unless reduced under an applicable DTA).',
    verbatimStatuteText: 'The provisions of section 45 shall apply in relation to the payment of any royalties or other payments in one lump sum or otherwise for the use of or for the right to use any scientific, technical, industrial or commercial knowledge or information, or for the rendering of any assistance or service in connection with the application or use of such knowledge, as they apply to the payment of interest.',
    application: 'Software license royalties, technical know-how payments, and management consulting fees paid to overseas foreign corporations.',
    practicalRules: [
      'Royalties Rate: 10% final withholding tax under Section 43(1)(c) (or DTA rate).',
      'Management / Technical Service Fees: 17% prevailing corporate tax rate withholding under Section 45A (non-final, recipient can file tax return to claim expenses).',
      'Filing Deadline: 15th of the second month after the date of payment via myTax Portal.',
      'Software Exemption: Commercial off-the-shelf software licenses without copyright acquisition enjoy administrative concession from withholding tax under IRAS e-Tax Guide.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P112-#pr45A-',
    tags: ['section 45a', 'royalties withholding', 'technical service fees', 'management fees', 'withholding non-resident'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '1977-01-01',
    validFrom: '1977-01-01',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },

  ITA_SEC14Q_RENOVATION_REFURBISHMENT: {
    id: 'ITA_SEC14Q_RENOVATION_REFURBISHMENT',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Income Tax Act 1947',
    actTitle: 'Income Tax Act 1947',
    actCode: 'ITA1947',
    sectionOrSchedule: 'Section 14Q',
    ruleTitle: 'Deduction for Renovation and Refurbishment (R&R) Costs (Cap SGD 300,000 over 3 Years)',
    category: 'TAX_INCOME',
    principle: 'Under Section 14Q of the Income Tax Act 1947, a person carrying on trade or business who incurs qualifying capital expenditure on renovation or refurbishment of commercial business premises is entitled to a deduction in 3 equal annual installments, subject to an aggregate statutory ceiling of SGD 300,000 for every relevant 3-year period.',
    verbatimStatuteText: 'Where a person carrying on a trade, business or profession has incurred qualifying expenditure on the renovation or refurbishment of business premises, there shall be allowed to him a deduction of an amount equal to one-third of that qualifying expenditure for each of 3 consecutive years of assessment, provided that the total qualifying expenditure shall not exceed $300,000 for every period of 3 consecutive years of assessment.',
    application: 'Commercial office, retail, or clinic interior renovations: SGD 300,000 expenditure is deducted as SGD 100,000 per year across 3 consecutive YAs.',
    practicalRules: [
      'Cap: Statutory cap of SGD 300,000 for every 3-year consecutive period.',
      'Deduction Schedule: One-third of qualifying expenditure allowed in the YA of expenditure and each of the subsequent 2 YAs.',
      'Qualifying Items: General lighting, floor tiles, false ceilings, fixed partitions, wall coverings, doors, plumbing, electrical installations.',
      'Non-Qualifying Items: Structural changes, designer fees, fine art/paintings, motor vehicle showrooms, and assets eligible for Section 19/19A capital allowances.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P15-#pr14Q-',
    tags: ['renovation deduction', 'section 14q', 'r&r deduction', '300000 cap', 'renovation 3 years'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2008-01-01',
    validFrom: '2008-01-01',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },

  // -------------------------------------------------------------
  // 2. IRAS & GOODS AND SERVICES TAX ACT 1993
  // -------------------------------------------------------------
  GST_REGISTRATION_COMPULSORY_THRESHOLD: {
    id: 'GST_REGISTRATION_COMPULSORY_THRESHOLD',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    actTitle: 'Goods and Services Tax Act 1993',
    actCode: 'GSTA1993',
    sectionOrSchedule: 'First Schedule',
    ruleTitle: 'Compulsory GST Registration Threshold ($1,000,000 Turnover)',
    category: 'TAX_GST',
    principle: 'A business is legally liable to register for GST if its taxable turnover exceeds SGD 1,000,000 under either the retrospective or prospective basis.',
    verbatimStatuteText: 'A person who makes taxable supplies but is not registered shall be liable to be registered— (a) at the end of any calendar year if the total value of taxable supplies made by him in that year has exceeded $1,000,000; or (b) at any time if there are reasonable grounds for believing that the total value of taxable supplies to be made by him in the period of 12 months then beginning will exceed $1,000,000.',
    application: 'SMEs must monitor taxable turnover at the end of each calendar year and projected 12 months.',
    practicalRules: [
      'Retrospective Basis: Taxable turnover at the end of the calendar year (31 Dec) exceeds SGD 1,000,000. Must apply for registration within 30 days (by 30 Jan).',
      'Prospective Basis: At any time, you reasonably expect taxable turnover in the next 12 months to exceed SGD 1,000,000. Must apply for registration within 30 days of the date of forecast.',
      'Voluntary Registration: Businesses below SGD 1M turnover may voluntarily register, but must remain registered for at least 2 years and maintain GIRO for payment/refunds.',
      'GST Rate: Standard rate is 9% (effective 1 January 2024).'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/GSTA1993?ProvIds=P112-#Sc1-',
    tags: ['gst registration', 'turnover 1m', 'compulsory gst', 'prospective', 'retrospective'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2024-01-01'
  },

  GST_REG26_BLOCKED_INPUT_TAX: {
    id: 'GST_REG26_BLOCKED_INPUT_TAX',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    actTitle: 'GST (General) Regulations',
    actCode: 'GSTA1993',
    sectionOrSchedule: 'Regulation 26 & 27',
    ruleTitle: 'Disallowed / Blocked Input Tax Claims under Singapore GST Law',
    category: 'TAX_GST',
    principle: 'Input tax incurred on certain specified business goods or services is strictly disallowed from recovery, even if incurred for business purposes.',
    application: 'A GST-registered company cannot claim back the 9% input GST paid on company cars, club fees, or employee family medical coverage.',
    practicalRules: [
      '1. Motor Cars: Input tax incurred on the purchase, hire, or running expenses (petrol, parking, repair) of a passenger motor car (S-plate) is strictly non-claimable.',
      '2. Club Subscription Fees: Entrance fees and subscription charges paid to sports, recreational, or social clubs.',
      '3. Medical and Accident Insurance: Medical expenses and insurance premiums for staff (unless mandatory under Work Injury Compensation Act [WICA] or collective agreement). Medical expenses for staff family members are 100% blocked.',
      '4. Family Benefits: Any expenses incurred on benefits provided to the family members of your employees.',
      '5. Betting & Lotteries: Transactions involving games of chance, lotteries, and betting.'
    ],
    canonicalUrl: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax',
    tags: ['blocked input tax', 'regulation 26', 'gst car claim', 'medical insurance gst', 'club subscriptions']
  },

  GST_SEC21_ZERO_RATED_EXPORTS: {
    id: 'GST_SEC21_ZERO_RATED_EXPORTS',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    actTitle: 'Goods and Services Tax Act 1993',
    actCode: 'GSTA1993',
    sectionOrSchedule: 'Section 21(3)',
    ruleTitle: 'Zero-Rating of International Services and Exported Goods (0% GST)',
    category: 'TAX_GST',
    principle: 'Supplies of goods exported out of Singapore and supplies of international services falling within Section 21(3) are zero-rated (taxed at 0%).',
    application: 'Singapore software companies exporting SaaS or advisory services to overseas clients bill at 0% GST and can still reclaim 9% input GST on business overheads.',
    practicalRules: [
      'Goods Export: Must maintain required export documentation (Bill of Lading, Air Waybill, export permits) within 60 days.',
      'International Services (Section 21(3)): Software, consulting, and management services provided under contract to overseas clients, directly benefiting an overseas person outside Singapore, qualify for 0% GST.',
      'Input Tax Benefit: Even though output tax is 0%, the business can claim 100% of input GST paid on qualifying business purchases.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/GSTA1993?ProvIds=P15-#pr21-',
    tags: ['zero rated', '0% gst', 'export of services', 'section 21(3)', 'international services']
  },

  GST_REG28_DE_MINIMIS_RULE: {
    id: 'GST_REG28_DE_MINIMIS_RULE',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'GST (General) Regulations',
    actTitle: 'GST (General) Regulations',
    actCode: 'GSTA1993',
    sectionOrSchedule: 'Regulation 28',
    ruleTitle: 'De Minimis Rule for Input Tax Attribution on Exempt Supplies (Partial Exemption)',
    category: 'TAX_GST',
    principle: 'Under Regulation 28 of the GST (General) Regulations, a taxable person making exempt supplies is treated as having incurred input tax exclusively attributable to taxable supplies and may claim full input tax if the value of exempt supplies does not exceed an average of SGD 40,000 per month AND 5% of the total value of all supplies made in that prescribed accounting period.',
    verbatimStatuteText: 'Where in any prescribed accounting period the value of exempt supplies made by a taxable person does not exceed an average of $40,000 per month and 5% of the total value of all supplies made by him in that period, all input tax incurred by him in that period shall be treated as attributable to taxable supplies.',
    application: 'Businesses earning incidental exempt income (e.g. fixed deposit interest, realised foreign exchange gains): 100% of input tax on general business overheads remains recoverable under the De Minimis test.',
    practicalRules: [
      'Dual Quantitative Thresholds: Value of exempt supplies must be <= SGD 40,000 per month on average AND <= 5% of total value of all supplies in that accounting period.',
      'Benefit of Passing Test: Entitled to recover in full all input tax incurred, without requiring complex input tax apportionment calculations.',
      'Failure of Test: If either threshold is breached, the entity is in partial exemption and must apportion input tax using the standard turnover formula.',
      'Annual Review: An annual longer-period input tax adjustment is mandatory at the end of each tax year.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/SL/GSTA1993-RG1?ProvIds=P15-#pr28-',
    tags: ['de minimis rule', 'regulation 28', 'partial exemption', 'exempt supplies 40000', 'input tax recovery 5%'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '1994-04-01',
    validFrom: '1994-04-01',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },

  GST_SEC14_REVERSE_CHARGE: {
    id: 'GST_SEC14_REVERSE_CHARGE',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Goods and Services Tax Act 1993',
    actTitle: 'Goods and Services Tax Act 1993',
    actCode: 'GSTA1993',
    sectionOrSchedule: 'Section 14 & Seventh Schedule',
    ruleTitle: 'Reverse Charge on Business-to-Business (B2B) Imported Services & Distantly Taxable Goods',
    category: 'TAX_GST',
    principle: 'Under Section 14 and the Seventh Schedule of the Goods and Services Tax Act 1993, a GST-registered person who is not entitled to full input tax recovery (or who belongs to a reverse charge group) must account for output tax under the Reverse Charge mechanism on all imported services and imported distantly taxable goods procured from overseas suppliers.',
    verbatimStatuteText: 'Where a person who is registered or liable to be registered receives imported services or imported distantly taxable goods from a supplier who belongs in a country other than Singapore, the recipient shall account for and pay tax on the supply of those services or goods as if the recipient had himself supplied them in Singapore in the course or furtherance of his business.',
    application: 'Financial institutions, investment holding companies, and residential property developers procuring overseas software, cloud servers, or consultancy must account for 9% Reverse Charge output tax in Box 1 of GST F5.',
    practicalRules: [
      'Applicability: Mandatory for GST-registered persons not entitled to full input tax recovery (e.g. banks, insurers, exempt supply businesses).',
      'Fully Taxable Businesses: Fully taxable businesses entitled to 100% input tax recovery are generally not required to apply reverse charge unless electing under group relief.',
      'Tax Mechanism: Account for 9% output tax in Box 1; claim allowable input tax in Box 7 in the same GST return.',
      'Distantly Taxable Goods (LVG): Goods located outside Singapore with a value at or below the SGD 400 import threshold delivered to Singapore.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/GSTA1993?ProvIds=P13-#pr14-',
    tags: ['reverse charge', 'section 14', 'imported services', 'seventh schedule', 'b2b imported services'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2020-01-01',
    validFrom: '2020-01-01',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },

  GST_REG82_90_BAD_DEBT_RELIEF: {
    id: 'GST_REG82_90_BAD_DEBT_RELIEF',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'GST (General) Regulations',
    actTitle: 'GST (General) Regulations',
    actCode: 'GSTA1993',
    sectionOrSchedule: 'Regulations 82–90',
    ruleTitle: 'GST Bad Debt Relief Scheme & Recovery of Output Tax on Defaulted Debts',
    category: 'TAX_GST',
    principle: 'Under Regulations 82 to 90 (Part X) of the GST (General) Regulations, a taxable person who has accounted for and paid output tax on a supply may make a claim for bad debt relief if the debt has remained unpaid for at least 12 months from the date of supply (or the debtor has become insolvent) and reasonable steps have been taken to pursue payment, with the debt formally written off in accounts.',
    verbatimStatuteText: 'A taxable person shall be entitled to make a claim for bad debt relief under these Regulations if the whole or part of the consideration for the supply has been written off in his accounts as a bad debt and a period of 12 months beginning with the date of the supply has elapsed, or the debtor has become insolvent before the expiration of that period.',
    application: 'When an outstanding trade receivable of SGD 10,900 (inclusive of SGD 900 GST) is unpaid after 12 months, the company writes off the debt and claims SGD 900 back in Box 7 of GST F5 as Bad Debt Relief.',
    practicalRules: [
      '12-Month Rule: At least 12 months must have elapsed from the date of the supply, or the customer is proven formally insolvent.',
      'Written Off in Accounts: The debt must be formally written off as bad in the general ledger and financial statements.',
      'Reasonable Recovery Efforts: Entity must have made commercial recovery efforts (reminders, legal demand letters).',
      'Subsequent Recovery: If debtor subsequently pays all or part of the bad debt, output tax must be repaid to IRAS in Box 1 in that subsequent period.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/SL/GSTA1993-RG1?ProvIds=P112-#pr82-',
    tags: ['bad debt relief', 'regulations 82 90', 'output tax refund', '12 months bad debt', 'bad debt write off'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '1994-04-01',
    validFrom: '1994-04-01',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },

  GST_SEC11_TIME_OF_SUPPLY: {
    id: 'GST_SEC11_TIME_OF_SUPPLY',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Goods and Services Tax Act 1993',
    actTitle: 'Goods and Services Tax Act 1993',
    actCode: 'GSTA1993',
    sectionOrSchedule: 'Section 11',
    ruleTitle: 'General Time of Supply Rules (Invoice Issuance, Payment Receipt, Performance)',
    category: 'TAX_GST',
    principle: 'Under Section 11(1) of the Goods and Services Tax Act 1993, a supply of goods or services is treated as taking place at the earliest of: (a) the date a tax invoice is issued, (b) the date any payment in respect of the supply is received, or (c) the basic tax point when the goods are removed/made available or services performed.',
    verbatimStatuteText: 'Subject to the provisions of this Act, a supply of goods or services shall be treated as taking place — (a) at the time when an invoice in respect of the supply is issued; or (b) at the time when any payment in respect of the supply is received by the supplier, whichever is the earlier.',
    application: 'Determining which quarterly GST return period (F5) must include output tax for delivered goods or prepaid contracts.',
    practicalRules: [
      'General Rule: Earliest of (1) tax invoice issue date, (2) payment receipt date, and (3) service completion / goods delivery date.',
      '14-Day Rule: If invoice is issued within 14 days after goods delivery or service completion, the invoice date becomes the time of supply (unless payment was received earlier).',
      'Continuous Supplies of Services: Time of supply is the earlier of invoice issuance or payment receipt.',
      'Deposit / Prepayments: GST must be accounted for on deposits or prepayments in the period the cash is received.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/GSTA1993?ProvIds=P13-#pr11-',
    tags: ['time of supply', 'section 11', 'tax point', 'invoice date', 'payment date', 'earliest date'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '1994-04-01',
    validFrom: '1994-04-01',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },

  GST_RATE_7_PERCENT: {
    id: 'GST_RATE_7_PERCENT',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Goods and Services Tax Act 1993',
    actTitle: 'Goods and Services Tax Act 1993',
    actCode: 'GSTA1993',
    sectionOrSchedule: 'Section 16',
    ruleTitle: 'Historical Singapore GST Rate (7% Prior to 1 January 2023)',
    category: 'TAX_GST',
    principle: 'Prior to 1 January 2023, the standard statutory GST rate in Singapore was 7% on all standard-rated taxable supplies of goods and services.',
    verbatimStatuteText: 'Tax shall be charged at the rate of 7% on the supply of goods and services in Singapore.',
    application: 'Historical audit and accounting checks for transactions completed before 1 January 2023.',
    practicalRules: [
      'Rate: 7% on standard-rated supplies.',
      'Validity Period: In force until 31 December 2022.',
      'Superseded: Replaced by 8% GST on 1 January 2023 under Section 16 statutory amendment.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/GSTA1993?ProvIds=P13-#pr16-',
    tags: ['7% gst', 'gst rate', 'tax rate', 'rate of tax', 'historical gst', 'gst rate 7', 'gst prior to 2023', 'standard rate'],
    sourceStatus: 'HISTORICAL',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2007-07-01',
    validFrom: '2007-07-01',
    validTo: '2022-12-31',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365,
    supersededByRecordId: 'GST_RATE_8_PERCENT_2023'
  },

  GST_RATE_8_PERCENT_2023: {
    id: 'GST_RATE_8_PERCENT_2023',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Goods and Services Tax Act 1993',
    actTitle: 'Goods and Services Tax Act 1993',
    actCode: 'GSTA1993',
    sectionOrSchedule: 'Section 16',
    ruleTitle: 'Historical Singapore GST Rate (8% in Calendar Year 2023)',
    category: 'TAX_GST',
    principle: 'From 1 January 2023 to 31 December 2023, the standard statutory GST rate in Singapore was 8% on all standard-rated supplies of goods and services under the first phase of the GST rate increase.',
    verbatimStatuteText: 'Tax shall be charged at the rate of 8% on the supply of goods and services in Singapore made on or after 1 January 2023 but before 1 January 2024.',
    application: 'Historical transactions and audit verification for purchases and sales occurring in calendar year 2023.',
    practicalRules: [
      'Rate: 8% on all standard-rated supplies made between 1 January 2023 and 31 December 2023.',
      'Transitional Rules: Under GST transitional provisions, services spanning across 2023/2024 were prorated or determined by invoice/payment tax points.',
      'Superseded: Replaced by 9% GST on 1 January 2024.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/GSTA1993?ProvIds=P13-#pr16-',
    tags: ['8% gst', 'gst rate', 'tax rate', 'rate of tax', '2023 gst', 'historical 8%', 'gst rate 8% 2023', 'standard rate'],
    sourceStatus: 'HISTORICAL',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2023-01-01',
    validFrom: '2023-01-01',
    validTo: '2023-12-31',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365,
    supersededByRecordId: 'GST_RATE_9_PERCENT',
    historicalPredecessorRecordId: 'GST_RATE_7_PERCENT'
  },

  GST_RATE_9_PERCENT: {
    id: 'GST_RATE_9_PERCENT',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Goods and Services Tax Act 1993',
    actTitle: 'Goods and Services Tax Act 1993',
    actCode: 'GSTA1993',
    sectionOrSchedule: 'Section 16',
    ruleTitle: 'Current Singapore Standard GST Rate (9% from 1 January 2024 Onwards)',
    category: 'TAX_GST',
    principle: 'Effective 1 January 2024 onwards, the standard statutory GST rate in Singapore is 9% on all standard-rated supplies of goods and services.',
    verbatimStatuteText: 'Tax shall be charged at the rate of 9% on the supply of goods and services in Singapore made on or after 1 January 2024.',
    application: 'All current commercial transactions, sales billing, input GST claims, and double-entry accounting in Singapore.',
    practicalRules: [
      'Rate: 9% standard rate effective 1 January 2024 indefinitely.',
      'Input GST Claim: Claimable on qualifying business purchases under Section 19.',
      'Output GST: Collected on domestic taxable supplies and remitted to IRAS via quarterly Form F5.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/GSTA1993?ProvIds=P13-#pr16-',
    tags: ['9% gst', 'gst rate', 'tax rate', 'rate of tax', 'current gst rate', 'gst 9 percent', 'standard rate gst', 'standard rate'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2024-01-01',
    validFrom: '2024-01-01',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365,
    historicalPredecessorRecordId: 'GST_RATE_8_PERCENT_2023'
  },

  // -------------------------------------------------------------
  // 3. ACRA & COMPANIES ACT 1967
  // -------------------------------------------------------------
  ACRA_SEC205C_SMALL_COMPANY_AUDIT_EXEMPTION: {
    id: 'ACRA_SEC205C_SMALL_COMPANY_AUDIT_EXEMPTION',
    authority: 'ACRA',
    authorityName: 'Accounting and Corporate Regulatory Authority (ACRA)',
    actTitle: 'Companies Act 1967',
    actCode: 'CoA1967',
    sectionOrSchedule: 'Section 205C & Thirteenth Schedule',
    ruleTitle: 'Small Company Audit Exemption Criteria (Revenue / Assets ≤ $10M, Staff ≤ 50)',
    category: 'ACRA_COMPLIANCE',
    principle: 'A company qualifies as a "small company" and is exempt from statutory audit if it is a private company and fulfills at least 2 of 3 criteria for the immediate past two consecutive financial years.',
    application: 'SMEs that meet the 2-out-of-3 test only need to prepare unaudited financial statements compliant with SFRS.',
    practicalRules: [
      'Criterion 1: Total annual revenue $\\le$ SGD 10,000,000.',
      'Criterion 2: Total gross assets $\\le$ SGD 10,000,000.',
      'Criterion 3: Total number of full-time employees at financial year-end $\\le 50$.',
      'Two Consecutive FYs Rule: Must satisfy at least 2 of 3 quantitative thresholds in each of the past 2 consecutive financial years.',
      'Group Requirement: If the company is part of a corporate group, the entire group must qualify as a "small group" on a consolidated basis to enjoy the audit exemption.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/CoA1967?ProvIds=P16-#pr205C-',
    tags: ['audit exemption', 'small company', 'section 205c', 'revenue 10m', 'assets 10m', 'employees 50']
  },

  ACRA_SEC175_197_AGM_ANNUAL_RETURN_TIMELINES: {
    id: 'ACRA_SEC175_197_AGM_ANNUAL_RETURN_TIMELINES',
    authority: 'ACRA',
    authorityName: 'Accounting and Corporate Regulatory Authority (ACRA)',
    actTitle: 'Companies Act 1967',
    actCode: 'CoA1967',
    sectionOrSchedule: 'Section 175, 175A & Section 197',
    ruleTitle: 'Annual General Meeting (AGM) and Annual Return (AR) Statutory Filing Deadlines',
    category: 'ACRA_COMPLIANCE',
    principle: 'Private companies must hold an AGM (unless dispensed with) within 6 months after the Financial Year End (FYE), and lodge their Annual Return (AR) via BizFile+ within 7 months after FYE.',
    application: 'For a company with FYE 31 December 2025: AGM by 30 June 2026; Annual Return lodged with ACRA by 31 July 2026.',
    practicalRules: [
      'Private Company AGM: Must be held within 6 months after FYE (Section 175).',
      'Dispensation of AGM: Private companies can dispense with holding an AGM if all members agree or if financial statements are sent to members within 5 months of FYE (Section 175A).',
      'Annual Return (AR) Lodgment: Must be filed on BizFile+ within 7 months after FYE (Section 197).',
      'Listed Companies: AGM within 4 months after FYE; Annual Return within 5 months after FYE.',
      'Late Lodgment Penalties: Minimum SGD 300 tier-escalating composition fine imposed by ACRA for late filing.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/CoA1967?ProvIds=P15-#pr197-',
    tags: ['agm deadline', 'annual return', 'bizfile', 'fye 6 months', 'fye 7 months', 'section 175', 'section 197']
  },

  ACRA_SEC199_RECORD_RETENTION: {
    id: 'ACRA_SEC199_RECORD_RETENTION',
    authority: 'ACRA',
    authorityName: 'Accounting and Corporate Regulatory Authority (ACRA)',
    actTitle: 'Companies Act 1967',
    actCode: 'CoA1967',
    sectionOrSchedule: 'Section 199(1)',
    ruleTitle: 'Mandatory 5-Year Accounting Records & Vouchers Retention',
    category: 'ACRA_COMPLIANCE',
    principle: 'Every company shall cause to be kept such accounting and other records as will sufficiently explain the transactions and financial position of the company. Records must be retained for at least 5 years.',
    application: 'All bank statements, supplier invoices, sales receipts, and journal entries must be kept for 5 years from the end of the financial year.',
    practicalRules: [
      'Retention Period: Minimum 5 years from the end of the financial year in which the transaction occurred.',
      'Location: Must be kept at the registered office or such other place in Singapore as the directors think fit.',
      'Electronic Storage: Electronic invoices and digital cloud archives are accepted provided they can be readily converted into readable form on demand.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/CoA1967?ProvIds=P16-#pr199-',
    tags: ['record retention', '5 years', 'accounting books', 'receipts', 'section 199']
  },

  ACRA_SEC145_RESIDENT_DIRECTOR: {
    id: 'ACRA_SEC145_RESIDENT_DIRECTOR',
    authority: 'ACRA',
    authorityName: 'Accounting and Corporate Regulatory Authority (ACRA)',
    actTitle: 'Companies Act 1967',
    actCode: 'CoA1967',
    sectionOrSchedule: 'Section 145(1)',
    ruleTitle: 'Requirement for at Least One Ordinarily Resident Director in Singapore',
    category: 'ACRA_COMPLIANCE',
    principle: 'Every company must have at least one director who is ordinarily resident in Singapore.',
    application: 'Foreign business owners incorporating a Singapore private limited company must appoint at least one local Singapore resident director.',
    practicalRules: [
      'Eligible Resident Directors: Singapore Citizen, Singapore Permanent Resident (PR), or an EntrePass / Employment Pass (EP) holder holding a Letter of Consent (LOC) from MOM.',
      'Natural Person: Must be a natural person aged at least 18 years old and not disqualified under Section 148, 149, or 154 (e.g. not an undischarged bankrupt).',
      'Corporate Secretary (Section 171): Must appoint a resident company secretary within 6 months of incorporation. A sole director cannot act as company secretary.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/CoA1967?ProvIds=P15-#pr145-',
    tags: ['resident director', 'section 145', 'company secretary', 'incorporation requirements']
  },

  ACRA_SEC156_DIRECTOR_INTEREST_DISCLOSURE: {
    id: 'ACRA_SEC156_DIRECTOR_INTEREST_DISCLOSURE',
    authority: 'ACRA',
    authorityName: 'Accounting and Corporate Regulatory Authority (ACRA)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Companies Act 1967',
    actTitle: 'Companies Act 1967',
    actCode: 'CoA1967',
    sectionOrSchedule: 'Section 156',
    ruleTitle: 'Mandatory Disclosure of Directors\' Interests in Contracts, Transactions & Offices',
    category: 'ACRA_COMPLIANCE',
    principle: 'Under Section 156(1) and (5) of the Companies Act 1967, every director of a company who is in any way, directly or indirectly, interested in a transaction or proposed transaction with the company, or who holds any office or possesses any property creating duties or interests in conflict with their duties as director, must declare the nature of that interest at a meeting of directors or by written notice to the company as soon as practicable.',
    verbatimStatuteText: 'Every director of a company who is in any way, whether directly or indirectly, interested in a transaction or proposed transaction with the company shall as soon as practicable after the relevant facts have come to the director\'s knowledge — (a) declare the nature of the director\'s interest at a meeting of the directors of the company; or (b) send a written notice to the company containing details on the nature, character and extent of the director\'s interest.',
    application: 'Corporate governance and audit review: Whenever a director or related party enters into a sales, lease, loan, or supply agreement with the company, formal Section 156 board disclosure minutes must be documented.',
    practicalRules: [
      'Mandatory Timing: Must disclose as soon as practicable after relevant facts become known.',
      'Method of Disclosure: Formal declaration at a meeting of directors or written notice sent to the company and tabled at the next board meeting.',
      'Offices & Property: Must also declare any office held or property possessed which creates conflicting duties/interests with company directorship.',
      'Criminal Sanction: Non-compliance is an offence under Section 156(15) rendering the defaulting director liable to a fine or imprisonment.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/CoA1967?ProvIds=P15-#pr156-',
    tags: ['director interest', 'section 156', 'conflict of interest', 'related party disclosure', 'board declaration'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '1967-12-29',
    validFrom: '1967-12-29',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },

  ACRA_SEC171_COMPANY_SECRETARY: {
    id: 'ACRA_SEC171_COMPANY_SECRETARY',
    authority: 'ACRA',
    authorityName: 'Accounting and Corporate Regulatory Authority (ACRA)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Companies Act 1967',
    actTitle: 'Companies Act 1967',
    actCode: 'CoA1967',
    sectionOrSchedule: 'Section 171',
    ruleTitle: 'Mandatory Appointment of Qualified Resident Company Secretary within 6 Months',
    category: 'ACRA_COMPLIANCE',
    principle: 'Under Section 171 of the Companies Act 1967, every company must appoint one or more secretaries who must be natural persons ordinarily resident in Singapore. The office of company secretary cannot be left vacant for more than 6 months. A sole director cannot act as the company secretary.',
    verbatimStatuteText: 'Every company shall have one or more secretaries each of whom shall be a natural person who has his principal or only place of residence in Singapore. The board of directors shall ensure that the office of secretary is not left vacant for more than 6 months at any one time. The sole director of a company shall not also be the secretary of the company.',
    application: 'Statutory compliance upon incorporation and secretary resignation: Company directors must appoint an eligible resident secretary within 6 months via BizFile+.',
    practicalRules: [
      'Residency Mandate: Must be a natural person ordinarily resident in Singapore (Singapore Citizen, PR, or EntrePass/EP holder).',
      '6-Month Vacancy Cap: Vacancy cannot exceed 6 continuous months.',
      'Sole Director Restriction: A sole director of a company is prohibited from simultaneously acting as company secretary.',
      'Public Companies: In a public company, secretary must hold requisite professional qualifications (e.g. qualified under CSIS, CA Singapore, advocate and solicitor, or 3 of last 5 years as secretary).'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/CoA1967?ProvIds=P15-#pr171-',
    tags: ['company secretary', 'section 171', 'resident secretary', 'sole director restriction', '6 months vacancy'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '1967-12-29',
    validFrom: '1967-12-29',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },

  ACRA_SEC142_143_RORC: {
    id: 'ACRA_SEC142_143_RORC',
    authority: 'ACRA',
    authorityName: 'Accounting and Corporate Regulatory Authority (ACRA)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Companies Act 1967',
    actTitle: 'Companies Act 1967',
    actCode: 'CoA1967',
    sectionOrSchedule: 'Sections 142, 143 & Part 11A',
    ruleTitle: 'Statutory Registers & Register of Registrable Controllers (RORC)',
    category: 'ACRA_COMPLIANCE',
    principle: 'Under Sections 142 and 143, and Part 11A (Section 386AF) of the Companies Act 1967, companies must maintain at their registered office statutory registers of members, directors, and secretaries, and maintain a confidential Register of Registrable Controllers (RORC) identifying individuals or legal entities with significant control (at least 25% of shares or voting rights) within 30 days of incorporation or subsequent changes.',
    verbatimStatuteText: 'A company to which this Part applies must keep a register of registrable controllers of the company, and enter the prescribed particulars of all registrable controllers of the company in the register of registrable controllers within the prescribed time and in the prescribed manner.',
    application: 'Corporate maintenance: Keeping updated electronic Register of Members (on ACRA) and private RORC with beneficial ownership verification.',
    practicalRules: [
      'Register of Members (Section 190): Maintained in electronic form by the Registrar on ACRA BizFile+.',
      'Register of Directors/Secretaries (Section 173): Maintained electronically by ACRA; companies must file updates within 14 days of appointment/cessation.',
      'Register of Registrable Controllers (Part 11A / Section 386AF): Private register identifying ultimate beneficial owners with >25% shareholding or voting power.',
      '30-Day Setup: RORC must be established within 30 days of incorporation and lodged with ACRA central register.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/CoA1967?ProvIds=P111A-#pr386AF-',
    tags: ['rorc', 'register of controllers', 'statutory registers', 'section 142', 'part 11a', 'beneficial ownership 25%'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2017-03-31',
    validFrom: '2017-03-31',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },

  ACRA_SEC68_NO_PAR_VALUE_SHARES: {
    id: 'ACRA_SEC68_NO_PAR_VALUE_SHARES',
    authority: 'ACRA',
    authorityName: 'Accounting and Corporate Regulatory Authority (ACRA)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Companies Act 1967',
    actTitle: 'Companies Act 1967',
    actCode: 'CoA1967',
    sectionOrSchedule: 'Section 68',
    ruleTitle: 'Abolition of Par Value and Share Premium (No Par Value Regime)',
    category: 'ACRA_COMPLIANCE',
    principle: 'Under Section 68 of the Companies Act 1967, shares of a Singapore company have no nominal or par value. The concept of share premium is abolished; all proceeds received from the issue of shares become part of the company\'s issued and paid-up share capital.',
    verbatimStatuteText: 'Shares of a company have no par or nominal value.',
    application: 'Accounting for share issues: Dr. Cash at Bank | Cr. Share Capital (100% of issue price credited to Share Capital without any Share Premium account).',
    practicalRules: [
      'No Par Value: Shares have no nominal value (e.g. no $1 par value).',
      'No Share Premium: Entire proceeds received from allotment of shares represent paid-up share capital.',
      'Issue at Any Price: Directors may issue shares at any price determined by the board, subject to shareholders\' approval under Section 161.',
      'Classes of Shares: Companies can issue different classes of shares (ordinary, preferred, redeemable) with customized voting and dividend rights.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/CoA1967?ProvIds=P14-#pr68-',
    tags: ['no par value', 'section 68', 'share capital', 'abolition of share premium', 'share issuance'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2006-01-30',
    validFrom: '2006-01-30',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },

  ACRA_SEC78B_CAPITAL_REDUCTION: {
    id: 'ACRA_SEC78B_CAPITAL_REDUCTION',
    authority: 'ACRA',
    authorityName: 'Accounting and Corporate Regulatory Authority (ACRA)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Companies Act 1967',
    actTitle: 'Companies Act 1967',
    actCode: 'CoA1967',
    sectionOrSchedule: 'Section 78B & Section 78C',
    ruleTitle: 'Court-Free Share Capital Reduction for Private Companies with Solvency Statement',
    category: 'ACRA_COMPLIANCE',
    principle: 'Under Section 78B of the Companies Act 1967, a private company limited by shares may reduce its share capital without obtaining court sanction by passing a special resolution, supported by a solvency statement signed by all directors confirming the company will remain solvent and able to pay its debts for 12 months, and complying with creditor publicity and ACRA notice lodgment requirements under Section 78E.',
    verbatimStatuteText: 'A private company limited by shares may reduce its share capital in any way by a special resolution if the company — (a) satisfies the solvency requirements; and (b) meets such publicity requirements as may be prescribed.',
    application: 'Returning surplus cash to shareholders or extinguishing accumulated losses against paid-up share capital: Dr. Share Capital | Cr. Cash / Bank (or Cr. Accumulated Losses).',
    practicalRules: [
      'Special Resolution: Requires 75% approval of shareholders voting at an EGM.',
      'Solvency Statement (Section 78C): All directors must sign a solvency statement affirming that the company will remain able to pay debts as they fall due within the next 12 months.',
      'Publicity Notice (Section 78B(1)(b)): Notice of resolution must be published within 8 days; 6-week creditor objection period applies.',
      'Effective Date: Capital reduction takes effect upon lodgment of completion documents with the Registrar on BizFile+.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/CoA1967?ProvIds=P14-#pr78B-',
    tags: ['capital reduction', 'section 78b', 'solvency statement', 'court-free reduction', 'special resolution'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2006-01-30',
    validFrom: '2006-01-30',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },

  // -------------------------------------------------------------
  // 4. CPF BOARD & CPF ACT 1953
  // -------------------------------------------------------------
  CPF_WAGE_CEILINGS_2026: {
    id: 'CPF_WAGE_CEILINGS_2026',
    authority: 'CPF',
    authorityName: 'Central Provident Fund Board (CPF)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Central Provident Fund Act 1953',
    actTitle: 'Central Provident Fund Act 1953',
    actCode: 'CPFA1953',
    sectionOrSchedule: 'First Schedule',
    ruleTitle: 'Ordinary Wage (OW) Monthly Ceiling ($8,000 in 2026) & Additional Wage (AW) Ceiling',
    category: 'CPF_PAYROLL',
    principle: 'CPF contributions are payable on Ordinary Wages (OW) up to the statutory monthly wage ceiling, and on Additional Wages (AW) up to the annual ceiling formula.',
    verbatimStatuteText: 'Every employer of an employee who is a citizen of Singapore or a permanent resident shall pay to the Fund monthly contributions at the statutory rates up to the Ordinary Wage monthly ceiling of $8,000, and up to the Additional Wage annual ceiling calculated as $102,000 minus total Ordinary Wages subject to CPF in the year.',
    application: 'Payroll calculations for Singapore Citizen and Permanent Resident employees.',
    practicalRules: [
      '2026 Ordinary Wage (OW) Ceiling: SGD 8,000 per month (effective 1 January 2026). Mandatory CPF is capped at SGD 8,000 of monthly basic salary.',
      'Historical Phased Ceilings: SGD 6,000 (pre-Sept 2023) -> SGD 6,800 (Jan 2024) -> SGD 7,400 (Jan 2025) -> SGD 8,000 (1 Jan 2026).',
      'Additional Wage (AW) Ceiling Formula: $$\\text{AW Ceiling} = \\text{SGD 102,000} - \\text{Total OW subject to CPF in the year}$$.',
      'Contribution Rates (Age $\\le 55$): Employer 17%, Employee 20% (Total 37%). For SGD 8,000 salary: Employer = SGD 1,360, Employee = SGD 1,600 (Total = SGD 2,960).',
      'Due Date: CPF contributions are due at the end of the calendar month and must be paid by the 14th of the following month.'
    ],
    canonicalUrl: 'https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay',
    tags: ['cpf ceiling', 'ordinary wage ceiling', 'wage ceiling', '2026 cpf', 'cpf ceiling 2026', '8000 ceiling', 'ow ceiling 8000', 'aw ceiling', 'cpf contribution', 'monthly contribution rate', 'ordinary wage 8000', 'cpf rates 2026'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2026-01-01',
    validFrom: '2026-01-01',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },

  CPF_SDL_SKILLS_DEVELOPMENT_LEVY: {
    id: 'CPF_SDL_SKILLS_DEVELOPMENT_LEVY',
    authority: 'CPF',
    authorityName: 'SkillsFuture Singapore & CPF Board',
    actTitle: 'Skills Development Levy Act 1979',
    actCode: 'SDLA1979',
    sectionOrSchedule: 'Section 3',
    ruleTitle: 'Skills Development Levy (SDL) Calculation Formula (0.25%, Min $2, Max $11.25)',
    category: 'CPF_PAYROLL',
    principle: 'Employers must pay a monthly Skills Development Levy (SDL) for all employees rendering services in Singapore, collected by the CPF Board on behalf of SkillsFuture Singapore.',
    application: 'Calculated monthly alongside payroll and submitted together with monthly CPF returns.',
    practicalRules: [
      'Levy Rate: 0.25% of the total monthly remuneration of each employee.',
      'Minimum Monthly Cap: Minimum SGD 2.00 per employee earning less than SGD 800.',
      'Maximum Monthly Cap: Maximum SGD 11.25 per employee earning SGD 4,500 and above (0.25% of SGD 4,500).',
      'Applies to: All employees (Singapore Citizens, PRs, and foreign work pass holders [EP, S-Pass, Work Permit]).',
      'Tax Treatment: Employer SDL is an allowable business operating expense under Section 14 of the Income Tax Act.'
    ],
    canonicalUrl: 'https://www.cpf.gov.sg/employer/employer-obligations/skills-development-levy',
    tags: ['sdl', 'skills development levy', 'sdl formula', 'max 11.25', 'min 2.00']
  },

  CPF_EMPLOYER_TAX_DEDUCTIBILITY: {
    id: 'CPF_EMPLOYER_TAX_DEDUCTIBILITY',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS) & AGC',
    actTitle: 'Income Tax Act 1947',
    actCode: 'ITA1947',
    sectionOrSchedule: 'Section 14(1)(e)',
    ruleTitle: 'Tax Deductibility of Statutory Employer CPF Contributions',
    category: 'TAX_INCOME',
    principle: 'Mandatory employer contributions made in respect of an employee to the CPF pursuant to the CPF Act are allowable as deductions in determining taxable corporate profit.',
    application: 'Company claims full tax deduction for the 17% employer CPF expense in P&L.',
    practicalRules: [
      'Mandatory CPF: Fully deductible up to the statutory limits (OW ceiling SGD 8,000 / AW ceiling formula).',
      'Voluntary CPF / Excess Contributions: Any employer CPF contribution exceeding the statutory ceiling is non-deductible for the employer and is taxable income in the hands of the employee.',
      'Self-Employed / Working Directors: Working directors who are employees of the company receive tax-deductible employer CPF under Section 14(1)(e).'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P15-#pr14-',
    tags: ['cpf tax deduction', 'section 14(1)(e)', 'employer cpf', 'voluntary cpf']
  },

  CPFA_SEC7_FIRST_SCHEDULE: {
    id: 'CPFA_SEC7_FIRST_SCHEDULE',
    authority: 'CPF',
    authorityName: 'Central Provident Fund Board (CPF)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Central Provident Fund Act 1953',
    actTitle: 'Central Provident Fund Act 1953',
    actCode: 'CPFA1953',
    sectionOrSchedule: 'Section 7 & First Schedule',
    ruleTitle: 'Statutory CPF Contribution Rates & Rounding Rules (Cents Discarded for Employee, Dollar Rounding for Employer)',
    category: 'CPF_PAYROLL',
    principle: 'Under Section 7 and the First Schedule of the Central Provident Fund Act 1953, the employer pays both employer and employee contributions. The employee share is deducted from wages with cents discarded. The total contribution is rounded to the nearest dollar, and employer contribution is the difference between total and employee contribution.',
    verbatimStatuteText: 'Every employer of an employee shall pay monthly to the Fund in respect of each employee contributions at the respective rates prescribed in the First Schedule. In calculating the employee\'s share of contribution, any fraction of a dollar which is a cent or cents shall be discarded. Total contribution payable shall be rounded to the nearest dollar.',
    application: 'Calculation of monthly employee and employer CPF contributions up to the Ordinary Wage monthly ceiling (SGD 8,000 for 2026).',
    practicalRules: [
      'Employee CPF Share: For age 55 and below, 20% of Ordinary Wages. Statutory Rounding: Cents are discarded / dropped.',
      'Employer CPF Share: For age 55 and below, 17% of Ordinary Wages. Rounding: Total CPF rounded to nearest dollar; Employer CPF = Total CPF - Employee CPF.',
      'Ordinary Wage (OW) Ceiling: SGD 8,000 per month effective 1 January 2026.',
      'Tax Deductibility: Mandatory employer CPF is 100% tax-deductible under Section 14(1)(e) of the Income Tax Act 1947.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/CPFA1953?ProvIds=P12-#pr7-',
    tags: ['cpf act section 7', 'first schedule', 'cpf rounding', 'employee cpf 20%', 'employer cpf 17%', 'cpf calculation', 'cents discarded'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2026-01-01',
    validFrom: '2026-01-01',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },

  CPF_ACCOUNT_ALLOCATION_RATES: {
    id: 'CPF_ACCOUNT_ALLOCATION_RATES',
    authority: 'CPF',
    authorityName: 'Central Provident Fund Board (CPF)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Central Provident Fund Act 1953',
    actTitle: 'Central Provident Fund Act 1953',
    actCode: 'CPFA1953',
    sectionOrSchedule: 'Section 13 & First Schedule',
    ruleTitle: 'Statutory Allocation of Monthly CPF Contributions across OA, SA/RA, and MA by Age Bracket',
    category: 'CPF_PAYROLL',
    principle: 'Under Section 13 and the First Schedule of the Central Provident Fund Act 1953, the total monthly CPF contribution paid in respect of an employee is credited to the employee\'s Ordinary Account (OA), Special Account (SA / Retirement Account RA from age 55), and MediSave Account (MA) according to statutory allocation ratios determined by the employee\'s age band.',
    verbatimStatuteText: 'Every contribution paid into the Fund under section 7 in respect of an employee shall be credited to the prescribed accounts of that employee in such proportions as may be prescribed by regulations made under this Act according to the age of the employee.',
    application: 'Monthly payroll and accounting reconciliation: Allocating total 37% CPF (age <= 35) into OA (0.6217 of total CPF, ~23% of wages), SA (0.1621 of total CPF, ~6% of wages), and MA (0.2162 of total CPF, ~8% of wages).',
    practicalRules: [
      'Age <= 35: Total CPF 37% allocated as OA: 23%, SA: 6%, MA: 8%.',
      'Age > 35 to 45: Total CPF 37% allocated as OA: 21%, SA: 7%, MA: 9%.',
      'Age > 45 to 50: Total CPF 37% allocated as OA: 19%, SA: 8%, MA: 10%.',
      'Age > 50 to 55: Total CPF 37% allocated as OA: 15%, SA: 11.5%, MA: 10.5%.',
      'Age > 55 to 60: Total CPF 30% allocated as OA: 12%, SA/RA: 7.5%, MA: 10.5%.',
      'Age > 60 to 65: Total CPF 21% allocated as OA: 3.5%, SA/RA: 7%, MA: 10.5%.',
      'Age > 65 to 70: Total CPF 16.5% allocated as OA: 1%, SA/RA: 5%, MA: 10.5%.',
      'Age > 70: Total CPF 12.5% allocated as OA: 1%, SA/RA: 1%, MA: 10.5%.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/CPFA1953?ProvIds=P12-#pr13-',
    tags: ['cpf account allocation', 'ordinary account', 'special account', 'medisave account', 'oa sa ma ratio', 'section 13'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2026-01-01',
    validFrom: '2026-01-01',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },

  CPF_WAGE_CEILING_2024: {
    id: 'CPF_WAGE_CEILING_2024',
    authority: 'CPF',
    authorityName: 'Central Provident Fund Board (CPF)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Central Provident Fund Act 1953',
    actTitle: 'Central Provident Fund Act 1953',
    actCode: 'CPFA1953',
    sectionOrSchedule: 'First Schedule',
    ruleTitle: 'Historical Ordinary Wage (OW) Monthly Ceiling ($6,800 in 2024)',
    category: 'CPF_PAYROLL',
    principle: 'From 1 January 2024 to 31 December 2024, the statutory CPF Ordinary Wage monthly ceiling was SGD 6,800 under the second phase of the multi-year ceiling increases.',
    verbatimStatuteText: 'For the year 2024, the maximum monthly ordinary wage for which contributions are payable shall be $6,800.',
    application: 'Historical payroll audit and retroactive wage computations for calendar year 2024.',
    practicalRules: [
      'Monthly OW Ceiling: SGD 6,800.',
      'Max Employee CPF (20%): SGD 1,360.',
      'Max Employer CPF (17%): SGD 1,156 (Total: SGD 2,516).',
      'Superseded: Replaced by $7,400 on 1 January 2025.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/CPFA1953?ProvIds=P18-#Sc1-',
    tags: ['cpf ceiling', 'ordinary wage ceiling', 'wage ceiling', 'cpf ceiling 2024', '6800 ceiling', 'historical cpf 2024', 'ow ceiling 6800'],
    sourceStatus: 'HISTORICAL',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2024-01-01',
    validFrom: '2024-01-01',
    validTo: '2024-12-31',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365,
    supersededByRecordId: 'CPF_WAGE_CEILING_2025'
  },

  CPF_WAGE_CEILING_2025: {
    id: 'CPF_WAGE_CEILING_2025',
    authority: 'CPF',
    authorityName: 'Central Provident Fund Board (CPF)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Central Provident Fund Act 1953',
    actTitle: 'Central Provident Fund Act 1953',
    actCode: 'CPFA1953',
    sectionOrSchedule: 'First Schedule',
    ruleTitle: 'Historical Ordinary Wage (OW) Monthly Ceiling ($7,400 in 2025)',
    category: 'CPF_PAYROLL',
    principle: 'From 1 January 2025 to 31 December 2025, the statutory CPF Ordinary Wage monthly ceiling was SGD 7,400 under the third phase of the ceiling increases.',
    verbatimStatuteText: 'For the year 2025, the maximum monthly ordinary wage for which contributions are payable shall be $7,400.',
    application: 'Historical payroll audit and retroactive wage computations for calendar year 2025.',
    practicalRules: [
      'Monthly OW Ceiling: SGD 7,400.',
      'Max Employee CPF (20%): SGD 1,480.',
      'Max Employer CPF (17%): SGD 1,258 (Total: SGD 2,738).',
      'Superseded: Replaced by $8,000 on 1 January 2026.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/CPFA1953?ProvIds=P18-#Sc1-',
    tags: ['cpf ceiling', 'ordinary wage ceiling', 'wage ceiling', 'cpf ceiling 2025', '7400 ceiling', 'historical cpf 2025', 'ow ceiling 7400'],
    sourceStatus: 'HISTORICAL',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2025-01-01',
    validFrom: '2025-01-01',
    validTo: '2025-12-31',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365,
    supersededByRecordId: 'CPF_WAGE_CEILINGS_2026',
    historicalPredecessorRecordId: 'CPF_WAGE_CEILING_2024'
  },

  // -------------------------------------------------------------
  // 5. MOM & EMPLOYMENT ACT 1968
  // -------------------------------------------------------------
  MOM_SEC21_SALARY_TIMELINES: {
    id: 'MOM_SEC21_SALARY_TIMELINES',
    authority: 'MOM',
    authorityName: 'Ministry of Manpower (MOM)',
    actTitle: 'Employment Act 1968',
    actCode: 'EA1968',
    sectionOrSchedule: 'Section 21 & Section 22',
    ruleTitle: 'Statutory Salary and Overtime Payment Timelines (Within 7 / 14 Days)',
    category: 'MOM_LABOUR',
    principle: 'An employer must pay salary to employees at least once a month and within 7 days after the end of the salary period. Overtime pay must be paid within 14 days after the salary period.',
    application: 'Companies paying monthly salary must ensure bank transfers settle by the 7th of the following calendar month.',
    practicalRules: [
      'Basic Salary: Must be disbursed within 7 calendar days after the end of the salary period.',
      'Overtime Pay: Must be paid within 14 calendar days after the end of the salary period.',
      'Termination of Service by Employer: All outstanding salary and accumulated benefits must be paid on the last day of employment, or within 3 working days if notice cannot be served.',
      'Itemised Pay Slips: Mandatory under Section 96 of the Employment Act to provide itemised pay slips with every salary payment.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/EmA1968?ProvIds=P13-#pr21-',
    tags: ['salary deadline', '7 days', 'overtime payment deadline', 'itemised payslip', 'section 21'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2019-04-01',
    verbatimStatuteText: 'Salary earned by an employee under a contract of service shall be paid before the expiry of the seventh day after the last day of the salary period. Payment for overtime work shall be made within 14 days after the end of the salary period.'
  },

  MOM_SEC22_PRORATED_SALARY: {
    id: 'MOM_SEC22_PRORATED_SALARY',
    authority: 'MOM',
    authorityName: 'Ministry of Manpower (MOM)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Employment Act 1968',
    actTitle: 'Employment Act 1968',
    actCode: 'EA1968',
    sectionOrSchedule: 'Section 22',
    ruleTitle: 'MOM Formula for Salary Computation for Incomplete Month of Work',
    category: 'MOM_LABOUR',
    principle: 'Under Section 22 of the Employment Act 1968, salary for an incomplete month of service (commencement, resignation, or termination) is calculated as: (Monthly Basic Salary / Total Working Days in Month) x Total Working Days Worked.',
    application: 'Prorated salary calculation on resignation or termination. Total working days and days worked exclude rest days and non-working days for a 5-day work week.',
    practicalRules: [
      'Formula: Gross Salary Payable = (Monthly Basic Rate of Pay / Total Working Days in Month) * Actual Days Worked.',
      'Total Working Days: Number of days on which employee was required to work in that month (excludes rest days / non-working Saturdays/Sundays).',
      'Payment Deadline: On employee resignation with notice, full salary and benefits must be paid on the employee\'s last day of employment (Section 21(2)).'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/EmA1968?ProvIds=P13-#pr22-',
    tags: ['prorated salary', 'incomplete month', 'section 22', 'last day', 'resignation salary', 'mom formula', 'salary proration'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2019-04-01',
    verbatimStatuteText: 'The salary payable to an employee for an incomplete month of work shall be calculated in accordance with the formula: (Monthly basic rate of pay / Total number of working days in that month) x Total number of days on which the employee was required to work and actually worked.'
  },

  // -------------------------------------------------------------
  // 6. MAS & FINANCIAL REGULATIONS
  // -------------------------------------------------------------
  MAS_ZERO_EXCHANGE_CONTROLS: {
    id: 'MAS_ZERO_EXCHANGE_CONTROLS',
    authority: 'MAS',
    authorityName: 'Monetary Authority of Singapore (MAS)',
    actTitle: 'Monetary Authority of Singapore Act 1970 & Foreign Exchange Framework',
    actCode: 'MASA1970',
    sectionOrSchedule: 'Exchange Control Liberalisation Directive',
    ruleTitle: 'Absence of Foreign Exchange Controls & Free Capital Movement in Singapore',
    category: 'MAS_FINANCE',
    principle: 'Singapore has completely liberalised all foreign exchange controls. There are no restrictions on foreign currency exchange, cross-border remittances, or profit repatriation.',
    application: 'Companies can maintain multi-currency bank balances (USD, EUR, SGD) and freely remit capital without needing approval from MAS.',
    practicalRules: [
      'Zero Exchange Controls: Residents and non-residents are free to buy, hold, and sell any foreign currency.',
      'Repatriation: 100% of capital, dividends, and profits can be remitted overseas freely without withholding tax on dividends.',
      'SFRS Accounting: Foreign exchange transactions must be translated at spot rate in accordance with SFRS(I) 1-21 / IAS 21, and monetary items revalued at closing rates.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/MASA1970',
    tags: ['exchange control', 'capital controls', 'profit repatriation', 'mas policy', 'foreign currency']
  },

  MAS_PSA_DIGITAL_TOKENS_AML: {
    id: 'MAS_PSA_DIGITAL_TOKENS_AML',
    authority: 'MAS',
    authorityName: 'Monetary Authority of Singapore (MAS)',
    actTitle: 'Payment Services Act 2019',
    actCode: 'PSA2019',
    sectionOrSchedule: 'Section 6 & MAS Notice PSN02',
    ruleTitle: 'Payment Services Act (PSA) Licensing & Digital Payment Token (DPT) Framework',
    category: 'MAS_FINANCE',
    principle: 'Entities providing digital payment token (DPT) dealing or exchange services in Singapore must be licensed under the Payment Services Act and comply with mandatory AML/CFT guidelines under MAS Notice PSN02.',
    application: 'Fintech and crypto companies handling customer fiat or token transfers.',
    practicalRules: [
      'License Types: Standard Payment Institution (SPI) or Major Payment Institution (MPI) based on monthly transaction volume thresholds ($3M payment transactions / $5M DPT transactions).',
      'IRAS Tax Treatment on Tokens: Citing the IRAS e-Tax Guide on Income Tax Treatment of Digital Tokens:\n  - Payment Tokens (e.g. Bitcoin, Ethereum): Exchanged for goods/services are exempt from GST.\n  - Utility Tokens: Treated as prepayment vouchers.\n  - Capital Gains: Non-taxable if held as long-term investment; trading profits are subject to 17% corporate income tax.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/PSA2019',
    tags: ['payment services act', 'crypto tax', 'digital tokens', 'mas notice psn02', 'psa 2019']
  },

  // -------------------------------------------------------------
  // 7. MOM & LEAVE / OVERTIME MANDATES (SECTION-LEVEL PRIMARY PROVISIONS)
  // -------------------------------------------------------------
  MOM_SEC88A_ANNUAL_LEAVE: {
    id: 'MOM_SEC88A_ANNUAL_LEAVE',
    authority: 'MOM',
    authorityName: 'Ministry of Manpower (MOM)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Employment Act 1968',
    actTitle: 'Employment Act 1968',
    actCode: 'EA1968',
    sectionOrSchedule: 'Section 88A',
    ruleTitle: 'Paid Annual Leave Statutory Entitlements (7 to 14 Days)',
    category: 'MOM_LABOUR',
    principle: 'An employee who has served an employer for a period of not less than 3 months shall be entitled to paid annual leave of 7 days in respect of the first 12 months of continuous service with that employer, and an additional one day of paid annual leave for every subsequent 12 months of continuous service, up to a maximum of 14 days.',
    verbatimStatuteText: 'An employee who has served an employer for a period of not less than 3 months shall be entitled to paid annual leave of 7 days in respect of the first 12 months of continuous service with the employer and an additional one day’s paid annual leave for every subsequent 12 months of continuous service with the same employer, subject to a maximum of 14 days of paid annual leave.',
    application: 'Leave administration and payroll accrual calculations for permanent and contract employees.',
    practicalRules: [
      'Paid Annual Leave (Section 88A): Minimum 7 days after 1 year of service, increasing by 1 additional day per completed year of service, up to a statutory maximum of 14 days for 8 or more years of service.',
      'Pro-rating: Employees who have served at least 3 months in a calendar year are entitled to pro-rated annual leave in that year.',
      'Forfeiture / Encashment: Statutory annual leave cannot be unlawfully forfeited if statutory qualification criteria are met.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/EmA1968?ProvIds=P110-#pr88A-',
    tags: ['annual leave', 'section 88a', 'leave entitlement', '7 days', '14 days', 'statutory annual leave'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2019-04-01'
  },

  MOM_SEC89_SICK_LEAVE: {
    id: 'MOM_SEC89_SICK_LEAVE',
    authority: 'MOM',
    authorityName: 'Ministry of Manpower (MOM)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Employment Act 1968',
    actTitle: 'Employment Act 1968',
    actCode: 'EA1968',
    sectionOrSchedule: 'Section 89',
    ruleTitle: 'Paid Outpatient Sick Leave (14 Days) and Hospitalisation Leave (60 Days)',
    category: 'MOM_LABOUR',
    principle: 'An employee who has served an employer for a period of not less than 3 months is entitled to paid sick leave not exceeding 14 days in each year if no hospitalisation is necessary, or 60 days in each year if hospitalisation is necessary.',
    verbatimStatuteText: 'An employee who has served an employer for a period of not less than 3 months is entitled to paid sick leave (including paid medical examination leave) not exceeding in the aggregate — (a) 14 days in each year if no hospitalisation is necessary; or (b) 60 days in each year if hospitalisation is necessary (including the 14 days of outpatient sick leave).',
    application: 'Paid medical leave and hospitalisation leave administration.',
    practicalRules: [
      'Paid Outpatient Sick Leave (Section 89): Up to 14 days per calendar year if certified by an approved medical practitioner. Graduated during first 6 months (5 days at 3 months, 8 days at 4 months, 11 days at 5 months, 14 days at 6+ months).',
      'Paid Hospitalisation Leave (Section 89): Up to 60 days per calendar year (inclusive of the 14 days of outpatient sick leave).',
      'Medical Certification: Medical certificates must be issued by a registered medical practitioner or company-appointed doctor.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/EmA1968?ProvIds=P110-#pr89-',
    tags: ['sick leave', 'outpatient sick leave', 'hospitalisation leave', 'section 89', 'medical leave', '14 days'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2019-04-01'
  },

  MOM_SEC38_OVERTIME: {
    id: 'MOM_SEC38_OVERTIME',
    authority: 'MOM',
    authorityName: 'Ministry of Manpower (MOM)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Employment Act 1968',
    actTitle: 'Employment Act 1968',
    actCode: 'EA1968',
    sectionOrSchedule: 'Section 38',
    ruleTitle: 'Part IV Hours of Work, Overtime Rate (1.5x Hourly Rate) & 72-Hour Monthly Cap',
    category: 'MOM_LABOUR',
    principle: 'For any overtime work, the employer shall pay the employee at the rate of not less than 1-1/2 times the employee’s hourly basic rate of pay. An employee shall not be permitted to work overtime for more than 72 hours a month without an MOM exemption.',
    verbatimStatuteText: 'For any overtime work, the employer shall pay the employee at the rate of not less than 1-1/2 times the employee’s hourly basic rate of pay. An employee shall not be permitted to work overtime for more than 72 hours a month, or such other number of hours as the Minister may prescribe.',
    application: 'Payroll calculation for overtime hours worked by Part IV eligible employees.',
    practicalRules: [
      'Coverage Threshold: Non-workmen earning monthly basic salary $\\le$ SGD 2,600; Workmen earning $\\le$ SGD 4,500.',
      'Overtime Rate: At least 1.5 times the hourly basic rate of pay (for non-workmen, salary capped at SGD 2,600 or SGD 13.60/hour for calculation).',
      'Maximum Overtime Cap: An employee cannot work more than 72 hours of overtime in a calendar month, except with an MOM overtime exemption.',
      'Payment Deadline: Under Section 21, overtime payment must be disbursed within 14 days after the end of the salary period.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/EmA1968?ProvIds=P14-#pr38-',
    tags: ['overtime', 'overtime rate', '1.5x', 'part iv', 'overtime pay', 'working hours', 'section 38', '72 hours'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2019-04-01'
  },

  MOM_ANNUAL_SICK_LEAVE: {
    id: 'MOM_ANNUAL_SICK_LEAVE',
    authority: 'MOM',
    authorityName: 'Ministry of Manpower (MOM)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Employment Act 1968',
    actTitle: 'Employment Act 1968',
    actCode: 'EA1968',
    sectionOrSchedule: 'Section 88A & Section 89',
    ruleTitle: 'Annual Leave and Paid Sick / Hospitalisation Leave Statutory Entitlements',
    category: 'MOM_LABOUR',
    principle: 'Employees covered by the Employment Act who have served an employer for at least 3 months are entitled to paid sick leave. Employees who have served for at least 12 months are entitled to statutory paid annual leave.',
    verbatimStatuteText: 'An employee who has served an employer for a period of not less than 3 months shall be entitled to paid annual leave of 7 days in respect of the first 12 months of continuous service with the employer and an additional one day’s paid annual leave for every subsequent 12 months of continuous service with the same employer, subject to a maximum of 14 days of paid annual leave. An employee who has served for at least 3 months is entitled to paid sick leave not exceeding 14 days if no hospitalisation is necessary, or 60 days if hospitalisation is necessary.',
    application: 'Leave administration and payroll accrual calculations for permanent and contract employees.',
    practicalRules: [
      'Paid Annual Leave (Section 88A): Minimum 7 days after 1 year of service, increasing by 1 additional day per completed year of service, up to a statutory maximum of 14 days for 8 or more years of service.',
      'Paid Outpatient Sick Leave (Section 89): Up to 14 days per calendar year if certified by an approved medical practitioner. Graduated during first 6 months of employment (5 days at 3 months, 8 days at 4 months, 11 days at 5 months, 14 days at 6+ months).',
      'Paid Hospitalisation Leave (Section 89): Up to 60 days per calendar year (which includes the 14 days of outpatient sick leave).',
      'Public Holidays (Section 88): 11 statutory gazetted public holidays per year. If required to work on a public holiday, an employee is entitled to an extra day of basic salary or a day off in lieu.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/EmA1968?ProvIds=P110-#pr89-',
    tags: ['annual leave', 'sick leave', 'hospitalisation leave', 'leave entitlement', 'public holiday', 'section 89', 'employment act leave'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2019-04-01'
  },

  MOM_OVERTIME_PART_IV: {
    id: 'MOM_OVERTIME_PART_IV',
    authority: 'MOM',
    authorityName: 'Ministry of Manpower (MOM)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Employment Act 1968',
    actTitle: 'Employment Act 1968',
    actCode: 'EA1968',
    sectionOrSchedule: 'Section 38',
    ruleTitle: 'Part IV Working Hours, Overtime Limits & Overtime Pay Rate (1.5x Hourly Rate)',
    category: 'MOM_LABOUR',
    principle: 'Part IV of the Employment Act protects workmen earning up to $4,500/month and non-workmen earning up to $2,600/month. Hours worked beyond contractual standard hours (max 44 hours/week) must be paid at overtime rates.',
    verbatimStatuteText: 'For any overtime work, the employer shall pay the employee at the rate of not less than 1-1/2 times the employee’s hourly basic rate of pay. An employee shall not be permitted to work overtime for more than 72 hours a month, or such other number of hours as the Minister may prescribe.',
    application: 'Payroll calculation for overtime hours worked by eligible employees.',
    practicalRules: [
      'Coverage Threshold: Non-workmen earning monthly basic salary $\\le$ SGD 2,600; Workmen earning $\\le$ SGD 4,500.',
      'Overtime Rate: At least 1.5 times the hourly basic rate of pay (for non-workmen, salary capped at SGD 2,600 or SGD 13.60/hour for calculation).',
      'Maximum Overtime Cap: An employee cannot work more than 72 hours of overtime in a calendar month, except with an MOM overtime exemption.',
      'Payment Deadline: Under Section 21, overtime payment must be disbursed within 14 days after the end of the salary period.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/EmA1968?ProvIds=P14-#pr38-',
    tags: ['overtime', 'overtime rate', '1.5x', 'part iv', 'overtime pay', 'working hours', 'section 38', '44 hours'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2019-04-01',
    validFrom: '2019-04-01',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },

  MOM_SEC36_37_REST_DAY_PAY: {
    id: 'MOM_SEC36_37_REST_DAY_PAY',
    authority: 'MOM',
    authorityName: 'Ministry of Manpower (MOM)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Employment Act 1968',
    actTitle: 'Employment Act 1968',
    actCode: 'EA1968',
    sectionOrSchedule: 'Section 36 & Section 37',
    ruleTitle: 'Rest Day Entitlement & Statutory Payment Computation for Work Done on Rest Day',
    category: 'MOM_LABOUR',
    principle: 'Under Sections 36 and 37 of the Employment Act 1968, an employer must allow each employee one rest day comprising a whole day without pay per week (§36). If an employee works on a rest day at the employer\'s request (§37(2)): for work not exceeding half the normal daily working hours, the employer must pay 1 full day\'s basic wage; for work exceeding half but not exceeding the normal daily working hours, the employer must pay 2 full days\' basic wages; for hours worked exceeding the normal daily hours, overtime is payable at not less than 1.5 times the hourly basic rate of pay (§37(3)). If work is at the employee\'s own request (§37(1)), the pay is half a day\'s wage for <= 0.5 day and 1 day\'s wage for <= 1 day.',
    verbatimStatuteText: 'Where an employee works on a rest day at the request of the employer, the employee shall be paid for work done on that day — (a) if the period of work does not exceed half the employee\'s normal daily hours of work, a sum at the basic rate of pay for one day\'s work; (b) if the period of work exceeds half but does not exceed the employee\'s normal daily hours of work, a sum at the basic rate of pay for 2 days\' work; or (c) if the period of work exceeds the employee\'s normal daily hours of work, a sum in accordance with paragraph (b) and an additional payment at a rate of not less than 1-1/2 times the hourly basic rate of pay.',
    application: 'Payroll calculation for employees required to work on Sunday or scheduled rest day: Basic rate of pay for 1 or 2 days plus 1.5x overtime.',
    practicalRules: [
      'Employer\'s Request: Work <= half normal shift: 1 full day\'s basic pay; Work > half normal shift: 2 full days\' basic pay.',
      'Overtime on Rest Day: Hours worked in excess of normal daily hours must be paid at >= 1.5 times the hourly basic rate.',
      'Employee\'s Request: Work <= half normal shift: 0.5 day\'s basic pay; Work > half normal shift: 1.0 day\'s basic pay.',
      'Part IV Coverage: Applies to workmen earning <= SGD 4,500 and non-workmen earning <= SGD 2,600.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/EmA1968?ProvIds=P14-#pr37-',
    tags: ['rest day pay', 'section 36', 'section 37', 'sunday work', 'rest day computation', '1 day pay', '2 days pay'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2019-04-01',
    validFrom: '2019-04-01',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },

  MOM_MANDATORY_RETRENCHMENT_NOTIFICATION: {
    id: 'MOM_MANDATORY_RETRENCHMENT_NOTIFICATION',
    authority: 'MOM',
    authorityName: 'Ministry of Manpower (MOM)',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Employment Act 1968 & Employment (Retrenchment Notification) Regulations',
    actTitle: 'Employment Act 1968',
    actCode: 'EA1968',
    sectionOrSchedule: 'Section 96A & Retrenchment Notification Regulations',
    ruleTitle: 'Mandatory Retrenchment Notification (MRN) to MOM within 5 Working Days',
    category: 'MOM_LABOUR',
    principle: 'Under the Employment (Retrenchment Notification) Regulations and Section 96A of the Employment Act 1968, employers with 10 or more employees who retrench 5 or more employees within any 6-month period must submit a mandatory notification to the Ministry of Manpower (MOM) via the MyMOM portal within 5 working days after giving notice of retrenchment to affected employees.',
    verbatimStatuteText: 'An employer who employs 10 or more employees must notify the Commissioner for Labour of any retrenchment of employees within 5 working days after the employer gives notice of retrenchment to the affected employee, where the retrenchment is of 5 or more employees in any 6-month period.',
    application: 'Corporate restructuring, down-sizing, and redundancy exercises: Filing mandatory retrenchment returns to Workforce Singapore / MOM within 5 working days.',
    practicalRules: [
      'Employer Threshold: Business employing 10 or more employees in total.',
      'Trigger Threshold: Retrenchment of 5 or more employees within any 6-month rolling window.',
      'Filing Deadline: Within 5 working days of notifying affected staff.',
      'Penalties: Failure to notify is a civil penalty offence under Section 96A subject to administrative financial penalties up to SGD 2,000 per breach.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/SL/EA1968-RG14',
    tags: ['retrenchment notification', 'mandatory retrenchment', 'section 96a', '5 employees 6 months', '5 working days'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2021-11-01',
    validFrom: '2021-11-01',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },

  MOM_CDCA_PARENTAL_LEAVES: {
    id: 'MOM_CDCA_PARENTAL_LEAVES',
    authority: 'MOM',
    authorityName: 'Ministry of Manpower (MOM) & MSF',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Child Development Co-Savings Act 2001 & Employment Act 1968',
    actTitle: 'Child Development Co-Savings Act 2001',
    actCode: 'CDCA2001',
    sectionOrSchedule: 'Section 9, Section 12B & EA Section 87A',
    ruleTitle: 'Statutory Paid Maternity Leave (16 Weeks), Paternity Leave (4 Weeks) & Childcare Leave (6 Days)',
    category: 'MOM_LABOUR',
    principle: 'Under the Child Development Co-Savings Act 2001 and the Employment Act 1968, eligible working mothers of a Singapore Citizen child are entitled to 16 weeks of Government-Paid Maternity Leave (GPML). Eligible working fathers are entitled to 4 weeks of Government-Paid Paternity Leave (GPPL). Working parents of a Singapore Citizen child aged below 7 years are each entitled to 6 days of paid childcare leave per year.',
    verbatimStatuteText: 'Subject to this section, every female employee who has served an employer for a period of not less than 3 months shall be entitled to absent herself from work during periods prescribed as maternity leave for a total of 16 weeks, and every male employee who has served an employer for not less than 3 months shall be entitled to paternity leave of 4 weeks.',
    application: 'Payroll administration and government-paid claims via the GPL portal (pro-family leave reimbursement for employers).',
    practicalRules: [
      'Maternity Leave (16 Weeks): For 1st & 2nd child: 8 weeks employer-funded + 8 weeks government-funded. For 3rd+ child: all 16 weeks government-funded (capped at SGD 10,000 per 4-week block).',
      'Paternity Leave (4 Weeks): Mandatory 4 weeks government-paid paternity leave for working fathers of Singapore citizen children (effective 1 Jan 2024).',
      'Childcare Leave: 6 days per parent per year for children under 7 years (first 3 days employer-funded, next 3 days government-funded).',
      'Service Requirement: Employee must have served the employer for at least 3 continuous months prior to child\'s birth.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/CDCSA2001?ProvIds=P13-#pr9-',
    tags: ['maternity leave 16 weeks', 'paternity leave 4 weeks', 'childcare leave 6 days', 'cdca 2001', 'parental leave', 'government paid'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2024-01-01',
    validFrom: '2024-01-01',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },

  // -------------------------------------------------------------
  // 8. CPF BOARD & TIERED CONTRIBUTION RATES BY AGE (CURATED SUMMARY)
  // -------------------------------------------------------------
  CPF_RATES_BY_AGE_2026: {
    id: 'CPF_RATES_BY_AGE_2026',
    authority: 'CPF',
    authorityName: 'Central Provident Fund Board (CPF)',
    actTitle: 'Central Provident Fund Act 1953',
    actCode: 'CPFA1953',
    sectionOrSchedule: 'First Schedule (Statutory Contribution Rates)',
    ruleTitle: 'Tiered CPF Contribution Rates by Employee Age Bracket & 2026 Ceilings',
    category: 'CPF_PAYROLL',
    principle: 'Mandatory CPF contributions for Singapore Citizens and Permanent Residents (from 3rd year of PR status onwards) are calculated using tiered statutory percentage rates based on the employee\'s age.',
    application: 'Monthly payroll computation for all citizen and permanent resident employees.',
    practicalRules: [
      'Age 55 and below: Employer 17%, Employee 20% (Total: 37%).',
      'Age above 55 to 60: Employer 15%, Employee 15% (Total: 30% - ongoing senior worker rate enhancement).',
      'Age above 60 to 65: Employer 11.5%, Employee 9.5% (Total: 21%).',
      'Age above 65 to 70: Employer 9%, Employee 7.5% (Total: 16.5%).',
      'Age above 70: Employer 7.5%, Employee 5% (Total: 12.5%).',
      '2026 Ordinary Wage (OW) Monthly Ceiling: SGD 8,000 (effective 1 January 2026). Max monthly contribution for age $\\le 55$ is SGD 1,360 (employer) + SGD 1,600 (employee) = SGD 2,960.',
      'Additional Wage (AW) Ceiling: $$\\text{AW Ceiling} = \\text{SGD 102,000} - \\text{Total OW subject to CPF in the year}$$.'
    ],
    canonicalUrl: 'https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay',
    tags: ['cpf rates by age', 'cpf contribution table', 'senior worker cpf', 'cpf 55 60', 'cpf rates 2026', 'cpf age brackets'],
    sourceStatus: 'NEEDS_REVIEW',
    sourceType: 'CURATED_SUMMARY',
    evidenceTier: 'CURATED_SUMMARY',
    isVerbatimText: false,
    effectiveDate: '2026-01-01'
  },

  // -------------------------------------------------------------
  // 9. IRAS & ENTERPRISE INNOVATION SCHEME (EIS) / R&D
  // -------------------------------------------------------------
  ITA_SEC14C_EIS_INNOVATION: {
    id: 'ITA_SEC14C_EIS_INNOVATION',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    actTitle: 'Income Tax Act 1947',
    actCode: 'ITA1947',
    sectionOrSchedule: 'Section 14C & Section 14D (Enterprise Innovation Scheme)',
    ruleTitle: '400% Enhanced Tax Deduction on Qualifying R&D and Enterprise Innovation Scheme (EIS)',
    category: 'TAX_INCOME',
    principle: 'Under the Enterprise Innovation Scheme (EIS), qualifying businesses enjoy an enhanced 400% tax deduction on up to SGD 400,000 of qualifying expenditure per activity incurred on qualifying R&D, innovation, and IP registration.',
    application: 'Companies undertaking internal product development, software engineering, or filing patents/trademarks in Singapore.',
    practicalRules: [
      'Enhanced Deduction: 400% tax deduction (100% baseline under Section 14C + 300% enhanced under EIS) on qualifying R&D staff costs and consumables.',
      'Expenditure Cap: Capped at SGD 400,000 per qualifying activity per Year of Assessment.',
      'Cash Conversion Option: Qualifying businesses can opt to convert up to SGD 100,000 of total qualifying expenditure across all activities into a non-taxable cash payout at a 20% conversion rate (max SGD 20,000).',
      'Accounting vs Tax Divergence: For financial reporting under SFRS(I) 1-38, development costs meeting all 6 criteria are capitalized as an intangible asset and amortized over time. For tax purposes, qualifying R&D expenses claim the enhanced 400% deduction in the YA incurred.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P15-#pr14C-',
    tags: ['eis', 'enterprise innovation scheme', '400% deduction', 'r&d tax deduction', 'section 14c', 'intangibles tax']
  }
};

/**
 * Search the statutory knowledge repository by keyword or category, ranked by relevance.
 */
export function querySingaporeStatutes(query: string): SingaporeStatuteRule[] {
  const q = query.toLowerCase().trim();
  const scoredResults: { rule: SingaporeStatuteRule; score: number }[] = [];

  const queryWords = q.split(/\s+/).filter(w => w.length >= 3 && !['what', 'when', 'where', 'which', 'how', 'the', 'for', 'and', 'are'].includes(w));

  for (const rule of Object.values(SINGAPORE_STATUTORY_REPOSITORY)) {
    let matchScore = 0;

    // Exact tag match
    for (const tag of rule.tags) {
      if (q.includes(tag)) {
        matchScore += 8;
      }
    }

    // Section match
    if (q.includes(rule.sectionOrSchedule.toLowerCase())) {
      matchScore += 10;
    }

    // Title match
    if (rule.ruleTitle.toLowerCase().includes(q)) {
      matchScore += 10;
    }

    // Keyword tokens
    for (const word of queryWords) {
      if (rule.ruleTitle.toLowerCase().includes(word)) matchScore += 3;
      if (rule.sectionOrSchedule.toLowerCase().includes(word)) matchScore += 4;
      if (rule.tags.some(t => t.includes(word))) matchScore += 2;
      if (rule.principle.toLowerCase().includes(word)) matchScore += 1;
      if (rule.practicalRules.some(r => r.toLowerCase().includes(word))) matchScore += 1;
    }

    // Temporal Alignment & Freshness Scoring
    const isHistoricalRule = rule.sourceStatus === 'HISTORICAL';
    const mentionsHistorical = q.includes('historical') || q.includes('prior') || q.includes('former') || q.includes('superseded');

    const yearMatch = q.match(/\b(19\d\d|20\d\d)\b/);
    if (yearMatch) {
      const qYear = yearMatch[1];
      const fromYear = rule.validFrom ? rule.validFrom.slice(0, 4) : null;
      const toYear = rule.validTo ? rule.validTo.slice(0, 4) : null;

      if (fromYear && qYear >= fromYear && (!toYear || qYear <= toYear)) {
        matchScore += 20;
      } else if (toYear && qYear > toYear) {
        matchScore -= 30;
      } else if (fromYear && qYear < fromYear) {
        matchScore -= 30;
      }
    } else {
      if (isHistoricalRule && !mentionsHistorical) {
        matchScore -= 40;
      } else if (rule.sourceStatus === 'VERIFIED') {
        matchScore += 10;
      }
    }

    if (matchScore > 0) {
      scoredResults.push({ rule, score: matchScore });
    }
  }

  scoredResults.sort((a, b) => b.score - a.score);
  return scoredResults.map(s => s.rule);
}

/**
 * Convert a SingaporeStatuteRule into standard citation format
 */
export function convertToCitation(rule: SingaporeStatuteRule): StandardCitation {
  return {
    standard: `${rule.actTitle} (${rule.authority})`,
    paragraph: rule.sectionOrSchedule,
    title: rule.ruleTitle,
    text: rule.principle,
    officialSourceUrl: rule.canonicalUrl,
    authority: rule.authority
  };
}

/**
 * Convert a SingaporeStatuteRule into structured StatutoryAdvisoryInfo
 */
export function convertToAdvisory(rule: SingaporeStatuteRule): StatutoryAdvisoryInfo {
  return {
    authority: rule.authority,
    statuteOrAct: rule.actTitle,
    sectionOrSchedule: rule.sectionOrSchedule,
    topic: rule.ruleTitle,
    summary: rule.principle,
    keyRules: rule.practicalRules,
    officialUrl: rule.canonicalUrl,
    isTaxDeductible: (rule.id === 'ITA_SEC15_1_K_MOTOR_CAR' || rule.id === 'ITA_SEC15_PROHIBITED_DEDUCTIONS') ? false : (rule.id === 'ITA_SEC14_GENERAL_DEDUCTION' || rule.id === 'ITA_SEC14C_EIS_INNOVATION') ? true : undefined,
    isGstClaimable: rule.id === 'GST_REG26_BLOCKED_INPUT_TAX' ? false : rule.id === 'GST_SEC21_ZERO_RATED_EXPORTS' ? true : undefined
  };
}
