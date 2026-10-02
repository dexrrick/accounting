import assert from 'node:assert/strict';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { defaultSourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import {
  buildGroundedReasoningContext,
  postProcessAIResponse,
  resolveMappedOfficialSourceFallback
} from '../../src/services/groundingContextBuilder.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import {
  getCoverageTopicById,
  IRAS_SOURCE_MAP_DEFINITIONS
} from '../../src/standards/coverageRegistry.ts';
import { defaultExternalSourceValidator } from '../../src/retrieval/externalSourceValidator.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';

const htmlResponse = (body, status = 200) => new Response(body, {
  status,
  headers: { 'content-type': 'text/html; charset=utf-8' }
});
const htmlForMap = map => {
  const mappedTopics = map.topicIds.map(getCoverageTopicById).filter(Boolean);
  const pageText = mappedTopics.map(topic => `${topic.title}. ${topic.keywords.join(' ')}.`).join(' ');
  return `<html><head><title>${map.pageTitle}</title></head><body><main><h1>${map.pageTitle}</h1><p>IRAS ${pageText} Official guidance explains the applicable topic, conditions and supporting requirements for businesses.</p></main></body></html>`;
};

const exactPhraseCases = [
  {
    query: 'Can GST be claimed for meals with customers or suppliers?',
    topics: ['iras-gst-entertainment', 'iras-gst-input-tax'],
    sourceMap: 'IRAS_GST_INPUT_TAX_SOURCE_MAP',
    domain: 'IRAS_GST'
  },
  {
    query: 'Can the company claim GST on a passenger car?',
    topics: ['iras-gst-motor-vehicles', 'iras-gst-blocked-input-tax'],
    sourceMap: 'IRAS_GST_MOTOR_VEHICLES_SOURCE_MAP',
    domain: 'IRAS_GST'
  },
  {
    query: 'Can this expense be claimed as a tax deduction?',
    topics: ['iras-cit-deductibility'],
    sourceMap: 'IRAS_CIT_EXPENSES_SOURCE_MAP',
    domain: 'IRAS_CORPORATE_TAX'
  },
  {
    query: 'Can renovation cost be deducted immediately?',
    topics: ['iras-cit-renovation-refurbishment', 'iras-cit-deductibility'],
    sourceMaps: ['IRAS_CIT_RR_SOURCE_MAP', 'IRAS_CIT_EXPENSES_SOURCE_MAP'],
    domain: 'IRAS_CORPORATE_TAX'
  },
  {
    query: 'Can the company use prior-year losses?',
    topics: ['iras-cit-loss-carry-forward', 'iras-substantial-shareholding-test'],
    sourceMap: 'IRAS_CIT_UNUTILISED_ITEMS_SOURCE_MAP',
    domain: 'IRAS_CORPORATE_TAX'
  },
  {
    query: 'An employee received a bonus in April for the June payroll. When should it be reported?',
    topics: ['iras-employee-bonus-timing', 'iras-ais-employment-income'],
    sourceMaps: ['IRAS_EMPLOYMENT_INCOME_TIMING_SOURCE_MAP', 'IRAS_AIS_IR8A_SOURCE_MAP'],
    domain: 'IRAS_EMPLOYER_TAX'
  },
  {
    query: 'Invoice issued in December 2022 but payment received in January 2023. Which GST rate applies?',
    topics: ['iras-gst-time-of-supply', 'iras-gst-standard-rated-supplies'],
    sourceMaps: ['IRAS_GST_TIME_OF_SUPPLY_SOURCE_MAP', 'IRAS_GST_CHARGING_SOURCE_MAP'],
    domain: 'IRAS_GST',
    historical: true
  },
  {
    query: 'A company provides services overseas. Is the income zero-rated or out-of-scope?',
    topics: ['iras-gst-zero-rating', 'iras-gst-out-of-scope-supplies'],
    sourceMaps: ['IRAS_GST_ZERO_RATED_SERVICES_SOURCE_MAP', 'IRAS_GST_OUT_OF_SCOPE_SOURCE_MAP'],
    disallowedMaps: ['IRAS_GST_ZERO_RATED_EXPORT_SOURCE_MAP'],
    domain: 'IRAS_GST'
  },
  {
    query: 'A Singapore company pays interest to an overseas company. Is withholding tax required?',
    topics: ['iras-withholding-tax-interest-royalties', 'iras-withholding-tax'],
    sourceMaps: ['IRAS_WHT_RATES_SOURCE_MAP', 'IRAS_WHT_SCOPE_SOURCE_MAP'],
    domain: 'IRAS_CORPORATE_TAX'
  },
  {
    query: 'A Singapore company pays management fees to an overseas related company. Is withholding tax applicable?',
    topics: ['iras-withholding-tax-management-fees', 'iras-withholding-tax'],
    sourceMaps: ['IRAS_WHT_RATES_SOURCE_MAP', 'IRAS_WHT_SCOPE_SOURCE_MAP'],
    domain: 'IRAS_CORPORATE_TAX'
  }
];

