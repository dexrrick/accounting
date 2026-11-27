import assert from 'node:assert/strict';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import { processAccountingQuery, renderStructuredOfflineResponse } from '../../src/services/geminiService.ts';
import { updateCommittedJournalScenario } from '../../src/services/committedJournal.ts';
import { validateJournalGroups } from '../../src/verification/journalIntegrity.ts';

console.log('=== RUNNING STEP 1 PAYROLL & CPF ACCURACY REGRESSION SUITE ===\n');

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
// 1. PAY-1: Missing citizenship, age, and pay period (offline & mocked-online)
// ---------------------------------------------------------------------------
{
  const q = 'We paid monthly salary of SGD 5,000 to our employee. Prepare the payroll journal.';
  const parsed = await parseAccountingQuery(q, null);
  assert.equal(parsed.scenarioType, 'PAYROLL_CPF_SALARY');
  assert.equal(parsed.isComplete, false, 'PAY-1 must fail closed without citizenship/age/pay period');
  assert.equal(parsed.authorityStatus, 'CONDITIONAL');
  assert.deepEqual(parsed.directGroups, [], 'PAY-1 must emit empty directGroups');
  assert.ok(parsed.missingFields.length > 0);
  assert.equal(updateCommittedJournalScenario(null, parsed, 'SFRS_I'), null, 'PAY-1 must stay uncommitted');

  const offlineRes = await processAccountingQuery(q, null, 'SFRS_I');
  assert.equal(offlineRes.scenarioState.isComplete, false);
  assert.deepEqual(offlineRes.scenarioState.directGroups, []);
  assert.doesNotMatch(offlineRes.messageText, /Age 32|30 Sep 2026|30\/09\/2026|Employer CPF/i);

  const renderedIncomplete = renderStructuredOfflineResponse(parsed, 'SFRS_I');
  assert.equal(renderedIncomplete.scenarioState.isComplete, false);
  assert.deepEqual(renderedIncomplete.scenarioState.directGroups, []);
  assert.doesNotMatch(renderedIncomplete.messageText, /Age 32|20%|17%|37%|4\.36/);

  const fabricatedAiPayload = {
    transactionTitle: 'Monthly Payroll Accrual',
    directGroups: [
      {
        id: 'ai-fab-pay-1',
        eventDate: '30/09/2026',
        title: 'Fabricated Payroll',
        summary: 'Fabricated',
        lines: [
          { id: '1', accountCode: '5010', accountName: 'Staff Salaries & Wages', category: 'EXPENSE', debit: 5000, credit: 0, lineExplanation: 'Dr' },
          { id: '2', accountCode: '5020', accountName: 'Employer CPF Contribution', category: 'EXPENSE', debit: 850, credit: 0, lineExplanation: 'Dr' },
          { id: '3', accountCode: '2050', accountName: 'CPF Payable', category: 'LIABILITY', debit: 0, credit: 1850, lineExplanation: 'Cr' },
          { id: '4', accountCode: '2060', accountName: 'Net Salaries Payable', category: 'LIABILITY', debit: 0, credit: 4000, lineExplanation: 'Cr' }
        ],
        totalDebit: 5850,
        totalCredit: 5850,
        isBalanced: true,
        citations: [],
        rationalePoints: []
      }
    ],
    accountingTreatmentSummary: 'Fabricated CPF'
  };
  const onlineRes = await withMockedFetch(async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(fabricatedAiPayload) } }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }), () =>
    processAccountingQuery(q, null, 'SFRS_I', mockedOnlineProvider)
  );
  assert.equal(onlineRes.scenarioState.isComplete, false, 'PAY-1 mocked-online must fail closed');
  assert.deepEqual(onlineRes.scenarioState.directGroups, [], 'PAY-1 mocked-online must not emit fabricated journal groups');
  assert.equal(updateCommittedJournalScenario(null, onlineRes.scenarioState, 'SFRS_I'), null);
}

