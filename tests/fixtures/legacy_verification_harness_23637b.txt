// One explicitly dispatched development verification; never part of normal builds.
// Publish only on an isolated verification branch containing this root-level
// .verify-final-build-live.mjs and the package.json postbuild hook.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { processAccountingQuery } from './src/services/geminiService.ts';

const cases = [
  { id: 'acra', question: 'Under ACRA guidance, must Singapore-incorporated companies file annual returns? Explain the general filing duty using official ACRA guidance. Do not calculate a deadline or create journal entries.', authorities: ['ACRA'] },
  { id: 'cpf', question: 'Under CPF Board guidance, what makes a payment ordinary wages for CPF contributions? Explain the general definition using official CPF Board guidance. Do not calculate contribution rates or amounts and do not create journal entries.', authorities: ['CPF_BOARD'] },
  { id: 'mom', question: 'Under MOM guidance, which employees are covered by Part IV of the Employment Act for working hours and overtime? Explain the general coverage using official MOM guidance. Do not calculate pay or create journal entries.', authorities: ['MOM'] },
  { id: 'mas', question: 'Under MAS guidance, what is a Capital Markets Services Licence and when is it generally required? Explain the general licensing requirement using official MAS guidance. Do not assess a particular business or create journal entries.', authorities: ['MAS'] },
  { id: 'iras-residency', question: 'For Singapore corporate income tax, is incorporation in Singapore alone enough to make a company tax resident? Explain the general control-and-management test using IRAS guidance. Do not calculate tax or create journal entries.', authorities: ['IRAS'] },
  { id: 'iras-relief', question: 'Under IRAS rules, can cash top-ups to my own CPF Special Account or Retirement Account qualify for tax relief? Explain the general eligibility conditions and relief limits using official IRAS guidance. This is a general rules question; do not calculate my personal tax or create journal entries.', authorities: ['IRAS'] },
  { id: 'iras-gst', question: 'A Singapore GST-registered business purchases a private passenger motor car for business use. Is the GST on the purchase generally claimable as input tax? Explain the general IRAS restriction and relevant exceptions. Do not calculate amounts or create journal entries.', authorities: ['IRAS'] },
  { id: 'mixed-acra-cpf', question: 'Under ACRA guidance, must Singapore-incorporated companies file annual returns? Explain the general filing duty using official ACRA guidance. Do not calculate a deadline or create journal entries. Separately, Under CPF Board guidance, what makes a payment ordinary wages for CPF contributions? Explain the general definition using official CPF Board guidance. Do not calculate contribution rates or amounts and do not create journal entries.', authorities: ['ACRA', 'CPF_BOARD'] },
  { id: 'mixed-mom-mas', question: 'Under MOM guidance, which employees are covered by Part IV of the Employment Act for working hours and overtime? Explain the general coverage using official MOM guidance. Do not calculate pay or create journal entries. Separately, Under MAS guidance, what is a Capital Markets Services Licence and when is it generally required? Explain the general licensing requirement using official MAS guidance. Do not assess a particular business or create journal entries.', authorities: ['MOM', 'MAS'] },
  { id: 'mixed-iras-three', question: 'For Singapore corporate income tax, is incorporation in Singapore alone enough to make a company tax resident? Explain the general control-and-management test using IRAS guidance. Do not calculate tax or create journal entries. Separately, Under IRAS rules, can cash top-ups to my own CPF Special Account or Retirement Account qualify for tax relief? Explain the general eligibility conditions and relief limits using official IRAS guidance. This is a general rules question; do not calculate my personal tax or create journal entries. Separately, A Singapore GST-registered business purchases a private passenger motor car for business use. Is the GST on the purchase generally claimable as input tax? Explain the general IRAS restriction and relevant exceptions. Do not calculate amounts or create journal entries.', authorities: ['IRAS'] }
];

const appSourceSha = '630113b74f9ebcec7b3498644645b5ca61a0b73b';
const expectedAppTreeSha256 = '6ab427cdaac791e7b95f33f4561958162c64fac20938cb021d880731c0649474';
if (!/^[0-9a-f]{40}$/i.test(appSourceSha)) throw new Error('Set 630113b74f9ebcec7b3498644645b5ca61a0b73b to the reviewed app commit before dispatch.');
if (!/^[0-9a-f]{64}$/i.test(expectedAppTreeSha256)) throw new Error('Set 6ab427cdaac791e7b95f33f4561958162c64fac20938cb021d880731c0649474 to the reviewed app tree hash before dispatch.');

const verificationCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const commitMetadata = execFileSync('git', ['cat-file', '-p', 'HEAD'], { encoding: 'utf8' });
const parentShas = [...commitMetadata.matchAll(/^parent ([0-9a-f]{40})$/gm)].map(match => match[1]);
if (parentShas.length !== 1 || parentShas[0] !== appSourceSha) {
  throw new Error('Verification commit must have the reviewed app source as its sole parent.');
}

const excludedHarnessPaths = new Set(['package.json', '.verify-final-build-live.mjs']);
const trackedEntries = execFileSync('git', ['ls-tree', '-r', '-z', 'HEAD'], { encoding: 'utf8' })
  .split('\0').filter(Boolean)
  .filter(entry => !excludedHarnessPaths.has(entry.slice(entry.indexOf('\t') + 1)))
  .sort();
const actualAppTreeSha256 = createHash('sha256').update(trackedEntries.join('\n')).digest('hex');
if (actualAppTreeSha256 !== expectedAppTreeSha256) {
  throw new Error('Tracked application tree differs from the reviewed app source tree.');
}

const model = 'gemini-3.5-flash-lite';
const executionEnvironment = 'CLOUDFLARE_BUILD_NODE';
const sourceTransport = 'NODE_DIRECT_OFFICIAL_SOURCE';
const sourceBodyLimitBytes = 1_500_000;
const modelResponseBodyLimitBytes = 1_500_000;
const captureWaitLimitMs = 12_000;
const postTimeoutCancelWaitMs = 250;
const logPartCharacters = 900;
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
const sourceHash = async path => createHash('sha256').update(await readFile(path)).digest('hex');

function newCaseState(testCase) {
  return {
    id: testCase.id,
    dispatches: { model: 0, source: 0, other: 0 },
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
      record.captureStatus = 'FAILED';
      record.captureError = cleanError(error);
    }
  ).finally(() => state.pendingCaptures.delete(task));
  state.pendingCaptures.add(task);
}

