/**
 * Decoupled AI Transport Layer
 *
 * Provides a provider-neutral, low-level HTTP transport for executing structured LLM calls
 * (Gemini, Azure OpenAI, OpenAI) with explicit JSON mode, timeouts, and error handling.
 *
 * Eliminates circular dependencies between geminiService and transactionUnderstandingService.
 */

import type { ProviderSettings } from '../types/provider';

export const MAX_STRUCTURED_LLM_INPUT_CHARS = 100_000;
const MAX_GEMINI_ERROR_BODY_BYTES = 8_192;

const GEMINI_ERROR_STATUSES = new Set<string>([
  'ABORTED',
  'CANCELLED',
  'DATA_LOSS',
  'DEADLINE_EXCEEDED',
  'FAILED_PRECONDITION',
  'INTERNAL',
  'INVALID_ARGUMENT',
  'NOT_FOUND',
  'OUT_OF_RANGE',
  'PERMISSION_DENIED',
  'RESOURCE_EXHAUSTED',
  'UNAUTHENTICATED',
  'UNAVAILABLE',
  'UNIMPLEMENTED',
  'UNKNOWN'
] as const);

const GEMINI_ERROR_REASONS = new Set<string>([
  'API_KEY_INVALID',
  'API_KEY_SERVICE_BLOCKED',
  'BILLING_DISABLED',
  'MODEL_NOT_FOUND',
  'QUOTA_EXCEEDED',
  'RATE_LIMIT_EXCEEDED',
  'SERVICE_DISABLED'
] as const);

const GEMINI_CURRENT_SCHEMA_FIELD_PATH = 'generationConfig.responseFormat.text.schema';
const GEMINI_DIAGNOSTIC_FIELD_PATHS = new Map([
  ['generation_config', 'generationConfig'],
  ['generation_config.response_json_schema', 'generationConfig.responseJsonSchema'],
  ['generation_config.response_mime_type', 'generationConfig.responseMimeType'],
  ['generation_config.temperature', 'generationConfig.temperature']
]);
const GEMINI_SCHEMA_FIELD_ALIASES = ['response_json_schema', 'responseJsonSchema', 'response_schema', 'responseSchema'] as const;
const GEMINI_RESPONSE_SCHEMA_REFERENCE = String.raw`\b(?:schema|json\s+schema|response\s+schema|response_json_schema|responseJsonSchema|response_schema|responseSchema)\b`;

const GEMINI_JSON_SCHEMA_KEYWORDS = [
  'additionalProperties',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'enum',
  'type',
  'properties',
  'required',
  'items'
] as const;
export type GeminiSchemaKeyword = typeof GEMINI_JSON_SCHEMA_KEYWORDS[number];

const GEMINI_PROTOCOL_HINT_PATTERNS = [
  { hint: 'SCHEMA', pattern: /\b(?:schema|json\s+schema|response\s+schema|responseJsonSchema|response_json_schema|responseSchema|response_schema)\b/i },
  { hint: 'SIZE_OR_LARGE', pattern: /\b(?:size|large|larger|oversized)\b/i },
  { hint: 'COMPLEXITY', pattern: /\b(?:complexity|complex)\b/i },
  { hint: 'STATE', pattern: /\bstates?\b/i },
  { hint: 'COMBINATIONS', pattern: /\bcombinations?\b/i },
  { hint: 'UNSUPPORTED', pattern: /\b(?:unsupported|not supported)\b/i },
  { hint: 'INVALID', pattern: /\binvalid\b/i },
  { hint: 'LIMIT_OR_EXCEED', pattern: /\b(?:limit|exceed(?:s|ed|ing)?)\b/i },
  { hint: 'ENUM', pattern: /\benums?\b/i },
  { hint: 'STRING', pattern: /\bstrings?\b/i },
  { hint: 'INTEGER_OR_NUMBER', pattern: /\b(?:integer|number|numeric)\b/i },
  { hint: 'PROPERTIES', pattern: /\bproperties\b/i },
  { hint: 'REQUIRED', pattern: /\brequired\b/i }
] as const;
export type GeminiProtocolHint = typeof GEMINI_PROTOCOL_HINT_PATTERNS[number]['hint'];

