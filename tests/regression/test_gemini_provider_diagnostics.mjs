import assert from 'node:assert/strict';
import { executeStructuredLlmCall } from '../../src/services/aiTransport.ts';

const SECRET = 'synthetic-provider-key-do-not-expose';
const PROMPT_SECRET = 'private-user-prompt-content';
const SYSTEM_SECRET = 'private-system-instruction-content';
const GENERIC_ERROR = 'Gemini API request failed with HTTP 400. The provider response was withheld for security.';

const geminiSettings = {
  activeProvider: 'gemini',
  azure: { endpoint: '', apiKey: '', deploymentName: '', apiVersion: '' },
  gemini: { apiKey: SECRET, model: 'gemini-3.5-flash-lite' },
  openai: { apiKey: '', model: '', baseUrl: '' }
};

async function withFetch(fetchImpl, run) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
  }
}

async function flushTransportObservers() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

async function flushMicrotasks() {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

async function withVirtualTime(run) {
  const originalNow = Date.now;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let currentTime = 1_000_000;
  let nextTimerId = 0;
  const timers = new Map();
  Date.now = () => currentTime;
  globalThis.setTimeout = (callback, delay = 0, ...args) => {
    const timerId = ++nextTimerId;
    timers.set(timerId, { timerId, dueAt: currentTime + Math.max(0, Number(delay) || 0), callback, args });
    return timerId;
  };
  globalThis.clearTimeout = timerId => { timers.delete(timerId); };
  const advanceBy = async milliseconds => {
    const target = currentTime + milliseconds;
    while (true) {
      const next = [...timers.values()].filter(timer => timer.dueAt <= target)
        .sort((left, right) => left.dueAt - right.dueAt || left.timerId - right.timerId)[0];
      if (!next) break;
      timers.delete(next.timerId);
      currentTime = next.dueAt;
      next.callback(...next.args);
      await flushMicrotasks();
    }
    currentTime = target;
    await flushMicrotasks();
  };
  try {
    await run({ advanceBy, now: () => currentTime });
  } finally {
    Date.now = originalNow;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
}

async function expectGenericFailure(provider, options = {}) {
  await assert.rejects(
    () => executeStructuredLlmCall(PROMPT_SECRET, SYSTEM_SECRET, provider, options),
    error => {
      assert.equal(error.message, GENERIC_ERROR);
      assert.doesNotMatch(error.message, /responseJsonSchema|private-user-prompt-content|synthetic-provider-key/i);
      return true;
    }
  );
}

await withFetch(async () => new Response(JSON.stringify({
  error: {
    code: 400,
    status: 'INVALID_ARGUMENT',
    message: `Invalid JSON payload received. Unknown name "responseJsonSchema" at 'generation_config': Cannot find field.`,
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.BadRequest',
        fieldViolations: [{
          field: 'generation_config',
          description: `${SECRET} ${PROMPT_SECRET} ${SYSTEM_SECRET} raw provider detail`
        }]
      },
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'RATE_LIMIT_EXCEEDED',
        metadata: { secret: SECRET, reason: 'RATE_LIMIT_EXCEEDED' }
      }
    ],
    rawField: SECRET
  }
}), { status: 400 }), async () => {
  const diagnostics = [];
  await expectGenericFailure(SECRET, { onGeminiErrorDiagnostic: diagnostic => diagnostics.push(diagnostic) });
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0], {
    httpStatus: 400,
    providerCode: 400,
    providerStatus: 'INVALID_ARGUMENT',
    providerReason: 'RATE_LIMIT_EXCEEDED',
    fieldPath: 'generationConfig.responseJsonSchema',
    protocolHints: ['SCHEMA', 'INVALID'],
    safeMessage: 'Gemini rejected the responseJsonSchema field under generationConfig.'
  });
  const serialized = JSON.stringify(diagnostics[0]);
  for (const secret of [SECRET, PROMPT_SECRET, SYSTEM_SECRET, 'raw provider detail']) {
    assert.equal(serialized.includes(secret), false, `diagnostics omit ${secret}`);
  }
});

