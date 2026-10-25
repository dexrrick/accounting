// One explicitly dispatched development verification; never part of normal builds.
// Publish only on an isolated verification branch containing this root-level
// .verify-final-build-live.mjs and the package.json postbuild hook.
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVerificationReceiptExporter } from './scripts/verification_receipt_exporter.mjs';
import { createCloudflareVerificationReceiptSink, downloadCloudflareVerificationReceiptRun } from './scripts/cloudflare_verification_receipt_sink.mjs';
import { summarizeModelCaptureCompleteness, verifyPinnedApplicationRuntime } from './scripts/verification_harness_integrity.mjs';
import { rm } from 'node:fs/promises';

// Storage authorization does not authorize a model run. Disabled unless explicitly enabled.
if (process.env.ACCOUNTING_ALLOW_LIVE_MODEL_CALLS !== '1') {
  throw new Error('LIVE_MODEL_CALLS_HELD: this prepared harness has not been dispatched.');
}

const cases = [
  { id: 'regular-salary', question: 'Under MOM guidance, how often must salary be paid and when is regular salary due after the salary period?', authorities: ['MOM'] },
  { id: 'overtime-salary', question: 'Under MOM guidance, when is overtime salary payment due after the salary period?', authorities: ['MOM'] },
  { id: 'final-salary-boundary', question: 'Under MOM guidance, how often must salary be paid and when is my final salary due after resignation?', authorities: ['MOM'] },
  { id: 'historical-boundary', question: 'Under MOM guidance, how often must salary be paid and when was regular salary due after the salary period in 2023?', authorities: ['MOM'] },
];

const appSourceSha = '9f5f8a3309cf28b5dcf56eb3a78da6c693801208';
const expectedAppTreeSha256 = '7902ab14a607976a4358ba079eac17f70e0374ce6bc8d12e25fed60f82325338';
if (!/^[0-9a-f]{40}$/i.test(appSourceSha)) throw new Error('Set 630113b74f9ebcec7b3498644645b5ca61a0b73b to the reviewed app commit before dispatch.');
if (!/^[0-9a-f]{64}$/i.test(expectedAppTreeSha256)) throw new Error('Set 6ab427cdaac791e7b95f33f4561958162c64fac20938cb021d880731c0649474 to the reviewed app tree hash before dispatch.');

const applicationRoot = path.dirname(fileURLToPath(import.meta.url));
const verificationCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: applicationRoot, encoding: 'utf8' }).trim();
const commitMetadata = execFileSync('git', ['cat-file', '-p', 'HEAD'], { cwd: applicationRoot, encoding: 'utf8' });
const parentShas = [...commitMetadata.matchAll(/^parent ([0-9a-f]{40})$/gm)].map(match => match[1]);
if (parentShas.length !== 1 || parentShas[0] !== appSourceSha) {
  throw new Error('Verification commit must have the reviewed app source as its sole parent.');
}

const excludedHarnessPaths = new Set(['package.json', '.verify-final-build-live.mjs']);
const trackedEntries = execFileSync('git', ['ls-tree', '-r', '-z', 'HEAD'], { cwd: applicationRoot, encoding: 'utf8' })
  .split('\0').filter(Boolean)
  .filter(entry => !excludedHarnessPaths.has(entry.slice(entry.indexOf('\t') + 1)))
  .sort();
const actualAppTreeSha256 = createHash('sha256').update(trackedEntries.join('\n')).digest('hex');
if (actualAppTreeSha256 !== expectedAppTreeSha256) {
  throw new Error('Tracked application tree differs from the reviewed app source tree.');
}
// A shallow Cloudflare checkout may omit the reviewed parent commit object.
// Fetch only the exact pinned public commit before reading its tree; never substitute a branch head.
const pinnedApplicationCommitObject = `${appSourceSha}^{commit}`;
try {
  execFileSync('git', ['cat-file', '-e', pinnedApplicationCommitObject], { cwd: applicationRoot, stdio: 'ignore' });
} catch {
  execFileSync('git', ['fetch', '--depth=1', '--no-tags', 'https://github.com/dexrrick/accounting.git', appSourceSha], { cwd: applicationRoot, stdio: 'ignore' });
  execFileSync('git', ['cat-file', '-e', pinnedApplicationCommitObject], { cwd: applicationRoot, stdio: 'ignore' });
}
const verifiedApplicationRuntime = await verifyPinnedApplicationRuntime({ root: applicationRoot, appSourceSha });

