// Reviewed V4 transport bindings. The runner loads only the exports named in
// the separate frozen activation configuration. Credentials stay process-local.
import { createHash } from 'node:crypto';
import { SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA } from '../src/services/semanticQuestionUnderstanding.ts';

const MODEL = 'gemini-3.5-flash-lite';
const TIMEOUT_MS = 8_000;
const MINIMUM_PROVIDER_START_GAP_MS = 15_250;
const MAX_HTTP_RESPONSE_BYTES = 65_536;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const stableJson = value => JSON.stringify(value);
const callCases = new Set();
let previousProviderStartAt;

function assertSemanticRequest({ prompt, system, provider, options, caseId }) {
  if (!['target-relief-entitlement', 'target-relief-amount', 'A-paraphrase-2', 'private-expense-treatment',
    'foreign-dividend-receipt-treatment', 'corporate-residency-general-rule', 'wht-royalty-general-rule',
    'gst-input-tax-general-rule', 'unsupported-sfrsi-6-exploration-evaluation'].includes(caseId)) {
    throw new Error('V4_SEMANTIC_CASE_NOT_IN_FIXED_CONTRACT');
  }
  if (typeof prompt !== 'string' || prompt.length > 100_000 || typeof system !== 'string' || system.length > 10_000) {
    throw new Error('V4_SEMANTIC_REQUEST_TEXT_INVALID');
  }
  if (provider?.activeProvider !== 'gemini' || provider?.gemini?.model !== MODEL) {
    throw new Error('V4_SEMANTIC_PROVIDER_OPTIONS_MISMATCH');
  }
  const expected = {
    jsonMode: true,
    responseJsonSchema: SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA,
    timeoutMs: TIMEOUT_MS,
    temperature: 0
  };
  if (stableJson(options) !== stableJson(expected)) throw new Error('V4_SEMANTIC_PROVIDER_OPTIONS_MISMATCH');
}

function providerEnvelopePartial(status, bytes, { failureCode = null, truncated = false } = {}) {
  const body = Buffer.from(bytes || Buffer.alloc(0));
  return {
    kind: 'GEMINI_HTTP_ENVELOPE',
    status: Number.isInteger(status) ? status : null,
    failureCode,
    truncated,
    bodyBase64: body.toString('base64'),
    bodySha256: sha256(body),
    bodyBytes: body.length
  };
}

function providerError(code, status, bytes, options = {}) {
  const error = new Error(code);
  error.partialProviderResponse = providerEnvelopePartial(status, bytes, { failureCode: code, ...options });
  return error;
}

async function waitForPhysicalProviderStart(signal) {
  while (previousProviderStartAt !== undefined) {
    const remaining = MINIMUM_PROVIDER_START_GAP_MS - (performance.now() - previousProviderStartAt);
    if (remaining <= 0) break;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(done, remaining);
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(providerError('V4_PROVIDER_TIMEOUT', null, Buffer.alloc(0)));
      };
      function done() {
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) onAbort();
        else resolve();
      }
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
  const startAt = performance.now();
  if (previousProviderStartAt !== undefined && startAt - previousProviderStartAt < MINIMUM_PROVIDER_START_GAP_MS) {
    return await waitForPhysicalProviderStart(signal);
  }
  previousProviderStartAt = startAt;
}

async function readBoundedResponse(response, maximumBytes, signal) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maximumBytes) {
    void response.body?.cancel().catch(() => {});
    throw providerError('V4_SEMANTIC_HTTP_RESPONSE_TOO_LARGE', response.status, Buffer.alloc(0), { truncated: true });
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let abort;
  const abortPromise = new Promise((_, reject) => { abort = () => {
    reader.cancel().catch(() => {});
    reject(providerError('V4_PROVIDER_TIMEOUT', response.status, Buffer.concat(chunks)));
  }; });
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) {
      void reader.cancel().catch(() => {});
      throw providerError('V4_PROVIDER_TIMEOUT', response.status, Buffer.concat(chunks, total));
    }
    while (true) {
      const { done, value } = await Promise.race([reader.read(), abortPromise]);
      if (signal?.aborted) throw providerError('V4_PROVIDER_TIMEOUT', response.status, Buffer.concat(chunks, total));
      if (done) break;
      const chunk = Buffer.from(value);
      const remaining = Math.max(0, maximumBytes - total);
      if (chunk.length > remaining) {
        if (remaining) chunks.push(chunk.subarray(0, remaining));
        total += remaining;
        void reader.cancel().catch(() => {});
        throw providerError('V4_SEMANTIC_HTTP_RESPONSE_TOO_LARGE', response.status,
          Buffer.concat(chunks, total), { truncated: true });
      }
      chunks.push(chunk);
      total += chunk.length;
    }
  } catch (error) {
    if (!error?.partialProviderResponse) {
      error.partialProviderResponse = providerEnvelopePartial(response.status, Buffer.concat(chunks, total), {
        failureCode: String(error?.message || error).slice(0, 120),
        truncated: total >= maximumBytes
      });
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    try { reader.releaseLock(); } catch {}
  }
  return Buffer.concat(chunks, total);
}

