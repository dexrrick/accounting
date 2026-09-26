import type { AccountingStandard, StandardCitation } from '../types/accounting';

export interface StandardRule {
  code: string;
  sfrsCode: string;
  ifrsCode: string;
  standardTitle: string;
  paragraph: string;
  principle: string;
  application: string;
  sourceAuthority: string;
  officialSourceUrl?: string;
  effectiveDate?: string;
  validFrom?: string;
  validTo?: string;
  lastVerifiedDate?: string;
  reviewAuditCycleDays?: number;
  supersededByRecordId?: string;
  historicalPredecessorRecordId?: string;
}

export const STANDARDS_REPOSITORY: Record<string, StandardRule> = {
  IAS1_EXPENSE_RECOGNITION: {
    code: 'IAS 1 / SFRS(I) 1-1 §27-§28',
    sfrsCode: 'SFRS(I) 1-1 §27-§28',
    ifrsCode: 'IAS 1 §27-§28',
    standardTitle: 'Accrual Basis & Operating Expense Recognition',
    paragraph: '§27-§28',
    principle: 'An entity shall prepare its financial statements using the accrual basis of accounting. Expenses are recognized in profit or loss when a decrease in future economic benefits related to a decrease in an asset or an increase of a liability has arisen that can be measured reliably.',
    application: 'Operating expenses (entertainment, utilities, marketing, rent, travel) are debited to P&L, matched with a credit to Cash/Bank or Accounts Payable.',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB'
  },
  IFRS9_INITIAL_MEASUREMENT: {
    code: 'IFRS 9 / SFRS(I) 9 §5.1.1',
    sfrsCode: 'SFRS(I) 9 §5.1.1',
    ifrsCode: 'IFRS 9 §5.1.1',
    standardTitle: 'Financial Instruments - Initial Measurement',
    paragraph: '§5.1.1',
    principle: 'At initial recognition, an entity measures a financial asset or financial liability at fair value. For an item not measured at fair value through profit or loss, directly attributable transaction costs are added to the initial fair value of a financial asset (and deducted for a financial liability). The separate trade-receivable expedient in paragraph 5.1.3 may apply where its conditions are met.',
    application: 'For a financial asset outside FVTPL and the paragraph 5.1.3 trade-receivable expedient, initial carrying amount is fair value plus directly attributable acquisition transaction costs. Transaction costs for an item measured at FVTPL are not included in its initial carrying amount. Do not create a journal counterparty or settlement account unless the transaction facts establish one.',
    sourceAuthority: 'IFRS Foundation',
    officialSourceUrl: 'https://www.ifrs.org/issued-standards/list-of-standards/ifrs-9-financial-instruments/',
    validFrom: '2018-01-01',
    lastVerifiedDate: '2026-09-25',
    reviewAuditCycleDays: 365
  },
  IFRS9_DEBT_CLASSIFICATION: {
    code: 'IFRS 9 / SFRS(I) 9 §4.1.1-§4.1.5',
    sfrsCode: 'SFRS(I) 9 §4.1.1-§4.1.5',
    ifrsCode: 'IFRS 9 §4.1.1-§4.1.5',
    standardTitle: 'Financial Assets - Business Model and Contractual Cash Flow Classification',
    paragraph: '§4.1.1-§4.1.5',
    principle: 'A financial asset is classified using both the entity’s business model for managing the asset and the asset’s contractual cash flow characteristics. A debt asset is measured at amortised cost when it is held within a business model whose objective is to collect contractual cash flows and its contractual terms give rise on specified dates to cash flows that are solely payments of principal and interest on the principal amount outstanding. A qualifying debt asset held in a business model achieved by both collecting contractual cash flows and selling is measured at fair value through other comprehensive income. Assets outside those categories are measured at fair value through profit or loss, subject to the applicable designation and scope requirements.',
    application: 'Do not infer the measurement category from the word “bond” or from management intent alone. Establish the business model and assess contractual cash flows against the SPPI condition. If either assessment is missing or inconclusive, request the relevant facts before concluding amortised cost, debt FVOCI or FVTPL. A qualifying fair value option designation may affect the otherwise applicable category.',
    sourceAuthority: 'IFRS Foundation; Singapore adoption by ASC/ACRA',
    officialSourceUrl: 'https://www.ifrs.org/issued-standards/list-of-standards/ifrs-9-financial-instruments/',
    validFrom: '2018-01-01',
    lastVerifiedDate: '2026-09-25',
    reviewAuditCycleDays: 365
  },
  IFRS9_EQUITY_CLASSIFICATION: {
    code: 'IFRS 9 / SFRS(I) 9 §4.1.4, §5.7.5-§5.7.6 & B5.7.1',
    sfrsCode: 'SFRS(I) 9 §4.1.4, §5.7.5-§5.7.6 & B5.7.1',
    ifrsCode: 'IFRS 9 §4.1.4, §5.7.5-§5.7.6 & B5.7.1',
    standardTitle: 'Classification of Equity Instruments',
    paragraph: '§4.1.4, §5.7.5-§5.7.6 & B5.7.1',
    principle: 'An investment in an equity instrument is measured at fair value through profit or loss unless the entity makes the irrevocable election at initial recognition to present subsequent changes in fair value in other comprehensive income for an investment that is neither held for trading nor contingent consideration recognised by an acquirer in a business combination within IFRS 3. Amounts accumulated in OCI for an elected investment are not subsequently reclassified to profit or loss on disposal; a transfer within equity may be made.',
    application: 'Confirm the instrument is an equity investment within the scope of IFRS 9, is not held for trading or qualifying contingent consideration, and that the irrevocable election was made at initial recognition. When those conditions are satisfied, report fair value changes in OCI and do not recycle the cumulative gain or loss to profit or loss when the investment is sold.',
    sourceAuthority: 'IFRS Foundation; Singapore adoption by ASC/ACRA',
    officialSourceUrl: 'https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2022/issued/part-a/ifrs-9-financial-instruments.pdf?bypass=on',
    validFrom: '2018-01-01',
    lastVerifiedDate: '2026-09-25',
    reviewAuditCycleDays: 365
  },
  IFRS9_ECL_GENERAL: {
    code: 'IFRS 9 / SFRS(I) 9 §5.5.1, §5.5.3-§5.5.5 & §5.5.17',
    sfrsCode: 'SFRS(I) 9 §5.5.1, §5.5.3-§5.5.5 & §5.5.17',
    ifrsCode: 'IFRS 9 §5.5.1, §5.5.3-§5.5.5 & §5.5.17',
    standardTitle: 'Expected Credit Losses - General Approach',
    paragraph: '§5.5.1, §5.5.3-§5.5.5 & §5.5.17',
    principle: 'Under the general impairment approach, a loss allowance is recognised for applicable financial assets. Subject to the exceptions and requirements in paragraphs 5.5.13-5.5.16, the loss allowance is measured at lifetime expected credit losses when credit risk has increased significantly since initial recognition and at 12-month expected credit losses when it has not. Expected credit losses are measured as an unbiased, probability-weighted amount reflecting a range of outcomes, the time value of money, and reasonable and supportable information available without undue cost or effort.',
    application: 'First establish that the instrument is within the general impairment approach and determine whether it is purchased or originated credit-impaired and whether credit risk has significantly increased since initial recognition. For a non-POCI asset with no significant increase, the horizon is 12-month ECL. Do not fabricate an amount when exposure, expected cash shortfalls and probability-weighted loss estimates are not supplied; request the data needed to measure ECL.',
    sourceAuthority: 'IFRS Foundation; Singapore adoption by ASC/ACRA',
    officialSourceUrl: 'https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2022/issued/part-a/ifrs-9-financial-instruments.pdf?bypass=on',
    validFrom: '2018-01-01',
    lastVerifiedDate: '2026-09-25',
    reviewAuditCycleDays: 365
  },
  SFRSI9_2026_CLASSIFICATION_AMENDMENTS: {
    code: 'SFRS(I) 9 / SFRS(I) 7 Classification and Measurement Amendments',
    sfrsCode: 'SFRS(I) 9',
    ifrsCode: 'IFRS 9',
    standardTitle: '2024 Classification and Measurement Amendments - Effective Date',
    paragraph: 'ASC announcement dated 4 October 2024',
    principle: 'The Accounting Standards Committee announced on 4 October 2024 that its amendments to SFRS(I) 9 and SFRS(I) 7 on classification and measurement are effective for annual reporting periods beginning on or after 1 January 2026.',
    application: 'An annual reporting period beginning on 1 January 2025 is before the mandatory effective date announced by ASC. State the applicable reporting-period start date when assessing mandatory application; do not describe these amendments as mandatorily effective before 1 January 2026.',
    sourceAuthority: 'Accounting Standards Committee / ACRA',
    officialSourceUrl: 'https://www.acra.gov.sg/news-events/news-announcements/833/',
    effectiveDate: '2026-01-01',
    // This record is the October 2024 ACRA announcement, which remains useful
    // evidence for a 2025 period even though the amendments take effect in 2026.
    validFrom: '2024-10-04',
    lastVerifiedDate: '2026-09-25',
    reviewAuditCycleDays: 90
  },
  SFRSI9_ADOPTION: {
    code: 'Singapore Financial Reporting Standards (International) - ASC/ACRA Issuance',
    sfrsCode: 'SFRS(I) 9',
    ifrsCode: 'IFRS 9',
    standardTitle: 'Singapore Adoption and Issuance of SFRS(I) Standards',
    paragraph: 'Financial reporting framework issued by the ASC',
    principle: 'SFRS(I)s are Singapore financial reporting standards issued by the Accounting Standards Committee. ACRA’s guide identifies the SFRS(I) framework and explains that the Singapore standards are based on IFRS Accounting Standards.',
    application: 'Use the relevant SFRS(I) edition and its Singapore effective date when answering for a Singapore reporting entity. IFRS Foundation material can support the corresponding IFRS principle, while ACRA identifies the local issued framework.',
    sourceAuthority: 'Accounting Standards Committee / ACRA',
    officialSourceUrl: 'https://www.acra.gov.sg/regulations/accounting-standards-financial-reporting-surveillance/accounting-standards/',
    lastVerifiedDate: '2026-09-25',
    reviewAuditCycleDays: 90
  },
  IFRS9_FVTPL_SUBSEQUENT: {
    code: 'IFRS 9 / SFRS(I) 9 §5.7.1',
    sfrsCode: 'SFRS(I) 9 §5.7.1',
    ifrsCode: 'IFRS 9 §5.7.1',
    standardTitle: 'FVTPL fair value gains and losses',
    paragraph: '§5.7.1',
    principle: 'A gain or loss on a financial asset measured at fair value is recognised in profit or loss unless a specified exception applies, including an elected FVOCI equity instrument.',
    application: 'Recognise changes in a FVTPL portfolio’s fair value in profit or loss.',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB'
  },
  IFRS9_EQUITY_DIVIDENDS: {
    code: 'IFRS 9 / SFRS(I) 9 §5.7.1A & §5.7.6',
    sfrsCode: 'SFRS(I) 9 §5.7.1A & §5.7.6',
    ifrsCode: 'IFRS 9 §5.7.1A & §5.7.6',
    standardTitle: 'Dividends on FVOCI equity investments',
    paragraph: '§5.7.1A & §5.7.6',
    principle: 'Dividends on elected FVOCI equity investments are recognised in profit or loss when the right to receive is established, economic benefits are probable, and the amount can be measured reliably, unless they clearly represent recovery of part of the investment cost.',
    application: 'A declared and received non-cash dividend is income when it is not a recovery of investment cost.',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB'
  },
  IAS21_INITIAL_FOREIGN_CURRENCY: {
    code: 'IAS 21 / SFRS(I) 1-21 §21',
    sfrsCode: 'SFRS(I) 1-21 §21',
    ifrsCode: 'IAS 21 §21',
    standardTitle: 'The Effects of Changes in Foreign Exchange Rates - Initial Spot Rate',
    paragraph: '§21',
    principle: 'A foreign currency transaction shall be recorded, on initial recognition in the functional currency, by applying the spot exchange rate at the transaction date.',
    application: 'Translates foreign currency costs into functional currency using the spot rate on the acquisition date (reference from ECB / Frankfurter API).',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB'
  },
  IAS21_NON_MONETARY_FVTPL_FX: {
    code: 'IAS 21 / SFRS(I) 1-21 §23(c) & §30',
    sfrsCode: 'SFRS(I) 1-21 §23(c) & §30',
    ifrsCode: 'IAS 21 §23(c) & §30',
    standardTitle: 'Subsequent Measurement & Foreign Exchange on Fair Value Items',
    paragraph: '§23(c) & §30',
    principle: 'When a gain or loss on a non-monetary item is recognized in profit or loss, any exchange component of that gain or loss is also recognized in profit or loss.',
    application: 'For FVTPL shares, companies can present either the combined fair value gain or explicitly separate the underlying capital gain and realized foreign exchange gain for management and audit clarity.',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB'
  },
  IAS21_MONETARY_ITEMS: {
    code: 'IAS 21 / SFRS(I) 1-21 §23(a) & §28',
    sfrsCode: 'SFRS(I) 1-21 §23(a) & §28',
    ifrsCode: 'IAS 21 §23(a) & §28',
    standardTitle: 'Monetary Items & Bank Balance Exchange Differences',
    paragraph: '§23(a) & §28',
    principle: 'Foreign currency monetary items (such as foreign currency bank balances, loans, and receivables) are retranslated at the closing rate at each reporting date. Exchange differences are recognized in profit or loss.',
    application: 'Cash balances held in USD bank accounts are monetary items subject to separate FX gain/loss entries upon settlement or reporting date revaluation.',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB'
  },
  IFRS16_LEASE_INCEPTION: {
    code: 'IFRS 16 / SFRS(I) 16 §22-§26',
    sfrsCode: 'SFRS(I) 16 §22-§26',
    ifrsCode: 'IFRS 16 §22-§26',
    standardTitle: 'Leases - Right-of-Use Asset & Lease Liability Inception',
    paragraph: '§22-§26',
    principle: 'At commencement date, a lessee shall recognize a right-of-use asset and a lease liability measured at the present value of the lease payments not paid at that date, discounted using the interest rate implicit in the lease (or incremental borrowing rate).',
    application: 'For a multi-year rental agreement, lessee must capitalize: Dr. Right-of-Use Asset | Cr. Lease Liability.',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB'
  },
  IFRS16_SUBSEQUENT_MEASUREMENT: {
    code: 'IFRS 16 / SFRS(I) 16 §29-§38',
    sfrsCode: 'SFRS(I) 16 §29-§38',
    ifrsCode: 'IFRS 16 §29-§38',
    standardTitle: 'Leases - Subsequent Depreciation & Interest Expense',
    paragraph: '§29-§38',
    principle: 'Subsequent to commencement, lessee depreciates the ROU asset over the lease term on a straight-line basis and recognizes interest expense on the lease liability using the effective interest method.',
    application: 'Each payment splits into: Dr. Lease Liability (principal) + Dr. Interest Expense (P&L) | Cr. Bank. ROU Asset is depreciated monthly: Dr. Depreciation Expense (P&L) | Cr. Accumulated Depreciation.',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB'
  },
  IAS16_PPE_RECOGNITION: {
    code: 'IAS 16 / SFRS(I) 1-16 §7 & §15',
    sfrsCode: 'SFRS(I) 1-16 §7 & §15',
    ifrsCode: 'IAS 16 §7 & §15',
    standardTitle: 'PPE - Recognition and Initial Measurement at Cost',
    paragraph: '§7 & §15',
    principle: 'An item of property, plant and equipment that qualifies for recognition as an asset shall be measured at its cost. Cost comprises purchase price (excluding trade discounts and recoverable sales taxes like input GST) and any directly attributable costs of bringing the asset to working condition.',
    application: 'New machinery is capitalized at SGD 100,000 (net of recoverable 9% input GST). Input GST of SGD 9,000 is recognized as a separate tax receivable.',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB'
  },
  IAS16_DEPRECIATION_CATCHUP: {
    code: 'IAS 16 / SFRS(I) 1-16 §50 & §55',
    sfrsCode: 'SFRS(I) 1-16 §50 & §55',
    ifrsCode: 'IAS 16 §50 & §55',
    standardTitle: 'PPE - Depreciation Ceasing on Derecognition',
    paragraph: '§50 & §55',
    principle: 'Depreciation of an asset ceases at the earlier of the date that the asset is classified as held for sale and the date that the asset is derecognised. Depreciation for the period up to the date of disposal must be recognized prior to computing gain or loss on disposal.',
    application: 'Record 3 months depreciation (Jan-Mar 2026) of SGD 2,500 prior to derecognition on 1 April 2026. Total accumulated depreciation is updated to SGD 22,500.',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB'
  },
  IAS16_DERECOGNITION: {
    code: 'IAS 16 / SFRS(I) 1-16 §67-§71',
    sfrsCode: 'SFRS(I) 1-16 §67-§71',
    ifrsCode: 'IAS 16 §67-§71',
    standardTitle: 'PPE - Derecognition and Gain or Loss on Disposal',
    paragraph: '§67-§71',
    principle: 'The carrying amount of an item of property, plant and equipment shall be derecognised on disposal. The gain or loss arising from the derecognition shall be included in profit or loss when the item is derecognised. The gain or loss is determined as the difference between net disposal proceeds and carrying amount.',
    application: 'Carrying amount of old machine (Cost SGD 50,000 less Acc Depr SGD 22,500 = SGD 27,500) derecognized. Net trade-in proceeds (SGD 20,000) results in a Loss on Disposal of SGD 7,500 debited to P&L.',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB'
  },
  SINGAPORE_GST_TRADE_IN: {
    code: 'Singapore GST Act / IRAS e-Tax Guide',
    sfrsCode: 'IRAS e-Tax Guide (Trade-ins)',
    ifrsCode: 'Singapore GST Act §10',
    standardTitle: 'IRAS GST Treatment on Trade-In Transactions',
    paragraph: 'Trade-in Rules',
    principle: 'Under Singapore GST law, a trade-in involves two separate taxable supplies. A GST-registered buyer must account for output tax (9%) on the agreed trade-in value of the old asset disposed of, and can claim input tax (9%) on the purchase of the new asset.',
    application: 'Agreed trade-in SGD 21,800 is inclusive of 9% GST: Net proceeds = SGD 20,000, Output GST = SGD 1,800. Input GST on new machine = SGD 9,000.',
    sourceAuthority: 'Inland Revenue Authority of Singapore (IRAS)'
  },
  IFRS9_LOAN_UNEXPIRED_INTEREST: {
    code: 'IFRS 9 / SFRS(I) 9 §5.1.1',
    sfrsCode: 'SFRS(I) 9 §5.1.1',
    ifrsCode: 'IFRS 9 §5.1.1',
    standardTitle: 'Borrowings - Initial Measurement & Unexpired Loan Interest Contra Account',
    paragraph: '§5.1.1',
    principle: 'Financial liabilities are initially measured at fair value. When commercial loans are recorded at gross nominal note amount including flat unearned interest, the unearned interest is presented upfront as a contra-liability account (Unexpired Loan Interest / Deferred Finance Charge) offset against the loan payable.',
    application: 'Equipment loan principal of SGD 57,200 + 2-year 5% flat interest of SGD 5,720 = Gross Loan Payable of SGD 62,920. Unexpired Loan Interest of SGD 5,720 is debited as contra-liability, giving net initial carrying value of SGD 57,200.',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB'
  },
  IAS16_TRADE_DISCOUNT: {
    code: 'IAS 16 / SFRS(I) 1-16 §16(a)',
    sfrsCode: 'SFRS(I) 1-16 §16(a)',
    ifrsCode: 'IAS 16 §16(a)',
    standardTitle: 'PPE - Deductibility of Trade Discounts from Cost',
    paragraph: '§16(a)',
    principle: 'The cost of an item of property, plant and equipment comprises its purchase price, including import duties and non-refundable purchase taxes, after deducting trade discounts and rebates. Trade discounts are not recognized as income or expense.',
    application: 'Trade discount of 10% (SGD 2,000) is deducted immediately from list price (SGD 20,000). Office equipment is recognized at net cost of SGD 18,000. 9% Input GST is computed on the net price (SGD 1,620).',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB'
  },
  IFRS9_DERECOGNITION_LIABILITY: {
    code: 'IFRS 9 / SFRS(I) 9 §3.3.1',
    sfrsCode: 'SFRS(I) 9 §3.3.1',
    ifrsCode: 'IFRS 9 §3.3.1',
    standardTitle: 'Derecognition of Financial Liabilities on Settlement',
    paragraph: '§3.3.1',
    principle: 'An entity shall remove a financial liability (or a part of a financial liability) from its statement of financial position when, and only when, it is extinguished—ie when the obligation specified in the contract is discharged or cancelled or expires.',
    application: 'Payment of trade payables via bank transfer extinguishes the contractual obligation: Dr. Trade Payables | Cr. Cash at Bank.',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB'
  },
  SFRS_I_1_38_INTANGIBLES: {
    code: 'SFRS(I) 1-38 / IAS 38 §54 & §57',
    sfrsCode: 'SFRS(I) 1-38 §54 & §57',
    ifrsCode: 'IAS 38 §54 & §57',
    standardTitle: 'Intangible Assets - Capitalisation of Development Costs vs Research Expense',
    paragraph: '§54 & §57',
    principle: 'No intangible asset arising from research shall be recognised; expenditure on research must be expensed when incurred (§54). Development expenditure shall be capitalised if and only if an entity demonstrates all 6 cumulative criteria under §57: technical feasibility, intention to complete, ability to use/sell, probable future economic benefits, resource availability, and reliable cost measurement.',
    application: 'Research stage project costs must be debited to P&L. Once all 6 development criteria are met, development payroll and directly attributable expenditure are capitalised as an Intangible Asset: Dr. Intangible Assets - Software Development | Cr. Cash / Bank / Payables.',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB'
  },
  SFRS_I_1_2_INVENTORIES: {
    code: 'SFRS(I) 1-2 / IAS 2 §9 & §28',
    sfrsCode: 'SFRS(I) 1-2 §9 & §28',
    ifrsCode: 'IAS 2 §9 & §28',
    standardTitle: 'Inventories - Lower of Cost and Net Realizable Value (NRV)',
    paragraph: '§9 & §28',
    principle: 'Inventories shall be measured at the lower of cost and net realisable value (NRV). When NRV falls below cost due to damage, obsolescence, or declining market price, the carrying amount is written down to NRV in profit or loss.',
    application: 'End-of-period review comparing historical cost against net realizable value: Dr. Inventory Write-down / Cost of Sales | Cr. Inventory / Allowance for NRV.',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB'
  },
  SFRS_I_15_REVENUE: {
    code: 'SFRS(I) 15 / IFRS 15 §31',
    sfrsCode: 'SFRS(I) 15 §31',
    ifrsCode: 'IFRS 15 §31',
    standardTitle: 'Revenue from Contracts with Customers - 5-Step Model & Transfer of Control',
    paragraph: '§31',
    principle: 'An entity shall recognise revenue when (or as) the entity satisfies a performance obligation by transferring a promised good or service (control of an asset) to a customer. Revenue is recognized either over time (§35) or at a point in time (§38) following the 5-step recognition model.',
    application: 'Determining timing of billing vs delivery of goods/services: Dr. Trade Receivables / Contract Asset | Cr. Revenue / Contract Liability.',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB'
  },
  IFRS15_RIGHT_OF_RETURN: {
    code: 'SFRS(I) 15 / IFRS 15 B21-B25',
    sfrsCode: 'SFRS(I) 15 B21-B25',
    ifrsCode: 'IFRS 15 B21-B25',
    standardTitle: 'Revenue - right of return',
    paragraph: 'B21-B25',
    principle: 'Recognise revenue for products not expected to be returned, a refund liability for expected refunds, and an asset for the right to recover returned products measured by reference to their former carrying amount.',
    application: 'Separate expected returns from revenue and cost of sales when control transfers with a return right.',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB'
  },
  IAS32_TREASURY_SHARES: {
    code: 'IAS 32 / SFRS(I) 1-32 §33',
    sfrsCode: 'SFRS(I) 1-32 §33',
    ifrsCode: 'IAS 32 §33',
    standardTitle: 'Treasury shares',
    paragraph: '§33',
    principle: 'Treasury shares are deducted from equity. No gain or loss is recognised in profit or loss on purchase, sale, issue or cancellation of an entity’s own equity instruments; consideration is recognised directly in equity.',
    application: 'Reissue proceeds and any difference from carrying cost remain within equity.',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB'
  },
  IAS32_EQUITY_ISSUANCE: {
    code: 'IAS 32 / SFRS(I) 1-32 §16',
    sfrsCode: 'SFRS(I) 1-32 §16',
    ifrsCode: 'IAS 32 §16',
    standardTitle: 'Classification of issued ordinary shares as equity',
    paragraph: '§16',
    principle: 'An instrument is classified as equity when it contains no contractual obligation to deliver cash or another financial asset and, for settlement in the entity’s own instruments, meets the applicable fixed-for-fixed condition.',
    application: 'Cash received for newly issued ordinary shares is recognised in share capital when the shares are equity instruments.',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB'
  },
  IRAS_IMPORT_GST: {
    code: 'IRAS GST - Importing of Goods',
    sfrsCode: 'IRAS GST - Importing of Goods',
    ifrsCode: 'IRAS GST - Importing of Goods',
    standardTitle: 'Singapore import GST input tax',
    paragraph: 'Claiming GST paid on imports',
    principle: 'Subject to the input-tax conditions, GST paid to Singapore Customs on imports may be claimed using the import permit showing the business as importer.',
    application: 'Record Customs-paid import GST separately from the foreign supplier payable.',
    sourceAuthority: 'IRAS',
    officialSourceUrl: 'https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/claiming-gst-%28input-tax%29/importing-of-goods'
  },
  IRAS_OUTPUT_GST: {
    code: 'IRAS GST - Invoicing Customers',
    sfrsCode: 'IRAS GST - Invoicing Customers',
    ifrsCode: 'IRAS GST - Invoicing Customers',
    standardTitle: 'Singapore output GST and returned goods',
    paragraph: 'Invoicing and credit notes',
    principle: 'A tax invoice shows output tax on a taxable supply. Returned goods are adjusted through a credit note with the corresponding tax amount.',
    application: 'At the original invoice, keep output GST distinct from the IFRS 15 estimated refund liability.',
    sourceAuthority: 'IRAS',
    officialSourceUrl: 'https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/basics-of-gst/invoicing-price-display-and-record-keeping/invoicing-customers'
  },
  SFRS_I_1_37_PROVISIONS: {
    code: 'SFRS(I) 1-37 / IAS 37 §14',
    sfrsCode: 'SFRS(I) 1-37 §14',
    ifrsCode: 'IAS 37 §14',
    standardTitle: 'Provisions, Contingent Liabilities and Contingent Assets',
    paragraph: '§14',
    principle: 'A provision shall be recognised when: (a) an entity has a present obligation (legal or constructive) as a result of a past event; (b) it is probable that an outflow of resources will be required to settle the obligation; and (c) a reliable estimate can be made.',
    application: 'Warranties, legal settlements, and restructuring provisions meeting all 3 tests: Dr. Provision Expense (P&L) | Cr. Provision for Obligations (Liability).',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB'
  },
  SFRS_I_1_12_INCOME_TAXES: {
    code: 'SFRS(I) 1-12 / IAS 12 §15, §17(b) & §24',
    sfrsCode: 'SFRS(I) 1-12 §15, §17(b) & §24',
    ifrsCode: 'IAS 12 §15, §17(b) & §24',
    standardTitle: 'Income Taxes - Accounting vs Tax Bases & Deferred Tax',
    paragraph: '§15, §17(b) & §24',
    principle: 'Deferred tax arises from temporary differences between the accounting carrying amounts of assets/liabilities and their corresponding tax bases under the Income Tax Act. Taxable temporary differences require Deferred Tax Liabilities; deductible temporary differences generate Deferred Tax Assets.',
    application: 'Accelerated tax capital allowances under Section 19A of the Income Tax Act exceed accounting depreciation, producing a taxable temporary difference: Dr. Deferred Tax Expense (P&L) | Cr. Deferred Tax Liability.',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB'
  },
  SFRS_I_1_36_IMPAIRMENT: {
    code: 'SFRS(I) 1-36 / IAS 36 §9, §18, §59 & §114',
    sfrsCode: 'SFRS(I) 1-36 §9, §18, §59 & §114',
    ifrsCode: 'IAS 36 §9, §18, §59 & §114',
    standardTitle: 'Impairment of Assets - Recoverable Amount & Loss Recognition',
    paragraph: '§9, §18, §59 & §114',
    principle: 'An entity shall assess at the end of each reporting period whether there is any indication that an asset may be impaired (§9). If any such indication exists, the entity shall estimate the recoverable amount of the asset, which is the higher of its fair value less costs of disposal and its value in use (§18). If the recoverable amount is less than the carrying amount, an impairment loss shall be recognized immediately in profit or loss (§59). An impairment loss recognized in prior periods for an asset other than goodwill shall be reversed if there has been a change in estimates used to determine the recoverable amount (§114).',
    application: 'Annual impairment testing of machinery, goodwill, and intangible assets: Dr. Impairment Loss (P&L) | Cr. Accumulated Impairment Loss (contra-asset).',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB',
    validFrom: '2018-01-01',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },
  SFRS_I_1_20_GOVERNMENT_GRANTS: {
    code: 'SFRS(I) 1-20 / IAS 20 §7, §12, §24 & §29',
    sfrsCode: 'SFRS(I) 1-20 §7, §12, §24 & §29',
    ifrsCode: 'IAS 20 §7, §12, §24 & §29',
    standardTitle: 'Accounting for Government Grants and Disclosure of Government Assistance',
    paragraph: '§7, §12, §24 & §29',
    principle: 'Government grants shall not be recognized until there is reasonable assurance that the entity will comply with conditions attaching to them and the grants will be received (§7). Grants shall be recognized in profit or loss on a systematic basis over the periods in which the entity recognizes as expenses the related costs which the grants are intended to compensate (§12). Capital grants related to assets may be presented either as deferred income or by deducting the grant in arriving at the carrying amount of the asset (§24). Operating grants (e.g. wage credits, hiring incentives) may be presented as other income or deducted from the related expense (§29).',
    application: 'Singapore wage subsidies (Jobs Support Scheme / Jobs Growth Incentive): Dr. Cash at Bank | Cr. Other Operating Income (or Cr. Staff Salaries & Wages Expense). Capital equipment grants: Dr. Cash at Bank | Cr. Deferred Capital Grant (Liability).',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB',
    validFrom: '2018-01-01',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },
  SFRS_I_1_23_BORROWING_COSTS: {
    code: 'SFRS(I) 1-23 / IAS 23 §1, §5 & §8',
    sfrsCode: 'SFRS(I) 1-23 §1, §5 & §8',
    ifrsCode: 'IAS 23 §1, §5 & §8',
    standardTitle: 'Borrowing Costs - Mandatory Capitalisation on Qualifying Assets',
    paragraph: '§1, §5 & §8',
    principle: 'Borrowing costs that are directly attributable to the acquisition, construction or production of a qualifying asset form part of the cost of that asset (§1, §8). Other borrowing costs are recognized as an expense in the period in which they are incurred. A qualifying asset is an asset that necessarily takes a substantial period of time to get ready for its intended use or sale (§5).',
    application: 'Construction of commercial property, plant, or specialized IT platforms taking >12 months: Dr. Construction-in-Progress (Asset) | Cr. Bank / Interest Payable. Borrowing costs on routine short-term inventories are expensed immediately.',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB',
    validFrom: '2018-01-01',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },
  SFRS_I_1_10_EVENTS_AFTER_REPORTING: {
    code: 'SFRS(I) 1-10 / IAS 10 §3, §8, §10 & §12',
    sfrsCode: 'SFRS(I) 1-10 §3, §8, §10 & §12',
    ifrsCode: 'IAS 10 §3, §8, §10 & §12',
    standardTitle: 'Events After the Reporting Period - Adjusting vs Non-Adjusting Events & Dividends',
    paragraph: '§3, §8, §10 & §12',
    principle: 'Events after the reporting period are those events, favourable and unfavourable, that occur between the end of the reporting period and the date when the financial statements are authorised for issue (§3). An entity shall adjust the amounts recognized in its financial statements to reflect adjusting events (evidence of conditions that existed at the end of the reporting period, §8). An entity shall not adjust amounts for non-adjusting events (indicative of conditions that arose after the reporting period, §10). If an entity declares dividends to holders of equity instruments after the reporting period, the entity shall not recognize those dividends as a liability at the end of the reporting period (§12).',
    application: 'Bankruptcy of a major customer shortly after FYE confirming uncollectibility of year-end trade receivable: Adjusting event requiring retrospective provision adjustment under §8. Dividends declared in March for prior December FYE: Non-adjusting disclosure note only, no liability recorded at 31 Dec (§12).',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB',
    validFrom: '2018-01-01',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  },
  SFRS_I_1_8_POLICIES_ESTIMATES_ERRORS: {
    code: 'SFRS(I) 1-8 / IAS 8 §14, §19, §32 & §42',
    sfrsCode: 'SFRS(I) 1-8 §14, §19, §32 & §42',
    ifrsCode: 'IAS 8 §14, §19, §32 & §42',
    standardTitle: 'Accounting Policies, Changes in Accounting Estimates and Errors',
    paragraph: '§14, §19, §32 & §42',
    principle: 'An entity shall change an accounting policy only if the change is required by an SFRS(I) or results in more reliable and relevant information (§14). Changes in accounting policy are accounted for retrospectively (§19). The effect of a change in an accounting estimate (e.g. useful life, residual value, bad debt allowance percentage) shall be recognized prospectively by including it in profit or loss in the period of change and future periods (§32). Material prior period errors must be corrected retrospectively in the first set of financial statements authorised for issue after their discovery by restating comparative amounts (§42).',
    application: 'Revising straight-line depreciation useful life from 5 to 8 years is a prospective estimate change (§32). Uncovering unrecorded prior-year supplier invoices requires retrospective restatement of opening retained earnings (§42).',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB',
    validFrom: '2018-01-01',
    lastVerifiedDate: '2026-09-01',
    reviewAuditCycleDays: 365
  }
};

export function getCitation(ruleKey: keyof typeof STANDARDS_REPOSITORY, standardMode: AccountingStandard): StandardCitation {
  const rule = STANDARDS_REPOSITORY[ruleKey];
  return {
    standard: standardMode === 'SFRS_I' ? rule.sfrsCode : rule.ifrsCode,
    paragraph: rule.paragraph,
    title: rule.standardTitle,
    text: rule.principle,
    // A rule without a recorded source must not acquire a plausible-looking URL.
    officialSourceUrl: rule.officialSourceUrl
  };
}
