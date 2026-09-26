import assert from 'node:assert/strict';
import {
  getCoverageTopicById,
  LEGACY_COVERAGE_PACK_MAPPINGS,
  SINGAPORE_COVERAGE_REGISTRY,
  SINGAPORE_DOMAIN_TAXONOMY
} from '../../src/standards/coverageRegistry.ts';
import { getAllAuthoritativeSources } from '../../src/standards/unifiedSourceModel.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { QueryTopicResolver } from '../../src/retrieval/queryTopicResolver.ts';
import { buildGroundedReasoningContext } from '../../src/services/groundingContextBuilder.ts';

const topicIds = SINGAPORE_COVERAGE_REGISTRY.map(topic => topic.id);
assert.ok(topicIds.length >= 150 && topicIds.length <= 300, `Registry should contain 150-300 topics after the consolidation source-map extension; found ${topicIds.length}`);
assert.equal(new Set(topicIds).size, topicIds.length, 'Canonical topic IDs must be unique');

const sourceIds = new Set(getAllAuthoritativeSources().map(source => source.id));
const expectedChecks = [
  'SOURCE_PROVENANCE',
  'RETRIEVAL_EVALUATION',
  'TEMPORAL_VALIDITY',
  'ACCOUNTING_OR_CALCULATION_RULE',
  'MISSING_FACT_GUARD',
  'REGRESSION_TEST'
].sort();
for (const topic of SINGAPORE_COVERAGE_REGISTRY) {
  assert.ok(SINGAPORE_DOMAIN_TAXONOMY[topic.domainId], `${topic.id} must map to a canonical taxonomy domain`);
  assert.ok(topic.legacyDomains.length > 0, `${topic.id} must retain its source-domain compatibility mapping`);
  assert.deepEqual([...topic.requiredChecks].sort(), expectedChecks, `${topic.id} must retain the topic quality contract`);
  for (const sourceId of topic.sourceRecordIds) {
    assert.ok(sourceIds.has(sourceId), `${topic.id} references nonexistent source '${sourceId}'`);
  }
}
assert.ok(getCoverageTopicById('acra_share_capital').sourceRecordIds.includes('ACRA_SEC68_NO_PAR_VALUE_SHARES'));
assert.ok(!getCoverageTopicById('acra_share_capital').sourceRecordIds.includes('ACRA_SEC78B_CAPITAL_REDUCTION'));
assert.ok(getCoverageTopicById('acra_capital-reductions').sourceRecordIds.includes('ACRA_SEC78B_CAPITAL_REDUCTION'));
assert.equal(getCoverageTopicById('acra_capital-reductions').status, 'IMPLEMENTING');
assert.ok(LEGACY_COVERAGE_PACK_MAPPINGS['share-capital-and-corporate-records'].includes('acra_capital-reductions'));
for (const [legacyId, granularId] of [
  ['mom_overtime', 'mom-part-iv-overtime'],
  ['gst_reverse_charge', 'iras-gst-imported-services'],
  ['sfrsi_financial_instruments', 'sfrsi_financial-asset-classification']
]) {
  assert.equal(
    getCoverageTopicById(legacyId).canonicalConceptId,
    getCoverageTopicById(granularId).canonicalConceptId,
    `${legacyId} and ${granularId} are compatibility aliases for reranking`
  );
}
assert.notEqual(
  getCoverageTopicById('gst_compulsory_registration').canonicalConceptId ?? 'gst_compulsory_registration',
  getCoverageTopicById('iras-gst-turnover-tests').canonicalConceptId ?? 'iras-gst-turnover-tests',
  'The registration obligation and turnover tests are distinct concepts despite shared keywords'
);

const expectedLegacyResolverIds = [
  'mom_annual_leave', 'mom_sick_leave', 'mom_overtime', 'cpf_wage_ceiling', 'cpf_contribution_rates',
  'gst_compulsory_registration', 'gst_reverse_charge', 'gst_bad_debt_relief', 'cit_section_14', 'cit_loss_relief',
  'acra_small_company', 'acra_record_retention', 'acra_financial_statements', 'sfrsi_intangibles_cap',
  'sfrsi_leases', 'sfrsi_ppe', 'acra_share_capital', 'sfrsi_own_equity', 'sfrsi_financial_instruments'
];
for (const id of expectedLegacyResolverIds) assert.ok(getCoverageTopicById(id), `Preserve resolver topic ${id}`);

