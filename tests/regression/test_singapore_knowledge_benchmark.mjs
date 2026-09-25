import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BENCHMARK_DIMENSIONS, runSingaporeBenchmark } from '../evaluation/singapore/run.mjs';
import { GROUNDING_SOURCE_MAX_RESULTS } from '../../src/services/groundingContextBuilder.ts';

const fixture = JSON.parse(await readFile(new URL('../evaluation/singapore/gemini-seed.json', import.meta.url), 'utf8'));
const reviewedFixture = JSON.parse(await readFile(new URL('../evaluation/singapore/reviewed-knowledge.json', import.meta.url), 'utf8'));
const ids = fixture.cases.map(testCase => testCase.id);
assert.equal(new Set(ids).size, ids.length, 'Benchmark case IDs must be unique');
assert.ok(fixture.cases.every(testCase => Array.isArray(testCase.expected.domainIds)), 'Each fixture case must provide reviewed fine-grained domain labels, including empty labels for controls');
assert.ok(fixture.cases.some(testCase => testCase.provenance === 'gemini-seed-negative' && testCase.expected.authorities.length === 0), 'Include nonstatutory MOM ambiguity controls');
assert.ok(fixture.cases.some(testCase => testCase.id === 'mas-iras-section-13o' && testCase.expected.authorities.length === 2), 'Include an explicit multi-authority 13O sentinel');

const report = await runSingaporeBenchmark();
assert.equal(report.totalCases, fixture.cases.length);
assert.deepEqual(Object.keys(report.summary), BENCHMARK_DIMENSIONS);
for (const result of report.results) {
  assert.deepEqual(Object.keys(result.dimensions), BENCHMARK_DIMENSIONS, `${result.id} must report every benchmark dimension`);
}

let capturedRetrievalQuery;
const sourceHarness = {
  async retrieveSources(query) {
    capturedRetrievalQuery = query;
    return [{ id: 'REVIEWED_FIXTURE_SOURCE' }];
  }
};
const retrievalHarnessReport = await runSingaporeBenchmark({
  fixturesData: {
    cases: [{
      id: 'retrieval-harness-contract',
      provenance: 'test',
      question: 'IRAS GST registration',
      expected: {
        authorities: ['IRAS'],
        topicIds: ['gst_compulsory_registration'],
        multiAuthority: false,
        sourceRecordIds: ['REVIEWED_FIXTURE_SOURCE']
      }
    }]
  },
  sourceRetriever: sourceHarness
});
assert.equal(retrievalHarnessReport.results[0].dimensions.sourceRetrieval.status, 'PASS');
assert.equal(retrievalHarnessReport.results[0].dimensions.sourceRetrieval.selectionMode, 'precisionChecked', 'Legacy exact source expectations include a precision check');
assert.equal(retrievalHarnessReport.sourceEvaluation.answerGrounding.startsWith('NOT_EVALUATED'), true, 'Independent candidate retrieval must not imply answer grounding');
assert.equal(retrievalHarnessReport.results[0].evaluationContext.sourceRetrieval.answerGrounding, 'NOT_EVALUATED');
assert.equal(capturedRetrievalQuery.domain, 'IRAS_GST');
assert.deepEqual(capturedRetrievalQuery.authorities, ['IRAS']);
assert.ok(capturedRetrievalQuery.topicIds.includes('gst_compulsory_registration'));
assert.equal(capturedRetrievalQuery.maxResults, GROUNDING_SOURCE_MAX_RESULTS, 'Benchmark retrieval limit must match production grounding');

