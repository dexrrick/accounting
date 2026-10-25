import assert from 'node:assert/strict';
import { buildAuthorityWorkstreams, planAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { getRequestedQuestionConcepts, validateSemanticQuestionInterpretation } from '../../src/services/semanticQuestionUnderstanding.ts';
import { matchesRequestedQuestionConcept } from '../../src/retrieval/evidenceQualityGate.ts';
import {
  isAcraAnnualReturnDeadlineIssue,
  isAcraAnnualReturnDeadlineQuestion,
  requiresAcraAnnualReturnDeadlineEvidence,
  supportsAcraAnnualReturnFilingRule
} from '../../src/retrieval/acraAnnualReturnFilingRule.ts';

const referenceDate = '2026-09-29';
const cpfCeiling = UNIFIED_SOURCE_REGISTRY.CPF_WAGE_CEILINGS_2026;
const section14 = UNIFIED_SOURCE_REGISTRY.ITA_SEC14_GENERAL_DEDUCTION;
const irasPointer = UNIFIED_SOURCE_REGISTRY.IRAS_CIT_EXPENSES_SOURCE_MAP;
assert.ok(cpfCeiling && section14 && irasPointer, 'Expected reviewed source registry records are available.');

assert.equal(supportsAcraAnnualReturnFilingRule(
  'ACRA provides reminder notifications to help you comply with annual return deadlines. ACRA only sends notifications for annual returns and declarations.'
), false, 'Reminder content about annual returns does not state the filing duty.');
assert.equal(supportsAcraAnnualReturnFilingRule(
  'All Singapore companies must file annual returns with ACRA each year.'
), true, 'The ACRA filing-duty guard retains operative company rule text.');
assert.equal(supportsAcraAnnualReturnFilingRule(
  'All companies registered in Singapore must file an annual return with ACRA each year.'
), true, 'The ACRA guard recognizes the official registered-in-Singapore subject wording.');
assert.equal(supportsAcraAnnualReturnFilingRule(
  'Are all companies registered in Singapore required to file an annual return?'
), false, 'A question about the filing duty is not an operative source rule.');
assert.equal(supportsAcraAnnualReturnFilingRule(
  'Variable capital companies must file annual returns with ACRA each year.'
), false, 'The ACRA annual-return guard excludes VCC rules.');
assert.equal(isAcraAnnualReturnDeadlineQuestion('Do non-listed companies have to file annual returns?'), false,
  'Listing status alone does not turn a general filing-duty question into a deadline query.');
assert.equal(isAcraAnnualReturnDeadlineQuestion('When must annual returns be filed?'), true,
  'An annual-return timing question is recognized even when authority and company words are implicit.');
assert.equal(isAcraAnnualReturnDeadlineQuestion('What date are annual returns due?'), true);
assert.equal(isAcraAnnualReturnDeadlineQuestion('How long after FYE are annual returns due?'), true);
assert.equal(isAcraAnnualReturnDeadlineQuestion(
  'Do companies have to file annual returns, and when must income tax be paid?'
), false, 'Timing in a separate tax clause does not upgrade the annual-return duty question.');
assert.equal(isAcraAnnualReturnDeadlineQuestion(
  'When must companies file income tax and annual returns?'
), true, 'A shared timing clause applies when annual returns remain in the same clause.');
const acraDeadlineOwnershipQuery = 'How many months after FYE must non-listed companies with share capital and an overseas branch register file annual returns?';

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

const acraDeadlineScope = {
  id: 'acra-deadline-unique', subject: 'annual return filing deadline', population: 'COMPANY',
  domain: 'ACRA_CORPORATE', governingAuthorities: ['ACRA'], mappedTopicIds: ['acra_annual-returns'], status: 'MAPPED'
};
assert.equal(isAcraAnnualReturnDeadlineIssue(acraDeadlineOwnershipQuery, 'ACRA', acraDeadlineScope, [acraDeadlineScope]), true,
  'A uniquely owning mapped ACRA company issue receives annual-return deadline concepts.');
assert.equal(isAcraAnnualReturnDeadlineIssue(acraDeadlineOwnershipQuery, 'ACRA', acraDeadlineScope,
  [acraDeadlineScope, { ...acraDeadlineScope, id: 'acra-deadline-competing' }]), false,
  'Deadline concepts remain unresolved when two ACRA company issues could own them.');
const mixedAuthorityDeadlineScope = { ...acraDeadlineScope, governingAuthorities: ['ACRA', 'IRAS'] };
assert.equal(requiresAcraAnnualReturnDeadlineEvidence(acraDeadlineOwnershipQuery, 'ACRA', mixedAuthorityDeadlineScope), true,
  'The deadline evidence gate applies independently of concept ownership on a mapped ACRA issue.');
assert.equal(isAcraAnnualReturnDeadlineIssue(acraDeadlineOwnershipQuery, 'ACRA', mixedAuthorityDeadlineScope,
  [mixedAuthorityDeadlineScope]), false,
  'Mixed-authority scope cannot uniquely own ACRA deadline concepts.');
assert.equal(requiresAcraAnnualReturnDeadlineEvidence(acraDeadlineOwnershipQuery, 'ACRA', {
  ...acraDeadlineScope, population: 'UNKNOWN'
}), true, 'Unknown population does not let a mapped ACRA deadline issue bypass table evidence.');
let uniqueAcraRequestedConceptIds = [];
await buildAuthorityWorkstreams(acraDeadlineOwnershipQuery, issuePlan([issue('acra-unique-owner', {
  ...acraDeadlineScope, subject: acraDeadlineScope.subject
})]), {
  referenceDate,
  providers: { ACRA: provider('ACRA', async request => {
    uniqueAcraRequestedConceptIds = request.retrievalIntent.requestedConcepts.map(concept => concept.id);
    return { candidates: [], claims: [] };
  }) }
});
assert.ok(uniqueAcraRequestedConceptIds.includes('acra_annual_return_financial_year_end'));
assert.ok(uniqueAcraRequestedConceptIds.includes('acra_annual_return_listing_status'));
assert.ok(uniqueAcraRequestedConceptIds.includes('acra_annual_return_branch_register_qualification'));

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
assert.equal(cpfResult.evidenceStatus, 'VERIFIED');
assert.notEqual(cpfResult.requestCompletenessContext.evaluation.status, 'COMPLETE');
assert.equal(cpfResult.status, 'CONDITIONAL');
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

// Exercise the built-in IRAS provider through grounding and rendering with a
// validated issue-local rule child. The independent CPF sibling has no source,
// so the IRAS answer cannot mark the complete mixed request as verified.
const mixedRuleQuery = 'Explain the Section 14 rule for outgoings and expenses wholly and exclusively incurred in production of income. Separately, explain the CPF ordinary wage monthly ceiling.';
const mixedIrasIssue = {
  subject: 'outgoings and expenses wholly and exclusively incurred in production of income under Section 14',
  population: 'COMPANY', domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], contextualAuthorities: [],
  operation: 'EXPLAIN_RULE', mappedTopicIds: ['cit_section_14'], evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.96
};
const mixedCpfIssue = {
  subject: 'CPF ordinary wage monthly ceiling', population: 'EMPLOYER', domain: 'CPF_PAYROLL',
  governingAuthorities: ['CPF'], contextualAuthorities: [], operation: 'EXPLAIN_RULE',
  mappedTopicIds: ['cpf_wage_ceiling'], evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.96
};
const mixedRuleInterpretation = validateSemanticQuestionInterpretation({
  schemaVersion: 2, jurisdiction: ['Singapore'], authorityCandidates: ['IRAS', 'CPF'], contextualAuthorities: [],
  domain: 'UNKNOWN', population: 'UNKNOWN', primarySubject: 'corporate income tax and CPF ordinary wage rules',
  concepts: [
    { concept: 'outgoings and expenses wholly and exclusively incurred in production of income', role: 'PRIMARY' },
    { concept: 'CPF ordinary wage monthly ceiling', role: 'RELATED' }
  ], requestedOperation: 'OTHER', factsExplicitlyProvided: [], confidence: 0.96,
  issues: [mixedIrasIssue, mixedCpfIssue]
}, mixedRuleQuery);
assert.ok(mixedRuleInterpretation, 'The mixed EXPLAIN_RULE interpretation validates against the original query.');
assert.equal(mixedRuleInterpretation.issues[0].evidenceRequirement, 'AUTHORITATIVE_SOURCE');
const mixedRuleIssues = mixedRuleInterpretation.issues.map((semanticIssue, index) => ({
  ...semanticIssue, id: index === 0 ? 'mixed-rule-iras' : 'mixed-rule-cpf', status: 'MAPPED'
}));
const mixedRuleResult = await buildAuthorityWorkstreams(mixedRuleQuery, issuePlan(mixedRuleIssues), {
  questionUnderstanding: { mode: 'SEMANTIC_INTERPRETATION', assessmentStatus: 'PASSED', interpretation: mixedRuleInterpretation },
  retriever: { retrieveSources: async options => options.authorities?.includes('IRAS') ? [section14] : [] },
  referenceDate
});
const mixedRuleIras = mixedRuleResult.workstreams.find(stream => stream.authority === 'IRAS');
const mixedRuleCpf = mixedRuleResult.workstreams.find(stream => stream.authority === 'CPF');
assert.equal(mixedRuleIras.issues[0].evidenceStatus, 'VERIFIED',
  'The default IRAS provider passes its validated issue-local general-rule intent through grounding and rendering.');