await withFetch(async () => new Response(JSON.stringify({
  error: {
    code: 400,
    status: 'INVALID_ARGUMENT',
    message: 'responseJsonSchema is not supported for this model.',
    details: [{ fieldViolations: [{ field: 'generation_config.response_json_schema', description: SECRET }] }]
  }
}), { status: 400 }), async () => {
  const diagnostics = [];
  await expectGenericFailure(geminiSettings, { onGeminiErrorDiagnostic: diagnostic => diagnostics.push(diagnostic) });
  assert.equal(diagnostics.length, 1, 'ProviderSettings Gemini calls report the same opt-in metadata');
  assert.deepEqual(diagnostics[0], {
    httpStatus: 400,
    providerCode: 400,
    providerStatus: 'INVALID_ARGUMENT',
    fieldPath: 'generationConfig.responseJsonSchema',
    protocolHints: ['SCHEMA', 'UNSUPPORTED'],
    safeMessage: 'Gemini does not support responseJsonSchema for this model.'
  });
  assert.equal(JSON.stringify(diagnostics[0]).includes(SECRET), false);
});

await withFetch(async () => new Response(JSON.stringify({
  error: {
    code: 400,
    status: 'INVALID_ARGUMENT',
    message: `Unsupported config ${SECRET}; field 'generation_config.response_json_schema.injected_secret' ${PROMPT_SECRET}`,
    details: [{ fieldViolations: [{ field: `generation_config.response_json_schema.${SECRET}`, description: SYSTEM_SECRET }] }],
    secret: SECRET
  }
}), { status: 400 }), async () => {
  const diagnostics = [];
  await expectGenericFailure(SECRET, { onGeminiErrorDiagnostic: diagnostic => diagnostics.push(diagnostic) });
  assert.deepEqual(diagnostics, [{
    httpStatus: 400,
    providerCode: 400,
    providerStatus: 'INVALID_ARGUMENT',
    protocolHints: ['SCHEMA', 'UNSUPPORTED'],
    safeMessage: 'Gemini request failed.'
  }], 'unmatched provider text and path injection are suppressed');
});

await withFetch(async () => new Response('{ malformed provider error', { status: 400 }), async () => {
  const diagnostics = [];
  await expectGenericFailure(SECRET, { onGeminiErrorDiagnostic: diagnostic => diagnostics.push(diagnostic) });
  assert.deepEqual(diagnostics, [{ httpStatus: 400, safeMessage: 'Gemini request failed.' }],
    'malformed error JSON falls back to status-only diagnostics');
});

await withFetch(async () => new Response(`${JSON.stringify({
  error: {
    code: 400,
    status: 'INVALID_ARGUMENT',
    message: `Unknown name "responseJsonSchema" at 'generation_config': Cannot find field.`
  }
})}${' '.repeat(9_000)}`, { status: 400 }), async () => {
  const diagnostics = [];
  await expectGenericFailure(SECRET, { onGeminiErrorDiagnostic: diagnostic => diagnostics.push(diagnostic) });
  assert.deepEqual(diagnostics, [{ httpStatus: 400, safeMessage: 'Gemini request failed.' }],
    'an oversized body with a valid JSON prefix is not parsed as a complete provider error');
});

