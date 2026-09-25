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
assert.ok(topicIds.length >= 150 && topicIds.length <= 250, `Registry should start with 150-250 topics; found ${topicIds.length}`);
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
  ['QFDC', 'MAS', 'mas-qfd-qfdc'],
  ['FATCA', 'IRAS', 'iras-fatca-framework'],
  ['CRS', 'IRAS', 'iras-crs-framework']
]) {
  const result = classifyQuestion(`Explain ${acronym} requirements.`);
  assert.ok(result.authorities.includes(authority), `${acronym} routes to ${authority}`);
  assert.ok(result.topicIds.includes(topicId), `${acronym} resolves to ${topicId}`);
}

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
