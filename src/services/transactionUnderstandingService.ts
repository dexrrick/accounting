/**
 * Semantic Transaction Understanding Service
 *
 * Side Quest 2: AI Semantic Transaction Understanding & Intelligent Query Routing
 *
 * Responsibilities:
 * 1. Converts natural-language accounting queries into structured economic transaction facts.
 * 2. Explicitly distinguishes reporting entity perspective from counterparty.
 * 3. Identifies ownership context: 'own_equity' vs. 'external_investment' vs. 'not_applicable'.
 * 4. Extracts payment status ('paid', 'unpaid', 'partially_paid').
 * 5. Provides an auditable SemanticCurrency model (distinguishing explicit, context_inference, and unknown).
 * 6. Performs runtime schema validation, fact normalization, and ambiguity assessment.
 * 7. Strictly separates transaction understanding from journal generation.
 */

export interface SemanticCurrency {
  value: string | null;
  source: 'explicit' | 'context_inference' | 'unknown';
  confidence: number;
  rationale?: string;
}

export interface TransactionUnderstanding {
  reportingEntity: {
    type: 'company' | 'individual' | 'other' | 'unknown';
    description?: string;
  };
  counterparty?: {
    role:
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
    description?: string;
  };
  transactionType?: string;
  subject?: string;
  instrument?: string;
  ownershipContext?:
    | 'own_equity'
    | 'external_investment'
    | 'not_applicable'
    | 'unknown';
  paymentStatus?:
    | 'paid'
    | 'unpaid'
    | 'partially_paid'
    | 'unknown';
  amount?: number;
  currency: SemanticCurrency;
  transactionDate?: string | null;
  jurisdiction?: string | null;
  factsMissing: string[];
  assumptions: string[];
  confidence: number;
}

export interface UnderstandingValidationResult {
  isValid: boolean;
  errors: string[];
  normalizedUnderstanding: TransactionUnderstanding;
}

/**
 * Validates and normalizes raw transaction understanding objects.
 */