assert.equal(mixedRuleIras.issues[0].verifiedClaims[0].recordId, section14.id);
assert.equal(mixedRuleCpf.issues[0].evidenceStatus, 'INSUFFICIENT',
  'The unrelated CPF child remains incomplete when its provider returns no supporting source.');
assert.equal(mixedRuleResult.status, 'INSUFFICIENT',
  'A rendered issue-local IRAS success does not mark the original mixed question complete.');

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
assert.equal(childIssueResult.evidenceStatus, 'INSUFFICIENT',
  'Unregistered synthetic local CPF relief text cannot verify a scoped claim.');
assert.equal(parentAndChildIssueResult.evidenceStatus, 'INSUFFICIENT',
  'Adding a routing parent cannot make unregistered synthetic local evidence verifiable.');
assert.equal(childIssueResult.verifiedClaims.length, 0);
assert.equal(parentAndChildIssueResult.verifiedClaims.length, 0);
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

const diagnosticTrace = {
  path: 'DISCOVERED_SOURCE', sourceMapIds: [], selectedRecordIds: [cpfCeiling.id],
  finalVerifiedUrls: [cpfCeiling.officialSourceUrl], candidateOnly: true,
  attempts: [{ topicId: 'cpf_wage_ceiling', fetchStatus: 'SUCCESS', finalUrl: cpfCeiling.officialSourceUrl,
    pageTitle: cpfCeiling.documentTitle, titleMatched: true, contentMatched: true }]
};
async function runAdmissionDiagnostic(diagnosticIssue, candidate, evidenceQualityTrace) {
  const result = await buildAuthorityWorkstreams(
    'Explain the CPF ordinary wage monthly ceiling in 2026.', issuePlan([diagnosticIssue]),
    { providers: { CPF: provider('CPF', async () => ({ candidates: [candidate], claims: [exactClaim(candidate)], evidenceQualityTrace })) }, referenceDate }
  );
  return result.workstreams[0].issues[0].admissionDiagnostics;
}
const untracedLiveCandidate = {
  ...cpfCeiling, id: 'TEST_UNTRACED_LIVE_CPF_CANDIDATE', provenance: 'LIVE_EXTERNAL',
  sourceStatus: 'NEEDS_REVIEW', lifecycleState: 'CANDIDATE', extractionStatus: 'PARTIAL',
  verificationMethod: 'LIVE_OFFICIAL_TOPIC_VERIFIED', sourceAuthority: 'CPF',
  canonicalSourceUrl: cpfCeiling.officialSourceUrl, urlVerificationStatus: 'VERIFIED',
  documentHash: 'a'.repeat(64),
  retrievedAt: '2025-01-01T00:00:00.000Z'
};
const provenanceDiagnostics = await runAdmissionDiagnostic(issue('diag-provenance'), untracedLiveCandidate, undefined);
assert.equal(provenanceDiagnostics.retrievalTraceStatus, 'UNAVAILABLE');
assert.equal(provenanceDiagnostics.candidates[0].recordId, untracedLiveCandidate.id);
assert.equal(provenanceDiagnostics.candidates[0].documentHash, untracedLiveCandidate.documentHash);
assert.equal(provenanceDiagnostics.candidates[0].firstFailedPredicate, 'provenance');
assert.equal(provenanceDiagnostics.candidates[0].predicates.find(item => item.predicate === 'provenance').passed, false);
assert.equal(provenanceDiagnostics.candidates[0].provenancePaths.liveExternal.attempted, true);
assert.equal(provenanceDiagnostics.candidates[0].provenancePaths.liveExternal.firstFailedPredicate, 'selectedRecordId');
assert.equal(provenanceDiagnostics.candidates[0].provenancePaths.liveExternal.predicates.find(item => item.predicate === 'sourceAuthority').passed, true);
assert.equal(provenanceDiagnostics.candidates[0].provenancePaths.managedDocument.attempted, false,
  'A missing live retrieval receipt does not report a managed-document failure on the live path.');
