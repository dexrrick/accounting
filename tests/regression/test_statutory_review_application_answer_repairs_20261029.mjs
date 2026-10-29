import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { reconcileQuestionUnderstanding } from '../../src/services/semanticQuestionUnderstanding.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { OFFICIAL_SOURCE_DISCOVERY_PROVIDERS } from '../../src/retrieval/officialSitemapDiscovery.ts';
import { loadStatutoryKnowledgeSources } from '../../scripts/load_statutory_knowledge_sources.mjs';
import { STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES } from '../fixtures/statutoryCoverageOfficialPages.mjs';

const cpfCeilingQuestion = 'For CPF Additional Wages, can we keep our estimated annual ceiling unchanged in December if the employee\'s actual Ordinary Wages turn out higher?';
const employerTerminationQuestion = 'For an Employment Act employee whose contract is ended by the employer, is the final-pay deadline the same seven-day deadline used when someone quits without serving notice?';
const cpfCalculationQuestion = 'Calculate employer and employee CPF contributions for SGD 6,000 ordinary wages for a Singapore citizen below 55 in 2026 and prepare the journal entry.';
const employeeResignationQuestion = 'For an Employment Act employee who resigned without serving notice, what is the final-pay deadline?';
const negatedEmployerTerminationQuestion = 'The employer did not dismiss or terminate the Employment Act employee; the employee resigned without serving notice. Is final pay due within 7 days?';

const cpfCeilingClassification = classifyQuestion(cpfCeilingQuestion);
assert.ok(cpfCeilingClassification.authorities.includes('CPF'), 'the AW ceiling question remains routed to CPF');
assert.equal(cpfCeilingClassification.intent, 'STATUTORY_ADVISORY', 'the AW ceiling question is a rule question');
assert.equal(cpfCeilingClassification.calculationRequired, false, 'an estimated ceiling stated as a fact does not request a calculation');
assert.equal(cpfCeilingClassification.journalEntryRequired, false, 'an estimated ceiling stated as a fact does not request a journal');

for (const question of [
  'Can you estimate employer and employee CPF contributions for SGD 6,000 ordinary wages?',
  'Calculate employer and employee CPF contributions for SGD 6,000 ordinary wages.'
]) {
  const classification = classifyQuestion(question);
  assert.equal(classification.calculationRequired, true, `a direct CPF estimate or calculation remains active: ${question}`);
  assert.equal(classification.journalEntryRequired, true, `a direct CPF estimate or calculation keeps the payroll journal path: ${question}`);
}

const employerTerminationClassification = classifyQuestion(employerTerminationQuestion);
assert.ok(employerTerminationClassification.topicIds.includes('mom-salary-payment'), 'employer-ended contract wording maps to MOM final-salary guidance');
assert.ok(employerTerminationClassification.authorities.includes('MOM'), 'the final-pay question remains routed to MOM');
assert.equal(employerTerminationClassification.intent, 'STATUTORY_ADVISORY', 'the final-pay question remains an advisory');
assert.equal(employerTerminationClassification.calculationRequired, false, 'a final-pay deadline comparison does not calculate payroll');
assert.equal(employerTerminationClassification.journalEntryRequired, false, 'a final-pay deadline comparison does not create a journal');

const cpfCeilingPage = STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES.find(page => page.id === 'cpf-aw-ceiling');
const momSalaryPage = STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES.find(page => page.id === 'mom-salary');
assert.ok(cpfCeilingPage, 'the frozen CPF AW ceiling source fixture is available');
assert.ok(momSalaryPage, 'the frozen MOM salary-payment source fixture is available');

