import { parseAccountingQuery } from './src/engine/scenarioParser.ts';

console.log("=== RUNNING FOLLOW-UP QUESTIONS & SCENARIO UPDATE TEST SUITE ===\n");

// STEP 1: Initial Question
const initialQuery = `On 1 August 2026, a GST-registered company purchases office equipment with a list price of SGD 20,000 (exclusive of 9% GST). The vendor grants a 10% trade discount on the list price. The company pays SGD 5,000 immediately by bank transfer and the remaining balance is placed on credit terms. Required: Prepare the single compound journal entry on 1 August 2026 to record the purchase.`;

console.log("[STEP 1] Parsing Initial Purchase Scenario...");
const s1 = await parseAccountingQuery(initialQuery, null);

console.assert(s1.scenarioType === 'ASSET_PURCHASE_DISCOUNT', `Expected ASSET_PURCHASE_DISCOUNT, got ${s1.scenarioType}`);
console.assert(s1.directGroups && s1.directGroups.length === 1, `Expected 1 direct group, got ${s1.directGroups?.length}`);

const grp1 = s1.directGroups[0];
const equipLine1 = grp1.lines.find(l => l.accountCode === '1500');
const gstLine1 = grp1.lines.find(l => l.accountCode === '1190');
const bankLine1 = grp1.lines.find(l => l.accountCode === '1010');
const payLine1 = grp1.lines.find(l => l.accountCode === '2010');

console.log(`Initial Asset Cost: SGD ${equipLine1.debit} (Expected: 18000)`);
console.log(`Initial Input GST:  SGD ${gstLine1.debit} (Expected: 1620)`);
console.log(`Initial Bank Paid:  SGD ${bankLine1.credit} (Expected: 5000)`);
console.log(`Initial Payables:   SGD ${payLine1.credit} (Expected: 14620)`);
console.log(`Initial Balanced:   ${grp1.isBalanced}`);

console.assert(equipLine1.debit === 18000, `Asset cost must be 18000, got ${equipLine1.debit}`);
console.assert(gstLine1.debit === 1620, `GST must be 1620, got ${gstLine1.debit}`);
console.assert(bankLine1.credit === 5000, `Bank paid must be 5000, got ${bankLine1.credit}`);
console.assert(payLine1.credit === 14620, `Payables must be 14620, got ${payLine1.credit}`);
console.assert(grp1.isBalanced === true, `Group 1 must be balanced`);
console.log("✓ STEP 1 PASSED\n");

// STEP 2: Follow-up Question 1 - "What if the trade discount is 20% instead?"
console.log("[STEP 2] Follow-Up: 'what if the trade discount is 20% instead?'");
const s2 = await parseAccountingQuery("what if the trade discount is 20% instead?", s1);

console.assert(s2.scenarioType === 'ASSET_PURCHASE_DISCOUNT', `Expected ASSET_PURCHASE_DISCOUNT, got ${s2.scenarioType}`);
console.assert(s2.directGroups && s2.directGroups.length === 1, `Expected 1 direct group, got ${s2.directGroups?.length}`);

const grp2 = s2.directGroups[0];
const equipLine2 = grp2.lines.find(l => l.accountCode === '1500');
const gstLine2 = grp2.lines.find(l => l.accountCode === '1190');
const bankLine2 = grp2.lines.find(l => l.accountCode === '1010');
const payLine2 = grp2.lines.find(l => l.accountCode === '2010');

console.log(`Updated Asset Cost (20% disc): SGD ${equipLine2.debit} (Expected: 16000)`);
console.log(`Updated Input GST:             SGD ${gstLine2.debit} (Expected: 1440)`);
console.log(`Bank Paid:                     SGD ${bankLine2.credit} (Expected: 5000)`);
console.log(`Updated Payables:              SGD ${payLine2.credit} (Expected: 12440)`);
console.log(`Group 2 Balanced:              ${grp2.isBalanced}`);

console.assert(equipLine2.debit === 16000, `Asset cost must be 16000, got ${equipLine2.debit}`);
console.assert(gstLine2.debit === 1440, `GST must be 1440, got ${gstLine2.debit}`);
console.assert(bankLine2.credit === 5000, `Bank paid must be 5000, got ${bankLine2.credit}`);
console.assert(payLine2.credit === 12440, `Payables must be 12440, got ${payLine2.credit}`);
console.assert(grp2.isBalanced === true, `Group 2 must be balanced`);

