import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { QueryTopicResolver } from '../../src/retrieval/queryTopicResolver.ts';
import { runStatutoryCoverageBenchmark, evaluateCapturedAnswer } from '../../scripts/evaluate_statutory_coverage.mjs';

const fixture = JSON.parse(await readFile(new URL('../evaluation/statutory_coverage_wave_2026-10-25.json', import.meta.url), 'utf8'));
assert.equal(fixture.cases.length, 100);
assert.deepEqual(fixture.authorityCounts, { IRAS: 20, CPF: 20, MOM: 20, ACRA: 20, MAS: 20 });
assert.equal(new Set(fixture.cases.map(testCase => testCase.id)).size, fixture.cases.length);
for (const testCase of fixture.cases) {
  assert.ok(testCase.question.trim());
  assert.ok(testCase.requiredTopicIds.length > 0);
  assert.equal(testCase.officialSources.every(url => new URL(url).hostname.endsWith('.gov.sg')), true);
  assert.ok(['ANSWER', 'CLARIFY'].includes(testCase.expected.disposition));
  assert.ok(testCase.operation);
  assert.ok(testCase.temporal.status);
  assert.ok(testCase.calculation.status);
}

const inputTaxCase = fixture.cases.find(testCase => testCase.id === 'iras-input-tax-01');
const completeInputTaxAnswer = 'A business must be GST registered. The goods and services must be supplied to it or imported by it and used for business purposes. Keep a valid tax invoice or import permit, and the input must relate to taxable supplies.';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const independentReview = (answer, outcome = 'CORRECT', testCase = inputTaxCase) => ({
  outcome,
  reviewer: { kind: 'HUMAN', identity: 'synthetic-regression-reviewer' },
  reason: 'Synthetic test adjudication for evaluator contract coverage.',
  caseId: testCase.id,
  questionSha256: sha256(testCase.question),
  answerSha256: sha256(answer)
});

const uncheckedMatch = evaluateCapturedAnswer(inputTaxCase, {
  answer: completeInputTaxAnswer,
  citations: [inputTaxCase.officialSources[0]]
});
assert.equal(uncheckedMatch.checklistStatus, 'PASS');
assert.equal(uncheckedMatch.outcome, 'PARTIAL', 'Fact-group matches cannot promote an unreviewed answer to CORRECT.');
assert.equal(uncheckedMatch.independentReviewStatus, 'PENDING');

const reviewedMatch = evaluateCapturedAnswer(inputTaxCase, {
  answer: completeInputTaxAnswer,
  citations: [inputTaxCase.officialSources[0]],
  independentReview: independentReview(completeInputTaxAnswer)
});
assert.equal(reviewedMatch.outcome, 'CORRECT');
assert.equal(reviewedMatch.independentReviewStatus, 'HUMAN_REVIEW_CORRECT');
const unsupportedWithMatchedChecklist = evaluateCapturedAnswer(inputTaxCase, {
  answer: completeInputTaxAnswer,
  citations: [],
  independentReview: independentReview(completeInputTaxAnswer, 'UNSUPPORTED')
});
assert.equal(unsupportedWithMatchedChecklist.checklistStatus, 'PASS');
assert.equal(unsupportedWithMatchedChecklist.citationStatus, 'FAIL');
assert.equal(unsupportedWithMatchedChecklist.answerStatus, 'UNSUPPORTED');
assert.equal(unsupportedWithMatchedChecklist.outcome, 'UNSUPPORTED',
  'A valid independent UNSUPPORTED review overrides lexical PASS and is not obscured by citation failure.');
