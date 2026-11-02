import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { loadStatutoryKnowledgeSources } from '../../scripts/load_statutory_knowledge_sources.mjs';
import { OFFICIAL_SOURCE_DISCOVERY_PROVIDERS } from '../../src/retrieval/officialSitemapDiscovery.ts';
import { supportCpfPayrollKnowledgeRule } from '../../src/retrieval/cpfPayrollKnowledge20261027b.ts';
import { defaultTargetDateResolver } from '../../src/retrieval/targetDateResolver.ts';

const sources = new Map();
for (const directory of [
  'tests/fixtures/statutoryKnowledge20261027b',
  'tests/fixtures/statutoryKnowledge20261030',
  'tests/fixtures/statutoryWorkflows20261029',
  'tests/fixtures/statutoryKnowledge20261031',
  'tests/fixtures/statutoryCpf20261101'
]) {
  for (const page of await loadStatutoryKnowledgeSources(directory)) {
    sources.set(page.sourceUrl, { authority: page.authority, body: page.body, type: page.contentType, title: page.title });
  }
}
const wageText = await readFile('tests/fixtures/statutoryExpansionSources/cpf-wage-classification.txt', 'utf8');
const wageUrl = 'https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions';
sources.set(wageUrl, {
  authority: 'CPF',
  title: 'What constitutes wages for CPF contributions',
  body: `<html><head><title>CPF | What constitutes wages for CPF contributions</title></head><body><main><h1>CPF | What constitutes wages for CPF contributions</h1><p>${wageText.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('\n', '<br>')}</p></main></body></html>`,
  type: 'text/html'
});

globalThis.fetch = async input => {
  const url = typeof input?.url === 'string' ? input.url : String(input);
  const page = sources.get(url);
  if (page) return new Response(page.body, { headers: { 'content-type': page.type } });
  const provider = Object.values(OFFICIAL_SOURCE_DISCOVERY_PROVIDERS).find(candidate => candidate.sitemapUrls?.includes(url));
  if (provider) {
    const links = [...sources].filter(([, source]) => source.authority === provider.authority)
      .map(([sourceUrl]) => `<url><loc>${sourceUrl.replaceAll('&', '&amp;')}</loc></url>`).join('');
    return new Response(`<urlset>${links}</urlset>`, { headers: { 'content-type': 'application/xml' } });
  }
  return new Response('Unavailable in frozen fixture set', { status: 404 });
};

const scenarios = [
  {
    id: 'cpf01',
    query: 'A monthly salary is earned in March but, under our payroll terms, is payable on 20 April. Is it March Ordinary Wages under CPF?',
    expected: ['not March OW', 'classified as AW for that month', 'AW may still attract CPF']
  },
  {
    id: 'cpf04',
    query: 'An annual bonus for 2025 was contractually due and payable in January 2026, though payroll had budgeted it for last year. Which year’s AW ceiling applies?',
    expected: ['2026 AW ceiling applies', 'S$102,000', 'due-and-payable year controls']
  },
  {
    id: 'cpf06',
    query: 'A foreign employee became a Singapore PR on 15 March 2026. What is the first-year boundary, and is CPF due on March OW earned from the grant date?',
    expected: ['first-year boundary ends 31/03/2027', 'second-year rates begin 01/04/2027', 'pro-rated portion from 15/03/2026 through 31/03/2026', 'No contribution amount is inferred']
  },
  {
    id: 'cpf07',
    query: 'The same new PR employee received an annual bonus payable on 10 March, before obtaining PR, and another bonus payable on 20 March, after obtaining PR. Which bonus can attract CPF?',
    expected: ['AW payable before SPR status is not subject to CPF', 'AW payable on or after status is obtained may attract CPF', 'remaining annual AW ceiling']
  },
  {
    id: 'fresh31-cpf-01',
    query: 'For CPF wage classification, employee A’s September pay is contractually payable on 10 October, while employee B’s September pay is contractually payable on 20 October. Are both Ordinary Wages merely because both relate to September employment?',
    expected: ['Employee A', 'meets the payment-date condition for September OW', 'Employee B', 'is AW for that month', "that employee's own employment month and payable date"]
  },
  {
    id: 'fresh31-cpf-02',
    query: 'In October 2026, one employee has S$8,700 of Ordinary Wages and a separate annual bonus. Is the CPF-able monthly OW base S$8,700, and does capping OW also prove that none of the bonus attracts CPF?',
    expected: ['S$8,700 of OW is capped at S$8,000', 'AW has its own annual ceiling of S$102,000', 'depends on the remaining ceiling']
  },
  {
    id: 'earlier60-cpf-pr-year',
    query: 'An employee obtained SPR status on 7 August 2025. Is the move into the second CPF contribution year on 7 August 2026, or at the start of September?',
    expected: ['second-year rates apply from 01/09/2026 through 31/08/2027', 'This calculates the PR-year timing only']
  },
  {
    id: 'fresh31-cpf-03',
    query: 'Employee A turns 60 on 31 October 2026. Employee B turns 60 on 1 November 2026. Do both move to the next CPF age band for November payroll? Please explain the timing without guessing either employee’s citizenship or contribution rate.',
    expected: ['New age-group rates start on the first day of the month after', 'CPF contribution rates by age group']
  },
  {
    id: 'cpf-same-month-payable-date',
    query: 'A monthly salary is earned in September and is contractually payable on 30 September. Is it September Ordinary Wages under CPF?',
    expected: ['payable on 30 September', 'meet both conditions for September OW']
  },
  {
    id: 'cpf-missing-employee-payable-date',
    query: 'Employee A’s September pay is contractually payable on 10 October. Employee B’s September pay date is unconfirmed. Are both Ordinary Wages under CPF?',
    expected: ['missing or ambiguous', 'do not borrow another employee’s date']
  },
  {
    id: 'cpf-alternate-pr-conversion-month',
    query: 'A foreign employee became a Singapore PR on 20 May 2026. Is CPF due on May OW earned from the grant date?',
    expected: ['first-year boundary ends 31/05/2027', 'second-year rates begin 01/06/2027', 'pro-rated portion from 20/05/2026 through 31/05/2026']
  },
  {
    id: 'cpf-bonus-amount-not-ow',
    query: 'In October 2026, one employee has a separate annual bonus of S$20,000 and Ordinary Wages of S$5,000. Is the CPF-able monthly OW base S$5,000, and does capping OW prove none of the bonus attracts CPF?',
    expected: ['stated monthly OW base is S$5,000', 'AW has its own annual ceiling of S$102,000']
  },
  {
    id: 'cpf-performance-year-not-hardcoded',
    query: 'An annual bonus for 2024 was contractually due and payable in January 2026. Which year’s AW ceiling applies?',
    expected: ['2026 AW ceiling applies', 'bonus relates to the stated 2024 performance year']
  },
  {
    id: 'cpf-pr-date-not-borrowed-across-employees',
    query: 'Employee A became a Singapore PR on 15 March 2026. Employee B remains a foreigner. Is CPF due on B’s March Ordinary Wages and what is B’s first-year boundary?',
    expected: ['date stated for one employee cannot establish another employee’s first-year boundary', 'while that employee remains a foreigner', 'employee’s own Entry Permit date is needed']
  },
  {
    id: 'cpf-pr-date-not-borrowed-across-staff-labels',
    query: 'Employee A became a Singapore PR on 15 March 2026. Staff B remains a foreigner. Is CPF due on B’s March Ordinary Wages and what is B’s first-year boundary?',
    expected: ['date stated for one employee cannot establish another employee’s first-year boundary', 'while that employee remains a foreigner', 'employee’s own Entry Permit date is needed']
  },
  {
    id: 'cpf-pr-date-not-borrowed-across-worker-labels',
    query: 'Worker A became a Singapore PR on 15 March 2026. Employee B remains a foreigner. Is CPF due on B’s March Ordinary Wages and what is B’s first-year boundary?',
    expected: ['date stated for one employee cannot establish another employee’s first-year boundary', 'while that employee remains a foreigner', 'employee’s own Entry Permit date is needed']
  },
  {
    id: 'cpf-pr-2027-boundary-from-2026-grant',
    query: 'An employee obtained PR on 15 March 2026. Does the first contribution year end on 31 March 2027?',
    expected: ['first-year rates apply from that date through 31/03/2027', 'second-year rates apply from 01/04/2027']
  },
  {
    id: 'cpf-pr-2028-boundary-from-2026-grant',
    query: 'An employee obtained PR on 15 March 2026. Does the second contribution year end on 31 March 2028?',
    expected: ['second-year rates apply from 01/04/2027 through 31/03/2028', 'third-year rates start 01/04/2028']
  }
];

