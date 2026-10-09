import assert from 'node:assert/strict';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { buildAuthorityWorkstreams, planAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import {
  interpretSemanticQuestion,
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';

const query = 'What are the general principles for recognizing intangible assets under IFRS?';
const rawAccountingIssue = {
  subject: 'general principles for recognizing intangible assets under IFRS',
  population: 'COMPANY',
  domain: 'ACCOUNTING',
  governingAuthorities: ['IFRS_FOUNDATION'],
  contextualAuthorities: [],
  operation: 'EXPLAIN_RULE',
  mappedTopicIds: [],
  evidenceRequirement: 'AUTHORITATIVE_SOURCE',
  confidence: 0.96
};
const rawInterpretation = {
  schemaVersion: 2,
  jurisdiction: ['Singapore'],
  authorityCandidates: ['IFRS_FOUNDATION'],
  contextualAuthorities: [],
  domain: 'ACCOUNTING',
  population: 'COMPANY',
  primarySubject: 'general principles for recognizing intangible assets under IFRS',
  concepts: [{ concept: 'intangible asset recognition', role: 'PRIMARY' }],
  requestedOperation: 'EXPLAIN_RULE',
  requiresUserSpecificFacts: false,
  factsExplicitlyProvided: [],
  confidence: 0.96,
  issues: [rawAccountingIssue]
};
assert.ok(validateSemanticQuestionInterpretation(rawInterpretation), 'IFRS Foundation remains a valid governing authority for accounting.');

const understanding = { mode: 'SEMANTIC_INTERPRETATION', interpretation: rawInterpretation };
const reconciled = reconcileQuestionUnderstanding(query, classifyQuestion(query), understanding);
const reconciledIssue = reconciled.issuePlan.issues.find(issue => issue.domain === 'ACCOUNTING');
assert.ok(reconciledIssue, 'The accounting issue survives reconciliation.');
const standardsControl = reconcileQuestionUnderstanding(query, classifyQuestion(query), {
  mode: 'SEMANTIC_INTERPRETATION',
  interpretation: {
    ...rawInterpretation,
    authorityCandidates: ['ACCOUNTING_STANDARDS'],
    issues: [{ ...rawAccountingIssue, governingAuthorities: ['ACCOUNTING_STANDARDS'] }]
  }
}).issuePlan.issues.find(issue => issue.domain === 'ACCOUNTING');
assert.ok(standardsControl);
assert.deepEqual(reconciledIssue.mappedTopicIds, standardsControl.mappedTopicIds,
  'IFRS and the established accounting authority preserve the same independently recognized topic IDs.');
assert.ok(reconciledIssue.mappedTopicIds.length > 0, 'The original query recognizes the test accounting topics.');
const planned = planAuthorityWorkstreams(reconciled.issuePlan);
assert.ok(planned.some(stream => stream.authority === 'ACCOUNTING_STANDARDS' && stream.domain === 'ACCOUNTING'),
  'The IFRS accounting issue reaches the established accounting workstream.');
assert.deepEqual(reconciledIssue.governingAuthorities, ['ACCOUNTING_STANDARDS'],
  'Only the accounting issue governor is normalized to the existing evidence workstream.');
assert.deepEqual(reconciledIssue.contextualAuthorities, [], 'No contextual authorities are promoted.');
assert.deepEqual(reconciledIssue.operation, 'EXPLAIN_RULE');
assert.deepEqual(rawInterpretation.issues[0].governingAuthorities, ['IFRS_FOUNDATION'],
  'The raw validated interpretation retains the provider authority label.');
assert.deepEqual(rawInterpretation.authorityCandidates, ['IFRS_FOUNDATION']);

for (const variantQuery of [
  'What are the general principles for recognizing intangible assets under SFRS(I)?',
  'Under IFRS, for Singapore SFRS(I) reporting, what are the general principles for recognizing intangible assets?'
]) {
  const variant = reconcileQuestionUnderstanding(variantQuery, classifyQuestion(variantQuery), {
    mode: 'SEMANTIC_INTERPRETATION',
    interpretation: {
      ...rawInterpretation,
      primarySubject: 'general principles for recognizing intangible assets',
      issues: [{ ...rawAccountingIssue, subject: 'general principles for recognizing intangible assets' }]
    }
  }).issuePlan.issues.find(issue => issue.domain === 'ACCOUNTING');
  assert.ok(variant);
  assert.equal(variant.status, 'MAPPED', 'SFRS(I) and mixed IFRS/Singapore wording retain recognized accounting coverage.');
  assert.deepEqual(variant.governingAuthorities, ['ACCOUNTING_STANDARDS']);
  assert.deepEqual(variant.mappedTopicIds, standardsControl.mappedTopicIds);
  assert.equal(variant.operation, 'EXPLAIN_RULE');
  assert.equal(variant.evidenceRequirement, 'AUTHORITATIVE_SOURCE');
}

const contextualQuery = 'Is the company intangible development cost deductible for Singapore corporate income tax if recorded under IFRS?';
const contextualInterpretation = {
  ...rawInterpretation,
  authorityCandidates: ['IRAS'],
  contextualAuthorities: ['IFRS_FOUNDATION'],
  domain: 'IRAS_INCOME_TAX',
  population: 'COMPANY',
  primarySubject: 'company tax deductibility of intangible development cost',
  requestedOperation: 'CHECK_ELIGIBILITY',
  requiresUserSpecificFacts: true,
  issues: [{
    ...rawAccountingIssue,
    subject: 'company tax deductibility of intangible development cost',
    population: 'COMPANY',
    domain: 'IRAS_INCOME_TAX',
    governingAuthorities: ['IRAS'],
    contextualAuthorities: ['IFRS_FOUNDATION'],
    operation: 'CHECK_ELIGIBILITY'
  }]
};
const contextualRoute = reconcileQuestionUnderstanding(contextualQuery, classifyQuestion(contextualQuery), {
  mode: 'SEMANTIC_INTERPRETATION', interpretation: contextualInterpretation
});
assert.deepEqual(contextualRoute.issuePlan.issues[0].contextualAuthorities, ['IFRS_FOUNDATION']);
assert.ok(planAuthorityWorkstreams(contextualRoute.issuePlan).every(stream => stream.authority !== 'IFRS_FOUNDATION'),
  'An IFRS Foundation context mention does not become a workstream.');
assert.deepEqual(planAuthorityWorkstreams(contextualRoute.issuePlan).map(stream => `${stream.authority}/${stream.domain}`),
  ['IRAS/IRAS_CORPORATE_TAX']);

let directRetrievalOptions;
const directResult = await buildAuthorityWorkstreams(query, {
  source: 'SEMANTIC_ISSUES',
  issues: [{ ...reconciledIssue, governingAuthorities: ['IFRS_FOUNDATION'] }],
  coverageEstablished: true,
  hasUnmappedResidual: false
}, {
  localOnly: true,
  retriever: { retrieveSources: async options => { directRetrievalOptions = options; return []; } },
  referenceDate: '2026-10-01'
});
assert.deepEqual(directRetrievalOptions.authorities, ['ACRA'],
  'A directly supplied IFRS issue uses the existing reviewed Singapore accounting adapter.');
assert.deepEqual(directRetrievalOptions.topicIds, reconciledIssue.mappedTopicIds);
assert.equal(directResult.workstreams[0]?.authority, 'ACCOUNTING_STANDARDS');
assert.equal(directResult.workstreams[0]?.issues[0]?.evidenceStatus, 'INSUFFICIENT',
  'Alias routing alone does not admit unsupported accounting evidence.');
assert.equal(directResult.workstreams[0]?.issues[0]?.lifecycle.retrievalAttempted, true,
  'The canonical workstream reaches the configured default local retriever.');
assert.equal(directResult.gaps.some(gap => gap.code === 'PROVIDER_UNAVAILABLE'), false,
  'An accepted IFRS accounting issue must not fail because its provider is unavailable.');
assert.ok(directResult.gaps.length > 0,
  'The mapped workstream attempted its provider and retained its evidence gate.');

const ssoIssue = { ...reconciledIssue, id: 'sso-accounting', governingAuthorities: ['SSO'] };
const ssoResult = await buildAuthorityWorkstreams(query, {
  source: 'SEMANTIC_ISSUES', issues: [ssoIssue], coverageEstablished: true, hasUnmappedResidual: false
}, { referenceDate: '2026-10-01' });
assert.equal(ssoResult.workstreams[0]?.authority, 'SSO');
assert.ok(ssoResult.gaps.some(gap => gap.code === 'ISSUE_UNMAPPED'),
  'SSO remains intentionally unsupported and cannot borrow the accounting provider route.');

const unknownResult = await buildAuthorityWorkstreams('An unresolved accounting issue.', {
  source: 'SEMANTIC_ISSUES',
  issues: [{ ...reconciledIssue, id: 'unknown-accounting', domain: 'UNKNOWN', governingAuthorities: ['UNKNOWN'], mappedTopicIds: [], status: 'UNRESOLVED', unresolvedReason: 'UNKNOWN_DOMAIN' }],
  coverageEstablished: false,
  hasUnmappedResidual: true
}, { referenceDate: '2026-10-01' });
assert.equal(unknownResult.workstreams.length, 0);
assert.ok(unknownResult.gaps.some(gap => gap.code === 'NO_GOVERNING_AUTHORITY'),
  'UNKNOWN remains without a governing provider route.');

const reliefCases = [
  {
    id: 'explicit-entitlement',
    question: 'Can I claim personal tax relief on my compulsory CPF contributions?',
    subject: 'individual entitlement to personal tax relief for compulsory CPF contributions',
    operation: 'CHECK_ELIGIBILITY', facts: true, evidence: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'
  },
  {
    id: 'explicit-amount',
    question: 'How much personal tax relief can I claim for compulsory CPF contributions?',
    subject: 'numeric amount of individual tax relief for compulsory CPF contributions',
    operation: 'CALCULATE', facts: true, evidence: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'
  },
  {
    id: 'ambiguous-entitlement',
    question: 'What can I claim for CPF relief?',
    subject: 'individual entitlement to CPF relief',
    operation: 'CHECK_ELIGIBILITY', facts: true, evidence: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'
  },
  {
    id: 'general-rule',
    question: 'How does CPF personal tax relief work generally?',
    subject: 'general principles for personal income tax relief on CPF contributions',
    operation: 'EXPLAIN_RULE', facts: false, evidence: 'AUTHORITATIVE_SOURCE'
  },
  {
    id: 'cap-interaction',
    question: 'How does CPF relief interact with the SGD 80,000 personal relief cap?',
    subject: 'interaction between CPF relief and the personal relief cap',
    operation: 'EXPLAIN_INTERACTION', facts: false, evidence: 'AUTHORITATIVE_SOURCE'
  },
  {
    id: 'salary-is-fact',
    question: 'I earn SGD 6,000 monthly. What can I claim for personal tax relief on compulsory CPF?',
    subject: 'individual entitlement to personal tax relief for compulsory CPF contributions',
    operation: 'CHECK_ELIGIBILITY', facts: true, evidence: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS', salaryFact: true
  },
  {
    id: 'salary-and-amount-requested',
    question: 'I earn SGD 6,000 monthly. How much personal tax relief can I claim for compulsory CPF?',
    subject: 'numeric amount of individual tax relief for compulsory CPF contributions',
    operation: 'CALCULATE', facts: true, evidence: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS', salaryFact: true
  },
  {
    id: 'transaction-treatment',
    question: 'For a compulsory CPF contribution already paid, what is its personal income-tax treatment?',
    subject: 'tax treatment of a supplied compulsory CPF contribution',
    operation: 'DETERMINE_TREATMENT', facts: true, evidence: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'
  }
];

let capturedReliefPrompt = '';
for (const testCase of reliefCases) {
  const issue = {
    subject: testCase.subject,
    population: 'INDIVIDUAL',
    domain: 'IRAS_INCOME_TAX',
    governingAuthorities: ['IRAS'],
    contextualAuthorities: ['CPF'],
    operation: testCase.operation,
    mappedTopicIds: [],
    evidenceRequirement: testCase.evidence,
    confidence: 0.96
  };
  const interpretation = {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: ['IRAS'],
    contextualAuthorities: ['CPF'],
    domain: 'IRAS_INCOME_TAX',
    population: 'INDIVIDUAL',
    primarySubject: testCase.subject,
    concepts: [{ concept: 'personal CPF relief', role: 'PRIMARY' }],
    requestedOperation: testCase.operation,
    requiresUserSpecificFacts: testCase.facts,
    factsExplicitlyProvided: testCase.salaryFact ? ['SGD 6,000 monthly salary'] : [],
    confidence: 0.96,
    issues: [issue]
  };
  const understandingResult = await interpretSemanticQuestion(testCase.question, 'test-semantic-relief-provider-key', async prompt => {
    if (testCase.id === 'explicit-entitlement') capturedReliefPrompt = prompt;
    return JSON.stringify(interpretation);
  });
  assert.equal(understandingResult.mode, 'SEMANTIC_INTERPRETATION', `${testCase.id}: strict wire validation accepts the adjudicated contract.`);
  assert.equal(understandingResult.interpretation.issues[0].operation, testCase.operation);
  assert.equal(understandingResult.interpretation.calculationRequested, testCase.operation === 'CALCULATE');
  const casePlan = reconcileQuestionUnderstanding(testCase.question, classifyQuestion(testCase.question), understandingResult).issuePlan;
  assert.equal(casePlan.issues[0].operation, testCase.operation, `${testCase.id}: reconciliation preserves the requested result.`);
  assert.equal(casePlan.issues[0].evidenceRequirement, testCase.evidence, `${testCase.id}: evidence gate follows the operation.`);
  if (testCase.salaryFact) {
    assert.deepEqual(understandingResult.interpretation.factsExplicitlyProvided, ['SGD 6,000 monthly salary']);
    assert.equal(understandingResult.interpretation.calculationRequested, testCase.operation === 'CALCULATE',
      'A salary fact alone does not set the calculation flag.');
  }
}
assert.match(capturedReliefPrompt, /"what can I claim\?" or "can I claim\?" asks entitlement/i);
assert.match(capturedReliefPrompt, /"how much can I claim\?" asks an amount \(CALCULATE\)/i);
assert.match(capturedReliefPrompt, /A number merely included as a case fact or illustration is not a calculation/i);
assert.equal(capturedReliefPrompt.length < 9_000, true, 'The generic relief contract stays within the established prompt budget.');

console.log('Semantic authority and relief contract regressions passed.');