function registerCaptureReader(state, reader) {
  if (!reader) return;
  state.captureReaders.add(reader);
  if (state.captureDeadlineExpired) {
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
  const deadline = Date.now() + captureWaitLimitMs;
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

function emitCase(receipt) {
  const json = scrub(JSON.stringify(receipt));
  const encoded = gzipSync(Buffer.from(json, 'utf8')).toString('base64');
  const parts = Math.max(1, Math.ceil(encoded.length / logPartCharacters));
  const summary = {
    id: receipt.id,
    appSourceSha,
    verificationCommitSha,
    actualAppTreeSha256,
    executionEnvironment,
    sourceTransport,
    status: receipt.status,
    semanticPlanSource: receipt.semanticPlanSource,
    dispatches: receipt.dispatches,
    modelResponses: receipt.modelResponses.map(({ httpStatus, endpoint, generateContent, retainedRawBody, returnedText, responseBodyHashScope, responseBodyBytesRead, responseBodyBytesCaptured, responseBodyTruncated, responseBodyCaptureLimitBytes, captureStatus, captureError }) => ({
      httpStatus, url: endpoint, generateContent, retainedRawBody, returnedText, responseBodyHashScope, responseBodyBytesRead, responseBodyBytesCaptured, responseBodyTruncated, responseBodyCaptureLimitBytes, captureStatus, captureError
    })),
    sourceResponses: receipt.sourceResponses.map(({ requestUrl, finalUrl, httpStatus, contentType, bodyTruncated, captureStatus, captureError }) => ({
      requestUrl, finalUrl, httpStatus, contentType, bodyTruncated, captureStatus, captureError
    })),
    captureWindow: receipt.captureWindow,
    captureCompleteness: receipt.captureCompleteness,
    error: receipt.error,
    parts,
    encoding: 'gzip-base64'
  };
  output('SHARED_MILESTONE_CASE ' + scrub(JSON.stringify(summary)));
  for (let part = 0; part < parts; part += 1) {
    output('SHARED_MILESTONE_PART ' + JSON.stringify({ id: receipt.id, part, parts, encoding: 'gzip-base64', data: encoded.slice(part * logPartCharacters, (part + 1) * logPartCharacters) }));
  }
}

const hashes = {
  geminiService: await sourceHash('src/services/geminiService.ts'),
  semanticQuestionUnderstanding: await sourceHash('src/services/semanticQuestionUnderstanding.ts'),
  queryTopicResolver: await sourceHash('src/retrieval/queryTopicResolver.ts'),
  authorityWorkstreams: await sourceHash('src/services/authorityWorkstreams.ts'),
  groundingContextBuilder: await sourceHash('src/services/groundingContextBuilder.ts'),
  requestCompleteness: await sourceHash('src/services/requestCompleteness.ts')
};

output('SHARED_MILESTONE_BEGIN ' + JSON.stringify({
  appSourceSha,
  verificationCommitSha,
  expectedAppTreeSha256,
  actualAppTreeSha256,
  hashes,
  executionEnvironment,
  sourceTransport,
  model,
  cases: cases.length,
  modelResponseCapture: { maxBytesPerResponse: modelResponseBodyLimitBytes, retainRawBodyForFirstGenerateContentOnly: true },
  sourceBodyCapture: { approvedHosts: [...approvedOfficialHosts], maxBytesPerResponse: sourceBodyLimitBytes, fullResponseHashWhenComplete: true },
  scope: 'New development live-answer capture only; no canonical acceptance, source activation or production deployment'
}));

for (const method of Object.keys(originalConsole)) console[method] = () => {};
globalThis.fetch = async (input, init) => {
  const state = caseContext.getStore();
  if (!state) return nativeFetch(input, init);
  const target = targetUrlOf(input);
  const requestUrl = target.href;
  const modelRequest = target.hostname.toLowerCase() === 'generativelanguage.googleapis.com';
  const sourceRequest = isApprovedOfficialUrl(requestUrl);
  if (modelRequest) state.dispatches.model += 1;
  else if (sourceRequest) state.dispatches.source += 1;
  else state.dispatches.other += 1;
  state.inFlightFetches += 1;
  try {
    const response = await nativeFetch(input, init);
    if (modelRequest) {
      const generateContent = target.pathname.endsWith(':generateContent');
      const retainRawBody = generateContent && !state.firstGenerateContentSeen;
      if (retainRawBody) state.firstGenerateContentSeen = true;
      const record = {
        endpoint: `${target.origin}${target.pathname}`,
        httpStatus: response.status,
        generateContent,
        retainedRawBody: retainRawBody
      };
      state.modelResponses.push(record);
      scheduleCapture(state, record, captureModelClone(response, state, retainRawBody));
    } else if (sourceRequest) {
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

let casesWithErrors = 0;
try {
  for (const testCase of cases) {
    const state = newCaseState(testCase);
    const startedAtUTC = new Date().toISOString();
    let observed;
    let grounded;
    let response;
    let error;
    if (key) {
      try {
        response = await caseContext.run(state, () => processAccountingQuery(
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
        ));
      } catch (caught) {
        error = cleanError(caught);
        casesWithErrors += 1;
      }
    } else {
      error = { name: 'CredentialUnavailable', message: 'Development model credential is unavailable; no model or source requests were attempted.' };
      casesWithErrors += 1;
    }

    const captureWindow = await waitForCaseCaptures(state);
    const presentation = response?.scenarioState?.authorityEvidencePresentation;
    const semanticPlanSource = observed?.issuePlan?.source || 'NOT_EXPOSED';
    const receipt = {
      id: testCase.id,
      question: testCase.question,
      authorities: testCase.authorities,
      appSourceSha,
      verificationCommitSha,
      actualAppTreeSha256,
      executionEnvironment,
      sourceTransport,
      startedAtUTC,
      observedAtUTC: new Date().toISOString(),
      status: error ? (key ? 'QUERY_ERROR' : 'NOT_ATTEMPTED_MISSING_CREDENTIAL') :
        observed?.status || presentation?.status || response?.evidenceQuality?.status || 'UNEXPOSED',
      providerStatus: response?.providerStatus ?? (key ? 'NOT_EXPOSED' : 'NOT_ATTEMPTED'),
      answerPath: response?.answerPath,
      semanticPlanSource,
      semanticPlanAccepted: semanticPlanSource === 'SEMANTIC_ISSUES',
      error,
      dispatches: state.dispatches,
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
    emitCase(receipt);
  }
} finally {
  globalThis.fetch = nativeFetch;
  for (const [method, original] of Object.entries(originalConsole)) console[method] = original;
}

output('SHARED_MILESTONE_END ' + JSON.stringify({
  appSourceSha,
  verificationCommitSha,
  actualAppTreeSha256,
  completedAtUTC: new Date().toISOString(),
  cases: cases.length,
  casesWithErrors,
  noManualRetries: true,
  lateCaptureEmission: 'DISABLED_AFTER_CASE_RECEIPT',
  outcome: casesWithErrors === 0 ? 'ALL_CASES_RECORDED' : 'CASES_RECORDED_WITH_FAILURES',
  captureLimitMsPerCase: captureWaitLimitMs
}));
