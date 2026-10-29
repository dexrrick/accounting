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

// 7. Customer receipt with settlement discount:
// a) Unsplit single-amount customer receipt with discount asks for discountBreakdown
const q7a = "Received SGD 1,900 from customer settling invoice less 5% discount";
const p7a = await parseAccountingQuery(q7a, null);
assert.equal(p7a.isComplete, false);
assert.ok(p7a.missingFields.some(f => f.fieldKey === 'discountBreakdown'), 'Must request discountBreakdown');

// b) Explicit 3-amount settlement discount produces balanced 3-line entry and passes validateJournalGroups
const q7b = "Received SGD 9,800 from customer by bank transfer to settle an invoice of SGD 10,000 after a settlement discount of SGD 200.";
const p7b = await parseAccountingQuery(q7b, null);
assert.equal(p7b.isComplete, true);
assert.equal(p7b.directGroups?.length, 1);
const g7b = p7b.directGroups[0];
assert.equal(g7b.lines.length, 3, 'Must have 3 lines');
assert.equal(g7b.lines[0].accountName, 'Cash at Bank');
assert.equal(g7b.lines[0].category, 'ASSET');
assert.equal(g7b.lines[0].debit, 9800);
assert.equal(g7b.lines[0].credit, 0);
assert.equal(g7b.lines[1].accountName, 'Discount Allowed');
assert.equal(g7b.lines[1].category, 'EXPENSE');
assert.equal(g7b.lines[1].debit, 200);
assert.equal(g7b.lines[1].credit, 0);
assert.equal(g7b.lines[2].accountName, 'Trade Receivables');
assert.equal(g7b.lines[2].category, 'ASSET');
assert.equal(g7b.lines[2].debit, 0);
assert.equal(g7b.lines[2].credit, 10000);
assert.equal(g7b.totalDebit, 10000);
assert.equal(g7b.totalCredit, 10000);
assert.equal(g7b.isBalanced, true);
const v7b = validateJournalGroups([g7b]);
assert.equal(v7b.isValid, true, 'Explicit 3-amount settlement discount must pass validateJournalGroups');

// c) Explicit 2-amount invoice + discount produces balanced 3-line entry
const q7c = "Customer settled an outstanding invoice of SGD 5,000 by bank transfer with a discount of SGD 100.";
const p7c = await parseAccountingQuery(q7c, null);
assert.equal(p7c.isComplete, true);
assert.equal(p7c.directGroups?.length, 1);
const g7c = p7c.directGroups[0];
assert.equal(g7c.lines.length, 3, 'Must have 3 lines');
assert.equal(g7c.lines[0].accountName, 'Cash at Bank');
assert.equal(g7c.lines[0].category, 'ASSET');
assert.equal(g7c.lines[0].debit, 4900);
assert.equal(g7c.lines[0].credit, 0);
assert.equal(g7c.lines[1].accountName, 'Discount Allowed');
assert.equal(g7c.lines[1].category, 'EXPENSE');
assert.equal(g7c.lines[1].debit, 100);
assert.equal(g7c.lines[1].credit, 0);
assert.equal(g7c.lines[2].accountName, 'Trade Receivables');
assert.equal(g7c.lines[2].category, 'ASSET');
assert.equal(g7c.lines[2].debit, 0);
assert.equal(g7c.lines[2].credit, 5000);
assert.equal(g7c.totalDebit, 5000);
assert.equal(g7c.totalCredit, 5000);
assert.equal(g7c.isBalanced, true);
const v7c = validateJournalGroups([g7c]);
assert.equal(v7c.isValid, true, 'Explicit 2-amount settlement discount must pass validateJournalGroups');

// d) Inconsistent 3-amount discount query fails closed
const q7d = "Received SGD 9,500 from customer by bank transfer to settle an invoice of SGD 10,000 after a settlement discount of SGD 200.";
const p7d = await parseAccountingQuery(q7d, null);
assert.equal(p7d.isComplete, false);
assert.ok(p7d.missingFields.some(f => f.fieldKey === 'discountBreakdown'), 'Must request discountBreakdown when amounts do not reconcile');

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

// c) bare numeric follow-up without "SGD"
const q9c = "We paid rent by bank transfer.";
const p9c = await parseAccountingQuery(q9c, null);
assert.equal(p9c.isComplete, false);
assert.ok(p9c.missingFields.some(f => f.fieldKey === 'amount'));
const p9cResolved = await parseAccountingQuery("2,000", p9c);
assert.equal(p9cResolved.isComplete, true);
assert.equal(p9cResolved.directGroups?.[0]?.lines[0].accountName, 'Rent Expense');
assert.equal(p9cResolved.directGroups?.[0]?.lines[1].accountName, 'Cash at Bank');
assert.equal(p9cResolved.directGroups?.[0]?.totalDebit, 2000);
assert.equal(p9cResolved.directGroups?.[0]?.isBalanced, true);

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

// 11. Unearned Revenue / Customer Advances:
// a) Customer advance received (UNEARNED_REVENUE_RECEIPT) -> Dr Cash at Bank / Cr Unearned Revenue (LIABILITY)
const q11a = "Received advance payment of SGD 3,000 from a customer for services to be delivered next month.";
const p11a = await parseAccountingQuery(q11a, null);
assert.equal(p11a.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p11a.isComplete, true);
assert.equal(p11a.directGroups?.length, 1);
const g11a = p11a.directGroups[0];
assert.equal(g11a.lines[0].accountName, 'Cash at Bank');
assert.equal(g11a.lines[0].category, 'ASSET');
assert.equal(g11a.lines[0].debit, 3000);
assert.equal(g11a.lines[1].accountName, 'Unearned Revenue');
assert.equal(g11a.lines[1].category, 'LIABILITY');
assert.equal(g11a.lines[1].credit, 3000);
assert.equal(g11a.totalDebit, 3000);
assert.equal(g11a.totalCredit, 3000);
assert.equal(g11a.isBalanced, true);
const v11a = validateJournalGroups([g11a], { rawQuery: q11a });
assert.equal(v11a.isValid, true);

// b) Recognition of earned unearned revenue (UNEARNED_REVENUE_RECOGNITION) -> Dr Unearned Revenue (LIABILITY) / Cr Revenue (REVENUE)
const q11b = "Recognised SGD 5,000 of unearned revenue upon completing delivery of services to the customer.";
const p11b = await parseAccountingQuery(q11b, null);
assert.equal(p11b.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p11b.isComplete, true);
assert.equal(p11b.directGroups?.length, 1);
const g11b = p11b.directGroups[0];
assert.equal(g11b.lines[0].accountName, 'Unearned Revenue');
assert.equal(g11b.lines[0].category, 'LIABILITY');
assert.equal(g11b.lines[0].debit, 5000);
assert.equal(g11b.lines[1].accountName, 'Revenue');
assert.equal(g11b.lines[1].category, 'REVENUE');
assert.equal(g11b.lines[1].credit, 5000);
assert.equal(g11b.totalDebit, 5000);
assert.equal(g11b.totalCredit, 5000);
assert.equal(g11b.isBalanced, true);
const v11b = validateJournalGroups([g11b], { rawQuery: q11b });
assert.equal(v11b.isValid, true);

// 12. Expected Credit Loss and Bad Debt Write-Offs:
// a) Allowance for doubtful debts / ECL (BAD_DEBT_ALLOWANCE) -> Dr Impairment Loss on Trade Receivables (EXPENSE) / Cr Allowance for Doubtful Debts (ASSET)
const q12a = "Record expected credit loss allowance of SGD 2,500 on trade receivables.";
const p12a = await parseAccountingQuery(q12a, null);
assert.equal(p12a.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p12a.isComplete, true);
assert.equal(p12a.directGroups?.length, 1);
const g12a = p12a.directGroups[0];
assert.equal(g12a.lines[0].accountName, 'Impairment Loss on Trade Receivables');
assert.equal(g12a.lines[0].category, 'EXPENSE');
assert.equal(g12a.lines[0].debit, 2500);
assert.equal(g12a.lines[1].accountName, 'Allowance for Doubtful Debts');
assert.equal(g12a.lines[1].category, 'ASSET');
assert.equal(g12a.lines[1].credit, 2500);
assert.equal(g12a.totalDebit, 2500);
assert.equal(g12a.totalCredit, 2500);
assert.equal(g12a.isBalanced, true);
const v12a = validateJournalGroups([g12a], { rawQuery: q12a });
assert.equal(v12a.isValid, true);

// b) Write-off against existing allowance (BAD_DEBT_WRITE_OFF) -> Dr Allowance for Doubtful Debts (ASSET) / Cr Trade Receivables (ASSET)
const q12b = "Write off uncollectible debt of SGD 1,500 against the allowance for doubtful debts.";
const p12b = await parseAccountingQuery(q12b, null);
assert.equal(p12b.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p12b.isComplete, true);
assert.equal(p12b.directGroups?.length, 1);
const g12b = p12b.directGroups[0];
assert.equal(g12b.lines[0].accountName, 'Allowance for Doubtful Debts');
assert.equal(g12b.lines[0].category, 'ASSET');
assert.equal(g12b.lines[0].debit, 1500);
assert.equal(g12b.lines[1].accountName, 'Trade Receivables');
assert.equal(g12b.lines[1].category, 'ASSET');
assert.equal(g12b.lines[1].credit, 1500);
assert.equal(g12b.totalDebit, 1500);
assert.equal(g12b.totalCredit, 1500);
assert.equal(g12b.isBalanced, true);
const v12b = validateJournalGroups([g12b], { rawQuery: q12b });
assert.equal(v12b.isValid, true);

// c) Direct write-off to bad debt expense (BAD_DEBT_WRITE_OFF) -> Dr Bad Debt Expense (EXPENSE) / Cr Trade Receivables (ASSET)
const q12c = "Write off uncollectible debt of SGD 800 directly to bad debt expense with no prior allowance.";
const p12c = await parseAccountingQuery(q12c, null);
assert.equal(p12c.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p12c.isComplete, true);
assert.equal(p12c.directGroups?.length, 1);
const g12c = p12c.directGroups[0];
assert.equal(g12c.lines[0].accountName, 'Bad Debt Expense');
assert.equal(g12c.lines[0].category, 'EXPENSE');
assert.equal(g12c.lines[0].debit, 800);
assert.equal(g12c.lines[1].accountName, 'Trade Receivables');
assert.equal(g12c.lines[1].category, 'ASSET');
assert.equal(g12c.lines[1].credit, 800);
assert.equal(g12c.totalDebit, 800);
assert.equal(g12c.totalCredit, 800);
assert.equal(g12c.isBalanced, true);
const v12c = validateJournalGroups([g12c], { rawQuery: q12c });
assert.equal(v12c.isValid, true);

// d) Ambiguous write-off requests writeOffMethod clarification and resolves via follow-up reply
const q12d = "Write off uncollectible customer invoice of SGD 1,200.";
const p12d = await parseAccountingQuery(q12d, null);
assert.equal(p12d.isComplete, false, 'Ambiguous write-off must fail closed');
assert.ok(p12d.missingFields.some(f => f.fieldKey === 'writeOffMethod'), 'Must request writeOffMethod');

const resolved12d = await parseAccountingQuery("Against the allowance for doubtful debts.", p12d);
assert.equal(resolved12d.isComplete, true, 'Follow-up must resolve to complete scenario');
assert.equal(resolved12d.directGroups?.length, 1);
const g12d = resolved12d.directGroups[0];
assert.equal(g12d.lines[0].accountName, 'Allowance for Doubtful Debts');
assert.equal(g12d.lines[0].category, 'ASSET');
assert.equal(g12d.lines[0].debit, 1200);
assert.equal(g12d.lines[1].accountName, 'Trade Receivables');
assert.equal(g12d.lines[1].category, 'ASSET');
assert.equal(g12d.lines[1].credit, 1200);
assert.equal(g12d.isBalanced, true);
const v12d = validateJournalGroups([g12d], { rawQuery: q12d });
assert.equal(v12d.isValid, true);

// 13. Supplier Settlements & Settlement Discounts:
// a) Straight supplier invoice settlement (SUPPLIER_PAYMENT) -> Dr Trade Payables (LIABILITY) / Cr Cash at Bank (ASSET)
const q13a = "Paid supplier invoice of SGD 4,500 by bank transfer.";
const p13a = await parseAccountingQuery(q13a, null);
assert.equal(p13a.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p13a.isComplete, true);
assert.equal(p13a.directGroups?.length, 1);
const g13a = p13a.directGroups[0];
assert.equal(g13a.lines[0].accountName, 'Trade Payables');
assert.equal(g13a.lines[0].category, 'LIABILITY');
assert.equal(g13a.lines[0].debit, 4500);
assert.equal(g13a.lines[1].accountName, 'Cash at Bank');
assert.equal(g13a.lines[1].category, 'ASSET');
assert.equal(g13a.lines[1].credit, 4500);
assert.equal(g13a.totalDebit, 4500);
assert.equal(g13a.totalCredit, 4500);
assert.equal(g13a.isBalanced, true);
const v13a = validateJournalGroups([g13a], { rawQuery: q13a });
assert.equal(v13a.isValid, true);

// b) Supplier invoice settlement with explicit discount (gross SGD 4,000, discount SGD 80, net SGD 3,920)
// -> Dr Trade Payables (4000), Cr Cash at Bank (3920), Cr Discount Received (REVENUE, 80)
const q13b = "Settled supplier invoice of SGD 4,000 receiving an early settlement discount of SGD 80, paid SGD 3,920 by bank transfer.";
const p13b = await parseAccountingQuery(q13b, null);
assert.equal(p13b.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p13b.isComplete, true);
assert.equal(p13b.directGroups?.length, 1);
const g13b = p13b.directGroups[0];
assert.equal(g13b.lines.length, 3);
assert.equal(g13b.lines[0].accountName, 'Trade Payables');
assert.equal(g13b.lines[0].category, 'LIABILITY');
assert.equal(g13b.lines[0].debit, 4000);
assert.equal(g13b.lines[0].credit, 0);
assert.equal(g13b.lines[1].accountName, 'Cash at Bank');
assert.equal(g13b.lines[1].category, 'ASSET');
assert.equal(g13b.lines[1].debit, 0);
assert.equal(g13b.lines[1].credit, 3920);
assert.equal(g13b.lines[2].accountName, 'Discount Received');
assert.equal(g13b.lines[2].category, 'REVENUE');
assert.equal(g13b.lines[2].debit, 0);
assert.equal(g13b.lines[2].credit, 80);
assert.equal(g13b.totalDebit, 4000);
assert.equal(g13b.totalCredit, 4000);
assert.equal(g13b.isBalanced, true);
const v13b = validateJournalGroups([g13b], { rawQuery: q13b });
assert.equal(v13b.isValid, true);

// c) Supplier invoice settlement with unsplit percentage discount (SGD 4,000 less 2% discount) fails closed
const q13c = "Paid supplier invoice of SGD 4,000 less 2% discount by bank transfer.";
const p13c = await parseAccountingQuery(q13c, null);
assert.equal(p13c.isComplete, false, 'Unsplit discount must fail closed');
assert.ok(p13c.missingFields.some(f => f.fieldKey === 'discountBreakdown'), 'Must request discountBreakdown');

// 14. Returns and Allowances:
// a) Sales return on credit with inventory cost restoration (sale SGD 500, cost SGD 300)
// -> 2 balanced groups (Dr Sales Returns and Allowances / Cr Trade Receivables and Dr Inventory / Cr Cost of Goods Sold)
const q14a = "Customer returned defective merchandise sold for SGD 500 on credit, with original cost of goods sold of SGD 300.";
const p14a = await parseAccountingQuery(q14a, null);
assert.equal(p14a.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p14a.isComplete, true);
assert.equal(p14a.directGroups?.length, 2, 'Must have 2 groups for sales return with cost restoration');

const g14a1 = p14a.directGroups[0];
assert.equal(g14a1.lines[0].accountName, 'Sales Returns and Allowances');
assert.equal(g14a1.lines[0].category, 'REVENUE');
assert.equal(g14a1.lines[0].debit, 500);
assert.equal(g14a1.lines[1].accountName, 'Trade Receivables');
assert.equal(g14a1.lines[1].category, 'ASSET');
assert.equal(g14a1.lines[1].credit, 500);
assert.equal(g14a1.totalDebit, 500);
assert.equal(g14a1.totalCredit, 500);
assert.equal(g14a1.isBalanced, true);

const g14a2 = p14a.directGroups[1];
assert.equal(g14a2.title, 'Inventory return restoration');
assert.equal(g14a2.lines[0].accountName, 'Inventory');
assert.equal(g14a2.lines[0].category, 'ASSET');
assert.equal(g14a2.lines[0].debit, 300);
assert.equal(g14a2.lines[1].accountName, 'Cost of Goods Sold');
assert.equal(g14a2.lines[1].category, 'EXPENSE');
assert.equal(g14a2.lines[1].credit, 300);
assert.equal(g14a2.totalDebit, 300);
assert.equal(g14a2.totalCredit, 300);
assert.equal(g14a2.isBalanced, true);

const v14a = validateJournalGroups(p14a.directGroups, { rawQuery: q14a });
assert.equal(v14a.isValid, true, 'Both groups must pass validateJournalGroups');

// b) Purchase return of inventory to supplier (SGD 750) -> Dr Trade Payables (LIABILITY) / Cr Inventory (ASSET)
const q14b = "Returned defective goods of SGD 750 to a supplier on credit.";
const p14b = await parseAccountingQuery(q14b, null);
assert.equal(p14b.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p14b.isComplete, true);
assert.equal(p14b.directGroups?.length, 1);
const g14b = p14b.directGroups[0];
assert.equal(g14b.lines[0].accountName, 'Trade Payables');
assert.equal(g14b.lines[0].category, 'LIABILITY');
assert.equal(g14b.lines[0].debit, 750);
assert.equal(g14b.lines[1].accountName, 'Inventory');
assert.equal(g14b.lines[1].category, 'ASSET');
assert.equal(g14b.lines[1].credit, 750);
assert.equal(g14b.totalDebit, 750);
assert.equal(g14b.totalCredit, 750);
assert.equal(g14b.isBalanced, true);
const v14b = validateJournalGroups([g14b], { rawQuery: q14b });
assert.equal(v14b.isValid, true);

// 15. Provisions and Accrued Expenses:
// a) Warranty provision recognition (SGD 6,000) -> Dr Warranty Expense (EXPENSE) / Cr Provision for Warranties (LIABILITY)
const q15a = "Recognise a warranty provision of SGD 6,000 for product warranties.";
const p15a = await parseAccountingQuery(q15a, null);
assert.equal(p15a.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p15a.isComplete, true);
assert.equal(p15a.directGroups?.length, 1);
const g15a = p15a.directGroups[0];
assert.equal(g15a.lines[0].accountName, 'Warranty Expense');
assert.equal(g15a.lines[0].category, 'EXPENSE');
assert.equal(g15a.lines[0].debit, 6000);
assert.equal(g15a.lines[1].accountName, 'Provision for Warranties');
assert.equal(g15a.lines[1].category, 'LIABILITY');
assert.equal(g15a.lines[1].credit, 6000);
assert.equal(g15a.totalDebit, 6000);
assert.equal(g15a.totalCredit, 6000);
assert.equal(g15a.isBalanced, true);
const v15a = validateJournalGroups([g15a], { rawQuery: q15a });
assert.equal(v15a.isValid, true);

// b) Contingent liability / non-probable legal claim (SGD 50,000) fails closed
const q15b = "Recognise a provision for legal claim of SGD 50,000 where outflow is not probable.";
const p15b = await parseAccountingQuery(q15b, null);
assert.equal(p15b.isComplete, false, 'Non-probable outflow must fail closed as contingent liability');
assert.ok(p15b.missingFields.some(f => f.fieldKey === 'probableOutflow'), 'Must request probableOutflow clarification');

// c) Month-end accrual of unpaid utilities expense (SGD 1,250) -> Dr Utilities Expense (EXPENSE) / Cr Accrued Expenses (LIABILITY)
const q15c = "Accrued unpaid electricity bill of SGD 1,250 at month-end.";
const p15c = await parseAccountingQuery(q15c, null);
assert.equal(p15c.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p15c.isComplete, true);
assert.equal(p15c.directGroups?.length, 1);
const g15c = p15c.directGroups[0];
assert.equal(g15c.lines[0].accountName, 'Utilities Expense');
assert.equal(g15c.lines[0].category, 'EXPENSE');
assert.equal(g15c.lines[0].debit, 1250);
assert.equal(g15c.lines[1].accountName, 'Accrued Expenses');
assert.equal(g15c.lines[1].category, 'LIABILITY');
assert.equal(g15c.lines[1].credit, 1250);
assert.equal(g15c.totalDebit, 1250);
assert.equal(g15c.totalCredit, 1250);
assert.equal(g15c.isBalanced, true);
const v15c = validateJournalGroups([g15c], { rawQuery: q15c });
assert.equal(v15c.isValid, true);

