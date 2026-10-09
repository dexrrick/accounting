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
const topiclessAreaIssues = [
  issue('topicless-employee-relief', {
    subject: 'employee personal income tax relief for CPF contributions', population: 'EMPLOYEE',
    domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], mappedTopicIds: []
  }),
  issue('topicless-employee-salary', {
    subject: 'employee salary income tax treatment', population: 'EMPLOYEE',
    domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], mappedTopicIds: []
  }),
  issue('topicless-benefit', {
    subject: 'taxability of employee housing benefit', population: 'EMPLOYEE',
    domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], mappedTopicIds: []
  }),
  issue('topicless-accommodation-benefit-for-employee', {
    subject: 'tax treatment of accommodation benefit for employee', population: 'UNKNOWN',
    domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], mappedTopicIds: []
  }),
  issue('topicless-housing-benefit-tax-treatment', {
    subject: 'housing benefit tax treatment for the employee', population: 'UNKNOWN',
    domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], mappedTopicIds: []
  }),
  issue('topicless-benefit-employment-income', {
    subject: 'employee income tax treatment of housing benefit as employment income', population: 'EMPLOYEE',
    domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], mappedTopicIds: []
  }),
  issue('topicless-company-employment-reporting', {
    subject: 'company reporting of foreign employee income tax', population: 'COMPANY',
    domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], mappedTopicIds: []
  }),
  issue('topicless-employer-income-reporting', {
    subject: 'employer employment-income reporting requirements', population: 'COMPANY',
    domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], mappedTopicIds: []
  }),
  issue('topicless-ambiguous-reporting', {
    subject: 'employee income tax reporting for a foreign worker', population: 'EMPLOYEE',
    domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], mappedTopicIds: []
  }),
  issue('topicless-bare-employee', {
    subject: 'employee tax position', population: 'EMPLOYEE',
    domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], mappedTopicIds: []
  }),
  issue('topicless-company-deduction', {
    subject: 'company deductibility of recorded employee benefit expense', population: 'COMPANY',
    domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], mappedTopicIds: []
  })
];
const topiclessPlans = planAuthorityWorkstreams(issuePlan(topiclessAreaIssues));
const topiclessAreas = new Map(topiclessPlans.map(item => [item.id, item.domain]));
const topiclessStreamByIssue = new Map(topiclessPlans.flatMap(stream => stream.issueIds.map(id => [id, stream.id])));
assert.equal(topiclessStreamByIssue.get('topicless-employee-relief'), 'IRAS:IRAS_INDIVIDUAL_TAX');
assert.equal(topiclessStreamByIssue.get('topicless-employee-salary'), 'IRAS:IRAS_INDIVIDUAL_TAX');
assert.equal(topiclessStreamByIssue.get('topicless-benefit'), 'IRAS:IRAS_EMPLOYMENT_BENEFITS');
assert.equal(topiclessStreamByIssue.get('topicless-accommodation-benefit-for-employee'), 'IRAS:IRAS_EMPLOYMENT_BENEFITS');
assert.equal(topiclessStreamByIssue.get('topicless-housing-benefit-tax-treatment'), 'IRAS:IRAS_EMPLOYMENT_BENEFITS');
assert.equal(topiclessStreamByIssue.get('topicless-benefit-employment-income'), 'IRAS:IRAS_EMPLOYMENT_BENEFITS',
  'Housing benefit remains employment-benefit tax when described as employment income.');
assert.equal(topiclessStreamByIssue.get('topicless-company-employment-reporting'), 'IRAS:IRAS_EMPLOYER_REPORTING');
assert.equal(topiclessStreamByIssue.get('topicless-employer-income-reporting'), 'IRAS:IRAS_EMPLOYER_REPORTING',
  'Employer employment-income reporting is not routed to personal salary tax.');
assert.equal(topiclessStreamByIssue.get('topicless-ambiguous-reporting'), 'IRAS:UNKNOWN');
assert.equal(topiclessStreamByIssue.get('topicless-bare-employee'), 'IRAS:UNKNOWN');
assert.equal(topiclessStreamByIssue.get('topicless-company-deduction'), 'IRAS:IRAS_CORPORATE_TAX');
assert.equal(topiclessAreas.get('IRAS:IRAS_INDIVIDUAL_TAX'), 'IRAS_INDIVIDUAL_TAX',
  'Employee personal relief and salary-tax subjects resolve to individual income tax without treating EMPLOYEE as a benefit label.');
