import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { executeStructuredLlmCall } from '../../../src/services/aiTransport.ts';
import {
  interpretSemanticQuestion,
  SEMANTIC_AUTHORITY_VALUES,
  SEMANTIC_DOMAIN_VALUES,
  SEMANTIC_OPERATION_VALUES,
  SEMANTIC_POPULATION_VALUES,
  SEMANTIC_QUESTION_TIMEOUT_MS,
  SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA
} from '../../../src/services/semanticQuestionUnderstanding.ts';
import {
  buildResidencyDiagnosticSchedule as buildV3Schedule,
  verifyProtectedObservationBaseline
} from './semantic-residency-diagnostic-v3.mjs';
import v3Config from './semantic-residency-diagnostic-v3-config.json' with { type: 'json' };
import evaluationConfig from './semantic-residency-subject-diagnostic-v4-config.json' with { type: 'json' };
import { matchIssues, scoreIssueDimensions } from './multi-authority-issue-scoring.mjs';
import {
  diagnoseResidencySubject,
  RESIDENCY_SUBJECT_CONCEPT_ORDER,
  RESIDENCY_SUBJECT_REASON_CODES
} from './semantic-residency-subject-diagnostic-v4.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '../../..');
const OUTPUT_DIRECTORY = path.join(PROJECT_ROOT, 'docs', 'evaluation', 'multi-authority-workstreams', 'iras-first-local-2026-10-02-v4');
const OUTPUT_PREFIX = evaluationConfig.outputPrefix;
const PREREGISTRATION_NAME = `${OUTPUT_PREFIX}-preregistration.json`;
const LIVE_RESERVATION_NAME = `${OUTPUT_PREFIX}-live-consumed.json`;
const CONFIG_SHA256 = '3e8a9152fbd5a5f4b4c1af8954f055ea600901ecec19a95c3f116c8e6a189936';
const V3_HISTORICAL_ARTIFACTS = Object.freeze({
  'docs/evaluation/multi-authority-workstreams/residency-diagnostic-v3/semantic-residency-diagnostic-v3.json': '87128bad58b97dae7c36c599c5ee985fac3385970783189aec3e80a70f2972e1',
  'docs/evaluation/multi-authority-workstreams/residency-diagnostic-v3/semantic-residency-diagnostic-v3.md': 'b10b8fabdb487f582d9752e8d5f3a0942f579ccb4dbffe75a3c75085f4089621',
  'tests/evaluation/singapore/semantic-residency-diagnostic-v3-config.json': '304fa005a233a56161a8a964842d6582e9b21ad19224f2d7863aaafa66778408',
  'tests/evaluation/singapore/semantic-residency-diagnostic-v3.mjs': '427fa2930314c8a9428b0b87578a4787d3c8de590644fa5992359bf07e581f5c',
  'docs/evaluation/multi-authority-workstreams/residency-diagnostic-v3/protected-observation-baseline.json': '346ff7580ea716a051de54bbede0be7c0689894ef1c87568688992d87fbb5700'
});
const SAFE_FAILURE_CODES = new Set(['TIMEOUT', 'RATE_LIMITED', 'PROVIDER_ERROR', 'INVALID_RESPONSE', 'LOW_CONFIDENCE', 'QUERY_TOO_LONG']);
const SOURCE_FILES = Object.freeze({
  semanticInterpretation: path.join(PROJECT_ROOT, 'src', 'services', 'semanticQuestionUnderstanding.ts'),
  transport: path.join(PROJECT_ROOT, 'src', 'services', 'aiTransport.ts'),
  issueScoring: path.join(SCRIPT_DIRECTORY, 'multi-authority-issue-scoring.mjs'),
  v3Runner: path.join(SCRIPT_DIRECTORY, 'semantic-residency-diagnostic-v3.mjs'),
  subjectHelper: path.join(SCRIPT_DIRECTORY, 'semantic-residency-subject-diagnostic-v4.mjs'),
  diagnosticRunner: fileURLToPath(import.meta.url)
});
const FIXTURE_FILES = Object.freeze({
  v3QuestionConfiguration: path.join(SCRIPT_DIRECTORY, 'semantic-residency-diagnostic-v3-config.json'),
  fixedV4Configuration: path.join(SCRIPT_DIRECTORY, 'semantic-residency-subject-diagnostic-v4-config.json'),
  protectedV3ObservationBaseline: path.join(PROJECT_ROOT, 'docs', 'evaluation', 'multi-authority-workstreams', 'residency-diagnostic-v3', 'protected-observation-baseline.json')
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sameManifest(left, right) {
  const leftKeys = Object.keys(left || {}).sort();
  const rightKeys = Object.keys(right || {}).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

async function hashNamedFiles(files, readFileFn = readFile) {
  const values = await Promise.all(Object.entries(files).map(async ([name, filePath]) => {
    try {
      return [name, sha256(await readFileFn(filePath))];
    } catch {
      throw new Error('A fixed diagnostic fingerprint could not be read.');
    }
  }));
  return Object.fromEntries(values);
}

function buildSchedule() {
  return evaluationConfig.schedule.map(item => ({ ...item }));
}

function validateConfiguration() {
  const questionIds = evaluationConfig.questionIds;
  const idsMatchV3 = JSON.stringify(questionIds) === JSON.stringify(v3Config.questionIds) &&
    JSON.stringify(v3Config.questions.map(question => question.id)) === JSON.stringify(questionIds);
  const scheduleMatchesV3 = JSON.stringify(buildSchedule()) === JSON.stringify(buildV3Schedule());
  if (evaluationConfig.schemaVersion !== 4 || evaluationConfig.profileVersion !== 'semantic-residency-subject-diagnostic-v4' ||
      evaluationConfig.outputPrefix !== 'semantic-residency-subject-diagnostic-v4' ||
      evaluationConfig.questionConfig !== 'tests/evaluation/singapore/semantic-residency-diagnostic-v3-config.json' ||
      evaluationConfig.model !== 'gemini-3.5-flash-lite' || evaluationConfig.timeoutMs !== 8000 ||
      evaluationConfig.timeoutMs !== SEMANTIC_QUESTION_TIMEOUT_MS || evaluationConfig.temperature !== 0 ||
      evaluationConfig.jsonMode !== true || evaluationConfig.retryCount !== 0 ||
      evaluationConfig.minimumStartGapMs !== 15_250 || evaluationConfig.observationsPerQuestion !== 2 ||
      JSON.stringify(evaluationConfig.subjectConceptIds) !== JSON.stringify(RESIDENCY_SUBJECT_CONCEPT_ORDER) ||
      JSON.stringify(evaluationConfig.subjectReasonCodes) !== JSON.stringify(RESIDENCY_SUBJECT_REASON_CODES) ||
      JSON.stringify(evaluationConfig.jurisdictionFixedQuestionIds) !== JSON.stringify(questionIds) ||
      !idsMatchV3 || !scheduleMatchesV3 || evaluationConfig.schedule.length !== 6) {
    throw new Error('The fixed V4 residency diagnostic configuration changed.');
  }
}

function safeFailureCode(error, fallback = 'PROVIDER_ERROR') {
  const message = error instanceof Error ? error.message : '';
  if (/HTTP\s+429/i.test(message)) return 'RATE_LIMITED';
  if (/abort|timed\s*out|timeout/i.test(message)) return 'TIMEOUT';
  return SAFE_FAILURE_CODES.has(fallback) ? fallback : 'PROVIDER_ERROR';
}

function safeEnum(value, allowed) {
  return allowed.includes(value) ? value : 'UNKNOWN';
}

function safeEnumArray(values, allowed) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter(value => allowed.includes(value)))].sort();
}