// 16. Payroll & CPF Postings:
// a) Monthly payroll accrual with stated gross, employee CPF, employer CPF
const q16a = "Monthly payroll: gross salaries SGD 5,000, employee CPF SGD 1,000, employer CPF SGD 850.";
const p16a = await parseAccountingQuery(q16a, null);
assert.equal(p16a.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p16a.isComplete, true);
assert.equal(p16a.directGroups?.length, 1);
const g16a = p16a.directGroups[0];
assert.equal(g16a.lines.length, 4);
assert.equal(g16a.lines[0].accountName, 'Salaries and Wages Expense');
assert.equal(g16a.lines[0].category, 'EXPENSE');
assert.equal(g16a.lines[0].debit, 5000);
assert.equal(g16a.lines[1].accountName, 'Employer CPF Contribution Expense');
assert.equal(g16a.lines[1].category, 'EXPENSE');
assert.equal(g16a.lines[1].debit, 850);
assert.equal(g16a.lines[2].accountName, 'Salaries Payable');
assert.equal(g16a.lines[2].category, 'LIABILITY');
assert.equal(g16a.lines[2].credit, 4000);
assert.equal(g16a.lines[3].accountName, 'CPF Payable');
assert.equal(g16a.lines[3].category, 'LIABILITY');
assert.equal(g16a.lines[3].credit, 1850);
assert.equal(g16a.totalDebit, 5850);
assert.equal(g16a.totalCredit, 5850);
assert.equal(g16a.isBalanced, true);
const v16a = validateJournalGroups([g16a], { rawQuery: q16a });
assert.equal(v16a.isValid, true);

// a2) Post payroll with amounts preceding labels
const q16a_alt = "Post payroll: SGD 1,000 employee CPF, SGD 850 employer CPF, SGD 5,000 gross salary.";
const p16a_alt = await parseAccountingQuery(q16a_alt, null);
assert.equal(p16a_alt.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p16a_alt.isComplete, true);
assert.equal(p16a_alt.directGroups?.length, 1);
const g16a_alt = p16a_alt.directGroups[0];
assert.equal(g16a_alt.lines.length, 4);
assert.equal(g16a_alt.totalDebit, 5850);
assert.equal(g16a_alt.totalCredit, 5850);
assert.equal(g16a_alt.isBalanced, true);
const v16a_alt = validateJournalGroups([g16a_alt], { rawQuery: q16a_alt });
assert.equal(v16a_alt.isValid, true);

// b) Settlement of net salaries payable
const q16b = "Paid net salaries of SGD 4,000 by bank transfer.";
const p16b = await parseAccountingQuery(q16b, null);
assert.equal(p16b.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p16b.isComplete, true);
assert.equal(p16b.directGroups?.length, 1);
const g16b = p16b.directGroups[0];
assert.equal(g16b.lines[0].accountName, 'Salaries Payable');
assert.equal(g16b.lines[0].category, 'LIABILITY');
assert.equal(g16b.lines[0].debit, 4000);
assert.equal(g16b.lines[1].accountName, 'Cash at Bank');
assert.equal(g16b.lines[1].category, 'ASSET');
assert.equal(g16b.lines[1].credit, 4000);
assert.equal(g16b.totalDebit, 4000);
assert.equal(g16b.totalCredit, 4000);
assert.equal(g16b.isBalanced, true);
const v16b = validateJournalGroups([g16b], { rawQuery: q16b });
assert.equal(v16b.isValid, true);

// c) Remittance of CPF contributions to CPF Board
const q16c = "Remitted CPF payable of SGD 1,850 to CPF Board.";
const p16c = await parseAccountingQuery(q16c, null);
assert.equal(p16c.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p16c.isComplete, true);
assert.equal(p16c.directGroups?.length, 1);
const g16c = p16c.directGroups[0];
assert.equal(g16c.lines[0].accountName, 'CPF Payable');
assert.equal(g16c.lines[0].category, 'LIABILITY');
assert.equal(g16c.lines[0].debit, 1850);
assert.equal(g16c.lines[1].accountName, 'Cash at Bank');
assert.equal(g16c.lines[1].category, 'ASSET');
assert.equal(g16c.lines[1].credit, 1850);
assert.equal(g16c.totalDebit, 1850);
assert.equal(g16c.totalCredit, 1850);
assert.equal(g16c.isBalanced, true);
const v16c = validateJournalGroups([g16c], { rawQuery: q16c });
assert.equal(v16c.isValid, true);

// d) Routing preservation: CPF calculation inquiry must route to PAYROLL_CPF_SALARY
const q16d = "A staff is earning SGD 3,200 a month, he is 32 years old, Singaporean, calculate his CPF and salary";
const p16d = await parseAccountingQuery(q16d, null);
assert.equal(p16d.scenarioType, 'PAYROLL_CPF_SALARY');

// e) Payroll with gross only must not invent CPF amounts in basic template
const q16e = "Record salaries of SGD 5,000 with CPF";
const p16e = await parseAccountingQuery(q16e, null);
assert.notEqual(p16e.scenarioType, 'BASIC_BOOKKEEPING', 'Payroll with unstated CPF breakdown must not match basic bookkeeping');

// 17. Prepaid Recognition & Accrued Settlement:
// a) Stated prepaid rent recognition
const q17a = "Recognise expired prepaid rent of SGD 2,000 for the month.";
const p17a = await parseAccountingQuery(q17a, null);
assert.equal(p17a.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p17a.isComplete, true);
assert.equal(p17a.directGroups?.length, 1);
const g17a = p17a.directGroups[0];
assert.equal(g17a.lines[0].accountName, 'Rent Expense');
assert.equal(g17a.lines[0].category, 'EXPENSE');
assert.equal(g17a.lines[0].debit, 2000);
assert.equal(g17a.lines[1].accountName, 'Prepaid Rent');
assert.equal(g17a.lines[1].category, 'ASSET');
assert.equal(g17a.lines[1].credit, 2000);
assert.equal(g17a.totalDebit, 2000);
assert.equal(g17a.totalCredit, 2000);
assert.equal(g17a.isBalanced, true);
const v17a = validateJournalGroups([g17a], { rawQuery: q17a });
assert.equal(v17a.isValid, true);

// b) Prepaid insurance over multi-period with elapsed duration (exact integer cents)
const q17b = "Prepaid insurance of SGD 12,000 paid for 12 months coverage; 3 months have elapsed. Record the insurance expense.";
const p17b = await parseAccountingQuery(q17b, null);
assert.equal(p17b.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p17b.isComplete, true);
assert.equal(p17b.directGroups?.length, 1);
const g17b = p17b.directGroups[0];
assert.equal(g17b.lines[0].accountName, 'Insurance Expense');
assert.equal(g17b.lines[0].category, 'EXPENSE');
assert.equal(g17b.lines[0].debit, 3000);
assert.ok(g17b.lines[1].accountName === 'Prepaid Insurance' || g17b.lines[1].accountName === 'Prepaid Expenses');
assert.equal(g17b.lines[1].category, 'ASSET');
assert.equal(g17b.lines[1].credit, 3000);
assert.equal(g17b.totalDebit, 3000);
assert.equal(g17b.totalCredit, 3000);
assert.equal(g17b.isBalanced, true);
const v17b = validateJournalGroups([g17b], { rawQuery: q17b });
assert.equal(v17b.isValid, true);

// c) Prepaid insurance that does not divide evenly into integer cents fails closed
const q17c = "Prepaid insurance of SGD 10,000 over 3 months; 1 month has elapsed. Record the insurance expense.";
const p17c = await parseAccountingQuery(q17c, null);
assert.equal(p17c.isComplete, false, 'Non-exact division must fail closed');
assert.equal(p17c.directGroups?.length ?? 0, 0);
assert.ok(p17c.missingFields.some(f => f.fieldKey === 'periodCharge'), 'Must request periodCharge prompt');

// d) Settlement of previously accrued expense
const q17d = "Settled previously accrued audit fee of SGD 3,000 by bank transfer.";
const p17d = await parseAccountingQuery(q17d, null);
assert.equal(p17d.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p17d.isComplete, true);
assert.equal(p17d.directGroups?.length, 1);
const g17d = p17d.directGroups[0];
assert.equal(g17d.lines[0].accountName, 'Accrued Expenses');
assert.equal(g17d.lines[0].category, 'LIABILITY');
assert.equal(g17d.lines[0].debit, 3000);
assert.equal(g17d.lines[1].accountName, 'Cash at Bank');
assert.equal(g17d.lines[1].category, 'ASSET');
assert.equal(g17d.lines[1].credit, 3000);
assert.equal(g17d.totalDebit, 3000);
assert.equal(g17d.totalCredit, 3000);
assert.equal(g17d.isBalanced, true);
const v17d = validateJournalGroups([g17d], { rawQuery: q17d });
assert.equal(v17d.isValid, true);

// 18. Depreciation & Amortisation:
// a) Stated periodic depreciation charge on machinery
const q18a = "Record annual depreciation charge on machinery of SGD 8,000.";
const p18a = await parseAccountingQuery(q18a, null);
assert.equal(p18a.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p18a.isComplete, true);
assert.equal(p18a.directGroups?.length, 1);
const g18a = p18a.directGroups[0];
assert.equal(g18a.lines[0].accountName, 'Depreciation Expense');
assert.equal(g18a.lines[0].category, 'EXPENSE');
assert.equal(g18a.lines[0].debit, 8000);
assert.equal(g18a.lines[1].accountName, 'Accumulated Depreciation — Machinery');
assert.equal(g18a.lines[1].category, 'ASSET');
assert.equal(g18a.lines[1].credit, 8000);
assert.equal(g18a.totalDebit, 8000);
assert.equal(g18a.totalCredit, 8000);
assert.equal(g18a.isBalanced, true);
const v18a = validateJournalGroups([g18a], { rawQuery: q18a });
assert.equal(v18a.isValid, true);
assert.ok(!g18a.lines[0].lineExplanation?.includes('No GST has been recorded'), 'Depreciation rationale must not append GST disclaimer');

// b) Straight-line depreciation computation with cost, residual value, and useful life
const q18b = "Equipment costing SGD 50,000 has a residual value of SGD 5,000 and useful life of 5 years. Record annual straight-line depreciation.";
const p18b = await parseAccountingQuery(q18b, null);
assert.equal(p18b.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p18b.isComplete, true);
assert.equal(p18b.directGroups?.length, 1);
const g18b = p18b.directGroups[0];
assert.equal(g18b.lines[0].accountName, 'Depreciation Expense');
assert.equal(g18b.lines[0].category, 'EXPENSE');
assert.equal(g18b.lines[0].debit, 9000);
assert.equal(g18b.lines[1].accountName, 'Accumulated Depreciation — Equipment');
assert.equal(g18b.lines[1].category, 'ASSET');
assert.equal(g18b.lines[1].credit, 9000);
assert.equal(g18b.totalDebit, 9000);
assert.equal(g18b.totalCredit, 9000);
assert.equal(g18b.isBalanced, true);
const v18b = validateJournalGroups([g18b], { rawQuery: q18b });
assert.equal(v18b.isValid, true);

// b-alt) Straight-line depreciation with stated periodic amount
const q18b_stated = "Record straight-line depreciation of SGD 8,000 on machinery for 1 year.";
const p18b_stated = await parseAccountingQuery(q18b_stated, null);
assert.equal(p18b_stated.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p18b_stated.isComplete, true);
assert.equal(p18b_stated.directGroups?.length, 1);
const g18b_stated = p18b_stated.directGroups[0];
assert.equal(g18b_stated.lines[0].accountName, 'Depreciation Expense');
assert.equal(g18b_stated.lines[0].category, 'EXPENSE');
assert.equal(g18b_stated.lines[0].debit, 8000);
assert.equal(g18b_stated.lines[1].accountName, 'Accumulated Depreciation — Machinery');
assert.equal(g18b_stated.lines[1].category, 'ASSET');
assert.equal(g18b_stated.lines[1].credit, 8000);
assert.equal(g18b_stated.totalDebit, 8000);
assert.equal(g18b_stated.totalCredit, 8000);
assert.equal(g18b_stated.isBalanced, true);
const v18b_stated = validateJournalGroups([g18b_stated], { rawQuery: q18b_stated });
assert.equal(v18b_stated.isValid, true);

// c) Reducing-balance depreciation without a rate fails closed
const q18c = "Record reducing-balance depreciation on office equipment of carrying amount SGD 40,000.";
const p18c = await parseAccountingQuery(q18c, null);
assert.equal(p18c.isComplete, false, 'Reducing-balance depreciation without explicit rate must fail closed');
assert.equal(p18c.directGroups?.length ?? 0, 0);
assert.ok(p18c.missingFields.some(f => f.fieldKey === 'periodCharge'));

// d) Intangible asset amortisation
const q18d = "Recognise amortisation of software licence of SGD 2,400 for the period.";
const p18d = await parseAccountingQuery(q18d, null);
assert.equal(p18d.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p18d.isComplete, true);
assert.equal(p18d.directGroups?.length, 1);
const g18d = p18d.directGroups[0];
assert.equal(g18d.lines[0].accountName, 'Amortisation Expense');
assert.equal(g18d.lines[0].category, 'EXPENSE');
assert.equal(g18d.lines[0].debit, 2400);
assert.equal(g18d.lines[1].accountName, 'Accumulated Amortisation — Software');
assert.equal(g18d.lines[1].category, 'ASSET');
assert.equal(g18d.lines[1].credit, 2400);
assert.equal(g18d.totalDebit, 2400);
assert.equal(g18d.totalCredit, 2400);
assert.equal(g18d.isBalanced, true);
const v18d = validateJournalGroups([g18d], { rawQuery: q18d });
assert.equal(v18d.isValid, true);

// e) Routing preservation: PPE acquisition narrative with trade-in and depreciation remains PPE_IAS16
const q18e = "Purchased machinery for SGD 100,000 with trade-in of old machine SGD 20,000 and annual depreciation of 10%";
const p18e = await parseAccountingQuery(q18e, null);
assert.equal(p18e.scenarioType, 'PPE_IAS16');

// 19. Current & Deferred Income Tax:
// a) Current income tax provision with stated amount
const q19a = "Record current income tax provision of SGD 34,000 for the year.";
const p19a = await parseAccountingQuery(q19a, null);
assert.equal(p19a.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p19a.isComplete, true);
assert.equal(p19a.directGroups?.length, 1);
const g19a = p19a.directGroups[0];
assert.equal(g19a.lines[0].accountName, 'Income Tax Expense');
assert.equal(g19a.lines[0].category, 'EXPENSE');
assert.equal(g19a.lines[0].debit, 34000);
assert.equal(g19a.lines[1].accountName, 'Current Tax Payable');
assert.equal(g19a.lines[1].category, 'LIABILITY');
assert.equal(g19a.lines[1].credit, 34000);
assert.equal(g19a.totalDebit, 34000);
assert.equal(g19a.totalCredit, 34000);
assert.equal(g19a.isBalanced, true);
const v19a = validateJournalGroups([g19a], { rawQuery: q19a });
assert.equal(v19a.isValid, true);
assert.ok(!g19a.lines[0].lineExplanation?.includes('No GST has been recorded'), 'Current tax provision rationale must not append GST disclaimer');

// a-multi) Current tax provision with stated tax amount alongside profit before tax
const q19a_multi = "Profit before tax is SGD 200,000; record current income tax provision of SGD 34,000.";
const p19a_multi = await parseAccountingQuery(q19a_multi, null);
assert.equal(p19a_multi.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p19a_multi.isComplete, true);
assert.equal(p19a_multi.directGroups?.length, 1);
const g19a_multi = p19a_multi.directGroups[0];
assert.equal(g19a_multi.lines[0].accountName, 'Income Tax Expense');
assert.equal(g19a_multi.lines[0].category, 'EXPENSE');
assert.equal(g19a_multi.lines[0].debit, 34000);
assert.equal(g19a_multi.lines[1].accountName, 'Current Tax Payable');
assert.equal(g19a_multi.lines[1].category, 'LIABILITY');
assert.equal(g19a_multi.lines[1].credit, 34000);
assert.equal(g19a_multi.totalDebit, 34000);
assert.equal(g19a_multi.totalCredit, 34000);
assert.equal(g19a_multi.isBalanced, true);
const v19a_multi = validateJournalGroups([g19a_multi], { rawQuery: q19a_multi });
assert.equal(v19a_multi.isValid, true);

// b) Payment of current income tax to IRAS
const q19b = "Paid corporate income tax of SGD 34,000 to IRAS by bank transfer.";
const p19b = await parseAccountingQuery(q19b, null);
assert.equal(p19b.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p19b.isComplete, true);
assert.equal(p19b.directGroups?.length, 1);
const g19b = p19b.directGroups[0];
assert.equal(g19b.lines[0].accountName, 'Current Tax Payable');
assert.equal(g19b.lines[0].category, 'LIABILITY');
assert.equal(g19b.lines[0].debit, 34000);
assert.equal(g19b.lines[1].accountName, 'Cash at Bank');
assert.equal(g19b.lines[1].category, 'ASSET');
assert.equal(g19b.lines[1].credit, 34000);
assert.equal(g19b.totalDebit, 34000);
assert.equal(g19b.totalCredit, 34000);
assert.equal(g19b.isBalanced, true);
const v19b = validateJournalGroups([g19b], { rawQuery: q19b });
assert.equal(v19b.isValid, true);

// c) Tax provision on profit without stated tax amount fails closed (tax rate is not assumed or hardcoded)
const q19c = "Profit is SGD 200,000, record the tax provision.";
const p19c = await parseAccountingQuery(q19c, null);
assert.equal(p19c.isComplete, false, 'Tax provision on profit without tax amount must fail closed');
assert.equal(p19c.directGroups?.length ?? 0, 0);
assert.ok(p19c.missingFields.some(f => f.fieldKey === 'taxAmount'));

// d) Increase in deferred tax liability
const q19d = "Recognise an increase in deferred tax liability of SGD 5,000.";
const p19d = await parseAccountingQuery(q19d, null);
assert.equal(p19d.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p19d.isComplete, true);
assert.equal(p19d.directGroups?.length, 1);
const g19d = p19d.directGroups[0];
assert.equal(g19d.lines[0].accountName, 'Income Tax Expense');
assert.equal(g19d.lines[0].category, 'EXPENSE');
assert.equal(g19d.lines[0].debit, 5000);
assert.equal(g19d.lines[1].accountName, 'Deferred Tax Liability');
assert.equal(g19d.lines[1].category, 'LIABILITY');
assert.equal(g19d.lines[1].credit, 5000);
assert.equal(g19d.totalDebit, 5000);
assert.equal(g19d.totalCredit, 5000);
assert.equal(g19d.isBalanced, true);
const v19d = validateJournalGroups([g19d], { rawQuery: q19d });
assert.equal(v19d.isValid, true);

// e) Recognition of deferred tax asset in profit or loss (credits Income Tax Expense)
const q19e = "Recognise deferred tax asset of SGD 3,000 in profit or loss.";
const p19e = await parseAccountingQuery(q19e, null);
assert.equal(p19e.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p19e.isComplete, true);
assert.equal(p19e.directGroups?.length, 1);
const g19e = p19e.directGroups[0];
assert.equal(g19e.lines[0].accountName, 'Deferred Tax Asset');
assert.equal(g19e.lines[0].category, 'ASSET');
assert.equal(g19e.lines[0].debit, 3000);
assert.equal(g19e.lines[1].accountName, 'Income Tax Expense');
assert.equal(g19e.lines[1].category, 'EXPENSE');
assert.equal(g19e.lines[1].credit, 3000);
assert.equal(g19e.totalDebit, 3000);
assert.equal(g19e.totalCredit, 3000);
assert.equal(g19e.isBalanced, true);
const v19e = validateJournalGroups([g19e], { rawQuery: q19e });
assert.equal(v19e.isValid, true);

// f) Routing preservation: DTL from accelerated tax depreciation / capital allowances routes to DEFERRED_TAX_IAS12
const q19f = "Deferred tax liability of SGD 17,000 arising from accelerated tax depreciation / capital allowances";
const p19f = await parseAccountingQuery(q19f, null);
assert.equal(p19f.scenarioType, 'DEFERRED_TAX_IAS12');

// g) Deferred tax on revaluation surplus fails closed on OCI recognition requirement
const q19g = "Recognise deferred tax on revaluation surplus of SGD 50,000.";
const p19g = await parseAccountingQuery(q19g, null);
assert.equal(p19g.isComplete, false, 'Deferred tax on revaluation surplus must fail closed on OCI recognition');
assert.equal(p19g.directGroups?.length ?? 0, 0);
assert.ok(p19g.missingFields.some(f => f.fieldKey === 'deferredTaxRecognitionLocation'));

// 20. Phase 3 Review Corrections (Findings 1–7):

// Finding 1: Prepaid unit variations and elapsed vs coverage isolation
// 1a) Annual prepaid insurance with 3 months elapsed (must NOT treat "for 3 months" as total coverage)
const q20_1a = "Annual prepaid insurance of SGD 12,000; record the insurance expense for 3 months.";
const p20_1a = await parseAccountingQuery(q20_1a, null);
assert.equal(p20_1a.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p20_1a.isComplete, true);
assert.equal(p20_1a.directGroups?.length, 1);
const g20_1a = p20_1a.directGroups[0];
assert.equal(g20_1a.lines[0].accountName, 'Insurance Expense');
assert.equal(g20_1a.lines[0].category, 'EXPENSE');
assert.equal(g20_1a.lines[0].debit, 3000);
assert.equal(g20_1a.lines[1].accountName, 'Prepaid Insurance');
assert.equal(g20_1a.lines[1].category, 'ASSET');
assert.equal(g20_1a.lines[1].credit, 3000);
assert.equal(g20_1a.totalDebit, 3000);
assert.equal(g20_1a.totalCredit, 3000);
assert.equal(g20_1a.isBalanced, true);
const v20_1a = validateJournalGroups([g20_1a], { rawQuery: q20_1a });
assert.equal(v20_1a.isValid, true);

