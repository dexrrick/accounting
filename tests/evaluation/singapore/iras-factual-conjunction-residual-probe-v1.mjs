import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { irasResolverCases } from '../../fixtures/irasResolverCases.mjs';
import { classifyQuestion } from '../../../src/classification/questionClassifier.ts';
import { defaultQueryTopicResolver } from '../../../src/retrieval/queryTopicResolver.ts';
import {
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../../src/services/semanticQuestionUnderstanding.ts';

const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');
const privateFixture = irasResolverCases.find(item => item.id === 'private-holiday-expense');
assert.ok(privateFixture?.issues?.length === 1, 'Expected the frozen private-expense fixture');

function makeValidatedUnderstanding(query, issueInput) {
  const issue = {
    subject: issueInput.subject,
    population: issueInput.population,
    domain: issueInput.domain,
    governingAuthorities: ['IRAS'],
    contextualAuthorities: [],
    operation: issueInput.operation,
    mappedTopicIds: [],
    evidenceRequirement: issueInput.facts
      ? 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'
      : 'AUTHORITATIVE_SOURCE',
    confidence: 0.96
  };
  const interpretation = {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: ['IRAS'],
    contextualAuthorities: [],
    domain: issue.domain,
    population: issue.population,
    primarySubject: issue.subject,
    concepts: [{ concept: issue.subject, role: 'PRIMARY' }],
    requestedOperation: issue.operation,
    factsExplicitlyProvided: [],
    confidence: 0.96,
    issues: [issue]
  };
  const validated = validateSemanticQuestionInterpretation(interpretation, query);
  assert.ok(validated, 'Synthetic interpretation must pass the normal semantic validator');
  return { mode: 'SEMANTIC_INTERPRETATION', interpretation };
}

function measure(caseId, query, issueInput) {
  const decomposition = defaultQueryTopicResolver.decomposeQuery(query);
  const reconciled = reconcileQuestionUnderstanding(
    query,
    classifyQuestion(query),
    makeValidatedUnderstanding(query, issueInput)
  );
  const issues = reconciled.issuePlan.issues.map(issue => ({
    status: issue.status,
    topicIds: [...issue.mappedTopicIds].sort(),
    ...(issue.unresolvedReason ? { unresolvedReason: issue.unresolvedReason } : {})
  }));
  return {
    caseId,
    querySha256: sha256(query),
    resolver: {
      topicIds: decomposition.topics.map(topic => topic.id).sort(),
      unresolvedFragmentCount: decomposition.unresolvedTopics.length,
      unresolvedFragmentSha256: decomposition.unresolvedTopics.map(sha256).sort()
    },
    issuePlan: {
      source: reconciled.issuePlan.source,
      issueCount: issues.length,
      issues,
      hasUnmappedResidual: reconciled.issuePlan.hasUnmappedResidual,
      coverageEstablished: reconciled.issuePlan.coverageEstablished
    }
  };
}

const privateIssue = privateFixture.issues[0];
const privateQuery = privateFixture.query;
const punctuationQuery = privateQuery.replace(
  ' and recorded it as travel expense.',
  '; recorded it as travel expense.'
);
assert.notEqual(punctuationQuery, privateQuery, 'Paired punctuation transform must apply');

const privateConjunction = measure('private_fixture_factual_and', privateQuery, privateIssue);
const privatePunctuation = measure('private_fixture_punctuation_control', punctuationQuery, privateIssue);

const secondTopicQuery = `${privateQuery} and what is the Singapore tax treatment of a foreign dividend?`;
const independentSecondTopic = measure('independent_second_topic_control', secondTopicQuery, privateIssue);

assert.deepEqual(privateConjunction.resolver.topicIds, [
  'iras-cit-deductibility', 'iras-cit-disallowed-expenses'
]);
assert.equal(privateConjunction.resolver.unresolvedFragmentCount, 2);
assert.equal(privateConjunction.issuePlan.issueCount, 1);
assert.equal(privateConjunction.issuePlan.issues[0].status, 'MAPPED');
assert.deepEqual(privateConjunction.issuePlan.issues[0].topicIds, [
  'iras-cit-deductibility', 'iras-cit-disallowed-expenses'
]);
assert.equal(privateConjunction.issuePlan.hasUnmappedResidual, true);
assert.equal(privateConjunction.issuePlan.coverageEstablished, false);

assert.deepEqual(privatePunctuation.resolver.topicIds, privateConjunction.resolver.topicIds);
assert.equal(privatePunctuation.resolver.unresolvedFragmentCount, 0);
assert.equal(privatePunctuation.issuePlan.issueCount, 1);
assert.deepEqual(privatePunctuation.issuePlan.issues[0].topicIds, privateConjunction.issuePlan.issues[0].topicIds);
assert.equal(privatePunctuation.issuePlan.hasUnmappedResidual, false);
assert.equal(privatePunctuation.issuePlan.coverageEstablished, true);

assert.ok(independentSecondTopic.resolver.topicIds.includes('iras-foreign-sourced-income'));
assert.ok(independentSecondTopic.issuePlan.issues.some(issue =>
  issue.status === 'UNRESOLVED' && issue.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC' &&
  issue.topicIds.includes('iras-foreign-sourced-income')
));
assert.equal(independentSecondTopic.issuePlan.hasUnmappedResidual, true);
assert.equal(independentSecondTopic.issuePlan.coverageEstablished, false);

const report = {
  probe: 'iras-factual-conjunction-residual-probe-v1',
  mode: 'PRE_FIX_API_FREE_DIAGNOSIS',
  evidenceScope: {
    resolver: 'exported defaultQueryTopicResolver.decomposeQuery',
    reconciliation: 'exported classifyQuestion + reconcileQuestionUnderstanding',
    semanticInput: 'locally constructed schema-v2 interpretation accepted by validateSemanticQuestionInterpretation',
    queryMaterial: 'FROZEN_FIXTURE_IN_MEMORY_PLUS_SYNTHETIC_CONTROLS',
    networkCalls: 0,
    modelCalls: 0,
    rawQuestionsPersisted: false,
    rawResidualTextPersisted: false,
    semanticSubjectsPersisted: false
  },
  cases: [privateConjunction, privatePunctuation, independentSecondTopic],
  interpretation: {
    observedBoundary: 'FACTUAL_CONJUNCTION_SPLIT_TO_UNRESOLVED_FRAGMENTS',
    punctuationControl: 'SAME_TOPIC_IDS_AND_MAPPED_ISSUE_RESIDUAL_CLEARED',
    punctuationTransform: 'CONJUNCTION_REPLACED_WITH_SEMICOLON_ONLY',
    controls: ['OMITTED_SECOND_TOPIC_UNASSIGNED'],
    limits: [
      'PUNCTUATION_RESULT_IS_CASE_SPECIFIC',
      'EXTRA_REQUEST_CONTROL_IS_SYNTHETIC',
      'DOES_NOT_ESTABLISH_MODEL_INTERPRETATION_CAUSALITY',
      'DOES_NOT_VALIDATE_TAX_TREATMENT'
    ]
  }
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
