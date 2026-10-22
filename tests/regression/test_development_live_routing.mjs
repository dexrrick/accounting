import assert from 'node:assert/strict';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import {
  getRequestedQuestionConcepts,
  interpretSemanticQuestion,
  reconcileQuestionUnderstanding
} from '../../src/services/semanticQuestionUnderstanding.ts';
import { defaultTransactionUnderstandingService } from '../../src/services/transactionUnderstandingService.ts';
import { IRAS_SOURCE_MAP_DEFINITIONS, getCoverageTopicsByIds } from '../../src/standards/coverageRegistry.ts';
import { defaultQueryTopicResolver } from '../../src/retrieval/queryTopicResolver.ts';
import { matchesRequestedQuestionConcept } from '../../src/retrieval/evidenceQualityGate.ts';
import { supportGeneralIrasRuleConcept } from '../../src/retrieval/irasRuleConceptSupport.ts';

const residencyQuery = 'For Singapore corporate income tax, is incorporation in Singapore alone enough to make a company tax resident? Explain the general control-and-management test using IRAS guidance. Do not calculate tax or create journal entries.';
const cpfTopUpQuery = 'Under IRAS rules, can cash top-ups to my own CPF Special Account or Retirement Account qualify for tax relief? Explain the general eligibility conditions and relief limits using official IRAS guidance. This is a general rules question; do not calculate my personal tax or create journal entries.';
const compulsoryCpfQuery = 'Can an employee claim personal income tax relief for compulsory CPF contributions? Explain the general IRAS rule.';
const mixedCpfReliefQuery = 'Can an employee claim personal income tax relief for compulsory CPF contributions and cash top-ups to the employee’s own Special Account? Explain both general IRAS rules.';
const passengerCarQuery = 'A Singapore GST-registered business purchases a private passenger motor car for business use. Is the GST on the purchase generally claimable as input tax? Explain the general IRAS restriction and relevant exceptions. Do not calculate amounts or create journal entries.';
const acraQuery = 'A Singapore-incorporated private company limited by shares is unlisted, has no overseas branch register, and has financial year end 31/12/2025. What is its ACRA annual return filing deadline? Give the deadline date and official basis. Do not create journal entries.';

function semanticPayload({ domain, population, authority, subject, operation, topicIds = [] }) {
  return {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: [authority],
    contextualAuthorities: [],
    domain,
    population,
    primarySubject: subject,
    concepts: [{ concept: subject, role: 'PRIMARY' }],
    requestedOperation: operation,
    factsExplicitlyProvided: [],
    confidence: 0.96,
    issues: [{
      subject, population, domain, governingAuthorities: [authority], contextualAuthorities: [], operation,
      mappedTopicIds: topicIds, evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.96
    }]
  };
}

async function reconciledTopicIds(query, { domain, population, authority, subject, operation }) {
  const understanding = await interpretSemanticQuestion(query, 'synthetic-development-provider', async () => JSON.stringify(
    semanticPayload({ domain, population, authority, subject, operation })
  ));
  const reconciliation = reconcileQuestionUnderstanding(query, classifyQuestion(query), understanding);
  return reconciliation.issuePlan.issues.flatMap(issue => issue.mappedTopicIds);
}

const residencyPayload = semanticPayload({
  domain: 'IRAS_INCOME_TAX', population: 'COMPANY', authority: 'IRAS',
  subject: 'company tax residency and control and management test', operation: 'CHECK_ELIGIBILITY'
});
const residencyUnderstanding = await interpretSemanticQuestion(residencyQuery, 'synthetic-development-provider',
  async () => JSON.stringify(residencyPayload));
assert.equal(residencyUnderstanding.mode, 'SEMANTIC_INTERPRETATION');
assert.equal(residencyUnderstanding.interpretation.requestedOperation, 'EXPLAIN_RULE',
  'the multi-sentence incorporation question is normalized to a general rule request');
assert.equal(residencyUnderstanding.interpretation.requiresUserSpecificFacts, false);
const residencyClassification = classifyQuestion(residencyQuery);
const residencyReconciledTopics = reconcileQuestionUnderstanding(
  residencyQuery, residencyClassification, residencyUnderstanding
).issuePlan.issues.flatMap(issue => issue.mappedTopicIds);
assert.ok(residencyReconciledTopics.includes('iras-corporate-tax-residency'),
  'residency reconciliation retains its explicit IRAS topic');
