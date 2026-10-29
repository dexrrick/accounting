import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { OFFICIAL_SOURCE_DISCOVERY_PROVIDERS } from '../../src/retrieval/officialSitemapDiscovery.ts';
import { STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES } from '../fixtures/statutoryCoverageOfficialPages.mjs';

const rateQuestions = [
  'What are employer and employee CPF percentages in 2026 for a Singapore citizen aged over 60 to 65 earning more than S$750 per month?',
  'Does the employee CPF percentage fall on the exact date of a 60th birthday, or in the following month?'
];

for (const question of rateQuestions) {
  const classification = classifyQuestion(question);
  assert.ok(classification.authorities.includes('CPF'), 'the question remains routed to CPF');
  assert.equal(classification.intent, 'STATUTORY_ADVISORY', 'a general CPF rate question remains statutory guidance');
  assert.equal(classification.journalEntryRequired, false, 'age-band or threshold digits do not request a journal');
  assert.equal(classification.calculationRequired, false, 'a stated CPF rate or birthday question does not request a payroll calculation');
  assert.equal(classification.accountingAnalysisRequired, false, 'a general CPF rate question does not request accounting analysis');
}

const acraXbrlQuestions = [
  'Is a solvent exempt private company automatically required to upload Full XBRL financial statements?',
  'Our company needs to file financial statements. For Simplified XBRL, is being non-publicly accountable enough, or do both revenue and total assets also have to be at most S$500,000?'
];
for (const question of acraXbrlQuestions) {
  const classification = classifyQuestion(question);
  assert.ok(classification.topicIds.includes('acra_xbrl'), 'the XBRL filing question remains mapped to ACRA XBRL guidance');
  assert.equal(classification.primaryDomain, 'CORPORATE_REGULATORY', 'XBRL filing guidance remains an ACRA regulatory question');
  assert.equal(classification.domains.some(domain => domain.startsWith('ACCOUNTING_')), false,
    'financial-statement filing language does not add an accounting domain');
  assert.equal(classification.accountingAnalysisRequired, false, 'ACRA XBRL filing guidance does not request accounting analysis');
  assert.equal(classification.intent, 'STATUTORY_ADVISORY', 'XBRL eligibility and template questions remain statutory advice');
  assert.equal(classification.journalEntryRequired, false, 'XBRL eligibility and threshold figures do not request a journal');
  assert.equal(classification.calculationRequired, false, 'XBRL eligibility thresholds do not request accounting calculations');
}

for (const question of [
  'Our company purchased equipment for S$12,000 and it will be shown in XBRL financial statements. Prepare the journal entry and calculate the total.',
  'Our company issued 10,000 ordinary shares for S$1 each and received cash, and will file XBRL financial statements. Prepare the journal entry and calculate issue proceeds.'
]) {
  const classification = classifyQuestion(question);
  assert.equal(classification.intent, 'TRANSACTION', 'an actual purchase or share issuance remains transactional');
  assert.equal(classification.journalEntryRequired, true, 'an explicit journal request remains enabled');
  assert.equal(classification.calculationRequired, true, 'an explicit amount calculation remains enabled');
}

for (const question of [
  'How much CPF should payroll deduct from S$4,000 monthly wages for an employee?',
  'Calculate employer and employee CPF contributions for S$4,000 of monthly wages.'
]) {
  const classification = classifyQuestion(question);
  assert.equal(classification.journalEntryRequired, true, 'an actual payroll contribution request keeps its established journal path');
  assert.equal(classification.calculationRequired, true, 'an actual amount request remains a calculation');
}

