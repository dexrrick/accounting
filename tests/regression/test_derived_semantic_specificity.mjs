import assert from 'node:assert/strict';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import {
  interpretSemanticQuestion,
  reconcileQuestionUnderstanding,
  SEMANTIC_QUESTION_SCHEMA_VERSION,
  SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA,
  SEMANTIC_V2_INTERPRETATION_KEYS,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';
import { diagnoseSemanticResponse } from '../evaluation/singapore/semantic-contract-diagnosis.mjs';

const PROVIDER = 'synthetic-specificity-provider-key';
const PRIVATE_QUERY = 'SPECIFICITY_PRIVATE_QUERY_SENTINEL';
const PRIVATE_FACT = 'SPECIFICITY_PRIVATE_FACT_SENTINEL';

function issue({
  subject,
  operation,
  domain = 'IRAS_INCOME_TAX',
  population = 'INDIVIDUAL',
  authority = 'IRAS',
  contextualAuthorities = []
}) {
  return {
    subject,
    population,
    domain,
    governingAuthorities: [authority],
    contextualAuthorities,
    operation,
    mappedTopicIds: [],
    // Deliberately incorrect for applied cases: applicability and evidence are derived from the request.
    evidenceRequirement: 'AUTHORITATIVE_SOURCE',
    confidence: 0.96
  };
}

const cases = [
  {
    id: 'target-relief-entitlement',
    query: 'Can I claim personal tax relief on my compulsory CPF contributions?',
    operation: 'CHECK_ELIGIBILITY',
    issues: [issue({ subject: 'individual entitlement to personal tax relief for compulsory CPF contributions', operation: 'CHECK_ELIGIBILITY', contextualAuthorities: ['CPF'] })],
    expectedSpecificity: true,
    reportedSpecificity: false
  },
  {
    id: 'target-relief-amount',
    query: 'How much personal tax relief can I claim for compulsory CPF contributions?',
    operation: 'OTHER',
    issues: [issue({ subject: 'numeric amount of individual tax relief for compulsory CPF contributions', operation: 'CALCULATE', contextualAuthorities: ['CPF'] })],
    expectedSpecificity: true,
    reportedSpecificity: false
  },
  {
    id: 'A-paraphrase-2',
    query: 'For someone earning SGD 6,000 a month, what can they claim for personal tax relief on compulsory CPF, and what does the employer have to pay into CPF?',
    operation: 'OTHER',
    issues: [
      issue({ subject: 'employer CPF contribution amount', operation: 'CALCULATE', domain: 'CPF_PAYROLL', population: 'EMPLOYER', authority: 'CPF' }),
      issue({ subject: 'individual personal tax relief claim for compulsory CPF contributions', operation: 'CHECK_ELIGIBILITY', contextualAuthorities: ['CPF'] })
    ],
    expectedSpecificity: true,
    reportedSpecificity: false,
    facts: ['SGD 6,000 monthly salary']
  },
  {
    id: 'generic-who-qualifies',
    query: 'Who can claim CPF relief?',
    operation: 'CHECK_ELIGIBILITY',
    issues: [issue({ subject: 'who qualifies for CPF relief', operation: 'CHECK_ELIGIBILITY', contextualAuthorities: ['CPF'] })],
    expectedSpecificity: false
  },
  {
    id: 'generic-relief-conditions',
    query: 'What are the general conditions for CPF relief?',
    operation: 'CHECK_ELIGIBILITY',
    issues: [issue({ subject: 'general conditions for CPF relief', operation: 'CHECK_ELIGIBILITY', contextualAuthorities: ['CPF'] })],
    expectedSpecificity: false,
    facts: [PRIVATE_FACT]
  },
  {
    id: 'company-specific-eligibility',
    query: 'Does our company qualify for this deduction?',
    operation: 'CHECK_ELIGIBILITY',
    issues: [issue({ subject: 'our company eligibility for this deduction', operation: 'CHECK_ELIGIBILITY', domain: 'IRAS_INCOME_TAX', population: 'COMPANY' })],
    expectedSpecificity: true
  },
  {
    id: 'general-deduction-conditions',
    query: 'What are the general deduction conditions for companies?',
    operation: 'EXPLAIN_RULE',
    issues: [issue({ subject: 'general company tax deduction conditions', operation: 'EXPLAIN_RULE', population: 'COMPANY' })],
    expectedSpecificity: false
  },
  {
    id: 'generic-employee-class-eligibility',
    query: 'Can an employee claim CPF relief under the general rules?',
    operation: 'CHECK_ELIGIBILITY',
    issues: [issue({ subject: 'generic employee eligibility for CPF relief', operation: 'CHECK_ELIGIBILITY', population: 'EMPLOYEE', contextualAuthorities: ['CPF'] })],
    expectedSpecificity: false,
    facts: [PRIVATE_FACT]
  },
  {
    id: 'stated-transaction-treatment',
    query: "Our Singapore company paid SGD 900 for the director's private holiday and recorded it as travel expense. What is its corporate income-tax treatment?",
    operation: 'DETERMINE_TREATMENT',
    issues: [issue({ subject: "corporate tax treatment of our company's director private holiday expense", operation: 'DETERMINE_TREATMENT', population: 'COMPANY' })],
    expectedSpecificity: true
  },
  {
    id: 'general-tax-treatment-rule',
    query: 'Explain the general corporate income-tax treatment of business expenses.',
    operation: 'EXPLAIN_RULE',
    issues: [issue({ subject: 'general corporate income-tax treatment of business expenses', operation: 'EXPLAIN_RULE', population: 'COMPANY' })],
    expectedSpecificity: false
  },
  {
    id: 'applied-explain-rule',
    query: 'Explain whether our company can claim a deduction for this expense.',
    operation: 'EXPLAIN_RULE',
    issues: [issue({ subject: 'whether our company can claim a deduction for this expense', operation: 'EXPLAIN_RULE', population: 'COMPANY' })],
    expectedSpecificity: true
  },
  {
    id: 'journal-entry-application',
    query: "Prepare the journal entry for our company's office equipment purchase.",
    operation: 'PREPARE_JOURNAL',
    issues: [issue({ subject: "journal entry for our company's office equipment purchase", operation: 'PREPARE_JOURNAL', domain: 'ACCOUNTING', population: 'COMPANY', authority: 'ACCOUNTING_STANDARDS' })],
    expectedSpecificity: true
  },
  {
    id: 'general-accounting-rule',
    query: 'What are the general principles for recognizing intangible assets under SFRS(I)?',
    operation: 'EXPLAIN_RULE',
    issues: [issue({ subject: 'general intangible asset recognition under SFRS(I)', operation: 'EXPLAIN_RULE', domain: 'ACCOUNTING', population: 'UNKNOWN', authority: 'ACCOUNTING_STANDARDS' })],
    expectedSpecificity: false
  },
  {
    id: 'compare-general-criteria',
    query: 'Compare the general conditions for CPF relief and SRS relief.',
    operation: 'COMPARE',
    issues: [issue({ subject: 'comparison of general conditions for CPF and SRS relief', operation: 'COMPARE', contextualAuthorities: ['CPF'] })],
    expectedSpecificity: false
  },
  {
    id: 'compare-applied-claim',
    query: 'Compare whether my CPF and SRS contributions qualify for relief this year.',
    operation: 'COMPARE',
    issues: [issue({ subject: 'comparison of my CPF and SRS contribution claim eligibility', operation: 'COMPARE', contextualAuthorities: ['CPF'] })],
    expectedSpecificity: true
  },
  {
    id: 'filing-general-requirements',
    query: 'What are the general filing requirements for Singapore companies?',
    operation: 'FILING_REQUIREMENT',
    issues: [issue({ subject: 'general Singapore company filing requirements', operation: 'FILING_REQUIREMENT', domain: 'ACRA_CORPORATE', population: 'COMPANY', authority: 'ACRA' })],
    expectedSpecificity: false
  },
  {
    id: 'filing-specific-company',
    query: 'What filing requirement applies to our company after this change in ownership?',
    operation: 'FILING_REQUIREMENT',
    issues: [issue({ subject: 'filing requirement for our company after ownership change', operation: 'FILING_REQUIREMENT', domain: 'ACRA_CORPORATE', population: 'COMPANY', authority: 'ACRA' })],
    expectedSpecificity: true
  },
  {
    id: 'other-general-explanation',
    query: 'Explain generally how personal tax relief works in Singapore.',
    operation: 'OTHER',
    issues: [issue({ subject: 'general explanation of personal tax relief', operation: 'OTHER' })],
    expectedSpecificity: false
  },
  {
    id: 'other-named-company-application',
    query: 'Does Acme Pte Ltd qualify for this deduction?',
    operation: 'OTHER',
    issues: [issue({ subject: 'Acme Pte Ltd qualification for deduction', operation: 'OTHER', population: 'COMPANY' })],
    expectedSpecificity: true
  },
  {
    id: 'mixed-general-and-applied',
    query: 'What are the personal relief limits and deduction thresholds for CPF generally, and can I claim relief for my compulsory CPF contributions?',
    operation: 'OTHER',
    issues: [
      issue({ subject: 'personal relief limits and deduction thresholds', operation: 'EXPLAIN_RULE', contextualAuthorities: ['CPF'] }),
      issue({ subject: 'claim CPF relief for my compulsory contributions', operation: 'CHECK_ELIGIBILITY', contextualAuthorities: ['CPF'] })
    ],
    expectedSpecificity: true,
    expectedIssueSpecificity: [false, true]
  },
  {
    id: 'general-interaction-audience-request',
    query: 'Can you explain to me how CPF and SRS relief caps generally interact?',
    operation: 'EXPLAIN_INTERACTION',
    issues: [issue({ subject: 'general interaction of CPF and SRS relief caps', operation: 'EXPLAIN_INTERACTION', contextualAuthorities: ['CPF'] })],
    expectedSpecificity: false
  },
  {
    id: 'owned-arbitrary-modifier-voluntary-contributions',
    query: 'How do CPF and SRS relief caps interact for my voluntary CPF contributions?',
    operation: 'EXPLAIN_INTERACTION',
    issues: [issue({ subject: 'interaction of CPF and SRS relief caps for my voluntary contributions', operation: 'EXPLAIN_INTERACTION', contextualAuthorities: ['CPF'] })],
    expectedSpecificity: true
  },
  {
    id: 'owned-arbitrary-modifier-annual-contributions',
    query: 'How do CPF and SRS relief caps interact for my annual CPF contributions?',
    operation: 'EXPLAIN_INTERACTION',
    issues: [issue({ subject: 'interaction of CPF and SRS relief caps for my annual contributions', operation: 'EXPLAIN_INTERACTION', contextualAuthorities: ['CPF'] })],
    expectedSpecificity: true
  },
  {
    id: 'unresolved-owned-application-is-conservative',
    query: 'How do CPF and SRS relief caps interact for my annual adjustments?',
    operation: 'EXPLAIN_INTERACTION',
    issues: [issue({ subject: 'interaction of CPF and SRS relief caps', operation: 'EXPLAIN_INTERACTION', contextualAuthorities: ['CPF'] })],
    expectedSpecificity: true
  }
];

function makePayload(testCase, { reportedSpecificity, legacy = false, invalidAuthority = false } = {}) {
  const domains = [...new Set(testCase.issues.map(item => item.domain))];
  const authorities = [...new Set(testCase.issues.map(item => item.governingAuthorities[0]))];
  const populations = [...new Set(testCase.issues.map(item => item.population))];
  const payload = {
    schemaVersion: SEMANTIC_QUESTION_SCHEMA_VERSION,
    jurisdiction: ['Singapore'],
    authorityCandidates: authorities.length === 1 ? authorities : ['UNKNOWN'],
    contextualAuthorities: [],
    domain: domains.length === 1 ? domains[0] : 'UNKNOWN',
    population: populations.length === 1 ? populations[0] : 'UNKNOWN',
    primarySubject: testCase.issues.map(item => item.subject).join(' and '),
    concepts: [{ concept: 'requested semantic outcomes', role: 'PRIMARY' }],
    requestedOperation: testCase.operation,
    factsExplicitlyProvided: testCase.facts || [],
    confidence: 0.96,
    issues: testCase.issues.map(item => ({
      ...item,
      governingAuthorities: invalidAuthority ? ['CPF'] : item.governingAuthorities
    }))
  };
  if (reportedSpecificity !== undefined) payload.requiresUserSpecificFacts = reportedSpecificity;
  if (legacy) {
    delete payload.schemaVersion;
    payload.calculationRequested = testCase.operation === 'CALCULATE';
  }
  return payload;
}

async function interpretMock(testCase, options) {
  const payload = makePayload(testCase, options);
  const result = await interpretSemanticQuestion(testCase.query, PROVIDER, async () => JSON.stringify(payload));
  return { payload, result };
}

// Reproduce the three v1 responses rejected solely for model-vs-query flag disagreement.
const historicalContradictions = cases.slice(0, 3);
const historicalResults = await Promise.all(historicalContradictions.map(testCase =>
  interpretMock(testCase, { reportedSpecificity: false })
));
assert.deepEqual(historicalResults.map(({ result }) => result.mode), Array(3).fill('SEMANTIC_INTERPRETATION'),
  `the three observed CASE_FLAG_CONTRADICTION responses remain semantically usable when only derived metadata disagrees; got ${JSON.stringify(historicalResults.map(({ result }) => ({ mode: result.mode, reason: result.failureReason })))}`);
for (let index = 0; index < historicalResults.length; index += 1) {
  assert.equal(historicalResults[index].result.interpretation.requiresUserSpecificFacts, true,
    `${historicalContradictions[index].id}: internal specificity is derived, not copied from the provider`);
}

assert.deepEqual(SEMANTIC_V2_INTERPRETATION_KEYS, [
  'schemaVersion', 'jurisdiction', 'authorityCandidates', 'contextualAuthorities', 'domain', 'population', 'primarySubject',
  'concepts', 'requestedOperation', 'factsExplicitlyProvided', 'confidence', 'issues'
]);
assert.equal(SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA.properties.requiresUserSpecificFacts, undefined,
  'the new V2 provider wire contract omits application-derived specificity');

for (const testCase of cases) {
  const { result } = await interpretMock(testCase, {});
  assert.equal(result.mode, 'SEMANTIC_INTERPRETATION', `${testCase.id}: new V2 wire output is accepted`);
  assert.equal(result.interpretation.requiresUserSpecificFacts, testCase.expectedSpecificity,
    `${testCase.id}: deterministic root specificity`);
  assert.deepEqual(
    result.interpretation.issues.map(item => item.evidenceRequirement),
    (testCase.expectedIssueSpecificity || testCase.issues.map(() => testCase.expectedSpecificity)).map(required =>
      required ? 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' : 'AUTHORITATIVE_SOURCE'),
    `${testCase.id}: evidence is derived per issue, independent of provider hints`
  );
  const reconciled = reconcileQuestionUnderstanding(testCase.query, classifyQuestion(testCase.query), result);
  assert.equal(reconciled.issuePlan.source, 'SEMANTIC_ISSUES', `${testCase.id}: validated provider issue plan is retained`);
  assert.deepEqual(
    reconciled.issuePlan.issues.slice(0, testCase.issues.length).map(item => item.evidenceRequirement),
    (testCase.expectedIssueSpecificity || testCase.issues.map(() => testCase.expectedSpecificity)).map(required =>
      required ? 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' : 'AUTHORITATIVE_SOURCE'),
    `${testCase.id}: reconciliation keeps issue-specific evidence`
  );
}

const generalDeductionCase = cases.find(testCase => testCase.id === 'general-deduction-conditions');
const mandatoryRootCalculation = makePayload(generalDeductionCase);
mandatoryRootCalculation.requestedOperation = 'CALCULATE';
const rootCalculationResult = await interpretSemanticQuestion(generalDeductionCase.query, PROVIDER,
  async () => JSON.stringify(mandatoryRootCalculation));
assert.equal(rootCalculationResult.mode, 'SEMANTIC_INTERPRETATION');
assert.equal(rootCalculationResult.interpretation.requiresUserSpecificFacts, true,
  'a mandatory top-level calculation keeps the root specificity lower bound');
assert.equal(rootCalculationResult.interpretation.calculationRequested, true);
assert.equal(rootCalculationResult.interpretation.issues[0].evidenceRequirement, 'AUTHORITATIVE_SOURCE',
  'a conceptual issue keeps source-only evidence despite the root calculation lower bound');
const rootCalculationReconciliation = reconcileQuestionUnderstanding(
  generalDeductionCase.query, classifyQuestion(generalDeductionCase.query), rootCalculationResult
);
assert.equal(rootCalculationReconciliation.classification.calculationRequired, true);
assert.ok(rootCalculationReconciliation.classification.missingFacts.length > 0,
  'the flat projection retains the mandatory root calculation fact guard');
assert.equal(rootCalculationReconciliation.issuePlan.issues[0].evidenceRequirement, 'AUTHORITATIVE_SOURCE',
  'issue evidence remains independent of the root lower bound');

const normalizedGeneric = validateSemanticQuestionInterpretation(makePayload(cases[3]), cases[3].query);
assert.equal(normalizedGeneric?.requiresUserSpecificFacts, false);
assert.deepEqual(validateSemanticQuestionInterpretation(normalizedGeneric), normalizedGeneric,
  'query-less internal projections preserve an already-derived general-class decision');
const appliedExplainRule = cases.find(testCase => testCase.id === 'applied-explain-rule');
const normalizedAppliedExplanation = validateSemanticQuestionInterpretation(makePayload(appliedExplainRule), appliedExplainRule.query);
assert.equal(normalizedAppliedExplanation?.requiresUserSpecificFacts, true);
assert.deepEqual(validateSemanticQuestionInterpretation(normalizedAppliedExplanation), normalizedAppliedExplanation,
  'query-less internal projections preserve an already-derived applied EXPLAIN_RULE decision');

// Deprecated V2 and legacy flags remain compatible but are non-authoritative in both directions.
const compatibleApplication = await interpretMock(cases[0], { reportedSpecificity: false });
assert.equal(compatibleApplication.result.interpretation.requiresUserSpecificFacts, true);
const compatibleGeneral = await interpretMock(cases[3], { reportedSpecificity: true });
assert.equal(compatibleGeneral.result.interpretation.requiresUserSpecificFacts, false);
const legacyApplication = await interpretMock(cases[0], { reportedSpecificity: false, legacy: true });
assert.equal(legacyApplication.result.mode, 'SEMANTIC_INTERPRETATION');
assert.equal(legacyApplication.result.interpretation.requiresUserSpecificFacts, true);

for (const [testCase, output] of [[cases[0], compatibleApplication], [cases[3], compatibleGeneral]]) {
  const diagnostic = diagnoseSemanticResponse(JSON.stringify(output.payload), `${testCase.query} ${PRIVATE_QUERY}`);
  assert.equal(diagnostic.validatorAccepted, true, `${testCase.id}: deprecated flag mismatch is not a violation`);
  assert.equal(diagnostic.rejectionCode, 'NONE');
  assert.ok(diagnostic.nonViolationCodes.includes('CASE_FLAG_MISMATCH'));
  const safeText = JSON.stringify(diagnostic);
  assert.equal(safeText.includes(PRIVATE_QUERY), false);
  assert.equal(safeText.includes(PRIVATE_FACT), false);
}

const actualContradiction = makePayload(cases[0], { invalidAuthority: true });
const actualContradictionResult = await interpretSemanticQuestion(cases[0].query, PROVIDER,
  async () => JSON.stringify(actualContradiction));
assert.equal(actualContradictionResult.mode, 'DETERMINISTIC_FALLBACK');
assert.equal(actualContradictionResult.failure, 'INVALID_RESPONSE');
assert.equal(actualContradictionResult.failureReason, 'CONTRADICTORY_FIELDS',
  'removing specificity metadata does not repair a provider-authored domain/authority contradiction');

console.log('Derived semantic specificity regressions passed.');
