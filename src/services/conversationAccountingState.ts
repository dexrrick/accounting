import type { AccountingScenarioState, JournalEntryGroup, JournalLine } from '../types/accounting';
import type {
  AccountingEvent,
  AccountingDelta,
  ConversationAccountingContext,
  FollowUpEventAnalysis,
  OutstandingAccountBalance
} from '../types/conversationState';

/**
 * Derives structured conversation accounting context from the active scenario state and history.
 */
export function extractAccountingContext(
  currentScenario?: AccountingScenarioState | null,
  _chatHistory?: any[]
): ConversationAccountingContext {
  const outstandingBalances: OutstandingAccountBalance[] = [];
  const events: AccountingEvent[] = [];
  let recognizedEquityTotal = 0;
  const priorJournals: JournalEntryGroup[] = currentScenario?.directGroups ? [...currentScenario.directGroups] : [];

  if (currentScenario?.directGroups && currentScenario.directGroups.length > 0) {
    for (const grp of currentScenario.directGroups) {
      for (const line of grp.lines) {
        const nameLower = line.accountName.toLowerCase();

        // 1. Detect Outstanding Receivables (Asset with positive debit)
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

          outstandingBalances.push({
            accountCode: line.accountCode,
            accountName: line.accountName,
            category: 'ASSET',
            nature: 'RECEIVABLE',
            counterpartyRole: role,
            originalAmount: line.debit,
            settledAmount: 0,
            remainingAmount: line.debit,
            currency: currentScenario.transactionCurrency || currentScenario.functionalCurrency || 'SGD'
          });
        }

        // 2. Detect Outstanding Payables (Liability with positive credit)
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

          outstandingBalances.push({
            accountCode: line.accountCode,
            accountName: line.accountName,
            category: 'LIABILITY',
            nature: 'PAYABLE',
            counterpartyRole: role,
            originalAmount: line.credit,
            settledAmount: 0,
            remainingAmount: line.credit,
            currency: currentScenario.transactionCurrency || currentScenario.functionalCurrency || 'SGD'
          });
        }

        // 3. Track Recognized Equity
        if (line.category === 'EQUITY' && line.credit > 0 && nameLower.includes('share capital')) {
          recognizedEquityTotal += line.credit;
        }
      }

      events.push({
        id: grp.id,
        type: 'initial_transaction',
        description: grp.title,
        amount: grp.totalDebit,
        currency: currentScenario.transactionCurrency || 'SGD',
        affectedAccounts: grp.lines.map(l => l.accountName),
        timestamp: grp.eventDate
      });
    }
  }

  // Determine ownership context from prior scenario
  let ownershipContext: 'own_equity' | 'external_investment' | 'not_applicable' | 'unknown' = 'unknown';
  const titleLower = (currentScenario?.transactionTitle || '').toLowerCase();
  const rawQueryLower = (currentScenario?.rawQuery || '').toLowerCase();

  if (
    recognizedEquityTotal > 0 ||
    titleLower.includes('share capital') ||
    rawQueryLower.includes('own company') ||
    rawQueryLower.includes('share capital')
  ) {
    ownershipContext = 'own_equity';
  } else if (
    currentScenario?.scenarioType === 'EQUITY_INVESTMENT_FX' ||
    (currentScenario?.assetName && (currentScenario.assetName.toLowerCase().includes('apple') || currentScenario.assetName.toLowerCase().includes('aapl') || currentScenario.assetName.toLowerCase().includes('tesla'))) ||
    titleLower.includes('foreign') ||
    titleLower.includes('apple') ||
    rawQueryLower.includes('apple') ||
    rawQueryLower.includes('aapl') ||
    rawQueryLower.includes('foreign shares')
  ) {
    ownershipContext = 'external_investment';
  } else if (currentScenario) {
    ownershipContext = 'not_applicable';
  }

  return {
    activeEntity: {
      type: 'company',
      description: 'Reporting entity Singapore business'
    },
    underlyingTransaction: currentScenario ? {
      type: currentScenario.scenarioType,
      subject: currentScenario.transactionTitle || 'Commercial Transaction',
      ownershipContext,
      instrument: ownershipContext === 'own_equity' ? 'own_equity' : 'financial_instrument',
      totalAmount: currentScenario.amount,
      currency: currentScenario.transactionCurrency || currentScenario.functionalCurrency || 'SGD'
    } : undefined,
    events,
    outstandingBalances,
    recognizedEquityTotal,
    priorJournals
  };
}

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

  // Find target outstanding balance to settle
  let targetBalance: OutstandingAccountBalance | undefined;
  if (eventAnalysis.targetOutstandingAccount) {
    targetBalance = context.outstandingBalances.find(b =>
      b.accountName.toLowerCase().includes(eventAnalysis.targetOutstandingAccount!.toLowerCase())
    );
  }

  // Default to first receivable if settling shareholder/customer
  if (!targetBalance) {
    targetBalance = context.outstandingBalances.find(b => b.nature === 'RECEIVABLE');
  }

  if (!targetBalance) {
    // If no explicit outstanding item was recorded in balances, check if equity was recognized
    if (context.recognizedEquityTotal > 0) {
      targetBalance = {
        accountCode: '1150',
        accountName: 'Amount Due from Shareholder (Receivable)',
        category: 'ASSET',
        nature: 'RECEIVABLE',
        counterpartyRole: 'shareholder',
        originalAmount: context.recognizedEquityTotal,
        settledAmount: 0,
        remainingAmount: context.recognizedEquityTotal,
        currency
      };
    }
  }

  if (!targetBalance) {
    return null;
  }

  const settlementAmount = Math.round(
    (eventAnalysis.settlementAmount !== undefined && eventAnalysis.settlementAmount > 0
      ? eventAnalysis.settlementAmount
      : targetBalance.remainingAmount) * 100
  ) / 100;

  const previousBalance = targetBalance.remainingAmount;
  const isOverpayment = settlementAmount > previousBalance;
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

  // If overpayment occurred, credit excess to other payables / advance
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

  const explanation = `Subsequent settlement of outstanding ${targetBalance.accountName} via bank transfer. ` +
    `Note: Share Capital is NOT credited again because it was already recognized upon allotment. ` +
    `Remaining balance on ${targetBalance.accountName}: ${currency} ${resultingBalance.toFixed(2)}.`;

  return {
    eventType: eventAnalysis.eventType,
    journalLines: lines,
    amount: settlementAmount,
    currency,
    balanceUpdates: [
      {
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
