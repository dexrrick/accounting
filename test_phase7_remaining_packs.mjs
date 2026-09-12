import assert from 'node:assert/strict';
import { parseAccountingQuery } from './src/engine/scenarioParser.ts';

const revenue = await parseAccountingQuery('How should we recognise revenue for a contract with multiple performance obligations?');
assert.equal(revenue.primaryDomain, 'ACCOUNTING_SFRS');
assert.equal(revenue.isComplete, false);
assert.ok(revenue.missingFields.some(field => field.fieldKey === 'revenueContractTerms'));

const lease = await parseAccountingQuery('We signed a 3 year office lease at SGD 3,000 per month.');
assert.equal(lease.scenarioType, 'LEASE_IFRS16');

const shares = await parseAccountingQuery('The shareholder invested SGD 10,000 cash as share capital in her company.');
assert.equal(shares.scenarioType, 'SHARE_CAPITAL_PAID');

const payroll = await parseAccountingQuery('Singaporean employee age 32 earns SGD 3,200 monthly. Calculate CPF and SDL.');
assert.equal(payroll.scenarioType, 'PAYROLL_CPF_SALARY');

const gst = await parseAccountingQuery('What is the GST registration threshold in Singapore?');
assert.equal(gst.primaryDomain, 'IRAS_GST');

console.log('PASS | Phase 7 remaining packs: GST, CPF/SDL, revenue, lease, and share capital');
