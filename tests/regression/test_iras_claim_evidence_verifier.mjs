import assert from 'node:assert/strict';
import { verifyEvidenceClaims } from '../../src/verification/claimEvidenceVerifier.ts';

const localUrl = 'https://www.iras.gov.sg/taxes/gst/input-tax?topic=claiming';
const liveUrl = 'https://www.iras.gov.sg/taxes/gst/input-tax?topic=claiming&version=2026';

const makeLocalRecord = (overrides = {}) => ({
  id: 'IRAS_LOCAL_VERIFIED',
  authority: 'IRAS',
  authorityName: 'Inland Revenue Authority of Singapore',
  sourcePublisher: 'Inland Revenue Authority of Singapore',
  legalOrStandardInstrument: 'GST Act',
  documentTitle: 'Input tax claims',
  standardOrActCode: 'IRAS',
  paragraphOrSection: 'Input tax',
  sourceText: 'A GST-registered business may claim input tax when the goods or services are used to make taxable supplies.',
  principleSummary: 'Input tax claim conditions',
  officialSourceUrl: localUrl,
  canonicalSourceUrl: localUrl,
  domain: 'IRAS_GST',
  jurisdiction: 'Singapore',
  tags: ['input tax'],
  sourceStatus: 'VERIFIED',
  sourceType: 'OFFICIAL_GUIDANCE',
  evidenceTier: 'OFFICIAL_GUIDANCE',
  isVerbatimText: true,
  verificationMethod: 'STATUTORY_LEGISLATION_AUDIT',
  lastVerifiedDate: '2026-09-01',
  provenance: 'LOCAL_STATIC',
  lifecycleState: 'ACTIVE',
  validFrom: '2023-01-01',
  ...overrides
});

const makeLiveRecord = (overrides = {}) => ({
  ...makeLocalRecord({
    id: 'IRAS_LIVE_CANDIDATE',
    sourceText: 'The current GST rate is 9% for taxable supplies.',
    officialSourceUrl: liveUrl,
    canonicalSourceUrl: liveUrl,
    sourceStatus: 'NEEDS_REVIEW',
    isVerbatimText: false,
    provenance: 'LIVE_EXTERNAL',
    lifecycleState: 'CANDIDATE',
    urlVerificationStatus: 'VERIFIED',
    verificationMethod: 'LIVE_OFFICIAL_TOPIC_VERIFIED',
    documentHash: 'a'.repeat(64),
    retrievedAt: '2026-09-26T08:00:00.000Z'
  }),
  ...overrides
});

const makeClaim = (text, recordId, overrides = {}) => ({
  text,
  recordId,
  quote: text,
  kind: 'RULE',
  ...overrides
});

const localQuote = 'A GST-registered business may claim input tax when the goods or services are used to make taxable supplies.';
const validLocal = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_LOCAL_VERIFIED')],
  [makeLocalRecord()],
  { missingFacts: [] }
);
assert.equal(validLocal.accepted.length, 1, 'An exact, complete verified local source quote is accepted.');
assert.deepEqual(validLocal.accepted[0], {
  text: localQuote,
  recordId: 'IRAS_LOCAL_VERIFIED',
  quote: localQuote,
  canonicalUrl: localUrl,
  supportKind: 'EXACT_SOURCE_QUOTE'
});

const liveQuote = 'The current GST rate is 9% for taxable supplies.';
const validLive = verifyEvidenceClaims(
  [makeClaim(liveQuote, 'IRAS_LIVE_CANDIDATE', { citationUrl: liveUrl })],
  [makeLiveRecord()],
  { missingFacts: [] }
);
assert.equal(validLive.accepted.length, 1, 'A genuine official live candidate with exact quote and provenance is accepted.');
assert.equal(validLive.accepted[0].supportKind, 'EXACT_SOURCE_QUOTE');

const changedPolarity = 'Input tax is not claimable for qualifying taxable business purchases.';
const polarityResult = verifyEvidenceClaims(
  [makeClaim(changedPolarity, 'IRAS_LOCAL_VERIFIED')],
  [makeLocalRecord({ sourceText: 'Input tax is claimable for qualifying taxable business purchases.' })],
  { missingFacts: [] }
);
assert.equal(polarityResult.accepted.length, 0, 'Same-vocabulary polarity reversal is not supported.');

for (const changedText of [
  'The current GST rate is 8% for taxable supplies.',
  'An application must be filed within 21 days after notice.',
  'The restriction does not apply to any motor vehicle.'
]) {
  const sourceText = changedText.startsWith('The current GST rate')
    ? liveQuote
    : changedText.startsWith('An application')
      ? 'An application must be filed within 30 days after notice.'
      : 'The restriction does not apply to motor vehicles used solely for prescribed commercial purposes.';
  const verifierResult = verifyEvidenceClaims(
    [makeClaim(changedText, 'IRAS_LIVE_CANDIDATE')],
    [makeLiveRecord({ sourceText })],
    { missingFacts: [] }
  );
  assert.equal(verifierResult.accepted.length, 0, `Changed rate, deadline, or exemption is rejected: ${changedText}`);
}

