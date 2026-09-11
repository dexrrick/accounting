import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import type { VerifiedChunk } from './provisionChunker';
import type { TransactionUnderstanding } from '../services/transactionUnderstandingService';
import { RETRIEVAL_CONFIG } from './retrievalConfig';

export interface SemanticAlignmentScore {
  deltaSemantics: number; // Clamped in [-0.25, +0.25]
  boost: number;
  penalty: number;
  explanation: string;
  matchedAttributes: string[];
  conflictAttributes: string[];
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
 *    - own_equity boosts Companies Act 1967 §68/§63 and SFRS(I) 1-32 §33; heavily penalizes SFRS(I) 9 FVTPL.
 *    - external_investment boosts SFRS(I) 9 / IAS 21; penalizes Companies Act §68.
 *    - Counterparty roles (shareholder, director, customer, supplier) boost authoritative governance provisions.
 */
export class DeterministicSemanticAlignmentEvaluator implements ISemanticAlignmentEvaluator {
  public evaluateAlignment(
    chunk: VerifiedChunk,
    parentRecord: AuthoritativeSourceRecord,
    semanticContext?: TransactionUnderstanding
  ): SemanticAlignmentScore {
    if (!semanticContext) {
      return {
        deltaSemantics: 0,
        boost: 0,
        penalty: 0,
        explanation: 'No semantic context provided (neutral alignment)',
        matchedAttributes: [],
        conflictAttributes: []
      };
    }

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
    if (semanticContext.ownershipContext === 'own_equity') {
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
    } else if (semanticContext.ownershipContext === 'external_investment') {
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

    // -------------------------------------------------------------------------
    // 2. COUNTERPARTY ROLE ALIGNMENT
    // -------------------------------------------------------------------------
    const role = semanticContext.counterparty?.role;
    if (role === 'shareholder') {
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
    }

    // -------------------------------------------------------------------------
    // 3. PAYMENT STATUS ALIGNMENT
    // -------------------------------------------------------------------------
    if (semanticContext.paymentStatus === 'unpaid') {
      if (actCode === 'Companies Act 1967' && section.includes('63')) {
        boost += 0.05;
        matchedAttributes.push('paymentStatus:unpaid:Companies Act §63(1) Allotment Receivable');
      }
    }

    // Mathematical Clamping in [-0.25, +0.25]
    const rawDelta = boost + penalty;
    const clampedDelta = Math.min(0.25, Math.max(-0.25, rawDelta));
    const deltaSemantics = Math.round(clampedDelta * 1e6) / 1e6;

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

    const explanation = `Δ_semantics = ${deltaSemantics >= 0 ? '+' : ''}${deltaSemantics.toFixed(2)}: ${rationales.join('; ')}`;

    return {
      deltaSemantics,
      boost,
      penalty,
      explanation,
      matchedAttributes,
      conflictAttributes
    };
  }
}

export const defaultSemanticAlignmentEvaluator = new DeterministicSemanticAlignmentEvaluator();