const model = 'gemini-3.5-flash-lite';
const executionEnvironment = 'CLOUDFLARE_BUILD_NODE';
const sourceTransport = 'NODE_DIRECT_OFFICIAL_SOURCE';
const sourceBodyLimitBytes = 1_500_000;
const modelResponseBodyLimitBytes = 1_500_000;
const captureWaitLimitMs = 12_000;
const postTimeoutCancelWaitMs = 250;
const approvedOfficialHosts = new Set([
  'acra.gov.sg', 'www.acra.gov.sg',
  'cpf.gov.sg', 'www.cpf.gov.sg',
  'mom.gov.sg', 'www.mom.gov.sg',
  'iras.gov.sg', 'www.iras.gov.sg',
  'sso.agc.gov.sg',
  'mas.gov.sg', 'www.mas.gov.sg'
]);
const key = process.env.GEMINI_API_KEY?.trim() || '';
const output = console.log.bind(console);
const originalConsole = Object.fromEntries(['log', 'info', 'debug', 'warn', 'error'].map(method => [method, console[method]]));
const scrub = value => key ? String(value).replaceAll(key, '[REDACTED]') : String(value);
function scrubDiagnosticText(value) {
  const redacted = scrub(value);
  return redacted.replace(/https?:\/\/generativelanguage\.googleapis\.com[^\s"'<>]*/gi, rawUrl => {
    const trailing = rawUrl.match(/[),.;]+$/)?.[0] || '';
    const candidate = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl;
    try {
      const parsed = new URL(candidate);
      return `${parsed.origin}${parsed.pathname}${trailing}`;
    } catch {
      return `https://generativelanguage.googleapis.com/[QUERY_REDACTED]${trailing}`;
    }
  });
}
const caseContext = new AsyncLocalStorage();
const nativeFetch = globalThis.fetch;
const sourceHash = async filePath => createHash('sha256').update(await readFile(path.join(applicationRoot, filePath))).digest('hex');

function newCaseState(testCase, deadlineAt, deadlineKind) {
  return {
    id: testCase.id,
    dispatches: { model: 0, source: 0, other: 0, nonModel: 0 },
    deadlineAt,
    deadlineKind,
    closed: false,
    deadlineExpired: false,
    deadlineTimer: undefined,
    abortController: new AbortController(),
    modelResponses: [],
    sourceResponses: [],
    pendingCaptures: new Set(),
    captureReaders: new Set(),
    deadlineCancelledReaders: new WeakSet(),
    captureDeadlineExpired: false,
    inFlightFetches: 0,
    firstGenerateContentSeen: false
  };
}

function cleanError(error, depth = 0) {
  if (depth > 3) return '[cause depth limit]';
  if (error === undefined || error === null) return String(error);
  if (typeof error !== 'object') return scrubDiagnosticText(error);
  return {
    name: typeof error.name === 'string' ? error.name : 'Error',
    message: typeof error.message === 'string' ? scrubDiagnosticText(error.message) : scrubDiagnosticText(error),
    ...(typeof error.stack === 'string' ? { stack: scrubDiagnosticText(error.stack) } : {}),
    ...(error.cause !== undefined ? { cause: cleanError(error.cause, depth + 1) } : {})
  };
}

function scheduleCapture(state, record, capture) {
  record.captureStatus = 'PENDING';
  let task;
  task = Promise.resolve().then(capture).then(
    result => {
      Object.assign(record, result);
      record.captureStatus = result?.captureStatus || 'COMPLETE';
    },
    error => {
      record.captureStatus = state.deadlineExpired || state.captureDeadlineExpired ? 'INCOMPLETE_TIMEOUT' : 'FAILED';
      record.captureError = cleanError(error);
    }
  ).finally(() => state.pendingCaptures.delete(task));
  state.pendingCaptures.add(task);
}

function registerCaptureReader(state, reader) {
  if (!reader) return;
  state.captureReaders.add(reader);
  if (state.captureDeadlineExpired || state.deadlineExpired) {
    state.deadlineCancelledReaders.add(reader);
    void reader.cancel('per-case clone capture deadline elapsed').catch(() => {});
  }
}

function requestCloneReaderCancel(reader, reason) {
  try {
    void Promise.resolve(reader.cancel(reason)).catch(() => {});
  } catch {
    // Cancellation is best-effort; the bounded reader loop must never wait on its promise.
  }
}

function isApprovedOfficialUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && approvedOfficialHosts.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function targetUrlOf(input) {
  if (typeof input === 'string') return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

function hasGeneratedText(payload) {
  return payload?.candidates?.some(candidate =>
    candidate?.content?.parts?.some(part => typeof part?.text === 'string' && part.text.trim().length > 0)
  ) || false;
}

function captureModelClone(response, state, retainRawBody) {
  const clone = response.clone();
  const reader = clone.body?.getReader();
  registerCaptureReader(state, reader);
  return async () => {
    const chunks = [];
    let bytesRead = 0;
    let bytesCaptured = 0;
    let bodyComplete = !reader;
    let truncatedByLimit = false;
    try {
      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            bodyComplete = !state.deadlineCancelledReaders.has(reader);
            break;
          }
          const chunk = Buffer.from(value);
          bytesRead += chunk.byteLength;
          const take = Math.min(chunk.byteLength, modelResponseBodyLimitBytes - bytesCaptured);
          if (take > 0) {
            chunks.push(chunk.subarray(0, take));
            bytesCaptured += take;
          }
          if (take < chunk.byteLength) {
            truncatedByLimit = true;
            requestCloneReaderCancel(reader, 'model clone capture byte limit reached');
            break;
          }
          if (bytesCaptured === modelResponseBodyLimitBytes) {
            const probe = await reader.read();
            if (probe.done) {
              bodyComplete = !state.deadlineCancelledReaders.has(reader);
            } else if (!probe.value?.byteLength) {
              continue;
            } else {
              bytesRead += probe.value?.byteLength || 0;
              truncatedByLimit = true;
              requestCloneReaderCancel(reader, 'model clone capture byte limit reached');
            }
            break;
          }
        }
      }
    } finally {
      if (reader) state.captureReaders.delete(reader);
    }
    const bytes = Buffer.concat(chunks, bytesCaptured);
    const bodyText = bytes.toString('utf8');
    let bodyJson;
    try { bodyJson = JSON.parse(bodyText); } catch { bodyJson = undefined; }
    const deadlineCancelled = Boolean(reader && state.deadlineCancelledReaders.has(reader));
    const bodyTruncated = truncatedByLimit || deadlineCancelled || !bodyComplete;
    return {
      responseBodySha256: createHash('sha256').update(bytes).digest('hex'),
      responseBodyHashScope: bodyComplete ? 'complete_response' : 'captured_prefix',
      responseBodyBytesRead: bytesRead,
      responseBodyBytesCaptured: bytes.byteLength,
      responseBodyTruncated: bodyTruncated,
      responseBodyCaptureLimitBytes: modelResponseBodyLimitBytes,
      returnedText: !bodyTruncated && hasGeneratedText(bodyJson),
      ...(retainRawBody ? {
        rawResponseBodyText: bodyText,
        rawResponseBodyFormat: 'UTF-8 response text; JSON.parse when complete and valid'
      } : {}),
      captureStatus: deadlineCancelled ? 'INCOMPLETE_TIMEOUT' : truncatedByLimit ? 'TRUNCATED_LIMIT' : 'COMPLETE'
    };
  };
}

async function captureOfficialSourceBody(state, responseClone, requestUrl, finalUrl, responseStatus, contentType) {
  const reader = responseClone.body?.getReader();
  registerCaptureReader(state, reader);
  const hash = createHash('sha256');
  const capturedChunks = [];
  let bytesRead = 0;
  let bytesCaptured = 0;
  let bodyComplete = !reader;
  try {
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          bodyComplete = !state.deadlineCancelledReaders.has(reader);
          break;
        }
        const chunk = Buffer.from(value);
        hash.update(chunk);
        const take = Math.min(chunk.byteLength, sourceBodyLimitBytes - bytesCaptured);
        if (take > 0) {
          capturedChunks.push(chunk.subarray(0, take));
          bytesCaptured += take;
        }
        bytesRead += chunk.byteLength;
      }
    }
  } finally {
    if (reader) state.captureReaders.delete(reader);
  }
  const capturedBody = Buffer.concat(capturedChunks, bytesCaptured);
  const textual = /^(text\/|application\/(?:json|xml|xhtml\+xml|javascript)|\w+\/[^;]*(?:json|xml))/i.test(contentType || '');
  const deadlineCancelled = Boolean(reader && state.deadlineCancelledReaders.has(reader));
  const bodyTruncated = bytesRead > sourceBodyLimitBytes || deadlineCancelled || !bodyComplete;
  return {
    requestUrl,
    finalUrl,
    httpStatus: responseStatus,
    contentType,
    responseBodySha256: hash.digest('hex'),
    responseBodyHashScope: bodyComplete ? 'complete_response' : 'read_prefix',
    responseBodyBytes: bytesRead,
    capturedBodyBytes: bytesCaptured,
    bodyTruncated,
    bodyCaptureLimitBytes: sourceBodyLimitBytes,
    bodyEncoding: 'base64',
    bodyBase64: capturedBody.toString('base64'),
    ...(textual ? { bodyText: capturedBody.toString('utf8') } : {}),
    captureStatus: deadlineCancelled ? 'INCOMPLETE_TIMEOUT' : bytesRead > sourceBodyLimitBytes ? 'TRUNCATED_LIMIT' : 'COMPLETE'
  };
}

async function waitForCaseCaptures(state) {
  const deadline = Math.min(Date.now() + captureWaitLimitMs, state.deadlineAt);
  while (Date.now() < deadline) {
    if (state.inFlightFetches === 0 && state.pendingCaptures.size === 0) break;
    const remaining = deadline - Date.now();
    const pending = [...state.pendingCaptures];
    const timer = new Promise(resolve => setTimeout(resolve, Math.min(200, remaining)));
    if (pending.length > 0) await Promise.race([Promise.allSettled(pending), timer]);
    else await timer;
  }
  const timedOut = state.inFlightFetches > 0 || state.pendingCaptures.size > 0;
  const pendingCapturesAtDeadline = state.pendingCaptures.size;
  const inFlightFetchesAtDeadline = state.inFlightFetches;
  let cloneReadersCancelledAtDeadline = 0;
  if (timedOut) {
    state.captureDeadlineExpired = true;
    const readers = [...state.captureReaders];
    cloneReadersCancelledAtDeadline = readers.length;
    const cancellations = readers.map(reader => {
      state.deadlineCancelledReaders.add(reader);
      return Promise.resolve(reader.cancel('per-case clone capture deadline elapsed')).catch(() => {});
    });
    if (cancellations.length > 0) {
      await Promise.race([
        Promise.allSettled(cancellations),
        new Promise(resolve => setTimeout(resolve, postTimeoutCancelWaitMs))
      ]);
    }
  }
  return {
    boundedWaitMs: captureWaitLimitMs,
    timedOut,
    pendingCapturesAtDeadline,
    inFlightFetchesAtDeadline,
    cloneReadersCancelledAtDeadline,
    inFlightFetchesAtReceipt: state.inFlightFetches,
    pendingCapturesAtReceipt: state.pendingCaptures.size
  };
}

