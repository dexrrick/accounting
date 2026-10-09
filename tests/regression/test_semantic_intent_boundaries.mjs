import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import {
  interpretSemanticQuestion,
  reconcileQuestionUnderstanding
} from '../../src/services/semanticQuestionUnderstanding.ts';
import { planAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';

const provider = 'test-semantic-intent-boundary-provider-key';
const fixture = JSON.parse(await readFile(new URL('../evaluation/singapore/semantic-intent-boundaries.json', import.meta.url), 'utf8'));

function v2Payload(testCase) {
  const mock = testCase.mock;
  return {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: mock.authorityCandidates,
    contextualAuthorities: mock.contextualAuthorities,
    domain: mock.domain,
    population: mock.population,
    primarySubject: mock.primarySubject,
    concepts: mock.issues.map((issue, index) => ({ concept: issue.subject, role: index === 0 ? 'PRIMARY' : 'RELATED' })),
    requestedOperation: mock.requestedOperation,
    requiresUserSpecificFacts: mock.requiresUserSpecificFacts,
    factsExplicitlyProvided: mock.factsExplicitlyProvided,
    confidence: 0.96,
    issues: mock.issues.map(issue => ({
      ...issue,
      mappedTopicIds: [],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE',
      confidence: 0.96
    }))
  };
}

function matchesExpectedSubject(issueSubject, contract) {
  const normalized = issueSubject.toLowerCase();
  return contract.matchAny.some(group => group.every(term => normalized.includes(term.toLowerCase())));
}

function expectedEvidenceRequirement(operation, requiresFacts) {
  if (operation === 'UNKNOWN') return 'UNRESOLVED';
  if (requiresFacts) return 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS';
  if (operation === 'EXPLAIN_INTERACTION') return requiresFacts
    ? 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'
    : 'AUTHORITATIVE_SOURCE';
  return 'AUTHORITATIVE_SOURCE';
}

// Evidence expectations belong to each issue. The frozen fixture's historical
// root flag is retained as provider-compatibility input, but must not decide
// every issue's evidence requirement in a mixed question.
const expectedIssueSpecificity = {
  'employer-cpf-implicit-calculation': { 'employer-cpf-amount': true },
  'wht-payment-amount-calculation': { 'company-wht-amount': true },
  'withholding-tax-liability-classification': { 'company-wht-applicability': true },
  'srs-relief-eligibility-with-numbers': { 'individual-srs-relief-eligibility': true },
  'illustrative-relief-cap-interaction': { 'individual-relief-cap-interaction': false },
  'general-employment-benefit-rule': { 'general-employee-benefit-tax-rule': false },
  'specific-employee-benefit-treatment': { 'employee-insurance-benefit-tax-treatment': true },
  'foreign-dividend-receipt-treatment': { 'company-foreign-dividend-receipt-treatment': true },
  'private-expense-treatment': { 'company-private-expense-tax-treatment': true },
  'corporate-residency-general-rule': { 'general-company-tax-residency-rule': false },
  'mixed-withholding-amount-and-filing': {
    'company-wht-amount': true,
    'company-wht-filing-duty': true
  },
  'unknown-cpf-population-context': { 'cpf-contribution-amount-party-unknown': true }
};

assert.equal(fixture.cases.length, 12, 'The independent boundary set retains all ten families plus mixed and UNKNOWN/context controls.');
let capturedPrompt = '';
for (const testCase of fixture.cases) {
  const payload = v2Payload(testCase);
  const understanding = await interpretSemanticQuestion(testCase.question, provider, async (prompt, _system, _provider, options) => {
    capturedPrompt = prompt;
    assert.equal(options.temperature, 0);
    return JSON.stringify(payload);
  });
  assert.equal(understanding.mode, 'SEMANTIC_INTERPRETATION', `${testCase.id}: valid mock V2 payload is accepted`);
  assert.equal(understanding.interpretation.requestedOperation, testCase.mock.requestedOperation, `${testCase.id}: top-level operation is retained`);
  assert.equal(understanding.interpretation.requiresUserSpecificFacts, testCase.mock.requiresUserSpecificFacts, `${testCase.id}: fact gate is retained`);
  assert.deepEqual(understanding.interpretation.authorityCandidates, testCase.mock.authorityCandidates, `${testCase.id}: top-level authority is retained`);
  assert.deepEqual(understanding.interpretation.contextualAuthorities, testCase.mock.contextualAuthorities, `${testCase.id}: top-level contextual authorities are retained`);
  assert.deepEqual(understanding.interpretation.factsExplicitlyProvided, testCase.mock.factsExplicitlyProvided, `${testCase.id}: stated facts are retained`);
  assert.equal(understanding.interpretation.calculationRequested, testCase.mock.requestedOperation === 'CALCULATE',
    `${testCase.id}: legacy calculation flag derives only from top-level requestedOperation`);

  const reconciled = reconcileQuestionUnderstanding(testCase.question, classifyQuestion(testCase.question), understanding);
  const semanticIssues = reconciled.issuePlan.issues.filter(issue => issue.unresolvedReason !== 'UNASSIGNED_QUERY_TOPIC');
  assert.equal(semanticIssues.length, testCase.expected.length, `${testCase.id}: each requested material outcome remains a separate issue`);
  for (const contract of testCase.expected) {
    const matching = semanticIssues.filter(issue => matchesExpectedSubject(issue.subject, contract));
    assert.equal(matching.length, 1, `${testCase.id}/${contract.id}: one issue matches the expected subject`);
    const [issue] = matching;
    assert.ok(contract.population.includes(issue.population), `${testCase.id}/${contract.id}: population is retained`);
    assert.ok(contract.domain.includes(issue.domain), `${testCase.id}/${contract.id}: domain is retained`);
    assert.deepEqual(issue.governingAuthorities, contract.governingAuthorities, `${testCase.id}/${contract.id}: governing authority is retained`);
    assert.ok(contract.contextualAuthoritiesAnyOf.some(authorities => JSON.stringify(authorities) === JSON.stringify(issue.contextualAuthorities)),
      `${testCase.id}/${contract.id}: contextual authorities are retained`);
    assert.deepEqual(contract.operation, [issue.operation], `${testCase.id}/${contract.id}: the requested operation is retained exactly`);
    const issueIsCaseSpecific = expectedIssueSpecificity[testCase.id]?.[contract.id];
    assert.equal(typeof issueIsCaseSpecific, 'boolean', `${testCase.id}/${contract.id}: expected issue specificity is explicit`);
    assert.equal(issue.evidenceRequirement, expectedEvidenceRequirement(issue.operation, issueIsCaseSpecific),
      `${testCase.id}/${contract.id}: evidence requirements follow this issue's expected specificity, not the root flag`);
  }

  const workstreams = planAuthorityWorkstreams(reconciled.issuePlan).map(stream => `${stream.authority}/${stream.domain}`).sort();
  assert.ok(testCase.expectedWorkstreamsAnyOf.some(expected => JSON.stringify([...expected].sort()) === JSON.stringify(workstreams)),
    `${testCase.id}: planned workstreams ${JSON.stringify(workstreams)} match an accepted authority/domain set`);
}

const mixed = fixture.cases.find(testCase => testCase.id === 'mixed-withholding-amount-and-filing');
assert.ok(mixed);
assert.deepEqual(mixed.mock.issues.map(issue => issue.operation), ['CALCULATE', 'FILING_REQUIREMENT'],
  'The supplied V2 control separates a requested tax amount from its filing procedure.');

async function assertMixedFilingSpecificity(suffix, expectedRequirement, label) {
  const question = `${mixed.question.slice(0, mixed.question.lastIndexOf('and what filing/reporting procedure applies?'))}${suffix}`;
  const control = {
    ...mixed,
    question,
    mock: {
      ...mixed.mock,
      issues: mixed.mock.issues.map((issue, index) => index === 1
        ? { ...issue, subject: 'filing reporting procedure' }
        : issue)
    }
  };
  const understanding = await interpretSemanticQuestion(question, provider, async (prompt, _system, _provider, options) => {
    capturedPrompt = prompt;
    assert.equal(options.temperature, 0);
    return JSON.stringify(v2Payload(control));
  });
  const reconciled = reconcileQuestionUnderstanding(question, classifyQuestion(question), understanding);
  const amountIssue = reconciled.issuePlan.issues.find(issue => issue.operation === 'CALCULATE');
  const filingIssue = reconciled.issuePlan.issues.find(issue => issue.operation === 'FILING_REQUIREMENT');
  assert.ok(amountIssue && filingIssue, `${label}: the mixed question keeps both requested issues`);
  assert.equal(amountIssue.evidenceRequirement, 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS',
    `${label}: the amount issue continues to require case facts`);
  assert.equal(filingIssue.evidenceRequirement, expectedRequirement,
    `${label}: filing specificity is determined from the linked clause and generality, independently of root=true`);
}

await assertMixedFilingSpecificity('and what filing procedure applies?', 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS',
  'A filing procedure that applies to the stated payment is case-specific');
await assertMixedFilingSpecificity('and what are the general filing and reporting rules?', 'AUTHORITATIVE_SOURCE',
  'Explicitly general filing rules remain source-only despite the same payment context');
await assertMixedFilingSpecificity('and explain the general filing and reporting rules that apply to companies?', 'AUTHORITATIVE_SOURCE',
  'General filing rules remain source-only when they also say they apply to a class of companies');

const unknownContext = fixture.cases.find(testCase => testCase.id === 'unknown-cpf-population-context');
assert.ok(unknownContext);
assert.equal(unknownContext.mock.population, 'UNKNOWN');
assert.deepEqual(unknownContext.mock.issues[0].contextualAuthorities, ['MOM']);
assert.deepEqual(unknownContext.mock.issues[0].governingAuthorities, ['CPF']);

assert.match(capturedPrompt, /requested output is a numeric amount to pay, contribute, remit, deduct, withhold, charge, or provide.*?even if inputs are missing and no "amount", "how much", or "calculate" term appears/i);
assert.match(capturedPrompt, /A number merely included as a case fact or illustration is not a calculation/i);
assert.match(capturedPrompt, /a requested taxability or deductible-status outcome for a transaction is DETERMINE_TREATMENT/i);
assert.match(capturedPrompt, /CHECK_ELIGIBILITY for qualification or entitlement under a rule, scheme, or requirement/i);
assert.match(capturedPrompt, /EXPLAIN_RULE for general principles or conditions without applying them to a case/i);
assert.match(capturedPrompt, /CHECK_ELIGIBILITY is so only for a specific claimant or transaction/i);
assert.match(capturedPrompt, /keep mixed issues' evidence independent/i);
assert.match(capturedPrompt, /a requested withholding amount is CALCULATE, while a separately requested procedure is FILING_REQUIREMENT/i);
assert.match(capturedPrompt, /Assign exactly one governing authority to each issue and ensure it matches the issue domain/i);
assert.ok(capturedPrompt.length < 9_000, `Generic intent guidance and per-issue case-specificity remain within the prompt budget (${capturedPrompt.length} characters).`);

console.log(`Semantic intent-boundary mock V2 contract and downstream regressions passed for ${fixture.cases.length} cases; promptChars=${capturedPrompt.length}. These mocks test prompt/contract/routing behavior, not model inference.`);
