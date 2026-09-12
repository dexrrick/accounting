import { processAccountingQuery } from './src/services/geminiService.ts';
import { defaultTransactionUnderstandingService } from './src/services/transactionUnderstandingService.ts';
import {
  extractAccountingContext,
  validateAccountingStateTransition,
  resolveSettlementTarget,
  deriveAccountingStateFromEvents,
  calculateAccountingDelta,
  commitAccountingEvent
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

  assert(r2.scenarioState.directGroups && r2.scenarioState.directGroups.length === 2, 'T2 must have 2 cumulative journal entry groups');
  const grp2 = r2.scenarioState.directGroups[r2.scenarioState.directGroups.length - 1];
  
  const bankLine = grp2.lines.find(l => l.accountName.toLowerCase().includes('bank') && l.debit > 0);
  const receivableLine = grp2.lines.find(l => (l.accountName.toLowerCase().includes('due from') || l.accountName.toLowerCase().includes('receivable')) && l.credit > 0);
  const equityLine = grp2.lines.find(l => l.category === 'EQUITY' && l.accountCode === '3000' && l.credit > 0);

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

  assert(r2.scenarioState.directGroups && r2.scenarioState.directGroups.length === 2, 'T2 must have 2 cumulative journal entry groups');
  const grp2 = r2.scenarioState.directGroups[r2.scenarioState.directGroups.length - 1];
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

  assert(r2.scenarioState.directGroups && r2.scenarioState.directGroups.length === 2, 'T2 must have 2 cumulative journal entry groups');
  const grp2 = r2.scenarioState.directGroups[r2.scenarioState.directGroups.length - 1];
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
    const grp = res.scenarioState.directGroups?.[res.scenarioState.directGroups.length - 1];
    const bank = grp?.lines.find(l => l.accountName.toLowerCase().includes('bank') && l.debit > 0);
    const rec = grp?.lines.find(l => l.accountName.toLowerCase().includes('due from') && l.credit > 0);
    assert(Boolean(bank && rec), `Paraphrase '${p}' must resolve to Dr Bank / Cr Shareholder Receivable`);
    assert(!grp.lines.some(l => l.category === 'EQUITY' && l.accountName.toLowerCase().includes('share capital') && l.credit > 0), 'Share capital must not be credited');
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

// --------------------------------------------------------------------------
// TEST 10: 3-Turn Partial Settlement ($1,000 Allotment -> $400 Partial -> $600 Settle)
// --------------------------------------------------------------------------
console.log('--- TEST 10: 3-Turn Partial Settlement ---');
{
  const q1 = "shareholder has invested in own company share capital of SGD 1000 but unpaid what's the double entry";
  const r1 = await processAccountingQuery(q1, null, 'SFRS_I');

  assert(r1.scenarioState.directGroups && r1.scenarioState.directGroups.length === 1, 'T1 must have 1 group');
  assert(r1.scenarioState.amount === 1000, 'T1 amount must be 1000');

  // Turn 2: actual partial payment of $400 into company bank account
  const q2 = "the shareholder paid SGD 400 into company bank account";
  const r2 = await processAccountingQuery(q2, r1.scenarioState, 'SFRS_I');

  assert(r2.scenarioState.directGroups && r2.scenarioState.directGroups.length === 2, 'T2 must have 2 cumulative groups');
  const grp2 = r2.scenarioState.directGroups[1];
  const bank2 = grp2.lines.find(l => l.accountName.toLowerCase().includes('bank') && l.debit > 0);
  const rec2 = grp2.lines.find(l => (l.accountName.toLowerCase().includes('due from') || l.accountName.toLowerCase().includes('receivable')) && l.credit > 0);
  assert(bank2?.debit === 400, `T2 bank debit must be 400, got ${bank2?.debit}`);
  assert(rec2?.credit === 400, `T2 receivable credit must be 400, got ${rec2?.credit}`);

  // Turn 3: "subsequently shareholder settled the remaining balance via bank transfer"
  const q3 = "subsequently shareholder settled the remaining balance via bank transfer";
  const r3 = await processAccountingQuery(q3, r2.scenarioState, 'SFRS_I');

  assert(r3.scenarioState.directGroups && r3.scenarioState.directGroups.length === 3, `T3 must have 3 cumulative groups, got ${r3.scenarioState.directGroups?.length}`);
  const grp3 = r3.scenarioState.directGroups[2];
  const bank3 = grp3.lines.find(l => l.accountName.toLowerCase().includes('bank') && l.debit > 0);
  const rec3 = grp3.lines.find(l => (l.accountName.toLowerCase().includes('due from') || l.accountName.toLowerCase().includes('receivable')) && l.credit > 0);
  assert(bank3?.debit === 600, `T3 bank debit must be remaining 600, got ${bank3?.debit}`);
  assert(rec3?.credit === 600, `T3 receivable credit must be remaining 600, got ${rec3?.credit}`);

  console.log('✅ Test 10 Passed: 3-turn partial settlement correctly tracked and settled remaining balance\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST 11: Strict Invariant: Share Capital Remains Exactly $1,000 Across Lifecycle
// --------------------------------------------------------------------------
console.log('--- TEST 11: Share Capital Invariant Throughout 3-Turn Lifecycle ---');
{
  const q1 = "shareholder has invested in own company share capital of SGD 1000 but unpaid what's the double entry";
  const r1 = await processAccountingQuery(q1, null, 'SFRS_I');
  const r2 = await processAccountingQuery("the shareholder paid SGD 400 into company bank account", r1.scenarioState, 'SFRS_I');
  const r3 = await processAccountingQuery("subsequently shareholder settled the remaining balance via bank transfer", r2.scenarioState, 'SFRS_I');

  // Verify across all turns
  for (const [idx, res] of [r1, r2, r3].entries()) {
    const turnNum = idx + 1;
    const allLines = (res.scenarioState.directGroups || []).flatMap(g => g.lines);
    const shareCapitalCredits = allLines
      .filter(l => l.category === 'EQUITY' && l.accountName.toLowerCase().includes('share capital') && l.credit > 0)
      .reduce((s, l) => s + l.credit, 0);

    assert(shareCapitalCredits === 1000, `Turn ${turnNum}: Cumulative Share Capital credited must be exactly 1,000, got ${shareCapitalCredits}`);

    // In Turn 2 and Turn 3, the latest journal entry must NOT credit Share Capital
    if (turnNum > 1) {
      const latestGrp = res.scenarioState.directGroups[res.scenarioState.directGroups.length - 1];
      const hasEquityCredit = latestGrp.lines.some(l => l.category === 'EQUITY' && l.accountName.toLowerCase().includes('share capital') && l.credit > 0);
      assert(!hasEquityCredit, `Turn ${turnNum}: Settlement entry must NEVER credit Share Capital`);
    }

    const ctx = extractAccountingContext(res.scenarioState);
    assert(ctx.recognizedEquityTotal === 1000, `Turn ${turnNum}: Recognized equity in context must be 1,000, got ${ctx.recognizedEquityTotal}`);
  }

  console.log('✅ Test 11 Passed: Share Capital recognized exactly once ($1,000) and invariant held across all turns\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST 12: Multi-Factor Target Resolution (Confidence, Margin & Ambiguity)
// --------------------------------------------------------------------------
console.log('--- TEST 12: Multi-Factor Target Resolution ---');
{
  const multiBalanceContext = {
    activeEntity: { type: 'company' },
    recognizedEquityTotal: 1000,
    outstandingBalances: [
      {
        balanceKey: '1150_shareholder_default',
        accountCode: '1150',
        accountName: 'Amount Due from Shareholder (Receivable)',
        category: 'ASSET',
        nature: 'RECEIVABLE',
        counterpartyRole: 'shareholder',
        originalAmount: 1000,
        settledAmount: 0,
        remainingAmount: 1000,
        currency: 'SGD'
      },
      {
        balanceKey: '1120_customer_default',
        accountCode: '1120',
        accountName: 'Trade Debtors - Customer ACME Corp',
        category: 'ASSET',
        nature: 'RECEIVABLE',
        counterpartyRole: 'customer',
        originalAmount: 1000,
        settledAmount: 0,
        remainingAmount: 1000,
        currency: 'SGD'
      }
    ],
    events: [],
    actualEvents: [],
    priorJournals: []
  };

  // Case A: Ambiguous query ("they paid into company bank account") -> Ties on generic RECEIVABLE
  const ambiguousRes = resolveSettlementTarget(multiBalanceContext, {
    nature: 'RECEIVABLE',
    queryTokens: ['bank', 'paid'],
    amount: 1000
  });
  assert(ambiguousRes.resolutionStatus === 'AMBIGUOUS', `Expected AMBIGUOUS, got ${ambiguousRes.resolutionStatus}`);
  assert((ambiguousRes.margin ?? 0) < 2.0, `Margin must be < 2.0 for ambiguous tie, got ${ambiguousRes.margin}`);

  // Case B: Disambiguated by counterparty role ("shareholder paid into bank")
  const shareholderRes = resolveSettlementTarget(multiBalanceContext, {
    counterpartyRole: 'shareholder',
    nature: 'RECEIVABLE',
    queryTokens: ['shareholder', 'bank'],
    amount: 1000
  });
  assert(shareholderRes.resolutionStatus === 'RESOLVED', `Expected RESOLVED, got ${shareholderRes.resolutionStatus}`);
  assert(shareholderRes.targetBalance?.counterpartyRole === 'shareholder', 'Must resolve to shareholder');
  assert((shareholderRes.margin ?? 0) >= 2.0, `Margin must be >= 2.0, got ${shareholderRes.margin}`);
  assert(shareholderRes.confidence > 0.5, `Confidence must be high, got ${shareholderRes.confidence}`);

  // Case C: Disambiguated by account name / customer ("customer ACME paid")
  const customerRes = resolveSettlementTarget(multiBalanceContext, {
    accountName: 'Trade Debtors',
    counterpartyRole: 'customer',
    nature: 'RECEIVABLE',
    queryTokens: ['customer', 'acme']
  });
  assert(customerRes.resolutionStatus === 'RESOLVED', `Expected RESOLVED, got ${customerRes.resolutionStatus}`);
  assert(customerRes.targetBalance?.counterpartyRole === 'customer', 'Must resolve to customer');

  console.log('✅ Test 12 Passed: Multi-factor resolution successfully distinguished targets and rejected ambiguity\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST 13: Full Cycle: Hypothetical -> Actual -> Hypothetical
// --------------------------------------------------------------------------
console.log('--- TEST 13: Full Cycle: Hypothetical -> Actual -> Hypothetical ---');
{
  // Turn 1: Initial allotment $1,000 unpaid (actual)
  const q1 = "shareholder has invested in own company share capital of SGD 1000 but unpaid what's the double entry";
  const r1 = await processAccountingQuery(q1, null, 'SFRS_I');
  assert(!r1.scenarioState.isHypothetical, 'T1 must be actual');
  assert(r1.scenarioState.directGroups?.length === 1, 'T1 directGroups must be 1');
  const t1EquityCredit = r1.scenarioState.directGroups[0].lines.reduce((s, l) => s + (l.category === 'EQUITY' && l.accountName.toLowerCase().includes('share capital') ? l.credit : 0), 0);
  assert(t1EquityCredit === 1000, `T1 Share Capital credit must be 1,000, got ${t1EquityCredit}`);
  const ctx1 = extractAccountingContext(r1.scenarioState);
  assert(ctx1.outstandingBalances[0]?.remainingAmount === 1000, 'T1 actual balance must be 1,000');

  // Turn 2: "what if shareholder paid SGD 600 to bank" (hypothetical)
  const q2 = "what if shareholder paid SGD 600 to bank";
  const r2 = await processAccountingQuery(q2, r1.scenarioState, 'SFRS_I');
  assert(r2.scenarioState.isHypothetical === true, 'T2 must be hypothetical');
  assert(r2.scenarioState.committedDirectGroups?.length === 1, 'T2 committedDirectGroups must only contain Turn 1');
  assert(r2.scenarioState.directGroups?.length === 2, 'T2 directGroups UI projection has 2 groups (Turn 1 committed + Turn 2 projected)');
  const t2EquityCredit = r2.scenarioState.directGroups.reduce((s, g) => s + g.lines.reduce((sub, l) => sub + (l.category === 'EQUITY' && l.accountName.toLowerCase().includes('share capital') ? l.credit : 0), 0), 0);
  assert(t2EquityCredit === 1000, `T2 cumulative Share Capital credit must remain 1,000, got ${t2EquityCredit}`);
  const t2RemParam = r2.scenarioState.keyParameters?.find(p => p.label === 'Remaining Balance');
  assert(t2RemParam?.value.includes('400'), `T2 remaining parameter must indicate 400, got ${t2RemParam?.value}`);
  const ctx2 = extractAccountingContext(r2.scenarioState);
  assert(ctx2.outstandingBalances[0]?.remainingAmount === 1000, `T2 actual baseline balance must remain unmutated at 1,000, got ${ctx2.outstandingBalances[0]?.remainingAmount}`);

  // Turn 3: "the shareholder paid $400 into company bank account today" (actual)
  const q3 = "the shareholder paid SGD 400 into company bank account today";
  const r3 = await processAccountingQuery(q3, r2.scenarioState, 'SFRS_I');
  assert(!r3.scenarioState.isHypothetical, 'T3 must be actual');
  assert(r3.scenarioState.directGroups?.length === 2, `T3 directGroups must have exactly 2 groups (Turn 1 initial and Turn 3 actual settlement, NOT Turn 2 hypothetical!), got ${r3.scenarioState.directGroups?.length}`);
  assert(r3.scenarioState.committedDirectGroups?.length === 2, `T3 committedDirectGroups must have 2 groups, got ${r3.scenarioState.committedDirectGroups?.length}`);
  const t3EquityCredit = r3.scenarioState.directGroups.reduce((s, g) => s + g.lines.reduce((sub, l) => sub + (l.category === 'EQUITY' && l.accountName.toLowerCase().includes('share capital') ? l.credit : 0), 0), 0);
  assert(t3EquityCredit === 1000, `T3 cumulative Share Capital credit must remain 1,000 throughout, got ${t3EquityCredit}`);
  const t3RemParam = r3.scenarioState.keyParameters?.find(p => p.label === 'Remaining Balance');
  assert(t3RemParam?.value.includes('600'), `T3 remaining balance must be 600 (not 0!), got ${t3RemParam?.value}`);
  const ctx3 = extractAccountingContext(r3.scenarioState);
  assert(ctx3.outstandingBalances[0]?.remainingAmount === 600, `T3 actual baseline balance must now be 600, got ${ctx3.outstandingBalances[0]?.remainingAmount}`);

  // Turn 4: "what if shareholder pays another $200" (hypothetical)
  const q4 = "what if shareholder pays another SGD 200 to bank";
  const r4 = await processAccountingQuery(q4, r3.scenarioState, 'SFRS_I');
  assert(r4.scenarioState.isHypothetical === true, 'T4 must be hypothetical');
  assert(r4.scenarioState.committedDirectGroups?.length === 2, 'T4 committedDirectGroups must remain 2');
  assert(r4.scenarioState.directGroups?.length === 3, 'T4 directGroups UI projection has 3 groups (Turn 1 + Turn 3 committed + Turn 4 projected)');
  const t4EquityCredit = r4.scenarioState.directGroups.reduce((s, g) => s + g.lines.reduce((sub, l) => sub + (l.category === 'EQUITY' && l.accountName.toLowerCase().includes('share capital') ? l.credit : 0), 0), 0);
  assert(t4EquityCredit === 1000, `T4 cumulative Share Capital credit must remain 1,000 throughout, got ${t4EquityCredit}`);
  const t4RemParam = r4.scenarioState.keyParameters?.find(p => p.label === 'Remaining Balance');
  assert(t4RemParam?.value.includes('400'), `T4 remaining balance must project 400, got ${t4RemParam?.value}`);
  const ctx4 = extractAccountingContext(r4.scenarioState);
  assert(ctx4.outstandingBalances[0]?.remainingAmount === 600, `T4 actual balance must remain 600, got ${ctx4.outstandingBalances[0]?.remainingAmount}`);

  console.log('✅ Test 13 Passed: Hypothetical -> Actual -> Hypothetical cycle verified without state corruption\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST 14: Authoritative Transaction ID Disambiguation between Two Allotments
// --------------------------------------------------------------------------
console.log('--- TEST 14: Authoritative Transaction ID Disambiguation ---');
{
  const multiAllotmentContext = {
    events: [],
    actualEvents: [],
    outstandingBalances: [
      {
        balanceKey: '1150_shareholder_tx-seed-1',
        accountCode: '1150',
        accountName: 'Amount Due from Shareholder (Receivable)',
        category: 'ASSET',
        nature: 'RECEIVABLE',
        counterpartyRole: 'shareholder',
        transactionId: 'tx-seed-1',
        originalAmount: 1000,
        settledAmount: 0,
        remainingAmount: 1000,
        currency: 'SGD'
      },
      {
        balanceKey: '1150_shareholder_tx-series-a-1',
        accountCode: '1150',
        accountName: 'Amount Due from Shareholder (Receivable)',
        category: 'ASSET',
        nature: 'RECEIVABLE',
        counterpartyRole: 'shareholder',
        transactionId: 'tx-series-a-1',
        originalAmount: 5000,
        settledAmount: 0,
        remainingAmount: 5000,
        currency: 'SGD'
      }
    ],
    recognizedEquityTotal: 6000,
    priorJournals: []
  };

  // Resolve with explicit transactionId: 'tx-series-a-1'
  const res = resolveSettlementTarget(multiAllotmentContext, {
    accountName: 'Amount Due from Shareholder (Receivable)',
    counterpartyRole: 'shareholder',
    nature: 'RECEIVABLE',
    transactionId: 'tx-series-a-1',
    amount: 5000
  });

  assert(res.resolutionStatus === 'RESOLVED', `Expected RESOLVED, got ${res.resolutionStatus}`);
  assert(res.targetBalance?.transactionId === 'tx-series-a-1', 'Must resolve to tx-series-a-1');
  assert((res.margin ?? 0) >= 30, `Margin must be >= 30 due to transactionId match/mismatch (+15 vs -20), got ${res.margin}`);
  assert(res.confidence === 1.0, `Confidence must be 1.0, got ${res.confidence}`);

  // Resolve with explicit transactionId: 'tx-seed-1'
  const seedRes = resolveSettlementTarget(multiAllotmentContext, {
    accountName: 'Amount Due from Shareholder (Receivable)',
    counterpartyRole: 'shareholder',
    nature: 'RECEIVABLE',
    transactionId: 'tx-seed-1',
    amount: 1000
  });

  assert(seedRes.resolutionStatus === 'RESOLVED', `Expected RESOLVED, got ${seedRes.resolutionStatus}`);
  assert(seedRes.targetBalance?.transactionId === 'tx-seed-1', 'Must resolve to tx-seed-1');

  console.log('✅ Test 14 Passed: Authoritative transaction ID disambiguated between multiple allotments with decisive margin\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST 15: No Phantom Balance Fabrication on Cash-Paid Equity
// --------------------------------------------------------------------------
console.log('--- TEST 15: No Phantom Balance Fabrication on Cash-Paid Equity ---');
{
  // Turn 1: Shareholder invested $1,000 paid immediately in cash (no receivable exists)
  const cashEquityScenario = {
    scenarioType: 'UNIVERSAL',
    queryIntent: 'TRANSACTION',
    primaryDomain: 'ACCOUNTING_SFRS',
    rawQuery: "shareholder paid $1000 into company bank account for share capital",
    transactionTitle: "Issuance of Share Capital Paid in Cash",
    functionalCurrency: 'SGD',
    transactionCurrency: 'SGD',
    amount: 1000,
    isComplete: true,
    directGroups: [
      {
        id: 'grp-cash-equity-1',
        transactionId: 'tx-cash-allot-1',
        eventDate: '11/09/2026',
        title: 'Share Capital Allotment Paid in Cash',
        summary: 'Paid-up share capital received in bank',
        lines: [
          { id: 'l1', accountCode: '1010', accountName: 'Cash at Bank (Current Account)', category: 'ASSET', debit: 1000, credit: 0, lineExplanation: 'Cash received' },
          { id: 'l2', accountCode: '3000', accountName: 'Share Capital (Ordinary Shares)', category: 'EQUITY', debit: 0, credit: 1000, lineExplanation: 'Share Capital' }
        ],
        totalDebit: 1000,
        totalCredit: 1000,
        isBalanced: true,
        citations: [],
        rationalePoints: [],
        authorityStatus: 'DETERMINISTIC'
      }
    ]
  };

  const convContext = extractAccountingContext(cashEquityScenario);
  assert(convContext.outstandingBalances.length === 0, 'No outstanding balances should exist for cash-paid equity');
  assert(convContext.recognizedEquityTotal === 1000, 'Recognized equity should be 1000');

  // Attempt settlement of non-existent receivable: Must return null, NOT synthesize a fake receivable
  const delta = calculateAccountingDelta(convContext, {
    eventType: 'settlement',
    isFollowUp: true,
    targetOutstandingAccount: 'Amount Due from Shareholder (Receivable)',
    settlementAmount: 1000,
    isHypothetical: false,
    explanation: 'Settlement test'
  }, 'SGD');

  assert(delta === null, 'calculateAccountingDelta must return null when no receivable exists (no phantom fabrication)');
  console.log('✅ Test 15 Passed: Phantom balance fabrication prevented when equity was paid in cash\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST 16: Deterministic Event Replay & Committed History Boundary
// --------------------------------------------------------------------------
console.log('--- TEST 16: Deterministic Event Replay & Committed History Boundary ---');
{
  const immutableEvents = [
    {
      id: 'evt-allot-1',
      transactionId: 'tx-seed-1',
      type: 'initial_transaction',
      description: 'Initial Seed Allotment $10,000 unpaid',
      amount: 10000,
      currency: 'SGD',
      affectedAccounts: ['Amount Due from Shareholder (Receivable)', 'Share Capital (Ordinary Shares)'],
      journalLines: [
        { id: 'l1', accountCode: '1150', accountName: 'Amount Due from Shareholder (Receivable)', category: 'ASSET', debit: 10000, credit: 0, lineExplanation: 'Seed receivable' },
        { id: 'l2', accountCode: '3000', accountName: 'Share Capital (Ordinary Shares)', category: 'EQUITY', debit: 0, credit: 10000, lineExplanation: 'Seed capital' }
      ],
      isHypothetical: false
    },
    {
      id: 'evt-allot-2',
      transactionId: 'tx-series-a-1',
      type: 'initial_transaction',
      description: 'Series A Allotment $50,000 unpaid',
      amount: 50000,
      currency: 'SGD',
      affectedAccounts: ['Amount Due from Shareholder (Receivable)', 'Share Capital (Ordinary Shares)'],
      journalLines: [
        { id: 'l3', accountCode: '1150', accountName: 'Amount Due from Shareholder (Receivable)', category: 'ASSET', debit: 50000, credit: 0, lineExplanation: 'Series A receivable' },
        { id: 'l4', accountCode: '3000', accountName: 'Share Capital (Ordinary Shares)', category: 'EQUITY', debit: 0, credit: 50000, lineExplanation: 'Series A capital' }
      ],
      isHypothetical: false
    },
    {
      id: 'evt-settle-1',
      transactionId: 'tx-settle-1',
      targetTransactionId: 'tx-seed-1',
      type: 'partial_settlement',
      description: 'Partial settlement of Seed $4,000',
      amount: 4000,
      currency: 'SGD',
      affectedAccounts: ['Cash at Bank (Current Account)', 'Amount Due from Shareholder (Receivable)'],
      journalLines: [
        { id: 'l5', accountCode: '1010', accountName: 'Cash at Bank (Current Account)', category: 'ASSET', debit: 4000, credit: 0, lineExplanation: 'Bank receipt' },
        { id: 'l6', accountCode: '1150', accountName: 'Amount Due from Shareholder (Receivable)', category: 'ASSET', debit: 0, credit: 4000, lineExplanation: 'Seed settlement' }
      ],
      isHypothetical: false
    },
    {
      id: 'evt-settle-2',
      transactionId: 'tx-settle-2',
      targetTransactionId: 'tx-series-a-1',
      type: 'partial_settlement',
      description: 'Partial settlement of Series A $20,000',
      amount: 20000,
      currency: 'SGD',
      affectedAccounts: ['Cash at Bank (Current Account)', 'Amount Due from Shareholder (Receivable)'],
      journalLines: [
        { id: 'l7', accountCode: '1010', accountName: 'Cash at Bank (Current Account)', category: 'ASSET', debit: 20000, credit: 0, lineExplanation: 'Bank receipt' },
        { id: 'l8', accountCode: '1150', accountName: 'Amount Due from Shareholder (Receivable)', category: 'ASSET', debit: 0, credit: 20000, lineExplanation: 'Series A settlement' }
      ],
      isHypothetical: false
    },
    {
      id: 'evt-settle-3',
      transactionId: 'tx-settle-3',
      targetTransactionId: 'tx-seed-1',
      type: 'settlement',
      description: 'Full final settlement of Seed remaining $6,000',
      amount: 6000,
      currency: 'SGD',
      affectedAccounts: ['Cash at Bank (Current Account)', 'Amount Due from Shareholder (Receivable)'],
      journalLines: [
        { id: 'l9', accountCode: '1010', accountName: 'Cash at Bank (Current Account)', category: 'ASSET', debit: 6000, credit: 0, lineExplanation: 'Bank receipt' },
        { id: 'l10', accountCode: '1150', accountName: 'Amount Due from Shareholder (Receivable)', category: 'ASSET', debit: 0, credit: 6000, lineExplanation: 'Final seed settlement' }
      ],
      isHypothetical: false
    }
  ];

  // Replay
  const replayState = deriveAccountingStateFromEvents(immutableEvents, 'SGD');
  assert(replayState.recognizedEquityTotal === 60000, `Total equity must be 60,000, got ${replayState.recognizedEquityTotal}`);
  assert(replayState.outstandingBalances.length === 2, `Must have 2 distinct balances, got ${replayState.outstandingBalances.length}`);

  const seedBal = replayState.outstandingBalances.find(b => b.transactionId === 'tx-seed-1');
  assert(seedBal?.originalAmount === 10000, 'Seed original must be 10,000');
  assert(seedBal?.settledAmount === 10000, 'Seed settled must be 10,000');
  assert(seedBal?.remainingAmount === 0, `Seed remaining must be 0, got ${seedBal?.remainingAmount}`);

  const seriesABal = replayState.outstandingBalances.find(b => b.transactionId === 'tx-series-a-1');
  assert(seriesABal?.originalAmount === 50000, 'Series A original must be 50,000');
  assert(seriesABal?.settledAmount === 20000, 'Series A settled must be 20,000');
  assert(seriesABal?.remainingAmount === 30000, `Series A remaining must be 30,000, got ${seriesABal?.remainingAmount}`);

  // Test commitAccountingEvent guards
  // 1. Reject hypothetical events
  let caughtHypo = false;
  try {
    commitAccountingEvent(immutableEvents, {
      id: 'evt-hypo-fail',
      transactionId: 'tx-hypo-fail',
      type: 'settlement',
      description: 'Hypothetical attempt',
      isHypothetical: true
    });
  } catch (_err) {
    caughtHypo = true;
  }
  assert(caughtHypo, 'commitAccountingEvent must throw when attempting to commit a hypothetical event');

  // 2. Reject duplicate transaction ID
  let caughtDup = false;
  try {
    commitAccountingEvent(immutableEvents, {
      id: 'evt-dup-fail',
      transactionId: 'tx-seed-1', // Already committed!
      type: 'initial_transaction',
      description: 'Duplicate transaction attempt',
      isHypothetical: false
    });
  } catch (_err) {
    caughtDup = true;
  }
  assert(caughtDup, 'commitAccountingEvent must throw when attempting to commit a duplicate transactionId');

  // 3. Reject missing or 'default' transaction ID
  let caughtDefaultTx = false;
  try {
    commitAccountingEvent(immutableEvents, {
      id: 'evt-default-fail',
      transactionId: 'default',
      targetTransactionId: 'tx-seed-1',
      type: 'settlement',
      description: 'Default transaction ID attempt',
      isHypothetical: false
    });
  } catch (err) {
    assert(err.message.includes('INVALID_TRANSACTION_ID'), `Expected INVALID_TRANSACTION_ID error, got: ${err.message}`);
    caughtDefaultTx = true;
  }
  assert(caughtDefaultTx, 'commitAccountingEvent must throw when transactionId is "default"');

  // 4. Reject settlement without target identity (neither targetTransactionId nor targetBalanceKey)
  let caughtNoTarget = false;
  try {
    commitAccountingEvent(immutableEvents, {
      id: 'evt-no-target-fail',
      transactionId: 'tx-valid-tx-id',
      type: 'settlement',
      description: 'Settlement without target identity attempt',
      isHypothetical: false
    });
  } catch (err) {
    assert(err.message.includes('INVALID_SETTLEMENT_TARGET'), `Expected INVALID_SETTLEMENT_TARGET error, got: ${err.message}`);
    caughtNoTarget = true;
  }
  assert(caughtNoTarget, 'commitAccountingEvent must throw when settlement lacks targetTransactionId and targetBalanceKey');

  console.log('✅ Test 16 Passed: Deterministic event replay and committed event boundary enforcement verified\n');
  testsPassed++;
}

// --------------------------------------------------------------------------
// TEST 17: True End-to-End Multi-Turn Replay Equivalence (4-Turn Actual Lifecycle)
// --------------------------------------------------------------------------
console.log('--- TEST 17: True End-to-End Multi-Turn Replay Equivalence (4-Turn Lifecycle) ---');
{
  // Turn 1: Initial allotment $1,000 unpaid (actual)
  const q1 = "shareholder has invested in own company share capital of SGD 1000 but unpaid what's the double entry";
  const r1 = await processAccountingQuery(q1, null, 'SFRS_I');
  assert(!r1.scenarioState.isHypothetical, 'Turn 1 must be actual');
  assert(r1.scenarioState.actualEvents?.length === 1, 'Turn 1 actualEvents must have 1 event');
  const t1TxId = r1.scenarioState.actualEvents[0].transactionId;
  assert(Boolean(t1TxId) && t1TxId !== 'default', `Turn 1 transactionId must be authoritative, got "${t1TxId}"`);

  // Turn 2: Shareholder paid $300 to company bank account (actual partial)
  const q2 = "shareholder paid SGD 300 to company bank account";
  const r2 = await processAccountingQuery(q2, r1.scenarioState, 'SFRS_I');
  assert(!r2.scenarioState.isHypothetical, 'Turn 2 must be actual');
  assert(r2.scenarioState.actualEvents?.length === 2, `Turn 2 actualEvents must have 2 events, got ${r2.scenarioState.actualEvents?.length}`);
  const t2Event = r2.scenarioState.actualEvents[1];
  assert(t2Event.type === 'partial_settlement', `Turn 2 event type must be partial_settlement, got ${t2Event.type}`);
  assert(t2Event.targetTransactionId === t1TxId, `Turn 2 targetTransactionId must match Turn 1 transactionId "${t1TxId}", got "${t2Event.targetTransactionId}"`);

  // Turn 3: Shareholder paid another $200 to company bank account (actual partial)
  const q3 = "shareholder paid another SGD 200 to company bank account";
  const r3 = await processAccountingQuery(q3, r2.scenarioState, 'SFRS_I');
  assert(!r3.scenarioState.isHypothetical, 'Turn 3 must be actual');
  assert(r3.scenarioState.actualEvents?.length === 3, `Turn 3 actualEvents must have 3 events, got ${r3.scenarioState.actualEvents?.length}`);
  const t3Event = r3.scenarioState.actualEvents[2];
  assert(t3Event.type === 'partial_settlement', `Turn 3 event type must be partial_settlement, got ${t3Event.type}`);
  assert(t3Event.targetTransactionId === t1TxId, `Turn 3 targetTransactionId must match Turn 1 transactionId "${t1TxId}", got "${t3Event.targetTransactionId}"`);

  // Turn 4: Shareholder paid remaining $500 to company bank account (actual final settlement)
  const q4 = "shareholder paid remaining SGD 500 to company bank account";
  const r4 = await processAccountingQuery(q4, r3.scenarioState, 'SFRS_I');
  assert(!r4.scenarioState.isHypothetical, 'Turn 4 must be actual');
  assert(r4.scenarioState.actualEvents?.length === 4, `Turn 4 actualEvents must have 4 events, got ${r4.scenarioState.actualEvents?.length}`);
  const t4Event = r4.scenarioState.actualEvents[3];
  assert(t4Event.type === 'settlement', `Turn 4 event type must be settlement (final), got ${t4Event.type}`);
  assert(t4Event.targetTransactionId === t1TxId, `Turn 4 targetTransactionId must match Turn 1 transactionId "${t1TxId}", got "${t4Event.targetTransactionId}"`);

  // Verify all 4 events have unique, authoritative transaction IDs
  const txIds = r4.scenarioState.actualEvents.map(e => e.transactionId);
  const uniqueTxIds = new Set(txIds);
  assert(uniqueTxIds.size === 4, `All 4 events must have unique transaction IDs, got ${uniqueTxIds.size}`);
  assert(!txIds.includes('default'), 'No event may have transactionId "default"');

  // Verify cumulative UI projection in directGroups: 4 groups
  assert(r4.scenarioState.directGroups?.length === 4, `UI projection directGroups must have 4 groups, got ${r4.scenarioState.directGroups?.length}`);

  // INVARIANT 1: Share Capital is recognized EXACTLY once ($1,000) across all 4 journals
  const totalShareCapitalCredit = r4.scenarioState.directGroups.reduce((acc, g) =>
    acc + g.lines.reduce((sub, l) => sub + (l.category === 'EQUITY' && l.accountName.toLowerCase().includes('share capital') ? l.credit : 0), 0), 0
  );
  assert(totalShareCapitalCredit === 1000, `Cumulative Share Capital credit must remain exactly 1,000, got ${totalShareCapitalCredit}`);

  // INVARIANT 2: Total Cash received at bank across settlements is $1,000 ($300 + $200 + $500)
  const totalCashDebit = r4.scenarioState.directGroups.reduce((acc, g) =>
    acc + g.lines.reduce((sub, l) => sub + (l.accountName.toLowerCase().includes('cash at bank') ? l.debit : 0), 0), 0
  );
  assert(totalCashDebit === 1000, `Total Cash at Bank debit must be 1,000, got ${totalCashDebit}`);

  // TRUE REPLAY EQUIVALENCE TEST:
  // Replay from actualEvents source of truth must produce the EXACT same state as incremental processing
  const incrementalContext = extractAccountingContext(r4.scenarioState);
  const replayedState = deriveAccountingStateFromEvents(r4.scenarioState.actualEvents, 'SGD');

  // Assert Replayed Equity === Incremental Equity === 1000
  assert(replayedState.recognizedEquityTotal === 1000, `Replayed equity total must be 1,000, got ${replayedState.recognizedEquityTotal}`);
  assert(incrementalContext.recognizedEquityTotal === 1000, `Incremental equity total must be 1,000, got ${incrementalContext.recognizedEquityTotal}`);
  assert(replayedState.recognizedEquityTotal === incrementalContext.recognizedEquityTotal, 'Replayed equity total must match incremental equity total exactly');

  // Assert Replayed Balances === Incremental Balances
  assert(replayedState.outstandingBalances.length === 1, `Must have exactly 1 outstanding balance tracking the allotment, got ${replayedState.outstandingBalances.length}`);
  assert(incrementalContext.outstandingBalances.length === 1, `Incremental context must have 1 balance, got ${incrementalContext.outstandingBalances.length}`);

  const replayedBal = replayedState.outstandingBalances[0];
  const incrementalBal = incrementalContext.outstandingBalances[0];

  assert(replayedBal.originalAmount === 1000, `Replayed originalAmount must be 1,000, got ${replayedBal.originalAmount}`);
  assert(incrementalBal.originalAmount === 1000, `Incremental originalAmount must be 1,000, got ${incrementalBal.originalAmount}`);

  assert(replayedBal.settledAmount === 1000, `Replayed settledAmount must be 1,000, got ${replayedBal.settledAmount}`);
  assert(incrementalBal.settledAmount === 1000, `Incremental settledAmount must be 1,000, got ${incrementalBal.settledAmount}`);

  assert(replayedBal.remainingAmount === 0, `Replayed remainingAmount must be 0, got ${replayedBal.remainingAmount}`);
  assert(incrementalBal.remainingAmount === 0, `Incremental remainingAmount must be 0, got ${incrementalBal.remainingAmount}`);

  assert(replayedBal.remainingAmount === incrementalBal.remainingAmount, 'Replay remaining amount must equal incremental remaining amount');
  assert(replayedBal.settledAmount === incrementalBal.settledAmount, 'Replay settled amount must equal incremental settled amount');
  assert(replayedBal.balanceKey === incrementalBal.balanceKey, 'Replay balanceKey must equal incremental balanceKey');

  console.log('✅ Test 17 Passed: True end-to-end multi-turn replay equivalence verified across 4-turn lifecycle (Allotment -> $300 -> $200 -> $500)\n');
  testsPassed++;
}

console.log('================================================================');
console.log(`🎉 ALL ${testsPassed} MULTI-TURN ACCOUNTING STATE TESTS PASSED!`);
console.log('================================================================\n');
