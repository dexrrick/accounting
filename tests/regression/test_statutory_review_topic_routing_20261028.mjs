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

const masDirectorNotifications = 'At our LFMC, an existing director\'s residential address changes and the CEO resigns during the same week. Do both notifications have the same fourteen-day outer limit, and is changing the director\'s particulars treated as a fresh Form 11 appointment approval?';
const masDirectorTopicIds = classifyQuestion(masDirectorNotifications).topicIds;
const masDirectorResolverTopicIds = defaultQueryTopicResolver.decomposeQuery(masDirectorNotifications).topics.map(topic => topic.id);
assert.ok(masDirectorTopicIds.includes('mas-lfmc-key-appointments'));
assert.ok(!masDirectorTopicIds.includes('acra-entity-information-changes'),
  'An LFMC director address update without ACRA or company-entity scope stays with MAS.');
assert.ok(!masDirectorResolverTopicIds.includes('acra-entity-information-changes'),
  'The ACRA entity query pattern does not claim an LFMC-only director address change.');

const explicitAcraEntityUpdate = 'Our Singapore company changed its financial year end after missing the filing deadline. What ACRA approval applies?';
assert.ok(classifyQuestion(explicitAcraEntityUpdate).topicIds.includes('acra-entity-information-changes'),
  'A company-scoped FYE change retains ACRA entity-change routing.');
assert.ok(defaultQueryTopicResolver.decomposeQuery(explicitAcraEntityUpdate).topics
  .some(topic => topic.id === 'acra-entity-information-changes'),
'Official FYE aliases remain discoverable when a company is explicitly in scope.');

const inferredCompanyFyeChange = 'Our FYE is 31 December and the AGM deadline has passed. Can we change FYE now to gain time before the annual return is filed?';
assert.ok(classifyQuestion(inferredCompanyFyeChange).topicIds.includes('acra-entity-information-changes'),
  'An FYE change tied to AGM and annual-return compliance establishes bounded company scope.');
assert.ok(defaultQueryTopicResolver.decomposeQuery(inferredCompanyFyeChange).topics
  .some(topic => topic.id === 'acra-entity-information-changes'),
'The bounded FYE-change scenario resolves to the existing ACRA entity-change family.');

const masFundForm25aQuery = 'At our VCFM, the fund financial year end is 31 December. When is Form 25A due?';
for (const topicIds of [classifyQuestion(masFundForm25aQuery).topicIds,
  defaultQueryTopicResolver.decomposeQuery(masFundForm25aQuery).topics.map(topic => topic.id)]) {
  assert.ok(topicIds.includes('mas-regulatory-reporting'), 'A fund Form 25A deadline remains within MAS reporting scope.');
  assert.ok(!topicIds.includes('acra-entity-information-changes'),
    'A generic fund FYE and Form 25A request does not imply a company FYE change.');
}

const annualReturnDeadlineWithFye = 'For a Singapore private company with a 31 December financial year end, what is the general annual-return filing deadline in months after financial year end? Explain the rule only; do not prepare a journal.';
for (const topicIds of [classifyQuestion(annualReturnDeadlineWithFye).topicIds,
  defaultQueryTopicResolver.decomposeQuery(annualReturnDeadlineWithFye).topics.map(topic => topic.id)]) {
  assert.ok(topicIds.includes('acra_annual-returns'), 'An annual-return deadline remains mapped for a company with a stated FYE.');
  assert.ok(!topicIds.includes('acra-entity-information-changes'),
    'A stated financial year end and filing deadline alone do not imply an entity update.');
}

const explicitAcraEntityRequestBesideMas = `${masDirectorNotifications} Separately, our foreign company registered in Singapore changed its entity email. What ACRA notification deadline applies?`;
assert.ok(classifyQuestion(explicitAcraEntityRequestBesideMas).topicIds.includes('acra-entity-information-changes'),
  'An independent explicit ACRA entity-update request remains mapped beside the MAS question.');
assert.ok(defaultQueryTopicResolver.decomposeQuery(explicitAcraEntityRequestBesideMas).topics
  .some(topic => topic.id === 'acra-entity-information-changes'),
'Explicit ACRA entity-update aliases remain discoverable in a mixed-authority query.');

const auditThresholdPeriodQuestion = 'Do the audit exemption thresholds have to be met for one year or two?';
const auditThresholdPeriodPlan = reconcileQuestionUnderstanding(auditThresholdPeriodQuestion,
  classifyQuestion(auditThresholdPeriodQuestion), { mode: 'DETERMINISTIC_FALLBACK', failure: 'NO_PROVIDER' }).issuePlan;
assert.ok(auditThresholdPeriodPlan.issues.some(issue => issue.operation === 'EXPLAIN_RULE' &&
  issue.mappedTopicIds.includes('acra_small_company')),
  'A question about the audit thresholds period reaches the existing small-company rule.');
const separateAuditorDutyQuestion = `${auditThresholdPeriodQuestion} Separately, what are the statutory audit requirements?`;
const separateAuditorDutyPlan = reconcileQuestionUnderstanding(separateAuditorDutyQuestion,
  classifyQuestion(separateAuditorDutyQuestion), { mode: 'DETERMINISTIC_FALLBACK', failure: 'NO_PROVIDER' }).issuePlan;
assert.ok(separateAuditorDutyPlan.issues.some(issue => issue.mappedTopicIds.includes('acra_audit-requirements')),
  'A separate audit-requirements request is not demoted by the threshold-period alias.');

console.log('Statutory paraphrase topic-routing regressions passed.');