for (const schemaCase of [
  {
    message: 'The response JSON schema is too complex.',
    fieldPath: 'generationConfig.responseFormat.text.schema',
    protocolHints: ['SCHEMA', 'COMPLEXITY'],
    safeMessage: 'Gemini rejected the response JSON schema because it is too complex.'
  },
  {
    message: 'The response JSON schema has too many states.',
    fieldPath: 'generationConfig.responseFormat.text.schema',
    protocolHints: ['SCHEMA', 'STATE'],
    safeMessage: 'Gemini rejected the response JSON schema because it exceeds the supported state limit.'
  },
  {
    message: 'The response JSON schema exceeds the maximum constraints.',
    fieldPath: 'generationConfig.responseFormat.text.schema',
    schemaKeywords: ['maximum'],
    protocolHints: ['SCHEMA', 'LIMIT_OR_EXCEED'],
    safeMessage: 'Gemini rejected the response JSON schema because it exceeds a supported constraint limit.'
  },
  {
    message: 'The response schema is too large.',
    fieldPath: 'generationConfig.responseFormat.text.schema',
    protocolHints: ['SCHEMA', 'SIZE_OR_LARGE'],
    safeMessage: 'Gemini rejected the response JSON schema because it is too complex.'
  },
  {
    message: 'The JSON schema has many possible combinations.',
    fieldPath: 'generationConfig.responseFormat.text.schema',
    protocolHints: ['SCHEMA', 'COMBINATIONS'],
    safeMessage: 'Gemini rejected the response JSON schema because it is too complex.'
  },
  {
    message: 'The maximum number of states for responseSchema was exceeded.',
    fieldPath: 'generationConfig.responseFormat.text.schema',
    schemaKeywords: ['maximum'],
    protocolHints: ['SCHEMA', 'STATE', 'LIMIT_OR_EXCEED', 'INTEGER_OR_NUMBER'],
    safeMessage: 'Gemini rejected the response JSON schema because it exceeds the supported state limit.'
  },
  {
    message: 'Unsupported keyword additionalProperties.',
    fieldPath: 'generationConfig.responseFormat.text.schema.additionalProperties',
    schemaKeywords: ['additionalProperties'],
    protocolHints: ['UNSUPPORTED'],
    safeMessage: 'Gemini rejected a response JSON schema keyword that it does not support.'
  },
  {
    message: 'Unknown JSON schema keyword: maxItems.',
    fieldPath: 'generationConfig.responseFormat.text.schema.maxItems',
    schemaKeywords: ['maxItems'],
    protocolHints: ['SCHEMA'],
    safeMessage: 'Gemini rejected a response JSON schema keyword that it does not support.'
  },
  {
    message: "Unknown name \"minimum\" at 'generationConfig.responseSchema.properties.customerSecret.minimum': Cannot find field.",
    fieldPath: 'generationConfig.responseFormat.text.schema.minimum',
    schemaKeywords: ['minimum', 'properties'],
    protocolHints: ['SCHEMA', 'PROPERTIES'],
    safeMessage: 'Gemini rejected a response JSON schema keyword that it does not support.'
  },
  {
    message: "Unknown name \"maxItems\" at 'generation_config.response_format.text.schema.properties.issues.items.maxItems': Cannot find field.",
    fieldPath: 'generationConfig.responseFormat.text.schema.maxItems',
    schemaKeywords: ['maxItems', 'properties', 'items'],
    protocolHints: ['SCHEMA', 'PROPERTIES'],
    safeMessage: 'Gemini rejected a response JSON schema keyword that it does not support.'
  },
  {
    message: 'Integer enum values are not supported for the response schema.',
    fieldPath: 'generationConfig.responseFormat.text.schema.enum',
    schemaKeywords: ['enum'],
    protocolHints: ['SCHEMA', 'UNSUPPORTED', 'ENUM', 'INTEGER_OR_NUMBER'],
    safeMessage: 'Gemini requires response JSON schema enum values to be strings.'
  },
  {
    message: 'Enum for type NUMBER is unsupported in a response JSON schema.',
    fieldPath: 'generationConfig.responseFormat.text.schema.enum',
    schemaKeywords: ['enum', 'type'],
    protocolHints: ['SCHEMA', 'UNSUPPORTED', 'ENUM', 'INTEGER_OR_NUMBER'],
    safeMessage: 'Gemini requires response JSON schema enum values to be strings.'
  },
  {
    message: "Invalid value at 'generation_config.response_json_schema.properties.schemaVersion.enum[0]': integer cannot be converted to a string.",
    fieldPath: 'generationConfig.responseFormat.text.schema.enum',
    schemaKeywords: ['enum', 'properties'],
    protocolHints: ['SCHEMA', 'INVALID', 'ENUM', 'STRING', 'INTEGER_OR_NUMBER', 'PROPERTIES'],
    safeMessage: 'Gemini requires response JSON schema enum values to be strings.'
  }
]) {
  await withFetch(async () => new Response(JSON.stringify({
    error: { code: 400, status: 'INVALID_ARGUMENT', message: `${schemaCase.message} ${SECRET}` }
  }), { status: 400 }), async () => {
    const diagnostics = [];
    await expectGenericFailure(SECRET, { onGeminiErrorDiagnostic: diagnostic => diagnostics.push(diagnostic) });
    assert.deepEqual(diagnostics, [{
      httpStatus: 400,
      providerCode: 400,
      providerStatus: 'INVALID_ARGUMENT',
      fieldPath: schemaCase.fieldPath,
      ...(schemaCase.schemaKeywords ? { schemaKeywords: schemaCase.schemaKeywords } : {}),
      ...(schemaCase.protocolHints ? { protocolHints: schemaCase.protocolHints } : {}),
      safeMessage: schemaCase.safeMessage
    }]);
    assert.equal(JSON.stringify(diagnostics[0]).includes(SECRET), false,
      'recognized schema diagnostics never include the provider message suffix');
  });
}