function sameSet(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) return false;
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  return actualSorted.every((item, index) => item === expectedSorted[index]);
}

function scoreSafeInterpretation(question, interpretation, jurisdictionFixed) {
  if (!interpretation || !Array.isArray(interpretation.issues)) {
    return { subjectMatcherPass: null, subjectDiagnostics: null, dimensions: null };
  }
  const expected = question.expected;
  const actualIssues = interpretation.issues;
  const { expectedByActual } = matchIssues(expected.issues, actualIssues);
  const rootDimensions = {
    operation: expected.rootOperation.includes(safeEnum(interpretation.requestedOperation, SEMANTIC_OPERATION_VALUES)),
    population: expected.rootPopulation.includes(safeEnum(interpretation.population, SEMANTIC_POPULATION_VALUES)),
    domain: expected.rootDomain.includes(safeEnum(interpretation.domain, SEMANTIC_DOMAIN_VALUES)),
    authorities: sameSet(safeEnumArray(interpretation.authorityCandidates, SEMANTIC_AUTHORITY_VALUES), expected.rootAuthorities),
    contextualAuthorities: expected.rootContextualAuthoritiesAnyOf.some(set =>
      sameSet(safeEnumArray(interpretation.contextualAuthorities, SEMANTIC_AUTHORITY_VALUES), set)),
    requiresUserSpecificFacts: interpretation.requiresUserSpecificFacts === expected.requiresUserSpecificFacts
  };
  const issueDimensions = [];
  const subjectDiagnostics = actualIssues.map((issue, actualIndex) => {
    const expectedIndex = expectedByActual.get(actualIndex);
    const comparisonExpected = expected.issues[expectedIndex ?? actualIndex];
    issueDimensions.push(comparisonExpected ? scoreIssueDimensions(issue, comparisonExpected) : {
      governingAuthority: false, contextualAuthority: false, domain: false, population: false, operation: false
    });
    const expectedSubject = comparisonExpected || expected.issues[0];
    const exactMatcherPass = expectedSubject ? matchIssues([expectedSubject], [issue]).expectedByActual.has(0) : false;
    return diagnoseResidencySubject({
      subject: issue?.subject,
      exactMatcherPass,
      jurisdictionFixed
    });
  });
  const subjectMatcherPass = actualIssues.length === expected.issueCount &&
    subjectDiagnostics.length === expected.issues.length && subjectDiagnostics.every(item => item.exactMatcherPass);
  const allDimensionsMatch = actualIssues.length === expected.issueCount && Object.values(rootDimensions).every(Boolean) &&
    issueDimensions.length === expected.issues.length && issueDimensions.every(item => Object.values(item).every(Boolean));
  return {
    subjectMatcherPass,
    subjectDiagnostics,
    dimensions: { root: rootDimensions, issues: issueDimensions, allDimensionsMatch }
  };
}

