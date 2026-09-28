import { ALLOWED_REGULATORY_HOSTNAMES, defaultExternalSourceValidator } from './externalSourceValidator.js';

export const OFFICIAL_SOURCE_PROXY_PATH = '/api/official-source';
const MAX_REQUEST_BYTES = 8_192;
const MAX_RESPONSE_BYTES = 2_000_000;
const UPSTREAM_TIMEOUT_MS = 8_000;
const SAFE_RESPONSE_HEADERS = ['content-type', 'etag', 'last-modified', 'location', 'cache-control'] as const;

export interface OfficialSourceProxyLimits {
  requestBytes?: number;
  responseBytes?: number;
  timeoutMs?: number;
  requestTimeoutMs?: number;
}

export type OfficialSourceProxyFailure = 'NETWORK_ERROR' | 'TIMEOUT' | 'REDIRECT_REJECTED';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function transportFailure(transportFailure: OfficialSourceProxyFailure): Response {
  return jsonResponse({ transportFailure }, transportFailure === 'TIMEOUT' ? 504 : 502);
}

type BoundedRequestBody =
  | { kind: 'SUCCESS'; text: string }
  | { kind: 'TOO_LARGE' }
  | { kind: 'TIMEOUT' }
  | { kind: 'READ_ERROR' };

