import type {
  AccountingStandard,
  AccountingScenarioState,
  JournalEntryGroup,
  JournalLine,
  FinancialImpactSummary
} from '../types/accounting';
import { getCitation } from '../standards/standardsKnowledge';
import { formatSingaporeDate } from '../utils/dateUtils';

export function calculateDoubleEntries(
  scenario: AccountingScenarioState,
  standard: AccountingStandard
): {
  groups: JournalEntryGroup[];
  financialImpact: FinancialImpactSummary;
} {
  const groups: JournalEntryGroup[] = [];
  const stdPrefix = standard === 'SFRS_I' ? 'SFRS(I)' : 'IFRS';
  const stdPrefix1 = standard === 'SFRS_I' ? 'SFRS(I) 1-1' : 'IAS 1';
  const stdPrefix21 = standard === 'SFRS_I' ? 'SFRS(I) 1-21' : 'IAS 21';
  const stdPrefix16 = standard === 'SFRS_I' ? 'SFRS(I) 16' : 'IFRS 16';

  const func = (scenario.functionalCurrency || 'SGD').toUpperCase();
  const foreign = (scenario.transactionCurrency || 'USD').toUpperCase();
  const isForeign = func !== foreign;

  // =========================================================================
  // SCENARIO 0: UNIVERSAL DIRECT GROUPS (From Gemini API or Smart Engine)
  // =========================================================================
  if (scenario.directGroups && scenario.directGroups.length > 0) {
    let assetsDelta = 0;
    let liabDelta = 0;
    let pnlImpact = 0;
    let ociImpact = 0;

    for (const grp of scenario.directGroups) {
      for (const line of grp.lines) {
        if (line.category === 'ASSET') {
          assetsDelta += (line.debit - line.credit);
        } else if (line.category === 'LIABILITY') {
          liabDelta += (line.credit - line.debit);
        } else if (line.category === 'REVENUE') {
          pnlImpact += line.credit;
        } else if (line.category === 'EXPENSE') {
          pnlImpact -= line.debit;
        } else if (line.category === 'OTHER_COMPREHENSIVE_INCOME') {
          ociImpact += (line.credit - line.debit);
        }
      }
    }

    return {
      groups: scenario.directGroups,
      financialImpact: {
        totalAssetsDelta: Math.round(assetsDelta * 100) / 100,
        totalLiabilitiesDelta: Math.round(liabDelta * 100) / 100,
        totalEquityDelta: Math.round((pnlImpact + ociImpact) * 100) / 100,
        pnlImpact: Math.round(pnlImpact * 100) / 100,
        ociImpact: Math.round(ociImpact * 100) / 100,
        functionalCurrency: func
      }
    };
  }

  // =========================================================================
  // SCENARIO 1: GENERAL OPERATING EXPENSES (Entertainment, Travel, Utilities, etc.)
  // =========================================================================
  if (scenario.scenarioType === 'GENERAL_EXPENSE' || (scenario.amount && scenario.amount > 0 && !scenario.purchaseAmountForeign && !scenario.leasePaymentMonthly)) {
    const amt = scenario.amount || 3000;
    const expenseTitle = scenario.expenseAccountName || 'Entertainment & Hospitality Expenses';
    const paymentAccount = scenario.paymentMethodAccountName || 'Cash at Bank (Current Account)';

    const lines: JournalLine[] = [
      {
        id: 'line-exp-dr',
        accountCode: '5310',
        accountName: `${expenseTitle} (P&L)`,
        category: 'EXPENSE',
        debit: amt,
        credit: 0,
        lineExplanation: `Recognition of business operating expense in the income statement under the accrual basis.`
      },
      {
        id: 'line-exp-cr',
        accountCode: '1010',
        accountName: paymentAccount,
        category: 'ASSET',
        debit: 0,
        credit: amt,
        lineExplanation: `Settlement of expense via cash/bank fund transfer.`
      }
    ];

    groups.push({
      id: 'grp-general-expense',
      eventDate: formatSingaporeDate(new Date()),
      title: scenario.transactionTitle || `Payment of ${expenseTitle}`,
      summary: `Payment of ${func} ${amt.toLocaleString()} via ${paymentAccount}`,
      lines,
      totalDebit: amt,
      totalCredit: amt,
      isBalanced: true,
      citations: [
        getCitation('IAS1_EXPENSE_RECOGNITION', standard)
      ],
      rationalePoints: [
        `Under ${stdPrefix1} §27-§28: Expenses are recognized in profit or loss when an outflow or depletion of economic resources (bank reduction) occurs.`,
        `Debit Rule: Expenses increase on the debit side as they reduce equity / profit.`,
        `Credit Rule: Assets (Bank) decrease on the credit side upon payment disbursement.`
      ]
    });
  }

  // =========================================================================
  // SCENARIO 2: LEASE ACCOUNTING (IFRS 16 / SFRS(I) 16)
  // =========================================================================
  else if (scenario.scenarioType === 'LEASE_IFRS16') {
    const termYears = scenario.leaseTermYears || 3;
    const termMonths = scenario.leaseTermMonths || termYears * 12;
    const monthlyRent = scenario.leasePaymentMonthly || 3000;
    const annualRate = (scenario.leaseDiscountRateAnnual ?? 5.0) / 100;
    const monthlyRate = annualRate / 12;
    const commDate = scenario.leaseCommencementDate || '2026-01-01';

    let pvLiability = 0;
    if (monthlyRate > 0) {
      pvLiability = monthlyRent * ((1 - Math.pow(1 + monthlyRate, -termMonths)) / monthlyRate);
    } else {
      pvLiability = monthlyRent * termMonths;
    }
    pvLiability = Math.round(pvLiability * 100) / 100;

    // Inception
    const inceptionLines: JournalLine[] = [
      {
        id: 'line-lease-rou',
        accountCode: '1700',
        accountName: 'Right-of-Use (ROU) Asset - Leased Premises',
        category: 'ASSET',
        debit: pvLiability,
        credit: 0,
        lineExplanation: `Capitalization of right-of-use asset measured at initial present value of ${termMonths} monthly lease payments of ${func} ${monthlyRent.toLocaleString()} discounted at ${((annualRate)*100).toFixed(1)}% p.a.`
      },
      {
        id: 'line-lease-liab',
        accountCode: '2600',
        accountName: 'Lease Liability',
        category: 'LIABILITY',
        debit: 0,
        credit: pvLiability,
        lineExplanation: `Initial recognition of lease liability measured at present value of future lease payments.`
      }
    ];

    groups.push({
      id: 'grp-lease-inception',
      eventDate: formatSingaporeDate(commDate),
      title: 'Initial Recognition of Lease (Commencement Date)',
      summary: `Inception of ${termYears}-year lease (${termMonths} months @ ${func} ${monthlyRent.toLocaleString()}/mo), PV: ${func} ${pvLiability.toLocaleString()}`,
      lines: inceptionLines,
      totalDebit: pvLiability,
      totalCredit: pvLiability,
      isBalanced: true,
      citations: [
        getCitation('IFRS16_LEASE_INCEPTION', standard),
        getCitation('IFRS16_SUBSEQUENT_MEASUREMENT', standard)
      ],
      rationalePoints: [
        `Under ${stdPrefix16} §22: At commencement date, lessee recognizes a right-of-use asset and a lease liability on balance sheet.`,
        `Under ${stdPrefix16} §26: The lease liability is measured at present value of future payments discounted using the lessee's IBR (${((annualRate)*100).toFixed(1)}% p.a.).`
      ]
    });

    // Month 1 Payment
    const interestM1 = Math.round((pvLiability * monthlyRate) * 100) / 100;
    const principalM1 = Math.round((monthlyRent - interestM1) * 100) / 100;

    const paymentLines: JournalLine[] = [
      {
        id: 'line-lease-pay-liab',
        accountCode: '2600',
        accountName: 'Lease Liability (Principal Portion)',
        category: 'LIABILITY',
        debit: principalM1,
        credit: 0,
        lineExplanation: `Reduction in lease liability principal balance.`
      },
      {
        id: 'line-lease-pay-interest',
        accountCode: '6200',
        accountName: 'Finance Costs / Lease Interest Expense (P&L)',
        category: 'EXPENSE',
        debit: interestM1,
        credit: 0,
        lineExplanation: `Interest expense accrued on opening lease liability at monthly rate of ${(monthlyRate * 100).toFixed(3)}%.`
      },
      {
        id: 'line-lease-pay-bank',
        accountCode: '1010',
        accountName: 'Cash / Bank',
        category: 'ASSET',
        debit: 0,
        credit: monthlyRent,
        lineExplanation: `Monthly contractual rental payment.`
      }
    ];

    groups.push({
      id: 'grp-lease-payment-m1',
      eventDate: formatSingaporeDate('2026-01-31'),
      title: 'First Month Lease Payment & Interest Expense',
      summary: `Payment of ${func} ${monthlyRent.toLocaleString()} (Principal: ${func} ${principalM1.toLocaleString()}, Interest: ${func} ${interestM1.toLocaleString()})`,
      lines: paymentLines,
      totalDebit: monthlyRent,
      totalCredit: monthlyRent,
      isBalanced: true,
      citations: [
        getCitation('IFRS16_SUBSEQUENT_MEASUREMENT', standard)
      ],
      rationalePoints: [
        `Under ${stdPrefix16} §36: Each lease payment is apportioned between finance charge (interest) and liability reduction.`
      ]
    });

    // Depreciation
    const monthlyDepr = Math.round((pvLiability / termMonths) * 100) / 100;
    const deprLines: JournalLine[] = [
      {
        id: 'line-lease-depr-exp',
        accountCode: '5200',
        accountName: 'Depreciation Expense - Right-of-Use Asset (P&L)',
        category: 'EXPENSE',
        debit: monthlyDepr,
        credit: 0,
        lineExplanation: `Monthly straight-line depreciation of ROU Asset over ${termMonths} months.`
      },
      {
        id: 'line-lease-acc-depr',
        accountCode: '1790',
        accountName: 'Accumulated Depreciation - Right-of-Use Asset',
        category: 'ASSET',
        debit: 0,
        credit: monthlyDepr,
        lineExplanation: `Contra-asset account accumulated depreciation on ROU asset.`
      }
    ];

    groups.push({
      id: 'grp-lease-depr-m1',
      eventDate: formatSingaporeDate('2026-01-31'),
      title: 'First Month ROU Asset Depreciation',
      summary: `Straight-line depreciation of ${func} ${monthlyDepr.toLocaleString()} per month`,
      lines: deprLines,
      totalDebit: monthlyDepr,
      totalCredit: monthlyDepr,
      isBalanced: true,
      citations: [
        getCitation('IFRS16_SUBSEQUENT_MEASUREMENT', standard)
      ],
      rationalePoints: [
        `Under ${stdPrefix16} §31: ROU Asset is depreciated over the lease term on a straight-line basis.`
      ]
    });
  }

  // =========================================================================
  // SCENARIO 3: EQUITY INVESTMENTS IN FOREIGN CURRENCY (IFRS 9 / IAS 21)
  // =========================================================================
  else if (scenario.scenarioType === 'EQUITY_INVESTMENT_FX' || ((scenario.purchaseAmountForeign ?? 0) > 0)) {
    const purchaseAmountForeign = scenario.purchaseAmountForeign ?? 0;
    const buyRate = scenario.purchaseFxRate ?? 1.34;
    const purchaseFunctional = Math.round((purchaseAmountForeign * buyRate) * 100) / 100;
    const classification = scenario.classification || 'FVTPL';

    // Entry 1: Initial Acquisition
    const buyLines: JournalLine[] = [
      {
        id: 'line-buy-dr',
        accountCode: classification === 'FVTPL' ? '1210' : '1220',
        accountName: `Financial Asset at ${classification} (${scenario.assetName || 'Equity Shares'})`,
        category: 'ASSET',
        debit: purchaseFunctional,
        credit: 0,
        foreignCurrency: isForeign ? foreign : undefined,
        foreignDebit: isForeign ? purchaseAmountForeign : undefined,
        exchangeRate: isForeign ? buyRate : undefined,
        lineExplanation: `Initial fair value recognition of ${scenario.quantity ? `${scenario.quantity.toLocaleString()} shares of ` : ''}${scenario.assetName} (${foreign} ${purchaseAmountForeign.toLocaleString()}) translated at spot rate of ${buyRate} ${func}/${foreign}.`
      },
      {
        id: 'line-buy-cr',
        accountCode: '1010',
        accountName: `Cash / Bank (${isForeign ? `${foreign} Account` : func})`,
        category: 'ASSET',
        debit: 0,
        credit: purchaseFunctional,
        foreignCurrency: isForeign ? foreign : undefined,
        foreignCredit: isForeign ? purchaseAmountForeign : undefined,
        exchangeRate: isForeign ? buyRate : undefined,
        lineExplanation: `Payment of ${foreign} ${purchaseAmountForeign.toLocaleString()} translated at transaction spot rate.`
      }
    ];

    groups.push({
      id: 'grp-purchase',
      eventDate: formatSingaporeDate(scenario.purchaseDate || '13/11/2026'),
      title: `Initial Recognition of ${scenario.assetName || 'Investment'}`,
      summary: `Acquisition of ${foreign} ${purchaseAmountForeign.toLocaleString()} shares at spot rate ${buyRate} ${func}/${foreign}`,
      lines: buyLines,
      totalDebit: purchaseFunctional,
      totalCredit: purchaseFunctional,
      isBalanced: true,
      citations: [
        getCitation('IFRS9_INITIAL_MEASUREMENT', standard),
        getCitation('IAS21_INITIAL_FOREIGN_CURRENCY', standard),
        getCitation('IFRS9_EQUITY_CLASSIFICATION', standard)
      ],
      rationalePoints: [
        `Under ${stdPrefix} 9 §5.1.1: Financial assets are initially recorded at fair value. FVTPL applies by default for equities unless irrevocable FVTOCI is elected.`,
        `Under ${stdPrefix21} §21: Foreign currency transactions are recorded using the spot rate on transaction date (${buyRate}). Source: ${scenario.fxSource || 'Frankfurter API / ECB Reference'}.`
      ]
    });

    // Entry 2: Sale / Derecognition
    if (scenario.saleAmountForeign && scenario.saleAmountForeign > 0) {
      const sellRate = scenario.saleFxRate ?? 1.36;
      const saleFunctional = Math.round((scenario.saleAmountForeign * sellRate) * 100) / 100;
      const totalNetGainLoss = Math.round((saleFunctional - purchaseFunctional) * 100) / 100;

      const stockGainForeign = scenario.saleAmountForeign - purchaseAmountForeign;
      const stockGainFunctional = Math.round((stockGainForeign * sellRate) * 100) / 100;
      const fxGainFunctional = Math.round((purchaseAmountForeign * (sellRate - buyRate)) * 100) / 100;

      const sellLines: JournalLine[] = [];

      sellLines.push({
        id: 'line-sell-dr-bank',
        accountCode: '1010',
        accountName: `Cash / Bank (${isForeign ? `${foreign} Account` : func})`,
        category: 'ASSET',
        debit: saleFunctional,
        credit: 0,
        foreignCurrency: isForeign ? foreign : undefined,
        foreignDebit: isForeign ? scenario.saleAmountForeign : undefined,
        exchangeRate: isForeign ? sellRate : undefined,
        lineExplanation: `Gross disposal proceeds of ${foreign} ${scenario.saleAmountForeign.toLocaleString()} received, translated at disposal spot rate of ${sellRate} ${func}/${foreign}.`
      });

      sellLines.push({
        id: 'line-sell-cr-asset',
        accountCode: classification === 'FVTPL' ? '1210' : '1220',
        accountName: `Financial Asset at ${classification} (${scenario.assetName || 'Equity Shares'})`,
        category: 'ASSET',
        debit: 0,
        credit: purchaseFunctional,
        foreignCurrency: isForeign ? foreign : undefined,
        foreignCredit: isForeign ? purchaseAmountForeign : undefined,
        exchangeRate: isForeign ? buyRate : undefined,
        lineExplanation: `Derecognition of investment carrying amount of ${func} ${purchaseFunctional.toLocaleString()}.`
      });

      // Always bifurcate FX gain/loss unless explicitly disabled
      if (scenario.bifurcateFxGain !== false) {
        if (stockGainFunctional > 0) {
          sellLines.push({
            id: 'line-sell-stock-gain',
            accountCode: '4510',
            accountName: `Fair Value Gain on Shares (${scenario.assetName}) [P&L]`,
            category: 'REVENUE',
            debit: 0,
            credit: stockGainFunctional,
            lineExplanation: `Stock appreciation gain of ${foreign} ${stockGainForeign.toLocaleString()} translated at disposal spot rate of ${sellRate} ${func}/${foreign}.`
          });
        }

        if (fxGainFunctional > 0) {
          sellLines.push({
            id: 'line-sell-fx-gain',
            accountCode: '4600',
            accountName: `Realized Foreign Exchange Gain (${foreign}/${func}) [P&L / ${stdPrefix21}]`,
            category: 'REVENUE',
            debit: 0,
            credit: fxGainFunctional,
            lineExplanation: `Realized foreign currency appreciation on initial capital of ${foreign} ${purchaseAmountForeign.toLocaleString()} from rate ${buyRate} to ${sellRate} (+${(sellRate - buyRate).toFixed(4)} ${func}/${foreign}).`
          });
        } else if (fxGainFunctional < 0) {
          sellLines.push({
            id: 'line-sell-fx-loss',
            accountCode: '5600',
            accountName: `Realized Foreign Exchange Loss (${foreign}/${func}) [P&L / ${stdPrefix21}]`,
            category: 'EXPENSE',
            debit: Math.abs(fxGainFunctional),
            credit: 0,
            lineExplanation: `Realized foreign currency depreciation on initial capital.`
          });
        } else {
          // If rate remained constant
          sellLines.push({
            id: 'line-sell-fx-gain-zero',
            accountCode: '4600',
            accountName: `Realized Foreign Exchange Gain/Loss (${foreign}/${func}) [P&L / ${stdPrefix21}]`,
            category: 'REVENUE',
            debit: 0,
            credit: 0,
            lineExplanation: `No currency exchange fluctuation occurred between purchase and sale (Spot rate remained ${sellRate} ${func}/${foreign}).`
          });
        }
      } else {
        if (totalNetGainLoss > 0) {
          sellLines.push({
            id: 'line-sell-gain',
            accountCode: '4500',
            accountName: `Net Gain on Financial Assets at ${classification} (P&L)`,
            category: 'REVENUE',
            debit: 0,
            credit: totalNetGainLoss,
            lineExplanation: `Combined net gain comprising stock price gain (${func} ${stockGainFunctional.toLocaleString()}) and currency gain (${func} ${fxGainFunctional.toLocaleString()}).`
          });
        } else if (totalNetGainLoss < 0) {
          sellLines.push({
            id: 'line-sell-loss',
            accountCode: '5500',
            accountName: `Net Loss on Financial Assets at ${classification} (P&L)`,
            category: 'EXPENSE',
            debit: Math.abs(totalNetGainLoss),
            credit: 0,
            lineExplanation: `Combined net loss on disposal.`
          });
        }
      }

      const totalDr = Math.round(sellLines.reduce((s, l) => s + l.debit, 0) * 100) / 100;
      const totalCr = Math.round(sellLines.reduce((s, l) => s + l.credit, 0) * 100) / 100;

      groups.push({
        id: 'grp-sale',
        eventDate: formatSingaporeDate(scenario.saleDate || '15/12/2026'),
        title: `Derecognition / Disposal of ${scenario.assetName || 'Investment'}`,
        summary: `Sale of ${foreign} ${scenario.saleAmountForeign.toLocaleString()} shares at spot rate ${sellRate} ${func}/${foreign}`,
        lines: sellLines,
        totalDebit: totalDr,
        totalCredit: totalCr,
        isBalanced: Math.abs(totalDr - totalCr) < 0.01,
        citations: [
          getCitation('IAS21_NON_MONETARY_FVTPL_FX', standard),
          getCitation('IAS21_MONETARY_ITEMS', standard),
          getCitation('IFRS9_EQUITY_CLASSIFICATION', standard)
        ],
        rationalePoints: [
          `Realized FX Gain Double Entry: Initial capital of ${foreign} ${purchaseAmountForeign.toLocaleString()} translated at spot rate change from ${buyRate} to ${sellRate} (FX movement: ${func} ${fxGainFunctional.toLocaleString()}).`,
          `Stock Appreciation Double Entry: Share price gain equals ${func} ${stockGainFunctional.toLocaleString()}.`,
          `Statutory Compliance (${stdPrefix21} §23(c)): Companies may present this either as a combined Fair Value Gain or bifurcated into Fair Value Gain and Realized FX Gain.`
        ]
      });
    }
  }

  // =========================================================================
  // FINANCIAL IMPACT SUMMARY
  // =========================================================================
  let assetsDelta = 0;
  let liabDelta = 0;
  let pnlImpact = 0;
  let ociImpact = 0;

  for (const grp of groups) {
    for (const line of grp.lines) {
      if (line.category === 'ASSET') {
        assetsDelta += (line.debit - line.credit);
      } else if (line.category === 'LIABILITY') {
        liabDelta += (line.credit - line.debit);
      } else if (line.category === 'REVENUE') {
        pnlImpact += line.credit;
      } else if (line.category === 'EXPENSE') {
        pnlImpact -= line.debit;
      } else if (line.category === 'OTHER_COMPREHENSIVE_INCOME') {
        ociImpact += (line.credit - line.debit);
      }
    }
  }

  const financialImpact: FinancialImpactSummary = {
    totalAssetsDelta: Math.round(assetsDelta * 100) / 100,
    totalLiabilitiesDelta: Math.round(liabDelta * 100) / 100,
    totalEquityDelta: Math.round((pnlImpact + ociImpact) * 100) / 100,
    pnlImpact: Math.round(pnlImpact * 100) / 100,
    ociImpact: Math.round(ociImpact * 100) / 100,
    functionalCurrency: func
  };

  return { groups, financialImpact };
}
