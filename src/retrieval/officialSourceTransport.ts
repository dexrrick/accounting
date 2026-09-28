import { ALLOWED_REGULATORY_HOSTNAMES, defaultExternalSourceValidator } from './externalSourceValidator';

const OFFICIAL_SOURCE_ENDPOINT = '/api/official-source';
const MAX_BROWSER_ENVELOPE_BYTES = 2_200_000;

export type OfficialSourceTransportFailure = 'NETWORK_ERROR' | 'TIMEOUT' | 'REDIRECT_REJECTED';

export interface OfficialSourceResponse extends Response {
  /** Internal transport marker consumed by ControlledWebRetriever. */
  __officialSourceTransportFailure?: OfficialSourceTransportFailure;
}

interface OfficialSourceEnvelope {
  officialUrl?: unknown;
  upstreamStatus?: unknown;
  upstreamStatusText?: unknown;
  headers?: unknown;
  body?: unknown;
  transportFailure?: unknown;
}

function failureResponse(url: string, status: OfficialSourceTransportFailure): OfficialSourceResponse {
  const response = new Response(null, { status: 502, statusText: 'Official source transport failed' }) as OfficialSourceResponse;
  Object.defineProperty(response, 'url', { value: url, configurable: false });
  response.__officialSourceTransportFailure = status;
  return response;
}

function isApprovedEnvelopeUrl(requestedUrl: string, officialUrl: string): boolean {
  try {
    const parsed = new URL(officialUrl);
    return ALLOWED_REGULATORY_HOSTNAMES.has(parsed.hostname.toLowerCase()) &&
      defaultExternalSourceValidator.validateRedirect(requestedUrl, officialUrl).isValid;
  } catch {
    return false;
  }
}

/** Browser-only same-origin transport. Node and explicitly injected transports remain direct. */
export async function fetchOfficialSourceSameOrigin(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const outerSignal = init.signal;
  const forwardAbort = () => controller.abort();
  outerSignal?.addEventListener('abort', forwardAbort, { once: true });
  if (outerSignal?.aborted) controller.abort();

  const requestHeaders = new Headers(init.headers);
  const conditionalFields: Record<string, string> = {};
  for (const [headerName, payloadName] of [
    ['if-none-match', 'ifNoneMatch'],
    ['if-modified-since', 'ifModifiedSince']
  ] as const) {
    const value = requestHeaders.get(headerName);
    if (value && value.length <= 2_000 && !/[\u0000-\u001f\u007f]/.test(value)) conditionalFields[payloadName] = value;
  }

  try {
    const response = await fetch(OFFICIAL_SOURCE_ENDPOINT, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, ...conditionalFields }),
      signal: controller.signal
    });

    let raw: string;
    try {
      const reader = response.body?.getReader();
      if (!reader) raw = '';
      else {
        const chunks: Uint8Array[] = [];
        let size = 0;
        const decoder = new TextDecoder();
        let result = '';
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > MAX_BROWSER_ENVELOPE_BYTES) {
            await reader.cancel();
            throw new Error('response_too_large');
          }
          chunks.push(next.value);
        }
        for (const chunk of chunks) result += decoder.decode(chunk, { stream: true });
        raw = result + decoder.decode();
      }
    } catch {
      return failureResponse(url, outerSignal?.aborted ? 'TIMEOUT' : 'NETWORK_ERROR');
    }

    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { return failureResponse(url, outerSignal?.aborted ? 'TIMEOUT' : 'NETWORK_ERROR'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return failureResponse(url, 'NETWORK_ERROR');
    }
    const envelope = parsed as OfficialSourceEnvelope;
    if (envelope.transportFailure === 'TIMEOUT' || envelope.transportFailure === 'NETWORK_ERROR' || envelope.transportFailure === 'REDIRECT_REJECTED') {
      return failureResponse(url, envelope.transportFailure);
    }
    if (!response.ok || typeof envelope.officialUrl !== 'string' ||
        typeof envelope.upstreamStatus !== 'number' || !Number.isInteger(envelope.upstreamStatus) ||
        envelope.upstreamStatus < 200 || envelope.upstreamStatus > 599 ||
        typeof envelope.upstreamStatusText !== 'string' || typeof envelope.body !== 'string' ||
        !envelope.headers || typeof envelope.headers !== 'object' || Array.isArray(envelope.headers) ||
        !isApprovedEnvelopeUrl(url, envelope.officialUrl)) {
      return failureResponse(url, outerSignal?.aborted ? 'TIMEOUT' : 'NETWORK_ERROR');
    }

    const headers = new Headers();
    for (const name of ['content-type', 'etag', 'last-modified', 'location', 'cache-control']) {
      const value = (envelope.headers as Record<string, unknown>)[name];
      if (typeof value === 'string' && value.length <= 2_000) headers.set(name, value);
    }
    const statusText = envelope.upstreamStatusText.replace(/[\r\n\u0000-\u001f]/g, ' ').slice(0, 200);
    const hasNullBody = envelope.upstreamStatus === 204 || envelope.upstreamStatus === 205 || envelope.upstreamStatus === 304;
    const officialResponse = new Response(hasNullBody ? null : envelope.body, {
      status: envelope.upstreamStatus,
      statusText,
      headers
    }) as OfficialSourceResponse;
    Object.defineProperty(officialResponse, 'url', { value: envelope.officialUrl, configurable: false });
    return officialResponse;
  } catch (error) {
    if (outerSignal?.aborted) throw error;
    return failureResponse(url, 'NETWORK_ERROR');
  } finally {
    outerSignal?.removeEventListener('abort', forwardAbort);
  }
}

/** Browser routes only official regulatory hosts through same-origin transport. */
export function getDefaultOfficialSourceFetch(): ((url: string, init?: RequestInit) => Promise<Response>) | undefined {
  if (typeof window !== 'undefined') {
    return (url, init) => {
      try {
        const hostname = new URL(url).hostname.toLowerCase();
        return ALLOWED_REGULATORY_HOSTNAMES.has(hostname)
          ? fetchOfficialSourceSameOrigin(url, init)
          : fetch(url, init);
      } catch {
        return fetch(url, init);
      }
    };
  }
  return globalThis.fetch ? globalThis.fetch.bind(globalThis) : undefined;
}