for (const testCase of exactPhraseCases) {
  const classification = classifyQuestion(testCase.query);
  for (const topicId of testCase.topics) {
    assert.ok(classification.topicIds.includes(topicId), `${topicId} resolves for: ${testCase.query}`);
    assert.equal(getCoverageTopicById(topicId).domainId, testCase.domain);
  }
  assert.ok(classification.authorities.includes('IRAS'), `IRAS is the authority for: ${testCase.query}`);

  const selectedMapIds = [...new Set(testCase.topics.flatMap(topicId =>
    getCoverageTopicById(topicId).sourceRecordIds.filter(id => id.startsWith('IRAS_') && id.endsWith('_SOURCE_MAP'))
  ))];
  const expectedMapIds = testCase.sourceMaps || [testCase.sourceMap];
  for (const mapId of expectedMapIds) assert.ok(selectedMapIds.includes(mapId), `${mapId} is registered for: ${testCase.query}`);
  for (const mapId of testCase.disallowedMaps || []) assert.ok(selectedMapIds.includes(mapId), `${mapId} remains explicitly registered for the goods-export question family.`);

  if (!testCase.historical) {
    const expectedMaps = expectedMapIds;
    const expectedMapDefinitions = expectedMaps.map(id => IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === id));
    const fallback = await resolveMappedOfficialSourceFallback(
      testCase.topics, testCase.query, defaultSourceRetriever,
      {
        discoveryAdapter: { discoverOfficialSourceCandidates: async () => [] },
        webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
        fetchOptions: {
          useCache: false,
          customFetch: async url => {
            const map = expectedMapDefinitions.find(item => item.canonicalSourceUrl === url) ||
              IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.canonicalSourceUrl === url);
            return htmlResponse(htmlForMap(map));
          }
        }
      }
    );
    assert.ok(testCase.topics.some(topicId => fallback.records.some(record => record.tags.includes(topicId))), `Reviewed IRAS content is selected for: ${testCase.query}; trace=${JSON.stringify(fallback.trace)}`);
    for (const mapId of expectedMapIds) assert.ok(fallback.trace.sourceMapIds.includes(mapId), `${mapId} is actually fetched for: ${testCase.query}`);
    for (const mapId of testCase.disallowedMaps || []) assert.ok(!fallback.trace.sourceMapIds.includes(mapId), `${mapId} is excluded for: ${testCase.query}`);
  }
}

const unrelatedControls = [
  'How should the company record accounting depreciation on a delivery vehicle?',
  'What is the accounting treatment for renovation costs?',
  'When should an employee bonus accrual be booked?',
  'Company bought a passenger car. Can it claim tax deduction and capital allowance?'
];
for (const query of unrelatedControls) {
  const classification = classifyQuestion(query);
  assert.ok(!classification.topicIds.includes('iras-gst-entertainment'), `Unrelated query does not route to meal GST: ${query}`);
  assert.ok(!classification.topicIds.includes('iras-gst-motor-vehicles'), `Unrelated query does not route to motor-vehicle GST: ${query}`);
}
const individualOverseasEmploymentQuery = 'If a Singapore tax resident earns employment income while physically working overseas on a temporary secondment, under what conditions is that foreign-sourced income taxable in Singapore or eligible for double taxation relief?';
const individualOverseasEmploymentRouting = classifyQuestion(individualOverseasEmploymentQuery);
assert.ok(individualOverseasEmploymentRouting.authorities.includes('IRAS'));
assert.ok(individualOverseasEmploymentRouting.topicIds.includes('iras-individual-overseas-employment'));
assert.ok(individualOverseasEmploymentRouting.topicIds.includes('iras-individual-foreign-employment-income'));
assert.ok(individualOverseasEmploymentRouting.topicIds.includes('iras-individual-foreign-tax-credit'));
assert.ok(individualOverseasEmploymentRouting.topicIds.includes('iras-individual-double-tax-agreements'));
assert.ok(individualOverseasEmploymentRouting.topicIds.includes('iras-individual-tax-residency'));
assert.ok(!individualOverseasEmploymentRouting.topicIds.includes('iras-foreign-sourced-income'), 'An individual employee question cannot route to the corporate foreign-income topic.');
assert.ok(!individualOverseasEmploymentRouting.topicIds.includes('iras-foreign-tax-credit'), 'An individual employee question cannot route to the corporate foreign-tax-credit topic.');
assert.ok(!individualOverseasEmploymentRouting.topicIds.includes('iras-double-tax-agreements'), 'An individual employee question cannot route to the corporate DTA topic.');
const singaporeBranchIncomeRouting = classifyQuestion('A Singapore company remits profits from an overseas branch into Singapore. What conditions determine whether those branch profits are exempt or taxable here?');
assert.equal(singaporeBranchIncomeRouting.primaryDomain, 'TAX');
assert.ok(singaporeBranchIncomeRouting.authorities.includes('IRAS'));
assert.ok(singaporeBranchIncomeRouting.domains.includes('IRAS_CORPORATE_TAX'));
assert.ok(singaporeBranchIncomeRouting.topicIds.includes('iras-foreign-sourced-income'),
  'A branch-profit taxability question now maps to the registered corporate foreign-income topic.');
assert.ok(singaporeBranchIncomeRouting.topicIds.includes('iras-section-13-exemptions'),
  'An explicit exemption question can also map to the registered Section 13 exemption topic.');
const unregisteredCorporateTaxRouting = classifyQuestion('A Singapore company incurred an overseas restructuring charge. What Singapore tax treatment applies?');
assert.equal(unregisteredCorporateTaxRouting.primaryDomain, 'TAX');
assert.ok(unregisteredCorporateTaxRouting.authorities.includes('IRAS'),
  'A genuinely unregistered Singapore income-tax question must still route to IRAS discovery.');
assert.ok(unregisteredCorporateTaxRouting.domains.includes('IRAS_CORPORATE_TAX'),
  'Explicit company population routes the unregistered question to corporate-tax discovery context.');
assert.deepEqual(unregisteredCorporateTaxRouting.topicIds, [],
  'Authority-level IRAS discovery does not require a benchmark-specific registered topic.');
const mixedGstBranchIncomeRouting = classifyQuestion('A Singapore company remits profits from an overseas branch into Singapore. The company is also GST registered, but I am asking specifically whether the branch profits are exempt or taxable as corporate income.');
assert.equal(mixedGstBranchIncomeRouting.primaryDomain, 'TAX',
  'An explicit corporate income-tax outcome keeps precedence when GST registration is only mixed-query context.');
assert.ok(mixedGstBranchIncomeRouting.domains.includes('IRAS_CORPORATE_TAX'));
assert.ok(mixedGstBranchIncomeRouting.domains.includes('IRAS_GST'),
  'The mentioned GST context can remain represented without replacing the explicit corporate income-tax domain.');
assert.ok(mixedGstBranchIncomeRouting.authorities.includes('IRAS'));
const pureGstCompanyRouting = classifyQuestion('A Singapore company is GST registered and sells goods locally. Must it charge GST on those sales?');
assert.equal(pureGstCompanyRouting.primaryDomain, 'GST', 'A pure GST question remains GST-first.');
assert.ok(!pureGstCompanyRouting.domains.includes('IRAS_CORPORATE_TAX'),
  'An entity mention in a GST question alone does not add corporate income-tax scope.');
