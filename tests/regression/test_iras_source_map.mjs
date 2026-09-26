import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { OfficialSitemapDiscoveryAdapter } from '../../src/retrieval/officialSitemapDiscovery.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { defaultSourceRetriever, isAnswerGroundingEligibleSource } from '../../src/retrieval/sourceRetriever.ts';
import { resolveMappedOfficialSourceFallback } from '../../src/services/groundingContextBuilder.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { IRAS_SOURCE_MAP_DEFINITIONS, SINGAPORE_COVERAGE_REGISTRY, getCoverageTopicById } from '../../src/standards/coverageRegistry.ts';
import { hasVerifiedSourceUrlProvenance } from '../../src/standards/approvedSourceRegistry.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { QueryTopicResolver } from '../../src/retrieval/queryTopicResolver.ts';

const benchmark = JSON.parse(await readFile(path.resolve('tests/evaluation/singapore/iras-source-map.json'), 'utf8'));
const htmlResponse = (body, status = 200) => new Response(body, {
  status,
  headers: { 'content-type': 'text/html; charset=utf-8' }
});
const emptyDiscovery = { discoverOfficialSourceCandidates: async () => [] };
const ratesDefinition = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === 'IRAS_CIT_RATE_SOURCE_MAP');
const ratesUrl = ratesDefinition.canonicalSourceUrl;
const unutilisedItemsDefinition = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === 'IRAS_CIT_UNUTILISED_ITEMS_SOURCE_MAP');
const unutilisedItemsUrl = unutilisedItemsDefinition.canonicalSourceUrl;
const motorVehiclesDefinition = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === 'IRAS_GST_MOTOR_VEHICLES_SOURCE_MAP');
const ir21Definition = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === 'IRAS_IR21_SOURCE_MAP');
const bonusTimingDefinition = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === 'IRAS_EMPLOYMENT_INCOME_TIMING_SOURCE_MAP');
const unutilisedItemsHtml = `<html><head><title>${unutilisedItemsDefinition.pageTitle}</title></head><body><main>
  <h1>${unutilisedItemsDefinition.pageTitle}</h1>
  <p>Unutilised capital allowances and unutilised trade losses may be carried forward to future Years of Assessment.</p>
  <p>Carry-forward is subject to qualifying conditions, including the shareholding test.</p>
  <p>To determine whether there is a substantial change in shareholders, compare shareholding on the relevant dates.</p>
  <p>IRAS ${unutilisedItemsDefinition.shortDescription} carry-back relief donations.</p>
  </main></body></html>`;
const ratesHtml = `<html><head><title>${ratesDefinition.pageTitle}</title></head><body><main>
  <h1>${ratesDefinition.pageTitle}</h1><p>IRAS corporate income tax rate and exemption scheme information for companies.</p>
  </main></body></html>`;
const ratesQuery = 'What corporate income tax rate applies to a company?';

