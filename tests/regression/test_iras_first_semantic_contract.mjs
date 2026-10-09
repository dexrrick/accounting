import assert from 'node:assert/strict';
import { irasFirstSemanticCases } from '../fixtures/irasFirstSemanticCases.mjs';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import {
  interpretSemanticQuestion,
  reconcileQuestionUnderstanding
} from '../../src/services/semanticQuestionUnderstanding.ts';

const provider = 'iras-first-semantic-regression-provider-key';

function issueFor(testCase, overrides = {}) {
  return {
    subject: testCase.subject || testCase.question,
    population: testCase.population,
    domain: testCase.domain,
    governingAuthorities: [testCase.authority],
    contextualAuthorities: [],
    operation: testCase.operation,
    mappedTopicIds: [],
    evidenceRequirement: 'AUTHORITATIVE_SOURCE',
    confidence: 0.96,
    ...overrides
  };
}

function payloadFor(testCase, overrides = {}) {
  const issue = issueFor(testCase, overrides.issue);
  return {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: [testCase.authority],
    contextualAuthorities: [],
    domain: testCase.domain,
    population: testCase.population,
    primarySubject: testCase.subject || testCase.question,
    concepts: [{ concept: testCase.subject || testCase.question, role: 'PRIMARY' }],
    requestedOperation: testCase.operation,
    requiresUserSpecificFacts: overrides.facts ?? testCase.facts,
    factsExplicitlyProvided: overrides.providedFacts || [],
    confidence: 0.96,
    issues: [issue]
  };
}

for (const testCase of irasFirstSemanticCases) {
  const payload = payloadFor(testCase);
  const result = await interpretSemanticQuestion(testCase.question, provider, async () => JSON.stringify(payload));
  assert.equal(result.mode, 'SEMANTIC_INTERPRETATION', `${testCase.id}: the consistent structured response remains valid`);
  assert.equal(result.interpretation.requiresUserSpecificFacts, testCase.facts, `${testCase.id}: specificity is derived from the request`);
  const reconciled = reconcileQuestionUnderstanding(testCase.question, classifyQuestion(testCase.question), result);
  const semanticIssue = reconciled.issuePlan.issues.find(issue => issue.unresolvedReason !== 'UNASSIGNED_QUERY_TOPIC');
  if (semanticIssue) assert.equal(semanticIssue.evidenceRequirement, testCase.facts
    ? 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' : 'AUTHORITATIVE_SOURCE',
  `${testCase.id}: evidence follows its own case specificity`);
}

const falseEligibility = irasFirstSemanticCases.find(item => item.id === 'personal-relief-application');
const falseEligibilityResult = await interpretSemanticQuestion(falseEligibility.question, provider,
  async () => JSON.stringify(payloadFor(falseEligibility, {
    facts: false,
    providedFacts: ['SGD 6,000 monthly salary']
  })));
assert.equal(falseEligibilityResult.mode, 'SEMANTIC_INTERPRETATION',
  'a historical false facts flag is compatibility telemetry, not an interpretation rejection');
assert.equal(falseEligibilityResult.interpretation.requiresUserSpecificFacts, true,
  'the personal eligibility application is derived from the query');
const directContradictoryPlan = reconcileQuestionUnderstanding(falseEligibility.question,
  classifyQuestion(falseEligibility.question), {
    mode: 'SEMANTIC_INTERPRETATION',
    interpretation: payloadFor(falseEligibility, { facts: false })
  });
assert.equal(directContradictoryPlan.understanding.mode, 'SEMANTIC_PLUS_RULES',
  'direct reconciliation normalizes the old flag from the query');
assert.equal(directContradictoryPlan.understanding.interpretation.requiresUserSpecificFacts, true);

const qualifiedClaim = irasFirstSemanticCases.find(item => item.id === 'personal-claim-with-qualification-comma');
const punctuatedFalseFlag = await interpretSemanticQuestion(qualifiedClaim.question, provider, async () => JSON.stringify(payloadFor(qualifiedClaim, {
  facts: false,
  providedFacts: ['Singapore permanent resident'],
  issue: { subject: 'CPF relief eligibility' }
})));
assert.equal(punctuatedFalseFlag.mode, 'SEMANTIC_INTERPRETATION',
  'a qualification clause after a comma remains part of the same claimant application even when supplied facts are present');
assert.equal(punctuatedFalseFlag.interpretation.requiresUserSpecificFacts, true);

