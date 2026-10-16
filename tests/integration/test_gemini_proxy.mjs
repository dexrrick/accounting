import assert from 'node:assert/strict';
import { handleGeminiProxyRequest } from '../../src/worker/geminiProxy.ts';

const ENDPOINT = 'https://app.example.test/api/gemini/v1beta/models/gemini-3.5-flash-lite:generateContent';
const SECRET = 'test-only-cloudflare-gemini-secret';
const TOKEN = 'test-only-private-proxy-access-token';
const originalFetch = globalThis.fetch;
let upstreamCalls = 0;
let forwardedKey = '';

const makeEnv = (extra = {}) => ({
  GEMINI_API_KEY: SECRET,
  GEMINI_PROXY_TOKEN: TOKEN,
  GEMINI_RATE_LIMITER: { limit: async () => ({ success: true }) },
  ...extra
});
const makeRequest = (headers = {}, body = { contents: [{ parts: [{ text: 'ping' }] }] }) =>
  new Request(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });

globalThis.fetch = async (input, init) => {
  upstreamCalls += 1;
  assert.match(String(input), /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\//);
  forwardedKey = new Headers(init.headers).get('x-goog-api-key');
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};
try {
  const noToken = await handleGeminiProxyRequest(makeRequest(), makeEnv());
  assert.equal(noToken.status, 401);
  assert.equal(upstreamCalls, 0);

  const wrongOrigin = await handleGeminiProxyRequest(
    makeRequest({ 'x-gemini-proxy-token': TOKEN, origin: 'https://evil.example' }), makeEnv()
  );
  assert.equal(wrongOrigin.status, 403);
  assert.equal(upstreamCalls, 0);

  const unconfigured = await handleGeminiProxyRequest(
    makeRequest({ 'x-gemini-proxy-token': TOKEN }), makeEnv({ GEMINI_RATE_LIMITER: undefined })
  );
  assert.equal(unconfigured.status, 503);
  assert.equal(upstreamCalls, 0);

  const limited = await handleGeminiProxyRequest(
    makeRequest({ 'x-gemini-proxy-token': TOKEN }), makeEnv({ GEMINI_RATE_LIMITER: { limit: async () => ({ success: false }) } })
  );
  assert.equal(limited.status, 429);
  assert.equal(upstreamCalls, 0);

  const allowed = await handleGeminiProxyRequest(makeRequest({ 'x-gemini-proxy-token': TOKEN }), makeEnv());
  assert.equal(allowed.status, 200);
  assert.equal(forwardedKey, SECRET);
  assert.equal(upstreamCalls, 1);
  assert.equal(allowed.headers.get('cache-control'), 'no-store');

  const badPath = await handleGeminiProxyRequest(new Request('https://app.example.test/api/gemini/v1beta/models/other:generateContent', {method:'POST'}), makeEnv());
  assert.equal(badPath.status, 404);

  console.log('Gemini proxy access controls passed.');
} finally {
  globalThis.fetch = originalFetch;
}