const runId = process.env.ACCOUNTING_VERIFICATION_RUN_ID || '';
const outputDirectory = process.env.ACCOUNTING_VERIFICATION_EXPORT_DIRECTORY || '';
const receiptSink = createCloudflareVerificationReceiptSink({
  accountId: '0c07eba7cff6c7a8e3c9356cf0fcc503',
  bucketName: 'accounting-verification-receipts',
  runId,
  accessKeyId: process.env.ACCOUNTING_RECEIPT_STORE_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.ACCOUNTING_RECEIPT_STORE_SECRET_ACCESS_KEY || '',
  fetchImpl: nativeFetch
});
// Constructor preflight verifies private durable storage before importing the application.
const exporter = await createVerificationReceiptExporter({
  outputDirectory, runId, plannedCaseIds: cases.map(testCase => testCase.id),
  durableSink: receiptSink, stdout: output
});
const { processAccountingQuery } = await import('./src/services/geminiService.ts');

const hashes = {
  geminiService: await sourceHash('src/services/geminiService.ts'),
  semanticQuestionUnderstanding: await sourceHash('src/services/semanticQuestionUnderstanding.ts'),
  queryTopicResolver: await sourceHash('src/retrieval/queryTopicResolver.ts'),
  authorityWorkstreams: await sourceHash('src/services/authorityWorkstreams.ts'),
  groundingContextBuilder: await sourceHash('src/services/groundingContextBuilder.ts'),
  requestCompleteness: await sourceHash('src/services/requestCompleteness.ts')
};


for (const method of Object.keys(originalConsole)) console[method] = () => {};
const MAX_MODEL_REQUESTS_PER_RUN = 12;
const MAX_MODEL_REQUESTS_PER_CASE = 3;
const MIN_CASE_START_INTERVAL_MS = 15_250;
const MAX_NON_MODEL_REQUESTS_PER_CASE = 16;
const MAX_NON_MODEL_REQUESTS_PER_RUN = 64;
const MAX_CASE_LIVE_MS = 60_000;
const MAX_RUN_LIVE_MS = 300_000;
const liveSubmissionStartedAt = Date.now();
const liveRunDeadlineAt = liveSubmissionStartedAt + MAX_RUN_LIVE_MS;
const liveBounds = createLiveBounds({ totalRunDeadlineAt: liveRunDeadlineAt });
let lastCaseStartAt = 0;

globalThis.fetch = async (input, init) => {
  const state = caseContext.getStore();
  if (!state) return nativeFetch(input, init);
  const target = targetUrlOf(input);
  const requestUrl = target.href;
  const modelRequest = target.hostname.toLowerCase() === 'generativelanguage.googleapis.com';
  const sourceRequest = isApprovedOfficialUrl(requestUrl);
  liveBounds.assertDispatchAllowed(state, modelRequest, sourceRequest);
  state.inFlightFetches += 1;
  try {
    const response = await nativeFetch(input, liveBounds.requestInit(input, init, state));
    if (modelRequest) {
      const generateContent = target.pathname.endsWith(':generateContent');
      const retainRawBody = generateContent;
      if (retainRawBody) state.firstGenerateContentSeen = true;
      const record = { endpoint: `${target.origin}${target.pathname}`, httpStatus: response.status, generateContent, retainedRawBody: retainRawBody };
      state.modelResponses.push(record);
      scheduleCapture(state, record, captureModelClone(response, state, retainRawBody));
    } else {
      if (sourceRequest) {
        const finalUrl = response.url || requestUrl;
        const contentType = response.headers.get('content-type') || '';
        const record = { requestUrl, finalUrl, httpStatus: response.status, contentType };
        state.sourceResponses.push(record);
        if (isApprovedOfficialUrl(finalUrl)) {
          const clone = response.clone();
          scheduleCapture(state, record, () => captureOfficialSourceBody(state, clone, requestUrl, finalUrl, response.status, contentType));
        } else {
          record.captureStatus = 'SKIPPED_UNAPPROVED_FINAL_HOST';
        }
      }
    }
    return response;
  } catch (error) {
    const failure = cleanError(error);
    if (modelRequest) state.modelResponses.push({ endpoint: `${target.origin}${target.pathname}`, transportError: failure, captureStatus: 'FAILED' });
    else if (sourceRequest) state.sourceResponses.push({ requestUrl, transportError: failure, captureStatus: 'FAILED' });
    throw error;
  } finally {
    state.inFlightFetches -= 1;
  }
};