// 1b) Prepaid rent of SGD 24,000 for 1 year with 1 quarter elapsed
const q20_1b = "Prepaid rent of SGD 24,000 paid for 1 year; 1 quarter has elapsed. Record rent expense.";
const p20_1b = await parseAccountingQuery(q20_1b, null);
assert.equal(p20_1b.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p20_1b.isComplete, true);
assert.equal(p20_1b.directGroups?.length, 1);
const g20_1b = p20_1b.directGroups[0];
assert.equal(g20_1b.lines[0].accountName, 'Rent Expense');
assert.equal(g20_1b.lines[0].category, 'EXPENSE');
assert.equal(g20_1b.lines[0].debit, 6000);
assert.equal(g20_1b.lines[1].accountName, 'Prepaid Rent');
assert.equal(g20_1b.lines[1].category, 'ASSET');
assert.equal(g20_1b.lines[1].credit, 6000);
assert.equal(g20_1b.totalDebit, 6000);
assert.equal(g20_1b.totalCredit, 6000);
assert.equal(g20_1b.isBalanced, true);
const v20_1b = validateJournalGroups([g20_1b], { rawQuery: q20_1b });
assert.equal(v20_1b.isValid, true);

// 1c) Semi-annual prepaid insurance of SGD 3,600 with 1 month expired
const q20_1c = "Semi-annual prepaid insurance of SGD 3,600; 1 month has expired. Recognise insurance expense.";
const p20_1c = await parseAccountingQuery(q20_1c, null);
assert.equal(p20_1c.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p20_1c.isComplete, true);
assert.equal(p20_1c.directGroups?.length, 1);
const g20_1c = p20_1c.directGroups[0];
assert.equal(g20_1c.lines[0].accountName, 'Insurance Expense');
assert.equal(g20_1c.lines[0].category, 'EXPENSE');
assert.equal(g20_1c.lines[0].debit, 600);
assert.equal(g20_1c.lines[1].accountName, 'Prepaid Insurance');
assert.equal(g20_1c.lines[1].category, 'ASSET');
assert.equal(g20_1c.lines[1].credit, 600);
assert.equal(g20_1c.totalDebit, 600);
assert.equal(g20_1c.totalCredit, 600);
assert.equal(g20_1c.isBalanced, true);
const v20_1c = validateJournalGroups([g20_1c], { rawQuery: q20_1c });
assert.equal(v20_1c.isValid, true);

// 1d) Incompatible units: 12 months coverage vs 20 days elapsed fails closed
const q20_1d = "Prepaid insurance of SGD 12,000 for 12 months; 20 days have elapsed. Record insurance expense.";
const p20_1d = await parseAccountingQuery(q20_1d, null);
assert.equal(p20_1d.isComplete, false, 'Incompatible units must fail closed');
assert.equal(p20_1d.directGroups?.length ?? 0, 0);
assert.ok(p20_1d.missingFields.some(f => f.fieldKey === 'periodCharge'), 'Must request periodCharge on unit mismatch');

// 1e) Coverage without elapsed period fails closed
const q20_1e = "Annual prepaid insurance of SGD 12,000. Recognise expired prepaid insurance.";
const p20_1e = await parseAccountingQuery(q20_1e, null);
assert.equal(p20_1e.isComplete, false, 'Coverage without elapsed period must fail closed');
assert.equal(p20_1e.directGroups?.length ?? 0, 0);
assert.ok(p20_1e.missingFields.some(f => f.fieldKey === 'periodCharge'), 'Must request periodCharge');

// Finding 2: Payroll accrual vs salary already paid
// 2a) Paid monthly salaries by bank transfer (Cash at Bank asset, not Salaries Payable liability)
const q20_2a = "Paid monthly salaries by bank transfer: gross salaries SGD 5,000, employee CPF SGD 1,000, employer CPF SGD 850.";
const p20_2a = await parseAccountingQuery(q20_2a, null);
assert.equal(p20_2a.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p20_2a.isComplete, true);
assert.equal(p20_2a.directGroups?.length, 1);
const g20_2a = p20_2a.directGroups[0];
assert.equal(g20_2a.lines.length, 4);
assert.equal(g20_2a.lines[0].accountName, 'Salaries and Wages Expense');
assert.equal(g20_2a.lines[0].category, 'EXPENSE');
assert.equal(g20_2a.lines[0].debit, 5000);
assert.equal(g20_2a.lines[1].accountName, 'Employer CPF Contribution Expense');
assert.equal(g20_2a.lines[1].category, 'EXPENSE');
assert.equal(g20_2a.lines[1].debit, 850);
assert.equal(g20_2a.lines[2].accountName, 'Cash at Bank');
assert.equal(g20_2a.lines[2].category, 'ASSET');
assert.equal(g20_2a.lines[2].credit, 4000);
assert.equal(g20_2a.lines[3].accountName, 'CPF Payable');
assert.equal(g20_2a.lines[3].category, 'LIABILITY');
assert.equal(g20_2a.lines[3].credit, 1850);
assert.equal(g20_2a.totalDebit, 5850);
assert.equal(g20_2a.totalCredit, 5850);
assert.equal(g20_2a.isBalanced, true);
const v20_2a = validateJournalGroups([g20_2a], { rawQuery: q20_2a });
assert.equal(v20_2a.isValid, true);

// 2b) Paid monthly salaries in cash
const q20_2b = "Paid monthly salaries in cash: gross salary SGD 3,000, employee CPF SGD 600, employer CPF SGD 510.";
const p20_2b = await parseAccountingQuery(q20_2b, null);
assert.equal(p20_2b.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p20_2b.isComplete, true);
assert.equal(p20_2b.directGroups?.length, 1);
const g20_2b = p20_2b.directGroups[0];
assert.equal(g20_2b.lines[2].accountName, 'Cash');
assert.equal(g20_2b.lines[2].category, 'ASSET');
assert.equal(g20_2b.lines[2].credit, 2400);
assert.equal(g20_2b.lines[3].accountName, 'CPF Payable');
assert.equal(g20_2b.lines[3].credit, 1110);
assert.equal(g20_2b.totalDebit, 3510);
assert.equal(g20_2b.totalCredit, 3510);
assert.equal(g20_2b.isBalanced, true);
const v20_2b = validateJournalGroups([g20_2b], { rawQuery: q20_2b });
assert.equal(v20_2b.isValid, true);

// 2c) Paid monthly salaries without payment method fails closed and follow-up resolves
const q20_2c = "Paid monthly salaries: gross salaries SGD 5,000, employee CPF SGD 1,000, employer CPF SGD 850.";
const p20_2c = await parseAccountingQuery(q20_2c, null);
assert.equal(p20_2c.isComplete, false, 'Paid salaries without payment method must fail closed');
assert.equal(p20_2c.directGroups?.length ?? 0, 0);
assert.ok(p20_2c.missingFields.some(f => f.fieldKey === 'salaryPaymentMethod'), 'Must request salaryPaymentMethod');
const p20_2c_resolved = await parseAccountingQuery("by bank transfer", p20_2c);
assert.equal(p20_2c_resolved.isComplete, true);
assert.equal(p20_2c_resolved.directGroups?.length, 1);
const g20_2c_res = p20_2c_resolved.directGroups[0];
assert.equal(g20_2c_res.lines[2].accountName, 'Cash at Bank');
assert.equal(g20_2c_res.lines[2].credit, 4000);
assert.equal(g20_2c_res.lines[3].accountName, 'CPF Payable');
assert.equal(g20_2c_res.lines[3].credit, 1850);
assert.equal(g20_2c_res.totalDebit, 5850);
assert.equal(g20_2c_res.totalCredit, 5850);
assert.equal(g20_2c_res.isBalanced, true);

// 2d) Non-CPF direct salary accrual vs payment
const q20_2d_accrual = "Accrued monthly salaries of SGD 4,000 at month-end.";
const p20_2d_accrual = await parseAccountingQuery(q20_2d_accrual, null);
assert.equal(p20_2d_accrual.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p20_2d_accrual.isComplete, true);
const g20_2d_acc = p20_2d_accrual.directGroups[0];
assert.equal(g20_2d_acc.lines[0].accountName, 'Salaries and Wages Expense');
assert.equal(g20_2d_acc.lines[0].category, 'EXPENSE');
assert.equal(g20_2d_acc.lines[0].debit, 4000);
assert.equal(g20_2d_acc.lines[1].accountName, 'Salaries Payable');
assert.equal(g20_2d_acc.lines[1].category, 'LIABILITY');
assert.equal(g20_2d_acc.lines[1].credit, 4000);
assert.equal(g20_2d_acc.isBalanced, true);

const q20_2d_paid = "Paid casual wages of SGD 1,200 in cash.";
const p20_2d_paid = await parseAccountingQuery(q20_2d_paid, null);
assert.equal(p20_2d_paid.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p20_2d_paid.isComplete, true);
const g20_2d_paid = p20_2d_paid.directGroups[0];
assert.equal(g20_2d_paid.lines[0].accountName, 'Salaries and Wages Expense');
assert.equal(g20_2d_paid.lines[0].debit, 1200);
assert.equal(g20_2d_paid.lines[1].accountName, 'Cash');
assert.equal(g20_2d_paid.lines[1].category, 'ASSET');
assert.equal(g20_2d_paid.lines[1].credit, 1200);
assert.equal(g20_2d_paid.isBalanced, true);

// Finding 3: Asset cost / carrying amount not mistaken for depreciation or amortisation charge
const q20_3a = "Record annual depreciation on machinery costing SGD 50,000.";
const p20_3a = await parseAccountingQuery(q20_3a, null);
assert.equal(p20_3a.isComplete, false, 'Machinery cost must not be posted as depreciation charge');
assert.equal(p20_3a.directGroups?.length ?? 0, 0);
assert.ok(p20_3a.missingFields.some(f => f.fieldKey === 'periodCharge'));

const q20_3b = "Record annual depreciation on office equipment with carrying amount of SGD 40,000.";
const p20_3b = await parseAccountingQuery(q20_3b, null);
assert.equal(p20_3b.isComplete, false, 'Carrying amount must not be posted as depreciation charge');
assert.equal(p20_3b.directGroups?.length ?? 0, 0);
assert.ok(p20_3b.missingFields.some(f => f.fieldKey === 'periodCharge'));

const q20_3c = "Record depreciation on machinery (cost: SGD 50,000).";
const p20_3c = await parseAccountingQuery(q20_3c, null);
assert.equal(p20_3c.isComplete, false, 'Cost in parens must not be posted as depreciation charge');
assert.equal(p20_3c.directGroups?.length ?? 0, 0);
assert.ok(p20_3c.missingFields.some(f => f.fieldKey === 'periodCharge'));

const q20_3d = "Record depreciation on machinery of SGD 50,000.";
const p20_3d = await parseAccountingQuery(q20_3d, null);
assert.equal(p20_3d.isComplete, false, 'Machinery of SGD 50,000 must not be posted as depreciation charge');
assert.equal(p20_3d.directGroups?.length ?? 0, 0);
assert.ok(p20_3d.missingFields.some(f => f.fieldKey === 'periodCharge'));

const q20_3e = "Record amortisation on software licence valued at SGD 24,000.";
const p20_3e = await parseAccountingQuery(q20_3e, null);
assert.equal(p20_3e.isComplete, false, 'Valuation of software licence must not be posted as amortisation charge');
assert.equal(p20_3e.directGroups?.length ?? 0, 0);
assert.ok(p20_3e.missingFields.some(f => f.fieldKey === 'periodCharge'));

// Finding 4: Ambiguous deferred tax movement direction
const q20_4a = "Record deferred tax liability movement of SGD 5,000.";
const p20_4a = await parseAccountingQuery(q20_4a, null);
assert.equal(p20_4a.isComplete, false, 'Ambiguous DTL movement direction must fail closed');
assert.equal(p20_4a.directGroups?.length ?? 0, 0);
assert.ok(p20_4a.missingFields.some(f => f.fieldKey === 'deferredTaxDirection'));
const p20_4a_resolved = await parseAccountingQuery("decrease", p20_4a);
assert.equal(p20_4a_resolved.isComplete, true);
assert.equal(p20_4a_resolved.directGroups?.length, 1);
const g20_4a_res = p20_4a_resolved.directGroups[0];
assert.equal(g20_4a_res.lines[0].accountName, 'Deferred Tax Liability');
assert.equal(g20_4a_res.lines[0].category, 'LIABILITY');
assert.equal(g20_4a_res.lines[0].debit, 5000);
assert.equal(g20_4a_res.lines[1].accountName, 'Income Tax Expense');
assert.equal(g20_4a_res.lines[1].category, 'EXPENSE');
assert.equal(g20_4a_res.lines[1].credit, 5000);
assert.equal(g20_4a_res.isBalanced, true);

const q20_4b = "Post year-end deferred tax asset adjustment of SGD 3,000.";
const p20_4b = await parseAccountingQuery(q20_4b, null);
assert.equal(p20_4b.isComplete, false, 'Ambiguous DTA adjustment direction must fail closed');
assert.equal(p20_4b.directGroups?.length ?? 0, 0);
assert.ok(p20_4b.missingFields.some(f => f.fieldKey === 'deferredTaxDirection'));

const q20_4c = "Record a reversal of deferred tax liability of SGD 2,000.";
const p20_4c = await parseAccountingQuery(q20_4c, null);
assert.equal(p20_4c.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p20_4c.isComplete, true);
assert.equal(p20_4c.directGroups?.length, 1);
const g20_4c = p20_4c.directGroups[0];
assert.equal(g20_4c.lines[0].accountName, 'Deferred Tax Liability');
assert.equal(g20_4c.lines[0].debit, 2000);
assert.equal(g20_4c.lines[1].accountName, 'Income Tax Expense');
assert.equal(g20_4c.lines[1].credit, 2000);
assert.equal(g20_4c.isBalanced, true);

// Finding 5: Unspecified IRAS payment
const q20_5a = "Paid SGD 10,000 to IRAS by bank transfer.";
const p20_5a = await parseAccountingQuery(q20_5a, null);
assert.equal(p20_5a.isComplete, false, 'Unspecified tax payment to IRAS must fail closed on taxType');
assert.equal(p20_5a.directGroups?.length ?? 0, 0);
assert.ok(p20_5a.missingFields.some(f => f.fieldKey === 'taxType'), 'Must request taxType');
const p20_5a_resolved = await parseAccountingQuery("corporate income tax", p20_5a);
assert.equal(p20_5a_resolved.isComplete, true);
assert.equal(p20_5a_resolved.directGroups?.length, 1);
const g20_5a_res = p20_5a_resolved.directGroups[0];
assert.equal(g20_5a_res.lines[0].accountName, 'Current Tax Payable');
assert.equal(g20_5a_res.lines[0].category, 'LIABILITY');
assert.equal(g20_5a_res.lines[0].debit, 10000);
assert.equal(g20_5a_res.lines[1].accountName, 'Cash at Bank');
assert.equal(g20_5a_res.lines[1].category, 'ASSET');
assert.equal(g20_5a_res.lines[1].credit, 10000);
assert.equal(g20_5a_res.isBalanced, true);

const q20_5b = "Settled tax payable of SGD 8,500 to IRAS by bank transfer.";
const p20_5b = await parseAccountingQuery(q20_5b, null);
assert.equal(p20_5b.isComplete, false, 'Generic tax payable settlement to IRAS must fail closed on taxType');
assert.equal(p20_5b.directGroups?.length ?? 0, 0);
assert.ok(p20_5b.missingFields.some(f => f.fieldKey === 'taxType'));

// Finding 6: Deterministic follow-up resolution for periodCharge and taxAmount
// 6a) Follow-up on p17c (non-exact prepaid division) with stated charge
const p20_6a_resolved = await parseAccountingQuery("SGD 3,333.33", p17c);
assert.equal(p20_6a_resolved.isComplete, true);
assert.equal(p20_6a_resolved.directGroups?.length, 1);
const g20_6a_res = p20_6a_resolved.directGroups[0];
assert.equal(g20_6a_res.lines[0].accountName, 'Insurance Expense');
assert.equal(g20_6a_res.lines[0].debit, 3333.33);
assert.equal(g20_6a_res.lines[1].accountName, 'Prepaid Insurance');
assert.equal(g20_6a_res.lines[1].credit, 3333.33);
assert.equal(g20_6a_res.totalDebit, 3333.33);
assert.equal(g20_6a_res.totalCredit, 3333.33);
assert.equal(g20_6a_res.isBalanced, true);
const v20_6a = validateJournalGroups([g20_6a_res], { rawQuery: p20_6a_resolved.rawQuery });
assert.equal(v20_6a.isValid, true);

// 6b) Follow-up on p18c (reducing-balance carrying amount) with stated charge
const p20_6b_resolved = await parseAccountingQuery("SGD 8,000", p18c);
assert.equal(p20_6b_resolved.isComplete, true);
assert.equal(p20_6b_resolved.directGroups?.length, 1);
const g20_6b_res = p20_6b_resolved.directGroups[0];
assert.equal(g20_6b_res.lines[0].accountName, 'Depreciation Expense');
assert.equal(g20_6b_res.lines[0].debit, 8000);
assert.equal(g20_6b_res.lines[1].accountName, 'Accumulated Depreciation — Office Equipment');
assert.equal(g20_6b_res.lines[1].credit, 8000);
assert.equal(g20_6b_res.totalDebit, 8000);
assert.equal(g20_6b_res.totalCredit, 8000);
assert.equal(g20_6b_res.isBalanced, true);

// 6c) Follow-up on p19c (profit without tax amount) with stated current tax amount
const p20_6c_resolved = await parseAccountingQuery("SGD 34,000", p19c);
assert.equal(p20_6c_resolved.isComplete, true);
assert.equal(p20_6c_resolved.directGroups?.length, 1);
const g20_6c_res = p20_6c_resolved.directGroups[0];
assert.equal(g20_6c_res.lines[0].accountName, 'Income Tax Expense');
assert.equal(g20_6c_res.lines[0].debit, 34000);
assert.equal(g20_6c_res.lines[1].accountName, 'Current Tax Payable');
assert.equal(g20_6c_res.lines[1].credit, 34000);
assert.equal(g20_6c_res.totalDebit, 34000);
assert.equal(g20_6c_res.totalCredit, 34000);
assert.equal(g20_6c_res.isBalanced, true);

// 6d) Follow-up on deferred tax with percentage rate but without stated tax amount
const q20_6d = "Recognise an increase in deferred tax liability at 17% on SGD 100,000.";
const p20_6d = await parseAccountingQuery(q20_6d, null);
assert.equal(p20_6d.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p20_6d.isComplete, false, 'Percentage rate without stated tax amount must fail closed');
assert.equal(p20_6d.directGroups?.length ?? 0, 0);
assert.ok(p20_6d.missingFields.some(f => f.fieldKey === 'taxAmount'), 'Must request taxAmount');
const p20_6d_resolved = await parseAccountingQuery("SGD 17,000", p20_6d);
assert.equal(p20_6d_resolved.isComplete, true);
assert.equal(p20_6d_resolved.directGroups?.length, 1);
const g20_6d_res = p20_6d_resolved.directGroups[0];
assert.equal(g20_6d_res.lines[0].accountName, 'Income Tax Expense');
assert.equal(g20_6d_res.lines[0].debit, 17000);
assert.equal(g20_6d_res.lines[1].accountName, 'Deferred Tax Liability');
assert.equal(g20_6d_res.lines[1].credit, 17000);
assert.equal(g20_6d_res.totalDebit, 17000);
assert.equal(g20_6d_res.totalCredit, 17000);
assert.equal(g20_6d_res.isBalanced, true);

// Finding 7: Accrued expense settlement payment methods & reducing-balance with stated charge
// 7a) Accrued expense settlement without payment method fails closed, resolves with cash or cheque
const q20_7a = "Settled previously accrued audit fee of SGD 3,000.";
const p20_7a = await parseAccountingQuery(q20_7a, null);
assert.equal(p20_7a.isComplete, false, 'Accrued expense settlement without cash vs bank must fail closed');
assert.equal(p20_7a.directGroups?.length ?? 0, 0);
assert.ok(p20_7a.missingFields.some(f => f.fieldKey === 'paymentMethod'), 'Must request paymentMethod');
const p20_7a_cash = await parseAccountingQuery("in cash", p20_7a);
assert.equal(p20_7a_cash.isComplete, true);
const g20_7a_cash = p20_7a_cash.directGroups[0];
assert.equal(g20_7a_cash.lines[0].accountName, 'Accrued Expenses');
assert.equal(g20_7a_cash.lines[0].debit, 3000);
assert.equal(g20_7a_cash.lines[1].accountName, 'Cash');
assert.equal(g20_7a_cash.lines[1].category, 'ASSET');
assert.equal(g20_7a_cash.lines[1].credit, 3000);
assert.equal(g20_7a_cash.isBalanced, true);

const q20_7a_cheque = "Settled previously accrued audit fee of SGD 3,000 by cheque.";
const p20_7a_cheque = await parseAccountingQuery(q20_7a_cheque, null);
assert.equal(p20_7a_cheque.isComplete, true);
const g20_7a_cheque = p20_7a_cheque.directGroups[0];
assert.equal(g20_7a_cheque.lines[0].accountName, 'Accrued Expenses');
assert.equal(g20_7a_cheque.lines[0].debit, 3000);
assert.equal(g20_7a_cheque.lines[1].accountName, 'Cash at Bank');
assert.equal(g20_7a_cheque.lines[1].category, 'ASSET');
assert.equal(g20_7a_cheque.lines[1].credit, 3000);
assert.equal(g20_7a_cheque.isBalanced, true);