assert.equal(JSON.stringify(provenanceDiagnostics).includes(untracedLiveCandidate.sourceText), false,
  'Candidate diagnostics retain identifiers and admission outcomes without copying candidate bodies.');

const acceptedLiveCandidate = { ...untracedLiveCandidate, id: cpfCeiling.id };
const goodLiveTrace = {
  ...diagnosticTrace,
  selectedRecordIds: [acceptedLiveCandidate.id],
  finalVerifiedUrls: [acceptedLiveCandidate.officialSourceUrl],
  attempts: [{ topicId: 'cpf_wage_ceiling', fetchStatus: 'SUCCESS', finalUrl: acceptedLiveCandidate.officialSourceUrl,
    pageTitle: acceptedLiveCandidate.documentTitle, titleMatched: true, contentMatched: true }]
};
const acceptedLiveDiagnostics = await runAdmissionDiagnostic(issue('diag-live-accepted'), acceptedLiveCandidate, goodLiveTrace);
assert.equal(acceptedLiveDiagnostics.candidates[0].admitted, true,
  `A complete current live-fetch trace satisfies the unchanged live-provenance OR path: ${JSON.stringify(acceptedLiveDiagnostics.candidates[0])}`);
assert.equal(acceptedLiveDiagnostics.candidates[0].provenancePaths.liveExternal.admitted, true);
assert.deepEqual(acceptedLiveDiagnostics.candidates[0].provenancePaths.liveExternal.predicates.map(item => item.predicate), [
  'officialDiscoveryAuthority', 'lifecycleState', 'sourceStatus', 'extractionStatus', 'verificationMethod',
  'sourceAuthority', 'selectedRecordId', 'finalVerifiedUrl', 'successfulTitleContentFetch'
]);
assert.equal(acceptedLiveDiagnostics.candidates[0].provenancePaths.liveExternal.predicates.every(item => item.passed), true,
  'The diagnostic exposes every evaluated live-provenance check.');