const results = [];
for (const scenario of scenarios) {
  let workstreams;
  const response = await processAccountingQuery(scenario.query, null, 'IFRS', undefined, undefined, [], undefined, {
    onAuthorityWorkstreams: value => { workstreams = value; }
  });
  const issue = workstreams?.workstreams?.flatMap(stream => stream.issues)[0];
  assert.ok(issue, `${scenario.id}: CPF issue is planned`);
  assert.equal(issue.evidenceStatus, 'VERIFIED', `${scenario.id}: authoritative CPF evidence verifies`);
  for (const phrase of scenario.expected) assert.ok(response.messageText.includes(phrase), `${scenario.id}: answer includes ${phrase}`);
  assert.equal(response.scenarioState.scenarioType, 'AUTHORITY_ADVISORY', `${scenario.id}: no accounting journal is produced`);
  assert.equal(response.scenarioState.directGroups?.length || 0, 0, `${scenario.id}: no fabricated journal groups`);
  results.push({ scenario, issue, response });
}

const newPrSource = sources.get('https://www.cpf.gov.sg/service/article/do-i-need-to-pay-cpf-contributions-for-my-foreign-employee-who-has-recently-obtained-singapore-permanent-residence-status');
assert.ok(newPrSource, 'retained official new-PR excerpt is available');
const sourceText = newPrSource.body.toString();
const statelessPrAnswer = results.find(result => result.scenario.id === 'cpf07').response.messageText;
assert.match(statelessPrAnswer, /status-grant date/i, 'without a grant date, explain the boundary conditionally');
assert.doesNotMatch(statelessPrAnswer, /\b(?:31\/03\/20\d{2}|01\/04\/20\d{2})\b/, 'do not invent an anniversary date for the stateless new-PR case');
const oldPrYearWorkstream = results.find(result => result.scenario.id === 'earlier60-cpf-pr-year')
  .response.messageText;
assert.doesNotMatch(oldPrYearWorkstream, /newly obtained PR status and OW\/AW payable-date treatment/i,
  'a pure PR-year boundary request stays with the established PR-year source rule');
assert.doesNotMatch(results.find(result => result.scenario.id === 'earlier60-cpf-pr-year').issue.subject,
  /OW\/AW payable-date treatment/i, 'a pure PR-year boundary request is not classified as a new-PR wage application');
const ambiguousPayDateAnswer = results.find(result => result.scenario.id === 'cpf-missing-employee-payable-date')
  .response.messageText;
assert.doesNotMatch(ambiguousPayDateAnswer, /Employee B[^\n]{0,100}(?:OW|AW)/i,
  'a known date for employee A does not determine employee B’s classification');
const bonusAmountAnswer = results.find(result => result.scenario.id === 'cpf-bonus-amount-not-ow')
  .response.messageText;
assert.doesNotMatch(bonusAmountAnswer, /S\$20,000 of OW is capped/i,
  'the bonus amount cannot be misidentified as Ordinary Wages');
const historicalRequest = {
  authority: 'CPF', topicId: 'cpf-pr-contribution-rates',
  query: 'A foreign employee obtained Singapore PR status on 15 March 2018. What CPF wage rules applied then?',
  subject: 'CPF newly obtained PR status and OW/AW payable-date treatment',
  sourceText,
  officialUrl: 'https://www.cpf.gov.sg/service/article/do-i-need-to-pay-cpf-contributions-for-my-foreign-employee-who-has-recently-obtained-singapore-permanent-residence-status'
};
assert.equal(supportCpfPayrollKnowledgeRule(historicalRequest), false, 'a current 2026 excerpt cannot prove the 2018 rule');
assert.notEqual(supportCpfPayrollKnowledgeRule({ ...historicalRequest, query: scenarios[2].query, officialUrl: wageUrl }), true,
  'a mismatched source URL cannot admit the new-PR rule');
const contradictoryPrSource = sourceText.replace(
  /CPF contribution is not required on the AW if it is payable while the employee was a foreigner/i,
  'CPF contribution is required on the AW if it is payable while the employee was a foreigner'
);
assert.equal(supportCpfPayrollKnowledgeRule({ ...historicalRequest, query: scenarios[3].query, sourceText: contradictoryPrSource }), false,
  'a source excerpt that reverses the before-grant AW rule cannot verify');
