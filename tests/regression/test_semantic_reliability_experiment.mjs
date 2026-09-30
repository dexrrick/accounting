import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  assertFreshOutputPaths,
  assertResumeCompatible,
  buildExperimentPlan,
  buildExperimentSchedule,
  classifyStructuredResponse,
  classifyTransportError,
  experimentCasesFromFixture,
  hashRelevantSources,
  MIN_REQUEST_START_INTERVAL_MS,
  runReliabilityExperiment,
  summarizeExperiment,
  validateOutputPrefix,
  writeReportAtomically
} from '../evaluation/singapore/semantic-reliability-experiment.mjs';

const fixtureBytes = await readFile(new URL('../evaluation/singapore/multi-authority-workstreams-corrected.json', import.meta.url));
const fixture = JSON.parse(fixtureBytes.toString('utf8'));
const cases = experimentCasesFromFixture(fixture);
const fixtureSha256 = 'fixture-test-sha256';
const sourceHashes = { semanticQuestionUnderstanding: 'source-a', aiTransport: 'source-b' };
const experimentPlan = buildExperimentPlan({ fixtureSha256, sourceHashes, cases });
const schedule = buildExperimentSchedule(cases);
const summaryMetadata = {
  fixtureSha256,
  sourceHashes,
  plan: experimentPlan.plan,
  planSha256: experimentPlan.planSha256,
  schedule,
  startedAt: new Date(0).toISOString()
};

assert.equal(schedule.length, 16);
for (const testCase of cases) {
  const caseSchedule = schedule.filter(item => item.caseId === testCase.id);
  assert.deepEqual(caseSchedule.map(item => item.observation), [1, 1, 2, 2]);
  assert.deepEqual(caseSchedule.slice(2).map(item => item.timeoutMs), [...caseSchedule.slice(0, 2)].map(item => item.timeoutMs).reverse());
}
assert.equal(validateOutputPrefix('semantic-reliability-unit'), 'semantic-reliability-unit');
assert.throws(() => validateOutputPrefix('live-semantic-evaluation'), /reserved/);
assert.throws(() => validateOutputPrefix('OPERATION-RELIABILITY-BASELINE-INSPECTION'), /reserved/);
assert.equal(classifyStructuredResponse('not json').category, 'MALFORMED_JSON');
assert.equal(classifyStructuredResponse(JSON.stringify({ unexpected: true })).category, 'SCHEMA_REJECTION');
assert.equal(classifyStructuredResponse('x'.repeat(16_001)).category, 'RESPONSE_TOO_LARGE');
const accountingAuthorityMismatch = {
  jurisdiction: ['Singapore'], authorityCandidates: ['IRAS'], contextualAuthorities: [], domain: 'ACCOUNTING', population: 'UNKNOWN',
  primarySubject: 'accounting issue', concepts: [], requestedOperation: 'OTHER', requiresUserSpecificFacts: false,
  calculationRequested: false, factsExplicitlyProvided: [], confidence: 0.96
};
assert.equal(classifyStructuredResponse(JSON.stringify(accountingAuthorityMismatch)).category, 'CONTRADICTORY_FIELDS');
const unknownDomainJournal = {
  jurisdiction: ['Singapore'], authorityCandidates: ['UNKNOWN'], contextualAuthorities: [], domain: 'UNKNOWN', population: 'UNKNOWN',
  primarySubject: 'journal issue', concepts: [], requestedOperation: 'OTHER', requiresUserSpecificFacts: false,
  calculationRequested: false, factsExplicitlyProvided: [], confidence: 0.96,
  issues: [{ subject: 'journal issue', population: 'UNKNOWN', domain: 'UNKNOWN', governingAuthorities: ['ACCOUNTING_STANDARDS'],
    contextualAuthorities: [], operation: 'PREPARE_JOURNAL', mappedTopicIds: [], evidenceRequirement: 'UNRESOLVED', confidence: 0.96 }]
};
assert.equal(classifyStructuredResponse(JSON.stringify(unknownDomainJournal)).category, 'CONTRADICTORY_FIELDS');
assert.equal(classifyTransportError(new Error('Gemini API request failed with HTTP 429.')).category, 'HTTP_429');
assert.equal(classifyTransportError(new Error('The request timed out.')).category, 'TRANSPORT_TIMEOUT');
const noObservations = summarizeExperiment([], summaryMetadata);
assert.equal(noObservations.caseArmSignatureComparisons[0].arms['8000'].stable, null);
assert.equal(noObservations.caseArmSignatureComparisons[0].timeoutArmsDiffer, null);
const partialObservations = schedule.slice(0, 2).map((item, index) => ({
  ...item,
  validInterpretation: true,
  semanticSignatureSha256: `partial-${index}`
}));
const partialSummary = summarizeExperiment(partialObservations, summaryMetadata);
assert.equal(partialSummary.caseArmSignatureComparisons[0].arms['8000'].stable, null,
  'one valid observation is insufficient to claim stability');
