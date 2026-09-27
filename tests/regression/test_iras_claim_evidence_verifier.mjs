import assert from 'node:assert/strict';
import { verifyEvidenceClaims } from '../../src/verification/claimEvidenceVerifier.ts';
import { UNIFIED_SOURCE_REGISTRY, buildUnifiedSourceRegistry } from '../../src/standards/unifiedSourceModel.ts';
import { SINGAPORE_STATUTORY_REPOSITORY } from '../../src/standards/singaporeStatutesKnowledge.ts';
import { CitationVerifier } from '../../src/verification/citationVerifier.ts';
import { InMemorySourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { selectRelevantFetchedText } from '../../src/services/groundingContextBuilder.ts';

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
  supportKind: 'EXACT_SOURCE_QUOTE'
}, 'The local source remains usable as evidence without exposing its unverified URL.');

const verifiedLocalUrl = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_LOCAL_VERIFIED')],
  [makeLocalRecord({ urlVerificationStatus: 'VERIFIED', urlVerifiedDate: '2026-09-26', urlVerificationMethod: 'TESTED_EXACT_SOURCE_MAP_MATCH' })],
  { missingFacts: [] }
);
assert.equal(verifiedLocalUrl.accepted[0].canonicalUrl, localUrl,
  'An exact URL with separate verified provenance can be rendered as a citation.');
const guessedUrl = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_LOCAL_VERIFIED', { citationUrl: localUrl })],
  [makeLocalRecord()],
  { missingFacts: [] }
);
assert.equal(guessedUrl.rejected[0].reason, 'CITATION_URL_UNVERIFIED',
  'An approved host and matching canonical URL do not authorize a clickable citation.');

const liveQuote = 'The current GST rate is 9% for taxable supplies.';
const validLive = verifyEvidenceClaims(
  [makeClaim(liveQuote, 'IRAS_LIVE_CANDIDATE', { citationUrl: liveUrl })],
  [makeLiveRecord()],
  { missingFacts: [] }
);
assert.equal(validLive.accepted.length, 1, 'A genuine official live candidate with exact quote and provenance is accepted.');
assert.equal(validLive.accepted[0].supportKind, 'EXACT_SOURCE_QUOTE');

const remoteText = [
  'Motor vehicle input tax is generally restricted.',
  ...Array.from({ length: 12 }, (_, index) => `Unrelated filing detail ${index} has no bearing on vehicle eligibility.`),
  'A qualifying vehicle exception may apply only when its conditions are met.'
].join(' ');
const selectedFragments = selectRelevantFetchedText(remoteText,
  ['motor vehicle input tax', 'qualifying vehicle exception'], 300,
  'motor vehicle input tax qualifying vehicle exception');
assert.match(selectedFragments, /\n\n/, 'Noncontiguous fetched sentence windows retain a visible fragment boundary.');
const combinedFragmentClaim = selectedFragments.replace(/\n\n/g, ' ');
const crossWindowQuote = verifyEvidenceClaims(
  [makeClaim(combinedFragmentClaim, 'IRAS_LIVE_CANDIDATE', { citationUrl: liveUrl })],
  [makeLiveRecord({ sourceText: selectedFragments })],
  { missingFacts: [] }
);
assert.equal(crossWindowQuote.accepted.length, 0,
  'A quote joining noncontiguous live-page fragments is not a verbatim source span.');
assert.equal(crossWindowQuote.rejected[0].reason, 'QUOTE_NOT_WHOLE_SENTENCE_OR_PARAGRAPH');

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
assert.equal(reviewedSummaryClaim.accepted[0].supportKind, 'REVIEWED_EDITORIAL_SUMMARY');

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
assert.equal(reviewedCurrentClaim.accepted[0].supportKind, 'REVIEWED_EDITORIAL_SUMMARY');

const unifiedReviewedSummary = UNIFIED_SOURCE_REGISTRY.IRAS_FORM_CS_LITE_CRITERIA;
assert.equal(unifiedReviewedSummary.sourceStatus, 'VERIFIED',
  'A curated rule with review metadata retains its content review status in the unified registry.');
assert.equal(unifiedReviewedSummary.sourceType, 'CURATED_SUMMARY');
assert.equal(unifiedReviewedSummary.evidenceTier, 'OFFICIAL_GUIDANCE');
assert.equal(unifiedReviewedSummary.isVerbatimText, false);
assert.equal(unifiedReviewedSummary.verificationMethod, 'CURATED_EDITORIAL_REVIEW');
assert.equal(unifiedReviewedSummary.urlVerificationStatus, 'VERIFIED');
assert.equal(unifiedReviewedSummary.urlVerificationSourceMapId, 'IRAS_CIT_RETURNS_SOURCE_MAP',
  'A source-map URL match is recorded separately from the curated content-review status.');
