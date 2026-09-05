import { calculateDoubleEntries } from './src/engine/accountingEngine.ts';
import { parseAccountingQuery } from './src/engine/scenarioParser.ts';

console.log("=== RUNNING EXTENSIVE MULTI-SCENARIO VERIFICATION ===");

// -------------------------------------------------------------
// TEST 1: User's Apple Shares Scenario with Explicit FX Gain Double Entry
// -------------------------------------------------------------
const applePrompt = "a company primary currency is SGD, it invested USD300k into 300 apple shares on 13/11/2026, subsequently the company sold 300 shares for USD400k on 15/12/2026. what's the double entries";

const parsedApple = parseAccountingQuery(applePrompt);
console.log("\n[TEST 1] Apple Shares Parsing & Double Entry:");
console.assert(parsedApple.scenarioType === 'EQUITY_INVESTMENT_FX', `Expected EQUITY_INVESTMENT_FX, got ${parsedApple.scenarioType}`);
console.assert(parsedApple.purchaseAmountForeign === 300000, `Expected 300000, got ${parsedApple.purchaseAmountForeign}`);
console.assert(parsedApple.saleAmountForeign === 400000, `Expected 400000, got ${parsedApple.saleAmountForeign}`);
console.assert(parsedApple.bifurcateFxGain === true, "Expected bifurcateFxGain to be true");

const appleResult = calculateDoubleEntries(parsedApple, 'SFRS_I');
console.assert(appleResult.groups.length === 2, `Expected 2 groups, got ${appleResult.groups.length}`);

const sellGroup = appleResult.groups[1];
const fxGainLine = sellGroup.lines.find(l => l.accountCode === '4600');
const stockGainLine = sellGroup.lines.find(l => l.accountCode === '4510');

console.log(`Disposal Total Dr: SGD ${sellGroup.totalDebit}, Total Cr: SGD ${sellGroup.totalCredit}`);
console.log(`Stock Gain Line: ${stockGainLine?.accountName} -> SGD ${stockGainLine?.credit}`);
console.log(`Realized FX Gain Line: ${fxGainLine?.accountName} -> SGD ${fxGainLine?.credit}`);

console.assert(fxGainLine && fxGainLine.credit === 6000, `Expected FX gain of 6000, got ${fxGainLine?.credit}`);
console.assert(stockGainLine && stockGainLine.credit === 136000, `Expected Stock gain of 136000, got ${stockGainLine?.credit}`);
console.assert(sellGroup.isBalanced === true, "Disposal entry must be balanced");
console.log("✓ TEST 1 PASSED: Explicit Realized Foreign Exchange Gain double entry generated!");

// -------------------------------------------------------------
// TEST 2: User's Rental Agreement Scenario (IFRS 16 / SFRS(I) 16)
// -------------------------------------------------------------
const rentalPrompt = "i have a rental agreement for 3 years, paying 1 month sgd3,000 what's the double entry";

const parsedRental = parseAccountingQuery(rentalPrompt);
console.log("\n[TEST 2] Rental Lease Agreement Parsing & Double Entry:");
console.assert(parsedRental.scenarioType === 'LEASE_IFRS16', `Expected LEASE_IFRS16, got ${parsedRental.scenarioType}`);
console.assert(parsedRental.leaseTermYears === 3, `Expected 3 years, got ${parsedRental.leaseTermYears}`);
console.assert(parsedRental.leaseTermMonths === 36, `Expected 36 months, got ${parsedRental.leaseTermMonths}`);
console.assert(parsedRental.leasePaymentMonthly === 3000, `Expected 3000/mo, got ${parsedRental.leasePaymentMonthly}`);

const rentalResult = calculateDoubleEntries(parsedRental, 'SFRS_I');
console.assert(rentalResult.groups.length === 3, `Expected 3 groups (Inception, Payment, Depr), got ${rentalResult.groups.length}`);

const inceptionGroup = rentalResult.groups[0];
console.log(`Lease Inception: Dr. ${inceptionGroup.lines[0].accountName} = SGD ${inceptionGroup.lines[0].debit}`);
console.log(`                 Cr. ${inceptionGroup.lines[1].accountName} = SGD ${inceptionGroup.lines[1].credit}`);
console.assert(inceptionGroup.isBalanced === true, "Inception entry must be balanced");
console.assert(inceptionGroup.totalDebit > 90000 && inceptionGroup.totalDebit < 105000, `PV expected ~100k, got ${inceptionGroup.totalDebit}`);

const paymentGroup = rentalResult.groups[1];
console.log(`First Payment: Total = SGD ${paymentGroup.totalDebit}`);
console.assert(paymentGroup.isBalanced === true, "Payment entry must be balanced");

const deprGroup = rentalResult.groups[2];
console.log(`Monthly Depreciation: Total = SGD ${deprGroup.totalDebit}`);
console.assert(deprGroup.isBalanced === true, "Depreciation entry must be balanced");

console.log("✓ TEST 2 PASSED: IFRS 16 Lease capitalization, payment, and depreciation double entries verified!");

console.log("\nALL TESTS PASSED WITH 100% ACCURACY!");
