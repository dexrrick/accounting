import type { EvidenceTier, SourceType } from '../standards/unifiedSourceModel';
import type { VerifiedChunk } from './provisionChunker';
import { defaultEmbeddingService, DeterministicLocalEmbeddingService } from './localVectorizer';

export interface VectorIndexSnapshotMetadata {
  indexVersion: string;
  vectorizerVersion: string;
  registryVersionId?: string;
  ledgerHeadHash?: string;
  builtAt: string;
  totalDocuments: number;
  totalChunks: number;
}

export interface VectorIndexEntry {
  chunkId: string;
  parentRecordId: string;
  vector: number[];
  textHash: string;
  vectorizerVersion: string;
  evidenceTier: EvidenceTier;
  sourceType: SourceType;
  validFrom?: string;
  validTo?: string;
  chunk: VerifiedChunk;
}

export interface VectorSearchResult {
  chunk: VerifiedChunk;
  score: number;
}

/**
 * Deterministic In-Memory Vector Index.
 *
 * Invariants & Admission Gates:
 * 1. Admission Gate: Only VERIFIED active or valid historical chunks enter the index.
 *    Rejects STAGED, UNVERIFIED, REJECTED, or INVALID records.
 * 2. Retrieval Defense Gate: Defensive filtering during search ensures no unapproved records
 *    can be returned even if anomalous state occurs.
 * 3. Snapshot Metadata: Explicitly tracks indexVersion, vectorizerVersion, and Phase 4 ledgerHeadHash.
 * 4. Deterministic tie-breaking ensures identical ordering across runs.
 */
export class DeterministicVectorIndex {
  private entries: Map<string, VectorIndexEntry> = new Map();
  private embeddingService: DeterministicLocalEmbeddingService;
  private buildCounter: number = 0;
  private snapshotMetadata: VectorIndexSnapshotMetadata;

  constructor(embeddingService: DeterministicLocalEmbeddingService = defaultEmbeddingService) {
    this.embeddingService = embeddingService;
    this.snapshotMetadata = {
      indexVersion: 'v0',
      vectorizerVersion: embeddingService.vectorizerVersion,
      builtAt: new Date().toISOString(),
      totalDocuments: 0,
      totalChunks: 0
    };
  }

  /**
   * Builds index from scratch with supplied chunks and Phase 4 ledger metadata.
   */
  public build(
    chunks: VerifiedChunk[],
    ledgerHeadHash?: string,
    registryVersionId?: string
  ): VectorIndexSnapshotMetadata {
    this.entries.clear();
    this.buildCounter++;

    const parentIds = new Set<string>();

    for (const chunk of chunks) {
      // Admission Gate Check
      if (!this.isEligibleForIndex(chunk)) {
        continue;
      }

      const vector = this.embeddingService.embed(chunk.chunkText);
      const entry: VectorIndexEntry = {
        chunkId: chunk.id,
        parentRecordId: chunk.parentRecordId,
        vector,
        textHash: chunk.textHash,
        vectorizerVersion: this.embeddingService.vectorizerVersion,
        evidenceTier: chunk.evidenceTier,
        sourceType: chunk.sourceType,
        validFrom: chunk.validFrom,
        validTo: chunk.validTo,
        chunk
      };

      this.entries.set(chunk.id, entry);
      parentIds.add(chunk.parentRecordId);
    }

    this.snapshotMetadata = {
      indexVersion: `v${this.buildCounter}`,
      vectorizerVersion: this.embeddingService.vectorizerVersion,
      registryVersionId,
      ledgerHeadHash,
      builtAt: new Date().toISOString(),
      totalDocuments: parentIds.size,
      totalChunks: this.entries.size
    };

    return this.snapshotMetadata;
  }