// 7b) Reducing-balance depreciation with explicit stated periodic charge
const q20_7b = "Record reducing-balance depreciation charge of SGD 6,000 on motor vehicles for the year.";
const p20_7b = await parseAccountingQuery(q20_7b, null);
assert.equal(p20_7b.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p20_7b.isComplete, true);
assert.equal(p20_7b.directGroups?.length, 1);
const g20_7b = p20_7b.directGroups[0];
assert.equal(g20_7b.lines[0].accountName, 'Depreciation Expense');
assert.equal(g20_7b.lines[0].category, 'EXPENSE');
assert.equal(g20_7b.lines[0].debit, 6000);
assert.equal(g20_7b.lines[1].accountName, 'Accumulated Depreciation — Motor Vehicles');
assert.equal(g20_7b.lines[1].category, 'ASSET');
assert.equal(g20_7b.lines[1].credit, 6000);
assert.equal(g20_7b.totalDebit, 6000);
assert.equal(g20_7b.totalCredit, 6000);
assert.equal(g20_7b.isBalanced, true);
const v20_7b = validateJournalGroups([g20_7b], { rawQuery: q20_7b });
assert.equal(v20_7b.isValid, true);

// Post-review defect regression checks:
// 1) Depreciation on acquired asset must not route to equipment acquisition
const q20_post1 = "Record depreciation on machinery acquired for SGD 50,000.";
const p20_post1 = await parseAccountingQuery(q20_post1, null);
assert.equal(p20_post1.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p20_post1.isComplete, false, 'Acquisition cost must not be posted as depreciation charge');
assert.equal(p20_post1.directGroups?.length ?? 0, 0);
assert.ok(p20_post1.missingFields.some(f => f.fieldKey === 'periodCharge'), 'Must request periodCharge');

// 2) Elapsed time "2 years ago" must not be treated as a 2-year useful life
const q20_post2 = "Record annual depreciation on equipment purchased 2 years ago for SGD 40,000.";
const p20_post2 = await parseAccountingQuery(q20_post2, null);
assert.equal(p20_post2.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p20_post2.isComplete, false, 'Elapsed acquisition time must not be treated as useful life');
assert.equal(p20_post2.directGroups?.length ?? 0, 0);
assert.ok(p20_post2.missingFields.some(f => f.fieldKey === 'periodCharge'), 'Must request periodCharge');

// 3) Amortisation on acquired software asset
const q20_post3 = "Record amortisation on software acquired for SGD 20,000.";
const p20_post3 = await parseAccountingQuery(q20_post3, null);
assert.equal(p20_post3.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p20_post3.isComplete, false, 'Acquisition cost of software must not be posted as amortisation charge');
assert.equal(p20_post3.directGroups?.length ?? 0, 0);
assert.ok(p20_post3.missingFields.some(f => f.fieldKey === 'periodCharge'), 'Must request periodCharge');

// 4) Recognise a decrease in DTL
const q20_post4 = "Recognise a decrease in deferred tax liability of SGD 5,000.";
const p20_post4 = await parseAccountingQuery(q20_post4, null);
assert.equal(p20_post4.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p20_post4.isComplete, true);
assert.equal(p20_post4.directGroups?.length, 1);
const g20_post4 = p20_post4.directGroups[0];
assert.equal(g20_post4.lines[0].accountName, 'Deferred Tax Liability');
assert.equal(g20_post4.lines[0].category, 'LIABILITY');
assert.equal(g20_post4.lines[0].debit, 5000);
assert.equal(g20_post4.lines[1].accountName, 'Income Tax Expense');
assert.equal(g20_post4.lines[1].category, 'EXPENSE');
assert.equal(g20_post4.lines[1].credit, 5000);
assert.equal(g20_post4.totalDebit, 5000);
assert.equal(g20_post4.totalCredit, 5000);
assert.equal(g20_post4.isBalanced, true);

// 21. PR #26 Hold-Merge Review Findings (Issues 1–3):
// Issue 1: Prepaid expense overstatement when total coverage period is missing
// 1a) Prepaid insurance with elapsed period but unstated total coverage period must fail closed
const q21_1a = "Prepaid insurance of S$12,000; 3 months have elapsed. Record insurance expense.";
const p21_1a = await parseAccountingQuery(q21_1a, null);
assert.equal(p21_1a.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p21_1a.isComplete, false, 'Prepaid balance with elapsed duration but missing coverage must fail closed');
assert.equal(p21_1a.directGroups?.length ?? 0, 0);
assert.ok(p21_1a.missingFields.some(f => f.fieldKey === 'periodCharge'), 'Must request periodCharge');

// Follow-up A: User provides coverage period ("12 months")
const p21_1a_folA = await parseAccountingQuery("12 months", p21_1a);
assert.equal(p21_1a_folA.isComplete, true, 'Coverage follow-up must complete scenario');
assert.equal(p21_1a_folA.directGroups?.length, 1);
const g21_1a_folA = p21_1a_folA.directGroups[0];
assert.equal(g21_1a_folA.lines[0].accountName, 'Insurance Expense');
assert.equal(g21_1a_folA.lines[0].category, 'EXPENSE');
assert.equal(g21_1a_folA.lines[0].debit, 3000);
assert.equal(g21_1a_folA.lines[1].accountName, 'Prepaid Insurance');
assert.equal(g21_1a_folA.lines[1].category, 'ASSET');
assert.equal(g21_1a_folA.lines[1].credit, 3000);
assert.equal(g21_1a_folA.totalDebit, 3000);
assert.equal(g21_1a_folA.totalCredit, 3000);
assert.equal(g21_1a_folA.isBalanced, true);
const v21_1a_folA = validateJournalGroups([g21_1a_folA], { rawQuery: p21_1a_folA.rawQuery });
assert.equal(v21_1a_folA.isValid, true);

// Follow-up B: User provides exact expired amount ("S$3,000")
const p21_1a_folB = await parseAccountingQuery("S$3,000", p21_1a);
assert.equal(p21_1a_folB.isComplete, true, 'Explicit SGD period charge follow-up must complete scenario');
assert.equal(p21_1a_folB.directGroups?.length, 1);
const g21_1a_folB = p21_1a_folB.directGroups[0];
assert.equal(g21_1a_folB.lines[0].accountName, 'Insurance Expense');
assert.equal(g21_1a_folB.lines[0].category, 'EXPENSE');
assert.equal(g21_1a_folB.lines[0].debit, 3000);
assert.equal(g21_1a_folB.lines[1].accountName, 'Prepaid Insurance');
assert.equal(g21_1a_folB.lines[1].category, 'ASSET');
assert.equal(g21_1a_folB.lines[1].credit, 3000);
assert.equal(g21_1a_folB.totalDebit, 3000);
assert.equal(g21_1a_folB.totalCredit, 3000);
assert.equal(g21_1a_folB.isBalanced, true);
const v21_1a_folB = validateJournalGroups([g21_1a_folB], { rawQuery: p21_1a_folB.rawQuery });
assert.equal(v21_1a_folB.isValid, true);

// Follow-up C: User provides coverage period ("annual")
const p21_1a_folC = await parseAccountingQuery("annual", p21_1a);
assert.equal(p21_1a_folC.isComplete, true, '"annual" coverage follow-up must complete scenario');
assert.equal(p21_1a_folC.directGroups?.length, 1);
const g21_1a_folC = p21_1a_folC.directGroups[0];
assert.equal(g21_1a_folC.lines[0].accountName, 'Insurance Expense');
assert.equal(g21_1a_folC.lines[0].debit, 3000);
assert.equal(g21_1a_folC.lines[1].accountName, 'Prepaid Insurance');
assert.equal(g21_1a_folC.lines[1].credit, 3000);
assert.equal(g21_1a_folC.isBalanced, true);
const v21_1a_folC = validateJournalGroups([g21_1a_folC], { rawQuery: p21_1a_folC.rawQuery });
assert.equal(v21_1a_folC.isValid, true);

// Follow-up D: User provides coverage period ("1 year")
const p21_1a_folD = await parseAccountingQuery("1 year", p21_1a);
assert.equal(p21_1a_folD.isComplete, true, '"1 year" coverage follow-up must complete scenario');
assert.equal(p21_1a_folD.directGroups?.length, 1);
const g21_1a_folD = p21_1a_folD.directGroups[0];
assert.equal(g21_1a_folD.lines[0].accountName, 'Insurance Expense');
assert.equal(g21_1a_folD.lines[0].debit, 3000);
assert.equal(g21_1a_folD.lines[1].accountName, 'Prepaid Insurance');
assert.equal(g21_1a_folD.lines[1].credit, 3000);
assert.equal(g21_1a_folD.isBalanced, true);
const v21_1a_folD = validateJournalGroups([g21_1a_folD], { rawQuery: p21_1a_folD.rawQuery });
assert.equal(v21_1a_folD.isValid, true);

// 1b) Unqualified prepaid balance without coverage or elapsed fails closed
const q21_1b = "Prepaid insurance of S$12,000. Recognise expired insurance.";
const p21_1b = await parseAccountingQuery(q21_1b, null);
assert.equal(p21_1b.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p21_1b.isComplete, false, 'Unqualified prepaid balance without durations must fail closed');
assert.equal(p21_1b.directGroups?.length ?? 0, 0);
assert.ok(p21_1b.missingFields.some(f => f.fieldKey === 'periodCharge'), 'Must request periodCharge');

// 1c) Explicit expired amount completes directly
const q21_1c = "SGD 2,500 of prepaid insurance has expired. Record insurance expense.";
const p21_1c = await parseAccountingQuery(q21_1c, null);
assert.equal(p21_1c.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p21_1c.isComplete, true);
assert.equal(p21_1c.directGroups?.length, 1);
const g21_1c = p21_1c.directGroups[0];
assert.equal(g21_1c.lines[0].accountName, 'Insurance Expense');
assert.equal(g21_1c.lines[0].category, 'EXPENSE');
assert.equal(g21_1c.lines[0].debit, 2500);
assert.equal(g21_1c.lines[1].accountName, 'Prepaid Insurance');
assert.equal(g21_1c.lines[1].category, 'ASSET');
assert.equal(g21_1c.lines[1].credit, 2500);
assert.equal(g21_1c.totalDebit, 2500);
assert.equal(g21_1c.totalCredit, 2500);
assert.equal(g21_1c.isBalanced, true);
const v21_1c = validateJournalGroups([g21_1c], { rawQuery: q21_1c });
assert.equal(v21_1c.isValid, true);

// Issue 2: Separate Salary Settlement and CPF Settlement Status Tracking
// 2a) Example A: Salaries paid by bank, CPF remains unpaid
const q21_2a = "Paid monthly salaries by bank: gross salaries S$5,000, employee CPF S$1,000, employer CPF S$850; CPF remains unpaid.";
const p21_2a = await parseAccountingQuery(q21_2a, null);
assert.equal(p21_2a.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p21_2a.isComplete, true);
assert.equal(p21_2a.directGroups?.length, 1);
const g21_2a = p21_2a.directGroups[0];
assert.equal(g21_2a.lines.length, 4);
assert.equal(g21_2a.lines[0].accountName, 'Salaries and Wages Expense');
assert.equal(g21_2a.lines[0].category, 'EXPENSE');
assert.equal(g21_2a.lines[0].debit, 5000);
assert.equal(g21_2a.lines[1].accountName, 'Employer CPF Contribution Expense');
assert.equal(g21_2a.lines[1].category, 'EXPENSE');
assert.equal(g21_2a.lines[1].debit, 850);
assert.equal(g21_2a.lines[2].accountName, 'Cash at Bank');
assert.equal(g21_2a.lines[2].category, 'ASSET');
assert.equal(g21_2a.lines[2].credit, 4000);
assert.equal(g21_2a.lines[3].accountName, 'CPF Payable');
assert.equal(g21_2a.lines[3].category, 'LIABILITY');
assert.equal(g21_2a.lines[3].credit, 1850);
assert.equal(g21_2a.totalDebit, 5850);
assert.equal(g21_2a.totalCredit, 5850);
assert.equal(g21_2a.isBalanced, true);
const v21_2a = validateJournalGroups([g21_2a], { rawQuery: q21_2a });
assert.equal(v21_2a.isValid, true);

// 2b) Example B: CPF paid by bank, net salaries still outstanding
const q21_2b = "Monthly payroll: gross salaries S$5,000, employee CPF S$1,000, employer CPF S$850; CPF paid by bank, net salaries still outstanding.";
const p21_2b = await parseAccountingQuery(q21_2b, null);
assert.equal(p21_2b.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p21_2b.isComplete, true);
assert.equal(p21_2b.directGroups?.length, 1);
const g21_2b = p21_2b.directGroups[0];
assert.equal(g21_2b.lines.length, 4);
assert.equal(g21_2b.lines[0].accountName, 'Salaries and Wages Expense');
assert.equal(g21_2b.lines[0].category, 'EXPENSE');
assert.equal(g21_2b.lines[0].debit, 5000);
assert.equal(g21_2b.lines[1].accountName, 'Employer CPF Contribution Expense');
assert.equal(g21_2b.lines[1].category, 'EXPENSE');
assert.equal(g21_2b.lines[1].debit, 850);
assert.equal(g21_2b.lines[2].accountName, 'Salaries Payable');
assert.equal(g21_2b.lines[2].category, 'LIABILITY');
assert.equal(g21_2b.lines[2].credit, 4000);
assert.equal(g21_2b.lines[3].accountName, 'Cash at Bank');
assert.equal(g21_2b.lines[3].category, 'ASSET');
assert.equal(g21_2b.lines[3].credit, 1850);
assert.equal(g21_2b.totalDebit, 5850);
assert.equal(g21_2b.totalCredit, 5850);
assert.equal(g21_2b.isBalanced, true);
const v21_2b = validateJournalGroups([g21_2b], { rawQuery: q21_2b });
assert.equal(v21_2b.isValid, true);

// 2c) Both paid by bank
const q21_2c = "Paid both salaries and CPF by bank: gross salaries S$5,000, employee CPF S$1,000, employer CPF S$850.";
const p21_2c = await parseAccountingQuery(q21_2c, null);
assert.equal(p21_2c.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p21_2c.isComplete, true);
assert.equal(p21_2c.directGroups?.length, 1);
const g21_2c = p21_2c.directGroups[0];
assert.equal(g21_2c.lines.length, 3);
assert.equal(g21_2c.lines[0].accountName, 'Salaries and Wages Expense');
assert.equal(g21_2c.lines[0].category, 'EXPENSE');
assert.equal(g21_2c.lines[0].debit, 5000);
assert.equal(g21_2c.lines[1].accountName, 'Employer CPF Contribution Expense');
assert.equal(g21_2c.lines[1].category, 'EXPENSE');
assert.equal(g21_2c.lines[1].debit, 850);
assert.equal(g21_2c.lines[2].accountName, 'Cash at Bank');
assert.equal(g21_2c.lines[2].category, 'ASSET');
assert.equal(g21_2c.lines[2].credit, 5850);
assert.equal(g21_2c.totalDebit, 5850);
assert.equal(g21_2c.totalCredit, 5850);
assert.equal(g21_2c.isBalanced, true);
const v21_2c = validateJournalGroups([g21_2c], { rawQuery: q21_2c });
assert.equal(v21_2c.isValid, true);

// 2d) Mixed payment methods: cash salaries, bank CPF
const q21_2d = "Monthly payroll: gross salaries S$5,000, employee CPF S$1,000, employer CPF S$850; salaries paid in cash, CPF paid by bank.";
const p21_2d = await parseAccountingQuery(q21_2d, null);
assert.equal(p21_2d.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p21_2d.isComplete, true);
assert.equal(p21_2d.directGroups?.length, 1);
const g21_2d = p21_2d.directGroups[0];
assert.equal(g21_2d.lines.length, 4);
assert.equal(g21_2d.lines[0].accountName, 'Salaries and Wages Expense');
assert.equal(g21_2d.lines[0].category, 'EXPENSE');
assert.equal(g21_2d.lines[0].debit, 5000);
assert.equal(g21_2d.lines[1].accountName, 'Employer CPF Contribution Expense');
assert.equal(g21_2d.lines[1].category, 'EXPENSE');
assert.equal(g21_2d.lines[1].debit, 850);
assert.equal(g21_2d.lines[2].accountName, 'Cash');
assert.equal(g21_2d.lines[2].category, 'ASSET');
assert.equal(g21_2d.lines[2].credit, 4000);
assert.equal(g21_2d.lines[3].accountName, 'Cash at Bank');
assert.equal(g21_2d.lines[3].category, 'ASSET');
assert.equal(g21_2d.lines[3].credit, 1850);
assert.equal(g21_2d.totalDebit, 5850);
assert.equal(g21_2d.totalCredit, 5850);
assert.equal(g21_2d.isBalanced, true);
const v21_2d = validateJournalGroups([g21_2d], { rawQuery: q21_2d });
assert.equal(v21_2d.isValid, true);

// 2e) 4-amount payroll with total CPF
const q21_2e = "Monthly payroll: gross salaries S$5,000, employee CPF S$1,000, employer CPF S$850; CPF of S$1,850 paid by bank, net salaries still outstanding.";
const p21_2e = await parseAccountingQuery(q21_2e, null);
assert.equal(p21_2e.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p21_2e.isComplete, true);
assert.equal(p21_2e.directGroups?.length, 1);
const g21_2e = p21_2e.directGroups[0];
assert.equal(g21_2e.lines.length, 4);
assert.equal(g21_2e.lines[0].accountName, 'Salaries and Wages Expense');
assert.equal(g21_2e.lines[0].category, 'EXPENSE');
assert.equal(g21_2e.lines[0].debit, 5000);
assert.equal(g21_2e.lines[1].accountName, 'Employer CPF Contribution Expense');
assert.equal(g21_2e.lines[1].category, 'EXPENSE');
assert.equal(g21_2e.lines[1].debit, 850);
assert.equal(g21_2e.lines[2].accountName, 'Salaries Payable');
assert.equal(g21_2e.lines[2].category, 'LIABILITY');
assert.equal(g21_2e.lines[2].credit, 4000);
assert.equal(g21_2e.lines[3].accountName, 'Cash at Bank');
assert.equal(g21_2e.lines[3].category, 'ASSET');
assert.equal(g21_2e.lines[3].credit, 1850);
assert.equal(g21_2e.totalDebit, 5850);
assert.equal(g21_2e.totalCredit, 5850);
assert.equal(g21_2e.isBalanced, true);
const v21_2e = validateJournalGroups([g21_2e], { rawQuery: q21_2e });
assert.equal(v21_2e.isValid, true);

// 2f) 5-amount payroll (gross, ee CPF, er CPF, total CPF, net salaries)
const q21_2f = "Monthly payroll: gross salaries S$5,000, employee CPF S$1,000, employer CPF S$850; CPF of S$1,850 paid by bank, net salaries of S$4,000 still outstanding.";
const p21_2f = await parseAccountingQuery(q21_2f, null);
assert.equal(p21_2f.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p21_2f.isComplete, true);
assert.equal(p21_2f.directGroups?.length, 1);
const g21_2f = p21_2f.directGroups[0];
assert.equal(g21_2f.lines.length, 4);
assert.equal(g21_2f.lines[0].accountName, 'Salaries and Wages Expense');
assert.equal(g21_2f.lines[0].category, 'EXPENSE');
assert.equal(g21_2f.lines[0].debit, 5000);
assert.equal(g21_2f.lines[1].accountName, 'Employer CPF Contribution Expense');
assert.equal(g21_2f.lines[1].category, 'EXPENSE');
assert.equal(g21_2f.lines[1].debit, 850);
assert.equal(g21_2f.lines[2].accountName, 'Salaries Payable');
assert.equal(g21_2f.lines[2].category, 'LIABILITY');
assert.equal(g21_2f.lines[2].credit, 4000);
assert.equal(g21_2f.lines[3].accountName, 'Cash at Bank');
assert.equal(g21_2f.lines[3].category, 'ASSET');
assert.equal(g21_2f.lines[3].credit, 1850);
assert.equal(g21_2f.totalDebit, 5850);
assert.equal(g21_2f.totalCredit, 5850);
assert.equal(g21_2f.isBalanced, true);
const v21_2f = validateJournalGroups([g21_2f], { rawQuery: q21_2f });
assert.equal(v21_2f.isValid, true);

// 2g) Formatted amounts and 'and' clause splitting with mixed payment
const q21_2g = "Paid gross salaries of S$5,000 in cash and CPF by bank: employee CPF S$1,000, employer CPF S$850.";
const p21_2g = await parseAccountingQuery(q21_2g, null);
assert.equal(p21_2g.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p21_2g.isComplete, true);
assert.equal(p21_2g.directGroups?.length, 1);
const g21_2g = p21_2g.directGroups[0];
assert.equal(g21_2g.lines.length, 4);
assert.equal(g21_2g.lines[0].accountName, 'Salaries and Wages Expense');
assert.equal(g21_2g.lines[0].category, 'EXPENSE');
assert.equal(g21_2g.lines[0].debit, 5000);
assert.equal(g21_2g.lines[1].accountName, 'Employer CPF Contribution Expense');
assert.equal(g21_2g.lines[1].category, 'EXPENSE');
assert.equal(g21_2g.lines[1].debit, 850);
assert.equal(g21_2g.lines[2].accountName, 'Cash');
assert.equal(g21_2g.lines[2].category, 'ASSET');
assert.equal(g21_2g.lines[2].credit, 4000);
assert.equal(g21_2g.lines[3].accountName, 'Cash at Bank');
assert.equal(g21_2g.lines[3].category, 'ASSET');
assert.equal(g21_2g.lines[3].credit, 1850);
assert.equal(g21_2g.totalDebit, 5850);
assert.equal(g21_2g.totalCredit, 5850);
assert.equal(g21_2g.isBalanced, true);
const v21_2g = validateJournalGroups([g21_2g], { rawQuery: q21_2g });
assert.equal(v21_2g.isValid, true);

