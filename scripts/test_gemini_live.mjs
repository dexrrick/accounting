/** Manually run live provider and deployed Worker checks. Never print credentials. */
const model = process.env.GEMINI_TEST_MODEL || 'gemini-3.5-flash-lite';
if (!/^gemini-[a-z0-9.-]+$/.test(model)) throw new Error('Invalid Gemini test model.');
const runHosted = process.env.GEMINI_TEST_HOSTED_SITE === 'true';
const token = process.env.GEMINI_PROXY_TOKEN_TEST || '';
const key = process.env.GEMINI_API_KEY_TEST || '';
if (runHosted ? !token : !key) throw new Error(runHosted
  ? 'GEMINI_PROXY_TOKEN_TEST secret is required to test the hosted site.'
  : 'GEMINI_API_KEY_TEST secret is required for direct live testing.');

const endpoint = runHosted
  ? `https://accounting.zxxmore.trade/api/gemini/v1beta/models/${model}:generateContent`
  : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30000);
try {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(runHosted ? { 'x-gemini-proxy-token': token } : { 'x-goog-api-key': key })
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'Return exactly the word OK.' }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 40 }
    }),
    signal: controller.signal
  });
  if (!response.ok) throw new Error(`Gemini ${runHosted ? 'hosted' : 'direct'} smoke test failed with HTTP ${response.status}.`);
  const payload = await response.json();
  const result = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof result !== 'string' || !result.trim()) throw new Error('Gemini returned no text.');
  console.log(`Gemini ${runHosted ? 'hosted Worker' : 'direct provider'} smoke test passed for ${model}.`);
} finally {
  clearTimeout(timeout);
}