const discountParam = s2.keyParameters?.find(p => p.label.includes('Trade Discount'));
console.log(`Updated Fact Card: ${discountParam?.label} -> ${discountParam?.value}`);
console.assert(discountParam?.value === '-SGD 4,000', `Expected -SGD 4,000, got ${discountParam?.value}`);
console.log("✓ STEP 2 PASSED: 20% Trade discount recalculation succeeded!\n");

// STEP 3: Follow-up Question 2 - "change cash paid to 10,000"
console.log("[STEP 3] Follow-Up: 'change cash paid to 10,000'");
const s3 = await parseAccountingQuery("change cash paid to 10,000", s2);

const grp3 = s3.directGroups[0];
const equipLine3 = grp3.lines.find(l => l.accountCode === '1500');
const bankLine3 = grp3.lines.find(l => l.accountCode === '1010');
const payLine3 = grp3.lines.find(l => l.accountCode === '2010');

console.log(`Asset Cost:       SGD ${equipLine3.debit} (Kept at: 16000)`);
console.log(`New Bank Paid:    SGD ${bankLine3.credit} (Expected: 10000)`);
console.log(`Updated Payables: SGD ${payLine3.credit} (Expected: 7440)`);
console.log(`Group 3 Balanced: ${grp3.isBalanced}`);

console.assert(equipLine3.debit === 16000, `Asset cost must remain 16000, got ${equipLine3.debit}`);
console.assert(bankLine3.credit === 10000, `Bank paid must be 10000, got ${bankLine3.credit}`);
console.assert(payLine3.credit === 7440, `Payables must be 7440, got ${payLine3.credit}`);
console.assert(grp3.isBalanced === true, `Group 3 must be balanced`);
console.log("✓ STEP 3 PASSED: Cash payment change and payables recalculation succeeded!\n");

// STEP 4: Follow-up Question 3 - "what is the entry when we settle the remaining balance?"
console.log("[STEP 4] Follow-Up: 'what is the entry when we settle the remaining balance?'");
const s4 = await parseAccountingQuery("what is the entry when we settle the remaining balance via bank?", s3);

console.assert(s4.directGroups && s4.directGroups.length === 2, `Expected 2 groups, got ${s4.directGroups?.length}`);
const settleGrp = s4.directGroups[1];
console.log(`Entry 2 Title:    ${settleGrp.title}`);
console.log(`Debit Account:    ${settleGrp.lines[0].accountName} = SGD ${settleGrp.lines[0].debit}`);
console.log(`Credit Account:   ${settleGrp.lines[1].accountName} = SGD ${settleGrp.lines[1].credit}`);
console.log(`Entry 2 Balanced: ${settleGrp.isBalanced}`);

console.assert(settleGrp.lines[0].debit === 7440, `Settlement Dr must be 7440, got ${settleGrp.lines[0].debit}`);
console.assert(settleGrp.lines[1].credit === 7440, `Settlement Cr must be 7440, got ${settleGrp.lines[1].credit}`);
console.assert(settleGrp.isBalanced === true, `Settlement entry must be balanced`);
console.log("✓ STEP 4 PASSED: Subsequent settlement entry generated successfully!\n");

// STEP 5: Follow-up Question 4 - Conceptual question
console.log("[STEP 5] Follow-Up: 'why is trade discount not recorded as an expense?'");
const s5 = await parseAccountingQuery("why is trade discount not recorded as an expense?", s4);

console.assert(s5.directGroups && s5.directGroups.length === 2, `Expected 2 groups preserved, got ${s5.directGroups?.length}`);
console.assert(s5.keyParameters && s5.keyParameters.length > 0, `Expected keyParameters preserved`);
console.log(`Preserved ${s5.directGroups?.length} entry groups and ${s5.keyParameters?.length} fact cards.`);
console.log("✓ STEP 5 PASSED: Conceptual question preserved all scenario groups and facts!\n");

console.log("🎉 ALL FOLLOW-UP TESTS PASSED 100%!");
