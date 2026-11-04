import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { processAccountingQuery } from '../../src/services/geminiService.ts';

function resolveGeminiApiKey() {
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 5) {
    return process.env.GEMINI_API_KEY.trim();
  }
  if (process.env.VITE_GEMINI_API_KEY && process.env.VITE_GEMINI_API_KEY.trim().length > 5) {
    return process.env.VITE_GEMINI_API_KEY.trim();
  }
  const candidates = [
    path.resolve(process.cwd(), '.env.local'),
    'D:/Accounting/.env.local'
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const text = fs.readFileSync(p, 'utf8');
        const line = text.split(/\r?\n/).find(row => /^\s*(?:VITE_)?GEMINI_API_KEY\s*=/.test(row));
        if (line) {
          const val = line.replace(/^\s*(?:VITE_)?GEMINI_API_KEY\s*=\s*/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
          if (val && val.length > 5) return val;
        }
      } catch {
        // Ignore file read errors
      }
    }
  }
  return null;
}

const geminiApiKey = resolveGeminiApiKey();

if (!geminiApiKey) {
  console.log('SKIP | GEMINI_API_KEY not configured — skipping live real-model acceptance suite');
  process.exit(0);
}

console.log('================================================================');
console.log('  LIVE REAL-MODEL ACCEPTANCE SUITE (gemini-3.5-flash-lite)      ');
console.log('================================================================\n');

let passed = 0;

function assertGroupIntegrity(grp, expectedTitleSnippet) {
  assert.ok(grp, 'Journal group must be present');
  assert.ok(Array.isArray(grp.lines) && grp.lines.length >= 2, 'Group must have at least 2 lines');
  assert.ok(typeof grp.totalDebit === 'number' && grp.totalDebit > 0, 'totalDebit must be positive');
  assert.ok(typeof grp.totalCredit === 'number' && grp.totalCredit > 0, 'totalCredit must be positive');
  assert.equal(grp.totalDebit, grp.totalCredit, `Group must be balanced: Dr ${grp.totalDebit} !== Cr ${grp.totalCredit}`);
  assert.ok(grp.isBalanced, 'Group isBalanced flag must be true');
  if (expectedTitleSnippet) {
    const title = (grp.title || '') + ' ' + (grp.summary || '');
    assert.match(title, new RegExp(expectedTitleSnippet, 'i'));
  }
  for (const line of grp.lines) {
    assert.ok(line.accountName && line.accountName.trim().length > 0, 'Line must have accountName');
    assert.ok(line.category, 'Line must have category');
    assert.ok((line.debit || 0) >= 0 && (line.credit || 0) >= 0, 'Line amounts must be non-negative');
    assert.ok((line.debit || 0) > 0 || (line.credit || 0) > 0, 'Line must have non-zero debit or credit');
    assert.ok(!((line.debit || 0) > 0 && (line.credit || 0) > 0), 'Line cannot be two-sided');
  }
}