const partialChecklistAnswer = 'The purchase must be supplied to the business and used for business purposes.';
const unsupportedWithPartialChecklist = evaluateCapturedAnswer(inputTaxCase, {
  answer: partialChecklistAnswer,
  citations: [inputTaxCase.officialSources[0]],
  independentReview: independentReview(partialChecklistAnswer, 'UNSUPPORTED')
});
assert.equal(unsupportedWithPartialChecklist.checklistStatus, 'PARTIAL');
assert.equal(unsupportedWithPartialChecklist.outcome, 'UNSUPPORTED');
const failedChecklistAnswer = 'The statutory rules require careful review.';
const unsupportedWithFailedChecklist = evaluateCapturedAnswer(inputTaxCase, {
  answer: failedChecklistAnswer,
  citations: [inputTaxCase.officialSources[0]],
  independentReview: independentReview(failedChecklistAnswer, 'UNSUPPORTED')
});
assert.equal(unsupportedWithFailedChecklist.checklistStatus, 'FAIL');
assert.equal(unsupportedWithFailedChecklist.outcome, 'UNSUPPORTED');
assert.equal(evaluateCapturedAnswer(inputTaxCase, {
  answer: completeInputTaxAnswer,
  citations: [inputTaxCase.officialSources[0]],
  independentReview: { ...independentReview(completeInputTaxAnswer), answerSha256: sha256('stale answer') }
}).outcome, 'PARTIAL', 'A stale review hash must not adjudicate a changed answer.');
const copiedReviewDifferentCase = evaluateCapturedAnswer({ ...inputTaxCase, id: 'iras-input-tax-copied-review' }, {
  answer: completeInputTaxAnswer,
  citations: [inputTaxCase.officialSources[0]],
  independentReview: independentReview(completeInputTaxAnswer)
});
assert.equal(copiedReviewDifferentCase.independentReviewStatus, 'INVALID_OR_STALE_REVIEW');
assert.equal(copiedReviewDifferentCase.outcome, 'PARTIAL', 'A review cannot be replayed onto a different fixture ID.');
const copiedReviewDifferentQuestion = evaluateCapturedAnswer({ ...inputTaxCase, question: `${inputTaxCase.question} Please confirm the business purpose.` }, {
  answer: completeInputTaxAnswer,
  citations: [inputTaxCase.officialSources[0]],
  independentReview: independentReview(completeInputTaxAnswer)
});
assert.equal(copiedReviewDifferentQuestion.independentReviewStatus, 'INVALID_OR_STALE_REVIEW');
assert.equal(copiedReviewDifferentQuestion.outcome, 'PARTIAL', 'A review cannot be replayed onto a different question.');

assert.equal(evaluateCapturedAnswer(inputTaxCase, {
  answer: completeInputTaxAnswer,
  citations: [],
  independentReview: independentReview(completeInputTaxAnswer)
}).outcome, 'CITATION_FAILURE', 'Citation gaps remain distinct from checklist matches.');
assert.equal(evaluateCapturedAnswer(inputTaxCase, {
  answer: completeInputTaxAnswer,
  citations: [`${inputTaxCase.officialSources[0]}?utm_source=unverified`],
  independentReview: independentReview(completeInputTaxAnswer)
}).citationStatus, 'FAIL', 'Query-string variants must not impersonate an approved source URL.');
assert.equal(evaluateCapturedAnswer(inputTaxCase, {
  answer: completeInputTaxAnswer,
  citations: [inputTaxCase.officialSources[0].replace('/conditions-', '/Conditions-')],
  independentReview: independentReview(completeInputTaxAnswer)
}).citationStatus, 'FAIL', 'Source path matching preserves case.');
assert.equal(evaluateCapturedAnswer(inputTaxCase, {
  answer: completeInputTaxAnswer,
  citations: ['https://www.iras.gov.sg/unrelated-page'],
  independentReview: independentReview(completeInputTaxAnswer)
}).citationStatus, 'FAIL', 'An unrelated official page is not an approved citation for this case.');
for (const id of ['iras-input-tax-01', 'iras-gst-filing-01', 'iras-eci-01']) {
  const caseWithParenthesesAlias = fixture.cases.find(testCase => testCase.id === id);
  assert.ok(caseWithParenthesesAlias.officialSources.length > 1,
    `${id} records the exact production parentheses URL as an approved source alias`);
  assert.equal(evaluateCapturedAnswer(caseWithParenthesesAlias, {
    answer: 'Source alias test.', citations: [caseWithParenthesesAlias.officialSources[1]]
  }).citationStatus, 'PASS', `${id} accepts only its generator-registered literal-parentheses alias`);
}
const encodedSlashUrl = inputTaxCase.officialSources[0].replace('/taxes/', '%2Ftaxes/');
assert.equal(evaluateCapturedAnswer(inputTaxCase, {
  answer: completeInputTaxAnswer, citations: [encodedSlashUrl]
}).citationStatus, 'FAIL', 'An encoded slash is not an approved citation alias.');

