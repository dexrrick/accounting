import assert from 'node:assert/strict';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { validateJournalGroups } from '../../src/verification/journalIntegrity.ts';
import { defaultAccountingGuardrails } from '../../src/engine/accountingGuardrails.ts';

// 1. Expense paid by bank transfer (not BANK_TRANSFER)
const q1 = "We paid rent of SGD 2,000 by bank transfer.";
const p1 = await parseAccountingQuery(q1, null);
assert.equal(p1.scenarioType, 'BASIC_BOOKKEEPING', 'Scenario must be BASIC_BOOKKEEPING');
assert.equal(p1.isComplete, true, 'Expense payment by bank transfer must be complete');
assert.equal(p1.directGroups?.length, 1, 'Must have exactly 1 journal group');
const g1 = p1.directGroups[0];
assert.notEqual(g1.id, 'basic-bank_transfer', 'Must not be classified as internal BANK_TRANSFER');
assert.equal(g1.lines[0].accountName, 'Rent Expense');
assert.equal(g1.lines[0].category, 'EXPENSE');
assert.equal(g1.lines[0].debit, 2000);
assert.equal(g1.lines[1].accountName, 'Cash at Bank');
assert.equal(g1.lines[1].category, 'ASSET');
assert.equal(g1.lines[1].credit, 2000);
assert.equal(g1.totalDebit, 2000);
assert.equal(g1.totalCredit, 2000);
assert.equal(g1.isBalanced, true);

// 2. Prepaid rent (ASSET, not immediate expense)
const q2 = "We paid 12 months of rent in advance, SGD 24,000, by bank transfer.";
const p2 = await parseAccountingQuery(q2, null);
assert.equal(p2.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p2.isComplete, true);
assert.equal(p2.directGroups?.length, 1);
const g2 = p2.directGroups[0];
assert.equal(g2.lines[0].accountName, 'Prepaid Rent');
assert.equal(g2.lines[0].category, 'ASSET');
assert.equal(g2.lines[0].debit, 24000);
assert.equal(g2.lines[1].accountName, 'Cash at Bank');
assert.equal(g2.lines[1].category, 'ASSET');
assert.equal(g2.lines[1].credit, 24000);
assert.equal(g2.totalDebit, 24000);
assert.equal(g2.totalCredit, 24000);
assert.equal(g2.isBalanced, true);

// 3. Refundable rental deposit (ASSET, not expense)
const q3 = "Paid a refundable rental deposit of SGD 3,000 from the bank.";
const p3 = await parseAccountingQuery(q3, null);
assert.equal(p3.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p3.isComplete, true);
assert.equal(p3.directGroups?.length, 1);
const g3 = p3.directGroups[0];
assert.equal(g3.lines[0].accountName, 'Refundable Deposits');
assert.equal(g3.lines[0].category, 'ASSET');
assert.equal(g3.lines[0].debit, 3000);
assert.equal(g3.lines[1].accountName, 'Cash at Bank');
assert.equal(g3.lines[1].category, 'ASSET');
assert.equal(g3.lines[1].credit, 3000);
assert.equal(g3.totalDebit, 3000);
assert.equal(g3.totalCredit, 3000);
assert.equal(g3.isBalanced, true);

// 4. Accrued expense settlement (LIABILITY, not a second expense)
const q4 = "Paid the electricity bill of SGD 450 by bank transfer, which was accrued last month.";
const p4 = await parseAccountingQuery(q4, null);
assert.equal(p4.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p4.isComplete, true);
assert.equal(p4.directGroups?.length, 1);
const g4 = p4.directGroups[0];
assert.equal(g4.lines[0].accountName, 'Accrued Expenses');
assert.equal(g4.lines[0].category, 'LIABILITY');
assert.equal(g4.lines[0].debit, 450);
assert.equal(g4.lines[1].accountName, 'Cash at Bank');
assert.equal(g4.lines[1].category, 'ASSET');
assert.equal(g4.lines[1].credit, 450);
assert.equal(g4.totalDebit, 450);
assert.equal(g4.totalCredit, 450);
assert.equal(g4.isBalanced, true);

// 5. Credit purchase of supplies (Trade Payables liability)
const q5 = "Bought office supplies of SGD 300 on credit from a supplier.";
const p5 = await parseAccountingQuery(q5, null);
assert.equal(p5.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p5.isComplete, true);
assert.equal(p5.directGroups?.length, 1);
const g5 = p5.directGroups[0];
assert.equal(g5.lines[0].accountName, 'Office Supplies Expense');
assert.equal(g5.lines[0].category, 'EXPENSE');
assert.equal(g5.lines[0].debit, 300);
assert.equal(g5.lines[1].accountName, 'Trade Payables');
assert.equal(g5.lines[1].category, 'LIABILITY');
assert.equal(g5.lines[1].credit, 300);
assert.equal(g5.totalDebit, 300);
assert.equal(g5.totalCredit, 300);
assert.equal(g5.isBalanced, true);

