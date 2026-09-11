import { processAccountingQuery } from './src/services/geminiService.ts';
import { defaultTransactionUnderstandingService } from './src/services/transactionUnderstandingService.ts';
import {
  extractAccountingContext,
  validateAccountingStateTransition,
  resolveSettlementTarget
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
      .filter(l => l.accountName.toLowerCase().includes('share capital') && l.credit > 0)
      .reduce((s, l) => s + l.credit, 0);

    assert(shareCapitalCredits === 1000, `Turn ${turnNum}: Cumulative Share Capital credited must be exactly 1,000, got ${shareCapitalCredits}`);

    // In Turn 2 and Turn 3, the latest journal entry must NOT credit Share Capital
    if (turnNum > 1) {
      const latestGrp = res.scenarioState.directGroups[res.scenarioState.directGroups.length - 1];
      const hasEquityCredit = latestGrp.lines.some(l => l.accountName.toLowerCase().includes('share capital') && l.credit > 0);
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
  const ctx1 = extractAccountingContext(r1.scenarioState);
  assert(ctx1.outstandingBalances[0]?.remainingAmount === 1000, 'T1 actual balance must be 1,000');

  // Turn 2: "what if shareholder paid SGD 600 to bank" (hypothetical)
  const q2 = "what if shareholder paid SGD 600 to bank";
  const r2 = await processAccountingQuery(q2, r1.scenarioState, 'SFRS_I');
  assert(r2.scenarioState.isHypothetical === true, 'T2 must be hypothetical');
  const t2RemParam = r2.scenarioState.keyParameters?.find(p => p.label === 'Remaining Balance');
  assert(t2RemParam?.value.includes('400'), `T2 remaining parameter must indicate 400, got ${t2RemParam?.value}`);
  const ctx2 = extractAccountingContext(r2.scenarioState);
  assert(ctx2.outstandingBalances[0]?.remainingAmount === 1000, `T2 actual baseline balance must remain unmutated at 1,000, got ${ctx2.outstandingBalances[0]?.remainingAmount}`);

  // Turn 3: "the shareholder paid $400 into company bank account today" (actual)
  const q3 = "the shareholder paid SGD 400 into company bank account today";
  const r3 = await processAccountingQuery(q3, r2.scenarioState, 'SFRS_I');
  assert(!r3.scenarioState.isHypothetical, 'T3 must be actual');
  const t3RemParam = r3.scenarioState.keyParameters?.find(p => p.label === 'Remaining Balance');
  assert(t3RemParam?.value.includes('600'), `T3 remaining balance must be 600 (not 0!), got ${t3RemParam?.value}`);
  const ctx3 = extractAccountingContext(r3.scenarioState);
  assert(ctx3.outstandingBalances[0]?.remainingAmount === 600, `T3 actual baseline balance must now be 600, got ${ctx3.outstandingBalances[0]?.remainingAmount}`);

  // Turn 4: "what if shareholder pays another $200" (hypothetical)
  const q4 = "what if shareholder pays another SGD 200 to bank";
  const r4 = await processAccountingQuery(q4, r3.scenarioState, 'SFRS_I');
  assert(r4.scenarioState.isHypothetical === true, 'T4 must be hypothetical');
  const t4RemParam = r4.scenarioState.keyParameters?.find(p => p.label === 'Remaining Balance');
  assert(t4RemParam?.value.includes('400'), `T4 remaining balance must project 400, got ${t4RemParam?.value}`);
  const ctx4 = extractAccountingContext(r4.scenarioState);
  assert(ctx4.outstandingBalances[0]?.remainingAmount === 600, `T4 actual balance must remain 600, got ${ctx4.outstandingBalances[0]?.remainingAmount}`);

  console.log('✅ Test 13 Passed: Hypothetical -> Actual -> Hypothetical cycle verified without state corruption\n');
  testsPassed++;
}

console.log('================================================================');
console.log(`🎉 ALL ${testsPassed} MULTI-TURN ACCOUNTING STATE TESTS PASSED!`);
console.log('================================================================\n');