const foreignJurisdictionBranchIncomeRouting = classifyQuestion('A UK company remits profits from an overseas branch into the UK. Are those profits exempt from tax there?');
assert.ok(!foreignJurisdictionBranchIncomeRouting.authorities.includes('IRAS'),
  'Taxability in a non-Singapore jurisdiction does not infer IRAS authority.');
assert.ok(!foreignJurisdictionBranchIncomeRouting.domains.some(domain => domain.startsWith('IRAS_')));
const SingaporeEmployerForeignTaxRouting = classifyQuestion('A Singapore company sends its employee to Japan. Is the employee’s salary taxable in Japan?');
assert.ok(!SingaporeEmployerForeignTaxRouting.authorities.includes('IRAS'),
  'Singapore as the employer location does not override an explicit foreign-country taxability question.');
const employeeAtCompanyRouting = classifyQuestion('A Singapore company employs an employee working overseas. Is that employee’s employment income taxable in Singapore or eligible for foreign tax relief?');
assert.ok(employeeAtCompanyRouting.topicIds.some(id => id.startsWith('iras-individual-')));
assert.ok(!employeeAtCompanyRouting.topicIds.some(id => ['iras-foreign-sourced-income', 'iras-foreign-tax-credit', 'iras-double-tax-agreements'].includes(id)),
  'Employer/company wording does not route the employee’s own income into corporate foreign-income topics.');
const explicitMasTaxIncentiveRouting = classifyQuestion('What MAS fund incentive tax exemption applies to a Singapore fund manager?');
assert.ok(explicitMasTaxIncentiveRouting.authorities.includes('MAS'));
assert.ok(!explicitMasTaxIncentiveRouting.authorities.includes('IRAS'),
  'A Singapore tax-exemption phrase explicitly framed as a MAS fund-incentive question does not infer IRAS authority.');
for (const query of [
  'Can a Singapore company claim an exemption for foreign-sourced income?',
  'When can our company claim foreign tax credit for foreign income?',
  'Does the company qualify for double tax agreement relief on foreign profits?'
]) {
  const corporateRouting = classifyQuestion(query);
  assert.ok(corporateRouting.topicIds.some(id => ['iras-foreign-sourced-income', 'iras-foreign-tax-credit', 'iras-double-tax-agreements'].includes(id)), `Corporate foreign-income guidance remains available: ${query}`);
  assert.ok(!corporateRouting.topicIds.some(id => id.startsWith('iras-individual-')), `Corporate question does not route to individual-tax guidance: ${query}`);
}
const ambiguousNonResidentWht = classifyQuestion('Does withholding tax apply to a payment to a non-resident recipient?');
assert.ok(ambiguousNonResidentWht.topicIds.includes('iras-withholding-tax'),
  'A bare non-resident recipient does not imply the individual income-tax population; WHT coverage remains available.');
const ambiguousNonResidentWhtMaps = getCoverageTopicById('iras-withholding-tax').sourceRecordIds;
assert.ok(ambiguousNonResidentWhtMaps.includes('IRAS_WHT_RATES_SOURCE_MAP'));
assert.ok(ambiguousNonResidentWhtMaps.includes('IRAS_WHT_SCOPE_SOURCE_MAP'));
assert.ok(!ambiguousNonResidentWht.topicIds.some(id => id.startsWith('iras-individual-')),
  'Do not route a WHT recipient query into individual DTR/foreign-income topics without explicit individual context.');
assert.ok(!classifyQuestion('How should the company record accounting depreciation on a delivery vehicle?').topicIds.includes('iras-cit-disallowed-expenses'));
assert.ok(!classifyQuestion('What is the accounting treatment for renovation costs?').topicIds.includes('iras-cit-renovation-refurbishment'));
assert.ok(!classifyQuestion('When should an employee bonus accrual be booked?').topicIds.includes('iras-employee-bonus-timing'));
const passengerIncomeTaxClassification = classifyQuestion(unrelatedControls[3]);
assert.ok(passengerIncomeTaxClassification.topicIds.includes('iras-cit-disallowed-expenses'));
assert.ok(passengerIncomeTaxClassification.topicIds.includes('iras-capital-allowances'));
assert.ok(!passengerIncomeTaxClassification.domains.includes('IRAS_GST'), 'Passenger-car income-tax guidance cannot route into GST motor-vehicle topics.');

const genericExpenseClassification = classifyQuestion(exactPhraseCases[2].query);
assert.ok(genericExpenseClassification.missingFacts.some(fact => /business purpose/i.test(fact)));
assert.ok(genericExpenseClassification.missingFacts.some(fact => /capital or revenue/i.test(fact)));
assert.ok(genericExpenseClassification.missingFacts.some(fact => /invoices, receipts/i.test(fact)));
const mealClassification = classifyQuestion(exactPhraseCases[0].query);
assert.ok(mealClassification.missingFacts.some(fact => /gst registration/i.test(fact)));
assert.ok(mealClassification.missingFacts.some(fact => /supporting tax invoice/i.test(fact)));
assert.ok(mealClassification.missingFacts.some(fact => /business purpose/i.test(fact)));
assert.ok(mealClassification.missingFacts.some(fact => /who attended/i.test(fact)));
const lossClassification = classifyQuestion(exactPhraseCases[4].query);
assert.ok(lossClassification.missingFacts.some(fact => /Year of Assessment/i.test(fact)));
assert.ok(lossClassification.missingFacts.some(fact => /shareholding continuity/i.test(fact)));
assert.ok(lossClassification.missingFacts.some(fact => /same business/i.test(fact)));

