import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { captureOfficialDocuments } from '../../scripts/capture_official_documents.mjs';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';

const syntheticHtml = `<!doctype html><html><head><title>Test Official Note</title></head><body><main>
  <h1>Test Official Note</h1>
  <p>Synthetic Standard identifies a synthetic rule in the framework for this explicitly artificial example.</p>
  <h2>Selected requirement</h2>
  <p>This synthetic rule provides a sufficiently substantive and explicitly artificial requirement for extraction testing.</p>
</main></body></html>`;

function makeRequest(url, overrides = {}) {
  return {
    url,
    authority: 'MAS',
    domain: 'MAS_FUNDS',
    standardOrActCode: 'SYNTHETIC-NOTE',
    legalOrStandardInstrument: 'Synthetic Official Note',
    documentKind: 'HTML',
    sectionHeading: 'Selected requirement',
    expectedTopic: {
      standardIdentifiers: ['Synthetic Standard'],
      expectedTitles: ['Test Official Note'],
      topicTerms: ['synthetic rule']
    },
    ...overrides
  };
}

function fetchedDocument(url, bytes, overrides = {}) {
  return {
    status: 'SUCCESS',
    httpStatus: 200,
    sourceUrl: url,
    finalUrl: url,
    contentType: 'text/html; charset=utf-8',
    retrievedAt: '2026-10-15T12:34:56.000Z',
    contentHash: createHash('sha256').update(bytes).digest('hex'),
    contentBytes: new Uint8Array(bytes),
    etag: '"synthetic-etag"',
    lastModified: 'Wed, 14 Oct 2026 12:00:00 GMT',
    ...overrides
  };
}

