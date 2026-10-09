import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { diagnoseGeminiCaseFailure } from '../../scripts/gemini_failure_diagnostics.mjs';

const root = new URL('../../artifacts/iras-v4-acceptance-repaired-2026-10-06/', import.meta.url);
const summary = JSON.parse(await readFile(new URL('remaining-six-diagnostic-2026-10-09/results/summary.json', root), 'utf8'));
const diagnostics = summary.rows.map(row => ({ caseId: row.caseId, ...diagnoseGeminiCaseFailure(row) }));
assert.equal(diagnostics.filter(row => row.providerOutcome === 'TIMEOUT').length, 4);
assert.equal(diagnostics.filter(row => row.providerOutcome === 'HTTP_ERROR' && row.providerStatus === 503).length, 1);
assert.equal(diagnostics.filter(row => row.assessmentStatus === 'NOT_ASSESSED').length, 5);
assert.equal(diagnostics.filter(row => row.failureChain.some(failure => failure.stage === 'RETRIEVAL_INTEGRITY')).length, 4);
const wht = diagnostics.find(row => row.caseId === 'wht-royalty-general-rule');
assert.deepEqual(wht.failureChain.map(item => item.stage), ['PROVIDER', 'RETRIEVAL_INTEGRITY']);
assert.equal(diagnostics.at(-1).assessmentStatus, 'PASSED');

const stages = Object.fromEntries(['SEMANTIC_VALIDATION', 'SEMANTIC_ISSUE_IDENTITY', 'SEMANTIC_DIMENSIONS',
  'TOPIC_OWNERSHIP', 'REQUESTED_CONCEPT_OWNERSHIP'].map(stage => [stage, true]));
assert.equal(diagnoseGeminiCaseFailure({ semanticUnderstanding: { mode: 'SEMANTIC_INTERPRETATION', response: { parsed: true } }, stageVerdicts: stages }).assessmentStatus, 'PASSED');
const recovered = diagnoseGeminiCaseFailure({ semanticUnderstanding: {
  mode: 'SEMANTIC_INTERPRETATION', assessmentStatus: 'PASSED', response: { parsed: true, valid: true },
  transportAttempts: [
    { attempt: 1, status: 503, failureCategory: 'HTTP_STATUS', elapsedMs: 125, retryScheduled: true },
    { attempt: 2, status: 200, elapsedMs: 250, retryScheduled: false }
  ]
}, stageVerdicts: stages });
assert.equal(recovered.providerOutcome, 'RESPONSE_RECEIVED');
assert.equal(recovered.assessmentStatus, 'PASSED');
assert.deepEqual(recovered.failureChain, [], 'A recovered transient failure is not a terminal failure.');
assert.deepEqual(recovered.providerAttempts.map(attempt => attempt.httpStatus), [503, 200],
  'The complete retry chronology remains available alongside the successful outcome.');
const invalid = diagnoseGeminiCaseFailure({ semanticUnderstanding: { mode: 'DETERMINISTIC_FALLBACK', failure: 'INVALID_RESPONSE', failureReason: 'MALFORMED_JSON' } });
assert.equal(invalid.assessmentStatus, 'FAILED');
assert.equal(invalid.failureChain.at(-1).stage, 'INTERPRETATION');
const redacted = diagnoseGeminiCaseFailure({ failureCode: 'secret provider response text', semanticUnderstanding: {
  failure: 'PROVIDER_ERROR', transportError: 'private user prompt', transportAttempts: [{ attempt: 1, failureCategory: 'SECRET body', elapsedMs: 12, retryScheduled: false, raw: 'credential' }] } });
assert.doesNotMatch(JSON.stringify(redacted), /private user|SECRET|credential|secret provider/);
console.log('PASS | Gemini availability and interpretation assessment retain the original and downstream failure chain');
