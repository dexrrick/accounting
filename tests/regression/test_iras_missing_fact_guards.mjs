import assert from 'node:assert/strict';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import { convertToAdvisory, SINGAPORE_STATUTORY_REPOSITORY } from '../../src/standards/singaporeStatutesKnowledge.ts';

const taxExpense = classifyQuestion('Can we deduct this company expense for income tax?');
assert.ok(taxExpense.domains.includes('IRAS_CORPORATE_TAX'));
assert.ok(taxExpense.missingFacts.some(fact => /business purpose/i.test(fact)));
assert.ok(taxExpense.missingFacts.some(fact => /capital or revenue/i.test(fact)));

const renovation = classifyQuestion('Can my company deduct this renovation for corporate tax?');
assert.ok(renovation.missingFacts.some(fact => /business purpose/i.test(fact)));
assert.ok(renovation.missingFacts.some(fact => /capital or revenue/i.test(fact)));
const mixedYaDate = classifyQuestion('Can we deduct renovation paid on 31/12/2024 for YA 2025 corporate tax?');
assert.ok(mixedYaDate.missingFacts.some(fact => /financial year end and YA basis period/i.test(fact)));

const gstClaim = classifyQuestion('Can we claim input GST on this customer meal?');
assert.ok(gstClaim.domains.includes('IRAS_GST'));
assert.ok(gstClaim.missingFacts.some(fact => /registration status/i.test(fact)));
assert.ok(gstClaim.missingFacts.some(fact => /business or private use/i.test(fact)));

const managementFee = classifyQuestion('Must we pay withholding tax on a management fee to an overseas company?');
assert.ok(managementFee.domains.includes('IRAS_CORPORATE_TAX'));
assert.ok(managementFee.missingFacts.some(fact => /recipient tax residence/i.test(fact)));
assert.ok(managementFee.missingFacts.some(fact => /physically performed/i.test(fact)));
assert.ok(managementFee.missingFacts.some(fact => /payment or deemed-payment date/i.test(fact)));
assert.ok(managementFee.missingFacts.some(fact => /year or period when the services were provided/i.test(fact)));

const datedService = classifyQuestion('Must we pay withholding tax on management services performed in 2025 for a non-resident, paid on 10/02/2026?');
assert.ok(!datedService.missingFacts.some(fact => /year or period when the services were provided/i.test(fact)));
const renderedService = classifyQuestion('Must we pay withholding tax on consulting services rendered in 2025 for a non-resident, paid on 10/02/2026?');
assert.ok(!renderedService.missingFacts.some(fact => /year or period when the services were provided/i.test(fact)));

const blockedInputAdvisory = convertToAdvisory(SINGAPORE_STATUTORY_REPOSITORY.GST_REG26_BLOCKED_INPUT_TAX);
assert.equal(blockedInputAdvisory.isGstClaimable, undefined, 'General blocked-input-tax guidance has exceptions and cannot decide every claim.');
assert.match(blockedInputAdvisory.keyRules.join(' '), /third-party-use costs may be claimable/i);
assert.match(blockedInputAdvisory.keyRules.join(' '), /1 October 2021/i);

const customerCarRepair = await parseAccountingQuery('We paid SGD 500 to repair our customer car. Can we claim input GST?');
assert.notEqual(customerCarRepair?.scenarioType, 'CAR_PURCHASE_STATUTORY', 'A customer-car repair is not an entity passenger-car acquisition.');
const unspecifiedCar = await parseAccountingQuery('We bought a company car for SGD 120,000. Can we claim input GST?');
assert.notEqual(unspecifiedCar?.scenarioType, 'CAR_PURCHASE_STATUTORY', 'Vehicle classification is required before applying the passenger-car prohibition.');

const clearance = classifyQuestion('Must we file IR21 when our employee leaves?');
assert.ok(clearance.domains.includes('IRAS_EMPLOYER_TAX'));
assert.ok(clearance.missingFacts.some(fact => /citizenship/i.test(fact)));
assert.ok(clearance.missingFacts.some(fact => /departure/i.test(fact)));

const conceptual = classifyQuestion('What is withholding tax?');
assert.equal(conceptual.missingFacts.length, 0);

const directorFeeTiming = classifyQuestion('For a bonus and directors’ fees, what dates determine the employee tax assessment year?');
assert.ok(directorFeeTiming.domains.includes('IRAS_EMPLOYER_TAX'));
assert.ok(!directorFeeTiming.authorities.includes('ACRA'), 'Employee tax assessment timing must not route to ACRA from the incidental word director.');
assert.deepEqual(directorFeeTiming.authorities, ['IRAS']);
assert.equal(directorFeeTiming.multiAuthority, false);

const passengerCarTax = classifyQuestion('Can a company deduct depreciation and running costs for its S-plate passenger motor car, and can it claim capital allowances?');
assert.ok(passengerCarTax.domains.includes('IRAS_CORPORATE_TAX'));
assert.ok(!passengerCarTax.authorities.includes('ACRA'), 'A passenger-car tax-deductibility question must not route to accounting solely from depreciation.');
assert.ok(!passengerCarTax.domains.some(domain => domain.startsWith('ACCOUNTING_')));
assert.deepEqual(passengerCarTax.authorities, ['IRAS']);
assert.equal(passengerCarTax.multiAuthority, false);

const carAccountingAndTax = classifyQuestion('For accounting, prepare the journal for depreciation on the S-plate passenger motor car and explain whether its running costs are deductible for corporate tax.');
assert.ok(carAccountingAndTax.authorities.includes('ACRA'));
assert.ok(carAccountingAndTax.authorities.includes('IRAS'));
assert.equal(carAccountingAndTax.multiAuthority, true, 'Explicit accounting/journal plus tax questions retain multi-authority routing.');

console.log('PASS | IRAS case questions identify material tax facts without burdening conceptual queries');
