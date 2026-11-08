#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const MODEL = 'gemini-3.5-flash-lite';
const HEAD = '2a282cef56a42e99b7f057de22e863258fddb972';
const SECRET_PATTERNS = [/\bAIza[\w-]{15,}\b/gi, /\bBearer\s+[\w.~+/-]{12,}/gi,
  /\b(?:sk-[\w-]{16,}|gh[pousr]_[\w]{16,}|github_pat_[\w]{16,}|xox[baprs]-[\w-]{16,})\b/gi];

function args(argv) {
  const result = {};
  for (const arg of argv) {
    if (arg.startsWith('--case=')) result.caseId = arg.slice(7);
    else if (arg.startsWith('--out=')) result.out = arg.slice(6);
    else if (arg.startsWith('--max-model-requests=')) result.cap = Number(arg.slice(21));
    else throw new Error('Use --case=<id> --out=<absolute-json-path> [--max-model-requests=1..8].');
  }
  if (!result.caseId || !result.out || !path.win32.isAbsolute(result.out)) throw new Error('Case ID and absolute output path are required.');
  result.cap ??= 8;
  if (!Number.isInteger(result.cap) || result.cap < 1 || result.cap > 8) throw new Error('Model request cap must be 1..8.');
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
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const cases = JSON.parse(await readFile(path.join(directory, 'cases.json'), 'utf8'));
  const testCase = cases.find(item => item.id === option.caseId);
  if (!testCase) throw new Error('Requested case ID was not found.');
  const out = path.resolve(option.out);
  await writeFile(out, '', { flag: 'wx' }).catch(error => {
    if (error?.code === 'EEXIST') throw new Error('Output already exists; choose a new --out path.');
    throw error;
  });

  const secret = String(process.env.GEMINI_API_KEY || '').trim();
  const started = performance.now();
  const checkpoint = {
    schemaVersion: 1, expectedHead: HEAD,
    scope: 'Headless real provider and retrieval; no browser or deployed acceptance.',
    caseId: testCase.id, question: testCase.question, reviewFocus: testCase.reviewFocus,
    authorities: testCase.authorities || [], model: MODEL, startedAt: new Date().toISOString(), status: 'RUNNING',
    stopRemainingCases: false, modelRequestCap: option.cap, modelRequests: [], network: []
  };
  let modelCount = 0, sourceCount = 0, stopReason, capReached = false, timedOut = false;
  const originalFetch = globalThis.fetch, abort = new AbortController(), savedConsole = {};
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    savedConsole[method] = console[method]; console[method] = () => {};
  }
  const restore = () => {
    globalThis.fetch = originalFetch;
    for (const [method, original] of Object.entries(savedConsole)) console[method] = original;
  };
  const save = async status => {
    checkpoint.status = status;
    checkpoint.stopRemainingCases ||= status !== 'COMPLETED';
    checkpoint.stopReason ||= stopReason;
    checkpoint.durationMs = Math.round(performance.now() - started);
    checkpoint.completedAt = new Date().toISOString();
    checkpoint.modelRequestCount = modelCount;
    checkpoint.sourceCount = sourceCount;
    await writeFile(out, `${JSON.stringify(clean(checkpoint, secret), null, 2)}\n`);
  };

  const hardTimer = setTimeout(() => {
    timedOut = true; abort.abort();
    setTimeout(async () => {
      try { await save('TIMEOUT_PARTIAL'); }
      finally { restore(); summary(testCase.id, 'TIMEOUT_PARTIAL', performance.now() - started, modelCount, sourceCount); process.exit(2); }
    }, 150);
  }, 150_000);

  try {
    if (!secret) throw new Error('GEMINI_API_KEY is missing; no provider request was made.');
    if (secret.startsWith('proxy:')) {
      stopReason = 'hosted or browser transport is unavailable in headless Node';
      checkpoint.stopReason = stopReason;
      await save('HOSTED_TRANSPORT_UNAVAILABLE');
      summary(testCase.id, checkpoint.status, performance.now() - started, modelCount, sourceCount);
      process.exitCode = 2;
      return;
    }
    const { processAccountingQuery } = await import('file:///D:/Accounting/src/services/geminiService.ts');
    globalThis.fetch = async (input, init = {}) => {
      if (stopReason) throw new Error(`Provider stopped: ${stopReason}`);
      const raw = urlOf(input); let parsed;
      try { parsed = new URL(raw); } catch { /* Pass through to native fetch. */ }
      const isModel = parsed?.hostname === 'generativelanguage.googleapis.com';
      if (isModel && modelCount >= option.cap) { capReached = true; throw new Error('Model request cap reached.'); }
      let model;
      if (isModel) {
        modelCount += 1;
        let body; try { body = typeof init.body === 'string' ? JSON.parse(init.body) : {}; } catch { body = {}; }
        const system = (body.systemInstruction?.parts || []).map(part => part?.text || '').join('\n');
        const prompt = [...(body.systemInstruction?.parts || []), ...(body.contents || []).flatMap(item => item.parts || [])]
          .map(part => part?.text || '').join('\n');
        model = { number: modelCount, originPath: safeUrl(raw, secret), model: parsed.pathname.match(/\/models\/([^/:]+)/)?.[1],
          systemFirstLine: redact(system.split(/\r?\n/, 1)[0], secret),
          stage: /\[4\. AUTHORITATIVE PRIMARY SOURCE EVIDENCE|\[IRAS_EVIDENCE_BOUND_ANSWER\]/i.test(system) ? 'answer-generation' : 'understanding-or-other',
          promptChars: prompt.length };
        checkpoint.modelRequests.push(model);
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
            const json = await response.clone().json();
            model.candidateText = (json?.candidates || []).flatMap(candidate => candidate?.content?.parts || []).map(part => part?.text || '').join('');
            model.usageMetadata = json?.usageMetadata;
            model.providerError = json?.error;
          } catch (error) { model.responseJsonError = redact(error?.message, secret); }
          if ([401, 403].includes(response.status)) stopReason = 'authentication-or-permission failure';
          else if (response.status === 429) stopReason = 'quota-or-rate limit';
          else if ([404, 500, 502, 503, 504].includes(response.status)) stopReason = 'provider unavailable';
          if (stopReason) { checkpoint.stopRemainingCases = true; checkpoint.stopReason = stopReason; }
        }
        return response;
      } catch (error) {
        entry.status = 'NETWORK_ERROR'; entry.durationMs = Math.round(performance.now() - start); entry.error = clean(error, secret);
        if (model) model.error = clean(error, secret);
        throw error;
      }
    };
    let status = 'COMPLETED';
    try {
      const response = await processAccountingQuery(testCase.question, null, 'SFRS_I',
        { activeProvider: 'gemini', gemini: { apiKey: secret, model: MODEL } }, MODEL, [],
        { journal: false, statutory: false }, {
          onGroundedContext(context) { checkpoint.groundedContext = clean(context, secret); },
          onAuthorityWorkstreams(workstreams) { checkpoint.authorityWorkstreams = clean(workstreams, secret); }
        });
      checkpoint.finalResponse = clean(response, secret);
      const groups = response?.scenarioState?.directGroups || [];
      checkpoint.noJournalCheck = { journalRequested: false, directGroupCount: groups.length, noJournalProduced: groups.length === 0 };
    } catch (error) {
      checkpoint.error = clean(error, secret);
      status = capReached ? 'MODEL_REQUEST_CAP_REACHED' : 'APPLICATION_ERROR';
    }
    if (capReached) status = 'MODEL_REQUEST_CAP_REACHED';
    if (status === 'COMPLETED' && stopReason) status = 'PROVIDER_STOP';
    checkpoint.stopRemainingCases ||= status !== 'COMPLETED';
    if (timedOut) return;
    await save(status);
    summary(testCase.id, status, performance.now() - started, modelCount, sourceCount);
    if (status !== 'COMPLETED') process.exitCode = 2;
  } catch (error) {
    checkpoint.error = clean(error, secret);
    checkpoint.stopRemainingCases = true;
    const status = checkpoint.status === 'RUNNING' ? 'RUNNER_ERROR' : checkpoint.status;
    await save(status);
    summary(testCase.id, status, performance.now() - started, modelCount, sourceCount);
    process.exitCode = 2;
  } finally {
    clearTimeout(hardTimer);
    if (!timedOut) restore();
  }
}

main().catch(error => {
  process.stderr.write(`${redact(error?.message || 'Runner failed.', process.env.GEMINI_API_KEY)}\n`);
  process.exitCode = 2;
});
