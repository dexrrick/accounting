import assert from 'node:assert/strict';
import {
  SEMANTIC_AUTHORITY_VALUES,
  SEMANTIC_CONCEPT_KEYS,
  SEMANTIC_CONCEPT_ROLE_VALUES,
  SEMANTIC_DOMAIN_VALUES,
  SEMANTIC_EVIDENCE_REQUIREMENT_VALUES,
  SEMANTIC_ISSUE_KEYS,
  SEMANTIC_OPERATION_VALUES,
  SEMANTIC_POPULATION_VALUES,
  SEMANTIC_QUESTION_MIN_CONFIDENCE,
  SEMANTIC_QUESTION_SCHEMA_VERSION,
  SEMANTIC_QUESTION_TIMEOUT_MS,
  SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA,
  SEMANTIC_V2_INTERPRETATION_KEYS,
  SEMANTIC_V2_WIRE_LIMITS,
  interpretSemanticQuestion,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';
import { executeStructuredLlmCall } from '../../src/services/aiTransport.ts';
import { diagnoseSemanticContract } from '../evaluation/singapore/semantic-contract-diagnosis.mjs';

const issue = {
  subject: 'general accounting recognition',
  population: 'UNKNOWN',
  domain: 'ACCOUNTING',
  governingAuthorities: ['ACCOUNTING_STANDARDS'],
  contextualAuthorities: [],
  operation: 'EXPLAIN_RULE',
  mappedTopicIds: [],
  evidenceRequirement: 'AUTHORITATIVE_SOURCE',
  confidence: 0.91
};
const valid = {
  schemaVersion: SEMANTIC_QUESTION_SCHEMA_VERSION,
  jurisdiction: ['Singapore'],
  authorityCandidates: ['ACCOUNTING_STANDARDS'],
  contextualAuthorities: [],
  domain: 'ACCOUNTING',
  population: 'UNKNOWN',
  primarySubject: 'general accounting recognition',
  concepts: [{ concept: 'recognition principles', role: 'PRIMARY' }],
  requestedOperation: 'EXPLAIN_RULE',
  requiresUserSpecificFacts: false,
  factsExplicitlyProvided: [],
  confidence: 0.91,
  issues: [issue]
};
const schema = SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA;
const issueSchema = schema.properties.issues.items;
const conceptSchema = schema.properties.concepts.items;

assert.equal(validateSemanticQuestionInterpretation(valid)?.calculationRequested, false);
assert.equal(diagnoseSemanticContract(valid).rejectionCode, 'NONE', 'diagnostics accept the same shared V2 contract');
assert.deepEqual(schema.required, [...SEMANTIC_V2_INTERPRETATION_KEYS]);
assert.deepEqual(Object.keys(schema.properties), [...SEMANTIC_V2_INTERPRETATION_KEYS]);
assert.equal(schema.type, 'object');
assert.equal(schema.additionalProperties, false);
assert.equal(schema.properties.schemaVersion.type, 'integer');
assert.deepEqual(schema.properties.schemaVersion.enum, [SEMANTIC_QUESTION_SCHEMA_VERSION]);
assert.deepEqual(schema.properties.domain.enum, [...SEMANTIC_DOMAIN_VALUES]);
assert.deepEqual(schema.properties.population.enum, [...SEMANTIC_POPULATION_VALUES]);
assert.deepEqual(schema.properties.authorityCandidates.items.enum, [...SEMANTIC_AUTHORITY_VALUES]);
assert.deepEqual(schema.properties.contextualAuthorities.items.enum, [...SEMANTIC_AUTHORITY_VALUES]);
assert.deepEqual(schema.properties.requestedOperation.enum, [...SEMANTIC_OPERATION_VALUES]);
assert.deepEqual(schema.properties.factsExplicitlyProvided.items, { type: 'string' });
assert.equal(schema.properties.confidence.minimum, SEMANTIC_V2_WIRE_LIMITS.confidenceMinimum);
assert.equal(schema.properties.confidence.maximum, SEMANTIC_V2_WIRE_LIMITS.confidenceMaximum);
assert.equal(schema.properties.issues.minItems, SEMANTIC_V2_WIRE_LIMITS.issueItemsMinimum);
assert.equal(schema.properties.issues.maxItems, SEMANTIC_V2_WIRE_LIMITS.issueItemsMaximum);
assert.equal(issueSchema.additionalProperties, false);
assert.deepEqual(issueSchema.required, [...SEMANTIC_ISSUE_KEYS]);
assert.deepEqual(Object.keys(issueSchema.properties), [...SEMANTIC_ISSUE_KEYS]);
assert.deepEqual(issueSchema.properties.population.enum, [...SEMANTIC_POPULATION_VALUES]);
assert.deepEqual(issueSchema.properties.domain.enum, [...SEMANTIC_DOMAIN_VALUES]);
assert.deepEqual(issueSchema.properties.operation.enum, [...SEMANTIC_OPERATION_VALUES]);
assert.deepEqual(issueSchema.properties.evidenceRequirement.enum, [...SEMANTIC_EVIDENCE_REQUIREMENT_VALUES]);
assert.equal(issueSchema.properties.governingAuthorities.minItems, SEMANTIC_V2_WIRE_LIMITS.issueGoverningAuthorityItems);
assert.equal(issueSchema.properties.governingAuthorities.maxItems, SEMANTIC_V2_WIRE_LIMITS.issueGoverningAuthorityItems);
assert.equal(issueSchema.properties.contextualAuthorities.maxItems, SEMANTIC_V2_WIRE_LIMITS.authorityItems);
assert.equal(issueSchema.properties.mappedTopicIds.maxItems, SEMANTIC_V2_WIRE_LIMITS.mappedTopicIdItems);
assert.equal(issueSchema.properties.confidence.minimum, SEMANTIC_V2_WIRE_LIMITS.confidenceMinimum);
assert.equal(issueSchema.properties.confidence.maximum, SEMANTIC_V2_WIRE_LIMITS.confidenceMaximum);
assert.equal(conceptSchema.additionalProperties, false);
assert.deepEqual(conceptSchema.required, [...SEMANTIC_CONCEPT_KEYS]);
assert.deepEqual(Object.keys(conceptSchema.properties), [...SEMANTIC_CONCEPT_KEYS]);
assert.deepEqual(conceptSchema.properties.role.enum, [...SEMANTIC_CONCEPT_ROLE_VALUES]);
assert.equal(schema.properties.jurisdiction.maxItems, SEMANTIC_V2_WIRE_LIMITS.jurisdictionItems);
assert.equal(schema.properties.authorityCandidates.maxItems, SEMANTIC_V2_WIRE_LIMITS.authorityItems);
assert.equal(schema.properties.concepts.maxItems, SEMANTIC_V2_WIRE_LIMITS.conceptItems);
assert.equal(schema.properties.factsExplicitlyProvided.maxItems, SEMANTIC_V2_WIRE_LIMITS.factItems);
assert.equal(SEMANTIC_QUESTION_MIN_CONFIDENCE, 0.72);
assert.equal(schema.properties.confidence.minimum, 0,
  'the provider schema does not force confidence above the application acceptance threshold');

for (const key of SEMANTIC_V2_INTERPRETATION_KEYS) {
  const missing = structuredClone(valid);
  delete missing[key];
  assert.equal(validateSemanticQuestionInterpretation(missing), undefined, `V2 rejects missing root key ${key}`);
}
for (const key of SEMANTIC_ISSUE_KEYS) {
  const missing = structuredClone(valid);
  delete missing.issues[0][key];
  assert.equal(validateSemanticQuestionInterpretation(missing), undefined, `V2 rejects missing issue key ${key}`);
}
for (const key of SEMANTIC_CONCEPT_KEYS) {
  const missing = structuredClone(valid);
  delete missing.concepts[0][key];
  assert.equal(validateSemanticQuestionInterpretation(missing), undefined, `V2 rejects missing concept key ${key}`);
}
for (const mutate of [
  value => { value.unexpected = true; },
  value => { value.issues[0].unexpected = true; },
  value => { value.concepts[0].unexpected = true; }
]) {
  const extra = structuredClone(valid);
  mutate(extra);
  assert.equal(validateSemanticQuestionInterpretation(extra), undefined, 'V2 rejects extra keys at each object depth');
}
for (const mutate of [
  value => { value.schemaVersion = 3; },
  value => { value.domain = 'NOT_A_DOMAIN'; },
  value => { value.population = 'NOT_A_POPULATION'; },
  value => { value.authorityCandidates = ['NOT_AN_AUTHORITY']; },
  value => { value.requestedOperation = 'NOT_AN_OPERATION'; },
  value => { value.concepts[0].role = 'NOT_A_ROLE'; },
  value => { value.issues[0].domain = 'NOT_A_DOMAIN'; },
  value => { value.issues[0].population = 'NOT_A_POPULATION'; },
  value => { value.issues[0].governingAuthorities = ['NOT_AN_AUTHORITY']; },
  value => { value.issues[0].operation = 'NOT_AN_OPERATION'; },
  value => { value.issues[0].evidenceRequirement = 'NOT_AN_EVIDENCE_REQUIREMENT'; }
]) {
  const invalid = structuredClone(valid);
  mutate(invalid);
  assert.equal(validateSemanticQuestionInterpretation(invalid), undefined, 'V2 rejects invalid schema versions and enum members');
}

const calculated = structuredClone(valid);
calculated.authorityCandidates = ['CPF'];
calculated.domain = 'CPF_PAYROLL';
calculated.population = 'EMPLOYER';
calculated.requestedOperation = 'CALCULATE';
calculated.requiresUserSpecificFacts = true;
calculated.issues[0] = {
  ...issue,
  subject: 'employer CPF contribution amount',
  population: 'EMPLOYER',
  domain: 'CPF_PAYROLL',
  governingAuthorities: ['CPF'],
  operation: 'CALCULATE'
};
assert.equal(validateSemanticQuestionInterpretation(calculated)?.calculationRequested, true,
  'the internal calculation flag is derived from a valid V2 requestedOperation');
const derivedResult = await interpretSemanticQuestion('What CPF amount is due?', 'synthetic-semantic-provider-key',
  async () => JSON.stringify(calculated));
assert.equal(derivedResult.mode, 'SEMANTIC_INTERPRETATION');
assert.equal(derivedResult.interpretation.calculationRequested, true);
assert.equal(Object.hasOwn(derivedResult.interpretation, 'schemaVersion'), false);

const lowConfidence = structuredClone(valid);
lowConfidence.confidence = SEMANTIC_QUESTION_MIN_CONFIDENCE - 0.01;
const lowConfidenceResult = await interpretSemanticQuestion('Explain a general rule.', 'synthetic-semantic-provider-key',
  async () => JSON.stringify(lowConfidence));
assert.equal(lowConfidenceResult.failure, 'LOW_CONFIDENCE', 'application confidence acceptance remains unchanged');
const malformedResult = await interpretSemanticQuestion('Explain a general rule.', 'synthetic-semantic-provider-key',
  async () => '{ malformed');
assert.equal(malformedResult.failureReason, 'MALFORMED_JSON');

const semanticProvider = {
  activeProvider: 'gemini',
  azure: { endpoint: '', apiKey: '', deploymentName: 'gpt-4o', apiVersion: '2024-08-01-preview' },
  gemini: { apiKey: 'synthetic-gemini-provider-key', model: 'gemini-3.5-flash-lite' },
  openai: { apiKey: '', model: 'gpt-4o', baseUrl: '' }
};
for (const provider of ['synthetic-gemini-provider-key', semanticProvider]) {
  let captured;
  const result = await interpretSemanticQuestion('Explain a general accounting recognition rule.', provider,
    async (prompt, systemInstruction, receivedProvider, options) => {
      captured = { prompt, systemInstruction, receivedProvider, options };
      return JSON.stringify(valid);
    });
  assert.equal(result.mode, 'SEMANTIC_INTERPRETATION');
  assert.deepEqual(captured.options.responseJsonSchema, schema,
    'the semantic interpreter provides the schema on both Gemini configuration paths');
  assert.equal(captured.options.jsonMode, true);
  assert.equal(captured.options.timeoutMs, SEMANTIC_QUESTION_TIMEOUT_MS);
  assert.equal(captured.options.temperature, 0);
  assert.ok(captured.prompt.includes(SEMANTIC_V2_INTERPRETATION_KEYS.join(', ')));
  assert.ok(captured.prompt.includes(SEMANTIC_DOMAIN_VALUES.join('|')));
}

const previousFetch = globalThis.fetch;
const requests = [];
const providerText = JSON.stringify(valid);
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const body = JSON.parse(init.body);
  requests.push({ url, body, headers: init.headers });
  const payload = url.includes('generativelanguage.googleapis.com')
    ? { candidates: [{ content: { parts: [{ text: providerText }] } }] }
    : { choices: [{ message: { content: providerText } }] };
  return { ok: true, status: 200, json: async () => payload };
};
try {
  await executeStructuredLlmCall('prompt', 'system', 'synthetic-gemini-provider-key', {
    model: 'gemini-3.5-flash-lite', jsonMode: true, temperature: 0, responseJsonSchema: schema
  });
  await executeStructuredLlmCall('prompt', 'system', semanticProvider, {
    model: 'gemini-3.5-flash-lite', jsonMode: true, temperature: 0, responseJsonSchema: schema
  });
  assert.deepEqual(requests[0].body.generationConfig.responseJsonSchema, schema,
    'Gemini API-key string path includes responseJsonSchema');
  assert.deepEqual(requests[1].body.generationConfig.responseJsonSchema, schema,
    'Gemini ProviderSettings path includes responseJsonSchema');
  assert.equal(requests[0].body.generationConfig.responseMimeType, 'application/json');
  assert.equal(requests[1].body.generationConfig.responseMimeType, 'application/json');

  await executeStructuredLlmCall('unrelated Gemini prompt', 'system', semanticProvider, { jsonMode: true });
  await executeStructuredLlmCall('non-JSON Gemini prompt', 'system', semanticProvider, {
    jsonMode: false, responseJsonSchema: schema
  });
  assert.deepEqual(requests[2].body.generationConfig, {
    responseMimeType: 'application/json', temperature: 0.1
  }, 'unrelated Gemini JSON calls keep their existing generation config without a schema');
  assert.deepEqual(requests[3].body.generationConfig, { temperature: 0.1 },
    'jsonMode false suppresses both MIME mode and the optional schema');

  const openai = {
    activeProvider: 'openai',
    azure: semanticProvider.azure,
    gemini: semanticProvider.gemini,
    openai: { apiKey: 'synthetic-openai-provider-key', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' }
  };
  await executeStructuredLlmCall('prompt', 'system', openai, { jsonMode: true, responseJsonSchema: schema });
  const azure = {
    activeProvider: 'azure',
    azure: { endpoint: 'https://example.openai.azure.com', apiKey: 'synthetic-azure-provider-key', deploymentName: 'test', apiVersion: '2024-08-01-preview' },
    gemini: semanticProvider.gemini,
    openai: semanticProvider.openai
  };
  await executeStructuredLlmCall('prompt', 'system', azure, { jsonMode: true, responseJsonSchema: schema });
  assert.deepEqual(requests[4].body.response_format, { type: 'json_object' });
  assert.equal(Object.hasOwn(requests[4].body, 'responseJsonSchema'), false, 'OpenAI payload stays unchanged');
  assert.deepEqual(requests[5].body.response_format, { type: 'json_object' });
  assert.equal(Object.hasOwn(requests[5].body, 'responseJsonSchema'), false, 'Azure OpenAI payload stays unchanged');
} finally {
  globalThis.fetch = previousFetch;
}

console.log('Semantic provider schema, strict validation, and transport payload regressions passed.');
