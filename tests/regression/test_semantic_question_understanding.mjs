import assert from 'node:assert/strict';
import {
  buildGroundedReasoningContext,
} from '../../src/services/groundingContextBuilder.ts';
import {
  buildSemanticDiscoveryQuery,
  getRequestedQuestionConcepts,
  getSemanticIrasDiscoveryContext,
  interpretSemanticQuestion,
  isShortSemanticFollowUp,
  projectQuestionUnderstandingDiagnostics,
  reconcileQuestionUnderstanding,
  sanitizeSemanticDiagnosticLabel,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';
import { classifyQuestion, isExplicitForeignTaxOnlyQuestion } from '../../src/classification/questionClassifier.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { usesIrasEvidencePolicy } from '../../src/services/irasEvidencePolicy.ts';
import { RequestProfiler } from '../../src/services/telemetry.ts';

const interpretation = (overrides = {}) => ({
  jurisdiction: ['Singapore'],
  authorityCandidates: ['IRAS'],
  contextualAuthorities: [],
  domain: 'IRAS_INCOME_TAX',
  population: 'INDIVIDUAL',
  primarySubject: 'personal income tax relief',
  concepts: [{ concept: 'personal relief cap', role: 'PRIMARY' }, { concept: 'CPF relief', role: 'RELATED' }],
  requestedOperation: 'EXPLAIN_INTERACTION',
  requiresUserSpecificFacts: false,
  calculationRequested: false,
  factsExplicitlyProvided: [],
  confidence: 0.94,
  ...overrides
});

const semantic = (overrides = {}) => ({ mode: 'SEMANTIC_INTERPRETATION', interpretation: interpretation(overrides) });
const reconcile = (query, meaning) => reconcileQuestionUnderstanding(query, classifyQuestion(query), semantic(meaning));

assert.ok(validateSemanticQuestionInterpretation(interpretation()), 'Accept the complete semantic contract.');
for (const invalid of [
  { ...interpretation(), hiddenReasoning: 'answer from memory' },
  { ...interpretation(), confidence: 1.01 },
  { ...interpretation(), population: 'TAXPAYER' },
  { ...interpretation(), domain: 'IRAS_GST', authorityCandidates: ['CPF'] },
  { ...interpretation(), requestedOperation: 'CALCULATE', calculationRequested: false },
  { ...interpretation(), requestedOperation: 'PREPARE_JOURNAL' },
  { ...interpretation(), primarySubject: 'sk-proj-12345678901234567890' },
  { ...interpretation(), concepts: [{ concept: 'https://private.invalid/x', role: 'PRIMARY' }] }
]) assert.equal(validateSemanticQuestionInterpretation(invalid), undefined, 'Reject malformed, contradictory, or sensitive model labels.');

const personalRelief = 'Given the overall personal income tax relief cap of SGD 80,000, how are overlapping claims prioritized between mandatory CPF contributions, SRS, and parenthood/caregiver reliefs?';
const personalMeaning = {
  primarySubject: 'personal income tax relief cap',
  concepts: [
    { concept: 'personal income tax relief cap', role: 'PRIMARY' },
    { concept: 'mandatory CPF contribution relief', role: 'RELATED' },
    { concept: 'Supplementary Retirement Scheme relief', role: 'RELATED' },
    { concept: 'parenthood and caregiver relief', role: 'RELATED' }
  ],
  contextualAuthorities: ['CPF'],
  requestedOperation: 'EXPLAIN_INTERACTION',
  requiresUserSpecificFacts: false
};
const personalRoute = reconcile(personalRelief, personalMeaning);
assert.deepEqual(personalRoute.classification.authorities, ['IRAS']);
assert.equal(personalRoute.classification.primaryDomain, 'TAX');
assert.equal(personalRoute.classification.accountingAnalysisRequired, false);
assert.equal(personalRoute.classification.calculationRequired, false);
assert.deepEqual(personalRoute.classification.missingFacts, [], 'A conceptual relief question should not ask for claimant-specific facts.');
assert.equal(personalRoute.classification.topicIds.some(id => id.startsWith('cpf-')), false, 'CPF relief is contextual, not a CPF Board route.');
assert.equal(personalRoute.classification.topicIds.every(id => id.startsWith('iras-')), true);
assert.equal(personalRoute.understanding.mode, 'SEMANTIC_PLUS_RULES');
assert.deepEqual(personalRoute.classification.authorities, ['IRAS'],
  'CPF cited only as a contextual relief concept does not become another governing authority.');
const materialReliefConcepts = getRequestedQuestionConcepts(personalRelief, personalRoute.understanding);
assert.deepEqual(materialReliefConcepts.map(concept => concept.id), [
  'personal_income_tax_relief_cap', 'cpf_relief', 'srs_relief', 'parent_relief',
  'grandparent_caregiver_relief', 'working_mother_child_relief', 'qualifying_child_relief',
  'relief_claim_prioritization'
], 'A broad parenthood/caregiver relief question retains every material concept, while labels remain retrieval aids.');
assert.ok(materialReliefConcepts.every(concept => concept.id !== 'semantic_mandatory_cpf_contribution_relief'),
  'Semantic labels already represented by canonical material concepts do not create duplicate evidence requirements.');
const recordedPluralReliefLabels = getRequestedQuestionConcepts(personalRelief, {
  ...personalRoute.understanding.interpretation,
  concepts: [
    { concept: 'mandatory CPF contributions', role: 'RELATED' },
    { concept: 'Supplementary Retirement Scheme reliefs', role: 'RELATED' },
    { concept: 'parenthood and caregiver reliefs', role: 'RELATED' }
  ]
});
assert.deepEqual(recordedPluralReliefLabels.map(concept => concept.id), materialReliefConcepts.map(concept => concept.id),
  'Recorded plural Gemini labels normalize into the existing canonical CPF and family-relief concepts.');
assert.ok(recordedPluralReliefLabels.every(concept => !concept.id.startsWith('semantic_')),
  'Plural label variants do not create additional semantic evidence requirements.');

const employeeBenefitsQuestions = [
  'How does IRAS distinguish between non-taxable business reimbursements and taxable perquisites/benefits-in-kind for employee housing allowances and corporate-paid personal insurance?',
  'When our company pays for employee housing and personal insurance, which amounts are taxable employment benefits or non-taxable reimbursements?',
  'For an employer-funded employee allowance, does the employee face income tax on the perquisite even though the company paid it?',
  'How are company-paid perquisites for staff taxed?',
  'Are employer-funded personal insurance premiums taxable as employment benefits?'
];
for (const benefitQuestion of employeeBenefitsQuestions) {
  const isSpecificCompanyPayment = benefitQuestion === employeeBenefitsQuestions[1];
  const benefitRoute = reconcile(benefitQuestion, {
    domain: 'IRAS_INCOME_TAX', population: 'COMPANY', primarySubject: 'tax treatment of employee benefits and reimbursements',
    concepts: [{ concept: 'employment benefits', role: 'PRIMARY' }, { concept: 'taxable perquisites', role: 'RELATED' }],
    // This question asks which amounts from the company's stated payments are
    // taxable, so it applies treatment; the other controls ask general principles.
    requestedOperation: isSpecificCompanyPayment ? 'DETERMINE_TREATMENT' : 'EXPLAIN_INTERACTION',
    requiresUserSpecificFacts: isSpecificCompanyPayment
  });
  assert.equal(benefitRoute.understanding.interpretation.population, 'EMPLOYEE',
    `Employee benefit taxation is attributed to the employee despite contextual company/employer language: ${benefitQuestion}`);
  assert.ok(benefitRoute.classification.topicIds.includes('iras-employment-benefits'),
    'Employee benefits preserve the registered employment benefits topic and source map.');
  assert.equal(benefitRoute.classification.domains.includes('IRAS_CORPORATE_TAX'), false,
    'A contextual business, company, or corporate-paid reference does not select corporate income tax.');
  assert.equal(getSemanticIrasDiscoveryContext(benefitRoute.understanding, benefitQuestion).domainId, 'IRAS_EMPLOYER_TAX', benefitQuestion);
  const fallbackClassification = classifyQuestion(benefitQuestion);
  assert.equal(fallbackClassification.domains.includes('IRAS_CORPORATE_TAX'), false,
    `Deterministic fallback must not treat contextual employer/company words as the taxpayer: ${benefitQuestion}`);
  assert.ok(fallbackClassification.domains.includes('IRAS_EMPLOYER_TAX') || fallbackClassification.domains.includes('IRAS_INDIVIDUAL_TAX'),
    `Deterministic fallback must stay within employee/employment tax scope: ${benefitQuestion}`);
}
const detailedEmployeeBenefitQuery = employeeBenefitsQuestions[0];
const detailedEmployeeBenefitConcepts = getRequestedQuestionConcepts(detailedEmployeeBenefitQuery, interpretation({
  domain: 'IRAS_INCOME_TAX',
  population: 'EMPLOYEE',
  primarySubject: 'employee benefit tax treatment',
  concepts: [
    { concept: 'business reimbursements', role: 'RELATED' },
    { concept: 'housing allowances', role: 'RELATED' },
    { concept: 'corporate-paid personal insurance', role: 'RELATED' }
  ],
  requestedOperation: 'EXPLAIN_INTERACTION',
  requiresUserSpecificFacts: false
}));
assert.deepEqual(detailedEmployeeBenefitConcepts.map(concept => concept.id), [
  'employee_benefit_tax_treatment',
  'employee_reimbursement_tax_treatment',
  'employee_housing_benefit_tax_treatment',
  'employee_personal_insurance_tax_treatment'
], 'The complete question tracks reimbursement, housing, and insurance separately, and semantic labels do not create duplicate requirements.');
const employerReportingQuestion = 'When must an employer report taxable employee benefits on Form IR8A?';
const employerReportingRoute = reconcile(employerReportingQuestion, {
  domain: 'IRAS_INCOME_TAX', population: 'EMPLOYER', primarySubject: 'employer reporting obligations for employee benefits',
  concepts: [{ concept: 'IR8A reporting for employee benefits', role: 'PRIMARY' }],
  requestedOperation: 'FILING_REQUIREMENT', requiresUserSpecificFacts: false
});
assert.equal(employerReportingRoute.understanding.interpretation.population, 'EMPLOYER',
  'An employer filing/reporting question remains about the employer despite employee-benefit terms.');
const employeeIncomeNotBenefits = reconcile('When is my employment income from a temporary overseas posting taxable in Singapore?', {
  domain: 'IRAS_INCOME_TAX', population: 'EMPLOYEE', primarySubject: 'overseas employment income',
  concepts: [{ concept: 'employment income taxability', role: 'PRIMARY' }],
  requestedOperation: 'EXPLAIN_RULE', requiresUserSpecificFacts: true
});
assert.equal(getSemanticIrasDiscoveryContext(employeeIncomeNotBenefits.understanding).domainId, 'IRAS_INDIVIDUAL_TAX',
  'Ordinary employment income questions do not get redirected into employer benefits reporting.');
const companyDeductionQuestion = 'Can our company deduct employee housing allowances and insurance premiums when calculating corporate taxable profits?';
const companyDeductionRoute = reconcile(companyDeductionQuestion, {
  domain: 'IRAS_INCOME_TAX', population: 'COMPANY', primarySubject: 'company deductions for employee costs',
  concepts: [{ concept: 'corporate deductions for employee allowances', role: 'PRIMARY' }],
  requestedOperation: 'CHECK_ELIGIBILITY', requiresUserSpecificFacts: true
});
assert.equal(companyDeductionRoute.understanding.interpretation.population, 'COMPANY',
  'An explicit company deduction from corporate profits remains a corporate-tax question.');
assert.ok(companyDeductionRoute.classification.domains.includes('IRAS_CORPORATE_TAX'));
const masMixedQuery = 'what is MAS 13O';
const deterministicMasRoute = classifyQuestion(masMixedQuery);
assert.deepEqual([...deterministicMasRoute.authorities].sort(), ['IRAS', 'MAS']);
const semanticMasRoute = reconcile(masMixedQuery, {
  authorityCandidates: ['IRAS', 'MAS'], domain: 'IRAS_INCOME_TAX', population: 'FUND',
  primarySubject: 'MAS 13O fund tax incentive', concepts: [{ concept: 'MAS 13O fund incentive', role: 'PRIMARY' }],
  requestedOperation: 'EXPLAIN_RULE', requiresUserSpecificFacts: false
});
assert.deepEqual(semanticMasRoute.classification, deterministicMasRoute,
  'An IRAS-scoped interpretation cannot overwrite the existing supported MAS+IRAS mixed route.');
assert.equal(semanticMasRoute.understanding.mode, 'DETERMINISTIC_FALLBACK');
assert.equal(semanticMasRoute.understanding.interpretation, undefined,
  'The rejected IRAS interpretation is not exposed to retrieval in a mixed-governor scope.');
const wrongOperationPersonalCase = reconcile('Can I claim Parent Relief for my mother?', {
  domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL', primarySubject: 'parent relief eligibility',
  concepts: [{ concept: 'parent relief', role: 'PRIMARY' }], requestedOperation: 'EXPLAIN_RULE',
  requiresUserSpecificFacts: false
});
assert.ok(wrongOperationPersonalCase.classification.missingFacts.length > 0,
  'A direct personal eligibility question keeps its facts guard when both semantic flags are wrong.');
const wrongOperationGstCase = reconcile('Can our company claim input tax on this client meal?', {
  domain: 'IRAS_GST', population: 'COMPANY', primarySubject: 'input tax eligibility for a business meal',
  concepts: [{ concept: 'GST input tax', role: 'PRIMARY' }], requestedOperation: 'EXPLAIN_RULE',
  requiresUserSpecificFacts: false
});
assert.ok(wrongOperationGstCase.classification.missingFacts.length > 0,
  'A direct business eligibility question keeps its deterministic GST fact guards despite incorrect model intent flags.');
const namedTaxpayerCapCase = reconcile('Can a named taxpayer claim Parent Relief under the personal income tax cap?', {
  domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL', primarySubject: 'parent relief eligibility under the cap',
  concepts: [{ concept: 'parent relief', role: 'PRIMARY' }, { concept: 'personal income tax cap', role: 'RELATED' }],
  requestedOperation: 'CHECK_ELIGIBILITY', requiresUserSpecificFacts: true
});
assert.ok(namedTaxpayerCapCase.classification.missingFacts.length > 0,
  'A capped-claim mention does not turn a named taxpayer eligibility question into a conceptual interaction query.');
const generalClaimInteraction = reconcile('How do the overall personal relief cap, CPF, and SRS claims interact, including the stated SGD 80,000 cap?', {
  domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL', primarySubject: 'general personal relief cap interaction',
  concepts: [{ concept: 'personal relief cap', role: 'PRIMARY' }, { concept: 'CPF and SRS interaction', role: 'RELATED' }],
  requestedOperation: 'CHECK_ELIGIBILITY', requiresUserSpecificFacts: false
});
assert.deepEqual(generalClaimInteraction.classification.missingFacts, [],
  'General cap and interaction questions stay conceptual despite mentions of claims and amounts.');
const hypotheticalCalculation = reconcile('For example, calculate the GST on this hypothetical supply; the tax-exclusive amount and supply date are not known.', {
  domain: 'IRAS_GST', population: 'COMPANY', primarySubject: 'GST calculation for a stated supply',
  concepts: [{ concept: 'output GST calculation', role: 'PRIMARY' }], requestedOperation: 'CALCULATE',
  calculationRequested: true, requiresUserSpecificFacts: true
});
assert.ok(hypotheticalCalculation.classification.missingFacts.length > 0,
  `An explicit calculation request retains its missing-input guard despite illustrative wording: ${JSON.stringify(hypotheticalCalculation)}`);
const generalGstCalculation = reconcile('How is output GST calculated in general?', {
  domain: 'IRAS_GST', population: 'COMPANY', primarySubject: 'general output GST calculation method',
  concepts: [{ concept: 'output GST calculation method', role: 'PRIMARY' }], requestedOperation: 'EXPLAIN_RULE',
  calculationRequested: false, requiresUserSpecificFacts: false
});
assert.deepEqual(generalGstCalculation.classification.missingFacts, [],
  'A general explanation of the calculation method remains conceptual.');
const illustrativeBusinessEligibility = reconcile('For example, can our Singapore company claim input tax on the renovation invoices?', {
  domain: 'IRAS_GST', population: 'COMPANY', primarySubject: 'business input tax eligibility',
  concepts: [{ concept: 'GST input tax on renovation invoices', role: 'PRIMARY' }],
  requestedOperation: 'EXPLAIN_RULE', calculationRequested: false, requiresUserSpecificFacts: false
});
assert.ok(illustrativeBusinessEligibility.classification.missingFacts.length > 0,
  'Illustrative wording does not suppress a concrete business eligibility check.');
const namedFictionalBusinessEligibility = reconcile('For example, can Meridian Pte Ltd claim input tax on its renovation invoices?', {
  domain: 'IRAS_GST', population: 'COMPANY', primarySubject: 'business input tax eligibility for renovation invoices',
  concepts: [{ concept: 'GST input tax on renovation invoices', role: 'PRIMARY' }],
  requestedOperation: 'CHECK_ELIGIBILITY', requiresUserSpecificFacts: true
});
assert.ok(namedFictionalBusinessEligibility.classification.missingFacts.length > 0,
  'Illustrative phrasing does not turn a named business eligibility request into a general rule question.');
const generalMealEligibility = reconcile('What are the general conditions for a business to claim input tax on meals?', {
  domain: 'IRAS_GST', population: 'COMPANY', primarySubject: 'general input tax eligibility criteria for meals',
  concepts: [{ concept: 'GST input tax on meals', role: 'PRIMARY' }],
  requestedOperation: 'CHECK_ELIGIBILITY', requiresUserSpecificFacts: false
});
assert.deepEqual(generalMealEligibility.classification.missingFacts, [],
  'Explicit general-conditions questions remain conceptual without relying on illustration markers.');

const caregiverLexical = classifyQuestion('Can caregiver relief reduce the personal income tax I owe?');
assert.equal(caregiverLexical.missingFacts.some(fact => /vehicle registration|S-plate passenger car/i.test(fact)), false,
  'The whole word caregiver must not trigger the vehicle rule.');
const pastCarClaim = classifyQuestion('The company claimed input GST for its car, but which registration facts are required?');
assert.ok(pastCarClaim.missingFacts.some(fact => /Vehicle registration classification/i.test(fact)),
  'A past-tense real-car claim retains the existing vehicle classification guard.');
for (const nearWordQuery of [
  'How does a career break affect personal income tax?',
  'How do card payments affect personal income tax?',
  'How does caring for a parent affect personal relief?'
]) {
  assert.equal(classifyQuestion(nearWordQuery).missingFacts.some(fact => /Vehicle registration classification/i.test(fact)), false,
    `Vehicle classification must use whole words rather than match a substring in: ${nearWordQuery}`);
}

const secondment = 'If a Singapore tax resident earns employment income while physically working overseas for a foreign employer on a temporary secondment, when is it taxable in Singapore or eligible for double taxation relief?';
const secondmentRoute = reconcile(secondment, {
  primarySubject: 'individual overseas employment income',
  concepts: [{ concept: 'temporary overseas secondment', role: 'PRIMARY' }, { concept: 'foreign tax credit', role: 'RELATED' }, { concept: 'double tax agreement', role: 'RELATED' }],
  population: 'UNKNOWN', requestedOperation: 'EXPLAIN_INTERACTION'
});
assert.deepEqual(secondmentRoute.classification.authorities, ['IRAS']);
assert.equal(secondmentRoute.classification.domains.some(domain => domain === 'IRAS_CORPORATE_TAX'), false);
assert.equal(secondmentRoute.classification.missingFacts.length, 0, 'The conceptual secondment rule question does not become a case assessment.');
assert.equal(secondmentRoute.understanding.interpretation.population, 'EMPLOYEE',
  'A clear employee employment-income/DTA subject refines UNKNOWN for scoped retrieval.');
const secondmentDiscovery = getSemanticIrasDiscoveryContext(secondmentRoute.understanding);
assert.equal(secondmentDiscovery.population, 'EMPLOYEE');
assert.equal(secondmentDiscovery.domainId, 'IRAS_INDIVIDUAL_TAX');
const employeeDtaUnknown = reconcile('For salaried employees working overseas, how do foreign tax credits prevent their salaries from being taxed twice under a Singapore double-tax agreement?', {
  primarySubject: 'employment income and salary subject to foreign tax credits', population: 'UNKNOWN',
  concepts: [{ concept: 'salary and foreign tax credits', role: 'PRIMARY' }], requestedOperation: 'EXPLAIN_INTERACTION'
});
assert.equal(employeeDtaUnknown.understanding.interpretation.population, 'EMPLOYEE',
  'Clear salaried-employee double-tax context can refine an unresolved semantic population.');
assert.equal(getSemanticIrasDiscoveryContext(employeeDtaUnknown.understanding).domainId, 'IRAS_INDIVIDUAL_TAX');

const cpfQuestion = 'What CPF contribution rate applies to an employee earning $5,000?';
const cpfRoute = reconcile(cpfQuestion, {
  authorityCandidates: ['CPF'], domain: 'CPF_PAYROLL', population: 'EMPLOYEE', primarySubject: 'employee CPF contribution rate',
  concepts: [{ concept: 'CPF contribution rate', role: 'PRIMARY' }], requestedOperation: 'CALCULATE',
  requiresUserSpecificFacts: true, calculationRequested: true
});
assert.deepEqual(cpfRoute.classification.authorities, ['CPF']);
assert.equal(cpfRoute.classification.primaryDomain, 'PAYROLL');
assert.equal(cpfRoute.classification.authorities.includes('IRAS'), false);
assert.equal(cpfRoute.classification.journalEntryRequired, false);
assert.equal(usesIrasEvidencePolicy(cpfRoute.classification, 'What CPF contribution can be deducted from salary?'), false,
  'A CPF payroll deduction question does not invoke the IRAS evidence policy.');
const cpfGroundedContext = await buildGroundedReasoningContext('What CPF contribution can be deducted from salary?', null, {
  async retrieveSources() { return []; }, getSourceById() { return undefined; }, findSourcesByStandardOrAct() { return []; }
}, undefined, { questionUnderstanding: cpfRoute.understanding });
assert.equal(cpfGroundedContext.evidenceQuality, undefined, 'A direct CPF contribution question does not start IRAS evidence discovery.');
assert.equal(cpfGroundedContext.sourceMapFallbackTrace?.attempts.some(attempt => attempt.topicId.startsWith('iras-')), false);
const cpfNotTaxRelief = reconcile('Can you calculate the CPF deduction from wages? These are payroll contributions, not a personal tax relief claim.', {
  authorityCandidates: ['CPF'], domain: 'CPF_PAYROLL', population: 'EMPLOYEE',
  primarySubject: 'CPF contribution deduction from wages',
  concepts: [{ concept: 'payroll contribution', role: 'PRIMARY' }],
  requestedOperation: 'CALCULATE', calculationRequested: true, requiresUserSpecificFacts: true
});
assert.deepEqual(cpfNotTaxRelief.classification.authorities, ['CPF'],
  'A negated/context-only tax relief mention does not veto a validated CPF contribution route.');
const cpfTaxReliefCalculationQuery = 'Calculate my Singapore personal income tax relief cap using SGD 18,000 in CPF contributions and SGD 7,000 in SRS deposits.';
const rawCpfTaxReliefClassification = classifyQuestion(cpfTaxReliefCalculationQuery);
assert.ok(rawCpfTaxReliefClassification.authorities.includes('IRAS') && rawCpfTaxReliefClassification.authorities.includes('CPF'),
  `The legacy classifier exposes the amount-driven IRAS/CPF overlap this guard must refine: ${JSON.stringify(rawCpfTaxReliefClassification)}`);
const cpfTaxReliefCalculation = reconcile(cpfTaxReliefCalculationQuery, {
  authorityCandidates: ['IRAS', 'CPF'], domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL',
  primarySubject: 'personal income tax relief cap calculation',
  concepts: [{ concept: 'personal relief cap', role: 'PRIMARY' }, { concept: 'CPF and SRS relief amounts', role: 'RELATED' }],
  requestedOperation: 'CALCULATE', calculationRequested: true, requiresUserSpecificFacts: true
});
assert.equal(cpfTaxReliefCalculation.understanding.mode, 'SEMANTIC_PLUS_RULES');
assert.deepEqual(cpfTaxReliefCalculation.classification.authorities, ['IRAS'],
  'CPF amounts that are inputs to a personal tax-relief calculation remain contextual rather than a payroll route.');
assert.ok(cpfTaxReliefCalculation.classification.missingFacts.length > 0,
  'The personal tax-relief calculation retains relevant deterministic fact prompts.');
const cpfReliefRateRelationshipQuery = 'What is the relationship between CPF contribution rates and the personal income tax relief cap?';
const rawCpfReliefRateRelationship = classifyQuestion(cpfReliefRateRelationshipQuery);
assert.ok(rawCpfReliefRateRelationship.authorities.includes('CPF'));
const cpfReliefRateRelationship = reconcile(cpfReliefRateRelationshipQuery, {
  authorityCandidates: ['IRAS', 'CPF'], domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL',
  primarySubject: 'personal income tax relief cap interaction with CPF contribution rates',
  concepts: [{ concept: 'personal relief cap', role: 'PRIMARY' }, { concept: 'CPF contribution rates', role: 'RELATED' }],
  requestedOperation: 'EXPLAIN_INTERACTION', requiresUserSpecificFacts: false
});
assert.equal(cpfReliefRateRelationship.understanding.mode, 'SEMANTIC_PLUS_RULES');
assert.deepEqual(cpfReliefRateRelationship.classification.authorities, ['IRAS'],
  'A conceptual relationship between CPF rates and the personal relief cap does not request a CPF payroll outcome.');
const cpfReliefObligationRelationshipQuery = 'What is the relationship between employer CPF contribution amounts payable and the personal income tax relief cap?';
const rawCpfReliefObligationRelationship = classifyQuestion(cpfReliefObligationRelationshipQuery);
assert.ok(rawCpfReliefObligationRelationship.authorities.includes('CPF'));
const cpfReliefObligationRelationship = reconcile(cpfReliefObligationRelationshipQuery, {
  authorityCandidates: ['IRAS', 'CPF'], domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL',
  primarySubject: 'personal tax relief cap relationship to employer CPF obligations',
  concepts: [{ concept: 'personal income tax relief cap', role: 'PRIMARY' }, { concept: 'employer CPF contribution obligations', role: 'RELATED' }],
  requestedOperation: 'EXPLAIN_INTERACTION', requiresUserSpecificFacts: false
});
assert.equal(cpfReliefObligationRelationship.understanding.mode, 'SEMANTIC_PLUS_RULES');
assert.deepEqual(cpfReliefObligationRelationship.classification.authorities, ['IRAS'],
  'An obligation phrase describing a conceptual relationship does not establish a separate CPF payroll request.');
const mixedCpfPayrollCalculationQuery = 'Calculate my personal income-tax relief cap from CPF contributions, and separately what CPF contribution rate applies to my employer’s SGD 8,000 monthly salary payment?';
const rawMixedCpfPayrollClassification = classifyQuestion(mixedCpfPayrollCalculationQuery);
const mixedCpfPayrollCalculation = reconcile(mixedCpfPayrollCalculationQuery, {
  authorityCandidates: ['IRAS', 'CPF'], domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL',
  primarySubject: 'personal relief cap and employer CPF contribution rate',
  concepts: [{ concept: 'personal relief cap', role: 'PRIMARY' }, { concept: 'employer CPF contribution rate', role: 'RELATED' }],
  requestedOperation: 'CALCULATE', calculationRequested: true, requiresUserSpecificFacts: true
});
assert.ok(rawMixedCpfPayrollClassification.authorities.includes('CPF'));
assert.equal(mixedCpfPayrollCalculation.understanding.mode, 'DETERMINISTIC_FALLBACK',
  'A separate positive CPF contribution-rate request keeps the corroborated CPF governor in the established mixed route.');
assert.deepEqual(mixedCpfPayrollCalculation.classification, rawMixedCpfPayrollClassification);
const missedCpfPayrollGovernor = reconcile(mixedCpfPayrollCalculationQuery, {
  authorityCandidates: ['IRAS'], domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL',
  primarySubject: 'personal relief cap calculation and employer contribution rate',
  concepts: [{ concept: 'personal relief cap', role: 'PRIMARY' }, { concept: 'employer contribution rate', role: 'RELATED' }],
  requestedOperation: 'CALCULATE', calculationRequested: true, requiresUserSpecificFacts: true
});
assert.equal(missedCpfPayrollGovernor.understanding.mode, 'DETERMINISTIC_FALLBACK',
  'A positive CPF rate request preserves deterministic routing even if the semantic authority list omits CPF.');
assert.deepEqual(missedCpfPayrollGovernor.classification, rawMixedCpfPayrollClassification,
  'A model false negative cannot erase the positively requested CPF governor.');
assert.equal(missedCpfPayrollGovernor.understanding.interpretation, undefined);
const separateCpfObligationQuery = 'How is the personal income tax relief cap related to CPF contributions, and what must the employer pay in CPF contributions?';
const rawSeparateCpfObligation = classifyQuestion(separateCpfObligationQuery);
assert.ok(rawSeparateCpfObligation.authorities.includes('CPF'));
const separateCpfObligation = reconcile(separateCpfObligationQuery, {
  authorityCandidates: ['IRAS'], domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL',
  primarySubject: 'personal relief cap with separate employer CPF obligation',
  concepts: [{ concept: 'personal income tax relief cap', role: 'PRIMARY' }, { concept: 'employer CPF contributions', role: 'RELATED' }],
  requestedOperation: 'CALCULATE', calculationRequested: true, requiresUserSpecificFacts: true
});
assert.equal(separateCpfObligation.understanding.mode, 'DETERMINISTIC_FALLBACK',
  'An independent how-much obligation request preserves CPF even beside conceptual relief wording.');
assert.deepEqual(separateCpfObligation.classification, rawSeparateCpfObligation);

const corporateQuery = 'A Singapore company receives dividends from its Malaysian subsidiary. Is the income taxable?';
const corporateRoute = reconcile(corporateQuery, {
  primarySubject: 'company foreign income', population: 'COMPANY', concepts: [
    { concept: 'foreign dividends received by a company', role: 'PRIMARY' }, { concept: 'corporate income tax', role: 'RELATED' }
  ]
});
assert.deepEqual(corporateRoute.classification.authorities, ['IRAS']);
assert.ok(corporateRoute.classification.domains.includes('IRAS_CORPORATE_TAX'));
assert.equal(corporateRoute.classification.domains.includes('IRAS_INDIVIDUAL_TAX'), false);

const gstQuery = 'Can my GST-registered company claim input tax on a customer dinner?';
const gstRoute = reconcile(gstQuery, {
  domain: 'IRAS_GST', primarySubject: 'input tax on business entertainment', population: 'COMPANY',
  concepts: [{ concept: 'GST input tax', role: 'PRIMARY' }, { concept: 'business entertainment', role: 'RELATED' }],
  requestedOperation: 'CHECK_ELIGIBILITY', requiresUserSpecificFacts: true
});
assert.deepEqual(gstRoute.classification.authorities, ['IRAS']);
assert.equal(gstRoute.classification.primaryDomain, 'GST');
assert.equal(gstRoute.classification.accountingAnalysisRequired, false);
assert.ok(gstRoute.classification.missingFacts.length > 0);
assert.equal(gstRoute.classification.missingFacts.some(fact => /vehicle registration|S-plate/i.test(fact)), false);
const guardedEligibility = reconcile('Could our business claim GST on this supply?', {
  domain: 'IRAS_GST', population: 'COMPANY', primarySubject: 'GST eligibility of a business supply',
  concepts: [{ concept: 'GST on business supply', role: 'PRIMARY' }], requestedOperation: 'CHECK_ELIGIBILITY',
  requiresUserSpecificFacts: false
});
assert.ok(guardedEligibility.classification.missingFacts.length > 0,
  'Case-specific eligibility remains guarded even if the model incorrectly marks the facts flag false.');
const completeMealInputTaxQuery = 'Our company is GST-registered, and the supplier is GST-registered. Can we claim input tax on a client dinner? The business purpose was a planning meeting; attendees were two clients and their relationship to the company was prospective customers. We have the tax invoice and the meal had no private use.';
const completeMealInputTax = reconcile(completeMealInputTaxQuery, {
  domain: 'IRAS_GST', population: 'COMPANY', primarySubject: 'input tax eligibility for a client meal',
  concepts: [{ concept: 'GST input tax on business entertainment', role: 'PRIMARY' }],
  requestedOperation: 'CHECK_ELIGIBILITY', requiresUserSpecificFacts: true
});
assert.deepEqual(completeMealInputTax.classification.missingFacts, [],
  'A fully stated supported meal claim does not repeat facts already given.');
const missingSupplierRegistration = reconcile(completeMealInputTaxQuery.replace('and the supplier is GST-registered. ', ''), {
  domain: 'IRAS_GST', population: 'COMPANY', primarySubject: 'input tax eligibility for a client meal',
  concepts: [{ concept: 'GST input tax on business entertainment', role: 'PRIMARY' }],
  requestedOperation: 'CHECK_ELIGIBILITY', requiresUserSpecificFacts: true
});
assert.ok(missingSupplierRegistration.classification.missingFacts.length > 0,
  'A company registration mention cannot stand in for the supplier registration fact.');
const unregisteredSupplier = reconcile(completeMealInputTaxQuery.replace('and the supplier is GST-registered.', 'but the supplier is not GST-registered.'), {
  domain: 'IRAS_GST', population: 'COMPANY', primarySubject: 'input tax eligibility for a client meal',
  concepts: [{ concept: 'GST input tax on business entertainment', role: 'PRIMARY' }],
  requestedOperation: 'CHECK_ELIGIBILITY', requiresUserSpecificFacts: true
});
assert.ok(unregisteredSupplier.classification.missingFacts.length > 0,
  'A negated supplier registration statement cannot satisfy the positive registration guard.');
const missingTaxInvoice = reconcile(completeMealInputTaxQuery.replace('We have the tax invoice and ', ''), {
  domain: 'IRAS_GST', population: 'COMPANY', primarySubject: 'input tax eligibility for a client meal',
  concepts: [{ concept: 'GST input tax on business entertainment', role: 'PRIMARY' }],
  requestedOperation: 'CHECK_ELIGIBILITY', requiresUserSpecificFacts: true
});
assert.ok(missingTaxInvoice.classification.missingFacts.length > 0,
  'Other complete meal facts cannot substitute for an explicit tax invoice cue.');
const mealCalculation = reconcile(completeMealInputTaxQuery, {
  domain: 'IRAS_GST', population: 'COMPANY', primarySubject: 'input tax calculation for a client meal',
  concepts: [{ concept: 'GST input tax on business entertainment', role: 'PRIMARY' }],
  requestedOperation: 'CALCULATE', calculationRequested: true, requiresUserSpecificFacts: true
});
assert.ok(mealCalculation.classification.missingFacts.length > 0,
  'The completed eligibility checklist cannot suppress calculation-specific missing facts.');
const conceptualMealPrompt = reconcile(`Explain ${completeMealInputTaxQuery}`, {
  domain: 'IRAS_GST', population: 'COMPANY', primarySubject: 'input tax eligibility for a client meal',
  concepts: [{ concept: 'GST input tax on business entertainment', role: 'PRIMARY' }],
  requestedOperation: 'CHECK_ELIGIBILITY', requiresUserSpecificFacts: true
});
assert.ok(conceptualMealPrompt.classification.missingFacts.length > 0,
  'A pure explain-prefix that skips the existing case checklist cannot use the completeness exception.');
const specificTreatment = reconcile('We paid for a professional subscription; what is its tax treatment?', {
  domain: 'IRAS_GST', population: 'COMPANY', primarySubject: 'tax treatment of a company subscription expense',
  concepts: [{ concept: 'input tax on subscription expense', role: 'PRIMARY' }], requestedOperation: 'DETERMINE_TREATMENT',
  requiresUserSpecificFacts: false, factsExplicitlyProvided: ['the business paid for a professional subscription']
});
assert.ok(specificTreatment.classification.missingFacts.length > 0,
  'An identified transaction keeps its deterministic facts gate when model operation flags are inconsistent.');

const associateQuery = 'How should an investment in an associate be accounted for under SFRS(I)?';
const associateRoute = reconcile(associateQuery, {
  authorityCandidates: ['ACCOUNTING_STANDARDS'], domain: 'ACCOUNTING', population: 'COMPANY',
  primarySubject: 'accounting for investment in an associate', concepts: [{ concept: 'equity method', role: 'RELATED' }], requestedOperation: 'DETERMINE_TREATMENT'
});
assert.equal(associateRoute.classification.primaryDomain, 'ACCOUNTING');
assert.equal(associateRoute.classification.authorities.includes('IRAS'), false);

const employerContext = 'As a Singapore employee, does my employment income remain taxable during a temporary overseas secondment arranged by my employer company?';
const employerContextRoute = reconcile(employerContext, {
  primarySubject: 'employee employment income tax', population: 'EMPLOYEE',
  concepts: [{ concept: 'employment income', role: 'PRIMARY' }, { concept: 'overseas secondment', role: 'RELATED' }]
});
assert.deepEqual(employerContextRoute.classification.authorities, ['IRAS']);
assert.equal(employerContextRoute.classification.domains.includes('IRAS_CORPORATE_TAX'), false,
  'A company mentioned as employer does not make the employee the company taxpayer.');

const residentQuery = 'A Singapore tax resident earns foreign income from an overseas employer. What Singapore tax treatment applies?';
assert.equal(reconcile(residentQuery, { primarySubject: 'individual foreign employment income', population: 'INDIVIDUAL' }).classification.domains.includes('IRAS_CORPORATE_TAX'), false);
assert.equal(isExplicitForeignTaxOnlyQuestion('Is the interest taxable in Malaysia?'), true);
assert.equal(isExplicitForeignTaxOnlyQuestion('The tax treatment is discussed in the financial statements under SFRS(I).'), false,
  'A later financial-statement phrase is not treated as a foreign country.');
const accountingTaxContext = classifyQuestion('The tax treatment is discussed in the financial statements under SFRS(I).');
assert.equal(accountingTaxContext.primaryDomain, 'MIXED', 'Tax treatment in financial statements remains a Singapore accounting/tax question.');
assert.equal(accountingTaxContext.authorities.includes('IRAS'), true);

const unknownIrasQuery = 'In Singapore, what is IRAS treatment for a transit-token charge under fiscal harbour rules, and can the recipient claim it?';
const unknownRoute = reconcile(unknownIrasQuery, {
  domain: 'IRAS_OTHER', population: 'UNKNOWN', primarySubject: 'transit-token charge under fiscal harbour rules',
  concepts: [{ concept: 'transit-token charge', role: 'PRIMARY' }], requestedOperation: 'CHECK_ELIGIBILITY', requiresUserSpecificFacts: true
});
const unknownDiscoveryContext = getSemanticIrasDiscoveryContext(unknownRoute.understanding);
assert.deepEqual(unknownRoute.classification.authorities, ['IRAS']);
assert.equal(unknownRoute.classification.topicIds.length, 0, 'An unknown concept can continue without a registered topic.');
assert.equal(unknownDiscoveryContext.domainId, 'IRAS_OTHER', 'Unknown population stays in a generic IRAS discovery scope.');
assert.equal(unknownDiscoveryContext.population, 'UNKNOWN');
assert.ok(unknownRoute.classification.missingFacts.some(fact => /taxpayer or recipient/i.test(fact)));
assert.ok(buildSemanticDiscoveryQuery(unknownIrasQuery, unknownRoute.understanding.interpretation).includes('transit-token charge'));
const ambiguousRecipient = reconcile('In Singapore, we received money from overseas. What is the income tax treatment?', {
  domain: 'IRAS_INCOME_TAX', population: 'UNKNOWN', primarySubject: 'income tax treatment of overseas receipts',
  concepts: [{ concept: 'overseas income receipt', role: 'PRIMARY' }], requestedOperation: 'DETERMINE_TREATMENT',
  requiresUserSpecificFacts: true
});
assert.equal(getSemanticIrasDiscoveryContext(ambiguousRecipient.understanding).domainId, 'IRAS_OTHER');
assert.equal(ambiguousRecipient.classification.domains.some(domain => ['IRAS_INDIVIDUAL_TAX', 'IRAS_CORPORATE_TAX', 'IRAS_EMPLOYER_TAX'].includes(domain)), false,
  'A plural first-person mention and foreign receipt do not silently identify an individual or company taxpayer.');

const promptCalls = [];
const provider = { activeProvider: 'gemini', gemini: { apiKey: '0123456789012345', model: 'gemini-3.5-flash-lite' } };
const modelResponse = JSON.stringify(interpretation());
const interpreted = await interpretSemanticQuestion('How does personal income tax relief work?', provider, async (prompt, system, activeProvider, options) => {
  promptCalls.push({ prompt, system, activeProvider, options });
  return modelResponse;
});
assert.equal(interpreted.mode, 'SEMANTIC_INTERPRETATION');
assert.equal(promptCalls.length, 1);
assert.ok(promptCalls[0].options.timeoutMs >= 8_000);
assert.match(promptCalls[0].system, /do not answer/i);
assert.doesNotMatch(promptCalls[0].prompt, /retrieved evidence|conversation history/i);
assert.equal((await interpretSemanticQuestion('Question?', provider, async () => '{bad json')).failure, 'INVALID_RESPONSE');
assert.equal((await interpretSemanticQuestion('Question?', provider, async () => JSON.stringify(interpretation({ confidence: 0.2 })))).failure, 'LOW_CONFIDENCE');
assert.equal((await interpretSemanticQuestion('Question?', provider, async () => { throw new Error('request timed out'); })).failure, 'TIMEOUT');
const rateLimited = await interpretSemanticQuestion('Question?', provider, async () => {
  throw new Error('Gemini API request failed with HTTP 429. The provider response was withheld for security.');
});
assert.equal(rateLimited.failure, 'RATE_LIMITED');
assert.equal(rateLimited.providerStatus, 429);
assert.equal('providerResponse' in rateLimited, false, 'Rate-limit handling must not retain provider response bodies.');
assert.equal((await interpretSemanticQuestion('Question?', undefined, async () => { throw new Error('must not call'); })).failure, 'NO_PROVIDER');

const projected = projectQuestionUnderstandingDiagnostics(unknownRoute.understanding);
assert.equal(projected.mode, 'SEMANTIC_PLUS_RULES');
assert.equal('factsExplicitlyProvided' in projected, false);
assert.equal('contextualAuthorities' in projected, false);
const fallbackProjection = projectQuestionUnderstandingDiagnostics({ mode: 'DETERMINISTIC_FALLBACK' });
assert.equal(fallbackProjection.mode, 'DETERMINISTIC_FALLBACK');
const sensitiveLabel = 'Acme Pte Ltd’s SGD 30,000 dinner on 1 July 2026';
const sensitiveMeaning = interpretation({
  primarySubject: sensitiveLabel,
  concepts: [
    { concept: sensitiveLabel, role: 'PRIMARY' },
    { concept: 'IFRS16', role: 'RELATED' }
  ]
});
const sensitiveProjected = projectQuestionUnderstandingDiagnostics({ mode: 'SEMANTIC_PLUS_RULES', interpretation: sensitiveMeaning });
const projectedLabels = [sensitiveProjected.primarySubject, ...sensitiveProjected.concepts].join(' ');
assert.doesNotMatch(projectedLabels, /Acme|30,000|1 July 2026/i,
  'Diagnostics redact recognizable entity, currency amount, and date values from semantic labels.');
assert.match(projectedLabels, /dinner/i, 'Generic subject concepts remain available in diagnostics.');
assert.match(projectedLabels, /IFRS16/, 'Accounting-standard identifiers remain available in diagnostics.');
const discoveryQuery = buildSemanticDiscoveryQuery('How should this dinner be treated for GST?', sensitiveMeaning);
assert.ok(discoveryQuery.includes(sensitiveLabel), 'Telemetry sanitization does not alter the semantic text used to build retrieval queries.');
assert.equal(sensitiveMeaning.primarySubject, sensitiveLabel, 'The original validated interpretation remains unchanged.');
assert.match(sanitizeSemanticDiagnosticLabel(sensitiveLabel), /\[entity\].*\[amount\].*\[date\]/,
  'The shared diagnostic sanitizer replaces recognizable case values while retaining context.');
const profiler = new RequestProfiler('raw user request containing case details');
profiler.setQuestionUnderstanding({
  mode: 'SEMANTIC_PLUS_RULES', population: 'INDIVIDUAL', primarySubject: sensitiveLabel,
  requestedOperation: 'DETERMINE_TREATMENT', authorityCandidates: ['IRAS'], concepts: [sensitiveLabel, 'IFRS16']
});
const profiled = profiler.generateReport().questionUnderstanding;
const storedLabels = [profiled.primarySubject, ...profiled.concepts].join(' ');
assert.doesNotMatch(storedLabels, /Acme|30,000|1 July 2026/i,
  'RequestProfiler applies the same value redaction before storing semantic labels.');
assert.match(storedLabels, /IFRS16/);
const inconsistentWrapper = reconcileQuestionUnderstanding(personalRelief, classifyQuestion(personalRelief), {
  mode: 'DETERMINISTIC_FALLBACK', interpretation: interpretation()
});
assert.equal(inconsistentWrapper.understanding.mode, 'DETERMINISTIC_FALLBACK',
  'A valid intent payload inside a fallback wrapper is not allowed to affect production routing.');

const priorPpe = {
  scenarioType: 'PPE_PURCHASE', transactionTitle: 'Machine purchase', functionalCurrency: 'SGD', transactionCurrency: 'SGD', amount: 90000,
  directGroups: [{ title: 'Machine purchase', eventDate: '01/01/2026', totalDebit: 90000, totalCredit: 90000,
    isBalanced: true, lines: [{ accountName: 'Machinery', debit: 90000, credit: 0 }, { accountName: 'Cash', debit: 0, credit: 90000 }] }],
  keyParameters: [{ label: 'Machine cost', value: 'SGD 90,000', badge: 'User-provided' }],
  missingFields: [{ fieldKey: 'assetUsefulLife', fieldName: 'Asset useful life', prompt: 'What is the useful life?', whyNeeded: 'Depreciation' }]
};
const parentReliefQuery = 'Can I claim Parent Relief for my mother?';
const parentReliefUnderstanding = semantic({ requestedOperation: 'CHECK_ELIGIBILITY', requiresUserSpecificFacts: true,
  primarySubject: 'individual parent relief eligibility', concepts: [{ concept: 'parent relief', role: 'PRIMARY' }] });
const boundaryContext = await buildGroundedReasoningContext(parentReliefQuery, priorPpe, {
  async retrieveSources() { return []; }, getSourceById() { return undefined; }, findSourcesByStandardOrAct() { return []; }
}, undefined, { localOnly: true, authorityLevelDiscovery: false, questionUnderstanding: parentReliefUnderstanding });
assert.equal(boundaryContext.userFacts.some(fact => /machine|90000|machinery/i.test(fact)), false,
  'Standalone tax eligibility questions do not inherit unrelated prior accounting facts.');
assert.equal(boundaryContext.missingFacts.some(fact => /useful life|asset/i.test(fact)), false);
assert.ok(boundaryContext.missingFacts.some(fact => /individual eligibility/i.test(fact)));

const shortAnaphoricFollowUp = 'Can I claim input tax on it?';
assert.equal(isShortSemanticFollowUp(shortAnaphoricFollowUp), true,
  'A short question with explicit transaction anaphora continues the active case.');
const followUpUnderstanding = semantic({ domain: 'IRAS_GST', population: 'COMPANY', primarySubject: 'input tax eligibility for the purchase',
  concepts: [{ concept: 'GST input tax', role: 'PRIMARY' }], requestedOperation: 'CHECK_ELIGIBILITY', requiresUserSpecificFacts: true });
const followUpContext = await buildGroundedReasoningContext(shortAnaphoricFollowUp, priorPpe, {
  async retrieveSources() { return []; }, getSourceById() { return undefined; }, findSourcesByStandardOrAct() { return []; }
}, undefined, { localOnly: true, authorityLevelDiscovery: false, questionUnderstanding: followUpUnderstanding });
assert.equal(followUpContext.userFacts.some(fact => /machine|90000|machinery/i.test(fact)), true,
  'A short explicit anaphoric question retains relevant active transaction facts.');
assert.equal(isShortSemanticFollowUp(parentReliefQuery), false,
  'A self-contained Parent Relief request starts a new semantic case boundary.');
const parentReliefThisYear = 'Can I claim Parent Relief for my mother this year?';
assert.equal(isShortSemanticFollowUp(parentReliefThisYear), false,
  'Temporal wording such as “this year” does not turn a self-contained tax question into a follow-up.');
const temporalBoundaryContext = await buildGroundedReasoningContext(parentReliefThisYear, priorPpe, {
  async retrieveSources() { return []; }, getSourceById() { return undefined; }, findSourcesByStandardOrAct() { return []; }
}, undefined, { localOnly: true, authorityLevelDiscovery: false, questionUnderstanding: parentReliefUnderstanding });
assert.equal(temporalBoundaryContext.userFacts.some(fact => /machine|90000|machinery/i.test(fact)), false,
  'A self-contained Parent Relief question with a tax-year reference clears prior PPE facts.');

const correctionStyleParentQuery = 'Actually, can I claim Parent Relief for my mother if her annual income is SGD 10,000?';
let correctionGroundedContext;
const fetchBeforeBoundaryTest = globalThis.fetch;
globalThis.fetch = async url => {
  if (String(url).includes('generateContent')) {
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(interpretation({
      domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL', primarySubject: 'parent relief eligibility',
      concepts: [{ concept: 'parent relief', role: 'PRIMARY' }], requestedOperation: 'CHECK_ELIGIBILITY',
      requiresUserSpecificFacts: true
    })) }] } }] }), { status: 200 });
  }
  return new Response('', { status: 503 });
};
try {
  const correctedResponse = await processAccountingQuery(correctionStyleParentQuery, priorPpe, 'SFRS_I', {
    activeProvider: 'gemini', gemini: { apiKey: '0123456789012345', model: 'gemini-3.5-flash-lite' },
    azure: { apiKey: '', endpoint: '', deploymentName: 'gpt-4o', apiVersion: '2024-08-01-preview' },
    openai: { apiKey: '', model: 'gpt-4o' }
  }, 'gemini-3.5-flash-lite', [], { journal: false, statutory: true }, {
    onGroundedContext(context) { correctionGroundedContext = context; }
  });
  assert.ok(!correctedResponse.scenarioState.factAmendments?.some(item => item.field === 'amount'),
    'A correction marker in a standalone Parent Relief question cannot attach the preceding PPE amount.');
  assert.equal(correctionGroundedContext.userFacts.some(fact => /machine|90000|machinery/i.test(fact)), false);
  assert.equal(correctionGroundedContext.missingFacts.some(fact => /useful life|asset/i.test(fact)), false);
} finally {
  globalThis.fetch = fetchBeforeBoundaryTest;
}

