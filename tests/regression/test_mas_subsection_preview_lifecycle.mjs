import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { LiveRegulatoryFeedService } from '../../src/retrieval/liveRegulatoryFeed.ts';
import { MASDocumentUpdateAdapter } from '../../src/retrieval/masDocumentUpdateAdapter.ts';
import { InMemorySourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { SourceVersioningManager } from '../../src/standards/sourceVersioning.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { getSingaporeDateString } from '../../src/utils/dateUtils.ts';
import { CitationVerifier } from '../../src/verification/citationVerifier.ts';
import { verifyEvidenceClaims } from '../../src/verification/claimEvidenceVerifier.ts';

const INITIAL_ROOT = new URL('../fixtures/mas-reviewed/subsection-preview-20261016/', import.meta.url);
const RECAPTURE_ROOT = new URL('../fixtures/mas-reviewed/subsection-preview-recapture-20261016/', import.meta.url);
const requestFixture = JSON.parse(await readFile(new URL('../fixtures/mas-reviewed/subsection-requests-20261016.json', import.meta.url), 'utf8'));
const initialManifest = JSON.parse(await readFile(new URL('manifest.json', INITIAL_ROOT), 'utf8'));
const recaptureManifest = JSON.parse(await readFile(new URL('manifest.json', RECAPTURE_ROOT), 'utf8'));
const recordIds = requestFixture.documents.map(document => document.recordId);
assert.equal(recordIds.length, 2, 'the reviewed subsection fixture contains one HTML and one PDF request');
const htmlId = recordIds[0];
const pdfId = recordIds[1];
const registryBefore = new Map(recordIds.map(id => [id, UNIFIED_SOURCE_REGISTRY[id] && structuredClone(UNIFIED_SOURCE_REGISTRY[id])]));

assert.equal(initialManifest.status, 'EXTRACTION_READY');
assert.equal(recaptureManifest.status, 'EXTRACTION_READY');
assert.equal(initialManifest.documents.length, 2);
assert.equal(recaptureManifest.documents.length, 2);

async function readCapture(root, manifestDocument, requestedDocument) {
  assert.equal(manifestDocument.recordId, requestedDocument.recordId);
  assert.deepEqual(manifestDocument.request, requestedDocument.request,
    `${manifestDocument.recordId}: deployed capture uses the reviewed subsection request`);
  assert.equal(manifestDocument.fetch.status, 'SUCCESS');
  assert.equal(manifestDocument.fetch.httpStatus, 200);
  assert.equal(manifestDocument.fetch.sourceUrl, requestedDocument.request.url);
  assert.equal(manifestDocument.fetch.finalUrl, requestedDocument.request.url);
  assert.equal(manifestDocument.fetch.contentType.split(';', 1)[0].trim().toLowerCase(),
    requestedDocument.request.documentKind === 'PDF' ? 'application/pdf' : 'text/html');
  assert.equal(manifestDocument.integrity.observedHashMatchesBytes, true);
  assert.equal(manifestDocument.extraction.status, 'SUCCESS');
  assert.equal(manifestDocument.extraction.extractionStatus, 'EXACT');
  assert.equal(manifestDocument.extraction.isVerbatimText, true);
  const compressed = await readFile(new URL(manifestDocument.bodyFile, root));
  const bytes = gunzipSync(compressed);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  assert.equal(bytes.byteLength, manifestDocument.bodyBytes, `${manifestDocument.recordId}: captured byte count`);
  assert.equal(sha256, manifestDocument.integrity.computedSha256, `${manifestDocument.recordId}: independently computed body hash`);
  assert.equal(sha256, manifestDocument.fetch.contentHash, `${manifestDocument.recordId}: fetch metadata body hash`);
  assert.ok(manifestDocument.candidateRecord, `${manifestDocument.recordId}: extracted candidate is preserved`);
  assert.equal(manifestDocument.candidateRecord.sourceStatus, 'NEEDS_REVIEW');
  assert.equal(manifestDocument.candidateRecord.lifecycleState, 'CANDIDATE');
  assert.equal(manifestDocument.candidateRecord.groundingEligible, false);
  assert.equal(manifestDocument.candidateRecord.documentHash, sha256);
  assert.equal(manifestDocument.candidateRecord.effectiveDate, undefined,
    `${manifestDocument.recordId}: retrieval or publication metadata does not become an effective date`);
  assert.equal(manifestDocument.candidateRecord.validFrom, undefined);
  return { document: manifestDocument, bytes: new Uint8Array(bytes) };
}

const initialById = new Map();
const recaptureById = new Map();
for (const requested of requestFixture.documents) {
  const initial = initialManifest.documents.find(document => document.recordId === requested.recordId);
  const recapture = recaptureManifest.documents.find(document => document.recordId === requested.recordId);
  assert.ok(initial, `${requested.recordId}: initial deployed capture exists`);
  assert.ok(recapture, `${requested.recordId}: recapture exists`);
  initialById.set(requested.recordId, await readCapture(INITIAL_ROOT, initial, requested));
  recaptureById.set(requested.recordId, await readCapture(RECAPTURE_ROOT, recapture, requested));
}

const pdfRequest = requestFixture.documents.find(document => document.recordId === pdfId).request;
const initialHtml = initialById.get(htmlId);
const replacementHtml = recaptureById.get(htmlId);
const initialPdf = initialById.get(pdfId);
const recapturedPdf = recaptureById.get(pdfId);
assert.notEqual(initialHtml.document.fetch.contentHash, replacementHtml.document.fetch.contentHash,
  'the later genuine HTML response must be a distinct byte snapshot; do not fabricate a replacement if its bytes are identical');
assert.equal(initialPdf.document.fetch.contentHash, recapturedPdf.document.fetch.contentHash,
  'the later PDF capture is the same document snapshot and must not create a PDF replacement');
assert.equal(initialHtml.document.candidateRecord.provisionHash, replacementHtml.document.candidateRecord.provisionHash,
  'the HTML replacement retains the same selected provision text');
assert.equal(initialHtml.document.candidateRecord.sourceText, replacementHtml.document.candidateRecord.sourceText);

const originalHtmlParagraph = initialHtml.document.candidateRecord.sourceText.match(
  /In addition, your company needs to operate from a dedicated and secure office space[^.]*\./i
);
assert.ok(originalHtmlParagraph, 'the selected HTML section retains its substantive office-control requirement');
const pdfSubsectionText = initialPdf.document.candidateRecord.sourceText;
const pdfSourceBlocks = pdfSubsectionText
  .normalize('NFC')
  .replace(/\u00a0/g, ' ')
  .split(/\r?\n[\t ]*\r?\n+/)
  .map(block => block.trim())
  .filter(Boolean);
assert.equal(pdfSourceBlocks.length, 2, 'the bounded PDF source preserves one full body block and its footnote block');
assert.equal(pdfSourceBlocks.join('\n\n'), pdfSubsectionText.trim(), 'the two exact quotations cover the complete stored PDF source text');
assert.equal(pdfRequest.sectionHeading, 'Substantive Fund Management Activity');
assert.equal(pdfRequest.sectionEndHeading, 'Anti-Money Laundering and Countering the Financing of Terrorism (AML/CFT)');
assert.equal(initialPdf.document.candidateRecord.paragraphOrSection, pdfRequest.sectionHeading);
assert.equal(initialPdf.document.candidateRecord.sourceLocator.heading, pdfRequest.sectionHeading);
assert.match(pdfSubsectionText, /\b9\s+The review observed\b/i);
assert.match(pdfSubsectionText, /\b10\s+/i, 'the bounded subsection contains paragraph 10 and its continuation');
assert.match(pdfSubsectionText, /\(i\)[\s\S]*?\(ii\)[\s\S]*?\(iii\)/i,
  'the subsection preserves all three roman-numbered clauses');
assert.match(pdfSubsectionText, /\b7\b/, 'the subsection preserves footnote 7');
assert.match(pdfSourceBlocks[1], /^7\s+Paragraph 3\.3 of Guidelines on Licensing and Conduct of Business for Fund Management Companies$/i,
  'the second complete source block preserves footnote 7 and its full reference');
assert.doesNotMatch(pdfSubsectionText, /Anti-Money Laundering and Countering the Financing of Terrorism \(AML\/CFT\)/i,
  'the exact AML/CFT end heading is excluded from the preceding subsection');
assert.doesNotMatch(pdfSubsectionText, /(?:^|\n)\s*(?:footnote|note)\s*(?:6|8|9)\b/i,
  'unrelated notes 6, 8, and 9 are excluded');

function retrievedCapture(capture) {
  const { fetch } = capture.document;
  return {
    status: 'SUCCESS',
    httpStatus: fetch.httpStatus,
    sourceUrl: fetch.sourceUrl,
    finalUrl: fetch.finalUrl,
    contentType: fetch.contentType,
    contentBytes: new Uint8Array(capture.bytes),
    retrievedAt: fetch.retrievedAt,
    ...(fetch.etag ? { etag: fetch.etag } : {}),
    ...(fetch.lastModified ? { lastModified: fetch.lastModified } : {})
  };
}

class CapturedResponseRetriever extends ControlledWebRetriever {
  constructor(captures) {
    super();
    this.captures = new Map(captures);
  }

  setCapture(recordId, capture) { this.captures.set(recordId, capture); }

  async fetchOfficialDocument(url) {
    const capture = [...this.captures.values()].find(item => item.document.request.url === url);
    assert.ok(capture, `no captured HTTP response is configured for ${url}`);
    return retrievedCapture(capture);
  }
}

function rawDocumentsFor(pkg, captures) {
  return Object.fromEntries(pkg.updates.map(record => {
    const request = pkg.extractionRequests[record.id];
    const capture = [...captures.values()].find(item => item.document.request.url === request.url);
    assert.ok(capture, `${record.id}: raw bytes match the staged extraction request`);
    return [record.id, retrievedCapture(capture)];
  }));
}

function evidenceProof(record, targetDate, retriever, versioning) {
  const quotes = record.id === pdfId ? pdfSourceBlocks : [originalHtmlParagraph[0].trim()];
  const claims = quotes.map(quote => ({
    kind: 'RULE', text: quote, quote, recordId: record.id, citationUrl: record.officialSourceUrl
  }));
  const checked = verifyEvidenceClaims(claims, [record], {
    missingFacts: [], targetDate, referenceDate: targetDate,
    expectedAuthority: 'MAS', expectedDomain: 'MAS_FUNDS', versioningManager: versioning
  });
  assert.equal(checked.accepted.length, quotes.length, checked.rejected[0]?.reason);
  const bindings = checked.accepted.map(item => item.sourceBinding);
  const citations = quotes.map((quote, index) => ({
    standard: record.standardOrActCode,
    paragraph: record.paragraphOrSection,
    title: record.documentTitle,
    text: quote,
    officialSourceUrl: record.officialSourceUrl,
    authority: 'MAS',
    sourceBinding: bindings[index]
  }));
  const verifier = new CitationVerifier(retriever, targetDate, versioning);
  const verifiedCitations = citations.map(citation => verifier.verifyCitation(citation, 'MAS', [record], {
    targetDate, referenceDate: targetDate, expectedAuthority: 'MAS', expectedDomain: 'MAS_FUNDS'
  }));
  for (let index = 0; index < verifiedCitations.length; index += 1) {
    assert.equal(verifiedCitations[index].isValid, true, verifiedCitations[index].reason);
    assert.deepEqual(verifiedCitations[index].sourceBinding, bindings[index]);
    assert.deepEqual(bindings[index], bindings[0], 'each exact source block binds the same active document version and locator');
  }
  const activeVersionId = versioning.getActiveVersionId(record.id);
  const ledgerEntry = versioning.getLedgerEntry(activeVersionId);
  for (const binding of bindings) {
    assert.equal(binding.versionId, activeVersionId);
    assert.equal(binding.documentHash, ledgerEntry.recordSnapshot.documentHash);
    assert.equal(binding.provisionHash, ledgerEntry.recordSnapshot.provisionHash);
    assert.deepEqual(binding.sourceLocator, ledgerEntry.recordSnapshot.sourceLocator);
  }
  return { quote: quotes[0], quotes, binding: bindings[0], citation: citations[0], citations, verifier };
}

const versioning = new SourceVersioningManager();
const captureRetriever = new CapturedResponseRetriever(initialById);
const adapter = new MASDocumentUpdateAdapter(requestFixture.documents.map(document => ({
  recordId: document.recordId,
  extractionRequest: document.request
})));
const service = new LiveRegulatoryFeedService(versioning, undefined, captureRetriever, [adapter]);
// Construct before activation so answer retrieval depends on the shared managed registry.
const answerRetriever = new InMemorySourceRetriever(undefined, versioning);

try {
  for (const id of recordIds) assert.equal(UNIFIED_SOURCE_REGISTRY[id], undefined, `${id}: isolated registry id is unused`);
  const firstCheck = await service.checkForUpdates();
  assert.equal(firstCheck.packages.length, 1);
  const firstPackage = firstCheck.packages[0];
  assert.deepEqual(firstPackage.updates.map(record => record.id), recordIds);
  for (const capture of initialById.values()) {
    const id = capture.document.recordId;
    const metadata = firstPackage.documentMetadata[id];
    assert.equal(metadata.httpStatus, 200);
    assert.equal(metadata.contentType, capture.document.fetch.contentType);
    assert.equal(metadata.sourceUrl, capture.document.fetch.sourceUrl);
    assert.equal(metadata.finalUrl, capture.document.fetch.finalUrl);
    assert.equal(metadata.retrievedAt, capture.document.fetch.retrievedAt);
    assert.equal(firstPackage.updates.find(record => record.id === id).documentHash, capture.document.fetch.contentHash);
    assert.equal(answerRetriever.getSourceById(id), undefined, 'a candidate is not answer-retrievable before activation');
  }

  assert.equal((await service.stageUpdatePackage(firstPackage)).success, true);
  assert.equal((await service.activateUpdatePackage(firstPackage.packageId)).success, false,
    'staging alone cannot activate the captured sources');
  const firstVerification = await service.verifyUpdatePackage(firstPackage.packageId, rawDocumentsFor(firstPackage, initialById));
  assert.equal(firstVerification.isValid, true, firstVerification.rejectionReason);
  assert.equal((await service.activateUpdatePackage(firstPackage.packageId)).success, false,
    'verification alone cannot activate without explicit review approval');
  assert.equal(service.approveUpdatePackage(firstPackage.packageId, 'engineering-reviewer@example.test',
    'Offline engineering test receipt only; not legal or production approval'), true);
  assert.equal((await service.activateUpdatePackage(firstPackage.packageId)).success, true);

  const activeHtml = answerRetriever.getSourceById(htmlId);
  const activePdf = answerRetriever.getSourceById(pdfId);
  assert.ok(activeHtml && activePdf);
  assert.equal(activeHtml.effectiveDate, undefined);
  assert.equal(activePdf.effectiveDate, undefined);
  const htmlDate = getSingaporeDateString(initialHtml.document.fetch.retrievedAt);
  const pdfDate = getSingaporeDateString(initialPdf.document.fetch.retrievedAt);
  const htmlResults = await answerRetriever.retrieveSources({
    query: 'MAS fund management licensing admission criteria Securities and Futures Act office controls',
    authorities: ['MAS'], domain: 'MAS_FUNDS', targetDate: htmlDate, referenceDate: htmlDate
  });
  const pdfResults = await answerRetriever.retrieveSources({
    query: 'MAS IID 04/2025 substantive fund management activity VCC managers paragraphs 9 and 10',
    authorities: ['MAS'], domain: 'MAS_FUNDS', targetDate: pdfDate, referenceDate: pdfDate
  });
  assert.ok(htmlResults.some(record => record.id === htmlId), 'the captured HTML evidence is retrievable on its Singapore capture day');
  assert.ok(pdfResults.some(record => record.id === pdfId), 'the complete bounded PDF subsection is retrievable on its Singapore capture day');
  const firstHtmlProof = evidenceProof(activeHtml, htmlDate, answerRetriever, versioning);
  const firstPdfProof = evidenceProof(activePdf, pdfDate, answerRetriever, versioning);
  const wholePdfClaim = verifyEvidenceClaims([{
    kind: 'RULE', text: pdfSubsectionText, quote: pdfSubsectionText, recordId: pdfId
  }], [activePdf], {
    missingFacts: [], targetDate: pdfDate, referenceDate: pdfDate,
    expectedAuthority: 'MAS', expectedDomain: 'MAS_FUNDS', versioningManager: versioning
  });
  assert.equal(wholePdfClaim.accepted.length, 0, 'a multi-block source extract is not admitted as one quote');
  assert.equal(wholePdfClaim.rejected[0]?.reason, 'QUOTE_NOT_WHOLE_SENTENCE_OR_PARAGRAPH');

  const wrongAuthority = verifyEvidenceClaims([{
    kind: 'RULE', text: firstHtmlProof.quote, quote: firstHtmlProof.quote, recordId: htmlId
  }], [activeHtml], {
    missingFacts: [], targetDate: htmlDate, referenceDate: htmlDate,
    expectedAuthority: 'IRAS', expectedDomain: 'MAS_FUNDS', versioningManager: versioning
  });
  assert.equal(wrongAuthority.accepted.length, 0, 'wrong-authority claims are rejected');
  const wrongDomain = verifyEvidenceClaims([{
    kind: 'RULE', text: firstHtmlProof.quote, quote: firstHtmlProof.quote, recordId: htmlId
  }], [activeHtml], {
    missingFacts: [], targetDate: htmlDate, referenceDate: htmlDate,
    expectedAuthority: 'MAS', expectedDomain: 'IRAS_TAX', versioningManager: versioning
  });
  assert.equal(wrongDomain.accepted.length, 0, 'wrong-domain claims are rejected');
  const historical = await answerRetriever.retrieveSources({
    query: 'MAS IID 04/2025 substantive fund management activity VCC managers',
    authorities: ['MAS'], domain: 'MAS_FUNDS', targetDate: '2025-06-26', referenceDate: pdfDate
  });
  assert.equal(historical.some(record => record.id === pdfId), false,
    'the publication date does not establish applicability before the actual capture date');
  const wrongHashCitation = structuredClone(firstPdfProof.citation);
  wrongHashCitation.sourceBinding.documentHash = '0'.repeat(64);
  assert.equal(firstPdfProof.verifier.verifyCitation(wrongHashCitation, 'MAS', [activePdf], {
    targetDate: pdfDate, referenceDate: pdfDate, expectedAuthority: 'MAS', expectedDomain: 'MAS_FUNDS'
  }).isValid, false, 'a citation with a changed document hash loses its binding');

  captureRetriever.setCapture(htmlId, replacementHtml);
  const replacementCheck = await service.checkForUpdates();
  assert.equal(replacementCheck.packages.length, 1);
  const replacementPackage = replacementCheck.packages[0];
  assert.deepEqual(replacementPackage.updates.map(record => record.id), [htmlId],
    'the unchanged PDF remains active while only the new HTML byte snapshot is staged');
  assert.equal(replacementPackage.updates[0].sourceText, activeHtml.sourceText);
  assert.equal(replacementPackage.updates[0].provisionHash, activeHtml.provisionHash);
  assert.notEqual(replacementPackage.updates[0].documentHash, activeHtml.documentHash);
  assert.equal((await service.stageUpdatePackage(replacementPackage)).success, true);
  assert.equal((await service.verifyUpdatePackage(replacementPackage.packageId,
    rawDocumentsFor(replacementPackage, new Map([[htmlId, replacementHtml]])))).isValid, true);
  assert.equal((await service.activateUpdatePackage(replacementPackage.packageId)).success, false,
    'a replacement also waits for review approval');
  assert.equal(service.approveUpdatePackage(replacementPackage.packageId, 'engineering-reviewer@example.test',
    'Offline engineering test receipt for a same-provision byte recapture only'), true);
  assert.equal((await service.activateUpdatePackage(replacementPackage.packageId)).success, true);

  const replacementActiveHtml = answerRetriever.getSourceById(htmlId);
  const replacementActivePdf = answerRetriever.getSourceById(pdfId);
  assert.notEqual(replacementActiveHtml.versionId, activeHtml.versionId);
  assert.equal(replacementActiveHtml.documentHash, replacementHtml.document.fetch.contentHash);
  assert.equal(replacementActiveHtml.provisionHash, activeHtml.provisionHash);
  assert.equal(replacementActivePdf.versionId, activePdf.versionId, 'the PDF binding is unchanged by an HTML-only replacement');
  assert.equal(firstHtmlProof.verifier.verifyCitation(firstHtmlProof.citation, 'MAS', [replacementActiveHtml]).isValid, false,
    'the prior HTML citation becomes stale after replacement');
  const replacementHtmlDate = getSingaporeDateString(replacementHtml.document.fetch.retrievedAt);
  const replacementHtmlProof = evidenceProof(replacementActiveHtml, replacementHtmlDate, answerRetriever, versioning);
  assert.notEqual(replacementHtmlProof.binding.versionId, firstHtmlProof.binding.versionId);

  assert.equal((await service.rollbackUpdatePackage(replacementPackage.packageId)).success, true);
  const restoredHtml = answerRetriever.getSourceById(htmlId);
  const restoredPdf = answerRetriever.getSourceById(pdfId);
  assert.equal(restoredHtml.versionId, firstHtmlProof.binding.versionId);
  assert.equal(restoredHtml.documentHash, firstHtmlProof.binding.documentHash);
  assert.equal(restoredPdf.versionId, firstPdfProof.binding.versionId, 'HTML rollback preserves the active PDF version');
  assert.equal(restoredPdf.documentHash, activePdf.documentHash);
  assert.equal(new CitationVerifier(answerRetriever, htmlDate, versioning).verifyCitation(
    firstHtmlProof.citation, 'MAS', [restoredHtml], {
      targetDate: htmlDate, referenceDate: htmlDate, expectedAuthority: 'MAS', expectedDomain: 'MAS_FUNDS'
    }
  ).isValid, true, 'rollback restores the original HTML citation binding');

  assert.equal((await service.rollbackUpdatePackage(firstPackage.packageId)).success, true);
  for (const id of recordIds) {
    assert.equal(UNIFIED_SOURCE_REGISTRY[id], undefined, `${id}: first-package rollback removes the isolated registry row`);
    assert.equal(answerRetriever.getSourceById(id), undefined, `${id}: first-package rollback removes answer retrieval`);
  }
} finally {
  for (const [id, original] of registryBefore) {
    if (original) UNIFIED_SOURCE_REGISTRY[id] = original;
    else delete UNIFIED_SOURCE_REGISTRY[id];
  }
}

console.log('PASS | New MAS HTML/PDF subsection captures: byte verification, approval, answer retrieval, binding, replacement and rollback');
