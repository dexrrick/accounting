import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { executeStructuredLlmCall } from '../../../src/services/aiTransport.ts';
import {
  interpretSemanticQuestion,
  SEMANTIC_QUESTION_TIMEOUT_MS,
  SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA
} from '../../../src/services/semanticQuestionUnderstanding.ts';
import { matchIssues, scoreIssueDimensions } from './multi-authority-issue-scoring.mjs';
import evaluationConfig from './iras-first-evaluation-config-v2.json' with { type: 'json' };
import {
  assertIrasFirstV2HistoricalArtifactsUnchanged,
  buildIrasV2TimeoutSchedule,
  computeIrasV2TimeoutRecommendation,
  loadIrasFirstV2TimeoutCases,
  profileConfiguration
} from './semantic-contract-followup-evaluation.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '../../..');
const OUTPUT_DIRECTORY = path.join(PROJECT_ROOT, 'docs', 'evaluation', 'multi-authority-workstreams', 'iras-first-live-2026-10-02-v2');
const OUTPUT_PREFIX = evaluationConfig.timeoutExperiment.outputPrefix;
const MODEL = evaluationConfig.timeoutExperiment.model;
const ARMS = Object.freeze([...evaluationConfig.timeoutExperiment.timeoutArmsMs]);
const MINIMUM_START_GAP_MS = evaluationConfig.timeoutExperiment.minimumStartGapMs;
const FAILURE_CODES = new Set(['TIMEOUT', 'PROVIDER_ERROR', 'RATE_LIMITED', 'INVALID_RESPONSE', 'LOW_CONFIDENCE', 'QUERY_TOO_LONG']);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function hashManifest(files) {
  const entries = await Promise.all(Object.entries(files).map(async ([key, filePath]) => {
    try {
      return [key, sha256(await readFile(filePath))];
    } catch {
      throw new Error('A required fixed evaluation case is missing.');
    }
  }));
  return Object.fromEntries(entries);
}

function sameManifest(left, right) {
  const keys = Object.keys(left || {});
  return keys.length === Object.keys(right || {}).length && keys.every(key => left[key] === right[key]);
}

async function normalizedSemanticInterpretationFingerprint() {
  const filePath = profileConfiguration('iras-first-targeted-v2-live').sourceFiles.semanticInterpretation;
  const source = await readFile(filePath, 'utf8');
  const pattern = /^export const SEMANTIC_QUESTION_TIMEOUT_MS = [0-9_]+;$/gm;
  if ((source.match(pattern) || []).length !== 1) throw new Error('The fixed timeout constant could not be fingerprinted.');
  return sha256(source.replace(pattern, 'export const SEMANTIC_QUESTION_TIMEOUT_MS = <approved-timeout>;'));
}

function validateFixedConfiguration() {
  const config = evaluationConfig.timeoutExperiment;
  assert.equal(config.protocolVersion, 'semantic-structured-timeout-v2');
  assert.equal(config.model, MODEL);
  assert.deepEqual(config.timeoutArmsMs, [8000, 12000, 15000]);
  assert.equal(config.observationsPerCaseArm, 2);
  assert.equal(config.minimumStartGapMs, 15_250);
  assert.equal(evaluationConfig.baselineProductionTimeoutMs, 8000);
  if (SEMANTIC_QUESTION_TIMEOUT_MS !== evaluationConfig.baselineProductionTimeoutMs) {
    throw new Error('The experiment baseline no longer matches the production timeout; supervisor review is required.');
  }
}

/** Six predetermined per-case arm orders balance positions and reverse on repeat. */
export function buildBalancedTimeoutSchedule(caseIds = evaluationConfig.timeoutExperiment.caseIds, arms = ARMS) {
  if (JSON.stringify(caseIds) !== JSON.stringify(evaluationConfig.timeoutExperiment.caseIds) ||
      JSON.stringify(arms) !== JSON.stringify(ARMS)) {
    throw new Error('The fixed timeout experiment schedule cannot be changed.');
  }
  return buildIrasV2TimeoutSchedule();
}

function fixedProviderSettings(apiKey) {
  return {
    activeProvider: 'gemini',
    azure: { endpoint: '', apiKey: '', deploymentName: 'gpt-4o', apiVersion: '2024-08-01-preview' },
    gemini: { apiKey: apiKey.trim(), model: MODEL },
    openai: { apiKey: '', model: 'gpt-4o', baseUrl: '' }
  };
}

