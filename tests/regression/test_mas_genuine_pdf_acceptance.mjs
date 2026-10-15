import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { LiveRegulatoryFeedService } from '../../src/retrieval/liveRegulatoryFeed.ts';
import { MASDocumentUpdateAdapter } from '../../src/retrieval/masDocumentUpdateAdapter.ts';
import { extractOfficialDocumentFromRetrieved } from '../../src/retrieval/officialDocumentExtractor.ts';
import { verifySharedDocumentAdmission } from '../../src/standards/sharedDocumentAdmission.ts';
import { SourceVersioningManager } from '../../src/standards/sourceVersioning.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';

const fixtureRoot = new URL('../fixtures/mas-reviewed/browser-download-20261015/', import.meta.url);
const capture = JSON.parse(await readFile(new URL('capture.json', fixtureRoot), 'utf8'));
const review = JSON.parse(await readFile(new URL('review.json', fixtureRoot), 'utf8'));
const REQUEST_URL = 'https://www.mas.gov.sg/-/media/mas-media-library/regulation/circulars/cmi/iid-04-2025-governance-and-management-of-vcc/iid-04-2025-governance-and-management-of-variable-capital-companies-vccs.pdf';
const RECORD_ID = 'MAS_IID_04_2025_BROWSER_CAPTURE_RECHECK';
const request = {
  url: REQUEST_URL,
  authority: 'MAS',
  domain: 'MAS_FUNDS',
  standardOrActCode: 'MAS-IID-04-2025',
  legalOrStandardInstrument: 'MAS Circular IID 04/2025',
  documentKind: 'PDF',
  expectedTopic: {
    standardIdentifiers: ['IID 04/2025'],
    expectedTitles: ['GOVERNANCE AND MANAGEMENT OF VARIABLE CAPITAL COMPANIES'],
    topicTerms: ['VCC', 'fund management']
  }
};

assert.equal(capture.requestedUrl, REQUEST_URL);
assert.equal(capture.bytes, 208660);
assert.equal(capture.documentHash, '305c50130aa341d7f2033118a825ee90d8cc3bd7475ed52a909bb604060aea17');
assert.equal(capture.httpStatus, null, 'browser download did not expose HTTP status');
assert.equal(capture.contentType, null, 'browser download did not expose MIME headers');
assert.equal(capture.finalUrl, null, 'browser download did not verify the redirect chain/final URL');
assert.equal(capture.transportTraceComplete, false);
assert.equal(capture.downloadZoneIdentifier.HostUrl, REQUEST_URL);
assert.equal(capture.downloadZoneIdentifier.ReferrerUrl, capture.discoveryUrl);
assert.equal(review.actualPositivePdfAdmission, 'BLOCKED');
assert.equal(review.structuralReplayEnvelope, 'TEST_ONLY_NOT_CAPTURED_HTTP_HEADERS');
assert.ok(review.blockedCases.every(item => item.status === 'BLOCKED'));

const gzipBytes = await readFile(new URL(capture.file, fixtureRoot));
const pdfBytes = gunzipSync(gzipBytes);
assert.equal(pdfBytes.byteLength, capture.bytes);
assert.equal(createHash('sha256').update(pdfBytes).digest('hex'), capture.documentHash);
assert.equal(pdfBytes.subarray(0, 8).toString('ascii'), capture.signature);
assert.equal(capture.signature, '%PDF-1.7');

// The genuine browser capture has bytes and URL metadata only. Do not fill its
// missing HTTP fields with guessed values when testing its actual provenance.
const actualCaptureEnvelope = {
  status: 'SUCCESS',
  sourceUrl: capture.requestedUrl,
  retrievedAt: capture.capturedAt,
  contentBytes: new Uint8Array(pdfBytes)
};
const incompleteTrace = await extractOfficialDocumentFromRetrieved(request, actualCaptureEnvelope);
assert.equal(incompleteTrace.status, 'REJECTED');
assert.equal(incompleteTrace.code, 'HTTP_STATUS_REJECTED');
assert.equal('record' in incompleteTrace, false);
assert.equal(capture.httpStatus, null);
assert.equal(capture.contentType, null);
assert.equal(capture.finalUrl, null);

// Explicit lab input for the structural extractor replay only. These fields
// are invented test controls, not headers or transport metadata from capture.
const structuralReplayEnvelope = {
  status: 'SUCCESS',
  httpStatus: 200,
  sourceUrl: REQUEST_URL,
  finalUrl: REQUEST_URL,
  contentType: 'application/pdf',
  contentBytes: new Uint8Array(pdfBytes),
  retrievedAt: capture.capturedAt
};
const structuralReplay = await extractOfficialDocumentFromRetrieved(request, structuralReplayEnvelope);
assert.equal(structuralReplay.status, 'SUCCESS', structuralReplay.status === 'REJECTED' ? structuralReplay.reason : '');
const record = structuralReplay.record;
assert.equal(record.authority, 'MAS');
assert.equal(record.sourceAuthority, 'MAS');
assert.equal(record.sourcePublisher, 'Monetary Authority of Singapore');
assert.match(record.documentTitle.toLowerCase(), /governance and management of variable capital companies/);
assert.ok(record.sourceText.trim().length > 20, 'real circular passage must contain substantive text');
assert.ok(/\bVCCs?\b|fund management/i.test(record.sourceText), 'selected text must retain substantive circular identity');
assert.match(record.sourceText, /A PROFILE OF VCCs AND KEY REGULATORY REQUIREMENTS/);
assert.match(record.sourceText, /The vast majority are offered to only accredited and\/or institutional\s+investors\./,
  'the short final continuation retains the complete sentence');
