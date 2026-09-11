export interface RetrievalTelemetry {
  queryId: string;
  snapshotVersion: string;
  vectorizerVersion: string;

  lexicalCandidates: number;
  denseCandidates: number;
  fusedCandidates: number;
  rerankedCandidates: number;

  excludedUnverified: number;
  excludedRejected: number;
  excludedTemporalMismatch: number;

  vectorIndexSize: number;

  // Semantic Alignment Telemetry
  semanticEvaluations?: number;
  semanticBoostsApplied?: number;
  semanticPenaltiesApplied?: number;
  semanticConflictsDetected?: number;
  semanticExtractionTier?: import('../services/transactionUnderstandingService').SemanticExtractionTier;
  isFallbackSemanticExtraction?: boolean;
  semanticBreakdown?: Array<{
    chunkId: string;
    baseDeltaSemantics?: number;
    provenanceMultiplier?: number;
    finalDeltaSemantics?: number;
    deltaSemantics: number;
    explanation: string;
    matchedAttributes: string[];
    conflictAttributes: string[];
    hasSemanticConflict?: boolean;
    provenanceTier?: string;
  }>;

  // Runtime measurements (non-deterministic observations):
  lexicalLatencyMs: number;
  vectorLatencyMs: number;
  fusionLatencyMs: number;
  rerankLatencyMs: number;
  totalLatencyMs: number;
}

/**
 * Observational Telemetry Recorder.
 * Records latency and candidate counters without affecting retrieval ranking.
 */
export class RetrievalTelemetryRecorder {
  private telemetry: RetrievalTelemetry;
  private startTimes: Map<string, number> = new Map();

  constructor(queryId: string, snapshotVersion: string, vectorizerVersion: string) {
    this.telemetry = {
      queryId,
      snapshotVersion,
      vectorizerVersion,
      lexicalCandidates: 0,
      denseCandidates: 0,
      fusedCandidates: 0,
      rerankedCandidates: 0,
      excludedUnverified: 0,
      excludedRejected: 0,
      excludedTemporalMismatch: 0,
      vectorIndexSize: 0,
      lexicalLatencyMs: 0,
      vectorLatencyMs: 0,
      fusionLatencyMs: 0,
      rerankLatencyMs: 0,
      totalLatencyMs: 0
    };
  }

  public startTimer(phase: string): void {
    this.startTimes.set(phase, performance.now());
  }

  public stopTimer(phase: string): number {
    const start = this.startTimes.get(phase);
    if (!start) return 0;
    const duration = Math.round((performance.now() - start) * 100) / 100;

    if (phase === 'lexical') this.telemetry.lexicalLatencyMs = duration;
    else if (phase === 'vector') this.telemetry.vectorLatencyMs = duration;
    else if (phase === 'fusion') this.telemetry.fusionLatencyMs = duration;
    else if (phase === 'rerank') this.telemetry.rerankLatencyMs = duration;
    else if (phase === 'total') this.telemetry.totalLatencyMs = duration;

    return duration;
  }

  public recordCounters(counters: Partial<RetrievalTelemetry>): void {
    Object.assign(this.telemetry, counters);
  }

  public recordSemanticContext(
    understanding?: import('../services/transactionUnderstandingService').TransactionUnderstanding
  ): void {
    if (understanding?.provenance) {
      this.telemetry.semanticExtractionTier = understanding.provenance.tier;
      this.telemetry.isFallbackSemanticExtraction = understanding.provenance.isFallback;
    }
  }

  public recordSemanticEvaluation(
    chunkId: string,
    score: {
      baseDeltaSemantics?: number;
      provenanceMultiplier?: number;
      finalDeltaSemantics?: number;
      deltaSemantics: number;
      explanation: string;
      matchedAttributes: string[];
      conflictAttributes: string[];
      hasSemanticConflict?: boolean;
      provenanceTier?: string;
    }
  ): void {
    if (!this.telemetry.semanticBreakdown) {
      this.telemetry.semanticBreakdown = [];
      this.telemetry.semanticEvaluations = 0;
      this.telemetry.semanticBoostsApplied = 0;
      this.telemetry.semanticPenaltiesApplied = 0;
      this.telemetry.semanticConflictsDetected = 0;
    }
    this.telemetry.semanticEvaluations = (this.telemetry.semanticEvaluations || 0) + 1;
    if (score.deltaSemantics > 0) {
      this.telemetry.semanticBoostsApplied = (this.telemetry.semanticBoostsApplied || 0) + 1;
    } else if (score.deltaSemantics < 0) {
      this.telemetry.semanticPenaltiesApplied = (this.telemetry.semanticPenaltiesApplied || 0) + 1;
    }
    if (score.hasSemanticConflict || (score.conflictAttributes && score.conflictAttributes.length > 0)) {
      this.telemetry.semanticConflictsDetected = (this.telemetry.semanticConflictsDetected || 0) + 1;
    }
    this.telemetry.semanticBreakdown.push({
      chunkId,
      baseDeltaSemantics: score.baseDeltaSemantics,
      provenanceMultiplier: score.provenanceMultiplier,
      finalDeltaSemantics: score.finalDeltaSemantics,
      deltaSemantics: score.deltaSemantics,
      explanation: score.explanation,
      matchedAttributes: score.matchedAttributes,
      conflictAttributes: score.conflictAttributes,
      hasSemanticConflict: Boolean(score.hasSemanticConflict || (score.conflictAttributes && score.conflictAttributes.length > 0)),
      provenanceTier: score.provenanceTier
    });
  }

  public getTelemetry(): RetrievalTelemetry {
    return { ...this.telemetry };
  }
}
