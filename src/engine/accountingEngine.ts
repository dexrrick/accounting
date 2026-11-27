import type {
  AccountingStandard,
  AccountingScenarioState,
  JournalEntryGroup,
  JournalLine,
  FinancialImpactSummary,
  JournalAuthorityStatus
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

  const defaultStatus: JournalAuthorityStatus = scenario.authorityStatus ||
    (scenario.scenarioType === 'UNRECOGNIZED'
      ? 'AI_PROPOSED'
      : (scenario.missingFacts && scenario.missingFacts.length > 0 ? 'CONDITIONAL' : 'DETERMINISTIC'));

  // =========================================================================
  // SCENARIO 0: UNIVERSAL DIRECT GROUPS (From Gemini API or Smart Engine)
  // =========================================================================
  if (scenario.directGroups && scenario.directGroups.length > 0) {
    let assetsDelta = 0;
    let liabDelta = 0;
    let pnlImpact = 0;
    let ociImpact = 0;

    const normalizedGroups = scenario.directGroups.map((grp) => ({
      ...grp,
      authorityStatus: grp.authorityStatus || defaultStatus
    }));

    for (const grp of normalizedGroups) {
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
      groups: normalizedGroups,
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
  if (scenario.scenarioType === 'GENERAL_EXPENSE' && scenario.isComplete && scenario.amount !== undefined && scenario.amount > 0 && scenario.expenseAccountName) {
    const amt = scenario.amount;
    const expenseTitle = scenario.expenseAccountName;
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
    if (
      !scenario.isComplete ||
      !scenario.leaseTermMonths ||
      scenario.leaseTermMonths <= 0 ||
      !scenario.leasePaymentMonthly ||
      scenario.leasePaymentMonthly <= 0 ||
      scenario.leaseDiscountRateAnnual === undefined ||
      scenario.leaseDiscountRateAnnual < 0
    ) {
      return { groups: [], financialImpact: { totalAssetsDelta: 0, totalLiabilitiesDelta: 0, totalEquityDelta: 0, pnlImpact: 0, ociImpact: 0, functionalCurrency: func } };
    }
    const termMonths = scenario.leaseTermMonths;
    const termYears = scenario.leaseTermYears && scenario.leaseTermYears > 0
      ? scenario.leaseTermYears
      : Math.round((termMonths / 12) * 10) / 10;
    const monthlyRent = scenario.leasePaymentMonthly;
    const annualRate = scenario.leaseDiscountRateAnnual / 100;
    const monthlyRate = annualRate / 12;

    const computeMonth1EndIso = (isoDate: string): string | undefined => {
      const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return undefined;
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10);
      const d = parseInt(m[3], 10);
      const start = new Date(Date.UTC(y, mo - 1, d));
      if (start.getUTCFullYear() !== y || start.getUTCMonth() + 1 !== mo || start.getUTCDate() !== d) {
        return undefined;
      }
      let endUtc: Date;
      if (d === 1) {
        // 1st of month -> last day of the same month (e.g. 2026-07-01 -> 2026-07-31)
        endUtc = new Date(Date.UTC(y, mo, 0));
      } else {
        // Mid-month commencement -> same day next month (clamped to target month length) minus 1 day
        const nextMonthLastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
        const clampedDay = Math.min(d, nextMonthLastDay);
        endUtc = new Date(Date.UTC(y, mo, clampedDay - 1));
      }
      return endUtc.toISOString().slice(0, 10);
    };

    const commDateIso = scenario.leaseCommencementDate?.trim() || undefined;
    const month1EndIso = commDateIso ? computeMonth1EndIso(commDateIso) : undefined;
    const inceptionEventDate = commDateIso ? formatSingaporeDate(commDateIso) : 'Commencement Date';
    const month1EventDate = month1EndIso ? formatSingaporeDate(month1EndIso) : 'End of Month 1';

    let pvLiability = 0;
    if (monthlyRate > 0) {
      pvLiability = monthlyRent * ((1 - Math.pow(1 + monthlyRate, -termMonths)) / monthlyRate);
    } else {
      pvLiability = monthlyRent * termMonths;
    }
    const pvLiabilityCents = Math.round(pvLiability * 100);
    pvLiability = pvLiabilityCents / 100;

    const monthlyRentCents = Math.round(monthlyRent * 100);
    const interestM1Cents = Math.round(pvLiabilityCents * monthlyRate);
    const principalM1Cents = monthlyRentCents - interestM1Cents;
    if (pvLiabilityCents <= 0 || principalM1Cents < 0) {
      return { groups: [], financialImpact: { totalAssetsDelta: 0, totalLiabilitiesDelta: 0, totalEquityDelta: 0, pnlImpact: 0, ociImpact: 0, functionalCurrency: func } };
    }
    const interestM1 = interestM1Cents / 100;
    const principalM1 = principalM1Cents / 100;

    // Inception
    const inceptionLines: JournalLine[] = [
      {
        id: 'line-lease-rou',
        accountCode: '1700',
        accountName: 'Right-of-Use (ROU) Asset - Leased Premises',
        category: 'ASSET',
        debit: pvLiability,
        credit: 0,
        lineExplanation: `Capitalization of right-of-use asset measured at initial present value of ${termMonths} monthly lease payments of ${func} ${monthlyRent.toLocaleString()} discounted at ${(annualRate * 100).toFixed(1)}% p.a.`
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
      eventDate: inceptionEventDate,
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
        `Under ${stdPrefix16} §26: The lease liability is measured at present value of future payments discounted using the lessee's IBR (${(annualRate * 100).toFixed(1)}% p.a.).`
      ]
    });

    // Month 1 Payment (omit zero-value interest/principal lines, e.g. 0% IBR)
    const paymentLines: JournalLine[] = [];
    if (principalM1Cents > 0) {
      paymentLines.push({
        id: 'line-lease-pay-liab',
        accountCode: '2600',
        accountName: 'Lease Liability (Principal Portion)',
        category: 'LIABILITY',
        debit: principalM1,
        credit: 0,
        lineExplanation: `Reduction in lease liability principal balance.`
      });
    }
    if (interestM1Cents > 0) {
      paymentLines.push({
        id: 'line-lease-pay-interest',
        accountCode: '6200',
        accountName: 'Finance Costs / Lease Interest Expense (P&L)',
        category: 'EXPENSE',
        debit: interestM1,
        credit: 0,
        lineExplanation: `Interest expense accrued on opening lease liability at monthly rate of ${(monthlyRate * 100).toFixed(3)}%.`
      });
    }
    paymentLines.push({
      id: 'line-lease-pay-bank',
      accountCode: '1010',
      accountName: 'Cash / Bank',
      category: 'ASSET',
      debit: 0,
      credit: monthlyRentCents / 100,
      lineExplanation: `Monthly contractual rental payment.`
    });

    const payDrCents = paymentLines.reduce((sum, l) => sum + Math.round(l.debit * 100), 0);
    const payCrCents = paymentLines.reduce((sum, l) => sum + Math.round(l.credit * 100), 0);
    groups.push({
      id: 'grp-lease-payment-m1',
      eventDate: month1EventDate,
      title: 'First Month Lease Payment & Interest Expense',
      summary: interestM1Cents > 0
        ? `Payment of ${func} ${monthlyRent.toLocaleString()} (Principal: ${func} ${principalM1.toLocaleString()}, Interest: ${func} ${interestM1.toLocaleString()})`
        : `Payment of ${func} ${monthlyRent.toLocaleString()} (Principal: ${func} ${principalM1.toLocaleString()}, Interest: ${func} 0.00 at 0% IBR)`,
      lines: paymentLines,
      totalDebit: payDrCents / 100,
      totalCredit: payCrCents / 100,
      isBalanced: payDrCents > 0 && payDrCents === payCrCents,
      citations: [
        getCitation('IFRS16_SUBSEQUENT_MEASUREMENT', standard)
      ],
      rationalePoints: [
        `Under ${stdPrefix16} §36: Each lease payment is apportioned between finance charge (interest) and liability reduction.`
      ]
    });

    // Depreciation
    const monthlyDeprCents = Math.round(pvLiabilityCents / termMonths);
    const monthlyDepr = monthlyDeprCents / 100;
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
      eventDate: month1EventDate,
      title: 'First Month ROU Asset Depreciation',
      summary: `Straight-line depreciation of ${func} ${monthlyDepr.toLocaleString()} per month`,
      lines: deprLines,
      totalDebit: monthlyDepr,
      totalCredit: monthlyDepr,
      isBalanced: monthlyDeprCents > 0,
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

  const normalizedGroups = groups.map((grp) => ({
    ...grp,
    authorityStatus: grp.authorityStatus || defaultStatus
  }));

  return { groups: normalizedGroups, financialImpact };
}