for (const id of [
  'specific-contributions-interaction',
  'specific-compulsory-contributions-interaction',
  'specific-voluntary-contributions-interaction',
  'specific-annual-contributions-interaction',
  'specific-ordinary-contributions-interaction'
]) {
  const contributionQuery = irasFirstSemanticCases.find(item => item.id === id);
  const contributionFalseFlag = await interpretSemanticQuestion(contributionQuery.question, provider,
    async () => JSON.stringify(payloadFor(contributionQuery, {
      facts: false,
      providedFacts: ['CPF contributions'],
      issue: { subject: 'CPF/SRS relief cap interaction' }
    })));
  assert.equal(contributionFalseFlag.mode, 'SEMANTIC_INTERPRETATION',
    `${id}: a stale flag does not reject a recognized owned contribution phrase`);
  assert.equal(contributionFalseFlag.interpretation.requiresUserSpecificFacts, true,
    `${id}: the owned contributions remain case-specific across common modifiers and plurals`);
}

const interactionAudience = irasFirstSemanticCases.find(item => item.id === 'interaction-audience-is-not-claimant');
const interactionAudienceResult = await interpretSemanticQuestion(interactionAudience.question, provider,
  async () => JSON.stringify(payloadFor(interactionAudience, { issue: { subject: 'CPF/SRS relief cap interaction' } })));
assert.equal(interactionAudienceResult.mode, 'SEMANTIC_INTERPRETATION',
  'a first-person audience request does not turn a general interaction into claimant-specific advice');

const ambiguousOwnedReference = irasFirstSemanticCases.find(item => item.id === 'ambiguous-owned-reference-interaction');
const ambiguousOwnedTrue = await interpretSemanticQuestion(ambiguousOwnedReference.question, provider,
  async () => JSON.stringify(payloadFor(ambiguousOwnedReference, { facts: true })));
const ambiguousOwnedFalse = await interpretSemanticQuestion(ambiguousOwnedReference.question, provider,
  async () => JSON.stringify(payloadFor(ambiguousOwnedReference, { facts: false })));
assert.equal(ambiguousOwnedTrue.mode, 'SEMANTIC_INTERPRETATION',
  'an unresolved possessive phrase preserves a model-produced true flag');
assert.equal(ambiguousOwnedFalse.mode, 'SEMANTIC_INTERPRETATION',
  'an unresolved possessive phrase does not reject a historical false flag');
assert.equal(ambiguousOwnedFalse.interpretation.requiresUserSpecificFacts, true,
  'unknown specificity is conservatively derived as case-specific');
const ambiguousFalsePlan = reconcileQuestionUnderstanding(ambiguousOwnedReference.question,
  classifyQuestion(ambiguousOwnedReference.question), ambiguousOwnedFalse).issuePlan;
assert.equal(ambiguousFalsePlan.issues[0].evidenceRequirement, 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS',
  'unresolved owned references use conservative source-plus-case-facts evidence');

const illustrativeAmount = irasFirstSemanticCases.find(item => item.id === 'illustrative-amount-is-not-application');
const illustrativeAmountResult = await interpretSemanticQuestion(illustrativeAmount.question, provider,
  async () => JSON.stringify(payloadFor(illustrativeAmount, { providedFacts: ['SGD 6,000 monthly salary'] })));
assert.equal(illustrativeAmountResult.mode, 'SEMANTIC_INTERPRETATION',
  'supplied facts do not turn a general rule question into a case application');

for (const operation of ['CALCULATE', 'DETERMINE_TREATMENT', 'PREPARE_JOURNAL']) {
  const base = irasFirstSemanticCases.find(item => item.operation === operation);
  const mixed = {
    ...base,
    question: `${base.question} Also explain the general rules for lease accounting.`,
    operation: 'OTHER',
    facts: false,
    domain: 'UNKNOWN',
    population: 'UNKNOWN',
    authority: 'UNKNOWN',
    subject: 'mixed accounting and tax question'
  };
  const raw = payloadFor(mixed, { facts: false });
  raw.issues = [
    issueFor(base),
    issueFor({
      question: 'general lease accounting rules', domain: 'ACCOUNTING', population: 'COMPANY',
      authority: 'ACCOUNTING_STANDARDS', operation: 'EXPLAIN_RULE'
    })
  ];
  const result = await interpretSemanticQuestion(mixed.question, provider, async () => JSON.stringify(raw));
  assert.equal(result.mode, 'SEMANTIC_INTERPRETATION',
    `top-level OTHER derives specificity from its ${operation} issue despite a stale false root flag`);
  assert.equal(result.interpretation.requiresUserSpecificFacts, true);
}

