import assert from 'node:assert/strict';
import { irasResolverCases } from '../fixtures/irasResolverCases.mjs';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { getCoverageTopicsByIds, IRAS_SOURCE_MAP_DEFINITIONS } from '../../src/standards/coverageRegistry.ts';
import { defaultQueryTopicResolver } from '../../src/retrieval/queryTopicResolver.ts';
import { reconcileQuestionUnderstanding, validateSemanticQuestionInterpretation } from '../../src/services/semanticQuestionUnderstanding.ts';
import { planAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';

function interpretationFor(testCase) {
  const isSingle = testCase.issues.length === 1;
  const first = testCase.issues[0];
  const authorityCandidates = isSingle ? [first.authority] : ['UNKNOWN'];
  const domain = isSingle ? first.domain : 'UNKNOWN';
  const population = isSingle ? first.population : 'UNKNOWN';
  const requestedOperation = isSingle ? first.operation : 'OTHER';
  const subjects = testCase.issues.map(issue => issue.subject);

  return {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates,
    contextualAuthorities: [],
    domain,
    population,
    primarySubject: subjects.join('; '),
    concepts: subjects.map((concept, index) => ({ concept, role: index === 0 ? 'PRIMARY' : 'RELATED' })),
    requestedOperation,
    factsExplicitlyProvided: [],
    confidence: 0.96,
    issues: testCase.issues.map(issue => ({
      subject: issue.subject,
      population: issue.population,
      domain: issue.domain,
      governingAuthorities: [issue.authority],
      contextualAuthorities: [],
      operation: issue.operation,
      mappedTopicIds: [],
      evidenceRequirement: issue.facts ? 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' : 'AUTHORITATIVE_SOURCE',
      confidence: 0.96
    }))
  };
}

function registryDomainsForIssue(issue) {
  if (issue.domain === 'IRAS_INCOME_TAX') {
    if (issue.population === 'COMPANY' || issue.population === 'FUND') return ['IRAS_CORPORATE_TAX'];
    if (issue.population === 'INDIVIDUAL') return ['IRAS_INDIVIDUAL_TAX'];
    if (issue.population === 'EMPLOYEE') return ['IRAS_INDIVIDUAL_TAX', 'IRAS_EMPLOYER_TAX'];
    if (issue.population === 'EMPLOYER') return ['IRAS_EMPLOYER_TAX'];
  }
  if (issue.domain === 'IRAS_GST') return ['IRAS_GST'];
  if (issue.domain === 'ACCOUNTING') return ['ACCOUNTING_SFRS', 'ACCOUNTING_FRS', 'ACCOUNTING_SMALL_ENTITIES'];
  if (issue.domain === 'ACRA_CORPORATE') return ['ACRA_COMPANIES', 'ACRA_VCC', 'ACRA_CSP'];
  if (issue.domain === 'CPF_PAYROLL') return ['CPF_CONTRIBUTIONS', 'CPF_PAYROLL_LEVIES'];
  return [];
}

function traceIssueMapping(query, issue) {
  const queryTopicIds = new Set(defaultQueryTopicResolver.decomposeQuery(query).topics.map(topic => topic.id));
  const subjectTopicIds = defaultQueryTopicResolver.decomposeQuery(issue.subject).topics.map(topic => topic.id);
  const subjectTopics = getCoverageTopicsByIds(subjectTopicIds);
  const domains = new Set(registryDomainsForIssue(issue));
  const domainAndPopulationTopicIds = subjectTopics
    .filter(topic => domains.has(topic.domainId))
    .map(topic => topic.id);
  const authorityTopicIds = getCoverageTopicsByIds(domainAndPopulationTopicIds)
    .filter(topic => topic.authorities.includes(issue.authority))
    .map(topic => topic.id);
  return {
    queryTopicIds: [...queryTopicIds].sort(),
    subjectTopicIds: [...new Set(subjectTopicIds)].sort(),
    domainAndPopulationTopicIds: [...new Set(domainAndPopulationTopicIds)].sort(),
    authorityTopicIds: [...new Set(authorityTopicIds)].sort(),
    intersectionTopicIds: authorityTopicIds.filter(topicId => queryTopicIds.has(topicId)).sort()
  };
}

function substantiveIntersectionTopicIds(trace) {
  const eligibleSubjectTopics = getCoverageTopicsByIds(trace.authorityTopicIds);
  const childOwnedRoutingParents = new Set();
  for (const child of eligibleSubjectTopics) {
    for (const parentId of child.routingParentTopicIds || []) {
      const parent = getCoverageTopicsByIds([parentId])[0];
      if (parent?.routingOnly && parent.domainId === child.domainId &&
          parent.routingChildTopicIds?.includes(child.id) && child.routingParentTopicIds.includes(parent.id) &&
          parent.authorities.some(authority => child.authorities.includes(authority))) {
        childOwnedRoutingParents.add(parent.id);
      }
    }
  }
  return trace.intersectionTopicIds.filter(topicId => !childOwnedRoutingParents.has(topicId));
}

for (const testCase of irasResolverCases) {
  const queryTopics = defaultQueryTopicResolver.decomposeQuery(testCase.query).topics.map(topic => topic.id);
  const tracedIssues = testCase.issues.map(issue => ({ issue, trace: traceIssueMapping(testCase.query, issue) }));
  const fixtureInterpretation = interpretationFor(testCase);
  assert.ok(validateSemanticQuestionInterpretation(fixtureInterpretation, testCase.query),
    `${testCase.id}: synthetic semantic fixture matches the V2 wire contract`);
  const reconciled = reconcileQuestionUnderstanding(testCase.query, classifyQuestion(testCase.query), {
    mode: 'SEMANTIC_INTERPRETATION',
    interpretation: fixtureInterpretation
  });
  assert.equal(reconciled.issuePlan.source, 'SEMANTIC_ISSUES',
    `${testCase.id}: reconciled mapping uses the valid synthetic issue contract`);

  const plannedWorkstreams = planAuthorityWorkstreams(reconciled.issuePlan);
  const mappedIssues = reconciled.issuePlan.issues.filter(issue => issue.unresolvedReason !== 'UNASSIGNED_QUERY_TOPIC');
  assert.equal(mappedIssues.length, testCase.issues.length, `${testCase.id}: issue count is preserved`);
  for (let index = 0; index < testCase.issues.length; index += 1) {
    const expected = testCase.issues[index];
    const actual = mappedIssues[index];
    const trace = tracedIssues[index].trace;
    assert.equal(actual.subject, expected.subject, `${testCase.id}: semantic issue order is preserved`);
    assert.deepEqual(actual.mappedTopicIds, substantiveIntersectionTopicIds(trace),
      `${testCase.id}: production substantive mapping matches the lexical intersection after child-owned routing parents are removed`);
  }

  if (['target-relief-entitlement', 'target-relief-amount', 'A-paraphrase-2'].includes(testCase.id)) {
    const cpfRelief = mappedIssues.find(issue => issue.mappedTopicIds.includes('iras-individual-cpf-relief'));
    assert.ok(cpfRelief, `${testCase.id}: specific CPF relief remains substantively mapped`);
    assert.equal(cpfRelief.mappedTopicIds.includes('iras-individual-reliefs'), false,
      `${testCase.id}: umbrella is not substantive child evidence scope`);
    assert.deepEqual(cpfRelief.routingTopicIds, ['iras-individual-reliefs'],
      `${testCase.id}: complete child scope records its reciprocal routing parent explicitly`);
    assert.equal(reconciled.issuePlan.coverageEstablished, true, `${testCase.id}: bounded ownership establishes coverage`);
    assert.equal(reconciled.issuePlan.hasUnmappedResidual, false, `${testCase.id}: no false umbrella residual remains`);
  }

  for (const topicId of testCase.requiredTopicIds) {
    assert.ok(queryTopics.includes(topicId), `${testCase.id}: query candidates include ${topicId}`);
    assert.ok(tracedIssues.some(item => item.trace.subjectTopicIds.includes(topicId)),
      `${testCase.id}: a semantic issue subject candidate includes ${topicId}`);
    assert.ok(mappedIssues.some(issue => issue.mappedTopicIds.includes(topicId)),
      `${testCase.id}: issue-level intersection maps ${topicId}`);
    if (testCase.issues.some(issue => issue.authority === 'IRAS')) {
      assert.ok(IRAS_SOURCE_MAP_DEFINITIONS.some(map => map.topicIds.includes(topicId)),
        `${testCase.id}: ${topicId} has an existing IRAS source-map pointer`);
    }
  }
  for (const topicId of testCase.forbiddenTopicIds) {
    assert.ok(!mappedIssues.some(issue => issue.mappedTopicIds.includes(topicId)),
      `${testCase.id}: unrelated ${topicId} does not survive issue-level filtering`);
  }
  for (const topicId of testCase.forbiddenCandidateTopicIds || []) {
    assert.ok(!queryTopics.includes(topicId), `${testCase.id}: query does not recognize unrelated ${topicId}`);
    assert.ok(!tracedIssues.some(item => item.trace.subjectTopicIds.includes(topicId)),
      `${testCase.id}: semantic-style subject does not recognize unrelated ${topicId}`);
    assert.ok(!tracedIssues.some(item => item.trace.domainAndPopulationTopicIds.includes(topicId)),
      `${testCase.id}: unrelated ${topicId} does not survive domain/population filtering`);
    assert.ok(!tracedIssues.some(item => item.trace.authorityTopicIds.includes(topicId)),
      `${testCase.id}: unrelated ${topicId} does not survive authority filtering`);
  }
  if (testCase.forbidCorporateTaxResidual) {
    assert.ok(!plannedWorkstreams.some(stream => stream.authority === 'IRAS' && stream.domain === 'IRAS_CORPORATE_TAX'),
      `${testCase.id}: unrelated expense wording creates no corporate income-tax workstream`);
    assert.ok(!reconciled.issuePlan.issues.some(issue => issue.domain === 'IRAS_INCOME_TAX' && issue.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC'),
      `${testCase.id}: unrelated expense wording leaves no corporate-tax issue residual`);
  }
  if (testCase.noIrasRoute) {
    assert.ok(!queryTopics.some(id => id.startsWith('iras-')), `${testCase.id}: no IRAS topic leaks from accounting-only wording`);
    assert.ok(!mappedIssues.some(issue => issue.mappedTopicIds.some(id => id.startsWith('iras-'))),
      `${testCase.id}: accounting issue receives no IRAS route`);
    assert.ok(!plannedWorkstreams.some(stream => stream.authority === 'IRAS'),
      `${testCase.id}: reconciled issue plan has no IRAS workstream`);
  }

  if (testCase.assertIssueIntersection) {
    const nonIrasIssue = mappedIssues.find(issue => !issue.governingAuthorities.includes('IRAS'));
    const irasIssue = mappedIssues.find(issue => issue.governingAuthorities.includes('IRAS'));
    assert.ok(nonIrasIssue && irasIssue, `${testCase.id}: distinct authority issues remain distinct`);
    assert.ok(!nonIrasIssue.mappedTopicIds.some(id => id.startsWith('iras-')),
      `${testCase.id}: non-IRAS issue does not inherit an IRAS topic`);
    assert.ok(testCase.requiredTopicIds.every(id => irasIssue.mappedTopicIds.includes(id)),
      `${testCase.id}: IRAS issue retains its expected IRAS topic`);
  }
}

process.stdout.write(`IRAS natural-language resolver: ${irasResolverCases.length} cases passed.\n`);