async function refusePresentPaths(paths, { allowMissing = false } = {}) {
  for (const target of paths) {
    try {
      await access(target);
      throw new Error('A V4 residency diagnostic output already exists.');
    } catch (error) {
      if (error?.message === 'A V4 residency diagnostic output already exists.') throw error;
      if (!allowMissing && error?.code !== 'ENOENT') throw new Error('A V4 residency diagnostic output path is unavailable.');
    }
  }
}

export async function verifyResidencyV3HistoricalArtifacts({
  readFileFn = readFile
} = {}) {
  try {
    for (const [relativePath, expectedHash] of Object.entries(V3_HISTORICAL_ARTIFACTS)) {
      const bytes = await readFileFn(path.resolve(PROJECT_ROOT, relativePath));
      if (sha256(bytes) !== expectedHash) throw new Error('historical mismatch');
    }
  } catch {
    throw new Error('A protected V3 residency observation artifact changed.');
  }
  return { verified: true, artifactCount: Object.keys(V3_HISTORICAL_ARTIFACTS).length };
}

function expectedQuestionConfig() {
  const byId = new Map(v3Config.questions.map(question => [question.id, question]));
  return new Map(evaluationConfig.questionIds.map(id => [id, byId.get(id)]));
}

async function buildPreRegistration({ hashNamedFilesFn, verifyProtectedArtifacts, verifyHistoricalArtifacts }) {
  validateConfiguration();
  const sourceFingerprints = await hashNamedFilesFn(SOURCE_FILES);
  const fixtureFingerprints = await hashNamedFilesFn(FIXTURE_FILES);
  if (fixtureFingerprints.fixedV4Configuration !== CONFIG_SHA256 ||
      fixtureFingerprints.v3QuestionConfiguration !== evaluationConfig.pinnedQuestionConfigSha256) {
    throw new Error('The fixed V4 residency diagnostic configuration changed.');
  }
  const protectedBaseline = await verifyProtectedArtifacts();
  const historical = await verifyHistoricalArtifacts();
  const schedule = buildSchedule();
  const scheduleSha256 = sha256(JSON.stringify(schedule));
  const questionMap = expectedQuestionConfig();
  if (questionMap.size !== 3 || [...questionMap.values()].some(question => !question)) {
    throw new Error('The fixed V4 residency diagnostic configuration changed.');
  }
  return {
    schemaVersion: 4,
    profileVersion: evaluationConfig.profileVersion,
    mode: 'PREREGISTERED',
    model: evaluationConfig.model,
    timeoutMs: evaluationConfig.timeoutMs,
    temperature: evaluationConfig.temperature,
    jsonMode: evaluationConfig.jsonMode,
    retryCount: evaluationConfig.retryCount,
    minimumStartGapMs: evaluationConfig.minimumStartGapMs,
    scheduledCallCount: schedule.length,
    observationsPerQuestion: evaluationConfig.observationsPerQuestion,
    questionIds: [...evaluationConfig.questionIds],
    jurisdictionFixedQuestionIds: [...evaluationConfig.jurisdictionFixedQuestionIds],
    schedule,
    scheduleSha256,
    sourceFingerprints,
    fixtureFingerprints,
    protectedObservationBaseline: {
      baselineSha256: protectedBaseline.baselineSha256,
      protectedArtifactCount: protectedBaseline.protectedArtifactCount
    },
    protectedV3ObservationArtifacts: historical.artifactCount,
    preregisteredAt: new Date().toISOString()
  };
}