const resolver = new QueryTopicResolver();
for (const query of [
  'How do share options affect control of an investee?',
  'Do options over shares give an investor potential voting rights?'
]) {
  assert.ok(
    resolver.decomposeQuery(query).topics.some(topic => topic.id === 'sfrsi10-potential-voting-rights'),
    `Scoped share-option wording resolves potential voting rights: ${query}`
  );
}
assert.ok(
  !resolver.decomposeQuery('For YA 2026 renovation, what Section 14N options should the company check?').topics.some(topic => topic.id === 'sfrsi10-potential-voting-rights'),
  'Generic options in a Section 14N tax question do not route to potential voting rights.'
);
assert.deepEqual(
  resolver.constructor.CANONICAL_TOPICS.map(topic => topic.id),
  topicIds,
  'Resolver topics must be generated from the coverage registry in registry order'
);
assert.ok(resolver.resolveTopicIds(['sfrsi_leases'])[0].semanticCriteria, 'Existing semantic criteria remain attached to canonical resolver IDs');
assert.deepEqual(Object.keys(LEGACY_COVERAGE_PACK_MAPPINGS).sort(), [
  'corporate-tax-adjustments', 'cpf-and-sdl-payroll', 'gst-registration-and-input-tax',
  'lease-accounting', 'revenue-recognition', 'share-capital-and-corporate-records'
].sort());
for (const topicList of Object.values(LEGACY_COVERAGE_PACK_MAPPINGS)) {
  assert.ok(topicList.length > 0, 'Every old topic pack must map to granular canonical topics');
  for (const id of topicList) assert.ok(getCoverageTopicById(id), `Mapped topic '${id}' must exist`);
}

const drc = classifyQuestion('What are the current foreign worker DRC and levy requirements for our sector?');
assert.ok(drc.authorities.includes('MOM'));
assert.ok(drc.topicIds.includes('mom-foreign-workforce-drc'));
assert.ok(drc.domains.includes('MOM_FOREIGN_WORKFORCE'));

const momOvertimeProvision = classifyQuestion('What MOM provision applies to overtime?');
assert.deepEqual(momOvertimeProvision.authorities, ['MOM'], 'An employment provision question should not add accounting authority based on a generic word');
assert.ok(!momOvertimeProvision.topicIds.includes('sfrsi_provisions-contingencies'));
const momEmploymentPassAssociate = classifyQuestion('Does an associate need an Employment Pass under MOM rules?');
assert.ok(momEmploymentPassAssociate.authorities.includes('MOM'));
assert.ok(!momEmploymentPassAssociate.authorities.includes('ACRA'), 'An ordinary associate should not route to accounting standards');
assert.ok(!momEmploymentPassAssociate.topicIds.includes('sfrsi_associates'));

const warrantyProvision = classifyQuestion('Should we recognize a warranty provision?');
assert.ok(warrantyProvision.topicIds.includes('sfrsi_provisions-contingencies'), 'Accounting warranty provisions remain recognizable');
const investmentInAssociate = classifyQuestion('How do we account for an investment in an associate?');
assert.ok(investmentInAssociate.topicIds.includes('sfrsi_associates'), 'Accounting for an investment in an associate remains recognizable');

