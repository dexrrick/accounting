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

console.log('PASS | Double-entry reliability, deterministic integrity, and guardrail validation');