const sourceUrl = 'https://example.gov.sg/standard';
const reviewedCase = (id, reviewedOracle) => ({
  id,
  provenance: 'reviewed-harness',
  question: 'How should this item be measured?',
  reviewedOracle: {
    review: { status: 'INDEPENDENTLY_VERIFIED', reviewer: 'harness reviewer', reviewedAt: '2026-09-25' },
    ...reviewedOracle
  }
});
const harnessCase = reviewedCase('end-to-end-good', {
  claims: [{
    id: 'measurement',
    conclusion: 'Measure at amortised cost.',
    sources: [{ recordId: 'REVIEWED_STANDARD_SOURCE' }],
    assertions: [
      { path: 'messageText', op: 'includes', value: 'amortised cost' },
      { path: 'messageText', op: 'notIncludes', value: 'measured at FVTPL' },
      { path: 'messageText', op: 'matches', pattern: 'effective from 1 January 2026' },
      { path: 'messageText', op: 'notMatches', pattern: 'effective from 1 January 2025' }
    ]
  }],
  calculation: {
    forbidJournal: true,
    checks: [{ path: 'messageText', op: 'numberInText', pattern: 'initial amount: SGD\\s*([\\d,]+(?:\\.\\d+)?)', value: 102000, tolerance: 0.01 }]
  },
  missingFacts: { required: [{
    id: 'cash-flow-test',
    assertions: [{ path: 'messageText', op: 'includesAny', values: ['principal and interest'] }]
  }] },
  effectiveDate: { assertions: [{ path: 'messageText', op: 'includes', value: '1 January 2026' }] },
  citations: { required: [{ claimId: 'measurement', officialSourceUrl: sourceUrl, standard: 'SFRS(I) 9' }] }
});
const harnessSourceRetriever = {
  async retrieveSources() { return [{ id: 'REVIEWED_STANDARD_SOURCE' }]; }
};
async function runReviewedAnswerCase(caseId, messageText) {
  const testCase = reviewedFixture.cases.find(item => item.id === caseId);
  assert.ok(testCase, `Reviewed fixture must contain ${caseId}`);
  const recordIds = (testCase.reviewedOracle?.claims || [])
    .flatMap(claim => claim.sources || [])
    .map(source => source.recordId)
    .filter(recordId => typeof recordId === 'string');
  return runSingaporeBenchmark({
    fixturesData: { schemaVersion: reviewedFixture.schemaVersion, cases: [testCase] },
    sourceRetriever: { async retrieveSources() { return recordIds.map(id => ({ id })); } },
    answerFunction: async () => ({ messageText, scenarioState: { directGroups: [] } })
  });
}

const definitiveFvtplConflict = await runReviewedAnswerCase(
  'sfrsi9-debt-hold-collect',
  'Amortised cost is a possible category. This asset is classified as FVTPL.'
);
assert.equal(definitiveFvtplConflict.results[0].dimensions.answerCorrectness.status, 'FAIL', 'A definite FVTPL conclusion must fail the hold-to-collect amortised-cost oracle');

const fairValueOptionException = await runReviewedAnswerCase(
  'sfrsi9-debt-hold-collect',
  'This asset is measured at amortised cost. An entity may irrevocably designate the asset at fair value through profit or loss on initial recognition if that eliminates or significantly reduces an accounting mismatch.'
);
assert.equal(fairValueOptionException.results[0].dimensions.answerCorrectness.status, 'PASS', 'A conditional fair-value option exception must not be mistaken for a conflicting classification');

const missingFactsWithDefinitiveClassification = await runReviewedAnswerCase(
  'sfrsi9-bond-missing-facts',
  'The business model and contractual cash flows determine classification. Please provide those details. This bond is classified as amortised cost.'
);
assert.equal(missingFactsWithDefinitiveClassification.results[0].dimensions.answerCorrectness.status, 'FAIL', 'Requesting missing facts must not excuse a definitive classification unsupported by those facts');

const wrongHistoricalGstRate = await runReviewedAnswerCase(
  'iras-gst-standard-rate-2023',
  'In 2022, GST was 8% and SGD 80. For the supply on 15 June 2023, GST was 9% and output GST was SGD 90.'
);
assert.equal(wrongHistoricalGstRate.results[0].dimensions.answerCorrectness.status, 'FAIL', 'A response must use the 2023 historical rate for the stated transaction date');
assert.equal(wrongHistoricalGstRate.results[0].dimensions.calculationCorrectness.status, 'FAIL', 'The 2023 GST calculation must reject the incorrect rate and amount');

const mismatchedHistoricalGstClauses = await runReviewedAnswerCase(
  'iras-gst-standard-rate-2023',
  'On 15 June 2023, GST was 9%; in 2022 GST was 8%, so output GST was SGD 80.'
);
assert.equal(mismatchedHistoricalGstClauses.results[0].dimensions.answerCorrectness.status, 'FAIL', 'A rate from a different year must not satisfy the transaction-date answer assertion across a semicolon');
assert.equal(mismatchedHistoricalGstClauses.results[0].dimensions.calculationCorrectness.status, 'FAIL', 'A rate from a different year must not satisfy the historical GST amount check across a semicolon');
assert.equal(mismatchedHistoricalGstClauses.results[0].dimensions.effectiveDateCorrectness.status, 'FAIL', 'A later clause with a different-year rate must not satisfy the historical effective-date check');

