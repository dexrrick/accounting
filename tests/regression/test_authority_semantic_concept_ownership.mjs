import assert from 'node:assert/strict';
import {
  getRequestedQuestionConcepts,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';

const referenceDate = '2026-10-20';

function understandingFor({ authorityCandidates, domain, population, primarySubject, concepts, issues }) {
  return {
    mode: 'SEMANTIC_INTERPRETATION',
    assessmentStatus: 'PASSED',
    interpretation: {
      jurisdiction: ['Singapore'],
      authorityCandidates,
      contextualAuthorities: [],
      domain,
      population,
      primarySubject,
      concepts: concepts.map(concept => ({ concept, role: 'RELATED' })),
      requestedOperation: 'EXPLAIN_RULE',
      requiresUserSpecificFacts: false,
      calculationRequested: false,
      factsExplicitlyProvided: [],
      confidence: 0.98,
      ...(issues ? { issues } : {})
    }
  };
}

function issue({ id, authority, domain, population, subject, topicId, status = 'MAPPED', unresolvedReason }) {
  return {
    id,
    subject,
    population,
    domain,
    governingAuthorities: [authority],
    contextualAuthorities: [],
    operation: 'EXPLAIN_RULE',
    mappedTopicIds: topicId ? [topicId] : [],
    evidenceRequirement: 'AUTHORITATIVE_SOURCE',
    confidence: 0.98,
    status,
    ...(unresolvedReason ? { unresolvedReason } : {})
  };
}

function issuePlan(issues, overrides = {}) {
  return {
    source: 'SEMANTIC_ISSUES',
    issues,
    coverageEstablished: true,
    hasUnmappedResidual: false,
    ...overrides
  };
}

async function runBoundedCase(sample, issues = [sample.issue], understanding = sample.understanding) {
  const requests = [];
  const result = await buildAuthorityWorkstreams(sample.query, issuePlan(issues), {
    referenceDate,
    questionUnderstanding: understanding,
    providers: Object.fromEntries([...new Set(issues.flatMap(item => item.governingAuthorities))]
      .filter(authority => authority !== 'UNKNOWN')
      .map(authority => [authority, {
        authority,
        async retrieve(request) {
          requests.push(request);
          return { candidates: [], claims: [] };
        }
      }]))
  });
  return { result, requests };
}

const samples = [
  {
    authority: 'ACRA', domain: 'ACRA_CORPORATE', population: 'COMPANY',
    query: 'What annual return filing requirements apply to Singapore companies?',
    subject: 'annual return filing duty for Singapore companies',
    concept: 'filing requirement', topicId: 'acra_annual-returns'
  },
  {
    authority: 'CPF', domain: 'CPF_PAYROLL', population: 'EMPLOYER',
    query: 'How are ordinary wages treated for CPF?',
    subject: 'CPF ordinary wage classification',
    concept: 'ordinary wage definition', topicId: 'cpf-ordinary-wages'
  },
  {
    authority: 'MOM', domain: 'MOM_EMPLOYMENT', population: 'EMPLOYEE',
    query: 'What are Part IV overtime eligibility requirements?',
    subject: 'Part IV overtime eligibility and employee coverage',
    concept: 'Part IV coverage', topicId: 'mom-part-iv-overtime'
  },
  {
    authority: 'MAS', domain: 'MAS_FUNDS', population: 'COMPANY',
    query: 'What is a Capital Markets Services Licence and when is it generally required?',
    subject: 'Capital Markets Services Licence and general requirement',
    concept: 'licensing requirement', topicId: 'mas-cms-licence'
  }
].map((sample, index) => ({
  ...sample,
  issue: issue({ id: `bounded-${sample.authority.toLowerCase()}`, ...sample }),
  understanding: understandingFor({
    authorityCandidates: [sample.authority],
    domain: sample.domain,
    population: sample.population,
    primarySubject: sample.subject,
    concepts: [sample.concept]
  })
}));

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('OFFLINE_FETCH_BLOCKED'); };
try {
  for (const sample of samples) {
    assert.ok(validateSemanticQuestionInterpretation(sample.understanding.interpretation, sample.query),
      `${sample.authority} advisory interpretation is valid.`);
    const requested = getRequestedQuestionConcepts(sample.query, sample.understanding);
    const related = requested.find(concept => concept.label === sample.concept);
    assert.ok(related, `${sample.authority} retains its related semantic concept.`);
    assert.deepEqual(related.topicIds, [], 'The concept itself is topicless; the issue has the reviewed topic mapping.');

    const { result, requests } = await runBoundedCase(sample);
    assert.equal(requests.length, 1, `${sample.authority} makes only the injected offline provider call.`);
    assert.deepEqual(requests[0].retrievalIntent.requestedConcepts.map(concept => concept.id), [related.id],
      `${sample.authority} assigns the related concept to its unique mapped issue.`);
    assert.equal(result.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'), false,
      `${sample.authority} does not leave the uniquely owned concept at the top level.`);
    assert.equal(result.workstreams[0].issues[0].evidenceStatus, 'INSUFFICIENT',
      `${sample.authority} remains insufficient without admitted official evidence.`);
    assert.ok(result.workstreams[0].issues[0].gaps.some(gap => gap.code === 'ISSUE_CONCEPT_UNCOVERED'),
      `${sample.authority} requires source support for the newly scoped concept.`);
    assert.equal(result.status, 'INSUFFICIENT');
  }

  const accountingQuery = 'Explain the accounting policy for lease accounting under SFRS(I) 16.';
  const accountingIssue = issue({
    id: 'accounting-lease-policy', authority: 'ACCOUNTING_STANDARDS', domain: 'ACCOUNTING', population: 'COMPANY',
    subject: 'lease accounting policy', topicId: 'sfrsi_leases'
  });
  const accountingUnderstanding = understandingFor({
    authorityCandidates: ['ACCOUNTING_STANDARDS'], domain: 'ACCOUNTING', population: 'COMPANY',
    primarySubject: 'lease accounting policy', concepts: ['accounting policy']
  });
  const { result: accountingResult, requests: accountingRequests } = await runBoundedCase({
    query: accountingQuery, issue: accountingIssue, understanding: accountingUnderstanding
  });
  assert.deepEqual(accountingRequests[0].retrievalIntent.requestedConcepts.map(concept => concept.label), ['accounting policy'],
    'An explicitly scoped accounting topicless concept retains its exact query-and-subject owner.');
  assert.equal(accountingResult.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'), false,
    'The explicitly scoped accounting concept is not left as an unrouted gap.');
  const unknownPopulationAccountingIssue = { ...accountingIssue, id: 'accounting-lease-policy-unknown-population', population: 'UNKNOWN' };
  const { result: unknownPopulationAccountingResult, requests: unknownPopulationAccountingRequests } = await runBoundedCase({
    query: accountingQuery, issue: unknownPopulationAccountingIssue, understanding: accountingUnderstanding
  });
  assert.deepEqual(unknownPopulationAccountingRequests[0].retrievalIntent.requestedConcepts.map(concept => concept.label), ['accounting policy'],
    'An unknown issue population preserves the prior compatible exact-phrase owner.');
  assert.equal(unknownPopulationAccountingResult.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'), false,
    'An unknown population does not leave an otherwise explicitly scoped accounting concept unrouted.');

  const acra = samples[0];
  for (const mismatch of [
    { ...acra.issue, id: 'wrong-authority', governingAuthorities: ['MOM'] },
    { ...acra.issue, id: 'wrong-population', population: 'EMPLOYEE' },
    { ...acra.issue, id: 'wrong-topic', mappedTopicIds: ['acra_accounting-records'] }
  ]) {
    const { result } = await runBoundedCase(acra, [mismatch]);
    assert.ok(result.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'),
      `${mismatch.id} cannot own the concept.`);
    assert.equal(result.workstreams[0].issues[0].lifecycle.covered, false,
      `${mismatch.id} cannot claim concept coverage through its issue mapping.`);
  }

  const unsupportedQuery = 'What general filing requirements apply to Singapore companies?';
  const unsupported = {
    ...acra,
    query: unsupportedQuery,
    concept: 'general requirements',
    issue: { ...acra.issue, id: 'unsupported-generic', subject: 'general company filing requirements' },
    understanding: understandingFor({
      authorityCandidates: ['ACRA'], domain: 'ACRA_CORPORATE', population: 'COMPANY',
      primarySubject: 'general company filing requirements', concepts: ['general requirements']
    })
  };
  const { result: unsupportedResult } = await runBoundedCase(unsupported);
  assert.ok(unsupportedResult.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'),
    'A generic requirement with no topic-specific anchor remains an explicit gap.');

  const ambiguousQuery = 'What annual return filing requirements apply to Singapore companies, and what XBRL filing requirements apply to financial statements?';
  const ambiguous = {
    ...acra,
    query: ambiguousQuery,
    issue: acra.issue,
    understanding: understandingFor({
      authorityCandidates: ['ACRA'], domain: 'ACRA_CORPORATE', population: 'COMPANY',
      primarySubject: 'annual return filing requirements', concepts: ['filing requirement']
    })
  };
  const unresolvedCompetitor = issue({
    id: 'unresolved-xbrl-filing', authority: 'ACRA', domain: 'ACRA_CORPORATE', population: 'COMPANY',
    subject: 'XBRL financial statement filing requirements', status: 'UNRESOLVED', unresolvedReason: 'NO_COVERAGE_TOPIC'
  });
  const { result: ambiguousResult, requests: ambiguousRequests } = await runBoundedCase(
    ambiguous, [ambiguous.issue, unresolvedCompetitor]
  );
  assert.ok(ambiguousResult.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'),
    'A matching unresolved issue participates in ambiguity and keeps the material concept explicit.');
  assert.deepEqual(ambiguousRequests[0].retrievalIntent.requestedConcepts, [],
    'A concept is not attached to the mapped issue when an unresolved issue is also plausible.');

  const mixedQuery = 'What annual return filing requirements apply to Singapore companies, and what Part IV coverage applies to employees working overtime?';
  const mixedUnderstanding = understandingFor({
    authorityCandidates: ['ACRA', 'MOM'], domain: 'UNKNOWN', population: 'UNKNOWN',
    primarySubject: 'annual return filing and Part IV overtime coverage',
    concepts: ['filing requirement', 'Part IV coverage']
  });
  const mixedIssues = [
    issue({ id: 'mixed-acra', authority: 'ACRA', domain: 'ACRA_CORPORATE', population: 'COMPANY',
      subject: 'annual return filing requirements for Singapore companies', topicId: 'acra_annual-returns' }),
    issue({ id: 'mixed-mom', authority: 'MOM', domain: 'MOM_EMPLOYMENT', population: 'EMPLOYEE',
      subject: 'Part IV coverage for employees working overtime', topicId: 'mom-part-iv-overtime' })
  ];
  assert.ok(validateSemanticQuestionInterpretation(mixedUnderstanding.interpretation, mixedQuery),
    'The independent ACRA and MOM advisory interpretation is valid.');
  const { result: mixedResult, requests: mixedRequests } = await runBoundedCase(
    { query: mixedQuery }, mixedIssues, mixedUnderstanding
  );
  assert.equal(mixedRequests.length, 2);
  assert.deepEqual(mixedRequests.find(request => request.issue.id === 'mixed-acra')
    .retrievalIntent.requestedConcepts.map(concept => concept.label), ['filing requirement']);
  assert.deepEqual(mixedRequests.find(request => request.issue.id === 'mixed-mom')
    .retrievalIntent.requestedConcepts.map(concept => concept.label), ['Part IV coverage']);
  assert.equal(mixedResult.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'), false,
    'Independent topicless concepts remain with their own authority issue.');
  assert.equal(mixedResult.status, 'INSUFFICIENT', 'No evidence was supplied for either independent issue.');
} finally {
  globalThis.fetch = originalFetch;
}

process.stdout.write('Authority semantic concept ownership regressions passed.\n');
