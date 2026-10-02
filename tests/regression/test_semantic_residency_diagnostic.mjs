import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { interpretSemanticQuestion } from '../../src/services/semanticQuestionUnderstanding.ts';
import {
  buildResidencyDiagnosticSchedule,
  runSemanticResidencyDiagnosticV3,
  verifyProtectedObservationBaseline
} from '../evaluation/singapore/semantic-residency-diagnostic-v3.mjs';
import config from '../evaluation/singapore/semantic-residency-diagnostic-v3-config.json' with { type: 'json' };
import { SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA } from '../../src/services/semanticQuestionUnderstanding.ts';

const scratchRoot = await mkdtemp(path.join(os.tmpdir(), 'semantic-residency-diagnostic-v3-'));
const resolvedTemp = path.resolve(os.tmpdir());
if (path.dirname(path.resolve(scratchRoot)) !== resolvedTemp || !path.basename(scratchRoot).startsWith('semantic-residency-diagnostic-v3-')) {
  throw new Error('Refusing to use an unexpected residency diagnostic safety directory.');
}
const questionByText = new Map(config.questions.map(question => [question.question, question]));
const privateSentinels = [
  'SYNTHETIC_PRIVATE_RESIDENCY_SUBJECT_SENTINEL',
  'SYNTHETIC_PRIVATE_RESIDENCY_FACT_SENTINEL',
  'https://synthetic-private-residency.invalid/source',
  'synthetic-residency-api-key-not-real'
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function buildWireResponse(question, { wrongDomain = false, wrongSubject = false, privatePayload = false } = {}) {
  const expected = question.expected;
  const expectedIssue = expected.issues[0];
  const domain = wrongDomain ? 'IRAS_GST' : expected.rootDomain[0];
  const subject = privatePayload ? privateSentinels[0] : wrongSubject ? 'unrelated reporting framework question' : expectedIssue.subject;
  return JSON.stringify({
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: ['IRAS'],
    contextualAuthorities: [],
    domain,
    population: 'COMPANY',
    primarySubject: privatePayload ? privateSentinels[0] : expectedIssue.subject,
    concepts: [],
    requestedOperation: expected.rootOperation[0],
    factsExplicitlyProvided: privatePayload ? [privateSentinels[1], privateSentinels[2]] : [],
    confidence: 0.99,
    issues: [{
      subject,
      population: 'COMPANY',
      domain,
      governingAuthorities: ['IRAS'],
      contextualAuthorities: [],
      operation: expectedIssue.operation[0],
      mappedTopicIds: [],
      evidenceRequirement: expected.requiresUserSpecificFacts ? 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' : 'AUTHORITATIVE_SOURCE',
      confidence: 0.99
    }]
  });
}

function buildHarness({ wrongDomainFor, wrongSubjectFor, privatePayload = false } = {}) {
  let activeQuestion;
  let monotonic = 0;
  let wallClock = Date.parse('2026-10-02T00:00:00.000Z');
  let transportCalls = 0;
  const observedPrompts = new Map();
  const execute = async (prompt, system, provider, options) => {
    transportCalls += 1;
    assert.ok(activeQuestion, 'the fixed case is selected before the provider call');
    assert.equal(prompt.includes('\n\nInterpret this question:\n'), true);
    assert.equal(prompt.includes(activeQuestion.question), true);
    assert.equal(typeof system, 'string');
    assert.equal(provider.activeProvider, 'gemini');
    assert.equal(provider.gemini.model, config.model);
    assert.ok(provider.gemini.apiKey.length > 10);
    assert.deepEqual(Object.keys(options).sort(), ['jsonMode', 'responseJsonSchema', 'temperature', 'timeoutMs']);
    assert.equal(options.jsonMode, true);
    assert.equal(options.temperature, 0);
    assert.equal(options.timeoutMs, 8000);
    assert.deepEqual(options.responseJsonSchema, SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA);
    observedPrompts.set(activeQuestion.id, observedPrompts.get(activeQuestion.id) || sha256(prompt));
    monotonic += 125;
    return buildWireResponse(activeQuestion, {
      wrongDomain: activeQuestion.id === wrongDomainFor,
      wrongSubject: activeQuestion.id === wrongSubjectFor,
      privatePayload
    });
  };
  const interpret = async (questionText, provider, callStructured) => {
    activeQuestion = questionByText.get(questionText);
    assert.ok(activeQuestion, 'only the three configured questions can be interpreted');
    return interpretSemanticQuestion(questionText, provider, callStructured);
  };
  return {
    execute,
    interpret,
    transportCalls: () => transportCalls,
    promptHashes: observedPrompts,
    sleep: async milliseconds => { monotonic += milliseconds; },
    monotonicNow: () => monotonic,
    now: () => new Date(wallClock += 1000)
  };
}

function findPrivateKeys(value, pathName = '$') {
  if (Array.isArray(value)) return value.flatMap((item, index) => findPrivateKeys(item, `${pathName}[${index}]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(['question', 'subject', 'factsExplicitlyProvided', 'rawResponse', 'prompt', 'systemInstruction', 'apiKey', 'url'].includes(key)
      ? [`${pathName}.${key}`] : []),
    ...findPrivateKeys(child, `${pathName}.${key}`)
  ]);
}

try {
  const schedule = buildResidencyDiagnosticSchedule();
  assert.equal(schedule.length, 6);
  for (const question of config.questions) {
    assert.equal(schedule.filter(row => row.questionId === question.id).length, 2);
  }

  let gatedCalls = 0;
  await assert.rejects(runSemanticResidencyDiagnosticV3({
    live: false,
    outputDirectory: path.join(scratchRoot, 'gated'),
    execute: async () => { gatedCalls += 1; return ''; }
  }), /requires --live/);
  assert.equal(gatedCalls, 0, 'the harness is live-gated before transport');

  const outputDirectory = path.join(scratchRoot, 'synthetic-run');
  const harness = buildHarness();
  const result = await runSemanticResidencyDiagnosticV3({
    live: true,
    apiKey: 'synthetic-residency-api-key-not-real',
    outputDirectory,
    execute: harness.execute,
    interpret: harness.interpret,
    sleep: harness.sleep,
    monotonicNow: harness.monotonicNow,
    now: harness.now
  });
  assert.equal(harness.transportCalls(), 6, 'each scheduled case makes exactly one transport request');
  assert.equal(result.requestCount, 6);
  assert.equal(result.transportCallCount, 6);
  assert.equal(result.observations.length, 6);
  assert.equal(result.minimumObservedStartGapMs >= 15_250, true);
  assert.deepEqual(result.observations.map(row => row.questionId), schedule.map(row => row.questionId));
  assert.equal(result.protectedObservationBaseline.protectedArtifactCount, 125);
  assert.equal(result.protectedObservationBaseline.verifiedBefore, true);
  assert.equal(result.protectedObservationBaseline.verifiedAfter, true);
  assert.equal(result.observations.every(row => row.validInterpretation && row.requestCount === 1), true);
  assert.equal(result.observations.every(row => row.dimensions?.allDimensionsMatch === true), true);
  assert.equal(result.observations.every(row => row.issueSubjectMatches.length === 1 && row.issueSubjectMatches[0]), true);
  assert.equal(harness.promptHashes.size, 3, 'each fixed prompt has the same fingerprint on both replicates');
  assert.equal(Object.keys(result.sourceFingerprints).length > 0, true);
  assert.equal(Object.keys(result.fixtureFingerprints).length, 2);

  let observedHistoricalArtifactRead = false;
  const historicalDriftPath = path.join('tests', 'evaluation', 'singapore', 'semantic-reliability-post-guidance.json');
  await assert.rejects(verifyProtectedObservationBaseline({
    readFileFn: async filePath => {
      const bytes = await readFile(filePath);
      if (path.normalize(filePath).endsWith(historicalDriftPath)) {
        observedHistoricalArtifactRead = true;
        return Buffer.concat([bytes, Buffer.from('synthetic drift')]);
      }
      return bytes;
    }
  }), /protected V1\/V2 observation artifact changed/);
  assert.equal(observedHistoricalArtifactRead, true,
    'the verifier reads and rejects drift in a referenced V1 historical artifact without API calls');

  const jsonPath = path.join(outputDirectory, `${config.outputPrefix}.json`);
  const markdownPath = path.join(outputDirectory, `${config.outputPrefix}.md`);
  const jsonText = await readFile(jsonPath, 'utf8');
  const markdownText = await readFile(markdownPath, 'utf8');
  const jsonDocument = JSON.parse(jsonText);
  assert.equal(jsonDocument.diagnosticOnly, true, 'this output reports diagnostics, not release acceptance');
  assert.deepEqual(findPrivateKeys(jsonDocument), [], 'the safe projection contains no private payload fields');
  assert.equal(jsonText.includes(config.questions[0].question), false, 'query text is not persisted');
  assert.equal(markdownText.includes(config.questions[0].question), false, 'query text is not persisted in Markdown');

  const privateOutputDirectory = path.join(scratchRoot, 'private-payload');
  const privateHarness = buildHarness({ privatePayload: true });
  const privateResult = await runSemanticResidencyDiagnosticV3({
    live: true,
    apiKey: privateSentinels[3],
    outputDirectory: privateOutputDirectory,
    execute: privateHarness.execute,
    interpret: privateHarness.interpret,
    sleep: privateHarness.sleep,
    monotonicNow: privateHarness.monotonicNow,
    now: privateHarness.now
  });
  const privateJson = await readFile(path.join(privateOutputDirectory, `${config.outputPrefix}.json`), 'utf8');
  const privateMarkdown = await readFile(path.join(privateOutputDirectory, `${config.outputPrefix}.md`), 'utf8');
  for (const sentinel of privateSentinels) {
    assert.equal(privateJson.includes(sentinel), false, 'JSON excludes subjects, facts, URLs, and credentials');
    assert.equal(privateMarkdown.includes(sentinel), false, 'Markdown excludes subjects, facts, URLs, and credentials');
  }
  assert.equal(privateResult.requestCount, 6);

  const dimensionFailureDirectory = path.join(scratchRoot, 'dimension-failure');
  const dimensionFailureHarness = buildHarness({ wrongDomainFor: 'corporate-residency-general-paraphrase' });
  const dimensionFailure = await runSemanticResidencyDiagnosticV3({
    live: true,
    apiKey: 'synthetic-residency-api-key-not-real',
    outputDirectory: dimensionFailureDirectory,
    execute: dimensionFailureHarness.execute,
    interpret: dimensionFailureHarness.interpret,
    sleep: dimensionFailureHarness.sleep,
    monotonicNow: dimensionFailureHarness.monotonicNow,
    now: dimensionFailureHarness.now
  });
  const wrongDomainObservation = dimensionFailure.observations.find(row => row.questionId === 'corporate-residency-general-paraphrase');
  assert.equal(wrongDomainObservation.validInterpretation, true);
  assert.equal(wrongDomainObservation.dimensions.root.domain, false);
  assert.equal(wrongDomainObservation.dimensions.issues[0].domain, false);
  assert.equal(wrongDomainObservation.dimensions.allDimensionsMatch, false,
    'a valid interpretation with a wrong domain remains a visible dimension failure');

  const subjectFailureDirectory = path.join(scratchRoot, 'subject-failure');
  const subjectFailureHarness = buildHarness({ wrongSubjectFor: 'corporate-residency-general-paraphrase' });
  const subjectFailure = await runSemanticResidencyDiagnosticV3({
    live: true,
    apiKey: 'synthetic-residency-api-key-not-real',
    outputDirectory: subjectFailureDirectory,
    execute: subjectFailureHarness.execute,
    interpret: subjectFailureHarness.interpret,
    sleep: subjectFailureHarness.sleep,
    monotonicNow: subjectFailureHarness.monotonicNow,
    now: subjectFailureHarness.now
  });
  const wrongSubjectObservation = subjectFailure.observations.find(row => row.questionId === 'corporate-residency-general-paraphrase');
  assert.equal(wrongSubjectObservation.validInterpretation, true);
  assert.equal(wrongSubjectObservation.issueSubjectMatches[0], false);
  assert.equal(Object.values(wrongSubjectObservation.dimensions.root).every(Boolean), true);
  assert.equal(Object.values(wrongSubjectObservation.dimensions.issues[0]).every(Boolean), true,
    'the safe issue dimensions remain independently scorable when its subject does not match');
  assert.equal(wrongSubjectObservation.dimensions.allDimensionsMatch, false,
    'the overall diagnostic still fails when the issue subject is unmatched');

  let overwrittenCalls = 0;
  await assert.rejects(runSemanticResidencyDiagnosticV3({
    live: true,
    apiKey: 'synthetic-residency-api-key-not-real',
    outputDirectory,
    execute: async () => { overwrittenCalls += 1; return ''; }
  }), /output already exists/);
  assert.equal(overwrittenCalls, 0, 'existing output files block before provider access');

  const retryHarness = buildHarness();
  await assert.rejects(runSemanticResidencyDiagnosticV3({
    live: true,
    apiKey: 'synthetic-residency-api-key-not-real',
    outputDirectory: path.join(scratchRoot, 'retry-attempt'),
    execute: retryHarness.execute,
    interpret: async (query, provider, callStructured) => {
      const actual = await retryHarness.interpret(query, provider, callStructured);
      await retryHarness.interpret(query, provider, callStructured);
      return actual;
    },
    sleep: retryHarness.sleep,
    monotonicNow: retryHarness.monotonicNow,
    now: retryHarness.now
  }), /exactly one correctly paced request/);
  assert.equal(retryHarness.transportCalls(), 1, 'a duplicate structured call cannot reach transport');

  const driftDirectory = path.join(scratchRoot, 'fingerprint-drift');
  let semanticSourceReads = 0;
  const realFingerprint = async files => Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, filePath]) =>
    [name, sha256(await readFile(filePath))])));
  const driftingFingerprint = async files => {
    const fingerprints = await realFingerprint(files);
    if (Object.hasOwn(files, 'semanticInterpretation')) {
      semanticSourceReads += 1;
      if (semanticSourceReads === 2) fingerprints.semanticInterpretation = 'a'.repeat(64);
    }
    return fingerprints;
  };
  let driftProviderCalls = 0;
  await assert.rejects(runSemanticResidencyDiagnosticV3({
    live: true,
    apiKey: 'synthetic-residency-api-key-not-real',
    outputDirectory: driftDirectory,
    execute: async () => { driftProviderCalls += 1; return ''; },
    hashNamedFilesFn: driftingFingerprint
  }), /source, fixture, or protected observation changed/);
  assert.equal(driftProviderCalls, 0, 'fingerprint drift blocks before the first provider call');

  console.log('Semantic residency diagnostic V3 synthetic safety regressions passed.');
} finally {
  await rm(scratchRoot, { recursive: true, force: true });
}