function createLiveBounds({ totalRunDeadlineAt }) {
  let totalModelRequestStarts = 0;
  let totalNonModelRequestStarts = 0;
  return {
    assertDispatchAllowed(state, modelRequest, sourceRequest, now = Date.now()) {
      if (now >= state.deadlineAt || now >= totalRunDeadlineAt) {
        state.closed = true;
        state.deadlineExpired = true;
        if (!state.abortController.signal.aborted) state.abortController.abort(new Error('LIVE_DEADLINE_EXCEEDED'));
        const error = new Error(state.deadlineKind === 'RUN' || now >= totalRunDeadlineAt ? 'LIVE_RUN_DEADLINE_EXCEEDED' : 'LIVE_CASE_DEADLINE_EXCEEDED');
        error.code = error.message;
        throw error;
      }
      if (state.closed) {
        const error = new Error('LIVE_CASE_CLOSED');
        error.code = error.message;
        throw error;
      }
      if (modelRequest) {
        if (totalModelRequestStarts >= MAX_MODEL_REQUESTS_PER_RUN || state.dispatches.model >= MAX_MODEL_REQUESTS_PER_CASE) {
          throw new Error('LIVE_MODEL_REQUEST_BUDGET_EXCEEDED');
        }
        totalModelRequestStarts += 1;
        state.dispatches.model += 1;
      } else {
        if (totalNonModelRequestStarts >= MAX_NON_MODEL_REQUESTS_PER_RUN || state.dispatches.nonModel >= MAX_NON_MODEL_REQUESTS_PER_CASE) {
          throw new Error('LIVE_NON_MODEL_REQUEST_BUDGET_EXCEEDED');
        }
        totalNonModelRequestStarts += 1;
        state.dispatches.nonModel += 1;
        if (sourceRequest) state.dispatches.source += 1;
        else state.dispatches.other += 1;
      }
    },
    requestInit(input, init, state) {
      const requestSignal = init?.signal ?? input?.signal;
      const signal = requestSignal ? AbortSignal.any([requestSignal, state.abortController.signal]) : state.abortController.signal;
      return { ...init, signal };
    },
    async raceCase(state, operation) {
      const remainingMs = Math.max(0, state.deadlineAt - Date.now());
      let timeout;
      const deadline = new Promise((_, reject) => {
        timeout = setTimeout(() => {
          state.closed = true;
          state.deadlineExpired = true;
          if (!state.abortController.signal.aborted) state.abortController.abort(new Error('LIVE_DEADLINE_EXCEEDED'));
          const error = new Error(state.deadlineKind === 'RUN' ? 'LIVE_RUN_DEADLINE_EXCEEDED' : 'LIVE_CASE_DEADLINE_EXCEEDED');
          error.code = error.message;
          reject(error);
        }, remainingMs);
      });
      state.deadlineTimer = timeout;
      try { return await Promise.race([Promise.resolve().then(operation), deadline]); }
      finally {
        state.closed = true;
        if (state.deadlineExpired) clearTimeout(timeout);
      }
    },
    finishCase(state) {
      if (state.deadlineTimer !== undefined) clearTimeout(state.deadlineTimer);
      state.deadlineTimer = undefined;
      state.closed = true;
      if (!state.abortController.signal.aborted) state.abortController.abort(new Error('LIVE_CASE_CLOSED'));
    },
    totals() { return { model: totalModelRequestStarts, nonModel: totalNonModelRequestStarts }; }
  };
}

