import assert from 'node:assert/strict';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import { processAccountingQuery, renderStructuredOfflineResponse } from '../../src/services/geminiService.ts';
import {
  hasSameTransactionPriorMonetaryEvidence,
  hasVerifiedImageMonetaryEvidence,
  updateCommittedJournalScenario
} from '../../src/services/committedJournal.ts';
import {
  hasMonetaryEvidence,
  hasVerifiedNumericImageEvidence,
  validateJournalGroups
} from '../../src/verification/journalIntegrity.ts';

console.log('=== RUNNING STEP 1 PPE, TRADE DISCOUNT & INTEGRITY REGRESSION SUITE ===\n');

const mockedOnlineProvider = {
  activeProvider: 'openai',
  openai: { apiKey: 'sk-test-1234567890abcdef', model: 'gpt-4o' }
};

async function withMockedFetch(handler, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// ---------------------------------------------------------------------------
// 1. ACC-05: hasMonetaryEvidence & validateJournalGroups Rule 6
// ---------------------------------------------------------------------------
for (const nonMonetary of [
  '15 May 2026',
  '01/08/2026',
  '2026-07-01',
  'September 2026',
  '2026',
  '1998',
  '15%',
  '9%',
  '62-year-old',
  'age 62',
  '3-year',
  '4 years',
  '12 months',
  '30 days',
  'IAS 16',
  'IFRS 16',
  'SFRS(I) 1-16',
  'INV-2026-009',
  'Ref #456',
  'Section 14',
  'GL 130',
  'PO-2026-01',
  '100 shares',
  'On 15 May 2026, record trade-in under IAS 16 Section 14 with INV-2026-009 at 15% over 4 years'
]) {
  assert.equal(hasMonetaryEvidence(nonMonetary), false, `Non-monetary text must return false: ${nonMonetary}`);
}

for (const monetary of [
  'SGD 500',
  'S$0',
  '$1',
  'USD 50,000',
  '5k',
  '60k',
  '10m',
  '50 cents',
  'five thousand dollars',
  'fifty cents',
  'one dollar',
  'paid 500 for office supplies',
  'earning 5000 a month',
  'sold goods for 1,800'
]) {
  assert.equal(hasMonetaryEvidence(monetary), true, `Genuine monetary text must return true: ${monetary}`);
}

// Sample balanced group for Rule 6 checks
const sampleBalancedGroup = {
  id: 'g-sample',
  eventDate: '15/05/2026',
  title: 'Sample Entry',
  summary: 'Sample Entry',
  lines: [
    { id: 'l1', accountCode: '1500', accountName: 'Machinery - Cost', category: 'ASSET', debit: 1000, credit: 0, lineExplanation: 'Debit' },
    { id: 'l2', accountCode: '1010', accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 1000, lineExplanation: 'Credit' }
  ],
  totalDebit: 1000,
  totalCredit: 1000,
  isBalanced: true,
  citations: [],
  rationalePoints: [],
  authorityStatus: 'DETERMINISTIC'
};

for (const nonMonetaryQuery of [
  'Prepare journal entry on 15 May 2026 under IAS 16 Section 14',
  'Record INV-2026-009 with 15% discount on 15 May 2026'
]) {
  const res = validateJournalGroups([sampleBalancedGroup], { rawQuery: nonMonetaryQuery });
  assert.equal(res.isValid, false, `Must reject UNSTATED_AMOUNT for: ${nonMonetaryQuery}`);
  assert.ok(res.issues.some(i => i.code === 'UNSTATED_AMOUNT'));
}

// ---------------------------------------------------------------------------
// 2. ACC-01: PPE_IAS16
// ---------------------------------------------------------------------------
// PPE-1b: Offline, zero digits -> incomplete, uncommitted, directGroups: []
{
  const q = 'A company trades in an old machine for new machinery. Prepare the journal entries.';
  const parsed = await parseAccountingQuery(q, null);
  assert.equal(parsed.scenarioType, 'PPE_IAS16');
  assert.equal(parsed.isComplete, false, 'PPE-1b must be incomplete');
  assert.deepEqual(parsed.directGroups, [], 'PPE-1b must have empty directGroups');
  assert.ok(parsed.missingFields.length > 0, 'PPE-1b must declare missingFields');
  assert.equal(updateCommittedJournalScenario(null, parsed, 'SFRS_I'), null, 'PPE-1b must stay uncommitted');

  const offlineRes = await processAccountingQuery(q, null, 'SFRS_I');
  assert.equal(offlineRes.scenarioState.isComplete, false);
  assert.deepEqual(offlineRes.scenarioState.directGroups, []);
  const rendered = renderStructuredOfflineResponse(parsed, 'SFRS_I');
  assert.doesNotMatch(rendered.messageText, /100,000|50,000|21,800|01\/04\/2026|1 April 2026/);
}

// PPE-2b: Mocked-online, date digit only (15 May 2026) -> incomplete, uncommitted, UNSTATED_AMOUNT not defeated by date
{
  const q = 'On 15 May 2026, a company trades in an old machine for new machinery. Prepare the journal entries.';
  const fabricatedAiPayload = {
    transactionTitle: 'Machinery Trade-In',
    directGroups: [
      {
        id: 'ai-fab-1',
        eventDate: '15/05/2026',
        title: 'Fabricated Trade-In',
        summary: 'Fabricated',
        lines: [
          { id: '1', accountCode: '1600', accountName: 'Machinery - Cost', category: 'ASSET', debit: 100000, credit: 0, lineExplanation: 'Dr' },
          { id: '2', accountCode: '1010', accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 100000, lineExplanation: 'Cr' }
        ],
        totalDebit: 100000,
        totalCredit: 100000,
        isBalanced: true,
        citations: [],
        rationalePoints: []
      }
    ],
    accountingTreatmentSummary: 'Fabricated AI journal'
  };
  const res = await withMockedFetch(async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(fabricatedAiPayload) } }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }), () =>
    processAccountingQuery(q, null, 'SFRS_I', mockedOnlineProvider)
  );
  assert.equal(res.scenarioState.isComplete, false, 'PPE-2b must stay incomplete');
  assert.deepEqual(res.scenarioState.directGroups, [], 'PPE-2b must not emit fabricated journal groups');
  assert.equal(updateCommittedJournalScenario(null, res.scenarioState, 'SFRS_I'), null, 'PPE-2b must not commit');
}