// ---------------------------------------------------------------------------
// 2. PAY-2 without pay period -> MUST fail closed (no silent Sep 2026 default)
// ---------------------------------------------------------------------------
{
  const qNoPeriod = 'We paid monthly salary of SGD 5,000 to our 62-year-old Singapore citizen employee. Prepare the payroll journal.';
  const parsed = await parseAccountingQuery(qNoPeriod, null);
  assert.equal(parsed.scenarioType, 'PAYROLL_CPF_SALARY');
  assert.equal(parsed.isComplete, false, 'PAY-2 without pay period must not silently default to September 2026');
  assert.equal(parsed.authorityStatus, 'CONDITIONAL');
  assert.deepEqual(parsed.directGroups, []);
  assert.ok(parsed.missingFields.some(f => f.fieldKey === 'payPeriod'));
  assert.equal(updateCommittedJournalScenario(null, parsed, 'SFRS_I'), null);
}

// ---------------------------------------------------------------------------
// 3. PAY-2 with explicit September 2026 (hyphenated 62-year-old & aged 62)
// ---------------------------------------------------------------------------
for (const qPay2 of [
  'We paid monthly salary of SGD 5,000 for September 2026 to our 62-year-old Singapore citizen employee. Prepare the payroll journal.',
  'We paid monthly salary of SGD 5,000 for September 2026 to our Singapore citizen employee aged 62. Prepare the payroll journal.'
]) {
  const parsed = await parseAccountingQuery(qPay2, null);
  assert.equal(parsed.scenarioType, 'PAYROLL_CPF_SALARY');
  assert.equal(parsed.isComplete, true, `PAY-2 must complete: ${qPay2}`);
  assert.equal(parsed.directGroups.length, 1);

  const grp = parsed.directGroups[0];
  assert.equal(grp.eventDate, '30/09/2026');
  assert.equal(grp.isBalanced, true);
  assert.equal(grp.totalDebit, 5636.25);
  assert.equal(grp.totalCredit, 5636.25);

  const line = (code) => grp.lines.find(l => l.accountCode === code);
  assert.equal(line('5010')?.debit, 5000);
  assert.equal(line('5020')?.debit, 625, '62-year-old 2026 employer CPF must be 12.5% = SGD 625');
  assert.equal(line('2050')?.credit, 1250, '62-year-old 2026 total CPF must be 25% = SGD 1,250');
  assert.equal(line('2060')?.credit, 4375, '62-year-old 2026 net salary must be 5,000 - 625 = SGD 4,375');
  assert.equal(line('5030')?.debit, 11.25);
  assert.equal(line('2055')?.credit, 11.25);
  assert.equal(validateJournalGroups([grp], { rawQuery: qPay2 }).isValid, true);

  const committed = updateCommittedJournalScenario(null, parsed, 'SFRS_I');
  assert.ok(committed, 'PAY-2 must commit');

  // Offline response
  const offlineRes = await processAccountingQuery(qPay2, null, 'SFRS_I');
  assert.equal(offlineRes.scenarioState.isComplete, true);
  assert.match(offlineRes.messageText, /12\.5%/);
  assert.match(offlineRes.messageText, /25%/);
  assert.match(offlineRes.messageText, /Skills Development Levy/);
  assert.match(offlineRes.messageText, /5,636\.25 == (?:SGD )?5,636\.25 ✓ Balanced/);
  assert.doesNotMatch(offlineRes.messageText, /\(20%\)|\(17%\)|\(37%\)/);

  // Mocked-online response (grounded deterministic journal is preserved and never overwritten by provider)
  const onlineRes = await withMockedFetch(async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ transactionTitle: 'Payroll', directGroups: [] }) } }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }), () =>
    processAccountingQuery(qPay2, null, 'SFRS_I', mockedOnlineProvider)
  );
  assert.equal(onlineRes.scenarioState.isComplete, true);
  assert.equal(onlineRes.scenarioState.directGroups?.[0]?.totalDebit, 5636.25);
  assert.equal(onlineRes.scenarioState.directGroups?.[0]?.totalCredit, 5636.25);
  assert.equal(onlineRes.scenarioState.directGroups?.[0]?.isBalanced, true);
  assert.equal(onlineRes.scenarioState.directGroups?.[0]?.lines.find(l => l.accountCode === '5020')?.debit, 625);
  assert.equal(onlineRes.scenarioState.directGroups?.[0]?.lines.find(l => l.accountCode === '2050')?.credit, 1250);
  assert.equal(onlineRes.scenarioState.directGroups?.[0]?.lines.find(l => l.accountCode === '2060')?.credit, 4375);
  assert.doesNotMatch(onlineRes.messageText, /\(20%\)|\(17%\)|\(37%\)/);
}

