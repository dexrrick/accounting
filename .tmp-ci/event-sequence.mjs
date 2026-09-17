// src/utils/dateUtils.ts
function formatSingaporeDate(dateInput) {
  if (!dateInput) return "";
  let str;
  if (typeof dateInput === "string") {
    str = dateInput.trim();
  } else if (dateInput instanceof Date) {
    if (isNaN(dateInput.getTime())) return "";
    str = dateInput.toISOString();
  } else {
    str = String(dateInput);
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    const parts = str.split("/");
    return `${parts[0].padStart(2, "0")}/${parts[1].padStart(2, "0")}/${parts[2]}`;
  }
  const ymdMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymdMatch) {
    const [, y, m, d2] = ymdMatch;
    return `${d2.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
  }
  const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmyMatch) {
    const [, d2, m, y] = dmyMatch;
    return `${d2.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }
  return str;
}

// src/standards/standardsKnowledge.ts
var STANDARDS_REPOSITORY = {
  IAS1_EXPENSE_RECOGNITION: {
    code: "IAS 1 / SFRS(I) 1-1 \xA727-\xA728",
    sfrsCode: "SFRS(I) 1-1 \xA727-\xA728",
    ifrsCode: "IAS 1 \xA727-\xA728",
    standardTitle: "Accrual Basis & Operating Expense Recognition",
    paragraph: "\xA727-\xA728",
    principle: "An entity shall prepare its financial statements using the accrual basis of accounting. Expenses are recognized in profit or loss when a decrease in future economic benefits related to a decrease in an asset or an increase of a liability has arisen that can be measured reliably.",
    application: "Operating expenses (entertainment, utilities, marketing, rent, travel) are debited to P&L, matched with a credit to Cash/Bank or Accounts Payable.",
    sourceAuthority: "Accounting Standards Council Singapore & IASB"
  },
  IFRS9_INITIAL_MEASUREMENT: {
    code: "IFRS 9 / SFRS(I) 9 \xA75.1.1",
    sfrsCode: "SFRS(I) 9 \xA75.1.1",
    ifrsCode: "IFRS 9 \xA75.1.1",
    standardTitle: "Financial Instruments - Initial Measurement",
    paragraph: "\xA75.1.1",
    principle: "At initial recognition, an entity measures a financial asset or financial liability at its fair value.",
    application: "For equity investments classified as FVTPL, initial carrying value equals transaction price at fair value translated at spot rate.",
    sourceAuthority: "Accounting Standards Council Singapore & IASB"
  },
  IFRS9_EQUITY_CLASSIFICATION: {
    code: "IFRS 9 / SFRS(I) 9 \xA74.1.4 & \xA75.7.5",
    sfrsCode: "SFRS(I) 9 \xA74.1.4 & \xA75.7.5",
    ifrsCode: "IFRS 9 \xA74.1.4 & \xA75.7.5",
    standardTitle: "Classification of Equity Instruments",
    paragraph: "\xA74.1.4 & \xA75.7.5",
    principle: "Investments in equity instruments are by default measured at Fair Value Through Profit or Loss (FVTPL). An irrevocable election may be made at initial recognition to present subsequent changes in OCI (FVTOCI).",
    application: "Unless explicitly elected as FVTOCI at trade date, equity investments are categorized as FVTPL.",
    sourceAuthority: "Accounting Standards Council Singapore & IASB"
  },
  IAS21_INITIAL_FOREIGN_CURRENCY: {
    code: "IAS 21 / SFRS(I) 1-21 \xA721",
    sfrsCode: "SFRS(I) 1-21 \xA721",
    ifrsCode: "IAS 21 \xA721",
    standardTitle: "The Effects of Changes in Foreign Exchange Rates - Initial Spot Rate",
    paragraph: "\xA721",
    principle: "A foreign currency transaction shall be recorded, on initial recognition in the functional currency, by applying the spot exchange rate at the transaction date.",
    application: "Translates foreign currency costs into functional currency using the spot rate on the acquisition date (reference from ECB / Frankfurter API).",
    sourceAuthority: "Accounting Standards Council Singapore & IASB"
  },
  IAS21_NON_MONETARY_FVTPL_FX: {
    code: "IAS 21 / SFRS(I) 1-21 \xA723(c) & \xA730",
    sfrsCode: "SFRS(I) 1-21 \xA723(c) & \xA730",
    ifrsCode: "IAS 21 \xA723(c) & \xA730",
    standardTitle: "Subsequent Measurement & Foreign Exchange on Fair Value Items",
    paragraph: "\xA723(c) & \xA730",
    principle: "When a gain or loss on a non-monetary item is recognized in profit or loss, any exchange component of that gain or loss is also recognized in profit or loss.",
    application: "For FVTPL shares, companies can present either the combined fair value gain or explicitly separate the underlying capital gain and realized foreign exchange gain for management and audit clarity.",
    sourceAuthority: "Accounting Standards Council Singapore & IASB"
  },
  IAS21_MONETARY_ITEMS: {
    code: "IAS 21 / SFRS(I) 1-21 \xA723(a) & \xA728",
    sfrsCode: "SFRS(I) 1-21 \xA723(a) & \xA728",
    ifrsCode: "IAS 21 \xA723(a) & \xA728",
    standardTitle: "Monetary Items & Bank Balance Exchange Differences",
    paragraph: "\xA723(a) & \xA728",
    principle: "Foreign currency monetary items (such as foreign currency bank balances, loans, and receivables) are retranslated at the closing rate at each reporting date. Exchange differences are recognized in profit or loss.",
    application: "Cash balances held in USD bank accounts are monetary items subject to separate FX gain/loss entries upon settlement or reporting date revaluation.",
    sourceAuthority: "Accounting Standards Council Singapore & IASB"
  },
  IFRS16_LEASE_INCEPTION: {
    code: "IFRS 16 / SFRS(I) 16 \xA722-\xA726",
    sfrsCode: "SFRS(I) 16 \xA722-\xA726",
    ifrsCode: "IFRS 16 \xA722-\xA726",
    standardTitle: "Leases - Right-of-Use Asset & Lease Liability Inception",
    paragraph: "\xA722-\xA726",
    principle: "At commencement date, a lessee shall recognize a right-of-use asset and a lease liability measured at the present value of the lease payments not paid at that date, discounted using the interest rate implicit in the lease (or incremental borrowing rate).",
    application: "For a multi-year rental agreement, lessee must capitalize: Dr. Right-of-Use Asset | Cr. Lease Liability.",
    sourceAuthority: "Accounting Standards Council Singapore & IASB"
  },
  IFRS16_SUBSEQUENT_MEASUREMENT: {
    code: "IFRS 16 / SFRS(I) 16 \xA729-\xA738",
    sfrsCode: "SFRS(I) 16 \xA729-\xA738",
    ifrsCode: "IFRS 16 \xA729-\xA738",
    standardTitle: "Leases - Subsequent Depreciation & Interest Expense",
    paragraph: "\xA729-\xA738",
    principle: "Subsequent to commencement, lessee depreciates the ROU asset over the lease term on a straight-line basis and recognizes interest expense on the lease liability using the effective interest method.",
    application: "Each payment splits into: Dr. Lease Liability (principal) + Dr. Interest Expense (P&L) | Cr. Bank. ROU Asset is depreciated monthly: Dr. Depreciation Expense (P&L) | Cr. Accumulated Depreciation.",
    sourceAuthority: "Accounting Standards Council Singapore & IASB"
  },
  IAS16_PPE_RECOGNITION: {
    code: "IAS 16 / SFRS(I) 1-16 \xA77 & \xA715",
    sfrsCode: "SFRS(I) 1-16 \xA77 & \xA715",
    ifrsCode: "IAS 16 \xA77 & \xA715",
    standardTitle: "PPE - Recognition and Initial Measurement at Cost",
    paragraph: "\xA77 & \xA715",
    principle: "An item of property, plant and equipment that qualifies for recognition as an asset shall be measured at its cost. Cost comprises purchase price (excluding trade discounts and recoverable sales taxes like input GST) and any directly attributable costs of bringing the asset to working condition.",
    application: "New machinery is capitalized at SGD 100,000 (net of recoverable 9% input GST). Input GST of SGD 9,000 is recognized as a separate tax receivable.",
    sourceAuthority: "Accounting Standards Council Singapore & IASB"
  },
  IAS16_DEPRECIATION_CATCHUP: {
    code: "IAS 16 / SFRS(I) 1-16 \xA750 & \xA755",
    sfrsCode: "SFRS(I) 1-16 \xA750 & \xA755",
    ifrsCode: "IAS 16 \xA750 & \xA755",
    standardTitle: "PPE - Depreciation Ceasing on Derecognition",
    paragraph: "\xA750 & \xA755",
    principle: "Depreciation of an asset ceases at the earlier of the date that the asset is classified as held for sale and the date that the asset is derecognised. Depreciation for the period up to the date of disposal must be recognized prior to computing gain or loss on disposal.",
    application: "Record 3 months depreciation (Jan-Mar 2026) of SGD 2,500 prior to derecognition on 1 April 2026. Total accumulated depreciation is updated to SGD 22,500.",
    sourceAuthority: "Accounting Standards Council Singapore & IASB"
  },
  IAS16_DERECOGNITION: {
    code: "IAS 16 / SFRS(I) 1-16 \xA767-\xA771",
    sfrsCode: "SFRS(I) 1-16 \xA767-\xA771",
    ifrsCode: "IAS 16 \xA767-\xA771",
    standardTitle: "PPE - Derecognition and Gain or Loss on Disposal",
    paragraph: "\xA767-\xA771",
    principle: "The carrying amount of an item of property, plant and equipment shall be derecognised on disposal. The gain or loss arising from the derecognition shall be included in profit or loss when the item is derecognised. The gain or loss is determined as the difference between net disposal proceeds and carrying amount.",
    application: "Carrying amount of old machine (Cost SGD 50,000 less Acc Depr SGD 22,500 = SGD 27,500) derecognized. Net trade-in proceeds (SGD 20,000) results in a Loss on Disposal of SGD 7,500 debited to P&L.",
    sourceAuthority: "Accounting Standards Council Singapore & IASB"
  },
  SINGAPORE_GST_TRADE_IN: {
    code: "Singapore GST Act / IRAS e-Tax Guide",
    sfrsCode: "IRAS e-Tax Guide (Trade-ins)",
    ifrsCode: "Singapore GST Act \xA710",
    standardTitle: "IRAS GST Treatment on Trade-In Transactions",
    paragraph: "Trade-in Rules",
    principle: "Under Singapore GST law, a trade-in involves two separate taxable supplies. A GST-registered buyer must account for output tax (9%) on the agreed trade-in value of the old asset disposed of, and can claim input tax (9%) on the purchase of the new asset.",
    application: "Agreed trade-in SGD 21,800 is inclusive of 9% GST: Net proceeds = SGD 20,000, Output GST = SGD 1,800. Input GST on new machine = SGD 9,000.",
    sourceAuthority: "Inland Revenue Authority of Singapore (IRAS)"
  },
  IFRS9_LOAN_UNEXPIRED_INTEREST: {
    code: "IFRS 9 / SFRS(I) 9 \xA75.1.1",
    sfrsCode: "SFRS(I) 9 \xA75.1.1",
    ifrsCode: "IFRS 9 \xA75.1.1",
    standardTitle: "Borrowings - Initial Measurement & Unexpired Loan Interest Contra Account",
    paragraph: "\xA75.1.1",
    principle: "Financial liabilities are initially measured at fair value. When commercial loans are recorded at gross nominal note amount including flat unearned interest, the unearned interest is presented upfront as a contra-liability account (Unexpired Loan Interest / Deferred Finance Charge) offset against the loan payable.",
    application: "Equipment loan principal of SGD 57,200 + 2-year 5% flat interest of SGD 5,720 = Gross Loan Payable of SGD 62,920. Unexpired Loan Interest of SGD 5,720 is debited as contra-liability, giving net initial carrying value of SGD 57,200.",
    sourceAuthority: "Accounting Standards Council Singapore & IASB"
  },
  IAS16_TRADE_DISCOUNT: {
    code: "IAS 16 / SFRS(I) 1-16 \xA716(a)",
    sfrsCode: "SFRS(I) 1-16 \xA716(a)",
    ifrsCode: "IAS 16 \xA716(a)",
    standardTitle: "PPE - Deductibility of Trade Discounts from Cost",
    paragraph: "\xA716(a)",
    principle: "The cost of an item of property, plant and equipment comprises its purchase price, including import duties and non-refundable purchase taxes, after deducting trade discounts and rebates. Trade discounts are not recognized as income or expense.",
    application: "Trade discount of 10% (SGD 2,000) is deducted immediately from list price (SGD 20,000). Office equipment is recognized at net cost of SGD 18,000. 9% Input GST is computed on the net price (SGD 1,620).",
    sourceAuthority: "Accounting Standards Council Singapore & IASB"
  },
  IFRS9_DERECOGNITION_LIABILITY: {
    code: "IFRS 9 / SFRS(I) 9 \xA73.3.1",
    sfrsCode: "SFRS(I) 9 \xA73.3.1",
    ifrsCode: "IFRS 9 \xA73.3.1",
    standardTitle: "Derecognition of Financial Liabilities on Settlement",
    paragraph: "\xA73.3.1",
    principle: "An entity shall remove a financial liability (or a part of a financial liability) from its statement of financial position when, and only when, it is extinguished\u2014ie when the obligation specified in the contract is discharged or cancelled or expires.",
    application: "Payment of trade payables via bank transfer extinguishes the contractual obligation: Dr. Trade Payables | Cr. Cash at Bank.",
    sourceAuthority: "Accounting Standards Council Singapore & IASB"
  },
  SFRS_I_1_38_INTANGIBLES: {
    code: "SFRS(I) 1-38 / IAS 38 \xA754 & \xA757",
    sfrsCode: "SFRS(I) 1-38 \xA754 & \xA757",
    ifrsCode: "IAS 38 \xA754 & \xA757",
    standardTitle: "Intangible Assets - Capitalisation of Development Costs vs Research Expense",
    paragraph: "\xA754 & \xA757",
    principle: "No intangible asset arising from research shall be recognised; expenditure on research must be expensed when incurred (\xA754). Development expenditure shall be capitalised if and only if an entity demonstrates all 6 cumulative criteria under \xA757: technical feasibility, intention to complete, ability to use/sell, probable future economic benefits, resource availability, and reliable cost measurement.",
    application: "Research stage project costs must be debited to P&L. Once all 6 development criteria are met, development payroll and directly attributable expenditure are capitalised as an Intangible Asset: Dr. Intangible Assets - Software Development | Cr. Cash / Bank / Payables.",
    sourceAuthority: "Accounting Standards Council Singapore & IASB"
  },
  SFRS_I_1_2_INVENTORIES: {
    code: "SFRS(I) 1-2 / IAS 2 \xA79 & \xA728",
    sfrsCode: "SFRS(I) 1-2 \xA79 & \xA728",
    ifrsCode: "IAS 2 \xA79 & \xA728",
    standardTitle: "Inventories - Lower of Cost and Net Realizable Value (NRV)",
    paragraph: "\xA79 & \xA728",
    principle: "Inventories shall be measured at the lower of cost and net realisable value (NRV). When NRV falls below cost due to damage, obsolescence, or declining market price, the carrying amount is written down to NRV in profit or loss.",
    application: "End-of-period review comparing historical cost against net realizable value: Dr. Inventory Write-down / Cost of Sales | Cr. Inventory / Allowance for NRV.",
    sourceAuthority: "Accounting Standards Council Singapore & IASB"
  },
  SFRS_I_15_REVENUE: {
    code: "SFRS(I) 15 / IFRS 15 \xA731",
    sfrsCode: "SFRS(I) 15 \xA731",
    ifrsCode: "IFRS 15 \xA731",
    standardTitle: "Revenue from Contracts with Customers - 5-Step Model & Transfer of Control",
    paragraph: "\xA731",
    principle: "An entity shall recognise revenue when (or as) the entity satisfies a performance obligation by transferring a promised good or service (control of an asset) to a customer. Revenue is recognized either over time (\xA735) or at a point in time (\xA738) following the 5-step recognition model.",
    application: "Determining timing of billing vs delivery of goods/services: Dr. Trade Receivables / Contract Asset | Cr. Revenue / Contract Liability.",
    sourceAuthority: "Accounting Standards Council Singapore & IASB"
  },
  SFRS_I_1_37_PROVISIONS: {
    code: "SFRS(I) 1-37 / IAS 37 \xA714",
    sfrsCode: "SFRS(I) 1-37 \xA714",
    ifrsCode: "IAS 37 \xA714",
    standardTitle: "Provisions, Contingent Liabilities and Contingent Assets",
    paragraph: "\xA714",
    principle: "A provision shall be recognised when: (a) an entity has a present obligation (legal or constructive) as a result of a past event; (b) it is probable that an outflow of resources will be required to settle the obligation; and (c) a reliable estimate can be made.",
    application: "Warranties, legal settlements, and restructuring provisions meeting all 3 tests: Dr. Provision Expense (P&L) | Cr. Provision for Obligations (Liability).",
    sourceAuthority: "Accounting Standards Council Singapore & IASB"
  },
  SFRS_I_1_12_INCOME_TAXES: {
    code: "SFRS(I) 1-12 / IAS 12 \xA715 & \xA724",
    sfrsCode: "SFRS(I) 1-12 \xA715 & \xA724",
    ifrsCode: "IAS 12 \xA715 & \xA724",
    standardTitle: "Income Taxes - Accounting vs Tax Bases & Deferred Tax",
    paragraph: "\xA715 & \xA724",
    principle: "Deferred tax arises from temporary differences between the accounting carrying amounts of assets/liabilities and their corresponding tax bases under the Income Tax Act. Taxable temporary differences require Deferred Tax Liabilities; deductible temporary differences generate Deferred Tax Assets.",
    application: "Accelerated tax capital allowances under Section 19A of the Income Tax Act exceed accounting depreciation, producing a taxable temporary difference: Dr. Deferred Tax Expense (P&L) | Cr. Deferred Tax Liability.",
    sourceAuthority: "Accounting Standards Council Singapore & IASB"
  },
  SFRS_I_1_36_IMPAIRMENT: {
    code: "SFRS(I) 1-36 / IAS 36 \xA79, \xA718, \xA759 & \xA7114",
    sfrsCode: "SFRS(I) 1-36 \xA79, \xA718, \xA759 & \xA7114",
    ifrsCode: "IAS 36 \xA79, \xA718, \xA759 & \xA7114",
    standardTitle: "Impairment of Assets - Recoverable Amount & Loss Recognition",
    paragraph: "\xA79, \xA718, \xA759 & \xA7114",
    principle: "An entity shall assess at the end of each reporting period whether there is any indication that an asset may be impaired (\xA79). If any such indication exists, the entity shall estimate the recoverable amount of the asset, which is the higher of its fair value less costs of disposal and its value in use (\xA718). If the recoverable amount is less than the carrying amount, an impairment loss shall be recognized immediately in profit or loss (\xA759). An impairment loss recognized in prior periods for an asset other than goodwill shall be reversed if there has been a change in estimates used to determine the recoverable amount (\xA7114).",
    application: "Annual impairment testing of machinery, goodwill, and intangible assets: Dr. Impairment Loss (P&L) | Cr. Accumulated Impairment Loss (contra-asset).",
    sourceAuthority: "Accounting Standards Council Singapore & IASB",
    validFrom: "2018-01-01",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  },
  SFRS_I_1_20_GOVERNMENT_GRANTS: {
    code: "SFRS(I) 1-20 / IAS 20 \xA77, \xA712, \xA724 & \xA729",
    sfrsCode: "SFRS(I) 1-20 \xA77, \xA712, \xA724 & \xA729",
    ifrsCode: "IAS 20 \xA77, \xA712, \xA724 & \xA729",
    standardTitle: "Accounting for Government Grants and Disclosure of Government Assistance",
    paragraph: "\xA77, \xA712, \xA724 & \xA729",
    principle: "Government grants shall not be recognized until there is reasonable assurance that the entity will comply with conditions attaching to them and the grants will be received (\xA77). Grants shall be recognized in profit or loss on a systematic basis over the periods in which the entity recognizes as expenses the related costs which the grants are intended to compensate (\xA712). Capital grants related to assets may be presented either as deferred income or by deducting the grant in arriving at the carrying amount of the asset (\xA724). Operating grants (e.g. wage credits, hiring incentives) may be presented as other income or deducted from the related expense (\xA729).",
    application: "Singapore wage subsidies (Jobs Support Scheme / Jobs Growth Incentive): Dr. Cash at Bank | Cr. Other Operating Income (or Cr. Staff Salaries & Wages Expense). Capital equipment grants: Dr. Cash at Bank | Cr. Deferred Capital Grant (Liability).",
    sourceAuthority: "Accounting Standards Council Singapore & IASB",
    validFrom: "2018-01-01",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  },
  SFRS_I_1_23_BORROWING_COSTS: {
    code: "SFRS(I) 1-23 / IAS 23 \xA71, \xA75 & \xA78",
    sfrsCode: "SFRS(I) 1-23 \xA71, \xA75 & \xA78",
    ifrsCode: "IAS 23 \xA71, \xA75 & \xA78",
    standardTitle: "Borrowing Costs - Mandatory Capitalisation on Qualifying Assets",
    paragraph: "\xA71, \xA75 & \xA78",
    principle: "Borrowing costs that are directly attributable to the acquisition, construction or production of a qualifying asset form part of the cost of that asset (\xA71, \xA78). Other borrowing costs are recognized as an expense in the period in which they are incurred. A qualifying asset is an asset that necessarily takes a substantial period of time to get ready for its intended use or sale (\xA75).",
    application: "Construction of commercial property, plant, or specialized IT platforms taking >12 months: Dr. Construction-in-Progress (Asset) | Cr. Bank / Interest Payable. Borrowing costs on routine short-term inventories are expensed immediately.",
    sourceAuthority: "Accounting Standards Council Singapore & IASB",
    validFrom: "2018-01-01",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  },
  SFRS_I_1_10_EVENTS_AFTER_REPORTING: {
    code: "SFRS(I) 1-10 / IAS 10 \xA73, \xA78, \xA710 & \xA712",
    sfrsCode: "SFRS(I) 1-10 \xA73, \xA78, \xA710 & \xA712",
    ifrsCode: "IAS 10 \xA73, \xA78, \xA710 & \xA712",
    standardTitle: "Events After the Reporting Period - Adjusting vs Non-Adjusting Events & Dividends",
    paragraph: "\xA73, \xA78, \xA710 & \xA712",
    principle: "Events after the reporting period are those events, favourable and unfavourable, that occur between the end of the reporting period and the date when the financial statements are authorised for issue (\xA73). An entity shall adjust the amounts recognized in its financial statements to reflect adjusting events (evidence of conditions that existed at the end of the reporting period, \xA78). An entity shall not adjust amounts for non-adjusting events (indicative of conditions that arose after the reporting period, \xA710). If an entity declares dividends to holders of equity instruments after the reporting period, the entity shall not recognize those dividends as a liability at the end of the reporting period (\xA712).",
    application: "Bankruptcy of a major customer shortly after FYE confirming uncollectibility of year-end trade receivable: Adjusting event requiring retrospective provision adjustment under \xA78. Dividends declared in March for prior December FYE: Non-adjusting disclosure note only, no liability recorded at 31 Dec (\xA712).",
    sourceAuthority: "Accounting Standards Council Singapore & IASB",
    validFrom: "2018-01-01",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  },
  SFRS_I_1_8_POLICIES_ESTIMATES_ERRORS: {
    code: "SFRS(I) 1-8 / IAS 8 \xA714, \xA719, \xA732 & \xA742",
    sfrsCode: "SFRS(I) 1-8 \xA714, \xA719, \xA732 & \xA742",
    ifrsCode: "IAS 8 \xA714, \xA719, \xA732 & \xA742",
    standardTitle: "Accounting Policies, Changes in Accounting Estimates and Errors",
    paragraph: "\xA714, \xA719, \xA732 & \xA742",
    principle: "An entity shall change an accounting policy only if the change is required by an SFRS(I) or results in more reliable and relevant information (\xA714). Changes in accounting policy are accounted for retrospectively (\xA719). The effect of a change in an accounting estimate (e.g. useful life, residual value, bad debt allowance percentage) shall be recognized prospectively by including it in profit or loss in the period of change and future periods (\xA732). Material prior period errors must be corrected retrospectively in the first set of financial statements authorised for issue after their discovery by restating comparative amounts (\xA742).",
    application: "Revising straight-line depreciation useful life from 5 to 8 years is a prospective estimate change (\xA732). Uncovering unrecorded prior-year supplier invoices requires retrospective restatement of opening retained earnings (\xA742).",
    sourceAuthority: "Accounting Standards Council Singapore & IASB",
    validFrom: "2018-01-01",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  }
};
function getCitation(ruleKey, standardMode) {
  const rule = STANDARDS_REPOSITORY[ruleKey];
  return {
    standard: standardMode === "SFRS_I" ? rule.sfrsCode : rule.ifrsCode,
    paragraph: rule.paragraph,
    title: rule.standardTitle,
    text: rule.principle,
    officialSourceUrl: standardMode === "SFRS_I" ? "https://www.acra.gov.sg/accountancy/accounting-standards" : "https://www.ifrs.org"
  };
}