// PPE-3b: Missing old machine acquisition date / accumulated depreciation -> incomplete, uncommitted
{
  const q = 'On 15 May 2026, a company purchases new machinery for SGD 40,000 (no GST) with a trade-in of an old machine costing SGD 25,000 at an agreed trade-in value of SGD 10,000, and pays SGD 30,000 cash. Prepare the journal entries.';
  const parsed = await parseAccountingQuery(q, null);
  assert.equal(parsed.scenarioType, 'PPE_IAS16');
  assert.equal(parsed.isComplete, false, 'PPE-3b must fail closed without accumulated depreciation or acquisition date/rate');
  assert.deepEqual(parsed.directGroups, []);
  assert.ok(parsed.missingFields.some(f => f.fieldKey === 'accumulatedDepreciation'));
  assert.equal(updateCommittedJournalScenario(null, parsed, 'SFRS_I'), null);
}

// Complete custom non-default PPE trade-in (offline + mocked-online + zero cash + gain on disposal)
{
  const qCustom = 'On 15 May 2026, a company purchases new machinery for SGD 40,000 (no GST). The vendor accepts an old machine with an agreed trade-in value of SGD 12,000. Old machine original cost was SGD 25,000 with accumulated depreciation of SGD 15,000. Cash paid via bank transfer is SGD 0 and the remaining balance is funded via a 3-year equipment loan at 4% per annum flat interest. Prepare the journal entries.';
  const parsed = await parseAccountingQuery(qCustom, null);
  assert.equal(parsed.scenarioType, 'PPE_IAS16');
  assert.equal(parsed.isComplete, true, 'Complete custom PPE trade-in must succeed');
  // Catch-up depr is 0 -> omitted, so 2 groups (disposal + acquisition)
  assert.equal(parsed.directGroups?.length, 2, 'Zero catch-up depreciation group must be omitted');

  const dispGrp = parsed.directGroups[0];
  assert.equal(dispGrp.eventDate, '15/05/2026');
  // Old cost 25,000, acc depr 15,000 -> NBV 10,000; trade-in 12,000 -> Gain 2,000
  const gainLine = dispGrp.lines.find(l => l.accountCode === '4520');
  assert.equal(gainLine?.category, 'REVENUE');
  assert.equal(gainLine?.credit, 2000, 'Gain on disposal must be SGD 2,000');
  assert.equal(dispGrp.lines.some(l => l.accountCode === '5520'), false, 'No loss line on gain disposal');
  assert.equal(dispGrp.lines.some(l => l.accountCode === '2200'), false, 'Zero output GST line omitted');
  assert.equal(dispGrp.totalDebit, 27000);
  assert.equal(dispGrp.totalCredit, 27000);

  const acqGrp = parsed.directGroups[1];
  assert.equal(acqGrp.eventDate, '15/05/2026');
  // Loan principal = 40,000 - 12,000 - 0 = 28,000; flat interest = 28,000 * 4% * 3 = 3,360; gross = 31,360
  assert.equal(acqGrp.lines.some(l => l.accountCode === '1010'), false, 'Explicit SGD 0 cash paid must omit Cash at Bank line');
  assert.equal(acqGrp.lines.some(l => l.accountCode === '1190'), false, 'Zero input GST line omitted');
  assert.equal(acqGrp.lines.find(l => l.accountCode === '2520')?.debit, 3360);
  assert.equal(acqGrp.lines.find(l => l.accountCode === '2510')?.credit, 31360);
  assert.equal(acqGrp.totalDebit, 43360);
  assert.equal(acqGrp.totalCredit, 43360);
  assert.equal(validateJournalGroups(parsed.directGroups, { rawQuery: qCustom }).isValid, true);

  const offlineRes = await processAccountingQuery(qCustom, null, 'SFRS_I');
  assert.equal(offlineRes.scenarioState.isComplete, true);
  assert.match(offlineRes.messageText, /15\/05\/2026/);
  assert.match(offlineRes.messageText, /40,000/);
  assert.match(offlineRes.messageText, /31,360/);
  assert.doesNotMatch(offlineRes.messageText, /100,000|50,000|21,800|62,920|01\/04\/2026|1 April 2026/);
}

