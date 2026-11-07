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
    'D:/Accounting/.env.local',
    path.resolve(process.cwd(), '../.env.local'),
    path.resolve(process.cwd(), '../../.env.local')
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
  if (process.env.ALLOW_SKIP_LIVE_GEMINI === '1') {
    console.log('SKIP | GEMINI_API_KEY not configured — skipping live real-model acceptance suite');
    process.exit(0);
  }
  console.error('ERROR | GEMINI_API_KEY is not configured. Live acceptance tests require an active Gemini API key.');
  process.exit(1);
}

console.log('================================================================');
console.log('  LIVE REAL-MODEL ACCEPTANCE SUITE (gemini-3.5-flash-lite)      ');
console.log('================================================================\n');

let passed = 0;
const caseResults = [];

function recordCaseResult(caseId, name, query, latencyMs, scenarioState) {
  caseResults.push({
    caseId,
    name,
    query,
    latencyMs,
    isComplete: Boolean(scenarioState?.isComplete),
    directGroupsCount: scenarioState?.directGroups?.length || 0,
    groupIds: (scenarioState?.directGroups || []).map(g => g.id),
    groupsSummary: (scenarioState?.directGroups || []).map(g => ({
      id: g.id,
      title: g.title,
      totalDebit: g.totalDebit,
      totalCredit: g.totalCredit,
      lines: (g.lines || []).map(l => ({
        accountName: l.accountName,
        category: l.category,
        debit: l.debit,
        credit: l.credit
      }))
    }))
  });
}

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

async function queryWithRetry(query, scenarioState, standard, apiKey, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await processAccountingQuery(query, scenarioState, standard, apiKey);
      if (res.messageText.includes('AI Provider Unavailable') && attempt < retries) {
        console.log(`[Transient provider error on attempt ${attempt + 1}, retrying after 1.5s...]`);
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt < retries) {
        console.log(`[Network error ${err.message} on attempt ${attempt + 1}, retrying after 1.5s...]`);
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      throw err;
    }
  }
}