const correctHistoricalGstRate = await runReviewedAnswerCase(
  'iras-gst-standard-rate-2023',
  'For a standard-rated supply made on 15 June 2023 the GST rate was 8% and the output GST was SGD 80.'
);
assert.equal(correctHistoricalGstRate.results[0].dimensions.answerCorrectness.status, 'PASS', 'The reviewed historical GST rate and amount should pass');
assert.equal(correctHistoricalGstRate.results[0].dimensions.calculationCorrectness.status, 'PASS', 'The reviewed historical GST calculation should pass');

let answerCalls = 0;
const completeAnswer = {
  messageText: `Measure at amortised cost. Initial amount: SGD 102,000. The cash flows are principal and interest. Effective from 1 January 2026. [SFRS(I) 9](${sourceUrl})`,
  scenarioState: { directGroups: [] }
};
const endToEndReport = await runSingaporeBenchmark({
  fixturesData: { schemaVersion: 2, cases: [harnessCase] },
  sourceRetriever: harnessSourceRetriever,
  answerFunction: async (question, standard, testCase) => {
    answerCalls += 1;
    assert.equal(question, harnessCase.question);
    assert.equal(standard, 'SFRS_I');
    assert.equal(testCase.id, harnessCase.id);
    return completeAnswer;
  }
});
const goodDimensions = endToEndReport.results[0].dimensions;
assert.equal(answerCalls, 1, 'Verified reviewed fixtures must exercise the injected end-to-end answer function');
assert.equal(goodDimensions.sourceRetrieval.status, 'PASS');
assert.equal(goodDimensions.answerCorrectness.status, 'PASS');
assert.equal(goodDimensions.calculationCorrectness.status, 'PASS');
assert.equal(goodDimensions.citationCorrectness.status, 'PASS');
assert.equal(goodDimensions.missingFactBehaviour.status, 'PASS');
assert.equal(goodDimensions.effectiveDateCorrectness.status, 'PASS');
assert.equal(goodDimensions.sourceRetrieval.selectionMode, 'recallOnly', 'Reviewed claim source lists check recall unless a precision oracle is supplied');

const precisionOracleCase = reviewedCase('source-selection-precision-oracle', {
  claims: [{
    id: 'measurement',
    conclusion: 'Measure at amortised cost.',
    sources: [{ recordId: 'REVIEWED_STANDARD_SOURCE' }],
    assertions: [{ path: 'messageText', op: 'includes', value: 'amortised cost' }]
  }],
  sourceSelection: {
    allowedRecordIds: ['REVIEWED_STANDARD_SOURCE'],
    forbiddenRecordIds: ['UNRELATED_RECORD']
  }
});
const precisionOracleReport = await runSingaporeBenchmark({
  fixturesData: { schemaVersion: 2, cases: [precisionOracleCase] },
  sourceRetriever: harnessSourceRetriever,
  answerFunction: async () => ({ messageText: 'Measure at amortised cost.', scenarioState: { directGroups: [] } })
});
assert.equal(precisionOracleReport.results[0].dimensions.sourceRetrieval.status, 'PASS');
assert.equal(precisionOracleReport.results[0].dimensions.sourceRetrieval.selectionMode, 'precisionChecked');
const poorPrecisionReport = await runSingaporeBenchmark({
  fixturesData: { schemaVersion: 2, cases: [precisionOracleCase] },
  sourceRetriever: { async retrieveSources() { return [
    { id: 'REVIEWED_STANDARD_SOURCE' },
    { id: 'UNRELATED_RECORD' }
  ]; } },
  answerFunction: async () => ({ messageText: 'Measure at amortised cost.', scenarioState: { directGroups: [] } })
});
assert.equal(poorPrecisionReport.results[0].dimensions.sourceRetrieval.status, 'FAIL', 'Reviewed forbidden candidates must fail source precision');

