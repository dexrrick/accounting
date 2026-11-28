import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { interpretSemanticQuestion, reconcileQuestionUnderstanding } from '../../src/services/semanticQuestionUnderstanding.ts';
import { loadStatutoryKnowledgeSources } from '../../scripts/load_statutory_knowledge_sources.mjs';
import { OFFICIAL_SOURCE_DISCOVERY_PROVIDERS } from '../../src/retrieval/officialSitemapDiscovery.ts';

const sourcePages = new Map();
for (const directory of [
  'tests/fixtures/statutoryKnowledge20261027b',
  'tests/fixtures/statutoryKnowledge20261030',
  'tests/fixtures/statutoryWorkflows20261029',
  'tests/fixtures/statutoryKnowledge20261031'
]) {
  for (const page of await loadStatutoryKnowledgeSources(directory)) {
    sourcePages.set(page.sourceUrl, { authority: page.authority, body: page.body, type: page.contentType });
  }
}
globalThis.fetch = async input => {
  const url = typeof input?.url === 'string' ? input.url : String(input);
  const page = sourcePages.get(url);
  if (page) return new Response(page.body, { headers: { 'content-type': page.type } });
  const provider = Object.values(OFFICIAL_SOURCE_DISCOVERY_PROVIDERS)
    .find(config => config.sitemapUrls?.includes(url));
  if (provider) {
    const entries = [...sourcePages].filter(([, source]) => source.authority === provider.authority)
      .map(([sourceUrl]) => `<url><loc>${sourceUrl.replaceAll('&', '&amp;')}</loc></url>`).join('');
    return new Response(`<urlset>${entries}</urlset>`, { headers: { 'content-type': 'application/xml' } });
  }
  return new Response('Unavailable in frozen fixture set', { status: 404 });
};

const captured = [];
async function run(label, query, currentScenario = null, chatHistory = [], outputPreference = undefined) {
  let workstreams;
  const response = await processAccountingQuery(query, currentScenario, 'IFRS', undefined, undefined,
    chatHistory, outputPreference, { onAuthorityWorkstreams: value => { workstreams = value; } });
  captured.push({ label, query, response, issuePlan: workstreams?.issuePlan ?? null });
  return { response, issuePlan: workstreams?.issuePlan ?? null };
}

async function getIssuePlan(query) {
  const classification = classifyQuestion(query);
  const understanding = await interpretSemanticQuestion(query);
  return reconcileQuestionUnderstanding(query, classification, understanding).issuePlan;
}

const mixedCases = [
  {
    label: 'explicit-journal-sale-first',
    query: 'Prepare the journal entries for our cash sale of goods for S$10,000. Also calculate an employee’s final salary after resignation and explain when the payslip is due.'
  },
  {
    label: 'tax-related-mixed-sale',
    query: 'We sold goods for S$10,000 cash. The goods cost S$6,000. What journal entry and tax apply? After an employee resigns, when is final salary due and when must we issue the payslip?'
  },
  {
    label: 'same-sentence-explicit-journal',
    query: 'We sold goods for S$10,000 cash and need journal entries, and how much final salary do we owe the employee who resigned and when must we issue the payslip?'
  },
  {
    label: 'mom-first-sale-last',
    query: 'Calculate the final salary after an employee resigns and explain when we must issue the payslip. Then record the sale of goods for S$10,000 cash; their cost was S$6,000.'
  },
  {
    label: 'reviewer-sale-amount-before-goods',
    query: 'Prepare journal entries. We sold S$10,000 of goods for cash. An employee resigned; calculate their final salary and explain the payslip deadline.'
  },
  {
    label: 'reviewer-cash-sale-without-goods',
    query: 'Prepare journal entries. We made a cash sale for S$10,000. An employee resigned; calculate their final salary and explain the payslip deadline.'
  }
];