const question = rateQuestions[0];
const acraGuidancePages = JSON.parse(readFileSync(new URL('../fixtures/acra-company-guidance-2026-10-10.json', import.meta.url), 'utf8'));
const acraXbrlPage = acraGuidancePages.find(page => page.name === 'xbrl');
assert.ok(acraXbrlPage, 'the retained ACRA XBRL page fixture is present');
const acraXbrlFixture = {
  authority: 'ACRA',
  sourceUrl: acraXbrlPage.url,
  html: acraXbrlPage.html
};
const fixtures = new Map([
  ...STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES.map(page => [page.sourceUrl, page]),
  [acraXbrlFixture.sourceUrl, acraXbrlFixture]
]);
const fetchAttempts = [];
const modelEndpointPattern = /(?:generativelanguage\.googleapis\.com|api\.openai\.com|openai\.azure\.com|\/generateContent(?:\?|$)|\/chat\/completions(?:\?|$))/i;
const strictOfflineFetch = async input => {
  const url = input && typeof input === 'object' && typeof input.url === 'string' ? input.url : String(input);
  fetchAttempts.push(url);
  const page = fixtures.get(url);
  if (page) return new Response(page.html, { headers: { 'content-type': 'text/html' } });
  const provider = Object.values(OFFICIAL_SOURCE_DISCOVERY_PROVIDERS).find(candidate => candidate.sitemapUrls?.includes(url));
  if (provider) {
    const locations = [...fixtures.values()].filter(candidate => candidate.authority === provider.authority)
      .map(candidate => `<url><loc>${candidate.sourceUrl.replaceAll('&', '&amp;')}</loc></url>`).join('');
    return new Response(`<urlset>${locations}</urlset>`, { headers: { 'content-type': 'application/xml' } });
  }
  return new Response('Unavailable in frozen offline source set', { status: 404 });
};

const previousFetch = globalThis.fetch;
let workstreams;
let response;
const acraXbrlResponses = [];
globalThis.fetch = strictOfflineFetch;
try {
  response = await processAccountingQuery(question, null, 'IFRS', undefined, undefined, [], undefined, {
    onAuthorityWorkstreams: result => { workstreams = result; }
  });
  for (const acraQuestion of acraXbrlQuestions) {
    let acraWorkstreams;
    const acraResponse = await processAccountingQuery(acraQuestion, null, 'SFRS_I', undefined, undefined, [], undefined, {
      onAuthorityWorkstreams: result => { acraWorkstreams = result; }
    });
    acraXbrlResponses.push({ question: acraQuestion, response: acraResponse, workstreams: acraWorkstreams });
  }
} finally {
  globalThis.fetch = previousFetch;
}

assert.ok(fetchAttempts.length > 0, 'the normal application entry used the strict offline fetch fixture');
assert.equal(fetchAttempts.some(url => modelEndpointPattern.test(url)), false, 'no provider means no semantic or generation model request');
assert.ok(workstreams, 'the actual authority workstream path was reached');
assert.equal(response.scenarioState.scenarioType, 'AUTHORITY_ADVISORY', 'the general question returns through the statutory advisory route');
assert.equal(response.scenarioState.primaryDomain, 'MULTI_AUTHORITY', 'the application retained its authority evidence state');
assert.deepEqual(response.scenarioState.directGroups || [], [], 'the general rate question does not produce payroll journal groups');
assert.doesNotMatch(response.messageText, /Monthly Payroll & Statutory CPF Accrual|Gross Salary Payable|SGD 750\.00|30 Sep 2026/i,
  'the returned application answer contains no fabricated payroll calculation, salary amount, or payroll date');

assert.ok(acraXbrlResponses.length === acraXbrlQuestions.length, 'both held-out ACRA XBRL questions passed through processAccountingQuery');
assert.equal(fetchAttempts.includes(acraXbrlPage.url), true, 'the application used the frozen local ACRA XBRL page fixture');
for (const { question: acraQuestion, response: acraResponse, workstreams: acraWorkstreams } of acraXbrlResponses) {
  assert.ok(acraWorkstreams, `the authority workstream path was reached for: ${acraQuestion}`);
  assert.equal(acraResponse.scenarioState.scenarioType, 'AUTHORITY_ADVISORY',
    `XBRL filing eligibility remains on the advisory path for: ${acraQuestion}`);
  assert.deepEqual(acraResponse.scenarioState.directGroups || [], [],
    `XBRL filing eligibility does not generate transaction journal groups for: ${acraQuestion}`);
}
assert.equal(fetchAttempts.some(url => modelEndpointPattern.test(url)), false, 'the strict offline run made no provider/model requests');

console.log('Statutory application CPF and ACRA XBRL routing regressions passed.');
