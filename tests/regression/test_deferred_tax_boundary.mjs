import assert from 'node:assert/strict';
import { assessConversationRelation } from '../../src/services/conversationBoundary.ts';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';

const question = 'How are deferred tax liabilities treated when an entity claims an upfront 100% tax depreciation or accelerated write-off on qualifying plant and machinery while depreciating the asset over several years for accounting purposes?';
const previousPpe = {
  scenarioType: 'PPE_IAS16', rawQuery: 'Purchased machinery for SGD 100,000',
  transactionTitle: 'Machinery Acquisition with Trade-In & Equipment Loan',
  functionalCurrency: 'SGD', transactionCurrency: 'SGD', isComplete: true,
  directGroups: [{ id: 'old-ppe', title: 'Old machinery purchase', eventDate: '01/01/2025', lines: [], totalDebit: 100000, totalCredit: 100000, isBalanced: true }]
};

assert.equal(assessConversationRelation(question, previousPpe), 'NEW');
for (const prior of [null, previousPpe]) {
  const parsed = await parseAccountingQuery(question, prior);
  assert.equal(parsed.scenarioType, 'DEFERRED_TAX_IAS12');
  assert.equal(parsed.primaryDomain, 'ACCOUNTING_SFRS');
  assert.deepEqual(parsed.directGroups, []);

  const response = await processAccountingQuery(question, prior, 'SFRS_I', undefined, 'gemini-3.5-flash-lite', [], { journal: true, statutory: false });
  assert.equal(response.scenarioState.scenarioType, 'DEFERRED_TAX_IAS12');
  assert.deepEqual(response.scenarioState.directGroups, []);
  assert.match(response.messageText, /SFRS\(I\) 1-12 \(Income Taxes\)/);
  assert.match(response.messageText, /Deferred Tax Liability/);
  assert.doesNotMatch(response.messageText, /Machinery Acquisition with Trade-In|100,000/);
}

console.log('PASS | deferred-tax inquiry uses SFRS(I) 1-12 without stale PPE journals');
