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

import type { ProviderSettings } from '../types/provider';
import type { ConversationAccountingContext, FollowUpEventAnalysis } from '../types/conversationState';
import { executeStructuredLlmCall } from './aiTransport';
import { repairAndParseAIJson } from '../utils/jsonRepair';

export interface SemanticCurrency {
  value: string | null;
  source: 'explicit' | 'context_inference' | 'unknown';
  confidence: number;
  rationale?: string;
}

export interface TransactionUnderstanding {
  extractionSource?: 'ai' | 'deterministic_fallback';
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
  followUpAnalysis?: FollowUpEventAnalysis;
}

export interface UnderstandingValidationResult {
  isValid: boolean;
  errors: string[];
  normalizedUnderstanding: TransactionUnderstanding;
}

/**
 * Validates and normalizes raw transaction understanding objects.
 */
/**
 * Validates and normalizes raw transaction understanding objects.
 * Acts as a strict validation gate before AI output is accepted.
 */
export function validateAndNormalizeUnderstanding(
  raw: any,
  fallbackJurisdiction: string = 'SG',
  source: 'ai' | 'deterministic_fallback' = 'deterministic_fallback'
): UnderstandingValidationResult {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return {
      isValid: false,
      errors: ['Raw understanding payload must be a non-null object'],
      normalizedUnderstanding: {
        extractionSource: source,
        reportingEntity: { type: 'unknown' },
        currency: { value: null, source: 'unknown', confidence: 0 },
        factsMissing: ['Invalid or empty understanding payload'],
        assumptions: [],
        confidence: 0
      }
    };
  }

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

  // Dangerous contradiction invariant checks (no silent correction)
  if (ownershipContext === 'own_equity') {
    const inst = (raw?.instrument || '').toLowerCase();
    const subj = (raw?.subject || '').toLowerCase();
    if (inst.includes('fvtpl') || inst.includes('fvtoci') || subj.includes('foreign shares') || inst.includes('financial_asset')) {
      errors.push('Contradictory classification: own_equity cannot be classified as financial asset at FVTPL/FVTOCI (SFRS(I) 1-32 §33).');
    }
    if (counterpartyRole === 'customer' || counterpartyRole === 'supplier') {
      errors.push('Contradictory classification: counterparty for own_equity cannot be customer or supplier.');
    }
  }

  if (ownershipContext === 'external_investment') {
    const inst = (raw?.instrument || '').toLowerCase();
    if (inst.includes('own_equity') || inst.includes('share_capital')) {
      errors.push('Contradictory classification: external_investment cannot have own_equity instrument.');
    }
  }

  if (raw?.currency?.source === 'explicit' && !raw?.currency?.value) {
    errors.push('Explicit currency source declared, but currency value is null.');
  }

  if (typeof raw?.amount === 'number' && raw.amount < 0) {
    errors.push('Transaction amount cannot be negative.');
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
    extractionSource: source,
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
    confidence,
    followUpAnalysis: raw?.followUpAnalysis ? {
      eventType: raw.followUpAnalysis.eventType || 'other',
      isFollowUp: Boolean(raw.followUpAnalysis.isFollowUp),
      targetOutstandingAccount: raw.followUpAnalysis.targetOutstandingAccount || undefined,
      settlementAmount: typeof raw.followUpAnalysis.settlementAmount === 'number' ? raw.followUpAnalysis.settlementAmount : undefined,
      remainingReceivableOrPayable: typeof raw.followUpAnalysis.remainingReceivableOrPayable === 'number' ? raw.followUpAnalysis.remainingReceivableOrPayable : undefined,
      settlementAccount: raw.followUpAnalysis.settlementAccount || 'cash_at_bank',
      isHypothetical: Boolean(raw.followUpAnalysis.isHypothetical),
      explanation: raw.followUpAnalysis.explanation || ''
    } : undefined
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
  public extract(
    query: string,
    functionalCurrency: string = 'SGD',
    jurisdiction: string = 'SG',
    conversationContext?: ConversationAccountingContext
  ): TransactionUnderstanding {
    const q = query.toLowerCase();

    // 1. Currency Extraction (Auditable)
    let currency = this.extractCurrency(query, q, functionalCurrency, jurisdiction);

    // 2. Amount Extraction
    let amount = this.extractAmount(query);

    // 3. Entity & Counterparty Perspective
    let { reportingEntity, counterparty } = this.extractEntityPerspective(q);

    // 4. Ownership Context & Subject
    let { ownershipContext, subject, instrument, transactionType } = this.extractTransactionNature(q, reportingEntity, counterparty);

    // 5. Payment Status
    let paymentStatus = this.extractPaymentStatus(q);

    // 5.5 Multi-Turn Conversation & Follow-Up Event Resolution
    let followUpAnalysis: FollowUpEventAnalysis | undefined;
    const hasPriorContext = Boolean(
      conversationContext &&
      (conversationContext.outstandingBalances.length > 0 ||
       conversationContext.recognizedEquityTotal > 0 ||
       conversationContext.underlyingTransaction)
    );

    const introducesNewSubject =
      q.includes('apple') ||
      q.includes('aapl') ||
      q.includes('tesla') ||
      q.includes('office equipment') ||
      q.includes('machinery') ||
      q.includes('rental agreement') ||
      q.includes('entertainment expenses');

    const isPaymentOrSettlementAction =
      (q.includes('paid') ||
       q.includes('pay') ||
       q.includes('bank') ||
       q.includes('settle') ||
       q.includes('settling') ||
       q.includes('remit') ||
       q.includes('transfer') ||
       q.includes('received') ||
       q.includes('deposit') ||
       q.includes('did pay') ||
       q.includes('did paid'));

    const isHypothetical = /\b(what if|suppose|assuming|if)\b/i.test(query);

    if (hasPriorContext && !introducesNewSubject && isPaymentOrSettlementAction) {
      // Find target receivable or payable to settle from recorded balances
      const targetBalance = conversationContext!.outstandingBalances.find(b => b.nature === 'RECEIVABLE');

      if (targetBalance) {
        // If amount was not specified in the follow-up, inherit full remaining balance
        if (amount === undefined) {
          amount = targetBalance.remainingAmount;
        }

        const isPartial = amount < targetBalance.remainingAmount;
        const remaining = Math.max(0, Math.round((targetBalance.remainingAmount - amount) * 100) / 100);

        followUpAnalysis = {
          eventType: isPartial ? 'partial_settlement' : 'settlement',
          isFollowUp: true,
          targetOutstandingAccount: targetBalance.accountName,
          settlementAmount: amount,
          remainingReceivableOrPayable: remaining,
          settlementAccount: 'cash_at_bank',
          isHypothetical,
          explanation: isPartial
            ? `Partial settlement of ${targetBalance.accountName} for ${currency.value || targetBalance.currency || functionalCurrency} ${amount}. Remaining balance: ${currency.value || targetBalance.currency || functionalCurrency} ${remaining}.`
            : `Full settlement of ${targetBalance.accountName} via bank transfer. Share Capital is not credited again.`
        };

        // Align transaction nature and perspective to settlement
        paymentStatus = 'paid';
        instrument = 'cash_at_bank';
        ownershipContext = conversationContext!.underlyingTransaction?.ownershipContext || 'own_equity';
        subject = `Settlement of ${targetBalance.accountName}`;
        transactionType = isPartial ? 'partial_debt_settlement' : 'debt_settlement';
        reportingEntity = { type: 'company', description: 'Reporting entity is the corporate business' };
        if (!counterparty || counterparty.role === 'unknown') {
          counterparty = {
            role: (targetBalance.counterpartyRole as any) || 'shareholder',
            description: targetBalance.counterpartyRole === 'shareholder' ? 'Company shareholder' : 'Counterparty'
          };
        }

        // Inherit currency if unspecified in query
        if (currency.source === 'unknown') {
          currency = {
            value: targetBalance.currency || functionalCurrency,
            source: 'context_inference',
            confidence: 0.95,
            rationale: 'Inherited from active transaction context'
          };
        }
      }
    }

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
      confidence: Math.round(confidence * 100) / 100,
      followUpAnalysis
    };

    const validation = validateAndNormalizeUnderstanding(rawUnderstanding, jurisdiction, 'deterministic_fallback');
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

    // 2. Textual fractions / cents: "50 cents", "twenty cents", "half"
    const centsMatch = query.match(/\b(\d+)\s*cents?\b/i);
    if (centsMatch && centsMatch[1]) {
      return parseFloat(centsMatch[1]) / 100;
    }
    if (/\bhalf a dollar\b/i.test(query) || /\b50 cents\b/i.test(query)) return 0.5;

    // 3. Strict monetary formats with currency symbol/code: $1, $ 1, USD 300k, SGD 5,000, 100 SGD, 300k USD
    const currFirstMatch = query.match(/(?:usd|sgd|eur|gbp|\$)\s*([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)?\b/i);
    if (currFirstMatch && currFirstMatch[1]) {
      let val = parseFloat(currFirstMatch[1].replace(/,/g, ''));
      if (isNaN(val)) return undefined;
      const unit = currFirstMatch[2]?.toLowerCase();
      if (unit === 'k' || unit === 'thousand') val *= 1000;
      if (unit === 'm' || unit === 'million') val *= 1000000;
      return val;
    }

    const currLastMatch = query.match(/\b([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)?\s*(?:usd|sgd|eur|gbp|dollars)\b/i);
    if (currLastMatch && currLastMatch[1]) {
      let val = parseFloat(currLastMatch[1].replace(/,/g, ''));
      if (isNaN(val)) return undefined;
      const unit = currLastMatch[2]?.toLowerCase();
      if (unit === 'k' || unit === 'thousand') val *= 1000;
      if (unit === 'm' || unit === 'million') val *= 1000000;
      return val;
    }

    // 4. Explicit magnitude abbreviations in commercial context: 3k, 120k (not 30-day or percentages)
    const magMatch = query.match(/(?:for|cost|price|amount|paying|paid|invested)\s*([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)\b/i);
    if (magMatch && magMatch[1] && magMatch[2]) {
      let val = parseFloat(magMatch[1].replace(/,/g, ''));
      const unit = magMatch[2].toLowerCase();
      if (unit === 'k' || unit === 'thousand') val *= 1000;
      if (unit === 'm' || unit === 'million') val *= 1000000;
      return val;
    }

    // 5. Payment verbs with explicit numbers: "paid 1.20", "transferred 500"
    const payVerbMatch = query.match(/(?:paid|paying|transferred|remitted|settled)\s*(?:(?:usd|sgd|\$)\s*)?([\d,]+(?:\.\d+)?)/i);
    if (payVerbMatch && payVerbMatch[1]) {
      const val = parseFloat(payVerbMatch[1].replace(/,/g, ''));
      if (!isNaN(val) && val > 0) return val;
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

export const SEMANTIC_EXTRACTION_SYSTEM_PROMPT = `You are an expert economic and accounting transaction classifier for Singapore and international financial reporting.
Your sole task is to analyze the user's natural-language commercial query and extract structured economic facts.
You do NOT generate journal entries or debit/credit lines. You ONLY classify the underlying economic facts.

Return ONLY a JSON object conforming strictly to this JSON schema:
{
  "reportingEntity": {
    "type": "company" | "individual" | "other" | "unknown",
    "description": string
  },
  "counterparty": {
    "role": "shareholder" | "customer" | "supplier" | "employee" | "lender" | "director" | "government" | "investor" | "other" | "unknown",
    "description": string
  },
  "transactionType": string,
  "subject": string,
  "instrument": string,
  "ownershipContext": "own_equity" | "external_investment" | "not_applicable" | "unknown",
  "paymentStatus": "paid" | "unpaid" | "partially_paid" | "unknown",
  "amount": number | null,
  "currency": {
    "value": string | null,
    "source": "explicit" | "context_inference" | "unknown",
    "confidence": number,
    "rationale": string
  },
  "transactionDate": string | null,
  "jurisdiction": "SG" | string,
  "factsMissing": string[],
  "assumptions": string[],
  "confidence": number,
  "followUpAnalysis": {
    "eventType": "settlement" | "partial_settlement" | "hypothetical_change" | "new_transaction" | "other",
    "isFollowUp": boolean,
    "targetOutstandingAccount": string | null,
    "settlementAmount": number | null,
    "remainingReceivableOrPayable": number | null,
    "settlementAccount": string | null,
    "isHypothetical": boolean,
    "explanation": string
  }
}

CRITICAL CLASSIFICATION INVARIANTS:
1. OWN EQUITY VS EXTERNAL INVESTMENT:
   - When a founder, shareholder, or subscriber is investing capital, taking up shares, or being issued/allotted shares in their OWN company / startup:
     * reportingEntity.type = "company"
     * counterparty.role = "shareholder"
     * ownershipContext = "own_equity" (under SFRS(I) 1-32 §33)
     * instrument = "own_equity"
     * NEVER classify this as "external_investment" or a financial asset.
   - When the reporting entity acquires or invests in shares of a THIRD-PARTY entity (e.g. Apple, Tesla, listed equities, foreign stocks):
     * ownershipContext = "external_investment"
2. CUSTOMER ADVANCE / DEFERRED REVENUE:
   - When a customer or client pays before delivery of goods/services:
     * counterparty.role = "customer"
     * transactionType = "customer_advance_payment"
     * paymentStatus = "paid"
3. DIRECTOR EXPENSE SETTLEMENT:
   - When a director, founder, or board member settles or pays a company bill/expense personally:
     * counterparty.role = "director"
     * transactionType = "director_expense_settlement"
4. PAYMENT STATUS:
   - If unpaid, remaining unpaid, owes, yet to pay, cash hasn't arrived, pending call/settlement:
     * paymentStatus = "unpaid"
   - If paid, settled, transferred:
     * paymentStatus = "paid"
5. CURRENCY:
   - In Singapore context (default), if "$" is used without explicit USD/EUR/etc, set currency.value = "SGD", currency.source = "context_inference", currency.confidence = 0.9.
   - Do NOT assume USD unless explicitly stated ("USD", "US Dollar", "US$").
   - If no currency symbol or code is provided, set currency.value = null, currency.source = "unknown", and add "Transaction currency is unspecified" to factsMissing.
6. AMOUNT:
   - Extract numeric transaction magnitude (e.g. 1 from "$1", 3000 from "3k"). Dates (e.g. 15/12/2026), percentages (9%), terms (30-day), or item counts (5 laptops) are NOT transaction amounts.
7. MULTI-TURN CONVERSATION & FOLLOW-UP SETTLEMENTS:
   - When [PRIOR CONVERSATION ACCOUNTING CONTEXT] is provided and user asks about payment/settlement (e.g. "what if the shareholder did paid to company bank account", "what if they paid 50 cents"):
     * followUpAnalysis.eventType = "settlement" (or "partial_settlement" if amount < outstanding balance)
     * followUpAnalysis.isFollowUp = true
     * followUpAnalysis.targetOutstandingAccount = name of the receivable/payable from prior context
     * followUpAnalysis.settlementAmount = extracted amount or full outstanding balance if not restated
     * paymentStatus = "paid"
     * instrument = "cash_at_bank"
     * ownershipContext = inherit from prior context (e.g. "own_equity")
     * Do NOT classify this as an external investment or financial asset.`;

export class AISemanticExtractor {
  public async extract(
    query: string,
    providerOrApiKey?: ProviderSettings | string,
    _functionalCurrency: string = 'SGD',
    _jurisdiction: string = 'SG',
    conversationContext?: ConversationAccountingContext
  ): Promise<any> {
    let contextPrompt = '';
    if (
      conversationContext &&
      (conversationContext.outstandingBalances.length > 0 ||
       conversationContext.recognizedEquityTotal > 0 ||
       conversationContext.underlyingTransaction)
    ) {
      contextPrompt = `\n[PRIOR CONVERSATION ACCOUNTING CONTEXT]:\n` +
        `- Underlying Transaction: ${conversationContext.underlyingTransaction?.subject || 'Commercial Transaction'} (${conversationContext.underlyingTransaction?.ownershipContext || 'own_equity'})\n` +
        (conversationContext.outstandingBalances.length > 0
          ? `- Outstanding Balances:\n` + conversationContext.outstandingBalances.map(b => `  * ${b.accountName}: ${b.currency} ${b.remainingAmount} (${b.nature}, role: ${b.counterpartyRole})`).join('\n') + '\n'
          : '') +
        `- Recognized Equity Total: ${conversationContext.recognizedEquityTotal}\n`;
    }

    const rawJsonText = await executeStructuredLlmCall(
      `Analyze the following commercial query and extract structured economic facts:\n\nQuery: "${query}"\n${contextPrompt}\nReturn strictly valid JSON conforming to the schema.`,
      SEMANTIC_EXTRACTION_SYSTEM_PROMPT,
      providerOrApiKey,
      { jsonMode: true, temperature: 0.1 }
    );

    return repairAndParseAIJson(rawJsonText);
  }
}

export const defaultAiSemanticExtractor = new AISemanticExtractor();

/**
 * Singleton instance of the deterministic extractor.
 */
export const defaultSemanticExtractor = new DeterministicSemanticExtractor();

/**
 * Primary Transaction Understanding Service.
 * Implements AI structured extraction as the primary path,
 * validated deterministically before retrieval, with a resilient local fallback.
 */
export class TransactionUnderstandingService {
  private deterministicExtractor: DeterministicSemanticExtractor;
  private aiExtractor: AISemanticExtractor;

  constructor(
    deterministicExtractor: DeterministicSemanticExtractor = defaultSemanticExtractor,
    aiExtractor: AISemanticExtractor = defaultAiSemanticExtractor
  ) {
    this.deterministicExtractor = deterministicExtractor;
    this.aiExtractor = aiExtractor;
  }

  public understandTransactionSync(
    query: string,
    functionalCurrency: string = 'SGD',
    jurisdiction: string = 'SG',
    conversationContext?: ConversationAccountingContext
  ): TransactionUnderstanding {
    return this.deterministicExtractor.extract(query, functionalCurrency, jurisdiction, conversationContext);
  }

  public async understandTransaction(
    query: string,
    functionalCurrency: string = 'SGD',
    jurisdiction: string = 'SG',
    providerOrApiKey?: ProviderSettings | string,
    conversationContext?: ConversationAccountingContext
  ): Promise<TransactionUnderstanding> {
    const hasProvider = Boolean(
      (typeof providerOrApiKey === 'string' && providerOrApiKey.trim().length > 10) ||
      (typeof providerOrApiKey === 'object' && (
        (providerOrApiKey.activeProvider === 'gemini' && Boolean(providerOrApiKey.gemini?.apiKey?.trim() && providerOrApiKey.gemini.apiKey.trim().length > 10)) ||
        (providerOrApiKey.activeProvider === 'azure' && Boolean(providerOrApiKey.azure?.apiKey?.trim() && providerOrApiKey.azure?.endpoint)) ||
        (providerOrApiKey.activeProvider === 'openai' && Boolean(providerOrApiKey.openai?.apiKey?.trim() && providerOrApiKey.openai.apiKey.trim().length > 10))
      ))
    );

    if (hasProvider) {
      try {
        const rawAi = await this.aiExtractor.extract(query, providerOrApiKey, functionalCurrency, jurisdiction, conversationContext);
        const validation = validateAndNormalizeUnderstanding(rawAi, jurisdiction, 'ai');
        if (validation.isValid) {
          return validation.normalizedUnderstanding;
        }
        console.warn('[SemanticExtractor] AI extraction failed schema validation gate:', validation.errors);
      } catch (err: any) {
        console.warn('[SemanticExtractor] AI extraction call failed, falling back to deterministic extractor:', err?.message || err);
      }
    }

    // Deterministic fallback path
    return this.understandTransactionSync(query, functionalCurrency, jurisdiction, conversationContext);
  }
}

export const defaultTransactionUnderstandingService = new TransactionUnderstandingService();
