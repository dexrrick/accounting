import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASE_IDS } from '../evaluation/singapore/iras-first-targeted-acceptance-v4.mjs';
import { checkGeminiRemediation, createIsolatedGeminiHttpsFetch, runGeminiRemediation, validateUsageSnapshot }
  from '../../scripts/rerun_gemini_remediation.mjs';
import { executeStructuredLlmCall, GEMINI_EXTENDED_RETRY_POLICY } from '../../src/services/aiTransport.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_ROOT = path.join(ROOT, 'artifacts/gemini-remediation-2026-10-09');
const NOW = new Date('2026-10-09T08:00:00.000Z');
const validUsage = () => ({ sourceTool: 'mcp__codex_app__get_usage_limits', observedAtUtc: '2026-10-09T07:59:00.000Z',
  toolResult: { ordinaryUsageAllowed: true, rateLimitsByLimitId: { codex: {
    primary: { remainingPercent: 25 }, secondary: { remainingPercent: 20 } } } } });
const outputPath = () => path.join(OUT_ROOT, `live-rerun-test-${randomUUID()}`);
const PROVIDER_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent';
const PROVIDER_HOST = new URL(PROVIDER_URL).hostname;

function mockHttpsRequest({ status = 200, chunks = ['{}'], responseError, onRequest = () => {} } = {}) {
  const requests = [];
  const request = (url, options, callback) => {
    const req = new EventEmitter();
    req.destroyed = false;
    req.destroy = () => { req.destroyed = true; };
    req.end = body => {
      const row = { url: String(url), options, body: Buffer.from(body) };
      requests.push(row);
      onRequest(row, req);
      if (responseError === 'request') return queueMicrotask(() => req.emit('error', new Error('private request detail')));
      queueMicrotask(() => {
        const response = new EventEmitter();
        response.statusCode = status;
        response.statusMessage = status === 200 ? 'OK' : 'Provider Error';
        response.headers = { 'content-type': 'application/json' };
        response.destroyed = false;
        response.destroy = () => { response.destroyed = true; };
        response.resume = () => { response.resumed = true; };
        callback(response);
        if (responseError === 'stream') return response.emit('error', new Error('private stream detail'));
        for (const chunk of chunks) response.emit('data', Buffer.from(chunk));
        response.emit('end');
      });
    };
    return req;
  };
  return { request, requests };
}

const validProviderInit = (overrides = {}) => ({ method: 'POST',
  headers: { 'content-type': 'application/json', 'x-goog-api-key': 'test-key-only-not-a-real-secret' },
  body: '{"contents":[]}', redirect: 'error', credentials: 'omit', ...overrides });

test('isolated diagnostic HTTPS adapter uses one-shot TLS, preserves provider statuses, and bounds requests', async () => {
  const controller = new AbortController();
  const mock = mockHttpsRequest({ status: 400, chunks: ['{"error":{"code":400}}'] });
  const fetch = createIsolatedGeminiHttpsFetch({ request: mock.request });
  const response = await fetch(PROVIDER_URL, validProviderInit({ signal: controller.signal }));
  assert.equal(response.status, 400, 'Non-2xx provider responses are returned for the existing API error handler.');
  assert.equal(await response.text(), '{"error":{"code":400}}');
  assert.equal(mock.requests.length, 1);
  assert.equal(mock.requests[0].url, PROVIDER_URL);
  assert.equal(mock.requests[0].options.agent, false, 'Every provider dispatch receives a fresh non-pooled connection.');
  assert.equal(mock.requests[0].options.signal, controller.signal);
  assert.equal(Object.hasOwn(mock.requests[0].options, 'rejectUnauthorized'), false,
    'The adapter leaves Node TLS certificate verification at its secure default.');
  assert.equal(mock.requests[0].options.headers['content-length'], String(Buffer.byteLength('{"contents":[]}')));
  assert.equal(mock.requests[0].options.headers.cookie, undefined, 'No cookie header is sent.');

  await assert.rejects(fetch('https://generativelanguage.googleapis.com/other', validProviderInit()), /fetch failed/);
  await assert.rejects(fetch(PROVIDER_URL, validProviderInit({ headers: {
    'content-type': 'application/json', 'x-goog-api-key': 'test-key-only-not-a-real-secret', cookie: 'session=secret'
  } })), /fetch failed/);
  const capped = createIsolatedGeminiHttpsFetch({ request: mock.request, maxRequestBytes: 3 });
  await assert.rejects(capped(PROVIDER_URL, validProviderInit({ body: 'four' })), /fetch failed/);
  assert.equal(mock.requests.length, 1, 'Rejected endpoint, cookie, and oversized bodies never dispatch.');
});

