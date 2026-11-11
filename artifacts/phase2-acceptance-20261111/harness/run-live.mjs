#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const MODEL = 'gemini-3.5-flash-lite';
const GIT = "C:\\Program Files\\WindowsApps\\OpenAI.CodexPrimaryRuntime.v26-1104-2876-0_26.1104.2876.0_x64__3k8sg7r9htsxt\\dependencies\\native\\git\\cmd\\git.exe";
const git = (...args) => execFileSync(GIT, ['-c', 'safe.directory=D:/Accounting', '-C', 'D:/Accounting', ...args], { encoding: 'utf8', windowsHide: true });
const SECRET_PATTERNS = [/\bAIza[\w-]{15,}\b/gi, /\bBearer\s+[\w.~+/-]{12,}/gi,
  /\b(?:sk-[\w-]{16,}|gh[pousr]_[\w]{16,}|github_pat_[\w]{16,}|xox[baprs]-[\w-]{16,})\b/gi];

export async function awaitActive(promise, signals, message = 'Application request expired during pacing') {
  const result = await promise;
  if (signals.some(signal => signal?.aborted)) throw new DOMException(message, 'AbortError');
  return result;
}

export function classifyModelStage(system) {
  if (/^Interpret the user question only\./i.test(system)) return 'understanding';
  if (/^EVIDENCE_GROUNDED_SYNTHESIS\b/i.test(system)) return 'evidence-grounded-synthesis';
  if (/^EVIDENCE_GROUNDED_SUPPORT_VERIFICATION\b/i.test(system)) return 'evidence-grounded-support-verification';
  if (/\[4\. AUTHORITATIVE PRIMARY SOURCE EVIDENCE|\[IRAS_EVIDENCE_BOUND_ANSWER\]/i.test(system)) return 'answer-generation';
  return 'other';
}

export function createRequestQueue(cap) {
  let tail = Promise.resolve();
  let count = 0;
  return {
    get count() { return count; },
    async acquire(signals) {
      const previous = tail;
      let release;
      tail = new Promise(resolve => { release = resolve; });
      try {
        await awaitActive(previous, signals, 'Application request expired while queued for API pacing');
        if (count >= cap) {
          const error = new Error('Model request cap reached.');
          error.code = 'MODEL_REQUEST_CAP_REACHED';
          throw error;
        }
        let committed = false;
        return {
          commit() { if (!committed) { count += 1; committed = true; } return count; },
          release
        };
      } catch (error) {
        release();
        throw error;
      }
    }
  };
}

export function resolveCaseStatus(status, { capReached, pacingFailure, providerFailure, revisionFailure }) {
  if (revisionFailure) return 'INCONCLUSIVE_REVISION_CHANGED';
  if (capReached) return 'INCONCLUSIVE_MODEL_REQUEST_CAP';
  if (pacingFailure) return 'INCONCLUSIVE_PACING_FAILURE';
  if (providerFailure) return 'INCONCLUSIVE_PROVIDER_FAILURE';
  return status;
}

export function validateRevisionSnapshot(expectedHead, snapshot) {
  if (snapshot?.head !== expectedHead || snapshot?.trackedDirty !== false || !Array.isArray(snapshot?.untrackedSourceFiles) || snapshot.untrackedSourceFiles.length) {
    const error = new Error('Frozen source revision changed or could not be verified.');
    error.code = 'FROZEN_REVISION_CHANGED';
    throw error;
  }
  return snapshot;
}

export function validateParentCapture(testCase, parentCase, capture, expectedHead) {
  const source = capture?.sourceRevision;
  const valid = parentCase?.id === testCase?.parentCaseId &&
    capture?.caseId === testCase.parentCaseId && capture?.question === parentCase.question &&
    capture?.expectedHead === expectedHead && source?.head === expectedHead && source?.dirty === false &&
    Array.isArray(source?.untrackedSourceFiles) && source.untrackedSourceFiles.length === 0 &&
    capture?.stopRemainingCases === false && capture?.status === 'COMPLETED' &&
    !capture?.finalResponse?.advisoryFailureStatus && typeof capture?.finalResponse?.messageText === 'string' &&
    capture.finalResponse.messageText.trim().length > 0 && capture?.noJournalCheck?.noJournalProduced === true;
  if (!valid) throw new Error('Successful same-revision parent capture with complete provenance required.');
  return capture;
}

function verifyFrozenRevision(expectedHead) {
  try {
    const head = git('rev-parse', 'HEAD').trim();
    const trackedDirty = Boolean(git('status', '--porcelain', '--untracked-files=no').trim());
    const untrackedSourceFiles = git('ls-files', '--others', '--exclude-standard', 'src').trim().split(/\r?\n/).filter(Boolean);
    validateRevisionSnapshot(expectedHead, { head, trackedDirty, untrackedSourceFiles });
    const patch = git('diff', '--binary', 'HEAD', '--', 'src');
    return {
      head,
      sourceRevision: {
        head,
        uncommittedSourcePatchSha256: createHash('sha256').update(patch).digest('hex'),
        dirty: Boolean(patch),
        untrackedSourceFiles
      }
    };
  } catch (cause) {
    if (cause?.code === 'FROZEN_REVISION_CHANGED') throw cause;
    const error = new Error('Frozen source revision could not be verified; failing closed.');
    error.code = 'FROZEN_REVISION_CHANGED';
    error.cause = cause;
    throw error;
  }
}

function args(argv) {
  const result = {};
  for (const arg of argv) {
    if (arg.startsWith('--case=')) result.caseId = arg.slice(7);
    else if (arg.startsWith('--out=')) result.out = arg.slice(6);
    else if (arg.startsWith('--max-model-requests=')) result.cap = Number(arg.slice(21));
    else if (arg.startsWith('--frozen-understanding=')) result.frozenUnderstanding = arg.slice(23);
    else if (arg.startsWith('--expected-head=')) result.expectedHead = arg.slice(16);
    else if (arg === '--authorize-live') result.authorizeLive = true;
    else throw new Error('Use --case=<id> --out=<absolute-json-path> [--max-model-requests=1..4] --authorize-live.');
  }
  if (!result.caseId || !result.out || !path.win32.isAbsolute(result.out)) throw new Error('Case ID and absolute output path are required.');
  result.cap ??= 4;
  if (!Number.isInteger(result.cap) || result.cap < 1 || result.cap > 4) throw new Error('Model request cap must be 1..4.');
  if (result.expectedHead && !/^[0-9a-f]{40}$/i.test(result.expectedHead)) throw new Error('Expected head must be a 40-character commit hash.');
  return result;
}

function redact(text, secret) {
  let value = String(text ?? '');
  if (secret) value = value.split(secret).join('[REDACTED]');
  for (const pattern of SECRET_PATTERNS) value = value.replace(pattern, '[REDACTED_CREDENTIAL]');
  return value.replace(/\bproxy:[\w.~+/-]{6,}/gi, 'proxy:[REDACTED]')
    .replace(/\b(?:api[_-]?key|access[_-]?token|authorization|secret)\s*[:=]\s*["']?[^\s,"']+/gi, '[REDACTED_CREDENTIAL]');
}

function clean(value, secret, seen = new WeakSet()) {
  if (typeof value === 'string') return redact(value, secret);
  if (value instanceof Error) return { name: redact(value.name, secret), message: redact(value.message, secret), code: redact(value.code, secret) };
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  const result = Array.isArray(value) ? value.map(item => clean(item, secret, seen)) :
    Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key, secret), clean(item, secret, seen)]));
  seen.delete(value);
  return result;
}

