import assert from 'node:assert/strict';
import { calculateShareTransfers } from '../../src/engine/shareTransferEngine.ts';

const result = calculateShareTransfers([
  { company: 'Company C', shareClass: 'Ordinary', positions: [{ holder: 'Company A', shares: 600 }, { holder: 'Founder', shares: 400 }] },
  { company: 'Company B', shareClass: 'Ordinary', positions: [{ holder: 'Company B', shares: 500 }, { holder: 'Investor', shares: 500 }] }
], [
  { company: 'Company C', from: 'Company A', to: 'Company B', shares: 300 },
  { company: 'Company B', from: 'Company B', to: 'Company A', shares: 200 }
]);
assert.deepEqual(result.errors, []);
assert.deepEqual(result.changes.map(change => [change.company, change.holder, change.afterShares, change.afterPercent]), [
  ['Company C', 'Company A', 300, 30], ['Company C', 'Company B', 300, 30],
  ['Company B', 'Company B', 300, 30], ['Company B', 'Company A', 200, 20]
]);
assert.equal(result.tables[0].positions.reduce((sum, position) => sum + position.shares, 0), 1000);
assert.equal(result.tables[1].positions.reduce((sum, position) => sum + position.shares, 0), 1000);

const multiParty = calculateShareTransfers([
  { company: 'HoldCo', shareClass: 'Ordinary', positions: [{ holder: 'Alice', shares: 40 }, { holder: 'Bob', shares: 30 }, { holder: 'Fund X', shares: 30 }] },
  { company: 'OpCo', shareClass: 'Preference', positions: [{ holder: 'HoldCo', shares: 100 }, { holder: 'Carol', shares: 100 }] },
  { company: 'NewCo', shareClass: 'Ordinary', positions: [{ holder: 'Fund X', shares: 50 }, { holder: 'Dave', shares: 50 }] }
], [
  { company: 'HoldCo', from: 'Alice', to: 'Fund X', shares: 10 },
  { company: 'OpCo', shareClass: 'Preference', from: 'Carol', to: 'HoldCo', shares: 25 },
  { company: 'NewCo', from: 'Fund X', to: 'Alice', shares: 15 }
]);
assert.deepEqual(multiParty.errors, []);
assert.equal(multiParty.changes.length, 6);
console.log('PASS | Group share exchange preserves each company issued shares and calculates before/after holdings');