function fixedProviderSettings(apiKey) {
  return {
    activeProvider: 'gemini',
    azure: { endpoint: '', apiKey: '', deploymentName: 'gpt-4o', apiVersion: '2024-08-01-preview' },
    gemini: { apiKey: apiKey.trim(), model: evaluationConfig.model },
    openai: { apiKey: '', model: 'gpt-4o', baseUrl: '' }
  };
}

function registrationMatches(stored, expected) {
  const keys = Object.keys(expected).filter(key => key !== 'preregisteredAt');
  if (!stored || typeof stored !== 'object' || Array.isArray(stored) ||
      Object.keys(stored).sort().join('|') !== [...keys, 'preregisteredAt'].sort().join('|') ||
      typeof stored.preregisteredAt !== 'string' || Number.isNaN(Date.parse(stored.preregisteredAt))) return false;
  return keys.every(key => JSON.stringify(stored[key]) === JSON.stringify(expected[key]));
}

function renderMarkdown(document) {
  const lines = [
    '# Singapore corporate residency subject diagnostic V4',
    '',
    `- Profile: ${document.profileVersion}`,
    `- Model: ${document.model}`,
    `- Requests: ${document.requestCount} / ${document.scheduledCallCount}`,
    `- Minimum observed request-start gap: ${document.minimumObservedStartGapMs} ms`,
    `- Historical V1/V2 artifacts reverified: ${document.protectedObservationBaseline.protectedArtifactCount}`,
    `- V3 observation artifacts reverified: ${document.protectedV3ObservationArtifacts}`,
    '',
    'This prospective diagnostic reports a fixed subject-feature projection, existing exact-matcher results, and semantic dimensions separately. It is diagnostic evidence, not acceptance.',
    '',
    '| Question ID | Replicate | Outcome | Exact subject match | Subject reason codes | Root dimensions | Issue dimensions |',
    '| --- | ---: | --- | --- | --- | --- | --- |'
  ];
  for (const row of document.observations) {
    const dimensionsAsText = dimensions => dimensions ? Object.values(dimensions).every(Boolean) : false;
    const reasons = row.subjectDiagnostics?.flatMap(item => item.reasonCodes).join(', ') || '—';
    lines.push(`| ${row.questionId} | ${row.replicate} | ${row.outcome} | ${row.subjectMatcherPass ?? '—'} | ${reasons} | ${dimensionsAsText(row.dimensions?.root)} | ${row.dimensions?.issues?.length ? row.dimensions.issues.map(dimensionsAsText).join(', ') : '—'} |`);
  }
  lines.push('', 'Only allowlisted concept booleans, concept-vector fingerprints, finite reason codes, and dimension booleans are retained. Raw questions, prompts, responses, subjects, facts, URLs, and credentials are not persisted.', '');
  return lines.join('\n');
}

