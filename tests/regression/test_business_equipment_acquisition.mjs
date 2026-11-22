import assert from 'node:assert/strict';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';

const result = await parseAccountingQuery('My company incurred $50,000 on a piece of equipment. Give me the journal entry and tell me whether it is tax deductible.', null);
assert.equal(result.scenarioType, 'BUSINESS_EQUIPMENT_ACQUISITION');
assert.equal(result.directGroups?.length, 1);
assert.equal(result.directGroups?.[0].totalDebit, 50000);
assert.equal(result.directGroups?.[0].lines[0].accountName, 'Property, Plant and Equipment — Equipment');
assert.equal(result.directGroups?.[0].lines[1].accountName, 'Trade Payables');
assert.match(result.singaporeTaxTreatmentSummary || '', /capital allowances/i);

const displayed = await processAccountingQuery('show me double entry', result, 'SFRS_I');
assert.equal(displayed.scenarioState.directGroups?.length, 1);
assert.match(displayed.messageText, /Conditional Journal \(Unconfirmed\)/i);
assert.doesNotMatch(displayed.messageText, /No Double Entry Available Yet/);
assert.equal(displayed.scenarioState.directGroups?.[0].authorityStatus, 'CONDITIONAL');
assert.equal(displayed.scenarioState.committedDirectGroups, undefined, 'conditional journal recall does not mark the journal committed');
assert.equal(displayed.scenarioState.directGroups?.[0].totalDebit, 50000);
assert.equal(displayed.scenarioState.directGroups?.[0].lines[0].debit, 50000);
assert.equal(displayed.scenarioState.directGroups?.[0].lines[1].credit, 50000);
const deterministicCompanion = {
  ...result.directGroups[0],
  id: 'deterministic-companion',
  title: 'Deterministic companion event',
  summary: 'Separate deterministic event',
  authorityStatus: 'DETERMINISTIC',
  totalDebit: 1000,
  totalCredit: 1000,
  lines: result.directGroups[0].lines.map((line, index) => ({
    ...line,
    id: `deterministic-companion-line-${index + 1}`,
    debit: index === 0 ? 1000 : 0,
    credit: index === 0 ? 0 : 1000
  }))
};
const mixedConditionalDisplay = await processAccountingQuery('show me double entry', {
  ...result,
  directGroups: [...result.directGroups, deterministicCompanion]
}, 'SFRS_I');
assert.match(mixedConditionalDisplay.messageText, /Conditional Journal \(Unconfirmed\)/i);
assert.deepEqual(mixedConditionalDisplay.scenarioState.directGroups?.map(group => group.authorityStatus), [
  'CONDITIONAL', 'DETERMINISTIC'
], 'a complete collection with a conditional group is recalled as a whole');
assert.equal(mixedConditionalDisplay.scenarioState.directGroups?.length, 2);
assert.equal(mixedConditionalDisplay.scenarioState.committedDirectGroups, undefined,
  'a mixed conditional collection is not promoted to committed state');
assert.deepEqual(mixedConditionalDisplay.scenarioState.directGroups?.map(group => group.totalDebit), [50000, 1000]);

const equipmentFacts = 'My company incurred SGD 80,000 on a piece of equipment';
for (const settlement of ['has partially paid the supplier, with the balance outstanding', 'has paid SGD 10,000 to the supplier', 'has paid 10,000 to the supplier', 'has paid a deposit of 10,000 to the supplier']) {
  const partial = await parseAccountingQuery(`${equipmentFacts} and ${settlement}. How should we account for it?`, null);
  assert.equal(partial.scenarioType, 'BUSINESS_EQUIPMENT_ACQUISITION');
  assert.equal(partial.isComplete, false);
  assert.deepEqual(partial.directGroups, []);
  assert.match(partial.missingFields[0].prompt, /How much was paid/);
}
const futurePayment = await parseAccountingQuery(`${equipmentFacts} and will be paid by bank transfer next month. How should we account for it?`, null);
assert.equal(futurePayment.directGroups?.[0].lines[1].accountName, 'Trade Payables');
assert.equal(futurePayment.directGroups?.[0].lines[1].credit, 80000);
const fullPayment = await parseAccountingQuery(`${equipmentFacts} and has paid SGD 80,000 to the supplier. How should we account for it?`, null);
assert.equal(fullPayment.directGroups?.[0].lines[1].accountName, 'Cash at Bank');
assert.equal(fullPayment.directGroups?.[0].lines[1].credit, 80000);
console.log('PASS | Equipment acquisition returns a measured journal and capital-allowance treatment');
