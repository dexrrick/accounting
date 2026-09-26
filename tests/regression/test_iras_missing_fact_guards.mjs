import assert from 'node:assert/strict';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import {
  guardUnconditionalMealInputTaxClaim,
  hasUnresolvedMealInputTaxEligibility
} from '../../src/engine/responseAssembler.ts';
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

const mixedMealQuestion = 'We paid SGD 200 for a customer lunch. What is the accounting entry, and can we claim the GST?';
const mealGstFacts = [
  'Supplier and customer GST registration status, where relevant',
  'Business or private use and supporting tax invoice for the GST claim',
  'Business purpose of the meal or entertainment',
  'Who attended and their relationship to the company'
];
for (const fact of mealGstFacts) {
  assert.equal(hasUnresolvedMealInputTaxEligibility(mixedMealQuestion, [fact]), true,
    `Meal GST eligibility remains unresolved for the GST-specific fact: ${fact}`);
}
const unrelatedTaxFact = 'Financial year end and YA basis period';
assert.equal(hasUnresolvedMealInputTaxEligibility(mixedMealQuestion, [unrelatedTaxFact]), false,
  'An unrelated corporate-tax fact must not suppress a meal GST claimability conclusion.');

const unsupportedMealClaim = 'GST is always claimable on customer lunches.';
const mixedMealResponse = 'Record Dr Meals Expense SGD 200 and Cr Cash SGD 200; GST is always claimable on customer lunches. The entry remains a SGD 200 expense.';
const emptyGroundedEvidence = { primaryEvidence: [], officialGuidance: [], curatedSummaries: [] };
const guardedMixedMealResponse = guardUnconditionalMealInputTaxClaim(
  mixedMealResponse,
  mixedMealQuestion,
  emptyGroundedEvidence,
  ['Supporting tax invoice for the GST claim']
);
assert.ok(guardedMixedMealResponse.includes('Record Dr Meals Expense SGD 200 and Cr Cash SGD 200'),
  'The meal GST guard preserves journal discussion before an unsupported claim in the same sentence.');
assert.ok(guardedMixedMealResponse.includes('The entry remains a SGD 200 expense.'),
  'The meal GST guard preserves unrelated accounting discussion after the claim.');
assert.ok(!guardedMixedMealResponse.includes(unsupportedMealClaim),
  'The unconditional GST assertion is removed from the mixed accounting response.');
assert.match(guardedMixedMealResponse, /Do not assume input GST.*always claimable/i);

const unrelatedFactMealResponse = guardUnconditionalMealInputTaxClaim(
  unsupportedMealClaim,
  mixedMealQuestion,
  emptyGroundedEvidence,
  [unrelatedTaxFact]
);
assert.equal(unrelatedFactMealResponse, unsupportedMealClaim,
  'A missing corporate-tax fact alone must not trigger the meal GST prose guard.');

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
assert.equal(SINGAPORE_STATUTORY_REPOSITORY.GST_REG26_BLOCKED_INPUT_TAX.sourceStatus, 'VERIFIED');
assert.equal(SINGAPORE_STATUTORY_REPOSITORY.GST_REG26_BLOCKED_INPUT_TAX.sourceType, 'CURATED_SUMMARY');
assert.equal(SINGAPORE_STATUTORY_REPOSITORY.GST_REG26_BLOCKED_INPUT_TAX.isVerbatimText, false);
assert.ok(SINGAPORE_STATUTORY_REPOSITORY.GST_REG26_BLOCKED_INPUT_TAX.supplementaryOfficialSources?.some(
  source => source.title === 'IRAS — Purchase and Sale of Motor Vehicles'
));
assert.equal(blockedInputAdvisory.isGstClaimable, undefined, 'General blocked-input-tax guidance has exceptions and cannot decide every claim.');
assert.match(blockedInputAdvisory.keyRules.join(' '), /From 1 January 2023.*third party.*may be claimed/i);
assert.match(blockedInputAdvisory.keyRules.join(' '), /connected person.*recovery is not ancillary/i);
assert.match(blockedInputAdvisory.keyRules.join(' '), /1 October 2021.*nature of the work or work environment.*Singapore written law/i);
assert.match(blockedInputAdvisory.keyRules.join(' '), /COVID-19.*Government or public-authority advisory/i);
assert.match(blockedInputAdvisory.keyRules.join(' '), /Regulation 27/);
assert.match(blockedInputAdvisory.keyRules.join(' '), /Regulation 26.*pre-employment medical examinations/i);

const timeOfSupply = SINGAPORE_STATUTORY_REPOSITORY.GST_SEC11_TIME_OF_SUPPLY;
assert.equal(timeOfSupply.validFrom, '2011-01-01', 'The current general invoice/payment rule starts with the 2011 time-of-supply change.');
assert.match(timeOfSupply.principle, /earlier of when an invoice is issued and when payment is received/i);
assert.doesNotMatch(timeOfSupply.principle, /basic tax point/i);
assert.match(timeOfSupply.practicalRules.join(' '), /pre-1 January 2011.*Basic Tax Point.*14-day rule/i);
assert.doesNotMatch(timeOfSupply.practicalRules.join(' '), /14-Day Rule: If invoice is issued within 14 days/i);