assert.notEqual(defaultTargetDateResolver.resolveAuthorityEvidenceDate(
  'Which income tax rate applies to an annual bonus due and payable in January 2026?'
).dateRole, 'CURRENT_WORKFLOW_FACT', 'a current payable date does not make an unrelated tax-rate request current CPF scope');
assert.notEqual(defaultTargetDateResolver.resolveAuthorityEvidenceDate(
  'For a 2025 bonus due and payable in January 2026, which AW ceiling applies and what CPF contribution rate applies?'
).dateRole, 'CURRENT_WORKFLOW_FACT', 'a current payable date does not suppress a separate CPF rate question');

const multiEmployeeOwQuery = 'In October 2026, employee A has S$3,000 of Ordinary Wages and an annual bonus. Employee B has S$9,000 of Ordinary Wages and an annual bonus. Which employee hits the CPF OW ceiling?';
const multiEmployeeOwResponse = await processAccountingQuery(multiEmployeeOwQuery, null, 'IFRS');
assert.doesNotMatch(multiEmployeeOwResponse.messageText, /stated monthly OW base is S\$3,000/i,
  'the exact multi-employee application question does not assign employee A’s OW conclusion to employee B');
assert.match(multiEmployeeOwResponse.messageText, /Evidence is incomplete|Evidence incomplete/i,
  'the current application leaves this unsupported composite unresolved instead of guessing');
const alphanumericEmployeeOwQuery = 'In October 2026, employee E1 has S$3,000 of Ordinary Wages and an annual bonus. Staff E2 has S$9,000 of Ordinary Wages and an annual bonus. Which employee hits the CPF OW ceiling?';
const alphanumericEmployeeOwResponse = await processAccountingQuery(alphanumericEmployeeOwQuery, null, 'IFRS');
assert.doesNotMatch(alphanumericEmployeeOwResponse.messageText, /stated monthly OW base is S\$3,000/i,
  'alphanumeric employee identifiers still trigger the multi-employee safeguard');

const multiMonthOwQuery = 'Employee A had S$3,000 of Ordinary Wages in March 2026 and S$9,000 of Ordinary Wages in October 2026, plus an annual bonus. What is the OW base for the monthly ceiling in each month?';
const multiMonthOwResponse = await processAccountingQuery(multiMonthOwQuery, null, 'IFRS');
assert.doesNotMatch(multiMonthOwResponse.messageText, /stated monthly OW base is S\$3,000/i,
  'the application does not select one of the same employee’s different monthly bases as a universal answer');

const directNewPrRequest = {
  authority: 'CPF', topicId: 'cpf-pr-contribution-rates',
  query: 'An employee obtained Singapore PR on 15 March 2026. Under CPF, does the first contribution year end on 31 March 2027?',
  subject: 'CPF newly obtained PR status and OW/AW payable-date treatment',
  sourceText,
  officialUrl: 'https://www.cpf.gov.sg/service/article/do-i-need-to-pay-cpf-contributions-for-my-foreign-employee-who-has-recently-obtained-singapore-permanent-residence-status'
};
assert.equal(supportCpfPayrollKnowledgeRule(directNewPrRequest), true,
  'the current official new-PR source directly supports a derived 2027 first-year boundary');
assert.equal(supportCpfPayrollKnowledgeRule({
  ...directNewPrRequest,
  query: 'An employee obtained Singapore PR on 15 March 2026. Under CPF, does the second contribution year end on 31 March 2028?'
}), true, 'the current official new-PR source directly supports the derived 2028 second-year boundary');
assert.equal(supportCpfPayrollKnowledgeRule({
  ...directNewPrRequest,
  query: 'An employee obtained Singapore PR on 15 March 2026. What contribution rates applied in 2027?'
}), false, 'a 2026 grant does not make a future payroll-rate request answerable from the retained source');
const unsupportedLaterBoundary = 'An employee obtained PR on 15 March 2026. Does the third contribution year start on 1 April 2029?';
assert.equal(supportCpfPayrollKnowledgeRule({ ...directNewPrRequest, query: unsupportedLaterBoundary }), false,
  'a derived anniversary boundary beyond the second anniversary is rejected');
assert.notEqual(defaultTargetDateResolver.resolveAuthorityEvidenceDate(unsupportedLaterBoundary).dateRole,
  'CURRENT_WORKFLOW_FACT', 'a 2029 boundary is beyond the supported 2026 grant date derivation');
const mixedFuturePayrollQuestion = 'An employee obtained PR on 15 March 2026. What CPF treatment applies to March 2027 OW and when does the first contribution year end?';
assert.equal(supportCpfPayrollKnowledgeRule({ ...directNewPrRequest, query: mixedFuturePayrollQuestion }), false,
  'a derived 2027 anniversary boundary does not admit a separate 2027 payroll-period question');
assert.notEqual(defaultTargetDateResolver.resolveAuthorityEvidenceDate(mixedFuturePayrollQuestion).dateRole,
  'CURRENT_WORKFLOW_FACT', 'future 2027 wages do not become current workflow facts merely because a PR boundary is also requested');
const unrelatedYearfulWageBoundaryQuery = 'A foreign employee obtained Singapore PR on 15 March 2026. His March 2026 Ordinary Wages were due and payable the following day. The first contribution year ends on 31 March 2027. When does the first contribution year end?';
assert.equal(supportCpfPayrollKnowledgeRule({ ...directNewPrRequest, query: unrelatedYearfulWageBoundaryQuery }), true,
  'a relative date on a separate, yearful 2026 wage fact does not consume the 2027 boundary-only exception');
assert.equal(defaultTargetDateResolver.resolveAuthorityEvidenceDate(unrelatedYearfulWageBoundaryQuery).dateRole,
  'CURRENT_WORKFLOW_FACT', 'a yearful wage fact does not attach its relative date to the independent anniversary boundary');
const reviewerFuturePayrollQuestion = 'An employee obtained PR on 15 March 2026. For March 2027, does the employer have to contribute CPF on the employee’s Ordinary Wages, and when does the first contribution year end?';
assert.equal(supportCpfPayrollKnowledgeRule({ ...directNewPrRequest, query: reviewerFuturePayrollQuestion }), false,
  'a future payroll clause cannot borrow boundary language from a later clause');
assert.notEqual(defaultTargetDateResolver.resolveAuthorityEvidenceDate(reviewerFuturePayrollQuestion).dateRole,
  'CURRENT_WORKFLOW_FACT', 'the future OW clause is not treated as a derived anniversary date');
assert.equal(defaultTargetDateResolver.resolveAuthorityEvidenceDate(directNewPrRequest.query).dateRole,
  'CURRENT_WORKFLOW_FACT', 'the 2027 date derived from a 2026 PR grant remains a current employee fact');
