import assert from 'node:assert/strict';
import {
  interpretSemanticQuestion,
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';

const prompts = {
  A: "An employee earns SGD 6,000 per month. What CPF contributions must the employer and employee make, and how do the employee's compulsory CPF contributions affect personal income tax relief?",
  B: 'We hired a foreign employee in Singapore. What employment/work-pass requirements apply, whether CPF contributions are required, and what employer tax reporting obligations should we consider?',
  C: "Our company pays an employee's housing allowance. Is it deductible to the company and is it taxable to the employee?",
  D: 'How should an expense be recorded under SFRS(I), and is it deductible for Singapore corporate income tax?'
};

const flatInterpretation = (overrides = {}) => ({
  jurisdiction: ['Singapore'],
  authorityCandidates: ['UNKNOWN'],
  contextualAuthorities: [],
  domain: 'UNKNOWN',
  population: 'UNKNOWN',
  primarySubject: 'compound Singapore accounting and regulatory question',
  concepts: [],
  requestedOperation: 'OTHER',
  requiresUserSpecificFacts: false,
  calculationRequested: false,
  factsExplicitlyProvided: [],
  confidence: 0.96,
  ...overrides
});

const issue = (overrides = {}) => ({
  subject: 'material regulatory workstream',
  population: 'UNKNOWN',
  domain: 'UNKNOWN',
  governingAuthorities: ['UNKNOWN'],
  contextualAuthorities: [],
  operation: 'OTHER',
  mappedTopicIds: [],
  evidenceRequirement: 'UNRESOLVED',
  confidence: 0.96,
  ...overrides
});

// Oracle contract fixtures: these exercise the structured issue-plan contract,
// not live-model accuracy or completeness.
const fixtures = {
  A: [
    issue({
      subject: 'employer CPF contribution obligations',
      population: 'EMPLOYER',
      domain: 'CPF_PAYROLL',
      governingAuthorities: ['CPF'],
      operation: 'CALCULATE',
      mappedTopicIds: ['cpf_contribution_rates'],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'
    }),
    issue({
      subject: 'employee CPF contribution obligations',
      population: 'EMPLOYEE',
      domain: 'CPF_PAYROLL',
      governingAuthorities: ['CPF'],
      operation: 'CALCULATE',
      mappedTopicIds: ['cpf_contribution_rates'],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'
    }),
    issue({
      subject: 'employee personal income tax relief for compulsory CPF contributions',
      population: 'INDIVIDUAL',
      domain: 'IRAS_INCOME_TAX',
      governingAuthorities: ['IRAS'],
      contextualAuthorities: ['CPF'],
      operation: 'DETERMINE_TREATMENT',
      mappedTopicIds: ['iras-individual-cpf-relief'],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'
    })
  ],
  B: [
    issue({
      subject: 'employment conditions for a foreign employee',
      population: 'EMPLOYER',
      domain: 'MOM_EMPLOYMENT',
      governingAuthorities: ['MOM'],
      operation: 'DETERMINE_TREATMENT',
      mappedTopicIds: ['mom-employment-act-coverage'],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'
    }),
    issue({
      subject: 'work-pass requirements for a foreign employee',
      population: 'EMPLOYER',
      domain: 'MOM_EMPLOYMENT',
      governingAuthorities: ['MOM'],
      operation: 'DETERMINE_TREATMENT',
      mappedTopicIds: ['mom-employment-act-coverage', 'unknown-topic-id'],
      evidenceRequirement: 'UNRESOLVED'
    }),
    issue({
      subject: 'employer CPF contribution obligations for a foreign employee',
      population: 'EMPLOYER',
      domain: 'CPF_PAYROLL',
      governingAuthorities: ['CPF'],
      operation: 'CHECK_ELIGIBILITY',
      mappedTopicIds: ['cpf_contribution_rates'],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'
    }),
    issue({
      subject: 'employer IR21 tax clearance and AIS employment income reporting obligations for a foreign employee',
      population: 'EMPLOYER',
      domain: 'IRAS_INCOME_TAX',
      governingAuthorities: ['IRAS'],
      operation: 'FILING_REQUIREMENT',
      mappedTopicIds: ['iras-employer-ir21', 'iras-ais-employment-income'],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'
    })
  ],
  C: [
    issue({
      subject: 'company income tax deductibility of housing allowance expense',
      population: 'COMPANY',
      domain: 'IRAS_INCOME_TAX',
      governingAuthorities: ['IRAS'],
      operation: 'CHECK_ELIGIBILITY',
      mappedTopicIds: ['iras-cit-deductibility'],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'
    }),
    issue({
      subject: 'employee benefits in kind income tax treatment of housing allowance',
      population: 'EMPLOYEE',
      domain: 'IRAS_INCOME_TAX',
      governingAuthorities: ['IRAS'],
      operation: 'DETERMINE_TREATMENT',
      mappedTopicIds: ['iras-employment-benefits'],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'
    })
  ],
  D: [
    issue({
      subject: 'SFRS(I) accounting treatment of an expense',
      population: 'COMPANY',
      domain: 'ACCOUNTING',
      governingAuthorities: ['ACCOUNTING_STANDARDS'],
      operation: 'PREPARE_JOURNAL',
      mappedTopicIds: [],
      evidenceRequirement: 'UNRESOLVED'
    }),
    issue({
      subject: 'corporate income tax deductibility of company expenses',
      population: 'COMPANY',
      domain: 'IRAS_INCOME_TAX',
      governingAuthorities: ['IRAS'],
      operation: 'CHECK_ELIGIBILITY',
      mappedTopicIds: ['cit_section_14'],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'
    })
  ]
};

const expectedTopicIds = {
  A: [['cpf_contribution_rates'], ['cpf_contribution_rates'], ['iras-individual-cpf-relief']],
  B: [[], [], ['cpf_contribution_rates'], []],
  C: [[], []],
  D: [[], []]
};

assert.ok(validateSemanticQuestionInterpretation(flatInterpretation()),
  'Legacy 12-key provider fixtures remain valid.');
assert.ok(validateSemanticQuestionInterpretation(flatInterpretation({ issues: fixtures.A })),
  'The optional issue array is accepted when each issue matches the taxonomy.');
const configuredProvider = { activeProvider: 'gemini', gemini: { apiKey: '0123456789012345', model: 'test-model' } };
const providerInterpretation = await interpretSemanticQuestion(prompts.A, configuredProvider,
  async () => JSON.stringify(flatInterpretation({ issues: fixtures.A })));
assert.equal(providerInterpretation.mode, 'SEMANTIC_INTERPRETATION',
  'Structured provider output can carry optional per-issue semantics.');
assert.equal(providerInterpretation.interpretation.issues.length, fixtures.A.length);

for (const [caseId, query] of Object.entries(prompts)) {
  const classification = classifyQuestion(query);
  const result = reconcileQuestionUnderstanding(query, classification, {
    mode: 'SEMANTIC_INTERPRETATION',
    interpretation: flatInterpretation({ issues: fixtures[caseId] })
  });
  assert.equal(result.issuePlan.source, 'SEMANTIC_ISSUES', caseId + ': use supplied issue fixture.');
  assert.equal(result.issuePlan.issues.length, fixtures[caseId].length, caseId + ': retain each material issue.');
  assert.deepEqual(result.classification, classification, caseId + ': issue plan stays separate from legacy classification.');
  assert.equal(new Set(result.issuePlan.issues.map(item => item.id)).size, fixtures[caseId].length,
    caseId + ': issue IDs are unique.');
  const expected = fixtures[caseId].map((item, index) => ({
    ...item,
    mappedTopicIds: expectedTopicIds[caseId][index],
    evidenceRequirement: item.domain === 'UNKNOWN' ? 'UNRESOLVED' :
      ['EXPLAIN_RULE', 'COMPARE', 'OTHER'].includes(item.operation) ? 'AUTHORITATIVE_SOURCE' : 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS',
    status: expectedTopicIds[caseId][index].length === 0 ? 'UNRESOLVED' : 'MAPPED',
    ...(expectedTopicIds[caseId][index].length === 0 ? { unresolvedReason: 'NO_COVERAGE_TOPIC' } : {})
  }));
  assert.deepEqual(result.issuePlan.issues.map(({ id: _id, ...item }) => item), expected,
    caseId + ': preserve issues while requiring independent query taxonomy support.');
  assert.equal(result.issuePlan.coverageEstablished, false, caseId + ': completeness is fail-closed for residual or absent coverage.');
  assert.equal(result.issuePlan.hasUnmappedResidual, true, caseId + ': unsupported workstreams or residual query text remain visible.');
  const repeated = reconcileQuestionUnderstanding(query, classification, {
    mode: 'SEMANTIC_INTERPRETATION',
    interpretation: flatInterpretation({ issues: fixtures[caseId] })
  });
  assert.deepEqual(result.issuePlan.issues.map(item => item.id), repeated.issuePlan.issues.map(item => item.id),
    caseId + ': stable inputs receive deterministic IDs.');
}

assert.equal(
  reconcileQuestionUnderstanding(prompts.B, classifyQuestion(prompts.B), {
    mode: 'SEMANTIC_INTERPRETATION', interpretation: flatInterpretation({ issues: fixtures.B })
  }).issuePlan.issues.find(item => item.subject.includes('work-pass'))?.status,
  'UNRESOLVED',
  'A material issue without an exact coverage topic remains visible as unresolved.'
);

for (const invalidIssue of [
  issue({ domain: 'CPF_PAYROLL', governingAuthorities: ['MOM'], mappedTopicIds: ['cpf_contribution_rates'] }),
  { ...issue(), id: 'provider-controlled-id' },
  issue({ confidence: 0.2 })
]) {
  assert.equal(validateSemanticQuestionInterpretation(flatInterpretation({ issues: [invalidIssue] })), undefined,
    'Malformed, low-confidence, or domain/population/topic-inconsistent issue output is rejected.');
}

const safelyNormalizedIssues = validateSemanticQuestionInterpretation(flatInterpretation({ issues: [
  issue({
    subject: 'employee personal income tax relief for compulsory CPF contributions',
    population: 'INDIVIDUAL',
    domain: 'IRAS_INCOME_TAX',
    governingAuthorities: ['IRAS'],
    mappedTopicIds: ['iras-cit-deductibility', 'unknown-topic-id']
  }),
  issue({
    subject: 'company income tax deductibility of company expenses',
    population: 'SHAREHOLDER',
    domain: 'IRAS_INCOME_TAX',
    governingAuthorities: ['IRAS'],
    mappedTopicIds: ['cit_section_14']
  })
]}));
assert.deepEqual(safelyNormalizedIssues?.issues?.map(item => item.mappedTopicIds), [
  [],
  []
], 'Topic IDs are not derived from the model subject, and incompatible hints are discarded.');

const noProviderQuery = 'Our company incurred staff welfare expenses. Are they deductible for corporate income tax?';
const hintFreeIssue = issue({
  subject: 'corporate income tax deductibility of staff welfare expenses',
  population: 'COMPANY', domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'],
  operation: 'CHECK_ELIGIBILITY', mappedTopicIds: []
});
const hintFreeResult = reconcileQuestionUnderstanding(noProviderQuery, classifyQuestion(noProviderQuery), {
  mode: 'SEMANTIC_INTERPRETATION', interpretation: flatInterpretation({ issues: [hintFreeIssue] })
});
assert.deepEqual(hintFreeResult.issuePlan.issues[0].mappedTopicIds, ['iras-cit-deductibility'],
  'Issue subject can derive a topic when the original query independently recognizes it, even with empty provider hints.');
assert.equal(hintFreeResult.issuePlan.issues[0].status, 'MAPPED');

const cpfPopulationMismatch = reconcileQuestionUnderstanding(prompts.A, classifyQuestion(prompts.A), {
  mode: 'SEMANTIC_INTERPRETATION', interpretation: flatInterpretation({ issues: [issue({
    subject: 'employee CPF contribution requirements', population: 'SHAREHOLDER',
    domain: 'CPF_PAYROLL', governingAuthorities: ['CPF'], operation: 'CHECK_ELIGIBILITY',
    mappedTopicIds: ['cpf_contribution_rates']
  })] })
});
assert.equal(cpfPopulationMismatch.issuePlan.issues[0].status, 'UNRESOLVED',
  'CPF contribution topics do not map to unrelated shareholder populations.');
assert.deepEqual(cpfPopulationMismatch.issuePlan.issues[0].mappedTopicIds, []);

const partialA = reconcileQuestionUnderstanding(prompts.A, classifyQuestion(prompts.A), {
  mode: 'SEMANTIC_INTERPRETATION', interpretation: flatInterpretation({ issues: fixtures.A.slice(0, 2) })
});
assert.ok(partialA.issuePlan.issues.some(item => item.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC' &&
  item.mappedTopicIds.includes('iras-individual-cpf-relief')),
'An independently recognized A topic omitted by the provider is retained as unresolved.');
assert.equal(partialA.issuePlan.coverageEstablished, false);

const queryCWithRecognizedBenefitTopic = "Our company pays an employee's housing allowance. Is it deductible to the company for Singapore corporate income tax, is it taxable to the employee, and what benefits-in-kind tax reporting obligation applies?";
const partialC = reconcileQuestionUnderstanding(queryCWithRecognizedBenefitTopic, classifyQuestion(queryCWithRecognizedBenefitTopic), {
  mode: 'SEMANTIC_INTERPRETATION', interpretation: flatInterpretation({ issues: [] })
});
assert.ok(partialC.issuePlan.issues.some(item => item.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC' &&
  item.mappedTopicIds.includes('iras-employment-benefits')),
'An independently recognized C benefit topic is retained when the semantic issue array omits it.');

const fabricatedTopicIssue = issue({
  subject: 'SRS relief eligibility that the employee mentioned',
  population: 'INDIVIDUAL', domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'],
  operation: 'CHECK_ELIGIBILITY', mappedTopicIds: ['iras-individual-cpf-relief']
});
const fabricatedTopicResult = reconcileQuestionUnderstanding(prompts.C, classifyQuestion(prompts.C), {
  mode: 'SEMANTIC_INTERPRETATION', interpretation: flatInterpretation({ issues: [fabricatedTopicIssue] })
});
assert.equal(fabricatedTopicResult.issuePlan.issues[0].status, 'UNRESOLVED',
  'A same-authority/same-domain subject and topic hint cannot create support absent from the original query inventory.');
assert.deepEqual(fabricatedTopicResult.issuePlan.issues[0].mappedTopicIds, []);

const evidenceOverrideResult = reconcileQuestionUnderstanding(prompts.D, classifyQuestion(prompts.D), {
  mode: 'SEMANTIC_INTERPRETATION', interpretation: flatInterpretation({ issues: [
    issue({ domain: 'IRAS_INCOME_TAX', population: 'COMPANY', governingAuthorities: ['IRAS'],
      operation: 'CALCULATE', mappedTopicIds: [], evidenceRequirement: 'CASE_FACTS' }),
    issue({ domain: 'ACCOUNTING', population: 'COMPANY', governingAuthorities: ['ACCOUNTING_STANDARDS'],
      operation: 'EXPLAIN_RULE', mappedTopicIds: [], evidenceRequirement: 'CASE_FACTS' })
  ] })
});
assert.deepEqual(evidenceOverrideResult.issuePlan.issues.map(item => item.evidenceRequirement), [
  'AUTHORITATIVE_SOURCE_AND_CASE_FACTS', 'AUTHORITATIVE_SOURCE'
], 'Evidence requirements are derived from domain and operation, not provider-selected.');

const interactionIssue = issue({
  subject: 'interaction of CPF contributions and personal income tax relief', population: 'INDIVIDUAL',
  domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], contextualAuthorities: ['CPF'],
  operation: 'EXPLAIN_INTERACTION', mappedTopicIds: [], evidenceRequirement: 'CASE_FACTS'
});
assert.equal(validateSemanticQuestionInterpretation(flatInterpretation({ issues: [interactionIssue] }))?.issues?.[0].evidenceRequirement,
  'UNRESOLVED', 'Without case-specific context, interaction evidence is conservatively unresolved before reconciliation.');