const nonstandardOptionalTrace = {
  ...goodLiveTrace,
  path: 'UNRECOGNIZED_PROVIDER_PATH',
  pageTitle: 42
};
const optionalMetadataDiagnostics = await runAdmissionDiagnostic(issue('diag-optional-metadata'),
  acceptedLiveCandidate, nonstandardOptionalTrace);
assert.equal(optionalMetadataDiagnostics.retrievalTraceStatus, 'AVAILABLE',
  'Nonstandard optional trace metadata does not revoke valid admission-critical provenance.');
assert.equal(optionalMetadataDiagnostics.retrievalTraceOptionalMetadataStatus, 'INVALID',
  'Nonstandard optional trace metadata remains visible as a diagnostic quality issue.');
assert.equal(optionalMetadataDiagnostics.candidates[0].admitted, true,
  'Optional metadata validation does not alter original current-fetch eligibility.');
assert.deepEqual(optionalMetadataDiagnostics.retrievalEvidenceQualityTrace, nonstandardOptionalTrace,
  'The original trace, including optional metadata, remains available for diagnosis.');

const invalidTraceDiagnostics = await runAdmissionDiagnostic(issue('diag-invalid-trace'), untracedLiveCandidate, {
  selectedRecordIds: [untracedLiveCandidate.id],
  finalVerifiedUrls: [untracedLiveCandidate.officialSourceUrl],
  attempts: [{ topicId: 'cpf_wage_ceiling', fetchStatus: 'SUCCESS', finalUrl: untracedLiveCandidate.officialSourceUrl,
    titleMatched: true, contentMatched: 'true' }]
});
assert.equal(invalidTraceDiagnostics.retrievalTraceStatus, 'INVALID',
  'Malformed admission-critical attempt fields are reported without reconstructing provenance.');