assert.equal(residencyClassification.intent, 'STATUTORY_ADVISORY');
assert.equal(residencyClassification.calculationRequired, false, 'a negated calculation is not an active request');
assert.equal(residencyClassification.journalEntryRequired, false);
assert.deepEqual(residencyClassification.missingFacts, [], 'general tax-residency rules do not require transaction facts');
assert.deepEqual(defaultTransactionUnderstandingService.understandTransactionSync(residencyQuery).factsMissing, [],
  'a company mentioned in a general residency rule does not create transaction amount, currency or settlement questions');
const appliedResidencyQuery = 'Our company was incorporated in Singapore on 01/04/2024. Determine its tax residency for YA 2025 from where control and management occurred.';
const appliedResidency = await interpretSemanticQuestion(appliedResidencyQuery, 'synthetic-development-provider', async () => JSON.stringify(
  semanticPayload({ domain: 'IRAS_INCOME_TAX', population: 'COMPANY', authority: 'IRAS',
    subject: 'company tax residency determination', operation: 'DETERMINE_TREATMENT' })
));
assert.equal(appliedResidency.interpretation.requestedOperation, 'DETERMINE_TREATMENT',
  'a genuine company-specific residency application remains case-specific');
assert.equal(appliedResidency.interpretation.requiresUserSpecificFacts, true);

const topUpConcepts = getRequestedQuestionConcepts(cpfTopUpQuery);
const topUpClassification = classifyQuestion(cpfTopUpQuery);
const topUpResolverTopics = defaultQueryTopicResolver.decomposeQuery(cpfTopUpQuery).topics.map(topic => topic.id);
assert.ok(topUpResolverTopics.includes('iras-individual-cpf-cash-top-up-relief'));
assert.ok(!topUpResolverTopics.includes('iras-individual-cpf-relief'),
  'shared topic resolution does not add compulsory employee CPF relief to a cash-top-up-only request');
const topUpReconciledTopics = await reconciledTopicIds(cpfTopUpQuery, {
  domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL', authority: 'IRAS',
  subject: 'cash top-up relief for own CPF Special Account or Retirement Account', operation: 'EXPLAIN_RULE'
});
assert.ok(topUpReconciledTopics.includes('iras-individual-cpf-cash-top-up-relief'));
assert.ok(!topUpReconciledTopics.includes('iras-individual-cpf-relief'),
  'cash top-up reconciliation excludes compulsory employee CPF relief');
assert.equal(topUpClassification.intent, 'STATUTORY_ADVISORY');
assert.equal(topUpClassification.calculationRequired, false, 'the negated personal-tax calculation is not an active request');
assert.equal(topUpClassification.journalEntryRequired, false);
assert.deepEqual(defaultTransactionUnderstandingService.understandTransactionSync(cpfTopUpQuery).factsMissing, [],
  'the general cash top-up relief question requires no transaction currency, amount or settlement facts');
assert.ok(topUpConcepts.some(item => item.id === 'cpf_cash_top_up_relief' &&
  item.topicIds.includes('iras-individual-cpf-cash-top-up-relief')));
assert.ok(!topUpConcepts.some(item => item.id === 'cpf_relief' || item.topicIds.includes('iras-individual-cpf-relief')),
  'cash top-ups do not inherit compulsory employee-contribution relief coverage');
const topUpTopic = getCoverageTopicsByIds(['iras-individual-cpf-cash-top-up-relief'])[0];
assert.ok(topUpTopic, 'cash top-up relief has its own canonical coverage topic');
const topUpSource = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.topicIds.includes('iras-individual-cpf-cash-top-up-relief'));
assert.equal(topUpSource?.canonicalSourceUrl,
  'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-reliefs-rebates-and-deductions/tax-reliefs/central-provident-fund-(cpf)-cash-top-up-relief');
assert.ok(getRequestedQuestionConcepts(compulsoryCpfQuery).some(item =>
  item.id === 'cpf_relief' && item.topicIds.includes('iras-individual-cpf-relief')),
  'compulsory employee CPF relief continues to use its distinct IRAS coverage');
const mixedCpfReliefConcepts = getRequestedQuestionConcepts(mixedCpfReliefQuery);
const mixedCpfResolverTopics = defaultQueryTopicResolver.decomposeQuery(mixedCpfReliefQuery).topics.map(topic => topic.id);
assert.ok(mixedCpfResolverTopics.includes('iras-individual-cpf-relief'));
assert.ok(mixedCpfResolverTopics.includes('iras-individual-cpf-cash-top-up-relief'),
  'shared topic resolution retains both explicitly requested CPF relief workstreams');