const missingClaimSourceCase = reviewedCase('missing-per-claim-source-record', {
  claims: [
    { id: 'sourced-claim', conclusion: 'First conclusion.', sources: [{ recordId: 'REVIEWED_STANDARD_SOURCE' }], assertions: [{ path: 'messageText', op: 'includes', value: 'First conclusion' }] },
    { id: 'unsourced-claim', conclusion: 'Second conclusion.', assertions: [{ path: 'messageText', op: 'includes', value: 'Second conclusion' }] }
  ]
});
const missingClaimSourceReport = await runSingaporeBenchmark({
  fixturesData: { schemaVersion: 2, cases: [missingClaimSourceCase] },
  sourceRetriever: harnessSourceRetriever,
  answerFunction: async () => ({ messageText: 'First conclusion. Second conclusion.', scenarioState: { directGroups: [] } })
});
assert.equal(missingClaimSourceReport.results[0].dimensions.sourceRetrieval.status, 'FAIL', 'A sourced claim must not conceal another substantive claim without a source record expectation');
assert.equal(missingClaimSourceReport.results[0].dimensions.sourceRetrieval.checks[0].claims[1].status, 'FAIL');

const falsePassCase = reviewedCase('routing-cannot-pass-answer', {
  claims: [{ id: 'required-conclusion', conclusion: 'Must conclude amortised cost.', sources: [{ recordId: 'REVIEWED_STANDARD_SOURCE' }], assertions: [{ path: 'messageText', op: 'includes', value: 'amortised cost' }] }]
});
const falsePassReport = await runSingaporeBenchmark({
  fixturesData: { schemaVersion: 2, cases: [falsePassCase] },
  sourceRetriever: harnessSourceRetriever,
  answerFunction: async () => ({ messageText: 'No accounting conclusion was returned.', scenarioState: { directGroups: [] } })
});
assert.equal(falsePassReport.results[0].dimensions.sourceRetrieval.status, 'PASS');
assert.equal(falsePassReport.results[0].dimensions.answerCorrectness.status, 'FAIL', 'Successful routing must not mask a wrong substantive answer');

const missingAnswerReport = await runSingaporeBenchmark({
  fixturesData: { schemaVersion: 2, cases: [falsePassCase] },
  sourceRetriever: harnessSourceRetriever,
  answerFunction: async () => undefined
});
assert.equal(missingAnswerReport.results[0].dimensions.answerCorrectness.status, 'FAIL', 'Missing answers must fail reviewed claims');

const incorrectMathCase = reviewedCase('incorrect-numeric-answer', {
  claims: [{ id: 'amount', conclusion: 'Expected SGD 102,000.', assertions: [{ path: 'messageText', op: 'includes', value: 'SGD 102,000' }] }],
  calculation: { checks: [{ path: 'messageText', op: 'numberInText', pattern: 'initial amount: SGD\\s*([\\d,]+)', value: 102000, tolerance: 0.01 }] }
});
const wrongMathReport = await runSingaporeBenchmark({
  fixturesData: { schemaVersion: 2, cases: [incorrectMathCase] },
  sourceRetriever: harnessSourceRetriever,
  answerFunction: async () => ({ messageText: 'Expected initial amount: SGD 101,000.', scenarioState: { directGroups: [] } })
});
assert.equal(wrongMathReport.results[0].dimensions.calculationCorrectness.status, 'FAIL', 'Numeric answer assertions must reject incorrect amounts');

const missingCitationReport = await runSingaporeBenchmark({
  fixturesData: { schemaVersion: 2, cases: [harnessCase] },
  sourceRetriever: harnessSourceRetriever,
  answerFunction: async () => ({ ...completeAnswer, messageText: 'Measure at amortised cost. Initial amount: SGD 102,000. The cash flows are principal and interest. Effective from 1 January 2026.' })
});
assert.equal(missingCitationReport.results[0].dimensions.citationCorrectness.status, 'FAIL', 'A correct conclusion without the reviewed citation must fail citation support');

