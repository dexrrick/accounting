import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import type { VerifiedChunk } from './provisionChunker';
import type { TransactionUnderstanding, SemanticExtractionTier } from '../services/transactionUnderstandingService';
import { RETRIEVAL_CONFIG } from './retrievalConfig';

export interface SemanticAlignmentScore {
  baseDeltaSemantics: number; // Base semantic delta in [-0.25, +0.25] before provenance scaling
  provenanceMultiplier: number; // 1.0 for AI_REASONING, 0.70 (configurable) for DETERMINISTIC_HEURISTIC_FALLBACK
  finalDeltaSemantics: number; // baseDeltaSemantics * provenanceMultiplier, clamped in [-0.25, +0.25]
  deltaSemantics: number; // Clamped in [-0.25, +0.25] (backward-compatible alias for finalDeltaSemantics)
  boost: number;
  penalty: number;
  explanation: string;
  matchedAttributes: string[];
  conflictAttributes: string[];
  hasSemanticConflict: boolean;
  provenanceTier?: SemanticExtractionTier;
  confidence?: number;
}

export interface ISemanticAlignmentEvaluator {
  evaluateAlignment(
    chunk: VerifiedChunk,
    parentRecord: AuthoritativeSourceRecord,
    semanticContext?: TransactionUnderstanding
  ): SemanticAlignmentScore;
}

/**
 * Deterministic Semantic Alignment Evaluator.
 *
 * Core Architecture & Constraints:
 * 1. Evaluates STRUCTURED SOURCE METADATA (standardOrActCode, paragraphOrSection, domain, authority, tags).
 *    NEVER performs ad-hoc keyword searching on raw chunk text.
 * 2. Decoupled from the core mathematical reranker.
 * 3. Enforces strict accounting-law invariants:
 *    - own_company_equity boosts Companies Act 1967 §68/§63 and SFRS(I) 1-32 §33; heavily penalizes SFRS(I) 9 FVTPL.
 *    - external_entity_equity boosts SFRS(I) 9 / IAS 21; penalizes Companies Act §68.
 *    - Counterparty roles (shareholder, director, customer, supplier, employee) boost authoritative governance provisions.
 * 4. Calibrated Provenance Weighting:
 *    - AI_REASONING receives Full Semantic Weighting (1.0x).
 *    - DETERMINISTIC_HEURISTIC_FALLBACK receives scaled multiplier (0.70x).
 *    - 'unknown' attributes are strictly neutral (0.00).
 */
