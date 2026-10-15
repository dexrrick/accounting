import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { captureOfficialDocuments } from './capture_official_documents.mjs';
import { ControlledWebRetriever } from '../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../src/retrieval/sourceCache.ts';

export const MAS_PREVIEW_ORIGIN = 'https://ea199869-accounting.dexrrick-goh.workers.dev';
export const MAS_TRANSPORT_MODES = ['direct', 'browser-context', 'user-agent-only', 'referrer-only', 'deployed-preview'];

const DEFAULT_REQUESTS = new URL('../tests/fixtures/mas-reviewed/controlled-capture-requests.json', import.meta.url);
const SAFE_RESPONSE_HEADERS = ['content-type', 'content-encoding', 'etag', 'last-modified', 'location', 'cache-control', 'date', 'server'];
const SAFE_REQUEST_HEADERS = ['accept', 'user-agent', 'referer', 'x-official-source-response-mode'];
const MAX_BODY_FINGERPRINT_BYTES = 1_500_000;
const MAX_CHILD_STDOUT_BYTES = 6_000_000;
const BROWSER_CONTEXT_HEADERS = Object.freeze({
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  accept: 'application/pdf, text/html, application/xhtml+xml, text/plain;q=0.9, */*;q=0.1',
  referer: 'https://www.mas.gov.sg/'
});
const USER_AGENT_ONLY_HEADERS = Object.freeze({ 'user-agent': BROWSER_CONTEXT_HEADERS['user-agent'] });
const REFERRER_ONLY_HEADERS = Object.freeze({ referer: BROWSER_CONTEXT_HEADERS.referer });

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hasHeaderControls(value) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function selectedHeaders(headers, names) {
  const selected = {};
  const values = new Headers(headers);
  for (const name of names) {
    const value = values.get(name);
    if (value && value.length <= 2_000 && !hasHeaderControls(value)) selected[name] = value;
  }
  return selected;
}