assert.equal(partialSummary.caseArmSignatureComparisons[0].timeoutArmsDiffer, null);
const invalidObservations = schedule.map(item => ({
  ...item,
  validInterpretation: false,
  semanticFailure: 'INVALID_RESPONSE',
  responseDiagnostic: { category: 'SCHEMA_REJECTION' },
  semanticSignatureSha256: null,
  latencyMs: 10,
  dimensionScores: {}
}));
const invalidSummary = summarizeExperiment(invalidObservations, summaryMetadata);
assert.equal(invalidSummary.caseArmSignatureComparisons[0].arms['8000'].stable, null,
  'two invalid observations remain unassessed, not stable');
assert.equal(invalidSummary.caseArmSignatureComparisons[0].timeoutArmsDiffer, null);

function payloadFor(testCase, { contradictory = false, confidence = 0.96 } = {}) {
  const issues = testCase.expected.map(issue => ({
    subject: issue.subject,
    population: issue.population[0],
    domain: issue.domain[0],
    governingAuthorities: issue.governingAuthorities,
    contextualAuthorities: issue.contextualAuthoritiesAnyOf[0],
    operation: issue.operation[0],
    mappedTopicIds: [],
    evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS',
    confidence: 0.96
  }));
  return {
    jurisdiction: ['Singapore'],
    authorityCandidates: ['UNKNOWN'],
    contextualAuthorities: [],
    domain: 'UNKNOWN',
    population: 'UNKNOWN',
    primarySubject: 'material requested outcomes',
    concepts: [],
    requestedOperation: contradictory ? 'CALCULATE' : 'OTHER',
    requiresUserSpecificFacts: false,
    calculationRequested: false,
    factsExplicitlyProvided: [],
    confidence,
    issues
  };
}

const caseByQuestion = new Map(cases.map(testCase => [testCase.question, testCase]));
let fakeNow = 1_790_000_000_000;
let responseIndexByCase = new Map();
const requests = [];
const sleeps = [];
const snapshots = [];
const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'semantic-reliability-test-'));
const fakeProvider = 'TEST-PRIVATE-API-KEY-NEVER-PERSIST';
const rawSentinel = 'SECRET_RAW_PROVIDER_BODY_SENTINEL';

