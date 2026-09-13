import assert from 'node:assert/strict';
import {
  applyFactAmendments,
  buildAmendedQuery,
  resolveFactAmendment
} from '../../src/services/factAmendmentService.ts';

console.log('=== RUNNING FACT AMENDMENT SERVICE SUITE ===\n');

const payroll = {
  scenarioType: 'PAYROLL_CPF_SALARY', rawQuery: 'Staff is 60 years old Singaporean earning SGD 8,000 a month.',
  transactionTitle: 'Payroll', functionalCurrency: 'SGD', transactionCurrency: 'SGD', amount: 8000,
  isComplete: true, missingFields: []
};
const lease = {
  scenarioType: 'LEASE_IFRS16', rawQuery: 'Office lease is SGD 3,000 monthly for three years.',
  transactionTitle: 'Lease', functionalCurrency: 'SGD', transactionCurrency: 'SGD', leasePaymentMonthly: 3000,
  isComplete: true, missingFields: []
};

const payrollResolution = resolveFactAmendment('I mean 10,000 a month.', payroll);
assert.equal(payrollResolution.intent, 'FACT_AMENDMENT');
assert.equal(payrollResolution.amendments?.[0]?.field, 'monthlySalary');
assert.equal(payrollResolution.amendments?.[0]?.value, 10000);
const amendedPayroll = applyFactAmendments(payroll, payrollResolution.amendments);
assert.equal(amendedPayroll.amount, 10000);
assert.equal(payroll.amount, 8000, 'source scenario must not be mutated');
assert.match(buildAmendedQuery(amendedPayroll, payrollResolution.amendments), /Corrected monthly salary is SGD 10,000/);

const leaseResolution = resolveFactAmendment('Actually it is 4,500 monthly.', lease);
assert.equal(leaseResolution.amendments?.[0]?.field, 'leasePaymentMonthly');
assert.equal(applyFactAmendments(lease, leaseResolution.amendments).leasePaymentMonthly, 4500);

const ambiguous = resolveFactAmendment('Actually it is 10,000.', {
  scenarioType: 'UNRECOGNIZED', rawQuery: 'Tell me about this.', transactionTitle: 'Unknown',
  functionalCurrency: 'SGD', transactionCurrency: 'SGD', isComplete: false, missingFields: []
});
assert.equal(ambiguous.intent, 'FACT_AMENDMENT');
assert.ok(ambiguous.clarificationNeeded, 'ambiguous correction must request clarification');

console.log('✓ canonical patches, immutable application and ambiguity guard passed.');
