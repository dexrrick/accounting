import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  V5_CONSUMED_FILENAME,
  V5_OUTPUT_DIRECTORY,
  V5_PLAN_FILENAME,
  V5_REPORT_FILENAME,
  V5_SELECTED_CASE_IDS,
  assertPinnedHistoricalArtifactsUnchanged,
  requestedConceptsForIssue,
  runIrasMappedEvidenceDiagnostic,
  safeLifecycleFlags
} from '../evaluation/singapore/iras-mapped-evidence-diagnostic-v5.mjs';
import { createMappedOnlyTransport } from '../evaluation/singapore/iras-mapped-source-diagnostic-v3.mjs';
import { IRAS_SOURCE_MAP_DEFINITIONS, getCoverageTopicsByIds } from '../../src/standards/coverageRegistry.ts';
import { getRequestedQuestionConcepts } from '../../src/services/semanticQuestionUnderstanding.ts';
import { irasResolverCases } from '../fixtures/irasResolverCases.mjs';

const SOURCE_SENTINEL = 'V5_RAW_SOURCE_SENTINEL_7814';
const FAILURE_SENTINEL = 'V5_RAW_FAILURE_SENTINEL_6921';

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
  await mkdir(V5_OUTPUT_DIRECTORY, { recursive: true });
  return mkdtemp(path.join(V5_OUTPUT_DIRECTORY, '.mapped-evidence-v5-test-'));
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

function syntheticUnderstanding(testCase) {
  const singleIssue = testCase.issues.length === 1;
  const firstIssue = testCase.issues[0];
  const subjects = testCase.issues.map(issue => issue.subject);
  return {
    mode: 'SEMANTIC_INTERPRETATION',
    interpretation: {
      schemaVersion: 2,
      jurisdiction: ['Singapore'],
      authorityCandidates: singleIssue ? [firstIssue.authority] : ['UNKNOWN'],
      contextualAuthorities: [],
      domain: singleIssue ? firstIssue.domain : 'UNKNOWN',
      population: singleIssue ? firstIssue.population : 'UNKNOWN',
      primarySubject: subjects.join('; '),
      concepts: subjects.map((concept, index) => ({ concept, role: index === 0 ? 'PRIMARY' : 'RELATED' })),
      requestedOperation: singleIssue ? firstIssue.operation : 'OTHER',
      factsExplicitlyProvided: [],
      confidence: 0.96,
      issues: testCase.issues.map(issue => ({
        subject: issue.subject,
        population: issue.population,
        domain: issue.domain,
        governingAuthorities: [issue.authority],
        contextualAuthorities: [],
        operation: issue.operation,
        mappedTopicIds: [],
        evidenceRequirement: issue.facts ? 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' : 'AUTHORITATIVE_SOURCE',
        confidence: 0.96
      }))
    }
  };
}

function strictLifecycleProjectionChecks() {
  const stages = ['requested', 'mapped', 'retrievalAttempted', 'evidenceFound', 'admitted', 'verified', 'covered'];
  const lifecycle = Object.fromEntries(stages.map(stage => [stage, true]));
  assert.deepEqual(safeLifecycleFlags({ lifecycle }), lifecycle);
  assert.throws(() => safeLifecycleFlags(undefined), error => error?.code === 'RUNTIME_ISSUE_MISSING');
  assert.throws(() => safeLifecycleFlags({ lifecycle: { requested: true } }),
    error => error?.code === 'RUNTIME_LIFECYCLE_MALFORMED');
}

function topiclessConceptSelectionCheck() {
  const topiclessConcept = {
    id: 'synthetic_topicless_rule_request',
    label: 'Synthetic topicless rule request',
    terms: ['synthetic topicless rule request'],
    topicIds: []
  };
  const mappedConcept = {
    id: 'synthetic_related_mapped_request',
    label: 'Synthetic related mapped request',
    terms: ['synthetic related mapped request'],
    topicIds: ['iras-gst-input-tax']
  };
  const retained = requestedConceptsForIssue(['iras-cit-deductibility'], [topiclessConcept, mappedConcept]);
  assert.deepEqual(retained.map(concept => concept.id), [topiclessConcept.id],
    'A single-issue scope retains a public-shaped topicless concept and excludes an unrelated mapped concept');
}

