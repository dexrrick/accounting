import assert from 'node:assert/strict';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { defaultQueryTopicResolver } from '../../src/retrieval/queryTopicResolver.ts';
import {
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';

const conjunctionQuery = "Our Singapore company paid SGD 900 for the director's private holiday and recorded it as travel expense. What is its corporate income-tax treatment?";
const punctuationQuery = "Our Singapore company paid SGD 900 for the director's private holiday; recorded it as travel expense. What is its corporate income-tax treatment?";
const requiredPrivateExpenseTopics = ['iras-cit-deductibility', 'iras-cit-disallowed-expenses'];

function interpretationFor(extraIssues = []) {
  return {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: ['IRAS'],
    contextualAuthorities: [],
    domain: 'IRAS_INCOME_TAX',
    population: 'COMPANY',
    primarySubject: 'Director private holiday travel expense corporate income-tax treatment',
    concepts: [],
    requestedOperation: 'DETERMINE_TREATMENT',
    factsExplicitlyProvided: [],
    confidence: 0.96,
    issues: [{
      subject: 'Director private holiday travel expense corporate income-tax treatment',
      population: 'COMPANY',
      domain: 'IRAS_INCOME_TAX',
      governingAuthorities: ['IRAS'],
      contextualAuthorities: [],
      operation: 'DETERMINE_TREATMENT',
      mappedTopicIds: [],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS',
      confidence: 0.96
    }, ...extraIssues]
  };
}

function resolve(query, extraIssues = []) {
  const interpretation = interpretationFor(extraIssues);
  assert.ok(validateSemanticQuestionInterpretation(interpretation, query), 'Fixture satisfies the schema-v2 contract.');
  return reconcileQuestionUnderstanding(query, classifyQuestion(query), {
    mode: 'SEMANTIC_INTERPRETATION',
    interpretation
  });
}

function assertCoveredByOneIssue(query, label) {
  const decomposition = defaultQueryTopicResolver.decomposeQuery(query);
  assert.deepEqual(decomposition.topics.map(topic => topic.id).sort(), requiredPrivateExpenseTopics,
    `${label}: both topics remain recognized.`);
  assert.deepEqual(decomposition.unresolvedTopics, [], `${label}: factual conjunction creates no residual.`);

  const reconciled = resolve(query);
  assert.equal(reconciled.issuePlan.issues.length, 1, `${label}: one semantic issue covers both topics.`);
  assert.deepEqual(reconciled.issuePlan.issues[0].mappedTopicIds, requiredPrivateExpenseTopics,
    `${label}: the issue maps both independently recognized topics.`);
  assert.equal(reconciled.issuePlan.coverageEstablished, true, `${label}: coverage is complete.`);
  assert.equal(reconciled.issuePlan.hasUnmappedResidual, false, `${label}: no planning residual remains.`);
  return reconciled.issuePlan.issues[0].mappedTopicIds;
}

const conjunctionMappedTopics = assertCoveredByOneIssue(conjunctionQuery, 'Factual conjunction');
const punctuationMappedTopics = assertCoveredByOneIssue(punctuationQuery, 'Punctuation-equivalent facts');
assert.deepEqual(punctuationMappedTopics, conjunctionMappedTopics, 'Punctuation-equivalent form produces the same mapping.');

const foreignIncomeQuery = `${conjunctionQuery} and what is the Singapore tax treatment of a foreign dividend?`;
const foreignIncome = resolve(foreignIncomeQuery);
assert.equal(foreignIncome.issuePlan.coverageEstablished, false, 'An additional foreign-income ask keeps coverage incomplete.');
assert.equal(foreignIncome.issuePlan.hasUnmappedResidual, true, 'An additional foreign-income ask remains a residual.');
assert.ok(foreignIncome.issuePlan.issues.some(issue => issue.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC' &&
  issue.mappedTopicIds.includes('iras-foreign-sourced-income')),
  'The separately recognized foreign-income topic remains explicitly unassigned.');

const unsupportedConjunction = `${conjunctionQuery.slice(0, -1)}, and what widget registry reporting obligations apply?`;
const unsupportedPunctuation = `${conjunctionQuery} What widget registry reporting obligations apply?`;
const additionalPunctuatedRequests = [
  ['Unsupported punctuated request', unsupportedPunctuation],
  ['Provide request after primary question', `${conjunctionQuery} Provide the widget registry reporting obligations.`],
  ['Confirm request after primary question', `${conjunctionQuery} Confirm the widget registry reporting obligations.`],
  ['Polite request after primary question', `${conjunctionQuery} Please provide the widget registry reporting obligations.`],
  ['Unknown material after primary question', `${conjunctionQuery} Widget registry reporting obligations.`]
];
assert.ok(defaultQueryTopicResolver.decomposeQuery(unsupportedConjunction).unresolvedTopics.length > 0,
  'An unsupported conjunction request remains a query residual.');
for (const [label, query] of additionalPunctuatedRequests) {
  assert.ok(defaultQueryTopicResolver.decomposeQuery(query).unresolvedTopics.length > 0,
    `${label}: added text after the first request remains a query residual.`);
  const reconciled = resolve(query);
  assert.equal(reconciled.issuePlan.coverageEstablished, false, `${label}: coverage stays incomplete.`);
  assert.equal(reconciled.issuePlan.hasUnmappedResidual, true, `${label}: unknown material stays fail-closed.`);
}

const unsupportedOutcomeQuery = `${conjunctionQuery} Prepare a journal entry for the director's private travel expense.`;
const unsupportedAccountingIssue = {
  subject: "Journal entry to record the director's private travel expense",
  population: 'COMPANY',
  domain: 'ACCOUNTING',
  governingAuthorities: ['ACCOUNTING_STANDARDS'],
  contextualAuthorities: [],
  operation: 'PREPARE_JOURNAL',
  mappedTopicIds: [],
  evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS',
  confidence: 0.96
};
const unsupportedOutcomeDecomposition = defaultQueryTopicResolver.decomposeQuery(unsupportedOutcomeQuery);
assert.ok(unsupportedOutcomeDecomposition.unresolvedTopics.some(fragment => /prepare a journal entry/i.test(fragment)),
  'An unsupported requested outcome remains a query residual.');
const unsupportedOutcome = resolve(unsupportedOutcomeQuery, [unsupportedAccountingIssue]);
assert.equal(unsupportedOutcome.issuePlan.coverageEstablished, false, 'Unsupported journal work keeps coverage incomplete.');
assert.ok(unsupportedOutcome.issuePlan.issues.some(issue => issue.domain === 'ACCOUNTING' &&
  issue.status === 'UNRESOLVED' && issue.unresolvedReason === 'NO_COVERAGE_TOPIC'),
  'An unsupported requested outcome stays explicitly unresolved.');

const fallback = reconcileQuestionUnderstanding(unsupportedConjunction, classifyQuestion(unsupportedConjunction), {
  mode: 'DETERMINISTIC_FALLBACK',
  failure: 'NO_PROVIDER'
});
assert.equal(fallback.issuePlan.coverageEstablished, false, 'Deterministic fallback remains fail-closed.');
assert.equal(fallback.issuePlan.hasUnmappedResidual, true, 'Deterministic fallback retains unsupported material as residual.');

console.log('Factual conjunction residual regression passed.');
