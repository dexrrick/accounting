import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mock } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { defaultExternalSourceValidator } from '../../src/retrieval/externalSourceValidator.ts';
import { LiveRegulatoryFeedService } from '../../src/retrieval/liveRegulatoryFeed.ts';
import { MASDocumentUpdateAdapter } from '../../src/retrieval/masDocumentUpdateAdapter.ts';
import { InMemorySourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { extractOfficialDocumentFromRetrieved } from '../../src/retrieval/officialDocumentExtractor.ts';
import { SourceVersioningManager } from '../../src/standards/sourceVersioning.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { CitationVerifier } from '../../src/verification/citationVerifier.ts';
import { verifyEvidenceClaims } from '../../src/verification/claimEvidenceVerifier.ts';
import { getSingaporeDateString } from '../../src/utils/dateUtils.ts';

const CAPTURE_DAY = '2026-10-16';
const POST_CAPTURE_DAY = '2026-10-17';
const CONTEXT_ROOT = new URL('../fixtures/mas-reviewed/transport-investigation-20261016-context-live/', import.meta.url);
const RECAPTURE_ROOT = new URL('../fixtures/mas-reviewed/transport-investigation-20261016-genuine-recapture/', import.meta.url);
const acceptanceReport = JSON.parse(await readFile(new URL('../fixtures/mas-reviewed/transport-investigation-20261016-acceptance.json', import.meta.url), 'utf8'));
const contextManifest = JSON.parse(await readFile(new URL('manifest.json', CONTEXT_ROOT), 'utf8'));
const contextTransport = JSON.parse(await readFile(new URL('transport-diagnostic.json', CONTEXT_ROOT), 'utf8'));
const recaptureManifest = JSON.parse(await readFile(new URL('manifest.json', RECAPTURE_ROOT), 'utf8'));
const HTML_ID = contextManifest.documents[0].recordId;
const PDF_ID = contextManifest.documents[1].recordId;
const htmlDoc = contextManifest.documents[0];
const htmlReplacementDoc = recaptureManifest.documents.find(item => item.recordId === HTML_ID);
const pdfDoc = contextManifest.documents[1];
const registryBefore = structuredClone(UNIFIED_SOURCE_REGISTRY);

function getSourceByIdAtDate(retriever, recordId, date) {
  mock.timers.enable({ apis: ['Date'], now: new Date(`${date}T04:00:00.000Z`) });
  try {
    return retriever.getSourceById(recordId);
  } finally {
    mock.timers.reset();
  }
}

function readCapture(root, doc) {
  return readFile(new URL(doc.bodyFile, root)).then(compressed => {
    const bytes = gunzipSync(compressed);
    assert.equal(bytes.byteLength, doc.bodyBytes, `${doc.recordId}: captured entity size`);
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash, doc.integrity.computedSha256, `${doc.recordId}: independently computed byte hash`);
    assert.equal(hash, doc.fetch.contentHash, `${doc.recordId}: fetch manifest hash`);
    assert.equal(doc.integrity.observedHashMatchesBytes, true);
    assert.equal(doc.fetch.status, 'SUCCESS');
    assert.equal(doc.fetch.httpStatus, 200);
    assert.equal(doc.fetch.sourceUrl, doc.request.url);
    assert.equal(doc.fetch.finalUrl, doc.request.url);
    return new Uint8Array(bytes);
  });
}

const originalHtmlBytes = await readCapture(CONTEXT_ROOT, htmlDoc);
const replacementHtmlBytes = await readCapture(RECAPTURE_ROOT, htmlReplacementDoc);
const pdfBytes = await readCapture(CONTEXT_ROOT, pdfDoc);

assert.equal(htmlDoc.fetch.contentType, 'text/html; charset=utf-8');
assert.equal(pdfDoc.fetch.contentType, 'application/pdf');
  assert.equal(getSingaporeDateString(htmlDoc.fetch.retrievedAt), CAPTURE_DAY,
    'the immutable HTML retrieval timestamp remains on its declared capture day');
  assert.equal(getSingaporeDateString(pdfDoc.fetch.retrievedAt), CAPTURE_DAY,
    'the immutable PDF retrieval timestamp remains on its declared capture day');
  assert.equal(getSingaporeDateString(htmlReplacementDoc.fetch.retrievedAt), CAPTURE_DAY,
    'the immutable replacement retrieval timestamp remains on its declared capture day');