// 6. Loan repayment:
// a) Unsplit interest asks for interestSplit clarification
const q6a = "Repaid SGD 5,000 of the bank loan principal and interest from the bank";
const p6a = await parseAccountingQuery(q6a, null);
assert.equal(p6a.isComplete, false);
assert.ok(p6a.missingFields.some(f => f.fieldKey === 'interestSplit'), 'Must request interestSplit breakdown');

// b) Explicit principal and interest produces balanced 3-line entry
const q6b = "Repaid bank loan principal of SGD 5,000 and interest of SGD 250 from the bank";
const p6b = await parseAccountingQuery(q6b, null);
assert.equal(p6b.isComplete, true);
assert.equal(p6b.directGroups?.length, 1);
const g6b = p6b.directGroups[0];
assert.equal(g6b.lines.length, 3, 'Must have 3 lines');
assert.equal(g6b.lines[0].accountName, 'Bank Loan');
assert.equal(g6b.lines[0].category, 'LIABILITY');
assert.equal(g6b.lines[0].debit, 5000);
assert.equal(g6b.lines[1].accountName, 'Interest Expense');
assert.equal(g6b.lines[1].category, 'EXPENSE');
assert.equal(g6b.lines[1].debit, 250);
assert.equal(g6b.lines[2].accountName, 'Cash at Bank');
assert.equal(g6b.lines[2].category, 'ASSET');
assert.equal(g6b.lines[2].credit, 5250);
assert.equal(g6b.totalDebit, 5250);
assert.equal(g6b.totalCredit, 5250);
assert.equal(g6b.isBalanced, true);

// 7. Customer receipt with settlement discount asks for discountBreakdown
const q7 = "Received SGD 1,900 from customer settling invoice less 5% discount";
const p7 = await parseAccountingQuery(q7, null);
assert.equal(p7.isComplete, false);
assert.ok(p7.missingFields.some(f => f.fieldKey === 'discountBreakdown'), 'Must request discountBreakdown');

// 8. Credit sale with explicit cost records both sale (5000) and cost (3000)
const q8 = "Sold goods for SGD 5,000 on credit, cost SGD 3,000.";
const p8 = await parseAccountingQuery(q8, null);
assert.equal(p8.isComplete, true);
assert.equal(p8.directGroups?.length, 2, 'Must record 2 groups (revenue and inventory cost)');
const g8a = p8.directGroups[0];
assert.equal(g8a.lines[0].accountName, 'Trade Receivables');
assert.equal(g8a.lines[0].debit, 5000);
assert.equal(g8a.lines[1].accountName, 'Revenue');
assert.equal(g8a.lines[1].credit, 5000);
assert.equal(g8a.totalDebit, 5000);
assert.equal(g8a.totalCredit, 5000);
assert.equal(g8a.isBalanced, true);

const g8b = p8.directGroups[1];
assert.equal(g8b.lines[0].accountName, 'Cost of Goods Sold');
assert.equal(g8b.lines[0].category, 'EXPENSE');
assert.equal(g8b.lines[0].debit, 3000);
assert.equal(g8b.lines[1].accountName, 'Inventory');
assert.equal(g8b.lines[1].category, 'ASSET');
assert.equal(g8b.lines[1].credit, 3000);
assert.equal(g8b.totalDebit, 3000);
assert.equal(g8b.totalCredit, 3000);
assert.equal(g8b.isBalanced, true);

// 9. Follow-up resolution:
// a) missing paymentMethod
const q9a = "Paid rent SGD 2,000.";
const p9a = await parseAccountingQuery(q9a, null);
assert.equal(p9a.isComplete, false);
assert.ok(p9a.missingFields.some(f => f.fieldKey === 'paymentMethod'));
const p9aResolved = await parseAccountingQuery("By bank transfer.", p9a);
assert.equal(p9aResolved.isComplete, true);
assert.equal(p9aResolved.directGroups?.[0]?.lines[0].accountName, 'Rent Expense');
assert.equal(p9aResolved.directGroups?.[0]?.lines[1].accountName, 'Cash at Bank');
assert.equal(p9aResolved.directGroups?.[0]?.totalDebit, 2000);
assert.equal(p9aResolved.directGroups?.[0]?.isBalanced, true);

// b) missing amount
const q9b = "We paid rent by bank transfer.";
const p9b = await parseAccountingQuery(q9b, null);
assert.equal(p9b.isComplete, false);
assert.ok(p9b.missingFields.some(f => f.fieldKey === 'amount'));
const p9bResolved = await parseAccountingQuery("SGD 2,000.", p9b);
assert.equal(p9bResolved.isComplete, true);
assert.equal(p9bResolved.directGroups?.[0]?.lines[0].accountName, 'Rent Expense');
assert.equal(p9bResolved.directGroups?.[0]?.lines[1].accountName, 'Cash at Bank');
assert.equal(p9bResolved.directGroups?.[0]?.totalDebit, 2000);
assert.equal(p9bResolved.directGroups?.[0]?.isBalanced, true);

