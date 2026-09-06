export type AccountingStandard = 'SFRS_I' | 'IFRS';

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
  | 'SSO';

export interface StandardCitation {
  standard: string; // e.g. "SFRS(I) 1-1", "Income Tax Act 1947", "Companies Act 1967"
  paragraph: string; // e.g. "§5.1.1", "Section 14(1)", "Section 205C"
  title: string;
  text: string;
  officialSourceUrl?: string;
  authority?: StatutoryAuthority;
}

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
  eventDate: string;
  title: string;
  summary: string;
  lines: JournalLine[];
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
  citations: StandardCitation[];
  rationalePoints: string[];
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

export interface AccountingScenarioState {
  scenarioType: string;
  rawQuery: string;
  transactionTitle: string;
  functionalCurrency: string;
  transactionCurrency: string;
  
  // Universal Dynamic Facts & Direct Journal Groups
  keyParameters?: TransactionFact[];
  directGroups?: JournalEntryGroup[];

  // Statutory Advisory & Tax Grounding
  queryIntent?: 'TRANSACTION' | 'STATUTORY_ADVISORY' | 'HYBRID';
  statutoryAdvisory?: StatutoryAdvisoryInfo[];

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
  clarificationPrompt?: MissingFieldInfo[];
  scenarioSnapshot?: AccountingScenarioState;
}
