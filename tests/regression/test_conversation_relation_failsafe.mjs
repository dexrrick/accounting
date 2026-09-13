import assert from 'node:assert/strict';
import { assessConversationRelation } from '../../src/services/conversationBoundary.ts';

const complete = { scenarioType: 'GENERAL_EXPENSE', rawQuery: 'Paid office rent of SGD 2,000', transactionTitle: 'Rent', functionalCurrency: 'SGD', transactionCurrency: 'SGD', isComplete: true, missingFields: [], directGroups: [] };
const pending = { ...complete, isComplete: false, missingFields: [{ fieldKey: 'amount', fieldName: 'Amount', prompt: 'Amount?', whyNeeded: 'Required' }] };

assert.equal(assessConversationRelation('2000', pending), 'RELATED');
assert.equal(assessConversationRelation("what's the double entry", complete), 'RELATED');
assert.equal(assessConversationRelation('We paid a supplier $5,000 for consulting services', complete), 'AMBIGUOUS');
assert.equal(assessConversationRelation('This is a new question: how do I account for a new machine bought for $5,000?', complete), 'NEW');
console.log('PASS | Conversation relation failsafe only prompts for genuinely ambiguous transaction narratives');