for (const sample of mixedCases) {
  const { response } = await run(sample.label, sample.query, null, [], { journal: true });
  const reconciledIssuePlan = await getIssuePlan(sample.query);
  assert.deepEqual(response.scenarioState.directGroups || [], [],
    `${sample.label}: sale proceeds and unstated salary facts never create a payroll journal.`);
  assert.deepEqual(response.scenarioState.projectedGroups || [], [],
    `${sample.label}: no current payroll or sale journal is projected.`);
  assert.deepEqual(response.scenarioState.committedDirectGroups || [], [],
    `${sample.label}: no current payroll or sale journal is committed.`);
  const saleJournal = reconciledIssuePlan.issues.find(issue => issue.domain === 'ACCOUNTING' && issue.operation === 'PREPARE_JOURNAL');
  if (sample.label.startsWith('reviewer-')) {
    assert.ok(['PAYROLL_CPF_SALARY', 'UNRECOGNIZED'].includes(response.scenarioState.scenarioType),
      `${sample.label}: the mixed result remains unresolved without a fabricated payroll calculation.`);
    if (response.scenarioState.scenarioType === 'PAYROLL_CPF_SALARY') {
      assert.equal(response.scenarioState.authorityStatus, 'CONDITIONAL');
      assert.ok(response.scenarioState.missingFields?.some(field => field.fieldKey === 'salaryRate'));
      assert.ok(response.scenarioState.missingFields?.some(field => field.fieldKey === 'independentSaleJournal'));
    } else {
      assert.ok(saleJournal, `${sample.label}: the unresolved sale journal remains in the semantic plan.`);
    }
  } else {
    assert.equal(response.scenarioState.scenarioType, 'UNRECOGNIZED',
      `${sample.label}: the mixed transaction retains unresolved accounting status.`);
    assert.ok(response.scenarioState.missingFields?.some(field =>
      ['independentAccountingFacts', 'independentSaleJournal', 'salaryRate'].includes(field.fieldKey)) || saleJournal,
      `${sample.label}: missing sale and salary facts remain explicit.`);
  }
  assert.ok(saleJournal, `${sample.label}: the independently requested sale journal remains in the issue plan.`);
  assert.equal(saleJournal.status, 'UNRESOLVED');
  assert.equal(saleJournal.unresolvedReason, 'NO_COVERAGE_TOPIC');
  assert.deepEqual(saleJournal.mappedTopicIds, []);
  if (sample.label === 'tax-related-mixed-sale') {
    assert.ok(reconciledIssuePlan.issues.some(issue => issue.domain === 'MOM_EMPLOYMENT' &&
      issue.mappedTopicIds.includes('mom-itemised-payslips')),
    'The IRAS-focused answer still has an independently mapped MOM payslip issue in the semantic plan.');
  } else {
    assert.match(response.messageText, /itemised payslip|pay ?slips?/i,
      `${sample.label}: independently supported MOM payslip guidance remains present.`);
  }
  assert.match(response.messageText, /Clarification Required|settlement|measurement/i,
    `${sample.label}: the response does not imply the sale journal was prepared.`);
  assert.doesNotMatch(response.messageText, /(?:S\$|SGD\s?)10,000.{0,80}(?:salary|CPF contribution)/i,
    `${sample.label}: the sale amount is not reused as a salary or CPF base.`);
}

const priorPayroll = await run('prior-payroll-journal',
  'A Singaporean employee is age 32 and earns S$5,000 per month. Calculate the full salary and CPF contribution for September 2026.');
assert.ok(priorPayroll.response.scenarioState.directGroups?.some(group => group.isBalanced && group.totalDebit === group.totalCredit),
  'The standalone supported payroll transaction still produces a balanced journal.');
const currentMixedQuery = 'We sold goods for S$10,000. After an employee resigns, how much final salary do we owe and when must we issue the payslip?';
const priorPayrollContext = [
  { id: 'prior-payroll-user', sender: 'user', text: priorPayroll.response.scenarioState.rawQuery },
  { id: 'prior-payroll-model', sender: 'model', text: priorPayroll.response.messageText },
  { id: 'mixed-follow-up-user', sender: 'user', text: currentMixedQuery }
];
const followup = await run('previous-journal-context', currentMixedQuery,
  priorPayroll.response.scenarioState, priorPayrollContext);
assert.deepEqual(followup.response.scenarioState.directGroups || [], [],
  'A prior payroll journal does not turn the later sale amount into a final-pay basis or new journal.');
assert.deepEqual(followup.response.scenarioState.projectedGroups || [], [],
  'The prior payroll journal does not survive as a projection on the mixed request.');
assert.deepEqual(followup.response.scenarioState.committedDirectGroups || [], [],
  'The prior payroll journal is not committed to the new mixed request.');
assert.ok(followup.issuePlan?.issues.some(issue => issue.domain === 'ACCOUNTING' &&
  issue.operation === 'PREPARE_JOURNAL' && issue.status === 'UNRESOLVED'),
'The previous payroll context does not erase the unresolved independent sale obligation.');

