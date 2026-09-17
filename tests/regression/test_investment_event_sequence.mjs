import assert from 'node:assert/strict';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { resolveInvestmentEventSequence } from '../../src/engine/investmentEventResolver.ts';

// The source feedback was a single pasted paragraph, without line breaks between transactions.
const query = `Auria Family Office Pte Ltd reports under SFRS(I) with a financial year ending 31 December. (Assume all transactions are financial services/investments exempt or out of scope for GST).Transaction 1 (15 Mar 2024 — Unquoted Private Equity Investment under SFRS(I) 9):Invested SGD 5,000,000 directly into an unquoted early-stage tech firm, Horizon Bio Pte Ltd, acquiring an 8% non-controlling equity stake.Incurred and paid SGD 80,000 in legal due diligence and advisory fees directly attributable to the acquisition via bank transfer.Auria irrevocably designated this strategic, long-term equity holding at Fair Value through Other Comprehensive Income (FVOCI) at initial recognition.Transaction 2 (1 Jun 2024 — Mandated Discretionary Portfolio Management & Performance Fee Accrual):Auria entered into an external discretionary fund management mandate with an external asset manager.The portfolio is classified at Fair Value through Profit or Loss (FVTPL).On 31 December 2024, the market value of the listed portfolio surged from SGD 40,000,000 (initial funding) to SGD 46,000,000.Under the mandate contract, the manager is entitled to:A fixed annual management fee of 1.0% on the ending portfolio fair value (SGD 460,000), invoiced and unpaid as of 31 December 2024.A performance incentive fee of 15% on net capital appreciation achieved during the year (SGD 900,000), accrued as an expense at year-end.Transaction 3 (31 Dec 2024 — Year-End Valuation of the Unquoted PE Stake):An independent valuation specialist completed an equity valuation of Horizon Bio Pte Ltd using a calibrated market multiple model, establishing a fair value of SGD 6,200,000 for Auria's 8% stake.Transaction 4 (20 Feb 2025 — Distribution / Dividend in Specie from Private Investment):Horizon Bio Pte Ltd declared and executed a distribution in specie of marketable short-term treasury bills to its shareholders.Auria received treasury bills with an immediate fair value of SGD 250,000 (which Auria designates at FVTPL). The distribution represents a dividend return on capital rather than a liquidation recovery.Task:Prepare all general journal entries for transactions 1 through 4.`;

const entry = (group, name, side) => group.lines.find(line => line.accountName === name)?.[side];
const assertResult = result => {
  assert.equal(result.scenarioState.scenarioType, 'EVENT_SEQUENCE', result.messageText);
  const groups = result.scenarioState.directGroups;
  assert.equal(groups?.length, 4, result.messageText);
  assert.ok(groups.every(group => group.isBalanced && group.totalDebit === group.totalCredit));
  assert.deepEqual(groups.map(group => group.eventDate), ['15/03/2024', '31/12/2024', '31/12/2024', '20/02/2025']);
  assert.equal(result.scenarioState.eventSequence?.events[1]?.date, '31 December 2024');
  assert.equal(entry(groups[0], 'Cash at Bank', 'credit'), 5080000);
  assert.equal(entry(groups[1], 'Fair Value Gain — FVTPL Portfolio', 'credit'), 6000000);
  assert.equal(entry(groups[1], 'Management Fee Expense', 'debit'), 460000);
  assert.equal(entry(groups[1], 'Performance Fee Expense', 'debit'), 900000);
  assert.equal(entry(groups[2], 'FVOCI Fair Value Reserve (OCI)', 'credit'), 1120000);
  assert.equal(entry(groups[3], 'Financial Asset at FVTPL — Treasury Bills', 'debit'), 250000);
  assert.equal(entry(groups[3], 'Dividend Income', 'credit'), 250000);
};

assertResult(await processAccountingQuery(query, null, 'SFRS_I', '', 'gemini-3.5-flash-lite', [], { journal: true, statutory: false }));
const changed = resolveInvestmentEventSequence(query.replace('SGD 5,000,000', 'SGD 4,000,000').replace('SGD 6,200,000', 'SGD 5,500,000'), 'SFRS_I');
assert.equal(changed?.clarifications.length, 0);
assert.equal(entry(changed.groups[2], 'FVOCI Fair Value Reserve (OCI)', 'credit'), 1420000);
const missing = resolveInvestmentEventSequence(query.replace('SGD 6,200,000', 'an undisclosed amount'), 'SFRS_I');
assert.match(missing?.clarifications[0]?.prompt || '', /transaction 3/i);
assert.equal(missing?.groups.length, 3);
const unknownTax = resolveInvestmentEventSequence(query.replace('(Assume all transactions are financial services/investments exempt or out of scope for GST).', ''), 'SFRS_I');
assert.match(unknownTax?.clarifications[0]?.prompt || '', /GST treatment/i);

const originalFetch = globalThis.fetch;
let calls = 0;
try {
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ events: [
      { type: 'fvoci_equity_acquisition', description: 'Acquired FVOCI equity.' },
      { type: 'fvtpl_portfolio_valuation', description: 'Remeasured portfolio and accrued fees.' },
      { type: 'fvoci_equity_valuation', description: 'Valued equity.' },
      { type: 'investment_distribution', description: 'Received treasury bills.' }
    ] }) }] } }] }) };
  };
  assertResult(await processAccountingQuery(query, null, 'SFRS_I', { activeProvider: 'gemini', gemini: { apiKey: 'test-key-long-enough', model: 'gemini-3.5-flash-lite' } }, 'gemini-3.5-flash-lite', [], { journal: true, statutory: false }));
  assert.equal(calls, 1);
} finally { globalThis.fetch = originalFetch; }

console.log('PASS | investment sequence posts balanced FVOCI/FVTPL, fees, valuation and non-cash dividend entries');