for (const schemaAlias of GEMINI_SCHEMA_FIELD_ALIASES) {
  const normalizedAlias = schemaAlias.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  GEMINI_DIAGNOSTIC_FIELD_PATHS.set(`generation_config.${normalizedAlias}`, 'generationConfig.responseJsonSchema');
  for (const keyword of GEMINI_JSON_SCHEMA_KEYWORDS) {
    const snakeCaseKeyword = keyword.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    GEMINI_DIAGNOSTIC_FIELD_PATHS.set(
      `generation_config.${normalizedAlias}.${snakeCaseKeyword}`,
      `generationConfig.responseJsonSchema.${keyword}`
    );
  }
GEMINI_DIAGNOSTIC_FIELD_PATHS.set('generation_config.response_format.text.schema', GEMINI_CURRENT_SCHEMA_FIELD_PATH);
for (const keyword of GEMINI_JSON_SCHEMA_KEYWORDS) {
  const snakeCaseKeyword = keyword.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  GEMINI_DIAGNOSTIC_FIELD_PATHS.set(
    `generation_config.response_format.text.schema.${snakeCaseKeyword}`,
    `${GEMINI_CURRENT_SCHEMA_FIELD_PATH}.${keyword}`
  );
}
}

export type GeminiProviderDiagnostic = Readonly<{
  httpStatus: number;
  providerCode?: number;
  providerStatus?: string;
  providerReason?: string;
  fieldPath?: string;
  schemaKeywords?: readonly GeminiSchemaKeyword[];
  protocolHints?: readonly GeminiProtocolHint[];
  safeMessage: string;
}>;

export type GeminiProviderDiagnosticCallback = (diagnostic: GeminiProviderDiagnostic) => void | Promise<void>;

/** Never expose upstream response bodies: they may echo credentials or submitted content. */
export function toSafeProviderError(provider: string, status: number): Error {
  return new Error(`${provider} request failed with HTTP ${status}. The provider response was withheld for security.`);
}

export interface StructuredLlmOptions {
  jsonMode?: boolean;
  model?: string;
  /** Optional JSON Schema constraint supported by Gemini structured output. Other providers ignore it. */
  responseJsonSchema?: Readonly<Record<string, unknown>>;
  timeoutMs?: number;
  temperature?: number;
  /** Optional, redacted diagnostics for failed Gemini HTTP requests. Callback failures are ignored. */
  onGeminiErrorDiagnostic?: GeminiProviderDiagnosticCallback;
}

/**
 * Normalizes Azure OpenAI endpoint URL.
 */
export function normalizeAzureEndpointUrl(endpoint: string): string {
  let cleaned = (endpoint || '').trim().replace(/\/+$/, '');
  if (!cleaned) return '';

  if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
    if (!cleaned.includes('.')) {
      cleaned = `https://${cleaned}.openai.azure.com`;
    } else {
      cleaned = `https://${cleaned}`;
    }
  }
  return cleaned;
}

/**
 * Executes a structured prompt against the active AI provider and returns the raw response text.
 */
