import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import type { VerifiedChunk } from './provisionChunker';
import type { TransactionUnderstanding, SemanticExtractionTier } from '../services/transactionUnderstandingService';
import { RETRIEVAL_CONFIG } from './retrievalConfig';
import { SEMANTIC_ACCOUNTING_RULES } from '../standards/semanticAccountingRules';

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
    const tags = (parentRecord.tags || []).map((t: string) => t.toLowerCase());
    const chunkTags = (chunk.tags || []).map((t: string) => t.toLowerCase());
    const allTags = [...tags, ...chunkTags];

    // Evaluate declarative rules from SEMANTIC_ACCOUNTING_RULES
    for (const rule of SEMANTIC_ACCOUNTING_RULES) {
      // 1. Check if blocked by current transaction type
      if (
        rule.blockedByTransactionTypes &&
        semanticContext.transactionType &&
        rule.blockedByTransactionTypes.includes(semanticContext.transactionType)
      ) {
        continue;
      }

      // 2. Check if rule's dimension matches semanticContext
      let matchesContext = false;
      switch (rule.dimension) {
        case 'ownership':
          if (
            semanticContext.ownershipContext &&
            semanticContext.ownershipContext !== 'unknown' &&
            semanticContext.ownershipContext !== 'not_applicable' &&
            rule.ownershipContexts?.includes(semanticContext.ownershipContext)
          ) {
            matchesContext = true;
          }
          break;
        case 'transactionType':
          if (
            semanticContext.transactionType &&
            semanticContext.transactionType !== 'unclassified_transaction' &&
            rule.transactionTypes?.includes(semanticContext.transactionType)
          ) {
            matchesContext = true;
          }
          break;
        case 'instrument':
          if (
            semanticContext.instrument &&
            semanticContext.instrument !== 'unknown' &&
            rule.instruments?.includes(semanticContext.instrument)
          ) {
            matchesContext = true;
          }
          break;
        case 'counterpartyRole':
          if (
            semanticContext.counterparty?.role &&
            semanticContext.counterparty.role !== 'unknown' &&
            rule.counterpartyRoles?.includes(semanticContext.counterparty.role)
          ) {
            matchesContext = true;
          }
          break;
        case 'paymentStatus':
          if (
            semanticContext.paymentStatus &&
            semanticContext.paymentStatus !== 'unknown' &&
            rule.paymentStatuses?.includes(semanticContext.paymentStatus)
          ) {
            matchesContext = true;
          }
          break;
      }

      if (!matchesContext) {
        continue;
      }

      // 3. Evaluate positive alignments
      for (const target of rule.positiveAlignments) {
        const actMatches =
          actCode === target.actOrStandard ||
          actCode.includes(target.actOrStandard) ||
          target.actOrStandard.includes(actCode);
        const sectionMatches =
          !target.sections ||
          target.sections.length === 0 ||
          target.sections.some(s => section.includes(s.toLowerCase()));
        const tagMatches =
          !target.tags ||
          target.tags.length === 0 ||
          target.tags.some(reqTag => allTags.some(t => t.includes(reqTag.toLowerCase())));

        if (actMatches && sectionMatches && tagMatches) {
          const boostVal = target.boost ?? RETRIEVAL_CONFIG.semanticAlignmentBoost;
          boost += boostVal;
          matchedAttributes.push(target.description);
        }
      }

      // 4. Evaluate conflicts
      for (const target of rule.conflicts) {
        const actMatches =
          actCode === target.actOrStandard ||
          actCode.includes(target.actOrStandard) ||
          target.actOrStandard.includes(actCode);
        const sectionMatches =
          !target.sections ||
          target.sections.length === 0 ||
          target.sections.some(s => section.includes(s.toLowerCase()));
        const tagMatches =
          target.tags && target.tags.length > 0
            ? target.tags.some(reqTag => allTags.some(t => t.includes(reqTag.toLowerCase())))
            : false;

        const isConflict = (actMatches && sectionMatches) || tagMatches;
        if (isConflict) {
          const penaltyVal = target.penalty ?? RETRIEVAL_CONFIG.semanticConflictPenalty;
          penalty += penaltyVal;
          conflictAttributes.push(target.description);
        }
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
