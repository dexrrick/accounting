import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { defaultLiveRegulatoryFeedService, LiveRegulatoryFeedService } from '../../src/retrieval/liveRegulatoryFeed.ts';
import { clearManualMasDiscoveryPackage, MANUAL_MAS_REVIEW_DOCUMENTS, discoverManualMasDocuments } from '../../src/retrieval/manualMasDocumentReview.ts';
import { MASDocumentUpdateAdapter } from '../../src/retrieval/masDocumentUpdateAdapter.ts';
import { InMemorySourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import {
  computeSha256Bytes,
  computeSourceDocumentComparisonEvidenceHash,
  defaultSourceVersioningManager,
  SourceVersioningManager
} from '../../src/standards/sourceVersioning.ts';
import {
  compareMasLicensingHtml,
  MAS_LICENSING_COMPARISON_PROFILE_VERSION
} from '../../src/standards/masLicensingComparisonPolicy.ts';
import { extractOfficialDocumentFromRetrieved } from '../../src/retrieval/officialDocumentExtractor.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { getSingaporeDateString } from '../../src/utils/dateUtils.ts';
import { CitationVerifier } from '../../src/verification/citationVerifier.ts';
import { verifyEvidenceClaims } from '../../src/verification/claimEvidenceVerifier.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { reconcileQuestionUnderstanding } from '../../src/services/semanticQuestionUnderstanding.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import { shouldUseAuthorityEvidenceRuntime } from '../../src/utils/authorityEvidenceRouting.ts';
import { defaultTargetDateResolver } from '../../src/retrieval/targetDateResolver.ts';
import { assembleDeterministicResponse } from '../../src/engine/responseAssembler.ts';
import { createAuthorityEvidencePresentation } from '../../src/utils/authorityEvidencePresentation.ts';
import { AuthorityCompliancePanel } from '../../src/components/AuthorityCompliancePanel.tsx';
import { ManualMasReviewPanel } from '../../src/components/ManualMasReviewPanel.tsx';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

const INITIAL_ROOT = new URL('../fixtures/mas-reviewed/subsection-preview-20261016/', import.meta.url);
const RECAPTURE_ROOT = new URL('../fixtures/mas-reviewed/subsection-preview-recapture-20261016/', import.meta.url);
const CAPTURE_DAY = '2026-10-16';
const POST_CAPTURE_DAY = '2026-10-17';
const requestFixture = JSON.parse(await readFile(new URL('../fixtures/mas-reviewed/subsection-requests-20261016.json', import.meta.url), 'utf8'));
const initialManifest = JSON.parse(await readFile(new URL('manifest.json', INITIAL_ROOT), 'utf8'));
const recaptureManifest = JSON.parse(await readFile(new URL('manifest.json', RECAPTURE_ROOT), 'utf8'));
const recordIds = requestFixture.documents.map(document => document.recordId);
const htmlTopicId = 'mas-fund-management-licensing-admission-criteria';
const pdfTopicId = 'mas-vcc-substantive-fund-management-activity';
assert.equal(recordIds.length, 2, 'the reviewed subsection fixture contains one HTML and one PDF request');
assert.deepEqual(
  MANUAL_MAS_REVIEW_DOCUMENTS.map(({ recordId, extractionRequest }) => {
    const { topicIds: _topicIds, ...request } = extractionRequest;
    return { recordId, request };
  }),
  requestFixture.documents,
  'manual browser review uses exactly the two reviewed bounded document requests'
);
assert.deepEqual(MANUAL_MAS_REVIEW_DOCUMENTS.map(({ recordId, extractionRequest }) => ({ recordId, topicIds: extractionRequest.topicIds })), [
  { recordId: recordIds[0], topicIds: [htmlTopicId] },
  { recordId: recordIds[1], topicIds: [pdfTopicId] }
], 'manual extraction metadata binds each exact reviewed document to its narrow routing topic');
assert.equal(defaultLiveRegulatoryFeedService.getAdapters().some(adapter => adapter.authority === 'MAS'), false,
  'MAS remains outside default and scheduled source discovery adapters');
const htmlId = recordIds[0];
const pdfId = recordIds[1];
const runtimeQuery = 'Using the approved MAS excerpts, what are the fund management licensing admission criteria, and what does MAS Circular IID 04/2025 say about substantive fund management activity for VCC managers?';

assert.equal(defaultTargetDateResolver.resolveTargetDate('What does MAS Circular IID 04/2025 say?', '2026-06-26').targetDate, undefined,
  'the exact IID 04/2025 identifier alone is not treated as a historical target date');
assert.equal(defaultTargetDateResolver.resolveTargetDate('What does MAS-IID-04-2025 say about substantive fund management activity?', '2026-06-26').targetDate, undefined,
  'the exact MAS-IID-04-2025 code is not treated as a historical target date');
assert.equal(defaultTargetDateResolver.resolveTargetDate('What does Circular IID 04/2025 say about the rules in 2025?', '2026-06-26').targetDate,
  '2025-06-30', 'a separate in-year request remains a historical target date beside the circular identifier');
assert.equal(defaultTargetDateResolver.resolveTargetDate('What does MAS Circular IID 04/2025 say about the position on 31/12/2024?', '2026-06-26').targetDate,
  '2024-12-31', 'an explicit DD/MM/YYYY date remains authoritative beside the circular identifier');
assert.equal(defaultTargetDateResolver.resolveTargetDate('What does MAS Circular IID 04/2025 say? Reference material: 2024.', '2026-06-26').targetDate,
  '2024-06-30', 'a separate standalone historical year remains available after masking the identifier');
assert.equal(defaultTargetDateResolver.resolveTargetDate('What was the 2025 GST registration threshold?', '2026-06-26').targetDate,
  '2025-06-30', 'unrelated standalone-year queries keep their historical target date behavior');
assert.equal(defaultTargetDateResolver.resolveTargetDate(runtimeQuery, '2026-06-26').targetDate, undefined,
  'the combined MAS question does not infer an effective date from the circular number');
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
const htmlDate = getSingaporeDateString(initialHtml.document.fetch.retrievedAt);
const pdfDate = getSingaporeDateString(initialPdf.document.fetch.retrievedAt);
const replacementHtmlDate = getSingaporeDateString(replacementHtml.document.fetch.retrievedAt);
assert.equal(htmlDate, CAPTURE_DAY, 'the immutable HTML fixture timestamp remains on its declared capture day');
assert.equal(pdfDate, CAPTURE_DAY, 'the immutable PDF fixture timestamp remains on its declared capture day');
assert.equal(replacementHtmlDate, CAPTURE_DAY, 'the immutable recapture timestamp retains its declared fixture day');
assert.notEqual(initialHtml.document.fetch.contentHash, replacementHtml.document.fetch.contentHash,
  'the later genuine HTML response must be a distinct byte snapshot; do not fabricate a replacement if its bytes are identical');
assert.equal(initialPdf.document.fetch.contentHash, recapturedPdf.document.fetch.contentHash,
  'the later PDF capture is the same document snapshot and must not create a PDF replacement');
assert.equal(initialHtml.document.candidateRecord.provisionHash, replacementHtml.document.candidateRecord.provisionHash,
  'the HTML replacement retains the same selected provision text');
assert.equal(initialHtml.document.candidateRecord.sourceText, replacementHtml.document.candidateRecord.sourceText);

const generatedValuesHtml = changeDynamicMasHtmlValues(initialHtml.bytes);
const dynamicComparison = compareMasLicensingHtml(initialHtml.bytes, generatedValuesHtml, computeSha256Bytes);
assert.equal(dynamicComparison.isValid, true, 'the reviewed policy accepts only the three same-length generated HTML values');
const spoofedBaseline = new TextDecoder('utf-8', { fatal: true }).decode(initialHtml.bytes)
  .replace(/<meta name="VIcurrentDateTime" content="[0-9]{18}" \/>/,
    match => `<script>${match}</script>`);
assert.equal(compareMasLicensingHtml(initialHtml.bytes, new Uint8Array(Buffer.from(spoofedBaseline, 'utf8')), computeSha256Bytes).isValid, false,
  'a baseline cannot claim a generated field that appears inside raw script text');
const capturedHtmlText = new TextDecoder('utf-8', { fatal: true }).decode(initialHtml.bytes);
const capturedTimestampTag = capturedHtmlText.match(/<meta name="VIcurrentDateTime" content="[0-9]{18}" \/>/)?.[0];
const capturedTokenTags = [...capturedHtmlText.matchAll(/<input name="__RequestVerificationToken" type="hidden" value="[A-Za-z0-9_-]{108}" \/>/g)]
  .map(match => match[0]);
assert.ok(capturedTimestampTag && capturedTokenTags.length === 2, 'captured generated-value tags are available for malformed-context checks');
for (const wrapper of ['script', 'textarea']) {
  const malformedWrapperDocument = new Uint8Array(Buffer.from(
    `<html><head><${wrapper}/>${capturedTimestampTag}</${wrapper}></head><body><${wrapper}/>${capturedTokenTags[0]}</${wrapper}><${wrapper}/>${capturedTokenTags[1]}</${wrapper}></body></html>`,
    'utf8'
  ));
  const malformedWrapperRefetch = changeDynamicMasHtmlValues(malformedWrapperDocument);
  assert.equal(compareMasLicensingHtml(malformedWrapperDocument, malformedWrapperRefetch, computeSha256Bytes).isValid, false,
    `self-closing ${wrapper} wrappers are parsed as open raw-text elements and rejected in baseline and re-fetch`);
}
for (const mutate of [
  bytes => { bytes[10] ^= 1; return bytes; },
  bytes => {
    const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace('type="hidden"', 'type="text"');
    return new Uint8Array(Buffer.from(html, 'utf8'));
  },
  bytes => {
    const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/<meta name="VIcurrentDateTime" content="[0-9]{18}" \/>/,
      match => `<!--${match}-->`);
    return new Uint8Array(Buffer.from(html, 'utf8'));
  },
  bytes => {
    const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/<meta name="VIcurrentDateTime" content="[0-9]{18}" \/>/,
      match => `<script>${match}</script>`);
    return new Uint8Array(Buffer.from(html, 'utf8'));
  },
  bytes => {
    const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/<meta name="VIcurrentDateTime" content="[0-9]{18}" \/>/,
      match => `<plaintext>${match}`);
    return new Uint8Array(Buffer.from(html, 'utf8'));
  },
  bytes => {
    const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/<input name="__RequestVerificationToken" type="hidden" value="[A-Za-z0-9_-]{108}" \/>/,
      match => match.replace('name="__RequestVerificationToken"', 'name="__RequestVerificationToken" name="duplicate"'));
    return new Uint8Array(Buffer.from(html, 'utf8'));
  },
  bytes => {
    const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/content="[0-9]{18}"/, 'content="X00000000000000000"');
    return new Uint8Array(Buffer.from(html, 'utf8'));
  }
]) {
  const changed = mutate(new Uint8Array(initialHtml.bytes));
  assert.equal(compareMasLicensingHtml(initialHtml.bytes, changed, computeSha256Bytes).isValid, false,
    'markup, element context, duplicate attributes, date shape, and unrelated bytes fail closed');
}

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

