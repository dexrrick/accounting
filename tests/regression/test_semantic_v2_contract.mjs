import assert from 'node:assert/strict';
import {
  interpretSemanticQuestion,
  SEMANTIC_QUESTION_SCHEMA_VERSION,
  SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA,
  SEMANTIC_V2_INTERPRETATION_KEYS,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';
import { executeStructuredLlmCall } from '../../src/services/aiTransport.ts';

const query = 'Can I claim personal tax relief on compulsory CPF contributions?';
const response = {
  schemaVersion: SEMANTIC_QUESTION_SCHEMA_VERSION,
  jurisdiction: ['Singapore'],
  authorityCandidates: ['IRAS'],
  contextualAuthorities: ['CPF'],
  domain: 'IRAS_INCOME_TAX',
  population: 'INDIVIDUAL',
  primarySubject: 'personal tax relief on compulsory CPF contributions',
  concepts: [{ concept: 'CPF relief', role: 'PRIMARY' }],
  requestedOperation: 'CHECK_ELIGIBILITY',
  factsExplicitlyProvided: [],
  confidence: 0.96,
  issues: [{
    subject: 'personal tax relief on compulsory CPF contributions',
    population: 'INDIVIDUAL',
    domain: 'IRAS_INCOME_TAX',
    governingAuthorities: ['IRAS'],
    contextualAuthorities: [],
    operation: 'CHECK_ELIGIBILITY',
    mappedTopicIds: ['iras-individual-cpf-relief'],
    evidenceRequirement: 'AUTHORITATIVE_SOURCE',
    confidence: 0.96
  }]
};

assert.deepEqual(SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA.required, [...SEMANTIC_V2_INTERPRETATION_KEYS]);
assert.equal(SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA.additionalProperties, false);
assert.equal('calculationRequested' in SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA.properties, false);
assert.equal('requiresUserSpecificFacts' in SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA.properties, false);

const normalized = validateSemanticQuestionInterpretation(response, query);
assert.ok(normalized, 'the exact V2 contract is accepted');
assert.equal(normalized.calculationRequested, false, 'calculation is derived from the requested operation');
assert.equal(normalized.requiresUserSpecificFacts, true, 'case specificity is derived from the first-person eligibility request');
assert.equal(normalized.issues?.[0].evidenceRequirement, 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS');
assert.equal(validateSemanticQuestionInterpretation({ ...response, unexpected: true }, query), undefined,
  'the V2 top-level contract rejects additional fields');

const provider = { activeProvider: 'gemini', gemini: { apiKey: '0123456789012345' } };
let semanticOptions;
const interpreted = await interpretSemanticQuestion(query, provider, async (_prompt, _system, _provider, options) => {
  semanticOptions = options;
  return JSON.stringify(response);
});
assert.equal(interpreted.mode, 'SEMANTIC_INTERPRETATION');
assert.deepEqual(semanticOptions.responseJsonSchema, SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA,
  'semantic V2 sends its JSON Schema through the structured transport option');

const originalFetch = globalThis.fetch;
const requestBodies = [];
globalThis.fetch = async (_url, init) => {
  requestBodies.push(JSON.parse(init.body));
  return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(response) }] } }] }) };
};
try {
  await executeStructuredLlmCall('prompt', '', '0123456789012345', { responseJsonSchema: SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA });
  await executeStructuredLlmCall('prompt', '', provider, { responseJsonSchema: SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA });
  await executeStructuredLlmCall('prompt', '', '0123456789012345');
} finally {
  globalThis.fetch = originalFetch;
}

for (const body of requestBodies.slice(0, 2)) {
  assert.deepEqual(body.generationConfig.responseFormat, {
    text: { mimeType: 'APPLICATION_JSON', schema: SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA }
  }, 'Gemini receives the V2 schema using structured JSON output');
  assert.equal('responseMimeType' in body.generationConfig, false);
}
assert.deepEqual(requestBodies[2].generationConfig, { responseMimeType: 'application/json', temperature: 0.1 },
  'JSON calls without a supplied schema keep the original Gemini generation configuration');

console.log('Versioned semantic V2 contract and Gemini schema transport passed.');
