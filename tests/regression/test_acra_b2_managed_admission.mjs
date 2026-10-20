import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractOfficialDocumentFromRetrieved } from '../../src/retrieval/officialDocumentExtractor.ts';
import {
  ACRA_2022_ANNUAL_RETURN_TIMELINES_URL,
  getAcraAnnualReturnDeadlineMonths,
  getAcraAnnualReturnDeadlineTablePassage,
  supportsAcraAnnualReturnDeadlineEvidence
} from '../../src/retrieval/acraAnnualReturnFilingRule.ts';
import { LiveRegulatoryFeedService } from '../../src/retrieval/liveRegulatoryFeed.ts';
import { InMemorySourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import { SourceVersioningManager, computeSha256Bytes } from '../../src/standards/sourceVersioning.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { verifySharedDocumentAdmission } from '../../src/standards/sharedDocumentAdmission.ts';
import { findRecordEligibilityRejection, verifyEvidenceClaims } from '../../src/verification/claimEvidenceVerifier.ts';
import { applyAcraAnnualReturnDeadline } from '../../src/engine/acraAnnualReturnApplication.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureBytes = gunzipSync(readFileSync(path.join(root, 'tests/fixtures/acra-2022-newsletter-captured.html.gz')));
const receipt = JSON.parse(readFileSync(path.join(root, 'tests/fixtures/acra-2022-newsletter-captured.provenance.json'), 'utf8'));
const documentHash = createHash('sha256').update(fixtureBytes).digest('hex');
assert.equal(documentHash, receipt.sha256);
assert.equal(fixtureBytes.byteLength, receipt.bytes);
const retrievedAt = new Date(receipt.retrievedAt).toISOString();
const request = {
  url: ACRA_2022_ANNUAL_RETURN_TIMELINES_URL, authority: 'ACRA', domain: 'ACRA_CORP',
  expectedTopic: {
    standardIdentifiers: ['ACRAConnect'], expectedTitles: ['May/Jun 2022 Issue of ACRAConnect'],
    topicTerms: ['annual returns', 'financial year end', 'listed companies', 'non-listed companies', 'branch register'],
    minimumTopicTermMatches: 1
  },
  standardOrActCode: 'ACRA Annual Return Filing Requirements',
  legalOrStandardInstrument: 'ACRA annual return filing guidance',
  documentKind: 'HTML', sectionHeading: 'Reminder to file Annual Returns (AR)',
  topicIds: ['acra_annual-returns']
};
const extraction = await extractOfficialDocumentFromRetrieved(request, {
  status: 'SUCCESS', sourceUrl: receipt.url, finalUrl: receipt.finalUrl,
  contentBytes: new Uint8Array(fixtureBytes), contentType: receipt.contentType,
  httpStatus: receipt.httpStatus, retrievedAt
});
assert.equal(extraction.status, 'SUCCESS', extraction.status === 'REJECTED' ? extraction.reason : 'exact extraction');
const record = extraction.record;
assert.equal(record.acraFyeCohortApplicability?.fyeStartDate, '2018-08-31');
assert.equal(record.acraFyeCohortApplicability?.sourceQuote,
  'The timelines for companies with Financial Year End (FYE) on or after 31 Aug 2018 are as follows:');
assert.equal(record.effectiveDate, undefined);
assert.equal(record.validFrom, undefined);
assert.equal(record.validTo, undefined);
assert.equal(record.sourceLocator?.tableStructure, 'PRESERVED');
assert.equal(supportsAcraAnnualReturnDeadlineEvidence(record.sourceText), true);
const table = getAcraAnnualReturnDeadlineTablePassage(record.sourceText);
assert.ok(table);
assert.match(table, /^\| Listed companies \| Non-listed companies/m);
assert.match(table, /Companies having a share capital and keeping a branch register outside Singapore \| Within 6 months after FYE \|$/);
assert.match(table, /\nAll companies \| Within 5 months after FYE \| Within 7 months after FYE\n/);
assert.equal(table.toLowerCase().includes('private'), false);
assert.equal(getAcraAnnualReturnDeadlineMonths(record.sourceText,
  { listingStatus: 'NON_LISTED', hasOverseasBranchRegister: false }), 7);
assert.equal(getAcraAnnualReturnDeadlineMonths(record.sourceText,
  { listingStatus: 'LISTED', hasOverseasBranchRegister: true, hasShareCapital: true }), 6);
assert.equal(getAcraAnnualReturnDeadlineMonths(record.sourceText,
  { listingStatus: 'NON_LISTED', hasOverseasBranchRegister: true, hasShareCapital: true }), undefined);

const packageId = `ACRA-AR-2022-${documentHash.slice(0, 12)}`;
const manager = new SourceVersioningManager();
const feed = new LiveRegulatoryFeedService(manager);
const packageWithoutHash = {
  packageId, releaseDate: '2022-06-29', authority: 'ACRA', updates: [record],
  amendments: [{ recordId: record.id, title: 'Annual return timeline source capture',
    changeType: 'APPLICABILITY_CHANGE', summary: 'Source-stated FYE cohort; no effective-date interval is asserted.' }],
  extractionRequests: { [record.id]: request },
  documentMetadata: { [record.id]: {
    requestUrl: receipt.url, sourceUrl: receipt.url, finalUrl: receipt.finalUrl,
    contentType: receipt.contentType, httpStatus: receipt.httpStatus, retrievedAt
  } }
};
const pkg = { ...packageWithoutHash, packageHash: feed.computePackageHash(packageWithoutHash) };
const strippedCaptureMarkers = structuredClone(pkg);
strippedCaptureMarkers.packageId += '-stripped-markers';
delete strippedCaptureMarkers.extractionRequests;
delete strippedCaptureMarkers.documentMetadata;
delete strippedCaptureMarkers.packageHash;
strippedCaptureMarkers.packageHash = feed.computePackageHash(strippedCaptureMarkers);
const strippedStage = await feed.stageUpdatePackage(strippedCaptureMarkers);
assert.equal(strippedStage.success, false);
assert.match(strippedStage.error || '', /ACRA annual-return managed source identity/);
const artifactDir = path.join(root, 'artifacts/acra-b2-admission-2026-10-20');
mkdirSync(artifactDir, { recursive: true });
const rawDocument = {
  sourceUrl: receipt.url, finalUrl: receipt.finalUrl, contentType: receipt.contentType,
  contentBytes: new Uint8Array(fixtureBytes), httpStatus: receipt.httpStatus, retrievedAt
};
const bundle = {
  schemaVersion: 1, package: pkg,
  documents: [{ recordId: record.id, sourceUrl: receipt.url, finalUrl: receipt.finalUrl,
    contentType: receipt.contentType, httpStatus: receipt.httpStatus, retrievedAt,
    bodyBase64: Buffer.from(fixtureBytes).toString('base64') }],
  approval: null, captureReceipt: receipt
};
writeFileSync(path.join(artifactDir, 'source-review-bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`);

const staged = await feed.stageUpdatePackage(pkg);
assert.equal(staged.success, true, staged.error);
const stagedCandidate = manager.getCandidates().find(candidate => candidate.record.id === record.id);
assert.equal(stagedCandidate?.record.documentAdmissionRequired, true);
const unapproved = verifySharedDocumentAdmission(stagedCandidate.record, manager, {
  targetDate: '2025-12-31', referenceDate: '2026-10-20', expectedAuthority: 'ACRA',
  expectedDomain: 'ACRA_CORP', applicabilityTarget: 'ACRA_FYE'
});
assert.equal(unapproved.admitted, false);
const verified = await feed.verifyUpdatePackage(packageId, { [record.id]: rawDocument });
assert.equal(verified.isValid, true, verified.rejectionReason);
assert.equal(feed.approveUpdatePackage(packageId, 'TEST_ONLY regression runner',
  'TEST_ONLY: isolated exact-byte admission regression; not a real source approval'), true);
const testApproval = feed.getPackageApprovalReceipt(packageId);
assert.ok(testApproval?.reason.startsWith('TEST_ONLY:'));
const activated = await feed.activateUpdatePackage(packageId);
assert.equal(activated.success, true, activated.error);
const active = UNIFIED_SOURCE_REGISTRY[record.id];
assert.ok(active);
assert.equal(active.provenance, 'LIVE_PATCH');
assert.equal(active.lifecycleState, 'ACTIVE');
assert.equal(active.documentAdmissionRequired, true);
assert.equal(active.documentHash, documentHash);
assert.equal(active.provisionHash, record.provisionHash);

// A record ID already used by the managed ACRA source remains protected even
// if a later package rewrites the source URL and strips the cohort/capture markers.
const replacedManagedPointer = structuredClone(pkg);
replacedManagedPointer.packageId += '-replaced-managed-pointer';
delete replacedManagedPointer.extractionRequests;
delete replacedManagedPointer.documentMetadata;
replacedManagedPointer.updates[0].officialSourceUrl = 'https://www.acra.gov.sg/register/business/registering-different-business-structures/local-company/choosing-a-companys-financial-year-end/';
replacedManagedPointer.updates[0].canonicalSourceUrl = replacedManagedPointer.updates[0].officialSourceUrl;
delete replacedManagedPointer.updates[0].acraFyeCohortApplicability;
delete replacedManagedPointer.packageHash;
replacedManagedPointer.packageHash = feed.computePackageHash(replacedManagedPointer);
const replacementStage = await feed.stageUpdatePackage(replacedManagedPointer);
assert.equal(replacementStage.success, false);
assert.match(replacementStage.error || '', /ACRA annual-return managed source identity/);

const gateOptions = {
  targetDate: '2025-12-31', referenceDate: '2026-10-20', expectedAuthority: 'ACRA',
  expectedDomain: 'ACRA_CORP', applicabilityTarget: 'ACRA_FYE'
};
assert.equal(verifySharedDocumentAdmission(active, manager, gateOptions).admitted, true);
// Shared source admission may use the reference date for general retrieval;
// the deadline application still requires a supplied FYE and never derives
// that missing company fact from the reference date.
assert.equal(verifySharedDocumentAdmission(active, manager, { ...gateOptions, targetDate: undefined }).admitted, true);
assert.equal(verifySharedDocumentAdmission(active, manager, { ...gateOptions, targetDate: '2018-08-30' }).reason,
  'ACRA_FYE_COHORT_NOT_APPLICABLE');
assert.equal(verifySharedDocumentAdmission(active, manager, { ...gateOptions, targetDate: '2026-10-21' }).reason,
  'DOCUMENT_FUTURE_SCOPE_UNVERIFIED');
assert.equal(verifySharedDocumentAdmission(active, manager, { ...gateOptions, expectedAuthority: 'MAS' }).reason,
  'DOCUMENT_GOVERNING_AUTHORITY_MISMATCH');
assert.equal(verifySharedDocumentAdmission(active, manager, { ...gateOptions, expectedDomain: 'MAS_FUNDS' }).reason,
  'DOCUMENT_DOMAIN_MISMATCH');
assert.equal(verifySharedDocumentAdmission({ ...active, acraFyeCohortApplicability: {
  ...active.acraFyeCohortApplicability, fyeStartDate: '1900-01-01'
}}, manager, gateOptions).admitted, false);

const verifiedQuote = verifyEvidenceClaims([{ kind: 'RULE', text: table, quote: table, recordId: active.id }], [active], {
  missingFacts: [], targetDate: '2025-12-31', referenceDate: '2026-10-20',
  expectedAuthority: 'ACRA', expectedDomain: 'ACRA_CORP', applicabilityTarget: 'ACRA_FYE', versioningManager: manager
});
assert.equal(verifiedQuote.accepted.length, 1, JSON.stringify(verifiedQuote.rejected));
assert.ok(verifiedQuote.accepted[0].sourceBinding, JSON.stringify({ directAdmission: verifySharedDocumentAdmission(active, manager, gateOptions),
  activeVersionId: active.versionId, managed: active.documentAdmissionRequired }));

const ordinaryLive = {
  ...record, id: `${record.id}_ORDINARY_LIVE_CONTROL`, provenance: 'LIVE_EXTERNAL',
  lifecycleState: 'CANDIDATE', sourceStatus: 'NEEDS_REVIEW', verificationMethod: 'LIVE_OFFICIAL_TOPIC_VERIFIED',
  urlVerificationStatus: 'VERIFIED', groundingEligible: true, documentAdmissionRequired: undefined,
  retrievedAt, lastVerifiedDate: undefined
};
const ordinaryManager = new SourceVersioningManager();
assert.equal(findRecordEligibilityRejection(ordinaryLive, '2025-12-31', '2026-10-20',
  ordinaryManager, 'ACRA', 'ACRA_CORP'), 'LIVE_HISTORICAL_PAGE_SCOPE_UNVERIFIED');
const ordinaryClaim = verifyEvidenceClaims([{ kind: 'RULE', text: table, quote: table, recordId: ordinaryLive.id }], [ordinaryLive], {
  missingFacts: [], targetDate: '2025-12-31', referenceDate: '2026-10-20',
  expectedAuthority: 'ACRA', expectedDomain: 'ACRA_CORP', versioningManager: ordinaryManager
});
assert.equal(ordinaryClaim.accepted.length, 0);
assert.equal(ordinaryClaim.rejected[0].reason, 'LIVE_HISTORICAL_PAGE_SCOPE_UNVERIFIED');

const query = 'For a Singapore-incorporated non-listed company with no overseas branch register and financial year ending 31/12/2025, what is the annual-return filing deadline? Show the date as DD/MM/YYYY; do not prepare a journal.';
const issue = {
  id: 'acra-b2-deadline', subject: 'ACRA annual return filing deadline', population: 'COMPANY',
  domain: 'ACRA_CORPORATE', governingAuthorities: ['ACRA'], contextualAuthorities: [],
  operation: 'FILING_REQUIREMENT', mappedTopicIds: ['acra_annual-returns'],
  evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.99, status: 'MAPPED'
};
const workstream = await buildAuthorityWorkstreams(query, {
  source: 'SEMANTIC_ISSUES', issues: [issue], coverageEstablished: true, hasUnmappedResidual: false
}, { retriever: new InMemorySourceRetriever(undefined, manager), referenceDate: '2026-10-20', localOnly: true });
const result = workstream.workstreams.flatMap(item => item.issues).find(item => item.issueId === issue.id);
assert.ok(result);
assert.equal(result.evidenceStatus, 'VERIFIED', JSON.stringify(result.gaps));
assert.equal(result.applicationStatus, 'VERIFIED');
const b2Claim = result.verifiedClaims.find(claim => claim.recordId === record.id && getAcraAnnualReturnDeadlineTablePassage(claim.quote));
assert.ok(b2Claim);
assert.ok(b2Claim.sourceBinding, JSON.stringify({ recordAdmissionRequired: active.documentAdmissionRequired,
  activeVersionId: active.versionId, ledgerAdmissionRequired: active.versionId
    ? manager.getLedgerEntry(active.versionId)?.metadata.documentAdmissionRequired : undefined }));
assert.equal(b2Claim.sourceBinding.recordId, record.id);
assert.equal(b2Claim.sourceBinding.versionId, manager.getActiveVersionId(record.id));
assert.equal(b2Claim.sourceBinding.documentHash, documentHash);
assert.equal(b2Claim.sourceBinding.provisionHash, record.provisionHash);
assert.match(result.applicationReason || '', /deadline of 31\/07\/2026\./);

const applicationEvidence = {
  evidenceStatus: 'VERIFIED', targetDate: '2025-12-31',
  lifecycle: { admitted: true, verified: true, covered: true }, sources: [active],
  verifiedClaims: [{ recordId: active.id, quote: table }]
};
const applied = applyAcraAnnualReturnDeadline(query, applicationEvidence);
assert.equal(applied.applicationStatus, 'VERIFIED');
assert.equal(applied.deadlineDate, '31/07/2026');
assert.equal(applied.monthCount, 7);
for (const incomplete of [
  'For a Singapore-incorporated company with no overseas branch register and FYE 31/12/2025, what is its annual return deadline?',
  'For a Singapore-incorporated non-listed company with FYE 31/12/2025, what is its annual return deadline?',
  'For a Singapore-incorporated non-listed company with share capital and an overseas branch register and FYE 31/12/2025, what is its annual return deadline?'
]) assert.equal(applyAcraAnnualReturnDeadline(incomplete, applicationEvidence).applicationStatus, 'UNRESOLVED');
assert.equal(query.toLowerCase().includes('private'), false);

writeFileSync(path.join(artifactDir, 'lifecycle-replay.json'), `${JSON.stringify({
  status: 'TEST_ONLY_LIFECYCLE_REPLAY_COMPLETE',
  approvalBoundary: 'TEST_ONLY isolated manager; no real ACRA source approval recorded',
  packageId, recordId: record.id, sourceUrl: receipt.url, documentHash,
  provisionHash: record.provisionHash, cohort: record.acraFyeCohortApplicability,
  captureReceipt: receipt, canonicalLifecycleRetrievedAt: retrievedAt,
  publicationDate: pkg.releaseDate, testApproval,
  lifecycle: { staged: staged.success, verified: verified.isValid, activated: activated.success },
  workstream: { evidenceStatus: result.evidenceStatus, applicationStatus: result.applicationStatus,
    applicationReason: result.applicationReason,
    computedDeadlineFromApplicationReason: result.applicationReason?.match(/deadline of (\d{2}\/\d{2}\/\d{4})\./)?.[1],
    verifiedClaimBinding: b2Claim.sourceBinding },
  directApplicationCrossCheck: { deadlineDate: applied.deadlineDate, monthCount: applied.monthCount },
  rejections: { unapproved: unapproved.reason, beforeCohort: 'ACRA_FYE_COHORT_NOT_APPLICABLE',
    afterCapture: 'DOCUMENT_FUTURE_SCOPE_UNVERIFIED', ordinaryLiveHistorical: 'LIVE_HISTORICAL_PAGE_SCOPE_UNVERIFIED',
    unknownNonListedBranchCell: 'UNRESOLVED' }
}, null, 2)}\n`);
delete UNIFIED_SOURCE_REGISTRY[record.id];
console.log(`PASS: actual ACRA bytes -> stage -> verify -> TEST_ONLY approval -> activation -> B2 deadline ${applied.deadlineDate}`);