function safeFailureCode(value) {
  return FAILURE_CODES.has(value) ? value : 'PROVIDER_ERROR';
}

function validSemanticInterpretation(testCase, interpretation) {
  if (!interpretation || !Array.isArray(interpretation.issues)) return false;
  if (interpretation.requiresUserSpecificFacts !== testCase.expectedRequiresUserSpecificFacts) return false;
  const actual = interpretation.issues;
  if (actual.length !== testCase.expected.length) return false;
  const { expectedByActual } = matchIssues(testCase.expected, actual);
  if (expectedByActual.size !== testCase.expected.length) return false;
  return [...expectedByActual.entries()].every(([actualIndex, expectedIndex]) => {
    const dimensions = scoreIssueDimensions(actual[actualIndex], testCase.expected[expectedIndex]);
    return Object.values(dimensions).every(Boolean);
  });
}

async function assertNoOutputExists(outputDirectory) {
  for (const extension of ['json', 'md']) {
    try {
      await access(path.join(outputDirectory, `${OUTPUT_PREFIX}.${extension}`));
      throw new Error('A structured-timeout experiment output file already exists.');
    } catch (error) {
      if (error?.message === 'A structured-timeout experiment output file already exists.') throw error;
      if (error?.code !== 'ENOENT') throw new Error('A structured-timeout experiment output path is unavailable.');
    }
  }
}

function responseStatistics(observations) {
  const byArm = Object.fromEntries(ARMS.map(arm => [arm, observations.filter(item => item.timeoutMs === arm)]));
  return Object.fromEntries(ARMS.map(arm => {
    const rows = byArm[arm];
    const received = rows.filter(item => item.responseReceived);
    const valid = rows.filter(item => item.validInterpretation);
    const latency = received.map(item => item.completionLatencyMs).sort((a, b) => a - b);
    const timeoutDuration = rows.filter(item => item.outcome === 'TIMEOUT').map(item => item.timeoutCensoredDurationMs).sort((a, b) => a - b);
    const failureDuration = rows.filter(item => item.providerFailureDurationMs !== undefined).map(item => item.providerFailureDurationMs).sort((a, b) => a - b);
    const distribution = values => values.length ? {
      count: values.length,
      min: values[0],
      median: values[Math.ceil(values.length / 2) - 1],
      p95: values[Math.ceil(values.length * 0.95) - 1],
      max: values.at(-1)
    } : { count: 0, min: null, median: null, p95: null, max: null };
    const describe = values => distribution([...values].sort((a, b) => a - b));
    return [arm, {
      scheduledCount: rows.length,
      responseReceivedCount: received.length,
      validInterpretationCount: valid.length,
      semanticCorrectCount: rows.filter(item => item.semanticCorrect).length,
      timeoutCount: rows.filter(item => item.outcome === 'TIMEOUT').length,
      providerFailureCount: rows.filter(item => ['PROVIDER_ERROR', 'RATE_LIMITED'].includes(item.outcome)).length,
      completionLatencyMs: distribution(latency),
      timeoutCensoredDurationMs: distribution(timeoutDuration),
      providerFailureDurationMs: distribution(failureDuration),
      descriptiveInputsAmongReceivedResponses: {
        promptChars: describe(received.map(item => item.promptChars)),
        issueCountAmongValidInterpretations: describe(valid.map(item => item.issueCount).filter(Number.isInteger)),
        outputBytesForNonemptyResponses: describe(received.map(item => item.outputBytes).filter(Number.isInteger)),
        receivedResponseDescriptors: received.map(item => ({
          caseId: item.caseId,
          promptChars: item.promptChars,
          ...(Number.isInteger(item.issueCount) ? { issueCount: item.issueCount } : {}),
          ...(Number.isInteger(item.outputBytes) ? { outputBytes: item.outputBytes } : {}),
          completionLatencyMs: item.completionLatencyMs
        }))
      }
    }];
  }));
}

