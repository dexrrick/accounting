import assert from 'node:assert/strict';
import { parseAccountingQuery } from './src/engine/scenarioParser.ts';

console.log('=== RUNNING PAYROLL FOLLOW-UP CORRECTION SUITE ===\n');

const initial = await parseAccountingQuery(
  "I have staff is 60 years old Singaporean earning 10k a month what's the double entry for all salary related journal"
);

assert.equal(initial.scenarioType, 'PAYROLL_CPF_SALARY');
assert.equal(initial.amount, 10000, '10k must be parsed as SGD 10,000, not 10');
assert.equal(initial.directGroups?.[0]?.isBalanced, true);

const corrected = await parseAccountingQuery('I mean 10,000 a month', initial);
assert.equal(corrected.scenarioType, 'PAYROLL_CPF_SALARY', 'amount correction must retain payroll routing');
assert.equal(corrected.amount, 10000);

const group = corrected.directGroups?.[0];
assert.ok(group, 'a corrected payroll request must produce a journal group');
assert.equal(group.isBalanced, true);
assert.equal(group.totalDebit, 11291.25);
assert.equal(group.totalCredit, 11291.25);

const lines = group.lines;
const line = (fragment) => lines.find(item => item.accountName.includes(fragment));
assert.equal(line('Staff Salaries')?.debit, 10000);
assert.equal(line('Employer CPF')?.debit, 1280, '2026 employer CPF for age 60 is 16% of the SGD 8,000 OW ceiling');
assert.equal(line('CPF Payable')?.credit, 2720, '2026 total CPF is 34% of the SGD 8,000 OW ceiling');
assert.equal(line('Net Salaries Payable')?.credit, 8560);
assert.equal(line('Skills Development Levy (Operating Expense)')?.debit, 11.25);
assert.equal(line('Skills Development Levy Payable')?.credit, 11.25);

console.log('✓ 10k parsing, context-aware correction, 2026 senior CPF and SDL journal entries passed.');
