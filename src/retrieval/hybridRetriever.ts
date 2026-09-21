import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import type { VerifiedChunk } from './provisionChunker';
import { DeterministicVectorIndex } from './vectorIndex';
import { DeterministicLocalEmbeddingService } from './localVectorizer';
import { RETRIEVAL_CONFIG } from './retrievalConfig';
import { defaultTargetDateResolver } from './targetDateResolver';
import { SourceFreshnessManager } from '../standards/sourceFreshnessManager';

import type { SemanticAlignmentScore } from './semanticAlignmentEvaluator';

export interface HybridSearchResult {
  chunk: VerifiedChunk;
  parentRecord: AuthoritativeSourceRecord;
  lexicalRank?: number;
  lexicalScore?: number;
  vectorRank?: number;
  vectorScore?: number;
  rrfScore: number;
  normalizedRrfScore: number;
  finalScore?: number;
  deltaSemantics?: number;
  semanticScoreExplanation?: SemanticAlignmentScore;
}

export interface HybridRetrievalQuery {
  query: string;
  domain?: import('../types/accounting').QueryDomain;
  authorities?: import('../types/accounting').StatutoryAuthority[];
  targetDate?: string;
  referenceDate?: string;
  includeHistorical?: boolean;
  maxCandidates?: number;
  semanticContext?: import('../services/transactionUnderstandingService').TransactionUnderstanding;
}

/**
 * Hybrid Lexical + Dense Vector Retriever with Reciprocal Rank Fusion (RRF).
 *
 * Invariants & Gates:
 * 1. Executes independent Lexical and Dense Vector paths (top 20 each).
 * 2. Hard Temporal Eligibility Gate:
 *    - For an explicit targetDate: validFrom <= targetDate <= validTo.
 *      Out-of-window provisions are strictly excluded as ineligible.
 *    - For undated queries: historical provisions are hard-excluded unless historical markers exist.
 * 3. Phase 4 Admission Gate: STAGED, UNVERIFIED, or REJECTED records cannot enter candidate pool.
 * 4. Exact Mathematical RRF (k = 60):
 *    RRF(d) = sum( 1 / (60 + rank_m(d)) )
 *    Normalized: S_rrf(d) = RRF(d) / (2 / 61)
 */
export class HybridRetriever {
  private vectorIndex: DeterministicVectorIndex;
  private embeddingService: DeterministicLocalEmbeddingService;

  constructor(
    vectorIndex: DeterministicVectorIndex,
    embeddingService: DeterministicLocalEmbeddingService
  ) {
    this.vectorIndex = vectorIndex;
    this.embeddingService = embeddingService;
  }

  /**
   * Evaluates hard temporal eligibility for a chunk.
   * Returns true if eligible, false if hard-rejected.
   */
  public isTemporallyEligible(
    chunk: VerifiedChunk,
    targetDate: string | undefined,
    referenceDate: string,
    isHistoricalExplicitlyRequested: boolean
  ): boolean {
    // 1. Explicit Target Date check (Hard Gate)
    if (targetDate) {
      const fromMatch = !chunk.validFrom || chunk.validFrom <= targetDate;
      const toMatch = !chunk.validTo || chunk.validTo >= targetDate;

      if (!fromMatch || !toMatch) {
        // Out of window: Hard rejection unless historical explicitly requested
        return isHistoricalExplicitlyRequested;
      }
      return true;
    }

    // 2. Undated Query check (Hard Gate against unrequested historical provisions)
    if (chunk.validTo && chunk.validTo < referenceDate) {
      // Historical provision
      return isHistoricalExplicitlyRequested;
    }

    return true;
  }

