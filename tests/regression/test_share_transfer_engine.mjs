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
console.log('PASS | Group share exchange preserves each company issued shares and calculates before/after holdings');