async function runLiveAcceptanceSuite() {
  // Case 1: Finding A — Nominal Settlement Phrase Refusal
  console.log('--- 1. Finding A: Bare Nominal Settlement Phrase Refusal ---');
  {
    const res = await processAccountingQuery(
      'Settlement of salaries payable S$4,000 and CPF payable S$1,850 by bank transfer.',
      null,
      'SFRS_I',
      geminiApiKey
    );
    assert.equal(res.scenarioState.directGroups?.length || 0, 0, 'Bare nominal settlement must not post unconfirmed journals');
    assert.ok(!res.messageText.includes('AI Provider Unavailable'), 'Refusal must come from AI/accounting validation, not a provider timeout/error');
    console.log('✓ 1. Finding A nominal settlement phrase refused unconfirmed journal generation');
    passed++;
  }

  // Case 2: Finding B — Multi-Event Separation & Unstated Amount Refusal
  console.log('\n--- 2. Finding B: Multi-Event Unstated Rent Refusal ---');
  {
    const res = await processAccountingQuery(
      'Salaries payable S$4,000 and CPF payable S$1,850 were paid by bank; rent was paid by bank transfer.',
      null,
      'SFRS_I',
      geminiApiKey
    );
    assert.equal(res.scenarioState.directGroups?.length || 0, 0, 'Unstated rent must not produce invented journals');
    assert.ok(!res.messageText.includes('AI Provider Unavailable'), 'Refusal must come from AI/accounting validation, not a provider timeout/error');
    console.log('✓ 2. Finding B multi-event unstated rent refused without invented amounts');
    passed++;
  }

  // Case 3: Finding C — Exact Decimals & Scheduled Future Item
  console.log('\n--- 3. Finding C: Exact Decimals & Future Leg Schedule ---');
  {
    const res = await processAccountingQuery(
      'Salaries payable S$4,000.50 paid by bank, CPF payable S$1,850.25 will be paid by bank next week.',
      null,
      'SFRS_I',
      geminiApiKey
    );
    assert.equal(res.scenarioState.directGroups?.length, 1, 'Only confirmed leg posted today');
    const grp = res.scenarioState.directGroups[0];
    assertGroupIntegrity(grp);
    assert.equal(grp.totalDebit, 4000.50, 'Total debit must match exact decimal 4000.50');
    assert.equal(grp.totalCredit, 4000.50, 'Total credit must match exact decimal 4000.50');
    console.log('✓ 3. Finding C exact decimals and future scheduled item handled cleanly');
    passed++;
  }

  // Case 4: Finding D — Multi-Turn Partial Settlement Follow-Up
  console.log('\n--- 4. Finding D: Multi-Turn Partial Settlement Follow-Up ---');
  {
    const turn1 = await processAccountingQuery(
      'We acquired machinery on credit from TechMach Ltd for S$15,000 on 10/01/2025.',
      null,
      'SFRS_I',
      geminiApiKey
    );
    assert.ok(turn1.scenarioState.directGroups?.length >= 1, 'Turn 1 must produce initial recognition journal');

    const turn2 = await processAccountingQuery(
      'On 25/01/2025, we paid TechMach Ltd S$9,000 by bank transfer as partial settlement.',
      turn1.scenarioState,
      'SFRS_I',
      geminiApiKey
    );
    assert.ok(turn2.scenarioState.directGroups?.length >= 1, 'Turn 2 must record partial settlement');
    const settlGroup = turn2.scenarioState.directGroups.find(g =>
      g.lines?.some(l => l.credit === 9000 && /bank|cash/i.test(l.accountName))
    ) || turn2.scenarioState.directGroups[turn2.scenarioState.directGroups.length - 1];
    assertGroupIntegrity(settlGroup);
    assert.equal(settlGroup.totalDebit, 9000);
    assert.equal(settlGroup.totalCredit, 9000);
    console.log('✓ 4. Finding D multi-turn context propagation and partial settlement verified');
    passed++;
  }

  // Case 5: Novel Scenario 1 — Hire Purchase Acquisition
  console.log('\n--- 5. Novel Scenario 1: Hire Purchase Acquisition ---');
  {
    const res = await processAccountingQuery(
      'Acquired a delivery van for S$50,000 on hire purchase, paying S$10,000 deposit from bank account with S$40,000 balance under hire purchase agreement.',
      null,
      'SFRS_I',
      geminiApiKey
    );
    assert.equal(res.scenarioState.directGroups?.length, 1, `Case 5 expected 1 group; messageText: ${res.messageText.slice(0, 300)}`);
    const grp = res.scenarioState.directGroups[0];
    assertGroupIntegrity(grp);
    assert.equal(grp.totalDebit, 50000);
    assert.equal(grp.totalCredit, 50000);
    const hpLiab = grp.lines.find(l => /hire purchase|hp liability|lease liability|borrowing/i.test(l.accountName));
    assert.ok(hpLiab, 'Must have hire purchase liability line');
    assert.equal(hpLiab.category, 'LIABILITY', 'Hire purchase liability must be LIABILITY');
    console.log('✓ 5. Novel hire purchase compound acquisition verified');
    passed++;
  }

  // Case 6: Novel Scenario 2 — SFRS(I) 16 Lease Initial Recognition
  console.log('\n--- 6. Novel Scenario 2: SFRS(I) 16 Lease Initial Recognition ---');
  {
    const res = await processAccountingQuery(
      'Entered into a 3-year office lease commencing 01/01/2025 with annual payments of S$30,000 at year-end. Present value of lease payments is S$81,697 at incremental borrowing rate of 5%. Record initial recognition.',
      null,
      'SFRS_I',
      geminiApiKey
    );
    assert.equal(res.scenarioState.directGroups?.length, 1, `Case 6 expected 1 group; messageText: ${res.messageText.slice(0, 300)}`);
    const grp = res.scenarioState.directGroups[0];
    assertGroupIntegrity(grp);
    assert.equal(grp.totalDebit, 81697);
    assert.equal(grp.totalCredit, 81697);
    const rouLine = grp.lines.find(l => /right-of-use|rou/i.test(l.accountName));
    assert.ok(rouLine, 'Must debit Right-of-Use Asset');
    assert.equal(rouLine.category, 'ASSET');
    const liabLine = grp.lines.find(l => /lease liability/i.test(l.accountName));
    assert.ok(liabLine, 'Must credit Lease Liability');
    assert.equal(liabLine.category, 'LIABILITY');
    console.log('✓ 6. SFRS(I) 16 Right-of-Use and Lease Liability recognition verified');
    passed++;
  }

  // Case 7: Novel Scenario 3 — Intercompany Recharge
  console.log('\n--- 7. Novel Scenario 3: Intercompany Recharge ---');
  {
    const res = await processAccountingQuery(
      'Parent company paid S$12,000 audit fee on behalf of subsidiary via bank transfer. Record the intercompany recharge in parent\'s books.',
      null,
      'SFRS_I',
      geminiApiKey
    );
    assert.equal(res.scenarioState.directGroups?.length, 1, `Case 7 expected 1 group; messageText: ${res.messageText.slice(0, 300)}`);
    const grp = res.scenarioState.directGroups[0];
    assertGroupIntegrity(grp);
    assert.equal(grp.totalDebit, 12000);
    assert.equal(grp.totalCredit, 12000);
    const dueFromLine = grp.lines.find(l => /due from|intercompany|subsidiary/i.test(l.accountName));
    assert.ok(dueFromLine, 'Must debit Due from Subsidiary / Intercompany Receivable');
    assert.equal(dueFromLine.category, 'ASSET');
    console.log('✓ 7. Intercompany recharge asset debit verified');
    passed++;
  }

  // Case 8: Novel Scenario 4 — SFRS(I) 1-12 Deferred Tax Provision
  console.log('\n--- 8. Novel Scenario 4: SFRS(I) 1-12 Deferred Tax Provision ---');
  {
    const res = await processAccountingQuery(
      'Provide for deferred tax liability of S$5,100 on accelerated depreciation temporary difference of S$30,000 at 17% under SFRS(I) 1-12.',
      null,
      'SFRS_I',
      geminiApiKey
    );
    assert.equal(res.scenarioState.directGroups?.length, 1, `Case 8 expected 1 group; messageText: ${res.messageText.slice(0, 300)}`);
    const grp = res.scenarioState.directGroups[0];
    assertGroupIntegrity(grp);
    assert.equal(grp.totalDebit, 5100);
    assert.equal(grp.totalCredit, 5100);
    const dtExpLine = grp.lines.find(l => /deferred tax expense|income tax expense/i.test(l.accountName) && l.debit === 5100);
    assert.ok(dtExpLine, 'Must debit Deferred Tax Expense / Income Tax Expense');
    assert.equal(dtExpLine.category, 'EXPENSE');
    const dtlLine = grp.lines.find(l => /deferred tax liabilit/i.test(l.accountName) && l.credit === 5100);
    assert.ok(dtlLine, 'Must credit Deferred Tax Liability');
    assert.equal(dtlLine.category, 'LIABILITY', 'Deferred tax liability must be categorized as LIABILITY');
    console.log('✓ 8. SFRS(I) 1-12 deferred tax provision & category override verified');
    passed++;
  }

  // Case 9: Novel Scenario 5 — Multi-Line PPE Disposal with Gain (CAT-11)
  console.log('\n--- 9. Novel Scenario 5: Multi-Line PPE Disposal with Gain (CAT-11) ---');
  {
    const res = await processAccountingQuery(
      'Sold equipment for S$22,000 cash at bank. Original cost was S$80,000, and accumulated depreciation up to the date of disposal was S$62,000. Prepare the disposal journal entry.',
      null,
      'SFRS_I',
      geminiApiKey
    );
    assert.equal(res.scenarioState.directGroups?.length, 1, `Case 9 expected 1 group; messageText: ${res.messageText.slice(0, 300)}`);
    const grp = res.scenarioState.directGroups[0];
    assertGroupIntegrity(grp);
    assert.equal(grp.lines.length, 4, 'Must have 4 lines: Cash, Acc Depn, Cost, Gain');
    assert.equal(grp.totalDebit, 84000);
    assert.equal(grp.totalCredit, 84000);
    const cashLine = grp.lines.find(l => /cash|bank/i.test(l.accountName) && l.debit === 22000);
    assert.ok(cashLine, 'Must have Cash at Bank debit line of S$22,000');
    assert.equal(cashLine.category, 'ASSET');
    const depLine = grp.lines.find(l => /accumulated depreciation/i.test(l.accountName) && l.debit === 62000);
    assert.ok(depLine, 'Must have Accumulated Depreciation debit line of S$62,000');
    assert.equal(depLine.category, 'ASSET');
    const equipLine = grp.lines.find(l => /equipment|machinery|ppe/i.test(l.accountName) && !/depreciation/i.test(l.accountName) && l.credit === 80000);
    assert.ok(equipLine, 'Must have Equipment cost credit line of S$80,000');
    assert.equal(equipLine.category, 'ASSET');
    const gainLine = grp.lines.find(l => /gain/i.test(l.accountName) && l.credit === 4000);
    assert.ok(gainLine, 'Must have Gain on Disposal line');
    assert.equal(gainLine.credit, 4000, 'Gain on disposal must be exactly S$4,000');
    assert.equal(gainLine.category, 'REVENUE', 'Gain on disposal must be REVENUE');
    console.log('✓ 9. Multi-line PPE disposal with gain (CAT-11) verified');
    passed++;
  }

  // Case 10: Missing Fact Refusal (No Silent Fabrication)
  console.log('\n--- 10. Missing Fact Refusal: No Silent Fabrication ---');
  {
    const res = await processAccountingQuery(
      'We purchased machinery from a supplier on credit.',
      null,
      'SFRS_I',
      geminiApiKey
    );
    assert.equal(res.scenarioState.directGroups?.length || 0, 0, 'Query without transaction amount must not fabricate journals');
    assert.ok(!res.messageText.includes('AI Provider Unavailable'), 'Refusal must come from AI/accounting validation, not a provider timeout/error');
    console.log('✓ 10. Unstated transaction amount cleanly refused without silent fabrication');
    passed++;
  }

  // Case 11: Statutory Advisory Boundary (EA Part IV)
  console.log('\n--- 11. Statutory Advisory Boundary: Employment Act Part IV ---');
  {
    const res = await processAccountingQuery(
      'What are the statutory annual leave and outpatient sick leave entitlements under Part IV of the Singapore Employment Act?',
      null,
      'SFRS_I',
      geminiApiKey
    );
    assert.equal(res.scenarioState.directGroups?.length || 0, 0, 'Statutory advisory query must never return direct journal groups');
    assert.ok(!res.messageText.includes('AI Provider Unavailable'), 'Response must come from model/retrieval, not a provider error');
    assert.match(res.messageText, /Employment Act/i);
    assert.match(res.messageText, /annual leave/i);
    console.log('✓ 11. Statutory advisory query returns directGroups.length === 0 cleanly');
    passed++;
  }

  console.log('\n================================================================');
  console.log(`ALL LIVE REAL-MODEL ACCEPTANCE TESTS PASSED! (${passed}/${passed} GREEN)`);
  console.log('================================================================');
}

runLiveAcceptanceSuite().catch(err => {
  console.error('\n❌ Live acceptance test failed:', err);
  process.exit(1);
});