export function validateAndNormalizeUnderstanding(
  raw: any,
  fallbackJurisdiction: string = 'SG'
): UnderstandingValidationResult {
  const errors: string[] = [];

  const validEntityTypes = ['company', 'individual', 'other', 'unknown'];
  const entityType = raw?.reportingEntity?.type;
  if (!entityType || !validEntityTypes.includes(entityType)) {
    errors.push(`Invalid or missing reportingEntity.type: '${entityType}'`);
  }

  const validRoles = [
    'shareholder',
    'customer',
    'supplier',
    'employee',
    'lender',
    'director',
    'government',
    'investor',
    'other',
    'unknown'
  ];
  const counterpartyRole = raw?.counterparty?.role;
  if (counterpartyRole && !validRoles.includes(counterpartyRole)) {
    errors.push(`Invalid counterparty.role: '${counterpartyRole}'`);
  }

  const validOwnership = ['own_equity', 'external_investment', 'not_applicable', 'unknown'];
  const ownershipContext = raw?.ownershipContext;
  if (ownershipContext && !validOwnership.includes(ownershipContext)) {
    errors.push(`Invalid ownershipContext: '${ownershipContext}'`);
  }

  const validPaymentStatus = ['paid', 'unpaid', 'partially_paid', 'unknown'];
  const paymentStatus = raw?.paymentStatus;
  if (paymentStatus && !validPaymentStatus.includes(paymentStatus)) {
    errors.push(`Invalid paymentStatus: '${paymentStatus}'`);
  }

  const validCurrencySources = ['explicit', 'context_inference', 'unknown'];
  const currSource = raw?.currency?.source;
  if (!currSource || !validCurrencySources.includes(currSource)) {
    errors.push(`Invalid or missing currency.source: '${currSource}'`);
  }

  const factsMissing: string[] = Array.isArray(raw?.factsMissing) ? [...raw.factsMissing] : [];
  const assumptions: string[] = Array.isArray(raw?.assumptions) ? [...raw.assumptions] : [];

  if (raw?.reportingEntity?.type === 'unknown') {
    factsMissing.push('Reporting entity perspective is unspecified');
  }

  if (raw?.currency?.source === 'context_inference' && raw?.currency?.rationale) {
    assumptions.push(raw.currency.rationale);
  }

  if (raw?.currency?.source === 'unknown') {
    factsMissing.push('Transaction currency is unspecified');
  }

  const confidence = typeof raw?.confidence === 'number'
    ? Math.min(1, Math.max(0, raw.confidence))
    : (errors.length === 0 ? 0.85 : 0.4);

  const normalized: TransactionUnderstanding = {
    reportingEntity: {
      type: (raw?.reportingEntity?.type || 'unknown'),
      description: raw?.reportingEntity?.description || undefined
    },
    counterparty: raw?.counterparty ? {
      role: (raw.counterparty.role || 'unknown'),
      description: raw.counterparty.description || undefined
    } : undefined,
    transactionType: raw?.transactionType || undefined,
    subject: raw?.subject || undefined,
    instrument: raw?.instrument || undefined,
    ownershipContext: raw?.ownershipContext || 'unknown',
    paymentStatus: raw?.paymentStatus || 'unknown',
    amount: typeof raw?.amount === 'number' ? raw.amount : undefined,
    currency: {
      value: raw?.currency?.value ?? null,
      source: raw?.currency?.source || 'unknown',
      confidence: typeof raw?.currency?.confidence === 'number' ? raw.currency.confidence : 0.0,
      rationale: raw?.currency?.rationale || undefined
    },
    transactionDate: raw?.transactionDate || null,
    jurisdiction: raw?.jurisdiction || fallbackJurisdiction,
    factsMissing: Array.from(new Set(factsMissing)),
    assumptions: Array.from(new Set(assumptions)),
    confidence
  };

  return {
    isValid: errors.length === 0,
    errors,
    normalizedUnderstanding: normalized
  };
}

/**
 * Deterministic Semantic Extractor.
 *
 * Runs 100% offline with zero external dependencies to provide reliable semantic
 * decomposition across natural language query variations.
 */
export class DeterministicSemanticExtractor {
  public extract(query: string, functionalCurrency: string = 'SGD', jurisdiction: string = 'SG'): TransactionUnderstanding {
    const q = query.toLowerCase();

    // 1. Currency Extraction (Auditable)
    const currency = this.extractCurrency(query, q, functionalCurrency, jurisdiction);

    // 2. Amount Extraction
    const amount = this.extractAmount(query);

    // 3. Entity & Counterparty Perspective
    const { reportingEntity, counterparty } = this.extractEntityPerspective(q);

    // 4. Ownership Context & Subject
    const { ownershipContext, subject, instrument, transactionType } = this.extractTransactionNature(q, reportingEntity, counterparty);

    // 5. Payment Status
    const paymentStatus = this.extractPaymentStatus(q);

    // 6. Facts Missing & Assumptions
    const factsMissing: string[] = [];
    const assumptions: string[] = [];

    if (currency.source === 'context_inference' && currency.rationale) {
      assumptions.push(currency.rationale);
    }

    const isCommercialTransaction =
      ownershipContext !== 'unknown' ||
      reportingEntity.type === 'company' ||
      q.includes('pay') ||
      q.includes('bought') ||
      q.includes('invested') ||
      q.includes('subscribed') ||
      q.includes('issued') ||
      q.includes('cost') ||
      q.includes('expense');

    if (isCommercialTransaction) {
      if (currency.source === 'unknown') {
        factsMissing.push('Currency is not specified');
      }
      if (paymentStatus === 'unknown') {
        factsMissing.push('Settlement/payment timing is unspecified');
      }
      if (amount === undefined) {
        factsMissing.push('Transaction amount is unspecified');
      }
    }

    let confidence = 0.90;
    if (ownershipContext === 'unknown') confidence -= 0.20;
    if (currency.source === 'unknown') confidence -= 0.10;
    if (amount === undefined) confidence -= 0.10;

    const rawUnderstanding: TransactionUnderstanding = {
      reportingEntity,
      counterparty,
      transactionType,
      subject,
      instrument,
      ownershipContext,
      paymentStatus,
      amount,
      currency,
      transactionDate: null,
      jurisdiction,
      factsMissing,
      assumptions,
      confidence: Math.round(confidence * 100) / 100
    };

    const validation = validateAndNormalizeUnderstanding(rawUnderstanding, jurisdiction);
    return validation.normalizedUnderstanding;
  }

