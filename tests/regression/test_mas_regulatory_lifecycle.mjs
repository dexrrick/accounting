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

function createLegacyIrasPackage(service, recordId, packageId, year = 2025) {
  const html = `<section id="cit-rate-guidance"><h2>Corporate income tax rate</h2><p>IRAS corporate income tax rate guidance describes the applicable rate for companies in ${year}.</p></section>`;
  const sourceText = cleanHtmlText(html);
  const record = {
    id: recordId,
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore',
    sourcePublisher: 'Inland Revenue Authority of Singapore',
    sourceAuthority: 'IRAS',
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
    sourceLocator: {
      elementId: 'cit-rate-guidance',
      sourceNode: 'section#cit-rate-guidance',
      startOffset: 0,
      endOffset: html.length,
      boundary: { startOffset: 0, endOffset: html.length },
      sourceType: 'HTML'
    },
    provenance: 'LIVE_EXTERNAL'
  };
  const pkg = {
    packageId,
    releaseDate: '2026-10-15',
    authority: 'IRAS',
    updates: [record],
    amendments: [],
    packageHash: ''
  };
  pkg.packageHash = service.computePackageHash(withoutHash(pkg));
  return { pkg, html };
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
    assert.equal(active.groundingEligible, true, 'Only explicitly approved and activated documents become eligible for shared admission');
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

async function activateMasFixture(service, retriever, packageId) {
  const pkg = await stageMasPackage(service, packageId);
  assert.equal((await service.verifyUpdatePackage(pkg.packageId, rawDocumentsFor(pkg, retriever))).isValid, true);
  assert.equal(await service.approveUpdatePackage(pkg.packageId, 'reviewer@example.test', 'Reviewed MAS identity fixture'), true);
  assert.equal((await service.activateUpdatePackage(pkg.packageId)).success, true);
  return pkg;
}

async function testLegacyFeedCannotReuseMasManagedIds() {
  delete UNIFIED_SOURCE_REGISTRY[HTML_RECORD_ID];
  delete UNIFIED_SOURCE_REGISTRY[PDF_RECORD_ID];
  {
    const { retriever, versioning, service } = createFixtureService();
    const masPackage = await activateMasFixture(service, retriever, 'MAS-LEGACY-COLLISION-ACTIVE');
    const activeRecord = structuredClone(UNIFIED_SOURCE_REGISTRY[HTML_RECORD_ID]);
    const activeVersionId = versioning.getActiveVersionId(HTML_RECORD_ID);
    const approval = versioning.getLedgerEntry(activeVersionId).metadata.reviewApproval;
    const candidateCount = versioning.getCandidates().length;
    const legacy = createLegacyIrasPackage(service, HTML_RECORD_ID, 'IRAS-REUSE-ACTIVE-MAS-ID');
    const collision = await service.stageUpdatePackage(legacy.pkg);
    assert.equal(collision.success, false, 'A legacy package cannot stage over an active MAS-managed registry ID');
    assert.match(collision.error, /MAS-managed record ID/);
    assert.equal(versioning.getCandidates().length, candidateCount, 'Rejected collision staging makes no candidate mutations');
    assert.deepEqual(UNIFIED_SOURCE_REGISTRY[HTML_RECORD_ID], activeRecord);
    assert.equal(versioning.getActiveVersionId(HTML_RECORD_ID), activeVersionId);
    assert.deepEqual(versioning.getLedgerEntry(activeVersionId).metadata.reviewApproval, approval,
      'The active MAS review binding survives a blocked legacy collision');
    assert.ok(service.getActivePackages().some(pkg => pkg.packageId === masPackage.packageId));

    const flagged = createLegacyIrasPackage(service, 'IRAS_DOCUMENT_ADMISSION_FLAG_FIXTURE', 'IRAS-CARRIES-DOC-ADMISSION-FLAG');
    flagged.pkg.updates[0].documentAdmissionRequired = true;
    const flaggedResult = await service.stageUpdatePackage(flagged.pkg);
    assert.equal(flaggedResult.success, false, 'A non-MAS package cannot introduce a document-admission record');
    assert.match(flaggedResult.error, /document-admission record/);
    assert.equal(versioning.getCandidates().length, candidateCount);
    delete UNIFIED_SOURCE_REGISTRY[HTML_RECORD_ID];
    delete UNIFIED_SOURCE_REGISTRY[PDF_RECORD_ID];
  }

  {
    const { versioning, service } = createFixtureService();
    const pending = await stageMasPackage(service, 'MAS-LEGACY-COLLISION-PENDING');
    const candidatesBefore = versioning.getCandidates().length;
    const legacy = createLegacyIrasPackage(service, HTML_RECORD_ID, 'IRAS-REUSE-PENDING-MAS-ID');
    const collision = await service.stageUpdatePackage(legacy.pkg);
    assert.equal(collision.success, false, 'A pending MAS candidate reserves its managed record ID');
    assert.match(collision.error, /MAS-managed candidate record ID/);
    assert.equal(versioning.getCandidates().length, candidatesBefore);
    assert.equal(service.getStagedPackages().some(pkg => pkg.packageId === pending.packageId), true);
  }

  {
    const { retriever, versioning, service } = createFixtureService();
    const masPackage = await activateMasFixture(service, retriever, 'MAS-LEGACY-COLLISION-HISTORICAL');
    const activeVersionId = versioning.getActiveVersionId(HTML_RECORD_ID);
    assert.equal((await service.rollbackUpdatePackage(masPackage.packageId)).success, true);
    assert.equal(UNIFIED_SOURCE_REGISTRY[HTML_RECORD_ID], undefined);
    assert.equal(versioning.getActiveVersionId(HTML_RECORD_ID), undefined);
    const legacy = createLegacyIrasPackage(service, HTML_RECORD_ID, 'IRAS-REUSE-HISTORICAL-MAS-ID');
    const collision = await service.stageUpdatePackage(legacy.pkg);
    assert.equal(collision.success, false, 'Rolled-back MAS ledger history continues to reserve its managed ID');
    assert.match(collision.error, /MAS-managed ledger record ID/);
    assert.ok(versioning.getLedgerEntry(activeVersionId), 'The append-only MAS ledger entry remains available to guard the ID');
  }

  {
    const { retriever, versioning, service } = createFixtureService();
    const legacy = createLegacyIrasPackage(service, HTML_RECORD_ID, 'IRAS-VERIFY-AFTER-MAS-IDENTITY');
    assert.equal((await service.stageUpdatePackage(legacy.pkg)).success, true,
      'Legacy packages may stage before the record ID becomes MAS-managed');
    const legacyCandidate = versioning.getCandidates().find(candidate => candidate.record.id === HTML_RECORD_ID);
    assert.ok(legacyCandidate);
    const masPackage = await activateMasFixture(service, retriever, 'MAS-ACTIVATE-AFTER-LEGACY-STAGE');
    const activeRecord = structuredClone(UNIFIED_SOURCE_REGISTRY[HTML_RECORD_ID]);
    const activeVersionId = versioning.getActiveVersionId(HTML_RECORD_ID);
    const approval = versioning.getLedgerEntry(activeVersionId).metadata.reviewApproval;

    const direct = await service.verifyUpdatePackage(legacy.pkg.packageId, { [HTML_RECORD_ID]: legacy.html });
    assert.equal(direct.isValid, false, 'Raw verification rechecks current managed-ID ownership');
    assert.match(direct.rejectionReason, /MAS-managed record ID/);
    assert.equal(legacyCandidate.metadata.verificationStatus, 'UNVERIFIED', 'Blocked raw verification leaves the legacy candidate untouched');
    assert.equal(service.getStagedPackages().some(pkg => pkg.packageId === legacy.pkg.packageId), true);
    assert.equal(service.getVerifiedPackages().some(pkg => pkg.packageId === legacy.pkg.packageId), false);

    let fetchCount = 0;
    retriever.fetchOfficialSource = async () => {
      fetchCount++;
      throw new Error('The official source must not be fetched for a managed-ID collision');
    };
    const fetched = await service.retrieveAndVerifyStagedPackage(legacy.pkg.packageId);
    assert.equal(fetched.isValid, false);
    assert.match(fetched.rejectionReason, /MAS-managed record ID/);
    assert.equal(fetchCount, 0, 'Official-source verification rejects before network retrieval');
    assert.deepEqual(UNIFIED_SOURCE_REGISTRY[HTML_RECORD_ID], activeRecord);
    assert.equal(versioning.getActiveVersionId(HTML_RECORD_ID), activeVersionId);
    assert.deepEqual(versioning.getLedgerEntry(activeVersionId).metadata.reviewApproval, approval);
    assert.ok(service.getActivePackages().some(pkg => pkg.packageId === masPackage.packageId));
    delete UNIFIED_SOURCE_REGISTRY[HTML_RECORD_ID];
    delete UNIFIED_SOURCE_REGISTRY[PDF_RECORD_ID];
  }

  {
    const { retriever, versioning, service } = createFixtureService();
    const legacy = createLegacyIrasPackage(service, HTML_RECORD_ID, 'IRAS-ACTIVATE-AFTER-MAS-IDENTITY');
    assert.equal((await service.stageUpdatePackage(legacy.pkg)).success, true);
    assert.equal((await service.verifyUpdatePackage(legacy.pkg.packageId, { [HTML_RECORD_ID]: legacy.html })).isValid, true);
    const legacyCandidate = versioning.getCandidates().find(candidate => candidate.record.id === HTML_RECORD_ID);
    assert.equal(legacyCandidate.metadata.verificationStatus, 'VERIFIED');

    const masPackage = await activateMasFixture(service, retriever, 'MAS-ACTIVATE-AFTER-LEGACY-VERIFIED');
    const activeRecord = structuredClone(UNIFIED_SOURCE_REGISTRY[HTML_RECORD_ID]);
    const activeVersionId = versioning.getActiveVersionId(HTML_RECORD_ID);
    const approval = versioning.getLedgerEntry(activeVersionId).metadata.reviewApproval;
    const attempted = await service.activateUpdatePackage(legacy.pkg.packageId);
    assert.equal(attempted.success, false, 'Activation rechecks the managed-ID guard after legacy verification');
    assert.match(attempted.error, /MAS-managed record ID/);
    assert.equal(legacyCandidate.metadata.verificationStatus, 'VERIFIED', 'Blocked activation leaves the verified legacy candidate unchanged');
    assert.deepEqual(UNIFIED_SOURCE_REGISTRY[HTML_RECORD_ID], activeRecord);
    assert.equal(versioning.getActiveVersionId(HTML_RECORD_ID), activeVersionId);
    assert.deepEqual(versioning.getLedgerEntry(activeVersionId).metadata.reviewApproval, approval,
      'Blocked activation does not disturb the MAS document approval binding');
    assert.ok(service.getActivePackages().some(pkg => pkg.packageId === masPackage.packageId));
    delete UNIFIED_SOURCE_REGISTRY[HTML_RECORD_ID];
    delete UNIFIED_SOURCE_REGISTRY[PDF_RECORD_ID];
  }
}

async function testVersionIdAliasCollisionsAndReservationGuards() {
  const recordService = createFixtureService().service;
  const versioning = new SourceVersioningManager();
  const directCandidate = (recordId, versionId, verificationStatus) => {
    const record = createLegacyIrasPackage(recordService, recordId, 'IRAS-VERSION-ID-' + recordId).pkg.updates[0];
    return {
      record,
      metadata: {
        versionId,
        contentHash: versioning.computeSourceHash(record),
        canonicalSourceUrl: record.officialSourceUrl,
        sourceAuthority: 'IRAS',
        verificationStatus,
        retrievedAt: '2026-10-16T00:00:00.000Z'
      }
    };
  };

  const pending = directCandidate('DIRECT_PENDING_RECORD', 'GLOBAL_VERSION_ID_PENDING', 'UNVERIFIED');
  versioning.registerCandidateVersion(pending.record, pending.metadata);
  const pendingSnapshot = structuredClone(versioning.getCandidates().find(item => item.metadata.versionId === pending.metadata.versionId));
  const duplicatePending = directCandidate('DIRECT_PENDING_DUPLICATE', pending.metadata.versionId, 'UNVERIFIED');
  assert.throws(() => versioning.registerCandidateVersion(duplicatePending.record, duplicatePending.metadata), /already reserved/,
    'Candidate IDs cannot replace an existing pending version');
  assert.deepEqual(versioning.getCandidates().find(item => item.metadata.versionId === pending.metadata.versionId), pendingSnapshot);
  assert.equal(versioning.getCandidates().length, 1);
  assert.equal(versioning.getAllLedgerEntries().length, 0);

  const active = directCandidate('DIRECT_ACTIVE_RECORD', 'GLOBAL_VERSION_ID_ACTIVE', 'VERIFIED');
  versioning.registerCandidateVersion(active.record, active.metadata);
  assert.equal(versioning.activateVersion(active.metadata.versionId).success, true);
  const activeEntry = versioning.getLedgerEntry(active.metadata.versionId);
  const activePointer = versioning.getActiveVersionId(active.record.id);
  const duplicateActive = directCandidate('DIRECT_ACTIVE_DUPLICATE', active.metadata.versionId, 'UNVERIFIED');
  assert.throws(() => versioning.registerCandidateVersion(duplicateActive.record, duplicateActive.metadata), /already reserved/,
    'Ledger IDs cannot be reused by a new candidate');
  assert.deepEqual(versioning.getLedgerEntry(active.metadata.versionId), activeEntry);
  assert.equal(versioning.getActiveVersionId(active.record.id), activePointer);

  const injectedCandidate = {
    record: { ...duplicateActive.record, versionId: active.metadata.versionId, lifecycleState: 'CANDIDATE' },
    metadata: { ...duplicateActive.metadata, versionId: active.metadata.versionId, verificationStatus: 'VERIFIED' }
  };
  versioning.candidates.set(active.metadata.versionId, injectedCandidate);
  const duplicateActivation = versioning.activateVersion(active.metadata.versionId);
  assert.equal(duplicateActivation.success, false, 'Activation cannot overwrite an existing immutable ledger ID');
  assert.match(duplicateActivation.error, /already exists in the immutable ledger/);
  assert.deepEqual(versioning.getLedgerEntry(active.metadata.versionId), activeEntry);
  assert.equal(versioning.getActiveVersionId(active.record.id), activePointer);
  assert.deepEqual(versioning.getCandidates().find(item => item.metadata.versionId === active.metadata.versionId), injectedCandidate,
    'Rejected duplicate activation leaves the candidate untouched');
  versioning.candidates.delete(active.metadata.versionId);

  assert.equal(versioning.rollbackVersion(active.metadata.versionId).success, true);
  const rolledBackEntry = versioning.getLedgerEntry(active.metadata.versionId);
  assert.equal(rolledBackEntry.isActive, false);
  assert.equal(versioning.getActiveVersionId(active.record.id), undefined);
  const duplicateRolledBack = directCandidate('DIRECT_ROLLED_BACK_DUPLICATE', active.metadata.versionId, 'UNVERIFIED');
  assert.throws(() => versioning.registerCandidateVersion(duplicateRolledBack.record, duplicateRolledBack.metadata), /already reserved/,
    'Rollback does not release an append-only ledger ID');
  assert.deepEqual(versioning.getLedgerEntry(active.metadata.versionId), rolledBackEntry);
  assert.equal(versioning.getActiveVersionId(active.record.id), undefined);

  async function stageLegacyAlias(service, manager, managedVersionId, label) {
    assert.ok(managedVersionId.startsWith('MAS-'));
    const recordId = managedVersionId.slice('MAS-'.length);
    const legacy = createLegacyIrasPackage(service, recordId, 'MAS');
    assert.equal('MAS-' + recordId, managedVersionId, 'The legacy package reproduces the exact MAS version-ID alias');
    assert.equal((await service.stageUpdatePackage(legacy.pkg)).success, true);
    const candidate = manager.getCandidates().find(item => item.record.id === recordId);
    assert.ok(candidate);
    assert.notEqual(candidate.metadata.versionId, managedVersionId, label + ' legacy candidate receives a collision-free version ID');
    assert.match(candidate.metadata.versionId, /-activation-\d+$/);
    return { ...legacy, candidate, recordId };
  }

  delete UNIFIED_SOURCE_REGISTRY[HTML_RECORD_ID];
  delete UNIFIED_SOURCE_REGISTRY[PDF_RECORD_ID];
  {
    const { service, versioning: manager } = createFixtureService();
    await stageMasPackage(service, 'MAS-VERSION-ALIAS-PENDING');
    const managedCandidate = manager.getCandidates().find(item => item.record.id === HTML_RECORD_ID);
    const managedVersionId = managedCandidate.metadata.versionId;
    const before = structuredClone(managedCandidate);
    await stageLegacyAlias(service, manager, managedVersionId, 'Pending alias');
    assert.deepEqual(manager.getCandidates().find(item => item.metadata.versionId === managedVersionId), before,
      'A pending MAS candidate remains unchanged when its string-split ID is staged as legacy');
  }

  delete UNIFIED_SOURCE_REGISTRY[HTML_RECORD_ID];
  delete UNIFIED_SOURCE_REGISTRY[PDF_RECORD_ID];
  {
    const { retriever, service, versioning: manager } = createFixtureService();
    await activateMasFixture(service, retriever, 'MAS-VERSION-ALIAS-ACTIVE');
    const managedVersionId = manager.getActiveVersionId(HTML_RECORD_ID);
    const before = manager.getLedgerEntry(managedVersionId);
    const approval = before.metadata.reviewApproval;
    const activeRecord = structuredClone(UNIFIED_SOURCE_REGISTRY[HTML_RECORD_ID]);
    const legacy = await stageLegacyAlias(service, manager, managedVersionId, 'Active alias');
    assert.equal((await service.verifyUpdatePackage(legacy.pkg.packageId, { [legacy.recordId]: legacy.html })).isValid, true);
    assert.equal((await service.activateUpdatePackage(legacy.pkg.packageId)).success, true,
      'The unrelated legacy source remains activatable after collision-free allocation');
    assert.deepEqual(manager.getLedgerEntry(managedVersionId), before);
    assert.equal(manager.getActiveVersionId(HTML_RECORD_ID), managedVersionId);
    assert.deepEqual(manager.getLedgerEntry(managedVersionId).metadata.reviewApproval, approval);
    assert.deepEqual(UNIFIED_SOURCE_REGISTRY[HTML_RECORD_ID], activeRecord);
    delete UNIFIED_SOURCE_REGISTRY[legacy.recordId];
  }

  delete UNIFIED_SOURCE_REGISTRY[HTML_RECORD_ID];
  delete UNIFIED_SOURCE_REGISTRY[PDF_RECORD_ID];
  {
    const { retriever, service, versioning: manager } = createFixtureService();
    const masPackage = await activateMasFixture(service, retriever, 'MAS-VERSION-ALIAS-ROLLED-BACK');
    const managedVersionId = manager.getActiveVersionId(HTML_RECORD_ID);
    assert.equal((await service.rollbackUpdatePackage(masPackage.packageId)).success, true);
    const rolledBackEntry = manager.getLedgerEntry(managedVersionId);
    assert.equal(manager.getActiveVersionId(HTML_RECORD_ID), undefined);
    const legacy = await stageLegacyAlias(service, manager, managedVersionId, 'Rolled-back alias');
    assert.equal((await service.verifyUpdatePackage(legacy.pkg.packageId, { [legacy.recordId]: legacy.html })).isValid, true);
    assert.equal((await service.activateUpdatePackage(legacy.pkg.packageId)).success, true);
    assert.deepEqual(manager.getLedgerEntry(managedVersionId), rolledBackEntry,
      'Reusing the old package/record string cannot overwrite rolled-back MAS ledger history');
    assert.equal(manager.getActiveVersionId(HTML_RECORD_ID), undefined);
    assert.ok(manager.getActiveVersionId(legacy.recordId));
    delete UNIFIED_SOURCE_REGISTRY[legacy.recordId];
  }
  delete UNIFIED_SOURCE_REGISTRY[HTML_RECORD_ID];
  delete UNIFIED_SOURCE_REGISTRY[PDF_RECORD_ID];
}
async function testLegacyPackageRollbackRestoresExactRegistrySnapshot() {
  const versioning = new SourceVersioningManager();
  const service = new LiveRegulatoryFeedService(versioning, undefined, new FixtureRetriever(), []);
  const firstId = 'IRAS_FIRST_ACTIVATION_ROLLBACK_FIXTURE';
  const stackedId = 'IRAS_STACKED_ROLLBACK_FIXTURE';

  const first = createLegacyIrasPackage(service, firstId, 'IRAS-FIRST-ACTIVATION-ROLLBACK');
  assert.equal((await service.stageUpdatePackage(first.pkg)).success, true);
  assert.equal((await service.verifyUpdatePackage(first.pkg.packageId, { [firstId]: first.html })).isValid, true);
  assert.equal((await service.activateUpdatePackage(first.pkg.packageId)).success, true);
  const firstVersionId = versioning.getActiveVersionId(firstId);
  assert.ok(UNIFIED_SOURCE_REGISTRY[firstId]);
  assert.equal((await service.rollbackUpdatePackage(first.pkg.packageId)).success, true);
  assert.equal(UNIFIED_SOURCE_REGISTRY[firstId], undefined, 'Rollback of a first legacy activation removes its newly created registry row');
  assert.equal(versioning.getActiveVersionId(firstId), undefined, 'Rollback of a first legacy activation clears its active pointer');
  assert.equal(versioning.getLedgerEntry(firstVersionId).isActive, false, 'Rollback preserves the append-only ledger entry as inactive history');

  const baseline = createLegacyIrasPackage(service, stackedId, 'IRAS-STACKED-BASELINE').pkg.updates[0];
  baseline.provenance = 'LOCAL_STATIC';
  baseline.sourceStatus = 'VERIFIED';
  baseline.lifecycleState = 'ACTIVE';
  baseline.version = 'baseline-fixture';
  UNIFIED_SOURCE_REGISTRY[stackedId] = structuredClone(baseline);
  const originalBaseline = structuredClone(UNIFIED_SOURCE_REGISTRY[stackedId]);

  const predecessor = createLegacyIrasPackage(service, stackedId, 'IRAS-STACKED-PREDECESSOR', 2025);
  assert.equal((await service.stageUpdatePackage(predecessor.pkg)).success, true,
    'Legacy IRAS activation over an un-managed registered baseline remains supported');
  assert.equal((await service.verifyUpdatePackage(predecessor.pkg.packageId, { [stackedId]: predecessor.html })).isValid, true);
  assert.equal((await service.activateUpdatePackage(predecessor.pkg.packageId)).success, true);
  const predecessorVersionId = versioning.getActiveVersionId(stackedId);
  const predecessorRegistryRow = structuredClone(UNIFIED_SOURCE_REGISTRY[stackedId]);

  const newest = createLegacyIrasPackage(service, stackedId, 'IRAS-STACKED-NEWEST', 2026);
  assert.equal((await service.stageUpdatePackage(newest.pkg)).success, true);
  assert.equal((await service.verifyUpdatePackage(newest.pkg.packageId, { [stackedId]: newest.html })).isValid, true);
  assert.equal((await service.activateUpdatePackage(newest.pkg.packageId)).success, true);
  const newestVersionId = versioning.getActiveVersionId(stackedId);
  const newestRegistryRow = structuredClone(UNIFIED_SOURCE_REGISTRY[stackedId]);

  const olderRollback = await service.rollbackUpdatePackage(predecessor.pkg.packageId);
  assert.equal(olderRollback.success, false, 'An older legacy package cannot roll back while the newer version is active');
  assert.equal(olderRollback.rolledBackRecordsCount, 0);
  assert.deepEqual(UNIFIED_SOURCE_REGISTRY[stackedId], newestRegistryRow, 'Rejected older rollback leaves the registry untouched');
  assert.equal(versioning.getActiveVersionId(stackedId), newestVersionId, 'Rejected older rollback leaves the active pointer untouched');
  assert.equal(versioning.getLedgerEntry(newestVersionId).isActive, true);
  assert.equal(versioning.getLedgerEntry(predecessorVersionId).isActive, false);

  assert.equal((await service.rollbackUpdatePackage(newest.pkg.packageId)).success, true);
  assert.deepEqual(UNIFIED_SOURCE_REGISTRY[stackedId], predecessorRegistryRow,
    'Newest legacy rollback restores the exact registry row it replaced');
  assert.equal(versioning.getActiveVersionId(stackedId), predecessorVersionId);
  assert.equal((await service.rollbackUpdatePackage(predecessor.pkg.packageId)).success, true);
  assert.deepEqual(UNIFIED_SOURCE_REGISTRY[stackedId], originalBaseline,
    'Final legacy rollback restores the exact pre-package baseline registry row');
  assert.equal(versioning.getActiveVersionId(stackedId), undefined);
  assert.ok(versioning.getAllLedgerEntries().length >= 3, 'Legacy rollback keeps the append-only activation history');
  assert.equal(versioning.getLedgerEntry(newestVersionId).isActive, false);
  assert.equal(versioning.getLedgerEntry(predecessorVersionId).isActive, false);

  delete UNIFIED_SOURCE_REGISTRY[firstId];
  delete UNIFIED_SOURCE_REGISTRY[stackedId];
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
  await testLegacyFeedCannotReuseMasManagedIds();
  await testLegacyPackageRollbackRestoresExactRegistrySnapshot();
  await testVersionIdAliasCollisionsAndReservationGuards();
  for (const id of [HTML_RECORD_ID, PDF_RECORD_ID, 'IRAS_LIFECYCLE_COMPATIBILITY_FIXTURE', 'IRAS_FIRST_ACTIVATION_ROLLBACK_FIXTURE', 'IRAS_STACKED_ROLLBACK_FIXTURE']) delete UNIFIED_SOURCE_REGISTRY[id];
  console.log('PASS | MAS document lifecycle: byte-backed HTML/PDF verification, review approval, history, rollback, and IRAS isolation');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
