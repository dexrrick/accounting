// One-shot diagnostic rerun for the fixed V4 Gemini cases. --check is API-free;
// --run is deliberately explicit and requires a fresh usage snapshot.
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { readFile, mkdir, open, access } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CASE_IDS, RESOURCE_POLICY, createRequestBudgetGuard, readV4Contract } from '../tests/evaluation/singapore/iras-first-targeted-acceptance-v4.mjs';
import { bindProductionControlledRetriever, captureInventoryDigest, CASE_EVIDENCE_FAMILY,
  validateActivationInventory, validateCapturePayload } from './iras_v4_capture_replay_runner.mjs';
import { runV4AcceptanceCase } from './iras_v4_production_acceptance_adapter.mjs';
import { diagnoseGeminiCaseFailure } from './gemini_failure_diagnostics.mjs';
import { executeStructuredLlmCall, GEMINI_EXTENDED_RETRY_POLICY } from '../src/services/aiTransport.ts';
import { SourceCache } from '../src/retrieval/sourceCache.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_ROOT = 'artifacts/gemini-remediation-2026-10-09';
const MODEL = 'gemini-3.5-flash-lite';
const PROVIDER_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const INPUTS = Object.freeze({
  original: 'artifacts/iras-v4-acceptance-repaired-2026-10-06/semantic-run-v4-post-repair-2026-10-08/runner-v4.partial.jsonl',
  originalConsumed: 'artifacts/iras-v4-acceptance-repaired-2026-10-06/semantic-run-v4-post-repair-2026-10-08/consumed-v4.json',
  remaining: 'artifacts/iras-v4-acceptance-repaired-2026-10-06/remaining-six-diagnostic-2026-10-09/results/summary.json',
  remainingJournal: 'artifacts/iras-v4-acceptance-repaired-2026-10-06/remaining-six-diagnostic-2026-10-09/results/remaining-six.partial.jsonl',
  remainingConsumed: 'artifacts/iras-v4-acceptance-repaired-2026-10-06/remaining-six-diagnostic-2026-10-09/results/consumed.json',
  activation: 'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/preparation/activation-configuration.json',
  capture: 'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/official-capture/capture-payload.json',
  lock: 'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/official-capture/evidence-lock.json'
});
const PRODUCTION_FILES = Object.freeze(['src/services/aiTransport.ts', 'src/services/semanticQuestionUnderstanding.ts',
  'src/services/groundingContextBuilder.ts']);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const jsonAt = async relative => JSON.parse(await readFile(path.join(ROOT, relative), 'utf8'));
const safeCode = error => typeof error?.message === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message)
  ? error.message : 'CASE_EXECUTION_ERROR';
const MAX_PROVIDER_REQUEST_BYTES = 512 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024;