const mixedCaseAndConceptual = {
  question: 'Can I claim personal tax relief on my CPF contributions? Also, explain the general accounting rules for investment measurement.',
  operation: 'OTHER', facts: true, domain: 'UNKNOWN', population: 'UNKNOWN', authority: 'UNKNOWN',
  subject: 'mixed tax claim and accounting explanation',
  issues: [
    { subject: 'personal CPF tax relief claim', population: 'INDIVIDUAL', domain: 'IRAS_INCOME_TAX', authority: 'IRAS', operation: 'CHECK_ELIGIBILITY' },
    { subject: 'general investment measurement rules', population: 'COMPANY', domain: 'ACCOUNTING', authority: 'ACCOUNTING_STANDARDS', operation: 'EXPLAIN_RULE' }
  ]
};
const mixedPayload = payloadFor(mixedCaseAndConceptual);
mixedPayload.issues = mixedCaseAndConceptual.issues.map(issue => issueFor(issue));
const mixedResult = await interpretSemanticQuestion(mixedCaseAndConceptual.question, provider, async () => JSON.stringify(mixedPayload));
assert.equal(mixedResult.mode, 'SEMANTIC_INTERPRETATION', 'mixed case-specific and conceptual issue response is accepted');
const mixedReconciliation = reconcileQuestionUnderstanding(
  mixedCaseAndConceptual.question, classifyQuestion(mixedCaseAndConceptual.question), mixedResult
);
const mixedIssues = mixedReconciliation.issuePlan.issues.filter(issue => issue.unresolvedReason !== 'UNASSIGNED_QUERY_TOPIC');
assert.deepEqual(mixedIssues.map(issue => issue.evidenceRequirement), [
  'AUTHORITATIVE_SOURCE_AND_CASE_FACTS', 'AUTHORITATIVE_SOURCE'
], 'case-specificity is derived per issue, so the top-level flag does not impose facts on a general issue');

const mixedEligibility = {
  question: 'Can I claim personal tax relief on my CPF contributions? What conditions allow any employee to qualify for the general employment benefit?',
  operation: 'CHECK_ELIGIBILITY', facts: true, domain: 'IRAS_INCOME_TAX', population: 'UNKNOWN', authority: 'IRAS',
  subject: 'personal tax relief and general employment benefit eligibility',
  issues: [
    { subject: 'personal CPF tax relief claim', population: 'INDIVIDUAL', domain: 'IRAS_INCOME_TAX', authority: 'IRAS', operation: 'CHECK_ELIGIBILITY' },
    { subject: 'general conditions for employee benefit eligibility', population: 'EMPLOYEE', domain: 'IRAS_INCOME_TAX', authority: 'IRAS', operation: 'CHECK_ELIGIBILITY' }
  ]
};
const mixedEligibilityPayload = payloadFor(mixedEligibility);
mixedEligibilityPayload.issues = mixedEligibility.issues.map(issue => issueFor(issue));
const mixedEligibilityResult = await interpretSemanticQuestion(mixedEligibility.question, provider,
  async () => JSON.stringify(mixedEligibilityPayload));
assert.equal(mixedEligibilityResult.mode, 'SEMANTIC_INTERPRETATION');
const mixedEligibilityPlan = reconcileQuestionUnderstanding(
  mixedEligibility.question, classifyQuestion(mixedEligibility.question), mixedEligibilityResult
).issuePlan;
assert.deepEqual(mixedEligibilityPlan.issues.slice(0, 2).map(issue => issue.evidenceRequirement), [
  'AUTHORITATIVE_SOURCE_AND_CASE_FACTS', 'AUTHORITATIVE_SOURCE'
], 'a case-specific eligibility issue does not impose facts on a separate general eligibility issue');

const genericClass = irasFirstSemanticCases.find(item => item.id === 'generic-employee-class-eligibility');
const genericClassFalse = await interpretSemanticQuestion(genericClass.question, provider,
  async () => JSON.stringify(payloadFor(genericClass, { facts: true })));
assert.equal(genericClassFalse.mode, 'SEMANTIC_INTERPRETATION');
assert.equal(genericClassFalse.interpretation.requiresUserSpecificFacts, false,
  'a general employee-class eligibility question does not require claimant-specific facts');

const legacyGeneric = payloadFor(genericClass);
delete legacyGeneric.schemaVersion;
legacyGeneric.calculationRequested = false;
const legacyAccepted = await interpretSemanticQuestion(genericClass.question, provider,
  async () => JSON.stringify(legacyGeneric));
assert.equal(legacyAccepted.mode, 'SEMANTIC_INTERPRETATION', 'legacy wire shape remains supported with a consistent flag');
const legacyContradiction = { ...legacyGeneric, requiresUserSpecificFacts: true };
const legacyRejected = await interpretSemanticQuestion(genericClass.question, provider,
  async () => JSON.stringify(legacyContradiction));
assert.equal(legacyRejected.mode, 'SEMANTIC_INTERPRETATION',
  'legacy wire flags remain non-authoritative after structural compatibility validation');
assert.equal(legacyRejected.interpretation.requiresUserSpecificFacts, false,
  'legacy query normalization ignores the supplied flag');

console.log(`IRAS-first query-aware semantic contract regressions passed for ${irasFirstSemanticCases.length} operation families and mixed issues.`);
