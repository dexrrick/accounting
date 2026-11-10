import assert from 'node:assert/strict';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';

async function runOfficialSourceFailureSafetyTests() {
  const retriever = new ControlledWebRetriever();
  const officialUrl = 'https://www.iras.gov.sg/irasHome/';

  const forbidden = await retriever.fetchOfficialSource('https://example.com/not-an-official-source');
  assert.equal(forbidden.status, 'UNAUTHORIZED_DOMAIN_ACCESS');
  assert.equal(forbidden.content, undefined);

  const empty = await retriever.fetchOfficialSource(officialUrl, {
    useCache: false,
    customFetch: async () => new Response('', { status: 200 })
  });
  assert.equal(empty.status, 'INVALID_CONTENT');
  assert.equal(empty.content, undefined);

  const redirect = await retriever.fetchOfficialSource(officialUrl, {
    useCache: false,
    customFetch: async () => new Response(null, { status: 302, headers: { location: 'https://example.com/redirect' } })
  });
  assert.equal(redirect.status, 'REDIRECT_REJECTED');
  assert.equal(redirect.content, undefined);

  const networkFailure = await retriever.fetchOfficialSource(officialUrl, {
    useCache: false,
    customFetch: async () => { throw new TypeError('Failed to fetch'); }
  });
  assert.equal(networkFailure.status, 'CORS_ERROR');
  assert.equal(networkFailure.content, undefined);

  const timeout = await retriever.fetchOfficialSource(officialUrl, {
    useCache: false,
    timeoutMs: 5,
    customFetch: async (_url, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })
  });
  assert.equal(timeout.status, 'TIMEOUT');
  assert.equal(timeout.content, undefined);

  const masUrl = 'https://www.mas.gov.sg/regulation/capital-markets/apply-for-licensing-or-registration-of-capital-market-entities/fund-management-licensing';
  const compatibilityUserAgent = 'Mozilla/5.0 (compatible; AccountingEvidenceRetriever/1.0)';
  const approvedMasHtml = '<!doctype html><html><head><title>Fund Management Licensing</title></head><body><main>' +
    '<h1>Fund Management Licensing</h1><p>The Securities and Futures Act applies to fund management business carried on in Singapore. ' +
    'Persons carrying on this activity are subject to licensing requirements unless an applicable exemption applies.</p>' +
    '</main></body></html>';
  const maintenanceHtml = '<!doctype html><html><head><title>Maintenance</title></head><body><main>Scheduled maintenance in progress.</main></body></html>';
  const masTopic = {
    standardIdentifiers: ['Securities and Futures Act'],
    expectedTitles: ['Fund Management Licensing'],
    topicTerms: ['fund management', 'licence'],
    requireSubstantiveBody: true
  };
  let observedMasHeaders;
  const masResult = await retriever.fetchOfficialSource(masUrl, {
    useCache: false,
    topicValidation: masTopic,
    customFetch: async (_url, init) => {
      observedMasHeaders = new Headers(init.headers);
      const body = observedMasHeaders.get('user-agent') === compatibilityUserAgent
        ? approvedMasHtml : maintenanceHtml;
      return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
  });
  assert.equal(observedMasHeaders.get('user-agent'), compatibilityUserAgent,
    'server-side controlled fetch uses the identified browser-compatible application profile');
  assert.equal(observedMasHeaders.get('accept'), 'text/plain, application/json, text/html, */*',
    'the existing Accept header remains unchanged');
  assert.equal(masResult.status, 'SUCCESS');
  assert.equal(masResult.pageTitle, 'Fund Management Licensing');
  assert.equal(masResult.topicMatched, true);
  assert.equal(masResult.titleMatched, true);
  assert.equal(masResult.contentMatched, true);
  assert.match(masResult.substantiveText || '', /fund management business/i,
    'the substantive topic-content check remains required for success');

  let otherAuthorityHeaders;
  await retriever.fetchOfficialSource('https://www.iras.gov.sg/transport-control', {
    useCache: false,
    customFetch: async (_url, init) => {
      otherAuthorityHeaders = new Headers(init.headers);
      return new Response('<html><body>IRAS transport control.</body></html>', {
        status: 200, headers: { 'content-type': 'text/html' }
      });
    }
  });
  assert.equal(otherAuthorityHeaders.has('user-agent'), false,
    'unaffected authorities retain their existing request identity');

  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
    let browserHeaders;
    const browserMaintenance = await retriever.fetchOfficialSource(masUrl, {
      useCache: false,
      topicValidation: masTopic,
      customFetch: async (_url, init) => {
        browserHeaders = new Headers(init.headers);
        return new Response(maintenanceHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
    });
    assert.equal(browserHeaders.has('user-agent'), false, 'browser-managed User-Agent is left untouched');
    assert.equal(browserMaintenance.status, 'TOPIC_MISMATCH',
      'a maintenance page without the server compatibility profile is not admitted');
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }

  const mismatchedFinalUrl = await retriever.fetchOfficialSource(masUrl, {
    useCache: false,
    topicValidation: masTopic,
    customFetch: async () => {
      const response = new Response(approvedMasHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      Object.defineProperty(response, 'url', { value: 'https://attacker.example/mas/fund-management-licensing' });
      return response;
    }
  });
  assert.equal(mismatchedFinalUrl.status, 'REDIRECT_REJECTED',
    'the compatibility header does not relax final-URL provenance checks');

  console.log('PASS | Official-source failure safety: allowlist, content validation, redirect, network, and timeout');
}

runOfficialSourceFailureSafetyTests().catch(error => {
  console.error('OFFICIAL SOURCE FAILURE SAFETY FAILED');
  console.error(error);
  process.exit(1);
});