// ---------------------------------------------------------------------------
// 4. Effective-date guard (non-2026 year) & 1st/2nd-year PR guard
// ---------------------------------------------------------------------------
for (const non2026Query of [
  'We paid monthly salary of SGD 5,000 for September 2025 to our 62-year-old Singapore citizen employee. Prepare the payroll journal.',
  'We paid monthly salary of SGD 5,000 for January 2027 to our 62-year-old Singapore citizen employee. Prepare the payroll journal.'
]) {
  const parsed = await parseAccountingQuery(non2026Query, null);
  assert.equal(parsed.scenarioType, 'PAYROLL_CPF_SALARY');
  assert.equal(parsed.isComplete, false, `Non-2026 payroll must not silently use 2026 rates: ${non2026Query}`);
  assert.deepEqual(parsed.directGroups, []);
  assert.ok(parsed.missingFields.some(f => f.fieldKey === 'effectiveCpfYear'));
  assert.equal(updateCommittedJournalScenario(null, parsed, 'SFRS_I'), null);
}

for (const prQuery of [
  'We paid monthly salary of SGD 5,000 for September 2026 to our 1st-year Singapore PR aged 35. Prepare the payroll journal.',
  'We paid monthly salary of SGD 5,000 for September 2026 to our second-year PR employee aged 35. Prepare the payroll journal.',
  'We paid monthly salary of SGD 5,000 for September 2026 to our Singapore Permanent Resident aged 35. Prepare the payroll journal.'
]) {
  const parsed = await parseAccountingQuery(prQuery, null);
  assert.equal(parsed.scenarioType, 'PAYROLL_CPF_SALARY');
  assert.equal(parsed.isComplete, false, `PR without 3rd-year+ confirmation must fail closed: ${prQuery}`);
  assert.deepEqual(parsed.directGroups, []);
  assert.ok(parsed.missingFields.some(f => f.fieldKey === 'prRateBasis'));
  assert.equal(updateCommittedJournalScenario(null, parsed, 'SFRS_I'), null);
}

// ---------------------------------------------------------------------------
// 5. PAY-3: Foreign Worker / EP Holder -> CPF exempt, zero CPF lines omitted
// ---------------------------------------------------------------------------
{
  const qForeign = 'We paid monthly salary of SGD 5,000 to our Employment Pass foreign worker. Prepare the payroll journal.';
  const parsed = await parseAccountingQuery(qForeign, null);
  assert.equal(parsed.scenarioType, 'PAYROLL_CPF_SALARY');
  assert.equal(parsed.isComplete, true, 'PAY-3 foreign worker should complete without age or CPF period');
  assert.equal(parsed.directGroups.length, 1);

  const grp = parsed.directGroups[0];
  assert.equal(grp.lines.length, 4, 'PAY-3 must emit 4 lines (5010, 2060, 5030, 2055) and omit 5020/2050');
  assert.equal(grp.lines.some(l => l.accountCode === '5020'), false, 'Zero Employer CPF line must be omitted');
  assert.equal(grp.lines.some(l => l.accountCode === '2050'), false, 'Zero CPF Payable line must be omitted');
  assert.equal(grp.lines.find(l => l.accountCode === '5010')?.debit, 5000);
  assert.equal(grp.lines.find(l => l.accountCode === '2060')?.credit, 5000);
  assert.equal(grp.lines.find(l => l.accountCode === '5030')?.debit, 11.25);
  assert.equal(grp.lines.find(l => l.accountCode === '2055')?.credit, 11.25);
  assert.equal(grp.totalDebit, 5011.25);
  assert.equal(grp.totalCredit, 5011.25);
  assert.equal(grp.isBalanced, true);
  assert.equal(validateJournalGroups([grp], { rawQuery: qForeign }).isValid, true);
  assert.ok(updateCommittedJournalScenario(null, parsed, 'SFRS_I'));

  const offlineRes = await processAccountingQuery(qForeign, null, 'SFRS_I');
  assert.equal(offlineRes.scenarioState.isComplete, true);
  assert.match(offlineRes.messageText, /Exempt \(Foreign Worker/i);
  assert.match(offlineRes.messageText, /5,011\.25 == (?:SGD )?5,011\.25 ✓ Balanced/);
  assert.doesNotMatch(offlineRes.messageText, /Age 32|\(20%\)|\(17%\)|\(37%\)|30 Sep 2026|30\/09\/2026/);

  const onlineRes = await withMockedFetch(async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ transactionTitle: 'Foreign Worker Payroll', directGroups: [] }) } }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }), () =>
    processAccountingQuery(qForeign, null, 'SFRS_I', mockedOnlineProvider)
  );
  assert.equal(onlineRes.scenarioState.isComplete, true);
  assert.equal(onlineRes.scenarioState.directGroups?.[0]?.totalDebit, 5011.25);
  assert.equal(onlineRes.scenarioState.directGroups?.[0]?.lines.length, 4);
  assert.doesNotMatch(onlineRes.messageText, /Age 32|\(20%\)|30 Sep 2026/);
}