const renovationClassification = classifyQuestion(exactPhraseCases[3].query);
assert.ok(renovationClassification.missingFacts.some(fact => /description and scope/i.test(fact)));
assert.ok(renovationClassification.missingFacts.some(fact => /repair.*structural.*improvement/i.test(fact)));
assert.ok(renovationClassification.missingFacts.some(fact => /date.*basis period.*Year of Assessment/i.test(fact)));
assert.ok(renovationClassification.missingFacts.some(fact => /prior Section 14N claims.*cap utilization.*election/i.test(fact)));
const accountingRenovation = classifyQuestion('What is the accounting treatment for renovation costs?');
assert.ok(!accountingRenovation.missingFacts.some(fact => /Section 14N|Year of Assessment/i.test(fact)),
  'Accounting-only renovation questions do not receive corporate-tax missing-fact prompts.');

const ir21Classification = classifyQuestion('When do we need to file IR21?');
assert.ok(ir21Classification.missingFacts.some(fact => /employee citizenship|permanent-resident status/i.test(fact)));
assert.ok(ir21Classification.missingFacts.some(fact => /cessation, departure/i.test(fact)));
assert.ok(ir21Classification.missingFacts.some(fact => /IR21 filing exemption/i.test(fact)));
assert.ok(ir21Classification.missingFacts.some(fact => /remuneration must be withheld/i.test(fact)));

const bonusReporting = classifyQuestion('Employee received a bonus in April for June payroll. When should it be reported?');
assert.ok(bonusReporting.missingFacts.some(fact => /contractual or discretionary.*entitlement/i.test(fact)));
assert.ok(bonusReporting.missingFacts.some(fact => /Exact date.*bonus.*paid, credited/i.test(fact)));
assert.ok(bonusReporting.missingFacts.some(fact => /reporting year\/Year of Assessment.*AIS\/IR8A/i.test(fact)));
assert.ok(bonusReporting.missingFacts.some(fact => /Service or performance period.*payroll period/i.test(fact)));
const bonusAccrual = classifyQuestion('When should an employee bonus accrual be booked?');
assert.ok(!bonusAccrual.missingFacts.some(fact => /contractual or discretionary|AIS\/IR8A reporting/i.test(fact)),
  'Accounting bonus accrual questions do not receive tax reporting fact prompts.');

const interestWht = classifyQuestion(exactPhraseCases[8].query);
assert.ok(interestWht.missingFacts.some(fact => /Recipient tax residence/i.test(fact)));
assert.ok(interestWht.missingFacts.some(fact => /beneficial owner/i.test(fact)));
assert.ok(interestWht.missingFacts.some(fact => /treaty relief/i.test(fact)));
assert.ok(interestWht.missingFacts.some(fact => /Payment or deemed-payment date/i.test(fact)));
assert.ok(interestWht.missingFacts.some(fact => /Loan terms.*Singapore-sourced/i.test(fact)));
const managementWht = classifyQuestion(exactPhraseCases[9].query);
assert.ok(managementWht.missingFacts.some(fact => /Recipient tax residence/i.test(fact)));
assert.ok(managementWht.missingFacts.some(fact => /beneficial owner/i.test(fact)));
assert.ok(managementWht.missingFacts.some(fact => /treaty relief/i.test(fact)));
assert.ok(managementWht.missingFacts.some(fact => /Contractual scope and nature/i.test(fact)));
assert.ok(managementWht.missingFacts.some(fact => /physically performed/i.test(fact)));
assert.ok(managementWht.missingFacts.some(fact => /Payment or deemed-payment date/i.test(fact)));

// The targeted meal-GST response guard must cover both response contracts:
// legacy freeform prose and compact responses. The evidence-policy production
// contract has separate end-to-end tests in test_iras_evidence_pipeline.mjs.
const mealQuery = exactPhraseCases[0].query;
const mealMap = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === 'IRAS_GST_INPUT_TAX_SOURCE_MAP');
const mealPageHtml = htmlForMap(mealMap).replace('</main>',
  '<table><tr><td>Entertainment expenses</td><td>Subject to the conditions for input tax claim, these claims are allowed if you have the supporting tax invoice addressed to you. Keep information on entertainment details such as name of person entertained and purpose of entertainment.</td></tr></table></main>');
const policyMealGrounding = await buildGroundedReasoningContext(
  mealQuery,
  null,
  defaultSourceRetriever,
  undefined,
  {
    discoveryAdapter: { discoverOfficialSourceCandidates: async () => [] },
    webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
    fetchOptions: { useCache: false, customFetch: async () => htmlResponse(mealPageHtml) }
  }
);
const mealGrounding = { ...policyMealGrounding, evidenceQuality: undefined };
assert.ok(policyMealGrounding.evidenceQuality, 'Production context always supplies the IRAS evidence gate.');
const unconditionalMealClaim = 'GST is always claimable for every customer or supplier meal, regardless of purpose or records.';
const freeformMealResponse = postProcessAIResponse(
  { messageText: unconditionalMealClaim, directGroups: [] },
  null,
  mealQuery,
  mealGrounding
);
assert.ok(!freeformMealResponse.messageText.includes(unconditionalMealClaim),
  'Freeform meal-GST prose must not retain a universal claim even when a candidate citation exists.');
assert.match(freeformMealResponse.messageText, /Do not assume input GST.*always claimable/i);
assert.match(freeformMealResponse.messageText, /business purpose|who attended|tax invoice/i);
assert.equal(mealGrounding.sourceMapFallbackTrace?.candidateOnly, true,
  'The test fixture should exercise candidate-only IRAS evidence.');
assert.ok(mealGrounding.sourceMapFallbackTrace?.sourceMapIds.includes('IRAS_GST_INPUT_TAX_SOURCE_MAP'));
assert.match(freeformMealResponse.messageText, /candidate evidence pending review/i,
  'Candidate-only mapped evidence must remain labeled in the replacement.');