// PPE-4: Conflicting cash + trade-in > cost -> incomplete, uncommitted, zero negative lines
{
  const qConflict = 'On 15 May 2026, a company purchases new machinery for SGD 30,000 (no GST) with a trade-in of an old machine costing SGD 20,000 (accumulated depreciation SGD 10,000) at an agreed trade-in value of SGD 15,000, and pays SGD 20,000 cash via bank transfer. Prepare the journal entries.';
  const parsed = await parseAccountingQuery(qConflict, null);
  assert.equal(parsed.isComplete, false, 'PPE-4 conflicting cash + trade-in > cost must fail closed');
  assert.deepEqual(parsed.directGroups, []);
  assert.ok(parsed.missingFields.some(f => f.fieldKey === 'paymentConflict'));
  assert.equal(updateCommittedJournalScenario(null, parsed, 'SFRS_I'), null);
}

// PPE-5: Routine annual depreciation query -> NOT misrouted to PPE_IAS16 trade-in template
{
  const qRoutineDepr = 'Prepare the journal entry for annual depreciation of machinery costing SGD 12,000 over 4 years.';
  const parsed = await parseAccountingQuery(qRoutineDepr, null);
  assert.notEqual(parsed.scenarioType, 'PPE_IAS16', 'PPE-5 must not misroute routine depreciation to PPE_IAS16 trade-in');
  for (const grp of parsed.directGroups || []) {
    for (const line of grp.lines) {
      assert.ok(line.debit >= 0 && line.credit >= 0, 'PPE-5 must never produce negative lines');
    }
  }
}