assert.equal(invalidTraceDiagnostics.candidates[0].admitted, false);
assert.equal(invalidTraceDiagnostics.candidates[0].provenancePaths.liveExternal.firstFailedPredicate, 'selectedRecordId');

const malformedFetchAttempt = {
  ...goodLiveTrace,
  attempts: [{ ...goodLiveTrace.attempts[0], contentMatched: false }]
};
const malformedFetchDiagnostics = await runAdmissionDiagnostic(issue('diag-malformed-fetch'),
  acceptedLiveCandidate, malformedFetchAttempt);
assert.equal(malformedFetchDiagnostics.candidates[0].provenancePaths.liveExternal.firstFailedPredicate, 'successfulTitleContentFetch',
  'An admission-critical failed content check is the live path failure, not an unrelated managed rejection.');
assert.equal(malformedFetchDiagnostics.candidates[0].provenancePaths.managedDocument.attempted, false);

const managedCmsCandidate = {
  ...cpfCeiling,
  id: 'MAS_FUND_MANAGEMENT_LICENSING_SUBSECTION_RECHECK',
  authority: 'MAS', authorityName: 'Monetary Authority of Singapore', sourceAuthority: 'MAS',
  sourcePublisher: 'Monetary Authority of Singapore (MAS)',
  legalOrStandardInstrument: 'Securities and Futures Act 2001',
  documentTitle: 'Capital Markets Services Licence | Monetary Authority of Singapore',
  sourceText: 'If your company wishes to conduct regulated activities under the SFA, it must hold a CMS licence.',
  officialSourceUrl: 'https://www.mas.gov.sg/regulation/capital-markets-services/capital-markets-services-licence',
  canonicalSourceUrl: 'https://www.mas.gov.sg/regulation/capital-markets-services/capital-markets-services-licence',
  domain: 'MAS_FUNDS', jurisdiction: 'Singapore', tags: ['mas-cms-licence'],
  relatedTopicIds: ['mas-cms-licence'], sourceMapTopicIds: [], retrievalHints: [],
  sourceStatus: 'NEEDS_REVIEW', provenance: 'LIVE_PATCH', lifecycleState: 'CANDIDATE',
  extractionStatus: 'PARTIAL', verificationMethod: 'LIVE_OFFICIAL_TOPIC_VERIFIED',
  documentAdmissionRequired: true, recordRole: 'EVIDENCE', groundingEligible: true
};
const managedCmsDiagnosticsResult = await buildAuthorityWorkstreams(
  'When is a Capital Markets Services Licence generally required under MAS guidance?',
  issuePlan([issue('diag-managed-cms', {
    subject: 'Capital Markets Services Licence general requirement', population: 'UNKNOWN', domain: 'MAS_FUNDS',
    governingAuthorities: ['MAS'], mappedTopicIds: ['mas-cms-licence']
  })]),
  { referenceDate, providers: { MAS: provider('MAS', async () => ({
    candidates: [managedCmsCandidate], claims: [exactClaim(managedCmsCandidate)]
  })) } }
);
const managedCmsCandidateDiagnostics = managedCmsDiagnosticsResult.workstreams[0].issues[0].admissionDiagnostics.candidates[0];
assert.equal(managedCmsCandidateDiagnostics.provenancePaths.managedDocument.attempted, true);
assert.equal(managedCmsCandidateDiagnostics.provenancePaths.managedDocument.admissionRequired, true);
assert.equal(managedCmsCandidateDiagnostics.provenancePaths.managedDocument.admitted, false);
assert.equal(managedCmsCandidateDiagnostics.provenancePaths.managedDocument.firstFailedPredicate, 'admissionOutcome');
assert.equal(managedCmsCandidateDiagnostics.provenancePaths.managedDocument.admissionReason,
  'DOCUMENT_VERSION_NOT_EXPLICITLY_APPROVED_AND_ACTIVE',
  'Managed-document diagnostics retain the admission result and its bounded rejection reason.');

