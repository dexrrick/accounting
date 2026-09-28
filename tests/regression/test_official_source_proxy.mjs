import assert from 'node:assert/strict';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { handleOfficialSourceProxyRequest, OFFICIAL_SOURCE_PROXY_PATH } from '../../src/retrieval/officialSourceProxy.ts';
import { fetchOfficialSourceSameOrigin } from '../../src/retrieval/officialSourceTransport.ts';
import { OfficialDomainSearchAdapter } from '../../src/retrieval/officialSitemapDiscovery.ts';
import { RequestProfiler, projectOfficialSourceFallbackDiagnostics } from '../../src/services/telemetry.ts';
import { compileFeedbackReport } from '../../src/services/feedback.ts';

const endpointUrl = `https://accounting.example${OFFICIAL_SOURCE_PROXY_PATH}`;
const irasUrl = 'https://www.iras.gov.sg/basics-of-individual-income-tax/income-received-from-overseas';
const html = '<!doctype html><html><head><title>IRAS page</title></head><body><main><h1>IRAS page</h1><p>Official content.</p></main></body></html>';

function endpointRequest(url, extra = {}) {
  return new Request(endpointUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extra.headers },
    body: JSON.stringify(extra.payload ?? { url })
  });
}

async function decodeEnvelope(response) {
  return response.json();
}

for (const url of [
  'http://www.iras.gov.sg/page',
  'https://user:password@www.iras.gov.sg/page',
  'https://www.iras.gov.sg:8443/page',
  'https://evil.example/page',
  'https://127.0.0.1/page',
  'https://api.frankfurter.dev/latest?from=SGD&to=USD'
]) {
  let fetched = false;
  const response = await handleOfficialSourceProxyRequest(endpointRequest(url), async () => {
    fetched = true;
    return new Response('unexpected');
  });
  assert.equal(response.status, 400, `proxy rejected ${url}`);
  assert.equal(fetched, false, `proxy did not fetch ${url}`);
}

assert.equal((await handleOfficialSourceProxyRequest(endpointRequest(irasUrl, { payload: { url: irasUrl, headers: { authorization: 'secret' } } }))).status, 400,
  'proxy accepts only the single URL field');
assert.equal((await handleOfficialSourceProxyRequest(endpointRequest('https://www.iras.gov.sg/page', { headers: { origin: 'https://attacker.example' } }))).status, 403,
  'cross-origin requests are rejected');

let observedUpstreamHeaders;
const successfulProxyResponse = await handleOfficialSourceProxyRequest(endpointRequest(irasUrl, {
  headers: { cookie: 'private-cookie', authorization: 'private-token', 'x-extra': 'private-header' }
}), async (input, init) => {
  assert.equal(input, irasUrl);
  assert.equal(init.method, 'GET');
  assert.equal(init.redirect, 'manual');
  observedUpstreamHeaders = Object.fromEntries(new Headers(init.headers));
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      etag: '"version-1"',
      'last-modified': 'Mon, 01 Sep 2025 00:00:00 GMT',
      'set-cookie': 'should-not-be-forwarded'
    }
  });
});
const successfulEnvelope = await decodeEnvelope(successfulProxyResponse);
assert.equal(successfulProxyResponse.status, 200);
assert.equal(successfulEnvelope.officialUrl, irasUrl);
assert.equal(successfulEnvelope.upstreamStatus, 200);
assert.equal(successfulEnvelope.headers['content-type'], 'text/html; charset=utf-8');
assert.equal(successfulEnvelope.headers.etag, '"version-1"');
assert.equal(successfulEnvelope.headers['last-modified'], 'Mon, 01 Sep 2025 00:00:00 GMT');
assert.equal(successfulEnvelope.headers['set-cookie'], undefined);
assert.equal(successfulEnvelope.body, html);
assert.deepEqual(observedUpstreamHeaders, {
  accept: 'text/html, text/plain, application/xhtml+xml, application/xml;q=0.9, */*;q=0.1'
});

const rejectedRedirect = await handleOfficialSourceProxyRequest(endpointRequest(irasUrl), async () => new Response(null, {
  status: 302,
  headers: { location: 'https://evil.example/steal' }
}));
assert.equal((await decodeEnvelope(rejectedRedirect)).transportFailure, 'REDIRECT_REJECTED');
const acceptedRedirect = await handleOfficialSourceProxyRequest(endpointRequest(irasUrl), async () => new Response(null, {
  status: 302,
  headers: { location: '/basics-of-individual-income-tax/income-received-from-overseas' }
}));
const acceptedRedirectEnvelope = await decodeEnvelope(acceptedRedirect);
assert.equal(acceptedRedirectEnvelope.headers.location, 'https://www.iras.gov.sg/basics-of-individual-income-tax/income-received-from-overseas');

