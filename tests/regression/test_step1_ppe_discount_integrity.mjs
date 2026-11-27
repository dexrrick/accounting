import assert from 'node:assert/strict';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import { processAccountingQuery, renderStructuredOfflineResponse } from '../../src/services/geminiService.ts';
import {
  getDisplayableUncommittedJournalGroups,
  hasSameTransactionPriorMonetaryEvidence,
  hasVerifiedImageMonetaryEvidence,
  updateCommittedJournalScenario
} from '../../src/services/committedJournal.ts';
import {
  hasMonetaryEvidence,
  hasVerifiedNumericImageEvidence,
  validateJournalGroups
} from '../../src/verification/journalIntegrity.ts';
import { calculateAccountingDelta } from '../../src/services/conversationAccountingState.ts';

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
  const q = 'On 10 September 2026, a GST-registered company purchases computer equipment with a list price of SGD 12,000 (exclusive of recoverable 9% GST). The vendor grants a 20% trade discount on the list price. The company pays SGD 0 immediately and places the remaining balance on credit terms. Prepare the journal entry.';
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
  const q = 'A GST-registered company purchases office equipment with a list price of SGD 10,000 (exclusive of recoverable 9% GST), 10% trade discount, paid SGD 15,000 immediately by bank transfer with remaining balance on credit terms.';
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
  const turn1Query = 'On 1 August 2026, a GST-registered company purchases office equipment with a list price of SGD 20,000 (exclusive of recoverable 9% GST). The vendor grants a 10% trade discount on the list price. The company pays SGD 5,000 immediately by bank transfer and the remaining balance is placed on credit terms. Prepare the single compound journal entry on 1 August 2026.';
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
  const validDiscountQuery = 'On 1 August 2026, a GST-registered company purchases office equipment with a list price of SGD 20,000 (exclusive of recoverable 9% GST). The vendor grants a 10% trade discount on the list price. The company pays SGD 5,000 immediately by bank transfer and the remaining balance is placed on credit terms. Prepare the single compound journal entry.';
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
    evidenceTexts: [
      'On 1 August 2026, a GST-registered company purchases office equipment with a list price of SGD 20,000 (exclusive of recoverable 9% GST). The vendor grants a 10% trade discount on the list price. The company pays SGD 5,000 immediately by bank transfer and the remaining balance is placed on credit terms.',
      'Trade in old machinery on 15 May 2026'
    ]
  }), committedDiscount, 'Invalid unrelated candidate with Turn 1 amount in evidenceTexts must still fail closed and preserve committed journal');
  assert.equal(updateCommittedJournalScenario(committedDiscount, unstatedPpeCandidate, 'SFRS_I', true, {
    rawQuery: 'Trade in old machinery on 15 May 2026'
  }), null, 'resetPrevious = true clears committed journal to null');

  // BLOCKING #1: Unrelated UNIVERSAL candidate after a committed non-UNIVERSAL scenario or conflicting transactionId must NOT bypass UNSTATED_AMOUNT
  const unrelatedUniversalCandidate = {
    scenarioType: 'UNIVERSAL',
    transactionId: 'tx-loan-2',
    authorityStatus: 'DETERMINISTIC',
    rawQuery: 'Prepare the journal entry for a bank loan with 5% interest on 15 May 2026',
    transactionTitle: 'Bank Loan',
    functionalCurrency: 'SGD',
    transactionCurrency: 'SGD',
    isComplete: true,
    missingFields: [],
    directGroups: [{
      id: 'g-bad-loan',
      eventDate: '15/05/2026',
      title: 'Fabricated Bank Loan',
      summary: 'Fabricated',
      lines: [
        { id: '1', accountCode: '1010', accountName: 'Cash at Bank', category: 'ASSET', debit: 50000, credit: 0, lineExplanation: 'Dr' },
        { id: '2', accountCode: '2500', accountName: 'Bank Loan', category: 'LIABILITY', debit: 0, credit: 50000, lineExplanation: 'Cr' }
      ],
      totalDebit: 50000,
      totalCredit: 50000,
      isBalanced: true,
      citations: [],
      rationalePoints: [],
      authorityStatus: 'DETERMINISTIC'
    }]
  };
  assert.equal(hasSameTransactionPriorMonetaryEvidence(committedDiscount, unrelatedUniversalCandidate), false,
    'Unrelated UNIVERSAL candidate must not inherit prior ASSET_PURCHASE_DISCOUNT monetary facts');
  assert.equal(updateCommittedJournalScenario(committedDiscount, unrelatedUniversalCandidate, 'SFRS_I', false, {
    rawQuery: unrelatedUniversalCandidate.rawQuery,
    evidenceTexts: [
      'On 1 August 2026, a GST-registered company purchases office equipment with a list price of SGD 20,000 (exclusive of recoverable 9% GST).',
      unrelatedUniversalCandidate.rawQuery
    ]
  }), committedDiscount, 'Unrelated UNIVERSAL candidate must not overwrite committed discount journal');

  const priorUniversalTx1 = {
    ...unrelatedUniversalCandidate,
    transactionId: 'tx-1',
    rawQuery: 'Received SGD 10,000 share capital',
    directGroups: [{ ...unrelatedUniversalCandidate.directGroups[0], transactionId: 'tx-1', totalDebit: 10000, totalCredit: 10000, lines: [
      { id: '1', accountCode: '1010', accountName: 'Cash at Bank', category: 'ASSET', debit: 10000, credit: 0, lineExplanation: 'Dr' },
      { id: '2', accountCode: '3000', accountName: 'Share Capital', category: 'EQUITY', debit: 0, credit: 10000, lineExplanation: 'Cr' }
    ] }]
  };
  assert.equal(hasSameTransactionPriorMonetaryEvidence(priorUniversalTx1, unrelatedUniversalCandidate), false,
    'Conflicting transactionId between UNIVERSAL scenarios must not inherit prior monetary facts');

  // NB-5: Settlement follow-up stating exact settlement amount must not overwrite Group 1 immediateCash
  const explicitSettlementFollowUp = await parseAccountingQuery(
    'On 15 August 2026, paid SGD 14,620 by bank transfer to settle the remaining balance.',
    committedDiscount
  );
  assert.equal(explicitSettlementFollowUp.isComplete, true);
  assert.equal(explicitSettlementFollowUp.directGroups.length, 2);
  assert.equal(explicitSettlementFollowUp.directGroups[0].lines.find(l => l.accountCode === '1010')?.credit, 5000,
    'Settlement follow-up must preserve original Group 1 immediateCash of 5,000');
  assert.equal(explicitSettlementFollowUp.directGroups[0].lines.find(l => l.accountCode === '2010')?.credit, 14620);
  assert.equal(explicitSettlementFollowUp.directGroups[1].eventDate, '15/08/2026');
  assert.equal(explicitSettlementFollowUp.directGroups[1].totalDebit, 14620);
}

// NB-1 & NB-8: PPE follow-up preserves 9% GST when newCost changes; hardened hasMonetaryEvidence edge cases
{
  const ppeTurn1 = await parseAccountingQuery(
    'A GST-registered company purchased new machinery on 1 April 2026 for SGD 100,000 (exclusive of recoverable 9% GST). Trade-in: old machine agreed trade-in value of SGD 21,800 (inclusive of 9% GST). Old machine cost: SGD 50,000 on 1 January 2024. Depreciation: 20% per annum straight-line, depreciated up to 31 December 2025. Cash Paid: SGD 30,000 paid via bank transfer on 1 April 2026. Loan: 2-year equipment loan with a 5% per annum flat interest rate.',
    null
  );
  assert.equal(ppeTurn1.isComplete, true);
  const ppeTurn2 = await parseAccountingQuery('What if the new machine cost is SGD 200,000?', ppeTurn1);
  assert.equal(ppeTurn2.isComplete, true);
  const inputGstLine = ppeTurn2.directGroups[2]?.lines.find(l => l.accountCode === '1190');
  assert.equal(inputGstLine?.debit, 18000, 'Follow-up changing newCost must retain 9% GST (18,000 on 200,000), not 4.5%');

  for (const nonMonetary of ['Issue 5k shares', 'Allot 100 thousand shares', 'Under §55 of IAS 16', 'Employee age: 62', 'Order #456']) {
    assert.equal(hasMonetaryEvidence(nonMonetary), false, `Must reject non-monetary text: ${nonMonetary}`);
  }
  assert.equal(hasMonetaryEvidence("paid 500 for company's office supplies"), true, "Possessive 's must not strip genuine monetary predicate 500");
}