// Issue 3: Initial prepaid insurance purchase misrouting & Prepaid Insurance account
// 3a) Record prepaid insurance by bank for 12 months (ASSET Prepaid Insurance, not expense)
const q21_3a = "Record prepaid insurance of S$12,000 by bank for 12 months.";
const p21_3a = await parseAccountingQuery(q21_3a, null);
assert.equal(p21_3a.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p21_3a.isComplete, true);
assert.equal(p21_3a.directGroups?.length, 1);
const g21_3a = p21_3a.directGroups[0];
assert.equal(g21_3a.lines[0].accountName, 'Prepaid Insurance');
assert.equal(g21_3a.lines[0].category, 'ASSET');
assert.equal(g21_3a.lines[0].debit, 12000);
assert.equal(g21_3a.lines[1].accountName, 'Cash at Bank');
assert.equal(g21_3a.lines[1].category, 'ASSET');
assert.equal(g21_3a.lines[1].credit, 12000);
assert.equal(g21_3a.totalDebit, 12000);
assert.equal(g21_3a.totalCredit, 12000);
assert.equal(g21_3a.isBalanced, true);
const v21_3a = validateJournalGroups([g21_3a], { rawQuery: q21_3a });
assert.equal(v21_3a.isValid, true);

// 3b) Paid prepaid insurance without payment method fails closed with paymentMethod (NOT periodCharge)
const q21_3b = "Paid prepaid insurance of S$12,000 for 12 months.";
const p21_3b = await parseAccountingQuery(q21_3b, null);
assert.equal(p21_3b.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p21_3b.isComplete, false);
assert.equal(p21_3b.directGroups?.length ?? 0, 0);
assert.ok(p21_3b.missingFields.some(f => f.fieldKey === 'paymentMethod'), 'Must request paymentMethod');
assert.ok(!p21_3b.missingFields.some(f => f.fieldKey === 'periodCharge'), 'Must NOT request periodCharge');
const p21_3b_resolved = await parseAccountingQuery("by bank transfer", p21_3b);
assert.equal(p21_3b_resolved.isComplete, true);
assert.equal(p21_3b_resolved.directGroups?.length, 1);
const g21_3b_res = p21_3b_resolved.directGroups[0];
assert.equal(g21_3b_res.lines[0].accountName, 'Prepaid Insurance');
assert.equal(g21_3b_res.lines[0].category, 'ASSET');
assert.equal(g21_3b_res.lines[0].debit, 12000);
assert.equal(g21_3b_res.lines[1].accountName, 'Cash at Bank');
assert.equal(g21_3b_res.lines[1].category, 'ASSET');
assert.equal(g21_3b_res.lines[1].credit, 12000);
assert.equal(g21_3b_res.totalDebit, 12000);
assert.equal(g21_3b_res.totalCredit, 12000);
assert.equal(g21_3b_res.isBalanced, true);
const v21_3b_res = validateJournalGroups([g21_3b_res], { rawQuery: p21_3b_resolved.rawQuery });
assert.equal(v21_3b_res.isValid, true);

// 3c) Recognise prepaid insurance of S$12,000 paid by bank for 12 months
const q21_3c = "Recognise prepaid insurance of S$12,000 paid by bank for 12 months.";
const p21_3c = await parseAccountingQuery(q21_3c, null);
assert.equal(p21_3c.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p21_3c.isComplete, true);
assert.equal(p21_3c.directGroups?.length, 1);
const g21_3c = p21_3c.directGroups[0];
assert.equal(g21_3c.lines.length, 2);
assert.equal(g21_3c.lines[0].accountName, 'Prepaid Insurance');
assert.equal(g21_3c.lines[0].category, 'ASSET');
assert.equal(g21_3c.lines[0].debit, 12000);
assert.equal(g21_3c.lines[1].accountName, 'Cash at Bank');
assert.equal(g21_3c.lines[1].category, 'ASSET');
assert.equal(g21_3c.lines[1].credit, 12000);
assert.equal(g21_3c.totalDebit, 12000);
assert.equal(g21_3c.totalCredit, 12000);
assert.equal(g21_3c.isBalanced, true);
const v21_3c = validateJournalGroups([g21_3c], { rawQuery: q21_3c });
assert.equal(v21_3c.isValid, true);

// 3d) Paid insurance in advance of S$12,000 by bank
const q21_3d = "Paid insurance in advance of S$12,000 by bank.";
const p21_3d = await parseAccountingQuery(q21_3d, null);
assert.equal(p21_3d.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p21_3d.isComplete, true);
assert.equal(p21_3d.directGroups?.length, 1);
const g21_3d = p21_3d.directGroups[0];
assert.equal(g21_3d.lines.length, 2);
assert.equal(g21_3d.lines[0].accountName, 'Prepaid Insurance');
assert.equal(g21_3d.lines[0].category, 'ASSET');
assert.equal(g21_3d.lines[0].debit, 12000);
assert.equal(g21_3d.lines[1].accountName, 'Cash at Bank');
assert.equal(g21_3d.lines[1].category, 'ASSET');
assert.equal(g21_3d.lines[1].credit, 12000);
assert.equal(g21_3d.totalDebit, 12000);
assert.equal(g21_3d.totalCredit, 12000);
assert.equal(g21_3d.isBalanced, true);
const v21_3d = validateJournalGroups([g21_3d], { rawQuery: q21_3d });
assert.equal(v21_3d.isValid, true);

// 22. PR #26 Review Findings Correctness Pass (Findings A–E)
// =========================================================================
// Finding A: Payment Method Isolation (Salary vs CPF)
// 22_A1) Salaries paid by bank transfer, CPF unpaid / accrued
const q22_A1 = "Monthly payroll: gross salaries SGD 5,000, employee CPF SGD 1,000, employer CPF SGD 850; salaries paid by bank transfer, CPF contributions remain accrued.";
const p22_A1 = await parseAccountingQuery(q22_A1, null);
assert.equal(p22_A1.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p22_A1.isComplete, true);
assert.equal(p22_A1.directGroups?.length, 1);
const g22_A1 = p22_A1.directGroups[0];
assert.equal(g22_A1.lines.length, 4);
assert.equal(g22_A1.lines[0].accountName, 'Salaries and Wages Expense');
assert.equal(g22_A1.lines[0].debit, 5000);
assert.equal(g22_A1.lines[1].accountName, 'Employer CPF Contribution Expense');
assert.equal(g22_A1.lines[1].debit, 850);
assert.equal(g22_A1.lines[2].accountName, 'Cash at Bank');
assert.equal(g22_A1.lines[2].credit, 4000);
assert.equal(g22_A1.lines[3].accountName, 'CPF Payable');
assert.equal(g22_A1.lines[3].credit, 1850);
assert.equal(g22_A1.totalDebit, 5850);
assert.equal(g22_A1.totalCredit, 5850);
assert.equal(g22_A1.isBalanced, true);
const v22_A1 = validateJournalGroups([g22_A1], { rawQuery: q22_A1 });
assert.equal(v22_A1.isValid, true);

// 22_A2) Salaries paid in cash, CPF unpaid / accrued
const q22_A2 = "Monthly payroll: gross salaries SGD 4,000, employee CPF SGD 800, employer CPF SGD 680; salaries paid in cash, CPF payable to CPF Board.";
const p22_A2 = await parseAccountingQuery(q22_A2, null);
assert.equal(p22_A2.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p22_A2.isComplete, true);
assert.equal(p22_A2.directGroups?.length, 1);
const g22_A2 = p22_A2.directGroups[0];
assert.equal(g22_A2.lines.length, 4);
assert.equal(g22_A2.lines[2].accountName, 'Cash');
assert.equal(g22_A2.lines[2].credit, 3200);
assert.equal(g22_A2.lines[3].accountName, 'CPF Payable');
assert.equal(g22_A2.lines[3].credit, 1480);
assert.equal(g22_A2.totalDebit, 4680);
assert.equal(g22_A2.totalCredit, 4680);
assert.equal(g22_A2.isBalanced, true);
const v22_A2 = validateJournalGroups([g22_A2], { rawQuery: q22_A2 });
assert.equal(v22_A2.isValid, true);

// 22_A3) Salaries unpaid / accrued, CPF paid by bank transfer
const q22_A3 = "Monthly payroll: gross salaries SGD 6,000, employee CPF SGD 1,200, employer CPF SGD 1,020; salaries accrued, CPF remitted to CPF Board by bank transfer.";
const p22_A3 = await parseAccountingQuery(q22_A3, null);
assert.equal(p22_A3.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p22_A3.isComplete, true);
assert.equal(p22_A3.directGroups?.length, 1);
const g22_A3 = p22_A3.directGroups[0];
assert.equal(g22_A3.lines.length, 4);
assert.equal(g22_A3.lines[0].accountName, 'Salaries and Wages Expense');
assert.equal(g22_A3.lines[0].debit, 6000);
assert.equal(g22_A3.lines[1].accountName, 'Employer CPF Contribution Expense');
assert.equal(g22_A3.lines[1].debit, 1020);
assert.equal(g22_A3.lines[2].accountName, 'Salaries Payable');
assert.equal(g22_A3.lines[2].credit, 4800);
assert.equal(g22_A3.lines[3].accountName, 'Cash at Bank');
assert.equal(g22_A3.lines[3].credit, 2220);
assert.equal(g22_A3.totalDebit, 7020);
assert.equal(g22_A3.totalCredit, 7020);
assert.equal(g22_A3.isBalanced, true);
const v22_A3 = validateJournalGroups([g22_A3], { rawQuery: q22_A3 });
assert.equal(v22_A3.isValid, true);

// 22_A4) Salaries paid by bank transfer, CPF paid in cash
const q22_A4 = "Monthly payroll: gross salaries SGD 5,000, employee CPF SGD 1,000, employer CPF SGD 850; salaries paid by bank transfer, CPF paid in cash.";
const p22_A4 = await parseAccountingQuery(q22_A4, null);
assert.equal(p22_A4.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p22_A4.isComplete, true);
assert.equal(p22_A4.directGroups?.length, 1);
const g22_A4 = p22_A4.directGroups[0];
assert.equal(g22_A4.lines.length, 4);
assert.equal(g22_A4.lines[0].accountName, 'Salaries and Wages Expense');
assert.equal(g22_A4.lines[0].debit, 5000);
assert.equal(g22_A4.lines[1].accountName, 'Employer CPF Contribution Expense');
assert.equal(g22_A4.lines[1].debit, 850);
assert.equal(g22_A4.lines[2].accountName, 'Cash at Bank');
assert.equal(g22_A4.lines[2].credit, 4000);
assert.equal(g22_A4.lines[3].accountName, 'Cash');
assert.equal(g22_A4.lines[3].credit, 1850);
assert.equal(g22_A4.totalDebit, 5850);
assert.equal(g22_A4.totalCredit, 5850);
assert.equal(g22_A4.isBalanced, true);
const v22_A4 = validateJournalGroups([g22_A4], { rawQuery: q22_A4 });
assert.equal(v22_A4.isValid, true);

// =========================================================================
// Finding B: Prior Payroll / CPF Accrual Settlement (Zero Expense Lines)
// 22_B1) Settled last month's accrued payroll: gross, employee CPF, employer CPF by bank transfer
const q22_B1 = "settled last month's accrued payroll: gross salaries of SGD 5,000, employee CPF SGD 1,000, employer CPF SGD 850 by bank transfer.";
const p22_B1 = await parseAccountingQuery(q22_B1, null);
assert.equal(p22_B1.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p22_B1.isComplete, true);
assert.equal(p22_B1.directGroups?.length, 1);
const g22_B1 = p22_B1.directGroups[0];
assert.equal(g22_B1.lines.length, 3);
assert.ok(!g22_B1.lines.some(l => l.category === 'EXPENSE'), 'Must NOT have expense lines in prior accrual settlement');
assert.equal(g22_B1.lines[0].accountName, 'Salaries Payable');
assert.equal(g22_B1.lines[0].category, 'LIABILITY');
assert.equal(g22_B1.lines[0].debit, 4000);
assert.equal(g22_B1.lines[1].accountName, 'CPF Payable');
assert.equal(g22_B1.lines[1].category, 'LIABILITY');
assert.equal(g22_B1.lines[1].debit, 1850);
assert.equal(g22_B1.lines[2].accountName, 'Cash at Bank');
assert.equal(g22_B1.lines[2].category, 'ASSET');
assert.equal(g22_B1.lines[2].credit, 5850);
assert.equal(g22_B1.totalDebit, 5850);
assert.equal(g22_B1.totalCredit, 5850);
assert.equal(g22_B1.isBalanced, true);
const v22_B1 = validateJournalGroups([g22_B1], { rawQuery: q22_B1 });
assert.equal(v22_B1.isValid, true);

// 22_B2) Pay previously accrued payroll: salaries payable and CPF payable by bank transfer
const q22_B2 = "pay previously accrued payroll: salaries payable of SGD 3,500 and CPF payable of SGD 1,500 by bank transfer.";
const p22_B2 = await parseAccountingQuery(q22_B2, null);
assert.equal(p22_B2.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p22_B2.isComplete, true);
assert.equal(p22_B2.directGroups?.length, 1);
const g22_B2 = p22_B2.directGroups[0];
assert.equal(g22_B2.lines.length, 3);
assert.ok(!g22_B2.lines.some(l => l.category === 'EXPENSE'), 'Must NOT have expense lines in prior accrual settlement');
assert.equal(g22_B2.lines[0].accountName, 'Salaries Payable');
assert.equal(g22_B2.lines[0].debit, 3500);
assert.equal(g22_B2.lines[1].accountName, 'CPF Payable');
assert.equal(g22_B2.lines[1].debit, 1500);
assert.equal(g22_B2.lines[2].accountName, 'Cash at Bank');
assert.equal(g22_B2.lines[2].credit, 5000);
assert.equal(g22_B2.totalDebit, 5000);
assert.equal(g22_B2.totalCredit, 5000);
assert.equal(g22_B2.isBalanced, true);
const v22_B2 = validateJournalGroups([g22_B2], { rawQuery: q22_B2 });
assert.equal(v22_B2.isValid, true);

// 22_B3) Settle accrued salaries via bank (single-item)
const q22_B3 = "settle accrued salaries of SGD 4,000 via bank.";
const p22_B3 = await parseAccountingQuery(q22_B3, null);
assert.equal(p22_B3.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p22_B3.isComplete, true);
assert.equal(p22_B3.directGroups?.length, 1);
const g22_B3 = p22_B3.directGroups[0];
assert.equal(g22_B3.lines.length, 2);
assert.ok(!g22_B3.lines.some(l => l.category === 'EXPENSE'), 'Must NOT have expense lines');
assert.equal(g22_B3.lines[0].accountName, 'Salaries Payable');
assert.equal(g22_B3.lines[0].debit, 4000);
assert.equal(g22_B3.lines[1].accountName, 'Cash at Bank');
assert.equal(g22_B3.lines[1].credit, 4000);
assert.equal(g22_B3.totalDebit, 4000);
assert.equal(g22_B3.totalCredit, 4000);
assert.equal(g22_B3.isBalanced, true);
const v22_B3 = validateJournalGroups([g22_B3], { rawQuery: q22_B3 });
assert.equal(v22_B3.isValid, true);

// 22_B4) Pay accrued CPF liability by bank transfer (single-item)
const q22_B4 = "pay accrued CPF liability of SGD 1,500 by bank transfer.";
const p22_B4 = await parseAccountingQuery(q22_B4, null);
assert.equal(p22_B4.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p22_B4.isComplete, true);
assert.equal(p22_B4.directGroups?.length, 1);
const g22_B4 = p22_B4.directGroups[0];
assert.equal(g22_B4.lines.length, 2);
assert.ok(!g22_B4.lines.some(l => l.category === 'EXPENSE'), 'Must NOT have expense lines');
assert.equal(g22_B4.lines[0].accountName, 'CPF Payable');
assert.equal(g22_B4.lines[0].debit, 1500);
assert.equal(g22_B4.lines[1].accountName, 'Cash at Bank');
assert.equal(g22_B4.lines[1].credit, 1500);
assert.equal(g22_B4.totalDebit, 1500);
assert.equal(g22_B4.totalCredit, 1500);
assert.equal(g22_B4.isBalanced, true);
const v22_B4 = validateJournalGroups([g22_B4], { rawQuery: q22_B4 });
assert.equal(v22_B4.isValid, true);

// =========================================================================
// Finding C: Period-Based Depreciation & Amortisation
// 22_C1) Single-turn full specification: annual straight-line, 5 years, nil residual
const q22_C1 = "Annual straight-line depreciation on office equipment costing SGD 60,000 with a 5-year useful life and nil residual value.";
const p22_C1 = await parseAccountingQuery(q22_C1, null);
assert.equal(p22_C1.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p22_C1.isComplete, true);
assert.equal(p22_C1.directGroups?.length, 1);
const g22_C1 = p22_C1.directGroups[0];
assert.equal(g22_C1.lines.length, 2);
assert.equal(g22_C1.lines[0].accountName, 'Depreciation Expense');
assert.equal(g22_C1.lines[0].category, 'EXPENSE');
assert.equal(g22_C1.lines[0].debit, 12000);
assert.equal(g22_C1.lines[1].accountName, 'Accumulated Depreciation — Office Equipment');
assert.equal(g22_C1.lines[1].category, 'ASSET');
assert.equal(g22_C1.lines[1].credit, 12000);
assert.equal(g22_C1.totalDebit, 12000);
assert.equal(g22_C1.totalCredit, 12000);
assert.equal(g22_C1.isBalanced, true);
const v22_C1 = validateJournalGroups([g22_C1], { rawQuery: q22_C1 });
assert.equal(v22_C1.isValid, true);

// 22_C2) Monthly depreciation on machinery: 10-year useful life, zero residual
const q22_C2 = "Monthly depreciation on machinery costing SGD 120,000 with 10-year useful life and zero residual value.";
const p22_C2 = await parseAccountingQuery(q22_C2, null);
assert.equal(p22_C2.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p22_C2.isComplete, true);
assert.equal(p22_C2.directGroups?.length, 1);
const g22_C2 = p22_C2.directGroups[0];
assert.equal(g22_C2.lines[0].accountName, 'Depreciation Expense');
assert.equal(g22_C2.lines[0].debit, 1000);
assert.equal(g22_C2.lines[1].accountName, 'Accumulated Depreciation — Machinery');
assert.equal(g22_C2.lines[1].credit, 1000);
assert.equal(g22_C2.isBalanced, true);
const v22_C2 = validateJournalGroups([g22_C2], { rawQuery: q22_C2 });
assert.equal(v22_C2.isValid, true);

// 22_C3) Annual straight-line amortisation of software license over 3 years with zero residual
const q22_C3 = "Annual straight-line amortisation of software license costing SGD 36,000 over 3 years with zero residual.";
const p22_C3 = await parseAccountingQuery(q22_C3, null);
assert.equal(p22_C3.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p22_C3.isComplete, true);
assert.equal(p22_C3.directGroups?.length, 1);
const g22_C3 = p22_C3.directGroups[0];
assert.equal(g22_C3.lines[0].accountName, 'Amortisation Expense');
assert.equal(g22_C3.lines[0].category, 'EXPENSE');
assert.equal(g22_C3.lines[0].debit, 12000);
assert.equal(g22_C3.lines[1].accountName, 'Accumulated Amortisation — Software');
assert.equal(g22_C3.lines[1].category, 'ASSET');
assert.equal(g22_C3.lines[1].credit, 12000);
assert.equal(g22_C3.isBalanced, true);
const v22_C3 = validateJournalGroups([g22_C3], { rawQuery: q22_C3 });
assert.equal(v22_C3.isValid, true);

// 22_C4) Non-integer cent straight-line failure
const q22_C4 = "Monthly depreciation on equipment costing SGD 10,000 over 7 years with nil residual.";
const p22_C4 = await parseAccountingQuery(q22_C4, null);
assert.equal(p22_C4.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p22_C4.isComplete, false, 'Non-integer straight-line depreciation must fail closed');
assert.equal(p22_C4.directGroups?.length ?? 0, 0);
assert.ok(p22_C4.missingFields.some(f => f.fieldKey === 'periodCharge'));

// 22_C5) Missing residual fails closed and follow-up resolves
const q22_C5 = "Annual depreciation on equipment costing SGD 50,000 over 5 years.";
const p22_C5 = await parseAccountingQuery(q22_C5, null);
assert.equal(p22_C5.isComplete, false, 'Missing residual must fail closed');
assert.ok(p22_C5.missingFields.some(f => f.fieldKey === 'periodCharge'));
const p22_C5_res = await parseAccountingQuery("nil residual", p22_C5);
assert.equal(p22_C5_res.isComplete, true);
assert.equal(p22_C5_res.directGroups?.length, 1);
assert.equal(p22_C5_res.directGroups[0].lines[0].debit, 10000);
assert.equal(p22_C5_res.directGroups[0].lines[1].credit, 10000);
assert.equal(p22_C5_res.directGroups[0].isBalanced, true);