const mixedCpfReconciledTopics = await reconciledTopicIds(mixedCpfReliefQuery, {
  domain: 'IRAS_INCOME_TAX', population: 'EMPLOYEE', authority: 'IRAS',
  subject: 'compulsory CPF contributions and cash top-up tax relief', operation: 'EXPLAIN_RULE'
});
assert.ok(mixedCpfReconciledTopics.includes('iras-individual-cpf-relief') &&
  mixedCpfReconciledTopics.includes('iras-individual-cpf-cash-top-up-relief'),
  'reconciliation preserves compulsory and cash top-up relief when both are asked');
const employeeTitleCpfTopics = defaultQueryTopicResolver.decomposeQuery(
  'Explain CPF relief for employees. Also explain CPF cash top-up relief.'
).topics.map(topic => topic.id);
assert.ok(employeeTitleCpfTopics.includes('iras-individual-cpf-relief') &&
  employeeTitleCpfTopics.includes('iras-individual-cpf-cash-top-up-relief'),
  'canonical employee-CPF topic wording remains distinct when both relief topics are requested');
const mandatoryContributionsToCpfTopics = defaultQueryTopicResolver.decomposeQuery(
  'Explain personal income tax relief for mandatory contributions to CPF and cash top-ups to my Special Account.'
).topics.map(topic => topic.id);
assert.ok(mandatoryContributionsToCpfTopics.includes('iras-individual-cpf-relief') &&
  mandatoryContributionsToCpfTopics.includes('iras-individual-cpf-cash-top-up-relief'),
  'mandatory contributions-to-CPF wording retains both separately requested relief topics');
const employeeAudienceOnlyTopics = defaultQueryTopicResolver.decomposeQuery(
  'As an employee, explain CPF cash top-up relief.'
).topics.map(topic => topic.id);
assert.ok(!employeeAudienceOnlyTopics.includes('iras-individual-cpf-relief') &&
  employeeAudienceOnlyTopics.includes('iras-individual-cpf-cash-top-up-relief'),
  'an employee audience alone does not request compulsory employee CPF relief');
assert.ok(mixedCpfReliefConcepts.some(item => item.id === 'cpf_relief' && item.topicIds.includes('iras-individual-cpf-relief')));
assert.ok(mixedCpfReliefConcepts.some(item => item.id === 'cpf_cash_top_up_relief' && item.topicIds.includes('iras-individual-cpf-cash-top-up-relief')),
  'a query asking about both compulsory contributions and a cash top-up keeps both distinct concepts');

const passengerCarClassification = classifyQuestion(passengerCarQuery);
const passengerCarResolverTopics = defaultQueryTopicResolver.decomposeQuery(passengerCarQuery).topics.map(topic => topic.id);
assert.ok(passengerCarResolverTopics.includes('iras-gst-blocked-input-tax'));
assert.ok(passengerCarResolverTopics.includes('iras-gst-motor-vehicles'));
assert.ok(!passengerCarResolverTopics.includes('iras-gst-input-tax') &&
  !passengerCarResolverTopics.includes('iras-gst-invoicing'),
'shared topic resolution excludes generic GST input-tax and invoicing topics for the car-only question');
const passengerCarFullTaxNameTopics = defaultQueryTopicResolver.decomposeQuery(
  'A Singapore business purchases a private passenger motor car. Is goods and services tax on the purchase generally claimable as input tax? Explain the IRAS restriction and relevant exceptions.'
).topics.map(topic => topic.id);
assert.ok(passengerCarFullTaxNameTopics.includes('iras-gst-blocked-input-tax') &&
  !passengerCarFullTaxNameTopics.includes('iras-gst-input-tax') &&
  !passengerCarFullTaxNameTopics.includes('iras-gst-invoicing'),
  'the full phrase “goods and services tax” is not mistaken for a separate services input-tax workstream');
const passengerCarReconciledTopics = await reconciledTopicIds(passengerCarQuery, {
  domain: 'IRAS_GST', population: 'COMPANY', authority: 'IRAS',
  subject: 'private passenger motor car blocked input tax restriction and exceptions', operation: 'EXPLAIN_RULE'
});
assert.ok(passengerCarReconciledTopics.includes('iras-gst-blocked-input-tax') &&
  passengerCarReconciledTopics.includes('iras-gst-motor-vehicles'));
assert.ok(!passengerCarReconciledTopics.includes('iras-gst-input-tax') &&
  !passengerCarReconciledTopics.includes('iras-gst-invoicing'),
  'car-only reconciliation excludes generic input-tax and invoicing topics');