const paragraphCitationCase = reviewedCase('citation-paragraph-and-standard-suffix', {
  claims: [{
    id: 'paragraph-backed-claim',
    conclusion: 'Supported conclusion.',
    sources: [{ recordId: 'REVIEWED_STANDARD_SOURCE', officialSourceUrl: sourceUrl, paragraphs: ['4.1.2'] }],
    assertions: [{ path: 'messageText', op: 'includes', value: 'Supported conclusion' }]
  }],
  citations: { required: [{ claimId: 'paragraph-backed-claim', officialSourceUrl: sourceUrl, standard: 'SFRS(I) 9' }] }
});
const paragraphCitationReport = await runSingaporeBenchmark({
  fixturesData: { schemaVersion: 2, cases: [paragraphCitationCase] },
  sourceRetriever: harnessSourceRetriever,
  answerFunction: async () => ({
    messageText: `Supported conclusion. [SFRS(I) 9 §4.1.2](${sourceUrl})`,
    scenarioState: { directGroups: [] }
  })
});
assert.equal(paragraphCitationReport.results[0].dimensions.citationCorrectness.status, 'PASS', 'Citation parsing must separate a standard code from its paragraph suffix');
const adjacentParagraphReport = await runSingaporeBenchmark({
  fixturesData: { schemaVersion: 2, cases: [paragraphCitationCase] },
  sourceRetriever: harnessSourceRetriever,
  answerFunction: async () => ({
    messageText: `Supported conclusion. [SFRS(I) 9 §4.1.20](${sourceUrl})`,
    scenarioState: { directGroups: [] }
  })
});
assert.equal(adjacentParagraphReport.results[0].dimensions.citationCorrectness.status, 'FAIL', 'A neighboring paragraph number must not satisfy the reviewed citation requirement');

const distinctCitationUrlCase = reviewedCase('citation-url-distinct-from-retrieval-record', {
  claims: [{
    id: 'adoption-claim',
    conclusion: 'The local standard adopts this requirement.',
    sources: [{ recordId: 'REVIEWED_STANDARD_SOURCE', officialSourceUrl: sourceUrl, paragraphs: ['4.1.2'] }],
    assertions: [{ path: 'messageText', op: 'includes', value: 'local standard adopts' }]
  }],
  citations: { required: [{ claimId: 'adoption-claim', officialSourceUrl: 'https://www.acra.gov.sg/standards/adoption', standard: 'SFRS(I) 9' }] }
});
const distinctCitationUrlReport = await runSingaporeBenchmark({
  fixturesData: { schemaVersion: 2, cases: [distinctCitationUrlCase] },
  sourceRetriever: harnessSourceRetriever,
  answerFunction: async () => ({
    messageText: 'The local standard adopts this requirement. [SFRS(I) 9](https://www.acra.gov.sg/standards/adoption)',
    scenarioState: { directGroups: [] }
  })
});
assert.equal(distinctCitationUrlReport.results[0].dimensions.citationCorrectness.status, 'PASS', 'Paragraphs from a different source URL must not be required from a local adoption citation');

const missingParagraphReport = await runSingaporeBenchmark({
  fixturesData: { schemaVersion: 2, cases: [paragraphCitationCase] },
  sourceRetriever: harnessSourceRetriever,
  answerFunction: async () => ({
    messageText: `Supported conclusion. [SFRS(I) 9](${sourceUrl})`,
    scenarioState: { directGroups: [] }
  })
});
assert.equal(missingParagraphReport.results[0].dimensions.citationCorrectness.status, 'FAIL', 'A URL without the reviewed paragraph reference must not pass citation support');

const inventedJournalReport = await runSingaporeBenchmark({
  fixturesData: { schemaVersion: 2, cases: [harnessCase] },
  sourceRetriever: harnessSourceRetriever,
  answerFunction: async () => ({
    ...completeAnswer,
    scenarioState: { directGroups: [{ isHypothetical: false, isBalanced: true, lines: [{ accountName: 'Investment', debit: 102000, credit: 0 }, { accountName: 'Cash', debit: 0, credit: 102000 }] }] }
  })
});
assert.equal(inventedJournalReport.results[0].dimensions.calculationCorrectness.status, 'FAIL', 'Unrequested journals must fail an explicit forbidJournal oracle');