export class DeterministicSemanticAlignmentEvaluator implements ISemanticAlignmentEvaluator {
  public evaluateAlignment(
    chunk: VerifiedChunk,
    parentRecord: AuthoritativeSourceRecord,
    semanticContext?: TransactionUnderstanding
  ): SemanticAlignmentScore {
    if (!semanticContext) {
      return {
        baseDeltaSemantics: 0,
        provenanceMultiplier: 1.0,
        finalDeltaSemantics: 0,
        deltaSemantics: 0,
        boost: 0,
        penalty: 0,
        explanation: 'No semantic context provided (neutral alignment)',
        matchedAttributes: [],
        conflictAttributes: [],
        hasSemanticConflict: false
      };
    }

    const isFallback = Boolean(semanticContext.provenance?.isFallback);
    const provenanceTier: SemanticExtractionTier = semanticContext.provenance?.tier || (isFallback ? 'DETERMINISTIC_HEURISTIC_FALLBACK' : 'AI_REASONING');
    const provenanceMultiplier = isFallback
      ? (RETRIEVAL_CONFIG.fallbackSemanticMultiplier ?? 0.70)
      : 1.0;
    const confidence = semanticContext.confidence;

    let boost = 0;
    let penalty = 0;
    const matchedAttributes: string[] = [];
    const conflictAttributes: string[] = [];

    const actCode = (parentRecord.standardOrActCode || '').trim();
    const section = (parentRecord.paragraphOrSection || chunk.section || chunk.sourceLocator?.section || '').toLowerCase().replace(/[\s\-_()§]/g, '');
    const tags = parentRecord.tags || [];

    // -------------------------------------------------------------------------
    // 1. OWNERSHIP CONTEXT ALIGNMENT & CONFLICT
    // -------------------------------------------------------------------------
    const ownContext = semanticContext.ownershipContext;
    if (ownContext === 'own_equity' || ownContext === 'own_company_equity') {
      // Positive alignment: Companies Act 1967 §68 (abolition of par value / capital credit)
      // or §63 (unpaid allotment receivable) or §78B (capital reduction)
      if (actCode === 'Companies Act 1967' && (section.includes('68') || section.includes('63') || section.includes('78b'))) {
        boost += RETRIEVAL_CONFIG.semanticAlignmentBoost;
        matchedAttributes.push(`own_equity:Companies Act 1967 (§${section})`);
      }

      // Positive alignment: SFRS(I) 1-32 §33 (own shares equity recognition / prohibition of financial asset)
      if (actCode === 'SFRS(I) 1-32' && section.includes('33')) {
        boost += RETRIEVAL_CONFIG.semanticAlignmentBoost;
        matchedAttributes.push('own_equity:SFRS(I) 1-32 §33');
      }

      // Negative conflict: SFRS(I) 9 / IFRS 9 (financial asset at FVTPL/FVTOCI)
      if (actCode === 'SFRS(I) 9' || actCode === 'IFRS 9' || tags.some(t => t.toLowerCase().includes('fvtpl') || t.toLowerCase().includes('fvtoci'))) {
        penalty += RETRIEVAL_CONFIG.semanticConflictPenalty;
        conflictAttributes.push('own_equity:SFRS(I) 9 Financial Asset Conflict');
      }

      // Negative conflict: IAS 21 / SFRS(I) 1-21 foreign shares / unrealized FX gains on own capital
      if (actCode === 'IAS 21' || actCode === 'SFRS(I) 1-21') {
        penalty += -0.10;
        conflictAttributes.push('own_equity:Foreign Exchange Conflict');
      }
    } else if (ownContext === 'external_investment' || ownContext === 'external_entity_equity') {
      // Positive alignment: SFRS(I) 9 / IFRS 9 (financial assets) and IAS 21 / SFRS(I) 1-21 (forex)
      if (actCode === 'SFRS(I) 9' || actCode === 'IFRS 9' || actCode === 'IAS 21' || actCode === 'SFRS(I) 1-21') {
        boost += RETRIEVAL_CONFIG.semanticAlignmentBoost;
        matchedAttributes.push(`external_investment:${actCode}`);
      }

      // Negative conflict: Companies Act 1967 §68 (own share capital allotment is inapplicable)
      if (actCode === 'Companies Act 1967' && section.includes('68')) {
        penalty += RETRIEVAL_CONFIG.semanticConflictPenalty;
        conflictAttributes.push('external_investment:Companies Act 1967 §68 Conflict');
      }
    }
    // 'unknown' or 'not_applicable' is strictly neutral (0 boost, 0 penalty)

    // -------------------------------------------------------------------------
    // 2. TRANSACTION TYPE ALIGNMENT & CONFLICT
    // -------------------------------------------------------------------------
    const txType = semanticContext.transactionType;
    if (txType === 'lease_payment' || txType === 'lease_liability_accrual') {
      if (actCode === 'SFRS(I) 16' || actCode === 'IFRS 16') {
        boost += RETRIEVAL_CONFIG.semanticAlignmentBoost;
        matchedAttributes.push('transactionType:lease:SFRS(I) 16');
      }
      if (actCode === 'Companies Act 1967' && section.includes('68')) {
        penalty += RETRIEVAL_CONFIG.semanticConflictPenalty;
        conflictAttributes.push('transactionType:lease:Companies Act §68 Conflict');
      }
    } else if (txType === 'rd_capitalization') {
      if (actCode === 'SFRS(I) 1-38' && section.includes('57')) {
        boost += RETRIEVAL_CONFIG.semanticAlignmentBoost;
        matchedAttributes.push('transactionType:rd_capitalization:SFRS(I) 1-38 §57');
      }
    } else if (txType === 'share_capital_issuance' || txType === 'share_subscription' || txType === 'capital_reduction' || txType === 'equity_issuance_subscription') {
      if (actCode === 'Companies Act 1967' && (section.includes('68') || section.includes('63') || section.includes('78b'))) {
        boost += RETRIEVAL_CONFIG.semanticAlignmentBoost;
        matchedAttributes.push(`transactionType:${txType}:Companies Act 1967 (§${section})`);
      }
    } else if (txType === 'payroll_payment') {
      if (actCode === 'Employment Act 1968' || actCode === 'Central Provident Fund Act 1953') {
        boost += RETRIEVAL_CONFIG.semanticAlignmentBoost;
        matchedAttributes.push(`transactionType:payroll:${actCode}`);
      }
    } else if (txType === 'tax_payment' || txType === 'tax_provision') {
      if (actCode === 'Income Tax Act 1947') {
        boost += RETRIEVAL_CONFIG.semanticAlignmentBoost;
        matchedAttributes.push(`transactionType:tax:${actCode}`);
      }
    }

    // -------------------------------------------------------------------------
    // 3. INSTRUMENT ALIGNMENT
    // -------------------------------------------------------------------------
    const instrument = semanticContext.instrument;
    if (instrument === 'intangible_asset') {
      if (actCode === 'SFRS(I) 1-38') {
        boost += RETRIEVAL_CONFIG.semanticAlignmentBoost;
        matchedAttributes.push('instrument:intangible_asset:SFRS(I) 1-38');
      }
    } else if (instrument === 'fixed_asset' || instrument === 'property_plant_equipment') {
      if (actCode === 'SFRS(I) 1-16') {
        boost += RETRIEVAL_CONFIG.semanticAlignmentBoost;
        matchedAttributes.push('instrument:fixed_asset:SFRS(I) 1-16');
      }
    } else if (instrument === 'debt_instrument' || instrument === 'marketable_securities' || instrument === 'derivative') {
      if (actCode === 'SFRS(I) 9') {
        boost += RETRIEVAL_CONFIG.semanticAlignmentBoost;
        matchedAttributes.push(`instrument:${instrument}:SFRS(I) 9`);
      }
    }

    // -------------------------------------------------------------------------
    // 4. COUNTERPARTY ROLE ALIGNMENT
    // -------------------------------------------------------------------------
    const role = semanticContext.counterparty?.role;
    if (role === 'shareholder' || role === 'director_shareholder') {
      if (actCode === 'Companies Act 1967' && (section.includes('68') || section.includes('63') || section.includes('78b') || section.includes('142'))) {
        boost += 0.05;
        matchedAttributes.push('counterparty:shareholder:Companies Act');
      }
    } else if (role === 'director') {
      if (actCode === 'Companies Act 1967' && section.includes('156')) {
        boost += 0.10;
        matchedAttributes.push('counterparty:director:Section 156 Conflict Disclosure');
      }
    } else if (role === 'customer') {
      if (actCode.includes('Goods and Services Tax') && (section.includes('82') || section.includes('14'))) {
        boost += 0.10;
        matchedAttributes.push('counterparty:customer:GST Bad Debt / Reverse Charge');
      }
    } else if (role === 'supplier') {
      if (actCode === 'SFRS(I) 1-16' && section.includes('16')) {
        boost += 0.10;
        matchedAttributes.push('counterparty:supplier:Trade Discount Deduction');
      }
    } else if (role === 'employee') {
      if (actCode === 'Employment Act 1968') {
        boost += 0.10;
        matchedAttributes.push('counterparty:employee:Employment Act');
      }
    }

    // -------------------------------------------------------------------------
    // 5. PAYMENT STATUS ALIGNMENT
    // -------------------------------------------------------------------------
    if (semanticContext.paymentStatus === 'unpaid') {
      if (actCode === 'Companies Act 1967' && section.includes('63')) {
        boost += 0.05;
        matchedAttributes.push('paymentStatus:unpaid:Companies Act §63(1) Allotment Receivable');
      }
    }

    // -------------------------------------------------------------------------
    // 6. PROVENANCE SCALING & MATHEMATICAL CLAMPING
    // -------------------------------------------------------------------------
    const rawBaseDelta = boost + penalty;
    const clampedBaseDelta = Math.min(0.25, Math.max(-0.25, rawBaseDelta));
    const baseDeltaSemantics = Math.round(clampedBaseDelta * 1e6) / 1e6;

    const rawFinalDelta = baseDeltaSemantics * provenanceMultiplier;
    const clampedFinalDelta = Math.min(0.25, Math.max(-0.25, rawFinalDelta));
    const finalDeltaSemantics = Math.round(clampedFinalDelta * 1e6) / 1e6;
    const deltaSemantics = finalDeltaSemantics;

    const hasSemanticConflict = conflictAttributes.length > 0;

    const rationales: string[] = [];
    if (matchedAttributes.length > 0) {
      rationales.push(`Matched: [${matchedAttributes.join(', ')}] (+${boost.toFixed(2)})`);
    }
    if (conflictAttributes.length > 0) {
      rationales.push(`Conflict: [${conflictAttributes.join(', ')}] (${penalty.toFixed(2)})`);
    }
    if (rationales.length === 0) {
      rationales.push('Neutral (0.00)');
    }

    const tierLabel = isFallback
      ? `Deterministic Heuristic Fallback (${provenanceMultiplier.toFixed(2)}x)`
      : `Full Semantic Weighting (${provenanceMultiplier.toFixed(1)}x)`;

    const explanation = `Δ_semantics = ${deltaSemantics >= 0 ? '+' : ''}${deltaSemantics.toFixed(3)} [Base: ${baseDeltaSemantics >= 0 ? '+' : ''}${baseDeltaSemantics.toFixed(2)} * ${tierLabel}]: ${rationales.join('; ')}`;

    return {
      baseDeltaSemantics,
      provenanceMultiplier,
      finalDeltaSemantics,
      deltaSemantics,
      boost,
      penalty,
      explanation,
      matchedAttributes,
      conflictAttributes,
      hasSemanticConflict,
      provenanceTier,
      confidence
    };
  }
}

export const defaultSemanticAlignmentEvaluator = new DeterministicSemanticAlignmentEvaluator();