function changeDynamicMasHtmlValues(bytes) {
  const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let dateValueCount = 0;
  let tokenValueCount = 0;
  const changedDate = html.replace(
    /(<meta\b(?=[^>]*\bname=["']VIcurrentDateTime["'])[^>]*?\bcontent=["'])([^"']+)(["'][^>]*>)/i,
    (_match, prefix, value, suffix) => {
      dateValueCount += 1;
      return `${prefix}${'9'.repeat(value.length)}${suffix}`;
    }
  );
  const changedTokens = changedDate.replace(
    /(<input\b(?=[^>]*\bname=["']__RequestVerificationToken["'])[^>]*?\bvalue=["'])([^"']+)(["'][^>]*>)/gi,
    (_match, prefix, value, suffix) => {
      tokenValueCount += 1;
      return `${prefix}${'x'.repeat(value.length)}${suffix}`;
    }
  );
  assert.equal(dateValueCount, 1, 'the MAS response has one generated VIcurrentDateTime value');
  assert.equal(tokenValueCount, 2, 'the MAS response has two generated anti-forgery token values');
  const changedBytes = new Uint8Array(Buffer.from(changedTokens, 'utf8'));
  assert.equal(changedBytes.byteLength, bytes.byteLength, 'same-length dynamic values retain all document offsets');
  return changedBytes;
}

const runtimeIssueSpecs = [
  { subject: 'fund management licensing admission criteria', topicId: htmlTopicId },
  { subject: 'substantive fund management activity for VCC managers', topicId: pdfTopicId }
];

function reconciledMasRuntimeQuestion(query = runtimeQuery, issueSpecs = runtimeIssueSpecs) {
  const understanding = {
    mode: 'SEMANTIC_INTERPRETATION',
    assessmentStatus: 'PASSED',
    interpretation: {
      schemaVersion: 2,
      jurisdiction: ['Singapore'],
      authorityCandidates: ['MAS'],
      contextualAuthorities: [],
      domain: 'MAS_FUNDS',
      population: 'FUND',
      primarySubject: 'fund management licensing admission criteria and substantive fund management activity for VCC managers',
      concepts: [],
      requestedOperation: 'EXPLAIN_RULE',
      factsExplicitlyProvided: [],
      confidence: 0.96,
      issues: issueSpecs.map(({ subject, topicId }) => ({
        subject, population: 'FUND', domain: 'MAS_FUNDS', governingAuthorities: ['MAS'], contextualAuthorities: [],
        operation: 'EXPLAIN_RULE', mappedTopicIds: [topicId], evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.96
      }))
    }
  };
  const classification = classifyQuestion(query);
  const reconciled = reconcileQuestionUnderstanding(query, classification, understanding);
  return { classification: reconciled.classification, understanding: reconciled.understanding, issuePlan: reconciled.issuePlan };
}

function fixedCandidateRetriever(candidates, manager) {
  return {
    async retrieveSources() { return candidates; },
    getSourceById(id) { return candidates.find(record => record.id === id); },
    findSourcesByStandardOrAct() { return candidates; },
    getVersioningManager() { return manager; }
  };
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
  return { quote: quotes[0], quotes, binding: bindings[0], verifiedClaim: checked.accepted[0], citation: citations[0], citations, verifier };
}

function withFixtureDate(targetDate, operation) {
  const SystemDate = globalThis.Date;
  class FixtureDate extends SystemDate {
    constructor(...args) {
      if (args.length === 0) super(`${targetDate}T00:00:00+08:00`);
      else super(...args);
    }

    static now() {
      return new SystemDate(`${targetDate}T00:00:00+08:00`).getTime();
    }
  }

  globalThis.Date = FixtureDate;
  try {
    return operation();
  } finally {
    globalThis.Date = SystemDate;
  }
}

function assembleBoundCitation(citation, record) {
  return withFixtureDate(getSingaporeDateString(record.retrievedAt), () => {
    const query = 'What does the reviewed MAS fund management source say?';
    const assembled = assembleDeterministicResponse({
      directAnswer: 'The source citation is tied to the retrieved, approved document version.',
      citations: [citation],
      requiredAccounts: [
        { accountName: 'Source test debit', category: 'ASSET', debitCredit: 'DEBIT' },
        { accountName: 'Source test credit', category: 'LIABILITY', debitCredit: 'CREDIT' }
      ]
    }, query, null, {
      classification: classifyQuestion(query),
      userFacts: [], missingFacts: [], assumptions: [],
      primaryEvidence: [record], officialGuidance: [], curatedSummaries: [], applicationRules: [], currentInformationRequired: false
    }, null, 'SFRS_I');
    return assembled.scenarioState.directGroups?.flatMap(group => group.citations) || [];
  });
}

function renderAuthorityEvidenceFor(record, proof) {
  const issueId = `mas-${record.id}`;
  const claim = proof.verifiedClaim;
  const issue = {
    issueId,
    subject: 'MAS reviewed-source requirement',
    population: 'FUND',
    domain: 'MAS_FUNDS',
    operation: 'EXPLAIN_RULE',
    evidenceRequirement: 'AUTHORITATIVE_SOURCE',
    governingAuthority: 'MAS',
    sourceSections: [],
    lifecycle: { requested: true, mapped: true, retrievalAttempted: true, evidenceFound: true, admitted: true, verified: true, covered: true },
    evidenceStatus: 'VERIFIED',
    applicationStatus: 'NOT_REQUIRED',
    verifiedClaims: [claim],
    sources: [record],
    gaps: []
  };
  const presentation = createAuthorityEvidencePresentation({
    query: 'What does the reviewed MAS fund management source say?',
    issuePlan: {
      source: 'SEMANTIC_ISSUES', coverageEstablished: true, hasUnmappedResidual: false,
      issues: [{ id: issueId, subject: issue.subject, population: 'FUND', domain: 'MAS_FUNDS',
        governingAuthorities: ['MAS'], contextualAuthorities: [], operation: 'EXPLAIN_RULE', mappedTopicIds: [],
        evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.96, status: 'MAPPED' }]
    },
    workstreams: [{ id: 'MAS:MAS_FUNDS', authority: 'MAS', domain: 'MAS_FUNDS', sourceSections: [],
      populations: ['FUND'], issues: [issue], evidenceStatus: 'VERIFIED', applicationStatus: 'NOT_REQUIRED',
      verifiedClaims: [claim], sources: [record], gaps: [] }],
    evidenceStatus: 'VERIFIED', applicationStatus: 'NOT_REQUIRED', status: 'VERIFIED', gaps: []
  });
  assert.deepEqual(presentation.workstreams[0].issues[0].claims[0].sourceBinding, proof.binding,
    'authority workstream projection preserves the exact document binding');
  assert.equal(Object.isFrozen(proof.binding), false,
    'freezing the display projection does not freeze the verifier-owned binding');
  // These static captures are evaluated as of their Singapore capture day.
  return withFixtureDate(getSingaporeDateString(record.retrievedAt), () =>
    renderToStaticMarkup(React.createElement(AuthorityCompliancePanel, { presentation }))
  );
}

function renderManualMasReviewPanel() {
  return renderToStaticMarkup(React.createElement(ManualMasReviewPanel, {}));
}

function activePackageCard(markup, packageId) {
  const marker = `aria-label="Activated manual MAS package ${packageId}"`;
  const markerIndex = markup.indexOf(marker);
  if (markerIndex < 0) return '';
  const start = markup.lastIndexOf('<article', markerIndex);
  const close = markup.indexOf('</article>', markerIndex);
  return start >= 0 && close >= 0 ? markup.slice(start, close + '</article>'.length) : '';
}

function manualPackageCard(markup, packageId) {
  const marker = `aria-label="MAS package ${packageId}"`;
  const markerIndex = markup.indexOf(marker);
  if (markerIndex < 0) return '';
  const start = markup.lastIndexOf('<article', markerIndex);
  const close = markup.indexOf('</article>', markerIndex);
  return start >= 0 && close >= 0 ? markup.slice(start, close + '</article>'.length) : '';
}

function packageOwnedLedgerVersion(pkg, recordId) {
  return defaultSourceVersioningManager.getAllLedgerEntries().find(entry =>
    entry.recordId === recordId &&
    entry.metadata.documentAdmissionPackageId === pkg.packageId &&
    entry.metadata.documentAdmissionPackageHash === pkg.packageHash &&
    entry.metadata.reviewApproval?.packageId === pkg.packageId &&
    entry.metadata.reviewApproval.packageHash === pkg.packageHash
  );
}

const versioning = defaultSourceVersioningManager;
const captureRetriever = new CapturedResponseRetriever(initialById);
const service = defaultLiveRegulatoryFeedService;
service.reset();
// Construct before activation so answer retrieval depends on the shared managed registry.
const answerRetriever = new InMemorySourceRetriever(undefined, versioning);

try {
  for (const id of recordIds) assert.equal(UNIFIED_SOURCE_REGISTRY[id], undefined, `${id}: isolated registry id is unused`);
  for (const id of recordIds) assert.equal(versioning.getActiveVersionId(id), undefined, `${id}: no existing version is active`);
  const firstCheck = await discoverManualMasDocuments(captureRetriever, Object.values(UNIFIED_SOURCE_REGISTRY));
  assert.equal(firstCheck.status, 'CANDIDATE');
  assert.equal(firstCheck.documents.length, 2);
  assert.ok(firstCheck.documents.every(document => document.fetchStatus === 'SUCCESS' && document.extractionStatus === 'EXACT'));
  const firstPackage = firstCheck.package;
  assert.ok(firstPackage, 'manual discovery returns the two official documents as a review candidate package');
  assert.deepEqual(firstPackage.updates.map(record => record.id), recordIds);
  const htmlPolicy = firstPackage.documentMetadata[htmlId].comparisonPolicy;
  assert.equal(htmlPolicy?.profileVersion, MAS_LICENSING_COMPARISON_PROFILE_VERSION,
    'only the reviewed manual MAS licensing HTML request opts into the named comparison profile');
  assert.equal(firstPackage.documentMetadata[pdfId].comparisonPolicy, undefined,
    'the reviewed PDF remains on strict full-document byte equality');
  assert.equal(Buffer.from(htmlPolicy.originalBodyBase64, 'base64').equals(Buffer.from(initialHtml.bytes)), true,
    'the package retains the complete original raw HTML artifact');
  for (const capture of initialById.values()) {
    const id = capture.document.recordId;
    const metadata = firstPackage.documentMetadata[id];
    assert.equal(metadata.httpStatus, 200);
    assert.equal(metadata.contentType, capture.document.fetch.contentType);
    assert.equal(metadata.sourceUrl, capture.document.fetch.sourceUrl);
    assert.equal(metadata.finalUrl, capture.document.fetch.finalUrl);
    assert.equal(metadata.retrievedAt, capture.document.fetch.retrievedAt);
    assert.equal(firstPackage.updates.find(record => record.id === id).documentHash, capture.document.fetch.contentHash);
    const captureDate = id === htmlId ? htmlDate : pdfDate;
    assert.equal(answerRetriever.getSourceById(id, { targetDate: captureDate, referenceDate: captureDate }), undefined,
      'a candidate is not answer-retrievable before activation');
  }

  assert.equal((await service.stageUpdatePackage(firstPackage)).success, true);
  assert.equal((await service.activateUpdatePackage(firstPackage.packageId)).success, false,
    'staging alone cannot activate the captured sources');
  const verificationDocuments = rawDocumentsFor(firstPackage, initialById);
  verificationDocuments[htmlId] = { ...retrievedCapture(initialHtml), contentBytes: generatedValuesHtml };
  const firstVerification = await service.verifyUpdatePackage(firstPackage.packageId, verificationDocuments);
  assert.equal(firstVerification.isValid, true, firstVerification.rejectionReason);
  const comparisonReceipt = service.getPackageComparisonReceipt(firstPackage.packageId).find(item => item.recordId === htmlId);
  assert.equal(comparisonReceipt?.status, 'VERIFIED');
  assert.equal(comparisonReceipt?.baselineDocumentHash, initialHtml.document.fetch.contentHash);
  assert.equal(comparisonReceipt?.verificationDocumentHash, computeSha256Bytes(generatedValuesHtml));
  assert.notEqual(comparisonReceipt?.baselineDocumentHash, comparisonReceipt?.verificationDocumentHash,
    'the comparison receipt preserves distinct complete raw artifact hashes');
  assert.ok(comparisonReceipt?.evidenceHash, 'verification emits a hash-bound raw-artifact receipt');
  assert.equal(service.getPackageApprovalReceipt(firstPackage.packageId), undefined,
    'verification does not create an approval receipt');
  const runtimeQuestion = reconciledMasRuntimeQuestion();
  assert.equal(runtimeQuestion.issuePlan.source, 'SEMANTIC_ISSUES',
    'the bounded question is reconciled into independently mapped semantic issues');
  assert.equal(runtimeQuestion.issuePlan.coverageEstablished, false,
    'the independent ACRA VCC topic remains an explicit residual instead of being covered by MAS excerpts');
  assert.equal(runtimeQuestion.issuePlan.hasUnmappedResidual, true);
  assert.ok([htmlTopicId, pdfTopicId].every(topicId =>
    runtimeQuestion.issuePlan.issues.some(issue => issue.status === 'MAPPED' && issue.mappedTopicIds.includes(topicId))));
  assert.equal(shouldUseAuthorityEvidenceRuntime({
    issuePlan: runtimeQuestion.issuePlan, classification: runtimeQuestion.classification,
    explicitIrasEvidenceRequest: false, hasImages: false
  }), true, 'a complete plan for the two focused MAS topics uses authority evidence runtime');
  const reviewDate = getSingaporeDateString(initialHtml.document.fetch.retrievedAt);
  const preApprovalRuntime = await buildAuthorityWorkstreams(runtimeQuery, runtimeQuestion.issuePlan, {
    retriever: answerRetriever, questionUnderstanding: runtimeQuestion.understanding,
    localOnly: true, referenceDate: reviewDate
  });
  assert.equal(preApprovalRuntime.workstreams.flatMap(workstream => workstream.verifiedClaims).length, 0,
    'staged and verified candidates still cannot create source claims before explicit approval and activation');
  assert.equal(preApprovalRuntime.status, 'INSUFFICIENT');
  assert.equal((await service.activateUpdatePackage(firstPackage.packageId)).success, false,
    'verification alone cannot activate without explicit review approval');
  const beforeApprovalMarkup = renderManualMasReviewPanel();
  const beforeApprovalCard = manualPackageCard(beforeApprovalMarkup, firstPackage.packageId);
  assert.match(beforeApprovalCard, /Versioned comparison policy: MAS-LICENSING-HTML-DYNAMIC-V1/);
  assert.match(beforeApprovalCard, new RegExp(`Original staged snapshot raw document SHA-256: ${initialHtml.document.fetch.contentHash}`));
  assert.match(beforeApprovalCard, new RegExp(`Re-fetch raw document SHA-256: ${computeSha256Bytes(generatedValuesHtml)}`));
  assert.match(beforeApprovalCard, /value=""/,
    'human reviewer and reason fields are blank before each explicit approval');
  assert.doesNotMatch(beforeApprovalCard, /type="checkbox" checked/,
    'the comparison receipt never auto-acknowledges human approval');
  assert.equal(service.approveUpdatePackage(firstPackage.packageId, 'engineering-reviewer@example.test',
    'Offline engineering test receipt only; not legal or production approval'), true);
  const firstApproval = service.getPackageApprovalReceipt(firstPackage.packageId);
  assert.equal(firstApproval?.packageHash, firstPackage.packageHash,
    'the service exposes approval only when it matches the current verified package hash and candidate snapshot');
  const packageEvidenceHash = createHash('sha256').update(JSON.stringify([{
    evidenceHash: comparisonReceipt?.evidenceHash,
    recordId: htmlId
  }])).digest('hex');
  assert.equal(firstApproval?.comparisonEvidenceHash, packageEvidenceHash,
    'explicit approval binds the verified package comparison receipt');
  const mutableHtmlCandidate = versioning.getCandidates().find(candidate => candidate.record.id === htmlId);
  assert.ok(mutableHtmlCandidate);
  const exactCandidateText = mutableHtmlCandidate.record.sourceText;
  mutableHtmlCandidate.record.sourceText = `${exactCandidateText} changed after review`;
  assert.equal(service.getPackageApprovalReceipt(firstPackage.packageId), undefined,
    'the service stops reporting approval when its current candidate no longer matches the reviewed snapshot');
  assert.equal((await service.activateUpdatePackage(firstPackage.packageId)).success, false,
    'candidate mutation after approval remains blocked at activation');
  mutableHtmlCandidate.record.sourceText = exactCandidateText;
  assert.equal(service.getPackageApprovalReceipt(firstPackage.packageId)?.packageHash, firstPackage.packageHash,
    'restoring the reviewed candidate restores only the matching approval receipt');
  assert.equal((await service.activateUpdatePackage(firstPackage.packageId)).success, true);
  clearManualMasDiscoveryPackage(firstPackage.packageId);
  assert.equal(service.getPackageApprovalReceipt(firstPackage.packageId), undefined,
    'the pending approval getter stops exposing a receipt after activation');
  const persistedApproval = service.getReviewAuditEvents(firstPackage.packageId).find(event => event.action === 'APPROVED');
  assert.equal(persistedApproval?.packageHash, firstPackage.packageHash,
    'the active review audit retains the approved package hash as its receipt');

  const activeHtml = answerRetriever.getSourceById(htmlId, { targetDate: htmlDate, referenceDate: htmlDate });
  const activePdf = answerRetriever.getSourceById(pdfId, { targetDate: pdfDate, referenceDate: pdfDate });
  assert.ok(activeHtml && activePdf);
  assert.equal(activeHtml.effectiveDate, undefined);
  assert.equal(activePdf.effectiveDate, undefined);
  assert.equal(answerRetriever.getSourceById(htmlId, { targetDate: '2026-10-15' }), undefined,
    'the undated HTML capture is rejected before its capture day');
  assert.equal(answerRetriever.getSourceById(htmlId, { targetDate: POST_CAPTURE_DAY }), undefined,
    'the active HTML source remains capture-day-only and is refused on the later current-day replay date');
  assert.equal(answerRetriever.getSourceById(pdfId, { targetDate: '2026-10-15' }), undefined,
    'the undated PDF capture is rejected before its capture day');
  assert.equal(answerRetriever.getSourceById(pdfId, { targetDate: POST_CAPTURE_DAY }), undefined,
    'the active PDF source remains capture-day-only and is refused on the later current-day replay date');
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
  const runtimeCandidates = await answerRetriever.retrieveSources({
    query: runtimeQuery, authorities: ['MAS'], domain: 'MAS_FUNDS', topicIds: [htmlTopicId, pdfTopicId],
    targetDate: htmlDate, referenceDate: htmlDate
  });
  const runtimeEvidence = await buildAuthorityWorkstreams(runtimeQuery, runtimeQuestion.issuePlan, {
    retriever: answerRetriever, questionUnderstanding: runtimeQuestion.understanding,
    localOnly: true, referenceDate: htmlDate
  });
  assert.equal(runtimeEvidence.status, 'INSUFFICIENT',
    'the two MAS excerpts bind their claims while the independently recognized ACRA VCC residual remains open');
  assert.ok(runtimeEvidence.gaps.some(gap => gap.code === 'ISSUE_PLAN_HAS_UNMAPPED_RESIDUAL'));
  const runtimeClaims = runtimeEvidence.workstreams.flatMap(workstream => workstream.verifiedClaims);
  const runtimeClaimsByRecord = new Map(recordIds.map(id => [id, runtimeClaims.filter(claim => claim.recordId === id)]));
  for (const recordId of recordIds) {
    const recordClaims = runtimeClaimsByRecord.get(recordId);
    assert.ok(recordClaims.length > 0, `${recordId}: authority runtime verifies a claim from the reviewed excerpt; ${JSON.stringify(runtimeEvidence.workstreams.map(workstream => ({ issues: workstream.issues.map(issue => ({ subject: issue.subject, status: issue.evidenceStatus, gaps: issue.gaps.map(gap => gap.code) })), claims: workstream.verifiedClaims.map(claim => claim.recordId) })))}`);
    const recordDate = recordId === htmlId ? htmlDate : pdfDate;
    const activeRecord = answerRetriever.getSourceById(recordId, { targetDate: recordDate, referenceDate: recordDate });
    const activeVersionId = versioning.getActiveVersionId(recordId);
    const activeEntry = versioning.getLedgerEntry(activeVersionId);
    for (const claim of recordClaims) {
      assert.equal(claim.sourceBinding?.recordId, recordId);
      assert.equal(claim.sourceBinding?.versionId, activeVersionId);
      assert.equal(claim.sourceBinding?.documentHash, activeEntry.recordSnapshot.documentHash);
      assert.equal(claim.sourceBinding?.provisionHash, activeEntry.recordSnapshot.provisionHash);
      assert.deepEqual(claim.sourceBinding?.sourceLocator, activeEntry.recordSnapshot.sourceLocator);
      assert.equal(claim.sourceBinding?.documentHash, activeRecord.documentHash);
    }
  }
  const defaultRuntimeEvidence = await buildAuthorityWorkstreams(runtimeQuery, runtimeQuestion.issuePlan, {
    questionUnderstanding: runtimeQuestion.understanding, localOnly: true, referenceDate: htmlDate
  });
  const defaultRuntimeClaims = defaultRuntimeEvidence.workstreams.flatMap(workstream => workstream.verifiedClaims);
  for (const recordId of recordIds) {
    const activeVersionId = versioning.getActiveVersionId(recordId);
    assert.ok(defaultRuntimeClaims.some(claim => claim.recordId === recordId &&
      claim.sourceBinding?.recordId === recordId && claim.sourceBinding.versionId === activeVersionId),
    `${recordId}: default authority runtime retrieves the activated source and retains its active ledger version binding`);
  }
  const runtimePresentation = createAuthorityEvidencePresentation(runtimeEvidence);
  const runtimeAuthorityPanel = withFixtureDate(htmlDate,
    () => renderToStaticMarkup(React.createElement(AuthorityCompliancePanel, {
      presentation: runtimePresentation
    })));
  for (const recordId of recordIds) {
    const activeVersionId = versioning.getActiveVersionId(recordId);
    assert.ok(runtimePresentation.workstreams.flatMap(workstream => workstream.issues)
      .flatMap(issue => issue.claims).some(claim => claim.sourceBinding?.recordId === recordId &&
        claim.sourceBinding?.versionId === activeVersionId),
    `${recordId}: answer presentation retains the verified active document binding`);
    assert.ok(runtimeAuthorityPanel.includes(activeVersionId),
      `${recordId}: UI renders the active version ID beside the verified claim`);
  }
  const singleLicensingQuery = 'What are the fund management licensing admission criteria?';
  const singleLicensingPlan = reconciledMasRuntimeQuestion(singleLicensingQuery, [
    { subject: 'fund management licensing admission criteria', topicId: htmlTopicId }
  ]);
  assert.equal(singleLicensingPlan.issuePlan.issues.length, 1);
  assert.equal(singleLicensingPlan.issuePlan.coverageEstablished, true,
    JSON.stringify(singleLicensingPlan.issuePlan.issues.map(issue => ({ status: issue.status, subject: issue.subject, topics: issue.mappedTopicIds, reason: issue.unresolvedReason }))));
  assert.equal(shouldUseAuthorityEvidenceRuntime({
    issuePlan: singleLicensingPlan.issuePlan, classification: singleLicensingPlan.classification,
    explicitIrasEvidenceRequest: false, hasImages: false
  }), true, 'one focused, fully mapped MAS issue uses authority evidence runtime');
  const singleLicensingRuntime = await buildAuthorityWorkstreams(singleLicensingQuery, singleLicensingPlan.issuePlan, {
    retriever: answerRetriever, questionUnderstanding: singleLicensingPlan.understanding,
    localOnly: true, referenceDate: htmlDate
  });
  assert.equal(singleLicensingRuntime.status, 'VERIFIED',
    `a single bounded licensing issue is verified through the ledger-backed runtime: ${singleLicensingRuntime.gaps.map(gap => gap.code).join(', ')}`);
  assert.ok(singleLicensingRuntime.workstreams.flatMap(workstream => workstream.verifiedClaims)
    .some(claim => claim.recordId === htmlId && claim.sourceBinding?.versionId === versioning.getActiveVersionId(htmlId)));

  const singleVccQuery = 'What does MAS say about substantive fund management activity for VCC managers?';
  const singleVccPlan = reconciledMasRuntimeQuestion(singleVccQuery, [
    { subject: 'substantive fund management activity for VCC managers', topicId: pdfTopicId }
  ]);
  assert.equal(shouldUseAuthorityEvidenceRuntime({
    issuePlan: singleVccPlan.issuePlan, classification: singleVccPlan.classification,
    explicitIrasEvidenceRequest: false, hasImages: false
  }), true);
  const singleVccRuntime = await buildAuthorityWorkstreams(singleVccQuery, singleVccPlan.issuePlan, {
    retriever: answerRetriever, questionUnderstanding: singleVccPlan.understanding,
    localOnly: true, referenceDate: pdfDate
  });
  assert.equal(singleVccRuntime.status, 'INSUFFICIENT',
    'the focused MAS claim does not erase the independently recognized unresolved VCC authority residual');
  assert.ok(singleVccRuntime.gaps.some(gap => gap.code === 'ISSUE_PLAN_HAS_UNMAPPED_RESIDUAL'));
  assert.ok(singleVccRuntime.workstreams.flatMap(workstream => workstream.verifiedClaims)
    .some(claim => claim.recordId === pdfId && claim.sourceBinding?.versionId === versioning.getActiveVersionId(pdfId)),
  'the scoped VCC subsection claim remains verified and bound despite the open residual');

  const forgedHtml = { ...activeHtml, documentHash: '0'.repeat(64) };
  const forgedRuntime = await buildAuthorityWorkstreams(runtimeQuery, runtimeQuestion.issuePlan, {
    retriever: fixedCandidateRetriever([forgedHtml, activePdf], versioning),
    questionUnderstanding: runtimeQuestion.understanding, localOnly: true, referenceDate: htmlDate
  });
  assert.equal(forgedRuntime.workstreams.flatMap(workstream => workstream.verifiedClaims)
    .some(claim => claim.recordId === htmlId), false,
  'a forged managed-document hash is rejected by the active ledger check');
  const inactiveRuntime = await buildAuthorityWorkstreams(runtimeQuery, runtimeQuestion.issuePlan, {
    retriever: fixedCandidateRetriever([activeHtml, activePdf], new SourceVersioningManager()),
    questionUnderstanding: runtimeQuestion.understanding, localOnly: true, referenceDate: htmlDate
  });
  assert.equal(inactiveRuntime.workstreams.flatMap(workstream => workstream.verifiedClaims).length, 0,
    'managed document flags cannot substitute for the active approval ledger');

  const unrelatedQuery = 'What are the AML and CFT requirements for MAS regulated entities?';
  const unrelatedClassification = classifyQuestion(unrelatedQuery);
  const unrelatedPlan = {
    source: 'SEMANTIC_ISSUES', coverageEstablished: true, hasUnmappedResidual: false,
    issues: [{ id: 'unrelated-mas-aml', subject: 'AML and CFT requirements for MAS regulated entities',
      population: 'FUND', domain: 'MAS_FUNDS', governingAuthorities: ['MAS'], contextualAuthorities: [],
      operation: 'EXPLAIN_RULE', mappedTopicIds: ['mas-aml-cft'], evidenceRequirement: 'AUTHORITATIVE_SOURCE',
      confidence: 0.96, status: 'MAPPED' }]
  };
  assert.equal(shouldUseAuthorityEvidenceRuntime({
    issuePlan: unrelatedPlan, classification: unrelatedClassification,
    explicitIrasEvidenceRequest: false, hasImages: false
  }), true, 'a mapped standalone MAS AML/CFT advisory uses the common statutory evidence runtime');
  const unrelatedRuntime = await buildAuthorityWorkstreams(unrelatedQuery, unrelatedPlan, {
    retriever: fixedCandidateRetriever([activeHtml, activePdf], versioning), localOnly: true, referenceDate: htmlDate,
    providers: { MAS: { authority: 'MAS', async retrieve() { return { candidates: [activeHtml, activePdf] }; } } }
  });
  assert.equal(unrelatedRuntime.workstreams.flatMap(workstream => workstream.verifiedClaims).length, 0,
    'the approved excerpt records cannot cover an unrelated MAS AML/CFT topic');
  const firstHtmlProof = evidenceProof(activeHtml, htmlDate, answerRetriever, versioning);
  const firstPdfProof = evidenceProof(activePdf, pdfDate, answerRetriever, versioning);
  const activeAuthorityPanel = renderAuthorityEvidenceFor(activeHtml, firstHtmlProof);
  assert.match(activeAuthorityPanel, /Current verified official source excerpt/);
  assert.match(activeAuthorityPanel, /CURRENT_VERSION_MATCH/);
  assert.match(activeAuthorityPanel, /All requested evidence verified/);
  const assembledFirstPdfCitation = assembleBoundCitation(firstPdfProof.citation, activePdf).find(citation => citation.standard === firstPdfProof.citation.standard);
  assert.ok(assembledFirstPdfCitation?.sourceBinding,
    'response assembly preserves the verified source binding on the final StandardCitation');
  assert.deepEqual(assembledFirstPdfCitation.sourceBinding, firstPdfProof.binding);
  const firstPackagePanel = renderManualMasReviewPanel();
  const firstPackageCard = activePackageCard(firstPackagePanel, firstPackage.packageId);
  const firstOwnedHtmlVersion = packageOwnedLedgerVersion(firstPackage, htmlId);
  assert.ok(firstOwnedHtmlVersion, 'the active package has a matching immutable ledger receipt');
  const ledgerComparisonEvidence = firstOwnedHtmlVersion.metadata.reviewApproval?.comparisonEvidence;
  assert.ok(ledgerComparisonEvidence, 'the append-only source ledger retains full comparison evidence with the explicit approval');
  assert.equal(ledgerComparisonEvidence.profileVersion, MAS_LICENSING_COMPARISON_PROFILE_VERSION);
  assert.equal(ledgerComparisonEvidence.baselineDocumentHash, initialHtml.document.fetch.contentHash);
  assert.equal(ledgerComparisonEvidence.verificationDocumentHash, computeSha256Bytes(generatedValuesHtml));
  assert.equal(Buffer.from(ledgerComparisonEvidence.originalBodyBase64, 'base64').equals(Buffer.from(initialHtml.bytes)), true);
  assert.equal(Buffer.from(ledgerComparisonEvidence.verificationBodyBase64, 'base64').equals(Buffer.from(generatedValuesHtml)), true);
  const lowLevelManager = new SourceVersioningManager();
  const lowLevelVersionId = `${firstPackage.packageId}-LOW-LEVEL-COMPARISON`;
  const lowLevelMetadata = {
    ...structuredClone(firstOwnedHtmlVersion.metadata),
    versionId: lowLevelVersionId,
    verificationStatus: 'VERIFIED',
    verificationMethod: 'OFFICIAL_STATUTORY_PACKAGE_VERIFICATION'
  };
  delete lowLevelMetadata.reviewApproval;
  lowLevelManager.registerCandidateVersion(structuredClone(firstOwnedHtmlVersion.recordSnapshot), lowLevelMetadata);
  const lowLevelCandidate = lowLevelManager.getCandidates().find(candidate => candidate.metadata.versionId === lowLevelVersionId);
  assert.ok(lowLevelCandidate);
  const validLowLevelApproval = {
    packageId: firstPackage.packageId,
    packageHash: firstPackage.packageHash,
    reviewer: 'engineering-reviewer@example.test',
    reason: 'Offline engineering test receipt only; not legal or production approval',
    approvedAt: firstOwnedHtmlVersion.metadata.reviewApproval.approvedAt,
    comparisonEvidence: structuredClone(ledgerComparisonEvidence),
    comparisonEvidenceHash: ledgerComparisonEvidence.evidenceHash
  };
  const forgedVerificationBytes = Buffer.from(ledgerComparisonEvidence.verificationBodyBase64, 'base64');
  forgedVerificationBytes[10] ^= 1;
  const forgedEvidenceBase = {
    ...structuredClone(ledgerComparisonEvidence),
    verificationDocumentHash: computeSha256Bytes(new Uint8Array(forgedVerificationBytes)),
    verificationBodyBase64: forgedVerificationBytes.toString('base64')
  };
  const forgedEvidence = {
    ...forgedEvidenceBase,
    evidenceHash: computeSourceDocumentComparisonEvidenceHash(forgedEvidenceBase)
  };
  const forgedApproval = {
    ...validLowLevelApproval,
    comparisonEvidence: forgedEvidence,
    comparisonEvidenceHash: forgedEvidence.evidenceHash
  };
  assert.equal(lowLevelManager.recordDocumentReviewApproval(lowLevelVersionId, forgedApproval), false,
    'source versioning itself rejects changed-outside-policy bytes even when their raw and evidence hashes are recomputed');
  assert.equal(lowLevelManager.recordDocumentReviewApproval(lowLevelVersionId, validLowLevelApproval), true);
  lowLevelCandidate.metadata.reviewApproval = forgedApproval;
  assert.equal(lowLevelManager.activateVersion(lowLevelVersionId).success, false,
    'low-level activation rechecks policy semantics after approval evidence mutation');
  const downgradeManager = new SourceVersioningManager();
  const downgradeVersionId = `${firstPackage.packageId}-LOW-LEVEL-POLICY-DOWNGRADE`;
  downgradeManager.registerCandidateVersion(structuredClone(firstOwnedHtmlVersion.recordSnapshot), {
    ...structuredClone(lowLevelMetadata),
    versionId: downgradeVersionId
  });
  const downgradeCandidate = downgradeManager.getCandidates().find(candidate => candidate.metadata.versionId === downgradeVersionId);
  assert.ok(downgradeCandidate);
  const originalLowLevelText = downgradeCandidate.record.sourceText;
  downgradeCandidate.record.sourceText = `${originalLowLevelText} tampered`;
  assert.equal(downgradeManager.recordDocumentReviewApproval(downgradeVersionId, validLowLevelApproval), false,
    'source versioning rejects a policy candidate record changed after registration');
  downgradeCandidate.record.sourceText = originalLowLevelText;
  for (const field of [
    'documentAdmissionRequired', 'documentAdmissionPackageId', 'documentAdmissionPackageHash',
    'documentAdmissionComparisonRecordId', 'documentAdmissionComparisonProfileVersion',
    'documentAdmissionComparisonHash', 'documentAdmissionComparisonContentType'
  ]) delete downgradeCandidate.metadata[field];
  downgradeCandidate.metadata.reviewApproval = {
    packageId: firstPackage.packageId,
    packageHash: firstPackage.packageHash,
    reviewer: 'engineering-reviewer@example.test',
    reason: 'Offline engineering test receipt only; not legal or production approval',
    approvedAt: firstOwnedHtmlVersion.metadata.reviewApproval.approvedAt
  };
  assert.equal(downgradeManager.activateVersion(downgradeVersionId).success, false,
    'registration-pinned policy and admission fields prevent bypass by downgrading a policy candidate to a legacy candidate');
  assert.match(firstPackageCard, /\bActive\b/);
  assert.match(firstPackageCard, new RegExp(`package version ${firstOwnedHtmlVersion.versionId} · document ${firstOwnedHtmlVersion.metadata.documentHash}`));
  assert.doesNotMatch(firstPackagePanel, /Stage exact candidate/,
    'activation clears the resolved discovery snapshot instead of showing the same package as pending');
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

  const legacyPdfRecord = { ...activePdf };
  delete legacyPdfRecord.relatedTopicIds;
  const metadataMigrationCheck = await discoverManualMasDocuments(captureRetriever,
    Object.values(UNIFIED_SOURCE_REGISTRY).map(record => record.id === pdfId ? legacyPdfRecord : record));
  assert.equal(metadataMigrationCheck.status, 'CANDIDATE',
    'an active document missing its newly hashed routing metadata requires explicit review');
  assert.deepEqual(metadataMigrationCheck.package?.updates.map(record => record.id), [pdfId]);
  assert.equal(metadataMigrationCheck.package?.updates[0].documentHash, activePdf.documentHash);
  assert.equal(metadataMigrationCheck.package?.updates[0].provisionHash, activePdf.provisionHash);
  assert.deepEqual(metadataMigrationCheck.package?.updates[0].relatedTopicIds, [pdfTopicId]);
  assert.equal(metadataMigrationCheck.package?.amendments[0].changeType, 'APPLICABILITY_CHANGE');
  clearManualMasDiscoveryPackage(metadataMigrationCheck.package.packageId);

  captureRetriever.setCapture(htmlId, replacementHtml);
  const replacementCheck = await discoverManualMasDocuments(captureRetriever, Object.values(UNIFIED_SOURCE_REGISTRY));
  assert.equal(replacementCheck.status, 'CANDIDATE');
  const replacementPackage = replacementCheck.package;
  assert.ok(replacementPackage);
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
  clearManualMasDiscoveryPackage(replacementPackage.packageId);

  const afterReplacementPanel = renderManualMasReviewPanel();
  const supersededFirstPackageCard = activePackageCard(afterReplacementPanel, firstPackage.packageId);
  const currentReplacementPackageCard = activePackageCard(afterReplacementPanel, replacementPackage.packageId);
  const replacementOwnedHtmlVersion = packageOwnedLedgerVersion(replacementPackage, htmlId);
  assert.ok(replacementOwnedHtmlVersion, 'the replacement has its own approved ledger version');
  assert.match(supersededFirstPackageCard, /Partially superseded/,
    'the predecessor package remains current only for records whose pointers it still owns');
  assert.match(supersededFirstPackageCard, new RegExp(`package version ${firstOwnedHtmlVersion.versionId} · document ${firstOwnedHtmlVersion.metadata.documentHash} · provision`));
  assert.doesNotMatch(supersededFirstPackageCard, new RegExp(`document ${replacementOwnedHtmlVersion.metadata.documentHash}`),
    'the predecessor approval receipt never displays the replacement document hash as its own');
  assert.match(supersededFirstPackageCard, /Rollback unavailable · package versions are not all current/);
  assert.match(currentReplacementPackageCard, /\bActive\b/);
  assert.match(currentReplacementPackageCard, new RegExp(`package version ${replacementOwnedHtmlVersion.versionId} · document ${replacementOwnedHtmlVersion.metadata.documentHash}`));
  assert.doesNotMatch(afterReplacementPanel, /Stage exact candidate/);

  const replacementActiveHtml = answerRetriever.getSourceById(htmlId, {
    targetDate: replacementHtmlDate, referenceDate: replacementHtmlDate
  });
  const replacementActivePdf = answerRetriever.getSourceById(pdfId, { targetDate: pdfDate, referenceDate: pdfDate });
  assert.notEqual(replacementActiveHtml.versionId, activeHtml.versionId);
  assert.equal(replacementActiveHtml.documentHash, replacementHtml.document.fetch.contentHash);
  assert.equal(replacementActiveHtml.provisionHash, activeHtml.provisionHash);
  assert.equal(replacementActivePdf.versionId, activePdf.versionId, 'the PDF binding is unchanged by an HTML-only replacement');
  assert.equal(firstHtmlProof.verifier.verifyCitation(firstHtmlProof.citation, 'MAS', [replacementActiveHtml]).isValid, false,
    'the prior HTML citation becomes stale after replacement');
  const replacedAuthorityPanel = renderAuthorityEvidenceFor(activeHtml, firstHtmlProof);
  assert.match(replacedAuthorityPanel, /Historical official source excerpt · no longer current/);
  assert.match(replacedAuthorityPanel, /Source version changed; review required/);
  assert.doesNotMatch(replacedAuthorityPanel, /\bCovered\b/,
    'an issue whose source binding is stale cannot retain its covered badge');
  assert.doesNotMatch(replacedAuthorityPanel, /All requested evidence verified|Evidence verified/,
    'a historical binding cannot retain a current verified whole-question badge');
  assert.equal(assembleBoundCitation(firstHtmlProof.citation, replacementActiveHtml).length, 0,
    'response assembly rejects a citation bound to the replaced document version');
  const replacementHtmlProof = evidenceProof(replacementActiveHtml, replacementHtmlDate, answerRetriever, versioning);
  assert.notEqual(replacementHtmlProof.binding.versionId, firstHtmlProof.binding.versionId);

  assert.equal((await service.rollbackUpdatePackage(replacementPackage.packageId)).success, true);
  clearManualMasDiscoveryPackage(replacementPackage.packageId);
  const restoredHtml = answerRetriever.getSourceById(htmlId, { targetDate: htmlDate, referenceDate: htmlDate });
  const restoredPdf = answerRetriever.getSourceById(pdfId, { targetDate: pdfDate, referenceDate: pdfDate });
  assert.equal(restoredHtml.versionId, firstHtmlProof.binding.versionId);
  assert.equal(restoredHtml.documentHash, firstHtmlProof.binding.documentHash);
  assert.equal(restoredPdf.versionId, firstPdfProof.binding.versionId, 'HTML rollback preserves the active PDF version');
  assert.equal(restoredPdf.documentHash, activePdf.documentHash);
  const afterReplacementRollbackPanel = renderManualMasReviewPanel();
  const restoredFirstPackageCard = activePackageCard(afterReplacementRollbackPanel, firstPackage.packageId);
  const rolledBackReplacementCard = activePackageCard(afterReplacementRollbackPanel, replacementPackage.packageId);
  assert.match(restoredFirstPackageCard, /\bActive\b/);
  assert.match(restoredFirstPackageCard, new RegExp(`package version ${firstOwnedHtmlVersion.versionId} · document ${firstOwnedHtmlVersion.metadata.documentHash}`));
  assert.equal(rolledBackReplacementCard, '', 'a package removed by rollback no longer appears as an active package receipt');
  assert.doesNotMatch(afterReplacementRollbackPanel, /Stage exact candidate/);
  assert.equal(new CitationVerifier(answerRetriever, htmlDate, versioning).verifyCitation(
    firstHtmlProof.citation, 'MAS', [restoredHtml], {
      targetDate: htmlDate, referenceDate: htmlDate, expectedAuthority: 'MAS', expectedDomain: 'MAS_FUNDS'
    }
  ).isValid, true, 'rollback restores the original HTML citation binding');
  const restoredAssembledCitation = assembleBoundCitation(firstHtmlProof.citation, restoredHtml)
    .find(citation => citation.standard === firstHtmlProof.citation.standard);
  assert.deepEqual(restoredAssembledCitation?.sourceBinding, firstHtmlProof.binding,
    'response assembly binds the restored version after rollback');
  const restoredAuthorityPanel = renderAuthorityEvidenceFor(restoredHtml, firstHtmlProof);
  assert.match(restoredAuthorityPanel, /Current verified official source excerpt/);
  assert.match(restoredAuthorityPanel, /All requested evidence verified/,
    'rollback restores the old binding and its current status in the authority workstream view');
  assert.match(restoredAuthorityPanel, /\bCovered\b/,
    'the restored issue returns to the covered state when its bound version is active again');

  assert.equal((await service.rollbackUpdatePackage(firstPackage.packageId)).success, true);
  clearManualMasDiscoveryPackage(firstPackage.packageId);
  for (const id of recordIds) {
    assert.equal(UNIFIED_SOURCE_REGISTRY[id], undefined, `${id}: first-package rollback removes the isolated registry row`);
    const captureDate = id === htmlId ? htmlDate : pdfDate;
    assert.equal(answerRetriever.getSourceById(id, { targetDate: captureDate, referenceDate: captureDate }), undefined,
      `${id}: first-package rollback removes answer retrieval`);
  }
  assert.equal(new CitationVerifier(answerRetriever, htmlDate, versioning).verifyCitation(
    firstHtmlProof.citation, 'MAS', [], {
      targetDate: htmlDate, referenceDate: htmlDate, expectedAuthority: 'MAS', expectedDomain: 'MAS_FUNDS'
    }
  ).isValid, false, 'rollback of the first activation invalidates its prior answer citation');
  assert.equal(assembleBoundCitation(firstHtmlProof.citation, activeHtml).length, 0,
    'response assembly excludes citations after the source version is rolled back from the active registry');
  const rolledBackAuthorityPanel = renderAuthorityEvidenceFor(activeHtml, firstHtmlProof);
  assert.match(rolledBackAuthorityPanel, /Historical official source excerpt · no longer current/);
  assert.match(rolledBackAuthorityPanel, /SOURCE_NOT_FOUND/);
  assert.doesNotMatch(rolledBackAuthorityPanel, /\bCovered\b/,
    'rollback of the original activation clears the issue covered badge');
  assert.doesNotMatch(rolledBackAuthorityPanel, /All requested evidence verified|Evidence verified/,
    'rolling back activation removes the current verified badge while preserving historical receipt details');
  assert.doesNotMatch(renderManualMasReviewPanel(), /Activated manual MAS package/,
    'rolling back all active MAS packages clears their active-package panel entries');

  const dynamicHtmlResponse = {
    ...retrievedCapture(initialHtml),
    contentBytes: changeDynamicMasHtmlValues(initialHtml.bytes)
  };
  const dynamicGatePackageBase = structuredClone(firstPackage);
  dynamicGatePackageBase.packageId = `${firstPackage.packageId}-DYNAMIC-HTML-NEGATIVE`;
  delete dynamicGatePackageBase.documentMetadata[htmlId].comparisonPolicy;
  delete dynamicGatePackageBase.packageHash;
  const dynamicGatePackage = {
    ...dynamicGatePackageBase,
    packageHash: service.computePackageHash(dynamicGatePackageBase)
  };
  const dynamicHtmlExtraction = await extractOfficialDocumentFromRetrieved(
    dynamicGatePackage.extractionRequests[htmlId], dynamicHtmlResponse
  );
  assert.equal(dynamicHtmlExtraction.status, 'SUCCESS',
    dynamicHtmlExtraction.status === 'REJECTED' ? `${dynamicHtmlExtraction.code}: ${dynamicHtmlExtraction.reason}` : 'same passage should extract');
  assert.equal(dynamicHtmlExtraction.record.sourceText, dynamicGatePackage.updates.find(record => record.id === htmlId).sourceText,
    'generated timestamp and anti-forgery values leave the exact selected provision unchanged');
  assert.equal(dynamicHtmlExtraction.record.provisionHash, dynamicGatePackage.updates.find(record => record.id === htmlId).provisionHash,
    'the unchanged provision retains its original provision hash');
  const originalHtmlLocator = structuredClone(dynamicGatePackage.updates.find(record => record.id === htmlId).sourceLocator);
  const dynamicHtmlLocator = structuredClone(dynamicHtmlExtraction.record.sourceLocator);
  delete originalHtmlLocator.documentHash;
  delete dynamicHtmlLocator.documentHash;
  assert.deepEqual(dynamicHtmlLocator, originalHtmlLocator,
    'the bounded locator remains unchanged apart from its full-document hash');
  assert.notEqual(dynamicHtmlExtraction.record.documentHash, dynamicGatePackage.updates.find(record => record.id === htmlId).documentHash,
    'the generated surrounding values change the full-document hash');
  assert.equal((await service.stageUpdatePackage(dynamicGatePackage)).success, true);
  const dynamicVerificationDocuments = rawDocumentsFor(dynamicGatePackage, initialById);
  dynamicVerificationDocuments[htmlId] = dynamicHtmlResponse;
  const dynamicVerification = await service.verifyUpdatePackage(dynamicGatePackage.packageId, dynamicVerificationDocuments);
  assert.equal(dynamicVerification.isValid, false,
    'the staged package rejects byte-different HTML even when exact extracted provision and locator are unchanged');
  assert.match(dynamicVerification.rejectionReason, /Raw bytes, URL, MIME type, status, or document hash differs/,
    'the unchanged-document verification fails at the package-bound raw document hash gate');
  assert.equal(service.getPackageApprovalReceipt(dynamicGatePackage.packageId), undefined,
    'byte-different surrounding HTML cannot create an approval receipt');
  assert.equal((await service.activateUpdatePackage(dynamicGatePackage.packageId)).success, false,
    'a document-hash rejection cannot activate the package');
  console.log(`PASS | unchanged-provision HTML rejected at full-document gate: ${dynamicVerification.rejectionReason}`);

  const unknownProfileBase = structuredClone(firstPackage);
  unknownProfileBase.packageId = `${firstPackage.packageId}-UNKNOWN-COMPARISON-PROFILE`;
  delete unknownProfileBase.packageHash;
  unknownProfileBase.documentMetadata[htmlId].comparisonPolicy.profileVersion = 'MAS-LICENSING-HTML-DYNAMIC-V2';
  const unknownProfilePackage = {
    ...unknownProfileBase,
    packageHash: service.computePackageHash(unknownProfileBase)
  };
  assert.equal((await service.stageUpdatePackage(unknownProfilePackage)).success, false,
    'unknown comparison profiles cannot be staged');

  const strictPdfPackageBase = structuredClone(firstPackage);
  strictPdfPackageBase.packageId = `${firstPackage.packageId}-STRICT-PDF-RAW-HASH`;
  delete strictPdfPackageBase.packageHash;
  const strictPdfPackage = {
    ...strictPdfPackageBase,
    packageHash: service.computePackageHash(strictPdfPackageBase)
  };
  assert.equal((await service.stageUpdatePackage(strictPdfPackage)).success, true);
  const strictPdfDocuments = rawDocumentsFor(strictPdfPackage, initialById);
  const changedPdfBytes = new Uint8Array(initialPdf.bytes);
  changedPdfBytes[0] ^= 1;
  strictPdfDocuments[pdfId] = { ...retrievedCapture(initialPdf), contentBytes: changedPdfBytes };
  const strictPdfVerification = await service.verifyUpdatePackage(strictPdfPackage.packageId, strictPdfDocuments);
  assert.equal(strictPdfVerification.isValid, false,
    'the PDF remains on strict complete-response hashing even beside opted-in HTML');
  assert.match(strictPdfVerification.rejectionReason, /Raw bytes, URL, MIME type, status, or document hash differs/);
  console.log(`PASS | strict PDF full-document hash gate: ${strictPdfVerification.rejectionReason}`);

  const legacyPdfMonitoringDocument = structuredClone(MANUAL_MAS_REVIEW_DOCUMENTS.find(document => document.recordId === pdfId));
  assert.ok(legacyPdfMonitoringDocument);
  delete legacyPdfMonitoringDocument.extractionRequest.topicIds;
  const legacyMigrationAdapter = new MASDocumentUpdateAdapter([legacyPdfMonitoringDocument]);
  const topicAwareMigrationAdapter = new MASDocumentUpdateAdapter([
    structuredClone(MANUAL_MAS_REVIEW_DOCUMENTS.find(document => document.recordId === pdfId))
  ]);
  const migrationVersioning = new SourceVersioningManager();
  const migrationService = new LiveRegulatoryFeedService(migrationVersioning, undefined, captureRetriever, [legacyMigrationAdapter]);
  let legacyMigrationPackage;
  let topicMigrationPackage;
  try {
    const legacyMigrationDiscovery = await legacyMigrationAdapter.checkForUpdatesWithDiagnostics(captureRetriever, []);
    assert.ok(legacyMigrationDiscovery.updatePackage, 'the isolated legacy monitor creates a genuine initial MAS package');
    legacyMigrationPackage = legacyMigrationDiscovery.updatePackage;
    assert.equal(legacyMigrationPackage.extractionRequests[pdfId].topicIds, undefined);
    assert.deepEqual(legacyMigrationPackage.updates[0].relatedTopicIds || [], []);
    assert.equal((await migrationService.stageUpdatePackage(legacyMigrationPackage)).success, true);
    assert.equal((await migrationService.verifyUpdatePackage(legacyMigrationPackage.packageId,
      rawDocumentsFor(legacyMigrationPackage, initialById))).isValid, true);
    assert.equal(migrationService.approveUpdatePackage(legacyMigrationPackage.packageId, 'migration-reviewer@example.test',
      'Offline test receipt for activating the topicless legacy package'), true);
    assert.equal((await migrationService.activateUpdatePackage(legacyMigrationPackage.packageId)).success, true,
      'the isolated topicless prior package is explicitly approved and activated');
    const legacyActivePdf = UNIFIED_SOURCE_REGISTRY[pdfId];
    const legacyActiveVersionId = migrationVersioning.getActiveVersionId(pdfId);
    assert.ok(legacyActivePdf && legacyActiveVersionId);
    assert.deepEqual(legacyActivePdf.relatedTopicIds || [], []);

    const topicMigrationDiscovery = await topicAwareMigrationAdapter.checkForUpdatesWithDiagnostics(captureRetriever, [legacyActivePdf]);
    assert.ok(topicMigrationDiscovery.updatePackage,
      'same document bytes and provision produce a candidate when only its narrow routing topic is added');
    topicMigrationPackage = topicMigrationDiscovery.updatePackage;
    assert.deepEqual(topicMigrationPackage.updates.map(record => record.id), [pdfId]);
    assert.notEqual(topicMigrationPackage.packageId, legacyMigrationPackage.packageId,
      'routing metadata receives a distinct identity from the active topicless package');
    assert.equal(topicMigrationPackage.updates[0].documentHash, legacyActivePdf.documentHash);
    assert.equal(topicMigrationPackage.updates[0].provisionHash, legacyActivePdf.provisionHash);
    assert.equal(topicMigrationPackage.updates[0].effectiveDate, legacyActivePdf.effectiveDate);
    assert.equal(topicMigrationPackage.updates[0].validFrom, legacyActivePdf.validFrom);
    assert.equal(topicMigrationPackage.updates[0].validTo, legacyActivePdf.validTo);
    assert.deepEqual(topicMigrationPackage.updates[0].relatedTopicIds, [pdfTopicId]);
    assert.equal(topicMigrationPackage.amendments[0].changeType, 'APPLICABILITY_CHANGE');
    assert.equal((await migrationService.stageUpdatePackage(topicMigrationPackage)).success, true,
      'the metadata migration can be staged without colliding with the prior active package ID');
    assert.equal((await migrationService.verifyUpdatePackage(topicMigrationPackage.packageId,
      rawDocumentsFor(topicMigrationPackage, initialById))).isValid, true);
    assert.equal(migrationService.getPackageApprovalReceipt(topicMigrationPackage.packageId), undefined);
    const unapprovedMigrationActivation = await migrationService.activateUpdatePackage(topicMigrationPackage.packageId);
    assert.equal(unapprovedMigrationActivation.success, false,
      'routing metadata cannot activate without a new explicit reviewer receipt');
    assert.match(unapprovedMigrationActivation.error, /explicit reviewer approval/i);
    assert.equal(migrationVersioning.getActiveVersionId(pdfId), legacyActiveVersionId,
      'the legacy document version remains active while the metadata-only candidate awaits approval');
    assert.equal(UNIFIED_SOURCE_REGISTRY[pdfId].versionId, legacyActiveVersionId);
    assert.deepEqual(UNIFIED_SOURCE_REGISTRY[pdfId].relatedTopicIds || [], []);
  } finally {
    if (topicMigrationPackage && migrationService.getActivePackages().some(pkg => pkg.packageId === topicMigrationPackage.packageId)) {
      await migrationService.rollbackUpdatePackage(topicMigrationPackage.packageId);
    }
    if (legacyMigrationPackage && migrationService.getActivePackages().some(pkg => pkg.packageId === legacyMigrationPackage.packageId)) {
      await migrationService.rollbackUpdatePackage(legacyMigrationPackage.packageId);
    }
    migrationService.reset();
  }
  assert.equal(UNIFIED_SOURCE_REGISTRY[pdfId], undefined,
    'the isolated migration lifecycle rolls back its genuinely activated legacy source cleanly');
} finally {
  service.reset();
  for (const [id, original] of registryBefore) {
    if (original) UNIFIED_SOURCE_REGISTRY[id] = original;
    else delete UNIFIED_SOURCE_REGISTRY[id];
  }
}

console.log('PASS | New MAS HTML/PDF subsection captures: byte verification, approval, answer retrieval, binding, replacement and rollback');