let casesWithErrors = 0;
const exportedReceipts = new Map();
let terminalExportFailure;
try {
  for (const testCase of cases) {
    const caseDelay = MIN_CASE_START_INTERVAL_MS - (Date.now() - lastCaseStartAt);
    if (caseDelay > 0) await new Promise(resolve => setTimeout(resolve, caseDelay));
    lastCaseStartAt = Date.now();
    const startedAtUTC = new Date().toISOString();
    const caseStartedAt = Date.now();
    const proposedCaseDeadlineAt = caseStartedAt + MAX_CASE_LIVE_MS;
    const deadlineKind = liveRunDeadlineAt <= proposedCaseDeadlineAt ? 'RUN' : 'CASE';
    const state = newCaseState(testCase, Math.min(proposedCaseDeadlineAt, liveRunDeadlineAt), deadlineKind);
    let observed;
    let grounded;
    let response;
    let error;
    if (Date.now() >= liveRunDeadlineAt) {
      state.closed = true;
      state.deadlineExpired = true;
      error = { name: 'LiveRunDeadline', message: 'No submission started because the total live submission deadline elapsed.' };
      casesWithErrors += 1;
    } else if (key) {
      try {
        response = await liveBounds.raceCase(state, () => caseContext.run(state, () => processAccountingQuery(
          testCase.question,
          null,
          'SFRS_I',
          key,
          model,
          [],
          undefined,
          {
            onAuthorityWorkstreams(result) { observed = result; },
            onGroundedContext(context) { grounded = context; }
          }
        )));
      } catch (caught) {
        if (state.deadlineExpired || caught?.code === 'LIVE_CASE_DEADLINE_EXCEEDED' || caught?.code === 'LIVE_RUN_DEADLINE_EXCEEDED') {
          state.closed = true;
          state.deadlineExpired = true;
          const runTimedOut = state.deadlineKind === 'RUN' || caught?.code === 'LIVE_RUN_DEADLINE_EXCEEDED';
          error = { name: 'LiveDeadlineExceeded', message: runTimedOut ? 'LIVE_RUN_DEADLINE_EXCEEDED' : 'LIVE_CASE_DEADLINE_EXCEEDED', scope: runTimedOut ? 'RUN' : 'CASE' };
        } else error = cleanError(caught);
        casesWithErrors += 1;
      }
    } else {
      error = { name: 'CredentialUnavailable', message: 'Development model credential is unavailable; no model or source requests were attempted.' };
      casesWithErrors += 1;
    }

    const captureWindow = await waitForCaseCaptures(state);
    liveBounds.finishCase(state);
    const presentation = response?.scenarioState?.authorityEvidencePresentation;
    const semanticPlanSource = observed?.issuePlan?.source || 'NOT_EXPOSED';
    const receipt = {
      id: testCase.id,
      question: testCase.question,
      authorities: testCase.authorities,
      appSourceSha,
      verificationCommitSha,
      actualAppTreeSha256,
      applicationRuntime: verifiedApplicationRuntime,
      executionEnvironment,
      sourceTransport,
      startedAtUTC,
      observedAtUTC: new Date().toISOString(),
      status: error?.name === 'LiveRunDeadline' ? 'NOT_ATTEMPTED_RUN_DEADLINE' : error?.name === 'LiveDeadlineExceeded' ? (error.scope === 'RUN' ? 'LIVE_RUN_TIMEOUT' : 'LIVE_CASE_TIMEOUT') : error ? (key ? 'QUERY_ERROR' : 'NOT_ATTEMPTED_MISSING_CREDENTIAL') :
        observed?.status || presentation?.status || response?.evidenceQuality?.status || 'UNEXPOSED',
      providerStatus: response?.providerStatus ?? (key ? 'NOT_EXPOSED' : 'NOT_ATTEMPTED'),
      answerPath: response?.answerPath,
      semanticPlanSource,
      semanticPlanAccepted: semanticPlanSource === 'SEMANTIC_ISSUES',
      error,
      dispatches: state.dispatches,
      deadline: { caseDeadlineAtUTC: new Date(state.deadlineAt).toISOString(), scope: state.deadlineKind, expired: state.deadlineExpired, closed: state.closed },
      modelResponses: state.modelResponses,
      sourceResponses: state.sourceResponses,
      captureWindow,
      captureCompleteness: captureWindow.timedOut || state.modelResponses.some(item => item.captureStatus === 'INCOMPLETE_TIMEOUT') || state.sourceResponses.some(item => item.captureStatus === 'INCOMPLETE_TIMEOUT') ? 'INCOMPLETE_TIMEOUT' :
        (state.modelResponses.some(item => item.captureStatus === 'FAILED') || state.sourceResponses.some(item => item.captureStatus === 'FAILED') ? 'INCOMPLETE_CAPTURE_FAILURE' :
          (state.modelResponses.some(item => item.captureStatus === 'TRUNCATED_LIMIT') || state.sourceResponses.some(item => item.captureStatus === 'TRUNCATED_LIMIT') ? 'CAPTURED_WITH_BODY_TRUNCATION' : 'CAPTURE_WINDOW_SETTLED')),
      // Keep full diagnostic objects. These are the actual callback/response objects,
      // including issue-level retrieval traces and sourceText plus integrity hashes.
      observedAuthorityWorkstreams: observed,
      groundedContext: grounded,
      finalPresentation: presentation,
      requestCompletenessContext: response?.scenarioState?.requestCompletenessContext,
      requestCompletenessEvaluation: response?.scenarioState?.requestCompletenessContext?.evaluation,
      evidenceQuality: response?.evidenceQuality,
      sourceMapFallbackTrace: response?.sourceMapFallbackTrace,
      directGroups: response?.scenarioState?.directGroups,
      messageText: response?.messageText
    };
    try {
      const exportReceipt = JSON.parse(scrub(JSON.stringify(receipt)));
      await exporter.exportReceipt(exportReceipt);
      exportedReceipts.set(receipt.id, exportReceipt);
    } catch (error) {
      const failureCode = typeof error?.code === 'string' && /^[A-Z0-9_]{1,64}$/i.test(error.code)
        ? error.code : (typeof error?.message === 'string' && /^R2_[A-Z0-9_]{1,64}$/i.test(error.message) ? error.message : 'RECEIPT_EXPORT_FAILED');
      let exportStatus = 'EXPORT_FAILURE_STATUS_UNVERIFIED';
      try {
        const failureRecord = await exporter.recordExportFailure(receipt.id, failureCode);
        exportStatus = failureRecord?.persistence === 'REMOTE_PREVIOUS' ? 'EXPORT_FAILURE_STATUS_REMOTE_PREVIOUS' :
          failureRecord?.persistence === 'REMOTE_UNCERTAIN' ? 'EXPORT_FAILURE_STATUS_REMOTE_UNCERTAIN' :
            failureRecord?.persistence === 'REMOTE_VERIFIED' ? 'EXPORT_FAILURE_STATUS_REMOTE_VERIFIED_TERMINAL' :
              failureRecord?.exportStatus === 'EXPORTED' ? 'EXPORTED_PRESERVED' :
                failureRecord?.persistence === 'REMOTE_VERIFIED_LOCAL_MIRROR_FAILED' ? 'EXPORT_FAILED_REMOTE_VERIFIED_LOCAL_MIRROR_FAILED' :
                  failureRecord?.exportStatus === 'EXPORT_FAILED' ? 'EXPORT_FAILED_RECORDED' : 'EXPORT_FAILURE_STATUS_UNVERIFIED';
      } catch {
        // Preserve uncertainty if the status write also failed.
      }
      terminalExportFailure = { caseId: receipt.id, exportStatus, failureCode };
      break;
    }
  }
} finally {
  // Keep the guarded case-aware fetch wrapper installed through finalization and recovery.
  for (const [method, original] of Object.entries(originalConsole)) console[method] = original;
  try {
    await exporter.finish();
  } catch (error) {
    const terminalStatus = typeof error?.reconciliation === 'string' && /^REMOTE_(?:VERIFIED|PREVIOUS|UNCERTAIN)$/.test(error.reconciliation)
      ? error.reconciliation : (typeof error?.message === 'string' && /^R2_RUN_TERMINATED_REMOTE_(?:VERIFIED|PREVIOUS|UNCERTAIN)$/.test(error.message)
        ? error.message.slice('R2_RUN_TERMINATED_'.length) : undefined);
    terminalExportFailure ||= terminalStatus
      ? { caseId: 'RUN', exportStatus: 'EXPORT_FAILURE_STATUS_' + terminalStatus, failureCode: 'RECEIPT_RUN_TERMINATED' }
      : { caseId: 'RUN', exportStatus: 'FINALIZATION_UNVERIFIED', failureCode: 'RECEIPT_RUN_FINALIZATION_FAILED' };
  }
}
if (terminalExportFailure) {
  throw new Error(`RECEIPT_EXPORT_TERMINATED case=${terminalExportFailure.caseId} status=${terminalExportFailure.exportStatus} code=${terminalExportFailure.failureCode}`);
}

