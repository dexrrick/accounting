import assert from 'node:assert/strict';
import { buildAuthorityWorkstreams, planAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { getRequestedQuestionConcepts } from '../../src/services/semanticQuestionUnderstanding.ts';
import { matchesRequestedQuestionConcept } from '../../src/retrieval/evidenceQualityGate.ts';

const referenceDate = '2026-09-29';
const cpfCeiling = UNIFIED_SOURCE_REGISTRY.CPF_WAGE_CEILINGS_2026;
const section14 = UNIFIED_SOURCE_REGISTRY.ITA_SEC14_GENERAL_DEDUCTION;
const irasPointer = UNIFIED_SOURCE_REGISTRY.IRAS_CIT_EXPENSES_SOURCE_MAP;
assert.ok(cpfCeiling && section14 && irasPointer, 'Expected reviewed source registry records are available.');

const issue = (id, overrides = {}) => ({
  id,
  subject: 'CPF ordinary wage monthly ceiling',
  population: 'EMPLOYER',
  domain: 'CPF_PAYROLL',
  governingAuthorities: ['CPF'],
  contextualAuthorities: [],
  operation: 'EXPLAIN_RULE',
  mappedTopicIds: ['cpf_wage_ceiling'],
  evidenceRequirement: 'AUTHORITATIVE_SOURCE',
  confidence: 0.96,
  status: 'MAPPED',
  ...overrides
});
const issuePlan = (issues, overrides = {}) => ({
  source: 'SEMANTIC_ISSUES',
  issues,
  coverageEstablished: true,
  hasUnmappedResidual: false,
  ...overrides
});
const exactClaim = record => ({
  text: record.sourceText,
  recordId: record.id,
  quote: record.sourceText,
  supportKind: 'EXACT_SOURCE_QUOTE'
});
const provider = (authority, retrieve) => ({ authority, retrieve });

// Mapped IRAS topics determine the canonical tax area before population or the
// broader legacy income-tax label; source domains remain source-section metadata.
const areaIssues = [
  issue('cpf-relief', {
    subject: 'employee personal income tax relief for compulsory CPF contributions',
    population: 'EMPLOYEE', domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'],
    contextualAuthorities: ['CPF'], mappedTopicIds: ['iras-individual-cpf-relief']
  }),
  issue('company-benefit', {
    subject: 'company employee housing benefit tax treatment',
    population: 'COMPANY', domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'],
    mappedTopicIds: ['iras-employment-benefits']
  }),
  issue('employer-reporting', {
    subject: 'employer IR21 tax clearance reporting',
    population: 'EMPLOYER', domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'],
    mappedTopicIds: ['iras-employer-ir21']
  }),
  issue('corporate-tax', {
    subject: 'company corporate tax expense deductibility',
    population: 'COMPANY', domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'],
    mappedTopicIds: ['iras-cit-deductibility']
  })
];
const plannedAreas = planAuthorityWorkstreams(issuePlan(areaIssues));
assert.deepEqual(new Set(plannedAreas.map(item => item.domain)), new Set([
  'IRAS_INDIVIDUAL_TAX', 'IRAS_EMPLOYMENT_BENEFITS', 'IRAS_EMPLOYER_REPORTING', 'IRAS_CORPORATE_TAX'
]));
assert.equal(plannedAreas.some(item => item.authority === 'CPF'), false,
  'A contextual authority must not become a requested workstream.');
assert.ok(plannedAreas.find(item => item.domain === 'IRAS_EMPLOYER_REPORTING').sourceSections.includes('IRAS_EMPLOYER_TAX'),
  'Employer tax source collection remains section metadata.');
const conflictingAreas = planAuthorityWorkstreams(issuePlan([issue('conflict', {
  subject: 'company corporate and employee benefit tax treatment',
  domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], population: 'COMPANY',
  mappedTopicIds: ['iras-cit-deductibility', 'iras-employment-benefits']
})]));
assert.equal(conflictingAreas[0].domain, 'UNKNOWN', 'Conflicting mapped IRAS areas fail closed.');

// The existing reviewed CPF wage ceiling is an eligible positive local proof.
// It remains separate from the independently incomplete IRAS stream.
const cpfRetriever = { retrieveSources: async () => [cpfCeiling] };
const cpfResult = await buildAuthorityWorkstreams(
  'Explain the CPF ordinary wage monthly ceiling in 2026.',
  issuePlan([issue('cpf-valid')]),
  { retriever: cpfRetriever, localOnly: true, referenceDate }
);
assert.equal(cpfResult.workstreams[0].evidenceStatus, 'VERIFIED');
assert.equal(cpfResult.workstreams[0].issues[0].evidenceStatus, 'VERIFIED');
assert.equal(cpfResult.workstreams[0].sources[0].id, 'CPF_WAGE_CEILINGS_2026');
assert.equal(cpfResult.workstreams[0].verifiedClaims[0].supportKind, 'EXACT_SOURCE_QUOTE');
assert.equal(cpfResult.status, 'VERIFIED');
const conditionalCase = await buildAuthorityWorkstreams(
  'Check whether the CPF ordinary wage monthly ceiling applies in 2026.',
  issuePlan([issue('cpf-case-facts', {
    operation: 'CHECK_ELIGIBILITY', evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'
  })]),
  { retriever: cpfRetriever, localOnly: true, referenceDate }
);
assert.equal(conditionalCase.evidenceStatus, 'VERIFIED');
assert.equal(conditionalCase.applicationStatus, 'UNRESOLVED');
assert.equal(conditionalCase.status, 'CONDITIONAL');
assert.match(conditionalCase.workstreams[0].issues[0].applicationReason, /relevant facts and statutory conditions still need to be established/);
assert.doesNotMatch(conditionalCase.workstreams[0].issues[0].applicationReason, /\b(?:age|salary amount)\b/i,
  'The coarse application flag must not invent a specific missing fact.');