assert.equal(pdfDoc.fetch.lastModified, 'Thu, 26 Jun 2025 09:14:46 GMT');
assert.equal(pdfDoc.fetch.etag, null);
assert.equal(htmlDoc.fetch.etag, null);
assert.equal(htmlReplacementDoc.fetch.contentType, 'text/html; charset=utf-8');
assert.notEqual(htmlDoc.fetch.contentHash, htmlReplacementDoc.fetch.contentHash,
  'the later genuine same-page response is a distinct byte snapshot');
assert.equal(contextTransport.documents.every(document => document.redirectsObserved === 0 &&
  document.retrieval.finalUrl === document.requestedUrl), true,
'the original capture records same-URL responses with no observed redirects');
assert.equal(htmlReplacementDoc.fetch.finalUrl, htmlReplacementDoc.request.url,
  'the captured recapture metadata records its same-URL final response');
assert.equal(acceptanceReport.acceptance, 'ISOLATED_ENGINEERING_ACCEPTANCE_ONLY');
assert.equal(acceptanceReport.productionOrLegalApproval, 'NOT_ESTABLISHED');
assert.equal(acceptanceReport.documents[1].wholeDocumentStageAttempt, 'BLOCKED_NO_UNIQUE_PAGE_LOCATOR');

const htmlRequest = structuredClone(htmlDoc.request);
const pdfWholeDocumentRequest = structuredClone(pdfDoc.request);
delete pdfWholeDocumentRequest.sectionHeading;
assert.equal(pdfWholeDocumentRequest.sectionHeading, undefined,
  'the positive PDF request explicitly selects the whole document');
const pdfParagraphRequest = structuredClone(pdfWholeDocumentRequest);
pdfParagraphRequest.relevantSection = '9 The review observed a small number of VCC managers as managing multiple VCCs that';

function retrievedEnvelope(doc, bytes) {
  return {
    status: 'SUCCESS',
    httpStatus: doc.fetch.httpStatus,
    sourceUrl: doc.fetch.sourceUrl,
    finalUrl: doc.fetch.finalUrl,
    contentType: doc.fetch.contentType,
    contentBytes: new Uint8Array(bytes),
    retrievedAt: doc.fetch.retrievedAt,
    ...(doc.fetch.etag ? { etag: doc.fetch.etag } : {}),
    ...(doc.fetch.lastModified ? { lastModified: doc.fetch.lastModified } : {})
  };
}

const originalHtmlEnvelope = retrievedEnvelope(htmlDoc, originalHtmlBytes);
const replacementHtmlEnvelope = retrievedEnvelope(htmlReplacementDoc, replacementHtmlBytes);
const pdfEnvelope = retrievedEnvelope(pdfDoc, pdfBytes);

const originalHtmlExtraction = await extractOfficialDocumentFromRetrieved(htmlRequest, originalHtmlEnvelope);
assert.equal(originalHtmlExtraction.status, 'SUCCESS', originalHtmlExtraction.status === 'REJECTED' ? originalHtmlExtraction.reason : '');
const originalHtmlRecord = originalHtmlExtraction.record;
assert.equal(originalHtmlRecord.standardOrActCode, 'MAS-FUND-MANAGEMENT-LICENSING');
assert.match(originalHtmlRecord.documentTitle, /Fund Management Licensing/i);
assert.match(originalHtmlRecord.sourceText, /What are the admission criteria and applicable requirements\?/i);
const originalHtmlText = new TextDecoder('utf-8', { fatal: true }).decode(originalHtmlBytes);
assert.match(originalHtmlText, /Securities and Futures Act 2001\s*\(SFA\)/i,
  'the full captured page defines the exact Act name and its abbreviation');
assert.match(originalHtmlRecord.sourceText, /\bSFA\b/i,
  'the selected criteria section uses the abbreviation defined elsewhere in the same official page');
