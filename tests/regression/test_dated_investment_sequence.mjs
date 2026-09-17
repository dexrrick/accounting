import assert from 'node:assert/strict';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { resolveDatedInvestmentSequence } from '../../src/engine/investmentEventResolver.ts';

const query = `Hi, could you help with the double entries for these family office transactions under SFRS(I)?

    1 Feb: Invested SGD 2,000,000 into an unquoted startup convertible note (FVTPL) via bank transfer. Paid SGD 20,000 legal fee.

    1 Jun: Funded SGD 1,000,000 capital call for PE fund (FVTPL) — SGD 950,000 for investment, SGD 50,000 for management fee.

    15 Sep: Family principal injected SGD 5,000,000 cash for 5,000,000 new ordinary shares. Same day transferred SGD 500,000 interest-free advance to a related party holding entity (repayable on demand).

    31 Dec: Year-end revaluation:

        Startup note valued at SGD 2,150,000. Received 5% annual coupon (SGD 100,000) in cash.

        PE fund NAV reported at SGD 1,050,000.

Please share the debit and credit journal entries with account names and amounts. Thanks!`;

const line = (group, account, side) => group.lines.find(item => item.accountName === account)?.[side];
const check = result => {
  assert.equal(result.scenarioState.scenarioType, 'EVENT_SEQUENCE', result.messageText);
  const groups = result.scenarioState.directGroups;
  assert.equal(groups?.length, 7, result.messageText);
  assert.ok(groups.every(group => group.isBalanced && group.totalDebit === group.totalCredit));
  assert.ok(groups.every(group => /year not stated/.test(group.eventDate)));
  assert.equal(line(groups[0], 'Financial Asset at FVTPL — Convertible Note', 'debit'), 2000000);
  assert.equal(line(groups[0], 'Legal and Professional Fees Expense', 'debit'), 20000);
  assert.equal(line(groups[1], 'Financial Asset at FVTPL — PE Fund', 'debit'), 950000);
  assert.equal(line(groups[1], 'Management Fee Expense', 'debit'), 50000);
  assert.equal(line(groups[2], 'Share Capital', 'credit'), 5000000);
  assert.equal(line(groups[3], 'Amount Due from Related Party', 'debit'), 500000);
  assert.equal(line(groups[4], 'Fair Value Gain — Convertible Note', 'credit'), 150000);
  assert.equal(line(groups[5], 'Coupon Income', 'credit'), 100000);
  assert.equal(line(groups[6], 'Fair Value Gain — PE Fund', 'credit'), 100000);
  assert.ok(!result.messageText.includes('Lease Inception'));
};

// Natural-language journal intent must be honored even when the checkbox is not supplied.
check(await processAccountingQuery(query, null, 'SFRS_I', '', 'gemini-3.5-flash-lite', [], { journal: false, statutory: false }));
const incomplete = await processAccountingQuery('Please prepare journal entries for an unspecified transaction.', null, 'SFRS_I', '', 'gemini-3.5-flash-lite', [], { journal: false, statutory: false });
assert.match(incomplete.messageText, /Clarification Required for Double Entry/);
assert.equal(incomplete.scenarioState.directGroups?.length, 0);
const changed = resolveDatedInvestmentSequence(query.replace('SGD 2,150,000', 'SGD 1,900,000'), 'SFRS_I');
assert.equal(changed?.clarifications.length, 0);
assert.equal(line(changed.groups[4], 'Fair Value Loss — Convertible Note', 'debit'), 100000);
const badAllocation = resolveDatedInvestmentSequence(query.replace('SGD 950,000 for investment', 'SGD 900,000 for investment'), 'SFRS_I');
assert.match(badAllocation?.clarifications[0]?.prompt || '', /reconciling investment\/fee allocation/i);

const originalFetch = globalThis.fetch;
let calls = 0;
try {
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ events: [
      { type: 'other', description: 'Note acquisition.' }, { type: 'other', description: 'Fund capital call.' },
      { type: 'other', description: 'Share issue and advance.' }, { type: 'other', description: 'Valuations and coupon.' }
    ] }) }] } }] }) };
  };
  check(await processAccountingQuery(query, null, 'SFRS_I', { activeProvider: 'gemini', gemini: { apiKey: 'test-key-long-enough', model: 'gemini-3.5-flash-lite' } }, 'gemini-3.5-flash-lite', [], { journal: false, statutory: false }));
  assert.equal(calls, 1);
} finally { globalThis.fetch = originalFetch; }

console.log('PASS | date-labelled family-office events post seven balanced groups without AI lease hallucination');