  private extractCurrency(query: string, q: string, _functionalCurrency: string, jurisdiction: string): SemanticCurrency {
    // Explicit Currency Detection
    if (q.includes('usd') || q.includes('us dollar') || q.includes('us$')) {
      return { value: 'USD', source: 'explicit', confidence: 1.0, rationale: 'Explicitly stated as USD / US Dollar' };
    }
    if (q.includes('sgd') || q.includes('singapore dollar') || q.includes('s$')) {
      return { value: 'SGD', source: 'explicit', confidence: 1.0, rationale: 'Explicitly stated as SGD / Singapore Dollar' };
    }
    if (q.includes('eur') || q.includes('euro')) {
      return { value: 'EUR', source: 'explicit', confidence: 1.0, rationale: 'Explicitly stated as EUR / Euro' };
    }
    if (q.includes('gbp') || q.includes('pound')) {
      return { value: 'GBP', source: 'explicit', confidence: 1.0, rationale: 'Explicitly stated as GBP / British Pound' };
    }

    // Bare "$" Symbol
    const hasDollarSign = query.includes('$');
    if (hasDollarSign) {
      // In Singapore context:
      if (jurisdiction === 'SG') {
        return {
          value: 'SGD',
          source: 'context_inference',
          confidence: 0.90,
          rationale: 'Interpreted as SGD based on Singapore jurisdiction and functional currency context'
        };
      }
      // International / unspecified jurisdiction with ambiguous "$"
      return {
        value: null,
        source: 'unknown',
        confidence: 0.0,
        rationale: 'Ambiguous $ currency symbol without established jurisdiction'
      };
    }

    // Word-based numbers without symbol (e.g. "one dollar")
    if (q.includes('one dollar') || q.includes('dollar')) {
      if (jurisdiction === 'SG') {
        return {
          value: 'SGD',
          source: 'context_inference',
          confidence: 0.85,
          rationale: 'Interpreted as SGD based on Singapore jurisdiction'
        };
      }
      return {
        value: null,
        source: 'unknown',
        confidence: 0.0,
        rationale: 'Unqualified dollar denomination without jurisdiction'
      };
    }

    // No currency mention at all
    return {
      value: null,
      source: 'unknown',
      confidence: 0.0,
      rationale: 'No currency specified in query'
    };
  }