// Remove the only live-run working copy, then reconstruct it through a fresh sink.
await rm(exporter.runDirectory, { recursive: true, force: true });
const recovery = await downloadCloudflareVerificationReceiptRun({ sink: createCloudflareVerificationReceiptSink({
  accountId: '0c07eba7cff6c7a8e3c9356cf0fcc503',
  bucketName: 'accounting-verification-receipts',
  runId,
  accessKeyId: process.env.ACCOUNTING_RECEIPT_STORE_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.ACCOUNTING_RECEIPT_STORE_SECRET_ACCESS_KEY || '',
  fetchImpl: nativeFetch
}), outputDirectory: '/tmp/accounting-verification-recovery' });
assert.equal(recovery.manifest.runId, runId);
assert.equal(recovery.manifest.status, 'COMPLETE');
assert.deepEqual([...recovery.manifest.plannedCaseIds].sort(), cases.map(item => item.id).sort());
assert.deepEqual(Object.keys(recovery.receipts).sort(), cases.map(item => item.id).sort());
for (const item of cases) {
  assert.equal(recovery.manifest.cases[item.id].exportStatus, 'EXPORTED');
  assert.deepEqual(recovery.receipts[item.id].receipt, exportedReceipts.get(item.id));
}
const modelCaptureSummary = summarizeModelCaptureCompleteness(
  Object.values(recovery.receipts).map(item => item.receipt)
);
await rm(recovery.runDirectory, { recursive: true, force: true });
console.log(JSON.stringify({ event: 'R2_FRESH_SINK_RECOVERY_PASS', runId, reconstructedReceipts: Object.keys(recovery.receipts).length, modelRequests: liveBounds.totals().model }));

