import assert from 'node:assert/strict';
import {
  MAX_STRUCTURED_LLM_INPUT_CHARS,
  executeStructuredLlmCall,
  toSafeProviderError
} from './src/services/aiTransport.ts';

async function runProviderBoundarySafetyTests() {
  const secret = 'sk-should-never-appear-in-user-visible-errors';
  const safeError = toSafeProviderError('OpenAI', 429);
  assert.match(safeError.message, /OpenAI request failed with HTTP 429/);
  assert.doesNotMatch(safeError.message, /secret|response body/i);

  await assert.rejects(
    () => executeStructuredLlmCall('x'.repeat(MAX_STRUCTURED_LLM_INPUT_CHARS), 'system', secret),
    /character safety limit/
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(`provider echoed ${secret}`, { status: 401 });
  try {
    await assert.rejects(
      () => executeStructuredLlmCall('hello', 'system', secret),
      error => {
        assert.match(error.message, /Gemini API request failed with HTTP 401/);
        assert.doesNotMatch(error.message, new RegExp(secret));
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('PASS | Provider boundary safety: input limit and response-body redaction');
}

runProviderBoundarySafetyTests().catch(error => {
  console.error('PROVIDER BOUNDARY SAFETY FAILED');
  console.error(error);
  process.exit(1);
});