assert.equal(passengerCarClassification.intent, 'STATUTORY_ADVISORY');
assert.equal(passengerCarClassification.calculationRequired, false, 'the negated amount calculation is not active');
assert.equal(passengerCarClassification.journalEntryRequired, false, 'the negated journal request is not active');
const passengerCarUnderstanding = defaultTransactionUnderstandingService.understandTransactionSync(passengerCarQuery);
assert.deepEqual(passengerCarUnderstanding.factsMissing, [],
  'a general motor-car input-tax restriction question needs no transaction currency, amount or settlement facts');
assert.ok(passengerCarClassification.topicIds.includes('iras-gst-blocked-input-tax'));
assert.ok(passengerCarClassification.topicIds.includes('iras-gst-motor-vehicles'));
assert.ok(!passengerCarClassification.topicIds.includes('iras-gst-input-tax') &&
  !passengerCarClassification.topicIds.includes('iras-gst-invoicing'),
  'motor-car blocking rules do not inherit unrelated generic input-tax or invoicing topics');
const carAndRegistrationClassification = classifyQuestion(
  `${passengerCarQuery} Also explain the compulsory GST registration threshold and taxable-turnover test.`
);
const carAndRegistrationResolverTopics = defaultQueryTopicResolver.decomposeQuery(
  `${passengerCarQuery} Also explain the compulsory GST registration threshold and taxable-turnover test.`
).topics.map(topic => topic.id);
assert.ok(carAndRegistrationResolverTopics.includes('gst_compulsory_registration'),
  'an independent registration ask remains in shared topic resolution alongside the car issue');
assert.ok(carAndRegistrationClassification.topicIds.includes('iras-gst-blocked-input-tax'));
assert.ok(carAndRegistrationClassification.topicIds.includes('gst_compulsory_registration'),
  'an explicit registration-threshold workstream remains alongside the passenger-car input-tax issue');
const carAndEquipmentInputTaxClassification = classifyQuestion(
  `${passengerCarQuery} Also explain general conditions for a business to claim input GST on office equipment purchases.`
);
const carAndEquipmentResolverTopics = defaultQueryTopicResolver.decomposeQuery(
  `${passengerCarQuery} Also explain general conditions for a business to claim input GST on office equipment purchases.`
).topics.map(topic => topic.id);
assert.ok(carAndEquipmentResolverTopics.includes('iras-gst-blocked-input-tax') &&
  carAndEquipmentResolverTopics.includes('iras-gst-input-tax'),
'shared topic resolution preserves an independent equipment input-tax ask');
assert.ok(carAndEquipmentInputTaxClassification.topicIds.includes('iras-gst-blocked-input-tax') &&
  carAndEquipmentInputTaxClassification.topicIds.includes('iras-gst-input-tax'),
'a separate ordinary equipment input-tax request remains alongside the passenger-car restriction');
const carAndEquipmentReconciledTopics = await reconciledTopicIds(
  `${passengerCarQuery} Also explain general conditions for a business to claim input GST on office equipment purchases.`, {
    domain: 'IRAS_GST', population: 'COMPANY', authority: 'IRAS',
    subject: 'private passenger motor car restriction and office equipment input GST conditions', operation: 'EXPLAIN_RULE'
  }
);
assert.ok(carAndEquipmentReconciledTopics.includes('iras-gst-blocked-input-tax') &&
  carAndEquipmentReconciledTopics.includes('iras-gst-input-tax'),
  'reconciliation preserves both car and independent equipment input-tax issues');
const equipmentInputTaxAndCarClassification = classifyQuestion(
  'Explain the general conditions for a business to claim input GST on office equipment purchases. Also explain whether GST on a private passenger motor car is generally claimable.'
);
const equipmentInputTaxAndCarResolverTopics = defaultQueryTopicResolver.decomposeQuery(
  'Explain the general conditions for a business to claim input GST on office equipment purchases. Also explain whether GST on a private passenger motor car is generally claimable.'
).topics.map(topic => topic.id);
assert.ok(equipmentInputTaxAndCarResolverTopics.includes('iras-gst-input-tax') &&
  equipmentInputTaxAndCarResolverTopics.includes('iras-gst-blocked-input-tax'),
'shared topic resolution preserves both GST topics when the ordinary input-tax clause comes first');
assert.ok(equipmentInputTaxAndCarClassification.topicIds.includes('iras-gst-input-tax') &&
  equipmentInputTaxAndCarClassification.topicIds.includes('iras-gst-blocked-input-tax'),
'the ordinary equipment input-tax topic survives when its explicit clause precedes the passenger-car clause');
const equipmentInputTaxAndCarReconciledTopics = await reconciledTopicIds(
  'Explain the general conditions for a business to claim input GST on office equipment purchases. Also explain whether GST on a private passenger motor car is generally claimable.', {
    domain: 'IRAS_GST', population: 'COMPANY', authority: 'IRAS',
    subject: 'office equipment input GST and private passenger motor car restriction', operation: 'EXPLAIN_RULE'
  }
);
assert.ok(equipmentInputTaxAndCarReconciledTopics.includes('iras-gst-input-tax') &&
  equipmentInputTaxAndCarReconciledTopics.includes('iras-gst-blocked-input-tax'),
  'reconciliation preserves both topics when the separate equipment clause comes first');