test('isolated diagnostic HTTPS adapter rejects redirects, cancellation, and response stream failures cleanly', async () => {
  const redirectMock = mockHttpsRequest({ status: 302, chunks: ['redirect'] });
  const redirectFetch = createIsolatedGeminiHttpsFetch({ request: redirectMock.request });
  await assert.rejects(redirectFetch(PROVIDER_URL, validProviderInit()), /fetch failed/);

  let pendingRequest;
  const pending = (url, options, callback) => {
    const req = new EventEmitter();
    req.destroyed = false;
    req.destroy = () => { req.destroyed = true; };
    req.end = () => {};
    pendingRequest = { options, req, callback };
    return req;
  };
  const controller = new AbortController();
  const pendingFetch = createIsolatedGeminiHttpsFetch({ request: pending });
  const canceled = pendingFetch(PROVIDER_URL, validProviderInit({ signal: controller.signal }));
  controller.abort();
  await assert.rejects(canceled, error => error.name === 'AbortError');
  assert.equal(pendingRequest.options.agent, false);
  assert.equal(pendingRequest.options.signal, controller.signal);
  assert.equal(pendingRequest.req.destroyed, true, 'Abort destroys the in-flight socket request.');
  const lateResponse = new EventEmitter();
  lateResponse.destroyed = false;
  lateResponse.destroy = () => { lateResponse.destroyed = true; };
  pendingRequest.callback(lateResponse);
  assert.equal(lateResponse.destroyed, true, 'A response callback arriving after abort is revoked and destroyed.');

  let failedRequest;
  const requestFailureMock = mockHttpsRequest({ responseError: 'request', onRequest: (_row, request) => { failedRequest = request; } });
  const requestFailureFetch = createIsolatedGeminiHttpsFetch({ request: requestFailureMock.request });
  await assert.rejects(requestFailureFetch(PROVIDER_URL, validProviderInit()), error => error.message === 'fetch failed');
  assert.equal(failedRequest.destroyed, true, 'A request stream failure destroys its socket.');

  const streamMock = mockHttpsRequest({ responseError: 'stream' });
  const streamFetch = createIsolatedGeminiHttpsFetch({ request: streamMock.request });
  await assert.rejects(streamFetch(PROVIDER_URL, validProviderInit()), error =>
    error.message === 'fetch failed' && !error.message.includes('private'));

  const oversizedMock = mockHttpsRequest({ chunks: ['12345'] });
  const oversizedFetch = createIsolatedGeminiHttpsFetch({ request: oversizedMock.request, maxResponseBytes: 4 });
  await assert.rejects(oversizedFetch(PROVIDER_URL, validProviderInit()), /fetch failed/);
  assert.equal(oversizedMock.requests.length, 1);
});