const mixedAccountingQuestion = 'We paid SGD 200 for a customer lunch. What is the accounting entry, and can we claim the GST?';
const mixedAccountingGroup = {
  id: 'customer-lunch-entry',
  title: 'Customer lunch',
  summary: 'Record the meal expense paid in cash.',
  lines: [
    { id: 'meal-debit', accountCode: '6000', accountName: 'Meals expense', category: 'EXPENSE', debit: 200, credit: 0, lineExplanation: 'Customer lunch' },
    { id: 'cash-credit', accountCode: '1000', accountName: 'Cash', category: 'ASSET', debit: 0, credit: 200, lineExplanation: 'Cash paid' }
  ],
  citations: [],
  rationalePoints: []
};
const mixedAccountingResponse = postProcessAIResponse(
  {
    messageText: 'Record Dr Meals expense SGD 200.00, and GST is always claimable on customer lunches. The cash entry remains balanced.',
    directGroups: [mixedAccountingGroup]
  },
  null,
  mixedAccountingQuestion,
  mealGrounding
);
assert.match(mixedAccountingResponse.messageText, /Record Dr Meals expense SGD 200\.00/,
  'The meal GST guard preserves the accounting entry discussion in a mixed answer.');
assert.match(mixedAccountingResponse.messageText, /The cash entry remains balanced\./,
  'The meal GST guard preserves unrelated prose after the unsupported claim.');
assert.match(mixedAccountingResponse.messageText, /SGD 200\.00/,
  'The meal GST guard preserves decimal monetary amounts without splitting on the decimal point.');
assert.doesNotMatch(mixedAccountingResponse.messageText, /GST is always claimable/,
  'Only the unsupported categorical meal GST claim is corrected.');
assert.deepEqual(
  mixedAccountingResponse.scenarioState.directGroups?.[0]?.lines?.map(line => ({ accountName: line.accountName, debit: line.debit, credit: line.credit })),
  [
    { accountName: 'Meals expense', debit: 200, credit: 0 },
    { accountName: 'Cash', debit: 0, credit: 200 }
  ],
  'The valid balanced journal data survives meal GST claim correction.'
);
const compactMixedAccountingResponse = postProcessAIResponse(
  {
    directAnswer: 'Record Dr Meals expense SGD 200.00, and GST is always claimable on customer lunches.',
    treatment: 'Record the customer lunch as a meals expense paid in cash.',
    singaporeTaxImpact: 'GST is always claimable on customer lunches.',
    directGroups: [mixedAccountingGroup]
  },
  null,
  mixedAccountingQuestion,
  mealGrounding
);
assert.match(compactMixedAccountingResponse.messageText, /Record Dr Meals expense SGD 200\.00/,
  'Compact mixed answers preserve accounting prose and decimal amounts.');
assert.doesNotMatch(compactMixedAccountingResponse.messageText, /GST is always claimable/,
  'Compact mixed answers correct the unsupported GST claim in the answer and tax impact.');
assert.deepEqual(
  compactMixedAccountingResponse.scenarioState.directGroups?.[0]?.lines?.map(line => ({ accountName: line.accountName, debit: line.debit, credit: line.credit })),
  [
    { accountName: 'Meals expense', debit: 200, credit: 0 },
    { accountName: 'Cash', debit: 0, credit: 200 }
  ],
  'The compact path preserves balanced journal data when it corrects the tax claim.'
);
const broadBlockedMealAnswer = 'Under SFRS(I), business entertaining expenses are recognized as operating expenses in profit or loss when incurred. Under Singapore GST rules, input tax on business entertainment (such as a customer lunch) is generally disallowed as a blocked input tax claim, unless specific statutory exceptions apply.';
const broadBlockedMealAnswerFreeform = postProcessAIResponse(
  { messageText: broadBlockedMealAnswer, directGroups: [mixedAccountingGroup] },
  null,
  mixedAccountingQuestion,
  mealGrounding
);
assert.match(broadBlockedMealAnswerFreeform.messageText, /business entertaining expenses are recognized as operating expenses in profit or loss when incurred/i,
  'Correct accounting treatment survives correction of a broad negative GST premise.');
assert.doesNotMatch(broadBlockedMealAnswerFreeform.messageText, /input tax on business entertainment.*generally disallowed as a blocked input tax claim/i,
  'A broad negative GST claim for customer meals is corrected despite an exceptions caveat.');
assert.deepEqual(
  broadBlockedMealAnswerFreeform.scenarioState.directGroups?.[0]?.lines?.map(line => ({ accountName: line.accountName, debit: line.debit, credit: line.credit })),
  [
    { accountName: 'Meals expense', debit: 200, credit: 0 },
    { accountName: 'Cash', debit: 0, credit: 200 }
  ],
  'The balanced meal journal survives correction of the broad negative GST premise.'
);
const broadBlockedMealAnswerCompact = postProcessAIResponse(
  {
    directAnswer: broadBlockedMealAnswer,
    treatment: 'Business entertaining expenses are recognized as operating expenses in profit or loss when incurred.',
    singaporeTaxImpact: 'Input tax on business entertainment is generally disallowed as a blocked input tax claim, unless specific statutory exceptions apply.',
    directGroups: [mixedAccountingGroup]
  },
  null,
  mixedAccountingQuestion,
  mealGrounding
);
assert.match(broadBlockedMealAnswerCompact.messageText, /business entertaining expenses are recognized as operating expenses in profit or loss when incurred/i,
  'The compact path preserves the accounting conclusion.');
assert.doesNotMatch(broadBlockedMealAnswerCompact.messageText, /input tax on business entertainment.*generally disallowed as a blocked input tax claim/i,
  'The compact path corrects the broad negative GST premise in its answer and tax-impact field.');
assert.doesNotMatch(broadBlockedMealAnswerCompact.scenarioState.singaporeTaxTreatmentSummary || '', /generally disallowed as a blocked input tax claim/i,
  'The compact tax-impact field does not retain the broad negative premise.');
assert.deepEqual(
  broadBlockedMealAnswerCompact.scenarioState.directGroups?.[0]?.lines?.map(line => ({ accountName: line.accountName, debit: line.debit, credit: line.credit })),
  [
    { accountName: 'Meals expense', debit: 200, credit: 0 },
    { accountName: 'Cash', debit: 0, credit: 200 }
  ],
  'The compact path retains balanced journal data while correcting a broad negative GST premise.'
);
const privateMealGstStatement = 'Input tax on meals for private use is generally not claimable.';
const privateMealGstResponse = postProcessAIResponse(
  { messageText: privateMealGstStatement, directGroups: [] },
  null,
  mealQuery,
  mealGrounding
);
assert.ok(privateMealGstResponse.messageText.includes(privateMealGstStatement),
  'A specific negative statement about private-use meal costs remains intact.');
