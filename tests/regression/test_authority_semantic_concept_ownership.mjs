import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  getRequestedQuestionConcepts,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';

const referenceDate = '2026-10-20';
const acraAnnualPage = JSON.parse(await readFile(
  new URL('../fixtures/acra-company-guidance-2026-10-10.json', import.meta.url), 'utf8'
)).find(page => page.name === 'annual');
assert.ok(acraAnnualPage, 'The retained official ACRA annual-return source is available.');

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

function semanticIssue({ authority, domain, population, subject, topicId }) {
  return {
    subject, population, domain, governingAuthorities: [authority], contextualAuthorities: [],
    operation: 'EXPLAIN_RULE', mappedTopicIds: [topicId], evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.98
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

const provider = (authority, retrieve) => ({ authority, retrieve });

async function runBoundedCase(sample, issues = [sample.issue], understanding = sample.understanding, providerResults = {}) {
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
          return providerResults[authority] || { candidates: [], claims: [] };
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
    const expectedRequestedIds = sample.authority === 'MAS'
      ? ['mas_cms_licence_definition', related.id]
      : [related.id];
    assert.deepEqual(requests[0].retrievalIntent.requestedConcepts.map(concept => concept.id).sort(), expectedRequestedIds.sort(),
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
  const mixedIssues = [
    issue({ id: 'mixed-acra', authority: 'ACRA', domain: 'ACRA_CORPORATE', population: 'COMPANY',
      subject: 'annual return filing requirements for Singapore companies', topicId: 'acra_annual-returns' }),
    issue({ id: 'mixed-mom', authority: 'MOM', domain: 'MOM_EMPLOYMENT', population: 'EMPLOYEE',
      subject: 'Part IV coverage for employees working overtime', topicId: 'mom-part-iv-overtime' })
  ];
  const mixedUnderstanding = understandingFor({
    authorityCandidates: ['ACRA', 'MOM'], domain: 'UNKNOWN', population: 'UNKNOWN',
    primarySubject: 'annual return filing and Part IV overtime coverage',
    concepts: ['filing requirement', 'Part IV coverage'],
    issues: mixedIssues.map(item => semanticIssue({
      authority: item.governingAuthorities[0], domain: item.domain, population: item.population,
      subject: item.subject, topicId: item.mappedTopicIds[0]
    }))
  });
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

  const sharedQuestions = [
    {
      name: 'ACRA + CPF',
      query: 'What annual return filing requirements apply to Singapore companies? Separately, how are ordinary wages treated for CPF contributions?',
      understanding: understandingFor({ authorityCandidates: ['ACRA', 'CPF'], domain: 'UNKNOWN', population: 'UNKNOWN',
        primarySubject: 'annual return filing and CPF ordinary wages', concepts: ['filing requirement', 'ordinary wage definition',
          'CPF contributions'],
        issues: [
          semanticIssue({ authority: 'ACRA', domain: 'ACRA_CORPORATE', population: 'COMPANY',
            subject: 'annual return filing requirements for Singapore companies', topicId: 'acra_annual-returns' }),
          semanticIssue({ authority: 'CPF', domain: 'CPF_PAYROLL', population: 'EMPLOYER',
            subject: 'CPF ordinary wages and contribution treatment', topicId: 'cpf-ordinary-wages' })
        ] }),
      issues: [
        issue({ id: 'shared-acra', authority: 'ACRA', domain: 'ACRA_CORPORATE', population: 'COMPANY',
          subject: 'annual return filing requirements for Singapore companies', topicId: 'acra_annual-returns' }),
        issue({ id: 'shared-cpf', authority: 'CPF', domain: 'CPF_PAYROLL', population: 'EMPLOYER',
          subject: 'CPF ordinary wages and contribution treatment', topicId: 'cpf-ordinary-wages' })
      ],
      expected: { 'shared-acra': ['filing requirement'], 'shared-cpf': ['ordinary wage definition'] }
    },
    {
      name: 'MOM + MAS',
      query: 'What Part IV coverage applies for working hours and overtime, and what is the general licensing requirement for a Capital Markets Services Licence?',
      understanding: understandingFor({ authorityCandidates: ['MOM', 'MAS'], domain: 'UNKNOWN', population: 'UNKNOWN',
        primarySubject: 'Part IV coverage and Capital Markets Services Licence', concepts: ['Part IV coverage',
          'working hours and overtime', 'licensing requirement'],
        issues: [
          semanticIssue({ authority: 'MOM', domain: 'MOM_EMPLOYMENT', population: 'EMPLOYEE',
            subject: 'Part IV coverage for employees working hours and overtime', topicId: 'mom-part-iv-overtime' }),
          semanticIssue({ authority: 'MAS', domain: 'MAS_FUNDS', population: 'COMPANY',
            subject: 'Capital Markets Services Licence general licensing requirement', topicId: 'mas-cms-licence' })
        ] }),
      issues: [
        issue({ id: 'shared-mom', authority: 'MOM', domain: 'MOM_EMPLOYMENT', population: 'EMPLOYEE',
          subject: 'Part IV coverage for employees working hours and overtime', topicId: 'mom-part-iv-overtime' }),
        issue({ id: 'shared-mas', authority: 'MAS', domain: 'MAS_FUNDS', population: 'COMPANY',
          subject: 'Capital Markets Services Licence general licensing requirement', topicId: 'mas-cms-licence' })
      ],
      expected: { 'shared-mom': ['Part IV coverage'], 'shared-mas': ['licensing requirement'] }
    },
    {
      name: 'IRAS residency + relief + GST',
      query: 'Under Singapore tax rules, how is a company tax resident based on control and management? Separately, what is the overall personal income tax relief cap? Also, under IRAS GST rules, what is the input tax treatment for passenger cars? Explain the general IRAS restriction and relevant exceptions.',
      understanding: understandingFor({ authorityCandidates: ['IRAS'], domain: 'UNKNOWN', population: 'UNKNOWN',
        primarySubject: 'company tax residency, personal tax relief cap and passenger car input tax restriction',
        concepts: ['control and management test', 'personal income tax relief cap', 'IRAS restriction'],
        issues: [
          semanticIssue({ authority: 'IRAS', domain: 'IRAS_INCOME_TAX', population: 'COMPANY',
            subject: 'company tax residency based on control and management', topicId: 'iras-corporate-tax-residency' }),
          semanticIssue({ authority: 'IRAS', domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL',
            subject: 'overall personal income tax relief cap', topicId: 'iras-individual-relief-cap' }),
          semanticIssue({ authority: 'IRAS', domain: 'IRAS_GST', population: 'COMPANY',
            subject: 'passenger car input tax restriction', topicId: 'iras-gst-blocked-input-tax' })
        ] }),
      issues: [
        issue({ id: 'shared-iras-residency', authority: 'IRAS', domain: 'IRAS_INCOME_TAX', population: 'COMPANY',
          subject: 'company tax residency based on control and management', topicId: 'iras-corporate-tax-residency' }),
        issue({ id: 'shared-iras-relief', authority: 'IRAS', domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL',
          subject: 'overall personal income tax relief cap', topicId: 'iras-individual-relief-cap' }),
        issue({ id: 'shared-iras-gst', authority: 'IRAS', domain: 'IRAS_GST', population: 'COMPANY',
          subject: 'passenger car input tax restriction', topicId: 'iras-gst-blocked-input-tax' })
      ],
      expected: {
        'shared-iras-residency': ['control and management test'],
        'shared-iras-relief': ['Overall personal income tax relief cap'],
        'shared-iras-gst': ['Blocked input tax on passenger motor cars']
      }
    }
  ];
  for (const sample of sharedQuestions) {
    const { result, requests } = await runBoundedCase({ query: sample.query }, sample.issues, sample.understanding);
    assert.equal(requests.length, sample.issues.length, `${sample.name} retains one scoped retrieval per requested issue.`);
    for (const [issueId, expectedLabels] of Object.entries(sample.expected)) {
      const actualLabels = requests.find(request => request.issue.id === issueId)
        .retrievalIntent.requestedConcepts.map(concept => concept.label).sort();
      assert.deepEqual(actualLabels, [...expectedLabels].sort(), `${sample.name} binds concepts to their local raw clause.`);
    }
    assert.equal(result.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'), false,
      `${sample.name} has no extra unrouted material concept: ${JSON.stringify(result.gaps.filter(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT').map(gap => gap.subject))}`);
    assert.equal(result.status, 'INSUFFICIENT', `${sample.name} remains evidence-insufficient without sources.`);
  }

  const separatelyIntroducedIrasRestrictionQuery = sharedQuestions[2].query.replace(
    'Explain the general IRAS restriction and relevant exceptions.',
    'Separately, explain the general IRAS restriction and relevant exceptions.'
  );
  const { result: separatelyIntroducedIrasRestriction } = await runBoundedCase(
    { query: separatelyIntroducedIrasRestrictionQuery }, sharedQuestions[2].issues, sharedQuestions[2].understanding
  );
  assert.ok(separatelyIntroducedIrasRestriction.gaps.some(gap =>
    gap.code === 'UNROUTED_MATERIAL_CONCEPT' && /IRAS restriction/i.test(gap.subject)),
  'A separately introduced generic restriction ask is not absorbed by the preceding GST issue.');

  const unknownBetweenKnownRequests = {
    ...sharedQuestions[0],
    query: 'What annual return filing requirements apply to Singapore companies? Explain university coverage. Separately, what are CPF ordinary wages?',
    understanding: understandingFor({ authorityCandidates: ['ACRA', 'CPF'], domain: 'UNKNOWN', population: 'UNKNOWN',
      primarySubject: 'annual return filing, university coverage and CPF ordinary wages',
      concepts: ['filing requirement', 'university coverage', 'ordinary wage definition'] })
  };
  const { result: unknownMixedResult, requests: unknownMixedRequests } = await runBoundedCase(
    { query: unknownBetweenKnownRequests.query }, unknownBetweenKnownRequests.issues, unknownBetweenKnownRequests.understanding
  );
  assert.ok(unknownMixedResult.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT' && gap.subject === 'university coverage'),
    'A new coverage object between known clauses remains an explicit unresolved concept.');
  assert.ok(!unknownMixedRequests.flatMap(request => request.retrievalIntent.requestedConcepts)
    .some(concept => concept.label === 'university coverage'),
  'The unknown concept is not attached to the nearby MOM/CPF topic by shared generic vocabulary.');

  const independentPayrollConcepts = getRequestedQuestionConcepts(
    'How are ordinary wages treated for CPF contributions? Separately, what CPF contribution rate applies?',
    understandingFor({ authorityCandidates: ['CPF'], domain: 'UNKNOWN', population: 'UNKNOWN',
      primarySubject: 'ordinary wages and CPF contribution rates',
      concepts: ['CPF contributions', 'CPF contribution rate'],
      issues: [
        semanticIssue({ authority: 'CPF', domain: 'CPF_PAYROLL', population: 'EMPLOYER',
          subject: 'ordinary wages and CPF contributions', topicId: 'cpf-ordinary-wages' }),
        semanticIssue({ authority: 'CPF', domain: 'CPF_PAYROLL', population: 'EMPLOYER',
          subject: 'CPF contribution rates', topicId: 'cpf_contribution_rates' })
      ] })
  );
  assert.ok(independentPayrollConcepts.some(concept => concept.label === 'CPF contribution rate'),
    'An explicitly separate CPF rate request remains material beside ordinary-wage context.');

  const cpfContextUnderstanding = understandingFor({ authorityCandidates: ['CPF'], domain: 'CPF_PAYROLL', population: 'EMPLOYER',
    primarySubject: 'ordinary wages for CPF contributions', concepts: ['CPF contributions'],
    issues: [semanticIssue({ authority: 'CPF', domain: 'CPF_PAYROLL', population: 'EMPLOYER',
      subject: 'ordinary wages for CPF contributions', topicId: 'cpf-ordinary-wages' })] });
  const separateCpfExplanation = getRequestedQuestionConcepts(
    'How are ordinary wages treated for CPF contributions? Separately, explain CPF contributions. Do not calculate contribution amounts.',
    cpfContextUnderstanding
  );
  assert.ok(separateCpfExplanation.some(concept => concept.label === 'CPF contributions'),
    'An explicit separate explanation remains material despite a later negative calculation instruction.');
  const negativeSeparateCpfExplanation = getRequestedQuestionConcepts(
    'How are ordinary wages treated for CPF contributions? Separately, do not explain CPF contributions.',
    cpfContextUnderstanding
  );
  assert.equal(negativeSeparateCpfExplanation.some(concept => concept.label === 'CPF contributions'), false,
    'A separately introduced negative explanation instruction does not create a CPF contributions ask.');

  const independentOvertimeConcepts = getRequestedQuestionConcepts(
    'What Part IV coverage applies for working hours and overtime? Separately, what overtime rates must employers pay?',
    understandingFor({ authorityCandidates: ['MOM'], domain: 'UNKNOWN', population: 'UNKNOWN',
      primarySubject: 'Part IV coverage and overtime pay rates',
      concepts: ['working hours and overtime', 'overtime rates'],
      issues: [
        semanticIssue({ authority: 'MOM', domain: 'MOM_EMPLOYMENT', population: 'EMPLOYEE',
          subject: 'Part IV coverage for working hours and overtime', topicId: 'mom-part-iv-overtime' }),
        semanticIssue({ authority: 'MOM', domain: 'MOM_EMPLOYMENT', population: 'EMPLOYER',
          subject: 'overtime rates payable by employers', topicId: 'mom-part-iv-overtime' })
      ] })
  );
  assert.ok(independentOvertimeConcepts.some(concept => concept.label === 'overtime rates'),
    'An explicitly separate overtime-rate request remains material beside Part IV coverage context.');

  const momContextUnderstanding = understandingFor({ authorityCandidates: ['MOM'], domain: 'MOM_EMPLOYMENT', population: 'EMPLOYEE',
    primarySubject: 'Part IV coverage for working hours and overtime', concepts: ['working hours and overtime'],
    issues: [semanticIssue({ authority: 'MOM', domain: 'MOM_EMPLOYMENT', population: 'EMPLOYEE',
      subject: 'Part IV coverage for working hours and overtime', topicId: 'mom-part-iv-overtime' })] });
  const separateOvertimeExplanation = getRequestedQuestionConcepts(
    'What Part IV coverage applies for working hours and overtime? Separately, explain working hours and overtime, but do not calculate amounts.',
    momContextUnderstanding
  );
  assert.ok(separateOvertimeExplanation.some(concept => concept.label === 'working hours and overtime'),
    'An explicit separate explanation remains material despite a later negative calculation instruction.');
  const negativeSeparateOvertimeExplanation = getRequestedQuestionConcepts(
    'What Part IV coverage applies for working hours and overtime? Separately, do not explain working hours and overtime.',
    momContextUnderstanding
  );
  assert.equal(negativeSeparateOvertimeExplanation.some(concept => concept.label === 'working hours and overtime'), false,
    'A separately introduced negative explanation instruction does not create an overtime ask.');

  for (const exactContextCase of [
    {
      query: 'Under CPF Board guidance, what makes a payment ordinary wages for CPF contributions? Explain the general definition using official CPF Board guidance. Do not calculate contribution rates or amounts and do not create journal entries.',
      authority: 'CPF', domain: 'CPF_PAYROLL', population: 'EMPLOYER',
      subject: 'ordinary wages definition for CPF contributions', topicId: 'cpf-ordinary-wages',
      contextLabel: 'CPF contributions', requestedLabel: 'ordinary wage definition'
    },
    {
      query: 'Under MOM guidance, which employees are covered by Part IV of the Employment Act for working hours and overtime? Explain the general coverage using official MOM guidance. Do not calculate pay or create journal entries.',
      authority: 'MOM', domain: 'MOM_EMPLOYMENT', population: 'EMPLOYEE',
      subject: 'Part IV employee coverage', topicId: 'mom-part-iv-overtime',
      contextLabel: 'working hours and overtime', requestedLabel: 'Part IV coverage'
    }
  ]) {
    const exactUnderstanding = understandingFor({
      authorityCandidates: [exactContextCase.authority], domain: exactContextCase.domain,
      population: exactContextCase.population, primarySubject: exactContextCase.subject,
      concepts: [exactContextCase.requestedLabel, exactContextCase.contextLabel],
      issues: [semanticIssue({ ...exactContextCase })]
    });
    const exactConcepts = getRequestedQuestionConcepts(exactContextCase.query, exactUnderstanding);
    assert.ok(exactConcepts.some(concept => concept.label === exactContextCase.requestedLabel),
      `${exactContextCase.authority} retains the affirmative definition or coverage request in its exact frozen wording.`);
    assert.equal(exactConcepts.some(concept => concept.label === exactContextCase.contextLabel), false,
      `${exactContextCase.authority} qualifying context is not an additional request in its exact frozen wording.`);
    const mixedExactQuery = `${exactContextCase.query} Separately, must Singapore companies file annual returns under ACRA guidance?`;
    const mixedExactUnderstanding = {
      ...exactUnderstanding,
      interpretation: {
        ...exactUnderstanding.interpretation,
        authorityCandidates: [exactContextCase.authority, 'ACRA'], domain: 'UNKNOWN', population: 'UNKNOWN',
        issues: [...exactUnderstanding.interpretation.issues, semanticIssue({ authority: 'ACRA',
          domain: 'ACRA_CORPORATE', population: 'COMPANY', subject: 'annual return filing duty for Singapore companies',
          topicId: 'acra_annual-returns' })]
      }
    };
    const mixedExactConcepts = getRequestedQuestionConcepts(mixedExactQuery, mixedExactUnderstanding);
    assert.ok(mixedExactConcepts.some(concept => concept.label === exactContextCase.requestedLabel));
    assert.equal(mixedExactConcepts.some(concept => concept.label === exactContextCase.contextLabel), false,
      `${exactContextCase.authority} exact qualifying context stays local in a mixed question.`);
  }

  const momEmployeeCoverageQuery = 'Under MOM guidance, which employees are covered by Part IV of the Employment Act for working hours and overtime? Explain the general coverage using official MOM guidance. Do not calculate pay or create journal entries.';
  const momEmployeeCoverageIssue = issue({ id: 'mom-employee-coverage', authority: 'MOM',
    domain: 'MOM_EMPLOYMENT', population: 'EMPLOYEE', subject: 'Part IV employee coverage',
    topicId: 'mom-part-iv-overtime' });
  const momEmployeeCoverageUnderstanding = understandingFor({ authorityCandidates: ['MOM'],
    domain: 'MOM_EMPLOYMENT', population: 'EMPLOYEE', primarySubject: momEmployeeCoverageIssue.subject,
    concepts: ['employee coverage'] });
  const momEmployeeCoverageResult = await runBoundedCase({ query: momEmployeeCoverageQuery,
    issue: momEmployeeCoverageIssue, understanding: momEmployeeCoverageUnderstanding });
  assert.ok(momEmployeeCoverageResult.requests[0].retrievalIntent.requestedConcepts.some(concept =>
    concept.label === 'employee coverage'),
  'The bounded employee-coverage paraphrase is owned by the mapped MOM Part IV issue.');
  assert.equal(momEmployeeCoverageResult.result.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'), false,
    'Recognized MOM coverage wording does not remain as an unowned material concept.');

  // Exact saved model-response bytes from retained MOM capture "mom" (observed
  // 2026-10-23; source bodies and unavailable original fetch attempts are not
  // embedded in this fixture). This replays semantic ownership only.
  const momQuestion = 'Under MOM guidance, which employees are covered by Part IV of the Employment Act for working hours and overtime? Explain the general coverage using official MOM guidance. Do not calculate pay or create journal entries.';
  const savedMomResponse = JSON.parse(await readFile(
    new URL('../fixtures/retained-mom-semantic-response.json', import.meta.url), 'utf8'
  ));
  const savedMomInterpretationText = savedMomResponse.candidates?.[0]?.content?.parts?.[0]?.text;
  assert.equal(typeof savedMomInterpretationText, 'string', 'The retained raw MOM model response contains its original semantic payload.');
  const savedMomInterpretation = validateSemanticQuestionInterpretation(JSON.parse(savedMomInterpretationText), momQuestion);
  assert.ok(savedMomInterpretation, 'The exact retained MOM semantic payload passes the current structural validator.');
  assert.deepEqual(savedMomInterpretation.authorityCandidates, ['MOM', 'SSO']);
  assert.deepEqual(savedMomInterpretation.issues?.map(item => item.governingAuthorities), [['MOM']],
    'The SSO authority candidate remains publisher context; the source issue is governed only by MOM.');
  const savedMomIssue = issue({ id: 'retained-mom-issue', authority: 'MOM', domain: 'MOM_EMPLOYMENT',
    population: 'EMPLOYEE', subject: savedMomInterpretation.issues[0].subject, topicId: 'mom-part-iv-overtime' });
  const savedMomRequests = [];
  const savedMomUnderstanding = {
    mode: 'SEMANTIC_INTERPRETATION', assessmentStatus: 'PASSED', interpretation: savedMomInterpretation
  };
  const savedMomResult = await buildAuthorityWorkstreams(momQuestion, issuePlan([savedMomIssue]), {
    referenceDate,
    questionUnderstanding: savedMomUnderstanding,
    providers: { MOM: provider('MOM', async request => {
      savedMomRequests.push(request);
      return { candidates: [], claims: [] };
    }) }
  });
  assert.equal(savedMomRequests.length, 1, 'The retained semantic replay dispatches one MOM issue only.');
  const savedMomRequestedLabels = savedMomRequests[0].retrievalIntent.requestedConcepts.map(concept => concept.label);
  assert.ok(savedMomRequestedLabels.includes('Part IV coverage'),
    'The source-backed coverage concept is bound to the compatible MOM clause.');
  assert.equal(savedMomRequestedLabels.some(label => /Singapore Statutes Online|\bSSO\b/i.test(label)), false,
    'A publisher role is not converted into an independent SSO evidence request.');
  assert.equal(savedMomResult.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'), false,
    `The saved Employment Act and working-hours/overtime context stays locally represented without absorbing SSO: ${JSON.stringify(savedMomResult.gaps)}`);

  const fullNameSsoQuery = `${momQuestion} Separately, what does Singapore Statutes Online publish?`;
  const fullNameSsoInterpretation = validateSemanticQuestionInterpretation({
    ...savedMomInterpretation,
    primarySubject: 'Employment Act Part IV coverage and Singapore Statutes Online',
    concepts: [...savedMomInterpretation.concepts, { concept: 'Singapore Statutes Online', role: 'RELATED' }]
  }, fullNameSsoQuery);
  assert.ok(fullNameSsoInterpretation, 'The separate full-name publisher ask remains structurally valid.');
  const fullNameSsoRequests = [];
  const fullNameSsoResult = await buildAuthorityWorkstreams(fullNameSsoQuery, issuePlan([savedMomIssue]), {
    referenceDate,
    questionUnderstanding: { mode: 'SEMANTIC_INTERPRETATION', assessmentStatus: 'PASSED',
      interpretation: fullNameSsoInterpretation },
    providers: { MOM: provider('MOM', async request => {
      fullNameSsoRequests.push(request);
      return { candidates: [], claims: [] };
    }) }
  });
  assert.equal(fullNameSsoRequests.length, 1);
  assert.equal(fullNameSsoRequests[0].retrievalIntent.requestedConcepts.some(concept =>
    /Singapore Statutes Online/i.test(concept.label)), false,
  'A separately asked Singapore Statutes Online publisher question cannot be absorbed into the MOM coverage issue.');
  assert.ok(fullNameSsoResult.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'),
    'Independent publisher content stays explicitly unresolved when no publisher-governed issue exists.');

  const acraAnnualDutyQuery = 'Under ACRA guidance, must Singapore companies file annual returns? Explain the general filing duty using official ACRA guidance. Do not calculate a deadline or create journal entries.';
  const acraAnnualDutyIssue = issue({ id: 'acra-annual-duty', authority: 'ACRA', domain: 'ACRA_CORPORATE',
    population: 'COMPANY', subject: 'annual return filing duty for Singapore companies', topicId: 'acra_annual-returns' });
  const acraAnnualDutyUnderstanding = understandingFor({ authorityCandidates: ['ACRA'], domain: 'ACRA_CORPORATE',
    population: 'COMPANY', primarySubject: acraAnnualDutyIssue.subject,
    concepts: ['annual returns', 'annual return filing'] });
  const acraDutyQuote = 'All companies registered in Singapore must file an annual return with ACRA each year. This applies as long as your company is listed as “live” with us.';
  const acraDutyHtml = 'All companies registered in Singapore <b>must file</b> an annual return with ACRA each year. This applies as long as your company is listed as “<b>live</b>” with us.';
  const acraAnnualDocumentTitle = acraAnnualPage.html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/&amp;/g, '&').trim();
  assert.ok(acraAnnualDocumentTitle, 'The retained official page title is available from the captured HTML.');
  assert.ok(acraAnnualPage.html.includes(acraDutyHtml), 'The exact qualified duty quote is present in the retained official page.');
  const acraDutyRecordId = 'TEST_CAPTURED_ACRA_ANNUAL_RETURN_DUTY';
  const acraDutyRecord = {
    id: acraDutyRecordId,
    authority: 'ACRA', sourceAuthority: 'ACRA', authorityName: 'Accounting and Corporate Regulatory Authority',
    sourcePublisher: 'Accounting and Corporate Regulatory Authority',
    legalOrStandardInstrument: 'Companies Act 1967',
    documentTitle: acraAnnualDocumentTitle,
    standardOrActCode: 'ACRA_ANNUAL_RETURN_GUIDANCE', paragraphOrSection: 'Annual filing requirements',
    sourceText: acraDutyQuote, principleSummary: 'Companies must file annual returns with ACRA.',
    officialSourceUrl: acraAnnualPage.url, canonicalSourceUrl: acraAnnualPage.url,
    domain: 'ACRA_CORP', jurisdiction: 'Singapore', tags: ['acra_annual-returns'],
    relatedTopicIds: ['acra_annual-returns'], sourceMapTopicIds: [], retrievalHints: [],
    sourceStatus: 'NEEDS_REVIEW', sourceType: 'OFFICIAL_GUIDANCE', evidenceTier: 'OFFICIAL_GUIDANCE',
    isVerbatimText: true, provenance: 'LIVE_EXTERNAL', lifecycleState: 'CANDIDATE',
    extractionStatus: 'PARTIAL', verificationMethod: 'LIVE_OFFICIAL_TOPIC_VERIFIED',
    urlVerificationStatus: 'VERIFIED', documentHash: acraAnnualPage.sourceSha256,
    retrievedAt: '2026-10-23T00:00:00.000Z', recordRole: 'EVIDENCE', groundingEligible: true
  };
  const acraDutyTrace = {
    path: 'DISCOVERED_SOURCE', sourceMapIds: [], selectedRecordIds: [acraDutyRecordId],
    finalVerifiedUrls: [acraAnnualPage.url], candidateOnly: true,
    attempts: [{ topicId: 'acra_annual-returns', fetchStatus: 'SUCCESS', finalUrl: acraAnnualPage.url,
      titleMatched: true, contentMatched: true }]
  };
  const acraDutyResult = await runBoundedCase({ query: acraAnnualDutyQuery }, [acraAnnualDutyIssue], acraAnnualDutyUnderstanding, {
    ACRA: { candidates: [acraDutyRecord], claims: [{ text: acraDutyQuote, quote: acraDutyQuote, recordId: acraDutyRecordId }],
      evidenceQualityTrace: acraDutyTrace }
  });
  assert.equal(acraDutyResult.requests[0].retrievalIntent.requestedConcepts.some(concept => concept.label === 'annual returns'), true,
    'A plain annual-returns semantic descriptor stays with the uniquely scoped ACRA filing-duty issue.');
  assert.equal(acraDutyResult.requests[0].retrievalIntent.requestedConcepts.some(concept => concept.label === 'annual return filing'), true,
    'A plain annual-return-filing label is supported only within the uniquely mapped ACRA filing-duty issue.');
  const acraDutyEvidence = acraDutyResult.result.workstreams[0].issues[0];
  assert.equal(acraDutyEvidence.evidenceStatus, 'VERIFIED',
    `The plain descriptor is covered by the complete qualified official filing-duty quote: ${JSON.stringify({ gaps: acraDutyEvidence.gaps, claims: acraDutyEvidence.verifiedClaims })}`);
  assert.ok(acraDutyEvidence.verifiedClaims.some(claim => claim.quote === acraDutyQuote),
    'Verification retains the full ACRA source quote and its live-company qualification.');

  const capitalizedAcraAnnualDutyQuery = acraAnnualDutyQuery.replace('Singapore companies', 'Singapore Companies');
  const capitalizedAcraDutyResult = await runBoundedCase({ query: capitalizedAcraAnnualDutyQuery },
    [acraAnnualDutyIssue], acraAnnualDutyUnderstanding, {
      ACRA: { candidates: [acraDutyRecord], claims: [{ text: acraDutyQuote, quote: acraDutyQuote, recordId: acraDutyRecordId }],
        evidenceQualityTrace: acraDutyTrace }
    });
  assert.equal(capitalizedAcraDutyResult.result.workstreams[0].issues[0].evidenceStatus, 'VERIFIED',
    'Capitalization of the company-word check does not break a bounded general ACRA duty issue.');
} finally {
  globalThis.fetch = originalFetch;
}

process.stdout.write('Authority semantic concept ownership regressions passed.\n');