assert.equal(evaluateCapturedAnswer(inputTaxCase, {
  answer: 'GST registration and tax invoices are required for some claims.',
  citations: [inputTaxCase.officialSources[0]],
  independentReview: independentReview('GST registration and tax invoices are required for some claims.')
}).outcome, 'PARTIAL');
assert.equal(evaluateCapturedAnswer(inputTaxCase, {
  answer: 'You are not GST registered, so you cannot claim input tax. “The purchase is for business and taxable supplies.”',
  citations: [inputTaxCase.officialSources[0]]
}).outcome, 'UNSUPPORTED', 'Quoted text and negated facts do not satisfy the positive checklist.');
assert.equal(evaluateCapturedAnswer(inputTaxCase, {
  answer: inputTaxCase.question,
  citations: [inputTaxCase.officialSources[0]]
}).outcome, 'UNSUPPORTED', 'Echoing the question is not an answer.');

const secretaryCase = fixture.cases.find(testCase => testCase.id === 'acra-secretary-appointment-03');
assert.ok(secretaryCase.officialSources.length > 1, 'the company-secretary source records both exact slash forms');
assert.equal(evaluateCapturedAnswer(secretaryCase, {
  answer: 'A sole director cannot also be the company secretary.',
  citations: [secretaryCase.officialSources[1]]
}).citationStatus, 'PASS', 'The exact trailing-slash source alias is accepted.');
const wrongSecretaryAnswer = 'A sole director can also act as the company secretary.';
const rightSecretaryAnswer = 'A sole director cannot also be the company secretary.';
assert.equal(evaluateCapturedAnswer(secretaryCase, { answer: wrongSecretaryAnswer }).checklistStatus, 'PARTIAL');
assert.equal(evaluateCapturedAnswer(secretaryCase, {
  answer: rightSecretaryAnswer,
  citations: [secretaryCase.officialSources[0]],
  independentReview: independentReview(rightSecretaryAnswer, 'CORRECT', secretaryCase)
}).outcome, 'CORRECT', 'The sole-director case does not require an unrelated appointment deadline.');

const clarificationCase = fixture.cases.find(testCase => testCase.id === 'mas-qdc-reporting-02');
const clarification = 'The answer depends on the regulated entity type and applicable reporting period; please provide those details to identify the return frequency.';
assert.equal(evaluateCapturedAnswer(clarificationCase, {
  answer: clarification,
  citations: [clarificationCase.officialSources[0]],
  independentReview: independentReview(clarification, 'CORRECT', clarificationCase)
}).outcome, 'CORRECT', 'A reviewed clarification can be correct when material facts are missing.');
assert.equal(evaluateCapturedAnswer(clarificationCase, {
  answer: 'All MAS fund managers file the same QDC every quarter.',
  citations: [clarificationCase.officialSources[0]]
}).outcome, 'UNSUPPORTED', 'An unsupported universal claim does not satisfy expected clarification checks.');
assert.equal(evaluateCapturedAnswer(inputTaxCase, undefined).outcome, 'NOT_RUN');

const historicalCase = { ...inputTaxCase, temporal: { targetDate: '2024-06-01' } };
const historicallyReviewed = {
  answer: completeInputTaxAnswer,
  citations: [{ url: inputTaxCase.officialSources[0], validFrom: '2024-01-01', validTo: '2024-12-31' }],
  independentReview: independentReview(completeInputTaxAnswer)
};
assert.equal(evaluateCapturedAnswer(historicalCase, historicallyReviewed).outcome, 'CORRECT');
assert.equal(evaluateCapturedAnswer(historicalCase, {
  ...historicallyReviewed,
  citations: [{ url: inputTaxCase.officialSources[0], validFrom: '2025-01-01', validTo: '2026-12-31' }]
}).temporalStatus, 'NOT_EVALUATED', 'A source starting after the requested date does not support it.');
assert.equal(evaluateCapturedAnswer({ ...historicalCase, temporal: { targetDate: '2024-02-30' } }, historicallyReviewed).temporalStatus, 'NOT_EVALUATED', 'Impossible calendar dates are rejected.');
assert.equal(evaluateCapturedAnswer({ ...historicalCase, temporal: { targetDate: '2018-01-01' } }, {
  ...historicallyReviewed,
  citations: [{ url: inputTaxCase.officialSources[0], validFrom: '2016-01-01', validTo: '2017-12-31' }]
}).temporalStatus, 'NOT_EVALUATED', 'Expired citations cannot support historical dates.');
assert.equal(evaluateCapturedAnswer(historicalCase, {
  ...historicallyReviewed,
  citations: [{ url: inputTaxCase.officialSources[0], validFrom: '2025-01-01', validTo: '2024-12-31' }]
}).temporalStatus, 'NOT_EVALUATED', 'Inverted source validity intervals are rejected.');

