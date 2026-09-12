import assert from 'node:assert/strict';
import { parseAccountingQuery } from './src/engine/scenarioParser.ts';
import { processAccountingQuery } from './src/services/geminiService.ts';

console.log('=== RUNNING SHARE CAPITAL PAYMENT FOLLOW-UP SUITE ===\n');

const ambiguous = await parseAccountingQuery(
  "owner of the company invested $100 into his own company but non monetary payment has been made what's the double entry"
);
assert.equal(ambiguous.directGroups?.length, 0, 'ambiguous consideration must not produce a fabricated entry');
assert.match(ambiguous.missingFields?.[0]?.prompt || '', /no monetary payment|non-cash consideration/i);

const issuedUnpaid = await parseAccountingQuery(
  "owner of the company invested $100 into his own company but no monetary payment has been made what's the double entry"
);
assert.equal(issuedUnpaid.scenarioType, 'SHARE_CAPITAL_UNPAID');
assert.equal(issuedUnpaid.directGroups?.[0]?.isBalanced, true);
assert.ok(issuedUnpaid.transactionId, 'initial share subscription must retain an authoritative transaction ID');
assert.equal(issuedUnpaid.directGroups?.[0]?.transactionId, issuedUnpaid.transactionId);
assert.ok(issuedUnpaid.directGroups?.[0]?.lines.some(line => line.accountName.includes('Amount Due from Shareholder') && line.debit === 100));

const settlement = await parseAccountingQuery(
  "later the shareholder made payment to company bank what's the double entry",
  issuedUnpaid
);
const settlementGroup = settlement.directGroups?.at(-1);
assert.ok(settlementGroup, 'full outstanding settlement must create a journal group');
assert.equal(settlementGroup.isBalanced, true);
assert.ok(settlementGroup.lines.some(line => line.accountName.includes('Cash at Bank') && line.debit === 100));
assert.ok(settlementGroup.lines.some(line => line.accountName.includes('Amount Due from Shareholder') && line.credit === 100));
assert.ok(!settlementGroup.lines.some(line => line.accountName === 'Share Capital' && line.credit > 0));

const repeatedJournal = await processAccountingQuery(
  'where is your double entry?',
  settlement,
  'SFRS_I'
);
assert.equal(repeatedJournal.scenarioState.directGroups?.at(-1)?.id, settlementGroup.id,
  'a request to repeat a journal must preserve the calculated settlement, not synthesize a new transaction');
assert.ok(!repeatedJournal.scenarioState.directGroups?.some(group =>
  group.lines.some(line => /entertainment|hospitality/i.test(line.accountName))
), 'a repeated settlement journal must never fall back to a generic expense');

console.log('✓ ambiguous wording clarifies; unpaid subscription then full bank settlement posts correctly and can be repeated safely.');