const compactMealResponse = postProcessAIResponse(
  { directAnswer: unconditionalMealClaim, keyRules: [unconditionalMealClaim], messageText: unconditionalMealClaim },
  null,
  mealQuery,
  mealGrounding
);
assert.ok(!compactMealResponse.messageText.includes(unconditionalMealClaim),
  'Compact statutory answers must not retain the same universal meal-GST claim.');
assert.match(compactMealResponse.messageText, /Do not assume input GST.*always claimable/i);
assert.match(compactMealResponse.messageText, /business purpose|who attended|tax invoice/i);
const conditionalMealText = 'GST is not always claimable for meals; assess the facts and supporting tax invoice before deciding.';
const conditionalMealResponse = postProcessAIResponse(
  { messageText: conditionalMealText, directGroups: [] },
  null,
  mealQuery,
  mealGrounding
);
assert.ok(conditionalMealResponse.messageText.includes(conditionalMealText),
  'A conditional meal-GST answer must remain unchanged.');
const qualifiedUniversalMealText = 'GST is always claimable if the ordinary input-tax conditions are met and the business has a valid tax invoice.';
const qualifiedUniversalMealResponse = postProcessAIResponse(
  { messageText: qualifiedUniversalMealText, directGroups: [] },
  null,
  mealQuery,
  mealGrounding
);
assert.ok(qualifiedUniversalMealResponse.messageText.includes(qualifiedUniversalMealText),
  'A claim explicitly conditioned on ordinary input-tax requirements must not be suppressed.');
const conditionalWhereMealText = 'GST is claimable where the ordinary input-tax conditions are met, including a valid tax invoice and business use.';
const conditionalWhereMealResponse = postProcessAIResponse(
  { messageText: conditionalWhereMealText, directGroups: [] },
  null,
  mealQuery,
  mealGrounding
);
assert.ok(conditionalWhereMealResponse.messageText.includes(conditionalWhereMealText),
  'A claim conditioned by where ordinary input-tax requirements are met must remain unchanged.');
const compactConditionalWhereMealResponse = postProcessAIResponse(
  { directAnswer: conditionalWhereMealText },
  null,
  mealQuery,
  mealGrounding
);
assert.ok(compactConditionalWhereMealResponse.messageText.includes(conditionalWhereMealText),
  'The compact path must also preserve claim wording conditional on where ordinary input-tax requirements are met.');
for (const unqualifiedClaim of [
  'All input GST on customer meals is claimable.',
  'You can always claim GST on meals.',
  'Input tax on client meals is recoverable.',
  'GST is never claimable for customer meals.'
]) {
  const guarded = postProcessAIResponse(
    { messageText: unqualifiedClaim, directGroups: [] },
    null,
    mealQuery,
    mealGrounding
  );
  assert.ok(!guarded.messageText.includes(unqualifiedClaim), `Unqualified meal-GST wording is replaced: ${unqualifiedClaim}`);
  assert.match(guarded.messageText, /Do not assume input GST.*always claimable/i);
}
const cautiousNotAllText = 'Not all input GST on customer meals is claimable.';
const cautiousNotAllResponse = postProcessAIResponse(
  { messageText: cautiousNotAllText, directGroups: [] },
  null,
  mealQuery,
  mealGrounding
);
assert.ok(cautiousNotAllResponse.messageText.includes(cautiousNotAllText),
  'The caution that not all meal input GST is claimable remains intact.');
const contradictoryDocumentationClaim = 'GST is always claimable for customer meals, and supporting invoices are not required.';
const guardedContradictoryDocumentation = postProcessAIResponse(
  { messageText: contradictoryDocumentationClaim, directGroups: [] },
  null,
  mealQuery,
  mealGrounding
);
assert.ok(!guardedContradictoryDocumentation.messageText.includes(contradictoryDocumentationClaim),
  'A separate negation about documentation must not hide an unconditional GST claimability assertion.');
const guardedAdvisory = {
  authority: 'IRAS',
  statuteOrAct: 'Goods and Services Tax Act 1993',
  sectionOrSchedule: 'Section 19',
  topic: 'Meal input tax',
  summary: 'All input GST on customer meals is claimable.',
  keyRules: ['You can always claim GST on meals.'],
  officialUrl: mealGrounding.officialGuidance[0]?.officialSourceUrl || '',
  isGstClaimable: true
};
const summaryFallbackGuard = postProcessAIResponse(
  { messageText: conditionalMealText, directGroups: [] },
  {
    scenarioType: 'UNIVERSAL',
    directGroups: [],
    accountingTreatmentSummary: 'All input GST on customer meals is claimable.',
    singaporeTaxTreatmentSummary: 'You can always claim GST on meals.',
    regulatoryMandatesSummary: 'Input tax on client meals is recoverable.',
    statutoryAdvisory: [guardedAdvisory]
  },
  mealQuery,
  mealGrounding
);
for (const field of ['accountingTreatmentSummary', 'singaporeTaxTreatmentSummary', 'regulatoryMandatesSummary']) {
  assert.match(summaryFallbackGuard.scenarioState[field], /Do not assume input GST.*always claimable/i,
    `The selected current-scenario ${field} fallback is guarded.`);
}
assert.equal(summaryFallbackGuard.scenarioState.statutoryAdvisory?.[0]?.isGstClaimable, undefined,
  'An unresolved positive GST claimability badge is cleared for a meal input-tax query.');
assert.match(summaryFallbackGuard.scenarioState.statutoryAdvisory?.[0]?.summary || '', /Do not assume input GST.*always claimable/i);