const notModified = await handleOfficialSourceProxyRequest(endpointRequest(irasUrl), async () => new Response(null, {
  status: 304,
  headers: { etag: '"cached-version"' }
}));
assert.equal((await decodeEnvelope(notModified)).upstreamStatus, 304, '304 is not mistaken for a redirect');
const followedOffsiteResponse = new Response(html, { headers: { 'content-type': 'text/html' } });
Object.defineProperty(followedOffsiteResponse, 'url', { value: 'https://evil.example/final' });
const rejectedFollowedRedirect = await handleOfficialSourceProxyRequest(endpointRequest(irasUrl), async () => followedOffsiteResponse);
assert.equal((await decodeEnvelope(rejectedFollowedRedirect)).transportFailure, 'REDIRECT_REJECTED',
  'server validates final response URLs even if an injected fetcher followed redirects');

const conditionalRequest = endpointRequest(irasUrl, {
  payload: { url: irasUrl, ifNoneMatch: '"version-1"', ifModifiedSince: 'Mon, 01 Sep 2025 00:00:00 GMT' }
});
let conditionalUpstreamHeaders;
const conditionalResponse = await handleOfficialSourceProxyRequest(conditionalRequest, async (_input, init) => {
  conditionalUpstreamHeaders = Object.fromEntries(new Headers(init.headers));
  return new Response(null, { status: 304, headers: { etag: '"version-1"' } });
});
assert.equal((await decodeEnvelope(conditionalResponse)).upstreamStatus, 304);
assert.equal(conditionalUpstreamHeaders['if-none-match'], '"version-1"');
assert.equal(conditionalUpstreamHeaders['if-modified-since'], 'Mon, 01 Sep 2025 00:00:00 GMT');
assert.equal((await handleOfficialSourceProxyRequest(endpointRequest(irasUrl, {
  payload: { url: irasUrl, ifNoneMatch: 'safe\r\nAuthorization: injected' }
}))).status, 400, 'conditional values reject header injection');

const oversized = await handleOfficialSourceProxyRequest(endpointRequest(irasUrl), async () => new Response('12345'), { responseBytes: 4 });
assert.equal((await decodeEnvelope(oversized)).transportFailure, 'NETWORK_ERROR', 'oversized official content fails closed');
const timedOut = await handleOfficialSourceProxyRequest(endpointRequest(irasUrl), async (_input, init) => new Promise((resolve, reject) => {
  init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
}), { timeoutMs: 10 });
assert.equal((await decodeEnvelope(timedOut)).transportFailure, 'TIMEOUT');

let stalledRequestUpstreamCalls = 0;
const stalledRequest = new Request(endpointUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: new ReadableStream({ start() {} }),
  duplex: 'half'
});
const stalledRequestStartedAt = Date.now();
const stalledRequestResponse = await handleOfficialSourceProxyRequest(stalledRequest, async () => {
  stalledRequestUpstreamCalls += 1;
  return new Response('unexpected');
}, { requestTimeoutMs: 10 });
assert.equal((await decodeEnvelope(stalledRequestResponse)).transportFailure, 'TIMEOUT',
  'a stalled request stream returns a bounded timeout');
assert.ok(Date.now() - stalledRequestStartedAt < 500, 'stalled request stream timeout is bounded');
assert.equal(stalledRequestUpstreamCalls, 0, 'stalled request body never reaches the upstream');

const workerModule = (await import('../../src/worker/index.ts')).default;
const assetRequest = new Request('https://accounting.example/');
let assetRequestPassedThrough = false;
const assetResponse = await workerModule.fetch(assetRequest, { ASSETS: { fetch: async request => {
  assetRequestPassedThrough = request === assetRequest;
  return new Response('static app shell');
} } });
assert.equal(await assetResponse.text(), 'static app shell');
assert.equal(assetRequestPassedThrough, true, 'Cloudflare worker passes non-endpoint requests to static assets');

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
const routedCalls = [];
globalThis.window = {};
globalThis.fetch = async (input, init) => {
  const requestUrl = new URL(typeof input === 'string' ? input : input.url, 'https://accounting.example');
  routedCalls.push({ url: requestUrl.toString(), init });
  if (requestUrl.pathname === OFFICIAL_SOURCE_PROXY_PATH) {
    return handleOfficialSourceProxyRequest(new Request(requestUrl, init), async target => {
      assert.equal(new URL(target).hostname, 'www.iras.gov.sg');
      return new Response(html, { headers: { 'content-type': 'text/html' } });
    });
  }
  return new Response('reference API');
};

