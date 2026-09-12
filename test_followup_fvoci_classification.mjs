import { processAccountingQuery } from './src/services/geminiService.ts';
import { defaultTransactionUnderstandingService } from './src/services/transactionUnderstandingService.ts';
import {
  extractAccountingContext,
  calculateAccountingDelta
} from './src/services/conversationAccountingState.ts';

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
// SUMMARY
// --------------------------------------------------------------------------
console.log('================================================================');
console.log(`🎉 ALL ${testsPassed} FVOCI FOLLOW-UP TESTS PASSED SUCCESSFULLY! (Failed: ${testsFailed})`);
console.log('================================================================');