// A successful CPF issue cannot stand in for the IRAS issue in the same full
// question. Both providers receive the untouched query with issue-local topics.
const combinedQuery = 'Explain the CPF ordinary wage monthly ceiling and corporate income tax deductibility under Section 14 for expenses wholly and exclusively incurred in production of income.';
const scopedRequests = [];
const combinedMultiResult = await buildAuthorityWorkstreams(combinedQuery, issuePlan([
  issue('combined-cpf'),
  issue('combined-iras', {
    subject: 'corporate tax deductibility under Section 14 for business expenses',
    population: 'COMPANY', domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'],
    contextualAuthorities: ['CPF'], mappedTopicIds: ['cit_section_14']
  })
]), {
  providers: {
    CPF: provider('CPF', async request => {
      scopedRequests.push(request);
      return { candidates: [cpfCeiling], claims: [exactClaim(cpfCeiling)] };
    }),
    IRAS: provider('IRAS', async request => {
      scopedRequests.push(request);
      return { candidates: [], claims: [], trace: { stages: [{ stage: 'LOCAL_VERIFIED', status: 'EXHAUSTED', reason: 'No local source.' }] } };
    })
  },
  referenceDate
});
assert.equal(combinedMultiResult.workstreams.find(item => item.authority === 'CPF').evidenceStatus, 'VERIFIED');
assert.equal(combinedMultiResult.workstreams.find(item => item.authority === 'IRAS').evidenceStatus, 'INSUFFICIENT');
assert.equal(combinedMultiResult.status, 'INSUFFICIENT');
assert.equal(scopedRequests.length, 2);
assert.ok(scopedRequests.every(request => request.originalQuery === combinedQuery), 'The original full query is retained for both providers.');
assert.deepEqual(scopedRequests.find(request => request.issue.id === 'combined-cpf').retrievalIntent.topicIds, ['cpf_wage_ceiling']);
assert.deepEqual(scopedRequests.find(request => request.issue.id === 'combined-iras').retrievalIntent.topicIds, ['cit_section_14']);

// IRAS uses the established grounding and claim-verification path with a local
// reviewed source. Its result is evaluated independently of the CPF result.
const irasIssue = issue('iras-valid', {
  subject: 'wholly and exclusively incurred business expenses in production of income',
  population: 'COMPANY', domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'],
  contextualAuthorities: [], mappedTopicIds: ['cit_section_14']
});
const irasResult = await buildAuthorityWorkstreams(
  'Explain corporate income tax deductibility under Section 14 for expenses wholly and exclusively incurred in production of income.',
  issuePlan([irasIssue]),
  { retriever: { retrieveSources: async () => [section14] }, localOnly: true, referenceDate }
);
assert.equal(irasResult.workstreams[0].domain, 'IRAS_CORPORATE_TAX');
assert.equal(irasResult.workstreams[0].evidenceStatus, 'VERIFIED');
assert.deepEqual(irasResult.workstreams[0].sources.map(record => record.id), ['ITA_SEC14_GENERAL_DEDUCTION']);
assert.equal(irasResult.workstreams[0].verifiedClaims[0].supportKind, 'EXACT_SOURCE_QUOTE');

// Exact canonical payload, correct authority/domain and substantive scoped text
// are all required. Shared words, a wrong authority/domain, and altered payloads
// cannot turn a candidate into admitted evidence.
for (const [name, candidate] of [
  ['wrong authority', { ...cpfCeiling, authority: 'IRAS' }],
  ['wrong domain', { ...cpfCeiling, domain: 'IRAS_TAX' }],
  ['generic shared words', { ...cpfCeiling, sourceText: 'Businesses, taxes, employees, companies, and contributions.' }]
]) {
  const rejected = await buildAuthorityWorkstreams(
    'Explain the CPF ordinary wage monthly ceiling in 2026.', issuePlan([issue(name)]),
    { providers: { CPF: provider('CPF', async () => ({ candidates: [candidate], claims: [exactClaim(candidate)] })) }, referenceDate }
  );
  assert.equal(rejected.workstreams[0].issues[0].evidenceStatus, 'INSUFFICIENT', `${name} must be rejected.`);
  assert.equal(rejected.workstreams[0].sources.length, 0, `${name} must not appear as a source.`);
}