const browserRetriever = new ControlledWebRetriever(undefined, new SourceCache());
const browserSuccess = await browserRetriever.fetchOfficialSource(irasUrl, { useCache: false });
assert.equal(browserSuccess.status, 'SUCCESS');
assert.equal(browserSuccess.sourceUrl, irasUrl, 'reconstructed response retains the official IRAS URL');
assert.equal(routedCalls[0].url, `https://accounting.example${OFFICIAL_SOURCE_PROXY_PATH}`);
assert.equal(routedCalls[0].init.credentials, 'omit');
assert.equal(routedCalls[0].init.redirect, 'error');

const browserTopicMismatch = await browserRetriever.fetchOfficialSource(irasUrl, {
  useCache: false,
  topicValidation: { standardIdentifiers: ['IRAS'], expectedTitles: ['Foreign income taxation'], topicTerms: ['temporary secondment', 'foreign-sourced income'] }
});
assert.equal(browserTopicMismatch.status, 'TOPIC_MISMATCH', 'same-origin transport preserves topic validation');
const browserHashMismatch = await browserRetriever.fetchOfficialSource(irasUrl, { useCache: false, expectedHash: '0'.repeat(64) });
assert.equal(browserHashMismatch.status, 'HASH_MISMATCH', 'same-origin transport preserves content-hash validation');

let browserRevalidationCount = 0;
let browserConditionalPayload;
globalThis.fetch = async (input, init) => {
  const requestUrl = new URL(typeof input === 'string' ? input : input.url, 'https://accounting.example');
  const request = new Request(requestUrl, init);
  browserConditionalPayload = browserRevalidationCount === 0 ? undefined : JSON.parse(init.body);
  browserRevalidationCount++;
  return handleOfficialSourceProxyRequest(request, async (_target, upstreamInit) => {
    const headers = new Headers(upstreamInit.headers);
    if (browserRevalidationCount === 1) {
      return new Response(html, { headers: { 'content-type': 'text/html', etag: '"browser-cache"', 'last-modified': 'Mon, 01 Sep 2025 00:00:00 GMT' } });
    }
    assert.equal(headers.get('if-none-match'), '"browser-cache"');
    assert.equal(headers.get('if-modified-since'), 'Mon, 01 Sep 2025 00:00:00 GMT');
    return new Response(null, { status: 304, headers: { etag: '"browser-cache"' } });
  });
};
const browserCache = new SourceCache();
const cacheRetriever = new ControlledWebRetriever(undefined, browserCache);
assert.equal((await cacheRetriever.fetchOfficialSource(irasUrl, { ttlMs: 0 })).status, 'SUCCESS');
const revalidatedResult = await cacheRetriever.fetchOfficialSource(irasUrl);
assert.equal(browserConditionalPayload.ifNoneMatch, '"browser-cache"');
assert.equal(browserConditionalPayload.ifModifiedSince, 'Mon, 01 Sep 2025 00:00:00 GMT');
assert.equal(revalidatedResult.status, 'SUCCESS');
assert.equal(revalidatedResult.httpStatus, 304);
assert.equal(revalidatedResult.cached, true, 'browser transport preserves stale-cache 304 revalidation');

const firstHopUrl = 'https://www.iras.gov.sg/redirect-start';
const redirectRetriever = new ControlledWebRetriever(undefined, new SourceCache());
globalThis.fetch = async (input, init) => {
  const requestUrl = new URL(typeof input === 'string' ? input : input.url, 'https://accounting.example');
  if (requestUrl.pathname === OFFICIAL_SOURCE_PROXY_PATH) {
    return handleOfficialSourceProxyRequest(new Request(requestUrl, init), async target => {
      if (target === firstHopUrl) return new Response(null, { status: 302, headers: { location: '/redirect-end' } });
      return new Response(html, { headers: { 'content-type': 'text/html' } });
    });
  }
  return new Response('unexpected');
};
assert.equal((await redirectRetriever.fetchOfficialSource(firstHopUrl, { useCache: false, maxRedirects: 0 })).status, 'REDIRECT_REJECTED',
  'existing client redirect limit remains enforced');

globalThis.fetch = async (input) => {
  assert.equal(input, 'https://api.frankfurter.dev/latest?from=SGD&to=USD', 'approved reference API remains direct in browser');
  return new Response('reference API');
};
const referenceResult = await browserRetriever.fetchOfficialSource('https://api.frankfurter.dev/latest?from=SGD&to=USD', { useCache: false });
assert.equal(referenceResult.status, 'SUCCESS');