// ---------------------------------------------------------------------------
// 6. Conflicting / out-of-range age -> fail closed
// ---------------------------------------------------------------------------
for (const invalidAgeQuery of [
  'We paid monthly salary of SGD 5,000 for September 2026 to our Singapore citizen employee aged 5. Prepare the payroll journal.',
  'We paid monthly salary of SGD 5,000 for September 2026 to our 120-year-old Singapore citizen employee. Prepare the payroll journal.'
]) {
  const parsed = await parseAccountingQuery(invalidAgeQuery, null);
  assert.equal(parsed.isComplete, false, `Invalid age must fail closed: ${invalidAgeQuery}`);
  assert.deepEqual(parsed.directGroups, []);
  assert.ok(parsed.missingFields.some(f => f.fieldKey === 'employeeAge'));
  assert.equal(updateCommittedJournalScenario(null, parsed, 'SFRS_I'), null);
}

// ---------------------------------------------------------------------------
// 7. Same-transaction follow-up preserves prior valid committed payroll
//    when candidate is invalid, and updates when valid amendment is supplied
// ---------------------------------------------------------------------------
{
  const initialQuery = 'We paid monthly salary of SGD 5,000 for September 2026 to our 62-year-old Singapore citizen employee.';
  const initial = await parseAccountingQuery(initialQuery, null);
  const committed1 = updateCommittedJournalScenario(null, initial, 'SFRS_I');
  assert.ok(committed1);
  assert.equal(committed1.directGroups?.[0]?.totalDebit, 5636.25);

  const invalidResignation = await parseAccountingQuery('what if he resigned on 31/02/2026', committed1);
  assert.equal(invalidResignation.isComplete, false);
  assert.deepEqual(invalidResignation.directGroups, []);
  const committedAfterInvalid = updateCommittedJournalScenario(committed1, invalidResignation, 'SFRS_I');
  assert.equal(committedAfterInvalid?.directGroups?.[0]?.totalDebit, 5636.25,
    'prior committed payroll must be preserved when candidate follow-up is invalid');

  const validAmendment = await parseAccountingQuery('I mean 6,000 a month', committed1);
  assert.equal(validAmendment.isComplete, true);
  assert.equal(validAmendment.amount, 6000);
  // 6,000 * 12.5% = 750 employee, 12.5% = 750 employer -> 1500 total CPF; net 5250; SDL 11.25 -> 6761.25
  assert.equal(validAmendment.directGroups?.[0]?.totalDebit, 6761.25);
  const committedAfterValid = updateCommittedJournalScenario(committedAfterInvalid, validAmendment, 'SFRS_I');
  assert.equal(committedAfterValid?.directGroups?.[0]?.totalDebit, 6761.25);
}

console.log('✓ Step 1 payroll & CPF accuracy regression suite passed.');