const inventedSource = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_MODEL_INVENTED_ID')],
  [makeLocalRecord()],
  { missingFacts: [] }
);
assert.equal(inventedSource.rejected[0].reason, 'SOURCE_RECORD_NOT_FOUND');

const wrongUrl = verifyEvidenceClaims(
  [makeClaim(liveQuote, 'IRAS_LIVE_CANDIDATE', { citationUrl: 'https://www.iras.gov.sg/taxes/gst/input-tax?topic=claiming&version=2025' })],
  [makeLiveRecord()],
  { missingFacts: [] }
);
assert.equal(wrongUrl.rejected[0].reason, 'CITATION_URL_MISMATCH', 'Query string identity is preserved when checking citation URLs.');

const crossRecordUrl = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_LOCAL_VERIFIED', { citationUrl: liveUrl })],
  [makeLocalRecord(), makeLiveRecord()],
  { missingFacts: [] }
);
assert.equal(crossRecordUrl.rejected[0].reason, 'CITATION_URL_MISMATCH', 'An approved URL from another record cannot be borrowed.');

const undatedHistorical = makeLocalRecord({
  id: 'IRAS_HISTORICAL',
  sourceStatus: 'HISTORICAL',
  validFrom: '2022-12-01',
  validTo: '2023-01-02'
});
const noHistoricalDate = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_HISTORICAL')],
  [undatedHistorical],
  { missingFacts: [] }
);
assert.equal(noHistoricalDate.rejected[0].reason, 'HISTORICAL_TARGET_DATE_REQUIRED');
const historicalDateAccepted = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_HISTORICAL')],
  [undatedHistorical],
  { missingFacts: [], targetDate: '2023-01-01' }
);
assert.equal(historicalDateAccepted.accepted.length, 1, 'A historical quote is accepted within its explicit effective period.');
const outOfPeriod = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_HISTORICAL')],
  [undatedHistorical],
  { missingFacts: [], targetDate: '2023-01-03' }
);
assert.equal(outOfPeriod.rejected[0].reason, 'SOURCE_NOT_IN_EFFECT_ON_TARGET_DATE');
const unboundedHistoricalQuestion = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_LOCAL_VERIFIED')],
  [makeLocalRecord({ validFrom: undefined })],
  { missingFacts: [], targetDate: '2025-01-01' }
);
assert.equal(unboundedHistoricalQuestion.rejected[0].reason, 'TARGET_DATE_UNBOUNDED');

const nonReviewedLocal = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_LOCAL_VERIFIED')],
  [makeLocalRecord({ sourceStatus: 'NEEDS_REVIEW' })],
  { missingFacts: [] }
);
assert.equal(nonReviewedLocal.rejected[0].reason, 'LOCAL_SOURCE_NOT_VERIFIED');
const reviewedHistoricalSummaryText = 'For disposals before 1 January 2026, the Section 13W safe harbour may apply to qualifying gains on ordinary shares, subject to the applicable ownership, holding-period and statutory exclusion conditions.';
const reviewedHistoricalSummary = makeLocalRecord({
  id: 'IRAS_HISTORICAL_CURATED_SUMMARY',
  sourceText: reviewedHistoricalSummaryText,
  sourceStatus: 'HISTORICAL',
  sourceType: 'CURATED_SUMMARY',
  evidenceTier: 'OFFICIAL_GUIDANCE',
  isVerbatimText: false,
  verificationMethod: 'CURATED_EDITORIAL_REVIEW',
  validFrom: '2012-06-01',
  validTo: '2025-12-31'
});
const reviewedSummaryClaim = verifyEvidenceClaims(
  [makeClaim(reviewedHistoricalSummaryText, 'IRAS_HISTORICAL_CURATED_SUMMARY')],
  [reviewedHistoricalSummary],
  { missingFacts: [], targetDate: '2025-12-30' }
);
assert.equal(reviewedSummaryClaim.accepted.length, 1,
  'An explicitly reviewed, date-bounded historical local summary may be quoted exactly even when it is not verbatim statute text.');

const reviewedCurrentSummary = makeLocalRecord({
  id: 'IRAS_VERIFIED_CURATED_SUMMARY',
  sourceText: 'The current filing process follows the applicable IRAS reporting instructions.',
  sourceStatus: 'VERIFIED',
  sourceType: 'CURATED_SUMMARY',
  evidenceTier: 'OFFICIAL_GUIDANCE',
  isVerbatimText: false,
  verificationMethod: 'CURATED_EDITORIAL_REVIEW'
});
const reviewedCurrentClaim = verifyEvidenceClaims(
  [makeClaim(reviewedCurrentSummary.sourceText, 'IRAS_VERIFIED_CURATED_SUMMARY')],
  [reviewedCurrentSummary],
  { missingFacts: [] }
);
assert.equal(reviewedCurrentClaim.accepted.length, 1,
  'An explicitly reviewed current local summary can be quoted exactly without being represented as verbatim statute text.');