globalThis.fetch = async input => {
  assert.equal(input, irasUrl, 'Node default fetch remains direct to the approved official host');
  return new Response(html);
};
delete globalThis.window;
const nodeResult = await new ControlledWebRetriever(undefined, new SourceCache()).fetchOfficialSource(irasUrl, { useCache: false });
assert.equal(nodeResult.status, 'SUCCESS');

let customFetchCalled = false;
globalThis.window = {};
const customResult = await new ControlledWebRetriever(undefined, new SourceCache()).fetchOfficialSource(irasUrl, {
  useCache: false,
  customFetch: async input => {
    customFetchCalled = true;
    assert.equal(input, irasUrl, 'explicit custom fetch remains direct');
    return new Response(html);
  }
});
assert.equal(customResult.status, 'SUCCESS');
assert.equal(customFetchCalled, true);

const searchRequest = {
  query: 'claiming foreign tax credit Singapore',
  authority: 'IRAS',
  topicId: 'iras-individual-foreign-tax-credit',
  topicTitle: 'Foreign tax credit',
  standardOrAct: 'IRAS guidance',
  approvedHosts: ['www.iras.gov.sg'],
  topicHints: ['claiming foreign tax credit'],
  expectedTitles: ['Claiming Foreign Tax Credit'],
  searchSite: 'www.iras.gov.sg',
  searchEndpoint: 'https://html.duckduckgo.com/html/',
  searchRedirectHost: 'duckduckgo.com',
  searchRedirectParameter: 'uddg',
  lexicalDiscovery: true,
  maxCandidates: 4
};
const foreignTaxCreditUrl = 'https://www.iras.gov.sg/taxes/individual-income-tax/tax-residency-and-tax-rates/claiming-foreign-tax-credit';
let jinaFallbackCalls = 0;
const corsFallbackAdapter = new OfficialDomainSearchAdapter(new ControlledWebRetriever(undefined, new SourceCache()), {
  customFetch: async input => {
    if (new URL(input).hostname === 'html.duckduckgo.com') throw new TypeError('Failed to fetch');
    jinaFallbackCalls++;
    return new Response(`## [Claiming Foreign Tax Credit](${foreignTaxCreditUrl})\n`, { headers: { 'content-type': 'text/plain' } });
  }
});
const jinaCandidates = await corsFallbackAdapter.searchOfficialDomainCandidates(searchRequest);
assert.ok(jinaFallbackCalls > 0, 'direct browser search failure continues through the existing Jina fallback');
assert.ok(jinaCandidates.includes(foreignTaxCreditUrl), 'Jina metadata still yields an approved official candidate');

const offsiteJinaAdapter = new OfficialDomainSearchAdapter(new ControlledWebRetriever(undefined, new SourceCache()), {
  customFetch: async input => {
    if (new URL(input).hostname === 'html.duckduckgo.com') throw new TypeError('Failed to fetch');
    const response = new Response(`## [Offsite](https://duckduckgo.com/?uddg=${encodeURIComponent('https://evil.example/page')})\n`, {
      headers: { 'content-type': 'text/plain' }
    });
    Object.defineProperty(response, 'url', { value: input });
    return response;
  }
});
assert.deepEqual(await offsiteJinaAdapter.searchOfficialDomainCandidates(searchRequest), [], 'Jina results retain official-host filtering');

let abortedJinaCalls = 0;
const timeoutAdapter = new OfficialDomainSearchAdapter(new ControlledWebRetriever(undefined, new SourceCache()), {
  timeoutMs: 5,
  customFetch: async (input, init) => {
    if (new URL(input).hostname === 'r.jina.ai') abortedJinaCalls++;
    return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
  }
});
await timeoutAdapter.searchOfficialDomainCandidates(searchRequest);
assert.equal(abortedJinaCalls, 0, 'an aborted direct search does not start the Jina fallback');

globalThis.fetch = async () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
const malformedEnvelopeResponse = await fetchOfficialSourceSameOrigin(irasUrl);
assert.equal(malformedEnvelopeResponse.__officialSourceTransportFailure, 'NETWORK_ERROR', 'malformed proxy envelopes fail closed without throwing');
globalThis.fetch = async () => new Response(JSON.stringify({
  officialUrl: 'https://evil.example/content', upstreamStatus: 200, upstreamStatusText: 'OK', headers: {}, body: html
}), { status: 200 });
const offsiteEnvelopeResponse = await fetchOfficialSourceSameOrigin(irasUrl);
assert.equal(offsiteEnvelopeResponse.__officialSourceTransportFailure, 'NETWORK_ERROR', 'offsite response envelopes fail closed');