const carAndVanGstTopics = defaultQueryTopicResolver.decomposeQuery(
  `${passengerCarQuery} Also explain whether input GST on a commercial delivery van is generally claimable.`
).topics.map(topic => topic.id);
assert.ok(carAndVanGstTopics.includes('iras-gst-blocked-input-tax') && carAndVanGstTopics.includes('iras-gst-input-tax'),
  'a separate commercial-van input-tax ask is retained alongside a passenger-car restriction');
const carAndServicesGstTopics = defaultQueryTopicResolver.decomposeQuery(
  `${passengerCarQuery} Also explain whether input GST on professional services is generally claimable.`
).topics.map(topic => topic.id);
assert.ok(carAndServicesGstTopics.includes('iras-gst-blocked-input-tax') && carAndServicesGstTopics.includes('iras-gst-input-tax'),
  'a separate services input-tax ask is retained alongside a passenger-car restriction');
assert.deepEqual(passengerCarClassification.missingFacts, [], 'the general restriction/exception query does not ask for an unnecessary case file');
const blockedCarConcept = getRequestedQuestionConcepts(passengerCarQuery).find(item => item.id === 'gst_blocked_motor_car_input_tax');
assert.ok(blockedCarConcept, 'the request includes a distinct blocked-motor-car input-tax concept');
assert.equal(supportGeneralIrasRuleConcept({
  sourceText: 'Input tax may generally be claimed for purchases used to make taxable supplies when the business holds a valid tax invoice.',
  domainId: 'IRAS_GST', topicIds: ['iras-gst-blocked-input-tax'], subject: blockedCarConcept.label,
  population: 'COMPANY', concepts: [blockedCarConcept]
}), undefined, 'a generic positive input-tax rule cannot establish the specific blocked-car rule');
assert.equal(matchesRequestedQuestionConcept(
  'Input tax may generally be claimed for purchases used to make taxable supplies when the business holds a valid tax invoice.',
  blockedCarConcept,
  { domainId: 'IRAS_GST', topicIds: ['iras-gst-blocked-input-tax'], subject: blockedCarConcept.label, population: 'COMPANY' }
), false, 'generic input-tax entitlement does not satisfy the motor-car restriction concept');

const acraClassification = classifyQuestion(acraQuery);
assert.equal(acraClassification.primaryDomain, 'CORPORATE_REGULATORY');
assert.equal(acraClassification.accountingAnalysisRequired, false);
assert.equal(acraClassification.journalEntryRequired, false);
const acraDecomposition = defaultQueryTopicResolver.decomposeQuery(acraQuery);
assert.ok(acraDecomposition.topics.some(topic => topic.id === 'acra_annual-returns'));
const acraUnderstanding = await interpretSemanticQuestion(acraQuery, 'synthetic-development-provider', async () => JSON.stringify(
  semanticPayload({ domain: 'ACRA_CORPORATE', population: 'COMPANY', authority: 'ACRA',
    subject: 'company annual return filing deadline', operation: 'FILING_REQUIREMENT', topicIds: ['acra_annual-returns'] })
));
const acraReconciliation = reconcileQuestionUnderstanding(acraQuery, acraClassification, acraUnderstanding);
assert.ok(acraReconciliation.issuePlan.issues.some(issue => issue.domain === 'ACRA_CORPORATE' &&
  issue.population === 'COMPANY' && issue.operation === 'FILING_REQUIREMENT' &&
  issue.mappedTopicIds.includes('acra_annual-returns')),
'the dated ACRA query retains its matched filing topic without asserting unrelated residual coverage');

const genuineTransaction = defaultTransactionUnderstandingService.understandTransactionSync(
  'We bought machinery.'
);
assert.ok(genuineTransaction.factsMissing.some(item => /currency/i.test(item)),
  'a genuine transaction continues to request missing currency');
assert.ok(genuineTransaction.factsMissing.some(item => /payment|settlement/i.test(item)),
  'a genuine transaction continues to request missing payment timing');
assert.ok(genuineTransaction.factsMissing.some(item => /amount/i.test(item)),
  'a genuine transaction continues to request a missing transaction amount when absent');

console.log('PASS development live routing regressions');
