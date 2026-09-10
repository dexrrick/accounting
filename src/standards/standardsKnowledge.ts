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
    principle: 'At initial recognition, an entity measures a financial asset or financial liability at its fair value.',
    application: 'For equity investments classified as FVTPL, initial carrying value equals transaction price at fair value translated at spot rate.',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB'
  },
  IFRS9_EQUITY_CLASSIFICATION: {
    code: 'IFRS 9 / SFRS(I) 9 §4.1.4 & §5.7.5',
    sfrsCode: 'SFRS(I) 9 §4.1.4 & §5.7.5',
    ifrsCode: 'IFRS 9 §4.1.4 & §5.7.5',
    standardTitle: 'Classification of Equity Instruments',
    paragraph: '§4.1.4 & §5.7.5',
    principle: 'Investments in equity instruments are by default measured at Fair Value Through Profit or Loss (FVTPL). An irrevocable election may be made at initial recognition to present subsequent changes in OCI (FVTOCI).',
    application: 'Unless explicitly elected as FVTOCI at trade date, equity investments are categorized as FVTPL.',
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
    code: 'SFRS(I) 1-12 / IAS 12 §15 & §24',
    sfrsCode: 'SFRS(I) 1-12 §15 & §24',
    ifrsCode: 'IAS 12 §15 & §24',
    standardTitle: 'Income Taxes - Accounting vs Tax Bases & Deferred Tax',
    paragraph: '§15 & §24',
    principle: 'Deferred tax arises from temporary differences between the accounting carrying amounts of assets/liabilities and their corresponding tax bases under the Income Tax Act. Taxable temporary differences require Deferred Tax Liabilities; deductible temporary differences generate Deferred Tax Assets.',
    application: 'Accelerated tax capital allowances under Section 19A of the Income Tax Act exceed accounting depreciation, producing a taxable temporary difference: Dr. Deferred Tax Expense (P&L) | Cr. Deferred Tax Liability.',
    sourceAuthority: 'Accounting Standards Council Singapore & IASB'
  }
};

export function getCitation(ruleKey: keyof typeof STANDARDS_REPOSITORY, standardMode: AccountingStandard): StandardCitation {
  const rule = STANDARDS_REPOSITORY[ruleKey];
  return {
    standard: standardMode === 'SFRS_I' ? rule.sfrsCode : rule.ifrsCode,
    paragraph: rule.paragraph,
    title: rule.standardTitle,
    text: rule.principle,
    officialSourceUrl: standardMode === 'SFRS_I' ? 'https://www.acra.gov.sg/accountancy/accounting-standards' : 'https://www.ifrs.org'
  };
}
