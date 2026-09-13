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

  console.log('PASS | Official-source failure safety: allowlist, empty content, redirect, network, and timeout');
}

runOfficialSourceFailureSafetyTests().catch(error => {
  console.error('OFFICIAL SOURCE FAILURE SAFETY FAILED');
  console.error(error);
  process.exit(1);
});