// BEGIN R2 PORTABLE EXPORT FUNCTION
async function publishPortableReceiptCopy(receiptSink, runId) {
  const originalManifestBytes = Buffer.from(await receiptSink.getArtifact(receiptSink.manifestKey));
  const manifestSha256 = createHash('sha256').update(originalManifestBytes).digest('hex');
  const originalManifest = JSON.parse(originalManifestBytes.toString('utf8'));
  if (originalManifest.runId !== runId || originalManifest.status !== 'COMPLETE' ||
      originalManifest.durableSink?.prefix !== receiptSink.prefix ||
      originalManifest.durableSink?.manifestKey !== receiptSink.manifestKey ||
      receiptSink.prefix !== 'verification-runs/' + runId) {
    throw new Error('R2_PORTABLE_MANIFEST_IDENTITY_MISMATCH');
  }

  const portableArtifacts = [];
  for (const [relativePath, originalMetadata] of Object.entries(originalManifest.remoteArtifacts || {})) {
    if (originalMetadata.path !== relativePath || originalMetadata.key !== receiptSink.prefix + '/' + relativePath ||
        originalMetadata.verified !== true || !/^[a-f0-9]{64}$/.test(originalMetadata.sha256 || '') ||
        !Number.isSafeInteger(originalMetadata.byteLength)) {
      throw new Error('R2_PORTABLE_ARTIFACT_METADATA_INVALID');
    }
    const originalBytes = Buffer.from(await receiptSink.getArtifact(originalMetadata.key));
    const originalSha256 = createHash('sha256').update(originalBytes).digest('hex');
    if (originalBytes.length !== originalMetadata.byteLength || originalSha256 !== originalMetadata.sha256) {
      throw new Error('R2_PORTABLE_ORIGINAL_ARTIFACT_MISMATCH');
    }
    const envelopeBytes = Buffer.from(JSON.stringify({
      schemaVersion: 1,
      originalArtifact: originalMetadata,
      base64: originalBytes.toString('base64')
    }), 'utf8');
    const portablePath = 'portable/' + relativePath + '.json';
    const copy = await receiptSink.putArtifact(portablePath, envelopeBytes, { immutable: true });
    const expectedSha256 = createHash('sha256').update(envelopeBytes).digest('hex');
    if (copy?.verified !== true || copy.key !== receiptSink.prefix + '/' + portablePath ||
        copy.sha256 !== expectedSha256 || copy.byteLength !== envelopeBytes.length) {
      throw new Error('R2_PORTABLE_COPY_READBACK_UNVERIFIED');
    }
    portableArtifacts.push({
      path: relativePath,
      key: copy.key,
      sha256: copy.sha256,
      byteLength: copy.byteLength,
      originalSha256,
      originalByteLength: originalBytes.length
    });
  }
  if (portableArtifacts.length !== Object.keys(originalManifest.remoteArtifacts || {}).length || portableArtifacts.length === 0) {
    throw new Error('R2_PORTABLE_ARTIFACT_SET_INCOMPLETE');
  }

  const indexBytes = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    runId,
    manifestBase64: originalManifestBytes.toString('base64'),
    manifestSha256,
    artifacts: portableArtifacts
  }, null, 2), 'utf8');
  const indexKey = receiptSink.prefix + '/portable/index.json';
  const index = await receiptSink.putArtifact('portable/index.json', indexBytes, { immutable: true });
  const indexSha256 = createHash('sha256').update(indexBytes).digest('hex');
  if (index?.verified !== true || index.key !== indexKey || index.sha256 !== indexSha256 ||
      index.byteLength !== indexBytes.length) {
    throw new Error('R2_PORTABLE_INDEX_READBACK_UNVERIFIED');
  }
  return { runId, indexKey, indexSha256, artifactCount: portableArtifacts.length };
}
// END R2 PORTABLE EXPORT FUNCTION

const portableExport = await publishPortableReceiptCopy(receiptSink, runId);
console.log(JSON.stringify({ event: 'R2_PORTABLE_EXPORT_READY', ...portableExport }));
console.log(JSON.stringify({ event: 'FRESH_AUTHORITY_ACCEPTANCE_CAPTURE_COMPLETE', runId, applicationCommit: appSourceSha, applicationRuntime: { manifestSha256: verifiedApplicationRuntime.manifestSha256, fileCount: verifiedApplicationRuntime.files.length }, caseCount: cases.length, modelRequests: liveBounds.totals().model, perCaseModelCap: MAX_MODEL_REQUESTS_PER_CASE, totalModelCap: MAX_MODEL_REQUESTS_PER_RUN, perCaseNonModelCap: MAX_NON_MODEL_REQUESTS_PER_CASE, totalNonModelCap: MAX_NON_MODEL_REQUESTS_PER_RUN, maximumCaseLiveMs: MAX_CASE_LIVE_MS, maximumRunLiveMs: MAX_RUN_LIVE_MS, actualRequestStarts: liveBounds.totals(), liveCaptureGracePerCaseMs: captureWaitLimitMs, perCaseReceiptExportConsumesSubmissionWallClock: true, terminalExporterFinishAndRecoveryOutsideSubmissionDeadline: true, minimumCaseStartIntervalMs: MIN_CASE_START_INTERVAL_MS, modelCaptureSummary, allGenerateContentBodiesRetained: modelCaptureSummary.allGenerateContentBodiesRetained, r2FreshSinkRecovery: 'PASS' }));
