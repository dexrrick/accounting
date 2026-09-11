import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import {
  type ISourceRetriever,
  type SourceRetrievalQuery
} from './sourceRetriever';
import { CompositeSourceRetriever, defaultCompositeSourceRetriever } from './compositeSourceRetriever';
import { ProvisionChunker, defaultProvisionChunker, type VerifiedChunk } from './provisionChunker';
import { DeterministicLocalEmbeddingService, defaultEmbeddingService } from './localVectorizer';
import { DeterministicVectorIndex, defaultVectorIndex, type VectorIndexSnapshotMetadata } from './vectorIndex';
import { HybridRetriever, type HybridSearchResult } from './hybridRetriever';
import { DeterministicReranker, defaultDeterministicReranker } from './deterministicReranker';
import { QueryTopicResolver, defaultQueryTopicResolver } from './queryTopicResolver';
import { RetrievalTelemetryRecorder, type RetrievalTelemetry } from './retrievalTelemetry';
import { defaultSourceVersioningManager, SourceVersioningManager } from '../standards/sourceVersioning';

/**
 * Advanced Hybrid Source Retriever.
 *
 * Architecture:
 * 1. Coordinates CompositeSourceRetriever, ProvisionChunker, DeterministicVectorIndex,
 *    HybridRetriever, DeterministicReranker, and QueryTopicResolver.
 * 2. Admission & Hard Eligibility Gates: Only Phase 4 approved records/chunks enter index.
 * 3. Exact 55/45 + RRF Deterministic Reranking.
 * 4. Phase 4 Lifecycle Hook: refreshFromRegistry() keeps vector index in sync with
 *    immutable version ledger. Staged candidate packages remain strictly isolated.
 */
export class AdvancedSourceRetriever implements ISourceRetriever {
  private compositeRetriever: CompositeSourceRetriever;
  private chunker: ProvisionChunker;
  private embeddingService: DeterministicLocalEmbeddingService;
  private vectorIndex: DeterministicVectorIndex;
  private hybridRetriever: HybridRetriever;
  private reranker: DeterministicReranker;
  private topicResolver: QueryTopicResolver;
  private versioningManager: SourceVersioningManager;

  private allChunks: VerifiedChunk[] = [];
  private chunksByRecordId: Map<string, VerifiedChunk[]> = new Map();
  private lastTelemetry?: RetrievalTelemetry;

  constructor(
    compositeRetriever: CompositeSourceRetriever = defaultCompositeSourceRetriever,
    chunker: ProvisionChunker = defaultProvisionChunker,
    embeddingService: DeterministicLocalEmbeddingService = defaultEmbeddingService,
    vectorIndex: DeterministicVectorIndex = defaultVectorIndex,
    reranker: DeterministicReranker = defaultDeterministicReranker,
    topicResolver: QueryTopicResolver = defaultQueryTopicResolver,
    versioningManager: SourceVersioningManager = defaultSourceVersioningManager
  ) {
    this.compositeRetriever = compositeRetriever;
    this.chunker = chunker;
    this.embeddingService = embeddingService;
    this.vectorIndex = vectorIndex;
    this.reranker = reranker;
    this.topicResolver = topicResolver;
    this.versioningManager = versioningManager;

    this.hybridRetriever = new HybridRetriever(this.vectorIndex, this.embeddingService);

    // Initial build of vector index from currently approved registry
    this.refreshFromRegistry();
  }

  /**
   * Refreshes vector index and chunks from approved registry records.
   * Isolates staged candidates: only VERIFIED and valid historical records enter.
   */
  public refreshFromRegistry(
    customLedgerHeadHash?: string,
    customRegistryVersionId?: string
  ): VectorIndexSnapshotMetadata {
    // 1. Get approved records from composite retriever's active ledger
    const activeRecords = this.compositeRetriever.findSourcesByStandardOrAct('');
    const ledgerHeadHash = customLedgerHeadHash || this.versioningManager.getLedgerHeadHash();
    const registryVersionId = customRegistryVersionId || 'active-ledger-v1';

    // 2. Chunk eligible records
    this.allChunks = [];
    this.chunksByRecordId.clear();

    for (const record of activeRecords) {
      if (record.sourceStatus === 'VERIFIED' || record.sourceStatus === 'HISTORICAL') {
        const chunks = this.chunker.chunkRecord(record);
        this.allChunks.push(...chunks);
        this.chunksByRecordId.set(record.id, chunks);
      }
    }

    // 3. Build Vector Index
    const snapshot = this.vectorIndex.build(this.allChunks, ledgerHeadHash, registryVersionId);
    return snapshot;
  }

  public getVectorIndex(): DeterministicVectorIndex {
    return this.vectorIndex;
  }

  public getEmbeddingService(): DeterministicLocalEmbeddingService {
    return this.embeddingService;
  }

  public getSnapshotMetadata(): VectorIndexSnapshotMetadata {
    return this.vectorIndex.getSnapshotMetadata();
  }

  public getLastTelemetry(): RetrievalTelemetry | undefined {
    return this.lastTelemetry;
  }

  public getSourceById(id: string): AuthoritativeSourceRecord | undefined {
    return this.compositeRetriever.getSourceById(id);
  }

  public findSourcesByStandardOrAct(
    standardOrActCode: string,
    paragraphOrSection?: string
  ): AuthoritativeSourceRecord[] {
    return this.compositeRetriever.findSourcesByStandardOrAct(standardOrActCode, paragraphOrSection);
  }