export async function executeStructuredLlmCall(
  prompt: string,
  systemInstruction: string,
  providerOrApiKey?: ProviderSettings | string,
  options: StructuredLlmOptions = {}
): Promise<string> {
  if (prompt.length + systemInstruction.length > MAX_STRUCTURED_LLM_INPUT_CHARS) {
    throw new Error(`AI request exceeds the ${MAX_STRUCTURED_LLM_INPUT_CHARS.toLocaleString()} character safety limit.`);
  }
  const timeoutMs = options.timeoutMs ?? 45000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // 1. Direct Gemini API Key String
    if (typeof providerOrApiKey === 'string' && providerOrApiKey.trim().length > 10) {
      const apiKey = providerOrApiKey.trim();
      const model = options.model || 'gemini-3.5-flash-lite';
      return await callGeminiDirect(apiKey, model, prompt, systemInstruction, controller.signal, options.temperature, options.jsonMode !== false, options.responseJsonSchema, options.onGeminiErrorDiagnostic);
    }

    // 2. Structured ProviderSettings
    if (providerOrApiKey && typeof providerOrApiKey === 'object') {
      const active = providerOrApiKey.activeProvider;

      if (active === 'gemini') {
        const apiKey = providerOrApiKey.gemini?.apiKey?.trim();
        if (!apiKey || apiKey.length < 10) {
          throw new Error('Gemini API key is not configured or too short.');
        }
        const model = options.model || providerOrApiKey.gemini?.model || 'gemini-3.5-flash-lite';
        return await callGeminiDirect(apiKey, model, prompt, systemInstruction, controller.signal, options.temperature, options.jsonMode !== false, options.responseJsonSchema, options.onGeminiErrorDiagnostic);
      }

      if (active === 'azure') {
        const azure = providerOrApiKey.azure;
        if (!azure?.apiKey || !azure?.endpoint) {
          throw new Error('Azure OpenAI endpoint or API key is not configured.');
        }
        const endpoint = normalizeAzureEndpointUrl(azure.endpoint);
        const deployment = azure.deploymentName || 'gpt-4o';
        const apiVersion = azure.apiVersion || '2024-08-01-preview';
        const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': azure.apiKey
          },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: prompt }
            ],
            response_format: options.jsonMode !== false ? { type: 'json_object' } : undefined,
            temperature: options.temperature ?? 0.1
          }),
          signal: controller.signal
        });

        if (!res.ok) {
          throw toSafeProviderError('Azure OpenAI', res.status);
        }
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (!text) throw new Error('Empty response from Azure OpenAI');
        return text;
      }

      if (active === 'openai') {
        const openai = providerOrApiKey.openai;
        if (!openai?.apiKey) {
          throw new Error('OpenAI API key is not configured.');
        }
        const baseUrl = openai.baseUrl?.trim().replace(/\/+$/, '') || 'https://api.openai.com/v1';
        const model = options.model || openai.model || 'gpt-4o';
        const url = `${baseUrl}/chat/completions`;

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openai.apiKey}`
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: prompt }
            ],
            response_format: options.jsonMode !== false ? { type: 'json_object' } : undefined,
            temperature: options.temperature ?? 0.1
          }),
          signal: controller.signal
        });

        if (!res.ok) {
          throw toSafeProviderError('OpenAI', res.status);
        }
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (!text) throw new Error('Empty response from OpenAI');
        return text;
      }
    }

    throw new Error('No active AI provider configured or valid API key provided.');
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callGeminiDirect(
  apiKey: string,
  model: string,
  prompt: string,
  systemInstruction: string,
  signal: AbortSignal,
  temperature: number = 0.1,
  jsonMode: boolean = true,
  responseJsonSchema?: Readonly<Record<string, unknown>>,
  onGeminiDiagnostic?: GeminiProviderDiagnosticCallback
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const requestBody: any = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      ...(jsonMode && responseJsonSchema
        ? { responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: responseJsonSchema } } }
        : jsonMode
          ? { responseMimeType: 'application/json' }
          : {}),
      temperature
    }
  };

  if (systemInstruction) {
    requestBody.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(requestBody),
    signal
  });

  if (!res.ok) {
    if (onGeminiDiagnostic) {
      await emitGeminiDiagnostic(res, onGeminiDiagnostic);
    }
    throw toSafeProviderError('Gemini API', res.status);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Empty response from Gemini API');
  }
  return text;
}

async function emitGeminiDiagnostic(
  response: Response,
  callback: GeminiProviderDiagnosticCallback
): Promise<void> {
  try {
    const bodyText = await readBoundedResponseBody(response);
    const providerError = parseGeminiErrorBody(bodyText);
    const diagnostic = createGeminiDiagnostic(response.status, providerError);
    invokeGeminiDiagnosticCallback(callback, diagnostic);
  } catch {
    // Malformed, unreadable, or oversized response bodies produce status-only diagnostics.
    invokeGeminiDiagnosticCallback(callback, createGeminiDiagnostic(response.status));
  }
}

function invokeGeminiDiagnosticCallback(
  callback: GeminiProviderDiagnosticCallback,
  diagnostic: GeminiProviderDiagnostic
): void {
  try {
    const result = callback(diagnostic);
    if (result && typeof result.then === 'function') {
      void Promise.resolve(result).catch(() => undefined);
    }
  } catch {
    // Sync throws and async rejections are best-effort and never change the provider failure.
  }
}

async function readBoundedResponseBody(response: Response): Promise<string | undefined> {
  if (!response.body) return undefined;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let limitReached = false;

  try {
    while (byteLength < MAX_GEMINI_ERROR_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = MAX_GEMINI_ERROR_BODY_BYTES - byteLength;
      const accepted = value.subarray(0, remaining);
      chunks.push(accepted);
      byteLength += accepted.byteLength;
      if (accepted.byteLength < value.byteLength || byteLength === MAX_GEMINI_ERROR_BODY_BYTES) {
        limitReached = true;
        void reader.cancel().catch(() => undefined);
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (limitReached) return undefined;
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseGeminiErrorBody(bodyText: string | undefined): unknown {
  if (!bodyText || bodyText.length > MAX_GEMINI_ERROR_BODY_BYTES) return undefined;
  try {
    return JSON.parse(bodyText);
  } catch {
    return undefined;
  }
}

function createGeminiDiagnostic(httpStatus: number, providerErrorBody?: unknown): GeminiProviderDiagnostic {
  const errorObject = getRecord(providerErrorBody)?.error;
  const error = getRecord(errorObject);
  const providerCode = error && Number.isInteger(error.code) && (error.code as number) >= 100 && (error.code as number) <= 599
    ? error.code as number
    : undefined;
  const providerStatus = typeof error?.status === 'string' && GEMINI_ERROR_STATUSES.has(error.status)
    ? error.status
    : undefined;
  const providerReason = findGeminiReason(error?.details);
  const message = getGeminiErrorText(error?.message, error?.details);
  const { issue, fieldPath } = classifyGeminiError(message, error?.details);
  const schemaKeywords = findGeminiSchemaKeywords(message, error?.details);
  const protocolHints = findGeminiProtocolHints(message);

  return {
    httpStatus,
    ...(providerCode === undefined ? {} : { providerCode }),
    ...(providerStatus === undefined ? {} : { providerStatus }),
    ...(providerReason === undefined ? {} : { providerReason }),
    ...(fieldPath === undefined ? {} : { fieldPath }),
    ...(schemaKeywords.length === 0 ? {} : { schemaKeywords }),
    ...(protocolHints.length === 0 ? {} : { protocolHints }),
    safeMessage: getGeminiSafeMessage(issue)
  };
}

function findGeminiSchemaKeywords(message: string, details: unknown): GeminiSchemaKeyword[] {
  const fieldPaths: string[] = [];
  if (Array.isArray(details)) {
    for (const detail of details) {
      const violations = getRecord(detail)?.fieldViolations;
      if (!Array.isArray(violations)) continue;
      for (const violation of violations) {
        const field = getRecord(violation)?.field;
        if (typeof field === 'string') fieldPaths.push(field.slice(0, 160));
      }
    }
  }
  const sources = [message, ...fieldPaths];
  return GEMINI_JSON_SCHEMA_KEYWORDS.filter(keyword => {
    const pattern = new RegExp(`\\b${keyword}\\b`, 'i');
    return sources.some(source => pattern.test(source));
  });
}

function findGeminiProtocolHints(message: string): GeminiProtocolHint[] {
  return GEMINI_PROTOCOL_HINT_PATTERNS
    .filter(({ pattern }) => pattern.test(message))
    .map(({ hint }) => hint);
}

function getGeminiErrorText(message: unknown, details: unknown): string {
  const fragments = [typeof message === 'string' ? message.slice(0, 4_096) : ''];
  if (Array.isArray(details)) {
    for (const detail of details) {
      const violations = getRecord(detail)?.fieldViolations;
      if (!Array.isArray(violations)) continue;
      for (const violation of violations) {
        const description = getRecord(violation)?.description;
        if (typeof description === 'string') fragments.push(description.slice(0, 512));
      }
    }
  }
  return fragments.join('\n').slice(0, MAX_GEMINI_ERROR_BODY_BYTES);
}

type GeminiDiagnosticIssue =
  | 'SCHEMA_FIELD_UNSUPPORTED'
  | 'SCHEMA_CONFIG_FIELD_UNSUPPORTED'
  | 'SCHEMA_UNSUPPORTED'
  | 'SCHEMA_TOO_COMPLEX'
  | 'SCHEMA_STATE_LIMIT_EXCEEDED'
  | 'SCHEMA_CONSTRAINT_LIMIT_EXCEEDED'
  | 'SCHEMA_KEYWORD_UNSUPPORTED'
  | 'SCHEMA_ENUM_STRING_VALUES_REQUIRED'
  | 'CONFIG_UNSUPPORTED';

function getGeminiSafeMessage(issue?: GeminiDiagnosticIssue): string {
  switch (issue) {
    case 'SCHEMA_FIELD_UNSUPPORTED':
      return 'Gemini rejected the responseJsonSchema field under generationConfig.';
    case 'SCHEMA_CONFIG_FIELD_UNSUPPORTED':
      return 'Gemini rejected a response JSON schema configuration field.';
    case 'SCHEMA_UNSUPPORTED':
      return 'Gemini does not support responseJsonSchema for this model.';
    case 'SCHEMA_TOO_COMPLEX':
      return 'Gemini rejected the response JSON schema because it is too complex.';
    case 'SCHEMA_STATE_LIMIT_EXCEEDED':
      return 'Gemini rejected the response JSON schema because it exceeds the supported state limit.';
    case 'SCHEMA_CONSTRAINT_LIMIT_EXCEEDED':
      return 'Gemini rejected the response JSON schema because it exceeds a supported constraint limit.';
    case 'SCHEMA_KEYWORD_UNSUPPORTED':
      return 'Gemini rejected a response JSON schema keyword that it does not support.';
    case 'SCHEMA_ENUM_STRING_VALUES_REQUIRED':
      return 'Gemini requires response JSON schema enum values to be strings.';
    case 'CONFIG_UNSUPPORTED':
      return 'Gemini rejected an unsupported generationConfig field.';
    default:
      return 'Gemini request failed.';
  }
}

function classifyGeminiError(
  message: string,
  details: unknown
): { issue?: GeminiDiagnosticIssue; fieldPath?: string } {
  const fieldPaths = collectKnownFieldPaths(message, details);
  const schemaPath = getGeminiSchemaDiagnosticPath(fieldPaths);
  const unknownSchemaField = message.match(/Unknown name ["'](responseJsonSchema|responseSchema|response_json_schema|response_schema)["'] at ["'](?:generation_config|generationConfig)(?:\.(?:response_json_schema|responseJsonSchema|response_schema|responseSchema))?["']\s*:\s*Cannot find field\./i);
  if (unknownSchemaField) {
    const issue = unknownSchemaField[1].toLowerCase() === 'responsejsonschema' || unknownSchemaField[1].toLowerCase() === 'response_json_schema'
      ? 'SCHEMA_FIELD_UNSUPPORTED'
      : 'SCHEMA_CONFIG_FIELD_UNSUPPORTED';
    return { issue, fieldPath: 'generationConfig.responseJsonSchema' };
  }

  const unknownConfigField = message.match(/Unknown name ["'](responseMimeType|temperature)["'] at ["']generation_config["']\s*:\s*Cannot find field\./i);
  if (unknownConfigField) {
    const fieldPath = unknownConfigField[1].toLowerCase() === 'responsemimetype'
      ? 'generationConfig.responseMimeType'
      : 'generationConfig.temperature';
    return { issue: 'CONFIG_UNSUPPORTED', fieldPath };
  }

  if (matchesResponseSchemaPhrase(message, /\b(?:too complex|too large|excessive complexity|complexity limit|many possible combinations|too many possible combinations)\b/i)) {
    return { issue: 'SCHEMA_TOO_COMPLEX', fieldPath: schemaPath };
  }

  if (matchesResponseSchemaPhrase(message, /\b(?:too many states|(?:maximum|max)(?: number of)? states|state(?:s)? limit|states limit|state count limit)\b/i)) {
    return { issue: 'SCHEMA_STATE_LIMIT_EXCEEDED', fieldPath: schemaPath };
  }

  if (matchesResponseSchemaPhrase(message, /\b(?:constraint limit|too many constraints|constraints limit|maximum constraints)\b/i)) {
    return { issue: 'SCHEMA_CONSTRAINT_LIMIT_EXCEEDED', fieldPath: schemaPath };
  }

  if (hasStringOnlyEnumError(message)) {
    return { issue: 'SCHEMA_ENUM_STRING_VALUES_REQUIRED', fieldPath: `${schemaPath}.enum` };
  }

  const unsupportedKeyword = findUnsupportedSchemaKeyword(message);
  if (unsupportedKeyword) {
    return {
      issue: 'SCHEMA_KEYWORD_UNSUPPORTED',
      fieldPath: `${schemaPath}.${unsupportedKeyword}`
    };
  }

  if (/\bresponseJsonSchema\b/i.test(message) && /\b(?:not supported|unsupported)\b/i.test(message)) {
    return { issue: 'SCHEMA_UNSUPPORTED', fieldPath: schemaPath };
  }

  if (fieldPaths.length > 0 && /\b(?:not supported|unsupported)\b/i.test(message)) {
    const fieldPath = fieldPaths[0];
    return {
      issue: fieldPath === 'generationConfig.responseJsonSchema' ? 'SCHEMA_UNSUPPORTED' : 'CONFIG_UNSUPPORTED',
      fieldPath: fieldPath === 'generationConfig.responseJsonSchema' || fieldPath.startsWith(`${GEMINI_CURRENT_SCHEMA_FIELD_PATH}.`)
        ? schemaPath
        : fieldPath
    };
  }

  return { fieldPath: fieldPaths[0] };
}

function matchesResponseSchemaPhrase(message: string, phrase: RegExp): boolean {
  const referenceBefore = new RegExp(`${GEMINI_RESPONSE_SCHEMA_REFERENCE}.{0,120}${phrase.source}`, 'i');
  const referenceAfter = new RegExp(`${phrase.source}.{0,120}${GEMINI_RESPONSE_SCHEMA_REFERENCE}`, 'i');
  return referenceBefore.test(message) || referenceAfter.test(message);
}

function hasStringOnlyEnumError(message: string): boolean {
  return /\benum(?: values?)?\b.{0,80}\b(?:must be|must contain|only supports?|requires?)\b.{0,40}\bstrings?\b/i.test(message)
    || /\b(?:enum values? must be strings|enum only supports string values|enum is only supported for string type)\b/i.test(message)
    || (/\b(?:cannot|can't) be converted to a string\b/i.test(message) && /\benum(?:\[|\b)/i.test(message))
    || /\benums?\b.{0,80}\b(?:integers?|numbers?|numeric|non[- ]?string)\b.{0,80}\b(?:invalid|unsupported|not supported|not allowed|not permitted)\b/i.test(message)
    || /\b(?:integers?|numbers?|numeric|non[- ]?string)\b.{0,80}\benums?\b.{0,80}\b(?:invalid|unsupported|not supported|not allowed|not permitted)\b/i.test(message);
}

function findUnsupportedSchemaKeyword(message: string): string | undefined {
  for (const keyword of GEMINI_JSON_SCHEMA_KEYWORDS) {
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const unknownName = new RegExp(
      `Unknown name ["']${escapedKeyword}["'] at ["'](?:generation_config|generationConfig)\\.(?:response_format\\.text\\.schema|response_json_schema|responseJsonSchema|response_schema|responseSchema)(?:\\.[^"']{1,120})?["']\\s*:\\s*Cannot find field\\.`,
      'i'
    );
    const unsupportedBefore = new RegExp(`\\b(?:unsupported|not supported|not allowed)\\b.{0,60}\\b${escapedKeyword}\\b`, 'i');
    const unsupportedAfter = new RegExp(`\\b${escapedKeyword}\\b.{0,60}\\b(?:is )?(?:unsupported|not supported|not allowed|unknown|unrecognized)\\b`, 'i');
    const unknownSchemaKeyword = new RegExp(
      `\\b(?:unknown|unrecognized)\\b.{0,60}\\b(?:JSON|response)?\\s*schema\\s+keyword\\b.{0,30}\\b${escapedKeyword}\\b`,
      'i'
    );
    const unsupportedSchemaKeyword = new RegExp(
      `\\b(?:JSON|response)?\\s*schema\\s+keyword\\b.{0,30}\\b${escapedKeyword}\\b.{0,60}\\b(?:unsupported|not supported|not allowed|unknown|unrecognized)\\b`,
      'i'
    );
    if (unknownName.test(message) || unsupportedBefore.test(message) || unsupportedAfter.test(message)
        || unknownSchemaKeyword.test(message) || unsupportedSchemaKeyword.test(message)) {
      return keyword;
    }
  }
  return undefined;
}

