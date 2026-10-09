import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExternalSourceValidator } from '../../src/retrieval/externalSourceValidator.ts';
import { IRAS_SOURCE_MAP_DEFINITIONS, getCoverageTopicById, getCoverageTopicsByIds } from '../../src/standards/coverageRegistry.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { irasResolverCases } from '../fixtures/irasResolverCases.mjs';
import { irasSourceStructureFeatureIdsV6 } from '../evaluation/singapore/iras-source-structure-features-v6.mjs';
import {
  CONSUMED_FILENAME,
  GST_CASE_ID,
  GST_MAP_ID,
  GST_TOPIC_ID,
  OUTPUT_DIRECTORY,
  PLAN_FILENAME,
  REPORT_FILENAME,
  runIrasPublicGstSelectionV3,
  selectGstPublicUnits
} from '../evaluation/singapore/iras-public-gst-selection-v3.mjs';

const V1_REPORT_PATH = new URL(
  '../../docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v1/iras-public-rule-excerpts-report-v1.json',
  import.meta.url
);
const V8_PLAN_PATH = new URL(
  '../../docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v8/iras-mapped-evidence-plan-v8.json',
  import.meta.url
);
const RAW_HTML_SENTINEL = 'GST_V3_RAW_HTML_SENTINEL_8912';
const CAPTURE_INSTANT = new Date().toISOString();
const CAPTURE_DATE = CAPTURE_INSTANT.slice(0, 10);
const FIXED_CAPTURE_NOW = () => CAPTURE_INSTANT;
const frozenCase = irasResolverCases.find(row => row.id === GST_CASE_ID);
assert.ok(frozenCase?.issues.length === 1, 'The frozen GST request remains single-issue.');
const frozenIssue = frozenCase.issues[0];
const definition = IRAS_SOURCE_MAP_DEFINITIONS.find(row => row.id === GST_MAP_ID);
const pointer = UNIFIED_SOURCE_REGISTRY[GST_MAP_ID];
assert.ok(definition && pointer);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function normalizePublicText(value) {
  return String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function savedV1GstReport() {
  return JSON.parse(readFileSync(V1_REPORT_PATH, 'utf8'));
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function response(body, status = 200, headers = { 'content-type': 'text/html; charset=utf-8' }) {
  return new Response(body, { status, headers });
}

function syntheticPageBody() {
  const report = savedV1GstReport();
  const row = report.results.find(item => item.mapId === GST_MAP_ID);
  assert.ok(row?.status === 'VALIDATED' && row.excerpts.some(item => item.blockIndex === 7 && !item.truncated));
  const body = row.excerpts.map(item => `<p>${escapeHtml(item.text)}</p>`).join('');
  const pageTitle = `${pointer.documentTitle} | IRAS`;
  return `<html><head><title>${escapeHtml(pageTitle)}</title><script>${RAW_HTML_SENTINEL}</script></head>` +
    `<body><main><h1>${escapeHtml(pageTitle)}</h1>${body}</main></body></html>`;
}

const publicCaptureBody = syntheticPageBody();
const gstTopic = getCoverageTopicsByIds(definition.topicIds).find(row => row.domainId === definition.domainId);
assert.ok(gstTopic);
const syntheticValidation = new ExternalSourceValidator().validateTopicContent(publicCaptureBody, {
  standardIdentifiers: [pointer.standardOrActCode, pointer.documentTitle].filter(Boolean),
  expectedTitles: [pointer.documentTitle],
  topicTerms: [...new Set([gstTopic.title, ...(gstTopic.aliases || []), ...gstTopic.keywords,
    ...(gstTopic.requiredContentTerms || []), ...(gstTopic.paragraphHints || []), ...(gstTopic.sectionHints || [])])],
  allowIrasTopicTokenEquivalence: true
});
assert.equal(syntheticValidation.isValid, true);
assert.equal(typeof syntheticValidation.substantiveText, 'string');
const tempRoot = path.join(OUTPUT_DIRECTORY, '.gst-v3-api-free-test-');
async function createOutputDirectory() {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  return mkdtemp(tempRoot);
}

async function exists(filePath) {
  try { await stat(filePath); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

async function createPlan(directory, overrides = {}) {
  let planFetchCalls = 0;
  const envelope = await runIrasPublicGstSelectionV3({ mode: 'plan', outputDirectory: directory,
    fetchImpl: async () => { planFetchCalls += 1; throw new Error('PLAN_MUST_NOT_FETCH'); },
    now: FIXED_CAPTURE_NOW, ...overrides });
  assert.equal(planFetchCalls, 0, 'Plan generation must make no fetch calls.');
  return envelope;
}

function syntheticFetch({ directory, redirect = false, body = publicCaptureBody } = {}) {
  let calls = 0;
  let redirectLocation;
  if (redirect) {
    redirectLocation = new URL(definition.canonicalSourceUrl);
    redirectLocation.hostname = redirectLocation.hostname === 'www.iras.gov.sg' ? 'iras.gov.sg' : 'www.iras.gov.sg';
  }
  const fetchImpl = async (url, init = {}) => {
    calls += 1;
    assert.equal(await exists(path.join(directory, CONSUMED_FILENAME)), true,
      'The permanent marker must exist before the synthetic mapped transport is entered.');
    assert.equal(new URL(url).pathname, new URL(definition.canonicalSourceUrl).pathname);
    assert.equal((init.method || 'GET').toUpperCase(), 'GET');
    assert.equal(init.redirect, 'manual');
    if (redirect && calls === 1) return response('', 302, { location: redirectLocation.toString() });
    assert.ok([new URL(definition.canonicalSourceUrl).hostname, redirectLocation?.hostname].filter(Boolean)
      .includes(new URL(url).hostname));
    return response(body);
  };
  return { fetchImpl, calls: () => calls };
}

function assertStructureProjection(projection, stage) {
  assert.equal(projection.schema, 'IRAS_SOURCE_STRUCTURE_FEATURES_V6');
  assert.equal(projection.interpretation, 'PRESENCE_ONLY_NOT_ENTAILMENT');
  assert.equal(projection.stage, stage);
  assert.ok(projection.signalBlocks.length <= 32);
  assert.ok(Object.values(projection.signalCounts).every(Number.isInteger));
}

const originalFetch = globalThis.fetch;
let ambientFetchAttempts = 0;
globalThis.fetch = async () => { ambientFetchAttempts += 1; throw new Error('AMBIENT_FETCH_BLOCKED'); };
const successDirectory = await createOutputDirectory();
try {
  const selection = selectGstPublicUnits('GST-registered suppliers\n\nInput tax incurred when purchasing may be claimed when the documented conditions for claiming are met, for taxable supplies.');
  assert.ok(selection.excerpts.length <= 5);
  assert.ok(selection.excerpts.every(row => !row.truncated && row.text.length <= 3000));
  assert.ok(selection.excerpts.reduce((sum, row) => sum + row.text.length, 0) <= 12000);
  const oversize = selectGstPublicUnits(`Input tax can be claimed when conditions are met ${'x'.repeat(3001)}.`);
  assert.equal(oversize.excerpts.length, 0, 'Oversized complete units are skipped without clipping.');

  const plan = await createPlan(successDirectory);
  assert.deepEqual(plan.preregistration.sourceMaps.map(page => page.mapId), [GST_MAP_ID]);
  assert.equal(plan.preregistration.sourceMaps[0].canonicalUrl, definition.canonicalSourceUrl);
  assert.ok(getCoverageTopicById(GST_TOPIC_ID));
  assert.ok(plan.preregistration.sourceMaps[0].topicIds.includes(GST_TOPIC_ID));
  assert.equal(plan.preregistration.referenceDate, CAPTURE_DATE);
  assert.deepEqual(plan.preregistration.constraints, {
    interpretation: 'PUBLIC_SOURCE_STRUCTURE_AND_PRESENCE_ONLY_NOT_ENTAILMENT',
    canonicalPageCount: 1,
    maxPageCharacters: 200000,
    maxPageBlocks: 10000,
    maxExcerptsPerPage: 5,
    maxCharactersPerExcerpt: 3000,
    maxCharactersPerPage: 12000,
    timeoutMs: 10000,
    allowedRedirectsPerUrl: 1,
    maximumActualGets: 2,
    retries: 0,
    redirectPolicy: 'ONE_SAME_PATH_IRAS_PEER_HOST_REDIRECT',
    transportCache: 'SHARED_V3_MAPPED_ONLY_TRANSPORT_ACROSS_CAPTURE_CONTEXT_AND_RENDERER',
    otherMappedPages: 'CLOSED_SYNTHETIC_503_NO_NETWORK'
  });
  assert.deepEqual(plan.preregistration.structureProjection.featureIds, [...irasSourceStructureFeatureIdsV6]);
  const planText = await readFile(path.join(successDirectory, PLAN_FILENAME), 'utf8');
  assert.equal(planText.includes(frozenCase.query), false, 'The frozen private request is not persisted.');
  assert.equal(planText.includes(frozenIssue.subject), false, 'The issue subject is not persisted.');
  assert.equal(planText.includes(RAW_HTML_SENTINEL), false);
  const historyPaths = plan.preregistration.historicalArtifacts.map(row => row.path);
  const v8HistoryGroups = JSON.parse(readFileSync(V8_PLAN_PATH, 'utf8')).preregistration.historicalFingerprints;
  const v8HistoryRows = Object.values(v8HistoryGroups).flat();
  for (const row of v8HistoryRows) {
    assert.ok(plan.preregistration.historicalArtifacts.some(candidate =>
      candidate.path === row.path && candidate.sha256 === row.sha256),
    `The exact frozen V8 history fingerprint was not carried forward: ${row.path}`);
  }
  for (const historyPath of [
    'docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v1/iras-public-rule-excerpts-plan-v1.json',
    'docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v1/iras-public-rule-excerpts-report-v1.json',
    'docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v1/iras-public-rule-excerpts-live-consumed-v1.json',
    'docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v2/iras-public-rule-excerpts-plan-v2.json',
    'docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v2/iras-public-rule-excerpts-report-v2.json',
    'docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v2/iras-public-rule-excerpts-live-consumed-v2.json',
    'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v8/iras-mapped-evidence-plan-v8.json',
    'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v8/iras-mapped-evidence-diagnostic-v8.json',
    'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v8/iras-mapped-evidence-live-v8-consumed.json',
    'docs/evaluation/multi-authority-workstreams/iras-first-local-2026-10-02-v6/iras-gst-opening-structure-probe-v1.json'
  ]) assert.ok(historyPaths.includes(historyPath), `Prior capture or plan was not pinned: ${historyPath}`);
  assert.ok(plan.preregistration.v8PinnedHistory.length > 0);

  const synthetic = syntheticFetch({ directory: successDirectory });
  const report = await runIrasPublicGstSelectionV3({ mode: 'live-source', outputDirectory: successDirectory,
    fetchImpl: synthetic.fetchImpl, now: FIXED_CAPTURE_NOW });
  assert.equal(synthetic.calls(), report.mappedTransportRequestCount,
    'The synthetic fetch callback count is reported as mapped transport calls, not external requests.');
  assert.equal(synthetic.calls(), 1, 'The unredirected scenario reads only the preregistered GST page once.');
  assert.ok(report.mappedTransportRequestCount <= 2);
  assert.equal(report.maximumActualGets, 2);
  assert.equal(report.modelRequests, 0);
  assert.equal(report.discoveryRequests, 0);
  assert.equal(report.searchRequests, 0);
  assert.equal(report.unexpectedSyntheticCallCount, 0);
  assert.ok((report.closedMappedSynthetic503Counts.IRAS_GST_INVOICING_SOURCE_MAP || 0) > 0,
    'The invoice map is counted and closed by a synthetic 503 without a mapped transport call.');
  assert.equal(report.page.mapId, GST_MAP_ID);
  assert.equal(report.page.exactSavedBlockMatchPresentInFullVisibleText, true);
  assert.equal(report.page.exactThreeSentenceOpeningMatchPresentInFullVisibleText, true);
  assert.ok(report.page.selectedUnits.length <= 5);
  assert.ok(report.page.selectedUnits.some(row => row.exactThreeSentenceOpeningMatchPresent));
  const syntheticSourceNormalized = normalizePublicText(syntheticValidation.substantiveText);
  const recomputedUnits = selectGstPublicUnits(syntheticValidation.substantiveText).excerpts;
  assert.deepEqual(report.page.selectedUnits.map(row => row.cleanPublicUnitText), recomputedUnits.map(row => row.text),
    'Persisted units must reproduce from the complete cleaned public source under the pinned selector.');
  for (const unit of report.page.selectedUnits) {
    assert.equal(typeof unit.cleanPublicUnitText, 'string');
    assert.ok(unit.cleanPublicUnitText.length > 0 && unit.cleanPublicUnitText.length <= 3000);
    assert.equal(unit.characterCount, unit.cleanPublicUnitText.length);
    assert.equal(unit.sourceDocumentSha256, report.page.documentSha256);
    assert.equal(unit.normalizedTextSha256, sha256(normalizePublicText(unit.cleanPublicUnitText)));
    assert.ok(syntheticSourceNormalized.includes(normalizePublicText(unit.cleanPublicUnitText)),
      'Every persisted cleaned public unit must remain a member of the bounded synthetic source page.');
  }
  assertStructureProjection(report.page.sourceStructureFeatures, 'DIRECT_PROBE_SOURCE_TEXT');
  for (const unit of report.page.selectedUnits) assertStructureProjection(unit.sourceStructureFeatures, 'DIRECT_PROBE_SOURCE_TEXT');
  assert.ok(report.pipeline.contextEligibleRecordCount > 0);
  assert.ok(report.pipeline.eligibleRetainedSourcePresence.length > 0,
    'The API-free fixture must exercise at least one locally eligible retained source.');
  for (const row of report.pipeline.eligibleRetainedSourcePresence) {
    assert.equal(typeof row.exactSavedBlockMatchPresent, 'boolean');
    assert.equal(typeof row.exactThreeSentenceOpeningMatchPresent, 'boolean');
    assertStructureProjection(row.structureFeatures, 'RENDER_CONTEXT_SOURCE_TEXT');
    assert.ok(row.retainedRecordBlockShapes.blockShapes.length <= 32);
  }
  for (const row of [...report.pipeline.renderedSelectedQuotePresence, ...report.pipeline.finalClaimPresence]) {
    assert.equal(typeof row.exactSavedBlockMatchPresent, 'boolean');
    assert.equal(typeof row.exactThreeSentenceOpeningMatchPresent, 'boolean');
    assertStructureProjection(row.structureFeatures, 'SELECTED_CLAIM_QUOTE');
  }
  assert.ok(report.pipeline.renderedSelectedQuotePresence.length > 0,
    'The API-free fixture must exercise at least one rendered selected quote.');
  const savedReport = await readFile(path.join(successDirectory, REPORT_FILENAME), 'utf8');
  assert.ok(report.page.selectedUnits.some(row => savedReport.includes(row.cleanPublicUnitText)),
    'The report must retain bounded cleaned public source text for inspection.');
  for (const sensitiveText of [frozenCase.query, frozenIssue.subject, RAW_HTML_SENTINEL]) {
    assert.equal(savedReport.includes(sensitiveText), false, 'Reports store flags and fingerprints rather than source text or questions.');
  }
  assert.equal(ambientFetchAttempts, 0);

  await rm(path.join(successDirectory, REPORT_FILENAME));
  let replayCalls = 0;
  await assert.rejects(runIrasPublicGstSelectionV3({ mode: 'live-source', outputDirectory: successDirectory,
    fetchImpl: async () => { replayCalls += 1; return response(publicCaptureBody); }, now: FIXED_CAPTURE_NOW }),
  error => error?.code === 'RUN_CONSUMED');
  assert.equal(replayCalls, 0, 'A consumed diagnostic cannot be replayed after report deletion.');
} finally {
  await rm(successDirectory, { recursive: true, force: true });
}

const openingControlDirectory = await createOutputDirectory();
try {
  await createPlan(openingControlDirectory);
  const savedOpeningExcerpt = savedV1GstReport().results.find(row => row.mapId === GST_MAP_ID).excerpts
    .find(row => row.blockIndex === 7).text;
  const plainOpening = savedOpeningExcerpt.split(/\r?\n\s*\r?\n/).slice(1).join('\n\n');
  const pageTitle = `${pointer.documentTitle} | IRAS`;
  const plainOpeningHtml = `<html><head><title>${escapeHtml(pageTitle)}</title></head><body><main>` +
    `<h1>${escapeHtml(pageTitle)}</h1><p>${escapeHtml(plainOpening)}</p></main></body></html>`;
  const synthetic = syntheticFetch({ directory: openingControlDirectory, body: plainOpeningHtml });
  const report = await runIrasPublicGstSelectionV3({ mode: 'live-source', outputDirectory: openingControlDirectory,
    fetchImpl: synthetic.fetchImpl, now: FIXED_CAPTURE_NOW });
  assert.equal(synthetic.calls(), 1);
  assert.ok(report.page.exactThreeSentenceOpeningMatchPresentInFullVisibleText);
  assert.ok(report.pipeline.finalClaimPresence.length > 0,
    'The separate plain-opening scenario must exercise the exported V3 path through a final-claim projection.');
  assert.ok(report.pipeline.finalClaimPresence.some(row => row.exactThreeSentenceOpeningMatchPresent),
    'At least one final claim must preserve the exact three-sentence opening in this synthetic run.');
} finally {
  await rm(openingControlDirectory, { recursive: true, force: true });
}

const redirectDirectory = await createOutputDirectory();
try {
  await createPlan(redirectDirectory);
  const synthetic = syntheticFetch({ directory: redirectDirectory, redirect: true });
  const report = await runIrasPublicGstSelectionV3({ mode: 'live-source', outputDirectory: redirectDirectory,
    fetchImpl: synthetic.fetchImpl, now: FIXED_CAPTURE_NOW });
  assert.equal(synthetic.calls(), 2, 'One same-path IRAS peer redirect adds at most one second synthetic transport call.');
  assert.equal(report.mappedTransportRequestCount, 2);
  assert.ok(report.transportEvents.some(event => event.status === 'REDIRECT_302'));
  assert.equal(report.closedMappedSynthetic503Counts.IRAS_GST_INVOICING_SOURCE_MAP > 0, true);
  assert.equal(ambientFetchAttempts, 0);
} finally {
  await rm(redirectDirectory, { recursive: true, force: true });
}

const driftDirectory = await createOutputDirectory();
try {
  await createPlan(driftDirectory, { readCodeFingerprints: async paths => paths.map(item => ({ path: item, sha256: 'before' })) });
  let driftCalls = 0;
  await assert.rejects(runIrasPublicGstSelectionV3({ mode: 'live-source', outputDirectory: driftDirectory,
    readCodeFingerprints: async paths => paths.map(item => ({ path: item, sha256: 'after' })),
    fetchImpl: async () => { driftCalls += 1; return response(publicCaptureBody); }, now: FIXED_CAPTURE_NOW }),
  error => error?.code === 'PREREGISTRATION_MISMATCH');
  assert.equal(driftCalls, 0, 'Fingerprint drift rejects the diagnostic before transport or marker reservation.');
  assert.equal(await exists(path.join(driftDirectory, CONSUMED_FILENAME)), false);
} finally {
  await rm(driftDirectory, { recursive: true, force: true });
}

const v8HistoryTamperDirectory = await createOutputDirectory();
try {
  await createPlan(v8HistoryTamperDirectory);
  const v8Plan = JSON.parse(readFileSync(V8_PLAN_PATH, 'utf8')).preregistration;
  const tamperedMember = v8Plan.historicalFingerprints.additionalImmutableHistory.find(row => row.path.endsWith(
    'iras-mapped-evidence-diagnostic-v7.mjs'));
  assert.ok(tamperedMember, 'The V8 additional immutable history must include its V7 harness member.');
  const tamperedPath = path.resolve(repositoryRoot, ...tamperedMember.path.split(/[\\/]/));
  const readFileWithTamperedHistory = async (filePath, ...args) => {
    const contents = await readFile(filePath, ...args);
    if (path.resolve(String(filePath)).toLowerCase() !== tamperedPath.toLowerCase()) return contents;
    const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
    return Buffer.concat([bytes, Buffer.from('synthetic-history-tamper')]);
  };
  let tamperFetchCalls = 0;
  await assert.rejects(runIrasPublicGstSelectionV3({ mode: 'live-source', outputDirectory: v8HistoryTamperDirectory,
    readFileImpl: readFileWithTamperedHistory,
    fetchImpl: async () => { tamperFetchCalls += 1; return response(publicCaptureBody); }, now: FIXED_CAPTURE_NOW }),
  error => error?.code === 'HISTORICAL_INTEGRITY_FAILURE');
  assert.equal(tamperFetchCalls, 0, 'A changed frozen V8 history member must reject before transport.');
  assert.equal(await exists(path.join(v8HistoryTamperDirectory, CONSUMED_FILENAME)), false,
    'A frozen-history mismatch must be detected before reserving the consumed marker.');
} finally {
  await rm(v8HistoryTamperDirectory, { recursive: true, force: true });
}

assert.equal(ambientFetchAttempts, 0);
globalThis.fetch = originalFetch;
process.stdout.write('IRAS prospective public GST selection V3 API-free regression passed.\n');
