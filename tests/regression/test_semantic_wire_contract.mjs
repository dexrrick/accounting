import assert from 'node:assert/strict';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import {
  interpretSemanticQuestion,
  reconcileQuestionUnderstanding,
  SEMANTIC_QUESTION_SCHEMA_VERSION,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';
import {
  diagnoseSemanticContract,
  diagnoseSemanticResponse
} from '../evaluation/singapore/semantic-contract-diagnosis.mjs';

const provider = 'synthetic-semantic-provider-key';

function issue({
  subject = 'general tax treatment',
  operation = 'EXPLAIN_RULE',
  domain = 'IRAS_INCOME_TAX',
  population = 'UNKNOWN',
  governingAuthorities = ['IRAS'],
  contextualAuthorities = [],
  evidenceRequirement = operation === 'EXPLAIN_RULE' || operation === 'COMPARE' || operation === 'OTHER'
    ? 'AUTHORITATIVE_SOURCE'
    : operation === 'EXPLAIN_INTERACTION' ? 'UNRESOLVED' : 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'
} = {}) {
  return {
    subject,
    population,
    domain,
    governingAuthorities,
    contextualAuthorities,
    operation,
    mappedTopicIds: [],
    evidenceRequirement,
    confidence: 0.96
  };
}

function v2(overrides = {}) {
  return {
    schemaVersion: SEMANTIC_QUESTION_SCHEMA_VERSION,
    jurisdiction: ['Singapore'],
    authorityCandidates: ['IRAS'],
    contextualAuthorities: [],
    domain: 'IRAS_INCOME_TAX',
    population: 'UNKNOWN',
    primarySubject: 'general tax treatment',
    concepts: [{ concept: 'general tax treatment', role: 'PRIMARY' }],
    requestedOperation: 'EXPLAIN_RULE',
    requiresUserSpecificFacts: false,
    factsExplicitlyProvided: [],
    confidence: 0.96,
    issues: [issue()],
    ...overrides
  };
}

async function interpretMock(question, value) {
  return interpretSemanticQuestion(question, provider, async () => JSON.stringify(value));
}

assert.equal(SEMANTIC_QUESTION_SCHEMA_VERSION, 2);
const validV2 = v2();
assert.ok(validateSemanticQuestionInterpretation(validV2));
assert.equal(diagnoseSemanticContract(validV2).validatorAccepted, true);
assert.equal(diagnoseSemanticResponse(JSON.stringify(validV2)).rejectionCode, 'NONE');

const normalizedV2 = await interpretMock('Explain the general income tax rule.', validV2);
assert.equal(normalizedV2.mode, 'SEMANTIC_INTERPRETATION');
assert.equal(normalizedV2.interpretation.calculationRequested, false);
assert.equal(Object.hasOwn(normalizedV2.interpretation, 'schemaVersion'), false,
  'the wire version is stripped from the stable internal interpretation');

const v2WithoutIssues = { ...validV2 };
delete v2WithoutIssues.issues;
assert.equal(validateSemanticQuestionInterpretation(v2WithoutIssues), undefined, 'V2 requires issues');
assert.equal(validateSemanticQuestionInterpretation(v2({ issues: [] })), undefined, 'V2 requires at least one issue');
assert.equal(validateSemanticQuestionInterpretation(v2({ schemaVersion: 3 })), undefined, 'unknown wire versions are rejected');
assert.equal(validateSemanticQuestionInterpretation(v2({ calculationRequested: false })), undefined,
  'V2 rejects the legacy calculation flag as an unknown key');
assert.equal(validateSemanticQuestionInterpretation(v2({ unrecognizedField: 'private sentinel' })), undefined,
  'V2 rejects unknown top-level keys');
const privateFieldName = 'privateV2SchemaSentinel';
const privateFieldValue = 'RAW_PRIVATE_V2_SENTINEL';
const rejectedUnknownV2Field = diagnoseSemanticContract({ ...validV2, [privateFieldName]: privateFieldValue });
assert.equal(rejectedUnknownV2Field.rejectionCode, 'UNEXPECTED_KEY');
assert.equal(rejectedUnknownV2Field.safeShape.extraKeyCount, 1);
assert.equal(JSON.stringify(rejectedUnknownV2Field).includes(privateFieldName), false);
assert.equal(JSON.stringify(rejectedUnknownV2Field).includes(privateFieldValue), false);
assert.equal(validateSemanticQuestionInterpretation(v2({ issues: [{ ...issue(), extra: 'unexpected' }] })), undefined,
  'V2 issue objects remain exact');

const { schemaVersion: _version, ...legacyFields } = validV2;
const legacy = { ...legacyFields, calculationRequested: false };
assert.ok(validateSemanticQuestionInterpretation(legacy), 'unversioned legacy payloads remain accepted');
const legacyWithoutIssues = { ...legacy };
delete legacyWithoutIssues.issues;
assert.ok(validateSemanticQuestionInterpretation(legacyWithoutIssues), 'legacy issues remain optional');
assert.ok(validateSemanticQuestionInterpretation({ ...legacy, issues: [] }), 'legacy empty issues remain compatible');
assert.equal(validateSemanticQuestionInterpretation({ ...legacy, requestedOperation: 'CALCULATE' }), undefined,
  'legacy operation/flag contradictions remain rejected');
assert.equal(validateSemanticQuestionInterpretation({
  ...legacy,
  requestedOperation: 'CALCULATE',
  calculationRequested: true,
  requiresUserSpecificFacts: false
}), undefined, 'legacy calculation/case contradictions remain rejected');
assert.equal(validateSemanticQuestionInterpretation({ ...legacy, legacyExtra: true }), undefined,
  'legacy payloads still reject unknown keys');

const v2CalculationContradiction = v2({
  requestedOperation: 'CALCULATE',
  requiresUserSpecificFacts: false,
  issues: [issue({ operation: 'CALCULATE' })]
});
const contradictionDiagnostic = diagnoseSemanticContract(v2CalculationContradiction);
assert.equal(contradictionDiagnostic.validatorAccepted, false);
assert.equal(contradictionDiagnostic.rejectionCode, 'CASE_FLAG_CONTRADICTION',
  'diagnostics derive and identify the V2 calculation/case contradiction');
assert.equal((await interpretMock('How much tax is due?', v2CalculationContradiction)).failureReason, 'CONTRADICTORY_FIELDS');

assert.equal(validateSemanticQuestionInterpretation(v2({
  concepts: [{ concept: 'https://example.invalid/private', role: 'PRIMARY' }]
})), undefined, 'unsafe concept labels are rejected');
assert.equal(validateSemanticQuestionInterpretation(v2({
  concepts: [{ concept: 'general eligibility', role: 'UNKNOWN' }]
})), undefined, 'unknown concept roles are rejected');
assert.equal(validateSemanticQuestionInterpretation(v2({
  concepts: [{ concept: '', role: 'PRIMARY' }]
})), undefined, 'empty concept labels are rejected');
assert.equal(validateSemanticQuestionInterpretation(v2({
  concepts: [{ role: 'PRIMARY' }]
})), undefined, 'concepts require the concept key');
assert.equal(validateSemanticQuestionInterpretation(v2({
  concepts: [{ concept: 'safe label' }]
})), undefined, 'concepts require the role key');
assert.equal(validateSemanticQuestionInterpretation(v2({
  concepts: [{ concept: 'safe label', role: 'PRIMARY', extra: true }]
})), undefined, 'concept objects reject unknown keys');

const contextualOnly = v2({
  authorityCandidates: ['UNKNOWN'],
  contextualAuthorities: ['IRAS'],
  domain: 'UNKNOWN',
  population: 'UNKNOWN',
  primarySubject: 'unresolved question with contextual IRAS mention',
  requestedOperation: 'OTHER',
  requiresUserSpecificFacts: false,
  concepts: [{ concept: 'unresolved question', role: 'PRIMARY' }],
  issues: [issue({
    subject: 'unresolved question', operation: 'OTHER', domain: 'UNKNOWN', population: 'UNKNOWN',
    governingAuthorities: ['UNKNOWN'], contextualAuthorities: ['IRAS'], evidenceRequirement: 'UNRESOLVED'
  })]
});
assert.ok(validateSemanticQuestionInterpretation(contextualOnly),
  'an authority mentioned only as context does not become a governing authority');

const operationCases = [
  {
    operation: 'EXPLAIN_RULE',
    question: 'Explain the general rule, using SGD 250 only as an illustrative amount.',
    domain: 'IRAS_INCOME_TAX', population: 'UNKNOWN', governingAuthorities: ['IRAS'],
    requiresFacts: false, expectedCalculation: false
  },
  {
    operation: 'EXPLAIN_INTERACTION',
    question: 'How do GST and income tax rules interact for a business?',
    domain: 'IRAS_GST', population: 'COMPANY', governingAuthorities: ['IRAS'],
    requiresFacts: false, expectedCalculation: false
  },
  {
    operation: 'DETERMINE_TREATMENT',
    question: 'What tax applies to a payment received for damaged property?',
    domain: 'IRAS_INCOME_TAX', population: 'UNKNOWN', governingAuthorities: ['IRAS'],
    requiresFacts: true, expectedCalculation: false
  },
  {
    operation: 'CHECK_ELIGIBILITY',
    question: 'Does this claimant qualify for the stated relief?',
    domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL', governingAuthorities: ['IRAS'],
    requiresFacts: true, expectedCalculation: false
  },
  {
    operation: 'CALCULATE',
    question: 'How much CPF contribution is due on a monthly salary of SGD 4,000?',
    domain: 'CPF_PAYROLL', population: 'EMPLOYEE', governingAuthorities: ['CPF'],
    requiresFacts: true, expectedCalculation: true
  },
  {
    operation: 'PREPARE_JOURNAL',
    question: 'What journal entry records the equipment repair invoice?',
    domain: 'ACCOUNTING', population: 'COMPANY', governingAuthorities: ['ACCOUNTING_STANDARDS'],
    requiresFacts: true, expectedCalculation: false
  },
  {
    operation: 'COMPARE',
    question: 'Compare the tax treatment of the two stated alternatives.',
    domain: 'IRAS_INCOME_TAX', population: 'COMPANY', governingAuthorities: ['IRAS'],
    requiresFacts: false, expectedCalculation: false
  },
  {
    operation: 'FILING_REQUIREMENT',
    question: 'Must an employer file a return for this benefit?',
    domain: 'IRAS_INCOME_TAX', population: 'EMPLOYER', governingAuthorities: ['IRAS'],
    requiresFacts: true, expectedCalculation: false
  },
  {
    operation: 'OTHER',
    question: 'Provide the requested summary of the situation.',
    domain: 'IRAS_INCOME_TAX', population: 'UNKNOWN', governingAuthorities: ['IRAS'],
    requiresFacts: false, expectedCalculation: false
  }
];

for (const testCase of operationCases) {
  const payload = v2({
    authorityCandidates: testCase.governingAuthorities,
    domain: testCase.domain,
    population: testCase.population,
    primarySubject: `synthetic ${testCase.operation.toLowerCase()} question`,
    requestedOperation: testCase.operation,
    requiresUserSpecificFacts: testCase.requiresFacts,
    factsExplicitlyProvided: testCase.requiresFacts ? ['synthetic case fact'] : [],
    issues: [issue({
      subject: `synthetic ${testCase.operation.toLowerCase()} question`,
      operation: testCase.operation,
      domain: testCase.domain,
      population: testCase.population,
      governingAuthorities: testCase.governingAuthorities
    })]
  });
  const result = await interpretMock(testCase.question, payload);
  assert.equal(result.mode, 'SEMANTIC_INTERPRETATION', `${testCase.operation} V2 contract validates`);
  assert.equal(result.interpretation.requestedOperation, testCase.operation);
  assert.equal(result.interpretation.calculationRequested, testCase.expectedCalculation,
    `${testCase.operation} derives the internal calculation flag`);
}

const mixed = v2({
  authorityCandidates: ['UNKNOWN'],
  domain: 'UNKNOWN',
  population: 'UNKNOWN',
  primarySubject: 'company expense journal and income-tax deductibility',
  concepts: [
    { concept: 'expense journal', role: 'RELATED' },
    { concept: 'expense deductibility', role: 'PRIMARY' }
  ],
  requestedOperation: 'OTHER',
  requiresUserSpecificFacts: true,
  factsExplicitlyProvided: ['synthetic company expense'],
  issues: [
    issue({
      subject: 'company expense journal', operation: 'PREPARE_JOURNAL', domain: 'ACCOUNTING',
      population: 'COMPANY', governingAuthorities: ['ACCOUNTING_STANDARDS']
    }),
    issue({
      subject: 'company expense tax deductibility', operation: 'CHECK_ELIGIBILITY', domain: 'IRAS_INCOME_TAX',
      population: 'COMPANY', governingAuthorities: ['IRAS']
    })
  ]
});
assert.ok(validateSemanticQuestionInterpretation(mixed), 'mixed journal and tax questions retain per-outcome operations');
assert.equal((await interpretMock(
  'What journal entry records a company expense, and is that expense deductible for tax?', mixed
)).interpretation.requestedOperation, 'OTHER');

const mixedCalculationQuestion =
  'What CPF amount is due for this employer payroll, and what journal entry records the employer contribution?';
const mixedCalculation = v2({
  authorityCandidates: ['UNKNOWN'],
  domain: 'UNKNOWN',
  population: 'UNKNOWN',
  primarySubject: 'employer CPF amount and journal entry',
  concepts: [
    { concept: 'employer CPF contribution', role: 'PRIMARY' },
    { concept: 'payroll journal entry', role: 'RELATED' }
  ],
  requestedOperation: 'OTHER',
  requiresUserSpecificFacts: true,
  factsExplicitlyProvided: ['synthetic payroll salary'],
  issues: [
    issue({
      subject: 'employer CPF contribution amount due', operation: 'CALCULATE', domain: 'CPF_PAYROLL',
      population: 'EMPLOYER', governingAuthorities: ['CPF']
    }),
    issue({
      subject: 'journal entry for employer CPF contribution', operation: 'PREPARE_JOURNAL', domain: 'ACCOUNTING',
      population: 'EMPLOYER', governingAuthorities: ['ACCOUNTING_STANDARDS'], contextualAuthorities: ['CPF']
    })
  ]
});
const mixedCalculationResult = await interpretMock(mixedCalculationQuestion, mixedCalculation);
assert.equal(mixedCalculationResult.mode, 'SEMANTIC_INTERPRETATION');
assert.equal(mixedCalculationResult.interpretation.requestedOperation, 'OTHER');
assert.equal(mixedCalculationResult.interpretation.calculationRequested, false,
  'a mixed V2 question derives its top-level calculation flag from OTHER');
const reconciledMixedCalculation = reconcileQuestionUnderstanding(
  mixedCalculationQuestion,
  classifyQuestion(mixedCalculationQuestion),
  mixedCalculationResult
).issuePlan;
const calculatedIssue = reconciledMixedCalculation.issues.find(candidate => candidate.operation === 'CALCULATE');
assert.ok(calculatedIssue, 'the issue-level calculation survives reconciliation');
assert.equal(calculatedIssue.domain, 'CPF_PAYROLL');
assert.equal(calculatedIssue.evidenceRequirement, 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS',
  'the issue-level calculation continues to require authoritative evidence and case facts');

console.log('Semantic V2 wire contract and operation regressions passed.');