export function createIsolatedGeminiHttpsFetch({
  request = (...args) => https.request(...args),
  maxRequestBytes = MAX_PROVIDER_REQUEST_BYTES,
  maxResponseBytes = MAX_PROVIDER_RESPONSE_BYTES
} = {}) {
  assert.ok(Number.isSafeInteger(maxRequestBytes) && maxRequestBytes > 0, 'PROVIDER_REQUEST_LIMIT_INVALID');
  assert.ok(Number.isSafeInteger(maxResponseBytes) && maxResponseBytes > 0, 'PROVIDER_RESPONSE_LIMIT_INVALID');
  const requestLimit = Math.min(maxRequestBytes, MAX_PROVIDER_REQUEST_BYTES);
  const responseLimit = Math.min(maxResponseBytes, MAX_PROVIDER_RESPONSE_BYTES);
  return async (rawUrl, init = {}) => {
    let url;
    try { url = new URL(String(rawUrl)); } catch { throw new TypeError('fetch failed'); }
    const method = String(init.method || 'GET').toUpperCase();
    if (url.toString() !== PROVIDER_URL || url.protocol !== 'https:' || method !== 'POST' ||
        init.redirect !== 'error' || init.credentials !== 'omit' ||
        init.signal && typeof init.signal.addEventListener !== 'function') throw new TypeError('fetch failed');
    const headers = new Headers(init.headers || {});
    if (!headers.get('x-goog-api-key') || headers.get('content-type') !== 'application/json' ||
        [...headers.keys()].some(name => !['content-type', 'x-goog-api-key'].includes(name))) {
      throw new TypeError('fetch failed');
    }
    let body;
    if (typeof init.body === 'string') body = Buffer.from(init.body, 'utf8');
    else if (Buffer.isBuffer(init.body)) body = init.body;
    else if (init.body instanceof Uint8Array) body = Buffer.from(init.body.buffer, init.body.byteOffset, init.body.byteLength);
    else throw new TypeError('fetch failed');
    if (body.length === 0 || body.length > requestLimit) throw new TypeError('fetch failed');
    headers.set('content-length', String(body.length));
    const signal = init.signal;
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');

    return new Promise((resolve, reject) => {
      let requestObject;
      let responseObject;
      let settled = false;
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      const fail = error => {
        if (settled) return;
        settled = true;
        cleanup();
        try { responseObject?.destroy(); } catch {}
        try { requestObject?.destroy(); } catch {}
        reject(error?.name === 'AbortError' ? error : new TypeError('fetch failed'));
      };
      const onAbort = () => fail(new DOMException('The operation was aborted.', 'AbortError'));
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        requestObject = request(url, {
          method: 'POST',
          headers: Object.fromEntries(headers.entries()),
          agent: false,
          signal
        }, response => {
          if (settled) {
            response.destroy?.();
            return;
          }
          responseObject = response;
          const status = response.statusCode;
          if (!Number.isInteger(status) || status < 200 || status > 599) return fail(new TypeError('fetch failed'));
          if (status >= 300 && status < 400) {
            response.resume?.();
            return fail(new TypeError('fetch failed'));
          }
          const chunks = [];
          let receivedBytes = 0;
          response.on('data', chunk => {
            if (settled) return;
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            receivedBytes += bytes.length;
            if (receivedBytes > responseLimit) return fail(new TypeError('fetch failed'));
            chunks.push(bytes);
          });
          response.once('error', fail);
          response.once('aborted', () => fail(new TypeError('fetch failed')));
          response.once('end', () => {
            if (settled) return;
            settled = true;
            cleanup();
            const responseHeaders = Object.fromEntries(Object.entries(response.headers || {})
              .filter(([, value]) => value !== undefined)
              .map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : String(value)]));
            const responseBody = Buffer.concat(chunks);
            resolve(new Response([204, 205, 304].includes(status) ? null : responseBody, {
              status,
              statusText: response.statusMessage,
              headers: responseHeaders
            }));
          });
        });
        requestObject.once('error', fail);
        requestObject.end(body);
      } catch { fail(new TypeError('fetch failed')); }
    });
  };
}

function extractUsage(toolResult) {
  const value = toolResult?.structuredContent || toolResult?.toolResult || toolResult || {};
  const codex = value.rateLimitsByLimitId?.codex || value.codex || {};
  const percent = row => Number.isFinite(row?.remainingPercent) ? row.remainingPercent
    : Number.isFinite(row?.usedPercent) ? 100 - row.usedPercent : undefined;
  return { ordinaryUsageAllowed: value.ordinaryUsageAllowed === true,
    primaryRemainingPercent: percent(codex.primary), secondaryRemainingPercent: percent(codex.secondary) };
}

export function validateUsageSnapshot(snapshot, now = new Date()) {
  assert.equal(snapshot?.sourceTool, 'mcp__codex_app__get_usage_limits', 'USAGE_SNAPSHOT_SOURCE_INVALID');
  const observed = Date.parse(snapshot.observedAtUtc || '');
  assert.ok(Number.isFinite(observed), 'USAGE_SNAPSHOT_TIME_INVALID');
  const age = now.getTime() - observed;
  assert.ok(age >= 0 && age <= 5 * 60_000, 'USAGE_SNAPSHOT_STALE');
  const usage = extractUsage(snapshot.toolResult);
  assert.equal(usage.ordinaryUsageAllowed, true, 'ORDINARY_USAGE_NOT_ALLOWED');
  assert.ok(usage.primaryRemainingPercent >= 10 && usage.secondaryRemainingPercent >= 10, 'USAGE_RESERVE_TOO_LOW');
  return { sourceTool: snapshot.sourceTool, observedAtUtc: snapshot.observedAtUtc, ...usage };
}

async function protectedSnapshot() {
  return Object.fromEntries(await Promise.all(Object.entries(INPUTS).map(async ([name, relative]) =>
    [name, sha256(await readFile(path.join(ROOT, relative)))])));
}

