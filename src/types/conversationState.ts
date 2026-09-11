import type { JournalEntryGroup, JournalLine } from './accounting';

export type AccountingEventType =
  | 'initial_transaction'
  | 'settlement'
  | 'partial_settlement'
  | 'adjustment'
  | 'reversal'
  | 'modification'
  | 'hypothetical_change'
  | 'clarification'
  | 'other';

export interface AccountingEvent {
  id: string;
  transactionId: string;
  targetTransactionId?: string;
  type: AccountingEventType;
  description: string;
  amount?: number;
  currency?: string | null;
  affectedAccounts?: string[];
  sourceTurn?: number;
  isHypothetical?: boolean;
  timestamp?: string;
  eventDate?: string;
  journalLines?: JournalLine[];
  targetBalanceKey?: string;
  metadata?: Record<string, unknown>;
}

export interface OutstandingAccountBalance {
  balanceKey: string;
  accountCode?: string;
  accountName: string;
  category: 'ASSET' | 'LIABILITY' | 'EQUITY';
  nature: 'RECEIVABLE' | 'PAYABLE' | 'DEPOSIT';
  counterpartyRole?: string;
  counterpartyName?: string;
  transactionId?: string;
  originalAmount: number;
  settledAmount: number;
  remainingAmount: number;
  currency: string;
}

export interface TargetResolutionCriteria {
  accountName?: string;
  counterpartyRole?: string;
  counterpartyName?: string;
  transactionId?: string;
  nature?: 'RECEIVABLE' | 'PAYABLE' | 'DEPOSIT';
  queryTokens?: string[];
  currency?: string;
  amount?: number;
}

export interface CandidateScore {
  balanceKey: string;
  accountName: string;
  transactionId?: string;
  score: number;
  rationale: string;
}

export interface TargetResolutionResult {
  targetBalance?: OutstandingAccountBalance;
  resolutionStatus: 'RESOLVED' | 'AMBIGUOUS' | 'NOT_FOUND';
  confidence: number;
  margin?: number;
  candidateScores?: CandidateScore[];
  reason?: string;
}

export interface ConversationAccountingContext {
  activeEntity?: {
    type: 'company' | 'individual' | 'other' | 'unknown';
    description?: string;
  };
  underlyingTransaction?: {
    type: string;
    subject: string;
    ownershipContext: 'own_equity' | 'external_investment' | 'not_applicable' | 'unknown';
    instrument: string;
    totalAmount?: number;
    currency: string;
  };
  events: AccountingEvent[];
  actualEvents: AccountingEvent[];
  outstandingBalances: OutstandingAccountBalance[];
  recognizedEquityTotal: number;
  priorJournals: JournalEntryGroup[];
  isHypothetical?: boolean;
}

export interface FollowUpEventAnalysis {
  eventType: AccountingEventType;
  isFollowUp: boolean;
  targetCriteria?: TargetResolutionCriteria;
  targetOutstandingAccount?: string;
  targetBalanceKey?: string;
  targetTransactionId?: string;
  settlementAmount?: number;
  remainingReceivableOrPayable?: number;
  settlementAccount?: string;
  isHypothetical: boolean;
  explanation: string;
}

export interface AccountingDelta {
  eventType: AccountingEventType;
  journalLines: JournalLine[];
  amount: number;
  currency: string;
  balanceUpdates: Array<{
    balanceKey?: string;
    accountName: string;
    previousBalance: number;
    delta: number;
    resultingBalance: number;
  }>;
  isHypothetical?: boolean;
  targetBalanceKey?: string;
  resultingAccountingEvent?: AccountingEvent;
  explanation: string;
}
