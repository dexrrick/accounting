/**
 * Request Telemetry & Profiling Service
 * Measures latency, token consumption, model thinking, and fallback execution
 * across all query types in the Singapore Accounting AI Assistant.
 */

export interface RequestTelemetry {
  query: string;
  query_mode: string;
  modelName?: string;
  total_ms: number;
  time_to_first_visible_ms?: number;
  classification_ms: number;
  retrieval_ms: number;
  grounding_ms: number;
  gemini_call_count: number;
  gemini_request_ms: number;
  gemini_input_tokens: number;
  gemini_output_tokens: number;
  thinking_tokens?: number;
  retry_count: number;
  timeout_count: number;
  fallback_used: boolean;
  post_processing_ms: number;
  verification_ms?: number;
  assembly_ms?: number;
  timestamp: string;
}

export class RequestProfiler {
  private query: string;
  private modelName?: string;
  private startTime: number;
  private timeToFirstVisibleMs = 0;
  private classificationMs = 0;
  private retrievalMs = 0;
  private groundingMs = 0;
  private geminiCallCount = 0;
  private geminiRequestMs = 0;
  private geminiInputTokens = 0;
  private geminiOutputTokens = 0;
  private thinkingTokens = 0;
  private retryCount = 0;
  private timeoutCount = 0;
  private fallbackUsed = false;
  private postProcessingMs = 0;
  private verificationMs = 0;
  private assemblyMs = 0;
  private queryMode = 'UNKNOWN';

  constructor(query: string, modelName?: string) {
    this.query = query;
    this.modelName = modelName;
    this.startTime = performance.now();
  }

  public recordFirstVisibleResponse(): void {
    if (this.timeToFirstVisibleMs === 0) {
      this.timeToFirstVisibleMs = Math.round((performance.now() - this.startTime) * 100) / 100;
    }
  }

  public setQueryMode(mode: string): void {
    this.queryMode = mode;
  }

  public recordClassification(ms: number): void {
    this.classificationMs = ms;
  }

  public recordRetrieval(ms: number): void {
    this.retrievalMs = ms;
  }

  public recordGrounding(ms: number): void {
    this.groundingMs = ms;
  }

  public recordStage(stage: string, ms: number): void {
    if (stage === 'classification') this.classificationMs = ms;
    else if (stage === 'retrieval') this.retrievalMs = ms;
    else if (stage === 'grounding') this.groundingMs = ms;
    else if (stage === 'gemini_request') {
      this.geminiCallCount++;
      this.geminiRequestMs = ms;
    } else if (stage === 'verification') {
      this.verificationMs = ms;
      this.postProcessingMs += ms;
    } else if (stage === 'assembly') {
      this.assemblyMs = ms;
      this.postProcessingMs += ms;
    } else if (stage === 'post_processing') {
      this.postProcessingMs += ms;
    }
  }

  public setTokenCounts(input: number, output: number, thinking?: number): void {
    this.geminiInputTokens = input;
    this.geminiOutputTokens = output;
    if (thinking !== undefined) this.thinkingTokens = thinking;
  }

  public recordGeminiCall(metrics: {
    durationMs: number;
    inputTokens?: number;
    outputTokens?: number;
    thinkingTokens?: number;
  }): void {
    this.geminiCallCount++;
    this.geminiRequestMs += metrics.durationMs;
    if (metrics.inputTokens) this.geminiInputTokens += metrics.inputTokens;
    if (metrics.outputTokens) this.geminiOutputTokens += metrics.outputTokens;
    if (metrics.thinkingTokens) this.thinkingTokens += metrics.thinkingTokens;
  }

  public recordRetry(): void {
    this.retryCount++;
  }

  public recordTimeout(): void {
    this.timeoutCount++;
    this.fallbackUsed = true;
  }

  public recordFallback(): void {
    this.fallbackUsed = true;
  }

  public recordPostProcessing(ms: number): void {
    this.postProcessingMs = ms;
  }

  public finalize(): RequestTelemetry {
    const wallClock = Math.round((performance.now() - this.startTime) * 100) / 100;
    const stageSum = Math.round((this.classificationMs + this.retrievalMs + this.groundingMs + this.geminiRequestMs + this.postProcessingMs) * 100) / 100;
    const totalMs = Math.max(wallClock, stageSum);
    const telemetry: RequestTelemetry = {
      query: this.query,
      query_mode: this.queryMode,
      modelName: this.modelName,
      total_ms: totalMs,
      time_to_first_visible_ms: this.timeToFirstVisibleMs || totalMs,
      classification_ms: Math.round(this.classificationMs * 100) / 100,
      retrieval_ms: Math.round(this.retrievalMs * 100) / 100,
      grounding_ms: Math.round(this.groundingMs * 100) / 100,
      gemini_call_count: this.geminiCallCount,
      gemini_request_ms: Math.round(this.geminiRequestMs * 100) / 100,
      gemini_input_tokens: this.geminiInputTokens,
      gemini_output_tokens: this.geminiOutputTokens,
      thinking_tokens: this.thinkingTokens,
      retry_count: this.retryCount,
      timeout_count: this.timeoutCount,
      fallback_used: this.fallbackUsed,
      post_processing_ms: Math.round(this.postProcessingMs * 100) / 100,
      verification_ms: Math.round(this.verificationMs * 100) / 100,
      assembly_ms: Math.round(this.assemblyMs * 100) / 100,
      timestamp: new Date().toISOString()
    };

    if (typeof window !== 'undefined') {
      const w = window as any;
      w.__LAST_REQUEST_TELEMETRY__ = telemetry;
      w.__REQUEST_TELEMETRY_LOG__ = w.__REQUEST_TELEMETRY_LOG__ || [];
      w.__REQUEST_TELEMETRY_LOG__.push(telemetry);
    }

    return telemetry;
  }

  public generateReport(): RequestTelemetry {
    return this.finalize();
  }

  public static calculatePercentiles(values: number[]): { min: number; max: number; p50: number; p95: number } {
    if (values.length === 0) return { min: 0, max: 0, p50: 0, p95: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const p50Index = Math.floor(sorted.length * 0.5);
    const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return {
      min: Math.round(min * 100) / 100,
      max: Math.round(max * 100) / 100,
      p50: Math.round(sorted[p50Index] * 100) / 100,
      p95: Math.round(sorted[p95Index] * 100) / 100
    };
  }

  public logSummary(): void {
    const r = this.finalize();
    const flags = [];
    if (r.timeout_count > 0) flags.push(`timeouts=${r.timeout_count}`);
    if (r.fallback_used) flags.push(`fallback=true`);
    if (r.retry_count > 0) flags.push(`retries=${r.retry_count}`);
    const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
    console.log(
      `[Telemetry] ${r.query_mode} (${this.modelName || 'offline'})${flagStr}: total=${r.total_ms}ms (first_vis=${r.time_to_first_visible_ms}ms, gemini=${r.gemini_request_ms}ms, ground=${r.grounding_ms}ms, post=${r.post_processing_ms}ms) | tokens: in=${r.gemini_input_tokens}, out=${r.gemini_output_tokens}, think=${r.thinking_tokens || 0}`
    );
  }
}