function validatePreviewOrigin(value) {
  const originOnly = typeof value === 'string' && /^https:\/\/[^/?#]+\/?$/i.test(value);
  if (!originOnly) throw new Error('previewOrigin must be an HTTPS origin without a path, query, or fragment');
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new Error('previewOrigin must be a valid HTTPS origin'); }
  const hostname = parsed.hostname.toLowerCase();
  const allowedHostname = hostname === 'accounting.dexrrick-goh.workers.dev' ||
    hostname.endsWith('-accounting.dexrrick-goh.workers.dev');
  const authority = value.match(/^https:\/\/([^/?#]+)/i)?.[1]?.toLowerCase();
  const allowedAuthority = authority === hostname || authority === `${hostname}:443`;
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port !== '' ||
      parsed.pathname !== '/' || parsed.search || parsed.hash || !allowedHostname || !allowedAuthority) {
    throw new Error('previewOrigin must be an HTTPS default-port origin on the controlled accounting worker hostname');
  }
  return parsed.origin;
}

export async function fingerprintResponseBody(response, limit = MAX_BODY_FINGERPRINT_BYTES, { timeoutMs = 3_000, signal } = {}) {
  if (!response.body) {
    const empty = new Uint8Array();
    return { bodyBytesObserved: 0, bodyLengthComplete: true, bodyHashScope: 'complete-entity', bodySha256: sha256(empty), bodyObservationError: null, bytes: empty };
  }
  const reader = response.clone().body?.getReader();
  if (!reader) return { bodyBytesObserved: null, bodyLengthComplete: false, bodyHashScope: 'unknown', bodySha256: null, bytes: null };
  const chunks = [];
  let observed = 0;
  let complete = true;
  let stopReason = null;
  let stopResolve;
  const stopReading = new Promise(resolve => { stopResolve = resolve; });
  const onAbort = () => {
    stopReason = 'aborted';
    complete = false;
    void reader.cancel().catch(() => undefined);
    stopResolve({ kind: 'STOP' });
  };
  const timeout = setTimeout(() => {
    stopReason = 'timeout';
    complete = false;
    void reader.cancel().catch(() => undefined);
    stopResolve({ kind: 'STOP' });
  }, timeoutMs);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  try {
    while (true) {
      const next = await Promise.race([reader.read(), stopReading]);
      if (next.kind === 'STOP') {
        complete = false;
        break;
      }
      if (next.done) break;
      observed += next.value.byteLength;
      const remaining = Math.max(0, limit - (observed - next.value.byteLength));
      if (remaining) chunks.push(next.value.subarray(0, remaining));
      if (observed > limit) {
        complete = false;
        void reader.cancel().catch(() => undefined);
        break;
      }
    }
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    bodyBytesObserved: observed,
    bodyLengthComplete: complete,
    bodyHashScope: complete ? 'complete-entity' : observed === null ? 'unknown' : 'bounded-prefix',
    bodySha256: sha256(bytes),
    bodyObservationError: stopReason === 'timeout' ? 'body read timed out' : stopReason === 'aborted' ? 'body read was aborted' : null,
    bytes: complete ? bytes : null
  };
}

function requestTrace(url, init, context) {
  return {
    url,
    method: String(init?.method ?? 'GET').toUpperCase(),
    context,
    credentialsPolicy: init?.credentials ?? 'omit',
    headers: selectedHeaders(init?.headers, SAFE_REQUEST_HEADERS)
  };
}

function nullResponseTrace() {
  return {
    status: null,
    statusText: null,
    responseUrl: null,
    contentType: null,
    location: null,
    headers: {},
    bodyBytesObserved: null,
    bodyLengthComplete: null,
    bodySha256: null
  };
}

function responseTrace(response, fingerprint) {
  const headers = selectedHeaders(response.headers, SAFE_RESPONSE_HEADERS);
  return {
    status: response.status,
    statusText: response.statusText || null,
    responseUrl: response.url || null,
    contentType: response.headers.get('content-type'),
    location: response.headers.get('location'),
    headers,
    bodyBytesObserved: fingerprint.bodyBytesObserved,
    bodyLengthComplete: fingerprint.bodyLengthComplete,
    bodySha256: fingerprint.bodySha256,
    bodyHashScope: fingerprint.bodyHashScope ?? (fingerprint.bodyLengthComplete ? 'complete-entity' : fingerprint.bodyBytesObserved === null ? 'unknown' : 'bounded-prefix')
  };
}

async function traceOriginFetch(fetcher, url, init, context, trace, outputDirectory) {
  const request = requestTrace(url, { ...init, redirect: 'manual' }, context);
  try {
    const response = await fetcher(url, { ...init, redirect: 'manual' });
    try {
      const fingerprint = await fingerprintResponseBody(response, MAX_BODY_FINGERPRINT_BYTES, { signal: init.signal });
      const responseRecord = responseTrace(response, fingerprint);
      if (fingerprint.bodyObservationError) responseRecord.bodyObservationError = fingerprint.bodyObservationError;
      const normalizedContentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
      const captureRunnerReadsBody = response.ok &&
        ['application/pdf', 'text/html', 'application/xhtml+xml', 'text/plain'].includes(normalizedContentType) &&
        (!response.url || response.url === url);
      if (!captureRunnerReadsBody && fingerprint.bytes?.byteLength) {
        responseRecord.bodyFile = `${safeDocumentPrefix(trace.recordId)}-${trace.originResponses.length + 1}.observed.body.gz`;
        await writeFile(path.join(path.resolve(outputDirectory), responseRecord.bodyFile), gzipSync(fingerprint.bytes));
      }
      trace.originResponses.push({ request, response: responseRecord });
    } catch (error) {
      trace.originResponses.push({
        request,
        response: responseTrace(response, { bodyBytesObserved: null, bodyLengthComplete: false, bodyHashScope: 'unknown', bodySha256: null }),
        bodyObservationError: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
      });
    }
    return response;
  } catch (error) {
    trace.originResponses.push({
      request,
      response: nullResponseTrace(),
      error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
    });
    throw error;
  }
}

const PREVIEW_CHILD_CODE = String.raw`
import { createHash } from 'node:crypto';
import { fetchOfficialSourceSameOrigin } from ${JSON.stringify(new URL('../src/retrieval/officialSourceTransport.ts', import.meta.url).href)};

const previewOrigin = process.env.MAS_DIAGNOSTIC_PREVIEW_ORIGIN;
const officialUrl = process.env.MAS_DIAGNOSTIC_OFFICIAL_URL;
const MAX_OUTER = 2_200_000;
const MAX_DOCUMENT = 1_500_000;
const BODY_READ_TIMEOUT_MS = 3_000;
const responseNames = ['content-type', 'content-encoding', 'etag', 'last-modified', 'location', 'cache-control', 'date', 'server'];
const requestNames = ['content-type'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hasHeaderControls = value => {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
};
const pickHeaders = (headers, names) => {
  const picked = {};
  const values = new Headers(headers);
  for (const name of names) {
    const value = values.get(name);
    if (value && value.length <= 2_000 && !hasHeaderControls(value)) picked[name] = value;
  }
  return picked;
};
async function bodyBytes(response, limit, timeoutMs = BODY_READ_TIMEOUT_MS) {
  if (!response.body) return { bytes: new Uint8Array(), complete: true, observed: 0, observationError: null };
  const reader = response.clone().body?.getReader();
  if (!reader) return { bytes: new Uint8Array(), complete: false, observed: null, observationError: 'body reader unavailable' };
  const chunks = [];
  let observed = 0;
  let complete = true;
  let observationError = null;
  let stopResolve;
  const stopReading = new Promise(resolve => { stopResolve = resolve; });
  const timeout = setTimeout(() => {
    complete = false;
    observationError = 'body read timed out';
    void reader.cancel().catch(() => undefined);
    stopResolve({ kind: 'STOP' });
  }, timeoutMs);
  try {
    while (true) {
      const next = await Promise.race([reader.read(), stopReading]);
      if (next.kind === 'STOP') break;
      if (next.done) break;
      observed += next.value.byteLength;
      const take = Math.max(0, limit - (observed - next.value.byteLength));
      if (take) chunks.push(next.value.subarray(0, take));
      if (observed > limit) {
        complete = false;
        observationError = 'response body exceeded observation limit';
        void reader.cancel().catch(() => undefined);
        break;
      }
    }
  } finally {
    clearTimeout(timeout);
  }
  const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return { bytes: out, complete, observed, observationError };
}

let outer;
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init = {}) => {
  const endpoint = new URL(typeof input === 'string' ? input : input.url, previewOrigin);
  if (endpoint.origin !== previewOrigin || endpoint.pathname !== '/api/official-source' || init.method !== 'POST') {
    throw new Error('Preview transport attempted a request outside the fixed official-source endpoint');
  }
  const requestPayload = typeof init.body === 'string' && init.body.length <= 8_192
    ? JSON.parse(init.body)
    : null;
  const localFixture = process.env.MAS_DIAGNOSTIC_TEST_OUTER_RESPONSE;
  let response;
  if (localFixture) {
    const fixture = JSON.parse(localFixture);
    response = new Response(fixture.body, { status: fixture.status, headers: fixture.headers });
    Object.defineProperty(response, 'url', { value: endpoint.toString() });
  } else {
    response = await realFetch(endpoint, { ...init, redirect: 'error' });
  }
  let fingerprint;
  let bodyObservationError = null;
  try { fingerprint = await bodyBytes(response, MAX_OUTER); }
  catch (error) {
    fingerprint = { bytes: new Uint8Array(), complete: false, observed: null };
    bodyObservationError = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
  }
  outer = {
    request: {
      url: endpoint.toString(),
      method: 'POST',
      context: 'fixed-deployed-preview-same-origin-proxy',
      redirectPolicy: init.redirect ?? null,
      credentials: init.credentials ?? null,
      headers: pickHeaders(init.headers, requestNames),
      payload: requestPayload && typeof requestPayload.url === 'string'
        ? { url: requestPayload.url, responseMode: requestPayload.responseMode ?? null }
        : null
    },
    response: {
      status: response.status,
      statusText: response.statusText || null,
      responseUrl: response.url || null,
      contentType: response.headers.get('content-type'),
      location: response.headers.get('location'),
      headers: pickHeaders(response.headers, responseNames),
      bodyBytesObserved: fingerprint.observed,
      bodyLengthComplete: fingerprint.complete,
      bodySha256: fingerprint.observed === null ? null : sha(fingerprint.bytes),
      bodyHashScope: fingerprint.complete ? 'complete-entity' : fingerprint.observed === null ? 'unknown' : 'bounded-prefix',
      bodyBase64: fingerprint.complete ? Buffer.from(fingerprint.bytes).toString('base64') : null,
      bodyObservationError: bodyObservationError ?? fingerprint.observationError
    }
  };
  return response;
};

const init = {
  method: 'GET',
  redirect: 'manual',
  headers: {
    accept: 'application/pdf, text/html, application/xhtml+xml, text/plain;q=0.9, */*;q=0.1',
    'x-official-source-response-mode': 'document'
  }
};
const response = await fetchOfficialSourceSameOrigin(officialUrl, init);
const fingerprint = await bodyBytes(response, MAX_DOCUMENT);
const failure = response.__officialSourceTransportFailure ?? null;
const official = {
  request: {
    url: officialUrl,
    method: init.method,
    context: 'official-document-request-through-same-origin-decoder',
    headers: pickHeaders(init.headers, ['accept', 'x-official-source-response-mode'])
  },
  response: failure ? null : {
    status: response.status,
    statusText: response.statusText || null,
    responseUrl: response.url || null,
    contentType: response.headers.get('content-type'),
    location: response.headers.get('location'),
    headers: pickHeaders(response.headers, responseNames),
    bodyBytesObserved: fingerprint.observed,
    bodyLengthComplete: fingerprint.complete,
    bodySha256: fingerprint.observed === null ? null : sha(fingerprint.bytes),
    bodyHashScope: fingerprint.complete ? 'complete-entity' : fingerprint.observed === null ? 'unknown' : 'bounded-prefix',
    bodyBase64: fingerprint.complete ? Buffer.from(fingerprint.bytes).toString('base64') : null,
    bodyObservationError: fingerprint.observationError
  },
  transportFailure: failure
};
process.stdout.write(JSON.stringify({ outer: outer ?? null, official }));
`;

function childEnvironment(url, previewOrigin, testOuterResponseJson) {
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    MAS_DIAGNOSTIC_PREVIEW_ORIGIN: previewOrigin,
    MAS_DIAGNOSTIC_OFFICIAL_URL: url,
    ...(testOuterResponseJson ? { MAS_DIAGNOSTIC_TEST_OUTER_RESPONSE: testOuterResponseJson } : {})
  };
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined));
}

