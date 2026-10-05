import assert from 'node:assert/strict';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { evaluateEvidenceQuality, matchesRequestedQuestionConcept } from '../../src/retrieval/evidenceQualityGate.ts';
import { getCoverageTopicById } from '../../src/standards/coverageRegistry.ts';

const topic = getCoverageTopicById('iras-gst-input-tax');
assert.ok(topic, 'The mapped GST input-tax topic must exist.');
assert.equal(topic.domainId, 'IRAS_GST');

const blockedInputTax = UNIFIED_SOURCE_REGISTRY.GST_REG26_BLOCKED_INPUT_TAX;
assert.ok(blockedInputTax, 'The approved blocked-input-tax source must exist.');
assert.equal(blockedInputTax.provenance, 'LOCAL_STATIC');
assert.equal(blockedInputTax.sourceStatus, 'VERIFIED');
assert.ok(blockedInputTax.sourceText);

const generalInputTaxClaim = {
  id: 'general_gst_input_tax_claim',
  label: 'General GST input tax claim',
  terms: ['input tax'],
  topicIds: []
};
const scopedInput = {
  domainId: topic.domainId,
  topicIds: [topic.id],
  subject: generalInputTaxClaim.label,
  population: 'COMPANY'
};

assert.equal(matchesRequestedQuestionConcept(blockedInputTax.sourceText, generalInputTaxClaim, scopedInput), false,
  'The scoped general-rule matcher rejects a blocked-only restriction as support for general input-tax claims.');
assert.equal(matchesRequestedQuestionConcept(blockedInputTax.sourceText, generalInputTaxClaim), true,
  'The legacy unscoped phrase matcher still sees the literal input-tax term.');

const assessment = evaluateEvidenceQuality({
  query: 'What is the general GST input tax claim rule for a business?',
  topicIds: [topic.id],
  records: [blockedInputTax],
  missingFacts: [],
  requestedConcepts: [generalInputTaxClaim],
  scopedSubject: generalInputTaxClaim.label,
  scopedPopulation: 'COMPANY',
  authorities: ['IRAS'],
  domain: 'IRAS_GST',
  referenceDate: '2026-10-02'
});
assert.ok(assessment.eligibleRecords.some(record => record.id === blockedInputTax.id),
  'The test exercises the real approved record through ordinary eligibility checks.');
assert.ok(assessment.uncoveredConcepts.includes(generalInputTaxClaim.label),
  'A recognized false scoped rule result must not be rescued by legacy unscoped phrase matching.');
assert.ok(!assessment.coveredConcepts.includes(generalInputTaxClaim.label));
assert.equal(assessment.scopedRequest, true, 'Only validated issue scopes activate scoped admission and quote selection.');

const topicTerms = [topic.title, ...(topic.aliases || []), ...topic.keywords, ...(topic.paragraphHints || []), ...(topic.sectionHints || [])];
const unboundFake = {
  ...blockedInputTax,
  id: 'TEST_UNBOUND_FAKE_GST_LOCAL',
  authority: 'IRAS',
  domain: topic.legacyDomains[0],
  sourceText: `${topicTerms.join('. ')}. Businesses may claim input tax on purchases used to make taxable supplies, provided the tax invoice is held.`,
  tags: [topic.id],
  relatedTopicIds: [],
  sourceMapTopicIds: [],
  retrievalHints: []
};
const scopedQuality = record => evaluateEvidenceQuality({
  query: 'What is the general GST input tax claim rule for a business?',
  topicIds: [topic.id], records: [record], missingFacts: [],
  requestedConcepts: [generalInputTaxClaim], scopedSubject: generalInputTaxClaim.label,
  scopedPopulation: 'COMPANY', authorities: ['IRAS'], domain: 'IRAS_GST', referenceDate: '2026-10-02'
});
const fakeAssessment = scopedQuality(unboundFake);
assert.ok(!fakeAssessment.eligibleRecords.some(record => record.id === unboundFake.id),
  'An unbound local record with plausible IRAS rule text cannot enter scoped evidence.');
assert.ok(fakeAssessment.rejectedRecords.some(item => item.recordId === unboundFake.id && item.code === 'BOUND_LOCAL_RECORD_MISMATCH'));

const alteredRegisteredRecord = { ...blockedInputTax, sourceText: `${blockedInputTax.sourceText} Altered after review.` };
const alteredAssessment = scopedQuality(alteredRegisteredRecord);
assert.ok(!alteredAssessment.eligibleRecords.some(record => record.id === blockedInputTax.id),
  'An altered payload under a reviewed registry ID cannot enter scoped evidence.');
assert.ok(alteredAssessment.rejectedRecords.some(item => item.recordId === blockedInputTax.id && item.code === 'BOUND_LOCAL_RECORD_MISMATCH'));

for (const [label, overrides] of [
  ['wrong authority', { authority: 'CPF' }],
  ['wrong domain', { domain: 'CPF_BOARD' }]
]) {
  const wrongScopeRecord = { ...unboundFake, id: `TEST_${label.replaceAll(' ', '_').toUpperCase()}`, ...overrides };
  const wrongScopeAssessment = scopedQuality(wrongScopeRecord);
  assert.ok(!wrongScopeAssessment.eligibleRecords.some(record => record.id === wrongScopeRecord.id),
    `An unbound local record with ${label} cannot enter scoped evidence.`);
  assert.ok(wrongScopeAssessment.rejectedRecords.some(item =>
    item.recordId === wrongScopeRecord.id && item.code === 'TOPIC_AUTHORITY_DOMAIN_MISMATCH'));
}

const legacyAssessment = evaluateEvidenceQuality({
  query: 'What is the general GST input tax claim rule for a business?',
  topicIds: [topic.id],
  records: [blockedInputTax],
  missingFacts: [],
  requestedConcepts: [generalInputTaxClaim],
  authorities: ['IRAS'],
  domain: 'IRAS_GST',
  referenceDate: '2026-10-02'
});
assert.ok(legacyAssessment.coveredConcepts.includes(generalInputTaxClaim.label),
  'Unscoped IRAS queries retain the existing broad concept matcher.');
assert.equal(legacyAssessment.scopedRequest, undefined);

const unrelatedBroaderConcept = {
  id: 'general_gst_input_tax_treaty_claim',
  label: 'General GST input tax treaty claim',
  terms: ['input tax'],
  topicIds: []
};
const legacyScopedResult = matchesRequestedQuestionConcept(blockedInputTax.sourceText, unrelatedBroaderConcept, scopedInput);
const legacyUnscopedResult = matchesRequestedQuestionConcept(blockedInputTax.sourceText, unrelatedBroaderConcept);
assert.equal(legacyScopedResult, legacyUnscopedResult,
  'Concepts outside the bounded general-rule family retain legacy scoped/unscoped parity.');
const unrelatedAssessment = evaluateEvidenceQuality({
  query: 'What is the general GST input tax treaty claim?',
  topicIds: [topic.id],
  records: [blockedInputTax],
  missingFacts: [],
  requestedConcepts: [unrelatedBroaderConcept],
  scopedSubject: unrelatedBroaderConcept.label,
  scopedPopulation: 'COMPANY',
  authorities: ['IRAS'],
  domain: 'IRAS_GST',
  referenceDate: '2026-10-02'
});
assert.equal(unrelatedAssessment.coveredConcepts.includes(unrelatedBroaderConcept.label), legacyUnscopedResult,
  'Out-of-family concepts keep the prior unscoped coverage decision.');

process.stdout.write('IRAS scoped concept coverage regression passed.\n');
