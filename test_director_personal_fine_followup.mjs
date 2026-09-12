import assert from 'node:assert/strict';
import { parseAccountingQuery } from './src/engine/scenarioParser.ts';
import { processAccountingQuery } from './src/services/geminiService.ts';

const missingAmount = await parseAccountingQuery(
  'What if the company paid the fine on behalf of the director and intends to recover it from him?',
  null
);
assert.equal(missingAmount.scenarioType, 'DIRECTOR_PERSONAL_FINE');
assert.equal(missingAmount.isComplete, false);

const completed = await parseAccountingQuery('2000', missingAmount);
assert.equal(completed.scenarioType, 'DIRECTOR_PERSONAL_FINE');
assert.equal(completed.amount, 2000);
assert.equal(completed.directGroups?.length, 1);
assert.equal(completed.directGroups?.[0].lines[0].accountName, 'Amount Due from Director');
assert.equal(completed.directGroups?.[0].lines[1].accountName, 'Cash at Bank');

const rephrased = await parseAccountingQuery(
  'What if the company paid the fine on behalf of the director and intends to recover it from him?',
  completed
);
assert.equal(rephrased.amount, 2000);
assert.equal(rephrased.directGroups?.length, 1);

const displayed = await processAccountingQuery("what's the double entry", rephrased, 'SFRS_I');
assert.equal(displayed.scenarioState.directGroups?.length, 1);
assert.match(displayed.messageText, /Double Entry Journal/i);
console.log('PASS | Director personal fine retains amount and journal across clarification and display follow-ups');
