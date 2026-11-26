import assert from 'node:assert/strict';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { handleGeminiProxyRequest } from '../../src/worker/geminiProxy.ts';
import { createRequestDeadline, throwIfRequestAborted } from '../../src/services/requestDeadline.ts';
import { TransactionUnderstandingService, defaultTransactionUnderstandingService } from '../../src/services/transactionUnderstandingService.ts';

const originalFetch = globalThis.fetch;
const waitFor = async (predicate, label) => {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(predicate(), true, label);
};

try {
  const stageTimeoutError = new Error('The extraction stage timed out.');
  stageTimeoutError.name = 'AbortError';
  const stageTimeoutService = new TransactionUnderstandingService(undefined, {
    async extract() { throw stageTimeoutError; }
  });
  const stageTimeoutQuery = 'The company received SGD 500 as a customer advance.';
  const stageTimeoutFallback = await stageTimeoutService.understandTransaction(
    stageTimeoutQuery,
    'SGD',
    'SG',
    { activeProvider: 'gemini', gemini: { apiKey: 'offline-test-gemini-key', model: 'gemini-3.5-flash-lite' }, azure: {}, openai: {} }
  );
  const deterministicUnderstanding = defaultTransactionUnderstandingService.understandTransactionSync(stageTimeoutQuery);
  assert.equal(stageTimeoutFallback.amount, deterministicUnderstanding.amount,
    'a stage-local AbortError while the shared request remains live keeps the deterministic extraction fallback');
  assert.equal(stageTimeoutFallback.transactionType, deterministicUnderstanding.transactionType);

  const deadline = createRequestDeadline();
  const originalNow = Date.now;
  try {
    Date.now = () => deadline.deadlineAt;
    assert.throws(() => throwIfRequestAborted(deadline.signal), error => error.name === 'AbortError',
      'the public stage guard expires a deadline even before a delayed timer callback runs');
    assert.equal(deadline.timedOut(), true);
  } finally {
    Date.now = originalNow;
    deadline.dispose();
  }

  const callerController = new AbortController();
  let queryCalls = 0;
  let providerSignal;
  globalThis.fetch = async (input, init = {}) => {
    queryCalls += 1;
    assert.match(String(input), /^https:\/\/generativelanguage\.googleapis\.com\//,
      'the normal Gemini query path reaches the stubbed provider transport');
    providerSignal = init.signal;
    return new Promise((_, reject) => {
      const abort = () => {
        const error = new Error('stubbed provider canceled');
        error.name = 'AbortError';
        reject(error);
      };
      if (providerSignal?.aborted) abort();
      else providerSignal?.addEventListener('abort', abort, { once: true });
    });
  };

  const query = processAccountingQuery(
    'Prepare a journal for transaction 2: acquire equipment and later dispose of it.',
    null,
    'SFRS_I',
    { activeProvider: 'gemini', gemini: { apiKey: 'offline-test-gemini-key', model: 'gemini-3.5-flash-lite' }, azure: {}, openai: {} },
    'gemini-3.5-flash-lite',
    [],
    { journal: true, statutory: false },
    undefined,
    undefined,
    callerController.signal
  );
  await waitFor(() => queryCalls > 0, 'the normal public request reaches its stubbed provider');
  assert.equal(queryCalls, 1, 'the ordinary query begins one provider request before cancellation');
  callerController.abort();
  await assert.rejects(query, error => error.name === 'AbortError',
    'caller cancellation remains a cancellation result instead of being converted to missing accounting facts');
  assert.equal(providerSignal.aborted, true, 'the caller signal reaches the in-flight provider fetch');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(queryCalls, 1, 'an aborted provider request does not start another request stage');

  const extractionController = new AbortController();
  let extractionCalls = 0;
  let extractionSignal;
  globalThis.fetch = async (input, init = {}) => {
    const requestBody = typeof init.body === 'string' ? init.body : '';
    if (requestBody.includes('Analyze the following commercial query and extract structured economic facts')) {
      extractionCalls += 1;
      extractionSignal = init.signal;
      return new Promise((_, reject) => {
        const abort = () => {
          const error = new Error('stubbed transaction extraction canceled');
          error.name = 'AbortError';
          reject(error);
        };
        if (extractionSignal?.aborted) abort();
        else extractionSignal?.addEventListener('abort', abort, { once: true });
      });
    }
    return new Response(JSON.stringify({ error: { message: 'Offline test stub' } }), { status: 503 });
  };
  const extractionQuery = processAccountingQuery(
    'Prepare journal entries for the issue of a convertible note payable for SGD 100,000 with a conversion option.',
    null,
    'SFRS_I',
    { activeProvider: 'gemini', gemini: { apiKey: 'offline-test-gemini-key', model: 'gemini-3.5-flash-lite' }, azure: {}, openai: {} },
    'gemini-3.5-flash-lite',
    [],
    { journal: true, statutory: false },
    undefined,
    undefined,
    extractionController.signal
  );
  await waitFor(() => extractionCalls > 0, 'the public query reaches transaction-fact Gemini extraction');
  extractionController.abort();
  await assert.rejects(extractionQuery, error => error.name === 'AbortError',
    'canceling transaction-fact extraction remains an AbortError');
  assert.equal(extractionSignal.aborted, true,
    'the public request cancellation reaches the in-flight transaction-fact Gemini request');

  const authorityController = new AbortController();
  let acraFetchCount = 0;
  let firstAcraSignal;
  let releaseFirstAcraFetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === 'generativelanguage.googleapis.com') {
      return new Response(JSON.stringify({ error: { message: 'Offline test stub' } }), { status: 503 });
    }
    if (url.hostname === 'www.acra.gov.sg') {
      acraFetchCount += 1;
      if (acraFetchCount === 1) {
        firstAcraSignal = init.signal;
        return new Promise(resolve => {
          releaseFirstAcraFetch = () => resolve(new Response(
            '<html><head><title>ACRA</title></head><body><main>Company filing information.</main></body></html>',
            { status: 200, headers: { 'content-type': 'text/html' } }
          ));
        });
      }
      return new Response('Offline test stub', { status: 503 });
    }
    return new Response('Offline test stub', { status: 503 });
  };
  const authorityQuery = processAccountingQuery(
    'What does ACRA require when a Singapore company changes its registered office address?',
    null,
    'SFRS_I',
    { activeProvider: 'gemini', gemini: { apiKey: 'offline-test-gemini-key', model: 'gemini-3.5-flash-lite' }, azure: {}, openai: {} },
    'gemini-3.5-flash-lite',
    [],
    undefined,
    undefined,
    undefined,
    authorityController.signal
  );
  await waitFor(() => typeof releaseFirstAcraFetch === 'function',
    'the public ACRA query reaches its first official-source fetch');
  authorityController.abort();
  await assert.rejects(authorityQuery, error => error.name === 'AbortError',
    'canceling ACRA retrieval rejects the public query as an abort');
  assert.equal(firstAcraSignal.aborted, true,
    'the shared request cancellation reaches the in-flight ACRA source request');
  releaseFirstAcraFetch();
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(acraFetchCount, 1,
    'a late first ACRA response cannot advance the canceled request to more source fetches');

  const endpoint = 'https://app.example.test/api/gemini/v1beta/models/gemini-3.5-flash-lite:generateContent';
  const proxyToken = 'offline-test-proxy-token-with-enough-length';
  const env = {
    GEMINI_API_KEY: 'offline-test-upstream-secret',
    GEMINI_PROXY_TOKEN: proxyToken,
    GEMINI_RATE_LIMITER: { limit: async () => ({ success: true }) }
  };
  const makeRequest = (signal, headers = {}) => new Request(endpoint, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-gemini-proxy-token': proxyToken, ...headers },
    body: JSON.stringify({ contents: [{ parts: [{ text: 'offline test' }] }] })
  });
  const waitForUpstreamAbort = () => {
    let upstreamSignal;
    let upstreamAborted = false;
    globalThis.fetch = async (_input, init) => {
      upstreamSignal = init.signal;
      const body = new ReadableStream({
        start(controller) {
          const abort = () => {
            upstreamAborted = true;
            const error = new Error('stubbed upstream canceled');
            error.name = 'AbortError';
            controller.error(error);
          };
          if (upstreamSignal.aborted) abort();
          else upstreamSignal.addEventListener('abort', abort, { once: true });
        }
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    };
    return { get upstreamSignal() { return upstreamSignal; }, get upstreamAborted() { return upstreamAborted; } };
  };

  const timeoutTransport = waitForUpstreamAbort();
  const stalledUpload = new Request(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-gemini-proxy-token': proxyToken,
      'x-gemini-request-timeout-ms': '25'
    },
    body: new ReadableStream({ start() {} }),
    duplex: 'half'
  });
  const uploadTimeout = await handleGeminiProxyRequest(stalledUpload, env);
  assert.equal(uploadTimeout.status, 504, 'the bounded proxy deadline also covers a stalled incoming body');
  assert.equal(timeoutTransport.upstreamSignal, undefined, 'a timed-out upload never starts an upstream request');

  const timeoutResponse = await handleGeminiProxyRequest(
    makeRequest(undefined, { 'x-gemini-request-timeout-ms': '25' }), env
  );
  assert.equal(timeoutResponse.status, 200, 'the proxy preserves the authorized upstream response status');
  const timeoutReader = timeoutResponse.body.getReader();
  const timeoutRead = timeoutReader.read();
  await assert.rejects(timeoutRead, /stubbed upstream canceled/,
    'the proxy deadline also covers a response body that stalls after headers');
  assert.equal(timeoutTransport.upstreamSignal.aborted, true, 'the bounded proxy timeout aborts its upstream fetch');
  assert.equal(timeoutTransport.upstreamAborted, true);

  const clientController = new AbortController();
  const clientTransport = waitForUpstreamAbort();
  const clientResponse = await handleGeminiProxyRequest(makeRequest(clientController.signal), env);
  const clientRead = clientResponse.body.getReader().read();
  clientController.abort();
  await assert.rejects(clientRead, /stubbed upstream canceled/,
    'a disconnected client cancels proxy response-body reading');
  assert.equal(clientTransport.upstreamSignal.aborted, true, 'client disconnect reaches the upstream Gemini fetch');
  assert.equal(clientTransport.upstreamAborted, true);

  console.log('Whole-request deadline and Gemini proxy cancellation regressions passed.');
} finally {
  globalThis.fetch = originalFetch;
}
