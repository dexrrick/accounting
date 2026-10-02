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
import { diagnoseSemanticResponse } from './semantic-contract-diagnosis.mjs';
import { matchIssues, scoreIssueDimensions } from './multi-authority-issue-scoring.mjs';
import evaluationConfig from './semantic-residency-diagnostic-v3-config.json' with { type: 'json' };

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '../../..');
const OUTPUT_DIRECTORY = path.join(PROJECT_ROOT, 'docs', 'evaluation', 'multi-authority-workstreams', 'residency-diagnostic-v3');
const OUTPUT_PREFIX = evaluationConfig.outputPrefix;
const BASELINE_PATH = path.join(PROJECT_ROOT, evaluationConfig.protectedObservationBaseline);
const BASELINE_SHA256 = '346ff7580ea716a051de54bbede0be7c0689894ef1c87568688992d87fbb5700';
const CONFIG_SHA256 = '304fa005a233a56161a8a964842d6582e9b21ad19224f2d7863aaafa66778408';
const FAILURE_CODES = new Set(['TIMEOUT', 'PROVIDER_ERROR', 'RATE_LIMITED', 'INVALID_RESPONSE', 'LOW_CONFIDENCE', 'QUERY_TOO_LONG']);
const REJECTION_CODES = new Set([
  'NONE', 'WRONG_ROOT_TYPE', 'MISSING_KEY', 'UNEXPECTED_KEY', 'WRONG_TYPE', 'COUNT_LIMIT', 'INVALID_LABEL',
  'INVALID_AUTHORITY', 'INVALID_ENUM', 'INVALID_POPULATION', 'INVALID_DOMAIN', 'INVALID_OPERATION',
  'INVALID_EVIDENCE_REQUIREMENT', 'INVALID_CONCEPT_ROLE', 'INVALID_SCHEMA_VERSION', 'INVALID_TOPIC_ID',
  'DUPLICATE_AUTHORITY', 'AUTHORITY_OVERLAP', 'DOMAIN_AUTHORITY_MISMATCH', 'CALCULATION_FLAG_MISMATCH',
  'CASE_FLAG_CONTRADICTION', 'JOURNAL_DOMAIN_MISMATCH', 'UNKNOWN_AUTHORITY_MIX', 'ISSUE_COUNT_LIMIT',
  'LOW_CONFIDENCE', 'INVALID_CONFIDENCE', 'CONFIDENCE_OUT_OF_RANGE', 'CONTRADICTORY_FIELDS',
  'SCHEMA_MISMATCH', 'MALFORMED_JSON', 'RESPONSE_TOO_LARGE', 'EMPTY_ISSUES', 'ISSUE_STRUCTURE',
  'UNCLASSIFIED_REJECTION'
]);
const SOURCE_FILES = Object.freeze({
  semanticInterpretation: path.join(PROJECT_ROOT, 'src', 'services', 'semanticQuestionUnderstanding.ts'),
  transport: path.join(PROJECT_ROOT, 'src', 'services', 'aiTransport.ts'),
  responseDiagnostics: path.join(SCRIPT_DIRECTORY, 'semantic-contract-diagnosis.mjs'),
  issueScoring: path.join(SCRIPT_DIRECTORY, 'multi-authority-issue-scoring.mjs'),
  diagnosticRunner: fileURLToPath(import.meta.url)
});
const FIXTURE_FILES = Object.freeze({
  fixedConfiguration: path.join(SCRIPT_DIRECTORY, 'semantic-residency-diagnostic-v3-config.json'),
  protectedObservationBaseline: BASELINE_PATH
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function hashNamedFiles(files) {
  const values = await Promise.all(Object.entries(files).map(async ([name, filePath]) => {
    try {
      return [name, sha256(await readFile(filePath))];
    } catch {
      throw new Error('A fixed diagnostic fingerprint could not be read.');
    }
  }));
  return Object.fromEntries(values);
}

function sameManifest(left, right) {
  const leftKeys = Object.keys(left || {});
  const rightKeys = Object.keys(right || {});
  return leftKeys.length === rightKeys.length && leftKeys.every(key => left[key] === right[key]);
}

function validateFixedConfiguration() {
  const expectedIds = [
    'corporate-residency-original-general',
    'corporate-residency-general-paraphrase',
    'corporate-residency-case-applied-control'
  ];
  if (evaluationConfig.schemaVersion !== 3 || evaluationConfig.profileVersion !== 'semantic-residency-diagnostic-v3' ||
      evaluationConfig.model !== 'gemini-3.5-flash-lite' || evaluationConfig.timeoutMs !== 8000 ||
      evaluationConfig.timeoutMs !== SEMANTIC_QUESTION_TIMEOUT_MS || evaluationConfig.temperature !== 0 ||
      evaluationConfig.jsonMode !== true || evaluationConfig.retryCount !== 0 ||
      evaluationConfig.minimumStartGapMs !== 15_250 || evaluationConfig.observationsPerQuestion !== 2 ||
      JSON.stringify(evaluationConfig.questionIds) !== JSON.stringify(expectedIds) ||
      evaluationConfig.questions.length !== 3 || JSON.stringify(evaluationConfig.questions.map(item => item.id)) !== JSON.stringify(expectedIds) ||
      evaluationConfig.schedule.length !== 6 ||
      evaluationConfig.schedule.some((item, index) => item.questionId !== [expectedIds[0], expectedIds[1], expectedIds[2], expectedIds[2], expectedIds[1], expectedIds[0]][index] ||
        item.replicate !== (index < 3 ? 1 : 2))) {
    throw new Error('The fixed residency diagnostic configuration changed.');
  }
  const questions = evaluationConfig.questions;
  const common = question => question.expected.rootPopulation[0] === 'COMPANY' &&
    question.expected.rootDomain[0] === 'IRAS_INCOME_TAX' &&
    JSON.stringify(question.expected.rootAuthorities) === JSON.stringify(['IRAS']) &&
    JSON.stringify(question.expected.rootContextualAuthoritiesAnyOf) === JSON.stringify([[]]) &&
    question.expected.issueCount === 1 && question.expected.issues.length === 1 &&
    question.expected.issues[0].population[0] === 'COMPANY' &&
    question.expected.issues[0].domain[0] === 'IRAS_INCOME_TAX' &&
    JSON.stringify(question.expected.issues[0].governingAuthorities) === JSON.stringify(['IRAS']) &&
    JSON.stringify(question.expected.issues[0].contextualAuthoritiesAnyOf) === JSON.stringify([[]]);
  if (questions.some(question => !common(question)) ||
      questions[0].expected.rootOperation[0] !== 'EXPLAIN_RULE' || questions[0].expected.requiresUserSpecificFacts !== false ||
      questions[0].expected.issues[0].operation[0] !== 'EXPLAIN_RULE' ||
      questions[1].expected.rootOperation[0] !== 'EXPLAIN_RULE' || questions[1].expected.requiresUserSpecificFacts !== false ||
      questions[1].expected.issues[0].operation[0] !== 'EXPLAIN_RULE' ||
      questions[2].expected.rootOperation[0] !== 'DETERMINE_TREATMENT' || questions[2].expected.requiresUserSpecificFacts !== true ||
      questions[2].expected.issues[0].operation[0] !== 'DETERMINE_TREATMENT') {
    throw new Error('The fixed residency diagnostic expectations changed.');
  }
}

function safeArtifactPath(value) {
  return typeof value === 'string' && /^docs\/evaluation\/multi-authority-workstreams\/iras-first-live-2026-10-02-v[12]\/[a-z0-9._-]+$/i.test(value);
}

function safeHistoricalArtifactPath(value) {
  if (typeof value !== 'string' || value.includes('\\') || value.startsWith('/')) return false;
  const segments = value.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || /[<>:"|?*]/.test(segment) ||
      [...segment].some(character => character.charCodeAt(0) < 32))) return false;
  const resolved = path.resolve(PROJECT_ROOT, ...segments);
  const relative = path.relative(PROJECT_ROOT, resolved);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function addProtectedArtifact(artifacts, item, allowOwnArtifactPath = false) {
  if (!item || typeof item !== 'object') throw new Error('The protected V1/V2 observation baseline changed.');
  const validPath = allowOwnArtifactPath ? safeArtifactPath(item.path) : safeHistoricalArtifactPath(item.path);
  if (!validPath || !/^[a-f0-9]{64}$/.test(item.sha256) ||
      item.bytes !== undefined && (!Number.isInteger(item.bytes) || item.bytes < 0)) {
    throw new Error('The protected V1/V2 observation baseline changed.');
  }
  const previous = artifacts.get(item.path);
  if (previous && (previous.sha256 !== item.sha256 ||
      previous.bytes !== undefined && item.bytes !== undefined && previous.bytes !== item.bytes)) {
    throw new Error('The protected V1/V2 observation baseline changed.');
  }
  artifacts.set(item.path, {
    sha256: item.sha256,
    bytes: previous?.bytes ?? item.bytes,
    current: previous?.current
  });
}

export async function verifyProtectedObservationBaseline({
  baselinePath = BASELINE_PATH,
  readFileFn = readFile
} = {}) {
  let baselineBytes;
  let baseline;
  try {
    baselineBytes = await readFileFn(baselinePath);
    if (sha256(baselineBytes) !== BASELINE_SHA256) throw new Error('baseline mismatch');
    baseline = JSON.parse(baselineBytes.toString('utf8'));
  } catch {
    throw new Error('The protected V1/V2 observation baseline changed.');
  }
  if (baseline.schemaVersion !== 3 || baseline.baselineVersion !== 'semantic-residency-diagnostic-v3-protected-observations' ||
      baseline.artifactCount !== 14 || !Array.isArray(baseline.protectedArtifacts) || baseline.protectedArtifacts.length !== 14) {
    throw new Error('The protected V1/V2 observation baseline changed.');
  }
  const artifacts = new Map();
  const ownArtifacts = new Set();
  for (const item of baseline.protectedArtifacts) {
    if (ownArtifacts.has(item?.path)) throw new Error('The protected V1/V2 observation baseline changed.');
    addProtectedArtifact(artifacts, item, true);
    ownArtifacts.add(item.path);
    try {
      const current = await readFileFn(path.join(PROJECT_ROOT, item.path));
      if (current.length !== item.bytes || sha256(current) !== item.sha256) {
        throw new Error('artifact mismatch');
      }
      artifacts.get(item.path).current = current;
    } catch {
      throw new Error('A protected V1/V2 observation artifact changed.');
    }
  }
  const historicalManifests = [
    {
      path: 'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v1/historical-artifact-hashes.json',
      baselineCommit: 'd194d2bc7121b2c9a1deec562f77eafdfb98cd90',
      artifactCount: 110
    },
    {
      path: 'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v2/historical-artifact-hashes.json',
      baselineCommit: '4bd3abc9c22619401f22aa8abba73af61b5d6217',
      artifactCount: 118
    }
  ];
  try {
    for (const pinnedManifest of historicalManifests) {
      if (!ownArtifacts.has(pinnedManifest.path)) throw new Error('missing pinned historical manifest');
      const manifestBytes = artifacts.get(pinnedManifest.path)?.current;
      const manifest = JSON.parse(manifestBytes.toString('utf8'));
      if (manifest?.baselineCommit !== pinnedManifest.baselineCommit || !Array.isArray(manifest.artifacts) ||
          manifest.artifacts.length !== pinnedManifest.artifactCount) throw new Error('invalid historical manifest');
      const manifestPaths = new Set();
      for (const item of manifest.artifacts) {
        if (!item || manifestPaths.has(item.path)) throw new Error('duplicate historical artifact');
        addProtectedArtifact(artifacts, item);
        manifestPaths.add(item.path);
      }
    }
  } catch {
    throw new Error('The protected V1/V2 observation baseline changed.');
  }
  await Promise.all([...artifacts.entries()].map(async ([artifactPath, item]) => {
    let current = item.current;
    if (!current) {
      try {
        current = await readFileFn(path.resolve(PROJECT_ROOT, artifactPath));
      } catch {
        throw new Error('A protected V1/V2 observation artifact changed.');
      }
    }
    if ((item.bytes !== undefined && current.length !== item.bytes) || sha256(current) !== item.sha256) {
      throw new Error('A protected V1/V2 observation artifact changed.');
    }
  }));
  return { baselineSha256: BASELINE_SHA256, protectedArtifactCount: artifacts.size };
}

export function buildResidencyDiagnosticSchedule() {
  return evaluationConfig.schedule.map(item => ({ ...item }));
}

function fixedProviderSettings(apiKey) {
  return {
    activeProvider: 'gemini',
    azure: { endpoint: '', apiKey: '', deploymentName: 'gpt-4o', apiVersion: '2024-08-01-preview' },
    gemini: { apiKey: apiKey.trim(), model: evaluationConfig.model },
    openai: { apiKey: '', model: 'gpt-4o', baseUrl: '' }
  };
}

function safeFailureCode(value) {
  return FAILURE_CODES.has(value) ? value : 'PROVIDER_ERROR';
}

function safeEnum(value, allowed) {
  return allowed.includes(value) ? value : 'UNKNOWN';
}

function safeEnumArray(values, allowed) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter(value => allowed.includes(value)))].sort();
}

