import assert from 'node:assert/strict';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import { calculateDoubleEntries } from '../../src/engine/accountingEngine.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';

const cases = [
  ['How would you record a cash withdrawal of SGD 500 from the business bank account into the petty cash box?', 'Petty Cash', 'Cash at Bank', 500],
  ['How do I record a bank transfer of SGD 1,000 from the current account to the savings account?', 'Savings Account', 'Current Account', 1000],
  ['Pay SGD 500 rent in cash', 'Rent Expense', 'Cash', 500],
  ['We sold goods for SGD 1,000 on credit. Record the journal entry.', 'Trade Receivables', 'Revenue', 1000],
  ['Record the receipt of SGD 2,000 from a customer settling an invoice', 'Cash at Bank', 'Trade Receivables', 2000],
  ['Record a loan of SGD 10,000 from the bank', 'Cash at Bank', 'Bank Loan', 10000],
  ['Record a purchase of office supplies for SGD 200 paid in cash', 'Office Supplies Expense', 'Cash', 200],
  ['Give me the journal entry for a cash withdrawal of SGD 500 into petty cash from the business bank', 'Petty Cash', 'Cash at Bank', 500]
];
const run = async (question, expectedDebit, expectedCredit, amount) => {
  const parsed = await parseAccountingQuery(question, null);
  assert.equal(parsed.scenarioType, 'BASIC_BOOKKEEPING', question);
  assert.equal(parsed.missingFields.length, 0, question);
  const groups = calculateDoubleEntries(parsed, 'SFRS_I').groups;
  assert.equal(groups.length, 1, question);
  const group = groups[0];
  assert.equal(group.lines[0].accountName, expectedDebit, question);
  assert.equal(group.lines[1].accountName, expectedCredit, question);
  assert.equal(group.lines[0].debit, amount, question);
  assert.equal(group.lines[1].credit, amount, question);
  assert.equal(group.totalDebit, group.totalCredit, question);
  assert.equal(group.isBalanced, true, question);
  const displayed = await processAccountingQuery(question, null, 'SFRS_I');
  assert.equal(displayed.scenarioState.directGroups?.[0]?.totalDebit, amount, question);
};
for (const row of cases) await run(...row);
for (let i = 1; i <= 40; i++) {
  const cents = i * 7919;
  await run('Withdraw SGD ' + (cents / 100).toFixed(2) + ' from business bank into petty cash box', 'Petty Cash', 'Cash at Bank', cents / 100);
}
const missing = await parseAccountingQuery('Record a bank transfer', null);
assert.equal(missing.scenarioType, 'BASIC_BOOKKEEPING');
assert.deepEqual(new Set(missing.missingFields.map(f => f.fieldKey)), new Set(['amount', 'sourceAccount', 'destinationAccount']));
const lease = await parseAccountingQuery('3-year office lease, SGD 1,000/month, 5% rate', null);
assert.equal(lease.scenarioType, 'LEASE_IFRS16');
assert.equal(lease.leaseTermMonths, 36);
assert.ok(calculateDoubleEntries(lease, 'SFRS_I').groups.length > 0);
const unknown = await processAccountingQuery('Record an unknown transaction SGD 500', null, 'SFRS_I');
assert.match(unknown.messageText, /not supported|clarification/i);
console.log('PASS | Basic bookkeeping journals, property-style amount checks, lease routing and offline failure');