export async function runPreviewDecoder(url, { timeoutMs = 20_000, signal, testOuterResponse, previewOrigin = MAS_PREVIEW_ORIGIN } = {}) {
  const selectedPreviewOrigin = validatePreviewOrigin(previewOrigin);
  let testOuterResponseJson;
  if (testOuterResponse !== undefined) {
    if (!testOuterResponse || !Number.isInteger(testOuterResponse.status) || testOuterResponse.status < 200 || testOuterResponse.status > 599 ||
        typeof testOuterResponse.body !== 'string' || Buffer.byteLength(testOuterResponse.body) > 2_200_000 ||
        !testOuterResponse.headers || typeof testOuterResponse.headers !== 'object' || Array.isArray(testOuterResponse.headers)) {
      throw new Error('testOuterResponse must be a bounded local HTTP response fixture');
    }
    testOuterResponseJson = JSON.stringify({
      status: testOuterResponse.status,
      headers: selectedHeaders(testOuterResponse.headers, SAFE_RESPONSE_HEADERS),
      body: testOuterResponse.body
    });
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', PREVIEW_CHILD_CODE], {
      cwd: process.cwd(),
      env: childEnvironment(url, selectedPreviewOrigin, testOuterResponseJson),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(value);
    };
    const onAbort = () => {
      child.kill();
      finish(new Error('Deployed preview diagnostic was aborted'));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`Deployed preview diagnostic exceeded ${timeoutMs}ms`));
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_CHILD_STDOUT_BYTES) {
        child.kill();
        finish(new Error('Deployed preview diagnostic output exceeded its bounded limit'));
      } else stdout.push(chunk);
    });
    child.stderr.on('data', chunk => {
      if (stderrBytes < 16_000) {
        const accepted = chunk.subarray(0, 16_000 - stderrBytes);
        stderr.push(accepted);
        stderrBytes += accepted.length;
      }
    });
    child.on('error', error => finish(error));
    child.on('close', code => {
      if (settled) return;
      const output = Buffer.concat(stdout).toString('utf8');
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString('utf8').trim();
        finish(new Error(`Isolated deployed preview diagnostic exited ${code}${detail ? `: ${detail}` : ''}`));
        return;
      }
      try {
        const result = JSON.parse(output);
        const officialBody = result.official?.response?.bodyBase64;
        const outerBody = result.outer?.response?.bodyBase64;
        const upstreamBytes = typeof officialBody === 'string' ? Buffer.from(officialBody, 'base64') : null;
        const outerBytes = typeof outerBody === 'string' ? Buffer.from(outerBody, 'base64') : null;
        const upstreamResponse = result.official.response;
        const upstreamStatus = upstreamResponse?.status;
        const officialResponse = result.official.transportFailure
          ? new Response(null, { status: 502, statusText: 'Official source transport failed' })
          : new Response([204, 205, 304].includes(upstreamStatus) ? null : upstreamBytes, {
              status: upstreamStatus,
              statusText: upstreamResponse.statusText ?? undefined,
              headers: upstreamResponse.headers
            });
        Object.defineProperty(officialResponse, 'url', { value: upstreamResponse?.responseUrl ?? url });
        if (result.official.transportFailure) {
          Object.defineProperty(officialResponse, '__officialSourceTransportFailure', { value: result.official.transportFailure });
        }
        if (upstreamResponse) upstreamResponse.bodyBase64 = undefined;
        if (result.outer?.response?.bodyBase64 !== undefined) result.outer.response.bodyBase64 = undefined;
        finish(null, { response: officialResponse, trace: result, outerBytes, upstreamBytes });
      } catch (error) {
        finish(new Error(`Invalid isolated deployed preview result: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

function validateMode(mode) {
  if (!MAS_TRANSPORT_MODES.includes(mode)) {
    throw new Error(`mode must be one of: ${MAS_TRANSPORT_MODES.join(', ')}`);
  }
}

function safeDocumentPrefix(recordId) {
  return encodeURIComponent(recordId).replace(/%/g, '_');
}

/**
 * Opt-in bounded transport investigation. It uses the two MAS requests from
 * controlled-capture-requests.json and keeps source retrieval behind the
 * existing ControlledWebRetriever checks.
 */
export async function diagnoseMasTransport({
  outputDirectory,
  mode = 'direct',
  documents: suppliedDocuments,
  directFetch = globalThis.fetch?.bind(globalThis),
  previewRequest = runPreviewDecoder,
  previewOrigin
}) {
  validateMode(mode);
  if (previewOrigin !== undefined && mode !== 'deployed-preview') {
    throw new Error('previewOrigin can only be supplied when mode is deployed-preview');
  }
  const selectedPreviewOrigin = validatePreviewOrigin(previewOrigin === undefined ? MAS_PREVIEW_ORIGIN : previewOrigin);
  const requestManifest = suppliedDocuments
    ? { documents: suppliedDocuments }
    : JSON.parse(await readFile(DEFAULT_REQUESTS, 'utf8'));
  if (!Array.isArray(requestManifest.documents) || requestManifest.documents.length < 1 || requestManifest.documents.length > 2) {
    throw new Error('MAS transport diagnostic accepts one or two explicit documents');
  }
  if (mode !== 'deployed-preview' && typeof directFetch !== 'function') {
    throw new Error('No direct fetch implementation is available');
  }

  const traces = new Map(requestManifest.documents.map(({ recordId }) => [recordId, {
    recordId,
    mode,
    originResponses: [],
    proxyExchanges: []
  }]));
  const controlled = new ControlledWebRetriever(undefined, new SourceCache());
  let currentTrace;
  const retriever = {
    async fetchOfficialDocument(url, options) {
      currentTrace = [...traces.values()].find(trace =>
        requestManifest.documents.find(item => item.recordId === trace.recordId)?.request.url === url);
      if (!currentTrace) throw new Error('Transport diagnostic received an unlisted official URL');
      const customFetch = mode === 'deployed-preview'
        ? async (requestedUrl, init = {}) => {
            const request = requestTrace(requestedUrl, init, 'official-document-request-through-same-origin-decoder');
            try {
              const exchange = await previewRequest(requestedUrl, { ...init, previewOrigin: selectedPreviewOrigin });
              const officialResponse = exchange.trace.official.response;
              if (officialResponse && exchange.upstreamBytes?.byteLength && !(officialResponse.status >= 200 && officialResponse.status < 300)) {
                officialResponse.bodyFile = `${safeDocumentPrefix(currentTrace.recordId)}-${currentTrace.proxyExchanges.length + 1}.upstream.body.gz`;
                await writeFile(path.join(path.resolve(outputDirectory), officialResponse.bodyFile), gzipSync(exchange.upstreamBytes));
              }
              currentTrace.proxyExchanges.push({
                officialRequest: request,
                outer: exchange.trace.outer,
                decodedOfficialResponse: exchange.trace.official,
                internalRedirectChain: { visibility: 'UNKNOWN', hops: null },
                outerBodyFile: exchange.outerBytes && exchange.trace.outer?.response?.bodyLengthComplete
                  ? `${safeDocumentPrefix(currentTrace.recordId)}-${currentTrace.proxyExchanges.length + 1}.outer.body.gz`
                  : null
              });
              const exchangeRecord = currentTrace.proxyExchanges.at(-1);
              if (exchangeRecord.outerBodyFile) {
                const target = path.join(path.resolve(outputDirectory), exchangeRecord.outerBodyFile);
                await writeFile(target, gzipSync(exchange.outerBytes));
              }
              return exchange.response;
            } catch (error) {
              currentTrace.proxyExchanges.push({
                officialRequest: request,
                outer: null,
                decodedOfficialResponse: null,
                internalRedirectChain: { visibility: 'UNKNOWN', hops: null },
                error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
              });
              throw error;
            }
          }
        : (requestedUrl, init = {}) => {
            const headers = new Headers(init.headers);
            const contextHeaders = mode === 'browser-context' ? BROWSER_CONTEXT_HEADERS
              : mode === 'user-agent-only' ? USER_AGENT_ONLY_HEADERS
                : mode === 'referrer-only' ? REFERRER_ONLY_HEADERS : {};
            for (const [name, value] of Object.entries(contextHeaders)) headers.set(name, value);
            const requestContext = {
              direct: 'node-direct',
              'browser-context': 'browser-like-ua-accept-referrer-no-session',
              'user-agent-only': 'browser-like-user-agent-only-no-session',
              'referrer-only': 'browser-like-referrer-only-no-session'
            }[mode];
            return traceOriginFetch(directFetch, requestedUrl, { ...init, headers, credentials: 'omit' },
              requestContext, currentTrace, outputDirectory);
          };
      return await controlled.fetchOfficialDocument(url, {
        ...options,
        customFetch,
        maxRedirects: 5
      });
    }
  };

  const capture = await captureOfficialDocuments({
    documents: requestManifest.documents,
    outputDirectory,
    retriever
  });
  const captureById = new Map(capture.documents.map(document => [document.recordId, document]));
  const diagnostic = {
    schemaVersion: 1,
    mode,
    status: capture.status,
    previewOrigin: mode === 'deployed-preview' ? selectedPreviewOrigin : null,
    documents: [...traces.values()].map(trace => {
      const captured = captureById.get(trace.recordId);
      const exchanges = trace.proxyExchanges;
      const observedRedirectResponses = mode === 'deployed-preview'
        ? exchanges.filter(exchange => exchange.decodedOfficialResponse?.response?.status >= 300 && exchange.decodedOfficialResponse.response.status < 400).length
        : trace.originResponses.filter(hop => hop.response.status >= 300 && hop.response.status < 400).length;
      const responses = mode === 'deployed-preview'
        ? exchanges.map(exchange => exchange.decodedOfficialResponse?.response).filter(Boolean)
        : trace.originResponses.map(hop => hop.response);
      const lastResponse = responses.at(-1);
      const responseUrlChangedWithoutRedirect = (mode === 'deployed-preview' ? exchanges : trace.originResponses).some(item => {
        const requestedUrl = mode === 'deployed-preview' ? item.officialRequest?.url : item.request?.url;
        const responseUrl = mode === 'deployed-preview' ? item.decodedOfficialResponse?.response?.responseUrl : item.response?.responseUrl;
        const status = mode === 'deployed-preview' ? item.decodedOfficialResponse?.response?.status : item.response?.status;
        return Boolean(requestedUrl && responseUrl && requestedUrl !== responseUrl && !(status >= 300 && status < 400));
      });
      const traceCompleteness = mode === 'deployed-preview'
        ? { visibility: 'UNKNOWN', internalRedirectHops: null }
        : { visibility: 'manual-response-trace', internalRedirectHops: null };
      return {
        recordId: trace.recordId,
        requestedUrl: requestManifest.documents.find(item => item.recordId === trace.recordId)?.request.url ?? null,
        requestContext: mode === 'deployed-preview'
          ? 'deployed-preview-same-origin-proxy'
          : (trace.originResponses[0]?.request.context ?? (mode === 'direct' ? 'node-direct' : null)),
        originResponses: trace.originResponses,
        proxyExchanges: trace.proxyExchanges,
        redirectsObserved: observedRedirectResponses,
        redirectTrace: {
          ...traceCompleteness,
          responseUrlChangedWithoutRedirect,
          finalResponseUrl: lastResponse?.responseUrl ?? null,
          note: mode === 'deployed-preview'
            ? 'The preview reports an upstream response envelope; hidden internal hops remain unknown.'
            : 'Manual redirect responses are recorded; a changed response.url without a 3xx is reported separately.'
        },
        retrieval: captured ? {
          status: captured.fetch?.status ?? null,
          httpStatus: captured.fetch?.httpStatus ?? null,
          sourceUrl: captured.fetch?.sourceUrl ?? null,
          finalUrl: captured.fetch?.finalUrl ?? null,
          contentType: captured.fetch?.contentType ?? null,
          error: captured.fetch?.error ?? captured.fetchError?.message ?? null
        } : null,
        capture: captured ? {
          bodyFile: captured.bodyFile,
          bodyBytes: captured.bodyBytes,
          bodySha256: captured.integrity?.computedSha256 ?? null,
          extractionStatus: captured.extraction?.extractionStatus ?? captured.extraction?.status ?? null
        } : null
      };
    })
  };
  await writeFile(path.join(path.resolve(outputDirectory), 'transport-diagnostic.json'), `${JSON.stringify(diagnostic, null, 2)}\n`, 'utf8');
  return { capture, diagnostic };
}

function parseArguments(args) {
  let outputDirectory;
  let mode = 'direct';
  let modeProvided = false;
  let previewOrigin;
  let previewOriginProvided = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--output' && !outputDirectory && args[index + 1]) outputDirectory = args[++index];
    else if (arg === '--mode' && !modeProvided && args[index + 1]) {
      mode = args[++index];
      modeProvided = true;
    }
    else if (arg === '--preview-origin' && !previewOriginProvided && args[index + 1]) {
      previewOrigin = args[++index];
      previewOriginProvided = true;
    }
    else throw new Error(`Invalid arguments near '${arg}'`);
  }
  if (!outputDirectory) throw new Error('Usage: node --import tsx scripts/diagnose_mas_transport.mjs --output <new-directory> [--mode direct|browser-context|user-agent-only|referrer-only|deployed-preview] [--preview-origin <controlled-worker-origin>]');
  validateMode(mode);
  if (previewOriginProvided && mode !== 'deployed-preview') {
    throw new Error('--preview-origin can only be used with --mode deployed-preview');
  }
  if (previewOriginProvided) previewOrigin = validatePreviewOrigin(previewOrigin);
  return { outputDirectory, mode, ...(previewOriginProvided ? { previewOrigin } : {}) };
}

export async function main(args = process.argv.slice(2)) {
  try {
    const { outputDirectory, mode, previewOrigin } = parseArguments(args);
    const { diagnostic } = await diagnoseMasTransport({ outputDirectory, mode, previewOrigin });
    const summary = {
      status: diagnostic.status,
      mode,
      documents: diagnostic.documents.map(document => ({
        recordId: document.recordId,
        fetchStatus: document.retrieval?.status ?? null,
        httpStatus: document.retrieval?.httpStatus ?? null,
        finalUrl: document.retrieval?.finalUrl ?? null,
        extractionStatus: document.capture?.extractionStatus ?? null
      }))
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    process.exitCode = diagnostic.status === 'BLOCKED' ? 2 : 0;
    return diagnostic;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return null;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) await main();
