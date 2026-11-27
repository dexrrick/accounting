import assert from 'node:assert/strict';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import { calculateDoubleEntries } from '../../src/engine/accountingEngine.ts';
import { processAccountingQuery, renderStructuredOfflineResponse } from '../../src/services/geminiService.ts';
import { updateCommittedJournalScenario } from '../../src/services/committedJournal.ts';
import { validateJournalGroups } from '../../src/verification/journalIntegrity.ts';

console.log('=== RUNNING STEP 1 LEASE DATES & IFRS 16 ACCURACY SUITE ===\n');

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
// 1. LEASE-1: Missing IBR + custom commencement date (1 July 2026)
//    Must remain CONDITIONAL / uncommitted, AND preserve 01/07/2026 & 31/07/2026
// ---------------------------------------------------------------------------
{
  const q = 'Prepare the journal entry for a 3-year office lease commencing 1 July 2026 at SGD 4,000 per month.';
  const parsed = await parseAccountingQuery(q, null);
  assert.equal(parsed.scenarioType, 'LEASE_IFRS16');
  assert.equal(parsed.authorityStatus, 'CONDITIONAL', 'LEASE-1 with omitted IBR must remain CONDITIONAL');
  assert.equal(parsed.leaseCommencementDate, '2026-07-01', 'LEASE-1 must parse 1 July 2026');
  assert.equal(parsed.purchaseDate, '2026-07-01');
  assert.equal(updateCommittedJournalScenario(null, parsed, 'SFRS_I'), null, 'LEASE-1 must remain uncommitted');

  const computed = calculateDoubleEntries(parsed, 'SFRS_I');
  assert.equal(computed.groups.length, 3);
  assert.equal(computed.groups[0].eventDate, '01/07/2026', 'Inception eventDate must be 01/07/2026');
  assert.equal(computed.groups[1].eventDate, '31/07/2026', 'Month 1 payment eventDate must be 31/07/2026');
  assert.equal(computed.groups[2].eventDate, '31/07/2026', 'Month 1 depreciation eventDate must be 31/07/2026');
  assert.equal(validateJournalGroups(computed.groups, { rawQuery: q }).isValid, true);

  const offlineRes = renderStructuredOfflineResponse(parsed, 'SFRS_I');
  assert.match(offlineRes.messageText, /01\/07\/2026/);
  assert.match(offlineRes.messageText, /31\/07\/2026/);
  assert.doesNotMatch(offlineRes.messageText, /01\/01\/2026|31\/01\/2026|2026-01-01/);
  assert.doesNotMatch(offlineRes.messageText, /\\n/);
}