const topicDiagnostics = await runAdmissionDiagnostic(issue('diag-topic', {
  subject: 'ordinary wages definition for CPF contributions', mappedTopicIds: ['cpf-ordinary-wages']
}), cpfCeiling, diagnosticTrace);
assert.equal(topicDiagnostics.retrievalTraceStatus, 'AVAILABLE');
assert.deepEqual(topicDiagnostics.retrievalEvidenceQualityTrace, diagnosticTrace,
  'Admission diagnostics preserve the original current-request retrieval-quality trace.');
assert.equal(topicDiagnostics.candidates[0].firstFailedPredicate, 'topic:cpf-ordinary-wages.topicBoundToRecord');
assert.equal(topicDiagnostics.candidates[0].topics[0].predicates[0].passed, false);

const subjectDiagnostics = await runAdmissionDiagnostic(issue('diag-subject', {
  subject: 'employee overtime eligibility and working time limits'
}), cpfCeiling, undefined);
assert.equal(subjectDiagnostics.candidates[0].firstFailedPredicate, 'topic:cpf_wage_ceiling.issueSubjectSupport');
assert.equal(subjectDiagnostics.candidates[0].topics[0].predicates.find(item => item.predicate === 'issueSubjectSupport').passed, false);

const substantiveIssue = issue('diag-substantive', {
  subject: 'ordinary wages definition under CPF contributions', mappedTopicIds: ['cpf_wage_ceiling', 'cpf-ordinary-wages']
});
const substantiveDiagnostics = await runAdmissionDiagnostic(substantiveIssue,
  { ...cpfCeiling, id: 'CPF_WAGE_CEILINGS_2026' }, undefined);
assert.equal(substantiveDiagnostics.candidates[0].firstFailedPredicate, 'topic:cpf_wage_ceiling.boundedSubstantiveSupport');
assert.equal(substantiveDiagnostics.candidates[0].topics[0].predicates.find(item => item.predicate === 'boundedSubstantiveSupport').passed, false,
  'The bounded CPF ordinary-wages definition criteria remain a separate substantive admission gate.');

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