const compactSummaryGuard = postProcessAIResponse(
  {
    directAnswer: 'All input GST on customer meals is claimable.',
    treatment: 'Input tax on client meals is recoverable.',
    singaporeTaxImpact: 'You can always claim GST on meals.',
    statutoryAdvisory: [guardedAdvisory]
  },
  null,
  mealQuery,
  mealGrounding
);
assert.match(compactSummaryGuard.scenarioState.accountingTreatmentSummary || '', /Do not assume input GST.*always claimable/i);
assert.match(compactSummaryGuard.scenarioState.singaporeTaxTreatmentSummary || '', /Do not assume input GST.*always claimable/i);
assert.equal(compactSummaryGuard.scenarioState.statutoryAdvisory?.[0]?.isGstClaimable, undefined);

const falseClaimabilityAdvisory = { ...guardedAdvisory, isGstClaimable: false };
const falseBadgeFreeform = postProcessAIResponse(
  { messageText: conditionalMealText, directGroups: [] },
  { scenarioType: 'UNIVERSAL', directGroups: [], statutoryAdvisory: [falseClaimabilityAdvisory] },
  mealQuery,
  mealGrounding
);
assert.equal(falseBadgeFreeform.scenarioState.statutoryAdvisory?.[0]?.isGstClaimable, undefined,
  'An unresolved negative GST claimability badge is also cleared.');
const falseBadgeCompact = postProcessAIResponse(
  { directAnswer: conditionalMealText, statutoryAdvisory: [falseClaimabilityAdvisory] },
  null,
  mealQuery,
  mealGrounding
);
assert.equal(falseBadgeCompact.scenarioState.statutoryAdvisory?.[0]?.isGstClaimable, undefined,
  'The compact response path clears either unresolved claimability boolean.');
const resolvedMealGrounding = { ...mealGrounding, missingFacts: [] };
const resolvedFalseBadge = postProcessAIResponse(
  { messageText: conditionalMealText, directGroups: [] },
  { scenarioType: 'UNIVERSAL', directGroups: [], statutoryAdvisory: [falseClaimabilityAdvisory] },
  mealQuery,
  resolvedMealGrounding
);
assert.equal(resolvedFalseBadge.scenarioState.statutoryAdvisory?.[0]?.isGstClaimable, false,
  'A claimability boolean is retained when the meal query has no outstanding missing facts.');
const unrelatedMissingFactGrounding = {
  ...mealGrounding,
  missingFacts: ['Company financial year end and YA basis period containing the renovation expenditure']
};
const unrelatedMissingFactMealResponse = postProcessAIResponse(
  { messageText: unconditionalMealClaim, directGroups: [] },
  { scenarioType: 'UNIVERSAL', directGroups: [], statutoryAdvisory: [guardedAdvisory] },
  mealQuery,
  unrelatedMissingFactGrounding
);
assert.ok(unrelatedMissingFactMealResponse.messageText.includes(unconditionalMealClaim),
  'An unrelated corporate-tax missing fact does not trigger the meal GST prose guard.');
assert.equal(unrelatedMissingFactMealResponse.scenarioState.statutoryAdvisory?.[0]?.isGstClaimable, true,
  'An unrelated corporate-tax missing fact does not suppress the meal GST claimability badge.');

for (const [disclaimer, shouldRemain] of [
  ['GST is never claimable for customer meals.', false],
  ['GST is always claimable if ordinary input-tax conditions are met and a valid tax invoice is held.', true]
]) {
  const freeformDisclaimerResponse = postProcessAIResponse(
    { messageText: 'Please confirm the supporting facts.', directGroups: [], uncertaintyDisclaimer: disclaimer },
    null,
    mealQuery,
    mealGrounding
  );
  assert.equal(freeformDisclaimerResponse.scenarioState.uncertaintyDisclaimer?.includes(disclaimer) ?? false, shouldRemain,
    `Freeform uncertainty disclaimer guard result: ${disclaimer}`);
  const compactDisclaimerResponse = postProcessAIResponse(
    { directAnswer: 'Please confirm the supporting facts.', uncertaintyDisclaimer: disclaimer },
    null,
    mealQuery,
    mealGrounding
  );
  assert.equal(compactDisclaimerResponse.scenarioState.uncertaintyDisclaimer?.includes(disclaimer) ?? false, shouldRemain,
    `Compact uncertainty disclaimer guard result: ${disclaimer}`);
}

const deterministicSummaryGuard = postProcessAIResponse(
  { directAnswer: conditionalMealText },
  null,
  mealQuery,
  mealGrounding,
  {
    scenarioType: 'GENERAL_EXPENSE',
    rawQuery: mealQuery,
    directGroups: [],
    accountingTreatmentSummary: 'All input GST on customer meals is claimable.',
    singaporeTaxTreatmentSummary: 'Input tax on client meals is recoverable.',
    statutoryAdvisory: [guardedAdvisory]
  }
);
assert.match(deterministicSummaryGuard.scenarioState.accountingTreatmentSummary || '', /Do not assume input GST.*always claimable/i);
assert.match(deterministicSummaryGuard.scenarioState.singaporeTaxTreatmentSummary || '', /Do not assume input GST.*always claimable/i,
  'The compact path guards the deterministic tax-summary fallback.');
assert.equal(deterministicSummaryGuard.scenarioState.statutoryAdvisory?.[0]?.isGstClaimable, undefined);

// Historical queries with no period-dated IRAS pointer must fail closed before fetch/discovery.
for (const testCase of [exactPhraseCases[6]]) {
  let fetchCount = 0;
  let discoveryCount = 0;
  const historical = await resolveMappedOfficialSourceFallback(
    [testCase.topics[0]], testCase.query, defaultSourceRetriever,
    {
      discoveryAdapter: { discoverOfficialSourceCandidates: async () => { discoveryCount += 1; return ['https://www.iras.gov.sg/']; } },
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: { useCache: false, customFetch: async () => { fetchCount += 1; return htmlResponse('<html><head><title>IRAS | Home</title></head><body>IRAS</body></html>'); } }
    }
  );
  assert.equal(fetchCount, 0, `No undated current-page fetch for historical case: ${testCase.query}`);
  assert.equal(discoveryCount, 0, `No current-page discovery for historical case: ${testCase.query}`);
  assert.equal(historical.records.length, 0);
  assert.ok(historical.trace.attempts.some(attempt => attempt.fetchStatus === 'HISTORICAL_SCOPE_UNVERIFIED'));
}