// ---------------------------------------------------------------------------
// 3. ACC-02: ASSET_PURCHASE_DISCOUNT
// ---------------------------------------------------------------------------
// DISC-1: Offline, 0 digits -> incomplete, uncommitted
{
  const q = 'A company purchases office equipment with a trade discount on credit terms. Prepare the journal entry.';
  const parsed = await parseAccountingQuery(q, null);
  assert.equal(parsed.scenarioType, 'ASSET_PURCHASE_DISCOUNT');
  assert.equal(parsed.isComplete, false, 'DISC-1 must be incomplete');
  assert.deepEqual(parsed.directGroups, []);
  assert.equal(updateCommittedJournalScenario(null, parsed, 'SFRS_I'), null);
}

// DISC-2: Mocked-online, only 15% -> incomplete, uncommitted
{
  const q = 'A company purchases office equipment with a 15% trade discount on credit terms. Prepare the journal entry.';
  const fabricatedDiscountPayload = {
    transactionTitle: 'Office Equipment Purchase',
    directGroups: [
      {
        id: 'ai-disc-fab',
        eventDate: '01/08/2026',
        title: 'Fabricated Discount Entry',
        summary: 'Fabricated',
        lines: [
          { id: '1', accountCode: '1500', accountName: 'Office Equipment - Cost', category: 'ASSET', debit: 17000, credit: 0, lineExplanation: 'Dr' },
          { id: '2', accountCode: '2010', accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 17000, lineExplanation: 'Cr' }
        ],
        totalDebit: 17000,
        totalCredit: 17000,
        isBalanced: true,
        citations: [],
        rationalePoints: []
      }
    ]
  };
  const res = await withMockedFetch(async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(fabricatedDiscountPayload) } }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }), () =>
    processAccountingQuery(q, null, 'SFRS_I', mockedOnlineProvider)
  );
  assert.equal(res.scenarioState.isComplete, false, 'DISC-2 must remain incomplete');
  assert.deepEqual(res.scenarioState.directGroups, []);
  assert.equal(updateCommittedJournalScenario(null, res.scenarioState, 'SFRS_I'), null);
}

// DISC-3-OFFLINE: Explicit SGD 0 cash + Computer Equipment + 9% GST -> balanced 3-line entry omitting Bank line
{
  const q = 'On 10 September 2026, a GST-registered company purchases computer equipment with a list price of SGD 12,000 (exclusive of 9% GST). The vendor grants a 20% trade discount on the list price. The company pays SGD 0 immediately and places the remaining balance on credit terms. Prepare the journal entry.';
  const res = await processAccountingQuery(q, null, 'SFRS_I');
  assert.equal(res.scenarioState.scenarioType, 'ASSET_PURCHASE_DISCOUNT');
  assert.equal(res.scenarioState.isComplete, true);
  assert.equal(res.scenarioState.directGroups?.length, 1);

  const grp = res.scenarioState.directGroups[0];
  assert.equal(grp.eventDate, '10/09/2026');
  // 12,000 * 0.8 = 9,600; 9% GST = 864; total = 10,464
  assert.equal(grp.lines.length, 3, 'Must omit Cash at Bank line when immediateCash === 0');
  assert.equal(grp.lines.some(l => l.accountCode === '1010'), false);
  assert.equal(grp.lines.find(l => l.accountCode === '1500')?.debit, 9600);
  assert.equal(grp.lines.find(l => l.accountCode === '1190')?.debit, 864);
  assert.equal(grp.lines.find(l => l.accountCode === '2010')?.credit, 10464);
  assert.equal(grp.totalDebit, 10464);
  assert.equal(grp.totalCredit, 10464);
  assert.equal(grp.isBalanced, true);
  assert.match(res.messageText, /Computer Equipment/);
  assert.match(res.messageText, /10,464\.00 == SGD 10,464\.00 ✓ Balanced/);
  assert.doesNotMatch(res.messageText, /5,000|15,464\.00|Office Equipment/);
}

// DISC-4: Conflicting cash 15,000 > invoice 9,810 -> incomplete, uncommitted, no negative payable
{
  const q = 'Purchases office equipment with a list price of SGD 10,000 (exclusive of 9% GST), 10% trade discount, paid SGD 15,000 immediately by bank transfer with remaining balance on credit terms.';
  const parsed = await parseAccountingQuery(q, null);
  assert.equal(parsed.isComplete, false, 'DISC-4 must fail closed when immediateCash > grossInvoice');
  assert.deepEqual(parsed.directGroups, []);
  assert.ok(parsed.missingFields.some(f => f.fieldKey === 'paymentConflict'));
  assert.equal(updateCommittedJournalScenario(null, parsed, 'SFRS_I'), null);
}