// 22_C6) Non-tax depreciation query protection
const q22_C6 = "Annual depreciation on delivery van costing SGD 80,000 over 5 years with nil residual.";
const p22_C6 = await parseAccountingQuery(q22_C6, null);
assert.equal(p22_C6.transactionTitle, 'Depreciation charge on property, plant and equipment');
assert.equal(p22_C6.directGroups[0].lines[0].accountName, 'Depreciation Expense');

// 22_C7) Follow-up with explicit SGD amount
const q22_C7 = "Annual depreciation on machinery costing SGD 50,000.";
const p22_C7 = await parseAccountingQuery(q22_C7, null);
assert.equal(p22_C7.isComplete, false);
const p22_C7_res = await parseAccountingQuery("the periodic charge is SGD 10,000", p22_C7);
assert.equal(p22_C7_res.isComplete, true);
assert.equal(p22_C7_res.directGroups[0].lines[0].debit, 10000);
assert.equal(p22_C7_res.directGroups[0].lines[1].credit, 10000);

// =========================================================================
// Finding D: Income Tax Safeguards
// 22_D1) Advance corporate tax payment with no existing liability
const q22_D1 = "Paid corporate income tax of SGD 5,000 by bank with no existing tax liability.";
const p22_D1 = await parseAccountingQuery(q22_D1, null);
assert.equal(p22_D1.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p22_D1.isComplete, true);
assert.equal(p22_D1.directGroups?.length, 1);
const g22_D1 = p22_D1.directGroups[0];
assert.equal(g22_D1.lines[0].accountName, 'Prepaid Income Tax');
assert.equal(g22_D1.lines[0].category, 'ASSET');
assert.equal(g22_D1.lines[0].debit, 5000);
assert.equal(g22_D1.lines[1].accountName, 'Cash at Bank');
assert.equal(g22_D1.lines[1].credit, 5000);
assert.equal(g22_D1.isBalanced, true);
const v22_D1 = validateJournalGroups([g22_D1], { rawQuery: q22_D1 });
assert.equal(v22_D1.isValid, true);

// 22_D2) Split payment: Paid tax of $12,000 against existing liability of $10,000
const q22_D2 = "Paid corporate income tax of SGD 12,000 by bank against existing current tax payable of SGD 10,000.";
const p22_D2 = await parseAccountingQuery(q22_D2, null);
assert.equal(p22_D2.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p22_D2.isComplete, true);
assert.equal(p22_D2.directGroups?.length, 1);
const g22_D2 = p22_D2.directGroups[0];
assert.equal(g22_D2.lines.length, 3);
assert.equal(g22_D2.lines[0].accountName, 'Current Tax Payable');
assert.equal(g22_D2.lines[0].category, 'LIABILITY');
assert.equal(g22_D2.lines[0].debit, 10000);
assert.equal(g22_D2.lines[1].accountName, 'Prepaid Income Tax');
assert.equal(g22_D2.lines[1].category, 'ASSET');
assert.equal(g22_D2.lines[1].debit, 2000);
assert.equal(g22_D2.lines[2].accountName, 'Cash at Bank');
assert.equal(g22_D2.lines[2].category, 'ASSET');
assert.equal(g22_D2.lines[2].credit, 12000);
assert.equal(g22_D2.totalDebit, 12000);
assert.equal(g22_D2.totalCredit, 12000);
assert.equal(g22_D2.isBalanced, true);
const v22_D2 = validateJournalGroups([g22_D2], { rawQuery: q22_D2 });
assert.equal(v22_D2.isValid, true);

// 22_D3) Advance tax payment without liability confirmation fails closed and resolves to prepaid asset
const q22_D3 = "Paid advance corporate income tax of SGD 8,000 by bank.";
const p22_D3 = await parseAccountingQuery(q22_D3, null);
assert.equal(p22_D3.isComplete, false, 'Advance tax payment without confirmation must fail closed');
assert.ok(p22_D3.missingFields.some(f => f.fieldKey === 'taxLiabilityStatus'));
const p22_D3_res = await parseAccountingQuery("no existing tax liability", p22_D3);
assert.equal(p22_D3_res.isComplete, true);
assert.equal(p22_D3_res.directGroups[0].lines[0].accountName, 'Prepaid Income Tax');
assert.equal(p22_D3_res.directGroups[0].lines[0].category, 'ASSET');
assert.equal(p22_D3_res.directGroups[0].lines[0].debit, 8000);

// 22_D4) Advance tax payment follow-up confirming existing liability resolves to Current Tax Payable
const p22_D4_res = await parseAccountingQuery("settling existing current tax payable", p22_D3);
assert.equal(p22_D4_res.isComplete, true);
assert.equal(p22_D4_res.directGroups[0].lines[0].accountName, 'Current Tax Payable');
assert.equal(p22_D4_res.directGroups[0].lines[0].category, 'LIABILITY');
assert.equal(p22_D4_res.directGroups[0].lines[0].debit, 8000);

// 22_D5) Deferred tax recognized directly in equity under SFRS(I) 1-12 §61A(b)
const q22_D5 = "Recognised deferred tax asset of SGD 3,400 arising from ordinary share issue costs directly in equity.";
const p22_D5 = await parseAccountingQuery(q22_D5, null);
assert.equal(p22_D5.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p22_D5.isComplete, true);
assert.equal(p22_D5.directGroups?.length, 1);
const g22_D5 = p22_D5.directGroups[0];
assert.equal(g22_D5.lines.length, 2);
assert.equal(g22_D5.lines[0].accountName, 'Deferred Tax Asset');
assert.equal(g22_D5.lines[0].category, 'ASSET');
assert.equal(g22_D5.lines[0].debit, 3400);
assert.equal(g22_D5.lines[1].accountName, 'Share Capital');
assert.equal(g22_D5.lines[1].category, 'EQUITY');
assert.equal(g22_D5.lines[1].credit, 3400);
assert.ok(!g22_D5.lines.some(l => l.accountName === 'Income Tax Expense'), 'Must NOT debit/credit Income Tax Expense for equity items');
assert.equal(g22_D5.isBalanced, true);
const v22_D5 = validateJournalGroups([g22_D5], { rawQuery: q22_D5 });
assert.equal(v22_D5.isValid, true);

// 22_D6) Deferred tax recognized in OCI under SFRS(I) 1-12 §61A(a)
const q22_D6 = "Recognised deferred tax liability of SGD 8,500 on revaluation surplus in other comprehensive income.";
const p22_D6 = await parseAccountingQuery(q22_D6, null);
assert.equal(p22_D6.scenarioType, 'BASIC_BOOKKEEPING');
assert.equal(p22_D6.isComplete, true);
assert.equal(p22_D6.directGroups?.length, 1);
const g22_D6 = p22_D6.directGroups[0];
assert.equal(g22_D6.lines.length, 2);
assert.equal(g22_D6.lines[0].accountName, 'OCI — Revaluation Surplus');
assert.equal(g22_D6.lines[0].category, 'OTHER_COMPREHENSIVE_INCOME');
assert.equal(g22_D6.lines[0].debit, 8500);
assert.equal(g22_D6.lines[1].accountName, 'Deferred Tax Liability');
assert.equal(g22_D6.lines[1].category, 'LIABILITY');
assert.equal(g22_D6.lines[1].credit, 8500);
assert.ok(!g22_D6.lines.some(l => l.accountName === 'Income Tax Expense'), 'Must NOT debit/credit Income Tax Expense for OCI items');
assert.equal(g22_D6.isBalanced, true);
const v22_D6 = validateJournalGroups([g22_D6], { rawQuery: q22_D6 });
assert.equal(v22_D6.isValid, true);

// 22_D7) Non-tax amount protection
const q22_D7 = "Paid annual software subscription of SGD 2,400 by bank.";
const p22_D7 = await parseAccountingQuery(q22_D7, null);
assert.notEqual(p22_D7.scenarioType, 'CURRENT_TAX_PAYMENT');
assert.ok(p22_D7.directGroups?.[0]?.lines[0]?.accountName !== 'Current Tax Payable');
assert.ok(p22_D7.directGroups?.[0]?.lines[0]?.accountName !== 'Prepaid Income Tax');

// =========================================================================
// Finding E: Prepaid Expense Override Bounds Checking
// 22_E1) Follow-up override exceeding prepaid balance fails closed
const q22_E1 = "Prepaid insurance balance of SGD 1,200. Record expired portion.";
const p22_E1 = await parseAccountingQuery(q22_E1, null);
assert.equal(p22_E1.isComplete, false);
const p22_E1_exceed = await parseAccountingQuery("the periodic expense is SGD 5,000", p22_E1);
assert.equal(p22_E1_exceed.isComplete, false, 'Override exceeding prepaid balance must fail closed');
assert.ok(p22_E1_exceed.missingFields.some(f => f.fieldKey === 'periodCharge'));

// 22_E2) Subsequent valid follow-up completes successfully
const p22_E1_valid = await parseAccountingQuery("SGD 600", p22_E1_exceed);
assert.equal(p22_E1_valid.isComplete, true);
assert.equal(p22_E1_valid.directGroups?.length, 1);
const g22_E1_valid = p22_E1_valid.directGroups[0];
assert.equal(g22_E1_valid.lines[0].accountName, 'Insurance Expense');
assert.equal(g22_E1_valid.lines[0].debit, 600);
assert.equal(g22_E1_valid.lines[1].accountName, 'Prepaid Insurance');
assert.equal(g22_E1_valid.lines[1].credit, 600);
assert.equal(g22_E1_valid.isBalanced, true);
const v22_E1_valid = validateJournalGroups([g22_E1_valid], { rawQuery: p22_E1_valid.rawQuery });
assert.equal(v22_E1_valid.isValid, true);

// =========================================================================
// PR #26 Pass 2 Verbatim Adversarial Regression Tests
// =========================================================================

// 22_A5) Exact PR #26 Finding A prompt
const q22_A5 = "Monthly payroll: gross salaries S$5,000, employee CPF S$1,000, employer CPF S$850; CPF paid by bank; salaries also paid.";
const p22_A5 = await parseAccountingQuery(q22_A5, null);
assert.equal(p22_A5.isComplete, false);
assert.ok(p22_A5.missingFields.some(f => f.fieldKey === 'salaryPaymentMethod'), 'Must request salary payment method');
assert.ok(!p22_A5.missingFields.some(f => f.fieldKey === 'cpfPaymentMethod'), 'Must NOT request CPF payment method since CPF was paid by bank');

// Follow-up "in cash"
const p22_A5_cash = await parseAccountingQuery("in cash", p22_A5);
assert.equal(p22_A5_cash.isComplete, true);
assert.equal(p22_A5_cash.directGroups?.length, 1);
const g22_A5_cash = p22_A5_cash.directGroups[0];
assert.equal(g22_A5_cash.lines.length, 4);
assert.equal(g22_A5_cash.lines[0].accountName, 'Salaries and Wages Expense');
assert.equal(g22_A5_cash.lines[0].category, 'EXPENSE');
assert.equal(g22_A5_cash.lines[0].debit, 5000);
assert.equal(g22_A5_cash.lines[1].accountName, 'Employer CPF Contribution Expense');
assert.equal(g22_A5_cash.lines[1].category, 'EXPENSE');
assert.equal(g22_A5_cash.lines[1].debit, 850);
assert.equal(g22_A5_cash.lines[2].accountName, 'Cash');
assert.equal(g22_A5_cash.lines[2].category, 'ASSET');
assert.equal(g22_A5_cash.lines[2].credit, 4000);
assert.equal(g22_A5_cash.lines[3].accountName, 'Cash at Bank');
assert.equal(g22_A5_cash.lines[3].category, 'ASSET');
assert.equal(g22_A5_cash.lines[3].credit, 1850);
assert.equal(g22_A5_cash.isBalanced, true);
const v22_A5_cash = validateJournalGroups([g22_A5_cash], { rawQuery: p22_A5_cash.rawQuery });
assert.equal(v22_A5_cash.isValid, true);

// Follow-up "by bank"
const p22_A5_bank = await parseAccountingQuery("by bank", p22_A5);
assert.equal(p22_A5_bank.isComplete, true);
assert.equal(p22_A5_bank.directGroups?.length, 1);
const g22_A5_bank = p22_A5_bank.directGroups[0];
assert.equal(g22_A5_bank.lines.length, 3);
assert.equal(g22_A5_bank.lines[0].accountName, 'Salaries and Wages Expense');
assert.equal(g22_A5_bank.lines[0].category, 'EXPENSE');
assert.equal(g22_A5_bank.lines[0].debit, 5000);
assert.equal(g22_A5_bank.lines[1].accountName, 'Employer CPF Contribution Expense');
assert.equal(g22_A5_bank.lines[1].category, 'EXPENSE');
assert.equal(g22_A5_bank.lines[1].debit, 850);
assert.equal(g22_A5_bank.lines[2].accountName, 'Cash at Bank');
assert.equal(g22_A5_bank.lines[2].category, 'ASSET');
assert.equal(g22_A5_bank.lines[2].credit, 5850);
assert.equal(g22_A5_bank.isBalanced, true);
const v22_A5_bank = validateJournalGroups([g22_A5_bank], { rawQuery: p22_A5_bank.rawQuery });
assert.equal(v22_A5_bank.isValid, true);

// 22_A6) generalPayrollPaid leak check
const q22_A6 = "Paid monthly payroll: gross salaries S$5,000, employee CPF S$1,000, employer CPF S$850; CPF paid by bank; salaries also paid.";
const p22_A6 = await parseAccountingQuery(q22_A6, null);
assert.equal(p22_A6.isComplete, false);
assert.ok(p22_A6.missingFields.some(f => f.fieldKey === 'salaryPaymentMethod'), 'Must request salary payment method despite Paid monthly payroll prefix');
assert.ok(!p22_A6.missingFields.some(f => f.fieldKey === 'cpfPaymentMethod'), 'Must NOT request CPF payment method');

// 22_A7) Reverse leak check
const q22_A7 = "Monthly payroll: gross salaries S$5,000, employee CPF S$1,000, employer CPF S$850; salaries paid in cash; CPF also paid.";
const p22_A7 = await parseAccountingQuery(q22_A7, null);
assert.equal(p22_A7.isComplete, false);
assert.ok(p22_A7.missingFields.some(f => f.fieldKey === 'cpfPaymentMethod'), 'Must request cpfPaymentMethod');
assert.ok(!p22_A7.missingFields.some(f => f.fieldKey === 'salaryPaymentMethod'), 'Must NOT request salaryPaymentMethod');

const p22_A7_bank = await parseAccountingQuery("by bank transfer", p22_A7);
assert.equal(p22_A7_bank.isComplete, true);
assert.equal(p22_A7_bank.directGroups?.length, 1);
const g22_A7_bank = p22_A7_bank.directGroups[0];
assert.equal(g22_A7_bank.lines.length, 4);
assert.equal(g22_A7_bank.lines[0].accountName, 'Salaries and Wages Expense');
assert.equal(g22_A7_bank.lines[0].category, 'EXPENSE');
assert.equal(g22_A7_bank.lines[0].debit, 5000);
assert.equal(g22_A7_bank.lines[1].accountName, 'Employer CPF Contribution Expense');
assert.equal(g22_A7_bank.lines[1].category, 'EXPENSE');
assert.equal(g22_A7_bank.lines[1].debit, 850);
assert.equal(g22_A7_bank.lines[2].accountName, 'Cash');
assert.equal(g22_A7_bank.lines[2].category, 'ASSET');
assert.equal(g22_A7_bank.lines[2].credit, 4000);
assert.equal(g22_A7_bank.lines[3].accountName, 'Cash at Bank');
assert.equal(g22_A7_bank.lines[3].category, 'ASSET');
assert.equal(g22_A7_bank.lines[3].credit, 1850);
assert.equal(g22_A7_bank.isBalanced, true);
const v22_A7_bank = validateJournalGroups([g22_A7_bank], { rawQuery: p22_A7_bank.rawQuery });
assert.equal(v22_A7_bank.isValid, true);

// 22_A8) Both paid, neither method specified + compound & shared follow-ups
const q22_A8 = "Monthly payroll: gross salaries S$5,000, employee CPF S$1,000, employer CPF S$850; both salaries and CPF were paid.";
const p22_A8 = await parseAccountingQuery(q22_A8, null);
assert.equal(p22_A8.isComplete, false);
assert.ok(p22_A8.missingFields.some(f => f.fieldKey === 'salaryPaymentMethod'));
assert.ok(p22_A8.missingFields.some(f => f.fieldKey === 'cpfPaymentMethod'));

// Compound follow-up "salaries in cash, CPF by bank"
const p22_A8_split = await parseAccountingQuery("salaries in cash, CPF by bank", p22_A8);
assert.equal(p22_A8_split.isComplete, true);
assert.equal(p22_A8_split.directGroups?.length, 1);
const g22_A8_split = p22_A8_split.directGroups[0];
assert.equal(g22_A8_split.lines.length, 4);
assert.equal(g22_A8_split.lines[0].accountName, 'Salaries and Wages Expense');
assert.equal(g22_A8_split.lines[0].category, 'EXPENSE');
assert.equal(g22_A8_split.lines[0].debit, 5000);
assert.equal(g22_A8_split.lines[1].accountName, 'Employer CPF Contribution Expense');
assert.equal(g22_A8_split.lines[1].category, 'EXPENSE');
assert.equal(g22_A8_split.lines[1].debit, 850);
assert.equal(g22_A8_split.lines[2].accountName, 'Cash');
assert.equal(g22_A8_split.lines[2].category, 'ASSET');
assert.equal(g22_A8_split.lines[2].credit, 4000);
assert.equal(g22_A8_split.lines[3].accountName, 'Cash at Bank');
assert.equal(g22_A8_split.lines[3].category, 'ASSET');
assert.equal(g22_A8_split.lines[3].credit, 1850);
assert.equal(g22_A8_split.isBalanced, true);
const v22_A8_split = validateJournalGroups([g22_A8_split], { rawQuery: p22_A8_split.rawQuery });
assert.equal(v22_A8_split.isValid, true);

// Shared follow-up "by bank transfer"
const p22_A8_bank = await parseAccountingQuery("by bank transfer", p22_A8);
assert.equal(p22_A8_bank.isComplete, true);
assert.equal(p22_A8_bank.directGroups?.length, 1);
const g22_A8_bank = p22_A8_bank.directGroups[0];
assert.equal(g22_A8_bank.lines.length, 3);
assert.equal(g22_A8_bank.lines[0].accountName, 'Salaries and Wages Expense');
assert.equal(g22_A8_bank.lines[0].category, 'EXPENSE');
assert.equal(g22_A8_bank.lines[0].debit, 5000);
assert.equal(g22_A8_bank.lines[1].accountName, 'Employer CPF Contribution Expense');
assert.equal(g22_A8_bank.lines[1].category, 'EXPENSE');
assert.equal(g22_A8_bank.lines[1].debit, 850);
assert.equal(g22_A8_bank.lines[2].accountName, 'Cash at Bank');
assert.equal(g22_A8_bank.lines[2].category, 'ASSET');
assert.equal(g22_A8_bank.lines[2].credit, 5850);
assert.equal(g22_A8_bank.isBalanced, true);
const v22_A8_bank = validateJournalGroups([g22_A8_bank], { rawQuery: p22_A8_bank.rawQuery });
assert.equal(v22_A8_bank.isValid, true);

// 22_A9) Comma-separated trailing single-leg payment method qualifier
// 22_A9a) CPF qualified by bank after comma
const q22_A9a = "Monthly payroll: gross salaries S$5,000, employee CPF S$1,000, employer CPF S$850; salaries and CPF were paid, CPF by bank.";
const p22_A9a = await parseAccountingQuery(q22_A9a, null);
assert.equal(p22_A9a.isComplete, false);
assert.ok(p22_A9a.missingFields.some(f => f.fieldKey === 'salaryPaymentMethod'), 'Must request salaryPaymentMethod');
assert.ok(!p22_A9a.missingFields.some(f => f.fieldKey === 'cpfPaymentMethod'), 'Must NOT request cpfPaymentMethod');

const p22_A9a_cash = await parseAccountingQuery("in cash", p22_A9a);
assert.equal(p22_A9a_cash.isComplete, true);
assert.equal(p22_A9a_cash.directGroups?.length, 1);
const g22_A9a_cash = p22_A9a_cash.directGroups[0];
assert.equal(g22_A9a_cash.lines.length, 4);
assert.equal(g22_A9a_cash.lines[0].accountName, 'Salaries and Wages Expense');
assert.equal(g22_A9a_cash.lines[0].category, 'EXPENSE');
assert.equal(g22_A9a_cash.lines[0].debit, 5000);
assert.equal(g22_A9a_cash.lines[1].accountName, 'Employer CPF Contribution Expense');
assert.equal(g22_A9a_cash.lines[1].category, 'EXPENSE');
assert.equal(g22_A9a_cash.lines[1].debit, 850);
assert.equal(g22_A9a_cash.lines[2].accountName, 'Cash');
assert.equal(g22_A9a_cash.lines[2].category, 'ASSET');
assert.equal(g22_A9a_cash.lines[2].credit, 4000);
assert.equal(g22_A9a_cash.lines[3].accountName, 'Cash at Bank');
assert.equal(g22_A9a_cash.lines[3].category, 'ASSET');
assert.equal(g22_A9a_cash.lines[3].credit, 1850);
assert.equal(g22_A9a_cash.isBalanced, true);
const v22_A9a_cash = validateJournalGroups([g22_A9a_cash], { rawQuery: p22_A9a_cash.rawQuery });
assert.equal(v22_A9a_cash.isValid, true);