// Consolidation source-map routing: keep governance facts in accounting
// assessment questions from adding unrelated ACRA company-law coverage.
for (const [query, requiredTopicIds] of [
  [
    'Our group owns 80% of a subsidiary and sells 15 percentage points, retaining 65% and control. How is the ownership change presented, and is a gain or loss recognised in profit or loss?',
    ['sfrsi10-control', 'sfrsi10-ownership-changes']
  ],
  [
    'Our company owns 48% of an investee. Management says it controls the investee because the remaining shares are widely dispersed, but the facts also say another investor appoints most directors and directs the relevant operating decisions. Does our company control it?',
    ['sfrsi10-control', 'sfrsi10-power', 'sfrsi10-de-facto-control']
  ],
  [
    'We own 15% of an investee, appoint one director, and participate in decisions about its financial and operating policies. Can significant influence exist despite our ownership being below 20%?',
    ['sfrsi128-significant-influence', 'sfrsi128-20-percent-presumption']
  ],
  [
    'We own 25% of an investee, but have no board representation, do not participate in policy decisions, have no material transactions or management interchange, and cannot obtain the information needed to influence it. Is the 20% threshold conclusive?',
    ['sfrsi128-significant-influence', 'sfrsi128-20-percent-presumption']
  ],
  [
    'We hold 45% of an investee and have an option to acquire another 10%. The option is exercisable now, but we have not provided its terms, practical barriers, or the other shareholders\' rights. Do the potential voting rights give us power over the investee?',
    ['sfrsi10-potential-voting-rights', 'sfrsi10-power', 'sfrsi10-control']
  ]
]) {
  const result = classifyQuestion(query);
  for (const topicId of requiredTopicIds) {
    assert.ok(result.topicIds.includes(topicId), `Consolidation question routes to ${topicId}: ${query}`);
  }
  assert.equal(result.primaryDomain, 'ACCOUNTING', `Consolidation question remains an accounting query: ${query}`);
  assert.deepEqual(result.authorities, ['ACRA'], `Accounting standard routing has ACRA as its sole authority: ${query}`);
  assert.ok(result.domains.includes('ACCOUNTING_SFRS'), `Consolidation question routes to SFRS(I): ${query}`);
  assert.ok(!result.domains.includes('ACRA_COMPANIES'), `Investee accounting facts do not add company-law coverage: ${query}`);
  assert.equal(result.multiAuthority, false, `Consolidation question stays single-authority: ${query}`);
}

const subsidiaryAccounting = classifyQuestion('How do I account for a subsidiary?');
assert.ok(subsidiaryAccounting.topicIds.includes('sfrsi_subsidiaries-consolidation'));
const goodwillMeasurement = classifyQuestion('How should goodwill be measured?');
assert.ok(goodwillMeasurement.topicIds.includes('sfrsi_goodwill'));
const assetImpairment = classifyQuestion('Is this asset impaired?');
assert.ok(assetImpairment.topicIds.includes('sfrsi_impairment'));
for (const [query, topicId] of [
  ['How do I test for impairment?', 'sfrsi_impairment'],
  ['Should a subsidiary be consolidated?', 'sfrsi_subsidiaries-consolidation'],
  ['Do I consolidate my subsidiary?', 'sfrsi_subsidiaries-consolidation'],
  ['How should goodwill be recognized on acquisition?', 'sfrsi_goodwill']
]) {
  assert.ok(classifyQuestion(query).topicIds.includes(topicId), `Natural accounting question resolves to ${topicId}: ${query}`);
}

const momSubsidiaryCompliance = classifyQuestion('Does a subsidiary with impaired goodwill need an Employment Pass under MOM rules?');
assert.ok(momSubsidiaryCompliance.authorities.includes('MOM'));
assert.ok(!momSubsidiaryCompliance.authorities.includes('ACRA'), 'Incidental subsidiary and goodwill wording should not add accounting authority');
assert.ok(!momSubsidiaryCompliance.topicIds.some(id => [
  'sfrsi_subsidiaries-consolidation', 'sfrsi_goodwill', 'sfrsi_impairment'
].includes(id)));

const ir21 = classifyQuestion('When is an IR21 required before a foreign employee ceases employment?');
assert.ok(ir21.authorities.includes('IRAS'));
assert.ok(ir21.topicIds.includes('iras-employer-ir21'));

for (const [acronym, authority, topicId] of [
  ['PWM', 'MOM', 'mom-progressive-wage-model'],
  ['TADM', 'MOM', 'mom-employment-claims-tadm'],
  ['FWA', 'MOM', 'mom-flexible-work-arrangements'],
  ['FWL', 'MOM', 'mom-foreign-worker-levy'],
  ['SDL', 'CPF', 'cpf-skills-development-levy'],
  ['SINDA', 'CPF', 'cpf-self-help-group-contributions'],
  ['QDC', 'MAS', 'mas-quarterly-fund-data-collection'],
  ['FATCA', 'IRAS', 'iras-fatca-framework'],
  ['CRS', 'IRAS', 'iras-crs-framework']
]) {
  const result = classifyQuestion(`Explain ${acronym} requirements.`);
  assert.ok(result.authorities.includes(authority), `${acronym} routes to ${authority}`);
  assert.ok(result.topicIds.includes(topicId), `${acronym} resolves to ${topicId}`);
}

