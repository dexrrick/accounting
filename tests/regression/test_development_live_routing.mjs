import assert from 'node:assert/strict';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
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
import { removeNegatedOutputDirectives } from '../../src/utils/journalRequestIntent.ts';

const residencyQuery = 'For Singapore corporate income tax, is incorporation in Singapore alone enough to make a company tax resident? Explain the general control-and-management test using IRAS guidance. Do not calculate tax or create journal entries.';
const cpfTopUpQuery = 'Under IRAS rules, can cash top-ups to my own CPF Special Account or Retirement Account qualify for tax relief? Explain the general eligibility conditions and relief limits using official IRAS guidance. This is a general rules question; do not calculate my personal tax or create journal entries.';
const compulsoryCpfQuery = 'Can an employee claim personal income tax relief for compulsory CPF contributions? Explain the general IRAS rule.';
const mixedCpfReliefQuery = 'Can an employee claim personal income tax relief for compulsory CPF contributions and cash top-ups to the employee’s own Special Account? Explain both general IRAS rules.';
const passengerCarQuery = 'A Singapore GST-registered business purchases a private passenger motor car for business use. Is the GST on the purchase generally claimable as input tax? Explain the general IRAS restriction and relevant exceptions. Do not calculate amounts or create journal entries.';
const acraQuery = 'A Singapore-incorporated private company limited by shares is unlisted, has no overseas branch register, and has financial year end 31/12/2025. What is its ACRA annual return filing deadline? Give the deadline date and official basis. Do not create journal entries.';
const authorityRuleOnlyQueries = [
  {
    authority: 'ACRA', topicId: 'acra_annual-returns',
    query: 'Under ACRA guidance, must Singapore-incorporated companies file annual returns? Explain the general filing duty using official ACRA guidance. Do not calculate a deadline or create journal entries.'
  },
  {
    authority: 'CPF', topicId: 'cpf-ordinary-wages',
    query: 'Under CPF Board guidance, what makes a payment ordinary wages for CPF contributions? Explain the general definition using official CPF Board guidance. Do not calculate contribution rates or amounts and do not create journal entries.'
  },
  {
    authority: 'MOM', topicId: 'mom-part-iv-overtime',
    query: 'Under MOM guidance, which employees are covered by Part IV of the Employment Act for working hours and overtime? Explain the general coverage using official MOM guidance. Do not calculate pay or create journal entries.'
  },
  {
    authority: 'MAS', topicId: 'mas-cms-licence',
    query: 'Under MAS guidance, what is a Capital Markets Services Licence and when is it generally required? Explain the general licensing requirement using official MAS guidance. Do not assess a particular business or create journal entries.'
  }
];

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
}), false, 'the recognized blocked-car concept rejects a generic positive input-tax rule as support for its specific restriction');
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

for (const sample of authorityRuleOnlyQueries) {
  const classification = classifyQuestion(sample.query);
  const topicIds = defaultQueryTopicResolver.decomposeQuery(sample.query).topics.map(topic => topic.id);
  assert.equal(classification.intent, 'STATUTORY_ADVISORY', `${sample.authority} output restrictions remain rule-only.`);
  assert.equal(classification.calculationRequired, false, `${sample.authority} negative calculation output is inactive.`);
  assert.equal(classification.journalEntryRequired, false, `${sample.authority} negative journal output is inactive.`);
  assert.equal(classification.accountingAnalysisRequired, false);
  assert.equal(classification.regulatoryAnalysisRequired, true);
  assert.ok(classification.authorities.includes(sample.authority), `${sample.authority} remains the governing authority.`);
  assert.ok(classification.topicIds.includes(sample.topicId), `${sample.authority} keeps its intended coverage topic.`);
  assert.ok(topicIds.includes(sample.topicId), `${sample.authority} topic resolution keeps the intended topic.`);
  if (sample.authority === 'CPF') {
    assert.deepEqual(classification.authorities, ['CPF'], 'An excluded CPF rate calculation does not invent IRAS or MOM workstreams.');
    assert.equal(topicIds.includes('cpf_contribution_rates'), false,
      'An expressly excluded CPF rate calculation does not create a rate topic.');
  }
}

const negativeDirectiveOnly = removeNegatedOutputDirectives(
  'No GST applies. Do not calculate contribution rates or amounts and do not create journal entries.'
);
assert.match(negativeDirectiveOnly, /No GST applies\./,
  'Intent normalization preserves accounting facts and negated accounting conditions.');
assert.doesNotMatch(negativeDirectiveOnly, /calculate contribution rates|create journal entries/i);

const separateNegativeCalculationThenJournal = classifyQuestion(
  'Do not calculate tax. Prepare journal entries for the stated transaction.'
);
assert.equal(separateNegativeCalculationThenJournal.calculationRequired, false);
assert.equal(separateNegativeCalculationThenJournal.journalEntryRequired, true,
  'A separate affirmative journal request survives a negative calculation directive.');