assert.equal(topiclessAreas.get('IRAS:IRAS_EMPLOYMENT_BENEFITS'), 'IRAS_EMPLOYMENT_BENEFITS');
assert.equal(topiclessAreas.get('IRAS:IRAS_EMPLOYER_REPORTING'), 'IRAS_EMPLOYER_REPORTING',
  'Explicit company employment reporting remains employer reporting even with population COMPANY.');
assert.equal(topiclessAreas.get('IRAS:UNKNOWN'), 'UNKNOWN',
  'Ambiguous reporting and a bare employee tax subject remain unresolved.');
assert.equal(topiclessAreas.get('IRAS:IRAS_CORPORATE_TAX'), 'IRAS_CORPORATE_TAX',
  'Corporate deductibility remains corporate tax even when the expense concerns an employee benefit.');

const genericIncomeTaxTreatmentQuery = 'Explain corporate income-tax treatment of the expense.';
const genericIncomeTaxTreatmentUnderstanding = {
  mode: 'SEMANTIC_INTERPRETATION',
  interpretation: {
    jurisdiction: ['Singapore'], authorityCandidates: ['IRAS'], contextualAuthorities: [],
    domain: 'IRAS_INCOME_TAX', population: 'COMPANY', primarySubject: 'corporate income-tax treatment',
    concepts: [{ concept: 'corporate income-tax treatment', role: 'PRIMARY' }],
    requestedOperation: 'EXPLAIN_RULE', requiresUserSpecificFacts: false, calculationRequested: false,
    factsExplicitlyProvided: [], confidence: 0.95
  }
};
const runGenericTaxOwnership = async (issues, conceptLabel = 'corporate income-tax treatment', population = 'COMPANY',
  query = genericIncomeTaxTreatmentQuery) => {
  const understanding = {
    ...genericIncomeTaxTreatmentUnderstanding,
    interpretation: {
      ...genericIncomeTaxTreatmentUnderstanding.interpretation,
      primarySubject: conceptLabel,
      population,
      concepts: [{ concept: conceptLabel, role: 'PRIMARY' }]
    }
  };
  const requestedByIssue = new Map();
  const result = await buildAuthorityWorkstreams(query, issuePlan(issues), {
    questionUnderstanding: understanding,
    providers: { IRAS: provider('IRAS', async request => {
      requestedByIssue.set(request.issue.id, request.retrievalIntent.requestedConcepts.map(concept => concept.id));
      return { candidates: [], claims: [] };
    }) },
    referenceDate
  });
  const conceptId = getRequestedQuestionConcepts(query, understanding)
    .find(concept => concept.label === conceptLabel)?.id;
  return { result, requestedByIssue, conceptId };
};
const genericTreatmentIssue = (id, subject) => issue(id, {
  subject, population: 'COMPANY', domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'],
  mappedTopicIds: ['iras-cit-deductibility']
});
const ownedGenericTaxTreatment = await runGenericTaxOwnership([
  genericTreatmentIssue('generic-tax-treatment-owner', 'corporate income-tax treatment of a company expense')
]);
assert.equal(ownedGenericTaxTreatment.result.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'), false,
  'The generic corporate tax label is owned by its sole matching company income-tax issue.');
assert.equal(ownedGenericTaxTreatment.requestedByIssue.get('generic-tax-treatment-owner')
  ?.includes('semantic_corporate_income_tax_treatment') || false, false,
  'The generic tax label is assigned for aggregation, not promoted into a redundant retrieval requirement.');
const ownedGenericCorporateTax = await runGenericTaxOwnership([
  genericTreatmentIssue('generic-corporate-tax-owner', 'Singapore corporate income-tax treatment of a foreign dividend receipt')
], 'corporate income tax', 'COMPANY',
  'What is the corporate income-tax treatment for foreign dividends received by a Singapore company?');
assert.equal(ownedGenericCorporateTax.result.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'), false,
  'The observed shorter corporate income-tax label is owned by its sole matching issue.');