assert.match(originalHtmlRecord.sourceText.toLowerCase(), /fund management/);
assert.equal(originalHtmlRecord.documentHash, htmlDoc.fetch.contentHash);
assert.equal(originalHtmlRecord.effectiveDate, undefined, 'the undated current capture does not invent an effective date');
assert.equal(originalHtmlRecord.validFrom, undefined);

const replacementHtmlExtraction = await extractOfficialDocumentFromRetrieved(htmlRequest, replacementHtmlEnvelope);
assert.equal(replacementHtmlExtraction.status, 'SUCCESS', replacementHtmlExtraction.status === 'REJECTED' ? replacementHtmlExtraction.reason : '');
const replacementHtmlRecord = replacementHtmlExtraction.record;
assert.equal(replacementHtmlRecord.sourceText, originalHtmlRecord.sourceText,
  'the later snapshot retains the same selected provision text');
assert.equal(replacementHtmlRecord.provisionHash, originalHtmlRecord.provisionHash,
  'same selected provision text retains its exact provision hash');
assert.notEqual(replacementHtmlRecord.documentHash, originalHtmlRecord.documentHash,
  'the entire captured page changed even though selected text did not');

const requestedHeadingPdf = await extractOfficialDocumentFromRetrieved(pdfDoc.request, pdfEnvelope);
assert.equal(requestedHeadingPdf.status, 'REJECTED');
assert.equal(requestedHeadingPdf.code, 'PDF_SECTION_NOT_SUBSTANTIVE',
  'the genuine heading-only section remains rejected');
const fullPdfExtraction = await extractOfficialDocumentFromRetrieved(pdfWholeDocumentRequest, pdfEnvelope);
assert.equal(fullPdfExtraction.status, 'SUCCESS', fullPdfExtraction.status === 'REJECTED' ? fullPdfExtraction.reason : '');
const pdfRecord = fullPdfExtraction.record;
assert.equal(pdfRecord.documentHash, pdfDoc.fetch.contentHash);
assert.equal(pdfRecord.extractionStatus, 'EXACT');
assert.equal(pdfRecord.sourceLocator.sourceType, 'PDF');
assert.ok(pdfRecord.sourceLocator.pageCount >= 1);
assert.match(pdfRecord.documentTitle, /GOVERNANCE AND MANAGEMENT OF VARIABLE CAPITAL COMPANIES/i);
assert.match(pdfRecord.sourceText, /A PROFILE OF VCCs AND KEY REGULATORY REQUIREMENTS/i);
assert.match(pdfRecord.sourceText, /Section 15\(1\) of the Variable Capital Companies Act 2018/i);
assert.equal(pdfRecord.effectiveDate, undefined,
  'the observed publication Last-Modified date is not treated as an effective date');
assert.equal(pdfRecord.validFrom, undefined);
assert.equal(pdfRecord.sourceLocator.pageNumber, undefined,
  'whole-document PDF selection has no single page locator to claim');
const paragraphPdfExtraction = await extractOfficialDocumentFromRetrieved(pdfParagraphRequest, pdfEnvelope);
assert.equal(paragraphPdfExtraction.status, 'SUCCESS', paragraphPdfExtraction.status === 'REJECTED' ? paragraphPdfExtraction.reason : '');
const paragraphPdfRecord = paragraphPdfExtraction.record;
assert.match(paragraphPdfRecord.sourceText, /^9 The review observed a small number of VCC managers as managing multiple VCCs that/i);
assert.match(paragraphPdfRecord.sourceText, /down VCCs that hold no assets and\/or have no investors\./i,
  'the paragraph request contains the captured paragraph 9 closing sentence');
assert.doesNotMatch(paragraphPdfRecord.sourceText, /10 Another/i,
  'the exact paragraph boundary excludes the next numbered paragraph');
assert.ok(paragraphPdfRecord.sourceLocator.pageNumber >= 1,
  'the bounded paragraph has a concrete PDF page locator');
assert.equal(paragraphPdfRecord.documentHash, pdfRecord.documentHash);