let unknownSitemapQuery = '';
let unknownSearchQuery = '';
let unknownSitemapTitle = '';
const unknownContext = await buildGroundedReasoningContext(unknownIrasQuery, null, {
  async retrieveSources() { return []; }, getSourceById() { return undefined; }, findSourcesByStandardOrAct() { return []; }
}, undefined, {
  authorityLevelDiscovery: true,
  questionUnderstanding: unknownRoute.understanding,
  discoveryAdapter: {
    async discoverOfficialSourceCandidates(request) { unknownSitemapQuery = request.query; unknownSitemapTitle = request.topicTitle; return []; },
    getLastFetchTrace() { return []; }
  },
  officialDomainSearchAdapter: {
    async searchOfficialDomainCandidates(request) { unknownSearchQuery = request.query; return []; },
    getLastSearchTrace() { return []; }
  }
});
assert.equal(unknownContext.questionUnderstanding?.interpretation?.population, 'UNKNOWN',
  'Grounded context preserves the validated unresolved population.');
assert.match(unknownSitemapQuery, /transit-token charge/);
assert.match(unknownSearchQuery, /transit-token charge/);
assert.match(unknownSitemapTitle, /unknown guidance/i, 'Authority-level discovery preserves the unresolved population.');

// Exercise the processAccountingQuery path: interpretation happens before its
// first classification and the result is passed through without a second call.
const originalFetch = globalThis.fetch;
let processInterpretationCalls = 0;
let productionContext;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('generateContent')) {
    const request = JSON.parse(String(init?.body || '{}'));
    const prompt = request.contents?.flatMap(item => item.parts || []).map(part => part.text || '').join('\n') || '';
    // A limited-evidence response may make a separate answer-generation call.
    // This assertion concerns reuse of the semantic interpretation only.
    if (prompt.includes('Interpret this question:\n')) processInterpretationCalls += 1;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(interpretation(personalMeaning)) }] } }] }), { status: 200 });
  }
  return new Response('', { status: 503 });
};
try {
  await processAccountingQuery(personalRelief, null, 'SFRS_I', {
    activeProvider: 'gemini', gemini: { apiKey: '0123456789012345', model: 'gemini-3.5-flash-lite' },
    azure: { apiKey: '', endpoint: '', deploymentName: 'gpt-4o', apiVersion: '2024-08-01-preview' },
    openai: { apiKey: '', model: 'gpt-4o' }
  }, 'gemini-3.5-flash-lite', [], { journal: false, statutory: true }, {
    onGroundedContext(context) { productionContext = context; }
  });
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(processInterpretationCalls, 1, 'The production processing and grounding path reuses one validated semantic call.');
assert.deepEqual(productionContext.classification.authorities, ['IRAS']);
assert.equal(productionContext.questionUnderstanding.mode, 'SEMANTIC_PLUS_RULES');

const stalePpeChat = [
  { id: 'old-ppe-query', sender: 'user', text: 'We bought a machine for SGD 90,000 and need to depreciate it.', timestamp: new Date('2026-01-01T00:00:00Z') },
  { id: 'old-ppe-answer', sender: 'assistant', text: 'Machine purchase for SGD 90,000; asset useful life remains open.', timestamp: new Date('2026-01-01T00:01:00Z') }
];
for (const providerCase of [
  { name: 'no provider', provider: undefined },
  { name: 'malformed interpretation', provider: {
    activeProvider: 'gemini', gemini: { apiKey: '0123456789012345', model: 'gemini-3.5-flash-lite' },
    azure: { apiKey: '', endpoint: '', deploymentName: 'gpt-4o', apiVersion: '2024-08-01-preview' },
    openai: { apiKey: '', model: 'gpt-4o' }
  } }
]) {
  let fallbackContext;
  globalThis.fetch = async (url, init) => {
    if (providerCase.name === 'malformed interpretation' && String(url).includes('generateContent')) {
      const body = JSON.parse(init.body);
      if (body.systemInstruction?.parts?.[0]?.text.includes('Interpret the user question only')) {
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{malformed' }] } }] }), { status: 200 });
      }
    }
    return new Response('', { status: 503 });
  };
  try {
    const fallbackHistory = [...stalePpeChat, {
      id: 'parent-relief-current', sender: 'user', text: parentReliefQuery, timestamp: new Date('2026-01-02T00:00:00Z')
    }];
    const fallbackResponse = await processAccountingQuery(parentReliefQuery, priorPpe, 'SFRS_I', providerCase.provider,
      'gemini-3.5-flash-lite', fallbackHistory, { journal: false, statutory: true }, {
        onGroundedContext(context) { fallbackContext = context; }
      });
    assert.ok(fallbackContext, `${providerCase.name}: production reached grounded IRAS handling.`);
    assert.equal(fallbackContext.userFacts.some(fact => /machine|90000|machinery/i.test(fact)), false,
      `${providerCase.name}: standalone IRAS grounding drops unrelated PPE facts even without a validated interpretation.`);
    assert.equal(fallbackContext.missingFacts.some(fact => /useful life|asset/i.test(fact)), false);
    assert.ok(!fallbackResponse.scenarioState.factAmendments?.some(item => item.field === 'amount'),
      `${providerCase.name}: standalone IRAS fallback does not inherit correction provenance.`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const compositeGstQuery = 'A GST-registered Singapore supplier made a standard-rated domestic supply for SGD 1,000 tax-exclusive on 1 July 2023; the invoice was issued on 2 July 2023 and payment was received on 1 July 2023. What are output GST and the invoice total, and should the supplier register for GST?';
const compositeGstMeaning = interpretation({
  domain: 'IRAS_GST', population: 'COMPANY', primarySubject: 'standard-rated output GST and supplier registration',
  concepts: [{ concept: 'output GST calculation', role: 'PRIMARY' }, { concept: 'GST registration threshold', role: 'RELATED' }],
  requestedOperation: 'CALCULATE', calculationRequested: true, requiresUserSpecificFacts: true,
  factsExplicitlyProvided: ['tax-exclusive supply amount SGD 1,000', 'supply date 1 July 2023', 'invoice issued 2 July 2023', 'payment received 1 July 2023']
});
let finalProviderBody;
let historyGroundedContext;
globalThis.fetch = async (url, init) => {
  const urlText = String(url);
  if (!urlText.includes('generativelanguage.googleapis.com')) return new Response('', { status: 503 });
  const body = JSON.parse(init.body);
  const systemText = body.systemInstruction?.parts?.[0]?.text || '';
  if (systemText.includes('Interpret the user question only')) {
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(compositeGstMeaning) }] } }] }), { status: 200 });
  }
  if (urlText.includes('streamGenerateContent')) return new Response('', { status: 503 });
  if (urlText.includes(':generateContent')) {
    finalProviderBody = body;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ taxClaims: [], directAnswer: 'Please provide details about the registration threshold.' }) }] } }] }), { status: 200 });
  }
  return new Response('', { status: 503 });
};
try {
  await processAccountingQuery(compositeGstQuery, priorPpe, 'SFRS_I', {
    activeProvider: 'gemini', gemini: { apiKey: '0123456789012345', model: 'gemini-3.5-flash-lite' },
    azure: { apiKey: '', endpoint: '', deploymentName: 'gpt-4o', apiVersion: '2024-08-01-preview' },
    openai: { apiKey: '', model: 'gpt-4o' }
  }, 'gemini-3.5-flash-lite', [...stalePpeChat, {
    id: 'current-gst-query', sender: 'user', text: compositeGstQuery, timestamp: new Date('2026-01-02T00:00:00Z')
  }], { journal: false, statutory: true }, {
    onGroundedContext(context) { historyGroundedContext = context; }
  });
} finally {
  globalThis.fetch = originalFetch;
}
assert.ok(historyGroundedContext);
assert.ok(finalProviderBody, 'A limited but non-insufficient IRAS evidence result reaches the configured answer provider.');
const finalContentsText = finalProviderBody.contents.flatMap(item => item.parts.map(part => 'text' in part ? part.text : '')).join('\n');
assert.ok(finalContentsText.includes(compositeGstQuery), 'The final provider receives the current user question.');
assert.doesNotMatch(finalContentsText, /machine for SGD 90,000|asset useful life remains open|Machine purchase for SGD 90,000/i,
  'A standalone IRAS answer request cannot see prior PPE facts in any provider adapter history.');
assert.equal(historyGroundedContext.userFacts.some(fact => /machine|90000|machinery/i.test(fact)), false);

console.log('Semantic question understanding and guarded routing regressions passed.');
