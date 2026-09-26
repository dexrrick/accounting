import assert from 'node:assert/strict';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { evaluateEvidenceQuality } from '../../src/retrieval/evidenceQualityGate.ts';
import { findRecordEligibilityRejection, verifyEvidenceClaims } from '../../src/verification/claimEvidenceVerifier.ts';
import { InMemorySourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { AdvancedSourceRetriever } from '../../src/retrieval/advancedSourceRetriever.ts';

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
