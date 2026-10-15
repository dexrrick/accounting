import assert from 'node:assert/strict';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { LiveRegulatoryFeedService } from '../../src/retrieval/liveRegulatoryFeed.ts';
import { MASDocumentUpdateAdapter } from '../../src/retrieval/masDocumentUpdateAdapter.ts';
import { getDueAuthorities } from '../../src/retrieval/regulatoryUpdateScheduler.ts';
import { cleanHtmlText } from '../../src/retrieval/sourceAdapters.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { SourceVersioningManager } from '../../src/standards/sourceVersioning.ts';

const HTML_URL = 'https://www.mas.gov.sg/regulation/notices/mas-notice-123';
const PDF_URL = 'https://www.mas.gov.sg/regulation/guidelines/mas-guidelines-456.pdf';
const HTML_RECORD_ID = 'MAS_LIFECYCLE_NOTICE_123';
const PDF_RECORD_ID = 'MAS_LIFECYCLE_GUIDELINE_456';

function htmlFixture(year = 2025) {
  return new TextEncoder().encode(`<!doctype html><html><head><title>MAS Notice on Investment Fund Valuation</title></head><body><main>
    <h1>MAS Notice on Investment Fund Valuation</h1>
    <p>MAS Notice 123 applies to investment funds and their valuation controls.</p>
    <section id="fund-valuation"><h2>Section 4 Fund valuation</h2>
      <p>MAS Notice 123 requires investment funds to apply consistent fund valuation methods.</p>
      <p>Effective from 1 January ${year}, the investment funds valuation requirement applies.</p>
    </section>
  </main></body></html>`);
}

