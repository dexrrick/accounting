import assert from 'node:assert/strict';
import { startsNewAccountingScenario } from './src/services/conversationBoundary.ts';

const context = { underlyingTransaction: { type: 'operating_expense' }, outstandingBalances: [{ accountName: 'Trade Payables', remainingAmount: 1200 }] };
assert.equal(startsNewAccountingScenario('My company paid a $2,000 fine imposed on a director for a personal traffic offence.', null, context), true);
console.log('PASS | Personal director fine is a new scenario, not settlement of a prior balance');
