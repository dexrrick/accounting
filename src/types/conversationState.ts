import type { JournalEntryGroup, JournalLine } from './accounting';

export type OwnershipContext =
  | 'own_equity'
  | 'own_company_equity'
  | 'external_investment'
  | 'external_entity_equity'
  | 'not_applicable'
  | 'unknown';

export type CounterpartyRole =
  | 'shareholder'
  | 'director_shareholder'
  | 'customer'
  | 'supplier'
  | 'employee'
  | 'lender'
  | 'director'
  | 'government'
  | 'investor'
  | 'other'
  | 'unknown';

export type TransactionNatureType =
  | 'equity_issuance_subscription'
  | 'share_capital_issuance'
  | 'share_subscription'
  | 'capital_reduction'
  | 'equity_investment_acquisition'
  | 'lease_contract'
  | 'lease_payment'
  | 'lease_liability_accrual'
  | 'software_development_expenditure'
  | 'rd_capitalization'
  | 'asset_acquisition'
  | 'asset_purchase'
  | 'depreciation_expense'
  | 'trade_discount_purchase'
  | 'customer_advance_payment'
  | 'customer_invoice'
  | 'director_expense_settlement'
  | 'director_fee_payment'
  | 'expense_payment'
  | 'inventory_purchase'
  | 'payroll_payment'
  | 'tax_payment'
  | 'tax_provision'
  | 'dividend_payment'
  | 'debt_settlement'
  | 'unclassified_transaction';

export type InstrumentType =
  | 'cash_at_bank'
  | 'accounts_receivable'
  | 'accounts_payable'
  | 'own_equity'
  | 'equity_instrument'
  | 'financial_asset_equity'
  | 'marketable_securities'
  | 'debt_instrument'
  | 'derivative'
  | 'fixed_asset'
  | 'property_plant_equipment'
  | 'intangible_asset'
  | 'right_of_use_asset'
  | 'lease_liability'
  | 'cash / trade receivable'
  | 'director current account liability'
  | 'right_of_use_asset_and_lease_liability'
  | 'unknown'
  | 'intangible_asset_or_expense'
  | 'ppe_asset'
  | 'trade_payable'
  | 'director_current_account'
  | 'financial_instrument';

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
  counterpartyRole?: CounterpartyRole | string;
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
    type: TransactionNatureType | string;
    subject: string;
    ownershipContext: OwnershipContext;
    instrument: InstrumentType | string;
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