async function fetchMappedPage(topicIds, query, definition, title, body, finalUrl = definition.canonicalSourceUrl) {
  const html = `<html><head><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;
  return resolveMappedOfficialSourceFallback(topicIds, query, defaultSourceRetriever, {
    discoveryAdapter: emptyDiscovery,
    webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
    fetchOptions: {
      useCache: false,
      customFetch: async requestedUrl => {
        assert.equal(requestedUrl, definition.canonicalSourceUrl);
        const response = htmlResponse(html);
        if (finalUrl !== requestedUrl) Object.defineProperty(response, 'url', { value: finalUrl });
        return response;
      }
    }
  });
}

async function run() {
  assert.equal(benchmark.reviewedAt, '2026-09-26');
  assert.match(benchmark.reviewScope, /opened or directly checked/i, 'Fixture records direct official-source checks.');
  assert.equal(new Set(benchmark.cases.map(item => item.id)).size, benchmark.cases.length);
  assert.ok(benchmark.cases.length >= 40, 'Reviewed benchmark covers broad IRAS areas, temporal contrasts, and explicit mapping gaps.');
  assert.ok(benchmark.unverifiedDimensions.includes('sourceSelection'));
  assert.ok(benchmark.unverifiedDimensions.includes('substantiveConclusion'));

  const definitionIds = IRAS_SOURCE_MAP_DEFINITIONS.map(item => item.id);
  assert.equal(new Set(definitionIds).size, definitionIds.length, 'IRAS source-map identifiers must be unique.');
  for (const definition of IRAS_SOURCE_MAP_DEFINITIONS) {
    const canonical = new URL(definition.canonicalSourceUrl);
    assert.ok(['www.iras.gov.sg', 'iras.gov.sg'].includes(canonical.hostname), `${definition.id} must be a first-party IRAS URL.`);
    assert.equal(canonical.protocol, 'https:');
    assert.equal(canonical.search, '', `${definition.id} must not contain a query string.`);
    assert.equal(canonical.hash, '', `${definition.id} must not contain a fragment.`);
    assert.ok(canonical.pathname.split('/').filter(Boolean).length >= 3, `${definition.id} must use a page-specific URL.`);
    assert.equal(definition.urlVerificationStatus, 'VERIFIED');
    assert.equal(definition.urlVerifiedDate, '2026-09-26');
    assert.equal(definition.urlVerificationMethod, 'OFFICIAL_HTML_PAGE_TITLE_AND_TOPIC_CHECK');
    assert.match(definition.urlVerificationEvidence, /official IRAS page/i);
    assert.ok(definition.pageTitle.trim().length > 3);
    assert.ok(hasVerifiedSourceUrlProvenance({
      officialSourceUrl: definition.canonicalSourceUrl,
      canonicalSourceUrl: definition.canonicalSourceUrl,
      urlVerificationStatus: definition.urlVerificationStatus
    }));

    const pointer = UNIFIED_SOURCE_REGISTRY[definition.id];
    assert.ok(pointer, `${definition.id} must produce a unified registry pointer.`);
    assert.equal(pointer.recordRole, 'SOURCE_MAP_POINTER');
    assert.equal(pointer.sourceMapScope, 'TOPIC');
    assert.equal(pointer.sourceStatus, 'NEEDS_REVIEW', 'URL verification alone must not mark tax content verified.');
    assert.equal(pointer.sourceType, 'OFFICIAL_GUIDANCE');
    assert.equal(pointer.groundingEligible, false);
    assert.equal(pointer.sourceText, '', 'A routing pointer must not invent or embed substantive tax claims.');
    assert.equal(pointer.canonicalSourceUrl, definition.canonicalSourceUrl);
    assert.equal(isAnswerGroundingEligibleSource(pointer), false);
    assert.equal(pointer.urlVerificationStatus, 'VERIFIED');
    assert.equal(pointer.urlVerifiedDate, definition.urlVerifiedDate);
    assert.equal(pointer.urlVerificationMethod, definition.urlVerificationMethod);
    assert.equal(pointer.urlVerificationEvidence, definition.urlVerificationEvidence);

    for (const topicId of definition.topicIds) {
      const topic = getCoverageTopicById(topicId);
      assert.ok(topic, `${definition.id} references registered topic ${topicId}.`);
      assert.ok(topic.sourceRecordIds.includes(definition.id), `${topicId} retains the map pointer ID.`);
    }
  }

  for (const item of benchmark.cases) {
    assert.ok(['MAPPED', 'DISCOVERY_ONLY'].includes(item.mappingStatus), `${item.id} declares explicit map coverage state.`);
    const actualSourceMapIds = [...new Set(item.topicIds.flatMap(topicId => {
      const topic = getCoverageTopicById(topicId);
      assert.ok(topic, `${item.id} references registered topic ${topicId}.`);
      return topic.sourceRecordIds.filter(sourceId => sourceId.startsWith('IRAS_') && sourceId.endsWith('_SOURCE_MAP'));
    }))].sort();
    assert.deepEqual(actualSourceMapIds, [...item.expectedSourceMapIds].sort(), `${item.id} must match the recorded source-map selection pending independent review.`);
    if (item.mappingStatus === 'DISCOVERY_ONLY') {
      assert.equal(actualSourceMapIds.length, 0, `${item.id} must not imply a guessed path.`);
      assert.match(item.evidence, /no narrow IRAS page was verified/i);
    }
  }
  assert.ok(IRAS_SOURCE_MAP_DEFINITIONS.length >= 30, 'The catalog includes verified page-specific official routes.');
  const whtOverview = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === 'IRAS_WHT_OVERVIEW_SOURCE_MAP');
  assert.equal(
    whtOverview?.canonicalSourceUrl,
    'https://www.iras.gov.sg/taxes/withholding-tax/basics-of-withholding-tax/overview-of-withholding-tax-(WHT)',
    'The official WHT overview slug preserves the uppercase acronym required by the case-sensitive route.'
  );

  const withholdingTopic = getCoverageTopicById('iras-withholding-tax');
  assert.ok(!withholdingTopic.sourceRecordIds.includes('IRAS_WHT_DUE_DATE_SOURCE_MAP'), 'The broad WHT scope/rates topic does not inherit a filing due-date page.');
  for (const topicId of ['iras-withholding-tax-management-fees', 'iras-withholding-tax-interest-royalties']) {
    assert.ok(!getCoverageTopicById(topicId).sourceRecordIds.includes('IRAS_WHT_DUE_DATE_SOURCE_MAP'), `${topicId} does not inherit a filing due-date page.`);
  }
  const withholdingScopeCase = benchmark.cases.find(item => item.id === 'withholding-scope-and-rates');
  assert.ok(withholdingScopeCase);
  assert.ok(!withholdingScopeCase.expectedSourceMapIds.includes('IRAS_WHT_DUE_DATE_SOURCE_MAP'));
  for (const caseId of ['wht-overseas-interest-payment', 'wht-management-service-fees']) {
    const whtCase = benchmark.cases.find(item => item.id === caseId);
    assert.ok(whtCase);
    assert.ok(!whtCase.expectedSourceMapIds.includes('IRAS_WHT_DUE_DATE_SOURCE_MAP'), `${caseId} should not expect the due-date map.`);
  }
  const directorFeesTopic = getCoverageTopicById('iras-directors-fees');
  assert.ok(!directorFeesTopic.sourceRecordIds.includes('IRAS_AIS_IR8A_SOURCE_MAP'), 'AIS/IR8A reporting is not treated as director-fee timing evidence.');
  assert.ok(directorFeesTopic.sourceRecordIds.includes('IRAS_EMPLOYMENT_INCOME_TIMING_SOURCE_MAP'));
  const entertainmentTopic = getCoverageTopicById('iras-gst-entertainment');
  assert.ok(entertainmentTopic.sourceRecordIds.includes('IRAS_GST_INPUT_TAX_SOURCE_MAP'));
  const treatyTopic = getCoverageTopicById('iras-wht-treaty-relief');
  assert.ok(treatyTopic.sourceRecordIds.includes('IRAS_WHT_DUE_DATE_SOURCE_MAP'));
  const broadDtaTopic = getCoverageTopicById('iras-double-tax-agreements');
  assert.ok(!broadDtaTopic.sourceRecordIds.includes('IRAS_CIT_FOREIGN_TAX_CREDIT_SOURCE_MAP'));
  assert.ok(getCoverageTopicById('iras-foreign-tax-credit').sourceRecordIds.includes('IRAS_CIT_FOREIGN_TAX_CREDIT_SOURCE_MAP'));
  const expectedLocalBindings = {
    'iras-cit-loss-carry-forward': ['ITA_SEC37_LOSS_CARRY_FORWARD'],
    'iras-substantial-shareholding-test': ['ITA_SEC37_LOSS_CARRY_FORWARD'],
    'iras-withholding-tax-interest-royalties': ['ITA_SEC45_WITHHOLDING_TAX'],
    'iras-withholding-tax-management-fees': ['ITA_SEC45A_WITHHOLDING_TAX_ROYALTIES'],
    'iras-cit-renovation-refurbishment': ['ITA_SEC14N_RENOVATION_REFURBISHMENT_PRE2025', 'ITA_SEC14N_RENOVATION_REFURBISHMENT'],
    'iras-section-13w': ['ITA_SEC13W_EQUITY_DISPOSAL_SAFE_HARBOUR', 'ITA_SEC13W_EQUITY_DISPOSAL_2026'],
    'iras-cit-returns': ['IRAS_FORM_CS_LITE_CRITERIA']
  };
  for (const [topicId, expectedRecordIds] of Object.entries(expectedLocalBindings)) {
    const localRecordIds = getCoverageTopicById(topicId).sourceRecordIds.filter(id => !id.endsWith('_SOURCE_MAP'));
    for (const recordId of expectedRecordIds) {
      assert.ok(localRecordIds.includes(recordId), `${topicId} explicitly binds to ${recordId}.`);
    }
  }
  for (const [query, expectedRecordId] of [
    ['Can the company carry forward prior-year trade losses?', 'ITA_SEC37_LOSS_CARRY_FORWARD'],
    ['A Singapore company pays interest to an overseas company. Is withholding tax required?', 'ITA_SEC45_WITHHOLDING_TAX'],
    ['A Singapore company pays management fees to an overseas related company. Is withholding tax applicable?', 'ITA_SEC45A_WITHHOLDING_TAX_ROYALTIES'],
    ['For YA 2026, can the company use Form C-S Lite if it claims a foreign tax credit?', 'IRAS_FORM_CS_LITE_CRITERIA']
  ]) {
    const records = await defaultSourceRetriever.retrieveSources({ query, domain: 'IRAS_TAX', maxResults: 8 });
    assert.ok(records.some(record => record.id === expectedRecordId), `${query} retrieves the explicit local record ${expectedRecordId}.`);
  }
  const formLiteQuery = 'For YA 2026, can a Singapore company use Form C-S (Lite) if it claims a foreign tax credit?';
  const resolver = new QueryTopicResolver();
  const formLiteTopics = resolver.decomposeQuery(formLiteQuery).topics.map(topic => topic.id);
  assert.ok(formLiteTopics.includes('iras-cit-returns'), 'Form C-S eligibility uses its explicit local rule binding.');
  assert.ok(!formLiteTopics.includes('iras-foreign-tax-credit'), 'The Form C-S foreign-tax-credit disqualifier does not route a separate FTC page.');
  assert.ok(resolver.decomposeQuery('How do I calculate foreign tax credit relief for foreign tax paid overseas?').topics.some(topic => topic.id === 'iras-foreign-tax-credit'),
    'A substantive FTC treatment question still routes to the FTC topic.');

  assert.ok(motorVehiclesDefinition, 'A dedicated motor-vehicle map is registered.');
  assert.equal(motorVehiclesDefinition.canonicalSourceUrl,
    'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/common-scenarios---do-i-claim-gst/purchase-and-sale-of-motor-vehicles');
  assert.equal(motorVehiclesDefinition.pageTitle, 'Purchase and Sale of Motor Vehicles');
  assert.deepEqual(motorVehiclesDefinition.topicIds, ['iras-gst-blocked-input-tax', 'iras-gst-motor-vehicles']);
  assert.ok(!getCoverageTopicById('iras-gst-motor-vehicles').sourceRecordIds.includes('IRAS_GST_INPUT_TAX_SOURCE_MAP'),
    'Motor-vehicle treatment is routed to its specific page instead of the generic input-tax page.');
  assert.equal(getCoverageTopicById('iras-gst-motor-vehicles').sectionMatch, 'Regulation 25(1) and 27');
  assert.equal(getCoverageTopicById('iras-gst-blocked-input-tax').sectionMatch, '26 and 27');
  assert.ok(ir21Definition);
  assert.equal(ir21Definition.canonicalSourceUrl,
    'https://www.iras.gov.sg/taxes/individual-income-tax/employers/tax-clearance-for-foreign-spr-employees-(ir21)/tax-clearance-for-employees');
  assert.equal(ir21Definition.pageTitle, 'Tax Clearance for Employees');
  assert.ok(bonusTimingDefinition);
  assert.equal(bonusTimingDefinition.pageTitle, 'Employment Income (Salary, bonus, director\'s fee)');

  const section13wPre = benchmark.cases.find(item => item.id === 'section13w-pre-2026-disposal');
  const section13wPost = benchmark.cases.find(item => item.id === 'section13w-post-2026-disposal');
  assert.equal(section13wPre?.mappingStatus, 'DISCOVERY_ONLY');
  assert.equal(section13wPost?.mappingStatus, 'DISCOVERY_ONLY');
  assert.match(section13wPre?.evidence || '', /2025 fourth-edition.*PDF/i);
  assert.match(section13wPost?.evidence || '', /PDF retrieval and validation remain unavailable/i);
  assert.ok(benchmark.cases.find(item => item.id === 'gst-third-party-passenger-car-cost'));
  assert.ok(benchmark.cases.find(item => item.id === 'cit-renovation-section-14n-ya2024'));
  assert.ok(benchmark.cases.find(item => item.id === 'cit-renovation-section-14n-ya2026'));
  const gst2023 = benchmark.cases.find(item => item.id === 'gst-standard-rated-supply-historical-2023');
  const gst2024 = benchmark.cases.find(item => item.id === 'gst-standard-rated-supply-historical-2024');
  for (const historicalCase of [
    benchmark.cases.find(item => item.id === 'cit-renovation-section-14n-ya2024'),
    benchmark.cases.find(item => item.id === 'gst-third-party-passenger-car-cost'),
    gst2023,
    gst2024
  ]) {
    assert.ok(historicalCase?.expectedSourceMapIds.length, `${historicalCase?.id} retains its static catalog association.`);
    assert.deepEqual(historicalCase.routingOracle.sourceSelection.expectedSourceMapIds, [], `${historicalCase.id} does not select an undated current page for a historical answer.`);
    assert.equal(historicalCase.answerPathOracle.answerPath.expectedMode, 'HISTORICAL_LOCAL_RULE_ONLY');
    assert.deepEqual(historicalCase.reviewedOracle.expectedOutcomes.sourceRetrieval.expectedSourceMapIds, []);
  }
  assert.match(gst2023.question, /supply.*1 July 2023.*invoice.*same date/i);
  assert.match(gst2024.question, /supply.*1 July 2024.*invoice.*same date/i);
  assert.deepEqual(gst2023.reviewedOracle.expectedOutcomes.calculation.expectedAmounts.map(item => item.amount), [80, 1080]);
  assert.deepEqual(gst2024.reviewedOracle.expectedOutcomes.calculation.expectedAmounts.map(item => item.amount), [90, 1090]);
  assert.deepEqual(gst2023.reviewedOracle.expectedOutcomes.missingFacts.expectedFacts, []);
  assert.deepEqual(gst2024.reviewedOracle.expectedOutcomes.missingFacts.expectedFacts, []);
  assert.ok(getCoverageTopicById('iras-cit-disallowed-expenses').sourceRecordIds.includes('ITA_SEC15_1_K_MOTOR_CAR'));

  const sourceMapIdsForQuery = query => {
    const classification = classifyQuestion(query);
    return {
      classification,
      sourceMapIds: [...new Set(classification.topicIds.flatMap(topicId =>
        (getCoverageTopicById(topicId)?.sourceRecordIds || []).filter(sourceId => sourceId.startsWith('IRAS_') && sourceId.endsWith('_SOURCE_MAP'))
      ))].sort()
    };
  };
  const carryBackRoute = sourceMapIdsForQuery('Can a company carry back current-year unabsorbed trade losses to reduce the immediately preceding YA assessment?');
  assert.ok(carryBackRoute.classification.topicIds.includes('iras-cit-loss-carry-back'));
  assert.ok(carryBackRoute.sourceMapIds.includes('IRAS_CIT_UNUTILISED_ITEMS_SOURCE_MAP'));
  assert.deepEqual(carryBackRoute.classification.authorities, ['IRAS']);
  let carryBackFetchCount = 0;
  let carryBackDiscoveryCount = 0;
  const carryBackHistoricalFallback = await resolveMappedOfficialSourceFallback(
    ['iras-cit-loss-carry-back'],
    'Can a company carry back current-year unabsorbed trade losses to reduce the immediately preceding YA assessment?',
    defaultSourceRetriever,
    {
      discoveryAdapter: { discoverOfficialSourceCandidates: async () => { carryBackDiscoveryCount += 1; return [unutilisedItemsUrl]; } },
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: { useCache: false, customFetch: async () => { carryBackFetchCount += 1; return htmlResponse(unutilisedItemsHtml); } }
    }
  );
  assert.equal(carryBackFetchCount, 0, 'The current Unutilised Items map is not fetched for an unresolved immediately preceding YA.');
  assert.equal(carryBackDiscoveryCount, 0, 'Relative prior-YA intent does not allow sitemap discovery.');
  assert.deepEqual(carryBackHistoricalFallback.trace.sourceMapIds, []);
  assert.equal(carryBackHistoricalFallback.trace.path, 'NO_VERIFIED_MAP');

  const lossCarryForward = await fetchMappedPage(
    ['iras-cit-loss-carry-forward', 'iras-substantial-shareholding-test'],
    'Can the company use prior-year losses?',
    unutilisedItemsDefinition,
    unutilisedItemsDefinition.pageTitle,
    '<p>IRAS explains that unutilised capital allowances and unutilised trade losses may be carried forward to future Years of Assessment.</p><p>Carry-forward is subject to qualifying conditions, including the shareholding test.</p><p>Compare shareholding on the relevant dates to determine if there has been a substantial change in shareholders.</p>'
  );
  assert.equal(lossCarryForward.trace.path, 'MAPPED_SOURCE', 'The official Unutilised Items page now satisfies both mapped loss topics using page-specific terms.');
  assert.deepEqual(lossCarryForward.trace.selectedRecordIds.length, 2);
  assert.ok(lossCarryForward.trace.attempts.every(attempt => attempt.fetchStatus === 'SUCCESS' && attempt.titleMatched && attempt.contentMatched));

  const motorVehicles = await fetchMappedPage(
    ['iras-gst-motor-vehicles'],
    'Can the company claim GST on a passenger motor car?',
    motorVehiclesDefinition,
    'IRAS | Purchase and Sale of Motor Vehicles',
    '<p>For GST, input tax for purchase and sale of motor vehicles depends on whether the vehicle is a motor car.</p><p>Motor car purchase and running costs are generally not claimable under Regulation 27; other vehicles may qualify subject to ordinary input-tax conditions.</p>'
  );
  assert.equal(motorVehicles.trace.path, 'MAPPED_SOURCE');
  assert.equal(motorVehicles.trace.sourceMapIds[0], 'IRAS_GST_MOTOR_VEHICLES_SOURCE_MAP');
  assert.equal(motorVehicles.records[0].officialSourceUrl, motorVehiclesDefinition.canonicalSourceUrl);

  const ir21 = await fetchMappedPage(
    ['iras-employer-ir21'],
    'When must we file Form IR21 before an employee leaves Singapore?',
    ir21Definition,
    'IRAS | Tax Clearance for Employees',
    '<p>IRAS Tax Clearance for Employees requires the employer to file Form IR21 at least one month before the employee ceases work, starts an overseas posting, or leaves Singapore for over three months.</p><p>The employer must withhold monies when aware of the impending cessation, and listed scenarios do not require tax clearance.</p>'
  );
  assert.equal(ir21.trace.path, 'MAPPED_SOURCE');
  assert.equal(ir21.trace.sourceMapIds[0], 'IRAS_IR21_SOURCE_MAP');
  assert.equal(ir21.records[0].documentTitle, 'IRAS | Tax Clearance for Employees');
  assert.equal(ir21.records[0].officialSourceUrl, ir21Definition.canonicalSourceUrl);

  const bonusActualTitle = 'IRAS | Employment Income (Salary, bonus, director\'s fee)';
  const encodedBonusFinalUrl = bonusTimingDefinition.canonicalSourceUrl.replace("director's", 'director%27s');
  const bonusTiming = await fetchMappedPage(
    ['iras-employee-bonus-timing'],
    'When is a contractual or discretionary employment bonus taxable?',
    bonusTimingDefinition,
    bonusActualTitle,
    '<p>Taxes on bonuses differ by entitlement timing. A contractual bonus becomes taxable when the employee is entitled, while a non-contractual bonus is generally taxable when paid.</p><p>Bonuses paid in advance subject to future conditions are taxable on payment.</p>',
    encodedBonusFinalUrl
  );
  assert.equal(bonusTiming.trace.path, 'MAPPED_SOURCE', 'The actual IRAS employment-income title is accepted by its source-specific title expectation.');
  assert.equal(bonusTiming.trace.attempts[0].pageTitle, bonusActualTitle);
  assert.equal(bonusTiming.trace.attempts[0].titleMatched, true);
  assert.equal(bonusTiming.records[0].officialSourceUrl, encodedBonusFinalUrl);
  assert.equal(hasVerifiedSourceUrlProvenance({
    ...bonusTiming.records[0],
    canonicalSourceUrl: bonusTimingDefinition.canonicalSourceUrl
  }), true, 'Literal and %27 encoded apostrophes identify the same verified IRAS source path.');

  for (const foreignTaxCreditQuery of [
    'A Singapore company paid foreign tax on income also reported in Singapore. What foreign tax credit relief may it claim?',
    'For YA 2026, can a Singapore-incorporated company with S$180,000 revenue use Form C-S (Lite) if it claims a foreign tax credit?'
  ]) {
    const foreignTaxCredit = classifyQuestion(foreignTaxCreditQuery);
    assert.ok(foreignTaxCredit.domains.includes('IRAS_CORPORATE_TAX'));
    assert.ok(!foreignTaxCredit.authorities.includes('ACRA'), 'Tax-credit wording alone does not create an accounting/ACRA route.');
    assert.ok(!foreignTaxCredit.domains.some(domain => domain.startsWith('ACCOUNTING_')));
  }

  const passengerCarTaxRoute = sourceMapIdsForQuery('Can a company deduct depreciation and running costs for its S-plate passenger motor car, and can it claim capital allowances?');
  assert.ok(passengerCarTaxRoute.classification.topicIds.includes('iras-cit-disallowed-expenses'));
  assert.ok(passengerCarTaxRoute.classification.topicIds.includes('iras-capital-allowances'));
  assert.ok(passengerCarTaxRoute.sourceMapIds.includes('IRAS_CIT_EXPENSES_SOURCE_MAP'));
  assert.ok(passengerCarTaxRoute.sourceMapIds.includes('IRAS_CIT_CAPITAL_ALLOWANCES_SOURCE_MAP'));
  assert.deepEqual(passengerCarTaxRoute.classification.authorities, ['IRAS']);

  const whtDueDateRoute = classifyQuestion('When is WHT treated as paid for a non-resident payment, when is filing due, and what treaty relief facts must be checked?');
  for (const topicId of ['iras-wht-deemed-payment-date', 'iras-wht-filing-payment-due-date', 'iras-wht-treaty-relief']) {
    assert.ok(whtDueDateRoute.topicIds.includes(topicId), `The WHT due-date query resolves ${topicId}.`);
  }
  assert.ok(!whtDueDateRoute.topicIds.includes('iras-withholding-tax'), 'A due-date/treaty-only query suppresses the broad WHT overview topic.');
  assert.ok(!whtDueDateRoute.topicIds.includes('iras-double-tax-agreements'), 'WHT treaty timing does not expand into generic DTA coverage.');
  const whtDueDateMapIds = [...new Set(whtDueDateRoute.topicIds.flatMap(topicId =>
    (getCoverageTopicById(topicId)?.sourceRecordIds || []).filter(sourceId => sourceId.startsWith('IRAS_') && sourceId.endsWith('_SOURCE_MAP'))
  ))].sort();
  assert.deepEqual(whtDueDateMapIds, ['IRAS_WHT_DUE_DATE_SOURCE_MAP']);

  const whtScopeAndRateRoute = classifyQuestion('Which payment categories are subject to withholding tax and what rates apply?');
  assert.ok(whtScopeAndRateRoute.topicIds.includes('iras-withholding-tax'), 'Rate/scope queries keep the WHT overview topic.');

  const renovationYa2026 = classifyQuestion('For qualifying non-structural renovation costs incurred for YA 2026, what Section 14N options and cap period should the company check?');
  assert.ok(renovationYa2026.topicIds.includes('iras-cit-renovation-refurbishment'));
  assert.ok(!renovationYa2026.topicIds.includes('gst_reverse_charge'));
  assert.ok(!renovationYa2026.domains.includes('IRAS_GST'));
  assert.deepEqual(renovationYa2026.authorities, ['IRAS']);

  const independentlyReviewedRoutingIds = new Set([
    'cit-rate-and-exemption-schemes', 'cit-eci-filing', 'cit-group-relief', 'withholding-scope-and-rates',
    'gst-registration-tests', 'gst-zero-rating', 'gst-input-tax-and-blocked-input-tax', 'gst-filing-and-payment-due-dates',
    'employer-tax-clearance-ir21', 'employment-income-annual-reporting', 'cit-basis-period-year-of-assessment-and-deadlines',
    'cit-renovation-section-14n', 'cit-capital-allowances', 'cit-unutilised-losses-and-shareholding-test', 'cit-residency-and-foreign-income-relief',
    'cit-transfer-pricing', 'gst-voluntary-registration', 'gst-standard-exempt-and-out-of-scope',
    'gst-imported-services-reverse-charge-and-ovr', 'gst-customer-accounting', 'gst-tax-invoices-and-record-retention',
    'cit-form-c-filing-deadline', 'cit-foreign-sourced-income', 'gst-standard-rated-supplies',
    'gst-exempt-supplies', 'gst-ovr-low-value-goods', 'cit-loss-carry-back-relief',
    'wht-deemed-payment-due-date-and-treaty',
    'cit-foreign-tax-credit', 'cit-passenger-car-income-tax-deduction', 'cit-renovation-section-14n-ya2026'
  ]);
  const independentlyReviewedOutcomeDimensions = {
    'section13w-pre-2026-disposal': ['substantiveConclusion', 'missingFacts', 'effectiveDate'],
    'section13w-post-2026-disposal': ['substantiveConclusion', 'missingFacts', 'effectiveDate'],
    'cit-renovation-section-14n-ya2024': ['substantiveConclusion', 'missingFacts', 'effectiveDate'],
    'cit-renovation-section-14n-ya2026': ['substantiveConclusion', 'missingFacts', 'effectiveDate'],
    'gst-third-party-passenger-car-cost': ['substantiveConclusion', 'missingFacts', 'effectiveDate'],
    'gst-standard-rated-supply-historical-2023': ['substantiveConclusion', 'calculation', 'missingFacts', 'effectiveDate'],
    'gst-standard-rated-supply-historical-2024': ['substantiveConclusion', 'calculation', 'missingFacts', 'effectiveDate'],
    'cit-form-cs-and-lite-eligibility-ya2026': ['substantiveConclusion', 'missingFacts', 'effectiveDate']
  };
  for (const item of benchmark.cases) {
    const routingReview = item.routingOracle?.review;
    if (independentlyReviewedRoutingIds.has(item.id)) {
      assert.equal(routingReview?.status, 'INDEPENDENTLY_VERIFIED', `${item.id} routing is independently reviewed.`);
      assert.equal(routingReview?.reviewer, 'iras_retrieval_reviewer');
      assert.equal(routingReview?.reviewedAt, '2026-09-26');
    } else {
      assert.equal(routingReview?.status, 'PENDING_REVIEW', `${item.id} routing remains pending.`);
    }
  }
  assert.equal(independentlyReviewedRoutingIds.size, 31);
  assert.match(benchmark.reviewNotes, /reviewedDimensions and unverifiedDimensions describe dimensions reviewed uniformly across all 43 cases/i);
  assert.ok(benchmark.cases.every(item => item.answerPathOracle?.review?.status === 'PENDING_REVIEW'));
  assert.ok(benchmark.cases.every(item => item.reviewedOracle?.review?.status === 'PENDING_REVIEW'));
  for (const item of benchmark.cases) {
    const expectedOutcomes = item.reviewedOracle.expectedOutcomes;
    for (const dimension of ['sourceRetrieval', 'grounding', 'substantiveConclusion', 'calculation', 'citation', 'missingFacts', 'effectiveDate']) {
      const isIndependentlyReviewed = independentlyReviewedOutcomeDimensions[item.id]?.includes(dimension) === true;
      assert.equal(expectedOutcomes[dimension]?.reviewStatus, isIndependentlyReviewed ? 'INDEPENDENTLY_VERIFIED' : 'PENDING_REVIEW', `${item.id} ${dimension} review state is explicit.`);
      if (isIndependentlyReviewed) {
        assert.equal(expectedOutcomes[dimension]?.reviewer, 'iras_content_reviewer');
        assert.equal(expectedOutcomes[dimension]?.reviewedAt, '2026-09-26');
      }
    }
    assert.ok(expectedOutcomes.substantiveConclusion.expectedConclusion);
    assert.ok(Array.isArray(expectedOutcomes.missingFacts.expectedFacts));
    assert.ok(expectedOutcomes.effectiveDate.expectedResult);
  }

  const originalArgv1 = process.argv[1];
  process.argv[1] = `${originalArgv1 || 'test_iras_source_map'}.imported`;
  let benchmarkReport;
  try {
    const { runSingaporeBenchmark } = await import('../evaluation/singapore/run.mjs');
    benchmarkReport = await runSingaporeBenchmark({
      fixturesData: benchmark,
      sourceRetriever: defaultSourceRetriever,
      answerFunction: async (query, _standard, item) => {
      const fallback = await resolveMappedOfficialSourceFallback(item.topicIds, query, defaultSourceRetriever, {
        discoveryAdapter: emptyDiscovery,
        webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
        fetchOptions: {
          useCache: false,
          customFetch: async url => {
            const definition = IRAS_SOURCE_MAP_DEFINITIONS.find(candidate => candidate.canonicalSourceUrl === url);
            if (!definition) return new Response('not found', { status: 404 });
            const topicText = definition.topicIds.map(topicId => {
              const topic = getCoverageTopicById(topicId);
              return topic ? `${topic.title} ${(topic.aliases || []).join(' ')} ${(topic.keywords || []).join(' ')}` : '';
            }).join(' ');
            const escapedTitle = definition.pageTitle.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
            return htmlResponse(`<html><head><title>${escapedTitle}</title></head><body><main><h1>${escapedTitle}</h1><p>IRAS ${definition.shortDescription} ${topicText}</p></main></body></html>`);
          }
        }
      });
      return {
        messageText: 'This answer is intentionally unreviewed; only route and source-map pointer selection are scored.',
        sourceMapFallbackTrace: fallback.trace,
        groundingEvidence: fallback.records.map(record => ({
          id: record.id,
          lifecycleState: record.lifecycleState,
          groundingEligible: record.groundingEligible,
          officialSourceUrl: record.officialSourceUrl
        })),
        citations: [],
        scenarioState: { directGroups: [] }
      };
      }
    });
  } finally {
    process.argv[1] = originalArgv1;
  }
  assert.equal(benchmarkReport.results.length, benchmark.cases.length);
  for (const result of benchmarkReport.results) {
    if (independentlyReviewedRoutingIds.has(result.id)) {
      for (const dimension of ['authorityRouting', 'domainRouting', 'topicRouting', 'sourceSelection']) {
        assert.equal(result.dimensions[dimension].status, 'PASS', `${result.id} independently reviewed ${dimension} matches the fixture oracle.`);
      }
    } else {
      for (const dimension of ['authorityRouting', 'domainRouting', 'topicRouting', 'sourceSelection']) {
        assert.equal(result.dimensions[dimension].status, 'NOT_EVALUATED', `${result.id} ${dimension} awaits independent review.`);
      }
    }
    for (const dimension of ['sourceRetrieval', 'retrieval', 'grounding', 'answerPath', 'substantiveConclusion', 'calculationCorrectness', 'citationCorrectness', 'missingFactBehaviour', 'effectiveDateCorrectness']) {
      assert.equal(result.dimensions[dimension].status, 'NOT_EVALUATED', `${result.id} ${dimension} remains transparently unscored.`);
    }
  }

  // Existing local statutory/threshold knowledge remains attached alongside the new URL maps.
  const gstRegistration = getCoverageTopicById('gst_compulsory_registration');
  assert.ok(gstRegistration.sourceRecordIds.includes('GST_REGISTRATION_COMPULSORY_THRESHOLD'));
  assert.ok(gstRegistration.sourceRecordIds.includes('IRAS_GST_REGISTRATION_SOURCE_MAP'));
  const blockedInputTax = getCoverageTopicById('iras-gst-blocked-input-tax');
  assert.ok(blockedInputTax.sourceRecordIds.includes('GST_REG26_BLOCKED_INPUT_TAX'));
  assert.ok(blockedInputTax.sourceRecordIds.includes('IRAS_GST_MOTOR_VEHICLES_SOURCE_MAP'));
  assert.ok(SINGAPORE_COVERAGE_REGISTRY.some(topic => topic.id === 'iras-gst-filing-deadlines'));

  const statutorySection14 = UNIFIED_SOURCE_REGISTRY.ITA_SEC14_GENERAL_DEDUCTION;
  assert.equal(statutorySection14.authority, 'IRAS', 'The rule authority remains IRAS.');
  assert.equal(statutorySection14.sourceAuthority, 'AGC', 'SSO is the actual source publisher even for an IRAS-administered rule.');

  // A verified page routes a query but still yields candidate-only guidance, not promoted tax claims.
  const mapped = await resolveMappedOfficialSourceFallback(
    ['iras-cit-tax-rate'],
    ratesQuery,
    defaultSourceRetriever,
    {
      discoveryAdapter: emptyDiscovery,
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: { useCache: false, customFetch: async () => htmlResponse(ratesHtml) }
    }
  );
  assert.equal(mapped.trace.path, 'MAPPED_SOURCE');
  assert.deepEqual(mapped.trace.sourceMapIds, ['IRAS_CIT_RATE_SOURCE_MAP']);
  assert.deepEqual(mapped.trace.finalVerifiedUrls, [ratesUrl]);
  const mappedCandidate = mapped.records.find(record => record.tags.includes('iras-cit-tax-rate'));
  assert.ok(mappedCandidate);
  assert.equal(mappedCandidate.lifecycleState, 'CANDIDATE');
  assert.equal(mappedCandidate.sourceStatus, 'NEEDS_REVIEW');
  assert.equal(mappedCandidate.sourcePublisher, 'Inland Revenue Authority of Singapore (IRAS)');
  assert.equal(mappedCandidate.sourceAuthority, 'IRAS');
  assert.equal(defaultSourceRetriever.getSourceById(mappedCandidate.id), undefined, 'Fetched content is not promoted into the static registry.');

  // An official but generic page with related words is rejected by page-title/topic checks.
  const genericHtml = '<html><head><title>Corporate Income Tax</title></head><main><p>IRAS corporate income tax and rate information for the public.</p></main></html>';
  let genericFetchCount = 0;
  const generic = await resolveMappedOfficialSourceFallback(
    ['iras-cit-tax-rate'], ratesQuery, defaultSourceRetriever,
    {
      discoveryAdapter: emptyDiscovery,
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: { useCache: false, customFetch: async () => { genericFetchCount += 1; return htmlResponse(genericHtml); } }
    }
  );
  assert.equal(genericFetchCount, 1);
  assert.equal(generic.records.length, 0);
  assert.equal(generic.trace.path, 'MAPPED_SOURCE_REJECTED');
  assert.equal(generic.trace.attempts[0].fetchStatus, 'TOPIC_MISMATCH');

  // A stale VERIFIED marker cannot authorize a changed source-map path at fetch time.
  const ratesPointer = defaultSourceRetriever.getSourceById('IRAS_CIT_RATE_SOURCE_MAP');
  const stalePointer = {
    ...ratesPointer,
    officialSourceUrl: ratesUrl.replace('/quick-links/', '/quick-links/changed/')
  };
  assert.equal(stalePointer.urlVerificationStatus, 'VERIFIED');
  assert.equal(hasVerifiedSourceUrlProvenance(stalePointer), false);
  let staleFetchCount = 0;
  const staleRetriever = {
    getSourceById: id => id === stalePointer.id ? stalePointer : defaultSourceRetriever.getSourceById(id),
    findSourcesByStandardOrAct: code => defaultSourceRetriever.findSourcesByStandardOrAct(code),
    retrieveSources: query => defaultSourceRetriever.retrieveSources(query)
  };
  const staleFallback = await resolveMappedOfficialSourceFallback(
    ['iras-cit-tax-rate'], ratesQuery, staleRetriever,
    {
      discoveryAdapter: emptyDiscovery,
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: { useCache: false, customFetch: async () => { staleFetchCount += 1; return htmlResponse(ratesHtml); } }
    }
  );
  assert.equal(staleFetchCount, 0, 'The stale same-host pointer is declined before any network fetch.');
  assert.equal(staleFallback.trace.path, 'NO_VERIFIED_MAP');
  assert.deepEqual(staleFallback.trace.sourceMapIds, []);

  // Historical live fallback requires pointer-level validity dates; topic metadata alone is not page-period evidence.
  const ratesTopic = getCoverageTopicById('iras-cit-tax-rate');
  const originalEffectiveFrom = ratesTopic.effectiveFrom;
  const originalEffectiveTo = ratesTopic.effectiveTo;
  try {
    ratesTopic.effectiveFrom = '2024-01-01';
    ratesTopic.effectiveTo = '2025-12-31';
    let historicalFetchCount = 0;
    let historicalDiscoveryCount = 0;
    const historicalUnavailable = await resolveMappedOfficialSourceFallback(
      ['iras-cit-tax-rate'], 'What corporate income tax rate applied for YA 2025?', defaultSourceRetriever,
      {
        discoveryAdapter: { discoverOfficialSourceCandidates: async () => { historicalDiscoveryCount += 1; return [ratesUrl]; } },
        webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
        fetchOptions: { useCache: false, customFetch: async () => { historicalFetchCount += 1; return htmlResponse(ratesHtml); } }
      }
    );
    assert.equal(historicalFetchCount, 0, 'Topic-level effective dates do not authorize fetching a current IRAS page for a past YA.');
    assert.equal(historicalDiscoveryCount, 0, 'Historical fallback cannot use sitemap discovery without a period-specific vetted pointer.');
    assert.equal(historicalUnavailable.trace.attempts[0].fetchStatus, 'HISTORICAL_SCOPE_UNVERIFIED');
    assert.equal(historicalUnavailable.records.length, 0);

    for (const relativeQuery of [
      'What corporate income tax rate applied last year?',
      'What was the old rate?',
      'What was the historical corporate income tax rate?',
      'What was the corporate income tax rate for the preceding year?',
      'What corporate income tax rate applied two years ago?',
      'What was the corporate income tax rate prior to 2024?',
      'What was the previous rate?',
      'What was the former rate?',
      'What was the superseded rate?',
      'What was the old WHT rate?'
    ]) {
      let relativeFetchCount = 0;
      let relativeDiscoveryCount = 0;
      const relativeHistorical = await resolveMappedOfficialSourceFallback(
        ['iras-cit-tax-rate'], relativeQuery, defaultSourceRetriever,
        {
          discoveryAdapter: { discoverOfficialSourceCandidates: async () => { relativeDiscoveryCount += 1; return [ratesUrl]; } },
          webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
          fetchOptions: { useCache: false, customFetch: async () => { relativeFetchCount += 1; return htmlResponse(ratesHtml); } }
        }
      );
      assert.equal(relativeFetchCount, 0, `Unresolved relative period declines before fetch: ${relativeQuery}`);
      assert.equal(relativeDiscoveryCount, 0, `Unresolved relative period declines before discovery: ${relativeQuery}`);
      assert.equal(relativeHistorical.trace.attempts[0].fetchStatus, 'HISTORICAL_SCOPE_UNVERIFIED');
    }

    let currentYaFetchCount = 0;
    const currentYa = await resolveMappedOfficialSourceFallback(
      ['iras-cit-tax-rate'], 'What corporate income tax rate applies for YA 2026?', defaultSourceRetriever,
      {
        discoveryAdapter: emptyDiscovery,
        webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
        fetchOptions: { useCache: false, customFetch: async () => { currentYaFetchCount += 1; return htmlResponse(ratesHtml); } }
      }
    );
    assert.equal(currentYaFetchCount, 1, 'YA 2026 is a current-year YA proxy and may use current mapped guidance.');
    assert.equal(currentYa.trace.path, 'MAPPED_SOURCE');

    let currentBeforeDeadlineFetchCount = 0;
    const currentBeforeDeadline = await resolveMappedOfficialSourceFallback(
      ['iras-cit-tax-rate'], 'What corporate income tax rate applies before the annual filing deadline this year?', defaultSourceRetriever,
      {
        discoveryAdapter: emptyDiscovery,
        webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
        fetchOptions: { useCache: false, customFetch: async () => { currentBeforeDeadlineFetchCount += 1; return htmlResponse(ratesHtml); } }
      }
    );
    assert.equal(currentBeforeDeadlineFetchCount, 1, 'A current-rate query mentioning a filing deadline is not mistaken for unresolved historical intent.');
    assert.equal(currentBeforeDeadline.trace.path, 'MAPPED_SOURCE');

    let explicitDateFetchCount = 0;
    const explicitDate = await resolveMappedOfficialSourceFallback(
      ['iras-cit-tax-rate'], 'What corporate income tax rate applied on 2 January 2026?', defaultSourceRetriever,
      {
        discoveryAdapter: emptyDiscovery,
        webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
        fetchOptions: { useCache: false, customFetch: async () => { explicitDateFetchCount += 1; return htmlResponse(ratesHtml); } }
      }
    );
    assert.equal(explicitDateFetchCount, 0, 'An explicit past transaction date still requires a pointer-specific validity interval.');
    assert.equal(explicitDate.trace.attempts[0].fetchStatus, 'HISTORICAL_SCOPE_UNVERIFIED');

    let unmappedHistoricalFetchCount = 0;
    const unmappedHistoricalRetriever = {
      getSourceById: () => undefined,
      findSourcesByStandardOrAct: () => [],
      retrieveSources: async () => []
    };
    const unmappedHistorical = await resolveMappedOfficialSourceFallback(
      ['iras-gst-entertainment'], 'How was GST input tax for entertainment treated in 2024?', unmappedHistoricalRetriever,
      {
        webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
        discoveryAdapter: { discoverOfficialSourceCandidates: async () => { unmappedHistoricalFetchCount += 1; return ['https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/entertainment']; } },
        fetchOptions: { useCache: false, customFetch: async () => { unmappedHistoricalFetchCount += 1; return htmlResponse(ratesHtml); } }
      }
    );
    assert.equal(unmappedHistoricalFetchCount, 0, 'A past-year unmapped topic is declined before discovery or fetch.');
    assert.equal(unmappedHistorical.trace.attempts[0].fetchStatus, 'HISTORICAL_SCOPE_UNVERIFIED');
    assert.equal(unmappedHistorical.records.length, 0);

    const verifiedRatesPointer = defaultSourceRetriever.getSourceById(ratesDefinition.id);
    const periodPointerRetriever = {
      getSourceById: id => id === ratesDefinition.id
        ? { ...verifiedRatesPointer, validFrom: '2024-01-01', validTo: '2025-12-31' }
        : undefined,
      findSourcesByStandardOrAct: () => [],
      retrieveSources: async () => []
    };
    let coveredHistoricalFetchCount = 0;
    const historicalCovered = await resolveMappedOfficialSourceFallback(
      ['iras-cit-tax-rate'], 'What corporate income tax rate applied for YA 2025?', periodPointerRetriever,
      {
        discoveryAdapter: emptyDiscovery,
        webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
        fetchOptions: { useCache: false, customFetch: async () => { coveredHistoricalFetchCount += 1; return htmlResponse(ratesHtml); } }
      }
    );
    assert.equal(coveredHistoricalFetchCount, 1, 'A source-map pointer with a reviewed validity interval covering the target may fetch.');
    assert.equal(historicalCovered.trace.path, 'MAPPED_SOURCE');
    const historicalCandidate = historicalCovered.records[0];
    assert.equal(historicalCandidate.validFrom, '2024-01-01', 'The candidate retains the pointer validity start used for historical authorization.');
    assert.equal(historicalCandidate.validTo, '2025-12-31', 'The candidate retains the pointer validity end used for historical authorization.');

    let failedMappedFetchDiscoveryCount = 0;
    const failedMappedFetch = await resolveMappedOfficialSourceFallback(
      ['iras-cit-tax-rate'], 'What corporate income tax rate applied for YA 2025?', periodPointerRetriever,
      {
        discoveryAdapter: { discoverOfficialSourceCandidates: async () => { failedMappedFetchDiscoveryCount += 1; return [ratesUrl]; } },
        webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
        fetchOptions: { useCache: false, customFetch: async () => new Response('unavailable', { status: 503 }) }
      }
    );
    assert.equal(failedMappedFetch.records.length, 0);
    assert.equal(failedMappedFetchDiscoveryCount, 0, 'Even a failed period-scoped pointer fetch cannot fall through to undated discovery for a historical query.');

    const outOfRangePointerRetriever = {
      ...periodPointerRetriever,
      getSourceById: id => id === ratesDefinition.id
        ? { ...verifiedRatesPointer, validFrom: '2024-01-01', validTo: '2024-12-31' }
        : undefined
    };
    let outOfRangeFetchCount = 0;
    let outOfRangeDiscoveryCount = 0;
    const outOfRange = await resolveMappedOfficialSourceFallback(
      ['iras-cit-tax-rate'], 'What corporate income tax rate applied for YA 2025?', outOfRangePointerRetriever,
      {
        discoveryAdapter: { discoverOfficialSourceCandidates: async () => { outOfRangeDiscoveryCount += 1; return [ratesUrl]; } },
        webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
        fetchOptions: { useCache: false, customFetch: async () => { outOfRangeFetchCount += 1; return htmlResponse(ratesHtml); } }
      }
    );
    assert.equal(outOfRangeFetchCount, 0, 'A pointer interval ending before the requested period blocks mapped fetch.');
    assert.equal(outOfRangeDiscoveryCount, 0, 'A non-covering pointer cannot fall through to undated discovery.');
    assert.equal(outOfRange.trace.attempts[0].fetchStatus, 'HISTORICAL_SCOPE_UNVERIFIED');
    assert.equal(outOfRange.records.length, 0);
  } finally {
    if (originalEffectiveFrom === undefined) delete ratesTopic.effectiveFrom;
    else ratesTopic.effectiveFrom = originalEffectiveFrom;
    if (originalEffectiveTo === undefined) delete ratesTopic.effectiveTo;
    else ratesTopic.effectiveTo = originalEffectiveTo;
  }

  // SSO sitemap discovery is bounded alongside IRAS, skips the redundant bare IRAS host, and keeps fetched pages candidate-only.
  const irasDiscoveryCalls = [];
  const directNoPointerRetriever = {
    getSourceById: () => undefined,
    findSourcesByStandardOrAct: () => [],
    retrieveSources: async () => []
  };
  const irasDiscoveryFetch = async url => {
    irasDiscoveryCalls.push(url);
    if (url.endsWith('/robots.txt')) {
      const host = new URL(url).hostname;
      return new Response(host === 'www.iras.gov.sg'
        ? 'User-agent: *\nSitemap: https://www.iras.gov.sg/sitemap.xml'
        : 'User-agent: *\nSitemap: https://sso.agc.gov.sg/sitemap.xml',
      { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    if (url === 'https://www.iras.gov.sg/sitemap.xml') {
      return htmlResponse(`<urlset><url><loc>${ratesUrl}</loc></url></urlset>`);
    }
    if (url === 'https://sso.agc.gov.sg/sitemap.xml') return htmlResponse('<urlset></urlset>');
    if (url === ratesUrl) return htmlResponse(ratesHtml);
    return new Response('not found', { status: 404 });
  };
  const irasDiscoveryRetriever = new ControlledWebRetriever(undefined, new SourceCache());
  const discoveredRates = await resolveMappedOfficialSourceFallback(
    ['iras-cit-tax-rate'], ratesQuery, directNoPointerRetriever,
    {
      webRetriever: irasDiscoveryRetriever,
      discoveryAdapter: new OfficialSitemapDiscoveryAdapter(irasDiscoveryRetriever, { useCache: false, customFetch: irasDiscoveryFetch }),
      fetchOptions: { useCache: false, customFetch: irasDiscoveryFetch }
    }
  );
  assert.equal(discoveredRates.trace.path, 'DISCOVERED_SOURCE');
  assert.deepEqual(discoveredRates.trace.sourceMapIds, []);
  assert.ok(irasDiscoveryCalls.includes('https://www.iras.gov.sg/robots.txt'));
  assert.ok(irasDiscoveryCalls.includes('https://www.iras.gov.sg/sitemap.xml'));
  assert.ok(irasDiscoveryCalls.includes('https://sso.agc.gov.sg/robots.txt'), 'SSO remains in the two-host discovery budget.');
  assert.equal(irasDiscoveryCalls.some(url => url.startsWith('https://iras.gov.sg/')), false, 'The bare IRAS alias is removed when www IRAS is approved.');
  const discoveredCandidate = discoveredRates.records.find(record => record.tags.includes('iras-cit-tax-rate'));
  assert.ok(discoveredCandidate);
  assert.equal(discoveredCandidate.sourcePublisher, 'Inland Revenue Authority of Singapore (IRAS)');
  assert.equal(discoveredCandidate.lifecycleState, 'CANDIDATE');
  assert.equal(discoveredCandidate.groundingEligible, true);

  const genericPageUrl = 'https://www.iras.gov.sg/taxes/corporate-income-tax';
  const genericDiscovery = await resolveMappedOfficialSourceFallback(
    ['iras-cit-tax-rate'], ratesQuery, directNoPointerRetriever,
    {
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      discoveryAdapter: { discoverOfficialSourceCandidates: async () => [genericPageUrl] },
      fetchOptions: {
        useCache: false,
        customFetch: async () => htmlResponse('<html><head><title>Corporate Income Tax</title></head><main><p>IRAS corporate income tax rate information.</p></main></html>')
      }
    }
  );
  assert.equal(genericDiscovery.records.length, 0, 'A broad IRAS landing page cannot satisfy the source-map topic title.');
  assert.equal(genericDiscovery.trace.attempts[0].fetchStatus, 'TOPIC_MISMATCH');

  // An approved SSO redirect to the generic Act page is not enough to validate an IRAS WHT rates pointer.
  const whtRatePointer = defaultSourceRetriever.getSourceById('IRAS_WHT_RATES_SOURCE_MAP');
  const whtSsoUrl = 'https://sso.agc.gov.sg/Act/ITA1947';
  const whtHtml = `<html><head><title>Income Tax Act 1947</title></head><main>
    <h1>Income Tax Act 1947</h1><p>Section 45 concerns withholding tax on specified payments made to non-residents. The Act does not present the IRAS payment-type rate table.</p>
    </main></html>`;
  const redirectedToSso = await resolveMappedOfficialSourceFallback(
    ['iras-withholding-tax'], 'What IRAS guidance covers withholding tax payment types and rates?', defaultSourceRetriever,
    {
      discoveryAdapter: emptyDiscovery,
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: {
        useCache: false,
        customFetch: async url => url === whtRatePointer.officialSourceUrl
          ? new Response(null, { status: 302, headers: { location: whtSsoUrl } })
          : url === whtSsoUrl
            ? htmlResponse(whtHtml)
            : new Response('not found', { status: 404 })
      }
    }
  );
  assert.equal(redirectedToSso.records.length, 0, 'A generic Act page cannot substantiate the mapped IRAS WHT rates topic.');
  assert.equal(redirectedToSso.trace.path, 'MAPPED_SOURCE_REJECTED');
  assert.ok(redirectedToSso.trace.attempts.some(attempt => attempt.finalUrl === whtSsoUrl && attempt.fetchStatus === 'TOPIC_MISMATCH'));

  console.log(`PASS | IRAS source-map catalog (${IRAS_SOURCE_MAP_DEFINITIONS.length} URLs), provenance, fallback, discovery, publisher, and historical-scope guards`);
}

run().catch(error => {
  console.error('IRAS SOURCE MAP REGRESSION FAILED');
  console.error(error);
  process.exit(1);
});
