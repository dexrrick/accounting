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

assert.match(capturedPrompt, /EXPLAIN_RULE for a general rule/i);
assert.match(capturedPrompt, /EXPLAIN_INTERACTION only for an expressly requested relationship/i);
assert.match(capturedPrompt, /multiple issues alone are not interaction/i);
assert.match(capturedPrompt, /DETERMINE_TREATMENT for applying a rule to a described case.*?party is not named/i);
assert.match(capturedPrompt, /CHECK_ELIGIBILITY for whether a claimant qualifies, distinct from explaining general eligibility rules/i);
assert.match(capturedPrompt, /CALCULATE for a requested numeric result, including an implied amount payable or contribution due, but not an illustrative amount/i);
assert.match(capturedPrompt, /"what tax applies" question.*?taxability\/type/i);
assert.match(capturedPrompt, /An amount mentioned alone does not make the request a calculation/i);
assert.match(capturedPrompt, /PREPARE_JOURNAL for requested entries/i);
assert.match(capturedPrompt, /COMPARE for requested alternatives/i);
assert.match(capturedPrompt, /FILING_REQUIREMENT for filing/i);
assert.match(capturedPrompt, /Each concept has exactly \{"concept":"\.\.\.","role":"PRIMARY\|RELATED\|CONTEXT_ONLY"\}/);
assert.match(capturedPrompt, /\{"concept":"expense recognition","role":"PRIMARY"\}/);
assert.match(capturedPrompt, /exactly these top-level keys: schemaVersion, jurisdiction, authorityCandidates, contextualAuthorities, domain, population, primarySubject, concepts, requestedOperation, requiresUserSpecificFacts, factsExplicitlyProvided, confidence, issues/i);
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
  assert.equal(result.failureReason, expectedReason);
  assert.equal(JSON.stringify(result).includes('RAW_PROVIDER_SENTINEL'), false);
  assert.equal(JSON.stringify(result).includes('RAW_SCHEMA_SENTINEL'), false);
}
const lowConfidence = await interpretFailure(JSON.stringify({ ...mixedPayload, confidence: 0.2 }));
assert.equal(lowConfidence.failure, 'LOW_CONFIDENCE');
assert.equal(lowConfidence.failureReason, undefined);
const providerError = await interpretFailure(new Error('provider raw body SECRET_PROVIDER_ERROR_SENTINEL'));
assert.equal(providerError.failure, 'PROVIDER_ERROR');
assert.equal(providerError.failureReason, undefined);
assert.equal(JSON.stringify(providerError).includes('SECRET_PROVIDER_ERROR_SENTINEL'), false);
assert.equal(JSON.stringify(await interpretMock(mixedQuestion, mixedPayload)).includes('failureReason'), false,
  'Successful interpretations do not carry a failure diagnostic.');

console.log(`Semantic operation contract regressions passed; promptChars=${capturedPrompt.length}.`);