const reviewerQueries = [
  'Prepare journal entries. We sold goods for S$10,000 cash, and an employee resigned; calculate their final salary and explain the payslip deadline.',
  'We sold goods for S$10,000 cash. Prepare journal entries and calculate final salary for a departing employee, and explain the payslip deadline.'
];
for (let index = 0; index < reviewerQueries.length; index++) {
  const query = reviewerQueries[index];
  const fresh = await run(`reviewer-variant-${index + 1}`, query);
  assert.deepEqual(fresh.response.scenarioState.directGroups || [], [],
    `Reviewer variant ${index + 1}: the goods proceeds do not produce a salary journal.`);
  assert.deepEqual(fresh.response.scenarioState.projectedGroups || [], [],
    `Reviewer variant ${index + 1}: no projected payroll journal is inferred.`);
  assert.deepEqual(fresh.response.scenarioState.committedDirectGroups || [], [],
    `Reviewer variant ${index + 1}: no prior employee journal is committed to the new request.`);
  assert.equal(fresh.response.scenarioState.amount, undefined,
    `Reviewer variant ${index + 1}: the sale price is not exposed as a salary basis.`);
  assert.ok(fresh.response.scenarioState.missingFields?.some(field =>
    ['salaryRate', 'independentAccountingFacts'].includes(field.fieldKey)),
    `Reviewer variant ${index + 1}: missing salary facts remain explicit in the application response.`);

  const withPriorPayroll = await run(`reviewer-variant-${index + 1}-prior-payroll`, query,
    priorPayroll.response.scenarioState);
  assert.deepEqual(withPriorPayroll.response.scenarioState.directGroups || [], [],
    `Reviewer variant ${index + 1}: a previous employee journal cannot supply the new salary basis.`);
  assert.deepEqual(withPriorPayroll.response.scenarioState.projectedGroups || [], []);
  assert.deepEqual(withPriorPayroll.response.scenarioState.committedDirectGroups || [], []);
  assert.equal(withPriorPayroll.response.scenarioState.amount, undefined);
  assert.ok(withPriorPayroll.response.scenarioState.missingFields?.some(field =>
    ['salaryRate', 'independentAccountingFacts'].includes(field.fieldKey)));

  const direct = await parseAccountingQuery(query, priorPayroll.response.scenarioState);
  assert.deepEqual(direct.directGroups || [], [], 'The parser itself rejects the sale-derived payroll amount.');
  assert.deepEqual(direct.projectedGroups || [], []);
  assert.deepEqual(direct.committedDirectGroups || [], []);
  assert.equal(direct.amount, undefined);
  assert.ok(direct.missingFields.some(field => field.fieldKey === 'salaryRate'));
}

const employeeRateMixedQuery =
  'We sold goods for S$10,000 cash. The employee earns S$5,000 per month and resigned; calculate their final salary.';
const employeeRateMixed = await parseAccountingQuery(employeeRateMixedQuery);
assert.equal(employeeRateMixed.amount, 5000,
  'An explicitly employee-owned monthly salary is selected instead of the earlier sale amount.');
assert.deepEqual(employeeRateMixed.directGroups || [], [],
  'An unsupported composite sale/payroll calculation creates no payroll journal.');
assert.deepEqual(employeeRateMixed.projectedGroups || [], []);
assert.deepEqual(employeeRateMixed.committedDirectGroups || [], []);
assert.ok(employeeRateMixed.missingFields.some(field => field.fieldKey === 'finalSalaryCalculationFacts'));
assert.ok(employeeRateMixed.missingFields.some(field => field.fieldKey === 'independentSaleJournal'));
const monthlySaleOnly = await parseAccountingQuery(
  'We sold goods for S$10,000 per month. An employee resigned; calculate their final salary and explain the payslip deadline.');
assert.equal(monthlySaleOnly.amount, undefined,
  'A monthly sale amount is still not a payroll-owned salary figure.');
assert.deepEqual(monthlySaleOnly.directGroups || [], []);
assert.ok(monthlySaleOnly.missingFields.some(field => field.fieldKey === 'salaryRate'));

const ambiguousEmployeeRate = await parseAccountingQuery(
  'We sold goods for S$10,000 cash. Employee Alice earns S$5,000 per month; employee Bob resigned. Calculate final salary for the departing employee.');