function renderMarkdown(document) {
  const lines = [
    '# Structured semantic timeout experiment V2',
    '',
    `- Model: ${document.model}`,
    `- Calls: ${document.requestCount} / ${document.scheduledCallCount}`,
    `- Minimum observed request-start gap: ${document.minimumObservedStartGapMs} ms`,
    `- Baseline production timeout: ${document.productionTimeoutAtMeasurementMs} ms`,
    `- Recommended timeout: ${document.timeoutRecommendation.selectedTimeoutMs} ms (${document.timeoutRecommendation.decision})`,
    `- Protocol guards passed: ${document.protocolGuardsPassed}`,
    `- Historical artifacts reverified: ${document.protectedHistoricalArtifacts.verifiedAfter}`,
    '',
    'Response completion latency excludes timeouts. Timeout durations are reported separately as censored observations.',
    'All arm denominators include six scheduled calls. Prompt length, issue count, response bytes, and the fixed schema fingerprint are descriptive only; this three-case pilot does not identify causal effects.',
    '',
    '| Timeout | Scheduled | Responses | Valid | Semantically correct | Timeouts | Provider failures | Completion latency min / median / p95 / max (ms) | Timeout censored min / median / p95 / max (ms) |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |'
  ];
  for (const arm of ARMS) {
    const item = document.armSummaries[arm];
    const latency = item.completionLatencyMs;
    const censored = item.timeoutCensoredDurationMs;
    lines.push(`| ${arm} | ${item.scheduledCount} | ${item.responseReceivedCount} | ${item.validInterpretationCount} | ${item.semanticCorrectCount} | ${item.timeoutCount} | ${item.providerFailureCount} | ${latency.min ?? '—'} / ${latency.median ?? '—'} / ${latency.p95 ?? '—'} / ${latency.max ?? '—'} | ${censored.min ?? '—'} / ${censored.median ?? '—'} / ${censored.p95 ?? '—'} / ${censored.max ?? '—'} |`);
  }
  lines.push('', 'Per-observation descriptive response measurements:', '', '| Case ID | Timeout | Replicate | Outcome | Prompt chars | Issue count | Output bytes | Completion latency (ms) | Timeout censored duration (ms) |', '| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |');
  for (const item of document.observations) {
    lines.push(`| ${item.caseId} | ${item.timeoutMs} | ${item.replicate} | ${item.outcome} | ${item.promptChars} | ${item.issueCount ?? '—'} | ${item.outputBytes ?? '—'} | ${item.completionLatencyMs ?? '—'} | ${item.timeoutCensoredDurationMs ?? '—'} |`);
  }
  lines.push('', 'Recommendation criteria were preregistered in the versioned V2 evaluation config. This n=6/arm measurement is a limited pilot, not statistical proof.', '');
  return lines.join('\n');
}

