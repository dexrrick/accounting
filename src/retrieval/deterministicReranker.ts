import type { HybridSearchResult } from './hybridRetriever';
import { RETRIEVAL_CONFIG } from './retrievalConfig';
import { defaultQueryTopicResolver, type QueryTopic } from './queryTopicResolver';
import {
  type ISemanticAlignmentEvaluator,
  defaultSemanticAlignmentEvaluator
} from './semanticAlignmentEvaluator';

export interface RerankContext {
  query: string;
  targetDate?: string;
  referenceDate?: string;
  topics?: QueryTopic[];
  intent?: string;
  authorities?: string[];
  includeHistorical?: boolean;
  semanticContext?: import('../services/transactionUnderstandingService').TransactionUnderstanding;
}

/**
 * Deterministic Evidence-Aware Reranker.
 *
 * Implements the Exact Stage 2 Formula:
 * S_base(d) = 0.55 * S_lex(d) + 0.45 * S_sem(d)
 * S_final(d) = S_base(d) + 0.10 * S_rrf(d) + Delta_tier(d) + Delta_topic(d) + Delta_semantics(d)
 *
 * Invariants & Constraints:
 * 1. Evidence Tier: PRIMARY_SOURCE (+0.15) > OFFICIAL_GUIDANCE (+0.05) > CURATED_SUMMARY (0.00).
 * 2. Semantic Alignment: Decoupled ISemanticAlignmentEvaluator applies structured Delta_semantics(d)
 *    evaluating source metadata (standardOrActCode, paragraphOrSection) against TransactionUnderstanding.
 * 3. Multi-topic coverage: Guarantees balanced representation across distinct queried concepts,
 *    WITHOUT forcing weak or irrelevant candidates (enforces minTopicCoverageScore >= 0.35).
 * 4. Deterministic tie-breaking:
 *    - Score descending
 *    - Evidence Tier precedence
 *    - parentRecordId lexicographical ascending
 *    - startOffset ascending
 */
export class DeterministicReranker {
  private semanticEvaluator: ISemanticAlignmentEvaluator;

  constructor(semanticEvaluator: ISemanticAlignmentEvaluator = defaultSemanticAlignmentEvaluator) {
    this.semanticEvaluator = semanticEvaluator;
  }
  /**
   * Normalizes lexical scores to [0, 1] across candidate set.
   */
  private normalizeLexicalScores(candidates: HybridSearchResult[]): Map<string, number> {
    const map = new Map<string, number>();
    let maxLex = 0;

    for (const c of candidates) {
      if (c.lexicalScore && c.lexicalScore > maxLex) {
        maxLex = c.lexicalScore;
      }
    }

    for (const c of candidates) {
      if (!c.lexicalScore || maxLex <= 0) {
        map.set(c.chunk.id, 0);
      } else {
        map.set(c.chunk.id, Math.round((c.lexicalScore / maxLex) * 1e6) / 1e6);
      }
    }

    return map;
  }