const cpfHistoricalCase = fixture.cases.find(testCase => testCase.id === 'cpf-cpf-rate-factors-02');
const wrongHistoricalYearAnswer = 'Use the 2025 rate schedule after checking citizenship, age, and wage amount.';
assert.equal(evaluateCapturedAnswer(cpfHistoricalCase, {
  answer: wrongHistoricalYearAnswer,
  citations: [{ url: cpfHistoricalCase.officialSources[0], validFrom: '2025-01-01', validTo: '2025-12-31' }],
  independentReview: independentReview(wrongHistoricalYearAnswer, 'CORRECT', cpfHistoricalCase)
}).outcome, 'PARTIAL', 'A 2025 schedule cannot satisfy the 2024 case or its date scope.');

const cpfCalculationCase = fixture.cases.find(testCase => testCase.id === 'cpf-cpf-rate-factors-04');
const safeCalculationClarification = 'I need the employee age, citizenship or permanent resident status, contribution year, and ordinary versus additional wage breakdown before calculating.';
assert.equal(evaluateCapturedAnswer(cpfCalculationCase, {
  answer: safeCalculationClarification,
  citations: [cpfCalculationCase.officialSources[0]],
  independentReview: independentReview(safeCalculationClarification, 'CORRECT', cpfCalculationCase)
}).outcome, 'CORRECT', 'A reviewed clarification with no result does not need calculation review.');
const attemptedCalculation = 'Please provide age, status, year, and wage types. CPF due is S$250.';
assert.equal(evaluateCapturedAnswer(cpfCalculationCase, {
  answer: attemptedCalculation,
  citations: [cpfCalculationCase.officialSources[0]],
  independentReview: independentReview(attemptedCalculation, 'CORRECT', cpfCalculationCase)
}).outcome, 'PARTIAL', 'A numeric result in a clarification requires independent calculation validation.');
assert.equal(evaluateCapturedAnswer(cpfCalculationCase, {
  answer: attemptedCalculation,
  citations: [cpfCalculationCase.officialSources[0]],
  independentReview: independentReview(attemptedCalculation, 'CORRECT', cpfCalculationCase),
  calculationReview: { ...independentReview(attemptedCalculation, 'CORRECT', cpfCalculationCase), answerSha256: sha256('different calculation answer') }
}).calculationStatus, 'NOT_EVALUATED', 'Calculation review is bound to the exact answer.');
const syntheticAnsweredCalculationCase = {
  ...cpfCalculationCase,
  expected: { disposition: 'ANSWER', requiredFactGroups: [{ anyOf: ['S$250'] }] }
};
const calculatedAnswer = 'The calculated CPF contribution is S$250.';
const unvalidatedCalculation = evaluateCapturedAnswer(syntheticAnsweredCalculationCase, {
  answer: calculatedAnswer,
  citations: [cpfCalculationCase.officialSources[0]],
  independentReview: independentReview(calculatedAnswer, 'CORRECT', syntheticAnsweredCalculationCase)
});
assert.equal(unvalidatedCalculation.outcome, 'PARTIAL', 'An independently reviewed explanation cannot substitute for a calculation review.');
assert.equal(unvalidatedCalculation.calculationStatus, 'NOT_EVALUATED');
assert.equal(evaluateCapturedAnswer(syntheticAnsweredCalculationCase, {
  answer: calculatedAnswer,
  citations: [cpfCalculationCase.officialSources[0]],
  independentReview: independentReview(calculatedAnswer, 'CORRECT', syntheticAnsweredCalculationCase),
  calculationReview: independentReview(calculatedAnswer, 'CORRECT', syntheticAnsweredCalculationCase)
}).outcome, 'CORRECT', 'A numeric result needs both bound answer review and bound calculation review.');
const copiedCalculationReviewCase = {
  ...syntheticAnsweredCalculationCase,
  id: 'cpf-copied-calculation-review',
  question: `${syntheticAnsweredCalculationCase.question} Check a different employee.`
};
const copiedCalculationReview = evaluateCapturedAnswer(copiedCalculationReviewCase, {
  answer: calculatedAnswer,
  citations: [cpfCalculationCase.officialSources[0]],
  independentReview: independentReview(calculatedAnswer, 'CORRECT', syntheticAnsweredCalculationCase),
  calculationReview: independentReview(calculatedAnswer, 'CORRECT', syntheticAnsweredCalculationCase)
});
assert.equal(copiedCalculationReview.independentReviewStatus, 'INVALID_OR_STALE_REVIEW');
assert.equal(copiedCalculationReview.calculationStatus, 'NOT_EVALUATED',
  'Calculation reviews also require the exact fixture ID and question hash.');