test('default HTTPS adapter gets one private endpoint-bound dispatch token that expires before response parsing', async () => {
  const originals = { httpRequest: http.request, httpGet: http.get, httpsRequest: https.request, httpsGet: https.get,
    netConnect: net.connect, netCreateConnection: net.createConnection, socketConnect: net.Socket.prototype.connect,
    tlsConnect: tls.connect };
  const output = outputPath();
  await mkdir(OUT_ROOT, { recursive: true });
  let nativeHttpsRequests = 0;
  let approvedTlsCalls = 0;
  let approvedNetCalls = 0;
  let approvedSocketCalls = 0;
  let postFetchChecks = 0;
  let pacingClock = 0;
  const responseJson = JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"issues":[]}' }] } }] });
  const commonHeaders = { 'content-type': 'application/json', 'x-goog-api-key': 'test-key-only-not-a-real-secret' };
  https.request = (rawUrl, options, callback) => {
    nativeHttpsRequests += 1;
    assert.equal(String(rawUrl), PROVIDER_URL);
    assert.equal(options.agent, false);
    assert.equal(options.method, 'POST');
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = body => {
      assert.equal(Buffer.byteLength(body), Number(options.headers['content-length']));
      if (nativeHttpsRequests === 1) {
        assert.throws(() => https.request('https://attacker.example/path', options, () => {}), /GEMINI_DIAGNOSTIC_NETWORK_BLOCKED/,
          'A live token rejects a wrong endpoint before native dispatch.');
        assert.throws(() => https.request(PROVIDER_URL, options, () => {}), /GEMINI_DIAGNOSTIC_NETWORK_BLOCKED/,
          'A live token authorizes only one raw HTTPS request.');
        assert.throws(() => tls.connect({ host: 'attacker.example', port: 443 }), /GEMINI_DIAGNOSTIC_NETWORK_BLOCKED/,
          'A live token rejects TLS to an unrelated host.');
        assert.throws(() => net.connect({ host: 'attacker.example', port: 443 }), /GEMINI_DIAGNOSTIC_NETWORK_BLOCKED/,
          'A live token rejects sockets to an unrelated host.');
        assert.equal(tls.connect({ host: PROVIDER_HOST, servername: PROVIDER_HOST, port: 443 }), 'APPROVED_TLS_STUB');
        assert.equal(net.connect({ host: PROVIDER_HOST, port: 443 }), 'APPROVED_NET_STUB');
        const socket = new net.Socket();
        assert.equal(socket.connect({ host: PROVIDER_HOST, port: 443 }), 'APPROVED_SOCKET_STUB');
        socket.destroy();
      }
      queueMicrotask(() => {
        const response = new EventEmitter();
        response.statusCode = 200;
        response.statusMessage = 'OK';
        response.headers = { 'content-type': 'application/json' };
        response.destroy = () => {};
        response.resume = () => {};
        callback(response);
        response.emit('data', Buffer.from(responseJson));
        response.emit('end');
      });
    };
    return request;
  };
  tls.connect = () => { approvedTlsCalls += 1; return 'APPROVED_TLS_STUB'; };
  net.connect = () => { approvedNetCalls += 1; return 'APPROVED_NET_STUB'; };
  net.createConnection = () => { throw new Error('unexpected native socket path'); };
  net.Socket.prototype.connect = () => { approvedSocketCalls += 1; return 'APPROVED_SOCKET_STUB'; };

  try {
    const transport = async (...args) => {
      assert.equal(args[3]?.timeoutMs, GEMINI_EXTENDED_RETRY_POLICY.perAttemptTimeoutMs,
        'The diagnostic launcher selects the extended per-attempt timeout.');
      assert.equal(args[3]?.geminiRetryBudget, 'EXTENDED',
        'The diagnostic launcher opts into the extended retry budget explicitly.');
      const text = await executeStructuredLlmCall(...args);
      if (postFetchChecks === 0) {
        postFetchChecks += 1;
        assert.throws(() => https.request(PROVIDER_URL, { method: 'POST', agent: false, headers: commonHeaders }, () => {}),
          /GEMINI_DIAGNOSTIC_NETWORK_BLOCKED/, 'The token is revoked after fetch resolves even while the case context remains active.');
        assert.throws(() => https.request('https://attacker.example/path', { method: 'POST', agent: false, headers: commonHeaders }, () => {}),
          /GEMINI_DIAGNOSTIC_NETWORK_BLOCKED/);
        assert.throws(() => https.get(PROVIDER_URL, () => {}), /GEMINI_DIAGNOSTIC_NETWORK_BLOCKED/);
        assert.throws(() => http.request('http://attacker.example/path'), /GEMINI_DIAGNOSTIC_NETWORK_BLOCKED/);
        assert.throws(() => http.get('http://attacker.example/path'), /GEMINI_DIAGNOSTIC_NETWORK_BLOCKED/);
        assert.throws(() => net.connect({ host: PROVIDER_HOST, port: 443 }), /GEMINI_DIAGNOSTIC_NETWORK_BLOCKED/);
        assert.throws(() => net.createConnection({ host: PROVIDER_HOST, port: 443 }), /GEMINI_DIAGNOSTIC_NETWORK_BLOCKED/);
        assert.throws(() => tls.connect({ host: PROVIDER_HOST, port: 443 }), /GEMINI_DIAGNOSTIC_NETWORK_BLOCKED/);
        const socket = new net.Socket();
        assert.throws(() => socket.connect({ host: PROVIDER_HOST, port: 443 }), /GEMINI_DIAGNOSTIC_NETWORK_BLOCKED/);
        socket.destroy();
      }
      return text;
    };
    const summary = await runGeminiRemediation({ outputDirectory: path.relative(ROOT, output), usageSnapshot: validUsage(), now: NOW,
      dependencies: { apiKey: 'test-key-only-not-a-real-secret', executeStructuredLlmCall: transport,
        clock: () => pacingClock, sleep: async ms => { pacingClock += ms; },
        runV4AcceptanceCase: async request => {
          const text = await request.sendSemantic({ caseId: request.caseId, prompt: 'fixed prompt', system: 'fixed system',
            options: { jsonMode: true, responseJsonSchema: { type: 'object' }, temperature: 0,
              timeoutMs: GEMINI_EXTENDED_RETRY_POLICY.perAttemptTimeoutMs } });
          assert.equal(text, '{"issues":[]}');
          return { caseId: request.caseId, interpretation: { accepted: true },
            semanticUnderstanding: { assessmentStatus: 'PASSED' },
            stageVerdicts: { SEMANTIC_VALIDATION: true, OVERALL_STATUS: true }, productionDiagnostics: {} };
        } } });
    assert.equal(summary.providerRequestCount, 9, 'Rejected raw calls do not count as provider fetch attempts.');
    assert.equal(nativeHttpsRequests, 9, 'Each validated fetch makes exactly one raw HTTPS request.');
    assert.equal(approvedTlsCalls, 1);
    assert.equal(approvedNetCalls, 1);
    assert.equal(approvedSocketCalls, 1);
    assert.equal(postFetchChecks, 1);
    assert.ok(summary.blockedNetworkAttemptCount >= 13, 'Wrong-endpoint, duplicate, and post-fetch raw calls are blocked.');
    assert.equal(summary.newSourceRequests, 0);
  } finally {
    http.request = originals.httpRequest; http.get = originals.httpGet;
    https.request = originals.httpsRequest; https.get = originals.httpsGet;
    net.connect = originals.netConnect; net.createConnection = originals.netCreateConnection;
    net.Socket.prototype.connect = originals.socketConnect; tls.connect = originals.tlsConnect;
    assert.equal(path.dirname(path.resolve(output)), OUT_ROOT);
    await rm(output, { recursive: true, force: true });
  }
});