assert.equal(ambiguousEmployeeRate.amount, undefined,
  'A salary explicitly attached to a different named employee is not reused for the departing employee.');
assert.deepEqual(ambiguousEmployeeRate.directGroups || [], []);
assert.deepEqual(ambiguousEmployeeRate.projectedGroups || [], []);
assert.deepEqual(ambiguousEmployeeRate.committedDirectGroups || [], []);
assert.ok(ambiguousEmployeeRate.missingFields.some(field => field.fieldKey === 'salaryRate'));

const unrelatedEarnings = await parseAccountingQuery(
  'We sold goods for S$10,000 cash. Business earnings were S$15,000; an employee resigned, calculate final salary.');
assert.equal(unrelatedEarnings.amount, undefined,
  'Commercial earnings are not a payroll-owned salary basis.');
assert.deepEqual(unrelatedEarnings.directGroups || [], []);
assert.ok(unrelatedEarnings.missingFields.some(field => field.fieldKey === 'salaryRate'));

const negatedFinalPay = await parseAccountingQuery(
  'We sold goods for S$10,000 cash. Do not calculate the employee’s final salary; explain only the payslip deadline.');
assert.notEqual(negatedFinalPay.scenarioType, 'PAYROLL_CPF_SALARY',
  'Negated final-salary intent is not routed into payroll arithmetic.');
assert.deepEqual(negatedFinalPay.directGroups || [], []);
assert.deepEqual(negatedFinalPay.projectedGroups || [], []);
assert.deepEqual(negatedFinalPay.committedDirectGroups || [], []);

for (const [label, query] of [
  ['tax-sale-first', 'We sold goods for S$10,000 cash. After an employee resigned, what tax applies to the sale, calculate final salary, and explain the payslip deadline.'],
  ['tax-payroll-first', 'After an employee resigned, calculate final salary and explain the payslip deadline. We sold goods for S$10,000 cash; what tax applies?']
]) {
  const mixedTax = await run(label, query);
  const taxIssuePlan = await getIssuePlan(query);
  assert.deepEqual(mixedTax.response.scenarioState.directGroups || [], [],
    `${label}: tax advice and clause order do not route sale proceeds into payroll.`);
  assert.deepEqual(mixedTax.response.scenarioState.projectedGroups || [], []);
  assert.deepEqual(mixedTax.response.scenarioState.committedDirectGroups || [], []);
  assert.notEqual(mixedTax.response.scenarioState.amount, 10000,
    `${label}: the goods sale amount is never exposed as the final-salary basis.`);
  assert.ok(!taxIssuePlan.issues.some(issue => issue.domain === 'ACCOUNTING' &&
    issue.operation === 'PREPARE_JOURNAL'),
    `${label}: tax advice alone does not create an unsolicited journal request.`);
  assert.doesNotMatch(mixedTax.response.messageText, /(?:S\$|SGD\s?)10,000.{0,80}(?:salary|CPF contribution)/i);
}

const standaloneSale = await run('standalone-supported-purchase',
  'Record a purchase of office supplies for SGD 200 paid in cash.');
const standaloneSaleGroup = standaloneSale.response.scenarioState.directGroups?.[0];
assert.ok(standaloneSaleGroup?.isBalanced, 'A supported standalone accounting transaction remains available.');
assert.equal(standaloneSaleGroup.totalDebit, 200);
assert.equal(standaloneSaleGroup.totalCredit, 200);
assert.ok(standaloneSaleGroup.lines.some(line => line.accountName === 'Office Supplies Expense' && line.debit === 200));
assert.ok(standaloneSaleGroup.lines.some(line => line.accountName === 'Cash' && line.credit === 200));

const ordinaryMom = await run('standalone-mom-advice',
  'An employee resigned after serving notice. When is outstanding salary due and when must we issue the payslip?');
assert.deepEqual(ordinaryMom.response.scenarioState.directGroups || [], [],
  'Standalone MOM guidance does not create an accounting journal.');
assert.match(ordinaryMom.response.messageText, /within three working days of payment/i);

mkdirSync('artifacts/statutory-cpf-development-20261101', { recursive: true });
writeFileSync('artifacts/statutory-cpf-development-20261101/mixed-after.json', JSON.stringify(captured, null, 2));
console.log(`Mixed sales/MOM journal safety passed (${mixedCases.length} routed mixed cases, reviewer variants, tax clause orders, prior payroll context, standalone controls).`);