/** Fixed 18-call pilot. Injected transport may change only timeoutMs; output is safe enum/count/hash data. */
export async function runSemanticStructuredTimeoutExperimentV2({
  live = false,
  apiKey = process.env.GEMINI_API_KEY,
  outputDirectory = OUTPUT_DIRECTORY,
  execute = executeStructuredLlmCall,
  interpret = interpretSemanticQuestion,
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  monotonicNow = () => performance.now(),
  now = () => new Date(),
  hashManifestFn = hashManifest,
  verifyProtectedArtifacts = assertIrasFirstV2HistoricalArtifactsUnchanged
} = {}) {
  if (!live) throw new Error('Structured-timeout experiment requires --live.');
  validateFixedConfiguration();
  const outputPath = path.resolve(outputDirectory);
  await mkdir(outputPath, { recursive: true });
  await assertNoOutputExists(outputPath);
  if (typeof apiKey !== 'string' || apiKey.trim().length <= 10) throw new Error('GEMINI_API_KEY is not configured.');

  const cases = await loadIrasFirstV2TimeoutCases();
  const startedAt = now().toISOString();
  const profile = profileConfiguration('iras-first-targeted-v2-live');
  const sourceFingerprints = await hashManifestFn(profile.sourceFiles);
  const fixtureFingerprints = await hashManifestFn(profile.fixtureFiles);
  const protectedBefore = await verifyProtectedArtifacts();
  const schedule = buildBalancedTimeoutSchedule();
  const caseById = new Map(cases.map(testCase => [testCase.id, testCase]));
  const promptSchemaFingerprints = {};
  const observations = [];
  let previousRequestStart;
  let minimumObservedStartGapMs = null;
  let requestCount = 0;

  for (let index = 0; index < schedule.length; index += 1) {
    if (index > 0) await sleep(MINIMUM_START_GAP_MS);
    const sourceBefore = await hashManifestFn(profile.sourceFiles);
    const fixturesBefore = await hashManifestFn(profile.fixtureFiles);
    const historyBefore = await verifyProtectedArtifacts();
    if (!sameManifest(sourceFingerprints, sourceBefore) || !sameManifest(fixtureFingerprints, fixturesBefore) ||
        historyBefore.verified !== true || historyBefore.baselineCommit !== protectedBefore.baselineCommit ||
        historyBefore.artifactCount !== protectedBefore.artifactCount) {
      throw new Error('Source, fixture, or protected-history fingerprint changed during the experiment.');
    }

    const scheduled = schedule[index];
    const testCase = caseById.get(scheduled.caseId);
    if (!testCase) throw new Error('A required fixed evaluation case is missing.');
    const cell = { responseReceived: false };
    let callCount = 0;
    let rawResponse;
    let transportStart;
    let requestStartGapMs;
    const captureStructuredCall = async (prompt, system, provider, options) => {
      if (callCount > 0) throw new Error('A scheduled call attempted a retry.');
      callCount += 1;
      if (!provider || provider.activeProvider !== 'gemini' || provider.gemini?.apiKey !== apiKey.trim() ||
          provider.gemini?.model !== MODEL) throw new Error('Fixed Gemini provider settings changed.');
      const expectedOptionKeys = ['jsonMode', 'responseJsonSchema', 'temperature', 'timeoutMs'];
      if (!options || JSON.stringify(Object.keys(options).sort()) !== JSON.stringify(expectedOptionKeys) ||
          options.jsonMode !== true || options.temperature !== 0 ||
          options.timeoutMs !== SEMANTIC_QUESTION_TIMEOUT_MS ||
          JSON.stringify(options.responseJsonSchema) !== JSON.stringify(SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA)) {
        throw new Error('Fixed structured semantic request options changed.');
      }
      const schemaJson = JSON.stringify(options.responseJsonSchema);
      const fingerprint = {
        promptSha256: sha256(prompt),
        promptChars: prompt.length,
        systemSha256: sha256(system),
        systemChars: system.length,
        schemaSha256: sha256(schemaJson),
        schemaBytes: Buffer.byteLength(schemaJson, 'utf8'),
        schemaChars: schemaJson.length
      };
      const existingFingerprint = promptSchemaFingerprints[scheduled.caseId];
      if (existingFingerprint && JSON.stringify(existingFingerprint) !== JSON.stringify(fingerprint)) {
        throw new Error('Prompt, system instruction, or schema changed across timeout arms.');
      }
      promptSchemaFingerprints[scheduled.caseId] = fingerprint;
      transportStart = monotonicNow();
      requestStartGapMs = previousRequestStart === undefined
        ? null : Math.round(transportStart - previousRequestStart);
      if (requestStartGapMs !== null) {
        minimumObservedStartGapMs = minimumObservedStartGapMs === null
          ? requestStartGapMs : Math.min(minimumObservedStartGapMs, requestStartGapMs);
      }
      previousRequestStart = transportStart;
      const overriddenOptions = { ...options, timeoutMs: scheduled.timeoutMs };
      const baseOptionsWithoutTimeout = { ...options };
      delete baseOptionsWithoutTimeout.timeoutMs;
      const overrideWithoutTimeout = { ...overriddenOptions };
      delete overrideWithoutTimeout.timeoutMs;
      if (JSON.stringify(baseOptionsWithoutTimeout) !== JSON.stringify(overrideWithoutTimeout) ||
          overriddenOptions.timeoutMs !== scheduled.timeoutMs) {
        throw new Error('Only the scheduled timeout value may be overridden.');
      }
      const started = monotonicNow();
      try {
        rawResponse = await execute(prompt, system, provider, overriddenOptions);
        cell.responseReceived = typeof rawResponse === 'string';
        cell.responseChars = cell.responseReceived ? rawResponse.length : undefined;
        cell.outputBytes = cell.responseReceived ? Buffer.byteLength(rawResponse, 'utf8') : undefined;
        return rawResponse;
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        cell.failure = /HTTP\s+429/i.test(message) ? 'RATE_LIMITED'
          : /abort|timed\s*out|timeout/i.test(message) ? 'TIMEOUT' : 'PROVIDER_ERROR';
        const status = error instanceof Error ? error.message.match(/HTTP\s+(\d{3})\./)?.[1] : undefined;
        cell.providerStatus = status && Number(status) >= 100 && Number(status) <= 599 ? Number(status) : undefined;
        throw error;
      } finally {
        cell.transportDurationMs = Math.round((monotonicNow() - started) * 100) / 100;
      }
    };

    let result;
    try {
      result = await interpret(testCase.question, fixedProviderSettings(apiKey), captureStructuredCall);
    } catch {
      result = { mode: 'DETERMINISTIC_FALLBACK', failure: 'PROVIDER_ERROR' };
    }
    rawResponse = undefined;
    if (callCount !== 1 || transportStart === undefined ||
        requestStartGapMs !== null && requestStartGapMs < MINIMUM_START_GAP_MS) {
      throw new Error('The fixed timeout experiment did not make one correctly paced request per scheduled call.');
    }
    requestCount += 1;
    const validInterpretation = result?.mode === 'SEMANTIC_INTERPRETATION' && result.failure === undefined &&
      Boolean(result.interpretation);
    const failure = result?.failure ? safeFailureCode(result.failure) : undefined;
    const outcome = cell.responseReceived ? 'RESPONSE_RECEIVED' : failure === 'TIMEOUT' ? 'TIMEOUT'
      : failure === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'PROVIDER_ERROR';
    const sourceAfter = await hashManifestFn(profile.sourceFiles);
    const fixturesAfter = await hashManifestFn(profile.fixtureFiles);
    if (!sameManifest(sourceBefore, sourceAfter) || !sameManifest(sourceFingerprints, sourceAfter) ||
        !sameManifest(fixturesBefore, fixturesAfter) || !sameManifest(fixtureFingerprints, fixturesAfter)) {
      throw new Error('Source or fixture fingerprint changed during the experiment.');
    }
    const completionLatencyMs = cell.responseReceived ? cell.transportDurationMs : undefined;
    const semanticCorrect = validInterpretation ? validSemanticInterpretation(testCase, result.interpretation) : false;
    observations.push({
      caseId: scheduled.caseId,
      timeoutMs: scheduled.timeoutMs,
      replicate: scheduled.replicate,
      requestStartGapMs,
      outcome,
      responseReceived: cell.responseReceived,
      validInterpretation,
      semanticCorrect,
      ...(failure ? { failureCode: failure } : {}),
      ...(Number.isInteger(cell.providerStatus) ? { providerStatus: cell.providerStatus } : {}),
      promptChars: promptSchemaFingerprints[scheduled.caseId].promptChars,
      systemChars: promptSchemaFingerprints[scheduled.caseId].systemChars,
      schemaChars: promptSchemaFingerprints[scheduled.caseId].schemaChars,
      ...(Number.isInteger(result?.interpretation?.issues?.length) ? { issueCount: result.interpretation.issues.length } : {}),
      ...(cell.outputBytes > 0 ? { outputBytes: cell.outputBytes } : {}),
      ...(cell.responseReceived ? { completionLatencyMs } : outcome === 'TIMEOUT'
        ? { timeoutCensoredDurationMs: cell.transportDurationMs }
        : { providerFailureDurationMs: cell.transportDurationMs }),
      ...(Number.isInteger(cell.responseChars) && cell.responseChars > 0 ? { responseChars: cell.responseChars } : {}),
      ...(requestStartGapMs === null ? { firstRequest: true } : {})
    });
  }

  const sourceAfter = await hashManifestFn(profile.sourceFiles);
  const fixturesAfter = await hashManifestFn(profile.fixtureFiles);
  const protectedAfter = await verifyProtectedArtifacts();
  const sourceHashesConsistent = sameManifest(sourceFingerprints, sourceAfter);
  const fixtureHashesConsistent = sameManifest(fixtureFingerprints, fixturesAfter);
  if (!sourceHashesConsistent || !fixtureHashesConsistent || protectedAfter.verified !== true ||
      protectedAfter.baselineCommit !== protectedBefore.baselineCommit || protectedAfter.artifactCount !== protectedBefore.artifactCount ||
      requestCount !== 18 || minimumObservedStartGapMs < MINIMUM_START_GAP_MS ||
      Object.keys(promptSchemaFingerprints).length !== 3 ||
      new Set(Object.values(promptSchemaFingerprints).map(value => value.schemaSha256)).size !== 1) {
    throw new Error('The fixed timeout experiment failed a required protocol guard.');
  }
  const semanticInterpretationHashWithoutTimeout = await normalizedSemanticInterpretationFingerprint();
  const protocolGuardsPassed = true;
  const timeoutRecommendation = computeIrasV2TimeoutRecommendation(observations, protocolGuardsPassed);
  const document = {
    schemaVersion: 2,
    protocolVersion: evaluationConfig.timeoutExperiment.protocolVersion,
    model: MODEL,
    caseIds: [...evaluationConfig.timeoutExperiment.caseIds],
    timeoutArmsMs: [...ARMS],
    observationsPerCaseArm: evaluationConfig.timeoutExperiment.observationsPerCaseArm,
    productionTimeoutAtMeasurementMs: SEMANTIC_QUESTION_TIMEOUT_MS,
    transportOverride: 'timeoutMs-only',
    recommendationPolicy: evaluationConfig.timeoutExperiment.recommendationPolicy,
    minimumStartGapMs: MINIMUM_START_GAP_MS,
    minimumObservedStartGapMs,
    pacingPolicy: 'Wait the full minimum gap after each completed scheduled request; provider-request start gaps are measured monotonically.',
    scheduledCallCount: schedule.length,
    requestCount,
    observations,
    armSummaries: responseStatistics(observations),
    promptSchemaFingerprints,
    schemaComplexity: {
      sha256: sha256(JSON.stringify(SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA)),
      chars: JSON.stringify(SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA).length,
      uniqueSchemas: 1,
      relationshipToLatency: 'Not identifiable in this experiment because schema complexity is held constant.'
    },
    sourceFingerprints,
    fixtureFingerprints,
    semanticInterpretationHashWithoutTimeout,
    sourceHashesConsistent,
    fixtureHashesConsistent,
    protectedHistoricalArtifacts: {
      baselineCommit: protectedBefore.baselineCommit,
      artifactCount: protectedBefore.artifactCount,
      verifiedBefore: protectedBefore.verified === true,
      verifiedAfter: protectedAfter.verified === true
    },
    protocolGuardsPassed,
    timeoutRecommendation,
    startedAt,
    completedAt: now().toISOString()
  };

  const jsonPath = path.join(outputPath, `${OUTPUT_PREFIX}.json`);
  const markdownPath = path.join(outputPath, `${OUTPUT_PREFIX}.md`);
  try {
    await writeFile(jsonPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await writeFile(markdownPath, renderMarkdown(document), { encoding: 'utf8', flag: 'wx' });
  } catch {
    throw new Error('A structured-timeout experiment output file already exists or cannot be written.');
  }
  return document;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== '--live') throw new Error('Structured-timeout experiment requires --live.');
  const result = await runSemanticStructuredTimeoutExperimentV2({ live: true });
  process.stdout.write(`${JSON.stringify({
    protocolVersion: result.protocolVersion,
    requestCount: result.requestCount,
    minimumObservedStartGapMs: result.minimumObservedStartGapMs,
    armSummaries: Object.fromEntries(Object.entries(result.armSummaries).map(([arm, summary]) => [arm, {
      scheduledCount: summary.scheduledCount,
      responseReceivedCount: summary.responseReceivedCount,
      validInterpretationCount: summary.validInterpretationCount,
      semanticCorrectCount: summary.semanticCorrectCount,
      timeoutCount: summary.timeoutCount,
      providerFailureCount: summary.providerFailureCount,
      completionLatencyMs: summary.completionLatencyMs,
      timeoutCensoredDurationMs: summary.timeoutCensoredDurationMs
    }])),
    timeoutRecommendation: result.timeoutRecommendation
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    const safeMessages = new Set([
      'Structured-timeout experiment requires --live.',
      'A structured-timeout experiment output file already exists.',
      'A structured-timeout experiment output file already exists or cannot be written.',
      'GEMINI_API_KEY is not configured.',
      'The experiment baseline no longer matches the production timeout; supervisor review is required.',
      'Source, fixture, or protected-history fingerprint changed during the experiment.',
      'Source or fixture fingerprint changed during the experiment.',
      'The fixed timeout experiment failed a required protocol guard.',
      'The fixed timeout experiment did not make one correctly paced request per scheduled call.',
      'Prompt, system instruction, or schema changed across timeout arms.',
      'Fixed Gemini provider settings changed.',
      'Fixed structured semantic request options changed.',
      'Only the scheduled timeout value may be overridden.'
    ]);
    process.stderr.write(`${safeMessages.has(error?.message) ? error.message : 'Structured-timeout experiment failed.'}\n`);
    process.exitCode = 1;
  });
}
