import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { diagnoseMasTransport, fingerprintResponseBody, main, MAS_PREVIEW_ORIGIN, runPreviewDecoder } from '../../scripts/diagnose_mas_transport.mjs';

const html = `<!doctype html><html><head><title>Synthetic Note</title></head><body><main>
  <h1>Synthetic Note</h1>
  <p>Synthetic Standard identifies the synthetic rule for this artificial example.</p>
  <h2>Selected requirement</h2>
  <p>This synthetic rule provides a substantive and explicitly artificial requirement for extraction testing.</p>
</main></body></html>`;

function makeDocument(url = 'https://www.mas.gov.sg/synthetic/diagnostic') {
  return {
    recordId: 'SYNTHETIC_MAS_TRANSPORT',
    request: {
      url,
      authority: 'MAS',
      domain: 'MAS_FUNDS',
      standardOrActCode: 'SYNTHETIC-NOTE',
      legalOrStandardInstrument: 'Synthetic Official Note',
      documentKind: 'HTML',
      sectionHeading: 'Selected requirement',
      expectedTopic: {
        standardIdentifiers: ['Synthetic Standard'],
        expectedTitles: ['Synthetic Note'],
        topicTerms: ['synthetic rule']
      }
    }
  };
}

const selectedPreviewOrigin = 'https://codex-mas-transport-investigation-accounting.dexrrick-goh.workers.dev';