const manifestPages = await loadStatutoryKnowledgeSources(fileURLToPath(new URL('../fixtures/statutoryKnowledge20261027b', import.meta.url)));
const awCeilingManifestPage = manifestPages.find(page => page.filename === 'cpf-aw-ceiling-native-2026.pdf');
const momFinalSalaryManifestPage = manifestPages.find(page => page.filename === 'mom-final-salary.txt');
assert.ok(awCeilingManifestPage, 'the frozen CPF native AW-ceiling source manifest is available');
assert.ok(momFinalSalaryManifestPage, 'the frozen MOM final-salary source manifest is available');
const fixturePages = new Map(STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES.map(page => [page.sourceUrl,
  { authority: page.authority, body: page.html, type: 'text/html' }]));
for (const page of manifestPages) fixturePages.set(page.sourceUrl, {
  authority: page.authority, body: page.body, type: page.contentType
});
const fetchAttempts = [];
const modelEndpointPattern = /(?:generativelanguage\.googleapis\.com|api\.openai\.com|openai\.azure\.com|\/generateContent(?:\?|$)|\/chat\/completions(?:\?|$))/i;
const strictOfflineFetch = async input => {
  const url = input && typeof input === 'object' && typeof input.url === 'string' ? input.url : String(input);
  fetchAttempts.push(url);
  if (modelEndpointPattern.test(url)) throw new Error(`Unexpected model/provider request in offline regression: ${url}`);
  const fixture = fixturePages.get(url);
  if (fixture) return new Response(fixture.body, { headers: { 'content-type': fixture.type } });
  const provider = Object.values(OFFICIAL_SOURCE_DISCOVERY_PROVIDERS).find(candidate => candidate.sitemapUrls?.includes(url));
  if (provider) {
    const locations = [...fixturePages].filter(([, page]) => page.authority === provider.authority)
      .map(([sourceUrl]) => `<url><loc>${sourceUrl.replaceAll('&', '&amp;')}</loc></url>`).join('');
    return new Response(`<urlset>${locations}</urlset>`, { headers: { 'content-type': 'application/xml' } });
  }
  return new Response('Unavailable in frozen offline source set', { status: 404 });
};

const previousFetch = globalThis.fetch;
const responses = new Map();
try {
  globalThis.fetch = strictOfflineFetch;
  for (const [key, question] of [
    ['cpfCeiling', cpfCeilingQuestion],
    ['employerTermination', employerTerminationQuestion],
    ['cpfCalculation', cpfCalculationQuestion]
  ]) {
    let workstreams;
    const response = await processAccountingQuery(question, null, 'IFRS', undefined, undefined, [], undefined, {
      onAuthorityWorkstreams: result => { workstreams = result; }
    });
    responses.set(key, { response, workstreams });
  }
} finally {
  globalThis.fetch = previousFetch;
}

assert.ok(fetchAttempts.length > 0, 'the real application path used the frozen offline fetch');
assert.equal(fetchAttempts.some(url => modelEndpointPattern.test(url)), false, 'the actual-answer regressions made no provider/model requests');
assert.ok(fetchAttempts.includes(awCeilingManifestPage.sourceUrl), 'the AW ceiling answer used its frozen native official-source fixture');
assert.ok(fetchAttempts.includes(momFinalSalaryManifestPage.sourceUrl), 'the final-pay answer used its frozen official-source fixture');

const cpfCeilingResult = responses.get('cpfCeiling');
assert.ok(cpfCeilingResult.workstreams, 'the CPF answer reached the ordinary authority workstream path');
assert.equal(cpfCeilingResult.response.scenarioState.scenarioType, 'AUTHORITY_ADVISORY', 'the estimated AW ceiling returns through statutory advisory');
assert.deepEqual(cpfCeilingResult.response.scenarioState.directGroups || [], [], 'the AW ceiling question does not create payroll journals');
assert.match(cpfCeilingResult.response.messageText, /Additional Wage ceiling|AW ceiling/i, 'the CPF answer addresses the annual Additional Wage ceiling');
assert.match(cpfCeilingResult.response.messageText, /Ordinary Wages|OW/i, 'the CPF answer ties the ceiling to actual Ordinary Wages');
assert.match(cpfCeilingResult.response.messageText, /recalculate using actual OW subject to CPF/i,
  'the CPF answer requires recalculation using actual Ordinary Wages.');