// ---------------------------------------------------------------------------
// 4. ACC-05: Follow-ups, Image Evidence, Scenario Isolation & Fast-Path Gate
// ---------------------------------------------------------------------------
// Valid same-transaction follow-up with no dollar digit in Turn 2 (ASSET_PURCHASE_DISCOUNT)
{
  const turn1Query = 'On 1 August 2026, a GST-registered company purchases office equipment with a list price of SGD 20,000 (exclusive of 9% GST). The vendor grants a 10% trade discount on the list price. The company pays SGD 5,000 immediately by bank transfer and the remaining balance is placed on credit terms. Prepare the single compound journal entry on 1 August 2026.';
  const turn1Res = await processAccountingQuery(turn1Query, null, 'SFRS_I');
  const committed1 = updateCommittedJournalScenario(null, turn1Res.scenarioState, 'SFRS_I', false, {
    rawQuery: turn1Query,
    evidenceTexts: [turn1Query]
  });
  assert.ok(committed1, 'Turn 1 discount scenario must commit');

  const turn2Query = 'Settle the remaining balance by bank transfer on 15 August 2026';
  const turn2Res = await processAccountingQuery(turn2Query, committed1, 'SFRS_I');
  assert.equal(turn2Res.scenarioState.isComplete, true);
  assert.equal(turn2Res.scenarioState.directGroups?.length, 2);
  assert.equal(turn2Res.scenarioState.directGroups[1].eventDate, '15/08/2026');
  assert.equal(turn2Res.scenarioState.directGroups[1].totalDebit, 14620);

  const committed2 = updateCommittedJournalScenario(committed1, turn2Res.scenarioState, 'SFRS_I', false, {
    rawQuery: turn2Query,
    evidenceTexts: [turn1Query, turn2Query]
  });
  assert.ok(committed2, 'Valid same-transaction settlement follow-up without dollar digit must commit');
  assert.equal(committed2.committedDirectGroups?.length, 2);
}

// Valid image-backed follow-up (totalAmount: 1200, Turn 2: "Record payment by bank transfer")
{
  const imageBackedPrior = {
    scenarioType: 'UNIVERSAL',
    rawQuery: 'Attached invoice',
    transactionTitle: 'Equipment invoice from image',
    functionalCurrency: 'SGD',
    transactionCurrency: 'SGD',
    isComplete: true,
    missingFields: [],
    imageEvidence: [{
      imageId: 'img-1',
      documentType: 'accounting_transaction',
      fields: [{ source: 'image', imageId: 'img-1', field: 'totalAmount', value: 1200 }]
    }],
    directGroups: [{
      id: 'g-img-1',
      eventDate: '15/05/2026',
      title: 'Equipment Purchase',
      summary: 'Purchase',
      lines: [
        { id: '1', accountCode: '1500', accountName: 'Office Equipment', category: 'ASSET', debit: 1200, credit: 0, lineExplanation: 'Dr' },
        { id: '2', accountCode: '2010', accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1200, lineExplanation: 'Cr' }
      ],
      totalDebit: 1200,
      totalCredit: 1200,
      isBalanced: true,
      citations: [],
      rationalePoints: [],
      authorityStatus: 'DETERMINISTIC'
    }]
  };
  assert.equal(hasVerifiedImageMonetaryEvidence(imageBackedPrior), true);
  assert.equal(hasVerifiedNumericImageEvidence(imageBackedPrior.imageEvidence), true);

  const imageFollowUpCandidate = {
    scenarioType: 'UNIVERSAL',
    rawQuery: 'Record payment by bank transfer',
    transactionTitle: 'Settlement of Equipment Payable',
    functionalCurrency: 'SGD',
    transactionCurrency: 'SGD',
    isComplete: true,
    missingFields: [],
    imageEvidence: imageBackedPrior.imageEvidence,
    directGroups: [{
      id: 'g-img-2',
      eventDate: '20/05/2026',
      title: 'Payment by Bank Transfer',
      summary: 'Settlement',
      lines: [
        { id: '1', accountCode: '2010', accountName: 'Trade Payables', category: 'LIABILITY', debit: 1200, credit: 0, lineExplanation: 'Dr' },
        { id: '2', accountCode: '1010', accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 1200, lineExplanation: 'Cr' }
      ],
      totalDebit: 1200,
      totalCredit: 1200,
      isBalanced: true,
      citations: [],
      rationalePoints: [],
      authorityStatus: 'DETERMINISTIC'
    }]
  };
  const committedImgFollowUp = updateCommittedJournalScenario(imageBackedPrior, imageFollowUpCandidate, 'SFRS_I', false, {
    rawQuery: 'Record payment by bank transfer',
    evidenceTexts: ['Record payment by bank transfer']
  });
  assert.ok(committedImgFollowUp, 'Image-backed follow-up without dollar digit in query must commit');
}