await withFetch(async () => new Response(JSON.stringify({
  error: {
    code: 400,
    status: 'INVALID_ARGUMENT',
    message: 'Request contains an invalid argument.',
    details: [{
      '@type': 'type.googleapis.com/google.rpc.BadRequest',
      fieldViolations: [{
        field: 'generation_config.response_schema.properties.customerSecret',
        description: `The response schema has many possible combinations. ${SECRET} ${PROMPT_SECRET}`
      }]
    }]
  }
}), { status: 400 }), async () => {
  const diagnostics = [];
  await expectGenericFailure(SECRET, { onGeminiErrorDiagnostic: diagnostic => diagnostics.push(diagnostic) });
  assert.deepEqual(diagnostics, [{
    httpStatus: 400,
    providerCode: 400,
    providerStatus: 'INVALID_ARGUMENT',
    fieldPath: 'generationConfig.responseFormat.text.schema',
    schemaKeywords: ['properties'],
    protocolHints: ['SCHEMA', 'COMBINATIONS', 'INVALID'],
    safeMessage: 'Gemini rejected the response JSON schema because it is too complex.'
  }], 'known field-violation descriptions are classified without exposing their text');
  assert.equal(JSON.stringify(diagnostics[0]).includes(SECRET), false);
  assert.equal(JSON.stringify(diagnostics[0]).includes(PROMPT_SECRET), false);
});

await withFetch(async () => new Response(JSON.stringify({
  error: {
    code: 400,
    status: 'INVALID_ARGUMENT',
    message: `Schema compiler context has size 27; properties minItems and required values include ${SECRET} ${PROMPT_SECRET} ${SYSTEM_SECRET}.`
  }
}), { status: 400 }), async () => {
  const diagnostics = [];
  await expectGenericFailure(SECRET, { onGeminiErrorDiagnostic: diagnostic => diagnostics.push(diagnostic) });
  assert.deepEqual(diagnostics, [{
    httpStatus: 400,
    providerCode: 400,
    providerStatus: 'INVALID_ARGUMENT',
    schemaKeywords: ['minItems', 'properties', 'required'],
    protocolHints: ['SCHEMA', 'SIZE_OR_LARGE', 'PROPERTIES', 'REQUIRED'],
    safeMessage: 'Gemini request failed.'
  }], 'unrecognized messages expose only fixed schema tokens and protocol hints');
  for (const secret of [SECRET, PROMPT_SECRET, SYSTEM_SECRET]) {
    assert.equal(JSON.stringify(diagnostics[0]).includes(secret), false);
  }
});

await withFetch(async () => new Response(new ReadableStream({
  start(controller) { controller.error(new Error(SECRET)); }
}), { status: 400 }), async () => {
  const diagnostics = [];
  await expectGenericFailure(SECRET, { onGeminiErrorDiagnostic: diagnostic => diagnostics.push(diagnostic) });
  assert.deepEqual(diagnostics, [{ httpStatus: 400, safeMessage: 'Gemini request failed.' }],
    'body read failures fall back safely');
});

await withFetch(async () => new Response(JSON.stringify({ error: { message: SECRET } }), { status: 400 }), async () => {
  await expectGenericFailure(SECRET, { onGeminiErrorDiagnostic: () => { throw new Error(SECRET); } });
});

await withFetch(async () => new Response(JSON.stringify({ error: { message: SECRET } }), { status: 400 }), async () => {
  const unhandledRejections = [];
  const onUnhandledRejection = reason => unhandledRejections.push(reason);
  process.on('unhandledRejection', onUnhandledRejection);
  try {
    await expectGenericFailure(SECRET, { onGeminiErrorDiagnostic: async () => { throw new Error(SECRET); } });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(unhandledRejections, [], 'async diagnostic callback rejections are consumed');
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
  }
});