const currentWageAndDerivedBoundaryQuestion = 'An employee obtained PR on 15 March 2026. Is CPF due on March 2026 OW, and does the first contribution year end on 31 March 2027?';
assert.equal(supportCpfPayrollKnowledgeRule({ ...directNewPrRequest, query: currentWageAndDerivedBoundaryQuestion }), true,
  'current 2026 OW questions remain answerable when a derived 2027 anniversary boundary is also requested');
assert.equal(defaultTargetDateResolver.resolveAuthorityEvidenceDate(currentWageAndDerivedBoundaryQuestion).dateRole,
  'CURRENT_WORKFLOW_FACT', 'the current 2026 OW period stays in scope with a derived 2027 boundary');
const currentWageQuestionBeforeBoundary = 'An employee obtained PR on 15 March 2026. Is CPF due on March OW, and does the first contribution year end on 31 March 2027?';
assert.equal(supportCpfPayrollKnowledgeRule({ ...directNewPrRequest, query: currentWageQuestionBeforeBoundary }), true,
  'an independent current wage question before a derived boundary keeps its established source support');
assert.equal(defaultTargetDateResolver.resolveAuthorityEvidenceDate(currentWageQuestionBeforeBoundary).dateRole,
  'CURRENT_WORKFLOW_FACT', 'the current wage question is not mistaken for payroll attached to the later boundary date');

const closerCurrentPayrollDateBeforeRelativeBonus = 'A foreign employee became a Singapore PR on 15 March 2026. The first contribution year ends on 31 March 2027. His March wages became payable on 20 March this year. His bonus becomes payable the following day. Does the bonus attract CPF?';
assert.equal(supportCpfPayrollKnowledgeRule({ ...directNewPrRequest, query: closerCurrentPayrollDateBeforeRelativeBonus }), true,
  'a closer dated current payroll fact prevents the bonus from borrowing the 2027 boundary');
assert.equal(defaultTargetDateResolver.resolveAuthorityEvidenceDate(closerCurrentPayrollDateBeforeRelativeBonus).dateRole,
  'CURRENT_WORKFLOW_FACT', 'the nearer 20 March this year payroll fact takes precedence over the 2027 boundary');
let closerCurrentPayrollDateWorkstreams;
const closerCurrentPayrollDateResponse = await processAccountingQuery(closerCurrentPayrollDateBeforeRelativeBonus, null, 'IFRS', undefined, undefined, [], undefined, {
  onAuthorityWorkstreams: value => { closerCurrentPayrollDateWorkstreams = value; }
});
const closerCurrentPayrollDateIssues = closerCurrentPayrollDateWorkstreams?.workstreams?.flatMap(stream => stream.issues) || [];
assert.ok(closerCurrentPayrollDateIssues.some(issue => issue.domain === 'CPF_PAYROLL'),
  'the current payroll date retains the application CPF issue');
assert.doesNotMatch(closerCurrentPayrollDateResponse.messageText, /Applicability limitation:[^\n]*2027/i,
  'the application does not apply the 2027 limitation to a bonus payable the day after 20 March this year');

const futureBonusPayableClause = 'A foreign employee became a Singapore PR on 15 March 2026. The first year ends on 31 March 2027, when his bonus becomes payable. Does the bonus attract CPF?';
assert.equal(supportCpfPayrollKnowledgeRule({ ...directNewPrRequest, query: futureBonusPayableClause }), false,
  'a future payable bonus clause attached to an anniversary date remains outside the source scope');
assert.notEqual(defaultTargetDateResolver.resolveAuthorityEvidenceDate(futureBonusPayableClause).dateRole,
  'CURRENT_WORKFLOW_FACT', 'a date attached to a future payable bonus is not admitted as only a derived boundary');
const coordinatedFutureBonusPayableClause = 'A foreign employee became a Singapore PR on 15 March 2026. The first year ends on 31 March 2027, and his bonus becomes payable then. Does the bonus attract CPF?';
assert.equal(supportCpfPayrollKnowledgeRule({ ...directNewPrRequest, query: coordinatedFutureBonusPayableClause }), false,
  'a coordinated payroll clause remains attached to the non-current boundary date');
const sharedDatePayrollQueries = [
  'An employee became a Singapore PR on 15 March 2026. The first year ends on 31 March 2027, and we pay him a bonus then. Does the bonus attract CPF?',
  'An employee became a Singapore PR on 15 March 2026. The first year ends on 31 March 2027. His bonus becomes payable then. Does the bonus attract CPF?',
  'A foreign employee became a Singapore PR on 15 March 2026. His bonus becomes payable, when the first contribution year ends on 31 March 2027. Does the bonus attract CPF?',
  'A foreign employee became a Singapore PR on 15 March 2026. His bonus becomes payable then, when the first contribution year ends on 31 March 2027. Does the bonus attract CPF?'
];
for (const query of sharedDatePayrollQueries) {
  assert.equal(supportCpfPayrollKnowledgeRule({ ...directNewPrRequest, query }), false,
    'a payroll clause that shares the non-current date is not admitted as boundary-only support');
  assert.notEqual(defaultTargetDateResolver.resolveAuthorityEvidenceDate(query).dateRole, 'CURRENT_WORKFLOW_FACT',
    'a shared-date payroll clause does not become a current workflow fact');
  let workstreams;
  const response = await processAccountingQuery(query, null, 'IFRS', undefined, undefined, [], undefined, {
    onAuthorityWorkstreams: value => { workstreams = value; }
  });
  const issues = workstreams?.workstreams?.flatMap(stream => stream.issues) || [];
  assert.ok(issues.some(issue => issue.domain === 'CPF_PAYROLL' && issue.evidenceStatus !== 'VERIFIED'),
    'the application does not verify the future bonus from a boundary-only source');
  assert.match(response.messageText, /Applicability limitation:[^\n]*2027/i,
    'the application preserves the future-year limitation for a bonus sharing the boundary date');
}
const separateSentenceWageAndBoundary = 'An employee obtained PR on 15 March 2026. His October 2026 wages were paid as usual. Does the first contribution year end on 31 March 2027?';
assert.equal(supportCpfPayrollKnowledgeRule({ ...directNewPrRequest, query: separateSentenceWageAndBoundary }), true,
  'a current payroll fact in an earlier sentence does not invalidate an independent derived boundary');
let futureBonusWorkstreams;
const futureBonusResponse = await processAccountingQuery(futureBonusPayableClause, null, 'IFRS', undefined, undefined, [], undefined, {
  onAuthorityWorkstreams: value => { futureBonusWorkstreams = value; }
});
const futureBonusIssues = futureBonusWorkstreams?.workstreams?.flatMap(stream => stream.issues) || [];
assert.ok(futureBonusIssues.some(issue => issue.domain === 'CPF_PAYROLL' && issue.evidenceStatus !== 'VERIFIED'),
  'the actual application does not mark the future bonus question verified from the boundary-only source');