// Deterministic fast-path rejects structurally invalid / negative-line groups
{
  const negativeFastPathRes = await processAccountingQuery(
    'On 1 August 2026, a GST-registered company purchases office equipment with a list price of SGD 10,000 (exclusive of recoverable 9% GST), 10% trade discount, paid SGD 20,000 immediately by bank transfer with remaining balance on credit terms. Prepare the journal entry.',
    null,
    'SFRS_I'
  );
  assert.equal(negativeFastPathRes.scenarioState.isComplete, false);
  assert.deepEqual(negativeFastPathRes.scenarioState.directGroups, []);
}

// ---------------------------------------------------------------------------
// 5. Finding 1: Partial settlement uses actual payment & preserves remaining payable
// ---------------------------------------------------------------------------
{
  const turn1Query = 'On 1 August 2026, a GST-registered company purchases office equipment with a list price of SGD 20,000 (exclusive of recoverable 9% GST). The vendor grants a 10% trade discount on the list price. The company pays SGD 5,000 immediately by bank transfer and the remaining balance is placed on credit terms. Prepare the single compound journal entry on 1 August 2026.';
  const turn1Res = await processAccountingQuery(turn1Query, null, 'SFRS_I');
  const committed1 = updateCommittedJournalScenario(null, turn1Res.scenarioState, 'SFRS_I', false, {
    rawQuery: turn1Query,
    evidenceTexts: [turn1Query]
  });
  assert.ok(committed1, 'Turn 1 must commit with 14,620 Trade Payables');

  // 5a. Partial settlement of SGD 4,620 -> Group 2 is 4,620, remaining payable 10,000 preserved, NOT "Settled in Full"
  const turn2Query = 'On 15 August 2026, the company paid SGD 4,620 by bank transfer as a partial settlement.';
  const turn2Res = await processAccountingQuery(turn2Query, committed1, 'SFRS_I');
  assert.equal(turn2Res.scenarioState.isComplete, true, 'Partial settlement must complete');
  assert.equal(turn2Res.scenarioState.directGroups?.length, 2);
  assert.equal(turn2Res.scenarioState.directGroups[0].lines.find(l => l.accountCode === '1010')?.credit, 5000);
  assert.equal(turn2Res.scenarioState.directGroups[0].lines.find(l => l.accountCode === '2010')?.credit, 14620);
  assert.equal(turn2Res.scenarioState.directGroups[1].eventDate, '15/08/2026');
  assert.equal(turn2Res.scenarioState.directGroups[1].totalDebit, 4620, 'Partial settlement must debit Trade Payables by actual payment 4,620');
  assert.equal(turn2Res.scenarioState.directGroups[1].totalCredit, 4620, 'Partial settlement must credit Cash at Bank by actual payment 4,620');
  assert.match(turn2Res.scenarioState.directGroups[1].title, /Partial Settlement/i);
  const remainingParam = turn2Res.scenarioState.keyParameters?.find(p => p.label === 'Remaining Trade Payables');
  assert.equal(remainingParam?.value, 'SGD 10,000', 'Must preserve remaining payable of SGD 10,000');
  const statusParam = turn2Res.scenarioState.keyParameters?.find(p => p.label === 'Settlement Status');
  assert.match(statusParam?.value || '', /Partially Settled/i);
  assert.doesNotMatch(statusParam?.value || '', /Settled in Full/i);
  assert.match(turn2Res.messageText, /10,000\.00/);
  assert.doesNotMatch(turn2Res.messageText, /extinguished upon full settlement/i);

  const committed2 = updateCommittedJournalScenario(committed1, turn2Res.scenarioState, 'SFRS_I', false, {
    rawQuery: turn2Query,
    evidenceTexts: [turn1Query, turn2Query]
  });
  assert.ok(committed2, 'Partial settlement must commit');

  // 5b. Subsequent settlement of remaining balance -> settles exact remaining 10,000, remaining becomes 0
  const turn3Query = 'On 30 August 2026, settle the remaining balance by bank transfer.';
  const turn3Res = await processAccountingQuery(turn3Query, committed2, 'SFRS_I');
  assert.equal(turn3Res.scenarioState.isComplete, true);
  assert.equal(turn3Res.scenarioState.directGroups?.length, 3, 'Must preserve Group 1 + partial Group 2 + final Group 3');
  assert.equal(turn3Res.scenarioState.directGroups[1].totalDebit, 4620);
  assert.equal(turn3Res.scenarioState.directGroups[2].eventDate, '30/08/2026');
  assert.equal(turn3Res.scenarioState.directGroups[2].totalDebit, 10000, 'Final settlement must use remaining 10,000, not original 14,620');
  assert.equal(turn3Res.scenarioState.keyParameters?.find(p => p.label === 'Remaining Trade Payables')?.value, 'SGD 0');
  assert.match(turn3Res.scenarioState.keyParameters?.find(p => p.label === 'Settlement Status')?.value || '', /Settled in Full/i);

  // 5c. Partial settlement WITHOUT stating amount -> must fail closed and preserve committed2
  const partialNoAmtQuery = 'On 20 August 2026, the company made a partial settlement by bank transfer.';
  const partialNoAmtParsed = await parseAccountingQuery(partialNoAmtQuery, committed1);
  assert.equal(partialNoAmtParsed.isComplete, false, 'Partial settlement without payment amount must fail closed');
  assert.deepEqual(partialNoAmtParsed.directGroups, []);
  assert.ok(partialNoAmtParsed.missingFields.some(f => f.fieldKey === 'settlementAmount'));
  assert.equal(updateCommittedJournalScenario(committed1, partialNoAmtParsed, 'SFRS_I', false, { rawQuery: partialNoAmtQuery }), committed1);

  // 5d. Overpayment exceeding remaining payable -> must fail closed and preserve committed2
  const overpaymentQuery = 'On 20 August 2026, paid SGD 12,000 by bank transfer as settlement.';
  const overpaymentParsed = await parseAccountingQuery(overpaymentQuery, committed2);
  assert.equal(overpaymentParsed.isComplete, false, 'Settlement exceeding remaining payable (12,000 > 10,000) must fail closed');
  assert.deepEqual(overpaymentParsed.directGroups, []);
  assert.ok(overpaymentParsed.missingFields.some(f => f.fieldKey === 'paymentConflict'));
}