assert.equal(ownedGenericCorporateTax.requestedByIssue.get('generic-corporate-tax-owner')
  ?.includes('semantic_corporate_income_tax') || false, false,
  'The shorter corporate tax label does not create a redundant retrieval requirement.');
const exactThaiDividendReceiptQuery = 'Our Singapore company received a dividend from its Thai subsidiary in the current year. Explain the company\'s Singapore corporate income-tax treatment for this receipt.';
const exactThaiDividendReceiptOwner = await runGenericTaxOwnership([{
  ...genericTreatmentIssue('exact-thai-dividend-receipt-owner', 'foreign dividend tax treatment'),
  mappedTopicIds: ['iras-foreign-sourced-income']
}], 'corporate income tax', 'COMPANY', exactThaiDividendReceiptQuery);
assert.equal(exactThaiDividendReceiptOwner.result.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'), false,
  'The exact retained Singapore-company receipt from a Thai subsidiary binds its generic corporate-tax label to the mapped foreign-dividend issue.');
const paidThaiDividendSubject = await runGenericTaxOwnership([{
  ...genericTreatmentIssue('paid-thai-dividend-subject', 'foreign dividend paid tax treatment'),
  mappedTopicIds: ['iras-foreign-sourced-income']
}], 'corporate income tax', 'COMPANY', exactThaiDividendReceiptQuery);
assert.ok(paidThaiDividendSubject.result.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'),
  'A receipt query cannot override the opposite paid-dividend direction in the mapped issue subject.');
const unrelatedGenericTaxTreatment = await runGenericTaxOwnership([
  genericTreatmentIssue('unrelated-generic-tax-issue', 'company tax treatment of foreign income')
]);
assert.ok(unrelatedGenericTaxTreatment.result.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'),
  'A generic company tax label is not attached to an issue whose subject lacks that label.');
assert.equal(unrelatedGenericTaxTreatment.requestedByIssue.get('unrelated-generic-tax-issue')
  ?.includes('semantic_corporate_income_tax_treatment') || false, false,
  'An unrelated income-tax issue does not receive the generic concept.');
const ambiguousGenericTaxTreatment = await runGenericTaxOwnership([
  genericTreatmentIssue('ambiguous-generic-tax-a', 'corporate income-tax treatment of a company expense'),
  genericTreatmentIssue('ambiguous-generic-tax-b', 'corporate income-tax treatment of a company receipt')
]);
assert.ok(ambiguousGenericTaxTreatment.result.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'),
  'Matching multiple company issues remains ambiguous and fail-closed.');
assert.equal([...ambiguousGenericTaxTreatment.requestedByIssue.values()]
  .some(ids => ids.includes('semantic_corporate_income_tax_treatment')), false,
  'The generic concept is not assigned to either side of a multi-issue ambiguity.');

for (const [population, topicId] of [
  ['INDIVIDUAL', 'iras-individual-cpf-relief'],
  ['EMPLOYEE', 'iras-individual-cpf-relief'],
  ['COMPANY', 'iras-cit-deductibility'],
  ['FUND', 'iras-cit-deductibility']
]) {
  const genericIncomeTax = await runGenericTaxOwnership([
    issue(`generic-income-tax-${population.toLowerCase()}`, {
      subject: `income tax for ${population.toLowerCase()}`, population,
      domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], mappedTopicIds: [topicId]
    })
  ], 'income tax', population);
  assert.equal(genericIncomeTax.result.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'), false,
    `The exact generic income-tax concept has a sole, mapped ${population} owner with a compatible topic.`);
  assert.equal(genericIncomeTax.requestedByIssue.get(`generic-income-tax-${population.toLowerCase()}`)
    ?.includes(genericIncomeTax.conceptId) || false, false,
  'Exact generic income tax is assigned for aggregation without becoming a redundant retrieval requirement.');
}

