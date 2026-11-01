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

console.log(`Statutory CPF expansion: ${results.length} actual app cases and date/source negative controls passed.`);