const qfdc = classifyQuestion('What does QFDC mean?');
assert.ok(!qfdc.authorities.includes('MAS'), 'QFDC must not be presumed to mean MAS QDC');
assert.ok(!qfdc.topicIds.includes('mas-quarterly-fund-data-collection'));
const qdc = classifyQuestion('What is QDC reporting for MAS funds?');
assert.ok(qdc.authorities.includes('MAS'));
assert.ok(qdc.topicIds.includes('mas-quarterly-fund-data-collection'));
assert.equal(getCoverageTopicById('mas-quarterly-fund-data-collection').status, 'MISSING');
assert.deepEqual(getCoverageTopicById('mas-quarterly-fund-data-collection').sourceRecordIds, [], 'QDC routing metadata must not imply validated content');

for (const section of ['13O', '13U']) {
  const result = classifyQuestion(`What are the MAS and IRAS considerations for section ${section}?`);
  assert.ok(result.authorities.includes('MAS') && result.authorities.includes('IRAS'), `${section} routes to both authorities`);
  assert.ok(result.multiAuthority);
  assert.ok(result.domains.includes('MULTI_AUTHORITY'));
}

const standaloneVcc = classifyQuestion('Explain VCC to me.');
assert.deepEqual(standaloneVcc.authorities, ['ACRA'], 'Bare VCC questions route to ACRA without assuming MAS fund management applies');
assert.equal(standaloneVcc.primaryDomain, 'CORPORATE_REGULATORY');
assert.ok(standaloneVcc.topicIds.includes('acra_vcc'));
assert.ok(!standaloneVcc.authorities.includes('MAS'));
const masVcc = classifyQuestion('What MAS fund management requirements apply to a VCC?');
assert.ok(masVcc.authorities.includes('ACRA') && masVcc.authorities.includes('MAS'), 'Explicit MAS fund-management context can add MAS to VCC routing');
assert.ok(masVcc.multiAuthority);

const irasGst = classifyQuestion('IRAS GST registration');
assert.equal(irasGst.primaryDomain, 'GST', 'An IRAS mention alone must not override the explicit GST domain');
assert.ok(irasGst.domains.includes('IRAS_GST'));
const combinedGstAndCorporateTax = classifyQuestion('IRAS GST registration and corporate tax deduction');
assert.ok(combinedGstAndCorporateTax.domains.includes('IRAS_GST'));
assert.ok(combinedGstAndCorporateTax.domains.includes('IRAS_CORPORATE_TAX'));
assert.equal(combinedGstAndCorporateTax.primaryDomain, 'TAX', 'An independently identified corporate tax topic remains visible in the legacy primary domain');

const meeting = classifyQuestion('From the MOM, list the action owners, hard deadlines, and next review meeting.');
assert.deepEqual(meeting.authorities, [], 'MOM meaning minutes of meeting must not be routed to the Ministry of Manpower');
assert.deepEqual(meeting.topicIds, []);
const momEmployment = classifyQuestion('What are MOM employment rules for salary deductions?');
assert.ok(momEmployment.authorities.includes('MOM'), 'MOM abbreviation with employment context still routes to the ministry');

let capturedRetrieval;
const captureRetriever = {
  async retrieveSources(query) {
    capturedRetrieval = query;
    return [];
  },
  getSourceById() { return undefined; },
  findSourcesByStandardOrAct() { return []; }
};
await buildGroundedReasoningContext('What are the MAS and IRAS considerations for section 13O?', null, captureRetriever);
assert.equal(capturedRetrieval.domain, undefined, 'Multi-authority retrieval must not be restricted to one coarse source domain');
assert.deepEqual([...capturedRetrieval.authorities].sort(), ['IRAS', 'MAS']);
assert.ok(capturedRetrieval.topicIds.includes('iras-fund-tax-incentives-13o'));
assert.ok(capturedRetrieval.topicIds.includes('mas-family-office-13o'));

const financialStatementQuery = 'How should we present financial statements?';
assert.equal(classifyQuestion(financialStatementQuery).primaryDomain, 'ACCOUNTING');
await buildGroundedReasoningContext(financialStatementQuery, null, captureRetriever);
assert.equal(capturedRetrieval.domain, undefined, 'An ACRA topic keyword must not filter out accounting-standard sources when coarse routing says ACCOUNTING');
assert.ok(capturedRetrieval.authorities.includes('ACRA'));

console.log(`PASS | Singapore knowledge foundation: ${topicIds.length} canonical topics, ${Object.keys(SINGAPORE_DOMAIN_TAXONOMY).length} domains, routing and compatibility invariants`);