async function preflight({ now = new Date(), outputDirectory, usageSnapshot }) {
  const usage = validateUsageSnapshot(usageSnapshot, now);
  const [contract, activation, payload, lock] = await Promise.all([
    readV4Contract(), jsonAt(INPUTS.activation), jsonAt(INPUTS.capture), jsonAt(INPUTS.lock)
  ]);
  assert.deepEqual(contract.cases.map(row => row.caseId), CASE_IDS, 'FIXED_CASE_SET_MISMATCH');
  assert.equal(activation.status, 'FROZEN_ACTIVATION_CONFIGURATION', 'ACTIVATION_NOT_FROZEN');
  assert.equal(activation.frozen, true, 'ACTIVATION_NOT_FROZEN');
  assert.equal(lock.frozen, true, 'EVIDENCE_LOCK_NOT_FROZEN');
  assert.equal(lock.synthetic, false, 'EVIDENCE_LOCK_SYNTHETIC');
  assert.equal(sha256(await readFile(path.join(ROOT, INPUTS.capture))), lock.capturePayloadSha256, 'CAPTURE_LOCK_HASH_MISMATCH');
  assert.equal(sha256(await readFile(path.join(ROOT, INPUTS.activation))), lock.activationConfigurationFileSha256,
    'ACTIVATION_LOCK_HASH_MISMATCH');
  assert.equal(activation.runnerIntegrityBindingSha256, lock.runnerIntegrityBindingSha256, 'ACTIVATION_RUNNER_BINDING_MISMATCH');
  assert.equal(captureInventoryDigest(activation.captureInventory), lock.captureInventorySha256, 'LOCK_INVENTORY_HASH_MISMATCH');
  assert.equal(payload.captureInventorySha256, lock.captureInventorySha256, 'CAPTURE_INVENTORY_HASH_MISMATCH');
  assert.equal(lock.sourceReferenceDate, '2026-10-08', 'RETAINED_SOURCE_DATE_MISMATCH');
  validateActivationInventory(activation.captureInventory);
  validateCapturePayload(payload, { now, expectedIntegrityBindingSha256: lock.runnerIntegrityBindingSha256,
    expectedPreregistrationSha256: lock.preregistrationSha256,
    expectedActivationConfigurationSha256: lock.activationConfigurationSha256,
    expectedActivationConfigurationFileSha256: lock.activationConfigurationFileSha256,
    expectedCaptureInventory: activation.captureInventory, syntheticMode: false });
  if (outputDirectory) {
    const base = path.resolve(ROOT, OUTPUT_ROOT);
    const target = path.resolve(ROOT, outputDirectory);
    assert.equal(path.dirname(target), base, 'OUTPUT_PATH_OUTSIDE_APPROVED_DIRECTORY');
    assert.match(path.basename(target), /^live-rerun-[a-zA-Z0-9-]+$/, 'OUTPUT_DIRECTORY_NAME_INVALID');
    try { await access(target); throw new Error('OUTPUT_ALREADY_EXISTS'); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  return { usage, contract, activation, payload, lock };
}

function makeOfflineEvidenceTransport(payload, inventory, caseId, family) {
  const familyContext = new AsyncLocalStorage();
  let failure;
  const entries = new Map(payload.entries.filter(row => row.request.family === family)
    .map(row => [row.requestIdentitySha256, row]));
  const attempts = [];
  const assertHealthy = () => { if (failure) throw failure; };
  return { attempts, assertHealthy, withEvidenceFamily: (selected, callback) => familyContext.run(selected, callback),
    get failureCode() { return failure?.message && /^[A-Z][A-Z0-9_]{0,79}$/.test(failure.message)
      ? failure.message : failure ? 'OFFLINE_REPLAY_FAILURE' : undefined; },
    fetch: async (rawUrl, init = {}) => {
      assertHealthy();
      const selected = familyContext.getStore();
      const url = new URL(String(rawUrl));
      if (selected !== family || !['iras.gov.sg', 'www.iras.gov.sg'].includes(url.hostname) || url.protocol !== 'https:' ||
          url.username || url.password || url.port || url.hash || String(init.method || 'GET').toUpperCase() !== 'GET' ||
          init.redirect !== 'manual' || init.body != null) {
        failure ||= new Error('OFFLINE_REQUEST_POLICY_REJECTED'); throw failure;
      }
      const headers = Object.fromEntries([...new Headers(init.headers).entries()].sort(([a], [b]) => a.localeCompare(b)));
      const request = { family, url: url.toString(), method: 'GET', headers };
      const identity = sha256(JSON.stringify(request));
      const allowed = inventory.some(row => row.family === family && row.url === request.url && row.method === 'GET' &&
        JSON.stringify(row.headers) === JSON.stringify(headers) && row.provenance.caseIds.includes(caseId));
      const entry = entries.get(identity);
      attempts.push({ url: request.url, requestIdentitySha256: identity, captured: Boolean(allowed && entry) });
      if (!allowed || !entry) { failure ||= new Error('OFFLINE_REQUEST_OUTSIDE_CAPTURE_INVENTORY'); throw failure; }
      assert.deepEqual(entry.request, request);
      const body = Buffer.from(entry.bodyBase64, 'base64');
      assert.equal(sha256(body), entry.bodySha256);
      const response = new Response(body, { status: entry.status, headers: entry.headers });
      Object.defineProperty(response, 'url', { value: entry.actualUrl });
      return response;
    }
  };
}

function installNetworkGuard({ apiKey, nativeFetch, clock = () => performance.now() }) {
  const context = new AsyncLocalStorage();
  const nativeDispatchContext = new AsyncLocalStorage();
  const providerRequests = [];
  const blocked = [];
  const restorers = [];
  const providerHost = new URL(PROVIDER_URL).hostname;
  const replace = (target, key, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    assert.ok(descriptor?.configurable, 'NETWORK_GUARD_PATCH_FAILED');
    Object.defineProperty(target, key, { ...descriptor, value });
    restorers.push(() => Object.defineProperty(target, key, descriptor));
  };
  const rejectNetwork = () => {
    blocked.push({ category: 'NETWORK_POLICY_BLOCKED' });
    throw new Error('GEMINI_DIAGNOSTIC_NETWORK_BLOCKED');
  };
  const activeDispatch = () => {
    const scope = context.getStore();
    const token = nativeDispatchContext.getStore();
    return scope?.active === true && token?.active === true && token.caseId === scope.caseId &&
      token.url === PROVIDER_URL && token.apiKey === apiKey ? { scope, token } : undefined;
  };
  const providerHttpsRequestAllowed = args => {
    const urlInput = args[0];
    const options = args[1];
    if (!(typeof urlInput === 'string' || urlInput instanceof URL) || !options || typeof options !== 'object' ||
        typeof args[2] !== 'function') return false;
    const allowedOptionKeys = new Set(['method', 'headers', 'agent', 'signal', 'auth', 'protocol', 'hostname',
      'host', 'port', 'path', 'servername']);
    let url;
    try { url = new URL(String(urlInput)); } catch { return false; }
    if (url.toString() !== PROVIDER_URL || String(options.method || 'GET').toUpperCase() !== 'POST' || options.agent !== false ||
        options.auth || options.protocol && options.protocol !== 'https:' ||
        options.hostname && String(options.hostname).toLowerCase() !== providerHost ||
        options.host && String(options.host).toLowerCase() !== providerHost ||
        options.servername && String(options.servername).toLowerCase() !== providerHost ||
        options.port != null && Number(options.port) !== 443 ||
        options.path && options.path !== `${url.pathname}${url.search}` ||
        !options.signal || typeof options.signal.addEventListener !== 'function' ||
        Object.keys(options).some(name => !allowedOptionKeys.has(name))) return false;
    const headers = new Headers(options.headers || {});
    const requestBytes = Number(headers.get('content-length'));
    return headers.get('x-goog-api-key') === apiKey && headers.get('content-type') === 'application/json' &&
      Number.isSafeInteger(requestBytes) && requestBytes > 0 && requestBytes <= MAX_PROVIDER_REQUEST_BYTES &&
      [...headers.keys()].every(name => ['content-type', 'x-goog-api-key', 'content-length'].includes(name)) &&
      headers.get('cookie') === null;
  };
  const approvedDestination = args => {
    let options;
    const first = args[0];
    if (first && typeof first === 'object') options = first;
    else if (typeof first === 'number') {
      const second = args[1];
      options = second && typeof second === 'object' ? { ...second, port: second.port ?? first }
        : { port: first, host: typeof second === 'string' ? second : undefined };
    }
    if (!options) return false;
    const hosts = [options.servername, options.hostname, options.host].filter(value => value != null && value !== '')
      .map(value => String(value).toLowerCase().replace(/\.$/, ''));
    return hosts.length > 0 && hosts.every(host => host === providerHost) && Number(options.port) === 443 &&
      (options.protocol === undefined || options.protocol === 'https:');
  };
  replace(globalThis, 'fetch', async (rawUrl, init = {}) => {
    const requestContext = context.getStore();
    const url = String(rawUrl);
    const headers = new Headers(init.headers || {});
    if (!requestContext?.active || url !== PROVIDER_URL || String(init.method || 'GET').toUpperCase() !== 'POST' ||
        headers.get('x-goog-api-key') !== apiKey || !init.body || (requestContext.count || 0) >= 2 ||
        providerRequests.length >= CASE_IDS.length * 2) {
      return rejectNetwork();
    }
    requestContext.count = (requestContext.count || 0) + 1;
    const row = { caseId: requestContext.caseId, attempt: requestContext.count,
      startedAtUtc: new Date().toISOString(), startedAtMonotonicMs: clock() };
    providerRequests.push(row);
    const dispatchToken = { active: true, caseId: requestContext.caseId, url: PROVIDER_URL, apiKey,
      nativeHttpsRequestCount: 0 };
    try {
      const response = await nativeDispatchContext.run(dispatchToken, () =>
        nativeFetch(url, { ...init, redirect: 'error', credentials: 'omit' }));
      row.status = response.status;
      return response;
    } catch {
      row.failureCategory = 'NETWORK_ERROR';
      throw new TypeError('fetch failed');
    } finally {
      dispatchToken.active = false;
    }
  });
  for (const key of ['request', 'get']) replace(http, key, rejectNetwork);
  const originalHttpsRequest = Object.getOwnPropertyDescriptor(https, 'request')?.value;
  assert.equal(typeof originalHttpsRequest, 'function', 'NETWORK_GUARD_PATCH_FAILED');
  replace(https, 'request', function (...args) {
    const dispatch = activeDispatch();
    if (!dispatch || dispatch.token.nativeHttpsRequestCount !== 0 || !providerHttpsRequestAllowed(args)) return rejectNetwork();
    dispatch.token.nativeHttpsRequestCount = 1;
    return originalHttpsRequest.apply(this, args);
  });
  replace(https, 'get', rejectNetwork);
  for (const [target, keys] of [[net, ['connect', 'createConnection']], [net.Socket.prototype, ['connect']], [tls, ['connect']]]) {
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      assert.ok(descriptor?.configurable, 'NETWORK_GUARD_PATCH_FAILED');
      const original = descriptor.value;
      replace(target, key, function (...args) {
        const dispatch = activeDispatch();
        if (!dispatch || dispatch.token.nativeHttpsRequestCount !== 1 || !approvedDestination(args)) return rejectNetwork();
        return original.apply(this, args);
      });
    }
  }
  syncBuiltinESMExports();
  return { context, providerRequests, blocked, restore() {
    for (const restore of restorers.reverse()) restore();
    syncBuiltinESMExports();
  } };
}

function readLocalGeminiKey() {
  return readFile(path.join(ROOT, '.env.local'), 'utf8').then(text => {
    const line = text.split(/\r?\n/).find(row => /^\s*GEMINI_API_KEY\s*=/.test(row));
    const value = line?.replace(/^\s*GEMINI_API_KEY\s*=\s*/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
    assert.ok(value && value.length > 10, 'GEMINI_API_KEY_MISSING');
    return value;
  }).catch(error => { if (error?.message === 'GEMINI_API_KEY_MISSING') throw error; throw new Error('GEMINI_API_KEY_MISSING'); });
}

export async function runGeminiRemediation({ outputDirectory, usageSnapshot, now = new Date(), dependencies = {} } = {}) {
  const prepared = await preflight({ now, outputDirectory, usageSnapshot });
  const executionStartedAt = new Date().toISOString();
  const output = path.resolve(ROOT, outputDirectory);
  await mkdir(output);
  const consumed = await open(path.join(output, 'consumed.json'), 'wx');
  await consumed.writeFile(JSON.stringify({ profile: 'GEMINI_REMEDIATION_LIVE_DIAGNOSTIC', consumedAt: now.toISOString(), caseIds: CASE_IDS }) + '\n');
  await consumed.sync(); await consumed.close();
  const journal = await open(path.join(output, 'runner.partial.jsonl'), 'wx');
  const before = await protectedSnapshot();
  const key = dependencies.apiKey || await (dependencies.readApiKey || readLocalGeminiKey)();
  const nativeFetch = dependencies.nativeFetch || createIsolatedGeminiHttpsFetch();
  const guardClock = dependencies.clock || (() => performance.now());
  const network = installNetworkGuard({ apiKey: key, nativeFetch, clock: guardClock });
  const transport = dependencies.executeStructuredLlmCall || executeStructuredLlmCall;
  const caseRunner = dependencies.runV4AcceptanceCase || runV4AcceptanceCase;
  const cases = [];
  const budget = createRequestBudgetGuard({ caseIds: CASE_IDS, minimumStartGapMs: RESOURCE_POLICY.minimumStartGapMs,
    clock: () => guardClock(), sleep: dependencies.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms))) });
  try {
    for (const caseId of CASE_IDS) {
      const blockedStart = network.blocked.length;
      const family = CASE_EVIDENCE_FAMILY[caseId];
      const evidence = makeOfflineEvidenceTransport(prepared.payload, prepared.activation.captureInventory, caseId, family);
      const semanticResponses = [];
      const attemptDiagnostics = [];
      let adapterResult;
      let errorCode;
      let budgetConsumed = false;
      try {
        adapterResult = await evidence.withEvidenceFamily(family, () => caseRunner({
          caseId,
          referenceDate: '2026-10-08',
          evidenceTransport: evidence.fetch,
          withEvidenceFamily: evidence.withEvidenceFamily,
          webRetriever: bindProductionControlledRetriever({ transport: evidence, cache: new SourceCache() }),
          sendSemantic: async request => {
            if (budgetConsumed) throw new Error('V4_EXTRA_SEMANTIC_CALL_BLOCKED');
            budgetConsumed = true;
            const options = { ...request.options, model: MODEL,
              timeoutMs: GEMINI_EXTENDED_RETRY_POLICY.perAttemptTimeoutMs,
              retryGeminiTransientFailures: true, geminiRetryBudget: 'EXTENDED',
              captureTransportAttemptDiagnostics: attemptDiagnostics };
            const scope = { caseId, count: 0, active: true, nativeDispatchStarted: false };
            try {
              const text = await budget.invoke(caseId, () => network.context.run(scope, () => transport(request.prompt,
                request.system, { activeProvider: 'gemini', gemini: { apiKey: key, model: MODEL } }, options)));
              const bytes = Buffer.from(String(text), 'utf8');
              semanticResponses.push({ base64: bytes.toString('base64'), sha256: sha256(bytes), bytes: bytes.length });
              return text;
            } catch (error) { errorCode = safeCode(error); throw error; }
            finally { scope.active = false; }
          }
        }));
      } catch (error) { errorCode ||= safeCode(error); }
      if (!budgetConsumed) {
        budgetConsumed = true;
        try { await budget.invoke(caseId, async () => undefined); }
        catch (error) { errorCode ||= safeCode(error); }
      }
      let inventoryHealthy = true;
      try { evidence.assertHealthy(); } catch { inventoryHealthy = false; }
      if (adapterResult?.semanticUnderstanding) {
        adapterResult.semanticUnderstanding.transportAttempts = attemptDiagnostics;
        if (semanticResponses.length) adapterResult.semanticUnderstanding.response = {
          ...(adapterResult.semanticUnderstanding.response || {}),
          responseSha256: semanticResponses.at(-1).sha256, responseBytes: semanticResponses.at(-1).bytes
        };
      }
      const stageVerdicts = adapterResult?.stageVerdicts || {};
      const allStagesPassed = Object.values(stageVerdicts).length > 0 && Object.values(stageVerdicts).every(value => value === true);
      const row = { caseId, status: allStagesPassed && inventoryHealthy ? 'PASSED' : 'FAILED',
        assessmentStatus: adapterResult?.semanticUnderstanding?.assessmentStatus || 'NOT_ASSESSED',
        errorCode, inventoryHealthy, stageVerdicts, interpretation: adapterResult?.interpretation,
        semanticUnderstanding: adapterResult?.semanticUnderstanding, semanticResponse: semanticResponses.at(-1),
        providerAttempts: attemptDiagnostics, providerRequests: network.providerRequests.filter(item => item.caseId === caseId),
        blockedNetworkAttempts: network.blocked.slice(blockedStart), evidenceRequests: evidence.attempts,
        failureCode: evidence.failureCode,
        productionDiagnostics: adapterResult?.productionDiagnostics };
      row.failureDiagnostics = adapterResult
        ? diagnoseGeminiCaseFailure({ ...row, adapterResult, failureCode: evidence.failureCode })
        : { assessmentStatus: 'NOT_ASSESSED', failureChain: evidence.failureCode
          ? [{ stage: 'RETRIEVAL_INTEGRITY', code: evidence.failureCode }] : [] };
      cases.push(row);
      await journal.writeFile(JSON.stringify(row) + '\n');
      await journal.sync();
    }
  } finally {
    network.restore();
    await journal.close();
  }
  const after = await protectedSnapshot();
  const productionCodeSha256 = Object.fromEntries(await Promise.all(PRODUCTION_FILES.map(async relative =>
    [relative, sha256(await readFile(path.join(ROOT, relative)))])));
  const summary = { profile: 'GEMINI_REMEDIATION_LIVE_DIAGNOSTIC', liveProvider: true, acceptanceProven: false,
    semanticTimingPolicy: { ...GEMINI_EXTENDED_RETRY_POLICY },
    sourceEvidenceMode: 'RETAINED_CAPTURE_REPLAY', sourceReferenceDate: '2026-10-08',
    capturedAt: prepared.payload.earliestAcquisitionAt, freshOfficialAvailabilityAssessed: false, newSourceRequests: 0,
    usage: prepared.usage, executionStartedAt, model: MODEL, productionCodeSha256,
    protectedInputSha256: { before, after }, protectedInputsUnchanged: JSON.stringify(before) === JSON.stringify(after),
    providerRequestCount: network.providerRequests.length, blockedNetworkAttemptCount: network.blocked.length,
    cases, passedCaseCount: cases.filter(row => row.status === 'PASSED').length,
    failedCaseCount: cases.filter(row => row.status !== 'PASSED').length };
  const summaryFile = await open(path.join(output, 'summary.json'), 'wx');
  await summaryFile.writeFile(JSON.stringify(summary, null, 2) + '\n'); await summaryFile.sync(); await summaryFile.close();
  return summary;
}