function safeUrl(raw, secret) {
  try { const url = new URL(raw); return `${url.origin}${redact(url.pathname, secret)}`; }
  catch { return '[UNPARSEABLE_URL]'; }
}

function urlOf(input) { return typeof input === 'string' || input instanceof URL ? String(input) : input?.url || ''; }
function summary(id, status, elapsed, modelCount, sourceCount) {
  process.stdout.write(`case=${id} status=${status} durationMs=${Math.round(elapsed)} modelRequests=${modelCount} sourceCount=${sourceCount}\n`);
}

async function main() {
  const option = args(process.argv.slice(2));
  if (!option.authorizeLive) throw new Error('Live execution is disabled until explicitly authorized; no provider request was made.');
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const [originalCases, supplementalCases] = await Promise.all([
    readFile(path.join(directory, 'cases', 'cases.original-eight.json'), 'utf8').then(JSON.parse),
    readFile(path.join(directory, 'cases', 'cases.supplemental-followup.json'), 'utf8').then(JSON.parse)
  ]);
  const cases = [...originalCases, ...supplementalCases];
  const testCase = cases.find(item => item.id === option.caseId);
  if (!testCase) throw new Error('Requested case ID was not found.');
  const EXPECTED_HEAD = option.expectedHead || (await readFile(path.join(directory, 'expected-head.txt'), 'utf8')).trim();
  const initialRevision = verifyFrozenRevision(EXPECTED_HEAD);
  const HEAD = initialRevision.head;
  const SOURCE_REVISION = initialRevision.sourceRevision;
  let frozenUnderstanding;
  if (option.frozenUnderstanding) {
    const retained = JSON.parse(await readFile(option.frozenUnderstanding, 'utf8'));
    const call = retained.modelRequests?.find(item => item.systemFirstLine?.startsWith('Interpret the user question only.'));
    if (retained.caseId !== testCase.id || retained.question !== testCase.question || call?.status !== 200 || !call.candidateText) {
      throw new Error('Frozen understanding must be a successful retained response for this exact fixed question.');
    }
    frozenUnderstanding = { path: option.frozenUnderstanding, text: call.candidateText, used: false };
  }
  const out = path.resolve(option.out);
  await writeFile(out, '', { flag: 'wx' }).catch(error => {
    if (error?.code === 'EEXIST') throw new Error('Output already exists; choose a new --out path.');
    throw error;
  });

  const secret = String(process.env.GEMINI_API_KEY || '').trim();
  const started = performance.now();
  const checkpoint = {
    schemaVersion: 1, expectedHead: HEAD, sourceRevision: SOURCE_REVISION,
    scope: 'Headless real provider and retrieval; no browser or deployed acceptance.',
    caseId: testCase.id, question: testCase.question, reviewFocus: testCase.reviewFocus,
    authorities: testCase.authorities || [], model: MODEL, startedAt: new Date().toISOString(), status: 'RUNNING',
    stopRemainingCases: false, modelRequestCap: option.cap, modelRequests: [], network: []
  };
  if (frozenUnderstanding) {
    checkpoint.scope = 'Headless fresh official-source retrieval and real generation/support calls with retained understanding; not fresh end-to-end acceptance.';
    checkpoint.frozenUnderstanding = { capture: frozenUnderstanding.path, syntheticUnderstandingResponses: 0, realUnderstandingRequests: 0 };
  }
  let modelCount = 0, sourceCount = 0, stopReason, capReached = false, pacingFailure = false, providerFailure = false, revisionFailure = false, timedOut = false;
  let lastModelRequestStartedAt = 0;
  const modelQueue = createRequestQueue(option.cap);
  const originalFetch = globalThis.fetch, abort = new AbortController(), savedConsole = {};
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    savedConsole[method] = console[method]; console[method] = () => {};
  }
  const restore = () => {
    globalThis.fetch = originalFetch;
    for (const [method, original] of Object.entries(savedConsole)) console[method] = original;
  };
  const save = async status => {
    try { verifyFrozenRevision(HEAD); }
    catch (error) {
      revisionFailure = true;
      stopReason = 'frozen source revision changed or verification failed';
      checkpoint.revisionVerificationError = clean(error, secret);
      checkpoint.stopRemainingCases = true;
      checkpoint.stopReason = stopReason;
    }
    status = resolveCaseStatus(status, { capReached, pacingFailure, providerFailure, revisionFailure });
    checkpoint.status = status;
    checkpoint.stopRemainingCases ||= status !== 'COMPLETED';
    checkpoint.stopReason ||= stopReason;
    checkpoint.durationMs = Math.round(performance.now() - started);
    checkpoint.completedAt = new Date().toISOString();
    checkpoint.modelRequestCount = modelCount;
    checkpoint.sourceCount = sourceCount;
    await writeFile(out, `${JSON.stringify(clean(checkpoint, secret), null, 2)}\n`);
    return status;
  };

  const hardTimer = setTimeout(() => {
    timedOut = true; abort.abort();
    setTimeout(async () => {
      let savedStatus = 'TIMEOUT_PARTIAL';
      try { savedStatus = await save('TIMEOUT_PARTIAL'); }
      finally { restore(); summary(testCase.id, savedStatus, performance.now() - started, modelCount, sourceCount); process.exit(2); }
    }, 150);
  }, 150_000);

  try {
    if (!secret) throw new Error('GEMINI_API_KEY is missing; no provider request was made.');
    if (secret.startsWith('proxy:')) {
      stopReason = 'hosted or browser transport is unavailable in headless Node';
      checkpoint.stopReason = stopReason;
      const savedStatus = await save('HOSTED_TRANSPORT_UNAVAILABLE');
      summary(testCase.id, savedStatus, performance.now() - started, modelCount, sourceCount);
      process.exitCode = 2;
      return;
    }
    const { processAccountingQuery } = await import('file:///D:/Accounting/src/services/geminiService.ts');
    globalThis.fetch = async (input, init = {}) => {
      if (stopReason) throw new Error(`Provider stopped: ${stopReason}`);
      const raw = urlOf(input); let parsed;
      try { parsed = new URL(raw); } catch { /* Pass through to native fetch. */ }
      const isModel = parsed?.hostname === 'generativelanguage.googleapis.com';
      if (isModel && frozenUnderstanding) {
        const request = JSON.parse(init.body);
        const system = (request.systemInstruction?.parts || []).map(part => part?.text || '').join('\n');
        if (system.startsWith('Interpret the user question only.')) {
          if (frozenUnderstanding.used) throw new Error('A second understanding request is forbidden during frozen-plan replay.');
          frozenUnderstanding.used = true;
          checkpoint.frozenUnderstanding.syntheticUnderstandingResponses = 1;
          return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: frozenUnderstanding.text }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (!frozenUnderstanding.used) throw new Error('Expected the understanding stage before frozen-plan replay.');
      }
      let model;
      if (isModel) {
        let permit;
        try {
        permit = await modelQueue.acquire([init.signal || input?.signal, abort.signal]);
        } catch (error) {
          if (error.code === 'MODEL_REQUEST_CAP_REACHED') { capReached = true; stopReason = 'model request cap reached'; }
          else { pacingFailure = true; stopReason = 'application request expired while queued for API pacing'; }
          checkpoint.stopRemainingCases = true; checkpoint.stopReason = stopReason;
          throw error;
        }
        try {
        if (stopReason) throw new Error(`Provider stopped: ${stopReason}`);
        const waitMs = Math.max(0, lastModelRequestStartedAt + 5100 - Date.now());
        if (waitMs) await awaitActive(new Promise(resolve => setTimeout(resolve, waitMs)), [init.signal || input?.signal, abort.signal]);
        if (abort.signal.aborted || init.signal?.aborted || input?.signal?.aborted) throw new DOMException('Application request expired during API pacing', 'AbortError');
        if (stopReason) throw new Error(`Provider stopped: ${stopReason}`);
        const apiBody = typeof init.body === 'string' ? JSON.parse(init.body) : {};
        const reservedTokens = new TextEncoder().encode(JSON.stringify(apiBody)).length + (apiBody.generationConfig?.maxOutputTokens || 65536);
        if (reservedTokens > 200000) { pacingFailure = true; stopReason = 'conservative token-rate budget rejected the request'; checkpoint.stopRemainingCases = true; throw new Error('Request exceeds conservative token-rate budget'); }
        const ratePath = path.join(directory, 'api-rate-reservations.json');
        let reservations = await awaitActive(readFile(ratePath, 'utf8').then(JSON.parse).catch(error => {
          if (error.code === 'ENOENT') return [];
          throw error;
        }), [init.signal || input?.signal, abort.signal]);
        while (true) {
          const now = Date.now();
          reservations = reservations.filter(item => item.at > now - 60100);
          const rateWait = reservations.length ? Math.max(0, reservations.at(-1).at + 5100 - now) : 0;
          const tokenWait = reservations.reduce((sum, item) => sum + item.tokens, 0) + reservedTokens > 200000
            ? Math.max(1, reservations[0].at + 60100 - now) : 0;
          if (!rateWait && !tokenWait) break;
          await awaitActive(new Promise(resolve => setTimeout(resolve, Math.max(rateWait, tokenWait))), [init.signal || input?.signal, abort.signal]);
        }
        reservations.push({ at: Date.now(), tokens: reservedTokens });
        await awaitActive(writeFile(ratePath, JSON.stringify(reservations)), [init.signal || input?.signal, abort.signal]);
        verifyFrozenRevision(HEAD);
        if (abort.signal.aborted || init.signal?.aborted || input?.signal?.aborted) throw new DOMException('Application request expired before provider dispatch', 'AbortError');
        lastModelRequestStartedAt = Date.now();
        modelCount = permit.commit();
        let body; try { body = typeof init.body === 'string' ? JSON.parse(init.body) : {}; } catch { body = {}; }
        const system = (body.systemInstruction?.parts || []).map(part => part?.text || '').join('\n');
        const prompt = [...(body.systemInstruction?.parts || []), ...(body.contents || []).flatMap(item => item.parts || [])]
          .map(part => part?.text || '').join('\n');
        model = { number: modelCount, requestStartedAt: new Date(lastModelRequestStartedAt).toISOString(), originPath: safeUrl(raw, secret), model: parsed.pathname.match(/\/models\/([^/:]+)/)?.[1],
          systemFirstLine: redact(system.split(/\r?\n/, 1)[0], secret),
          stage: classifyModelStage(system),
          promptChars: prompt.length };
        model.rateReservationAt = reservations.at(-1).at;
        checkpoint.modelRequests.push(model);
        } catch (error) {
          if (error?.code === 'FROZEN_REVISION_CHANGED') { revisionFailure = true; stopReason = 'frozen source revision changed before provider dispatch'; checkpoint.revisionVerificationError = clean(error, secret); }
          else if (!capReached && !providerFailure && !stopReason) { pacingFailure = true; stopReason = error?.name === 'AbortError' ? 'application request expired during API pacing' : 'model request pacing failed'; }
          if (revisionFailure || pacingFailure || capReached) { checkpoint.stopRemainingCases = true; checkpoint.stopReason = stopReason; }
          throw error;
        } finally { permit.release(); }
      }
      const start = performance.now();
      const entry = { originPath: parsed ? safeUrl(raw, secret) : '[UNPARSEABLE_URL]', method: String(init.method || input?.method || 'GET').toUpperCase(), status: undefined, durationMs: undefined, responseMetadata: undefined, modelRequest: Boolean(isModel) };
      checkpoint.network.push(entry);
      if (!isModel) sourceCount += 1;
      try {
        const response = await originalFetch(input, { ...init, signal: AbortSignal.any([init.signal || input?.signal, abort.signal].filter(Boolean)) });
        entry.status = response.status; entry.durationMs = Math.round(performance.now() - start);
        entry.responseMetadata = {
          contentType: redact(response.headers.get('content-type'), secret),
          contentLength: response.headers.get('content-length') || undefined,
          etag: redact(response.headers.get('etag'), secret) || undefined,
          lastModified: response.headers.get('last-modified') || undefined,
          redirectPath: response.headers.get('location') ? safeUrl(new URL(response.headers.get('location'), raw), secret) : undefined
        };
        if (model) {
          model.status = response.status; model.durationMs = entry.durationMs;
          try {
            const bodyText = await response.clone().text();
          let packets;
          try { const parsed = JSON.parse(bodyText); packets = Array.isArray(parsed) ? parsed : [parsed]; }
          catch { packets = bodyText.split(/\r?\n/).filter(line => line.startsWith('data: ')).flatMap(line => { try { return [JSON.parse(line.slice(6))]; } catch { return []; } }); }
          model.candidateText = redact(packets.flatMap(data => (data?.candidates || []).flatMap(candidate => candidate.content?.parts || [])).map(part => part?.text || '').join(''), secret);
          model.usageMetadata = clean(packets.map(data => data?.usageMetadata).filter(Boolean).at(-1), secret);
          const reportedTokens = model.usageMetadata?.totalTokenCount;
          if (Number.isFinite(reportedTokens) && reportedTokens > 0) {
            const ratePath = path.join(directory, 'api-rate-reservations.json');
            const reservations = JSON.parse(await readFile(ratePath, 'utf8'));
            const reservation = reservations.find(item => item.at === model.rateReservationAt);
            if (reservation) reservation.tokens = reportedTokens + 1024;
            await writeFile(ratePath, JSON.stringify(reservations));
          }
          model.providerError = clean(packets.map(data => data?.error).filter(Boolean).at(-1), secret);
          } catch (error) { model.responseJsonError = redact(error?.message, secret); }
          if (!response.ok) { providerFailure = true; stopReason = `provider returned HTTP ${response.status}`; }
          if (stopReason) { checkpoint.stopRemainingCases = true; checkpoint.stopReason = stopReason; }
        }
        return response;
      } catch (error) {
        entry.status = 'NETWORK_ERROR'; entry.durationMs = Math.round(performance.now() - start); entry.error = clean(error, secret);
        if (model) { model.error = clean(error, secret); providerFailure = true; stopReason = 'provider network or aborted request'; checkpoint.stopRemainingCases = true; checkpoint.stopReason = stopReason; }
        throw error;
      }
    };
    let history = [];
    if (testCase.parentCaseId) {
      const parentCase = cases.find(item => item.id === testCase.parentCaseId);
      const parent = JSON.parse(await readFile(path.join(directory, 'answers', testCase.parentCaseId + '.json'), 'utf8'));
      validateParentCapture(testCase, parentCase, parent, HEAD);
      history = [
        { id: 'acceptance-parent-user', sender: 'user', timestamp: '', text: parent.question },
        { id: 'acceptance-parent-answer', sender: 'ai', timestamp: '', text: parent.finalResponse.messageText, fullText: parent.finalResponse.messageText }
      ];
      checkpoint.parentCapture = path.join(directory, 'answers', testCase.parentCaseId + '.json');
    }
    let status = 'COMPLETED';
    try {
      const response = await processAccountingQuery(testCase.question, null, 'SFRS_I',
        { activeProvider: 'gemini', gemini: { apiKey: secret, model: MODEL } }, MODEL, history,
        { journal: false, statutory: false }, {
          onGroundedContext(context) { checkpoint.groundedContext = clean(context, secret); },
          onAuthorityWorkstreams(workstreams) { checkpoint.authorityWorkstreams = clean(workstreams, secret); }
        });
      checkpoint.finalResponse = clean(response, secret);
      const state = response?.scenarioState || {};
      const directGroups = state.directGroups || [];
      const projectedGroups = state.projectedGroups || [];
      const committedGroups = state.committedDirectGroups || [];
      checkpoint.noJournalCheck = {
        journalRequested: false, directGroupCount: directGroups.length,
        projectedGroupCount: projectedGroups.length, committedGroupCount: committedGroups.length,
        noJournalProduced: directGroups.length + projectedGroups.length + committedGroups.length === 0
      };
    } catch (error) {
      checkpoint.error = clean(error, secret);
      status = capReached ? 'INCONCLUSIVE_MODEL_REQUEST_CAP' : 'APPLICATION_ERROR';
    }
    status = resolveCaseStatus(status, { capReached, pacingFailure, providerFailure, revisionFailure });
    checkpoint.stopRemainingCases ||= status !== 'COMPLETED';
    if (timedOut) return;
    status = await save(status);
    summary(testCase.id, status, performance.now() - started, modelCount, sourceCount);
    if (status !== 'COMPLETED') process.exitCode = 2;
  } catch (error) {
    checkpoint.error = clean(error, secret);
    checkpoint.stopRemainingCases = true;
    const status = checkpoint.status === 'RUNNING' ? 'RUNNER_ERROR' : checkpoint.status;
    const savedStatus = await save(status);
    summary(testCase.id, savedStatus, performance.now() - started, modelCount, sourceCount);
    process.exitCode = 2;
  } finally {
    clearTimeout(hardTimer);
    if (!timedOut) restore();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${redact(error?.message || 'Runner failed.', process.env.GEMINI_API_KEY)}\n`);
    process.exitCode = 2;
  });
}
