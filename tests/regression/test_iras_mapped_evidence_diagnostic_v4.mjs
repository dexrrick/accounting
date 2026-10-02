import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  V4_CONSUMED_FILENAME,
  V4_OUTPUT_DIRECTORY,
  V4_PLAN_FILENAME,
  V4_REPORT_FILENAME,
  V4_SELECTED_CASE_IDS,
  assertPinnedHistoricalArtifactsUnchanged,
  runIrasMappedEvidenceDiagnostic
} from '../evaluation/singapore/iras-mapped-evidence-diagnostic-v4.mjs';
import { createMappedOnlyTransport } from '../evaluation/singapore/iras-mapped-source-diagnostic-v3.mjs';
import { IRAS_SOURCE_MAP_DEFINITIONS, getCoverageTopicsByIds } from '../../src/standards/coverageRegistry.ts';
import { irasResolverCases } from '../fixtures/irasResolverCases.mjs';

const SOURCE_SENTINEL = 'V4_RAW_SOURCE_SENTINEL_7814';
const FAILURE_SENTINEL = 'V4_RAW_FAILURE_SENTINEL_6921';

function htmlResponse(html, status = 200) {
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function syntheticPage(page) {
  const definitions = page.mapIds.map(id => IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === id)).filter(Boolean);
  const topics = getCoverageTopicsByIds(page.topicIds);
  const visibleTerms = [...new Set(topics.flatMap(topic => [topic.title, ...(topic.aliases || []), ...topic.keywords]))];
  const title = definitions[0]?.pageTitle || 'IRAS synthetic map fixture';
  const body = [
    'SYNTHETIC TEST CONTENT ONLY; NOT AN IRAS WEBPAGE OR TAX GUIDANCE.',
    `This local fixture exercises mapped-page retrieval for ${visibleTerms.join(' ')}.`,
    `The ${SOURCE_SENTINEL} sentinel must remain in memory only.`,
    'This complete synthetic paragraph has enough visible prose to exercise the existing source-text projection.'
  ].join(' ');
  return `<!doctype html><html><head><title>${title} | IRAS</title></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
}

async function createTestDirectory() {
  await mkdir(V4_OUTPUT_DIRECTORY, { recursive: true });
  return mkdtemp(path.join(V4_OUTPUT_DIRECTORY, '.mapped-evidence-v4-test-'));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function assertNoFile(filePath) {
  await assert.rejects(readFile(filePath), error => error?.code === 'ENOENT');
}

async function expectCode(promise, code) {
  await assert.rejects(promise, error => error?.code === code, `Expected error code ${code}`);
}

async function createPlan(directory) {
  let networkCalls = 0;
  const plan = await runIrasMappedEvidenceDiagnostic({
    mode: 'plan', outputDirectory: directory,
    fetchImpl: async () => { networkCalls += 1; throw new Error(FAILURE_SENTINEL); }
  });
  assert.equal(networkCalls, 0, 'Plan mode must never touch the injected transport');
  assert.deepEqual(plan.preregistration.selection.caseIds, V4_SELECTED_CASE_IDS);
  assert.equal(plan.preregistration.bounds.modelRequests, 0);
  assert.equal(plan.preregistration.bounds.discoveryRequests, 0);
  assert.equal(plan.preregistration.bounds.searchRequests, 0);
  assert.equal(plan.preregistration.bounds.fetchTimeoutMs, 10_000);
  assert.equal(plan.preregistration.bounds.retries, 0);
  const text = await readFile(path.join(directory, V4_PLAN_FILENAME), 'utf8');
  assert.ok(!text.includes(SOURCE_SENTINEL));
  assert.ok(!text.includes(FAILURE_SENTINEL));
  for (const testCase of irasResolverCases.filter(item => V4_SELECTED_CASE_IDS.includes(item.id))) {
    assert.ok(!text.includes(testCase.query), `${testCase.id}: raw synthetic question must not be stored`);
    assert.ok(!text.includes(testCase.issues[0].subject), `${testCase.id}: raw issue subject must not be stored`);
  }
  return plan;
}

function transportFor(plan, { onCall } = {}) {
  const permitted = new Map(plan.preregistration.sourceMaps.map(page => [page.canonicalUrl, page]));
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, 'https:');
    assert.ok(['www.iras.gov.sg', 'iras.gov.sg'].includes(parsed.hostname));
    assert.ok(permitted.has(url), 'Only preregistered canonical source-map URLs may be requested');
    assert.equal((init.method || 'GET').toUpperCase(), 'GET');
    assert.equal(init.redirect, 'manual');
    calls.push(url);
    await onCall?.(url, init);
    return htmlResponse(syntheticPage(permitted.get(url)));
  };
  return { fetchImpl, calls };
}

async function successfulPrivacyAndHistoryChecks() {
  const directory = await createTestDirectory();
  try {
    const plan = await createPlan(directory);
    const beforeHistorical = await assertPinnedHistoricalArtifactsUnchanged();
    const { fetchImpl, calls } = transportFor(plan);
    const report = await runIrasMappedEvidenceDiagnostic({ mode: 'live-source', outputDirectory: directory, fetchImpl });
    assert.equal(report.directMapProbes.length, V4_SELECTED_CASE_IDS.length);
    assert.equal(report.renderedEvidence.length, V4_SELECTED_CASE_IDS.length);
    assert.equal(report.runtimeIssues.length, V4_SELECTED_CASE_IDS.length);
    assert.equal(report.modelRequests, 0);
    assert.equal(report.discoveryRequests, 0);
    assert.equal(report.searchRequests, 0);
    assert.ok(report.maximumActualGets <= 2 * plan.preregistration.sourceMaps.length);
    assert.equal(report.actualGetCount, calls.length);
    assert.ok(calls.length > 0);
    assert.ok(calls.length <= 2 * plan.preregistration.sourceMaps.length);
    assert.equal(new Set(calls).size, calls.length, 'The shared transport cache must prevent duplicate canonical GETs');
    assert.ok(report.directMapProbes.every(row => row.topicRows.length > 0));
    assert.ok(report.renderedEvidence.every(row => row.rejectedReasonCounts &&
      Object.values(row.rejectedReasonCounts).every(Number.isInteger)));
    assert.ok(report.runtimeIssues.every(row => Array.isArray(row.gapCodes) &&
      ['UNRESOLVED', 'NOT_REQUIRED', 'OTHER_STATUS'].includes(row.applicationStatus)));
    assert.ok(await readFile(path.join(directory, V4_CONSUMED_FILENAME), 'utf8'));
    const persisted = await readFile(path.join(directory, V4_REPORT_FILENAME), 'utf8');
    assert.ok(!persisted.includes(SOURCE_SENTINEL), 'Raw mapped page text must not be serialized');
    assert.ok(!persisted.includes(FAILURE_SENTINEL));
    for (const testCase of irasResolverCases.filter(item => V4_SELECTED_CASE_IDS.includes(item.id))) {
      assert.ok(!persisted.includes(testCase.query), `${testCase.id}: raw question must not be serialized`);
      assert.ok(!persisted.includes(testCase.issues[0].subject), `${testCase.id}: raw subject must not be serialized`);
    }
    assert.deepEqual(await assertPinnedHistoricalArtifactsUnchanged(), beforeHistorical);

    // Deleting this disposable test output proves that the permanent marker,
    // rather than output collision alone, prevents a second live schedule.
    await rm(path.join(directory, V4_REPORT_FILENAME));
    const callsBeforeReplay = calls.length;
    await expectCode(runIrasMappedEvidenceDiagnostic({ mode: 'live-source', outputDirectory: directory,
      fetchImpl }), 'RUN_CONSUMED');
    assert.equal(calls.length, callsBeforeReplay, 'A consumed plan must refuse reuse with zero new requests');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function invalidPageAndClosedTransportChecks() {
  const directory = await createTestDirectory();
  try {
    const plan = await createPlan(directory);
    let calls = 0;
    const invalidFetch = async url => {
      calls += 1;
      assert.ok(plan.preregistration.sourceMaps.some(page => page.canonicalUrl === url));
      return htmlResponse(`<html><head><title>Unrelated page</title></head><body><p>${SOURCE_SENTINEL} invalid body</p></body></html>`);
    };
    const report = await runIrasMappedEvidenceDiagnostic({ mode: 'live-source', outputDirectory: directory, fetchImpl: invalidFetch });
    assert.equal(report.actualGetCount, calls);
    assert.ok(report.directMapProbes.every(issue => issue.candidateCount === 0),
      'Invalid mapped pages should produce an observed zero-candidate diagnostic, not abort the report');
    assert.equal(report.discoveryRequests, 0);
    assert.equal(report.searchRequests, 0);
    const saved = await readFile(path.join(directory, V4_REPORT_FILENAME), 'utf8');
    assert.ok(!saved.includes(SOURCE_SENTINEL));

    const closedCalls = [];
    const closed = createMappedOnlyTransportForTest(plan, closedCalls);
    await assert.rejects(closed.fetch('https://evil.example/sentinel', { method: 'GET' }), /MAPPED_PAGE_URL_REJECTED/);
    assert.equal(closedCalls.length, 0, 'Off-map URLs must never reach the injected transport');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function createMappedOnlyTransportForTest(plan, calls) {
  return createMappedOnlyTransport({
    canonicalUrls: plan.preregistration.sourceMaps,
    fetchImpl: async url => { calls.push(url); return htmlResponse('synthetic'); },
    maxActualGets: 2 * plan.preregistration.sourceMaps.length
  });
}

async function collisionAndPrereqChecks() {
  const collisionDirectory = await createTestDirectory();
  const tamperedDirectory = await createTestDirectory();
  try {
    await createPlan(collisionDirectory);
    let collisionCalls = 0;
    await writeFile(path.join(collisionDirectory, V4_REPORT_FILENAME), '{"preexisting":true}\n', { flag: 'wx' });
    await expectCode(runIrasMappedEvidenceDiagnostic({ mode: 'live-source', outputDirectory: collisionDirectory,
      fetchImpl: async () => { collisionCalls += 1; return htmlResponse('sentinel'); } }), 'EEXIST');
    assert.equal(collisionCalls, 0, 'An output collision must refuse before requests');
    await assertNoFile(path.join(collisionDirectory, V4_CONSUMED_FILENAME));

    await createPlan(tamperedDirectory);
    const planPath = path.join(tamperedDirectory, V4_PLAN_FILENAME);
    const tampered = await readJson(planPath);
    tampered.preregistrationSha256 = '0'.repeat(64);
    await writeFile(planPath, `${JSON.stringify(tampered, null, 2)}\n`);
    let tamperCalls = 0;
    await expectCode(runIrasMappedEvidenceDiagnostic({ mode: 'live-source', outputDirectory: tamperedDirectory,
      fetchImpl: async () => { tamperCalls += 1; return htmlResponse('sentinel'); } }), 'PREREGISTRATION_MISMATCH');
    assert.equal(tamperCalls, 0, 'A changed preregistration hash must refuse before requests');
    await assertNoFile(path.join(tamperedDirectory, V4_CONSUMED_FILENAME));
  } finally {
    await rm(collisionDirectory, { recursive: true, force: true });
    await rm(tamperedDirectory, { recursive: true, force: true });
  }
}

async function concurrentReservationCheck() {
  const directory = await createTestDirectory();
  try {
    const plan = await createPlan(directory);
    let calls = 0;
    let entered;
    const firstEntered = new Promise(resolve => { entered = resolve; });
    let release;
    const holdFirst = new Promise(resolve => { release = resolve; });
    const { fetchImpl } = transportFor(plan, {
      onCall: async () => {
        calls += 1;
        if (calls === 1) {
          entered();
          await holdFirst;
        }
      }
    });
    const firstRun = runIrasMappedEvidenceDiagnostic({ mode: 'live-source', outputDirectory: directory, fetchImpl });
    await Promise.race([firstEntered, new Promise((_, reject) => setTimeout(() => reject(new Error('first request did not start')), 5_000))]);
    const callsAtReservation = calls;
    await expectCode(runIrasMappedEvidenceDiagnostic({ mode: 'live-source', outputDirectory: directory, fetchImpl }), 'EEXIST');
    assert.equal(calls, callsAtReservation, 'Concurrent invocation must fail before making another request');
    release();
    await firstRun;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function failedRunReuseAndFingerprintDriftChecks() {
  const failedDirectory = await createTestDirectory();
  const driftDirectory = await createTestDirectory();
  try {
    const failedPlan = await createPlan(failedDirectory);
    let failedCalls = 0;
    const failedReport = await runIrasMappedEvidenceDiagnostic({ mode: 'live-source', outputDirectory: failedDirectory,
      fetchImpl: async () => { failedCalls += 1; throw new Error(FAILURE_SENTINEL); } });
    assert.ok(failedCalls > 0);
    assert.ok(failedReport.transportEvents.some(event => event.status === 'TRANSPORT_ERROR'));
    const failureOutput = await readFile(path.join(failedDirectory, V4_REPORT_FILENAME), 'utf8');
    assert.ok(!failureOutput.includes(FAILURE_SENTINEL), 'Provider error text must never be serialized');
    assert.ok(!failureOutput.includes(SOURCE_SENTINEL));
    await rm(path.join(failedDirectory, V4_REPORT_FILENAME));
    const failedCallsAtReplay = failedCalls;
    await expectCode(runIrasMappedEvidenceDiagnostic({ mode: 'live-source', outputDirectory: failedDirectory,
      fetchImpl: async () => { failedCalls += 1; throw new Error(FAILURE_SENTINEL); } }), 'RUN_CONSUMED');
    assert.equal(failedCalls, failedCallsAtReplay, 'Failed transport run leaves the plan permanently consumed');

    const driftPlan = await createPlan(driftDirectory);
    let fingerprintReads = 0;
    const simulatedFingerprints = async () => {
      fingerprintReads += 1;
      const baseline = driftPlan.preregistration.sourceFingerprints;
      if (fingerprintReads === 1) return baseline;
      return baseline.map((entry, index) => index === 0 ? { ...entry, sha256: 'f'.repeat(64) } : entry);
    };
    let driftCalls = 0;
    await expectCode(runIrasMappedEvidenceDiagnostic({ mode: 'live-source', outputDirectory: driftDirectory,
      readFingerprints: simulatedFingerprints,
      fetchImpl: async url => { driftCalls += 1; const page = driftPlan.preregistration.sourceMaps.find(item => item.canonicalUrl === url); return htmlResponse(syntheticPage(page)); }
    }), 'PREREGISTRATION_MISMATCH');
    assert.ok(driftCalls > 0, 'Drift is simulated during a reserved live measurement');
    assert.ok(await readFile(path.join(driftDirectory, V4_CONSUMED_FILENAME), 'utf8'),
      'Fingerprint drift after reservation must retain the permanent consumed marker');
    await assertNoFile(path.join(driftDirectory, V4_REPORT_FILENAME));
    const driftCallsAtReplay = driftCalls;
    await expectCode(runIrasMappedEvidenceDiagnostic({ mode: 'live-source', outputDirectory: driftDirectory,
      readFingerprints: simulatedFingerprints,
      fetchImpl: async () => { driftCalls += 1; return htmlResponse('sentinel'); }
    }), 'PREREGISTRATION_MISMATCH');
    assert.equal(driftCalls, driftCallsAtReplay, 'Drift refusal must not make additional requests');
  } finally {
    await rm(failedDirectory, { recursive: true, force: true });
    await rm(driftDirectory, { recursive: true, force: true });
  }
}

async function parentDirectoryGuardCheck() {
  let calls = 0;
  await assert.rejects(runIrasMappedEvidenceDiagnostic({ mode: 'live-source',
    outputDirectory: path.resolve(V4_OUTPUT_DIRECTORY, '..'),
    fetchImpl: async () => { calls += 1; return htmlResponse('sentinel'); }
  }), /V4 diagnostic outputs must stay inside the V4 output directory/);
  assert.equal(calls, 0, 'Parent output path is refused before creating files or requesting sources');
}

await successfulPrivacyAndHistoryChecks();
await invalidPageAndClosedTransportChecks();
await collisionAndPrereqChecks();
await concurrentReservationCheck();
await failedRunReuseAndFingerprintDriftChecks();
await parentDirectoryGuardCheck();
process.stdout.write('V4 mapped-evidence diagnostic API-free safety regression passed.\n');