const historicalPdf = await extractOfficialDocumentFromRetrieved({ ...pdfWholeDocumentRequest, asOfDate: '2025-06-26' }, pdfEnvelope);
assert.equal(historicalPdf.status, 'REJECTED');
assert.equal(historicalPdf.code, 'HISTORICAL_DATE_UNVERIFIED');

async function syntheticExtraction({ includeMain }) {
  const documentUrl = `https://www.mas.gov.sg/regulation/notices/synthetic-${includeMain ? 'main' : 'article'}`;
  const request = {
    url: documentUrl,
    authority: 'MAS',
    domain: 'MAS_FUNDS',
    standardOrActCode: 'MAS-NOTICE-786',
    legalOrStandardInstrument: 'MAS Notice 786',
    documentKind: 'HTML',
    expectedTopic: {
      standardIdentifiers: ['MAS Notice 786'],
      expectedTitles: ['MAS Notice 786 on Fund Valuation'],
      topicTerms: ['investment fund', 'valuation']
    }
  };
  const documentMarkup = '<h1>MAS Notice 786 on Fund Valuation</h1><h2>Section 3 Valuation of investment funds</h2><p>MAS Notice 786 requires licensed investment fund managers to document consistent asset valuation controls.</p>';
  const html = `<!doctype html><html><head><title>MAS Notice 786 on Fund Valuation</title></head><body>${includeMain
    ? `<article><h1>MAS portal masthead</h1><p>Portal masthead unrelated to the requested notice.</p></article><main>${documentMarkup}</main>`
    : `<article>${documentMarkup}</article>`}</body></html>`;
  const bytes = new TextEncoder().encode(html);
  return extractOfficialDocumentFromRetrieved(request, {
    status: 'SUCCESS', httpStatus: 200, sourceUrl: documentUrl, finalUrl: documentUrl,
    contentType: 'text/html; charset=utf-8', contentBytes: bytes, retrievedAt: '2026-10-15T22:34:49.077Z'
  });
}

const mainWins = await syntheticExtraction({ includeMain: true });
assert.equal(mainWins.status, 'SUCCESS', mainWins.status === 'REJECTED' ? mainWins.reason : '');
const articleFallback = await syntheticExtraction({ includeMain: false });
assert.equal(articleFallback.status, 'SUCCESS', articleFallback.status === 'REJECTED' ? articleFallback.reason : '');
assert.match(articleFallback.record.sourceText, /consistent asset valuation controls/i,
  'a correctly paired article remains the content fallback when main is absent');
const syntheticExpectation = {
  standardIdentifiers: ['MAS Notice 786'],
  expectedTitles: ['MAS Notice 786 on Fund Valuation'],
  topicTerms: ['investment fund', 'valuation']
};
const syntheticMainMarkup = '<!doctype html><html><head><title>MAS Notice 786 on Fund Valuation</title></head><body><article><h1>MAS portal masthead</h1><p>Portal masthead unrelated to the requested notice.</p></article><main><h1>MAS Notice 786 on Fund Valuation</h1><p>MAS Notice 786 requires licensed investment fund managers to document consistent asset valuation controls.</p></main></body></html>';
const syntheticArticleMarkup = '<!doctype html><html><head><title>MAS Notice 786 on Fund Valuation</title></head><body><article><h1>MAS Notice 786 on Fund Valuation</h1><p>MAS Notice 786 requires licensed investment fund managers to document consistent asset valuation controls.</p></article></body></html>';
const mainValidation = defaultExternalSourceValidator.validateTopicContent(syntheticMainMarkup, syntheticExpectation);
assert.equal(mainValidation.isValid, true, mainValidation.reason);
assert.doesNotMatch(mainValidation.substantiveText || '', /portal masthead unrelated/i,
  'a preceding article cannot displace the matched main body during topic validation');
const articleValidation = defaultExternalSourceValidator.validateTopicContent(syntheticArticleMarkup, syntheticExpectation);
assert.equal(articleValidation.isValid, true, articleValidation.reason);
assert.match(articleValidation.substantiveText || '', /consistent asset valuation controls/i,
  'a correctly paired article remains the topic-validation fallback when main is absent');