await withFetch(async () => new Response(JSON.stringify({ error: { message: SECRET } }), { status: 400 }), async () => {
  let callbackCalled = false;
  const pendingCallback = new Promise(() => {});
  const call = executeStructuredLlmCall(PROMPT_SECRET, SYSTEM_SECRET, SECRET, {
    onGeminiErrorDiagnostic: () => {
      callbackCalled = true;
      return pendingCallback;
    }
  });
  const outcome = await Promise.race([
    call.then(() => 'resolved', error => {
      assert.equal(error.message, GENERIC_ERROR);
      return 'rejected';
    }),
    new Promise(resolve => setTimeout(() => resolve('timed out'), 100))
  ]);
  assert.equal(outcome, 'rejected', 'pending callback promises do not delay the provider error');
  assert.equal(callbackCalled, true);
});

await withFetch(async () => ({
  ok: false,
  status: 400,
  clone() { throw new Error('body should not be read when diagnostics are disabled'); }
}), async () => {
  await expectGenericFailure(SECRET);
});

let exhaustedCalls = 0;
await withFetch(async () => { exhaustedCalls += 1; return new Response('overloaded', { status: 503 }); }, async () => {
  const attempts = [];
  await assert.rejects(() => executeStructuredLlmCall(PROMPT_SECRET, SYSTEM_SECRET, SECRET, {
    retryGeminiTransientFailures: true,
    onTransportAttemptDiagnostic: diagnostic => attempts.push(diagnostic)
  }), /Gemini API request failed with HTTP 503\./);
  await flushTransportObservers();
  assert.equal(attempts.length, 2, 'opted-in Gemini calls use at most two total attempts');
  assert.deepEqual(attempts.map(item => [item.attempt, item.status, item.failureCategory, item.retryScheduled]), [
    [1, 503, 'HTTP_STATUS', true], [2, 503, 'HTTP_STATUS', false]
  ]);
  assert.ok(attempts.every(item => Number.isFinite(item.elapsedMs) && item.elapsedMs >= 0));
  assert.equal(exhaustedCalls, 2);
});

await withFetch((() => {
  let calls = 0;
  return async () => {
    calls += 1;
    return calls === 1
      ? new Response('temporary overload', { status: 503 })
      : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'recovered' }] } }] }), { status: 200 });
  };
})(), async () => {
  const attempts = [];
  const result = await executeStructuredLlmCall(PROMPT_SECRET, SYSTEM_SECRET, SECRET, {
    retryGeminiTransientFailures: true,
    onTransportAttemptDiagnostic: diagnostic => attempts.push(diagnostic)
  });
  assert.equal(result, 'recovered');
  await flushTransportObservers();
  assert.deepEqual(attempts.map(item => [item.attempt, item.status, item.retryScheduled]), [[1, 503, true], [2, 200, false]]);
});

await withFetch((() => {
  let calls = 0;
  return async (_input, init = {}) => {
    calls += 1;
    if (calls === 1) return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'recovered after timeout' }] } }] }), { status: 200 });
  };
})(), async () => {
  const attempts = [];
  const startedAt = Date.now();
  const result = await executeStructuredLlmCall(PROMPT_SECRET, SYSTEM_SECRET, SECRET, {
    retryGeminiTransientFailures: true,
    timeoutMs: 25,
    onTransportAttemptDiagnostic: diagnostic => attempts.push(diagnostic)
  });
  assert.equal(result, 'recovered after timeout');
  await flushTransportObservers();
  assert.deepEqual(attempts.map(item => [item.attempt, item.failureCategory, item.retryScheduled]), [
    [1, 'TIMEOUT', true], [2, undefined, false]
  ]);
  assert.ok(Date.now() - startedAt < 45_000, 'the total retry path remains inside the 45-second wall-time budget');
});

await withVirtualTime(async clock => {
  let resolveFetch;
  let fetchSignal;
  await withFetch((_input, init = {}) => {
    fetchSignal = init.signal;
    return new Promise(resolve => { resolveFetch = resolve; });
  }, async () => {
    const attempts = [];
    const pending = executeStructuredLlmCall(PROMPT_SECRET, SYSTEM_SECRET, SECRET, {
      retryGeminiTransientFailures: true,
      geminiRetryBudget: 'EXTENDED',
      timeoutMs: 20_000,
      onTransportAttemptDiagnostic: diagnostic => attempts.push(diagnostic)
    });
    await flushMicrotasks();
    await clock.advanceBy(9_250);
    assert.equal(fetchSignal.aborted, false, 'a valid response may take longer than the former eight-second timeout');
    resolveFetch(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'slow but valid' }] } }] }), { status: 200 }));
    assert.equal(await pending, 'slow but valid');
    await clock.advanceBy(0);
    assert.deepEqual(attempts.map(item => [item.attempt, item.elapsedMs, item.retryScheduled]), [[1, 9_250, false]]);
  });
});