// src/engine/eventSequence.ts
var money = (value) => {
  const parsed = Number(value.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : void 0;
};
var dateFrom = (value) => value.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i)?.[0];
var amountFrom = (value) => money(value.match(/(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1] || "");
var quantityFrom = (value) => money(value.match(/\b([\d,]+)(?:\s+[a-z]+){0,2}\s+units?\b/i)?.[1] || "");
var rateFrom = (value) => money(value.match(/(?:at|for|allowance\s+of)\s+(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d{1,2})?)\s*(?:each|per unit)?/i)?.[1] || "");
var gstRateFrom = (value) => money(value.match(/\b(\d+(?:\.\d+)?)\s*%\s*GST/i)?.[1] || "");
var partyFrom = (value, role) => value.match(new RegExp(`\\b${role}(?:\\s+name)?\\s+([A-Z][\\w&.' -]+?)(?=\\s+(?:at|for|on|via|,|\\.|$))`, "i"))?.[1]?.trim();
var evidence = (field, value) => [{ source: "user_text", field, value, confidence: 0.95 }];
var firstMoney = (text, pattern) => money(text.match(pattern)?.[1] || "");
function normaliseAiEventSequence(payload) {
  const raw = payload;
  if (!Array.isArray(raw?.events) || raw.events.length < 2) return void 0;
  const allowed = /* @__PURE__ */ new Set(["purchase", "purchase_return", "supplier_settlement", "purchase_discount", "sale", "sales_return", "customer_settlement", "credit_note", "correction", "reversal", "reclassification", "asset_disposal", "other"]);
  const events = [];
  for (let index = 0; index < raw.events.length; index++) {
    const item = raw.events[index];
    if (!item || typeof item.type !== "string" || !allowed.has(item.type) || typeof item.description !== "string") return void 0;
    const amount = typeof item.amount === "number" && Number.isFinite(item.amount) && item.amount > 0 ? item.amount : void 0;
    const quantity = typeof item.quantity === "number" && Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : void 0;
    const unitPrice = typeof item.unitPrice === "number" && Number.isFinite(item.unitPrice) && item.unitPrice > 0 ? item.unitPrice : void 0;
    const taxRate = typeof item.tax?.rate === "number" ? item.tax.rate : void 0;
    events.push({ id: typeof item.id === "string" ? item.id : `event-${index + 1}`, date: typeof item.date === "string" ? item.date : void 0, type: item.type, lifecycle: item.lifecycle === "proposed" || item.lifecycle === "corrected" || item.lifecycle === "reversed" ? item.lifecycle : "actual", description: item.description, currency: typeof item.currency === "string" ? item.currency.toUpperCase() : "SGD", amount, quantity, unitPrice, tax: taxRate !== void 0 ? { rate: taxRate } : void 0, relatesTo: Array.isArray(item.relatesTo) ? item.relatesTo.filter((id) => typeof id === "string") : [], evidence: [{ source: "user_text", field: "aiEventCandidate", value: item.description, confidence: typeof item.confidence === "number" ? item.confidence : 0.8 }], uncertainties: [] });
  }
  return { events, source: "user_text" };
}
function extractEventSequence(text) {
  const clauses = text.split(/(?:\r?\n|;|(?<=\.)\s+(?=(?:on\s+)?\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b))/).map((x) => x.trim()).filter(Boolean);
  const events = [];
  const documentGstRate = gstRateFrom(text);
  for (const clause of clauses) {
    const lower = clause.toLowerCase();
    let type;
    if (/\b(return(?:ed)?|purchase return)\b/.test(lower)) type = "purchase_return";
    else if (/\b(allowance|credit allowance)\b/.test(lower)) type = "credit_note";
    else if (/\b(sold|sale)\b/.test(lower)) type = "sale";
    else if (/\b(settle[ds]?|paid|payment)\b/.test(lower) && /supplier|payable|vendor|invoice|purchase/.test(lower)) type = "supplier_settlement";
    else if (/\b(discount|rebate)\b/.test(lower)) type = "purchase_discount";
    else if (/\b(purchased?|bought|acquired)\b/.test(lower)) type = "purchase";
    if (!type) continue;
    const quantity = quantityFrom(clause);
    const unitPrice = rateFrom(clause);
    const amount = quantity && unitPrice ? quantity * unitPrice : amountFrom(clause);
    const priorRelated = [...events].reverse().find((event) => event.type === "purchase" || event.type === "sale");
    const uncertainties = [];
    const canUseLinkedValue = type === "purchase_return" || type === "credit_note" || type === "supplier_settlement" && /full outstanding|full balance/i.test(lower);
    if (!amount && !canUseLinkedValue) uncertainties.push({ fieldKey: "amount", fieldName: "Amount", prompt: `What is the amount for this ${type.replace("_", " ")} event?`, whyNeeded: "A measured amount is required before a balanced journal can be prepared." });
    if (type !== "purchase" && type !== "sale" && !priorRelated) uncertainties.push({ fieldKey: "relatedEvent", fieldName: "Related transaction", prompt: `Which original transaction does this ${type.replace("_", " ")} relate to?`, whyNeeded: "The outstanding balance must be reconciled before posting." });
    const id = `event-${events.length + 1}`;
    events.push({ id, date: dateFrom(clause), type, lifecycle: "actual", description: clause, parties: { supplier: partyFrom(clause, "supplier"), customer: partyFrom(clause, "customer") }, paymentTerms: clause.match(/\b\d+\/\d+\s*,?\s*n\/\d+\b/i)?.[0], currency: /\bUSD\b/i.test(clause) ? "USD" : "SGD", amount, quantity, unitPrice, tax: { rate: gstRateFrom(clause) ?? documentGstRate }, relatesTo: priorRelated && type !== "purchase" && type !== "sale" ? [priorRelated.id] : [], evidence: evidence("eventText", clause), uncertainties });
  }
  return events.length >= 2 ? { events, source: "user_text" } : void 0;
}
var line = (id, accountName, category, debit, credit, explanation) => ({ id, accountCode: "SEQ", accountName, category, debit, credit, lineExplanation: explanation });
var group = (event, title, lines, summary, standard) => {
  const totalDebit = lines.reduce((sum, item) => sum + item.debit, 0);
  const totalCredit = lines.reduce((sum, item) => sum + item.credit, 0);
  return { id: `journal-${event.id}`, accountingEventId: event.id, relatedEventIds: event.relatesTo, eventDate: event.date || formatSingaporeDate(/* @__PURE__ */ new Date()), title, summary, lines, totalDebit, totalCredit, isBalanced: Math.abs(totalDebit - totalCredit) < 5e-3, citations: [getCitation("SFRS_I_1_2_INVENTORIES", standard)], rationalePoints: ["Generated from normalized event facts; linked balances were deterministically reconciled."], authorityStatus: "DETERMINISTIC" };
};
function resolveCommercialEventSequence(sequence, standard = "SFRS_I") {
  let payable = 0;
  let receivable = 0;
  let inventoryUnitCost = 0;
  let defaultGstRate = 0;
  const eventsById = new Map(sequence.events.map((event) => [event.id, event]));
  const groups = [];
  const clarifications = [];
  for (const event of sequence.events) {
    if (event.uncertainties.length) {
      clarifications.push(...event.uncertainties);
      continue;
    }
    const linked = event.relatesTo[0] ? eventsById.get(event.relatesTo[0]) : void 0;
    const gstRate = event.tax?.rate ?? linked?.tax?.rate ?? defaultGstRate;
    const amount = event.amount ?? (event.quantity && linked?.unitPrice ? event.quantity * linked.unitPrice : void 0);
    if (event.currency !== "SGD") {
      clarifications.push({ fieldKey: "fxRate", fieldName: "Transaction-date FX rate", prompt: `Please provide the SGD transaction-date rate for ${event.id}.`, whyNeeded: "Foreign-currency amounts must be measured before the payable can be reconciled." });
      continue;
    }
    const canSettleFullOutstanding = event.type === "supplier_settlement" && /full\s+(?:outstanding|balance)|settle(?:d)?\s+in\s+full/i.test(event.description);
    if (amount === void 0 && !canSettleFullOutstanding) {
      clarifications.push({ fieldKey: "amount", fieldName: "Amount", prompt: `What is the measured amount for ${event.id}?`, whyNeeded: "A journal cannot be produced until the event amount is established." });
      continue;
    }
    if (event.type === "purchase") {
      const gst = amount * gstRate / 100;
      defaultGstRate = gstRate;
      inventoryUnitCost = event.unitPrice || inventoryUnitCost;
      payable += amount + gst;
      groups.push(group(event, "Inventory purchase on credit", [line(`${event.id}-1`, "Inventory", "ASSET", amount, 0, "Inventory acquired."), line(`${event.id}-2`, "Input GST receivable", "ASSET", gst, 0, "Claimable input GST."), line(`${event.id}-3`, "Accounts Payable", "LIABILITY", 0, amount + gst, "Supplier obligation recognised.")], event.description, standard));
    } else if (event.type === "purchase_return") {
      const net = amount;
      const gst = net * gstRate / 100;
      if (net + gst > payable) {
        clarifications.push({ fieldKey: "returnAmount", fieldName: "Return amount", prompt: `The return for ${event.id} exceeds the linked outstanding payable of SGD ${payable.toFixed(2)}. Please confirm the original purchase or amount.`, whyNeeded: "A return cannot derecognise more than the linked purchase balance." });
        continue;
      }
      payable -= net + gst;
      groups.push(group(event, "Return of inventory to supplier", [line(`${event.id}-1`, "Accounts Payable", "LIABILITY", net + gst, 0, "Supplier obligation reduced by the credit note."), line(`${event.id}-2`, "Inventory", "ASSET", 0, net, "Returned inventory derecognised."), line(`${event.id}-3`, "Input GST receivable", "ASSET", 0, gst, "Input GST reversed.")], event.description, standard));
    } else if (event.type === "supplier_settlement") {
      const settling = amount ?? payable;
      if (settling > payable) {
        clarifications.push({ fieldKey: "settlementAmount", fieldName: "Settlement amount", prompt: `The settlement for ${event.id} exceeds the linked outstanding payable of SGD ${payable.toFixed(2)}. Please confirm the payment allocation.`, whyNeeded: "A payable cannot be settled beyond its outstanding balance." });
        continue;
      }
      const purchaseTerms = sequence.events.find((item) => item.type === "purchase")?.paymentTerms || "";
      const discountRate = /\b(\d+(?:\.\d+)?)\/\d+\b/.exec(purchaseTerms)?.[1] && /qualifying|taking/i.test(event.description) ? Number(/\b(\d+(?:\.\d+)?)\/\d+\b/.exec(purchaseTerms)[1]) / 100 : 0;
      const discountNet = settling / (1 + gstRate / 100) * discountRate;
      const discountGst = discountNet * gstRate / 100;
      const cash = settling - discountNet - discountGst;
      payable -= settling;
      groups.push(group(event, "Settlement of supplier payable", [line(`${event.id}-1`, "Accounts Payable", "LIABILITY", settling, 0, "Supplier obligation settled."), line(`${event.id}-2`, "Cash at Bank", "ASSET", 0, cash, "Payment to supplier."), line(`${event.id}-3`, "Inventory", "ASSET", 0, discountNet, "Gross-method purchase discount reduces inventory cost."), line(`${event.id}-4`, "Input GST receivable", "ASSET", 0, discountGst, "Input GST adjusted for the discount.")], event.description, standard));
    } else if (event.type === "sale") {
      const net = amount;
      const gst = net * gstRate / 100;
      const cost = (event.quantity || 0) * inventoryUnitCost;
      receivable += net + gst;
      groups.push(group(event, "Credit sale of inventory", [line(`${event.id}-1`, "Accounts Receivable", "ASSET", net + gst, 0, "Customer invoice including GST."), line(`${event.id}-2`, "Sales Revenue", "REVENUE", 0, net, "Revenue recognised on sale."), line(`${event.id}-3`, "Output GST payable", "LIABILITY", 0, gst, "Output GST on taxable supply."), line(`${event.id}-4`, "Cost of Sales", "EXPENSE", cost, 0, "FIFO cost of goods sold."), line(`${event.id}-5`, "Inventory", "ASSET", 0, cost, "Inventory derecognised.")], event.description, standard));
    } else if (event.type === "credit_note") {
      const net = amount;
      const gst = net * gstRate / 100;
      if (net + gst > receivable) {
        clarifications.push({ fieldKey: "allowanceAmount", fieldName: "Allowance amount", prompt: `The allowance for ${event.id} exceeds the linked receivable. Please confirm the invoice or allowance.`, whyNeeded: "A credit allowance cannot exceed the outstanding customer balance." });
        continue;
      }
      receivable -= net + gst;
      groups.push(group(event, "Sales allowance credit note", [line(`${event.id}-1`, "Sales Allowances", "REVENUE", net, 0, "Reduction of sales consideration."), line(`${event.id}-2`, "Output GST payable", "LIABILITY", gst, 0, "Output GST adjusted."), line(`${event.id}-3`, "Accounts Receivable", "ASSET", 0, net + gst, "Customer balance reduced.")], event.description, standard));
    }
  }
  return { groups, clarifications };
}
var resolveInventoryEventSequence = resolveCommercialEventSequence;
function resolveEventSequence(text, standard = "SFRS_I", aiCandidate) {
  const fixedAsset = resolveFixedAssetSequence(text, standard);
  if (fixedAsset) return { family: "fixed_asset", ...fixedAsset };
  const lease = resolveLeaseSequence(text, standard);
  if (lease) return { family: "lease", ...lease };
  const sequence = aiCandidate || extractEventSequence(text);
  if (!sequence) return void 0;
  const isGoodsLifecycle = /\b(inventory|merchandise|goods|widgets?|stock)\b/i.test(text) && sequence.events.every((event) => ["purchase", "purchase_return", "supplier_settlement", "purchase_discount", "sale", "credit_note"].includes(event.type));
  if (!isGoodsLifecycle) return void 0;
  return { family: "commercial_goods", sequence, ...resolveCommercialEventSequence(sequence, standard) };
}
function resolveFixedAssetSequence(text, standard = "SFRS_I") {
  const q = text.toLowerCase();
  if (!/\b(machine|machinery|equipment|fixed asset|ppe)\b/.test(q) || !/\bdepreciation\b/.test(q) || !/\b(trade[ -]?in|disposal|derecogn)/.test(q)) return void 0;
  const purchase = firstMoney(text, /purchase price of\s+(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i);
  const ancillary = firstMoney(text, /(?:testing|site preparation)[\s\S]{0,100}?costs? of\s+(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i) || 0;
  const residual = firstMoney(text, /residual value of\s+(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i);
  const life = Number(text.match(/useful life of\s+(\d+(?:\.\d+)?)\s+years?/i)?.[1]);
  const newCost = firstMoney(text, /(?:list price|newer[^.]{0,80}?model)[\s\S]{0,100}?(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i);
  const tradeIn = firstMoney(text, /trade[ -]?in allowance of\s+(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i);
  const rate = (gstRateFrom(text) || 9) / 100;
  if (!purchase || !residual || !life || !newCost || !tradeIn) return void 0;
  const dates = [...text.matchAll(/Transaction\s+\d+\s*\(([^)]+)\)/gi)].map((match) => match[1]);
  const events = ["asset acquisition", "asset liability settlement", "annual depreciation", "pre-disposal depreciation", "asset trade-in"].map((description, index) => ({ id: `event-${index + 1}`, date: dates[index], type: "other", lifecycle: "actual", description, currency: "SGD", relatesTo: index ? [`event-${index}`] : [], evidence: evidence("eventText", description), uncertainties: [] }));
  const cost = purchase + ancillary;
  const yearDep = (cost - residual) / life;
  const halfDep = yearDep / 2;
  const accumulatedDep = yearDep + halfDep;
  const carryingAmount = cost - accumulatedDep;
  const inputGst = purchase * rate;
  const oldOutputGst = tradeIn * rate;
  const loss = carryingAmount - tradeIn;
  const netBank = newCost + newCost * rate - tradeIn - oldOutputGst;
  const assetCitation = (event, title, lines) => ({
    ...group(event, title, lines, event.description, standard),
    citations: [getCitation("IAS16_PPE_RECOGNITION", standard)]
  });
  const groups = [
    assetCitation(events[0], "Acquire delivery machinery", [line("a1", "Machinery", "ASSET", cost, 0, "Purchase price and directly attributable testing/site preparation costs capitalised."), line("a2", "Input GST receivable", "ASSET", inputGst, 0, "Recoverable GST on machinery purchase."), line("a3", "Accounts Payable \u2014 TechMach Ltd", "LIABILITY", 0, purchase + inputGst, "Credit purchase liability."), line("a4", "Cash at Bank", "ASSET", 0, ancillary, "Ancillary costs paid immediately.")]),
    assetCitation(events[1], "Settle machinery supplier liability", [line("b1", "Accounts Payable \u2014 TechMach Ltd", "LIABILITY", purchase + inputGst, 0, "Supplier liability settled."), line("b2", "Cash at Bank", "ASSET", 0, purchase + inputGst, "Bank settlement.")]),
    assetCitation(events[2], "Annual depreciation", [line("c1", "Depreciation Expense \u2014 Machinery", "EXPENSE", yearDep, 0, "Straight-line annual depreciation."), line("c2", "Accumulated Depreciation \u2014 Machinery", "ASSET", 0, yearDep, "Accumulated depreciation.")]),
    assetCitation(events[3], "Depreciation to trade-in date", [line("d1", "Depreciation Expense \u2014 Machinery", "EXPENSE", halfDep, 0, "Six months straight-line depreciation before derecognition."), line("d2", "Accumulated Depreciation \u2014 Machinery", "ASSET", 0, halfDep, "Accumulated depreciation.")]),
    assetCitation(events[4], "Trade in old machinery and acquire replacement", [line("e1", "Accumulated Depreciation \u2014 Machinery", "ASSET", accumulatedDep, 0, "Remove accumulated depreciation."), line("e2", "Loss on Disposal of Machinery", "EXPENSE", loss, 0, "Carrying amount exceeds trade-in proceeds."), line("e3", "Machinery \u2014 New Model", "ASSET", newCost, 0, "Replacement machine at purchase price."), line("e4", "Input GST receivable", "ASSET", newCost * rate, 0, "Recoverable GST on replacement."), line("e5", "Machinery \u2014 Old Model", "ASSET", 0, cost, "Derecognise old asset cost."), line("e6", "Output GST payable", "LIABILITY", 0, oldOutputGst, "GST on taxable trade-in supply."), line("e7", "Cash at Bank", "ASSET", 0, netBank, "Net bank payment after trade-in credit.")])
  ];
  return { sequence: { events, source: "user_text" }, groups, clarifications: [] };
}
function resolveLeaseSequence(text, standard = "SFRS_I") {
  if (!/\b(?:ifrs\s*16|sfrs\(i\)\s*16|lease liability|right-of-use|rou)\b/i.test(text)) return void 0;
  const liability = firstMoney(text, /(?:present value|\bPV\b)[\s\S]{0,300}?(?:\bis\s*|:\s*)(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i);
  const directCosts = firstMoney(text, /initial direct costs[^.]{0,100}?(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i) || 0;
  const incentive = firstMoney(text, /lease incentive[^.]{0,100}?(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i) || 0;
  const restoration = firstMoney(text, /restoration costs[^.]{0,100}?(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i) || 0;
  const annualPayment = firstMoney(text, /annual lease payments?[^.]{0,100}?(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i);
  const rate = Number(text.match(/(?:incremental borrowing rate|interest expense)[^.]{0,80}?(\d+(?:\.\d+)?)\s*%/i)?.[1]) / 100;
  const term = Number(text.match(/\b(\d+)\s*[- ]year\b/i)?.[1]);
  const gstRate = (gstRateFrom(text) || 9) / 100;
  const paidInAdvance = /payable\s+(?:annually\s+)?in\s+advance/i.test(text);
  const scopeReduction = /scope reduction|partial termination|reduce(?:d)?[^.]{0,80}?(\d+(?:\.\d+)?)\s*%/i.exec(text);
  const earlyTermination = /early[ -]?terminat|contract cancellation/i.test(text) && !scopeReduction;
  const pvAmounts = [...text.matchAll(/\bPV\b[\s\S]{0,180}?(?:\bis\s*|:\s*)(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/gi)].map((match) => money(match[1])).filter((value) => value !== void 0);
  const revisedLiability = pvAmounts.length > 1 ? pvAmounts[pvAmounts.length - 1] : void 0;
  const terminationFee = firstMoney(text, /(?:termination|contract cancellation)[^.]{0,120}?(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i) || 0;
  if (!liability || !annualPayment || !rate || !term) return void 0;
  const dates = [...text.matchAll(/(?:Transaction\s+\d+\s*\()?([0-3]?\d\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})/gi)].map((match) => match[1]);
  const events = ["lease commencement", "year-end lease measurement", "subsequent lease payment", "lease termination"].map((description, index) => ({ id: `event-${index + 1}`, date: dates[index], type: "other", lifecycle: "actual", description, currency: "SGD", relatesTo: index ? [`event-${index}`] : [], evidence: evidence("eventText", description), uncertainties: [] }));
  const rou = liability + directCosts + restoration - incentive + (paidInAdvance ? annualPayment : 0);
  const interest = liability * rate;
  const depreciation = rou / term;
  const gst = annualPayment * gstRate;
  const unwinding = restoration * rate;
  const leaseGroup = (event, title, lines) => ({ ...group(event, title, lines, event.description, standard), citations: [getCitation("IFRS16_LEASE_INCEPTION", standard)] });
  const initialLines = [line("l1", "Right-of-Use Asset", "ASSET", rou + incentive, 0, "Lease liability, initial payment, direct costs and restoration obligation included in the ROU asset."), line("l2", "Lease Liability", "LIABILITY", 0, liability, "Present value of unpaid lease payments."), line("l3", "Provision for Restoration", "LIABILITY", 0, restoration, "Present value of restoration obligation."), line("l4", "Cash at Bank", "ASSET", 0, directCosts, "Initial direct costs paid."), line("l5", "Cash at Bank", "ASSET", incentive, 0, "Lease incentive received."), line("l6", "Right-of-Use Asset", "ASSET", 0, incentive, "Lease incentive reduces ROU asset.")];
  if (paidInAdvance) initialLines.push(line("l7", "Input GST receivable", "ASSET", gst, 0, "Recoverable GST on first payment."), line("l8", "Cash at Bank", "ASSET", 0, annualPayment + gst, "First lease payment and GST paid at commencement."));
  const yearEndLines = [line("l9", "Finance Cost \u2014 Lease Liability", "EXPENSE", interest, 0, "Effective-interest accretion of lease liability."), line("l10", "Lease Liability", "LIABILITY", 0, interest, "Lease liability interest accrued."), line("l11", "Depreciation Expense \u2014 ROU Asset", "EXPENSE", depreciation, 0, "Straight-line ROU depreciation."), line("l12", "Accumulated Depreciation \u2014 ROU Asset", "ASSET", 0, depreciation, "ROU accumulated depreciation.")];
  if (!paidInAdvance) yearEndLines.push(line("l13", "Lease Liability", "LIABILITY", annualPayment, 0, "Annual lease instalment principal settlement."), line("l14", "Input GST receivable", "ASSET", gst, 0, "Recoverable GST billed on lease payment."), line("l15", "Cash at Bank", "ASSET", 0, annualPayment + gst, "Lease payment and GST paid."));
  if (restoration) yearEndLines.push(line("l16", "Finance Cost \u2014 Restoration Provision", "EXPENSE", unwinding, 0, "Unwinding of restoration discount."), line("l17", "Provision for Restoration", "LIABILITY", 0, unwinding, "Restoration provision accreted."));
  const groups = [leaseGroup(events[0], "Initial recognition of lease", initialLines), leaseGroup(events[1], "Year-end lease entries", yearEndLines)];
  const liabilityAfterInterest = liability + interest;
  if (paidInAdvance) groups.push(leaseGroup(events[2], "Subsequent lease payment", [line("l18", "Lease Liability", "LIABILITY", annualPayment, 0, "Second annual payment reduces lease liability."), line("l19", "Input GST receivable", "ASSET", gst, 0, "Recoverable GST on payment."), line("l20", "Cash at Bank", "ASSET", 0, annualPayment + gst, "Annual lease payment and GST paid.")]));
  if (earlyTermination) {
    const liabilityAtTermination = liabilityAfterInterest - (paidInAdvance ? annualPayment : 0);
    const rouCarryingAmount = rou - depreciation;
    const derecognitionLoss = rouCarryingAmount - liabilityAtTermination;
    groups.push(leaseGroup(events[3], "Early termination and lease derecognition", [line("l21", "Lease Liability", "LIABILITY", liabilityAtTermination, 0, "Remaining lease liability derecognised on termination."), line("l22", "Loss on Lease Termination", "EXPENSE", derecognitionLoss, 0, "Difference between ROU carrying amount and derecognised liability."), line("l23", "Right-of-Use Asset", "ASSET", 0, rouCarryingAmount, "ROU asset derecognised."), line("l24", "Lease Termination Expense", "EXPENSE", terminationFee, 0, "Termination settlement penalty."), line("l25", "Cash at Bank", "ASSET", 0, terminationFee, "Termination settlement paid.")]));
  }
  if (scopeReduction && revisedLiability) {
    const reductionPercent = Number(scopeReduction[1]) / 100;
    const liabilityBeforeModification = liabilityAfterInterest - (paidInAdvance ? annualPayment : 0);
    const rouBeforeModification = rou - depreciation;
    const liabilityReduction = liabilityBeforeModification * reductionPercent;
    const rouReduction = rouBeforeModification * reductionPercent;
    const modificationGain = liabilityReduction - rouReduction;
    const remainingLiability = liabilityBeforeModification - liabilityReduction;
    const remeasurementDelta = remainingLiability - revisedLiability;
    groups.push(leaseGroup(events[3], "Lease scope reduction and remeasurement", [line("l26", "Lease Liability", "LIABILITY", liabilityReduction, 0, "Derecognise the lease liability for the reduced scope."), line("l27", "Right-of-Use Asset", "ASSET", 0, rouReduction, "Derecognise the corresponding ROU asset."), line("l28", modificationGain >= 0 ? "Gain on Lease Modification" : "Loss on Lease Modification", modificationGain >= 0 ? "REVENUE" : "EXPENSE", modificationGain >= 0 ? 0 : -modificationGain, modificationGain >= 0 ? modificationGain : 0, "Difference on partial lease termination."), line("l29", remeasurementDelta >= 0 ? "Right-of-Use Asset" : "Lease Liability", remeasurementDelta >= 0 ? "ASSET" : "LIABILITY", 0, 0, "Placeholder removed below.")].filter((item) => item.id !== "l29")));
    const remeasurementGroup = groups[groups.length - 1];
    if (remeasurementDelta >= 0) remeasurementGroup.lines.push(line("l30", "Lease Liability", "LIABILITY", remeasurementDelta, 0, "Remeasure remaining liability using revised discount rate."), line("l31", "Right-of-Use Asset", "ASSET", 0, remeasurementDelta, "Corresponding reduction of ROU asset."));
    else remeasurementGroup.lines.push(line("l30", "Right-of-Use Asset", "ASSET", -remeasurementDelta, 0, "Corresponding increase of ROU asset."), line("l31", "Lease Liability", "LIABILITY", 0, -remeasurementDelta, "Remeasure remaining liability using revised discount rate."));
    remeasurementGroup.totalDebit = remeasurementGroup.lines.reduce((sum, item) => sum + item.debit, 0);
    remeasurementGroup.totalCredit = remeasurementGroup.lines.reduce((sum, item) => sum + item.credit, 0);
    remeasurementGroup.isBalanced = Math.abs(remeasurementGroup.totalDebit - remeasurementGroup.totalCredit) < 5e-3;
  }
  return { sequence: { events, source: "user_text" }, groups, clarifications: [] };
}
export {
  extractEventSequence,
  normaliseAiEventSequence,
  resolveCommercialEventSequence,
  resolveEventSequence,
  resolveFixedAssetSequence,
  resolveInventoryEventSequence,
  resolveLeaseSequence
};