function sameSet(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length &&
    [...actual].sort().every((item, index) => item === [...expected].sort()[index]);
}

function safeExpected(question) {
  const expected = question.expected;
  return {
    rootOperation: [...expected.rootOperation],
    rootPopulation: [...expected.rootPopulation],
    rootDomain: [...expected.rootDomain],
    rootAuthorities: [...expected.rootAuthorities],
    rootContextualAuthoritiesAnyOf: expected.rootContextualAuthoritiesAnyOf.map(set => [...set]),
    requiresUserSpecificFacts: expected.requiresUserSpecificFacts,
    issueCount: expected.issueCount,
    issues: expected.issues.map(issue => ({
      population: [...issue.population],
      domain: [...issue.domain],
      governingAuthorities: [...issue.governingAuthorities],
      contextualAuthoritiesAnyOf: issue.contextualAuthoritiesAnyOf.map(set => [...set]),
      operation: [...issue.operation]
    }))
  };
}

function safeActualAndDimensions(question, interpretation) {
  if (!interpretation || !Array.isArray(interpretation.issues)) return { actual: null, dimensions: null, issueSubjectMatches: [] };
  const expected = question.expected;
  const actualIssues = interpretation.issues;
  const { expectedByActual } = matchIssues(expected.issues, actualIssues);
  const root = {
    operation: safeEnum(interpretation.requestedOperation, SEMANTIC_OPERATION_VALUES),
    population: safeEnum(interpretation.population, SEMANTIC_POPULATION_VALUES),
    domain: safeEnum(interpretation.domain, SEMANTIC_DOMAIN_VALUES),
    authorities: safeEnumArray(interpretation.authorityCandidates, SEMANTIC_AUTHORITY_VALUES),
    contextualAuthorities: safeEnumArray(interpretation.contextualAuthorities, SEMANTIC_AUTHORITY_VALUES),
    requiresUserSpecificFacts: interpretation.requiresUserSpecificFacts === true
  };
  const rootDimensions = {
    operation: expected.rootOperation.includes(root.operation),
    population: expected.rootPopulation.includes(root.population),
    domain: expected.rootDomain.includes(root.domain),
    authorities: sameSet(root.authorities, expected.rootAuthorities),
    contextualAuthorities: expected.rootContextualAuthoritiesAnyOf.some(set => sameSet(root.contextualAuthorities, set)),
    requiresUserSpecificFacts: root.requiresUserSpecificFacts === expected.requiresUserSpecificFacts
  };
  const issueResults = actualIssues.map((issue, actualIndex) => {
    const expectedIndex = expectedByActual.get(actualIndex);
    const comparisonExpected = expected.issues[expectedIndex ?? actualIndex];
    const dimensions = comparisonExpected ? scoreIssueDimensions(issue, comparisonExpected) : {
      governingAuthority: false, contextualAuthority: false, domain: false, population: false, operation: false
    };
    return {
      subjectMatched: expectedIndex !== undefined,
      dimensions,
      actual: {
        operation: safeEnum(issue.operation, SEMANTIC_OPERATION_VALUES),
        population: safeEnum(issue.population, SEMANTIC_POPULATION_VALUES),
        domain: safeEnum(issue.domain, SEMANTIC_DOMAIN_VALUES),
        governingAuthorities: safeEnumArray(issue.governingAuthorities, SEMANTIC_AUTHORITY_VALUES),
        contextualAuthorities: safeEnumArray(issue.contextualAuthorities, SEMANTIC_AUTHORITY_VALUES)
      }
    };
  });
  const allDimensionsMatch = actualIssues.length === expected.issueCount &&
    rootDimensions.operation && rootDimensions.population && rootDimensions.domain && rootDimensions.authorities &&
    rootDimensions.contextualAuthorities && rootDimensions.requiresUserSpecificFacts &&
    issueResults.length === expected.issues.length && issueResults.every(item => item.subjectMatched && Object.values(item.dimensions).every(Boolean));
  return {
    actual: { ...root, issueCount: actualIssues.length, issues: issueResults.map(item => item.actual) },
    dimensions: {
      root: rootDimensions,
      issues: issueResults.map(({ dimensions }) => dimensions),
      allDimensionsMatch
    },
    issueSubjectMatches: issueResults.map(item => item.subjectMatched)
  };
}

