import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import v3Config from '../evaluation/singapore/semantic-residency-diagnostic-v3-config.json' with { type: 'json' };
import v4Config from '../evaluation/singapore/semantic-residency-subject-diagnostic-v4-config.json' with { type: 'json' };
import {
  runSemanticResidencySubjectDiagnosticV4,
  verifyResidencyV3HistoricalArtifacts
} from '../evaluation/singapore/semantic-residency-subject-diagnostic-v4-runner.mjs';
import {
  deriveResidencySubjectFeatures,
  diagnoseResidencySubject
} from '../evaluation/singapore/semantic-residency-subject-diagnostic-v4.mjs';
import { matchIssues } from '../evaluation/singapore/multi-authority-issue-scoring.mjs';
import { SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA } from '../../src/services/semanticQuestionUnderstanding.ts';

const scratchRoot = await mkdtemp(path.join(os.tmpdir(), 'semantic-residency-subject-v4-'));
const resolvedTemp = path.resolve(os.tmpdir());
if (path.dirname(path.resolve(scratchRoot)) !== resolvedTemp || !path.basename(scratchRoot).startsWith('semantic-residency-subject-v4-')) {
  throw new Error('Refusing to use an unexpected V4 residency diagnostic safety directory.');
}

const privateSentinels = [
  'SYNTHETIC_PRIVATE_SUBJECT_ENTITY_7F2A',
  'SYNTHETIC_PRIVATE_QUESTION_91BC',
  'SYNTHETIC_PRIVATE_FACT_5D03',
  'https://synthetic-private-residency.invalid/source?query=SECRET',
  'synthetic-private-api-credential-DO-NOT-STORE'
];
const fixedBaseline = {
  baselineSha256: '346ff7580ea716a051de54bbede0be7c0689894ef1c87568688992d87fbb5700',
  protectedArtifactCount: 125
};
const verificationHooks = {
  verifyProtectedArtifacts: async () => ({ ...fixedBaseline }),
  verifyHistoricalArtifacts: async () => ({ verified: true, artifactCount: 5 })
};

