import { processAccountingQuery } from './src/services/geminiService.ts';
import { defaultTransactionUnderstandingService } from './src/services/transactionUnderstandingService.ts';
import {
  extractAccountingContext,
  validateAccountingStateTransition
} from './src/services/conversationAccountingState.ts';

console.log('================================================================');
console.log('🧪 RUNNING MULTI-TURN ACCOUNTING STATE & FOLLOW-UP EVENT SUITE');
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
// TEST 1: Full Settlement ($1 Unpaid -> Paid to Bank Account)
// --------------------------------------------------------------------------
console.log('--- TEST 1: Full Settlement ($1 Unpaid -> Bank Payment) ---');
{
  const q1 = "shareholder has invested in own company share capital of $1 but unpaid what's the double entry";
  const r1 = await processAccountingQuery(q1, null, 'SFRS_I');
  
  assert(r1.scenarioState.amount === 1, 'T1 amount must be 1');
  const t1ReceivableLine = r1.scenarioState.directGroups?.[0]?.lines.find(l => l.category === 'ASSET' && l.debit > 0);
  const t1EquityLine = r1.scenarioState.directGroups?.[0]?.lines.find(l => l.category === 'EQUITY' && l.credit > 0);
  assert(Boolean(t1ReceivableLine), 'T1 must have a debit to receivable / amount due from shareholder');
  assert(Boolean(t1EquityLine), 'T1 must have a credit to Share Capital');

  const q2 = "what if the shareholder did paid to company bank account what will be the journal entry";
  const r2 = await processAccountingQuery(q2, r1.scenarioState, 'SFRS_I');

  assert(r2.scenarioState.directGroups && r2.scenarioState.directGroups.length === 1, 'T2 must have 1 journal entry group');
  const grp2 = r2.scenarioState.directGroups[0];
  
  const bankLine = grp2.lines.find(l => l.accountName.toLowerCase().includes('bank') && l.debit > 0);
  const receivableLine = grp2.lines.find(l => (l.accountName.toLowerCase().includes('due from') || l.accountName.toLowerCase().includes('receivable')) && l.credit > 0);
  const equityLine = grp2.lines.find(l => l.accountName.toLowerCase().includes('share capital') && l.credit > 0);

  assert(Boolean(bankLine), 'T2 must debit Cash at Bank');
  assert(bankLine.debit === 1, `Bank debit must be 1.00, got ${bankLine?.debit}`);
  assert(Boolean(receivableLine), 'T2 must credit Amount Due from Shareholder (Receivable)');
  assert(receivableLine.credit === 1, `Receivable credit must be 1.00, got ${receivableLine?.credit}`);
  assert(!equityLine, 'GUARDRAIL A: Share Capital must NEVER be credited again upon settlement');
  assert(grp2.isBalanced, 'T2 journal entry must be balanced');
  assert(!r2.messageText.includes('invested USD 0'), 'Must not contain hallucinated USD foreign shares text');
  console.log('✅ Test 1 Passed: Full settlement generates Dr Bank / Cr Shareholder Receivable without crediting equity\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST 2: Partial Settlement ("50 cents")
// --------------------------------------------------------------------------
console.log('--- TEST 2: Partial Settlement ("50 cents") ---');
{
  const r1Scenario = {
    scenarioType: 'UNIVERSAL',
    queryIntent: 'TRANSACTION',
    primaryDomain: 'ACCOUNTING_SFRS',
    rawQuery: "shareholder has invested in own company share capital of $1 but unpaid",
    transactionTitle: "Issuance of Unpaid Share Capital",
    functionalCurrency: 'SGD',
    transactionCurrency: 'SGD',
    amount: 1,
    isComplete: true,
    directGroups: [
      {
        id: 'grp-1',
        eventDate: '11/09/2026',
        title: 'Share Capital Allotment (Unpaid)',
        summary: 'Allotment of $1 share capital unpaid',
        lines: [
          { id: 'l1', accountCode: '1150', accountName: 'Amount Due from Shareholder (Receivable)', category: 'ASSET', debit: 1, credit: 0, lineExplanation: 'Receivable' },
          { id: 'l2', accountCode: '3000', accountName: 'Share Capital (Ordinary Shares)', category: 'EQUITY', debit: 0, credit: 1, lineExplanation: 'Share Capital' }
        ],
        totalDebit: 1,
        totalCredit: 1,
        isBalanced: true,
        citations: [],
        rationalePoints: [],
        authorityStatus: 'DETERMINISTIC'
      }
    ]
  };

  const q2 = "what if they paid 50 cents to the bank account";
  const r2 = await processAccountingQuery(q2, r1Scenario, 'SFRS_I');

  const grp2 = r2.scenarioState.directGroups?.[0];
  assert(Boolean(grp2), 'T2 must produce a journal group');
  const bankLine = grp2.lines.find(l => l.accountName.toLowerCase().includes('bank') && l.debit > 0);
  const receivableLine = grp2.lines.find(l => l.accountName.toLowerCase().includes('due from') && l.credit > 0);

  assert(bankLine && bankLine.debit === 0.5, `Bank debit must be 0.50, got ${bankLine?.debit}`);
  assert(receivableLine && receivableLine.credit === 0.5, `Receivable credit must be 0.50, got ${receivableLine?.credit}`);
  assert(grp2.isBalanced, 'Partial settlement entry must be balanced');
  console.log('✅ Test 2 Passed: Partial settlement extracts 50 cents ($0.50) correctly\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST 3: Follow-Up Without Repeating Amount (Turn 1 SGD 5,000 -> Turn 2 inherits)
// --------------------------------------------------------------------------
console.log('--- TEST 3: Inherit Amount Without Repeating in Follow-Up ---');
{
  const r1Scenario = {
    scenarioType: 'UNIVERSAL',
    queryIntent: 'TRANSACTION',
    primaryDomain: 'ACCOUNTING_SFRS',
    rawQuery: "subscriber took up shares for SGD 5,000 but amount is unpaid",
    transactionTitle: "Share Capital Issuance",
    functionalCurrency: 'SGD',
    transactionCurrency: 'SGD',
    amount: 5000,
    isComplete: true,
    directGroups: [
      {
        id: 'grp-1',
        eventDate: '11/09/2026',
        title: 'Share Capital Allotment',
        summary: 'Allotment unpaid',
        lines: [
          { id: 'l1', accountCode: '1150', accountName: 'Amount Due from Shareholder (Receivable)', category: 'ASSET', debit: 5000, credit: 0, lineExplanation: 'Receivable' },
          { id: 'l2', accountCode: '3000', accountName: 'Share Capital (Ordinary Shares)', category: 'EQUITY', debit: 0, credit: 5000, lineExplanation: 'Share Capital' }
        ],
        totalDebit: 5000,
        totalCredit: 5000,
        isBalanced: true,
        citations: [],
        rationalePoints: [],
        authorityStatus: 'DETERMINISTIC'
      }
    ]
  };

  const q2 = "subsequently the subscriber remitted the funds into our bank account";
  const r2 = await processAccountingQuery(q2, r1Scenario, 'SFRS_I');

  const grp2 = r2.scenarioState.directGroups?.[0];
  assert(Boolean(grp2), 'T2 must produce entry');
  const bankLine = grp2.lines.find(l => l.accountName.toLowerCase().includes('bank') && l.debit > 0);
  const recLine = grp2.lines.find(l => l.accountName.toLowerCase().includes('due from') && l.credit > 0);

  assert(bankLine?.debit === 5000, `Must inherit SGD 5,000 amount, got ${bankLine?.debit}`);
  assert(recLine?.credit === 5000, `Must credit full SGD 5,000 receivable, got ${recLine?.credit}`);
  console.log('✅ Test 3 Passed: Inherited SGD 5,000 amount across conversational turns\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST 4: Natural Language Settlement Paraphrases
// --------------------------------------------------------------------------
console.log('--- TEST 4: Natural Language Settlement Paraphrases ---');
{
  const r1Scenario = {
    scenarioType: 'UNIVERSAL',
    amount: 100,
    functionalCurrency: 'SGD',
    directGroups: [
      {
        id: 'g1',
        lines: [
          { id: 'l1', accountCode: '1150', accountName: 'Amount Due from Shareholder (Receivable)', category: 'ASSET', debit: 100, credit: 0, lineExplanation: 'Receivable' },
          { id: 'l2', accountCode: '3000', accountName: 'Share Capital', category: 'EQUITY', debit: 0, credit: 100, lineExplanation: 'Share Capital' }
        ],
        totalDebit: 100,
        totalCredit: 100,
        isBalanced: true
      }
    ]
  };

  const paraphrases = [
    "the money was received into our corporate DBS account",
    "founder settled the subscription money via bank",
    "cash was deposited into the bank for the shares"
  ];

  for (const p of paraphrases) {
    const res = await processAccountingQuery(p, r1Scenario, 'SFRS_I');
    const grp = res.scenarioState.directGroups?.[0];
    const bank = grp?.lines.find(l => l.accountName.toLowerCase().includes('bank') && l.debit > 0);
    const rec = grp?.lines.find(l => l.accountName.toLowerCase().includes('due from') && l.credit > 0);
    assert(Boolean(bank && rec), `Paraphrase '${p}' must resolve to Dr Bank / Cr Shareholder Receivable`);
    assert(!grp.lines.some(l => l.accountName.toLowerCase().includes('share capital') && l.credit > 0), 'Share capital must not be credited');
  }
  console.log('✅ Test 4 Passed: All conversational settlement paraphrases correctly resolved\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST 5: External Investment Separation (Apple shares broker payment)
// --------------------------------------------------------------------------
console.log('--- TEST 5: External Investment Separation ---');
{
  const appleScenario = {
    scenarioType: 'EQUITY_INVESTMENT_FX',
    assetName: 'Apple Inc. (AAPL)',
    functionalCurrency: 'SGD',
    transactionCurrency: 'USD',
    purchaseAmountForeign: 300000,
    directGroups: []
  };

  const convContext = extractAccountingContext(appleScenario);
  assert(convContext.underlyingTransaction?.ownershipContext === 'external_investment', 'Must detect external_investment');
  assert(convContext.outstandingBalances.length === 0, 'No shareholder receivable for external investment');

  // Should NOT classify as own_equity settlement
  const understanding = defaultTransactionUnderstandingService.understandTransactionSync(
    "we settled the broker invoice for apple shares",
    'SGD',
    'SG',
    convContext
  );
  assert(understanding.ownershipContext === 'external_investment', 'Must remain external_investment');
  console.log('✅ Test 5 Passed: External investment separation maintained\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST 6: Prevent Duplicate Share Capital Credit Across Lifecycle (Guardrail A)
// --------------------------------------------------------------------------
console.log('--- TEST 6: Guardrail A Violation Detection ---');
{
  const context = {
    activeEntity: { type: 'company' },
    recognizedEquityTotal: 1000,
    outstandingBalances: [
      {
        accountCode: '1150',
        accountName: 'Amount Due from Shareholder (Receivable)',
        category: 'ASSET',
        nature: 'RECEIVABLE',
        counterpartyRole: 'shareholder',
        originalAmount: 1000,
        settledAmount: 0,
        remainingAmount: 1000,
        currency: 'SGD'
      }
    ],
    events: [],
    priorJournals: []
  };

  // Erroneous proposed lines crediting Share Capital again upon bank payment
  const badProposedLines = [
    { id: '1', accountCode: '1010', accountName: 'Cash at Bank', category: 'ASSET', debit: 1000, credit: 0, lineExplanation: 'Bank' },
    { id: '2', accountCode: '3000', accountName: 'Share Capital (Ordinary Shares)', category: 'EQUITY', debit: 0, credit: 1000, lineExplanation: 'Erroneous duplicate equity' }
  ];

  const validation = validateAccountingStateTransition(context, badProposedLines, 'settlement');
  assert(!validation.isValid, 'Validation must reject duplicate share capital credit');
  assert(validation.violations.some(v => v.includes('GUARDRAIL_VIOLATION_DUPLICATE_EQUITY')), 'Must trigger GUARDRAIL_VIOLATION_DUPLICATE_EQUITY');
  console.log('✅ Test 6 Passed: Guardrail A successfully blocked duplicate equity recognition\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST 7: Hypothetical vs Actual Event Classification
// --------------------------------------------------------------------------
console.log('--- TEST 7: Hypothetical vs Actual Event Classification ---');
{
  const context = {
    activeEntity: { type: 'company' },
    recognizedEquityTotal: 1,
    outstandingBalances: [{
      accountCode: '1150',
      accountName: 'Amount Due from Shareholder (Receivable)',
      category: 'ASSET',
      nature: 'RECEIVABLE',
      counterpartyRole: 'shareholder',
      originalAmount: 1,
      settledAmount: 0,
      remainingAmount: 1,
      currency: 'SGD'
    }],
    events: [],
    priorJournals: []
  };

  const hypo = defaultTransactionUnderstandingService.understandTransactionSync(
    "what if the shareholder did paid to company bank account",
    'SGD',
    'SG',
    context
  );
  assert(hypo.followUpAnalysis?.isHypothetical === true, 'Must identify "what if" as hypothetical');

  const actual = defaultTransactionUnderstandingService.understandTransactionSync(
    "the shareholder has paid the $1 into the company bank account today",
    'SGD',
    'SG',
    context
  );
  assert(actual.followUpAnalysis?.isHypothetical === false, 'Must identify declarative payment as actual event');
  console.log('✅ Test 7 Passed: Hypothetical and actual events distinguished correctly\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST 8: Context Extraction Logic
// --------------------------------------------------------------------------
console.log('--- TEST 8: extractAccountingContext Logic ---');
{
  const sampleScenario = {
    scenarioType: 'UNIVERSAL',
    transactionTitle: 'Founder Capital Allotment',
    amount: 500,
    functionalCurrency: 'SGD',
    directGroups: [
      {
        id: 'g1',
        title: 'Allotment',
        eventDate: '01/01/2026',
        totalDebit: 500,
        totalCredit: 500,
        lines: [
          { id: '1', accountCode: '1150', accountName: 'Amount Due from Shareholder', category: 'ASSET', debit: 500, credit: 0, lineExplanation: 'Receivable' },
          { id: '2', accountCode: '3000', accountName: 'Share Capital', category: 'EQUITY', debit: 0, credit: 500, lineExplanation: 'Equity' }
        ]
      }
    ]
  };

  const ctx = extractAccountingContext(sampleScenario);
  assert(ctx.recognizedEquityTotal === 500, `Expected 500 equity, got ${ctx.recognizedEquityTotal}`);
  assert(ctx.outstandingBalances.length === 1, 'Expected 1 outstanding balance');
  assert(ctx.outstandingBalances[0].nature === 'RECEIVABLE', 'Expected receivable');
  assert(ctx.outstandingBalances[0].remainingAmount === 500, 'Expected 500 remaining amount');
  assert(ctx.underlyingTransaction?.ownershipContext === 'own_equity', 'Expected own_equity context');
  console.log('✅ Test 8 Passed: Context extraction correctly identified receivable, equity total, and ownership\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST 9: Context Reset on New Unrelated Transaction
// --------------------------------------------------------------------------
console.log('--- TEST 9: Context Reset on New Unrelated Transaction ---');
{
  const shareCapitalState = {
    scenarioType: 'UNIVERSAL',
    rawQuery: "shareholder has invested in own company share capital of $1 but unpaid",
    transactionTitle: "Issuance of Unpaid Share Capital",
    functionalCurrency: 'SGD',
    amount: 1,
    directGroups: [
      {
        id: 'g1',
        title: 'Share Capital Allotment',
        lines: [
          { id: '1', accountCode: '1150', accountName: 'Amount Due from Shareholder (Receivable)', category: 'ASSET', debit: 1, credit: 0, lineExplanation: 'Receivable' },
          { id: '2', accountCode: '3000', accountName: 'Share Capital (Ordinary Shares)', category: 'EQUITY', debit: 0, credit: 1, lineExplanation: 'Equity' }
        ],
        totalDebit: 1,
        totalCredit: 1,
        isBalanced: true
      }
    ]
  };

  // Turn 2 is an explicit office equipment purchase query
  const q2New = "On 1 August 2026, a GST-registered company purchases office equipment with a list price of SGD 20,000 (exclusive of 9% GST). The vendor grants a 10% trade discount on the list price. The company pays SGD 5,000 immediately by bank transfer and the remaining balance is placed on credit terms. Required: Prepare the single compound journal entry on 1 August 2026 to record the purchase.";
  const r2New = await processAccountingQuery(q2New, shareCapitalState, 'SFRS_I');

  assert(r2New.scenarioState.scenarioType === 'ASSET_PURCHASE_DISCOUNT', `Expected ASSET_PURCHASE_DISCOUNT, got ${r2New.scenarioState.scenarioType}`);
  const equipLine = r2New.scenarioState.directGroups?.[0]?.lines.find(l => l.accountCode === '1500');
  assert(equipLine && equipLine.debit === 18000, 'Must record office equipment purchase, not share capital settlement');
  console.log('✅ Test 9 Passed: New unrelated transaction cleanly resets context to asset purchase\n');
  testsPassed++;
}

console.log('================================================================');
console.log(`🎉 ALL ${testsPassed} MULTI-TURN ACCOUNTING STATE TESTS PASSED!`);
console.log('================================================================\n');