const mixedGenericIncomeTaxOwners = await runGenericTaxOwnership([
  issue('mixed-income-tax-company', {
    subject: 'company corporate expense deduction', population: 'COMPANY', domain: 'IRAS_INCOME_TAX',
    governingAuthorities: ['IRAS'], mappedTopicIds: ['iras-cit-deductibility']
  }),
  issue('mixed-income-tax-individual', {
    subject: 'individual personal relief', population: 'INDIVIDUAL', domain: 'IRAS_INCOME_TAX',
    governingAuthorities: ['IRAS'], mappedTopicIds: ['iras-individual-cpf-relief']
  })
], 'income tax');
assert.ok(mixedGenericIncomeTaxOwners.result.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'),
  'Mixed corporate and individual income-tax issues keep generic ownership ambiguous.');

const unresolvedGenericIncomeTaxOwner = await runGenericTaxOwnership([
  issue('mapped-generic-income-tax-owner', {
    subject: 'individual personal relief', population: 'INDIVIDUAL', domain: 'IRAS_INCOME_TAX',
    governingAuthorities: ['IRAS'], mappedTopicIds: ['iras-individual-cpf-relief']
  }),
  issue('unmapped-plausible-income-tax-owner', {
    subject: 'unresolved income-tax issue', population: 'UNKNOWN', domain: 'IRAS_INCOME_TAX',
    governingAuthorities: ['IRAS'], mappedTopicIds: [], status: 'UNRESOLVED'
  })
], 'income tax');
assert.ok(unresolvedGenericIncomeTaxOwner.result.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'),
  'An unmapped plausible IRAS income-tax issue still counts when determining singleton ownership.');

const unrelatedGenericIncomeTaxOwner = await runGenericTaxOwnership([
  issue('gst-is-not-income-tax', {
    subject: 'GST registration', population: 'COMPANY', domain: 'IRAS_GST',
    governingAuthorities: ['IRAS'], mappedTopicIds: ['iras-gst-registration']
  }),
  issue('contextual-only-iras', {
    subject: 'accounting policy', population: 'COMPANY', domain: 'ACCOUNTING_STANDARDS',
    governingAuthorities: ['ACCOUNTING_STANDARDS'], contextualAuthorities: ['IRAS'], mappedTopicIds: []
  })
], 'income tax');
assert.ok(unrelatedGenericIncomeTaxOwner.result.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'),
  'GST and contextual-only IRAS do not own an exact generic income-tax concept.');

for (const [population, topicId] of [
  ['UNKNOWN', 'iras-cit-deductibility'],
  ['COMPANY', 'iras-individual-cpf-relief']
]) {
  const mismatchedGenericIncomeTaxOwner = await runGenericTaxOwnership([
    issue(`mismatched-income-tax-${population.toLowerCase()}`, {
      subject: `income tax for ${population.toLowerCase()}`, population,
      domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], mappedTopicIds: [topicId]
    })
  ], 'income tax', population);
  assert.ok(mismatchedGenericIncomeTaxOwner.result.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'),
    `Population ${population} cannot own a generic income-tax concept through topic ${topicId}.`);
}

const companyBenefitDeductionSubjects = [
  'company tax deductibility of accommodation benefit for the employee',
  'company income tax deduction of accommodation benefit for the employee'
];
const companyBenefitDeductionOverlaps = companyBenefitDeductionSubjects.flatMap((subject, subjectIndex) =>
  ['COMPANY', 'UNKNOWN', 'EMPLOYEE'].map(population => issue(`company-benefit-deduction-${subjectIndex}-${population.toLowerCase()}`, {
    subject, population, domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], mappedTopicIds: []
  }))
);
companyBenefitDeductionOverlaps.push(issue('company-deduction-and-employee-taxability', {
  subject: 'company tax deductibility of accommodation benefit and employee taxability', population: 'EMPLOYEE',
  domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], mappedTopicIds: []
}));
const companyBenefitOverlapPlans = planAuthorityWorkstreams(issuePlan(companyBenefitDeductionOverlaps));
const companyBenefitOverlapDomainByIssue = new Map(companyBenefitOverlapPlans.flatMap(stream =>
  stream.issueIds.map(id => [id, stream.domain])
));
for (const subjectIndex of [0, 1]) {
  for (const population of ['company', 'unknown', 'employee']) {
    assert.equal(companyBenefitOverlapDomainByIssue.get(`company-benefit-deduction-${subjectIndex}-${population}`), 'IRAS_CORPORATE_TAX',
      `An employee recipient or EMPLOYEE population is context for the explicit company deduction (${subjectIndex}/${population}).`);
  }
}
assert.equal(companyBenefitOverlapDomainByIssue.get('company-deduction-and-employee-taxability'), 'UNKNOWN',
  'A separately stated employee taxability outcome conflicts with company deductibility and remains unresolved.');
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