// Unrelated / superseded transaction does NOT inherit prior monetary facts, and resetPrevious clears to null
{
  const validDiscountQuery = 'On 1 August 2026, a GST-registered company purchases office equipment with a list price of SGD 20,000 (exclusive of 9% GST). The vendor grants a 10% trade discount on the list price. The company pays SGD 5,000 immediately by bank transfer and the remaining balance is placed on credit terms. Prepare the single compound journal entry.';
  const validDiscountScenario = await parseAccountingQuery(validDiscountQuery, null);
  const committedDiscount = updateCommittedJournalScenario(null, validDiscountScenario, 'SFRS_I', false, {
    rawQuery: validDiscountQuery
  });
  assert.ok(committedDiscount);

  const unstatedPpeCandidate = {
    scenarioType: 'PPE_IAS16',
    rawQuery: 'Trade in old machinery on 15 May 2026',
    transactionTitle: 'Machinery Trade-In',
    functionalCurrency: 'SGD',
    transactionCurrency: 'SGD',
    isComplete: true,
    missingFields: [],
    directGroups: [{
      id: 'g-bad-ppe',
      eventDate: '15/05/2026',
      title: 'Fabricated PPE',
      summary: 'Fabricated',
      lines: [
        { id: '1', accountCode: '1600', accountName: 'Machinery - Cost', category: 'ASSET', debit: 50000, credit: 0, lineExplanation: 'Dr' },
        { id: '2', accountCode: '1010', accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 50000, lineExplanation: 'Cr' }
      ],
      totalDebit: 50000,
      totalCredit: 50000,
      isBalanced: true,
      citations: [],
      rationalePoints: [],
      authorityStatus: 'DETERMINISTIC'
    }]
  };
  assert.equal(hasSameTransactionPriorMonetaryEvidence(committedDiscount, unstatedPpeCandidate), false,
    'Unrelated PPE_IAS16 candidate must not inherit ASSET_PURCHASE_DISCOUNT monetary facts');
  assert.equal(updateCommittedJournalScenario(committedDiscount, unstatedPpeCandidate, 'SFRS_I', false, {
    rawQuery: 'Trade in old machinery on 15 May 2026',
    evidenceTexts: ['Trade in old machinery on 15 May 2026']
  }), committedDiscount, 'Invalid unrelated candidate preserves last valid committed journal');
  assert.equal(updateCommittedJournalScenario(committedDiscount, unstatedPpeCandidate, 'SFRS_I', true, {
    rawQuery: 'Trade in old machinery on 15 May 2026'
  }), null, 'resetPrevious = true clears committed journal to null');
}

// Deterministic fast-path rejects structurally invalid / negative-line groups
{
  const negativeFastPathRes = await processAccountingQuery(
    'On 1 August 2026, a GST-registered company purchases office equipment with a list price of SGD 10,000 (exclusive of 9% GST), 10% trade discount, paid SGD 20,000 immediately by bank transfer with remaining balance on credit terms. Prepare the journal entry.',
    null,
    'SFRS_I'
  );
  assert.equal(negativeFastPathRes.scenarioState.isComplete, false);
  assert.deepEqual(negativeFastPathRes.scenarioState.directGroups, []);
}

console.log('✅ PASS | Step 1 PPE, Trade Discount, and Journal Integrity regression suite passed.');