test('usage snapshot requires fresh ordinary allowance and both reserve floors', () => {
  assert.equal(validateUsageSnapshot(validUsage(), NOW).primaryRemainingPercent, 25);
  assert.throws(() => validateUsageSnapshot({ ...validUsage(), observedAtUtc: '2026-10-09T07:54:00.000Z' }, NOW), /USAGE_SNAPSHOT_STALE/);
  const low = validUsage();
  low.toolResult.rateLimitsByLimitId.codex.secondary.remainingPercent = 9;
  assert.throws(() => validateUsageSnapshot(low, NOW), /USAGE_RESERVE_TOO_LOW/);
});

test('--check validates retained evidence without reading credentials or calling transports', async () => {
  let credentialReads = 0;
  const outputDirectory = path.relative(ROOT, outputPath());
  const result = await checkGeminiRemediation({ outputDirectory, usageSnapshot: validUsage(), now: NOW,
    dependencies: { readApiKey() { credentialReads += 1; throw new Error('should not be called'); } } });
  assert.equal(result.ready, true);
  assert.equal(result.credentialRead, false);
  assert.equal(credentialReads, 0);
  assert.equal(result.providerRequests, 0);
  assert.equal(result.sourceRequests, 0);
});

test('--check CLI prints a successful check result', async () => {
  const tag = randomUUID();
  const usageFile = path.join(OUT_ROOT, `usage-test-${tag}.json`);
  const outputDirectory = path.join(OUT_ROOT, `live-rerun-cli-test-${tag}`);
  const temporaryDirectory = path.join(OUT_ROOT, `tmp-${tag}`);
  await mkdir(OUT_ROOT, { recursive: true });
  await mkdir(temporaryDirectory);
  const cliUsage = validUsage();
  cliUsage.observedAtUtc = new Date(Date.now() - 60_000).toISOString();
  try {
    await writeFile(usageFile, JSON.stringify(cliUsage));
    const result = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/tsx/dist/cli.mjs'),
      path.join(ROOT, 'scripts/rerun_gemini_remediation.mjs'), '--check', '--output', path.relative(ROOT, outputDirectory),
      '--usage', path.relative(ROOT, usageFile)], { cwd: ROOT, encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, TEMP: temporaryDirectory, TMP: temporaryDirectory } });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const cliResult = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(cliResult.ready, true);
    assert.equal(cliResult.caseCount, 9);
    assert.equal(cliResult.credentialRead, false);
  } finally {
    await rm(usageFile, { force: true });
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('one-shot run retries a 503 once, keeps source reads offline, and continues after a case failure', async () => {
  const output = outputPath();
  await mkdir(OUT_ROOT, { recursive: true });
  let fakeClock = 0;
  let nativeRequests = 0;
  const nativeUrls = [];
  const caseCalls = [];
  let allowedTlsCalls = 0;
  const originalTlsConnect = tls.connect;
  tls.connect = function () { allowedTlsCalls += 1; return 'TLS_STUB_ALLOWED'; };
  const usage = validUsage();
  const responseText = '{"issues":[]}';
  const nativeFetch = async (url, init) => {
    nativeRequests += 1;
    nativeUrls.push(String(url));
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    if (nativeRequests === 1) return new Response('{"error":{"code":503}}', { status: 503 });
    if (nativeRequests === 3) return new Response('{"error":{"code":400}}', { status: 400 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: responseText }] } }] }), { status: 200 });
  };
  const runV4AcceptanceCase = async request => {
    caseCalls.push(request.caseId);
    let returned;
    try {
      returned = await request.sendSemantic({ caseId: request.caseId, prompt: 'fixed prompt', system: 'fixed system',
        options: { jsonMode: true, responseJsonSchema: { type: 'object' }, temperature: 0,
          timeoutMs: GEMINI_EXTENDED_RETRY_POLICY.perAttemptTimeoutMs } });
    } catch (error) {
      if (request.caseId !== CASE_IDS[1]) throw error;
    }
    if (request.caseId !== CASE_IDS[1]) assert.equal(returned, responseText);
    if (request.caseId === CASE_IDS[0]) {
      const familyRow = request.webRetriever && request.evidenceTransport;
      assert.ok(familyRow);
      const chosen = request.evidenceTransport;
      // Exercise the explicitly supplied captured transport; no source request
      // reaches native fetch or an external HTTP client.
      const captureInventory = (await readFile(path.join(ROOT,
        'artifacts/iras-v4-acceptance-repaired-2026-10-06/post-repair-2026-10-08/preparation/activation-configuration.json'), 'utf8'));
      const inventory = JSON.parse(captureInventory).captureInventory;
      const row = inventory.find(item => item.provenance.caseIds.includes(request.caseId));
      assert.ok(row);
      await chosen(row.url, { method: 'GET', redirect: 'manual', headers: row.headers });
      await assert.rejects(globalThis.fetch('https://www.iras.gov.sg/not-in-capture'), /GEMINI_DIAGNOSTIC_NETWORK_BLOCKED/);
      assert.throws(() => tls.connect(), /GEMINI_DIAGNOSTIC_NETWORK_BLOCKED/,
        'native TLS is blocked outside an approved provider dispatch');
    }
    if (request.caseId === CASE_IDS[1]) {
      await assert.rejects(request.evidenceTransport('https://www.iras.gov.sg/not-in-capture', {
        method: 'GET', redirect: 'manual', headers: { accept: 'text/plain, application/json, text/html, */*' }
      }), /OFFLINE_REQUEST_OUTSIDE_CAPTURE_INVENTORY/);
      return { caseId: request.caseId, interpretation: undefined,
        semanticUnderstanding: { failure: 'PROVIDER_ERROR', transportError: 'V4_PROVIDER_HTTP_400', assessmentStatus: 'NOT_ASSESSED' },
        stageVerdicts: { SEMANTIC_VALIDATION: false }, productionDiagnostics: {} };
    }
    return { caseId: request.caseId, interpretation: { accepted: true },
      semanticUnderstanding: { assessmentStatus: 'PASSED' },
      stageVerdicts: { SEMANTIC_VALIDATION: true, GOVERNED_RETRIEVAL: true, OVERALL_STATUS: true },
      productionDiagnostics: {} };
  };
  const sleep = async milliseconds => { fakeClock += milliseconds; };
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const summary = await runGeminiRemediation({ outputDirectory: path.relative(ROOT, output), usageSnapshot: usage,
      now: NOW, dependencies: { apiKey: 'test-key-only-not-a-real-secret', nativeFetch, runV4AcceptanceCase,
        clock: () => fakeClock, sleep } });
    assert.equal(summary.cases.length, 9);
    assert.deepEqual(summary.semanticTimingPolicy, GEMINI_EXTENDED_RETRY_POLICY,
      'The run summary labels the diagnostic-only extended timing policy.');
    assert.deepEqual(caseCalls, CASE_IDS);
    assert.equal(summary.providerRequestCount, 10);
    assert.equal(nativeRequests, 10);
    assert.equal(allowedTlsCalls, 0, 'The injected fetch seam makes no native TLS calls and receives no raw TLS permission.');
    assert.ok(nativeUrls.every(url => url === 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent'));
    assert.equal(summary.newSourceRequests, 0);
    assert.ok(summary.blockedNetworkAttemptCount >= 1);
    assert.equal(summary.cases[0].providerAttempts[0].status, 503);
    assert.equal(summary.cases[0].providerAttempts[0].retryScheduled, true);
    assert.equal(summary.cases[0].providerAttempts[1].status, 200);
    assert.equal(summary.cases[0].semanticResponse.base64, Buffer.from(responseText).toString('base64'));
    assert.equal(summary.cases[1].failureCode, 'OFFLINE_REQUEST_OUTSIDE_CAPTURE_INVENTORY');
    assert.deepEqual(summary.cases[1].failureDiagnostics.failureChain.map(item => item.stage), ['PROVIDER', 'RETRIEVAL_INTEGRITY']);
    assert.equal(summary.cases[2].status, 'PASSED');
    const firstStarts = summary.cases.map(row => row.providerRequests[0]?.startedAtMonotonicMs).filter(Number.isFinite);
    assert.equal(firstStarts.length, 9);
    assert.ok(firstStarts.slice(1).every((startedAt, index) => startedAt - firstStarts[index] >= 15_250),
      'actual first provider starts respect the minimum interval');
    assert.ok(summary.productionCodeSha256['src/services/groundingContextBuilder.ts']);
    const journal = (await readFile(path.join(output, 'runner.partial.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(journal.length, 9);
    assert.ok(journal[0].stageVerdicts && journal[0].interpretation && journal[0].semanticResponse);
    await assert.rejects(runGeminiRemediation({ outputDirectory: path.relative(ROOT, output), usageSnapshot: usage, now: NOW,
      dependencies: { apiKey: 'test-key-only-not-a-real-secret', nativeFetch, runV4AcceptanceCase } }), /OUTPUT_ALREADY_EXISTS/);
    assert.equal(nativeRequests, 10, 'one-shot rejection must precede provider calls');
  } finally {
    Math.random = originalRandom;
    tls.connect = originalTlsConnect;
    assert.equal(path.dirname(path.resolve(output)), OUT_ROOT);
    await rm(output, { recursive: true, force: true });
  }
});