const localWithoutReviewProvenance = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_LOCAL_VERIFIED')],
  [makeLocalRecord({ isVerbatimText: false, verificationMethod: undefined })],
  { missingFacts: [] }
);
assert.equal(localWithoutReviewProvenance.rejected[0].reason, 'LOCAL_SOURCE_REVIEW_PROVENANCE_MISSING');

const applicationClaim = verifyEvidenceClaims(
  [{ ...makeClaim(localQuote, 'IRAS_LOCAL_VERIFIED'), kind: 'APPLICATION' }],
  [makeLocalRecord()],
  { missingFacts: ['Supplier GST registration status is unknown.'] }
);
assert.equal(applicationClaim.accepted.length, 0, 'Application conclusions are never accepted from source quotation checks.');
assert.equal(applicationClaim.rejected[0].reason, 'APPLICATION_REQUIRES_FACTS_AND_DETERMINISTIC_ENGINE');

const partialConditionRecord = makeLocalRecord({
  sourceText: 'Input tax on customer entertainment may be claimed if the meal has a business purpose and a valid tax invoice is held.'
});
const partialConditionQuote = 'Input tax on customer entertainment may be claimed';
const incompleteCondition = verifyEvidenceClaims(
  [makeClaim(partialConditionQuote, 'IRAS_LOCAL_VERIFIED')],
  [partialConditionRecord],
  { missingFacts: [] }
);
assert.equal(incompleteCondition.rejected[0].reason, 'QUOTE_NOT_WHOLE_SENTENCE_OR_PARAGRAPH');

const qualificationText = 'Input tax may be claimed for qualifying business entertainment. However, special exclusions apply to specified costs.';
const qualificationRecord = makeLocalRecord({ sourceText: qualificationText });
const omittedContinuation = verifyEvidenceClaims(
  [makeClaim('Input tax may be claimed for qualifying business entertainment.', 'IRAS_LOCAL_VERIFIED')],
  [qualificationRecord],
  { missingFacts: [] }
);
assert.equal(omittedContinuation.rejected[0].reason, 'QUOTE_OMITS_ATTACHED_QUALIFICATION');
const completeQualification = verifyEvidenceClaims(
  [makeClaim(qualificationText, 'IRAS_LOCAL_VERIFIED')],
  [qualificationRecord],
  { missingFacts: [] }
);
assert.equal(completeQualification.accepted.length, 1, 'The complete paragraph with its attached exception remains quotable.');

const ellipsisQuote = verifyEvidenceClaims(
  [makeClaim('A GST-registered business may claim input tax... taxable supplies.', 'IRAS_LOCAL_VERIFIED')],
  [makeLocalRecord()],
  { missingFacts: [] }
);
assert.equal(ellipsisQuote.rejected[0].reason, 'ELLIPSIS_NOT_ALLOWED');

const unsafeUrlRecord = makeLocalRecord({
  officialSourceUrl: 'http://www.iras.gov.sg/taxes/gst/input-tax?topic=claiming'
});
const unsafeUrl = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_LOCAL_VERIFIED')],
  [unsafeUrlRecord],
  { missingFacts: [] }
);
assert.equal(unsafeUrl.rejected[0].reason, 'SOURCE_URL_NOT_APPROVED_OR_CANONICAL');

const incompleteLiveCandidate = verifyEvidenceClaims(
  [makeClaim(liveQuote, 'IRAS_LIVE_CANDIDATE')],
  [makeLiveRecord({ documentHash: undefined })],
  { missingFacts: [] }
);
assert.equal(incompleteLiveCandidate.rejected[0].reason, 'LIVE_SOURCE_CANDIDATE_INCOMPLETE');

const applicationSource = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_LOCAL_VERIFIED')],
  [makeLocalRecord({ sourceType: 'APPLICATION_RULE', evidenceTier: 'APPLICATION_RULE' })],
  { missingFacts: [] }
);
assert.equal(applicationSource.rejected[0].reason, 'APPLICATION_SOURCE_NOT_ALLOWED');

const sourceMapPointer = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_LOCAL_VERIFIED')],
  [makeLocalRecord({ recordRole: 'SOURCE_MAP_POINTER', groundingEligible: false })],
  { missingFacts: [] }
);
assert.equal(sourceMapPointer.rejected[0].reason, 'SOURCE_RECORD_NOT_GROUNDING_ELIGIBLE');

console.log('PASS | Exact source quote claim evidence verification');
