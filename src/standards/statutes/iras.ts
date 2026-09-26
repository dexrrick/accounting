import type { SingaporeStatuteRule } from './types';export const IRAS_STATUTE_RULES: Record<string, SingaporeStatuteRule> = {  // -------------------------------------------------------------
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
    canonicalUrl: 'https://sso.agc.gov.sg/Act/ITA1947?ProvIds=pr14-',
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