// ---------------------------------------------------------------------------
// 2. LEASE-2: Explicit IBR (6%) + custom commencement date (1 July 2026)
//    Offline & mocked-online: deterministic, committed, exact 01/07/2026 & 31/07/2026
// ---------------------------------------------------------------------------
{
  const q = 'Prepare the journal entry for a 3-year office lease commencing 1 July 2026 at SGD 4,000 per month with incremental borrowing rate of 6% per annum.';
  const parsed = await parseAccountingQuery(q, null);
  assert.equal(parsed.scenarioType, 'LEASE_IFRS16');
  assert.equal(parsed.isComplete, true);
  assert.equal(parsed.authorityStatus, 'DETERMINISTIC');
  assert.equal(parsed.leaseCommencementDate, '2026-07-01');
  assert.equal(parsed.leaseDiscountRateAnnual, 6);
  assert.ok(parsed.keyParameters?.some(p => p.label === 'Commencement Date' && p.value === '01/07/2026'));

  const computed = calculateDoubleEntries(parsed, 'SFRS_I');
  assert.equal(computed.groups.length, 3);
  assert.equal(computed.groups[0].eventDate, '01/07/2026');
  assert.equal(computed.groups[1].eventDate, '31/07/2026');
  assert.equal(computed.groups[2].eventDate, '31/07/2026');
  assert.equal(computed.groups[0].totalDebit, 131484.06);
  assert.equal(computed.groups[1].totalDebit, 4000);
  assert.equal(computed.groups[2].totalDebit, 3652.34);
  assert.equal(validateJournalGroups(computed.groups, { rawQuery: q }).isValid, true);

  const committed = updateCommittedJournalScenario(null, parsed, 'SFRS_I');
  assert.ok(committed, 'LEASE-2 with explicit IBR and valid commencement date must commit');
  assert.equal(committed.directGroups?.[0]?.eventDate, '01/07/2026');
  assert.equal(committed.directGroups?.[1]?.eventDate, '31/07/2026');
  assert.equal(committed.directGroups?.[2]?.eventDate, '31/07/2026');

  const offlineRes = await processAccountingQuery(q, null, 'SFRS_I');
  assert.equal(offlineRes.scenarioState.leaseCommencementDate, '2026-07-01');
  assert.match(offlineRes.messageText, /01\/07\/2026/);
  assert.match(offlineRes.messageText, /31\/07\/2026/);
  assert.match(offlineRes.messageText, /✓ Balanced/);
  assert.doesNotMatch(offlineRes.messageText, /01\/01\/2026|31\/01\/2026/);

  const wrongProviderLeasePayload = {
    transactionTitle: 'Wrong Provider Lease',
    messageText: 'Wrong provider dates',
    directGroups: [{
      id: 'ai-wrong-lease',
      eventDate: '01/01/2026',
      title: 'Wrong Lease Date',
      summary: 'Wrong',
      lines: [
        { id: '1', accountCode: '1700', accountName: 'Right-of-Use Asset', category: 'ASSET', debit: 100000, credit: 0, lineExplanation: 'Dr' },
        { id: '2', accountCode: '2600', accountName: 'Lease Liability', category: 'LIABILITY', debit: 0, credit: 100000, lineExplanation: 'Cr' }
      ],
      totalDebit: 100000,
      totalCredit: 100000,
      isBalanced: true,
      citations: [],
      rationalePoints: []
    }]
  };
  const onlineRes = await withMockedFetch(async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(wrongProviderLeasePayload) } }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }), () =>
    processAccountingQuery(q, null, 'SFRS_I', mockedOnlineProvider)
  );
  assert.equal(onlineRes.scenarioState.leaseCommencementDate, '2026-07-01');
  assert.equal(onlineRes.scenarioState.directGroups?.length, 3, 'Online LEASE-2 must keep deterministic 3-group schedule');
  assert.equal(onlineRes.scenarioState.directGroups?.[0]?.eventDate, '01/07/2026');
  assert.equal(onlineRes.scenarioState.directGroups?.[1]?.eventDate, '31/07/2026');
  assert.equal(onlineRes.scenarioState.directGroups?.[2]?.eventDate, '31/07/2026');
  assert.equal(onlineRes.scenarioState.directGroups?.[0]?.totalDebit, 131484.06);
  assert.doesNotMatch(onlineRes.messageText, /01\/01\/2026|31\/01\/2026/);
}

// ---------------------------------------------------------------------------
// 3. Dateless lease must NOT fabricate 2026-01-01 / 01/01/2026 / 31/01/2026
// ---------------------------------------------------------------------------
{
  const q = '3-year office lease at SGD 4,000 per month with 6% discount rate';
  const parsed = await parseAccountingQuery(q, null);
  assert.equal(parsed.scenarioType, 'LEASE_IFRS16');
  assert.equal(parsed.leaseCommencementDate, undefined, 'Omitted commencement date must stay undefined');
  assert.equal(parsed.purchaseDate, undefined);

  const computed = calculateDoubleEntries(parsed, 'SFRS_I');
  assert.equal(computed.groups.length, 3);
  assert.equal(computed.groups[0].eventDate, 'Commencement Date');
  assert.equal(computed.groups[1].eventDate, 'End of Month 1');
  assert.equal(computed.groups[2].eventDate, 'End of Month 1');
  for (const grp of computed.groups) {
    assert.doesNotMatch(grp.eventDate, /2026|01\/01|31\/01/);
  }
  assert.equal(validateJournalGroups(computed.groups, { rawQuery: q }).isValid, true);
}