const originalRandom = Math.random;
Math.random = () => 0;
try {
  await withVirtualTime(async clock => {
    let timeoutCalls = 0;
    await withFetch(async () => {
      timeoutCalls += 1;
      return new Promise(() => {});
    }, async () => {
      const attempts = [];
      const startedAt = clock.now();
      const pending = executeStructuredLlmCall(PROMPT_SECRET, SYSTEM_SECRET, SECRET, {
        retryGeminiTransientFailures: true,
        geminiRetryBudget: 'EXTENDED',
        timeoutMs: 45_000,
        onTransportAttemptDiagnostic: diagnostic => attempts.push(diagnostic)
      }).then(value => ({ value }), error => ({ error }));
      await flushMicrotasks();
      await clock.advanceBy(20_500);
      assert.equal(timeoutCalls, 2, 'the timeout retry begins after the existing 500ms minimum jitter delay');
      await clock.advanceBy(20_000);
      const outcome = await pending;
      assert.match(outcome.error?.message || '', /timed out/i);
      await clock.advanceBy(0);
      assert.equal(timeoutCalls, 2, 'a two-attempt request remains capped at two physical calls');
      assert.deepEqual(attempts.map(item => [item.attempt, item.elapsedMs, item.failureCategory, item.retryScheduled]), [
        [1, 20_000, 'TIMEOUT', true], [2, 20_000, 'TIMEOUT', false]
      ]);
      assert.ok(clock.now() - startedAt <= 45_000,
        'both 20-second attempts plus the existing backoff remain inside the 45-second total budget');
    });
  });
} finally {
  Math.random = originalRandom;
}

await withFetch(async () => new Response('invalid configuration', { status: 400 }), async () => {
  const attempts = [];
  await expectGenericFailure(SECRET, {
    retryGeminiTransientFailures: true,
    onTransportAttemptDiagnostic: diagnostic => attempts.push(diagnostic)
  });
  await flushTransportObservers();
  assert.equal(attempts.length, 1, 'permanent 4xx configuration errors are not retried');
  assert.equal(attempts[0].retryScheduled, false);
});

let noOptInCalls = 0;
await withFetch(async () => { noOptInCalls += 1; return new Response('overloaded', { status: 503 }); }, async () => {
  const attempts = [];
  await assert.rejects(() => executeStructuredLlmCall(PROMPT_SECRET, SYSTEM_SECRET, SECRET, {
    onTransportAttemptDiagnostic: diagnostic => attempts.push(diagnostic)
  }), /Gemini API request failed with HTTP 503\./);
  assert.equal(noOptInCalls, 1, 'Gemini callers keep the original single-attempt default');
  assert.equal(attempts.length, 0, 'transport diagnostics and retries remain opt-in');
});

let networkCalls = 0;
await withFetch(async () => { networkCalls += 1; throw new TypeError('network unavailable'); }, async () => {
  const attempts = [];
  await assert.rejects(() => executeStructuredLlmCall(PROMPT_SECRET, SYSTEM_SECRET, SECRET, {
    retryGeminiTransientFailures: true,
    onTransportAttemptDiagnostic: diagnostic => attempts.push(diagnostic)
  }), /network unavailable/);
  await flushTransportObservers();
  assert.equal(networkCalls, 1, 'network failures outside the approved status and timeout set are not retried');
  assert.equal(attempts[0].failureCategory, 'NETWORK_ERROR');
  assert.equal(attempts[0].retryScheduled, false);
});