// ---------------------------------------------------------------------------
// 6. Finding 2: Matching scenarioType alone must NOT establish same-transaction ownership
// ---------------------------------------------------------------------------
{
  const priorDiscountQuery = 'On 1 August 2026, a GST-registered company purchases office equipment with a list price of SGD 20,000 (exclusive of recoverable 9% GST). The vendor grants a 10% trade discount on the list price. The company pays SGD 5,000 immediately by bank transfer and the remaining balance is placed on credit terms.';
  const priorDiscount = updateCommittedJournalScenario(
    null,
    await parseAccountingQuery(priorDiscountQuery, null),
    'SFRS_I',
    false,
    { rawQuery: priorDiscountQuery }
  );
  assert.ok(priorDiscount);

  // 6a. Same scenarioType (ASSET_PURCHASE_DISCOUNT) but new unrelated purchase with NO price -> must NOT inherit prior monetary evidence
  const newUnrelatedDiscountQuery = 'On 15 September 2026, a GST-registered company purchases computer equipment with a 15% trade discount on credit terms.';
  const fabricatedSameTypeDiscount = {
    scenarioType: 'ASSET_PURCHASE_DISCOUNT',
    authorityStatus: 'DETERMINISTIC',
    rawQuery: newUnrelatedDiscountQuery,
    transactionTitle: 'Purchase of Computer Equipment (Trade Discount & Credit Terms)',
    functionalCurrency: 'SGD',
    transactionCurrency: 'SGD',
    isComplete: true,
    missingFields: [],
    directGroups: [{
      id: 'g-fab-disc-2',
      eventDate: '15/09/2026',
      title: 'Fabricated Same-Type Purchase',
      summary: 'Fabricated',
      lines: [
        { id: '1', accountCode: '1500', accountName: 'Computer Equipment - Cost', category: 'ASSET', debit: 17000, credit: 0, lineExplanation: 'Dr' },
        { id: '2', accountCode: '2010', accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 17000, lineExplanation: 'Cr' }
      ],
      totalDebit: 17000,
      totalCredit: 17000,
      isBalanced: true,
      citations: [],
      rationalePoints: [],
      authorityStatus: 'DETERMINISTIC'
    }]
  };
  assert.equal(
    hasSameTransactionPriorMonetaryEvidence(priorDiscount, fabricatedSameTypeDiscount, newUnrelatedDiscountQuery),
    false,
    'Matching ASSET_PURCHASE_DISCOUNT scenarioType must NOT establish same-transaction ownership'
  );
  assert.equal(
    updateCommittedJournalScenario(priorDiscount, fabricatedSameTypeDiscount, 'SFRS_I', false, {
      rawQuery: newUnrelatedDiscountQuery,
      evidenceTexts: [priorDiscountQuery, newUnrelatedDiscountQuery]
    }),
    priorDiscount,
    'Unrelated same-scenarioType candidate must fail closed and preserve committed journal'
  );
  const parsedNewUnrelated = await parseAccountingQuery(newUnrelatedDiscountQuery, priorDiscount);
  assert.equal(parsedNewUnrelated.isComplete, false, 'Parser must not inherit Turn 1 listPrice into a new unrelated purchase');

  // 6b. Same scenarioType (UNIVERSAL -> UNIVERSAL) WITHOUT transactionId -> unrelated transaction must NOT inherit Turn 1 monetary evidence
  const priorUniversalNoTxId = {
    scenarioType: 'UNIVERSAL',
    authorityStatus: 'DETERMINISTIC',
    rawQuery: 'Paid SGD 500 for office stationery by bank transfer on 1 August 2026',
    transactionTitle: 'Office Stationery Purchase',
    functionalCurrency: 'SGD',
    transactionCurrency: 'SGD',
    isComplete: true,
    missingFields: [],
    directGroups: [{
      id: 'g-univ-1',
      eventDate: '01/08/2026',
      title: 'Office Stationery',
      summary: 'Stationery',
      lines: [
        { id: '1', accountCode: '5100', accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0, lineExplanation: 'Dr' },
        { id: '2', accountCode: '1010', accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500, lineExplanation: 'Cr' }
      ],
      totalDebit: 500,
      totalCredit: 500,
      isBalanced: true,
      citations: [],
      rationalePoints: [],
      authorityStatus: 'DETERMINISTIC'
    }]
  };
  const newUnrelatedUniversalQuery = 'Purchase office supplies on credit on 15 September 2026';
  const newUnrelatedUniversalCandidate = {
    scenarioType: 'UNIVERSAL',
    authorityStatus: 'DETERMINISTIC',
    rawQuery: newUnrelatedUniversalQuery,
    transactionTitle: 'Office Supplies',
    functionalCurrency: 'SGD',
    transactionCurrency: 'SGD',
    isComplete: true,
    missingFields: [],
    directGroups: [{
      id: 'g-univ-2',
      eventDate: '15/09/2026',
      title: 'Fabricated Office Supplies',
      summary: 'Fabricated',
      lines: [
        { id: '1', accountCode: '5100', accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0, lineExplanation: 'Dr' },
        { id: '2', accountCode: '2010', accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500, lineExplanation: 'Cr' }
      ],
      totalDebit: 500,
      totalCredit: 500,
      isBalanced: true,
      citations: [],
      rationalePoints: [],
      authorityStatus: 'DETERMINISTIC'
    }]
  };
  assert.equal(
    hasSameTransactionPriorMonetaryEvidence(priorUniversalNoTxId, newUnrelatedUniversalCandidate, newUnrelatedUniversalQuery),
    false,
    'Matching UNIVERSAL scenarioType without transaction linkage must NOT inherit prior monetary evidence'
  );
  assert.equal(
    updateCommittedJournalScenario(priorUniversalNoTxId, newUnrelatedUniversalCandidate, 'SFRS_I', false, {
      rawQuery: newUnrelatedUniversalQuery,
      evidenceTexts: [priorUniversalNoTxId.rawQuery, newUnrelatedUniversalQuery]
    }),
    priorUniversalNoTxId
  );

  // 6c. Same scenarioType (PPE_IAS16 -> PPE_IAS16) unrelated trade-in without amounts -> must NOT inherit
  const ppeTurn1Query = 'A GST-registered company purchased new machinery on 1 April 2026 for SGD 100,000 (exclusive of recoverable 9% GST). Trade-in: old machine agreed trade-in value of SGD 21,800 (inclusive of 9% GST). Old machine cost: SGD 50,000 on 1 January 2024. Depreciation: 20% per annum straight-line, depreciated up to 31 December 2025. Cash Paid: SGD 30,000 paid via bank transfer on 1 April 2026. Loan: 2-year equipment loan with a 5% per annum flat interest rate.';
  const ppeTurn1 = updateCommittedJournalScenario(null, await parseAccountingQuery(ppeTurn1Query, null), 'SFRS_I', false, { rawQuery: ppeTurn1Query });
  assert.ok(ppeTurn1);
  const newPpeQuery = 'On 15 May 2026, the company purchased another machine with a trade-in of an old machine.';
  const newPpeCandidate = { ...ppeTurn1, rawQuery: newPpeQuery };
  assert.equal(
    hasSameTransactionPriorMonetaryEvidence(ppeTurn1, newPpeCandidate, newPpeQuery),
    false,
    'Matching PPE_IAS16 scenarioType on a separate purchase must NOT inherit prior monetary evidence'
  );
}

// ---------------------------------------------------------------------------
// 7. Finding 3: Numeric text and image fields must be validated as genuine monetary evidence
// ---------------------------------------------------------------------------
{
  const nonMonetaryNumericTexts = [
    'Bought 50 laptops on credit',
    'Qty 50 office chairs',
    'Received 200 units from supplier',
    'Serial 98765 equipment disposal',
    'Floor 3, Room 101 office lease',
    'Batch 42 inventory transfer',
    'Spot rate 1.35 on 15 May 2026',
    'Account code 5010 depreciation adjustment',
    'Invoice 12345 on 15 May 2026'
  ];
  for (const txt of nonMonetaryNumericTexts) {
    assert.equal(hasMonetaryEvidence(txt), false, `Non-monetary numeric text must return false: ${txt}`);
  }

  const genuineMonetaryTexts = [
    'SGD 500',
    '500 SGD',
    'paid 4,620 by bank transfer',
    'salary is 5000',
    '5000',
    'total 1,250.50',
    'unit price 150',
    'rent of 3000 per month'
  ];
  for (const txt of genuineMonetaryTexts) {
    assert.equal(hasMonetaryEvidence(txt), true, `Genuine monetary text must return true: ${txt}`);
  }

  // Non-monetary positive numeric image fields must NOT authorize journal amounts
  const nonMonetaryImageCases = [
    [{ imageId: 'img-qty', fields: [{ source: 'image', field: 'quantity', value: 50 }] }],
    [{ imageId: 'img-invno', fields: [{ source: 'image', field: 'invoiceNumber', value: 12345 }] }],
    [{ imageId: 'img-rate', fields: [{ source: 'image', field: 'gstRate', value: 9 }] }],
    [{ imageId: 'img-year', fields: [{ source: 'image', field: 'year', value: 2026 }] }],
    [{ imageId: 'img-page', fields: [{ source: 'image', field: 'pageNumber', value: 2 }] }],
    [{ imageId: 'img-units', fields: [{ source: 'image', field: 'units', value: 200 }] }],
    [{ imageId: 'img-code', fields: [{ source: 'image', field: 'accountCode', value: 5010 }] }],
    [{ imageId: 'img-bare-inv', fields: [{ source: 'image', field: 'invoice', value: 12345 }] }]
  ];
  for (const imgEv of nonMonetaryImageCases) {
    assert.equal(
      hasVerifiedNumericImageEvidence(imgEv),
      false,
      `Non-monetary image field ${imgEv[0].fields[0].field} must NOT pass as monetary evidence`
    );
  }
  assert.equal(
    hasVerifiedNumericImageEvidence(undefined, [{ source: 'image', field: 'quantity', value: 50 }]),
    false,
    'Non-monetary extractedEvidence field must return false'
  );

  // Genuine monetary image fields and journalLines remain valid
  assert.equal(
    hasVerifiedNumericImageEvidence([{ imageId: 'img-ok-1', fields: [{ source: 'image', field: 'totalAmount', value: 1200 }] }]),
    true
  );
  assert.equal(
    hasVerifiedNumericImageEvidence([{ imageId: 'img-ok-2', fields: [{ source: 'image', field: 'unitPrice', value: 150 }] }]),
    true
  );
  assert.equal(
    hasVerifiedNumericImageEvidence([{ imageId: 'img-ok-3', fields: [], journalLines: [{ accountName: 'Cash at Bank', debit: 1200, credit: 0 }] }]),
    true
  );
}