assert.match(cpfCeilingResult.response.messageText, /last month of employment or December, whichever is earlier/i,
  'the CPF answer identifies the earlier last-employment month or December checkpoint.');
assert.match(cpfCeilingResult.response.messageText, /pay any CPF shortfall/i,
  'the CPF answer says to pay any recalculated shortfall.');
assert.match(cpfCeilingResult.response.messageText, /apply for a refund if excess CPF contributions result/i,
  'the CPF answer says to apply for a refund when contributions are excess.');
assert.doesNotMatch(cpfCeilingResult.response.messageText, /Basic Salary Payable|monthly basic salary is subject to CPF/i,
  'the answer does not introduce an unrelated basic-salary claim');

const employerTerminationResult = responses.get('employerTermination');
assert.ok(employerTerminationResult.workstreams, 'the final-pay answer reached the ordinary authority workstream path');
assert.equal(employerTerminationResult.response.scenarioState.scenarioType, 'AUTHORITY_ADVISORY', 'the employer-ended contract returns through statutory advisory');
assert.deepEqual(employerTerminationResult.response.scenarioState.directGroups || [], [], 'the final-pay deadline question does not create journal groups');
assert.match(employerTerminationResult.response.messageText, /last day of employment|last day/i,
  'the answer states the ordinary employer-termination deadline');
assert.match(employerTerminationResult.response.messageText, /3 working days/i,
  'the answer preserves the exception when last-day payment is not possible');
assert.match(employerTerminationResult.response.messageText, /within 7 days|7 days after/i,
  'the answer distinguishes the resignation-without-notice deadline');
assert.doesNotMatch(employerTerminationResult.response.messageText, /CPF|central provident fund|ordinary wages|basic salary/i,
  'the MOM final-pay answer contains no unrelated payroll or CPF rule');

const cpfCalculationResult = responses.get('cpfCalculation').response;
assert.equal(cpfCalculationResult.scenarioState.queryIntent, 'TRANSACTION', 'a concrete CPF contribution calculation keeps its payroll transaction path');
assert.equal(cpfCalculationResult.scenarioState.scenarioType, 'PAYROLL_CPF_SALARY', 'the actual CPF calculator remains active');
assert.ok((cpfCalculationResult.scenarioState.directGroups || []).length > 0, 'the CPF calculation produces journal groups');
for (const group of cpfCalculationResult.scenarioState.directGroups || []) {
  assert.ok(group.lines.length > 0, 'the CPF payroll journal contains posting lines');
  const debits = group.lines.reduce((sum, entry) => sum + entry.debit, 0);
  const credits = group.lines.reduce((sum, entry) => sum + entry.credit, 0);
  assert.ok(debits > 0, 'the CPF journal contains a calculated amount');
  assert.ok(Math.abs(debits - credits) < 0.01, 'the CPF payroll journal remains balanced');
}

for (const [key, question] of [
  ['employeeResignation', employeeResignationQuestion],
  ['negatedEmployerTermination', negatedEmployerTerminationQuestion]
]) {
  const classification = classifyQuestion(question);
  assert.ok(classification.topicIds.includes('mom-salary-payment'), `${key} resolves to the MOM salary-payment rule`);
  assert.equal(classification.intent, 'STATUTORY_ADVISORY', `${key} remains an advisory question`);
  assert.equal(classification.calculationRequired, false, `${key} does not request a payroll calculation`);
  assert.equal(classification.journalEntryRequired, false, `${key} does not request a journal`);
  const { issuePlan } = reconcileQuestionUnderstanding(question, classification,
    { mode: 'DETERMINISTIC_FALLBACK', failure: 'NO_PROVIDER' });
  assert.ok(issuePlan.issues.some(issue => issue.operation === 'EXPLAIN_RULE' && issue.mappedTopicIds.includes('mom-salary-payment')),
    `${key} preserves the final-salary rule issue plan`);
}

console.log('Statutory application answer corrections passed through processAccountingQuery.');