/** One physical Gemini call, fixed model and JSON schema, no retries or redirects. */
export async function sendV4SemanticRequest({ prompt, system, provider, options, caseId, signal }) {
  assertSemanticRequest({ prompt, system, provider, options, caseId });
  if (callCases.has(caseId)) throw new Error('V4_EXTRA_OR_RETRY_SEMANTIC_CALL_BLOCKED');
  callCases.add(caseId);
  const apiKey = process.env.GEMINI_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.trim().length <= 10) throw new Error('V4_GEMINI_CREDENTIAL_UNAVAILABLE');
  const controller = new AbortController();
  const relayAbort = () => controller.abort();
  signal?.addEventListener('abort', relayAbort, { once: true });
  if (signal?.aborted) controller.abort();
  let timer;
  try {
    await waitForPhysicalProviderStart(controller.signal);
    timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: {
        responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA } },
        temperature: 0
      }
    };
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey.trim() },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const responseBytes = await readBoundedResponse(response, MAX_HTTP_RESPONSE_BYTES, controller.signal);
    if (!response.ok) throw providerError(`V4_PROVIDER_HTTP_${response.status}`, response.status, responseBytes);
    let envelope;
    try { envelope = JSON.parse(responseBytes.toString('utf8')); }
    catch { throw providerError('V4_PROVIDER_RESPONSE_MALFORMED', response.status, responseBytes); }
    const text = envelope?.candidates?.[0]?.content?.parts?.find(part => typeof part?.text === 'string')?.text;
    if (typeof text !== 'string') throw providerError('V4_PROVIDER_RESPONSE_MISSING_TEXT', response.status, responseBytes);
    if (Buffer.byteLength(text, 'utf8') > MAX_HTTP_RESPONSE_BYTES) {
      throw providerError('V4_SEMANTIC_RESPONSE_TOO_LARGE', response.status, responseBytes);
    }
    return text;
  } catch (error) {
    if (String(error?.message || '').startsWith('V4_')) throw error;
    const code = error?.name === 'AbortError' ? 'V4_PROVIDER_TIMEOUT' : 'V4_PROVIDER_TRANSPORT_FAILURE';
    if (error?.partialProviderResponse) {
      const normalized = new Error(code);
      normalized.partialProviderResponse = {
        ...error.partialProviderResponse,
        failureCode: code
      };
      throw normalized;
    }
    throw providerError(code, null, Buffer.alloc(0));
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', relayAbort);
  }
}

/** The runner scopes this export to its reviewed explicit-transport capability. */
export async function fetchV4OfficialSource(url, init = {}) {
  return await fetch(url, { ...init, redirect: 'manual' });
}

/** Capture-only executor: acquire exact source-map and sitemap rows; never semantic fixtures. */
export async function runV4CapturePlan({ captureInventory, webRetriever, withEvidenceFamily }) {
  if (!Array.isArray(captureInventory) || typeof webRetriever?.fetchOfficialSource !== 'function' ||
      typeof withEvidenceFamily !== 'function') throw new Error('V4_CAPTURE_PLAN_BINDINGS_INVALID');
  const rows = [];
  for (const row of captureInventory) {
    if (row.purpose === 'REDIRECT') continue;
    const result = await withEvidenceFamily(row.family, () => webRetriever.fetchOfficialSource(row.url, {
      useCache: false,
      timeoutMs: 3_000,
      maxRedirects: 1
    }));
    rows.push({
      family: row.family,
      purpose: row.purpose,
      url: row.url,
      sourceRecordIds: row.provenance.sourceRecordIds,
      topicIds: row.provenance.topicIds,
      status: result.status,
      httpStatus: Number.isInteger(result.httpStatus) ? result.httpStatus : null,
      finalUrl: result.finalUrl || result.sourceUrl || row.url,
      contentBytes: typeof result.content === 'string' ? Buffer.byteLength(result.content, 'utf8') : 0,
      contentSha256: typeof result.content === 'string' ? sha256(result.content) : null
    });
  }
  return { profile: 'iras-v4-capture-plan', rows };
}