// ---------------------------------------------------------------------------
// 8. Finding 5: Distinguish GST-inclusive vs GST-exclusive purchase prices &
//    establish input GST recoverability (ASSET_PURCHASE_DISCOUNT & PPE_IAS16)
// ---------------------------------------------------------------------------
{
  // 8a. ASSET_PURCHASE_DISCOUNT: GST-inclusive list price (SGD 21,800 incl. 9% GST, 10% discount, GST-registered, SGD 5,000 cash)
  // 21,800 * 0.90 = 19,620 gross; 19,620 / 1.09 = 18,000 net cost; Input GST = 1,620; Payable = 14,620
  const qDiscInclusive = 'On 1 August 2026, a GST-registered company purchases office equipment with a list price of SGD 21,800 (inclusive of recoverable 9% GST). The vendor grants a 10% trade discount on the list price. The company pays SGD 5,000 immediately by bank transfer and the remaining balance is placed on credit terms. Prepare the journal entry.';
  const resDiscInc = await processAccountingQuery(qDiscInclusive, null, 'SFRS_I');
  assert.equal(resDiscInc.scenarioState.isComplete, true, 'GST-inclusive discount purchase must complete');
  const grpInc = resDiscInc.scenarioState.directGroups[0];
  assert.equal(grpInc.lines.find(l => l.accountCode === '1500')?.debit, 18000, 'Inclusive 21,800 less 10% = 19,620 gross -> 18,000 ex-GST asset cost');
  assert.equal(grpInc.lines.find(l => l.accountCode === '1190')?.debit, 1620, 'Inclusive 9% input GST must be 1,620');
  assert.equal(grpInc.lines.find(l => l.accountCode === '1010')?.credit, 5000);
  assert.equal(grpInc.lines.find(l => l.accountCode === '2010')?.credit, 14620);
  assert.equal(grpInc.totalDebit, 19620);
  assert.equal(grpInc.totalCredit, 19620);
  assert.equal(grpInc.isBalanced, true);

  // 8b. ASSET_PURCHASE_DISCOUNT: Non-GST-registered buyer paying 9% supplier GST -> capitalise GST into asset cost, NO 1190 line
  const qDiscNonRecov = 'On 1 August 2026, a non-GST-registered company purchases office equipment with a list price of SGD 20,000 (exclusive of 9% GST). The vendor grants a 10% trade discount on the list price. The company pays SGD 5,000 immediately by bank transfer and the remaining balance is placed on credit terms. Prepare the journal entry.';
  const resDiscNonRecov = await processAccountingQuery(qDiscNonRecov, null, 'SFRS_I');
  assert.equal(resDiscNonRecov.scenarioState.isComplete, true, 'Non-GST-registered buyer with explicit 9% GST must complete');
  const grpNonRecov = resDiscNonRecov.scenarioState.directGroups[0];
  assert.equal(grpNonRecov.lines.find(l => l.accountCode === '1500')?.debit, 19620, 'Non-recoverable 9% GST (1,620) must be capitalised into asset cost (19,620)');
  assert.equal(grpNonRecov.lines.some(l => l.accountCode === '1190'), false, 'Non-recoverable input GST must NOT create GST Input Tax Receivable (1190)');
  assert.equal(grpNonRecov.lines.find(l => l.accountCode === '1010')?.credit, 5000);
  assert.equal(grpNonRecov.lines.find(l => l.accountCode === '2010')?.credit, 14620);
  assert.equal(grpNonRecov.isBalanced, true);
  assert.match(resDiscNonRecov.messageText, /Non-Recoverable Input GST/i);

  // 8c. ASSET_PURCHASE_DISCOUNT: GST rate stated WITHOUT inclusive/exclusive basis -> fail closed
  const qDiscMissingBasis = 'On 1 August 2026, a GST-registered company purchases office equipment with a list price of SGD 20,000 with 9% GST and 10% trade discount, paid SGD 5,000 immediately and remaining balance on credit terms.';
  const parsedMissingBasis = await parseAccountingQuery(qDiscMissingBasis, null);
  assert.equal(parsedMissingBasis.isComplete, false, 'Unstated GST inclusive/exclusive basis must fail closed');
  assert.deepEqual(parsedMissingBasis.directGroups, []);
  assert.ok(parsedMissingBasis.missingFields.some(f => f.fieldKey === 'gstPriceBasis'));

  // 8d. ASSET_PURCHASE_DISCOUNT: GST rate & basis stated WITHOUT recoverability/GST-registration -> fail closed
  const qDiscMissingRecov = 'On 1 August 2026, a company purchases office equipment with a list price of SGD 20,000 (exclusive of 9% GST) and 10% trade discount, paid SGD 5,000 immediately and remaining balance on credit terms.';
  const parsedMissingRecov = await parseAccountingQuery(qDiscMissingRecov, null);
  assert.equal(parsedMissingRecov.isComplete, false, 'Unestablished input GST recoverability must fail closed');
  assert.deepEqual(parsedMissingRecov.directGroups, []);
  assert.ok(parsedMissingRecov.missingFields.some(f => f.fieldKey === 'gstRecoverability'));

  // 8e. PPE_IAS16: GST-inclusive new machine price (SGD 109,000 incl. 9% GST) + GST-exclusive trade-in (SGD 20,000 excl. 9% GST) -> exact math
  const qPpeInclNewExclTradeIn = 'A GST-registered company purchased new machinery on 1 April 2026 for SGD 109,000 (inclusive of recoverable 9% GST). Trade-in: old machine agreed trade-in value of SGD 20,000 (exclusive of 9% GST). Old machine cost: SGD 50,000 with accumulated depreciation of SGD 22,500. Cash Paid: SGD 30,000 paid via bank transfer on 1 April 2026. Loan: 2-year equipment loan with a 5% per annum flat interest rate.';
  const parsedPpeMixed = await parseAccountingQuery(qPpeInclNewExclTradeIn, null);
  assert.equal(parsedPpeMixed.isComplete, true, 'PPE trade-in with inclusive new cost and exclusive trade-in must complete');
  const dispGrp = parsedPpeMixed.directGroups.find(g => g.id === 'grp-disposal-old');
  const acqGrp = parsedPpeMixed.directGroups.find(g => g.id === 'grp-acq-new');
  // New machine: 109,000 incl. 9% -> net 100,000 + input GST 9,000
  assert.equal(acqGrp?.lines.find(l => l.accountCode === '1600')?.debit, 100000);
  assert.equal(acqGrp?.lines.find(l => l.accountCode === '1190')?.debit, 9000);
  // Trade-in: 20,000 excl. 9% -> output GST 1,800, gross clearing 21,800
  assert.equal(dispGrp?.lines.find(l => l.accountCode === '1150')?.debit, 21800);
  assert.equal(dispGrp?.lines.find(l => l.accountCode === '2200')?.credit, 1800);
  assert.equal(dispGrp?.isBalanced, true);
  assert.equal(acqGrp?.isBalanced, true);

  // 8f. PPE_IAS16: Non-GST-registered buyer paying 9% supplier GST -> capitalise input GST (109,000), NO 1190, NO Output GST 2200
  const qPpeNonGstBuyer = 'A non-GST-registered company purchased new machinery on 1 April 2026 for SGD 100,000 (exclusive of 9% GST). Trade-in: old machine agreed trade-in value of SGD 20,000. Old machine cost: SGD 50,000 with accumulated depreciation of SGD 22,500. Cash Paid: SGD 30,000 paid via bank transfer on 1 April 2026. Loan: 2-year equipment loan with a 5% per annum flat interest rate.';
  const parsedPpeNonGst = await parseAccountingQuery(qPpeNonGstBuyer, null);
  assert.equal(parsedPpeNonGst.isComplete, true);
  const nonGstDisp = parsedPpeNonGst.directGroups.find(g => g.id === 'grp-disposal-old');
  const nonGstAcq = parsedPpeNonGst.directGroups.find(g => g.id === 'grp-acq-new');
  assert.equal(nonGstAcq?.lines.find(l => l.accountCode === '1600')?.debit, 109000, 'Non-recoverable 9% GST must capitalise into new machinery cost (109,000)');
  assert.equal(nonGstAcq?.lines.some(l => l.accountCode === '1190'), false, 'Non-GST-registered buyer must not recognise Input GST Receivable');
  assert.equal(nonGstDisp?.lines.some(l => l.accountCode === '2200'), false, 'Non-GST-registered entity must not charge Output GST on trade-in');
  assert.equal(nonGstDisp?.isBalanced, true);
  assert.equal(nonGstAcq?.isBalanced, true);

  // 8g. PPE_IAS16: Unestablished GST recoverability when 9% GST stated -> fail closed
  const qPpeMissingRecov = 'A company purchased new machinery on 1 April 2026 for SGD 100,000 (exclusive of 9% GST). Trade-in: old machine agreed trade-in value of SGD 21,800 (inclusive of 9% GST). Old machine cost: SGD 50,000 with accumulated depreciation of SGD 22,500. Cash Paid: SGD 30,000 paid via bank transfer on 1 April 2026. Loan: 2-year equipment loan with a 5% per annum flat interest rate.';
  const parsedPpeMissingRecov = await parseAccountingQuery(qPpeMissingRecov, null);
  assert.equal(parsedPpeMissingRecov.isComplete, false, 'PPE with 9% GST and unestablished recoverability must fail closed');
  assert.deepEqual(parsedPpeMissingRecov.directGroups, []);
  assert.ok(parsedPpeMissingRecov.missingFields.some(f => f.fieldKey === 'gstRecoverability'));
}