// The 2022 statutory rate remains available locally while the live page is denied for the historical query.
const gstTransitionQuery = exactPhraseCases[6].query;
let historicalNetworkCalls = 0;
const localHistoricalRetriever = {
  getSourceById: id => defaultSourceRetriever.getSourceById(id),
  findSourcesByStandardOrAct: () => [],
  retrieveSources: async () => [
    UNIFIED_SOURCE_REGISTRY.GST_RATE_7_PERCENT,
    UNIFIED_SOURCE_REGISTRY.GST_SEC11_TIME_OF_SUPPLY
  ]
};
const historicalContext = await buildGroundedReasoningContext(
  gstTransitionQuery,
  null,
  localHistoricalRetriever,
  undefined,
  {
    discoveryAdapter: { discoverOfficialSourceCandidates: async () => { historicalNetworkCalls += 1; return []; } },
    webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
    fetchOptions: { useCache: false, customFetch: async () => { historicalNetworkCalls += 1; return htmlResponse('unavailable', 503); } }
  }
);
assert.ok(
  [...historicalContext.primaryEvidence, ...historicalContext.officialGuidance, ...historicalContext.curatedSummaries]
    .some(record => record.id === 'GST_RATE_7_PERCENT'),
  'Dated local GST-rate evidence remains in the answer context.'
);
const historicalContextRecordIds = new Set([
  ...historicalContext.primaryEvidence,
  ...historicalContext.officialGuidance,
  ...historicalContext.curatedSummaries
].map(record => record.id));
assert.ok(historicalContextRecordIds.has('GST_RATE_8_PERCENT_2023'),
  'An explicitly named adjacent GST validity year is added through the local predecessor/successor record link.');
assert.ok(historicalContextRecordIds.has('GST_SEC11_TIME_OF_SUPPLY'),
  'The transition context retains local time-of-supply evidence alongside both rate versions.');
assert.equal(historicalNetworkCalls, 0, 'A historical context does not use an undated current IRAS page or sitemap candidate.');

const currentRateRetriever = {
  getSourceById: id => defaultSourceRetriever.getSourceById(id),
  findSourcesByStandardOrAct: () => [],
  retrieveSources: async () => [UNIFIED_SOURCE_REGISTRY.GST_RATE_9_PERCENT]
};
const currentRateContext = await buildGroundedReasoningContext(
  'For a current GST invoice issued and paid in 2026, what standard rate applies?',
  null,
  currentRateRetriever,
  undefined,
  {
    discoveryAdapter: { discoverOfficialSourceCandidates: async () => [] },
    webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
    fetchOptions: { useCache: false, customFetch: async () => htmlResponse('unavailable', 503) }
  }
);
const currentRateContextRecordIds = new Set([
  ...currentRateContext.primaryEvidence,
  ...currentRateContext.officialGuidance,
  ...currentRateContext.curatedSummaries
].map(record => record.id));
assert.ok(currentRateContextRecordIds.has('GST_RATE_9_PERCENT'));
assert.ok(!currentRateContextRecordIds.has('GST_RATE_7_PERCENT') && !currentRateContextRecordIds.has('GST_RATE_8_PERCENT_2023'),
  'A single-year current GST query does not acquire historical linked rates.');

// Visible article text is required; a page title plus navigation labels is not grounding evidence.
const expenseTopic = getCoverageTopicById('iras-cit-deductibility');
const expenseExpectation = {
  standardIdentifiers: ['IRAS', 'Income Tax Act 1947'],
  expectedTitles: ['Business Expenses'],
  topicTerms: ['Corporate Tax Deductibility', 'tax deductibility', 'deductible for tax']
};
const visibleExpenseHtml = '<html><head><title>Business Expenses</title></head><body><main><h1>Business Expenses</h1><p>IRAS explains tax deductibility for company expenses incurred wholly and exclusively in producing income, subject to conditions and supporting business records.</p></main></body></html>';
assert.equal(defaultExternalSourceValidator.validateTopicContent(visibleExpenseHtml, expenseExpectation).isValid, true);
const navOnlyHtml = '<html><head><title>Business Expenses</title></head><body><nav><a>IRAS corporate tax deductibility business expenses tax deduction rules</a><a>Income Tax Act 1947</a></nav></body></html>';
assert.equal(defaultExternalSourceValidator.validateTopicContent(navOnlyHtml, expenseExpectation).isValid, false);
const homepageHtml = '<html><head><title>IRAS | Home</title></head><body><main><h1>Welcome to IRAS</h1><p>Find useful information and services for individuals and businesses.</p></main></body></html>';
assert.equal(defaultExternalSourceValidator.validateTopicContent(homepageHtml, expenseExpectation).isValid, false);

// Even an injected fetch adapter that claims a topic match cannot promote menu-only HTML.
const expenseMap = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === 'IRAS_CIT_EXPENSES_SOURCE_MAP');
const forgedSuccessRetriever = {
  fetchOfficialSource: async url => ({
    status: 'SUCCESS',
    content: navOnlyHtml,
    finalUrl: url,
    topicMatched: true,
    pageTitle: expenseMap.pageTitle,
    substantiveText: 'IRAS corporate tax deductibility business expenses tax deduction rules Income Tax Act 1947',
    retrievedAt: new Date().toISOString()
  })
};
const rejectedNavigationCandidate = await resolveMappedOfficialSourceFallback(
  [expenseTopic.id], 'Can this expense be claimed as a tax deduction?', defaultSourceRetriever,
  { discoveryAdapter: { discoverOfficialSourceCandidates: async () => [] }, webRetriever: forgedSuccessRetriever }
);
assert.equal(rejectedNavigationCandidate.records.length, 0);
assert.equal(rejectedNavigationCandidate.trace.path, 'MAPPED_SOURCE_REJECTED');
assert.equal(rejectedNavigationCandidate.trace.attempts[0].fetchStatus, 'TOPIC_MISMATCH');

console.log('PASS: IRAS end-to-end routing, source-map selection, historical fail-closed, and visible-content validation');
