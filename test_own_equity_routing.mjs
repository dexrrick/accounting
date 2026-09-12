import assert from 'node:assert/strict';
import { parseAccountingQuery } from './src/engine/scenarioParser.ts';

console.log('=== RUNNING OWN-EQUITY ROUTING REGRESSION ===\n');

const result = await parseAccountingQuery(
  "owner of the company invested $100 into his own company but non monetary payment has been made what's the double entry"
);

assert.equal(result.scenarioType, 'SHARE_CAPITAL_PAID');
assert.equal(result.amount, 100);
assert.notEqual(result.transactionTitle.includes('Payroll'), true, 'own-equity contribution must never route to payroll');
const group = result.directGroups?.[0];
assert.ok(group);
assert.equal(group.isBalanced, true);
assert.ok(group.lines.some(line => line.accountName === 'Share Capital' && line.credit === 100));
assert.ok(group.lines.some(line => line.accountName.includes('Non-Cash Asset Received') && line.debit === 100));
assert.ok(!group.lines.some(line => line.accountName.includes('CPF')));

console.log('✓ own-equity non-cash contribution routes to a conditional share-capital entry, never payroll.');