const internationalServices = SINGAPORE_STATUTORY_REPOSITORY.GST_SEC21_ZERO_RATED_EXPORTS;
assert.match(internationalServices.principle, /specific category in Section 21\(3\)/i);
assert.match(internationalServices.principle, /overseas customer alone is insufficient/i);
assert.match(internationalServices.practicalRules.join(' '), /direct-benefit test/i);
assert.match(internationalServices.practicalRules.join(' '), /partial-exemption rules/i);
assert.equal(
  convertToAdvisory(internationalServices).isGstClaimable,
  undefined,
  'A zero-rated output supply does not determine whether separate input tax is recoverable.'
);

const passengerCarTaxRule = SINGAPORE_STATUTORY_REPOSITORY.ITA_SEC15_1_K_MOTOR_CAR;
assert.equal(passengerCarTaxRule.sourceStatus, 'VERIFIED');
assert.equal(passengerCarTaxRule.sourceType, 'CURATED_SUMMARY');
assert.equal(passengerCarTaxRule.isVerbatimText, false);
assert.match(passengerCarTaxRule.practicalRules.join(' '), /registered on or after 1 April 1998/);
assert.match(passengerCarTaxRule.principle, /subject to vehicle- and business-specific exceptions/i);
assert.match(passengerCarTaxRule.practicalRules.join(' '), /private-hire cars and instructional cars/i);
assert.match(passengerCarTaxRule.practicalRules.join(' '), /foreign-registered cars used exclusively outside Singapore/i);
assert.match(passengerCarTaxRule.practicalRules.join(' '), /Taxi running-expense exception: Section 15\(1\)\(k\)\(i\), subject to Section 15\(2D\)/i);
assert.match(passengerCarTaxRule.practicalRules.join(' '), /12 November 2018.*authorised purpose.*Section 14ZA\(8\)/i);
assert.match(passengerCarTaxRule.practicalRules.join(' '), /taxi rule does not itself extend to private-hire cars/i);
assert.doesNotMatch(passengerCarTaxRule.practicalRules.join(' '), /G-plate.*100% eligible|G\/Y plate.*eligible/i);
assert.equal(
  convertToAdvisory(passengerCarTaxRule).isTaxDeductible,
  undefined,
  'General motor-car guidance has exceptions and cannot decide deductibility without vehicle facts.'
);

const section15SelectedDeductions = SINGAPORE_STATUTORY_REPOSITORY.ITA_SEC15_PROHIBITED_DEDUCTIONS;
assert.equal(section15SelectedDeductions.sourceStatus, 'VERIFIED');
assert.equal(section15SelectedDeductions.sourceType, 'CURATED_SUMMARY');
assert.equal(section15SelectedDeductions.isVerbatimText, false);
assert.match(section15SelectedDeductions.principle, /selected limbs, not an exhaustive list/i);
assert.doesNotMatch(section15SelectedDeductions.principle, /fines and statutory penalties/i,
  'The Section 15 summary does not attribute the separate Section 14V fine prohibition to Section 15.');

const capitalAllowanceRule = SINGAPORE_STATUTORY_REPOSITORY.ITA_SEC19_19A_CAPITAL_ALLOWANCES;
assert.equal(capitalAllowanceRule.sourceStatus, 'VERIFIED');
assert.equal(capitalAllowanceRule.sourceType, 'CURATED_SUMMARY');
assert.equal(capitalAllowanceRule.isVerbatimText, false);
assert.match(capitalAllowanceRule.practicalRules.join(' '), /specified computer software/i);
assert.doesNotMatch(capitalAllowanceRule.practicalRules.join(' '), /all software|software generally qualifies/i,
  'Software is described as eligible only where it is within prescribed automation equipment.');

const ownUsePassengerCar = await parseAccountingQuery(
  'The company bought an S-plate passenger car for own use by employees for SGD 120k with bank. How to record the purchase?'
);
assert.equal(ownUsePassengerCar?.scenarioType, 'CAR_PURCHASE_STATUTORY', 'An explicit ordinary S-plate employee-use purchase retains its specialized accounting path.');
assert.equal(ownUsePassengerCar?.statutoryAdvisory?.find(advisory => advisory.sectionOrSchedule === 'Section 15(1)(k)')?.isTaxDeductible, false);
assert.equal(ownUsePassengerCar?.statutoryAdvisory?.find(advisory => advisory.sectionOrSchedule === 'Regulation 26 & 27')?.isGstClaimable, false);
assert.match(ownUsePassengerCar?.transactionTitle ?? '', /general tax restrictions/i);
assert.match(ownUsePassengerCar?.uncertaintyDisclaimer ?? '', /no applicable exception/i);
assert.match(ownUsePassengerCar?.uncertaintyDisclaimer ?? '', /plate.*alone does not establish.*capital-allowance or GST recovery eligibility/i);
assert.doesNotMatch(ownUsePassengerCar?.uncertaintyDisclaimer ?? '', /G\/Y plate.*eligible/i);

