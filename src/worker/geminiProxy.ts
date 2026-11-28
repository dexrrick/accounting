/** Strict same-origin Gemini proxy for private, authenticated test-site use. */
export interface GeminiProxyEnvironment {
  GEMINI_API_KEY?: string;
  GEMINI_PROXY_TOKEN?: string;
  GEMINI_RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
}

const GEMINI_PATH = /^\/api\/gemini\/v1beta\/models\/(gemini-[a-z0-9.-]+):(generateContent|streamGenerateContent)$/;
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 45_000;
const MAX_UPSTREAM_TIMEOUT_MS = 90_000;

function reply(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

async function boundedBody(request: Request, signal: AbortSignal): Promise<Uint8Array | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const onAbort = () => { void reader.cancel(); };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch (error) {
    if (!signal.aborted) throw error;
    return null;
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

async function equalToken(provided: string, expected: string): Promise<boolean> {
  if (provided.length < 20 || provided.length > 256 || expected.length < 20 || expected.length > 256) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected))
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

export async function handleGeminiProxyRequest(request: Request, env: GeminiProxyEnvironment): Promise<Response> {
  const url = new URL(request.url);
  const match = GEMINI_PATH.exec(url.pathname);
  if (!match) return reply('Unknown Gemini endpoint.', 404);
  if (request.method !== 'POST') return reply('Method not allowed.', 405);
  if (!env.GEMINI_API_KEY || !env.GEMINI_PROXY_TOKEN || !env.GEMINI_RATE_LIMITER) {
    return reply('Hosted Gemini access is not configured.', 503);
  }

  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return reply('Origin not allowed.', 403);
  if (!await equalToken(request.headers.get('x-gemini-proxy-token') || '', env.GEMINI_PROXY_TOKEN)) {
    return reply('Hosted Gemini access denied.', 401);
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return reply('Expected a JSON request.', 415);
  }
  const reportedLength = Number(request.headers.get('content-length') || 0);
  if (reportedLength > MAX_BODY_BYTES) return reply('Request body too large.', 413);

  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  const { success } = await env.GEMINI_RATE_LIMITER.limit({ key: `gemini:${clientIp}` });
  if (!success) return reply('Gemini rate limit exceeded.', 429);

  const requestedTimeoutMs = Number(request.headers.get('x-gemini-request-timeout-ms'));
  const timeoutMs = Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0
    ? Math.min(Math.floor(requestedTimeoutMs), MAX_UPSTREAM_TIMEOUT_MS)
    : DEFAULT_UPSTREAM_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const onClientAbort = () => controller.abort();
  request.signal.addEventListener('abort', onClientAbort, { once: true });
  const cleanup = () => {
    clearTimeout(timeoutId);
    request.signal.removeEventListener('abort', onClientAbort);
  };

  if (request.signal.aborted) {
    cleanup();
    return reply('Request canceled.', 499);
  }
  let body: Uint8Array | null;
  try {
    body = await boundedBody(request, controller.signal);
  } catch {
    cleanup();
    return reply('Unable to read Gemini request.', 400);
  }
  if (request.signal.aborted) {
    cleanup();
    return reply('Request canceled.', 499);
  }
  if (controller.signal.aborted) {
    cleanup();
    return reply('Gemini request timed out.', 504);
  }
  if (!body) {
    cleanup();
    return reply('Request body too large or empty.', 413);
  }
  const decodedBody = new TextDecoder().decode(body);
  try {
    JSON.parse(decodedBody);
  } catch {
    cleanup();
    return reply('Invalid JSON request.', 400);
  }

  const upstreamPath = `/v1beta/models/${match[1]}:${match[2]}`;
  const upstream = new URL(`https://generativelanguage.googleapis.com${upstreamPath}`);
  if (match[2] === 'streamGenerateContent') upstream.searchParams.set('alt', 'sse');

  try {
    const result = await fetch(upstream, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY
      },
      body: decodedBody,
      signal: controller.signal
    });
    if (!result.ok) {
      cleanup();
      return reply(`Gemini API returned HTTP ${result.status}.`, result.status);
    }
    if (!result.body) {
      cleanup();
      return reply('Gemini API returned an empty response.', 502);
    }
    const reader = result.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(streamController) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            cleanup();
            streamController.close();
          } else {
            streamController.enqueue(value);
          }
        } catch (error) {
          cleanup();
          streamController.error(error);
        }
      },
      async cancel(reason) {
        try { await reader.cancel(reason); }
        finally { cleanup(); }
      }
    });
    return new Response(body, {
      status: result.status,
      headers: {
        'content-type': result.headers.get('content-type') || (match[2] === 'streamGenerateContent' ? 'text/event-stream' : 'application/json'),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      }
    });
  } catch {
    const wasCanceled = request.signal.aborted;
    cleanup();
    return wasCanceled
      ? reply('Request canceled.', 499)
      : reply(controller.signal.aborted ? 'Gemini request timed out.' : 'Unable to reach Gemini API.', controller.signal.aborted ? 504 : 502);
  }
}
