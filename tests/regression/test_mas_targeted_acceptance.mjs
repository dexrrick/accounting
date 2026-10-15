import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { LiveRegulatoryFeedService } from '../../src/retrieval/liveRegulatoryFeed.ts';
import { MASDocumentUpdateAdapter } from '../../src/retrieval/masDocumentUpdateAdapter.ts';
import { extractOfficialDocumentFromRetrieved } from '../../src/retrieval/officialDocumentExtractor.ts';
import { SourceVersioningManager } from '../../src/standards/sourceVersioning.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';

const fixtureRoot = new URL('../fixtures/mas-reviewed/recheck-20261015/', import.meta.url);
const captures = JSON.parse(await readFile(new URL('capture.json', fixtureRoot), 'utf8'));
const requests = JSON.parse(await readFile(new URL('requests.json', fixtureRoot), 'utf8'));
const review = JSON.parse(await readFile(new URL('review.json', fixtureRoot), 'utf8'));
const priorCaptureRoot = new URL('../fixtures/mas-reviewed/', import.meta.url);
const priorCaptures = JSON.parse(await readFile(new URL('capture.json', priorCaptureRoot), 'utf8'));

assert.equal(captures.length, 4);
assert.equal(requests.documents.length, 4);
assert.equal(review.documents.length, 4);
assert.equal(review.positiveRealSourceAcceptance, 'BLOCKED');
assert.equal(requests.positiveLocatorsValidated, false);
assert.equal(requests.requestStatus, 'REJECTION_REPLAY_HYPOTHESES_ONLY');
assert.ok(review.blockedCases.length > 0);
assert.ok(review.blockedCases.every(item => item.status === 'BLOCKED'));
assert.ok(review.blockedCases.some(item => /publication or revision dates are not evidence of an effective date/i.test(item.reason)));
assert.ok(review.blockedCases.some(item => /historical applicability/i.test(item.case)));
assert.ok(review.blockedCases.some(item => /authority\/domain isolation/i.test(item.case)));
assert.ok(review.blockedCases.some(item => /retrieval-for-answer binding/i.test(item.reason)));
assert.ok(review.blockedCases.some(item => /cancelled/i.test(item.reason) && /never count as current/i.test(item.reason)));

const metadataByFile = new Map(captures.map(capture => [capture.file, capture]));
const reviewedByFile = new Map(review.documents.map(document => [document.captureFile, document]));
const fetchedUrls = [];
const registryBefore = structuredClone(UNIFIED_SOURCE_REGISTRY);

function makeRetrievedDocument(capture, bytes) {
  return {
    status: 'SUCCESS',
    httpStatus: capture.httpStatus,
    sourceUrl: capture.url,
    finalUrl: capture.finalUrl,
    contentType: capture.contentType,
    contentBytes: new Uint8Array(bytes),
    retrievedAt: capture.retrievedAt,
    ...(capture.etag ? { etag: capture.etag } : {}),
    ...(capture.lastModified ? { lastModified: capture.lastModified } : {})
  };
}

class CapturedResponseRetriever extends ControlledWebRetriever {
  constructor(capture, bytes) {
    super();
    this.capture = capture;
    this.bytes = bytes;
  }

  async fetchOfficialDocument(url) {
    fetchedUrls.push(url);
    assert.equal(url, this.capture.url, 'adapter must fetch the monitored public URL for this capture');
    return makeRetrievedDocument(this.capture, this.bytes);
  }
}