class CapturedResponseRetriever extends ControlledWebRetriever {
  constructor() {
    super();
    this.captures = new Map([
      [htmlRequest.url, { doc: htmlDoc, bytes: originalHtmlBytes }],
      [pdfWholeDocumentRequest.url, { doc: pdfDoc, bytes: pdfBytes }]
    ]);
    this.fetchedUrls = [];
  }

  setHtmlReplacement() {
    this.captures.set(htmlRequest.url, { doc: htmlReplacementDoc, bytes: replacementHtmlBytes });
  }

  async fetchOfficialDocument(url) {
    this.fetchedUrls.push(url);
    const capture = this.captures.get(url);
    assert.ok(capture, `no original HTTP capture configured for ${url}`);
    return retrievedEnvelope(capture.doc, capture.bytes);
  }
}

function currentRawDocuments(pkg, fetcher) {
  return Object.fromEntries(pkg.updates.map(record => {
    const request = pkg.extractionRequests[record.id];
    const capture = fetcher.captures.get(request.url);
    assert.ok(capture, `${record.id}: raw captured response exists for re-verification`);
    return [record.id, retrievedEnvelope(capture.doc, capture.bytes)];
  }));
}

function quoteFor(record) {
  if (record.id === PDF_ID) {
    assert.match(record.sourceText, /^9 The review observed/i);
    assert.match(record.sourceText, /down VCCs that hold no assets and\/or have no investors\.$/i);
    assert.doesNotMatch(record.sourceText, /10 Another/i);
    return record.sourceText.trim();
  }
  const quote = record.sourceText.match(/In addition, your company needs to operate from a dedicated and secure office space that is accessible only by your company[’']s directors and staff\./i)?.[0];
  assert.ok(quote, `${record.id}: the selected criteria contains its substantive office-control requirement`);
  return quote;
}

function bindingAndCitation(record, retriever, versioning) {
  const quote = quoteFor(record);
  const claim = { kind: 'RULE', text: quote, quote, recordId: record.id, citationUrl: record.officialSourceUrl };
  const claims = verifyEvidenceClaims([claim], [record], {
    missingFacts: [], expectedAuthority: 'MAS', expectedDomain: 'MAS_FUNDS',
    targetDate: CAPTURE_DAY, referenceDate: CAPTURE_DAY, versioningManager: versioning
  });
  assert.equal(claims.accepted.length, 1, claims.rejected[0]?.reason);
  const binding = claims.accepted[0].sourceBinding;
  const citation = {
    standard: record.standardOrActCode,
    paragraph: record.paragraphOrSection,
    title: record.documentTitle,
    text: quote,
    officialSourceUrl: record.officialSourceUrl,
    authority: 'MAS',
    sourceBinding: binding
  };
  const verifier = new CitationVerifier(retriever, CAPTURE_DAY, versioning);
  const verified = verifier.verifyCitation(citation, 'MAS', [record]);
  assert.equal(verified.isValid, true, verified.reason);
  assert.deepEqual(verified.sourceBinding, binding);
  return { quote, binding, citation, verifier };
}

const versioning = new SourceVersioningManager();
const fetcher = new CapturedResponseRetriever();
const pdfOnlyVersioning = new SourceVersioningManager();
const pdfOnlyService = new LiveRegulatoryFeedService(pdfOnlyVersioning, undefined, fetcher, [
  new MASDocumentUpdateAdapter([{ recordId: PDF_ID, extractionRequest: pdfWholeDocumentRequest }])
]);
const pdfOnlyCheck = await pdfOnlyService.checkForUpdates();
assert.equal(pdfOnlyCheck.packages.length, 1, 'genuine whole-document PDF extraction reaches the MAS adapter');
const pdfOnlyStage = await pdfOnlyService.stageUpdatePackage(pdfOnlyCheck.packages[0]);
assert.equal(pdfOnlyStage.success, false,
  'the source package cannot be activated when whole-document selection has no unique page locator');
assert.match(pdfOnlyStage.error || '', /incomplete, ambiguous, or inconsistent/);
assert.equal(pdfOnlyVersioning.getCandidates().length, 0,
  'the whole-document PDF admission limitation leaves no staged candidate');

const adapter = new MASDocumentUpdateAdapter([
  { recordId: HTML_ID, extractionRequest: htmlRequest, amendmentTitle: 'MAS Fund Management Licensing guidance' },
  { recordId: PDF_ID, extractionRequest: pdfParagraphRequest, amendmentTitle: 'MAS Circular IID 04/2025 paragraph 9' }
]);
const service = new LiveRegulatoryFeedService(versioning, undefined, fetcher, [adapter]);
// The answer retriever is intentionally constructed before the isolated test activation.
const answerRetriever = new InMemorySourceRetriever(undefined, versioning);

try {
  assert.equal(UNIFIED_SOURCE_REGISTRY[HTML_ID], undefined);
  assert.equal(UNIFIED_SOURCE_REGISTRY[PDF_ID], undefined);

  const firstCheck = await service.checkForUpdates();
  assert.equal(firstCheck.packages.length, 1);
  const firstPackage = firstCheck.packages[0];
  assert.deepEqual(firstPackage.updates.map(record => record.id), [HTML_ID, PDF_ID]);
  assert.equal(firstPackage.releaseDate, 'undated');
  assert.equal(firstPackage.documentMetadata[HTML_ID].httpStatus, 200);
  assert.equal(firstPackage.documentMetadata[HTML_ID].contentType, 'text/html; charset=utf-8');
  assert.equal(firstPackage.documentMetadata[HTML_ID].sourceUrl, htmlDoc.fetch.sourceUrl);
  assert.equal(firstPackage.documentMetadata[HTML_ID].finalUrl, htmlDoc.fetch.finalUrl);
  assert.equal(firstPackage.documentMetadata[HTML_ID].retrievedAt, htmlDoc.fetch.retrievedAt);
  assert.equal(firstPackage.documentMetadata[PDF_ID].httpStatus, 200);
  assert.equal(firstPackage.documentMetadata[PDF_ID].contentType, 'application/pdf');
  assert.equal(firstPackage.documentMetadata[PDF_ID].lastModified, pdfDoc.fetch.lastModified);
  assert.equal(firstPackage.documentMetadata[PDF_ID].retrievedAt, pdfDoc.fetch.retrievedAt);
  const firstStageResult = await service.stageUpdatePackage(firstPackage);
  assert.equal(firstStageResult.success, true, firstStageResult.error);
  const firstStaged = service.getStagedPackages().find(pkg => pkg.packageId === firstPackage.packageId);
  assert.ok(firstStaged);
  assert.equal((await service.activateUpdatePackage(firstPackage.packageId)).success, false,
    'staging alone cannot activate an unverified capture');
  assert.equal((await service.verifyUpdatePackage(firstPackage.packageId, currentRawDocuments(firstPackage, fetcher))).isValid, true);
  assert.equal((await service.activateUpdatePackage(firstPackage.packageId)).success, false,
    'byte verification alone cannot activate without explicit reviewer approval');
  assert.equal(service.approveUpdatePackage(firstPackage.packageId, 'engineering-reviewer@example.test',
    'Isolated engineering acceptance receipt only; not human legal or production approval'), true);
  assert.equal((await service.activateUpdatePackage(firstPackage.packageId)).success, true);

  const firstHtmlActive = getSourceByIdAtDate(answerRetriever, HTML_ID, CAPTURE_DAY);
  const firstPdfActive = getSourceByIdAtDate(answerRetriever, PDF_ID, CAPTURE_DAY);
  assert.ok(firstHtmlActive && firstPdfActive);
  assert.equal(getSourceByIdAtDate(answerRetriever, HTML_ID, POST_CAPTURE_DAY), undefined,
    'the active HTML source remains capture-day-only and is refused on the later current-day replay date');
  assert.equal(getSourceByIdAtDate(answerRetriever, PDF_ID, POST_CAPTURE_DAY), undefined,
    'the active PDF source remains capture-day-only and is refused on the later current-day replay date');
  assert.equal(firstHtmlActive.documentHash, htmlDoc.fetch.contentHash);
  assert.equal(firstHtmlActive.effectiveDate, undefined);
  assert.equal(firstPdfActive.documentHash, pdfDoc.fetch.contentHash);
  assert.equal(firstPdfActive.effectiveDate, undefined);
  const firstHtmlEvidence = await answerRetriever.retrieveSources({
    query: 'What does MAS say about fund management licensing under the Securities and Futures Act?',
    authorities: ['MAS'], domain: 'MAS_FUNDS', targetDate: CAPTURE_DAY, referenceDate: CAPTURE_DAY
  });
  const firstPdfEvidence = await answerRetriever.retrieveSources({
    query: 'MAS IID 04/2025 paragraph 9 VCC managers winding down VCCs with no assets or investors',
    authorities: ['MAS'], domain: 'MAS_FUNDS', targetDate: CAPTURE_DAY, referenceDate: CAPTURE_DAY
  });
  assert.ok(firstHtmlEvidence.some(record => record.id === HTML_ID), 'the active HTML capture is answer-retrievable on capture day');
  assert.ok(firstPdfEvidence.some(record => record.id === PDF_ID), 'the active bounded PDF paragraph is answer-retrievable on capture day');
  const firstHtmlProof = bindingAndCitation(firstHtmlActive, answerRetriever, versioning);
  const firstPdfProof = bindingAndCitation(firstPdfActive, answerRetriever, versioning);

  const wrongAuthorityClaim = verifyEvidenceClaims([{
    kind: 'RULE', text: firstHtmlProof.quote, quote: firstHtmlProof.quote, recordId: HTML_ID
  }], [firstHtmlActive], {
    missingFacts: [], expectedAuthority: 'IRAS', expectedDomain: 'MAS_FUNDS', versioningManager: versioning
  });
  assert.equal(wrongAuthorityClaim.accepted.length, 0);
  const wrongDomainClaim = verifyEvidenceClaims([{
    kind: 'RULE', text: firstHtmlProof.quote, quote: firstHtmlProof.quote, recordId: HTML_ID
  }], [firstHtmlActive], {
    missingFacts: [], expectedAuthority: 'MAS', expectedDomain: 'IRAS_TAX', versioningManager: versioning
  });
  assert.equal(wrongDomainClaim.accepted.length, 0);
  const wrongHashCitation = structuredClone(firstHtmlProof.citation);
  wrongHashCitation.sourceBinding.documentHash = '0'.repeat(64);
  assert.equal(firstHtmlProof.verifier.verifyCitation(wrongHashCitation, 'MAS', [firstHtmlActive]).isValid, false,
    'a modified document hash cannot retain the captured citation binding');

  const historicalAnswer = await answerRetriever.retrieveSources({
    query: 'What does MAS say about fund management licensing under the Securities and Futures Act?',
    authorities: ['MAS'], domain: 'MAS_FUNDS', targetDate: '2025-06-26', referenceDate: CAPTURE_DAY
  });
  assert.equal(historicalAnswer.some(record => record.id === HTML_ID), false,
    'an undated MAS capture is not treated as evidence for an unsupported historical date');
  const historicalPdfAnswer = await answerRetriever.retrieveSources({
    query: 'MAS IID 04/2025 paragraph 9 VCC managers winding down VCCs',
    authorities: ['MAS'], domain: 'MAS_FUNDS', targetDate: '2025-06-26', referenceDate: CAPTURE_DAY
  });
  assert.equal(historicalPdfAnswer.some(record => record.id === PDF_ID), false,
    'the 2025 Last-Modified date does not make the captured PDF historically applicable');

  fetcher.setHtmlReplacement();
  const replacementCheck = await service.checkForUpdates();
  assert.equal(replacementCheck.packages.length, 1);
  const replacementPackage = replacementCheck.packages[0];
  assert.deepEqual(replacementPackage.updates.map(record => record.id), [HTML_ID],
    'same-day recapture replaces only the changed HTML bytes; the unchanged PDF stays active');
  assert.equal(replacementPackage.updates[0].sourceText, firstHtmlActive.sourceText);
  assert.equal(replacementPackage.updates[0].provisionHash, firstHtmlActive.provisionHash);
  assert.notEqual(replacementPackage.updates[0].documentHash, firstHtmlActive.documentHash);
  assert.equal((await service.stageUpdatePackage(replacementPackage)).success, true);
  assert.equal((await service.verifyUpdatePackage(replacementPackage.packageId,
    currentRawDocuments(replacementPackage, fetcher))).isValid, true);
  assert.equal((await service.activateUpdatePackage(replacementPackage.packageId)).success, false,
    'a replacement also waits for an explicit engineering review receipt');
  assert.equal(service.approveUpdatePackage(replacementPackage.packageId, 'engineering-reviewer@example.test',
    'Reviewed captured same-page response as an environmental snapshot; not a substantive statutory amendment'), true);
  assert.equal((await service.activateUpdatePackage(replacementPackage.packageId)).success, true);

  const replacementActive = getSourceByIdAtDate(answerRetriever, HTML_ID, CAPTURE_DAY);
  const replacementPdfActive = getSourceByIdAtDate(answerRetriever, PDF_ID, CAPTURE_DAY);
  assert.ok(replacementActive && replacementPdfActive);
  assert.notEqual(replacementActive.versionId, firstHtmlActive.versionId);
  assert.equal(replacementActive.documentHash, htmlReplacementDoc.fetch.contentHash);
  assert.equal(replacementActive.provisionHash, firstHtmlActive.provisionHash);
  assert.equal(replacementPdfActive.versionId, firstPdfActive.versionId,
    'the unchanged PDF remains on the exact first active paragraph version');
  assert.equal(replacementPdfActive.documentHash, firstPdfActive.documentHash);
  const staleVersionCitation = structuredClone(firstHtmlProof.citation);
  const replacementCitationVerifier = new CitationVerifier(answerRetriever, CAPTURE_DAY, versioning);
  assert.equal(replacementCitationVerifier.verifyCitation(staleVersionCitation, 'MAS', [replacementActive]).isValid, false,
    'the old HTML version binding is stale after the replacement activation');
  const replacementProof = bindingAndCitation(replacementActive, answerRetriever, versioning);
  assert.notEqual(replacementProof.binding.versionId, firstHtmlProof.binding.versionId);
  assert.notEqual(replacementProof.binding.documentHash, firstHtmlProof.binding.documentHash);
  assert.equal(replacementProof.binding.provisionHash, firstHtmlProof.binding.provisionHash);

  assert.equal((await service.rollbackUpdatePackage(replacementPackage.packageId)).success, true);
  const restoredHtml = getSourceByIdAtDate(answerRetriever, HTML_ID, CAPTURE_DAY);
  const restoredPdf = getSourceByIdAtDate(answerRetriever, PDF_ID, CAPTURE_DAY);
  assert.equal(restoredHtml.versionId, firstHtmlProof.binding.versionId);
  assert.equal(restoredHtml.documentHash, firstHtmlProof.binding.documentHash);
  assert.equal(restoredPdf.versionId, firstPdfProof.binding.versionId,
    'rolling back the HTML replacement leaves the PDF version unchanged');
  assert.equal(new CitationVerifier(answerRetriever, CAPTURE_DAY, versioning)
    .verifyCitation(firstHtmlProof.citation, 'MAS', [restoredHtml]).isValid, true,
  'rollback restores the exact prior HTML citation binding');

  assert.equal((await service.rollbackUpdatePackage(firstPackage.packageId)).success, true);
  assert.equal(UNIFIED_SOURCE_REGISTRY[HTML_ID], undefined, 'rolling back first activation removes its isolated HTML registry row');
  assert.equal(UNIFIED_SOURCE_REGISTRY[PDF_ID], undefined, 'rolling back first activation removes its isolated PDF registry row');
  assert.equal(answerRetriever.getSourceById(HTML_ID), undefined);
  assert.equal(answerRetriever.getSourceById(PDF_ID), undefined);
} finally {
  for (const id of Object.keys(UNIFIED_SOURCE_REGISTRY)) delete UNIFIED_SOURCE_REGISTRY[id];
  Object.assign(UNIFIED_SOURCE_REGISTRY, registryBefore);
}

console.log('PASS | Genuine MAS HTML/PDF captures: extraction, isolated approval lifecycle, citations, replacement and rollback');