// ---------------------------------------------------------------------------
// 9. Historical settlement preservation on price/discount amendment
// ---------------------------------------------------------------------------
{
  const turn1Query = 'On 1 August 2026, a GST-registered company purchases office equipment with a list price of SGD 20,000 (exclusive of recoverable 9% GST). The vendor grants a 10% trade discount on the list price. The company pays SGD 5,000 immediately by bank transfer and the remaining balance is placed on credit terms. Prepare the single compound journal entry.';
  const committed1 = updateCommittedJournalScenario(
    null,
    (await processAccountingQuery(turn1Query, null, 'SFRS_I')).scenarioState,
    'SFRS_I',
    false,
    { rawQuery: turn1Query, evidenceTexts: [turn1Query] }
  );
  assert.ok(committed1);

  const turn2Query = 'Settle the remaining balance by bank transfer on 15 August 2026';
  const committed2 = updateCommittedJournalScenario(
    committed1,
    (await processAccountingQuery(turn2Query, committed1, 'SFRS_I')).scenarioState,
    'SFRS_I',
    false,
    { rawQuery: turn2Query, evidenceTexts: [turn1Query, turn2Query] }
  );
  assert.ok(committed2);
  assert.equal(committed2.committedDirectGroups?.length, 2);
  assert.equal(committed2.committedDirectGroups[1].totalDebit, 14620);

  // 9a. Amend list price to SGD 25,000 -> net = 22,500, GST = 2,025, gross = 24,525, payable = 19,525.
  // Historical cash settlement of 14,620 MUST be preserved (NOT rewritten to 19,525), leaving SGD 4,905.
  const amendListPriceQuery = 'Actually the list price was SGD 25,000';
  const amendedPriceRes = await processAccountingQuery(amendListPriceQuery, committed2, 'SFRS_I');
  assert.equal(amendedPriceRes.scenarioState.isComplete, true);
  assert.equal(amendedPriceRes.scenarioState.directGroups?.length, 2);
  assert.equal(amendedPriceRes.scenarioState.directGroups[0].lines.find(l => l.accountCode === '1010')?.credit, 5000);
  assert.equal(amendedPriceRes.scenarioState.directGroups[0].lines.find(l => l.accountCode === '2010')?.credit, 19525);
  assert.equal(amendedPriceRes.scenarioState.directGroups[1].eventDate, '15/08/2026');
  assert.equal(amendedPriceRes.scenarioState.directGroups[1].totalDebit, 14620, 'Historical settlement of 14,620 must NOT be rewritten to 19,525');
  assert.equal(amendedPriceRes.scenarioState.directGroups[1].totalCredit, 14620);
  assert.equal(amendedPriceRes.scenarioState.keyParameters?.find(p => p.label === 'Remaining Trade Payables')?.value, 'SGD 4,905');
  assert.match(amendedPriceRes.scenarioState.keyParameters?.find(p => p.label === 'Settlement Status')?.value || '', /Partially Settled/i);

  // 9b. Amend trade discount to 5% -> net = 19,000, GST = 1,710, gross = 20,710, payable = 15,710.
  // Historical cash settlement of 14,620 MUST be preserved (NOT rewritten to 15,710), leaving SGD 1,090.
  const amendDiscountQuery = 'Amend the trade discount to 5%';
  const amendedDiscRes = await processAccountingQuery(amendDiscountQuery, committed2, 'SFRS_I');
  assert.equal(amendedDiscRes.scenarioState.isComplete, true);
  assert.equal(amendedDiscRes.scenarioState.directGroups?.length, 2);
  assert.equal(amendedDiscRes.scenarioState.directGroups[0].lines.find(l => l.accountCode === '1010')?.credit, 5000);
  assert.equal(amendedDiscRes.scenarioState.directGroups[0].lines.find(l => l.accountCode === '2010')?.credit, 15710);
  assert.equal(amendedDiscRes.scenarioState.directGroups[1].totalDebit, 14620, 'Historical settlement of 14,620 must NOT be rewritten to 15,710');
  assert.equal(amendedDiscRes.scenarioState.keyParameters?.find(p => p.label === 'Remaining Trade Payables')?.value, 'SGD 1,090');
  assert.match(amendedDiscRes.scenarioState.keyParameters?.find(p => p.label === 'Settlement Status')?.value || '', /Partially Settled/i);

  // 9c. Amend trade discount to 20% -> payable = 12,440 < historical 14,620 -> fail closed & preserve committed2
  const amendExceedQuery = 'Amend the trade discount to 20%';
  const amendedExceedParsed = await parseAccountingQuery(amendExceedQuery, committed2);
  assert.equal(amendedExceedParsed.isComplete, false, 'Revised Trade Payables below historical settlement must fail closed');
  assert.deepEqual(amendedExceedParsed.directGroups, []);
  assert.ok(amendedExceedParsed.missingFields.some(f => f.fieldKey === 'paymentConflict'));
  const preservedCommitted = updateCommittedJournalScenario(committed2, amendedExceedParsed, 'SFRS_I', false, {
    rawQuery: amendExceedQuery,
    evidenceTexts: [turn1Query, turn2Query, amendExceedQuery]
  });
  assert.equal(preservedCommitted, committed2, 'Failed amendment must leave committed journal payment 14,620 untouched');

  // 9d. Multi-settlement (4,620 + 10,000) followed by list price amendment to 25,000 preserves both settlements
  const partial1 = updateCommittedJournalScenario(
    committed1,
    (await processAccountingQuery('On 15 August 2026, paid SGD 4,620 by bank transfer as a partial settlement.', committed1, 'SFRS_I')).scenarioState,
    'SFRS_I',
    false,
    { rawQuery: 'On 15 August 2026, paid SGD 4,620 by bank transfer as a partial settlement.' }
  );
  const partial2 = updateCommittedJournalScenario(
    partial1,
    (await processAccountingQuery('On 30 August 2026, paid SGD 10,000 by bank transfer to settle the remaining balance.', partial1, 'SFRS_I')).scenarioState,
    'SFRS_I',
    false,
    { rawQuery: 'On 30 August 2026, paid SGD 10,000 by bank transfer to settle the remaining balance.' }
  );
  assert.ok(partial2);
  const multiAmendRes = await parseAccountingQuery('Revise the list price to SGD 25,000', partial2);
  assert.equal(multiAmendRes.isComplete, true);
  assert.equal(multiAmendRes.directGroups?.length, 3);
  assert.equal(multiAmendRes.directGroups[1].totalDebit, 4620);
  assert.equal(multiAmendRes.directGroups[2].totalDebit, 10000);
  assert.equal(multiAmendRes.keyParameters?.find(p => p.label === 'Remaining Trade Payables')?.value, 'SGD 4,905');

  // 9e. PPE follow-up amending newCost preserves historical Cash Paid (30,000)
  const ppeBaseQuery = 'A GST-registered company purchased new machinery on 1 April 2026 for SGD 100,000 (exclusive of recoverable 9% GST). Trade-in: old machine agreed trade-in value of SGD 21,800 (inclusive of 9% GST). Old machine cost: SGD 50,000 on 1 January 2024. Depreciation: 20% per annum straight-line, depreciated up to 31 December 2025. Cash Paid: SGD 30,000 paid via bank transfer on 1 April 2026. Loan: 2-year equipment loan with a 5% per annum flat interest rate.';
  const ppeBase = await parseAccountingQuery(ppeBaseQuery, null);
  const ppeAmend = await parseAccountingQuery('Actually the new machine purchase price was SGD 120,000', ppeBase);
  assert.equal(ppeAmend.isComplete, true);
  assert.equal(ppeAmend.directGroups[2]?.lines.find(l => l.accountCode === '1010')?.credit, 30000, 'PPE amendment must preserve historical Cash Paid of 30,000');
  assert.equal(ppeAmend.directGroups[2]?.lines.find(l => l.accountCode === '1600')?.debit, 120000);
}

