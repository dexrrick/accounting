import assert from 'node:assert/strict';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { evaluateEvidenceQuality, matchesRequestedQuestionConcept } from '../../src/retrieval/evidenceQualityGate.ts';
import { findRecordEligibilityRejection, verifyEvidenceClaims } from '../../src/verification/claimEvidenceVerifier.ts';
import { InMemorySourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { AdvancedSourceRetriever } from '../../src/retrieval/advancedSourceRetriever.ts';
import { getCoverageTopicById } from '../../src/standards/coverageRegistry.ts';
import { getRequestedQuestionConcepts } from '../../src/services/semanticQuestionUnderstanding.ts';

const mealTopic = 'iras-gst-entertainment';
const standardRateTopic = 'iras-gst-standard-rated-supplies';
const timeOfSupplyTopic = 'iras-gst-time-of-supply';
const section14NTopic = 'iras-cit-renovation-refurbishment';
const section13WTopic = 'iras-section-13w';

function makeRecord(overrides = {}) {
  return {
    id: 'LOCAL_TEST_EVIDENCE',
    authority: 'IRAS',
    authorityName: 'IRAS',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Goods and Services Tax Act 1993',
    documentTitle: 'Goods and Services Tax Act 1993',
    standardOrActCode: 'GSTA1993',
    paragraphOrSection: 'Section 11',
    sourceText: 'Input tax on customer entertainment meals is governed by the relevant GST conditions.',
    principleSummary: 'Customer entertainment input tax',
    officialSourceUrl: 'https://sso.agc.gov.sg/Act/GSTA1993?ProvIds=P13-#pr11-',
    canonicalSourceUrl: 'https://sso.agc.gov.sg/Act/GSTA1993?ProvIds=P13-#pr11-',
    domain: 'IRAS_GST',
    jurisdiction: 'Singapore',
    tags: [mealTopic, 'customer entertainment input tax'],
    sourceStatus: 'VERIFIED',
    verificationMethod: 'CURATED_EDITORIAL_REVIEW',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    validFrom: '2011-01-01',
    lastVerifiedDate: '2026-09-26',
    lifecycleState: 'ACTIVE',
    provenance: 'LOCAL_STATIC',
    recordRole: 'EVIDENCE',
    groundingEligible: true,
    ...overrides
  };
}

function gate(query, topicIds, records, overrides = {}) {
  return evaluateEvidenceQuality({
    query,
    topicIds,
    records,
    missingFacts: [],
    authorities: ['IRAS'],
    domain: 'IRAS_GST',
    referenceDate: '2026-09-26',
    ...overrides
  });
}

const mealQuery = 'Can GST be claimed for meals with customers or suppliers?';
const relevantMeal = makeRecord({ id: 'MEAL_INPUT_TAX', sourceText: 'A claim of input tax on customer entertainment and meals requires the applicable GST evidence.' });
const unrelatedTax = makeRecord({
  id: 'UNRELATED_GST_REGISTRATION',
  tags: ['GST registration threshold'],
  sourceText: 'A taxable person must register when taxable turnover exceeds the compulsory registration threshold.',
  principleSummary: 'GST input tax customer meals entertainment registration threshold'
});
let result = gate(mealQuery, [mealTopic], [unrelatedTax, relevantMeal]);
assert.deepEqual(result.eligibleRecords.map(record => record.id), ['MEAL_INPUT_TAX'],
  'Same authority and domain do not allow unrelated GST registration evidence into a meal answer.');
assert.equal(result.status, 'LOCAL_SUFFICIENT');
assert.deepEqual(result.rejectedRecords.map(item => item.recordId), ['UNRELATED_GST_REGISTRATION']);

const falseTopicTag = makeRecord({
  id: 'FALSE_MEAL_TOPIC_TAG',
  sourceText: 'The company must register once its taxable turnover meets the threshold. This record concerns registration only.',
  tags: [mealTopic, 'customer entertainment input tax']
});
result = gate(mealQuery, [mealTopic], [falseTopicTag]);
assert.equal(result.status, 'INSUFFICIENT', 'False topic tags cannot substitute for distinctive relevant text.');
assert.equal(result.rejectedRecords[0].reason, 'Topic metadata alone is insufficient; source text lacks distinctive evidence for this topic.');
assert.equal(result.rejectedRecords[0].code, 'TOPIC_TEXT_NOT_DISTINCTIVE',
  'Topic diagnostics retain a stable rejection code alongside their readable reason.');

const branchIncomeQuery = 'Can foreign branch profits be remitted without tax in Singapore?';
const provisionalBranchTopic = {
  id: 'iras-authority-query-foreign-branch-profit-remit',
  title: 'Transient IRAS corporate income-tax query',
  domainId: 'IRAS_CORPORATE_TAX',
  priority: 'P1',
  status: 'MISSING',
  authorities: ['IRAS'],
  legacyDomains: ['IRAS_TAX'],
  sourceRecordIds: [],
  requiredChecks: [],
  keywords: ['foreign branch profits remittance'],
  aliases: [],
  exclusionKeywords: []
};
const incidentalBranchText = makeRecord({
  id: 'INCIDENTAL_BRANCH_WORDS_ONLY',
  domain: 'IRAS_TAX',
  sourceText: 'Foreign profits of the company are subject to the applicable rules in Singapore.',
  tags: [provisionalBranchTopic.id],
  officialSourceUrl: 'https://www.iras.gov.sg/taxes/corporate-income-tax/basics-of-corporate-income-tax',
  canonicalSourceUrl: 'https://www.iras.gov.sg/taxes/corporate-income-tax/basics-of-corporate-income-tax'
});
const branchConceptGate = evaluateEvidenceQuality({
  query: branchIncomeQuery,
  topicIds: [],
  provisionalTopics: [provisionalBranchTopic],
  records: [incidentalBranchText],
  missingFacts: [],
  authorities: ['IRAS'],
  domain: 'IRAS_TAX',
  referenceDate: '2026-09-26'
});
assert.equal(branchConceptGate.status, 'INSUFFICIENT',
  `Two incidental query words cannot cover a foreign-branch remittance concept. ${JSON.stringify({ covered: branchConceptGate.coveredTopicIds, uncovered: branchConceptGate.uncoveredConceptGroups, eligible: branchConceptGate.eligibleRecords.map(record => record.sourceText) })}`);
assert.ok(branchConceptGate.uncoveredConceptGroups?.[provisionalBranchTopic.id]?.some(group =>
  group.includes('branch') && group.includes('remit') && group.includes('tax')
), 'The unresolved material concepts, including the short topical term tax, remain traceable after source-text evaluation.');

const twoConceptQuery = 'When does foreign tax apply, and how does double taxation relief work?';
const twoConceptTopic = { ...provisionalBranchTopic, id: 'iras-authority-query-foreign-tax-double-tax-relief' };
const oneConceptOnly = makeRecord({
  id: 'ONE_OF_TWO_QUERY_CONCEPTS',
  domain: 'IRAS_TAX',
  sourceText: 'Foreign tax applies to some residents under the applicable conditions.',
  tags: [twoConceptTopic.id],
  officialSourceUrl: 'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax',
  canonicalSourceUrl: 'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax'
});
const twoConceptGate = evaluateEvidenceQuality({
  query: twoConceptQuery,
  topicIds: [],
  provisionalTopics: [twoConceptTopic],
  records: [oneConceptOnly],
  missingFacts: [],
  authorities: ['IRAS'],
  domain: 'IRAS_TAX',
  referenceDate: '2026-09-26'
});
assert.equal(twoConceptGate.status, 'LIMITED',
  'Two matching terms support only the foreign-tax clause; a separate requested DTR concept remains open.');
assert.ok(twoConceptGate.uncoveredConceptGroups?.[twoConceptTopic.id]?.some(group =>
  group.includes('double') && group.includes('taxation')
), 'The uncovered second material clause is reported for later discovery.');
assert.ok(twoConceptGate.eligibleRecords.some(record => record.id === oneConceptOnly.id),
  'A separately admitted page can support one complete material clause without making the entire multi-concept request sufficient.');

const completeBranchText = makeRecord({
  id: 'COMPLETE_BRANCH_REMITTANCE_CONCEPT',
  domain: 'IRAS_TAX',
  sourceText: 'A company may remit profits from a foreign branch under the applicable tax rules.',
  tags: [provisionalBranchTopic.id],
  officialSourceUrl: 'https://www.iras.gov.sg/taxes/corporate-income-tax/basics-of-corporate-income-tax',
  canonicalSourceUrl: 'https://www.iras.gov.sg/taxes/corporate-income-tax/basics-of-corporate-income-tax'
});
const completeBranchConceptGate = evaluateEvidenceQuality({
  query: branchIncomeQuery,
  topicIds: [],
  provisionalTopics: [provisionalBranchTopic],
  records: [completeBranchText],
  missingFacts: [],
  authorities: ['IRAS'],
  domain: 'IRAS_TAX',
  referenceDate: '2026-09-26'
});
assert.ok(completeBranchConceptGate.coveredTopicIds.includes(provisionalBranchTopic.id),
  'A page with substantive support across the material concepts covers the transient discovery scope.');

const multiReliefQuery = 'Given the overall personal income tax relief cap of SGD 80,000, how are overlapping claims prioritized between mandatory CPF contributions, the Supplementary Retirement Scheme (SRS), and parenthood/caregiver reliefs?';
const requestedReliefConcepts = getRequestedQuestionConcepts(multiReliefQuery);
const reliefConceptTopics = requestedReliefConcepts.map(concept => ({
  id: `iras-authority-query-concept-${concept.id.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}`,
  title: `IRAS individual income tax — ${concept.label}`,
  domainId: 'IRAS_INDIVIDUAL_TAX', priority: 'P1', status: 'MISSING', authorities: ['IRAS'],
  legacyDomains: ['IRAS_TAX'], sourceRecordIds: [], requiredChecks: [], keywords: [concept.label, ...concept.terms],
  aliases: concept.terms, exclusionKeywords: [], requestedConcepts: [concept], mappedTopicIds: concept.topicIds
}));
const reliefTopicTags = reliefConceptTopics.map(topic => topic.id);
const directReliefHubEvidence = makeRecord({
  id: 'DIRECT_IRAS_RELIEF_HUB', domain: 'IRAS_TAX', tags: [...reliefTopicTags, 'iras-individual-relief-cap'],
  documentTitle: 'Tax Reliefs',
  sourceText: 'Individual income tax reliefs are subject to an overall relief cap of $80,000. CPF Relief and SRS Relief are among the claims. Parent Relief, Grandparent Caregiver Relief, Working Mother’s Child Relief (WMCR), and Qualifying Child Relief (QCR) are available according to the applicable conditions.',
  officialSourceUrl: 'https://www.iras.gov.sg/taxes/individual-income-tax/tax-reliefs',
  canonicalSourceUrl: 'https://www.iras.gov.sg/taxes/individual-income-tax/tax-reliefs'
});
const reliefHubGate = evaluateEvidenceQuality({
  query: multiReliefQuery, topicIds: ['iras-individual-relief-cap'], provisionalTopics: reliefConceptTopics,
  requestedConcepts: requestedReliefConcepts, records: [directReliefHubEvidence], missingFacts: [],
  authorities: ['IRAS'], domain: 'IRAS_TAX', referenceDate: '2026-09-26'
});
assert.equal(reliefHubGate.status, 'LIMITED',
  'Direct hub evidence covers the cap and named reliefs but cannot prove an unstated priority order.');
assert.deepEqual(reliefHubGate.coveredConcepts, requestedReliefConcepts.slice(0, -1).map(concept => concept.label));
assert.deepEqual(reliefHubGate.uncoveredConcepts, ['Order or prioritization among relief claims']);
assert.deepEqual(reliefHubGate.acceptedSourceGroups, [directReliefHubEvidence.canonicalSourceUrl]);

const directNoPriorityEvidence = {
  ...directReliefHubEvidence,
  id: 'DIRECT_IRAS_RELIEF_HUB_NO_PRIORITY',
  sourceText: `${directReliefHubEvidence.sourceText} IRAS states there is no fixed order or priority for claiming personal income tax reliefs.`
};
const directNoPriorityGate = evaluateEvidenceQuality({
  query: multiReliefQuery, topicIds: ['iras-individual-relief-cap'], provisionalTopics: reliefConceptTopics,
  requestedConcepts: requestedReliefConcepts, records: [directNoPriorityEvidence], missingFacts: [],
  authorities: ['IRAS'], domain: 'IRAS_TAX', referenceDate: '2026-09-26'
});
assert.equal(directNoPriorityGate.uncoveredConcepts.includes('Order or prioritization among relief claims'), false,
  'A direct official statement that no fixed priority applies answers the priority concept.');
assert.ok(directNoPriorityGate.coveredConcepts.includes('Order or prioritization among relief claims'));
const equityOnlyEvidence = {
  ...directReliefHubEvidence,
  id: 'IRAS_RELIEF_EQUITY_PURPOSE_ONLY',
  sourceText: `${directReliefHubEvidence.sourceText} This cap is applied in order to preserve equity.`
};
const equityOnlyGate = evaluateEvidenceQuality({
  query: multiReliefQuery, topicIds: ['iras-individual-relief-cap'], provisionalTopics: reliefConceptTopics,
  requestedConcepts: requestedReliefConcepts, records: [equityOnlyEvidence], missingFacts: [],
  authorities: ['IRAS'], domain: 'IRAS_TAX', referenceDate: '2026-09-26'
});
assert.ok(equityOnlyGate.uncoveredConcepts.includes('Order or prioritization among relief claims'),
  'A generic phrase such as “in order to preserve equity” does not establish claim priority.');

const capAndCpfConcepts = requestedReliefConcepts.filter(concept =>
  concept.id === 'personal_income_tax_relief_cap' || concept.id === 'cpf_relief');
const capOnlyEvidence = makeRecord({
  id: 'CAP_ONLY_RELIEF_EVIDENCE',
  authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
  domain: 'IRAS_TAX',
  tags: ['iras-individual-relief-cap'],
  sourceText: 'Personal income tax reliefs are subject to an overall relief cap of $80,000.',
  officialSourceUrl: 'https://www.iras.gov.sg/taxes/individual-income-tax/tax-reliefs',
  canonicalSourceUrl: 'https://www.iras.gov.sg/taxes/individual-income-tax/tax-reliefs'
});
const capWithoutCpfTopic = evaluateEvidenceQuality({
  query: multiReliefQuery, topicIds: ['iras-individual-relief-cap'], provisionalTopics: [],
  requestedConcepts: capAndCpfConcepts, records: [capOnlyEvidence], missingFacts: [],
  authorities: ['IRAS'], domain: 'IRAS_TAX', referenceDate: '2026-09-26'
});
assert.equal(capWithoutCpfTopic.status, 'LIMITED',
  'Uncovered requested concepts keep the result limited even when no provisional topic was supplied for CPF Relief.');
assert.deepEqual(capWithoutCpfTopic.coveredConcepts, ['Overall personal income tax relief cap']);
assert.deepEqual(capWithoutCpfTopic.uncoveredConcepts, ['CPF Relief / compulsory CPF contributions']);

const employeeBenefitQuery = 'How does IRAS distinguish between non-taxable business reimbursements and taxable perquisites/benefits-in-kind for employee housing allowances and corporate-paid personal insurance?';
const employeeBenefitConcepts = getRequestedQuestionConcepts(employeeBenefitQuery);
const employeeBenefitTopics = employeeBenefitConcepts.map(concept => ({
  id: `iras-authority-query-concept-${concept.id.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}`,
  title: `IRAS employment tax — ${concept.label}`,
  domainId: 'IRAS_EMPLOYER_TAX', priority: 'P1', status: 'MISSING', authorities: ['IRAS'],
  legacyDomains: ['IRAS_TAX'], sourceRecordIds: [], requiredChecks: [], keywords: [concept.label, ...concept.terms],
  aliases: concept.terms, exclusionKeywords: [], requestedConcepts: [concept], mappedTopicIds: concept.topicIds
}));
const irasEmployeeBenefitSources = [
  {
    conceptId: 'employee_benefit_tax_treatment',
    id: 'IRAS_EMPLOYMENT_TAX_PRINCIPLE',
    title: 'Tax Principles and Flexible Benefits',
    url: 'https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/tax-principles-and-flexible-benefits',
    sourceText: 'All gains and profits derived by an employee in respect of his employment are taxable, unless they are specifically exempt from income tax or are covered by an existing administrative concession. The gains or profits include all benefits, whether in money or otherwise, paid or granted to him in respect of employment.'
  },
  {
    conceptId: 'employee_reimbursement_tax_treatment',
    id: 'IRAS_TAXABLE_VS_NON_TAXABLE_REIMBURSEMENTS',
    title: 'Taxable vs. Non-Taxable Reimbursements',
    url: 'https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/tax-principles-and-flexible-benefits',
    sourceText: 'Taxable vs. Non-Taxable Reimbursements | If an employee seeks reimbursement for an item that has been granted concession or exempt from tax, the reimbursement is not taxable. Reimbursement for an item that has not been granted concession or exempt from tax is taxable.'
  },
  {
    conceptId: 'employee_housing_benefit_tax_treatment',
    id: 'IRAS_HOUSING_ALLOWANCE_TAX_TREATMENT',
    title: 'Accommodation and Related Benefits',
    url: 'https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/accommodation-and-related-benefits',
    sourceText: 'Accommodation and Related Benefits | Housing Allowance | Housing allowance is taxed in full. Where the employee signs a rental agreement but the employer pays the rent to the landlord, the actual rental amount paid by the employer will be taxed in full.'
  },
  {
    conceptId: 'employee_personal_insurance_tax_treatment',
    id: 'IRAS_PERSONAL_INSURANCE_PREMIUM_TAX_TREATMENT',
    title: 'Insurance Premium',
    url: 'https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/insurance-premium',
    sourceText: 'Insurance Premium | Nature of insurance policy for which the premium is paid by employer | Personal Insurance policy where employee is the policyholder. | Taxable'
  }
];
const employeeBenefitEvidence = irasEmployeeBenefitSources.map(source => {
  const conceptTopic = employeeBenefitTopics.find(topic => topic.requestedConcepts[0].id === source.conceptId);
  assert.ok(conceptTopic, `The original question must request ${source.conceptId}.`);
  return makeRecord({
    id: source.id,
    domain: 'IRAS_TAX',
    documentTitle: source.title,
    tags: ['iras-employment-benefits', conceptTopic.id],
    sourceText: source.sourceText,
    officialSourceUrl: source.url,
    canonicalSourceUrl: source.url
  });
});
const employeeBenefitGate = evaluateEvidenceQuality({
  query: employeeBenefitQuery,
  topicIds: ['iras-employment-benefits'],
  provisionalTopics: employeeBenefitTopics,
  requestedConcepts: employeeBenefitConcepts,
  records: employeeBenefitEvidence,
  missingFacts: [], authorities: ['IRAS'], domain: 'IRAS_TAX', referenceDate: '2026-09-26'
});
assert.deepEqual(employeeBenefitGate.coveredConcepts, employeeBenefitConcepts.map(concept => concept.label),
  'IRAS wording on employment gains, taxable/non-taxable reimbursements, housing allowance, and personal insurance premiums covers each requested concept independently.');
assert.deepEqual(employeeBenefitGate.uncoveredConcepts, []);

const genericEmployeeBenefitText = 'The company paid employee housing allowances, personal insurance premiums, and business reimbursements. These amounts appear among staff costs.';
assert.ok(employeeBenefitConcepts.every(concept => !matchesRequestedQuestionConcept(genericEmployeeBenefitText, concept)),
  'Shared words about company-paid housing, insurance, and reimbursements are not tax-treatment evidence.');
const corporateDeductionDecoyText = 'The company may deduct employee housing allowances, personal insurance premiums, and business reimbursements when computing corporate taxable profits; these are company expenses, not employee income-tax benefits.';
assert.ok(employeeBenefitConcepts.every(concept => !matchesRequestedQuestionConcept(corporateDeductionDecoyText, concept)),
  'Corporate deduction text cannot cover employee benefit tax concepts through shared words alone.');

const onlySrsConcept = requestedReliefConcepts.find(concept => concept.id === 'srs_relief');
const srsOnlyTopic = reliefConceptTopics.find(topic => topic.requestedConcepts[0].id === 'srs_relief');
const srsOnlyEvidence = makeRecord({
  id: 'SRS_ONLY_EVIDENCE', domain: 'IRAS_TAX', tags: [srsOnlyTopic.id], documentTitle: 'SRS Relief',
  sourceText: 'SRS Relief may be available for qualifying Supplementary Retirement Scheme contributions.',
  officialSourceUrl: 'https://www.iras.gov.sg/taxes/individual-income-tax/srs',
  canonicalSourceUrl: 'https://www.iras.gov.sg/taxes/individual-income-tax/srs'
});
const genericOfficialEvidence = makeRecord({
  id: 'GENERIC_IRAS_RELIEF_PAGE', domain: 'IRAS_TAX', tags: reliefTopicTags,
  documentTitle: 'Tax Information',
  sourceText: 'IRAS provides tax information for individuals, companies, employers and businesses. Refer to the official tax pages for applicable relief.',
  officialSourceUrl: 'https://www.iras.gov.sg/taxes/individual-income-tax',
  canonicalSourceUrl: 'https://www.iras.gov.sg/taxes/individual-income-tax'
});
const partialReliefGate = evaluateEvidenceQuality({
  query: multiReliefQuery, topicIds: [], provisionalTopics: reliefConceptTopics,
  requestedConcepts: requestedReliefConcepts, records: [srsOnlyEvidence, genericOfficialEvidence], missingFacts: [],
  authorities: ['IRAS'], domain: 'IRAS_TAX', referenceDate: '2026-09-26'
});
assert.equal(partialReliefGate.status, 'LIMITED',
  'A strong SRS source cannot make the multi-concept request sufficient when other requested material concepts are absent.');
assert.deepEqual(partialReliefGate.coveredConcepts, [onlySrsConcept.label]);
assert.equal(partialReliefGate.eligibleRecords.some(record => record.id === genericOfficialEvidence.id), false,
  'A generic official IRAS page sharing only tax/company/relief vocabulary is rejected before presentation eligibility.');

const needsReview = makeRecord({ id: 'MEAL_NEEDS_REVIEW', sourceStatus: 'NEEDS_REVIEW' });
assert.equal(gate(mealQuery, [mealTopic], [needsReview]).status, 'INSUFFICIENT',
  'Local NEEDS_REVIEW summaries do not become evidence because their text is relevant.');
assert.equal(gate(mealQuery, [mealTopic], [needsReview]).rejectedRecords[0].code, 'LOCAL_SOURCE_NOT_VERIFIED',
  'The evidence gate exposes the exact eligibility rejection returned by the quote verifier.');

const acceptedLocal = makeRecord({ id: 'MEAL_REVIEWED_LOCAL' });
assert.equal(findRecordEligibilityRejection(acceptedLocal, '2026-09-26'), undefined,
  'The reviewed local fixture satisfies the same eligibility predicate used by quote verification.');
const acceptedLocalGate = gate(mealQuery, [mealTopic], [acceptedLocal], { targetDate: '2026-09-26' });
assert.equal(acceptedLocalGate.eligibleRecords.some(record => record.id === acceptedLocal.id), true);
const acceptedLocalQuote = verifyEvidenceClaims([{
  kind: 'RULE', text: acceptedLocal.sourceText, quote: acceptedLocal.sourceText, recordId: acceptedLocal.id
}], acceptedLocalGate.eligibleRecords, { missingFacts: [], targetDate: '2026-09-26' });
assert.equal(acceptedLocalQuote.accepted.length, 1,
  'A local record admitted by the gate remains eligible for exact-quote verification.');
const overdueLocal = makeRecord({ id: 'MEAL_OVERDUE', lastVerifiedDate: '2024-01-01', reviewAuditCycleDays: 30 });
assert.equal(gate(mealQuery, [mealTopic], [overdueLocal]).status, 'INSUFFICIENT',
  'An open-ended validity window does not override an overdue review audit.');
assert.equal(findRecordEligibilityRejection(overdueLocal, undefined, '2026-09-26'), 'LOCAL_SOURCE_REVIEW_AUDIT_OVERDUE');

for (const [id, overrides, expectedReason] of [
  ['MEAL_LOCAL_MISSING_REVIEW_PROVENANCE', { verificationMethod: undefined }, 'LOCAL_SOURCE_REVIEW_PROVENANCE_MISSING'],
  ['MEAL_LOCAL_INACTIVE', { lifecycleState: 'STAGED' }, 'SOURCE_RECORD_NOT_GROUNDING_ELIGIBLE'],
  ['MEAL_LOCAL_NONCANONICAL', { canonicalSourceUrl: 'https://www.iras.gov.sg/taxes/unrelated' }, 'SOURCE_URL_NOT_APPROVED_OR_CANONICAL']
]) {
  const ineligible = makeRecord({ id, ...overrides });
  assert.equal(findRecordEligibilityRejection(ineligible, '2026-09-26'), expectedReason);
  const assessment = gate(mealQuery, [mealTopic], [ineligible], { targetDate: '2026-09-26' });
  assert.equal(assessment.eligibleRecords.some(record => record.id === id), false,
    `${id} must not cover a topic unless it passes verifier eligibility.`);
  assert.equal(assessment.rejectedRecords.find(record => record.recordId === id)?.code, expectedReason,
    `${id} diagnostics preserve the exact verifier rejection code.`);
  assert.equal(assessment.coveredTopicIds.includes(mealTopic), false);
  const quoteCheck = verifyEvidenceClaims([{
    kind: 'RULE', text: ineligible.sourceText, quote: ineligible.sourceText, recordId: id
  }], [ineligible], { missingFacts: [], targetDate: '2026-09-26' });
  assert.equal(quoteCheck.accepted.length, 0, `${id} must remain ineligible at quote verification.`);
}

const livePatch = makeRecord({ id: 'MEAL_LIVE_PATCH', provenance: 'LIVE_PATCH' });
assert.equal(findRecordEligibilityRejection(livePatch, '2026-09-26'), 'SOURCE_PROVENANCE_NOT_ALLOWED');
const livePatchGate = gate(mealQuery, [mealTopic], [livePatch], { targetDate: '2026-09-26' });
assert.equal(livePatchGate.status, 'INSUFFICIENT', 'LIVE_PATCH does not count as reviewed local evidence.');
assert.equal(livePatchGate.coveredTopicIds.includes(mealTopic), false,
  'A LIVE_PATCH cannot suppress fallback by falsely covering the topic.');

const pointer = makeRecord({ id: 'MEAL_POINTER', recordRole: 'SOURCE_MAP_POINTER', groundingEligible: false, sourceText: '' });
assert.equal(gate(mealQuery, [mealTopic], [pointer]).eligibleRecords.length, 0,
  'Source-map pointers never qualify as answer evidence.');
const applicationRule = makeRecord({ id: 'MEAL_APP_RULE', evidenceTier: 'APPLICATION_RULE', sourceType: 'APPLICATION_RULE' });
assert.equal(gate(mealQuery, [mealTopic], [applicationRule]).eligibleRecords.length, 0,
  'Application rules are not treated as source evidence.');

const section13wHistorical = makeRecord({
  id: '13W_HISTORICAL',
  domain: 'IRAS_TAX',
  sourceText: 'Section 13W provided the safe harbour for qualifying ordinary share disposals completed before 1 January 2026.',
  principleSummary: 'Historical Section 13W treatment',
  tags: ['section 13w', 'share disposal', 'safe harbour'],
  validFrom: '2012-06-01',
  validTo: '2025-12-31',
  sourceStatus: 'HISTORICAL'
});
assert.equal(gate('Section 13W disposal on 30 December 2025', [section13WTopic], [section13wHistorical], { domain: 'IRAS_TAX', targetDate: '2025-12-30' }).status,
  'LOCAL_SUFFICIENT', 'A historical record is eligible inside its declared period.');
assert.equal(gate('Section 13W disposal on 2 January 2026', [section13WTopic], [section13wHistorical], { domain: 'IRAS_TAX', targetDate: '2026-01-02' }).status,
  'INSUFFICIENT', 'A historical record cannot cross its validTo boundary.');
const expiredSection13wAssessment = gate('Section 13W disposal on 2 January 2026', [section13WTopic], [section13wHistorical], {
  domain: 'IRAS_TAX', targetDate: '2026-01-02'
});
assert.equal(expiredSection13wAssessment.rejectedRecords[0].code, 'SOURCE_NOT_IN_EFFECT_ON_TARGET_DATE',
  'Dated evidence diagnostics preserve the verifier rejection code for out-of-period records.');

const sec14nHistorical = UNIFIED_SOURCE_REGISTRY.ITA_SEC14N_RENOVATION_REFURBISHMENT_PRE2025;
const sec14nCurrentReviewed = UNIFIED_SOURCE_REGISTRY.ITA_SEC14N_RENOVATION_REFURBISHMENT;
assert.equal(gate('Section 14N treatment for YA 2024', [section14NTopic], [sec14nHistorical], { domain: 'IRAS_TAX' }).status,
  'LOCAL_SUFFICIENT', 'YA 2024 selects the validated historical Section 14N record.');
const currentSection14nAssessment = gate('Section 14N treatment for YA 2026', [section14NTopic], [sec14nCurrentReviewed], { domain: 'IRAS_TAX' });
assert.equal(currentSection14nAssessment.status, 'LOCAL_SUFFICIENT',
  'The reviewed current Section 14N summary is eligible for the post-2024 period.');
assert.deepEqual(currentSection14nAssessment.eligibleRecords.map(record => record.id), [sec14nCurrentReviewed.id],
  'The current Section 14N evidence is selected only in its declared date window.');
const ambiguousSection14nAssessment = gate(
  'Can Section 14N apply to refurbishment paid on 31/12/2024 for YA 2025?',
  [section14NTopic], [sec14nHistorical, sec14nCurrentReviewed], { domain: 'IRAS_TAX' }
);
assert.equal(ambiguousSection14nAssessment.status, 'INSUFFICIENT');
assert.ok(ambiguousSection14nAssessment.rejectedRecords.every(item => item.code === 'SECTION14N_BASIS_PERIOD_UNRESOLVED'),
  'A cost date alone cannot choose the YA 2025 rule without the company basis period.');
const confirmedSection14nQuery = 'Can we deduct Section 14N renovation paid on 31/12/2024 for YA 2025? Our FYE is 31 December 2024.';
const confirmedSection14nAssessment = gate(confirmedSection14nQuery,
  [section14NTopic], [sec14nHistorical, sec14nCurrentReviewed], { domain: 'IRAS_TAX' });
assert.deepEqual(confirmedSection14nAssessment.eligibleRecords.map(record => record.id), [sec14nCurrentReviewed.id],
  'A stated 31 December 2024 FYE places the cost in the calendar basis period for YA 2025.');

const section14Topic = 'cit_section_14';
const generalDeduction = UNIFIED_SOURCE_REGISTRY.ITA_SEC14_GENERAL_DEDUCTION;
assert.ok(generalDeduction, 'The curated Section 14 general-deduction record is present in the unified registry.');
const genericExpenseQuery = 'Can a generic corporate expense be deducted for income tax?';
const genericExpenseAssessment = gate(genericExpenseQuery, [section14Topic], [generalDeduction], { domain: 'IRAS_TAX' });
assert.equal(genericExpenseAssessment.status, 'LOCAL_SUFFICIENT',
  'A mapped, reviewed Section 14 source supports a general corporate-expense query without needing live evidence.');
assert.deepEqual(genericExpenseAssessment.eligibleRecords.map(record => record.id), [generalDeduction.id]);

const inMemorySection14 = await new InMemorySourceRetriever([generalDeduction]).retrieveSources({
  query: genericExpenseQuery,
  domain: 'IRAS_TAX',
  authorities: ['IRAS'],
  topicIds: [section14Topic],
  maxResults: 1,
  referenceDate: '2026-09-26'
});
assert.deepEqual(inMemorySection14.map(record => record.id), [generalDeduction.id],
  'The local retriever returns the bound Section 14 record directly, without requiring a live retrieval trace.');

const clonedReviewedSection14 = { ...generalDeduction };
assert.equal(gate(genericExpenseQuery, [section14Topic], [clonedReviewedSection14], { domain: 'IRAS_TAX' }).status,
  'LOCAL_SUFFICIENT', 'A faithful copy of the reviewed registry record keeps its explicit binding.');

// A registry ID alone cannot launder substituted text into reviewed evidence.
const genericBoundSection14 = {
  ...generalDeduction,
  sourceText: 'This corporate charge is governed by the applicable rules for the company.'
};
const boundGenericAssessment = gate(genericExpenseQuery, [section14Topic], [genericBoundSection14], { domain: 'IRAS_TAX' });
assert.equal(boundGenericAssessment.status, 'INSUFFICIENT',
  'A bound record with substituted content cannot borrow the canonical review.');
assert.equal(boundGenericAssessment.rejectedRecords[0].code, 'BOUND_LOCAL_RECORD_MISMATCH');
for (const altered of [
  { isVerbatimText: !generalDeduction.isVerbatimText },
  { sourceType: 'CURATED_SUMMARY' },
  { urlVerificationStatus: generalDeduction.urlVerificationStatus === 'VERIFIED' ? 'CANDIDATE' : 'VERIFIED' },
  { documentTitle: 'Unrelated official document' }
]) {
  const assessment = gate(genericExpenseQuery, [section14Topic], [{ ...generalDeduction, ...altered }], { domain: 'IRAS_TAX' });
  assert.equal(assessment.status, 'INSUFFICIENT',
    'Evidence semantics and URL provenance must match the reviewed local registry record.');
  assert.equal(assessment.rejectedRecords[0].code, 'BOUND_LOCAL_RECORD_MISMATCH');
}

const unboundGenericSection14 = { ...genericBoundSection14, id: 'ITA_SEC14_GENERAL_DEDUCTION_UNBOUND' };
const unboundGenericAssessment = gate(genericExpenseQuery, [section14Topic], [unboundGenericSection14], { domain: 'IRAS_TAX' });
assert.equal(unboundGenericAssessment.status, 'INSUFFICIENT',
  'A generic local record without the coverage sourceRecordIds binding still needs distinctive text matching.');
assert.equal(unboundGenericAssessment.rejectedRecords[0].code, 'TOPIC_TEXT_NOT_DISTINCTIVE');

for (const [id, overrides, expectedCode] of [
  ['ITA_SEC14_BOUND_NEEDS_REVIEW', { sourceStatus: 'NEEDS_REVIEW' }, 'LOCAL_SOURCE_NOT_VERIFIED'],
  ['ITA_SEC14_BOUND_STAGED', { lifecycleState: 'STAGED' }, 'SOURCE_RECORD_NOT_GROUNDING_ELIGIBLE'],
  ['ITA_SEC14_BOUND_WRONG_PROVENANCE', { provenance: 'LIVE_PATCH' }, 'SOURCE_PROVENANCE_NOT_ALLOWED'],
  ['ITA_SEC14_BOUND_OUT_OF_DATE', { validFrom: '2027-01-01' }, 'SOURCE_NOT_IN_EFFECT_ON_TARGET_DATE'],
  ['ITA_SEC14_BOUND_OVERDUE', { lastVerifiedDate: '2020-01-01', reviewAuditCycleDays: 30 }, 'LOCAL_SOURCE_REVIEW_AUDIT_OVERDUE'],
  ['ITA_SEC14_BOUND_WRONG_AUTHORITY', { authority: 'ACRA' }, 'TOPIC_AUTHORITY_DOMAIN_MISMATCH'],
  ['ITA_SEC14_BOUND_WRONG_DOMAIN', { domain: 'IRAS_GST' }, 'TOPIC_AUTHORITY_DOMAIN_MISMATCH'],
  ['ITA_SEC14_BOUND_NOT_GROUNDING', { groundingEligible: false }, 'SOURCE_MAP_POINTER_NOT_EVIDENCE']
]) {
  const ineligibleBoundRecord = { ...generalDeduction, ...overrides };
  const assessment = gate(genericExpenseQuery, [section14Topic], [ineligibleBoundRecord], {
    domain: 'IRAS_TAX', targetDate: '2026-09-26'
  });
  assert.equal(assessment.eligibleRecords.some(record => record.id === ineligibleBoundRecord.id), false,
    `${id} cannot use the sourceRecordIds binding to bypass eligibility.`);
  assert.equal(assessment.rejectedRecords[0]?.code, expectedCode,
    `${id} preserves the specific rejection from the ordinary safeguards.`);
}

const gst2023 = UNIFIED_SOURCE_REGISTRY.GST_RATE_8_PERCENT_2023;
const gstTimeOfSupply = UNIFIED_SOURCE_REGISTRY.GST_SEC11_TIME_OF_SUPPLY;
result = gate(
  'A GST-registered Singapore supplier made a standard-rated domestic supply for SGD 1,000 on 1 July 2023; invoice and payment were on that date.',
  [standardRateTopic, timeOfSupplyTopic],
  [gst2023, gstTimeOfSupply],
  { targetDate: '2023-07-01' }
);
assert.deepEqual(new Set(result.eligibleRecords.map(record => record.id)), new Set(['GST_RATE_8_PERCENT_2023', 'GST_SEC11_TIME_OF_SUPPLY']),
  'Registry-linked rate and Section 11 evidence both survive focused IRAS ranking for a dated 2023 supply.');
assert.equal(result.status, 'LOCAL_SUFFICIENT');

const gst7 = UNIFIED_SOURCE_REGISTRY.GST_RATE_7_PERCENT;
result = gate('Invoice issued in December 2022 but payment received in January 2023. Which GST rate applies?', [standardRateTopic], [gst7, gst2023]);
assert.deepEqual(new Set(result.eligibleRecords.map(record => record.id)), new Set(['GST_RATE_7_PERCENT', 'GST_RATE_8_PERCENT_2023']),
  'Explicitly linked adjacent-year GST transition records remain available together.');

const missingFactResult = gate(mealQuery, [mealTopic], [relevantMeal], { missingFacts: ['GST customer/supplier relationship'] });
assert.equal(missingFactResult.status, 'LIMITED', 'Unresolved missing facts prevent an unconditional sufficiency status.');

const liveUrl = 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst/conditions';
const liveCandidate = makeRecord({
  id: 'LIVE_MEAL_EVIDENCE',
  sourceText: 'Input tax claim for customer entertainment meals is described on this official IRAS page.',
  sourceStatus: 'NEEDS_REVIEW',
  provenance: 'LIVE_EXTERNAL',
  lifecycleState: 'CANDIDATE',
  recordRole: 'DISCOVERED_EVIDENCE',
  verificationMethod: 'LIVE_OFFICIAL_TOPIC_VERIFIED',
  documentHash: 'a'.repeat(64),
  retrievedAt: '2026-09-26T08:00:00.000Z',
  sourceAuthority: 'IRAS',
  officialSourceUrl: liveUrl,
  canonicalSourceUrl: liveUrl,
  urlVerificationStatus: 'VERIFIED',
  urlVerifiedDate: '2026-09-26'
});
const successfulTrace = {
  path: 'MAPPED_SOURCE',
  selectedRecordIds: [liveCandidate.id],
  finalVerifiedUrls: [liveUrl],
  attempts: [{ topicId: mealTopic, sourceMapId: 'IRAS_GST_INPUT_TAX_SOURCE_MAP', fetchStatus: 'SUCCESS', finalUrl: liveUrl, titleMatched: true, contentMatched: true }]
};
result = gate(mealQuery, [mealTopic], [liveCandidate], { sourceMapFallbackTrace: successfulTrace });
assert.equal(result.status, 'RETRIEVED_SUFFICIENT', 'Live evidence qualifies only with matched successful URL/topic/content trace.');
assert.deepEqual(result.eligibleRecords.map(record => record.id), [liveCandidate.id]);

const individualOverseasTopic = 'iras-individual-overseas-employment';
const genericEmploymentLive = {
  ...liveCandidate,
  id: 'LIVE_GENERIC_EMPLOYMENT_WORD',
  domain: 'IRAS_TAX',
  tags: [individualOverseasTopic],
  sourceText: 'Employment terms depend on the contract and relevant tax rules.',
  officialSourceUrl: 'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/what-is-taxable-what-is-not',
  canonicalSourceUrl: 'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/what-is-taxable-what-is-not'
};
const genericEmploymentTrace = {
  ...successfulTrace,
  selectedRecordIds: [genericEmploymentLive.id],
  finalVerifiedUrls: [genericEmploymentLive.canonicalSourceUrl],
  attempts: [{ ...successfulTrace.attempts[0], topicId: individualOverseasTopic, finalUrl: genericEmploymentLive.canonicalSourceUrl }]
};
result = evaluateEvidenceQuality({ query: 'How is overseas employment income treated for an individual?', topicIds: [individualOverseasTopic],
  records: [genericEmploymentLive], missingFacts: [], authorities: ['IRAS'], domain: 'IRAS_TAX', sourceMapFallbackTrace: genericEmploymentTrace });
assert.equal(result.status, 'INSUFFICIENT', 'One generic live word cannot cover a registered overseas-employment topic.');
assert.equal(result.rejectedRecords[0]?.code, 'TOPIC_TEXT_NOT_DISTINCTIVE');

const dtrTopic = 'iras-individual-double-tax-agreements';
const dtrUrl = 'https://www.iras.gov.sg/taxes/individual-income-tax/employees/scenario-based-faqs-for-working-in-singapore-and-abroad/i-want-to-know-the-tax-treatment-on-working-outside-singapore';
const dtrQuote = 'Should your gains from your employment be taxed in the foreign country, you may apply for double taxation relief or tax remission in Singapore, to avoid being taxed twice on the same income.';
const governmentDtrLive = {
  ...liveCandidate,
  id: 'LIVE_GOVERNMENT_SCOPED_DTR',
  tags: [dtrTopic],
  sourceText: [
    '• You are employed outside of Singapore on behalf of the Government of Singapore.',
    'a. Tax treatment in Singapore',
    'As a Singapore citizen or tax resident in Singapore, the income from your employment exercised outside Singapore on behalf of Singapore government is deemed to have been derived from Singapore.',
    'b. Tax treatment outside Singapore',
    dtrQuote
  ].join('\n\n'),
  officialSourceUrl: dtrUrl,
  canonicalSourceUrl: dtrUrl,
  domain: 'IRAS_TAX'
};
const governmentDtrTrace = {
  ...successfulTrace,
  selectedRecordIds: [governmentDtrLive.id],
  finalVerifiedUrls: [dtrUrl],
  attempts: [{ ...successfulTrace.attempts[0], topicId: dtrTopic, finalUrl: dtrUrl }]
};
result = evaluateEvidenceQuality({
  query: 'A Singapore tax resident employee is seconded overseas by a private employer. Can the same income receive double tax relief (DTR)?',
  topicIds: [dtrTopic], records: [governmentDtrLive], missingFacts: [], authorities: ['IRAS'], domain: 'IRAS_TAX',
  sourceMapFallbackTrace: governmentDtrTrace
});
assert.equal(result.status, 'INSUFFICIENT', 'A Government-only relief passage cannot cover a non-government individual DTA question.');
assert.equal(result.rejectedRecords[0]?.code, 'TOPIC_SCOPE_MISMATCH');
const governmentQuestionQuality = evaluateEvidenceQuality({
  query: 'I am employed outside Singapore on behalf of the Government of Singapore; what double tax relief applies?',
  topicIds: [dtrTopic], records: [governmentDtrLive], missingFacts: [], authorities: ['IRAS'], domain: 'IRAS_TAX',
  sourceMapFallbackTrace: governmentDtrTrace
});
assert.equal(governmentQuestionQuality.status, 'RETRIEVED_SUFFICIENT', 'The same passage remains usable when the query establishes its Government-employment scope.');

const provisionalDtrTopic = {
  ...getCoverageTopicById(dtrTopic),
  id: 'iras-authority-query-private-secondment-dtr',
  sourceRecordIds: [],
  keywords: ['private employee double tax relief']
};
const provisionalGovernmentDtrLive = { ...governmentDtrLive, tags: [provisionalDtrTopic.id] };
const provisionalGovernmentDtrTrace = {
  ...governmentDtrTrace,
  selectedRecordIds: [provisionalGovernmentDtrLive.id],
  attempts: [{ ...governmentDtrTrace.attempts[0], topicId: provisionalDtrTopic.id }]
};
const provisionalGovernmentDtrQuality = evaluateEvidenceQuality({
  query: 'A Singapore tax resident employee is seconded overseas by a private employer. Can the same income receive double tax relief (DTR)?',
  topicIds: [], provisionalTopics: [provisionalDtrTopic], records: [provisionalGovernmentDtrLive], missingFacts: [],
  authorities: ['IRAS'], domain: 'IRAS_TAX', sourceMapFallbackTrace: provisionalGovernmentDtrTrace
});
assert.equal(provisionalGovernmentDtrQuality.status, 'INSUFFICIENT',
  'Government-only DTR evidence associated only with a provisional authority-query scope cannot cover a private or unspecified employment query.');
assert.equal(provisionalGovernmentDtrQuality.rejectedRecords[0]?.code, 'TOPIC_SCOPE_MISMATCH');

const mixedGovernmentAndGeneralDtrLive = {
  ...governmentDtrLive,
  id: 'LIVE_MIXED_GENERAL_AND_GOVERNMENT_DTR',
  sourceText: [
    'Benefits under DTAs',
    'Depending on the applicable DTA provisions, a Singapore tax resident may be eligible for relief from double taxation on the same income.',
    '• You are employed outside of Singapore on behalf of the Government of Singapore.',
    'a. Tax treatment in Singapore',
    'Employment income for duties exercised outside Singapore on behalf of the Government of Singapore is deemed derived from Singapore.',
    'b. Tax treatment outside Singapore',
    dtrQuote
  ].join('\n\n')
};
const mixedGovernmentAndGeneralDtrTrace = {
  ...governmentDtrTrace,
  selectedRecordIds: [mixedGovernmentAndGeneralDtrLive.id],
  attempts: [{ ...governmentDtrTrace.attempts[0], topicId: dtrTopic }]
};
const mixedGovernmentAndGeneralDtrQuality = evaluateEvidenceQuality({
  query: 'A Singapore tax resident employee is seconded overseas by a private employer. Can the same income receive double tax relief?',
  topicIds: [dtrTopic], records: [mixedGovernmentAndGeneralDtrLive], missingFacts: [],
  authorities: ['IRAS'], domain: 'IRAS_TAX', sourceMapFallbackTrace: mixedGovernmentAndGeneralDtrTrace
});
assert.equal(mixedGovernmentAndGeneralDtrQuality.status, 'INSUFFICIENT',
  'A general DTA passage does not admit a co-located record that also contains Government-scoped relief for a private-employment query.');
assert.equal(mixedGovernmentAndGeneralDtrQuality.rejectedRecords[0]?.code, 'TOPIC_SCOPE_MISMATCH');

const individualDtaUrl = 'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-residency-and-tax-rates/claiming-exemptions-under-Avoidance-of-Double-Taxation-Agreements-(DTAs)';
const individualDtaPageLive = {
  ...liveCandidate,
  id: 'LIVE_INDIVIDUAL_DTA_PAGE',
  tags: [dtrTopic],
  sourceText: [
    'Claiming exemptions Under Avoidance of Double Taxation Agreements (DTAs)',
    'Under the Avoidance of Double Taxation Agreements (DTAs), you may be protected from being taxed twice on the same income, depending on the provisions of the DTA.',
    'On this page:',
    'Avoidance of Double Taxation Agreements (DTAs)',
    'Double taxation occurs when the same income is being taxed twice - once in the jurisdiction where the income is derived and another time in the jurisdiction where it is received. Jurisdictions enter into DTAs to mitigate the effects of double taxation.',
    'Benefits under DTAs',
    'Depending on the provisions of the DTA, you may be eligible for tax exemption on income for personal services, teachers, researchers, artistes, athletes, students, trainees, etc. As the specific provisions in each DTA differ, please refer to the relevant DTA for guidance when interpreting and applying it to your situation.',
    'Exemption on short-term Singapore employment income',
    "The DTA article for 'Dependent Personal Services' provides the source rules for income from employment. The source state is usually where the services are provided or employment is exercised. For short-term employment and to facilitate the movement of qualified personnel, exemption of tax is granted by the source state. These conditions apply in most DTAs: the employment is exercised in the Source State for less than a specified period (typically 183 days in any 12-month period); and the employer is not a resident of the Source State; and the income is not paid or borne by a permanent establishment or fixed base of the employer in the Source State.",
    'Tax residents of Singapore',
    'If you derive income from a foreign country/jurisdiction, you may be subject to tax there. However, you may claim DTA benefits that entitles a Singapore tax resident to enjoy a reduced tax rate or tax exemption in that jurisdiction. To enjoy this benefit, you need to submit the COR to the foreign tax authority to prove that you are a Singapore tax resident.'
  ].join('\n\n'),
  officialSourceUrl: individualDtaUrl,
  canonicalSourceUrl: individualDtaUrl,
  domain: 'IRAS_TAX'
};
const individualDtaTrace = {
  path: 'DISCOVERED_SOURCE',
  selectedRecordIds: [individualDtaPageLive.id],
  finalVerifiedUrls: [individualDtaUrl],
  attempts: [{ topicId: dtrTopic, fetchStatus: 'SUCCESS', finalUrl: individualDtaUrl, titleMatched: true, contentMatched: true, discoveryStage: 'OFFICIAL_DOMAIN_SEARCH' }]
};
const individualDtaQuality = evaluateEvidenceQuality({
  query: 'If a Singapore tax resident earns employment income while physically working overseas on a temporary secondment, under what conditions is that foreign-sourced income eligible for double taxation relief?',
  topicIds: [dtrTopic], records: [individualDtaPageLive], missingFacts: [], authorities: ['IRAS'], domain: 'IRAS_TAX',
  sourceMapFallbackTrace: individualDtaTrace
});
assert.equal(individualDtaQuality.status, 'RETRIEVED_SUFFICIENT', 'Explicit DTA headings in fetched source text establish general individual DTA scope without relying on URL or title metadata.');
assert.deepEqual(individualDtaQuality.eligibleRecords.map(record => record.id), [individualDtaPageLive.id]);
assert.equal(individualDtaQuality.rejectedRecords.length, 0);

const dtaOnlySource = {
  ...liveCandidate,
  id: 'LIVE_DTA_ONLY_FOR_FTC_REQUEST',
  tags: [dtrTopic],
  sourceText: 'Individual double tax agreement relief applies under the relevant treaty conditions. The agreement sets the applicable exemption.'
};
const dtaOnlyTrace = { ...successfulTrace, selectedRecordIds: [dtaOnlySource.id], attempts: [{ ...successfulTrace.attempts[0], topicId: dtrTopic }] };
result = evaluateEvidenceQuality({ query: 'Can an individual claim a foreign tax credit?', topicIds: ['iras-individual-foreign-tax-credit'],
  records: [dtaOnlySource], missingFacts: [], authorities: ['IRAS'], domain: 'IRAS_TAX', sourceMapFallbackTrace: dtaOnlyTrace });
assert.equal(result.status, 'INSUFFICIENT', 'A DTA-only discovered page cannot cover the separate individual foreign-tax-credit topic.');
assert.ok(result.rejectedRecords.some(item => item.code === 'TOPIC_ASSOCIATION_NOT_FOUND'));

const dtaPageMisassociatedAsFtc = {
  ...individualDtaPageLive,
  id: 'LIVE_INDIVIDUAL_DTA_PAGE_MISASSOCIATED_AS_FTC',
  tags: ['iras-individual-foreign-tax-credit']
};
const dtaAsFtcTrace = {
  ...individualDtaTrace,
  selectedRecordIds: [dtaPageMisassociatedAsFtc.id],
  attempts: [{ ...individualDtaTrace.attempts[0], topicId: 'iras-individual-foreign-tax-credit' }]
};
result = evaluateEvidenceQuality({ query: 'Can a Singapore tax resident claim a foreign tax credit?',
  topicIds: ['iras-individual-foreign-tax-credit'], records: [dtaPageMisassociatedAsFtc], missingFacts: [],
  authorities: ['IRAS'], domain: 'IRAS_TAX', sourceMapFallbackTrace: dtaAsFtcTrace });
assert.equal(result.status, 'INSUFFICIENT', 'A DTA page cannot satisfy FTC merely because its discovery record was tagged FTC.');
assert.ok(result.rejectedRecords.some(item => item.code === 'TOPIC_TEXT_NOT_DISTINCTIVE'));

const individualFtcPageLive = {
  ...dtaPageMisassociatedAsFtc,
  id: 'LIVE_INDIVIDUAL_FTC_PAGE',
  sourceText: [
    'Claiming foreign tax credit',
    'If you are a Singapore tax resident, you may claim foreign tax credit if you have been taxed twice on the same income.',
    'Conditions for claiming FTC',
    '• The individual must be a tax resident in Singapore for the relevant basis year;',
    '• Tax has been paid or is payable on the same income in the foreign country; and',
    '• The income is taxable in Singapore.'
  ].join('\n\n'),
  tags: ['iras-individual-foreign-tax-credit'],
  officialSourceUrl: 'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-residency-and-tax-rates/claiming-foreign-tax-credit',
  canonicalSourceUrl: 'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-residency-and-tax-rates/claiming-foreign-tax-credit'
};
const individualFtcTrace = {
  ...individualDtaTrace,
  selectedRecordIds: [individualFtcPageLive.id],
  finalVerifiedUrls: [individualFtcPageLive.canonicalSourceUrl],
  attempts: [{ ...individualDtaTrace.attempts[0], topicId: 'iras-individual-foreign-tax-credit', finalUrl: individualFtcPageLive.canonicalSourceUrl }]
};
result = evaluateEvidenceQuality({ query: 'Can a Singapore tax resident claim a foreign tax credit?',
  topicIds: ['iras-individual-foreign-tax-credit'], records: [individualFtcPageLive], missingFacts: [],
  authorities: ['IRAS'], domain: 'IRAS_TAX', sourceMapFallbackTrace: individualFtcTrace });
assert.equal(result.status, 'RETRIEVED_SUFFICIENT', 'FTC coverage requires the source text to state the credit and its core eligibility conditions.');
assert.deepEqual(result.eligibleRecords.map(record => record.id), [individualFtcPageLive.id]);

const historicalLive = { ...liveCandidate, validFrom: '2023-01-01', validTo: '2023-12-31' };
assert.equal(gate(mealQuery + ' In 2023?', [mealTopic], [historicalLive], { targetDate: '2023-06-01', sourceMapFallbackTrace: successfulTrace }).status, 'INSUFFICIENT',
  'A current fetched page cannot inherit historical proof from a source-map pointer.');
result = gate(mealQuery, [mealTopic], [liveCandidate], {
  sourceMapFallbackTrace: { ...successfulTrace, attempts: [{ ...successfulTrace.attempts[0], fetchStatus: 'TOPIC_MISMATCH', contentMatched: false }] }
});
assert.equal(result.status, 'INSUFFICIENT', 'HTTP success or candidate status cannot override a failed topic-validation trace.');

const apostropheUrl = "https://www.iras.gov.sg/taxes/withholding-tax/payments-to-non-resident-company/director's-fee";
const encodedApostropheUrl = apostropheUrl.replace("'", '%27');
const apostropheCandidate = { ...liveCandidate, officialSourceUrl: encodedApostropheUrl, canonicalSourceUrl: encodedApostropheUrl };
result = gate(mealQuery, [mealTopic], [apostropheCandidate], {
  sourceMapFallbackTrace: {
    ...successfulTrace,
    finalVerifiedUrls: [apostropheUrl],
    attempts: [{ ...successfulTrace.attempts[0], finalUrl: apostropheUrl }]
  }
});
assert.deepEqual(result.eligibleRecords.map(record => record.id), [apostropheCandidate.id],
  'Literal and percent-encoded apostrophes are treated as the same path URL identity.');

result = gate(mealQuery, [], [relevantMeal], { authorities: ['IRAS'], domain: 'IRAS_GST' });
assert.equal(result.status, 'INSUFFICIENT', 'An IRAS query without resolved IRAS topics fails closed.');

const nonIrasNeedsReview = makeRecord({
  id: 'NON_IRAS_EXISTING_BEHAVIOUR', authority: 'ACRA', domain: 'ACRA_CORP', sourceStatus: 'NEEDS_REVIEW',
  tags: ['company filing'], sourceText: 'Company filing evidence for a corporate compliance topic.'
});
result = evaluateEvidenceQuality({ query: 'Company filing compliance', topicIds: [], records: [nonIrasNeedsReview], missingFacts: [], domain: 'ACRA_CORP', authorities: ['ACRA'] });
assert.deepEqual(result.eligibleRecords.map(record => record.id), [nonIrasNeedsReview.id], 'Non-IRAS behavior remains unchanged.');
result = gate(mealQuery, [mealTopic], [relevantMeal, unrelatedTax, nonIrasNeedsReview], { authorities: ['IRAS', 'ACRA'] });
assert.deepEqual(result.eligibleRecords.map(record => record.id), [relevantMeal.id],
  'A mixed authority label cannot bypass the IRAS gate or admit unrelated non-IRAS records into its prompt.');
assert.ok(result.rejectedRecords.some(record => record.recordId === nonIrasNeedsReview.id));

const crowdingIrrelevant = makeRecord({
  id: 'CROWDING_IRRELEVANT',
  tags: ['company registration threshold'],
  principleSummary: 'GST customer meals entertainment input tax claim overview',
  sourceText: 'Corporate registration thresholds depend on turnover.'
});
const retrievalQuery = {
  query: mealQuery,
  domain: 'IRAS_GST',
  authorities: ['IRAS'],
  topicIds: [mealTopic],
  maxResults: 1,
  referenceDate: '2026-09-26'
};
const inMemoryResults = await new InMemorySourceRetriever([crowdingIrrelevant, relevantMeal]).retrieveSources(retrievalQuery);
assert.deepEqual(inMemoryResults.map(record => record.id), [relevantMeal.id],
  'In-memory precision filtering occurs before maxResults, so a high lexical score cannot crowd out the relevant record.');

const mockAdvancedRetriever = {
  retrieveHybridChunks: async () => ({
    results: [{ parentRecord: crowdingIrrelevant }, { parentRecord: relevantMeal }],
    lexicalRecords: [],
    telemetry: {}
  })
};
const advancedResults = await AdvancedSourceRetriever.prototype.retrieveSources.call(mockAdvancedRetriever, retrievalQuery);
assert.deepEqual(advancedResults.map(record => record.id), [relevantMeal.id],
  'Advanced merged-result filtering occurs before maxResults as well.');

process.stdout.write('IRAS evidence quality gate tests passed.\n');
