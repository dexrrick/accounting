import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeStructuredLlmCall } from '../../../src/services/aiTransport.ts';
import {
  interpretSemanticQuestion,
  SEMANTIC_QUESTION_TIMEOUT_MS
} from '../../../src/services/semanticQuestionUnderstanding.ts';
import { diagnoseSemanticResponse } from './semantic-contract-diagnosis.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '../../..');
const REPORT_DIRECTORY = path.join(PROJECT_ROOT, 'docs', 'evaluation', 'multi-authority-workstreams');
const MODEL = 'gemini-3.5-flash-lite';
const START_GAP_MS = 15_250;
const OUTPUT_PREFIX = 'semantic-contract-diagnosis-baseline';
const JSON_OUTPUT = `${OUTPUT_PREFIX}.json`;
const MARKDOWN_OUTPUT = `${OUTPUT_PREFIX}.md`;
const PRODUCTION_SOURCE = path.join(PROJECT_ROOT, 'src', 'services', 'semanticQuestionUnderstanding.ts');
const FIXTURES = [
  { id: 'control-general-recognition', file: 'semantic-operation-followup.json' },
  { id: 'control-general-interaction', file: 'semantic-operation-followup.json' },
  { id: 'A-paraphrase-3', file: 'semantic-reliability-post-guidance.json' }
];
const FAILURE_CODES = new Set(['NO_PROVIDER', 'INVALID_RESPONSE', 'LOW_CONFIDENCE', 'TIMEOUT', 'PROVIDER_ERROR', 'RATE_LIMITED', 'QUERY_TOO_LONG']);
const FAILURE_REASONS = new Set(['RESPONSE_TOO_LARGE', 'MALFORMED_JSON', 'CONTRADICTORY_FIELDS', 'SCHEMA_MISMATCH']);
const MODES = new Set(['SEMANTIC_INTERPRETATION', 'SEMANTIC_PLUS_RULES', 'DETERMINISTIC_FALLBACK']);
const SAFE_RUNNER_ERRORS = new Set([
  'Live capture requires --live.',
  'A baseline output file already exists.',
  'GEMINI_API_KEY is not configured.',
  'A required fixed evaluation case is missing.',
  'Source or fixture hash changed during live capture.'
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function hashFile(filePath) {
  return sha256(await readFile(filePath));
}

async function loadCases() {
  const cache = new Map();
  const result = [];
  for (const fixture of FIXTURES) {
    const filePath = path.join(SCRIPT_DIRECTORY, fixture.file);
    let parsed = cache.get(filePath);
    if (!parsed) {
      parsed = JSON.parse(await readFile(filePath, 'utf8'));
      cache.set(filePath, parsed);
    }
    const selected = parsed.cases.find(item => item.id === fixture.id);
    if (!selected || typeof selected.question !== 'string') throw new Error('A required fixed evaluation case is missing.');
    result.push({ id: fixture.id, question: selected.question, fixturePath: filePath, fixtureSha256: await hashFile(filePath) });
  }
  return result;
}

async function refuseExistingOutputs(directory) {
  for (const name of [JSON_OUTPUT, MARKDOWN_OUTPUT]) {
    try {
      await access(path.join(directory, name));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    throw new Error('A baseline output file already exists.');
  }
}

async function atomicWrite(filePath, contents) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx' });
  await rename(temporaryPath, filePath);
}

function safeResult(result) {
  const mode = MODES.has(result?.mode) ? result.mode : 'DETERMINISTIC_FALLBACK';
  const failure = FAILURE_CODES.has(result?.failure) ? result.failure : undefined;
  const failureReason = FAILURE_REASONS.has(result?.failureReason) ? result.failureReason : undefined;
  const providerStatus = Number.isInteger(result?.providerStatus) && result.providerStatus >= 100 && result.providerStatus <= 599
    ? result.providerStatus
    : undefined;
  return {
    mode,
    ...(failure ? { failure } : {}),
    ...(failureReason ? { failureReason } : {}),
    ...(providerStatus ? { providerStatus } : {})
  };
}

function renderMarkdown(document) {
  const lines = [
    '# Semantic contract diagnosis baseline',
    '',
    `- Model: ${document.model}`,
    `- Production source SHA-256: ${document.productionSourceSha256}`,
    `- Started: ${document.startedAt}`,
    '',
    '| Case | Mode | Failure | Rejection | Validator accepted | Prompt chars |',
    '| --- | --- | --- | --- | --- | ---: |'
  ];
  for (const item of document.cases) {
    lines.push(`| ${item.caseId} | ${item.production.mode} | ${item.production.failure || '—'} | ${item.diagnostic?.rejectionCode || 'NO_RESPONSE'} | ${item.diagnostic?.validatorAccepted ?? false} | ${item.capture?.promptChars ?? 0} |`);
  }
  lines.push('', `Source hash consistent after each request: ${document.sourceHashConsistent}`, '');
  return lines.join('\n');
}

async function writeProgress(directory, document) {
  await atomicWrite(path.join(directory, JSON_OUTPUT), `${JSON.stringify(document, null, 2)}\n`);
  await atomicWrite(path.join(directory, MARKDOWN_OUTPUT), renderMarkdown(document));
}

/** Live-gated capture; raw questions and provider responses are used in memory and discarded. */
export async function runSemanticContractDiagnosis({
  live = false,
  apiKey = process.env.GEMINI_API_KEY,
  outputDirectory = REPORT_DIRECTORY,
  execute = executeStructuredLlmCall,
  interpret = interpretSemanticQuestion,
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  now = () => new Date()
} = {}) {
  if (!live) throw new Error('Live capture requires --live.');
  await mkdir(outputDirectory, { recursive: true });
  await refuseExistingOutputs(outputDirectory);
  if (typeof apiKey !== 'string' || apiKey.trim().length <= 10) throw new Error('GEMINI_API_KEY is not configured.');

  const selectedCases = await loadCases();
  const productionSourceSha256 = await hashFile(PRODUCTION_SOURCE);
  const document = {
    schemaVersion: 1,
    purpose: 'Safe baseline diagnostics for three fixed development cases; prompts and raw provider outputs are discarded.',
    model: MODEL,
    timeoutMs: SEMANTIC_QUESTION_TIMEOUT_MS,
    minimumStartGapMs: START_GAP_MS,
    pacingPolicy: 'Wait at least minimumStartGapMs after the prior result checkpoint; request start gaps are therefore no shorter.',
    productionSourceSha256,
    startedAt: now().toISOString(),
    sourceHashConsistent: true,
    cases: []
  };

  for (let index = 0; index < selectedCases.length; index += 1) {
    const testCase = selectedCases[index];
    if (index > 0) await sleep(START_GAP_MS);
    const startedAt = now().toISOString();
    const sourceHashBefore = await hashFile(PRODUCTION_SOURCE);
    const fixtureHashBefore = await hashFile(testCase.fixturePath);
    let rawResponse;
    let capture;
    let productionResult;
    let callCount = 0;

    const captureCall = async (prompt, systemInstruction, provider, options = {}) => {
      if (callCount > 0) throw new Error('Only one provider request is allowed per case.');
      callCount += 1;
      capture = {
        promptSha256: sha256(prompt),
        promptChars: prompt.length,
        systemSha256: sha256(systemInstruction),
        systemChars: systemInstruction.length,
        model: MODEL,
        timeoutMs: options.timeoutMs ?? SEMANTIC_QUESTION_TIMEOUT_MS,
        temperature: typeof options.temperature === 'number' ? options.temperature : 0,
        requestCount: callCount
      };
      const requestStartedAt = performance.now();
      try {
        rawResponse = await execute(prompt, systemInstruction, provider, options);
        if (typeof rawResponse === 'string') {
          capture.responseReceived = true;
          capture.responseChars = rawResponse.length;
          capture.responseUtf8Bytes = Buffer.byteLength(rawResponse, 'utf8');
        } else {
          capture.responseReceived = false;
          capture.responseChars = 0;
          capture.responseUtf8Bytes = 0;
        }
        return rawResponse;
      } catch (error) {
        capture.responseReceived = false;
        capture.responseChars = 0;
        capture.responseUtf8Bytes = 0;
        throw error;
      } finally {
        capture.latencyMs = Math.round((performance.now() - requestStartedAt) * 100) / 100;
      }
    };

    try {
      const provider = {
        activeProvider: 'gemini',
        azure: { endpoint: '', apiKey: '', deploymentName: 'gpt-4o', apiVersion: '2024-08-01-preview' },
        gemini: { apiKey: apiKey.trim(), model: MODEL },
        openai: { apiKey: '', model: 'gpt-4o', baseUrl: '' }
      };
      productionResult = await interpret(testCase.question, provider, captureCall);
    } catch {
      productionResult = { mode: 'DETERMINISTIC_FALLBACK', failure: 'PROVIDER_ERROR' };
    }
    const diagnostic = typeof rawResponse === 'string' ? diagnoseSemanticResponse(rawResponse, testCase.question) : undefined;
    rawResponse = undefined;

    const sourceHashAfter = await hashFile(PRODUCTION_SOURCE);
    const fixtureHashAfter = await hashFile(testCase.fixturePath);
    const productionSourceHashConsistent = sourceHashBefore === sourceHashAfter && sourceHashAfter === productionSourceSha256;
    const fixtureHashConsistent = fixtureHashBefore === fixtureHashAfter && fixtureHashAfter === testCase.fixtureSha256;
    const sourceHashConsistent = productionSourceHashConsistent && fixtureHashConsistent;
    document.sourceHashConsistent = document.sourceHashConsistent && sourceHashConsistent;
    document.cases.push({
      caseId: testCase.id,
      fixtureSha256: testCase.fixtureSha256,
      fixtureHashConsistent,
      productionSourceSha256: sourceHashAfter,
      productionSourceHashConsistent,
      startedAt,
      completedAt: now().toISOString(),
      production: safeResult(productionResult),
      ...(capture ? { capture } : {}),
      ...(diagnostic ? { diagnostic } : {})
    });
    await writeProgress(outputDirectory, document);
    if (!sourceHashConsistent) throw new Error('Source or fixture hash changed during live capture.');
  }

  document.completedAt = now().toISOString();
  await writeProgress(outputDirectory, document);
  return {
    outputJson: path.join(outputDirectory, JSON_OUTPUT),
    outputMarkdown: path.join(outputDirectory, MARKDOWN_OUTPUT),
    document
  };
}

export async function main(args = process.argv.slice(2)) {
  if (!args.includes('--live')) throw new Error('Live capture requires --live.');
  return runSemanticContractDiagnosis({ live: true });
}

export function safeRunnerErrorMessage(error) {
  return error instanceof Error && SAFE_RUNNER_ERRORS.has(error.message)
    ? error.message
    : 'Semantic contract diagnosis runner failed.';
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().then(result => {
    process.stdout.write(`Saved safe semantic contract baseline to ${result.outputJson} and ${result.outputMarkdown}.\n`);
  }).catch(error => {
    process.stderr.write(`${safeRunnerErrorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
