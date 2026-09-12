export type AccountingStandard = 'SFRS_I' | 'IFRS';

export type {
  OwnershipContext,
  CounterpartyRole,
  TransactionNatureType,
  InstrumentType
} from './conversationState';

export type AccountCategory = 
  | 'ASSET' 
  | 'LIABILITY' 
  | 'EQUITY' 
  | 'REVENUE' 
  | 'EXPENSE' 
  | 'OTHER_COMPREHENSIVE_INCOME';

export type StatutoryAuthority = 
  | 'IRAS' 
  | 'ACRA' 
  | 'CPF' 
  | 'MOM' 
  | 'MAS' 
  | 'CUSTOMS' 
  | 'ASC' 
  | 'SSO'
  | 'AGC'
  | 'REFERENCE_API';

export type QueryDomain = 
  | 'ACCOUNTING_SFRS' 
  | 'IRAS_TAX' 
  | 'IRAS_GST' 
  | 'ACRA_CORP' 
  | 'MOM_EMPLOYMENT' 
  | 'CPF_BOARD' 
  | 'MULTI_AUTHORITY' 
  | 'GENERAL';

export interface StandardCitation {
  standard: string; // e.g. "SFRS(I) 1-1", "Income Tax Act 1947", "Companies Act 1967"
  paragraph: string; // e.g. "§5.1.1", "Section 14(1)", "Section 205C"
  title: string;
  text: string;
  officialSourceUrl?: string;
  authority?: StatutoryAuthority;
  verificationStatus?: string;
  isAuthoritativePrimarySource?: boolean;
  isStructurallyValid?: boolean;
  verificationReason?: string;
  /** Confirms structural verification validates existence and URLs only, not semantic claim validity */
  structuralVerificationOnly?: boolean;
}

export type JournalAuthorityStatus = 'DETERMINISTIC' | 'AI_PROPOSED' | 'CONDITIONAL';

export interface StatutoryAdvisoryInfo {
  authority: StatutoryAuthority;
  statuteOrAct: string;
  sectionOrSchedule: string;
  topic: string;
  summary: string;
  keyRules: string[];
  officialUrl: string;
  isTaxDeductible?: boolean;
  isGstClaimable?: boolean;
}

export interface JournalLine {
  id: string;
  accountCode: string;
  accountName: string;
  category: AccountCategory;
  debit: number; // in functional currency
  credit: number; // in functional currency
  foreignCurrency?: string;
  foreignDebit?: number;
  foreignCredit?: number;
  exchangeRate?: number;
  lineExplanation: string;
}

export interface JournalEntryGroup {
  id: string;
  transactionId?: string;
  targetTransactionId?: string;
  isHypothetical?: boolean;
  eventDate: string;
  title: string;
  summary: string;
  lines: JournalLine[];
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
  citations: StandardCitation[];
  rationalePoints: string[];
  authorityStatus?: JournalAuthorityStatus;
}

export interface FinancialImpactSummary {
  totalAssetsDelta: number;
  totalLiabilitiesDelta: number;
  totalEquityDelta: number;
  pnlImpact: number; // Positive = profit/gain, Negative = expense/loss
  ociImpact: number;
  functionalCurrency: string;
}

export interface MissingFieldInfo {
  fieldKey: string;
  fieldName: string;
  prompt: string;
  whyNeeded: string;
  defaultValue?: number | string;
  suggestions?: { label: string; value: number | string }[];
}

export interface TransactionFact {
  label: string;
  value: string;
  badge?: string;
  highlight?: boolean;
}

export interface ExplicitAssumption {
  id: string;
  field: string;
  assumedValue: string | number;
  basisOrRationale: string;
  materiality: 'HIGH' | 'MEDIUM' | 'LOW';
  userClarificationPrompt?: string;
}

export interface AccountingScenarioState {
  scenarioType: string;
  rawQuery: string;
  transactionTitle: string;
  functionalCurrency: string;
  transactionCurrency: string;
  
  // Universal Dynamic Facts & Direct Journal Groups
  transactionId?: string;
  keyParameters?: TransactionFact[];
  directGroups?: JournalEntryGroup[];
  committedDirectGroups?: JournalEntryGroup[];
  projectedGroups?: JournalEntryGroup[];
  factAmendments?: import('../services/factAmendmentService').FactAmendment[];
  authorityStatus?: JournalAuthorityStatus;

  // Event-Sourced Accounting State & Multi-Turn History
  accountingEvents?: import('./conversationState').AccountingEvent[];
  actualEvents?: import('./conversationState').AccountingEvent[];
  cumulativeBalances?: import('./conversationState').OutstandingAccountBalance[];
  isHypothetical?: boolean;

  // Structured Transaction Semantics (Side Quest 2 & 3 Integration)
  semanticUnderstanding?: import('../services/transactionUnderstandingService').TransactionUnderstanding;
  ownershipContext?: import('./conversationState').OwnershipContext;
  counterpartyRole?: import('./conversationState').CounterpartyRole;
  transactionNature?: string;
  actualMeasurementBasis?: import('./conversationState').EquityMeasurementBasis;
  projectedMeasurementBasis?: import('./conversationState').EquityMeasurementBasis;
  underlyingTransaction?: import('./conversationState').UnderlyingTransactionState;

  // Explicit Assumptions (Needed because facts are missing)
  assumptions?: ExplicitAssumption[];
  missingFacts?: string[];

  // Statutory Advisory & Tax Grounding
  queryIntent?: 'TRANSACTION' | 'STATUTORY_ADVISORY' | 'HYBRID';
  primaryDomain?: QueryDomain;
  statutoryAdvisory?: StatutoryAdvisoryInfo[];
  officialAnswerLinks?: import('../utils/chatPresentation').OfficialAnswerLink[];

  // Explicit Accounting vs Tax Separation & Regulatory Summaries
  accountingTreatmentSummary?: string;
  singaporeTaxTreatmentSummary?: string;
  regulatoryMandatesSummary?: string;
  effectiveDateOrTiming?: string;
  uncertaintyDisclaimer?: string;

  // Optional legacy fields for backward compatibility
  expenseAccountName?: string;
  paymentMethodAccountName?: string;
  amount?: number;
  assetName?: string;
  quantity?: number;
  purchaseDate?: string;
  purchaseAmountForeign?: number;
  purchaseFxRate?: number;
  saleDate?: string;
  saleAmountForeign?: number;
  saleFxRate?: number;
  classification?: 'FVTPL' | 'FVTOCI';
  bifurcateFxGain?: boolean;
  fxSource?: string;
  leaseTermYears?: number;
  leaseTermMonths?: number;
  leasePaymentMonthly?: number;
  leaseDiscountRateAnnual?: number;
  leaseCommencementDate?: string;
  
  isComplete: boolean;
  missingFields: MissingFieldInfo[];
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  timestamp: string;
  text: string;
  fullText?: string;
  clarificationPrompt?: MissingFieldInfo[];
  relationPrompt?: boolean;
  scenarioSnapshot?: AccountingScenarioState;
}