// ---------------------------------------------------------------------------
// 10. Finding 2: GST registration alone != input GST recoverability
// ---------------------------------------------------------------------------
{
  // 10a. GST-registered alone (ASSET_PURCHASE_DISCOUNT) -> explicitly CONDITIONAL journal, NOT committed as deterministic
  const qDiscRegOnly = 'On 1 August 2026, a GST-registered company purchases office equipment with a list price of SGD 20,000 (exclusive of 9% GST). The vendor grants a 10% trade discount on the list price. The company pays SGD 5,000 immediately by bank transfer and the remaining balance is placed on credit terms.';
  const resDiscRegOnly = await processAccountingQuery(qDiscRegOnly, null, 'SFRS_I');
  const parsedDiscRegOnly = resDiscRegOnly.scenarioState;
  assert.equal(parsedDiscRegOnly.authorityStatus, 'CONDITIONAL', 'GST-registered alone must be CONDITIONAL, never DETERMINISTIC');
  assert.ok(parsedDiscRegOnly.directGroups.every(g => g.authorityStatus === 'CONDITIONAL'));
  assert.ok(parsedDiscRegOnly.assumptions?.some(a => a.field === 'Input GST Recoverability'));
  assert.match(parsedDiscRegOnly.uncertaintyDisclaimer || '', /GST registration alone does not establish input GST recoverability/i);
  assert.match(resDiscRegOnly.messageText, /Conditional Journal/i);
  assert.equal(updateCommittedJournalScenario(null, parsedDiscRegOnly, 'SFRS_I', false, { rawQuery: qDiscRegOnly }), null,
    'CONDITIONAL GST-registered-only journal must NOT be committed');
  assert.equal(getDisplayableUncommittedJournalGroups(parsedDiscRegOnly, 'SFRS_I', { rawQuery: qDiscRegOnly }).length, 1,
    'CONDITIONAL GST-registered-only journal must remain displayable as uncommitted conditional');

  // Follow-up confirming "The input GST is recoverable." upgrades to DETERMINISTIC and commits
  const discConfirmedRecov = await processAccountingQuery('The input GST is recoverable.', parsedDiscRegOnly, 'SFRS_I');
  assert.equal(discConfirmedRecov.scenarioState.authorityStatus, 'DETERMINISTIC');
  assert.equal(discConfirmedRecov.scenarioState.directGroups[0].lines.find(l => l.accountCode === '1190')?.debit, 1620);
  assert.ok(updateCommittedJournalScenario(null, discConfirmedRecov.scenarioState, 'SFRS_I', false, {
    rawQuery: 'The input GST is recoverable.',
    evidenceTexts: [qDiscRegOnly, 'The input GST is recoverable.']
  }));

  // Follow-up stating "The input GST is non-recoverable." upgrades to DETERMINISTIC, capitalises GST into 1500, and omits 1190
  const discConfirmedNonRecov = await processAccountingQuery('The input GST is non-recoverable.', parsedDiscRegOnly, 'SFRS_I');
  assert.equal(discConfirmedNonRecov.scenarioState.authorityStatus, 'DETERMINISTIC');
  assert.equal(discConfirmedNonRecov.scenarioState.directGroups[0].lines.find(l => l.accountCode === '1500')?.debit, 19620);
  assert.equal(discConfirmedNonRecov.scenarioState.directGroups[0].lines.some(l => l.accountCode === '1190'), false);

  // 10b. GST-registered alone (PPE_IAS16) -> explicitly CONDITIONAL journal, NOT committed as deterministic
  const qPpeRegOnly = 'A GST-registered company purchased new machinery on 1 April 2026 for SGD 100,000 (exclusive of 9% GST). Trade-in: old machine agreed trade-in value of SGD 21,800 (inclusive of 9% GST). Old machine cost: SGD 50,000 with accumulated depreciation of SGD 22,500. Cash Paid: SGD 30,000 paid via bank transfer on 1 April 2026. Loan: 2-year equipment loan with a 5% per annum flat interest rate.';
  const resPpeRegOnly = await processAccountingQuery(qPpeRegOnly, null, 'SFRS_I');
  const parsedPpeRegOnly = resPpeRegOnly.scenarioState;
  assert.equal(parsedPpeRegOnly.authorityStatus, 'CONDITIONAL', 'PPE GST-registered alone must be CONDITIONAL, never DETERMINISTIC');
  assert.ok(parsedPpeRegOnly.directGroups.every(g => g.authorityStatus === 'CONDITIONAL'));
  assert.ok(parsedPpeRegOnly.assumptions?.some(a => a.field === 'Input GST Recoverability'));
  assert.match(parsedPpeRegOnly.uncertaintyDisclaimer || '', /GST registration alone does not establish input GST recoverability/i);
  assert.match(resPpeRegOnly.messageText, /Conditional Journal/i);
  assert.equal(updateCommittedJournalScenario(null, parsedPpeRegOnly, 'SFRS_I', false, { rawQuery: qPpeRegOnly }), null,
    'CONDITIONAL PPE GST-registered-only journal must NOT be committed');

  // 10c. Unstated registration & unstated recoverability ("A company...") -> requests clarification (isComplete: false), and clarification reply completes as DETERMINISTIC
  const qDiscUnstated = 'On 1 August 2026, a company purchases office equipment with a list price of SGD 20,000 (exclusive of 9% GST) and 10% trade discount, paid SGD 5,000 immediately and remaining balance on credit terms.';
  const parsedDiscUnstated = await parseAccountingQuery(qDiscUnstated, null);
  assert.equal(parsedDiscUnstated.isComplete, false);
  assert.ok(parsedDiscUnstated.missingFields.some(f => f.fieldKey === 'gstRecoverability'));
  const discUnstatedClarified = await processAccountingQuery('The input GST is recoverable.', parsedDiscUnstated, 'SFRS_I');
  assert.equal(discUnstatedClarified.scenarioState.isComplete, true);
  assert.equal(discUnstatedClarified.scenarioState.authorityStatus, 'DETERMINISTIC');
}

