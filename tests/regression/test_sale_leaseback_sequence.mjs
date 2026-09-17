import assert from 'node:assert/strict';
import { processAccountingQuery } from '../../src/services/geminiService.ts';

const query = `Solaria Tech Pte Ltd is a GST-registered business in Singapore (standard rate: 9%) reporting under SFRS(I) 16 / IFRS 16 Leases, with a financial year ending 31 December.

Transaction 1 (1 Jan 2024 — Sale and Leaseback):
Solaria sold a specialised server rack system to a financing lessor for SGD 200,000 in cash (market value; transfer qualifies as a sale under SFRS(I) 15).
The carrying amount of the asset in Solaria's books immediately prior to the transfer was SGD 120,000 (Original Cost: SGD 180,000; Accumulated Depreciation: SGD 60,000).
Simultaneously, Solaria leased back the equipment for 3 years with annual payments of SGD 50,000, payable annually in arrears on 31 December (each payment subject to 9% GST).
Solaria’s incremental borrowing rate is 6% per annum.
Present value of the leaseback payments (SGD 50,000 annually at 6% for 3 years): SGD 133,651.
(Assume the sale transaction itself is a standard taxable supply subject to 9% GST billed to the lessor and collected on 1 Jan 2024).

Transaction 2 (31 Dec 2024):
Accrued annual finance cost (interest expense) on the lease liability at 6%.
Paid the Year 1 lease payment of SGD 50,000 plus 9% GST via bank transfer.
Recorded annual straight-line depreciation on the newly recognized ROU asset over the 3-year lease term.

Task: Prepare all general journal entries for the sale and leaseback and year-end lease entries.`;

const provider = { activeProvider: 'gemini', gemini: { apiKey: 'test-key-long-enough', model: 'gemini-3.5-flash-lite' } };
const originalFetch = globalThis.fetch;
let calls = 0;
try {
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ events: [
      { id: 'event-1', type: 'sale_and_leaseback', date: '1 Jan 2024', description: 'Sold the asset and leased it back.', confidence: 0.96 },
      { id: 'event-2', type: 'lease_payment', date: '31 Dec 2024', description: 'Paid the first lease instalment and accrued interest.', relatesTo: ['event-1'], confidence: 0.95 }
    ] }) }] } }] }) };
  };
  const result = await processAccountingQuery(query, null, 'SFRS_I', provider, provider.gemini.model, [], { journal: true, statutory: false });
  assert.equal(calls, 1, 'the selected AI provider must be called');
  assert.equal(result.scenarioState.scenarioType, 'EVENT_SEQUENCE');
  assert.equal(result.scenarioState.directGroups?.length, 2, result.messageText);
  assert.ok(result.scenarioState.directGroups.every(group => group.isBalanced && group.totalDebit > 0));
  assert.equal(result.scenarioState.directGroups[0].lines.find(line => line.accountName === 'Lease Liability')?.credit, 133651);
  assert.equal(result.scenarioState.directGroups[0].lines.find(line => line.accountName === 'Output GST payable')?.credit, 18000);
  assert.equal(result.scenarioState.directGroups[0].lines.find(line => line.accountName === 'Right-of-Use Asset')?.debit, 80190.6);
  assert.equal(result.scenarioState.directGroups[0].lines.find(line => line.accountName === 'Gain on Sale and Leaseback')?.credit, 26539.6);
  assert.equal(result.scenarioState.directGroups[1].lines.find(line => line.accountName === 'Finance Cost — Lease Liability')?.debit, 8019.06);

  globalThis.fetch = async () => ({ ok: false, status: 404 });
  const failed = await processAccountingQuery(query, null, 'SFRS_I', provider, provider.gemini.model, [], { journal: true, statutory: false });
  assert.equal(failed.scenarioState.directGroups?.length, 0);
  assert.match(failed.messageText, /Gemini event extraction returned HTTP 404/);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('PASS | Gemini lease event extraction reaches balanced sale-and-leaseback journals');