assert.match(futureBonusResponse.messageText, /Applicability limitation:[^\n]*2027/i,
  'the application keeps the future-period applicability limitation');

const relativeFutureBonusPayableQueries = [
  'A foreign employee became a Singapore PR on 15 March 2026. The first contribution year ends on 31 March 2027, which marks that anniversary, and his bonus becomes payable two days later. Does the bonus attract CPF?',
  'A foreign employee became a Singapore PR on 15 March 2026. The first contribution year ends on 31 March 2027. His bonus becomes payable the following day. Does the bonus attract CPF?',
  'A foreign employee became a Singapore PR on 15 March 2026. The first contribution year ends on 31 March 2027. His bonus becomes payable one day later. Does the bonus attract CPF?',
  'A foreign employee became a Singapore PR on 15 March 2026. The first contribution year ends on 31 March 2027. His bonus becomes payable the following month. Does the bonus attract CPF?',
  'A foreign employee became a Singapore PR on 15 March 2026. The first contribution year ends on 31 March 2027. His bonus is due and payable the following day. Does the bonus attract CPF?',
  'A foreign employee became a Singapore PR on 15 March 2026. The first contribution year ends on 31 March 2027. The next day, his bonus becomes payable. Does the bonus attract CPF?',
  'A foreign employee became a Singapore PR on 15 March 2026. The first contribution year ends on 31 March 2027. His bonus becomes payable two days later. Does the bonus attract CPF?',
  'A foreign employee became a Singapore PR on 15 March 2026. The first contribution year ends on 31 March 2027. The payroll administrator checks the schedule. His bonus becomes payable three business days later. Does the bonus attract CPF?',
  'A foreign employee became a Singapore PR on 15 March 2026. The first contribution year ends on 31 March 2027. The employer uses a weekly payroll. His bonus becomes payable a week later. Does the bonus attract CPF?',
  'A foreign employee became a Singapore PR on 15 March 2026. The first contribution year ends on 31 March 2027. His bonus becomes payable two business days after that. Does the bonus attract CPF?',
  'A foreign employee became a Singapore PR on 15 March 2026. The first contribution year ends on 31 March 2027. His bonus becomes payable a week after that. Does the bonus attract CPF?',
  'A foreign employee became a Singapore PR on 15 March 2026. The first contribution year ends on 31 March 2027. The payroll team checks the schedule. The finance team reviews the calendar. The manager confirms the employee list. His bonus becomes payable two days afterwards. Does the bonus attract CPF?',
  'A foreign employee became a Singapore PR on 15 March 2026. The first contribution year ends on 31 March 2027. The employer held a meeting on 20 March 2026. His bonus becomes payable the following day. Does the bonus attract CPF?',
  'A foreign employee became a Singapore PR on 15 March 2026. The first contribution year ends on 31 March 2027. His bonus becomes payable two days after the first contribution year ends. Does the bonus attract CPF?',
  'A foreign employee became a Singapore PR on 15 March 2026. The first contribution year ends on 31 March 2027. His March wages became payable on 20 March this year. His bonus becomes payable two days after the first contribution year ends. Does the bonus attract CPF?'
];
for (const query of relativeFutureBonusPayableQueries) {
  assert.equal(supportCpfPayrollKnowledgeRule({ ...directNewPrRequest, query }), false,
    `${query}: relative future payable dates cannot borrow boundary-only source support`);
  assert.notEqual(defaultTargetDateResolver.resolveAuthorityEvidenceDate(query).dateRole, 'CURRENT_WORKFLOW_FACT',
    `${query}: a relative future bonus date is not admitted as a derived boundary fact`);
  let workstreams;
  const response = await processAccountingQuery(query, null, 'IFRS', undefined, undefined, [], undefined, {
    onAuthorityWorkstreams: value => { workstreams = value; }
  });
  const issues = workstreams?.workstreams?.flatMap(stream => stream.issues) || [];
  assert.ok(issues.some(issue => issue.domain === 'CPF_PAYROLL' && issue.evidenceStatus !== 'VERIFIED'),
    `${query}: the application withholds verification for the future bonus`);
  assert.match(response.messageText, /Applicability limitation:[^\n]*2027/i,
    `${query}: the application keeps the future-period limitation`);
}

const sameSentenceCurrentPayrollAndBoundary = 'A foreign employee became a Singapore PR on 15 March 2026. His March wages were due and payable on 20 March this year, and payroll was processed the following day. The first contribution year ends on 31 March 2027. When does the first contribution year end?';
assert.equal(supportCpfPayrollKnowledgeRule({ ...directNewPrRequest, query: sameSentenceCurrentPayrollAndBoundary }), true,
  'an independently anchored current-payroll date does not invalidate a later derived boundary in the same sentence');
assert.equal(defaultTargetDateResolver.resolveAuthorityEvidenceDate(sameSentenceCurrentPayrollAndBoundary).dateRole,
  'CURRENT_WORKFLOW_FACT', 'same-sentence current payroll remains distinct from the derived boundary');

const ownerMismatchQueries = [
  'Employee A became a Singapore PR on 15 March 2026. Employee B remains a foreigner. Is CPF due on a foreigner’s March Ordinary Wages and what is the first-year boundary?',
  'Employee Alice became a Singapore PR on 15 March 2026. Employee Bob remains a foreigner. Is CPF due on Bob’s March Ordinary Wages?',
  'Employee Alice became a Singapore PR on 15 March 2026. Is CPF due on Bob\'s March Ordinary Wages?',
  'Employee Alice became a Singapore PR on 15 March 2026. Is CPF due on Bob’s March Ordinary Wages?',
  'Employee Alice became a Singapore PR on 15 March 2026. bob remains a foreigner. Is CPF due on bob\'s March Ordinary Wages?',
  'When does a foreigner’s first CPF contribution year end?'
];
for (const [index, query] of ownerMismatchQueries.entries()) {
  let workstreams;
  const response = await processAccountingQuery(query, null, 'IFRS', undefined, undefined, [], undefined, {
    onAuthorityWorkstreams: value => { workstreams = value; }
  });
  const plannedIssues = workstreams?.workstreams?.flatMap(stream => stream.issues) || [];
  assert.ok(plannedIssues.some(issue => issue.domain === 'CPF_PAYROLL'), `${query}: CPF issue remains represented`);
  assert.doesNotMatch(response.messageText, /31\/03\/2027|01\/04\/2027|15\/03\/2026|pro-rated portion from/i,
    `${query}: do not borrow an employee's date or proration for an unresolved foreigner`);
  if (index < 2 || /bob remains a foreigner/i.test(query)) assert.match(response.messageText, /CPF is not payable on the wages of an employee while that employee remains a foreigner/i,
    'the application preserves the foreigner’s no-CPF result while withholding the other employee’s personal dates');
}
const sameNaturalNameOwnerQuery = 'Employee Alice became a Singapore PR on 15 March 2026. Employee Bob remains a foreigner. Is CPF due on Alice’s March Ordinary Wages?';
const sameNaturalNameOwnerResponse = await processAccountingQuery(sameNaturalNameOwnerQuery, null, 'IFRS');
assert.match(sameNaturalNameOwnerResponse.messageText, /15\/03\/2026/,
  'a natural-language employee name retains its own stated PR date');