// ---------------------------------------------------------------------------
// 11. Finding 3: Zero-payment detection (SGD 0, SGD 0.00, SGD 0.01, SGD 0.50)
// ---------------------------------------------------------------------------
{
  // 11a. ASSET_PURCHASE_DISCOUNT immediate payment (inline & standalone clarification reply)
  const pendingImmediateCash = await parseAccountingQuery(
    'On 1 August 2026, a GST-registered company purchases office equipment with a list price of SGD 20,000 (exclusive of recoverable 9% GST). The vendor grants a 10% trade discount on the list price and places the remaining balance on credit terms.',
    null
  );
  assert.equal(pendingImmediateCash.isComplete, false);
  assert.ok(pendingImmediateCash.missingFields.some(f => f.fieldKey === 'immediateCash'));

  for (const [cashText, expectedBankCredit, expectedPayable] of [
    ['SGD 0', undefined, 19620],
    ['SGD 0.00', undefined, 19620],
    ['SGD 0.01', 0.01, 19619.99],
    ['SGD 0.50', 0.5, 19619.5]
  ]) {
    const q = `On 1 August 2026, a GST-registered company purchases office equipment with a list price of SGD 20,000 (exclusive of recoverable 9% GST). The vendor grants a 10% trade discount on the list price. The company pays ${cashText} immediately by bank transfer and the remaining balance is placed on credit terms.`;
    const parsed = await parseAccountingQuery(q, null);
    assert.equal(parsed.isComplete, true, `Immediate payment ${cashText} must complete`);
    const grp = parsed.directGroups[0];
    assert.equal(grp.isBalanced, true);
    const bankLine = grp.lines.find(l => l.accountCode === '1010');
    const payableLine = grp.lines.find(l => l.accountCode === '2010');
    assert.equal(bankLine?.credit, expectedBankCredit, `Immediate ${cashText} bank credit mismatch`);
    assert.equal(payableLine?.credit, expectedPayable, `Immediate ${cashText} payable credit mismatch`);
    assert.equal(validateJournalGroups(parsed.directGroups, { rawQuery: q }).isValid, true);

    const clarified = await parseAccountingQuery(cashText, pendingImmediateCash);
    assert.equal(clarified.isComplete, true, `Standalone clarification ${cashText} must complete`);
    assert.equal(clarified.directGroups[0].lines.find(l => l.accountCode === '1010')?.credit, expectedBankCredit);
    assert.equal(clarified.directGroups[0].lines.find(l => l.accountCode === '2010')?.credit, expectedPayable);
  }

  // 11b. ASSET_PURCHASE_DISCOUNT subsequent settlement
  const baseDiscQuery = 'On 1 August 2026, a GST-registered company purchases office equipment with a list price of SGD 20,000 (exclusive of recoverable 9% GST). The vendor grants a 10% trade discount on the list price. The company pays SGD 5,000 immediately by bank transfer and the remaining balance is placed on credit terms.';
  const baseDisc = await parseAccountingQuery(baseDiscQuery, null);
  for (const [settleText, expectedGroups, expectedSettleAmt, expectedRemaining] of [
    ['SGD 0', 1, undefined, undefined],
    ['SGD 0.00', 1, undefined, undefined],
    ['SGD 0.01', 2, 0.01, 'SGD 14,619.99'],
    ['SGD 0.50', 2, 0.5, 'SGD 14,619.50']
  ]) {
    const followUp = await parseAccountingQuery(`On 15 August 2026, paid ${settleText} by bank transfer to settle the balance.`, baseDisc);
    assert.equal(followUp.isComplete, true);
    assert.equal(followUp.directGroups?.length, expectedGroups, `Subsequent settlement ${settleText} group count mismatch`);
    if (expectedSettleAmt !== undefined) {
      assert.equal(followUp.directGroups[1].totalDebit, expectedSettleAmt);
      assert.equal(followUp.directGroups[1].totalCredit, expectedSettleAmt);
      assert.equal(followUp.keyParameters?.find(p => p.label === 'Remaining Trade Payables')?.value, expectedRemaining);
    } else {
      assert.equal(followUp.keyParameters?.find(p => p.label === 'Trade Payables (Credit Terms)')?.value, 'SGD 14,620');
    }
  }

  // 11c. PPE_IAS16 upfront cash paid
  for (const [cashText, expectedBankCredit, expectedLoanPrincipal] of [
    ['SGD 0', undefined, 87200],
    ['SGD 0.00', undefined, 87200],
    ['SGD 0.01', 0.01, 87199.99],
    ['SGD 0.50', 0.5, 87199.5]
  ]) {
    const q = `A GST-registered company purchased new machinery on 1 April 2026 for SGD 100,000 (exclusive of recoverable 9% GST). Trade-in: old machine agreed trade-in value of SGD 21,800 (inclusive of 9% GST). Old machine cost: SGD 50,000 with accumulated depreciation of SGD 22,500. Cash Paid: ${cashText} paid via bank transfer on 1 April 2026. Loan: 2-year equipment loan with a 5% per annum flat interest rate.`;
    const parsed = await parseAccountingQuery(q, null);
    assert.equal(parsed.isComplete, true, `PPE cash paid ${cashText} must complete`);
    const acqGrp = parsed.directGroups.find(g => g.id === 'grp-acq-new');
    assert.equal(acqGrp?.isBalanced, true);
    assert.equal(acqGrp?.lines.find(l => l.accountCode === '1010')?.credit, expectedBankCredit, `PPE ${cashText} bank line mismatch`);
    const expectedInterest = Math.round(expectedLoanPrincipal * 0.05 * 2 * 100) / 100;
    const expectedGrossLoan = Math.round((expectedLoanPrincipal + expectedInterest) * 100) / 100;
    assert.equal(acqGrp?.lines.find(l => l.accountCode === '2520')?.debit, expectedInterest);
    assert.equal(acqGrp?.lines.find(l => l.accountCode === '2510')?.credit, expectedGrossLoan);
  }

  // 11d. Generic calculateAccountingDelta / UNIVERSAL settlement follow-up
  const univCtx = {
    underlyingTransaction: {
      id: 'tx-univ-zero',
      type: 'share_capital_issuance',
      subject: 'ordinary share capital',
      ownershipContext: 'own_equity',
      currency: 'SGD',
      totalAmount: 100
    },
    outstandingBalances: [
      {
        transactionId: 'tx-univ-zero',
        accountCode: '1150',
        accountName: 'Amount Due from Shareholder',
        category: 'ASSET',
        nature: 'RECEIVABLE',
        counterpartyRole: 'shareholder',
        originalAmount: 100,
        settledAmount: 0,
        remainingAmount: 100,
        currency: 'SGD'
      }
    ],
    recognizedEquityTotal: 100,
    events: []
  };
  for (const zeroAmt of [0, 0.0]) {
    const deltaZero = calculateAccountingDelta(
      univCtx,
      {
        eventType: 'partial_settlement',
        isFollowUp: true,
        targetTransactionId: 'tx-univ-zero',
        targetOutstandingAccount: 'Amount Due from Shareholder',
        settlementAmount: zeroAmt,
        isHypothetical: false,
        explanation: 'Zero settlement'
      },
      'SGD'
    );
    assert.equal(deltaZero, null, `calculateAccountingDelta must return null for settlementAmount=${zeroAmt}`);
  }
  for (const posAmt of [0.01, 0.5]) {
    const deltaPos = calculateAccountingDelta(
      univCtx,
      {
        eventType: 'partial_settlement',
        isFollowUp: true,
        targetTransactionId: 'tx-univ-zero',
        targetOutstandingAccount: 'Amount Due from Shareholder',
        settlementAmount: posAmt,
        isHypothetical: false,
        explanation: 'Small positive settlement'
      },
      'SGD'
    );
    assert.ok(deltaPos, `calculateAccountingDelta must accept settlementAmount=${posAmt}`);
    assert.equal(deltaPos.amount, posAmt);
    assert.equal(deltaPos.journalLines.reduce((s, l) => s + l.debit, 0), posAmt);
    assert.equal(deltaPos.journalLines.reduce((s, l) => s + l.credit, 0), posAmt);
  }
}

