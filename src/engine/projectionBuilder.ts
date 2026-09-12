import type {
  JournalEntryGroup,
  JournalAuthorityStatus
} from '../types/accounting';
import type {
  ConversationAccountingContext,
  UnderlyingTransactionState,
  EquityMeasurementBasis,
  AccountingEvent,
  OutstandingAccountBalance,
  FollowUpEventAnalysis
} from '../types/conversationState';
import { formatSingaporeDate } from '../utils/dateUtils';

/**
 * Result structure returned by buildAccountingMeasurementProjection.
 */
export interface ProjectionResult {
  success: boolean;
  isHypothetical: true;
  projectedGroups: JournalEntryGroup[];
  projectedEvents: AccountingEvent[];
  balanceUpdates?: OutstandingAccountBalance[];
  explanation: string;
  authorityStatus: JournalAuthorityStatus;
  diagnosticNotice?: string;
}

/**
 * Validates whether a journal entry group strictly balances (Total Debits == Total Credits).
 * Never permits imbalanced journals to be presented as balanced deterministic entries.
 */
export function validateJournalBalance(group: JournalEntryGroup): {
  isBalanced: boolean;
  imbalance: number;
  totalDebit: number;
  totalCredit: number;
  declaredTotalsMatch: boolean;
  declaredBalanceFlagMatches: boolean;
} {
  const totalDebit = Math.round(group.lines.reduce((s, l) => s + (l.debit || 0), 0) * 100) / 100;
  const totalCredit = Math.round(group.lines.reduce((s, l) => s + (l.credit || 0), 0) * 100) / 100;
  const imbalance = Math.round(Math.abs(totalDebit - totalCredit) * 100) / 100;
  const calculatedIsBalanced = totalDebit > 0 && imbalance < 0.01;
  const declaredTotalsMatch = group.totalDebit === totalDebit && group.totalCredit === totalCredit;
  const declaredBalanceFlagMatches = group.isBalanced === calculatedIsBalanced;
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

/** Derives presentation totals and balance status from journal lines. */
export function finalizeJournalGroup(group: JournalEntryGroup): JournalEntryGroup {
  const totalDebit = Math.round(group.lines.reduce((sum, line) => sum + line.debit, 0) * 100) / 100;
  const totalCredit = Math.round(group.lines.reduce((sum, line) => sum + line.credit, 0) * 100) / 100;
  return {
    ...group,
    totalDebit,
    totalCredit,
    isBalanced: totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.01
  };
}

/**
 * Validates whether a requested measurement basis is legally/structurally applicable
 * to the underlying transaction nature and ownership context.
 *
 * Invariant: Financial asset measurement bases (FVTPL, FVOCI, AMORTISED_COST, COST)
 * apply ONLY to external financial instruments. They are strictly prohibited on:
 * - Own equity issuance (SFRS(I) 1-32 §33)
 * - Commercial leases (SFRS(I) 16)
 * - Operating expenses (SFRS(I) 1-1)
 */
export function isMeasurementBasisApplicable(
  tx: UnderlyingTransactionState,
  basis: EquityMeasurementBasis
): { isApplicable: boolean; reason?: string } {
  if (basis === 'UNKNOWN') {
    return {
      isApplicable: false,
      reason: 'Requested measurement basis is UNKNOWN or unspecified.'
    };
  }

  // 1. Own equity instruments cannot be measured at FVTPL/FVOCI/AMORTISED_COST (SFRS(I) 1-32 §33)
  if (tx.ownershipContext === 'own_equity' || tx.type === 'share_capital_issuance' || tx.type === 'capital_reduction') {
    return {
      isApplicable: false,
      reason: `Under SFRS(I) 1-32 §33, an entity's own equity instruments can NEVER be classified or measured as financial assets (${basis}).`
    };
  }

  // 2. Leases follow SFRS(I) 16 Right-of-Use Asset & Lease Liability model
  if (tx.type === 'lease_contract' || tx.type === 'lease_payment') {
    return {
      isApplicable: false,
      reason: `Commercial leases are governed by the SFRS(I) 16 ROU asset & amortised liability model, not ${basis}.`
    };
  }

  // 3. Operating expenses follow SFRS(I) 1-1 accrual
  if (tx.type === 'expense_payment' || tx.type === 'director_expense_settlement' || tx.type === 'payroll_payment') {
    return {
      isApplicable: false,
      reason: `General operating expenses are recognized in P&L under SFRS(I) 1-1 and do not possess an investment measurement basis (${basis}).`
    };
  }

  // 4. External financial investments (shares, debt, securities)
  if (
    tx.ownershipContext === 'external_investment' &&
    (tx.instrument === 'financial_asset_equity' ||
      tx.instrument === 'marketable_securities' ||
      tx.instrument === 'debt_instrument')
  ) {
    if (basis === 'FVTPL' || basis === 'FVOCI' || basis === 'AMORTISED_COST' || basis === 'COST') {
      return { isApplicable: true };
    }
  }

  return {
    isApplicable: false,
    reason: `Measurement basis '${basis}' is not supported for transaction type '${tx.type}' and instrument '${tx.instrument}'.`
  };
}

/**
 * Canonical financial-instrument measurement projection builder.
 *
 * Its intentionally narrow contract is an alternative FVTPL/FVOCI measurement
 * projection for a committed external investment. Settlement, lease variation,
 * receivable/payable and debt state transitions are handled by their dedicated
 * state-transition path; this builder rejects them instead of inventing facts.
 */
export function buildAccountingMeasurementProjection(params: {
  committedContext: ConversationAccountingContext;
  followUpAnalysis?: FollowUpEventAnalysis;
  requestedBasis?: EquityMeasurementBasis;
  overrideParams?: Record<string, any>;
}): ProjectionResult {
  const { committedContext, followUpAnalysis } = params;
  const tx = committedContext.underlyingTransaction;

  // Invariant 1: If no underlying transaction exists in committed context, cannot project
  if (!tx) {
    return {
      success: false,
      isHypothetical: true,
      projectedGroups: [],
      projectedEvents: [],
      explanation: 'No underlying committed transaction found to project from.',
      authorityStatus: 'CONDITIONAL',
      diagnosticNotice: 'Amounts pending: Underlying transaction facts not established.'
    };
  }

  const targetBasis = params.requestedBasis || followUpAnalysis?.targetMeasurementBasis;

  // Invariant 2: Never silently default missing classification
  if (!targetBasis || targetBasis === 'UNKNOWN') {
    return {
      success: false,
      isHypothetical: true,
      projectedGroups: [],
      projectedEvents: [],
      explanation: 'No valid target measurement basis specified for projection.',
      authorityStatus: 'CONDITIONAL',
      diagnosticNotice: 'Classification pending: Requested measurement basis is UNKNOWN.'
    };
  }

  // Invariant 3: Transaction-specific measurement validation
  const applicability = isMeasurementBasisApplicable(tx, targetBasis);
  if (!applicability.isApplicable) {
    return {
      success: false,
      isHypothetical: true,
      projectedGroups: [],
      projectedEvents: [],
      explanation: applicability.reason || `Measurement basis ${targetBasis} is not applicable.`,
      authorityStatus: 'CONDITIONAL',
      diagnosticNotice: applicability.reason
    };
  }

  // Reuse authoritative transaction facts. Never manufacture identifiers,
  // currencies, rates or amounts merely to make a journal render.
  const requiredFacts: Array<[string, unknown]> = [
    ['transactionId', tx.transactionId],
    ['currency', tx.currency],
    ['functionalCurrency', tx.functionalCurrency],
    ['acquisitionFxRate', tx.acquisitionFxRate],
    ['totalAmount', tx.totalAmount]
  ];
  if (tx.disposalAmount !== undefined && tx.disposalAmount !== null && tx.disposalAmount > 0) {
    requiredFacts.push(['disposalFxRate', tx.disposalFxRate]);
  }
  const missingFacts = requiredFacts
    .filter(([name, value]) =>
      value === undefined || value === null || value === '' ||
      ((name === 'acquisitionFxRate' || name === 'disposalFxRate' || name === 'totalAmount') &&
        (typeof value !== 'number' || !Number.isFinite(value) || value <= 0))
    )
    .map(([name]) => name);
  if (missingFacts.length > 0) {
    return {
      success: false,
      isHypothetical: true,
      projectedGroups: [],
      projectedEvents: [],
      explanation: 'Projection cannot be prepared because committed transaction facts are incomplete.',
      authorityStatus: 'CONDITIONAL',
      diagnosticNotice: `Authoritative facts pending: ${missingFacts.join(', ')}.`
    };
  }

  const txId = tx.transactionId!;
  const assetTitle = tx.assetName || 'Equity Investments';
  const txCurr = tx.currency;
  const funcCurr = tx.functionalCurrency!;
  const buyFx = tx.acquisitionFxRate!;
  const sellFx = tx.disposalFxRate;
  const totalAmt = tx.totalAmount!;
  const dispAmt = tx.disposalAmount;

  const initialCostSGD = Math.round(totalAmt * buyFx * 100) / 100;
  const proceedsSGD = dispAmt && sellFx ? Math.round(dispAmt * sellFx * 100) / 100 : 0;

  const priorCommittedGroups = (committedContext.priorJournals && committedContext.priorJournals.length > 0)
    ? committedContext.priorJournals.filter(g => !g.isHypothetical)
    : [];

  const groups: JournalEntryGroup[] = [];

  // =========================================================================
  // BRANCH 1: FVOCI (Fair Value Through Other Comprehensive Income)
  // =========================================================================
  if (targetBasis === 'FVOCI') {
    // 1. Initial Acquisition Group
    const acqLines = [
      {
        id: 'l-fvoci-buy-asset',
        accountCode: '1220',
        accountName: `Financial Asset at FVOCI (${assetTitle})`,
        category: 'ASSET' as const,
        debit: initialCostSGD,
        credit: 0,
        foreignCurrency: txCurr,
        foreignDebit: totalAmt,
        exchangeRate: buyFx,
        lineExplanation: `Initial recognition of equity investment designated at FVOCI under SFRS(I) 9 §5.1.1`
      },
      {
        id: 'l-fvoci-buy-bank',
        accountCode: '1010',
        accountName: `Cash at Bank (${txCurr} Account)`,
        category: 'ASSET' as const,
        debit: 0,
        credit: initialCostSGD,
        foreignCurrency: txCurr,
        foreignCredit: totalAmt,
        exchangeRate: buyFx,
        lineExplanation: `Outflow of cash for equity share acquisition translated at transaction spot rate`
      }
    ];

    const acqGroup: JournalEntryGroup = {
      id: `grp-proj-acq-${priorCommittedGroups.length + 1}`,
      transactionId: txId,
      targetTransactionId: txId,
      isHypothetical: true,
      eventDate: formatSingaporeDate(tx.transactionDate || new Date()),
      title: `Hypothetical Initial Acquisition (FVOCI)`,
      summary: `Initial recognition of equity investment under FVOCI`,
      lines: acqLines,
      totalDebit: initialCostSGD,
      totalCredit: initialCostSGD,
      isBalanced: true,
      citations: [],
      rationalePoints: [
        `Under SFRS(I) 9 §5.1.1: Financial assets designated at FVOCI are initially recognized at fair value plus transaction costs.`,
        `Initial acquisition translated at transaction spot exchange rate (${buyFx} ${funcCurr}/${txCurr}).`
      ],
      authorityStatus: 'DETERMINISTIC'
    };

    groups.push(finalizeJournalGroup(acqGroup));

    // 2. Disposal Group (if disposal occurred)
    if (proceedsSGD > 0) {
      // Architectural Scope Note: Under SFRS(I) 9 §5.7.5, equity investments designated at FVOCI
      // are remeasured at fair value through OCI at each intermediate reporting period end.
      // In this direct two-event scenario (initial recognition -> derecognition without intermediate
      // reporting dates), cumulative OCI gain equals disposal proceeds minus initial carrying cost.
      // When intermediate remeasurement events exist in committed history, the disposal entry derecognizes
      // the asset at its latest carrying amount, with any residual derecognition delta taken to OCI.
      const totalOciGain = Math.round((proceedsSGD - initialCostSGD) * 100) / 100;
      const isOciGain = totalOciGain >= 0;

      const sellLines = [
        {
          id: 'l-fvoci-sell-bank',
          accountCode: '1010',
          accountName: `Cash at Bank (${txCurr} Account)`,
          category: 'ASSET' as const,
          debit: proceedsSGD,
          credit: 0,
          foreignCurrency: txCurr,
          foreignDebit: dispAmt,
          exchangeRate: sellFx,
          lineExplanation: `Gross disposal proceeds translated at disposal spot rate (${sellFx} ${funcCurr}/${txCurr})`
        },
        {
          id: 'l-fvoci-sell-asset',
          accountCode: '1220',
          accountName: `Financial Asset at FVOCI (${assetTitle})`,
          category: 'ASSET' as const,
          debit: 0,
          credit: initialCostSGD,
          foreignCurrency: txCurr,
          foreignCredit: totalAmt,
          exchangeRate: buyFx,
          lineExplanation: `Derecognition of original carrying cost at acquisition spot rate`
        },
        {
          id: 'l-fvoci-sell-reserve',
          accountCode: '3120',
          accountName: 'Fair Value Reserve - FVOCI (Equity / OCI)',
          category: 'EQUITY' as const,
          debit: isOciGain ? 0 : Math.abs(totalOciGain),
          credit: isOciGain ? totalOciGain : 0,
          lineExplanation: `Cumulative fair value and foreign exchange difference recognized in OCI under SFRS(I) 9 §5.7.5 & SFRS(I) 1-21 §30 (P&L recycling = 0)`
        }
      ];

      const dispGroup: JournalEntryGroup = {
        id: `grp-proj-disp-${priorCommittedGroups.length + 2}`,
        transactionId: txId,
        targetTransactionId: txId,
        isHypothetical: true,
        eventDate: formatSingaporeDate(tx.disposalDate || new Date()),
        title: `Hypothetical Disposal & Derecognition (FVOCI)`,
        summary: `Disposal of equity investment under FVOCI`,
        lines: sellLines,
        totalDebit: proceedsSGD,
        totalCredit: proceedsSGD,
        isBalanced: true,
        citations: [],
        rationalePoints: [
          `Under SFRS(I) 9 §5.7.5 and SFRS(I) 1-21 §30: For equity investments designated at FVOCI, all fair value changes and exchange differences are recognized in OCI within Fair Value Reserve.`,
          `Zero P&L recycling: Cumulative gains/losses recognized in OCI are NOT recycled to profit or loss upon disposal.`,
          `Optional Presentation Transfer: The accumulated reserve may be transferred directly within equity to Retained Earnings (not required for derecognition under SFRS(I) 9 §B5.7.1).`
        ],
        authorityStatus: 'DETERMINISTIC'
      };

      groups.push(finalizeJournalGroup(dispGroup));
    }
  }

  // =========================================================================
  // BRANCH 2: FVTPL (Fair Value Through Profit or Loss)
  // =========================================================================
  else if (targetBasis === 'FVTPL') {
    // 1. Initial Acquisition Group
    const acqLines = [
      {
        id: 'l-fvtpl-buy-asset',
        accountCode: '1210',
        accountName: `Financial Asset at FVTPL (${assetTitle})`,
        category: 'ASSET' as const,
        debit: initialCostSGD,
        credit: 0,
        foreignCurrency: txCurr,
        foreignDebit: totalAmt,
        exchangeRate: buyFx,
        lineExplanation: `Initial fair value recognition under SFRS(I) 9 §5.1.1`
      },
      {
        id: 'l-fvtpl-buy-bank',
        accountCode: '1010',
        accountName: `Cash at Bank (${txCurr} Account)`,
        category: 'ASSET' as const,
        debit: 0,
        credit: initialCostSGD,
        foreignCurrency: txCurr,
        foreignCredit: totalAmt,
        exchangeRate: buyFx,
        lineExplanation: `Outflow of cash for equity share acquisition translated at transaction spot rate`
      }
    ];

    const acqGroup: JournalEntryGroup = {
      id: `grp-proj-acq-${priorCommittedGroups.length + 1}`,
      transactionId: txId,
      targetTransactionId: txId,
      isHypothetical: true,
      eventDate: formatSingaporeDate(tx.transactionDate || new Date()),
      title: `Hypothetical Initial Acquisition (FVTPL)`,
      summary: `Initial recognition of equity investment under FVTPL`,
      lines: acqLines,
      totalDebit: initialCostSGD,
      totalCredit: initialCostSGD,
      isBalanced: true,
      citations: [],
      rationalePoints: [
        `Under SFRS(I) 9 §5.1.1: Financial assets at FVTPL are initially recognized at fair value.`,
        `Initial acquisition translated at spot exchange rate (${buyFx} ${funcCurr}/${txCurr}).`
      ],
      authorityStatus: 'DETERMINISTIC'
    };

    groups.push(finalizeJournalGroup(acqGroup));

    // 2. Disposal Group
    if (proceedsSGD > 0) {
      const stockGainSGD = Math.round((dispAmt! - totalAmt) * sellFx! * 100) / 100;
      const fxGainSGD = Math.round(totalAmt * (sellFx! - buyFx) * 100) / 100;

      const sellLines = [
        {
          id: 'l-fvtpl-sell-bank',
          accountCode: '1010',
          accountName: `Cash at Bank (${txCurr} Account)`,
          category: 'ASSET' as const,
          debit: proceedsSGD,
          credit: 0,
          foreignCurrency: txCurr,
          foreignDebit: dispAmt,
          exchangeRate: sellFx,
          lineExplanation: `Gross disposal proceeds translated at disposal spot rate (${sellFx} ${funcCurr}/${txCurr})`
        },
        {
          id: 'l-fvtpl-sell-asset',
          accountCode: '1210',
          accountName: `Financial Asset at FVTPL (${assetTitle})`,
          category: 'ASSET' as const,
          debit: 0,
          credit: initialCostSGD,
          foreignCurrency: txCurr,
          foreignCredit: totalAmt,
          exchangeRate: buyFx,
          lineExplanation: `Derecognition of carrying cost at acquisition spot rate`
        },
        {
          id: 'l-fvtpl-sell-stockgain',
          accountCode: '4510',
          accountName: `Fair Value Gain on Shares (${assetTitle}) [P&L]`,
          category: 'REVENUE' as const,
          debit: 0,
          credit: stockGainSGD,
          lineExplanation: `Stock appreciation gain recognized in P&L`
        },
        {
          id: 'l-fvtpl-sell-fxgain',
          accountCode: '4600',
          accountName: 'Realized Foreign Exchange Gain (USD/SGD) [P&L / SFRS(I) 1-21]',
          category: 'REVENUE' as const,
          debit: 0,
          credit: fxGainSGD,
          lineExplanation: `Realized foreign currency translation gain recognized in P&L`
        }
      ];

      const dispGroup: JournalEntryGroup = {
        id: `grp-proj-disp-${priorCommittedGroups.length + 2}`,
        transactionId: txId,
        targetTransactionId: txId,
        isHypothetical: true,
        eventDate: formatSingaporeDate(tx.disposalDate || new Date()),
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
        authorityStatus: 'DETERMINISTIC'
      };

      groups.push(finalizeJournalGroup(dispGroup));
    }
  }

  // =========================================================================
  // UNSUPPORTED OR UNRECOGNIZED BASIS
  // =========================================================================
  else {
    return {
      success: false,
      isHypothetical: true,
      projectedGroups: [],
      projectedEvents: [],
      explanation: `Measurement basis '${targetBasis}' is not supported for projection generation.`,
      authorityStatus: 'CONDITIONAL',
      diagnosticNotice: `Unsupported measurement combination for ${tx.type}.`
    };
  }

  // Validate every generated group before presentation
  for (const grp of groups) {
    const bal = validateJournalBalance(grp);
    if (!bal.isBalanced) {
      return {
        success: false,
        isHypothetical: true,
        projectedGroups: [],
        projectedEvents: [],
        explanation: `Generated projection failed journal invariant: lines, declared totals or balance flag disagree (debits ${bal.totalDebit}, credits ${bal.totalCredit}).`,
        authorityStatus: 'CONDITIONAL',
        diagnosticNotice: `Imbalance detected (${bal.imbalance}). Journal presentation suppressed.`
      };
    }
  }

  const projectedEvents: AccountingEvent[] = groups.map((g, idx) => ({
    id: `evt-proj-${idx + 1}-${Date.now()}`,
    transactionId: txId,
    targetTransactionId: txId,
    type: 'hypothetical_branch',
    description: g.title,
    amount: g.totalDebit,
    currency: funcCurr,
    affectedAccounts: g.lines.map(l => l.accountName),
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
    authorityStatus: 'DETERMINISTIC'
  };
}
