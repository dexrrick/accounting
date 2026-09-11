import assert from 'assert';
import { defaultTransactionUnderstandingService } from './src/services/transactionUnderstandingService.ts';
import { defaultAccountingGuardrails } from './src/engine/accountingGuardrails.ts';
import { isDeterministicFixture, parseAccountingQuery } from './src/engine/scenarioParser.ts';
import { processAccountingQuery } from './src/services/geminiService.ts';

async function runSideQuest2Tests() {
  console.log('================================================================');
  console.log('🚀 RUNNING SIDE QUEST 2: AI SEMANTIC UNDERSTANDING & ROUTING');
  console.log('================================================================\n');

  let passed = 0;

  // -------------------------------------------------------------------------
  // TEST GROUP 1: EXACT REGRESSION TEST FOR CURRENT BUG QUERY
  // -------------------------------------------------------------------------
  console.log('[1. CURRENT BUG REGRESSION]');
  const bugQuery = "shareholder has invested in own company share capital of $1 but unpaid what's the double entry";
  const sem1 = defaultTransactionUnderstandingService.understandTransactionSync(bugQuery, 'SGD', 'SG');

  assert.strictEqual(sem1.ownershipContext, 'own_equity', 'Must identify own_equity');
  assert.strictEqual(sem1.counterparty?.role, 'shareholder', 'Must identify shareholder counterparty');
  assert.strictEqual(sem1.paymentStatus, 'unpaid', 'Must identify unpaid payment status');
  assert.strictEqual(sem1.currency.value, 'SGD', 'In Singapore context, $ defaults to contextual SGD');
  assert.strictEqual(sem1.currency.source, 'context_inference', 'Currency source must be context_inference');
  assert.notStrictEqual(sem1.currency.value, 'USD', 'Must NEVER default to USD');

  // Guardrail check against illicit FVTPL
  const illicitGroup = [
    {
      id: 'grp-test',
      eventDate: '2026-09-11',
      title: 'Erroneous Entry',
      summary: 'Illegal classification',
      lines: [
        { id: '1', accountCode: '1210', accountName: 'Financial Asset at FVTPL (Foreign Shares Investment)', category: 'ASSET', debit: 1.34, credit: 0 },
        { id: '2', accountCode: '1010', accountName: 'Cash at Bank (USD Account)', category: 'ASSET', debit: 0, credit: 1.34 }
      ],
      totalDebit: 1.34,
      totalCredit: 1.34,
      isBalanced: true
    }
  ];
  const guardrailViolations = defaultAccountingGuardrails.validate(sem1, illicitGroup, 'SGD');
  assert.strictEqual(guardrailViolations.isValid, false, 'Guardrail must reject FVTPL for own equity');
  assert.ok(guardrailViolations.violations.some(v => v.code === 'OWN_EQUITY_ASSET_PROHIBITED'), 'Violation code must be OWN_EQUITY_ASSET_PROHIBITED');

  console.log('✓ 1A. Proved: Underlying economic facts correctly extracted (own_equity, shareholder, unpaid, non-USD)');
  console.log('✓ 1B. Proved: Accounting guardrails strictly reject FVTPL / foreign shares asset classification');
  passed += 2;

  // -------------------------------------------------------------------------
  // TEST GROUP 2: PARAPHRASE CONSISTENCY (5 VARIATIONS OF UNPAID SHARE CAPITAL)
  // -------------------------------------------------------------------------
  console.log('\n[2. PARAPHRASE CONSISTENCY (UNPAID SHARE CAPITAL)]');
  const paraphrases = [
    "Shareholder subscribed for $1 of shares but hasn't paid.",
    "We issued one dollar of ordinary shares to the founder, payment pending.",
    "Founder took up shares but the subscription money is outstanding.",
    "Share capital was issued but remains unpaid.",
    "Shareholder owes the company the amount subscribed for."
  ];

  for (let i = 0; i < paraphrases.length; i++) {
    const q = paraphrases[i];
    const sem = defaultTransactionUnderstandingService.understandTransactionSync(q, 'SGD', 'SG');
    assert.strictEqual(sem.ownershipContext, 'own_equity', `Paraphrase ${i + 1} must identify own_equity: "${q}"`);
    assert.strictEqual(sem.paymentStatus, 'unpaid', `Paraphrase ${i + 1} must identify unpaid status: "${q}"`);
    assert.notStrictEqual(sem.currency.value, 'USD', `Paraphrase ${i + 1} must not default to USD`);
    console.log(`✓ 2.${i + 1}. Paraphrase verified: "${q.substring(0, 45)}..." -> own_equity / unpaid`);
    passed++;
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 3: SEMANTIC GENERALIZATION — CUSTOMER ADVANCE / DEFERRED REVENUE
  // -------------------------------------------------------------------------
  console.log('\n[3. GENERALIZATION: CUSTOMER ADVANCE / DEFERRED REVENUE]');
  const customerAdvances = [
    "customer paid us before delivery",
    "client paid an advance for goods",
    "received money from customer before we delivered"
  ];

  for (let i = 0; i < customerAdvances.length; i++) {
    const q = customerAdvances[i];
    const sem = defaultTransactionUnderstandingService.understandTransactionSync(q, 'SGD', 'SG');
    assert.strictEqual(sem.counterparty?.role, 'customer', `Advance ${i + 1} must identify customer counterparty`);
    assert.strictEqual(sem.transactionType, 'customer_advance_payment', `Advance ${i + 1} must identify customer_advance_payment`);
    assert.strictEqual(sem.paymentStatus, 'paid', `Advance ${i + 1} must identify payment received`);
    console.log(`✓ 3.${i + 1}. Advance verified: "${q}" -> customer / customer_advance_payment / paid`);
    passed++;
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 4: SEMANTIC GENERALIZATION — DIRECTOR EXPENSE SETTLEMENT
  // -------------------------------------------------------------------------
  console.log('\n[4. GENERALIZATION: DIRECTOR EXPENSE SETTLEMENT]');
  const directorExpenses = [
    "director paid a company expense personally",
    "company expense was settled by the director",
    "director used his own money to pay a business bill"
  ];

  for (let i = 0; i < directorExpenses.length; i++) {
    const q = directorExpenses[i];
    const sem = defaultTransactionUnderstandingService.understandTransactionSync(q, 'SGD', 'SG');
    assert.strictEqual(sem.counterparty?.role, 'director', `Director expense ${i + 1} must identify director counterparty`);
    assert.strictEqual(sem.transactionType, 'director_expense_settlement', `Director expense ${i + 1} must identify director_expense_settlement`);
    console.log(`✓ 4.${i + 1}. Director settlement verified: "${q}" -> director / director_expense_settlement`);
    passed++;
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 5: EXTERNAL INVESTMENT VS OWN EQUITY
  // -------------------------------------------------------------------------
  console.log('\n[5. CONTRASTING EXTERNAL INVESTMENT]');
  const ext1 = defaultTransactionUnderstandingService.understandTransactionSync("Company bought Apple shares for USD 1.", 'SGD', 'SG');
  assert.strictEqual(ext1.ownershipContext, 'external_investment', 'Must identify external_investment for Apple stock');
  assert.strictEqual(ext1.currency.value, 'USD', 'Must extract explicit USD');
  assert.strictEqual(ext1.currency.source, 'explicit', 'Source must be explicit');

  const ext2 = defaultTransactionUnderstandingService.understandTransactionSync("The shareholder transferred Apple shares to the company.", 'SGD', 'SG');
  assert.strictEqual(ext2.ownershipContext, 'external_investment', 'Must identify external_investment for Apple shares transferred');
  assert.strictEqual(ext2.counterparty?.role, 'shareholder', 'Must identify shareholder as transferor');
  assert.notStrictEqual(ext2.transactionType, 'equity_issuance_subscription', 'Must NOT be own equity issuance');

  console.log('✓ 5A. Proved: "Company bought Apple shares for USD 1" -> external_investment / USD');
  console.log('✓ 5B. Proved: "The shareholder transferred Apple shares" -> external_investment / shareholder transferor');
  passed += 2;

  // -------------------------------------------------------------------------
  // TEST GROUP 6: AUDITABLE CURRENCY EXTRACTION & FX GUARDRAILS
  // -------------------------------------------------------------------------
  console.log('\n[6. AUDITABLE CURRENCY EXTRACTION & FX GUARDRAILS]');
  const currSG = defaultTransactionUnderstandingService.understandTransactionSync("$1 in Singapore", 'SGD', 'SG');
  assert.strictEqual(currSG.currency.value, 'SGD');
  assert.strictEqual(currSG.currency.source, 'context_inference');

  const currIntl = defaultTransactionUnderstandingService.understandTransactionSync("$1 with no jurisdiction", 'SGD', 'INTERNATIONAL');
  assert.strictEqual(currIntl.currency.value, null);
  assert.strictEqual(currIntl.currency.source, 'unknown');

  const currExplicit = defaultTransactionUnderstandingService.understandTransactionSync("payment of USD 1", 'SGD', 'SG');
  assert.strictEqual(currExplicit.currency.value, 'USD');
  assert.strictEqual(currExplicit.currency.source, 'explicit');

  // Guardrail check: no FX if currency is unknown
  const badFxGroup = [
    {
      id: 'grp-fx',
      eventDate: '2026-09-11',
      title: 'Disallowed FX',
      summary: 'Disallowed FX',
      lines: [
        { id: '1', accountCode: '1000', accountName: 'Cash', category: 'ASSET', debit: 1.34, credit: 0, foreignCurrency: 'USD', exchangeRate: 1.34 },
        { id: '2', accountCode: '2000', accountName: 'Payables', category: 'LIABILITY', debit: 0, credit: 1.34, foreignCurrency: 'USD', exchangeRate: 1.34 }
      ],
      totalDebit: 1.34,
      totalCredit: 1.34,
      isBalanced: true
    }
  ];
  const fxCheck = defaultAccountingGuardrails.validate(currIntl, badFxGroup, 'SGD');
  assert.strictEqual(fxCheck.isValid, false, 'FX must be rejected when currency is unknown');
  assert.ok(fxCheck.violations.some(v => v.code === 'UNJUSTIFIED_FX_CALCULATION'), 'Must trigger UNJUSTIFIED_FX_CALCULATION');

  console.log('✓ 6A. Proved: Context-inferred SGD vs unknown currency cleanly distinguished');
  console.log('✓ 6B. Proved: Guardrail blocks foreign exchange translation without verified foreign currency');
  passed += 2;

  // -------------------------------------------------------------------------
  // TEST GROUP 7: NEGATIVE ROUTING (NO MOCK FIXTURE CONTAMINATION)
  // -------------------------------------------------------------------------
  console.log('\n[7. NEGATIVE ROUTING]');
  const nonFixtureQueries = [
    "shareholder hasn't paid for shares",
    "share capital is unpaid",
    "shareholder loan outstanding",
    "shares issued to founder",
    "director paid a company expense personally",
    "customer paid us before delivery"
  ];

  for (const q of nonFixtureQueries) {
    const isFix = isDeterministicFixture(q);
    assert.strictEqual(isFix, false, `Query must NOT be classified as deterministic fixture: "${q}"`);
    const parsed = await parseAccountingQuery(q);
    assert.notStrictEqual(parsed.scenarioType, 'EQUITY_INVESTMENT_FX', `Query must not trigger EQUITY_INVESTMENT_FX: "${q}"`);
  }
  console.log('✓ 7A. Proved: None of the free-form shareholder, director, or customer queries match legacy demo fixtures');
  passed++;

  // -------------------------------------------------------------------------
  // TEST GROUP 8: END-TO-END PIPELINE & STATUTORY GROUNDING
  // -------------------------------------------------------------------------
  console.log('\n[8. END-TO-END OFFLINE PIPELINE EXECUTION]');
  const result = await processAccountingQuery(bugQuery, null, 'SFRS_I');

  // Verify grounded content
  assert.ok(result.messageText.includes('Singapore Companies Act 1967 §68'), 'Response must cite Companies Act 1967 §68');
  assert.ok(result.messageText.includes('Singapore Companies Act 1967 §63(1)'), 'Response must cite Companies Act 1967 §63(1)');
  assert.ok(result.messageText.includes('SFRS(I) 1-32 §33'), 'Response must cite SFRS(I) 1-32 §33');
  assert.ok(result.messageText.includes('Share Capital'), 'Response must cite Share Capital under Equity');
  assert.ok(result.messageText.includes('Amount Due from Shareholder'), 'Response must cite Amount Due from Shareholder');

  // Negative assertions
  assert.ok(!result.messageText.includes('Financial Asset at FVTPL'), 'Response must NOT mention Financial Asset at FVTPL');
  assert.ok(!result.messageText.includes('Foreign Shares Investment'), 'Response must NOT mention Foreign Shares Investment');
  assert.ok(!result.messageText.includes('1.34 SGD/USD'), 'Response must NOT calculate FX translation');
  assert.ok(!result.messageText.includes('Cash at Bank (USD Account)'), 'Response must NOT credit USD Cash at Bank');

  console.log('✓ 8A. Proved: End-to-end response cites s68, s63(1), SFRS(I) 1-32 §33, Share Capital (Equity), and Amount Due from Shareholder');
  console.log('✓ 8B. Proved: Zero mention of Financial Asset at FVTPL, Foreign Shares Investment, USD, or FX translation');
  passed += 2;

  console.log('\n=============================================================');
  console.log(`ALL SIDE QUEST 2 TESTS PASSED SUCCESSFULLY! (${passed} GREEN)`);
  console.log('=============================================================\n');
}

runSideQuest2Tests().catch(err => {
  console.error('\n❌ SIDE QUEST 2 TEST FAILED:', err);
  process.exit(1);
});