// 22_A9b) Salaries qualified in cash after comma
const q22_A9b = "Monthly payroll: gross salaries S$5,000, employee CPF S$1,000, employer CPF S$850; salaries and CPF were paid, salaries in cash.";
const p22_A9b = await parseAccountingQuery(q22_A9b, null);
assert.equal(p22_A9b.isComplete, false);
assert.ok(p22_A9b.missingFields.some(f => f.fieldKey === 'cpfPaymentMethod'), 'Must request cpfPaymentMethod');
assert.ok(!p22_A9b.missingFields.some(f => f.fieldKey === 'salaryPaymentMethod'), 'Must NOT request salaryPaymentMethod');

// 22_B5) Exact PR #26 Finding B two-sentence prompt
const q22_B5 = "Last month we accrued payroll of S$5,000 gross, S$1,000 employee CPF and S$850 employer CPF. Today we paid salaries and CPF by bank.";
const p22_B5 = await parseAccountingQuery(q22_B5, null);
assert.equal(p22_B5.isComplete, true);
assert.equal(p22_B5.directGroups?.length, 1);
const g22_B5 = p22_B5.directGroups[0];
assert.equal(g22_B5.lines.length, 3);
assert.ok(g22_B5.lines.every(l => l.category !== 'EXPENSE'), 'Must have zero EXPENSE lines');
assert.equal(g22_B5.lines[0].accountName, 'Salaries Payable');
assert.equal(g22_B5.lines[0].category, 'LIABILITY');
assert.equal(g22_B5.lines[0].debit, 4000);
assert.equal(g22_B5.lines[1].accountName, 'CPF Payable');
assert.equal(g22_B5.lines[1].category, 'LIABILITY');
assert.equal(g22_B5.lines[1].debit, 1850);
assert.equal(g22_B5.lines[2].accountName, 'Cash at Bank');
assert.equal(g22_B5.lines[2].category, 'ASSET');
assert.equal(g22_B5.lines[2].credit, 5850);
assert.equal(g22_B5.isBalanced, true);
const v22_B5 = validateJournalGroups([g22_B5], { rawQuery: q22_B5 });
assert.equal(v22_B5.isValid, true);

// 22_B6) Prior accrual partial settlement — salaries paid today, CPF still unpaid
const q22_B6 = "Last month we accrued payroll of S$5,000 gross, S$1,000 employee CPF and S$850 employer CPF. Today we paid salaries by bank; CPF remains unpaid.";
const p22_B6 = await parseAccountingQuery(q22_B6, null);
assert.equal(p22_B6.isComplete, true);
assert.equal(p22_B6.directGroups?.length, 1);
const g22_B6 = p22_B6.directGroups[0];
assert.equal(g22_B6.lines.length, 2);
assert.ok(g22_B6.lines.every(l => l.category !== 'EXPENSE'), 'Must have zero EXPENSE lines');
assert.equal(g22_B6.lines[0].accountName, 'Salaries Payable');
assert.equal(g22_B6.lines[0].category, 'LIABILITY');
assert.equal(g22_B6.lines[0].debit, 4000);
assert.equal(g22_B6.lines[1].accountName, 'Cash at Bank');
assert.equal(g22_B6.lines[1].category, 'ASSET');
assert.equal(g22_B6.lines[1].credit, 4000);
assert.equal(g22_B6.isBalanced, true);
const v22_B6 = validateJournalGroups([g22_B6], { rawQuery: q22_B6 });
assert.equal(v22_B6.isValid, true);

// 22_B7) Prior accrual settlement without payment method + follow-up
const q22_B7 = "Last month we accrued payroll of S$5,000 gross, S$1,000 employee CPF and S$850 employer CPF. Today we paid salaries and CPF.";
const p22_B7 = await parseAccountingQuery(q22_B7, null);
assert.equal(p22_B7.isComplete, false);
assert.ok(p22_B7.missingFields.some(f => f.fieldKey === 'salaryPaymentMethod'));
assert.ok(p22_B7.missingFields.some(f => f.fieldKey === 'cpfPaymentMethod'));

const p22_B7_bank = await parseAccountingQuery("by bank", p22_B7);
assert.equal(p22_B7_bank.isComplete, true);
assert.equal(p22_B7_bank.directGroups?.length, 1);
const g22_B7_bank = p22_B7_bank.directGroups[0];
assert.equal(g22_B7_bank.lines.length, 3);
assert.ok(g22_B7_bank.lines.every(l => l.category !== 'EXPENSE'), 'Must have zero EXPENSE lines');
assert.equal(g22_B7_bank.lines[0].accountName, 'Salaries Payable');
assert.equal(g22_B7_bank.lines[0].category, 'LIABILITY');
assert.equal(g22_B7_bank.lines[0].debit, 4000);
assert.equal(g22_B7_bank.lines[1].accountName, 'CPF Payable');
assert.equal(g22_B7_bank.lines[1].category, 'LIABILITY');
assert.equal(g22_B7_bank.lines[1].debit, 1850);
assert.equal(g22_B7_bank.lines[2].accountName, 'Cash at Bank');
assert.equal(g22_B7_bank.lines[2].category, 'ASSET');
assert.equal(g22_B7_bank.lines[2].credit, 5850);
assert.equal(g22_B7_bank.isBalanced, true);
const v22_B7_bank = validateJournalGroups([g22_B7_bank], { rawQuery: p22_B7_bank.rawQuery });
assert.equal(v22_B7_bank.isValid, true);

// 22_C8) Exact PR #26 Finding C prompt: annual depreciation
const q22_C8 = "Equipment costing S$48,000 with nil residual value and a four-year useful life. Record annual depreciation.";
const p22_C8 = await parseAccountingQuery(q22_C8, null);
assert.equal(p22_C8.isComplete, true);
assert.equal(p22_C8.directGroups?.length, 1);
const g22_C8 = p22_C8.directGroups[0];
assert.equal(g22_C8.lines.length, 2);
assert.equal(g22_C8.lines[0].accountName, 'Depreciation Expense');
assert.equal(g22_C8.lines[0].category, 'EXPENSE');
assert.equal(g22_C8.lines[0].debit, 12000);
assert.equal(g22_C8.lines[1].accountName, 'Accumulated Depreciation — Equipment');
assert.equal(g22_C8.lines[1].category, 'ASSET');
assert.equal(g22_C8.lines[1].credit, 12000);
assert.equal(g22_C8.isBalanced, true);
const v22_C8 = validateJournalGroups([g22_C8], { rawQuery: q22_C8 });
assert.equal(v22_C8.isValid, true);

// 22_C9) Exact PR #26 Finding C prompt: quarterly depreciation
const q22_C9 = "Equipment costing S$48,000 with nil residual value and a four-year useful life. Record quarterly depreciation.";
const p22_C9 = await parseAccountingQuery(q22_C9, null);
assert.equal(p22_C9.isComplete, true);
assert.equal(p22_C9.directGroups?.length, 1);
const g22_C9 = p22_C9.directGroups[0];
assert.equal(g22_C9.lines.length, 2);
assert.equal(g22_C9.lines[0].accountName, 'Depreciation Expense');
assert.equal(g22_C9.lines[0].category, 'EXPENSE');
assert.equal(g22_C9.lines[0].debit, 3000);
assert.equal(g22_C9.lines[1].accountName, 'Accumulated Depreciation — Equipment');
assert.equal(g22_C9.lines[1].category, 'ASSET');
assert.equal(g22_C9.lines[1].credit, 3000);
assert.equal(g22_C9.isBalanced, true);
const v22_C9 = validateJournalGroups([g22_C9], { rawQuery: q22_C9 });
assert.equal(v22_C9.isValid, true);

// 22_C10) "6 months of depreciation"
const q22_C10 = "Record 6 months of depreciation on equipment costing S$48,000 with nil residual value and a four-year useful life.";
const p22_C10 = await parseAccountingQuery(q22_C10, null);
assert.equal(p22_C10.isComplete, true);
assert.equal(p22_C10.directGroups?.length, 1);
const g22_C10 = p22_C10.directGroups[0];
assert.equal(g22_C10.lines.length, 2);
assert.equal(g22_C10.lines[0].accountName, 'Depreciation Expense');
assert.equal(g22_C10.lines[0].category, 'EXPENSE');
assert.equal(g22_C10.lines[0].debit, 6000);
assert.equal(g22_C10.lines[1].accountName, 'Accumulated Depreciation — Equipment');
assert.equal(g22_C10.lines[1].category, 'ASSET');
assert.equal(g22_C10.lines[1].credit, 6000);
assert.equal(g22_C10.isBalanced, true);
const v22_C10 = validateJournalGroups([g22_C10], { rawQuery: q22_C10 });
assert.equal(v22_C10.isValid, true);

// 22_C11) Quarterly intangible amortisation — 4-year & 24-month
const q22_C11a = "Software licence costing S$24,000 with nil residual value and a four-year useful life. Record quarterly amortisation.";
const p22_C11a = await parseAccountingQuery(q22_C11a, null);
assert.equal(p22_C11a.isComplete, true);
assert.equal(p22_C11a.directGroups?.length, 1);
const g22_C11a = p22_C11a.directGroups[0];
assert.equal(g22_C11a.lines.length, 2);
assert.equal(g22_C11a.lines[0].accountName, 'Amortisation Expense');
assert.equal(g22_C11a.lines[0].category, 'EXPENSE');
assert.equal(g22_C11a.lines[0].debit, 1500);
assert.equal(g22_C11a.lines[1].accountName, 'Accumulated Amortisation — Software');
assert.equal(g22_C11a.lines[1].category, 'ASSET');
assert.equal(g22_C11a.lines[1].credit, 1500);
assert.equal(g22_C11a.isBalanced, true);
const v22_C11a = validateJournalGroups([g22_C11a], { rawQuery: q22_C11a });
assert.equal(v22_C11a.isValid, true);

const q22_C11b = "Software licence costing S$24,000 with nil residual value and a 24-month useful life. Record quarterly amortisation.";
const p22_C11b = await parseAccountingQuery(q22_C11b, null);
assert.equal(p22_C11b.isComplete, true);
assert.equal(p22_C11b.directGroups?.length, 1);
const g22_C11b = p22_C11b.directGroups[0];
assert.equal(g22_C11b.lines.length, 2);
assert.equal(g22_C11b.lines[0].accountName, 'Amortisation Expense');
assert.equal(g22_C11b.lines[0].category, 'EXPENSE');
assert.equal(g22_C11b.lines[0].debit, 3000);
assert.equal(g22_C11b.lines[1].accountName, 'Accumulated Amortisation — Software');
assert.equal(g22_C11b.lines[1].category, 'ASSET');
assert.equal(g22_C11b.lines[1].credit, 3000);
assert.equal(g22_C11b.isBalanced, true);
const v22_C11b = validateJournalGroups([g22_C11b], { rawQuery: q22_C11b });
assert.equal(v22_C11b.isValid, true);

// 22_C12) Missing period fails closed + "quarterly" and "semi-annual" follow-ups
const q22_C12 = "Equipment costing S$48,000 with nil residual value and a four-year useful life. Record depreciation.";
const p22_C12 = await parseAccountingQuery(q22_C12, null);
assert.equal(p22_C12.isComplete, false);
assert.ok(p22_C12.missingFields.some(f => f.fieldKey === 'periodCharge'));

// Follow-up "quarterly"
const p22_C12_q = await parseAccountingQuery("quarterly", p22_C12);
assert.equal(p22_C12_q.isComplete, true);
assert.equal(p22_C12_q.directGroups?.length, 1);
const g22_C12_q = p22_C12_q.directGroups[0];
assert.equal(g22_C12_q.lines[0].accountName, 'Depreciation Expense');
assert.equal(g22_C12_q.lines[0].category, 'EXPENSE');
assert.equal(g22_C12_q.lines[0].debit, 3000);
assert.equal(g22_C12_q.lines[1].accountName, 'Accumulated Depreciation — Equipment');
assert.equal(g22_C12_q.lines[1].category, 'ASSET');
assert.equal(g22_C12_q.lines[1].credit, 3000);
assert.equal(g22_C12_q.isBalanced, true);
const v22_C12_q = validateJournalGroups([g22_C12_q], { rawQuery: p22_C12_q.rawQuery });
assert.equal(v22_C12_q.isValid, true);

// Follow-up "semi-annual"
const p22_C12_sa = await parseAccountingQuery("semi-annual", p22_C12);
assert.equal(p22_C12_sa.isComplete, true);
assert.equal(p22_C12_sa.directGroups?.length, 1);
const g22_C12_sa = p22_C12_sa.directGroups[0];
assert.equal(g22_C12_sa.lines[0].accountName, 'Depreciation Expense');
assert.equal(g22_C12_sa.lines[0].category, 'EXPENSE');
assert.equal(g22_C12_sa.lines[0].debit, 6000);
assert.equal(g22_C12_sa.lines[1].accountName, 'Accumulated Depreciation — Equipment');
assert.equal(g22_C12_sa.lines[1].category, 'ASSET');
assert.equal(g22_C12_sa.lines[1].credit, 6000);
assert.equal(g22_C12_sa.isBalanced, true);
const v22_C12_sa = validateJournalGroups([g22_C12_sa], { rawQuery: p22_C12_sa.rawQuery });
assert.equal(v22_C12_sa.isValid, true);

// 22_D8) Direct equity deferred tax location follow-up
const q22_D8 = "Recognise an increase in deferred tax liability of S$5,000 on an item recognised directly in equity.";
const p22_D8 = await parseAccountingQuery(q22_D8, null);
assert.equal(p22_D8.isComplete, false);
assert.ok(p22_D8.missingFields.some(f => f.fieldKey === 'deferredTaxRecognitionLocation'));

const p22_D8_re = await parseAccountingQuery("Retained Earnings", p22_D8);
assert.equal(p22_D8_re.isComplete, true);
assert.equal(p22_D8_re.directGroups?.length, 1);
const g22_D8_re = p22_D8_re.directGroups[0];
assert.equal(g22_D8_re.lines.length, 2);
assert.equal(g22_D8_re.lines[0].accountName, 'Retained Earnings');
assert.equal(g22_D8_re.lines[0].category, 'EQUITY');
assert.equal(g22_D8_re.lines[0].debit, 5000);
assert.equal(g22_D8_re.lines[1].accountName, 'Deferred Tax Liability');
assert.equal(g22_D8_re.lines[1].category, 'LIABILITY');
assert.equal(g22_D8_re.lines[1].credit, 5000);
assert.ok(!g22_D8_re.lines.some(l => l.accountName === 'Income Tax Expense'), 'Must NOT affect P&L');
assert.equal(g22_D8_re.isBalanced, true);
const v22_D8_re = validateJournalGroups([g22_D8_re], { rawQuery: p22_D8_re.rawQuery });
assert.equal(v22_D8_re.isValid, true);

// 22_D9) Single-turn deferred tax charged directly to Retained Earnings
const q22_D9 = "Recognise an increase in deferred tax liability of S$5,000 charged directly to Retained Earnings.";
const p22_D9 = await parseAccountingQuery(q22_D9, null);
assert.equal(p22_D9.isComplete, true);
assert.equal(p22_D9.directGroups?.length, 1);
const g22_D9 = p22_D9.directGroups[0];
assert.equal(g22_D9.lines.length, 2);
assert.equal(g22_D9.lines[0].accountName, 'Retained Earnings');
assert.equal(g22_D9.lines[0].category, 'EQUITY');
assert.equal(g22_D9.lines[0].debit, 5000);
assert.equal(g22_D9.lines[1].accountName, 'Deferred Tax Liability');
assert.equal(g22_D9.lines[1].category, 'LIABILITY');
assert.equal(g22_D9.lines[1].credit, 5000);
assert.ok(!g22_D9.lines.some(l => l.accountName === 'Income Tax Expense'), 'Must NOT affect P&L');
assert.equal(g22_D9.isBalanced, true);
const v22_D9 = validateJournalGroups([g22_D9], { rawQuery: q22_D9 });
assert.equal(v22_D9.isValid, true);

// 22_D10) Share issue costs amount protection (never posting 20,000 as DTA)
const q22_D10 = "Recognise deferred tax asset on share issue costs of S$20,000.";
const p22_D10 = await parseAccountingQuery(q22_D10, null);
assert.equal(p22_D10.isComplete, false);
assert.ok(p22_D10.missingFields.some(f => f.fieldKey === 'taxAmount'));
assert.ok(!p22_D10.directGroups?.some(g => g.lines.some(l => l.accountName === 'Deferred Tax Asset' && l.debit === 20000)));

// 22_E3) Follow-up "S$15,000" exceeding prepaid balance on p21_1a fails closed, subsequent "S$3,000" completes
const p22_E3_exceed = await parseAccountingQuery("S$15,000", p21_1a);
assert.equal(p22_E3_exceed.isComplete, false, 'Expired amount exceeding prepaid balance must fail closed');
assert.ok(p22_E3_exceed.missingFields.some(f => f.fieldKey === 'periodCharge'));

const p22_E3_valid = await parseAccountingQuery("S$3,000", p22_E3_exceed);
assert.equal(p22_E3_valid.isComplete, true);
assert.equal(p22_E3_valid.directGroups?.length, 1);
const g22_E3_valid = p22_E3_valid.directGroups[0];
assert.equal(g22_E3_valid.lines[0].accountName, 'Insurance Expense');
assert.equal(g22_E3_valid.lines[0].category, 'EXPENSE');
assert.equal(g22_E3_valid.lines[0].debit, 3000);
assert.equal(g22_E3_valid.lines[1].accountName, 'Prepaid Insurance');
assert.equal(g22_E3_valid.lines[1].category, 'ASSET');
assert.equal(g22_E3_valid.lines[1].credit, 3000);
assert.equal(g22_E3_valid.isBalanced, true);
const v22_E3_valid = validateJournalGroups([g22_E3_valid], { rawQuery: p22_E3_valid.rawQuery });
assert.equal(v22_E3_valid.isValid, true);

// 22_E4) Single-turn prepaid balance vs expired amount exceeding balance fails closed
const q22_E4 = "Prepaid insurance balance is S$12,000; S$15,000 has expired. Record insurance expense.";
const p22_E4 = await parseAccountingQuery(q22_E4, null);
assert.equal(p22_E4.isComplete, false, 'Expired amount exceeding prepaid balance in single turn must fail closed');
assert.ok(p22_E4.missingFields.some(f => f.fieldKey === 'periodCharge'));

// 22_E5a) Finding 1 High: Exceeding balance ceiling in base query even with explicit expired phrase
const q22_E5a = "Prepaid insurance balance is S$12,000; S$3,000 of prepaid insurance has expired; stated periodic charge is SGD 15,000. Record insurance expense.";
const p22_E5a = await parseAccountingQuery(q22_E5a, null);
assert.equal(p22_E5a.isComplete, false, 'Expired amount exceeding balance must fail closed even when base had explicit expired phrase');
assert.equal(p22_E5a.directGroups?.length ?? 0, 0);
assert.ok(p22_E5a.missingFields.some(f => f.fieldKey === 'periodCharge'));

// 22_E5b) Finding 1 High: Conflicting stated charge within balance ceiling check + valid follow-up
const q22_E5b = "Prepaid insurance balance is S$12,000; S$3,000 of prepaid insurance has expired; stated periodic charge is SGD 5,000. Record insurance expense.";
const p22_E5b = await parseAccountingQuery(q22_E5b, null);
assert.equal(p22_E5b.isComplete, false, 'Conflicting stated charge within balance ceiling must fail closed');
assert.equal(p22_E5b.directGroups?.length ?? 0, 0);
assert.ok(p22_E5b.missingFields.some(f => f.fieldKey === 'periodCharge'));

// Follow-up S$20,000 still fails closed (exceeds balance ceiling)
const p22_E5b_fail = await parseAccountingQuery("S$20,000", p22_E5b);
assert.equal(p22_E5b_fail.isComplete, false);

// Follow-up S$3,000 completes Dr Insurance Expense 3,000 / Cr Prepaid Insurance 3,000
const p22_E5b_valid = await parseAccountingQuery("S$3,000", p22_E5b);
assert.equal(p22_E5b_valid.isComplete, true);
assert.equal(p22_E5b_valid.directGroups?.length, 1);
assert.equal(p22_E5b_valid.directGroups[0].lines[0].accountName, 'Insurance Expense');
assert.equal(p22_E5b_valid.directGroups[0].lines[0].debit, 3000);
assert.equal(p22_E5b_valid.directGroups[0].lines[1].accountName, 'Prepaid Insurance');
assert.equal(p22_E5b_valid.directGroups[0].lines[1].credit, 3000);
assert.equal(p22_E5b_valid.directGroups[0].isBalanced, true);

// 22_E6) Conflicting expired amounts in single turn fails closed, valid follow-up completes
const q22_E6 = "Prepaid insurance balance is S$12,000; S$3,000 has expired and S$5,000 has expired. Record insurance expense.";
const p22_E6 = await parseAccountingQuery(q22_E6, null);
assert.equal(p22_E6.isComplete, false, 'Multiple conflicting expired amounts in single query must fail closed');
assert.ok(p22_E6.missingFields.some(f => f.fieldKey === 'periodCharge'));