assert.match(sameNaturalNameOwnerResponse.messageText, /pro-rated portion from 15\/03\/2026 through 31\/03\/2026/i,
  'the matching named employee receives only their own conversion-month proration');
for (const status of ['remains a foreigner', 'is a foreigner']) {
  for (const possessive of ['Bob\'s', 'Bob’s']) {
    const bareNameOwnerMismatchQuery = `Employee Alice became a Singapore PR on 15 March 2026. Bob ${status}. Is CPF due on ${possessive} March Ordinary Wages?`;
    let workstreams;
    const response = await processAccountingQuery(bareNameOwnerMismatchQuery, null, 'IFRS', undefined, undefined, [], undefined, {
      onAuthorityWorkstreams: value => { workstreams = value; }
    });
    const issues = workstreams?.workstreams?.flatMap(stream => stream.issues) || [];
    const cpfIssue = issues.find(issue => issue.domain === 'CPF_PAYROLL');
    assert.ok(cpfIssue, `${bareNameOwnerMismatchQuery}: preserve the CPF issue`);
    assert.doesNotMatch(response.messageText, /31\/03\/2027|01\/04\/2027|15\/03\/2026|pro-rated portion from/i,
      `${possessive}: a bare-name reference to Bob does not inherit Alice’s PR date or March proration`);
    assert.match(response.messageText, /CPF is not payable on the wages of an employee while that employee remains a foreigner/i,
      `${possessive}: the bare-name mismatch retains the foreigner no-CPF treatment`);
  }
}
const lowercaseNaturalNameMismatchQueries = [
  'Employee alice became a Singapore PR on 15 March 2026. Employee bob remains a foreigner. Is CPF due on bob’s March Ordinary Wages?',
  'Employee Alice became a Singapore PR on 15 March 2026. Employee bob remains a foreigner. Is CPF due on bob’s March Ordinary Wages?',
  'Employee Alice Lee became a Singapore PR on 15 March 2026. Employee Alice Tan remains a foreigner. Is CPF due on Alice Tan’s March Ordinary Wages?',
  'Employee ALICE Lee became a Singapore PR on 15 March 2026. Employee ALICE Tan remains a foreigner. Is CPF due on ALICE Tan’s March Ordinary Wages?',
  'Employee ALICE LEE became a Singapore PR on 15 March 2026. Employee ALICE TAN remains a foreigner. Is CPF due on ALICE TAN’s March Ordinary Wages?'
];
for (const query of lowercaseNaturalNameMismatchQueries) {
  const response = await processAccountingQuery(query, null, 'IFRS');
  assert.doesNotMatch(response.messageText, /31\/03\/2027|01\/04\/2027|15\/03\/2026|pro-rated portion from/i,
    `${query}: a different employee's PR date is withheld`);
}
const lowercaseNaturalNameOwnerQuery = 'Employee alice became a Singapore PR on 15 March 2026. Employee bob remains a foreigner. Is CPF due on alice’s March Ordinary Wages?';
const lowercaseNaturalNameOwnerResponse = await processAccountingQuery(lowercaseNaturalNameOwnerQuery, null, 'IFRS');
assert.match(lowercaseNaturalNameOwnerResponse.messageText, /pro-rated portion from 15\/03\/2026 through 31\/03\/2026/i,
  'a lowercase name with an explicit status predicate remains bound to its own date even with a competing employee');
const fullNaturalNameOwnerQuery = 'Employee Alice Lee became a Singapore PR on 15 March 2026. Employee Alice Tan remains a foreigner. Is CPF due on Alice Lee’s March Ordinary Wages?';
const fullNaturalNameOwnerResponse = await processAccountingQuery(fullNaturalNameOwnerQuery, null, 'IFRS');
assert.match(fullNaturalNameOwnerResponse.messageText, /pro-rated portion from 15\/03\/2026 through 31\/03\/2026/i,
  'multi-token names remain distinct when the question uses a possessive reference');
const uppercaseFullNameOwnerQuery = 'Employee ALICE LEE became a Singapore PR on 15 March 2026. Employee ALICE TAN remains a foreigner. Is CPF due on ALICE LEE’s March Ordinary Wages?';
const uppercaseFullNameOwnerResponse = await processAccountingQuery(uppercaseFullNameOwnerQuery, null, 'IFRS');
assert.match(uppercaseFullNameOwnerResponse.messageText, /pro-rated portion from 15\/03\/2026 through 31\/03\/2026/i,
  'all-uppercase full names remain distinct from compact employee IDs');
const mixedCaseFullNameOwnerQuery = 'Employee ALICE Lee became a Singapore PR on 15 March 2026. Employee ALICE Tan remains a foreigner. Is CPF due on ALICE Lee’s March Ordinary Wages?';
const mixedCaseFullNameOwnerResponse = await processAccountingQuery(mixedCaseFullNameOwnerQuery, null, 'IFRS');
assert.match(mixedCaseFullNameOwnerResponse.messageText, /pro-rated portion from 15\/03\/2026 through 31\/03\/2026/i,
  'mixed-case full names remain distinct from compact employee IDs');
const lowercaseEmployeeAliasQuery = 'Employee a became a Singapore PR on 15 March 2026. Staff a’s March Ordinary Wages are being reviewed. Is CPF due on a’s March OW from the grant date?';
const lowercaseAliasResponse = await processAccountingQuery(lowercaseEmployeeAliasQuery, null, 'IFRS');
assert.match(lowercaseAliasResponse.messageText, /15\/03\/2026/,
  'lowercase employee designators and same-person staff aliases retain their own PR date');
assert.match(lowercaseAliasResponse.messageText, /pro-rated portion from 15\/03\/2026 through 31\/03\/2026/i,
  'a lowercase possessive reference can resolve to the explicitly established employee');
