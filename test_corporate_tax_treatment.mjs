import assert from 'node:assert/strict';
import { assessCorporateTaxTreatment } from './src/services/corporateTaxTreatment.ts';

const businessExpense = assessCorporateTaxTreatment('Paid SGD 2,000 for customer marketing event');
assert.equal(businessExpense.treatment, 'DEDUCTIBLE_SUBJECT_TO_EVIDENCE');
assert.deepEqual(businessExpense.sourceRecordIds, ['ITA_SEC14_GENERAL_DEDUCTION', 'ITA_SEC15_PROHIBITED_DEDUCTIONS']);

const fine = assessCorporateTaxTreatment('Paid a traffic fine using the company bank account');
assert.equal(fine.treatment, 'NON_DEDUCTIBLE_ADD_BACK');
assert.match(fine.summary, /added back/i);

const equipment = assessCorporateTaxTreatment('Purchased computer equipment and recorded depreciation');
assert.equal(equipment.treatment, 'CAPITAL_ALLOWANCE_REVIEW');
assert.ok(equipment.sourceRecordIds.includes('ITA_SEC19_19A_CAPITAL_ALLOWANCES'));

console.log('PASS | Corporate tax treatment: business expense, prohibited expense, and capital allowance paths');
