import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import {
  interpretSemanticQuestion,
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';
import { planAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';

const provider = 'test-semantic-operation-provider-key';
const operationFixture = JSON.parse(await readFile(new URL('../evaluation/singapore/semantic-operation-followup.json', import.meta.url), 'utf8'));
const correctedFixture = JSON.parse(await readFile(new URL('../evaluation/singapore/multi-authority-workstreams-corrected.json', import.meta.url), 'utf8'));

function issueFromContract(contract, { subject, operation } = {}) {
  return {
    subject: subject || contract.subject,
    population: contract.population[0],
    domain: contract.domain[0],
    governingAuthorities: contract.governingAuthorities,
    contextualAuthorities: contract.contextualAuthoritiesAnyOf[0],
    operation: operation || contract.operation[0],
    mappedTopicIds: [],
    evidenceRequirement: 'AUTHORITATIVE_SOURCE',
    confidence: 0.96
  };
}

function interpretationFor(issues, top = {}) {
  return {
    jurisdiction: ['Singapore'],
    authorityCandidates: ['UNKNOWN'],
    contextualAuthorities: [],
    domain: 'UNKNOWN',
    population: 'UNKNOWN',
    primarySubject: 'requested material outcomes',
    concepts: [],
    requestedOperation: 'OTHER',
    requiresUserSpecificFacts: false,
    calculationRequested: false,
    factsExplicitlyProvided: [],
    confidence: 0.96,
    issues,
    ...top
  };
}

async function interpretMock(question, value, onPrompt = () => {}) {
  return interpretSemanticQuestion(question, provider, async (prompt, systemInstruction, _provider, options) => {
    onPrompt({ prompt, systemInstruction, options });
    return JSON.stringify(value);
  });
}

async function interpretFailure(response) {
  return interpretSemanticQuestion('Diagnostic-only probe.', provider, async () => {
    if (response instanceof Error) throw response;
    return response;
  });
}

const mixedJournalTaxIssue = correctedFixture.cases.find(testCase => testCase.id === 'D-original');
assert.ok(mixedJournalTaxIssue);
const mixedQuestion = mixedJournalTaxIssue.question;
const mixedIssueContracts = correctedFixture.issueContracts.D;
const mixedOperations = [
  issueFromContract(mixedIssueContracts[0], { subject: 'journal entry for company expense under SFRS(I)', operation: 'PREPARE_JOURNAL' }),
  issueFromContract(mixedIssueContracts[1], { subject: 'company income-tax deductibility of the expense', operation: 'CHECK_ELIGIBILITY' })
];
const mixedTop = {
  jurisdiction: ['Singapore'],
  authorityCandidates: ['UNKNOWN'],
  contextualAuthorities: [],
  domain: 'UNKNOWN',
  population: 'UNKNOWN',
  primarySubject: 'company expense accounting and tax treatment',
  concepts: [],
  requestedOperation: 'OTHER',
  requiresUserSpecificFacts: true,
  calculationRequested: false,
  factsExplicitlyProvided: ['expense transaction'],
  confidence: 0.96
};
const mixedPayload = interpretationFor(mixedOperations, mixedTop);
assert.ok(validateSemanticQuestionInterpretation(mixedPayload),
  'A mixed accounting and tax request uses a consistent non-journal legacy projection while preserving each issue operation.');
const mixedResult = await interpretMock(mixedQuestion, mixedPayload);
assert.equal(mixedResult.mode, 'SEMANTIC_INTERPRETATION');
assert.deepEqual(mixedResult.interpretation.issues.map(issue => issue.operation), ['PREPARE_JOURNAL', 'CHECK_ELIGIBILITY']);
const mixedReconciled = reconcileQuestionUnderstanding(mixedQuestion, classifyQuestion(mixedQuestion), mixedResult);
assert.deepEqual(mixedReconciled.issuePlan.issues.map(issue => issue.operation), ['PREPARE_JOURNAL', 'CHECK_ELIGIBILITY']);
assert.ok(planAuthorityWorkstreams(mixedReconciled.issuePlan).some(stream => stream.domain === 'ACCOUNTING'));
assert.ok(planAuthorityWorkstreams(mixedReconciled.issuePlan).some(stream => stream.domain === 'IRAS_CORPORATE_TAX'));
assert.equal(mixedResult.interpretation.calculationRequested, false,
  'Legacy calculationRequested reflects only the top-level OTHER operation, even when a compound issue requests a calculation.');

const compoundA = correctedFixture.cases.find(testCase => testCase.id === 'A-original');
const compoundAIssues = correctedFixture.issueContracts.A.map((contract, index) => issueFromContract(contract, {
  subject: contract.subject,
  operation: index < 2 ? 'CALCULATE' : 'DETERMINE_TREATMENT'
}));
const compoundAPayload = interpretationFor(compoundAIssues, {
  ...mixedTop,
  primarySubject: 'CPF contributions and personal CPF relief',
  requestedOperation: 'OTHER',
  calculationRequested: false
});
assert.ok(validateSemanticQuestionInterpretation(compoundAPayload));
const compoundAResult = await interpretMock(compoundA.question, compoundAPayload);
const compoundAPlan = reconcileQuestionUnderstanding(compoundA.question, classifyQuestion(compoundA.question), compoundAResult).issuePlan;
assert.deepEqual(compoundAPlan.issues.slice(0, 3).map(issue => issue.operation), ['CALCULATE', 'CALCULATE', 'DETERMINE_TREATMENT']);
assert.ok(compoundAPlan.issues.slice(0, 2).every(issue => issue.evidenceRequirement === 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'));
assert.equal(compoundAPlan.issues[2].evidenceRequirement, 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS');

const controls = [
  ['control-general-recognition', 'EXPLAIN_RULE', false, 'AUTHORITATIVE_SOURCE'],
  ['control-general-comparison', 'COMPARE', false, 'AUTHORITATIVE_SOURCE'],
  ['control-journal-entry', 'PREPARE_JOURNAL', true, 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'],
  ['control-employer-filing', 'FILING_REQUIREMENT', true, 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'],
  ['control-general-interaction', 'EXPLAIN_INTERACTION', false, 'AUTHORITATIVE_SOURCE']
];
let capturedPrompt;
for (const [caseId, operation, requiresFacts, expectedEvidence] of controls) {
  const testCase = operationFixture.cases.find(item => item.id === caseId);
  const contract = operationFixture.issueContracts[testCase.contract][0];
  const testIssue = issueFromContract(contract, { subject: testCase.question, operation });
  const domain = testIssue.domain;
  const authority = testIssue.governingAuthorities[0];
  const top = {
    jurisdiction: ['Singapore'],
    authorityCandidates: [authority],
    contextualAuthorities: testIssue.contextualAuthorities,
    domain,
    population: testIssue.population,
    primarySubject: testIssue.subject,
    concepts: [],
    requestedOperation: operation,
    requiresUserSpecificFacts: requiresFacts,
    calculationRequested: false,
    factsExplicitlyProvided: requiresFacts ? ['explicit transaction facts'] : [],
    confidence: 0.96
  };
  top.calculationRequested = operation === 'CALCULATE';
  const result = await interpretMock(testCase.question, interpretationFor([testIssue], top), detail => { capturedPrompt = detail.prompt; });
  assert.equal(result.mode, 'SEMANTIC_INTERPRETATION', `${caseId} validates`);
  const reconciled = reconcileQuestionUnderstanding(testCase.question, classifyQuestion(testCase.question), result);
  assert.equal(reconciled.issuePlan.issues[0].operation, operation, `${caseId} preserves its issue operation`);
  assert.equal(reconciled.issuePlan.issues[0].evidenceRequirement, expectedEvidence, `${caseId} keeps the matching evidence requirement`);
}

assert.match(capturedPrompt, /Choose each issue's operation by the requested output/i);
assert.match(capturedPrompt, /requested output is a numeric amount to pay, contribute, remit, deduct, withhold, charge, or provide.*?even if inputs are missing and no "amount", "how much", or "calculate" term appears/i);
assert.match(capturedPrompt, /A number merely included as a case fact or illustration is not a calculation/i);
assert.match(capturedPrompt, /DETERMINE_TREATMENT to apply a rule to a stated transaction, receipt, expense, benefit, or person's circumstances/i);
assert.match(capturedPrompt, /liability applicability or type even when phrased "explain" or "what tax applies"/i);
assert.match(capturedPrompt, /CHECK_ELIGIBILITY for qualification or entitlement under a rule, scheme, or requirement/i);
assert.match(capturedPrompt, /a requested taxability or deductible-status outcome for a transaction is DETERMINE_TREATMENT/i);
assert.match(capturedPrompt, /EXPLAIN_RULE for general principles or conditions without applying them to a case/i);
assert.match(capturedPrompt, /FILING_REQUIREMENT for filing, reporting, or notification procedures; a requested withholding amount is CALCULATE/i);
assert.match(capturedPrompt, /multiple issues alone are not interaction/i);
assert.match(capturedPrompt, /PREPARE_JOURNAL for requested entries/i);
assert.match(capturedPrompt, /COMPARE for requested alternatives/i);
assert.match(capturedPrompt, /FILING_REQUIREMENT for filing/i);
assert.match(capturedPrompt, /Each concept has exactly \{"concept":"\.\.\.","role":"PRIMARY\|RELATED\|CONTEXT_ONLY"\}/);
assert.match(capturedPrompt, /\{"concept":"expense recognition","role":"PRIMARY"\}/);
assert.match(capturedPrompt, /exactly these top-level keys: schemaVersion, jurisdiction, authorityCandidates, contextualAuthorities, domain, population, primarySubject, concepts, requestedOperation, factsExplicitlyProvided, confidence, issues/i);
assert.match(capturedPrompt, /Do not emit a requiresUserSpecificFacts field: the application derives case specificity and per-issue evidence from the query/i);
assert.equal(capturedPrompt.includes('"requiresUserSpecificFacts"'), false,
  'the new V2 prompt does not ask the provider to emit derived specificity');
assert.match(capturedPrompt, /Full V2 mixed journal-and-tax example: \{"schemaVersion":2.*?"issues":\[\{"subject":"expense journal"/s);
assert.equal(capturedPrompt.includes('calculationRequested'), false, 'the V2 prompt leaves the calculation flag to the application');
assert.ok(capturedPrompt.length < 9_000, `Operation guidance remains compact (${capturedPrompt.length} characters).`);

const schemaMismatch = { ...mixedPayload, unexpectedSensitiveField: 'RAW_SCHEMA_SENTINEL' };
const reasons = [
  [await interpretFailure('malformed RAW_PROVIDER_SENTINEL'), 'MALFORMED_JSON'],
  [await interpretFailure('x'.repeat(16_001)), 'RESPONSE_TOO_LARGE'],
  [await interpretFailure(JSON.stringify(schemaMismatch)), 'SCHEMA_MISMATCH'],
  [await interpretFailure(JSON.stringify({ ...mixedPayload, requestedOperation: 'CALCULATE', calculationRequested: false })), 'CONTRADICTORY_FIELDS'],
  [await interpretFailure(JSON.stringify({ ...mixedPayload, domain: 'IRAS_INCOME_TAX', authorityCandidates: ['CPF'] })), 'CONTRADICTORY_FIELDS'],
  [await interpretFailure(JSON.stringify({ ...mixedPayload, requestedOperation: 'PREPARE_JOURNAL' })), 'CONTRADICTORY_FIELDS']
];
for (const [result, expectedReason] of reasons) {
  assert.equal(result.failure, 'INVALID_RESPONSE');
  assert.equal(result.assessmentStatus, 'FAILED', 'a received but invalid model response is a semantic failure');
  assert.equal(result.failureReason, expectedReason);
  assert.equal(JSON.stringify(result).includes('RAW_PROVIDER_SENTINEL'), false);
  assert.equal(JSON.stringify(result).includes('RAW_SCHEMA_SENTINEL'), false);
}
const lowConfidence = await interpretFailure(JSON.stringify({ ...mixedPayload, confidence: 0.2 }));
assert.equal(lowConfidence.failure, 'LOW_CONFIDENCE');
assert.equal(lowConfidence.assessmentStatus, 'FAILED');
assert.equal(lowConfidence.failureReason, undefined);
const providerError = await interpretFailure(new Error('provider raw body SECRET_PROVIDER_ERROR_SENTINEL'));
assert.equal(providerError.failure, 'PROVIDER_ERROR');
assert.equal(providerError.assessmentStatus, 'NOT_ASSESSED', 'provider failures do not count as bad semantic interpretation');
assert.equal(providerError.failureReason, undefined);
assert.equal(JSON.stringify(providerError).includes('SECRET_PROVIDER_ERROR_SENTINEL'), false);
const successfulInterpretation = await interpretMock(mixedQuestion, mixedPayload);
assert.equal(successfulInterpretation.assessmentStatus, 'PASSED');
assert.equal(successfulInterpretation.transportAttempts.length, 0, 'injected send functions remain a single call and may omit transport telemetry');
assert.equal(JSON.stringify(successfulInterpretation).includes('failureReason'), false,
  'Successful interpretations do not carry a failure diagnostic.');

let injectedCalls = 0;
let injectedOptions;
const injectedTransientFailure = await interpretSemanticQuestion('Diagnostic-only probe.', provider, async (_prompt, _system, _provider, options) => {
  injectedCalls += 1;
  injectedOptions = options;
  throw new Error('Gemini API request failed with HTTP 503. The provider response was withheld for security.');
});
assert.equal(injectedCalls, 1, 'a caller-supplied transport is never replayed by the semantic layer');
assert.deepEqual(Object.keys(injectedOptions).sort(), ['jsonMode', 'responseJsonSchema', 'temperature', 'timeoutMs'],
  'injected transports retain the archived four-option request contract');
assert.equal(injectedTransientFailure.failure, 'PROVIDER_ERROR');
assert.equal(injectedTransientFailure.assessmentStatus, 'NOT_ASSESSED');
assert.equal(injectedTransientFailure.providerStatus, 503);
assert.deepEqual(injectedTransientFailure.transportAttempts, [], 'custom transport can remain one-shot without synthetic retry diagnostics');

const previousFetch = globalThis.fetch;
try {
  let transportCalls = 0;
  globalThis.fetch = async () => {
    transportCalls += 1;
    return new Response('temporary overload', { status: 503 });
  };
  const exhaustedTransport = await interpretSemanticQuestion('Diagnostic-only probe.', provider);
  assert.equal(transportCalls, 2, 'the default Gemini transport retries one transient response once');
  assert.equal(exhaustedTransport.assessmentStatus, 'NOT_ASSESSED');
  assert.deepEqual(exhaustedTransport.transportAttempts.map(item => [item.status, item.failureCategory, item.retryScheduled]), [
    [503, 'HTTP_STATUS', true], [503, 'HTTP_STATUS', false]
  ]);

  transportCalls = 0;
  globalThis.fetch = async () => {
    transportCalls += 1;
    const text = transportCalls === 1 ? undefined : JSON.stringify(mixedPayload);
    return text === undefined
      ? new Response('temporary overload', { status: 503 })
      : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
  };
  const recoveredTransport = await interpretSemanticQuestion(mixedQuestion, provider);
  assert.equal(transportCalls, 2, 'the managed production transport retries once after HTTP 503');
  assert.equal(recoveredTransport.assessmentStatus, 'PASSED');
  assert.equal(recoveredTransport.mode, 'SEMANTIC_INTERPRETATION');
  assert.deepEqual(recoveredTransport.transportAttempts.map(item => [item.status, item.retryScheduled]), [[503, true], [200, false]],
    'managed semantic results retain both redacted attempt outcomes');

  transportCalls = 0;
  globalThis.fetch = async () => {
    transportCalls += 1;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{ malformed' }] } }] }), { status: 200 });
  };
  const malformedTransportResponse = await interpretSemanticQuestion('Diagnostic-only probe.', provider);
  assert.equal(transportCalls, 1, 'a malformed model response is not retried');
  assert.equal(malformedTransportResponse.failure, 'INVALID_RESPONSE');
  assert.equal(malformedTransportResponse.assessmentStatus, 'FAILED');
  assert.deepEqual(malformedTransportResponse.transportAttempts.map(item => [item.status, item.retryScheduled]), [[200, false]]);
} finally {
  globalThis.fetch = previousFetch;
}

assert.equal((await interpretSemanticQuestion('Question?', undefined, async () => { throw new Error('must not call'); })).assessmentStatus,
  'NOT_ASSESSED', 'questions without a configured provider are unassessed');

console.log(`Semantic operation contract regressions passed; promptChars=${capturedPrompt.length}.`);