// 10. validateJournalGroups and defaultAccountingGuardrails
// a) Rejects 1-cent imbalance
const imbalancedGroup = {
  id: 'g-imb',
  eventDate: '01/01/2026',
  title: 'Test Imbalance',
  summary: 'Test Imbalance',
  lines: [
    { id: '1', accountCode: '1010', accountName: 'Cash at Bank', category: 'ASSET', debit: 500.01, credit: 0, lineExplanation: '' },
    { id: '2', accountCode: '2000', accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500.00, lineExplanation: '' }
  ],
  totalDebit: 500.01,
  totalCredit: 500.00,
  isBalanced: false,
  citations: [],
  rationalePoints: []
};
const v1 = validateJournalGroups([imbalancedGroup]);
assert.equal(v1.isValid, false);
assert.ok(v1.issues.some(i => i.code === 'IMBALANCED_GROUP'));

const gr1 = defaultAccountingGuardrails.validate(
  { ownershipContext: 'third_party', currency: { value: 'SGD', source: 'explicit' } },
  [imbalancedGroup]
);
assert.equal(gr1.isValid, false);
assert.ok(gr1.violations.some(v => v.code === 'DOUBLE_ENTRY_IMBALANCE'));

// b) Rejects account category misclassification
const misclassifiedGroup = {
  id: 'g-mis',
  eventDate: '01/01/2026',
  title: 'Test Misclassification',
  summary: 'Test Misclassification',
  lines: [
    { id: '1', accountCode: '1300', accountName: 'Prepaid Rent', category: 'EXPENSE', debit: 1000, credit: 0, lineExplanation: '' },
    { id: '2', accountCode: '2000', accountName: 'Trade Payables', category: 'ASSET', debit: 0, credit: 1000, lineExplanation: '' }
  ],
  totalDebit: 1000,
  totalCredit: 1000,
  isBalanced: true,
  citations: [],
  rationalePoints: []
};
const v2 = validateJournalGroups([misclassifiedGroup]);
assert.equal(v2.isValid, false);
assert.ok(v2.issues.some(i => i.code === 'CATEGORY_MISMATCH' && i.accountName === 'Prepaid Rent'));
assert.ok(v2.issues.some(i => i.code === 'CATEGORY_MISMATCH' && i.accountName === 'Trade Payables'));

const gr2 = defaultAccountingGuardrails.validate(
  { ownershipContext: 'third_party', currency: { value: 'SGD', source: 'explicit' } },
  [misclassifiedGroup]
);
assert.equal(gr2.isValid, false);
assert.ok(gr2.violations.some(v => v.code === 'SEMANTIC_FACT_CONTRADICTION'));

// c) Rejects AI-fabricated amounts when query has no numbers (UNSTATED_AMOUNT)
const unstatedGroup = {
  id: 'g-unstated',
  eventDate: '01/01/2026',
  title: 'Fabricated Entry',
  summary: 'Fabricated Entry',
  lines: [
    { id: '1', accountCode: '1010', accountName: 'Cash at Bank', category: 'ASSET', debit: 1000, credit: 0, lineExplanation: '' },
    { id: '2', accountCode: '2000', accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000, lineExplanation: '' }
  ],
  totalDebit: 1000,
  totalCredit: 1000,
  isBalanced: true,
  citations: [],
  rationalePoints: []
};
const v3 = validateJournalGroups([unstatedGroup], { rawQuery: 'Pay trade payables using bank' });
assert.equal(v3.isValid, false);
assert.ok(v3.issues.some(i => i.code === 'UNSTATED_AMOUNT'));

// d) End-to-end processAccountingQuery rejects provider-proposed invalid journal with real newlines
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => {
    const badAiJournal = {
      directGroups: [imbalancedGroup],
      accountingTreatmentSummary: 'AI proposed imbalanced journal'
    };
    return new Response(JSON.stringify({
      choices: [{
        message: { content: JSON.stringify(badAiJournal) }
      }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const endToEndRes = await processAccountingQuery(
    "How to record this unspecified transaction in double entry?",
    null,
    'SFRS_I',
    {
      activeProvider: 'azure',
      azure: {
        endpoint: 'https://test-endpoint.openai.azure.com',
        apiKey: 'test-api-key-1234567890',
        deploymentName: 'gpt-4o'
      }
    }
  );

  assert.ok(endToEndRes.messageText.includes('### AI-Proposed Journal Rejected\n\n'), 'Must reject with real newlines');
  assert.ok(!endToEndRes.messageText.includes('\\n'), 'Must not contain literal escaped newlines');
  assert.equal(endToEndRes.scenarioState.directGroups?.length, 0, 'directGroups must be emptied');
  assert.equal(endToEndRes.scenarioState.isComplete, false, 'isComplete must be false');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('PASS | Double-entry reliability, deterministic integrity, and guardrail validation');