export async function checkGeminiRemediation({ outputDirectory, usageSnapshot, now = new Date(), dependencies = {} } = {}) {
  const prepared = await preflight({ now, outputDirectory, usageSnapshot });
  // Deliberately no key lookup or provider transport is touched by --check.
  return { ready: true, caseCount: CASE_IDS.length, model: MODEL, outputDirectory,
    sourceReferenceDate: prepared.lock.sourceReferenceDate, usage: prepared.usage,
    credentialRead: false, providerRequests: 0, sourceRequests: 0, acceptanceProven: false };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--check' || key === '--run') {
      if (args.mode) throw new Error('MODE_ARGUMENT_CONFLICT');
      args.mode = key.slice(2);
    } else if (['--output', '--usage'].includes(key) && argv[i + 1]) args[key.slice(2)] = argv[++i];
    else throw new Error('CLI_ARGUMENT_INVALID');
  }
  if (!args.mode || !args.output || !args.usage) throw new Error('CLI_ARGUMENTS_REQUIRED');
  return args;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const usageSnapshot = JSON.parse(await readFile(path.resolve(ROOT, args.usage), 'utf8'));
    const outputDirectory = path.relative(ROOT, path.resolve(ROOT, args.output));
    const result = args.mode === 'check' ? await checkGeminiRemediation({ outputDirectory, usageSnapshot })
      : await runGeminiRemediation({ outputDirectory, usageSnapshot });
    console.log(JSON.stringify(args.mode === 'check' ? result : { ready: true, caseCount: result.cases.length,
      passedCaseCount: result.passedCaseCount, failedCaseCount: result.failedCaseCount,
      providerRequestCount: result.providerRequestCount, acceptanceProven: false }));
  } catch (error) {
    console.error(error?.message && /^[A-Z0-9_:-]+$/.test(error.message) ? error.message : 'GEMINI_REMEDIATION_RUN_FAILED');
    process.exitCode = 1;
  }
}
