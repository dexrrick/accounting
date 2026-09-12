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
import type {
  ConversationAccountingContext,
  FollowUpEventAnalysis,
  TargetResolutionCriteria,
  OwnershipContext,
  CounterpartyRole,
  TransactionNatureType,
  InstrumentType,
  EquityMeasurementBasis,
  UnderlyingTransactionState
} from '../types/conversationState';
import { executeStructuredLlmCall } from './aiTransport';
import { repairAndParseAIJson } from '../utils/jsonRepair';

export type SemanticExtractionTier = 'AI_REASONING' | 'DETERMINISTIC_HEURISTIC_FALLBACK';

export interface SemanticProvenance {
  tier: SemanticExtractionTier;
  isFallback: boolean;
  engine: string;
  appliedRules?: string[];
  confidenceCapped: boolean;
  notice?: string;
  timestamp?: string;
}

export interface SemanticCurrency {
  value: string | null;
  source: 'explicit' | 'context_inference' | 'unknown';
  confidence: number;
  rationale?: string;
}

export interface TransactionUnderstanding {
  extractionSource?: 'ai' | 'deterministic_fallback';
  provenance: SemanticProvenance;
  reportingEntity: {
    type: 'company' | 'individual' | 'other' | 'unknown';
    description?: string;
  };
  counterparty?: {
    role: CounterpartyRole;
    description?: string;
  };
  transactionType?: TransactionNatureType;
  subject?: string;
  instrument?: InstrumentType;
  ownershipContext?: OwnershipContext;
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
  actualMeasurementBasis?: EquityMeasurementBasis;
  projectedMeasurementBasis?: EquityMeasurementBasis;
  measurementBasis?: EquityMeasurementBasis;
  isHypothetical?: boolean;
  underlyingTransaction?: UnderlyingTransactionState;
}

export interface UnderstandingValidationResult {
  isValid: boolean;
  errors: string[];
  normalizedUnderstanding: TransactionUnderstanding;
}

/**
 * Canonical Transaction Nature Types list.
 */
export const VALID_CANONICAL_TRANSACTION_TYPES: readonly TransactionNatureType[] = [
  'share_capital_issuance',
  'capital_reduction',
  'equity_investment_acquisition',
  'lease_contract',
  'lease_payment',
  'rd_capitalization',
  'asset_purchase',
  'depreciation_expense',
  'trade_discount_purchase',
  'customer_advance_payment',
  'customer_invoice',
  'director_expense_settlement',
  'director_fee_payment',
  'expense_payment',
  'inventory_purchase',
  'payroll_payment',
  'tax_payment',
  'tax_provision',
  'dividend_payment',
  'debt_settlement',
  'unclassified_transaction'
] as const;

/**
 * Canonical Balance Sheet Instruments list.
 */
export const VALID_CANONICAL_INSTRUMENTS: readonly InstrumentType[] = [
  'cash_at_bank',
  'accounts_receivable',
  'accounts_payable',
  'own_equity',
  'financial_asset_equity',
  'marketable_securities',
  'debt_instrument',
  'derivative',
  'property_plant_equipment',
  'intangible_asset',
  'right_of_use_asset',
  'lease_liability',
  'director_current_account',
  'contract_liability_deferred_revenue',
  'unknown'
] as const;

/**
 * Normalizes legacy ownership context aliases to canonical members at the boundary.
 */
export function normalizeOwnershipContext(raw?: string): OwnershipContext {
  if (!raw) return 'unknown';
  const clean = raw.trim().toLowerCase();
  if (clean === 'own_equity' || clean === 'own_company_equity') {
    return 'own_equity';
  }
  if (clean === 'external_investment' || clean === 'external_entity_equity') {
    return 'external_investment';
  }
  if (clean === 'not_applicable') {
    return 'not_applicable';
  }
  return 'unknown';
}

/**
 * Normalizes legacy transaction nature aliases to canonical members at the boundary.
 */
export function normalizeTransactionNature(raw?: string): TransactionNatureType | undefined {
  if (!raw) return undefined;
  const clean = raw.trim().toLowerCase();

  // Legacy alias boundary normalization
  if (clean === 'equity_issuance_subscription' || clean === 'share_subscription') {
    return 'share_capital_issuance';
  }
  if (clean === 'software_development_expenditure') {
    return 'rd_capitalization';
  }
  if (clean === 'asset_acquisition') {
    return 'asset_purchase';
  }
  if (clean === 'lease_liability_accrual') {
    return 'lease_contract';
  }

  // Canonical match
  const matched = VALID_CANONICAL_TRANSACTION_TYPES.find(t => t === clean);
  return matched;
}