const coordinatedNegativeCalculationThenJournal = classifyQuestion(
  'Do not calculate tax but prepare journal entries for the stated transaction.'
);
assert.equal(coordinatedNegativeCalculationThenJournal.calculationRequired, false);
assert.equal(coordinatedNegativeCalculationThenJournal.journalEntryRequired, true,
  'A positive journal request after “but” remains active.');
const positiveCpfRatesBesideNegativeCalculation = defaultQueryTopicResolver.decomposeQuery(
  'Under CPF Board guidance, what makes a payment ordinary wages for CPF contributions? Do not calculate contribution rates or amounts, but explain which contribution rates apply to ordinary wages.'
).topics.map(topic => topic.id);
assert.ok(positiveCpfRatesBesideNegativeCalculation.includes('cpf-ordinary-wages'));
assert.ok(positiveCpfRatesBesideNegativeCalculation.includes('cpf_contribution_rates'),
  'A separate affirmative request about applicable CPF rates remains in topic resolution.');
for (const [query, expectedRateTopic] of [
  ['Calculate CPF contributions on ordinary wages.', true],
  ['How do I compute CPF on ordinary wages?', false],
  ['Calculate employer and employee CPF contributions for SGD 6,000 ordinary wages.', true]
]) {
  const classification = classifyQuestion(query);
  assert.equal(defaultQueryTopicResolver.decomposeQuery(query).topics.some(topic => topic.id === 'cpf_contribution_rates'),
    expectedRateTopic, `Positive CPF wording preserves its existing rate-topic match: ${query}`);
  assert.equal(classification.calculationRequired, true, `A genuine CPF calculation remains active: ${query}`);
  assert.equal(classification.journalEntryRequired, true, `A genuine CPF payroll calculation remains active: ${query}`);
}
const qualifiedNegativeCalculationQueries = [
  'Explain general Singapore income tax residency rules. Do not calculate corporate tax.',
  'Under MOM guidance, what overtime pay rules apply under the Employment Act? Explain the general rule. Do not calculate overtime pay.',
  'Explain IFRS 17 general rules for insurance contracts. Do not calculate insurance contract amounts. Do not create journal entries.'
];
for (const query of qualifiedNegativeCalculationQueries) {
  const classification = classifyQuestion(query);
  assert.equal(classification.calculationRequired, false, `Qualified negative calculation output stays inactive: ${query}`);
  assert.equal(classification.journalEntryRequired, false, `Qualified negative calculation output does not request a journal: ${query}`);
}
for (const query of [
  'Do not calculate corporate tax, but calculate depreciation.',
  'Do not calculate overtime pay; instead calculate the benefit amount.',
  'Do not calculate insurance contract amounts. However, calculate an annual premium.'
]) {
  const normalized = removeNegatedOutputDirectives(query);
  assert.match(normalized, /\bcalculate\b/i, `Positive calculation wording remains available: ${query}`);
}
const qualifiedNegativeThenPositiveCalculation = classifyQuestion(
  'Do not calculate corporate tax, but calculate depreciation for the recognized asset.'
);
assert.equal(qualifiedNegativeThenPositiveCalculation.calculationRequired, true,
  'A positive calculation after “but” survives a qualified negative tax output.');
const qualifiedNegativeThenJournal = classifyQuestion(
  'Do not calculate corporate tax, but prepare journal entries for the stated transaction.'
);
assert.equal(qualifiedNegativeThenJournal.calculationRequired, false);
assert.equal(qualifiedNegativeThenJournal.journalEntryRequired, true,
  'An affirmative journal request after a qualified negative calculation survives.');
const datedAcraRuleOnly = 'Under ACRA guidance, must Singapore-incorporated companies file annual returns for FYE 31/12/2025? Do not calculate a deadline or create journal entries.';
const datedAcraClassification = classifyQuestion(datedAcraRuleOnly);
assert.equal(datedAcraClassification.currentInformationRequired, true,
  'Date facts remain available to current-information checks after output-intent normalization.');
assert.ok(datedAcraClassification.topicIds.includes('acra_annual-returns'));

const originalFetch = globalThis.fetch;
const blockedSourceCalls = [];
globalThis.fetch = async input => {
  blockedSourceCalls.push(String(input));
  throw new Error('Rule-only no-provider regression must remain offline.');
};
try {
  for (const sample of authorityRuleOnlyQueries) {
    const response = await processAccountingQuery(sample.query, null, 'SFRS_I');
    assert.equal(response.scenarioState.scenarioType, 'AUTHORITY_ADVISORY',
      `${sample.authority} stays on the user-visible authority advisory path without a semantic provider.`);
    assert.equal(response.scenarioState.queryIntent, 'STATUTORY_ADVISORY');
    assert.deepEqual(response.scenarioState.directGroups, [], `${sample.authority} does not create direct journal groups.`);
    const presentation = response.scenarioState.authorityEvidencePresentation;
    assert.ok(presentation, `${sample.authority} retains an authority evidence presentation.`);
    assert.equal(presentation.status, 'INSUFFICIENT', `${sample.authority} no-provider evidence remains explicitly incomplete.`);
    assert.ok(presentation.gaps.length > 0, `${sample.authority} keeps honest no-provider or request-completeness gaps.`);
    assert.ok(presentation.workstreams.some(stream => stream.authority === sample.authority),
      `${sample.authority} remains the governing presentation stream.`);
    assert.deepEqual(presentation.workstreams.flatMap(stream => stream.sources), [],
      `${sample.authority} does not manufacture or fetch evidence in this offline check.`);
    assert.doesNotMatch(response.messageText, /Clarification Required|journal validation|prepare journal entries/i,
      `${sample.authority} receives no journal-validation clarification.`);
    assert.match(response.messageText, /Evidence is incomplete/);
  }
} finally {
  globalThis.fetch = originalFetch;
}
assert.ok(blockedSourceCalls.length > 0, 'Source discovery requests are intercepted by the offline fetch stub.');