async function createPlan(directory) {
  let networkCalls = 0;
  const plan = await runIrasMappedEvidenceDiagnostic({
    mode: 'plan', outputDirectory: directory,
    fetchImpl: async () => { networkCalls += 1; throw new Error(FAILURE_SENTINEL); }
  });
  assert.equal(networkCalls, 0, 'Plan mode must never touch the injected transport');
  assert.deepEqual(plan.preregistration.selection.caseIds, V5_SELECTED_CASE_IDS);
  assert.equal(plan.preregistration.bounds.modelRequests, 0);
  assert.equal(plan.preregistration.bounds.discoveryRequests, 0);
  assert.equal(plan.preregistration.bounds.searchRequests, 0);
  assert.equal(plan.preregistration.bounds.fetchTimeoutMs, 10_000);
  assert.equal(plan.preregistration.bounds.retries, 0);
  assert.equal(plan.preregistration.bounds.modelTimeoutMs, 8_000);
  const text = await readFile(path.join(directory, V5_PLAN_FILENAME), 'utf8');
  assert.ok(!text.includes(SOURCE_SENTINEL));
  assert.ok(!text.includes(FAILURE_SENTINEL));
  for (const testCase of irasResolverCases.filter(item => V5_SELECTED_CASE_IDS.includes(item.id))) {
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
    const privateCase = irasResolverCases.find(item => item.id === 'private-holiday-expense');
    assert.ok(privateCase && privateCase.issues.length === 1, 'The frozen private-expense contract must remain single-issue');
    const privateRequestedConcept = getRequestedQuestionConcepts(privateCase.query, syntheticUnderstanding(privateCase))
      .find(concept => concept.topicIds.some(topicId => ['iras-cit-deductibility', 'iras-cit-disallowed-expenses'].includes(topicId)));
    assert.ok(privateRequestedConcept,
      'The public concept getter must expose the frozen private-expense issue concept');
    const privateRequestedConceptId = privateRequestedConcept.id;
    const privateProbe = report.directMapProbes.find(row => row.caseId === privateCase.id);
    const privateRender = report.renderedEvidence.find(row => row.caseId === privateCase.id);
    const privateRuntime = report.runtimeIssues.find(row => row.caseId === privateCase.id);
    assert.ok(privateProbe && privateRender && privateRuntime);
    assert.equal(typeof privateRender.directProbeCandidateConceptFlags[privateRequestedConceptId], 'boolean',
      'The direct-probe production concept flag must retain the public private-expense concept ID');
    assert.equal(typeof privateRender.renderContextAdmittedConceptFlags[privateRequestedConceptId], 'boolean',
      'The rendered quality projection must retain the public private-expense concept ID');
    assert.ok(privateProbe.uncoveredConceptIds.includes(privateRequestedConceptId),
      'Direct evidence quality must report the requested private-expense concept as uncovered for generic synthetic text');
    assert.ok(privateRender.uncoveredConceptIds.includes(privateRequestedConceptId),
      'Rendered evidence quality must report the requested private-expense concept as uncovered for generic synthetic text');
    assert.ok(privateRuntime.uncoveredConceptIds.includes(privateRequestedConceptId),
      'Central issue coverage must expose only the known private-expense concept ID as uncovered');
    assert.equal(report.directMapProbes.length, V5_SELECTED_CASE_IDS.length);
    assert.equal(report.renderedEvidence.length, V5_SELECTED_CASE_IDS.length);
    assert.equal(report.runtimeIssues.length, V5_SELECTED_CASE_IDS.length);
    assert.equal(report.modelRequests, 0);
    assert.equal(report.discoveryRequests, 0);
    assert.equal(report.searchRequests, 0);
    assert.ok(report.maximumActualGets <= 2 * plan.preregistration.sourceMaps.length);
    assert.equal(report.actualGetCount, calls.length);
    assert.ok(calls.length > 0);
    assert.ok(calls.length <= 2 * plan.preregistration.sourceMaps.length);
    assert.equal(new Set(calls).size, calls.length, 'The shared transport cache must prevent duplicate canonical GETs');
    assert.ok(report.directMapProbes.every(row => row.topicRows.length > 0));
    const sourceRecordRows = report.directMapProbes.flatMap(row => row.topicRows.flatMap(topic =>
      topic.maps.flatMap(map => map.sourceBlockSummaries)));
    assert.ok(sourceRecordRows.length > 0, 'Synthetic mapped pages must exercise production concept-support projections');
    assert.ok(sourceRecordRows.every(record =>
      Object.values(record.conceptSupportFlags).every(value => typeof value === 'boolean') &&
      Object.values(record.generalRuleConceptSupport.recognized).every(value => typeof value === 'boolean') &&
      Object.values(record.generalRuleConceptSupport.supported).every(value => typeof value === 'boolean')));
    assert.ok(report.renderedEvidence.every(row => row.rejectedReasonCounts &&
      Object.values(row.rejectedReasonCounts).every(Number.isInteger)));
    assert.ok(report.renderedEvidence.every(row => Array.isArray(row.acceptedQuoteSupport) &&
      row.acceptedQuoteSupport.every(quote => Object.values(quote.conceptSupportFlags).every(value => typeof value === 'boolean') &&
        Object.values(quote.generalRuleConceptSupport.recognized).every(value => typeof value === 'boolean') &&
        Object.values(quote.generalRuleConceptSupport.supported).every(value => typeof value === 'boolean'))));
    const lifecycleStages = ['requested', 'mapped', 'retrievalAttempted', 'evidenceFound', 'admitted', 'verified', 'covered'];
    assert.ok(report.runtimeIssues.every(row => Array.isArray(row.gapCodes) &&
      Object.keys(row.lifecycleFlags).sort().join('|') === [...lifecycleStages].sort().join('|') &&
      Object.values(row.lifecycleFlags).every(value => typeof value === 'boolean') &&
      Object.keys(row.gapStageCounts).sort().join('|') === [...lifecycleStages].sort().join('|') &&
      Object.values(row.gapStageCounts).every(Number.isInteger) &&
      Array.isArray(row.uncoveredConceptIds) &&
      row.uncoveredConceptIds.every(id => /^[A-Za-z0-9_.:-]+$/.test(id)) &&
      row.finalVerifiedQuoteSupport.every(quote => Object.values(quote.conceptSupportFlags).every(value => typeof value === 'boolean')) &&
      ['UNRESOLVED', 'NOT_REQUIRED', 'OTHER_STATUS'].includes(row.applicationStatus)));
    assert.ok(report.transportEvents.every(event => event.httpStatus === null ||
      Number.isInteger(event.httpStatus) && event.httpStatus >= 100 && event.httpStatus <= 599));
    assert.ok(report.transportEvents.some(event => event.httpStatus === 200));
    assert.ok(await readFile(path.join(directory, V5_CONSUMED_FILENAME), 'utf8'));
    const persisted = await readFile(path.join(directory, V5_REPORT_FILENAME), 'utf8');
    assert.ok(!persisted.includes(SOURCE_SENTINEL), 'Raw mapped page text must not be serialized');
    assert.ok(!persisted.includes(FAILURE_SENTINEL));
    for (const testCase of irasResolverCases.filter(item => V5_SELECTED_CASE_IDS.includes(item.id))) {
      assert.ok(!persisted.includes(testCase.query), `${testCase.id}: raw question must not be serialized`);
      assert.ok(!persisted.includes(testCase.issues[0].subject), `${testCase.id}: raw subject must not be serialized`);
    }
    assert.deepEqual(await assertPinnedHistoricalArtifactsUnchanged(), beforeHistorical);

    // Deleting this disposable test output proves that the permanent marker,
    // rather than output collision alone, prevents a second live schedule.
    await rm(path.join(directory, V5_REPORT_FILENAME));
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
    const saved = await readFile(path.join(directory, V5_REPORT_FILENAME), 'utf8');
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
    await writeFile(path.join(collisionDirectory, V5_REPORT_FILENAME), '{"preexisting":true}\n', { flag: 'wx' });
    await expectCode(runIrasMappedEvidenceDiagnostic({ mode: 'live-source', outputDirectory: collisionDirectory,
      fetchImpl: async () => { collisionCalls += 1; return htmlResponse('sentinel'); } }), 'EEXIST');
    assert.equal(collisionCalls, 0, 'An output collision must refuse before requests');
    await assertNoFile(path.join(collisionDirectory, V5_CONSUMED_FILENAME));

    await createPlan(tamperedDirectory);
    const planPath = path.join(tamperedDirectory, V5_PLAN_FILENAME);
    const tampered = await readJson(planPath);
    tampered.preregistrationSha256 = '0'.repeat(64);
    await writeFile(planPath, `${JSON.stringify(tampered, null, 2)}\n`);
    let tamperCalls = 0;
    await expectCode(runIrasMappedEvidenceDiagnostic({ mode: 'live-source', outputDirectory: tamperedDirectory,
      fetchImpl: async () => { tamperCalls += 1; return htmlResponse('sentinel'); } }), 'PREREGISTRATION_MISMATCH');
    assert.equal(tamperCalls, 0, 'A changed preregistration hash must refuse before requests');
    await assertNoFile(path.join(tamperedDirectory, V5_CONSUMED_FILENAME));
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
    const failureOutput = await readFile(path.join(failedDirectory, V5_REPORT_FILENAME), 'utf8');
    assert.ok(!failureOutput.includes(FAILURE_SENTINEL), 'Provider error text must never be serialized');
    assert.ok(!failureOutput.includes(SOURCE_SENTINEL));
    await rm(path.join(failedDirectory, V5_REPORT_FILENAME));
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
    assert.ok(await readFile(path.join(driftDirectory, V5_CONSUMED_FILENAME), 'utf8'),
      'Fingerprint drift after reservation must retain the permanent consumed marker');
    await assertNoFile(path.join(driftDirectory, V5_REPORT_FILENAME));
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
    outputDirectory: path.resolve(V5_OUTPUT_DIRECTORY, '..'),
    fetchImpl: async () => { calls += 1; return htmlResponse('sentinel'); }
  }), /V5 diagnostic outputs must stay inside the V5 output directory/);
  assert.equal(calls, 0, 'Parent output path is refused before creating files or requesting sources');
}

await successfulPrivacyAndHistoryChecks();
strictLifecycleProjectionChecks();
topiclessConceptSelectionCheck();
await invalidPageAndClosedTransportChecks();
await collisionAndPrereqChecks();
await concurrentReservationCheck();
await failedRunReuseAndFingerprintDriftChecks();
await parentDirectoryGuardCheck();
process.stdout.write('V5 mapped-evidence diagnostic API-free safety regression passed.\n');