  /**
   * Retrieves and fuses candidates from lexical candidates and dense vector search.
   */
  public retrieveHybridCandidates(
    retrievalQuery: HybridRetrievalQuery,
    lexicalMatches: Array<{ chunk: VerifiedChunk; parentRecord: AuthoritativeSourceRecord; score: number }>,
    recordLookup: (recordId: string) => AuthoritativeSourceRecord | undefined
  ): {
    candidates: HybridSearchResult[];
    excludedUnverified: number;
    excludedTemporalMismatch: number;
  } {
    const {
      query,
      domain,
      authorities,
      targetDate: explicitTargetDate,
      referenceDate = SourceFreshnessManager.DEFAULT_REFERENCE_DATE,
      includeHistorical = false
    } = retrievalQuery;

    let excludedUnverified = 0;
    let excludedTemporalMismatch = 0;

    // Resolve target date from query if not provided
    const resolvedDateInfo = explicitTargetDate
      ? { targetDate: explicitTargetDate, isHistorical: explicitTargetDate < referenceDate }
      : defaultTargetDateResolver.resolveTargetDate(query, referenceDate);

    const effectiveTargetDate = resolvedDateInfo.targetDate;
    const lowerQ = query.toLowerCase();
    const mentionsHistorical =
      resolvedDateInfo.isHistorical ||
      includeHistorical ||
      lowerQ.includes('historical') ||
      lowerQ.includes('prior to') ||
      lowerQ.includes('before') ||
      lowerQ.includes('old rate') ||
      lowerQ.includes('former') ||
      lowerQ.includes('previous') ||
      lowerQ.includes('superseded');

    // 1. Lexical Path: Rank top K_lex
    const lexicalTop = lexicalMatches.slice(0, RETRIEVAL_CONFIG.lexicalTopK);
    const lexicalRankMap = new Map<string, { rank: number; score: number }>();
    lexicalTop.forEach((item, index) => {
      lexicalRankMap.set(item.chunk.id, { rank: index + 1, score: item.score });
    });

    // 2. Dense Vector Path: Query embedding and search top K_dense
    const queryVector = this.embeddingService.embed(query);
    const vectorResults = this.vectorIndex.search(queryVector, RETRIEVAL_CONFIG.denseTopK);
    const relevantVectorResults = vectorResults.filter(
      (v) => v.score >= RETRIEVAL_CONFIG.minSemanticSimilarity || lexicalRankMap.has(v.chunk.id)
    );
    const vectorRankMap = new Map<string, { rank: number; score: number }>();
    relevantVectorResults.forEach((item, index) => {
      vectorRankMap.set(item.chunk.id, { rank: index + 1, score: item.score });
    });

    // 3. Candidate Union
    const candidateMap = new Map<string, { chunk: VerifiedChunk; parentRecord: AuthoritativeSourceRecord }>();

    for (const item of lexicalTop) {
      candidateMap.set(item.chunk.id, { chunk: item.chunk, parentRecord: item.parentRecord });
    }

    for (const item of relevantVectorResults) {
      if (!candidateMap.has(item.chunk.id)) {
        const parent = recordLookup(item.chunk.parentRecordId);
        if (parent) {
          candidateMap.set(item.chunk.id, { chunk: item.chunk, parentRecord: parent });
        }
      }
    }

    // 4. Eligibility Gate & Hard Temporal Filtering
    const eligibleCandidates: HybridSearchResult[] = [];
    const rrfK = RETRIEVAL_CONFIG.rrfK;
    const maxRrf = 2 / (rrfK + 1); // Exact theoretical maximum RRF score

    for (const [chunkId, { chunk, parentRecord }] of candidateMap.entries()) {
      // Phase 4 Gate: Strictly exclude STAGED, CANDIDATE, and REJECTED sources
      const lifecycle = parentRecord.lifecycleState;
      if (
        (parentRecord.sourceStatus as string) === 'REJECTED' ||
        lifecycle === 'CANDIDATE' ||
        lifecycle === 'STAGED' ||
        lifecycle === 'REJECTED'
      ) {
        excludedUnverified++;
        continue;
      }

      // Authority & Domain Alignment Gate:
      // If query specifies target authorities (e.g. accounting standards ASC/IASB),
      // strictly exclude unrelated statutory authorities (e.g. tax IRAS or employment MOM).
      if (authorities && authorities.length > 0) {
        if (!authorities.includes(parentRecord.authority)) {
          continue;
        }
      } else if (domain && domain !== 'GENERAL') {
        if (parentRecord.domain !== domain) {
          continue;
        }
      }

      // Hard Temporal Eligibility Gate
      const isEligible = this.isTemporallyEligible(chunk, effectiveTargetDate, referenceDate, mentionsHistorical);
      if (!isEligible) {
        excludedTemporalMismatch++;
        continue;
      }

      const lex = lexicalRankMap.get(chunkId);
      const vec = vectorRankMap.get(chunkId);

      // Compute Exact RRF
      let rrfScore = 0;
      if (lex) {
        rrfScore += 1 / (rrfK + lex.rank);
      }
      if (vec) {
        rrfScore += 1 / (rrfK + vec.rank);
      }

      const normalizedRrfScore = Math.min(1.0, rrfScore / maxRrf);

      eligibleCandidates.push({
        chunk,
        parentRecord,
        lexicalRank: lex?.rank,
        lexicalScore: lex?.score,
        vectorRank: vec?.rank,
        vectorScore: vec?.score,
        rrfScore,
        normalizedRrfScore
      });
    }

    // Sort by RRF score descending
    eligibleCandidates.sort((a, b) => b.rrfScore - a.rrfScore);

    const candidatePool = eligibleCandidates.slice(0, RETRIEVAL_CONFIG.candidatePoolSize);

    return {
      candidates: candidatePool,
      excludedUnverified,
      excludedTemporalMismatch
    };
  }
}