const genuineTransaction = defaultTransactionUnderstandingService.understandTransactionSync(
  'We bought machinery.'
);
assert.ok(genuineTransaction.factsMissing.some(item => /currency/i.test(item)),
  'a genuine transaction continues to request missing currency');
assert.ok(genuineTransaction.factsMissing.some(item => /payment|settlement/i.test(item)),
  'a genuine transaction continues to request missing payment timing');
assert.ok(genuineTransaction.factsMissing.some(item => /amount/i.test(item)),
  'a genuine transaction continues to request a missing transaction amount when absent');

const unsupportedInsuranceRuleQuery = qualifiedNegativeCalculationQueries[2];
const unsupportedInsuranceRuleInterpretation = {
  schemaVersion: 2,
  jurisdiction: ['International'],
  authorityCandidates: ['IFRS_FOUNDATION'],
  contextualAuthorities: [],
  domain: 'ACCOUNTING',
  population: 'COMPANY',
  primarySubject: 'IFRS 17 insurance contracts',
  concepts: [{ concept: 'IFRS 17', role: 'PRIMARY' }],
  requestedOperation: 'EXPLAIN_RULE',
  factsExplicitlyProvided: [],
  confidence: 0.96,
  issues: [{
    subject: 'IFRS 17 insurance contracts', population: 'COMPANY', domain: 'ACCOUNTING',
    governingAuthorities: ['IFRS_FOUNDATION'], contextualAuthorities: [], operation: 'EXPLAIN_RULE',
    mappedTopicIds: [], evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.96
  }]
};
const originalInsuranceFetch = globalThis.fetch;
let unsupportedInsuranceSemanticCalls = 0;
const blockedInsuranceRequests = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  const payload = JSON.parse(init?.body || '{}');
  const prompt = payload.contents?.flatMap(item => item.parts || []).map(part => part.text || '').join('\n') || '';
  if (url.hostname === 'generativelanguage.googleapis.com' && prompt.includes('Return a V2 JSON object')) {
    unsupportedInsuranceSemanticCalls++;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(unsupportedInsuranceRuleInterpretation) }] } }] }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  }
  blockedInsuranceRequests.push({ hostname: url.hostname, prompt });
  throw new Error(`Blocked non-semantic dispatch in offline unsupported-standards regression: ${url.hostname}`);
};
let unsupportedInsuranceResponse;
let unsupportedInsuranceError;
try {
  unsupportedInsuranceResponse = await processAccountingQuery(
    unsupportedInsuranceRuleQuery, null, 'SFRS_I', 'test-key-1234567890'
  );
} catch (error) {
  unsupportedInsuranceError = error;
} finally {
  globalThis.fetch = originalInsuranceFetch;
}
assert.ifError(unsupportedInsuranceError, 'unsupported IFRS 17 explanation returns an explicit evidence gap');
assert.equal(unsupportedInsuranceSemanticCalls, 1, 'unsupported IFRS 17 explanation uses one validated semantic interpretation');
assert.deepEqual(blockedInsuranceRequests, [], 'unsupported IFRS 17 explanation dispatches no source or legacy answer requests');
const unsupportedInsurancePresentation = unsupportedInsuranceResponse.scenarioState.authorityEvidencePresentation;
assert.ok(unsupportedInsurancePresentation, 'unsupported IFRS 17 explanation retains the shared evidence renderer');
assert.equal(unsupportedInsurancePresentation.status, 'INSUFFICIENT');
assert.equal(unsupportedInsuranceResponse.scenarioState.isComplete, false);
assert.deepEqual(unsupportedInsuranceResponse.scenarioState.directGroups, []);
assert.ok(unsupportedInsurancePresentation.workstreams.some(stream =>
  ['ACCOUNTING_STANDARDS', 'IFRS_FOUNDATION'].includes(stream.authority) && stream.domain === 'ACCOUNTING'),
'unsupported IFRS 17 scope remains with the accounting-standards owner');
assert.doesNotMatch(unsupportedInsuranceResponse.messageText, /Clarification Required|journal validation|prepare journal entries/i);

console.log('PASS development live routing regressions');