function htmlResponse(url, body = html, status = 200) {
  const response = new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

async function withTemporaryDirectory(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mas-transport-diagnostic-'));
  try { await callback(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

await withTemporaryDirectory(async root => {
  const document = makeDocument();
  const requestCalls = [];
  const { capture, diagnostic } = await diagnoseMasTransport({
    outputDirectory: path.join(root, 'direct'),
    documents: [document],
    directFetch: async (url, init) => {
      requestCalls.push({ url, init });
      return htmlResponse(url);
    }
  });

  assert.equal(capture.status, 'EXTRACTION_READY');
  assert.equal(diagnostic.documents[0].redirectsObserved, 0);
  assert.equal(diagnostic.documents[0].redirectTrace.visibility, 'manual-response-trace');
  assert.equal(diagnostic.documents[0].redirectTrace.responseUrlChangedWithoutRedirect, false);
  assert.equal(diagnostic.documents[0].originResponses.length, 1);
  const hop = diagnostic.documents[0].originResponses[0];
  assert.equal(hop.request.method, 'GET');
  assert.equal(hop.request.context, 'node-direct');
  assert.equal(hop.request.headers['x-official-source-response-mode'], 'document');
  assert.equal(hop.request.headers.cookie, undefined);
  assert.equal(hop.response.status, 200);
  assert.equal(hop.response.responseUrl, document.request.url);
  assert.equal(hop.response.bodyBytesObserved, Buffer.byteLength(html));
  assert.equal(hop.response.bodySha256, createHash('sha256').update(html).digest('hex'));
  assert.equal(requestCalls[0].init.redirect, 'manual');
  const bodyBytes = gunzipSync(await readFile(path.join(root, 'direct', capture.documents[0].bodyFile)));
  assert.equal(bodyBytes.toString('utf8'), html, 'the capture runner retains the fetched entity bytes');
  assert.equal(createHash('sha256').update(bodyBytes).digest('hex'), capture.documents[0].integrity.computedSha256);
});

await withTemporaryDirectory(async root => {
  const requestedUrl = 'https://www.mas.gov.sg/synthetic/hidden-final';
  const hiddenFinalUrl = 'https://www.mas.gov.sg/synthetic/final';
  const { diagnostic } = await diagnoseMasTransport({
    outputDirectory: path.join(root, 'hidden-final'),
    documents: [makeDocument(requestedUrl)],
    directFetch: async () => htmlResponse(hiddenFinalUrl)
  });
  const document = diagnostic.documents[0];
  assert.equal(document.originResponses.length, 1, 'only the response exposed by the fetch transport is recorded');
  assert.equal(document.originResponses[0].response.status, 200);
  assert.equal(document.originResponses[0].response.location, null);
  assert.equal(document.originResponses[0].response.responseUrl, hiddenFinalUrl);
  assert.equal(document.redirectsObserved, 0, 'the changed final URL is not fabricated into an observed 3xx');
  assert.equal(document.redirectTrace.responseUrlChangedWithoutRedirect, true);
  assert.equal(document.redirectTrace.internalRedirectHops, null, 'unobserved transport hops remain unknown');
});

await withTemporaryDirectory(async root => {
  const document = makeDocument();
  let callCount = 0;
  const { diagnostic, capture } = await diagnoseMasTransport({
    outputDirectory: path.join(root, 'browser-context'),
    mode: 'browser-context',
    documents: [document],
    directFetch: async (url, init) => {
      callCount++;
      const headers = new Headers(init.headers);
      assert.equal(headers.get('user-agent')?.includes('Mozilla/5.0'), true);
      assert.equal(headers.get('accept').includes('application/pdf'), true);
      assert.equal(headers.get('referer'), 'https://www.mas.gov.sg/');
      assert.equal(headers.has('cookie'), false);
      assert.equal(headers.has('authorization'), false);
      assert.equal(init.credentials, 'omit');
      return htmlResponse(url);
    }
  });
  assert.equal(callCount, 1);
  assert.equal(capture.status, 'EXTRACTION_READY');
  assert.equal(diagnostic.documents[0].requestContext, 'browser-like-ua-accept-referrer-no-session');
  assert.deepEqual(Object.keys(diagnostic.documents[0].originResponses[0].request.headers).sort(),
    ['accept', 'referer', 'user-agent', 'x-official-source-response-mode'].sort());
});

for (const [mode, expectedHeader, absentHeader, expectedContext] of [
  ['user-agent-only', 'user-agent', 'referer', 'browser-like-user-agent-only-no-session'],
  ['referrer-only', 'referer', 'user-agent', 'browser-like-referrer-only-no-session']
]) {
  await withTemporaryDirectory(async root => {
    const document = makeDocument();
    const { diagnostic } = await diagnoseMasTransport({
      outputDirectory: path.join(root, mode),
      mode,
      documents: [document],
      directFetch: async (url, init) => {
        const headers = new Headers(init.headers);
        assert.ok(headers.has(expectedHeader));
        assert.equal(headers.has(absentHeader), false);
        assert.equal(headers.has('cookie'), false);
        assert.equal(headers.has('authorization'), false);
        assert.equal(init.credentials, 'omit');
        return htmlResponse(url);
      }
    });
    assert.equal(diagnostic.documents[0].requestContext, expectedContext);
  });
}

await withTemporaryDirectory(async root => {
  const document = makeDocument();
  let callCount = 0;
  const { diagnostic, capture } = await diagnoseMasTransport({
    outputDirectory: path.join(root, 'rejected-redirect'),
    documents: [document],
    directFetch: async () => {
      callCount++;
      return new Response(null, { status: 302, headers: { location: 'https://example.com/offsite' } });
    }
  });
  assert.equal(callCount, 1, 'the controlled retriever does not follow an offsite redirect');
  assert.equal(diagnostic.documents[0].originResponses[0].response.status, 302);
  assert.equal(diagnostic.documents[0].originResponses[0].response.location, 'https://example.com/offsite');
  assert.equal(diagnostic.documents[0].retrieval.status, 'REDIRECT_REJECTED');
  assert.equal(capture.status, 'BLOCKED');
});

await withTemporaryDirectory(async root => {
  const invalidOrigins = [
    'http://codex-mas-transport-investigation-accounting.dexrrick-goh.workers.dev',
    'https://operator@codex-mas-transport-investigation-accounting.dexrrick-goh.workers.dev',
    'https://codex-mas-transport-investigation-accounting.dexrrick-goh.workers.dev:444',
    'https://codex-mas-transport-investigation-accounting.dexrrick-goh.workers.dev/path',
    'https://codex-mas-transport-investigation-accounting.dexrrick-goh.workers.dev/?query=1',
    'https://codex-mas-transport-investigation-accounting.dexrrick-goh.workers.dev/#fragment',
    'https://www.mas.gov.sg',
    'https://accounting.dexrrick-goh.workers.dev.evil.example',
    'https://codex-mas-transport-investigation-accounting.dexrrick-goh.workers.dev.evil.example'
  ];
  let previewCalls = 0;
  for (const [index, previewOrigin] of invalidOrigins.entries()) {
    await assert.rejects(diagnoseMasTransport({
      outputDirectory: path.join(root, `invalid-${index}`),
      mode: 'deployed-preview',
      previewOrigin,
      documents: [makeDocument()],
      previewRequest: async () => { previewCalls++; throw new Error('must not reach preview request'); }
    }), /previewOrigin/);
  }
  assert.equal(previewCalls, 0, 'invalid origins are rejected before preview requests');
  assert.deepEqual(await readdir(root), [], 'invalid origins are rejected before output directories or files are created');

  await assert.rejects(diagnoseMasTransport({
    outputDirectory: path.join(root, 'wrong-mode'),
    mode: 'direct',
    previewOrigin: selectedPreviewOrigin,
    documents: [makeDocument()],
    directFetch: async () => { throw new Error('must not reach direct fetch'); }
  }), /only be supplied when mode is deployed-preview/);
  assert.deepEqual(await readdir(root), [], 'preview origins are rejected for non-deployed modes before output mutations');

  const originalExitCode = process.exitCode;
  const originalStderrWrite = process.stderr.write;
  let cliError = '';
  process.exitCode = 0;
  process.stderr.write = chunk => { cliError += String(chunk); return true; };
  try {
    assert.equal(await main([
      '--output', path.join(root, 'cli-wrong-mode'), '--mode', 'direct', '--preview-origin', selectedPreviewOrigin
    ]), null, 'CLI rejects --preview-origin outside deployed-preview mode');
    assert.equal(process.exitCode, 1);
    assert.equal(await main([
      '--output', path.join(root, 'cli-invalid-origin'), '--mode', 'deployed-preview', '--preview-origin', invalidOrigins[0]
    ]), null, 'CLI rejects an unapproved preview origin');
    assert.equal(process.exitCode, 1);
  } finally {
    process.stderr.write = originalStderrWrite;
    process.exitCode = originalExitCode;
  }
  assert.match(cliError, /--preview-origin can only be used with --mode deployed-preview/);
  assert.match(cliError, /previewOrigin must be/);
  assert.deepEqual(await readdir(root), [], 'invalid CLI option combinations are rejected before output mutations');
});

await withTemporaryDirectory(async root => {
  const document = makeDocument();
  const outerBytes = Buffer.from('{"maintenance":"preview transport unavailable"}');
  const upstreamBytes = Buffer.from('upstream returned maintenance html');
  const { diagnostic, capture } = await diagnoseMasTransport({
    outputDirectory: path.join(root, 'deployed-preview'),
    mode: 'deployed-preview',
    previewOrigin: selectedPreviewOrigin,
    documents: [document],
    previewRequest: async (url, init) => {
      assert.equal(url, document.request.url);
      assert.equal(init.method, 'GET');
      assert.equal(init.previewOrigin, selectedPreviewOrigin, 'injected preview requests receive the selected origin');
      const outerUrl = `${init.previewOrigin}/api/official-source`;
      return {
        response: htmlResponse(url, upstreamBytes.toString('utf8'), 503),
        outerBytes,
        upstreamBytes,
        trace: {
          outer: {
            request: { url: outerUrl, method: 'POST', context: 'fixed-deployed-preview-same-origin-proxy', headers: { 'content-type': 'application/json' } },
            response: { status: 200, statusText: 'OK', responseUrl: outerUrl, contentType: 'application/json', location: null,
              headers: { 'content-type': 'application/json' }, bodyBytesObserved: outerBytes.length, bodyLengthComplete: true,
              bodySha256: createHash('sha256').update(outerBytes).digest('hex') }
          },
          official: {
            request: { url, method: 'GET', context: 'official-document-request-through-same-origin-decoder', headers: { 'x-official-source-response-mode': 'document' } },
            response: { status: 503, statusText: 'Service Unavailable', responseUrl: url, contentType: 'text/html', location: null,
              headers: { 'content-type': 'text/html' }, bodyBytesObserved: upstreamBytes.length, bodyLengthComplete: true,
              bodySha256: createHash('sha256').update(upstreamBytes).digest('hex') },
            transportFailure: null
          }
        }
      };
    }
  });
  const trace = diagnostic.documents[0];
  assert.equal(diagnostic.previewOrigin, selectedPreviewOrigin);
  assert.equal(trace.proxyExchanges.length, 1);
  assert.equal(trace.proxyExchanges[0].outer.request.url, `${selectedPreviewOrigin}/api/official-source`);
  assert.equal(trace.proxyExchanges[0].outer.response.status, 200, 'outer preview HTTP status is separate');
  assert.equal(trace.proxyExchanges[0].decodedOfficialResponse.response.status, 503, 'decoded upstream status is retained');
  assert.deepEqual(trace.proxyExchanges[0].internalRedirectChain, { visibility: 'UNKNOWN', hops: null });
  assert.equal(trace.redirectTrace.visibility, 'UNKNOWN');
  assert.equal(trace.redirectTrace.internalRedirectHops, null);
  assert.equal(trace.retrieval.status, 'HTTP_ERROR');
  assert.equal(capture.status, 'BLOCKED');
  const outerGzip = await readFile(path.join(root, 'deployed-preview', trace.proxyExchanges[0].outerBodyFile));
  assert.deepEqual(gunzipSync(outerGzip), outerBytes, 'raw preview response bytes are preserved as gzip');
  const upstreamGzip = await readFile(path.join(root, 'deployed-preview', trace.proxyExchanges[0].decodedOfficialResponse.response.bodyFile));
  assert.deepEqual(gunzipSync(upstreamGzip), upstreamBytes, 'non-success upstream entity bytes remain available for diagnosis');
});

await withTemporaryDirectory(async root => {
  const document = makeDocument();
  const upstreamBytes = Buffer.from('<html>official upstream failure</html>');
  const outerEnvelope = {
    officialUrl: document.request.url,
    upstreamStatus: 503,
    upstreamStatusText: 'Service Unavailable',
    headers: { 'content-type': 'text/html; charset=utf-8' },
    bodyBase64: upstreamBytes.toString('base64')
  };
  const { diagnostic, capture } = await diagnoseMasTransport({
    outputDirectory: path.join(root, 'actual-decoder-upstream-error'),
    mode: 'deployed-preview',
    documents: [document],
    previewRequest: (url, init) => runPreviewDecoder(url, {
      signal: init.signal,
      testOuterResponse: {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(outerEnvelope)
      }
    })
  });
  const exchange = diagnostic.documents[0].proxyExchanges[0];
  assert.equal(diagnostic.previewOrigin, MAS_PREVIEW_ORIGIN, 'omitting the option preserves the historical PR19 preview origin');
  assert.equal(exchange.outer.request.url, `${MAS_PREVIEW_ORIGIN}/api/official-source`);
  assert.equal(exchange.outer.response.status, 200);
  assert.equal(exchange.decodedOfficialResponse.transportFailure, null);
  assert.equal(exchange.decodedOfficialResponse.response.status, 503);
  assert.equal(exchange.decodedOfficialResponse.response.contentType, 'text/html; charset=utf-8', 'the real child decoder preserves MIME headers');
  assert.equal(diagnostic.documents[0].retrieval.status, 'HTTP_ERROR');
  assert.equal(capture.status, 'BLOCKED');
  const gzip = await readFile(path.join(root, 'actual-decoder-upstream-error', exchange.decodedOfficialResponse.response.bodyFile));
  assert.deepEqual(gunzipSync(gzip), upstreamBytes);
});

await withTemporaryDirectory(async root => {
  const document = makeDocument();
  const { diagnostic, capture } = await diagnoseMasTransport({
    outputDirectory: path.join(root, 'actual-decoder-maintenance-html'),
    mode: 'deployed-preview',
    previewOrigin: selectedPreviewOrigin,
    documents: [document],
    previewRequest: (url, init) => runPreviewDecoder(url, {
      signal: init.signal,
      previewOrigin: init.previewOrigin,
      testOuterResponse: {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: '<html>preview maintenance response</html>'
      }
    })
  });
  const exchange = diagnostic.documents[0].proxyExchanges[0];
  assert.equal(diagnostic.previewOrigin, selectedPreviewOrigin);
  assert.equal(exchange.outer.request.url, `${selectedPreviewOrigin}/api/official-source`,
    'the isolated child decoder records the selected origin and guards its fixed endpoint against it');
  assert.equal(exchange.outer.response.status, 200);
  assert.equal(exchange.outer.response.contentType, 'text/html; charset=utf-8');
  assert.equal(exchange.decodedOfficialResponse.transportFailure, 'NETWORK_ERROR');
  assert.equal(exchange.decodedOfficialResponse.response, null, 'a synthetic decoder failure response is not reported as an observed upstream response');
  assert.deepEqual(exchange.internalRedirectChain, { visibility: 'UNKNOWN', hops: null });
  assert.equal(diagnostic.documents[0].redirectTrace.internalRedirectHops, null);
  assert.equal(diagnostic.documents[0].redirectTrace.finalResponseUrl, null);
  assert.equal(diagnostic.documents[0].retrieval.status, 'NETWORK_ERROR');
  assert.equal(diagnostic.documents[0].retrieval.httpStatus, null);
  assert.equal(capture.status, 'BLOCKED');
});

await withTemporaryDirectory(async root => {
  const { capture, diagnostic } = await diagnoseMasTransport({
    outputDirectory: path.join(root, 'unknown-response'),
    documents: [makeDocument()],
    directFetch: async () => { throw new Error('synthetic connection failure'); }
  });
  const document = diagnostic.documents[0];
  assert.equal(capture.status, 'BLOCKED');
  assert.equal(document.originResponses[0].response.status, null);
  assert.equal(document.originResponses[0].response.responseUrl, null);
  assert.equal(document.retrieval.httpStatus, null);
  assert.equal(document.retrieval.finalUrl, null);
  assert.equal(document.capture.bodyFile, null);
});

const oversizedBody = new ReadableStream({
  start(controller) { controller.enqueue(new Uint8Array(32)); },
  cancel() { return new Promise(() => {}); }
});
const oversizedFingerprint = await fingerprintResponseBody(new Response(oversizedBody), 16, { timeoutMs: 50 });
assert.equal(oversizedFingerprint.bodyBytesObserved, 32);
assert.equal(oversizedFingerprint.bodyLengthComplete, false);

const stalledBody = new ReadableStream({
  start(controller) { controller.enqueue(Uint8Array.of(1, 2, 3)); },
  cancel() { return new Promise(() => {}); }
});
const startedAt = Date.now();
const stalledFingerprint = await fingerprintResponseBody(new Response(stalledBody), 16, { timeoutMs: 25 });
assert.equal(stalledFingerprint.bodyBytesObserved, 3);
assert.equal(stalledFingerprint.bodyObservationError, 'body read timed out');
assert.equal(stalledFingerprint.bodyLengthComplete, false);
assert.equal(stalledFingerprint.bodyHashScope, 'bounded-prefix');
assert.equal(stalledFingerprint.bytes, null);
assert.ok(Date.now() - startedAt < 1_000, 'a stalled reader returns on the independent observation timeout');

const preAbortedController = new AbortController();
preAbortedController.abort();
const preAbortedFingerprint = await fingerprintResponseBody(new Response(new ReadableStream({
  cancel() { return new Promise(() => {}); }
})), 16, { timeoutMs: 1_000, signal: preAbortedController.signal });
assert.equal(preAbortedFingerprint.bodyObservationError, 'body read was aborted');
assert.equal(preAbortedFingerprint.bodyLengthComplete, false);
assert.equal(preAbortedFingerprint.bodyHashScope, 'bounded-prefix');
assert.equal(preAbortedFingerprint.bytes, null);

const midAbortController = new AbortController();
const midAbortBody = new ReadableStream({
  start(controller) { controller.enqueue(Uint8Array.of(4, 5, 6)); },
  cancel() { return new Promise(() => {}); }
});
const midAbortPromise = fingerprintResponseBody(new Response(midAbortBody), 16, { timeoutMs: 1_000, signal: midAbortController.signal });
await new Promise(resolve => setTimeout(resolve, 10));
midAbortController.abort();
const midAbortFingerprint = await midAbortPromise;
assert.equal(midAbortFingerprint.bodyBytesObserved, 3);
assert.equal(midAbortFingerprint.bodyObservationError, 'body read was aborted');
assert.equal(midAbortFingerprint.bodyLengthComplete, false);
assert.equal(midAbortFingerprint.bodyHashScope, 'bounded-prefix');
assert.equal(midAbortFingerprint.bytes, null);

console.log('PASS | MAS transport diagnostic traces observed hops and proxy layers, preserves bytes, and keeps unknown or rejected results blocked');