for (const document of requests.documents) {
  const capture = metadataByFile.get(document.captureFile);
  const reviewed = reviewedByFile.get(document.captureFile);
  assert.ok(capture, `missing capture metadata for ${document.captureFile}`);
  assert.ok(reviewed, `missing review entry for ${document.captureFile}`);
  assert.equal(document.request.url, capture.url);
  assert.equal(reviewed.httpStatus, capture.httpStatus);
  assert.equal(reviewed.contentType, capture.contentType);
  assert.equal(reviewed.responseTitle, capture.responseTitle);

  const gzipBytes = await readFile(new URL(capture.file, fixtureRoot));
  const bodyBytes = gunzipSync(gzipBytes);
  assert.equal(bodyBytes.byteLength, capture.bytes, `${document.title}: exact response body length`);
  assert.equal(createHash('sha256').update(bodyBytes).digest('hex'), capture.documentHash, `${document.title}: exact response body hash`);
  assert.equal(capture.httpStatus, 200, 'HTTP success does not establish source evidence');
  assert.equal(capture.contentType, 'text/html');
  assert.equal(capture.responseTitle, 'Maintenance');
  assert.equal(capture.responseClassification, 'MAS_MAINTENANCE_HTML_NOT_SOURCE_DOCUMENT');

  const html = new TextDecoder('utf-8', { fatal: true }).decode(bodyBytes);
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1]?.trim();
  assert.equal(title, 'Maintenance', `${document.title}: captured body title`);
  if (document.request.documentKind === 'PDF') {
    assert.notEqual(bodyBytes.subarray(0, 5).toString('ascii'), '%PDF-', `${document.title}: maintenance body has no PDF magic`);
  }

  const prior = priorCaptures.find(item => item.url === capture.url);
  if (prior) {
    assert.notEqual(capture.documentHash, prior.documentHash, `${document.title}: fresh response differs from the previous capture`);
  }

  const retrieved = makeRetrievedDocument(capture, bodyBytes);
  const extraction = await extractOfficialDocumentFromRetrieved(document.request, retrieved);
  assert.equal(extraction.status, 'REJECTED', `${document.title}: maintenance response must not extract as evidence`);
  assert.equal('record' in extraction, false, `${document.title}: rejection cannot carry a source record`);

  const versioning = new SourceVersioningManager();
  const versioningBefore = {
    ledger: versioning.getAllLedgerEntries(),
    candidates: versioning.getCandidates(),
    activeVersionId: versioning.getActiveVersionId(document.recordId)
  };
  const retriever = new CapturedResponseRetriever(capture, bodyBytes);
  const adapter = new MASDocumentUpdateAdapter([{
    recordId: document.recordId,
    extractionRequest: document.request,
    amendmentTitle: document.title
  }]);
  const service = new LiveRegulatoryFeedService(versioning, undefined, retriever, [adapter]);
  const result = await service.checkForUpdates();

  assert.deepEqual(result.packages, [], `${document.title}: no update package can be constructed`);
  assert.equal(result.hasUpdates, false);
  assert.deepEqual(fetchedUrls.at(-1), capture.url);
  assert.deepEqual(service.getStagedPackages(), []);
  assert.deepEqual(service.getVerifiedPackages(), []);
  assert.deepEqual(service.getActivePackages(), []);
  assert.deepEqual(versioning.getCandidates(), versioningBefore.candidates);
  assert.deepEqual(versioning.getAllLedgerEntries(), versioningBefore.ledger);
  assert.equal(versioning.getActiveVersionId(document.recordId), versioningBefore.activeVersionId);

  const nonexistentPackageId = `MAS-NONEXISTENT-${document.recordId}`;
  assert.equal(service.approveUpdatePackage(nonexistentPackageId, 'reviewer@example.test', 'Must not approve absent package'), false);
  assert.equal((await service.activateUpdatePackage(nonexistentPackageId)).success, false);
  assert.deepEqual(service.getStagedPackages(), []);
  assert.deepEqual(service.getVerifiedPackages(), []);
  assert.deepEqual(service.getActivePackages(), []);
}

assert.deepEqual(fetchedUrls, requests.documents.map(document => document.request.url), 'each captured URL was independently fetched once through the adapter');
assert.deepEqual(UNIFIED_SOURCE_REGISTRY, registryBefore, 'maintenance response replay leaves the shared source registry unchanged');
console.log('PASS | Four fresh MAS endpoint captures reject maintenance HTML; no source records, update packages, candidates or activations are admitted');