// A routing-only umbrella topic stays in IRAS retrieval scope, but does not
// become an additional evidence requirement beside a mapped relief topic.
const syntheticCpfReliefText = 'TEST-ONLY SYNTHETIC EVIDENCE: Employees may claim CPF relief for their compulsory CPF contributions. This test fixture describes CPF relief for employees.';
const syntheticCpfRelief = {
  ...section14,
  id: 'TEST_ONLY_SYNTHETIC_IRAS_CPF_RELIEF',
  authority: 'IRAS',
  authorityName: 'IRAS (test-only synthetic fixture)',
  sourcePublisher: 'Test-only synthetic fixture',
  legalOrStandardInstrument: 'Test-only synthetic fixture',
  documentTitle: 'Test-only synthetic CPF relief evidence',
  standardOrActCode: 'TEST_ONLY',
  paragraphOrSection: 'TEST_ONLY',
  sourceText: syntheticCpfReliefText,
  principleSummary: 'Test-only synthetic evidence; not authoritative guidance.',
  domain: 'IRAS_INCOME_TAX',
  tags: ['iras-individual-cpf-relief', 'cpf relief for employees'],
  relatedTopicIds: ['iras-individual-cpf-relief'],
  sourceMapTopicIds: [],
  retrievalHints: [],
  provenance: 'LOCAL_STATIC',
  recordRole: 'EVIDENCE',
  groundingEligible: true
};
const cpfReliefQuery = 'Does an employee receive personal income tax relief for compulsory CPF contributions?';
const cpfReliefIssue = (id, mappedTopicIds) => issue(id, {
  subject: 'employee personal income tax relief for compulsory CPF contributions',
  population: 'EMPLOYEE',
  domain: 'IRAS_INCOME_TAX',
  governingAuthorities: ['IRAS'],
  mappedTopicIds
});
const runCpfReliefIssue = async (mappedTopicIds, { candidates = [syntheticCpfRelief], claims } = {}) => {
  let requestedTopicIds = [];
  const result = await buildAuthorityWorkstreams(
    cpfReliefQuery,
    issuePlan([cpfReliefIssue(`cpf-relief-${mappedTopicIds.join('-')}`, mappedTopicIds)]),
    { providers: { IRAS: provider('IRAS', async request => {
      requestedTopicIds = request.retrievalIntent.topicIds;
      return { candidates, claims: claims ?? candidates.map(exactClaim) };
    }) }, referenceDate }
  );
  return { result, requestedTopicIds };
};

const cpfReliefChildOnly = await runCpfReliefIssue(['iras-individual-cpf-relief']);
const cpfReliefWithParent = await runCpfReliefIssue(['iras-individual-reliefs', 'iras-individual-cpf-relief']);
const childIssueResult = cpfReliefChildOnly.result.workstreams[0].issues[0];
const parentAndChildIssueResult = cpfReliefWithParent.result.workstreams[0].issues[0];
assert.equal(childIssueResult.evidenceStatus, 'VERIFIED');
assert.equal(parentAndChildIssueResult.evidenceStatus, 'VERIFIED');
assert.deepEqual(
  [parentAndChildIssueResult.evidenceStatus, parentAndChildIssueResult.lifecycle.covered, parentAndChildIssueResult.verifiedClaims.map(claim => claim.quote)],
  [childIssueResult.evidenceStatus, childIssueResult.lifecycle.covered, childIssueResult.verifiedClaims.map(claim => claim.quote)],
  'Adding the IRAS routing-only parent must not change the child evidence outcome.'
);
assert.deepEqual(cpfReliefWithParent.requestedTopicIds, ['iras-individual-reliefs', 'iras-individual-cpf-relief'],
  'The provider request retains routing topics in the planned scope.');
assert.deepEqual(cpfReliefWithParent.result.issuePlan.issues[0].mappedTopicIds,
  ['iras-individual-reliefs', 'iras-individual-cpf-relief'],
  'The reconciled issue plan retains the routing parent metadata.');