const generalInteraction = reconcileQuestionUnderstanding(
  'How do compulsory CPF contributions interact with personal income tax relief?',
  classifyQuestion('How do compulsory CPF contributions interact with personal income tax relief?'),
  { mode: 'SEMANTIC_INTERPRETATION', interpretation: flatInterpretation({ issues: [interactionIssue], requiresUserSpecificFacts: false }) }
);
assert.equal(generalInteraction.issuePlan.issues[0].evidenceRequirement, 'AUTHORITATIVE_SOURCE',
  'A general rule interaction does not require case facts.');
const caseInteraction = reconcileQuestionUnderstanding(
  prompts.A, classifyQuestion(prompts.A),
  { mode: 'SEMANTIC_INTERPRETATION', interpretation: flatInterpretation({ issues: [interactionIssue], requiresUserSpecificFacts: true }) }
);
assert.equal(caseInteraction.issuePlan.issues[0].evidenceRequirement, 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS',
  'A case-specific interaction requires source evidence and case facts.');

const noProvider = await interpretSemanticQuestion(noProviderQuery, undefined, async () => {
  throw new Error('No provider should be called.');
});
assert.equal(noProvider.failure, 'NO_PROVIDER');
const deterministicClassification = classifyQuestion(noProviderQuery);
const deterministic = reconcileQuestionUnderstanding(noProviderQuery, deterministicClassification, noProvider);
assert.deepEqual(deterministic.classification, deterministicClassification,
  'No-provider issue discovery does not rewrite legacy classification.');
