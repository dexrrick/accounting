// One-shot diagnostic continuation for the six cases left after the consumed run.
// This writes only beneath this directory and never creates canonical acceptance-v4 output.
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import dgram from 'node:dgram';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { lstat, mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = 'D:/Accounting';
const GIT = 'C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe';
const BASE = 'artifacts/iras-v4-acceptance-repaired-2026-10-06';
const RUN = `${BASE}/remaining-six-diagnostic-2026-10-09`;
const PREPARATION = `${BASE}/post-repair-2026-10-08/preparation`;
const CAPTURE = `${BASE}/post-repair-2026-10-08/official-capture`;
const LAUNCHER_PATH = `${RUN}/launch.mjs`;
const AUTHORIZATION_PATH = `${RUN}/authorization.json`;
const REVIEW_PATH = `${RUN}/independent-review.json`;
const PREREGISTRATION_PATH = `${PREPARATION}/preregistration.json`;
const ACTIVATION_PATH = `${PREPARATION}/activation-configuration.json`;
const CAPTURE_PAYLOAD_PATH = `${CAPTURE}/capture-payload.json`;
const EVIDENCE_LOCK_PATH = `${CAPTURE}/evidence-lock.json`;
const RESULTS = `${RUN}/results`;
const GATE_REQUEST_PATH = `${RESULTS}/gate-request.json`;
const GATE_RESPONSE_PATH = `${RESULTS}/gate-response.json`;
const CONSUMED_PATH = `${RESULTS}/consumed.json`;
const PARTIAL_PATH = `${RESULTS}/remaining-six.partial.jsonl`;
const SUMMARY_PATH = `${RESULTS}/summary.json`;
const OLD_NAMESPACE = `${BASE}/semantic-run-v4-post-repair-2026-10-08`;
const OLD_JOURNAL_PATH = `${OLD_NAMESPACE}/runner-v4.partial.jsonl`;
const OLD_MARKER_PATH = `${OLD_NAMESPACE}/consumed-v4.json`;
const MODEL = 'gemini-3.5-flash-lite';
const HUMAN_INSTRUCTION = "let's continue with the remaining 6 and document how many of them fail instead of stopping";
const THREAD_ID = '01a11dc5-4e7c-72c0-834d-e46b4a3e7f57';
const DIAGNOSTIC_CASE_IDS = Object.freeze([
  'private-expense-treatment',
  'foreign-dividend-receipt-treatment',
  'corporate-residency-general-rule',
  'wht-royalty-general-rule',
  'gst-input-tax-general-rule',
  'unsupported-sfrsi-6-exploration-evaluation'
]);
const PINNED_INPUTS = Object.freeze({
  [PREREGISTRATION_PATH]: 'feafc2a67e0cf56da4f71d3d6424b1ef23b0b4344a4e27e39d403eec62451aeb',
  [ACTIVATION_PATH]: '9e0f55d7d4e72555f51cf9f280cf5e959b8cadd1245c2e08a8e515f772c1b1fc',
  [CAPTURE_PAYLOAD_PATH]: '77c07c267c0c94cb6f38ca92bfb6fa9c0fdd9e49fb64e9dcf40f1a3f242e7f19',
  [EVIDENCE_LOCK_PATH]: 'aa5c88eeb19c3ef891b09fa3c49f25e20620263f2121faf346403f6012fd445b',
  [OLD_JOURNAL_PATH]: '0a93f3ae8ae1385a8c3c26f24fc1037fc868b08ecd957d536b442b399eca2bc7',
  [OLD_MARKER_PATH]: '7dc26419455e23babe8f57b35ab33e9398514f0cea670b5cd27842d97bd88f0e'
});
const CAPTURE_PROFILE = 'iras-v4-runner-integrity';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const GATE_PROJECTION = Object.freeze({
  fiveHourCostPercentagePoints: 20,
  weeklyCostPercentagePoints: 10,
  reserveAfterProjectionMinimumFiveHourPercent: 8,
  reserveAfterProjectionMinimumWeeklyPercent: 4,
  checkpointAtRemainingPercent: 10,
  finishAboveRemainingPercent: 5,
  observationMaximumAgeMs: 300000
});
const NETWORK_BLOCKED_CODE = 'DIAGNOSTIC_AMBIENT_NETWORK_BLOCKED';
const dispatchContext = new AsyncLocalStorage();
const dispatchCapability = Object.freeze({});
let ambientGuardActive = false;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const absolute = relative => path.resolve(ROOT, relative);
const codedError = code => Object.assign(new Error(code), { code });
const emit = (phase, status, details = {}) => process.stdout.write(`${JSON.stringify({ phase, status, ...details })}\n`);
const isObject = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const stableJson = value => JSON.stringify(value);

function modeFrom(argv) {
  assert.ok(argv.length <= 1, 'INVALID_LAUNCH_ARGUMENTS');
  const mode = argv[0] || '--check';
  assert.ok(mode === '--check' || mode === '--run', 'INVALID_LAUNCH_ARGUMENTS');
  return mode;
}
function safeCode(error, fallback = 'DIAGNOSTIC_FAILURE') {
  const candidate = String(error?.code && error.code !== 'ERR_ASSERTION' ? error.code : error?.message || '')
    .split(/[\r\n]/, 1)[0].trim();
  return /^[A-Z][A-Z0-9_:-]{0,119}$/.test(candidate) ? candidate : fallback;
}
function assertSafeRelative(relative) {
  assert.equal(typeof relative, 'string', 'DIAGNOSTIC_PATH_INVALID');
  assert.ok(relative.length > 0 && !path.isAbsolute(relative), 'DIAGNOSTIC_PATH_INVALID');
  assert.ok(!relative.split(/[\\/]+/).includes('..'), 'DIAGNOSTIC_PATH_TRAVERSAL');
  const resolved = absolute(relative);
  const fromRoot = path.relative(path.resolve(ROOT), resolved);
  assert.ok(fromRoot && !fromRoot.startsWith('..') && !path.isAbsolute(fromRoot), 'DIAGNOSTIC_PATH_OUTSIDE_ROOT');
  return resolved;
}
async function assertNoSymlinkPath(relative, { allowMissing = false } = {}) {
  const resolved = assertSafeRelative(relative);
  const fromRoot = path.relative(path.resolve(ROOT), resolved);
  let cursor = path.resolve(ROOT);
  for (const part of fromRoot.split(path.sep)) {
    cursor = path.join(cursor, part);
    try {
      const info = await lstat(cursor);
      assert.equal(info.isSymbolicLink(), false, 'DIAGNOSTIC_SYMLINK_PATH_REJECTED');
    } catch (error) {
      if (allowMissing && error?.code === 'ENOENT') return false;
      throw error;
    }
  }
  return true;
}
async function readRaw(relative) {
  await assertNoSymlinkPath(relative);
  return await readFile(assertSafeRelative(relative));
}
async function readJson(relative) {
  const bytes = await readRaw(relative);
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); }
  catch { throw codedError('DIAGNOSTIC_JSON_INVALID'); }
  assert.ok(isObject(value), 'DIAGNOSTIC_JSON_INVALID');
  return { bytes, sha256: sha256(bytes), value };
}
async function assertAbsent(relative) {
  if (!await assertNoSymlinkPath(relative, { allowMissing: true })) return;
  try {
    await lstat(assertSafeRelative(relative));
    throw codedError('DIAGNOSTIC_OUTPUT_ALREADY_EXISTS');
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
}
export function assertRawSha256(raw, expected, code = 'DIAGNOSTIC_PINNED_HASH_MISMATCH') {
  assert.match(String(expected || ''), /^[a-f0-9]{64}$/, 'DIAGNOSTIC_PIN_INVALID');
  assert.equal(sha256(raw), expected, code);
  return true;
}
function assertAuthorization(value, context) {
  assert.equal(value.profile, 'iras-v4-remaining-six-diagnostic-authorization', 'DIAGNOSTIC_AUTHORIZATION_REQUIRED');
  assert.equal(value.status, 'AUTHORIZED_FOR_REMAINING_SIX_DIAGNOSTIC_CONTINUATION', 'DIAGNOSTIC_AUTHORIZATION_REQUIRED');
  assert.equal(value.authorizationSource, 'current Codex chat user message', 'DIAGNOSTIC_AUTHORIZATION_SOURCE_INVALID');
  assert.equal(value.userInstruction, HUMAN_INSTRUCTION, 'DIAGNOSTIC_AUTHORIZATION_INSTRUCTION_MISMATCH');
  assert.equal(value.threadId, THREAD_ID, 'DIAGNOSTIC_AUTHORIZATION_THREAD_MISMATCH');
  assert.equal(value.launcherSha256, context.launcherSha256, 'DIAGNOSTIC_AUTHORIZATION_LAUNCHER_MISMATCH');
  assert.equal(value.semanticProfile, 'DIAGNOSTIC_CONTINUATION', 'DIAGNOSTIC_AUTHORIZATION_PROFILE_MISMATCH');
  assert.equal(value.authorizedGeminiCalls, 6, 'DIAGNOSTIC_AUTHORIZATION_CALL_COUNT_MISMATCH');
  assert.equal(value.callsPerCase, 1, 'DIAGNOSTIC_AUTHORIZATION_CALL_POLICY_MISMATCH');
  assert.deepEqual(value.caseIds, DIAGNOSTIC_CASE_IDS, 'DIAGNOSTIC_AUTHORIZATION_CASE_SCOPE_MISMATCH');
  assert.equal(value.model, MODEL, 'DIAGNOSTIC_AUTHORIZATION_MODEL_MISMATCH');
  assert.equal(value.transportTimeoutMs, 8000, 'DIAGNOSTIC_AUTHORIZATION_TIMEOUT_MISMATCH');
  assert.equal(value.minimumStartGapMs, 15250, 'DIAGNOSTIC_AUTHORIZATION_START_GAP_MISMATCH');
  assert.equal(value.retries, 0, 'DIAGNOSTIC_AUTHORIZATION_RETRY_POLICY_MISMATCH');
  assert.equal(value.providerProbesAuthorized, 0, 'DIAGNOSTIC_AUTHORIZATION_PROBE_POLICY_MISMATCH');
  assert.equal(value.liveSourceRetrieval, false, 'DIAGNOSTIC_AUTHORIZATION_SOURCE_RETRIEVAL_MISMATCH');
  assert.equal(value.additionalSourceRequests, 0, 'DIAGNOSTIC_AUTHORIZATION_SOURCE_REQUEST_MISMATCH');
  assert.equal(value.unchangedCredentialScopeConfirmed, true, 'DIAGNOSTIC_CREDENTIAL_SCOPE_CONFIRMATION_REQUIRED');
  return true;
}
function assertIndependentReview(value, context) {
  assert.equal(value.profile, 'iras-v4-remaining-six-diagnostic-independent-review', 'DIAGNOSTIC_INDEPENDENT_REVIEW_REQUIRED');
  assert.equal(value.status, 'APPROVED_FOR_REMAINING_SIX_DIAGNOSTIC_CONTINUATION', 'DIAGNOSTIC_INDEPENDENT_REVIEW_REQUIRED');
  assert.deepEqual(value.bindings, {
    launcherSha256: context.launcherSha256,
    authorizationSha256: context.authorizationSha256
  }, 'DIAGNOSTIC_REVIEW_BINDING_MISMATCH');
  assert.equal(value.semanticProfile, 'DIAGNOSTIC_CONTINUATION', 'DIAGNOSTIC_REVIEW_PROFILE_MISMATCH');
  assert.deepEqual(value.caseIds, DIAGNOSTIC_CASE_IDS, 'DIAGNOSTIC_REVIEW_CASE_SCOPE_MISMATCH');
  assert.equal(value.model, MODEL, 'DIAGNOSTIC_REVIEW_MODEL_MISMATCH');
  assert.equal(value.authorizedGeminiCalls, 6, 'DIAGNOSTIC_REVIEW_CALL_COUNT_MISMATCH');
  assert.equal(value.retries, 0, 'DIAGNOSTIC_REVIEW_RETRY_POLICY_MISMATCH');
  assert.equal(value.providerProbesAuthorized, 0, 'DIAGNOSTIC_REVIEW_PROBE_POLICY_MISMATCH');
  assert.equal(value.liveSourceRetrieval, false, 'DIAGNOSTIC_REVIEW_SOURCE_RETRIEVAL_MISMATCH');
  return true;
}function decodeUsageToolResult(toolResult) {
  assert.ok(isObject(toolResult) && toolResult.isError !== true, 'DIAGNOSTIC_USAGE_LIMITS_UNAVAILABLE');
  let value = toolResult.structuredContent;
  if (!isObject(value) && Array.isArray(toolResult.content)) {
    const textRows = toolResult.content.filter(row => row?.type === 'text');
    if (textRows.length === 1) {
      try { value = JSON.parse(textRows[0].text); } catch { /* rejected below */ }
    }
  }
  assert.ok(isObject(value), 'DIAGNOSTIC_USAGE_LIMITS_UNREADABLE');
  assert.equal(value.ordinaryUsageAllowed, true, 'DIAGNOSTIC_USAGE_LIMITS_UNAVAILABLE');
  const primary = value.rateLimitsByLimitId?.codex?.primary;
  const secondary = value.rateLimitsByLimitId?.codex?.secondary;
  assert.equal(primary?.windowDurationMins, 300, 'DIAGNOSTIC_FIVE_HOUR_WINDOW_INVALID');
  assert.equal(secondary?.windowDurationMins, 10080, 'DIAGNOSTIC_WEEKLY_WINDOW_INVALID');
  assert.ok([primary.usedPercent, secondary.usedPercent].every(number => Number.isFinite(number) && number >= 0 && number <= 100),
    'DIAGNOSTIC_USAGE_LIMITS_UNREADABLE');
  return { primary, secondary };
}
export function validateFreshUsageGate(response, request, bindings, now = Date.now()) {
  assert.equal(response.profile, 'iras-v4-remaining-six-diagnostic-gate-response', 'DIAGNOSTIC_GATE_RESPONSE_INVALID');
  assert.equal(response.requestSha256, bindings.requestSha256, 'DIAGNOSTIC_GATE_REQUEST_HASH_MISMATCH');
  assert.equal(response.requestId, request.requestId, 'DIAGNOSTIC_GATE_REQUEST_ID_MISMATCH');
  assert.equal(response.launcherSha256, bindings.launcherSha256, 'DIAGNOSTIC_GATE_LAUNCHER_MISMATCH');
  assert.equal(response.authorizationSha256, bindings.authorizationSha256, 'DIAGNOSTIC_GATE_AUTHORIZATION_MISMATCH');
  assert.equal(response.independentReviewSha256, bindings.reviewSha256, 'DIAGNOSTIC_GATE_REVIEW_MISMATCH');
  assert.equal(response.credentialSha256, bindings.credentialSha256, 'DIAGNOSTIC_GATE_CREDENTIAL_MISMATCH');
  const requestedAt = Date.parse(request.requestedAtUtc || '');
  const suppliedAt = Date.parse(response.suppliedAtUtc || '');
  assert.ok(Number.isFinite(requestedAt) && Number.isFinite(suppliedAt) && suppliedAt >= requestedAt && suppliedAt <= now,
    'DIAGNOSTIC_GATE_TIMESTAMP_INVALID');
  const observation = response.usageObservation;
  assert.ok(isObject(observation), 'DIAGNOSTIC_USAGE_OBSERVATION_MISSING');
  assert.equal(observation.sourceTool, 'mcp__codex_app__get_usage_limits', 'DIAGNOSTIC_USAGE_SOURCE_INVALID');
  const observedAt = Date.parse(observation.observedAtUtc || '');
  assert.ok(Number.isFinite(observedAt) && observedAt >= requestedAt && observedAt <= now &&
    now - observedAt <= GATE_PROJECTION.observationMaximumAgeMs, 'DIAGNOSTIC_USAGE_OBSERVATION_STALE');
  const { primary, secondary } = decodeUsageToolResult(observation.toolResult);
  const fiveHourRemaining = 100 - primary.usedPercent;
  const weeklyRemaining = 100 - secondary.usedPercent;
  assert.ok(fiveHourRemaining > GATE_PROJECTION.finishAboveRemainingPercent, 'DIAGNOSTIC_FIVE_HOUR_FINISH_FLOOR_NOT_MET');
  assert.ok(fiveHourRemaining >= GATE_PROJECTION.checkpointAtRemainingPercent, 'DIAGNOSTIC_FIVE_HOUR_CHECKPOINT_REQUIRED');
  assert.ok(fiveHourRemaining - GATE_PROJECTION.fiveHourCostPercentagePoints >=
    GATE_PROJECTION.reserveAfterProjectionMinimumFiveHourPercent, 'DIAGNOSTIC_FIVE_HOUR_RESERVE_NOT_MET');
  assert.ok(weeklyRemaining - GATE_PROJECTION.weeklyCostPercentagePoints >=
    GATE_PROJECTION.reserveAfterProjectionMinimumWeeklyPercent, 'DIAGNOSTIC_WEEKLY_RESERVE_NOT_MET');
  return Object.freeze({
    observedAtUtc: observation.observedAtUtc,
    fiveHourRemainingPercent: fiveHourRemaining,
    weeklyRemainingPercent: weeklyRemaining,
    fiveHourProjectionPercentagePoints: GATE_PROJECTION.fiveHourCostPercentagePoints,
    weeklyProjectionPercentagePoints: GATE_PROJECTION.weeklyCostPercentagePoints
  });
}
function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input && typeof input.url === 'string') return input.url;
  return '';
}
export function assertApprovedGeminiFetch(input, init = {}) {
  let url;
  try { url = new URL(requestUrl(input)); } catch { throw codedError('DIAGNOSTIC_FETCH_URL_INVALID'); }
  assert.equal(url.toString(), GEMINI_ENDPOINT, 'DIAGNOSTIC_FETCH_URL_NOT_APPROVED');
  assert.equal(url.username, '', 'DIAGNOSTIC_FETCH_CREDENTIALS_REJECTED');
  assert.equal(url.password, '', 'DIAGNOSTIC_FETCH_CREDENTIALS_REJECTED');
  assert.equal(url.search, '', 'DIAGNOSTIC_FETCH_QUERY_REJECTED');
  assert.equal(url.hash, '', 'DIAGNOSTIC_FETCH_FRAGMENT_REJECTED');
  const method = String(init.method || input?.method || 'GET').toUpperCase();
  assert.equal(method, 'POST', 'DIAGNOSTIC_FETCH_METHOD_NOT_APPROVED');
  assert.equal(init.redirect ?? input?.redirect, 'error', 'DIAGNOSTIC_FETCH_REDIRECT_POLICY_INVALID');
  return true;
}
function patchMethod(target, key, replacement, restorers) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  assert.ok(descriptor && 'value' in descriptor && !(descriptor.configurable === false && descriptor.writable === false),
    'DIAGNOSTIC_NETWORK_GUARD_API_NOT_PATCHABLE');
  Object.defineProperty(target, key, { ...descriptor, value: replacement });
  restorers.push(() => Object.defineProperty(target, key, descriptor));
}
function networkError(api, url = '') {
  const error = codedError(NETWORK_BLOCKED_CODE);
  error.api = api;
  error.url = url;
  return error;
}
async function withAmbientNetworkDisabled(fn, {
  fetchImplementation = globalThis.fetch,
  nativeMethodStubs = {},
  observations = []
} = {}) {
  assert.equal(ambientGuardActive, false, 'DIAGNOSTIC_NETWORK_GUARD_BUSY');
  ambientGuardActive = true;
  const restorers = [];
  const denied = (api, args = []) => {
    const url = api === 'fetch' ? requestUrl(args[0]) : '';
    observations.push({ api, ...(url ? { url } : {}), outcome: 'BLOCKED', errorCode: NETWORK_BLOCKED_CODE });
    return networkError(api, url);
  };
  const requireScope = () => {
    const scope = dispatchContext.getStore();
    return scope?.capability === dispatchCapability && scope.active === true;
  };
  try {
    patchMethod(globalThis, 'fetch', function (input, init) {
      if (!requireScope()) return Promise.reject(denied('fetch', [input, init]));
      try { assertApprovedGeminiFetch(input, init || {}); }
      catch (error) {
        observations.push({ api: 'fetch', url: requestUrl(input), outcome: 'BLOCKED', errorCode: safeCode(error, 'DIAGNOSTIC_FETCH_NOT_APPROVED') });
        return Promise.reject(error);
      }
      observations.push({ api: 'fetch', url: requestUrl(input), method: String(init?.method || input?.method || 'GET').toUpperCase(), outcome: 'APPROVED_DISPATCH' });
      return Reflect.apply(fetchImplementation, this, [input, init]);
    }, restorers);
    for (const [target, key, api] of [
      [http, 'request', 'http.request'], [http, 'get', 'http.get'], [https, 'request', 'https.request'], [https, 'get', 'https.get'],
      [http2, 'connect', 'http2.connect'], [net, 'connect', 'net.connect'], [net, 'createConnection', 'net.createConnection'],
      [net.Socket.prototype, 'connect', 'net.Socket.connect'], [tls, 'connect', 'tls.connect'],
      [dgram, 'createSocket', 'dgram.createSocket'], [dgram.Socket.prototype, 'send', 'dgram.Socket.send'],
      [dgram.Socket.prototype, 'bind', 'dgram.Socket.bind'], [dgram.Socket.prototype, 'connect', 'dgram.Socket.connect']
    ]) {
      const original = target[key];
      patchMethod(target, key, function (...args) {
        if (!requireScope()) throw denied(api, args);
        observations.push({ api, outcome: 'APPROVED_SCOPED_NATIVE' });
        const implementation = nativeMethodStubs[api] || original;
        return Reflect.apply(implementation, this, args);
      }, restorers);
    }
    if (typeof globalThis.WebSocket === 'function') {
      patchMethod(globalThis, 'WebSocket', function (...args) { throw denied('WebSocket', args); }, restorers);
    }
    syncBuiltinESMExports();
    const withApprovedDispatch = async operation => {
      assert.equal(typeof operation, 'function', 'DIAGNOSTIC_DISPATCH_OPERATION_INVALID');
      const scope = { capability: dispatchCapability, active: true };
      try { return await dispatchContext.run(scope, operation); }
      finally { scope.active = false; }
    };
    return await fn(withApprovedDispatch);
  } finally {
    let restoreError;
    for (let index = restorers.length - 1; index >= 0; index -= 1) {
      try { restorers[index](); } catch (error) { restoreError ||= error; }
    }
    try { syncBuiltinESMExports(); } catch (error) { restoreError ||= error; }
    ambientGuardActive = false;
    if (restoreError) throw restoreError;
  }
}
// Offline-only test harness; its allowed fetch implementation is a local stub.
export async function exerciseNetworkGuardForTest() {
  const seen = [];
  let approvedFetches = 0;
  let approvedNativeCalls = 0;
  await withAmbientNetworkDisabled(async withDispatch => {
    await assert.rejects(globalThis.fetch('https://example.org/'), error => error?.code === NETWORK_BLOCKED_CODE);
    await assert.rejects(Promise.resolve().then(() => http.get('https://example.org/')),
      error => error?.code === NETWORK_BLOCKED_CODE);
    assert.throws(() => tls.connect({ host: 'local.invalid', port: 443 }),
      error => error?.code === NETWORK_BLOCKED_CODE);
    await assert.rejects(withDispatch(() => globalThis.fetch('https://www.iras.gov.sg/source', {
      method: 'POST', redirect: 'error'
    })), error => error?.message?.startsWith('DIAGNOSTIC_FETCH_URL_NOT_APPROVED'));
    const response = await withDispatch(() => globalThis.fetch(GEMINI_ENDPOINT, { method: 'POST', redirect: 'error' }));
    assert.equal(response.status, 200);
  }, { fetchImplementation: async () => {
    approvedFetches += 1;
    assert.equal(tls.connect({ host: 'local.invalid', port: 443 }), 'stubbed tls connection');
    return new Response('test transport');
  }, nativeMethodStubs: { 'tls.connect': () => { approvedNativeCalls += 1; return 'stubbed tls connection'; } }, observations: seen });
  return { approvedFetches, approvedNativeCalls, blocked: seen.filter(row => row.outcome === 'BLOCKED') };
}
export async function runIndependentCaseLoopForTest({
  executeCase,
  onProgress = async () => {},
  failureCounts = () => ({})
} = {}) {
  assert.equal(typeof executeCase, 'function', 'DIAGNOSTIC_CASE_EXECUTOR_REQUIRED');
  assert.equal(typeof onProgress, 'function', 'DIAGNOSTIC_PROGRESS_WRITER_REQUIRED');
  assert.equal(typeof failureCounts, 'function', 'DIAGNOSTIC_FAILURE_COUNTS_READER_REQUIRED');
  const rows = [];
  for (const caseId of DIAGNOSTIC_CASE_IDS) {
    let row;
    try {
      row = await executeCase(caseId);
      assert.equal(row?.caseId, caseId, 'DIAGNOSTIC_CASE_RESULT_ID_MISMATCH');
    } catch (error) {
      const observed = failureCounts(caseId) || {};
      const semanticSendInvocations = Number.isSafeInteger(observed.semanticSendInvocations)
        ? observed.semanticSendInvocations : 0;
      const approvedProviderFetchCount = Number.isSafeInteger(observed.approvedProviderFetchCount)
        ? observed.approvedProviderFetchCount : 0;
      const failureCode = safeCode(error);
      row = {
        caseId,
        status: 'FAILED',
        failureStage: 'CASE_EXECUTION',
        failureCode,
        firstFailure: 'CASE_EXECUTION',
        semanticSendInvocations,
        approvedProviderFetchCount,
        adapterStageVerdicts: {},
        layerVerdicts: {},
        stageVerdicts: {},
        replayHealthy: false,
        replayFailureCode: null,
        semanticResponseSha256: null,
        semanticResponseBytes: null,
        blockedUrlObservations: [],
        blockedNetworkObservations: [],
        failure: { stage: 'CASE_EXECUTION', code: failureCode }
      };
    }
    rows.push(row);
    await onProgress(row);
  }
  return rows;
}
export function scoreDiagnosticAdapterResult(adapterResult, integrityPassed, evaluateV4Stages) {
  const layers = adapterResult?.layerVerdicts;
  const names = layers && isObject(layers) ? Object.keys(layers).sort() : [];
  const expectedNames = ['application', 'governed', 'local', 'routing', 'semantic'];
  const namesValid = stableJson(names) === stableJson(expectedNames);
  const canonical = namesValid ? evaluateV4Stages(layers) : undefined;
  const stages = adapterResult?.stageVerdicts;
  const stageNames = stages && isObject(stages) ? Object.keys(stages).sort() : [];
  const canonicalNames = canonical ? Object.keys(canonical.stages).sort() : [];
  const stageKeysMatch = Boolean(canonical && stableJson(stageNames) === stableJson(canonicalNames));
  const normalizedStages = canonical && stages
    ? Object.fromEntries(Object.keys(canonical.stages).map(stage => [stage, stages[stage]]))
    : undefined;
  const stageVerdictsMatch = Boolean(stageKeysMatch && stableJson(normalizedStages) === stableJson(canonical.stages));
  const firstFailureMatches = Boolean(canonical && (adapterResult?.firstFailure ?? null) === (canonical.earliestFailure ?? null));
  const effective = canonical ? evaluateV4Stages({ ...layers, integrityPassed }) : undefined;
  const passed = Boolean(integrityPassed && stageVerdictsMatch && firstFailureMatches && effective &&
    effective.earliestFailure == null && Object.values(effective.stages).every(value => value === true));
  const failureCode = !namesValid ? 'DIAGNOSTIC_LAYER_VERDICTS_INVALID'
    : !stageKeysMatch || !stageVerdictsMatch ? 'DIAGNOSTIC_STAGE_VERDICTS_MISMATCH'
      : !firstFailureMatches ? 'DIAGNOSTIC_FAILURE_ATTRIBUTION_MISMATCH'
        : integrityPassed ? 'DIAGNOSTIC_ACCEPTANCE_SCORE_FAILED' : 'DIAGNOSTIC_INTEGRITY_FAILED';
  return {
    passed,
    failureCode,
    firstFailure: integrityPassed ? (effective?.earliestFailure || (!stageVerdictsMatch || !firstFailureMatches ? 'ACCEPTANCE_SCORE' : null)) : 'INTEGRITY',
    adapterStageVerdicts: stages || {},
    layerVerdicts: layers || {},
    stageVerdicts: effective?.stages || stages || {}
  };
}async function loadPinnedContext() {
  const launcherBytes = await readRaw(LAUNCHER_PATH);
  const launcherSha256 = sha256(launcherBytes);
  const paths = Object.keys(PINNED_INPUTS);
  const raws = await Promise.all(paths.map(readRaw));
  const hashes = Object.fromEntries(paths.map((file, index) => [file, sha256(raws[index])]));
  for (const [file, expected] of Object.entries(PINNED_INPUTS)) {
    assertRawSha256(raws[paths.indexOf(file)], expected, 'DIAGNOSTIC_PINNED_INPUT_MISMATCH');
  }
  const [preregistration, activation, payload, evidenceLock] = await Promise.all([
    readJson(PREREGISTRATION_PATH), readJson(ACTIVATION_PATH), readJson(CAPTURE_PAYLOAD_PATH), readJson(EVIDENCE_LOCK_PATH)
  ]);
  assert.equal(preregistration.value.profile, 'iras-first-targeted-acceptance-v4', 'DIAGNOSTIC_PREREGISTRATION_PROFILE_INVALID');
  assert.equal(preregistration.value.status, 'FROZEN_PREREGISTRATION', 'DIAGNOSTIC_PREREGISTRATION_NOT_FROZEN');
  assert.equal(preregistration.value.targetedAcceptanceExecuted, false, 'DIAGNOSTIC_PREREGISTRATION_ALREADY_EXECUTED');
  assert.equal(preregistration.value.promptFingerprints.length, 9, 'DIAGNOSTIC_PREREGISTRATION_CASE_COUNT_INVALID');
  assert.deepEqual(preregistration.value.promptFingerprints.map(row => row.caseId).slice(3), DIAGNOSTIC_CASE_IDS,
    'DIAGNOSTIC_CASES_DO_NOT_MATCH_FROZEN_PREREGISTRATION');
  assert.equal(activation.value.profile, 'iras-v4-capture-activation', 'DIAGNOSTIC_ACTIVATION_PROFILE_INVALID');
  assert.equal(activation.value.status, 'FROZEN_ACTIVATION_CONFIGURATION', 'DIAGNOSTIC_ACTIVATION_NOT_FROZEN');
  assert.equal(activation.value.frozen, true, 'DIAGNOSTIC_ACTIVATION_NOT_FROZEN');
  assert.equal(activation.value.runnerConfigurationPath, `${PREPARATION}/runner-configuration.json`,
    'DIAGNOSTIC_RUNNER_CONFIGURATION_PATH_MISMATCH');
  assert.equal(activation.value.preregistrationPath, PREREGISTRATION_PATH, 'DIAGNOSTIC_ACTIVATION_PREREGISTRATION_PATH_MISMATCH');
  assert.equal(activation.value.preregistrationSha256, PINNED_INPUTS[PREREGISTRATION_PATH],
    'DIAGNOSTIC_ACTIVATION_PREREGISTRATION_HASH_MISMATCH');
  assert.equal(payload.value.profile, CAPTURE_PROFILE, 'DIAGNOSTIC_CAPTURE_PROFILE_INVALID');
  assert.equal(payload.value.synthetic, false, 'DIAGNOSTIC_SYNTHETIC_CAPTURE_REJECTED');
  assert.equal(evidenceLock.value.profile, CAPTURE_PROFILE, 'DIAGNOSTIC_EVIDENCE_LOCK_PROFILE_INVALID');
  assert.equal(evidenceLock.value.capturePayloadSha256, hashes[CAPTURE_PAYLOAD_PATH], 'DIAGNOSTIC_LOCK_PAYLOAD_HASH_MISMATCH');
  assert.equal(evidenceLock.value.activationConfigurationFileSha256, hashes[ACTIVATION_PATH], 'DIAGNOSTIC_LOCK_ACTIVATION_HASH_MISMATCH');
  assert.equal(evidenceLock.value.preregistrationSha256, hashes[PREREGISTRATION_PATH], 'DIAGNOSTIC_LOCK_PREREGISTRATION_HASH_MISMATCH');
  assert.equal(evidenceLock.value.runnerIntegrityBindingSha256, activation.value.runnerIntegrityBindingSha256,
    'DIAGNOSTIC_LOCK_RUNNER_BINDING_MISMATCH');
  assert.equal(evidenceLock.value.activationConfigurationSha256, activation.value.activationConfigurationSha256,
    'DIAGNOSTIC_LOCK_ACTIVATION_BINDING_MISMATCH');
  assert.equal(evidenceLock.value.sourceReferenceDate, '2026-10-08', 'DIAGNOSTIC_CAPTURE_REFERENCE_DATE_INVALID');
  assert.equal(Date.parse(evidenceLock.value.earliestAcquisitionAt), Date.parse('2026-10-08T14:43:24.380Z'),
    'DIAGNOSTIC_CAPTURE_TIME_INVALID');
  return {
    launcherSha256,
    preregistration: preregistration.value,
    activation: activation.value,
    payload: payload.value,
    evidenceLock: evidenceLock.value,
    pinnedHashes: hashes,
    priorResult: Object.freeze({ passed: 2, failed: 1, notRun: 6 }),
    oldJournalHash: hashes[OLD_JOURNAL_PATH],
    oldMarkerHash: hashes[OLD_MARKER_PATH]
  };
}
async function assertPinnedInputsUnchanged(context) {
  for (const [file, expected] of Object.entries(PINNED_INPUTS)) {
    assertRawSha256(await readRaw(file), expected, 'DIAGNOSTIC_PINNED_INPUT_CHANGED');
  }
  assertRawSha256(await readRaw(LAUNCHER_PATH), context.launcherSha256, 'DIAGNOSTIC_LAUNCHER_CHANGED');
  if (context.authorizationSha256) {
    assertRawSha256(await readRaw(AUTHORIZATION_PATH), context.authorizationSha256, 'DIAGNOSTIC_AUTHORIZATION_CHANGED');
  }
  if (context.reviewSha256) {
    assertRawSha256(await readRaw(REVIEW_PATH), context.reviewSha256, 'DIAGNOSTIC_REVIEW_CHANGED');
  }
}
async function assertReviewedModulesUnchanged(capability) {
  for (const row of capability.reviewedModules) {
    const relative = row.path.replaceAll('\\', '/');
    assert.equal(sha256(await readRaw(relative)), row.sha256, 'DIAGNOSTIC_REVIEWED_MODULE_CHANGED');
  }
}
async function assertLiveMetadata(context) {
  const authorization = await readJson(AUTHORIZATION_PATH);
  context.authorizationSha256 = authorization.sha256;
  assertAuthorization(authorization.value, context);
  const review = await readJson(REVIEW_PATH);
  context.reviewSha256 = review.sha256;
  assertIndependentReview(review.value, context);
  return { authorization: authorization.value, review: review.value };
}
async function loadRuntime(context) {
  const runner = await import(pathToFileURL(absolute('scripts/iras_v4_capture_replay_runner.mjs')).href);
  const evaluation = await import(pathToFileURL(absolute('tests/evaluation/singapore/iras-first-targeted-acceptance-v4.mjs')).href);
  assert.equal(typeof evaluation.evaluateV4Stages, 'function', 'DIAGNOSTIC_EVALUATOR_UNAVAILABLE');
  const capability = await runner.loadReviewedV4ExecutionCapability({
    activationConfigurationPath: absolute(ACTIVATION_PATH), root: ROOT, gitExecutable: GIT
  });
  const initialReplay = runner.createReplayTransport({
    payload: context.payload,
    integrityLatch: () => {},
    syntheticMode: false,
    now: new Date(),
    expectedIntegrityBindingSha256: context.activation.runnerIntegrityBindingSha256,
    expectedPreregistrationSha256: PINNED_INPUTS[PREREGISTRATION_PATH],
    executionCapability: capability,
    activationConfigurationSha256: context.activation.activationConfigurationSha256,
    expectedCaptureInventory: context.activation.captureInventory
  });
  initialReplay.assertHealthy();
  return { runner, evaluation, capability };
}
async function checkMode() {
  const observations = [];
  await withAmbientNetworkDisabled(async () => {
    assert.equal(Number(process.versions.node.split('.')[0]), 22, 'NODE_22_REQUIRED');
    const context = await loadPinnedContext();
    const runner = await import(pathToFileURL(absolute('scripts/iras_v4_capture_replay_runner.mjs')).href);
    runner.validateCapturePayload(context.payload, {
      now: new Date(),
      expectedIntegrityBindingSha256: context.activation.runnerIntegrityBindingSha256,
      expectedPreregistrationSha256: PINNED_INPUTS[PREREGISTRATION_PATH],
      expectedActivationConfigurationSha256: context.activation.activationConfigurationSha256,
      expectedActivationConfigurationFileSha256: PINNED_INPUTS[ACTIVATION_PATH],
      expectedCaptureInventory: context.activation.captureInventory,
      syntheticMode: false,
      requireComplete: true
    });
    const authExists = await assertNoSymlinkPath(AUTHORIZATION_PATH, { allowMissing: true });
    const reviewExists = await assertNoSymlinkPath(REVIEW_PATH, { allowMissing: true });
    assert.equal(authExists, reviewExists, 'DIAGNOSTIC_LIVE_METADATA_INCOMPLETE');
    let metadataStatus = 'PENDING';
    if (authExists) {
      await assertLiveMetadata(context);
      metadataStatus = 'READY';
    }
    for (const outputPath of [GATE_REQUEST_PATH, GATE_RESPONSE_PATH, CONSUMED_PATH, PARTIAL_PATH, SUMMARY_PATH]) {
      await assertAbsent(outputPath);
    }
    emit('DIAGNOSTIC_OFFLINE_CHECK', 'PASSED', {
      semanticProfile: 'DIAGNOSTIC_CONTINUATION',
      caseIds: DIAGNOSTIC_CASE_IDS,
      frozenInputsValidated: true,
      priorSemanticEvidencePinned: true,
      liveMetadata: metadataStatus,
      credentialRead: false,
      networkUsed: false,
      filesWritten: false,
      canonicalAcceptanceOutput: false
    });
  }, { observations });
}
function usageRequest(context, credentialSha256) {
  return {
    profile: 'iras-v4-remaining-six-diagnostic-gate-request',
    requestId: randomUUID(),
    requestedAtUtc: new Date().toISOString(),
    launcherSha256: context.launcherSha256,
    authorizationSha256: context.authorizationSha256,
    independentReviewSha256: context.reviewSha256,
    credentialSha256,
    semanticProfile: 'DIAGNOSTIC_CONTINUATION',
    caseIds: DIAGNOSTIC_CASE_IDS,
    model: MODEL,
    authorizedGeminiCalls: 6,
    retries: 0,
    providerProbesAuthorized: 0,
    liveSourceRetrieval: false,
    requiredUsageTool: 'mcp__codex_app__get_usage_limits',
    requiredUsageWindowsMinutes: [300, 10080],
    maximumUsageObservationAgeMs: GATE_PROJECTION.observationMaximumAgeMs,
    projection: GATE_PROJECTION,
    userInstruction: HUMAN_INSTRUCTION
  };
}
async function writeExclusive(relative, value) {
  const handle = await open(assertSafeRelative(relative), 'wx');
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
  return sha256(bytes);
}
async function awaitUsageGate(context, credentialSha256) {
  await mkdir(assertSafeRelative(RESULTS), { recursive: true });
  await assertAbsent(GATE_REQUEST_PATH);
  await assertAbsent(GATE_RESPONSE_PATH);
  const request = usageRequest(context, credentialSha256);
  const requestSha256 = await writeExclusive(GATE_REQUEST_PATH, request);
  emit('DIAGNOSTIC_FRESH_USAGE_GATE', 'AWAITING', {
    requestPath: GATE_REQUEST_PATH,
    responsePath: GATE_RESPONSE_PATH,
    timeoutSeconds: 300,
    usageTool: 'mcp__codex_app__get_usage_limits'
  });
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    try {
      const metadata = await lstat(assertSafeRelative(GATE_RESPONSE_PATH));
      assert.ok(metadata.isFile() && !metadata.isSymbolicLink(), 'DIAGNOSTIC_GATE_RESPONSE_NOT_REGULAR_FILE');
      const responseBytes = await readFile(assertSafeRelative(GATE_RESPONSE_PATH));
      let response;
      try { response = JSON.parse(responseBytes.toString('utf8')); }
      catch { throw codedError('DIAGNOSTIC_GATE_RESPONSE_INVALID'); }
      assert.ok(isObject(response), 'DIAGNOSTIC_GATE_RESPONSE_INVALID');
      return validateFreshUsageGate(response, request, {
        requestSha256,
        launcherSha256: context.launcherSha256,
        authorizationSha256: context.authorizationSha256,
        reviewSha256: context.reviewSha256,
        credentialSha256
      });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw codedError('DIAGNOSTIC_FRESH_USAGE_GATE_TIMEOUT');
}
async function loadCredential() {
  assert.equal(typeof process.loadEnvFile, 'function', 'NODE_ENV_FILE_LOADER_REQUIRED');
  const inheritedKey = process.env.GEMINI_API_KEY;
  if (inheritedKey !== undefined) delete process.env.GEMINI_API_KEY;
  try {
    process.loadEnvFile(absolute('.env.local'));
    const configuredKey = process.env.GEMINI_API_KEY;
    assert.ok(typeof configuredKey === 'string' && configuredKey.trim().length > 10,
      'DIAGNOSTIC_GEMINI_CREDENTIAL_UNAVAILABLE');
    if (inheritedKey !== undefined) {
      assert.equal(inheritedKey, configuredKey, 'DIAGNOSTIC_CREDENTIAL_SCOPE_CHANGED');
    }
    return sha256(Buffer.from(configuredKey, 'utf8'));
  } catch (error) {
    if (inheritedKey !== undefined) process.env.GEMINI_API_KEY = inheritedKey;
    throw error;
  }
}
async function createCaseReplay(context, capability, runner, caseId, onIntegrityFailure) {
  await assertPinnedInputsUnchanged(context);
  await assertReviewedModulesUnchanged(capability);
  return runner.createReplayTransport({
    payload: context.payload,
    integrityLatch: onIntegrityFailure,
    syntheticMode: false,
    now: new Date(),
    expectedIntegrityBindingSha256: context.activation.runnerIntegrityBindingSha256,
    expectedPreregistrationSha256: PINNED_INPUTS[PREREGISTRATION_PATH],
    executionCapability: capability,
    activationConfigurationSha256: context.activation.activationConfigurationSha256,
    expectedCaptureInventory: context.activation.captureInventory
  });
}
async function invokeAcceptanceAdapter(capability, input) {
  return await capability.runV4AcceptanceCase({
    caseId: input.caseId,
    sendSemantic: input.sendSemantic,
    referenceDate: input.referenceDate,
    evidenceTransport: input.evidenceTransport,
    withEvidenceFamily: input.withEvidenceFamily,
    webRetriever: input.webRetriever
  });
}
export async function invokeAcceptanceAdapterForTest(capability, input) {
  return await invokeAcceptanceAdapter(capability, input);
}
async function sendAndRecordFetchCount(send, caseCounters, getFetchCount) {
  try { return await send(); }
  finally { caseCounters.approvedProviderFetchCount = getFetchCount(); }
}
export async function sendAndRecordFetchCountForTest(send, caseCounters, getFetchCount) {
  return await sendAndRecordFetchCount(send, caseCounters, getFetchCount);
}
function diagnosticOutcomeFields({ failed, failureStage, failureCode, scoring }) {
  const resolvedFailureStage = failed
    ? (failureStage || scoring?.firstFailure || 'ACCEPTANCE_SCORE')
    : null;
  return {
    ...(scoring || { adapterStageVerdicts: {}, layerVerdicts: {}, stageVerdicts: {} }),
    failureStage: resolvedFailureStage,
    failureCode: failed ? (failureCode || scoring?.failureCode || 'DIAGNOSTIC_ACCEPTANCE_SCORE_FAILED') : null,
    firstFailure: resolvedFailureStage
  };
}
export function diagnosticOutcomeFieldsForTest(input) {
  return diagnosticOutcomeFields(input);
}
async function executeDiagnosticCase(caseId, context, runtime, withDispatch, networkObservations, caseCounters) {
  const { runner, evaluation, capability } = runtime;
  const observationsAtStart = networkObservations.length;
  const replayBlockedUrls = [];
  let replay;
  let adapterResult;
  let semanticResponse;
  let semanticSendInvocations = 0;
  caseCounters.semanticSendInvocations = 0;
  caseCounters.approvedProviderFetchCount = 0;
  let failureStage;
  let failureCode;
  let partialProviderResponse;
  let caseResultSha256;
  let integrityLatchCode;
  let replayHealthy = true;
  const promptFingerprints = context.preregistration.promptFingerprints;
  const currentApprovedFetchCount = () => networkObservations.slice(observationsAtStart)
    .filter(row => row.outcome === 'APPROVED_DISPATCH').length;
  const semanticSend = async args => {
    semanticSendInvocations += 1;
    caseCounters.semanticSendInvocations = semanticSendInvocations;
    if (semanticSendInvocations > 1) {
      failureStage = 'INTEGRITY';
      failureCode = 'V4_EXTRA_OR_RETRY_SEMANTIC_CALL_BLOCKED';
      throw codedError(failureCode);
    }
    try {
      runner.assertFrozenSemanticRequest(args, { caseId, promptFingerprints });
      await assertPinnedInputsUnchanged(context);
      await assertReviewedModulesUnchanged(capability);
      assert.equal(sha256(Buffer.from(process.env.GEMINI_API_KEY || '', 'utf8')),
        context.credentialSha256, 'DIAGNOSTIC_CREDENTIAL_CHANGED');
    } catch (error) {
      failureStage = 'INTEGRITY';
      failureCode = safeCode(error, 'DIAGNOSTIC_SEMANTIC_REQUEST_REJECTED');
      throw error;
    }
    try {
      semanticResponse = await sendAndRecordFetchCount(
        () => withDispatch(() => capability.sendV4SemanticRequest(args)), caseCounters, currentApprovedFetchCount
      );
      assert.equal(typeof semanticResponse, 'string', 'DIAGNOSTIC_SEMANTIC_RESPONSE_INVALID');
      return semanticResponse;
    } catch (error) {
      failureStage = 'SEMANTIC_TRANSPORT';
      failureCode = safeCode(error, 'DIAGNOSTIC_SEMANTIC_TRANSPORT_FAILED');
      partialProviderResponse = error?.partialProviderResponse || null;
      throw error;
    }
  };
  try {
    replay = await createCaseReplay(context, capability, runner, caseId, code => { integrityLatchCode ||= String(code); });
    const trackedTransport = Object.freeze({
      fetch: async (url, init = {}) => {
        try { return await replay.fetch(url, init); }
        catch (error) {
          replayBlockedUrls.push({ url: String(url), method: String(init.method || 'GET').toUpperCase(), errorCode: safeCode(error) });
          throw error;
        }
      },
      withEvidenceFamily: replay.withEvidenceFamily,
      withCaseFamily: replay.withCaseFamily,
      recordCacheReuse: replay.recordCacheReuse,
      assertHealthy: () => replay.assertHealthy(),
      trip: code => { integrityLatchCode ||= String(code); return replay.trip(code); }
    });
    const webRetriever = runner.bindProductionControlledRetriever({ transport: trackedTransport });
    try {
      adapterResult = await replay.withCaseFamily(caseId, () => invokeAcceptanceAdapter(capability, {
        caseId,
        sendSemantic: semanticSend,
        referenceDate: context.evidenceLock.sourceReferenceDate,
        evidenceTransport: trackedTransport.fetch,
        withEvidenceFamily: trackedTransport.withEvidenceFamily,
        webRetriever
      }));
    } catch (error) {
      failureStage ||= integrityLatchCode ? 'INTEGRITY' : 'CASE_EXECUTION';
      failureCode ||= integrityLatchCode || safeCode(error, 'DIAGNOSTIC_CASE_EXECUTION_FAILED');
    }
    try { replay.assertHealthy(); }
    catch (error) {
      replayHealthy = false;
      failureStage = 'INTEGRITY';
      failureCode = safeCode(error, 'DIAGNOSTIC_REPLAY_UNHEALTHY');
    }
  } catch (error) {
    replayHealthy = false;
    failureStage ||= 'PRECHECK';
    failureCode ||= safeCode(error, 'DIAGNOSTIC_CASE_PRECHECK_FAILED');
    try { replay?.assertHealthy(); } catch (healthError) {
      failureStage = 'INTEGRITY';
      failureCode = safeCode(healthError, 'DIAGNOSTIC_REPLAY_UNHEALTHY');
    }
  }
  if (semanticSendInvocations !== 1 && !failureCode) {
    failureStage = 'SEMANTIC_RESPONSE';
    failureCode = 'DIAGNOSTIC_CASE_SEMANTIC_SEND_MISSING';
  }
  if (semanticSendInvocations > 1) {
    failureStage = 'INTEGRITY';
    failureCode = 'V4_EXTRA_OR_RETRY_SEMANTIC_CALL_BLOCKED';
  }
  if (adapterResult !== undefined) {
    try { caseResultSha256 = sha256(Buffer.from(stableJson(adapterResult), 'utf8')); }
    catch (error) {
      failureStage ||= 'ACCEPTANCE_SCORE';
      failureCode ||= safeCode(error, 'DIAGNOSTIC_ADAPTER_RESULT_INVALID');
    }
  }
  const scoring = adapterResult !== undefined
    ? scoreDiagnosticAdapterResult(adapterResult, replayHealthy, evaluation.evaluateV4Stages)
    : null;
  if (scoring && !scoring.passed && !failureCode) {
    failureStage = scoring.firstFailure || 'ACCEPTANCE_SCORE';
    failureCode = scoring.failureCode;
  }
  if (!replayHealthy && !failureStage) {
    failureStage = 'INTEGRITY';
    failureCode = integrityLatchCode || 'DIAGNOSTIC_REPLAY_UNHEALTHY';
  }
  const responseBytes = typeof semanticResponse === 'string' ? Buffer.from(semanticResponse, 'utf8') : null;
  const caseNetworkObservations = networkObservations.slice(observationsAtStart);
  const approvedProviderFetchCount = caseNetworkObservations.filter(row => row.outcome === 'APPROVED_DISPATCH').length;
  caseCounters.semanticSendInvocations = semanticSendInvocations;
  caseCounters.approvedProviderFetchCount = approvedProviderFetchCount;
  if (semanticSendInvocations === 1 && approvedProviderFetchCount !== 1 && !failureCode) {
    failureStage = 'SEMANTIC_TRANSPORT';
    failureCode = 'DIAGNOSTIC_PROVIDER_FETCH_COUNT_MISMATCH';
  }
  const failed = Boolean(failureCode || !scoring?.passed);
  return {
    caseId,
    status: failed ? 'FAILED' : 'PASSED',
    ...diagnosticOutcomeFields({ failed, failureStage, failureCode, scoring }),
    semanticSendInvocations,
    approvedProviderFetchCount,
    semanticResponseSha256: responseBytes ? sha256(responseBytes) : null,
    semanticResponseBytes: responseBytes?.length ?? null,
    ...(responseBytes ? { semanticResponseBase64: responseBytes.toString('base64'), semanticResponse } : {}),
    ...(partialProviderResponse ? { partialProviderResponse } : {}),
    ...(adapterResult !== undefined ? { adapterResult, adapterResultSha256: caseResultSha256 } : {}),
    replayHealthy,
    replayFailureCode: integrityLatchCode,
    blockedUrlObservations: replayBlockedUrls,
    blockedNetworkObservations: caseNetworkObservations.filter(row => row.outcome === 'BLOCKED'),
    completedAtUtc: new Date().toISOString()
  };
}async function createConsumptionMarker(context, gate) {
  return await writeExclusive(CONSUMED_PATH, {
    profile: 'iras-v4-remaining-six-diagnostic-consumption',
    status: 'CONSUMED_NO_RETRY',
    semanticProfile: 'DIAGNOSTIC_CONTINUATION',
    launcherSha256: context.launcherSha256,
    authorizationSha256: context.authorizationSha256,
    independentReviewSha256: context.reviewSha256,
    credentialSha256: gate.credentialSha256,
    usageObservedAtUtc: gate.observedAtUtc,
    caseIds: DIAGNOSTIC_CASE_IDS,
    authorizedGeminiCalls: 6,
    retries: 0,
    providerProbesAuthorized: 0,
    liveSourceRetrieval: false,
    consumedAtUtc: new Date().toISOString()
  });
}
export function makeDiagnosticSummaryForTest(rows, context, gate, immutableInputs) {
  const passed = rows.filter(row => row.status === 'PASSED').length;
  const failed = rows.filter(row => row.status === 'FAILED').length;
  const notRun = DIAGNOSTIC_CASE_IDS.length - rows.length;
  const totalProviderFetches = rows.reduce((sum, row) => sum +
    (Number.isSafeInteger(row.approvedProviderFetchCount) ? row.approvedProviderFetchCount : 0), 0);
  const totalDispatchInvocations = rows.reduce((sum, row) => sum +
    (Number.isSafeInteger(row.semanticSendInvocations) ? row.semanticSendInvocations : 0), 0);
  return {
    profile: 'iras-v4-remaining-six-diagnostic-continuation',
    semanticProfile: 'DIAGNOSTIC_CONTINUATION',
    status: notRun === 0 && failed === 0 && immutableInputs.passed ? 'COMPLETE' : 'FAILED_CONTINUATION_RECORDED',
    diagnosticCaseIds: DIAGNOSTIC_CASE_IDS,
    caseCount: DIAGNOSTIC_CASE_IDS.length,
    passed,
    failed,
    notRun,
    rows,
    originalConsumedRun: {
      namespace: OLD_NAMESPACE,
      observed: { passed: 2, failed: 1, notRun: 6 },
      journalSha256: context.oldJournalHash,
      consumptionMarkerSha256: context.oldMarkerHash,
      unchangedAtCompletion: immutableInputs.oldNamespaceUnchanged
    },
    combinedObservedCounts: { passed: 2 + passed, failed: 1 + failed, notRun },
    actualSemanticDispatchInvocations: totalDispatchInvocations,
    approvedGeminiFetchRequests: totalProviderFetches,
    authorizedGeminiCalls: 6,
    model: MODEL,
    transportTimeoutMs: 8000,
    minimumStartGapMs: 15250,
    retries: 0,
    providerProbes: 0,
    newOfficialSourceRequests: 0,
    capturePayloadSha256: PINNED_INPUTS[CAPTURE_PAYLOAD_PATH],
    evidenceLockSha256: PINNED_INPUTS[EVIDENCE_LOCK_PATH],
    usageObservedAtUtc: gate.observedAtUtc,
    immutableInputsPassed: immutableInputs.passed,
    fullNineCaseAcceptanceProven: false,
    canonicalAcceptanceArtifactCreated: false,
    completedAtUtc: new Date().toISOString()
  };
}
async function runMode() {
  const networkObservations = [];
  await withAmbientNetworkDisabled(
    withDispatch => runModeGuarded(withDispatch, networkObservations),
    { observations: networkObservations }
  );
}
async function runModeGuarded(withDispatch, networkObservations) {
  assert.equal(Number(process.versions.node.split('.')[0]), 22, 'NODE_22_REQUIRED');
  const context = await loadPinnedContext();
  await assertLiveMetadata(context);
  const runtime = await loadRuntime(context);
  runtime.runner.assertReviewedV4ExecutionCapability(runtime.capability);
  await assertPinnedInputsUnchanged(context);
  await assertReviewedModulesUnchanged(runtime.capability);
  for (const outputPath of [GATE_REQUEST_PATH, GATE_RESPONSE_PATH, CONSUMED_PATH, PARTIAL_PATH, SUMMARY_PATH]) {
    await assertAbsent(outputPath);
  }
  const credentialSha256 = await loadCredential();
  context.credentialSha256 = credentialSha256;
  const usage = await awaitUsageGate(context, credentialSha256);
  const gate = { ...usage, credentialSha256 };
  // This exclusive marker is the point of no retry; it immediately follows gate acceptance.
  await createConsumptionMarker(context, gate);
  const journal = await open(absolute(PARTIAL_PATH), 'wx');
  await journal.sync();
  const rows = [];
  const caseCountersById = new Map();
  let infrastructureFailure;
  try {
    await runIndependentCaseLoopForTest({
      executeCase: caseId => {
        const caseCounters = { semanticSendInvocations: 0, approvedProviderFetchCount: 0 };
        caseCountersById.set(caseId, caseCounters);
        return executeDiagnosticCase(caseId, context, runtime, withDispatch, networkObservations, caseCounters);
      },
      failureCounts: caseId => caseCountersById.get(caseId),
      onProgress: async row => {
        rows.push(row);
        await journal.writeFile(`${JSON.stringify({ event: row.status === 'PASSED' ? 'CASE_COMPLETED' : 'CASE_FAILED', ...row })}\n`);
        await journal.sync();
      }
    });
  } catch (error) {
    infrastructureFailure = safeCode(error, 'DIAGNOSTIC_EXECUTION_INTERRUPTED');
  } finally {
    await journal.close();
  }
  const immutableInputs = { passed: true, oldNamespaceUnchanged: true };
  try {
    await assertPinnedInputsUnchanged(context);
    await assertReviewedModulesUnchanged(runtime.capability);
    assert.equal(sha256(Buffer.from(process.env.GEMINI_API_KEY || '', 'utf8')), credentialSha256,
      'DIAGNOSTIC_CREDENTIAL_CHANGED');
  } catch (error) {
    immutableInputs.passed = false;
    immutableInputs.failureCode = safeCode(error, 'DIAGNOSTIC_FROZEN_INPUT_CHANGED');
  }
  try {
    assertRawSha256(await readRaw(OLD_JOURNAL_PATH), context.oldJournalHash, 'DIAGNOSTIC_PRIOR_JOURNAL_CHANGED');
    assertRawSha256(await readRaw(OLD_MARKER_PATH), context.oldMarkerHash, 'DIAGNOSTIC_PRIOR_MARKER_CHANGED');
  } catch (error) {
    immutableInputs.passed = false;
    immutableInputs.oldNamespaceUnchanged = false;
    immutableInputs.priorNamespaceFailureCode = safeCode(error, 'DIAGNOSTIC_PRIOR_NAMESPACE_CHANGED');
  }
  const summary = makeDiagnosticSummaryForTest(rows, context, gate, immutableInputs);
  if (infrastructureFailure) {
    summary.status = 'FAILED_CONTINUATION_RECORDED';
    summary.infrastructureFailureCode = infrastructureFailure;
  }
  await writeExclusive(SUMMARY_PATH, summary);
  emit('DIAGNOSTIC_CONTINUATION', summary.status, {
    semanticProfile: summary.semanticProfile,
    passed: summary.passed,
    failed: summary.failed,
    notRun: summary.notRun,
    approvedGeminiFetchRequests: summary.approvedGeminiFetchRequests,
    fullNineCaseAcceptanceProven: false
  });
  if (summary.status !== 'COMPLETE') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const mode = modeFrom(process.argv.slice(2));
    if (mode === '--check') await checkMode();
    else await runMode();
  } catch (error) {
    emit('DIAGNOSTIC_CONTINUATION', 'REJECTED', { failureCode: safeCode(error, 'DIAGNOSTIC_PRECHECK_FAILED') });
    process.exitCode = 1;
  }
}
