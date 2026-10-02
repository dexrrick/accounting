import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildBalancedTimeoutSchedule,
  runSemanticStructuredTimeoutExperimentV2
} from '../evaluation/singapore/semantic-structured-timeout-experiment-v2.mjs';
import {
  computeIrasV2TimeoutRecommendation,
  exactTimeoutObservationCells,
  loadIrasFirstV2FinalCases,
  loadIrasFirstV2TargetedCases,
  loadIrasFirstV2TimeoutCases,
  profileConfiguration
} from '../evaluation/singapore/semantic-contract-followup-evaluation.mjs';
import { parseSemanticIntentProfileArgs } from '../evaluation/singapore/semantic-intent-followup-evaluation.mjs';
import timeoutConfig from '../evaluation/singapore/iras-first-evaluation-config-v2.json' with { type: 'json' };
import { SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA } from '../../src/services/semanticQuestionUnderstanding.ts';

const timeoutCfg = timeoutConfig.timeoutExperiment;
const timeoutProfile = 'iras-first-targeted-v2-live';
const expectedTargetedIds = [
  'target-relief-entitlement', 'target-relief-amount', 'A-paraphrase-2', 'private-expense-treatment',
  'foreign-dividend-receipt-treatment', 'corporate-residency-general-rule', 'wht-royalty-general-rule',
  'gst-input-tax-general-rule', 'unsupported-sfrsi-6-exploration-evaluation'
];
const expectedFinalIds = [
  'A-paraphrase-2', 'adversarial-C-employee-benefit', 'control-general-recognition', 'control-general-interaction',
  'A-paraphrase-3', 'dev-conceptual-illustration', 'dev-training-entitlement', 'dev-mixed-entry-total',
  'dev-corporate-filing', 'dev-investment-comparison', 'target-relief-entitlement', 'target-relief-amount'
];
const forbiddenSecrets = [
  'MEASUREMENT_PRIVATE_RAW_RESPONSE_SENTINEL',
  'synthetic-measurement-api-key-not-real',
  'https://measurement-private.invalid/source'
];

function syntheticInterpretation(testCase) {
  const issues = testCase.expected.map(expected => {
    const domain = expected.domain[0];
    return {
      subject: expected.subject,
      population: expected.population[0],
      domain,
      governingAuthorities: expected.governingAuthorities.map(authority =>
        domain === 'ACCOUNTING' && authority === 'IFRS_FOUNDATION' ? 'ACCOUNTING_STANDARDS' : authority),
      contextualAuthorities: expected.contextualAuthoritiesAnyOf[0],
      operation: expected.operation[0]
    };
  });
  return {
    mode: 'SEMANTIC_INTERPRETATION',
    interpretation: {
      requestedOperation: issues.length === 1 ? issues[0].operation : 'OTHER',
      requiresUserSpecificFacts: testCase.expectedRequiresUserSpecificFacts,
      issues
    }
  };
}

const targetedCases = await loadIrasFirstV2TargetedCases();
const finalCases = await loadIrasFirstV2FinalCases();
const timeoutCases = await loadIrasFirstV2TimeoutCases();
assert.deepEqual(targetedCases.map(testCase => testCase.id), expectedTargetedIds,
  'V2 has the fixed nine cases with general WHT/GST controls');
assert.deepEqual(finalCases.map(testCase => testCase.id), expectedFinalIds,
  'V2 final retains the exact original ten plus the two relief cases');
assert.deepEqual(timeoutCases.map(testCase => testCase.id), timeoutCfg.caseIds,
  'timeout experiment uses its frozen representative cases');
assert.equal(parseSemanticIntentProfileArgs(['--profile', 'iras-first-targeted-v2-live', '--live']), 'iras-first-targeted-v2-live');
assert.equal(parseSemanticIntentProfileArgs(['--profile', 'iras-first-final-v2-live', '--live']), 'iras-first-final-v2-live');
assert.deepEqual(targetedCases.find(testCase => testCase.id === 'wht-royalty-general-rule').expected[0].domain, ['IRAS_INCOME_TAX']);
assert.deepEqual(targetedCases.find(testCase => testCase.id === 'gst-input-tax-general-rule').expected[0].domain, ['IRAS_GST']);
assert.deepEqual(targetedCases.find(testCase => testCase.id === 'private-expense-treatment').expected[0].contextualAuthoritiesAnyOf,
  [[], ['ACCOUNTING_STANDARDS']], 'V2 preregisters the narrow contextual-authority adjudication without changing V1');