  /**
   * Reranks hybrid candidates using exact 55/45 + tier + topic scoring.
   */
  public rerank(
    candidates: HybridSearchResult[],
    context: RerankContext
  ): HybridSearchResult[] {
    if (!candidates || candidates.length === 0) return [];

    const normLexMap = this.normalizeLexicalScores(candidates);
    const resolvedTopics = context.topics || defaultQueryTopicResolver.decomposeQuery(context.query, context.semanticContext).topics;
    const topicsByConcept = new Map<string, QueryTopic[]>();
    for (const topic of resolvedTopics) {
      const conceptId = topic.canonicalConceptId ?? topic.id;
      const aliases = topicsByConcept.get(conceptId) ?? [];
      aliases.push(topic);
      topicsByConcept.set(conceptId, aliases);
    }
    const topicConceptGroups = [...topicsByConcept.entries()].map(([conceptId, aliases]) => ({ conceptId, aliases }));

    const scoredCandidates: Array<{ item: HybridSearchResult; finalScore: number }> = [];

    for (const item of candidates) {
      const chunk = item.chunk;

      // 1. S_lex in [0, 1]
      const sLex = normLexMap.get(chunk.id) || 0;

      // 2. S_sem in [0, 1] (clamped non-negative cosine similarity)
      const sSem = Math.max(0, item.vectorScore || 0);

      // 3. S_base = 0.55 * S_lex + 0.45 * S_sem
      const sBase = (RETRIEVAL_CONFIG.lexicalWeight * sLex) + (RETRIEVAL_CONFIG.semanticWeight * sSem);

      // 4. S_rrf term (0.10 * S_rrf)
      const sRrfTerm = RETRIEVAL_CONFIG.rrfWeight * (item.normalizedRrfScore || 0);

      // 5. Delta_tier
      let deltaTier = 0;
      if (chunk.evidenceTier === 'PRIMARY_SOURCE') {
        deltaTier = RETRIEVAL_CONFIG.tierWeights.PRIMARY_SOURCE;
      } else if (chunk.evidenceTier === 'OFFICIAL_GUIDANCE') {
        deltaTier = RETRIEVAL_CONFIG.tierWeights.OFFICIAL_GUIDANCE;
      } else if (chunk.evidenceTier === 'CURATED_SUMMARY') {
        deltaTier = RETRIEVAL_CONFIG.tierWeights.CURATED_SUMMARY;
      } else {
        deltaTier = RETRIEVAL_CONFIG.tierWeights.APPLICATION_RULE;
      }

      // 6. Delta_topic: +0.10 per distinct canonical concept satisfied; compatibility aliases count once.
      const matchedConcepts = new Set<string>();
      for (const topic of resolvedTopics) {
        if (defaultQueryTopicResolver.chunkMatchesTopic(chunk.chunkText, topic)) {
          matchedConcepts.add(topic.canonicalConceptId ?? topic.id);
        }
      }
      const deltaTopic = matchedConcepts.size * RETRIEVAL_CONFIG.topicMatchWeight;

      // 7. Delta_semantics: Decoupled evaluation of source metadata against TransactionUnderstanding
      const semScore = this.semanticEvaluator.evaluateAlignment(
        chunk,
        item.parentRecord,
        context.semanticContext
      );
      const deltaSemantics = semScore.deltaSemantics;

      // S_final = S_base + 0.10 * S_rrf + Delta_tier + Delta_topic + Delta_semantics
      const finalScore = Math.round((sBase + sRrfTerm + deltaTier + deltaTopic + deltaSemantics) * 1e6) / 1e6;

      const scoredItem: HybridSearchResult = {
        ...item,
        finalScore,
        deltaSemantics,
        semanticScoreExplanation: semScore
      };

      scoredCandidates.push({ item: scoredItem, finalScore });
    }

    // Deterministic Sort
    const tierOrder = (tier: string) => {
      if (tier === 'PRIMARY_SOURCE') return 3;
      if (tier === 'OFFICIAL_GUIDANCE') return 2;
      return 1;
    };

    scoredCandidates.sort((a, b) => {
      // 1. Final score descending
      if (Math.abs(b.finalScore - a.finalScore) > 1e-6) {
        return b.finalScore - a.finalScore;
      }
      // 2. Evidence tier precedence
      const tierDiff = tierOrder(b.item.chunk.evidenceTier) - tierOrder(a.item.chunk.evidenceTier);
      if (tierDiff !== 0) return tierDiff;

      // 3. parentRecordId ascending
      const idDiff = a.item.parentRecord.id.localeCompare(b.item.parentRecord.id);
      if (idDiff !== 0) return idDiff;

      // 4. startOffset ascending
      return a.item.chunk.startOffset - b.item.chunk.startOffset;
    });

    // Multi-Topic Coverage Pass:
    // If multi-topic query, ensure each distinct concept gets at least one top slot
    // WITHOUT forcing weak/irrelevant evidence (enforces minTopicCoverageScore)
    const finalSelection: HybridSearchResult[] = [];
    const remainingSlots = RETRIEVAL_CONFIG.finalTopK;

    if (topicConceptGroups.length > 1) {
      const candidateList = [...scoredCandidates];
      const minCoverageScore = RETRIEVAL_CONFIG.minTopicCoverageScore ?? 0.35;

      // First pass: pick best candidate for each distinct concept if it meets minimum quality threshold.
      for (const topicGroup of topicConceptGroups) {
        const bestForTopic = candidateList.find(
          (c) =>
            !finalSelection.some((s) => s.chunk.id === c.item.chunk.id) &&
            topicGroup.aliases.some(topic => defaultQueryTopicResolver.chunkMatchesTopic(c.item.chunk.chunkText, topic)) &&
            c.finalScore >= minCoverageScore
        );

        if (bestForTopic) {
          finalSelection.push(bestForTopic.item);
        }
      }

      // Second pass: fill remaining slots with highest-scoring candidates
      for (const c of candidateList) {
        if (finalSelection.length >= remainingSlots) break;
        if (!finalSelection.some((s) => s.chunk.id === c.item.chunk.id)) {
          finalSelection.push(c.item);
        }
      }
    } else {
      for (const c of scoredCandidates) {
        if (finalSelection.length >= remainingSlots) break;
        finalSelection.push(c.item);
      }
    }

    return finalSelection;
  }
}

export const defaultDeterministicReranker = new DeterministicReranker();