// ---------------------------------------------------------------------------
// 12. Finding 4: "non-recoverable input GST" wording detection & true conflicts
// ---------------------------------------------------------------------------
{
  const nonRecovPrompts = [
    'On 1 August 2026, a company purchases office equipment with a list price of SGD 20,000 (exclusive of non-recoverable 9% GST). The vendor grants a 10% trade discount on the list price. The company pays SGD 5,000 immediately by bank transfer and the remaining balance is placed on credit terms.',
    'On 1 August 2026, a GST-registered company purchases office equipment with a list price of SGD 20,000 (exclusive of 9% GST) with non-recoverable input GST. The vendor grants a 10% trade discount on the list price. The company pays SGD 5,000 immediately by bank transfer and the remaining balance is placed on credit terms.',
    'On 1 August 2026, a company purchases office equipment with a list price of SGD 20,000 (exclusive of 9% GST). The 9% input GST is not recoverable. The vendor grants a 10% trade discount on the list price. The company pays SGD 5,000 immediately by bank transfer and the remaining balance is placed on credit terms.',
    'On 1 August 2026, a company purchases office equipment with a list price of SGD 20,000 (exclusive of 9% GST). The input GST is non-recoverable. The vendor grants a 10% trade discount on the list price. The company pays SGD 5,000 immediately by bank transfer and the remaining balance is placed on credit terms.',
    'On 1 August 2026, a company purchases office equipment with a list price of SGD 20,000 (exclusive of 9% GST) with non-claimable input GST. The vendor grants a 10% trade discount on the list price. The company pays SGD 5,000 immediately by bank transfer and the remaining balance is placed on credit terms.'
  ];
  for (const q of nonRecovPrompts) {
    const parsed = await parseAccountingQuery(q, null);
    assert.equal(parsed.isComplete, true, `Non-recoverable wording must complete without false conflict: ${q}`);
    const grp = parsed.directGroups[0];
    assert.equal(grp.lines.find(l => l.accountCode === '1500')?.debit, 19620, 'Non-recoverable 9% GST must be capitalised');
    assert.equal(grp.lines.some(l => l.accountCode === '1190'), false, 'Must omit 1190 Input GST Receivable');
    assert.equal(grp.isBalanced, true);
  }

  // PPE_IAS16 with non-recoverable input GST (both generic company without trade-in GST and GST-registered company with trade-in GST)
  const ppeNonRecovGeneric = 'A company purchased new machinery on 1 April 2026 for SGD 100,000 (exclusive of 9% GST) with non-recoverable input GST. Trade-in: old machine agreed trade-in value of SGD 20,000. Old machine cost: SGD 50,000 with accumulated depreciation of SGD 22,500. Cash Paid: SGD 30,000 paid via bank transfer on 1 April 2026. Loan: 2-year equipment loan with a 5% per annum flat interest rate.';
  const parsedPpeNonRecovGeneric = await parseAccountingQuery(ppeNonRecovGeneric, null);
  assert.equal(parsedPpeNonRecovGeneric.isComplete, true, 'PPE non-recoverable input GST must complete without inventing Output GST');
  assert.equal(parsedPpeNonRecovGeneric.directGroups.find(g => g.id === 'grp-acq-new')?.lines.find(l => l.accountCode === '1600')?.debit, 109000);
  assert.equal(parsedPpeNonRecovGeneric.directGroups.find(g => g.id === 'grp-acq-new')?.lines.some(l => l.accountCode === '1190'), false);
  assert.equal(parsedPpeNonRecovGeneric.directGroups.find(g => g.id === 'grp-disposal-old')?.lines.some(l => l.accountCode === '2200'), false);

  const ppeNonRecovRegistered = 'A GST-registered company purchased new machinery on 1 April 2026 for SGD 100,000 (exclusive of 9% GST) with non-recoverable input GST. Trade-in: old machine agreed trade-in value of SGD 21,800 (inclusive of 9% GST). Old machine cost: SGD 50,000 with accumulated depreciation of SGD 22,500. Cash Paid: SGD 30,000 paid via bank transfer on 1 April 2026. Loan: 2-year equipment loan with a 5% per annum flat interest rate.';
  const parsedPpeNonRecovReg = await parseAccountingQuery(ppeNonRecovRegistered, null);
  assert.equal(parsedPpeNonRecovReg.isComplete, true, 'GST-registered PPE with non-recoverable input GST must complete and still apply Output GST on trade-in');
  assert.equal(parsedPpeNonRecovReg.directGroups.find(g => g.id === 'grp-acq-new')?.lines.find(l => l.accountCode === '1600')?.debit, 109000);
  assert.equal(parsedPpeNonRecovReg.directGroups.find(g => g.id === 'grp-acq-new')?.lines.some(l => l.accountCode === '1190'), false);
  assert.equal(parsedPpeNonRecovReg.directGroups.find(g => g.id === 'grp-disposal-old')?.lines.find(l => l.accountCode === '2200')?.credit, 1800);

  // Follow-up amendment on GST-registered non-recoverable PPE preserves Output GST (1,800), Cash Paid (30,000), and non-recoverable capitalization (130,800)
  const ppeNonRecovAmended = await parseAccountingQuery('Actually the new machine purchase price was SGD 120,000', parsedPpeNonRecovReg);
  assert.equal(ppeNonRecovAmended.isComplete, true);
  assert.equal(ppeNonRecovAmended.directGroups.find(g => g.id === 'grp-acq-new')?.lines.find(l => l.accountCode === '1600')?.debit, 130800);
  assert.equal(ppeNonRecovAmended.directGroups.find(g => g.id === 'grp-acq-new')?.lines.find(l => l.accountCode === '1010')?.credit, 30000);
  assert.equal(ppeNonRecovAmended.directGroups.find(g => g.id === 'grp-disposal-old')?.lines.find(l => l.accountCode === '2200')?.credit, 1800);

  // True conflicts must still fail closed with gstRecoverability
  for (const conflictQuery of [
    'On 1 August 2026, a company purchases office equipment with a list price of SGD 20,000 (exclusive of 9% GST) with recoverable input GST and non-recoverable input GST, paid SGD 5,000 immediately and remaining balance on credit terms.',
    'On 1 August 2026, a non-GST-registered company purchases office equipment with a list price of SGD 20,000 (exclusive of 9% GST) with recoverable input GST, paid SGD 5,000 immediately and remaining balance on credit terms.'
  ]) {
    const parsedConflict = await parseAccountingQuery(conflictQuery, null);
    assert.equal(parsedConflict.isComplete, false, `True GST recoverability conflict must fail closed: ${conflictQuery}`);
    assert.deepEqual(parsedConflict.directGroups, []);
    assert.ok(parsedConflict.missingFields.some(f => f.fieldKey === 'gstRecoverability'));
  }
}

console.log('✅ PASS | Step 1 PPE, Trade Discount, and Journal Integrity regression suite passed.');
