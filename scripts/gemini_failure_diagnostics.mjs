// Separate transport availability, interpretation quality and retrieval failures.
// The canonical acceptance stages remain unchanged; this is diagnostic attribution.
const SEMANTIC_STAGES = ['SEMANTIC_VALIDATION', 'SEMANTIC_ISSUE_IDENTITY', 'SEMANTIC_DIMENSIONS',
  'TOPIC_OWNERSHIP', 'REQUESTED_CONCEPT_OWNERSHIP'];
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;

function safeCode(value) {
  return typeof value === 'string' && SAFE_CODE.test(value) ? value : undefined;
}

/** Accept both retained case rows and current production adapter results. */
export function diagnoseGeminiCaseFailure(row) {
  const result = row?.adapterResult || row?.actualResult || row || {};
  const understanding = result.semanticUnderstanding || {};
  const response = understanding.response;
  const partial = row?.partialProviderResponse || row?.providerResponsePartial;
  const stages = result.stageVerdicts || row?.adapterStageVerdicts || row?.stageVerdicts || {};
  const transportError = safeCode(understanding.transportError) || safeCode(partial?.failureCode);
  const providerStatus = Number.isInteger(understanding.providerStatus) ? understanding.providerStatus
    : Number.isInteger(partial?.status) ? partial.status
      : transportError?.match(/^V4_PROVIDER_HTTP_(\d{3})$/) ? Number(transportError.slice(-3)) : undefined;
  const hasResponse = Boolean(response?.parsed || response?.responseBytes > 0 ||
    result.interpretation || row?.semanticResponseBytes > 0 || ['INVALID_RESPONSE', 'LOW_CONFIDENCE'].includes(understanding.failure));
  const transportFailure = ['TIMEOUT', 'PROVIDER_ERROR', 'RATE_LIMITED', 'NO_PROVIDER', 'QUERY_TOO_LONG'].includes(understanding.failure);
  const assessmentStatus = !hasResponse && transportFailure ? 'NOT_ASSESSED'
    : understanding.assessmentStatus === 'NOT_ASSESSED' ? 'NOT_ASSESSED'
      : SEMANTIC_STAGES.every(stage => stages[stage] === true) ? 'PASSED'
        : hasResponse || ['INVALID_RESPONSE', 'LOW_CONFIDENCE'].includes(understanding.failure) ? 'FAILED' : 'NOT_ASSESSED';
  const providerOutcome = hasResponse ? 'RESPONSE_RECEIVED'
    : understanding.failure === 'TIMEOUT' || transportError === 'V4_PROVIDER_TIMEOUT' ? 'TIMEOUT'
      : providerStatus ? 'HTTP_ERROR'
        : understanding.failure === 'NO_PROVIDER' || understanding.failure === 'QUERY_TOO_LONG' ? 'NOT_ATTEMPTED' : 'UNAVAILABLE';
  const chain = [];
  if (providerOutcome !== 'RESPONSE_RECEIVED') chain.push({ stage: 'PROVIDER', outcome: providerOutcome,
    ...(providerStatus ? { httpStatus: providerStatus } : {}), ...(transportError ? { code: transportError } : {}) });
  if (assessmentStatus === 'FAILED') chain.push({ stage: 'INTERPRETATION', outcome: 'FAILED',
    ...(safeCode(understanding.failureReason) ? { code: understanding.failureReason } : {}) });
  const downstreamCode = safeCode(row?.failureCode) || safeCode(row?.failure?.code) ||
    safeCode(row?.operationalIntegrity?.failureCode);
  if (downstreamCode && downstreamCode !== transportError && !/^V4_PROVIDER_/.test(downstreamCode)) {
    chain.push({ stage: /INVENTORY|REPLAY|INTEGRITY|NETWORK_BLOCKED/.test(downstreamCode) ? 'RETRIEVAL_INTEGRITY' : 'PIPELINE', code: downstreamCode });
  }
  const providerAttempts = (understanding.transportAttempts || []).slice(0, 2).map(attempt => ({
    attempt: Number.isInteger(attempt.attempt) ? attempt.attempt : undefined,
    ...(Number.isInteger(attempt.status) ? { httpStatus: attempt.status } : {}),
    ...(safeCode(attempt.failureCategory) ? { failureCategory: attempt.failureCategory } : {}),
    elapsedMs: Number.isFinite(attempt.elapsedMs) ? Math.max(0, attempt.elapsedMs) : undefined,
    retryScheduled: attempt.retryScheduled === true
  }));
  return { providerOutcome, ...(providerStatus ? { providerStatus } : {}), assessmentStatus,
    fallbackUsed: understanding.mode === 'DETERMINISTIC_FALLBACK', failureChain: chain, providerAttempts };
}