const lowercaseMultiEmployeeOwnerQuery = 'Employee a became a Singapore PR on 15 March 2026. Employee b remains a foreigner. Is CPF due on a’s March Ordinary Wages?';
const lowercaseMultiEmployeeOwnerResponse = await processAccountingQuery(lowercaseMultiEmployeeOwnerQuery, null, 'IFRS');
assert.match(lowercaseMultiEmployeeOwnerResponse.messageText, /15\/03\/2026/,
  'a lowercase possessive distinguishes employee a from employee b in a multi-employee query');
assert.match(lowercaseMultiEmployeeOwnerResponse.messageText, /pro-rated portion from 15\/03\/2026 through 31\/03\/2026/i,
  'the lower-case possessive receives only its matching employee’s proration');
const alphanumericOwnerQuery = 'Employee E1 became a Singapore PR on 15 March 2026. Staff E2 remains a foreigner. Is CPF due on E1’s March Ordinary Wages and what is the first-year boundary?';
assert.equal(supportCpfPayrollKnowledgeRule({ ...directNewPrRequest, query: alphanumericOwnerQuery }), true,
  'an alphanumeric employee possessive can bind the explicit PR date to E1');
assert.equal(defaultTargetDateResolver.resolveAuthorityEvidenceDate(alphanumericOwnerQuery).dateRole, 'CURRENT_WORKFLOW_FACT',
  'the named employee PR date remains an admitted current fact when the question explicitly identifies E1');
let alphanumericOwnerWorkstreams;
const alphanumericOwnerResponse = await processAccountingQuery(alphanumericOwnerQuery, null, 'IFRS', undefined, undefined, [], undefined, {
  onAuthorityWorkstreams: value => { alphanumericOwnerWorkstreams = value; }
});
const alphanumericOwnerIssues = alphanumericOwnerWorkstreams?.workstreams?.flatMap(stream => stream.issues) || [];
assert.ok(alphanumericOwnerIssues.some(issue => issue.domain === 'CPF_PAYROLL' && issue.evidenceStatus === 'VERIFIED'),
  'the application verifies CPF for the employee whose PR date is explicitly requested');
assert.match(alphanumericOwnerResponse.messageText, /15\/03\/2026/,
  'the application applies E1’s explicit PR date');
assert.match(alphanumericOwnerResponse.messageText, /first-year boundary ends 31\/03\/2027/i,
  'the application calculates the boundary for E1 instead of treating E1 as a foreigner');
const hyphenatedIdAliasQuery = 'Employee E-1 became a Singapore PR on 15 March 2026. Staff E1 remains an employee. Is CPF due on E-1’s March Ordinary Wages?';
const hyphenatedIdAliasResponse = await processAccountingQuery(hyphenatedIdAliasQuery, null, 'IFRS');
assert.match(hyphenatedIdAliasResponse.messageText, /pro-rated portion from 15\/03\/2026 through 31\/03\/2026/i,
  'compact E-1 and E1 identifiers continue to normalize to the same employee');

const singleEmployeeOwQuery = 'In October 2026, one employee has a separate annual bonus of S$20,000 and Ordinary Wages of S$5,000. The same employee is paid monthly. Is the CPF-able monthly OW base S$5,000, and does capping OW prove none of the bonus attracts CPF?';
let singleEmployeeOwWorkstreams;
const singleEmployeeOwResponse = await processAccountingQuery(singleEmployeeOwQuery, null, 'IFRS', undefined, undefined, [], undefined, {
  onAuthorityWorkstreams: value => { singleEmployeeOwWorkstreams = value; }
});
const singleEmployeeOwIssues = singleEmployeeOwWorkstreams?.workstreams?.flatMap(stream => stream.issues) || [];
assert.equal(singleEmployeeOwIssues.filter(issue => issue.domain === 'CPF_PAYROLL').length, 1,
  'ordinary prose about one employee has one CPF issue');
assert.match(singleEmployeeOwResponse.messageText, /stated monthly OW base is S\$5,000/i,
  'repeated ordinary prose about the same employee retains the OW amount');
assert.doesNotMatch(singleEmployeeOwResponse.messageText, /more than one employee or OW amount/i,
  'the words "has" and "is" are not employee identifiers');
const ordinaryEmployeeWordsQuery = 'In October 2026, the employee turns 60 and has S$5,000 of Ordinary Wages. The employee payroll record shows that the same employee is paid monthly. Is the CPF-able monthly OW base S$5,000?';
const ordinaryEmployeeWordsResponse = await processAccountingQuery(ordinaryEmployeeWordsQuery, null, 'IFRS');
assert.doesNotMatch(ordinaryEmployeeWordsResponse.messageText, /more than one employee or OW amount/i,
  'the words "turns" and "payroll" remain ordinary wording rather than employee identifiers');

const descriptiveIncomeCpfQuery = 'In October 2026, one employee has a separate annual bonus of S$20,000 and Ordinary Wages of S$5,000. The employment income includes both amounts. Is the CPF-able monthly OW base S$5,000, and does capping OW prove none of the bonus attracts CPF?';
let descriptiveIncomeWorkstreams;
const descriptiveIncomeResponse = await processAccountingQuery(descriptiveIncomeCpfQuery, null, 'IFRS', undefined, undefined, [], undefined, {
  onAuthorityWorkstreams: value => { descriptiveIncomeWorkstreams = value; }
});
const descriptiveIncomeIssues = descriptiveIncomeWorkstreams?.workstreams?.flatMap(stream => stream.issues) || [];
assert.ok(descriptiveIncomeIssues.some(issue => issue.domain === 'CPF_PAYROLL'),
  'the descriptive-income query retains its requested CPF issue');
assert.equal(descriptiveIncomeIssues.some(issue => issue.domain.startsWith('IRAS')), false,
  'descriptive employment-income context does not add an IRAS reporting request');
assert.match(descriptiveIncomeResponse.messageText, /\*\*Status:\*\* Evidence verified/i,
  'the final answer status stays verified for the sole requested CPF issue');
assert.match(descriptiveIncomeResponse.messageText, /\*\*Material evidence gaps:\*\* None identified/i,
  'the final answer does not report an unrequested IRAS evidence gap');
assert.match(descriptiveIncomeResponse.messageText, /stated monthly OW base is S\$5,000/i,
  'the final answer retains the supported monthly OW base');
for (const query of [
  'Does CPF apply to the annual bonus that the employment income includes?',
  'Does CPF apply to the annual bonus which is included in employment income?'
]) {
  let workstreams;
  const response = await processAccountingQuery(query, null, 'IFRS', undefined, undefined, [], undefined, {
    onAuthorityWorkstreams: value => { workstreams = value; }
  });
  const issues = workstreams?.workstreams?.flatMap(stream => stream.issues) || [];
  assert.ok(issues.some(issue => issue.domain === 'CPF_PAYROLL'), `${query}: preserve the requested CPF issue`);
  assert.equal(issues.some(issue => issue.domain.startsWith('IRAS')), false,
    `${query}: descriptive relative wording does not create an IRAS reporting issue`);
  assert.doesNotMatch(response.messageText, /Auto-Inclusion Scheme and Employment Income Reporting|IRAS AIS/i,
    `${query}: the final answer contains no unrequested IRAS evidence gap`);
}