assert.equal(targetedCases.find(testCase => testCase.id === 'private-expense-treatment').expected[0].governingAuthorities[0], 'IRAS');
assert.equal(targetedCases.find(testCase => testCase.id === 'wht-royalty-general-rule').expectedRequiresUserSpecificFacts, false);
assert.equal(targetedCases.find(testCase => testCase.id === 'gst-input-tax-general-rule').expectedRequiresUserSpecificFacts, false);

const schedule = buildBalancedTimeoutSchedule();
assert.equal(schedule.length, 18);
const scheduledCellCounts = new Map();
const armPositionCounts = new Map(timeoutCfg.timeoutArmsMs.map(arm => [arm, [0, 0, 0]]));
for (const item of schedule) {
  const key = `${item.caseId}:${item.timeoutMs}`;
  scheduledCellCounts.set(key, (scheduledCellCounts.get(key) || 0) + 1);
}
for (let index = 0; index < schedule.length; index += 1) {
  const position = index % 3;
  const arm = schedule[index].timeoutMs;
  armPositionCounts.get(arm)[position] += 1;
}
for (const caseId of timeoutCfg.caseIds) {
  for (const arm of timeoutCfg.timeoutArmsMs) assert.equal(scheduledCellCounts.get(`${caseId}:${arm}`), 2);
}
for (const positions of armPositionCounts.values()) assert.deepEqual(positions, [2, 2, 2]);
assert.notEqual(schedule[0].timeoutMs, schedule[1].timeoutMs,
  'the first scheduled request is not always the 8-second arm');

const simulatedRows = [];
for (const arm of timeoutCfg.timeoutArmsMs) {
  for (const testCase of timeoutCases) {
    for (let replicate = 1; replicate <= 2; replicate += 1) {
      const shouldTimeout = arm === 8000 && replicate === 1 &&
        ['corporate-residency-general-rule', 'target-mixed-ifrs-singapore-accounting'].includes(testCase.id);
      simulatedRows.push({
        caseId: testCase.id,
        timeoutMs: arm,
        replicate,
        outcome: shouldTimeout ? 'TIMEOUT' : 'RESPONSE_RECEIVED',
        responseReceived: !shouldTimeout,
        validInterpretation: !shouldTimeout,
        semanticCorrect: !shouldTimeout,
        ...(shouldTimeout ? { timeoutCensoredDurationMs: 8000 } : { completionLatencyMs: arm === 8000 ? 7200 : 9000 })
      });
    }
  }
}
const preregisteredRecommendation = computeIrasV2TimeoutRecommendation(simulatedRows, true);
assert.equal(preregisteredRecommendation.selectedTimeoutMs, 12000,
  'the policy selects the shortest arm meeting the valid-completion, timeout-reduction, and validity conditions');

const tempRoot = os.tmpdir();
const scratch = await mkdtemp(path.join(tempRoot, 'iras-v2-measurement-safety-'));
const resolvedTemp = path.resolve(tempRoot);
const resolvedScratch = path.resolve(scratch);
assert.equal(path.dirname(resolvedScratch), resolvedTemp, 'temporary measurement output is directly inside the system temp directory');

