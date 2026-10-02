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

console.log('Gemini provider diagnostics are opt-in, bounded, and redact untrusted provider content.');