assert.equal(deterministic.issuePlan.source, 'TAXONOMY_FALLBACK');
assert.ok(deterministic.issuePlan.issues.some(item => item.mappedTopicIds.includes('iras-cit-deductibility')),
  'No-provider mode exposes known corporate tax topics as a material workstream.');
assert.deepEqual(deterministic.issuePlan.issues.map(item => item.id),
  reconcileQuestionUnderstanding(noProviderQuery, deterministicClassification, noProvider).issuePlan.issues.map(item => item.id),
  'Taxonomy fallback IDs are deterministic.');

const supportedAndUnsupportedQuery = 'Our company incurred staff welfare expenses. Are they deductible for corporate income tax, and how are hypothetical widget registry reporting rules applied?';
const mixedFallback = reconcileQuestionUnderstanding(supportedAndUnsupportedQuery, classifyQuestion(supportedAndUnsupportedQuery), {
  mode: 'DETERMINISTIC_FALLBACK', failure: 'NO_PROVIDER'
});
assert.ok(mixedFallback.issuePlan.issues.some(item => item.mappedTopicIds.includes('iras-cit-deductibility')),
  'No-provider mode keeps recognized workstreams even when the query also has unsupported text.');
assert.equal(mixedFallback.issuePlan.coverageEstablished, false);
assert.equal(mixedFallback.issuePlan.hasUnmappedResidual, true);

const unsupportedQuery = 'What are the reporting rules for a hypothetical widget registry not covered by the current accounting taxonomy?';
const unsupportedFallback = reconcileQuestionUnderstanding(unsupportedQuery, classifyQuestion(unsupportedQuery), {
  mode: 'DETERMINISTIC_FALLBACK', failure: 'NO_PROVIDER'
});
assert.equal(unsupportedFallback.issuePlan.issues.length, 0);
assert.equal(unsupportedFallback.issuePlan.coverageEstablished, false);
assert.equal(unsupportedFallback.issuePlan.hasUnmappedResidual, true,
  'A wholly unsupported no-provider question cannot look complete merely because inventory is empty.');

console.log('Material issue decomposition regression passed.');
