import assert from 'node:assert/strict';
import { extractEventSequence, resolveInventoryEventSequence } from '../../src/engine/eventSequence.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';

const narrative = [
  '05/10/2026 Purchased inventory on credit from Alpha Supplies for SGD 1,000.',
  '10/10/2026 Returned inventory costing SGD 200 to the supplier.',
  '15/10/2026 Paid the supplier SGD 800.'
].join('\n');

const sequence = extractEventSequence(narrative);
assert.ok(sequence, 'dated related events should be extracted as a sequence');
assert.deepEqual(sequence.events.map(event => event.type), ['purchase', 'purchase_return', 'supplier_settlement']);
assert.deepEqual(sequence.events[1].relatesTo, ['event-1']);
assert.deepEqual(sequence.events[2].relatesTo, ['event-1']);

const resolution = resolveInventoryEventSequence(sequence);
assert.equal(resolution.clarifications.length, 0);
assert.equal(resolution.groups.length, 3);
for (const group of resolution.groups) assert.equal(group.isBalanced, true, `${group.id} must balance`);
assert.deepEqual(resolution.groups.map(group => [group.totalDebit, group.totalCredit]), [[1000, 1000], [200, 200], [800, 800]]);

const routed = await processAccountingQuery(narrative, null, 'SFRS_I', undefined, undefined, [], { journal: true, statutory: false });
assert.equal(routed.scenarioState.directGroups?.length, 3, 'Double Entry Journal routing should retain the event chronology');
assert.equal(routed.scenarioState.isComplete, true);
console.log('PASS | inventory event sequence is extracted, reconciled, balanced, and routed before generic clarification');