/**
 * Normalizes legacy instrument aliases to canonical members at the boundary.
 */
export function normalizeInstrument(raw?: string): InstrumentType | undefined {
  if (!raw) return undefined;
  const clean = raw.trim().toLowerCase();

  // Legacy alias boundary normalization
  if (clean === 'equity_instrument') {
    return 'own_equity';
  }
  if (clean === 'fixed_asset') {
    return 'property_plant_equipment';
  }
  if (clean === 'amount_due_to_director') {
    return 'director_current_account';
  }
  if (clean === 'right_of_use_asset_and_lease_liability') {
    return 'right_of_use_asset';
  }
  if (clean === 'bank_loan' || clean === 'loan') {
    return 'debt_instrument';
  }
  // Measurement is a property of an instrument, not a separate instrument type.
  if (clean === 'financial_asset_at_fvtpl') {
    return 'financial_asset_equity';
  }

  // Canonical match
  const matched = VALID_CANONICAL_INSTRUMENTS.find(i => i === clean);
  return matched;
}

/**
 * Validates and normalizes raw transaction understanding objects.
 * Acts as a strict validation gate before AI output is accepted.
 */
export function validateAndNormalizeUnderstanding(
  raw: any,
  fallbackJurisdiction: string = 'SG',
  source: 'ai' | 'deterministic_fallback' = 'deterministic_fallback',
  conversationContext?: ConversationAccountingContext,
  userQuery?: string
): UnderstandingValidationResult {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return {
      isValid: false,
      errors: ['Raw understanding payload must be a non-null object'],
      normalizedUnderstanding: {
        extractionSource: source,
        provenance: {
          tier: source === 'ai' ? 'AI_REASONING' : 'DETERMINISTIC_HEURISTIC_FALLBACK',
          isFallback: source !== 'ai',
          engine: 'error_handler',
          appliedRules: ['empty_payload_fallback'],
          confidenceCapped: true,
          notice: 'Empty or invalid understanding payload fallback',
          timestamp: new Date().toISOString()
        },
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
  const counterpartyRole = raw?.counterparty?.role === 'director_shareholder'
    ? 'shareholder'
    : raw?.counterparty?.role;
  if (counterpartyRole && !validRoles.includes(counterpartyRole)) {
    errors.push(`Invalid counterparty.role: '${counterpartyRole}'`);
  }

  const rawOwnership = raw?.ownershipContext;
  let normalizedOwnership: OwnershipContext = 'unknown';
  if (rawOwnership) {
    const validKnownOwnership = [
      'own_equity',
      'external_investment',
      'not_applicable',
      'unknown',
      'own_company_equity',
      'external_entity_equity'
    ];
    if (!validKnownOwnership.includes(rawOwnership)) {
      errors.push(`Invalid ownershipContext: '${rawOwnership}'`);
    } else {
      normalizedOwnership = normalizeOwnershipContext(rawOwnership);
    }
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
  if (normalizedOwnership === 'own_equity') {
    const inst = (raw?.instrument || '').toLowerCase();
    const subj = (raw?.subject || '').toLowerCase();
    if (inst.includes('fvtpl') || inst.includes('fvtoci') || subj.includes('foreign shares') || inst.includes('financial_asset')) {
      errors.push('Contradictory classification: own_equity cannot be classified as financial asset at FVTPL/FVTOCI (SFRS(I) 1-32 §33).');
    }
    if (counterpartyRole === 'customer' || counterpartyRole === 'supplier') {
      errors.push('Contradictory classification: counterparty for own_equity cannot be customer or supplier.');
    }
  }

  if (normalizedOwnership === 'external_investment') {
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

  // Measurement basis validation and normalization
  const rawBasis = raw?.measurementBasis || raw?.followUpAnalysis?.targetMeasurementBasis;
  let validatedBasis: EquityMeasurementBasis | undefined = undefined;
  if (rawBasis) {
    const validBases = ['FVTPL', 'FVOCI', 'AMORTISED_COST', 'COST', 'UNKNOWN'];
    const upper = String(rawBasis).toUpperCase();
    if (validBases.includes(upper)) {
      validatedBasis = upper as EquityMeasurementBasis;
    } else {
      errors.push(`Invalid measurementBasis: '${rawBasis}'`);
    }
  }

  // Dangerous contradiction check: own_equity cannot have FVTPL or FVOCI measurement basis (SFRS(I) 1-32 §33)
  if (normalizedOwnership === 'own_equity' && (validatedBasis === 'FVTPL' || validatedBasis === 'FVOCI')) {
    errors.push('Contradictory classification: own_equity cannot have FVTPL or FVOCI measurement basis (SFRS(I) 1-32 §33).');
  }

  const isHypo = Boolean(raw?.isHypothetical || raw?.followUpAnalysis?.isHypothetical);
  const actualBasis = conversationContext?.actualMeasurementBasis ||
    conversationContext?.underlyingTransaction?.actualMeasurementBasis ||
    (!isHypo && validatedBasis ? validatedBasis : undefined);

  const projectedBasis = isHypo ? (validatedBasis || conversationContext?.projectedMeasurementBasis) : undefined;

  // Follow-up invariant: follow-up claims require active prior context
  if (raw?.followUpAnalysis?.isFollowUp && conversationContext !== undefined) {
    const hasPriorState = Boolean(
      conversationContext.outstandingBalances.length > 0 ||
      conversationContext.recognizedEquityTotal > 0 ||
      conversationContext.underlyingTransaction
    );
    if (!hasPriorState) {
      errors.push('Invalid follow-up claim: followUpAnalysis.isFollowUp is true but conversationContext has no outstanding balances, equity, or underlying transaction.');
    }
  }
  if (userQuery && ['settlement', 'partial_settlement'].includes(raw?.followUpAnalysis?.eventType)) {
    const hasPaymentAction = /\b(paid|pay(?:s|ing)?|payment|settle|settled|settlement|settling|remit|remitted|transfer|transferred|received|deposit|deposited|repaid|repay)\b/i.test(userQuery);
    if (!hasPaymentAction) {
      errors.push('Invalid settlement route: no payment action is stated in the user query.');
    }
  }

  const factsMissing: string[] = Array.isArray(raw?.factsMissing) ? [...raw.factsMissing] : [];
  const assumptions: string[] = Array.isArray(raw?.assumptions) ? [...raw.assumptions] : [];

  if (!raw?.reportingEntity?.type || raw.reportingEntity.type === 'unknown') {
    factsMissing.push('Reporting entity perspective is unspecified');
  }

  if (raw?.currency?.source === 'context_inference' && raw?.currency?.rationale) {
    assumptions.push(raw.currency.rationale);
  }

  if (raw?.currency?.source === 'unknown') {
    factsMissing.push('Transaction currency is unspecified');
  }

  let confidence = typeof raw?.confidence === 'number'
    ? Math.min(1, Math.max(0, raw.confidence))
    : (errors.length === 0 ? 0.85 : 0.4);

  const isFallback = source === 'deterministic_fallback';
  if (isFallback) {
    confidence = Math.min(0.65, confidence);
  }

  const provenance: SemanticProvenance = raw?.provenance ? {
    ...raw.provenance,
    tier: raw.provenance.tier || (isFallback ? 'DETERMINISTIC_HEURISTIC_FALLBACK' : 'AI_REASONING'),
    isFallback,
    confidenceCapped: isFallback
  } : {
    tier: isFallback ? 'DETERMINISTIC_HEURISTIC_FALLBACK' : 'AI_REASONING',
    isFallback,
    engine: isFallback ? 'heuristic_pattern_matcher' : 'llm_structured',
    appliedRules: isFallback ? (raw?.appliedRules || ['heuristic_lexical_fallback']) : undefined,
    confidenceCapped: isFallback,
    notice: isFallback
      ? 'Heuristic rule fallback: extracted using regex/keyword patterns; not validated by LLM reasoning'
      : undefined,
    timestamp: new Date().toISOString()
  };

  let validatedTxType: TransactionNatureType | undefined = undefined;
  if (raw?.transactionType) {
    const normalizedTx = normalizeTransactionNature(raw.transactionType);
    if (normalizedTx) {
      validatedTxType = normalizedTx;
    } else {
      errors.push(`Invalid transactionType: '${raw.transactionType}'`);
    }
  }

  let validatedInstrument: InstrumentType | undefined = undefined;
  if (raw?.instrument) {
    const normalizedInst = normalizeInstrument(raw.instrument);
    if (normalizedInst) {
      validatedInstrument = normalizedInst;
    } else {
      errors.push(`Invalid instrument: '${raw.instrument}'`);
    }
  }

  const normalized: TransactionUnderstanding = {
    extractionSource: source,
    provenance,
    reportingEntity: {
      type: (raw?.reportingEntity?.type || 'unknown'),
      description: raw?.reportingEntity?.description || undefined
    },
    counterparty: raw?.counterparty ? {
      role: (counterpartyRole || 'unknown'),
      description: raw.counterparty.description || undefined
    } : undefined,
    transactionType: validatedTxType,
    subject: raw?.subject || undefined,
    instrument: validatedInstrument,
    ownershipContext: normalizedOwnership,
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
    actualMeasurementBasis: actualBasis,
    projectedMeasurementBasis: projectedBasis,
    measurementBasis: validatedBasis || actualBasis,
    isHypothetical: isHypo,
    underlyingTransaction: conversationContext?.underlyingTransaction,
    followUpAnalysis: raw?.followUpAnalysis ? {
      eventType: raw.followUpAnalysis.eventType || 'other',
      isFollowUp: Boolean(raw.followUpAnalysis.isFollowUp),
      targetCriteria: raw.followUpAnalysis.targetCriteria,
      targetTransactionId: raw.followUpAnalysis.targetTransactionId,
      targetMeasurementBasis: raw.followUpAnalysis.targetMeasurementBasis || validatedBasis,
      targetOutstandingAccount: raw.followUpAnalysis.targetOutstandingAccount || undefined,
      settlementAmount: typeof raw.followUpAnalysis.settlementAmount === 'number' ? raw.followUpAnalysis.settlementAmount : undefined,
      remainingReceivableOrPayable: typeof raw.followUpAnalysis.remainingReceivableOrPayable === 'number' ? raw.followUpAnalysis.remainingReceivableOrPayable : undefined,
      settlementAccount: raw.followUpAnalysis.settlementAccount || 'cash_at_bank',
      isHypothetical: isHypo,
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

    // Require a whole payment-action word. "Payroll" and "repayment
    // calculation" are subjects, not evidence that cash changed hands.
    const isPaymentOrSettlementAction =
      /\b(paid|pay(?:s|ing)?|payment|settle|settled|settlement|settling|remit|remitted|transfer|transferred|received|deposit|deposited|repaid|repay)\b/i.test(query) &&
      !(/\b(resign(?:ed|ation)?|pro[ -]?rat(?:e|ed|ion)|last\s+day)\b/i.test(query) &&
        !/\b(paid|payment|settle|settled|settlement|transfer|transferred|received|deposit|deposited)\b/i.test(query));

    // Check if query explicitly introduces a new transaction subject distinct from underlying transaction
    const introducesNewSubject = Boolean(
      conversationContext?.underlyingTransaction && (
        (ownershipContext !== 'unknown' &&
         conversationContext.underlyingTransaction.ownershipContext &&
         conversationContext.underlyingTransaction.ownershipContext !== 'unknown' &&
         ownershipContext !== conversationContext.underlyingTransaction.ownershipContext) ||
        (transactionType &&
         !['debt_settlement', 'unclassified_transaction'].includes(transactionType) &&
         transactionType !== conversationContext.underlyingTransaction.type &&
         !isPaymentOrSettlementAction)
      )
    );

    const isHypothetical = /\b(what if|suppose|assuming|if)\b/i.test(query);

    if (hasPriorContext && !introducesNewSubject && isPaymentOrSettlementAction) {
      const isLoanRepayment = q.includes('repaid') || q.includes('repay') || ((q.includes('loan') || q.includes('debt')) && (q.includes('principal') || q.includes('bank')));
      const hasReceivable = conversationContext?.outstandingBalances?.some(b => b.nature === 'RECEIVABLE') ?? false;
      const hasPayable = conversationContext?.outstandingBalances?.some(b => b.nature === 'PAYABLE' || b.category === 'LIABILITY') ?? false;

      const isReceivingPayment = !isLoanRepayment && (
                                 q.includes('paid to') ||
                                 q.includes('paid into') ||
                                 q.includes('received') ||
                                 q.includes('deposit') ||
                                 q.includes('shareholder did pay') ||
                                 q.includes('shareholder paid') ||
                                 q.includes('customer paid') ||
                                 q.includes('client paid') ||
                                 (q.includes('client') && q.includes('paid')) ||
                                 (q.includes('customer') && q.includes('paid')) ||
                                 q.includes('did pay') ||
                                 q.includes('did paid') ||
                                 (hasReceivable && !hasPayable));

      const targetRole = q.includes('shareholder') ? 'shareholder' :
                         q.includes('director') ? 'director' :
                         (q.includes('customer') || q.includes('client')) ? 'customer' :
                         (q.includes('supplier') || q.includes('vendor')) ? 'supplier' :
                         (q.includes('lender') || q.includes('loan') || isLoanRepayment) ? 'lender' :
                         conversationContext?.outstandingBalances?.[0]?.counterpartyRole;

      const targetNature: 'RECEIVABLE' | 'PAYABLE' = (isReceivingPayment && !isLoanRepayment) ? 'RECEIVABLE' : 'PAYABLE';

      const txMatch = query.match(/\b(tx-[a-zA-Z0-9_-]+)\b/i);
      const targetTransactionId = txMatch ? txMatch[1] : undefined;

      const targetCriteria: TargetResolutionCriteria = {
        counterpartyRole: targetRole,
        nature: targetNature,
        transactionId: targetTransactionId,
        queryTokens: query.toLowerCase().split(/\s+/).filter(Boolean),
        amount,
        currency: currency.value || undefined
      };

      followUpAnalysis = {
        eventType: 'settlement',
        isFollowUp: true,
        targetCriteria,
        targetTransactionId,
        targetOutstandingAccount: targetRole ? `${targetRole} balance` : undefined,
        settlementAmount: amount,
        settlementAccount: 'cash_at_bank',
        isHypothetical,
        explanation: `Settlement action for ${targetRole || 'counterparty'} ${targetNature.toLowerCase()}`
      };

      // Align transaction nature and perspective to settlement
      paymentStatus = 'paid';
      instrument = 'cash_at_bank';
      ownershipContext = conversationContext!.underlyingTransaction?.ownershipContext || 'own_equity';
      subject = `Settlement of ${targetRole || 'outstanding'} balance`;
      transactionType = 'debt_settlement';
      reportingEntity = { type: 'company', description: 'Reporting entity is the corporate business' };
      if (!counterparty || counterparty.role === 'unknown') {
        counterparty = {
          role: (targetRole as any) || 'shareholder',
          description: targetRole === 'shareholder' ? 'Company shareholder' : 'Counterparty'
        };
      }

      // Inherit currency if unspecified in query
      if (currency.source === 'unknown') {
        currency = {
          value: conversationContext?.underlyingTransaction?.currency || functionalCurrency,
          source: 'context_inference',
          confidence: 0.95,
          rationale: 'Inherited from active transaction context'
        };
      }
    }

    // Measurement basis extraction from query
    let measurementBasis: EquityMeasurementBasis | undefined = undefined;
    if (/\b(fvoci|fair value through other comprehensive income)\b/i.test(query)) {
      measurementBasis = 'FVOCI';
    } else if (/\b(fvtpl|fair value through profit or loss)\b/i.test(query)) {
      measurementBasis = 'FVTPL';
    } else if (/\b(amortised cost|amortized cost)\b/i.test(query)) {
      measurementBasis = 'AMORTISED_COST';
    } else if (conversationContext?.underlyingTransaction?.actualMeasurementBasis) {
      measurementBasis = conversationContext.underlyingTransaction.actualMeasurementBasis;
    }

    const isMeasurementFollowUp = Boolean(
      hasPriorContext &&
      !introducesNewSubject &&
      !isPaymentOrSettlementAction &&
      (
        /\b(fvoci|fvtpl|amortised cost|amortized cost)\b/i.test(query) ||
        (isHypothetical && (q.includes('classification') || q.includes('treatment') || q.includes('measurement') || q.includes('double entry') || q.includes('journal')))
      )
    );

    if (isMeasurementFollowUp && conversationContext?.underlyingTransaction) {
      const priorTx = conversationContext.underlyingTransaction;
      const targetBasis: EquityMeasurementBasis =
        (/\b(fvoci|fair value through other comprehensive income)\b/i.test(query)) ? 'FVOCI' :
        (/\b(fvtpl|fair value through profit or loss)\b/i.test(query)) ? 'FVTPL' :
        (/\b(amortised cost|amortized cost)\b/i.test(query)) ? 'AMORTISED_COST' :
        (measurementBasis || 'UNKNOWN');

      followUpAnalysis = {
        eventType: 'hypothetical_branch',
        isFollowUp: true,
        targetMeasurementBasis: targetBasis,
        isHypothetical: true,
        explanation: `Hypothetical ${targetBasis} measurement basis for existing transaction`
      };

      // Inherit immutable quantitative transaction facts from prior underlying transaction
      if (amount === undefined && priorTx.totalAmount !== undefined) {
        amount = priorTx.totalAmount;
      }
      if (currency.source === 'unknown') {
        currency = {
          value: priorTx.currency || functionalCurrency,
          source: 'context_inference',
          confidence: 0.95,
          rationale: 'Inherited from active transaction context'
        };
      }
      if (ownershipContext === 'unknown' && priorTx.ownershipContext) {
        ownershipContext = priorTx.ownershipContext;
      }
      if (instrument === 'unknown' && priorTx.instrument) {
        instrument = priorTx.instrument;
      }
      if (!transactionType || transactionType === 'unclassified_transaction') {
        transactionType = priorTx.type;
      }
      if (!subject && priorTx.subject) {
        subject = priorTx.subject;
      }
      measurementBasis = targetBasis;
    } else if (!followUpAnalysis && isHypothetical && hasPriorContext && !introducesNewSubject && conversationContext?.underlyingTransaction) {
      const priorTx = conversationContext.underlyingTransaction;
      followUpAnalysis = {
        eventType: 'hypothetical_branch',
        isFollowUp: true,
        isHypothetical: true,
        explanation: 'Hypothetical parameter variation for existing transaction'
      };

      if (amount === undefined && priorTx.totalAmount !== undefined) {
        amount = priorTx.totalAmount;
      }
      if (currency.source === 'unknown') {
        currency = {
          value: priorTx.currency || functionalCurrency,
          source: 'context_inference',
          confidence: 0.95,
          rationale: 'Inherited from active transaction context'
        };
      }
      if (ownershipContext === 'unknown' && priorTx.ownershipContext) {
        ownershipContext = priorTx.ownershipContext;
      }
      if (instrument === 'unknown' && priorTx.instrument) {
        instrument = priorTx.instrument;
      }
      if (!transactionType || transactionType === 'unclassified_transaction') {
        transactionType = priorTx.type;
      }
      if (!subject && priorTx.subject) {
        subject = priorTx.subject;
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

    // In heuristic fallback, track applied rules and cap confidence at <= 0.65
    const appliedRules: string[] = [];
    if (reportingEntity.type !== 'unknown') appliedRules.push(`reporting_entity:${reportingEntity.type}`);
    if (counterparty && counterparty.role !== 'unknown') appliedRules.push(`counterparty_role:${counterparty.role}`);
    if (ownershipContext !== 'unknown') appliedRules.push(`ownership_context:${ownershipContext}`);
    if (transactionType && transactionType !== 'unclassified_transaction') appliedRules.push(`transaction_type:${transactionType}`);
    if (paymentStatus !== 'unknown') appliedRules.push(`payment_status:${paymentStatus}`);
    if (currency.source !== 'unknown') appliedRules.push(`currency:${currency.source}`);
    if (followUpAnalysis?.isFollowUp) appliedRules.push(`follow_up:${followUpAnalysis.eventType}`);

    let confidence = 0.65;
    if (ownershipContext === 'unknown') confidence -= 0.15;
    if (currency.source === 'unknown') confidence -= 0.10;
    if (amount === undefined) confidence -= 0.10;
    confidence = Math.min(0.65, Math.max(0.20, Math.round(confidence * 100) / 100));

    const provenance: SemanticProvenance = {
      tier: 'DETERMINISTIC_HEURISTIC_FALLBACK',
      isFallback: true,
      engine: 'heuristic_pattern_matcher',
      appliedRules,
      confidenceCapped: true,
      notice: 'Heuristic rule fallback: extracted using regex/keyword patterns; not validated by LLM reasoning',
      timestamp: new Date().toISOString()
    };

    const rawUnderstanding: TransactionUnderstanding = {
      extractionSource: 'deterministic_fallback',
      provenance,
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
      confidence,
      actualMeasurementBasis: conversationContext?.actualMeasurementBasis || conversationContext?.underlyingTransaction?.actualMeasurementBasis,
      projectedMeasurementBasis: isHypothetical ? (measurementBasis || conversationContext?.projectedMeasurementBasis) : undefined,
      measurementBasis: measurementBasis || conversationContext?.actualMeasurementBasis,
      isHypothetical,
      underlyingTransaction: conversationContext?.underlyingTransaction,
      followUpAnalysis
    };

    const validation = validateAndNormalizeUnderstanding(rawUnderstanding, jurisdiction, 'deterministic_fallback', conversationContext, query);
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
    ownershipContext: OwnershipContext;
    subject?: string;
    instrument?: InstrumentType;
    transactionType?: TransactionNatureType;
  } {
    // 1. Customer Advance / Deferred Revenue
    const isCustomerAdvance =
      (q.includes('customer') || q.includes('client')) &&
      (q.includes('paid us before') || q.includes('advance for goods') || q.includes('advance') || q.includes('received money from customer before'));

    if (isCustomerAdvance) {
      return {
        ownershipContext: 'not_applicable',
        subject: 'advance payment for goods or services',
        instrument: 'accounts_receivable',
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
        instrument: 'director_current_account',
        transactionType: 'director_expense_settlement'
      };
    }

    // 3. External Investment (evaluated before general equity to properly isolate named external assets)
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

    // 4. Own Equity Issuance / Subscription
    const isOwnEquity =
      !isExternalInvestment && (
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
        (q.includes('shareholder') && (q.includes('contributed') || q.includes('invested') || q.includes('shares'))) ||
        q.includes('company shares') ||
        (q.includes('share capital') && q.includes('unpaid'))
      );

    if (isOwnEquity) {
      return {
        ownershipContext: 'own_equity',
        subject: 'ordinary share capital of reporting entity',
        instrument: 'own_equity',
        transactionType: 'share_capital_issuance'
      };
    }

    // 5. Commercial Lease (IFRS 16)
    if (
      q.includes('rental agreement') ||
      q.includes('lease agreement') ||
      q.includes('leased') ||
      q.includes('office lease') ||
      q.includes('property lease') ||
      q.includes('tenancy agreement') ||
      (q.includes('lease') && (q.includes('rent') || q.includes('month') || q.includes('year')))
    ) {
      return {
        ownershipContext: 'not_applicable',
        subject: 'commercial property lease',
        instrument: 'right_of_use_asset',
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

    // 7. Software Development / Intangible Asset (SFRS(I) 1-38)
    if (q.includes('software') || q.includes('development') || q.includes('r&d') || q.includes('intangible')) {
      return {
        ownershipContext: 'not_applicable',
        subject: 'Software development / R&D expenditure',
        instrument: 'intangible_asset',
        transactionType: 'rd_capitalization'
      };
    }

    // 8. PPE / Motor Vehicle Acquisition (SFRS(I) 1-16)
    if (q.includes('car') || q.includes('vehicle') || q.includes('machinery') || q.includes('equipment')) {
      return {
        ownershipContext: 'not_applicable',
        subject: 'property, plant and equipment acquisition',
        instrument: 'property_plant_equipment',
        transactionType: 'asset_purchase'
      };
    }

    // 9. Trade Discount Purchase / Inventory (SFRS(I) 1-2)
    if (q.includes('trade discount')) {
      return {
        ownershipContext: 'not_applicable',
        subject: 'inventory or goods purchase with trade discount',
        instrument: 'accounts_payable',
        transactionType: 'trade_discount_purchase'
      };
    }

    // 10. Customer Invoice / Sales on Credit
    if ((q.includes('invoice') || q.includes('on credit') || q.includes('consulting') || q.includes('sales')) && (q.includes('customer') || q.includes('client'))) {
      return {
        ownershipContext: 'not_applicable',
        subject: 'trade sales on credit to customer',
        instrument: 'accounts_receivable',
        transactionType: 'customer_invoice'
      };
    }

    // 11. Bank Loan / Debt Borrowing
    if (q.includes('bank loan') || q.includes('loan principal') || (q.includes('loan') && (q.includes('borrow') || q.includes('bank') || q.includes('repaid')))) {
      return {
        ownershipContext: 'not_applicable',
        subject: 'bank loan borrowing',
        instrument: 'debt_instrument',
        transactionType: 'debt_settlement'
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
  "measurementBasis": "FVTPL" | "FVOCI" | "AMORTISED_COST" | "COST" | "UNKNOWN" | null,
  "isHypothetical": boolean,
  "followUpAnalysis": {
    "eventType": "settlement" | "partial_settlement" | "hypothetical_branch" | "reclassification" | "new_transaction" | "other",
    "isFollowUp": boolean,
    "targetMeasurementBasis": "FVTPL" | "FVOCI" | "AMORTISED_COST" | "COST" | "UNKNOWN" | null,
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
   - The words "his", "her", "owner", a currency amount, or "payment" alone are NOT payroll evidence. Classify payroll_payment only when the query establishes an employee/wage/remuneration relationship (for example salary, wages, payroll, CPF, or employee).
   - For own-equity contributions using equipment, inventory, intellectual property, or other non-cash/in-kind consideration, retain ownershipContext = "own_equity", paymentStatus = "paid" when consideration was delivered, and add the asset description/fair-value support to factsMissing when absent.
5. CURRENCY:
   - In Singapore context (default), if "$" is used without explicit USD/EUR/etc, set currency.value = "SGD", currency.source = "context_inference", currency.confidence = 0.9.
   - Do NOT assume USD unless explicitly stated ("USD", "US Dollar", "US$").
   - If no currency symbol or code is provided, set currency.value = null, currency.source = "unknown", and add "Transaction currency is unspecified" to factsMissing.
6. AMOUNT:
   - Extract numeric transaction magnitude (e.g. 1 from "$1", 3000 from "3k"). Dates (e.g. 15/12/2026), percentages (9%), terms (30-day), or item counts (5 laptops) are NOT transaction amounts.
7. MULTI-TURN CONVERSATION & FOLLOW-UP SETTLEMENTS:
   - A change to an employee's resignation date, work period, salary, or CPF calculation is a payroll recalculation, NOT a settlement. The word "payroll" does not establish that money was paid. Preserve prior employee facts and mark "what if" changes as hypothetical.
   - When [PRIOR CONVERSATION ACCOUNTING CONTEXT] is provided and user asks about payment/settlement (e.g. "what if the shareholder did paid to company bank account", "what if they paid 50 cents"):
     * followUpAnalysis.eventType = "settlement" (or "partial_settlement" if amount < outstanding balance)
     * followUpAnalysis.isFollowUp = true
     * followUpAnalysis.targetOutstandingAccount = name of the receivable/payable from prior context
     * followUpAnalysis.settlementAmount = extracted amount or full outstanding balance if not restated
     * paymentStatus = "paid"
     * instrument = "cash_at_bank"
     * ownershipContext = inherit from prior context (e.g. "own_equity")
     * Do NOT classify this as an external investment or financial asset.
8. MEASUREMENT BASIS & HYPOTHETICAL ACCOUNTING POLICY:
   - When user asks about accounting policy, classification, or what-if alternative (e.g. "what if the investment is FVOCI show me the double entry", "what if instead FVTPL"):
     * measurementBasis = "FVOCI" (or "FVTPL", "AMORTISED_COST")
     * isHypothetical = true
     * followUpAnalysis.eventType = "hypothetical_branch"
     * followUpAnalysis.isFollowUp = true
     * followUpAnalysis.isHypothetical = true
     * followUpAnalysis.targetMeasurementBasis = "FVOCI" (or corresponding basis)
     * Inherit immutable transaction facts (amount, currency, counterparty, ownership) from [PRIOR CONVERSATION ACCOUNTING CONTEXT]!`;

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
        (conversationContext.underlyingTransaction
          ? `- Underlying Transaction: ${conversationContext.underlyingTransaction.subject} (Type: ${conversationContext.underlyingTransaction.type}, Ownership: ${conversationContext.underlyingTransaction.ownershipContext}, Amount: ${conversationContext.underlyingTransaction.currency} ${conversationContext.underlyingTransaction.totalAmount}, Actual Basis: ${conversationContext.underlyingTransaction.actualMeasurementBasis || 'UNKNOWN'})\n`
          : '') +
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

    const parsed = repairAndParseAIJson(rawJsonText);
    if (parsed && typeof parsed === 'object') {
      parsed.provenance = {
        tier: 'AI_REASONING',
        isFallback: false,
        engine: typeof providerOrApiKey === 'object' ? (providerOrApiKey.activeProvider || 'llm_structured') : 'llm_structured',
        confidenceCapped: false,
        timestamp: new Date().toISOString()
      };
    }
    return parsed;
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
        const validation = validateAndNormalizeUnderstanding(rawAi, jurisdiction, 'ai', conversationContext, query);
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