// ---------------------------------------------------------------------------
// 4. Mid-month and February commencement dates compute exact Month 1 end dates
// ---------------------------------------------------------------------------
{
  const midMonth = await parseAccountingQuery(
    '2-year office lease commencing 15 July 2026 at SGD 2,000 per month with 6% IBR.',
    null
  );
  const midGroups = calculateDoubleEntries(midMonth, 'SFRS_I').groups;
  assert.equal(midGroups[0].eventDate, '15/07/2026');
  assert.equal(midGroups[1].eventDate, '14/08/2026');
  assert.equal(midGroups[2].eventDate, '14/08/2026');

  const febStart = await parseAccountingQuery(
    '2-year office lease commencing 01/02/2026 at SGD 2,000 per month with 6% IBR.',
    null
  );
  const febGroups = calculateDoubleEntries(febStart, 'SFRS_I').groups;
  assert.equal(febGroups[0].eventDate, '01/02/2026');
  assert.equal(febGroups[1].eventDate, '28/02/2026');
  assert.equal(febGroups[2].eventDate, '28/02/2026');
}

// ---------------------------------------------------------------------------
// 5. Explicit 0% IBR preserves explicit zero and omits zero-value interest line
// ---------------------------------------------------------------------------
{
  const qZeroIbr = '2-year equipment lease commencing 1 May 2026 at SGD 1,000 per month with 0% IBR.';
  const parsed = await parseAccountingQuery(qZeroIbr, null);
  assert.equal(parsed.isComplete, true);
  assert.equal(parsed.authorityStatus, 'DETERMINISTIC');
  assert.equal(parsed.leaseDiscountRateAnnual, 0);

  const computed = calculateDoubleEntries(parsed, 'SFRS_I');
  assert.equal(computed.groups.length, 3);
  assert.equal(computed.groups[0].totalDebit, 24000);
  const payGroup = computed.groups[1];
  assert.equal(payGroup.eventDate, '31/05/2026');
  assert.equal(payGroup.lines.length, 2, '0% IBR Month 1 payment must omit zero-value Finance Costs line');
  assert.equal(payGroup.lines.some(l => l.accountCode === '6200'), false);
  assert.equal(payGroup.lines.every(l => l.debit > 0 || l.credit > 0), true);
  assert.equal(validateJournalGroups(computed.groups, { rawQuery: qZeroIbr }).isValid, true);
  assert.ok(updateCommittedJournalScenario(null, parsed, 'SFRS_I'));
}

// ---------------------------------------------------------------------------
// 6. Invalid calendar date & missing facts fail closed and stay uncommitted
// ---------------------------------------------------------------------------
{
  const validCommitted = updateCommittedJournalScenario(
    null,
    await parseAccountingQuery('3-year office lease commencing 1 July 2026 at SGD 4,000 per month with 6% IBR.', null),
    'SFRS_I'
  );
  assert.ok(validCommitted);

  const invalidDate = await parseAccountingQuery(
    '3-year office lease commencing 31 February 2026 at SGD 4,000 per month with 6% IBR.',
    null
  );
  assert.equal(invalidDate.isComplete, false, 'Invalid calendar lease date must fail closed');
  assert.deepEqual(invalidDate.directGroups, []);
  assert.ok(invalidDate.missingFields.some(f => f.fieldKey === 'leaseCommencementDate'));
  assert.equal(calculateDoubleEntries(invalidDate, 'SFRS_I').groups.length, 0);
  assert.equal(updateCommittedJournalScenario(validCommitted, invalidDate, 'SFRS_I'), validCommitted,
    'Invalid lease candidate must preserve last valid committed journal');
  assert.equal(updateCommittedJournalScenario(validCommitted, invalidDate, 'SFRS_I', true), null,
    'Explicit reset must clear committed journal when new lease candidate is invalid');

  const missingRent = await parseAccountingQuery('3-year office lease commencing 1 July 2026 with 6% IBR.', null);
  assert.equal(missingRent.isComplete, false);
  assert.equal(updateCommittedJournalScenario(null, missingRent, 'SFRS_I'), null);
}

console.log('✓ Step 1 lease dates, 0% IBR zero-line omission, and validation suite passed.');
