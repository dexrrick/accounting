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
assert.match(displayed.messageText, /Double Entry Journal/i);
console.log('PASS | Equipment acquisition returns a measured journal and capital-allowance treatment');