const journalBalanceCase = reviewedCase('journal-balance-oracle', {
  claims: [{ id: 'journal-result', conclusion: 'The balanced journal is required.', sources: [{ recordId: 'REVIEWED_STANDARD_SOURCE' }], assertions: [{ path: 'messageText', op: 'includes', value: 'balanced journal' }] }],
  calculation: {
    requireJournal: true,
    requireBalanced: true,
    expectedLines: [
      { accountName: 'Investment', side: 'DEBIT', amount: 100 },
      { accountName: 'Cash', side: 'CREDIT', amount: 100 }
    ]
  }
});
const journalAnswer = {
  messageText: 'The balanced journal is required.',
  scenarioState: { directGroups: [{
    id: 'journal-1',
    isBalanced: true,
    lines: [
      { accountName: 'Investment', debit: 100, credit: 0 },
      { accountName: 'Cash', debit: 0, credit: 100 }
    ]
  }] }
};
const balancedJournalReport = await runSingaporeBenchmark({
  fixturesData: { schemaVersion: 2, cases: [journalBalanceCase] },
  sourceRetriever: harnessSourceRetriever,
  answerFunction: async () => journalAnswer
});
assert.equal(balancedJournalReport.results[0].dimensions.calculationCorrectness.status, 'PASS', 'Reviewed journal line and balance expectations must accept the correct entry');

const unbalancedJournalReport = await runSingaporeBenchmark({
  fixturesData: { schemaVersion: 2, cases: [journalBalanceCase] },
  sourceRetriever: harnessSourceRetriever,
  answerFunction: async () => ({
    messageText: 'The balanced journal is required.',
    scenarioState: { directGroups: [{
      id: 'journal-1',
      isBalanced: false,
      lines: [
        { accountName: 'Investment', debit: 100, credit: 0 },
        { accountName: 'Cash', debit: 0, credit: 99 }
      ]
    }] }
  })
});
assert.equal(unbalancedJournalReport.results[0].dimensions.calculationCorrectness.status, 'FAIL', 'Journal balance checks must reject an unbalanced answer');

const malformedJournalAmountCase = reviewedCase('malformed-expected-journal-amount', {
  claims: [{ id: 'journal-result', conclusion: 'Journal conclusion.', sources: [{ recordId: 'REVIEWED_STANDARD_SOURCE' }], assertions: [{ path: 'messageText', op: 'includes', value: 'Journal conclusion' }] }],
  calculation: {
    requireJournal: true,
    expectedLines: [{ accountName: 'Investment', side: 'DEBIT', amount: 'SGD 100' }]
  }
});
const malformedJournalAmountReport = await runSingaporeBenchmark({
  fixturesData: { schemaVersion: 2, cases: [malformedJournalAmountCase] },
  sourceRetriever: harnessSourceRetriever,
  answerFunction: async () => ({
    messageText: 'Journal conclusion.',
    scenarioState: { directGroups: [{
      isBalanced: true,
      lines: [{ accountName: 'Investment', debit: 100, credit: 0 }]
    }] }
  })
});
assert.equal(malformedJournalAmountReport.results[0].dimensions.calculationCorrectness.status, 'FAIL', 'Malformed reviewed expected amounts must fail instead of removing the amount constraint');
assert.equal(malformedJournalAmountReport.results[0].dimensions.calculationCorrectness.journal[1].lines[0].reason.includes('finite non-negative number'), true);

let draftAnswerCalls = 0;
const draftReport = await runSingaporeBenchmark({
  fixturesData: { cases: [reviewedCase('unreviewed-stays-unscored', {
    review: { status: 'DRAFT', reviewer: 'author', reviewedAt: '2026-09-25' },
    claims: [{ id: 'draft', conclusion: 'draft', assertions: [{ path: 'messageText', op: 'includes', value: 'draft' }] }]
  })] },
  answerFunction: async () => { draftAnswerCalls += 1; return completeAnswer; }
});
assert.equal(draftAnswerCalls, 0, 'Draft oracles must not score production answers');
assert.equal(draftReport.results[0].dimensions.answerCorrectness.status, 'NOT_EVALUATED');

console.log(`PASS | Singapore knowledge benchmark framework: ${report.totalCases} cases; ${BENCHMARK_DIMENSIONS.length} dimensions`);
for (const [dimension, score] of Object.entries(report.summary)) {
  const accuracy = score.accuracy === null ? 'NOT_EVALUATED' : `${(score.accuracy * 100).toFixed(1)}%`;
  console.log(`  ${dimension}: ${score.passed}/${score.evaluated} passed (${accuracy})`);
}
