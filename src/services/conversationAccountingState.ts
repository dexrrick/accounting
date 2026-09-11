import type { AccountingScenarioState, JournalEntryGroup, JournalLine } from '../types/accounting';
import type {
  AccountingEvent,
  AccountingEventType,
  AccountingDelta,
  ConversationAccountingContext,
  FollowUpEventAnalysis,
  OutstandingAccountBalance,
  TargetResolutionResult,
  CandidateScore,
  TargetResolutionCriteria,
  OwnershipContext,
  TransactionNatureType,
  InstrumentType
} from '../types/conversationState';
import { formatSingaporeDate } from '../utils/dateUtils';

export type { TargetResolutionCriteria };

/**
 * Deterministically generates a standardized unique balance key.
 * Format: `${accountCode || normalize(accountName)}_${counterpartyRole || 'none'}_${transactionId || 'default'}`
 */
export function generateBalanceKey(
  accountCode?: string,
  accountName?: string,
  counterpartyRole?: string,
  transactionId?: string
): string {
  const codeOrName = (accountCode && accountCode.trim())
    ? accountCode.trim().toLowerCase()
    : (accountName || 'unknown').trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
  const role = (counterpartyRole && counterpartyRole.trim()) ? counterpartyRole.trim().toLowerCase() : 'none';
  const tx = (transactionId && transactionId.trim()) ? transactionId.trim().toLowerCase() : 'default';
  return `${codeOrName}_${role}_${tx}`;
}

/**
 * Replays an immutable sequence of accounting events to derive deterministic account balances
 * and cumulative recognized equity.
 */