async function runLiveAcceptanceSuite() {
  // Case 1: Finding A — Nominal Settlement Phrase Refusal
  console.log('--- 1. Finding A: Bare Nominal Settlement Phrase Refusal ---');
  {
    const query = 'Settlement of salaries payable S$4,000 and CPF payable S$1,850 by bank transfer.';
    const t0 = Date.now();
    const res = await queryWithRetry(query, null, 'SFRS_I', geminiApiKey);
    const latencyMs = Date.now() - t0;
    assert.equal(res.scenarioState.directGroups?.length || 0, 0, 'Bare nominal settlement must not post unconfirmed journals');
    assert.ok(!res.messageText.includes('AI Provider Unavailable'), 'Refusal must come from AI/accounting validation, not a provider timeout/error');
    recordCaseResult('case-1', 'Finding A: Bare Nominal Settlement Phrase Refusal', query, latencyMs, res.scenarioState);
    console.log(`✓ 1. Finding A nominal settlement phrase refused unconfirmed journal generation (${latencyMs}ms)`);
    passed++;
  }

  // Case 2: Finding B — Multi-Event Separation & Unstated Rent Refusal
  console.log('\n--- 2. Finding B: Multi-Event Unstated Rent Refusal ---');
  {
    const query = 'Salaries payable S$4,000 and CPF payable S$1,850 were paid by bank; rent was paid by bank transfer.';
    const t0 = Date.now();
    const res = await queryWithRetry(query, null, 'SFRS_I', geminiApiKey);
    const latencyMs = Date.now() - t0;
    assert.equal(res.scenarioState.directGroups?.length || 0, 0, 'Unstated rent must not produce invented journals');
    assert.ok(!res.messageText.includes('AI Provider Unavailable'), 'Refusal must come from AI/accounting validation, not a provider timeout/error');
    recordCaseResult('case-2', 'Finding B: Multi-Event Unstated Rent Refusal', query, latencyMs, res.scenarioState);
    console.log(`✓ 2. Finding B multi-event unstated rent refused without invented amounts (${latencyMs}ms)`);
    passed++;
  }

  // Case 3: Finding C — Exact Decimals & Scheduled Future Item
  console.log('\n--- 3. Finding C: Exact Decimals & Future Leg Schedule ---');
  {
    const query = 'Salaries payable S$4,000.50 paid by bank, CPF payable S$1,850.25 will be paid by bank next week.';
    const t0 = Date.now();
    const res = await queryWithRetry(query, null, 'SFRS_I', geminiApiKey);
    const latencyMs = Date.now() - t0;
    assert.equal(res.scenarioState.directGroups?.length, 1, 'Only confirmed leg posted today');
    const grp = res.scenarioState.directGroups[0];
    assertGroupIntegrity(grp);
    assert.equal(grp.lines.length, 2, 'Case 3 must have exactly 2 lines');
    assert.equal(grp.totalDebit, 4000.50, 'Total debit must match exact decimal 4000.50');
    assert.equal(grp.totalCredit, 4000.50, 'Total credit must match exact decimal 4000.50');
    const salLine = grp.lines.find(l => /salaries payable/i.test(l.accountName) && l.debit === 4000.50);
    assert.ok(salLine, 'Must debit Salaries Payable S$4,000.50');
    assert.equal(salLine.category, 'LIABILITY', 'Salaries Payable must be LIABILITY');
    const bankLine = grp.lines.find(l => /bank|cash/i.test(l.accountName) && l.credit === 4000.50);
    assert.ok(bankLine, 'Must credit Bank S$4,000.50');
    assert.equal(bankLine.category, 'ASSET', 'Bank must be ASSET');
    assert.equal(res.scenarioState.isComplete, true, 'Case 3 isComplete must be true');
    recordCaseResult('case-3', 'Finding C: Exact Decimals & Future Leg Schedule', query, latencyMs, res.scenarioState);
    console.log(`✓ 3. Finding C exact decimals and future scheduled item handled cleanly (${latencyMs}ms)`);
    passed++;
  }

  // Case 4A: Finding D — Original Mixed Salary & CPF Accrual followed by Partial Bank Settlement & Future CPF Leg
  console.log('\n--- 4A. Finding D: Original Mixed Accrual Followed by Partial Settlement & Future Leg ---');
  {
    const turn1Query = 'We accrued monthly staff salaries of S$4,000 and employer CPF contributions of S$1,850 for January 2025, both unpaid at month-end.';
    const t0 = Date.now();
    const turn1 = await queryWithRetry(turn1Query, null, 'SFRS_I', geminiApiKey);
    const t1Ms = Date.now() - t0;

    assert.ok(turn1.scenarioState.directGroups?.length >= 1, 'Turn 1 must produce initial recognition journal');
    const accrualGrp = turn1.scenarioState.directGroups[0];
    assertGroupIntegrity(accrualGrp);
    assert.equal(accrualGrp.totalDebit, 5850, 'Accrual total debit must be 5850');
    assert.equal(accrualGrp.totalCredit, 5850, 'Accrual total credit must be 5850');
    assert.equal(turn1.scenarioState.isComplete, true, 'Turn 1 isComplete must be true');

    const salPayLine = accrualGrp.lines.find(l => /salaries payable/i.test(l.accountName) && l.credit === 4000);
    assert.ok(salPayLine, 'Must credit Salaries Payable S$4,000');
    assert.equal(salPayLine.category, 'LIABILITY');
    const cpfPayLine = accrualGrp.lines.find(l => /cpf payable/i.test(l.accountName) && l.credit === 1850);
    assert.ok(cpfPayLine, 'Must credit CPF Payable S$1,850');
    assert.equal(cpfPayLine.category, 'LIABILITY');

    const turn2Query = 'Salaries payable of S$4,000 were paid by bank transfer today, while CPF payable of S$1,850 will be paid by bank next week.';
    const t2Start = Date.now();
    const turn2 = await queryWithRetry(turn2Query, turn1.scenarioState, 'SFRS_I', geminiApiKey);
    const t2Ms = Date.now() - t2Start;

    assert.equal(turn2.scenarioState.directGroups?.length, 2, 'Turn 2 must preserve Turn 1 accrual and append confirmed settlement');
    assert.equal(turn2.scenarioState.committedDirectGroups?.length, 2, 'Turn 2 committedDirectGroups must contain 2 groups');
    assert.notEqual(turn2.scenarioState.directGroups[0].id, turn2.scenarioState.directGroups[1].id, 'Group IDs must be distinct across turns');

    // Group 1 preserves Turn 1 accrual
    const g1 = turn2.scenarioState.directGroups[0];
    assertGroupIntegrity(g1);
    assert.equal(g1.totalDebit, 5850);
    assert.equal(g1.totalCredit, 5850);

    // Group 2 records confirmed salaries settlement
    const g2 = turn2.scenarioState.directGroups[1];
    assertGroupIntegrity(g2);
    assert.equal(g2.totalDebit, 4000, 'Settlement group debit must be 4000');
    assert.equal(g2.totalCredit, 4000, 'Settlement group credit must be 4000');
    const salDr = g2.lines.find(l => /salaries payable/i.test(l.accountName) && l.debit === 4000);
    assert.ok(salDr, 'Must debit Salaries Payable S$4,000');
    assert.equal(salDr.category, 'LIABILITY');
    const bankCr = g2.lines.find(l => /bank|cash/i.test(l.accountName) && l.credit === 4000);
    assert.ok(bankCr, 'Must credit Bank S$4,000');
    assert.equal(bankCr.category, 'ASSET');
    const cpfLine = g2.lines.find(l => /cpf/i.test(l.accountName));
    assert.ok(!cpfLine, 'Must NOT debit CPF Payable in today settlement');

    recordCaseResult('case-4a', 'Finding D: Mixed Accrual Followed by Partial Settlement & Future Leg', `${turn1Query} -> ${turn2Query}`, t1Ms + t2Ms, turn2.scenarioState);
    console.log(`✓ 4A. Finding D mixed accrual followed by partial settlement & future leg verified (${t1Ms + t2Ms}ms)`);
    passed++;
  }

  // Case 4B: Finding D — Machinery Credit Purchase followed by S$9,000 Partial Settlement with Preserved State
  console.log('\n--- 4B. Finding D: Machinery Acquisition followed by Partial Settlement ---');
  {
    const turn1Query = 'We acquired machinery on credit from TechMach Ltd for S$15,000 on 10/01/2025.';
    const t0 = Date.now();
    const turn1 = await queryWithRetry(turn1Query, null, 'SFRS_I', geminiApiKey);
    const t1Ms = Date.now() - t0;
    assert.ok(turn1.scenarioState.directGroups?.length >= 1, 'Turn 1 must produce initial recognition journal');

    const turn2Query = 'On 25/01/2025, we paid TechMach Ltd S$9,000 by bank transfer as partial settlement.';
    const t2Start = Date.now();
    const turn2 = await queryWithRetry(turn2Query, turn1.scenarioState, 'SFRS_I', geminiApiKey);
    const t2Ms = Date.now() - t2Start;

    assert.equal(turn2.scenarioState.directGroups?.length, 2, 'Turn 2 must preserve Turn 1 and append partial settlement');
    assert.equal(turn2.scenarioState.committedDirectGroups?.length, 2, 'Turn 2 committedDirectGroups must contain 2 groups');

    const grp1 = turn2.scenarioState.directGroups[0];
    assertGroupIntegrity(grp1);
    assert.equal(grp1.totalDebit, 15000);
    assert.equal(grp1.totalCredit, 15000);
    const machLine = grp1.lines.find(l => /machinery|equipment/i.test(l.accountName) && l.debit === 15000);
    assert.ok(machLine, 'Group 1 must debit Machinery S$15,000');
    assert.equal(machLine.category, 'ASSET');
    const payLine1 = grp1.lines.find(l => /payable|techmach/i.test(l.accountName) && l.credit === 15000);
    assert.ok(payLine1, 'Group 1 must credit Trade or Other Payables S$15,000');
    assert.equal(payLine1.category, 'LIABILITY');

    const grp2 = turn2.scenarioState.directGroups[1];
    assertGroupIntegrity(grp2);
    assert.equal(grp2.totalDebit, 9000);
    assert.equal(grp2.totalCredit, 9000);
    const payLine2 = grp2.lines.find(l => /payable|techmach/i.test(l.accountName) && l.debit === 9000);
    assert.ok(payLine2, 'Group 2 must debit Payables S$9,000');
    assert.equal(payLine2.category, 'LIABILITY');
    const bankLine2 = grp2.lines.find(l => /bank|cash/i.test(l.accountName) && l.credit === 9000);
    assert.ok(bankLine2, 'Group 2 must credit Bank S$9,000');
    assert.equal(bankLine2.category, 'ASSET');

    recordCaseResult('case-4b', 'Finding D: Machinery Acquisition followed by Partial Settlement', `${turn1Query} -> ${turn2Query}`, t1Ms + t2Ms, turn2.scenarioState);
    console.log(`✓ 4B. Finding D machinery credit acquisition + partial settlement verified (${t1Ms + t2Ms}ms)`);
    passed++;
  }

  // Case 5: Novel Scenario 1 — Hire Purchase Acquisition
  console.log('\n--- 5. Novel Scenario 1: Hire Purchase Acquisition ---');
  {
    const query = 'Acquired a delivery van for S$50,000 on hire purchase, paying S$10,000 deposit from bank account with S$40,000 balance under hire purchase agreement.';
    const t0 = Date.now();
    const res = await queryWithRetry(query, null, 'SFRS_I', geminiApiKey);
    const latencyMs = Date.now() - t0;
    assert.equal(res.scenarioState.directGroups?.length, 1, `Case 5 expected 1 group; messageText: ${res.messageText.slice(0, 300)}`);
    const grp = res.scenarioState.directGroups[0];
    assertGroupIntegrity(grp);
    assert.equal(grp.totalDebit, 50000);
    assert.equal(grp.totalCredit, 50000);
    const hpLiab = grp.lines.find(l => /hire purchase|hp liability|lease liability|borrowing/i.test(l.accountName));
    assert.ok(hpLiab, 'Must have hire purchase liability line');
    assert.equal(hpLiab.category, 'LIABILITY', 'Hire purchase liability must be LIABILITY');
    assert.equal(res.scenarioState.isComplete, true, 'Case 5 must be marked complete');
    recordCaseResult('case-5', 'Novel Scenario 1: Hire Purchase Acquisition', query, latencyMs, res.scenarioState);
    console.log(`✓ 5. Novel hire purchase compound acquisition verified (${latencyMs}ms)`);
    passed++;
  }

  // Case 6: Novel Scenario 2 — SFRS(I) 16 Lease Initial Recognition
  console.log('\n--- 6. Novel Scenario 2: SFRS(I) 16 Lease Initial Recognition ---');
  {
    const query = 'Entered into a 3-year office lease commencing 01/01/2025 with annual payments of S$30,000 at year-end. Present value of lease payments is S$81,697 at incremental borrowing rate of 5%. Record initial recognition.';
    const t0 = Date.now();
    const res = await queryWithRetry(query, null, 'SFRS_I', geminiApiKey);
    const latencyMs = Date.now() - t0;
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
    recordCaseResult('case-6', 'Novel Scenario 2: SFRS(I) 16 Lease Initial Recognition', query, latencyMs, res.scenarioState);
    console.log(`✓ 6. SFRS(I) 16 Right-of-Use and Lease Liability recognition verified (${latencyMs}ms)`);
    passed++;
  }

  // Case 7: Novel Scenario 3 — Intercompany Recharge
  console.log('\n--- 7. Novel Scenario 3: Intercompany Recharge ---');
  {
    const query = 'Parent company paid S$12,000 audit fee on behalf of subsidiary via bank transfer. Record the intercompany recharge in parent\'s books.';
    const t0 = Date.now();
    const res = await queryWithRetry(query, null, 'SFRS_I', geminiApiKey);
    const latencyMs = Date.now() - t0;
    assert.equal(res.scenarioState.directGroups?.length, 1, `Case 7 expected 1 group; messageText: ${res.messageText.slice(0, 300)}`);
    const grp = res.scenarioState.directGroups[0];
    assertGroupIntegrity(grp);
    assert.equal(grp.totalDebit, 12000);
    assert.equal(grp.totalCredit, 12000);
    const dueFromLine = grp.lines.find(l => /due from|intercompany|subsidiary/i.test(l.accountName));
    assert.ok(dueFromLine, 'Must debit Due from Subsidiary / Intercompany Receivable');
    assert.equal(dueFromLine.category, 'ASSET');
    recordCaseResult('case-7', 'Novel Scenario 3: Intercompany Recharge', query, latencyMs, res.scenarioState);
    console.log(`✓ 7. Intercompany recharge asset debit verified (${latencyMs}ms)`);
    passed++;
  }

  // Case 8: Novel Scenario 4 — SFRS(I) 1-12 Deferred Tax Provision
  console.log('\n--- 8. Novel Scenario 4: SFRS(I) 1-12 Deferred Tax Provision ---');
  {
    const query = 'Provide for deferred tax liability of S$5,100 on accelerated depreciation temporary difference of S$30,000 at 17% under SFRS(I) 1-12.';
    const t0 = Date.now();
    const res = await queryWithRetry(query, null, 'SFRS_I', geminiApiKey);
    const latencyMs = Date.now() - t0;
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
    recordCaseResult('case-8', 'Novel Scenario 4: SFRS(I) 1-12 Deferred Tax Provision', query, latencyMs, res.scenarioState);
    console.log(`✓ 8. SFRS(I) 1-12 deferred tax provision & category override verified (${latencyMs}ms)`);
    passed++;
  }

  // Case 9: Novel Scenario 5 — Multi-Line PPE Disposal with Gain (CAT-11)
  console.log('\n--- 9. Novel Scenario 5: Multi-Line PPE Disposal with Gain (CAT-11) ---');
  {
    const query = 'Sold equipment for S$22,000 cash at bank. Original cost was S$80,000, and accumulated depreciation up to the date of disposal was S$62,000. Prepare the disposal journal entry.';
    const t0 = Date.now();
    const res = await queryWithRetry(query, null, 'SFRS_I', geminiApiKey);
    const latencyMs = Date.now() - t0;
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
    recordCaseResult('case-9', 'Novel Scenario 5: Multi-Line PPE Disposal with Gain (CAT-11)', query, latencyMs, res.scenarioState);
    console.log(`✓ 9. Multi-line PPE disposal with gain (CAT-11) verified (${latencyMs}ms)`);
    passed++;
  }

  // Case 10: Missing Fact Refusal (No Silent Fabrication)
  console.log('\n--- 10. Missing Fact Refusal: No Silent Fabrication ---');
  {
    const query = 'We purchased machinery from a supplier on credit.';
    const t0 = Date.now();
    const res = await queryWithRetry(query, null, 'SFRS_I', geminiApiKey);
    const latencyMs = Date.now() - t0;
    assert.equal(res.scenarioState.directGroups?.length || 0, 0, 'Query without transaction amount must not fabricate journals');
    assert.ok(!res.messageText.includes('AI Provider Unavailable'), 'Refusal must come from AI/accounting validation, not a provider timeout/error');
    recordCaseResult('case-10', 'Missing Fact Refusal: No Silent Fabrication', query, latencyMs, res.scenarioState);
    console.log(`✓ 10. Unstated transaction amount cleanly refused without silent fabrication (${latencyMs}ms)`);
    passed++;
  }

  // Case 11: Statutory Advisory Boundary (EA Part IV)
  console.log('\n--- 11. Statutory Advisory Boundary: Employment Act Part IV ---');
  {
    const query = 'What are the statutory annual leave and outpatient sick leave entitlements under Part IV of the Singapore Employment Act?';
    const t0 = Date.now();
    const res = await queryWithRetry(query, null, 'SFRS_I', geminiApiKey);
    const latencyMs = Date.now() - t0;
    assert.equal(res.scenarioState.directGroups?.length || 0, 0, 'Statutory advisory query must never return direct journal groups');
    assert.ok(!res.messageText.includes('AI Provider Unavailable'), 'Response must come from model/retrieval, not a provider error');
    assert.match(res.messageText, /Employment Act/i);
    assert.match(res.messageText, /annual leave/i);
    recordCaseResult('case-11', 'Statutory Advisory Boundary: Employment Act Part IV', query, latencyMs, res.scenarioState);
    console.log(`✓ 11. Statutory advisory query returns directGroups.length === 0 cleanly (${latencyMs}ms)`);
    passed++;
  }

  // Case 12: Adversarial Subject-First Future Payment Refusal
  console.log('\n--- 12. Adversarial Subject-First Future Payment Refusal ---');
  {
    const query = 'Salaries payable S$4,000 will be paid by bank next week.';
    const t0 = Date.now();
    const res = await queryWithRetry(query, null, 'SFRS_I', geminiApiKey);
    const latencyMs = Date.now() - t0;
    assert.equal(res.scenarioState.directGroups?.length || 0, 0, 'Adversarial future payment must not post journals');
    assert.ok(!res.messageText.includes('AI Provider Unavailable'), 'Response must come from model/accounting validation, not provider error');
    recordCaseResult('case-12', 'Adversarial Subject-First Future Payment Refusal', query, latencyMs, res.scenarioState);
    console.log(`✓ 12. Adversarial subject-first future payment refused unconfirmed journal (${latencyMs}ms)`);
    passed++;
  }

  // Write structured JSON report artifact
  const reportPath = path.resolve('tests/fixtures/ai_first_live_acceptance_report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalCases: caseResults.length,
    passedCases: passed,
    cases: caseResults
  }, null, 2), 'utf8');
  console.log(`\n✓ Live acceptance execution report written to ${reportPath}`);

  console.log('\n================================================================');
  console.log(`ALL LIVE REAL-MODEL ACCEPTANCE TESTS PASSED! (${passed}/${passed} GREEN)`);
  console.log('================================================================');
}

runLiveAcceptanceSuite().catch(err => {
  console.error('\n❌ Live acceptance test failed:', err);
  process.exit(1);
});