assert.equal(UNIFIED_SOURCE_REGISTRY.MAS_SFO_13O_13U_MATERIAL_CHANGES.sourceStatus, 'NEEDS_REVIEW',
  'The IRAS curated-summary status correction does not promote MAS content.');
const reviewedSummaryCitation = new CitationVerifier(new InMemorySourceRetriever([unifiedReviewedSummary])).verifyCitation({
  standard: unifiedReviewedSummary.standardOrActCode,
  paragraph: unifiedReviewedSummary.paragraphOrSection,
  title: unifiedReviewedSummary.documentTitle,
  text: unifiedReviewedSummary.sourceText,
  officialSourceUrl: unifiedReviewedSummary.officialSourceUrl,
  authority: 'IRAS'
}, 'IRAS');
assert.equal(reviewedSummaryCitation.isValid, true);
assert.equal(reviewedSummaryCitation.status, 'STRUCTURALLY_VERIFIED_SUMMARY',
  'A reviewed curated summary is not mislabeled as content needing review by citation diagnostics.');
const originalUnreviewedFixture = SINGAPORE_STATUTORY_REPOSITORY.TEST_UNREVIEWED_CURATED_SUMMARY;
const originalMissingReviewFixture = SINGAPORE_STATUTORY_REPOSITORY.TEST_VERIFIED_SUMMARY_WITHOUT_REVIEW_PROVENANCE;
const summaryFixture = {
  id: 'TEST_CURATED_SUMMARY', authority: 'IRAS', authorityName: 'IRAS', actTitle: 'Income Tax Act 1947',
  actCode: 'ITA1947', sectionOrSchedule: 'Section 999', ruleTitle: 'Test summary', category: 'TAX_INCOME',
  principle: 'A reviewed summary fixture for source registry provenance behavior.', application: '', practicalRules: [],
  canonicalUrl: localUrl, tags: ['test summary'], sourceType: 'CURATED_SUMMARY', evidenceTier: 'CURATED_SUMMARY',
  isVerbatimText: false, lastVerifiedDate: '2026-09-26', reviewAuditCycleDays: 90
};
try {
  SINGAPORE_STATUTORY_REPOSITORY.TEST_UNREVIEWED_CURATED_SUMMARY = {
    ...summaryFixture, id: 'TEST_UNREVIEWED_CURATED_SUMMARY', sourceStatus: 'NEEDS_REVIEW'
  };
  SINGAPORE_STATUTORY_REPOSITORY.TEST_VERIFIED_SUMMARY_WITHOUT_REVIEW_PROVENANCE = {
    ...summaryFixture, id: 'TEST_VERIFIED_SUMMARY_WITHOUT_REVIEW_PROVENANCE', sourceStatus: 'VERIFIED', lastVerifiedDate: undefined
  };
  buildUnifiedSourceRegistry('2026-09-26');
  assert.equal(UNIFIED_SOURCE_REGISTRY.TEST_UNREVIEWED_CURATED_SUMMARY.sourceStatus, 'NEEDS_REVIEW',
    'A curated summary explicitly marked unreviewed remains NEEDS_REVIEW.');
  assert.equal(UNIFIED_SOURCE_REGISTRY.TEST_VERIFIED_SUMMARY_WITHOUT_REVIEW_PROVENANCE.sourceStatus, 'NEEDS_REVIEW',
    'A VERIFIED label without dated editorial review provenance is not enough to keep a curated summary VERIFIED.');
  assert.equal(UNIFIED_SOURCE_REGISTRY.TEST_UNREVIEWED_CURATED_SUMMARY.sourceType, 'CURATED_SUMMARY');
} finally {
  if (originalUnreviewedFixture) SINGAPORE_STATUTORY_REPOSITORY.TEST_UNREVIEWED_CURATED_SUMMARY = originalUnreviewedFixture;
  else delete SINGAPORE_STATUTORY_REPOSITORY.TEST_UNREVIEWED_CURATED_SUMMARY;
  if (originalMissingReviewFixture) SINGAPORE_STATUTORY_REPOSITORY.TEST_VERIFIED_SUMMARY_WITHOUT_REVIEW_PROVENANCE = originalMissingReviewFixture;
  else delete SINGAPORE_STATUTORY_REPOSITORY.TEST_VERIFIED_SUMMARY_WITHOUT_REVIEW_PROVENANCE;
  buildUnifiedSourceRegistry('2026-09-26');
}

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