const originalTopics = QueryTopicResolver.CANONICAL_TOPICS;
const report = await runStatutoryCoverageBenchmark();
assert.equal(QueryTopicResolver.CANONICAL_TOPICS, originalTopics, 'The baseline resolver catalog is restored after the benchmark.');
assert.equal(report.liveAcceptance, 'NOT_RUN');
assert.equal(report.routing.baseline.total, 100);
assert.equal(report.routing.baseline.routed, 57,
  'A compound OW/AW question requires both topics: the baseline routes 57 complete questions, not 58 primary topics.');
assert.equal(report.routing.baseline.byAuthority.CPF.routed, 8);
assert.equal(report.routing.current.total, 100);
assert.equal(report.routing.current.byAuthority.MAS.total, 20);
assert.equal(report.answerOutcomes.NOT_RUN, 100, 'Missing real answers remain NOT_RUN rather than inheriting routing success.');
assert.equal(report.evaluatorLimit.includes('CORRECT requires an answer-, case-, and question-bound independent review'), true);

const oneRecordedAnswer = await runStatutoryCoverageBenchmark({ answers: { cases: [{
  id: inputTaxCase.id,
  question: inputTaxCase.question,
  answer: completeInputTaxAnswer,
  citations: [inputTaxCase.officialSources[0]],
  evidence: [{ url: inputTaxCase.officialSources[0], quote: 'Independently captured page text.' }]
}] } });
assert.equal(oneRecordedAnswer.answerOutcomes.PARTIAL, 1, 'An answer without independent adjudication remains partial.');
assert.equal(oneRecordedAnswer.answerOutcomes.NOT_RUN, 99);
assert.equal(oneRecordedAnswer.cases.find(item => item.id === inputTaxCase.id).capturedEvidence.evidence[0].quote, 'Independently captured page text.');

const offlineReplay = JSON.parse(await readFile(new URL('../evaluation/statutory_coverage_offline_replay_2026-10-25.json', import.meta.url), 'utf8'));
assert.equal(offlineReplay.liveAcceptance, 'NOT_RUN');
assert.equal(offlineReplay.networkRequests, 0);
const masReplay = await runStatutoryCoverageBenchmark({ answers: offlineReplay });
const replayResult = masReplay.cases.find(item => item.id === 'mas-fund-management-licence-01');
assert.equal(replayResult.answer.outcome, 'PARTIAL', 'The MAS replay lacks independent adjudication and live acceptance.');
assert.equal(replayResult.capturedEvidence.evidence.length, 2);
assert.equal(masReplay.answerOutcomes.NOT_RUN, 99);

await assert.rejects(() => runStatutoryCoverageBenchmark({ answers: { cases: [{
  id: inputTaxCase.id, question: 'A different query', answer: 'text'
}] } }), /does not match fixture/);
await assert.rejects(() => runStatutoryCoverageBenchmark({ answers: { cases: [
  { id: inputTaxCase.id, question: inputTaxCase.question, answer: 'first' },
  { id: inputTaxCase.id, question: inputTaxCase.question, answer: 'second' }
] } }), /Duplicate benchmark answer ID/);
await assert.rejects(() => runStatutoryCoverageBenchmark({ answers: { cases: [{ id: 'unknown-id', question: 'q', answer: 'a' }] } }), /Unknown benchmark answer ID/);

console.log('Statutory coverage benchmark fixture and answer-evaluation contracts passed.');
