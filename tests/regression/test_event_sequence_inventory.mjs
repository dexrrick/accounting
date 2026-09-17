import assert from 'node:assert/strict';
import { extractEventSequence, resolveEventSequence, resolveInventoryEventSequence } from '../../src/engine/eventSequence.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';

const narrative = [
  'Transaction 1 (5 Oct): Purchased 100 units of merchandise on credit from Supplier Alpha at SGD 50 each, subject to 9% GST. Credit terms are 2/10, n/30. Orion records purchases using the gross method.',
  'Transaction 2 (8 Oct): Returned 10 damaged units from the 5 Oct purchase back to Supplier Alpha, receiving a full credit note including the applicable GST.',
  'Transaction 3 (12 Oct): Settled the full outstanding balance owed to Supplier Alpha via bank transfer, qualifying for and taking the early settlement discount (the cash discount applies to the net merchandise amount before GST; GST is adjusted accordingly).',
  'Transaction 4 (15 Oct): Sold 40 units of this merchandise to Customer Bravo on credit for SGD 110 each, plus 9% GST. Assume FIFO cost allocation; cost per unit remains SGD 50.',
  'Transaction 5 (18 Oct): Customer Bravo reported minor defects on 5 units but agreed to keep them after Orion granted a credit allowance of SGD 20 per unit (plus 9% GST) on the invoice balance.'
].join('\n');

const sequence = extractEventSequence(narrative);
assert.ok(sequence, 'dated related events should be extracted as a sequence');
assert.deepEqual(sequence.events.map(event => event.type), ['purchase', 'purchase_return', 'supplier_settlement', 'sale', 'credit_note']);
assert.deepEqual(sequence.events[1].relatesTo, ['event-1']);
assert.deepEqual(sequence.events[2].relatesTo, ['event-1']);

const resolution = resolveInventoryEventSequence(sequence);
assert.equal(resolution.clarifications.length, 0);
assert.equal(resolution.groups.length, 5);
for (const group of resolution.groups) assert.equal(group.isBalanced, true, `${group.id} must balance`);
assert.deepEqual(resolution.groups.map(group => [group.totalDebit, group.totalCredit]), [[5450, 5450], [545, 545], [4905, 4905], [6796, 6796], [109, 109]]);
assert.deepEqual(resolution.groups[2].lines.map(line => [line.accountName, line.debit, line.credit]), [['Accounts Payable', 4905, 0], ['Cash at Bank', 0, 4806.9], ['Inventory', 0, 90], ['Input GST receivable', 0, 8.1]]);

const routed = await processAccountingQuery(narrative, null, 'SFRS_I', undefined, undefined, [], { journal: true, statutory: false });
assert.equal(routed.scenarioState.directGroups?.length, 5, 'Double Entry Journal routing should retain the event chronology');
assert.equal(routed.scenarioState.isComplete, true);

// Different vocabulary, rates, quantities, discount terms and parties prove
// that resolution is driven by normalized facts rather than the example text.
const alternateSequence = extractEventSequence([
  '1 Dec: Bought 24 widgets on credit from supplier Delta at SGD 25 each, plus 8% GST. Terms 1.5/15, n/45.',
  '4 Dec: Returned 4 units to Delta for a full credit.',
  '10 Dec: Paid the full outstanding supplier invoice and took the settlement discount.',
  '14 Dec: Sold 10 widgets to customer Echo on credit for SGD 60 each plus 8% GST.',
  '16 Dec: Issued Echo an allowance of SGD 5 per unit for 2 defective widgets, plus 8% GST.'
].join('\n'));
assert.ok(alternateSequence);
const alternateResolution = resolveInventoryEventSequence(alternateSequence);
assert.equal(alternateResolution.clarifications.length, 0);
assert.deepEqual(alternateResolution.groups.map(group => [group.totalDebit, group.totalCredit]), [[648, 648], [108, 108], [540, 540], [898, 898], [10.8, 10.8]]);

const generatedCommercialQuestions = [
  '1 Mar: Purchased 3 widgets on credit from supplier A at SGD 40 each plus 9% GST.\n2 Mar: Returned 1 widget to supplier A for a full credit.',
  '1 Apr: Bought 8 goods on credit from vendor B at SGD 15 each plus 7% GST.\n2 Apr: Sold 2 goods to customer C on credit for SGD 30 each plus 7% GST.'
];
for (const question of generatedCommercialQuestions) {
  const resolved = resolveEventSequence(question);
  assert.equal(resolved?.family, 'commercial_goods');
  assert.ok(resolved?.groups.every(group => group.isBalanced));
}
assert.equal(resolveEventSequence('1 May: Accrued payroll.\n31 May: Paid salaries.'), undefined, 'unsupported families must fall through rather than receive an incorrect commercial journal');
console.log('PASS | inventory event sequence is extracted, reconciled, balanced, and routed before generic clarification');
