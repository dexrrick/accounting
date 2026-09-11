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

  public getTelemetry(): RetrievalTelemetry {
    return { ...this.telemetry };
  }
}
