import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExternalSourceValidator } from '../../../src/retrieval/externalSourceValidator.ts';
import { IRAS_SOURCE_MAP_DEFINITIONS, getCoverageTopicsByIds } from '../../../src/standards/coverageRegistry.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../../src/standards/unifiedSourceModel.ts';
import {
  CONSUMED_FILENAME,
  GST_MAP_ID,
  OUTPUT_DIRECTORY,
  PLAN_FILENAME,
  REPORT_FILENAME,
  runIrasPublicGstSelectionV3,
  selectGstPublicUnits
} from './iras-public-gst-selection-v3.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const V1_REPORT_PATH = path.join(REPOSITORY_ROOT,
  'docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v1/iras-public-rule-excerpts-report-v1.json');
const OUTPUT_PATH = path.join(REPOSITORY_ROOT,
  'docs/evaluation/multi-authority-workstreams/iras-first-local-2026-10-02-v6/iras-gst-response-size-probe-v1.json');
const MAX_PAGE_CHARACTERS = 200000;
const RAW_PADDING_CHARACTERS = MAX_PAGE_CHARACTERS + 10000;
const CAPTURE_INSTANT = new Date().toISOString();
const RAW_SENTINEL = 'GST_RESPONSE_SIZE_PROBE_RAW_SENTINEL_7D52';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizePublicText(value) {
  return String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function pageHtml({ title, excerpts, scriptPadding = '' }) {
  const pageTitle = escapeHtml(`${title} | IRAS`);
  const body = excerpts.map(text => `<p>${escapeHtml(text)}</p>`).join('');
  const script = scriptPadding ? `<script>${RAW_SENTINEL}${scriptPadding}</script>` : '';
  return `<html><head><title>${pageTitle}</title>${script}</head>` +
    `<body><main><h1>${pageTitle}</h1>${body}</main></body></html>`;
}

function sourceExpectation(definition, pointer) {
  const topic = getCoverageTopicsByIds(definition.topicIds).find(row => row.domainId === definition.domainId);
  assert.ok(topic, 'The registered GST source map has a matching coverage topic.');
  return {
    standardIdentifiers: [pointer.standardOrActCode, pointer.documentTitle].filter(Boolean),
    expectedTitles: [pointer.documentTitle],
    topicTerms: [...new Set([topic.title, ...(topic.aliases || []), ...topic.keywords,
      ...(topic.requiredContentTerms || []), ...(topic.paragraphHints || []), ...(topic.sectionHints || [])])],
    allowIrasTopicTokenEquivalence: true
  };
}

async function exists(filePath) {
  try { await stat(filePath); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

async function createTemporaryOutputDirectory() {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  return mkdtemp(path.join(OUTPUT_DIRECTORY, '.gst-response-size-probe-'));
}

function assertSafeCleanupTarget(directory, temporaryRoot, isRoot = false) {
  const resolvedDirectory = path.resolve(directory);
  const resolvedRoot = path.resolve(temporaryRoot);
  if (isRoot) {
    assert.equal(path.dirname(resolvedDirectory), path.resolve(OUTPUT_DIRECTORY));
    assert.ok(path.basename(resolvedDirectory).startsWith('.gst-response-size-probe-'));
    return;
  }
  assert.equal(path.dirname(resolvedDirectory), resolvedRoot,
    'Recursive cleanup may target only a direct child of this unique temporary root.');
}

async function createPlan(directory) {
  let planFetchCalls = 0;
  const plan = await runIrasPublicGstSelectionV3({
    mode: 'plan',
    outputDirectory: directory,
    fetchImpl: async () => { planFetchCalls += 1; throw new Error('PLAN_FETCH_BLOCKED'); },
    now: () => CAPTURE_INSTANT
  });
  assert.equal(planFetchCalls, 0);
  assert.ok(plan.preregistrationSha256 || plan.preregistration);
}

function syntheticFetch(directory, body) {
  let calls = 0;
  let markerPresentAtFetch = false;
  return {
    calls: () => calls,
    markerPresentAtFetch: () => markerPresentAtFetch,
    fetchImpl: async (urlValue, init = {}) => {
      calls += 1;
      markerPresentAtFetch = await exists(path.join(directory, CONSUMED_FILENAME));
      assert.equal(markerPresentAtFetch, true, 'V3 reserves its consumed marker before the injected mapped fetch.');
      assert.equal(new URL(urlValue).pathname, new URL(definition.canonicalSourceUrl).pathname);
      assert.equal((init.method || 'GET').toUpperCase(), 'GET');
      assert.equal(init.redirect, 'manual');
      return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
  };
}

const savedReport = JSON.parse(await readFile(V1_REPORT_PATH, 'utf8'));
const savedGstResult = savedReport.results.find(row => row.mapId === GST_MAP_ID);
const savedOpeningExcerpt = savedGstResult?.excerpts?.find(row => row.blockIndex === 7);
assert.equal(savedGstResult?.status, 'VALIDATED');
assert.ok(savedOpeningExcerpt && !savedOpeningExcerpt.truncated);
const capturedBlocks = savedOpeningExcerpt.text.split(/\r?\n\s*\r?\n/).map(value => value.trim()).filter(Boolean);
assert.equal(capturedBlocks[0], '•', 'The exact saved public unit retains its leading standalone bullet.');
const opening = capturedBlocks.slice(1).join('\n\n');
assert.equal(opening.split(/(?<=[.!?])\s+/).filter(Boolean).length, 3,
  'The captured public opening remains complete at three sentences.');
const definition = IRAS_SOURCE_MAP_DEFINITIONS.find(row => row.id === GST_MAP_ID);
const pointer = UNIFIED_SOURCE_REGISTRY[GST_MAP_ID];
assert.ok(definition && pointer);
const expectation = sourceExpectation(definition, pointer);
const title = pointer.documentTitle;
const smallHtml = pageHtml({ title, excerpts: [opening] });
const oversizedHtml = pageHtml({ title, excerpts: [opening], scriptPadding: 'x'.repeat(RAW_PADDING_CHARACTERS) });
const validator = new ExternalSourceValidator();

assert.ok(oversizedHtml.length > MAX_PAGE_CHARACTERS);
const oversizedValidation = validator.validateTopicContent(oversizedHtml, expectation);
assert.equal(oversizedValidation.isValid, true, 'The oversized synthetic page remains source-valid after page-chrome removal.');
assert.ok(oversizedValidation.substantiveText.length < MAX_PAGE_CHARACTERS,
  'Synthetic script padding is absent from validator-visible text.');
const oversizedSelection = selectGstPublicUnits(oversizedValidation.substantiveText);
const openingNormalized = normalizePublicText(opening);
const oversizedOpeningUnits = oversizedSelection.excerpts.filter(row =>
  normalizePublicText(row.text).includes(openingNormalized));
assert.ok(oversizedOpeningUnits.length > 0, 'The bounded selector admits the complete captured opening in cleaned text.');
assert.ok(oversizedOpeningUnits.every(row => !row.truncated && row.text.length <= 3000));

const smallValidation = validator.validateTopicContent(smallHtml, expectation);
assert.equal(smallValidation.isValid, true, 'The small synthetic page passes the same source validator.');
const smallSelection = selectGstPublicUnits(smallValidation.substantiveText);
assert.ok(smallSelection.excerpts.some(row => normalizePublicText(row.text).includes(openingNormalized)),
  'The same bounded selector admits the complete opening in the positive control.');

const originalFetch = globalThis.fetch;
let ambientFetchAttempts = 0;
globalThis.fetch = async () => {
  ambientFetchAttempts += 1;
  throw new Error('AMBIENT_FETCH_BLOCKED');
};

let oversizedRun;
let positiveRun;
const temporaryRoot = await createTemporaryOutputDirectory();
try {
  const oversizedDirectory = path.join(temporaryRoot, 'oversized');
  await mkdir(oversizedDirectory);
  try {
    await createPlan(oversizedDirectory);
    const injected = syntheticFetch(oversizedDirectory, oversizedHtml);
    let failureCode = 'NO_FAILURE';
    try {
      await runIrasPublicGstSelectionV3({ mode: 'live-source', outputDirectory: oversizedDirectory,
        fetchImpl: injected.fetchImpl, now: () => CAPTURE_INSTANT });
    } catch (error) {
      failureCode = error?.code || 'UNCLASSIFIED_FAILURE';
    }
    const planPresentBeforeCleanup = await exists(path.join(oversizedDirectory, PLAN_FILENAME));
    const consumedMarkerPresentBeforeCleanup = await exists(path.join(oversizedDirectory, CONSUMED_FILENAME));
    const reportPresentBeforeCleanup = await exists(path.join(oversizedDirectory, REPORT_FILENAME));
    assert.equal(failureCode, 'PAGE_CHARACTER_LIMIT', 'V3 rejects oversized raw HTML at its fixed character boundary.');
    assert.equal(injected.calls(), 1, 'Exactly one synthetic mapped GET is issued.');
    assert.equal(injected.markerPresentAtFetch(), true);
    assert.equal(planPresentBeforeCleanup, true);
    assert.equal(consumedMarkerPresentBeforeCleanup, true, 'The consumed marker remains after the attempted GET.');
    assert.equal(reportPresentBeforeCleanup, false, 'The raw-size failure occurs before a V3 report is written.');
    oversizedRun = {
      resultCode: failureCode,
      syntheticMappedGetCount: injected.calls(),
      consumedMarkerPresentAtFetch: injected.markerPresentAtFetch(),
      planPresentBeforeCleanup,
      consumedMarkerPresentBeforeCleanup,
      reportPresentBeforeCleanup
    };
  } finally {
    assertSafeCleanupTarget(oversizedDirectory, temporaryRoot);
    await rm(oversizedDirectory, { recursive: true, force: true });
  }
  assert.equal(await exists(oversizedDirectory), false, 'The oversized run leaves no temporary V3 artifacts.');

  const positiveDirectory = path.join(temporaryRoot, 'positive');
  await mkdir(positiveDirectory);
  try {
    await createPlan(positiveDirectory);
    const injected = syntheticFetch(positiveDirectory, smallHtml);
    const report = await runIrasPublicGstSelectionV3({ mode: 'live-source', outputDirectory: positiveDirectory,
      fetchImpl: injected.fetchImpl, now: () => CAPTURE_INSTANT });
    const reportPresentBeforeCleanup = await exists(path.join(positiveDirectory, REPORT_FILENAME));
    const consumedMarkerPresentBeforeCleanup = await exists(path.join(positiveDirectory, CONSUMED_FILENAME));
    const openingClaimCount = report.pipeline.finalClaimPresence.filter(row => row.exactThreeSentenceOpeningMatchPresent).length;
    assert.equal(injected.calls(), 1);
    assert.equal(injected.markerPresentAtFetch(), true);
    assert.equal(reportPresentBeforeCleanup, true);
    assert.equal(consumedMarkerPresentBeforeCleanup, true);
    assert.equal(report.pipeline.finalEvidenceStatus, 'VERIFIED');
    assert.ok(openingClaimCount > 0, 'The small control carries the complete opening into a final claim.');
    assert.equal(report.modelRequests, 0);
    assert.equal(report.discoveryRequests, 0);
    assert.equal(report.searchRequests, 0);
    assert.equal(report.unexpectedSyntheticCallCount, 0);
    assert.equal(report.mappedTransportRequestCount, 1);
    positiveRun = {
      syntheticMappedGetCount: injected.calls(),
      consumedMarkerPresentAtFetch: injected.markerPresentAtFetch(),
      consumedMarkerPresentBeforeCleanup,
      reportPresentBeforeCleanup,
      mappedTransportRequestCount: report.mappedTransportRequestCount,
      modelRequestCount: report.modelRequests,
      discoveryRequestCount: report.discoveryRequests,
      searchRequestCount: report.searchRequests,
      unexpectedSyntheticCallCount: report.unexpectedSyntheticCallCount,
      finalEvidenceStatus: report.pipeline.finalEvidenceStatus,
      finalClaimCount: report.pipeline.finalClaimPresence.length,
      exactOpeningFinalClaimCount: openingClaimCount
    };
  } finally {
    assertSafeCleanupTarget(positiveDirectory, temporaryRoot);
    await rm(positiveDirectory, { recursive: true, force: true });
  }
  assert.equal(await exists(positiveDirectory), false, 'The positive run leaves no temporary V3 artifacts.');
  assert.equal(ambientFetchAttempts, 0, 'No ambient network request was attempted.');
} finally {
  assertSafeCleanupTarget(temporaryRoot, temporaryRoot, true);
  await rm(temporaryRoot, { recursive: true, force: true });
  globalThis.fetch = originalFetch;
}
assert.equal(await exists(temporaryRoot), false, 'The unique temporary root is removed after both controls.');

const result = {
  schemaVersion: 1,
  profileVersion: 'iras-gst-response-size-probe-v1',
  diagnosticOnly: true,
  interpretation: 'SYNTHETIC_RESPONSE_SIZE_BOUNDARY_CONTROL_NOT_ACTUAL_V3_CAUSAL_PROOF',
  compositionDisclosure: 'Both synthetic HTML cases use only the complete three-sentence body of saved V1 GST block 7 in one paragraph; its standalone bullet is removed as disclosed. The oversized case adds only script-element padding. Neither case establishes actual public-page HTML composition, adjacency, or HTML length.',
  publicFixture: {
    mapId: GST_MAP_ID,
    savedBlockIndex: 7,
    savedDocumentSha256: savedGstResult.documentSha256,
    exactOpeningSha256: sha256(normalizePublicText(opening)),
    exactOpeningSentenceCount: opening.split(/(?<=[.!?])\s+/).filter(Boolean).length,
    standaloneBulletRetainedInSavedUnit: true
  },
  oversizedSyntheticCase: {
    rawHtmlCharacterCount: oversizedHtml.length,
    rawHtmlSha256: sha256(oversizedHtml),
    rawLimitCharacters: MAX_PAGE_CHARACTERS,
    scriptPaddingCharacterCount: RAW_PADDING_CHARACTERS,
    directValidatorAccepted: oversizedValidation.isValid,
    cleanedVisibleTextCharacterCount: oversizedValidation.substantiveText.length,
    cleanedVisibleTextSha256: sha256(oversizedValidation.substantiveText),
    cleanedVisibleTextBelowRawLimit: oversizedValidation.substantiveText.length < MAX_PAGE_CHARACTERS,
    boundedSelectorUnitCount: oversizedSelection.excerpts.length,
    boundedSelectorExactOpeningUnitCount: oversizedOpeningUnits.length,
    allOpeningUnitsCompleteAndBounded: oversizedOpeningUnits.every(row => !row.truncated && row.text.length <= 3000),
    v3: oversizedRun
  },
  smallSyntheticPositiveControl: {
    rawHtmlCharacterCount: smallHtml.length,
    rawHtmlSha256: sha256(smallHtml),
    directValidatorAccepted: smallValidation.isValid,
    cleanedVisibleTextCharacterCount: smallValidation.substantiveText.length,
    cleanedVisibleTextSha256: sha256(smallValidation.substantiveText),
    boundedSelectorUnitCount: smallSelection.excerpts.length,
    exactOpeningUnitPresent: smallSelection.excerpts.some(row => normalizePublicText(row.text).includes(openingNormalized)),
    v3: positiveRun
  },
  controls: {
    ambientFetchAttemptCount: ambientFetchAttempts,
    modelRequests: positiveRun.modelRequestCount,
    discoveryRequests: positiveRun.discoveryRequestCount,
    searchRequests: positiveRun.searchRequestCount,
    unexpectedSyntheticCalls: positiveRun.unexpectedSyntheticCallCount,
    temporaryOutputDirectoriesRemoved: true
  },
  limit: 'This proves the exported V3 fixed raw-page-size rejection for this synthetic oversized response while validator and complete-unit selection accept its cleaned visible evidence. It does not identify which V3 branch caused the consumed V3 failure or establish the actual source HTML length.'
};

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ status: 'OK', rawHtmlCharacters: result.oversizedSyntheticCase.rawHtmlCharacterCount,
  cleanedVisibleTextCharacters: result.oversizedSyntheticCase.cleanedVisibleTextCharacterCount,
  selectorOpeningUnits: result.oversizedSyntheticCase.boundedSelectorExactOpeningUnitCount,
  oversizedV3Code: result.oversizedSyntheticCase.v3.resultCode,
  positiveFinalEvidenceStatus: result.smallSyntheticPositiveControl.v3.finalEvidenceStatus,
  exactOpeningFinalClaims: result.smallSyntheticPositiveControl.v3.exactOpeningFinalClaimCount,
  reportPath: path.relative(REPOSITORY_ROOT, OUTPUT_PATH) })}\n`);