let openAiCalls = 0;
await withFetch(async () => { openAiCalls += 1; return new Response('overloaded', { status: 503 }); }, async () => {
  const openai = {
    activeProvider: 'openai',
    azure: { endpoint: '', apiKey: '', deploymentName: '', apiVersion: '' },
    gemini: { apiKey: SECRET, model: 'gemini-3.5-flash-lite' },
    openai: { apiKey: 'synthetic-openai-key', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' }
  };
  const attempts = [];
  await assert.rejects(() => executeStructuredLlmCall(PROMPT_SECRET, SYSTEM_SECRET, openai, {
    retryGeminiTransientFailures: true,
    onTransportAttemptDiagnostic: diagnostic => attempts.push(diagnostic)
  }), /OpenAI request failed with HTTP 503\./);
  assert.equal(openAiCalls, 1, 'Gemini retry settings do not change other-provider transport calls');
  assert.equal(attempts.length, 0, 'the Gemini retry opt-in does not alter other providers');
});

await withFetch(async (_input, init = {}) => new Promise((_resolve, reject) => {
  init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
}), async () => {
  const controller = new AbortController();
  const attempts = [];
  const pending = executeStructuredLlmCall(PROMPT_SECRET, SYSTEM_SECRET, SECRET, {
    retryGeminiTransientFailures: true,
    signal: controller.signal,
    timeoutMs: 2_000,
    onTransportAttemptDiagnostic: diagnostic => attempts.push(diagnostic)
  });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, /cancelled/i);
  await flushTransportObservers();
  assert.equal(attempts.length, 1, 'external cancellation does not start a second call');
  assert.equal(attempts[0].failureCategory, 'CANCELLED');
  assert.equal(attempts[0].retryScheduled, false);
});

let cancelledBackoffCalls = 0;
await withFetch(async () => {
  cancelledBackoffCalls += 1;
  return new Response('overloaded', { status: 503 });
}, async () => {
  const controller = new AbortController();
  const attempts = [];
  const pending = executeStructuredLlmCall(PROMPT_SECRET, SYSTEM_SECRET, SECRET, {
    retryGeminiTransientFailures: true,
    signal: controller.signal,
    onTransportAttemptDiagnostic: diagnostic => attempts.push(diagnostic)
  });
  setTimeout(() => controller.abort(), 25);
  await assert.rejects(pending, /cancelled/i);
  await flushTransportObservers();
  assert.equal(cancelledBackoffCalls, 1, 'cancellation during retry backoff prevents the second physical call');
  assert.deepEqual(attempts.map(item => [item.attempt, item.retryScheduled]), [[1, true]]);
});

let neverSettlingCalls = 0;
await withFetch(async () => {
  neverSettlingCalls += 1;
  return new Promise(() => {});
}, async () => {
  const attempts = [];
  const startedAt = Date.now();
  await assert.rejects(() => executeStructuredLlmCall(PROMPT_SECRET, SYSTEM_SECRET, SECRET, {
    retryGeminiTransientFailures: true,
    timeoutMs: 25,
    onTransportAttemptDiagnostic: diagnostic => attempts.push(diagnostic)
  }), /timed out/i);
  await flushTransportObservers();
  assert.equal(neverSettlingCalls, 2, 'a fetch that ignores AbortSignal is bounded to the two-attempt limit');
  assert.deepEqual(attempts.map(item => [item.attempt, item.failureCategory, item.retryScheduled]), [
    [1, 'TIMEOUT', true], [2, 'TIMEOUT', false]
  ]);
  assert.ok(Date.now() - startedAt < 3_000, 'unresponsive fetches remain bounded by per-attempt deadlines plus one backoff');
});

await withFetch(async () => new Response('overloaded', { status: 503 }), async () => {
  const attempts = [];
  await assert.rejects(() => executeStructuredLlmCall(PROMPT_SECRET, SYSTEM_SECRET, SECRET, {
    retryGeminiTransientFailures: true,
    onTransportAttemptDiagnostic: () => { throw new Error(SECRET); }
  }), /Gemini API request failed with HTTP 503\./);
  await executeStructuredLlmCall(PROMPT_SECRET, SYSTEM_SECRET, SECRET, {
    retryGeminiTransientFailures: true,
    onTransportAttemptDiagnostic: async diagnostic => {
      attempts.push(diagnostic);
      throw new Error(PROMPT_SECRET);
    }
  }).catch(() => undefined);
  await flushTransportObservers();
  assert.ok(attempts.length > 0, 'asynchronous observer failures do not suppress diagnostics or alter transport behavior');
  assert.equal(JSON.stringify(attempts).includes(SECRET), false, 'transport diagnostics never expose API keys');
  assert.equal(JSON.stringify(attempts).includes(PROMPT_SECRET), false, 'transport diagnostics never expose prompts');
});

console.log('Gemini provider diagnostics are opt-in, bounded, and redact untrusted provider content.');
