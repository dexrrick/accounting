/**
 * Use the same Gemini request/response contracts for a personal API key or the
 * authenticated Cloudflare Worker transport. Hosted mode never sends Google's key
 * to the browser. The proxy token is a separate, revocable test-site credential.
 */
export async function fetchGemini(
  url: string,
  apiKey: string,
  init: RequestInit
): Promise<Response> {
  if (!apiKey.startsWith('proxy:')) return fetch(url, init);

  const accessToken = apiKey.slice('proxy:'.length);
  if (accessToken.length < 20 || accessToken.length > 256) {
    throw new Error('Hosted Gemini access token is invalid. Check Settings.');
  }

  const target = new URL(url);
  if (target.origin !== 'https://generativelanguage.googleapis.com' ||
      !/^\/v1beta\/models\/gemini-[a-z0-9.-]+:(generateContent|streamGenerateContent)$/.test(target.pathname)) {
    throw new Error('Unsupported Gemini proxy destination.');
  }

  const headers = new Headers(init.headers);
  headers.delete('x-goog-api-key');
  headers.set('x-gemini-proxy-token', accessToken);
  return fetch(`/api/gemini${target.pathname}${target.search}`, {
    ...init,
    credentials: 'same-origin',
    headers
  });
}
