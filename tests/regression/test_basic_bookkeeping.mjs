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
// Live issue: customer invoice settlement must not be captured as an internal bank transfer.
const customerPayment = "What's the journal entry when the business receives a bank transfer of SGD 1,800 from that customer settling their invoice?";
await run(customerPayment, 'Cash at Bank', 'Trade Receivables', 1800);
await run('The customer paid their outstanding invoice of SGD 1,800 by bank transfer.', 'Cash at Bank', 'Trade Receivables', 1800);
for (const wording of [
  'We paid SGD 1,800 to our customer by bank transfer for an outstanding invoice.',
  'We paid the customer invoice of SGD 1,800 by bank transfer.',
  'The invoice for our customer was paid by bank transfer.',
  'We paid SGD 1,800 to a customer by bank transfer to refund their invoice.'
]) {
  const outgoingCustomerPayment = await parseAccountingQuery(wording, null);
  assert.ok(!outgoingCustomerPayment.directGroups?.some(group => ['basic-customer_receipt', 'basic-bank_transfer'].includes(group.id)), wording);
}
const prior = await parseAccountingQuery('If the owner takes SGD 300 cash from the business for personal use, what is the correct debit and credit entry', null);
assert.equal(prior.scenarioType, 'BASIC_BOOKKEEPING');
assert.deepEqual(prior.missingFields.map(field => field.fieldKey), ['entityType']);
assert.equal(prior.directGroups?.length, 0);
const soleProprietorReply = await parseAccountingQuery('It is a sole proprietorship.', prior);
assert.deepEqual(soleProprietorReply.directGroups?.[0]?.lines.map(line => line.accountName), ["Owner's Drawings", 'Cash']);
assert.equal(soleProprietorReply.directGroups?.[0]?.totalDebit, 300);
assert.equal(soleProprietorReply.directGroups?.[0]?.isBalanced, true);
const companyReply = await parseAccountingQuery('It is a company.', prior);
assert.equal(companyReply.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(companyReply.amount, 300);
assert.equal(companyReply.directGroups?.length, 0);
assert.ok(companyReply.missingFields.some(field => field.fieldKey === 'entityType'));
const processSoleProprietorReply = await processAccountingQuery('It is a sole proprietorship.', prior, 'SFRS_I');
assert.equal(processSoleProprietorReply.scenarioState.directGroups?.[0]?.totalDebit, 300);
const actual = await processAccountingQuery(customerPayment, prior, 'SFRS_I');
assert.equal(actual.scenarioState.scenarioType, 'BASIC_BOOKKEEPING');
assert.deepEqual(actual.scenarioState.directGroups?.[0]?.lines.map(line => line.accountName), ['Cash at Bank', 'Trade Receivables']);
assert.equal(actual.scenarioState.directGroups?.[0]?.totalDebit, 1800);
const owner = await parseAccountingQuery('The sole proprietor takes SGD 300 cash from the business for personal use', null);
assert.equal(owner.scenarioType, 'BASIC_BOOKKEEPING');
assert.deepEqual(owner.directGroups?.[0]?.lines.map(line => line.accountName), ["Owner's Drawings", 'Cash']);
assert.equal(owner.directGroups?.[0]?.totalDebit, 300);
const missingDrawingsPaymentSource = await parseAccountingQuery('The sole proprietor takes SGD 300 from the business for personal use', null);
assert.ok(missingDrawingsPaymentSource.missingFields.some(field => field.fieldKey === 'paymentAccount'));
const bankSourceReply = await parseAccountingQuery('Business bank.', missingDrawingsPaymentSource);
assert.deepEqual(bankSourceReply.directGroups?.[0]?.lines.map(line => line.accountName), ["Owner's Drawings", 'Cash at Bank']);
assert.equal(bankSourceReply.directGroups?.[0]?.totalDebit, 300);
assert.equal(bankSourceReply.directGroups?.[0]?.isBalanced, true);
const pettyCashTransfer = await parseAccountingQuery('The sole proprietor withdrew SGD 500 from the business bank into petty cash.', null);
assert.equal(pettyCashTransfer.scenarioType, 'BASIC_BOOKKEEPING');
assert.deepEqual(pettyCashTransfer.directGroups?.[0]?.lines.map(line => line.accountName), ['Petty Cash', 'Cash at Bank']);
const ownerCompany = await parseAccountingQuery('The company owner takes SGD 300 cash from the business for personal use', null);
assert.equal(ownerCompany.directGroups?.length, 0);
assert.ok(ownerCompany.missingFields.some(field => field.fieldKey === 'entityType'));
const companyConflict = await parseAccountingQuery('Sole proprietorship.', ownerCompany);
assert.equal(companyConflict.directGroups?.length, 0);
assert.ok(companyConflict.missingFields.some(field => field.fieldKey === 'entityType'));
const literalPrompt = await processAccountingQuery('Record a bank transfer', null, 'SFRS_I', '', 'gemini-3.5-flash-lite', [], {journal:true, statutory:false});
assert.ok(!literalPrompt.messageText.includes('\\n'), 'Prompts must use newlines, not literal backslash-n');
const unknownJournal = await processAccountingQuery('What is the double entry for an unknown transaction?', null, 'SFRS_I');
assert.ok(unknownJournal.messageText.startsWith('### Clarification Required for Double Entry\n\n'));
assert.ok(!unknownJournal.messageText.includes('\\n'), 'Clarifications must use newlines, not literal backslash-n');

// A question describing debit/credit accounts is a journal request even without
// the literal words "journal entry". No inventory cost is supplied here.
const creditQuestion = 'If a company sells inventory for SGD 1,800 to a customer on 30 days credit, which account gets debited and which gets credited?';
await run(creditQuestion, 'Trade Receivables', 'Revenue', 1800);
const unrelatedCustomerQuery = await parseAccountingQuery('We sold goods to a customer on 30 days credit for SGD 1,800.', prior);
assert.deepEqual(unrelatedCustomerQuery.directGroups?.[0]?.lines.map(line => line.accountName), ['Trade Receivables', 'Revenue']);
const creditResponse = await processAccountingQuery(creditQuestion, null, 'SFRS_I');
assert.equal(creditResponse.scenarioState.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(creditResponse.scenarioState.directGroups?.length, 1);
assert.equal(creditResponse.scenarioState.directGroups?.[0].isBalanced, true);
assert.match(creditResponse.messageText, /Cost of Goods Sold/i);
assert.match(creditResponse.messageText, /carrying cost/i);
for (const wording of [
  'The company sells goods on 30 days credit for SGD 1,800. Which accounts do I debit and credit?',
  'We sold inventory on 30-day credit terms for SGD 1,800. Give the journal entry.',
  'Sell products for SGD 1,800 on credit to a customer. Record the double entry.'
]) {
  await run(wording, 'Trade Receivables', 'Revenue', 1800);
}

// A trailing full stop is sentence punctuation, not an unfinished decimal.
for (const ending of ['.', '. Give the journal entry.', '. Which account is debited?']) {
  await run('We sold goods for SGD 1,800 on credit' + ending, 'Trade Receivables', 'Revenue', 1800);
}
const rounded = await parseAccountingQuery('We sold goods for SGD 1,800.50 on credit.', null);
assert.equal(rounded.directGroups?.[0]?.totalDebit, 1800.5);
const invalidPrecision = await parseAccountingQuery('We sold goods for SGD 1,800.123 on credit.', null);
assert.ok(invalidPrecision.missingFields.some(field => field.fieldKey === 'amount'));
assert.equal(invalidPrecision.directGroups?.length, 0);

const missing = await parseAccountingQuery('Record a bank transfer', null);
assert.equal(missing.scenarioType, 'BASIC_BOOKKEEPING');
assert.deepEqual(new Set(missing.missingFields.map(f => f.fieldKey)), new Set(['amount', 'sourceAccount', 'destinationAccount']));
const lease = await parseAccountingQuery('3-year office lease, SGD 1,000/month, 5% rate', null);
assert.equal(lease.scenarioType, 'LEASE_IFRS16');
assert.equal(lease.leaseTermMonths, 36);
assert.ok(calculateDoubleEntries(lease, 'SFRS_I').groups.length > 0);
for (const phrasing of ['3 year office lease, SGD 1,000/month, 5% rate', '36-month office lease, SGD 1,000/month, 5% rate']) {
  const variant = await parseAccountingQuery(phrasing, null);
  assert.equal(variant.scenarioType, 'LEASE_IFRS16', phrasing);
  assert.equal(variant.leaseTermMonths, 36, phrasing);
  assert.ok(calculateDoubleEntries(variant, 'SFRS_I').groups.length > 0, phrasing);
}
const unknown = await processAccountingQuery('Record an unknown transaction SGD 500', null, 'SFRS_I');
assert.match(unknown.messageText, /not supported|clarification/i);
console.log('PASS | Basic bookkeeping journals, property-style amount checks, lease routing and offline failure');
