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
  type: AccountingEventType;
  description: string;
  amount?: number;
  currency?: string | null;
  affectedAccounts?: string[];
  sourceTurn?: number;
  isHypothetical?: boolean;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export interface OutstandingAccountBalance {
  accountCode?: string;
  accountName: string;
  category: 'ASSET' | 'LIABILITY' | 'EQUITY';
  nature: 'RECEIVABLE' | 'PAYABLE' | 'DEPOSIT';
  counterpartyRole?: string;
  counterpartyName?: string;
  originalAmount: number;
  settledAmount: number;
  remainingAmount: number;
  currency: string;
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
  outstandingBalances: OutstandingAccountBalance[];
  recognizedEquityTotal: number;
  priorJournals: JournalEntryGroup[];
}

export interface FollowUpEventAnalysis {
  eventType: AccountingEventType;
  isFollowUp: boolean;
  targetOutstandingAccount?: string;
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
    accountName: string;
    previousBalance: number;
    delta: number;
    resultingBalance: number;
  }>;
  explanation: string;
}