function collectKnownFieldPaths(message: string, details: unknown): string[] {
  const candidates: string[] = [];
  const addCandidate = (value: unknown) => {
    if (typeof value !== 'string' || value.length > 160) return;
    const normalized = normalizeGeminiFieldPath(value);
    if (normalized) candidates.push(normalized);
  };

  // Only inspect quoted field paths that exactly match the supported allowlist.
  for (const match of message.matchAll(/["']([^"']{1,160})["']/g)) addCandidate(match[1]);
  const detailRecords = Array.isArray(details) ? details : [];
  for (const detail of detailRecords) {
    const record = getRecord(detail);
    const violations = record?.fieldViolations;
    if (!Array.isArray(violations)) continue;
    for (const violation of violations) addCandidate(getRecord(violation)?.field);
  }
  return [...new Set(candidates)];
}

function getGeminiSchemaDiagnosticPath(fieldPaths: readonly string[], keyword?: string): string {
  const currentPathPresent = fieldPaths.some(path =>
    path === GEMINI_CURRENT_SCHEMA_FIELD_PATH || path.startsWith(`${GEMINI_CURRENT_SCHEMA_FIELD_PATH}.`)
  );
  const legacyPathPresent = fieldPaths.some(path =>
    path === 'generationConfig.responseJsonSchema' || path.startsWith('generationConfig.responseJsonSchema.')
  );
  const root = currentPathPresent || !legacyPathPresent
    ? GEMINI_CURRENT_SCHEMA_FIELD_PATH
    : 'generationConfig.responseJsonSchema';
  return keyword ? `${root}.${keyword}` : root;
}

function normalizeGeminiFieldPath(value: string): string | undefined {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/\[(?:\d+)\]/g, '')
    .toLowerCase();
  const exactPath = GEMINI_DIAGNOSTIC_FIELD_PATHS.get(normalized);
  if (exactPath) return exactPath;

  const currentSchemaPrefix = 'generation_config.response_format.text.schema';
  if (normalized === currentSchemaPrefix || normalized.startsWith(`${currentSchemaPrefix}.`)) {
    return GEMINI_CURRENT_SCHEMA_FIELD_PATH;
  }
  return undefined;
}

function findGeminiReason(details: unknown): string | undefined {
  if (!Array.isArray(details)) return undefined;
  for (const detail of details) {
    const record = getRecord(detail);
    const reason = getRecord(record?.metadata)?.reason ?? record?.reason;
    if (typeof reason === 'string' && GEMINI_ERROR_REASONS.has(reason)) return reason;
  }
  return undefined;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
