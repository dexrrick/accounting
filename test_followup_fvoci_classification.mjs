import { processAccountingQuery } from './src/services/geminiService.ts';
import { defaultTransactionUnderstandingService } from './src/services/transactionUnderstandingService.ts';
import {
  extractAccountingContext,
  calculateAccountingDelta
} from './src/services/conversationAccountingState.ts';
import {
  validateJournalBalance,
  buildAccountingMeasurementProjection
} from './src/engine/projectionBuilder.ts';
import { calculateDoubleEntries } from './src/engine/accountingEngine.ts';

console.log('================================================================');
console.log('🧪 RUNNING FVOCI FOLLOW-UP STATE PRESERVATION & JOURNAL CONSISTENCY SUITE');
console.log('================================================================\n');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ Assertion Failed: ${message}`);
    testsFailed++;
    throw new Error(message);
  }
}

// --------------------------------------------------------------------------
// TEST A: Full End-to-End User Turn 1 -> Turn 2 (FVOCI Follow-Up)
// --------------------------------------------------------------------------
console.log('--- TEST A: Full End-to-End User Turn 1 -> Turn 2 (FVOCI Follow-Up) ---');
{
  const q1 = "A company primary currency is SGD, it invested USD300k into 300 apple shares on 13/11/2026, subsequently the company sold 300 shares for USD400k on 15/12/2026. What are the double entries and FX gain?";
  const r1 = await processAccountingQuery(q1, null, 'SFRS_I');

  assert(r1.scenarioState.actualMeasurementBasis === 'FVTPL', `Turn 1 actual measurement basis must be FVTPL, got ${r1.scenarioState.actualMeasurementBasis}`);
  assert(r1.scenarioState.directGroups && r1.scenarioState.directGroups.length === 2, 'Turn 1 must have 2 direct groups (Acquisition + Disposal)');
  assert(!r1.scenarioState.isHypothetical, 'Turn 1 is an actual transaction');

  const q2 = "what if the investment is FVOCI show me the double entry";
  const r2 = await processAccountingQuery(q2, r1.scenarioState, 'SFRS_I');

  // Invariant 1: actualMeasurementBasis remains FVTPL
  assert(r2.scenarioState.actualMeasurementBasis === 'FVTPL', `Turn 2 actualMeasurementBasis must remain FVTPL, got ${r2.scenarioState.actualMeasurementBasis}`);

  // Invariant 2: projectedMeasurementBasis is FVOCI
  assert(r2.scenarioState.projectedMeasurementBasis === 'FVOCI', `Turn 2 projectedMeasurementBasis must be FVOCI, got ${r2.scenarioState.projectedMeasurementBasis}`);

  // Invariant 3: isHypothetical is true
  assert(r2.scenarioState.isHypothetical === true, 'Turn 2 must be flagged isHypothetical');

  // Invariant 4: directGroups contains valid non-zero amounts
  assert(r2.scenarioState.directGroups && r2.scenarioState.directGroups.length >= 2, 'Turn 2 must produce direct groups for acquisition and disposal');

  const acqGroup = r2.scenarioState.directGroups[0];
  const dispGroup = r2.scenarioState.directGroups[1];

  assert(acqGroup.totalDebit > 0, `Turn 2 acq totalDebit must be > 0, got ${acqGroup.totalDebit}`);
  assert(acqGroup.isBalanced, 'Turn 2 acq group must be balanced');
  assert(dispGroup.totalDebit > 0, `Turn 2 disp totalDebit must be > 0, got ${dispGroup.totalDebit}`);
  assert(dispGroup.isBalanced, 'Turn 2 disp group must be balanced');

  // Invariant 5: All lines must have non-zero debits and credits
  for (const line of acqGroup.lines) {
    assert(line.debit > 0 || line.credit > 0, `Acquisition line ${line.accountName} must not be zero`);
  }
  for (const line of dispGroup.lines) {
    assert(line.debit > 0 || line.credit > 0, `Disposal line ${line.accountName} must not be zero`);
  }

  // Invariant 6: Message text does NOT contain [Valuation pending] or [Imbalance]
  assert(!r2.messageText.includes('[Valuation pending]'), 'Message must not contain [Valuation pending]');
  assert(!r2.messageText.includes('⚠️ **Pending Valuation**'), 'Message must not contain Pending Valuation balance check');
  assert(!r2.messageText.includes('Amounts pending: Transaction amounts/fair values were not specified'), 'Message must not state amounts pending');

  console.log('✅ Test A Passed: Full Turn 1 -> Turn 2 FVOCI preserves amounts and maintains separate actual/projected bases\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST B: Semantic and Journal Consistency for FVOCI (Zero P&L Recycling)
// --------------------------------------------------------------------------
console.log('--- TEST B: Semantic and Journal Consistency for FVOCI (Zero P&L Recycling) ---');
{
  const q1 = "A company primary currency is SGD, it invested USD300k into 300 apple shares on 13/11/2026, subsequently the company sold 300 shares for USD400k on 15/12/2026. What are the double entries and FX gain?";
  const r1 = await processAccountingQuery(q1, null, 'SFRS_I');

  const q2 = "what if the investment is FVOCI show me the double entry";
  const r2 = await processAccountingQuery(q2, r1.scenarioState, 'SFRS_I');

  // Check all journal lines under FVOCI
  const allLines = r2.scenarioState.directGroups.flatMap(g => g.lines);

  // Must have Fair Value Reserve - FVOCI (Equity / OCI)
  const ociReserveLine = allLines.find(l => l.accountName.toLowerCase().includes('fair value reserve') || l.accountName.toLowerCase().includes('fvoci'));
  assert(Boolean(ociReserveLine), 'FVOCI journal must include Fair Value Reserve (FVOCI / OCI)');

  // Must NOT have Fair Value Gain [P&L] or Realized FX Gain [P&L]
  for (const line of allLines) {
    const accLower = line.accountName.toLowerCase();
    assert(!accLower.includes('fair value gain (profit or loss)') && !accLower.includes('fair value gain [p&l]'),
      `FVOCI must not contain P&L fair value gain: ${line.accountName}`);
    assert(!accLower.includes('realized foreign exchange gain') || !accLower.includes('p&l'),
      `FVOCI must not contain P&L FX gain: ${line.accountName}`);
  }

  // Rationale must mention zero P&L recycling
  const dispGroup = r2.scenarioState.directGroups[1];
  const mentionsZeroRecycling = dispGroup.rationalePoints.some(r => r.toLowerCase().includes('recycling') || r.toLowerCase().includes('recycled'));
  assert(mentionsZeroRecycling, 'Disposal rationale must document SFRS(I) 9 zero P&L recycling mandate');

  console.log('✅ Test B Passed: FVOCI entries strictly adhere to zero P&L recycling and OCI reserve classification\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST C: Non-Mutating Hypothetical Projections
// --------------------------------------------------------------------------
console.log('--- TEST C: Non-Mutating Hypothetical Projections ---');
{
  const q1 = "A company primary currency is SGD, it invested USD300k into 300 apple shares on 13/11/2026, subsequently the company sold 300 shares for USD400k on 15/12/2026. What are the double entries and FX gain?";
  const r1 = await processAccountingQuery(q1, null, 'SFRS_I');

  const priorCommittedGroups = r1.scenarioState.committedDirectGroups || r1.scenarioState.directGroups;
  const initialAcqDebit = priorCommittedGroups[0].lines[0].debit;

  const q2 = "what if the investment is FVOCI show me the double entry";
  const r2 = await processAccountingQuery(q2, r1.scenarioState, 'SFRS_I');

  // committedDirectGroups on r2 must still reflect actual FVTPL
  assert(r2.scenarioState.committedDirectGroups !== undefined, 'committedDirectGroups must be preserved');
  assert(r2.scenarioState.committedDirectGroups[0].lines[0].debit === initialAcqDebit, 'Committed groups debit must remain untouched');
  const committedLine1 = r2.scenarioState.committedDirectGroups[0].lines[0];
  assert(committedLine1.accountName.toLowerCase().includes('fvtpl') || committedLine1.accountName.toLowerCase().includes('apple'),
    'Committed state must still hold original actual entries');

  // projectedGroups contains the FVOCI projection
  assert(r2.scenarioState.projectedGroups !== undefined, 'projectedGroups must be populated');
  assert(r2.scenarioState.projectedGroups.length >= 2, 'projectedGroups must have 2 groups');

  console.log('✅ Test C Passed: Committed state remains untouched; hypothetical entries isolated in projectedGroups\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST D: Multi-Alternating Projections (FVTPL -> FVOCI -> FVTPL -> FVOCI)
// --------------------------------------------------------------------------
console.log('--- TEST D: Multi-Alternating Projections (FVTPL -> FVOCI -> FVTPL -> FVOCI) ---');
{
  // Turn 1: Actual (FVTPL)
  const q1 = "A company primary currency is SGD, it invested USD300k into 300 apple shares on 13/11/2026, subsequently the company sold 300 shares for USD400k on 15/12/2026. What are the double entries and FX gain?";
  const r1 = await processAccountingQuery(q1, null, 'SFRS_I');
  assert(r1.scenarioState.actualMeasurementBasis === 'FVTPL', 'Turn 1 must be FVTPL');

  // Turn 2: Hypothetical FVOCI
  const q2 = "what if the investment is FVOCI show me the double entry";
  const r2 = await processAccountingQuery(q2, r1.scenarioState, 'SFRS_I');
  assert(r2.scenarioState.actualMeasurementBasis === 'FVTPL', 'Turn 2 actual basis must remain FVTPL');
  assert(r2.scenarioState.projectedMeasurementBasis === 'FVOCI', 'Turn 2 projected basis must be FVOCI');

  // Turn 3: Re-ask or compare with FVTPL
  const q3 = "what if the investment was FVTPL instead";
  const r3 = await processAccountingQuery(q3, r2.scenarioState, 'SFRS_I');
  assert(r3.scenarioState.actualMeasurementBasis === 'FVTPL', 'Turn 3 actual basis must remain FVTPL');
  assert(r3.scenarioState.projectedMeasurementBasis === 'FVTPL', 'Turn 3 projected basis must be FVTPL');
  // In FVTPL, P&L stock gain and FX gain exist
  const t3Lines = r3.scenarioState.directGroups.flatMap(g => g.lines);
  const fxGainLine = t3Lines.find(l => l.accountName.toLowerCase().includes('foreign exchange gain'));
  assert(Boolean(fxGainLine), 'FVTPL projection must include Realized FX Gain in P&L');

  // Turn 4: Back to FVOCI
  const q4 = "and what if it was classified as FVOCI";
  const r4 = await processAccountingQuery(q4, r3.scenarioState, 'SFRS_I');
  assert(r4.scenarioState.actualMeasurementBasis === 'FVTPL', 'Turn 4 actual basis must remain FVTPL');
  assert(r4.scenarioState.projectedMeasurementBasis === 'FVOCI', 'Turn 4 projected basis must be FVOCI');
  assert(r4.scenarioState.directGroups[0].totalDebit > 0, 'Turn 4 amounts must still be preserved');

  console.log('✅ Test D Passed: Alternating projections FVTPL -> FVOCI -> FVTPL -> FVOCI maintain stability and independence\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST E: Exact User Turn 1 Rates with Specific Historical/User Spot Rates
// --------------------------------------------------------------------------
console.log('--- TEST E: Exact Amounts Preservation with User Specified Rates ---');
{
  const q1 = "A company primary currency is SGD, it invested USD300k into 300 apple shares at 1.3004 on 13/11/2025, subsequently sold for USD400k at 1.2889 on 15/12/2025. What are the entries?";
  const r1 = await processAccountingQuery(q1, null, 'SFRS_I');

  const q2 = "what if the investment is FVOCI show me the double entry";
  const r2 = await processAccountingQuery(q2, r1.scenarioState, 'SFRS_I');

  // Initial cost = 300,000 * 1.3004 = 390,120
  // Proceeds = 400,000 * 1.2889 = 515,560
  // Total OCI gain = 515,560 - 390,120 = 125,440
  const acqGroup = r2.scenarioState.directGroups[0];
  const dispGroup = r2.scenarioState.directGroups[1];

  assert(Math.abs(acqGroup.totalDebit - 390120) < 1, `Acquisition debit must be 390,120, got ${acqGroup.totalDebit}`);
  assert(Math.abs(dispGroup.totalDebit - 515560) < 1, `Disposal debit must be 515,560, got ${dispGroup.totalDebit}`);

  const ociLine = dispGroup.lines.find(l => l.accountName.toLowerCase().includes('fair value reserve'));
  assert(Boolean(ociLine), 'Must have Fair Value Reserve line');
  assert(Math.abs(ociLine.credit - 125440) < 1, `OCI Reserve credit must be 125,440, got ${ociLine?.credit}`);

  console.log('✅ Test E Passed: Spot rates 1.3004 and 1.2889 produce exact amounts SGD 390,120 / SGD 515,560 / SGD 125,440\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST F: Ownership Context Guardrail: Own Equity CANNOT be FVTPL / FVOCI
// --------------------------------------------------------------------------
console.log('--- TEST F: Guardrail: Own Equity Cannot Be FVTPL / FVOCI ---');
{
  const q1 = "shareholder has invested in own company share capital of $1 but unpaid what's the double entry";
  const r1 = await processAccountingQuery(q1, null, 'SFRS_I');

  // Following up with "what if this is FVOCI" on own share capital
  const q2 = "what if this share capital is FVOCI";
  const r2 = await processAccountingQuery(q2, r1.scenarioState, 'SFRS_I');
  assert(r2.scenarioState !== undefined, 'Turn 2 scenarioState must be defined');

  // Semantic understanding must reject FVOCI on own equity (SFRS(I) 1-32 §33)
  const understanding = defaultTransactionUnderstandingService.understandTransactionSync(
    q2,
    'SGD',
    'SG',
    extractAccountingContext(r1.scenarioState)
  );

  assert(understanding.ownershipContext === 'own_equity', 'Ownership context must be own_equity');
  assert(understanding.measurementBasis === 'UNKNOWN' || understanding.actualMeasurementBasis === 'UNKNOWN',
    'Own equity must not be assigned FVTPL or FVOCI measurement basis');

  console.log('✅ Test F Passed: Own equity cannot be designated at FVOCI/FVTPL under SFRS(I) 1-32 §33\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST G: Subsequent Actual Turn After Hypothetical Branch
// --------------------------------------------------------------------------
console.log('--- TEST G: Subsequent Actual Turn After Hypothetical Branch ---');
{
  // Turn 1: Actual Allotment of $10,000 unpaid
  const q1 = "shareholder has invested in own company share capital of SGD 10000 but unpaid what's the double entry";
  const r1 = await processAccountingQuery(q1, null, 'SFRS_I');
  assert(!r1.scenarioState.isHypothetical, 'Turn 1 must be actual');
  const t1ActualEvents = r1.scenarioState.actualEvents?.length || 1;

  // Turn 2: Hypothetical follow-up
  const q2 = "what if shareholder paid SGD 4000 to bank";
  const r2 = await processAccountingQuery(q2, r1.scenarioState, 'SFRS_I');
  assert(r2.scenarioState.isHypothetical === true, 'Turn 2 must be hypothetical');

  // Turn 3: Actual payment of $5,000
  const q3 = "the shareholder paid SGD 5000 into company bank account today";
  const r3 = await processAccountingQuery(q3, r2.scenarioState, 'SFRS_I');
  assert(!r3.scenarioState.isHypothetical, 'Turn 3 must be an actual settlement event');

  // Invariant: Turn 2's hypothetical event did NOT enter actualEvents
  assert(r3.scenarioState.actualEvents.length === t1ActualEvents + 1,
    `actualEvents must contain exactly Turn 1 + Turn 3 (${t1ActualEvents + 1}), got ${r3.scenarioState.actualEvents.length}`);

  for (const evt of r3.scenarioState.actualEvents) {
    assert(!evt.isHypothetical, `Actual event ${evt.id} must not be marked hypothetical`);
  }

  // Invariant: Committed groups must only contain Turn 1 allotment + Turn 3 settlement
  assert(r3.scenarioState.committedDirectGroups.length === 2,
    `Committed groups must have 2 actual groups, got ${r3.scenarioState.committedDirectGroups.length}`);

  console.log('✅ Test G Passed: Hypothetical branch does not pollute committed history upon subsequent actual turn\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST H: Generic Lease: Lease Contract & ROU Asset Preserved in Follow-Up
// --------------------------------------------------------------------------
console.log('--- TEST H: Generic Lease Contract & ROU Asset Preservation ---');
{
  const q1 = "A company entered into a 3-year office lease paying SGD 3,000 monthly";
  const u1 = defaultTransactionUnderstandingService.understandTransactionSync(q1, 'SGD', 'SG');
  assert(u1.transactionType === 'lease_contract', `u1 transactionType must be lease_contract, got ${u1.transactionType}`);
  assert(u1.instrument === 'right_of_use_asset', `u1 instrument must be right_of_use_asset, got ${u1.instrument}`);
  assert(u1.amount === 3000, `u1 amount must be 3000, got ${u1.amount}`);

  const ctx = {
    underlyingTransaction: {
      transactionId: 'tx-lease-1',
      type: u1.transactionType,
      subject: '3-Year Commercial Office Lease',
      ownershipContext: u1.ownershipContext,
      instrument: u1.instrument,
      totalAmount: 3000,
      currency: 'SGD',
      functionalCurrency: 'SGD'
    },
    actualEvents: [],
    outstandingBalances: [],
    recognizedEquityTotal: 0,
    priorJournals: []
  };

  const q2 = "what if the monthly rent was SGD 3,500 instead";
  const u2 = defaultTransactionUnderstandingService.understandTransactionSync(q2, 'SGD', 'SG', ctx);
  assert(u2.transactionType === 'lease_contract', `u2 must inherit lease_contract, got ${u2.transactionType}`);
  assert(u2.amount === 3500, `u2 must extract new amount 3500, got ${u2.amount}`);
  assert(u2.followUpAnalysis?.isHypothetical === true, 'u2 followUpAnalysis must be flagged hypothetical');

  // Verify journal balancing under SFRS(I) 16
  const leaseScenario1 = {
    scenarioType: 'LEASE_IFRS16',
    leaseTermYears: 3,
    leaseTermMonths: 36,
    leasePaymentMonthly: 3000,
    leaseDiscountRateAnnual: 5.0,
    functionalCurrency: 'SGD',
    transactionCurrency: 'SGD'
  };
  const entries1 = calculateDoubleEntries(leaseScenario1, 'SFRS_I');
  for (const grp of entries1.groups) {
    const val = validateJournalBalance(grp);
    assert(val.isBalanced, `Lease group ${grp.title} must be balanced`);
  }

  const leaseScenario2 = {
    scenarioType: 'LEASE_IFRS16',
    leaseTermYears: 3,
    leaseTermMonths: 36,
    leasePaymentMonthly: 3500,
    leaseDiscountRateAnnual: 5.0,
    functionalCurrency: 'SGD',
    transactionCurrency: 'SGD'
  };
  const entries2 = calculateDoubleEntries(leaseScenario2, 'SFRS_I');
  for (const grp of entries2.groups) {
    const val = validateJournalBalance(grp);
    assert(val.isBalanced, `Lease hypothetical group ${grp.title} must be balanced`);
  }

  console.log('✅ Test H Passed: Generic lease contract facts and balanced journal entries preserved\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST I: Generic Receivable: Trade Receivable & Settlement Tracking
// --------------------------------------------------------------------------
console.log('--- TEST I: Generic Receivable & Settlement Tracking ---');
{
  const q1 = "Company provided consulting services of SGD 10,000 on credit to Client ABC";
  const u1 = defaultTransactionUnderstandingService.understandTransactionSync(q1, 'SGD', 'SG');
  assert(u1.transactionType === 'customer_invoice', `u1 must be customer_invoice, got ${u1.transactionType}`);
  assert(u1.instrument === 'accounts_receivable', `u1 instrument must be accounts_receivable, got ${u1.instrument}`);
  assert(u1.amount === 10000, `u1 amount must be 10000, got ${u1.amount}`);

  const ctx = {
    underlyingTransaction: {
      transactionId: 'tx-inv-101',
      type: u1.transactionType,
      subject: 'Consulting Services to Client ABC',
      ownershipContext: u1.ownershipContext,
      instrument: u1.instrument,
      totalAmount: 10000,
      currency: 'SGD',
      functionalCurrency: 'SGD'
    },
    actualEvents: [],
    outstandingBalances: [{
      balanceKey: '1100_customer_tx-inv-101',
      accountCode: '1100',
      accountName: 'Accounts Receivable (Client ABC)',
      currency: 'SGD',
      initialAmount: 10000,
      settledAmount: 0,
      remainingAmount: 10000,
      counterpartyRole: 'customer',
      nature: 'ASSET',
      transactionId: 'tx-inv-101'
    }],
    recognizedEquityTotal: 0,
    priorJournals: []
  };

  const q2 = "Client ABC paid SGD 6,000 by bank transfer";
  const u2 = defaultTransactionUnderstandingService.understandTransactionSync(q2, 'SGD', 'SG', ctx);
  assert(u2.followUpAnalysis?.eventType === 'partial_settlement' || u2.followUpAnalysis?.eventType === 'settlement',
    `u2 must be recognized as settlement event, got ${u2.followUpAnalysis?.eventType}`);
  assert(u2.followUpAnalysis?.settlementAmount === 6000, `Settlement amount must be 6000, got ${u2.followUpAnalysis?.settlementAmount}`);

  const delta = calculateAccountingDelta(ctx, u2.followUpAnalysis, 'SGD');
  assert(Boolean(delta), 'calculateAccountingDelta must succeed for customer settlement');
  assert(delta.balanceUpdates[0]?.resultingBalance === 4000, `Remaining receivable must be 4000, got ${delta.balanceUpdates[0]?.resultingBalance}`);

  console.log('✅ Test I Passed: Generic trade receivable tracking and partial settlement verified\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST J: Generic Debt: Bank Loan & Principal Repayment Tracking
// --------------------------------------------------------------------------
console.log('--- TEST J: Generic Debt & Principal Repayment Tracking ---');
{
  const q1 = "Company took a bank loan of SGD 100,000";
  const u1 = defaultTransactionUnderstandingService.understandTransactionSync(q1, 'SGD', 'SG');
  assert(u1.transactionType === 'debt_settlement', `u1 must be debt_settlement, got ${u1.transactionType}`);
  assert(u1.instrument === 'debt_instrument', `u1 instrument must be debt_instrument, got ${u1.instrument}`);
  assert(u1.amount === 100000, `u1 amount must be 100000, got ${u1.amount}`);

  const ctx = {
    underlyingTransaction: {
      transactionId: 'tx-loan-201',
      type: u1.transactionType,
      subject: 'Bank Loan Borrowing',
      ownershipContext: u1.ownershipContext,
      instrument: u1.instrument,
      totalAmount: 100000,
      currency: 'SGD',
      functionalCurrency: 'SGD'
    },
    actualEvents: [],
    outstandingBalances: [{
      balanceKey: '2100_lender_tx-loan-201',
      accountCode: '2100',
      accountName: 'Bank Loan (Borrowing)',
      currency: 'SGD',
      initialAmount: 100000,
      settledAmount: 0,
      remainingAmount: 100000,
      counterpartyRole: 'lender',
      nature: 'LIABILITY',
      transactionId: 'tx-loan-201'
    }],
    recognizedEquityTotal: 0,
    priorJournals: []
  };

  const q2 = "Company repaid SGD 30,000 loan principal by bank transfer";
  const u2 = defaultTransactionUnderstandingService.understandTransactionSync(q2, 'SGD', 'SG', ctx);
  assert(u2.followUpAnalysis?.eventType === 'partial_settlement' || u2.followUpAnalysis?.eventType === 'settlement',
    `u2 must be recognized as settlement, got ${u2.followUpAnalysis?.eventType}`);
  assert(u2.followUpAnalysis?.settlementAmount === 30000, `Settlement amount must be 30000, got ${u2.followUpAnalysis?.settlementAmount}`);

  const delta = calculateAccountingDelta(ctx, u2.followUpAnalysis, 'SGD');
  assert(Boolean(delta), 'calculateAccountingDelta must succeed for loan repayment');
  assert(delta.balanceUpdates[0]?.resultingBalance === 70000, `Remaining debt must be 70000, got ${delta.balanceUpdates[0]?.resultingBalance}`);

  console.log('✅ Test J Passed: Generic bank debt tracking and principal repayment verified\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST K: Controlled Diagnostic Notice on Unsupported/Unknown Basis
// --------------------------------------------------------------------------
console.log('--- TEST K: Controlled Diagnostic Notice on Unsupported/Unknown Basis ---');
{
  const ownEquityCtx = {
    underlyingTransaction: {
      transactionId: 'tx-oe-1',
      type: 'share_capital_issuance',
      subject: 'Own share capital allotment',
      ownershipContext: 'own_equity',
      instrument: 'own_equity',
      totalAmount: 1000,
      currency: 'SGD',
      functionalCurrency: 'SGD'
    },
    actualEvents: [],
    outstandingBalances: [],
    recognizedEquityTotal: 1000,
    priorJournals: []
  };

  // 1. Prohibits FVOCI on own equity (SFRS(I) 1-32 §33)
  const resFvoci = buildAccountingMeasurementProjection({
    committedContext: ownEquityCtx,
    requestedBasis: 'FVOCI'
  });
  assert(!resFvoci.success, 'buildAccountingMeasurementProjection must fail for FVOCI on own equity');
  assert(Boolean(resFvoci.diagnosticNotice), 'Must provide diagnostic notice');
  assert(resFvoci.diagnosticNotice.includes('SFRS(I) 1-32 §33'), `Diagnostic must cite SFRS(I) 1-32 §33, got: ${resFvoci.diagnosticNotice}`);

  // 2. Prohibits UNKNOWN basis
  const resUnknown = buildAccountingMeasurementProjection({
    committedContext: ownEquityCtx,
    requestedBasis: 'UNKNOWN'
  });
  assert(!resUnknown.success, 'buildAccountingMeasurementProjection must fail for UNKNOWN basis');
  assert(resUnknown.diagnosticNotice.includes('UNKNOWN'), `Diagnostic must state basis is UNKNOWN, got: ${resUnknown.diagnosticNotice}`);

  console.log('✅ Test K Passed: Controlled diagnostic notice on unsupported/unknown measurement basis verified\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST L: Explicit Balance Assertion Across All Direct Groups
// --------------------------------------------------------------------------
console.log('--- TEST L: Explicit Balance Assertion (validateJournalBalance) Across All Groups ---');
{
  const q1 = "A company primary currency is SGD, it invested USD300k into 300 apple shares at 1.3004 on 13/11/2025, subsequently sold for USD400k at 1.2889 on 15/12/2025. What are the entries?";
  const r1 = await processAccountingQuery(q1, null, 'SFRS_I');

  const q2 = "what if the investment is FVOCI show me the double entry";
  const r2 = await processAccountingQuery(q2, r1.scenarioState, 'SFRS_I');

  const allGroups = [
    ...(r1.scenarioState.directGroups || []),
    ...(r2.scenarioState.directGroups || []),
    ...(r2.scenarioState.committedDirectGroups || []),
    ...(r2.scenarioState.projectedGroups || [])
  ];

  assert(allGroups.length > 0, 'Must have generated groups to validate');
  for (const grp of allGroups) {
    const val = validateJournalBalance(grp);
    assert(val.isBalanced, `Group ${grp.title} must be balanced: debits=${val.totalDebit}, credits=${val.totalCredit}`);
    assert(Math.abs(val.imbalance) < 0.01, `Group ${grp.title} imbalance must be 0, got ${val.imbalance}`);
  }

  console.log(`✅ Test L Passed: All ${allGroups.length} generated groups strictly balanced via validateJournalBalance\n`);
  testsPassed++;
}

// --------------------------------------------------------------------------
// SUMMARY
// --------------------------------------------------------------------------
console.log('================================================================');
console.log(`🎉 ALL ${testsPassed} FVOCI FOLLOW-UP TESTS PASSED SUCCESSFULLY! (Failed: ${testsFailed})`);
console.log('================================================================');

