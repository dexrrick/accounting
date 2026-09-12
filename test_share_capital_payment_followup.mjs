import assert from 'node:assert/strict';
import { parseAccountingQuery } from './src/engine/scenarioParser.ts';
import { processAccountingQuery } from './src/services/geminiService.ts';
import { calculateDoubleEntries } from './src/engine/accountingEngine.ts';
import { calculateAccountingDelta } from './src/services/conversationAccountingState.ts';
import { buildGroundedReasoningContext, postProcessAIResponse } from './src/services/groundingContextBuilder.ts';

console.log('=== RUNNING SHARE CAPITAL PAYMENT FOLLOW-UP SUITE ===\n');

const ambiguous = await parseAccountingQuery(
  "owner of the company invested $100 into his own company but non monetary payment has been made what's the double entry"
);
assert.equal(ambiguous.directGroups?.length, 0, 'ambiguous consideration must not produce a fabricated entry');
assert.match(ambiguous.missingFields?.[0]?.prompt || '', /no monetary payment|non-cash consideration/i);
assert.equal(calculateDoubleEntries(ambiguous, 'SFRS_I').groups.length, 0,
  'the UI calculator must not turn a clarification into an entertainment expense');

const missingShareAmount = await parseAccountingQuery('owner subscribed for shares in his own company but has not paid');
assert.equal(missingShareAmount.directGroups?.length, 0, 'missing share amount must not create a zero-amount journal');
assert.equal(missingShareAmount.missingFields?.[0]?.fieldKey, 'amount');
const suppliedShareAmount = await parseAccountingQuery('SGD 100', missingShareAmount);
assert.equal(suppliedShareAmount.directGroups?.[0]?.totalDebit, 100, 'a short amount answer must complete the share journal');

const missingPaymentStatus = await parseAccountingQuery('owner invested $100 into his own company');
assert.equal(missingPaymentStatus.directGroups?.length, 0, 'payment status must not default to unpaid');
assert.equal(missingPaymentStatus.missingFields?.[0]?.fieldKey, 'paymentStatus');
const suppliedPaymentStatus = await parseAccountingQuery('It is still unpaid', missingPaymentStatus);
assert.ok(suppliedPaymentStatus.directGroups?.[0]?.lines.some(line =>
  line.accountName.includes('Amount Due from Shareholder') && line.debit === 100
), 'a short payment-status answer must complete the receivable entry');

const missingExpenseAmount = await parseAccountingQuery('company paid for entertainment expenses from bank');
assert.equal(missingExpenseAmount.scenarioType, 'GENERAL_EXPENSE');
assert.equal(calculateDoubleEntries(missingExpenseAmount, 'SFRS_I').groups.length, 0,
  'missing expense amount must not default to a fabricated amount');
const suppliedExpenseAmount = await parseAccountingQuery('SGD 100', missingExpenseAmount);
assert.equal(calculateDoubleEntries(suppliedExpenseAmount, 'SFRS_I').groups[0]?.totalDebit, 100);

const clarifiedUnpaid = await parseAccountingQuery('I meant no monetary payment has been made', ambiguous);
assert.equal(clarifiedUnpaid.scenarioType, 'SHARE_CAPITAL_UNPAID');
assert.ok(clarifiedUnpaid.directGroups?.[0]?.lines.some(line => line.category === 'ASSET' && line.debit === 100));

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

const hostileAiPayload = {
  scenarioType: 'UNIVERSAL',
  transactionTitle: 'Shareholder settlement',
  messageText: 'The shareholder paid the outstanding amount.',
  directGroups: [{
    id: 'grp-incorrect-ai-entry', title: 'Unrelated AI entry',
    lines: [
      { id: 'wrong-debit', accountCode: '5000', accountName: 'Entertainment & Hospitality Expenses', category: 'EXPENSE', debit: 100, credit: 0 },
      { id: 'wrong-credit', accountCode: '1000', accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 100 }
    ]
  }]
};
const followUpQuery = 'later the shareholder made payment to company bank what is the double entry';
const grounded = await buildGroundedReasoningContext(followUpQuery, issuedUnpaid);
const settlementGrounding = {
  ...grounded,
  semanticUnderstanding: {
    ...grounded.semanticUnderstanding,
    followUpAnalysis: {
      eventType: 'settlement', isFollowUp: true, isHypothetical: false,
      settlementAmount: 100,
      targetTransactionId: issuedUnpaid.transactionId,
      targetCriteria: { transactionId: issuedUnpaid.transactionId, nature: 'RECEIVABLE', counterpartyRole: 'shareholder' }
    }
  }
};
const guardedSettlement = postProcessAIResponse(
  hostileAiPayload, issuedUnpaid, followUpQuery, settlementGrounding, settlement
);
const guardedGroup = guardedSettlement.scenarioState.directGroups?.at(-1);
assert.ok(guardedGroup?.lines.some(line => line.accountName.includes('Cash at Bank') && line.debit === 100));
assert.ok(guardedGroup?.lines.some(line => line.accountName.includes('Amount Due from Shareholder') && line.credit === 100));
assert.ok(!guardedGroup?.lines.some(line => /entertainment/i.test(line.accountName)),
  'an AI journal must not override the committed receivable settlement');
assert.equal(guardedGroup?.transactionId, guardedSettlement.scenarioState.actualEvents?.at(-1)?.transactionId,
  'displayed journal and committed event must share the same transaction ID');

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

const payable = {
  balanceKey: '2010_supplier_tx-payable-1', accountCode: '2010', accountName: 'Trade Payables',
  category: 'LIABILITY', nature: 'PAYABLE', counterpartyRole: 'supplier',
  transactionId: 'tx-payable-1', originalAmount: 100, settledAmount: 0,
  remainingAmount: 100, currency: 'SGD'
};
const payableContext = {
  outstandingBalances: [payable], actualEvents: [], events: [], priorJournals: [], recognizedEquityTotal: 0
};
assert.equal(calculateAccountingDelta(payableContext, {
  eventType: 'settlement', isFollowUp: true, settlementAmount: 150,
  targetCriteria: { counterpartyRole: 'supplier', nature: 'PAYABLE' }
}, 'SGD'), null, 'an excess payment requires a diagnostic, not an imbalanced journal');
const paidPayable = calculateAccountingDelta(payableContext, {
  eventType: 'settlement', isFollowUp: true, settlementAmount: 100,
  targetTransactionId: 'tx-payable-1', targetCriteria: { counterpartyRole: 'supplier', nature: 'PAYABLE' }
}, 'SGD');
assert.ok(paidPayable);
assert.equal(paidPayable.journalLines.reduce((sum, line) => sum + line.debit, 0), 100);
assert.equal(paidPayable.journalLines.reduce((sum, line) => sum + line.credit, 0), 100);
assert.ok(!paidPayable.explanation.includes('Share Capital'));
assert.equal(calculateAccountingDelta(payableContext, {
  eventType: 'settlement', isFollowUp: true, settlementAmount: 100,
  targetTransactionId: 'tx-other', targetCriteria: { counterpartyRole: 'supplier', nature: 'PAYABLE' }
}, 'SGD'), null, 'a different transaction ID must not settle this payable');

console.log('✓ clarification, journal display, payable balance, and settlement target invariants passed.');