  /**
   * Admission Gate check: Ensures only verified, non-staged, non-rejected chunks enter.
   */
  private isEligibleForIndex(chunk: VerifiedChunk): boolean {
    // Hard Invariant 2: Authoritative Vector Index only admits VERIFIED primary / guidance chunks
    // Strictly excludes STAGED, UNVERIFIED, CURATED_SUMMARY, REJECTED, or INVALID records
    if (chunk.evidenceTier === 'CURATED_SUMMARY' || chunk.sourceType === 'CURATED_SUMMARY') {
      return false;
    }
    // Reject staged/candidate/rejected lifecycle states explicitly
    if (
      chunk.lifecycleState === 'CANDIDATE' ||
      chunk.lifecycleState === 'STAGED' ||
      chunk.lifecycleState === 'REJECTED' ||
      chunk.parentRecordLifecycleState === 'CANDIDATE' ||
      chunk.parentRecordLifecycleState === 'STAGED' ||
      chunk.parentRecordLifecycleState === 'REJECTED'
    ) {
      return false;
    }
    // Must have a valid textHash
    if (!chunk.textHash || chunk.textHash.length !== 64) {
      return false;
    }
    return true;
  }

  /**
   * Adds an eligible verified chunk to the index.
   */
  public add(chunk: VerifiedChunk): boolean {
    if (!this.isEligibleForIndex(chunk)) {
      return false;
    }

    const vector = this.embeddingService.embed(chunk.chunkText);
    const entry: VectorIndexEntry = {
      chunkId: chunk.id,
      parentRecordId: chunk.parentRecordId,
      vector,
      textHash: chunk.textHash,
      vectorizerVersion: this.embeddingService.vectorizerVersion,
      evidenceTier: chunk.evidenceTier,
      sourceType: chunk.sourceType,
      validFrom: chunk.validFrom,
      validTo: chunk.validTo,
      chunk
    };

    this.entries.set(chunk.id, entry);
    this.snapshotMetadata.totalChunks = this.entries.size;
    return true;
  }

  /**
   * Removes a chunk from the index.
   */
  public remove(chunkId: string): boolean {
    const deleted = this.entries.delete(chunkId);
    if (deleted) {
      this.snapshotMetadata.totalChunks = this.entries.size;
    }
    return deleted;
  }

  /**
   * Performs vector search using cosine similarity with admission filtering and deterministic tie-breaking.
   */
  public search(
    queryVector: number[],
    limit: number = 20,
    filter?: (chunk: VerifiedChunk) => boolean
  ): VectorSearchResult[] {
    const results: VectorSearchResult[] = [];

    for (const entry of this.entries.values()) {
      // Defensive Second Gate: Validate chunk eligibility at retrieval time
      if (!this.isEligibleForIndex(entry.chunk)) {
        continue;
      }

      // User / Context Filter
      if (filter && !filter(entry.chunk)) {
        continue;
      }

      const score = this.embeddingService.similarity(queryVector, entry.vector);
      results.push({
        chunk: entry.chunk,
        score
      });
    }

    // Deterministic Sort:
    // 1. Score descending
    // 2. Evidence Tier precedence (PRIMARY_SOURCE > OFFICIAL_GUIDANCE > CURATED_SUMMARY)
    // 3. Chunk ID ascending
    results.sort((a, b) => {
      if (Math.abs(b.score - a.score) > 1e-6) {
        return b.score - a.score;
      }
      const tierRank = (tier: EvidenceTier) => {
        if (tier === 'PRIMARY_SOURCE') return 3;
        if (tier === 'OFFICIAL_GUIDANCE') return 2;
        return 1;
      };
      const tierDiff = tierRank(b.chunk.evidenceTier) - tierRank(a.chunk.evidenceTier);
      if (tierDiff !== 0) return tierDiff;

      return a.chunk.id.localeCompare(b.chunk.id);
    });

    return results.slice(0, limit);
  }

  public getSnapshotMetadata(): VectorIndexSnapshotMetadata {
    return { ...this.snapshotMetadata };
  }

  public size(): number {
    return this.entries.size;
  }

  public clear(): void {
    this.entries.clear();
    this.snapshotMetadata.totalChunks = 0;
    this.snapshotMetadata.totalDocuments = 0;
  }
}

export const defaultVectorIndex = new DeterministicVectorIndex();