try {
  const report = await runReliabilityExperiment({
    fixture,
    provider: fakeProvider,
    fixtureSha256,
    sourceHashes,
    plan: experimentPlan.plan,
    planSha256: experimentPlan.planSha256,
    schedule,
    startedAt: new Date(fakeNow).toISOString(),
    readCurrentSourceHashes: async () => sourceHashes,
    clock: {
      nowEpochMs: () => fakeNow,
      monotonicNowMs: () => fakeNow,
      nowIso: () => new Date(fakeNow).toISOString(),
      sleep: async milliseconds => { sleeps.push(milliseconds); fakeNow += milliseconds; }
    },
    structuredCall: async (prompt, _system, provider, options) => {
      assert.equal(provider, fakeProvider);
      const question = prompt.slice(prompt.lastIndexOf('Interpret this question:\n') + 'Interpret this question:\n'.length);
      const testCase = caseByQuestion.get(question);
      assert.ok(testCase, 'the mock recognizes the fixture case in memory');
      const responseIndex = responseIndexByCase.get(testCase.id) || 0;
      responseIndexByCase.set(testCase.id, responseIndex + 1);
      requests.push({ caseId: testCase.id, timeoutMs: options.timeoutMs, model: options.model, temperature: options.temperature });
      fakeNow += 100;

      if (testCase.id === 'A-paraphrase-3' && responseIndex === 2) return `invalid ${rawSentinel}`;
      if (testCase.id === 'A-paraphrase-3' && responseIndex === 3) return JSON.stringify({ unexpected: true });
      if (testCase.id === 'A-paraphrase-4' && responseIndex === 0) return JSON.stringify(payloadFor(testCase, { contradictory: true }));
      if (testCase.id === 'A-paraphrase-4' && responseIndex === 1) return 'x'.repeat(16_001);
      if (testCase.id === 'A-paraphrase-4' && responseIndex === 2) throw new Error(`Gemini API request failed with HTTP 429. ${rawSentinel}`);
      if (testCase.id === 'A-paraphrase-4' && responseIndex === 3) throw new Error(`Request timed out: ${rawSentinel}`);
      if (testCase.id === 'D-original' && responseIndex === 0) return JSON.stringify(payloadFor(testCase, { confidence: 0.5 }));
      return JSON.stringify(payloadFor(testCase));
    },
    onOutcome: async snapshot => {
      snapshots.push(snapshot.calls.length);
      await writeReportAtomically(outputDirectory, 'semantic-reliability-unit', snapshot);
    }
  });

  assert.equal(report.summary.complete, true);
  assert.equal(report.summary.scheduledRequests, 16);
  assert.equal(report.summary.completedRequests, 16);
  assert.equal(requests.length, 16, 'each scheduled observation invokes the provider boundary once, without retries');
  assert.deepEqual(snapshots, Array.from({ length: 16 }, (_, index) => index + 1), 'each observed result is persisted through the callback');
  assert.equal(sleeps.length, 15);
  assert.ok(sleeps.every(milliseconds => milliseconds === 15_150), '100ms mock requests plus pacing meet the 15,250ms start interval');
  const requestStarts = report.calls.map(call => Date.parse(call.requestStartedAt));
  assert.ok(requestStarts.slice(1).every((start, index) => start - requestStarts[index] >= MIN_REQUEST_START_INTERVAL_MS));
  assert.deepEqual(requests.map(request => request.timeoutMs), schedule.map(item => item.timeoutMs));
  assert.ok(requests.every(request => request.model === 'gemini-3.5-flash-lite' && request.temperature === 0));
  assert.ok(report.calls.every(call => call.sourceHashStable));
  assert.equal(report.calls[0].completeQuestionIssueCoverage, true);
  assert.equal(report.calls[0].issueRecall.correct, report.calls[0].expectedIssueCount);
  assert.equal(report.calls[0].routingDiagnostic, null);
  assert.equal(report.calls[2].responseDiagnostic.category, 'MALFORMED_JSON');
  assert.equal(report.calls[3].responseDiagnostic.category, 'SCHEMA_REJECTION');
  assert.equal(report.calls[4].responseDiagnostic.category, 'CONTRADICTORY_FIELDS');
  assert.equal(report.calls[5].responseDiagnostic.category, 'RESPONSE_TOO_LARGE');
  assert.equal(report.calls[6].transportDiagnostic.category, 'HTTP_429');
  assert.equal(report.calls[7].transportDiagnostic.category, 'TRANSPORT_TIMEOUT');
  assert.equal(report.calls[8].semanticFailure, 'LOW_CONFIDENCE');
  const incompleteCaseStability = report.summary.caseArmSignatureComparisons.find(item => item.caseId === 'A-paraphrase-3');
  assert.equal(incompleteCaseStability.arms['8000'].stable, null);
  assert.equal(incompleteCaseStability.timeoutArmsDiffer, null);
  const completeCaseStability = report.summary.caseArmSignatureComparisons.find(item => item.caseId === 'D-paraphrase-1');
  assert.equal(completeCaseStability.arms['8000'].assessed, true);
  assert.equal(typeof completeCaseStability.arms['8000'].stable, 'boolean');
  assert.equal(report.calls[0].promptChars > 0, true);
  assert.equal(report.calls[0].promptSha256.length, 64);
  assert.equal(report.calls[0].actualIssueDimensions.some(issue => Object.hasOwn(issue, 'subject')), false);
  assert.equal(report.calls[0].expectedIssueMatches.every(match => Number.isInteger(match.modelIssueIndex)), true);

  const jsonPath = path.join(outputDirectory, 'semantic-reliability-unit.json');
  const markdownPath = path.join(outputDirectory, 'semantic-reliability-unit.md');
  const persistedText = `${await readFile(jsonPath, 'utf8')}\n${await readFile(markdownPath, 'utf8')}`;
  for (const privateText of [fakeProvider, rawSentinel, 'SGD 6,000', 'Interpret this question:', cases[0].question, cases[0].expected[0].subject]) {
    assert.equal(persistedText.includes(privateText), false, `persisted report excludes ${privateText}`);
  }
  assert.equal(report.calls.some(call => Object.hasOwn(call, 'question') || Object.hasOwn(call, 'prompt') || Object.hasOwn(call, 'facts')), false);

  let hashReads = 0;
  let sourceChangeRequests = 0;
  const sourceChangeSnapshots = [];
  await assert.rejects(() => runReliabilityExperiment({
    fixture,
    provider: fakeProvider,
    fixtureSha256,
    sourceHashes,
    plan: experimentPlan.plan,
    planSha256: experimentPlan.planSha256,
    schedule: [schedule[0]],
    readCurrentSourceHashes: async () => (++hashReads === 1 ? sourceHashes : { ...sourceHashes, aiTransport: 'changed-mid-call' }),
    clock: { nowEpochMs: () => 0, monotonicNowMs: () => 0, nowIso: () => new Date(0).toISOString(), sleep: async () => {} },
    structuredCall: async prompt => {
      sourceChangeRequests += 1;
      const question = prompt.slice(prompt.lastIndexOf('Interpret this question:\n') + 'Interpret this question:\n'.length);
      return JSON.stringify(payloadFor(caseByQuestion.get(question)));
    },
    onOutcome: async snapshot => sourceChangeSnapshots.push(snapshot)
  }), /source changed during the experiment/);
  assert.equal(sourceChangeRequests, 1);
  assert.equal(sourceChangeSnapshots.length, 1, 'the changed-source outcome is saved before the run stops');
  assert.equal(sourceChangeSnapshots[0].calls[0].sourceHashStable, false);

  assertResumeCompatible(report, experimentPlan);
  const incompatiblePlan = buildExperimentPlan({ fixtureSha256, sourceHashes: { ...sourceHashes, aiTransport: 'changed' }, cases });
  assert.throws(() => assertResumeCompatible(report, incompatiblePlan), /does not match/);
  await assertFreshOutputPaths(outputDirectory, 'unused-prefix');
  await assert.rejects(() => assertFreshOutputPaths(outputDirectory, 'semantic-reliability-unit'), /Refusing to overwrite/);

  let resumedCalls = 0;
  responseIndexByCase = new Map();
  fakeNow = Date.parse(report.calls[0].requestStartedAt) + 1_000;
  const partiallyResumed = await runReliabilityExperiment({
    fixture,
    provider: fakeProvider,
    fixtureSha256,
    sourceHashes,
    plan: experimentPlan.plan,
    planSha256: experimentPlan.planSha256,
    schedule: schedule.slice(0, 2),
    startedAt: report.summary.startedAt,
    savedCalls: report.calls.slice(0, 1),
    readCurrentSourceHashes: async () => sourceHashes,
    clock: {
      nowEpochMs: () => fakeNow,
      monotonicNowMs: () => fakeNow,
      nowIso: () => new Date(fakeNow).toISOString(),
      sleep: async milliseconds => { fakeNow += milliseconds; }
    },
    structuredCall: async (prompt) => {
      resumedCalls += 1;
      const question = prompt.slice(prompt.lastIndexOf('Interpret this question:\n') + 'Interpret this question:\n'.length);
      return JSON.stringify(payloadFor(caseByQuestion.get(question)));
    }
  });
  assert.equal(resumedCalls, 1, 'resume skips the one already persisted observation');
  assert.deepEqual(partiallyResumed.calls.map(call => call.callId), schedule.slice(0, 2).map(item => item.callId));
  assert.equal(partiallyResumed.summary.complete, true);

  const resumed = await runReliabilityExperiment({
    fixture,
    provider: fakeProvider,
    fixtureSha256,
    sourceHashes,
    plan: experimentPlan.plan,
    planSha256: experimentPlan.planSha256,
    schedule,
    startedAt: report.summary.startedAt,
    savedCalls: report.calls,
    readCurrentSourceHashes: async () => sourceHashes,
    structuredCall: async () => { resumedCalls += 1; throw new Error('a complete checkpoint should issue no requests'); }
  });
  assert.equal(resumedCalls, 1);
  assert.equal(resumed.summary.complete, true);
  assert.equal(resumed.summary.startedAt, report.summary.startedAt);
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}

console.log('Semantic reliability experiment regressions passed.');