async function readBoundedBody(request: Request, limit: number, timeoutMs: number): Promise<BoundedRequestBody> {
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > limit) return { kind: 'TOO_LARGE' };
  if (!request.body) return { kind: 'SUCCESS', text: '' };
  const reader = request.body.getReader();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const readPromise = (async (): Promise<BoundedRequestBody> => {
    try {
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > limit) {
          void reader.cancel().catch(() => undefined);
          return { kind: 'TOO_LARGE' };
        }
        chunks.push(value);
      }
      const combined = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { kind: 'SUCCESS', text: new TextDecoder().decode(combined) };
    } catch {
      return { kind: 'READ_ERROR' };
    }
  })();
  const timeoutPromise = new Promise<BoundedRequestBody>(resolve => {
    timeoutId = setTimeout(() => {
      void reader.cancel().catch(() => undefined);
      resolve({ kind: 'TIMEOUT' });
    }, timeoutMs);
  });
  try {
    return await Promise.race([readPromise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function readBoundedUpstreamBody(response: Response, limit: number): Promise<string | undefined> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function validateOfficialUrl(rawUrl: string): boolean {
  if (rawUrl.length > 4_096) return false;
  const validation = defaultExternalSourceValidator.validateUrlSecurity(rawUrl);
  if (!validation.isValid) return false;
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password &&
      (parsed.port === '' || parsed.port === '443') &&
      ALLOWED_REGULATORY_HOSTNAMES.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Same-origin, fixed-shape, official-host-only fetch endpoint. */
export async function handleOfficialSourceProxyRequest(
  request: Request,
  fetcher: typeof fetch = fetch,
  limits: OfficialSourceProxyLimits = {}
): Promise<Response> {
  const requestLimit = limits.requestBytes ?? MAX_REQUEST_BYTES;
  const responseLimit = limits.responseBytes ?? MAX_RESPONSE_BYTES;
  const timeoutMs = limits.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const requestTimeoutMs = limits.requestTimeoutMs ?? 3_000;
  const requestUrl = new URL(request.url);
  if (requestUrl.pathname !== OFFICIAL_SOURCE_PROXY_PATH) return new Response('Not found', { status: 404 });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).origin !== requestUrl.origin) return new Response('Forbidden', { status: 403 });
    } catch {
      return new Response('Forbidden', { status: 403 });
    }
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return new Response('Unsupported media type', { status: 415 });
  }

  const bodyResult = await readBoundedBody(request, requestLimit, requestTimeoutMs);
  if (bodyResult.kind === 'TIMEOUT') return transportFailure('TIMEOUT');
  if (bodyResult.kind === 'TOO_LARGE') return new Response('Request too large', { status: 413 });
  if (bodyResult.kind === 'READ_ERROR') return new Response('Invalid request', { status: 400 });
  let payload: unknown;
  try { payload = JSON.parse(bodyResult.text); } catch { return new Response('Invalid request', { status: 400 }); }
  const allowedPayloadKeys = new Set(['url', 'ifNoneMatch', 'ifModifiedSince']);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).some(key => !allowedPayloadKeys.has(key)) ||
      !Object.prototype.hasOwnProperty.call(payload, 'url') || typeof (payload as { url?: unknown }).url !== 'string') {
    return new Response('Invalid request', { status: 400 });
  }
  const requestPayload = payload as { url: string; ifNoneMatch?: unknown; ifModifiedSince?: unknown };
  const validateConditionalValue = (value: unknown): value is string =>
    typeof value === 'string' && value.length <= 2_000 && !/[\u0000-\u001f\u007f]/.test(value);
  if ((requestPayload.ifNoneMatch !== undefined && !validateConditionalValue(requestPayload.ifNoneMatch)) ||
      (requestPayload.ifModifiedSince !== undefined && !validateConditionalValue(requestPayload.ifModifiedSince))) {
    return new Response('Invalid request', { status: 400 });
  }
  const officialUrl = requestPayload.url;
  if (!validateOfficialUrl(officialUrl)) return new Response('URL is not an approved official HTTPS source', { status: 400 });

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let resolveTimeout!: (response: Response) => void;
  const timeoutPromise = new Promise<Response>(resolve => { resolveTimeout = resolve; });
  timeoutId = setTimeout(() => {
    controller.abort();
    resolveTimeout(transportFailure('TIMEOUT'));
  }, timeoutMs);
  const upstreamWork = (async (): Promise<Response> => {
    try {
      const upstreamHeaders: Record<string, string> = {
        accept: 'text/html, text/plain, application/xhtml+xml, application/xml;q=0.9, */*;q=0.1'
      };
      if (typeof requestPayload.ifNoneMatch === 'string') upstreamHeaders['if-none-match'] = requestPayload.ifNoneMatch;
      if (typeof requestPayload.ifModifiedSince === 'string') upstreamHeaders['if-modified-since'] = requestPayload.ifModifiedSince;
      const upstream = await fetcher(officialUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: upstreamHeaders
      });
      if (upstream.status >= 300 && upstream.status < 400 && upstream.status !== 304) {
        const location = upstream.headers.get('location');
        if (!location) return transportFailure('REDIRECT_REJECTED');
        let targetUrl: string;
        try { targetUrl = new URL(location, officialUrl).toString(); }
        catch { return transportFailure('REDIRECT_REJECTED'); }
        const redirectValidation = defaultExternalSourceValidator.validateRedirect(officialUrl, targetUrl);
        if (!redirectValidation.isValid || !validateOfficialUrl(targetUrl)) return transportFailure('REDIRECT_REJECTED');
        return jsonResponse({
          officialUrl,
          upstreamStatus: upstream.status,
          upstreamStatusText: upstream.statusText.replace(/[\r\n\u0000-\u001f]/g, ' ').slice(0, 200),
          headers: { location: targetUrl },
          body: ''
        });
      }

      const finalUrl = upstream.url || officialUrl;
      if (finalUrl !== officialUrl) {
        const finalUrlValidation = defaultExternalSourceValidator.validateRedirect(officialUrl, finalUrl);
        if (!finalUrlValidation.isValid || !validateOfficialUrl(finalUrl)) return transportFailure('REDIRECT_REJECTED');
      }
      const responseBody = await readBoundedUpstreamBody(upstream, responseLimit);
      if (responseBody === undefined) return transportFailure('NETWORK_ERROR');
      const headers: Record<string, string> = {};
      for (const name of SAFE_RESPONSE_HEADERS) {
        const value = upstream.headers.get(name);
        if (value && value.length <= 2_000) headers[name] = value;
      }
      return jsonResponse({
        officialUrl: finalUrl,
        upstreamStatus: upstream.status,
        upstreamStatusText: upstream.statusText.replace(/[\r\n\u0000-\u001f]/g, ' ').slice(0, 200),
        headers,
        body: responseBody
      });
    } catch {
      return transportFailure(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR');
    }
  })();
  try {
    return await Promise.race([upstreamWork, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