const mixedIrasCpfQuery = 'Should we report the annual bonus in IR8A, and does CPF apply to this bonus?';
let mixedIrasCpfWorkstreams;
await processAccountingQuery(mixedIrasCpfQuery, null, 'IFRS', undefined, undefined, [], undefined, {
  onAuthorityWorkstreams: value => { mixedIrasCpfWorkstreams = value; }
});
const mixedIrasCpfIssues = mixedIrasCpfWorkstreams?.workstreams?.flatMap(workstream => workstream.issues) || [];
assert.ok(mixedIrasCpfIssues.some(issue => issue.domain.startsWith('IRAS')),
  'actual application planning retains IRAS reporting alongside CPF for the original IR8A wording');
assert.ok(mixedIrasCpfIssues.some(issue => issue.domain === 'CPF_PAYROLL'),
  'actual application planning retains the independent CPF workstream for the original IR8A wording');
let employmentIncomeCpfWorkstreams;
await processAccountingQuery('Should we report the annual bonus as employment income, and does CPF apply to this bonus?', null, 'IFRS', undefined, undefined, [], undefined, {
  onAuthorityWorkstreams: value => { employmentIncomeCpfWorkstreams = value; }
});
const employmentIncomeCpfIssues = employmentIncomeCpfWorkstreams?.workstreams?.flatMap(workstream => workstream.issues) || [];
assert.ok(employmentIncomeCpfIssues.some(issue => issue.domain.startsWith('IRAS')),
  'actual application planning retains employment-income reporting alongside CPF');
assert.ok(employmentIncomeCpfIssues.some(issue => issue.domain === 'CPF_PAYROLL'),
  'actual application planning retains CPF for employment-income bonus wording');
for (const [query, description] of [
  ['Should the annual bonus, which was earned in 2025, be reported as employment income, and does CPF apply to this bonus?', 'comma-delimited relative clause'],
  ['Should the annual bonus that was earned in 2025 be reported as employment income, and does CPF apply to this bonus?', 'restrictive relative clause'],
  ['Should the annual bonus that was earned last year be reported as employment income, and does CPF apply to this bonus?', 'restrictive relative clause with relative time wording'],
  ['Should the annual bonus that was paid in March be reported as employment income, and does CPF apply to this bonus?', 'restrictive relative clause with month wording'],
  ['Should the annual bonus that we paid yesterday be reported as employment income, and does CPF apply to this bonus?', 'restrictive relative clause with yesterday wording'],
  ['Should the annual bonus that was paid recently be reported as employment income, and does CPF apply to this bonus?', 'restrictive relative clause with recent wording'],
  ['Does CPF apply to the annual bonus, which includes employment income?', 'comma-delimited descriptive relative clause'],
  ['Does CPF apply to the annual bonus that includes employment income?', 'restrictive descriptive relative clause'],
  ['Does CPF apply to the annual bonus that should be reported as employment income?', 'modal reporting wording inside a restrictive relative clause'],
  ['Does CPF apply to the annual bonus that will be included in employment income?', 'future passive wording inside a restrictive relative clause'],
  ['Should the annual bonus that is to be reported as employment income attract CPF?', 'to-infinitive reporting wording inside a restrictive relative clause']
]) {
  let workstreams;
  await processAccountingQuery(query, null, 'IFRS', undefined, undefined, [], undefined, {
    onAuthorityWorkstreams: value => { workstreams = value; }
  });
  const issues = workstreams?.workstreams?.flatMap(workstream => workstream.issues) || [];
  assert.ok(issues.some(issue => issue.domain === 'CPF_PAYROLL'),
    `application planning retains CPF for the ${description}`);
  assert.equal(issues.some(issue => issue.domain.startsWith('IRAS')), !/(?:descriptive|inside)/.test(description),
    `application planning preserves the correct IRAS intent for the ${description}`);
}

for (const [query, expectIras, description] of [
  ['Should the annual bonus that could potentially be reported as employment income attract CPF?', false, 'potential reporting inside a descriptive relative clause'],
  ['Should the annual bonus that could legally be reported as employment income attract CPF?', false, 'legal possibility inside a descriptive relative clause'],
  ['Should the annual bonus that in principle could be reported as employment income attract CPF?', false, 'a relative passive predicate preceded by an adverbial phrase'],
  ['Should the annual bonus that was earned last year and therefore could be reported as employment income attract CPF?', false, 'a relative passive predicate after an explanatory subordinate clause'],
  ['Should the annual bonus that was earned last year and therefore could be reported as employment income be subject to CPF?', false, 'a relative passive predicate before an outer subject-to-CPF predicate'],
  ['Should the annual bonus that may be included in employment income and therefore be reported as employment income attract CPF?', false, 'a second relative passive predicate coordinated under the shared modal'],
  ['Should the annual bonus that may be included in employment income and also be reported as employment income be subject to CPF?', false, 'a second relative passive predicate coordinated with also under the shared modal'],
  ['Should the annual bonus that may be included in employment income or alternatively be reported as employment income attract CPF?', false, 'a second relative passive predicate coordinated with alternatively under the shared modal'],
  ['Should the annual bonus that may be included in employment income be reported as employment income, and does CPF apply?', true, 'a main reporting predicate after a descriptive relative clause'],
  ['Should the annual bonus that may be included in employment income be reported as employment income and attract CPF?', true, 'a main reporting predicate before a coordinated CPF predicate'],
  ['Should the annual bonus that may be included in employment income be reported as employment income and be subject to CPF?', true, 'a main reporting predicate before a coordinated subject-to-CPF predicate']
]) {
  let workstreams;
  await processAccountingQuery(query, null, 'IFRS', undefined, undefined, [], undefined, {
    onAuthorityWorkstreams: value => { workstreams = value; }
  });
  const issues = workstreams?.workstreams?.flatMap(workstream => workstream.issues) || [];
  assert.ok(issues.some(issue => issue.domain === 'CPF_PAYROLL'), `${query}: retain the requested CPF workstream`);
  assert.equal(issues.some(issue => issue.domain.startsWith('IRAS')), expectIras,
    `${query}: ${description} has the expected reporting intent`);
}

console.log(`Statutory CPF expansion: ${results.length} actual app cases and date/source negative controls passed.`);
