import assert from 'node:assert/strict';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { resolveMixedEventSequence } from '../../src/engine/mixedEventResolver.ts';

const query = `Nexus Innovations Pte Ltd reports under SFRS(I), is GST-registered (standard rate: 9%), and uses SGD.
Transaction 1 (1 Oct 2024 — Foreign Currency Import):
Purchased specialist components on credit from a US supplier for USD 50,000.
Exchange rate on 1 Oct 2024: USD 1.00 = SGD 1.34.
Nexus paid import GST directly to Singapore Customs on 1 Oct 2024 via bank transfer based on the customs-assessed CIF value of SGD 67,000 at 9%.
Transaction 2 (15 Nov 2024 — Treasury Shares Re-issuance):
Nexus holds 20,000 treasury shares previously repurchased at a cost of SGD 2.50 per share (total cost: SGD 50,000). The existing balance in the "Capital Reserve — Treasury Shares" account is SGD 6,000 (Credit).
Nexus re-issues 10,000 of these treasury shares on the open market for SGD 1.80 cash per share via bank transfer.
Transaction 3 (1 Dec 2024 — Variable Consideration / Right of Return):
Sold 500 tech devices to a local distributor on credit for SGD 200 each (plus 9% GST).
Cost of each device is SGD 120.
The customer has a 60-day full right of return. Nexus estimates that 10% of the units will be returned.
Transaction 4 (31 Dec 2024 — Year-End FX Revaluation):
The USD 50,000 trade liability from Transaction 1 remains completely unpaid at year-end.
Spot exchange rate on 31 Dec 2024: USD 1.00 = SGD 1.38.
Task: Prepare all general journal entries for transactions 1 through 4.`;

const check = result => {
  assert.equal(result.scenarioState.scenarioType, 'EVENT_SEQUENCE', result.messageText);
  const groups = result.scenarioState.directGroups;
  assert.equal(groups?.length, 4, result.messageText);
  for (const group of groups) assert.ok(group.isBalanced && group.totalDebit === group.totalCredit, group.title);
  const amount = (group, name, side) => group.lines.find(line => line.accountName === name)?.[side];
  assert.equal(amount(groups[0], 'Inventory', 'debit'), 67000);
  assert.equal(amount(groups[0], 'Input GST receivable', 'debit'), 6030);
  assert.equal(amount(groups[1], 'Treasury Shares', 'credit'), 25000);
  assert.equal(amount(groups[1], 'Capital Reserve — Treasury Shares', 'debit'), 6000);
  assert.equal(amount(groups[1], 'Retained Earnings', 'debit'), 1000);
  assert.equal(amount(groups[2], 'Sales Revenue', 'credit'), 90000);
  assert.equal(amount(groups[2], 'Refund Liability', 'credit'), 10000);
  assert.equal(amount(groups[2], 'Output GST payable', 'credit'), 9000);
  assert.equal(amount(groups[2], 'Right to Recover Returned Goods', 'debit'), 6000);
  assert.equal(amount(groups[3], 'Foreign Exchange Loss', 'debit'), 2000);
};

assert.ok(resolveMixedEventSequence(query, 'SFRS_I'), 'mixed resolver should claim the four-event question');
check(await processAccountingQuery(query, null, 'SFRS_I', '', 'gemini-3.5-flash-lite', [], { journal: true, statutory: false }));
const changedFacts = query.replaceAll('USD 50,000', 'USD 40,000').replace('SGD 1.34', 'SGD 1.25').replace('SGD 67,000', 'SGD 50,000').replace('SGD 1.38', 'SGD 1.30');
const changed = resolveMixedEventSequence(changedFacts, 'SFRS_I');
assert.equal(changed?.clarifications.length, 0);
assert.equal(changed?.groups[0].lines.find(line => line.accountName === 'Inventory')?.debit, 50000);
assert.equal(changed?.groups[0].lines.find(line => line.accountName === 'Input GST receivable')?.debit, 4500);
assert.equal(changed?.groups[3].lines.find(line => line.accountName === 'Foreign Exchange Loss')?.debit, 2000);
const missingRate = resolveMixedEventSequence(query.replace('SGD 1.38', 'rate unavailable'), 'SFRS_I');
assert.match(missingRate?.clarifications[0]?.prompt || '', /transaction 4/i);
assert.equal(missingRate?.groups.length, 3);
const originalFetch = globalThis.fetch;
let calls = 0;
let intentCalls = 0;
let eventCalls = 0;
const accountingIntent = {
  jurisdiction: ['Singapore'], authorityCandidates: ['ACCOUNTING_STANDARDS'], contextualAuthorities: ['IRAS'],
  domain: 'ACCOUNTING', population: 'COMPANY', primarySubject: 'multi-event accounting journal entries',
  concepts: [{ concept: 'mixed accounting events', role: 'PRIMARY' }],
  requestedOperation: 'PREPARE_JOURNAL', requiresUserSpecificFacts: true, calculationRequested: false,
  factsExplicitlyProvided: [], confidence: 0.96
};
const makeResponse = value => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }), { status: 200 });
try {
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(init.body);
    if (body.systemInstruction?.parts?.[0]?.text.includes('Interpret the user question only')) {
      intentCalls++;
      return makeResponse(accountingIntent);
    }
    if (body.contents?.[0]?.parts?.[0]?.text.startsWith('Extract chronological accounting EVENT FACTS')) {
      eventCalls++;
      return makeResponse({ events: [
      { type: 'foreign_currency_purchase', description: 'Imported components.' },
      { type: 'treasury_share_reissue', description: 'Reissued treasury shares.' },
      { type: 'sale_with_right_of_return', description: 'Sold goods with returns.' },
      { type: 'fx_remeasurement', description: 'Remeasured payable.' }
      ] });
    }
    return new Response('', { status: 500 });
  };
  check(await processAccountingQuery(query, null, 'SFRS_I', { activeProvider: 'gemini', gemini: { apiKey: 'test-key-long-enough', model: 'gemini-3.5-flash-lite' } }, 'gemini-3.5-flash-lite', [], { journal: true, statutory: false }));
  assert.equal(calls, 2, 'semantic intent and economic-event extraction are separate provider stages');
  assert.equal(intentCalls, 1, 'exactly one validated accounting-intent call precedes classification');
  assert.equal(eventCalls, 1, 'exactly one economic-event extraction call supplies transaction facts');
} finally { globalThis.fetch = originalFetch; }

console.log('PASS | mixed-domain text and AI-extraction routes produce four balanced journal groups');
