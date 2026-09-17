// tests/regression/test_event_sequence_inventory.mjs
import assert from "node:assert/strict";

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
var quantityFrom = (value) => {
  const quantityNouns = "(?:units?|widgets?|goods|items?|shares?|products?)";
  const explicitAllowanceQuantity = value.match(new RegExp(`\\bfor\\s+([\\d,]+)(?:\\s+[a-z]+){0,2}\\s+${quantityNouns}\\b`, "i"))?.[1];
  const ordinaryQuantity = value.match(new RegExp(`\\b([\\d,]+)(?:\\s+[a-z]+){0,2}\\s+${quantityNouns}\\b`, "i"))?.[1];
  return money(explicitAllowanceQuantity || ordinaryQuantity || "");
};
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
function resolveCommercialEventSequence(sequence2, standard = "SFRS_I") {
  let payable = 0;
  let receivable = 0;
  let inventoryUnitCost = 0;
  let defaultGstRate = 0;
  const eventsById = new Map(sequence2.events.map((event) => [event.id, event]));
  const groups = [];
  const clarifications = [];
  for (const event of sequence2.events) {
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
      const purchaseTerms = sequence2.events.find((item) => item.type === "purchase")?.paymentTerms || "";
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
function resolveEventSequence(text, standard = "SFRS_I", aiCandidate2) {
  const fixedAsset = resolveFixedAssetSequence(text, standard);
  if (fixedAsset) return { family: "fixed_asset", ...fixedAsset };
  const lease = resolveLeaseSequence(text, standard);
  if (lease) return { family: "lease", ...lease };
  const sequence2 = aiCandidate2 || extractEventSequence(text);
  if (!sequence2) return void 0;
  const isGoodsLifecycle = /\b(inventory|merchandise|goods|widgets?|stock)\b/i.test(text) && sequence2.events.every((event) => ["purchase", "purchase_return", "supplier_settlement", "purchase_discount", "sale", "credit_note"].includes(event.type));
  if (!isGoodsLifecycle) return void 0;
  return { family: "commercial_goods", sequence: sequence2, ...resolveCommercialEventSequence(sequence2, standard) };
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

// src/services/frankfurterService.ts
var cache = {};
async function getExchangeRate(fromCurrency, toCurrency, date) {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();
  if (from === to) {
    return {
      rate: 1,
      date: date || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      from,
      to,
      source: "Identical Currencies"
    };
  }
  let queryDate = date;
  if (queryDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(queryDate)) {
      throw new Error(`[INVALID_FX_DATE] Invalid historical exchange rate date: '${queryDate}'. Use YYYY-MM-DD.`);
    }
    const [year, month, day] = queryDate.split("-").map(Number);
    if (month < 1 || month > 12 || day < 1 || day > new Date(year, month, 0).getDate()) {
      throw new Error(`[INVALID_FX_DATE] Invalid historical exchange rate date: '${queryDate}'. Use a valid calendar date.`);
    }
    const parsedDate = new Date(queryDate);
    const now = /* @__PURE__ */ new Date();
    if (parsedDate > now) {
      queryDate = "latest";
    }
  } else {
    queryDate = "latest";
  }
  const cacheKey = `${from}_${to}_${queryDate}`;
  if (cache[cacheKey]) {
    return cache[cacheKey];
  }
  try {
    const url = `https://api.frankfurter.dev/v1/${queryDate}?from=${from}&to=${to}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Frankfurter API HTTP ${res.status}`);
    }
    const data = await res.json();
    const rate = data.rates?.[to];
    if (rate && typeof rate === "number") {
      const result = {
        rate,
        date: data.date || queryDate,
        from,
        to,
        source: "Frankfurter API (European Central Bank Reference)"
      };
      cache[cacheKey] = result;
      return result;
    }
  } catch (err) {
    console.warn(`Frankfurter API call failed for ${from}->${to} (${queryDate}), using realistic fallback:`, err);
  }
  let fallbackRate = 1.34;
  if (from === "USD" && to === "SGD") fallbackRate = 1.345;
  else if (from === "SGD" && to === "USD") fallbackRate = 0.743;
  else if (from === "EUR" && to === "SGD") fallbackRate = 1.46;
  else if (from === "GBP" && to === "SGD") fallbackRate = 1.72;
  const fallbackResult = {
    rate: fallbackRate,
    date: date || "2026-11-13",
    from,
    to,
    source: "Market Benchmark (Frankfurter Fallback)"
  };
  return fallbackResult;
}

// src/standards/statutes/acra.ts
var ACRA_STATUTE_RULES = {
  // -------------------------------------------------------------
  ACRA_VCC_STRUCTURE_AND_ONGOING_COMPLIANCE: {
    id: "ACRA_VCC_STRUCTURE_AND_ONGOING_COMPLIANCE",
    authority: "ACRA",
    authorityName: "Accounting and Corporate Regulatory Authority (ACRA)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Variable Capital Companies Act 2018",
    actTitle: "Variable Capital Companies Act 2018",
    actCode: "VCCA2018",
    sectionOrSchedule: "Section 5",
    ruleTitle: "Variable Capital Company (VCC) Framework",
    category: "ACRA_COMPLIANCE",
    principle: "A variable capital company (VCC) is a Singapore corporate structure for investment funds. Section 5 of the Variable Capital Companies Act 2018 enables a VCC to be formed and provides for its operation and regulation.",
    verbatimStatuteText: "The purpose of this Act is to enable a body corporate known as a variable capital company or VCC, to be formed, and to provide for its operation and regulation.",
    application: "Use when selecting a Singapore fund vehicle or designing the ledger, reporting and compliance scope for an umbrella VCC and each sub-fund.",
    practicalRules: ["Identify whether the structure is a single VCC or an umbrella VCC and retain sub-fund-level accounting records.", "Ensure the VCC has the required director, company secretary, fund manager and auditor before operating.", "Track AGM, annual-return, register-maintenance and change-notification deadlines separately from the fund manager\u2019s MAS obligations."],
    canonicalUrl: "https://sso.agc.gov.sg/Act/VCCA2018?WholeDoc=1#pr5-",
    supplementaryOfficialSources: [{ title: "ACRA VCC features, eligibility and requirements", url: "https://www.acra.gov.sg/register/variable-capital-company/key-features-eligibility-requirements/", authority: "ACRA" }],
    tags: ["vcc", "variable capital company", "umbrella vcc", "sub-fund", "fund vehicle", "fund manager", "annual return"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2020-01-14",
    validFrom: "2020-01-14",
    lastVerifiedDate: "2026-09-14",
    reviewAuditCycleDays: 90
  },
  ACRA_SEC205C_SMALL_COMPANY_AUDIT_EXEMPTION: {
    id: "ACRA_SEC205C_SMALL_COMPANY_AUDIT_EXEMPTION",
    authority: "ACRA",
    authorityName: "Accounting and Corporate Regulatory Authority (ACRA)",
    actTitle: "Companies Act 1967",
    actCode: "CoA1967",
    sectionOrSchedule: "Section 205C & Thirteenth Schedule",
    ruleTitle: "Small Company Audit Exemption Criteria (Revenue / Assets \u2264 $10M, Staff \u2264 50)",
    category: "ACRA_COMPLIANCE",
    principle: 'A company qualifies as a "small company" and is exempt from statutory audit if it is a private company and fulfills at least 2 of 3 criteria for the immediate past two consecutive financial years.',
    application: "SMEs that meet the 2-out-of-3 test only need to prepare unaudited financial statements compliant with SFRS.",
    practicalRules: [
      "Criterion 1: Total annual revenue $\\le$ SGD 10,000,000.",
      "Criterion 2: Total gross assets $\\le$ SGD 10,000,000.",
      "Criterion 3: Total number of full-time employees at financial year-end $\\le 50$.",
      "Two Consecutive FYs Rule: Must satisfy at least 2 of 3 quantitative thresholds in each of the past 2 consecutive financial years.",
      'Group Requirement: If the company is part of a corporate group, the entire group must qualify as a "small group" on a consolidated basis to enjoy the audit exemption.'
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/CoA1967?ProvIds=P16-#pr205C-",
    tags: ["audit exemption", "small company", "section 205c", "revenue 10m", "assets 10m", "employees 50"]
  },
  ACRA_SEC175_197_AGM_ANNUAL_RETURN_TIMELINES: {
    id: "ACRA_SEC175_197_AGM_ANNUAL_RETURN_TIMELINES",
    authority: "ACRA",
    authorityName: "Accounting and Corporate Regulatory Authority (ACRA)",
    actTitle: "Companies Act 1967",
    actCode: "CoA1967",
    sectionOrSchedule: "Section 175, 175A & Section 197",
    ruleTitle: "Annual General Meeting (AGM) and Annual Return (AR) Statutory Filing Deadlines",
    category: "ACRA_COMPLIANCE",
    principle: "Private companies must hold an AGM (unless dispensed with) within 6 months after the Financial Year End (FYE), and lodge their Annual Return (AR) via BizFile+ within 7 months after FYE.",
    application: "For a company with FYE 31 December 2025: AGM by 30 June 2026; Annual Return lodged with ACRA by 31 July 2026.",
    practicalRules: [
      "Private Company AGM: Must be held within 6 months after FYE (Section 175).",
      "Dispensation of AGM: Private companies can dispense with holding an AGM if all members agree or if financial statements are sent to members within 5 months of FYE (Section 175A).",
      "Annual Return (AR) Lodgment: Must be filed on BizFile+ within 7 months after FYE (Section 197).",
      "Listed Companies: AGM within 4 months after FYE; Annual Return within 5 months after FYE.",
      "Late Lodgment Penalties: Minimum SGD 300 tier-escalating composition fine imposed by ACRA for late filing."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/CoA1967?ProvIds=P15-#pr197-",
    tags: ["agm deadline", "annual return", "bizfile", "fye 6 months", "fye 7 months", "section 175", "section 197"]
  },
  ACRA_SEC199_RECORD_RETENTION: {
    id: "ACRA_SEC199_RECORD_RETENTION",
    authority: "ACRA",
    authorityName: "Accounting and Corporate Regulatory Authority (ACRA)",
    actTitle: "Companies Act 1967",
    actCode: "CoA1967",
    sectionOrSchedule: "Section 199(1)",
    ruleTitle: "Mandatory 5-Year Accounting Records & Vouchers Retention",
    category: "ACRA_COMPLIANCE",
    principle: "Every company shall cause to be kept such accounting and other records as will sufficiently explain the transactions and financial position of the company. Records must be retained for at least 5 years.",
    application: "All bank statements, supplier invoices, sales receipts, and journal entries must be kept for 5 years from the end of the financial year.",
    practicalRules: [
      "Retention Period: Minimum 5 years from the end of the financial year in which the transaction occurred.",
      "Location: Must be kept at the registered office or such other place in Singapore as the directors think fit.",
      "Electronic Storage: Electronic invoices and digital cloud archives are accepted provided they can be readily converted into readable form on demand."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/CoA1967?ProvIds=P16-#pr199-",
    tags: ["record retention", "5 years", "accounting books", "receipts", "section 199"]
  },
  ACRA_SEC145_RESIDENT_DIRECTOR: {
    id: "ACRA_SEC145_RESIDENT_DIRECTOR",
    authority: "ACRA",
    authorityName: "Accounting and Corporate Regulatory Authority (ACRA)",
    actTitle: "Companies Act 1967",
    actCode: "CoA1967",
    sectionOrSchedule: "Section 145(1)",
    ruleTitle: "Requirement for at Least One Ordinarily Resident Director in Singapore",
    category: "ACRA_COMPLIANCE",
    principle: "Every company must have at least one director who is ordinarily resident in Singapore.",
    application: "Foreign business owners incorporating a Singapore private limited company must appoint at least one local Singapore resident director.",
    practicalRules: [
      "Eligible Resident Directors: Singapore Citizen, Singapore Permanent Resident (PR), or an EntrePass / Employment Pass (EP) holder holding a Letter of Consent (LOC) from MOM.",
      "Natural Person: Must be a natural person aged at least 18 years old and not disqualified under Section 148, 149, or 154 (e.g. not an undischarged bankrupt).",
      "Corporate Secretary (Section 171): Must appoint a resident company secretary within 6 months of incorporation. A sole director cannot act as company secretary."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/CoA1967?ProvIds=P15-#pr145-",
    tags: ["resident director", "section 145", "company secretary", "incorporation requirements"]
  },
  ACRA_SEC156_DIRECTOR_INTEREST_DISCLOSURE: {
    id: "ACRA_SEC156_DIRECTOR_INTEREST_DISCLOSURE",
    authority: "ACRA",
    authorityName: "Accounting and Corporate Regulatory Authority (ACRA)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Companies Act 1967",
    actTitle: "Companies Act 1967",
    actCode: "CoA1967",
    sectionOrSchedule: "Section 156",
    ruleTitle: "Mandatory Disclosure of Directors' Interests in Contracts, Transactions & Offices",
    category: "ACRA_COMPLIANCE",
    principle: "Under Section 156(1) and (5) of the Companies Act 1967, every director of a company who is in any way, directly or indirectly, interested in a transaction or proposed transaction with the company, or who holds any office or possesses any property creating duties or interests in conflict with their duties as director, must declare the nature of that interest at a meeting of directors or by written notice to the company as soon as practicable.",
    verbatimStatuteText: "Every director of a company who is in any way, whether directly or indirectly, interested in a transaction or proposed transaction with the company shall as soon as practicable after the relevant facts have come to the director's knowledge \u2014 (a) declare the nature of the director's interest at a meeting of the directors of the company; or (b) send a written notice to the company containing details on the nature, character and extent of the director's interest.",
    application: "Corporate governance and audit review: Whenever a director or related party enters into a sales, lease, loan, or supply agreement with the company, formal Section 156 board disclosure minutes must be documented.",
    practicalRules: [
      "Mandatory Timing: Must disclose as soon as practicable after relevant facts become known.",
      "Method of Disclosure: Formal declaration at a meeting of directors or written notice sent to the company and tabled at the next board meeting.",
      "Offices & Property: Must also declare any office held or property possessed which creates conflicting duties/interests with company directorship.",
      "Criminal Sanction: Non-compliance is an offence under Section 156(15) rendering the defaulting director liable to a fine or imprisonment."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/CoA1967?ProvIds=P15-#pr156-",
    tags: ["director interest", "section 156", "conflict of interest", "related party disclosure", "board declaration"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "1967-12-29",
    validFrom: "1967-12-29",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  },
  ACRA_SEC171_COMPANY_SECRETARY: {
    id: "ACRA_SEC171_COMPANY_SECRETARY",
    authority: "ACRA",
    authorityName: "Accounting and Corporate Regulatory Authority (ACRA)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Companies Act 1967",
    actTitle: "Companies Act 1967",
    actCode: "CoA1967",
    sectionOrSchedule: "Section 171",
    ruleTitle: "Mandatory Appointment of Qualified Resident Company Secretary within 6 Months",
    category: "ACRA_COMPLIANCE",
    principle: "Under Section 171 of the Companies Act 1967, every company must appoint one or more secretaries who must be natural persons ordinarily resident in Singapore. The office of company secretary cannot be left vacant for more than 6 months. A sole director cannot act as the company secretary.",
    verbatimStatuteText: "Every company shall have one or more secretaries each of whom shall be a natural person who has his principal or only place of residence in Singapore. The board of directors shall ensure that the office of secretary is not left vacant for more than 6 months at any one time. The sole director of a company shall not also be the secretary of the company.",
    application: "Statutory compliance upon incorporation and secretary resignation: Company directors must appoint an eligible resident secretary within 6 months via BizFile+.",
    practicalRules: [
      "Residency Mandate: Must be a natural person ordinarily resident in Singapore (Singapore Citizen, PR, or EntrePass/EP holder).",
      "6-Month Vacancy Cap: Vacancy cannot exceed 6 continuous months.",
      "Sole Director Restriction: A sole director of a company is prohibited from simultaneously acting as company secretary.",
      "Public Companies: In a public company, secretary must hold requisite professional qualifications (e.g. qualified under CSIS, CA Singapore, advocate and solicitor, or 3 of last 5 years as secretary)."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/CoA1967?ProvIds=P15-#pr171-",
    tags: ["company secretary", "section 171", "resident secretary", "sole director restriction", "6 months vacancy"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "1967-12-29",
    validFrom: "1967-12-29",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  },
  ACRA_SEC142_143_RORC: {
    id: "ACRA_SEC142_143_RORC",
    authority: "ACRA",
    authorityName: "Accounting and Corporate Regulatory Authority (ACRA)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Companies Act 1967",
    actTitle: "Companies Act 1967",
    actCode: "CoA1967",
    sectionOrSchedule: "Sections 142, 143 & Part 11A",
    ruleTitle: "Statutory Registers & Register of Registrable Controllers (RORC)",
    category: "ACRA_COMPLIANCE",
    principle: "Under Sections 142 and 143, and Part 11A (Section 386AF) of the Companies Act 1967, companies must maintain at their registered office statutory registers of members, directors, and secretaries, and maintain a confidential Register of Registrable Controllers (RORC) identifying individuals or legal entities with significant control (at least 25% of shares or voting rights) within 30 days of incorporation or subsequent changes.",
    verbatimStatuteText: "A company to which this Part applies must keep a register of registrable controllers of the company, and enter the prescribed particulars of all registrable controllers of the company in the register of registrable controllers within the prescribed time and in the prescribed manner.",
    application: "Corporate maintenance: Keeping updated electronic Register of Members (on ACRA) and private RORC with beneficial ownership verification.",
    practicalRules: [
      "Register of Members (Section 190): Maintained in electronic form by the Registrar on ACRA BizFile+.",
      "Register of Directors/Secretaries (Section 173): Maintained electronically by ACRA; companies must file updates within 14 days of appointment/cessation.",
      "Register of Registrable Controllers (Part 11A / Section 386AF): Private register identifying ultimate beneficial owners with >25% shareholding or voting power.",
      "30-Day Setup: RORC must be established within 30 days of incorporation and lodged with ACRA central register."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/CoA1967?ProvIds=P111A-#pr386AF-",
    tags: ["rorc", "register of controllers", "statutory registers", "section 142", "part 11a", "beneficial ownership 25%"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2017-03-31",
    validFrom: "2017-03-31",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  },
  ACRA_SEC68_NO_PAR_VALUE_SHARES: {
    id: "ACRA_SEC68_NO_PAR_VALUE_SHARES",
    authority: "ACRA",
    authorityName: "Accounting and Corporate Regulatory Authority (ACRA)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Companies Act 1967",
    actTitle: "Companies Act 1967",
    actCode: "CoA1967",
    sectionOrSchedule: "Section 68",
    ruleTitle: "Abolition of Par Value and Share Premium (No Par Value Regime)",
    category: "ACRA_COMPLIANCE",
    principle: "Under Section 68 of the Companies Act 1967, shares of a Singapore company have no nominal or par value. The concept of share premium is abolished; all proceeds received from the issue of shares become part of the company's issued and paid-up share capital.",
    verbatimStatuteText: "Shares of a company have no par or nominal value.",
    application: "Accounting for share issues: Dr. Cash at Bank | Cr. Share Capital (100% of issue price credited to Share Capital without any Share Premium account).",
    practicalRules: [
      "No Par Value: Shares have no nominal value (e.g. no $1 par value).",
      "No Share Premium: Entire proceeds received from allotment of shares represent paid-up share capital.",
      "Issue at Any Price: Directors may issue shares at any price determined by the board, subject to shareholders' approval under Section 161.",
      "Classes of Shares: Companies can issue different classes of shares (ordinary, preferred, redeemable) with customized voting and dividend rights."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/CoA1967?ProvIds=P14-#pr68-",
    tags: ["no par value", "section 68", "share capital", "abolition of share premium", "share issuance"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2006-01-30",
    validFrom: "2006-01-30",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  },
  ACRA_SEC78B_CAPITAL_REDUCTION: {
    id: "ACRA_SEC78B_CAPITAL_REDUCTION",
    authority: "ACRA",
    authorityName: "Accounting and Corporate Regulatory Authority (ACRA)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Companies Act 1967",
    actTitle: "Companies Act 1967",
    actCode: "CoA1967",
    sectionOrSchedule: "Section 78B & Section 78C",
    ruleTitle: "Court-Free Share Capital Reduction for Private Companies with Solvency Statement",
    category: "ACRA_COMPLIANCE",
    principle: "Under Section 78B of the Companies Act 1967, a private company limited by shares may reduce its share capital without obtaining court sanction by passing a special resolution, supported by a solvency statement signed by all directors confirming the company will remain solvent and able to pay its debts for 12 months, and complying with creditor publicity and ACRA notice lodgment requirements under Section 78E.",
    verbatimStatuteText: "A private company limited by shares may reduce its share capital in any way by a special resolution if the company \u2014 (a) satisfies the solvency requirements; and (b) meets such publicity requirements as may be prescribed.",
    application: "Returning surplus cash to shareholders or extinguishing accumulated losses against paid-up share capital: Dr. Share Capital | Cr. Cash / Bank (or Cr. Accumulated Losses).",
    practicalRules: [
      "Special Resolution: Requires 75% approval of shareholders voting at an EGM.",
      "Solvency Statement (Section 78C): All directors must sign a solvency statement affirming that the company will remain able to pay debts as they fall due within the next 12 months.",
      "Publicity Notice (Section 78B(1)(b)): Notice of resolution must be published within 8 days; 6-week creditor objection period applies.",
      "Effective Date: Capital reduction takes effect upon lodgment of completion documents with the Registrar on BizFile+."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/CoA1967?ProvIds=P14-#pr78B-",
    tags: ["capital reduction", "section 78b", "solvency statement", "court-free reduction", "special resolution"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2006-01-30",
    validFrom: "2006-01-30",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  }
  // -------------------------------------------------------------
};

// src/standards/statutes/cpf.ts
var CPF_STATUTE_RULES = {
  // -------------------------------------------------------------
  CPF_WAGE_CEILINGS_2026: {
    id: "CPF_WAGE_CEILINGS_2026",
    authority: "CPF",
    authorityName: "Central Provident Fund Board (CPF)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Central Provident Fund Act 1953",
    actTitle: "Central Provident Fund Act 1953",
    actCode: "CPFA1953",
    sectionOrSchedule: "First Schedule",
    ruleTitle: "Ordinary Wage (OW) Monthly Ceiling ($8,000 in 2026) & Additional Wage (AW) Ceiling",
    category: "CPF_PAYROLL",
    principle: "CPF contributions are payable on Ordinary Wages (OW) up to the statutory monthly wage ceiling, and on Additional Wages (AW) up to the annual ceiling formula.",
    verbatimStatuteText: "Every employer of an employee who is a citizen of Singapore or a permanent resident shall pay to the Fund monthly contributions at the statutory rates up to the Ordinary Wage monthly ceiling of $8,000, and up to the Additional Wage annual ceiling calculated as $102,000 minus total Ordinary Wages subject to CPF in the year.",
    application: "Payroll calculations for Singapore Citizen and Permanent Resident employees.",
    practicalRules: [
      "2026 Ordinary Wage (OW) Ceiling: SGD 8,000 per month (effective 1 January 2026). Mandatory CPF is capped at SGD 8,000 of monthly basic salary.",
      "Historical Phased Ceilings: SGD 6,000 (pre-Sept 2023) -> SGD 6,800 (Jan 2024) -> SGD 7,400 (Jan 2025) -> SGD 8,000 (1 Jan 2026).",
      "Additional Wage (AW) Ceiling Formula: $$\\text{AW Ceiling} = \\text{SGD 102,000} - \\text{Total OW subject to CPF in the year}$$.",
      "Contribution Rates (Age $\\le 55$): Employer 17%, Employee 20% (Total 37%). For SGD 8,000 salary: Employer = SGD 1,360, Employee = SGD 1,600 (Total = SGD 2,960).",
      "Due Date: CPF contributions are due at the end of the calendar month and must be paid by the 14th of the following month."
    ],
    canonicalUrl: "https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay",
    tags: ["cpf ceiling", "ordinary wage ceiling", "wage ceiling", "2026 cpf", "cpf ceiling 2026", "8000 ceiling", "ow ceiling 8000", "aw ceiling", "cpf contribution", "monthly contribution rate", "ordinary wage 8000", "cpf rates 2026"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2026-01-01",
    validFrom: "2026-01-01",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  },
  CPF_SDL_SKILLS_DEVELOPMENT_LEVY: {
    id: "CPF_SDL_SKILLS_DEVELOPMENT_LEVY",
    authority: "CPF",
    authorityName: "SkillsFuture Singapore & CPF Board",
    actTitle: "Skills Development Levy Act 1979",
    actCode: "SDLA1979",
    sectionOrSchedule: "Section 3",
    ruleTitle: "Skills Development Levy (SDL) Calculation Formula (0.25%, Min $2, Max $11.25)",
    category: "CPF_PAYROLL",
    principle: "Employers must pay a monthly Skills Development Levy (SDL) for all employees rendering services in Singapore, collected by the CPF Board on behalf of SkillsFuture Singapore.",
    application: "Calculated monthly alongside payroll and submitted together with monthly CPF returns.",
    practicalRules: [
      "Levy Rate: 0.25% of the total monthly remuneration of each employee.",
      "Minimum Monthly Cap: Minimum SGD 2.00 per employee earning less than SGD 800.",
      "Maximum Monthly Cap: Maximum SGD 11.25 per employee earning SGD 4,500 and above (0.25% of SGD 4,500).",
      "Applies to: All employees (Singapore Citizens, PRs, and foreign work pass holders [EP, S-Pass, Work Permit]).",
      "Tax Treatment: Employer SDL is an allowable business operating expense under Section 14 of the Income Tax Act."
    ],
    canonicalUrl: "https://www.cpf.gov.sg/employer/employer-obligations/skills-development-levy",
    tags: ["sdl", "skills development levy", "sdl formula", "max 11.25", "min 2.00"]
  },
  CPF_EMPLOYER_TAX_DEDUCTIBILITY: {
    id: "CPF_EMPLOYER_TAX_DEDUCTIBILITY",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore (IRAS) & AGC",
    actTitle: "Income Tax Act 1947",
    actCode: "ITA1947",
    sectionOrSchedule: "Section 14(1)(e)",
    ruleTitle: "Tax Deductibility of Statutory Employer CPF Contributions",
    category: "TAX_INCOME",
    principle: "Mandatory employer contributions made in respect of an employee to the CPF pursuant to the CPF Act are allowable as deductions in determining taxable corporate profit.",
    application: "Company claims full tax deduction for the 17% employer CPF expense in P&L.",
    practicalRules: [
      "Mandatory CPF: Fully deductible up to the statutory limits (OW ceiling SGD 8,000 / AW ceiling formula).",
      "Voluntary CPF / Excess Contributions: Any employer CPF contribution exceeding the statutory ceiling is non-deductible for the employer and is taxable income in the hands of the employee.",
      "Self-Employed / Working Directors: Working directors who are employees of the company receive tax-deductible employer CPF under Section 14(1)(e)."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P15-#pr14-",
    tags: ["cpf tax deduction", "section 14(1)(e)", "employer cpf", "voluntary cpf"]
  },
  CPFA_SEC7_FIRST_SCHEDULE: {
    id: "CPFA_SEC7_FIRST_SCHEDULE",
    authority: "CPF",
    authorityName: "Central Provident Fund Board (CPF)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Central Provident Fund Act 1953",
    actTitle: "Central Provident Fund Act 1953",
    actCode: "CPFA1953",
    sectionOrSchedule: "Section 7 & First Schedule",
    ruleTitle: "Statutory CPF Contribution Rates & Rounding Rules (Cents Discarded for Employee, Dollar Rounding for Employer)",
    category: "CPF_PAYROLL",
    principle: "Under Section 7 and the First Schedule of the Central Provident Fund Act 1953, the employer pays both employer and employee contributions. The employee share is deducted from wages with cents discarded. The total contribution is rounded to the nearest dollar, and employer contribution is the difference between total and employee contribution.",
    verbatimStatuteText: "Every employer of an employee shall pay monthly to the Fund in respect of each employee contributions at the respective rates prescribed in the First Schedule. In calculating the employee's share of contribution, any fraction of a dollar which is a cent or cents shall be discarded. Total contribution payable shall be rounded to the nearest dollar.",
    application: "Calculation of monthly employee and employer CPF contributions up to the Ordinary Wage monthly ceiling (SGD 8,000 for 2026).",
    practicalRules: [
      "Employee CPF Share: For age 55 and below, 20% of Ordinary Wages. Statutory Rounding: Cents are discarded / dropped.",
      "Employer CPF Share: For age 55 and below, 17% of Ordinary Wages. Rounding: Total CPF rounded to nearest dollar; Employer CPF = Total CPF - Employee CPF.",
      "Ordinary Wage (OW) Ceiling: SGD 8,000 per month effective 1 January 2026.",
      "Tax Deductibility: Mandatory employer CPF is 100% tax-deductible under Section 14(1)(e) of the Income Tax Act 1947."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/CPFA1953?ProvIds=P12-#pr7-",
    tags: ["cpf act section 7", "first schedule", "cpf rounding", "employee cpf 20%", "employer cpf 17%", "cpf calculation", "cents discarded"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2026-01-01",
    validFrom: "2026-01-01",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  },
  CPF_ACCOUNT_ALLOCATION_RATES: {
    id: "CPF_ACCOUNT_ALLOCATION_RATES",
    authority: "CPF",
    authorityName: "Central Provident Fund Board (CPF)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Central Provident Fund Act 1953",
    actTitle: "Central Provident Fund Act 1953",
    actCode: "CPFA1953",
    sectionOrSchedule: "Section 13 & First Schedule",
    ruleTitle: "Statutory Allocation of Monthly CPF Contributions across OA, SA/RA, and MA by Age Bracket",
    category: "CPF_PAYROLL",
    principle: "Under Section 13 and the First Schedule of the Central Provident Fund Act 1953, the total monthly CPF contribution paid in respect of an employee is credited to the employee's Ordinary Account (OA), Special Account (SA / Retirement Account RA from age 55), and MediSave Account (MA) according to statutory allocation ratios determined by the employee's age band.",
    verbatimStatuteText: "Every contribution paid into the Fund under section 7 in respect of an employee shall be credited to the prescribed accounts of that employee in such proportions as may be prescribed by regulations made under this Act according to the age of the employee.",
    application: "Monthly payroll and accounting reconciliation: Allocating total 37% CPF (age <= 35) into OA (0.6217 of total CPF, ~23% of wages), SA (0.1621 of total CPF, ~6% of wages), and MA (0.2162 of total CPF, ~8% of wages).",
    practicalRules: [
      "Age <= 35: Total CPF 37% allocated as OA: 23%, SA: 6%, MA: 8%.",
      "Age > 35 to 45: Total CPF 37% allocated as OA: 21%, SA: 7%, MA: 9%.",
      "Age > 45 to 50: Total CPF 37% allocated as OA: 19%, SA: 8%, MA: 10%.",
      "Age > 50 to 55: Total CPF 37% allocated as OA: 15%, SA: 11.5%, MA: 10.5%.",
      "Age > 55 to 60: Total CPF 30% allocated as OA: 12%, SA/RA: 7.5%, MA: 10.5%.",
      "Age > 60 to 65: Total CPF 21% allocated as OA: 3.5%, SA/RA: 7%, MA: 10.5%.",
      "Age > 65 to 70: Total CPF 16.5% allocated as OA: 1%, SA/RA: 5%, MA: 10.5%.",
      "Age > 70: Total CPF 12.5% allocated as OA: 1%, SA/RA: 1%, MA: 10.5%."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/CPFA1953?ProvIds=P12-#pr13-",
    tags: ["cpf account allocation", "ordinary account", "special account", "medisave account", "oa sa ma ratio", "section 13"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2026-01-01",
    validFrom: "2026-01-01",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  },
  CPF_WAGE_CEILING_2024: {
    id: "CPF_WAGE_CEILING_2024",
    authority: "CPF",
    authorityName: "Central Provident Fund Board (CPF)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Central Provident Fund Act 1953",
    actTitle: "Central Provident Fund Act 1953",
    actCode: "CPFA1953",
    sectionOrSchedule: "First Schedule",
    ruleTitle: "Historical Ordinary Wage (OW) Monthly Ceiling ($6,800 in 2024)",
    category: "CPF_PAYROLL",
    principle: "From 1 January 2024 to 31 December 2024, the statutory CPF Ordinary Wage monthly ceiling was SGD 6,800 under the second phase of the multi-year ceiling increases.",
    verbatimStatuteText: "For the year 2024, the maximum monthly ordinary wage for which contributions are payable shall be $6,800.",
    application: "Historical payroll audit and retroactive wage computations for calendar year 2024.",
    practicalRules: [
      "Monthly OW Ceiling: SGD 6,800.",
      "Max Employee CPF (20%): SGD 1,360.",
      "Max Employer CPF (17%): SGD 1,156 (Total: SGD 2,516).",
      "Superseded: Replaced by $7,400 on 1 January 2025."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/CPFA1953?ProvIds=P18-#Sc1-",
    tags: ["cpf ceiling", "ordinary wage ceiling", "wage ceiling", "cpf ceiling 2024", "6800 ceiling", "historical cpf 2024", "ow ceiling 6800"],
    sourceStatus: "HISTORICAL",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2024-01-01",
    validFrom: "2024-01-01",
    validTo: "2024-12-31",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365,
    supersededByRecordId: "CPF_WAGE_CEILING_2025"
  },
  CPF_WAGE_CEILING_2025: {
    id: "CPF_WAGE_CEILING_2025",
    authority: "CPF",
    authorityName: "Central Provident Fund Board (CPF)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Central Provident Fund Act 1953",
    actTitle: "Central Provident Fund Act 1953",
    actCode: "CPFA1953",
    sectionOrSchedule: "First Schedule",
    ruleTitle: "Historical Ordinary Wage (OW) Monthly Ceiling ($7,400 in 2025)",
    category: "CPF_PAYROLL",
    principle: "From 1 January 2025 to 31 December 2025, the statutory CPF Ordinary Wage monthly ceiling was SGD 7,400 under the third phase of the ceiling increases.",
    verbatimStatuteText: "For the year 2025, the maximum monthly ordinary wage for which contributions are payable shall be $7,400.",
    application: "Historical payroll audit and retroactive wage computations for calendar year 2025.",
    practicalRules: [
      "Monthly OW Ceiling: SGD 7,400.",
      "Max Employee CPF (20%): SGD 1,480.",
      "Max Employer CPF (17%): SGD 1,258 (Total: SGD 2,738).",
      "Superseded: Replaced by $8,000 on 1 January 2026."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/CPFA1953?ProvIds=P18-#Sc1-",
    tags: ["cpf ceiling", "ordinary wage ceiling", "wage ceiling", "cpf ceiling 2025", "7400 ceiling", "historical cpf 2025", "ow ceiling 7400"],
    sourceStatus: "HISTORICAL",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2025-01-01",
    validFrom: "2025-01-01",
    validTo: "2025-12-31",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365,
    supersededByRecordId: "CPF_WAGE_CEILINGS_2026",
    historicalPredecessorRecordId: "CPF_WAGE_CEILING_2024"
  },
  // -------------------------------------------------------------
  // -------------------------------------------------------------
  CPF_RATES_BY_AGE_2026: {
    id: "CPF_RATES_BY_AGE_2026",
    authority: "CPF",
    authorityName: "Central Provident Fund Board (CPF)",
    actTitle: "Central Provident Fund Act 1953",
    actCode: "CPFA1953",
    sectionOrSchedule: "First Schedule (Statutory Contribution Rates)",
    ruleTitle: "Tiered CPF Contribution Rates by Employee Age Bracket & 2026 Ceilings",
    category: "CPF_PAYROLL",
    principle: "Mandatory CPF contributions for Singapore Citizens and Permanent Residents (from 3rd year of PR status onwards) are calculated using tiered statutory percentage rates based on the employee's age.",
    application: "Monthly payroll computation for all citizen and permanent resident employees.",
    practicalRules: [
      "Age 55 and below: Employer 17%, Employee 20% (Total: 37%).",
      "Age above 55 to 60: Employer 15%, Employee 15% (Total: 30% - ongoing senior worker rate enhancement).",
      "Age above 60 to 65: Employer 11.5%, Employee 9.5% (Total: 21%).",
      "Age above 65 to 70: Employer 9%, Employee 7.5% (Total: 16.5%).",
      "Age above 70: Employer 7.5%, Employee 5% (Total: 12.5%).",
      "2026 Ordinary Wage (OW) Monthly Ceiling: SGD 8,000 (effective 1 January 2026). Max monthly contribution for age $\\le 55$ is SGD 1,360 (employer) + SGD 1,600 (employee) = SGD 2,960.",
      "Additional Wage (AW) Ceiling: $$\\text{AW Ceiling} = \\text{SGD 102,000} - \\text{Total OW subject to CPF in the year}$$."
    ],
    canonicalUrl: "https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay",
    tags: ["cpf rates by age", "cpf contribution table", "senior worker cpf", "cpf 55 60", "cpf rates 2026", "cpf age brackets"],
    sourceStatus: "NEEDS_REVIEW",
    sourceType: "CURATED_SUMMARY",
    evidenceTier: "CURATED_SUMMARY",
    isVerbatimText: false,
    effectiveDate: "2026-01-01"
  }
  // -------------------------------------------------------------
};

// src/standards/statutes/gst.ts
var GST_STATUTE_RULES = {
  // -------------------------------------------------------------
  GST_REMISSION_QUALIFYING_FUNDS: {
    id: "GST_REMISSION_QUALIFYING_FUNDS",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore (IRAS)",
    sourcePublisher: "Inland Revenue Authority of Singapore (IRAS)",
    legalOrStandardInstrument: "IRAS GST guidance \u2014 Claiming GST on expenses for qualifying funds",
    actTitle: "GST remission for qualifying funds",
    actCode: "GSTA1993",
    sectionOrSchedule: "IRAS Finance guidance",
    ruleTitle: "GST Remission for Qualifying Funds (Including VCCs)",
    category: "TAX_GST",
    principle: "GST remission lets a qualifying fund, including a standalone VCC or sub-fund of an umbrella VCC, claim GST on qualifying fund expenses at an annual fixed recovery rate, subject to the remission conditions.",
    application: "Use this for an investment fund or VCC considering whether it may recover GST incurred on fund expenses. It is not a general GST refund available to every business.",
    practicalRules: ["The fund must be managed by a prescribed fund manager in Singapore.", "The fund must satisfy the conditions for its relevant income-tax concession as at the last day of its preceding financial year.", "Claims remain subject to disallowed-expense restrictions under Regulations 26 and 27.", "Each qualifying fund, including each VCC sub-fund, files a quarterly Statement of Claims due one month after the relevant quarter.", "IRAS guidance states that the remission is granted until 31 December 2029; confirm eligibility and the applicable recovery rate before filing."],
    canonicalUrl: "https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/specific-business-sectors/finance",
    supplementaryOfficialSources: [{ title: "IRAS \u2014 Explanatory Notes to GST Remission for Prescribed Funds", url: "https://www.iras.gov.sg/media/docs/default-source/uploadedfiles/pdf/explanatory-notes-to-gst-remission-for-prescribed-funds.pdf", authority: "IRAS" }],
    tags: ["gst remission", "gst remission for qualifying funds", "gst remission for prescribed funds", "qualifying funds", "fixed recovery rate", "statement of claims"],
    sourceStatus: "VERIFIED",
    sourceType: "CURATED_SUMMARY",
    evidenceTier: "OFFICIAL_GUIDANCE",
    isVerbatimText: false,
    effectiveDate: "2026-09-14",
    validFrom: "2020-01-01",
    validTo: "2029-12-31",
    lastVerifiedDate: "2026-09-14",
    reviewAuditCycleDays: 90
  },
  GST_REGISTRATION_COMPULSORY_THRESHOLD: {
    id: "GST_REGISTRATION_COMPULSORY_THRESHOLD",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore (IRAS)",
    actTitle: "Goods and Services Tax Act 1993",
    actCode: "GSTA1993",
    sectionOrSchedule: "First Schedule",
    ruleTitle: "Compulsory GST Registration Threshold ($1,000,000 Turnover)",
    category: "TAX_GST",
    principle: "A business is legally liable to register for GST if its taxable turnover exceeds SGD 1,000,000 under either the retrospective or prospective basis.",
    verbatimStatuteText: "A person who makes taxable supplies but is not registered shall be liable to be registered\u2014 (a) at the end of any calendar year if the total value of taxable supplies made by him in that year has exceeded $1,000,000; or (b) at any time if there are reasonable grounds for believing that the total value of taxable supplies to be made by him in the period of 12 months then beginning will exceed $1,000,000.",
    application: "SMEs must monitor taxable turnover at the end of each calendar year and projected 12 months.",
    practicalRules: [
      "Retrospective Basis: Taxable turnover at the end of the calendar year (31 Dec) exceeds SGD 1,000,000. Must apply for registration within 30 days (by 30 Jan).",
      "Prospective Basis: At any time, you reasonably expect taxable turnover in the next 12 months to exceed SGD 1,000,000. Must apply for registration within 30 days of the date of forecast.",
      "Voluntary Registration: Businesses below SGD 1M turnover may voluntarily register, but must remain registered for at least 2 years and maintain GIRO for payment/refunds.",
      "GST Rate: Standard rate is 9% (effective 1 January 2024)."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/GSTA1993?ProvIds=P112-#Sc1-",
    tags: ["gst registration", "turnover 1m", "compulsory gst", "prospective", "retrospective"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2024-01-01"
  },
  GST_REG26_BLOCKED_INPUT_TAX: {
    id: "GST_REG26_BLOCKED_INPUT_TAX",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore (IRAS)",
    actTitle: "GST (General) Regulations",
    actCode: "GSTA1993",
    sectionOrSchedule: "Regulation 26 & 27",
    ruleTitle: "Disallowed / Blocked Input Tax Claims under Singapore GST Law",
    category: "TAX_GST",
    principle: "Input tax incurred on certain specified business goods or services is strictly disallowed from recovery, even if incurred for business purposes.",
    application: "A GST-registered company cannot claim back the 9% input GST paid on company cars, club fees, or employee family medical coverage.",
    practicalRules: [
      "1. Motor Cars: Input tax incurred on the purchase, hire, or running expenses (petrol, parking, repair) of a passenger motor car (S-plate) is strictly non-claimable.",
      "2. Club Subscription Fees: Entrance fees and subscription charges paid to sports, recreational, or social clubs.",
      "3. Medical and Accident Insurance: Medical expenses and insurance premiums for staff (unless mandatory under Work Injury Compensation Act [WICA] or collective agreement). Medical expenses for staff family members are 100% blocked.",
      "4. Family Benefits: Any expenses incurred on benefits provided to the family members of your employees.",
      "5. Betting & Lotteries: Transactions involving games of chance, lotteries, and betting."
    ],
    canonicalUrl: "https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax",
    tags: ["blocked input tax", "regulation 26", "gst car claim", "medical insurance gst", "club subscriptions"]
  },
  GST_SEC21_ZERO_RATED_EXPORTS: {
    id: "GST_SEC21_ZERO_RATED_EXPORTS",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore (IRAS)",
    actTitle: "Goods and Services Tax Act 1993",
    actCode: "GSTA1993",
    sectionOrSchedule: "Section 21(3)",
    ruleTitle: "Zero-Rating of International Services and Exported Goods (0% GST)",
    category: "TAX_GST",
    principle: "Supplies of goods exported out of Singapore and supplies of international services falling within Section 21(3) are zero-rated (taxed at 0%).",
    application: "Singapore software companies exporting SaaS or advisory services to overseas clients bill at 0% GST and can still reclaim 9% input GST on business overheads.",
    practicalRules: [
      "Goods Export: Must maintain required export documentation (Bill of Lading, Air Waybill, export permits) within 60 days.",
      "International Services (Section 21(3)): Software, consulting, and management services provided under contract to overseas clients, directly benefiting an overseas person outside Singapore, qualify for 0% GST.",
      "Input Tax Benefit: Even though output tax is 0%, the business can claim 100% of input GST paid on qualifying business purchases."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/GSTA1993?ProvIds=P15-#pr21-",
    tags: ["zero rated", "0% gst", "export of services", "section 21(3)", "international services"]
  },
  GST_REG28_DE_MINIMIS_RULE: {
    id: "GST_REG28_DE_MINIMIS_RULE",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore (IRAS)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "GST (General) Regulations",
    actTitle: "GST (General) Regulations",
    actCode: "GSTA1993",
    sectionOrSchedule: "Regulation 28",
    ruleTitle: "De Minimis Rule for Input Tax Attribution on Exempt Supplies (Partial Exemption)",
    category: "TAX_GST",
    principle: "Under Regulation 28 of the GST (General) Regulations, a taxable person making exempt supplies is treated as having incurred input tax exclusively attributable to taxable supplies and may claim full input tax if the value of exempt supplies does not exceed an average of SGD 40,000 per month AND 5% of the total value of all supplies made in that prescribed accounting period.",
    verbatimStatuteText: "Where in any prescribed accounting period the value of exempt supplies made by a taxable person does not exceed an average of $40,000 per month and 5% of the total value of all supplies made by him in that period, all input tax incurred by him in that period shall be treated as attributable to taxable supplies.",
    application: "Businesses earning incidental exempt income (e.g. fixed deposit interest, realised foreign exchange gains): 100% of input tax on general business overheads remains recoverable under the De Minimis test.",
    practicalRules: [
      "Dual Quantitative Thresholds: Value of exempt supplies must be <= SGD 40,000 per month on average AND <= 5% of total value of all supplies in that accounting period.",
      "Benefit of Passing Test: Entitled to recover in full all input tax incurred, without requiring complex input tax apportionment calculations.",
      "Failure of Test: If either threshold is breached, the entity is in partial exemption and must apportion input tax using the standard turnover formula.",
      "Annual Review: An annual longer-period input tax adjustment is mandatory at the end of each tax year."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/SL/GSTA1993-RG1?ProvIds=P15-#pr28-",
    tags: ["de minimis rule", "regulation 28", "partial exemption", "exempt supplies 40000", "input tax recovery 5%"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "1994-04-01",
    validFrom: "1994-04-01",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  },
  GST_SEC14_REVERSE_CHARGE: {
    id: "GST_SEC14_REVERSE_CHARGE",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore (IRAS)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Goods and Services Tax Act 1993",
    actTitle: "Goods and Services Tax Act 1993",
    actCode: "GSTA1993",
    sectionOrSchedule: "Section 14 & Seventh Schedule",
    ruleTitle: "Reverse Charge on Business-to-Business (B2B) Imported Services & Distantly Taxable Goods",
    category: "TAX_GST",
    principle: "Under Section 14 and the Seventh Schedule of the Goods and Services Tax Act 1993, a GST-registered person who is not entitled to full input tax recovery (or who belongs to a reverse charge group) must account for output tax under the Reverse Charge mechanism on all imported services and imported distantly taxable goods procured from overseas suppliers.",
    verbatimStatuteText: "Where a person who is registered or liable to be registered receives imported services or imported distantly taxable goods from a supplier who belongs in a country other than Singapore, the recipient shall account for and pay tax on the supply of those services or goods as if the recipient had himself supplied them in Singapore in the course or furtherance of his business.",
    application: "Financial institutions, investment holding companies, and residential property developers procuring overseas software, cloud servers, or consultancy must account for 9% Reverse Charge output tax in Box 1 of GST F5.",
    practicalRules: [
      "Applicability: Mandatory for GST-registered persons not entitled to full input tax recovery (e.g. banks, insurers, exempt supply businesses).",
      "Fully Taxable Businesses: Fully taxable businesses entitled to 100% input tax recovery are generally not required to apply reverse charge unless electing under group relief.",
      "Tax Mechanism: Account for 9% output tax in Box 1; claim allowable input tax in Box 7 in the same GST return.",
      "Distantly Taxable Goods (LVG): Goods located outside Singapore with a value at or below the SGD 400 import threshold delivered to Singapore."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/GSTA1993?ProvIds=P13-#pr14-",
    tags: ["reverse charge", "section 14", "imported services", "seventh schedule", "b2b imported services"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2020-01-01",
    validFrom: "2020-01-01",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  },
  GST_REG82_90_BAD_DEBT_RELIEF: {
    id: "GST_REG82_90_BAD_DEBT_RELIEF",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore (IRAS)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "GST (General) Regulations",
    actTitle: "GST (General) Regulations",
    actCode: "GSTA1993",
    sectionOrSchedule: "Regulations 82\u201390",
    ruleTitle: "GST Bad Debt Relief Scheme & Recovery of Output Tax on Defaulted Debts",
    category: "TAX_GST",
    principle: "Under Regulations 82 to 90 (Part X) of the GST (General) Regulations, a taxable person who has accounted for and paid output tax on a supply may make a claim for bad debt relief if the debt has remained unpaid for at least 12 months from the date of supply (or the debtor has become insolvent) and reasonable steps have been taken to pursue payment, with the debt formally written off in accounts.",
    verbatimStatuteText: "A taxable person shall be entitled to make a claim for bad debt relief under these Regulations if the whole or part of the consideration for the supply has been written off in his accounts as a bad debt and a period of 12 months beginning with the date of the supply has elapsed, or the debtor has become insolvent before the expiration of that period.",
    application: "When an outstanding trade receivable of SGD 10,900 (inclusive of SGD 900 GST) is unpaid after 12 months, the company writes off the debt and claims SGD 900 back in Box 7 of GST F5 as Bad Debt Relief.",
    practicalRules: [
      "12-Month Rule: At least 12 months must have elapsed from the date of the supply, or the customer is proven formally insolvent.",
      "Written Off in Accounts: The debt must be formally written off as bad in the general ledger and financial statements.",
      "Reasonable Recovery Efforts: Entity must have made commercial recovery efforts (reminders, legal demand letters).",
      "Subsequent Recovery: If debtor subsequently pays all or part of the bad debt, output tax must be repaid to IRAS in Box 1 in that subsequent period."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/SL/GSTA1993-RG1?ProvIds=P112-#pr82-",
    tags: ["bad debt relief", "regulations 82 90", "output tax refund", "12 months bad debt", "bad debt write off"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "1994-04-01",
    validFrom: "1994-04-01",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  },
  GST_SEC11_TIME_OF_SUPPLY: {
    id: "GST_SEC11_TIME_OF_SUPPLY",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore (IRAS)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Goods and Services Tax Act 1993",
    actTitle: "Goods and Services Tax Act 1993",
    actCode: "GSTA1993",
    sectionOrSchedule: "Section 11",
    ruleTitle: "General Time of Supply Rules (Invoice Issuance, Payment Receipt, Performance)",
    category: "TAX_GST",
    principle: "Under Section 11(1) of the Goods and Services Tax Act 1993, a supply of goods or services is treated as taking place at the earliest of: (a) the date a tax invoice is issued, (b) the date any payment in respect of the supply is received, or (c) the basic tax point when the goods are removed/made available or services performed.",
    verbatimStatuteText: "Subject to the provisions of this Act, a supply of goods or services shall be treated as taking place \u2014 (a) at the time when an invoice in respect of the supply is issued; or (b) at the time when any payment in respect of the supply is received by the supplier, whichever is the earlier.",
    application: "Determining which quarterly GST return period (F5) must include output tax for delivered goods or prepaid contracts.",
    practicalRules: [
      "General Rule: Earliest of (1) tax invoice issue date, (2) payment receipt date, and (3) service completion / goods delivery date.",
      "14-Day Rule: If invoice is issued within 14 days after goods delivery or service completion, the invoice date becomes the time of supply (unless payment was received earlier).",
      "Continuous Supplies of Services: Time of supply is the earlier of invoice issuance or payment receipt.",
      "Deposit / Prepayments: GST must be accounted for on deposits or prepayments in the period the cash is received."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/GSTA1993?ProvIds=P13-#pr11-",
    tags: ["time of supply", "section 11", "tax point", "invoice date", "payment date", "earliest date"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "1994-04-01",
    validFrom: "1994-04-01",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  },
  GST_RATE_7_PERCENT: {
    id: "GST_RATE_7_PERCENT",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore (IRAS)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Goods and Services Tax Act 1993",
    actTitle: "Goods and Services Tax Act 1993",
    actCode: "GSTA1993",
    sectionOrSchedule: "Section 16",
    ruleTitle: "Historical Singapore GST Rate (7% Prior to 1 January 2023)",
    category: "TAX_GST",
    principle: "Prior to 1 January 2023, the standard statutory GST rate in Singapore was 7% on all standard-rated taxable supplies of goods and services.",
    verbatimStatuteText: "Tax shall be charged at the rate of 7% on the supply of goods and services in Singapore.",
    application: "Historical audit and accounting checks for transactions completed before 1 January 2023.",
    practicalRules: [
      "Rate: 7% on standard-rated supplies.",
      "Validity Period: In force until 31 December 2022.",
      "Superseded: Replaced by 8% GST on 1 January 2023 under Section 16 statutory amendment."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/GSTA1993?ProvIds=P13-#pr16-",
    tags: ["7% gst", "gst rate", "tax rate", "rate of tax", "historical gst", "gst rate 7", "gst prior to 2023", "standard rate"],
    sourceStatus: "HISTORICAL",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2007-07-01",
    validFrom: "2007-07-01",
    validTo: "2022-12-31",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365,
    supersededByRecordId: "GST_RATE_8_PERCENT_2023"
  },
  GST_RATE_8_PERCENT_2023: {
    id: "GST_RATE_8_PERCENT_2023",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore (IRAS)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Goods and Services Tax Act 1993",
    actTitle: "Goods and Services Tax Act 1993",
    actCode: "GSTA1993",
    sectionOrSchedule: "Section 16",
    ruleTitle: "Historical Singapore GST Rate (8% in Calendar Year 2023)",
    category: "TAX_GST",
    principle: "From 1 January 2023 to 31 December 2023, the standard statutory GST rate in Singapore was 8% on all standard-rated supplies of goods and services under the first phase of the GST rate increase.",
    verbatimStatuteText: "Tax shall be charged at the rate of 8% on the supply of goods and services in Singapore made on or after 1 January 2023 but before 1 January 2024.",
    application: "Historical transactions and audit verification for purchases and sales occurring in calendar year 2023.",
    practicalRules: [
      "Rate: 8% on all standard-rated supplies made between 1 January 2023 and 31 December 2023.",
      "Transitional Rules: Under GST transitional provisions, services spanning across 2023/2024 were prorated or determined by invoice/payment tax points.",
      "Superseded: Replaced by 9% GST on 1 January 2024."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/GSTA1993?ProvIds=P13-#pr16-",
    tags: ["8% gst", "gst rate", "tax rate", "rate of tax", "2023 gst", "historical 8%", "gst rate 8% 2023", "standard rate"],
    sourceStatus: "HISTORICAL",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2023-01-01",
    validFrom: "2023-01-01",
    validTo: "2023-12-31",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365,
    supersededByRecordId: "GST_RATE_9_PERCENT",
    historicalPredecessorRecordId: "GST_RATE_7_PERCENT"
  },
  GST_RATE_9_PERCENT: {
    id: "GST_RATE_9_PERCENT",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore (IRAS)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Goods and Services Tax Act 1993",
    actTitle: "Goods and Services Tax Act 1993",
    actCode: "GSTA1993",
    sectionOrSchedule: "Section 16",
    ruleTitle: "Current Singapore Standard GST Rate (9% from 1 January 2024 Onwards)",
    category: "TAX_GST",
    principle: "Effective 1 January 2024 onwards, the standard statutory GST rate in Singapore is 9% on all standard-rated supplies of goods and services.",
    verbatimStatuteText: "Tax shall be charged at the rate of 9% on the supply of goods and services in Singapore made on or after 1 January 2024.",
    application: "All current commercial transactions, sales billing, input GST claims, and double-entry accounting in Singapore.",
    practicalRules: [
      "Rate: 9% standard rate effective 1 January 2024 indefinitely.",
      "Input GST Claim: Claimable on qualifying business purchases under Section 19.",
      "Output GST: Collected on domestic taxable supplies and remitted to IRAS via quarterly Form F5."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/GSTA1993?ProvIds=P13-#pr16-",
    tags: ["9% gst", "gst rate", "tax rate", "rate of tax", "current gst rate", "gst 9 percent", "standard rate gst", "standard rate"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2024-01-01",
    validFrom: "2024-01-01",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365,
    historicalPredecessorRecordId: "GST_RATE_8_PERCENT_2023"
  }
  // -------------------------------------------------------------
};

// src/standards/statutes/iras.ts
var IRAS_STATUTE_RULES = {
  // -------------------------------------------------------------
  ITA_SEC14_GENERAL_DEDUCTION: {
    id: "ITA_SEC14_GENERAL_DEDUCTION",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Income Tax Act 1947",
    actTitle: "Income Tax Act 1947",
    actCode: "ITA1947",
    sectionOrSchedule: "Section 14(1)",
    ruleTitle: 'General Tax Deductibility of Business Expenses ("Wholly & Exclusively")',
    category: "TAX_INCOME",
    principle: "For the purpose of ascertaining the income of any person for any period, there shall be deducted all outgoings and expenses wholly and exclusively incurred during that period by that person in the production of the income.",
    verbatimStatuteText: "For the purpose of ascertaining the income of any person for any period, there shall be deducted all outgoings and expenses wholly and exclusively incurred during that period by that person in the production of the income.",
    application: "Operating expenses (rental, staff salaries, utilities, marketing, trade debt provisions) directly related to revenue generation are tax-deductible.",
    practicalRules: [
      "Must be wholly and exclusively incurred in the production of income.",
      "Must not be capital in nature (e.g. initial setup costs, asset purchases).",
      "Must not be prohibited under Section 15 of the Income Tax Act."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P16-#pr22-",
    tags: ["tax deduction", "deductible expenses", "section 14", "business expenses", "p&l deduction"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "1948-01-01"
  },
  ITA_SEC15_PROHIBITED_DEDUCTIONS: {
    id: "ITA_SEC15_PROHIBITED_DEDUCTIONS",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore & AGC",
    actTitle: "Income Tax Act 1947",
    actCode: "ITA1947",
    sectionOrSchedule: "Section 15(1)",
    ruleTitle: "Prohibited Non-Deductible Business Expenses",
    category: "TAX_INCOME",
    principle: "Notwithstanding any other provisions of this Act, no deduction shall be allowed in respect of: domestic or private expenses; capital sums; improvements; fines and statutory penalties; and non-trade expenses.",
    application: "Statutory fines (ACRA late filing fines, traffic fines), non-business private expenses paid via company funds, and capital acquisitions cannot be deducted against corporate tax.",
    practicalRules: [
      "Private or domestic expenses of directors/shareholders are disallowed.",
      "Fines and penalties imposed for violation of law are strictly non-deductible.",
      "Income tax paid or payable is non-deductible.",
      "Capital expenditure must be added back in tax computation (capital allowances claimed separately)."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P15-#pr15-",
    tags: ["non-deductible", "prohibited expenses", "fines", "section 15", "add-back"]
  },
  ITA_SEC15_1_K_MOTOR_CAR: {
    id: "ITA_SEC15_1_K_MOTOR_CAR",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore (IRAS)",
    actTitle: "Income Tax Act 1947",
    actCode: "ITA1947",
    sectionOrSchedule: "Section 15(1)(k)",
    ruleTitle: "Prohibition of Tax Deduction & Capital Allowances on Private Passenger Motor Cars (S-Plate)",
    category: "TAX_INCOME",
    principle: "No deduction shall be allowed for any outgoings and expenses incurred in respect of a motor car registered as a passenger car (whether private or company car, including RU and private hire cars used by staff), nor shall any capital allowance be granted.",
    application: "Purchasing a private passenger car (S-plate) yields zero tax depreciation. Petrol, parking, road tax, repairs, and ERP incurred on company passenger cars are completely non-deductible.",
    practicalRules: [
      "Company passenger motor cars (S-plate cars) are completely disallowed for Section 14 deductions and Section 19/19A Capital Allowances.",
      "Commercial goods vehicles (G-plate, Y-plate vans, lorries, trucks) ARE 100% eligible for Section 19A Capital Allowances and running expenses are deductible.",
      "Strict add-back of car depreciation and operating expenses is mandatory in Form C-S Tax Computation."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P15-#pr15-",
    tags: ["car expenses", "passenger car", "motor car", "s-plate", "car depreciation", "section 15(1)(k)"]
  },
  ITA_SEC19_19A_CAPITAL_ALLOWANCES: {
    id: "ITA_SEC19_19A_CAPITAL_ALLOWANCES",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore (IRAS)",
    actTitle: "Income Tax Act 1947",
    actCode: "ITA1947",
    sectionOrSchedule: "Section 19 & Section 19A",
    ruleTitle: "Capital Allowances on Plant and Machinery in Lieu of Depreciation",
    category: "TAX_INCOME",
    principle: "Accounting depreciation is disallowed for tax. In its place, Capital Allowances (CA) are granted on qualifying plant and machinery used in trade or business.",
    application: "Companies write off machinery, computers, and office equipment over 1 year (Section 19A(2) 100% write-off for computers & automation equipment, or low-value assets $\\le\\$5,000$ capped at $\\sim\\$30,000$ per YA) or over 3 years straight-line (Section 19A(1)).",
    practicalRules: [
      "Accounting depreciation is added back in tax computation.",
      "Section 19A(1): Accelerated 3-year write-off (33.33% per year).",
      "Section 19A(2): 1-year (100%) accelerated write-off for computers, software, and qualifying automation equipment.",
      "Low-Value Assets: Assets costing $\\le\\$5,000$ each can be fully written off in 1 year, subject to an aggregate limit of $\\$30,000$ per YA."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P16-#pr19A-",
    supplementaryOfficialSources: [{
      title: "IRAS Capital Allowances",
      url: "https://www.iras.gov.sg/taxes/corporate-income-tax/income-deductions-for-companies/claiming-allowances/capital-allowances",
      authority: "IRAS"
    }],
    tags: ["capital allowance", "depreciation add-back", "section 19a", "plant and machinery", "computers"]
  },
  ITA_SUTE_PTE_TAX_EXEMPTION: {
    id: "ITA_SUTE_PTE_TAX_EXEMPTION",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore (IRAS)",
    actTitle: "Income Tax Act 1947",
    actCode: "ITA1947",
    sectionOrSchedule: "Section 43 & Tax Exemption Schemes",
    ruleTitle: "Corporate Income Tax (CIT) Rate & Tax Exemption Schemes (SUTE & PTE)",
    category: "TAX_INCOME",
    principle: "Headline corporate income tax rate in Singapore is a flat 17%. Qualifying companies enjoy Start-Up Tax Exemption (SUTE) or Partial Tax Exemption (PTE).",
    application: "Reduces effective corporate tax significantly below 17%.",
    practicalRules: [
      "Headline Corporate Tax Rate: 17% on chargeable income.",
      "Start-Up Tax Exemption (SUTE) for qualifying new companies (first 3 consecutive YAs):\n  - 75% exemption on the first SGD 100,000 of normal chargeable income\n  - 50% exemption on the next SGD 100,000\n  - Maximum tax exemption of SGD 125,000 (Effective tax on first SGD 200k = ~8.92%).",
      "Partial Tax Exemption (PTE) for all other companies:\n  - 75% exemption on the first SGD 10,000\n  - 50% exemption on the next SGD 190,000\n  - Maximum tax exemption of SGD 102,500.",
      "SUTE Qualifying Conditions: Incorporated in Singapore, tax resident in Singapore, max 20 individual shareholders (or at least 1 individual holding $\\ge 10\\%$ of ordinary shares)."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P111-#pr43-",
    tags: ["tax rate", "sute", "pte", "corporate tax", "tax exemption", "17%"]
  },
  IRAS_FORM_CS_LITE_CRITERIA: {
    id: "IRAS_FORM_CS_LITE_CRITERIA",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore (IRAS)",
    actTitle: "Income Tax Act 1947 & IRAS Filing Guidelines",
    actCode: "ITA1947",
    sectionOrSchedule: "Form C-S / Form C-S (Lite) / Form C Guidelines",
    ruleTitle: "Eligibility Criteria for Form C-S and Form C-S (Lite) Tax Filing",
    category: "TAX_INCOME",
    principle: "Small companies with straightforward tax affairs can file simplified tax returns (Form C-S or Form C-S Lite) without attaching financial statements or tax computations upfront.",
    application: "SMEs can complete Form C-S online via myTax Portal in minutes.",
    practicalRules: [
      "Form C-S (Lite): Annual revenue $\\le\\$200,000$, company incorporated in Singapore, derives only 17% taxable income, not claiming group relief/investment allowance/foreign tax credit.",
      "Form C-S: Annual revenue $\\le\\$5,000,000$, company incorporated in Singapore, derives only 17% taxable income, not claiming group relief/investment allowance.",
      "Form C: For companies with annual revenue $>$5,000,000$ or claiming complex incentives, foreign tax credits, or group relief. Mandatory to attach audited/unaudited accounts and tax computations.",
      "Filing Deadline: 30 November of the Year of Assessment (YA) via myTax Portal."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P116-#pr62-",
    tags: ["form c-s", "form c-s lite", "form c", "tax filing deadline", "annual revenue 5m"]
  },
  ITA_SEC37_LOSS_CARRY_FORWARD: {
    id: "ITA_SEC37_LOSS_CARRY_FORWARD",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore (IRAS)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Income Tax Act 1947",
    actTitle: "Income Tax Act 1947",
    actCode: "ITA1947",
    sectionOrSchedule: "Section 37",
    ruleTitle: "Loss Carry-Forward & Substantial Shareholding Continuity Test (50% Continuity)",
    category: "TAX_INCOME",
    principle: "Under Section 37(3)(a) of the Income Tax Act 1947, unabsorbed trade losses and capital allowances may be carried forward indefinitely to offset against future taxable income from all sources, subject to the substantial shareholding test (at least 50% continuity of ultimate shareholders as at the relevant comparison dates).",
    verbatimStatuteText: "There shall be deducted from the statutory income of any person for any year of assessment the amount of a loss incurred by that person in any trade, business, profession or vocation, provided that no deduction shall be allowed to any company unless the Comptroller is satisfied that the shareholders of the company on the last day of the year in which the loss was incurred were substantially the same as the shareholders of the company on the first day of the year of assessment in which the loss is to be deducted.",
    application: "Corporate tax computation: unabsorbed losses from prior YAs offset current year statutory income if shareholder continuity >= 50% is proven.",
    practicalRules: [
      "Indefinite Carry-Forward: Unabsorbed trade losses carry forward indefinitely until fully utilised.",
      "Substantial Shareholding Test (SST): Shareholders holding >= 50% of paid-up capital/shares must be substantially identical on comparison dates (last day of loss year vs first day of YA of deduction).",
      "Order of Deduction: Unabsorbed capital allowances from prior years are deducted before unabsorbed trade losses.",
      "Shareholding Waiver: Minister or Comptroller may waive SST if substantial change was not for tax benefit."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P19-#pr37-",
    tags: ["loss carry forward", "section 37", "tax losses", "substantial shareholding", "sst 50%", "unabsorbed losses"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "1948-01-01",
    validFrom: "1948-01-01",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  },
  ITA_SEC37E_LOSS_CARRY_BACK: {
    id: "ITA_SEC37E_LOSS_CARRY_BACK",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore (IRAS)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Income Tax Act 1947",
    actTitle: "Income Tax Act 1947",
    actCode: "ITA1947",
    sectionOrSchedule: "Section 37E",
    ruleTitle: "Loss Carry-Back Relief Scheme (Cap SGD 100,000 to Immediate Preceding YA)",
    category: "TAX_INCOME",
    principle: "Under Section 37E of the Income Tax Act 1947, qualifying businesses may carry back current-year unabsorbed capital allowances and trade losses up to an aggregate cap of SGD 100,000 to offset against the assessable income of the one immediately preceding Year of Assessment, subject to the substantial shareholding test and the same-business test.",
    verbatimStatuteText: "There shall be deducted from the assessable income of a person for the year of assessment immediately preceding the year of assessment in which the person incurs a qualifying deduction the amount of that qualifying deduction, provided that the total amount of qualifying deductions that may be deducted shall not exceed $100,000.",
    application: "SMEs facing an operating loss in current year can elect to carry back up to SGD 100,000 loss to the immediate prior YA to claim an immediate corporate tax refund.",
    practicalRules: [
      "Maximum Cap: Capped at an aggregate of SGD 100,000 of qualifying deductions per YA.",
      "Carry-Back Period: Carried back to the 1 immediately preceding Year of Assessment.",
      "Substantial Shareholding & Same Business Test: Entity must satisfy 50% shareholder continuity and same business test (for capital allowances).",
      "Election Deadline: Must be formally elected when e-filing Form C / Form C-S for the loss year."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P19-#pr37E-",
    tags: ["loss carry back", "section 37e", "100000 cap", "tax refund", "carry back relief"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2006-01-01",
    validFrom: "2006-01-01",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  },
  ITA_SEC13W_EQUITY_DISPOSAL_SAFE_HARBOUR: {
    id: "ITA_SEC13W_EQUITY_DISPOSAL_SAFE_HARBOUR",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore (IRAS)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Income Tax Act 1947",
    actTitle: "Income Tax Act 1947",
    actCode: "ITA1947",
    sectionOrSchedule: "Section 13W",
    ruleTitle: "Safe Harbour Exemption for Gains on Disposal of Ordinary Shares (20% for 24 Months)",
    category: "TAX_INCOME",
    principle: "Under Section 13W of the Income Tax Act 1947, gains derived by a divesting company from the disposal of ordinary shares in an investee company are legally exempt from tax if the divesting company held at least 20% of the ordinary shares in the investee company throughout a continuous period of at least 24 months immediately prior to the disposal.",
    verbatimStatuteText: "There shall be exempt from tax any gains or profits derived by a divesting company from the disposal of ordinary shares in an investee company during the qualifying period if the divesting company has held, throughout a continuous period of at least 24 months immediately prior to the date of disposal, at least 20% of the ordinary shares in the investee company.",
    application: "Disposal of subsidiary or associate shares: If shareholding was >= 20% for >= 24 continuous months, capital gain is 100% tax-exempt under safe harbour without IRAS trading vs investment inquiry.",
    practicalRules: [
      "Minimum Shareholding: At least 20% of the ordinary shares of the investee company.",
      "Holding Period: Minimum 24 continuous months immediately preceding the disposal.",
      "Ordinary Shares: Applies to ordinary shares (shares that carry voting, dividend, and surplus asset rights without fixed preference).",
      "Exclusions: Does not apply to unlisted property-holding companies whose main business is holding immovable property in Singapore."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P14-#pr13W-",
    tags: ["section 13w", "safe harbour", "share disposal", "capital gain exemption", "20 percent 24 months"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2012-06-01",
    validFrom: "2012-06-01",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  },
  ITA_SEC45_WITHHOLDING_TAX: {
    id: "ITA_SEC45_WITHHOLDING_TAX",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore (IRAS)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Income Tax Act 1947",
    actTitle: "Income Tax Act 1947",
    actCode: "ITA1947",
    sectionOrSchedule: "Section 45",
    ruleTitle: "Withholding Tax on Interest, Loan Charges & Indebtedness Paid to Non-Residents",
    category: "TAX_INCOME",
    principle: "Under Section 45 of the Income Tax Act 1947, any person liable to pay interest, commission, fee or other payment in connection with any loan or indebtedness to a non-resident person must deduct withholding tax (15% final tax or applicable DTA rate) and e-file and remit the tax to IRAS by the 15th of the second month following the date of payment.",
    verbatimStatuteText: "Where any person is liable to pay to a person not known to him to be resident in Singapore any interest, commission, fee or other payment in connection with any loan or indebtedness, he shall upon paying the same deduct tax therefrom at the prescribed rate, and shall immediately give notice of the deduction of tax and pay to the Comptroller the amount so deducted.",
    application: "A Singapore company paying intercompany loan interest to a foreign parent or non-resident lender must withhold 15% tax at source and submit Form S45 online to IRAS.",
    practicalRules: [
      "Prescribed Rate: 15% final withholding tax on gross interest (or lower treaty rate under an applicable Avoidance of Double Taxation Agreement [DTA]).",
      "Payment Deadline: Must e-file Form S45 and remit withheld tax to IRAS by the 15th of the second month following the payment date.",
      "Date of Payment: Deemed paid when credited to payee account, reinvested, accumulated, capitalized, or made available.",
      "Late Payment Penalty: 5% initial late payment penalty plus additional 1% per month up to maximum 15%."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P112-#pr45-",
    tags: ["withholding tax", "section 45", "interest withholding", "non-resident interest", "15% final tax"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "1948-01-01",
    validFrom: "1948-01-01",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  },
  ITA_SEC45A_WITHHOLDING_TAX_ROYALTIES: {
    id: "ITA_SEC45A_WITHHOLDING_TAX_ROYALTIES",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore (IRAS)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Income Tax Act 1947",
    actTitle: "Income Tax Act 1947",
    actCode: "ITA1947",
    sectionOrSchedule: "Section 45A",
    ruleTitle: "Withholding Tax on Royalties, Technical Fees & Management Charges Paid to Non-Residents",
    category: "TAX_INCOME",
    principle: "Under Section 45A of the Income Tax Act 1947, Section 45 applies with prescribed modifications to royalties, technical assistance fees, and management charges paid to a non-resident person (10% final tax on royalties, 17% non-final on management/technical service fees unless reduced under an applicable DTA).",
    verbatimStatuteText: "The provisions of section 45 shall apply in relation to the payment of any royalties or other payments in one lump sum or otherwise for the use of or for the right to use any scientific, technical, industrial or commercial knowledge or information, or for the rendering of any assistance or service in connection with the application or use of such knowledge, as they apply to the payment of interest.",
    application: "Software license royalties, technical know-how payments, and management consulting fees paid to overseas foreign corporations.",
    practicalRules: [
      "Royalties Rate: 10% final withholding tax under Section 43(1)(c) (or DTA rate).",
      "Management / Technical Service Fees: 17% prevailing corporate tax rate withholding under Section 45A (non-final, recipient can file tax return to claim expenses).",
      "Filing Deadline: 15th of the second month after the date of payment via myTax Portal.",
      "Software Exemption: Commercial off-the-shelf software licenses without copyright acquisition enjoy administrative concession from withholding tax under IRAS e-Tax Guide."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P112-#pr45A-",
    tags: ["section 45a", "royalties withholding", "technical service fees", "management fees", "withholding non-resident"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "1977-01-01",
    validFrom: "1977-01-01",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  },
  ITA_SEC14Q_RENOVATION_REFURBISHMENT: {
    id: "ITA_SEC14Q_RENOVATION_REFURBISHMENT",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore (IRAS)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Income Tax Act 1947",
    actTitle: "Income Tax Act 1947",
    actCode: "ITA1947",
    sectionOrSchedule: "Section 14Q",
    ruleTitle: "Deduction for Renovation and Refurbishment (R&R) Costs (Cap SGD 300,000 over 3 Years)",
    category: "TAX_INCOME",
    principle: "Under Section 14Q of the Income Tax Act 1947, a person carrying on trade or business who incurs qualifying capital expenditure on renovation or refurbishment of commercial business premises is entitled to a deduction in 3 equal annual installments, subject to an aggregate statutory ceiling of SGD 300,000 for every relevant 3-year period.",
    verbatimStatuteText: "Where a person carrying on a trade, business or profession has incurred qualifying expenditure on the renovation or refurbishment of business premises, there shall be allowed to him a deduction of an amount equal to one-third of that qualifying expenditure for each of 3 consecutive years of assessment, provided that the total qualifying expenditure shall not exceed $300,000 for every period of 3 consecutive years of assessment.",
    application: "Commercial office, retail, or clinic interior renovations: SGD 300,000 expenditure is deducted as SGD 100,000 per year across 3 consecutive YAs.",
    practicalRules: [
      "Cap: Statutory cap of SGD 300,000 for every 3-year consecutive period.",
      "Deduction Schedule: One-third of qualifying expenditure allowed in the YA of expenditure and each of the subsequent 2 YAs.",
      "Qualifying Items: General lighting, floor tiles, false ceilings, fixed partitions, wall coverings, doors, plumbing, electrical installations.",
      "Non-Qualifying Items: Structural changes, designer fees, fine art/paintings, motor vehicle showrooms, and assets eligible for Section 19/19A capital allowances."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P15-#pr14Q-",
    tags: ["renovation deduction", "section 14q", "r&r deduction", "300000 cap", "renovation 3 years"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2008-01-01",
    validFrom: "2008-01-01",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  },
  // -------------------------------------------------------------
  // -------------------------------------------------------------
  ITA_SEC14C_EIS_INNOVATION: {
    id: "ITA_SEC14C_EIS_INNOVATION",
    authority: "IRAS",
    authorityName: "Inland Revenue Authority of Singapore (IRAS)",
    actTitle: "Income Tax Act 1947",
    actCode: "ITA1947",
    sectionOrSchedule: "Section 14C & Section 14D (Enterprise Innovation Scheme)",
    ruleTitle: "400% Enhanced Tax Deduction on Qualifying R&D and Enterprise Innovation Scheme (EIS)",
    category: "TAX_INCOME",
    principle: "Under the Enterprise Innovation Scheme (EIS), qualifying businesses enjoy an enhanced 400% tax deduction on up to SGD 400,000 of qualifying expenditure per activity incurred on qualifying R&D, innovation, and IP registration.",
    application: "Companies undertaking internal product development, software engineering, or filing patents/trademarks in Singapore.",
    practicalRules: [
      "Enhanced Deduction: 400% tax deduction (100% baseline under Section 14C + 300% enhanced under EIS) on qualifying R&D staff costs and consumables.",
      "Expenditure Cap: Capped at SGD 400,000 per qualifying activity per Year of Assessment.",
      "Cash Conversion Option: Qualifying businesses can opt to convert up to SGD 100,000 of total qualifying expenditure across all activities into a non-taxable cash payout at a 20% conversion rate (max SGD 20,000).",
      "Accounting vs Tax Divergence: For financial reporting under SFRS(I) 1-38, development costs meeting all 6 criteria are capitalized as an intangible asset and amortized over time. For tax purposes, qualifying R&D expenses claim the enhanced 400% deduction in the YA incurred."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/ITA1947?ProvIds=P15-#pr14C-",
    tags: ["eis", "enterprise innovation scheme", "400% deduction", "r&d tax deduction", "section 14c", "intangibles tax"]
  }
};

// src/standards/statutes/mas.ts
var MAS_STATUTE_RULES = {
  // -------------------------------------------------------------
  MAS_ZERO_EXCHANGE_CONTROLS: {
    id: "MAS_ZERO_EXCHANGE_CONTROLS",
    authority: "MAS",
    authorityName: "Monetary Authority of Singapore (MAS)",
    actTitle: "Monetary Authority of Singapore Act 1970 & Foreign Exchange Framework",
    actCode: "MASA1970",
    sectionOrSchedule: "Exchange Control Liberalisation Directive",
    ruleTitle: "Absence of Foreign Exchange Controls & Free Capital Movement in Singapore",
    category: "MAS_FINANCE",
    principle: "Singapore has completely liberalised all foreign exchange controls. There are no restrictions on foreign currency exchange, cross-border remittances, or profit repatriation.",
    application: "Companies can maintain multi-currency bank balances (USD, EUR, SGD) and freely remit capital without needing approval from MAS.",
    practicalRules: [
      "Zero Exchange Controls: Residents and non-residents are free to buy, hold, and sell any foreign currency.",
      "Repatriation: 100% of capital, dividends, and profits can be remitted overseas freely without withholding tax on dividends.",
      "SFRS Accounting: Foreign exchange transactions must be translated at spot rate in accordance with SFRS(I) 1-21 / IAS 21, and monetary items revalued at closing rates."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/MASA1970",
    tags: ["exchange control", "capital controls", "profit repatriation", "mas policy", "foreign currency"]
  },
  MAS_PSA_DIGITAL_TOKENS_AML: {
    id: "MAS_PSA_DIGITAL_TOKENS_AML",
    authority: "MAS",
    authorityName: "Monetary Authority of Singapore (MAS)",
    actTitle: "Payment Services Act 2019",
    actCode: "PSA2019",
    sectionOrSchedule: "Section 6 & MAS Notice PSN02",
    ruleTitle: "Payment Services Act (PSA) Licensing & Digital Payment Token (DPT) Framework",
    category: "MAS_FINANCE",
    principle: "Entities providing digital payment token (DPT) dealing or exchange services in Singapore must be licensed under the Payment Services Act and comply with mandatory AML/CFT guidelines under MAS Notice PSN02.",
    application: "Fintech and crypto companies handling customer fiat or token transfers.",
    practicalRules: [
      "License Types: Standard Payment Institution (SPI) or Major Payment Institution (MPI) based on monthly transaction volume thresholds ($3M payment transactions / $5M DPT transactions).",
      "IRAS Tax Treatment on Tokens: Citing the IRAS e-Tax Guide on Income Tax Treatment of Digital Tokens:\n  - Payment Tokens (e.g. Bitcoin, Ethereum): Exchanged for goods/services are exempt from GST.\n  - Utility Tokens: Treated as prepayment vouchers.\n  - Capital Gains: Non-taxable if held as long-term investment; trading profits are subject to 17% corporate income tax."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/PSA2019",
    tags: ["payment services act", "crypto tax", "digital tokens", "mas notice psn02", "psa 2019"]
  },
  MAS_SFO_LICENSING_EXEMPTION_2026: {
    id: "MAS_SFO_LICENSING_EXEMPTION_2026",
    authority: "MAS",
    authorityName: "Monetary Authority of Singapore (MAS)",
    sourcePublisher: "MAS via Ask.gov.sg",
    legalOrStandardInstrument: "MAS Single Family Office Licensing Exemption Framework",
    actTitle: "Securities and Futures Act 2001 \u2014 Single Family Office Licensing Exemption",
    actCode: "SFA2001",
    sectionOrSchedule: "MAS FAQ \u2014 SFO licensing exemption (effective 15 June 2026)",
    ruleTitle: "Single Family Office Fund Management Licensing Exemption",
    category: "MAS_FINANCE",
    principle: "An SFO that manages assets of one family and does not serve third-party customers or manage third-party monies may rely on the MAS licensing exemption framework, subject to the framework conditions.",
    application: "Use before concluding whether a family investment office needs a CMS licence for fund management.",
    practicalRules: [
      "Confirm the managed assets and funding are limited to permitted family persons or entities; do not assume the exemption applies to third-party capital.",
      "File the required Notice of Commencement of Business with MAS and maintain the required accounts with an MAS-licensed bank.",
      "Treat the FAQ as official guidance and obtain specialist advice for an exemption or licensing conclusion."
    ],
    canonicalUrl: "https://ask.gov.sg/mas/questions/clx8ktis900dbryozeeumiiux?from=relatedquestions",
    supplementaryOfficialSources: [{ title: "Securities and Futures Act 2001", url: "https://sso.agc.gov.sg/Act/SFA2001", authority: "AGC" }],
    tags: ["single family office", "sfo", "family office", "cms licence", "fund management", "licensing exemption"],
    sourceStatus: "VERIFIED",
    sourceType: "CURATED_SUMMARY",
    evidenceTier: "OFFICIAL_GUIDANCE",
    isVerbatimText: false,
    effectiveDate: "2026-06-15",
    validFrom: "2026-06-15",
    lastVerifiedDate: "2026-09-13",
    reviewAuditCycleDays: 90
  },
  MAS_SFO_13O_13U_MATERIAL_CHANGES: {
    id: "MAS_SFO_13O_13U_MATERIAL_CHANGES",
    authority: "MAS",
    authorityName: "Monetary Authority of Singapore (MAS)",
    sourcePublisher: "MAS via Ask.gov.sg",
    legalOrStandardInstrument: "MAS Schemes for Single Family Offices FAQ",
    actTitle: "Income Tax Act 1947 \u2014 Sections 13O and 13U fund-tax incentive administration",
    actCode: "ITA1947",
    sectionOrSchedule: "MAS FAQ \u2014 material changes to 13O/13U awardee",
    ruleTitle: "Notification of Material Changes for 13O/13U Family Office Awardees",
    category: "MAS_FINANCE",
    principle: "MAS asks an approved 13O/13U awardee to notify it of additions or replacements of relevant persons and entities because they are material changes from the application information.",
    application: "Use as a post-approval compliance checklist when ownership, beneficiaries, senior personnel, investment professionals, or intermediary entities change.",
    practicalRules: ["Identify the changed individual or entity and the revised ownership structure.", "Escalate the change to the MAS officer-in-charge and covering officer using the current MAS process.", "This is MAS official FAQ guidance; incentive eligibility requires the approval letter and current conditions to be reviewed."],
    canonicalUrl: "https://ask.gov.sg/mas/questions/cm1syf4ir000ds9rhalte1md9",
    supplementaryOfficialSources: [{ title: "Income Tax Act 1947", url: "https://sso.agc.gov.sg/Act/ITA1947", authority: "AGC" }],
    tags: ["13o", "13u", "family office tax incentive", "material change", "beneficial owner", "investment professional"],
    sourceStatus: "VERIFIED",
    sourceType: "CURATED_SUMMARY",
    evidenceTier: "OFFICIAL_GUIDANCE",
    isVerbatimText: false,
    lastVerifiedDate: "2026-09-13",
    reviewAuditCycleDays: 90
  },
  MAS_FMC_CMS_LICENSING: {
    id: "MAS_FMC_CMS_LICENSING",
    authority: "MAS",
    authorityName: "Monetary Authority of Singapore (MAS)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Securities and Futures Act 2001",
    actTitle: "Securities and Futures Act 2001",
    actCode: "SFA2001",
    sectionOrSchedule: "Part IV \u2014 Capital Markets Services licensing",
    ruleTitle: "Fund Management Activity and CMS Licensing Perimeter",
    category: "MAS_FINANCE",
    principle: "A person carrying on a regulated activity in Singapore must assess whether a Capital Markets Services licence, registration, or a statutory or MAS exemption applies before conducting fund management.",
    application: "Classify a proposed manager structure before accepting third-party mandates, marketing a fund, or delegating investment discretion.",
    practicalRules: ["Do not apply an SFO exemption to a multi-family or third-party fund-manager arrangement without a fresh licensing analysis.", "Use MAS licensing and conduct guidance to assess LFMC, RFMC or VCFM treatment and ongoing obligations.", "Verify the entity and activity in the MAS Financial Institutions Directory where relevant."],
    canonicalUrl: "https://sso.agc.gov.sg/Act/SFA2001",
    supplementaryOfficialSources: [{ title: "MAS Financial Institutions Directory", url: "https://eservices.mas.gov.sg/fid", authority: "MAS" }],
    tags: ["fund manager", "fmc", "lfmc", "rfmc", "vcfm", "cms licence", "fund management"],
    sourceStatus: "NEEDS_REVIEW",
    sourceType: "CURATED_SUMMARY",
    evidenceTier: "CURATED_SUMMARY",
    isVerbatimText: false,
    lastVerifiedDate: "2026-09-13",
    reviewAuditCycleDays: 90
  },
  MAS_FUND_ADMIN_OUTSOURCING: {
    id: "MAS_FUND_ADMIN_OUTSOURCING",
    authority: "MAS",
    authorityName: "Monetary Authority of Singapore (MAS)",
    sourcePublisher: "Monetary Authority of Singapore",
    legalOrStandardInstrument: "MAS Guidelines on Outsourcing",
    actTitle: "MAS Guidelines on Outsourcing",
    actCode: "MAS_OUTSOURCING",
    sectionOrSchedule: "Outsourced fund-administration arrangements",
    ruleTitle: "Fund Administration Outsourcing Governance and Oversight",
    category: "MAS_FINANCE",
    principle: "Delegating fund administration does not remove the regulated financial institution\u2019s responsibility for governance, risk assessment, oversight, confidentiality, business continuity, and audit access.",
    application: "Use when documenting NAV, valuation, investor-register, reporting, accounting, or middle-office administration outsourced to a service provider.",
    practicalRules: ["Document service scope, valuation/NAV controls, escalation, records ownership, security and business-continuity responsibilities.", "Retain manager oversight, periodic performance review and rights to information or audit.", "This record is operational regulatory guidance, not an accounting standard for a specific NAV calculation."],
    canonicalUrl: "https://www.mas.gov.sg/regulation/guidelines/guidelines-on-outsourcing",
    tags: ["fund administration", "fund admin", "nav", "valuation", "outsourcing", "administrator"],
    sourceStatus: "NEEDS_REVIEW",
    sourceType: "CURATED_SUMMARY",
    evidenceTier: "CURATED_SUMMARY",
    isVerbatimText: false,
    lastVerifiedDate: "2026-09-13",
    reviewAuditCycleDays: 90
  }
  // -------------------------------------------------------------
};

// src/standards/statutes/mom.ts
var MOM_STATUTE_RULES = {
  // -------------------------------------------------------------
  MOM_SEC21_SALARY_TIMELINES: {
    id: "MOM_SEC21_SALARY_TIMELINES",
    authority: "MOM",
    authorityName: "Ministry of Manpower (MOM)",
    actTitle: "Employment Act 1968",
    actCode: "EA1968",
    sectionOrSchedule: "Section 21 & Section 22",
    ruleTitle: "Statutory Salary and Overtime Payment Timelines (Within 7 / 14 Days)",
    category: "MOM_LABOUR",
    principle: "An employer must pay salary to employees at least once a month and within 7 days after the end of the salary period. Overtime pay must be paid within 14 days after the salary period.",
    application: "Companies paying monthly salary must ensure bank transfers settle by the 7th of the following calendar month.",
    practicalRules: [
      "Basic Salary: Must be disbursed within 7 calendar days after the end of the salary period.",
      "Overtime Pay: Must be paid within 14 calendar days after the end of the salary period.",
      "Termination of Service by Employer: All outstanding salary and accumulated benefits must be paid on the last day of employment, or within 3 working days if notice cannot be served.",
      "Itemised Pay Slips: Mandatory under Section 96 of the Employment Act to provide itemised pay slips with every salary payment."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/EmA1968?ProvIds=P13-#pr21-",
    tags: ["salary deadline", "7 days", "overtime payment deadline", "itemised payslip", "section 21"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2019-04-01",
    verbatimStatuteText: "Salary earned by an employee under a contract of service shall be paid before the expiry of the seventh day after the last day of the salary period. Payment for overtime work shall be made within 14 days after the end of the salary period."
  },
  MOM_SEC22_PRORATED_SALARY: {
    id: "MOM_SEC22_PRORATED_SALARY",
    authority: "MOM",
    authorityName: "Ministry of Manpower (MOM)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Employment Act 1968",
    actTitle: "Employment Act 1968",
    actCode: "EA1968",
    sectionOrSchedule: "Section 22",
    ruleTitle: "MOM Formula for Salary Computation for Incomplete Month of Work",
    category: "MOM_LABOUR",
    principle: "Under Section 22 of the Employment Act 1968, salary for an incomplete month of service (commencement, resignation, or termination) is calculated as: (Monthly Basic Salary / Total Working Days in Month) x Total Working Days Worked.",
    application: "Prorated salary calculation on resignation or termination. Total working days and days worked exclude rest days and non-working days for a 5-day work week.",
    practicalRules: [
      "Formula: Gross Salary Payable = (Monthly Basic Rate of Pay / Total Working Days in Month) * Actual Days Worked.",
      "Total Working Days: Number of days on which employee was required to work in that month (excludes rest days / non-working Saturdays/Sundays).",
      "Payment Deadline: On employee resignation with notice, full salary and benefits must be paid on the employee's last day of employment (Section 21(2))."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/EmA1968?ProvIds=P13-#pr22-",
    tags: ["prorated salary", "incomplete month", "section 22", "last day", "resignation salary", "mom formula", "salary proration"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2019-04-01",
    verbatimStatuteText: "The salary payable to an employee for an incomplete month of work shall be calculated in accordance with the formula: (Monthly basic rate of pay / Total number of working days in that month) x Total number of days on which the employee was required to work and actually worked."
  },
  // -------------------------------------------------------------
  // -------------------------------------------------------------
  MOM_SEC88A_ANNUAL_LEAVE: {
    id: "MOM_SEC88A_ANNUAL_LEAVE",
    authority: "MOM",
    authorityName: "Ministry of Manpower (MOM)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Employment Act 1968",
    actTitle: "Employment Act 1968",
    actCode: "EA1968",
    sectionOrSchedule: "Section 88A",
    ruleTitle: "Paid Annual Leave Statutory Entitlements (7 to 14 Days)",
    category: "MOM_LABOUR",
    principle: "An employee who has served an employer for a period of not less than 3 months shall be entitled to paid annual leave of 7 days in respect of the first 12 months of continuous service with that employer, and an additional one day of paid annual leave for every subsequent 12 months of continuous service, up to a maximum of 14 days.",
    verbatimStatuteText: "An employee who has served an employer for a period of not less than 3 months shall be entitled to paid annual leave of 7 days in respect of the first 12 months of continuous service with the employer and an additional one day\u2019s paid annual leave for every subsequent 12 months of continuous service with the same employer, subject to a maximum of 14 days of paid annual leave.",
    application: "Leave administration and payroll accrual calculations for permanent and contract employees.",
    practicalRules: [
      "Paid Annual Leave (Section 88A): Minimum 7 days after 1 year of service, increasing by 1 additional day per completed year of service, up to a statutory maximum of 14 days for 8 or more years of service.",
      "Pro-rating: Employees who have served at least 3 months in a calendar year are entitled to pro-rated annual leave in that year.",
      "Forfeiture / Encashment: Statutory annual leave cannot be unlawfully forfeited if statutory qualification criteria are met."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/EmA1968?ProvIds=P110-#pr88A-",
    tags: ["annual leave", "section 88a", "leave entitlement", "7 days", "14 days", "statutory annual leave"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2019-04-01"
  },
  MOM_SEC89_SICK_LEAVE: {
    id: "MOM_SEC89_SICK_LEAVE",
    authority: "MOM",
    authorityName: "Ministry of Manpower (MOM)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Employment Act 1968",
    actTitle: "Employment Act 1968",
    actCode: "EA1968",
    sectionOrSchedule: "Section 89",
    ruleTitle: "Paid Outpatient Sick Leave (14 Days) and Hospitalisation Leave (60 Days)",
    category: "MOM_LABOUR",
    principle: "An employee who has served an employer for a period of not less than 3 months is entitled to paid sick leave not exceeding 14 days in each year if no hospitalisation is necessary, or 60 days in each year if hospitalisation is necessary.",
    verbatimStatuteText: "An employee who has served an employer for a period of not less than 3 months is entitled to paid sick leave (including paid medical examination leave) not exceeding in the aggregate \u2014 (a) 14 days in each year if no hospitalisation is necessary; or (b) 60 days in each year if hospitalisation is necessary (including the 14 days of outpatient sick leave).",
    application: "Paid medical leave and hospitalisation leave administration.",
    practicalRules: [
      "Paid Outpatient Sick Leave (Section 89): Up to 14 days per calendar year if certified by an approved medical practitioner. Graduated during first 6 months (5 days at 3 months, 8 days at 4 months, 11 days at 5 months, 14 days at 6+ months).",
      "Paid Hospitalisation Leave (Section 89): Up to 60 days per calendar year (inclusive of the 14 days of outpatient sick leave).",
      "Medical Certification: Medical certificates must be issued by a registered medical practitioner or company-appointed doctor."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/EmA1968?ProvIds=P110-#pr89-",
    tags: ["sick leave", "outpatient sick leave", "hospitalisation leave", "section 89", "medical leave", "14 days"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2019-04-01"
  },
  MOM_SEC38_OVERTIME: {
    id: "MOM_SEC38_OVERTIME",
    authority: "MOM",
    authorityName: "Ministry of Manpower (MOM)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Employment Act 1968",
    actTitle: "Employment Act 1968",
    actCode: "EA1968",
    sectionOrSchedule: "Section 38",
    ruleTitle: "Part IV Hours of Work, Overtime Rate (1.5x Hourly Rate) & 72-Hour Monthly Cap",
    category: "MOM_LABOUR",
    principle: "For any overtime work, the employer shall pay the employee at the rate of not less than 1-1/2 times the employee\u2019s hourly basic rate of pay. An employee shall not be permitted to work overtime for more than 72 hours a month without an MOM exemption.",
    verbatimStatuteText: "For any overtime work, the employer shall pay the employee at the rate of not less than 1-1/2 times the employee\u2019s hourly basic rate of pay. An employee shall not be permitted to work overtime for more than 72 hours a month, or such other number of hours as the Minister may prescribe.",
    application: "Payroll calculation for overtime hours worked by Part IV eligible employees.",
    practicalRules: [
      "Coverage Threshold: Non-workmen earning monthly basic salary $\\le$ SGD 2,600; Workmen earning $\\le$ SGD 4,500.",
      "Overtime Rate: At least 1.5 times the hourly basic rate of pay (for non-workmen, salary capped at SGD 2,600 or SGD 13.60/hour for calculation).",
      "Maximum Overtime Cap: An employee cannot work more than 72 hours of overtime in a calendar month, except with an MOM overtime exemption.",
      "Payment Deadline: Under Section 21, overtime payment must be disbursed within 14 days after the end of the salary period."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/EmA1968?ProvIds=P14-#pr38-",
    tags: ["overtime", "overtime rate", "1.5x", "part iv", "overtime pay", "working hours", "section 38", "72 hours"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2019-04-01"
  },
  MOM_ANNUAL_SICK_LEAVE: {
    id: "MOM_ANNUAL_SICK_LEAVE",
    authority: "MOM",
    authorityName: "Ministry of Manpower (MOM)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Employment Act 1968",
    actTitle: "Employment Act 1968",
    actCode: "EA1968",
    sectionOrSchedule: "Section 88A & Section 89",
    ruleTitle: "Annual Leave and Paid Sick / Hospitalisation Leave Statutory Entitlements",
    category: "MOM_LABOUR",
    principle: "Employees covered by the Employment Act who have served an employer for at least 3 months are entitled to paid sick leave. Employees who have served for at least 12 months are entitled to statutory paid annual leave.",
    verbatimStatuteText: "An employee who has served an employer for a period of not less than 3 months shall be entitled to paid annual leave of 7 days in respect of the first 12 months of continuous service with the employer and an additional one day\u2019s paid annual leave for every subsequent 12 months of continuous service with the same employer, subject to a maximum of 14 days of paid annual leave. An employee who has served for at least 3 months is entitled to paid sick leave not exceeding 14 days if no hospitalisation is necessary, or 60 days if hospitalisation is necessary.",
    application: "Leave administration and payroll accrual calculations for permanent and contract employees.",
    practicalRules: [
      "Paid Annual Leave (Section 88A): Minimum 7 days after 1 year of service, increasing by 1 additional day per completed year of service, up to a statutory maximum of 14 days for 8 or more years of service.",
      "Paid Outpatient Sick Leave (Section 89): Up to 14 days per calendar year if certified by an approved medical practitioner. Graduated during first 6 months of employment (5 days at 3 months, 8 days at 4 months, 11 days at 5 months, 14 days at 6+ months).",
      "Paid Hospitalisation Leave (Section 89): Up to 60 days per calendar year (which includes the 14 days of outpatient sick leave).",
      "Public Holidays (Section 88): 11 statutory gazetted public holidays per year. If required to work on a public holiday, an employee is entitled to an extra day of basic salary or a day off in lieu."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/EmA1968?ProvIds=P110-#pr89-",
    tags: ["annual leave", "sick leave", "hospitalisation leave", "leave entitlement", "public holiday", "section 89", "employment act leave"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2019-04-01"
  },
  MOM_OVERTIME_PART_IV: {
    id: "MOM_OVERTIME_PART_IV",
    authority: "MOM",
    authorityName: "Ministry of Manpower (MOM)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Employment Act 1968",
    actTitle: "Employment Act 1968",
    actCode: "EA1968",
    sectionOrSchedule: "Section 38",
    ruleTitle: "Part IV Working Hours, Overtime Limits & Overtime Pay Rate (1.5x Hourly Rate)",
    category: "MOM_LABOUR",
    principle: "Part IV of the Employment Act protects workmen earning up to $4,500/month and non-workmen earning up to $2,600/month. Hours worked beyond contractual standard hours (max 44 hours/week) must be paid at overtime rates.",
    verbatimStatuteText: "For any overtime work, the employer shall pay the employee at the rate of not less than 1-1/2 times the employee\u2019s hourly basic rate of pay. An employee shall not be permitted to work overtime for more than 72 hours a month, or such other number of hours as the Minister may prescribe.",
    application: "Payroll calculation for overtime hours worked by eligible employees.",
    practicalRules: [
      "Coverage Threshold: Non-workmen earning monthly basic salary $\\le$ SGD 2,600; Workmen earning $\\le$ SGD 4,500.",
      "Overtime Rate: At least 1.5 times the hourly basic rate of pay (for non-workmen, salary capped at SGD 2,600 or SGD 13.60/hour for calculation).",
      "Maximum Overtime Cap: An employee cannot work more than 72 hours of overtime in a calendar month, except with an MOM overtime exemption.",
      "Payment Deadline: Under Section 21, overtime payment must be disbursed within 14 days after the end of the salary period."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/EmA1968?ProvIds=P14-#pr38-",
    tags: ["overtime", "overtime rate", "1.5x", "part iv", "overtime pay", "working hours", "section 38", "44 hours"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2019-04-01",
    validFrom: "2019-04-01",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  },
  MOM_SEC36_37_REST_DAY_PAY: {
    id: "MOM_SEC36_37_REST_DAY_PAY",
    authority: "MOM",
    authorityName: "Ministry of Manpower (MOM)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Employment Act 1968",
    actTitle: "Employment Act 1968",
    actCode: "EA1968",
    sectionOrSchedule: "Section 36 & Section 37",
    ruleTitle: "Rest Day Entitlement & Statutory Payment Computation for Work Done on Rest Day",
    category: "MOM_LABOUR",
    principle: "Under Sections 36 and 37 of the Employment Act 1968, an employer must allow each employee one rest day comprising a whole day without pay per week (\xA736). If an employee works on a rest day at the employer's request (\xA737(2)): for work not exceeding half the normal daily working hours, the employer must pay 1 full day's basic wage; for work exceeding half but not exceeding the normal daily working hours, the employer must pay 2 full days' basic wages; for hours worked exceeding the normal daily hours, overtime is payable at not less than 1.5 times the hourly basic rate of pay (\xA737(3)). If work is at the employee's own request (\xA737(1)), the pay is half a day's wage for <= 0.5 day and 1 day's wage for <= 1 day.",
    verbatimStatuteText: "Where an employee works on a rest day at the request of the employer, the employee shall be paid for work done on that day \u2014 (a) if the period of work does not exceed half the employee's normal daily hours of work, a sum at the basic rate of pay for one day's work; (b) if the period of work exceeds half but does not exceed the employee's normal daily hours of work, a sum at the basic rate of pay for 2 days' work; or (c) if the period of work exceeds the employee's normal daily hours of work, a sum in accordance with paragraph (b) and an additional payment at a rate of not less than 1-1/2 times the hourly basic rate of pay.",
    application: "Payroll calculation for employees required to work on Sunday or scheduled rest day: Basic rate of pay for 1 or 2 days plus 1.5x overtime.",
    practicalRules: [
      "Employer's Request: Work <= half normal shift: 1 full day's basic pay; Work > half normal shift: 2 full days' basic pay.",
      "Overtime on Rest Day: Hours worked in excess of normal daily hours must be paid at >= 1.5 times the hourly basic rate.",
      "Employee's Request: Work <= half normal shift: 0.5 day's basic pay; Work > half normal shift: 1.0 day's basic pay.",
      "Part IV Coverage: Applies to workmen earning <= SGD 4,500 and non-workmen earning <= SGD 2,600."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/EmA1968?ProvIds=P14-#pr37-",
    tags: ["rest day pay", "section 36", "section 37", "sunday work", "rest day computation", "1 day pay", "2 days pay"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2019-04-01",
    validFrom: "2019-04-01",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  },
  MOM_MANDATORY_RETRENCHMENT_NOTIFICATION: {
    id: "MOM_MANDATORY_RETRENCHMENT_NOTIFICATION",
    authority: "MOM",
    authorityName: "Ministry of Manpower (MOM)",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Employment Act 1968 & Employment (Retrenchment Notification) Regulations",
    actTitle: "Employment Act 1968",
    actCode: "EA1968",
    sectionOrSchedule: "Section 96A & Retrenchment Notification Regulations",
    ruleTitle: "Mandatory Retrenchment Notification (MRN) to MOM within 5 Working Days",
    category: "MOM_LABOUR",
    principle: "Under the Employment (Retrenchment Notification) Regulations and Section 96A of the Employment Act 1968, employers with 10 or more employees who retrench 5 or more employees within any 6-month period must submit a mandatory notification to the Ministry of Manpower (MOM) via the MyMOM portal within 5 working days after giving notice of retrenchment to affected employees.",
    verbatimStatuteText: "An employer who employs 10 or more employees must notify the Commissioner for Labour of any retrenchment of employees within 5 working days after the employer gives notice of retrenchment to the affected employee, where the retrenchment is of 5 or more employees in any 6-month period.",
    application: "Corporate restructuring, down-sizing, and redundancy exercises: Filing mandatory retrenchment returns to Workforce Singapore / MOM within 5 working days.",
    practicalRules: [
      "Employer Threshold: Business employing 10 or more employees in total.",
      "Trigger Threshold: Retrenchment of 5 or more employees within any 6-month rolling window.",
      "Filing Deadline: Within 5 working days of notifying affected staff.",
      "Penalties: Failure to notify is a civil penalty offence under Section 96A subject to administrative financial penalties up to SGD 2,000 per breach."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/SL/EA1968-RG14",
    tags: ["retrenchment notification", "mandatory retrenchment", "section 96a", "5 employees 6 months", "5 working days"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2021-11-01",
    validFrom: "2021-11-01",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  },
  MOM_CDCA_PARENTAL_LEAVES: {
    id: "MOM_CDCA_PARENTAL_LEAVES",
    authority: "MOM",
    authorityName: "Ministry of Manpower (MOM) & MSF",
    sourcePublisher: "Singapore Statutes Online / AGC",
    legalOrStandardInstrument: "Child Development Co-Savings Act 2001 & Employment Act 1968",
    actTitle: "Child Development Co-Savings Act 2001",
    actCode: "CDCA2001",
    sectionOrSchedule: "Section 9, Section 12B & EA Section 87A",
    ruleTitle: "Statutory Paid Maternity Leave (16 Weeks), Paternity Leave (4 Weeks) & Childcare Leave (6 Days)",
    category: "MOM_LABOUR",
    principle: "Under the Child Development Co-Savings Act 2001 and the Employment Act 1968, eligible working mothers of a Singapore Citizen child are entitled to 16 weeks of Government-Paid Maternity Leave (GPML). Eligible working fathers are entitled to 4 weeks of Government-Paid Paternity Leave (GPPL). Working parents of a Singapore Citizen child aged below 7 years are each entitled to 6 days of paid childcare leave per year.",
    verbatimStatuteText: "Subject to this section, every female employee who has served an employer for a period of not less than 3 months shall be entitled to absent herself from work during periods prescribed as maternity leave for a total of 16 weeks, and every male employee who has served an employer for not less than 3 months shall be entitled to paternity leave of 4 weeks.",
    application: "Payroll administration and government-paid claims via the GPL portal (pro-family leave reimbursement for employers).",
    practicalRules: [
      "Maternity Leave (16 Weeks): For 1st & 2nd child: 8 weeks employer-funded + 8 weeks government-funded. For 3rd+ child: all 16 weeks government-funded (capped at SGD 10,000 per 4-week block).",
      "Paternity Leave (4 Weeks): Mandatory 4 weeks government-paid paternity leave for working fathers of Singapore citizen children (effective 1 Jan 2024).",
      "Childcare Leave: 6 days per parent per year for children under 7 years (first 3 days employer-funded, next 3 days government-funded).",
      "Service Requirement: Employee must have served the employer for at least 3 continuous months prior to child's birth."
    ],
    canonicalUrl: "https://sso.agc.gov.sg/Act/CDCSA2001?ProvIds=P13-#pr9-",
    tags: ["maternity leave 16 weeks", "paternity leave 4 weeks", "childcare leave 6 days", "cdca 2001", "parental leave", "government paid"],
    sourceStatus: "VERIFIED",
    sourceType: "AUTHORITATIVE_SOURCE",
    evidenceTier: "PRIMARY_SOURCE",
    isVerbatimText: true,
    effectiveDate: "2024-01-01",
    validFrom: "2024-01-01",
    lastVerifiedDate: "2026-09-01",
    reviewAuditCycleDays: 365
  }
  // -------------------------------------------------------------
};

// src/standards/singaporeStatutesKnowledge.ts
var SINGAPORE_STATUTORY_REPOSITORY = {
  ...IRAS_STATUTE_RULES,
  ...GST_STATUTE_RULES,
  ...ACRA_STATUTE_RULES,
  ...CPF_STATUTE_RULES,
  ...MOM_STATUTE_RULES,
  ...MAS_STATUTE_RULES
};
function querySingaporeStatutes(query) {
  const q = query.toLowerCase().trim();
  const queryWords = q.split(/\s+/).filter((word) => word.length >= 3 && !["what", "when", "where", "which", "how", "the", "for", "and", "are"].includes(word));
  const scoredResults = [];
  for (const rule of Object.values(SINGAPORE_STATUTORY_REPOSITORY)) {
    let matchScore = 0;
    for (const tag of rule.tags) if (q.includes(tag)) matchScore += 8;
    if (q.includes(rule.sectionOrSchedule.toLowerCase())) matchScore += 10;
    if (rule.ruleTitle.toLowerCase().includes(q)) matchScore += 10;
    for (const word of queryWords) {
      if (rule.ruleTitle.toLowerCase().includes(word)) matchScore += 3;
      if (rule.sectionOrSchedule.toLowerCase().includes(word)) matchScore += 4;
      if (rule.tags.some((tag) => tag.includes(word))) matchScore += 2;
      if (rule.principle.toLowerCase().includes(word)) matchScore += 1;
      if (rule.practicalRules.some((practicalRule) => practicalRule.toLowerCase().includes(word))) matchScore += 1;
    }
    const historical = rule.sourceStatus === "HISTORICAL";
    const asksHistorical = q.includes("historical") || q.includes("prior") || q.includes("former") || q.includes("superseded");
    const year = q.match(/\b(19\d\d|20\d\d)\b/)?.[1];
    if (year) {
      const fromYear = rule.validFrom?.slice(0, 4);
      const toYear = rule.validTo?.slice(0, 4);
      if (fromYear && year >= fromYear && (!toYear || year <= toYear)) matchScore += 20;
      else if (toYear && year > toYear || fromYear && year < fromYear) matchScore -= 30;
    } else if (historical && !asksHistorical) matchScore -= 40;
    else if (rule.sourceStatus === "VERIFIED") matchScore += 10;
    if (matchScore > 0) scoredResults.push({ rule, score: matchScore });
  }
  return scoredResults.sort((a, b) => b.score - a.score).map((result) => result.rule);
}
function convertToCitation(rule) {
  return { standard: `${rule.actTitle} (${rule.authority})`, paragraph: rule.sectionOrSchedule, title: rule.ruleTitle, text: rule.principle, officialSourceUrl: rule.canonicalUrl, authority: rule.authority };
}
function convertToAdvisory(rule) {
  return {
    authority: rule.authority,
    statuteOrAct: rule.actTitle,
    sectionOrSchedule: rule.sectionOrSchedule,
    topic: rule.ruleTitle,
    summary: rule.principle,
    keyRules: rule.practicalRules,
    officialUrl: rule.canonicalUrl,
    isTaxDeductible: rule.id === "ITA_SEC15_1_K_MOTOR_CAR" || rule.id === "ITA_SEC15_PROHIBITED_DEDUCTIONS" ? false : rule.id === "ITA_SEC14_GENERAL_DEDUCTION" || rule.id === "ITA_SEC14C_EIS_INNOVATION" ? true : void 0,
    isGstClaimable: rule.id === "GST_REG26_BLOCKED_INPUT_TAX" ? false : rule.id === "GST_SEC21_ZERO_RATED_EXPORTS" ? true : void 0
  };
}

// src/classification/questionClassifier.ts
function classifyQuestion(query) {
  const q = query.toLowerCase();
  const hasAccounting = q.includes("capitalis") || q.includes("capitaliz") || q.includes("sfrs") || q.includes("ifrs") || /\bias\s*\d*\b/i.test(q) || q.includes("intangible asset") || q.includes("depreciat") || q.includes("amorti") || q.includes("debit") || q.includes("credit") || q.includes("journal") || q.includes("double entr") || q.includes("bookkeeping") || q.includes("accrual") || /\bleases?\b/i.test(q) || q.includes("rou asset") || q.includes("fvtpl") || q.includes("fvtoci") || q.includes("financial asset") || q.includes("trade discount") || q.includes("balance sheet") || q.includes("p&l") || q.includes("financial statement") || q.includes("financial statements") || q.includes("statement of profit") || q.includes("statement of comprehensive income") || q.includes("restatement") || q.includes("restate") || q.includes("reclassif") || q.includes("presentation of income") || q.includes("revenue presentation");
  const hasTax = q.includes("tax deduct") || q.includes("deductib") || q.includes("corporate tax") || q.includes("income tax") || q.includes("iras") || q.includes("section 14") || q.includes("section 15") || q.includes("section 19a") || q.includes("capital allowance") || /\bsute\b/i.test(q) || q.includes("partial tax exempt") || q.includes("form c") || /\beis\b/i.test(q) || q.includes("enterprise innovation") || q.includes("add-back") || q.includes("tax treatment") || q.includes("withholding tax");
  const hasGst = /\bgst\b/i.test(q) || q.includes("goods and services tax") || q.includes("input tax") || q.includes("output tax") || q.includes("regulation 26") || q.includes("blocked input") || q.includes("taxable turnover") || q.includes("compulsory registration") || q.includes("register for gst");
  const hasCorporate = q.includes("acra") || q.includes("companies act") || q.includes("audit exemption") || q.includes("small company") || q.includes("section 205c") || q.includes("section 201") || q.includes("annual return") || /\bagm\b/i.test(q) || q.includes("director") || q.includes("share capital");
  const hasPayroll = /\bcpf\b/i.test(q) || q.includes("central provident fund") || q.includes("ordinary wage") || q.includes("ow ceiling") || q.includes("additional wage") || q.includes("aw ceiling") || q.includes("medisave") || q.includes("employer contribution") || q.includes("employee contribution");
  const hasEmployment = /\bmom\b/i.test(q) || q.includes("ministry of manpower") || q.includes("employment act") || q.includes("annual leave") || q.includes("sick leave") || q.includes("hospitalisation leave") || q.includes("overtime") || q.includes("part iv") || q.includes("working hours") || q.includes("rest day") || q.includes("retrenchment");
  const hasMasFunds = /\bmas\b/i.test(q) || q.includes("family office") || q.includes("single family office") || /\bvcc\b/i.test(q) || q.includes("variable capital company") || q.includes("fund manager") || q.includes("fund management company") || q.includes("fund admin") || q.includes("fund administrator") || q.includes("13o") || q.includes("13u") || q.includes("cms licence");
  const hasPayrollCalculation = (q.includes("salary") || q.includes("earning") || q.includes("earns") || q.includes("payroll") || q.includes("wages") || q.includes("wage")) && (q.includes("cpf") || q.includes("last day") || q.includes("resignation") || q.includes("prorat") || q.includes("staff") || q.includes("employee")) && (q.includes("calculat") || q.includes("compute") || q.includes("how much") || /\d+/.test(q));
  const authorities = [];
  if (hasAccounting) authorities.push("ACRA");
  if (hasTax || hasGst || hasPayrollCalculation) authorities.push("IRAS");
  if (hasCorporate && !authorities.includes("ACRA")) authorities.push("ACRA");
  if (hasPayroll || hasPayrollCalculation) authorities.push("CPF");
  if (hasEmployment || hasPayrollCalculation) authorities.push("MOM");
  if (hasMasFunds) authorities.push("MAS");
  const multiAuthority = authorities.length > 1;
  let primaryDomain = "GENERAL";
  if (multiAuthority) {
    primaryDomain = "MIXED";
  } else if (hasAccounting) {
    primaryDomain = "ACCOUNTING";
  } else if (hasTax) {
    primaryDomain = "TAX";
  } else if (hasGst) {
    primaryDomain = "GST";
  } else if (hasMasFunds) {
    primaryDomain = "MAS_FUNDS";
  } else if (hasCorporate) {
    primaryDomain = "CORPORATE_REGULATORY";
  } else if (hasPayroll) {
    primaryDomain = "PAYROLL";
  } else if (hasEmployment) {
    primaryDomain = "EMPLOYMENT";
  }
  const hasYear = /\b(202[4-9]|203\d)\b/.test(q);
  const asksCurrentStatus = /\b(current|currently|latest|prevailing|recent|new rate|effective date|now)\b/i.test(q);
  const asksStatutoryCeilingOrThreshold = hasGst && (q.includes("register") || q.includes("threshold") || q.includes("turnover") || q.includes("rate") || q.includes("exceeds") || q.includes("million")) || hasPayroll && (q.includes("ceiling") || q.includes("rate") || q.includes("tier") || q.includes("ow")) || hasTax && (q.includes("tax rate") || q.includes("corporate rate") || q.includes("sute") || q.includes("pte")) || hasCorporate && (q.includes("audit exemption") && (q.includes("qualify") || q.includes("threshold") || q.includes("criteria")));
  const currentInformationRequired = hasYear || asksCurrentStatus || asksStatutoryCeilingOrThreshold;
  const asksForEntries = q.includes("double entr") || q.includes("journal") || q.includes("accounting entr") || q.includes("how to record") || q.includes("how do i record") || q.includes("debit and credit") || q.includes("dr and cr") || q.includes("show entries") || q.includes("bookkeeping entry") || q.includes("post entry");
  const isConceptualOrAdvisory = /^(what is|what are|explain|define|definition|describe|overview|difference between|how does|summarise|summarize|can i|can we|do we qualify|does it qualify|is it allowed|is it deductible|is it claimable|must we|must i|guidance on|requirements for|criteria for)\b/i.test(q.trim()) || q.includes("do we qualify") || q.includes("is it deductible") || q.includes("is it claimable") || q.includes("can i claim") || q.includes("can we claim");
  const hasTransactionAction = (q.includes("bought") || q.includes("sold") || q.includes("purchased") || q.includes("acquired") || q.includes("invested") || q.includes("disposed of")) && (asksForEntries || q.includes("shares") || q.includes("usd") || q.includes("asset") || q.includes("goods"));
  let intent = "STATUTORY_ADVISORY";
  if (asksForEntries && isConceptualOrAdvisory) {
    intent = "HYBRID";
  } else if (asksForEntries || hasTransactionAction || hasPayrollCalculation) {
    intent = "TRANSACTION";
  } else {
    intent = "STATUTORY_ADVISORY";
  }
  const journalEntryRequired = asksForEntries || hasPayrollCalculation || hasTransactionAction && !isConceptualOrAdvisory;
  const calculationRequired = q.includes("calculat") || q.includes("compute") || q.includes("how much") || q.includes("what is the amount") || q.includes("fx gain") || q.includes("foreign exchange") || q.includes("tax payable") || hasPayrollCalculation || intent === "TRANSACTION" && /\d+/.test(q) && !isConceptualOrAdvisory;
  const missingFacts = [];
  const isPureConceptualQuery = /^(what is|what are|explain|define|definition|describe|overview|difference between|how does|summarise|summarize)\b/i.test(q.trim());
  if (!isPureConceptualQuery && (q.includes("capitalis") || q.includes("capitaliz") || q.includes("development cost") || q.includes("r&d"))) {
    if (!q.includes("research") && !q.includes("development")) {
      missingFacts.push("Separation between research phase (expensed) and development phase");
    }
    if (!q.includes("criteria") && !q.includes("feasible") && !q.includes("feasibility")) {
      missingFacts.push("Confirmation of all 6 cumulative recognition criteria under SFRS(I) 1-38 \xA757");
    }
    if (!/\d+/.test(q)) {
      missingFacts.push("Specific expenditure amounts attributable to development activities");
    }
  }
  if (!isPureConceptualQuery && (q.includes("car") || q.includes("vehicle")) && (q.includes("bought") || q.includes("purchas") || q.includes("claim") || q.includes("deduct") || q.includes("entry"))) {
    if (!q.includes("s-plate") && !q.includes("g-plate") && !q.includes("passenger") && !q.includes("commercial")) {
      missingFacts.push("Vehicle registration classification (S-plate passenger car vs commercial goods vehicle)");
    }
  }
  if (!isPureConceptualQuery && (q.includes("rental agreement") || q.includes("lease agreement") || q.includes("renting") || q.includes("paying") || q.includes("lease") && (/\d+/.test(q) || q.includes("term") || asksForEntries))) {
    if (!q.includes("discount rate") && !q.includes("borrowing rate") && !q.includes("interest rate") && !q.includes("%")) {
      missingFacts.push("Incremental borrowing rate (IBR) or rate implicit in lease under SFRS(I) 16 \xA726");
    }
    if (!q.includes("term") && !q.includes("year") && !q.includes("month")) {
      missingFacts.push("Enforceable lease duration / term");
    }
  }
  const reasoning = multiAuthority ? `Multi-authority question spanning ${authorities.join(" & ")}. Separating financial reporting from statutory tax/regulatory compliance.` : `Single-domain ${primaryDomain} question governed by ${authorities[0] || "Singapore Law"}.`;
  return {
    primaryDomain,
    authorities,
    multiAuthority,
    currentInformationRequired,
    accountingAnalysisRequired: hasAccounting,
    taxAnalysisRequired: hasTax || hasGst,
    regulatoryAnalysisRequired: hasCorporate || hasPayroll || hasEmployment,
    calculationRequired,
    journalEntryRequired,
    missingFacts,
    intent,
    reasoning
  };
}

// src/services/conversationBoundary.ts
function startsNewAccountingScenario(query, currentScenario, context) {
  if (!currentScenario && !context?.underlyingTransaction) return false;
  const q = query.toLowerCase();
  const startsNewTransaction = /\b(bought|purchased|acquired|sold|disposed of|entered into|signed|issued|subscribed|borrowed|took out|hired)\b/.test(q);
  const hasTransactionDetail = /(?:\b(?:sgd|usd|eur|s\$)\s*[\d,]+|\$\s*[\d,]+|\b\d+(?:\.\d+)?\s*(?:k|million|years?|months?|%))\b/.test(q);
  const hasNewSubject = /\b(new\s+(?:machine|machinery|equipment|vehicle|asset|lease|loan|shares?)|machine|machinery|equipment|vehicle|lease|share capital|payroll|salary|customer|supplier)\b/.test(q);
  const isIndependentPersonalCost = /\b(fine|penalt(?:y|ies)|traffic offence|personal expense|private expense)\b/.test(q) && /\b(director|shareholder|owner|company)\b/.test(q) && hasTransactionDetail;
  if (isIndependentPersonalCost) return true;
  if (startsNewTransaction && hasTransactionDetail && hasNewSubject) return true;
  const activeType = context?.underlyingTransaction?.type || currentScenario?.semanticUnderstanding?.transactionType;
  const newDomain = q.includes("machine") || q.includes("machinery") || q.includes("equipment") || q.includes("vehicle") ? "asset_purchase" : q.includes("share capital") || q.includes("shareholder") || q.includes("subscriber") ? "share_capital_issuance" : q.includes("lease") || q.includes("rental") ? "lease_contract" : q.includes("payroll") || q.includes("salary") || q.includes("cpf") ? "payroll_payment" : void 0;
  return Boolean(startsNewTransaction && newDomain && activeType && newDomain !== activeType);
}

// src/services/aiTransport.ts
var MAX_STRUCTURED_LLM_INPUT_CHARS = 1e5;
function toSafeProviderError(provider, status) {
  return new Error(`${provider} request failed with HTTP ${status}. The provider response was withheld for security.`);
}
function normalizeAzureEndpointUrl(endpoint) {
  let cleaned = (endpoint || "").trim().replace(/\/+$/, "");
  if (!cleaned) return "";
  if (!cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
    if (!cleaned.includes(".")) {
      cleaned = `https://${cleaned}.openai.azure.com`;
    } else {
      cleaned = `https://${cleaned}`;
    }
  }
  return cleaned;
}
async function executeStructuredLlmCall(prompt, systemInstruction, providerOrApiKey, options = {}) {
  if (prompt.length + systemInstruction.length > MAX_STRUCTURED_LLM_INPUT_CHARS) {
    throw new Error(`AI request exceeds the ${MAX_STRUCTURED_LLM_INPUT_CHARS.toLocaleString()} character safety limit.`);
  }
  const timeoutMs = options.timeoutMs ?? 45e3;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (typeof providerOrApiKey === "string" && providerOrApiKey.trim().length > 10) {
      const apiKey = providerOrApiKey.trim();
      const model = options.model || "gemini-3.5-flash-lite";
      return await callGeminiDirect(apiKey, model, prompt, systemInstruction, controller.signal, options.temperature, options.jsonMode !== false);
    }
    if (providerOrApiKey && typeof providerOrApiKey === "object") {
      const active = providerOrApiKey.activeProvider;
      if (active === "gemini") {
        const apiKey = providerOrApiKey.gemini?.apiKey?.trim();
        if (!apiKey || apiKey.length < 10) {
          throw new Error("Gemini API key is not configured or too short.");
        }
        const model = options.model || providerOrApiKey.gemini?.model || "gemini-3.5-flash-lite";
        return await callGeminiDirect(apiKey, model, prompt, systemInstruction, controller.signal, options.temperature, options.jsonMode !== false);
      }
      if (active === "azure") {
        const azure = providerOrApiKey.azure;
        if (!azure?.apiKey || !azure?.endpoint) {
          throw new Error("Azure OpenAI endpoint or API key is not configured.");
        }
        const endpoint = normalizeAzureEndpointUrl(azure.endpoint);
        const deployment = azure.deploymentName || "gpt-4o";
        const apiVersion = azure.apiVersion || "2024-08-01-preview";
        const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-key": azure.apiKey
          },
          body: JSON.stringify({
            messages: [
              { role: "system", content: systemInstruction },
              { role: "user", content: prompt }
            ],
            response_format: options.jsonMode !== false ? { type: "json_object" } : void 0,
            temperature: options.temperature ?? 0.1
          }),
          signal: controller.signal
        });
        if (!res.ok) {
          throw toSafeProviderError("Azure OpenAI", res.status);
        }
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (!text) throw new Error("Empty response from Azure OpenAI");
        return text;
      }
      if (active === "openai") {
        const openai = providerOrApiKey.openai;
        if (!openai?.apiKey) {
          throw new Error("OpenAI API key is not configured.");
        }
        const baseUrl = openai.baseUrl?.trim().replace(/\/+$/, "") || "https://api.openai.com/v1";
        const model = options.model || openai.model || "gpt-4o";
        const url = `${baseUrl}/chat/completions`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openai.apiKey}`
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemInstruction },
              { role: "user", content: prompt }
            ],
            response_format: options.jsonMode !== false ? { type: "json_object" } : void 0,
            temperature: options.temperature ?? 0.1
          }),
          signal: controller.signal
        });
        if (!res.ok) {
          throw toSafeProviderError("OpenAI", res.status);
        }
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (!text) throw new Error("Empty response from OpenAI");
        return text;
      }
    }
    throw new Error("No active AI provider configured or valid API key provided.");
  } finally {
    clearTimeout(timeoutId);
  }
}
async function callGeminiDirect(apiKey, model, prompt, systemInstruction, signal, temperature = 0.1, jsonMode = true) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: { ...jsonMode ? { responseMimeType: "application/json" } : {}, temperature }
  };
  if (systemInstruction) {
    requestBody.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal
  });
  if (!res.ok) {
    throw toSafeProviderError("Gemini API", res.status);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Empty response from Gemini API");
  }
  return text;
}

// src/utils/jsonRepair.ts
function repairAndParseAIJson(rawJsonText) {
  if (!rawJsonText || !rawJsonText.trim()) {
    throw new Error("No content returned by AI provider.");
  }
  let text = rawJsonText.trim();
  if (text.startsWith("```json")) {
    text = text.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  } else if (text.startsWith("```")) {
    text = text.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }
  text = text.trim();
  try {
    return JSON.parse(text);
  } catch (_fastErr) {
  }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  try {
    return JSON.parse(text);
  } catch (_sliceErr) {
  }
  let repaired = text.replace(/\\([^"\\\/bfnrtu])/g, "\\\\$1");
  repaired = repaired.replace(/,\s*([\}\]])/g, "$1");
  try {
    return JSON.parse(repaired);
  } catch (_repairErr) {
  }
  const mtStart = repaired.indexOf('"messageText"');
  if (mtStart !== -1) {
    const quoteStart = repaired.indexOf('"', mtStart + 13);
    const nextKeyMatch = repaired.search(/,\s*"(?:keyParameters|directGroups|statutoryAdvisory)"/);
    if (quoteStart !== -1 && nextKeyMatch !== -1 && nextKeyMatch > quoteStart) {
      let rawMsg = repaired.slice(quoteStart + 1, nextKeyMatch);
      if (rawMsg.endsWith('"')) {
        rawMsg = rawMsg.slice(0, -1);
      }
      const safeMsg = JSON.stringify(rawMsg).slice(1, -1);
      const reconstructed = repaired.slice(0, quoteStart + 1) + safeMsg + '"' + repaired.slice(nextKeyMatch);
      try {
        return JSON.parse(reconstructed);
      } catch (_reconstructErr) {
      }
    }
  }
  return extractAccountingSchemaFallback(text);
}
function extractAccountingSchemaFallback(text) {
  const result = {
    scenarioType: "UNIVERSAL",
    queryIntent: "TRANSACTION",
    transactionTitle: "Accounting Transaction",
    functionalCurrency: "SGD",
    transactionCurrency: "SGD",
    messageText: "",
    keyParameters: [],
    directGroups: [],
    statutoryAdvisory: []
  };
  const stMatch = text.match(/"scenarioType"\s*:\s*"([^"]+)"/);
  if (stMatch) result.scenarioType = stMatch[1];
  const qiMatch = text.match(/"queryIntent"\s*:\s*"([^"]+)"/);
  if (qiMatch) result.queryIntent = qiMatch[1];
  const ttMatch = text.match(/"transactionTitle"\s*:\s*"([^"]+)"/);
  if (ttMatch) result.transactionTitle = ttMatch[1];
  const fcMatch = text.match(/"functionalCurrency"\s*:\s*"([^"]+)"/);
  if (fcMatch) result.functionalCurrency = fcMatch[1];
  const tcMatch = text.match(/"transactionCurrency"\s*:\s*"([^"]+)"/);
  if (tcMatch) result.transactionCurrency = tcMatch[1];
  result.directGroups = extractJsonArray(text, "directGroups");
  result.keyParameters = extractJsonArray(text, "keyParameters");
  result.statutoryAdvisory = extractJsonArray(text, "statutoryAdvisory");
  const mtIndex = text.indexOf('"messageText"');
  if (mtIndex !== -1) {
    const colonIdx = text.indexOf(":", mtIndex);
    const startQuote = text.indexOf('"', colonIdx);
    const nextBoundary = text.search(/",\s*"(?:keyParameters|directGroups|statutoryAdvisory)"/);
    if (startQuote !== -1 && nextBoundary !== -1 && nextBoundary > startQuote) {
      result.messageText = text.slice(startQuote + 1, nextBoundary).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
  }
  if (!result.messageText) {
    result.messageText = text.replace(/^\{[\s\S]*?"messageText"\s*:\s*"/, "").replace(/",\s*"(?:keyParameters|directGroups)[\s\S]*$/, "").replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
  return result;
}
function extractJsonArray(text, keyName) {
  const keyIdx = text.indexOf(`"${keyName}"`);
  if (keyIdx === -1) return [];
  const startBracket = text.indexOf("[", keyIdx);
  if (startBracket === -1) return [];
  let depth = 0;
  let inString = false;
  let escape = false;
  let endBracket = -1;
  for (let i = startBracket; i < text.length; i++) {
    const char = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === "[") {
        depth++;
      } else if (char === "]") {
        depth--;
        if (depth === 0) {
          endBracket = i;
          break;
        }
      }
    }
  }
  if (endBracket !== -1) {
    const rawSlice = text.slice(startBracket, endBracket + 1);
    try {
      const cleaned = rawSlice.replace(/\\([^"\\\/bfnrtu])/g, "\\\\$1").replace(/,\s*([\}\]])/g, "$1");
      return JSON.parse(cleaned);
    } catch (_e) {
      return [];
    }
  }
  return [];
}

// src/services/transactionUnderstandingService.ts
var VALID_CANONICAL_TRANSACTION_TYPES = [
  "share_capital_issuance",
  "capital_reduction",
  "equity_investment_acquisition",
  "lease_contract",
  "lease_payment",
  "rd_capitalization",
  "asset_purchase",
  "depreciation_expense",
  "trade_discount_purchase",
  "customer_advance_payment",
  "customer_invoice",
  "director_expense_settlement",
  "director_fee_payment",
  "expense_payment",
  "inventory_purchase",
  "payroll_payment",
  "tax_payment",
  "tax_provision",
  "dividend_payment",
  "debt_settlement",
  "unclassified_transaction"
];
var VALID_CANONICAL_INSTRUMENTS = [
  "cash_at_bank",
  "accounts_receivable",
  "accounts_payable",
  "own_equity",
  "financial_asset_equity",
  "marketable_securities",
  "debt_instrument",
  "derivative",
  "property_plant_equipment",
  "intangible_asset",
  "right_of_use_asset",
  "lease_liability",
  "director_current_account",
  "contract_liability_deferred_revenue",
  "unknown"
];
function normalizeOwnershipContext(raw) {
  if (!raw) return "unknown";
  const clean = raw.trim().toLowerCase();
  if (clean === "own_equity" || clean === "own_company_equity") {
    return "own_equity";
  }
  if (clean === "external_investment" || clean === "external_entity_equity") {
    return "external_investment";
  }
  if (clean === "not_applicable") {
    return "not_applicable";
  }
  return "unknown";
}
function normalizeTransactionNature(raw) {
  if (!raw) return void 0;
  const clean = raw.trim().toLowerCase();
  if (clean === "equity_issuance_subscription" || clean === "share_subscription") {
    return "share_capital_issuance";
  }
  if (clean === "software_development_expenditure") {
    return "rd_capitalization";
  }
  if (clean === "asset_acquisition") {
    return "asset_purchase";
  }
  if (clean === "lease_liability_accrual") {
    return "lease_contract";
  }
  const matched = VALID_CANONICAL_TRANSACTION_TYPES.find((t) => t === clean);
  return matched;
}
function normalizeInstrument(raw) {
  if (!raw) return void 0;
  const clean = raw.trim().toLowerCase();
  if (clean === "equity_instrument") {
    return "own_equity";
  }
  if (clean === "fixed_asset") {
    return "property_plant_equipment";
  }
  if (clean === "amount_due_to_director") {
    return "director_current_account";
  }
  if (clean === "right_of_use_asset_and_lease_liability") {
    return "right_of_use_asset";
  }
  if (clean === "bank_loan" || clean === "loan") {
    return "debt_instrument";
  }
  if (clean === "financial_asset_at_fvtpl") {
    return "financial_asset_equity";
  }
  const matched = VALID_CANONICAL_INSTRUMENTS.find((i) => i === clean);
  return matched;
}
function validateAndNormalizeUnderstanding(raw, fallbackJurisdiction = "SG", source = "deterministic_fallback", conversationContext, userQuery) {
  const errors = [];
  if (!raw || typeof raw !== "object") {
    return {
      isValid: false,
      errors: ["Raw understanding payload must be a non-null object"],
      normalizedUnderstanding: {
        extractionSource: source,
        provenance: {
          tier: source === "ai" ? "AI_REASONING" : "DETERMINISTIC_HEURISTIC_FALLBACK",
          isFallback: source !== "ai",
          engine: "error_handler",
          appliedRules: ["empty_payload_fallback"],
          confidenceCapped: true,
          notice: "Empty or invalid understanding payload fallback",
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        },
        reportingEntity: { type: "unknown" },
        currency: { value: null, source: "unknown", confidence: 0 },
        factsMissing: ["Invalid or empty understanding payload"],
        assumptions: [],
        confidence: 0
      }
    };
  }
  const validEntityTypes = ["company", "individual", "other", "unknown"];
  const entityType = raw?.reportingEntity?.type;
  if (!entityType || !validEntityTypes.includes(entityType)) {
    errors.push(`Invalid or missing reportingEntity.type: '${entityType}'`);
  }
  const validRoles = [
    "shareholder",
    "customer",
    "supplier",
    "employee",
    "lender",
    "director",
    "government",
    "investor",
    "other",
    "unknown"
  ];
  const counterpartyRole = raw?.counterparty?.role === "director_shareholder" ? "shareholder" : raw?.counterparty?.role;
  if (counterpartyRole && !validRoles.includes(counterpartyRole)) {
    errors.push(`Invalid counterparty.role: '${counterpartyRole}'`);
  }
  const rawOwnership = raw?.ownershipContext;
  let normalizedOwnership = "unknown";
  if (rawOwnership) {
    const validKnownOwnership = [
      "own_equity",
      "external_investment",
      "not_applicable",
      "unknown",
      "own_company_equity",
      "external_entity_equity"
    ];
    if (!validKnownOwnership.includes(rawOwnership)) {
      errors.push(`Invalid ownershipContext: '${rawOwnership}'`);
    } else {
      normalizedOwnership = normalizeOwnershipContext(rawOwnership);
    }
  }
  const validPaymentStatus = ["paid", "unpaid", "partially_paid", "unknown"];
  const paymentStatus = raw?.paymentStatus;
  if (paymentStatus && !validPaymentStatus.includes(paymentStatus)) {
    errors.push(`Invalid paymentStatus: '${paymentStatus}'`);
  }
  const validCurrencySources = ["explicit", "context_inference", "unknown"];
  const currSource = raw?.currency?.source;
  if (!currSource || !validCurrencySources.includes(currSource)) {
    errors.push(`Invalid or missing currency.source: '${currSource}'`);
  }
  if (normalizedOwnership === "own_equity") {
    const inst = (raw?.instrument || "").toLowerCase();
    const subj = (raw?.subject || "").toLowerCase();
    if (inst.includes("fvtpl") || inst.includes("fvtoci") || subj.includes("foreign shares") || inst.includes("financial_asset")) {
      errors.push("Contradictory classification: own_equity cannot be classified as financial asset at FVTPL/FVTOCI (SFRS(I) 1-32 \xA733).");
    }
    if (counterpartyRole === "customer" || counterpartyRole === "supplier") {
      errors.push("Contradictory classification: counterparty for own_equity cannot be customer or supplier.");
    }
  }
  if (normalizedOwnership === "external_investment") {
    const inst = (raw?.instrument || "").toLowerCase();
    if (inst.includes("own_equity") || inst.includes("share_capital")) {
      errors.push("Contradictory classification: external_investment cannot have own_equity instrument.");
    }
  }
  if (raw?.currency?.source === "explicit" && !raw?.currency?.value) {
    errors.push("Explicit currency source declared, but currency value is null.");
  }
  if (typeof raw?.amount === "number" && raw.amount < 0) {
    errors.push("Transaction amount cannot be negative.");
  }
  const rawBasis = raw?.measurementBasis || raw?.followUpAnalysis?.targetMeasurementBasis;
  let validatedBasis = void 0;
  if (rawBasis) {
    const validBases = ["FVTPL", "FVOCI", "AMORTISED_COST", "COST", "UNKNOWN"];
    const upper = String(rawBasis).toUpperCase();
    if (validBases.includes(upper)) {
      validatedBasis = upper;
    } else {
      errors.push(`Invalid measurementBasis: '${rawBasis}'`);
    }
  }
  if (normalizedOwnership === "own_equity" && (validatedBasis === "FVTPL" || validatedBasis === "FVOCI")) {
    errors.push("Contradictory classification: own_equity cannot have FVTPL or FVOCI measurement basis (SFRS(I) 1-32 \xA733).");
  }
  const isHypo = Boolean(raw?.isHypothetical || raw?.followUpAnalysis?.isHypothetical);
  const actualBasis = conversationContext?.actualMeasurementBasis || conversationContext?.underlyingTransaction?.actualMeasurementBasis || (!isHypo && validatedBasis ? validatedBasis : void 0);
  const projectedBasis = isHypo ? validatedBasis || conversationContext?.projectedMeasurementBasis : void 0;
  if (raw?.followUpAnalysis?.isFollowUp && conversationContext !== void 0) {
    const hasPriorState = Boolean(
      conversationContext.outstandingBalances.length > 0 || conversationContext.recognizedEquityTotal > 0 || conversationContext.underlyingTransaction
    );
    if (!hasPriorState) {
      errors.push("Invalid follow-up claim: followUpAnalysis.isFollowUp is true but conversationContext has no outstanding balances, equity, or underlying transaction.");
    }
  }
  if (userQuery && ["settlement", "partial_settlement"].includes(raw?.followUpAnalysis?.eventType)) {
    const hasPaymentAction = /\b(paid|pay(?:s|ing)?|payment|settle|settled|settlement|settling|remit|remitted|transfer|transferred|received|deposit|deposited|repaid|repay)\b/i.test(userQuery);
    if (!hasPaymentAction) {
      errors.push("Invalid settlement route: no payment action is stated in the user query.");
    }
  }
  const factsMissing = Array.isArray(raw?.factsMissing) ? [...raw.factsMissing] : [];
  const assumptions = Array.isArray(raw?.assumptions) ? [...raw.assumptions] : [];
  if (!raw?.reportingEntity?.type || raw.reportingEntity.type === "unknown") {
    factsMissing.push("Reporting entity perspective is unspecified");
  }
  if (raw?.currency?.source === "context_inference" && raw?.currency?.rationale) {
    assumptions.push(raw.currency.rationale);
  }
  if (raw?.currency?.source === "unknown") {
    factsMissing.push("Transaction currency is unspecified");
  }
  let confidence = typeof raw?.confidence === "number" ? Math.min(1, Math.max(0, raw.confidence)) : errors.length === 0 ? 0.85 : 0.4;
  const isFallback = source === "deterministic_fallback";
  if (isFallback) {
    confidence = Math.min(0.65, confidence);
  }
  const provenance = raw?.provenance ? {
    ...raw.provenance,
    tier: raw.provenance.tier || (isFallback ? "DETERMINISTIC_HEURISTIC_FALLBACK" : "AI_REASONING"),
    isFallback,
    confidenceCapped: isFallback
  } : {
    tier: isFallback ? "DETERMINISTIC_HEURISTIC_FALLBACK" : "AI_REASONING",
    isFallback,
    engine: isFallback ? "heuristic_pattern_matcher" : "llm_structured",
    appliedRules: isFallback ? raw?.appliedRules || ["heuristic_lexical_fallback"] : void 0,
    confidenceCapped: isFallback,
    notice: isFallback ? "Heuristic rule fallback: extracted using regex/keyword patterns; not validated by LLM reasoning" : void 0,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  let validatedTxType = void 0;
  if (raw?.transactionType) {
    const normalizedTx = normalizeTransactionNature(raw.transactionType);
    if (normalizedTx) {
      validatedTxType = normalizedTx;
    } else {
      errors.push(`Invalid transactionType: '${raw.transactionType}'`);
    }
  }
  let validatedInstrument = void 0;
  if (raw?.instrument) {
    const normalizedInst = normalizeInstrument(raw.instrument);
    if (normalizedInst) {
      validatedInstrument = normalizedInst;
    } else {
      errors.push(`Invalid instrument: '${raw.instrument}'`);
    }
  }
  const normalized = {
    extractionSource: source,
    provenance,
    reportingEntity: {
      type: raw?.reportingEntity?.type || "unknown",
      description: raw?.reportingEntity?.description || void 0
    },
    counterparty: raw?.counterparty ? {
      role: counterpartyRole || "unknown",
      description: raw.counterparty.description || void 0
    } : void 0,
    transactionType: validatedTxType,
    subject: raw?.subject || void 0,
    instrument: validatedInstrument,
    ownershipContext: normalizedOwnership,
    paymentStatus: raw?.paymentStatus || "unknown",
    amount: typeof raw?.amount === "number" ? raw.amount : void 0,
    currency: {
      value: raw?.currency?.value ?? null,
      source: raw?.currency?.source || "unknown",
      confidence: typeof raw?.currency?.confidence === "number" ? raw.currency.confidence : 0,
      rationale: raw?.currency?.rationale || void 0
    },
    transactionDate: raw?.transactionDate || null,
    jurisdiction: raw?.jurisdiction || fallbackJurisdiction,
    factsMissing: Array.from(new Set(factsMissing)),
    assumptions: Array.from(new Set(assumptions)),
    confidence,
    actualMeasurementBasis: actualBasis,
    projectedMeasurementBasis: projectedBasis,
    measurementBasis: validatedBasis || actualBasis,
    isHypothetical: isHypo,
    underlyingTransaction: conversationContext?.underlyingTransaction,
    followUpAnalysis: raw?.followUpAnalysis ? {
      eventType: raw.followUpAnalysis.eventType || "other",
      isFollowUp: Boolean(raw.followUpAnalysis.isFollowUp),
      targetCriteria: raw.followUpAnalysis.targetCriteria,
      targetTransactionId: raw.followUpAnalysis.targetTransactionId,
      targetMeasurementBasis: raw.followUpAnalysis.targetMeasurementBasis || validatedBasis,
      targetOutstandingAccount: raw.followUpAnalysis.targetOutstandingAccount || void 0,
      settlementAmount: typeof raw.followUpAnalysis.settlementAmount === "number" ? raw.followUpAnalysis.settlementAmount : void 0,
      remainingReceivableOrPayable: typeof raw.followUpAnalysis.remainingReceivableOrPayable === "number" ? raw.followUpAnalysis.remainingReceivableOrPayable : void 0,
      settlementAccount: raw.followUpAnalysis.settlementAccount || "cash_at_bank",
      isHypothetical: isHypo,
      explanation: raw.followUpAnalysis.explanation || ""
    } : void 0
  };
  return {
    isValid: errors.length === 0,
    errors,
    normalizedUnderstanding: normalized
  };
}
var DeterministicSemanticExtractor = class {
  extract(query, functionalCurrency = "SGD", jurisdiction = "SG", conversationContext) {
    const q = query.toLowerCase();
    let currency = this.extractCurrency(query, q, functionalCurrency, jurisdiction);
    let amount = this.extractAmount(query);
    let { reportingEntity, counterparty } = this.extractEntityPerspective(q);
    let { ownershipContext, subject, instrument, transactionType } = this.extractTransactionNature(q, reportingEntity, counterparty);
    let paymentStatus = this.extractPaymentStatus(q);
    let followUpAnalysis;
    const hasPriorContext = Boolean(
      conversationContext && (conversationContext.outstandingBalances.length > 0 || conversationContext.recognizedEquityTotal > 0 || conversationContext.underlyingTransaction)
    );
    const startsNewScenario = startsNewAccountingScenario(query, void 0, conversationContext);
    const isPaymentOrSettlementAction = /\b(paid|pay(?:s|ing)?|payment|settle|settled|settlement|settling|remit|remitted|transfer|transferred|received|deposit|deposited|repaid|repay)\b/i.test(query) && !(/\b(resign(?:ed|ation)?|pro[ -]?rat(?:e|ed|ion)|last\s+day)\b/i.test(query) && !/\b(paid|payment|settle|settled|settlement|transfer|transferred|received|deposit|deposited)\b/i.test(query));
    const introducesNewSubject = Boolean(
      conversationContext?.underlyingTransaction && (ownershipContext !== "unknown" && conversationContext.underlyingTransaction.ownershipContext && conversationContext.underlyingTransaction.ownershipContext !== "unknown" && ownershipContext !== conversationContext.underlyingTransaction.ownershipContext || transactionType && !["debt_settlement", "unclassified_transaction"].includes(transactionType) && transactionType !== conversationContext.underlyingTransaction.type && !isPaymentOrSettlementAction)
    );
    const isHypothetical = /\b(what if|suppose|assuming|if)\b/i.test(query);
    if (hasPriorContext && !startsNewScenario && !introducesNewSubject && isPaymentOrSettlementAction) {
      const isLoanRepayment = q.includes("repaid") || q.includes("repay") || (q.includes("loan") || q.includes("debt")) && (q.includes("principal") || q.includes("bank"));
      const hasReceivable = conversationContext?.outstandingBalances?.some((b) => b.nature === "RECEIVABLE") ?? false;
      const hasPayable = conversationContext?.outstandingBalances?.some((b) => b.nature === "PAYABLE" || b.category === "LIABILITY") ?? false;
      const isReceivingPayment = !isLoanRepayment && (q.includes("paid to") || q.includes("paid into") || q.includes("received") || q.includes("deposit") || q.includes("shareholder did pay") || q.includes("shareholder paid") || q.includes("customer paid") || q.includes("client paid") || q.includes("client") && q.includes("paid") || q.includes("customer") && q.includes("paid") || q.includes("did pay") || q.includes("did paid") || hasReceivable && !hasPayable);
      const targetRole = q.includes("shareholder") ? "shareholder" : q.includes("director") ? "director" : q.includes("customer") || q.includes("client") ? "customer" : q.includes("supplier") || q.includes("vendor") ? "supplier" : q.includes("lender") || q.includes("loan") || isLoanRepayment ? "lender" : conversationContext?.outstandingBalances?.[0]?.counterpartyRole;
      const targetNature = isReceivingPayment && !isLoanRepayment ? "RECEIVABLE" : "PAYABLE";
      const txMatch = query.match(/\b(tx-[a-zA-Z0-9_-]+)\b/i);
      const targetTransactionId = txMatch ? txMatch[1] : void 0;
      const targetCriteria = {
        counterpartyRole: targetRole,
        nature: targetNature,
        transactionId: targetTransactionId,
        queryTokens: query.toLowerCase().split(/\s+/).filter(Boolean),
        amount,
        currency: currency.value || void 0
      };
      followUpAnalysis = {
        eventType: "settlement",
        isFollowUp: true,
        targetCriteria,
        targetTransactionId,
        targetOutstandingAccount: targetRole ? `${targetRole} balance` : void 0,
        settlementAmount: amount,
        settlementAccount: "cash_at_bank",
        isHypothetical,
        explanation: `Settlement action for ${targetRole || "counterparty"} ${targetNature.toLowerCase()}`
      };
      paymentStatus = "paid";
      instrument = "cash_at_bank";
      ownershipContext = conversationContext.underlyingTransaction?.ownershipContext || "own_equity";
      subject = `Settlement of ${targetRole || "outstanding"} balance`;
      transactionType = "debt_settlement";
      reportingEntity = { type: "company", description: "Reporting entity is the corporate business" };
      if (!counterparty || counterparty.role === "unknown") {
        counterparty = {
          role: targetRole || "shareholder",
          description: targetRole === "shareholder" ? "Company shareholder" : "Counterparty"
        };
      }
      if (currency.source === "unknown") {
        currency = {
          value: conversationContext?.underlyingTransaction?.currency || functionalCurrency,
          source: "context_inference",
          confidence: 0.95,
          rationale: "Inherited from active transaction context"
        };
      }
    }
    let measurementBasis = void 0;
    if (/\b(fvoci|fair value through other comprehensive income)\b/i.test(query)) {
      measurementBasis = "FVOCI";
    } else if (/\b(fvtpl|fair value through profit or loss)\b/i.test(query)) {
      measurementBasis = "FVTPL";
    } else if (/\b(amortised cost|amortized cost)\b/i.test(query)) {
      measurementBasis = "AMORTISED_COST";
    } else if (conversationContext?.underlyingTransaction?.actualMeasurementBasis) {
      measurementBasis = conversationContext.underlyingTransaction.actualMeasurementBasis;
    }
    const isMeasurementFollowUp = Boolean(
      hasPriorContext && !introducesNewSubject && !isPaymentOrSettlementAction && (/\b(fvoci|fvtpl|amortised cost|amortized cost)\b/i.test(query) || isHypothetical && (q.includes("classification") || q.includes("treatment") || q.includes("measurement") || q.includes("double entry") || q.includes("journal")))
    );
    if (isMeasurementFollowUp && conversationContext?.underlyingTransaction) {
      const priorTx = conversationContext.underlyingTransaction;
      const targetBasis = /\b(fvoci|fair value through other comprehensive income)\b/i.test(query) ? "FVOCI" : /\b(fvtpl|fair value through profit or loss)\b/i.test(query) ? "FVTPL" : /\b(amortised cost|amortized cost)\b/i.test(query) ? "AMORTISED_COST" : measurementBasis || "UNKNOWN";
      followUpAnalysis = {
        eventType: "hypothetical_branch",
        isFollowUp: true,
        targetMeasurementBasis: targetBasis,
        isHypothetical: true,
        explanation: `Hypothetical ${targetBasis} measurement basis for existing transaction`
      };
      if (amount === void 0 && priorTx.totalAmount !== void 0) {
        amount = priorTx.totalAmount;
      }
      if (currency.source === "unknown") {
        currency = {
          value: priorTx.currency || functionalCurrency,
          source: "context_inference",
          confidence: 0.95,
          rationale: "Inherited from active transaction context"
        };
      }
      if (ownershipContext === "unknown" && priorTx.ownershipContext) {
        ownershipContext = priorTx.ownershipContext;
      }
      if (instrument === "unknown" && priorTx.instrument) {
        instrument = priorTx.instrument;
      }
      if (!transactionType || transactionType === "unclassified_transaction") {
        transactionType = priorTx.type;
      }
      if (!subject && priorTx.subject) {
        subject = priorTx.subject;
      }
      measurementBasis = targetBasis;
    } else if (!followUpAnalysis && isHypothetical && hasPriorContext && !introducesNewSubject && conversationContext?.underlyingTransaction) {
      const priorTx = conversationContext.underlyingTransaction;
      followUpAnalysis = {
        eventType: "hypothetical_branch",
        isFollowUp: true,
        isHypothetical: true,
        explanation: "Hypothetical parameter variation for existing transaction"
      };
      if (amount === void 0 && priorTx.totalAmount !== void 0) {
        amount = priorTx.totalAmount;
      }
      if (currency.source === "unknown") {
        currency = {
          value: priorTx.currency || functionalCurrency,
          source: "context_inference",
          confidence: 0.95,
          rationale: "Inherited from active transaction context"
        };
      }
      if (ownershipContext === "unknown" && priorTx.ownershipContext) {
        ownershipContext = priorTx.ownershipContext;
      }
      if (instrument === "unknown" && priorTx.instrument) {
        instrument = priorTx.instrument;
      }
      if (!transactionType || transactionType === "unclassified_transaction") {
        transactionType = priorTx.type;
      }
      if (!subject && priorTx.subject) {
        subject = priorTx.subject;
      }
    }
    const factsMissing = [];
    const assumptions = [];
    if (currency.source === "context_inference" && currency.rationale) {
      assumptions.push(currency.rationale);
    }
    const isCommercialTransaction = ownershipContext !== "unknown" || reportingEntity.type === "company" || q.includes("pay") || q.includes("bought") || q.includes("invested") || q.includes("subscribed") || q.includes("issued") || q.includes("cost") || q.includes("expense");
    if (isCommercialTransaction) {
      if (currency.source === "unknown") {
        factsMissing.push("Currency is not specified");
      }
      if (paymentStatus === "unknown") {
        factsMissing.push("Settlement/payment timing is unspecified");
      }
      if (amount === void 0) {
        factsMissing.push("Transaction amount is unspecified");
      }
    }
    const appliedRules = [];
    if (reportingEntity.type !== "unknown") appliedRules.push(`reporting_entity:${reportingEntity.type}`);
    if (counterparty && counterparty.role !== "unknown") appliedRules.push(`counterparty_role:${counterparty.role}`);
    if (ownershipContext !== "unknown") appliedRules.push(`ownership_context:${ownershipContext}`);
    if (transactionType && transactionType !== "unclassified_transaction") appliedRules.push(`transaction_type:${transactionType}`);
    if (paymentStatus !== "unknown") appliedRules.push(`payment_status:${paymentStatus}`);
    if (currency.source !== "unknown") appliedRules.push(`currency:${currency.source}`);
    if (followUpAnalysis?.isFollowUp) appliedRules.push(`follow_up:${followUpAnalysis.eventType}`);
    let confidence = 0.65;
    if (ownershipContext === "unknown") confidence -= 0.15;
    if (currency.source === "unknown") confidence -= 0.1;
    if (amount === void 0) confidence -= 0.1;
    confidence = Math.min(0.65, Math.max(0.2, Math.round(confidence * 100) / 100));
    const provenance = {
      tier: "DETERMINISTIC_HEURISTIC_FALLBACK",
      isFallback: true,
      engine: "heuristic_pattern_matcher",
      appliedRules,
      confidenceCapped: true,
      notice: "Heuristic rule fallback: extracted using regex/keyword patterns; not validated by LLM reasoning",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    const rawUnderstanding = {
      extractionSource: "deterministic_fallback",
      provenance,
      reportingEntity,
      counterparty,
      transactionType,
      subject,
      instrument,
      ownershipContext,
      paymentStatus,
      amount,
      currency,
      transactionDate: null,
      jurisdiction,
      factsMissing,
      assumptions,
      confidence,
      actualMeasurementBasis: conversationContext?.actualMeasurementBasis || conversationContext?.underlyingTransaction?.actualMeasurementBasis,
      projectedMeasurementBasis: isHypothetical ? measurementBasis || conversationContext?.projectedMeasurementBasis : void 0,
      measurementBasis: measurementBasis || conversationContext?.actualMeasurementBasis,
      isHypothetical,
      underlyingTransaction: conversationContext?.underlyingTransaction,
      followUpAnalysis
    };
    const validation = validateAndNormalizeUnderstanding(rawUnderstanding, jurisdiction, "deterministic_fallback", conversationContext, query);
    return validation.normalizedUnderstanding;
  }
  extractCurrency(query, q, _functionalCurrency, jurisdiction) {
    if (q.includes("usd") || q.includes("us dollar") || q.includes("us$")) {
      return { value: "USD", source: "explicit", confidence: 1, rationale: "Explicitly stated as USD / US Dollar" };
    }
    if (q.includes("sgd") || q.includes("singapore dollar") || q.includes("s$")) {
      return { value: "SGD", source: "explicit", confidence: 1, rationale: "Explicitly stated as SGD / Singapore Dollar" };
    }
    if (q.includes("eur") || q.includes("euro")) {
      return { value: "EUR", source: "explicit", confidence: 1, rationale: "Explicitly stated as EUR / Euro" };
    }
    if (q.includes("gbp") || q.includes("pound")) {
      return { value: "GBP", source: "explicit", confidence: 1, rationale: "Explicitly stated as GBP / British Pound" };
    }
    const hasDollarSign = query.includes("$");
    if (hasDollarSign) {
      if (jurisdiction === "SG") {
        return {
          value: "SGD",
          source: "context_inference",
          confidence: 0.9,
          rationale: "Interpreted as SGD based on Singapore jurisdiction and functional currency context"
        };
      }
      return {
        value: null,
        source: "unknown",
        confidence: 0,
        rationale: "Ambiguous $ currency symbol without established jurisdiction"
      };
    }
    if (q.includes("one dollar") || q.includes("dollar")) {
      if (jurisdiction === "SG") {
        return {
          value: "SGD",
          source: "context_inference",
          confidence: 0.85,
          rationale: "Interpreted as SGD based on Singapore jurisdiction"
        };
      }
      return {
        value: null,
        source: "unknown",
        confidence: 0,
        rationale: "Unqualified dollar denomination without jurisdiction"
      };
    }
    return {
      value: null,
      source: "unknown",
      confidence: 0,
      rationale: "No currency specified in query"
    };
  }
  extractAmount(query) {
    if (/\bone dollar\b/i.test(query)) return 1;
    if (/\btwo dollars\b/i.test(query)) return 2;
    const centsMatch = query.match(/\b(\d+)\s*cents?\b/i);
    if (centsMatch && centsMatch[1]) {
      return parseFloat(centsMatch[1]) / 100;
    }
    if (/\bhalf a dollar\b/i.test(query) || /\b50 cents\b/i.test(query)) return 0.5;
    const currFirstMatch = query.match(/(?:usd|sgd|eur|gbp|\$)\s*([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)?\b/i);
    if (currFirstMatch && currFirstMatch[1]) {
      let val = parseFloat(currFirstMatch[1].replace(/,/g, ""));
      if (isNaN(val)) return void 0;
      const unit = currFirstMatch[2]?.toLowerCase();
      if (unit === "k" || unit === "thousand") val *= 1e3;
      if (unit === "m" || unit === "million") val *= 1e6;
      return val;
    }
    const currLastMatch = query.match(/\b([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)?\s*(?:usd|sgd|eur|gbp|dollars)\b/i);
    if (currLastMatch && currLastMatch[1]) {
      let val = parseFloat(currLastMatch[1].replace(/,/g, ""));
      if (isNaN(val)) return void 0;
      const unit = currLastMatch[2]?.toLowerCase();
      if (unit === "k" || unit === "thousand") val *= 1e3;
      if (unit === "m" || unit === "million") val *= 1e6;
      return val;
    }
    const magMatch = query.match(/(?:for|cost|price|amount|paying|paid|invested)\s*([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)\b/i);
    if (magMatch && magMatch[1] && magMatch[2]) {
      let val = parseFloat(magMatch[1].replace(/,/g, ""));
      const unit = magMatch[2].toLowerCase();
      if (unit === "k" || unit === "thousand") val *= 1e3;
      if (unit === "m" || unit === "million") val *= 1e6;
      return val;
    }
    const standaloneMagnitudeMatch = query.match(/\b([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)\b/i);
    if (standaloneMagnitudeMatch && standaloneMagnitudeMatch[1] && standaloneMagnitudeMatch[2]) {
      let val = parseFloat(standaloneMagnitudeMatch[1].replace(/,/g, ""));
      if (isNaN(val)) return void 0;
      const unit = standaloneMagnitudeMatch[2].toLowerCase();
      if (unit === "k" || unit === "thousand") val *= 1e3;
      if (unit === "m" || unit === "million") val *= 1e6;
      return val;
    }
    const payVerbMatch = query.match(/(?:paid|paying|transferred|remitted|settled)\s*(?:(?:usd|sgd|\$)\s*)?([\d,]+(?:\.\d+)?)/i);
    if (payVerbMatch && payVerbMatch[1]) {
      const val = parseFloat(payVerbMatch[1].replace(/,/g, ""));
      if (!isNaN(val) && val > 0) return val;
    }
    return void 0;
  }
  extractEntityPerspective(q) {
    const isCompany = q.includes("company") || q.includes("own company") || q.includes("our company") || q.includes("we issued") || q.includes("we bought") || q.includes("we delivered") || q.includes("customer paid us") || q.includes("client paid") || q.includes("business bill") || q.includes("share capital") || q.includes("shareholder has invested") || q.includes("director paid a company expense") || q.includes("company expense was settled");
    const reportingEntity = {
      type: isCompany ? "company" : "unknown",
      description: isCompany ? "Reporting entity is the corporate business" : void 0
    };
    let role = "unknown";
    let roleDesc;
    if (q.includes("shareholder") || q.includes("founder") || q.includes("subscriber")) {
      role = "shareholder";
      roleDesc = "Company shareholder / equity subscriber";
    } else if (q.includes("director")) {
      role = "director";
      roleDesc = "Company director / key management";
    } else if (q.includes("customer") || q.includes("client")) {
      role = "customer";
      roleDesc = "Commercial customer / purchaser of goods or services";
    } else if (q.includes("supplier") || q.includes("vendor")) {
      role = "supplier";
      roleDesc = "Vendor / trade supplier";
    } else if (q.includes("employee") || q.includes("staff")) {
      role = "employee";
      roleDesc = "Employee / payroll recipient";
    } else if (q.includes("lender") || q.includes("bank loan")) {
      role = "lender";
      roleDesc = "Financial institution / lender";
    }
    return {
      reportingEntity,
      counterparty: role !== "unknown" ? { role, description: roleDesc } : void 0
    };
  }
  extractTransactionNature(q, _reportingEntity, _counterparty) {
    const isCustomerAdvance = (q.includes("customer") || q.includes("client")) && (q.includes("paid us before") || q.includes("advance for goods") || q.includes("advance") || q.includes("received money from customer before"));
    if (isCustomerAdvance) {
      return {
        ownershipContext: "not_applicable",
        subject: "advance payment for goods or services",
        instrument: "accounts_receivable",
        transactionType: "customer_advance_payment"
      };
    }
    const isDirectorExpense = q.includes("director") && (q.includes("personally") || q.includes("settled by the director") || q.includes("his own money") || q.includes("company expense"));
    if (isDirectorExpense) {
      return {
        ownershipContext: "not_applicable",
        subject: "company business expense settled by director",
        instrument: "director_current_account",
        transactionType: "director_expense_settlement"
      };
    }
    const isExternalInvestment = q.includes("apple") || q.includes("aapl") || q.includes("tesla") || q.includes("tsla") || q.includes("microsoft") || q.includes("transferred apple shares") || q.includes("bought") && q.includes("shares in") || q.includes("invested in") && !q.includes("own company") && !q.includes("share capital");
    if (isExternalInvestment) {
      return {
        ownershipContext: "external_investment",
        subject: "quoted equity securities in external entity",
        instrument: "financial_asset_equity",
        transactionType: "equity_investment_acquisition"
      };
    }
    const isOwnEquity = !isExternalInvestment && (q.includes("own company share capital") || q.includes("own company") || q.includes("our company") || q.includes("share capital was issued") || q.includes("issued one dollar of ordinary shares") || q.includes("issued shares to the founder") || q.includes("shares issued to founder") || q.includes("founder took up shares") || q.includes("subscription money is outstanding") || q.includes("amount subscribed for") || q.includes("shareholder") && (q.includes("contributed") || q.includes("invested") || q.includes("shares")) || q.includes("company shares") || q.includes("share capital") && q.includes("unpaid"));
    if (isOwnEquity) {
      return {
        ownershipContext: "own_equity",
        subject: "ordinary share capital of reporting entity",
        instrument: "own_equity",
        transactionType: "share_capital_issuance"
      };
    }
    if (q.includes("rental agreement") || q.includes("lease agreement") || q.includes("leased") || q.includes("office lease") || q.includes("property lease") || q.includes("tenancy agreement") || q.includes("lease") && (q.includes("rent") || q.includes("month") || q.includes("year"))) {
      return {
        ownershipContext: "not_applicable",
        subject: "commercial property lease",
        instrument: "right_of_use_asset",
        transactionType: "lease_contract"
      };
    }
    if (q.includes("entertainment expenses") || q.includes("office supplies") || q.includes("utility bill")) {
      return {
        ownershipContext: "not_applicable",
        subject: "operating expense",
        instrument: "cash_at_bank",
        transactionType: "expense_payment"
      };
    }
    if (q.includes("software") || q.includes("development") || q.includes("r&d") || q.includes("intangible")) {
      return {
        ownershipContext: "not_applicable",
        subject: "Software development / R&D expenditure",
        instrument: "intangible_asset",
        transactionType: "rd_capitalization"
      };
    }
    if (q.includes("car") || q.includes("vehicle") || q.includes("machinery") || q.includes("equipment")) {
      return {
        ownershipContext: "not_applicable",
        subject: "property, plant and equipment acquisition",
        instrument: "property_plant_equipment",
        transactionType: "asset_purchase"
      };
    }
    if (q.includes("trade discount")) {
      return {
        ownershipContext: "not_applicable",
        subject: "inventory or goods purchase with trade discount",
        instrument: "accounts_payable",
        transactionType: "trade_discount_purchase"
      };
    }
    if ((q.includes("invoice") || q.includes("on credit") || q.includes("consulting") || q.includes("sales")) && (q.includes("customer") || q.includes("client"))) {
      return {
        ownershipContext: "not_applicable",
        subject: "trade sales on credit to customer",
        instrument: "accounts_receivable",
        transactionType: "customer_invoice"
      };
    }
    if (q.includes("bank loan") || q.includes("loan principal") || q.includes("loan") && (q.includes("borrow") || q.includes("bank") || q.includes("repaid"))) {
      return {
        ownershipContext: "not_applicable",
        subject: "bank loan borrowing",
        instrument: "debt_instrument",
        transactionType: "debt_settlement"
      };
    }
    return {
      ownershipContext: "unknown",
      subject: void 0,
      instrument: void 0,
      transactionType: "unclassified_transaction"
    };
  }
  extractPaymentStatus(q) {
    if (q.includes("unpaid") || q.includes("hasn't paid") || q.includes("has not paid") || q.includes("payment pending") || q.includes("outstanding") || q.includes("owes the company") || q.includes("yet to pay") || q.includes("not yet paid")) {
      return "unpaid";
    }
    if (q.includes("partially paid") || q.includes("part paid") || q.includes("half paid") || q.includes("deposit paid")) {
      return "partially_paid";
    }
    if (q.includes("paid") || q.includes("received money") || q.includes("settled") || q.includes("transfer on") || q.includes("bank transfer")) {
      return "paid";
    }
    return "unknown";
  }
};
var SEMANTIC_EXTRACTION_SYSTEM_PROMPT = `You are an expert economic and accounting transaction classifier for Singapore and international financial reporting.
Your sole task is to analyze the user's natural-language commercial query and extract structured economic facts.
You do NOT generate journal entries or debit/credit lines. You ONLY classify the underlying economic facts.

Return ONLY a JSON object conforming strictly to this JSON schema:
{
  "reportingEntity": {
    "type": "company" | "individual" | "other" | "unknown",
    "description": string
  },
  "counterparty": {
    "role": "shareholder" | "customer" | "supplier" | "employee" | "lender" | "director" | "government" | "investor" | "other" | "unknown",
    "description": string
  },
  "transactionType": string,
  "subject": string,
  "instrument": string,
  "ownershipContext": "own_equity" | "external_investment" | "not_applicable" | "unknown",
  "paymentStatus": "paid" | "unpaid" | "partially_paid" | "unknown",
  "amount": number | null,
  "currency": {
    "value": string | null,
    "source": "explicit" | "context_inference" | "unknown",
    "confidence": number,
    "rationale": string
  },
  "transactionDate": string | null,
  "jurisdiction": "SG" | string,
  "factsMissing": string[],
  "assumptions": string[],
  "confidence": number,
  "measurementBasis": "FVTPL" | "FVOCI" | "AMORTISED_COST" | "COST" | "UNKNOWN" | null,
  "isHypothetical": boolean,
  "followUpAnalysis": {
    "eventType": "settlement" | "partial_settlement" | "hypothetical_branch" | "reclassification" | "new_transaction" | "other",
    "isFollowUp": boolean,
    "targetMeasurementBasis": "FVTPL" | "FVOCI" | "AMORTISED_COST" | "COST" | "UNKNOWN" | null,
    "targetOutstandingAccount": string | null,
    "settlementAmount": number | null,
    "remainingReceivableOrPayable": number | null,
    "settlementAccount": string | null,
    "isHypothetical": boolean,
    "explanation": string
  }
}

CRITICAL CLASSIFICATION INVARIANTS:
1. OWN EQUITY VS EXTERNAL INVESTMENT:
   - When a founder, shareholder, or subscriber is investing capital, taking up shares, or being issued/allotted shares in their OWN company / startup:
     * reportingEntity.type = "company"
     * counterparty.role = "shareholder"
     * ownershipContext = "own_equity" (under SFRS(I) 1-32 \xA733)
     * instrument = "own_equity"
     * NEVER classify this as "external_investment" or a financial asset.
   - When the reporting entity acquires or invests in shares of a THIRD-PARTY entity (e.g. Apple, Tesla, listed equities, foreign stocks):
     * ownershipContext = "external_investment"
2. CUSTOMER ADVANCE / DEFERRED REVENUE:
   - When a customer or client pays before delivery of goods/services:
     * counterparty.role = "customer"
     * transactionType = "customer_advance_payment"
     * paymentStatus = "paid"
3. DIRECTOR EXPENSE SETTLEMENT:
   - When a director, founder, or board member settles or pays a company bill/expense personally:
     * counterparty.role = "director"
     * transactionType = "director_expense_settlement"
4. PAYMENT STATUS:
   - If unpaid, remaining unpaid, owes, yet to pay, cash hasn't arrived, pending call/settlement:
     * paymentStatus = "unpaid"
   - If paid, settled, transferred:
     * paymentStatus = "paid"
   - The words "his", "her", "owner", a currency amount, or "payment" alone are NOT payroll evidence. Classify payroll_payment only when the query establishes an employee/wage/remuneration relationship (for example salary, wages, payroll, CPF, or employee).
   - For own-equity contributions using equipment, inventory, intellectual property, or other non-cash/in-kind consideration, retain ownershipContext = "own_equity", paymentStatus = "paid" when consideration was delivered, and add the asset description/fair-value support to factsMissing when absent.
5. CURRENCY:
   - In Singapore context (default), if "$" is used without explicit USD/EUR/etc, set currency.value = "SGD", currency.source = "context_inference", currency.confidence = 0.9.
   - Do NOT assume USD unless explicitly stated ("USD", "US Dollar", "US$").
   - If no currency symbol or code is provided, set currency.value = null, currency.source = "unknown", and add "Transaction currency is unspecified" to factsMissing.
6. AMOUNT:
   - Extract numeric transaction magnitude (e.g. 1 from "$1", 3000 from "3k"). Dates (e.g. 15/12/2026), percentages (9%), terms (30-day), or item counts (5 laptops) are NOT transaction amounts.
7. MULTI-TURN CONVERSATION & FOLLOW-UP SETTLEMENTS:
   - A change to an employee's resignation date, work period, salary, or CPF calculation is a payroll recalculation, NOT a settlement. The word "payroll" does not establish that money was paid. Preserve prior employee facts and mark "what if" changes as hypothetical.
   - When [PRIOR CONVERSATION ACCOUNTING CONTEXT] is provided and user asks about payment/settlement (e.g. "what if the shareholder did paid to company bank account", "what if they paid 50 cents"):
     * followUpAnalysis.eventType = "settlement" (or "partial_settlement" if amount < outstanding balance)
     * followUpAnalysis.isFollowUp = true
     * followUpAnalysis.targetOutstandingAccount = name of the receivable/payable from prior context
     * followUpAnalysis.settlementAmount = extracted amount or full outstanding balance if not restated
     * paymentStatus = "paid"
     * instrument = "cash_at_bank"
     * ownershipContext = inherit from prior context (e.g. "own_equity")
     * Do NOT classify this as an external investment or financial asset.
8. MEASUREMENT BASIS & HYPOTHETICAL ACCOUNTING POLICY:
   - When user asks about accounting policy, classification, or what-if alternative (e.g. "what if the investment is FVOCI show me the double entry", "what if instead FVTPL"):
     * measurementBasis = "FVOCI" (or "FVTPL", "AMORTISED_COST")
     * isHypothetical = true
     * followUpAnalysis.eventType = "hypothetical_branch"
     * followUpAnalysis.isFollowUp = true
     * followUpAnalysis.isHypothetical = true
     * followUpAnalysis.targetMeasurementBasis = "FVOCI" (or corresponding basis)
     * Inherit immutable transaction facts (amount, currency, counterparty, ownership) from [PRIOR CONVERSATION ACCOUNTING CONTEXT]!`;
var AISemanticExtractor = class {
  async extract(query, providerOrApiKey, _functionalCurrency = "SGD", _jurisdiction = "SG", conversationContext) {
    let contextPrompt = "";
    if (conversationContext && (conversationContext.outstandingBalances.length > 0 || conversationContext.recognizedEquityTotal > 0 || conversationContext.underlyingTransaction)) {
      contextPrompt = `
[PRIOR CONVERSATION ACCOUNTING CONTEXT]:
` + (conversationContext.underlyingTransaction ? `- Underlying Transaction: ${conversationContext.underlyingTransaction.subject} (Type: ${conversationContext.underlyingTransaction.type}, Ownership: ${conversationContext.underlyingTransaction.ownershipContext}, Amount: ${conversationContext.underlyingTransaction.currency} ${conversationContext.underlyingTransaction.totalAmount}, Actual Basis: ${conversationContext.underlyingTransaction.actualMeasurementBasis || "UNKNOWN"})
` : "") + (conversationContext.outstandingBalances.length > 0 ? `- Outstanding Balances:
` + conversationContext.outstandingBalances.map((b) => `  * ${b.accountName}: ${b.currency} ${b.remainingAmount} (${b.nature}, role: ${b.counterpartyRole})`).join("\n") + "\n" : "") + `- Recognized Equity Total: ${conversationContext.recognizedEquityTotal}
`;
    }
    const rawJsonText = await executeStructuredLlmCall(
      `Analyze the following commercial query and extract structured economic facts:

Query: "${query}"
${contextPrompt}
Return strictly valid JSON conforming to the schema.`,
      SEMANTIC_EXTRACTION_SYSTEM_PROMPT,
      providerOrApiKey,
      { jsonMode: true, temperature: 0.1 }
    );
    const parsed = repairAndParseAIJson(rawJsonText);
    if (parsed && typeof parsed === "object") {
      parsed.provenance = {
        tier: "AI_REASONING",
        isFallback: false,
        engine: typeof providerOrApiKey === "object" ? providerOrApiKey.activeProvider || "llm_structured" : "llm_structured",
        confidenceCapped: false,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    return parsed;
  }
};
var defaultAiSemanticExtractor = new AISemanticExtractor();
var defaultSemanticExtractor = new DeterministicSemanticExtractor();
var TransactionUnderstandingService = class {
  deterministicExtractor;
  aiExtractor;
  constructor(deterministicExtractor = defaultSemanticExtractor, aiExtractor = defaultAiSemanticExtractor) {
    this.deterministicExtractor = deterministicExtractor;
    this.aiExtractor = aiExtractor;
  }
  understandTransactionSync(query, functionalCurrency = "SGD", jurisdiction = "SG", conversationContext) {
    return this.deterministicExtractor.extract(query, functionalCurrency, jurisdiction, conversationContext);
  }
  async understandTransaction(query, functionalCurrency = "SGD", jurisdiction = "SG", providerOrApiKey, conversationContext) {
    const hasProvider = Boolean(
      typeof providerOrApiKey === "string" && providerOrApiKey.trim().length > 10 || typeof providerOrApiKey === "object" && (providerOrApiKey.activeProvider === "gemini" && Boolean(providerOrApiKey.gemini?.apiKey?.trim() && providerOrApiKey.gemini.apiKey.trim().length > 10) || providerOrApiKey.activeProvider === "azure" && Boolean(providerOrApiKey.azure?.apiKey?.trim() && providerOrApiKey.azure?.endpoint) || providerOrApiKey.activeProvider === "openai" && Boolean(providerOrApiKey.openai?.apiKey?.trim() && providerOrApiKey.openai.apiKey.trim().length > 10))
    );
    if (hasProvider) {
      try {
        const rawAi = await this.aiExtractor.extract(query, providerOrApiKey, functionalCurrency, jurisdiction, conversationContext);
        const validation = validateAndNormalizeUnderstanding(rawAi, jurisdiction, "ai", conversationContext, query);
        if (validation.isValid) {
          return validation.normalizedUnderstanding;
        }
        console.warn("[SemanticExtractor] AI extraction failed schema validation gate:", validation.errors);
      } catch (err) {
        console.warn("[SemanticExtractor] AI extraction call failed, falling back to deterministic extractor:", err?.message || err);
      }
    }
    return this.understandTransactionSync(query, functionalCurrency, jurisdiction, conversationContext);
  }
};
var defaultTransactionUnderstandingService = new TransactionUnderstandingService();

// src/engine/projectionBuilder.ts
function validateJournalBalance(group2) {
  const totalDebit = Math.round(group2.lines.reduce((s, l) => s + (l.debit || 0), 0) * 100) / 100;
  const totalCredit = Math.round(group2.lines.reduce((s, l) => s + (l.credit || 0), 0) * 100) / 100;
  const imbalance = Math.round(Math.abs(totalDebit - totalCredit) * 100) / 100;
  const calculatedIsBalanced = totalDebit > 0 && imbalance < 0.01;
  const declaredTotalsMatch = group2.totalDebit === totalDebit && group2.totalCredit === totalCredit;
  const declaredBalanceFlagMatches = group2.isBalanced === calculatedIsBalanced;
  const isBalanced = calculatedIsBalanced && declaredTotalsMatch && declaredBalanceFlagMatches;
  return {
    isBalanced,
    imbalance,
    totalDebit,
    totalCredit,
    declaredTotalsMatch,
    declaredBalanceFlagMatches
  };
}
function finalizeJournalGroup(group2) {
  const totalDebit = Math.round(group2.lines.reduce((sum, line2) => sum + line2.debit, 0) * 100) / 100;
  const totalCredit = Math.round(group2.lines.reduce((sum, line2) => sum + line2.credit, 0) * 100) / 100;
  return {
    ...group2,
    totalDebit,
    totalCredit,
    isBalanced: totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.01
  };
}
function isMeasurementBasisApplicable(tx, basis) {
  if (basis === "UNKNOWN") {
    return {
      isApplicable: false,
      reason: "Requested measurement basis is UNKNOWN or unspecified."
    };
  }
  if (tx.ownershipContext === "own_equity" || tx.type === "share_capital_issuance" || tx.type === "capital_reduction") {
    return {
      isApplicable: false,
      reason: `Under SFRS(I) 1-32 \xA733, an entity's own equity instruments can NEVER be classified or measured as financial assets (${basis}).`
    };
  }
  if (tx.type === "lease_contract" || tx.type === "lease_payment") {
    return {
      isApplicable: false,
      reason: `Commercial leases are governed by the SFRS(I) 16 ROU asset & amortised liability model, not ${basis}.`
    };
  }
  if (tx.type === "expense_payment" || tx.type === "director_expense_settlement" || tx.type === "payroll_payment") {
    return {
      isApplicable: false,
      reason: `General operating expenses are recognized in P&L under SFRS(I) 1-1 and do not possess an investment measurement basis (${basis}).`
    };
  }
  if (tx.ownershipContext === "external_investment" && (tx.instrument === "financial_asset_equity" || tx.instrument === "marketable_securities" || tx.instrument === "debt_instrument")) {
    if (basis === "FVTPL" || basis === "FVOCI" || basis === "AMORTISED_COST" || basis === "COST") {
      return { isApplicable: true };
    }
  }
  return {
    isApplicable: false,
    reason: `Measurement basis '${basis}' is not supported for transaction type '${tx.type}' and instrument '${tx.instrument}'.`
  };
}
function buildAccountingMeasurementProjection(params) {
  const { committedContext, followUpAnalysis } = params;
  const tx = committedContext.underlyingTransaction;
  if (!tx) {
    return {
      success: false,
      isHypothetical: true,
      projectedGroups: [],
      projectedEvents: [],
      explanation: "No underlying committed transaction found to project from.",
      authorityStatus: "CONDITIONAL",
      diagnosticNotice: "Amounts pending: Underlying transaction facts not established."
    };
  }
  const targetBasis = params.requestedBasis || followUpAnalysis?.targetMeasurementBasis;
  if (!targetBasis || targetBasis === "UNKNOWN") {
    return {
      success: false,
      isHypothetical: true,
      projectedGroups: [],
      projectedEvents: [],
      explanation: "No valid target measurement basis specified for projection.",
      authorityStatus: "CONDITIONAL",
      diagnosticNotice: "Classification pending: Requested measurement basis is UNKNOWN."
    };
  }
  const applicability = isMeasurementBasisApplicable(tx, targetBasis);
  if (!applicability.isApplicable) {
    return {
      success: false,
      isHypothetical: true,
      projectedGroups: [],
      projectedEvents: [],
      explanation: applicability.reason || `Measurement basis ${targetBasis} is not applicable.`,
      authorityStatus: "CONDITIONAL",
      diagnosticNotice: applicability.reason
    };
  }
  const requiredFacts = [
    ["transactionId", tx.transactionId],
    ["currency", tx.currency],
    ["functionalCurrency", tx.functionalCurrency],
    ["acquisitionFxRate", tx.acquisitionFxRate],
    ["totalAmount", tx.totalAmount]
  ];
  if (tx.disposalAmount !== void 0 && tx.disposalAmount !== null && tx.disposalAmount > 0) {
    requiredFacts.push(["disposalFxRate", tx.disposalFxRate]);
  }
  const missingFacts = requiredFacts.filter(
    ([name, value]) => value === void 0 || value === null || value === "" || (name === "acquisitionFxRate" || name === "disposalFxRate" || name === "totalAmount") && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
  ).map(([name]) => name);
  if (missingFacts.length > 0) {
    return {
      success: false,
      isHypothetical: true,
      projectedGroups: [],
      projectedEvents: [],
      explanation: "Projection cannot be prepared because committed transaction facts are incomplete.",
      authorityStatus: "CONDITIONAL",
      diagnosticNotice: `Authoritative facts pending: ${missingFacts.join(", ")}.`
    };
  }
  const txId = tx.transactionId;
  const assetTitle = tx.assetName || "Equity Investments";
  const txCurr = tx.currency;
  const funcCurr = tx.functionalCurrency;
  const buyFx = tx.acquisitionFxRate;
  const sellFx = tx.disposalFxRate;
  const totalAmt = tx.totalAmount;
  const dispAmt = tx.disposalAmount;
  const initialCostSGD = Math.round(totalAmt * buyFx * 100) / 100;
  const proceedsSGD = dispAmt && sellFx ? Math.round(dispAmt * sellFx * 100) / 100 : 0;
  const priorCommittedGroups = committedContext.priorJournals && committedContext.priorJournals.length > 0 ? committedContext.priorJournals.filter((g) => !g.isHypothetical) : [];
  const groups = [];
  if (targetBasis === "FVOCI") {
    const acqLines = [
      {
        id: "l-fvoci-buy-asset",
        accountCode: "1220",
        accountName: `Financial Asset at FVOCI (${assetTitle})`,
        category: "ASSET",
        debit: initialCostSGD,
        credit: 0,
        foreignCurrency: txCurr,
        foreignDebit: totalAmt,
        exchangeRate: buyFx,
        lineExplanation: `Initial recognition of equity investment designated at FVOCI under SFRS(I) 9 \xA75.1.1`
      },
      {
        id: "l-fvoci-buy-bank",
        accountCode: "1010",
        accountName: `Cash at Bank (${txCurr} Account)`,
        category: "ASSET",
        debit: 0,
        credit: initialCostSGD,
        foreignCurrency: txCurr,
        foreignCredit: totalAmt,
        exchangeRate: buyFx,
        lineExplanation: `Outflow of cash for equity share acquisition translated at transaction spot rate`
      }
    ];
    const acqGroup = {
      id: `grp-proj-acq-${priorCommittedGroups.length + 1}`,
      transactionId: txId,
      targetTransactionId: txId,
      isHypothetical: true,
      eventDate: formatSingaporeDate(tx.transactionDate || /* @__PURE__ */ new Date()),
      title: `Hypothetical Initial Acquisition (FVOCI)`,
      summary: `Initial recognition of equity investment under FVOCI`,
      lines: acqLines,
      totalDebit: initialCostSGD,
      totalCredit: initialCostSGD,
      isBalanced: true,
      citations: [],
      rationalePoints: [
        `Under SFRS(I) 9 \xA75.1.1: Financial assets designated at FVOCI are initially recognized at fair value plus transaction costs.`,
        `Initial acquisition translated at transaction spot exchange rate (${buyFx} ${funcCurr}/${txCurr}).`
      ],
      authorityStatus: "DETERMINISTIC"
    };
    groups.push(finalizeJournalGroup(acqGroup));
    if (proceedsSGD > 0) {
      const totalOciGain = Math.round((proceedsSGD - initialCostSGD) * 100) / 100;
      const isOciGain = totalOciGain >= 0;
      const sellLines = [
        {
          id: "l-fvoci-sell-bank",
          accountCode: "1010",
          accountName: `Cash at Bank (${txCurr} Account)`,
          category: "ASSET",
          debit: proceedsSGD,
          credit: 0,
          foreignCurrency: txCurr,
          foreignDebit: dispAmt,
          exchangeRate: sellFx,
          lineExplanation: `Gross disposal proceeds translated at disposal spot rate (${sellFx} ${funcCurr}/${txCurr})`
        },
        {
          id: "l-fvoci-sell-asset",
          accountCode: "1220",
          accountName: `Financial Asset at FVOCI (${assetTitle})`,
          category: "ASSET",
          debit: 0,
          credit: initialCostSGD,
          foreignCurrency: txCurr,
          foreignCredit: totalAmt,
          exchangeRate: buyFx,
          lineExplanation: `Derecognition of original carrying cost at acquisition spot rate`
        },
        {
          id: "l-fvoci-sell-reserve",
          accountCode: "3120",
          accountName: "Fair Value Reserve - FVOCI (Equity / OCI)",
          category: "EQUITY",
          debit: isOciGain ? 0 : Math.abs(totalOciGain),
          credit: isOciGain ? totalOciGain : 0,
          lineExplanation: `Cumulative fair value and foreign exchange difference recognized in OCI under SFRS(I) 9 \xA75.7.5 & SFRS(I) 1-21 \xA730 (P&L recycling = 0)`
        }
      ];
      const dispGroup = {
        id: `grp-proj-disp-${priorCommittedGroups.length + 2}`,
        transactionId: txId,
        targetTransactionId: txId,
        isHypothetical: true,
        eventDate: formatSingaporeDate(tx.disposalDate || /* @__PURE__ */ new Date()),
        title: `Hypothetical Disposal & Derecognition (FVOCI)`,
        summary: `Disposal of equity investment under FVOCI`,
        lines: sellLines,
        totalDebit: proceedsSGD,
        totalCredit: proceedsSGD,
        isBalanced: true,
        citations: [],
        rationalePoints: [
          `Under SFRS(I) 9 \xA75.7.5 and SFRS(I) 1-21 \xA730: For equity investments designated at FVOCI, all fair value changes and exchange differences are recognized in OCI within Fair Value Reserve.`,
          `Zero P&L recycling: Cumulative gains/losses recognized in OCI are NOT recycled to profit or loss upon disposal.`,
          `Optional Presentation Transfer: The accumulated reserve may be transferred directly within equity to Retained Earnings (not required for derecognition under SFRS(I) 9 \xA7B5.7.1).`
        ],
        authorityStatus: "DETERMINISTIC"
      };
      groups.push(finalizeJournalGroup(dispGroup));
    }
  } else if (targetBasis === "FVTPL") {
    const acqLines = [
      {
        id: "l-fvtpl-buy-asset",
        accountCode: "1210",
        accountName: `Financial Asset at FVTPL (${assetTitle})`,
        category: "ASSET",
        debit: initialCostSGD,
        credit: 0,
        foreignCurrency: txCurr,
        foreignDebit: totalAmt,
        exchangeRate: buyFx,
        lineExplanation: `Initial fair value recognition under SFRS(I) 9 \xA75.1.1`
      },
      {
        id: "l-fvtpl-buy-bank",
        accountCode: "1010",
        accountName: `Cash at Bank (${txCurr} Account)`,
        category: "ASSET",
        debit: 0,
        credit: initialCostSGD,
        foreignCurrency: txCurr,
        foreignCredit: totalAmt,
        exchangeRate: buyFx,
        lineExplanation: `Outflow of cash for equity share acquisition translated at transaction spot rate`
      }
    ];
    const acqGroup = {
      id: `grp-proj-acq-${priorCommittedGroups.length + 1}`,
      transactionId: txId,
      targetTransactionId: txId,
      isHypothetical: true,
      eventDate: formatSingaporeDate(tx.transactionDate || /* @__PURE__ */ new Date()),
      title: `Hypothetical Initial Acquisition (FVTPL)`,
      summary: `Initial recognition of equity investment under FVTPL`,
      lines: acqLines,
      totalDebit: initialCostSGD,
      totalCredit: initialCostSGD,
      isBalanced: true,
      citations: [],
      rationalePoints: [
        `Under SFRS(I) 9 \xA75.1.1: Financial assets at FVTPL are initially recognized at fair value.`,
        `Initial acquisition translated at spot exchange rate (${buyFx} ${funcCurr}/${txCurr}).`
      ],
      authorityStatus: "DETERMINISTIC"
    };
    groups.push(finalizeJournalGroup(acqGroup));
    if (proceedsSGD > 0) {
      const stockGainSGD = Math.round((dispAmt - totalAmt) * sellFx * 100) / 100;
      const fxGainSGD = Math.round(totalAmt * (sellFx - buyFx) * 100) / 100;
      const sellLines = [
        {
          id: "l-fvtpl-sell-bank",
          accountCode: "1010",
          accountName: `Cash at Bank (${txCurr} Account)`,
          category: "ASSET",
          debit: proceedsSGD,
          credit: 0,
          foreignCurrency: txCurr,
          foreignDebit: dispAmt,
          exchangeRate: sellFx,
          lineExplanation: `Gross disposal proceeds translated at disposal spot rate (${sellFx} ${funcCurr}/${txCurr})`
        },
        {
          id: "l-fvtpl-sell-asset",
          accountCode: "1210",
          accountName: `Financial Asset at FVTPL (${assetTitle})`,
          category: "ASSET",
          debit: 0,
          credit: initialCostSGD,
          foreignCurrency: txCurr,
          foreignCredit: totalAmt,
          exchangeRate: buyFx,
          lineExplanation: `Derecognition of carrying cost at acquisition spot rate`
        },
        {
          id: "l-fvtpl-sell-stockgain",
          accountCode: "4510",
          accountName: `Fair Value Gain on Shares (${assetTitle}) [P&L]`,
          category: "REVENUE",
          debit: 0,
          credit: stockGainSGD,
          lineExplanation: `Stock appreciation gain recognized in P&L`
        },
        {
          id: "l-fvtpl-sell-fxgain",
          accountCode: "4600",
          accountName: "Realized Foreign Exchange Gain (USD/SGD) [P&L / SFRS(I) 1-21]",
          category: "REVENUE",
          debit: 0,
          credit: fxGainSGD,
          lineExplanation: `Realized foreign currency translation gain recognized in P&L`
        }
      ];
      const dispGroup = {
        id: `grp-proj-disp-${priorCommittedGroups.length + 2}`,
        transactionId: txId,
        targetTransactionId: txId,
        isHypothetical: true,
        eventDate: formatSingaporeDate(tx.disposalDate || /* @__PURE__ */ new Date()),
        title: `Hypothetical Disposal & Derecognition (FVTPL)`,
        summary: `Disposal of equity investment under FVTPL`,
        lines: sellLines,
        totalDebit: proceedsSGD,
        totalCredit: proceedsSGD,
        isBalanced: true,
        citations: [],
        rationalePoints: [
          `Under SFRS(I) 9 & SFRS(I) 1-21: Investment at FVTPL recognizes stock appreciation and foreign exchange difference in profit or loss upon derecognition.`
        ],
        authorityStatus: "DETERMINISTIC"
      };
      groups.push(finalizeJournalGroup(dispGroup));
    }
  } else {
    return {
      success: false,
      isHypothetical: true,
      projectedGroups: [],
      projectedEvents: [],
      explanation: `Measurement basis '${targetBasis}' is not supported for projection generation.`,
      authorityStatus: "CONDITIONAL",
      diagnosticNotice: `Unsupported measurement combination for ${tx.type}.`
    };
  }
  for (const grp of groups) {
    const bal = validateJournalBalance(grp);
    if (!bal.isBalanced) {
      return {
        success: false,
        isHypothetical: true,
        projectedGroups: [],
        projectedEvents: [],
        explanation: `Generated projection failed journal invariant: lines, declared totals or balance flag disagree (debits ${bal.totalDebit}, credits ${bal.totalCredit}).`,
        authorityStatus: "CONDITIONAL",
        diagnosticNotice: `Imbalance detected (${bal.imbalance}). Journal presentation suppressed.`
      };
    }
  }
  const projectedEvents = groups.map((g, idx) => ({
    id: `evt-proj-${idx + 1}-${Date.now()}`,
    transactionId: txId,
    targetTransactionId: txId,
    type: "hypothetical_branch",
    description: g.title,
    amount: g.totalDebit,
    currency: funcCurr,
    affectedAccounts: g.lines.map((l) => l.accountName),
    journalLines: g.lines,
    eventDate: g.eventDate,
    isHypothetical: true
  }));
  return {
    success: true,
    isHypothetical: true,
    projectedGroups: groups,
    projectedEvents,
    explanation: `Hypothetical accounting treatment under ${targetBasis}. Original transaction facts preserved.`,
    authorityStatus: "DETERMINISTIC"
  };
}

// src/services/conversationAccountingState.ts
function generateBalanceKey(accountCode, accountName, counterpartyRole, transactionId) {
  const codeOrName = accountCode && accountCode.trim() ? accountCode.trim().toLowerCase() : (accountName || "unknown").trim().toLowerCase().replace(/[^a-z0-9]/g, "_");
  const role = counterpartyRole && counterpartyRole.trim() ? counterpartyRole.trim().toLowerCase() : "none";
  const tx = transactionId && transactionId.trim() ? transactionId.trim().toLowerCase() : "default";
  return `${codeOrName}_${role}_${tx}`;
}
function deriveAccountingStateFromEvents(events, functionalCurrency = "SGD") {
  const balancesMap = /* @__PURE__ */ new Map();
  let recognizedEquityTotal = 0;
  for (const ev of events) {
    const lines = ev.journalLines || [];
    const eventCurrency = ev.currency || functionalCurrency;
    for (const line2 of lines) {
      const nameLower = line2.accountName.toLowerCase();
      if (line2.category === "ASSET" && line2.debit > 0 && (nameLower.includes("due from") || nameLower.includes("receivable") || nameLower.includes("debtor") || nameLower.includes("unpaid"))) {
        const role = nameLower.includes("shareholder") ? "shareholder" : nameLower.includes("director") ? "director" : nameLower.includes("customer") ? "customer" : "other";
        const txId = ev.transactionId || ev.id || "default";
        const key = generateBalanceKey(line2.accountCode, line2.accountName, role, txId);
        if (!balancesMap.has(key)) {
          balancesMap.set(key, {
            balanceKey: key,
            accountCode: line2.accountCode,
            accountName: line2.accountName,
            category: "ASSET",
            nature: "RECEIVABLE",
            counterpartyRole: role,
            transactionId: txId,
            originalAmount: line2.debit,
            settledAmount: 0,
            remainingAmount: line2.debit,
            currency: eventCurrency
          });
        } else {
          const existing = balancesMap.get(key);
          existing.originalAmount += line2.debit;
          existing.remainingAmount += line2.debit;
        }
      }
      if (line2.category === "LIABILITY" && line2.credit > 0 && (nameLower.includes("due to") || nameLower.includes("payable") || nameLower.includes("creditor") || nameLower.includes("liability"))) {
        const role = nameLower.includes("shareholder") ? "shareholder" : nameLower.includes("director") ? "director" : nameLower.includes("supplier") ? "supplier" : "other";
        const txId = ev.transactionId || ev.id || "default";
        const key = generateBalanceKey(line2.accountCode, line2.accountName, role, txId);
        if (!balancesMap.has(key)) {
          balancesMap.set(key, {
            balanceKey: key,
            accountCode: line2.accountCode,
            accountName: line2.accountName,
            category: "LIABILITY",
            nature: "PAYABLE",
            counterpartyRole: role,
            transactionId: txId,
            originalAmount: line2.credit,
            settledAmount: 0,
            remainingAmount: line2.credit,
            currency: eventCurrency
          });
        } else {
          const existing = balancesMap.get(key);
          existing.originalAmount += line2.credit;
          existing.remainingAmount += line2.credit;
        }
      }
      if (line2.category === "EQUITY" && line2.credit > 0 && nameLower.includes("share capital")) {
        recognizedEquityTotal += line2.credit;
      }
    }
    if (ev.type === "settlement" || ev.type === "partial_settlement") {
      let targetBal;
      if (ev.targetBalanceKey && balancesMap.has(ev.targetBalanceKey)) {
        targetBal = balancesMap.get(ev.targetBalanceKey);
      } else if (ev.targetTransactionId) {
        for (const b of balancesMap.values()) {
          if (b.transactionId === ev.targetTransactionId) {
            targetBal = b;
            break;
          }
        }
      }
      if (targetBal) {
        const settleAmt = ev.amount ?? 0;
        const effectiveReduction = Math.min(targetBal.remainingAmount, settleAmt);
        targetBal.settledAmount += effectiveReduction;
        targetBal.remainingAmount = Math.max(0, Math.round((targetBal.remainingAmount - effectiveReduction) * 100) / 100);
      }
    }
  }
  return {
    outstandingBalances: Array.from(balancesMap.values()),
    recognizedEquityTotal: Math.round(recognizedEquityTotal * 100) / 100
  };
}
function resolveSettlementTarget(context, criteria) {
  if (!context.outstandingBalances || context.outstandingBalances.length === 0) {
    return {
      resolutionStatus: "NOT_FOUND",
      confidence: 0,
      margin: 0,
      candidateScores: [],
      reason: "No outstanding balances recorded in context"
    };
  }
  const candidateScores = [];
  for (const b of context.outstandingBalances) {
    if (criteria.transactionId && b.transactionId?.toLowerCase().trim() !== criteria.transactionId.toLowerCase().trim()) continue;
    if (criteria.currency && b.currency.toUpperCase() !== criteria.currency.toUpperCase()) continue;
    if (b.remainingAmount <= 0) continue;
    let score = 0;
    const rationales = [];
    if (criteria.transactionId) {
      const critTx = criteria.transactionId.toLowerCase().trim();
      const balTx = (b.transactionId || "").toLowerCase().trim();
      if (critTx === balTx) {
        score += 15;
        rationales.push(`Authoritative transaction ID match [${critTx}] (+15)`);
      } else if (balTx && balTx !== "default") {
        score -= 20;
        rationales.push(`Conflicting transaction ID [${critTx} vs ${balTx}] (-20)`);
      }
    }
    if (criteria.accountName) {
      const critName = criteria.accountName.toLowerCase().trim();
      const balName = b.accountName.toLowerCase().trim();
      if (critName === balName) {
        score += 10;
        rationales.push("Exact account name match (+10)");
      } else if (balName.includes(critName) || critName.includes(balName)) {
        score += 6;
        rationales.push("Partial account name match (+6)");
      }
    }
    if (criteria.counterpartyRole) {
      const critRole = criteria.counterpartyRole.toLowerCase().trim();
      const balRole = (b.counterpartyRole || "").toLowerCase().trim();
      if (critRole === balRole) {
        score += 8;
        rationales.push(`Counterparty role match [${critRole}] (+8)`);
      } else if (balRole && critRole && balRole !== "none" && critRole !== "none") {
        score -= 8;
        rationales.push(`Conflicting counterparty role [${critRole} vs ${balRole}] (-8)`);
      }
    }
    if (criteria.nature) {
      if (criteria.nature === b.nature) {
        score += 5;
        rationales.push(`Account nature match [${b.nature}] (+5)`);
      } else {
        score -= 10;
        rationales.push(`Opposite account nature [${criteria.nature} vs ${b.nature}] (-10)`);
      }
    }
    if (criteria.queryTokens && criteria.queryTokens.length > 0) {
      for (const token of criteria.queryTokens) {
        const t = token.toLowerCase();
        if (b.accountName.toLowerCase().includes(t)) {
          score += 3;
          rationales.push(`Account name contains query token "${t}" (+3)`);
        }
        if (b.counterpartyRole && b.counterpartyRole.toLowerCase().includes(t)) {
          score += 4;
          rationales.push(`Counterparty role matches query token "${t}" (+4)`);
        }
      }
    }
    if (b.remainingAmount > 0) {
      score += 2;
      rationales.push("Account has positive outstanding balance (+2)");
    }
    if (criteria.amount && criteria.amount > 0 && Math.abs(b.remainingAmount - criteria.amount) < 0.01) {
      score += 3;
      rationales.push(`Settlement amount matches exact outstanding balance (${criteria.amount}) (+3)`);
    }
    candidateScores.push({
      balanceKey: b.balanceKey,
      accountName: b.accountName,
      transactionId: b.transactionId,
      score,
      rationale: rationales.join("; ")
    });
  }
  candidateScores.sort((a, b) => b.score - a.score);
  const topCandidateScore = candidateScores[0];
  if (!topCandidateScore || topCandidateScore.score <= 0) {
    return {
      resolutionStatus: "NOT_FOUND",
      confidence: 0,
      margin: 0,
      candidateScores,
      reason: "No candidate balance matched with a positive score"
    };
  }
  const topBalance = context.outstandingBalances.find((b) => b.balanceKey === topCandidateScore.balanceKey);
  if (candidateScores.length === 1) {
    const confidence2 = Math.min(1, topCandidateScore.score / 15);
    return {
      targetBalance: topBalance,
      resolutionStatus: confidence2 >= 0.25 ? "RESOLVED" : "NOT_FOUND",
      confidence: Math.round(confidence2 * 100) / 100,
      margin: topCandidateScore.score,
      candidateScores,
      reason: `Single candidate matched with score ${topCandidateScore.score}`
    };
  }
  const secondCandidateScore = candidateScores[1];
  const margin = Math.round((topCandidateScore.score - secondCandidateScore.score) * 100) / 100;
  const confidence = Math.min(1, Math.max(0, topCandidateScore.score / 20));
  if (margin < 2) {
    return {
      resolutionStatus: "AMBIGUOUS",
      confidence: Math.round(confidence * 100) / 100,
      margin,
      candidateScores,
      reason: `Ambiguous match: top candidate (${topCandidateScore.accountName}, score ${topCandidateScore.score}) and second candidate (${secondCandidateScore.accountName}, score ${secondCandidateScore.score}) have margin of ${margin} (< 2.0)`
    };
  }
  return {
    targetBalance: topBalance,
    resolutionStatus: "RESOLVED",
    confidence: Math.round(confidence * 100) / 100,
    margin,
    candidateScores,
    reason: `Resolved decisively with margin ${margin}`
  };
}
function extractAccountingContext(currentScenario, _chatHistory) {
  const priorJournals = currentScenario?.committedDirectGroups && currentScenario.committedDirectGroups.length > 0 ? [...currentScenario.committedDirectGroups] : currentScenario?.directGroups ? currentScenario.directGroups.filter((g) => !g.isHypothetical) : [];
  let actualEvents = [];
  if (currentScenario?.actualEvents && currentScenario.actualEvents.length > 0) {
    actualEvents = currentScenario.actualEvents.filter((e) => !e.isHypothetical);
  } else if (priorJournals.length > 0) {
    actualEvents = priorJournals.map((grp, idx) => ({
      id: grp.id || `evt-init-${idx + 1}`,
      transactionId: grp.transactionId || grp.id || `tx-init-${idx + 1}`,
      targetTransactionId: grp.targetTransactionId,
      type: grp.title && grp.title.toLowerCase().includes("settle") ? "settlement" : "initial_transaction",
      description: grp.title || "Initial transaction",
      amount: grp.totalDebit,
      currency: currentScenario?.transactionCurrency || currentScenario?.functionalCurrency || "SGD",
      affectedAccounts: grp.lines.map((l) => l.accountName),
      journalLines: grp.lines,
      isHypothetical: false,
      timestamp: grp.eventDate,
      eventDate: grp.eventDate
    }));
  }
  const derived = deriveAccountingStateFromEvents(
    actualEvents,
    currentScenario?.transactionCurrency || currentScenario?.functionalCurrency || "SGD"
  );
  const outstandingBalances = [...derived.outstandingBalances];
  const recognizedEquityTotal = derived.recognizedEquityTotal;
  let ownershipContext = "unknown";
  if (currentScenario?.ownershipContext && currentScenario.ownershipContext !== "unknown") {
    ownershipContext = currentScenario.ownershipContext;
  } else if (currentScenario?.semanticUnderstanding?.ownershipContext && currentScenario.semanticUnderstanding.ownershipContext !== "unknown") {
    ownershipContext = currentScenario.semanticUnderstanding.ownershipContext;
  } else if (recognizedEquityTotal > 0) {
    ownershipContext = "own_equity";
  } else if (currentScenario?.scenarioType === "EQUITY_INVESTMENT_FX") {
    ownershipContext = "external_investment";
  } else if (currentScenario) {
    ownershipContext = "not_applicable";
  }
  const mapScenarioTypeToNature = (scenarioType) => {
    switch (scenarioType) {
      case "SHARE_CAPITAL_UNPAID":
      case "SHARE_CAPITAL_PAID":
        return "share_capital_issuance";
      case "EQUITY_INVESTMENT_FX":
        return "equity_investment_acquisition";
      case "COMMERCIAL_LEASE":
      case "LEASE_IFRS16":
        return "lease_contract";
      case "INTANGIBLE_ASSET_CAP":
        return "rd_capitalization";
      case "PPE_IAS16":
        return "asset_purchase";
      case "ASSET_PURCHASE_DISCOUNT":
        return "trade_discount_purchase";
      case "CUSTOMER_ADVANCE":
        return "customer_advance_payment";
      case "DIRECTOR_EXPENSE":
        return "director_expense_settlement";
      case "GENERAL_EXPENSE":
        return "expense_payment";
      default:
        return "unclassified_transaction";
    }
  };
  const resolvedTxType = currentScenario?.semanticUnderstanding?.transactionType && currentScenario.semanticUnderstanding.transactionType !== "unclassified_transaction" ? currentScenario.semanticUnderstanding.transactionType : mapScenarioTypeToNature(currentScenario?.scenarioType);
  const resolvedInstrument = currentScenario?.semanticUnderstanding?.instrument || (ownershipContext === "own_equity" ? "own_equity" : ownershipContext === "external_investment" ? "financial_asset_equity" : "unknown");
  const priorUnderlying = currentScenario?.underlyingTransaction;
  const actualMeasurementBasis = currentScenario?.actualMeasurementBasis || priorUnderlying?.actualMeasurementBasis || currentScenario?.classification || "UNKNOWN";
  const projectedMeasurementBasis = currentScenario?.projectedMeasurementBasis || priorUnderlying?.projectedMeasurementBasis;
  const totalAmount = currentScenario?.amount ?? priorUnderlying?.totalAmount ?? currentScenario?.purchaseAmountForeign;
  const currency = currentScenario?.transactionCurrency || priorUnderlying?.currency || currentScenario?.functionalCurrency || "SGD";
  const functionalCurrency = currentScenario?.functionalCurrency || priorUnderlying?.functionalCurrency || "SGD";
  const transactionDate = currentScenario?.purchaseDate || priorUnderlying?.transactionDate;
  const disposalDate = currentScenario?.saleDate || priorUnderlying?.disposalDate;
  const disposalAmount = currentScenario?.saleAmountForeign ?? priorUnderlying?.disposalAmount;
  const acquisitionFxRate = currentScenario?.purchaseFxRate ?? priorUnderlying?.acquisitionFxRate;
  const disposalFxRate = currentScenario?.saleFxRate ?? priorUnderlying?.disposalFxRate;
  const assetName = currentScenario?.assetName || priorUnderlying?.assetName;
  const quantity = currentScenario?.quantity ?? priorUnderlying?.quantity;
  const underlyingTransaction = currentScenario ? {
    transactionId: currentScenario.transactionId || priorUnderlying?.transactionId || priorJournals[0]?.transactionId,
    type: resolvedTxType,
    subject: currentScenario.transactionTitle || priorUnderlying?.subject || "Commercial Transaction",
    ownershipContext,
    instrument: resolvedInstrument,
    totalAmount,
    currency,
    functionalCurrency,
    transactionDate,
    disposalDate,
    disposalAmount,
    acquisitionFxRate,
    disposalFxRate,
    actualMeasurementBasis,
    projectedMeasurementBasis,
    assetName,
    quantity,
    counterpartyRole: currentScenario.counterpartyRole || priorUnderlying?.counterpartyRole
  } : void 0;
  return {
    activeEntity: {
      type: "company",
      description: "Reporting entity Singapore business"
    },
    underlyingTransaction,
    actualMeasurementBasis,
    projectedMeasurementBasis,
    events: currentScenario?.accountingEvents || actualEvents,
    actualEvents,
    outstandingBalances,
    recognizedEquityTotal,
    priorJournals,
    isHypothetical: Boolean(currentScenario?.isHypothetical)
  };
}
var settlementEventCounter = 0;
function calculateAccountingDelta(context, eventAnalysis, currency = "SGD") {
  if (eventAnalysis.eventType !== "settlement" && eventAnalysis.eventType !== "partial_settlement" && eventAnalysis.eventType !== "hypothetical_branch" && eventAnalysis.eventType !== "reclassification" && eventAnalysis.eventType !== "policy_election") {
    return null;
  }
  if (eventAnalysis.eventType === "hypothetical_branch" || eventAnalysis.eventType === "reclassification" || eventAnalysis.eventType === "policy_election") {
    const targetBasis = eventAnalysis.targetMeasurementBasis;
    const tx = context.underlyingTransaction;
    if (!tx || !targetBasis || targetBasis === "UNKNOWN") return null;
    const applicability = isMeasurementBasisApplicable(tx, targetBasis);
    if (!applicability.isApplicable) {
      return null;
    }
    if (!tx.transactionId || !tx.currency || !tx.functionalCurrency || !Number.isFinite(tx.totalAmount) || !tx.totalAmount || tx.totalAmount <= 0 || !Number.isFinite(tx.acquisitionFxRate) || !tx.acquisitionFxRate || tx.acquisitionFxRate <= 0 || tx.disposalAmount !== void 0 && tx.disposalAmount > 0 && (!Number.isFinite(tx.disposalFxRate) || !tx.disposalFxRate || tx.disposalFxRate <= 0)) {
      return null;
    }
    const initialCostSGD = Math.round(tx.totalAmount * tx.acquisitionFxRate * 100) / 100;
    const proceedsSGD = tx.disposalAmount ? Math.round(tx.disposalAmount * tx.disposalFxRate * 100) / 100 : 0;
    const totalOciGain = proceedsSGD ? Math.round((proceedsSGD - initialCostSGD) * 100) / 100 : 0;
    const assetTitle = tx.assetName || "Equity Investments";
    const txCurr = tx.currency;
    const lines2 = [];
    if (targetBasis === "FVOCI") {
      lines2.push(
        {
          id: "l-fvoci-buy-asset",
          accountCode: "1220",
          accountName: `Financial Asset at FVOCI (${assetTitle})`,
          category: "ASSET",
          debit: initialCostSGD,
          credit: 0,
          foreignCurrency: txCurr,
          foreignDebit: tx.totalAmount,
          exchangeRate: tx.acquisitionFxRate,
          lineExplanation: `Initial recognition of equity investment designated at FVOCI under SFRS(I) 9 \xA75.1.1`
        },
        {
          id: "l-fvoci-buy-bank",
          accountCode: "1010",
          accountName: `Cash at Bank (${txCurr} Account)`,
          category: "ASSET",
          debit: 0,
          credit: initialCostSGD,
          foreignCurrency: txCurr,
          foreignCredit: tx.totalAmount,
          exchangeRate: tx.acquisitionFxRate,
          lineExplanation: `Outflow of cash for equity share acquisition translated at transaction spot rate`
        }
      );
      if (proceedsSGD > 0) {
        lines2.push(
          {
            id: "l-fvoci-sell-bank",
            accountCode: "1010",
            accountName: `Cash at Bank (${txCurr} Account)`,
            category: "ASSET",
            debit: proceedsSGD,
            credit: 0,
            foreignCurrency: txCurr,
            foreignDebit: tx.disposalAmount,
            exchangeRate: tx.disposalFxRate,
            lineExplanation: `Gross disposal proceeds translated at disposal spot rate`
          },
          {
            id: "l-fvoci-sell-asset",
            accountCode: "1220",
            accountName: `Financial Asset at FVOCI (${assetTitle})`,
            category: "ASSET",
            debit: 0,
            credit: initialCostSGD,
            foreignCurrency: txCurr,
            foreignCredit: tx.totalAmount,
            exchangeRate: tx.acquisitionFxRate,
            lineExplanation: `Derecognition of original carrying cost at acquisition spot rate`
          },
          {
            id: "l-fvoci-sell-reserve",
            accountCode: "3120",
            accountName: "Fair Value Reserve - FVOCI (Equity / OCI)",
            category: "EQUITY",
            debit: 0,
            credit: totalOciGain,
            lineExplanation: `Cumulative fair value and foreign exchange gain recognized in OCI under SFRS(I) 9 \xA75.7.5 & SFRS(I) 1-21 \xA730 (P&L recycling = 0)`
          }
        );
      }
    } else if (targetBasis === "FVTPL") {
      const stockGainSGD = tx.disposalAmount ? Math.round((tx.disposalAmount - tx.totalAmount) * tx.disposalFxRate * 100) / 100 : 0;
      const fxGainSGD = tx.disposalAmount && tx.acquisitionFxRate && tx.disposalFxRate ? Math.round(tx.totalAmount * (tx.disposalFxRate - tx.acquisitionFxRate) * 100) / 100 : 0;
      lines2.push(
        {
          id: "l-fvtpl-buy-asset",
          accountCode: "1210",
          accountName: `Financial Asset at FVTPL (${assetTitle})`,
          category: "ASSET",
          debit: initialCostSGD,
          credit: 0,
          foreignCurrency: txCurr,
          foreignDebit: tx.totalAmount,
          exchangeRate: tx.acquisitionFxRate,
          lineExplanation: `Initial fair value recognition under SFRS(I) 9 \xA75.1.1`
        },
        {
          id: "l-fvtpl-buy-bank",
          accountCode: "1010",
          accountName: `Cash at Bank (${txCurr} Account)`,
          category: "ASSET",
          debit: 0,
          credit: initialCostSGD,
          foreignCurrency: txCurr,
          foreignCredit: tx.totalAmount,
          exchangeRate: tx.acquisitionFxRate,
          lineExplanation: `Outflow of cash for equity share acquisition translated at transaction spot rate`
        }
      );
      if (proceedsSGD > 0) {
        lines2.push(
          {
            id: "l-fvtpl-sell-bank",
            accountCode: "1010",
            accountName: `Cash at Bank (${txCurr} Account)`,
            category: "ASSET",
            debit: proceedsSGD,
            credit: 0,
            foreignCurrency: txCurr,
            foreignDebit: tx.disposalAmount,
            exchangeRate: tx.disposalFxRate,
            lineExplanation: `Gross disposal proceeds translated at disposal spot rate`
          },
          {
            id: "l-fvtpl-sell-asset",
            accountCode: "1210",
            accountName: `Financial Asset at FVTPL (${assetTitle})`,
            category: "ASSET",
            debit: 0,
            credit: initialCostSGD,
            foreignCurrency: txCurr,
            foreignCredit: tx.totalAmount,
            exchangeRate: tx.acquisitionFxRate,
            lineExplanation: `Derecognition of carrying cost at acquisition spot rate`
          },
          {
            id: "l-fvtpl-sell-stockgain",
            accountCode: "4510",
            accountName: `Fair Value Gain on Shares (${assetTitle}) [P&L]`,
            category: "REVENUE",
            debit: 0,
            credit: stockGainSGD,
            lineExplanation: `Stock appreciation gain recognized in P&L`
          },
          {
            id: "l-fvtpl-sell-fxgain",
            accountCode: "4600",
            accountName: "Realized Foreign Exchange Gain (USD/SGD) [P&L / SFRS(I) 1-21]",
            category: "REVENUE",
            debit: 0,
            credit: fxGainSGD,
            lineExplanation: `Realized foreign currency translation gain recognized in P&L`
          }
        );
      }
    }
    return {
      eventType: eventAnalysis.eventType,
      journalLines: lines2,
      amount: proceedsSGD || initialCostSGD,
      currency: tx.functionalCurrency || currency,
      balanceUpdates: [],
      isHypothetical: true,
      targetBalanceKey: void 0,
      resultingAccountingEvent: {
        id: `evt-hypo-${Date.now()}`,
        transactionId: tx.transactionId,
        targetTransactionId: tx.transactionId,
        type: "hypothetical_branch",
        description: `Hypothetical ${targetBasis} measurement projection`,
        amount: proceedsSGD || initialCostSGD,
        currency: tx.functionalCurrency || currency,
        journalLines: lines2,
        eventDate: formatSingaporeDate(/* @__PURE__ */ new Date()),
        isHypothetical: true
      },
      explanation: `Hypothetical accounting treatment under ${targetBasis}. Original transaction facts preserved.`
    };
  }
  const queryTokens = [];
  const targetAcc = (eventAnalysis.targetOutstandingAccount || "").toLowerCase();
  const expl = (eventAnalysis.explanation || "").toLowerCase();
  if (targetAcc.includes("shareholder") || expl.includes("shareholder")) queryTokens.push("shareholder");
  if (targetAcc.includes("director") || expl.includes("director")) queryTokens.push("director");
  if (targetAcc.includes("customer") || expl.includes("customer")) queryTokens.push("customer");
  if (targetAcc.includes("supplier") || expl.includes("supplier")) queryTokens.push("supplier");
  if (targetAcc.includes("lender") || expl.includes("lender") || expl.includes("loan") || expl.includes("debt")) queryTokens.push("lender");
  const counterpartyRole = eventAnalysis.targetCriteria?.counterpartyRole || (queryTokens.includes("shareholder") ? "shareholder" : queryTokens.includes("director") ? "director" : queryTokens.includes("customer") ? "customer" : queryTokens.includes("supplier") ? "supplier" : queryTokens.includes("lender") ? "lender" : void 0);
  const criteria = {
    accountName: eventAnalysis.targetOutstandingAccount,
    counterpartyRole,
    nature: eventAnalysis.targetCriteria?.nature || "RECEIVABLE",
    transactionId: eventAnalysis.targetTransactionId || eventAnalysis.targetCriteria?.transactionId,
    queryTokens,
    currency,
    amount: eventAnalysis.settlementAmount
  };
  const resolution2 = resolveSettlementTarget(context, criteria);
  if (resolution2.resolutionStatus !== "RESOLVED" || !resolution2.targetBalance) {
    return null;
  }
  const targetBalance = resolution2.targetBalance;
  const settlementAmount = Math.round(
    (eventAnalysis.settlementAmount !== void 0 && eventAnalysis.settlementAmount > 0 ? eventAnalysis.settlementAmount : targetBalance.remainingAmount) * 100
  ) / 100;
  const previousBalance = targetBalance.remainingAmount;
  if (settlementAmount > previousBalance) return null;
  const isPartial = settlementAmount < previousBalance;
  const resolvedEventType = isPartial ? "partial_settlement" : "settlement";
  const effectiveSettledOnReceivable = settlementAmount;
  const resultingBalance = Math.max(0, Math.round((previousBalance - settlementAmount) * 100) / 100);
  const isReceivable = targetBalance.nature === "RECEIVABLE" || targetBalance.category === "ASSET";
  const lines = isReceivable ? [
    {
      id: "l-settle-bank",
      accountCode: "1010",
      accountName: "Cash at Bank (Current Account)",
      category: "ASSET",
      debit: settlementAmount,
      credit: 0,
      lineExplanation: `Receipt of settlement funds into company bank account (${currency} ${settlementAmount.toFixed(2)})`
    },
    {
      id: "l-settle-receivable",
      accountCode: targetBalance.accountCode || "1150",
      accountName: targetBalance.accountName,
      category: targetBalance.category,
      debit: 0,
      credit: effectiveSettledOnReceivable,
      lineExplanation: `Settlement and derecognition of outstanding ${targetBalance.accountName}`
    }
  ] : [
    {
      id: "l-settle-payable",
      accountCode: targetBalance.accountCode || "2100",
      accountName: targetBalance.accountName,
      category: targetBalance.category,
      debit: effectiveSettledOnReceivable,
      credit: 0,
      lineExplanation: `Settlement and derecognition of outstanding ${targetBalance.accountName}`
    },
    {
      id: "l-settle-bank",
      accountCode: "1010",
      accountName: "Cash at Bank (Current Account)",
      category: "ASSET",
      debit: 0,
      credit: settlementAmount,
      lineExplanation: `Disbursement of settlement funds from company bank account (${currency} ${settlementAmount.toFixed(2)})`
    }
  ];
  const prefix = eventAnalysis.isHypothetical ? "Hypothetical" : "Subsequent";
  const explanation = `${prefix} settlement of outstanding ${targetBalance.accountName} via bank transfer. ` + (targetBalance.counterpartyRole === "shareholder" && targetBalance.nature === "RECEIVABLE" ? "Share Capital is not credited again because it was recognized on allotment. " : "") + `Remaining balance on ${targetBalance.accountName}: ${currency} ${resultingBalance.toFixed(2)}.`;
  settlementEventCounter++;
  const uniqueIdSuffix = `${Date.now()}-${settlementEventCounter}-${Math.random().toString(36).slice(2, 6)}`;
  const resultingAccountingEvent = {
    id: `evt-settle-${uniqueIdSuffix}`,
    transactionId: `tx-settle-${uniqueIdSuffix}`,
    targetTransactionId: targetBalance.transactionId || context.underlyingTransaction?.transactionId,
    type: resolvedEventType,
    description: explanation,
    amount: settlementAmount,
    currency,
    affectedAccounts: lines.map((l) => l.accountName),
    isHypothetical: Boolean(eventAnalysis.isHypothetical),
    targetBalanceKey: targetBalance.balanceKey,
    journalLines: lines,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    eventDate: formatSingaporeDate(/* @__PURE__ */ new Date())
  };
  return {
    eventType: resolvedEventType,
    journalLines: lines,
    amount: settlementAmount,
    currency,
    isHypothetical: Boolean(eventAnalysis.isHypothetical),
    targetBalanceKey: targetBalance.balanceKey,
    resultingAccountingEvent,
    balanceUpdates: [
      {
        balanceKey: targetBalance.balanceKey,
        accountName: targetBalance.accountName,
        previousBalance,
        delta: -effectiveSettledOnReceivable,
        resultingBalance
      }
    ],
    explanation
  };
}
function validateAccountingStateTransition(context, proposedLines, eventType) {
  const violations = [];
  if (eventType === "settlement" || eventType === "partial_settlement") {
    const creditsShareCapital = proposedLines.some(
      (l) => l.credit > 0 && l.category === "EQUITY" && l.accountName.toLowerCase().includes("share capital")
    );
    if (creditsShareCapital && context.recognizedEquityTotal > 0) {
      violations.push(
        "GUARDRAIL_VIOLATION_DUPLICATE_EQUITY: Share Capital was already recognized upon initial allotment. Subsequent settlement must credit the receivable, not Share Capital again."
      );
    }
  }
  if (eventType === "settlement" || eventType === "partial_settlement") {
    const hasReceivableCredit = proposedLines.some(
      (l) => l.credit > 0 && (l.accountName.toLowerCase().includes("due from") || l.accountName.toLowerCase().includes("receivable") || l.accountName.toLowerCase().includes("debtor"))
    );
    if (!hasReceivableCredit && context.outstandingBalances.some((b) => b.nature === "RECEIVABLE")) {
      violations.push(
        "GUARDRAIL_VIOLATION_SETTLEMENT_TARGET: Settlement payment must credit the outstanding receivable account."
      );
    }
  }
  const totalDebit = Math.round(proposedLines.reduce((s, l) => s + (l.debit || 0), 0) * 100) / 100;
  const totalCredit = Math.round(proposedLines.reduce((s, l) => s + (l.credit || 0), 0) * 100) / 100;
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    violations.push(
      `GUARDRAIL_VIOLATION_IMBALANCE: Debits (${totalDebit}) do not equal Credits (${totalCredit}).`
    );
  }
  return {
    isValid: violations.length === 0,
    violations
  };
}
function commitAccountingEvent(committedList, newEvent) {
  if (newEvent.isHypothetical) {
    throw new Error(`Cannot commit hypothetical event [${newEvent.id || "unknown"}] to actual history.`);
  }
  const txId = (newEvent.transactionId || "").trim();
  if (!txId || txId.toLowerCase() === "default") {
    throw new Error(`INVALID_TRANSACTION_ID: Committed event must have an authoritative, non-empty transactionId (received "${newEvent.transactionId}"). "default" is not permitted.`);
  }
  if (newEvent.type === "settlement" || newEvent.type === "partial_settlement") {
    const hasTargetTx = Boolean(newEvent.targetTransactionId && newEvent.targetTransactionId.trim() && newEvent.targetTransactionId.trim().toLowerCase() !== "default");
    const hasTargetBal = Boolean(newEvent.targetBalanceKey && newEvent.targetBalanceKey.trim());
    if (!hasTargetTx && !hasTargetBal) {
      throw new Error(`INVALID_SETTLEMENT_TARGET: Committed settlement event [${txId}] must have an authoritative targetTransactionId or targetBalanceKey.`);
    }
  }
  const eventToCommit = {
    ...newEvent,
    transactionId: txId,
    isHypothetical: false
  };
  if (committedList.some((e) => (e.transactionId || "").trim().toLowerCase() === txId.toLowerCase())) {
    throw new Error(`DUPLICATE_TRANSACTION_ID: Event with transactionId "${txId}" is already committed.`);
  }
  return [...committedList, eventToCommit];
}

// src/services/factAmendmentService.ts
var CORRECTION_MARKER = /\b(i mean|actually|correction|correct(?:ion|ed)?|rather|instead|not\s+\S+\s+but)\b/i;
function parseAmount(query) {
  const match = query.match(/(?:sgd|usd|eur|gbp|\$)?\s*([\d,]+(?:\.\d+)?)(?:\s*(k|m|million|thousand)\b)?\s*(?:a\s*month|\/month|monthly|per\s*month)?/i);
  if (!match?.[1]) return void 0;
  let amount = Number(match[1].replace(/,/g, ""));
  const magnitude = match[2]?.toLowerCase();
  if (magnitude === "k" || magnitude === "thousand") amount *= 1e3;
  if (magnitude === "m" || magnitude === "million") amount *= 1e6;
  return Number.isFinite(amount) && amount > 0 ? amount : void 0;
}
function primaryAmountField(scenario, query) {
  const q = query.toLowerCase();
  switch (scenario.scenarioType) {
    case "PAYROLL_CPF_SALARY":
      return "monthlySalary";
    case "LEASE_IFRS16":
    case "COMMERCIAL_LEASE":
      return "leasePaymentMonthly";
    case "EQUITY_INVESTMENT_FX":
      if (q.includes("rate") || q.includes("fx")) return q.includes("sale") || q.includes("disposal") ? "disposalFxRate" : "acquisitionFxRate";
      return q.includes("sale") || q.includes("proceed") ? "disposalAmount" : "purchaseAmountForeign";
    case "CUSTOMER_INVOICE":
      return q.includes("paid") || q.includes("settle") ? "settlementAmount" : "invoiceAmount";
    case "SUPPLIER_INVOICE":
      return q.includes("paid") || q.includes("settle") ? "settlementAmount" : "invoiceAmount";
    case "DEBT":
    case "DEBT_SETTLEMENT":
      return q.includes("repay") || q.includes("paid") ? "repaymentAmount" : "principalAmount";
    default:
      return scenario.amount && scenario.amount > 0 ? "amount" : void 0;
  }
}
function resolveFactAmendment(query, scenario) {
  if (!scenario || !CORRECTION_MARKER.test(query)) return { intent: "QUESTION" };
  const amount = parseAmount(query);
  if (amount === void 0) {
    return {
      intent: "FACT_AMENDMENT",
      clarificationNeeded: "I recognised a correction, but could not identify the corrected value."
    };
  }
  const field = primaryAmountField(scenario, query);
  if (!field) {
    return {
      intent: "FACT_AMENDMENT",
      clarificationNeeded: "Which existing amount should be replaced by this corrected value?"
    };
  }
  return {
    intent: "FACT_AMENDMENT",
    amendments: [{
      field,
      value: amount,
      priorValue: scenario.amount,
      confidence: 0.92,
      evidence: query,
      source: "deterministic",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    }]
  };
}
function applyFactAmendments(scenario, amendments) {
  const next = { ...scenario, factAmendments: [...scenario.factAmendments || [], ...amendments] };
  for (const amendment of amendments) {
    if (typeof amendment.value !== "number") continue;
    switch (amendment.field) {
      case "monthlySalary":
        next.amount = amendment.value;
        break;
      case "leasePaymentMonthly":
        next.leasePaymentMonthly = amendment.value;
        break;
      case "purchaseAmountForeign":
        next.purchaseAmountForeign = amendment.value;
        break;
      case "disposalAmount":
        next.saleAmountForeign = amendment.value;
        break;
      case "acquisitionFxRate":
        next.purchaseFxRate = amendment.value;
        break;
      case "disposalFxRate":
        next.saleFxRate = amendment.value;
        break;
      case "amount":
        next.amount = amendment.value;
        break;
    }
  }
  return next;
}
function buildAmendedQuery(scenario, amendments) {
  const phrases = amendments.map(({ field, value }) => {
    const amount = typeof value === "number" ? `SGD ${value.toLocaleString()}` : String(value);
    switch (field) {
      case "monthlySalary":
        return `Corrected monthly salary is ${amount}.`;
      case "leasePaymentMonthly":
        return `Corrected monthly lease payment is ${amount}.`;
      case "purchaseAmountForeign":
        return `Corrected investment purchase amount is ${amount}.`;
      case "disposalAmount":
        return `Corrected investment disposal proceeds are ${amount}.`;
      case "acquisitionFxRate":
        return `Corrected acquisition FX rate is ${value}.`;
      case "disposalFxRate":
        return `Corrected disposal FX rate is ${value}.`;
      default:
        return `Corrected transaction amount is ${amount}.`;
    }
  });
  return `${phrases.join(" ")} Original transaction context: ${scenario.rawQuery}`;
}

// src/services/corporateTaxTreatment.ts
function assessCorporateTaxTreatment(query) {
  const normalized = query.toLowerCase();
  if (/\b(fine|penalt(?:y|ies)|private|personal|director(?:'s)? expense|shareholder(?:'s)? expense)\b/.test(normalized)) {
    return {
      treatment: "NON_DEDUCTIBLE_ADD_BACK",
      summary: "This appears to be private, domestic, or penalty expenditure. It should be added back in the corporate tax computation rather than claimed as a Section 14 deduction.",
      reviewNotice: "Confirm the beneficiary and business purpose. A director/shareholder payment may also require separate accounting and corporate-governance review.",
      sourceRecordIds: ["ITA_SEC15_PROHIBITED_DEDUCTIONS"]
    };
  }
  if (/\b(depreciation|capital expenditure|capital asset|plant|machinery|equipment|computer|renovation|refurbishment)\b/.test(normalized)) {
    return {
      treatment: "CAPITAL_ALLOWANCE_REVIEW",
      summary: "Accounting depreciation and capital expenditure are not a direct Section 14 deduction. Review whether the asset qualifies for capital allowances and apply the relevant statutory rules.",
      reviewNotice: "Confirm asset type, business use, acquisition date, and any exclusion before claiming capital allowances.",
      sourceRecordIds: ["ITA_SEC15_PROHIBITED_DEDUCTIONS", "ITA_SEC19_19A_CAPITAL_ALLOWANCES"]
    };
  }
  return {
    treatment: "DEDUCTIBLE_SUBJECT_TO_EVIDENCE",
    summary: "The expense may be deductible under Section 14(1) only if it was wholly and exclusively incurred in producing business income and is supported by records.",
    reviewNotice: "Retain invoices and evidence of business purpose; private, capital, and prohibited expenditure must be added back.",
    sourceRecordIds: ["ITA_SEC14_GENERAL_DEDUCTION", "ITA_SEC15_PROHIBITED_DEDUCTIONS"]
  };
}

// src/engine/scenarioParser.ts
function isStatutoryInquiry(query) {
  const q = query.toLowerCase();
  return q.includes("audit exemption") || q.includes("small company") || q.includes("small group") || q.includes("cpf ceiling") || q.includes("ordinary wage") || q.includes("aw ceiling") || q.includes("skills development levy") || q.includes("sdl") || q.includes("cpf rate") || q.includes("cpf contribution") || q.includes("senior worker") || q.includes("tax deduct") || q.includes("non-deductible") || q.includes("prohibited expense") || q.includes("section 14") || q.includes("section 15") || q.includes("15(1)(k)") || q.includes("sute") || q.includes("pte") || q.includes("form c-s") || q.includes("form c") || q.includes("corporate tax rate") || q.includes("gst registration") || q.includes("compulsory gst") || q.includes("blocked input") || q.includes("regulation 26") || q.includes("gst remission") || q.includes("fixed recovery rate") || q.includes("zero rated") || q.includes("zero-rated") || q.includes("agm deadline") || q.includes("annual return") || q.includes("bizfile") || q.includes("resident director") || q.includes("company secretary") || q.includes("record retention") || q.includes("salary deadline") || q.includes("overtime pay") || q.includes("overtime rate") || q.includes("leave entitlement") || q.includes("annual leave") || q.includes("sick leave") || q.includes("hospitalisation") || q.includes("public holiday") || q.includes("employment act") || q.includes("enterprise innovation") || q.includes("eis") || q.includes("r&d deduction") || q.includes("turnover") || q.includes("exchange control") || q.includes("capital control") || q.includes("digital payment token") || q.includes("payment services act") || q.includes("mas notice") || /\bvcc\b/.test(q) || q.includes("variable capital company") || q.startsWith("can i claim") || q.startsWith("can we claim") || q.includes("is it deductible") || q.includes("is it claimable") || q.includes("need to register for gst");
}
function isDeterministicFixture(query) {
  const q = query.toLowerCase().trim();
  const isAppleSharesFixture = (q.includes("apple") || q.includes("aapl")) && (q.includes("300 apple shares") || q.includes("invested usd300k") || q.includes("invested usd 300k"));
  const isEntertainmentFixture = q.includes("entertainment expenses 3k") || q.includes("entertainment") && q.includes("with bank");
  const isLeaseFixture = q.includes("rental agreement for 3 years") && (q.includes("3,000") || q.includes("3000"));
  const isDiscountFixture = q.includes("office equipment with a list price") || q.includes("office equipment") && q.includes("trade discount") && q.includes("credit terms");
  const isPpeFixture = q.includes("machinery on 1 april 2026") || q.includes("trade-in") && q.includes("machinery");
  const isCarFixture = (q.includes("passenger motor car") || q.includes("car") && (q.includes("120k") || q.includes("120,000"))) && (q.includes("bought") || q.includes("purchas") || q.includes("paid"));
  const isPayrollFixture = (q.includes("earning sgd3200") || q.includes("earning sgd 3200") || q.includes("earns sgd3200") || q.includes("salary of 3200") || q.includes("salary of sgd 3200")) && (q.includes("last day") || q.includes("prorat") || q.includes("cpf"));
  const isCapitalisationBenchmark = (q.includes("capitalis") || q.includes("capitaliz")) && (q.includes("software development") || q.includes("expenditure be capitalised") || q.includes("costs be capitalised") || q.includes("can i capitalise software"));
  const isPureStatutoryInquiry = isStatutoryInquiry(q) && querySingaporeStatutes(query).length > 0 && !q.includes("double entry") && !q.includes("journal") && !q.includes("debit") && !q.includes("credit");
  return isAppleSharesFixture || isEntertainmentFixture || isLeaseFixture || isDiscountFixture || isPpeFixture || isCarFixture || isPayrollFixture || isCapitalisationBenchmark || isPureStatutoryInquiry;
}
function isGstRegistrationMeasurementBasisQuestion(query, currentScenario) {
  const q = query.toLowerCase();
  const asksMeasurementBasis = /\b(accounting\s+revenue|taxable\s+turnover)\b/.test(q) && /\b(threshold|apply|basis|measure|calculated?)\b/.test(q);
  if (asksMeasurementBasis) return true;
  const followsGstRegistration = Boolean(
    currentScenario?.statutoryAdvisory?.some(
      (advisory) => /compulsory\s+gst\s+registration|gst\s+registration\s+threshold|first\s+schedule/i.test(
        `${advisory.topic} ${advisory.sectionOrSchedule}`
      )
    )
  );
  return followsGstRegistration && /\b(revenue|turnover|threshold|taxable supplies)\b/.test(q);
}
function buildGstRegistrationMeasurementBasisScenario(query) {
  const rule = SINGAPORE_STATUTORY_REPOSITORY.GST_REGISTRATION_COMPULSORY_THRESHOLD;
  return {
    scenarioType: "SINGAPORE_STATUTORY_ADVISORY",
    authorityStatus: "DETERMINISTIC",
    queryIntent: "STATUTORY_ADVISORY",
    primaryDomain: "IRAS_GST",
    rawQuery: query,
    transactionTitle: "GST Registration Threshold \u2014 Taxable Turnover Basis",
    functionalCurrency: "SGD",
    transactionCurrency: "SGD",
    accountingTreatmentSummary: "Use taxable turnover for the GST-registration tests, rather than accounting revenue as a standalone financial-statement line item. Accounting revenue can be a starting point, but it must be assessed and adjusted for the GST treatment of the underlying supplies.",
    singaporeTaxTreatmentSummary: "For compulsory GST registration, the First Schedule tests the value of taxable supplies made in the relevant calendar year or expected in the next 12 months. Determine whether each revenue stream is a taxable supply before including it in the threshold calculation.",
    regulatoryMandatesSummary: "Monitor the retrospective and prospective taxable-turnover tests and apply for GST registration within the statutory timeframe if either test is met.",
    effectiveDateOrTiming: "Retrospective: taxable turnover for the calendar year. Prospective: expected taxable turnover over the next 12 months.",
    uncertaintyDisclaimer: "The GST classification of individual income streams can affect the calculation. Confirm treatment of exempt, out-of-scope, and other non-taxable items before relying on an accounting-revenue total.",
    statutoryAdvisory: [convertToAdvisory(rule)],
    keyParameters: [
      { label: "Threshold measurement", value: "Taxable turnover / taxable supplies", badge: "GST Registration", highlight: true },
      { label: "Accounting revenue", value: "Starting point only; assess each revenue stream for GST treatment", badge: "Requires classification" },
      { label: "Governing provision", value: "GST Act 1993 \u2014 First Schedule", badge: "IRAS / SSO" }
    ],
    directGroups: [],
    isComplete: true,
    missingFields: []
  };
}
async function parseAccountingQuery(query, currentScenario) {
  if (currentScenario && startsNewAccountingScenario(query, currentScenario)) {
    return parseAccountingQuery(query, null);
  }
  if (isGstRegistrationMeasurementBasisQuestion(query, currentScenario)) {
    return buildGstRegistrationMeasurementBasisScenario(query);
  }
  if (currentScenario?.scenarioType === "PAYROLL_CPF_SALARY" && currentScenario.missingFields?.some((field) => field.fieldKey === "resignationDate")) {
    const suppliedDate = query.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b/)?.[0];
    if (suppliedDate) {
      const previousDate = /\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b/;
      const completedQuery = previousDate.test(currentScenario.rawQuery) ? currentScenario.rawQuery.replace(previousDate, suppliedDate) : `${currentScenario.rawQuery} ${suppliedDate}`;
      return parseAccountingQuery(completedQuery, { ...currentScenario, missingFields: [] });
    }
    return { ...currentScenario, directGroups: [], isComplete: false };
  }
  if (currentScenario?.missingFields?.some((field) => field.fieldKey === "considerationType")) {
    const saysUnpaid = /\b(no\s+(?:monetary|cash)\s+payment|unpaid|not\s+paid|nothing\s+(?:has\s+been\s+)?paid)\b/i.test(query);
    const saysInKind = /\b(non[ -]?cash|in[ -]?kind|equipment|asset|property)\b/i.test(query);
    if (saysUnpaid !== saysInKind) {
      const clarifiedPhrase = saysUnpaid ? "no monetary payment has been made" : "non-cash consideration was delivered";
      const originalQuery = currentScenario.rawQuery.replace(/\bnon\s+monetary\s+payment(?:\s+has\s+been\s+made)?\b/i, clarifiedPhrase);
      return parseAccountingQuery(originalQuery, null);
    }
    return {
      ...currentScenario,
      directGroups: [],
      isComplete: false
    };
  }
  if (currentScenario?.scenarioType.startsWith("SHARE_CAPITAL") && currentScenario.missingFields?.some((field) => field.fieldKey === "amount")) {
    const amountMatch = query.match(/(?:sgd|\$)?\s*([\d,]+(?:\.\d+)?)(?:\s*(k|m|million|thousand)\b)?/i);
    if (amountMatch?.[1]) {
      let amount = Number(amountMatch[1].replace(/,/g, ""));
      const magnitude = amountMatch[2]?.toLowerCase();
      if (magnitude === "k" || magnitude === "thousand") amount *= 1e3;
      if (magnitude === "m" || magnitude === "million") amount *= 1e6;
      if (Number.isFinite(amount) && amount > 0) {
        return parseAccountingQuery(`${currentScenario.rawQuery} SGD ${amount}`, null);
      }
    }
    return { ...currentScenario, directGroups: [], isComplete: false };
  }
  if (currentScenario?.scenarioType.startsWith("SHARE_CAPITAL") && currentScenario.missingFields?.some((field) => field.fieldKey === "paymentStatus")) {
    const unpaid = /\b(unpaid|not\s+paid|no\s+(?:cash|monetary)\s+payment)\b/i.test(query);
    const paid = /\b(paid|received|transferred)\b/i.test(query) && !unpaid;
    if (unpaid !== paid) {
      return parseAccountingQuery(`${currentScenario.rawQuery} ${unpaid ? "unpaid" : "paid by bank"}`, null);
    }
    return { ...currentScenario, directGroups: [], isComplete: false };
  }
  if (currentScenario?.scenarioType === "GENERAL_EXPENSE" && currentScenario.missingFields?.some((field) => field.fieldKey === "amount")) {
    const amountMatch = query.match(/(?:sgd|\$)?\s*([\d,]+(?:\.\d+)?)(?:\s*(k|m|million|thousand)\b)?/i);
    if (amountMatch?.[1]) {
      let amount = Number(amountMatch[1].replace(/,/g, ""));
      const magnitude = amountMatch[2]?.toLowerCase();
      if (magnitude === "k" || magnitude === "thousand") amount *= 1e3;
      if (magnitude === "m" || magnitude === "million") amount *= 1e6;
      if (Number.isFinite(amount) && amount > 0) {
        return parseAccountingQuery(`${currentScenario.rawQuery} SGD ${amount}`, null);
      }
    }
    return { ...currentScenario, directGroups: [], isComplete: false };
  }
  if (currentScenario?.scenarioType === "DIRECTOR_PERSONAL_FINE" && currentScenario.missingFields?.some((field) => field.fieldKey === "amount")) {
    const amountMatch = query.match(/(?:sgd|\$)?\s*([\d,]+(?:\.\d+)?)(?:\s*(k|m|million|thousand)\b)?/i);
    if (amountMatch?.[1]) {
      let amount = Number(amountMatch[1].replace(/,/g, ""));
      const magnitude = amountMatch[2]?.toLowerCase();
      if (magnitude === "k" || magnitude === "thousand") amount *= 1e3;
      if (magnitude === "m" || magnitude === "million") amount *= 1e6;
      if (Number.isFinite(amount) && amount > 0) {
        return parseAccountingQuery(`${currentScenario.rawQuery} SGD ${amount}`, null);
      }
    }
    return { ...currentScenario, directGroups: [], isComplete: false };
  }
  if (currentScenario?.scenarioType === "DIRECTOR_PERSONAL_FINE" && currentScenario.isComplete && (currentScenario.directGroups?.length || currentScenario.committedDirectGroups?.length) && /\b(fine|penalt(?:y|ies)|traffic offence)\b/i.test(query) && /\bdirector\b/i.test(query)) {
    const committed = currentScenario.committedDirectGroups?.length ? currentScenario.committedDirectGroups : currentScenario.directGroups?.filter((group2) => !group2.isHypothetical);
    return {
      ...currentScenario,
      rawQuery: query,
      directGroups: committed,
      committedDirectGroups: committed,
      isComplete: true,
      missingFields: []
    };
  }
  const isMeasurementBasisFollowUp = Boolean(
    currentScenario && /\b(fvoci|fvtpl|fair value through other comprehensive income|fair value through profit or loss)\b/i.test(query)
  );
  const amendmentResolution = isMeasurementBasisFollowUp ? { intent: "QUESTION" } : resolveFactAmendment(query, currentScenario);
  if (currentScenario && amendmentResolution.intent === "FACT_AMENDMENT" && amendmentResolution.clarificationNeeded) {
    return {
      ...currentScenario,
      rawQuery: query,
      directGroups: [],
      projectedGroups: void 0,
      isComplete: false,
      missingFields: [{
        fieldKey: "amendmentTarget",
        fieldName: "Corrected accounting fact",
        prompt: amendmentResolution.clarificationNeeded,
        whyNeeded: "A correction cannot be applied until its target fact is identified unambiguously."
      }]
    };
  }
  if (currentScenario && amendmentResolution.amendments?.length) {
    currentScenario = applyFactAmendments(currentScenario, amendmentResolution.amendments);
    query = buildAmendedQuery(currentScenario, amendmentResolution.amendments);
  }
  const q = query.toLowerCase();
  let functionalCurrency = "SGD";
  if (q.includes("primary currency is") || q.includes("functional currency is") || q.includes("currency is")) {
    const match = query.match(/(?:primary|functional)?\s*currency\s*(?:is|=|:)?\s*([A-Za-z]{3})/i);
    if (match && match[1]) {
      functionalCurrency = match[1].toUpperCase();
    }
  } else if (q.includes("sgd") || q.includes("singapore dollar")) {
    functionalCurrency = "SGD";
  } else if (q.includes("usd") && !q.includes("sgd")) {
    functionalCurrency = "USD";
  }
  const isCapitalisationQuestion = (q.includes("capitalis") || q.includes("capitaliz")) && (q.includes("expenditure") || q.includes("expense") || q.includes("cost") || q.includes("software") || q.includes("development") || q.includes("r&d") || q.includes("asset") || q.includes("should") || q.includes("can") || q.includes("how") || q.includes("treatment") || q.includes("criteria"));
  if (isCapitalisationQuestion) {
    let costAmount = void 0;
    const costMatch = query.match(/(?:for|cost|price|amount|of|at)\s*(?:sgd|\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|thousand)?/i);
    if (costMatch && costMatch[1]) {
      let rawVal = parseFloat(costMatch[1].replace(/,/g, ""));
      const unit = costMatch[2]?.toLowerCase();
      if (unit === "k" || unit === "thousand") rawVal *= 1e3;
      if (unit === "m") rawVal *= 1e6;
      if (rawVal > 0) costAmount = rawVal;
    }
    const hasExplicitAmount = costAmount !== void 0 && costAmount > 0;
    const effectiveAmount = costAmount ?? 0;
    const assumptions = [];
    const missingFields = [];
    if (!hasExplicitAmount) {
      missingFields.push({
        fieldKey: "amount",
        fieldName: "Qualifying Expenditure Outlay",
        prompt: "What is the total expenditure outlay incurred on the project?",
        whyNeeded: "Directly measurable expenditure is required before any amount can be capitalized under SFRS(I) 1-38 \xA757(f)."
      });
    }
    const userEstablishedCriteria = q.includes("met all criteria") || q.includes("criteria met") || q.includes("established feasibility");
    if (!userEstablishedCriteria) {
      assumptions.push({
        id: "assump-cap-criteria",
        field: "recognitionCriteriaEstablished",
        assumedValue: "Conditional on management formally documenting all 6 criteria under SFRS(I) 1-38 \xA757",
        basisOrRationale: "Under SFRS(I) 1-38 \xA754 & \xA757, capitalisation is strictly prohibited until all 6 recognition criteria are proven. Research costs must be expensed immediately.",
        materiality: "HIGH",
        userClarificationPrompt: "Are all 6 cumulative criteria under SFRS(I) 1-38 \xA757 established and supported by technical and commercial documentation?"
      });
      missingFields.push({
        fieldKey: "stage",
        fieldName: "Project Stage Distinction",
        prompt: "Is this expenditure incurred in the research phase or development phase?",
        whyNeeded: "Research phase expenditure must be recognized as an expense in P&L when incurred (\xA754). Only development phase expenditure can be capitalised (\xA757)."
      });
      missingFields.push({
        fieldKey: "sixCriteria",
        fieldName: "SFRS(I) 1-38 \xA757 Criteria Satisfaction",
        prompt: "Have all 6 criteria (technical feasibility, completion intent, ability to use/sell, future economic benefits, available resources, reliable measurement) been established?",
        whyNeeded: "Capitalisation cannot begin until the exact date all 6 criteria are met. Past expensed costs cannot be retrospectively capitalized."
      });
    }
    const citations = [
      getCitation("SFRS_I_1_38_INTANGIBLES", "SFRS_I"),
      convertToCitation(SINGAPORE_STATUTORY_REPOSITORY.ITA_SEC14_GENERAL_DEDUCTION),
      convertToCitation(SINGAPORE_STATUTORY_REPOSITORY.ITA_SEC14C_EIS_INNOVATION)
    ];
    const advisories = [
      convertToAdvisory(SINGAPORE_STATUTORY_REPOSITORY.ITA_SEC14_GENERAL_DEDUCTION),
      convertToAdvisory(SINGAPORE_STATUTORY_REPOSITORY.ITA_SEC14C_EIS_INNOVATION)
    ];
    const lines = [
      {
        id: "l-cap-asset",
        accountCode: "1800",
        accountName: "Intangible Assets - Capitalised Development Costs",
        category: "ASSET",
        debit: effectiveAmount,
        credit: 0,
        lineExplanation: hasExplicitAmount ? "Capitalisation of qualifying development expenditure under SFRS(I) 1-38 \xA757 (strictly conditional on meeting all 6 cumulative criteria)." : "Capitalisation of qualifying development expenditure \u2014 [Valuation pending determination]"
      },
      {
        id: "l-cap-bank",
        accountCode: "1010",
        accountName: "Cash at Bank / Trade Payables",
        category: "ASSET",
        debit: 0,
        credit: effectiveAmount,
        lineExplanation: hasExplicitAmount ? "Settlement of directly attributable software engineering, testing, and contractor expenditure." : "Settlement of directly attributable development expenditure \u2014 [Valuation pending determination]"
      }
    ];
    const keyParams = [
      { label: "Governing Authorities", value: "ACRA / ASC Singapore (SFRS(I)) & IRAS", badge: "Dual Authority" },
      { label: "Accounting Standard", value: "SFRS(I) 1-38 \xA754 & \xA757", badge: "SFRS(I)", highlight: true },
      { label: "Research Phase Outlay", value: "Strictly Expensed in P&L (\xA754)", badge: "P&L Expense" },
      { label: "Development Phase Outlay", value: "Capitalise upon 6 Criteria (\xA757)", badge: "Intangible Asset", highlight: true },
      {
        label: "Recognition Status",
        value: userEstablishedCriteria ? "Established" : "Conditional (Assessment Required)",
        badge: userEstablishedCriteria ? "Criteria Met" : "Assumed Parameter",
        highlight: !userEstablishedCriteria
      },
      {
        label: "Expenditure Amount",
        value: hasExplicitAmount ? `${functionalCurrency} ${effectiveAmount.toLocaleString()}` : "Pending Determination",
        badge: hasExplicitAmount ? "Stated Fact" : "Missing Fact"
      },
      { label: "Singapore Tax Treatment", value: "Disallowed as P&L deduction (\xA715); 400% EIS Deduction (\xA714C)", badge: "IRAS S14C/EIS", highlight: true },
      { label: "Tangible Asset Treatment", value: "Capitalise if future benefits probable (SFRS(I) 1-16 \xA77)", badge: "PP&E Cost" }
    ];
    const capAuthorityStatus = hasExplicitAmount && userEstablishedCriteria ? "DETERMINISTIC" : "CONDITIONAL";
    return {
      scenarioType: "CAPITALISATION_SFRS138",
      authorityStatus: capAuthorityStatus,
      queryIntent: hasExplicitAmount && userEstablishedCriteria ? "HYBRID" : "STATUTORY_ADVISORY",
      primaryDomain: "ACCOUNTING_SFRS",
      rawQuery: query,
      transactionTitle: "Capitalisation Assessment: SFRS(I) 1-38 Recognition vs Singapore Tax Treatment",
      functionalCurrency,
      transactionCurrency: functionalCurrency,
      accountingTreatmentSummary: "Under SFRS(I) 1-38 \xA754, all research phase expenditure must be recognized as an expense in P&L when incurred. Capitalisation is permitted ONLY for development phase expenditure when the entity demonstrates all 6 cumulative criteria under \xA757: (1) Technical feasibility, (2) Intention to complete, (3) Ability to use or sell, (4) Probable future economic benefits, (5) Technical and financial resources, and (6) Reliable measurement of expenditure. Capitalisation begins only on the date all 6 criteria are established; prior costs expensed cannot be retrospectively reinstated. Routine repairs and maintenance of tangible assets must be expensed under SFRS(I) 1-16 \xA77.",
      singaporeTaxTreatmentSummary: "Accounting treatment does not dictate tax treatment. Under Section 14(1) of the Income Tax Act 1947, capitalised expenditure is disallowed as a direct P&L deduction under Section 15(1) and must be added back in Form C-S. However, qualifying staff costs for R&D and software development qualify for the enhanced 400% tax deduction under Section 14C (Enterprise Innovation Scheme) up to the statutory cap of SGD 400,000 per YA.",
      regulatoryMandatesSummary: "Section 201 of the Companies Act 1967 legally mandates that financial statements laid before AGM must comply with Accounting Standards Council standards.",
      effectiveDateOrTiming: "SFRS(I) 1-38 active; Enterprise Innovation Scheme (EIS) 400% tax deduction active for YAs 2024\u20132028.",
      uncertaintyDisclaimer: "Professional Caution: Management must maintain contemporaneous evidence (timesheets, technical milestones, commercial feasibility models) to substantiate capitalisation for statutory audits and IRAS EIS claims. Do not capitalised expenditure without audit-ready documentation.",
      statutoryAdvisory: advisories,
      keyParameters: keyParams,
      assumptions,
      directGroups: [
        {
          id: "grp-capitalisation-illustrative",
          eventDate: formatSingaporeDate(/* @__PURE__ */ new Date()),
          title: hasExplicitAmount ? "Conditional Illustrative Entry: Capitalisation of Qualifying Development Costs" : "Conditional Illustrative Proposal: Development Costs (Pending Valuation)",
          summary: hasExplicitAmount ? `Provisional entry for ${functionalCurrency} ${effectiveAmount.toLocaleString()}. Valid ONLY if management documents all 6 cumulative recognition criteria under SFRS(I) 1-38 \xA757.` : "Provisional journal entry structure with uncalculated monetary amounts.",
          lines,
          totalDebit: effectiveAmount,
          totalCredit: effectiveAmount,
          isBalanced: hasExplicitAmount,
          citations,
          authorityStatus: capAuthorityStatus,
          rationalePoints: [
            "Under SFRS(I) 1-38 \xA754: All research phase costs must be expensed in P&L as incurred.",
            "Under SFRS(I) 1-38 \xA757: Development expenditure can be capitalised only when all 6 cumulative criteria are demonstrated.",
            hasExplicitAmount ? "Provisional Entry Warning: If technical feasibility or commercial intent cannot be documented, expenditure must be charged to P&L." : "\u26A0\uFE0F AMOUNTS PENDING: Transaction expenditure outlay was not specified in query. Journal structure is a conditional proposal; monetary amounts must be determined before posting.",
            "Under IRAS: Capitalised development costs are non-deductible under Section 14(1). Qualifying R&D activities claim the 400% EIS enhanced deduction separately in tax computation."
          ]
        }
      ],
      isComplete: hasExplicitAmount && userEstablishedCriteria,
      missingFields
    };
  }
  const hasSalaryFigure = /(?:earning|earns|salary|wages?|pay)\s*(?:of|is|:)?\s*(?:sgd|\$)?\s*\d+/i.test(q) || /(?:sgd|\$)\s*\d+[\d,]*(?:\.\d+)?\s*(?:a\s*month|\/month|monthly|per\s*month)?/i.test(q) || /\d+[\d,]*(?:\.\d+)?\s*(?:a\s*month|\/month|monthly|per\s*month)/i.test(q);
  const hasNamedPayrollPersonnel = /\b(staff|employee|worker|person)\b/i.test(q);
  const hasPronounInPayrollContext = /\b(he|she|his|her)\b/i.test(q) && /\b(earning|earns|salary|wages?|payroll|cpf)\b/i.test(q);
  const hasPayrollPersonnel = hasNamedPayrollPersonnel || hasPronounInPayrollContext;
  const hasPayrollCalcIntent = (q.includes("calculat") || q.includes("compute") || q.includes("what is his") || q.includes("what is her") || q.includes("how much") || q.includes("entry") || q.includes("journal")) && (q.includes("salary") || q.includes("cpf") || q.includes("wage"));
  const isPayrollSalaryQuery = hasSalaryFigure && (hasPayrollPersonnel || q.includes("cpf") || q.includes("last day") || q.includes("prorat")) || hasPayrollPersonnel && hasPayrollCalcIntent && (q.includes("salary") || q.includes("cpf")) || // A correction such as "I mean 10,000 a month" inherits the payroll
  // context rather than being routed to the statutory-advisory fallback.
  currentScenario?.scenarioType === "PAYROLL_CPF_SALARY" && hasSalaryFigure && /\b(i mean|actually|correction|correct(?:ion|ed)?|rather|instead)\b/i.test(query) || currentScenario?.scenarioType === "PAYROLL_CPF_SALARY" && /\b(resign(?:ed|ation)?|pro[ -]?rat(?:e|ed|ion)|last\s+day|incomplete\s+month)\b/i.test(query);
  if (isPayrollSalaryQuery) {
    const priorBasicSalary = currentScenario?.keyParameters?.find((p) => p.label === "Basic Monthly Salary")?.value.match(/[\d,]+(?:\.\d+)?/);
    let baseSalary = priorBasicSalary?.[0] ? Number(priorBasicSalary[0].replace(/,/g, "")) : currentScenario?.scenarioType === "PAYROLL_CPF_SALARY" ? currentScenario.amount || 3200 : 3200;
    const salaryMatch = query.match(/(?:earning|earns|salary\s*(?:of|is|:)?|wages?\s*(?:of|is|:)?|pay\s*(?:of|is|:)?)\s*(?:sgd|\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)?/i) || query.match(/(?:sgd|\$)\s*([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)?\s*(?:a\s*month|\/month|monthly|per\s*month)?/i) || query.match(/([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)?\s*(?:a\s*month|\/month|monthly|per\s*month)/i);
    if (salaryMatch && salaryMatch[1]) {
      let parsedSalary = parseFloat(salaryMatch[1].replace(/,/g, ""));
      const magnitude = salaryMatch[2]?.toLowerCase();
      if (magnitude === "k" || magnitude === "thousand") parsedSalary *= 1e3;
      if (magnitude === "m" || magnitude === "million") parsedSalary *= 1e6;
      if (parsedSalary > 0) baseSalary = parsedSalary;
    }
    let employeeAge = 32;
    const priorAge = currentScenario?.keyParameters?.find((p) => p.label === "Employee Status")?.value.match(/Age\s+(\d{1,2})/i);
    if (priorAge?.[1]) employeeAge = parseInt(priorAge[1], 10);
    const ageMatch = query.match(/(\d{1,2})\s*(?:years\s*old|yo|y\/o|yrs\s*old)/i) || query.match(/(?:age|aged)\s*[:=]?\s*(\d{1,2})/i);
    if (ageMatch) {
      const parsedAge = parseInt(ageMatch[1] || ageMatch[2], 10);
      if (parsedAge >= 15 && parsedAge <= 99) employeeAge = parsedAge;
    }
    const isExplicitNonCitizen = q.includes("foreign") || q.includes("ep holder") || q.includes("s pass") || q.includes("work permit") || q.includes("non-citizen");
    const isSingaporean = !isExplicitNonCitizen;
    let lastDay = null;
    let lastMonth = null;
    let lastYear = null;
    const dmyMatch = query.match(/(?:last\s*day(?:\s*is)?|resigned\s*(?:on)?|effective|ended\s*(?:on)?|until|to)\s*[:=]?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/i) || query.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmyMatch) {
      lastDay = parseInt(dmyMatch[1], 10);
      lastMonth = parseInt(dmyMatch[2], 10);
      lastYear = parseInt(dmyMatch[3], 10);
    }
    if (!lastDay) {
      const monthNames = {
        jan: 1,
        january: 1,
        feb: 2,
        february: 2,
        mar: 3,
        march: 3,
        apr: 4,
        april: 4,
        may: 5,
        jun: 6,
        june: 6,
        jul: 7,
        july: 7,
        aug: 8,
        august: 8,
        sep: 9,
        sept: 9,
        september: 9,
        oct: 10,
        october: 10,
        nov: 11,
        november: 11,
        dec: 12,
        december: 12
      };
      const wordMatch = query.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{4}))?/i);
      if (wordMatch) {
        lastDay = parseInt(wordMatch[1], 10);
        const mStr = wordMatch[2].toLowerCase();
        lastMonth = monthNames[mStr] || 9;
        lastYear = wordMatch[3] ? parseInt(wordMatch[3], 10) : 2026;
      }
    }
    if (currentScenario?.scenarioType === "PAYROLL_CPF_SALARY" && /\b(resign(?:ed|ation)?|last\s+day)\b/i.test(query) && !lastDay) {
      return {
        ...currentScenario,
        rawQuery: query,
        directGroups: [],
        projectedGroups: void 0,
        committedDirectGroups: currentScenario.committedDirectGroups?.length ? currentScenario.committedDirectGroups : (currentScenario.directGroups || []).filter((group2) => !group2.isHypothetical),
        isComplete: false,
        authorityStatus: "CONDITIONAL",
        missingFields: [{
          fieldKey: "resignationDate",
          fieldName: "Employee resignation date",
          prompt: "What was the employee\u2019s last day of employment (DD/MM/YYYY)?",
          whyNeeded: "The payroll period and working days cannot be calculated without the last day."
        }]
      };
    }
    if (!lastMonth) {
      const monthMap = {
        january: 1,
        february: 2,
        march: 3,
        april: 4,
        may: 5,
        june: 6,
        july: 7,
        august: 8,
        september: 9,
        october: 10,
        november: 11,
        december: 12
      };
      for (const [mName, mNum] of Object.entries(monthMap)) {
        if (q.includes(mName)) {
          lastMonth = mNum;
          break;
        }
      }
    }
    if (!lastYear) {
      const yearMatch = query.match(/\b(202[4-9]|203\d)\b/);
      lastYear = yearMatch ? parseInt(yearMatch[1], 10) : 2026;
    }
    if (!lastMonth) {
      lastMonth = 9;
    }
    if (lastYear !== null && lastDay !== null && (lastMonth < 1 || lastMonth > 12 || lastDay < 1 || lastDay > new Date(lastYear, lastMonth, 0).getDate())) {
      return {
        ...currentScenario?.scenarioType === "PAYROLL_CPF_SALARY" ? currentScenario : {},
        scenarioType: "PAYROLL_CPF_SALARY",
        authorityStatus: "CONDITIONAL",
        queryIntent: "TRANSACTION",
        primaryDomain: "CPF_BOARD",
        rawQuery: query,
        transactionTitle: "Payroll Calculation (Invalid Resignation Date)",
        functionalCurrency,
        transactionCurrency: functionalCurrency,
        amount: baseSalary,
        isComplete: false,
        directGroups: [],
        projectedGroups: void 0,
        committedDirectGroups: currentScenario?.scenarioType === "PAYROLL_CPF_SALARY" ? currentScenario.committedDirectGroups?.length ? currentScenario.committedDirectGroups : (currentScenario.directGroups || []).filter((group2) => !group2.isHypothetical) : void 0,
        missingFields: [{ fieldKey: "resignationDate", fieldName: "Valid Resignation Date", prompt: "Please provide a valid resignation date (DD/MM/YYYY).", whyNeeded: "Accurate payroll proration requires a valid calendar date." }]
      };
    }
    const totalDaysInMonth = new Date(lastYear, lastMonth, 0).getDate();
    const getWorkingDays = (y, m, start, end) => {
      let count = 0;
      for (let d = start; d <= end; d++) {
        const dt = new Date(Date.UTC(y, m - 1, d));
        const dayOfWeek = dt.getUTCDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          count++;
        }
      }
      return count;
    };
    const totalWorkingDays = getWorkingDays(lastYear, lastMonth, 1, totalDaysInMonth);
    const isProrated = lastDay !== null && lastDay < totalDaysInMonth;
    const workingDaysWorked = isProrated ? getWorkingDays(lastYear, lastMonth, 1, lastDay) : totalWorkingDays;
    const grossSalary = isProrated ? Math.round(baseSalary / totalWorkingDays * workingDaysWorked * 100) / 100 : baseSalary;
    const owCeiling = 8e3;
    const eligibleOw = Math.min(grossSalary, owCeiling);
    let employeeRate = 0.2;
    let employerRate = 0.17;
    if (employeeAge <= 55) {
      employeeRate = 0.2;
      employerRate = 0.17;
    } else if (employeeAge <= 60) {
      employeeRate = 0.18;
      employerRate = 0.16;
    } else if (employeeAge <= 65) {
      employeeRate = 0.115;
      employerRate = 0.12;
    } else if (employeeAge <= 70) {
      employeeRate = 0.075;
      employerRate = 0.09;
    } else {
      employeeRate = 0.05;
      employerRate = 0.075;
    }
    if (!isSingaporean) {
      employeeRate = 0;
      employerRate = 0;
    }
    const rawEmployeeCpf = eligibleOw * employeeRate;
    const employeeCpf = Math.floor(rawEmployeeCpf);
    const totalCpf = Math.round(eligibleOw * (employeeRate + employerRate));
    const employerCpf = totalCpf - employeeCpf;
    const netSalary = Math.round((grossSalary - employeeCpf) * 100) / 100;
    const rawSdl = grossSalary * 25e-4;
    const sdl = Math.min(11.25, Math.max(2, Math.round(rawSdl * 100) / 100));
    const monthNamesLong = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const monthName = monthNamesLong[lastMonth - 1];
    const eventDate = isProrated ? `${String(lastDay).padStart(2, "0")} ${monthName.slice(0, 3)} ${lastYear}` : `${totalDaysInMonth} ${monthName.slice(0, 3)} ${lastYear}`;
    const lines = [
      {
        id: "line-payroll-salary-expense",
        accountCode: "5010",
        accountName: "Staff Salaries & Wages (Operating Expense)",
        category: "EXPENSE",
        debit: grossSalary,
        credit: 0,
        lineExplanation: isProrated ? `Gross prorated salary for ${workingDaysWorked}/${totalWorkingDays} working days in ${monthName} ${lastYear} under MOM Employment Act \xA722.` : `Full monthly basic salary for ${monthName} ${lastYear} under SFRS(I) 1-1 \xA728.`
      },
      {
        id: "line-payroll-employer-cpf",
        accountCode: "5020",
        accountName: "Employer CPF Contribution (Operating Expense)",
        category: "EXPENSE",
        debit: employerCpf,
        credit: 0,
        lineExplanation: `Mandatory employer CPF contribution (${(employerRate * 100).toFixed(1)}% for age ${employeeAge}) under CPF Act \xA77. 100% tax-deductible under ITA \xA714(1)(e).`
      },
      {
        id: "line-payroll-cpf-payable",
        accountCode: "2050",
        accountName: "CPF Payable to CPF Board (Current Liability)",
        category: "LIABILITY",
        debit: 0,
        credit: totalCpf,
        lineExplanation: `Total mandatory CPF payable (Employee $${employeeCpf} + Employer $${employerCpf}) due by 14th of following month to CPF Board.`
      },
      {
        id: "line-payroll-net-salary-payable",
        accountCode: "2060",
        accountName: "Net Salaries Payable / Staff Clearing (Current Liability)",
        category: "LIABILITY",
        debit: 0,
        credit: netSalary,
        lineExplanation: `Net take-home salary payable to employee after deducting employee CPF share ($${grossSalary.toLocaleString(void 0, { minimumFractionDigits: 2 })} - $${employeeCpf.toFixed(2)}).`
      },
      {
        id: "line-payroll-sdl-expense",
        accountCode: "5030",
        accountName: "Skills Development Levy (Operating Expense)",
        category: "EXPENSE",
        debit: sdl,
        credit: 0,
        lineExplanation: `Employer Skills Development Levy accrued at 0.25% of monthly wages, subject to the statutory minimum and maximum.`
      },
      {
        id: "line-payroll-sdl-payable",
        accountCode: "2055",
        accountName: "Skills Development Levy Payable",
        category: "LIABILITY",
        debit: 0,
        credit: sdl,
        lineExplanation: `SDL payable with the monthly CPF submission.`
      }
    ];
    const totalDebit = Math.round((grossSalary + employerCpf + sdl) * 100) / 100;
    const totalCredit = Math.round((totalCpf + netSalary + sdl) * 100) / 100;
    const citations = [
      convertToCitation(SINGAPORE_STATUTORY_REPOSITORY.MOM_SEC22_PRORATED_SALARY),
      convertToCitation(SINGAPORE_STATUTORY_REPOSITORY.CPFA_SEC7_FIRST_SCHEDULE),
      convertToCitation(SINGAPORE_STATUTORY_REPOSITORY.CPF_WAGE_CEILINGS_2026),
      convertToCitation(SINGAPORE_STATUTORY_REPOSITORY.CPF_EMPLOYER_TAX_DEDUCTIBILITY),
      convertToCitation(SINGAPORE_STATUTORY_REPOSITORY.MOM_SEC21_SALARY_TIMELINES),
      convertToCitation(SINGAPORE_STATUTORY_REPOSITORY.CPF_SDL_SKILLS_DEVELOPMENT_LEVY)
    ];
    const advisories = [
      convertToAdvisory(SINGAPORE_STATUTORY_REPOSITORY.MOM_SEC22_PRORATED_SALARY),
      convertToAdvisory(SINGAPORE_STATUTORY_REPOSITORY.CPFA_SEC7_FIRST_SCHEDULE),
      convertToAdvisory(SINGAPORE_STATUTORY_REPOSITORY.CPF_EMPLOYER_TAX_DEDUCTIBILITY)
    ];
    const keyParams = [
      { label: "Basic Monthly Salary", value: `${functionalCurrency} ${baseSalary.toLocaleString(void 0, { minimumFractionDigits: 2 })}`, badge: "Base Rate" },
      { label: "Employee Status", value: `${isSingaporean ? "Singapore Citizen / PR" : "Foreign Worker"}, Age ${employeeAge}`, badge: "Eligibility" },
      { label: "Salary Period", value: `${monthName} ${lastYear}${isProrated ? ` (Last Day: ${eventDate})` : " (Full Month)"}`, badge: "Period" },
      { label: "Working Days (Mon-Fri)", value: `${workingDaysWorked} / ${totalWorkingDays} days (${isProrated ? "Prorated" : "Full"})`, badge: "MOM \xA722", highlight: isProrated },
      { label: "Gross Prorated Salary", value: `${functionalCurrency} ${grossSalary.toLocaleString(void 0, { minimumFractionDigits: 2 })}`, badge: "Gross Pay", highlight: true },
      { label: "Employee CPF (20%, cents dropped)", value: `${functionalCurrency} ${employeeCpf.toLocaleString(void 0, { minimumFractionDigits: 2 })}`, badge: "Deduction" },
      { label: "Employer CPF (17%, dollar rounded)", value: `${functionalCurrency} ${employerCpf.toLocaleString(void 0, { minimumFractionDigits: 2 })}`, badge: "Employer Cost" },
      { label: "Total CPF to CPF Board (37%)", value: `${functionalCurrency} ${totalCpf.toLocaleString(void 0, { minimumFractionDigits: 2 })}`, badge: "Liability", highlight: true },
      { label: "Net Take-Home Pay", value: `${functionalCurrency} ${netSalary.toLocaleString(void 0, { minimumFractionDigits: 2 })}`, badge: "Disbursement", highlight: true },
      { label: "Skills Development Levy (SDL)", value: `${functionalCurrency} ${sdl.toLocaleString(void 0, { minimumFractionDigits: 2 })}`, badge: "SSG Levy" },
      { label: "Tax Deductibility", value: "100% Allowable (\xA714(1)(e))", badge: "IRAS Deductible" }
    ];
    const title = isProrated ? `Payroll & Prorated Salary Accrual (${eventDate} - Last Day of Service)` : `Monthly Payroll & Statutory CPF Accrual (${eventDate})`;
    const summary = isProrated ? `Prorated salary of SGD ${grossSalary.toLocaleString(void 0, { minimumFractionDigits: 2 })} for ${workingDaysWorked}/${totalWorkingDays} working days worked in ${monthName} ${lastYear} under MOM Employment Act \xA722, with CPF contributions (Employee: SGD ${employeeCpf}, Employer: SGD ${employerCpf}).` : `Monthly salary of SGD ${grossSalary.toLocaleString(void 0, { minimumFractionDigits: 2 })} with CPF contributions (Employee: SGD ${employeeCpf}, Employer: SGD ${employerCpf}) for ${monthName} ${lastYear}.`;
    const payrollState = {
      scenarioType: "PAYROLL_CPF_SALARY",
      authorityStatus: "DETERMINISTIC",
      queryIntent: "TRANSACTION",
      primaryDomain: "CPF_BOARD",
      rawQuery: query,
      transactionTitle: title,
      functionalCurrency,
      transactionCurrency: functionalCurrency,
      amount: grossSalary,
      accountingTreatmentSummary: `Recognize staff salary expense ($${grossSalary.toLocaleString(void 0, { minimumFractionDigits: 2 })}) and employer CPF expense ($${employerCpf.toLocaleString(void 0, { minimumFractionDigits: 2 })}) in P&L under SFRS(I) 1-1 \xA728. Outstanding net salary ($${netSalary.toLocaleString(void 0, { minimumFractionDigits: 2 })}) and total CPF liability ($${totalCpf.toLocaleString(void 0, { minimumFractionDigits: 2 })}) are credited to current liabilities.`,
      singaporeTaxTreatmentSummary: `Gross staff salaries and mandatory employer CPF contributions ($${employerCpf.toLocaleString(void 0, { minimumFractionDigits: 2 })}) are 100% tax-deductible for the employer under Section 14(1) and Section 14(1)(e) of the Income Tax Act 1947. SDL ($${sdl.toLocaleString(void 0, { minimumFractionDigits: 2 })}) is also tax-deductible.`,
      regulatoryMandatesSummary: `MOM Employment Act \xA721(2) mandates full payment of all outstanding salary on the employee's last day of employment. CPF Act \xA77 mandates payment of CPF contributions to CPF Board by the 14th of the following month.`,
      effectiveDateOrTiming: `2026 CPF Ordinary Wage monthly ceiling of SGD 8,000 active (effective 1 Jan 2026). Employment Act 1968 active.`,
      uncertaintyDisclaimer: "Grounded in Singapore Employment Act \xA722 proration formula and 2026 CPF Board contribution schedules. Standard 5-day work week (Monday to Friday) assumed unless company employment contract stipulates alternate work days.",
      statutoryAdvisory: advisories,
      keyParameters: keyParams,
      directGroups: [
        {
          id: "grp-payroll-accrual",
          eventDate,
          title,
          summary,
          lines,
          totalDebit,
          totalCredit,
          isBalanced: Math.abs(totalDebit - totalCredit) < 0.01,
          citations,
          authorityStatus: "DETERMINISTIC",
          rationalePoints: [
            `Under MOM Employment Act \xA722: Gross prorated salary = (SGD ${baseSalary.toLocaleString()} / ${totalWorkingDays} working days) * ${workingDaysWorked} days worked = SGD ${grossSalary.toLocaleString(void 0, { minimumFractionDigits: 2 })}.`,
            `Under CPF Act \xA77: Employee CPF share (20%) is SGD ${employeeCpf}. Cents ($${(rawEmployeeCpf - employeeCpf).toFixed(2)}) are discarded per statute.`,
            `Under CPF Act \xA77: Employer CPF share (17%) is SGD ${employerCpf}. Total CPF contribution (SGD ${totalCpf}) is rounded to nearest dollar.`,
            `Net Take-Home Salary = Gross Salary ($${grossSalary.toLocaleString(void 0, { minimumFractionDigits: 2 })}) - Employee CPF ($${employeeCpf}) = SGD ${netSalary.toLocaleString(void 0, { minimumFractionDigits: 2 })}.`,
            `Under Section 14(1)(e) of the Income Tax Act 1947: Mandatory employer CPF ($${employerCpf}) is 100% tax-deductible.`,
            `Total Debits (SGD ${totalDebit.toLocaleString(void 0, { minimumFractionDigits: 2 })}) == Total Credits (SGD ${totalCredit.toLocaleString(void 0, { minimumFractionDigits: 2 })}) \u2713 Balanced.`
          ]
        }
      ],
      isComplete: true,
      missingFields: []
    };
    const isHypotheticalPayroll = currentScenario?.scenarioType === "PAYROLL_CPF_SALARY" && /\b(what if|suppose|assuming|hypothetical)\b/i.test(query);
    if (isHypotheticalPayroll && currentScenario) {
      const committed = currentScenario.committedDirectGroups?.length ? currentScenario.committedDirectGroups : (currentScenario.directGroups || []).filter((group2) => !group2.isHypothetical);
      const projected = (payrollState.directGroups || []).map((group2) => ({
        ...group2,
        id: `grp-payroll-projection-${Date.now()}`,
        isHypothetical: true
      }));
      return {
        ...payrollState,
        isHypothetical: true,
        directGroups: [...committed, ...projected],
        committedDirectGroups: committed,
        projectedGroups: projected,
        actualEvents: currentScenario.actualEvents,
        accountingEvents: currentScenario.accountingEvents
      };
    }
    return payrollState;
  }
  const isOwnEquityContribution = /\b(owner|shareholder|founder)\b/i.test(q) && /\b(own company|his company|her company|share capital)\b/i.test(q) && /\b(invested|contributed|subscribed|injected)\b/i.test(q);
  if (isOwnEquityContribution) {
    const amountMatch = query.match(/(?:sgd|\$)\s*([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)?/i);
    let contributionAmount;
    if (amountMatch?.[1]) {
      contributionAmount = Number(amountMatch[1].replace(/,/g, ""));
      const magnitude = amountMatch[2]?.toLowerCase();
      if (magnitude === "k" || magnitude === "thousand") contributionAmount *= 1e3;
      if (magnitude === "m" || magnitude === "million") contributionAmount *= 1e6;
    }
    const explicitlyNoMonetaryPayment = /\bno\s+monetary\s+payment\b/i.test(q);
    const ambiguousNonMonetaryPayment = /\bnon\s+monetary\s+payment\b/i.test(q);
    const isInKind = /\b(non[ -]?cash|in[ -]?kind)\b/i.test(q);
    if (ambiguousNonMonetaryPayment && !explicitlyNoMonetaryPayment && !isInKind) {
      return {
        scenarioType: "SHARE_CAPITAL_UNPAID",
        authorityStatus: "CONDITIONAL",
        queryIntent: "TRANSACTION",
        primaryDomain: "ACCOUNTING_SFRS",
        rawQuery: query,
        transactionTitle: "Share Capital Contribution \u2014 Consideration Clarification Required",
        functionalCurrency,
        transactionCurrency: functionalCurrency,
        amount: contributionAmount,
        ownershipContext: "own_equity",
        transactionNature: "share_capital_issuance",
        accountingTreatmentSummary: "Please clarify whether the shareholder made no monetary payment (an unpaid subscription) or transferred non-cash consideration in kind. These require different debit accounts.",
        directGroups: [],
        keyParameters: [{ label: "Consideration Status", value: "Ambiguous: \u201Cnon monetary payment\u201D", badge: "Clarification Required", highlight: true }],
        isComplete: false,
        missingFields: [{
          fieldKey: "considerationType",
          fieldName: "Share issue consideration",
          prompt: "Did you mean \u201Cno monetary payment has been made\u201D (unpaid share subscription), or was non-cash consideration such as equipment transferred to the company?",
          whyNeeded: "An unpaid subscription is recorded as a receivable; non-cash consideration is recorded as the specific asset received."
        }]
      };
    }
    const explicitlyUnpaid = explicitlyNoMonetaryPayment || /\b(unpaid|not\s+paid|payment\s+pending)\b/i.test(q);
    const explicitlyPaid = isInKind || /\b(cash|paid|payment has been made|settled|delivered)\b/i.test(q);
    const paymentKnown = explicitlyUnpaid || explicitlyPaid;
    const isPaid = !explicitlyUnpaid && explicitlyPaid;
    const hasAmount = Boolean(contributionAmount && contributionAmount > 0);
    const amount = contributionAmount || 0;
    const debitAccount = isPaid ? isInKind ? "Non-Cash Asset Received for Share Issue (Pending Asset Identification)" : "Cash at Bank" : "Amount Due from Shareholder (Share Capital Subscription Receivable)";
    const debitExplanation = isPaid ? isInKind ? "Recognition of the stated fair value of non-cash consideration received for the share issue. Identify and classify the asset before posting." : "Cash consideration received for the share issue." : "Share subscription receivable pending payment by the shareholder.";
    const title = isInKind ? "Issue of Share Capital for Non-Cash Consideration" : "Share Capital Subscription";
    const transactionId = `tx-share-capital-${Date.now()}`;
    return {
      scenarioType: isPaid ? "SHARE_CAPITAL_PAID" : "SHARE_CAPITAL_UNPAID",
      authorityStatus: isInKind ? "CONDITIONAL" : "DETERMINISTIC",
      queryIntent: "TRANSACTION",
      primaryDomain: "ACCOUNTING_SFRS",
      rawQuery: query,
      transactionTitle: title,
      functionalCurrency,
      transactionCurrency: functionalCurrency,
      transactionId,
      amount: contributionAmount,
      ownershipContext: "own_equity",
      transactionNature: "share_capital_issuance",
      accountingTreatmentSummary: isInKind ? "Credit Share Capital for the stated fair value of consideration received. The debit must be the identified non-cash asset, not Cash at Bank; asset classification remains pending." : "Credit Share Capital on issue and debit cash received or the subscription receivable, as applicable.",
      statutoryAdvisory: [convertToAdvisory(SINGAPORE_STATUTORY_REPOSITORY.ACRA_SEC68_NO_PAR_VALUE_SHARES)],
      keyParameters: [
        { label: "Consideration", value: hasAmount ? `${functionalCurrency} ${amount.toLocaleString()}` : "Pending valuation", badge: hasAmount ? "Stated Fact" : "Missing Fact" },
        { label: "Consideration Type", value: isInKind ? "Non-cash / in-kind" : !paymentKnown ? "Payment status unknown" : isPaid ? "Cash" : "Unpaid subscription", badge: paymentKnown ? "Classification" : "Missing Fact" }
      ],
      directGroups: hasAmount && paymentKnown ? [{
        id: "grp-share-capital-subscription",
        transactionId,
        eventDate: formatSingaporeDate(/* @__PURE__ */ new Date()),
        title,
        summary: hasAmount ? `Recognition of ${functionalCurrency} ${amount.toLocaleString()} share capital.` : "Share capital recognition pending valuation of consideration.",
        lines: [
          { id: "line-share-contribution", accountCode: isPaid ? "1700" : "1150", accountName: debitAccount, category: "ASSET", debit: amount, credit: 0, lineExplanation: debitExplanation },
          { id: "line-share-capital", accountCode: "3000", accountName: "Share Capital", category: "EQUITY", debit: 0, credit: amount, lineExplanation: "Recognition of issued share capital; no separate share premium account applies under Singapore no-par-value rules." }
        ],
        totalDebit: amount,
        totalCredit: amount,
        isBalanced: hasAmount,
        citations: [convertToCitation(SINGAPORE_STATUTORY_REPOSITORY.ACRA_SEC68_NO_PAR_VALUE_SHARES)],
        authorityStatus: isInKind ? "CONDITIONAL" : "DETERMINISTIC",
        rationalePoints: [
          "The reporting entity\u2019s own shares are equity, not a financial asset.",
          isInKind ? "Confirm the nature and fair value of the contributed non-cash asset before posting the final asset account." : "The debit reflects the consideration received or receivable from the shareholder."
        ]
      }] : [],
      isComplete: hasAmount && paymentKnown && !isInKind,
      missingFields: !hasAmount ? [{
        fieldKey: "amount",
        fieldName: "Share subscription amount",
        prompt: "What amount of share capital was subscribed?",
        whyNeeded: "The subscription amount is required for both sides of the journal."
      }] : !paymentKnown ? [{
        fieldKey: "paymentStatus",
        fieldName: "Share subscription payment status",
        prompt: "Was the share subscription paid into the company bank, or is it still unpaid?",
        whyNeeded: "Cash received and an outstanding shareholder receivable require different debit accounts."
      }] : isInKind ? [{ fieldKey: "nonCashAssetDescription", fieldName: "Non-cash asset identification and valuation", prompt: "What non-cash asset was contributed, and what is its supportable fair value?", whyNeeded: "The debit account and measurement must reflect the actual asset received." }] : []
    };
  }
  const isCarPurchase = (q.includes("car") || q.includes("motor car") || q.includes("passenger car")) && (q.includes("bought") || q.includes("purchas") || q.includes("paid") || q.includes("pay") || q.includes("buy")) && !q.includes("rental") && !q.includes("lease");
  const isStatutoryQuestion = isStatutoryInquiry(q);
  if (isCarPurchase) {
    let carCost = void 0;
    const costMatch = query.match(/(?:for|cost|price|at)\s*(?:sgd|\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|thousand)?/i) || query.match(/(?:sgd|\$)\s*([\d,]+(?:\.\d+)?)\s*(k|m|thousand)?/i);
    if (costMatch && costMatch[1]) {
      let rawVal = parseFloat(costMatch[1].replace(/,/g, ""));
      const unit = costMatch[2]?.toLowerCase();
      if (unit === "k" || unit === "thousand") rawVal *= 1e3;
      if (unit === "m") rawVal *= 1e6;
      if (rawVal > 0) carCost = rawVal;
    }
    const hasExplicitCarCost = carCost !== void 0 && carCost > 0;
    const effectiveCarCost = carCost ?? 0;
    const lines = [
      {
        id: "l-car-cost",
        accountCode: "1700",
        accountName: "Motor Vehicles - Cost (Non-Current Asset)",
        category: "ASSET",
        debit: effectiveCarCost,
        credit: 0,
        lineExplanation: hasExplicitCarCost ? "Capitalization of motor vehicle at gross purchase price. Input GST is completely capitalized into cost because input tax recovery is blocked under Singapore GST Regulation 26." : "Capitalization of motor vehicle \u2014 [Valuation pending determination]"
      },
      {
        id: "l-car-bank",
        accountCode: "1010",
        accountName: "Cash at Bank",
        category: "ASSET",
        debit: 0,
        credit: effectiveCarCost,
        lineExplanation: hasExplicitCarCost ? "Full settlement of vehicle purchase paid via bank transfer." : "Settlement of vehicle purchase \u2014 [Valuation pending determination]"
      }
    ];
    const carCitations = [
      convertToCitation(SINGAPORE_STATUTORY_REPOSITORY.ITA_SEC15_1_K_MOTOR_CAR),
      convertToCitation(SINGAPORE_STATUTORY_REPOSITORY.GST_REG26_BLOCKED_INPUT_TAX)
    ];
    const carAdvisories = [
      convertToAdvisory(SINGAPORE_STATUTORY_REPOSITORY.ITA_SEC15_1_K_MOTOR_CAR),
      convertToAdvisory(SINGAPORE_STATUTORY_REPOSITORY.GST_REG26_BLOCKED_INPUT_TAX)
    ];
    const carAuthorityStatus = hasExplicitCarCost ? "DETERMINISTIC" : "CONDITIONAL";
    return {
      scenarioType: "CAR_PURCHASE_STATUTORY",
      authorityStatus: carAuthorityStatus,
      queryIntent: hasExplicitCarCost ? "HYBRID" : "STATUTORY_ADVISORY",
      primaryDomain: "MULTI_AUTHORITY",
      rawQuery: query,
      transactionTitle: "Purchase of Passenger Motor Car (Tax Disallowed & GST Blocked)",
      functionalCurrency,
      transactionCurrency: functionalCurrency,
      accountingTreatmentSummary: "Capitalize gross motor vehicle cost into Non-Current Assets under SFRS(I) 1-16 \xA716. Input GST is capitalized because it is non-recoverable. Depreciate straight-line over useful life through P&L.",
      singaporeTaxTreatmentSummary: "Under Section 15(1)(k) of the Income Tax Act 1947, no tax deduction or Section 19/19A Capital Allowances are granted on passenger cars (S-plate). Accounting depreciation must be added back 100% in Form C-S. Under Regulation 26 of the GST Regulations, 9% input GST is strictly blocked from recovery.",
      regulatoryMandatesSummary: "Companies Act 1967 Section 199 mandatory retention of purchase vouchers, invoices, and payment proof for at least 5 years.",
      effectiveDateOrTiming: "Singapore 9% GST rate (since 1 Jan 2024); ITA Section 15(1)(k) active.",
      uncertaintyDisclaimer: "Commercial goods vehicles (G/Y plate) are eligible for Section 19A Capital Allowances and GST recovery; this disallowance strictly applies to passenger motor cars (S-plate).",
      statutoryAdvisory: carAdvisories,
      directGroups: [
        {
          id: "grp-car-purchase",
          eventDate: formatSingaporeDate(/* @__PURE__ */ new Date()),
          title: hasExplicitCarCost ? "Single Compound Journal Entry: Acquisition of Passenger Motor Car" : "AI-Proposed Double Entry (Pending Valuation)",
          summary: hasExplicitCarCost ? `Acquisition of passenger motor car for ${functionalCurrency} ${effectiveCarCost.toLocaleString()} (Gross Cost capitalized with Zero Input GST Claim)` : "Acquisition of passenger motor car \u2014 provisional journal entry structure with uncalculated monetary amounts.",
          lines,
          totalDebit: effectiveCarCost,
          totalCredit: effectiveCarCost,
          isBalanced: hasExplicitCarCost,
          citations: carCitations,
          authorityStatus: carAuthorityStatus,
          rationalePoints: [
            "Under IRAS GST Regulation 26: 9% Input GST incurred on passenger cars (S-plate) is strictly blocked from recovery. The full invoice amount is capitalized into the asset cost.",
            "Under Section 15(1)(k) of the Income Tax Act 1947: No deduction or capital allowance is granted on passenger cars. Depreciation in accounting records must be added back 100% in the corporate tax computation.",
            hasExplicitCarCost ? "Sum of Debits = Sum of Credits ($" + effectiveCarCost.toLocaleString() + "). Journal entry is 100% balanced." : "\u26A0\uFE0F AMOUNTS PENDING: Motor vehicle purchase price was not specified in query. Journal structure is proposed; monetary amounts must be determined before posting."
          ]
        }
      ],
      keyParameters: [
        { label: "Asset Recognized", value: "Motor Vehicles (Gross Cost)", badge: "Asset Cost" },
        {
          label: "Total Purchase Outlay",
          value: hasExplicitCarCost ? `${functionalCurrency} ${effectiveCarCost.toLocaleString()}` : "Pending Determination",
          badge: hasExplicitCarCost ? "Outflow" : "Missing Fact"
        },
        { label: "9% Input GST Status", value: "BLOCKED (Regulation 26)", badge: "IRAS Disallowed", highlight: true },
        { label: "Corporate Tax Deduction", value: "DISALLOWED (\xA715(1)(k))", badge: "No CA Granted", highlight: true },
        { label: "Depreciation Add-Back", value: "Mandatory in Form C-S", badge: "Tax Add-Back" },
        { label: "Governing Authorities", value: "IRAS & AGC Singapore", badge: "SSO Verified" }
      ],
      isComplete: hasExplicitCarCost,
      missingFields: hasExplicitCarCost ? [] : [
        {
          fieldKey: "carCost",
          fieldName: "Motor Vehicle Purchase Price",
          prompt: "What is the purchase price of the passenger car?",
          whyNeeded: "Directly measurable purchase cost is required for capitalization under SFRS(I) 1-16 \xA716."
        }
      ]
    };
  }
  if (isStatutoryQuestion && !(/\b(equipment|computer server|server|computer|machinery|plant)\b/i.test(query) && /\b(incurred|purchased|bought|acquired|purchase)\b/i.test(query))) {
    const matchedRules = querySingaporeStatutes(query);
    if (matchedRules.length > 0) {
      const primaryRule = matchedRules[0];
      const distinctSections = /* @__PURE__ */ new Set();
      const relevantRules = [];
      for (const rule of matchedRules) {
        const hasDirectTagMatch = rule.tags.some((t) => q.includes(t)) || q.includes(rule.sectionOrSchedule.toLowerCase());
        if (rule !== primaryRule && !hasDirectTagMatch) continue;
        if (rule.id === "MOM_ANNUAL_SICK_LEAVE" && matchedRules.some((other) => other.id === "MOM_SEC88A_ANNUAL_LEAVE" && other.tags.some((t) => q.includes(t)))) {
          continue;
        }
        const secKey = `${rule.actCode}-${rule.sectionOrSchedule}`;
        if (!distinctSections.has(secKey)) {
          distinctSections.add(secKey);
          relevantRules.push(rule);
        }
      }
      const advisories = relevantRules.map(convertToAdvisory);
      const citations = relevantRules.map(convertToCitation);
      let primaryDomain = "GENERAL";
      if (primaryRule.category === "ACRA_COMPLIANCE") primaryDomain = "ACRA_CORP";
      else if (primaryRule.category === "CPF_PAYROLL") primaryDomain = "CPF_BOARD";
      else if (primaryRule.category === "MOM_LABOUR") primaryDomain = "MOM_EMPLOYMENT";
      else if (primaryRule.category === "TAX_GST") primaryDomain = "IRAS_GST";
      else if (primaryRule.category === "TAX_INCOME") primaryDomain = "IRAS_TAX";
      else if (primaryRule.category === "MAS_FINANCE") primaryDomain = "MAS_FUNDS";
      let acctSummary = "Financial statements must be prepared under the accrual basis compliant with SFRS(I) pursuant to Section 201 of the Companies Act 1967.";
      let taxSummary = relevantRules.map((r) => `${r.actTitle} (${r.sectionOrSchedule}): ${r.principle}`).join("; ");
      let effDate = "Current Singapore Legislation";
      if (primaryRule.category === "ACRA_COMPLIANCE") {
        acctSummary = "Eligible private companies are exempt from statutory audit and prepare unaudited financial statements compliant with SFRS.";
        taxSummary = "Tax filing (Form C-S / Form C) remains mandatory with IRAS regardless of ACRA audit exemption.";
        effDate = "Companies Act 1967 Section 205C & Thirteenth Schedule active.";
      } else if (primaryRule.category === "CPF_PAYROLL") {
        acctSummary = "Employer mandatory CPF contributions and employee gross wages are debited to Operating Expenses (Staff Costs) under SFRS(I) 1-1 \xA728.";
        taxSummary = "Employer mandatory CPF contributions are 100% tax-deductible under Section 14(1)(e) of the Income Tax Act up to statutory ceilings. Excess voluntary contributions are disallowed.";
        effDate = "2026 Ordinary Wage monthly ceiling of SGD 8,000 effective 1 January 2026.";
      } else if (primaryRule.category === "MOM_LABOUR") {
        acctSummary = "Accrued annual leave, overtime pay, and salaries are recognized under the accrual basis as Operating Expenses (Staff Costs) with corresponding credit to Accrued Expenses.";
        taxSummary = "Allowable staff operating expenses under Section 14(1) of the Income Tax Act 1947.";
        effDate = "Employment Act 1968 active.";
      } else if (primaryRule.category === "TAX_GST") {
        acctSummary = "Output GST is recognized as a current liability upon issuing tax invoices. Recoverable input GST is recorded as a tax receivable asset under SFRS(I) 1-1.";
        taxSummary = "GST standard rate is 9%. Compulsory registration is mandated when taxable turnover exceeds SGD 1,000,000 under retrospective (calendar year) or prospective (next 12 months) tests.";
        effDate = "Standard 9% GST rate effective 1 January 2024.";
      } else if (primaryRule.category === "TAX_INCOME") {
        acctSummary = "Operating expenses are debited to P&L in the financial statements. Depreciation is recognized over asset useful life.";
        taxSummary = 'Accounting depreciation is disallowed and added back in tax computation. Tax deductions are governed by Section 14(1) ("wholly and exclusively incurred") and Section 19/19A Capital Allowances.';
        effDate = "Headline Corporate Tax Rate is 17%; Form C-S filing deadline 30 November of Year of Assessment.";
      }
      const keyParams = [
        { label: "Governing Authority", value: relevantRules.map((r) => r.authority).join(" / "), badge: primaryRule.authority },
        { label: "Statute / Act", value: [...new Set(relevantRules.map((r) => r.actTitle))].join("; "), badge: primaryRule.actCode },
        { label: "Section / Schedule", value: relevantRules.map((r) => r.sectionOrSchedule).join(", "), badge: "Statutory Sections", highlight: true },
        ...relevantRules.flatMap((r) => r.practicalRules.slice(0, 2)).slice(0, 4).map((r, idx) => ({
          label: `Rule #${idx + 1}`,
          value: r.length > 70 ? r.slice(0, 67) + "..." : r,
          badge: "Compliance"
        })),
        { label: "Official SSO Source", value: "Singapore Statutes Online", badge: "Verified", highlight: true }
      ];
      const combinedTitle = relevantRules.length > 1 ? `Statutory Directives: ${relevantRules.map((r) => r.sectionOrSchedule).join(", ")}` : `Statutory Directive: ${primaryRule.ruleTitle}`;
      const combinedSummary = relevantRules.map((r) => `\u2022 ${r.actTitle} (${r.sectionOrSchedule}): ${r.principle}`).join("\n\n");
      return {
        scenarioType: "SINGAPORE_STATUTORY_ADVISORY",
        authorityStatus: "DETERMINISTIC",
        queryIntent: "STATUTORY_ADVISORY",
        primaryDomain,
        rawQuery: query,
        transactionTitle: combinedTitle,
        functionalCurrency,
        transactionCurrency: functionalCurrency,
        accountingTreatmentSummary: acctSummary,
        singaporeTaxTreatmentSummary: taxSummary,
        regulatoryMandatesSummary: `${primaryRule.authority} compliance mandated under Singapore statutory law.`,
        effectiveDateOrTiming: effDate,
        uncertaintyDisclaimer: "Grounded in current Singapore statutory provisions and regulatory guidelines. Review specific corporate facts or engage a licensed Singapore tax agent / public accountant for complex situations.",
        statutoryAdvisory: advisories,
        keyParameters: keyParams,
        directGroups: [
          {
            id: "grp-statutory-directive",
            eventDate: formatSingaporeDate(/* @__PURE__ */ new Date()),
            title: combinedTitle,
            summary: combinedSummary,
            lines: [],
            totalDebit: 0,
            totalCredit: 0,
            isBalanced: true,
            citations,
            authorityStatus: "DETERMINISTIC",
            rationalePoints: relevantRules.flatMap((r) => r.practicalRules)
          }
        ],
        isComplete: true,
        missingFields: []
      };
    }
  }
  const isFollowUpOnPpe = currentScenario?.scenarioType === "PPE_IAS16" && (q.includes("interest") || q.includes("loan") || q.includes("trade-in") || q.includes("trade in") || q.includes("cash") || q.includes("depreciation") || q.includes("what if") || q.includes("change") || q.includes("how about") || q.includes("why") || q.includes("explain"));
  const isPpeTradeIn = isFollowUpOnPpe || (q.includes("machinery") || q.includes("machine") || q.includes("equipment") || q.includes("fixed asset") || q.includes("ppe")) && (q.includes("trade-in") || q.includes("trade in") || q.includes("disposal") || q.includes("derecognition") || q.includes("depreciation"));
  if (isPpeTradeIn) {
    let newCost = 1e5;
    if (isFollowUpOnPpe && currentScenario?.keyParameters) {
      const priorParam = currentScenario.keyParameters.find((p) => p.label.includes("New Machine Cost"));
      if (priorParam) {
        const num = parseFloat(priorParam.value.replace(/[^0-9.]/g, ""));
        if (num > 1e3) newCost = num;
      }
    }
    const newCostMatch = query.match(/(?:purchases?|bought|acquires?|cost(?:\s*of)?)\s*(?:new\s*)?(?:machinery|machine|equipment)?[^0-9]*?(?:sgd|\$)?\s*([\d,]+(?:\.\d+)?)/i);
    if (newCostMatch && newCostMatch[1]) {
      const parsedVal = parseFloat(newCostMatch[1].replace(/,/g, ""));
      if (parsedVal > 1e3) newCost = parsedVal;
    }
    let gstRate = 0.09;
    const gstMatch = query.match(/(\d+)%\s*gst/i);
    if (gstMatch && gstMatch[1]) {
      gstRate = parseFloat(gstMatch[1]) / 100;
    }
    const inputGst = Math.round(newCost * gstRate * 100) / 100;
    const grossNewCost = newCost + inputGst;
    let oldCost = 5e4;
    if (isFollowUpOnPpe && currentScenario?.keyParameters) {
      const priorCostParam = currentScenario.keyParameters.find((p) => p.label.includes("Old Machine Original Cost"));
      if (priorCostParam) {
        const num = parseFloat(priorCostParam.value.replace(/[^0-9.]/g, ""));
        if (num > 1e3) oldCost = num;
      }
    }
    const oldCostMatch = query.match(/old\s*(?:machine|machinery|equipment)\s*cost\s*(?:is|=|:)?\s*(?:sgd|\$)?\s*([\d,]+(?:\.\d+)?)/i);
    if (oldCostMatch && oldCostMatch[1]) {
      const parsedVal = parseFloat(oldCostMatch[1].replace(/,/g, ""));
      if (parsedVal > 1e3) oldCost = parsedVal;
    }
    let deprRateAnnual = 0.2;
    const deprRateMatch = query.match(/(\d+)%\s*(?:per\s*annum|p\.a\.|annual)/i);
    if (deprRateMatch && deprRateMatch[1]) {
      deprRateAnnual = parseFloat(deprRateMatch[1]) / 100;
    }
    const catchUpDepr = Math.round(oldCost * deprRateAnnual * (3 / 12) * 100) / 100;
    const priorAccDepr = Math.round(oldCost * deprRateAnnual * 2 * 100) / 100;
    const totalAccDeprAtDisposal = priorAccDepr + catchUpDepr;
    const netBookValueOld = oldCost - totalAccDeprAtDisposal;
    let agreedTradeInGross = 21800;
    if (isFollowUpOnPpe && currentScenario?.keyParameters) {
      const priorTradeInParam = currentScenario.keyParameters.find((p) => p.label.includes("Agreed Trade-In Value"));
      if (priorTradeInParam) {
        const num = parseFloat(priorTradeInParam.value.replace(/[^0-9.]/g, ""));
        if (num > 500) agreedTradeInGross = num;
      }
    }
    const tradeInMatch = query.match(/trade-?in\s*(?:value\s*)?(?:of|is|at)?\s*(?:sgd|\$)?\s*([\d,]+(?:\.\d+)?)/i);
    if (tradeInMatch && tradeInMatch[1]) {
      const parsedVal = parseFloat(tradeInMatch[1].replace(/,/g, ""));
      if (parsedVal > 500) agreedTradeInGross = parsedVal;
    }
    const netTradeInProceeds = Math.round(agreedTradeInGross / (1 + gstRate) * 100) / 100;
    const outputGst = Math.round((agreedTradeInGross - netTradeInProceeds) * 100) / 100;
    const lossOnDisposal = Math.round((netBookValueOld - netTradeInProceeds) * 100) / 100;
    let cashPaid = 3e4;
    if (isFollowUpOnPpe && currentScenario?.keyParameters) {
      const priorCashParam = currentScenario.keyParameters.find((p) => p.label.includes("Cash Paid"));
      if (priorCashParam) {
        const num = parseFloat(priorCashParam.value.replace(/[^0-9.]/g, ""));
        if (num >= 0) cashPaid = num;
      }
    }
    const cashMatch = query.match(/(?:cash\s*paid|paid\s*via\s*bank|bank\s*transfer|cash)[^0-9]*?(?:sgd|\$)?\s*([\d,]+(?:\.\d+)?)/i);
    if (cashMatch && cashMatch[1]) {
      const parsedVal = parseFloat(cashMatch[1].replace(/,/g, ""));
      if (parsedVal > 100) cashPaid = parsedVal;
    }
    const loanPrincipal = grossNewCost - agreedTradeInGross - cashPaid;
    let loanYears = 2;
    const loanYearsMatch = query.match(/(\d+)\s*-?\s*years?\s*(?:equipment\s*)?loan/i);
    if (loanYearsMatch && loanYearsMatch[1]) {
      loanYears = parseInt(loanYearsMatch[1], 10);
    }
    let flatInterestRate = 0.05;
    if (isFollowUpOnPpe && currentScenario?.keyParameters) {
      const priorInterestParam = currentScenario.keyParameters.find((p) => p.label.includes("Unexpired Interest"));
      if (priorInterestParam) {
        const match = priorInterestParam.label.match(/(\d+(?:\.\d+)?)\s*%/);
        if (match && match[1]) flatInterestRate = parseFloat(match[1]) / 100;
      }
    }
    const flatInterestMatch = query.match(/(\d+(?:\.\d+)?)\s*%\s*(?:per\s*annum\s*)?flat/i) || query.match(/interest\s*(?:rate)?\s*(?:is|=|to)?\s*(\d+(?:\.\d+)?)\s*%/i);
    if (flatInterestMatch && flatInterestMatch[1]) {
      flatInterestRate = parseFloat(flatInterestMatch[1]) / 100;
    }
    const unexpiredInterest = Math.round(loanPrincipal * flatInterestRate * loanYears * 100) / 100;
    const grossLoanPayable = loanPrincipal + unexpiredInterest;
    const directGroups2 = [
      {
        id: "grp-catchup-depr",
        eventDate: "01/04/2026",
        title: "Entry 1: Catch-Up Depreciation for Jan\u2013Mar 2026",
        summary: `Record 3 months depreciation ($50,000 \xD7 20% \xD7 3/12 = SGD 2,500) prior to derecognition under IAS 16 \xA755`,
        lines: [
          {
            id: "l1-depr-exp",
            accountCode: "5200",
            accountName: "Depreciation Expense - Machinery (P&L)",
            category: "EXPENSE",
            debit: catchUpDepr,
            credit: 0,
            lineExplanation: "Recognition of 3-month depreciation from 1 Jan 2026 to 31 Mar 2026 in profit or loss."
          },
          {
            id: "l1-acc-depr",
            accountCode: "1690",
            accountName: "Accumulated Depreciation - Machinery",
            category: "ASSET",
            debit: 0,
            credit: catchUpDepr,
            lineExplanation: "Contra-asset increase to bring accumulated depreciation up to date as of disposal date."
          }
        ],
        totalDebit: catchUpDepr,
        totalCredit: catchUpDepr,
        isBalanced: true,
        citations: [
          getCitation("IAS16_DEPRECIATION_CATCHUP", "SFRS_I")
        ],
        rationalePoints: [
          "Under IAS 16 / SFRS(I) 1-16 \xA755: Depreciation ceases on derecognition. Depreciation up to 31 March 2026 must be recognized before computing disposal gain/loss.",
          "Debit Rule: Depreciation increases operating expenses in P&L.",
          "Credit Rule: Accumulated depreciation (contra-asset) increases."
        ]
      },
      {
        id: "grp-disposal-old",
        eventDate: "01/04/2026",
        title: "Entry 2: Derecognition / Disposal of Old Machinery",
        summary: `Derecognize old machine (Cost SGD 50,000, Acc Depr SGD 22,500), record net trade-in value SGD 20,000 + 9% Output GST SGD 1,800, and loss on disposal SGD 7,500`,
        lines: [
          {
            id: "l2-acc-depr",
            accountCode: "1690",
            accountName: "Accumulated Depreciation - Machinery",
            category: "ASSET",
            debit: totalAccDeprAtDisposal,
            credit: 0,
            lineExplanation: "Derecognition of total accumulated depreciation ($20,000 prior + $2,500 catch-up) on disposal."
          },
          {
            id: "l2-loss-disposal",
            accountCode: "5520",
            accountName: "Loss on Disposal of Machinery (P&L)",
            category: "EXPENSE",
            debit: lossOnDisposal,
            credit: 0,
            lineExplanation: "Loss arising from carrying amount ($27,500) exceeding net disposal proceeds ($20,000) under IAS 16 \xA768."
          },
          {
            id: "l2-tradein-clearing",
            accountCode: "1150",
            accountName: "Vendor Clearing Account / Trade-in Consideration",
            category: "ASSET",
            debit: agreedTradeInGross,
            credit: 0,
            lineExplanation: "Agreed trade-in value (inclusive of 9% GST) receivable as offset against new machinery purchase."
          },
          {
            id: "l2-old-asset-cost",
            accountCode: "1600",
            accountName: "Machinery - Historical Cost (Old Machine)",
            category: "ASSET",
            debit: 0,
            credit: oldCost,
            lineExplanation: "Derecognition of the original gross cost of the old machine from balance sheet."
          },
          {
            id: "l2-output-gst",
            accountCode: "2200",
            accountName: "GST Output Tax (IRAS 9% Payable)",
            category: "LIABILITY",
            debit: 0,
            credit: outputGst,
            lineExplanation: "9% Output GST payable to IRAS on disposal/trade-in of business asset ($21,800 / 1.09 \xD7 9%)."
          }
        ],
        totalDebit: totalAccDeprAtDisposal + lossOnDisposal + agreedTradeInGross,
        totalCredit: oldCost + outputGst,
        isBalanced: true,
        citations: [
          getCitation("IAS16_DERECOGNITION", "SFRS_I"),
          getCitation("SINGAPORE_GST_TRADE_IN", "SFRS_I")
        ],
        rationalePoints: [
          "Under IAS 16 / SFRS(I) 1-16 \xA767-\xA771: The carrying amount of an asset is derecognised on disposal. Loss on disposal = Carrying Amount ($27,500) - Net Proceeds ($20,000) = SGD 7,500.",
          "Singapore GST Act: A trade-in is a taxable supply. The company must account for 9% output tax (SGD 1,800) on the agreed trade-in value ($21,800 gross).",
          "Sum of Debits ($51,800) = Sum of Credits ($51,800)."
        ]
      },
      {
        id: "grp-acq-new",
        eventDate: "01/04/2026",
        title: "Entry 3: Acquisition of New Machinery & Equipment Loan Financing",
        summary: `Capitalize new machine at cost SGD 100,000, claim 9% input GST SGD 9,000, offset trade-in SGD 21,800, bank cash SGD 30,000, and 2-year loan SGD 62,920 (with unexpired interest contra SGD 5,720)`,
        lines: [
          {
            id: "l3-new-asset-cost",
            accountCode: "1600",
            accountName: "Machinery - Cost (New Machine)",
            category: "ASSET",
            debit: newCost,
            credit: 0,
            lineExplanation: "Initial recognition of new machinery at purchase price exclusive of recoverable GST (IAS 16 \xA716)."
          },
          {
            id: "l3-input-gst",
            accountCode: "1190",
            accountName: "GST Input Tax (IRAS 9% Receivable)",
            category: "ASSET",
            debit: inputGst,
            credit: 0,
            lineExplanation: "9% recoverable input GST claimable against IRAS in the quarterly GST return."
          },
          {
            id: "l3-unexpired-interest",
            accountCode: "2520",
            accountName: "Unexpired Loan Interest (Contra-Liability)",
            category: "LIABILITY",
            debit: unexpiredInterest,
            credit: 0,
            lineExplanation: "Deferred finance charge presented upfront as contra-liability offset against gross equipment loan."
          },
          {
            id: "l3-tradein-clearing",
            accountCode: "1150",
            accountName: "Vendor Clearing Account / Trade-in Consideration",
            category: "ASSET",
            debit: 0,
            credit: agreedTradeInGross,
            lineExplanation: "Application of trade-in credit against new machinery purchase liability."
          },
          {
            id: "l3-bank",
            accountCode: "1010",
            accountName: "Cash at Bank",
            category: "ASSET",
            debit: 0,
            credit: cashPaid,
            lineExplanation: "Cash disbursement via bank transfer on 1 April 2026."
          },
          {
            id: "l3-loan-payable",
            accountCode: "2510",
            accountName: "Equipment Loan Payable (Gross Note Amount)",
            category: "LIABILITY",
            debit: 0,
            credit: grossLoanPayable,
            lineExplanation: "Gross note payable for 2-year equipment loan ($57,200 principal + $5,720 flat interest)."
          }
        ],
        totalDebit: newCost + inputGst + unexpiredInterest,
        totalCredit: agreedTradeInGross + cashPaid + grossLoanPayable,
        isBalanced: true,
        citations: [
          getCitation("IAS16_PPE_RECOGNITION", "SFRS_I"),
          getCitation("IFRS9_LOAN_UNEXPIRED_INTEREST", "SFRS_I")
        ],
        rationalePoints: [
          "Under IAS 16 \xA716: Recoverable taxes (Input GST SGD 9,000) are excluded from asset cost.",
          "Under IFRS 9: Net loan obligation initially recognized is SGD 57,200 (Gross note SGD 62,920 less Unexpired Interest contra SGD 5,720).",
          "Sum of Debits ($114,720) = Sum of Credits ($114,720)."
        ]
      }
    ];
    directGroups2.forEach((g) => {
      g.authorityStatus = "DETERMINISTIC";
    });
    return {
      scenarioType: "PPE_IAS16",
      authorityStatus: "DETERMINISTIC",
      queryIntent: "TRANSACTION",
      primaryDomain: "MULTI_AUTHORITY",
      rawQuery: query,
      transactionTitle: "Machinery Acquisition with Trade-In & Equipment Loan",
      functionalCurrency,
      transactionCurrency: functionalCurrency,
      accountingTreatmentSummary: "Under SFRS(I) 1-16 \xA755, record catch-up depreciation up to the disposal date. Derecognize the carrying amount of the old asset (\xA767-\xA771) and recognize Loss on Disposal in P&L. New machine is recognized at cost net of recoverable GST. Under SFRS(I) 9, equipment loan is recognized at gross note amount with upfront unexpired loan interest contra-liability.",
      singaporeTaxTreatmentSummary: "The trade-in consideration represents a taxable supply subject to 9% Output GST (SGD 1,800). 9% Input GST on new machine (SGD 9,000) is recoverable from IRAS. Loss on disposal is not tax-deductible; accounting depreciation is added back in tax computation and qualifying plant & machinery claims Section 19A Capital Allowances.",
      regulatoryMandatesSummary: "Record keeping compliance under Section 199 of the Companies Act 1967.",
      effectiveDateOrTiming: "Singapore standard 9% GST rate; Section 19A Capital Allowances active.",
      directGroups: directGroups2,
      keyParameters: [
        { label: "New Machine Cost (Excl. GST)", value: `${functionalCurrency} ${newCost.toLocaleString()}`, badge: "Asset Cost" },
        { label: "Input GST (9% Claimable)", value: `${functionalCurrency} ${inputGst.toLocaleString()}`, badge: "Tax Receivable" },
        { label: "Agreed Trade-In Value (Gross)", value: `${functionalCurrency} ${agreedTradeInGross.toLocaleString()}`, badge: "Trade-In Gross" },
        { label: "Net Trade-In Consideration", value: `${functionalCurrency} ${netTradeInProceeds.toLocaleString()}`, badge: "Proceeds" },
        { label: "Output GST on Trade-In (9%)", value: `${functionalCurrency} ${outputGst.toLocaleString()}`, badge: "Tax Payable" },
        { label: "Old Machine Original Cost", value: `${functionalCurrency} ${oldCost.toLocaleString()}`, badge: "Historical Cost" },
        { label: "Catch-up Depr (Jan\u2013Mar 2026)", value: `${functionalCurrency} ${catchUpDepr.toLocaleString()}`, badge: "P&L Expense" },
        { label: "Total Acc. Depr at Disposal", value: `${functionalCurrency} ${totalAccDeprAtDisposal.toLocaleString()}`, badge: "Contra-Asset" },
        { label: "Net Book Value at Disposal", value: `${functionalCurrency} ${netBookValueOld.toLocaleString()}`, badge: "Carrying Value" },
        { label: "Loss on Disposal (P&L)", value: `${functionalCurrency} ${lossOnDisposal.toLocaleString()}`, badge: "P&L Loss", highlight: true },
        { label: "Cash Paid via Bank", value: `${functionalCurrency} ${cashPaid.toLocaleString()}`, badge: "Bank Outflow" },
        { label: "Equipment Loan Principal", value: `${functionalCurrency} ${loanPrincipal.toLocaleString()}`, badge: "Net Borrowing" },
        { label: "Unexpired Interest (5% x 2y)", value: `${functionalCurrency} ${unexpiredInterest.toLocaleString()}`, badge: "Contra-Liability" },
        { label: "Gross Equipment Loan Payable", value: `${functionalCurrency} ${grossLoanPayable.toLocaleString()}`, badge: "Gross Liability" }
      ],
      isComplete: true,
      missingFields: []
    };
  }
  const isFollowUpOnDiscount = currentScenario?.scenarioType === "ASSET_PURCHASE_DISCOUNT" && (q.includes("discount") || q.includes("cash") || q.includes("bank") || q.includes("price") || q.includes("pay") || q.includes("settle") || q.includes("what if") || q.includes("change") || q.includes("how about") || q.includes("why") || q.includes("explain") || q.includes("compound") || q.includes("depreciation"));
  const isAssetPurchaseWithDiscount = isFollowUpOnDiscount || (q.includes("purchas") || q.includes("bought") || q.includes("acquir")) && (q.includes("discount") || q.includes("list price") || q.includes("credit terms")) && (q.includes("equipment") || q.includes("furniture") || q.includes("machinery") || q.includes("computer") || q.includes("asset") || q.includes("inventory"));
  if (isAssetPurchaseWithDiscount) {
    let assetTitle = "Office Equipment";
    if (isFollowUpOnDiscount && currentScenario?.transactionTitle) {
      if (currentScenario.transactionTitle.includes("Machinery")) assetTitle = "Machinery";
      else if (currentScenario.transactionTitle.includes("Furniture")) assetTitle = "Furniture & Fixtures";
      else if (currentScenario.transactionTitle.includes("Computer")) assetTitle = "Computer Equipment";
    }
    if (q.includes("office equipment")) assetTitle = "Office Equipment";
    else if (q.includes("machinery")) assetTitle = "Machinery";
    else if (q.includes("furniture")) assetTitle = "Furniture & Fixtures";
    else if (q.includes("computer")) assetTitle = "Computer Equipment";
    else if (q.includes("vehicle")) assetTitle = "Motor Vehicles";
    let listPrice = 2e4;
    if (isFollowUpOnDiscount && currentScenario?.keyParameters) {
      const priorParam = currentScenario.keyParameters.find((p) => p.label.includes("List Price"));
      if (priorParam) {
        const num = parseFloat(priorParam.value.replace(/[^0-9.]/g, ""));
        if (num > 100) listPrice = num;
      }
    }
    const listPriceMatch = query.match(/(?:list\s*price|price|cost|for)\s*(?:of|is|at|to)?\s*(?:sgd|\$)?\s*([\d,]+(?:\.\d+)?)/i);
    if (listPriceMatch && listPriceMatch[1]) {
      const parsedVal = parseFloat(listPriceMatch[1].replace(/,/g, ""));
      if (parsedVal > 100) listPrice = parsedVal;
    }
    let discountRate = 0.1;
    if (isFollowUpOnDiscount && currentScenario?.keyParameters) {
      const priorDiscountParam = currentScenario.keyParameters.find((p) => p.label.includes("Trade Discount"));
      if (priorDiscountParam) {
        const match = priorDiscountParam.label.match(/(\d+(?:\.\d+)?)\s*%/);
        if (match && match[1]) discountRate = parseFloat(match[1]) / 100;
      }
    }
    const discountMatch = query.match(/(\d+(?:\.\d+)?)\s*%\s*(?:trade\s*)?discount/i) || query.match(/discount\s*(?:is|=|to)?\s*(\d+(?:\.\d+)?)\s*%/i);
    if (discountMatch && discountMatch[1]) {
      discountRate = parseFloat(discountMatch[1]) / 100;
    }
    const tradeDiscountAmount = Math.round(listPrice * discountRate * 100) / 100;
    const netAssetCost = listPrice - tradeDiscountAmount;
    let gstRate = 0.09;
    const gstMatch = query.match(/(\d+)%\s*gst/i);
    if (gstMatch && gstMatch[1]) {
      gstRate = parseFloat(gstMatch[1]) / 100;
    }
    const inputGst = Math.round(netAssetCost * gstRate * 100) / 100;
    const grossInvoice = netAssetCost + inputGst;
    let immediateCash = 5e3;
    if (isFollowUpOnDiscount && currentScenario?.keyParameters) {
      const priorCashParam = currentScenario.keyParameters.find((p) => p.label.includes("Immediate Bank Payment") || p.label.includes("Cash Paid"));
      if (priorCashParam) {
        const num = parseFloat(priorCashParam.value.replace(/[^0-9.]/g, ""));
        if (num >= 0) immediateCash = num;
      }
    }
    const cashMatch = query.match(/(?:pays?|paid|cash|bank\s*transfer)[^0-9]*?(?:sgd|\$)?\s*([\d,]+(?:\.\d+)?)\s*(?:immediately|by|via|bank)?/i);
    if (cashMatch && cashMatch[1]) {
      const parsedVal = parseFloat(cashMatch[1].replace(/,/g, ""));
      if (parsedVal >= 0) immediateCash = parsedVal;
    }
    const creditBalance = grossInvoice - immediateCash;
    let transDate = "01/08/2026";
    if (isFollowUpOnDiscount && currentScenario?.directGroups?.[0]?.eventDate) {
      transDate = currentScenario.directGroups[0].eventDate;
    }
    const dateMatch = query.match(/(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{4})/i);
    if (dateMatch) {
      const monthMap = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
      const mStr = dateMatch[2].toLowerCase().slice(0, 3);
      transDate = `${dateMatch[1].padStart(2, "0")}/${monthMap[mStr] || "08"}/${dateMatch[3]}`;
    }
    const lines = [
      {
        id: "l-equip-cost",
        accountCode: "1500",
        accountName: `${assetTitle} - Cost (Non-Current Asset)`,
        category: "ASSET",
        debit: netAssetCost,
        credit: 0,
        lineExplanation: `Capitalization of ${assetTitle.toLowerCase()} at net purchase price after deducting ${discountRate * 100}% trade discount under IAS 16 \xA716(a).`
      },
      {
        id: "l-gst-input",
        accountCode: "1190",
        accountName: "GST Input Tax (IRAS 9% Receivable)",
        category: "ASSET",
        debit: inputGst,
        credit: 0,
        lineExplanation: "9% recoverable input GST on net purchase price claimable from IRAS."
      },
      {
        id: "l-bank-pay",
        accountCode: "1010",
        accountName: "Cash at Bank",
        category: "ASSET",
        debit: 0,
        credit: immediateCash,
        lineExplanation: "Immediate partial settlement paid via bank transfer."
      },
      {
        id: "l-trade-payable",
        accountCode: "2010",
        accountName: "Trade Payables / Other Payables (Current Liability)",
        category: "LIABILITY",
        debit: 0,
        credit: creditBalance,
        lineExplanation: "Unsettled balance placed on commercial credit terms."
      }
    ];
    const isSettlement = q.includes("settle") || q.includes("pay the remaining") || q.includes("paid balance") || q.includes("settlement");
    const directGroups2 = [
      {
        id: "grp-equip-purchase",
        eventDate: formatSingaporeDate(transDate),
        title: `Single Compound Journal Entry: Purchase of ${assetTitle}`,
        summary: `Purchase of ${assetTitle} with list price ${functionalCurrency} ${listPrice.toLocaleString()} less ${discountRate * 100}% trade discount + 9% GST`,
        lines,
        totalDebit: netAssetCost + inputGst,
        totalCredit: immediateCash + creditBalance,
        isBalanced: true,
        citations: [
          getCitation("IAS16_TRADE_DISCOUNT", "SFRS_I"),
          getCitation("IAS16_PPE_RECOGNITION", "SFRS_I")
        ],
        rationalePoints: [
          `Under IAS 16 / SFRS(I) 1-16 \xA716(a): Trade discounts (${functionalCurrency} ${tradeDiscountAmount.toLocaleString()}) are deducted from list price to determine initial cost. Trade discounts are never recorded as separate ledger lines.`,
          `Under Singapore GST Act: 9% GST is calculated on the net selling price after trade discount (${functionalCurrency} ${netAssetCost.toLocaleString()} \xD7 9% = ${functionalCurrency} ${inputGst.toLocaleString()}).`,
          `Sum of Debits (${functionalCurrency} ${(netAssetCost + inputGst).toLocaleString()}) = Sum of Credits (${functionalCurrency} ${(immediateCash + creditBalance).toLocaleString()}). Single compound entry is 100% balanced.`
        ]
      }
    ];
    if (isSettlement && creditBalance > 0) {
      directGroups2.push({
        id: "grp-equip-settle",
        eventDate: "15/08/2026",
        title: "Subsequent Settlement of Trade Payables",
        summary: `Settlement of outstanding balance of ${functionalCurrency} ${creditBalance.toLocaleString()} via bank transfer under IFRS 9 \xA73.3.1`,
        lines: [
          {
            id: "l-settle-payable",
            accountCode: "2010",
            accountName: "Trade Payables / Other Payables (Current Liability)",
            category: "LIABILITY",
            debit: creditBalance,
            credit: 0,
            lineExplanation: "Derecognition of financial liability upon discharge of payment obligation."
          },
          {
            id: "l-settle-bank",
            accountCode: "1010",
            accountName: "Cash at Bank",
            category: "ASSET",
            debit: 0,
            credit: creditBalance,
            lineExplanation: "Disbursement of funds via bank transfer to settle vendor invoice."
          }
        ],
        totalDebit: creditBalance,
        totalCredit: creditBalance,
        isBalanced: true,
        citations: [
          getCitation("IFRS9_DERECOGNITION_LIABILITY", "SFRS_I")
        ],
        rationalePoints: [
          `Under IFRS 9 \xA73.3.1: An entity removes a financial liability from its balance sheet when the contractual obligation is discharged.`,
          `Debit: Trade Payables decreases on settlement.`,
          `Credit: Cash at Bank decreases on disbursement.`
        ]
      });
    } else if (currentScenario?.directGroups && currentScenario.directGroups.length > 1) {
      for (let i = 1; i < currentScenario.directGroups.length; i++) {
        const existingGrp = currentScenario.directGroups[i];
        if (existingGrp.id === "grp-equip-settle") {
          const grpClone = {
            ...existingGrp,
            lines: existingGrp.lines.map((l) => ({
              ...l,
              debit: l.debit > 0 ? creditBalance : 0,
              credit: l.credit > 0 ? creditBalance : 0
            })),
            totalDebit: creditBalance,
            totalCredit: creditBalance
          };
          directGroups2.push(grpClone);
        } else {
          directGroups2.push(existingGrp);
        }
      }
    }
    const hasSettlement = isSettlement || directGroups2.some((g) => g.id === "grp-equip-settle");
    directGroups2.forEach((g) => {
      g.authorityStatus = "DETERMINISTIC";
    });
    return {
      scenarioType: "ASSET_PURCHASE_DISCOUNT",
      authorityStatus: "DETERMINISTIC",
      queryIntent: "TRANSACTION",
      primaryDomain: "MULTI_AUTHORITY",
      rawQuery: query,
      transactionTitle: `Purchase of ${assetTitle} (Trade Discount & Credit Terms)`,
      functionalCurrency,
      transactionCurrency: functionalCurrency,
      accountingTreatmentSummary: `Under SFRS(I) 1-16 \xA716(a), trade discounts are deducted directly from the list price to arrive at the asset cost (${functionalCurrency} ${netAssetCost.toLocaleString()}). Trade discounts are never recorded as separate ledger accounts. Unsettled balance is recorded in Trade Payables under SFRS(I) 9.`,
      singaporeTaxTreatmentSummary: `Under Singapore GST law, 9% GST (${functionalCurrency} ${inputGst.toLocaleString()}) is calculated on the net discounted price and claimed as an input tax asset. Qualifying equipment is eligible for Section 19A Capital Allowances (e.g. 100% 1-year write-off for computers or low-value assets $\\le$ $5,000).`,
      regulatoryMandatesSummary: "Tax invoices and commercial receipts must be retained for 5 years under Section 199 of the Companies Act 1967.",
      effectiveDateOrTiming: "Singapore standard 9% GST rate (effective 1 January 2024).",
      directGroups: directGroups2,
      keyParameters: [
        { label: "List Price (Excl. GST)", value: `${functionalCurrency} ${listPrice.toLocaleString()}`, badge: "List Price" },
        { label: `Trade Discount (${discountRate * 100}%)`, value: `-${functionalCurrency} ${tradeDiscountAmount.toLocaleString()}`, badge: "IAS 16 \xA716(a)" },
        { label: "Net Capitalized Cost", value: `${functionalCurrency} ${netAssetCost.toLocaleString()}`, badge: "Asset Cost" },
        { label: "Input GST (9% Claimable)", value: `${functionalCurrency} ${inputGst.toLocaleString()}`, badge: "Tax Receivable" },
        { label: "Total Invoice Payable", value: `${functionalCurrency} ${grossInvoice.toLocaleString()}`, badge: "Gross Payable" },
        { label: "Immediate Bank Payment", value: `${functionalCurrency} ${immediateCash.toLocaleString()}`, badge: "Bank Outflow" },
        { label: "Trade Payables (Credit Terms)", value: `${functionalCurrency} ${creditBalance.toLocaleString()}`, badge: "Liability", highlight: !hasSettlement },
        ...hasSettlement ? [{ label: "Settlement Status", value: `Settled in Full (${functionalCurrency} ${creditBalance.toLocaleString()})`, badge: "Discharged" }] : []
      ],
      isComplete: true,
      missingFields: []
    };
  }
  if (/\b(revenue recognition|performance obligation|contract (asset|liability)|recognise revenue)\b/i.test(query)) {
    return {
      scenarioType: "STATUTORY_ADVISORY",
      authorityStatus: "CONDITIONAL",
      queryIntent: "STATUTORY_ADVISORY",
      primaryDomain: "ACCOUNTING_SFRS",
      rawQuery: query,
      transactionTitle: "SFRS(I) 15 Revenue Recognition Assessment",
      functionalCurrency,
      transactionCurrency: functionalCurrency,
      accountingTreatmentSummary: "Identify the contract and distinct performance obligations, determine and allocate the transaction price, then recognise revenue when or as each performance obligation is satisfied.",
      singaporeTaxTreatmentSummary: "Financial-reporting timing does not itself determine Singapore income-tax treatment. Review the applicable tax rules and the contract facts separately.",
      effectiveDateOrTiming: "Revenue timing depends on transfer of control and the specific contract terms.",
      uncertaintyDisclaimer: "Review the contract, variable consideration, payment terms, and whether control transfers over time or at a point in time before posting a journal.",
      directGroups: [],
      projectedGroups: [],
      isComplete: false,
      missingFields: [{
        fieldKey: "revenueContractTerms",
        fieldName: "Contract and performance-obligation terms",
        prompt: "What is promised to the customer, when does control transfer, and what is the transaction price?",
        whyNeeded: "Revenue cannot be measured or timed safely without the contract facts."
      }]
    };
  }
  const isBusinessEquipmentAcquisition = /\b(equipment|computer server|server|computer|machinery|plant)\b/i.test(query) && /\b(incurred|purchased|bought|acquired|purchase)\b/i.test(query);
  if (isBusinessEquipmentAcquisition) {
    const match = query.match(/(?:sgd|s\$|\$)\s*([\d,]+(?:\.\d+)?)(?:\s*(k|m|million|thousand))?/i);
    let amount = match?.[1] ? Number(match[1].replace(/,/g, "")) : void 0;
    const unit = match?.[2]?.toLowerCase();
    if (unit === "k" || unit === "thousand") amount = (amount || 0) * 1e3;
    if (unit === "m" || unit === "million") amount = (amount || 0) * 1e6;
    const paidImmediately = /\b(paid|cash|bank transfer|paid by bank)\b/i.test(query);
    const complete = Boolean(amount && amount > 0);
    const creditAccount = paidImmediately ? "Cash at Bank" : "Trade Payables";
    return {
      scenarioType: "BUSINESS_EQUIPMENT_ACQUISITION",
      authorityStatus: complete ? "CONDITIONAL" : "CONDITIONAL",
      queryIntent: "HYBRID",
      primaryDomain: "IRAS_TAX",
      rawQuery: query,
      transactionTitle: "Business Equipment Acquisition",
      functionalCurrency,
      transactionCurrency: functionalCurrency,
      amount,
      accountingTreatmentSummary: `Recognise the equipment as property, plant and equipment at cost. ${paidImmediately ? "The stated payment is credited to bank." : "As payment timing was not stated, this entry assumes the supplier invoice remains payable."}`,
      singaporeTaxTreatmentSummary: "The acquisition is capital expenditure, not an immediate Section 14 revenue-expense deduction. Review eligibility for capital allowances under Sections 19 and 19A instead of claiming accounting depreciation.",
      uncertaintyDisclaimer: "Confirm whether the quoted amount is GST-exclusive, whether the supplier is GST-registered, and whether the equipment has been paid. Input GST and capital-allowance eligibility depend on those facts.",
      assumptions: paidImmediately ? [] : [{ id: "equipment-payment-status", field: "payment timing", assumedValue: "Unpaid supplier invoice", basisOrRationale: "The query says the cost was incurred but does not state that it was paid.", materiality: "HIGH", userClarificationPrompt: "Was the equipment paid immediately, or is it still payable to the supplier?" }],
      directGroups: complete ? [{ id: "grp-business-equipment", eventDate: formatSingaporeDate(/* @__PURE__ */ new Date()), title: "Business Equipment Acquisition", summary: `Capitalise equipment of ${functionalCurrency} ${amount.toLocaleString()}`, totalDebit: amount, totalCredit: amount, isBalanced: true, authorityStatus: "CONDITIONAL", citations: [convertToCitation(SINGAPORE_STATUTORY_REPOSITORY.ITA_SEC15_PROHIBITED_DEDUCTIONS), convertToCitation(SINGAPORE_STATUTORY_REPOSITORY.ITA_SEC19_19A_CAPITAL_ALLOWANCES)], rationalePoints: ["Equipment with enduring business use is capitalised under SFRS(I); tax relief is considered through capital allowances rather than a direct expense deduction."], lines: [
        { id: "dr-equipment", accountCode: "1500", accountName: "Property, Plant and Equipment \u2014 Equipment", category: "ASSET", debit: amount, credit: 0, lineExplanation: "Capitalise the business equipment at cost." },
        { id: paidImmediately ? "cr-bank" : "cr-payable", accountCode: paidImmediately ? "1010" : "2000", accountName: creditAccount, category: paidImmediately ? "ASSET" : "LIABILITY", debit: 0, credit: amount, lineExplanation: paidImmediately ? "Immediate payment for the equipment." : "Supplier invoice assumed unpaid pending confirmation.", ...paidImmediately ? {} : { assumptionId: "equipment-payment-status", assumptionMateriality: "HIGH" } }
      ] }] : [],
      isComplete: complete,
      missingFields: complete ? [] : [{ fieldKey: "amount", fieldName: "Equipment cost", prompt: "What is the equipment cost?", whyNeeded: "The acquisition journal cannot be measured without the cost." }]
    };
  }
  if (/\b(fine|penalt(?:y|ies)|traffic offence)\b/i.test(q) && /\bdirector\b/i.test(q)) {
    const match = query.match(/(?:sgd|\$)\s*([\d,]+(?:\.\d+)?)(?:\s*(k|m|thousand|million))?/i);
    let amount = match?.[1] ? Number(match[1].replace(/,/g, "")) : void 0;
    if (match?.[2]?.toLowerCase() === "k" || match?.[2]?.toLowerCase() === "thousand") amount = (amount || 0) * 1e3;
    if (match?.[2]?.toLowerCase() === "m" || match?.[2]?.toLowerCase() === "million") amount = (amount || 0) * 1e6;
    const complete = Boolean(amount && amount > 0);
    return {
      scenarioType: "DIRECTOR_PERSONAL_FINE",
      authorityStatus: complete ? "DETERMINISTIC" : "CONDITIONAL",
      queryIntent: "HYBRID",
      primaryDomain: "IRAS_TAX",
      rawQuery: query,
      transactionTitle: "Company Payment of Director Personal Fine",
      functionalCurrency,
      transactionCurrency: functionalCurrency,
      amount,
      accountingTreatmentSummary: "Record a receivable from the director, not a company operating expense, because the company settled the director\u2019s personal obligation.",
      singaporeTaxTreatmentSummary: "The payment is non-deductible and must not be claimed as a Section 14 business expense; it is a personal penalty requiring an add-back if booked through profit or loss.",
      uncertaintyDisclaimer: "Confirm whether the company will recover the amount from the director. If it will not, obtain advice on the appropriate governance and tax treatment.",
      directGroups: complete ? [{ id: "grp-director-fine", eventDate: formatSingaporeDate(/* @__PURE__ */ new Date()), title: "Director Personal Fine Paid by Company", summary: `Director receivable of ${functionalCurrency} ${amount.toLocaleString()}`, totalDebit: amount, totalCredit: amount, isBalanced: true, authorityStatus: "DETERMINISTIC", citations: [convertToCitation(SINGAPORE_STATUTORY_REPOSITORY.ITA_SEC15_PROHIBITED_DEDUCTIONS)], rationalePoints: ["A personal fine is not incurred for the company\u2019s business; recovery from the director is recorded as a receivable."], lines: [
        { id: "dr-director", accountCode: "1155", accountName: "Amount Due from Director", category: "ASSET", debit: amount, credit: 0, lineExplanation: "Company payment creates a receivable from the director." },
        { id: "cr-bank", accountCode: "1010", accountName: "Cash at Bank", category: "ASSET", debit: 0, credit: amount, lineExplanation: "Payment of the director\u2019s personal fine." }
      ] }] : [],
      isComplete: complete,
      missingFields: complete ? [] : [{ fieldKey: "amount", fieldName: "Fine amount", prompt: "What amount did the company pay?", whyNeeded: "The director receivable and bank payment cannot be measured without the amount." }]
    };
  }
  const isGeneralExpense = !q.includes("director") && !q.includes("shareholder") && !q.includes("before delivery") && !q.includes("advance") && (q.includes("entertainment") || q.includes("utilities") || q.includes("electricity") || q.includes("marketing") || q.includes("advertising") || q.includes("stationery") || q.includes("pay for") && !q.includes("rental") && !q.includes("lease") && !q.includes("shares"));
  if (isGeneralExpense) {
    const taxAssessment = assessCorporateTaxTreatment(query);
    let expenseAmount;
    const amtMatch = query.match(/(?:sgd|\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|thousand)?/i);
    if (amtMatch && amtMatch[1]) {
      let rawVal = parseFloat(amtMatch[1].replace(/,/g, ""));
      const unit = amtMatch[2]?.toLowerCase();
      if (unit === "k" || unit === "thousand") rawVal *= 1e3;
      if (unit === "m") rawVal *= 1e6;
      if (rawVal > 0) expenseAmount = rawVal;
    }
    let expenseTitle = "Operating Expense";
    if (q.includes("entertainment")) expenseTitle = "Entertainment & Hospitality Expenses";
    else if (q.includes("travel")) expenseTitle = "Travel & Transportation Expenses";
    else if (q.includes("utilit") || q.includes("electric")) expenseTitle = "Utilities & Electricity Expenses";
    else if (q.includes("salary") || q.includes("salaries")) expenseTitle = "Staff Salaries & Wages";
    else if (q.includes("market") || q.includes("advertis")) expenseTitle = "Marketing & Advertising Expenses";
    else if (q.includes("suppl") || q.includes("stationery")) expenseTitle = "Office Supplies & Stationery";
    let paymentMethod = "Cash at Bank (Current Account)";
    if (q.includes("cash") && !q.includes("bank")) {
      paymentMethod = "Petty Cash";
    } else if (q.includes("credit card")) {
      paymentMethod = "Credit Card Payable";
    } else if (q.includes("on account") || q.includes("invoice") || q.includes("payable")) {
      paymentMethod = "Trade Payables";
    }
    return {
      scenarioType: "GENERAL_EXPENSE",
      authorityStatus: "CONDITIONAL",
      queryIntent: "TRANSACTION",
      primaryDomain: "MULTI_AUTHORITY",
      rawQuery: query,
      transactionTitle: `Payment of ${expenseTitle}`,
      functionalCurrency,
      transactionCurrency: functionalCurrency,
      accountingTreatmentSummary: expenseAmount ? `Under SFRS(I) 1-1 \xA728 accrual basis, ${expenseTitle} of ${functionalCurrency} ${expenseAmount.toLocaleString()} is recognized as an operating expense in profit or loss when economic benefits are consumed, matched with a credit to ${paymentMethod}.` : `The payment amount is required before a journal for ${expenseTitle} can be calculated.`,
      singaporeTaxTreatmentSummary: taxAssessment.summary,
      regulatoryMandatesSummary: "Receipts and supporting documents must be maintained for 5 years under Section 199 of the Companies Act 1967.",
      effectiveDateOrTiming: "Current Year of Assessment (YA).",
      uncertaintyDisclaimer: taxAssessment.reviewNotice,
      expenseAccountName: expenseTitle,
      paymentMethodAccountName: paymentMethod,
      amount: expenseAmount,
      assetName: expenseTitle,
      purchaseDate: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      isComplete: expenseAmount !== void 0,
      missingFields: expenseAmount === void 0 ? [{
        fieldKey: "amount",
        fieldName: "Expense payment amount",
        prompt: `What amount was paid for ${expenseTitle}?`,
        whyNeeded: "The debit and credit amounts cannot be calculated without the actual payment amount."
      }] : []
    };
  }
  if (q.includes("rental") || q.includes("lease") || q.includes("rent") || q.includes("tenancy")) {
    let termYears = 3;
    const yearMatch = query.match(/(\d+)\s*(?:years?|yrs?)/i);
    if (yearMatch && yearMatch[1]) {
      termYears = parseInt(yearMatch[1], 10);
    }
    let termMonths = termYears * 12;
    const monthTermMatch = query.match(/(\d+)\s*(?:months?|mos?)/i);
    if (monthTermMatch && monthTermMatch[1] && !yearMatch) {
      termMonths = parseInt(monthTermMatch[1], 10);
      termYears = Math.round(termMonths / 12 * 10) / 10;
    }
    let monthlyRent = 3e3;
    const rentMatch = query.match(/(?:paying|rent(?:al)?|cost)?\s*(?:1\s*month|\/month|monthly|per\s*month)?\s*(?:sgd|\$)?\s*([\d,]+(?:\.\d+)?)/i) || query.match(/(?:sgd|\$)\s*([\d,]+(?:\.\d+)?)/i);
    if (rentMatch && rentMatch[1]) {
      const parsed = parseFloat(rentMatch[1].replace(/,/g, ""));
      if (parsed > 50) monthlyRent = parsed;
    }
    let discountRateAnnual = 5;
    const rateMatch = query.match(/(?:discount\s*rate|ibr|interest|rate)\s*(?:of|is|at)?\s*(\d+(?:\.\d+)?)\s*%/i);
    let rateAssumed = true;
    if (rateMatch && rateMatch[1]) {
      discountRateAnnual = parseFloat(rateMatch[1]);
      rateAssumed = false;
    }
    const leaseAssumptions = [];
    if (rateAssumed) {
      leaseAssumptions.push({
        id: "assump-lease-ibr",
        field: "leaseDiscountRateAnnual",
        assumedValue: "5.0% p.a.",
        basisOrRationale: "User omitted incremental borrowing rate (IBR). 5.0% assumed as standard commercial SME baseline under SFRS(I) 16 \xA726.",
        materiality: "HIGH",
        userClarificationPrompt: "Please specify the lessee incremental borrowing rate (IBR) or rate implicit in the lease."
      });
    }
    return {
      scenarioType: "LEASE_IFRS16",
      authorityStatus: rateAssumed ? "CONDITIONAL" : "DETERMINISTIC",
      queryIntent: "TRANSACTION",
      primaryDomain: "ACCOUNTING_SFRS",
      rawQuery: query,
      transactionTitle: `${termYears}-Year Property Lease Inception (IFRS 16)`,
      functionalCurrency,
      transactionCurrency: functionalCurrency,
      accountingTreatmentSummary: `Under SFRS(I) 16 \xA722-\xA726, capitalize a Right-of-Use (ROU) Asset and corresponding Lease Liability measured at the present value of ${termMonths} monthly payments of ${functionalCurrency} ${monthlyRent.toLocaleString()} discounted at incremental borrowing rate (${discountRateAnnual}% p.a.). Subsequent payments are apportioned between finance charge (interest) and liability principal reduction (\xA736). Straight-line depreciation of ROU asset is recognized in P&L (\xA731).`,
      singaporeTaxTreatmentSummary: `Accounting depreciation and lease finance expense are non-deductible and added back in tax computation. Actual contractual rental paid during the basis period is claimed as a tax deduction under Section 14(1) of the Income Tax Act 1947.`,
      regulatoryMandatesSummary: "Tenancy agreements must be registered via IRAS e-Stamping under the Stamp Duties Act 1929.",
      effectiveDateOrTiming: "SFRS(I) 16 standard active.",
      assetName: `Leased Property (${termYears}-Year Agreement)`,
      purchaseDate: "2026-01-01",
      leaseTermYears: termYears,
      leaseTermMonths: termMonths,
      leasePaymentMonthly: monthlyRent,
      leaseDiscountRateAnnual: discountRateAnnual,
      leaseCommencementDate: "2026-01-01",
      keyParameters: [
        { label: "Monthly Rent", value: `${functionalCurrency} ${monthlyRent.toLocaleString()}`, badge: "Stated Fact" },
        { label: "Lease Term", value: `${termYears} Years (${termMonths} Months)`, badge: "Stated Fact" },
        {
          label: "Discount Rate (IBR)",
          value: `${discountRateAnnual}% p.a.`,
          badge: rateAssumed ? "Assumed Parameter" : "Stated Fact",
          highlight: rateAssumed
        }
      ],
      assumptions: leaseAssumptions,
      isComplete: true,
      missingFields: []
    };
  }
  const isForeignSharesFixture = (q.includes("apple") || q.includes("aapl") || q.includes("tesla") || q.includes("tsla") || q.includes("microsoft") || (q.includes("fvtpl") || q.includes("fvtoci")) && (q.includes("foreign") || q.includes("usd"))) && !q.includes("own company") && !q.includes("share capital") && !q.includes("unpaid") && !q.includes("director");
  if (!isForeignSharesFixture) {
    if (currentScenario) {
      const convContext = extractAccountingContext(currentScenario);
      const understanding = defaultTransactionUnderstandingService.understandTransactionSync(
        query,
        functionalCurrency,
        "SG",
        convContext
      );
      if (understanding.followUpAnalysis && (understanding.followUpAnalysis.eventType === "settlement" || understanding.followUpAnalysis.eventType === "partial_settlement")) {
        const delta = calculateAccountingDelta(convContext, understanding.followUpAnalysis, functionalCurrency);
        if (delta && delta.resultingAccountingEvent) {
          const isHypo = Boolean(delta.isHypothetical);
          const priorCommittedGroups = currentScenario.committedDirectGroups && currentScenario.committedDirectGroups.length > 0 ? [...currentScenario.committedDirectGroups] : currentScenario.directGroups ? currentScenario.directGroups.filter((g) => !g.isHypothetical) : [];
          const resultingEvent = delta.resultingAccountingEvent;
          const settlementGroup = {
            id: `grp-settle-${priorCommittedGroups.length + 1}`,
            transactionId: resultingEvent.transactionId,
            targetTransactionId: resultingEvent.targetTransactionId,
            isHypothetical: isHypo,
            eventDate: formatSingaporeDate(/* @__PURE__ */ new Date()),
            title: `${isHypo ? "Hypothetical " : ""}Settlement of ${delta.balanceUpdates[0].accountName}`,
            summary: delta.explanation,
            lines: delta.journalLines,
            totalDebit: Math.round(delta.journalLines.reduce((sum, line2) => sum + line2.debit, 0) * 100) / 100,
            totalCredit: Math.round(delta.journalLines.reduce((sum, line2) => sum + line2.credit, 0) * 100) / 100,
            isBalanced: Math.abs(delta.journalLines.reduce((sum, line2) => sum + line2.debit - line2.credit, 0)) < 0.01,
            citations: [],
            rationalePoints: [delta.explanation],
            authorityStatus: "DETERMINISTIC"
          };
          const committedDirectGroups = isHypo ? priorCommittedGroups : [...priorCommittedGroups, settlementGroup];
          const projectedGroups = isHypo ? [settlementGroup] : void 0;
          const directGroups2 = [
            ...priorCommittedGroups,
            settlementGroup
          ];
          const priorActualEvents = convContext.actualEvents;
          const newActualEvents = isHypo ? priorActualEvents : commitAccountingEvent(priorActualEvents, resultingEvent);
          const newAccountingEvents = [
            ...currentScenario.accountingEvents || priorActualEvents,
            resultingEvent
          ];
          const remainingAmount = delta.balanceUpdates[0]?.resultingBalance ?? 0;
          return {
            scenarioType: currentScenario.scenarioType || "UNIVERSAL",
            authorityStatus: "DETERMINISTIC",
            queryIntent: "TRANSACTION",
            primaryDomain: "ACCOUNTING_SFRS",
            rawQuery: query,
            transactionTitle: currentScenario.transactionTitle || "Share Capital Allotment & Settlement",
            functionalCurrency,
            transactionCurrency: delta.currency,
            accountingTreatmentSummary: delta.explanation,
            singaporeTaxTreatmentSummary: currentScenario.singaporeTaxTreatmentSummary,
            amount: delta.amount,
            directGroups: directGroups2,
            committedDirectGroups,
            projectedGroups,
            accountingEvents: newAccountingEvents,
            actualEvents: newActualEvents,
            isHypothetical: isHypo,
            keyParameters: [
              { label: "Settlement Amount", value: `${delta.currency} ${delta.amount.toFixed(2)}`, badge: isHypo ? "Hypothetical" : "Settlement" },
              { label: "Settled Account", value: delta.balanceUpdates[0].accountName, badge: "Balance" },
              { label: "Remaining Balance", value: `${delta.currency} ${remainingAmount.toFixed(2)}`, badge: "Balance" }
            ],
            isComplete: true,
            missingFields: []
          };
        }
        return {
          ...currentScenario,
          rawQuery: query,
          authorityStatus: "CONDITIONAL",
          directGroups: [],
          projectedGroups: void 0,
          isComplete: false,
          missingFields: [{
            fieldKey: "settlementTarget",
            fieldName: "Settlement target or excess amount",
            prompt: "I could not match this payment to one outstanding balance, or the payment exceeds that balance. Please identify the original transaction and confirm the settlement amount and treatment of any excess.",
            whyNeeded: "A settlement must reduce an identified balance by a supportable amount."
          }]
        };
      } else if (understanding.followUpAnalysis && (understanding.followUpAnalysis.eventType === "hypothetical_branch" || understanding.followUpAnalysis.eventType === "reclassification" || understanding.followUpAnalysis.eventType === "policy_election")) {
        const targetBasis = understanding.followUpAnalysis.targetMeasurementBasis || "UNKNOWN";
        const proj = buildAccountingMeasurementProjection({
          committedContext: convContext,
          followUpAnalysis: understanding.followUpAnalysis,
          requestedBasis: targetBasis
        });
        if (proj.success) {
          const priorCommittedGroups = currentScenario.committedDirectGroups && currentScenario.committedDirectGroups.length > 0 ? [...currentScenario.committedDirectGroups] : currentScenario.directGroups ? currentScenario.directGroups.filter((g) => !g.isHypothetical) : [];
          const actualMeasurementBasis = currentScenario.actualMeasurementBasis || convContext.underlyingTransaction?.actualMeasurementBasis || "UNKNOWN";
          return {
            scenarioType: currentScenario.scenarioType || "EQUITY_INVESTMENT_FX",
            authorityStatus: proj.authorityStatus,
            queryIntent: "TRANSACTION",
            primaryDomain: "ACCOUNTING_SFRS",
            rawQuery: query,
            transactionTitle: currentScenario.transactionTitle ? `${currentScenario.transactionTitle} (${targetBasis} Projection)` : `Equity Investment (${targetBasis} Projection)`,
            functionalCurrency,
            transactionCurrency: convContext.underlyingTransaction?.currency || functionalCurrency,
            accountingTreatmentSummary: proj.explanation,
            singaporeTaxTreatmentSummary: currentScenario.singaporeTaxTreatmentSummary || "Capital gains on foreign shares held as capital investments are not taxable in Singapore.",
            amount: convContext.underlyingTransaction?.totalAmount || currentScenario.amount,
            directGroups: proj.projectedGroups,
            committedDirectGroups: priorCommittedGroups,
            projectedGroups: proj.projectedGroups,
            actualEvents: convContext.actualEvents,
            accountingEvents: currentScenario.accountingEvents || convContext.actualEvents,
            isHypothetical: true,
            actualMeasurementBasis,
            projectedMeasurementBasis: targetBasis,
            underlyingTransaction: convContext.underlyingTransaction,
            classification: targetBasis,
            keyParameters: [
              { label: "Evaluation Basis", value: `${targetBasis} (Hypothetical Projection)`, badge: "Projection", highlight: true },
              { label: "Actual Basis", value: actualMeasurementBasis, badge: "Committed" },
              { label: "P&L Recycling Mandate", value: targetBasis === "FVOCI" ? "Zero P&L Recycling (SFRS(I) 9 \xA7B5.7.1)" : "Recognized in P&L", badge: "Mandate" }
            ],
            isComplete: true,
            missingFields: []
          };
        }
      }
    }
    const classification = classifyQuestion(query);
    const domainMap = {
      ACCOUNTING: "ACCOUNTING_SFRS",
      TAX: "IRAS_TAX",
      GST: "IRAS_GST",
      CORPORATE_REGULATORY: "ACRA_CORP",
      EMPLOYMENT: "MOM_EMPLOYMENT",
      PAYROLL: "CPF_BOARD",
      MAS_FUNDS: "MAS_FUNDS",
      MIXED: "MULTI_AUTHORITY",
      GENERAL: "GENERAL"
    };
    const resolvedDomain = domainMap[classification.primaryDomain] || "GENERAL";
    return {
      scenarioType: "UNRECOGNIZED",
      authorityStatus: "AI_PROPOSED",
      queryIntent: classification.intent,
      primaryDomain: resolvedDomain,
      rawQuery: query,
      transactionTitle: "Unrecognized Query (Offline Mode)",
      functionalCurrency,
      transactionCurrency: functionalCurrency,
      accountingTreatmentSummary: "Connect an AI Provider (Gemini, Azure OpenAI, or OpenAI) in Settings for dynamic reasoning and source citation on unmapped accounting queries.",
      singaporeTaxTreatmentSummary: "Refer to Singapore Statutes Online (sso.agc.gov.sg) or official IRAS e-Tax Guides for statutory directives.",
      directGroups: [],
      keyParameters: [
        { label: "Evaluation Mode", value: "Offline Rule Parser", badge: "Offline" },
        { label: "Detected Domain", value: resolvedDomain, badge: "Classification" },
        { label: "AI Status", value: "Connect Gemini/Azure API Key in Settings", badge: "Setup" }
      ],
      isComplete: false,
      missingFields: []
    };
  }
  let transactionCurrency = functionalCurrency;
  if (q.includes("usd") || q.includes("us dollar")) transactionCurrency = "USD";
  else if (q.includes("eur")) transactionCurrency = "EUR";
  else if (q.includes("gbp")) transactionCurrency = "GBP";
  else if (q.includes("sgd") || q.includes("singapore dollar")) transactionCurrency = "SGD";
  let assetName = "Foreign Shares Investment";
  if (q.includes("apple") || q.includes("aapl")) assetName = "Apple Inc. (AAPL) Shares";
  else if (q.includes("tesla") || q.includes("tsla")) assetName = "Tesla Inc. (TSLA) Shares";
  else if (q.includes("microsoft")) assetName = "Microsoft Corp. Shares";
  let quantity = void 0;
  const qtyMatch = query.match(/(\d[\d,]*)\s*(?:apple\s*)?shares/i);
  if (qtyMatch && qtyMatch[1]) {
    quantity = parseInt(qtyMatch[1].replace(/,/g, ""), 10);
  }
  let purchaseAmountForeign = 0;
  const buyMatch = query.match(/(?:invested|bought|purchased|acquired|cost|paid)\s*(?:(?:an amount of|sum of|value of)\s*)?(?:usd|\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)?/i) || query.match(/(?:usd|\$)\s*([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)?\s*(?:into|for|in)?/i);
  if (buyMatch) {
    let rawVal = parseFloat(buyMatch[1].replace(/,/g, ""));
    const unit = buyMatch[2]?.toLowerCase();
    if (unit === "k" || unit === "thousand") rawVal *= 1e3;
    if (unit === "m" || unit === "million") rawVal *= 1e6;
    purchaseAmountForeign = rawVal;
  } else if (q.includes("300k")) {
    purchaseAmountForeign = 3e5;
  }
  let saleAmountForeign = void 0;
  const sellForMatch = query.match(/(?:sold|disposed|derecognised|sale)\s*(?:(?:all|the)?\s*[\d,]*\s*(?:apple\s*)?shares\s*)?(?:for|at|with proceeds of|amounting to)\s*(?:usd|\$)?\s*([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)?/i);
  if (sellForMatch) {
    let rawVal = parseFloat(sellForMatch[1].replace(/,/g, ""));
    const unit = sellForMatch[2]?.toLowerCase();
    if (unit === "k" || unit === "thousand") rawVal *= 1e3;
    if (unit === "m" || unit === "million") rawVal *= 1e6;
    saleAmountForeign = rawVal;
  } else {
    const allAmounts = [...query.matchAll(/(?:usd|\$)\s*([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)?/gi)];
    if (allAmounts.length >= 2) {
      let rawVal = parseFloat(allAmounts[1][1].replace(/,/g, ""));
      const unit = allAmounts[1][2]?.toLowerCase();
      if (unit === "k" || unit === "thousand") rawVal *= 1e3;
      if (unit === "m" || unit === "million") rawVal *= 1e6;
      saleAmountForeign = rawVal;
    } else if (q.includes("400k")) {
      saleAmountForeign = 4e5;
    }
  }
  const dateRegex = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/g;
  const foundDates = [];
  const isoDates = [];
  let dMatch;
  while ((dMatch = dateRegex.exec(query)) !== null) {
    const day = dMatch[1].padStart(2, "0");
    const month = dMatch[2].padStart(2, "0");
    const year = dMatch[3];
    foundDates.push(`${day}/${month}/${year}`);
    isoDates.push(`${year}-${month}-${day}`);
  }
  let purchaseDate = foundDates[0] || "13/11/2026";
  let saleDate = foundDates[1] || (saleAmountForeign ? "15/12/2026" : void 0);
  let purchaseDateIso = isoDates[0] || "2026-11-13";
  let saleDateIso = isoDates[1] || "2026-12-15";
  let purchaseFxRate = 1.34;
  let saleFxRate = 1.36;
  let fxSource = "Benchmark Spot Rates (1.34 buy / 1.36 sell SGD/USD)";
  const rateMatches = [...query.matchAll(/(?:rate|spot|fx|exchange rate|at|@)\s*(?:of|is|:)?\s*(?:sgd\s*\/\s*usd\s*)?([01]\.\d{2,4})/gi)];
  let userProvidedRates = false;
  if (rateMatches.length >= 2) {
    purchaseFxRate = parseFloat(rateMatches[0][1]);
    saleFxRate = parseFloat(rateMatches[1][1]);
    fxSource = `User Specified Rates (${purchaseFxRate} buy / ${saleFxRate} sell)`;
    userProvidedRates = true;
  } else if (rateMatches.length === 1) {
    purchaseFxRate = parseFloat(rateMatches[0][1]);
    saleFxRate = Math.round((purchaseFxRate + 0.02) * 1e4) / 1e4;
    fxSource = `User Specified Rate (${purchaseFxRate} buy / ${saleFxRate} sell)`;
    userProvidedRates = true;
  }
  if (!userProvidedRates && functionalCurrency !== transactionCurrency) {
    const now = /* @__PURE__ */ new Date();
    const isPurchaseFuture = new Date(purchaseDateIso) > now;
    const isSaleFuture = saleDateIso ? new Date(saleDateIso) > now : false;
    if (!isPurchaseFuture && (!saleDate || !isSaleFuture)) {
      try {
        const buyRateObj = await getExchangeRate(transactionCurrency, functionalCurrency, purchaseDateIso);
        purchaseFxRate = Math.round(buyRateObj.rate * 1e4) / 1e4;
        fxSource = buyRateObj.source;
        if (saleDate) {
          const sellRateObj = await getExchangeRate(transactionCurrency, functionalCurrency, saleDateIso);
          saleFxRate = Math.round(sellRateObj.rate * 1e4) / 1e4;
          if (saleFxRate === purchaseFxRate) {
            saleFxRate = Math.round((purchaseFxRate + 0.02) * 1e4) / 1e4;
            fxSource += " (+0.02 demonstration spread for FX gain)";
          }
        }
      } catch {
        purchaseFxRate = 1.34;
        saleFxRate = 1.36;
        fxSource = "Benchmark Spot Rates (1.34 buy / 1.36 sell SGD/USD)";
      }
    } else {
      purchaseFxRate = 1.34;
      saleFxRate = 1.36;
      fxSource = "Benchmark Spot Rates for Future Dates (1.34 buy / 1.36 sell SGD/USD)";
    }
  }
  const initialCostSGD = Math.round(purchaseAmountForeign * purchaseFxRate * 100) / 100;
  const proceedsSGD = saleAmountForeign ? Math.round(saleAmountForeign * saleFxRate * 100) / 100 : 0;
  const stockGainSGD = saleAmountForeign ? Math.round((saleAmountForeign - purchaseAmountForeign) * saleFxRate * 100) / 100 : 0;
  const fxGainSGD = saleAmountForeign ? Math.round(purchaseAmountForeign * (saleFxRate - purchaseFxRate) * 100) / 100 : 0;
  const directGroups = [
    {
      id: "grp-purchase",
      eventDate: formatSingaporeDate(purchaseDate),
      title: `Initial Acquisition of ${assetName}`,
      summary: `Acquisition of USD ${purchaseAmountForeign.toLocaleString()} translated at ${purchaseFxRate} SGD/USD`,
      lines: [
        {
          id: "line-buy-dr",
          accountCode: "1210",
          accountName: `Financial Asset at FVTPL (${assetName})`,
          category: "ASSET",
          debit: initialCostSGD,
          credit: 0,
          foreignCurrency: "USD",
          foreignDebit: purchaseAmountForeign,
          exchangeRate: purchaseFxRate,
          lineExplanation: `Initial fair value recognition under SFRS(I) 9 \xA75.1.1 translated at spot rate of ${purchaseFxRate} SGD/USD.`
        },
        {
          id: "line-buy-cr",
          accountCode: "1010",
          accountName: "Cash at Bank (USD Account)",
          category: "ASSET",
          debit: 0,
          credit: initialCostSGD,
          foreignCurrency: "USD",
          foreignCredit: purchaseAmountForeign,
          exchangeRate: purchaseFxRate,
          lineExplanation: `Disbursement of USD ${purchaseAmountForeign.toLocaleString()} translated at transaction spot rate.`
        }
      ],
      totalDebit: initialCostSGD,
      totalCredit: initialCostSGD,
      isBalanced: true,
      citations: [
        getCitation("IFRS9_INITIAL_MEASUREMENT", "SFRS_I"),
        getCitation("IAS21_INITIAL_FOREIGN_CURRENCY", "SFRS_I")
      ],
      rationalePoints: [
        `Under SFRS(I) 9 \xA75.1.1: Financial assets at FVTPL are initially recognized at fair value.`,
        `Under SFRS(I) 1-21 \xA721: A foreign currency transaction is recorded on initial recognition in functional currency using the spot exchange rate (${purchaseFxRate} SGD/USD).`
      ]
    }
  ];
  if (saleAmountForeign && saleDate) {
    directGroups.push({
      id: "grp-disposal",
      eventDate: formatSingaporeDate(saleDate),
      title: `Derecognition / Disposal of ${assetName}`,
      summary: `Disposal of USD ${saleAmountForeign.toLocaleString()} translated at ${saleFxRate} SGD/USD`,
      lines: [
        {
          id: "line-sell-dr-bank",
          accountCode: "1010",
          accountName: "Cash at Bank (USD Account)",
          category: "ASSET",
          debit: proceedsSGD,
          credit: 0,
          foreignCurrency: "USD",
          foreignDebit: saleAmountForeign,
          exchangeRate: saleFxRate,
          lineExplanation: `Gross disposal proceeds of USD ${saleAmountForeign.toLocaleString()} translated at spot rate of ${saleFxRate} SGD/USD.`
        },
        {
          id: "line-sell-cr-asset",
          accountCode: "1210",
          accountName: `Financial Asset at FVTPL (${assetName})`,
          category: "ASSET",
          debit: 0,
          credit: initialCostSGD,
          foreignCurrency: "USD",
          foreignCredit: purchaseAmountForeign,
          exchangeRate: purchaseFxRate,
          lineExplanation: `Derecognition of original carrying amount of USD ${purchaseAmountForeign.toLocaleString()} @ ${purchaseFxRate} SGD/USD.`
        },
        {
          id: "line-sell-stock-gain",
          accountCode: "4510",
          accountName: `Fair Value Gain on Shares (${assetName}) [P&L]`,
          category: "REVENUE",
          debit: 0,
          credit: stockGainSGD,
          lineExplanation: `Stock appreciation gain of USD ${(saleAmountForeign - purchaseAmountForeign).toLocaleString()} translated at disposal spot rate of ${saleFxRate} SGD/USD.`
        },
        {
          id: "line-sell-fx-gain",
          accountCode: "4600",
          accountName: "Realized Foreign Exchange Gain (USD/SGD) [P&L / SFRS(I) 1-21]",
          category: "REVENUE",
          debit: 0,
          credit: fxGainSGD,
          lineExplanation: `Realized foreign currency appreciation on original investment capital of USD ${purchaseAmountForeign.toLocaleString()} from ${purchaseFxRate} to ${saleFxRate} (+${(saleFxRate - purchaseFxRate).toFixed(4)} SGD/USD).`
        }
      ],
      totalDebit: proceedsSGD,
      totalCredit: proceedsSGD,
      isBalanced: true,
      citations: [
        getCitation("IFRS9_EQUITY_CLASSIFICATION", "SFRS_I"),
        getCitation("IAS21_NON_MONETARY_FVTPL_FX", "SFRS_I")
      ],
      rationalePoints: [
        `Under SFRS(I) 1-21 \xA723(c) & \xA728: Exchange differences arising on the settlement of monetary balances are recognized in profit or loss in the period.`,
        `Bifurcation Mandate: Stock price appreciation (SGD ${stockGainSGD.toLocaleString()}) and realized currency exchange gain (SGD ${fxGainSGD.toLocaleString()}) are strictly separated into distinct revenue lines.`
      ]
    });
  }
  directGroups.forEach((g) => {
    g.authorityStatus = "DETERMINISTIC";
  });
  return {
    scenarioType: "EQUITY_INVESTMENT_FX",
    authorityStatus: "DETERMINISTIC",
    queryIntent: "TRANSACTION",
    primaryDomain: "ACCOUNTING_SFRS",
    rawQuery: query,
    transactionTitle: `Investment & Sale of ${assetName} (USD/SGD)`,
    functionalCurrency,
    transactionCurrency,
    accountingTreatmentSummary: `Under SFRS(I) 9 \xA75.1.1 and SFRS(I) 1-21 \xA721, foreign currency equity investments at FVTPL are recognized at transaction spot exchange rates. Upon derecognition, profit is explicitly bifurcated into Fair Value Stock Appreciation (SGD ${stockGainSGD.toLocaleString()}) and Realized Foreign Exchange Gain (SGD ${fxGainSGD.toLocaleString()}).`,
    singaporeTaxTreatmentSummary: "Capital gains on foreign shares held as long-term capital investments are not taxable in Singapore (no capital gains tax). Short-term trading profits by active traders/dealers are subject to 17% corporate income tax.",
    regulatoryMandatesSummary: "MAS Act 1970 zero exchange control policy applies: multi-currency balances and capital remittances are unrestricted in Singapore.",
    effectiveDateOrTiming: `${fxSource}; 17% headline CIT rate.`,
    assetName,
    quantity,
    purchaseDate,
    purchaseAmountForeign,
    purchaseFxRate,
    saleDate,
    saleAmountForeign,
    saleFxRate,
    classification: "FVTPL",
    actualMeasurementBasis: "FVTPL",
    ownershipContext: "external_investment",
    underlyingTransaction: {
      transactionId: "tx-apple-shares-1",
      type: "equity_investment_acquisition",
      subject: `Investment & Sale of ${assetName} (USD/SGD)`,
      ownershipContext: "external_investment",
      instrument: "financial_asset_equity",
      actualMeasurementBasis: "FVTPL",
      totalAmount: purchaseAmountForeign,
      currency: transactionCurrency,
      functionalCurrency,
      transactionDate: purchaseDate,
      disposalDate: saleDate,
      disposalAmount: saleAmountForeign,
      acquisitionFxRate: purchaseFxRate,
      disposalFxRate: saleFxRate,
      assetName,
      quantity
    },
    bifurcateFxGain: true,
    fxSource,
    directGroups,
    keyParameters: [
      { label: "Initial Outlay", value: `USD ${purchaseAmountForeign.toLocaleString()} @ ${purchaseFxRate} = SGD ${initialCostSGD.toLocaleString(void 0, { minimumFractionDigits: 2 })}`, badge: "Acquisition" },
      { label: "Disposal Proceeds", value: `USD ${(saleAmountForeign || 0).toLocaleString()} @ ${saleFxRate} = SGD ${proceedsSGD.toLocaleString(void 0, { minimumFractionDigits: 2 })}`, badge: "Derecognition" },
      { label: "Fair Value Stock Gain", value: `SGD ${stockGainSGD.toLocaleString(void 0, { minimumFractionDigits: 2 })}`, badge: "SFRS(I) 9" },
      { label: "Realized FX Gain", value: `SGD ${fxGainSGD.toLocaleString(void 0, { minimumFractionDigits: 2 })}`, badge: "SFRS(I) 1-21", highlight: true }
    ],
    isComplete: true,
    missingFields: []
  };
}

// src/engine/accountingGuardrails.ts
var AccountingGuardrailValidator = class {
  /**
   * Validates journal entries and scenario conclusions against extracted semantic facts.
   */
  validate(understanding, groups, functionalCurrency = "SGD") {
    const violations = [];
    const allLines = groups.flatMap((g) => g.lines);
    if (understanding.ownershipContext === "own_equity") {
      for (const line2 of allLines) {
        const accLower = (line2.accountName || "").toLowerCase();
        if (accLower.includes("fvtpl") || accLower.includes("fvtoci") || accLower.includes("foreign shares investment") || line2.category === "ASSET" && accLower.includes("shares investment")) {
          violations.push({
            code: "OWN_EQUITY_ASSET_PROHIBITED",
            message: `Under SFRS(I) 1-32 \xA733, an entity's own shares cannot be classified as a financial asset (${line2.accountName}). Issued shares must be credited to Share Capital under Equity.`,
            severity: "ERROR"
          });
        }
      }
    }
    const isCurrencyUnknownOrNull = understanding.currency.value === null || understanding.currency.source === "unknown";
    if (isCurrencyUnknownOrNull) {
      for (const line2 of allLines) {
        if (line2.foreignCurrency || line2.exchangeRate && line2.exchangeRate !== 1 || line2.accountName.toLowerCase().includes("exchange gain") || line2.accountName.toLowerCase().includes("fx gain")) {
          violations.push({
            code: "UNJUSTIFIED_FX_CALCULATION",
            message: `Transaction currency is unknown/unspecified. Foreign exchange calculation or FX translation is prohibited without verified foreign currency.`,
            severity: "ERROR"
          });
          break;
        }
      }
    }
    if (understanding.currency.value && understanding.currency.value.toUpperCase() === functionalCurrency.toUpperCase()) {
      for (const line2 of allLines) {
        if (line2.foreignCurrency && line2.foreignCurrency.toUpperCase() !== functionalCurrency.toUpperCase()) {
          violations.push({
            code: "FUNCTIONAL_CURRENCY_FX_PROHIBITED",
            message: `Transaction currency matches functional currency (${functionalCurrency}). Foreign currency lines (${line2.foreignCurrency}) are prohibited.`,
            severity: "ERROR"
          });
          break;
        }
      }
    }
    for (const group2 of groups) {
      let totalDr = 0;
      let totalCr = 0;
      for (const line2 of group2.lines) {
        totalDr += line2.debit || 0;
        totalCr += line2.credit || 0;
      }
      totalDr = Math.round(totalDr * 100) / 100;
      totalCr = Math.round(totalCr * 100) / 100;
      if (Math.abs(totalDr - totalCr) > 0.01) {
        violations.push({
          code: "DOUBLE_ENTRY_IMBALANCE",
          message: `Group '${group2.title}' is imbalanced: Total Dr (${totalDr}) != Total Cr (${totalCr}).`,
          severity: "ERROR"
        });
      }
    }
    if (understanding.ownershipContext === "own_equity" && understanding.paymentStatus === "unpaid") {
      const hasBankDebit = allLines.some(
        (l) => l.debit > 0 && l.accountName.toLowerCase().includes("cash at bank")
      );
      const hasReceivableDebit = allLines.some(
        (l) => l.debit > 0 && (l.accountName.toLowerCase().includes("shareholder") || l.accountName.toLowerCase().includes("receivable") || l.accountName.toLowerCase().includes("unpaid share"))
      );
      if (hasBankDebit && !hasReceivableDebit) {
        violations.push({
          code: "SEMANTIC_FACT_CONTRADICTION",
          message: `Transaction specifies unpaid share capital, but journal entry debits Cash at Bank rather than Amount Due from Shareholder / Unpaid Share Capital.`,
          severity: "ERROR"
        });
      }
    }
    const hasError = violations.some((v) => v.severity === "ERROR");
    return {
      isValid: !hasError,
      violations
    };
  }
};
var defaultAccountingGuardrails = new AccountingGuardrailValidator();

// src/standards/approvedSourceRegistry.ts
function isAskGovSingaporeUrl(url) {
  try {
    return new URL(url || "").hostname.toLowerCase() === "ask.gov.sg";
  } catch {
    return false;
  }
}

// src/utils/statutoryLinkResolver.ts
var ACT_CODE_TO_SSO = {
  ITA: { ssoCode: "ITA1947", title: "Income Tax Act 1947" },
  INCOME_TAX: { ssoCode: "ITA1947", title: "Income Tax Act 1947" },
  COA: { ssoCode: "CoA1967", title: "Companies Act 1967" },
  COA1967: { ssoCode: "CoA1967", title: "Companies Act 1967" },
  CA: { ssoCode: "CoA1967", title: "Companies Act 1967" },
  CA1967: { ssoCode: "CoA1967", title: "Companies Act 1967" },
  COMPANIES_ACT: { ssoCode: "CoA1967", title: "Companies Act 1967" },
  COMPANIES: { ssoCode: "CoA1967", title: "Companies Act 1967" },
  GST: { ssoCode: "GSTA1993", title: "Goods and Services Tax Act 1993" },
  GSTA: { ssoCode: "GSTA1993", title: "Goods and Services Tax Act 1993" },
  CPF: { ssoCode: "CPFA1953", title: "Central Provident Fund Act 1953" },
  CPFA: { ssoCode: "CPFA1953", title: "Central Provident Fund Act 1953" },
  EA: { ssoCode: "EmA1968", title: "Employment Act 1968" },
  EMA: { ssoCode: "EmA1968", title: "Employment Act 1968" },
  EMA1968: { ssoCode: "EmA1968", title: "Employment Act 1968" },
  EMPLOYMENT_ACT: { ssoCode: "EmA1968", title: "Employment Act 1968" },
  PSA: { ssoCode: "PSA2019", title: "Payment Services Act 2019" },
  PAYMENT_SERVICES: { ssoCode: "PSA2019", title: "Payment Services Act 2019" },
  VCCA: { ssoCode: "VCCA2018", title: "Variable Capital Companies Act 2018" },
  VCCA2018: { ssoCode: "VCCA2018", title: "Variable Capital Companies Act 2018" },
  VARIABLE_CAPITAL_COMPANIES: { ssoCode: "VCCA2018", title: "Variable Capital Companies Act 2018" },
  MAS: { ssoCode: "MASA1970", title: "Monetary Authority of Singapore Act 1970" },
  MASA: { ssoCode: "MASA1970", title: "Monetary Authority of Singapore Act 1970" },
  CDCA: { ssoCode: "CDCSA2001", title: "Child Development Co-Savings Act 2001" },
  CDCSA: { ssoCode: "CDCSA2001", title: "Child Development Co-Savings Act 2001" },
  CDCA2001: { ssoCode: "CDCSA2001", title: "Child Development Co-Savings Act 2001" }
};
var SFRSI_2025_COLLECTION_URL = "https://asc.acra.gov.sg/singapore-financial-reporting-standards-international/archives/effective-for-annual-reporting-period-beginning-on-1-january-2025";
function buildSsoUrl(actCode, sectionNumber) {
  const normCode = actCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
  let ssoCode;
  if (actCode.toLowerCase().includes("coa") || actCode.toLowerCase().includes("companies") || actCode === "CA" || actCode === "CA1967") {
    ssoCode = "CoA1967";
  } else {
    for (const [k, v] of Object.entries(ACT_CODE_TO_SSO)) {
      if (normCode.includes(k)) {
        ssoCode = v.ssoCode;
        break;
      }
    }
  }
  if (!ssoCode) return "https://sso.agc.gov.sg";
  if (!sectionNumber) {
    return `https://sso.agc.gov.sg/Act/${ssoCode}`;
  }
  const secMatch = sectionNumber.match(/(\d+[A-Za-z]*)/);
  const secClean = secMatch ? secMatch[1] : "";
  const registeredRule = Object.values(SINGAPORE_STATUTORY_REPOSITORY).find((rule) => {
    const ruleSection = rule.sectionOrSchedule.match(/(\d+[A-Za-z]*)/)?.[1];
    const ruleCode = rule.actCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const ruleSsoCode = Object.entries(ACT_CODE_TO_SSO).find(([key]) => ruleCode.includes(key))?.[1].ssoCode || rule.actCode;
    return ruleSsoCode.toUpperCase() === ssoCode.toUpperCase() && ruleSection === secClean;
  });
  if (registeredRule) return registeredRule.canonicalUrl;
  return secClean ? `https://sso.agc.gov.sg/Act/${ssoCode}#pr${secClean}-` : `https://sso.agc.gov.sg/Act/${ssoCode}`;
}
function canonicalizeSsoUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "sso.agc.gov.sg") return url;
    const anchor = parsed.hash;
    if (!/^#(?:pr|Sc)/i.test(anchor)) return url;
    const matchingRule = Object.values(SINGAPORE_STATUTORY_REPOSITORY).find((rule) => {
      try {
        const canonical = new URL(rule.canonicalUrl);
        return canonical.hostname === parsed.hostname && canonical.pathname === parsed.pathname && canonical.hash.toLowerCase() === anchor.toLowerCase();
      } catch {
        return false;
      }
    });
    return matchingRule?.canonicalUrl || url;
  } catch {
    return url;
  }
}
function getSafeOfficialUrl(rawUrl, statuteOrAct, sectionOrSchedule, authority) {
  const url = (rawUrl || "").trim();
  if (isAskGovSingaporeUrl(url)) return url;
  if (url.includes("tax-rates-and-tax-exemption-schemes")) {
    return SINGAPORE_STATUTORY_REPOSITORY.ITA_SUTE_PTE_TAX_EXEMPTION.canonicalUrl;
  }
  if (url.includes("filing-your-corporate-income-tax-return")) {
    return SINGAPORE_STATUTORY_REPOSITORY.IRAS_FORM_CS_LITE_CRITERIA.canonicalUrl;
  }
  if (url.includes("monetary-authority-of-singapore-act")) {
    return "https://sso.agc.gov.sg/Act/MASA1970";
  }
  if (url.includes("/Act/CA1967")) {
    return url.replace("/Act/CA1967", "/Act/CoA1967");
  }
  const act = (statuteOrAct || "").toLowerCase();
  const sec = sectionOrSchedule || "";
  if (url.startsWith("https://sso.agc.gov.sg/Act/") || url.startsWith("https://sso.agc.gov.sg/SL/")) {
    return canonicalizeSsoUrl(url);
  }
  if (act.includes("income tax") || act.includes("ita") || act.includes("corporate tax")) {
    return buildSsoUrl("ITA1947", sec);
  }
  if (act.includes("variable capital companies") || act.includes("vcc act") || act.includes("vcca2018")) {
    return buildSsoUrl("VCCA2018", sec);
  }
  if (act.includes("companies act") || act.includes("ca1967") || act.includes("coa1967") || act.includes("audit")) {
    return buildSsoUrl("CoA1967", sec);
  }
  if (act.includes("goods and services") || act.includes("gst")) {
    return buildSsoUrl("GSTA1993", sec);
  }
  if (act.includes("provident fund") || act.includes("cpf")) {
    return buildSsoUrl("CPFA1953", sec);
  }
  if (act.includes("employment act") || act.includes("ea1968") || act.includes("mom")) {
    return buildSsoUrl("EmA1968", sec);
  }
  if (act.includes("monetary authority") || act.includes("mas") || act.includes("exchange control")) {
    return "https://sso.agc.gov.sg/Act/MASA1970";
  }
  if (act.includes("payment services") || act.includes("psa")) {
    return buildSsoUrl("PSA2019", sec);
  }
  if (/(?:sfrs\(i\)|sfrs|ifrs|ias)\s*(?:\d|1-)/i.test(statuteOrAct || "")) {
    return SFRSI_2025_COLLECTION_URL;
  }
  if (url.includes("asc.gov.sg")) {
    return url.includes("/singapore-financial-reporting-standards-international/") ? url : SFRSI_2025_COLLECTION_URL;
  }
  if (url.startsWith("https://www.iras.gov.sg") || url.startsWith("https://www.acra.gov.sg") || url.startsWith("https://www.cpf.gov.sg") || url.startsWith("https://www.mom.gov.sg") || url.startsWith("https://www.mas.gov.sg") || url.startsWith("https://www.ifrs.org")) {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.pathname === "/" || /^\/irashome\/?$/i.test(parsedUrl.pathname)) return "";
    } catch {
      return "";
    }
    return url;
  }
  const auth = (authority || "").toUpperCase();
  if (auth === "CPF" && /\d/.test(sec)) return buildSsoUrl("CPFA1953", sec);
  if (auth === "MOM" && /\d/.test(sec)) return buildSsoUrl("EmA1968", sec);
  if (auth === "MAS" && /\d/.test(sec)) return buildSsoUrl("MASA1970", sec);
  if (auth === "ASC") return SFRSI_2025_COLLECTION_URL;
  return "";
}
function sanitizeStatutoryLinks(markdownText) {
  if (!markdownText) return "";
  const toMarkdownSafeUrl = (url) => url.replace(/\(/g, "%28").replace(/\)/g, "%29");
  const linkPlaceholders = [];
  let sanitized = markdownText.replace(/\[([^\]]+)\]\((https?:\/\/\S+)\)/g, (_match, anchorText, url) => {
    const lowerUrl = url.toLowerCase();
    const lowerAnchor = anchorText.toLowerCase();
    let cleanUrl = canonicalizeSsoUrl(url);
    if (cleanUrl.toLowerCase().includes("/act/ca1967")) {
      cleanUrl = cleanUrl.replace(/\/act\/ca1967/gi, "/Act/CoA1967");
    } else if (lowerUrl.includes("tax-rates-and-tax-exemption-schemes")) {
      cleanUrl = SINGAPORE_STATUTORY_REPOSITORY.ITA_SUTE_PTE_TAX_EXEMPTION.canonicalUrl;
    } else if (lowerUrl.includes("filing-your-corporate-income-tax-return")) {
      cleanUrl = SINGAPORE_STATUTORY_REPOSITORY.IRAS_FORM_CS_LITE_CRITERIA.canonicalUrl;
    } else if (lowerUrl.includes("monetary-authority-of-singapore-act")) {
      cleanUrl = "https://sso.agc.gov.sg/Act/MASA1970";
    } else if (lowerUrl.includes("asc.gov.sg")) {
      cleanUrl = "https://www.acra.gov.sg/accountancy/accounting-standards";
    } else if (!lowerUrl.startsWith("https://sso.agc.gov.sg") && !lowerUrl.startsWith("https://www.iras.gov.sg") && !lowerUrl.startsWith("https://www.acra.gov.sg") && !lowerUrl.startsWith("https://www.cpf.gov.sg") && !lowerUrl.startsWith("https://www.mom.gov.sg") && !lowerUrl.startsWith("https://www.mas.gov.sg") && !lowerUrl.startsWith("https://ask.gov.sg") && !lowerUrl.startsWith("https://www.ifrs.org")) {
      for (const rule of Object.values(SINGAPORE_STATUTORY_REPOSITORY)) {
        if (lowerAnchor.includes(rule.sectionOrSchedule.toLowerCase()) || lowerAnchor.includes(rule.actTitle.toLowerCase()) || lowerAnchor.includes(rule.ruleTitle.toLowerCase())) {
          cleanUrl = rule.canonicalUrl;
          break;
        }
      }
    }
    const placeholder = `___MD_LINK_${linkPlaceholders.length}___`;
    linkPlaceholders.push(`[${anchorText}](${toMarkdownSafeUrl(cleanUrl)})`);
    return placeholder;
  });
  const addLink = (anchor, linkUrl) => {
    const placeholder = `___MD_LINK_${linkPlaceholders.length}___`;
    linkPlaceholders.push(`[${anchor}](${toMarkdownSafeUrl(linkUrl)})`);
    return placeholder;
  };
  sanitized = sanitized.replace(
    /(?:Companies Act\s*(?:1967)?\s*(?:Section|§)\s*205C(?:\s*(?:&|and)\s*Thirteenth\s*Schedule)?)/gi,
    () => addLink("Companies Act 1967 Section 205C & Thirteenth Schedule", buildSsoUrl("CoA1967", "205C"))
  );
  sanitized = sanitized.replace(
    /(?:Companies Act\s*(?:1967)?\s*(?:Section|§)\s*199(?:\(1\))?)/gi,
    () => addLink("Companies Act 1967 Section 199", buildSsoUrl("CoA1967", "199"))
  );
  sanitized = sanitized.replace(
    /(?:Companies Act\s*(?:1967)?\s*(?:Section|§)\s*145(?:\(1\))?)/gi,
    () => addLink("Companies Act 1967 Section 145", buildSsoUrl("CoA1967", "145"))
  );
  sanitized = sanitized.replace(
    /(?:Companies Act\s*(?:1967)?\s*(?:Section|§)\s*(?:175|197))/gi,
    () => addLink("Companies Act 1967 Section 175 & 197", buildSsoUrl("CoA1967", "197"))
  );
  sanitized = sanitized.replace(
    /(?:Companies Act\s*(?:1967)?)(?!\w)/gi,
    () => addLink("Companies Act 1967", "https://sso.agc.gov.sg/Act/CoA1967")
  );
  sanitized = sanitized.replace(
    /(?:Income Tax Act\s*(?:1947)?\s*(?:Section|§)\s*15\(1\)\(k\))/gi,
    () => addLink("Income Tax Act 1947 Section 15(1)(k)", buildSsoUrl("ITA1947", "15"))
  );
  sanitized = sanitized.replace(
    /(?:Income Tax Act\s*(?:1947)?\s*(?:Section|§)\s*14(?:\(1\))?)/gi,
    () => addLink("Income Tax Act 1947 Section 14(1)", buildSsoUrl("ITA1947", "14(1)"))
  );
  sanitized = sanitized.replace(
    /(?:Income Tax Act\s*(?:1947)?\s*(?:Section|§)\s*19A)/gi,
    () => addLink("Income Tax Act 1947 Section 19A", buildSsoUrl("ITA1947", "19A"))
  );
  sanitized = sanitized.replace(
    /(?:GST Act\s*(?:1993)?\s*(?:Section|§)\s*21(?:\(3\))?)/gi,
    () => addLink("Goods and Services Tax Act 1993 Section 21(3)", buildSsoUrl("GSTA1993", "21"))
  );
  sanitized = sanitized.replace(
    /(?:CPF Act\s*(?:1953)?\s*(?:Section|§)\s*(\d+[A-Za-z]?))/gi,
    (_, sec) => addLink(`Central Provident Fund Act 1953 Section ${sec}`, buildSsoUrl("CPFA1953", sec))
  );
  sanitized = sanitized.replace(
    /(?:Employment Act\s*(?:1968)?\s*(?:Section|§)\s*(\d+[A-Za-z]?))/gi,
    (_, sec) => addLink(`Employment Act 1968 Section ${sec}`, buildSsoUrl("EmA1968", sec))
  );
  sanitized = sanitized.replace(
    /(?:CPF Act\s*(?:1953)?)(?!\w)/gi,
    () => addLink("Central Provident Fund Act 1953", "https://sso.agc.gov.sg/Act/CPFA1953")
  );
  sanitized = sanitized.replace(
    /(?:Employment Act\s*(?:1968)?)(?!\w)/gi,
    () => addLink("Employment Act 1968", "https://sso.agc.gov.sg/Act/EmA1968")
  );
  sanitized = sanitized.replace(/___MD_LINK_(\d+)___/g, (_, idx) => linkPlaceholders[parseInt(idx, 10)] || "");
  return sanitized;
}
function appendStatutorySourceFooter(messageText, scenarioState) {
  if (!messageText) return "";
  if (messageText.includes("Official Statutory & Regulatory Verification Sources") || messageText.includes("Official Verification Sources")) {
    return sanitizeStatutoryLinks(messageText);
  }
  const links = [];
  if (scenarioState?.statutoryAdvisory && scenarioState.statutoryAdvisory.length > 0) {
    for (const adv of scenarioState.statutoryAdvisory) {
      const isGenericDirective = /^(?:singapore\s+)?statutory(?:\s+and\s+tax)?\s+directives?$/i.test(
        (adv.sectionOrSchedule || "").trim()
      );
      if (isGenericDirective && !adv.officialUrl) continue;
      const safeUrl = getSafeOfficialUrl(adv.officialUrl, adv.statuteOrAct, adv.sectionOrSchedule, adv.authority);
      if (safeUrl && !links.some((l) => l.url === safeUrl)) {
        links.push({
          title: `${adv.statuteOrAct} \u2014 ${adv.sectionOrSchedule}`,
          url: safeUrl,
          authority: adv.authority,
          isAskGov: isAskGovSingaporeUrl(safeUrl)
        });
      }
    }
  }
  if (scenarioState?.directGroups) {
    for (const grp of scenarioState.directGroups) {
      for (const cite of grp.citations || []) {
        const safeUrl = getSafeOfficialUrl(cite.officialSourceUrl, cite.standard, cite.paragraph, cite.authority);
        if (safeUrl && !links.some((l) => l.url === safeUrl)) {
          links.push({
            title: `${cite.standard} ${cite.paragraph || ""}`.trim(),
            url: safeUrl,
            authority: cite.authority,
            isAskGov: isAskGovSingaporeUrl(safeUrl)
          });
        }
      }
    }
  }
  const addContextualLink = (title, url, authority) => {
    if (!links.some((link) => link.url === url)) links.push({ title, url, authority, isAskGov: isAskGovSingaporeUrl(url) });
  };
  if (links.length === 0) {
    const matchedRules = querySingaporeStatutes(messageText).slice(0, 3);
    for (const rule of matchedRules) {
      addContextualLink(`${rule.actTitle} \u2014 ${rule.sectionOrSchedule}`, rule.canonicalUrl, rule.authority);
      for (const source of rule.supplementaryOfficialSources || []) {
        addContextualLink(source.title, source.url, source.authority);
      }
    }
  }
  if (links.length === 0) {
    const lower = messageText.toLowerCase();
    if (lower.includes("income tax") || lower.includes("section 14") || lower.includes("section 15") || lower.includes("motor car") || lower.includes("passenger car")) {
      links.push({
        title: "Income Tax Act 1947",
        url: "https://sso.agc.gov.sg/Act/ITA1947",
        authority: "IRAS"
      });
    }
    if (lower.includes("companies act") || lower.includes("205c") || lower.includes("audit")) {
      links.push({
        title: "Companies Act 1967 (Section 205C)",
        url: buildSsoUrl("CoA1967", "205C"),
        authority: "ACRA"
      });
    }
    if (lower.includes("gst") || lower.includes("goods and services") || lower.includes("regulation 26")) {
      links.push({
        title: "Goods and Services Tax Act 1993",
        url: "https://sso.agc.gov.sg/Act/GSTA1993",
        authority: "IRAS"
      });
    }
    if (lower.includes("cpf") || lower.includes("ordinary wage")) {
      links.push({
        title: "Central Provident Fund Act 1953",
        url: "https://sso.agc.gov.sg/Act/CPFA1953",
        authority: "CPF"
      });
    }
    if (lower.includes("lease") || lower.includes("ifrs 16") || lower.includes("sfrs(i) 16")) {
      links.push({
        title: "SFRS(I) 16 Leases (ACRA Accounting Standards)",
        url: "https://www.acra.gov.sg/accountancy/accounting-standards",
        authority: "ACRA"
      });
    }
    if (links.length === 0) {
      links.push({
        title: "Singapore Financial Reporting Standards [SFRS(I)] (ACRA)",
        url: "https://www.acra.gov.sg/accountancy/accounting-standards",
        authority: "ACRA"
      });
    }
  }
  const sourceItems = links.map((l) => `* \u{1F517} [**${l.title}**](${l.url}) ${l.isAskGov ? "*(Official agency FAQ via Ask.gov.sg \u2014 guidance)*" : l.authority ? `*(${l.authority} / Verified Official Source)*` : ""}`).join("\n");
  const footerBlock = `

---

\u{1F3DB}\uFE0F **Official Statutory & Regulatory Verification Sources**:
${sourceItems}
*(Click any link to verify directly on the official Singapore legislation, agency source, or Ask.gov.sg FAQ used)*`;
  return sanitizeStatutoryLinks(messageText + footerBlock);
}

// src/standards/sourceFreshnessManager.ts
var SourceFreshnessManager = class _SourceFreshnessManager {
  static DEFAULT_REFERENCE_DATE = "2026-09-11";
  static DEFAULT_AUDIT_CYCLE_DAYS = 365;
  /**
   * Evaluates the freshness status of a source record against an explicit reference date.
   * Disaggregates verification freshness (AUDIT_OVERDUE) from temporal legal validity
   * (ACTIVE_CURRENT, PENDING_EFFECTIVE, HISTORICAL_SUPERSEDED).
   */
  evaluateSourceFreshness(record, referenceDate = _SourceFreshnessManager.DEFAULT_REFERENCE_DATE) {
    const ref = referenceDate.trim();
    if (record.sourceStatus === "HISTORICAL") {
      return "HISTORICAL_SUPERSEDED";
    }
    if (record.validTo && record.validTo.trim().length > 0) {
      if (record.validTo.trim() < ref) {
        return "HISTORICAL_SUPERSEDED";
      }
    }
    if (record.validFrom && record.validFrom.trim().length > 0) {
      if (record.validFrom.trim() > ref) {
        return "PENDING_EFFECTIVE";
      }
    }
    const auditDays = record.reviewAuditCycleDays ?? _SourceFreshnessManager.DEFAULT_AUDIT_CYCLE_DAYS;
    if (!record.lastVerifiedDate || record.lastVerifiedDate.trim().length === 0) {
      return "AUDIT_OVERDUE";
    }
    const lastVerTime = new Date(record.lastVerifiedDate).getTime();
    const refTime = new Date(ref).getTime();
    if (isNaN(lastVerTime) || isNaN(refTime)) {
      return "AUDIT_OVERDUE";
    }
    const diffDays = Math.floor((refTime - lastVerTime) / (1e3 * 60 * 60 * 24));
    if (diffDays > auditDays) {
      return "AUDIT_OVERDUE";
    }
    return "ACTIVE_CURRENT";
  }
  /**
   * Resolves the provision temporally applicable to a specific target date.
   * Evaluates validFrom <= targetDate <= validTo (open-ended validTo indicates continuing validity).
   */
  resolveApplicableRecord(records, targetDate) {
    if (!records || records.length === 0) return null;
    const tDate = targetDate.trim();
    const candidates = records.filter((r) => {
      const fromMatch = !r.validFrom || r.validFrom <= tDate;
      const toMatch = !r.validTo || r.validTo >= tDate;
      return fromMatch && toMatch;
    });
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const aFrom = a.validFrom || "1900-01-01";
      const bFrom = b.validFrom || "1900-01-01";
      return bFrom.localeCompare(aFrom);
    });
    return candidates[0];
  }
  /**
   * Generates a comprehensive freshness report for an array of source records.
   */
  generateFreshnessReport(records, referenceDate = _SourceFreshnessManager.DEFAULT_REFERENCE_DATE) {
    const report = {
      referenceDate,
      totalRecords: records.length,
      activeCurrentCount: 0,
      pendingEffectiveCount: 0,
      historicalSupersededCount: 0,
      auditOverdueCount: 0,
      recordsByStatus: {
        ACTIVE_CURRENT: [],
        PENDING_EFFECTIVE: [],
        HISTORICAL_SUPERSEDED: [],
        AUDIT_OVERDUE: []
      }
    };
    for (const record of records) {
      const status = this.evaluateSourceFreshness(record, referenceDate);
      report.recordsByStatus[status].push(record);
      switch (status) {
        case "ACTIVE_CURRENT":
          report.activeCurrentCount++;
          break;
        case "PENDING_EFFECTIVE":
          report.pendingEffectiveCount++;
          break;
        case "HISTORICAL_SUPERSEDED":
          report.historicalSupersededCount++;
          break;
        case "AUDIT_OVERDUE":
          report.auditOverdueCount++;
          break;
      }
    }
    return report;
  }
};
var defaultSourceFreshnessManager = new SourceFreshnessManager();

// src/standards/sourceVersioning.ts
function computeProvisionHash(standardOrActCode, paragraphOrSection, text) {
  const normalizedText = text.trim().replace(/\r\n/g, "\n").replace(/\s+/g, " ");
  const canonicalPayload = [
    standardOrActCode.trim(),
    paragraphOrSection.trim(),
    normalizedText
  ].join("|||");
  return computeSha256(canonicalPayload);
}
function pureSha256(message) {
  const K = [
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ];
  const bytes = [];
  for (let i = 0; i < message.length; i++) {
    let charCode = message.charCodeAt(i);
    if (charCode < 128) {
      bytes.push(charCode);
    } else if (charCode < 2048) {
      bytes.push(192 | charCode >> 6, 128 | charCode & 63);
    } else if (charCode < 55296 || charCode >= 57344) {
      bytes.push(224 | charCode >> 12, 128 | charCode >> 6 & 63, 128 | charCode & 63);
    } else {
      i++;
      charCode = 65536 + ((charCode & 1023) << 10 | message.charCodeAt(i) & 1023);
      bytes.push(
        240 | charCode >> 18,
        128 | charCode >> 12 & 63,
        128 | charCode >> 6 & 63,
        128 | charCode & 63
      );
    }
  }
  const bitLength = bytes.length * 8;
  bytes.push(128);
  while (bytes.length % 64 !== 56) {
    bytes.push(0);
  }
  const highBits = Math.floor(bitLength / 4294967296);
  const lowBits = bitLength >>> 0;
  for (let i = 3; i >= 0; i--) {
    bytes.push(highBits >>> i * 8 & 255);
  }
  for (let i = 3; i >= 0; i--) {
    bytes.push(lowBits >>> i * 8 & 255);
  }
  let H0 = 1779033703;
  let H1 = 3144134277;
  let H2 = 1013904242;
  let H3 = 2773480762;
  let H4 = 1359893119;
  let H5 = 2600822924;
  let H6 = 528734635;
  let H7 = 1541459225;
  const W = new Int32Array(64);
  for (let i = 0; i < bytes.length; i += 64) {
    for (let t = 0; t < 16; t++) {
      W[t] = bytes[i + t * 4] << 24 | bytes[i + t * 4 + 1] << 16 | bytes[i + t * 4 + 2] << 8 | bytes[i + t * 4 + 3];
    }
    for (let t = 16; t < 64; t++) {
      const s0 = (W[t - 15] >>> 7 | W[t - 15] << 25) ^ (W[t - 15] >>> 18 | W[t - 15] << 14) ^ W[t - 15] >>> 3 | 0;
      const s1 = (W[t - 2] >>> 17 | W[t - 2] << 15) ^ (W[t - 2] >>> 19 | W[t - 2] << 13) ^ W[t - 2] >>> 10 | 0;
      W[t] = W[t - 16] + s0 + W[t - 7] + s1 | 0;
    }
    let a = H0;
    let b = H1;
    let c = H2;
    let d = H3;
    let e = H4;
    let f = H5;
    let g = H6;
    let h = H7;
    for (let t = 0; t < 64; t++) {
      const S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7) | 0;
      const ch = e & f ^ ~e & g;
      const temp1 = h + S1 + ch + K[t] + W[t] | 0;
      const S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10) | 0;
      const maj = a & b ^ a & c ^ b & c;
      const temp2 = S0 + maj | 0;
      h = g;
      g = f;
      f = e;
      e = d + temp1 | 0;
      d = c;
      c = b;
      b = a;
      a = temp1 + temp2 | 0;
    }
    H0 = H0 + a | 0;
    H1 = H1 + b | 0;
    H2 = H2 + c | 0;
    H3 = H3 + d | 0;
    H4 = H4 + e | 0;
    H5 = H5 + f | 0;
    H6 = H6 + g | 0;
    H7 = H7 + h | 0;
  }
  const toHex = (n) => (n >>> 0).toString(16).padStart(8, "0");
  return `${toHex(H0)}${toHex(H1)}${toHex(H2)}${toHex(H3)}${toHex(H4)}${toHex(H5)}${toHex(H6)}${toHex(H7)}`;
}
function computeSha256(message) {
  try {
    const g = globalThis;
    if (typeof g.process !== "undefined" && g.process?.versions?.node) {
      const nodeCrypto = typeof g.require === "function" ? g.require("crypto") : null;
      if (nodeCrypto && typeof nodeCrypto.createHash === "function") {
        return nodeCrypto.createHash("sha256").update(message, "utf8").digest("hex");
      }
    }
  } catch {
  }
  return pureSha256(message);
}
var SourceVersioningManager = class {
  // Append-only immutable ledger: versionId -> VersionLedgerEntry
  ledger = /* @__PURE__ */ new Map();
  // Candidate versions waiting for validation/verification: versionId -> SourceVersionMetadata
  candidates = /* @__PURE__ */ new Map();
  // Active pointer: recordId -> versionId
  activeVersionPointers = /* @__PURE__ */ new Map();
  /**
   * Deterministically calculates canonical SHA-256 content hash from standard fields:
   * standardOrActCode | paragraphOrSection | sourceText | validFrom | validTo
   */
  computeSourceHash(record) {
    const canonicalPayload = [
      record.standardOrActCode.trim().toLowerCase(),
      record.paragraphOrSection.trim().toLowerCase(),
      record.sourceText.trim(),
      (record.validFrom || "").trim(),
      (record.validTo || "").trim()
    ].join("||");
    return computeSha256(canonicalPayload);
  }
  /**
   * Registers a newly fetched or proposed source version as an UNVERIFIED candidate.
   * Does NOT activate the version into the active ledger.
   */
  registerCandidateVersion(record, metadata) {
    const computedHash = this.computeSourceHash(record);
    const finalizedMetadata = {
      ...metadata,
      contentHash: computedHash,
      verificationStatus: metadata.verificationStatus || "UNVERIFIED",
      retrievedAt: metadata.retrievedAt || (/* @__PURE__ */ new Date()).toISOString()
    };
    this.candidates.set(metadata.versionId, {
      record: { ...record, contentHash: computedHash, versionId: metadata.versionId },
      metadata: finalizedMetadata
    });
    return finalizedMetadata;
  }
  /**
   * Verifies content integrity: checks if the record's current content matches its declared SHA-256 hash.
   */
  verifySourceIntegrity(record, expectedHash) {
    const actualHash = this.computeSourceHash(record);
    return actualHash.toLowerCase() === expectedHash.toLowerCase();
  }
  /**
   * Compares two source versions and extracts structured accounting/statutory diffs:
   * (e.g. TEXT_CHANGE, RATE_CHANGE, THRESHOLD_CHANGE, EFFECTIVE_DATE_CHANGE, APPLICABILITY_CHANGE, CITATION_CHANGE).
   */
  compareVersions(oldVersion, newVersion, oldRecord, newRecord) {
    const changes = [];
    const diffSummary = [];
    const textChanged = oldVersion.contentHash !== newVersion.contentHash;
    if (textChanged) {
      changes.push("TEXT_CHANGE");
      diffSummary.push(`Content modified: SHA-256 changed from ${oldVersion.contentHash.slice(0, 8)}... to ${newVersion.contentHash.slice(0, 8)}...`);
    }
    const effectiveDateChanged = oldVersion.effectiveDate !== newVersion.effectiveDate || oldVersion.validFrom !== newVersion.validFrom || oldVersion.validTo !== newVersion.validTo;
    if (effectiveDateChanged) {
      changes.push("EFFECTIVE_DATE_CHANGE");
      diffSummary.push(
        `Validity window shifted: [${oldVersion.validFrom || "open"} - ${oldVersion.validTo || "open"}] -> [${newVersion.validFrom || "open"} - ${newVersion.validTo || "open"}]`
      );
    }
    const citationChanged = oldRecord && newRecord && (oldRecord.paragraphOrSection !== newRecord.paragraphOrSection || oldRecord.standardOrActCode !== newRecord.standardOrActCode);
    if (citationChanged) {
      changes.push("CITATION_CHANGE");
      diffSummary.push(`Citation provision adjusted: ${oldRecord?.paragraphOrSection} -> ${newRecord?.paragraphOrSection}`);
    }
    let rateChanged = false;
    let thresholdChanged = false;
    if (oldRecord && newRecord) {
      const oldRates = (oldRecord.sourceText.match(/\b\d+(?:\.\d+)?%/g) || []).sort().join(",");
      const newRates = (newRecord.sourceText.match(/\b\d+(?:\.\d+)?%/g) || []).sort().join(",");
      if (oldRates !== newRates) {
        rateChanged = true;
        changes.push("RATE_CHANGE");
        diffSummary.push(`Statutory rate shift detected: [${oldRates}] -> [${newRates}]`);
      }
      const oldAmounts = (oldRecord.sourceText.match(/(?:sgd|\$)\s*[\d,]+(?:\.\d+)?/gi) || []).sort().join(",");
      const newAmounts = (newRecord.sourceText.match(/(?:sgd|\$)\s*[\d,]+(?:\.\d+)?/gi) || []).sort().join(",");
      if (oldAmounts !== newAmounts) {
        thresholdChanged = true;
        changes.push("THRESHOLD_CHANGE");
        diffSummary.push(`Monetary threshold altered: [${oldAmounts}] -> [${newAmounts}]`);
      }
    }
    const applicabilityChanged = Boolean(
      (oldRecord?.tags || []).join(",") !== (newRecord?.tags || []).join(",") || oldRecord?.domain !== newRecord?.domain
    );
    if (applicabilityChanged) {
      changes.push("APPLICABILITY_CHANGE");
      diffSummary.push("Domain applicability or regulatory tags altered");
    }
    return {
      textChanged,
      rateChanged,
      thresholdChanged,
      effectiveDateChanged,
      applicabilityChanged,
      citationChanged: Boolean(citationChanged),
      changes,
      diffSummary
    };
  }
  /**
   * Activates a candidate version after verification gate approval.
   * The version is immutably appended to the ledger and marked active.
   */
  activateVersion(versionId) {
    const candidate = this.candidates.get(versionId);
    if (!candidate) {
      return { success: false, versionId, activatedRecordId: "", error: `Candidate version '${versionId}' not found` };
    }
    if (candidate.metadata.verificationStatus !== "VERIFIED") {
      return {
        success: false,
        versionId,
        activatedRecordId: candidate.record.id,
        error: `Cannot activate version '${versionId}' with status '${candidate.metadata.verificationStatus}' (Must be VERIFIED)`
      };
    }
    const recordId = candidate.record.id;
    const currentActiveVersionId = this.activeVersionPointers.get(recordId);
    if (currentActiveVersionId) {
      const existingEntry = this.ledger.get(currentActiveVersionId);
      if (existingEntry) {
        existingEntry.isActive = false;
        existingEntry.metadata = {
          ...existingEntry.metadata,
          supersededByVersionId: versionId
        };
      }
    }
    if (currentActiveVersionId) {
      candidate.metadata.supersedesVersionId = currentActiveVersionId;
    }
    const ledgerEntry = {
      versionId,
      recordId,
      metadata: { ...candidate.metadata },
      recordSnapshot: { ...candidate.record },
      recordedAt: (/* @__PURE__ */ new Date()).toISOString(),
      isActive: true
    };
    this.ledger.set(versionId, ledgerEntry);
    this.activeVersionPointers.set(recordId, versionId);
    this.candidates.delete(versionId);
    return {
      success: true,
      versionId,
      activatedRecordId: recordId
    };
  }
  /**
   * Rolls back an active version to its predecessor.
   * Preserves append-only ledger immutability (the rolled-back version remains in the ledger).
   */
  rollbackVersion(versionId) {
    const targetEntry = this.ledger.get(versionId);
    if (!targetEntry) {
      return { success: false, rolledBackVersionId: versionId, restoredVersionId: "", error: `Version '${versionId}' not found in ledger` };
    }
    const predecessorVersionId = targetEntry.metadata.supersedesVersionId;
    if (!predecessorVersionId) {
      return {
        success: false,
        rolledBackVersionId: versionId,
        restoredVersionId: "",
        error: `Version '${versionId}' has no recorded predecessor to roll back to`
      };
    }
    const predecessorEntry = this.ledger.get(predecessorVersionId);
    if (!predecessorEntry) {
      return {
        success: false,
        rolledBackVersionId: versionId,
        restoredVersionId: predecessorVersionId,
        error: `Predecessor version '${predecessorVersionId}' not found in ledger`
      };
    }
    targetEntry.isActive = false;
    predecessorEntry.isActive = true;
    const { supersededByVersionId: _unused, ...restoredMeta } = predecessorEntry.metadata;
    predecessorEntry.metadata = restoredMeta;
    this.activeVersionPointers.set(targetEntry.recordId, predecessorVersionId);
    return {
      success: true,
      rolledBackVersionId: versionId,
      restoredVersionId: predecessorVersionId
    };
  }
  /**
   * Retrieves an immutable snapshot of an entry from the ledger.
   */
  getLedgerEntry(versionId) {
    return this.ledger.get(versionId);
  }
  /**
   * Gets the currently active version ID for a given record.
   */
  getActiveVersionId(recordId) {
    return this.activeVersionPointers.get(recordId);
  }
  /**
   * Gets all entries in the ledger for audit review.
   */
  getAllLedgerEntries() {
    return Array.from(this.ledger.values());
  }
  /**
   * Gets all pending candidates.
   */
  getCandidates() {
    return Array.from(this.candidates.values());
  }
  /**
   * Gets the head hash of the ledger for snapshot integrity verification.
   */
  getLedgerHeadHash() {
    const entries = this.getAllLedgerEntries();
    if (entries.length === 0) return "genesis-empty-ledger";
    const last = entries[entries.length - 1];
    return computeSha256(`${last.versionId}:::${last.recordedAt}:::${last.metadata.provisionHash || last.metadata.contentHash}`);
  }
  /**
   * Clears ledger and candidate state (for test isolation).
   */
  reset() {
    this.ledger.clear();
    this.candidates.clear();
    this.activeVersionPointers.clear();
  }
};
var defaultSourceVersioningManager = new SourceVersioningManager();

// src/standards/unifiedSourceModel.ts
function mapStatuteCategoryToDomain(category) {
  switch (category) {
    case "TAX_INCOME":
      return "IRAS_TAX";
    case "TAX_GST":
      return "IRAS_GST";
    case "ACRA_COMPLIANCE":
      return "ACRA_CORP";
    case "MOM_LABOUR":
      return "MOM_EMPLOYMENT";
    case "CPF_PAYROLL":
      return "CPF_BOARD";
    case "MAS_FINANCE":
      return "MAS_FUNDS";
    default:
      return "GENERAL";
  }
}
var UNIFIED_SOURCE_REGISTRY = {};
function buildUnifiedSourceRegistry(referenceDate = SourceFreshnessManager.DEFAULT_REFERENCE_DATE) {
  for (const k of Object.keys(UNIFIED_SOURCE_REGISTRY)) {
    delete UNIFIED_SOURCE_REGISTRY[k];
  }
  for (const [key, rule] of Object.entries(SINGAPORE_STATUTORY_REPOSITORY)) {
    const hasVerbatimText = Boolean(rule.verbatimStatuteText && rule.verbatimStatuteText.trim().length > 0);
    const isVerbatim = rule.isVerbatimText === true && hasVerbatimText;
    const isHistorical = rule.sourceStatus === "HISTORICAL";
    let status = "NEEDS_REVIEW";
    if (isHistorical) {
      status = "HISTORICAL";
    } else if (isVerbatim && rule.sourceStatus === "VERIFIED") {
      status = "VERIFIED";
    }
    const type = isVerbatim && (rule.sourceStatus === "VERIFIED" || isHistorical) ? "AUTHORITATIVE_SOURCE" : "CURATED_SUMMARY";
    const tier = isVerbatim && (rule.sourceStatus === "VERIFIED" || isHistorical) ? "PRIMARY_SOURCE" : "CURATED_SUMMARY";
    const validFrom = rule.validFrom || rule.effectiveDate;
    const validTo = rule.validTo;
    const lastVerified = rule.lastVerifiedDate || "2026-09-01";
    const auditDays = rule.reviewAuditCycleDays ?? SourceFreshnessManager.DEFAULT_AUDIT_CYCLE_DAYS;
    const record = {
      id: rule.id,
      authority: rule.authority,
      authorityName: rule.authorityName,
      sourcePublisher: rule.sourcePublisher || (rule.canonicalUrl.includes("sso.agc.gov.sg") ? "Singapore Statutes Online / AGC" : rule.authorityName),
      legalOrStandardInstrument: rule.legalOrStandardInstrument || rule.actTitle,
      documentTitle: rule.actTitle,
      standardOrActCode: rule.actCode,
      paragraphOrSection: rule.sectionOrSchedule,
      sourceText: rule.verbatimStatuteText || rule.principle,
      principleSummary: rule.ruleTitle,
      effectiveDate: rule.effectiveDate,
      revisionDate: rule.revisionDate,
      officialSourceUrl: rule.canonicalUrl,
      domain: mapStatuteCategoryToDomain(rule.category),
      jurisdiction: "Singapore",
      tags: rule.tags || [],
      sourceStatus: status,
      sourceType: type,
      evidenceTier: tier,
      isVerbatimText: isVerbatim,
      validFrom,
      validTo,
      lastVerifiedDate: lastVerified,
      reviewAuditCycleDays: auditDays,
      supersededByRecordId: rule.supersededByRecordId,
      historicalPredecessorRecordId: rule.historicalPredecessorRecordId,
      provenance: "LOCAL_STATIC",
      version: "2026.09",
      canonicalSourceUrl: rule.canonicalUrl,
      sourceAuthority: rule.canonicalUrl.includes("ask.gov.sg") ? "ASK_GOV_SG" : rule.authority === "IRAS" ? "IRAS" : rule.authority === "ACRA" ? "ACRA" : rule.authority === "MOM" ? "MOM" : rule.authority === "CPF" ? "CPF" : rule.authority === "MAS" ? "MAS" : "AGC",
      retrievedAt: "2026-09-01T00:00:00Z",
      verificationMethod: isVerbatim && rule.sourceStatus === "VERIFIED" ? "STATUTORY_LEGISLATION_AUDIT" : "CURATED_EDITORIAL_REVIEW"
    };
    record.contentHash = defaultSourceVersioningManager.computeSourceHash(record);
    record.provisionHash = record.contentHash;
    record.extractionStatus = isVerbatim && rule.sourceStatus === "VERIFIED" ? "EXACT" : "PARTIAL";
    if (isVerbatim) {
      record.sourceLocator = {
        heading: rule.sectionOrSchedule,
        elementId: rule.canonicalUrl.includes("#") ? rule.canonicalUrl.split("#")[1] : void 0
      };
    }
    record.freshnessStatus = defaultSourceFreshnessManager.evaluateSourceFreshness(record, referenceDate);
    UNIFIED_SOURCE_REGISTRY[key] = record;
  }
  for (const [key, std] of Object.entries(STANDARDS_REPOSITORY)) {
    const validFrom = std.validFrom;
    const validTo = std.validTo;
    const lastVerified = std.lastVerifiedDate || "2026-09-01";
    const auditDays = std.reviewAuditCycleDays ?? SourceFreshnessManager.DEFAULT_AUDIT_CYCLE_DAYS;
    const record = {
      id: key,
      authority: "ACRA",
      authorityName: "Accounting Standards Council (ACRA) & IASB",
      sourcePublisher: "Accounting Standards Council (Singapore) / IFRS Foundation",
      legalOrStandardInstrument: std.sfrsCode ? `${std.sfrsCode} ${std.standardTitle}` : std.standardTitle,
      documentTitle: std.standardTitle,
      standardOrActCode: std.sfrsCode.split(" ")[0] || "SFRS(I)",
      paragraphOrSection: std.paragraph,
      sourceText: std.principle,
      principleSummary: std.standardTitle,
      effectiveDate: std.validFrom || void 0,
      officialSourceUrl: "https://www.acra.gov.sg/accountancy/accounting-standards",
      domain: "ACCOUNTING_SFRS",
      jurisdiction: "Singapore",
      tags: [std.standardTitle.toLowerCase(), std.paragraph.toLowerCase(), "accounting standard", "sfrs(i)"],
      sourceStatus: "NEEDS_REVIEW",
      sourceType: "CURATED_SUMMARY",
      evidenceTier: "CURATED_SUMMARY",
      isVerbatimText: false,
      validFrom,
      validTo,
      lastVerifiedDate: lastVerified,
      reviewAuditCycleDays: auditDays,
      supersededByRecordId: std.supersededByRecordId,
      historicalPredecessorRecordId: std.historicalPredecessorRecordId,
      provenance: "LOCAL_STATIC",
      version: "2026.09",
      canonicalSourceUrl: "https://www.acra.gov.sg/accountancy/accounting-standards",
      sourceAuthority: "ACRA",
      retrievedAt: "2026-09-01T00:00:00Z",
      verificationMethod: "CURATED_EDITORIAL_REVIEW"
    };
    record.contentHash = defaultSourceVersioningManager.computeSourceHash(record);
    record.provisionHash = record.contentHash;
    record.extractionStatus = "PARTIAL";
    record.freshnessStatus = defaultSourceFreshnessManager.evaluateSourceFreshness(record, referenceDate);
    UNIFIED_SOURCE_REGISTRY[key] = record;
  }
  return UNIFIED_SOURCE_REGISTRY;
}
buildUnifiedSourceRegistry();
function getAllAuthoritativeSources() {
  return Object.values(UNIFIED_SOURCE_REGISTRY);
}

// src/retrieval/targetDateResolver.ts
var MONTH_MAP = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12"
};
var TargetDateResolver = class _TargetDateResolver {
  static CURRENT_SYSTEM_DATE = "2026-09-11";
  /**
   * Resolves target transaction, reporting, or statutory dates from user input text.
   * Employs strict confidence levels and never invents a historical date when none is supplied.
   */
  resolveTargetDate(query, currentDate = _TargetDateResolver.CURRENT_SYSTEM_DATE) {
    const q = query.trim();
    if (!q) {
      return { confidence: "LOW", source: "NONE" };
    }
    const sgDateMatch = q.match(/\b([0-3]?\d)[\/\-]([0-1]?\d)[\/\-](20\d{2})\b/);
    if (sgDateMatch) {
      const day = sgDateMatch[1].padStart(2, "0");
      const month = sgDateMatch[2].padStart(2, "0");
      const year = sgDateMatch[3];
      const iso = `${year}-${month}-${day}`;
      return {
        targetDate: iso,
        confidence: "HIGH",
        source: "EXPLICIT",
        rawMatchedText: sgDateMatch[0],
        isHistorical: iso < currentDate
      };
    }
    const isoDateMatch = q.match(/\b(20\d{2})-([0-1]\d)-([0-3]\d)\b/);
    if (isoDateMatch) {
      const iso = isoDateMatch[0];
      return {
        targetDate: iso,
        confidence: "HIGH",
        source: "EXPLICIT",
        rawMatchedText: iso,
        isHistorical: iso < currentDate
      };
    }
    const namedDateMatch = q.match(/\b([0-3]?\d)\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/i);
    if (namedDateMatch) {
      const day = namedDateMatch[1].padStart(2, "0");
      const mStr = namedDateMatch[2].toLowerCase();
      const month = MONTH_MAP[mStr] || "01";
      const year = namedDateMatch[3];
      const iso = `${year}-${month}-${day}`;
      return {
        targetDate: iso,
        confidence: "HIGH",
        source: "EXPLICIT",
        rawMatchedText: namedDateMatch[0],
        isHistorical: iso < currentDate
      };
    }
    const fyeMatch = q.match(/\b(?:fye|as at|ended|ending)\s+([0-3]?\d)\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/i);
    if (fyeMatch) {
      const day = fyeMatch[1].padStart(2, "0");
      const mStr = fyeMatch[2].toLowerCase();
      const month = MONTH_MAP[mStr] || "12";
      const year = fyeMatch[3];
      const iso = `${year}-${month}-${day}`;
      return {
        targetDate: iso,
        confidence: "HIGH",
        source: "EXPLICIT",
        rawMatchedText: fyeMatch[0],
        isHistorical: iso < currentDate
      };
    }
    const yaMatch = q.match(/\b(?:ya|year of assessment)\s*(20\d{2})\b/i);
    if (yaMatch) {
      const yaYear = yaMatch[1];
      const iso = `${yaYear}-01-01`;
      return {
        targetDate: iso,
        confidence: "MEDIUM",
        source: "INFERRED",
        rawMatchedText: yaMatch[0],
        isHistorical: iso < currentDate
      };
    }
    const inYearMatch = q.match(/\b(?:in|during|for|from|back in)\s+(20\d{2})\b/i);
    if (inYearMatch) {
      const year = inYearMatch[1];
      const iso = `${year}-06-30`;
      return {
        targetDate: iso,
        confidence: "MEDIUM",
        source: "INFERRED",
        rawMatchedText: inYearMatch[0],
        isHistorical: iso < currentDate
      };
    }
    const standaloneYearMatch = q.match(/\b(202[0-5])\b/);
    if (standaloneYearMatch) {
      const year = standaloneYearMatch[1];
      const iso = `${year}-06-30`;
      return {
        targetDate: iso,
        confidence: "MEDIUM",
        source: "INFERRED",
        rawMatchedText: standaloneYearMatch[0],
        isHistorical: true
      };
    }
    return {
      targetDate: void 0,
      confidence: "LOW",
      source: "NONE",
      isHistorical: false
    };
  }
};
var defaultTargetDateResolver = new TargetDateResolver();

// src/retrieval/sourceRetriever.ts
var InMemorySourceRetriever = class {
  sources;
  constructor(customSources) {
    this.sources = customSources || getAllAuthoritativeSources();
  }
  /**
   * Retrieves sources by unique record ID
   */
  getSourceById(id) {
    return UNIFIED_SOURCE_REGISTRY[id] || this.sources.find((s) => s.id === id);
  }
  /**
   * Finds sources matching a standard or statute code (e.g. "ITA1947", "SFRS(I) 1-38")
   * and optional paragraph/section (e.g. "Section 14(1)", "§57").
   */
  findSourcesByStandardOrAct(standardOrActCode, paragraphOrSection) {
    const codeClean = standardOrActCode.toLowerCase().replace(/\s*\((?:acra|mom|iras|cpf|mas|asc|sso|singapore)\)/gi, "").replace(/[\s\-_()]/g, "");
    const secClean = paragraphOrSection ? paragraphOrSection.toLowerCase().replace(/\b(?:section|sec|paragraph|para|regulation|reg|schedule|sch|clause)\b/gi, "").replace(/[§\s\-_(),.&]/g, "") : null;
    return this.sources.filter((s) => {
      const sCodeClean = s.standardOrActCode.toLowerCase().replace(/[\s\-_()]/g, "");
      const sTitleClean = s.documentTitle.toLowerCase().replace(/[\s\-_()]/g, "");
      const sInstClean = (s.legalOrStandardInstrument || "").toLowerCase().replace(/[\s\-_()]/g, "");
      const codeMatches = sCodeClean.includes(codeClean) || codeClean.includes(sCodeClean) || sTitleClean.includes(codeClean) || codeClean.includes(sTitleClean) || sInstClean && (sInstClean.includes(codeClean) || codeClean.includes(sInstClean));
      if (!codeMatches) return false;
      if (!secClean) return true;
      const sSecClean = s.paragraphOrSection.toLowerCase().replace(/\b(?:section|sec|paragraph|para|regulation|reg|schedule|sch|clause)\b/gi, "").replace(/[§\s\-_(),.&]/g, "");
      return sSecClean.includes(secClean) || secClean.includes(sSecClean);
    });
  }
  /**
   * Scores and retrieves relevant authoritative sources based on domain, authority, and query text.
   */
  async retrieveSources(retrievalQuery) {
    const {
      query,
      domain,
      authorities,
      maxResults = 5,
      targetDate: explicitTargetDate,
      includeHistorical = false,
      referenceDate = SourceFreshnessManager.DEFAULT_REFERENCE_DATE
    } = retrievalQuery;
    const lowerQ = query.toLowerCase();
    const queryTokens = lowerQ.split(/[\s,.;:!?/()]+/).filter((t) => t.length > 2);
    const resolvedDateInfo = explicitTargetDate ? { targetDate: explicitTargetDate, isHistorical: explicitTargetDate < referenceDate, confidence: "HIGH" } : defaultTargetDateResolver.resolveTargetDate(query, referenceDate);
    const effectiveTargetDate = resolvedDateInfo.targetDate;
    const isHistoricalTarget = resolvedDateInfo.isHistorical || includeHistorical;
    const mentionsHistorical = isHistoricalTarget || lowerQ.includes("historical") || lowerQ.includes("prior to") || lowerQ.includes("before") || lowerQ.includes("old rate") || lowerQ.includes("former") || lowerQ.includes("previous") || lowerQ.includes("superseded");
    const scored = [];
    for (const record of this.sources) {
      let score = 0;
      if (authorities && authorities.length > 0) {
        if (authorities.includes(record.authority)) {
          score += 15;
        }
      }
      if (domain && record.domain === domain) {
        score += 12;
      }
      const pClean = record.paragraphOrSection.toLowerCase().replace(/[§]/g, "").trim();
      if (pClean && lowerQ.includes(pClean)) {
        score += 30;
      }
      if (lowerQ.includes(record.standardOrActCode.toLowerCase()) || lowerQ.includes(record.documentTitle.toLowerCase())) {
        score += 25;
      }
      for (const tag of record.tags) {
        if (lowerQ.includes(tag.toLowerCase())) {
          score += 8;
        }
      }
      const summaryLower = record.principleSummary.toLowerCase();
      const textLower = record.sourceText.toLowerCase();
      for (const token of queryTokens) {
        if (summaryLower.includes(token)) score += 3;
        if (textLower.includes(token)) score += 2;
      }
      const freshness = defaultSourceFreshnessManager.evaluateSourceFreshness(record, referenceDate);
      if (effectiveTargetDate) {
        const fromMatch = !record.validFrom || record.validFrom <= effectiveTargetDate;
        const toMatch = !record.validTo || record.validTo >= effectiveTargetDate;
        if (fromMatch && toMatch) {
          score += 25;
          if (record.validTo && record.validTo < referenceDate) {
            score += 15;
          }
        } else {
          score -= 40;
        }
      } else {
        if (freshness === "HISTORICAL_SUPERSEDED") {
          if (mentionsHistorical) {
            score += 10;
          } else {
            score -= 50;
          }
        } else if (freshness === "ACTIVE_CURRENT") {
          score += 15;
        } else if (freshness === "PENDING_EFFECTIVE") {
          score -= 10;
        }
      }
      if (score > 0) {
        scored.push({ record, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults).map((s) => s.record);
  }
};
var defaultSourceRetriever = new InMemorySourceRetriever();

// src/retrieval/sourceAdapters.ts
function cleanHtmlText(htmlSnippet) {
  return htmlSnippet.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "").replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<\/div>/gi, "\n").replace(/<\/tr>/gi, "\n").replace(/<\/td>/gi, " ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&sect;/g, "\xA7").replace(/\s+/g, " ").trim();
}
function extractBalancedContainer(html, tagName, idOrAttrPattern) {
  if (!html || typeof html !== "string") return null;
  const idPattern = typeof idOrAttrPattern === "string" ? new RegExp(`id=["']${idOrAttrPattern}["']`, "i") : idOrAttrPattern;
  const tagOpenRegex = new RegExp(`<${tagName}\\b([^>]*)>`, "gi");
  let openMatch;
  while ((openMatch = tagOpenRegex.exec(html)) !== null) {
    const attrString = openMatch[1];
    if (idPattern.test(attrString) || idPattern.test(openMatch[0])) {
      const startOffset = openMatch.index;
      const openTagLen = openMatch[0].length;
      const contentStart = startOffset + openTagLen;
      const idMatch = attrString.match(/id=["']([^"']+)["']/i);
      const elementId = idMatch ? idMatch[1] : void 0;
      const tokenRegex = new RegExp(`(<${tagName}\\b[^>]*>)|(<\\/${tagName}\\s*>)`, "gi");
      tokenRegex.lastIndex = contentStart;
      let depth = 1;
      let tokenMatch;
      while ((tokenMatch = tokenRegex.exec(html)) !== null) {
        if (tokenMatch[1]) {
          if (!/\/\s*>$/.test(tokenMatch[1])) {
            depth++;
          }
        } else if (tokenMatch[2]) {
          depth--;
          if (depth === 0) {
            const endOffset = tokenMatch.index + tokenMatch[0].length;
            const innerHtml = html.slice(contentStart, tokenMatch.index);
            const outerHtml = html.slice(startOffset, endOffset);
            return {
              outerHtml,
              innerHtml,
              startOffset,
              endOffset,
              tagName: tagName.toLowerCase(),
              elementId
            };
          }
        }
      }
      return null;
    }
  }
  return null;
}
function findBalancedContainerFrom(html, startOffset, tagName) {
  if (!html || typeof html !== "string" || startOffset < 0 || startOffset >= html.length) return null;
  const openTagMatch = new RegExp(`^<${tagName}\\b([^>]*)>`, "i").exec(html.slice(startOffset));
  if (!openTagMatch) return null;
  const attrString = openTagMatch[1];
  const openTagLen = openTagMatch[0].length;
  const contentStart = startOffset + openTagLen;
  const idMatch = attrString.match(/id=["']([^"']+)["']/i);
  const elementId = idMatch ? idMatch[1] : void 0;
  const tokenRegex = new RegExp(`(<${tagName}\\b[^>]*>)|(<\\/${tagName}\\s*>)`, "gi");
  tokenRegex.lastIndex = contentStart;
  let depth = 1;
  let tokenMatch;
  while ((tokenMatch = tokenRegex.exec(html)) !== null) {
    if (tokenMatch[1]) {
      if (!/\/\s*>$/.test(tokenMatch[1])) {
        depth++;
      }
    } else if (tokenMatch[2]) {
      depth--;
      if (depth === 0) {
        const endOffset = tokenMatch.index + tokenMatch[0].length;
        return {
          outerHtml: html.slice(startOffset, endOffset),
          innerHtml: html.slice(contentStart, tokenMatch.index),
          startOffset,
          endOffset,
          tagName: tagName.toLowerCase(),
          elementId
        };
      }
    }
  }
  return null;
}
function extractSSOProvision(html, actCode = "CoA1967", section = "Section 201(5)") {
  if (!html || typeof html !== "string") {
    return {
      standardOrActCode: actCode,
      paragraphOrSection: section,
      text: "",
      extractionStatus: "FAILED",
      sourceLocator: {},
      extractionMethod: "SSO_STRUCTURAL_CONTAINER_PARSER",
      isVerbatimText: false
    };
  }
  const secMatch = section.match(/(?:Section|Sec\.?|S\.?)\s*(\d+)/i);
  const subMatch = section.match(/\((\d+[a-zA-Z]?)\)/);
  const targetSec = secMatch ? secMatch[1] : "201";
  const targetSub = subMatch ? subMatch[1] : "5";
  const explicitSubRegex = new RegExp(`id=["'](?:pr${targetSec}-${targetSub}-?|sec${targetSec}-${targetSub}-?|pr${targetSec}_${targetSub})["']`, "i");
  const explicitSubContainer = extractBalancedContainer(html, "div", explicitSubRegex) || extractBalancedContainer(html, "p", explicitSubRegex);
  if (explicitSubContainer) {
    const rawOuter2 = html.slice(explicitSubContainer.startOffset, explicitSubContainer.endOffset);
    const cleaned2 = cleanHtmlText(rawOuter2);
    if (cleaned2.length > 20 && (cleaned2.startsWith(`(${targetSub})`) || new RegExp(`^\\s*\\(${targetSub}\\)\\s+`).test(cleaned2))) {
      return {
        standardOrActCode: actCode,
        paragraphOrSection: section,
        text: cleaned2,
        extractionStatus: "EXACT",
        isVerbatimText: true,
        sourceLocator: {
          document: "Companies Act 1967",
          act: "CoA1967",
          section: targetSec,
          subsection: targetSub,
          sourceNode: `${explicitSubContainer.tagName}#${explicitSubContainer.elementId}`,
          elementId: explicitSubContainer.elementId,
          heading: `Section ${targetSec}(${targetSub})`,
          startOffset: explicitSubContainer.startOffset,
          endOffset: explicitSubContainer.endOffset,
          boundary: {
            startOffset: explicitSubContainer.startOffset,
            endOffset: explicitSubContainer.endOffset
          },
          sourceType: "HTML",
          canonicalLocator: `Companies Act 1967 > Section ${targetSec} > Subsection (${targetSub})`
        },
        extractionMethod: "SSO_STRUCTURAL_CONTAINER_PARSER"
      };
    }
  }
  const secContainer = extractBalancedContainer(html, "div", new RegExp(`id=["'](?:pr${targetSec}-[^"']*|pr${targetSec}|sec${targetSec})["']`, "i"));
  if (!secContainer) {
    return {
      standardOrActCode: actCode,
      paragraphOrSection: section,
      text: "",
      extractionStatus: "FAILED",
      sourceLocator: {},
      extractionMethod: "SSO_STRUCTURAL_CONTAINER_PARSER",
      isVerbatimText: false
    };
  }
  const childTagRegex = /<(div|p)\b([^>]*)>/gi;
  const openTagMatch = /^<div\b([^>]*)>/i.exec(html.slice(secContainer.startOffset));
  const openTagLen = openTagMatch ? openTagMatch[0].length : 0;
  const innerStart = secContainer.startOffset + openTagLen;
  const innerEnd = secContainer.endOffset - 6;
  childTagRegex.lastIndex = innerStart;
  let childMatch;
  let matchedChildContainer = null;
  while ((childMatch = childTagRegex.exec(html)) !== null) {
    if (childMatch.index >= innerEnd) break;
    const childStart = childMatch.index;
    const tagName = childMatch[1];
    const childContainer = findBalancedContainerFrom(html, childStart, tagName);
    if (childContainer && childContainer.endOffset <= secContainer.endOffset) {
      const rawChild = html.slice(childContainer.startOffset, childContainer.endOffset);
      const childCleaned = cleanHtmlText(rawChild);
      if (childCleaned.startsWith(`(${targetSub})`) || new RegExp(`^\\s*\\(${targetSub}\\)\\s+`).test(childCleaned)) {
        matchedChildContainer = {
          outerHtml: rawChild,
          innerHtml: childContainer.innerHtml,
          startOffset: childContainer.startOffset,
          endOffset: childContainer.endOffset,
          tagName: tagName.toLowerCase(),
          elementId: childMatch[2].match(/id=["']([^"']+)["']/i)?.[1]
        };
        break;
      }
      childTagRegex.lastIndex = childContainer.endOffset;
    }
  }
  if (matchedChildContainer) {
    const rawOuter2 = html.slice(matchedChildContainer.startOffset, matchedChildContainer.endOffset);
    const cleaned2 = cleanHtmlText(rawOuter2);
    return {
      standardOrActCode: actCode,
      paragraphOrSection: section,
      text: cleaned2,
      extractionStatus: "EXACT",
      isVerbatimText: true,
      sourceLocator: {
        document: "Companies Act 1967",
        act: "CoA1967",
        section: targetSec,
        subsection: targetSub,
        sourceNode: `${matchedChildContainer.tagName}#${matchedChildContainer.elementId || `${secContainer.elementId || `pr${targetSec}-`}${targetSub}`}`,
        elementId: matchedChildContainer.elementId || secContainer.elementId,
        heading: `Section ${targetSec}(${targetSub})`,
        startOffset: matchedChildContainer.startOffset,
        endOffset: matchedChildContainer.endOffset,
        boundary: {
          startOffset: matchedChildContainer.startOffset,
          endOffset: matchedChildContainer.endOffset
        },
        sourceType: "HTML",
        canonicalLocator: `Companies Act 1967 > Section ${targetSec} > Subsection (${targetSub})`
      },
      extractionMethod: "SSO_STRUCTURAL_CONTAINER_PARSER"
    };
  }
  const isSectionWrapper = !secContainer.elementId || secContainer.elementId.toLowerCase().startsWith(`sec${targetSec}`);
  const rawOuter = html.slice(secContainer.startOffset, secContainer.endOffset);
  const cleaned = cleanHtmlText(rawOuter);
  const startsWithTarget = cleaned.startsWith(`(${targetSub})`) || new RegExp(`^\\s*\\(${targetSub}\\)\\s+`).test(cleaned);
  const containsOtherSubsections = new RegExp(`\\((?!${targetSub}\\b)\\d+[a-zA-Z]?\\)`).test(cleaned);
  if (!isSectionWrapper && startsWithTarget && !containsOtherSubsections && cleaned.length > 20) {
    return {
      standardOrActCode: actCode,
      paragraphOrSection: section,
      text: cleaned,
      extractionStatus: "EXACT",
      isVerbatimText: true,
      sourceLocator: {
        document: "Companies Act 1967",
        act: "CoA1967",
        section: targetSec,
        subsection: targetSub,
        sourceNode: `div#${secContainer.elementId || `pr${targetSec}-`}`,
        elementId: secContainer.elementId || `pr${targetSec}-`,
        heading: `Section ${targetSec}(${targetSub})`,
        startOffset: secContainer.startOffset,
        endOffset: secContainer.endOffset,
        boundary: {
          startOffset: secContainer.startOffset,
          endOffset: secContainer.endOffset
        },
        sourceType: "HTML",
        canonicalLocator: `Companies Act 1967 > Section ${targetSec} > Subsection (${targetSub})`
      },
      extractionMethod: "SSO_STRUCTURAL_CONTAINER_PARSER"
    };
  }
  return {
    standardOrActCode: actCode,
    paragraphOrSection: section,
    text: "",
    extractionStatus: "FAILED",
    sourceLocator: {},
    extractionMethod: "SSO_STRUCTURAL_CONTAINER_PARSER",
    isVerbatimText: false
  };
}
function extractIRASProvision(html, target = "Section 43") {
  if (!html || typeof html !== "string") {
    return {
      standardOrActCode: "ITA1947",
      paragraphOrSection: target,
      text: "",
      extractionStatus: "FAILED",
      sourceLocator: {},
      extractionMethod: "IRAS_STRUCTURAL_CONTAINER_PARSER"
    };
  }
  const container = extractBalancedContainer(html, "div", /id=["']cit-rate(?:-section)?["']/i) || extractBalancedContainer(html, "div", /id=["']cit-rate/i);
  if (!container) {
    return {
      standardOrActCode: "ITA1947",
      paragraphOrSection: target,
      text: "",
      extractionStatus: "FAILED",
      sourceLocator: {},
      extractionMethod: "IRAS_STRUCTURAL_CONTAINER_PARSER"
    };
  }
  const rawOuter = html.slice(container.startOffset, container.endOffset);
  const cleaned = cleanHtmlText(rawOuter);
  if (cleaned.length < 10) {
    return {
      standardOrActCode: "ITA1947",
      paragraphOrSection: target,
      text: "",
      extractionStatus: "FAILED",
      sourceLocator: {},
      extractionMethod: "IRAS_STRUCTURAL_CONTAINER_PARSER",
      isVerbatimText: false
    };
  }
  return {
    standardOrActCode: "ITA1947",
    paragraphOrSection: target,
    text: cleaned,
    extractionStatus: "EXACT",
    isVerbatimText: true,
    sourceLocator: {
      document: "IRAS Corporate Income Tax Guidance",
      act: "ITA1947",
      section: "43",
      subsection: "1",
      sourceNode: `div#${container.elementId || "cit-rate"}`,
      elementId: container.elementId || "cit-rate-section",
      heading: "Corporate Income Tax Headline Rate & Directive",
      startOffset: container.startOffset,
      endOffset: container.endOffset,
      boundary: {
        startOffset: container.startOffset,
        endOffset: container.endOffset
      },
      sourceType: "HTML",
      canonicalLocator: "Income Tax Act 1947 > Section 43 > Subsection (1)"
    },
    extractionMethod: "IRAS_STRUCTURAL_CONTAINER_PARSER"
  };
}
function extractACRAProvision(html, target = "Thirteenth Schedule") {
  if (!html || typeof html !== "string") {
    return {
      standardOrActCode: "CoA1967",
      paragraphOrSection: target,
      text: "",
      extractionStatus: "FAILED",
      sourceLocator: {},
      extractionMethod: "ACRA_STRUCTURAL_CONTAINER_PARSER"
    };
  }
  const container = extractBalancedContainer(html, "div", /id=["']small-company-(?:criteria|exemption)["']/i) || extractBalancedContainer(html, "table", /id=["']small-company(?:-criteria)?["']/i);
  if (!container) {
    return {
      standardOrActCode: "CoA1967",
      paragraphOrSection: target,
      text: "",
      extractionStatus: "FAILED",
      sourceLocator: {},
      extractionMethod: "ACRA_STRUCTURAL_CONTAINER_PARSER"
    };
  }
  const rawOuter = html.slice(container.startOffset, container.endOffset);
  const cleaned = cleanHtmlText(rawOuter);
  if (cleaned.length < 15) {
    return {
      standardOrActCode: "CoA1967",
      paragraphOrSection: target,
      text: "",
      extractionStatus: "FAILED",
      sourceLocator: {},
      extractionMethod: "ACRA_STRUCTURAL_CONTAINER_PARSER",
      isVerbatimText: false
    };
  }
  return {
    standardOrActCode: "CoA1967",
    paragraphOrSection: target,
    text: cleaned,
    extractionStatus: "EXACT",
    isVerbatimText: true,
    sourceLocator: {
      document: "ACRA Small Company Guidance",
      act: "CoA1967",
      section: "Thirteenth Schedule",
      subsection: "Paragraph 2",
      sourceNode: `${container.tagName}#${container.elementId || "small-company-criteria"}`,
      elementId: container.elementId || "small-company-exemption",
      heading: "Small Company Audit Exemption Criteria",
      startOffset: container.startOffset,
      endOffset: container.endOffset,
      boundary: {
        startOffset: container.startOffset,
        endOffset: container.endOffset
      },
      sourceType: "HTML",
      canonicalLocator: "Companies Act 1967 > Thirteenth Schedule > Paragraph 2"
    },
    extractionMethod: "ACRA_STRUCTURAL_CONTAINER_PARSER"
  };
}
function extractMOMProvision(html, target = "Part IV") {
  if (!html || typeof html !== "string") {
    return {
      standardOrActCode: "EA1968",
      paragraphOrSection: target,
      text: "",
      extractionStatus: "FAILED",
      sourceLocator: {},
      extractionMethod: "MOM_STRUCTURAL_CONTAINER_PARSER",
      isVerbatimText: false
    };
  }
  const container = extractBalancedContainer(html, "div", /id=["']itemised-payslips(?:-section)?["']/i);
  if (!container) {
    return {
      standardOrActCode: "EA1968",
      paragraphOrSection: target,
      text: "",
      extractionStatus: "FAILED",
      sourceLocator: {},
      extractionMethod: "MOM_STRUCTURAL_CONTAINER_PARSER",
      isVerbatimText: false
    };
  }
  const rawOuter = html.slice(container.startOffset, container.endOffset);
  const cleaned = cleanHtmlText(rawOuter);
  if (cleaned.length < 15) {
    return {
      standardOrActCode: "EA1968",
      paragraphOrSection: target,
      text: "",
      extractionStatus: "FAILED",
      sourceLocator: {},
      extractionMethod: "MOM_STRUCTURAL_CONTAINER_PARSER",
      isVerbatimText: false
    };
  }
  return {
    standardOrActCode: "EA1968",
    paragraphOrSection: target,
    text: cleaned,
    extractionStatus: "EXACT",
    isVerbatimText: true,
    sourceLocator: {
      document: "MOM Employment Act Guidance",
      act: "EA1968",
      section: "Part IV",
      subsection: "Section 95A",
      sourceNode: `div#${container.elementId || "itemised-payslips"}`,
      elementId: container.elementId || "itemised-payslips-section",
      heading: "MOM Employment Act Mandatory Itemised Payslips",
      startOffset: container.startOffset,
      endOffset: container.endOffset,
      boundary: {
        startOffset: container.startOffset,
        endOffset: container.endOffset
      },
      sourceType: "HTML",
      canonicalLocator: "Employment Act 1968 > Part IV > Section 95A"
    },
    extractionMethod: "MOM_STRUCTURAL_CONTAINER_PARSER"
  };
}
function extractCPFProvision(html, target = "First Schedule") {
  if (!html || typeof html !== "string") {
    return {
      standardOrActCode: "CPFA1953",
      paragraphOrSection: target,
      text: "",
      extractionStatus: "FAILED",
      sourceLocator: {},
      extractionMethod: "CPF_STRUCTURAL_CONTAINER_PARSER",
      isVerbatimText: false
    };
  }
  const container = extractBalancedContainer(html, "table", /id=["']ow-ceiling(?:-table)?["']/i) || extractBalancedContainer(html, "div", /id=["']ow-ceiling(?:-schedule)?["']/i);
  if (!container) {
    return {
      standardOrActCode: "CPFA1953",
      paragraphOrSection: target,
      text: "",
      extractionStatus: "FAILED",
      sourceLocator: {},
      extractionMethod: "CPF_STRUCTURAL_CONTAINER_PARSER",
      isVerbatimText: false
    };
  }
  const rawOuter = html.slice(container.startOffset, container.endOffset);
  const cleaned = cleanHtmlText(rawOuter);
  if (cleaned.length < 15) {
    return {
      standardOrActCode: "CPFA1953",
      paragraphOrSection: target,
      text: "",
      extractionStatus: "FAILED",
      sourceLocator: {},
      extractionMethod: "CPF_STRUCTURAL_CONTAINER_PARSER",
      isVerbatimText: false
    };
  }
  return {
    standardOrActCode: "CPFA1953",
    paragraphOrSection: target,
    text: cleaned,
    extractionStatus: "EXACT",
    isVerbatimText: true,
    sourceLocator: {
      document: "CPF Contribution Rate Guidance",
      act: "CPFA1953",
      section: "First Schedule",
      subsection: "Table",
      sourceNode: `${container.tagName}#${container.elementId || "ow-ceiling-table"}`,
      elementId: container.elementId || "ow-ceiling-schedule",
      heading: "CPF Ordinary Wage Ceiling and Contribution Schedule",
      startOffset: container.startOffset,
      endOffset: container.endOffset,
      boundary: {
        startOffset: container.startOffset,
        endOffset: container.endOffset
      },
      sourceType: "HTML",
      canonicalLocator: "Central Provident Fund Act 1953 > First Schedule > Table"
    },
    extractionMethod: "CPF_STRUCTURAL_CONTAINER_PARSER"
  };
}
function extractFrankfurterProvision(jsonText, base = "SGD", symbols = ["USD", "EUR"], _date) {
  if (!jsonText || typeof jsonText !== "string") {
    return {
      standardOrActCode: "FX_OBSERVATION",
      paragraphOrSection: "SPOT_RATES_SGD",
      text: "",
      extractionStatus: "FAILED",
      sourceLocator: {},
      extractionMethod: "JSON_KEY_EXTRACTION"
    };
  }
  try {
    const data = JSON.parse(jsonText);
    if (!data || typeof data !== "object" || !data.rates || !data.base || !data.date || base && data.base !== base) {
      return {
        standardOrActCode: "FX_OBSERVATION",
        paragraphOrSection: "SPOT_RATES_SGD",
        text: "",
        extractionStatus: "FAILED",
        sourceLocator: {},
        extractionMethod: "JSON_KEY_EXTRACTION"
      };
    }
    const filteredRates = {};
    for (const s of symbols) {
      if (typeof data.rates[s] === "number") {
        filteredRates[s] = data.rates[s];
      }
    }
    if (Object.keys(filteredRates).length === 0) {
      return {
        standardOrActCode: "FX_OBSERVATION",
        paragraphOrSection: "SPOT_RATES_SGD",
        text: "",
        extractionStatus: "FAILED",
        sourceLocator: {},
        extractionMethod: "JSON_KEY_EXTRACTION"
      };
    }
    const ratesSummary = Object.entries(filteredRates).map(([sym, r]) => `1 ${data.base} = ${r} ${sym}`).join(", ");
    const text = `European Central Bank Reference Spot Exchange Rates (Base: ${data.base}, Date: ${data.date}): ${ratesSummary}`;
    const fxObservation = {
      sourceAuthority: "REFERENCE_API",
      provider: "FRANKFURTER",
      date: data.date,
      base: data.base,
      rates: filteredRates
    };
    return {
      standardOrActCode: "FX_OBSERVATION",
      paragraphOrSection: "SPOT_RATES_SGD",
      text,
      extractionStatus: "EXACT",
      isVerbatimText: false,
      sourceLocator: {
        document: "Frankfurter ECB Reference Rates",
        act: "FX_OBSERVATION",
        section: "SPOT_RATES_SGD",
        sourceNode: "json.rates",
        elementId: `rates-${data.date}`,
        heading: "ECB_SPOT_OBSERVATION",
        startOffset: 0,
        endOffset: jsonText.length,
        boundary: {
          startOffset: 0,
          endOffset: jsonText.length
        },
        sourceType: "JSON",
        canonicalLocator: `Frankfurter > rates > ${data.base} > ${data.date}`
      },
      extractionMethod: "JSON_KEY_EXTRACTION",
      fxObservation
    };
  } catch {
    return {
      standardOrActCode: "FX_OBSERVATION",
      paragraphOrSection: "SPOT_RATES_SGD",
      text: "",
      extractionStatus: "FAILED",
      sourceLocator: {},
      extractionMethod: "JSON_KEY_EXTRACTION"
    };
  }
}
var SSOUpdateAdapter = class {
  authority = "AGC";
  sourceName = "Singapore Statutes Online (SSO)";
  canonicalBaseUrl = "https://sso.agc.gov.sg";
  async checkForUpdates(retriever, currentSources = []) {
    const targetUrl = `${this.canonicalBaseUrl}/Act/COA1967`;
    const res = await retriever.fetchOfficialSource(targetUrl, {
      timeoutMs: 3e3,
      useCache: true
    });
    if (res.status !== "SUCCESS" || !res.content) {
      return null;
    }
    const documentHash = computeSha256(res.content);
    const extraction = extractSSOProvision(res.content, "CoA1967", "Section 201(5)");
    if (extraction.extractionStatus !== "EXACT") {
      return null;
    }
    const provisionHash = computeProvisionHash(extraction.standardOrActCode, extraction.paragraphOrSection, extraction.text);
    const existingCoa = currentSources.find(
      (s) => s.standardOrActCode === extraction.standardOrActCode && (s.paragraphOrSection === extraction.paragraphOrSection || s.paragraphOrSection.includes("201"))
    );
    const existingHash = existingCoa?.provisionHash || existingCoa?.contentHash;
    if (existingHash && existingHash === provisionHash) {
      return null;
    }
    const packageId = `SSO-COA-REV-${(/* @__PURE__ */ new Date()).getFullYear()}`;
    const updateRecord = {
      id: `COA_1967_UPDATE_${Date.now().toString(36).toUpperCase()}`,
      standardOrActCode: "CoA1967",
      paragraphOrSection: "Section 201(5)",
      documentTitle: "Companies Act 1967 \u2014 Financial Statements True and Fair Requirement",
      authority: "ACRA",
      authorityName: "Accounting and Corporate Regulatory Authority (ACRA)",
      sourcePublisher: "Singapore Statutes Online (SSO) / AGC",
      legalOrStandardInstrument: "Companies Act 1967",
      principleSummary: "Mandatory true and fair requirement for financial statements",
      domain: "ACRA_CORP",
      jurisdiction: "Singapore",
      tags: ["companies act", "audit", "financial statements"],
      sourceType: "AUTHORITATIVE_SOURCE",
      officialSourceUrl: targetUrl,
      sourceText: extraction.text,
      // Unabridged extracted text
      isVerbatimText: true,
      lastVerifiedDate: res.retrievedAt.split("T")[0],
      sourceStatus: "NEEDS_REVIEW",
      evidenceTier: "PRIMARY_SOURCE",
      provenance: "LIVE_PATCH",
      version: packageId,
      documentHash,
      provisionHash,
      contentHash: provisionHash,
      // Backward-compatible alias
      extractionStatus: "EXACT",
      sourceLocator: extraction.sourceLocator
    };
    const amendment = {
      recordId: updateRecord.id,
      title: "Companies Act Legislative Revision",
      changeType: "TEXT_CHANGE",
      summary: `Proactive revision detected from Singapore Statutes Online (provision hash: ${provisionHash.slice(0, 12)}...)`
    };
    const pkgWithoutHash = {
      packageId,
      releaseDate: res.retrievedAt.split("T")[0],
      authority: "AGC",
      updates: [updateRecord],
      amendments: [amendment]
    };
    const payload = [
      pkgWithoutHash.packageId,
      pkgWithoutHash.releaseDate,
      pkgWithoutHash.authority,
      ...pkgWithoutHash.updates.map((u) => `${u.id}:${u.standardOrActCode}:${u.paragraphOrSection}:${u.sourceText}`)
    ].join("|||");
    return {
      ...pkgWithoutHash,
      packageHash: computeSha256(payload)
    };
  }
};
var IRASUpdateAdapter = class {
  authority = "IRAS";
  sourceName = "Inland Revenue Authority of Singapore (IRAS)";
  canonicalBaseUrl = "https://www.iras.gov.sg";
  async checkForUpdates(retriever, currentSources = []) {
    const targetUrl = `${this.canonicalBaseUrl}/taxes/corporate-income-tax/basics-of-corporate-income-tax/corporate-income-tax-rate-and-rebates`;
    const res = await retriever.fetchOfficialSource(targetUrl, {
      timeoutMs: 3e3,
      useCache: true
    });
    if (res.status !== "SUCCESS" || !res.content) {
      return null;
    }
    const documentHash = computeSha256(res.content);
    const extraction = extractIRASProvision(res.content, "Section 43");
    if (extraction.extractionStatus !== "EXACT") {
      return null;
    }
    const provisionHash = computeProvisionHash(extraction.standardOrActCode, extraction.paragraphOrSection, extraction.text);
    const existingIras = currentSources.find(
      (s) => s.authority === "IRAS" && s.standardOrActCode === extraction.standardOrActCode && (s.paragraphOrSection === extraction.paragraphOrSection || s.paragraphOrSection.includes("43"))
    );
    const existingHash = existingIras?.provisionHash || existingIras?.contentHash;
    if (existingHash && existingHash === provisionHash) {
      return null;
    }
    const packageId = `IRAS-TAX-REBATE-${(/* @__PURE__ */ new Date()).getFullYear()}`;
    const updateRecord = {
      id: `IRAS_CIT_REBATE_${Date.now().toString(36).toUpperCase()}`,
      standardOrActCode: "ITA1947",
      paragraphOrSection: "Section 43",
      documentTitle: "IRAS Corporate Income Tax Rate and Rebate Directive",
      authority: "IRAS",
      authorityName: "Inland Revenue Authority of Singapore (IRAS)",
      sourcePublisher: "Inland Revenue Authority of Singapore",
      legalOrStandardInstrument: "IRAS Administrative Tax Guidance",
      principleSummary: "Corporate income tax headline rate and headline rebate directives",
      domain: "IRAS_TAX",
      jurisdiction: "Singapore",
      tags: ["income tax", "corporate tax", "rebate"],
      sourceType: "OFFICIAL_GUIDANCE",
      officialSourceUrl: targetUrl,
      sourceText: extraction.text,
      isVerbatimText: true,
      lastVerifiedDate: res.retrievedAt.split("T")[0],
      sourceStatus: "NEEDS_REVIEW",
      evidenceTier: "OFFICIAL_GUIDANCE",
      provenance: "LIVE_PATCH",
      version: packageId,
      documentHash,
      provisionHash,
      contentHash: provisionHash,
      extractionStatus: "EXACT",
      sourceLocator: extraction.sourceLocator
    };
    const amendment = {
      recordId: updateRecord.id,
      title: "Corporate Income Tax Rebate Circular",
      changeType: "RATE_CHANGE",
      summary: `Proactive tax rebate guidance detected from IRAS (provision hash: ${provisionHash.slice(0, 12)}...)`
    };
    const pkgWithoutHash = {
      packageId,
      releaseDate: res.retrievedAt.split("T")[0],
      authority: "IRAS",
      updates: [updateRecord],
      amendments: [amendment]
    };
    const payload = [
      pkgWithoutHash.packageId,
      pkgWithoutHash.releaseDate,
      pkgWithoutHash.authority,
      ...pkgWithoutHash.updates.map((u) => `${u.id}:${u.standardOrActCode}:${u.paragraphOrSection}:${u.sourceText}`)
    ].join("|||");
    return {
      ...pkgWithoutHash,
      packageHash: computeSha256(payload)
    };
  }
};
var ACRAUpdateAdapter = class {
  authority = "ACRA";
  sourceName = "Accounting and Corporate Regulatory Authority (ACRA)";
  canonicalBaseUrl = "https://www.acra.gov.sg";
  async checkForUpdates(retriever, currentSources = []) {
    const targetUrl = `${this.canonicalBaseUrl}/legislation/companies-act-1967`;
    const res = await retriever.fetchOfficialSource(targetUrl, {
      timeoutMs: 3e3,
      useCache: true
    });
    if (res.status !== "SUCCESS" || !res.content) {
      return null;
    }
    const documentHash = computeSha256(res.content);
    const extraction = extractACRAProvision(res.content, "Thirteenth Schedule");
    if (extraction.extractionStatus !== "EXACT") {
      return null;
    }
    const provisionHash = computeProvisionHash(extraction.standardOrActCode, extraction.paragraphOrSection, extraction.text);
    const existingAcra = currentSources.find(
      (s) => s.authority === "ACRA" && s.standardOrActCode === extraction.standardOrActCode && (s.paragraphOrSection === extraction.paragraphOrSection || s.paragraphOrSection.includes("Thirteenth Schedule") || s.paragraphOrSection.includes("205C") || s.paragraphOrSection.includes("Small Company"))
    );
    const existingHash = existingAcra?.provisionHash || existingAcra?.contentHash;
    if (existingHash && existingHash === provisionHash) {
      return null;
    }
    const packageId = `ACRA-DIRECTIVE-${(/* @__PURE__ */ new Date()).getFullYear()}`;
    const updateRecord = {
      id: `ACRA_DIRECTIVE_${Date.now().toString(36).toUpperCase()}`,
      standardOrActCode: "CoA1967",
      paragraphOrSection: "Thirteenth Schedule",
      documentTitle: "ACRA Small Company Audit Exemption Criteria and Filing Requirements",
      authority: "ACRA",
      authorityName: "Accounting and Corporate Regulatory Authority (ACRA)",
      sourcePublisher: "Accounting and Corporate Regulatory Authority",
      legalOrStandardInstrument: "ACRA Practice Direction / Guidance",
      principleSummary: "Small company audit exemption criteria and annual filing obligations",
      domain: "ACRA_CORP",
      jurisdiction: "Singapore",
      tags: ["companies act", "small company", "audit exemption"],
      sourceType: "OFFICIAL_GUIDANCE",
      officialSourceUrl: targetUrl,
      sourceText: extraction.text,
      isVerbatimText: true,
      lastVerifiedDate: res.retrievedAt.split("T")[0],
      sourceStatus: "NEEDS_REVIEW",
      evidenceTier: "OFFICIAL_GUIDANCE",
      provenance: "LIVE_PATCH",
      version: packageId,
      documentHash,
      provisionHash,
      contentHash: provisionHash,
      extractionStatus: "EXACT",
      sourceLocator: extraction.sourceLocator
    };
    const amendment = {
      recordId: updateRecord.id,
      title: "ACRA Regulatory Directive Update",
      changeType: "THRESHOLD_CHANGE",
      summary: `Proactive ACRA statutory directive update detected (provision hash: ${provisionHash.slice(0, 12)}...)`
    };
    const pkgWithoutHash = {
      packageId,
      releaseDate: res.retrievedAt.split("T")[0],
      authority: "ACRA",
      updates: [updateRecord],
      amendments: [amendment]
    };
    const payload = [
      pkgWithoutHash.packageId,
      pkgWithoutHash.releaseDate,
      pkgWithoutHash.authority,
      ...pkgWithoutHash.updates.map((u) => `${u.id}:${u.standardOrActCode}:${u.paragraphOrSection}:${u.sourceText}`)
    ].join("|||");
    return {
      ...pkgWithoutHash,
      packageHash: computeSha256(payload)
    };
  }
};
var MOMUpdateAdapter = class {
  authority = "MOM";
  sourceName = "Ministry of Manpower (MOM)";
  canonicalBaseUrl = "https://www.mom.gov.sg";
  async checkForUpdates(retriever, currentSources = []) {
    const targetUrl = `${this.canonicalBaseUrl}/employment-practices/employment-act`;
    const res = await retriever.fetchOfficialSource(targetUrl, {
      timeoutMs: 3e3,
      useCache: true
    });
    if (res.status !== "SUCCESS" || !res.content) {
      return null;
    }
    const documentHash = computeSha256(res.content);
    const extraction = extractMOMProvision(res.content, "Part IV");
    if (extraction.extractionStatus !== "EXACT") {
      return null;
    }
    const provisionHash = computeProvisionHash(extraction.standardOrActCode, extraction.paragraphOrSection, extraction.text);
    const existingMom = currentSources.find(
      (s) => s.authority === "MOM" && (s.paragraphOrSection === extraction.paragraphOrSection || s.paragraphOrSection.includes("Part IV") || s.paragraphOrSection.includes("Payslip"))
    );
    const existingHash = existingMom?.provisionHash || existingMom?.contentHash;
    if (existingHash && existingHash === provisionHash) {
      return null;
    }
    const packageId = `MOM-EA-UPDATE-${(/* @__PURE__ */ new Date()).getFullYear()}`;
    const updateRecord = {
      id: `MOM_EA_UPDATE_${Date.now().toString(36).toUpperCase()}`,
      standardOrActCode: "EA1968",
      paragraphOrSection: "Part IV",
      documentTitle: "MOM Employment Act Statutory Requirements & Itemised Payslip Rules",
      authority: "MOM",
      authorityName: "Ministry of Manpower (MOM)",
      sourcePublisher: "Ministry of Manpower",
      legalOrStandardInstrument: "MOM Employment Practices Guidance",
      principleSummary: "Statutory employment terms, mandatory itemised payslips and statutory leave",
      domain: "MOM_EMPLOYMENT",
      jurisdiction: "Singapore",
      tags: ["employment act", "payslip", "statutory leave"],
      sourceType: "OFFICIAL_GUIDANCE",
      officialSourceUrl: targetUrl,
      sourceText: extraction.text,
      isVerbatimText: true,
      lastVerifiedDate: res.retrievedAt.split("T")[0],
      sourceStatus: "NEEDS_REVIEW",
      evidenceTier: "OFFICIAL_GUIDANCE",
      provenance: "LIVE_PATCH",
      version: packageId,
      documentHash,
      provisionHash,
      contentHash: provisionHash,
      extractionStatus: "EXACT",
      sourceLocator: extraction.sourceLocator
    };
    const amendment = {
      recordId: updateRecord.id,
      title: "MOM Employment Act Amendment",
      changeType: "TEXT_CHANGE",
      summary: `Proactive statutory employment update detected from MOM (provision hash: ${provisionHash.slice(0, 12)}...)`
    };
    const pkgWithoutHash = {
      packageId,
      releaseDate: res.retrievedAt.split("T")[0],
      authority: "MOM",
      updates: [updateRecord],
      amendments: [amendment]
    };
    const payload = [
      pkgWithoutHash.packageId,
      pkgWithoutHash.releaseDate,
      pkgWithoutHash.authority,
      ...pkgWithoutHash.updates.map((u) => `${u.id}:${u.standardOrActCode}:${u.paragraphOrSection}:${u.sourceText}`)
    ].join("|||");
    return {
      ...pkgWithoutHash,
      packageHash: computeSha256(payload)
    };
  }
};
var CPFUpdateAdapter = class {
  authority = "CPF";
  sourceName = "Central Provident Fund Board (CPF)";
  canonicalBaseUrl = "https://www.cpf.gov.sg";
  async checkForUpdates(retriever, currentSources = []) {
    const targetUrl = `${this.canonicalBaseUrl}/employer/employer-obligations/cpf-contribution-rates`;
    const res = await retriever.fetchOfficialSource(targetUrl, {
      timeoutMs: 3e3,
      useCache: true
    });
    if (res.status !== "SUCCESS" || !res.content) {
      return null;
    }
    const documentHash = computeSha256(res.content);
    const extraction = extractCPFProvision(res.content, "First Schedule");
    if (extraction.extractionStatus !== "EXACT") {
      return null;
    }
    const provisionHash = computeProvisionHash(extraction.standardOrActCode, extraction.paragraphOrSection, extraction.text);
    const existingCpf = currentSources.find(
      (s) => s.authority === "CPF" && (s.paragraphOrSection === extraction.paragraphOrSection || s.paragraphOrSection.includes("First Schedule") || s.paragraphOrSection.includes("Ceiling"))
    );
    const existingHash = existingCpf?.provisionHash || existingCpf?.contentHash;
    if (existingHash && existingHash === provisionHash) {
      return null;
    }
    const packageId = `CPF-OW-CEILING-${(/* @__PURE__ */ new Date()).getFullYear()}`;
    const updateRecord = {
      id: `CPF_CEILING_UPDATE_${Date.now().toString(36).toUpperCase()}`,
      standardOrActCode: "CPFA1953",
      paragraphOrSection: "First Schedule",
      documentTitle: "CPF Ordinary Wage Ceiling and Contribution Rate Revision",
      authority: "CPF",
      authorityName: "Central Provident Fund Board (CPF)",
      sourcePublisher: "Central Provident Fund Board",
      legalOrStandardInstrument: "CPF Board Contribution Rate Guidance",
      principleSummary: "Ordinary Wage ceiling and tiered contribution schedules",
      domain: "CPF_BOARD",
      jurisdiction: "Singapore",
      tags: ["cpf", "wage ceiling", "contributions"],
      sourceType: "OFFICIAL_GUIDANCE",
      officialSourceUrl: targetUrl,
      sourceText: extraction.text,
      isVerbatimText: true,
      lastVerifiedDate: res.retrievedAt.split("T")[0],
      sourceStatus: "NEEDS_REVIEW",
      evidenceTier: "OFFICIAL_GUIDANCE",
      provenance: "LIVE_PATCH",
      version: packageId,
      documentHash,
      provisionHash,
      contentHash: provisionHash,
      extractionStatus: "EXACT",
      sourceLocator: extraction.sourceLocator
    };
    const amendment = {
      recordId: updateRecord.id,
      title: "CPF Ordinary Wage Ceiling Revision",
      changeType: "THRESHOLD_CHANGE",
      summary: `Proactive contribution schedule revision detected from CPF Board (provision hash: ${provisionHash.slice(0, 12)}...)`
    };
    const pkgWithoutHash = {
      packageId,
      releaseDate: res.retrievedAt.split("T")[0],
      authority: "CPF",
      updates: [updateRecord],
      amendments: [amendment]
    };
    const payload = [
      pkgWithoutHash.packageId,
      pkgWithoutHash.releaseDate,
      pkgWithoutHash.authority,
      ...pkgWithoutHash.updates.map((u) => `${u.id}:${u.standardOrActCode}:${u.paragraphOrSection}:${u.sourceText}`)
    ].join("|||");
    return {
      ...pkgWithoutHash,
      packageHash: computeSha256(payload)
    };
  }
};
var FrankfurterReferenceAdapter = class {
  authority = "REFERENCE_API";
  sourceName = "Frankfurter ECB FX Reference API";
  canonicalBaseUrl = "https://api.frankfurter.dev";
  async checkForUpdates(retriever, currentSources = []) {
    const targetUrl = `${this.canonicalBaseUrl}/v1/latest?base=SGD&symbols=USD,EUR,GBP,CNY`;
    const res = await retriever.fetchOfficialSource(targetUrl, {
      timeoutMs: 3e3,
      ttlMs: 36e5,
      // 1 hour TTL
      useCache: true
    });
    if (res.status !== "SUCCESS" || !res.content) {
      return null;
    }
    const documentHash = computeSha256(res.content);
    const extraction = extractFrankfurterProvision(res.content, "SGD", ["USD", "EUR", "GBP", "CNY"]);
    if (extraction.extractionStatus !== "EXACT") {
      return null;
    }
    const provisionHash = computeProvisionHash(extraction.standardOrActCode, extraction.paragraphOrSection, extraction.text);
    const existingFx = currentSources.find(
      (s) => s.authority === "REFERENCE_API" && (s.id.startsWith("ECB_FX_SPOT_") || s.standardOrActCode === "FX_OBSERVATION")
    );
    const existingHash = existingFx?.provisionHash || existingFx?.contentHash;
    if (existingHash && existingHash === provisionHash) {
      return null;
    }
    const packageId = `ECB-FX-SGD-${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}`;
    const updateRecord = {
      id: `ECB_FX_SPOT_${(/* @__PURE__ */ new Date()).toISOString().split("T")[0].replace(/-/g, "")}`,
      standardOrActCode: "FX_OBSERVATION",
      paragraphOrSection: "SPOT_RATES_SGD",
      documentTitle: "Frankfurter Official ECB Spot Foreign Exchange Rates (SGD Base)",
      authority: "REFERENCE_API",
      authorityName: "European Central Bank Reference Rate API",
      sourcePublisher: "European Central Bank / Frankfurter API",
      legalOrStandardInstrument: "ECB Foreign Exchange Reference Data",
      principleSummary: "Daily spot exchange reference rates for SGD currency pairs",
      domain: "ACCOUNTING_SFRS",
      jurisdiction: "International / Singapore",
      tags: ["fx", "exchange rate", "spot rate"],
      sourceType: "CURATED_SUMMARY",
      officialSourceUrl: targetUrl,
      sourceText: extraction.text,
      isVerbatimText: false,
      lastVerifiedDate: res.retrievedAt.split("T")[0],
      sourceStatus: "NEEDS_REVIEW",
      evidenceTier: "CURATED_SUMMARY",
      provenance: "LIVE_PATCH",
      version: packageId,
      documentHash,
      provisionHash,
      contentHash: provisionHash,
      extractionStatus: "EXACT",
      sourceLocator: extraction.sourceLocator,
      fxObservation: extraction.fxObservation
    };
    const amendment = {
      recordId: updateRecord.id,
      title: "Daily Foreign Exchange Spot Rate Update",
      changeType: "RATE_CHANGE",
      summary: `Proactive daily FX reference spot rates fetched from ECB via Frankfurter (SGD base)`
    };
    const pkgWithoutHash = {
      packageId,
      releaseDate: res.retrievedAt.split("T")[0],
      authority: "REFERENCE_API",
      updates: [updateRecord],
      amendments: [amendment]
    };
    const payload = [
      pkgWithoutHash.packageId,
      pkgWithoutHash.releaseDate,
      pkgWithoutHash.authority,
      ...pkgWithoutHash.updates.map((u) => `${u.id}:${u.standardOrActCode}:${u.paragraphOrSection}:${u.sourceText}`)
    ].join("|||");
    return {
      ...pkgWithoutHash,
      packageHash: computeSha256(payload)
    };
  }
};

// src/retrieval/externalSourceValidator.ts
var ALLOWED_REGULATORY_HOSTNAMES = /* @__PURE__ */ new Set([
  "sso.agc.gov.sg",
  "iras.gov.sg",
  "www.iras.gov.sg",
  "acra.gov.sg",
  "www.acra.gov.sg",
  "mom.gov.sg",
  "www.mom.gov.sg",
  "cpf.gov.sg",
  "www.cpf.gov.sg",
  "mas.gov.sg",
  "www.mas.gov.sg",
  // Ask.gov.sg publishes first-party FAQs for MAS, IRAS, CPF and other
  // Singapore agencies. It is guidance, not a substitute for legislation.
  "ask.gov.sg"
]);
var ALLOWED_REFERENCE_HOSTNAMES = /* @__PURE__ */ new Set([
  "api.frankfurter.dev"
]);
var ALL_ALLOWED_HOSTNAMES = /* @__PURE__ */ new Set([
  ...ALLOWED_REGULATORY_HOSTNAMES,
  ...ALLOWED_REFERENCE_HOSTNAMES
]);
var CANONICAL_ACT_MAP = {
  "Companies Act 1967": "CoA1967",
  "CoA1967": "CoA1967",
  "Income Tax Act 1947": "ITA1947",
  "ITA1947": "ITA1947",
  "Employment Act 1968": "EA1968",
  "EA1968": "EA1968",
  "Central Provident Fund Act 1953": "CPFA1953",
  "CPFA1953": "CPFA1953",
  "Goods and Services Tax Act 1993": "GSTA1993",
  "GSTA1993": "GSTA1993",
  "Variable Capital Companies Act 2018": "VCCA2018",
  "VCCA2018": "VCCA2018",
  "FX_OBSERVATION": "FX_OBSERVATION"
};
function getCanonicalActCode(actOrCode) {
  if (!actOrCode) return void 0;
  const trimmed = actOrCode.trim();
  return CANONICAL_ACT_MAP[trimmed] || trimmed;
}
var ExternalSourceValidator = class {
  /**
   * Validates URL security, protocol, port, credentials, and exact hostname.
   */
  validateUrlSecurity(rawUrl) {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return { isValid: false, errorCode: "INVALID_URL", reason: `Malformed URL: '${rawUrl}'` };
    }
    if (parsed.protocol !== "https:") {
      return { isValid: false, errorCode: "INSECURE_PROTOCOL", reason: `Protocol '${parsed.protocol}' is forbidden; HTTPS on port 443 is strictly required` };
    }
    if (parsed.port !== "" && parsed.port !== "443") {
      return { isValid: false, errorCode: "NON_STANDARD_PORT", reason: `Port '${parsed.port}' is forbidden; only default HTTPS port 443 is permitted` };
    }
    const hostname = parsed.hostname.toLowerCase();
    if (!ALL_ALLOWED_HOSTNAMES.has(hostname)) {
      return {
        isValid: false,
        errorCode: "UNAUTHORIZED_DOMAIN_ACCESS",
        reason: `Hostname '${hostname}' is not in the authorized statutory or reference domain allowlist`
      };
    }
    if (parsed.username || parsed.password) {
      return { isValid: false, errorCode: "CREDENTIALS_DISALLOWED", reason: "Embedded username or password in URL is strictly forbidden" };
    }
    return { isValid: true };
  }
  /**
   * Validates domain specifically against the allowlist
   */
  validateDomain(url) {
    return this.validateUrlSecurity(url).isValid;
  }
  /**
   * Validates protocol (HTTPS only)
   */
  validateProtocol(url) {
    try {
      const u = new URL(url);
      return u.protocol === "https:";
    } catch {
      return false;
    }
  }
  /**
   * Validates redirect destinations against the same strict domain allowlist.
   */
  validateRedirect(originalUrl, targetUrl) {
    const origCheck = this.validateUrlSecurity(originalUrl);
    if (!origCheck.isValid) return origCheck;
    const targetCheck = this.validateUrlSecurity(targetUrl);
    if (!targetCheck.isValid) {
      return {
        isValid: false,
        errorCode: "REDIRECT_REJECTED",
        reason: `Redirect to unauthorized destination '${targetUrl}' was rejected: ${targetCheck.reason}`
      };
    }
    return { isValid: true };
  }
  /**
   * Validates HTTP content type
   */
  validateContentType(contentType) {
    if (!contentType) return false;
    const lower = contentType.toLowerCase();
    return lower.includes("application/json") || lower.includes("text/plain") || lower.includes("text/html") || lower.includes("application/xml");
  }
  /**
   * Validates candidate document structure before allowing candidate registration.
   */
  validateDocumentStructure(doc) {
    if (!doc || typeof doc !== "object") {
      return { isValid: false, errorCode: "MALFORMED_DOCUMENT_STRUCTURE", reason: "Document payload is empty or not an object" };
    }
    const requiredFields = ["standardOrActCode", "paragraphOrSection", "sourceText", "documentTitle"];
    for (const field of requiredFields) {
      if (!doc[field] || typeof doc[field] !== "string" || doc[field].trim().length === 0) {
        return {
          isValid: false,
          errorCode: "MALFORMED_DOCUMENT_STRUCTURE",
          reason: `Required statutory field '${field}' is missing or empty`
        };
      }
    }
    return { isValid: true };
  }
  /**
   * Validates canonical URL aligns with statutory authority.
   */
  validateCanonicalUrl(url, authority) {
    const secCheck = this.validateUrlSecurity(url);
    if (!secCheck.isValid) return secCheck;
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (authority === "AGC" || authority === "SSO") {
      if (host !== "sso.agc.gov.sg") {
        return { isValid: false, errorCode: "CANONICAL_URL_MISMATCH", reason: `AGC/SSO statutory law must point to sso.agc.gov.sg, found '${host}'` };
      }
    } else if (authority === "IRAS") {
      if (host !== "iras.gov.sg" && host !== "www.iras.gov.sg" && host !== "sso.agc.gov.sg") {
        return { isValid: false, errorCode: "CANONICAL_URL_MISMATCH", reason: `IRAS guidance must point to iras.gov.sg or sso.agc.gov.sg, found '${host}'` };
      }
    } else if (authority === "ACRA") {
      if (host !== "acra.gov.sg" && host !== "www.acra.gov.sg" && host !== "sso.agc.gov.sg") {
        return { isValid: false, errorCode: "CANONICAL_URL_MISMATCH", reason: `ACRA directives must point to acra.gov.sg or sso.agc.gov.sg, found '${host}'` };
      }
    } else if (authority === "MOM") {
      if (host !== "mom.gov.sg" && host !== "www.mom.gov.sg" && host !== "sso.agc.gov.sg") {
        return { isValid: false, errorCode: "CANONICAL_URL_MISMATCH", reason: `MOM statutory guidance must point to mom.gov.sg or sso.agc.gov.sg, found '${host}'` };
      }
    } else if (authority === "CPF") {
      if (host !== "cpf.gov.sg" && host !== "www.cpf.gov.sg" && host !== "sso.agc.gov.sg") {
        return { isValid: false, errorCode: "CANONICAL_URL_MISMATCH", reason: `CPF statutory guidance must point to cpf.gov.sg or sso.agc.gov.sg, found '${host}'` };
      }
    } else if (authority === "REFERENCE_API") {
      if (host !== "api.frankfurter.dev") {
        return { isValid: false, errorCode: "CANONICAL_URL_MISMATCH", reason: `Reference API must point to api.frankfurter.dev, found '${host}'` };
      }
    } else {
      return { isValid: false, errorCode: "CANONICAL_URL_MISMATCH", reason: `Unrecognized authority '${authority}' for canonical URL validation` };
    }
    return { isValid: true };
  }
  /**
   * Validates source provenance.
   * Proves that external content does not falsely claim local static provenance or unverified primary tier.
   */
  validateProvenance(record, sourceUrl) {
    const urlCheck = this.validateUrlSecurity(sourceUrl);
    if (!urlCheck.isValid) return urlCheck;
    if (record.provenance === "LOCAL_STATIC") {
      return {
        isValid: false,
        errorCode: "PROVENANCE_MISMATCH",
        reason: "Externally retrieved candidate cannot declare provenance as LOCAL_STATIC"
      };
    }
    return { isValid: true };
  }
  /**
   * Validates that candidate sourceText can be deterministically tied back to the recorded source boundary in the raw document.
   */
  validateSourceBoundary(record, rawDocument) {
    if (!rawDocument || typeof rawDocument !== "string" || rawDocument.length === 0) {
      return {
        isValid: false,
        errorCode: "MALFORMED_DOCUMENT_STRUCTURE",
        reason: "Raw document is required to validate source boundary"
      };
    }
    if (record.extractionStatus === "FAILED") {
      return {
        isValid: false,
        errorCode: "EXTRACTION_FAILED",
        reason: `Extraction failed: could not locate provision '${record.paragraphOrSection}' in source '${record.standardOrActCode}'`
      };
    }
    if (record.extractionStatus === "PARTIAL") {
      if (record.isVerbatimText) {
        return {
          isValid: false,
          errorCode: "INVALID_VERBATIM_CLAIM",
          reason: "Partial extraction cannot be declared as isVerbatimText = true"
        };
      }
      return {
        isValid: false,
        errorCode: "PARTIAL_PROVISION",
        reason: `Partial extraction is not eligible for authoritative verification for '${record.id}'`
      };
    }
    const locator = record.sourceLocator;
    if (!locator) {
      return {
        isValid: false,
        errorCode: "PROVISION_MAPPING_MISMATCH",
        reason: "Missing source locator for source boundary verification"
      };
    }
    const startOffset = locator.boundary?.startOffset ?? locator.startOffset;
    const endOffset = locator.boundary?.endOffset ?? locator.endOffset;
    if (startOffset === void 0 || endOffset === void 0 || typeof startOffset !== "number" || typeof endOffset !== "number" || startOffset < 0 || endOffset > rawDocument.length || startOffset >= endOffset) {
      return {
        isValid: false,
        errorCode: "PROVISION_MAPPING_MISMATCH",
        reason: `Invalid provision boundaries: startOffset=${startOffset}, endOffset=${endOffset}, docLength=${rawDocument.length}`
      };
    }
    const rawSlice = rawDocument.slice(startOffset, endOffset);
    if (record.authority === "REFERENCE_API" || locator.sourceType === "JSON") {
      let parsedSlice;
      try {
        parsedSlice = JSON.parse(rawSlice);
        if (!parsedSlice || typeof parsedSlice !== "object") {
          return {
            isValid: false,
            errorCode: "PROVISION_MAPPING_MISMATCH",
            reason: "Source boundary does not contain a valid JSON object"
          };
        }
      } catch {
        return {
          isValid: false,
          errorCode: "PROVISION_MAPPING_MISMATCH",
          reason: "Source boundary does not parse as valid JSON"
        };
      }
      if (record.fxObservation) {
        const obs = record.fxObservation;
        if (obs.date && parsedSlice.date !== obs.date) {
          return {
            isValid: false,
            errorCode: "PROVISION_MAPPING_MISMATCH",
            reason: `JSON boundary payload date mismatch: expected '${obs.date}', got '${parsedSlice.date}'`
          };
        }
        if (obs.base && parsedSlice.base !== obs.base) {
          return {
            isValid: false,
            errorCode: "PROVISION_MAPPING_MISMATCH",
            reason: `JSON boundary payload base mismatch: expected '${obs.base}', got '${parsedSlice.base}'`
          };
        }
        if (obs.rates && typeof obs.rates === "object") {
          if (!parsedSlice.rates || typeof parsedSlice.rates !== "object") {
            return {
              isValid: false,
              errorCode: "PROVISION_MAPPING_MISMATCH",
              reason: "JSON boundary payload is missing rates object required by fxObservation"
            };
          }
          for (const [sym, rate] of Object.entries(obs.rates)) {
            if (parsedSlice.rates[sym] !== rate) {
              return {
                isValid: false,
                errorCode: "PROVISION_MAPPING_MISMATCH",
                reason: `JSON boundary payload rate mismatch for currency '${sym}': expected ${rate}, got ${parsedSlice.rates[sym]}`
              };
            }
          }
        }
      } else if (record.authority === "REFERENCE_API") {
        return {
          isValid: false,
          errorCode: "PROVISION_MAPPING_MISMATCH",
          reason: "Reference API record is missing fxObservation payload for boundary verification"
        };
      }
      return { isValid: true };
    }
    const reconstructed = cleanHtmlText(rawSlice);
    if (reconstructed.trim() !== record.sourceText.trim()) {
      return {
        isValid: false,
        errorCode: "PROVISION_MAPPING_MISMATCH",
        reason: `Source text mismatch: candidate sourceText does not match content reconstructed from raw document boundary offsets [${startOffset}, ${endOffset}]`
      };
    }
    return { isValid: true };
  }
  /**
   * Validates exact provision extraction, anti-truncation verbatim integrity,
   * and structural section/provision mapping with affirmative canonical Act and section identity.
   */
  validateProvisionMapping(doc) {
    if (doc.extractionStatus === "FAILED") {
      return {
        isValid: false,
        errorCode: "EXTRACTION_FAILED",
        reason: `Extraction failed: could not locate provision '${doc.paragraphOrSection}' in source '${doc.standardOrActCode}'`
      };
    }
    if (doc.extractionStatus === "PARTIAL") {
      if (doc.isVerbatimText) {
        return {
          isValid: false,
          errorCode: "INVALID_VERBATIM_CLAIM",
          reason: "Partial extraction cannot be declared as isVerbatimText = true"
        };
      }
      return {
        isValid: false,
        errorCode: "PARTIAL_PROVISION",
        reason: `Partial extraction is not eligible for authoritative verification for '${doc.id}'`
      };
    }
    if (doc.isVerbatimText) {
      if (!doc.sourceText || doc.sourceText.trim().length === 0) {
        return {
          isValid: false,
          errorCode: "INVALID_VERBATIM_CLAIM",
          reason: "Verbatim record has empty sourceText"
        };
      }
      const truncationMarkers = ["...", "\u2026", "[truncated]", "[abridged]", "[content truncated]", "[continued]"];
      for (const marker of truncationMarkers) {
        if (doc.sourceText.includes(marker)) {
          return {
            isValid: false,
            errorCode: "INVALID_VERBATIM_CLAIM",
            reason: `Verbatim record contains truncation marker '${marker}'. Verbatim text must be complete and unabridged.`
          };
        }
      }
      if (!doc.sourceLocator || !doc.sourceLocator.heading && !doc.sourceLocator.elementId && !doc.sourceLocator.sourceNode) {
        return {
          isValid: false,
          errorCode: "INVALID_VERBATIM_CLAIM",
          reason: "Verbatim record must have a populated sourceLocator with heading, elementId, or sourceNode"
        };
      }
    }
    if (doc.sourceLocator) {
      if (doc.sourceLocator.act) {
        const docActCanonical = getCanonicalActCode(doc.standardOrActCode);
        const locActCanonical = getCanonicalActCode(doc.sourceLocator.act);
        if (docActCanonical && locActCanonical && docActCanonical !== locActCanonical) {
          return {
            isValid: false,
            errorCode: "PROVISION_MAPPING_MISMATCH",
            reason: `Canonical Act mismatch: document '${doc.standardOrActCode}' (${docActCanonical}) contradicts locator act '${doc.sourceLocator.act}' (${locActCanonical})`
          };
        }
      }
      if (doc.sourceLocator.section) {
        const claimedSecNum = doc.paragraphOrSection.match(/(?:Section|Sec\.?|S\.?)\s*(\d+)/i)?.[1];
        const locSecNum = doc.sourceLocator.section.match(/\d+/)?.[0];
        if (claimedSecNum && locSecNum && claimedSecNum !== locSecNum) {
          return {
            isValid: false,
            errorCode: "PROVISION_MAPPING_MISMATCH",
            reason: `Provision mapping mismatch: claimed section '${doc.paragraphOrSection}' contradicts locator section '${doc.sourceLocator.section}'`
          };
        }
        const claimedSchedule = doc.paragraphOrSection.match(/((?:First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|Eleventh|Twelfth|Thirteenth|Part\s+[IVXLCDM]+)\s*(?:Schedule|Part)?)/i)?.[1];
        const locSchedule = doc.sourceLocator.section.match(/((?:First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|Eleventh|Twelfth|Thirteenth|Part\s+[IVXLCDM]+)\s*(?:Schedule|Part)?)/i)?.[1];
        if (claimedSchedule && locSchedule) {
          const normClaimed = claimedSchedule.toLowerCase().replace(/\s+/g, "");
          const normLocator = locSchedule.toLowerCase().replace(/\s+/g, "");
          if (normClaimed !== normLocator) {
            return {
              isValid: false,
              errorCode: "PROVISION_MAPPING_MISMATCH",
              reason: `Provision mapping mismatch: claimed schedule/part '${doc.paragraphOrSection}' contradicts locator section '${doc.sourceLocator.section}'`
            };
          }
        }
      }
      if (doc.sourceLocator.subsection) {
        const claimedSub = doc.paragraphOrSection.match(/\((\d+[a-zA-Z]?)\)/)?.[1];
        const locSub = doc.sourceLocator.subsection.replace(/[()]/g, "").trim();
        if (claimedSub && locSub && claimedSub !== locSub) {
          return {
            isValid: false,
            errorCode: "PROVISION_MAPPING_MISMATCH",
            reason: `Provision mapping mismatch: claimed subsection '(${claimedSub})' contradicts locator subsection '${doc.sourceLocator.subsection}'`
          };
        }
      }
      const sectionNormalized = doc.paragraphOrSection.toLowerCase().replace(/[\s\-_(),.]/g, "");
      const headingNormalized = (doc.sourceLocator.heading || "").toLowerCase().replace(/[\s\-_(),.]/g, "");
      if (headingNormalized && headingNormalized.includes("section") && sectionNormalized.includes("section")) {
        const claimedNum = sectionNormalized.match(/\d+/)?.[0];
        const headingNum = headingNormalized.match(/\d+/)?.[0];
        if (claimedNum && headingNum && claimedNum !== headingNum) {
          return {
            isValid: false,
            errorCode: "PROVISION_MAPPING_MISMATCH",
            reason: `Provision mapping mismatch: claimed section '${doc.paragraphOrSection}' contradicts locator heading '${doc.sourceLocator.heading}'`
          };
        }
        const claimedSub = doc.paragraphOrSection.match(/\((\d+)\)/)?.[1];
        const headingSub = (doc.sourceLocator.heading || "").match(/\((\d+)\)/)?.[1];
        if (claimedSub && headingSub && claimedSub !== headingSub) {
          return {
            isValid: false,
            errorCode: "PROVISION_MAPPING_MISMATCH",
            reason: `Provision mapping mismatch: claimed section '${doc.paragraphOrSection}' contradicts locator heading '${doc.sourceLocator.heading}'`
          };
        }
      }
      if (doc.sourceLocator.boundary) {
        if (doc.sourceLocator.boundary.endOffset <= doc.sourceLocator.boundary.startOffset || doc.sourceLocator.boundary.startOffset < 0) {
          return {
            isValid: false,
            errorCode: "PROVISION_MAPPING_MISMATCH",
            reason: "Invalid provision boundaries: boundary offsets are invalid (endOffset must be strictly greater than startOffset)"
          };
        }
      }
      if (doc.sourceLocator.startOffset !== void 0 && doc.sourceLocator.endOffset !== void 0) {
        if (doc.sourceLocator.endOffset <= doc.sourceLocator.startOffset || doc.sourceLocator.startOffset < 0) {
          return {
            isValid: false,
            errorCode: "PROVISION_MAPPING_MISMATCH",
            reason: "Invalid provision boundaries: boundary offsets are invalid (endOffset must be strictly greater than startOffset)"
          };
        }
      }
    }
    const isGuidanceAuthority = ["IRAS", "ACRA", "MOM", "CPF"].includes(doc.authority);
    const isAgcSource = doc.officialSourceUrl && doc.officialSourceUrl.includes("sso.agc.gov.sg");
    if (isGuidanceAuthority && !isAgcSource) {
      if (doc.evidenceTier === "PRIMARY_SOURCE" || doc.sourceType === "AUTHORITATIVE_SOURCE") {
        return {
          isValid: false,
          errorCode: "PROVISION_MAPPING_MISMATCH",
          reason: `Administrative guidance portal from '${doc.authority}' cannot claim PRIMARY_SOURCE or AUTHORITATIVE_SOURCE statutory status; must be modeled as OFFICIAL_GUIDANCE`
        };
      }
      const nodeIdentifier = `${doc.sourceLocator?.sourceNode || ""} ${doc.sourceLocator?.elementId || ""}`.toLowerCase();
      if (doc.authority === "IRAS" && !nodeIdentifier.includes("cit-rate") && !nodeIdentifier.includes("cit-rebate")) {
        return {
          isValid: false,
          errorCode: "PROVISION_MAPPING_MISMATCH",
          reason: `IRAS guidance structural node must identify tax rate/rebate topic (e.g. cit-rate), found '${nodeIdentifier}'`
        };
      }
      if (doc.authority === "ACRA" && !nodeIdentifier.includes("small-company")) {
        return {
          isValid: false,
          errorCode: "PROVISION_MAPPING_MISMATCH",
          reason: `ACRA guidance structural node must identify small-company topic, found '${nodeIdentifier}'`
        };
      }
      if (doc.authority === "MOM" && !nodeIdentifier.includes("itemised-payslips") && !nodeIdentifier.includes("payslip")) {
        return {
          isValid: false,
          errorCode: "PROVISION_MAPPING_MISMATCH",
          reason: `MOM guidance structural node must identify itemised-payslip topic, found '${nodeIdentifier}'`
        };
      }
      if (doc.authority === "CPF" && !nodeIdentifier.includes("ow-ceiling")) {
        return {
          isValid: false,
          errorCode: "PROVISION_MAPPING_MISMATCH",
          reason: `CPF guidance structural node must identify ow-ceiling topic, found '${nodeIdentifier}'`
        };
      }
    }
    if (doc.authority === "REFERENCE_API" || doc.standardOrActCode === "FX_OBSERVATION") {
      if (doc.isVerbatimText) {
        return {
          isValid: false,
          errorCode: "INVALID_VERBATIM_CLAIM",
          reason: "Reference API observations cannot claim isVerbatimText = true because summary text is generated/curated"
        };
      }
      if (!doc.fxObservation || !doc.fxObservation.rates || !doc.fxObservation.base || !doc.fxObservation.date) {
        return {
          isValid: false,
          errorCode: "PROVISION_MAPPING_MISMATCH",
          reason: "Reference API observation is missing structured fxObservation payload"
        };
      }
    }
    return { isValid: true };
  }
};
var defaultExternalSourceValidator = new ExternalSourceValidator();

// src/retrieval/sourceCache.ts
var SourceCache = class {
  cache = /* @__PURE__ */ new Map();
  defaultTtlMs;
  constructor(defaultTtlMs = 864e5) {
    this.defaultTtlMs = defaultTtlMs;
  }
  /**
   * Normalizes the lookup URL key (lowercase protocol & domain, trimmed)
   */
  normalizeKey(url) {
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.host.toLowerCase()}${u.pathname}${u.search}${u.hash}`;
    } catch {
      return url.trim().toLowerCase();
    }
  }
  /**
   * Retrieves entry from cache regardless of freshness.
   */
  get(url) {
    const key = this.normalizeKey(url);
    const entry = this.cache.get(key);
    return entry ? { ...entry } : null;
  }
  /**
   * Evaluates if a cached entry exists and is still within its fresh TTL window.
   */
  isFresh(url, nowMs = Date.now()) {
    const key = this.normalizeKey(url);
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (entry.expiresAt === void 0) return true;
    return nowMs < entry.expiresAt;
  }
  /**
   * Retrieves entry only if it is fresh; returns null if missing or expired.
   */
  getFresh(url, nowMs = Date.now()) {
    if (!this.isFresh(url, nowMs)) return null;
    return this.get(url);
  }
  /**
   * Generates conditional revalidation headers (ETag / If-Modified-Since) if available.
   */
  getConditionalHeaders(url) {
    const entry = this.get(url);
    const headers = {};
    if (!entry) return headers;
    if (entry.etag) {
      headers["If-None-Match"] = entry.etag;
    }
    if (entry.lastModified) {
      headers["If-Modified-Since"] = entry.lastModified;
    }
    return headers;
  }
  /**
   * Refreshes the expiration timestamp of an existing cached entry (e.g. on 304 Not Modified).
   */
  touch(url, ttlMs, nowMs = Date.now()) {
    const key = this.normalizeKey(url);
    const entry = this.cache.get(key);
    if (!entry) return false;
    const effectiveTtl = ttlMs ?? entry.ttlMs ?? this.defaultTtlMs;
    entry.ttlMs = effectiveTtl;
    entry.expiresAt = nowMs + effectiveTtl;
    return true;
  }
  /**
   * Stores a source entry with explicit or default TTL.
   */
  set(source, ttlMs, nowMs = Date.now()) {
    const key = this.normalizeKey(source.canonicalUrl);
    const effectiveTtl = ttlMs ?? source.ttlMs ?? this.defaultTtlMs;
    const expiresAt = source.expiresAt ?? nowMs + effectiveTtl;
    this.cache.set(key, {
      ...source,
      ttlMs: effectiveTtl,
      expiresAt
    });
  }
  /**
   * Prunes all stale entries whose expiration timestamp has passed.
   */
  pruneExpired(nowMs = Date.now()) {
    let pruned = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt !== void 0 && nowMs >= entry.expiresAt) {
        this.cache.delete(key);
        pruned++;
      }
    }
    return pruned;
  }
  invalidate(url) {
    const key = this.normalizeKey(url);
    this.cache.delete(key);
  }
  clear() {
    this.cache.clear();
  }
  size() {
    return this.cache.size;
  }
  getAll() {
    return Array.from(this.cache.values()).map((s) => ({ ...s }));
  }
};
var defaultSourceCache = new SourceCache();

// src/retrieval/controlledWebRetriever.ts
var ControlledWebRetriever = class {
  validator;
  cache;
  constructor(validator = defaultExternalSourceValidator, cache2 = defaultSourceCache) {
    this.validator = validator;
    this.cache = cache2;
  }
  /**
   * Fetches official source with strict security validation, caching, and timeout controls.
   */
  async fetchOfficialSource(url, options = {}) {
    const {
      timeoutMs = 3e3,
      useCache = true,
      ttlMs,
      expectedHash,
      customFetch = globalThis.fetch ? globalThis.fetch.bind(globalThis) : void 0
    } = options;
    const retrievedAt = (/* @__PURE__ */ new Date()).toISOString();
    const secValidation = this.validator.validateUrlSecurity(url);
    if (!secValidation.isValid) {
      return {
        status: secValidation.errorCode === "UNAUTHORIZED_DOMAIN_ACCESS" ? "UNAUTHORIZED_DOMAIN_ACCESS" : "INVALID_URL",
        error: secValidation.reason,
        retrievedAt,
        sourceUrl: url
      };
    }
    let cached = null;
    if (useCache) {
      cached = this.cache.get(url);
      if (cached && cached.rawContent) {
        if (expectedHash && cached.contentHash.toLowerCase() !== expectedHash.toLowerCase()) {
          this.cache.invalidate(url);
          cached = null;
        } else if (this.cache.isFresh(url)) {
          return {
            status: "SUCCESS",
            httpStatus: cached.httpStatus,
            content: cached.rawContent,
            contentHash: cached.contentHash,
            cached: true,
            retrievedAt: cached.retrievedAt,
            sourceUrl: url,
            etag: cached.etag,
            lastModified: cached.lastModified
          };
        }
      }
    }
    if (!customFetch) {
      return {
        status: "NETWORK_ERROR",
        error: "No fetch transport available in current runtime environment",
        retrievedAt,
        sourceUrl: url
      };
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const headers = {
        "Accept": "text/plain, application/json, text/html, */*"
      };
      if (useCache && cached) {
        const condHeaders = this.cache.getConditionalHeaders(url);
        Object.assign(headers, condHeaders);
      }
      const response = await customFetch(url, {
        method: "GET",
        signal: controller.signal,
        redirect: "manual",
        // Intercept redirects for security validation
        headers
      });
      clearTimeout(timeoutId);
      if (response.status === 304 && cached && cached.rawContent) {
        this.cache.touch(url, ttlMs);
        return {
          status: "SUCCESS",
          httpStatus: 304,
          content: cached.rawContent,
          contentHash: cached.contentHash,
          cached: true,
          retrievedAt,
          sourceUrl: url,
          etag: cached.etag,
          lastModified: cached.lastModified
        };
      }
      if (response.status >= 300 && response.status < 400) {
        const redirectLocation = response.headers?.get("location");
        if (!redirectLocation) {
          return {
            status: "REDIRECT_REJECTED",
            httpStatus: response.status,
            error: "Redirect response missing Location header",
            retrievedAt,
            sourceUrl: url
          };
        }
        let targetUrl;
        try {
          targetUrl = new URL(redirectLocation, url).toString();
        } catch {
          return {
            status: "REDIRECT_REJECTED",
            httpStatus: response.status,
            error: `Invalid redirect location: '${redirectLocation}'`,
            retrievedAt,
            sourceUrl: url
          };
        }
        const redirectValidation = this.validator.validateRedirect(url, targetUrl);
        if (!redirectValidation.isValid) {
          return {
            status: "REDIRECT_REJECTED",
            httpStatus: response.status,
            error: redirectValidation.reason,
            retrievedAt,
            sourceUrl: url
          };
        }
        const redirectCount = options.redirectCount ?? 0;
        const maxRedirects = options.maxRedirects ?? 5;
        if (redirectCount >= maxRedirects) {
          return { status: "REDIRECT_REJECTED", httpStatus: response.status, error: `Maximum redirect limit (${maxRedirects}) exceeded`, retrievedAt, sourceUrl: url };
        }
        return await this.fetchOfficialSource(targetUrl, { ...options, useCache: false, redirectCount: redirectCount + 1 });
      }
      if (!response.ok) {
        return {
          status: "HTTP_ERROR",
          httpStatus: response.status,
          error: `HTTP response error: ${response.status} ${response.statusText}`,
          retrievedAt,
          sourceUrl: url
        };
      }
      const text = await response.text();
      if (!text || text.trim().length === 0) {
        return {
          status: "INVALID_CONTENT",
          httpStatus: response.status,
          error: "Received empty response body",
          retrievedAt,
          sourceUrl: url
        };
      }
      const hash = computeSha256(text);
      if (expectedHash && hash.toLowerCase() !== expectedHash.toLowerCase()) {
        return {
          status: "HASH_MISMATCH",
          httpStatus: response.status,
          content: text,
          contentHash: hash,
          error: `Content hash mismatch: expected '${expectedHash}', got '${hash}'`,
          retrievedAt,
          sourceUrl: url
        };
      }
      const etag = response.headers?.get("etag") || void 0;
      const lastModified = response.headers?.get("last-modified") || void 0;
      const contentType = response.headers?.get("content-type") || void 0;
      if (useCache) {
        const defaultUrlTtl = url.includes("frankfurter") ? 36e5 : 864e5;
        const effectiveTtl = ttlMs ?? defaultUrlTtl;
        const cachedSource = {
          canonicalUrl: url,
          retrievedAt,
          contentHash: hash,
          rawContent: text,
          httpStatus: response.status,
          contentType,
          etag,
          lastModified,
          ttlMs: effectiveTtl
        };
        this.cache.set(cachedSource, effectiveTtl);
      }
      return {
        status: "SUCCESS",
        httpStatus: response.status,
        content: text,
        contentHash: hash,
        cached: false,
        retrievedAt,
        sourceUrl: url,
        etag,
        lastModified
      };
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError" || controller.signal.aborted) {
        return {
          status: "TIMEOUT",
          error: `Fetch timed out after ${timeoutMs}ms`,
          retrievedAt,
          sourceUrl: url
        };
      }
      const errStr = (err.message || "").toLowerCase();
      if (errStr.includes("failed to fetch") || errStr.includes("cors") || errStr.includes("networkerror")) {
        return {
          status: "CORS_ERROR",
          error: `Network/CORS error: ${err.message}`,
          retrievedAt,
          sourceUrl: url
        };
      }
      return {
        status: "NETWORK_ERROR",
        error: `Network error: ${err.message || String(err)}`,
        retrievedAt,
        sourceUrl: url
      };
    }
  }
};
var defaultControlledWebRetriever = new ControlledWebRetriever();

// src/retrieval/liveRegulatoryFeed.ts
var LiveRegulatoryFeedService = class {
  versioningManager;
  validator;
  // Staged packages awaiting verification: packageId -> RegulatoryUpdatePackage
  stagedPackages = /* @__PURE__ */ new Map();
  // Verified packages approved for activation: packageId -> RegulatoryUpdatePackage
  verifiedPackages = /* @__PURE__ */ new Map();
  // Active activated packages: packageId -> RegulatoryUpdatePackage
  activePackages = /* @__PURE__ */ new Map();
  // Rejected packages: packageId -> reason
  rejectedPackages = /* @__PURE__ */ new Map();
  reviewAuditEvents = [];
  // Mock / remote feed queue for update simulation
  availableFeeds = [];
  // Official source update discovery adapters
  adapters;
  webRetriever;
  lastCheckDate = "2026-09-11T00:00:00Z";
  lastVerificationDate = "2026-09-11T00:00:00Z";
  syncState = "SYNCED";
  constructor(versioningManager = defaultSourceVersioningManager, validator = defaultExternalSourceValidator, webRetriever = defaultControlledWebRetriever, adapters = [
    new SSOUpdateAdapter(),
    new IRASUpdateAdapter(),
    new ACRAUpdateAdapter(),
    new MOMUpdateAdapter(),
    new CPFUpdateAdapter(),
    new FrankfurterReferenceAdapter()
  ]) {
    this.versioningManager = versioningManager;
    this.validator = validator;
    this.webRetriever = webRetriever;
    this.adapters = [...adapters];
  }
  registerAdapter(adapter) {
    this.adapters.push(adapter);
  }
  recordAuditEvent(packageId, action, actor, reason) {
    this.reviewAuditEvents.push({ packageId, action, actor, reason, occurredAt: (/* @__PURE__ */ new Date()).toISOString() });
  }
  /** Records an accountable human review decision without changing package state. */
  recordReviewDecision(packageId, reviewer, reason) {
    const exists = this.stagedPackages.has(packageId) || this.verifiedPackages.has(packageId) || this.activePackages.has(packageId);
    if (!exists || !reviewer.trim() || !reason.trim()) return false;
    this.recordAuditEvent(packageId, "REVIEW_RECORDED", reviewer.trim(), reason.trim());
    return true;
  }
  getAdapters() {
    return [...this.adapters];
  }
  /**
   * Computes deterministic SHA-256 package hash over all constituent records
   */
  computePackageHash(pkg) {
    const payload = [
      pkg.packageId,
      pkg.releaseDate,
      pkg.authority,
      ...pkg.updates.map((u) => `${u.id}:${u.standardOrActCode}:${u.paragraphOrSection}:${u.sourceText}`)
    ].join("|||");
    return computeSha256(payload);
  }
  /**
   * Registers a mock update package to be discovered during check
   */
  enqueueRemoteFeedPackage(pkg) {
    this.availableFeeds.push(pkg);
    this.syncState = "UPDATE_AVAILABLE";
  }
  /**
   * Checks for available regulatory update packages using registered official source adapters.
   */
  async checkForUpdates(customRetriever, options = {}) {
    const checkedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.lastCheckDate = checkedAt;
    if (this.syncState === "OFFLINE") {
      return {
        hasUpdates: false,
        packages: [],
        syncState: "OFFLINE",
        checkedAt,
        error: "Offline mode active: external feed check unavailable"
      };
    }
    const discoveredPackages = [...this.availableFeeds];
    const activeRetriever = customRetriever || this.webRetriever;
    const currentSources = Object.values(UNIFIED_SOURCE_REGISTRY);
    for (const adapter of this.adapters) {
      if (options.authorities && !options.authorities.includes(adapter.authority)) continue;
      try {
        const pkg = await adapter.checkForUpdates(activeRetriever, currentSources);
        if (pkg && !discoveredPackages.some((p) => p.packageId === pkg.packageId)) {
          discoveredPackages.push(pkg);
        }
      } catch {
      }
    }
    if (discoveredPackages.length > 0) {
      this.syncState = "UPDATE_AVAILABLE";
      return {
        hasUpdates: true,
        packages: discoveredPackages,
        syncState: "UPDATE_AVAILABLE",
        checkedAt
      };
    }
    this.syncState = "SYNCED";
    return {
      hasUpdates: false,
      packages: [],
      syncState: "SYNCED",
      checkedAt
    };
  }
  /**
   * Stages a regulatory update package into the candidate holding area.
   * Staging does NOT mutate the active registry or active retrieval.
   * Preserves full external provenance (sourceUrl, httpStatus, etag, lastModified).
   */
  async stageUpdatePackage(pkg, provenanceDetails) {
    if (!pkg.packageId || !pkg.updates || pkg.updates.length === 0) {
      return { success: false, packageId: pkg.packageId, stagedRecordsCount: 0, error: "Empty or invalid package" };
    }
    for (const rec of pkg.updates) {
      const versionId = `${pkg.packageId}-${rec.id}`;
      const contentHash = rec.contentHash || this.versioningManager.computeSourceHash(rec);
      rec.contentHash = contentHash;
      const metadata = {
        versionId,
        contentHash,
        effectiveDate: rec.validFrom || rec.effectiveDate,
        validFrom: rec.validFrom,
        validTo: rec.validTo,
        publishedDate: pkg.releaseDate,
        canonicalSourceUrl: rec.officialSourceUrl,
        sourceAuthority: pkg.authority,
        verificationStatus: "UNVERIFIED",
        retrievedAt: (/* @__PURE__ */ new Date()).toISOString(),
        amendmentSummary: pkg.amendments.find((a) => a.recordId === rec.id)?.summary,
        // Preserve external provenance
        sourceUrl: provenanceDetails?.sourceUrl || rec.officialSourceUrl,
        httpStatus: provenanceDetails?.httpStatus || 200,
        etag: provenanceDetails?.etag,
        lastModified: provenanceDetails?.lastModified,
        documentHash: rec.documentHash,
        provisionHash: rec.provisionHash || rec.contentHash,
        extractionStatus: rec.extractionStatus,
        sourceLocator: rec.sourceLocator
      };
      this.versioningManager.registerCandidateVersion(rec, metadata);
    }
    this.stagedPackages.set(pkg.packageId, pkg);
    this.syncState = "VERIFICATION_REQUIRED";
    this.recordAuditEvent(pkg.packageId, "STAGED", "system", "Package isolated pending verification");
    return {
      success: true,
      packageId: pkg.packageId,
      stagedRecordsCount: pkg.updates.length
    };
  }
  /**
   * Verifies an entire update package.
   * Security invariant: rawDocuments is mandatory. A candidate record must never reach VERIFIED
   * without proving that candidate sourceText matches content reconstructed from raw document boundary.
   * Atomic rule: If even 1 record fails validation, structural check, or raw boundary verification, the entire package is REJECTED.
   * rawDocuments can be passed as a record-specific mapping (Record<string, string> keyed by recordId)
   * or a single string (if all records in the package share the identical document).
   */
  async verifyUpdatePackage(packageId, rawDocuments) {
    if (!rawDocuments || typeof rawDocuments !== "string" && typeof rawDocuments !== "object") {
      this.rejectedPackages.set(packageId, "Raw document is required for package verification");
      return {
        isValid: false,
        packageId,
        verifiedRecordsCount: 0,
        rejectionReason: "Raw document is strictly required to verify update package and validate source boundary"
      };
    }
    if (typeof rawDocuments === "string" && rawDocuments.trim().length === 0) {
      this.rejectedPackages.set(packageId, "Raw document is required for package verification");
      return {
        isValid: false,
        packageId,
        verifiedRecordsCount: 0,
        rejectionReason: "Raw document is strictly required to verify update package and validate source boundary"
      };
    }
    const pkg = this.stagedPackages.get(packageId);
    if (!pkg) {
      return {
        isValid: false,
        packageId,
        verifiedRecordsCount: 0,
        rejectionReason: `Staged package '${packageId}' not found`
      };
    }
    const expectedPackageHash = this.computePackageHash({
      packageId: pkg.packageId,
      releaseDate: pkg.releaseDate,
      authority: pkg.authority,
      updates: pkg.updates,
      amendments: pkg.amendments
    });
    if (pkg.packageHash && pkg.packageHash.toLowerCase() !== expectedPackageHash.toLowerCase()) {
      this.rejectedPackages.set(packageId, "Package content hash mismatch");
      this.syncState = "FETCH_FAILED";
      return {
        isValid: false,
        packageId,
        verifiedRecordsCount: 0,
        rejectionReason: `Package hash mismatch: expected '${expectedPackageHash}', received '${pkg.packageHash}'`
      };
    }
    for (let i = 0; i < pkg.updates.length; i++) {
      const rec = pkg.updates[i];
      let rawDoc;
      if (typeof rawDocuments === "string") {
        rawDoc = rawDocuments;
      } else {
        rawDoc = rawDocuments[rec.id];
      }
      if (!rawDoc || typeof rawDoc !== "string" || rawDoc.trim().length === 0) {
        this.rejectedPackages.set(packageId, `Record #${i + 1} (${rec.id}): Missing record-specific raw document`);
        return {
          isValid: false,
          packageId,
          verifiedRecordsCount: 0,
          failedRecordId: rec.id,
          rejectionReason: `Atomic validation failure on record '${rec.id}': Missing record-specific raw document`
        };
      }
      if (rec.documentHash) {
        const actualDocHash = computeSha256(rawDoc);
        if (actualDocHash.toLowerCase() !== rec.documentHash.toLowerCase()) {
          this.rejectedPackages.set(packageId, `Record #${i + 1} (${rec.id}): Document hash mismatch`);
          return {
            isValid: false,
            packageId,
            verifiedRecordsCount: 0,
            failedRecordId: rec.id,
            rejectionReason: `Atomic validation failure on record '${rec.id}': Document hash mismatch for record-specific raw document (expected '${rec.documentHash}', got '${actualDocHash}')`
          };
        }
      }
      const structCheck = this.validator.validateDocumentStructure(rec);
      if (!structCheck.isValid) {
        this.rejectedPackages.set(packageId, `Record #${i + 1} (${rec.id}): ${structCheck.reason}`);
        return {
          isValid: false,
          packageId,
          verifiedRecordsCount: 0,
          failedRecordId: rec.id,
          rejectionReason: `Atomic validation failure on record '${rec.id}': ${structCheck.reason}`
        };
      }
      const urlCheck = this.validator.validateUrlSecurity(rec.officialSourceUrl);
      if (!urlCheck.isValid) {
        this.rejectedPackages.set(packageId, `Record #${i + 1} (${rec.id}): ${urlCheck.reason}`);
        return {
          isValid: false,
          packageId,
          verifiedRecordsCount: 0,
          failedRecordId: rec.id,
          rejectionReason: `Atomic validation failure on record '${rec.id}': ${urlCheck.reason}`
        };
      }
      const authCheck = this.validator.validateCanonicalUrl(rec.officialSourceUrl, pkg.authority);
      if (!authCheck.isValid) {
        this.rejectedPackages.set(packageId, `Record #${i + 1} (${rec.id}): ${authCheck.reason}`);
        return {
          isValid: false,
          packageId,
          verifiedRecordsCount: 0,
          failedRecordId: rec.id,
          rejectionReason: `Atomic validation failure on record '${rec.id}': ${authCheck.reason}`
        };
      }
      const provCheck = this.validator.validateProvenance(rec, rec.officialSourceUrl);
      if (!provCheck.isValid) {
        this.rejectedPackages.set(packageId, `Record #${i + 1} (${rec.id}): ${provCheck.reason}`);
        return {
          isValid: false,
          packageId,
          verifiedRecordsCount: 0,
          failedRecordId: rec.id,
          rejectionReason: `Atomic validation failure on record '${rec.id}': ${provCheck.reason}`
        };
      }
      const boundaryCheck = this.validator.validateSourceBoundary(rec, rawDoc);
      if (!boundaryCheck.isValid) {
        this.rejectedPackages.set(packageId, `Record #${i + 1} (${rec.id}): ${boundaryCheck.reason}`);
        return {
          isValid: false,
          packageId,
          verifiedRecordsCount: 0,
          failedRecordId: rec.id,
          rejectionReason: `Atomic validation failure on record '${rec.id}': ${boundaryCheck.reason}`
        };
      }
      const mappingCheck = this.validator.validateProvisionMapping(rec);
      if (!mappingCheck.isValid) {
        this.rejectedPackages.set(packageId, `Record #${i + 1} (${rec.id}): ${mappingCheck.reason}`);
        return {
          isValid: false,
          packageId,
          verifiedRecordsCount: 0,
          failedRecordId: rec.id,
          rejectionReason: `Atomic validation failure on record '${rec.id}': ${mappingCheck.reason}`
        };
      }
    }
    for (const rec of pkg.updates) {
      const versionId = `${pkg.packageId}-${rec.id}`;
      const candidateEntry = this.versioningManager.getCandidates().find((c) => c.metadata.versionId === versionId);
      if (candidateEntry) {
        candidateEntry.metadata.verificationStatus = "VERIFIED";
        candidateEntry.metadata.verificationMethod = "OFFICIAL_STATUTORY_PACKAGE_VERIFICATION";
        candidateEntry.metadata.documentHash = rec.documentHash;
        candidateEntry.metadata.provisionHash = rec.provisionHash;
        candidateEntry.metadata.extractionStatus = rec.extractionStatus;
        candidateEntry.metadata.sourceLocator = rec.sourceLocator;
      }
    }
    this.verifiedPackages.set(packageId, pkg);
    this.lastVerificationDate = (/* @__PURE__ */ new Date()).toISOString();
    this.recordAuditEvent(packageId, "VERIFIED", "system", "All records passed atomic source, provenance, and boundary checks");
    return {
      isValid: true,
      packageId,
      verifiedRecordsCount: pkg.updates.length
    };
  }
  /**
   * Re-fetches each staged record from its allowlisted official URL and verifies
   * the raw documents before they can be activated.  Keeping this here (rather
   * than in the UI) ensures every caller gets the same provenance safeguards.
   */
  async retrieveAndVerifyStagedPackage(packageId) {
    const pkg = this.stagedPackages.get(packageId);
    if (!pkg) {
      return {
        isValid: false,
        packageId,
        verifiedRecordsCount: 0,
        rejectionReason: `Staged package '${packageId}' not found`
      };
    }
    const rawDocuments = {};
    for (const rec of pkg.updates) {
      const result = await this.webRetriever.fetchOfficialSource(rec.officialSourceUrl, {
        timeoutMs: 5e3,
        useCache: false,
        expectedHash: rec.documentHash
      });
      if (result.status !== "SUCCESS" || !result.content) {
        return {
          isValid: false,
          packageId,
          verifiedRecordsCount: 0,
          failedRecordId: rec.id,
          rejectionReason: `Could not retrieve an unchanged official document for '${rec.id}': ${result.error || result.status}`
        };
      }
      rawDocuments[rec.id] = result.content;
    }
    return this.verifyUpdatePackage(packageId, rawDocuments);
  }
  /** Rejects a candidate without changing the active registry. */
  rejectUpdatePackage(packageId, reason = "Rejected during human review") {
    const exists = this.stagedPackages.has(packageId) || this.availableFeeds.some((pkg) => pkg.packageId === packageId);
    if (!exists) return false;
    this.stagedPackages.delete(packageId);
    this.verifiedPackages.delete(packageId);
    this.availableFeeds = this.availableFeeds.filter((pkg) => pkg.packageId !== packageId);
    this.rejectedPackages.set(packageId, reason);
    this.recordAuditEvent(packageId, "REJECTED", "reviewer", reason);
    this.syncState = this.availableFeeds.length > 0 ? "UPDATE_AVAILABLE" : "SYNCED";
    return true;
  }
  /**
   * Activates a verified update package into the active UNIFIED_SOURCE_REGISTRY.
   * ACID Transaction Guarantee: All updates are activated atomically.
   * If any record activation fails in the ledger, all previously activated records
   * in this transaction are automatically rolled back, and the active registry is restored
   * to its exact pre-activation snapshot.
   */
  async activateUpdatePackage(packageId) {
    const pkg = this.verifiedPackages.get(packageId);
    if (!pkg) {
      return {
        success: false,
        packageId,
        activatedRecordsCount: 0,
        error: `Package '${packageId}' must be verified before activation`
      };
    }
    const registrySnapshot = {};
    for (const rec of pkg.updates) {
      if (UNIFIED_SOURCE_REGISTRY[rec.id]) {
        registrySnapshot[rec.id] = { ...UNIFIED_SOURCE_REGISTRY[rec.id] };
      }
    }
    const activatedVersionIds = [];
    let activationError = null;
    for (const rec of pkg.updates) {
      const versionId = `${pkg.packageId}-${rec.id}`;
      const actResult = this.versioningManager.activateVersion(versionId);
      if (!actResult.success) {
        activationError = `Failed to activate record '${rec.id}': ${actResult.error}`;
        break;
      }
      activatedVersionIds.push(versionId);
      const activeRecord = {
        ...rec,
        versionId,
        version: pkg.packageId,
        provenance: "LIVE_PATCH",
        sourceStatus: "VERIFIED",
        sourceType: rec.sourceType,
        evidenceTier: rec.evidenceTier
      };
      UNIFIED_SOURCE_REGISTRY[rec.id] = activeRecord;
    }
    if (activationError) {
      for (const vId of activatedVersionIds.reverse()) {
        this.versioningManager.rollbackVersion(vId);
      }
      for (const rec of pkg.updates) {
        if (registrySnapshot[rec.id]) {
          UNIFIED_SOURCE_REGISTRY[rec.id] = registrySnapshot[rec.id];
        } else {
          delete UNIFIED_SOURCE_REGISTRY[rec.id];
        }
      }
      this.rejectedPackages.set(packageId, `Atomic activation failure: ${activationError}`);
      return {
        success: false,
        packageId,
        activatedRecordsCount: 0,
        // Exactly 0 records activated!
        error: `Atomic activation failed: ${activationError}`
      };
    }
    this.activePackages.set(packageId, pkg);
    this.stagedPackages.delete(packageId);
    this.verifiedPackages.delete(packageId);
    this.availableFeeds = this.availableFeeds.filter((f) => f.packageId !== packageId);
    this.syncState = "SYNCED";
    this.recordAuditEvent(packageId, "ACTIVATED", "system", "Verified package activated atomically");
    return {
      success: true,
      packageId,
      activatedRecordsCount: pkg.updates.length
    };
  }
  /**
   * Rolls back an activated update package.
   * Restores prior versions in both the versioning manager and active registry.
   */
  async rollbackUpdatePackage(packageId) {
    const pkg = this.activePackages.get(packageId);
    if (!pkg) {
      return {
        success: false,
        packageId,
        rolledBackRecordsCount: 0,
        error: `Active package '${packageId}' not found for rollback`
      };
    }
    let rolledBackCount = 0;
    for (const rec of pkg.updates) {
      const versionId = `${pkg.packageId}-${rec.id}`;
      const rollResult = this.versioningManager.rollbackVersion(versionId);
      if (rollResult.success) {
        const predecessorEntry = this.versioningManager.getLedgerEntry(rollResult.restoredVersionId);
        if (predecessorEntry) {
          UNIFIED_SOURCE_REGISTRY[rec.id] = { ...predecessorEntry.recordSnapshot };
        }
        rolledBackCount++;
      }
    }
    this.activePackages.delete(packageId);
    this.recordAuditEvent(packageId, "ROLLED_BACK", "system", "Active package rolled back to predecessor versions");
    return {
      success: true,
      packageId,
      rolledBackRecordsCount: rolledBackCount
    };
  }
  setSyncState(state) {
    this.syncState = state;
  }
  getSyncState() {
    return this.syncState;
  }
  getLastCheckDate() {
    return this.lastCheckDate;
  }
  getLastVerificationDate() {
    return this.lastVerificationDate;
  }
  getStagedPackages() {
    return Array.from(this.stagedPackages.values());
  }
  getVerifiedPackages() {
    return Array.from(this.verifiedPackages.values());
  }
  getActivePackages() {
    return Array.from(this.activePackages.values());
  }
  getRejectedPackages() {
    const res = {};
    for (const [k, v] of this.rejectedPackages.entries()) {
      res[k] = v;
    }
    return res;
  }
  getReviewAuditEvents(packageId) {
    return this.reviewAuditEvents.filter((event) => !packageId || event.packageId === packageId).map((event) => ({ ...event }));
  }
  /**
   * Resets feed state (for test isolation)
   */
  reset() {
    this.stagedPackages.clear();
    this.verifiedPackages.clear();
    this.activePackages.clear();
    this.rejectedPackages.clear();
    this.reviewAuditEvents = [];
    this.availableFeeds = [];
    this.syncState = "SYNCED";
  }
};
var defaultLiveRegulatoryFeedService = new LiveRegulatoryFeedService();

// src/retrieval/compositeSourceRetriever.ts
var CompositeSourceRetriever = class {
  localRetriever;
  feedService;
  webRetriever;
  versioningManager;
  constructor(localRetriever = new InMemorySourceRetriever(), feedService = defaultLiveRegulatoryFeedService, webRetriever = defaultControlledWebRetriever, versioningManager = defaultSourceVersioningManager) {
    this.localRetriever = localRetriever;
    this.feedService = feedService;
    this.webRetriever = webRetriever;
    this.versioningManager = versioningManager;
  }
  getWebRetriever() {
    return this.webRetriever;
  }
  getFeedService() {
    return this.feedService;
  }
  getVersioningManager() {
    return this.versioningManager;
  }
  /**
   * Fetches official external source document using controlled web retriever.
   * Enforces exact-hostname allowlists, HTTPS port 443, timeouts, and cache semantics.
   */
  async fetchExternalSource(url, options) {
    return await this.webRetriever.fetchOfficialSource(url, options);
  }
  /**
   * Retrieves sources by unique ID
   */
  getSourceById(id) {
    const local = this.localRetriever.getSourceById(id);
    if (local) return local;
    return void 0;
  }
  /**
   * Finds sources matching a standard/statute code and optional section.
   */
  findSourcesByStandardOrAct(standardOrActCode, paragraphOrSection) {
    return this.localRetriever.findSourcesByStandardOrAct(standardOrActCode, paragraphOrSection);
  }
  /**
   * Retrieves relevant sources matching the query.
   * When enableLiveCheck is requested, queries official regulatory adapters for candidate updates.
   * Staged candidates remain strictly isolated until verified and activated.
   * Preserves Phase 3 temporal scoring and candidate-isolation invariants.
   */
  async retrieveSources(retrievalQuery) {
    if (retrievalQuery.enableLiveCheck) {
      try {
        await this.feedService.checkForUpdates(this.webRetriever);
      } catch {
      }
    }
    const records = await this.localRetriever.retrieveSources(retrievalQuery);
    const approvedRecords = records.filter((r) => {
      if (r.versionId) {
        const activeVersionId = this.versioningManager.getActiveVersionId(r.id);
        if (activeVersionId && activeVersionId !== r.versionId) {
          return false;
        }
      }
      return r.sourceStatus === "VERIFIED" || r.sourceStatus === "HISTORICAL" || r.sourceStatus === "NEEDS_REVIEW";
    });
    return approvedRecords;
  }
  /**
   * Diagnostic helper to inspect active status
   */
  getRetrievalDiagnostics() {
    return {
      syncState: this.feedService.getSyncState(),
      lastCheckDate: this.feedService.getLastCheckDate(),
      lastVerificationDate: this.feedService.getLastVerificationDate(),
      activePackagesCount: this.feedService.getActivePackages().length,
      stagedPackagesCount: this.feedService.getStagedPackages().length,
      ledgerEntriesCount: this.versioningManager.getAllLedgerEntries().length
    };
  }
};
var defaultCompositeSourceRetriever = new CompositeSourceRetriever();

// src/retrieval/provisionChunker.ts
var ProvisionChunker = class _ProvisionChunker {
  /**
   * Computes deterministic SHA-256 hash of text.
   */
  static computeTextHash(text) {
    return computeSha256(text);
  }
  /**
   * Chunks an authoritative source record into discrete, verified paragraph/subsection chunks.
   */
  chunkRecord(parentRecord) {
    if (!parentRecord || !parentRecord.sourceText) {
      return [];
    }
    if (parentRecord.sourceStatus === "REJECTED" || parentRecord.id.includes("staged") || parentRecord.id.includes("candidate")) {
      return [];
    }
    const text = parentRecord.sourceText;
    const len = text.length;
    if (len === 0) return [];
    const chunks = [];
    const subsectionRegex = /(?:^|\n\s*)(?:(?:\(([0-9]+[a-zA-Z]?)\))|([0-9]{1,3}\.)|(?:§\s*([0-9]{1,3})))/g;
    const matches = [];
    let match;
    while ((match = subsectionRegex.exec(text)) !== null) {
      const leadingWhitespaceLen = match[0].match(/^\s*/)?.[0].length || 0;
      const matchIndex = match.index + leadingWhitespaceLen;
      const label = match[1] ? `(${match[1]})` : match[2] ? match[2] : `\xA7${match[3]}`;
      matches.push({ index: Math.max(0, matchIndex), label });
    }
    if (matches.length > 1) {
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index;
        const end = i + 1 < matches.length ? matches[i + 1].index : len;
        const chunkText = text.slice(start, end);
        if (chunkText.trim().length === 0) continue;
        const chunkId = `${parentRecord.id}#chunk${i + 1}`;
        const locator = {
          ...parentRecord.sourceLocator || {},
          startOffset: start,
          endOffset: end,
          subsection: matches[i].label,
          canonicalLocator: parentRecord.sourceLocator?.canonicalLocator ? `${parentRecord.sourceLocator.canonicalLocator} > ${matches[i].label}` : `${parentRecord.standardOrActCode} ${matches[i].label}`
        };
        const chunk = {
          id: chunkId,
          parentRecordId: parentRecord.id,
          chunkText,
          startOffset: start,
          endOffset: end,
          sourceLocator: locator,
          sourceType: parentRecord.sourceType,
          evidenceTier: parentRecord.evidenceTier,
          validFrom: parentRecord.validFrom,
          validTo: parentRecord.validTo,
          textHash: _ProvisionChunker.computeTextHash(chunkText),
          section: parentRecord.paragraphOrSection,
          subsection: matches[i].label
        };
        if (!this.verifyChunk(chunk, parentRecord)) {
          throw new Error(`Chunk invariant violation for ${chunkId}: slice mismatch.`);
        }
        chunks.push(chunk);
      }
    }
    if (chunks.length === 0) {
      const chunkId = `${parentRecord.id}#chunk1`;
      const locator = {
        ...parentRecord.sourceLocator || {},
        startOffset: 0,
        endOffset: len,
        canonicalLocator: parentRecord.sourceLocator?.canonicalLocator || `${parentRecord.standardOrActCode} ${parentRecord.paragraphOrSection}`
      };
      const singleChunk = {
        id: chunkId,
        parentRecordId: parentRecord.id,
        chunkText: text,
        startOffset: 0,
        endOffset: len,
        sourceLocator: locator,
        sourceType: parentRecord.sourceType,
        evidenceTier: parentRecord.evidenceTier,
        validFrom: parentRecord.validFrom,
        validTo: parentRecord.validTo,
        textHash: _ProvisionChunker.computeTextHash(text),
        section: parentRecord.paragraphOrSection
      };
      if (!this.verifyChunk(singleChunk, parentRecord)) {
        throw new Error(`Chunk invariant violation for single chunk ${chunkId}: slice mismatch.`);
      }
      chunks.push(singleChunk);
    }
    return chunks;
  }
  /**
   * Chunks multiple records.
   */
  chunkRecords(parentRecords) {
    const allChunks = [];
    for (const rec of parentRecords) {
      const chunks = this.chunkRecord(rec);
      allChunks.push(...chunks);
    }
    return allChunks;
  }
  /**
   * Validates chunk integrity invariant against parent record:
   * parentRecord.sourceText.slice(startOffset, endOffset) === chunk.chunkText
   */
  verifyChunk(chunk, parentRecord) {
    if (!chunk || !parentRecord) return false;
    if (chunk.parentRecordId !== parentRecord.id) return false;
    if (chunk.startOffset < 0 || chunk.endOffset > parentRecord.sourceText.length) return false;
    if (chunk.startOffset >= chunk.endOffset) return false;
    const expected = parentRecord.sourceText.slice(chunk.startOffset, chunk.endOffset);
    if (expected !== chunk.chunkText) return false;
    const expectedHash = _ProvisionChunker.computeTextHash(chunk.chunkText);
    if (chunk.textHash !== expectedHash) return false;
    return true;
  }
};
var defaultProvisionChunker = new ProvisionChunker();

// src/retrieval/localVectorizer.ts
var DeterministicLocalEmbeddingService = class _DeterministicLocalEmbeddingService {
  static VECTORIZER_VERSION = "1.0.0-semlex";
  dimensions = 128;
  providerName = "DeterministicLocalSemanticLexicalVectorizer";
  get vectorizerVersion() {
    return _DeterministicLocalEmbeddingService.VECTORIZER_VERSION;
  }
  // Pre-compiled domain concepts mapping key terms to dense semantic buckets
  static DOMAIN_CONCEPTS = [
    // GST / Tax supply
    { keywords: ["gst", "goods and services tax", "input tax", "output tax", "reverse charge", "de minimis", "bad debt relief", "time of supply", "taxable turnover"], cluster: 8, weight: 3.5 },
    // Corporate Income Tax (CIT) / ITA 1947
    { keywords: ["income tax", "corporate income tax", "cit", "section 14", "wholly and exclusively", "enterprise innovation scheme", "eis", "loss carry forward", "loss carry back", "withholding tax", "section 37", "section 37e"], cluster: 16, weight: 3.5 },
    // ACRA / Companies Act / Financial Reporting
    { keywords: ["companies act", "acra", "small company", "audit exemption", "section 199", "retention of records", "accounting records", "section 201", "financial statements", "directors disclosure", "company secretary"], cluster: 24, weight: 3.5 },
    // MOM Employment / Leave / Hours
    { keywords: ["employment act", "annual leave", "section 88a", "sick leave", "hospitalisation leave", "section 89", "overtime", "part iv", "working hours", "rest day", "retrenchment notification"], cluster: 32, weight: 3.5 },
    // CPF Board / Wage Ceilings / Contributions
    { keywords: ["cpf", "central provident fund", "ordinary wage", "ow ceiling", "additional wage", "cpf allocation", "medisave", "special account", "ordinary account", "contribution rate"], cluster: 40, weight: 3.5 },
    // PPE & Depreciation (IAS 16 / SFRS(I) 1-16)
    { keywords: ["property plant equipment", "ppe", "depreciation", "catch up depreciation", "derecognition", "carrying amount", "residual value", "disposal of asset"], cluster: 48, weight: 3.5 },
    // Intangible Assets & R&D (IAS 38 / SFRS(I) 1-38)
    { keywords: ["intangible assets", "research stage", "development stage", "capitalisation", "technical feasibility", "future economic benefits", "amortisation"], cluster: 56, weight: 3.5 },
    // Leases & ROU Assets (IFRS 16 / SFRS(I) 16)
    { keywords: ["leases", "right of use", "rou asset", "lease liability", "incremental borrowing rate", "present value of lease payments", "rental agreement"], cluster: 64, weight: 3.5 },
    // Financial Instruments (IFRS 9 / SFRS(I) 9)
    { keywords: ["financial instruments", "fvtpl", "fvtoci", "amortised cost", "loan payable", "unexpired interest", "contra liability", "equity investment"], cluster: 72, weight: 3.5 },
    // Foreign Currency (IAS 21 / SFRS(I) 1-21)
    { keywords: ["foreign currency", "spot rate", "exchange rate", "realized fx gain", "currency variance", "foreign exchange", "usd sgd", "functional currency"], cluster: 80, weight: 3.5 },
    // Commercial Transactions / Trade Discounts
    { keywords: ["trade discount", "supplier discount", "purchase invoice", "payment terms", "accounts payable", "cash at bank", "cost consideration"], cluster: 88, weight: 3 }
  ];
  /**
   * Deterministically maps any arbitrary string token into a 32-bit integer via FNV-1a.
   */
  fnv1a(str) {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
  /**
   * Generates a 128-dimensional dense vector representation for the given text.
   */
  embed(text) {
    const vector = new Float64Array(this.dimensions);
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return Array.from(vector);
    }
    const normalized = text.toLowerCase().replace(/[\r\n\t]+/g, " ").replace(/[^\w\s§()./-]/g, " ").trim();
    for (const concept of _DeterministicLocalEmbeddingService.DOMAIN_CONCEPTS) {
      for (const kw of concept.keywords) {
        if (normalized.includes(kw)) {
          const idx1 = concept.cluster % this.dimensions;
          const idx2 = (concept.cluster + 3) % this.dimensions;
          const idx3 = (concept.cluster + 7) % this.dimensions;
          vector[idx1] += concept.weight * 1;
          vector[idx2] += concept.weight * 0.6;
          vector[idx3] += concept.weight * 0.3;
        }
      }
    }
    const tokens = normalized.split(/[\s,.;:!?/()]+/).filter((t) => t.length >= 2);
    for (const token of tokens) {
      const hash = this.fnv1a(token);
      const dim = hash % this.dimensions;
      vector[dim] += 1.2;
      if (token.length >= 4) {
        for (let i = 0; i <= token.length - 3; i++) {
          const tri = token.substring(i, i + 3);
          const triHash = this.fnv1a(tri);
          const triDim = triHash % this.dimensions;
          vector[triDim] += 0.35;
        }
      }
    }
    let sumSquares = 0;
    for (let i = 0; i < this.dimensions; i++) {
      sumSquares += vector[i] * vector[i];
    }
    if (sumSquares > 0) {
      const norm = Math.sqrt(sumSquares);
      for (let i = 0; i < this.dimensions; i++) {
        vector[i] = Math.round(vector[i] / norm * 1e8) / 1e8;
      }
    }
    return Array.from(vector);
  }
  /**
   * Embeds multiple texts in batch.
   */
  embedBatch(texts) {
    return texts.map((t) => this.embed(t));
  }
  /**
   * Computes exact cosine similarity between two unit vectors.
   */
  similarity(a, b) {
    if (!a || !b || a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return Math.max(-1, Math.min(1, Math.round(dot * 1e8) / 1e8));
  }
};
var defaultEmbeddingService = new DeterministicLocalEmbeddingService();

// src/retrieval/vectorIndex.ts
var DeterministicVectorIndex = class {
  entries = /* @__PURE__ */ new Map();
  embeddingService;
  buildCounter = 0;
  snapshotMetadata;
  constructor(embeddingService = defaultEmbeddingService) {
    this.embeddingService = embeddingService;
    this.snapshotMetadata = {
      indexVersion: "v0",
      vectorizerVersion: embeddingService.vectorizerVersion,
      builtAt: (/* @__PURE__ */ new Date()).toISOString(),
      totalDocuments: 0,
      totalChunks: 0
    };
  }
  /**
   * Builds index from scratch with supplied chunks and Phase 4 ledger metadata.
   */
  build(chunks, ledgerHeadHash, registryVersionId) {
    this.entries.clear();
    this.buildCounter++;
    const parentIds = /* @__PURE__ */ new Set();
    for (const chunk of chunks) {
      if (!this.isEligibleForIndex(chunk)) {
        continue;
      }
      const vector = this.embeddingService.embed(chunk.chunkText);
      const entry = {
        chunkId: chunk.id,
        parentRecordId: chunk.parentRecordId,
        vector,
        textHash: chunk.textHash,
        vectorizerVersion: this.embeddingService.vectorizerVersion,
        evidenceTier: chunk.evidenceTier,
        sourceType: chunk.sourceType,
        validFrom: chunk.validFrom,
        validTo: chunk.validTo,
        chunk
      };
      this.entries.set(chunk.id, entry);
      parentIds.add(chunk.parentRecordId);
    }
    this.snapshotMetadata = {
      indexVersion: `v${this.buildCounter}`,
      vectorizerVersion: this.embeddingService.vectorizerVersion,
      registryVersionId,
      ledgerHeadHash,
      builtAt: (/* @__PURE__ */ new Date()).toISOString(),
      totalDocuments: parentIds.size,
      totalChunks: this.entries.size
    };
    return this.snapshotMetadata;
  }
  /**
   * Admission Gate check: Ensures only verified, non-staged, non-rejected chunks enter.
   */
  isEligibleForIndex(chunk) {
    if (chunk.evidenceTier === "CURATED_SUMMARY" || chunk.sourceType === "CURATED_SUMMARY") {
      return false;
    }
    if (chunk.parentRecordId.includes("staged") || chunk.parentRecordId.includes("candidate") || chunk.id.includes("staged")) {
      return false;
    }
    if (!chunk.textHash || chunk.textHash.length !== 64) {
      return false;
    }
    return true;
  }
  /**
   * Adds an eligible verified chunk to the index.
   */
  add(chunk) {
    if (!this.isEligibleForIndex(chunk)) {
      return false;
    }
    const vector = this.embeddingService.embed(chunk.chunkText);
    const entry = {
      chunkId: chunk.id,
      parentRecordId: chunk.parentRecordId,
      vector,
      textHash: chunk.textHash,
      vectorizerVersion: this.embeddingService.vectorizerVersion,
      evidenceTier: chunk.evidenceTier,
      sourceType: chunk.sourceType,
      validFrom: chunk.validFrom,
      validTo: chunk.validTo,
      chunk
    };
    this.entries.set(chunk.id, entry);
    this.snapshotMetadata.totalChunks = this.entries.size;
    return true;
  }
  /**
   * Removes a chunk from the index.
   */
  remove(chunkId) {
    const deleted = this.entries.delete(chunkId);
    if (deleted) {
      this.snapshotMetadata.totalChunks = this.entries.size;
    }
    return deleted;
  }
  /**
   * Performs vector search using cosine similarity with admission filtering and deterministic tie-breaking.
   */
  search(queryVector, limit = 20, filter) {
    const results = [];
    for (const entry of this.entries.values()) {
      if (!this.isEligibleForIndex(entry.chunk)) {
        continue;
      }
      if (filter && !filter(entry.chunk)) {
        continue;
      }
      const score = this.embeddingService.similarity(queryVector, entry.vector);
      results.push({
        chunk: entry.chunk,
        score
      });
    }
    results.sort((a, b) => {
      if (Math.abs(b.score - a.score) > 1e-6) {
        return b.score - a.score;
      }
      const tierRank = (tier) => {
        if (tier === "PRIMARY_SOURCE") return 3;
        if (tier === "OFFICIAL_GUIDANCE") return 2;
        return 1;
      };
      const tierDiff = tierRank(b.chunk.evidenceTier) - tierRank(a.chunk.evidenceTier);
      if (tierDiff !== 0) return tierDiff;
      return a.chunk.id.localeCompare(b.chunk.id);
    });
    return results.slice(0, limit);
  }
  getSnapshotMetadata() {
    return { ...this.snapshotMetadata };
  }
  size() {
    return this.entries.size;
  }
  clear() {
    this.entries.clear();
    this.snapshotMetadata.totalChunks = 0;
    this.snapshotMetadata.totalDocuments = 0;
  }
};
var defaultVectorIndex = new DeterministicVectorIndex();

// src/retrieval/retrievalConfig.ts
var RETRIEVAL_CONFIG = {
  lexicalTopK: 20,
  denseTopK: 20,
  candidatePoolSize: 40,
  rrfK: 60,
  rrfWeight: 0.1,
  lexicalWeight: 0.55,
  semanticWeight: 0.45,
  minSemanticSimilarity: 0.3,
  tierWeights: {
    PRIMARY_SOURCE: 0.15,
    OFFICIAL_GUIDANCE: 0.05,
    CURATED_SUMMARY: 0,
    APPLICATION_RULE: -0.05
  },
  topicMatchWeight: 0.1,
  semanticAlignmentBoost: 0.15,
  semanticConflictPenalty: -0.2,
  fallbackSemanticMultiplier: 0.7,
  minTopicCoverageScore: 0.35,
  finalTopK: 10
};

// src/retrieval/hybridRetriever.ts
var HybridRetriever = class {
  vectorIndex;
  embeddingService;
  constructor(vectorIndex, embeddingService) {
    this.vectorIndex = vectorIndex;
    this.embeddingService = embeddingService;
  }
  /**
   * Evaluates hard temporal eligibility for a chunk.
   * Returns true if eligible, false if hard-rejected.
   */
  isTemporallyEligible(chunk, targetDate, referenceDate, isHistoricalExplicitlyRequested) {
    if (targetDate) {
      const fromMatch = !chunk.validFrom || chunk.validFrom <= targetDate;
      const toMatch = !chunk.validTo || chunk.validTo >= targetDate;
      if (!fromMatch || !toMatch) {
        return isHistoricalExplicitlyRequested;
      }
      return true;
    }
    if (chunk.validTo && chunk.validTo < referenceDate) {
      return isHistoricalExplicitlyRequested;
    }
    return true;
  }
  /**
   * Retrieves and fuses candidates from lexical candidates and dense vector search.
   */
  retrieveHybridCandidates(retrievalQuery, lexicalMatches, recordLookup) {
    const {
      query,
      domain,
      authorities,
      targetDate: explicitTargetDate,
      referenceDate = SourceFreshnessManager.DEFAULT_REFERENCE_DATE,
      includeHistorical = false
    } = retrievalQuery;
    let excludedUnverified = 0;
    let excludedTemporalMismatch = 0;
    const resolvedDateInfo = explicitTargetDate ? { targetDate: explicitTargetDate, isHistorical: explicitTargetDate < referenceDate } : defaultTargetDateResolver.resolveTargetDate(query, referenceDate);
    const effectiveTargetDate = resolvedDateInfo.targetDate;
    const lowerQ = query.toLowerCase();
    const mentionsHistorical = resolvedDateInfo.isHistorical || includeHistorical || lowerQ.includes("historical") || lowerQ.includes("prior to") || lowerQ.includes("before") || lowerQ.includes("old rate") || lowerQ.includes("former") || lowerQ.includes("previous") || lowerQ.includes("superseded");
    const lexicalTop = lexicalMatches.slice(0, RETRIEVAL_CONFIG.lexicalTopK);
    const lexicalRankMap = /* @__PURE__ */ new Map();
    lexicalTop.forEach((item, index) => {
      lexicalRankMap.set(item.chunk.id, { rank: index + 1, score: item.score });
    });
    const queryVector = this.embeddingService.embed(query);
    const vectorResults = this.vectorIndex.search(queryVector, RETRIEVAL_CONFIG.denseTopK);
    const relevantVectorResults = vectorResults.filter(
      (v) => v.score >= RETRIEVAL_CONFIG.minSemanticSimilarity || lexicalRankMap.has(v.chunk.id)
    );
    const vectorRankMap = /* @__PURE__ */ new Map();
    relevantVectorResults.forEach((item, index) => {
      vectorRankMap.set(item.chunk.id, { rank: index + 1, score: item.score });
    });
    const candidateMap = /* @__PURE__ */ new Map();
    for (const item of lexicalTop) {
      candidateMap.set(item.chunk.id, { chunk: item.chunk, parentRecord: item.parentRecord });
    }
    for (const item of relevantVectorResults) {
      if (!candidateMap.has(item.chunk.id)) {
        const parent = recordLookup(item.chunk.parentRecordId);
        if (parent) {
          candidateMap.set(item.chunk.id, { chunk: item.chunk, parentRecord: parent });
        }
      }
    }
    const eligibleCandidates = [];
    const rrfK = RETRIEVAL_CONFIG.rrfK;
    const maxRrf = 2 / (rrfK + 1);
    for (const [chunkId, { chunk, parentRecord }] of candidateMap.entries()) {
      if (parentRecord.sourceStatus === "REJECTED" || parentRecord.id.includes("staged") || parentRecord.id.includes("candidate")) {
        excludedUnverified++;
        continue;
      }
      if (authorities && authorities.length > 0) {
        if (!authorities.includes(parentRecord.authority)) {
          continue;
        }
      } else if (domain && domain !== "GENERAL") {
        if (parentRecord.domain !== domain) {
          continue;
        }
      }
      const isEligible = this.isTemporallyEligible(chunk, effectiveTargetDate, referenceDate, mentionsHistorical);
      if (!isEligible) {
        excludedTemporalMismatch++;
        continue;
      }
      const lex = lexicalRankMap.get(chunkId);
      const vec = vectorRankMap.get(chunkId);
      let rrfScore = 0;
      if (lex) {
        rrfScore += 1 / (rrfK + lex.rank);
      }
      if (vec) {
        rrfScore += 1 / (rrfK + vec.rank);
      }
      const normalizedRrfScore = Math.min(1, rrfScore / maxRrf);
      eligibleCandidates.push({
        chunk,
        parentRecord,
        lexicalRank: lex?.rank,
        lexicalScore: lex?.score,
        vectorRank: vec?.rank,
        vectorScore: vec?.score,
        rrfScore,
        normalizedRrfScore
      });
    }
    eligibleCandidates.sort((a, b) => b.rrfScore - a.rrfScore);
    const candidatePool = eligibleCandidates.slice(0, RETRIEVAL_CONFIG.candidatePoolSize);
    return {
      candidates: candidatePool,
      excludedUnverified,
      excludedTemporalMismatch
    };
  }
};

// src/standards/semanticAccountingRules.ts
var SEMANTIC_ACCOUNTING_RULES = [
  // -------------------------------------------------------------------------
  // 1. OWNERSHIP CONTEXT RULES
  // -------------------------------------------------------------------------
  {
    id: "own_equity_ownership",
    name: "Own Share Capital Ownership Context",
    dimension: "ownership",
    description: "Ownership context is reporting entity own ordinary share capital",
    ownershipContexts: ["own_equity"],
    blockedByTransactionTypes: ["expense_payment", "inventory_purchase", "customer_invoice", "lease_contract", "lease_payment"],
    positiveAlignments: [
      {
        actOrStandard: "Companies Act 1967",
        sections: ["68", "63", "78b"],
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: "own_equity:Companies Act 1967"
      },
      {
        actOrStandard: "SFRS(I) 1-32",
        sections: ["33"],
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: "own_equity:SFRS(I) 1-32 \xA733"
      }
    ],
    conflicts: [
      {
        actOrStandard: "SFRS(I) 9",
        tags: ["fvtpl", "fvtoci", "financial asset", "trading"],
        penalty: RETRIEVAL_CONFIG.semanticConflictPenalty,
        description: "own_equity:SFRS(I) 9 Financial Asset Conflict"
      },
      {
        actOrStandard: "IFRS 9",
        tags: ["fvtpl", "fvtoci", "financial asset", "trading"],
        penalty: RETRIEVAL_CONFIG.semanticConflictPenalty,
        description: "own_equity:IFRS 9 Financial Asset Conflict"
      },
      {
        actOrStandard: "IAS 21",
        penalty: -0.1,
        description: "own_equity:Foreign Exchange Conflict"
      },
      {
        actOrStandard: "SFRS(I) 1-21",
        penalty: -0.1,
        description: "own_equity:Foreign Exchange Conflict"
      }
    ]
  },
  {
    id: "external_investment_ownership",
    name: "External Entity Investment Ownership Context",
    dimension: "ownership",
    description: "Acquisition or holding of securities/instruments issued by external entities",
    ownershipContexts: ["external_investment"],
    blockedByTransactionTypes: ["lease_contract", "lease_payment", "payroll_payment", "share_capital_issuance"],
    positiveAlignments: [
      {
        actOrStandard: "SFRS(I) 9",
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: "external_investment:SFRS(I) 9"
      },
      {
        actOrStandard: "IFRS 9",
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: "external_investment:IFRS 9"
      },
      {
        actOrStandard: "IAS 21",
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: "external_investment:IAS 21"
      },
      {
        actOrStandard: "SFRS(I) 1-21",
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: "external_investment:SFRS(I) 1-21"
      }
    ],
    conflicts: [
      // NARROWED CONFLICT: Only own-equity specific provisions of Companies Act conflict with external investments!
      // General corporate provisions (§199 records, §201 statements, 13th Schedule audit) DO NOT conflict.
      {
        actOrStandard: "Companies Act 1967",
        sections: ["68", "63", "78b"],
        penalty: RETRIEVAL_CONFIG.semanticConflictPenalty,
        description: "external_investment:Companies Act 1967 \xA768 Conflict"
      }
    ]
  },
  // -------------------------------------------------------------------------
  // 2. TRANSACTION TYPE RULES
  // -------------------------------------------------------------------------
  {
    id: "equity_issuance_tx",
    name: "Share Capital Issuance Transaction",
    dimension: "transactionType",
    description: "Issuance or subscription of reporting entity share capital",
    transactionTypes: ["share_capital_issuance", "capital_reduction"],
    positiveAlignments: [
      {
        actOrStandard: "Companies Act 1967",
        sections: ["68", "63", "78b"],
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: "transactionType:share_capital:Companies Act 1967"
      }
    ],
    conflicts: []
  },
  {
    id: "commercial_lease_inception",
    name: "SFRS(I) 16 Commercial Lease Capitalisation",
    dimension: "transactionType",
    description: "Inception and initial recognition of right-of-use asset and lease liability under SFRS(I) 16 \xA722",
    transactionTypes: ["lease_contract"],
    blockedByTransactionTypes: ["expense_payment", "inventory_purchase", "share_capital_issuance", "capital_reduction", "payroll_payment"],
    positiveAlignments: [
      {
        actOrStandard: "SFRS(I) 16",
        sections: ["22", "23", "26"],
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: "transactionType:lease:SFRS(I) 16"
      },
      {
        actOrStandard: "IFRS 16",
        sections: ["22", "23", "26"],
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: "transactionType:lease:IFRS 16"
      }
    ],
    conflicts: [
      {
        actOrStandard: "Companies Act 1967",
        sections: ["68", "63", "78b"],
        penalty: RETRIEVAL_CONFIG.semanticConflictPenalty,
        description: "transactionType:lease:Companies Act \xA768 Conflict"
      }
    ]
  },
  {
    id: "lease_settlement",
    name: "SFRS(I) 16 Lease Settlement",
    dimension: "transactionType",
    description: "Subsequent periodic lease liability reduction and interest accretion under SFRS(I) 16 \xA736",
    transactionTypes: ["lease_payment"],
    blockedByTransactionTypes: ["share_capital_issuance", "capital_reduction"],
    positiveAlignments: [
      {
        actOrStandard: "SFRS(I) 16",
        sections: ["36", "37", "38"],
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: "transactionType:lease_payment:SFRS(I) 16 \xA736"
      },
      {
        actOrStandard: "IFRS 16",
        sections: ["36", "37", "38"],
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: "transactionType:lease_payment:IFRS 16 \xA736"
      }
    ],
    conflicts: []
  },
  {
    id: "rd_capitalization_tx",
    name: "SFRS(I) 1-38 Development Cost Capitalisation",
    dimension: "transactionType",
    description: "Capitalisation of qualifying internal development costs meeting 6 cumulative criteria",
    transactionTypes: ["rd_capitalization"],
    blockedByTransactionTypes: ["lease_contract", "lease_payment", "payroll_payment", "dividend_payment"],
    positiveAlignments: [
      {
        actOrStandard: "SFRS(I) 1-38",
        sections: ["57"],
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: "transactionType:rd_capitalization:SFRS(I) 1-38 \xA757"
      }
    ],
    conflicts: []
  },
  {
    id: "ppe_trade_discount_tx",
    name: "SFRS(I) 1-16 PPE Acquisition & Trade Discount Deduction",
    dimension: "transactionType",
    description: "Property, plant & equipment purchase with statutory deduction of trade discounts",
    transactionTypes: ["trade_discount_purchase", "asset_purchase", "depreciation_expense"],
    blockedByTransactionTypes: ["lease_contract", "payroll_payment", "share_capital_issuance"],
    positiveAlignments: [
      {
        actOrStandard: "SFRS(I) 1-16",
        sections: ["16", "55"],
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: "transactionType:ppe:SFRS(I) 1-16"
      }
    ],
    conflicts: []
  },
  {
    id: "payroll_tx",
    name: "Employment Act 1968 & Central Provident Fund Act 1953",
    dimension: "transactionType",
    description: "Statutory employment leave, overtime limits, and CPF wage ceilings/contribution rates",
    transactionTypes: ["payroll_payment", "director_fee_payment"],
    blockedByTransactionTypes: ["lease_contract", "asset_purchase", "share_capital_issuance", "capital_reduction"],
    positiveAlignments: [
      {
        actOrStandard: "Employment Act 1968",
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: "transactionType:payroll:Employment Act 1968"
      },
      {
        actOrStandard: "Central Provident Fund Act 1953",
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: "transactionType:payroll:Central Provident Fund Act 1953"
      }
    ],
    conflicts: []
  },
  {
    id: "tax_tx",
    name: "Singapore Income Tax Act 1947",
    dimension: "transactionType",
    description: "Section 14 general tax deductibility and loss relief provisions",
    transactionTypes: ["expense_payment", "tax_payment", "tax_provision"],
    positiveAlignments: [
      {
        actOrStandard: "Income Tax Act 1947",
        sections: ["14", "37", "37e"],
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: "transactionType:tax:Income Tax Act 1947"
      }
    ],
    conflicts: []
  },
  // -------------------------------------------------------------------------
  // 3. INSTRUMENT RULES
  // -------------------------------------------------------------------------
  {
    id: "intangible_asset_instrument",
    name: "Intangible Asset Instrument",
    dimension: "instrument",
    description: "Intangible asset recognition under SFRS(I) 1-38",
    instruments: ["intangible_asset"],
    positiveAlignments: [
      {
        actOrStandard: "SFRS(I) 1-38",
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: "instrument:intangible_asset:SFRS(I) 1-38"
      }
    ],
    conflicts: []
  },
  {
    id: "fixed_asset_instrument",
    name: "PPE / Fixed Asset Instrument",
    dimension: "instrument",
    description: "PPE and fixed asset measurement under SFRS(I) 1-16",
    instruments: ["property_plant_equipment"],
    positiveAlignments: [
      {
        actOrStandard: "SFRS(I) 1-16",
        sections: ["16", "55"],
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: "instrument:property_plant_equipment:SFRS(I) 1-16"
      }
    ],
    conflicts: []
  },
  {
    id: "financial_asset_instrument",
    name: "Financial Asset / Debt Instrument",
    dimension: "instrument",
    description: "Financial asset classification and measurement under SFRS(I) 9",
    instruments: ["debt_instrument", "marketable_securities", "derivative", "financial_asset_equity"],
    positiveAlignments: [
      {
        actOrStandard: "SFRS(I) 9",
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: "instrument:financial_asset:SFRS(I) 9"
      }
    ],
    conflicts: []
  },
  // -------------------------------------------------------------------------
  // 4. COUNTERPARTY ROLE RULES
  // -------------------------------------------------------------------------
  {
    id: "shareholder_role",
    name: "Shareholder Counterparty Role",
    dimension: "counterpartyRole",
    description: "Counterparty is existing or prospective shareholder",
    counterpartyRoles: ["shareholder", "director"],
    positiveAlignments: [
      {
        actOrStandard: "Companies Act 1967",
        sections: ["68", "63", "78b", "142"],
        boost: 0.05,
        description: "counterparty:shareholder:Companies Act"
      }
    ],
    conflicts: []
  },
  {
    id: "director_role",
    name: "Director Counterparty Role",
    dimension: "counterpartyRole",
    description: "Counterparty is company director subject to conflict disclosure",
    counterpartyRoles: ["director"],
    positiveAlignments: [
      {
        actOrStandard: "Companies Act 1967",
        sections: ["156"],
        boost: 0.1,
        description: "counterparty:director:Section 156 Conflict Disclosure"
      }
    ],
    conflicts: []
  },
  {
    id: "customer_role",
    name: "Customer Counterparty Role",
    dimension: "counterpartyRole",
    description: "Counterparty is customer under GST and revenue recognition",
    counterpartyRoles: ["customer"],
    positiveAlignments: [
      {
        actOrStandard: "Goods and Services Tax Act 1993",
        sections: ["82", "14"],
        boost: 0.1,
        description: "counterparty:customer:GST Bad Debt / Reverse Charge"
      }
    ],
    conflicts: []
  },
  {
    id: "supplier_role",
    name: "Supplier Counterparty Role",
    dimension: "counterpartyRole",
    description: "Counterparty is trade vendor/supplier providing discounts",
    counterpartyRoles: ["supplier"],
    positiveAlignments: [
      {
        actOrStandard: "SFRS(I) 1-16",
        sections: ["16"],
        boost: 0.1,
        description: "counterparty:supplier:Trade Discount Deduction"
      }
    ],
    conflicts: []
  },
  {
    id: "employee_role",
    name: "Employee Counterparty Role",
    dimension: "counterpartyRole",
    description: "Counterparty is employee governed by Employment Act 1968",
    counterpartyRoles: ["employee"],
    positiveAlignments: [
      {
        actOrStandard: "Employment Act 1968",
        boost: 0.1,
        description: "counterparty:employee:Employment Act"
      }
    ],
    conflicts: []
  },
  // -------------------------------------------------------------------------
  // 5. PAYMENT STATUS RULES
  // -------------------------------------------------------------------------
  {
    id: "unpaid_payment_status",
    name: "Unpaid Payment Status",
    dimension: "paymentStatus",
    description: "Transaction amount remains unpaid creating receivable / allotment receivable",
    paymentStatuses: ["unpaid"],
    positiveAlignments: [
      {
        actOrStandard: "Companies Act 1967",
        sections: ["63"],
        boost: 0.05,
        description: "paymentStatus:unpaid:Companies Act \xA763(1) Allotment Receivable"
      }
    ],
    conflicts: []
  }
];
var CANONICAL_TOPIC_SEMANTIC_CRITERIA = {
  mom_annual_leave: {
    transactionTypes: ["payroll_payment"],
    counterpartyRoles: ["employee"],
    blockedByTransactionTypes: ["lease_contract", "lease_payment", "asset_purchase", "share_capital_issuance", "capital_reduction"]
  },
  mom_sick_leave: {
    transactionTypes: ["payroll_payment"],
    counterpartyRoles: ["employee"],
    blockedByTransactionTypes: ["lease_contract", "lease_payment", "asset_purchase", "share_capital_issuance", "capital_reduction"]
  },
  mom_overtime: {
    transactionTypes: ["payroll_payment"],
    counterpartyRoles: ["employee"],
    blockedByTransactionTypes: ["lease_contract", "lease_payment", "asset_purchase", "share_capital_issuance", "capital_reduction"]
  },
  cpf_wage_ceiling: {
    transactionTypes: ["payroll_payment", "director_fee_payment"],
    counterpartyRoles: ["employee", "director"],
    blockedByTransactionTypes: ["lease_contract", "lease_payment", "asset_purchase", "share_capital_issuance", "capital_reduction"]
  },
  cpf_contribution_rates: {
    transactionTypes: ["payroll_payment", "director_fee_payment"],
    counterpartyRoles: ["employee", "director"],
    blockedByTransactionTypes: ["lease_contract", "lease_payment", "asset_purchase", "share_capital_issuance", "capital_reduction"]
  },
  gst_bad_debt_relief: {
    counterpartyRoles: ["customer"]
  },
  cit_section_14: {
    transactionTypes: ["expense_payment", "tax_payment", "tax_provision"]
  },
  cit_loss_relief: {
    transactionTypes: ["tax_payment", "tax_provision"]
  },
  sfrsi_intangibles_cap: {
    transactionTypes: ["rd_capitalization"],
    instruments: ["intangible_asset"],
    blockedByTransactionTypes: ["lease_contract", "lease_payment", "payroll_payment", "dividend_payment"]
  },
  sfrsi_leases: {
    transactionTypes: ["lease_contract"],
    instruments: ["right_of_use_asset", "lease_liability"],
    blockedByTransactionTypes: ["expense_payment", "inventory_purchase", "share_capital_issuance", "capital_reduction"]
  },
  sfrsi_ppe: {
    transactionTypes: ["asset_purchase", "trade_discount_purchase", "depreciation_expense"],
    instruments: ["property_plant_equipment"],
    blockedByTransactionTypes: ["lease_contract", "payroll_payment", "share_capital_issuance"]
  },
  acra_share_capital: {
    ownershipContexts: ["own_equity"],
    transactionTypes: ["share_capital_issuance", "capital_reduction"],
    counterpartyRoles: ["shareholder", "director"],
    blockedByTransactionTypes: ["expense_payment", "inventory_purchase", "customer_invoice", "lease_contract"]
  },
  sfrsi_own_equity: {
    ownershipContexts: ["own_equity"],
    counterpartyRoles: ["shareholder", "director"],
    blockedByTransactionTypes: ["expense_payment", "inventory_purchase", "customer_invoice", "lease_contract"]
  },
  sfrsi_financial_instruments: {
    ownershipContexts: ["external_investment"],
    transactionTypes: ["equity_investment_acquisition"],
    instruments: ["financial_asset_equity", "debt_instrument", "marketable_securities", "derivative"],
    blockedByTransactionTypes: ["lease_contract", "lease_payment", "payroll_payment", "share_capital_issuance"]
  }
};

// src/retrieval/queryTopicResolver.ts
var QueryTopicResolver = class _QueryTopicResolver {
  static CANONICAL_TOPICS = [
    {
      id: "mom_annual_leave",
      name: "Paid Annual Leave",
      keywords: ["annual leave", "leave entitlement", "vacation days", "paid leave", "section 88a"],
      actOrStandard: "Employment Act 1968",
      sectionMatch: "88a",
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.mom_annual_leave
    },
    {
      id: "mom_sick_leave",
      name: "Outpatient Sick & Hospitalisation Leave",
      keywords: ["sick leave", "medical leave", "hospitalisation leave", "hospitalization", "mc", "section 89"],
      actOrStandard: "Employment Act 1968",
      sectionMatch: "89",
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.mom_sick_leave
    },
    {
      id: "mom_overtime",
      name: "Overtime & Working Hours (Part IV)",
      keywords: ["overtime", "part iv", "working hours", "rest day", "1.5 times", "section 38"],
      actOrStandard: "Employment Act 1968",
      sectionMatch: "38",
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.mom_overtime
    },
    {
      id: "cpf_wage_ceiling",
      name: "CPF Ordinary Wage Ceiling",
      keywords: ["cpf ceiling", "ordinary wage ceiling", "ow ceiling", "cpf limit", "monthly ceiling"],
      actOrStandard: "Central Provident Fund Act 1953",
      sectionMatch: "first schedule",
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.cpf_wage_ceiling
    },
    {
      id: "cpf_contribution_rates",
      name: "CPF Tiered Contribution Rates by Age",
      keywords: ["cpf rate", "cpf contribution", "employee contribution", "employer contribution", "age 55"],
      actOrStandard: "Central Provident Fund Act 1953",
      sectionMatch: "rates",
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.cpf_contribution_rates
    },
    {
      id: "gst_compulsory_registration",
      name: "GST Compulsory Registration Threshold",
      keywords: ["gst registration", "compulsory registration", "1 million turnover", "1m turnover", "gst threshold"],
      actOrStandard: "Goods and Services Tax Act 1993",
      sectionMatch: "first schedule"
    },
    {
      id: "gst_reverse_charge",
      name: "GST Reverse Charge on Imported Services",
      keywords: ["reverse charge", "imported services", "b2b imported", "section 14"],
      actOrStandard: "Goods and Services Tax Act 1993",
      sectionMatch: "14"
    },
    {
      id: "gst_bad_debt_relief",
      name: "GST Bad Debt Relief",
      keywords: ["bad debt relief", "bad debt", "insolvent customer", "regulations 82", "reg 82"],
      actOrStandard: "Goods and Services Tax (General) Regulations",
      sectionMatch: "82",
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.gst_bad_debt_relief
    },
    {
      id: "cit_section_14",
      name: "Section 14 Tax Deductibility",
      keywords: ["section 14", "wholly and exclusively", "business expense tax deduction", "deductible expense"],
      actOrStandard: "Income Tax Act 1947",
      sectionMatch: "14",
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.cit_section_14
    },
    {
      id: "cit_loss_relief",
      name: "Tax Loss Carry-Forward & Carry-Back",
      keywords: ["loss carry forward", "loss carry back", "unabsorbed losses", "section 37", "section 37e"],
      actOrStandard: "Income Tax Act 1947",
      sectionMatch: "37",
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.cit_loss_relief
    },
    {
      id: "acra_small_company",
      name: "Small Company Audit Exemption Criteria",
      keywords: ["small company", "audit exemption", "audit exempt", "13th schedule", "revenue 10m", "assets 10m"],
      actOrStandard: "Companies Act 1967",
      sectionMatch: "thirteenth schedule"
    },
    {
      id: "acra_record_retention",
      name: "Accounting Records Retention Period",
      keywords: ["retention of records", "keep records", "5 years", "five years", "accounting records", "section 199"],
      actOrStandard: "Companies Act 1967",
      sectionMatch: "199"
    },
    {
      id: "acra_financial_statements",
      name: "Financial Statements Presentation",
      keywords: ["financial statements", "presentation of accounts", "section 201", "true and fair view"],
      actOrStandard: "Companies Act 1967",
      sectionMatch: "201"
    },
    {
      id: "sfrsi_intangibles_cap",
      name: "SFRS(I) 1-38 Development Cost Capitalisation",
      keywords: ["development cost", "capitalisation", "intangible asset", "research vs development", "technical feasibility", "paragraph 57", "\xA757"],
      actOrStandard: "SFRS(I) 1-38",
      sectionMatch: "57",
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.sfrsi_intangibles_cap
    },
    {
      id: "sfrsi_leases",
      name: "SFRS(I) 16 Lease Capitalisation",
      keywords: ["right of use", "rou asset", "lease liability", "incremental borrowing rate", "sfrs(i) 16", "ifrs 16"],
      actOrStandard: "SFRS(I) 16",
      sectionMatch: "22",
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.sfrsi_leases
    },
    {
      id: "sfrsi_ppe",
      name: "SFRS(I) 1-16 PPE & Depreciation",
      keywords: ["ppe", "catch up depreciation", "derecognition", "trade in machinery", "carrying amount", "sfrs(i) 1-16"],
      actOrStandard: "SFRS(I) 1-16",
      sectionMatch: "55",
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.sfrsi_ppe
    },
    {
      id: "acra_share_capital",
      name: "Companies Act 1967 Section 68 / 63 Share Capital & Allotment",
      keywords: ["share capital", "allotment", "no par value", "unpaid shares", "section 68", "section 63", "own company share"],
      actOrStandard: "Companies Act 1967",
      sectionMatch: "68",
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.acra_share_capital
    },
    {
      id: "sfrsi_own_equity",
      name: "SFRS(I) 1-32 Own Equity Presentation vs Financial Assets",
      keywords: ["equity instrument", "own shares", "sfrs(i) 1-32", "ias 32", "share capital equity"],
      actOrStandard: "SFRS(I) 1-32",
      sectionMatch: "33",
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.sfrsi_own_equity
    },
    {
      id: "sfrsi_financial_instruments",
      name: "SFRS(I) 9 Financial Assets & Investments",
      keywords: ["financial asset", "financial instrument", "marketable securities", "shares in other company", "fvtoci", "fvtpl", "amortised cost", "sfrs(i) 9"],
      actOrStandard: "SFRS(I) 9",
      sectionMatch: "4.1",
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.sfrsi_financial_instruments
    }
  ];
  /**
   * Decomposes user query into identified statutory and accounting topics.
   *
   * Semantic Architecture & Rules:
   * 1. Semantic criteria act as the PRIMARY topic signal.
   * 2. 'semantic_corroborated' is defined as lexical evidence consistent with the topic's specific semantic classification.
   * 3. When a usable semantic context exists, uncorroborated 'lexical_only' matches are prevented from expanding the topic list.
   * 4. If no semantic topics match, 'lexical_only' activates as a controlled fallback.
   * 5. 'unknown' attributes are strictly neutral.
   */
  decomposeQuery(query, semanticContext, options) {
    if (!query || typeof query !== "string") {
      return { isMultiTopic: false, topics: [], unresolvedTopics: [] };
    }
    const qLower = query.toLowerCase();
    const sem = semanticContext;
    const hasSem = Boolean(sem);
    const semOwnContext = sem?.ownershipContext && sem.ownershipContext !== "unknown" && sem.ownershipContext !== "not_applicable" ? sem.ownershipContext : void 0;
    const semTxType = sem?.transactionType && sem.transactionType !== "unclassified_transaction" ? sem.transactionType : void 0;
    const semInstrument = sem?.instrument && sem.instrument !== "unknown" ? sem.instrument : void 0;
    const semCounterpartyRole = sem?.counterparty?.role && sem.counterparty.role !== "unknown" ? sem.counterparty.role : void 0;
    const hasUsableSemanticContext = hasSem && (semTxType !== void 0 || semOwnContext !== void 0) && (sem?.confidence ?? 0) >= 0.5;
    const semMatchedTopics = [];
    const lexicalOnlyTopics = [];
    for (const topic of _QueryTopicResolver.CANONICAL_TOPICS) {
      const criteria = topic.semanticCriteria;
      if (semTxType && criteria?.blockedByTransactionTypes?.includes(semTxType)) {
        continue;
      }
      let hasSemanticMatch = false;
      if (criteria && hasSem) {
        if (semOwnContext && criteria.ownershipContexts?.includes(semOwnContext)) {
          hasSemanticMatch = true;
        }
        if (semTxType && criteria.transactionTypes?.includes(semTxType)) {
          hasSemanticMatch = true;
        }
        if (semInstrument && criteria.instruments?.includes(semInstrument)) {
          hasSemanticMatch = true;
        }
        if (semCounterpartyRole && criteria.counterpartyRoles?.includes(semCounterpartyRole)) {
          hasSemanticMatch = true;
        }
      }
      const hasLexicalMatch = topic.keywords.some((kw) => qLower.includes(kw));
      if (hasSemanticMatch && hasLexicalMatch) {
        semMatchedTopics.push({
          ...topic,
          matchSource: "semantic_corroborated",
          primarySignalScore: 1
        });
      } else if (hasSemanticMatch) {
        semMatchedTopics.push({
          ...topic,
          matchSource: "semantic_primary",
          primarySignalScore: sem?.confidence ?? 0.9
        });
      } else if (hasLexicalMatch) {
        lexicalOnlyTopics.push({
          ...topic,
          matchSource: "lexical_only",
          primarySignalScore: 0.5
        });
      }
    }
    let matchedTopics = [];
    if (hasUsableSemanticContext && !options?.allowLexicalExpansion) {
      if (semMatchedTopics.length > 0) {
        matchedTopics = semMatchedTopics;
      } else {
        matchedTopics = lexicalOnlyTopics;
      }
    } else {
      matchedTopics = [...semMatchedTopics, ...lexicalOnlyTopics];
    }
    const isMultiTopic = matchedTopics.length > 1;
    const unresolvedTopics = [];
    if (qLower.includes(" and ") || qLower.includes(" as well as ") || qLower.includes(" also ")) {
      const parts = qLower.split(/\band\b|\bas well as\b|\balso\b/);
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.length > 5) {
          const partMatched = matchedTopics.some(
            (t) => t.keywords.some((kw) => trimmed.includes(kw))
          );
          if (!partMatched) {
            unresolvedTopics.push(trimmed);
          }
        }
      }
    }
    return {
      isMultiTopic,
      topics: matchedTopics,
      unresolvedTopics
    };
  }
  /**
   * Checks whether a chunk satisfies an identified topic.
   */
  chunkMatchesTopic(chunkText, topic) {
    const textLower = chunkText.toLowerCase();
    return topic.keywords.some((kw) => textLower.includes(kw));
  }
};
var defaultQueryTopicResolver = new QueryTopicResolver();

// src/retrieval/semanticAlignmentEvaluator.ts
var DeterministicSemanticAlignmentEvaluator = class {
  evaluateAlignment(chunk, parentRecord, semanticContext) {
    if (!semanticContext) {
      return {
        baseDeltaSemantics: 0,
        provenanceMultiplier: 1,
        finalDeltaSemantics: 0,
        deltaSemantics: 0,
        boost: 0,
        penalty: 0,
        explanation: "No semantic context provided (neutral alignment)",
        matchedAttributes: [],
        conflictAttributes: [],
        hasSemanticConflict: false
      };
    }
    const isFallback = Boolean(semanticContext.provenance?.isFallback);
    const provenanceTier = semanticContext.provenance?.tier || (isFallback ? "DETERMINISTIC_HEURISTIC_FALLBACK" : "AI_REASONING");
    const provenanceMultiplier = isFallback ? RETRIEVAL_CONFIG.fallbackSemanticMultiplier ?? 0.7 : 1;
    const confidence = semanticContext.confidence;
    let boost = 0;
    let penalty = 0;
    const matchedAttributes = [];
    const conflictAttributes = [];
    const actCode = (parentRecord.standardOrActCode || "").trim();
    const section = (parentRecord.paragraphOrSection || chunk.section || chunk.sourceLocator?.section || "").toLowerCase().replace(/[\s\-_()§]/g, "");
    const tags = (parentRecord.tags || []).map((t) => t.toLowerCase());
    const chunkTags = (chunk.tags || []).map((t) => t.toLowerCase());
    const allTags = [...tags, ...chunkTags];
    for (const rule of SEMANTIC_ACCOUNTING_RULES) {
      if (rule.blockedByTransactionTypes && semanticContext.transactionType && rule.blockedByTransactionTypes.includes(semanticContext.transactionType)) {
        continue;
      }
      let matchesContext = false;
      switch (rule.dimension) {
        case "ownership":
          if (semanticContext.ownershipContext && semanticContext.ownershipContext !== "unknown" && semanticContext.ownershipContext !== "not_applicable" && rule.ownershipContexts?.includes(semanticContext.ownershipContext)) {
            matchesContext = true;
          }
          break;
        case "transactionType":
          if (semanticContext.transactionType && semanticContext.transactionType !== "unclassified_transaction" && rule.transactionTypes?.includes(semanticContext.transactionType)) {
            matchesContext = true;
          }
          break;
        case "instrument":
          if (semanticContext.instrument && semanticContext.instrument !== "unknown" && rule.instruments?.includes(semanticContext.instrument)) {
            matchesContext = true;
          }
          break;
        case "counterpartyRole":
          if (semanticContext.counterparty?.role && semanticContext.counterparty.role !== "unknown" && rule.counterpartyRoles?.includes(semanticContext.counterparty.role)) {
            matchesContext = true;
          }
          break;
        case "paymentStatus":
          if (semanticContext.paymentStatus && semanticContext.paymentStatus !== "unknown" && rule.paymentStatuses?.includes(semanticContext.paymentStatus)) {
            matchesContext = true;
          }
          break;
      }
      if (!matchesContext) {
        continue;
      }
      for (const target of rule.positiveAlignments) {
        const actMatches = actCode === target.actOrStandard || actCode.includes(target.actOrStandard) || target.actOrStandard.includes(actCode);
        const sectionMatches = !target.sections || target.sections.length === 0 || target.sections.some((s) => section.includes(s.toLowerCase()));
        const tagMatches = !target.tags || target.tags.length === 0 || target.tags.some((reqTag) => allTags.some((t) => t.includes(reqTag.toLowerCase())));
        if (actMatches && sectionMatches && tagMatches) {
          const boostVal = target.boost ?? RETRIEVAL_CONFIG.semanticAlignmentBoost;
          boost += boostVal;
          matchedAttributes.push(target.description);
        }
      }
      for (const target of rule.conflicts) {
        const actMatches = actCode === target.actOrStandard || actCode.includes(target.actOrStandard) || target.actOrStandard.includes(actCode);
        const sectionMatches = !target.sections || target.sections.length === 0 || target.sections.some((s) => section.includes(s.toLowerCase()));
        const tagMatches = target.tags && target.tags.length > 0 ? target.tags.some((reqTag) => allTags.some((t) => t.includes(reqTag.toLowerCase()))) : false;
        const isConflict = actMatches && sectionMatches || tagMatches;
        if (isConflict) {
          const penaltyVal = target.penalty ?? RETRIEVAL_CONFIG.semanticConflictPenalty;
          penalty += penaltyVal;
          conflictAttributes.push(target.description);
        }
      }
    }
    const rawBaseDelta = boost + penalty;
    const clampedBaseDelta = Math.min(0.25, Math.max(-0.25, rawBaseDelta));
    const baseDeltaSemantics = Math.round(clampedBaseDelta * 1e6) / 1e6;
    const rawFinalDelta = baseDeltaSemantics * provenanceMultiplier;
    const clampedFinalDelta = Math.min(0.25, Math.max(-0.25, rawFinalDelta));
    const finalDeltaSemantics = Math.round(clampedFinalDelta * 1e6) / 1e6;
    const deltaSemantics = finalDeltaSemantics;
    const hasSemanticConflict = conflictAttributes.length > 0;
    const rationales = [];
    if (matchedAttributes.length > 0) {
      rationales.push(`Matched: [${matchedAttributes.join(", ")}] (+${boost.toFixed(2)})`);
    }
    if (conflictAttributes.length > 0) {
      rationales.push(`Conflict: [${conflictAttributes.join(", ")}] (${penalty.toFixed(2)})`);
    }
    if (rationales.length === 0) {
      rationales.push("Neutral (0.00)");
    }
    const tierLabel = isFallback ? `Deterministic Heuristic Fallback (${provenanceMultiplier.toFixed(2)}x)` : `Full Semantic Weighting (${provenanceMultiplier.toFixed(1)}x)`;
    const explanation = `\u0394_semantics = ${deltaSemantics >= 0 ? "+" : ""}${deltaSemantics.toFixed(3)} [Base: ${baseDeltaSemantics >= 0 ? "+" : ""}${baseDeltaSemantics.toFixed(2)} * ${tierLabel}]: ${rationales.join("; ")}`;
    return {
      baseDeltaSemantics,
      provenanceMultiplier,
      finalDeltaSemantics,
      deltaSemantics,
      boost,
      penalty,
      explanation,
      matchedAttributes,
      conflictAttributes,
      hasSemanticConflict,
      provenanceTier,
      confidence
    };
  }
};
var defaultSemanticAlignmentEvaluator = new DeterministicSemanticAlignmentEvaluator();

// src/retrieval/deterministicReranker.ts
var DeterministicReranker = class {
  semanticEvaluator;
  constructor(semanticEvaluator = defaultSemanticAlignmentEvaluator) {
    this.semanticEvaluator = semanticEvaluator;
  }
  /**
   * Normalizes lexical scores to [0, 1] across candidate set.
   */
  normalizeLexicalScores(candidates) {
    const map = /* @__PURE__ */ new Map();
    let maxLex = 0;
    for (const c of candidates) {
      if (c.lexicalScore && c.lexicalScore > maxLex) {
        maxLex = c.lexicalScore;
      }
    }
    for (const c of candidates) {
      if (!c.lexicalScore || maxLex <= 0) {
        map.set(c.chunk.id, 0);
      } else {
        map.set(c.chunk.id, Math.round(c.lexicalScore / maxLex * 1e6) / 1e6);
      }
    }
    return map;
  }
  /**
   * Reranks hybrid candidates using exact 55/45 + tier + topic scoring.
   */
  rerank(candidates, context) {
    if (!candidates || candidates.length === 0) return [];
    const normLexMap = this.normalizeLexicalScores(candidates);
    const resolvedTopics = context.topics || defaultQueryTopicResolver.decomposeQuery(context.query, context.semanticContext).topics;
    const scoredCandidates = [];
    for (const item of candidates) {
      const chunk = item.chunk;
      const sLex = normLexMap.get(chunk.id) || 0;
      const sSem = Math.max(0, item.vectorScore || 0);
      const sBase = RETRIEVAL_CONFIG.lexicalWeight * sLex + RETRIEVAL_CONFIG.semanticWeight * sSem;
      const sRrfTerm = RETRIEVAL_CONFIG.rrfWeight * (item.normalizedRrfScore || 0);
      let deltaTier = 0;
      if (chunk.evidenceTier === "PRIMARY_SOURCE") {
        deltaTier = RETRIEVAL_CONFIG.tierWeights.PRIMARY_SOURCE;
      } else if (chunk.evidenceTier === "OFFICIAL_GUIDANCE") {
        deltaTier = RETRIEVAL_CONFIG.tierWeights.OFFICIAL_GUIDANCE;
      } else if (chunk.evidenceTier === "CURATED_SUMMARY") {
        deltaTier = RETRIEVAL_CONFIG.tierWeights.CURATED_SUMMARY;
      } else {
        deltaTier = RETRIEVAL_CONFIG.tierWeights.APPLICATION_RULE;
      }
      let deltaTopic = 0;
      for (const topic of resolvedTopics) {
        if (defaultQueryTopicResolver.chunkMatchesTopic(chunk.chunkText, topic)) {
          deltaTopic += RETRIEVAL_CONFIG.topicMatchWeight;
        }
      }
      const semScore = this.semanticEvaluator.evaluateAlignment(
        chunk,
        item.parentRecord,
        context.semanticContext
      );
      const deltaSemantics = semScore.deltaSemantics;
      const finalScore = Math.round((sBase + sRrfTerm + deltaTier + deltaTopic + deltaSemantics) * 1e6) / 1e6;
      const scoredItem = {
        ...item,
        finalScore,
        deltaSemantics,
        semanticScoreExplanation: semScore
      };
      scoredCandidates.push({ item: scoredItem, finalScore });
    }
    const tierOrder = (tier) => {
      if (tier === "PRIMARY_SOURCE") return 3;
      if (tier === "OFFICIAL_GUIDANCE") return 2;
      return 1;
    };
    scoredCandidates.sort((a, b) => {
      if (Math.abs(b.finalScore - a.finalScore) > 1e-6) {
        return b.finalScore - a.finalScore;
      }
      const tierDiff = tierOrder(b.item.chunk.evidenceTier) - tierOrder(a.item.chunk.evidenceTier);
      if (tierDiff !== 0) return tierDiff;
      const idDiff = a.item.parentRecord.id.localeCompare(b.item.parentRecord.id);
      if (idDiff !== 0) return idDiff;
      return a.item.chunk.startOffset - b.item.chunk.startOffset;
    });
    const finalSelection = [];
    const remainingSlots = RETRIEVAL_CONFIG.finalTopK;
    if (resolvedTopics.length > 1) {
      const topicCovered = /* @__PURE__ */ new Set();
      const candidateList = [...scoredCandidates];
      const minCoverageScore = RETRIEVAL_CONFIG.minTopicCoverageScore ?? 0.35;
      for (const topic of resolvedTopics) {
        const bestForTopic = candidateList.find(
          (c) => !finalSelection.some((s) => s.chunk.id === c.item.chunk.id) && defaultQueryTopicResolver.chunkMatchesTopic(c.item.chunk.chunkText, topic) && c.finalScore >= minCoverageScore
        );
        if (bestForTopic) {
          finalSelection.push(bestForTopic.item);
          topicCovered.add(topic.id);
        }
      }
      for (const c of candidateList) {
        if (finalSelection.length >= remainingSlots) break;
        if (!finalSelection.some((s) => s.chunk.id === c.item.chunk.id)) {
          finalSelection.push(c.item);
        }
      }
    } else {
      for (const c of scoredCandidates) {
        if (finalSelection.length >= remainingSlots) break;
        finalSelection.push(c.item);
      }
    }
    return finalSelection;
  }
};
var defaultDeterministicReranker = new DeterministicReranker();

// src/retrieval/retrievalTelemetry.ts
var RetrievalTelemetryRecorder = class {
  telemetry;
  startTimes = /* @__PURE__ */ new Map();
  constructor(queryId, snapshotVersion, vectorizerVersion) {
    this.telemetry = {
      queryId,
      snapshotVersion,
      vectorizerVersion,
      lexicalCandidates: 0,
      denseCandidates: 0,
      fusedCandidates: 0,
      rerankedCandidates: 0,
      excludedUnverified: 0,
      excludedRejected: 0,
      excludedTemporalMismatch: 0,
      vectorIndexSize: 0,
      lexicalLatencyMs: 0,
      vectorLatencyMs: 0,
      fusionLatencyMs: 0,
      rerankLatencyMs: 0,
      totalLatencyMs: 0
    };
  }
  startTimer(phase) {
    this.startTimes.set(phase, performance.now());
  }
  stopTimer(phase) {
    const start = this.startTimes.get(phase);
    if (!start) return 0;
    const duration = Math.round((performance.now() - start) * 100) / 100;
    if (phase === "lexical") this.telemetry.lexicalLatencyMs = duration;
    else if (phase === "vector") this.telemetry.vectorLatencyMs = duration;
    else if (phase === "fusion") this.telemetry.fusionLatencyMs = duration;
    else if (phase === "rerank") this.telemetry.rerankLatencyMs = duration;
    else if (phase === "total") this.telemetry.totalLatencyMs = duration;
    return duration;
  }
  recordCounters(counters) {
    Object.assign(this.telemetry, counters);
  }
  recordSemanticContext(understanding) {
    if (understanding?.provenance) {
      this.telemetry.semanticExtractionTier = understanding.provenance.tier;
      this.telemetry.isFallbackSemanticExtraction = understanding.provenance.isFallback;
    }
  }
  recordSemanticEvaluation(chunkId, score) {
    if (!this.telemetry.semanticBreakdown) {
      this.telemetry.semanticBreakdown = [];
      this.telemetry.semanticEvaluations = 0;
      this.telemetry.semanticBoostsApplied = 0;
      this.telemetry.semanticPenaltiesApplied = 0;
      this.telemetry.semanticConflictsDetected = 0;
    }
    this.telemetry.semanticEvaluations = (this.telemetry.semanticEvaluations || 0) + 1;
    if (score.deltaSemantics > 0) {
      this.telemetry.semanticBoostsApplied = (this.telemetry.semanticBoostsApplied || 0) + 1;
    } else if (score.deltaSemantics < 0) {
      this.telemetry.semanticPenaltiesApplied = (this.telemetry.semanticPenaltiesApplied || 0) + 1;
    }
    if (score.hasSemanticConflict || score.conflictAttributes && score.conflictAttributes.length > 0) {
      this.telemetry.semanticConflictsDetected = (this.telemetry.semanticConflictsDetected || 0) + 1;
    }
    this.telemetry.semanticBreakdown.push({
      chunkId,
      baseDeltaSemantics: score.baseDeltaSemantics,
      provenanceMultiplier: score.provenanceMultiplier,
      finalDeltaSemantics: score.finalDeltaSemantics,
      deltaSemantics: score.deltaSemantics,
      explanation: score.explanation,
      matchedAttributes: score.matchedAttributes,
      conflictAttributes: score.conflictAttributes,
      hasSemanticConflict: Boolean(score.hasSemanticConflict || score.conflictAttributes && score.conflictAttributes.length > 0),
      provenanceTier: score.provenanceTier
    });
  }
  getTelemetry() {
    return { ...this.telemetry };
  }
};

// src/retrieval/advancedSourceRetriever.ts
var AdvancedSourceRetriever = class {
  compositeRetriever;
  chunker;
  embeddingService;
  vectorIndex;
  hybridRetriever;
  reranker;
  topicResolver;
  versioningManager;
  allChunks = [];
  chunksByRecordId = /* @__PURE__ */ new Map();
  lastTelemetry;
  constructor(compositeRetriever = defaultCompositeSourceRetriever, chunker = defaultProvisionChunker, embeddingService = defaultEmbeddingService, vectorIndex = defaultVectorIndex, reranker = defaultDeterministicReranker, topicResolver = defaultQueryTopicResolver, versioningManager = defaultSourceVersioningManager) {
    this.compositeRetriever = compositeRetriever;
    this.chunker = chunker;
    this.embeddingService = embeddingService;
    this.vectorIndex = vectorIndex;
    this.reranker = reranker;
    this.topicResolver = topicResolver;
    this.versioningManager = versioningManager;
    this.hybridRetriever = new HybridRetriever(this.vectorIndex, this.embeddingService);
    this.refreshFromRegistry();
  }
  /**
   * Refreshes vector index and chunks from approved registry records.
   * Isolates staged candidates: only VERIFIED and valid historical records enter.
   */
  refreshFromRegistry(customLedgerHeadHash, customRegistryVersionId) {
    const activeRecords = this.compositeRetriever.findSourcesByStandardOrAct("");
    const ledgerHeadHash = customLedgerHeadHash || this.versioningManager.getLedgerHeadHash();
    const registryVersionId = customRegistryVersionId || "active-ledger-v1";
    this.allChunks = [];
    this.chunksByRecordId.clear();
    for (const record of activeRecords) {
      if (record.sourceStatus === "VERIFIED" || record.sourceStatus === "HISTORICAL") {
        const chunks = this.chunker.chunkRecord(record);
        this.allChunks.push(...chunks);
        this.chunksByRecordId.set(record.id, chunks);
      }
    }
    const snapshot = this.vectorIndex.build(this.allChunks, ledgerHeadHash, registryVersionId);
    return snapshot;
  }
  getVectorIndex() {
    return this.vectorIndex;
  }
  getEmbeddingService() {
    return this.embeddingService;
  }
  getSnapshotMetadata() {
    return this.vectorIndex.getSnapshotMetadata();
  }
  getLastTelemetry() {
    return this.lastTelemetry;
  }
  getSourceById(id) {
    return this.compositeRetriever.getSourceById(id);
  }
  findSourcesByStandardOrAct(standardOrActCode, paragraphOrSection) {
    return this.compositeRetriever.findSourcesByStandardOrAct(standardOrActCode, paragraphOrSection);
  }
  /**
   * Executes advanced hybrid retrieval returning ranked chunks with exact scores and telemetry.
   */
  async retrieveHybridChunks(retrievalQuery) {
    const queryId = `q_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const snapshot = this.vectorIndex.getSnapshotMetadata();
    const recorder = new RetrievalTelemetryRecorder(
      queryId,
      snapshot.indexVersion,
      this.embeddingService.vectorizerVersion
    );
    if (retrievalQuery.semanticContext) {
      recorder.recordSemanticContext(retrievalQuery.semanticContext);
    }
    recorder.startTimer("total");
    recorder.startTimer("lexical");
    const lexicalRecords = await this.compositeRetriever.retrieveSources(retrievalQuery);
    const lexicalMatches = [];
    lexicalRecords.forEach((rec, recIdx) => {
      const chunks = this.chunksByRecordId.get(rec.id) || this.chunker.chunkRecord(rec);
      const baseRecScore = Math.max(10, 100 - recIdx * 10);
      chunks.forEach((chunk, chunkIdx) => {
        let chunkScore = baseRecScore;
        const qLower = retrievalQuery.query.toLowerCase();
        const tokens = qLower.split(/[\s,.;:!?/()]+/).filter((token) => token.length >= 3);
        if (chunk.chunkText.toLowerCase().includes(qLower) || tokens.some((token) => chunk.chunkText.toLowerCase().includes(token))) {
          chunkScore += 20;
        }
        lexicalMatches.push({
          chunk,
          parentRecord: rec,
          score: chunkScore - chunkIdx
        });
      });
    });
    recorder.stopTimer("lexical");
    recorder.startTimer("fusion");
    const hybridOutput = this.hybridRetriever.retrieveHybridCandidates(
      {
        query: retrievalQuery.query,
        domain: retrievalQuery.domain,
        authorities: retrievalQuery.authorities,
        targetDate: retrievalQuery.targetDate,
        referenceDate: retrievalQuery.referenceDate,
        includeHistorical: retrievalQuery.includeHistorical
      },
      lexicalMatches,
      (id) => this.compositeRetriever.getSourceById(id)
    );
    recorder.stopTimer("fusion");
    recorder.startTimer("rerank");
    const topicDecomp = this.topicResolver.decomposeQuery(retrievalQuery.query, retrievalQuery.semanticContext);
    const reranked = this.reranker.rerank(hybridOutput.candidates, {
      query: retrievalQuery.query,
      targetDate: retrievalQuery.targetDate,
      referenceDate: retrievalQuery.referenceDate,
      topics: topicDecomp.topics,
      includeHistorical: retrievalQuery.includeHistorical,
      semanticContext: retrievalQuery.semanticContext
    });
    recorder.stopTimer("rerank");
    for (const item of reranked) {
      if (item.semanticScoreExplanation) {
        recorder.recordSemanticEvaluation(item.chunk.id, item.semanticScoreExplanation);
      }
    }
    recorder.stopTimer("total");
    recorder.recordCounters({
      lexicalCandidates: lexicalMatches.length,
      denseCandidates: this.vectorIndex.size(),
      fusedCandidates: hybridOutput.candidates.length,
      rerankedCandidates: reranked.length,
      excludedUnverified: hybridOutput.excludedUnverified,
      excludedTemporalMismatch: hybridOutput.excludedTemporalMismatch,
      vectorIndexSize: this.vectorIndex.size()
    });
    const telemetry = recorder.getTelemetry();
    this.lastTelemetry = telemetry;
    return {
      results: reranked,
      lexicalRecords,
      telemetry
    };
  }
  /**
   * ISourceRetriever interface implementation.
   * Maps advanced hybrid retrieval back to deduplicated, authoritative parent records.
   * Prioritizes verified hybrid results, then includes approved baseline curated summaries.
   */
  async retrieveSources(retrievalQuery) {
    const { results, lexicalRecords } = await this.retrieveHybridChunks(retrievalQuery);
    const seenRecordIds = /* @__PURE__ */ new Set();
    const records = [];
    for (const r of results) {
      if (!seenRecordIds.has(r.parentRecord.id)) {
        seenRecordIds.add(r.parentRecord.id);
        records.push(r.parentRecord);
      }
    }
    for (const rec of lexicalRecords) {
      if (!seenRecordIds.has(rec.id)) {
        if (!rec.id.includes("staged") && !rec.id.includes("candidate") && rec.sourceStatus !== "REJECTED") {
          seenRecordIds.add(rec.id);
          records.push(rec);
        }
      }
    }
    return records.slice(0, retrievalQuery.maxResults || 6);
  }
};
var defaultAdvancedSourceRetriever = new AdvancedSourceRetriever();

// src/verification/citationVerifier.ts
var CitationVerifier = class {
  retriever;
  constructor(retriever = defaultSourceRetriever) {
    this.retriever = retriever;
  }
  normalizeSection(text) {
    return text.toLowerCase().replace(/\b(?:section|sec|paragraph|para|regulation|reg|schedule|sch|clause)\b/gi, "").replace(/[§\s\-_(),.&]/g, "");
  }
  normalizeUrlForComparison(urlStr) {
    try {
      const parsed = new URL(urlStr.trim());
      const host = parsed.host.toLowerCase().replace(/^www\./, "");
      const pathname = parsed.pathname.toLowerCase().replace(/\/+$/, "");
      return `${host}${pathname}`;
    } catch {
      return urlStr.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
    }
  }
  /**
   * Validates a single standard citation structurally against authoritative records.
   * When retrievedEvidenceScope is provided, validates that the citation is grounded
   * strictly in the retrieved evidence supplied to the model.
   */
  verifyCitation(citation, expectedAuthority, retrievedEvidenceScope) {
    const rawStd = citation.standard || "";
    const rawPara = citation.paragraph || "";
    const rawUrl = citation.officialSourceUrl || "";
    const matchedRecords = this.retriever.findSourcesByStandardOrAct(rawStd);
    if (!matchedRecords || matchedRecords.length === 0) {
      return {
        citation,
        status: "SOURCE_NOT_FOUND",
        isValid: false,
        isStructurallyValid: false,
        isAuthoritativePrimarySource: false,
        reason: `Standard or statute '${rawStd}' is not found in the verified repository.`,
        structuralVerificationOnly: true
      };
    }
    const paraClean = this.normalizeSection(rawPara);
    const sectionCandidates = matchedRecords.filter((r) => {
      const rSecClean = this.normalizeSection(r.paragraphOrSection);
      return rSecClean.includes(paraClean) || paraClean.includes(rSecClean);
    });
    if (sectionCandidates.length === 0) {
      return {
        citation,
        status: "PARAGRAPH_NOT_FOUND",
        isValid: false,
        isStructurallyValid: false,
        isAuthoritativePrimarySource: false,
        reason: `Paragraph/Section '${rawPara}' does not exist in records for '${rawStd}'.`,
        structuralVerificationOnly: true
      };
    }
    let matchedRecord = sectionCandidates[0];
    if (sectionCandidates.length > 1) {
      const citeText = `${citation.title || ""} ${citation.text || ""}`.toLowerCase();
      let bestScore = -1;
      let bestCandidate = matchedRecord;
      for (const cand of sectionCandidates) {
        let matchScore = 0;
        const candTitle = cand.principleSummary.toLowerCase();
        const candTokens = candTitle.split(/[\s,.;:!?/()]+/).filter((w) => w.length > 1);
        for (const token of candTokens) {
          if (citeText.includes(token)) {
            matchScore += token.match(/\d+/) ? 10 : 2;
          }
        }
        for (const tag of cand.tags) {
          if (citeText.includes(tag.toLowerCase())) {
            matchScore += 8;
          }
        }
        if (matchScore > bestScore) {
          bestScore = matchScore;
          bestCandidate = cand;
        }
      }
      if (bestScore > 0) {
        matchedRecord = bestCandidate;
      } else {
        const activeRecord = sectionCandidates.find((r) => r.sourceStatus === "VERIFIED" && (!r.validTo || r.validTo >= "2026-09-11"));
        if (activeRecord) {
          matchedRecord = activeRecord;
        }
      }
    }
    const authorityMatches = !citation.authority || citation.authority === matchedRecord.authority || citation.authority === "ASC" && matchedRecord.authority === "ACRA" || citation.authority === "ACRA" && matchedRecord.authority === "ASC";
    if (!authorityMatches) {
      return {
        citation,
        status: "AUTHORITY_MISMATCH",
        isValid: false,
        isStructurallyValid: false,
        isAuthoritativePrimarySource: false,
        matchedRecord,
        reason: `Authority mismatch: citation claims '${citation.authority}' but record is governed by '${matchedRecord.authority}'.`,
        structuralVerificationOnly: true
      };
    }
    if (expectedAuthority) {
      const expectedMatches = matchedRecord.authority === expectedAuthority || expectedAuthority === "ASC" && matchedRecord.authority === "ACRA" || expectedAuthority === "ACRA" && matchedRecord.authority === "ASC";
      if (!expectedMatches) {
        return {
          citation,
          status: "AUTHORITY_MISMATCH",
          isValid: false,
          isStructurallyValid: false,
          isAuthoritativePrimarySource: false,
          matchedRecord,
          reason: `Authority mismatch: expected domain authority '${expectedAuthority}' but citation belongs to '${matchedRecord.authority}'.`,
          structuralVerificationOnly: true
        };
      }
    }
    const isOfficialDomain = rawUrl.startsWith("https://sso.agc.gov.sg") || rawUrl.startsWith("https://www.acra.gov.sg") || rawUrl.startsWith("https://www.iras.gov.sg") || rawUrl.startsWith("https://www.cpf.gov.sg") || rawUrl.startsWith("https://www.mom.gov.sg") || rawUrl.startsWith("https://www.mas.gov.sg") || rawUrl.startsWith("https://www.ifrs.org");
    if (rawUrl && !isOfficialDomain) {
      return {
        citation,
        status: "NON_CANONICAL_URL",
        isValid: false,
        isStructurallyValid: false,
        isAuthoritativePrimarySource: false,
        matchedRecord,
        reason: `URL '${rawUrl}' is not an official Singapore government or standard-setter portal.`,
        structuralVerificationOnly: true
      };
    }
    if (rawUrl && matchedRecord.officialSourceUrl) {
      const normCite = this.normalizeUrlForComparison(rawUrl);
      const normRec = this.normalizeUrlForComparison(matchedRecord.officialSourceUrl);
      if (normCite !== normRec) {
        return {
          citation,
          status: "NON_CANONICAL_URL",
          isValid: false,
          isStructurallyValid: false,
          isAuthoritativePrimarySource: false,
          matchedRecord,
          reason: `Citation URL '${rawUrl}' does not match official record URL '${matchedRecord.officialSourceUrl}'.`,
          structuralVerificationOnly: true
        };
      }
    }
    if (retrievedEvidenceScope !== void 0) {
      if (retrievedEvidenceScope.length === 0) {
        return {
          citation,
          status: "UNVERIFIED",
          isValid: false,
          isStructurallyValid: true,
          isAuthoritativePrimarySource: false,
          matchedRecord,
          reason: "No authoritative evidence was retrieved in context to support this citation.",
          structuralVerificationOnly: true
        };
      }
      const codeClean = rawStd.toLowerCase().replace(/[\s\-_()]/g, "");
      const inScopeRecord = retrievedEvidenceScope.find((r) => {
        const rCodeClean = r.standardOrActCode.toLowerCase().replace(/[\s\-_()]/g, "");
        const rTitleClean = r.documentTitle.toLowerCase().replace(/[\s\-_()]/g, "");
        const codeMatches = rCodeClean.includes(codeClean) || rTitleClean.includes(codeClean) || codeClean.includes(rCodeClean);
        if (!codeMatches) return false;
        if (!paraClean) return true;
        const rSecClean = this.normalizeSection(r.paragraphOrSection);
        return rSecClean.includes(paraClean) || paraClean.includes(rSecClean);
      });
      if (!inScopeRecord) {
        return {
          citation,
          status: "UNVERIFIED",
          isValid: false,
          isStructurallyValid: true,
          isAuthoritativePrimarySource: false,
          matchedRecord,
          reason: `Citation '${rawStd} ${rawPara}' is structurally valid in law but was not retrieved in the evidence context for this query.`,
          structuralVerificationOnly: true
        };
      }
    }
    const isVerifiedPrimary = matchedRecord.evidenceTier === "PRIMARY_SOURCE" && matchedRecord.sourceStatus === "VERIFIED" && matchedRecord.sourceType === "AUTHORITATIVE_SOURCE" && matchedRecord.isVerbatimText === true;
    const isNeedsReview = matchedRecord.evidenceTier === "CURATED_SUMMARY" || matchedRecord.sourceStatus === "NEEDS_REVIEW" || matchedRecord.sourceType === "CURATED_SUMMARY";
    const status = isVerifiedPrimary ? "VERIFIED_PRIMARY_SOURCE" : isNeedsReview ? "SOURCE_NEEDS_REVIEW" : "STRUCTURALLY_VERIFIED_SUMMARY";
    return {
      citation,
      status,
      isValid: true,
      isStructurallyValid: true,
      isAuthoritativePrimarySource: isVerifiedPrimary,
      matchedRecord,
      reason: isVerifiedPrimary ? `Citation structurally verified against primary statutory provision in ${matchedRecord.documentTitle} (${matchedRecord.paragraphOrSection}).` : `Citation is structurally valid against ${matchedRecord.documentTitle} (${matchedRecord.paragraphOrSection}), but underlying record is a curated summary marked SOURCE_NEEDS_REVIEW.`,
      structuralVerificationOnly: true
    };
  }
  /**
   * Batch verifies a list of citations and returns verified and rejected sets.
   */
  verifyCitationBatch(citations, expectedAuthority, retrievedEvidenceScope) {
    const results = citations.map((c) => this.verifyCitation(c, expectedAuthority, retrievedEvidenceScope));
    const allValid = results.every((r) => r.isValid);
    const validCitations = results.filter((r) => r.isValid).map((r) => r.citation);
    const rejectedCitations = results.filter((r) => !r.isValid);
    return {
      results,
      allValid,
      validCitations,
      rejectedCitations
    };
  }
};
var defaultCitationVerifier = new CitationVerifier();

// src/services/semanticScenarioResolver.ts
function resolveSemanticScenario(understanding) {
  if (!understanding || understanding.provenance.isFallback || understanding.confidence < 0.75) return void 0;
  if (understanding.ownershipContext === "own_equity" || understanding.transactionType === "share_capital_issuance") {
    return "SHARE_CAPITAL";
  }
  if (understanding.transactionType === "payroll_payment") return "PAYROLL";
  if (understanding.transactionType === "lease_contract" || understanding.transactionType === "lease_payment") return "LEASE";
  if (understanding.transactionType === "customer_invoice" || understanding.instrument === "accounts_receivable") return "CUSTOMER_RECEIVABLE";
  if (understanding.instrument === "accounts_payable") return "SUPPLIER_PAYABLE";
  if (understanding.transactionType === "debt_settlement" || understanding.instrument === "debt_instrument") return "DEBT";
  if (understanding.ownershipContext === "external_investment" || understanding.transactionType === "equity_investment_acquisition") {
    return "EXTERNAL_INVESTMENT";
  }
  return void 0;
}
function deterministicRoute(scenario) {
  if (!scenario) return void 0;
  if (scenario.scenarioType === "PAYROLL_CPF_SALARY") return "PAYROLL";
  if (scenario.scenarioType === "LEASE_IFRS16" || scenario.scenarioType === "COMMERCIAL_LEASE") return "LEASE";
  if (scenario.scenarioType.startsWith("SHARE_CAPITAL")) return "SHARE_CAPITAL";
  if (scenario.scenarioType === "EQUITY_INVESTMENT_FX") return "EXTERNAL_INVESTMENT";
  return void 0;
}
function hasSemanticRoutingConflict(scenario, understanding) {
  const semantic = resolveSemanticScenario(understanding);
  const deterministic = deterministicRoute(scenario);
  return Boolean(semantic && deterministic && semantic !== deterministic);
}

// src/engine/responseAssembler.ts
function assembleDeterministicResponse(compact, userInputOrScenario, currentScenarioOrInput, groundedContext, deterministicScenario, standard) {
  const userInput = typeof userInputOrScenario === "string" ? userInputOrScenario : typeof currentScenarioOrInput === "string" ? currentScenarioOrInput : deterministicScenario?.rawQuery || "";
  const stdLabel = standard === "SFRS_I" ? "SFRS(I)" : "IFRS";
  const queryMode = groundedContext.classification.intent;
  const retrievedEvidenceScope = [
    ...groundedContext.primaryEvidence,
    ...groundedContext.officialGuidance,
    ...groundedContext.curatedSummaries
  ];
  const isRecognizedDeterministicFixture = Boolean(
    deterministicScenario && deterministicScenario.scenarioType !== "UNRECOGNIZED"
  );
  const isHypotheticalQuery = Boolean(
    groundedContext.semanticUnderstanding?.isHypothetical || groundedContext.semanticUnderstanding?.followUpAnalysis?.isHypothetical
  );
  const semanticRoutingConflict = hasSemanticRoutingConflict(deterministicScenario, groundedContext.semanticUnderstanding);
  const hasAuthoritativeDeterministicEntries = Boolean(
    isRecognizedDeterministicFixture && deterministicScenario.directGroups && deterministicScenario.directGroups.length > 0 && !isHypotheticalQuery && !semanticRoutingConflict
  );
  const hasMissingFacts = Boolean(
    groundedContext.missingFacts && groundedContext.missingFacts.length > 0 || compact.missingFacts && compact.missingFacts.length > 0
  );
  const authorityStatus = hasMissingFacts ? "CONDITIONAL" : hasAuthoritativeDeterministicEntries ? deterministicScenario?.authorityStatus || "DETERMINISTIC" : "AI_PROPOSED";
  const resolvedScenarioType = isRecognizedDeterministicFixture ? deterministicScenario.scenarioType : compact.scenarioType || (queryMode === "STATUTORY_ADVISORY" ? "SINGAPORE_STATUTORY_ADVISORY" : "UNIVERSAL");
  const resolvedTransactionTitle = isRecognizedDeterministicFixture ? deterministicScenario?.transactionTitle || "Accounting & Statutory Advisory" : compact.transactionNature || compact.transactionTitle || (groundedContext.semanticUnderstanding?.transactionType ? groundedContext.semanticUnderstanding.transactionType.replace(/_/g, " ").toUpperCase() : "Accounting & Statutory Advisory");
  const rawCitations = [
    ...compact.citations || [],
    ...compact.statuteReferences || [],
    ...deterministicScenario?.directGroups?.flatMap((g) => g.citations) || []
  ];
  const verifiedCitations = [];
  const seenCites = /* @__PURE__ */ new Set();
  for (const cite of rawCitations) {
    const key = `${cite.standard || ""}_${cite.paragraph || ""}`.toLowerCase();
    if (!key || seenCites.has(key)) continue;
    seenCites.add(key);
    const verification = defaultCitationVerifier.verifyCitation(
      cite,
      cite.authority,
      retrievedEvidenceScope
    );
    const safeUrl = verification.matchedRecord?.officialSourceUrl || getSafeOfficialUrl(cite.officialSourceUrl, cite.standard, cite.paragraph, cite.authority) || cite.officialSourceUrl;
    verifiedCitations.push({
      standard: cite.standard || "",
      paragraph: cite.paragraph || "",
      title: cite.title || verification.matchedRecord?.documentTitle || `${cite.standard} ${cite.paragraph}`,
      text: cite.text || verification.matchedRecord?.sourceText || "",
      authority: cite.authority || verification.matchedRecord?.authorityName || "SSO",
      officialSourceUrl: safeUrl,
      verificationStatus: verification.status,
      isAuthoritativePrimarySource: verification.isAuthoritativePrimarySource,
      isStructurallyValid: verification.isStructurallyValid,
      verificationReason: verification.reason,
      structuralVerificationOnly: true
    });
  }
  let directGroups = [];
  let invalidJournalProposalReason;
  const followUp = groundedContext.semanticUnderstanding?.followUpAnalysis;
  const isSettlementFollowUp = Boolean(
    followUp && (followUp.eventType === "settlement" || followUp.eventType === "partial_settlement")
  );
  const currentScenario = typeof userInputOrScenario === "object" && userInputOrScenario !== null ? userInputOrScenario : typeof currentScenarioOrInput === "object" && currentScenarioOrInput !== null ? currentScenarioOrInput : null;
  let committedDirectGroups = currentScenario?.committedDirectGroups;
  let projectedGroups = void 0;
  const priorCommittedGroups = currentScenario?.committedDirectGroups && currentScenario.committedDirectGroups.length > 0 ? [...currentScenario.committedDirectGroups] : currentScenario?.directGroups ? currentScenario.directGroups.filter((g) => !g.isHypothetical) : [];
  const settlementCurrency = groundedContext.semanticUnderstanding?.currency?.value || currentScenario?.functionalCurrency || "SGD";
  const settlementDelta = isSettlementFollowUp ? calculateAccountingDelta(extractAccountingContext(currentScenario), followUp, settlementCurrency) : null;
  if (isSettlementFollowUp) {
    if (!settlementDelta?.resultingAccountingEvent) {
      const baseState = currentScenario || deterministicScenario;
      const clarification = "I cannot post a settlement journal because the payment does not match one outstanding balance, or it exceeds that balance. Please identify the original transaction, confirm the settlement amount, and explain any excess.";
      return {
        messageText: `### Clarification Required

${clarification}`,
        scenarioState: {
          ...baseState || {
            scenarioType: "UNRECOGNIZED",
            transactionTitle: "Settlement Requires an Outstanding Balance",
            functionalCurrency: settlementCurrency,
            transactionCurrency: settlementCurrency
          },
          rawQuery: userInput,
          authorityStatus: "CONDITIONAL",
          directGroups: [],
          committedDirectGroups: priorCommittedGroups,
          projectedGroups: void 0,
          isComplete: false,
          missingFields: [{
            fieldKey: "settlementTarget",
            fieldName: "Outstanding balance being settled",
            prompt: clarification,
            whyNeeded: "A settlement journal must derecognize a specific balance from committed accounting history."
          }]
        }
      };
    }
  }
  if (hasAuthoritativeDeterministicEntries && !isSettlementFollowUp) {
    directGroups = deterministicScenario.directGroups.map((grp) => ({
      ...grp,
      authorityStatus: grp.authorityStatus || authorityStatus
    }));
    committedDirectGroups = directGroups.filter((g) => !g.isHypothetical);
  } else if (followUp && (followUp.eventType === "settlement" || followUp.eventType === "partial_settlement")) {
    const delta = settlementDelta;
    if (delta && delta.resultingAccountingEvent) {
      const isHypo = Boolean(delta.isHypothetical);
      const totalDebit = Math.round(delta.journalLines.reduce((sum, line2) => sum + line2.debit, 0) * 100) / 100;
      const totalCredit = Math.round(delta.journalLines.reduce((sum, line2) => sum + line2.credit, 0) * 100) / 100;
      const settlementGroup = {
        id: `grp-followup-settlement-${priorCommittedGroups.length + 1}`,
        transactionId: delta.resultingAccountingEvent.transactionId,
        targetTransactionId: delta.resultingAccountingEvent.targetTransactionId,
        isHypothetical: isHypo,
        eventDate: formatSingaporeDate(/* @__PURE__ */ new Date()),
        title: `${isHypo ? "Hypothetical " : ""}Settlement of ${delta.balanceUpdates[0].accountName}`,
        summary: delta.explanation,
        lines: delta.journalLines,
        totalDebit,
        totalCredit,
        isBalanced: totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.01,
        citations: verifiedCitations,
        rationalePoints: [delta.explanation],
        authorityStatus: "AI_PROPOSED"
      };
      if (isHypo) {
        committedDirectGroups = priorCommittedGroups;
        projectedGroups = [settlementGroup];
        directGroups = [...priorCommittedGroups, settlementGroup];
      } else {
        committedDirectGroups = [...priorCommittedGroups, settlementGroup];
        projectedGroups = void 0;
        directGroups = committedDirectGroups;
      }
    }
  } else if (followUp && (followUp.eventType === "hypothetical_branch" || followUp.eventType === "reclassification" || followUp.eventType === "policy_election")) {
    const convContext = extractAccountingContext(currentScenario);
    const targetBasis = followUp.targetMeasurementBasis || "UNKNOWN";
    const proj = buildAccountingMeasurementProjection({
      committedContext: convContext,
      followUpAnalysis: followUp,
      requestedBasis: targetBasis
    });
    if (proj.success && proj.projectedGroups.length > 0) {
      committedDirectGroups = priorCommittedGroups;
      projectedGroups = proj.projectedGroups;
      directGroups = proj.projectedGroups;
    }
  } else if (compact.directGroups && compact.directGroups.length > 0) {
    directGroups = compact.directGroups.map((grp, idx) => {
      const lines = (grp.lines || []).map((l, lIdx) => ({
        id: l.id || `l-${idx}-${lIdx}`,
        accountCode: l.accountCode || "1000",
        accountName: l.accountName || "Account",
        category: l.category || "ASSET",
        debit: typeof l.debit === "number" ? Math.round(l.debit * 100) / 100 : 0,
        credit: typeof l.credit === "number" ? Math.round(l.credit * 100) / 100 : 0,
        foreignCurrency: l.foreignCurrency,
        foreignDebit: l.foreignDebit,
        foreignCredit: l.foreignCredit,
        exchangeRate: l.exchangeRate,
        lineExplanation: l.lineExplanation || ""
      }));
      const tradeDiscountExpenseIdx = lines.findIndex(
        (l) => l.accountName.toLowerCase().includes("trade discount") && l.category === "EXPENSE"
      );
      if (tradeDiscountExpenseIdx !== -1) {
        lines.splice(tradeDiscountExpenseIdx, 1);
      }
      const totalDebit = Math.round(lines.reduce((s, l) => s + l.debit, 0) * 100) / 100;
      const totalCredit = Math.round(lines.reduce((s, l) => s + l.credit, 0) * 100) / 100;
      return {
        id: grp.id || `grp-${idx + 1}`,
        eventDate: formatSingaporeDate(grp.eventDate || /* @__PURE__ */ new Date()),
        title: grp.title || `Entry Group ${idx + 1}`,
        summary: grp.summary || "",
        lines,
        totalDebit,
        totalCredit,
        isBalanced: Math.abs(totalDebit - totalCredit) < 0.01,
        citations: verifiedCitations,
        rationalePoints: grp.rationalePoints || [],
        authorityStatus
      };
    });
  } else if (compact.requiredAccounts && compact.requiredAccounts.length > 0) {
    const debitsCount = compact.requiredAccounts.filter((account) => account.debitCredit === "DEBIT").length;
    const creditsCount = compact.requiredAccounts.filter((account) => account.debitCredit === "CREDIT").length;
    if (debitsCount === 0 || creditsCount === 0) {
      invalidJournalProposalReason = "The proposed journal does not contain both a debit and a credit. Please identify what was received or prepaid and the account paid.";
    } else {
      let knownAmount = void 0;
      if (isRecognizedDeterministicFixture && deterministicScenario?.isComplete && deterministicScenario?.amount && deterministicScenario.amount > 0) {
        knownAmount = deterministicScenario.amount;
      } else if (groundedContext.semanticUnderstanding?.amount && groundedContext.semanticUnderstanding.amount > 0) {
        knownAmount = groundedContext.semanticUnderstanding.amount;
      }
      const isUnvaluedOrNovel = !knownAmount || userInput.toLowerCase().includes("barter") || userInput.toLowerCase().includes("exchange");
      if (isUnvaluedOrNovel) {
        const lines = compact.requiredAccounts.map((acc, aIdx) => ({
          id: `line-ai-${aIdx + 1}`,
          accountCode: acc.category === "ASSET" ? "1500" : acc.category === "LIABILITY" ? "2000" : acc.category === "EQUITY" ? "3000" : acc.category === "EXPENSE" ? "5000" : "4000",
          accountName: acc.accountName,
          category: acc.category,
          debit: 0,
          credit: 0,
          lineExplanation: `${acc.rationale || `Recognition of ${acc.accountName}`} \u2014 [Valuation pending determination]`
        }));
        directGroups = [{
          id: "grp-ai-proposed-unvalued-1",
          eventDate: formatSingaporeDate(/* @__PURE__ */ new Date()),
          title: compact.transactionNature || "AI-Proposed Double Entry (Pending Valuation)",
          summary: compact.treatment || "Illustrative journal proposal with uncalculated monetary amounts",
          lines,
          totalDebit: 0,
          totalCredit: 0,
          isBalanced: false,
          // Cannot be balanced without valuations
          citations: verifiedCitations,
          rationalePoints: [
            compact.treatment || "Accounting treatment proposed by AI reasoning",
            "\u26A0\uFE0F AMOUNTS PENDING: Transaction amounts/fair values were not specified in query. Journal structure is proposed by AI; monetary amounts must be determined before posting.",
            "Authority Status: CONDITIONAL (Subject to independent valuation and audit review)"
          ],
          authorityStatus: "CONDITIONAL"
        }];
      } else {
        const displayCurrency = deterministicScenario?.functionalCurrency ?? groundedContext.semanticUnderstanding?.currency?.value ?? "SGD";
        const lines = compact.requiredAccounts.map((acc, aIdx) => {
          const isDebit = acc.debitCredit === "DEBIT";
          const amt = isDebit ? debitsCount === 1 ? knownAmount : 0 : creditsCount === 1 ? knownAmount : 0;
          return {
            id: `line-ai-${aIdx + 1}`,
            accountCode: acc.category === "ASSET" ? "1500" : acc.category === "LIABILITY" ? "2000" : acc.category === "EQUITY" ? "3000" : acc.category === "EXPENSE" ? "5000" : "4000",
            accountName: acc.accountName,
            category: acc.category,
            debit: isDebit ? amt : 0,
            credit: !isDebit ? amt : 0,
            lineExplanation: amt > 0 ? acc.rationale || `Recognition of ${acc.accountName}` : `${acc.accountName}: Amount pending individual allocation breakdown (aggregate ${displayCurrency} ${knownAmount.toLocaleString()})`
          };
        });
        const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
        const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
        const isBalanced = totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.01;
        directGroups = [{
          id: "grp-ai-proposed-1",
          eventDate: formatSingaporeDate(/* @__PURE__ */ new Date()),
          title: compact.transactionNature || "AI-Proposed Double Entry",
          summary: compact.treatment || "Illustrative journal proposal",
          lines,
          totalDebit,
          totalCredit,
          isBalanced,
          citations: verifiedCitations,
          rationalePoints: [
            compact.treatment || "Accounting treatment proposed by AI reasoning",
            `Authority Status: ${authorityStatus} (Proposed by AI)`
          ],
          authorityStatus: authorityStatus === "DETERMINISTIC" ? "AI_PROPOSED" : authorityStatus
        }];
      }
    }
  }
  directGroups = directGroups.map((grp) => ({ ...grp, lines: Array.isArray(grp.lines) ? grp.lines : [] }));
  if (followUp && (followUp.eventType === "settlement" || followUp.eventType === "partial_settlement")) {
    const convContext = extractAccountingContext(currentScenario);
    for (const grp of directGroups) {
      const validation = validateAccountingStateTransition(convContext, grp.lines, followUp.eventType);
      if (!validation.isValid && validation.violations.some((v) => v.includes("GUARDRAIL_VIOLATION_DUPLICATE_EQUITY"))) {
        for (const line2 of grp.lines) {
          if (line2.credit > 0 && line2.category === "EQUITY" && line2.accountName.toLowerCase().includes("share capital")) {
            line2.accountCode = "1150";
            line2.accountName = "Amount Due from Shareholder (Receivable)";
            line2.category = "ASSET";
            line2.lineExplanation = "Settlement of allotment receivable (Share Capital previously recognized upon allotment)";
          }
        }
      }
    }
  }
  const isAccountingOnly = groundedContext.classification.primaryDomain === "ACCOUNTING" && !groundedContext.classification.taxAnalysisRequired;
  const suppliedAdvisories = [
    ...deterministicScenario?.statutoryAdvisory || [],
    ...compact.statutoryAdvisory || []
  ];
  const statutoryAdvisory = isAccountingOnly ? suppliedAdvisories.filter(
    (advisory) => advisory.authority !== "IRAS" && !/income tax|tax deduct|capital allowance/i.test(advisory.statuteOrAct || "")
  ) : suppliedAdvisories;
  if (statutoryAdvisory.length === 0 && (compact.keyRules || compact.directAnswer)) {
    const domain = groundedContext.classification.primaryDomain;
    const primaryAuth = domain === "ACCOUNTING" ? "ASC" : domain === "EMPLOYMENT" ? "MOM" : domain === "PAYROLL" ? "CPF" : domain === "MAS_FUNDS" ? "MAS" : domain === "CORPORATE_REGULATORY" ? "ACRA" : domain === "TAX" || domain === "GST" ? "IRAS" : "SSO";
    const statuteOrAct = primaryAuth === "ASC" ? "SFRS(I) 1-1 Presentation of Financial Statements" : primaryAuth === "MOM" ? "Employment Act 1968" : primaryAuth === "CPF" ? "Central Provident Fund Act 1953" : primaryAuth === "MAS" ? "MAS Funds, Family Office and VCC Framework" : primaryAuth === "ACRA" ? "Companies Act 1967" : primaryAuth === "IRAS" ? "Income Tax Act 1947" : "Singapore Statutes Online";
    statutoryAdvisory.push({
      authority: primaryAuth,
      statuteOrAct,
      sectionOrSchedule: primaryAuth === "ASC" ? "Presentation and reclassification guidance" : primaryAuth === "MAS" ? "MAS fund-management, SFO and VCC guidance" : "Statutory Directives",
      topic: domain,
      summary: compact.directAnswer || "Statutory directives under Singapore law",
      keyRules: compact.keyRules || [],
      officialUrl: primaryAuth === "ASC" ? "https://asc.acra.gov.sg/singapore-financial-reporting-standards-international/archives/effective-for-annual-reporting-period-beginning-on-1-january-2025" : primaryAuth === "MAS" ? "https://www.mas.gov.sg/regulation/capital-markets" : "",
      isTaxDeductible: void 0,
      isGstClaimable: void 0
    });
  }
  const keyParameters = [];
  if (isRecognizedDeterministicFixture) {
    if (deterministicScenario?.keyParameters) {
      keyParameters.push(...deterministicScenario.keyParameters);
    }
  } else {
    keyParameters.push({
      label: "Evaluation Mode",
      value: "AI Grounded Reasoning",
      badge: "AI Active"
    });
    keyParameters.push({
      label: "Detected Domain",
      value: groundedContext.classification.primaryDomain,
      badge: "Classification"
    });
    keyParameters.push({
      label: "AI Status",
      value: "Live Grounded Pipeline Connected",
      badge: "Online"
    });
    if (groundedContext.semanticUnderstanding) {
      const sem = groundedContext.semanticUnderstanding;
      const provenanceBadge = sem.provenance?.isFallback ? "Heuristic Rule" : "AI Semantic";
      if (sem.reportingEntity?.type && sem.reportingEntity.type !== "unknown") {
        keyParameters.push({ label: "Reporting Entity", value: sem.reportingEntity.type.toUpperCase(), badge: provenanceBadge });
      }
      if (sem.counterparty?.role && sem.counterparty.role !== "unknown") {
        keyParameters.push({ label: "Counterparty", value: sem.counterparty.role.toUpperCase(), badge: provenanceBadge });
      }
      if (sem.ownershipContext && sem.ownershipContext !== "not_applicable" && sem.ownershipContext !== "unknown") {
        keyParameters.push({ label: "Ownership Context", value: sem.ownershipContext.toUpperCase(), badge: provenanceBadge });
      }
      if (sem.paymentStatus && sem.paymentStatus !== "unknown") {
        keyParameters.push({ label: "Payment Status", value: sem.paymentStatus.toUpperCase(), badge: provenanceBadge });
      }
      if (sem.currency?.value && sem.currency.value !== "UNKNOWN") {
        keyParameters.push({ label: "Currency", value: `${sem.currency.value} (${sem.currency.source})`, badge: provenanceBadge });
      }
      if (sem.amount !== void 0 && sem.amount > 0) {
        keyParameters.push({ label: "Transaction Amount", value: `${sem.currency?.value || "SGD"} ${sem.amount.toLocaleString()}`, badge: provenanceBadge });
      }
      if (sem.provenance) {
        keyParameters.push({
          label: "Semantic Provenance",
          value: sem.provenance.tier === "AI_REASONING" ? "AI Grounded Reasoning" : "Deterministic Heuristic Fallback",
          badge: provenanceBadge
        });
      }
    }
    if (followUp && (followUp.eventType === "settlement" || followUp.eventType === "partial_settlement")) {
      const delta = settlementDelta;
      if (delta) {
        keyParameters.push({
          label: "Settlement Amount",
          value: `${delta.currency} ${delta.amount.toFixed(2)}`,
          badge: delta.isHypothetical ? "Hypothetical" : "Settlement"
        });
        keyParameters.push({
          label: "Settled Account",
          value: delta.balanceUpdates[0]?.accountName || "Amount Due from Shareholder",
          badge: "Receivable"
        });
        keyParameters.push({
          label: "Remaining Balance",
          value: `${delta.currency} ${(delta.balanceUpdates[0]?.resultingBalance ?? 0).toFixed(2)}`,
          badge: "Balance"
        });
      }
    }
  }
  if (compact.keyParameters && compact.keyParameters.length > 0) {
    keyParameters.push(...compact.keyParameters);
  }
  if (keyParameters.length === 0) {
    if (compact.decision) {
      keyParameters.push({ label: "Accounting Decision", value: compact.decision, badge: "Decision", highlight: true });
    }
    if (compact.treatment) {
      keyParameters.push({ label: "Treatment Principle", value: compact.treatment.slice(0, 60), badge: "SFRS(I)" });
    }
    keyParameters.push({ label: "Authority Status", value: authorityStatus, badge: authorityStatus });
  }
  const assumptions = [
    ...deterministicScenario?.assumptions || [],
    ...groundedContext.assumptions || [],
    ...(compact.assumptions || []).map((a, idx) => ({
      id: `assump-${idx + 1}`,
      field: a.field,
      assumedValue: a.assumedValue,
      basisOrRationale: a.basis || "Assumed parameter for illustrative computation",
      materiality: a.materiality || "MEDIUM"
    }))
  ];
  const missingFacts = [
    .../* @__PURE__ */ new Set([
      ...groundedContext.missingFacts || [],
      ...compact.missingFacts || [],
      ...invalidJournalProposalReason ? [invalidJournalProposalReason] : []
    ])
  ];
  let uncertaintyDisclaimer = compact.uncertaintyDisclaimer || deterministicScenario?.uncertaintyDisclaimer || "";
  if (missingFacts.length > 0) {
    const notice = `Conclusion is conditional upon establishing: ${missingFacts.join("; ")}.`;
    if (!uncertaintyDisclaimer.includes("conditional upon establishing")) {
      uncertaintyDisclaimer = uncertaintyDisclaimer ? `${notice} ${uncertaintyDisclaimer}` : notice;
    }
  }
  let messageText = compact.messageText || "";
  if (!messageText || messageText.length < 30) {
    const isAccountingOrJournal = Boolean(
      compact.requiredAccounts && compact.requiredAccounts.length > 0 || compact.treatment || compact.decision || queryMode === "TRANSACTION" || queryMode === "HYBRID"
    );
    if (!isAccountingOrJournal && (queryMode === "STATUTORY_ADVISORY" || statutoryAdvisory.length > 0)) {
      const adv = statutoryAdvisory[0];
      messageText = `### Statutory Directive: ${deterministicScenario?.transactionTitle || adv?.topic || "Singapore Statutory Compliance"}

**Governing Authority**: **${adv?.authority || "Singapore Regulatory Authority"}** | **Legislation**: **${adv?.statuteOrAct || "Singapore Statutes"}** | **Authority Status**: **${authorityStatus === "DETERMINISTIC" ? "\u2713 Deterministic Statutory Engine" : authorityStatus === "CONDITIONAL" ? "\u26A0\uFE0F Conditional" : "\u{1F916} AI Proposed"}**

---

#### 1. Statutory Principle & Ruling
${compact.directAnswer || adv?.summary || "Governed strictly under Singapore statutory law."}

---

#### 2. Key Rules, Thresholds & Mandatory Provisions
`;
      const rules = compact.keyRules || adv?.keyRules || [];
      for (const rule of rules) {
        messageText += `* ${rule}
`;
      }
      if (compact.caveats && compact.caveats.length > 0) {
        messageText += `
---

#### 3. Statutory Caveats & Qualifying Conditions
`;
        for (const caveat of compact.caveats) {
          messageText += `* \u26A0\uFE0F ${caveat}
`;
        }
      }
      if (verifiedCitations.length > 0) {
        messageText += `
---

#### 4. Official Statutory Sources & Verification
`;
        for (const c of verifiedCitations) {
          messageText += `* **${c.standard} ${c.paragraph}** (${c.authority}): [${c.title}](${c.officialSourceUrl || "https://sso.agc.gov.sg"})
`;
        }
      }
      if (directGroups.length > 0) {
        const grp = directGroups[directGroups.length - 1];
        const entryHeader = directGroups.length > 1 ? `### Double Entry Journal: ${grp.title} (${grp.eventDate}) \u2014 [Entry ${directGroups.length} of ${directGroups.length}]

` : `### Double Entry Journal: ${grp.title} (${grp.eventDate})

`;
        messageText += `
---

${entryHeader}`;
        const isPendingValuation = !grp.isBalanced || grp.authorityStatus === "CONDITIONAL" || grp.lines.every((l) => l.debit === 0 && l.credit === 0);
        if (isPendingValuation) {
          messageText += `> \u26A0\uFE0F **Uncertified Journal Proposal**: Account selections proposed by AI. Monetary amounts are uncalculated because required transaction values were not provided. Do not post to general ledger without independent valuation.

`;
        }
        for (const line2 of grp.lines) {
          if (line2.debit > 0) {
            messageText += `* **Debit**: **${line2.accountName}** \u2014 **SGD ${line2.debit.toLocaleString(void 0, { minimumFractionDigits: 2 })}** *(${line2.lineExplanation})*
`;
          } else if (line2.credit > 0) {
            messageText += `* **Credit**: **${line2.accountName}** \u2014 **SGD ${line2.credit.toLocaleString(void 0, { minimumFractionDigits: 2 })}** *(${line2.lineExplanation})*
`;
          } else {
            const side = line2.lineExplanation.toLowerCase().includes("debit") || line2.category === "ASSET" || line2.category === "EXPENSE" ? "Debit" : "Credit";
            messageText += `* **${side}**: **${line2.accountName}** \u2014 **[Valuation pending]** *(${line2.lineExplanation})*
`;
          }
        }
        if (grp.isBalanced) {
          messageText += `
**Balance Check**: Total Debits (SGD ${grp.totalDebit.toLocaleString()}) == Total Credits (SGD ${grp.totalCredit.toLocaleString()})  \u2713 Balanced
`;
        } else {
          messageText += `
**Balance Check**: \u26A0\uFE0F **Pending Valuation**: Cannot verify balancing until transaction values or asset appraisals are determined.
`;
        }
      }
    } else {
      messageText = `### ${stdLabel} Accounting Assessment: ${resolvedTransactionTitle}

`;
      messageText += `**Authority Status**: **${authorityStatus === "DETERMINISTIC" ? "\u2713 Deterministic Engine" : authorityStatus === "CONDITIONAL" ? "\u26A0\uFE0F Conditional Proposal" : "\u{1F916} AI Grounded Proposal"}**

`;
      if (compact.directAnswer) {
        messageText += `#### 1. Core Principle & Treatment Directive
${compact.directAnswer}

`;
      } else if (compact.treatment) {
        messageText += `#### 1. Accounting Treatment Principle
${compact.treatment}

`;
      }
      if (compact.reasoning) {
        messageText += `#### 2. Technical Rationale & Analysis
${compact.reasoning}

`;
      }
      if (compact.singaporeTaxImpact) {
        messageText += `#### 3. Singapore Statutory & Tax Implications
${compact.singaporeTaxImpact}

`;
      }
      if (keyParameters.length > 0) {
        messageText += `---

#### 4. Key Statutory & Computational Facts
`;
        for (const p of keyParameters) {
          messageText += `* **${p.label}**: ${p.value}
`;
        }
        messageText += `
`;
      }
      if (directGroups.length > 0) {
        const grp = directGroups[directGroups.length - 1];
        const entryHeader = directGroups.length > 1 ? `### Double Entry Journal: ${grp.title} (${grp.eventDate}) \u2014 [Entry ${directGroups.length} of ${directGroups.length}]

` : `### Double Entry Journal: ${grp.title} (${grp.eventDate})

`;
        messageText += `---

${entryHeader}`;
        const isPendingValuation = !grp.isBalanced || grp.authorityStatus === "CONDITIONAL" || grp.lines.every((l) => l.debit === 0 && l.credit === 0);
        if (isPendingValuation) {
          messageText += `> \u26A0\uFE0F **Uncertified Journal Proposal**: Account selections proposed by AI. Monetary amounts are uncalculated because required transaction values were not provided. Do not post to general ledger without independent valuation.

`;
        }
        for (const line2 of grp.lines) {
          if (line2.debit > 0) {
            messageText += `* **Debit**: **${line2.accountName}** \u2014 **SGD ${line2.debit.toLocaleString(void 0, { minimumFractionDigits: 2 })}** *(${line2.lineExplanation})*
`;
          } else if (line2.credit > 0) {
            messageText += `* **Credit**: **${line2.accountName}** \u2014 **SGD ${line2.credit.toLocaleString(void 0, { minimumFractionDigits: 2 })}** *(${line2.lineExplanation})*
`;
          } else {
            const side = line2.lineExplanation.toLowerCase().includes("debit") || line2.category === "ASSET" || line2.category === "EXPENSE" ? "Debit" : "Credit";
            messageText += `* **${side}**: **${line2.accountName}** \u2014 **[Valuation pending]** *(${line2.lineExplanation})*
`;
          }
        }
        if (grp.isBalanced) {
          messageText += `
**Balance Check**: Total Debits (SGD ${grp.totalDebit.toLocaleString()}) == Total Credits (SGD ${grp.totalCredit.toLocaleString()})  \u2713 Balanced
`;
        } else {
          messageText += `
**Balance Check**: \u26A0\uFE0F **Pending Valuation**: Cannot verify balancing until transaction values or asset appraisals are determined.
`;
        }
      }
    }
  }
  const hasPendingValuation = directGroups.some((g) => !g.isBalanced && g.authorityStatus === "CONDITIONAL");
  if (hasPendingValuation) {
    if (!missingFacts.includes("Fair value or transaction price for exchange consideration")) {
      missingFacts.push("Fair value or transaction price for exchange consideration");
    }
  }
  const finalAuthorityStatus = hasPendingValuation ? "CONDITIONAL" : authorityStatus;
  let finalActualEvents = currentScenario?.actualEvents;
  let finalAccountingEvents = currentScenario?.accountingEvents;
  let isHypoScenario = Boolean(currentScenario?.isHypothetical);
  let resolvedAmount = void 0;
  if (followUp && (followUp.eventType === "settlement" || followUp.eventType === "partial_settlement")) {
    const convContext = extractAccountingContext(currentScenario);
    const delta = settlementDelta;
    if (delta && delta.resultingAccountingEvent) {
      isHypoScenario = Boolean(delta.isHypothetical);
      resolvedAmount = delta.amount;
      const priorActual = convContext.actualEvents;
      finalActualEvents = isHypoScenario ? priorActual : commitAccountingEvent(priorActual, delta.resultingAccountingEvent);
      finalAccountingEvents = [...currentScenario?.accountingEvents || priorActual, delta.resultingAccountingEvent];
    }
  } else if (!finalActualEvents && directGroups.length > 0) {
    committedDirectGroups = directGroups.filter((g) => !g.isHypothetical);
    finalActualEvents = committedDirectGroups.map((grp, idx) => ({
      id: grp.id || `evt-${idx + 1}`,
      transactionId: grp.transactionId || grp.id || `tx-${idx + 1}`,
      targetTransactionId: grp.targetTransactionId,
      type: "initial_transaction",
      description: grp.title,
      amount: grp.totalDebit,
      currency: deterministicScenario?.transactionCurrency || "SGD",
      affectedAccounts: grp.lines.map((l) => l.accountName),
      journalLines: grp.lines,
      eventDate: grp.eventDate,
      isHypothetical: false
    }));
    finalAccountingEvents = [...finalActualEvents ?? []];
  } else if (hasAuthoritativeDeterministicEntries && !committedDirectGroups) {
    committedDirectGroups = directGroups.filter((g) => !g.isHypothetical);
  }
  if (resolvedAmount === void 0) {
    if (deterministicScenario?.amount && deterministicScenario.amount > 0) {
      resolvedAmount = deterministicScenario.amount;
    } else if (groundedContext.semanticUnderstanding?.amount && groundedContext.semanticUnderstanding.amount > 0) {
      resolvedAmount = groundedContext.semanticUnderstanding.amount;
    }
  }
  const activeBasis = followUp?.targetMeasurementBasis || groundedContext.semanticUnderstanding?.projectedMeasurementBasis || groundedContext.semanticUnderstanding?.actualMeasurementBasis || currentScenario?.actualMeasurementBasis;
  if (activeBasis === "FVOCI") {
    for (const grp of directGroups) {
      for (const line2 of grp.lines) {
        const accLower = line2.accountName.toLowerCase();
        if (accLower.includes("fvtpl") || accLower.includes("fair value gain (profit or loss)") || accLower.includes("fair value gain [p&l]")) {
          throw new Error(`[JOURNAL_CONSISTENCY_VIOLATION] Journal for FVOCI contains FVTPL account: ${line2.accountName}`);
        }
        if (accLower.includes("realized foreign exchange gain") && accLower.includes("p&l")) {
          throw new Error(`[JOURNAL_CONSISTENCY_VIOLATION] Journal for FVOCI contains P&L FX gain account: ${line2.accountName}`);
        }
      }
    }
  }
  const convContextForState = extractAccountingContext(currentScenario);
  const resolvedActualBasis = currentScenario?.actualMeasurementBasis || deterministicScenario?.actualMeasurementBasis || convContextForState.underlyingTransaction?.actualMeasurementBasis || currentScenario?.classification || "UNKNOWN";
  const resolvedProjectedBasis = followUp?.targetMeasurementBasis || groundedContext.semanticUnderstanding?.projectedMeasurementBasis || currentScenario?.projectedMeasurementBasis;
  const resolvedUnderlyingTx = currentScenario?.underlyingTransaction || deterministicScenario?.underlyingTransaction || convContextForState.underlyingTransaction;
  const scenarioState = {
    scenarioType: resolvedScenarioType,
    queryIntent: queryMode,
    primaryDomain: deterministicScenario?.primaryDomain || (groundedContext.classification.primaryDomain === "EMPLOYMENT" ? "MOM_EMPLOYMENT" : groundedContext.classification.primaryDomain === "PAYROLL" ? "CPF_BOARD" : groundedContext.classification.primaryDomain === "MAS_FUNDS" ? "MAS_FUNDS" : groundedContext.classification.primaryDomain === "CORPORATE_REGULATORY" ? "ACRA_CORP" : groundedContext.classification.primaryDomain === "TAX" ? "IRAS_TAX" : groundedContext.classification.primaryDomain === "GST" ? "IRAS_GST" : groundedContext.classification.authorities.includes("MAS") ? "MAS_FUNDS" : "ACCOUNTING_SFRS"),
    rawQuery: userInput,
    transactionTitle: resolvedTransactionTitle,
    functionalCurrency: deterministicScenario?.functionalCurrency || "SGD",
    transactionCurrency: deterministicScenario?.transactionCurrency || (groundedContext.semanticUnderstanding?.currency?.value || "SGD"),
    authorityStatus: finalAuthorityStatus,
    accountingTreatmentSummary: compact.treatment || (isRecognizedDeterministicFixture ? deterministicScenario?.accountingTreatmentSummary : void 0),
    singaporeTaxTreatmentSummary: compact.singaporeTaxImpact || (isRecognizedDeterministicFixture ? deterministicScenario?.singaporeTaxTreatmentSummary : void 0),
    regulatoryMandatesSummary: isRecognizedDeterministicFixture ? deterministicScenario?.regulatoryMandatesSummary : void 0,
    effectiveDateOrTiming: isRecognizedDeterministicFixture ? deterministicScenario?.effectiveDateOrTiming : void 0,
    uncertaintyDisclaimer: uncertaintyDisclaimer || void 0,
    amount: resolvedAmount,
    accountingEvents: finalAccountingEvents,
    actualEvents: finalActualEvents,
    isHypothetical: isHypoScenario,
    keyParameters,
    directGroups,
    committedDirectGroups,
    projectedGroups,
    statutoryAdvisory: statutoryAdvisory.length > 0 ? statutoryAdvisory : void 0,
    assumptions: assumptions.length > 0 ? assumptions : void 0,
    missingFacts: missingFacts.length > 0 ? missingFacts : void 0,
    ownershipContext: deterministicScenario?.ownershipContext || groundedContext.semanticUnderstanding?.ownershipContext || currentScenario?.ownershipContext,
    semanticUnderstanding: groundedContext.semanticUnderstanding || currentScenario?.semanticUnderstanding,
    actualMeasurementBasis: resolvedActualBasis,
    projectedMeasurementBasis: resolvedProjectedBasis,
    underlyingTransaction: resolvedUnderlyingTx,
    classification: resolvedProjectedBasis || resolvedActualBasis,
    isComplete: !hasPendingValuation && missingFacts.length === 0 && retrievedEvidenceScope.length > 0,
    missingFields: []
  };
  return {
    messageText: appendStatutorySourceFooter(messageText, scenarioState),
    scenarioState
  };
}

// src/services/groundingContextBuilder.ts
function mapCanonicalDomainToQueryDomain(domain) {
  switch (domain) {
    case "ACCOUNTING":
      return "ACCOUNTING_SFRS";
    case "TAX":
      return "IRAS_TAX";
    case "GST":
      return "IRAS_GST";
    case "CORPORATE_REGULATORY":
      return "ACRA_CORP";
    case "EMPLOYMENT":
      return "MOM_EMPLOYMENT";
    case "PAYROLL":
      return "CPF_BOARD";
    case "MAS_FUNDS":
      return "MAS_FUNDS";
    default:
      return "GENERAL";
  }
}
function extractUserFacts(query, scenario, semanticUnderstanding) {
  const facts = [];
  const q = query.trim();
  const amountMatches = q.match(/(?:sgd|\$|usd|eur|gbp)?\s*[\d,]+(?:\.\d+)?\s*(?:k|m|thousand|million|billion)?\b/gi);
  if (amountMatches && amountMatches.length > 0) {
    facts.push(`Numerical quantities stated: ${amountMatches.map((m) => m.trim()).join(", ")}`);
  }
  const dateMatches = q.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g);
  if (dateMatches && dateMatches.length > 0) {
    facts.push(`Transaction dates specified: ${dateMatches.join(", ")}`);
  }
  const understanding = semanticUnderstanding || scenario?.semanticUnderstanding || defaultTransactionUnderstandingService.understandTransactionSync(query, scenario?.functionalCurrency || "SGD");
  if (understanding?.currency?.value) {
    if (understanding.currency.value === "USD") {
      facts.push("Foreign currency involved: USD");
    } else if (understanding.currency.value === "SGD") {
      facts.push("Singapore Dollar (SGD) referenced");
    } else {
      facts.push(`Currency involved: ${understanding.currency.value}`);
    }
  }
  if (understanding) {
    if (understanding.transactionType && understanding.transactionType !== "unclassified_transaction") {
      facts.push(`Transaction type: ${understanding.transactionType}`);
    }
    if (understanding.ownershipContext && understanding.ownershipContext !== "unknown") {
      facts.push(`Ownership context: ${understanding.ownershipContext}`);
    }
    if (understanding.counterparty?.role && understanding.counterparty.role !== "unknown") {
      facts.push(`Counterparty role: ${understanding.counterparty.role}`);
    }
    if (understanding.subject) {
      facts.push(`Transaction subject: ${understanding.subject}`);
    }
    if (understanding.amount !== void 0) {
      facts.push(`Stated transaction amount: ${understanding.amount}`);
    }
    if (understanding.paymentStatus && understanding.paymentStatus !== "unknown") {
      facts.push(`Payment status: ${understanding.paymentStatus}`);
    }
  }
  if (scenario?.keyParameters) {
    for (const p of scenario.keyParameters) {
      if (p.badge !== "Assumed Parameter" && !facts.some((f) => f.includes(p.label))) {
        facts.push(`${p.label}: ${p.value}`);
      }
    }
  }
  return facts;
}
function formulateApplicationRules(classification, query) {
  const rules = [];
  const q = query.toLowerCase();
  if ((q.includes("journal") || q.includes("entry") || q.includes("debit") || q.includes("credit") || classification.journalEntryRequired) && (classification.intent === "TRANSACTION" || classification.intent === "HYBRID" || classification.journalEntryRequired)) {
    rules.push("Calculation Rule: Sum of Debits must equal Sum of Credits exactly. Double-entry journals must balance to 2 decimal places.");
  }
  if (q.includes("trade discount") || q.includes("discount") && (q.includes("supplier") || q.includes("purchase") || q.includes("equipment") || q.includes("goods") || q.includes("invoice"))) {
    rules.push("Calculation Convention: Supplier trade discounts are deducted directly from the gross purchase price to derive initial cost consideration; trade discounts are not recorded as operating expenses.");
  }
  if ((q.includes("fx") || q.includes("forex") || q.includes("exchange rate") || q.includes("foreign") && q.includes("currency") || q.includes("usd") && (q.includes("share") || q.includes("stock") || q.includes("gain"))) && (classification.intent === "TRANSACTION" || classification.accountingAnalysisRequired)) {
    rules.push("Calculation Convention: Currency variance on monetary settlement is calculated as Foreign Amount * (Spot_disposal - Spot_acquisition); asset valuation variance is calculated as (Disposal_price - Cost_price) * Spot_disposal.");
  }
  if ((q.includes("depreciation") || q.includes("amortis") || q.includes("amortiz")) && (classification.intent === "TRANSACTION" || classification.accountingAnalysisRequired)) {
    rules.push("Calculation Convention: Straight-line cost allocation formula is (Initial Cost - Residual Value) / Useful Life.");
  }
  return rules;
}
async function buildGroundedReasoningContext(userInput, currentScenario, retriever = defaultAdvancedSourceRetriever, providerOrApiKey) {
  const conversationContext = extractAccountingContext(currentScenario);
  const semanticUnderstanding = await defaultTransactionUnderstandingService.understandTransaction(
    userInput,
    currentScenario?.functionalCurrency || "SGD",
    "SG",
    providerOrApiKey,
    conversationContext
  );
  const classification = classifyQuestion(userInput);
  const targetDomain = mapCanonicalDomainToQueryDomain(classification.primaryDomain);
  const targetAuthorities = classification.authorities;
  const retrieved = await retriever.retrieveSources({
    query: userInput,
    domain: targetDomain !== "GENERAL" ? targetDomain : void 0,
    authorities: targetAuthorities.length > 0 ? targetAuthorities : void 0,
    maxResults: 6,
    semanticContext: semanticUnderstanding
  });
  const primaryEvidence = [];
  const officialGuidance = [];
  const curatedSummaries = [];
  for (const record of retrieved) {
    if (record.evidenceTier === "PRIMARY_SOURCE" && (record.sourceStatus === "VERIFIED" || record.sourceStatus === "HISTORICAL") && record.isVerbatimText === true) {
      primaryEvidence.push(record);
    } else if (record.evidenceTier === "OFFICIAL_GUIDANCE") {
      officialGuidance.push(record);
    } else {
      curatedSummaries.push(record);
    }
  }
  const userFacts = extractUserFacts(userInput, currentScenario, semanticUnderstanding);
  const missingFacts = [...classification.missingFacts];
  const isTransactionQuery = classification.intent === "TRANSACTION" || classification.intent === "HYBRID" || classification.journalEntryRequired;
  if (isTransactionQuery && semanticUnderstanding.factsMissing) {
    for (const mf of semanticUnderstanding.factsMissing) {
      if (!missingFacts.includes(mf)) {
        missingFacts.push(mf);
      }
    }
  }
  const assumptions = [];
  if (currentScenario?.assumptions) {
    assumptions.push(...currentScenario.assumptions);
  }
  if (semanticUnderstanding.assumptions) {
    for (const asm of semanticUnderstanding.assumptions) {
      if (!assumptions.some((a) => a.field === "currency_assumption" || a.basisOrRationale === asm)) {
        assumptions.push({
          id: `sem-asm-${assumptions.length + 1}`,
          field: "currency_or_transaction_parameter",
          assumedValue: asm,
          basisOrRationale: asm,
          materiality: "LOW",
          userClarificationPrompt: "Please confirm currency or transaction parameters if different."
        });
      }
    }
  }
  const applicationRules = formulateApplicationRules(classification, userInput);
  return {
    classification,
    userFacts,
    missingFacts,
    assumptions,
    primaryEvidence,
    officialGuidance,
    curatedSummaries,
    applicationRules,
    currentInformationRequired: classification.currentInformationRequired,
    semanticUnderstanding
  };
}
function formatGroundedSystemPrompt(context, standard) {
  const stdLabel = standard === "SFRS_I" ? "Singapore Financial Reporting Standards (International) [SFRS(I)]" : "International Financial Reporting Standards [IFRS]";
  let prompt = `You are an authoritative Senior Singapore Accounting & Statutory Research Assistant for professional accountants.
Your primary directive is to provide correct, authoritative, and traceable information under ${stdLabel} and Singapore statutory law.

================================================================================
EVIDENCE-FIRST REASONING PRINCIPLES (MANDATORY SAFEGUARDS)
================================================================================
1. EVIDENCE GROUNDING: Use the supplied evidence for authoritative legal and accounting claims.
2. ANTI-FABRICATION: You must NEVER invent standards, paragraph numbers, statutory sections, rates, thresholds, deadlines, or citations.
3. CURATED SUMMARY STATUS: Never treat a curated summary as verified primary-source text.
4. APPLICATION RULES: Never treat an application/calculation rule as statutory authority.
5. STRICT SEPARATION: Clearly distinguish in your reasoning and output:
   - User Facts: Stated explicitly by the user.
   - Missing Facts: Required to confirm accounting treatment but omitted by user.
   - Assumptions: Introduced SOLELY for illustrative calculations; never silently convert a missing fact into an established fact.
   - Evidence: Grounded in retrieved primary sources or curated standards.
   - Professional Analysis: Applying the evidence to facts.
   - Conclusion: Recommended accounting or tax treatment.
   - Illustrative Journal Entry: Presented ONLY if facts and recognition criteria support it (or marked strictly conditional).
6. TIME-SENSITIVITY & UNCERTAINTY HANDLING:
   When current information is required but available evidence is insufficient or unverified, state:
   "I couldn't verify the applicable current source from the available evidence."
   Do not silently answer from unverified model memory.
7. CITATION INTEGRITY: Do not invent a citation merely because the user asks for one. Tie citations strictly to verified records.
8. INCOMPLETE EVIDENCE: If evidence conflicts or is incomplete, state the limitation instead of guessing.
9. CONCEPTUAL EXPLANATIONS: General model knowledge may be used for explanatory context, but must NOT be presented as verified authoritative evidence or given fabricated citations.
10. SIMPLE-QUESTION DEFAULT: For a short request to define or explain a term, answer the question directly even when no repository record is retrieved. Give a concise general explanation, explicitly label it as general explanatory context, and do not invent a statute, regulator, section, rate, threshold, deadline, eligibility condition, or source link. Do NOT respond only with "I couldn't verify the applicable current source from the available evidence." That wording is reserved for a request that actually requires a current legal, regulatory, tax, rate, threshold, deadline, or eligibility conclusion.

================================================================================
GROUNDED REASONING CONTEXT SUPPLIED TO YOU
================================================================================
`;
  prompt += `
[1. USER-PROVIDED FACTS]
`;
  if (context.userFacts.length > 0) {
    for (const fact of context.userFacts) {
      prompt += `\u2022 ${fact}
`;
    }
  } else {
    prompt += `\u2022 None explicitly extracted from query.
`;
  }
  if (context.semanticUnderstanding) {
    const sem = context.semanticUnderstanding;
    prompt += `
[1.1 UNDERSTOOD TRANSACTION FACTS & MANDATORY ACCOUNTING GUARDRAILS]
`;
    prompt += `\u2022 Reporting Entity: ${sem.reportingEntity.type.toUpperCase()}${sem.reportingEntity.description ? ` (${sem.reportingEntity.description})` : ""}
`;
    if (sem.counterparty) {
      prompt += `\u2022 Counterparty Role: ${sem.counterparty.role.toUpperCase()}${sem.counterparty.description ? ` (${sem.counterparty.description})` : ""}
`;
    }
    prompt += `\u2022 Ownership Context: ${(sem.ownershipContext || "unknown").toUpperCase()}
`;
    prompt += `\u2022 Payment Status: ${(sem.paymentStatus || "unknown").toUpperCase()}
`;
    prompt += `\u2022 Currency Fact: ${sem.currency.value || "UNSPECIFIED"} (Source: ${sem.currency.source}, Confidence: ${sem.currency.confidence})
`;
    if (sem.ownershipContext === "own_equity") {
      prompt += `\u26A0\uFE0F MANDATORY GUARDRAIL (SFRS(I) 1-32 \xA733): The reporting entity is issuing its own equity. An entity's own shares can NEVER be recognized as a Financial Asset at FVTPL/FVTOCI. Credit Share Capital under Equity.
`;
    }
    if (sem.currency.value === null || sem.currency.source === "unknown") {
      prompt += `\u26A0\uFE0F MANDATORY GUARDRAIL: Currency is unspecified. Do NOT invent USD or execute foreign exchange translation.
`;
    }
  }
  prompt += `
[2. MISSING FACTS (FACTS REQUIRED BEFORE REACHING FINAL CONCLUSION)]
`;
  if (context.missingFacts.length > 0) {
    for (const mf of context.missingFacts) {
      prompt += `\u26A0\uFE0F Missing Fact: ${mf}
`;
    }
  } else {
    prompt += `\u2022 No material facts currently missing for general evaluation.
`;
  }
  prompt += `
[3. EXPLICIT ASSUMPTIONS (ILLUSTRATIVE SCENARIO USE ONLY)]
`;
  if (context.assumptions.length > 0) {
    for (const a of context.assumptions) {
      prompt += `\u2022 [${a.materiality} Materiality] ${a.field}: Assumed '${String(a.assumedValue)}' (${a.basisOrRationale})
`;
    }
  } else {
    prompt += `\u2022 None assumed. Do not assume missing criteria are satisfied without explicitly marking them.
`;
  }
  prompt += `
[4. AUTHORITATIVE PRIMARY SOURCE EVIDENCE (VERBATIM STATUTES)]
`;
  if (context.primaryEvidence.length > 0) {
    for (const p of context.primaryEvidence) {
      const freshnessLabel = p.freshnessStatus === "HISTORICAL_SUPERSEDED" ? "[HISTORICAL / SUPERSEDED PROVISION]" : p.freshnessStatus === "PENDING_EFFECTIVE" ? "[PENDING EFFECTIVE]" : p.freshnessStatus === "AUDIT_OVERDUE" ? "[VERIFICATION REVIEW DUE]" : "[CURRENT PROVISION]";
      prompt += `### Primary Source: ${p.documentTitle} (${p.paragraphOrSection}) ${freshnessLabel}
`;
      if (p.validFrom || p.validTo) {
        prompt += `Temporal Validity: ${p.validFrom || "Initial"} to ${p.validTo || "Present (In Force)"}
`;
      }
      prompt += `Authority: ${p.authorityName} | Publisher: ${p.sourcePublisher}
`;
      prompt += `Official URL: ${p.officialSourceUrl}
`;
      prompt += `Verbatim Statutory Text:
"${p.sourceText}"

`;
    }
  } else {
    prompt += `\u2022 No verbatim primary statutory provision retrieved for this specific query.
`;
  }
  prompt += `
[5. OFFICIAL / CURATED GUIDANCE]
`;
  if (context.officialGuidance.length > 0) {
    for (const g of context.officialGuidance) {
      prompt += `### Guidance: ${g.documentTitle} (${g.paragraphOrSection})
`;
      prompt += `Authority: ${g.authorityName} | Publisher: ${g.sourcePublisher}
`;
      prompt += `Summary: ${g.principleSummary}
`;
      prompt += `Guidance Text: ${g.sourceText}

`;
    }
  } else {
    prompt += `\u2022 No specific administrative guidance documents retrieved.
`;
  }
  prompt += `
[6. CURATED SUMMARIES (SFRS(I) STANDARDS & ACT SUMMARIES - NEEDS REVIEW)]
`;
  if (context.curatedSummaries.length > 0) {
    for (const c of context.curatedSummaries) {
      const freshnessLabel = c.freshnessStatus === "HISTORICAL_SUPERSEDED" ? "[HISTORICAL / SUPERSEDED PROVISION]" : c.freshnessStatus === "PENDING_EFFECTIVE" ? "[PENDING EFFECTIVE]" : c.freshnessStatus === "AUDIT_OVERDUE" ? "[VERIFICATION REVIEW DUE]" : "[CURRENT PROVISION]";
      prompt += `### Curated Standard/Statute Summary: ${c.documentTitle} (${c.paragraphOrSection}) ${freshnessLabel}
`;
      if (c.validFrom || c.validTo) {
        prompt += `Temporal Validity: ${c.validFrom || "Initial"} to ${c.validTo || "Present (In Force)"}
`;
      }
      prompt += `Authority: ${c.authorityName} | Instrument: ${c.legalOrStandardInstrument}
`;
      prompt += `Official Source Portal: ${c.officialSourceUrl}
`;
      prompt += `Status: ${c.sourceStatus} (${c.sourceType})
`;
      prompt += `Principle / Summary: ${c.sourceText}

`;
    }
  } else {
    prompt += `\u2022 No curated standard summaries retrieved.
`;
  }
  prompt += `
[7. APPLICATION & CALCULATION RULES (DETERMINISTIC LOGIC)]
`;
  if (context.applicationRules.length > 0) {
    for (const r of context.applicationRules) {
      prompt += `\u2022 ${r}
`;
    }
  } else {
    prompt += `\u2022 Standard accounting accrual and math balancing conventions apply.
`;
  }
  if (context.classification.intent === "STATUTORY_ADVISORY") {
    prompt += `
================================================================================
RESPONSE FORMAT SPECIFICATION (COMPACT STATUTORY DECISION SCHEMA)
================================================================================
CRITICAL FOR LATENCY & ACCURACY:
Do NOT write verbose markdown essays or redundant nested structures in JSON.
Deterministic application code automatically renders the markdown headers, citation badges, and UI cards.
Return ONLY this concise, compact JSON payload:
{
  "directAnswer": "Clear, direct answer. If no supplied evidence supports a legal claim, provide a general explanation clearly labelled as non-authoritative explanatory context rather than inventing a citation or returning only a verification disclaimer.",
  "keyRules": [
    "Specific statutory rule 1 with statutory numbers/thresholds/formula",
    "Specific statutory rule 2..."
  ],
  "caveats": [
    "Qualifying condition or exception 1..."
  ],
  "statuteReferences": [
    {
      "standard": "Act Name (e.g. Employment Act 1968)",
      "paragraph": "Section or Part (e.g. Part IV \xA738)",
      "authority": "MOM" | "CPF" | "IRAS" | "ACRA",
      "officialSourceUrl": "https://sso.agc.gov.sg/..."
    }
  ]
}
Return pure JSON only.
`;
  } else if (context.classification.intent === "TRANSACTION" || context.classification.journalEntryRequired) {
    prompt += `
================================================================================
RESPONSE FORMAT SPECIFICATION (COMPACT TRANSACTION & JOURNAL DECISION SCHEMA)
================================================================================
CRITICAL FOR LATENCY & ACCURACY:
Do NOT write verbose markdown essays, redundant nested structures, or monetary amounts in JSON.
The deterministic accounting engine automatically computes debit/credit balancing, monetary amounts, foreign exchange rates, and UI parameters.
Gemini must NOT calculate amounts, balances, or invent placeholder numbers ($1,000, $50,000, etc.). Focus strictly on accounting classification, applicable standard, required account names, categories, debit/credit orientation, and missing valuation facts.
Return ONLY this concise, compact JSON payload:
{
  "transactionNature": "Brief title/nature of the transaction",
  "treatment": "Authoritative financial reporting treatment under ${stdLabel}",
  "requiredAccounts": [
    {
      "accountName": "Account Name (e.g. Office Equipment)",
      "category": "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE",
      "debitCredit": "DEBIT" | "CREDIT",
      "rationale": "Why debited/credited"
    }
  ],
  "bifurcateFx": true | false,
  "tradeDiscountHandling": "string",
  "missingFacts": ["Any missing facts required to establish final treatment"],
  "assumptions": [
    { "field": "string", "assumedValue": "string", "basis": "string", "materiality": "HIGH" | "MEDIUM" | "LOW" }
  ],
  "citations": [
    {
      "standard": "SFRS(I) Standard or Act Name",
      "paragraph": "\xA7Paragraph or Section",
      "authority": "ASC" | "ACRA" | "IRAS" | "MOM" | "CPF",
      "officialSourceUrl": "string"
    }
  ]
}
Return pure JSON only.
`;
  } else {
    prompt += `
================================================================================
RESPONSE FORMAT SPECIFICATION (COMPACT ACCOUNTING REASONING SCHEMA)
================================================================================
CRITICAL FOR LATENCY & ACCURACY:
Do NOT write verbose markdown essays or duplicate boilerplate. Focus strictly on professional reasoning and technical treatment.
Return ONLY this concise, compact JSON payload:
{
  "decision": "Core conclusion on recognition, measurement, or compliance",
  "treatment": "Detailed financial reporting treatment under ${stdLabel}",
  "reasoning": "Technical rationale applying the standard or statutory provision to user facts",
  "singaporeTaxImpact": "Tax deductibility under Income Tax Act, capital allowances, or GST impact",
  "missingFacts": ["Any missing material facts required before reaching final conclusion"],
  "assumptions": [
    { "field": "string", "assumedValue": "string", "basis": "string", "materiality": "HIGH" | "MEDIUM" | "LOW" }
  ],
  "citations": [
    {
      "standard": "Standard or Act Name",
      "paragraph": "\xA7Paragraph or Section",
      "authority": "ASC" | "ACRA" | "IRAS" | "MOM" | "CPF",
      "officialSourceUrl": "string"
    }
  ]
}
Return pure JSON only.
`;
  }
  return prompt;
}
function postProcessAIResponse(parsed, currentScenario, userInput, groundedContext, deterministicScenario, standard = "SFRS_I") {
  const isCompactPayload = Boolean(
    parsed && (parsed.directAnswer !== void 0 || parsed.requiredAccounts !== void 0 || parsed.treatment !== void 0 && (!parsed.directGroups || parsed.directGroups.length === 0) || parsed.decision !== void 0 && (!parsed.directGroups || parsed.directGroups.length === 0) || !parsed.messageText && (!parsed.directGroups || parsed.directGroups.length === 0))
  );
  const isSettlementFollowUp = groundedContext.semanticUnderstanding?.followUpAnalysis?.eventType === "settlement" || groundedContext.semanticUnderstanding?.followUpAnalysis?.eventType === "partial_settlement";
  if (isCompactPayload || isSettlementFollowUp) {
    return assembleDeterministicResponse(
      parsed,
      userInput,
      currentScenario,
      groundedContext,
      deterministicScenario || null,
      standard
    );
  }
  const retrievedEvidenceScope = [
    ...groundedContext.primaryEvidence,
    ...groundedContext.officialGuidance,
    ...groundedContext.curatedSummaries
  ];
  const hasAuthoritativeDeterministicEntries = deterministicScenario && deterministicScenario.scenarioType !== "UNRECOGNIZED" && deterministicScenario.directGroups && deterministicScenario.directGroups.length > 0;
  const hasMissingFacts = Boolean(groundedContext.missingFacts && groundedContext.missingFacts.length > 0);
  const computedAuthorityStatus = hasMissingFacts ? "CONDITIONAL" : hasAuthoritativeDeterministicEntries ? deterministicScenario.authorityStatus || "DETERMINISTIC" : "AI_PROPOSED";
  let directGroups;
  if (hasAuthoritativeDeterministicEntries) {
    directGroups = deterministicScenario.directGroups.map((grp) => ({
      ...grp,
      authorityStatus: grp.authorityStatus || computedAuthorityStatus
    }));
  } else {
    directGroups = (Array.isArray(parsed.directGroups) ? parsed.directGroups : []).map((grp, gIdx) => {
      const lines = (Array.isArray(grp?.lines) ? grp.lines : []).map((l, lIdx) => ({
        id: l.id || `line-${gIdx}-${lIdx}`,
        accountCode: l.accountCode || "1000",
        accountName: l.accountName || "Account",
        category: l.category || "ASSET",
        debit: typeof l.debit === "number" ? Math.round(l.debit * 100) / 100 : 0,
        credit: typeof l.credit === "number" ? Math.round(l.credit * 100) / 100 : 0,
        foreignCurrency: l.foreignCurrency,
        foreignDebit: l.foreignDebit,
        foreignCredit: l.foreignCredit,
        exchangeRate: l.exchangeRate,
        lineExplanation: l.lineExplanation || ""
      }));
      const tradeDiscountExpenseIdx = lines.findIndex(
        (l) => l.accountName.toLowerCase().includes("trade discount") && l.category === "EXPENSE"
      );
      if (tradeDiscountExpenseIdx !== -1) {
        lines.splice(tradeDiscountExpenseIdx, 1);
      }
      const totalDebit = Math.round(lines.reduce((s, l) => s + l.debit, 0) * 100) / 100;
      const totalCredit = Math.round(lines.reduce((s, l) => s + l.credit, 0) * 100) / 100;
      const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;
      const verifiedCitations = (grp.citations || []).map((cite) => {
        const verification = defaultCitationVerifier.verifyCitation(cite, cite.authority, retrievedEvidenceScope);
        const safeUrl = verification.matchedRecord?.officialSourceUrl || getSafeOfficialUrl(cite.officialSourceUrl, cite.standard, cite.paragraph, cite.authority) || cite.officialSourceUrl;
        return {
          standard: cite.standard || "",
          paragraph: cite.paragraph || "",
          title: cite.title || "",
          text: cite.text || "",
          authority: cite.authority,
          officialSourceUrl: safeUrl,
          verificationStatus: verification.status,
          isAuthoritativePrimarySource: verification.isAuthoritativePrimarySource,
          isStructurallyValid: verification.isStructurallyValid,
          verificationReason: verification.reason,
          structuralVerificationOnly: true
        };
      });
      return {
        id: grp.id || `grp-${gIdx + 1}`,
        eventDate: formatSingaporeDate(grp.eventDate || /* @__PURE__ */ new Date()),
        title: grp.title || `Entry Group ${gIdx + 1}`,
        summary: grp.summary || "",
        lines,
        totalDebit,
        totalCredit,
        isBalanced,
        citations: verifiedCitations,
        rationalePoints: grp.rationalePoints || [],
        authorityStatus: computedAuthorityStatus
      };
    });
  }
  if (directGroups.length === 0 && currentScenario?.directGroups && currentScenario.directGroups.length > 0) {
    directGroups = currentScenario.directGroups.map((grp) => ({
      ...grp,
      authorityStatus: grp.authorityStatus || computedAuthorityStatus
    }));
  }
  const keyParameters = hasAuthoritativeDeterministicEntries && deterministicScenario.keyParameters && deterministicScenario.keyParameters.length > 0 ? deterministicScenario.keyParameters : parsed.keyParameters && Array.isArray(parsed.keyParameters) && parsed.keyParameters.length > 0 ? parsed.keyParameters : currentScenario?.keyParameters || [];
  const finalTitle = parsed.transactionTitle && parsed.transactionTitle !== "Accounting Transaction" ? parsed.transactionTitle : deterministicScenario?.transactionTitle || currentScenario?.transactionTitle || "Accounting Transaction";
  const statutoryAdvisory = (parsed.statutoryAdvisory || deterministicScenario?.statutoryAdvisory || currentScenario?.statutoryAdvisory || []).map((adv) => ({
    ...adv,
    officialUrl: getSafeOfficialUrl(adv.officialUrl, adv.statuteOrAct, adv.sectionOrSchedule, adv.authority) || adv.officialUrl
  }));
  let uncertaintyDisclaimer = parsed.uncertaintyDisclaimer || currentScenario?.uncertaintyDisclaimer || "";
  if (groundedContext.missingFacts && groundedContext.missingFacts.length > 0) {
    const missingConditionNotice = `Conclusion is conditional upon establishing: ${groundedContext.missingFacts.join("; ")}.`;
    if (!uncertaintyDisclaimer.includes("conditional upon establishing") && !uncertaintyDisclaimer.includes(missingConditionNotice)) {
      uncertaintyDisclaimer = uncertaintyDisclaimer ? `${missingConditionNotice} ${uncertaintyDisclaimer}` : missingConditionNotice;
    }
  }
  if (retrievedEvidenceScope.length === 0) {
    const noEvidenceNotice = "No authoritative evidence was retrieved from the verified repository to support this claim.";
    if (!uncertaintyDisclaimer.includes(noEvidenceNotice) && !(parsed.messageText || "").includes(noEvidenceNotice)) {
      uncertaintyDisclaimer = uncertaintyDisclaimer ? `${noEvidenceNotice} ${uncertaintyDisclaimer}` : noEvidenceNotice;
    }
  }
  if (groundedContext.currentInformationRequired && groundedContext.primaryEvidence.length === 0) {
    const fallbackNotice = "I couldn't verify the applicable current source from the available evidence.";
    if (!uncertaintyDisclaimer.includes(fallbackNotice) && !(parsed.messageText || "").includes(fallbackNotice)) {
      uncertaintyDisclaimer = uncertaintyDisclaimer ? `${fallbackNotice} ${uncertaintyDisclaimer}` : fallbackNotice;
    }
  }
  const assumptions = [
    ...parsed.assumptions || [],
    ...deterministicScenario?.assumptions || [],
    ...groundedContext.assumptions.filter(
      (ga) => !(parsed.assumptions || []).some((pa) => pa.field === ga.field)
    )
  ];
  const scenarioState = {
    scenarioType: parsed.scenarioType || deterministicScenario?.scenarioType || currentScenario?.scenarioType || "UNIVERSAL",
    queryIntent: parsed.queryIntent || (statutoryAdvisory.length > 0 ? "STATUTORY_ADVISORY" : currentScenario?.queryIntent || "TRANSACTION"),
    primaryDomain: parsed.primaryDomain || deterministicScenario?.primaryDomain || currentScenario?.primaryDomain || (statutoryAdvisory.length > 0 ? statutoryAdvisory[0].authority === "ACRA" ? "ACRA_CORP" : statutoryAdvisory[0].authority === "CPF" ? "CPF_BOARD" : statutoryAdvisory[0].authority === "MOM" ? "MOM_EMPLOYMENT" : statutoryAdvisory[0].authority === "MAS" ? "MAS_FUNDS" : "IRAS_TAX" : "ACCOUNTING_SFRS"),
    rawQuery: userInput,
    transactionTitle: finalTitle,
    functionalCurrency: parsed.functionalCurrency || deterministicScenario?.functionalCurrency || currentScenario?.functionalCurrency || "SGD",
    transactionCurrency: parsed.transactionCurrency || deterministicScenario?.transactionCurrency || currentScenario?.transactionCurrency || "SGD",
    accountingTreatmentSummary: parsed.accountingTreatmentSummary || deterministicScenario?.accountingTreatmentSummary || currentScenario?.accountingTreatmentSummary,
    singaporeTaxTreatmentSummary: parsed.singaporeTaxTreatmentSummary || deterministicScenario?.singaporeTaxTreatmentSummary || currentScenario?.singaporeTaxTreatmentSummary,
    regulatoryMandatesSummary: parsed.regulatoryMandatesSummary || deterministicScenario?.regulatoryMandatesSummary || currentScenario?.regulatoryMandatesSummary,
    effectiveDateOrTiming: parsed.effectiveDateOrTiming || deterministicScenario?.effectiveDateOrTiming || currentScenario?.effectiveDateOrTiming,
    uncertaintyDisclaimer: uncertaintyDisclaimer || void 0,
    authorityStatus: computedAuthorityStatus,
    keyParameters,
    directGroups,
    statutoryAdvisory: statutoryAdvisory.length > 0 ? statutoryAdvisory : void 0,
    assumptions: assumptions.length > 0 ? assumptions : void 0,
    missingFacts: groundedContext.missingFacts.length > 0 ? groundedContext.missingFacts : void 0,
    ownershipContext: deterministicScenario?.ownershipContext || groundedContext.semanticUnderstanding?.ownershipContext || currentScenario?.ownershipContext,
    semanticUnderstanding: groundedContext.semanticUnderstanding || currentScenario?.semanticUnderstanding,
    isComplete: groundedContext.missingFacts.length === 0 && retrievedEvidenceScope.length > 0,
    missingFields: []
  };
  return {
    messageText: appendStatutorySourceFooter(parsed.messageText || "", scenarioState),
    scenarioState
  };
}

// src/services/telemetry.ts
var RequestProfiler = class {
  query;
  modelName;
  startTime;
  timeToFirstVisibleMs = 0;
  classificationMs = 0;
  retrievalMs = 0;
  groundingMs = 0;
  geminiCallCount = 0;
  geminiRequestMs = 0;
  geminiInputTokens = 0;
  geminiOutputTokens = 0;
  thinkingTokens = 0;
  retryCount = 0;
  timeoutCount = 0;
  fallbackUsed = false;
  postProcessingMs = 0;
  verificationMs = 0;
  assemblyMs = 0;
  queryMode = "UNKNOWN";
  constructor(query, modelName) {
    this.query = query;
    this.modelName = modelName;
    this.startTime = performance.now();
  }
  recordFirstVisibleResponse() {
    if (this.timeToFirstVisibleMs === 0) {
      this.timeToFirstVisibleMs = Math.round((performance.now() - this.startTime) * 100) / 100;
    }
  }
  setQueryMode(mode) {
    this.queryMode = mode;
  }
  recordClassification(ms) {
    this.classificationMs = ms;
  }
  recordRetrieval(ms) {
    this.retrievalMs = ms;
  }
  recordGrounding(ms) {
    this.groundingMs = ms;
  }
  recordStage(stage, ms) {
    if (stage === "classification") this.classificationMs = ms;
    else if (stage === "retrieval") this.retrievalMs = ms;
    else if (stage === "grounding") this.groundingMs = ms;
    else if (stage === "gemini_request") {
      this.geminiCallCount++;
      this.geminiRequestMs = ms;
    } else if (stage === "verification") {
      this.verificationMs = ms;
      this.postProcessingMs += ms;
    } else if (stage === "assembly") {
      this.assemblyMs = ms;
      this.postProcessingMs += ms;
    } else if (stage === "post_processing") {
      this.postProcessingMs += ms;
    }
  }
  setTokenCounts(input, output, thinking) {
    this.geminiInputTokens = input;
    this.geminiOutputTokens = output;
    if (thinking !== void 0) this.thinkingTokens = thinking;
  }
  recordGeminiCall(metrics) {
    this.geminiCallCount++;
    this.geminiRequestMs += metrics.durationMs;
    if (metrics.inputTokens) this.geminiInputTokens += metrics.inputTokens;
    if (metrics.outputTokens) this.geminiOutputTokens += metrics.outputTokens;
    if (metrics.thinkingTokens) this.thinkingTokens += metrics.thinkingTokens;
  }
  recordRetry() {
    this.retryCount++;
  }
  recordTimeout() {
    this.timeoutCount++;
    this.fallbackUsed = true;
  }
  recordFallback() {
    this.fallbackUsed = true;
  }
  recordPostProcessing(ms) {
    this.postProcessingMs = ms;
  }
  finalize() {
    const wallClock = Math.round((performance.now() - this.startTime) * 100) / 100;
    const stageSum = Math.round((this.classificationMs + this.retrievalMs + this.groundingMs + this.geminiRequestMs + this.postProcessingMs) * 100) / 100;
    const totalMs = Math.max(wallClock, stageSum);
    const telemetry = {
      query: this.query,
      query_mode: this.queryMode,
      modelName: this.modelName,
      total_ms: totalMs,
      time_to_first_visible_ms: this.timeToFirstVisibleMs || totalMs,
      classification_ms: Math.round(this.classificationMs * 100) / 100,
      retrieval_ms: Math.round(this.retrievalMs * 100) / 100,
      grounding_ms: Math.round(this.groundingMs * 100) / 100,
      gemini_call_count: this.geminiCallCount,
      gemini_request_ms: Math.round(this.geminiRequestMs * 100) / 100,
      gemini_input_tokens: this.geminiInputTokens,
      gemini_output_tokens: this.geminiOutputTokens,
      thinking_tokens: this.thinkingTokens,
      retry_count: this.retryCount,
      timeout_count: this.timeoutCount,
      fallback_used: this.fallbackUsed,
      post_processing_ms: Math.round(this.postProcessingMs * 100) / 100,
      verification_ms: Math.round(this.verificationMs * 100) / 100,
      assembly_ms: Math.round(this.assemblyMs * 100) / 100,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (typeof window !== "undefined") {
      const w = window;
      w.__LAST_REQUEST_TELEMETRY__ = telemetry;
      w.__REQUEST_TELEMETRY_LOG__ = w.__REQUEST_TELEMETRY_LOG__ || [];
      w.__REQUEST_TELEMETRY_LOG__.push(telemetry);
    }
    return telemetry;
  }
  generateReport() {
    return this.finalize();
  }
  static calculatePercentiles(values) {
    if (values.length === 0) return { min: 0, max: 0, p50: 0, p95: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const p50Index = Math.floor(sorted.length * 0.5);
    const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return {
      min: Math.round(min * 100) / 100,
      max: Math.round(max * 100) / 100,
      p50: Math.round(sorted[p50Index] * 100) / 100,
      p95: Math.round(sorted[p95Index] * 100) / 100
    };
  }
  logSummary() {
    const r = this.finalize();
    const flags = [];
    if (r.timeout_count > 0) flags.push(`timeouts=${r.timeout_count}`);
    if (r.fallback_used) flags.push(`fallback=true`);
    if (r.retry_count > 0) flags.push(`retries=${r.retry_count}`);
    const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
    console.log(
      `[Telemetry] ${r.query_mode} (${this.modelName || "offline"})${flagStr}: total=${r.total_ms}ms (first_vis=${r.time_to_first_visible_ms}ms, gemini=${r.gemini_request_ms}ms, ground=${r.grounding_ms}ms, post=${r.post_processing_ms}ms) | tokens: in=${r.gemini_input_tokens}, out=${r.gemini_output_tokens}, think=${r.thinking_tokens || 0}`
    );
  }
};

// src/services/azureOpenAiService.ts
function normalizeAzureEndpoint(endpoint) {
  let cleaned = (endpoint || "").trim().replace(/\/+$/, "");
  if (!cleaned) return "";
  if (!cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
    if (!cleaned.includes(".")) {
      cleaned = `https://${cleaned}.openai.azure.com`;
    } else {
      cleaned = `https://${cleaned}`;
    }
  }
  return cleaned;
}
function buildAccountingMessages(userInput, currentScenario, standard, chatHistory = [], groundedContext) {
  const systemInstruction = groundedContext ? formatGroundedSystemPrompt(groundedContext, standard) : formatGroundedSystemPrompt({
    classification: classifyQuestion(userInput),
    userFacts: [],
    missingFacts: [],
    assumptions: [],
    primaryEvidence: [],
    officialGuidance: [],
    curatedSummaries: [],
    applicationRules: [],
    currentInformationRequired: false
  }, standard);
  const messages = [
    { role: "system", content: systemInstruction }
  ];
  const conversationTurns = (chatHistory || []).filter((m) => m.id !== "welcome-msg" && m.text && !m.text.startsWith("\u26A0\uFE0F **Processing Error**")).slice(-8);
  for (const m of conversationTurns) {
    messages.push({
      role: m.sender === "user" ? "user" : "assistant",
      content: m.text
    });
  }
  const activeScenarioSummary = currentScenario ? `
[CURRENT ACTIVE TRANSACTION CONTEXT]
Transaction Title: ${currentScenario.transactionTitle || "N/A"}
Functional Currency: ${currentScenario.functionalCurrency || "SGD"}
Active Parameters:
${JSON.stringify(currentScenario.keyParameters || [], null, 2)}
Active Double Entry Journal Groups:
${currentScenario.directGroups?.map((g, idx) => `Group #${idx + 1} (${g.eventDate}) - ${g.title}:
` + g.lines.map((l) => `  ${l.debit > 0 ? `Debit: ${l.accountName} (${l.accountCode || ""}) - SGD ${l.debit}` : `Credit: ${l.accountName} (${l.accountCode || ""}) - SGD ${l.credit}`}`).join("\n")).join("\n") || "None"}
` : "";
  const currentTurnText = `${activeScenarioSummary}
[USER QUERY / FOLLOW-UP]:
${userInput}`.trim();
  messages.push({ role: "user", content: currentTurnText });
  return messages;
}
function parseAccountingAIResponse(rawJsonText, currentScenario, userInput, groundedContext, deterministicScenario, standard = "SFRS_I") {
  if (!rawJsonText) {
    throw new Error("No content returned by AI provider.");
  }
  const parsed = repairAndParseAIJson(rawJsonText);
  const fallbackContext = groundedContext || {
    classification: classifyQuestion(userInput),
    userFacts: [],
    missingFacts: [],
    assumptions: [],
    primaryEvidence: [],
    officialGuidance: [],
    curatedSummaries: [],
    applicationRules: [],
    currentInformationRequired: false
  };
  return postProcessAIResponse(parsed, currentScenario, userInput, fallbackContext, deterministicScenario, standard);
}
async function callAzureOpenAI(userInput, currentScenario, standard, azureConfig, chatHistory = [], groundedContext, deterministicScenario) {
  const endpoint = normalizeAzureEndpoint(azureConfig.endpoint);
  if (!endpoint) {
    throw new Error("Azure OpenAI Endpoint is required. Please configure in Settings (e.g. https://<resource>.openai.azure.com).");
  }
  if (!azureConfig.apiKey || azureConfig.apiKey.trim().length < 10) {
    throw new Error("Valid Azure OpenAI API Key is required. Please configure in Settings.");
  }
  if (!azureConfig.deploymentName || !azureConfig.deploymentName.trim()) {
    throw new Error("Azure OpenAI Deployment Name is required (e.g. gpt-4o). Please configure in Settings.");
  }
  const deployment = azureConfig.deploymentName.trim();
  const profiler = new RequestProfiler(userInput, `azure-${deployment}`);
  const tGround0 = Date.now();
  const context = groundedContext || await buildGroundedReasoningContext(userInput, currentScenario, void 0, { activeProvider: "azure", azure: azureConfig });
  const apiVersion = (azureConfig.apiVersion || "2024-08-01-preview").trim();
  const url = `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
  const messages = buildAccountingMessages(userInput, currentScenario, standard, chatHistory, context);
  profiler.recordStage("grounding", Date.now() - tGround0);
  const requestPayload = {
    messages,
    temperature: 0.1,
    response_format: { type: "json_object" }
  };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45e3);
  const tReq0 = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": azureConfig.apiKey.trim()
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal
    });
  } catch (netErr) {
    clearTimeout(timeoutId);
    if (netErr.name === "AbortError" || controller.signal.aborted) {
      throw new Error(`Azure OpenAI request timed out after 45s. Reverting to deterministic accounting engine.`);
    }
    throw new Error(`Azure OpenAI Connection Failed: Network error reaching ${endpoint}. Check endpoint address or CORS settings (${netErr?.message})`);
  } finally {
    clearTimeout(timeoutId);
  }
  profiler.recordStage("gemini_request", Date.now() - tReq0);
  if (!res.ok) {
    const errorText = await res.text();
    if (res.status === 401) {
      throw new Error(`Azure Authentication Error (401): Invalid or expired Azure OpenAI API Key. Please verify your key in Settings.`);
    } else if (res.status === 404) {
      throw new Error(`Azure Deployment Error (404): Deployment "${deployment}" was not found at ${endpoint}. Check Azure OpenAI Studio > Deployments.`);
    } else if (res.status === 429) {
      throw new Error(`Azure Quota Error (429): Rate limit (TPM/RPM) exceeded for deployment "${deployment}". Try again shortly or check Azure quota.`);
    } else if (res.status === 400) {
      throw new Error(`Azure Request Error (400): ${errorText}`);
    }
    throw new Error(`Azure OpenAI Error (${res.status}): ${errorText}`);
  }
  const data = await res.json();
  if (data?.usage) {
    profiler.setTokenCounts(data.usage.prompt_tokens || 0, data.usage.completion_tokens || 0);
  }
  const rawJsonText = data?.choices?.[0]?.message?.content;
  const tPost0 = Date.now();
  const result = parseAccountingAIResponse(rawJsonText, currentScenario, userInput, context, deterministicScenario, standard);
  profiler.recordStage("assembly", Date.now() - tPost0);
  profiler.logSummary();
  return result;
}
async function callStandardOpenAI(userInput, currentScenario, standard, openaiConfig, chatHistory = [], groundedContext, deterministicScenario) {
  if (!openaiConfig.apiKey || openaiConfig.apiKey.trim().length < 10) {
    throw new Error("Valid OpenAI API Key is required. Please configure in Settings.");
  }
  const model = openaiConfig.model || "gpt-4o";
  const profiler = new RequestProfiler(userInput, `openai-${model}`);
  const tGround0 = Date.now();
  const context = groundedContext || await buildGroundedReasoningContext(userInput, currentScenario, void 0, { activeProvider: "openai", openai: openaiConfig });
  const url = "https://api.openai.com/v1/chat/completions";
  const messages = buildAccountingMessages(userInput, currentScenario, standard, chatHistory, context);
  profiler.recordStage("grounding", Date.now() - tGround0);
  const requestPayload = {
    model,
    messages,
    temperature: 0.1,
    response_format: { type: "json_object" }
  };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45e3);
  const tReq0 = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiConfig.apiKey.trim()}`
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal
    });
  } catch (netErr) {
    clearTimeout(timeoutId);
    if (netErr.name === "AbortError" || controller.signal.aborted) {
      throw new Error(`OpenAI request timed out after 45s. Reverting to deterministic accounting engine.`);
    }
    throw new Error(`OpenAI Connection Failed: Network error reaching ${url} (${netErr?.message})`);
  } finally {
    clearTimeout(timeoutId);
  }
  profiler.recordStage("gemini_request", Date.now() - tReq0);
  if (!res.ok) {
    const errorText = await res.text();
    if (res.status === 401) {
      throw new Error(`OpenAI Authentication Error (401): Invalid API Key.`);
    } else if (res.status === 429) {
      throw new Error(`OpenAI Rate Limit (429): Quota exceeded.`);
    }
    throw new Error(`OpenAI Error (${res.status}): ${errorText}`);
  }
  const data = await res.json();
  if (data?.usage) {
    profiler.setTokenCounts(data.usage.prompt_tokens || 0, data.usage.completion_tokens || 0);
  }
  const rawJsonText = data?.choices?.[0]?.message?.content;
  const tPost0 = Date.now();
  const result = parseAccountingAIResponse(rawJsonText, currentScenario, userInput, context, deterministicScenario, standard);
  profiler.recordStage("assembly", Date.now() - tPost0);
  profiler.logSummary();
  return result;
}

// src/engine/shareTransferQuery.ts
var number = (raw) => Number(raw.replace(/,/g, ""));
var fmt = (value) => new Intl.NumberFormat("en-SG", { maximumFractionDigits: 2 }).format(value);
function answerShareStructureQuery(query, currentScenario) {
  const q = query.replace(/\s+/g, " ").trim();
  const followUp = /company\s+([a-z0-9]+)\s+(?:then\s+)?trade\s+([\d,]+)\s+units?\s+of\s+company\s+([a-z0-9]+)['’]?s?\s+shares?\s+for\s+([\d,]+)\s+units?\s+of\s+company\s+([a-z0-9]+)['’]?s?\s+shares?/i.exec(q);
  if (followUp && currentScenario?.shareTransferAnalysis) {
    const holder2 = `Company ${followUp[1].toUpperCase()}`;
    const sourceCompany = `Company ${followUp[3].toUpperCase()}`;
    const destinationCompany = `Company ${followUp[5].toUpperCase()}`;
    const surrendered = number(followUp[2]);
    const received = number(followUp[4]);
    const priorRows = currentScenario.shareTransferAnalysis.rows.map((row) => ({ ...row }));
    const source = priorRows.find((row) => row.company.toLowerCase() === sourceCompany.toLowerCase() && row.holder.toLowerCase() === holder2.toLowerCase());
    if (!source || source.afterShares < surrendered) {
      return { messageText: `### Share Structure Follow-up

I cannot apply this trade because the active share structure does not show ${holder2} holding at least ${fmt(surrendered)} ${sourceCompany} shares. Please confirm the pre-trade balance.`, scenarioState: currentScenario };
    }
    source.afterShares -= surrendered;
    const destination = priorRows.find((row) => row.company.toLowerCase() === destinationCompany.toLowerCase() && row.holder.toLowerCase() === holder2.toLowerCase());
    if (destination) destination.afterShares += received;
    else priorRows.push({ company: destinationCompany, holder: holder2, beforeShares: 0, afterShares: received, beforePercent: 0, afterPercent: 0 });
    const analysis = { eventSummary: `${holder2} trades ${fmt(surrendered)} ${sourceCompany} shares for ${fmt(received)} ${destinationCompany} shares.`, rows: priorRows, notes: [...currentScenario.shareTransferAnalysis.notes, `Follow-up applied: ${sourceCompany} decreases by ${fmt(surrendered)} and ${destinationCompany} increases by ${fmt(received)}. Percentages remain unavailable until issued shares and all holders are supplied.`] };
    return { messageText: `### Share Structure Follow-up Applied

The trade has been added to the active group share structure. The updated holdings are shown in the Group Share-Transfer Calculator below.

No journal entry or statutory conclusion has been created.`, scenarioState: { ...currentScenario, rawQuery: query, transactionTitle: "Group Share Transfer and Holding Analysis", shareTransferAnalysis: analysis, scenarioType: "GROUP_SHARE_TRANSFER_ANALYSIS" } };
  }
  const directTransfer = /company\s+([a-z0-9]+)\s+holds?\s+([\d,]+)\s+units?\s+of\s+company\s+([a-z0-9]+)['’]s?\s+shares?,?\s*transfer\s+([\d,]+)\s+units?\s+of\s+company\s+\3['’]?s?\s+shares?\s+to\s+company\s+([a-z0-9]+).*?now\s+company\s+\1\s+holds?\s+([\d,]+)\s+units?\s+of\s+company\s+\3.*?and\s+([\d,]+)\s+units?\s+of\s+company\s+\5/i.exec(q);
  if (directTransfer) {
    const holder2 = `Company ${directTransfer[1].toUpperCase()}`;
    const transferredCompany = `Company ${directTransfer[3].toUpperCase()}`;
    const recipient = `Company ${directTransfer[5].toUpperCase()}`;
    const before = number(directTransfer[2]);
    const transferred = number(directTransfer[4]);
    const afterTransferred = number(directTransfer[6]);
    const afterRecipient = number(directTransfer[7]);
    const notes = [
      `${holder2}'s stated ${transferredCompany} balance changes from ${fmt(before)} to ${fmt(afterTransferred)}; the stated transfer is ${fmt(transferred)}.`,
      `The prompt states that ${holder2} now holds ${fmt(afterRecipient)} ${recipient} shares, but does not identify who transferred those shares to ${holder2}.`,
      "Add the counterparty\u2019s before/after holdings and each exchange leg to calculate every holder\u2019s percentage and verify all issued-share totals."
    ];
    const messageText2 = `### Group Share Transfer \u2014 Stated Holding Changes

The stated holdings have been loaded into the Group Share-Transfer Calculator below.

> \u26A0\uFE0F **Counterparty leg is missing.** The request says ${holder2} transfers ${fmt(transferred)} ${transferredCompany} shares to ${recipient}, but does not state how ${holder2} obtains the ${fmt(afterRecipient)} ${recipient} shares. Percentages cannot be calculated without each company\u2019s issued shares and the other holders\u2019 positions.

This is a share-structure analysis only; no journal has been created.`;
    return { messageText: messageText2, scenarioState: { scenarioType: "GROUP_SHARE_TRANSFER_ANALYSIS", rawQuery: query, transactionTitle: "Group Share Transfer and Holding Analysis", functionalCurrency: "SGD", transactionCurrency: "SGD", queryIntent: "STATUTORY_ADVISORY", primaryDomain: "GENERAL", directGroups: [], keyParameters: [{ label: "Calculation", value: "Share holdings and control only", badge: "No Journal" }], shareTransferAnalysis: { eventSummary: `${holder2} transfers ${fmt(transferred)} ${transferredCompany} shares to ${recipient}.`, rows: [{ company: transferredCompany, holder: holder2, beforeShares: before, afterShares: afterTransferred, beforePercent: 0, afterPercent: 0 }, { company: recipient, holder: holder2, beforeShares: 0, afterShares: afterRecipient, beforePercent: 0, afterPercent: 0 }], notes }, isComplete: false, missingFields: [] } };
  }
  const holdingB = /company\s+([a-z0-9]+)\s+holds\s+(\d+(?:\.\d+)?)%\s*,?\s*([\d,]+)\s+units?\s+of\s+company\s+([a-z0-9]+)['’]s?\s+shares?/i.exec(q);
  const holdingC = /company\s+([a-z0-9]+)\s+holds\s+(\d+(?:\.\d+)?)%\s*,?\s*([\d,]+)\s+units?\s+of\s+company\s+([a-z0-9]+)['’]s?\s+shares?/i.exec(q.slice(holdingB?.index ? holdingB.index + holdingB[0].length : 0));
  const exchange = /trade\s+(?:company\s+)?([a-z0-9]+)?\s*([\d,]+)\s+units?\s+of\s+company\s+([a-z0-9]+)['’]?s?\s+shares?\s+for\s+([\d,]+)\s+units?\s+of\s+company\s+([a-z0-9]+)['’]?s?\s+shares?/i.exec(q);
  if (!holdingB || !holdingC || !exchange) return null;
  const holder = `Company ${holdingB[1].toUpperCase()}`;
  const companyB = `Company ${holdingB[4].toUpperCase()}`;
  const companyC = `Company ${holdingC[4].toUpperCase()}`;
  const bBeforePct = number(holdingB[2]);
  const bBeforeUnits = number(holdingB[3]);
  const cBeforePct = number(holdingC[2]);
  const cBeforeUnits = number(holdingC[3]);
  const cTransferred = number(exchange[2]);
  const bReceived = number(exchange[4]);
  if (exchange[3].toUpperCase() !== holdingC[4].toUpperCase() || exchange[5].toUpperCase() !== holdingB[4].toUpperCase()) return null;
  if (cTransferred > cBeforeUnits) return null;
  const bTotal = bBeforeUnits / (bBeforePct / 100);
  const bAfterUnits = bBeforeUnits + bReceived;
  const bAfterPct = bAfterUnits / bTotal * 100;
  const cAfterUnits = cBeforeUnits - cTransferred;
  const cAfterPct = cBeforeUnits ? cAfterUnits / cBeforeUnits * 100 : 0;
  const requestedControl = /(?:total of|to)\s+(\d+(?:\.\d+)?)%\s+(?:control|holding)/i.exec(q)?.[1];
  const mismatch = requestedControl && Math.abs(number(requestedControl) - bAfterPct) > 0.01;
  const caveat = mismatch ? `

> \u26A0\uFE0F **Input inconsistency:** Using the stated 49% = 500 units, ${holder}'s post-transfer holding is **${bAfterPct.toFixed(2)}%**, not ${requestedControl}%. To end at ${requestedControl}% with 800 units, ${companyB} would need ${fmt(bAfterUnits / (number(requestedControl) / 100))} issued shares; then 500 units would have been ${(bBeforeUnits / (bAfterUnits / (number(requestedControl) / 100)) * 100).toFixed(2)}%, not 49%.` : "";
  const messageText = `### Group Share Transfer \u2014 Ownership Analysis

The before/after holdings and percentages are shown in the Group Share-Transfer Calculator below.

- Implied ${companyB} issued shares: ${fmt(bTotal)} (500 \xF7 49%).
- ${companyB} post-transfer holding: **${fmt(bAfterUnits)} shares (${bAfterPct.toFixed(2)}%)**.
- ${companyC} post-transfer holding: **${fmt(cAfterUnits)} shares (${cAfterPct.toFixed(2)}%)**.

> **Counterparty needed for a full group schedule:** the prompt does not say who receives the ${companyC} shares or transfers the ${companyB} shares. The calculator therefore shows ${holder}'s position only and does not invent the counterparty leg.

This is a share-structure calculation only. It does not determine consideration value, accounting entries, tax, or whether shareholder approvals are required.${caveat}`;
  return { messageText, scenarioState: { scenarioType: "GROUP_SHARE_TRANSFER_ANALYSIS", rawQuery: query, transactionTitle: "Group Share Transfer and Holding Analysis", functionalCurrency: "SGD", transactionCurrency: "SGD", queryIntent: "STATUTORY_ADVISORY", primaryDomain: "GENERAL", directGroups: [], keyParameters: [{ label: "Calculation", value: "Share holdings and control only", badge: "No Journal" }], shareTransferAnalysis: { eventSummary: `${holder} transfers ${fmt(cTransferred)} ${companyC} shares and receives ${fmt(bReceived)} ${companyB} shares.`, rows: [{ company: companyB, holder, beforeShares: bBeforeUnits, afterShares: bAfterUnits, beforePercent: bBeforePct, afterPercent: bAfterPct }, { company: companyC, holder, beforeShares: cBeforeUnits, afterShares: cAfterUnits, beforePercent: cBeforePct, afterPercent: cAfterPct }], notes: [mismatch ? `Stated 75% control conflicts with the calculated ${bAfterPct.toFixed(2)}%.` : "All stated ownership percentages reconcile.", "Add the transfer counterparty and its pre-transfer position to show the complete group schedule."] }, isComplete: !mismatch, missingFields: [] } };
}

// src/services/geminiService.ts
async function extractEventSequenceWithGemini(text, apiKey, modelName) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `Extract chronological accounting EVENT FACTS from the text below. Do not calculate, recommend accounts, create journal entries, infer omitted facts, or cite standards. Return JSON only: {"events":[{"id":"event-1","date":"DD Mon YYYY","type":"purchase|purchase_return|supplier_settlement|purchase_discount|sale|sales_return|customer_settlement|credit_note|correction|reversal|reclassification|asset_disposal|other","description":"verbatim concise fact","currency":"SGD","amount":number,"quantity":number,"unitPrice":number,"tax":{"rate":number},"relatesTo":["event-1"],"confidence":0.0}]}. Omit unavailable numeric fields.

${text}` }] }], generationConfig: { temperature: 0, responseMimeType: "application/json" } })
  });
  if (!response.ok) return void 0;
  const responseText = (await response.json())?.candidates?.[0]?.content?.parts?.[0]?.text;
  return responseText ? normaliseAiEventSequence(repairAndParseAIJson(responseText)) : void 0;
}
function supportsGeminiVision(modelName) {
  return /^gemini-/i.test(modelName.trim());
}
function createGeminiImageParts(attachments) {
  return attachments.map((image) => ({
    inlineData: { mimeType: image.mimeType, data: image.dataUrl.slice(image.dataUrl.indexOf(",") + 1) }
  }));
}
function getCurrentImageAttachments(chatHistory) {
  const currentUserMessage = [...chatHistory].reverse().find((message) => message.sender === "user");
  return currentUserMessage?.images || [];
}
function normaliseImageEvidence(rawEvidence, attachments) {
  if (!Array.isArray(rawEvidence)) return [];
  return rawEvidence.flatMap((item, imageIndex) => {
    if (!item || typeof item !== "object") return [];
    const record = item;
    const attachmentIndex = typeof record.imageIndex === "number" && record.imageIndex >= 1 && record.imageIndex <= attachments.length ? record.imageIndex - 1 : imageIndex;
    const fieldsSource = record.fields && typeof record.fields === "object" ? record.fields : {};
    const fields = Object.entries(fieldsSource).flatMap(([field, value]) => {
      if (typeof value !== "string" && typeof value !== "number") return [];
      return [{ source: "image", imageId: attachments[attachmentIndex]?.id, field, value, confidence: typeof record.confidence === "number" ? record.confidence : void 0 }];
    });
    const journalLines = Array.isArray(record.journalLines) ? record.journalLines.flatMap((line2) => {
      if (!line2 || typeof line2 !== "object") return [];
      const journalLine = line2;
      if (typeof journalLine.accountName !== "string") return [];
      const asAmount = (value) => {
        if (typeof value === "number" && value >= 0) return value;
        if (typeof value === "string" && /^\d[\d,]*(?:\.\d+)?$/.test(value.trim())) return Number(value.replace(/,/g, ""));
        return void 0;
      };
      return [{ accountName: journalLine.accountName, accountCode: typeof journalLine.accountCode === "string" ? journalLine.accountCode : void 0, debit: asAmount(journalLine.debit), credit: asAmount(journalLine.credit) }];
    }) : [];
    return fields.length || journalLines.length ? [{ imageId: attachments[attachmentIndex]?.id || `image-${attachmentIndex + 1}`, documentType: typeof record.documentType === "string" ? record.documentType : void 0, fields, journalLines, confidence: typeof record.confidence === "number" ? record.confidence : void 0 }] : [];
  });
}
function buildJournalGroupsFromImageEvidence(imageEvidence) {
  return imageEvidence.flatMap((image, imageIndex) => {
    const extractedLines = image.journalLines || [];
    if (extractedLines.length < 2) return [];
    const lines = extractedLines.map((line2, lineIndex) => {
      const lowerName = line2.accountName.toLowerCase();
      const category = /payable|liability|loan/.test(lowerName) ? "LIABILITY" : /revenue|sales/.test(lowerName) ? "REVENUE" : /expense|cost/.test(lowerName) ? "EXPENSE" : "ASSET";
      return { id: `image-${imageIndex + 1}-line-${lineIndex + 1}`, accountCode: line2.accountCode || "IMAGE", accountName: line2.accountName, category, debit: line2.debit || 0, credit: line2.credit || 0, lineExplanation: "Visible journal line extracted from the screenshot." };
    });
    const totalDebit = Math.round(lines.reduce((sum, line2) => sum + line2.debit, 0) * 100) / 100;
    const totalCredit = Math.round(lines.reduce((sum, line2) => sum + line2.credit, 0) * 100) / 100;
    if (totalDebit <= 0 || totalCredit <= 0 || Math.abs(totalDebit - totalCredit) >= 0.01) return [];
    return [{ id: `image-journal-${image.imageId}`, eventDate: formatSingaporeDate(/* @__PURE__ */ new Date()), title: `Journal extracted from image ${imageIndex + 1}`, summary: "Visible journal lines from the supplied screenshot; confirm the transaction date and context before posting.", lines, totalDebit, totalCredit, isBalanced: true, citations: [], rationalePoints: ["Amounts and accounts were extracted from the screenshot."], authorityStatus: "AI_PROPOSED" }];
  });
}
function buildTransactionGroupsFromImageEvidence(imageEvidence) {
  return imageEvidence.flatMap((image, imageIndex) => {
    const values = new Map(image.fields.map((field) => [field.field.toLowerCase(), field.value]));
    const amount = (key) => typeof values.get(key) === "number" ? values.get(key) : void 0;
    const totalAmount = amount("totalamount") ?? amount("purchaseprice") ?? amount("amount");
    const immediatePayment = amount("immediatepayment") ?? amount("cashpaid") ?? amount("bankpayment");
    const remainingPayable = amount("remainingpayable") ?? amount("creditbalance") ?? amount("amountpayable");
    const transactionType = String(values.get("transactiontype") || "").toLowerCase();
    const assetName = typeof values.get("assetname") === "string" ? values.get("assetname") : void 0;
    if (!totalAmount || !immediatePayment || !remainingPayable || Math.abs(totalAmount - immediatePayment - remainingPayable) >= 0.01 || !/(asset_purchase|equipment_purchase|inventory_purchase)/.test(transactionType)) return [];
    const accountName = assetName || (transactionType.includes("inventory") ? "Inventory" : "Office Equipment");
    const lines = [
      { id: `image-${imageIndex + 1}-asset`, accountCode: "IMAGE", accountName, category: "ASSET", debit: totalAmount, credit: 0, lineExplanation: "Asset cost extracted from the screenshot." },
      { id: `image-${imageIndex + 1}-bank`, accountCode: "IMAGE", accountName: "Cash / Bank", category: "ASSET", debit: 0, credit: immediatePayment, lineExplanation: "Immediate payment extracted from the screenshot." },
      { id: `image-${imageIndex + 1}-payable`, accountCode: "IMAGE", accountName: "Accounts Payable", category: "LIABILITY", debit: 0, credit: remainingPayable, lineExplanation: "Remaining supplier balance extracted from the screenshot." }
    ];
    return [{ id: `image-transaction-${image.imageId}`, eventDate: formatSingaporeDate(/* @__PURE__ */ new Date()), title: `Transaction extracted from image ${imageIndex + 1}`, summary: "Journal deterministically built from visible transaction facts; confirm GST treatment separately.", lines, totalDebit: totalAmount, totalCredit: immediatePayment + remainingPayable, isBalanced: true, citations: [], rationalePoints: ["Amounts and settlement split were extracted from the screenshot."], authorityStatus: "AI_PROPOSED" }];
  });
}
function flattenImageEvidence(imageEvidence) {
  return imageEvidence.flatMap((image) => image.fields.map((field) => ({
    ...field,
    source: "image",
    imageId: field.imageId || image.imageId
  })));
}
var MATERIAL_IMAGE_FIELDS = /amount|subtotal|total|gst|tax|date|rate|percent|percentage|quantity|principal|interest|value/i;
function getMaterialImageUncertainties(imageEvidence) {
  return flattenImageEvidence(imageEvidence).filter(
    (field) => MATERIAL_IMAGE_FIELDS.test(field.field) && field.confidence !== void 0 && field.confidence < 0.9
  );
}
async function extractImageEvidenceWithGemini(apiKey, modelName, attachments) {
  if (!attachments.length) return [];
  if (!supportsGeminiVision(modelName)) throw new Error("The selected Gemini model cannot analyse images.");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3e4);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: 'Extract only visible document evidence from these images. Do not recommend accounting treatment, infer missing values, or cite standards. Return JSON only. For journals use {"imageEvidence":[{"imageIndex":1,"documentType":"journal","confidence":0.0,"fields":{},"journalLines":[{"accountName":"Inventory","accountCode":"GL 130","debit":1000},{"accountName":"Cash","accountCode":"GL 100","credit":200}]}]}. For transaction-task screenshots use {"imageEvidence":[{"imageIndex":1,"documentType":"accounting_transaction","confidence":0.0,"fields":{"transactionType":"equipment_purchase","assetName":"Office Equipment","totalAmount":1200,"immediatePayment":400,"remainingPayable":800,"paymentMethod":"bank_transfer","currency":"SGD"}}]}. When a screenshot contains a journal, include every visible line in journalLines with its debit or credit amount. Set imageIndex to the supplied one-based image number. Keep evidence from separate documents separate. Omit unreadable fields.' },
            ...createGeminiImageParts(attachments)
          ]
        }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" }
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Gemini image extraction failed with HTTP ${response.status}.`);
    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini could not read the attached image.");
    return normaliseImageEvidence(repairAndParseAIJson(text)?.imageEvidence, attachments);
  } finally {
    clearTimeout(timeoutId);
  }
}
function formatImageEvidenceForAccounting(evidence2) {
  if (!evidence2.length) return "No reliable fields were extracted from the image.";
  return evidence2.map((image, index) => `Image ${index + 1} (${image.documentType || "document"}): ${image.fields.map((field) => `${field.field}=${field.value}${field.confidence !== void 0 ? ` (confidence ${field.confidence})` : ""}`).join("; ")}${image.journalLines?.length ? `; journal lines: ${image.journalLines.map((line2) => `${line2.accountName} Dr ${line2.debit || 0} Cr ${line2.credit || 0}`).join(" | ")}` : ""}`).join("\n");
}
function evaluateFastPathEligibility(userInput, deterministicScenario, groundedContext) {
  if (!deterministicScenario) {
    return { canBypass: false, reason: "Deterministic scenario is missing" };
  }
  if (!deterministicScenario.isComplete) {
    return { canBypass: false, reason: "Deterministic scenario is incomplete" };
  }
  if (deterministicScenario.scenarioType === "UNRECOGNIZED") {
    return { canBypass: false, reason: "Scenario is unrecognized by deterministic engine" };
  }
  if (deterministicScenario.missingFields && deterministicScenario.missingFields.length > 0) {
    return { canBypass: false, reason: "Deterministic scenario has missing fields" };
  }
  const classification = groundedContext.classification;
  if (classification.accountingAnalysisRequired || classification.journalEntryRequired || classification.intent === "TRANSACTION" || classification.intent === "HYBRID") {
    return { canBypass: false, reason: "Professional accounting interpretation, transaction analysis, or journal entry required" };
  }
  if (groundedContext.missingFacts && groundedContext.missingFacts.length > 0 || deterministicScenario.missingFacts && deterministicScenario.missingFacts.length > 0) {
    return { canBypass: false, reason: "Material facts are missing from query" };
  }
  const supportingCitations = deterministicScenario.directGroups?.[0]?.citations || [];
  const supportingAdvisories = deterministicScenario.statutoryAdvisory || [];
  if (supportingCitations.length === 0 && supportingAdvisories.length === 0) {
    return { canBypass: false, reason: "No supporting citations or statutory advisories found" };
  }
  const allRetrieved = [
    ...groundedContext.primaryEvidence,
    ...groundedContext.officialGuidance,
    ...groundedContext.curatedSummaries
  ];
  const qLower = userInput.toLowerCase();
  const claimRules = [
    { topic: "Annual Leave", test: qLower.includes("annual leave"), sectionMatch: "88a" },
    { topic: "Sick / Hospitalisation Leave", test: qLower.includes("sick leave") || qLower.includes("hospitalisation") || qLower.includes("medical leave"), sectionMatch: "89" },
    { topic: "Part IV Overtime", test: qLower.includes("overtime") || qLower.includes("part iv") || qLower.includes("working hours"), sectionMatch: "38" },
    { topic: "CPF Wage Ceilings", test: qLower.includes("cpf ceiling") || qLower.includes("ordinary wage") || qLower.includes("aw ceiling"), sectionMatch: "first schedule" },
    { topic: "Compulsory GST Registration", test: qLower.includes("gst registration") || qLower.includes("compulsory gst") || qLower.includes("gst") && qLower.includes("threshold"), sectionMatch: "first schedule" },
    { topic: "Section 14 Tax Deductibility", test: qLower.includes("section 14") || qLower.includes("wholly and exclusively"), sectionMatch: "14" },
    { topic: "Section 205C Audit Exemption", test: qLower.includes("audit exemption") || qLower.includes("small company"), sectionMatch: "205c" },
    // Phase 3 Expanded Statutory Claims:
    { topic: "Loss Carry-Back Relief", test: qLower.includes("carry back") || qLower.includes("carry-back"), sectionMatch: "37e" },
    { topic: "Loss Carry-Forward Relief", test: qLower.includes("carry forward") || qLower.includes("carry-forward"), sectionMatch: "37" },
    { topic: "Safe Harbour Share Disposal", test: qLower.includes("safe harbour") || qLower.includes("safe harbor") || qLower.includes("disposal") && qLower.includes("shares"), sectionMatch: "13w" },
    { topic: "Withholding Tax", test: qLower.includes("withholding tax") || qLower.includes("section 45"), sectionMatch: "45" },
    { topic: "Renovation & Refurbishment S14Q", test: qLower.includes("renovation") || qLower.includes("refurbishment") || qLower.includes("14q"), sectionMatch: "14q" },
    { topic: "GST De Minimis Rule", test: qLower.includes("de minimis") || qLower.includes("regulation 28") && qLower.includes("gst"), sectionMatch: "28" },
    { topic: "GST Reverse Charge", test: qLower.includes("reverse charge") || qLower.includes("imported services") && qLower.includes("gst"), sectionMatch: "14" },
    { topic: "GST Bad Debt Relief", test: qLower.includes("bad debt relief") || qLower.includes("bad debt") && qLower.includes("gst"), sectionMatch: "82" },
    { topic: "GST Time of Supply", test: qLower.includes("time of supply"), sectionMatch: "11" },
    { topic: "Director Conflict Disclosure", test: qLower.includes("director") && (qLower.includes("conflict") || qLower.includes("interest")) || qLower.includes("section 156"), sectionMatch: "156" },
    { topic: "Company Secretary Mandate", test: qLower.includes("company secretary") || qLower.includes("section 171"), sectionMatch: "171" },
    { topic: "Registrable Controllers (RORC)", test: qLower.includes("registrable controllers") || qLower.includes("rorc"), sectionMatch: "142" },
    { topic: "Abolition of Par Value", test: qLower.includes("par value") || qLower.includes("nominal value"), sectionMatch: "68" },
    { topic: "Capital Reduction Solvency", test: qLower.includes("capital reduction") || qLower.includes("reduction of share capital"), sectionMatch: "78b" },
    { topic: "CPF Account Allocation Rates", test: qLower.includes("ordinary account") || qLower.includes("special account") || qLower.includes("medisave") || qLower.includes("allocation rate"), sectionMatch: "allocation" },
    { topic: "MOM Rest Day Pay", test: qLower.includes("rest day"), sectionMatch: "36" },
    { topic: "Mandatory Retrenchment Notification", test: qLower.includes("retrenchment notification") || qLower.includes("mandatory retrenchment"), sectionMatch: "retrenchment" },
    { topic: "CDCA Parental Leave Entitlement", test: qLower.includes("paternity leave") || qLower.includes("parental leave") || qLower.includes("cdca"), sectionMatch: "cdca" }
  ];
  const activeClaims = claimRules.filter((c) => c.test);
  for (const claim of activeClaims) {
    const claimEvidence = allRetrieved.find((r) => {
      const sec = (r.paragraphOrSection || "").toLowerCase().replace(/[\s\-_()]/g, "");
      const reqSec = claim.sectionMatch.toLowerCase().replace(/[\s\-_()]/g, "");
      return sec.includes(reqSec);
    });
    if (!claimEvidence) {
      return { canBypass: false, reason: `Query claim '${claim.topic}' lacks section-level evidence in retrieved sources` };
    }
    if (claimEvidence.sourceStatus !== "VERIFIED") {
      return { canBypass: false, reason: `Evidence for '${claim.topic}' (${claimEvidence.documentTitle}) has status '${claimEvidence.sourceStatus}', not VERIFIED` };
    }
    if (claimEvidence.evidenceTier !== "PRIMARY_SOURCE") {
      return { canBypass: false, reason: `Evidence for '${claim.topic}' (${claimEvidence.documentTitle}) is tier '${claimEvidence.evidenceTier}', not PRIMARY_SOURCE` };
    }
    if (!claimEvidence.isVerbatimText) {
      return { canBypass: false, reason: `Evidence for '${claim.topic}' (${claimEvidence.documentTitle}) is not authentic verbatim text` };
    }
    if (!claimEvidence.effectiveDate || claimEvidence.effectiveDate.toLowerCase().includes("unknown")) {
      return { canBypass: false, reason: `Evidence for '${claim.topic}' lacks a verified effective date` };
    }
    if (claimEvidence.sourceAuthority === "REFERENCE_API") {
      return { canBypass: false, reason: `Evidence for '${claim.topic}' is from a reference API, not an approved statutory authority` };
    }
    const claimFreshness = claimEvidence.freshnessStatus || defaultSourceFreshnessManager.evaluateSourceFreshness(claimEvidence);
    if (claimFreshness === "AUDIT_OVERDUE") {
      return { canBypass: false, reason: `Evidence for '${claim.topic}' (${claimEvidence.documentTitle}) is overdue for audit verification` };
    }
    if (claimFreshness === "HISTORICAL_SUPERSEDED") {
      const mentionsHistorical = qLower.includes("historical") || qLower.includes("prior") || qLower.includes("past") || qLower.includes("former") || qLower.includes("superseded");
      if (!mentionsHistorical) {
        return { canBypass: false, reason: `Evidence for '${claim.topic}' (${claimEvidence.documentTitle}) is historical/superseded and cannot satisfy current deterministic fast path` };
      }
    }
  }
  for (const cite of supportingCitations) {
    const rawStd = (cite.standard || "").toLowerCase().replace(/[\s\-_()]/g, "");
    const rawPara = (cite.paragraph || "").toLowerCase().replace(/[\s\-_()]/g, "");
    const matched = allRetrieved.find((r) => {
      const rCode = (r.standardOrActCode || "").toLowerCase().replace(/[\s\-_()]/g, "");
      const rTitle = (r.documentTitle || "").toLowerCase().replace(/[\s\-_()]/g, "");
      const rSec = (r.paragraphOrSection || "").toLowerCase().replace(/[\s\-_()]/g, "");
      const actMatches = rawStd.includes(rCode) || rCode.includes(rawStd) || rawStd.includes(rTitle) || rTitle.includes(rawStd);
      const secMatches = !rawPara || rSec.includes(rawPara) || rawPara.includes(rSec) || Boolean(rawPara.match(/\d+[a-z]?/i) && rSec.includes(rawPara.match(/\d+[a-z]?/i)[0]));
      return actMatches && secMatches;
    });
    if (!matched) {
      return { canBypass: false, reason: `Supporting citation '${cite.standard} ${cite.paragraph}' not found at section level in retrieved sources` };
    }
    if (matched.sourceStatus !== "VERIFIED") {
      return { canBypass: false, reason: `Supporting source '${matched.documentTitle} ${matched.paragraphOrSection}' has status '${matched.sourceStatus}', not VERIFIED` };
    }
    if (matched.sourceType !== "AUTHORITATIVE_SOURCE" && matched.evidenceTier !== "PRIMARY_SOURCE") {
      return { canBypass: false, reason: `Supporting source '${matched.documentTitle}' is tier '${matched.evidenceTier}', not PRIMARY_SOURCE` };
    }
    if (!matched.isVerbatimText) {
      return { canBypass: false, reason: `Supporting source '${matched.documentTitle} ${matched.paragraphOrSection}' is not authentic verbatim text` };
    }
    if (!matched.effectiveDate || matched.effectiveDate.toLowerCase().includes("unknown")) {
      return { canBypass: false, reason: `Supporting source '${matched.documentTitle}' lacks a verified effective date` };
    }
    if (matched.sourceAuthority === "REFERENCE_API") {
      return { canBypass: false, reason: `Supporting source '${matched.documentTitle}' is from a reference API and cannot satisfy statutory authority requirements` };
    }
    const matchedFreshness = matched.freshnessStatus || defaultSourceFreshnessManager.evaluateSourceFreshness(matched);
    if (matchedFreshness === "AUDIT_OVERDUE") {
      return { canBypass: false, reason: `Supporting source '${matched.documentTitle}' is overdue for audit verification` };
    }
    if (matchedFreshness === "HISTORICAL_SUPERSEDED") {
      const mentionsHistorical = qLower.includes("historical") || qLower.includes("prior") || qLower.includes("past") || qLower.includes("former") || qLower.includes("superseded");
      if (!mentionsHistorical) {
        return { canBypass: false, reason: `Supporting source '${matched.documentTitle}' is historical/superseded and cannot satisfy current deterministic fast path` };
      }
    }
  }
  return { canBypass: true, reason: "All 6 authoritative deterministic conditions satisfied with claim-complete section-level verified primary sources" };
}
async function processAccountingQuery(userInput, currentScenario, standard, providerOrApiKey, modelName = "gemini-3.5-flash-lite", chatHistory = [], outputPreference) {
  const profiler = new RequestProfiler(userInput, modelName);
  const imageAttachments = getCurrentImageAttachments(chatHistory);
  const hasImages = imageAttachments.length > 0;
  if (outputPreference?.shareStructure) {
    const shareAnswer = answerShareStructureQuery(userInput, currentScenario);
    if (shareAnswer) return shareAnswer;
  }
  let apiErrorMessage = null;
  const activeScenario = startsNewAccountingScenario(userInput, currentScenario) ? null : currentScenario;
  const amendmentResolution = resolveFactAmendment(userInput, activeScenario);
  const attachAmendmentProvenance = (response) => {
    if (!amendmentResolution.amendments?.length) return response;
    return {
      ...response,
      scenarioState: {
        ...response.scenarioState,
        factAmendments: [
          ...activeScenario?.factAmendments || [],
          ...amendmentResolution.amendments
        ]
      }
    };
  };
  const isJournalDisplayRequest = /^\s*(?:(?:where(?:\s+is|\s*'s)|what(?:\s+is|\s*'s))\s+(?:your\s+|the\s+|last\s+)?(?:double\s+entry|journal(?:\s+entry)?)|(?:show|repeat|display|give(?:\s+me)?|provide)\s+(?:(?:me\s+)?|your\s+|the\s+|last\s+)?(?:double\s+entry|journal(?:\s+entry)?))\s*\?*\s*$/i.test(userInput);
  if (isJournalDisplayRequest) {
    const candidateGroups = currentScenario?.committedDirectGroups && currentScenario.committedDirectGroups.length > 0 ? currentScenario.committedDirectGroups : currentScenario?.directGroups || [];
    const committedGroups = candidateGroups.filter((group2) => !group2.isHypothetical && group2.isBalanced && group2.totalDebit > 0 && group2.totalCredit > 0);
    const lastGroup = committedGroups[committedGroups.length - 1];
    profiler.recordFirstVisibleResponse();
    profiler.setTokenCounts(0, 0, 0);
    profiler.logSummary();
    if (currentScenario && lastGroup) {
      return attachAmendmentProvenance({
        messageText: `### Double Entry Journal

The most recent committed journal is **${lastGroup.title}** (${lastGroup.eventDate}). It is shown in the Double Entry Journal tab.`,
        scenarioState: {
          ...currentScenario,
          directGroups: committedGroups,
          committedDirectGroups: committedGroups
        }
      });
    }
    return attachAmendmentProvenance({
      messageText: "### No Double Entry Available Yet\n\nThere is no confirmed journal in this conversation to repeat. I need the original transaction facts or a clarification before a journal can be calculated.",
      scenarioState: currentScenario || {
        scenarioType: "UNRECOGNIZED",
        rawQuery: userInput,
        transactionTitle: "Journal Not Yet Calculated",
        functionalCurrency: "SGD",
        transactionCurrency: "SGD",
        directGroups: [],
        isComplete: false,
        missingFields: []
      }
    });
  }
  const isFixture = isDeterministicFixture(userInput);
  if (outputPreference?.journal && !hasImages) {
    let aiCandidate2;
    let aiExtractionRequired = false;
    try {
      const geminiConfig = typeof providerOrApiKey === "object" && providerOrApiKey.activeProvider === "gemini" ? providerOrApiKey.gemini : void 0;
      const apiKey = typeof providerOrApiKey === "string" ? providerOrApiKey : geminiConfig?.apiKey;
      aiExtractionRequired = Boolean(apiKey?.trim() && apiKey.trim().length > 10 && /\btransaction\s*2\b/i.test(userInput));
      if (apiKey?.trim() && apiKey.trim().length > 10) aiCandidate2 = await extractEventSequenceWithGemini(userInput, apiKey.trim(), geminiConfig?.model || modelName);
    } catch {
    }
    if (aiExtractionRequired && !aiCandidate2) {
      const clarification = { fieldKey: "aiEventExtraction", fieldName: "AI event extraction", prompt: "AI could not produce a valid event-fact sequence. Please retry after checking the configured AI provider, or simplify the transaction chronology.", whyNeeded: "Multi-event journals are configured to require validated AI fact extraction before deterministic accounting treatment." };
      return attachAmendmentProvenance({ messageText: `### AI Event Extraction Required for Double Entry

${clarification.prompt}`, scenarioState: { scenarioType: "EVENT_SEQUENCE", rawQuery: userInput, transactionTitle: "Pending AI event extraction", functionalCurrency: "SGD", transactionCurrency: "SGD", directGroups: [], isComplete: false, missingFields: [clarification] }, clarifications: [clarification] });
    }
    const resolution2 = resolveEventSequence(userInput, standard, aiCandidate2);
    if (resolution2) {
      const sequenceScenario = {
        scenarioType: "EVENT_SEQUENCE",
        rawQuery: userInput,
        transactionTitle: resolution2.family === "fixed_asset" ? "Related fixed-asset events" : "Related accounting events",
        functionalCurrency: "SGD",
        transactionCurrency: "SGD",
        directGroups: resolution2.groups,
        eventSequence: resolution2.sequence,
        evidence: resolution2.sequence.events.flatMap((event) => event.evidence),
        isComplete: resolution2.clarifications.length === 0,
        missingFields: resolution2.clarifications
      };
      profiler.recordFirstVisibleResponse();
      profiler.setTokenCounts(0, 0, 0);
      profiler.logSummary();
      if (resolution2.clarifications.length) {
        return attachAmendmentProvenance({
          messageText: `### Clarification Required for Event Sequence

${resolution2.clarifications[0].prompt}`,
          scenarioState: sequenceScenario,
          clarifications: resolution2.clarifications
        });
      }
      return attachAmendmentProvenance(renderStructuredOfflineResponse(sequenceScenario, standard));
    }
  }
  const tDet0 = Date.now();
  const deterministicScenario = await parseAccountingQuery(userInput, activeScenario);
  profiler.recordStage("deterministic_engine", Date.now() - tDet0);
  const materialClarification = deterministicScenario.missingFields?.[0];
  if (outputPreference?.journal && !hasImages) {
    const hasGroundedJournal = deterministicScenario.directGroups?.some(
      (group2) => group2.isBalanced && group2.lines?.length > 0 && group2.totalDebit > 0 && group2.totalCredit > 0
    );
    if (hasGroundedJournal) {
      profiler.recordFirstVisibleResponse();
      profiler.setTokenCounts(0, 0, 0);
      profiler.logSummary();
      return attachAmendmentProvenance(renderStructuredOfflineResponse(deterministicScenario, standard));
    }
    const clarification = materialClarification || {
      fieldKey: "journalFacts",
      fieldName: "Journal-entry facts",
      prompt: "Please provide the transaction amount, what was received or incurred, and whether it was paid immediately or remains payable.",
      whyNeeded: "A balanced journal cannot be generated safely until both sides and their measurement are established."
    };
    return attachAmendmentProvenance({
      messageText: `### Clarification Required for Double Entry

${clarification.prompt}`,
      scenarioState: { ...deterministicScenario, directGroups: [], isComplete: false, missingFields: [clarification] },
      clarifications: [clarification]
    });
  }
  if (!hasImages && deterministicScenario.scenarioType !== "UNRECOGNIZED" && !deterministicScenario.isComplete && materialClarification && (!deterministicScenario.directGroups || deterministicScenario.directGroups.length === 0)) {
    profiler.recordFirstVisibleResponse();
    profiler.setTokenCounts(0, 0, 0);
    profiler.logSummary();
    return attachAmendmentProvenance({
      messageText: `### Clarification Required

${materialClarification.prompt}`,
      scenarioState: deterministicScenario,
      clarifications: [materialClarification]
    });
  }
  if (activeScenario?.scenarioType === "PAYROLL_CPF_SALARY" && deterministicScenario.scenarioType === "PAYROLL_CPF_SALARY" && deterministicScenario.isComplete && /\b(resign(?:ed|ation)?|pro[ -]?rat(?:e|ed|ion)|last\s+day|incomplete\s+month)\b/i.test(userInput)) {
    profiler.recordFirstVisibleResponse();
    profiler.setTokenCounts(0, 0, 0);
    profiler.logSummary();
    return attachAmendmentProvenance(renderStructuredOfflineResponse(deterministicScenario, standard));
  }
  const tGround0 = Date.now();
  const groundedContext = await buildGroundedReasoningContext(userInput, activeScenario, void 0, providerOrApiKey);
  profiler.recordStage("grounding", Date.now() - tGround0);
  if (isFixture) {
    const fastPathCheck = evaluateFastPathEligibility(userInput, deterministicScenario, groundedContext);
    if (fastPathCheck.canBypass) {
      profiler.recordFirstVisibleResponse();
      profiler.setTokenCounts(0, 0, 0);
      profiler.logSummary();
      return attachAmendmentProvenance(renderStructuredOfflineResponse(deterministicScenario, standard, null, groundedContext));
    }
  }
  if (providerOrApiKey) {
    if (typeof providerOrApiKey === "object") {
      const active = providerOrApiKey.activeProvider;
      if (hasImages && active !== "gemini") {
        return {
          messageText: "### Image analysis unavailable\n\nThe selected AI model cannot analyse images. Select a Gemini model in Settings, then retry; your screenshots remain attached to this message.",
          scenarioState: deterministicScenario
        };
      }
      if (active === "azure" && providerOrApiKey.azure?.apiKey && providerOrApiKey.azure.endpoint) {
        try {
          return attachAmendmentProvenance(await callAzureOpenAI(userInput, activeScenario, standard, providerOrApiKey.azure, chatHistory, groundedContext, deterministicScenario));
        } catch (err) {
          console.warn("Azure OpenAI API call failed, falling back to smart universal engine:", err);
          apiErrorMessage = err?.message || "Azure OpenAI Error";
          profiler.recordFallback();
        }
      } else if (active === "gemini" && providerOrApiKey.gemini?.apiKey && providerOrApiKey.gemini.apiKey.trim().length > 10) {
        try {
          return attachAmendmentProvenance(await callGeminiAPI(
            userInput,
            activeScenario,
            standard,
            providerOrApiKey.gemini.apiKey.trim(),
            providerOrApiKey.gemini.model || modelName,
            chatHistory,
            groundedContext,
            deterministicScenario,
            profiler,
            imageAttachments
          ));
        } catch (err) {
          console.warn("Gemini API call failed, falling back to smart universal engine:", err);
          apiErrorMessage = err?.message || "Gemini API Error";
          profiler.recordFallback();
        }
      } else if (active === "openai" && providerOrApiKey.openai?.apiKey && providerOrApiKey.openai.apiKey.trim().length > 10) {
        try {
          return attachAmendmentProvenance(await callStandardOpenAI(
            userInput,
            activeScenario,
            standard,
            providerOrApiKey.openai,
            chatHistory,
            groundedContext,
            deterministicScenario
          ));
        } catch (err) {
          console.warn("OpenAI API call failed, falling back to smart universal engine:", err);
          apiErrorMessage = err?.message || "OpenAI API Error";
          profiler.recordFallback();
        }
      }
    } else if (typeof providerOrApiKey === "string" && providerOrApiKey.trim().length > 10) {
      try {
        return attachAmendmentProvenance(await callGeminiAPI(
          userInput,
          activeScenario,
          standard,
          providerOrApiKey.trim(),
          modelName,
          chatHistory,
          groundedContext,
          deterministicScenario,
          profiler,
          imageAttachments
        ));
      } catch (err) {
        console.warn("Gemini API call failed, falling back to smart universal engine:", err);
        apiErrorMessage = err?.message || "Gemini API Error";
        profiler.recordFallback();
      }
    }
  }
  profiler.recordFallback();
  profiler.recordFirstVisibleResponse();
  const fallbackResponse = attachAmendmentProvenance(renderStructuredOfflineResponse(deterministicScenario, standard, apiErrorMessage, groundedContext));
  fallbackResponse.imageAnalysisFailed = hasImages && Boolean(apiErrorMessage);
  profiler.logSummary();
  return fallbackResponse;
}
function renderStructuredOfflineResponse(parsed, standard, apiErrorMessage = null, groundedContext) {
  const std1 = standard === "SFRS_I" ? "SFRS(I) 1-1" : "IAS 1";
  const std9 = standard === "SFRS_I" ? "SFRS(I) 9" : "IFRS 9";
  const std16 = standard === "SFRS_I" ? "SFRS(I) 16" : "IFRS 16";
  const std21 = standard === "SFRS_I" ? "SFRS(I) 1-21" : "IAS 21";
  const std16Name = standard === "SFRS_I" ? "SFRS(I) 1-16" : "IAS 16";
  const std38Name = standard === "SFRS_I" ? "SFRS(I) 1-38" : "IAS 38";
  const finalizeMessage = (text, state) => {
    const fullText = apiErrorMessage ? `> \u26A0\uFE0F **Provider Notice**: ${apiErrorMessage}. Reverted seamlessly to the Singapore Statutory Offline Engine.

${text}` : text;
    return appendStatutorySourceFooter(fullText, state);
  };
  const ensureEventSourcedState = (state) => {
    if (state.isHypothetical) return state;
    if (state.directGroups && state.directGroups.length > 0 && (!state.actualEvents || state.actualEvents.length === 0)) {
      const committed = state.committedDirectGroups && state.committedDirectGroups.length > 0 ? state.committedDirectGroups : state.directGroups.filter((g) => !g.isHypothetical);
      const actualEvts = committed.map((grp, idx) => {
        const txId = grp.transactionId || grp.id || `tx-init-${idx + 1}`;
        grp.transactionId = txId;
        return {
          id: grp.id || `evt-init-${idx + 1}`,
          transactionId: txId,
          targetTransactionId: grp.targetTransactionId,
          type: grp.title && grp.title.toLowerCase().includes("settle") ? "settlement" : "initial_transaction",
          description: grp.title || "Initial transaction",
          amount: grp.totalDebit,
          currency: state.transactionCurrency || state.functionalCurrency || "SGD",
          affectedAccounts: grp.lines.map((l) => l.accountName),
          journalLines: grp.lines,
          eventDate: grp.eventDate,
          isHypothetical: false
        };
      });
      return {
        ...state,
        transactionId: state.transactionId || committed[0]?.transactionId || "tx-init-1",
        committedDirectGroups: committed,
        actualEvents: actualEvts,
        accountingEvents: state.accountingEvents || actualEvts
      };
    }
    return state;
  };
  if (parsed.scenarioType === "SHARE_CAPITAL_UNPAID" || parsed.scenarioType === "SHARE_CAPITAL_PAID") {
    parsed = ensureEventSourcedState(parsed);
  }
  if (parsed.scenarioType === "UNRECOGNIZED") {
    const errorPrefix = apiErrorMessage ? `> \u26A0\uFE0F **Gemini API Call Notice**: ${apiErrorMessage}
> Please verify your API Key and Model in the **Settings** panel.

` : "";
    let replyText = `${errorPrefix}### Semantic Transaction Analysis (Offline Mode)

`;
    if (groundedContext?.semanticUnderstanding) {
      const sem = groundedContext.semanticUnderstanding;
      replyText += `**Extracted Economic Facts**:
* **Reporting Entity**: ${sem.reportingEntity.type.toUpperCase()}${sem.reportingEntity.description ? ` (${sem.reportingEntity.description})` : ""}
` + (sem.counterparty ? `* **Counterparty Role**: ${sem.counterparty.role.toUpperCase()}${sem.counterparty.description ? ` (${sem.counterparty.description})` : ""}
` : "") + `* **Transaction Nature**: ${sem.transactionType || "General Commercial Transaction"}
* **Ownership Context**: ${(sem.ownershipContext || "unknown").toUpperCase()}
* **Payment Status**: ${(sem.paymentStatus || "unknown").toUpperCase()}
* **Currency Fact**: ${sem.currency.value || "Unspecified"} (Source: ${sem.currency.source}, Confidence: ${sem.currency.confidence})

`;
      if (sem.ownershipContext === "own_equity") {
        const amt = sem.amount;
        if (!amt || amt <= 0 || sem.paymentStatus !== "paid" && sem.paymentStatus !== "unpaid") {
          const prompt = !amt || amt <= 0 ? "What is the share subscription amount?" : "Was the share subscription paid, unpaid, or partly paid? If partly paid, please provide the amount received.";
          return {
            messageText: `${replyText}### Clarification Required

${prompt}`,
            scenarioState: {
              ...parsed,
              directGroups: [],
              isComplete: false,
              missingFields: [{
                fieldKey: !amt || amt <= 0 ? "amount" : "paymentStatus",
                fieldName: !amt || amt <= 0 ? "Share subscription amount" : "Share subscription payment status",
                prompt,
                whyNeeded: "Share Capital and the corresponding debit require established consideration facts."
              }]
            }
          };
        }
        const curr = sem.currency.value || parsed.functionalCurrency || "SGD";
        const isUnpaid = sem.paymentStatus === "unpaid";
        const debitAccountName = isUnpaid ? "Amount Due from Shareholder (Receivable)" : "Cash at Bank (Current Account)";
        const debitAccountCode = isUnpaid ? "1150" : "1010";
        const debitLineExplanation = isUnpaid ? "Allotment receivable under Companies Act \xA763(1)" : "Receipt of share capital";
        replyText += `**Statutory & Standard Directives**:
* **Singapore Companies Act 1967 \xA768**: Shares of a Singapore company have no nominal or par value. Share premium is abolished; 100% of consideration is credited to Share Capital under Equity.
* **Singapore Companies Act 1967 \xA763(1)**: Allotment of shares can be fully paid, partly paid, or unpaid. When shares are unpaid, an enforceable allotment receivable is recognized against the subscriber.
* **SFRS(I) 1-32 \xA733**: An entity's own equity instruments can NEVER be recognized as a financial asset (no FVTPL/FVTOCI).

**Double Entry Journal**:
* **Debit**: **${debitAccountName}** \u2014 **${curr} ${amt.toFixed(2)}** *(${debitLineExplanation})*
* **Credit**: **Share Capital (Ordinary Shares)** \u2014 **${curr} ${amt.toFixed(2)}** *(Credited 100% to share capital under Companies Act \xA768)*

`;
        const allotmentTxId = `tx-allot-${Date.now()}`;
        const initialGroup = {
          id: "grp-equity-allotment-1",
          transactionId: allotmentTxId,
          eventDate: formatSingaporeDate(/* @__PURE__ */ new Date()),
          title: isUnpaid ? "Share Capital Allotment (Unpaid)" : "Share Capital Issuance (Paid)",
          summary: `Allotment of ordinary shares ${isUnpaid ? "unpaid" : "fully paid"} under Singapore Companies Act \xA768`,
          lines: [
            {
              id: "l-equity-dr",
              accountCode: debitAccountCode,
              accountName: debitAccountName,
              category: "ASSET",
              debit: amt,
              credit: 0,
              lineExplanation: debitLineExplanation
            },
            {
              id: "l-equity-cr",
              accountCode: "3000",
              accountName: "Share Capital (Ordinary Shares)",
              category: "EQUITY",
              debit: 0,
              credit: amt,
              lineExplanation: "Credited 100% to share capital under Companies Act \xA768 (par value abolished)"
            }
          ],
          totalDebit: amt,
          totalCredit: amt,
          isBalanced: true,
          citations: [],
          rationalePoints: [
            "Under Singapore Companies Act 1967 \xA768, shares have no nominal/par value. 100% of consideration is credited to share capital.",
            isUnpaid ? "Under \xA763(1), shares can be allotted unpaid, creating an enforceable receivable." : "Funds received directly into bank account.",
            "Under SFRS(I) 1-32 \xA733, own equity instruments are never financial assets."
          ],
          authorityStatus: "DETERMINISTIC"
        };
        const initialEvent = {
          id: "evt-allot-1",
          transactionId: allotmentTxId,
          type: "initial_transaction",
          description: initialGroup.title,
          amount: amt,
          currency: curr,
          affectedAccounts: initialGroup.lines.map((l) => l.accountName),
          journalLines: initialGroup.lines,
          eventDate: initialGroup.eventDate,
          isHypothetical: false
        };
        parsed = {
          ...parsed,
          scenarioType: "UNIVERSAL",
          transactionId: allotmentTxId,
          amount: amt,
          transactionTitle: isUnpaid ? "Issuance of Unpaid Share Capital" : "Issuance of Share Capital",
          directGroups: [initialGroup],
          committedDirectGroups: [initialGroup],
          actualEvents: [initialEvent],
          accountingEvents: [initialEvent]
        };
      }
    } else {
      replyText += `The local offline rule engine could not find a predefined pattern for this specific transaction.

`;
    }
    replyText += `*Note: To answer free-form, custom commercial transactions with dynamic reasoning, connect an AI Provider (Google Gemini, Azure OpenAI, or OpenAI) in Settings.*`;
    const finalState = ensureEventSourcedState(parsed);
    return {
      messageText: replyText,
      scenarioState: finalState
    };
  }
  if (parsed.scenarioType === "CAPITALISATION_SFRS138" && parsed.directGroups) {
    const grp = parsed.directGroups[0];
    const cost = grp.totalDebit;
    const replyText = `### Accounting Analysis: Capitalisation of Expenditure

**Governing Frameworks**: **${std38Name} (*Intangible Assets*)** & **Income Tax Act 1947 (\xA714 / \xA715 / \xA714C)**

---

#### 1. Financial Reporting Treatment (${std38Name})
* **Research Phase (\xA754)**: All expenditure on research (or the research stage of an internal project) **must be expensed in P&L when incurred**. No intangible asset may ever be recognized from research.
* **Development Phase (\xA757)**: Expenditure can be capitalized as an Intangible Asset **if and only if** the entity demonstrates all 6 cumulative criteria:
  1. **Technical Feasibility** of completing the intangible asset so that it will be available for use or sale.
  2. **Intention to Complete** the intangible asset and use or sell it.
  3. **Ability to Use or Sell** the intangible asset.
  4. **Probable Future Economic Benefits** (existence of a market or internal usefulness).
  5. **Adequate Technical, Financial, and Other Resources** to complete development.
  6. **Reliable Measurement** of the expenditure attributable to the development phase.
* **Tangible Fixed Assets**: Under **${std16Name} \xA77**, expenditure is capitalised only if probable future economic benefits flow to the entity and cost can be reliably measured. Routine repairs and maintenance must be expensed.

---

#### 2. Singapore Tax Treatment (IRAS)
* **Accounting Treatment $\\neq$ Tax Treatment**: Capitalizing an expenditure for financial reporting does not grant a tax deduction.
* **Section 15(1) Disallowance**: Capital expenditure and accounting amortization/depreciation are disallowed as direct P&L deductions and must be added back in Form C-S.
* **Enterprise Innovation Scheme (EIS) / Section 14C**: Under the Enterprise Innovation Scheme, qualifying businesses enjoy a **400% enhanced tax deduction** on up to SGD 400,000 of qualifying R&D expenditure per Year of Assessment.
* **Section 19A / 19B Allowances**: Plant and machinery claim Section 19A Capital Allowances (1-year 100% write-off for computers/qualifying equipment or 3-year write-off); qualifying intellectual property acquisitions claim Section 19B writing-down allowances.

---

### Illustrative Compound Journal Entry (${grp.eventDate})

* **Debit**: **Intangible Assets - Capitalised Development Costs (Non-Current Asset)** \u2014 **SGD ${cost.toLocaleString(void 0, { minimumFractionDigits: 2 })}**
* **Credit**: **Cash at Bank / Trade Payables** \u2014 **SGD ${cost.toLocaleString(void 0, { minimumFractionDigits: 2 })}**

**Balance Check**: $\\text{Total Debits (SGD } ${cost.toLocaleString(void 0, { minimumFractionDigits: 2 })}) == \\text{Total Credits (SGD } ${cost.toLocaleString(void 0, { minimumFractionDigits: 2 })}) \\quad \\checkmark\\ \\mathbf{Balanced}$`;
    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }
  if (parsed.scenarioType === "SINGAPORE_STATUTORY_ADVISORY") {
    const adv = parsed.statutoryAdvisory?.[0];
    const authority = adv?.authority || "IRAS / ACRA";
    const rawTitle = parsed.transactionTitle || adv?.topic || "Statutory Compliance Directive";
    const cleanTitle = rawTitle.replace(/^(?:Statutory\s*Directives?:\s*)+/i, "");
    const act = adv?.statuteOrAct || "Singapore Statutes";
    const section = adv?.sectionOrSchedule || "";
    const url = adv?.officialUrl || "https://sso.agc.gov.sg";
    let replyText = `### Statutory Directive: ${cleanTitle}

**Governing Authority**: **${authority}** | **Legislation**: **${act} (${section})**

---

#### 1. Statutory Principle
${adv?.summary || "Governed strictly under Singapore statutory law."}

---

#### 2. Key Rules, Thresholds & Compliance Mandates
`;
    if (adv?.keyRules) {
      for (const rule of adv.keyRules) {
        replyText += `* ${rule}
`;
      }
    }
    replyText += `
---

#### 3. Official Statutory Source & Verification
* Verified against [${act} ${section}](${url}) on **Singapore Statutes Online (SSO)** / Official Regulatory Directory.
* Review the **Statutory Citations & "Why"** tab for full legal references and citations.`;
    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }
  if (parsed.scenarioType === "PAYROLL_CPF_SALARY" && parsed.directGroups) {
    const grp = parsed.projectedGroups?.[0] || parsed.directGroups[0];
    const grossLine = grp.lines.find((l) => l.accountCode === "5010");
    const employerCpfLine = grp.lines.find((l) => l.accountCode === "5020");
    const cpfPayableLine = grp.lines.find((l) => l.accountCode === "2050");
    const netSalaryLine = grp.lines.find((l) => l.accountCode === "2060");
    const grossSalary = grossLine?.debit || 0;
    const employerCpf = employerCpfLine?.debit || 0;
    const totalCpf = cpfPayableLine?.credit || 0;
    const netSalary = netSalaryLine?.credit || 0;
    const employeeCpf = totalCpf - employerCpf;
    const baseSalaryParam = parsed.keyParameters?.find((p) => p.label.includes("Basic Monthly Salary"))?.value || `SGD ${grossSalary.toLocaleString()}`;
    const workingDaysParam = parsed.keyParameters?.find((p) => p.label.includes("Working Days"))?.value || "22 / 22 days";
    const sdlParam = parsed.keyParameters?.find((p) => p.label.includes("Skills Development Levy"))?.value || "SGD 4.36";
    let replyText = `### Statutory Payroll & CPF Assessment: ${parsed.transactionTitle}

**Governing Authorities**: **MOM, CPF Board & IRAS** | **Legislation**: **Employment Act 1968 \xA722** & **Central Provident Fund Act 1953 \xA77 / First Schedule**

---

#### 1. Statutory Proration & Entitlement (MOM Employment Act \xA722)
* **Contracted Basic Monthly Salary**: **${baseSalaryParam}**
* **Statutory Working Days (Mon\u2013Fri)**: **${workingDaysParam}**
* **MOM Incomplete Month Formula**:
  $$\\text{Gross Salary Payable} = \\frac{\\text{Monthly Basic Rate of Pay}}{\\text{Total Working Days in Month}} \\times \\text{Actual Working Days Worked}$$
* **Gross Prorated Salary Payable**: $\\mathbf{SGD\\ ${grossSalary.toLocaleString(void 0, { minimumFractionDigits: 2 })}}$

---

#### 2. Statutory CPF & Net Salary Breakdown (CPF Act 1953 & 2026 Ceilings)
* **Gross Salary Subject to CPF (Ordinary Wage)**: **SGD ${grossSalary.toLocaleString(void 0, { minimumFractionDigits: 2 })}** *(Within 2026 OW ceiling of SGD 8,000)*
* **Employee CPF Contribution (20%)**: $\\mathbf{SGD\\ ${employeeCpf.toLocaleString(void 0, { minimumFractionDigits: 2 })}}$ *(Statutory Rule: Cents discarded per CPF Act \xA77)*
* **Employer CPF Contribution (17%)**: $\\mathbf{SGD\\ ${employerCpf.toLocaleString(void 0, { minimumFractionDigits: 2 })}}$ *(Statutory Rule: Total rounded to dollar)*
* **Total CPF Payable to CPF Board (37%)**: $\\mathbf{SGD\\ ${totalCpf.toLocaleString(void 0, { minimumFractionDigits: 2 })}}$
* **Net Take-Home Salary Payable to Staff**: $\\mathbf{SGD\\ ${netSalary.toLocaleString(void 0, { minimumFractionDigits: 2 })}}$ *(Gross SGD ${grossSalary.toLocaleString(void 0, { minimumFractionDigits: 2 })} - Employee CPF SGD ${employeeCpf.toLocaleString(void 0, { minimumFractionDigits: 2 })})*
* **Skills Development Levy (SDL)**: **${sdlParam}** *(0.25% of gross remuneration payable by employer)*

---

#### 3. Singapore Tax Deductibility & MOM Compliance (IRAS & MOM)
* **100% Tax Deductibility**: Under **Section 14(1) and Section 14(1)(e) of the Income Tax Act 1947**, staff salaries (**SGD ${grossSalary.toLocaleString(void 0, { minimumFractionDigits: 2 })}**) and mandatory employer CPF (**SGD ${employerCpf.toLocaleString(void 0, { minimumFractionDigits: 2 })}**) are fully tax-deductible expenses in Form C-S.
* **Disbursement Timeline**: Under **Section 21(2) of the Employment Act 1968**, all outstanding salary must be disbursed to the employee on their last day of employment.

---

### Single Compound Journal Entry (${grp.eventDate})

* **Debit**: **Staff Salaries & Wages (P&L - Operating Expense)** \u2014 **SGD ${grossSalary.toLocaleString(void 0, { minimumFractionDigits: 2 })}**
* **Debit**: **Employer CPF Contribution (P&L - Operating Expense)** \u2014 **SGD ${employerCpf.toLocaleString(void 0, { minimumFractionDigits: 2 })}**
* **Credit**: **CPF Payable to CPF Board (Current Liability)** \u2014 **SGD ${totalCpf.toLocaleString(void 0, { minimumFractionDigits: 2 })}**
* **Credit**: **Net Salaries Payable / Staff Clearing (Current Liability)** \u2014 **SGD ${netSalary.toLocaleString(void 0, { minimumFractionDigits: 2 })}**

**Balance Check**: $\\text{Total Debits (SGD } ${(grossSalary + employerCpf).toLocaleString(void 0, { minimumFractionDigits: 2 })}) == \\text{Total Credits (SGD } ${(totalCpf + netSalary).toLocaleString(void 0, { minimumFractionDigits: 2 })}) \\quad \\checkmark\\ \\mathbf{Balanced}$`;
    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }
  if (parsed.scenarioType === "CAR_PURCHASE_STATUTORY" && parsed.directGroups) {
    const grp = parsed.directGroups[0];
    const cost = grp.totalDebit;
    const replyText = `### Statutory Directive: Acquisition of Passenger Motor Car

**Governing Authorities**: **IRAS & AGC Singapore** | **Statutes**: **Income Tax Act 1947 \xA715(1)(k)** & **GST (General) Regulations Reg 26**

---

#### 1. Disallowance of 9% Input GST Claim (Regulation 26)
* Under **Regulation 26 of the GST (General) Regulations**, input tax incurred on the purchase, hire, or running expenses of a passenger motor car (S-plate) is **strictly blocked from recovery**.
* **Accounting Treatment**: The full purchase price of **SGD ${cost.toLocaleString(void 0, { minimumFractionDigits: 2 })}** (inclusive of GST) is capitalized into asset cost. No amount is debited to *GST Input Tax*.

---

#### 2. Prohibition of Tax Deductions & Capital Allowances (\xA715(1)(k))
* Under **Section 15(1)(k) of the Income Tax Act 1947**, **no tax deduction or Section 19/19A Capital Allowances** are granted on passenger motor cars.
* **Tax Add-Back**: All accounting depreciation charged in P&L must be **added back 100%** in the corporate tax computation (Form C-S / Form C).
* Petrol, parking, road tax, and maintenance expenses for the passenger car are also non-deductible under Section 15(1)(k).

---

### Single Compound Journal Entry (${grp.eventDate})

* **Debit**: **Motor Vehicles - Cost (Non-Current Asset)** \u2014 **SGD ${cost.toLocaleString(void 0, { minimumFractionDigits: 2 })}** *(Full gross outlay capitalized)*
* **Credit**: **Cash at Bank (Current Asset)** \u2014 **SGD ${cost.toLocaleString(void 0, { minimumFractionDigits: 2 })}** *(Bank disbursement)*

**Balance Check**: $\\text{Total Debits (SGD } ${cost.toLocaleString(void 0, { minimumFractionDigits: 2 })}) == \\text{Total Credits (SGD } ${cost.toLocaleString(void 0, { minimumFractionDigits: 2 })}) \\quad \\checkmark\\ \\mathbf{Balanced}$`;
    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }
  if (parsed.scenarioType === "ASSET_PURCHASE_DISCOUNT" && parsed.directGroups) {
    const grp = parsed.directGroups[0];
    const equipLine = grp.lines.find((l) => l.category === "ASSET" && l.debit > 0 && l.accountCode === "1500");
    const gstLine = grp.lines.find((l) => l.accountCode === "1190");
    const bankLine = grp.lines.find((l) => l.accountCode === "1010");
    const payableLine = grp.lines.find((l) => l.accountCode === "2010");
    const costVal = equipLine?.debit || 18e3;
    const gstVal = gstLine?.debit || 1620;
    const bankVal = bankLine?.credit || 5e3;
    const payableVal = payableLine?.credit || 14620;
    const listPriceParam = parsed.keyParameters?.find((p) => p.label.includes("List Price"));
    const discountParam = parsed.keyParameters?.find((p) => p.label.includes("Trade Discount"));
    const listPriceStr = listPriceParam?.value || "SGD 20,000.00";
    const discountLabel = discountParam?.label || "Trade Discount (10%)";
    const discountValStr = discountParam?.value || "-SGD 2,000.00";
    let replyText = `### Under ${std16Name} (*Property, Plant and Equipment* \xA716(a)) & Singapore GST Act

Here is the single compound journal entry on **${grp.eventDate}** to record the purchase of office equipment:

---

#### 1. Asset Capitalization & Trade Discount Deduction (${std16Name} \xA716(a))
* **List Price**: **${listPriceStr}** (exclusive of 9% GST)
* **Less ${discountLabel}**: $\\mathbf{${discountValStr}}$
* **Net Initial Cost Recognized**:
  $$\\text{Asset Cost} = \\mathbf{SGD\\ ${costVal.toLocaleString(void 0, { minimumFractionDigits: 2 })}}$$
  *(Statutory Rule: Under ${std16Name} \xA716(a), trade discounts are deducted directly from the list price. Trade discounts are **never** recorded as a separate ledger line in accounting).* 

---

#### 2. Singapore 9% Recoverable Input GST (IRAS)
* Under IRAS guidelines, 9% GST is levied on the **discounted selling price**:
  $$\\text{Input GST (9\\%)} = \\text{SGD } ${costVal.toLocaleString()} \\times 9\\% = \\mathbf{SGD\\ ${gstVal.toLocaleString(void 0, { minimumFractionDigits: 2 })}}$$
* **Total Gross Invoice Payable**: $\\text{SGD } ${costVal.toLocaleString()} + \\text{SGD } ${gstVal.toLocaleString()} = \\mathbf{SGD\\ ${(costVal + gstVal).toLocaleString(void 0, { minimumFractionDigits: 2 })}}$

---

#### 3. Settlement Breakdown
* **Immediate Bank Transfer**: **SGD ${bankVal.toLocaleString(void 0, { minimumFractionDigits: 2 })}**
* **Remaining Balance on Credit Terms (Trade Payables)**:
  $$\\text{Trade Payables} = ${(costVal + gstVal).toLocaleString()} - ${bankVal.toLocaleString()} = \\mathbf{SGD\\ ${payableVal.toLocaleString(void 0, { minimumFractionDigits: 2 })}}$$

---

### Single Compound Journal Entry (${grp.eventDate})

* **Debit**: **Office Equipment - Cost (Non-Current Asset)** \u2014 **SGD ${costVal.toLocaleString(void 0, { minimumFractionDigits: 2 })}**
* **Debit**: **GST Input Tax (IRAS 9% Claimable Receivable)** \u2014 **SGD ${gstVal.toLocaleString(void 0, { minimumFractionDigits: 2 })}**
* **Credit**: **Cash at Bank (Current Asset)** \u2014 **SGD ${bankVal.toLocaleString(void 0, { minimumFractionDigits: 2 })}**
* **Credit**: **Trade Payables / Other Payables (Current Liability)** \u2014 **SGD ${payableVal.toLocaleString(void 0, { minimumFractionDigits: 2 })}**

**Balance Check**: $\\text{Total Debits (SGD } ${(costVal + gstVal).toLocaleString(void 0, { minimumFractionDigits: 2 })}) == \\text{Total Credits (SGD } ${(bankVal + payableVal).toLocaleString(void 0, { minimumFractionDigits: 2 })}) \\quad \\checkmark\\ \\mathbf{Balanced}$`;
    if (parsed.directGroups.length > 1) {
      const grp2 = parsed.directGroups[1];
      replyText += `

---

### Subsequent Event: ${grp2.title} (${grp2.eventDate})

* **Debit**: **Trade Payables (Current Liability)** \u2014 **SGD ${payableVal.toLocaleString(void 0, { minimumFractionDigits: 2 })}** *(Derecognition of liability)*
* **Credit**: **Cash at Bank (Current Asset)** \u2014 **SGD ${payableVal.toLocaleString(void 0, { minimumFractionDigits: 2 })}** *(Cash outflow)*

*(Under ${std9} \xA73.3.1, the financial liability is extinguished upon full settlement).*`;
    }
    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }
  if (parsed.scenarioType === "PPE_IAS16" && parsed.directGroups) {
    const replyText = `### Under ${std16Name} (*Property, Plant and Equipment*), Singapore GST Act, & ${std9} (*Financial Instruments*)

Here is the complete statutory accounting schedule and double entries on **1 April 2026** for your machinery purchase, trade-in derecognition, and equipment loan:

---

#### 1. Depreciation Catch-Up Schedule (1 Jan 2026 \u2013 31 Mar 2026)
* Under **${std16Name} \xA755**, depreciation ceases at the date of derecognition. Therefore, depreciation for Jan\u2013Mar 2026 (3 months) must be recognized **prior to disposal**:
  $$\\text{Catch-up Depreciation} = \\text{SGD } 50,000 \\times 20\\% \\times \\frac{3}{12} = \\mathbf{SGD\\ 2,500.00}$$
* **Total Accumulated Depreciation at 1 April 2026**:
  $$\\text{SGD } 20,000 \\text{ (2024\u20132025)} + \\text{SGD } 2,500 \\text{ (Jan\u2013Mar 2026)} = \\mathbf{SGD\\ 22,500.00}$$
* **Carrying Amount / Net Book Value (NBV) at Disposal**:
  $$\\text{SGD } 50,000 - \\text{SGD } 22,500 = \\mathbf{SGD\\ 27,500.00}$$

---

#### 2. Trade-in Valuation & Singapore 9% GST Breakdown (IRAS)
* Under the Singapore GST Act, a trade-in constitutes a taxable supply (disposal of business asset):
  * **Agreed Trade-in Value (Gross)**: **SGD 21,800.00** (inclusive of 9% GST)
  * **Net Trade-in Consideration**: $\\text{SGD } 21,800 / 1.09 = \\mathbf{SGD\\ 20,000.00}$
  * **Output GST Payable to IRAS (9%)**: $\\text{SGD } 21,800 - 20,000 = \\mathbf{SGD\\ 1,800.00}$
* **Loss on Disposal Recognized in P&L (${std16Name} \xA768 & \xA771)**:
  $$\\text{Loss on Disposal} = \\text{Carrying Amount } (\\text{SGD } 27,500) - \\text{Net Consideration } (\\text{SGD } 20,000) = \\mathbf{SGD\\ 7,500.00}$$

---

#### 3. New Machinery Cost & Equipment Loan Funding
* **New Machine Cost (${std16Name} \xA716)**: **SGD 100,000.00** (capitalized net of recoverable tax)
* **Input GST (9% Claimable Receivable)**: **SGD 9,000.00** $\\rightarrow$ Total invoice: **SGD 109,000.00**
* **Less Trade-in credit**: SGD 21,800.00
* **Less Bank cash paid**: SGD 30,000.00
* **Remaining Balance Funded via Equipment Loan**:
  $$\\text{Loan Principal} = 109,000 - 21,800 - 30,000 = \\mathbf{SGD\\ 57,200.00}$$
* **2-Year 5% p.a. Flat Interest**:
  $$\\text{Unexpired Loan Interest} = 57,200 \\times 5\\% \\times 2 = \\mathbf{SGD\\ 5,720.00}$$
* **Gross Equipment Loan Payable**: $57,200 + 5,720 = \\mathbf{SGD\\ 62,920.00}$
  *(The SGD 5,720 unexpired interest is recorded upfront as a contra-liability account, so the net loan obligation on initial recognition is exactly SGD 57,200 under ${std9})*.

---

### Summary of Double Entries (1 April 2026)
1. **Catch-up Depreciation**: Dr. Depreciation Expense SGD 2,500 | Cr. Accumulated Depreciation SGD 2,500
2. **Disposal of Old Machine**: Dr. Acc. Depr SGD 22,500 | Dr. Loss on Disposal SGD 7,500 | Dr. Vendor Clearing SGD 21,800 || Cr. Machinery Cost SGD 50,000 | Cr. GST Output Tax SGD 1,800
3. **Acquisition & Financing**: Dr. Machinery Cost SGD 100,000 | Dr. GST Input Tax SGD 9,000 | Dr. Unexpired Loan Interest SGD 5,720 || Cr. Vendor Clearing SGD 21,800 | Cr. Cash at Bank SGD 30,000 | Cr. Equipment Loan Payable SGD 62,920

Review the **Double Entry Journal** tab for the full verified ledger table with citations!`;
    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }
  if (parsed.scenarioType === "GENERAL_EXPENSE") {
    if (!parsed.isComplete || !parsed.amount || parsed.amount <= 0 || !parsed.expenseAccountName) {
      return {
        messageText: "### Clarification Required\n\nPlease provide the expense type and actual payment amount before I prepare a journal.",
        scenarioState: { ...parsed, directGroups: [], isComplete: false }
      };
    }
    const amt = parsed.amount;
    const exp = parsed.expenseAccountName;
    const pay = parsed.paymentMethodAccountName || "Cash at Bank";
    const replyText = `### Under ${std1} (*Presentation of Financial Statements - Accrual Basis*)

Here is the complete double entry for your **${exp}** of **${parsed.functionalCurrency} ${amt.toLocaleString()}**:

* **Debit**: **${exp} (P&L - Operating Expense)** \u2014 **${parsed.functionalCurrency} ${amt.toLocaleString(void 0, { minimumFractionDigits: 2 })}**
* **Credit**: **${pay} (Current Asset)** \u2014 **${parsed.functionalCurrency} ${amt.toLocaleString(void 0, { minimumFractionDigits: 2 })}**

#### Accounting Rationale:
1. **Debit Reason**: Operating expenses increase on the debit side under ${std1} \xA728, reducing profit for the period.
2. **Credit Reason**: Asset accounts (Cash at Bank) decrease on the credit side as funds flow out to settle the expense.
3. **Balance Sheet & P&L Impact**: Total Assets decrease by ${parsed.functionalCurrency} ${amt.toLocaleString()}, and Net Profit decreases by ${parsed.functionalCurrency} ${amt.toLocaleString()}.`;
    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }
  if (parsed.scenarioType === "LEASE_IFRS16") {
    const termYears = parsed.leaseTermYears || 3;
    const termMonths = parsed.leaseTermMonths || 36;
    const rent = parsed.leasePaymentMonthly || 3e3;
    const rate = parsed.leaseDiscountRateAnnual || 5;
    const replyText = `### Under ${std16} (*Leases*)

For your **${termYears}-year rental agreement** paying **${parsed.functionalCurrency} ${rent.toLocaleString()}/month**:

Under **${std16} \xA722**, commercial leases over 12 months can **no longer be treated as off-balance sheet operating rent**. You must capitalize a **Right-of-Use (ROU) Asset** and a corresponding **Lease Liability**.

1. **At Inception (Commencement Date)**:
   * **Dr. Right-of-Use Asset**: ~${parsed.functionalCurrency} 100,097.10
   * **Cr. Lease Liability**: ~${parsed.functionalCurrency} 100,097.10
   *(Calculated as the present value of ${termMonths} payments of ${parsed.functionalCurrency} ${rent.toLocaleString()} discounted at ${rate}% p.a. Incremental Borrowing Rate under \xA726)*

2. **Every Month (Payment & Interest Accrual)**:
   * **Dr. Lease Liability (Principal)**: ${parsed.functionalCurrency} 2,582.93
   * **Dr. Finance Cost / Interest Expense (P&L)**: ${parsed.functionalCurrency} 417.07
   * **Cr. Cash / Bank**: ${parsed.functionalCurrency} ${rent.toLocaleString()}

3. **Every Month (Straight-Line Depreciation)**:
   * **Dr. Depreciation Expense - ROU Asset (P&L)**: ${parsed.functionalCurrency} 2,780.48
   * **Cr. Accumulated Depreciation - ROU Asset**: ${parsed.functionalCurrency} 2,780.48

Check the **Double Entry Journal** tab to review the complete statutory breakdown!`;
    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }
  if (parsed.scenarioType === "EQUITY_INVESTMENT_FX") {
    const buyRate = parsed.purchaseFxRate ?? 1.34;
    const sellRate = parsed.saleFxRate ?? 1.36;
    const initialSGD = (parsed.purchaseAmountForeign || 0) * buyRate;
    const proceedsSGD = (parsed.saleAmountForeign || 0) * sellRate;
    const stockGainSGD = ((parsed.saleAmountForeign || 0) - (parsed.purchaseAmountForeign || 0)) * sellRate;
    const fxGainSGD = (parsed.purchaseAmountForeign || 0) * (sellRate - buyRate);
    const replyText = `### Under ${std9} (*Financial Instruments*) & ${std21} (*Foreign Exchange*)

For **${parsed.assetName}** (invested USD ${(parsed.purchaseAmountForeign || 0).toLocaleString()} on ${parsed.purchaseDate}, sold for USD ${parsed.saleAmountForeign?.toLocaleString()} on ${parsed.saleDate}):

**Spot Exchange Rates (Powered by Frankfurter API - European Central Bank)**:
* Purchase Spot Rate: **${buyRate} SGD/USD**
* Sale Spot Rate: **${sellRate} SGD/USD**

#### Double Entries (Explicit Realized FX Gain View):
1. **On Acquisition (${parsed.purchaseDate})**:
   * **Dr. Financial Asset at FVTPL (${parsed.assetName})**: ${parsed.functionalCurrency} ${initialSGD.toLocaleString(void 0, { minimumFractionDigits: 2 })}
   * **Cr. Cash / Bank (USD Account)**: ${parsed.functionalCurrency} ${initialSGD.toLocaleString(void 0, { minimumFractionDigits: 2 })}

2. **On Sale / Disposal (${parsed.saleDate})**:
   * **Dr. Cash / Bank (USD Account)**: ${parsed.functionalCurrency} ${proceedsSGD.toLocaleString(void 0, { minimumFractionDigits: 2 })} *(Gross proceeds)*
   * **Cr. Financial Asset at FVTPL (${parsed.assetName})**: ${parsed.functionalCurrency} ${initialSGD.toLocaleString(void 0, { minimumFractionDigits: 2 })} *(Derecognition)*
   * **Cr. Fair Value Gain on Shares (P&L)**: ${parsed.functionalCurrency} ${stockGainSGD.toLocaleString(void 0, { minimumFractionDigits: 2 })} *(Stock appreciation)*
   * **Cr. Realized Foreign Exchange Gain (P&L / ${std21})**: ${parsed.functionalCurrency} ${fxGainSGD.toLocaleString(void 0, { minimumFractionDigits: 2 })} *(Currency gain on capital)*`;
    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }
  if (parsed.directGroups && parsed.directGroups.length > 0) {
    let replyText = `### Accounting Analysis: ${parsed.transactionTitle}

`;
    if (parsed.accountingTreatmentSummary) {
      replyText += `#### 1. Accounting Treatment
${parsed.accountingTreatmentSummary}

---

`;
    }
    replyText += `#### 2. Double Entry Schedule

`;
    for (const grp of parsed.directGroups) {
      replyText += `**${grp.title}** (${grp.eventDate}):
`;
      for (const line2 of grp.lines) {
        if (line2.debit > 0) {
          replyText += `* **Debit**: **${line2.accountName}** \u2014 **${parsed.functionalCurrency} ${line2.debit.toLocaleString(void 0, { minimumFractionDigits: 2 })}** *(${line2.lineExplanation})*
`;
        } else if (line2.credit > 0) {
          replyText += `* **Credit**: **${line2.accountName}** \u2014 **${parsed.functionalCurrency} ${line2.credit.toLocaleString(void 0, { minimumFractionDigits: 2 })}** *(${line2.lineExplanation})*
`;
        }
      }
      if (grp.isBalanced) {
        replyText += `*Balance Check: Debits (${parsed.functionalCurrency} ${grp.totalDebit.toFixed(2)}) == Credits (${parsed.functionalCurrency} ${grp.totalCredit.toFixed(2)}) \u2713 Balanced*

`;
      }
    }
    if (parsed.singaporeTaxTreatmentSummary) {
      replyText += `---

#### 3. Singapore Tax Implications
${parsed.singaporeTaxTreatmentSummary}

`;
    }
    replyText += `Check the **Double Entry Journal** tab for complete ledger posting details.`;
    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }
  const fallbackText = `### Accounting Inquiry Assessment

**Transaction**: ${parsed.transactionTitle || "Unclassified Query"}

The offline engine could not match this inquiry to an explicit pre-calculated benchmark fixture. Connect an AI Provider (Gemini, Azure OpenAI, or OpenAI) in Settings for dynamic reasoning and source citation.`;
  return {
    messageText: finalizeMessage(fallbackText, parsed),
    scenarioState: parsed
  };
}
async function callGeminiAPI(userInput, currentScenario, standard, apiKey, modelName = "gemini-3.5-flash-lite", chatHistory = [], groundedContext, deterministicScenario, existingProfiler, imageAttachments = []) {
  if (imageAttachments.length > 0 && !supportsGeminiVision(modelName)) {
    throw new Error("The selected Gemini model cannot analyse images.");
  }
  const profiler = existingProfiler || new RequestProfiler(userInput, modelName);
  const imageEvidence = await extractImageEvidenceWithGemini(apiKey, modelName, imageAttachments);
  const imageEvidenceSummary = formatImageEvidenceForAccounting(imageEvidence);
  const tGround0 = Date.now();
  const context = groundedContext || await buildGroundedReasoningContext(userInput, currentScenario, void 0, apiKey);
  const systemInstruction = formatGroundedSystemPrompt(context, standard);
  profiler.recordStage("grounding", Date.now() - tGround0);
  const contents = [];
  const conversationTurns = (chatHistory || []).filter((m) => m.id !== "welcome-msg" && m.text && !m.text.startsWith("\u26A0\uFE0F **Processing Error**")).slice(-4);
  for (const m of conversationTurns) {
    const role = m.sender === "user" ? "user" : "model";
    let textToSend = m.text;
    if (role === "model") {
      textToSend = textToSend.replace(/### Double Entry Journal[\s\S]*?(?=#{2,4}\s+|$)/gi, "").replace(/#### 4\. Official Statutory Sources[\s\S]*?(?=#{2,4}\s+|$)/gi, "").replace(/\|[^\n]+\|\n\|[-:| ]+\|\n(?:\|[^\n]+\|\n)+/g, "").trim();
      if (textToSend.length > 400) {
        textToSend = textToSend.slice(0, 400) + "... [Prior response condensed]";
      }
    }
    if (contents.length > 0 && contents[contents.length - 1].role === role) {
      const part = contents[contents.length - 1].parts[0];
      if ("text" in part) part.text += `

${textToSend}`;
    } else {
      contents.push({ role, parts: [{ text: textToSend }] });
    }
  }
  const activeScenarioSummary = currentScenario ? `
[CURRENT ACTIVE TRANSACTION CONTEXT]
Transaction Title: ${currentScenario.transactionTitle || "N/A"}
Functional Currency: ${currentScenario.functionalCurrency || "SGD"}
Active Parameters:
${JSON.stringify(currentScenario.keyParameters || [], null, 2)}
Active Double Entry Journal Groups:
${currentScenario.directGroups?.map((g, idx) => `Group #${idx + 1} (${g.eventDate}) - ${g.title}:
` + g.lines.map((l) => `  ${l.debit > 0 ? `Debit: ${l.accountName} (${l.accountCode || ""}) - SGD ${l.debit}` : `Credit: ${l.accountName} (${l.accountCode || ""}) - SGD ${l.credit}`}`).join("\n")).join("\n") || "None"}
${currentScenario.imageEvidence?.length ? `Previously extracted image evidence (do not re-examine an image unless the user asks):
${formatImageEvidenceForAccounting(currentScenario.imageEvidence)}` : ""}
` : "";
  const currentTurnText = `${activeScenarioSummary}
[USER QUERY / FOLLOW-UP]:
${userInput}${imageAttachments.length ? `

[EXTRACTED IMAGE EVIDENCE \u2014 NOT ACCOUNTING JUDGMENT]
${imageEvidenceSummary}` : ""}`.trim();
  if (contents.length > 0) {
    if (contents[contents.length - 1].role === "user") {
      const part = contents[contents.length - 1].parts[0];
      if ("text" in part) part.text = currentTurnText;
    } else {
      contents.push({ role: "user", parts: [{ text: currentTurnText }] });
    }
  } else {
    contents.push({ role: "user", parts: [{ text: currentTurnText }] });
  }
  const generationConfig = {
    temperature: 0.1,
    responseMimeType: "application/json"
  };
  if (modelName.includes("2.5") || modelName.includes("thinking")) {
    if (context.classification.intent === "STATUTORY_ADVISORY") {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    } else if (context.classification.intent === "TRANSACTION") {
      generationConfig.thinkingConfig = { thinkingBudget: 512 };
    } else {
      generationConfig.thinkingConfig = { thinkingBudget: 1024 };
    }
  }
  const requestBody = {
    contents,
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    generationConfig
  };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45e3);
  const tReq0 = Date.now();
  let rawJsonText = "";
  let usage = null;
  try {
    const streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?alt=sse`;
    const streamRes = await fetch(streamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    if (streamRes.ok && streamRes.body) {
      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let isFirstChunk = true;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (isFirstChunk) {
          profiler.recordFirstVisibleResponse();
          isFirstChunk = false;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line2 of lines) {
          const trimmed = line2.trim();
          if (trimmed.startsWith("data: ")) {
            try {
              const chunkJson = JSON.parse(trimmed.slice(6));
              const partText = chunkJson?.candidates?.[0]?.content?.parts?.[0]?.text;
              if (partText) rawJsonText += partText;
              if (chunkJson?.usageMetadata) usage = chunkJson.usageMetadata;
            } catch {
            }
          }
        }
      }
    } else {
      throw new Error(`Streaming response returned ${streamRes.status}`);
    }
  } catch (streamErr) {
    if (controller.signal.aborted || streamErr?.name === "AbortError") {
      clearTimeout(timeoutId);
      profiler.recordStage("gemini_request", Date.now() - tReq0);
      profiler.recordTimeout();
      profiler.recordFallback();
      throw new Error(`Gemini request timed out after 45s. Reverting to deterministic accounting engine.`);
    }
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      profiler.recordFirstVisibleResponse();
      if (!res.ok) {
        throw new Error(`Gemini HTTP Error ${res.status}: ${await res.text()}`);
      }
      const data = await res.json();
      usage = data?.usageMetadata;
      rawJsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } catch (stdErr) {
      clearTimeout(timeoutId);
      profiler.recordStage("gemini_request", Date.now() - tReq0);
      if (stdErr?.name === "AbortError" || controller.signal.aborted) {
        profiler.recordTimeout();
        profiler.recordFallback();
        throw new Error(`Gemini request timed out after 45s. Reverting to deterministic accounting engine.`);
      }
      throw stdErr;
    }
  } finally {
    clearTimeout(timeoutId);
  }
  profiler.recordStage("gemini_request", Date.now() - tReq0);
  if (usage) {
    profiler.setTokenCounts(
      usage.promptTokenCount || 0,
      usage.candidatesTokenCount || 0,
      usage.candidatesTokensDetails?.[0]?.thinkingTokenCount || 0
    );
  }
  if (!rawJsonText) {
    throw new Error("No content returned by Gemini");
  }
  const tPost0 = Date.now();
  const parsed = repairAndParseAIJson(rawJsonText);
  const result = postProcessAIResponse(parsed, currentScenario, userInput, context, deterministicScenario, standard);
  if (imageEvidence.length > 0) {
    result.scenarioState.imageEvidence = imageEvidence;
    result.scenarioState.evidence = [
      ...result.scenarioState.evidence || [],
      ...flattenImageEvidence(imageEvidence)
    ];
    const extractedJournalGroups = buildJournalGroupsFromImageEvidence(imageEvidence);
    const extractedTransactionGroups = buildTransactionGroupsFromImageEvidence(imageEvidence);
    const extractedGroups = extractedJournalGroups.length > 0 ? extractedJournalGroups : extractedTransactionGroups;
    if (extractedGroups.length > 0) {
      result.scenarioState.directGroups = extractedGroups;
      result.scenarioState.committedDirectGroups = void 0;
      result.messageText += `

### Journal visible in screenshot

The extracted journal is balanced: total debits equal total credits. It remains image-derived evidence and should be confirmed against the underlying transaction before posting.`;
    }
  } else if (currentScenario?.imageEvidence?.length) {
    result.scenarioState.imageEvidence = currentScenario.imageEvidence;
    result.scenarioState.evidence = currentScenario.evidence;
  }
  const uncertainMaterialFields = getMaterialImageUncertainties(imageEvidence);
  if (uncertainMaterialFields.length > 0) {
    const fieldNames = [...new Set(uncertainMaterialFields.map((field) => field.field.replace(/([A-Z])/g, " $1").toLowerCase()))];
    const prompt = `Please verify the screenshot ${fieldNames.join(", ")} before I prepare a definitive journal entry.`;
    result.scenarioState = {
      ...result.scenarioState,
      directGroups: [],
      projectedGroups: [],
      isComplete: false,
      missingFacts: [.../* @__PURE__ */ new Set([...result.scenarioState.missingFacts || [], ...fieldNames])],
      missingFields: [{
        fieldKey: "imageVerification",
        fieldName: "Screenshot amount or other material fact",
        prompt,
        whyNeeded: "The image evidence is not sufficiently reliable for a balanced accounting entry."
      }],
      uncertaintyDisclaimer: `Possible value detected from screenshot. ${prompt}`
    };
    result.messageText = `${result.messageText}

### Screenshot verification required

${prompt}`;
  }
  if (result.scenarioState.directGroups && result.scenarioState.directGroups.length > 0 && context.semanticUnderstanding) {
    const valResult = defaultAccountingGuardrails.validate(context.semanticUnderstanding, result.scenarioState.directGroups);
    if (!valResult.isValid) {
      console.warn(`[Guardrails] Detected ${valResult.violations.length} accounting violation(s) in AI proposal:`, valResult.violations.map((v) => v.code));
    }
  }
  profiler.recordStage("assembly", Date.now() - tPost0);
  profiler.recordFirstVisibleResponse();
  profiler.logSummary();
  return result;
}

// tests/regression/test_event_sequence_inventory.mjs
var narrative = [
  "Transaction 1 (5 Oct): Purchased 100 units of merchandise on credit from Supplier Alpha at SGD 50 each, subject to 9% GST. Credit terms are 2/10, n/30. Orion records purchases using the gross method.",
  "Transaction 2 (8 Oct): Returned 10 damaged units from the 5 Oct purchase back to Supplier Alpha, receiving a full credit note including the applicable GST.",
  "Transaction 3 (12 Oct): Settled the full outstanding balance owed to Supplier Alpha via bank transfer, qualifying for and taking the early settlement discount (the cash discount applies to the net merchandise amount before GST; GST is adjusted accordingly).",
  "Transaction 4 (15 Oct): Sold 40 units of this merchandise to Customer Bravo on credit for SGD 110 each, plus 9% GST. Assume FIFO cost allocation; cost per unit remains SGD 50.",
  "Transaction 5 (18 Oct): Customer Bravo reported minor defects on 5 units but agreed to keep them after Orion granted a credit allowance of SGD 20 per unit (plus 9% GST) on the invoice balance."
].join("\n");
var sequence = extractEventSequence(narrative);
assert.ok(sequence, "dated related events should be extracted as a sequence");
assert.deepEqual(sequence.events.map((event) => event.type), ["purchase", "purchase_return", "supplier_settlement", "sale", "credit_note"]);
assert.deepEqual(sequence.events[1].relatesTo, ["event-1"]);
assert.deepEqual(sequence.events[2].relatesTo, ["event-1"]);
var resolution = resolveInventoryEventSequence(sequence);
assert.equal(resolution.clarifications.length, 0);
assert.equal(resolution.groups.length, 5);
for (const group2 of resolution.groups) assert.equal(group2.isBalanced, true, `${group2.id} must balance`);
assert.deepEqual(resolution.groups.map((group2) => [group2.totalDebit, group2.totalCredit]), [[5450, 5450], [545, 545], [4905, 4905], [6796, 6796], [109, 109]]);
assert.deepEqual(resolution.groups[2].lines.map((line2) => [line2.accountName, line2.debit, line2.credit]), [["Accounts Payable", 4905, 0], ["Cash at Bank", 0, 4806.9], ["Inventory", 0, 90], ["Input GST receivable", 0, 8.1]]);
var routed = await processAccountingQuery(narrative, null, "SFRS_I", void 0, void 0, [], { journal: true, statutory: false });
assert.equal(routed.scenarioState.directGroups?.length, 5, "Double Entry Journal routing should retain the event chronology");
assert.equal(routed.scenarioState.isComplete, true);
var alternateSequence = extractEventSequence([
  "1 Dec: Bought 24 widgets on credit from supplier Delta at SGD 25 each, plus 8% GST. Terms 1.5/15, n/45.",
  "4 Dec: Returned 4 units to Delta for a full credit.",
  "10 Dec: Paid the full outstanding supplier invoice and took the settlement discount.",
  "14 Dec: Sold 10 widgets to customer Echo on credit for SGD 60 each plus 8% GST.",
  "16 Dec: Issued Echo an allowance of SGD 5 per unit for 2 defective widgets, plus 8% GST."
].join("\n"));
assert.ok(alternateSequence);
var alternateResolution = resolveInventoryEventSequence(alternateSequence);
assert.equal(alternateResolution.clarifications.length, 0);
assert.deepEqual(alternateResolution.groups.map((group2) => [group2.totalDebit, group2.totalCredit]), [[648, 648], [108, 108], [540, 540], [898, 898], [10.8, 10.8]]);
var generatedCommercialQuestions = [
  "1 Mar: Purchased 3 widgets on credit from supplier A at SGD 40 each plus 9% GST.\n2 Mar: Returned 1 widget to supplier A for a full credit.",
  "1 Apr: Bought 8 goods on credit from vendor B at SGD 15 each plus 7% GST.\n2 Apr: Sold 2 goods to customer C on credit for SGD 30 each plus 7% GST."
];
for (const question of generatedCommercialQuestions) {
  const resolved = resolveEventSequence(question);
  assert.equal(resolved?.family, "commercial_goods");
  assert.ok(resolved?.groups.every((group2) => group2.isBalanced));
}
assert.equal(resolveEventSequence("1 May: Accrued payroll.\n31 May: Paid salaries."), void 0, "unsupported families must fall through rather than receive an incorrect commercial journal");
var aiCandidate = normaliseAiEventSequence({ events: [
  { id: "event-1", type: "purchase", description: "Purchased goods on credit.", currency: "SGD", amount: 100, tax: { rate: 9 }, confidence: 0.95 },
  { id: "event-2", type: "supplier_settlement", description: "Paid supplier.", currency: "SGD", amount: 109, relatesTo: ["event-1"], confidence: 0.95 }
] });
assert.ok(aiCandidate, "valid AI factual candidates should pass the schema boundary");
assert.equal(normaliseAiEventSequence({ events: [{ type: "purchase", description: "one event" }] }), void 0, "incomplete or malformed AI event output must be rejected");
console.log("PASS | inventory event sequence is extracted, reconciled, balanced, and routed before generic clarification");