// A source-map pointer and successful-looking search metadata are routing data,
// not evidence. Malformed providers and failures are isolated to their issue.
const pointerResult = await buildAuthorityWorkstreams(
  'Explain corporate income tax deductibility under Section 14.',
  issuePlan([irasIssue]),
  { providers: { IRAS: provider('IRAS', async () => ({
    candidates: [irasPointer], claims: [exactClaim(irasPointer)],
    evidenceQualityTrace: { attempts: [{ topicId: 'iras-cit-deductibility', fetchStatus: 'SUCCESS', titleMatched: true, contentMatched: true, finalUrl: irasPointer.officialSourceUrl }] },
    trace: { stages: [{ stage: 'OFFICIAL_DOMAIN_SEARCH', status: 'SUFFICIENT', reason: 'url is not evidence' }] }
  })) }, referenceDate }
);
assert.equal(pointerResult.workstreams[0].issues[0].evidenceStatus, 'INSUFFICIENT');
assert.equal(pointerResult.workstreams[0].sources.length, 0);

const isolatedProvider = provider('CPF', async request => {
  if (request.issue.id === 'malformed-candidates') return { candidates: {} };
  if (request.issue.id === 'malformed-claims') return { candidates: [cpfCeiling], claims: {} };
  if (request.issue.id === 'provider-failure') throw new Error('sensitive provider text');
  return { candidates: [cpfCeiling], claims: [exactClaim(cpfCeiling)] };
});
const isolated = await buildAuthorityWorkstreams(
  'Explain the CPF ordinary wage monthly ceiling in 2026.',
  issuePlan([
    issue('malformed-candidates'), issue('malformed-claims'), issue('provider-failure'), issue('provider-success')
  ]),
  { providers: { CPF: isolatedProvider }, referenceDate }
);
const issuesById = new Map(isolated.workstreams[0].issues.map(item => [item.issueId, item]));
assert.equal(issuesById.get('provider-success').evidenceStatus, 'VERIFIED');
for (const id of ['malformed-candidates', 'malformed-claims', 'provider-failure']) {
  assert.equal(issuesById.get(id).evidenceStatus, 'INSUFFICIENT', `${id} should fail locally.`);
  assert.ok(issuesById.get(id).gaps.some(gap => gap.code === 'PROVIDER_ERROR'));
  assert.equal(JSON.stringify(issuesById.get(id)).includes('sensitive provider text'), false);
}

// Topicless relief-ordering concepts stay in the material concept set, and
// only explicit ordering language satisfies the dedicated verifier.
const combinedReliefQuery = 'Compare CPF and SRS relief, the overall personal income tax relief cap, and the order of relief claims.';
const priorityConcept = getRequestedQuestionConcepts(combinedReliefQuery).find(item => item.id === 'relief_claim_prioritization');
assert.ok(priorityConcept, 'The material prioritization concept is recognized.');
assert.equal(matchesRequestedQuestionConcept('Employees may claim CPF and SRS tax relief.', priorityConcept), false);
assert.equal(matchesRequestedQuestionConcept('There is no fixed priority for personal tax relief claims.', priorityConcept), true);
let retainedConceptIds = [];
const combinedIssue = issue('combined-reliefs', {
  subject: 'individual CPF and SRS relief, overall relief cap, and ordering of claims',
  population: 'EMPLOYEE', domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'],
  mappedTopicIds: ['iras-individual-cpf-relief', 'iras-individual-srs-relief', 'iras-individual-relief-cap']
});
const combinedResult = await buildAuthorityWorkstreams(
  combinedReliefQuery,
  issuePlan([combinedIssue]),
  { providers: { IRAS: provider('IRAS', async request => {
    retainedConceptIds = request.retrievalIntent.requestedConcepts.map(item => item.id);
    return { candidates: [section14], claims: [exactClaim(section14)] };
  }) }, referenceDate }
);
assert.ok(retainedConceptIds.includes('relief_claim_prioritization'), 'Topicless ordering stays in scoped issue intent.');
assert.equal(combinedResult.workstreams[0].issues[0].evidenceStatus, 'INSUFFICIENT',
  'A quote without the ordering rule cannot establish complete relief coverage.');

// Empty, unresolved, fallback, and residual plans remain incomplete even if a
// separate issue happens to have a verified quotation.
const empty = await buildAuthorityWorkstreams('Explain a CPF rule.', issuePlan([]));
assert.equal(empty.status, 'INSUFFICIENT');
assert.equal(empty.evidenceStatus, 'INSUFFICIENT');
for (const incompletePlan of [
  issuePlan([issue('fallback')], { source: 'TAXONOMY_FALLBACK', coverageEstablished: false }),
  issuePlan([issue('residual')], { hasUnmappedResidual: true })
]) {
  const result = await buildAuthorityWorkstreams(
    'Explain the CPF ordinary wage monthly ceiling in 2026.', incompletePlan,
    { retriever: cpfRetriever, localOnly: true, referenceDate }
  );
  assert.equal(result.workstreams[0].issues[0].evidenceStatus, 'VERIFIED');
  assert.equal(result.evidenceStatus, 'INSUFFICIENT');
  assert.equal(result.status, 'INSUFFICIENT');
}

console.log('Authority workstream evidence isolation and coverage tests passed.');