const ownUsePassengerCarWithoutRegistration = await parseAccountingQuery(
  'The company bought a passenger car for own use by employees for SGD 120k with bank.'
);
assert.notEqual(ownUsePassengerCarWithoutRegistration?.scenarioType, 'CAR_PURCHASE_STATUTORY', 'Own use alone does not establish the vehicle registration class for the passenger-car restrictions.');
const exceptionPassengerCar = await parseAccountingQuery(
  'The company bought an S-plate passenger car for use by employees as a private-hire taxi for SGD 120k.'
);
assert.notEqual(exceptionPassengerCar?.scenarioType, 'CAR_PURCHASE_STATUTORY', 'Private-hire use is excluded from the ordinary private-car fast path so its exception facts are assessed separately.');

const historicalSection13W = SINGAPORE_STATUTORY_REPOSITORY.ITA_SEC13W_EQUITY_DISPOSAL_SAFE_HARBOUR;
const currentSection13W = SINGAPORE_STATUTORY_REPOSITORY.ITA_SEC13W_EQUITY_DISPOSAL_2026;
assert.match(historicalSection13W.practicalRules.join(' '), /before 1 June 2022/i);
assert.match(historicalSection13W.practicalRules.join(' '), /on or after 1 June 2022/i);
assert.match(historicalSection13W.practicalRules.join(' '), /preceding 60 months/i);
assert.match(historicalSection13W.practicalRules.join(' '), /do not aggregate group holdings/i);
assert.match(currentSection13W.principle, /registered business trust or variable capital company/i);
assert.match(currentSection13W.practicalRules.join(' '), /group assessment is unavailable.*registered business trust.*variable capital company/i);

for (const withholdingTaxRule of [
  SINGAPORE_STATUTORY_REPOSITORY.ITA_SEC45_WITHHOLDING_TAX,
  SINGAPORE_STATUTORY_REPOSITORY.ITA_SEC45A_WITHHOLDING_TAX_ROYALTIES
]) {
  const timingRules = withholdingTaxRule.practicalRules.join(' ');
  assert.match(timingRules, /earliest of.*agreement or contract.*invoice date if there is no agreement or contract/i);
  assert.match(timingRules, /credited to the non-resident/i);
  assert.match(timingRules, /actual payment/i);
  assert.match(timingRules, /credit terms do not defer/i);
}

const section14N = SINGAPORE_STATUTORY_REPOSITORY.ITA_SEC14N_RENOVATION_REFURBISHMENT;
assert.match(section14N.principle, /refreshed SGD 300,000 cap/i);
assert.match(section14N.practicalRules.join(' '), /existing relevant 3-year period does not coincide/i);
assert.match(section14N.practicalRules.join(' '), /election is irrevocable/i);
assert.match(section14N.practicalRules.join(' '), /starts carrying on a trade or business during a fixed 3-year period.*full SGD 300,000 cap.*do not prorate/i);
assert.match(section14N.practicalRules.join(' '), /commencing business in YA 2026 may use the full cap across YAs 2026 and 2027/i);

const lossAndAllowanceRules = SINGAPORE_STATUTORY_REPOSITORY.ITA_SEC37_LOSS_CARRY_FORWARD;
assert.match(lossAndAllowanceRules.practicalRules.join(' '), /Trade-loss comparison dates:.*calendar year/i);
assert.match(lossAndAllowanceRules.practicalRules.join(' '), /Capital-allowance comparison dates:.*YA/i);
assert.match(lossAndAllowanceRules.practicalRules.join(' '), /same trade or business.*principal activities/i);
assert.match(lossAndAllowanceRules.practicalRules.join(' '), /not stated as carry-forward conditions for trade losses/i);

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

for (const shareClass of ['ordinary shares', 'preference shares']) {
  const section13wTax = classifyQuestion(`Does Section 13W exempt our gain on disposal of ${shareClass} from income tax?`);
  assert.deepEqual(section13wTax.authorities, ['IRAS'], `Section 13W tax treatment of ${shareClass} must stay with IRAS.`);
  assert.ok(section13wTax.topicIds.includes('iras-section-13w'));
}

const section13wMixed = classifyQuestion('For a disposal of preference shares, explain both Section 13W tax treatment and the accounting treatment in the financial statements.');
assert.ok(section13wMixed.authorities.includes('IRAS'));
assert.ok(section13wMixed.authorities.includes('ACRA'));
assert.equal(section13wMixed.multiAuthority, true, 'An explicit Section 13W accounting question must remain mixed.');

console.log('PASS | IRAS case questions identify material tax facts without burdening conceptual queries');
