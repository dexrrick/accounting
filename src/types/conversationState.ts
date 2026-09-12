import type { JournalEntryGroup, JournalLine } from './accounting';

/**
 * Canonical Ownership Context.
 * Distinct economic categories:
 * - 'own_equity': Equity of the reporting entity itself (SFRS(I) 1-32 §33, Companies Act §68).
 * - 'external_investment': Investment in external entity securities/assets (SFRS(I) 9).
 * - 'not_applicable': Operational transactions with no equity involvement.
 * - 'unknown': Unspecified or unclassified.
 *
 * Legacy aliases normalized at ingestion boundary:
 * - 'own_company_equity' -> 'own_equity'
 * - 'external_entity_equity' -> 'external_investment'
 */
export type OwnershipContext =
  | 'own_equity'
  | 'external_investment'
  | 'not_applicable'
  | 'unknown';

export type CounterpartyRole =
  | 'shareholder'
  | 'customer'
  | 'supplier'
  | 'employee'
  | 'lender'
  | 'director'
  | 'government'
  | 'investor'
  | 'other'
  | 'unknown';

/**
 * Canonical Transaction Nature Types.
 * Each canonical member represents a genuinely distinct economic/journal entry lifecycle:
 *
 * 1.  'share_capital_issuance'      : Own share capital issuance / statutory allotment (Dr Cash/Receivable, Cr Share Capital)
 * 2.  'capital_reduction'           : Statutory capital reduction (Dr Share Capital, Cr Cash/Reserve)
 * 3.  'equity_investment_acquisition': Acquisition of financial asset shares in third party (Dr Financial Asset, Cr Cash)
 * 4.  'lease_contract'              : Commercial lease inception (Dr Right-of-Use Asset, Cr Lease Liability) [SFRS(I) 16 §22]
 * 5.  'lease_payment'               : Periodic lease liability settlement (Dr Lease Liability, Dr Finance Cost, Cr Cash) [SFRS(I) 16 §36]
 * 6.  'rd_capitalization'           : Intangible software/R&D development capitalisation [SFRS(I) 1-38 §57]
 * 7.  'asset_purchase'              : Direct PPE acquisition at cost [SFRS(I) 1-16]
 * 8.  'trade_discount_purchase'     : PPE acquisition with deducted trade discounts [SFRS(I) 1-16 §16(a)]
 * 9.  'depreciation_expense'        : Periodic depreciation of fixed assets [SFRS(I) 1-16 §55]
 * 10. 'customer_advance_payment'    : Customer deposit / unearned revenue (Dr Cash, Cr Contract Liability) [SFRS(I) 15]
 * 11. 'customer_invoice'            : Trade credit sales (Dr Accounts Receivable, Cr Revenue, Cr Output GST)
 * 12. 'director_expense_settlement' : Director out-of-pocket payment reimbursement (Dr Expense, Cr Director Current Account)
 * 13. 'director_fee_payment'        : Payment of approved director remuneration
 * 14. 'expense_payment'             : General operating expenses paid (Dr P&L Expense, Cr Cash)
 * 15. 'inventory_purchase'          : Commercial inventory stock acquisition
 * 16. 'payroll_payment'             : Salary & CPF statutory contribution remittance [Employment Act 1968, CPF Act 1953]
 * 17. 'tax_payment'                 : Corporate income tax / GST payment to IRAS
 * 18. 'tax_provision'               : Year-end corporate tax provision accrual
 * 19. 'dividend_payment'            : Distribution of retained earnings to shareholders
 * 20. 'debt_settlement'             : Loan principal settlement / credit facility repayment
 * 21. 'unclassified_transaction'   : Ambiguous or unclassified query
 *
 * Legacy aliases normalized at boundary:
 * - 'equity_issuance_subscription', 'share_subscription' -> 'share_capital_issuance'
 * - 'software_development_expenditure' -> 'rd_capitalization'
 * - 'asset_acquisition' -> 'asset_purchase'
 * - 'lease_liability_accrual' -> 'lease_contract'
 */
export type TransactionNatureType =
  | 'share_capital_issuance'
  | 'capital_reduction'
  | 'equity_investment_acquisition'
  | 'lease_contract'
  | 'lease_payment'
  | 'rd_capitalization'
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

/**
 * Canonical Balance Sheet Instruments.
 * Distinct balance sheet instruments:
 *
 * Legacy aliases normalized at boundary:
 * - 'equity_instrument' -> 'own_equity'
 * - 'fixed_asset' -> 'property_plant_equipment'
 * - 'amount_due_to_director' -> 'director_current_account'
 * - 'right_of_use_asset_and_lease_liability' -> 'right_of_use_asset'
 */
export type InstrumentType =
  | 'cash_at_bank'
  | 'accounts_receivable'
  | 'accounts_payable'
  | 'own_equity'
  | 'financial_asset_equity'
  | 'marketable_securities'
  | 'debt_instrument'
  | 'derivative'
  | 'property_plant_equipment'
  | 'intangible_asset'
  | 'right_of_use_asset'
  | 'lease_liability'
  | 'director_current_account'
  | 'contract_liability_deferred_revenue'
  | 'unknown';

export type EquityMeasurementBasis =
  | 'FVTPL'
  | 'FVOCI'
  | 'AMORTISED_COST'
  | 'COST'
  | 'UNKNOWN';

export interface UnderlyingTransactionState {
  transactionId?: string;
  type: TransactionNatureType;
  subject: string;
  ownershipContext: OwnershipContext;
  instrument: InstrumentType;
  totalAmount?: number;
  currency: string;
  functionalCurrency?: string;
  transactionDate?: string;
  disposalDate?: string;
  disposalAmount?: number;
  acquisitionFxRate?: number;
  disposalFxRate?: number;
  actualMeasurementBasis?: EquityMeasurementBasis;
  projectedMeasurementBasis?: EquityMeasurementBasis;
  assetName?: string;
  quantity?: number;
  counterpartyRole?: CounterpartyRole;
}

export type AccountingEventType =
  | 'initial_transaction'
  | 'settlement'
  | 'partial_settlement'
  | 'reversal'
  | 'adjustment'
  | 'reclassification'
  | 'policy_election'
  | 'hypothetical_branch'
  | 'other';

export interface AccountingEvent {
  id: string;
  transactionId: string;
  targetTransactionId?: string;
  targetBalanceKey?: string;
  type?: string;
  eventType?: AccountingEventType;
  isHypothetical?: boolean;
  eventDate: string;
  amount: number;
  currency: string;
  description: string;
  lines?: JournalLine[];
  journalLines?: JournalLine[];
  affectedAccounts?: string[];
  timestamp?: string;
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
  underlyingTransaction?: UnderlyingTransactionState;
  actualMeasurementBasis?: EquityMeasurementBasis;
  projectedMeasurementBasis?: EquityMeasurementBasis;
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
  targetMeasurementBasis?: EquityMeasurementBasis;
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
