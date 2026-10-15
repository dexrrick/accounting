import assert from 'node:assert/strict';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { LiveRegulatoryFeedService } from '../../src/retrieval/liveRegulatoryFeed.ts';
import { MASDocumentUpdateAdapter } from '../../src/retrieval/masDocumentUpdateAdapter.ts';
import { CompositeSourceRetriever } from '../../src/retrieval/compositeSourceRetriever.ts';
import { InMemorySourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { computeProvisionHash, computeSha256Bytes, SourceVersioningManager } from '../../src/standards/sourceVersioning.ts';
import { verifySharedDocumentAdmission } from '../../src/standards/sharedDocumentAdmission.ts';
import { getSingaporeDateString } from '../../src/utils/dateUtils.ts';
import { CitationVerifier } from '../../src/verification/citationVerifier.ts';
import { verifyEvidenceClaims } from '../../src/verification/claimEvidenceVerifier.ts';

const RECORD_ID = 'MAS_SHARED_DOCUMENT_ADMISSION_TEST';
const SOURCE_URL = 'https://www.mas.gov.sg/regulation/notices/mas-notice-789';
const CAPTURED_AT = new Date().toISOString();
const CAPTURED_DAY = getSingaporeDateString(CAPTURED_AT);
const DOCUMENT_BYTES = new TextEncoder().encode(`<!doctype html><html><head><title>MAS Notice 789 on Fund Valuation</title></head><body><main>
  <h1>MAS Notice 789 on Fund Valuation</h1>
  <section id="section-4"><h2>Section 4 Fund valuation</h2>
    <p>MAS Notice 789 requires licensed fund managers to maintain documented valuation controls.</p>
  </section>
</main></body></html>`);

const monitored = [{
  recordId: RECORD_ID,
  extractionRequest: {
    url: SOURCE_URL,
    authority: 'MAS',
    domain: 'MAS_FUNDS',
    expectedTopic: {
      standardIdentifiers: ['MAS Notice 789'],
      expectedTitles: ['MAS Notice 789 on Fund Valuation'],
      topicTerms: ['licensed fund managers', 'valuation controls']
    },
    standardOrActCode: 'MAS-NOTICE-789',
    legalOrStandardInstrument: 'MAS Notice 789',
    documentKind: 'HTML',
    relevantSection: 'Section 4 Fund valuation',
    elementId: 'section-4'
  }
}];

class FixtureRetriever extends ControlledWebRetriever {
  async fetchOfficialDocument(url) {
    return {
      status: 'SUCCESS',
      httpStatus: 200,
      sourceUrl: url,
      finalUrl: url,
      contentType: 'text/html; charset=utf-8',
      contentBytes: new Uint8Array(DOCUMENT_BYTES),
      retrievedAt: CAPTURED_AT,
      etag: '"shared-document-fixture"'
    };
  }
}

function createApprovedManagedRecord({ id, title, code, paragraph, sourceText, retrievedAt, validFrom, validTo, approvedAt = new Date().toISOString() }) {
  const url = `https://www.mas.gov.sg/regulation/notices/${id.toLowerCase()}`;
  const documentBytes = new TextEncoder().encode(`Reviewed source fixture for ${id}`);
  const documentHash = computeSha256Bytes(documentBytes);
  const provisionHash = computeProvisionHash(code, paragraph, sourceText);
  const sourceLocator = {
    sourceType: 'HTML',
    heading: paragraph,
    elementId: 'test-section',
    documentHash,
    tableStructure: 'NONE'
  };
  const versioningManager = new SourceVersioningManager();
  const versionId = `approved-${id}`;
  const packageId = `package-${id}`;
  const packageHash = 'a'.repeat(64);
  const candidateRecord = {
    id,
    authority: 'MAS',
    authorityName: 'Monetary Authority of Singapore',
    sourcePublisher: 'Monetary Authority of Singapore',
    legalOrStandardInstrument: title,
    documentTitle: title,
    standardOrActCode: code,
    paragraphOrSection: paragraph,
    sourceText,
    principleSummary: title,
    ...(validFrom ? { effectiveDate: validFrom, validFrom } : {}),
    ...(validTo ? { validTo } : {}),
    officialSourceUrl: url,
    canonicalSourceUrl: url,
    domain: 'MAS_FUNDS',
    jurisdiction: 'Singapore',
    tags: ['funds'],
    sourceStatus: 'NEEDS_REVIEW',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'OFFICIAL_GUIDANCE',
    isVerbatimText: true,
    lifecycleState: 'CANDIDATE',
    documentHash,
    provisionHash,
    extractionStatus: 'EXACT',
    sourceLocator,
    provenance: 'LIVE_EXTERNAL',
    groundingEligible: false,
    sourceAuthority: 'MAS',
    retrievedAt,
    documentAdmissionRequired: true
  };
  versioningManager.registerCandidateVersion(candidateRecord, {
    versionId,
    canonicalSourceUrl: url,
    sourceAuthority: 'MAS',
    verificationStatus: 'VERIFIED',
    verificationMethod: 'OFFICIAL_STATUTORY_PACKAGE_VERIFICATION',
    retrievedAt,
    sourceUrl: url,
    httpStatus: 200,
    documentHash,
    provisionHash,
    extractionStatus: 'EXACT',
    sourceLocator,
    ...(validFrom ? { effectiveDate: validFrom, validFrom } : {}),
    ...(validTo ? { validTo } : {}),
    documentAdmissionRequired: true,
    documentAdmissionPackageId: packageId,
    documentAdmissionPackageHash: packageHash,
    governingAuthority: 'MAS',
    domain: 'MAS_FUNDS'
  });
  assert.equal(versioningManager.recordDocumentReviewApproval(versionId, {
    packageId,
    packageHash,
    reviewer: 'reviewer@example.test',
    reason: 'Reviewed offline test fixture provenance',
    approvedAt
  }), true);
  assert.equal(versioningManager.activateVersion(versionId).success, true);
  const metadata = versioningManager.getLedgerEntry(versionId).metadata;
  const record = structuredClone(versioningManager.getLedgerEntry(versionId).recordSnapshot);
  Object.assign(record, {
    versionId,
    version: packageId,
    lifecycleState: 'ACTIVE',
    provenance: 'LIVE_PATCH',
    sourceStatus: 'VERIFIED',
    groundingEligible: true,
    lastVerifiedDate: getSingaporeDateString(new Date(approvedAt)),
    verificationMethod: metadata.verificationMethod,
    urlVerificationStatus: 'VERIFIED',
    urlVerifiedDate: getSingaporeDateString(new Date(approvedAt)),
    urlVerificationMethod: metadata.verificationMethod,
    urlVerificationEvidence: `Document URL and byte-bound package verified before reviewer approval (${versionId})`
  });
  return { record, versioningManager, url };
}

const versioning = new SourceVersioningManager();
const fetcher = new FixtureRetriever();
const service = new LiveRegulatoryFeedService(versioning, undefined, fetcher, [new MASDocumentUpdateAdapter(monitored)]);
// Construct before activation to prove the existing retrieval path observes the active registry dynamically.
const retriever = new InMemorySourceRetriever(undefined, versioning);

try {
  const updateCheck = await service.checkForUpdates();
  assert.equal(updateCheck.packages.length, 1);
  const pkg = updateCheck.packages[0];
  const staged = await service.stageUpdatePackage(pkg);
  assert.equal(staged.success, true);
  const candidate = versioning.getCandidates().find(item => item.record.id === RECORD_ID);
  assert.ok(candidate);
  assert.equal(verifySharedDocumentAdmission(candidate.record, versioning).admitted, false);
  const unmarkedStagedCandidate = structuredClone(candidate.record);
  delete unmarkedStagedCandidate.documentAdmissionRequired;
  assert.equal(verifySharedDocumentAdmission(unmarkedStagedCandidate, versioning).required, true,
    'The manager candidate ledger still identifies a staged extracted document if its record marker is removed');
  assert.equal(verifySharedDocumentAdmission(unmarkedStagedCandidate, versioning).admitted, false);
  const strippedManagedMarkers = structuredClone(candidate.record);
  delete strippedManagedMarkers.documentAdmissionRequired;
  delete strippedManagedMarkers.versionId;
  const wrongManagedVersion = structuredClone(candidate.record);
  delete wrongManagedVersion.documentAdmissionRequired;
  wrongManagedVersion.versionId = 'forged-unmanaged-version';
  for (const strippedRecord of [strippedManagedMarkers, wrongManagedVersion]) {
    const admission = verifySharedDocumentAdmission(strippedRecord, versioning);
    assert.equal(admission.required, true, 'A manager-owned staged candidate is recognized by stable record ID');
    assert.equal(admission.admitted, false);
    const candidateQuote = strippedRecord.sourceText.trim();
    const rejectedClaim = verifyEvidenceClaims([{
      kind: 'RULE', text: candidateQuote, quote: candidateQuote, recordId: RECORD_ID
    }], [strippedRecord], {
      missingFacts: [], expectedAuthority: 'MAS', expectedDomain: 'MAS_FUNDS', versioningManager: versioning
    });
    assert.equal(rejectedClaim.accepted.length, 0, 'A stripped pending managed candidate cannot support a verified claim');

    const liveCandidateLookalike = {
      ...strippedRecord,
      lifecycleState: 'CANDIDATE',
      provenance: 'LIVE_EXTERNAL',
      sourceStatus: 'NEEDS_REVIEW',
      verificationMethod: 'LIVE_OFFICIAL_TOPIC_VERIFIED',
      recordRole: 'DISCOVERED_EVIDENCE',
      groundingEligible: true,
      urlVerificationStatus: 'VERIFIED'
    };
    const preActivationCitationVerifier = new CitationVerifier(
      new InMemorySourceRetriever([liveCandidateLookalike], versioning), undefined, versioning
    );
    const forgedCitation = {
      standard: liveCandidateLookalike.standardOrActCode,
      paragraph: liveCandidateLookalike.paragraphOrSection,
      title: liveCandidateLookalike.documentTitle,
      text: candidateQuote,
      officialSourceUrl: SOURCE_URL,
      authority: 'MAS'
    };
    assert.equal(preActivationCitationVerifier.verifyCitation(forgedCitation, 'MAS', [liveCandidateLookalike]).isValid, false,
      'A staged managed candidate cannot bypass admission through live-candidate citation verification');
  }

  const legacyBaselineTemplate = Object.values(UNIFIED_SOURCE_REGISTRY).find(record =>
    record.provenance === 'LOCAL_STATIC' && record.lifecycleState === 'ACTIVE' && record.sourceStatus === 'VERIFIED' &&
    record.groundingEligible !== false && record.recordRole !== 'SOURCE_MAP_POINTER' && Boolean(record.sourceText?.trim()));
  assert.ok(legacyBaselineTemplate, 'A registered eligible legacy source is available for baseline preservation coverage');
  const registeredLegacyBaseline = { ...structuredClone(legacyBaselineTemplate), id: RECORD_ID };
  UNIFIED_SOURCE_REGISTRY[RECORD_ID] = registeredLegacyBaseline;
  try {
    assert.deepEqual(verifySharedDocumentAdmission(registeredLegacyBaseline, versioning), { required: false, admitted: true },
      'The exact unchanged registered legacy baseline stays on its established path while a managed update is staged');
    const baselineQuote = registeredLegacyBaseline.sourceText.trim();
    const baselineClaim = verifyEvidenceClaims([{
      kind: 'RULE', text: baselineQuote, quote: baselineQuote, recordId: RECORD_ID
    }], [registeredLegacyBaseline], { missingFacts: [], versioningManager: versioning });
    assert.equal(baselineClaim.accepted.length, 1, baselineClaim.rejected[0]?.reason);
  } finally {
    delete UNIFIED_SOURCE_REGISTRY[RECORD_ID];
  }
  assert.equal(UNIFIED_SOURCE_REGISTRY[RECORD_ID], undefined);

  const rawDocuments = {
    [RECORD_ID]: {
      sourceUrl: SOURCE_URL,
      finalUrl: SOURCE_URL,
      contentType: 'text/html; charset=utf-8',
      contentBytes: new Uint8Array(DOCUMENT_BYTES),
      httpStatus: 200,
      retrievedAt: CAPTURED_AT
    }
  };
  assert.equal((await service.verifyUpdatePackage(pkg.packageId, rawDocuments)).isValid, true);
  assert.equal((await service.activateUpdatePackage(pkg.packageId)).success, false,
    'Verification alone cannot activate an extracted document');
  assert.equal(await service.approveUpdatePackage(pkg.packageId, 'reviewer@example.test', 'Reviewed source bytes and applicability'), true);
  assert.equal((await service.activateUpdatePackage(pkg.packageId)).success, true);

  const active = retriever.getSourceById(RECORD_ID);
  assert.ok(active, 'A preconstructed retriever discovers the newly activated source');
  assert.equal(active.lifecycleState, 'ACTIVE');
  assert.equal(active.groundingEligible, true);
  assert.equal(active.effectiveDate, undefined, 'The source fixture does not claim an unsupported applicability date');
  const activeAdmission = verifySharedDocumentAdmission(active, versioning);
  assert.equal(activeAdmission.required, true);
  assert.equal(activeAdmission.admitted, true);

  const retrieved = await retriever.retrieveSources({
    query: 'MAS Notice 789 licensed fund managers valuation controls',
    authorities: ['MAS'],
    domain: 'MAS_FUNDS'
  });
  assert.ok(retrieved.some(record => record.id === RECORD_ID),
    'An active document is discoverable without a legacy referenceDate override');
  assert.deepEqual(retriever.findSourcesByStandardOrAct('MAS-NOTICE-789', 'Section 4 Fund valuation').map(record => record.id), [RECORD_ID]);

  const binding = activeAdmission.binding;
  assert.equal(binding.recordId, RECORD_ID);
  assert.equal(binding.versionId, versioning.getActiveVersionId(RECORD_ID));
  assert.equal(binding.documentHash, active.documentHash);
  assert.equal(binding.provisionHash, active.provisionHash);
  assert.deepEqual(binding.sourceLocator, active.sourceLocator);

  const quote = active.sourceText.split(/\r?\n\s*\r?\n/).at(-1).trim();
  const claim = { kind: 'RULE', text: quote, quote, recordId: RECORD_ID, citationUrl: SOURCE_URL };
  const claims = verifyEvidenceClaims([claim], [active], {
    missingFacts: [],
    expectedAuthority: 'MAS',
    expectedDomain: 'MAS_FUNDS',
    versioningManager: versioning
  });
  assert.equal(claims.accepted.length, 1, claims.rejected[0]?.reason);
  assert.deepEqual(claims.accepted[0].sourceBinding, binding,
    'Verified quotations retain exact version, document, provision, and locator provenance');

  const citationVerifier = new CitationVerifier(retriever, undefined, versioning);
  const citation = {
    standard: active.standardOrActCode,
    paragraph: active.paragraphOrSection,
    title: active.documentTitle,
    text: quote,
    officialSourceUrl: SOURCE_URL,
    authority: 'MAS',
    sourceBinding: claims.accepted[0].sourceBinding
  };
  const citationResult = citationVerifier.verifyCitation(citation, 'MAS', [active]);
  assert.equal(citationResult.isValid, true, citationResult.reason);
  assert.deepEqual(citationResult.sourceBinding, binding);
  assert.deepEqual(citationResult.citation.sourceBinding, binding);
  assert.equal(citationVerifier.verifyCitation(citation, 'IRAS', [active]).isValid, false,
    'Citation admission enforces governing authority, independently of publisher');

  const staleCitation = structuredClone(citation);
  staleCitation.sourceBinding.documentHash = '0'.repeat(64);
  assert.equal(citationVerifier.verifyCitation(staleCitation, 'MAS', [active]).isValid, false,
    'A stale or altered citation receipt is rejected');
  assert.equal(citationVerifier.verifyCitation(citation, 'MAS', []).isValid, false,
    'A document citation must be in the exact retrieved evidence scope');

  const wrongDomain = verifyEvidenceClaims([claim], [active], {
    missingFacts: [], expectedAuthority: 'MAS', expectedDomain: 'IRAS_TAX', versioningManager: versioning
  });
  assert.equal(wrongDomain.accepted.length, 0);
  assert.match(wrongDomain.rejected[0].reason, /DOMAIN_MISMATCH/);

  const yesterday = new Date(`${CAPTURED_DAY}T00:00:00.000Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayDay = yesterday.toISOString().slice(0, 10);
  assert.equal(verifySharedDocumentAdmission(active, versioning, { targetDate: CAPTURED_DAY }).admitted, true);
  assert.equal(verifySharedDocumentAdmission(active, versioning, { targetDate: yesterdayDay }).admitted, false,
    'Without source-supported effective dates the evidence is limited to its capture day');
  assert.equal(verifySharedDocumentAdmission(active, versioning, { targetDate: '2099-01-01' }).admitted, false);

  const tamper = (mutate) => {
    const altered = structuredClone(active);
    mutate(altered);
    assert.equal(verifySharedDocumentAdmission(altered, versioning).admitted, false);
  };
  tamper(record => { record.sourceText += ' Altered text.'; });
  tamper(record => { record.documentHash = '0'.repeat(64); });
  tamper(record => { record.provisionHash = '1'.repeat(64); });
  tamper(record => { record.sourceLocator.heading = 'Changed locator'; });
  tamper(record => { record.officialSourceUrl = 'https://www.mas.gov.sg/another-document'; });
  tamper(record => { record.authority = 'IRAS'; });
  tamper(record => { record.domain = 'IRAS_TAX'; });
  tamper(record => { record.sourceType = record.sourceType === 'AUTHORITATIVE_SOURCE' ? 'OFFICIAL_GUIDANCE' : 'AUTHORITATIVE_SOURCE'; });
  tamper(record => { record.evidenceTier = record.evidenceTier === 'PRIMARY_SOURCE' ? 'OFFICIAL_GUIDANCE' : 'PRIMARY_SOURCE'; });
  tamper(record => { record.principleSummary += ' promoted'; });
  tamper(record => { record.verificationMethod = 'OTHER_REVIEW'; });
  tamper(record => { record.urlVerificationEvidence = 'unbound URL review'; });

  const managedStaged = structuredClone(active);
  managedStaged.lifecycleState = 'STAGED';
  assert.equal(verifySharedDocumentAdmission(managedStaged, versioning).admitted, false);
  const managedCandidate = structuredClone(active);
  managedCandidate.lifecycleState = 'CANDIDATE';
  managedCandidate.provenance = 'LIVE_EXTERNAL';
  managedCandidate.sourceStatus = 'NEEDS_REVIEW';
  managedCandidate.verificationMethod = 'LIVE_OFFICIAL_TOPIC_VERIFIED';
  managedCandidate.recordRole = 'DISCOVERED_EVIDENCE';
  managedCandidate.groundingEligible = true;
  assert.equal(verifySharedDocumentAdmission(managedCandidate, versioning).admitted, false,
    'A managed document cannot enter the legacy live-candidate citation path');
  const strippedManagedCandidate = structuredClone(managedCandidate);
  delete strippedManagedCandidate.documentAdmissionRequired;
  const strippedAdmission = verifySharedDocumentAdmission(strippedManagedCandidate, versioning);
  assert.equal(strippedAdmission.required, true, 'The manager ledger still identifies a document when its record marker is stripped');
  assert.equal(strippedAdmission.admitted, false);
  const supersededRecord = structuredClone(active);
  supersededRecord.versionId = 'older-superseded-version';
  assert.equal(verifySharedDocumentAdmission(supersededRecord, versioning).admitted, false);
  const retaggedActive = structuredClone(active);
  retaggedActive.sourceType = retaggedActive.sourceType === 'AUTHORITATIVE_SOURCE' ? 'OFFICIAL_GUIDANCE' : 'AUTHORITATIVE_SOURCE';
  assert.equal(verifySharedDocumentAdmission(retaggedActive, versioning).admitted, false);
  for (const untrustedRecord of [managedStaged, managedCandidate, strippedManagedCandidate, supersededRecord, retaggedActive]) {
    assert.equal(citationVerifier.verifyCitation(citation, 'MAS', [untrustedRecord]).isValid, false,
      'Staged, candidate, superseded, stripped-marker, and retagged records cannot satisfy exact citation scope');
  }

  const exposedLedgerEntry = versioning.getLedgerEntry(binding.versionId);
  exposedLedgerEntry.recordSnapshot.evidenceTier = 'PRIMARY_SOURCE';
  exposedLedgerEntry.metadata.reviewApproval.reason = 'tampered external copy';
  assert.equal(verifySharedDocumentAdmission(active, versioning).admitted, true,
    'External ledger snapshots cannot mutate the manager’s recorded admission receipt');

  assert.equal((await service.rollbackUpdatePackage(pkg.packageId)).success, true);
  assert.equal(UNIFIED_SOURCE_REGISTRY[RECORD_ID], undefined);
  assert.equal(retriever.getSourceById(RECORD_ID), undefined,
    'Rollback of a first activation removes the dynamically discovered evidence row');
  UNIFIED_SOURCE_REGISTRY[RECORD_ID] = registeredLegacyBaseline;
  assert.deepEqual(verifySharedDocumentAdmission(registeredLegacyBaseline, versioning), { required: false, admitted: true },
    'An exact registered unmanaged baseline remains eligible after managed history is rolled back');
  const rolledBackBaselineClaim = verifyEvidenceClaims([{
    kind: 'RULE', text: registeredLegacyBaseline.sourceText.trim(),
    quote: registeredLegacyBaseline.sourceText.trim(), recordId: RECORD_ID
  }], [registeredLegacyBaseline], { missingFacts: [], versioningManager: versioning });
  assert.equal(rolledBackBaselineClaim.accepted.length, 1, rolledBackBaselineClaim.rejected[0]?.reason);
} finally {
  delete UNIFIED_SOURCE_REGISTRY[RECORD_ID];
}

const CAPTURE_ONLY_DAY = '2024-10-15';
const FOLLOWING_REFERENCE_DAY = '2024-10-16';
const CAPTURE_ONLY_ID = 'MAS_COMPOSITE_CAPTURE_DAY_TEST';
const captureOnly = createApprovedManagedRecord({
  id: CAPTURE_ONLY_ID,
  title: 'MAS Notice on Capture-Day Date Resolution',
  code: 'MAS-NOTICE-CAPTURE-DAY',
  paragraph: 'Section 1 Capture-day date resolution',
  sourceText: 'MAS Notice on Capture-Day Date Resolution requires licensed fund managers to retain documented valuation controls.',
  retrievedAt: `${CAPTURE_ONLY_DAY}T01:00:00.000Z`,
  approvedAt: `${CAPTURE_ONLY_DAY}T02:00:00.000Z`
});
const captureOnlyLocal = new InMemorySourceRetriever([captureOnly.record], captureOnly.versioningManager);
const captureOnlyComposite = new CompositeSourceRetriever(
  captureOnlyLocal, undefined, undefined, captureOnly.versioningManager
);
const captureDayQuery = (query, extra = {}) => ({
  query,
  authorities: ['MAS'],
  domain: 'MAS_FUNDS',
  referenceDate: FOLLOWING_REFERENCE_DAY,
  ...extra
});
const retrievedIds = async (sourceRetriever, query) =>
  (await sourceRetriever.retrieveSources(query)).map(record => record.id);

const parsedCaptureDayQuery = captureDayQuery(
  'MAS-NOTICE-CAPTURE-DAY licensed fund managers as at 15/10/2024 valuation controls'
);
assert.deepEqual(await retrievedIds(captureOnlyLocal, parsedCaptureDayQuery), [CAPTURE_ONLY_ID]);
assert.deepEqual(await retrievedIds(captureOnlyComposite, parsedCaptureDayQuery), [CAPTURE_ONLY_ID],
  'Composite retrieval uses the same DD/MM/YYYY date parsed by the local retriever');

const explicitOverridesQueryDate = captureDayQuery(
  'MAS-NOTICE-CAPTURE-DAY licensed fund managers as at 14/10/2024 valuation controls',
  { targetDate: CAPTURE_ONLY_DAY }
);
assert.deepEqual(await retrievedIds(captureOnlyLocal, explicitOverridesQueryDate), [CAPTURE_ONLY_ID]);
assert.deepEqual(await retrievedIds(captureOnlyComposite, explicitOverridesQueryDate), [CAPTURE_ONLY_ID],
  'An explicit target date takes precedence over a conflicting date in the query text');

for (const unsupportedDay of ['14/10/2024', '16/10/2024']) {
  const unsupportedQuery = captureDayQuery(
    `MAS-NOTICE-CAPTURE-DAY licensed fund managers as at ${unsupportedDay} valuation controls`
  );
  assert.deepEqual(await retrievedIds(captureOnlyLocal, unsupportedQuery), [],
    `The capture-only document is unavailable for ${unsupportedDay}`);
  assert.deepEqual(await retrievedIds(captureOnlyComposite, unsupportedQuery), [],
    `Composite retrieval preserves capture-day-only admission for ${unsupportedDay}`);
}

const undatedCaptureQuery = captureDayQuery('MAS-NOTICE-CAPTURE-DAY licensed fund managers valuation controls');
assert.deepEqual(await retrievedIds(captureOnlyLocal, undatedCaptureQuery), [],
  'An undated query remains guarded by the following reference day');
assert.deepEqual(await retrievedIds(captureOnlyComposite, undatedCaptureQuery), [],
  'Composite retrieval does not turn an undated request into capture-day evidence');

const historicalSourceText = 'MAS Notice 790 applied to licensed fund managers from 1 January 2024 to 31 December 2024.';
const historical = createApprovedManagedRecord({
  id: 'MAS_HISTORICAL_VALIDITY_TEST',
  title: 'MAS Notice 790 on Fund Valuation',
  code: 'MAS-NOTICE-790',
  paragraph: 'Section 4 Fund valuation',
  sourceText: historicalSourceText,
  retrievedAt: CAPTURED_AT,
  validFrom: '2024-01-01',
  validTo: '2024-12-31'
});
const historicalRetriever = new InMemorySourceRetriever([historical.record], historical.versioningManager);
const historicalCitationVerifier = new CitationVerifier(historicalRetriever, undefined, historical.versioningManager);
const historicalQuote = verifyEvidenceClaims([{
  kind: 'RULE', text: historicalSourceText, quote: historicalSourceText, recordId: historical.record.id
}], [historical.record], {
  missingFacts: [],
  targetDate: '2024-06-01',
  referenceDate: CAPTURED_DAY,
  expectedAuthority: 'MAS',
  expectedDomain: 'MAS_FUNDS',
  versioningManager: historical.versioningManager
});
assert.equal(historicalQuote.accepted.length, 1, historicalQuote.rejected[0]?.reason);
const historicalQuery = await historicalRetriever.retrieveSources({
  query: 'MAS Notice 790 licensed fund managers valuation',
  authorities: ['MAS'],
  domain: 'MAS_FUNDS',
  targetDate: '2024-06-01',
  referenceDate: CAPTURED_DAY
});
assert.ok(historicalQuery.some(record => record.id === historical.record.id),
  'An active approved version with a past validity end remains retrievable for an in-period historical target');
assert.equal(historicalRetriever.findSourcesByStandardOrAct('MAS-NOTICE-790', undefined, {
  targetDate: '2024-06-01', referenceDate: CAPTURED_DAY
}).length, 1);
const historicalCitation = {
  standard: historical.record.standardOrActCode,
  paragraph: historical.record.paragraphOrSection,
  title: historical.record.documentTitle,
  text: historicalSourceText,
  officialSourceUrl: historical.url,
  authority: 'MAS',
  sourceBinding: historicalQuote.accepted[0].sourceBinding
};
assert.equal(historicalCitationVerifier.verifyCitation(historicalCitation, 'MAS', [historical.record], {
  targetDate: '2024-06-01'
}).isValid, true, 'Citation lookup and exact admission both use the requested historical date');
assert.equal((await historicalRetriever.retrieveSources({
  query: 'MAS Notice 790 licensed fund managers valuation',
  authorities: ['MAS'], domain: 'MAS_FUNDS', targetDate: CAPTURED_DAY, referenceDate: CAPTURED_DAY
})).some(record => record.id === historical.record.id), false,
'A source outside its supported period is not retrieved');
assert.equal(historicalCitationVerifier.verifyCitation(historicalCitation, 'MAS', [historical.record], {
  targetDate: CAPTURED_DAY
}).isValid, false, 'Citation admission rejects an out-of-period active version');

const utcBoundary = new Date(`${CAPTURED_DAY}T00:00:00.000Z`);
utcBoundary.setUTCDate(utcBoundary.getUTCDate() - 2);
const boundaryRetrievedAt = `${utcBoundary.toISOString().slice(0, 10)}T23:30:00.000Z`;
const boundarySingaporeDay = getSingaporeDateString(new Date(boundaryRetrievedAt));
const boundaryUtcDay = boundaryRetrievedAt.slice(0, 10);
assert.notEqual(boundarySingaporeDay, boundaryUtcDay);
const captureBoundary = createApprovedManagedRecord({
  id: 'MAS_CAPTURE_DAY_TIMEZONE_TEST',
  title: 'MAS Notice on Capture Day',
  code: 'MAS-NOTICE-CAPTURE-DAY',
  paragraph: 'Section 1 Capture date',
  sourceText: 'MAS Notice on Capture Day states this requirement for licensed fund managers.',
  retrievedAt: boundaryRetrievedAt
});
assert.equal(verifySharedDocumentAdmission(captureBoundary.record, captureBoundary.versioningManager, {
  targetDate: boundarySingaporeDay
}).admitted, true, 'A 23:30 UTC capture belongs to the following Singapore calendar day');
assert.equal(verifySharedDocumentAdmission(captureBoundary.record, captureBoundary.versioningManager, {
  targetDate: boundaryUtcDay
}).admitted, false, 'The UTC calendar day is not the capture day for a managed Singapore source');

const approvalBoundaryAt = new Date(`${CAPTURED_DAY}T02:30:00+08:00`).toISOString();
assert.notEqual(approvalBoundaryAt.slice(0, 10), CAPTURED_DAY,
  'The early Singapore approval time falls on the preceding UTC date');
const approvalBoundary = createApprovedManagedRecord({
  id: 'MAS_APPROVAL_DATE_TIMEZONE_TEST',
  title: 'MAS Notice on Review Date',
  code: 'MAS-NOTICE-APPROVAL-DATE',
  paragraph: 'Section 1 Approval date',
  sourceText: 'MAS Notice on Review Date states this requirement for licensed fund managers.',
  retrievedAt: CAPTURED_AT,
  approvedAt: approvalBoundaryAt
});
assert.equal(approvalBoundary.record.lastVerifiedDate, CAPTURED_DAY);
assert.equal(approvalBoundary.record.urlVerifiedDate, CAPTURED_DAY);
assert.equal(verifySharedDocumentAdmission(approvalBoundary.record, approvalBoundary.versioningManager).admitted, true,
  'Approval date-only verification fields use the Singapore approval day while preserving the UTC approval timestamp');

const legacyLiveRecord = {
  ...historical.record,
  id: 'IRAS_LEGACY_LIVE_CITATION_TEST',
  authority: 'IRAS',
  authorityName: 'Inland Revenue Authority of Singapore',
  sourcePublisher: 'Inland Revenue Authority of Singapore',
  legalOrStandardInstrument: 'IRAS Guidance Test',
  documentTitle: 'IRAS Guidance Test',
  standardOrActCode: 'IRAS-LIVE-TEST',
  paragraphOrSection: 'Section 1 Guidance',
  principleSummary: 'IRAS guidance test',
  officialSourceUrl: 'https://www.iras.gov.sg/taxes/corporate-income-tax/deductions-claimable',
  canonicalSourceUrl: 'https://www.iras.gov.sg/taxes/corporate-income-tax/deductions-claimable',
  domain: 'IRAS_TAX',
  sourceStatus: 'NEEDS_REVIEW',
  sourceType: 'AUTHORITATIVE_SOURCE',
  evidenceTier: 'OFFICIAL_GUIDANCE',
  lifecycleState: 'CANDIDATE',
  provenance: 'LIVE_EXTERNAL',
  sourceAuthority: 'IRAS',
  verificationMethod: 'LIVE_OFFICIAL_TOPIC_VERIFIED',
  recordRole: 'DISCOVERED_EVIDENCE',
  groundingEligible: true,
  urlVerificationStatus: 'VERIFIED',
  documentAdmissionRequired: undefined,
  versionId: undefined,
  sourceBinding: undefined
};
const legacyCitationVerifier = new CitationVerifier(
  new InMemorySourceRetriever([legacyLiveRecord], new SourceVersioningManager()),
  undefined,
  new SourceVersioningManager()
);
const legacyCitation = {
  standard: legacyLiveRecord.standardOrActCode,
  paragraph: legacyLiveRecord.paragraphOrSection,
  title: legacyLiveRecord.documentTitle,
  text: legacyLiveRecord.sourceText,
  officialSourceUrl: legacyLiveRecord.officialSourceUrl,
  authority: 'IRAS'
};
assert.equal(legacyCitationVerifier.verifyCitation(legacyCitation, 'IRAS', [legacyLiveRecord]).status, 'SOURCE_NEEDS_REVIEW',
  'Ordinary legacy IRAS live evidence keeps its existing candidate citation behavior');
assert.equal(legacyCitationVerifier.verifyCitation({ ...legacyCitation, sourceBinding: historicalQuote.accepted[0].sourceBinding },
  'IRAS', [legacyLiveRecord]).isValid, false, 'A legacy live citation cannot retain a stale managed-document receipt');

console.log('✓ Shared approved-document admission and verified citation regression checks passed');