const cpfReliefParentOnly = await runCpfReliefIssue(['iras-individual-reliefs']);
assert.equal(cpfReliefParentOnly.result.workstreams[0].issues[0].evidenceStatus, 'INSUFFICIENT',
  'A routing-only parent cannot be verified by an injected child candidate.');
assert.equal(cpfReliefParentOnly.result.workstreams[0].issues[0].lifecycle.verified, false);
assert.equal(cpfReliefParentOnly.result.workstreams[0].issues[0].lifecycle.covered, false);

const cpfReliefMissingCandidate = await runCpfReliefIssue(
  ['iras-individual-reliefs', 'iras-individual-cpf-relief'], { candidates: [], claims: [] }
);
assert.equal(cpfReliefMissingCandidate.result.workstreams[0].issues[0].evidenceStatus, 'INSUFFICIENT',
  'A routing parent does not make a missing child candidate sufficient.');
const cpfReliefUnsupportedQuote = await runCpfReliefIssue(
  ['iras-individual-reliefs', 'iras-individual-cpf-relief'],
  { claims: [{ text: 'Employees receive a housing benefit exemption.', quote: 'Employees receive a housing benefit exemption.', recordId: syntheticCpfRelief.id }] }
);
assert.equal(cpfReliefUnsupportedQuote.result.workstreams[0].issues[0].evidenceStatus, 'INSUFFICIENT',
  'An unsupported quote remains insufficient with a routing parent present.');

const cpfAndSrsIssue = issue('cpf-and-srs-relief', {
  subject: 'employee CPF relief and SRS relief',
  population: 'EMPLOYEE',
  domain: 'IRAS_INCOME_TAX',
  governingAuthorities: ['IRAS'],
  mappedTopicIds: ['iras-individual-reliefs', 'iras-individual-cpf-relief', 'iras-individual-srs-relief']
});
const cpfOnlyForCpfAndSrs = await buildAuthorityWorkstreams(
  'Explain employee CPF relief and SRS relief.',
  issuePlan([cpfAndSrsIssue]),
  { providers: { IRAS: provider('IRAS', async () => ({ candidates: [syntheticCpfRelief] })) }, referenceDate }
);
assert.equal(cpfOnlyForCpfAndSrs.workstreams[0].issues[0].evidenceStatus, 'INSUFFICIENT',
  'The IRAS routing parent cannot substitute for a second substantive required topic.');
assert.ok(cpfOnlyForCpfAndSrs.workstreams[0].issues[0].gaps.some(gap => gap.reason.includes('iras-individual-srs-relief')),
  'The uncovered SRS topic remains visible in the issue coverage gaps.');

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

const requestedWithResidual = issuePlan([
  issue('requested-cpf'),
  issue('unassigned-accounting-topic', {
    subject: 'ACRA annual return filing', population: 'UNKNOWN', domain: 'ACRA_CORPORATE',
    governingAuthorities: ['ACRA'], mappedTopicIds: ['acra-companies'], status: 'UNRESOLVED',
    unresolvedReason: 'UNASSIGNED_QUERY_TOPIC'
  })
], { coverageEstablished: false, hasUnmappedResidual: true });
const residualPlan = planAuthorityWorkstreams(requestedWithResidual);
assert.equal(residualPlan.some(item => item.authority === 'ACRA'), false,
  'Unassigned taxonomy residue does not become a requested authority workstream.');
const residualResult = await buildAuthorityWorkstreams('Explain a CPF rule and an unparsed ACRA mention.', requestedWithResidual, {
  retriever: cpfRetriever, localOnly: true, referenceDate
});
assert.ok(residualResult.issuePlan.issues.some(item => item.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC'));
assert.ok(residualResult.gaps.some(gap => gap.code === 'UNASSIGNED_QUERY_TOPIC' && gap.authority === 'ACRA'),
  'Residual authority, domain, and issue remain represented by a diagnostic gap.');
assert.equal(residualResult.evidenceStatus, 'INSUFFICIENT',
  'A mapped issue cannot establish complete-question evidence while taxonomy residue remains.');
assert.equal(residualResult.workstreams.some(item => item.authority === 'ACRA'), false);

console.log('Authority workstream evidence isolation and coverage tests passed.');