const successProfiler = new RequestProfiler('Success diagnostic test');
successProfiler.recordOfficialSourceFallback({
  path: 'DISCOVERED_SOURCE',
  attempts: [{ topicId: 'iras-foreign-income', fetchStatus: 'SUCCESS', candidateUrl: 'https://www.iras.gov.sg/page?secret=do-not-report', error: 'private error' }],
  stages: [{ stage: 'SITEMAP_DISCOVERY', status: 'ATTEMPTED', reason: 'private reason' }]
});
const successTelemetry = successProfiler.finalize();
assert.equal(successTelemetry.official_source_fallback.attempts[0].status, 'SUCCESS');
assert.equal(JSON.stringify(successTelemetry).includes('secret'), false);
assert.equal(JSON.stringify(successTelemetry).includes('private error'), false);

globalThis.window.__LAST_REQUEST_TELEMETRY__ = successTelemetry;
globalThis.window.location = { href: 'https://accounting.example/' };
const feedbackReport = compileFeedbackReport({
  description: 'test',
  messages: [],
  scenario: null,
  providerSettings: { activeProvider: 'offline' },
  theme: 'light',
  fontSize: 'medium',
  outputPreference: { journal: false, statutory: true }
});
assert.equal(feedbackReport.telemetry.official_source_fallback.attempts[0].status, 'SUCCESS', 'feedback includes safe fallback diagnostics');

const blockedProfiler = new RequestProfiler('Blocked diagnostic test');
blockedProfiler.recordOfficialSourceFallback({
  path: 'NO_VERIFIED_MAP',
  attempts: [
    { topicId: 'iras-foreign-income', fetchStatus: 'CORS_ERROR', discoveryStage: 'SITEMAP_DISCOVERY' },
    { topicId: 'iras-foreign-income', fetchStatus: 'TIMEOUT', discoveryStage: 'MAPPED_SOURCE' },
    { topicId: 'iras-foreign-income', fetchStatus: 'NO_CANDIDATES', discoveryStage: 'OFFICIAL_DOMAIN_SEARCH' }
  ],
  stages: [{ stage: 'INSUFFICIENT', status: 'EXHAUSTED' }]
});
const blockedTelemetry = blockedProfiler.finalize();
assert.deepEqual(blockedTelemetry.official_source_fallback.attempts.map(attempt => attempt.status), ['CORS_ERROR', 'TIMEOUT', 'NO_CANDIDATES']);
assert.equal(projectOfficialSourceFallbackDiagnostics({ path: 'bad\npath', attempts: [], stages: [] }).path, 'UNKNOWN');
const separateSitemapTrace = projectOfficialSourceFallbackDiagnostics({
  path: 'MAPPED_SOURCE_REJECTED',
  attempts: [{ topicId: 'iras-scope', fetchStatus: 'TOPIC_MISMATCH' }],
  discoveryFetchAttempts: [{ topicId: 'iras-scope', fetchStatus: 'SUCCESS' }],
  stages: []
});
assert.deepEqual(separateSitemapTrace.attempts.map(attempt => attempt.status), ['TOPIC_MISMATCH', 'SUCCESS'],
  'sitemap fetch diagnostics are exposed without changing candidate-attempt ordering');
assert.equal(separateSitemapTrace.attempts[1].stage, 'SITEMAP_DISCOVERY',
  'metadata-only sitemap fetch status remains explicitly classified as discovery');
const freshTelemetry = new RequestProfiler('Reset diagnostic test').finalize();
assert.equal(freshTelemetry.official_source_fallback, undefined, 'fallback diagnostics reset with each request');
const preFinalizedTelemetry = new RequestProfiler('Late grounding diagnostic test').finalize();
const lateProfiler = new RequestProfiler('Early response path test');
const lateTelemetry = lateProfiler.finalize();
lateProfiler.recordOfficialSourceFallback({ path: 'DISCOVERED_SOURCE', attempts: [{ topicId: 'iras-test', fetchStatus: 'SUCCESS' }], stages: [] });
assert.equal(lateTelemetry.official_source_fallback.attempts[0].status, 'SUCCESS', 'late offline grounding updates already-published feedback telemetry');
assert.equal(preFinalizedTelemetry.official_source_fallback, undefined);

globalThis.fetch = originalFetch;
if (originalWindow === undefined) delete globalThis.window;
else globalThis.window = originalWindow;

console.log('Official source proxy, browser transport, and feedback diagnostics tests passed.');