const attachedMultiParagraphText = [
  'Input tax may be claimed for qualifying business entertainment.',
  'However, special exclusions apply to specified costs.',
  'In contrast, ordinary office supplies may be claimed when all normal conditions are met.'
].join('\n\n');
const attachedMultiParagraphRecord = makeLocalRecord({ sourceText: attachedMultiParagraphText });
const incompleteAttachedSpan = verifyEvidenceClaims(
  [makeClaim(attachedMultiParagraphText.split('\n\n').slice(0, 2).join(' '), 'IRAS_LOCAL_VERIFIED')],
  [attachedMultiParagraphRecord],
  { missingFacts: [] }
);
assert.equal(incompleteAttachedSpan.rejected[0].reason, 'QUOTE_OMITS_ATTACHED_QUALIFICATION',
  'A contiguous quote cannot stop before a further recognized attached qualification.');
const completeAttachedSpan = verifyEvidenceClaims(
  [makeClaim(attachedMultiParagraphText.replace(/\n\n/g, ' '), 'IRAS_LOCAL_VERIFIED')],
  [attachedMultiParagraphRecord],
  { missingFacts: [] }
);
assert.equal(completeAttachedSpan.accepted.length, 1,
  'An exact contiguous span including recognized attached paragraphs remains verifiable.');

const overseasServicesRule = 'Services performed completely outside Singapore may only be zero-rated if it falls within the list of services described in section 21(3)(i). Consultancy services do not fall within the list of services.';
const firstOverseasException = '• If your services are directly in connection with land or building located outside Singapore, you may zero-rate your services under section 21(3)(e).';
const secondOverseasException = '• If your services are directly in connection with goods located outside Singapore at the time services are performed, you may zero-rate your services under section 21(3)(f).';
const overseasExceptionRecord = makeLocalRecord({
  sourceText: [overseasServicesRule, 'Exceptions:', firstOverseasException, secondOverseasException].join('\n\n')
});
const overseasRuleWithoutExceptions = verifyEvidenceClaims(
  [makeClaim(overseasServicesRule, 'IRAS_LOCAL_VERIFIED')],
  [overseasExceptionRecord],
  { missingFacts: [] }
);
assert.equal(overseasRuleWithoutExceptions.rejected[0].reason, 'QUOTE_OMITS_ATTACHED_QUALIFICATION',
  'A zero-rating paragraph cannot be quoted without its following Exceptions block.');

const bareExceptionsLabel = verifyEvidenceClaims(
  [makeClaim('Exceptions:', 'IRAS_LOCAL_VERIFIED')],
  [makeLocalRecord({ sourceText: 'Exceptions:' })],
  { missingFacts: [] }
);
assert.equal(bareExceptionsLabel.rejected[0].reason, 'QUOTE_OMITS_ATTACHED_QUALIFICATION',
  'A colon-ended Exceptions label is not independently quotable.');

const ruleWithUnsupportedExceptionsLabel = verifyEvidenceClaims(
  [makeClaim(`${overseasServicesRule} Exceptions:`, 'IRAS_LOCAL_VERIFIED')],
  [makeLocalRecord({ sourceText: `${overseasServicesRule}\n\nExceptions:` })],
  { missingFacts: [] }
);
assert.equal(ruleWithUnsupportedExceptionsLabel.rejected[0].reason, 'QUOTE_OMITS_ATTACHED_QUALIFICATION',
  'A rule plus an Exceptions label without its supporting list remains incomplete.');

const unrelatedIfRule = 'A complete standalone rule requires a valid invoice for each claim.';
const unrelatedIfParagraph = 'If the company requests a separate review, the application checks that request independently.';
const unrelatedIfRecord = makeLocalRecord({ sourceText: `${unrelatedIfRule}\n\n${unrelatedIfParagraph}` });
const unrelatedIfRuleOnly = verifyEvidenceClaims(
  [makeClaim(unrelatedIfRule, 'IRAS_LOCAL_VERIFIED')],
  [unrelatedIfRecord],
  { missingFacts: [] }
);
assert.equal(unrelatedIfRuleOnly.accepted.length, 1,
  'An otherwise complete rule remains standalone when an unrelated later paragraph happens to begin with If.');
const unrelatedIfMerged = verifyEvidenceClaims(
  [makeClaim(`${unrelatedIfRule} ${unrelatedIfParagraph}`, 'IRAS_LOCAL_VERIFIED')],
  [unrelatedIfRecord],
  { missingFacts: [] }
);
assert.equal(unrelatedIfMerged.rejected[0].reason, 'QUOTE_NOT_WHOLE_SENTENCE_OR_PARAGRAPH',
  'A following If paragraph is not merged into an unrelated source rule.');
const unrelatedIfStandalone = verifyEvidenceClaims(
  [makeClaim(unrelatedIfParagraph, 'IRAS_LOCAL_VERIFIED')],
  [unrelatedIfRecord],
  { missingFacts: [] }
);
assert.equal(unrelatedIfStandalone.accepted.length, 1,
  'The following If paragraph remains independently quotable when complete.');

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