async function withTemporaryDirectory(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'official-document-capture-'));
  try { await callback(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

// These transport fixtures are intentionally synthetic. They exercise capture
// integrity and output safety; they do not assert acceptance of any MAS source.
const fixtureUrl = new URL('../fixtures/mas-reviewed/controlled-capture-requests.json', import.meta.url);
const baselineRequestsUrl = new URL('../fixtures/mas-reviewed/recheck-20261015/requests.json', import.meta.url);
const configuredRequests = JSON.parse(await readFile(fixtureUrl, 'utf8'));
const baselineRequests = JSON.parse(await readFile(baselineRequestsUrl, 'utf8'));
assert.equal(configuredRequests.documents.length, 2);
assert.deepEqual(configuredRequests.documents, baselineRequests.documents.slice(0, 2).map(({ recordId, request }) => ({ recordId, request })));

await withTemporaryDirectory(async root => {
  const documents = [
    { recordId: 'SYNTHETIC_NOTE_ONE', request: makeRequest('https://www.mas.gov.sg/synthetic/one') },
    { recordId: 'SYNTHETIC_NOTE_TWO', request: makeRequest('https://www.mas.gov.sg/synthetic/two') }
  ];
  const bytesByUrl = new Map(documents.map(item => [item.request.url, Buffer.from(syntheticHtml)]));
  const fetchedUrls = [];
  const registryBefore = structuredClone(UNIFIED_SOURCE_REGISTRY);
  const result = await captureOfficialDocuments({
    documents,
    outputDirectory: path.join(root, 'capture'),
    retriever: {
      async fetchOfficialDocument(url) {
        fetchedUrls.push(url);
        return fetchedDocument(url, bytesByUrl.get(url));
      }
    }
  });

  assert.equal(result.status, 'EXTRACTION_READY');
  assert.deepEqual(fetchedUrls, documents.map(item => item.request.url), 'every explicit request is fetched in order');
  assert.deepEqual(UNIFIED_SOURCE_REGISTRY, registryBefore, 'capturing candidates must not mutate the source registry');
  for (const [index, captured] of result.documents.entries()) {
    const sourceBytes = bytesByUrl.get(documents[index].request.url);
    const gzipBytes = await readFile(path.join(root, 'capture', captured.bodyFile));
    assert.deepEqual(gunzipSync(gzipBytes), sourceBytes, 'gzip storage preserves the exact fetched body bytes');
    const bodySha256 = createHash('sha256').update(sourceBytes).digest('hex');
    assert.equal(captured.fetch.status, 'SUCCESS');
    assert.equal(captured.fetch.httpStatus, 200);
    assert.equal(captured.fetch.sourceUrl, documents[index].request.url);
    assert.equal(captured.fetch.finalUrl, documents[index].request.url);
    assert.equal(captured.fetch.contentType, 'text/html; charset=utf-8');
    assert.equal(captured.fetch.retrievedAt, '2026-10-15T12:34:56.000Z');
    assert.equal(captured.fetch.contentHash, bodySha256);
    assert.equal(captured.integrity.computedSha256, bodySha256);
    assert.equal(captured.integrity.observedHashMatchesBytes, true);
    assert.equal(captured.extraction.extractionStatus, 'EXACT');
    assert.equal(captured.candidateRecord.id, captured.recordId);
    assert.equal(captured.candidateRecord.lifecycleState, 'CANDIDATE');
    assert.equal(captured.candidateRecord.groundingEligible, false);
    assert.equal(captured.candidateRecord.effectiveDate, undefined, 'the synthetic text supplies no effective date');
  }
  const persisted = JSON.parse(await readFile(path.join(root, 'capture', 'manifest.json'), 'utf8'));
  assert.deepEqual(persisted, result);
});

await withTemporaryDirectory(async root => {
  const url = 'https://www.mas.gov.sg/synthetic/missing-final-url';
  const bytes = Buffer.from(syntheticHtml);
  const result = await captureOfficialDocuments({
    documents: [{ recordId: 'SYNTHETIC_MISSING_FINAL_URL', request: makeRequest(url) }],
    outputDirectory: path.join(root, 'missing-final-url'),
    retriever: {
      async fetchOfficialDocument(requestUrl) {
        return fetchedDocument(requestUrl, bytes, { finalUrl: undefined });
      }
    }
  });

  assert.equal(result.status, 'BLOCKED', 'the extractor fallback cannot fill a missing observed final URL');
  assert.equal(result.documents[0].fetch.finalUrl, null);
  assert.equal(result.documents[0].fetch.contentType, 'text/html; charset=utf-8');
  assert.equal(result.documents[0].fetch.httpStatus, 200);
  assert.equal(result.documents[0].extraction.extractionStatus, 'EXACT', 'structural extraction may succeed without complete capture provenance');
  assert.equal(result.documents[0].integrity.computedSha256, result.documents[0].candidateRecord.documentHash);
});

await withTemporaryDirectory(async root => {
  const url = 'https://www.mas.gov.sg/synthetic/wrong-body';
  const request = makeRequest(url, { documentKind: 'PDF' });
  const bytes = Buffer.from(syntheticHtml);
  const result = await captureOfficialDocuments({
    documents: [{ recordId: 'SYNTHETIC_WRONG_BODY', request }],
    outputDirectory: path.join(root, 'wrong-body'),
    retriever: { async fetchOfficialDocument(requestUrl) { return fetchedDocument(requestUrl, bytes); } }
  });

  assert.equal(result.status, 'BLOCKED', 'HTTP 200 cannot make the wrong document kind acceptable');
  assert.equal(result.documents[0].fetch.httpStatus, 200);
  assert.equal(result.documents[0].extraction.status, 'REJECTED');
  assert.equal(result.documents[0].extraction.code, 'DOCUMENT_KIND_MISMATCH');
  assert.equal(result.documents[0].candidateRecord, null);
  assert.deepEqual(gunzipSync(await readFile(path.join(root, 'wrong-body', result.documents[0].bodyFile))), bytes);
});

await withTemporaryDirectory(async root => {
  const requests = [
    makeRequest('https://www.mas.gov.sg/synthetic/missing-metadata'),
    makeRequest('https://www.mas.gov.sg/synthetic/thrown-fetch'),
    makeRequest('https://www.mas.gov.sg/synthetic/returned-failure')
  ];
  const bytes = Buffer.from(syntheticHtml);
  const fetchedUrls = [];
  const result = await captureOfficialDocuments({
    documents: requests.map((request, index) => ({ recordId: `SYNTHETIC_FAILURE_${index + 1}`, request })),
    outputDirectory: path.join(root, 'failures'),
    retriever: {
      async fetchOfficialDocument(url) {
        fetchedUrls.push(url);
        if (url.endsWith('thrown-fetch')) throw new Error('synthetic transport failure');
        if (url.endsWith('returned-failure')) {
          return { status: 'NETWORK_ERROR', sourceUrl: url, retrievedAt: '2026-10-15T12:35:00.000Z', error: 'synthetic network error' };
        }
        return fetchedDocument(url, bytes, { finalUrl: undefined, contentType: undefined, contentHash: undefined });
      }
    }
  });

  assert.equal(result.status, 'BLOCKED');
  assert.deepEqual(fetchedUrls, requests.map(request => request.url), 'fetch failure must not silently skip later requests');
  const [missing, thrown, returned] = result.documents;
  assert.equal(missing.fetch.status, 'SUCCESS');
  assert.equal(missing.fetch.finalUrl, null);
  assert.equal(missing.fetch.contentType, null);
  assert.equal(missing.fetch.contentHash, null);
  assert.equal(missing.extraction.status, 'REJECTED');
  assert.equal(missing.extraction.code, 'UNSUPPORTED_CONTENT_TYPE');
  assert.equal(thrown.fetch, null);
  assert.equal(thrown.fetchFailure.message, 'synthetic transport failure');
  assert.equal(thrown.bodyFile, null);
  assert.equal(returned.fetch.status, 'NETWORK_ERROR');
  assert.equal(returned.fetch.httpStatus, null);
  assert.equal(returned.fetch.finalUrl, null);
  assert.equal(returned.fetch.contentType, null);
  assert.equal(returned.extraction.code, 'FETCH_NETWORK_ERROR');
});

await withTemporaryDirectory(async root => {
  const url = 'https://www.mas.gov.sg/synthetic/partial';
  const partialHtml = `<!doctype html><html><head><title>Test Official Note</title></head><body><main>
    <h1>Test Official Note</h1><p>Synthetic Standard describes a synthetic rule for this artificial example.</p>
    <h2>Selected requirement</h2><table><tr><td>Ambiguous single-row structure</td></tr></table>
    <p>This synthetic rule remains substantive even though the table boundary cannot be classified exactly.</p>
  </main></body></html>`;
  const bytes = Buffer.from(partialHtml);
  const result = await captureOfficialDocuments({
    documents: [{ recordId: 'SYNTHETIC_PARTIAL', request: makeRequest(url) }],
    outputDirectory: path.join(root, 'partial'),
    retriever: { async fetchOfficialDocument(requestUrl) { return fetchedDocument(requestUrl, bytes); } }
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.documents[0].extraction.extractionStatus, 'PARTIAL');
  assert.equal(result.documents[0].candidateRecord.lifecycleState, 'CANDIDATE');
  assert.equal(result.documents[0].candidateRecord.groundingEligible, false);
  assert.equal(result.documents[0].candidateRecord.effectiveDate, undefined);
});

await withTemporaryDirectory(async root => {
  const output = path.join(root, 'already-exists');
  await mkdir(output);
  let fetchCount = 0;
  const retriever = { async fetchOfficialDocument() { fetchCount++; throw new Error('must not fetch'); } };
  const valid = [{ recordId: 'SYNTHETIC_SAFE', request: makeRequest('https://www.mas.gov.sg/synthetic/safe') }];
  await assert.rejects(captureOfficialDocuments({ documents: valid, outputDirectory: output, retriever }), /already exists|EEXIST/i);
  assert.equal(fetchCount, 0, 'existing output is refused before transport starts');

  const invalidOutput = path.join(root, 'must-not-be-created');
  await assert.rejects(captureOfficialDocuments({
    documents: [{ recordId: '../escape', request: makeRequest('https://www.mas.gov.sg/synthetic/unsafe') }],
    outputDirectory: invalidOutput,
    retriever
  }), /safe identifier/);
  await assert.rejects(captureOfficialDocuments({
    documents: [valid[0], valid[0]],
    outputDirectory: invalidOutput,
    retriever
  }), /duplicated/);
  await assert.rejects(readFile(invalidOutput), { code: 'ENOENT' }, 'invalid request lists do not create output directories');
});

console.log('PASS | explicit official-document capture preserves bytes and provenance, blocks unsafe or partial captures, and leaves candidates unadmitted');