export function deriveAccountingStateFromEvents(
  events: AccountingEvent[],
  functionalCurrency: string = 'SGD'
): {
  outstandingBalances: OutstandingAccountBalance[];
  recognizedEquityTotal: number;
} {
  const balancesMap = new Map<string, OutstandingAccountBalance>();
  let recognizedEquityTotal = 0;

  for (const ev of events) {
    const lines = ev.journalLines || [];
    const eventCurrency = ev.currency || functionalCurrency;

    // Process journal lines for initial transactions and recognitions
    for (const line of lines) {
      const nameLower = line.accountName.toLowerCase();

      // 1. Detect Outstanding Receivables (Asset debit)
      if (
        line.category === 'ASSET' &&
        line.debit > 0 &&
        (nameLower.includes('due from') ||
         nameLower.includes('receivable') ||
         nameLower.includes('debtor') ||
         nameLower.includes('unpaid'))
      ) {
        const role = nameLower.includes('shareholder') ? 'shareholder' :
                     nameLower.includes('director') ? 'director' :
                     nameLower.includes('customer') ? 'customer' : 'other';
        const txId = ev.transactionId || ev.id || 'default';
        const key = generateBalanceKey(line.accountCode, line.accountName, role, txId);

        if (!balancesMap.has(key)) {
          balancesMap.set(key, {
            balanceKey: key,
            accountCode: line.accountCode,
            accountName: line.accountName,
            category: 'ASSET',
            nature: 'RECEIVABLE',
            counterpartyRole: role,
            transactionId: txId,
            originalAmount: line.debit,
            settledAmount: 0,
            remainingAmount: line.debit,
            currency: eventCurrency
          });
        } else {
          const existing = balancesMap.get(key)!;
          existing.originalAmount += line.debit;
          existing.remainingAmount += line.debit;
        }
      }

      // 2. Detect Outstanding Payables (Liability credit)
      if (
        line.category === 'LIABILITY' &&
        line.credit > 0 &&
        (nameLower.includes('due to') ||
         nameLower.includes('payable') ||
         nameLower.includes('creditor'))
      ) {
        const role = nameLower.includes('shareholder') ? 'shareholder' :
                     nameLower.includes('director') ? 'director' :
                     nameLower.includes('supplier') ? 'supplier' : 'other';
        const txId = ev.transactionId || ev.id || 'default';
        const key = generateBalanceKey(line.accountCode, line.accountName, role, txId);

        if (!balancesMap.has(key)) {
          balancesMap.set(key, {
            balanceKey: key,
            accountCode: line.accountCode,
            accountName: line.accountName,
            category: 'LIABILITY',
            nature: 'PAYABLE',
            counterpartyRole: role,
            transactionId: txId,
            originalAmount: line.credit,
            settledAmount: 0,
            remainingAmount: line.credit,
            currency: eventCurrency
          });
        } else {
          const existing = balancesMap.get(key)!;
          existing.originalAmount += line.credit;
          existing.remainingAmount += line.credit;
        }
      }

      // 3. Track Recognized Equity (Credit to Share Capital)
      if (line.category === 'EQUITY' && line.credit > 0 && nameLower.includes('share capital')) {
        recognizedEquityTotal += line.credit;
      }
    }

    // Process settlements
    if (ev.type === 'settlement' || ev.type === 'partial_settlement') {
      let targetBal: OutstandingAccountBalance | undefined;
      // Match by explicit targetBalanceKey
      if (ev.targetBalanceKey && balancesMap.has(ev.targetBalanceKey)) {
        targetBal = balancesMap.get(ev.targetBalanceKey);
      }
      // Match by authoritative targetTransactionId
      else if (ev.targetTransactionId) {
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

/**
 * Resolves the target outstanding account balance using multi-factor scoring
 * and explicit ambiguity detection.
 */
export function resolveSettlementTarget(
  context: ConversationAccountingContext,
  criteria: TargetResolutionCriteria
): TargetResolutionResult {
  if (!context.outstandingBalances || context.outstandingBalances.length === 0) {
    return {
      resolutionStatus: 'NOT_FOUND',
      confidence: 0,
      margin: 0,
      candidateScores: [],
      reason: 'No outstanding balances recorded in context'
    };
  }

  const candidateScores: CandidateScore[] = [];

  for (const b of context.outstandingBalances) {
    let score = 0;
    const rationales: string[] = [];

    // 0. Authoritative Transaction ID match
    if (criteria.transactionId) {
      const critTx = criteria.transactionId.toLowerCase().trim();
      const balTx = (b.transactionId || '').toLowerCase().trim();
      if (critTx === balTx) {
        score += 15;
        rationales.push(`Authoritative transaction ID match [${critTx}] (+15)`);
      } else if (balTx && balTx !== 'default') {
        score -= 20;
        rationales.push(`Conflicting transaction ID [${critTx} vs ${balTx}] (-20)`);
      }
    }

    // 1. Account Name match
    if (criteria.accountName) {
      const critName = criteria.accountName.toLowerCase().trim();
      const balName = b.accountName.toLowerCase().trim();
      if (critName === balName) {
        score += 10;
        rationales.push('Exact account name match (+10)');
      } else if (balName.includes(critName) || critName.includes(balName)) {
        score += 6;
        rationales.push('Partial account name match (+6)');
      }
    }

    // 2. Counterparty Role match
    if (criteria.counterpartyRole) {
      const critRole = criteria.counterpartyRole.toLowerCase().trim();
      const balRole = (b.counterpartyRole || '').toLowerCase().trim();
      if (critRole === balRole) {
        score += 8;
        rationales.push(`Counterparty role match [${critRole}] (+8)`);
      } else if (balRole && critRole && balRole !== 'none' && critRole !== 'none') {
        score -= 8;
        rationales.push(`Conflicting counterparty role [${critRole} vs ${balRole}] (-8)`);
      }
    }

    // 3. Nature match (RECEIVABLE vs PAYABLE)
    if (criteria.nature) {
      if (criteria.nature === b.nature) {
        score += 5;
        rationales.push(`Account nature match [${b.nature}] (+5)`);
      } else {
        score -= 10;
        rationales.push(`Opposite account nature [${criteria.nature} vs ${b.nature}] (-10)`);
      }
    }

    // 4. Query tokens hints
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

    // 5. Viability: Remaining balance > 0
    if (b.remainingAmount > 0) {
      score += 2;
      rationales.push('Account has positive outstanding balance (+2)');
    }

    // 6. Amount match (exact amount match to remaining balance)
    if (criteria.amount && criteria.amount > 0 && Math.abs(b.remainingAmount - criteria.amount) < 0.01) {
      score += 3;
      rationales.push(`Settlement amount matches exact outstanding balance (${criteria.amount}) (+3)`);
    }

    candidateScores.push({
      balanceKey: b.balanceKey,
      accountName: b.accountName,
      transactionId: b.transactionId,
      score,
      rationale: rationales.join('; ')
    });
  }

  // Sort descending by score
  candidateScores.sort((a, b) => b.score - a.score);

  const topCandidateScore = candidateScores[0];
  if (!topCandidateScore || topCandidateScore.score <= 0) {
    return {
      resolutionStatus: 'NOT_FOUND',
      confidence: 0,
      margin: 0,
      candidateScores,
      reason: 'No candidate balance matched with a positive score'
    };
  }

  const topBalance = context.outstandingBalances.find(b => b.balanceKey === topCandidateScore.balanceKey);

  // If single candidate
  if (candidateScores.length === 1) {
    const confidence = Math.min(1.0, topCandidateScore.score / 15);
    return {
      targetBalance: topBalance,
      resolutionStatus: confidence >= 0.25 ? 'RESOLVED' : 'NOT_FOUND',
      confidence: Math.round(confidence * 100) / 100,
      margin: topCandidateScore.score,
      candidateScores,
      reason: `Single candidate matched with score ${topCandidateScore.score}`
    };
  }

  // If multiple candidates
  const secondCandidateScore = candidateScores[1];
  const margin = Math.round((topCandidateScore.score - secondCandidateScore.score) * 100) / 100;
  const confidence = Math.min(1.0, Math.max(0, topCandidateScore.score / 20));

  if (margin < 2.0) {
    return {
      resolutionStatus: 'AMBIGUOUS',
      confidence: Math.round(confidence * 100) / 100,
      margin,
      candidateScores,
      reason: `Ambiguous match: top candidate (${topCandidateScore.accountName}, score ${topCandidateScore.score}) and second candidate (${secondCandidateScore.accountName}, score ${secondCandidateScore.score}) have margin of ${margin} (< 2.0)`
    };
  }

  return {
    targetBalance: topBalance,
    resolutionStatus: 'RESOLVED',
    confidence: Math.round(confidence * 100) / 100,
    margin,
    candidateScores,
    reason: `Resolved decisively with margin ${margin}`
  };
}

/**
 * Derives structured conversation accounting context from the active scenario state and history.
 */
export function extractAccountingContext(
  currentScenario?: AccountingScenarioState | null,
  _chatHistory?: any[]
): ConversationAccountingContext {
  // Committed direct groups (excluding any hypothetical projections)
  const priorJournals: JournalEntryGroup[] = (currentScenario?.committedDirectGroups && currentScenario.committedDirectGroups.length > 0)
    ? [...currentScenario.committedDirectGroups]
    : (currentScenario?.directGroups ? currentScenario.directGroups.filter(g => !g.isHypothetical) : []);

  // Determine base actual events (source of truth - strictly committed history)
  let actualEvents: AccountingEvent[] = [];
  if (currentScenario?.actualEvents && currentScenario.actualEvents.length > 0) {
    actualEvents = currentScenario.actualEvents.filter(e => !e.isHypothetical);
  } else if (priorJournals.length > 0) {
    actualEvents = priorJournals.map((grp, idx) => ({
      id: grp.id || `evt-init-${idx + 1}`,
      transactionId: grp.transactionId || grp.id || `tx-init-${idx + 1}`,
      targetTransactionId: grp.targetTransactionId,
      type: (grp.title && grp.title.toLowerCase().includes('settle')) ? 'settlement' : 'initial_transaction',
      description: grp.title || 'Initial transaction',
      amount: grp.totalDebit,
      currency: currentScenario?.transactionCurrency || currentScenario?.functionalCurrency || 'SGD',
      affectedAccounts: grp.lines.map(l => l.accountName),
      journalLines: grp.lines,
      isHypothetical: false,
      timestamp: grp.eventDate,
      eventDate: grp.eventDate
    }));
  }

  // Replay actual events to derive deterministic balances and equity
  const derived = deriveAccountingStateFromEvents(
    actualEvents,
    currentScenario?.transactionCurrency || currentScenario?.functionalCurrency || 'SGD'
  );

  const outstandingBalances: OutstandingAccountBalance[] = [...derived.outstandingBalances];
  const recognizedEquityTotal = derived.recognizedEquityTotal;

  // Determine ownership context from prior scenario structured state
  let ownershipContext: OwnershipContext = 'unknown';
  if (currentScenario?.ownershipContext && currentScenario.ownershipContext !== 'unknown') {
    ownershipContext = currentScenario.ownershipContext;
  } else if (currentScenario?.semanticUnderstanding?.ownershipContext && currentScenario.semanticUnderstanding.ownershipContext !== 'unknown') {
    ownershipContext = currentScenario.semanticUnderstanding.ownershipContext;
  } else if (recognizedEquityTotal > 0) {
    ownershipContext = 'own_equity';
  } else if (currentScenario?.scenarioType === 'EQUITY_INVESTMENT_FX') {
    ownershipContext = 'external_investment';
  } else if (currentScenario) {
    ownershipContext = 'not_applicable';
  }

  const mapScenarioTypeToNature = (scenarioType?: string): TransactionNatureType => {
    switch (scenarioType) {
      case 'SHARE_CAPITAL_UNPAID':
      case 'SHARE_CAPITAL_PAID':
        return 'equity_issuance_subscription';
      case 'EQUITY_INVESTMENT_FX':
        return 'equity_investment_acquisition';
      case 'COMMERCIAL_LEASE':
        return 'lease_contract';
      case 'INTANGIBLE_ASSET_CAP':
        return 'rd_capitalization';
      case 'PPE_IAS16':
        return 'asset_purchase';
      case 'ASSET_PURCHASE_DISCOUNT':
        return 'trade_discount_purchase';
      case 'CUSTOMER_ADVANCE':
        return 'customer_advance_payment';
      case 'DIRECTOR_EXPENSE':
        return 'director_expense_settlement';
      case 'GENERAL_EXPENSE':
        return 'expense_payment';
      default:
        return 'unclassified_transaction';
    }
  };

  const resolvedTxType: TransactionNatureType =
    currentScenario?.semanticUnderstanding?.transactionType ||
    mapScenarioTypeToNature(currentScenario?.scenarioType);

  const resolvedInstrument: InstrumentType =
    currentScenario?.semanticUnderstanding?.instrument ||
    (ownershipContext === 'own_equity' || ownershipContext === 'own_company_equity'
      ? 'own_equity'
      : (ownershipContext === 'external_investment' || ownershipContext === 'external_entity_equity'
        ? 'financial_asset_equity'
        : 'unknown'));

  return {
    activeEntity: {
      type: 'company',
      description: 'Reporting entity Singapore business'
    },
    underlyingTransaction: currentScenario ? {
      type: resolvedTxType,
      subject: currentScenario.transactionTitle || 'Commercial Transaction',
      ownershipContext,
      instrument: resolvedInstrument,
      totalAmount: currentScenario.amount,
      currency: currentScenario.transactionCurrency || currentScenario.functionalCurrency || 'SGD'
    } : undefined,
    events: currentScenario?.accountingEvents || actualEvents,
    actualEvents,
    outstandingBalances,
    recognizedEquityTotal,
    priorJournals,
    isHypothetical: Boolean(currentScenario?.isHypothetical)
  };
}

let settlementEventCounter = 0;

/**
 * Calculates the accounting delta caused by a follow-up event on the established state.
 */
export function calculateAccountingDelta(
  context: ConversationAccountingContext,
  eventAnalysis: FollowUpEventAnalysis,
  currency: string = 'SGD'
): AccountingDelta | null {
  if (eventAnalysis.eventType !== 'settlement' && eventAnalysis.eventType !== 'partial_settlement') {
    return null;
  }

  const queryTokens: string[] = [];
  const targetAcc = (eventAnalysis.targetOutstandingAccount || '').toLowerCase();
  const expl = (eventAnalysis.explanation || '').toLowerCase();

  if (targetAcc.includes('shareholder') || expl.includes('shareholder')) queryTokens.push('shareholder');
  if (targetAcc.includes('director') || expl.includes('director')) queryTokens.push('director');
  if (targetAcc.includes('customer') || expl.includes('customer')) queryTokens.push('customer');
  if (targetAcc.includes('supplier') || expl.includes('supplier')) queryTokens.push('supplier');

  const counterpartyRole = queryTokens.includes('shareholder') ? 'shareholder' :
                           queryTokens.includes('director') ? 'director' :
                           queryTokens.includes('customer') ? 'customer' :
                           queryTokens.includes('supplier') ? 'supplier' : undefined;

  const criteria: TargetResolutionCriteria = {
    accountName: eventAnalysis.targetOutstandingAccount,
    counterpartyRole,
    nature: 'RECEIVABLE',
    queryTokens,
    currency,
    amount: eventAnalysis.settlementAmount
  };

  const resolution = resolveSettlementTarget(context, criteria);

  // Authoritative validation: Target balance must be found legitimately in context
  if (resolution.resolutionStatus !== 'RESOLVED' || !resolution.targetBalance) {
    return null;
  }

  const targetBalance = resolution.targetBalance;
  const settlementAmount = Math.round(
    (eventAnalysis.settlementAmount !== undefined && eventAnalysis.settlementAmount > 0
      ? eventAnalysis.settlementAmount
      : targetBalance.remainingAmount) * 100
  ) / 100;

  const previousBalance = targetBalance.remainingAmount;
  const isOverpayment = settlementAmount > previousBalance;
  const isPartial = settlementAmount < previousBalance;
  const resolvedEventType: AccountingEventType = isPartial ? 'partial_settlement' : 'settlement';
  const effectiveSettledOnReceivable = isOverpayment ? previousBalance : settlementAmount;
  const resultingBalance = Math.max(0, Math.round((previousBalance - settlementAmount) * 100) / 100);

  const lines: JournalLine[] = [
    {
      id: 'l-settle-bank',
      accountCode: '1010',
      accountName: 'Cash at Bank (Current Account)',
      category: 'ASSET',
      debit: settlementAmount,
      credit: 0,
      lineExplanation: `Receipt of settlement funds into company bank account (${currency} ${settlementAmount.toFixed(2)})`
    },
    {
      id: 'l-settle-receivable',
      accountCode: targetBalance.accountCode || '1150',
      accountName: targetBalance.accountName,
      category: targetBalance.category,
      debit: 0,
      credit: effectiveSettledOnReceivable,
      lineExplanation: `Settlement and derecognition of outstanding ${targetBalance.accountName}`
    }
  ];

  if (isOverpayment) {
    const excess = Math.round((settlementAmount - previousBalance) * 100) / 100;
    lines.push({
      id: 'l-settle-excess',
      accountCode: '2050',
      accountName: 'Other Payables / Shareholder Advance',
      category: 'LIABILITY',
      debit: 0,
      credit: excess,
      lineExplanation: `Excess funds received beyond outstanding receivable (${currency} ${excess.toFixed(2)}) held as payable`
    });
  }

  const prefix = eventAnalysis.isHypothetical ? 'Hypothetical' : 'Subsequent';
  const explanation = `${prefix} settlement of outstanding ${targetBalance.accountName} via bank transfer. ` +
    `Note: Share Capital is NOT credited again because it was already recognized upon allotment. ` +
    `Remaining balance on ${targetBalance.accountName}: ${currency} ${resultingBalance.toFixed(2)}.`;

  settlementEventCounter++;
  const uniqueIdSuffix = `${Date.now()}-${settlementEventCounter}-${Math.random().toString(36).slice(2, 6)}`;
  const resultingAccountingEvent: AccountingEvent = {
    id: `evt-settle-${uniqueIdSuffix}`,
    transactionId: `tx-settle-${uniqueIdSuffix}`,
    targetTransactionId: targetBalance.transactionId,
    type: resolvedEventType,
    description: explanation,
    amount: settlementAmount,
    currency,
    affectedAccounts: lines.map(l => l.accountName),
    isHypothetical: Boolean(eventAnalysis.isHypothetical),
    targetBalanceKey: targetBalance.balanceKey,
    journalLines: lines,
    timestamp: new Date().toISOString(),
    eventDate: formatSingaporeDate(new Date())
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

/**
 * Validates a multi-turn accounting state transition against core accounting invariants.
 */
export function validateAccountingStateTransition(
  context: ConversationAccountingContext,
  proposedLines: JournalLine[],
  eventType: string
): { isValid: boolean; violations: string[] } {
  const violations: string[] = [];

  // Guardrail A: No Duplicate Equity Recognition
  // If Share Capital was already credited in prior turns and current event is a settlement,
  // Share Capital must NOT be credited again!
  if (eventType === 'settlement' || eventType === 'partial_settlement') {
    const creditsShareCapital = proposedLines.some(
      l => l.credit > 0 && l.accountName.toLowerCase().includes('share capital')
    );
    if (creditsShareCapital && context.recognizedEquityTotal > 0) {
      violations.push(
        'GUARDRAIL_VIOLATION_DUPLICATE_EQUITY: Share Capital was already recognized upon initial allotment. Subsequent settlement must credit the receivable, not Share Capital again.'
      );
    }
  }

  // Guardrail C: Settlement must credit the correct outstanding account
  if (eventType === 'settlement' || eventType === 'partial_settlement') {
    const hasReceivableCredit = proposedLines.some(
      l => l.credit > 0 &&
      (l.accountName.toLowerCase().includes('due from') ||
       l.accountName.toLowerCase().includes('receivable') ||
       l.accountName.toLowerCase().includes('debtor'))
    );
    if (!hasReceivableCredit && context.outstandingBalances.some(b => b.nature === 'RECEIVABLE')) {
      violations.push(
        'GUARDRAIL_VIOLATION_SETTLEMENT_TARGET: Settlement payment must credit the outstanding receivable account.'
      );
    }
  }

  // Guardrail D: Double-entry balance
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

/**
 * Commits an accounting event to the committed event history.
 * Enforces:
 * 1. Events must not be hypothetical.
 * 2. transactionId is mandatory and authoritative (non-empty, != "default").
 * 3. Settlement events must have an authoritative target identity (targetTransactionId or targetBalanceKey).
 * 4. Enforces uniqueness of transactionId across committed events.
 */
export function commitAccountingEvent(
  committedList: AccountingEvent[],
  newEvent: AccountingEvent
): AccountingEvent[] {
  if (newEvent.isHypothetical) {
    throw new Error(`Cannot commit hypothetical event [${newEvent.id || 'unknown'}] to actual history.`);
  }

  const txId = (newEvent.transactionId || '').trim();
  if (!txId || txId.toLowerCase() === 'default') {
    throw new Error(`INVALID_TRANSACTION_ID: Committed event must have an authoritative, non-empty transactionId (received "${newEvent.transactionId}"). "default" is not permitted.`);
  }

  // Settlement events require target identity
  if (newEvent.type === 'settlement' || newEvent.type === 'partial_settlement') {
    const hasTargetTx = Boolean(newEvent.targetTransactionId && newEvent.targetTransactionId.trim() && newEvent.targetTransactionId.trim().toLowerCase() !== 'default');
    const hasTargetBal = Boolean(newEvent.targetBalanceKey && newEvent.targetBalanceKey.trim());
    if (!hasTargetTx && !hasTargetBal) {
      throw new Error(`INVALID_SETTLEMENT_TARGET: Committed settlement event [${txId}] must have an authoritative targetTransactionId or targetBalanceKey.`);
    }
  }

  const eventToCommit: AccountingEvent = {
    ...newEvent,
    transactionId: txId,
    isHypothetical: false
  };
  
  if (committedList.some(e => (e.transactionId || '').trim().toLowerCase() === txId.toLowerCase())) {
    throw new Error(`DUPLICATE_TRANSACTION_ID: Event with transactionId "${txId}" is already committed.`);
  }

  return [...committedList, eventToCommit];
}