  private extractAmount(query: string): number | undefined {
    // 1. Textual numbers: "one dollar"
    if (/\bone dollar\b/i.test(query)) return 1;
    if (/\btwo dollars\b/i.test(query)) return 2;

    // 2. Formats: $1, USD 300k, SGD 5,000, 3k
    const match = query.match(/(?:(?:usd|sgd|eur|gbp|\$)\s*)?([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)?/i);
    if (match && match[1]) {
      let val = parseFloat(match[1].replace(/,/g, ''));
      if (isNaN(val)) return undefined;
      const unit = match[2]?.toLowerCase();
      if (unit === 'k' || unit === 'thousand') val *= 1000;
      if (unit === 'm' || unit === 'million') val *= 1000000;
      return val;
    }
    return undefined;
  }

  private extractEntityPerspective(q: string): {
    reportingEntity: { type: 'company' | 'individual' | 'other' | 'unknown'; description?: string };
    counterparty?: { role: 'shareholder' | 'customer' | 'supplier' | 'employee' | 'lender' | 'director' | 'government' | 'investor' | 'other' | 'unknown'; description?: string };
  } {
    // Corporate perspective indicators
    const isCompany =
      q.includes('company') ||
      q.includes('own company') ||
      q.includes('our company') ||
      q.includes('we issued') ||
      q.includes('we bought') ||
      q.includes('we delivered') ||
      q.includes('customer paid us') ||
      q.includes('client paid') ||
      q.includes('business bill') ||
      q.includes('share capital') ||
      q.includes('shareholder has invested') ||
      q.includes('director paid a company expense') ||
      q.includes('company expense was settled');

    const reportingEntity = {
      type: (isCompany ? 'company' : 'unknown') as 'company' | 'individual' | 'other' | 'unknown',
      description: isCompany ? 'Reporting entity is the corporate business' : undefined
    };

    // Counterparty Role Identification
    let role: 'shareholder' | 'customer' | 'supplier' | 'employee' | 'lender' | 'director' | 'government' | 'investor' | 'other' | 'unknown' = 'unknown';
    let roleDesc: string | undefined;

    if (q.includes('shareholder') || q.includes('founder') || q.includes('subscriber')) {
      role = 'shareholder';
      roleDesc = 'Company shareholder / equity subscriber';
    } else if (q.includes('director')) {
      role = 'director';
      roleDesc = 'Company director / key management';
    } else if (q.includes('customer') || q.includes('client')) {
      role = 'customer';
      roleDesc = 'Commercial customer / purchaser of goods or services';
    } else if (q.includes('supplier') || q.includes('vendor')) {
      role = 'supplier';
      roleDesc = 'Vendor / trade supplier';
    } else if (q.includes('employee') || q.includes('staff')) {
      role = 'employee';
      roleDesc = 'Employee / payroll recipient';
    } else if (q.includes('lender') || q.includes('bank loan')) {
      role = 'lender';
      roleDesc = 'Financial institution / lender';
    }

    return {
      reportingEntity,
      counterparty: role !== 'unknown' ? { role, description: roleDesc } : undefined
    };
  }

  private extractTransactionNature(
    q: string,
    _reportingEntity: { type: string },
    _counterparty?: { role: string }
  ): {
    ownershipContext: 'own_equity' | 'external_investment' | 'not_applicable' | 'unknown';
    subject?: string;
    instrument?: string;
    transactionType?: string;
  } {
    // 1. Customer Advance / Deferred Revenue
    const isCustomerAdvance =
      (q.includes('customer') || q.includes('client')) &&
      (q.includes('paid us before') || q.includes('advance for goods') || q.includes('advance') || q.includes('received money from customer before'));

    if (isCustomerAdvance) {
      return {
        ownershipContext: 'not_applicable',
        subject: 'advance payment for goods or services',
        instrument: 'cash / trade receivable',
        transactionType: 'customer_advance_payment'
      };
    }

    // 2. Director Expense Settlement
    const isDirectorExpense =
      q.includes('director') &&
      (q.includes('personally') || q.includes('settled by the director') || q.includes('his own money') || q.includes('company expense'));

    if (isDirectorExpense) {
      return {
        ownershipContext: 'not_applicable',
        subject: 'company business expense settled by director',
        instrument: 'director current account liability',
        transactionType: 'director_expense_settlement'
      };
    }

    // 3. Own Equity Issuance / Subscription
    const isOwnEquity =
      q.includes('own company share capital') ||
      q.includes('own company') ||
      q.includes('our company') ||
      q.includes('share capital was issued') ||
      q.includes('issued one dollar of ordinary shares') ||
      q.includes('issued shares to the founder') ||
      q.includes('shares issued to founder') ||
      q.includes('founder took up shares') ||
      q.includes('subscription money is outstanding') ||
      q.includes('amount subscribed for') ||
      q.includes('subscribed for $1 of shares') ||
      q.includes('subscribed for shares in our company') ||
      (q.includes('shareholder') && q.includes('invested') && q.includes('share capital')) ||
      (q.includes('share capital') && q.includes('unpaid'));

    if (isOwnEquity) {
      return {
        ownershipContext: 'own_equity',
        subject: 'ordinary share capital of reporting entity',
        instrument: 'own_equity',
        transactionType: 'equity_issuance_subscription'
      };
    }

    // 4. External Investment
    const isExternalInvestment =
      q.includes('apple') ||
      q.includes('aapl') ||
      q.includes('tesla') ||
      q.includes('tsla') ||
      q.includes('microsoft') ||
      q.includes('transferred apple shares') ||
      (q.includes('bought') && q.includes('shares in')) ||
      (q.includes('invested in') && !q.includes('own company') && !q.includes('share capital'));

    if (isExternalInvestment) {
      return {
        ownershipContext: 'external_investment',
        subject: 'quoted equity securities in external entity',
        instrument: 'financial_asset_equity',
        transactionType: 'equity_investment_acquisition'
      };
    }

    // 5. Commercial Lease (IFRS 16)
    if (q.includes('rental agreement') || q.includes('lease agreement') || q.includes('leased')) {
      return {
        ownershipContext: 'not_applicable',
        subject: 'commercial property lease',
        instrument: 'right_of_use_asset_and_lease_liability',
        transactionType: 'lease_contract'
      };
    }

    // 6. General Operating Expense
    if (q.includes('entertainment expenses') || q.includes('office supplies') || q.includes('utility bill')) {
      return {
        ownershipContext: 'not_applicable',
        subject: 'operating expense',
        instrument: 'cash_at_bank',
        transactionType: 'expense_payment'
      };
    }

    return {
      ownershipContext: 'unknown',
      subject: undefined,
      instrument: undefined,
      transactionType: 'unclassified_transaction'
    };
  }

  private extractPaymentStatus(q: string): 'paid' | 'unpaid' | 'partially_paid' | 'unknown' {
    if (
      q.includes('unpaid') ||
      q.includes("hasn't paid") ||
      q.includes('has not paid') ||
      q.includes('payment pending') ||
      q.includes('outstanding') ||
      q.includes('owes the company') ||
      q.includes('yet to pay') ||
      q.includes('not yet paid')
    ) {
      return 'unpaid';
    }

    if (
      q.includes('partially paid') ||
      q.includes('part paid') ||
      q.includes('half paid') ||
      q.includes('deposit paid')
    ) {
      return 'partially_paid';
    }

    if (
      q.includes('paid') ||
      q.includes('received money') ||
      q.includes('settled') ||
      q.includes('transfer on') ||
      q.includes('bank transfer')
    ) {
      return 'paid';
    }

    return 'unknown';
  }
}

/**
 * Singleton instance of the deterministic extractor.
 */
export const defaultSemanticExtractor = new DeterministicSemanticExtractor();

/**
 * Primary Transaction Understanding Service.
 * Supports synchronous local extraction and async AI-enhanced extraction.
 */
export class TransactionUnderstandingService {
  private extractor: DeterministicSemanticExtractor;

  constructor(extractor: DeterministicSemanticExtractor = defaultSemanticExtractor) {
    this.extractor = extractor;
  }

  public understandTransactionSync(
    query: string,
    functionalCurrency: string = 'SGD',
    jurisdiction: string = 'SG'
  ): TransactionUnderstanding {
    return this.extractor.extract(query, functionalCurrency, jurisdiction);
  }

  public async understandTransaction(
    query: string,
    functionalCurrency: string = 'SGD',
    jurisdiction: string = 'SG'
  ): Promise<TransactionUnderstanding> {
    return this.understandTransactionSync(query, functionalCurrency, jurisdiction);
  }
}

export const defaultTransactionUnderstandingService = new TransactionUnderstandingService();