/** Prospective fixed six-call runner. Plan mode records fingerprints; live mode requires that preregistration. */
export async function runSemanticResidencySubjectDiagnosticV4({
  mode,
  apiKey = process.env.GEMINI_API_KEY,
  outputDirectory = OUTPUT_DIRECTORY,
  execute = executeStructuredLlmCall,
  interpret = interpretSemanticQuestion,
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  monotonicNow = () => performance.now(),
  now = () => new Date(),
  readFileFn = readFile,
  writeFileFn = writeFile,
  hashNamedFilesFn = hashNamedFiles,
  verifyProtectedArtifacts = verifyProtectedObservationBaseline,
  verifyHistoricalArtifacts = verifyResidencyV3HistoricalArtifacts
} = {}) {
  if (mode !== 'plan' && mode !== 'live') throw new Error('Residency diagnostic requires --plan or --live.');
  const resolvedOutputDirectory = path.resolve(outputDirectory);
  await mkdir(resolvedOutputDirectory, { recursive: true });
  const preregistrationPath = path.join(resolvedOutputDirectory, PREREGISTRATION_NAME);
  const liveReservationPath = path.join(resolvedOutputDirectory, LIVE_RESERVATION_NAME);
  const jsonPath = path.join(resolvedOutputDirectory, `${OUTPUT_PREFIX}.json`);
  const markdownPath = path.join(resolvedOutputDirectory, `${OUTPUT_PREFIX}.md`);
  const sourceDependencies = { hashNamedFilesFn, verifyProtectedArtifacts, verifyHistoricalArtifacts };

  if (mode === 'plan') {
    await refusePresentPaths([preregistrationPath, jsonPath, markdownPath]);
    const preRegistration = await buildPreRegistration(sourceDependencies);
    try {
      await writeFileFn(preregistrationPath, `${JSON.stringify(preRegistration, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    } catch {
      throw new Error('A V4 residency diagnostic output already exists or could not be written.');
    }
    return { mode: 'plan', preRegistration };
  }

  if (typeof apiKey !== 'string' || apiKey.trim().length <= 10) throw new Error('GEMINI_API_KEY is not configured.');
  await refusePresentPaths([jsonPath, markdownPath]);
  let storedPreRegistration;
  let preregistrationSha256;
  try {
    const preregistrationBytes = await readFileFn(preregistrationPath);
    const buffer = Buffer.isBuffer(preregistrationBytes) ? preregistrationBytes : Buffer.from(preregistrationBytes);
    preregistrationSha256 = sha256(buffer);
    storedPreRegistration = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new Error('A matching V4 preregistration is required before live mode.');
  }
  const expectedPreRegistration = await buildPreRegistration(sourceDependencies);
  if (!registrationMatches(storedPreRegistration, expectedPreRegistration)) {
    throw new Error('The V4 preregistration no longer matches the fixed schedule or fingerprints.');
  }
  const liveReservation = {
    schemaVersion: 4,
    profileVersion: evaluationConfig.profileVersion,
    state: 'CONSUMED',
    preregistrationSha256,
    scheduleSha256: expectedPreRegistration.scheduleSha256,
    configurationSha256: expectedPreRegistration.fixtureFingerprints.fixedV4Configuration,
    acquiredAt: now().toISOString()
  };
  try {
    await writeFileFn(liveReservationPath, `${JSON.stringify(liveReservation, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('The V4 preregistration has already been consumed.');
    throw new Error('The V4 live reservation could not be created.');
  }
  const questionMap = expectedQuestionConfig();
  const observations = [];
  let previousRequestStart;
  let requestCount = 0;
  let transportCallCount = 0;
  const startedAt = now().toISOString();

  for (let index = 0; index < expectedPreRegistration.schedule.length; index += 1) {
    if (index > 0) await sleep(evaluationConfig.minimumStartGapMs);
    const sourceBefore = await hashNamedFilesFn(SOURCE_FILES);
    const fixturesBefore = await hashNamedFilesFn(FIXTURE_FILES);
    const protectedBeforeRequest = await verifyProtectedArtifacts();
    const historicalBeforeRequest = await verifyHistoricalArtifacts();
    if (!sameManifest(expectedPreRegistration.sourceFingerprints, sourceBefore) ||
        !sameManifest(expectedPreRegistration.fixtureFingerprints, fixturesBefore) ||
        protectedBeforeRequest.baselineSha256 !== expectedPreRegistration.protectedObservationBaseline.baselineSha256 ||
        protectedBeforeRequest.protectedArtifactCount !== expectedPreRegistration.protectedObservationBaseline.protectedArtifactCount ||
        historicalBeforeRequest.artifactCount !== expectedPreRegistration.protectedV3ObservationArtifacts) {
      throw new Error('A V4 diagnostic source, fixture, or protected observation changed during measurement.');
    }

    const scheduled = expectedPreRegistration.schedule[index];
    const question = questionMap.get(scheduled.questionId);
    if (!question) throw new Error('The fixed V4 residency diagnostic configuration changed.');
    let callCount = 0;
    let transportStarted;
    let transportDurationMs;
    let requestStartGapMs;
    let responseReceived = false;
    let failureCode;
    let rawResponse;
    let productionResult;
    const jurisdictionFixed = evaluationConfig.jurisdictionFixedQuestionIds.includes(question.id);
    const callStructured = async (prompt, system, provider, options) => {
      callCount += 1;
      if (callCount > 1) throw new Error('A scheduled residency call attempted a retry.');
      const requiredOptionKeys = ['jsonMode', 'responseJsonSchema', 'temperature', 'timeoutMs'];
      if (provider?.activeProvider !== 'gemini' || provider.gemini?.apiKey !== apiKey.trim() ||
          provider.gemini?.model !== evaluationConfig.model || !options ||
          JSON.stringify(Object.keys(options).sort()) !== JSON.stringify(requiredOptionKeys) ||
          options.jsonMode !== true || options.temperature !== 0 || options.timeoutMs !== evaluationConfig.timeoutMs ||
          JSON.stringify(options.responseJsonSchema) !== JSON.stringify(SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA)) {
        throw new Error('The fixed structured V4 residency request changed.');
      }
      const start = monotonicNow();
      requestStartGapMs = previousRequestStart === undefined ? null : Math.round(start - previousRequestStart);
      if (requestStartGapMs !== null && requestStartGapMs < evaluationConfig.minimumStartGapMs) {
        throw new Error('The V4 residency diagnostic request-start gap was too short.');
      }
      previousRequestStart = start;
      transportStarted = monotonicNow();
      try {
        transportCallCount += 1;
        rawResponse = await execute(prompt, system, provider, options);
        if (typeof rawResponse !== 'string') throw new Error('The provider returned a non-text response.');
        responseReceived = true;
        return rawResponse;
      } catch (error) {
        failureCode = safeFailureCode(error);
        throw error;
      } finally {
        transportDurationMs = Math.round((monotonicNow() - transportStarted) * 100) / 100;
      }
    };

    try {
      productionResult = await interpret(question.question, fixedProviderSettings(apiKey), callStructured);
    } catch (error) {
      if (callCount > 1) throw new Error('Each V4 residency observation must make exactly one provider request.');
      failureCode = safeFailureCode(error, responseReceived ? 'INVALID_RESPONSE' : 'PROVIDER_ERROR');
      productionResult = { mode: 'DETERMINISTIC_FALLBACK', failure: failureCode };
    }
    if (callCount !== 1 || requestStartGapMs === undefined || index > 0 && requestStartGapMs < evaluationConfig.minimumStartGapMs) {
      throw new Error('Each fixed V4 residency observation must make exactly one correctly paced request.');
    }
    requestCount += callCount;
    let interpretation = productionResult?.mode === 'SEMANTIC_INTERPRETATION' && !productionResult.failure
      ? productionResult.interpretation : undefined;
    if (!interpretation && responseReceived && !failureCode) {
      failureCode = safeFailureCode(null, SAFE_FAILURE_CODES.has(productionResult?.failure) ? productionResult.failure : 'INVALID_RESPONSE');
    }
    const safeScores = scoreSafeInterpretation(question, interpretation, jurisdictionFixed);
    const outcome = interpretation ? 'VALID_INTERPRETATION'
      : failureCode === 'TIMEOUT' ? 'TIMEOUT'
        : failureCode === 'RATE_LIMITED' ? 'RATE_LIMITED'
          : responseReceived ? 'INVALID_RESPONSE' : 'PROVIDER_ERROR';
    rawResponse = undefined;
    interpretation = undefined;
    productionResult = undefined;

    const sourceAfter = await hashNamedFilesFn(SOURCE_FILES);
    const fixturesAfter = await hashNamedFilesFn(FIXTURE_FILES);
    const protectedAfterRequest = await verifyProtectedArtifacts();
    const historicalAfterRequest = await verifyHistoricalArtifacts();
    if (!sameManifest(expectedPreRegistration.sourceFingerprints, sourceAfter) ||
        !sameManifest(expectedPreRegistration.fixtureFingerprints, fixturesAfter) ||
        protectedAfterRequest.baselineSha256 !== expectedPreRegistration.protectedObservationBaseline.baselineSha256 ||
        protectedAfterRequest.protectedArtifactCount !== expectedPreRegistration.protectedObservationBaseline.protectedArtifactCount ||
        historicalAfterRequest.artifactCount !== expectedPreRegistration.protectedV3ObservationArtifacts) {
      throw new Error('A V4 diagnostic source, fixture, or protected observation changed during measurement.');
    }
    observations.push({
      questionId: question.id,
      replicate: scheduled.replicate,
      requestStartGapMs,
      requestCount: callCount,
      outcome,
      responseReceived,
      ...(failureCode ? { failureCode: SAFE_FAILURE_CODES.has(failureCode) ? failureCode : 'PROVIDER_ERROR' } : {}),
      subjectMatcherPass: safeScores.subjectMatcherPass,
      subjectDiagnostics: safeScores.subjectDiagnostics,
      dimensions: safeScores.dimensions,
      requestDurationMs: transportDurationMs
    });
  }

  const sourceAfter = await hashNamedFilesFn(SOURCE_FILES);
  const fixturesAfter = await hashNamedFilesFn(FIXTURE_FILES);
  const protectedAfter = await verifyProtectedArtifacts();
  const historicalAfter = await verifyHistoricalArtifacts();
  if (!sameManifest(expectedPreRegistration.sourceFingerprints, sourceAfter) ||
      !sameManifest(expectedPreRegistration.fixtureFingerprints, fixturesAfter) ||
      protectedAfter.baselineSha256 !== expectedPreRegistration.protectedObservationBaseline.baselineSha256 ||
      protectedAfter.protectedArtifactCount !== expectedPreRegistration.protectedObservationBaseline.protectedArtifactCount ||
      historicalAfter.artifactCount !== expectedPreRegistration.protectedV3ObservationArtifacts ||
      requestCount !== 6 || transportCallCount !== 6 || observations.length !== 6) {
    throw new Error('The V4 residency diagnostic failed a required integrity or schedule guard.');
  }
  const document = {
    schemaVersion: 4,
    profileVersion: evaluationConfig.profileVersion,
    diagnosticOnly: true,
    model: evaluationConfig.model,
    timeoutMs: evaluationConfig.timeoutMs,
    temperature: evaluationConfig.temperature,
    scheduledCallCount: expectedPreRegistration.scheduledCallCount,
    requestCount,
    transportCallCount,
    minimumStartGapMs: evaluationConfig.minimumStartGapMs,
    minimumObservedStartGapMs: observations.slice(1).reduce((minimum, row) => Math.min(minimum, row.requestStartGapMs), Infinity),
    scheduleSha256: expectedPreRegistration.scheduleSha256,
    sourceFingerprints: expectedPreRegistration.sourceFingerprints,
    fixtureFingerprints: expectedPreRegistration.fixtureFingerprints,
    protectedObservationBaseline: {
      ...expectedPreRegistration.protectedObservationBaseline,
      verifiedBefore: true,
      verifiedAfter: true
    },
    protectedV3ObservationArtifacts: expectedPreRegistration.protectedV3ObservationArtifacts,
    observations,
    startedAt,
    completedAt: now().toISOString()
  };
  try {
    await writeFileFn(jsonPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await writeFileFn(markdownPath, renderMarkdown(document), { encoding: 'utf8', flag: 'wx' });
  } catch {
    throw new Error('A V4 residency diagnostic output already exists or could not be written.');
  }
  return document;
}

async function main() {
  if (process.argv.length !== 3 || !['--plan', '--live'].includes(process.argv[2])) {
    throw new Error('Residency diagnostic requires --plan or --live.');
  }
  const result = await runSemanticResidencySubjectDiagnosticV4({ mode: process.argv[2] === '--plan' ? 'plan' : 'live' });
  process.stdout.write(`${JSON.stringify({ mode: result.mode || 'live', requestCount: result.requestCount || 0, scheduledCallCount: result.scheduledCallCount || result.preRegistration?.scheduledCallCount })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    const safeMessages = new Set([
      'Residency diagnostic requires --plan or --live.',
      'A V4 preregistration is required before live mode.',
      'The V4 preregistration no longer matches the fixed schedule or fingerprints.',
      'The V4 preregistration has already been consumed.',
      'The V4 live reservation could not be created.',
      'The fixed V4 residency diagnostic configuration changed.',
      'A V4 diagnostic source, fixture, or protected observation changed during measurement.',
      'The protected V1/V2 observation baseline changed.',
      'A protected V1/V2 observation artifact changed.',
      'A protected V3 residency observation artifact changed.',
      'A V4 residency diagnostic output already exists.',
      'A V4 residency diagnostic output already exists or could not be written.',
      'A fixed diagnostic fingerprint could not be read.',
      'GEMINI_API_KEY is not configured.',
      'Each fixed V4 residency observation must make exactly one correctly paced request.',
      'Each V4 residency observation must make exactly one provider request.',
      'The V4 residency diagnostic failed a required integrity or schedule guard.'
    ]);
    process.stderr.write(`${safeMessages.has(error?.message) ? error.message : 'V4 residency diagnostic failed.'}\n`);
    process.exitCode = 1;
  });
}