assert.match(record.sourceText, /4 VCCs1 and VCC managers are subject to regulatory requirements/,
  'the raised paragraph reference remains attached to its same-P prose');
assert.match(record.sourceText, /one or more\s+CIS in the form of a body corporate2\./,
  'same-LI references stay in the list body and retain reading order');
assert.match(record.sourceText, /12 VCCs8 shall ensure compliance against key AML\/CFT requirements/);
assert.match(record.sourceText, /ML\/TF risk management\./);
assert.match(record.sourceText, /C CONCLUSION/);
assert.match(record.sourceText, /2 MAS carried out a thematic review of VCCs and their managers in 2024/);
assert.match(record.sourceText, /Section 15\(1\) of the Variable Capital Companies Act 2018/,
  'the full-document replay retains the circular footnotes');
assert.equal(record.documentHash, capture.documentHash);
assert.equal(record.sourceLocator.pageCount, 5);
assert.equal(record.sourceLocator.tableStructure, 'NONE');
assert.equal(record.extractionStatus, 'EXACT', 'the genuine PDF bytes pass full-document structural replay');
assert.equal(record.isVerbatimText, true);
assert.equal(record.groundingEligible, false);
assert.equal(record.effectiveDate, undefined, '26 June 2025 publication date is not an effective date');
assert.equal(record.validFrom, undefined);
assert.equal(record.validTo, undefined);

const unknownHistory = await extractOfficialDocumentFromRetrieved({ ...request, asOfDate: '2025-06-26' }, structuralReplayEnvelope);
assert.equal(unknownHistory.status, 'REJECTED');
assert.equal(unknownHistory.code, 'HISTORICAL_DATE_UNVERIFIED');
assert.equal('record' in unknownHistory, false);

for (const incorrectRequest of [
  { ...request, authority: 'ACRA', domain: 'ACRA_CORP' },
  { ...request, domain: 'ACRA_CORP' }
]) {
  const isolationResult = await extractOfficialDocumentFromRetrieved(incorrectRequest, structuralReplayEnvelope);
  assert.equal(isolationResult.status, 'REJECTED', 'wrong MAS publisher authority or domain mapping must fail closed');
  assert.equal('record' in isolationResult, false);
}

const versioning = new SourceVersioningManager();
const admission = verifySharedDocumentAdmission({ ...record, documentAdmissionRequired: true }, versioning, {
  expectedAuthority: 'MAS',
  expectedDomain: 'MAS_FUNDS'
});
assert.equal(admission.required, true);
assert.equal(admission.admitted, false);
assert.equal(record.groundingEligible, false, 'an exact lab replay remains an unadmitted review candidate');

class ActualCaptureRetriever extends ControlledWebRetriever {
  fetchedUrls = [];

  async fetchOfficialDocument(url) {
    this.fetchedUrls.push(url);
    assert.equal(url, REQUEST_URL);
    return structuredClone(actualCaptureEnvelope);
  }
}

const registryBefore = structuredClone(UNIFIED_SOURCE_REGISTRY);
const retriever = new ActualCaptureRetriever();
const adapter = new MASDocumentUpdateAdapter([{
  recordId: RECORD_ID,
  extractionRequest: request,
  amendmentTitle: 'IID 04/2025 VCC governance circular'
}]);
const service = new LiveRegulatoryFeedService(versioning, undefined, retriever, [adapter]);
const updateCheck = await service.checkForUpdates();
assert.deepEqual(retriever.fetchedUrls, [REQUEST_URL]);
assert.equal(updateCheck.hasUpdates, false);
assert.deepEqual(updateCheck.packages, [], 'the actual capture has no HTTP status, MIME type, or verified final URL');
assert.deepEqual(service.getStagedPackages(), []);
assert.deepEqual(service.getVerifiedPackages(), []);
assert.deepEqual(service.getActivePackages(), []);
assert.deepEqual(versioning.getCandidates(), []);
assert.deepEqual(versioning.getAllLedgerEntries(), []);
assert.equal(versioning.getActiveVersionId(RECORD_ID), undefined);
assert.deepEqual(UNIFIED_SOURCE_REGISTRY, registryBefore);
assert.equal(service.approveUpdatePackage('MAS-NONEXISTENT-IID-04-2025', 'reviewer@example.test', 'No candidate exists'), false);
assert.equal((await service.activateUpdatePackage('MAS-NONEXISTENT-IID-04-2025')).success, false);
assert.deepEqual(service.getStagedPackages(), []);
assert.deepEqual(versioning.getCandidates(), []);

console.log('PASS | Genuine IID 04/2025 PDF bytes pass exact structural replay; incomplete captured HTTP trace still blocks admission and MAS activation');