const p22_E6_res = await parseAccountingQuery("S$4,000", p22_E6);
assert.equal(p22_E6_res.isComplete, true);
assert.equal(p22_E6_res.directGroups?.length, 1);
assert.equal(p22_E6_res.directGroups[0].lines[0].debit, 4000);
assert.equal(p22_E6_res.directGroups[0].lines[1].credit, 4000);
assert.equal(p22_E6_res.directGroups[0].isBalanced, true);

// 22_E7) Formula calculation vs stated explicit expired amount conflict fails closed
const q22_E7 = "Prepaid insurance balance is S$12,000 covering 12 months with 3 months elapsed; S$5,000 has expired. Record insurance expense.";
const p22_E7 = await parseAccountingQuery(q22_E7, null);
assert.equal(p22_E7.isComplete, false, 'Stated expired amount conflicting with elapsed pro-rata calculation must fail closed');
assert.ok(p22_E7.missingFields.some(f => f.fieldKey === 'periodCharge'));

// 22_B8) Finding 2 Medium: Prior payroll accrual with negated settlement must NOT create expense lines or groups
const q22_B8 = "Previously accrued payroll: gross salaries S$5,000, employee CPF S$1,000, employer CPF S$850; no settlement was made.";
const p22_B8 = await parseAccountingQuery(q22_B8, null);
assert.equal(p22_B8.isComplete, false, 'Prior accrual with negated settlement must fail closed');
assert.equal(p22_B8.directGroups?.length ?? 0, 0, 'Must produce 0 groups');
assert.ok(p22_B8.missingFields.some(f => f.fieldKey === 'payrollSettlementTarget'));

const p22_B8_sal = await parseAccountingQuery("salaries by bank", p22_B8);
assert.equal(p22_B8_sal.isComplete, true);
assert.equal(p22_B8_sal.directGroups?.length, 1);
const g22_B8_sal = p22_B8_sal.directGroups[0];
assert.ok(g22_B8_sal.lines.every(l => l.category !== 'EXPENSE'), 'Must have ZERO EXPENSE lines upon liability settlement');
assert.equal(g22_B8_sal.lines[0].accountName, 'Salaries Payable');
assert.equal(g22_B8_sal.lines[0].debit, 4000);
assert.equal(g22_B8_sal.lines[1].accountName, 'Cash at Bank');
assert.equal(g22_B8_sal.lines[1].credit, 4000);
assert.equal(g22_B8_sal.isBalanced, true);

// 22_B9) Additional negated variants + single-leg negated settlement + current-period control check
// Variant A: Prior payroll accrual text
const q22_B9a = "Last month we accrued payroll of S$5,000 gross, S$1,000 employee CPF and S$850 employer CPF. No settlement was made.";
const p22_B9a = await parseAccountingQuery(q22_B9a, null);
assert.equal(p22_B9a.isComplete, false);
assert.equal(p22_B9a.directGroups?.length ?? 0, 0);

// Variant B: Both liabilities explicit with negated settlement
const q22_B9b = "Salaries payable of S$4,000 and CPF payable of S$1,850; settlement was not made.";
const p22_B9b = await parseAccountingQuery(q22_B9b, null);
assert.equal(p22_B9b.isComplete, false);
assert.equal(p22_B9b.directGroups?.length ?? 0, 0);
assert.ok(p22_B9b.missingFields.some(f => f.fieldKey === 'payrollSettlementTarget'));

// Variant C: Single-leg salaries payable with negated settlement
const q22_B9c = "Salaries payable of S$4,000; no settlement was made.";
const p22_B9c = await parseAccountingQuery(q22_B9c, null);
assert.equal(p22_B9c.isComplete, false);
assert.equal(p22_B9c.directGroups?.length ?? 0, 0);

// Variant D: Single-leg CPF payable with negated settlement
const q22_B9d = "CPF payable of S$1,850; no settlement was made.";
const p22_B9d = await parseAccountingQuery(q22_B9d, null);
assert.equal(p22_B9d.isComplete, false);
assert.equal(p22_B9d.directGroups?.length ?? 0, 0);

// Control: Current period accrual without prior context is unaffected
const q22_B9_ctrl = "Monthly payroll: gross salaries S$5,000, employee CPF S$1,000, employer CPF S$850; no settlement was made.";
const p22_B9_ctrl = await parseAccountingQuery(q22_B9_ctrl, null);
assert.equal(p22_B9_ctrl.isComplete, true, 'Current period payroll with no settlement recognises current expense and liabilities');
assert.equal(p22_B9_ctrl.directGroups?.length, 1);
const g22_B9_ctrl = p22_B9_ctrl.directGroups[0];
assert.equal(g22_B9_ctrl.lines.length, 4);
assert.equal(g22_B9_ctrl.lines[0].accountName, 'Salaries and Wages Expense');
assert.equal(g22_B9_ctrl.lines[0].debit, 5000);
assert.equal(g22_B9_ctrl.lines[1].accountName, 'Employer CPF Contribution Expense');
assert.equal(g22_B9_ctrl.lines[1].debit, 850);
assert.equal(g22_B9_ctrl.lines[2].accountName, 'Salaries Payable');
assert.equal(g22_B9_ctrl.lines[2].credit, 4000);
assert.equal(g22_B9_ctrl.lines[3].accountName, 'CPF Payable');
assert.equal(g22_B9_ctrl.lines[3].credit, 1850);
assert.equal(g22_B9_ctrl.isBalanced, true);

// 22_B10) PR #26 Reviewer Finding: Distinguish completed payroll settlement from future, conditional, scheduled, and pending settlement

// 1. Exact reviewer prompt 1: "has yet to be made"
const q22_B10a = "Salaries payable of S$4,000 and CPF payable of S$1,850; settlement has yet to be made by bank.";
const p22_B10a = await parseAccountingQuery(q22_B10a, null);
assert.equal(p22_B10a.isComplete, false, 'Pending/unexecuted settlement must fail closed');
assert.equal(p22_B10a.directGroups?.length ?? 0, 0, 'Must produce 0 groups');
assert.ok(p22_B10a.missingFields.some(f => f.fieldKey === 'payrollSettlementTarget'), 'Must request payrollSettlementTarget');

// 2. Exact reviewer prompt 2: "will be made"
const q22_B10b = "Salaries payable of S$4,000 and CPF payable of S$1,850; settlement will be made by bank next week.";
const p22_B10b = await parseAccountingQuery(q22_B10b, null);
assert.equal(p22_B10b.isComplete, false, 'Future settlement must fail closed');
assert.equal(p22_B10b.directGroups?.length ?? 0, 0, 'Must produce 0 groups');
assert.ok(p22_B10b.missingFields.some(f => f.fieldKey === 'payrollSettlementTarget'), 'Must request payrollSettlementTarget');

// 3. Required negative 3: "scheduled for payment"
const q22_B10c1 = "Salaries payable of S$4,000 and CPF payable of S$1,850; scheduled for payment by bank.";
const p22_B10c1 = await parseAccountingQuery(q22_B10c1, null);
assert.equal(p22_B10c1.isComplete, false);
assert.equal(p22_B10c1.directGroups?.length ?? 0, 0);
assert.ok(p22_B10c1.missingFields.some(f => f.fieldKey === 'payrollSettlementTarget'));

const q22_B10c2 = "Salaries payable of S$4,000 and CPF payable of S$1,850 are scheduled for payment by bank transfer.";
const p22_B10c2 = await parseAccountingQuery(q22_B10c2, null);
assert.equal(p22_B10c2.isComplete, false);
assert.equal(p22_B10c2.directGroups?.length ?? 0, 0);
assert.ok(p22_B10c2.missingFields.some(f => f.fieldKey === 'payrollSettlementTarget'));

// 4. Required negative 4: "should be paid"
const q22_B10d1 = "Salaries payable of S$4,000 and CPF payable of S$1,850; should be paid by bank.";
const p22_B10d1 = await parseAccountingQuery(q22_B10d1, null);
assert.equal(p22_B10d1.isComplete, false);
assert.equal(p22_B10d1.directGroups?.length ?? 0, 0);
assert.ok(p22_B10d1.missingFields.some(f => f.fieldKey === 'payrollSettlementTarget'));

const q22_B10d2 = "Salaries payable of S$4,000 and CPF payable of S$1,850 should be paid by bank transfer.";
const p22_B10d2 = await parseAccountingQuery(q22_B10d2, null);
assert.equal(p22_B10d2.isComplete, false);
assert.equal(p22_B10d2.directGroups?.length ?? 0, 0);
assert.ok(p22_B10d2.missingFields.some(f => f.fieldKey === 'payrollSettlementTarget'));

// 5. Prior-accrual breakdown negative variants
const priorNegativeVariants = [
  "Previously accrued payroll: gross salaries S$5,000, employee CPF S$1,000, employer CPF S$850; settlement will be made by bank next week.",
  "Previously accrued payroll: gross salaries S$5,000, employee CPF S$1,000, employer CPF S$850; scheduled for payment by bank.",
  "Previously accrued payroll: gross salaries S$5,000, employee CPF S$1,000, employer CPF S$850; should be paid by bank.",
  "Previously accrued payroll: gross salaries S$5,000, employee CPF S$1,000, employer CPF S$850; settlement has yet to be made."
];
for (const q of priorNegativeVariants) {
  const p = await parseAccountingQuery(q, null);
  assert.equal(p.isComplete, false, `Prior accrual negative variant must fail closed: "${q}"`);
  assert.equal(p.directGroups?.length ?? 0, 0, `Must have 0 groups: "${q}"`);
}

// 5b. Nominal conditional/pending bypass variants
const nominalPendingOrConditionalVariants = [
  "Settlement of salaries payable S$4,000 and CPF payable S$1,850 by bank subject to approval.",
  "Settlement of salaries payable of S$4,000 and CPF payable of S$1,850 if paid by bank.",
  "Settlement of salaries payable S$4,000 and CPF payable S$1,850 awaiting bank transfer.",
  "Settlement of salaries payable S$4,000 and CPF payable S$1,850 pending payment by bank."
];
for (const q of nominalPendingOrConditionalVariants) {
  const p = await parseAccountingQuery(q, null);
  assert.equal(p.isComplete, false, `Nominal pending/conditional query must fail closed: "${q}"`);
  assert.equal(p.directGroups?.length ?? 0, 0, `Must have 0 groups: "${q}"`);
}

// 6. Single-leg negative variants across future/pending/scheduled/conditional predicates
const singleLegNegatives = [
  "Salaries payable of S$4,000; settlement has yet to be made by bank.",
  "Salaries payable of S$4,000; settlement will be made by bank next week.",
  "Salaries payable of S$4,000; scheduled for payment by bank.",
  "Salaries payable of S$4,000; should be paid by bank.",
  "CPF payable of S$1,850; settlement has yet to be made by bank.",
  "CPF payable of S$1,850; settlement will be made by bank next week.",
  "CPF payable of S$1,850; scheduled for payment by bank.",
  "CPF payable of S$1,850; should be paid by bank."
];
for (const q of singleLegNegatives) {
  const p = await parseAccountingQuery(q, null);
  assert.equal(p.isComplete, false, `Single-leg negative variant must fail closed: "${q}"`);
  assert.equal(p.directGroups?.length ?? 0, 0, `Must have 0 groups: "${q}"`);
}

// 6b. Post-verbal conditional test
const q22_B10_postVerbalCond = "Salaries payable of S$4,000 and CPF payable of S$1,850; pay by bank if approved.";
const p22_B10_postVerbalCond = await parseAccountingQuery(q22_B10_postVerbalCond, null);
assert.equal(p22_B10_postVerbalCond.isComplete, false);
assert.equal(p22_B10_postVerbalCond.directGroups?.length ?? 0, 0);

// 7. Mixed-leg partial settlement: Salaries paid, CPF future
const q22_B10_mixed = "Salaries payable of S$4,000 paid by bank; CPF payable of S$1,850 will be paid by bank next week.";
const p22_B10_mixed = await parseAccountingQuery(q22_B10_mixed, null);
assert.equal(p22_B10_mixed.isComplete, true, 'Partially settled prior liabilities must complete settled leg');
assert.equal(p22_B10_mixed.directGroups?.length, 1);
const g22_B10_mixed = p22_B10_mixed.directGroups[0];
assert.equal(g22_B10_mixed.lines.length, 2);
assert.ok(g22_B10_mixed.lines.every(l => l.category !== 'EXPENSE'), 'Must have zero EXPENSE lines');
assert.ok(g22_B10_mixed.lines.every(l => !/cpf/i.test(l.accountName)), 'Must have zero CPF lines');
assert.equal(g22_B10_mixed.lines[0].accountName, 'Salaries Payable');
assert.equal(g22_B10_mixed.lines[0].debit, 4000);
assert.equal(g22_B10_mixed.lines[1].accountName, 'Cash at Bank');
assert.equal(g22_B10_mixed.lines[1].credit, 4000);
assert.equal(g22_B10_mixed.isBalanced, true);
const v22_B10_mixed = validateJournalGroups([g22_B10_mixed], { rawQuery: q22_B10_mixed });
assert.equal(v22_B10_mixed.isValid, true);

// 7b. Multi-clause passive paid + second-clause conditional test
const q22_B10_splitCond = "Salaries payable of S$4,000 were paid by bank; CPF payable of S$1,850 will be paid if approved.";
const p22_B10_splitCond = await parseAccountingQuery(q22_B10_splitCond, null);
assert.equal(p22_B10_splitCond.isComplete, true);
assert.equal(p22_B10_splitCond.directGroups?.length, 1);
const g22_B10_splitCond = p22_B10_splitCond.directGroups[0];
assert.equal(g22_B10_splitCond.lines.length, 2);
assert.ok(g22_B10_splitCond.lines.every(l => l.category !== 'EXPENSE'));
assert.ok(g22_B10_splitCond.lines.every(l => !/cpf/i.test(l.accountName)));
assert.equal(g22_B10_splitCond.lines[0].accountName, 'Salaries Payable');
assert.equal(g22_B10_splitCond.lines[0].debit, 4000);
assert.equal(g22_B10_splitCond.lines[1].accountName, 'Cash at Bank');
assert.equal(g22_B10_splitCond.lines[1].credit, 4000);
assert.equal(g22_B10_splitCond.isBalanced, true);

// 8. Follow-up checks on p22_B10a / p22_B10b
// 8a) Follow-up "will be paid next week" on p22_B10a remains incomplete
const p22_B10a_f1 = await parseAccountingQuery("will be paid next week", p22_B10a);
assert.equal(p22_B10a_f1.isComplete, false);
assert.equal(p22_B10a_f1.directGroups?.length ?? 0, 0);

// 8a2) Conditional follow-up "if approved by bank" on p22_B10a remains incomplete with 0 groups
const p22_B10a_f_cond = await parseAccountingQuery("if approved by bank", p22_B10a);
assert.equal(p22_B10a_f_cond.isComplete, false);
assert.equal(p22_B10a_f_cond.directGroups?.length ?? 0, 0);

// 8b) Follow-up "salaries in cash" on p22_B10a completes Dr Salaries Payable 4,000 / Cr Cash 4,000 (no leakage of "by bank")
const p22_B10a_f2 = await parseAccountingQuery("salaries in cash", p22_B10a);
assert.equal(p22_B10a_f2.isComplete, true);
assert.equal(p22_B10a_f2.directGroups?.length, 1);
const g22_B10a_f2 = p22_B10a_f2.directGroups[0];
assert.equal(g22_B10a_f2.lines.length, 2);
assert.equal(g22_B10a_f2.lines[0].accountName, 'Salaries Payable');
assert.equal(g22_B10a_f2.lines[0].debit, 4000);
assert.equal(g22_B10a_f2.lines[1].accountName, 'Cash');
assert.equal(g22_B10a_f2.lines[1].credit, 4000);
assert.equal(g22_B10a_f2.isBalanced, true);

// 8c) Follow-up "both by bank" on p22_B10b completes settlement of both liabilities
const p22_B10b_f = await parseAccountingQuery("both by bank", p22_B10b);
assert.equal(p22_B10b_f.isComplete, true);
assert.equal(p22_B10b_f.directGroups?.length, 1);
const g22_B10b_f = p22_B10b_f.directGroups[0];
assert.equal(g22_B10b_f.lines.length, 3);
assert.equal(g22_B10b_f.lines[0].accountName, 'Salaries Payable');
assert.equal(g22_B10b_f.lines[0].debit, 4000);
assert.equal(g22_B10b_f.lines[1].accountName, 'CPF Payable');
assert.equal(g22_B10b_f.lines[1].debit, 1850);
assert.equal(g22_B10b_f.lines[2].accountName, 'Cash at Bank');
assert.equal(g22_B10b_f.lines[2].credit, 5850);
assert.equal(g22_B10b_f.isBalanced, true);

// 8d) Single-clause method leakage follow-up test
const q22_B10_sc = "Settlement of salaries payable of S$4,000 and CPF payable of S$1,850 has yet to be made by bank.";
const p22_B10_sc = await parseAccountingQuery(q22_B10_sc, null);
assert.equal(p22_B10_sc.isComplete, false);
assert.equal(p22_B10_sc.directGroups?.length ?? 0, 0);
const p22_B10_sc_f = await parseAccountingQuery("salaries in cash", p22_B10_sc);
assert.equal(p22_B10_sc_f.isComplete, true);
assert.equal(p22_B10_sc_f.directGroups?.length, 1);
const g22_B10_sc_f = p22_B10_sc_f.directGroups[0];
assert.equal(g22_B10_sc_f.lines.length, 2);
assert.equal(g22_B10_sc_f.lines[0].accountName, 'Salaries Payable');
assert.equal(g22_B10_sc_f.lines[0].debit, 4000);
assert.equal(g22_B10_sc_f.lines[1].accountName, 'Cash');
assert.equal(g22_B10_sc_f.lines[1].credit, 4000);
assert.equal(g22_B10_sc_f.isBalanced, true);

// 9. Current-period accrual control with future settlement: recognizes current expenses and liabilities (NOT bank outflow)
const q22_B10_cur = "Monthly payroll: gross salaries S$5,000, employee CPF S$1,000, employer CPF S$850; settlement will be made by bank next week.";
const p22_B10_cur = await parseAccountingQuery(q22_B10_cur, null);
assert.equal(p22_B10_cur.isComplete, true, 'Current period payroll with future settlement recognizes expenses and payables');
assert.equal(p22_B10_cur.directGroups?.length, 1);
const g22_B10_cur = p22_B10_cur.directGroups[0];
assert.equal(g22_B10_cur.lines.length, 4);
assert.equal(g22_B10_cur.lines[0].accountName, 'Salaries and Wages Expense');
assert.equal(g22_B10_cur.lines[0].debit, 5000);
assert.equal(g22_B10_cur.lines[1].accountName, 'Employer CPF Contribution Expense');
assert.equal(g22_B10_cur.lines[1].debit, 850);
assert.equal(g22_B10_cur.lines[2].accountName, 'Salaries Payable');
assert.equal(g22_B10_cur.lines[2].credit, 4000);
assert.equal(g22_B10_cur.lines[3].accountName, 'CPF Payable');
assert.equal(g22_B10_cur.lines[3].credit, 1850);
assert.ok(g22_B10_cur.lines.every(l => l.accountName !== 'Cash at Bank' && l.accountName !== 'Cash'), 'Must NOT credit cash or bank');
assert.equal(g22_B10_cur.isBalanced, true);

// 10. Valid completed-payment controls retained
// 10a) Explicit nominal passive completion: "settlement was made by bank"
const q22_B10_comp1 = "Salaries payable of S$4,000 and CPF payable of S$1,850; settlement was made by bank.";
const p22_B10_comp1 = await parseAccountingQuery(q22_B10_comp1, null);
assert.equal(p22_B10_comp1.isComplete, true);
assert.equal(p22_B10_comp1.directGroups?.length, 1);
const g22_B10_comp1 = p22_B10_comp1.directGroups[0];
assert.equal(g22_B10_comp1.lines.length, 3);
assert.equal(g22_B10_comp1.lines[0].accountName, 'Salaries Payable');
assert.equal(g22_B10_comp1.lines[0].debit, 4000);
assert.equal(g22_B10_comp1.lines[1].accountName, 'CPF Payable');
assert.equal(g22_B10_comp1.lines[1].debit, 1850);
assert.equal(g22_B10_comp1.lines[2].accountName, 'Cash at Bank');
assert.equal(g22_B10_comp1.lines[2].credit, 5850);
assert.equal(g22_B10_comp1.isBalanced, true);

// 10b) Passive verbal completion: "were settled by bank transfer"
const q22_B10_comp2 = "Salaries payable of S$4,000 and CPF payable of S$1,850 were settled by bank transfer.";
const p22_B10_comp2 = await parseAccountingQuery(q22_B10_comp2, null);
assert.equal(p22_B10_comp2.isComplete, true);
assert.equal(p22_B10_comp2.directGroups?.length, 1);
const g22_B10_comp2 = p22_B10_comp2.directGroups[0];
assert.equal(g22_B10_comp2.lines.length, 3);
assert.equal(g22_B10_comp2.lines[0].accountName, 'Salaries Payable');
assert.equal(g22_B10_comp2.lines[0].debit, 4000);
assert.equal(g22_B10_comp2.lines[1].accountName, 'CPF Payable');
assert.equal(g22_B10_comp2.lines[1].debit, 1850);
assert.equal(g22_B10_comp2.lines[2].accountName, 'Cash at Bank');
assert.equal(g22_B10_comp2.lines[2].credit, 5850);
assert.equal(g22_B10_comp2.isBalanced, true);

console.log('PASS | Double-entry reliability, deterministic integrity, and guardrail validation');