  /**
   * Executes advanced hybrid retrieval returning ranked chunks with exact scores and telemetry.
   */
  public async retrieveHybridChunks(
    retrievalQuery: SourceRetrievalQuery
  ): Promise<{ results: HybridSearchResult[]; lexicalRecords: AuthoritativeSourceRecord[]; telemetry: RetrievalTelemetry }> {
    const queryId = `q_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const snapshot = this.vectorIndex.getSnapshotMetadata();
    const recorder = new RetrievalTelemetryRecorder(
      queryId,
      snapshot.indexVersion,
      this.embeddingService.vectorizerVersion
    );

    recorder.startTimer('total');

    // 1. Lexical Path via Composite Retriever
    recorder.startTimer('lexical');
    const lexicalRecords = await this.compositeRetriever.retrieveSources(retrievalQuery);

    // Map retrieved records to their verified chunks with scoring
    const lexicalMatches: Array<{
      chunk: VerifiedChunk;
      parentRecord: AuthoritativeSourceRecord;
      score: number;
    }> = [];

    lexicalRecords.forEach((rec, recIdx) => {
      const chunks = this.chunksByRecordId.get(rec.id) || this.chunker.chunkRecord(rec);
      const baseRecScore = Math.max(10, 100 - (recIdx * 10));

      chunks.forEach((chunk, chunkIdx) => {
        // Higher chunk score if chunk contains specific keywords from query
        let chunkScore = baseRecScore;
        const qLower = retrievalQuery.query.toLowerCase();
        if (qLower.includes(chunk.chunkText.substring(0, 30).toLowerCase())) {
          chunkScore += 20;
        }
        lexicalMatches.push({
          chunk,
          parentRecord: rec,
          score: chunkScore - chunkIdx
        });
      });
    });
    recorder.stopTimer('lexical');

    // 2. Hybrid Retrieval & RRF Fusion
    recorder.startTimer('fusion');
    const hybridOutput = this.hybridRetriever.retrieveHybridCandidates(
      {
        query: retrievalQuery.query,
        domain: retrievalQuery.domain,
        authorities: retrievalQuery.authorities,
        targetDate: retrievalQuery.targetDate,
        referenceDate: retrievalQuery.referenceDate,
        includeHistorical: retrievalQuery.includeHistorical
      },
      lexicalMatches,
      (id) => this.compositeRetriever.getSourceById(id)
    );
    recorder.stopTimer('fusion');

    // 3. Deterministic Reranker with Topic Coverage
    recorder.startTimer('rerank');
    const topicDecomp = this.topicResolver.decomposeQuery(retrievalQuery.query, retrievalQuery.semanticContext);
    const reranked = this.reranker.rerank(hybridOutput.candidates, {
      query: retrievalQuery.query,
      targetDate: retrievalQuery.targetDate,
      referenceDate: retrievalQuery.referenceDate,
      topics: topicDecomp.topics,
      includeHistorical: retrievalQuery.includeHistorical,
      semanticContext: retrievalQuery.semanticContext
    });
    recorder.stopTimer('rerank');

    for (const item of reranked) {
      if (item.semanticScoreExplanation) {
        recorder.recordSemanticEvaluation(item.chunk.id, item.semanticScoreExplanation);
      }
    }

    recorder.stopTimer('total');

    recorder.recordCounters({
      lexicalCandidates: lexicalMatches.length,
      denseCandidates: this.vectorIndex.size(),
      fusedCandidates: hybridOutput.candidates.length,
      rerankedCandidates: reranked.length,
      excludedUnverified: hybridOutput.excludedUnverified,
      excludedTemporalMismatch: hybridOutput.excludedTemporalMismatch,
      vectorIndexSize: this.vectorIndex.size()
    });

    const telemetry = recorder.getTelemetry();
    this.lastTelemetry = telemetry;

    return {
      results: reranked,
      lexicalRecords,
      telemetry
    };
  }

  /**
   * ISourceRetriever interface implementation.
   * Maps advanced hybrid retrieval back to deduplicated, authoritative parent records.
   * Prioritizes verified hybrid results, then includes approved baseline curated summaries.
   */
  public async retrieveSources(retrievalQuery: SourceRetrievalQuery): Promise<AuthoritativeSourceRecord[]> {
    const { results, lexicalRecords } = await this.retrieveHybridChunks(retrievalQuery);

    const seenRecordIds = new Set<string>();
    const records: AuthoritativeSourceRecord[] = [];

    // 1. First priority: Reranked verified hybrid records
    for (const r of results) {
      if (!seenRecordIds.has(r.parentRecord.id)) {
        seenRecordIds.add(r.parentRecord.id);
        records.push(r.parentRecord);
      }
    }

    // 2. Second priority: Approved baseline curated summaries / guidance from lexical search
    // Strictly excluding any unapproved candidate/staged updates or rejected sources
    for (const rec of lexicalRecords) {
      if (!seenRecordIds.has(rec.id)) {
        if (!rec.id.includes('staged') && !rec.id.includes('candidate') && (rec.sourceStatus as string) !== 'REJECTED') {
          seenRecordIds.add(rec.id);
          records.push(rec);
        }
      }
    }

    return records.slice(0, retrievalQuery.maxResults || 6);
  }
}

export const defaultAdvancedSourceRetriever = new AdvancedSourceRetriever();