async function refuseExistingOutputFiles(outputDirectory) {
  for (const extension of ['json', 'md']) {
    try {
      await access(path.join(outputDirectory, `${OUTPUT_PREFIX}.${extension}`));
      throw new Error('The residency diagnostic output already exists.');
    } catch (error) {
      if (error?.message === 'The residency diagnostic output already exists.') throw error;
      if (error?.code !== 'ENOENT') throw new Error('The residency diagnostic output path is unavailable.');
    }
  }
}

function renderMarkdown(document) {
  const lines = [
    '# Singapore corporate residency semantic diagnostic V3',
    '',
    `- Profile: ${document.profileVersion}`,
    `- Model: ${document.model}`,
    `- Requests: ${document.requestCount} / ${document.scheduledCallCount}`,
    `- Minimum observed request-start gap: ${document.minimumObservedStartGapMs} ms`,
    `- Protected V1/V2 artifacts reverified: ${document.protectedObservationBaseline.protectedArtifactCount}`,
    '',
    'This fixed diagnostic reports semantic dimensions only. It is not an acceptance decision or an accounting/tax conclusion.',
    '',
    '| Question ID | Replicate | Outcome | Request duration (ms) | Valid interpretation | Subject match | Root dimensions | Issue dimensions | Derived case specificity |',
    '| --- | ---: | --- | ---: | --- | --- | --- | --- | --- |'
  ];
  for (const row of document.observations) {
    const actual = row.actual;
    const root = row.dimensions?.root;
    const issue = row.dimensions?.issues?.[0];
    const dimensionsAsText = dimensions => dimensions ? Object.values(dimensions).every(Boolean) : false;
    lines.push(`| ${row.questionId} | ${row.replicate} | ${row.outcome} | ${row.requestDurationMs} | ${row.validInterpretation} | ${row.issueSubjectMatches[0] ?? false} | ${dimensionsAsText(root)} | ${dimensionsAsText(issue)} | ${actual?.requiresUserSpecificFacts ?? '—'} |`);
  }
  lines.push('', 'No raw query, prompt, response, subject, fact text, URL, or credential is persisted.', '');
  return lines.join('\n');
}