function pdfString(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function pdfLine(y, value) {
  return `BT /F1 11 Tf 1 0 0 1 40 ${y} Tm (${pdfString(value)}) Tj ET\n`;
}

function pdfFixture(year = 2025) {
  const stream = [
    pdfLine(760, 'MAS Guidelines on Investment Fund Valuation'),
    pdfLine(735, 'MAS Guidelines 456 govern investment funds.'),
    pdfLine(710, 'Section 8 Fund valuation'),
    pdfLine(685, 'Investment funds must apply consistent fund valuation methods.'),
    pdfLine(660, `Effective from 1 January ${year}, the fund valuation requirement applies.`)
  ].join('');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /MediaBox [0 0 612 792] /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let document = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document, 'ascii'));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(document, 'ascii');
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) document += `${String(offset).padStart(10, '0')} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document, 'ascii');
}

const monitoredDocuments = [
  {
    recordId: HTML_RECORD_ID,
    amendmentTitle: 'MAS Notice 123 revision',
    extractionRequest: {
      url: HTML_URL,
      authority: 'MAS',
      domain: 'MAS_FUNDS',
      expectedTopic: {
        standardIdentifiers: ['MAS Notice 123'],
        expectedTitles: ['MAS Notice on Investment Fund Valuation'],
        topicTerms: ['investment funds', 'fund valuation']
      },
      standardOrActCode: 'MAS-NOTICE-123',
      legalOrStandardInstrument: 'MAS Notice 123',
      documentKind: 'HTML',
      relevantSection: 'Section 4 Fund valuation',
      elementId: 'fund-valuation'
    }
  },
  {
    recordId: PDF_RECORD_ID,
    amendmentTitle: 'MAS Guidelines 456 revision',
    extractionRequest: {
      url: PDF_URL,
      authority: 'MAS',
      domain: 'MAS_FUNDS',
      expectedTopic: {
        standardIdentifiers: ['MAS Guidelines 456'],
        expectedTitles: ['MAS Guidelines on Investment Fund Valuation'],
        topicTerms: ['investment funds', 'fund valuation']
      },
      standardOrActCode: 'MAS-GUIDELINES-456',
      legalOrStandardInstrument: 'MAS Guidelines 456',
      documentKind: 'PDF',
      sectionHeading: 'Section 8 Fund valuation'
    }
  }
];

class FixtureRetriever extends ControlledWebRetriever {
  documents = new Map();

  set(url, contentBytes, contentType) {
    this.documents.set(url, { contentBytes: new Uint8Array(contentBytes), contentType });
  }

  async fetchOfficialDocument(url) {
    const document = this.documents.get(url);
    if (!document) return { status: 'HTTP_ERROR', error: 'Fixture is unavailable', retrievedAt: '2026-10-15T00:00:00.000Z', sourceUrl: url };
    return {
      status: 'SUCCESS',
      httpStatus: 200,
      sourceUrl: url,
      finalUrl: url,
      contentType: document.contentType,
      contentBytes: new Uint8Array(document.contentBytes),
      retrievedAt: '2026-10-15T00:00:00.000Z',
      etag: `"${document.contentBytes.byteLength}"`,
      lastModified: 'Wed, 14 Oct 2026 00:00:00 GMT'
    };
  }
}

function createFixtureService() {
  const retriever = new FixtureRetriever();
  retriever.set(HTML_URL, htmlFixture(), 'text/html; charset=utf-8');
  retriever.set(PDF_URL, pdfFixture(), 'application/pdf');
  const versioning = new SourceVersioningManager();
  const adapter = new MASDocumentUpdateAdapter(monitoredDocuments);
  const service = new LiveRegulatoryFeedService(versioning, undefined, retriever, [adapter]);
  return { retriever, versioning, adapter, service };
}

async function discover(service) {
  const result = await service.checkForUpdates();
  assert.equal(result.hasUpdates, true);
  assert.equal(result.packages.length, 1);
  return result.packages[0];
}

function rawDocumentsFor(pkg, retriever) {
  return Object.fromEntries(pkg.updates.map(record => {
    const request = pkg.extractionRequests[record.id];
    const fixture = retriever.documents.get(request.url);
    return [record.id, {
      sourceUrl: request.url,
      finalUrl: request.url,
      contentType: fixture.contentType,
      contentBytes: new Uint8Array(fixture.contentBytes),
      httpStatus: 200,
      retrievedAt: '2026-10-15T00:00:00.000Z'
    }];
  }));
}

function withoutHash(pkg) {
  const copy = structuredClone(pkg);
  delete copy.packageHash;
  return copy;
}

async function testMasLifecycleAndRollback() {
  assert.equal(UNIFIED_SOURCE_REGISTRY[HTML_RECORD_ID], undefined);
  assert.equal(UNIFIED_SOURCE_REGISTRY[PDF_RECORD_ID], undefined);
  const { retriever, versioning, service } = createFixtureService();
  const candidate = await discover(service);
  assert.match(candidate.packageId, /^MAS-[a-f0-9]{64}$/);
  assert.equal(candidate.authority, 'MAS');
  assert.deepEqual(new Set(candidate.updates.map(record => record.id)), new Set([HTML_RECORD_ID, PDF_RECORD_ID]));
  assert.ok(candidate.updates.every(record => record.authority === 'MAS' && record.sourceAuthority === 'MAS' &&
    record.sourcePublisher === 'Monetary Authority of Singapore' && record.groundingEligible === false));
  assert.ok(candidate.updates.every(record => record.extractionStatus === 'EXACT' && record.documentHash && record.provisionHash));
  assert.ok(candidate.updates.find(record => record.id === HTML_RECORD_ID).sourceLocator.boundary);
  assert.equal(candidate.updates.find(record => record.id === PDF_RECORD_ID).sourceLocator.sourceType, 'PDF');
  assert.ok(candidate.updates.find(record => record.id === PDF_RECORD_ID).sourceLocator.pageNumber);

  const template = structuredClone(candidate);
  const staged = await service.stageUpdatePackage(candidate, {
    sourceUrl: 'https://attacker.invalid/override',
    httpStatus: 599,
    etag: 'caller-override',
    lastModified: 'caller-override'
  });
  assert.equal(staged.success, true);
  for (const record of candidate.updates) {
    const retrieval = candidate.documentMetadata[record.id];
    const stagedCandidate = versioning.getCandidates().find(item => item.record.id === record.id);
    assert.ok(stagedCandidate);
    assert.equal(stagedCandidate.metadata.retrievedAt, retrieval.retrievedAt);
    assert.equal(stagedCandidate.metadata.sourceUrl, retrieval.sourceUrl);
    assert.equal(stagedCandidate.metadata.httpStatus, retrieval.httpStatus);
    assert.equal(stagedCandidate.metadata.etag, retrieval.etag);
    assert.equal(stagedCandidate.metadata.lastModified, retrieval.lastModified);
  }
  const expectedHtmlText = candidate.updates.find(record => record.id === HTML_RECORD_ID).sourceText;
  candidate.updates.find(record => record.id === HTML_RECORD_ID).sourceText = 'mutated caller package';
  const stagedView = service.getStagedPackages()[0];
  stagedView.updates[0].sourceText = 'mutated getter snapshot';
  assert.equal(service.getStagedPackages()[0].updates.find(record => record.id === HTML_RECORD_ID).sourceText, expectedHtmlText);
  assert.equal(UNIFIED_SOURCE_REGISTRY[HTML_RECORD_ID], undefined);

  assert.equal((await service.verifyUpdatePackage(template.packageId, rawDocumentsFor(template, retriever))).isValid, true);
  assert.equal(service.recordReviewDecision(template.packageId, 'reviewer@example.test', 'Audit-only review note'), true);
  assert.equal((await service.activateUpdatePackage(template.packageId)).success, false, 'Audit-only review notes do not grant activation approval');
  assert.equal(await service.approveUpdatePackage(template.packageId, 'reviewer@example.test', 'Verified exact source and applicability'), true);
  assert.equal((await service.verifyUpdatePackage(template.packageId, rawDocumentsFor(template, retriever))).isValid, true);
  assert.equal((await service.activateUpdatePackage(template.packageId)).success, false, 'Re-verification invalidates a prior approval');
  assert.equal(await service.approveUpdatePackage(template.packageId, 'reviewer@example.test', 'Reapproved verified content'), true);
  assert.equal(await service.activateUpdatePackage(template.packageId).then(result => result.success), true);
  for (const id of [HTML_RECORD_ID, PDF_RECORD_ID]) {
    const active = UNIFIED_SOURCE_REGISTRY[id];
    assert.equal(active.lifecycleState, 'ACTIVE');
    assert.equal(active.groundingEligible, false);
    assert.equal(active.provenance, 'LIVE_PATCH');
    assert.ok(versioning.getActiveVersionId(id).startsWith(`${template.packageId}-${id}`));
    const ledgerEntry = versioning.getAllLedgerEntries().find(entry => entry.recordId === id && entry.isActive);
    const retrieval = template.documentMetadata[id];
    assert.ok(ledgerEntry);
    assert.equal(ledgerEntry.metadata.retrievedAt, retrieval.retrievedAt);
    assert.equal(ledgerEntry.metadata.sourceUrl, retrieval.sourceUrl);
    assert.equal(ledgerEntry.metadata.httpStatus, retrieval.httpStatus);
    assert.equal(ledgerEntry.metadata.etag, retrieval.etag);
    assert.equal(ledgerEntry.metadata.lastModified, retrieval.lastModified);
    for (const field of ['sourceText', 'authority', 'sourceAuthority', 'sourcePublisher', 'standardOrActCode', 'paragraphOrSection', 'effectiveDate', 'validFrom', 'validTo', 'officialSourceUrl', 'canonicalSourceUrl', 'documentHash', 'provisionHash', 'sourceLocator']) {
      assert.deepEqual(ledgerEntry.recordSnapshot[field], active[field], `Ledger and active registry preserve approved ${field}`);
    }
  }

  const unchanged = await service.checkForUpdates();
  assert.equal(unchanged.hasUpdates, false, 'Identical MAS documents are deduplicated against the active stable record IDs');

  retriever.set(HTML_URL, htmlFixture(2026), 'text/html; charset=utf-8');
  const update = await discover(service);
  assert.equal(update.updates.length, 1);
  assert.equal(update.updates[0].id, HTML_RECORD_ID, 'Updates retain the configured stable record identity');
  assert.notEqual(update.packageId, template.packageId, 'The package ID changes with document, provision, and applicability content');
  assert.equal((await service.stageUpdatePackage(update)).success, true);
  assert.equal((await service.verifyUpdatePackage(update.packageId, rawDocumentsFor(update, retriever))).isValid, true);
  assert.equal(await service.approveUpdatePackage(update.packageId, 'reviewer@example.test', 'Reviewed revised applicability date'), true);
  assert.equal((await service.activateUpdatePackage(update.packageId)).success, true);
  assert.equal((await service.rollbackUpdatePackage(template.packageId)).success, false, 'Older packages cannot roll back over a newer active version');

  assert.equal((await service.rollbackUpdatePackage(update.packageId)).success, true);
  assert.equal(UNIFIED_SOURCE_REGISTRY[HTML_RECORD_ID].sourceText, expectedHtmlText);
  assert.ok(versioning.getActiveVersionId(HTML_RECORD_ID).startsWith(`${template.packageId}-${HTML_RECORD_ID}`));
  assert.equal((await service.rollbackUpdatePackage(template.packageId)).success, true);
  assert.equal(UNIFIED_SOURCE_REGISTRY[HTML_RECORD_ID], undefined, 'Rollback of a first activation clears its active registry row');
  assert.equal(UNIFIED_SOURCE_REGISTRY[PDF_RECORD_ID], undefined);
  assert.equal(versioning.getActiveVersionId(HTML_RECORD_ID), undefined);
  assert.ok(versioning.getAllLedgerEntries().length >= 3, 'Rollback retains the append-only activation history');

  retriever.set(HTML_URL, htmlFixture(2025), 'text/html; charset=utf-8');
  const replay = structuredClone(template);
  assert.equal((await service.stageUpdatePackage(replay)).success, true);
  assert.equal((await service.verifyUpdatePackage(replay.packageId, rawDocumentsFor(replay, retriever))).isValid, true);
  assert.equal(await service.approveUpdatePackage(replay.packageId, 'reviewer@example.test', 'Approved replayed historical package'), true);
  assert.equal((await service.activateUpdatePackage(replay.packageId)).success, true);
  const replayEntries = versioning.getAllLedgerEntries().filter(entry => entry.recordId === HTML_RECORD_ID);
  assert.ok(replayEntries.length >= 3);
  assert.equal(new Set(replayEntries.map(entry => entry.versionId)).size, replayEntries.length, 'Replaying a content-addressed package does not overwrite earlier ledger entries');
  assert.equal((await service.rollbackUpdatePackage(replay.packageId)).success, true);
  assert.equal(UNIFIED_SOURCE_REGISTRY[HTML_RECORD_ID], undefined);
}

async function testFailClosedVerificationAndApproval() {
  for (const failure of ['missing', 'wrong-host', 'altered-bytes']) {
    const { retriever, service } = createFixtureService();
    const candidate = await discover(service);
    assert.equal((await service.stageUpdatePackage(candidate)).success, true);
    const documents = rawDocumentsFor(candidate, retriever);
    if (failure === 'missing') delete documents[HTML_RECORD_ID];
    if (failure === 'wrong-host') documents[HTML_RECORD_ID].finalUrl = 'https://example.invalid/not-mas';
    if (failure === 'altered-bytes') documents[HTML_RECORD_ID].contentBytes[0] ^= 1;
    const result = await service.verifyUpdatePackage(candidate.packageId, documents);
    assert.equal(result.isValid, false, `${failure} MAS verification must fail closed`);
    assert.equal(await service.approveUpdatePackage(candidate.packageId, 'reviewer@example.test', 'Should not approve'), false);
    assert.equal((await service.activateUpdatePackage(candidate.packageId)).success, false);
  }

  const { retriever, service } = createFixtureService();
  const candidate = await discover(service);
  assert.equal(await service.approveUpdatePackage(candidate.packageId, 'reviewer@example.test', 'Before verification'), false);

  const partial = structuredClone(candidate);
  partial.packageId = 'MAS-PARTIAL-FIXTURE';
  partial.updates[0].extractionStatus = 'PARTIAL';
  partial.packageHash = service.computePackageHash(withoutHash(partial));
  assert.equal((await service.stageUpdatePackage(partial)).success, false, 'Partial extractions cannot enter the MAS verification lifecycle');

  const tampered = structuredClone(candidate);
  assert.equal((await service.stageUpdatePackage(tampered)).success, true);
  assert.equal((await service.verifyUpdatePackage(tampered.packageId, rawDocumentsFor(tampered, retriever))).isValid, true);
  assert.equal(await service.approveUpdatePackage(tampered.packageId, 'reviewer@example.test', 'Approved once'), true);
  assert.equal((await service.stageUpdatePackage(tampered)).success, true, 'Restaging the same content is allowed for explicit re-review');
  assert.equal((await service.activateUpdatePackage(tampered.packageId)).success, false, 'Restaging clears previous review approval');
  assert.equal((await service.verifyUpdatePackage(tampered.packageId, rawDocumentsFor(tampered, retriever))).isValid, true);
  assert.equal(await service.approveUpdatePackage(tampered.packageId, 'reviewer@example.test', 'Approved after restage'), true);
  assert.equal(service.rejectUpdatePackage(tampered.packageId, 'Rejected after review'), true);
  assert.equal(await service.approveUpdatePackage(tampered.packageId, 'reviewer@example.test', 'Approval after rejection'), false);
  assert.equal((await service.activateUpdatePackage(tampered.packageId)).success, false);
}

async function testTamperedRequestsDatesLocatorsAndAmbiguity() {
  for (const tamper of ['topic', 'date', 'locator', 'authority', 'ambiguous']) {
    const { retriever, service } = createFixtureService();
    const candidate = await discover(service);
    const modified = structuredClone(candidate);
    modified.packageId = `MAS-TAMPER-${tamper.toUpperCase()}`;
    if (tamper === 'topic') modified.extractionRequests[HTML_RECORD_ID].expectedTopic.topicTerms = ['unrelated obligation'];
    if (tamper === 'date') modified.updates.find(record => record.id === HTML_RECORD_ID).validFrom = '2020-01-01';
    if (tamper === 'locator') modified.updates.find(record => record.id === HTML_RECORD_ID).sourceLocator.boundary.startOffset += 1;
    if (tamper === 'authority') {
      const record = modified.updates.find(item => item.id === HTML_RECORD_ID);
      record.sourceAuthority = 'IRAS';
      record.sourcePublisher = 'Inland Revenue Authority of Singapore';
    }
    if (tamper === 'ambiguous') modified.updates.find(record => record.id === PDF_RECORD_ID).sourceLocator.tableStructure = 'AMBIGUOUS';
    modified.packageHash = service.computePackageHash(withoutHash(modified));
    const staged = await service.stageUpdatePackage(modified);
    if (tamper === 'authority' || tamper === 'ambiguous') {
      assert.equal(staged.success, false, `${tamper} candidate must be rejected at staging`);
      continue;
    }
    assert.equal(staged.success, true);
    const verified = await service.verifyUpdatePackage(modified.packageId, rawDocumentsFor(modified, retriever));
    assert.equal(verified.isValid, false, `${tamper} data must not survive exact re-extraction`);
  }
}

async function testCollisionAndLegacyIrasCompatibility() {
  const existingIras = Object.values(UNIFIED_SOURCE_REGISTRY).find(record => record.authority === 'IRAS');
  assert.ok(existingIras);
  const { service } = createFixtureService();
  const candidate = await discover(service);
  const colliding = structuredClone(candidate);
  colliding.packageId = 'MAS-COLLISION-FIXTURE';
  colliding.updates[0].id = existingIras.id;
  const oldId = HTML_RECORD_ID;
  colliding.extractionRequests[existingIras.id] = colliding.extractionRequests[oldId];
  colliding.documentMetadata[existingIras.id] = colliding.documentMetadata[oldId];
  delete colliding.extractionRequests[oldId];
  delete colliding.documentMetadata[oldId];
  colliding.amendments[0].recordId = existingIras.id;
  colliding.packageHash = service.computePackageHash(withoutHash(colliding));
  assert.equal((await service.stageUpdatePackage(colliding)).success, false, 'MAS cannot overwrite a stable ID owned by IRAS');

  const defaultService = new LiveRegulatoryFeedService(new SourceVersioningManager());
  assert.ok(!defaultService.getAdapters().some(adapter => adapter.authority === 'MAS'), 'MAS checks are not enabled by default');
  assert.ok(!getDueAuthorities({}, Date.UTC(2026, 9, 15)).includes('MAS'), 'The background scheduler does not enable MAS checks');

  const irasService = new LiveRegulatoryFeedService(new SourceVersioningManager(), undefined, new FixtureRetriever(), []);
  const html = '<section id="cit-rate-guidance"><h2>Corporate income tax rate</h2><p>IRAS corporate income tax rate guidance describes the applicable rate for companies.</p></section>';
  const startOffset = 0;
  const endOffset = html.length;
  const sourceText = cleanHtmlText(html);
  const legacyRecord = {
    id: 'IRAS_LIFECYCLE_COMPATIBILITY_FIXTURE',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore',
    sourcePublisher: 'Inland Revenue Authority of Singapore',
    legalOrStandardInstrument: 'IRAS Corporate Income Tax Guidance',
    documentTitle: 'Corporate income tax rate',
    standardOrActCode: 'IRAS-CIT-RATE',
    paragraphOrSection: 'Corporate income tax rate',
    sourceText,
    principleSummary: 'Legacy text candidate',
    officialSourceUrl: 'https://www.iras.gov.sg/taxes/corporate-income-tax/rate',
    domain: 'IRAS_TAX',
    jurisdiction: 'Singapore',
    tags: ['corporate income tax rate'],
    sourceStatus: 'NEEDS_REVIEW',
    sourceType: 'OFFICIAL_GUIDANCE',
    evidenceTier: 'OFFICIAL_GUIDANCE',
    isVerbatimText: true,
    extractionStatus: 'EXACT',
    sourceLocator: { elementId: 'cit-rate-guidance', sourceNode: 'section#cit-rate-guidance', startOffset, endOffset, boundary: { startOffset, endOffset }, sourceType: 'HTML' },
    provenance: 'LIVE_EXTERNAL',
    sourceAuthority: 'IRAS'
  };
  const irasPackage = {
    packageId: 'IRAS-LIFECYCLE-COMPATIBILITY',
    releaseDate: '2026-10-15',
    authority: 'IRAS',
    updates: [legacyRecord],
    amendments: [],
    packageHash: ''
  };
  irasPackage.packageHash = irasService.computePackageHash(withoutHash(irasPackage));
  assert.equal((await irasService.stageUpdatePackage(irasPackage)).success, true);
  assert.equal((await irasService.verifyUpdatePackage(irasPackage.packageId, { [legacyRecord.id]: html })).isValid, true);
  assert.equal(await irasService.approveUpdatePackage(irasPackage.packageId, 'reviewer@example.test', 'Not an MAS package'), false);
  assert.equal((await irasService.activateUpdatePackage(irasPackage.packageId)).success, true, 'Legacy IRAS packages retain the existing verify-to-activate path');
}

async function stageMasPackage(service, packageId = undefined) {
  const pkg = await discover(service);
  if (packageId) pkg.packageId = packageId;
  pkg.packageHash = service.computePackageHash(withoutHash(pkg));
  assert.equal((await service.stageUpdatePackage(pkg)).success, true);
  return pkg;
}

async function testMasCandidateMutationAndActiveRestageGuards() {
  const mutations = [
    candidate => { candidate.record.sourceText = 'mutated after approval'; },
    candidate => { candidate.record.validFrom = '2020-01-01'; },
    candidate => { candidate.record.sourceLocator.boundary.startOffset += 1; },
    candidate => { candidate.metadata.sourceUrl = 'https://attacker.invalid/changed'; },
    candidate => { candidate.metadata.provisionHash = '0'.repeat(64); },
    candidate => { candidate.metadata.contentHash = '1'.repeat(64); }
  ];

  for (const mutate of mutations) {
    const { retriever, versioning, service } = createFixtureService();
    const pkg = await stageMasPackage(service);
    assert.equal((await service.verifyUpdatePackage(pkg.packageId, rawDocumentsFor(pkg, retriever))).isValid, true);
    assert.equal(await service.approveUpdatePackage(pkg.packageId, 'reviewer@example.test', 'Approved before candidate tampering'), true);
    const candidate = versioning.getCandidates().find(item => item.record.id === HTML_RECORD_ID);
    assert.ok(candidate);
    mutate(candidate);
    assert.equal((await service.activateUpdatePackage(pkg.packageId)).success, false, 'Mutated candidate data or version metadata cannot activate');
    assert.equal(UNIFIED_SOURCE_REGISTRY[HTML_RECORD_ID], undefined);
    assert.equal(versioning.getAllLedgerEntries().length, 0);
  }

  const { retriever, service } = createFixtureService();
  const activePackage = await stageMasPackage(service, 'MAS-ACTIVE-RESTAGE-GUARD');
  assert.equal((await service.verifyUpdatePackage(activePackage.packageId, rawDocumentsFor(activePackage, retriever))).isValid, true);
  assert.equal(await service.approveUpdatePackage(activePackage.packageId, 'reviewer@example.test', 'Approve active package'), true);
  assert.equal((await service.activateUpdatePackage(activePackage.packageId)).success, true);
  assert.equal((await service.stageUpdatePackage(activePackage)).success, false, 'Active MAS package IDs cannot be restaged');
  assert.equal((await service.rollbackUpdatePackage(activePackage.packageId)).success, true, 'Rejected restaging preserves the active package rollback handle');
  assert.equal(UNIFIED_SOURCE_REGISTRY[HTML_RECORD_ID], undefined);
  assert.equal(UNIFIED_SOURCE_REGISTRY[PDF_RECORD_ID], undefined);
}

async function testMasAsyncVerificationInvalidation() {
  {
    const { retriever, service } = createFixtureService();
    const pkg = await stageMasPackage(service, 'MAS-CONCURRENT-VERIFY');
    const raw = rawDocumentsFor(pkg, retriever);
    const older = service.verifyUpdatePackage(pkg.packageId, raw);
    const newer = service.verifyUpdatePackage(pkg.packageId, raw);
    const [olderResult, newerResult] = await Promise.all([older, newer]);
    assert.equal(olderResult.isValid, false);
    assert.match(olderResult.rejectionReason, /Stale verification/);
    assert.equal(newerResult.isValid, true, 'The most recent concurrent verification owns promotion');
  }

  {
    const { retriever, service } = createFixtureService();
    const original = await stageMasPackage(service, 'MAS-RESTAGED-DURING-VERIFY');
    const originalRaw = rawDocumentsFor(original, retriever);
    retriever.set(HTML_URL, htmlFixture(2026), 'text/html; charset=utf-8');
    const revised = await discover(service);
    revised.packageId = original.packageId;
    revised.packageHash = service.computePackageHash(withoutHash(revised));
    const older = service.verifyUpdatePackage(original.packageId, originalRaw);
    assert.equal((await service.stageUpdatePackage(revised)).success, true);
    const stale = await older;
    assert.equal(stale.isValid, false);
    assert.match(stale.rejectionReason, /Stale verification/);
    assert.equal(service.getStagedPackages()[0].packageHash, revised.packageHash, 'A stale verifier cannot replace the new staged package');
    assert.equal((await service.verifyUpdatePackage(revised.packageId, rawDocumentsFor(revised, retriever))).isValid, true);
  }

  {
    const { retriever, service } = createFixtureService();
    const pkg = await stageMasPackage(service, 'MAS-REJECTED-DURING-VERIFY');
    const older = service.verifyUpdatePackage(pkg.packageId, rawDocumentsFor(pkg, retriever));
    assert.equal(service.rejectUpdatePackage(pkg.packageId, 'Rejected while verification was pending'), true);
    const stale = await older;
    assert.equal(stale.isValid, false);
    assert.match(stale.rejectionReason, /Stale verification/);
    assert.equal(service.getRejectedPackages()[pkg.packageId], 'Rejected while verification was pending');
    assert.equal(service.getReviewAuditEvents(pkg.packageId).filter(event => event.action === 'REJECTED').length, 1);
  }

  {
    const { retriever, service } = createFixtureService();
    const pkg = await stageMasPackage(service, 'MAS-RETRIEVAL-REJECTED');
    const record = pkg.updates[0];
    const fixture = retriever.documents.get(pkg.extractionRequests[record.id].url);
    let resolveFetch;
    retriever.fetchOfficialDocument = () => new Promise(resolve => { resolveFetch = resolve; });
    const pending = service.retrieveAndVerifyStagedPackage(pkg.packageId);
    assert.equal(typeof resolveFetch, 'function');
    assert.equal(service.rejectUpdatePackage(pkg.packageId, 'Rejected during network retrieval'), true);
    resolveFetch({
      status: 'SUCCESS', httpStatus: 200, sourceUrl: pkg.extractionRequests[record.id].url,
      finalUrl: pkg.extractionRequests[record.id].url, contentType: fixture.contentType,
      contentBytes: new Uint8Array(fixture.contentBytes), retrievedAt: '2026-10-15T00:00:00.000Z'
    });
    const stale = await pending;
    assert.equal(stale.isValid, false);
    assert.match(stale.rejectionReason, /Stale verification/);
    assert.equal(service.getRejectedPackages()[pkg.packageId], 'Rejected during network retrieval');
  }
}

async function testMasClassificationCannotBeRelabeled() {
  const scenarios = [
    record => { record.authority = 'MAS'; },
    record => { record.sourceAuthority = 'MAS'; },
    record => { record.officialSourceUrl = HTML_URL; }
  ];
  for (const [index, mutate] of scenarios.entries()) {
    const { service } = createFixtureService();
    const candidate = await discover(service);
    const relabeled = structuredClone(candidate);
    relabeled.packageId = `IRAS-MAS-RELABEL-${index}`;
    relabeled.authority = 'IRAS';
    for (const record of relabeled.updates) {
      record.authority = 'IRAS';
      record.sourceAuthority = 'AGC';
      record.officialSourceUrl = 'https://www.acra.gov.sg/test';
    }
    mutate(relabeled.updates[0]);
    relabeled.packageHash = service.computePackageHash(withoutHash(relabeled));
    assert.equal((await service.stageUpdatePackage(relabeled)).success, false, 'A non-MAS package cannot carry MAS authority or publisher identity');
  }

  const { versioning, service } = createFixtureService();
  const base = await discover(service);
  const legacy = structuredClone(base);
  legacy.packageId = 'IRAS-MAS-VERIFY-ENTRY-GUARD';
  legacy.authority = 'IRAS';
  legacy.updates = [structuredClone(legacy.updates[0])];
  Object.assign(legacy.updates[0], {
    id: 'IRAS-MAS-VERIFY-ENTRY-RECORD', authority: 'IRAS', sourceAuthority: 'IRAS',
    sourcePublisher: 'Inland Revenue Authority of Singapore', domain: 'IRAS_TAX',
    officialSourceUrl: 'https://www.iras.gov.sg/test', canonicalSourceUrl: 'https://www.iras.gov.sg/test'
  });
  legacy.extractionRequests = undefined;
  legacy.documentMetadata = undefined;
  legacy.packageHash = service.computePackageHash(withoutHash(legacy));
  assert.equal((await service.stageUpdatePackage(legacy)).success, true);
  const tamperedVerification = structuredClone(legacy);
  tamperedVerification.updates[0].sourceAuthority = 'MAS';
  service.stagedPackages.set(legacy.packageId, tamperedVerification);
  const failedVerification = await service.verifyUpdatePackage(legacy.packageId, { [legacy.updates[0].id]: 'raw text' });
  assert.equal(failedVerification.isValid, false, 'Verification rechecks authority classification at its entry point');
  assert.match(failedVerification.rejectionReason, /Non-MAS packages cannot contain MAS/);
  const legacyCandidate = service.getStagedPackages()[0];
  assert.ok(legacyCandidate);
  assert.equal(versioning.getCandidates()[0].metadata.verificationStatus, 'UNVERIFIED', 'Legacy candidates retain their pre-verification status on rejection');

  const { service: activationService } = createFixtureService();
  const activationLegacy = structuredClone(legacy);
  activationLegacy.packageId = 'IRAS-MAS-ACTIVATE-ENTRY-GUARD';
  activationLegacy.updates[0].id = 'IRAS-MAS-ACTIVATE-ENTRY-RECORD';
  activationLegacy.packageHash = activationService.computePackageHash(withoutHash(activationLegacy));
  assert.equal((await activationService.stageUpdatePackage(activationLegacy)).success, true);
  const tamperedActivation = structuredClone(activationLegacy);
  tamperedActivation.updates[0].officialSourceUrl = HTML_URL;
  activationService.verifiedPackages.set(activationLegacy.packageId, tamperedActivation);
  assert.equal((await activationService.activateUpdatePackage(activationLegacy.packageId)).success, false, 'Activation rechecks authority classification at its entry point');
}

async function main() {
  await testMasLifecycleAndRollback();
  await testFailClosedVerificationAndApproval();
  await testTamperedRequestsDatesLocatorsAndAmbiguity();
  await testCollisionAndLegacyIrasCompatibility();
  await testMasCandidateMutationAndActiveRestageGuards();
  await testMasAsyncVerificationInvalidation();
  await testMasClassificationCannotBeRelabeled();
  for (const id of [HTML_RECORD_ID, PDF_RECORD_ID, 'IRAS_LIFECYCLE_COMPATIBILITY_FIXTURE']) delete UNIFIED_SOURCE_REGISTRY[id];
  console.log('PASS | MAS document lifecycle: byte-backed HTML/PDF verification, review approval, history, rollback, and IRAS isolation');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