function buildFakeHarness({ varyPrompt = false } = {}) {
  let monotonic = 20_000;
  let activeCase;
  let perCellCounts = new Map();
  let transportCalls = 0;
  const byQuestion = new Map(timeoutCases.map(testCase => [testCase.question, testCase]));
  const execute = async (prompt, system, provider, options) => {
    transportCalls += 1;
    assert.equal(provider.activeProvider, 'gemini');
    assert.equal(provider.gemini.model, timeoutConfig.timeoutExperiment.model);
    assert.equal(Object.keys(options).sort().join(','), 'jsonMode,responseJsonSchema,temperature,timeoutMs');
    assert.equal(options.jsonMode, true);
    assert.equal(options.temperature, 0);
    assert.deepEqual(options.responseJsonSchema, SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA);
    assert.ok(timeoutCfg.timeoutArmsMs.includes(options.timeoutMs), 'the timeout override equals a scheduled arm');
    assert.equal(system, 'FIXED_SYNTHETIC_SYSTEM');
    assert.match(prompt, /^FIXED_SYNTHETIC_PROMPT:/);
    const key = `${activeCase.id}:${options.timeoutMs}`;
    const count = (perCellCounts.get(key) || 0) + 1;
    perCellCounts.set(key, count);
    if (options.timeoutMs === 8000 && count === 1 &&
        ['corporate-residency-general-rule', 'target-mixed-ifrs-singapore-accounting'].includes(activeCase.id)) {
      monotonic += options.timeoutMs;
      throw new Error(`request timed out ${forbiddenSecrets[0]}`);
    }
    monotonic += options.timeoutMs === 8000 ? 7200 : 9000;
    if (varyPrompt && activeCase.id === 'corporate-residency-general-rule' && options.timeoutMs === 12000) {
      assert.notEqual(prompt, `FIXED_SYNTHETIC_PROMPT:${activeCase.id}`);
    }
    return JSON.stringify({ safe: false, body: forbiddenSecrets[0] });
  };
  const interpret = async (question, _provider, callStructured) => {
    activeCase = byQuestion.get(question);
    if (!activeCase) throw new Error('Unexpected query.');
    const prompt = `FIXED_SYNTHETIC_PROMPT:${activeCase.id}${varyPrompt && activeCase.id === 'corporate-residency-general-rule' ? `:${monotonic}` : ''}`;
    try {
      await callStructured(prompt, 'FIXED_SYNTHETIC_SYSTEM', _provider, {
        jsonMode: true,
        responseJsonSchema: SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA,
        timeoutMs: 8000,
        temperature: 0
      });
    } catch (error) {
      return { mode: 'DETERMINISTIC_FALLBACK', failure: /timed\s*out|timeout/i.test(error.message) ? 'TIMEOUT' : 'PROVIDER_ERROR' };
    }
    return syntheticInterpretation(activeCase);
  };
  return {
    execute,
    interpret,
    transportCalls: () => transportCalls,
    sleep: async milliseconds => { monotonic += milliseconds; },
    monotonicNow: () => monotonic,
    now: () => new Date('2026-10-02T00:00:00.000Z')
  };
}