/** Fixed six-call semantic diagnostic. The injected transport is only for no-API safety tests. */
export async function runSemanticResidencyDiagnosticV3({
  live = false,
  apiKey = process.env.GEMINI_API_KEY,
  outputDirectory = OUTPUT_DIRECTORY,
  execute = executeStructuredLlmCall,
  interpret = interpretSemanticQuestion,
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  monotonicNow = () => performance.now(),
  now = () => new Date(),
  hashNamedFilesFn = hashNamedFiles,
  verifyProtectedArtifacts = verifyProtectedObservationBaseline
} = {}) {
  if (!live) throw new Error('Residency diagnostic requires --live.');
  validateFixedConfiguration();
  const resolvedOutputDirectory = path.resolve(outputDirectory);
  await mkdir(resolvedOutputDirectory, { recursive: true });
  await refuseExistingOutputFiles(resolvedOutputDirectory);
  if (typeof apiKey !== 'string' || apiKey.trim().length <= 10) throw new Error('GEMINI_API_KEY is not configured.');
  const sourceFingerprints = await hashNamedFilesFn(SOURCE_FILES);
  const fixtureFingerprints = await hashNamedFilesFn(FIXTURE_FILES);
  const protectedBefore = await verifyProtectedArtifacts();
  if (fixtureFingerprints.fixedConfiguration !== CONFIG_SHA256 ||
      fixtureFingerprints.protectedObservationBaseline !== BASELINE_SHA256) {
    throw new Error('The fixed residency diagnostic configuration changed.');
  }
  const questionsById = new Map(evaluationConfig.questions.map(question => [question.id, question]));
  const promptSchemaFingerprints = {};
  const observations = [];
  let previousRequestStart;
  let requestCount = 0;
  let transportCallCount = 0;
  const startedAt = now().toISOString();

  for (let index = 0; index < evaluationConfig.schedule.length; index += 1) {
    if (index > 0) await sleep(evaluationConfig.minimumStartGapMs);
    const sourceBefore = await hashNamedFilesFn(SOURCE_FILES);
    const fixturesBefore = await hashNamedFilesFn(FIXTURE_FILES);
    const protectedBeforeRequest = await verifyProtectedArtifacts();
    if (!sameManifest(sourceFingerprints, sourceBefore) || !sameManifest(fixtureFingerprints, fixturesBefore) ||
        protectedBeforeRequest.baselineSha256 !== protectedBefore.baselineSha256 ||
        protectedBeforeRequest.protectedArtifactCount !== protectedBefore.protectedArtifactCount) {
      throw new Error('A diagnostic source, fixture, or protected observation changed during measurement.');
    }

    const scheduled = evaluationConfig.schedule[index];
    const question = questionsById.get(scheduled.questionId);
    if (!question) throw new Error('The fixed residency diagnostic configuration changed.');
    let callCount = 0;
    let rawResponse;
    let responseReceived = false;
    let transportDurationMs;
    let providerStatus;
    let failureCode;
    let requestStartGapMs;
    let promptFingerprint;
    const callStructured = async (prompt, system, provider, options) => {
      callCount += 1;
      if (callCount > 1) throw new Error('A scheduled residency call attempted a retry.');
      const requiredOptionKeys = ['jsonMode', 'responseJsonSchema', 'temperature', 'timeoutMs'];
      if (provider?.activeProvider !== 'gemini' || provider.gemini?.apiKey !== apiKey.trim() ||
          provider.gemini?.model !== evaluationConfig.model || !options ||
          JSON.stringify(Object.keys(options).sort()) !== JSON.stringify(requiredOptionKeys) ||
          options.jsonMode !== true || options.temperature !== 0 || options.timeoutMs !== evaluationConfig.timeoutMs ||
          JSON.stringify(options.responseJsonSchema) !== JSON.stringify(SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA)) {
        throw new Error('The fixed structured residency request changed.');
      }
      const schemaJson = JSON.stringify(options.responseJsonSchema);
      promptFingerprint = {
        promptSha256: sha256(prompt),
        systemSha256: sha256(system),
        schemaSha256: sha256(schemaJson)
      };
      const priorFingerprint = promptSchemaFingerprints[scheduled.questionId];
      if (priorFingerprint && JSON.stringify(priorFingerprint) !== JSON.stringify(promptFingerprint)) {
        throw new Error('A fixed residency prompt or schema changed between replicates.');
      }
      promptSchemaFingerprints[scheduled.questionId] = promptFingerprint;
      const start = monotonicNow();
      requestStartGapMs = previousRequestStart === undefined ? null : Math.round(start - previousRequestStart);
      if (requestStartGapMs !== null && requestStartGapMs < evaluationConfig.minimumStartGapMs) {
        throw new Error('The residency diagnostic request-start gap was too short.');
      }
      previousRequestStart = start;
      const transportStarted = monotonicNow();
      try {
        transportCallCount += 1;
        rawResponse = await execute(prompt, system, provider, options);
        responseReceived = typeof rawResponse === 'string';
        if (!responseReceived) throw new Error('The provider returned a non-text response.');
        return rawResponse;
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        failureCode = /HTTP\s+429/i.test(message) ? 'RATE_LIMITED'
          : /abort|timed\s*out|timeout/i.test(message) ? 'TIMEOUT' : 'PROVIDER_ERROR';
        const status = message.match(/HTTP\s+(\d{3})\./)?.[1];
        providerStatus = status && Number(status) >= 100 && Number(status) <= 599 ? Number(status) : undefined;
        throw error;
      } finally {
        transportDurationMs = Math.round((monotonicNow() - transportStarted) * 100) / 100;
      }
    };

    let productionResult;
    try {
      productionResult = await interpret(question.question, fixedProviderSettings(apiKey), callStructured);
    } catch {
      productionResult = { mode: 'DETERMINISTIC_FALLBACK', failure: failureCode || 'PROVIDER_ERROR' };
    }
    if (callCount !== 1 || requestStartGapMs === undefined || index > 0 && requestStartGapMs < evaluationConfig.minimumStartGapMs) {
      throw new Error('Each fixed residency observation must make exactly one correctly paced request.');
    }
    requestCount += callCount;
    const interpretation = productionResult?.mode === 'SEMANTIC_INTERPRETATION' && !productionResult.failure
      ? productionResult.interpretation : undefined;
    const responseDiagnostic = diagnoseSemanticResponse(rawResponse, question.question);
    rawResponse = undefined;
    const failure = productionResult?.failure ? safeFailureCode(productionResult.failure) : failureCode;
    const outcome = responseReceived ? 'RESPONSE_RECEIVED' : failure === 'TIMEOUT' ? 'TIMEOUT'
      : failure === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'PROVIDER_ERROR';
    const comparison = safeActualAndDimensions(question, interpretation);
    const sourceAfter = await hashNamedFilesFn(SOURCE_FILES);
    const fixturesAfter = await hashNamedFilesFn(FIXTURE_FILES);
    const protectedAfterRequest = await verifyProtectedArtifacts();
    if (!sameManifest(sourceFingerprints, sourceAfter) || !sameManifest(fixtureFingerprints, fixturesAfter) ||
        protectedAfterRequest.baselineSha256 !== protectedBefore.baselineSha256 ||
        protectedAfterRequest.protectedArtifactCount !== protectedBefore.protectedArtifactCount) {
      throw new Error('A diagnostic source, fixture, or protected observation changed during measurement.');
    }
    observations.push({
      questionId: question.id,
      replicate: scheduled.replicate,
      requestStartGapMs,
      requestCount: callCount,
      outcome,
      responseReceived,
      ...(failure ? { failureCode: FAILURE_CODES.has(failure) ? failure : 'PROVIDER_ERROR' } : {}),
      ...(Number.isInteger(providerStatus) ? { providerStatus } : {}),
      validInterpretation: Boolean(interpretation),
      rejectionCode: responseReceived
        ? REJECTION_CODES.has(responseDiagnostic.rejectionCode) ? responseDiagnostic.rejectionCode : 'UNCLASSIFIED_REJECTION'
        : 'NONE',
      expected: safeExpected(question),
      actual: comparison.actual,
      actualIssueCount: comparison.actual?.issueCount ?? responseDiagnostic.safeShape?.issueCount ?? 0,
      issueSubjectMatches: comparison.issueSubjectMatches,
      dimensions: comparison.dimensions,
      requestDurationMs: transportDurationMs,
      completionLatencyMs: responseReceived ? transportDurationMs : undefined,
      promptSha256: promptFingerprint?.promptSha256,
      systemSha256: promptFingerprint?.systemSha256,
      schemaSha256: promptFingerprint?.schemaSha256
    });
  }

  const sourceAfter = await hashNamedFilesFn(SOURCE_FILES);
  const fixturesAfter = await hashNamedFilesFn(FIXTURE_FILES);
  const protectedAfter = await verifyProtectedArtifacts();
  if (!sameManifest(sourceFingerprints, sourceAfter) || !sameManifest(fixtureFingerprints, fixturesAfter) ||
      protectedAfter.baselineSha256 !== protectedBefore.baselineSha256 ||
      protectedAfter.protectedArtifactCount !== protectedBefore.protectedArtifactCount ||
      requestCount !== 6 || transportCallCount !== 6 || Object.keys(promptSchemaFingerprints).length !== 3) {
    throw new Error('The residency diagnostic failed a required integrity or schedule guard.');
  }

  const document = {
    schemaVersion: 3,
    profileVersion: evaluationConfig.profileVersion,
    diagnosticOnly: true,
    model: evaluationConfig.model,
    timeoutMs: evaluationConfig.timeoutMs,
    temperature: evaluationConfig.temperature,
    scheduledCallCount: evaluationConfig.schedule.length,
    requestCount,
    transportCallCount,
    minimumStartGapMs: evaluationConfig.minimumStartGapMs,
    minimumObservedStartGapMs: observations.slice(1).reduce((minimum, row) => Math.min(minimum, row.requestStartGapMs), Infinity),
    promptSchemaFingerprints,
    sourceFingerprints,
    fixtureFingerprints,
    protectedObservationBaseline: {
      baselineSha256: protectedBefore.baselineSha256,
      protectedArtifactCount: protectedBefore.protectedArtifactCount,
      verifiedBefore: true,
      verifiedAfter: true
    },
    observations,
    startedAt,
    completedAt: now().toISOString()
  };
  const jsonPath = path.join(resolvedOutputDirectory, `${OUTPUT_PREFIX}.json`);
  const markdownPath = path.join(resolvedOutputDirectory, `${OUTPUT_PREFIX}.md`);
  try {
    await writeFile(jsonPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await writeFile(markdownPath, renderMarkdown(document), { encoding: 'utf8', flag: 'wx' });
  } catch {
    throw new Error('The residency diagnostic output already exists or could not be written.');
  }
  return document;
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--live') throw new Error('Residency diagnostic requires --live.');
  const result = await runSemanticResidencyDiagnosticV3({ live: true });
  process.stdout.write(`${JSON.stringify({
    profileVersion: result.profileVersion,
    requestCount: result.requestCount,
    minimumObservedStartGapMs: result.minimumObservedStartGapMs,
    outputPrefix: OUTPUT_PREFIX
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    const safeMessages = new Set([
      'Residency diagnostic requires --live.',
      'The fixed residency diagnostic configuration changed.',
      'The protected V1/V2 observation baseline changed.',
      'A protected V1/V2 observation artifact changed.',
      'The residency diagnostic output already exists.',
      'The residency diagnostic output path is unavailable.',
      'GEMINI_API_KEY is not configured.',
      'A diagnostic source fingerprint could not be read.',
      'A fixed diagnostic fingerprint could not be read.',
      'A diagnostic source, fixture, or protected observation changed during measurement.',
      'Each fixed residency observation must make exactly one correctly paced request.',
      'The fixed structured residency request changed.',
      'A fixed residency prompt or schema changed between replicates.',
      'The residency diagnostic request-start gap was too short.',
      'The residency diagnostic failed a required integrity or schedule guard.',
      'The residency diagnostic output already exists or could not be written.'
    ]);
    process.stderr.write(`${safeMessages.has(error?.message) ? error.message : 'Residency diagnostic failed.'}\n`);
    process.exitCode = 1;
  });
}
