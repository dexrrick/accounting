import assert from 'node:assert/strict';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { defaultQueryTopicResolver } from '../../src/retrieval/queryTopicResolver.ts';
import { reconcileQuestionUnderstanding } from '../../src/services/semanticQuestionUnderstanding.ts';

const cases = [
  ['cpf_contribution_rates', 'What are the employer and employee CPF percentages in 2026 for a Singapore citizen aged over 60 to 65 earning more than S$750 per month?'],
  ['cpf_contribution_rates', 'Does the employee CPF percentage fall on the exact date of a 60th birthday, or in the following month?'],
  ['cpf-pr-contribution-rates', 'A worker became a permanent resident on 18 May 2025. When does the second PR contribution year begin?'],
  ['mom-salary-payment', 'What general salary-payment rule applies when the employer dismisses an employee, rather than the employee resigning?'],
  ['mom-public-holidays', 'Do public holidays always entitle every employee to a day off with pay even after an unauthorised absence immediately before the holiday?'],
  ['mom-public-holidays', 'For a five-day-week Employment Act employee, what is the difference if a public holiday falls on the non-working Saturday rather than the rest-day Sunday?'],
  ['mom-public-holidays', 'An Employment Act employee has Tuesday as a non-working day and Wednesday as the contractual rest day. What is the public-holiday entitlement if the holiday falls on Tuesday rather than Wednesday?'],
  ['mas-regulatory-reporting', 'Does MAS’s LFMC compliance toolkit cover every return owed by the investment funds a licensed manager manages?'],
  ['acra-annual-return-officer-particulars', 'Does the October 2026 annual-return change ask whether somebody actually performs the CEO role?'],
  ['acra-annual-return-officer-particulars', 'Our return was filed on 19 October 2026. Did the officer-confirmation change that commenced on 20 October already govern that filing?']
];

for (const [topicId, question] of cases) {
  const classified = classifyQuestion(question);
  assert.ok(classified.topicIds.includes(topicId), `${topicId} should be classified: ${question}`);
  assert.ok(defaultQueryTopicResolver.decomposeQuery(question).topics.some(topic => topic.id === topicId),
    `${topicId} should be independently found by the topic resolver: ${question}`);
}

const holidayComparison = 'An Employment Act employee has Tuesday as a non-working day and Wednesday as the contractual rest day. What is the public-holiday entitlement if the holiday falls on Tuesday rather than Wednesday?';
const holidayPlan = reconcileQuestionUnderstanding(holidayComparison, classifyQuestion(holidayComparison),
  { mode: 'DETERMINISTIC_FALLBACK', failure: 'NO_PROVIDER' }).issuePlan;
assert.ok(holidayPlan.issues.some(issue => issue.mappedTopicIds.includes('mom-public-holidays')),
  'The holiday-versus-nonworking-day comparison retains its public-holiday issue.');
assert.ok(holidayPlan.issues.some(issue => issue.contextualTopicIds?.includes('mom-rest-days')),
  'The rest-day mention is contextual unless the employee asks about work or pay on a rest day.');
assert.ok(!holidayPlan.issues.some(issue => issue.mappedTopicIds.includes('mom-rest-days')),
  'A comparison does not request a separate rest-day work rule.');

for (const question of [
  'Does a CEO birthday affect corporate tax residency?',
  'Can an employee swap a rest day without a public holiday?',
  'Do investment funds calculate net asset value each month?'
]) {
  const ids = classifyQuestion(question).topicIds;
  assert.ok(!ids.includes('acra-annual-return-officer-particulars'), `Unrelated CEO question should not route to ACRA: ${question}`);
  assert.ok(!ids.includes('mom-public-holidays'), `Unrelated rest-day question should not route to holiday rules: ${question}`);
  assert.ok(!ids.includes('mas-regulatory-reporting'), `Unrelated fund question should not route to reporting: ${question}`);
}

console.log('Statutory paraphrase topic-routing regressions passed.');