try {
  const outputDirectory = path.join(scratch, 'fake-capture');
  const harness = buildFakeHarness();
  const fakeKey = 'synthetic-measurement-api-key-not-real';
  const result = await runSemanticStructuredTimeoutExperimentV2({
    live: true,
    apiKey: fakeKey,
    outputDirectory,
    execute: harness.execute,
    interpret: harness.interpret,
    sleep: harness.sleep,
    monotonicNow: harness.monotonicNow,
    now: harness.now
  });
  assert.equal(harness.transportCalls(), 18, 'each scheduled call makes exactly one fake transport request');
  assert.equal(result.requestCount, 18);
  assert.equal(result.minimumObservedStartGapMs >= 15_250, true);
  assert.deepEqual(result.timeoutRecommendation, preregisteredRecommendation,
    'the saved recommendation is computed from observation rows, not selected post hoc');
  assert.equal(result.timeoutRecommendation.selectedTimeoutMs, 12000);
  assert.equal(exactTimeoutObservationCells(result.observations), true,
    'the strict artifact checker accepts exactly one marked first request and subsequent paced rows');
  const unmarkedFirstRequest = result.observations.map(item => ({ ...item }));
  delete unmarkedFirstRequest[0].firstRequest;
  assert.equal(exactTimeoutObservationCells(unmarkedFirstRequest), false,
    'the artifact checker rejects a missing first-request marker');
  const extraFirstRequestMarker = result.observations.map(item => ({ ...item }));
  extraFirstRequestMarker[1].firstRequest = true;
  assert.equal(exactTimeoutObservationCells(extraFirstRequestMarker), false,
    'the artifact checker rejects the first-request marker on later rows');
  const timeoutObservationIndex = result.observations.findIndex(item => item.outcome === 'TIMEOUT');
  const forgedValidTimeout = result.observations.map(item => ({ ...item }));
  forgedValidTimeout[timeoutObservationIndex].validInterpretation = true;
  forgedValidTimeout[timeoutObservationIndex].semanticCorrect = true;
  assert.equal(exactTimeoutObservationCells(forgedValidTimeout), false,
    'the artifact checker rejects a valid and semantically correct timeout row');
  const receivedObservationIndex = result.observations.findIndex(item => item.responseReceived);
  const forgedValidFailureCode = result.observations.map(item => ({ ...item }));
  forgedValidFailureCode[receivedObservationIndex].failureCode = 'INVALID_RESPONSE';
  assert.equal(exactTimeoutObservationCells(forgedValidFailureCode), false,
    'the artifact checker rejects a valid interpretation carrying a failure code');
  const timeoutWithResponseDescriptors = result.observations.map(item => ({ ...item }));
  Object.assign(timeoutWithResponseDescriptors[timeoutObservationIndex], {
    issueCount: 1, outputBytes: 1, responseChars: 1
  });
  assert.equal(exactTimeoutObservationCells(timeoutWithResponseDescriptors), false,
    'the artifact checker rejects response and issue descriptors on a nonreceived timeout');
  assert.equal(Object.values(result.armSummaries).every(item => item.scheduledCount === 6), true,
    'every arm keeps all six scheduled calls in its denominator');
  assert.equal(result.armSummaries[8000].timeoutCount, 2);
  assert.equal(result.armSummaries[8000].completionLatencyMs.count, 4,
    '8-second timeouts are excluded from completion latency');
  assert.equal(result.armSummaries[8000].timeoutCensoredDurationMs.count, 2,
    '8-second timeout durations are reported separately as censored observations');
  assert.equal(result.armSummaries[8000].descriptiveInputsAmongReceivedResponses.outputBytesForNonemptyResponses.count, 4,
    'timeouts do not enter output-size correlations as zero-byte rows');
  assert.equal(result.schemaComplexity.uniqueSchemas, 1);
  assert.match(result.schemaComplexity.relationshipToLatency, /not identifiable/i);
  for (const caseId of timeoutCfg.caseIds) {
    const rows = result.observations.filter(item => item.caseId === caseId);
    assert.equal(new Set(rows.map(item => item.timeoutMs)).size, 3);
    assert.equal(new Set(rows.map(() => result.promptSchemaFingerprints[caseId].promptSha256)).size, 1);
  }
  assert.equal(result.observations.filter(item => item.outcome === 'TIMEOUT').every(item =>
    !Object.hasOwn(item, 'completionLatencyMs') && !Object.hasOwn(item, 'outputBytes') && Object.hasOwn(item, 'timeoutCensoredDurationMs')), true);

  const jsonPath = path.join(outputDirectory, `${timeoutCfg.outputPrefix}.json`);
  const mdPath = path.join(outputDirectory, `${timeoutCfg.outputPrefix}.md`);
  const jsonText = await readFile(jsonPath, 'utf8');
  const mdText = await readFile(mdPath, 'utf8');
  for (const forbidden of forbiddenSecrets) {
    assert.equal(jsonText.includes(forbidden), false, 'JSON output excludes private query/provider/source payloads');
    assert.equal(mdText.includes(forbidden), false, 'Markdown output excludes private query/provider/source payloads');
  }
  const serialized = JSON.parse(jsonText);
  assert.equal('questions' in serialized, false);
  assert.equal('rawResponses' in serialized, false);
  assert.equal('apiKey' in serialized, false);
  let overwriteCalls = 0;
  await assert.rejects(runSemanticStructuredTimeoutExperimentV2({
    live: true, apiKey: fakeKey, outputDirectory, execute: async () => { overwriteCalls += 1; return ''; }
  }), /output file already exists/);
  assert.equal(overwriteCalls, 0, 'the experiment refuses to overwrite any existing result');

  const fingerprintFailureDir = path.join(scratch, 'fingerprint-failure');
  let sourceManifestCalls = 0;
  let forbiddenProviderCalls = 0;
  const profile = profileConfiguration(timeoutProfile);
  const driftingManifest = async files => {
    const manifest = Object.fromEntries(Object.keys(files).map(key => [key, 'a'.repeat(64)]));
    if (Object.hasOwn(files, 'semanticInterpretation')) {
      sourceManifestCalls += 1;
      if (sourceManifestCalls >= 2) manifest.semanticInterpretation = 'b'.repeat(64);
    }
    return manifest;
  };
  await assert.rejects(runSemanticStructuredTimeoutExperimentV2({
    live: true,
    apiKey: fakeKey,
    outputDirectory: fingerprintFailureDir,
    execute: async () => { forbiddenProviderCalls += 1; return 'should not run'; },
    hashManifestFn: driftingManifest,
    verifyProtectedArtifacts: async () => ({ baselineCommit: '4bd3abc9c22619401f22aa8abba73af61b5d6217', artifactCount: 118, verified: true })
  }), /fingerprint changed during the experiment/);
  assert.equal(forbiddenProviderCalls, 0, 'a changed fingerprint blocks the first provider request');
  assert.ok(Object.keys(profile.sourceFiles).includes('semanticInterpretation'));

  const promptMutationDir = path.join(scratch, 'prompt-mutation');
  const promptMutationHarness = buildFakeHarness({ varyPrompt: true });
  await assert.rejects(runSemanticStructuredTimeoutExperimentV2({
    live: true,
    apiKey: fakeKey,
    outputDirectory: promptMutationDir,
    execute: promptMutationHarness.execute,
    interpret: promptMutationHarness.interpret,
    sleep: promptMutationHarness.sleep,
    monotonicNow: promptMutationHarness.monotonicNow,
    now: promptMutationHarness.now,
    verifyProtectedArtifacts: async () => ({ baselineCommit: '4bd3abc9c22619401f22aa8abba73af61b5d6217', artifactCount: 118, verified: true })
  }), /one correctly paced request/);
  assert.ok(promptMutationHarness.transportCalls() < 18,
    'a prompt change across timeout arms halts the run before the fixed schedule completes');

  const noRequestDir = path.join(scratch, 'missing-request');
  await assert.rejects(runSemanticStructuredTimeoutExperimentV2({
    live: true, apiKey: fakeKey, outputDirectory: noRequestDir,
    interpret: async () => ({ mode: 'DETERMINISTIC_FALLBACK', failure: 'PROVIDER_ERROR' }),
    execute: async () => 'unused',
    sleep: async () => {}, monotonicNow: () => 100,
    verifyProtectedArtifacts: async () => ({ baselineCommit: '4bd3abc9c22619401f22aa8abba73af61b5d6217', artifactCount: 118, verified: true })
  }), /one correctly paced request/);

  const invalidOptionsDir = path.join(scratch, 'invalid-options');
  const invalidOptions = buildFakeHarness();
  await assert.rejects(runSemanticStructuredTimeoutExperimentV2({
    live: true, apiKey: fakeKey, outputDirectory: invalidOptionsDir,
    execute: invalidOptions.execute,
    interpret: async (question, settings, callStructured) => {
      const testCase = timeoutCases.find(item => item.question === question);
      return callStructured(`FIXED_SYNTHETIC_PROMPT:${testCase.id}`, 'FIXED_SYNTHETIC_SYSTEM', settings, {
        jsonMode: true, responseJsonSchema: { ...SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA, extra: true },
        timeoutMs: 8000, temperature: 0
      });
    },
    sleep: invalidOptions.sleep, monotonicNow: invalidOptions.monotonicNow,
    verifyProtectedArtifacts: async () => ({ baselineCommit: '4bd3abc9c22619401f22aa8abba73af61b5d6217', artifactCount: 118, verified: true })
  }), /one correctly paced request/);

  await assert.rejects(runSemanticStructuredTimeoutExperimentV2({ live: false }), /requires --live/);
} finally {
  if (path.dirname(path.resolve(scratch)) !== resolvedTemp || !path.basename(scratch).startsWith('iras-v2-measurement-safety-')) {
    throw new Error('Refusing to remove an unexpected measurement safety directory.');
  }
  await rm(scratch, { recursive: true, force: true });
}

console.log('IRAS-first V2 fixed-profile and structured-timeout experiment safety regressions passed.');