function buildHarness(kind) {
  let monotonic = 0;
  let transportCalls = 0;
  let sleepCalls = 0;
  const starts = [];
  const execute = async () => {
    transportCalls += 1;
    starts.push(monotonic);
    monotonic += 25;
    if (kind === 'timeout') throw new Error(`${privateSentinels[4]} request timed out`);
    if (kind === 'error') throw new Error(`${privateSentinels[4]} unexpected provider detail`);
    if (kind === 'invalid') return `not-json ${privateSentinels.join(' ')}`;
    return JSON.stringify({
      schemaVersion: 2,
      primarySubject: `${privateSentinels[0]} corporate tax-residency profile in SG`,
      query: privateSentinels[1],
      factsExplicitlyProvided: [privateSentinels[2]],
      sourceUrl: privateSentinels[3],
      providerCredential: privateSentinels[4]
    });
  };
  const interpret = async (questionText, provider, callStructured) => {
    const question = v3Config.questions.find(item => item.question === questionText);
    assert.ok(question, 'the runner uses only the three frozen V3 questions');
    const raw = await callStructured(
      `\n\nInterpret this question:\n${questionText}`,
      'synthetic fixed system instructions',
      provider,
      {
        jsonMode: true,
        responseJsonSchema: SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA,
        temperature: 0,
        timeoutMs: 8000
      }
    );
    assert.equal(typeof raw, 'string', 'synthetic model envelopes pass through the injected transport');
    if (kind === 'invalid') return { mode: 'DETERMINISTIC_FALLBACK', failure: 'INVALID_RESPONSE' };
    const expected = question.expected;
    return {
      mode: 'SEMANTIC_INTERPRETATION',
      interpretation: {
        requestedOperation: expected.rootOperation[0],
        population: expected.rootPopulation[0],
        domain: expected.rootDomain[0],
        authorityCandidates: [...expected.rootAuthorities],
        contextualAuthorities: [],
        requiresUserSpecificFacts: expected.requiresUserSpecificFacts,
        issues: [{
          subject: kind === 'exact' ? expected.issues[0].subject
            : `${privateSentinels[0]} corporate tax residence in SG; strategic decisions`,
          operation: expected.issues[0].operation[0],
          population: expected.issues[0].population[0],
          domain: expected.issues[0].domain[0],
          governingAuthorities: [...expected.issues[0].governingAuthorities],
          contextualAuthorities: []
        }]
      }
    };
  };
  return {
    execute,
    interpret,
    sleep: async milliseconds => { sleepCalls += 1; monotonic += milliseconds; },
    monotonicNow: () => monotonic,
    transportCalls: () => transportCalls,
    sleepCalls: () => sleepCalls,
    starts
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function preregister(outputDirectory) {
  return runSemanticResidencySubjectDiagnosticV4({ mode: 'plan', outputDirectory, ...verificationHooks });
}

async function runLive(kind, outputDirectory, extra = {}) {
  const harness = buildHarness(kind);
  const result = await runSemanticResidencySubjectDiagnosticV4({
    mode: 'live',
    apiKey: privateSentinels[4],
    outputDirectory,
    execute: harness.execute,
    interpret: harness.interpret,
    sleep: harness.sleep,
    monotonicNow: harness.monotonicNow,
    now: () => new Date('2026-10-02T00:00:00.000Z'),
    ...verificationHooks,
    ...extra
  });
  return { result, harness };
}

function findPrivateKeys(value, pathName = '$') {
  if (Array.isArray(value)) return value.flatMap((item, index) => findPrivateKeys(item, `${pathName}[${index}]`));
  if (!value || typeof value !== 'object') return [];
  const disallowedKeys = new Set([
    'question', 'subject', 'query', 'factsExplicitlyProvided', 'facts', 'rawResponse', 'response', 'prompt',
    'system', 'apiKey', 'providerCredential', 'url', 'sourceUrl', 'error', 'message'
  ]);
  return Object.entries(value).flatMap(([key, child]) => [
    ...(disallowedKeys.has(key) ? [`${pathName}.${key}`] : []),
    ...findPrivateKeys(child, `${pathName}.${key}`)
  ]);
}

try {
  assert.deepEqual(v4Config.questionIds, v3Config.questionIds);
  assert.deepEqual(v4Config.schedule.map(row => row.questionId), [
    'corporate-residency-original-general',
    'corporate-residency-general-paraphrase',
    'corporate-residency-case-applied-control',
    'corporate-residency-case-applied-control',
    'corporate-residency-general-paraphrase',
    'corporate-residency-original-general'
  ]);
  assert.equal(v4Config.schedule.length, 6);
  for (const questionId of v4Config.questionIds) {
    assert.equal(v4Config.schedule.filter(item => item.questionId === questionId).length, 2);
  }

  const equivalentA = deriveResidencySubjectFeatures('SYNTHETIC_ENTITY_A corporate tax residence in SG');
  const equivalentB = deriveResidencySubjectFeatures('SYNTHETIC_ENTITY_B corporation tax resident Singapore');
  assert.deepEqual(equivalentA.concepts, equivalentB.concepts);
  assert.equal(equivalentA.conceptBitVectorSha256, equivalentB.conceptBitVectorSha256,
    'the subject fingerprint hashes only the fixed allowlisted concept-bit vector');
  assert.match(equivalentA.conceptBitVectorSha256, /^[a-f0-9]{64}$/);
  assert.equal(deriveResidencySubjectFeatures('COR').concepts.CERTIFICATE_RESIDENCE, false,
    'COR alone does not imply residence context');
  assert.equal(deriveResidencySubjectFeatures('COR resident').concepts.CERTIFICATE_RESIDENCE, true,
    'COR is recognized only when residence context is independently present');
  assert.equal(deriveResidencySubjectFeatures('a non-resident company').concepts.NON_RESIDENT, true);
  const controlOnly = diagnoseResidencySubject({
    subject: 'strategic decisions and board management; certificate of residence',
    exactMatcherPass: false,
    jurisdictionFixed: true
  });
  assert.equal(controlOnly.concepts.CONTROL_MANAGEMENT, true);
  assert.equal(controlOnly.concepts.CERTIFICATE_RESIDENCE, true);
  assert.equal(controlOnly.reasonCodes.includes('CONCEPT_EQUIVALENT_CANDIDATE'), false,
    'supporting concepts cannot replace company, tax, and residence concepts');
  assert.equal(controlOnly.reasonCodes.includes('MATERIAL_CONCEPT_MISSING'), true);

  const expectedIssue = v3Config.questions[0].expected.issues[0];
  const exact = matchIssues([expectedIssue], [{ subject: expectedIssue.subject }]).expectedByActual.has(0);
  assert.deepEqual(diagnoseResidencySubject({ subject: expectedIssue.subject, exactMatcherPass: exact }).reasonCodes, ['EXACT_ANCHOR_HIT']);

  let gatedCalls = 0;
  const gatedOutput = path.join(scratchRoot, 'gated');
  await assert.rejects(runSemanticResidencySubjectDiagnosticV4({
    mode: 'invalid', outputDirectory: gatedOutput, execute: async () => { gatedCalls += 1; return ''; }
  }), /requires --plan or --live/);
  assert.equal(gatedCalls, 0, 'unknown modes make no request');

  const successDirectory = path.join(scratchRoot, 'success');
  const planned = await preregister(successDirectory);
  assert.equal(planned.mode, 'plan');
  assert.equal(planned.preRegistration.scheduledCallCount, 6);
  assert.equal(planned.preRegistration.minimumStartGapMs, 15_250);
  assert.equal(planned.preRegistration.retryCount, 0);
  const preregText = await readFile(path.join(successDirectory, `${v4Config.outputPrefix}-preregistration.json`), 'utf8');
  const successReservationPath = path.join(successDirectory, `${v4Config.outputPrefix}-live-consumed.json`);
  await assert.rejects(readFile(successReservationPath), { code: 'ENOENT' }, 'plan mode creates no consumed marker');
  for (const sentinel of privateSentinels) assert.equal(preregText.includes(sentinel), false);

  const { result: success, harness: successHarness } = await runLive('success', successDirectory);
  assert.equal(success.requestCount, 6);
  assert.equal(success.transportCallCount, 6);
  assert.equal(success.minimumObservedStartGapMs >= v4Config.minimumStartGapMs, true);
  assert.equal(successHarness.transportCalls(), 6);
  assert.equal(successHarness.sleepCalls(), 5);
  assert.equal(successHarness.starts.slice(1).every((start, index) => start - successHarness.starts[index] >= v4Config.minimumStartGapMs), true);
  assert.equal(success.observations.every(row => row.requestCount === 1 && row.responseReceived), true);
  assert.equal(success.observations.every(row => row.dimensions.allDimensionsMatch), true);
  assert.equal(success.observations.every(row => row.subjectMatcherPass === false), true,
    'the existing exact matcher score stays distinct from correctly predicted dimensions');
  assert.equal(success.observations.every(row => row.subjectDiagnostics[0].reasonCodes.includes('CONCEPT_EQUIVALENT_CANDIDATE')), true);
  assert.equal(success.observations.every(row => row.subjectDiagnostics[0].concepts.COMPANY &&
    row.subjectDiagnostics[0].concepts.TAX && row.subjectDiagnostics[0].concepts.RESIDENCE &&
    row.subjectDiagnostics[0].concepts.SINGAPORE), true);

  const successJsonPath = path.join(successDirectory, `${v4Config.outputPrefix}.json`);
  const successMarkdownPath = path.join(successDirectory, `${v4Config.outputPrefix}.md`);
  const successJsonText = await readFile(successJsonPath, 'utf8');
  const successMarkdownText = await readFile(successMarkdownPath, 'utf8');
  const successJson = JSON.parse(successJsonText);
  const reservation = JSON.parse(await readFile(successReservationPath, 'utf8'));
  assert.equal(reservation.state, 'CONSUMED');
  assert.equal(reservation.preregistrationSha256, sha256(preregText));
  assert.equal(reservation.scheduleSha256, planned.preRegistration.scheduleSha256);
  assert.deepEqual(findPrivateKeys(successJson), [], 'success output contains no raw payload fields');
  for (const sentinel of privateSentinels) {
    assert.equal(successJsonText.includes(sentinel), false, `success JSON excludes ${sentinel}`);
    assert.equal(successMarkdownText.includes(sentinel), false, `success Markdown excludes ${sentinel}`);
    assert.equal(JSON.stringify(reservation).includes(sentinel), false, `consumed marker excludes ${sentinel}`);
  }
  assert.equal(successJsonText.includes(v3Config.questions[0].question), false, 'raw questions are not serialized');
  assert.equal(successMarkdownText.includes(v3Config.questions[0].question), false, 'raw questions are not serialized in Markdown');

  const invalidDirectory = path.join(scratchRoot, 'invalid-envelope');
  await preregister(invalidDirectory);
  const { result: invalid, harness: invalidHarness } = await runLive('invalid', invalidDirectory);
  assert.equal(invalidHarness.transportCalls(), 6);
  assert.equal(invalid.observations.every(row => row.outcome === 'INVALID_RESPONSE' && row.failureCode === 'INVALID_RESPONSE'), true);
  const invalidJson = await readFile(path.join(invalidDirectory, `${v4Config.outputPrefix}.json`), 'utf8');
  const invalidMarkdown = await readFile(path.join(invalidDirectory, `${v4Config.outputPrefix}.md`), 'utf8');
  for (const sentinel of privateSentinels) {
    assert.equal(invalidJson.includes(sentinel), false, `invalid JSON excludes ${sentinel}`);
    assert.equal(invalidMarkdown.includes(sentinel), false, `invalid Markdown excludes ${sentinel}`);
  }

  const timeoutDirectory = path.join(scratchRoot, 'timeout-envelope');
  await preregister(timeoutDirectory);
  const { result: timedOut, harness: timeoutHarness } = await runLive('timeout', timeoutDirectory);
  assert.equal(timeoutHarness.transportCalls(), 6);
  assert.equal(timedOut.observations.every(row => row.outcome === 'TIMEOUT' && row.failureCode === 'TIMEOUT'), true);
  const timeoutJson = await readFile(path.join(timeoutDirectory, `${v4Config.outputPrefix}.json`), 'utf8');
  const timeoutMarkdown = await readFile(path.join(timeoutDirectory, `${v4Config.outputPrefix}.md`), 'utf8');
  for (const sentinel of privateSentinels) {
    assert.equal(timeoutJson.includes(sentinel), false, `error JSON excludes ${sentinel}`);
    assert.equal(timeoutMarkdown.includes(sentinel), false, `error Markdown excludes ${sentinel}`);
  }

  const genericErrorDirectory = path.join(scratchRoot, 'provider-error-envelope');
  await preregister(genericErrorDirectory);
  const { result: errored, harness: errorHarness } = await runLive('error', genericErrorDirectory);
  assert.equal(errorHarness.transportCalls(), 6);
  assert.equal(errored.observations.every(row => row.outcome === 'PROVIDER_ERROR' && row.failureCode === 'PROVIDER_ERROR'), true);
  const errorJson = await readFile(path.join(genericErrorDirectory, `${v4Config.outputPrefix}.json`), 'utf8');
  const errorMarkdown = await readFile(path.join(genericErrorDirectory, `${v4Config.outputPrefix}.md`), 'utf8');
  for (const sentinel of privateSentinels) {
    assert.equal(errorJson.includes(sentinel), false, `error JSON excludes ${sentinel}`);
    assert.equal(errorMarkdown.includes(sentinel), false, `error Markdown excludes ${sentinel}`);
  }
  await rm(path.join(genericErrorDirectory, `${v4Config.outputPrefix}.json`), { force: true });
  await rm(path.join(genericErrorDirectory, `${v4Config.outputPrefix}.md`), { force: true });
  const providerFailureReuseHarness = buildHarness('success');
  await assert.rejects(runSemanticResidencySubjectDiagnosticV4({
    mode: 'live', apiKey: privateSentinels[4], outputDirectory: genericErrorDirectory,
    execute: providerFailureReuseHarness.execute,
    interpret: providerFailureReuseHarness.interpret,
    sleep: providerFailureReuseHarness.sleep,
    monotonicNow: providerFailureReuseHarness.monotonicNow,
    ...verificationHooks
  }), /already been consumed/);
  assert.equal(providerFailureReuseHarness.transportCalls(), 0,
    'a completed provider-error measurement remains consumed even if its report files are absent');

  const collisionDirectory = path.join(scratchRoot, 'collision');
  await preregister(collisionDirectory);
  await writeFile(path.join(collisionDirectory, `${v4Config.outputPrefix}.json`), 'occupied');
  let collisionCalls = 0;
  await assert.rejects(runSemanticResidencySubjectDiagnosticV4({
    mode: 'live', apiKey: privateSentinels[4], outputDirectory: collisionDirectory,
    execute: async () => { collisionCalls += 1; return ''; }, ...verificationHooks
  }), /output already exists/);
  assert.equal(collisionCalls, 0, 'existing final output is refused before a provider request');

  const preregCollisionDirectory = path.join(scratchRoot, 'prereg-collision');
  await preregister(preregCollisionDirectory);
  let preregCollisionCalls = 0;
  await assert.rejects(preregister(preregCollisionDirectory), /output already exists/);
  assert.equal(preregCollisionCalls, 0, 'an existing preregistration cannot be overwritten');

  const retryDirectory = path.join(scratchRoot, 'retry');
  await preregister(retryDirectory);
  const retryHarness = buildHarness('success');
  await assert.rejects(runSemanticResidencySubjectDiagnosticV4({
    mode: 'live', apiKey: privateSentinels[4], outputDirectory: retryDirectory,
    execute: retryHarness.execute,
    interpret: async (question, provider, callStructured) => {
      await callStructured('synthetic prompt', 'synthetic system', provider, {
        jsonMode: true,
        responseJsonSchema: SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA,
        temperature: 0,
        timeoutMs: 8000
      });
      await callStructured('synthetic prompt', 'synthetic system', provider, {
        jsonMode: true,
        responseJsonSchema: SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA,
        temperature: 0,
        timeoutMs: 8000
      });
    },
    sleep: retryHarness.sleep, monotonicNow: retryHarness.monotonicNow, ...verificationHooks
  }), /exactly one provider request/);
  assert.equal(retryHarness.transportCalls(), 1, 'a duplicate structured call is rejected before a second transport request');

  const historicalPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
    '../../docs/evaluation/multi-authority-workstreams/residency-diagnostic-v3/semantic-residency-diagnostic-v3.json');
  await assert.rejects(verifyResidencyV3HistoricalArtifacts({
    readFileFn: async filePath => {
      const bytes = await readFile(filePath);
      if (path.resolve(filePath) === historicalPath) return Buffer.concat([bytes, Buffer.from('synthetic drift')]);
      return bytes;
    }
  }), /protected V3 residency observation artifact changed/);
  await verifyResidencyV3HistoricalArtifacts();

  const driftDirectory = path.join(scratchRoot, 'historical-drift-gate');
  await preregister(driftDirectory);
  let driftCalls = 0;
  await assert.rejects(runSemanticResidencySubjectDiagnosticV4({
    mode: 'live', apiKey: privateSentinels[4], outputDirectory: driftDirectory,
    execute: async () => { driftCalls += 1; return ''; },
    ...verificationHooks,
    verifyHistoricalArtifacts: async () => { throw new Error('A protected V3 residency observation artifact changed.'); }
  }), /V3 residency observation artifact changed/);
  assert.equal(driftCalls, 0, 'historical verification blocks before the first provider request');

  const changedPreregDirectory = path.join(scratchRoot, 'changed-preregistration');
  await preregister(changedPreregDirectory);
  const changedPreregPath = path.join(changedPreregDirectory, `${v4Config.outputPrefix}-preregistration.json`);
  const changedPrereg = JSON.parse(await readFile(changedPreregPath, 'utf8'));
  changedPrereg.schedule[0].replicate = 99;
  await writeFile(changedPreregPath, JSON.stringify(changedPrereg));
  let changedPreregCalls = 0;
  await assert.rejects(runSemanticResidencySubjectDiagnosticV4({
    mode: 'live', apiKey: privateSentinels[4], outputDirectory: changedPreregDirectory,
    execute: async () => { changedPreregCalls += 1; return ''; }, ...verificationHooks
  }), /preregistration no longer matches/);
  assert.equal(changedPreregCalls, 0, 'a modified preregistration blocks before provider access');

  const concurrentDirectory = path.join(scratchRoot, 'concurrent-live');
  await preregister(concurrentDirectory);
  const firstConcurrentHarness = buildHarness('success');
  let announceFirstRequest;
  const firstRequestStarted = new Promise(resolve => { announceFirstRequest = resolve; });
  let releaseFirstRequest;
  const firstRequestGate = new Promise(resolve => { releaseFirstRequest = resolve; });
  const firstConcurrentRun = runSemanticResidencySubjectDiagnosticV4({
    mode: 'live', apiKey: privateSentinels[4], outputDirectory: concurrentDirectory,
    execute: async (...args) => {
      const response = await firstConcurrentHarness.execute(...args);
      if (firstConcurrentHarness.transportCalls() === 1) {
        announceFirstRequest();
        await firstRequestGate;
      }
      return response;
    },
    interpret: firstConcurrentHarness.interpret,
    sleep: firstConcurrentHarness.sleep,
    monotonicNow: firstConcurrentHarness.monotonicNow,
    ...verificationHooks
  });
  await firstRequestStarted;
  const secondConcurrentHarness = buildHarness('success');
  await assert.rejects(runSemanticResidencySubjectDiagnosticV4({
    mode: 'live', apiKey: privateSentinels[4], outputDirectory: concurrentDirectory,
    execute: secondConcurrentHarness.execute,
    interpret: secondConcurrentHarness.interpret,
    sleep: secondConcurrentHarness.sleep,
    monotonicNow: secondConcurrentHarness.monotonicNow,
    ...verificationHooks
  }), /already been consumed/);
  assert.equal(secondConcurrentHarness.transportCalls(), 0,
    'the concurrent invocation loses the exclusive reservation before issuing a request');
  releaseFirstRequest();
  const concurrentFirstResult = await firstConcurrentRun;
  assert.equal(concurrentFirstResult.requestCount, 6);
  assert.equal(firstConcurrentHarness.transportCalls(), 6);

  const failedRunDirectory = path.join(scratchRoot, 'failed-run-reuse');
  await preregister(failedRunDirectory);
  let protectedCheckCount = 0;
  const failAfterFirstRequestHooks = {
    verifyProtectedArtifacts: async () => {
      protectedCheckCount += 1;
      if (protectedCheckCount === 3) throw new Error('A protected V1/V2 observation artifact changed.');
      return { ...fixedBaseline };
    },
    verifyHistoricalArtifacts: verificationHooks.verifyHistoricalArtifacts
  };
  const failedFirstHarness = buildHarness('success');
  await assert.rejects(runSemanticResidencySubjectDiagnosticV4({
    mode: 'live', apiKey: privateSentinels[4], outputDirectory: failedRunDirectory,
    execute: failedFirstHarness.execute,
    interpret: failedFirstHarness.interpret,
    sleep: failedFirstHarness.sleep,
    monotonicNow: failedFirstHarness.monotonicNow,
    ...failAfterFirstRequestHooks
  }), /protected V1\/V2 observation artifact changed/);
  assert.equal(failedFirstHarness.transportCalls(), 1, 'the simulated post-request integrity failure occurs after reservation');
  const failedReservationPath = path.join(failedRunDirectory, `${v4Config.outputPrefix}-live-consumed.json`);
  assert.equal(JSON.parse(await readFile(failedReservationPath, 'utf8')).state, 'CONSUMED',
    'the consumed marker remains after a failed run');
  const reuseHarness = buildHarness('success');
  await assert.rejects(runSemanticResidencySubjectDiagnosticV4({
    mode: 'live', apiKey: privateSentinels[4], outputDirectory: failedRunDirectory,
    execute: reuseHarness.execute,
    interpret: reuseHarness.interpret,
    sleep: reuseHarness.sleep,
    monotonicNow: reuseHarness.monotonicNow,
    ...verificationHooks
  }), /already been consumed/);
  assert.equal(reuseHarness.transportCalls(), 0, 'failed measurement cannot reuse its preregistration');

  console.log('Semantic residency subject diagnostic V4 API-free safety regressions passed.');
} finally {
  await rm(scratchRoot, { recursive: true, force: true });
}
