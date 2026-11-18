import assert from 'node:assert/strict';
import {
  processAccountingQuery,
  isMeaningfulAIJsonPayload,
  extractDocAttributedTextFacts,
  extractDocRefsFromImages,
  resolveTargetPendingImageIndices
} from '../../src/services/geminiService.ts';
import { repairAndParseAIJson } from '../../src/utils/jsonRepair.ts';
import {
  validateJournalGroups,
  inferAccountCategoryFromName,
  getMandatoryCategory,
  extractDerivableNumbers,
  buildDerivableCents
} from '../../src/verification/journalIntegrity.ts';
import { extractAccountingContext, deriveAccountingStateFromEvents } from '../../src/services/conversationAccountingState.ts';
import {
  postProcessAIResponse,
  normalizeAccountCategory,
  buildGroundedReasoningContext,
  formatGroundedSystemPrompt,
  journalGroupFingerprint,
  resolveAndApplyJournalRevisions,
  extractDocRefOccurrences,
  extractNormalizedDocRefs
} from '../../src/services/groundingContextBuilder.ts';
import { formatSingaporeDate, getSingaporeDateString } from '../../src/utils/dateUtils.ts';

console.log('================================================================');
console.log('🧪 RUNNING AI-FIRST DOUBLE-ENTRY ARCHITECTURE REGRESSION SUITE');
console.log('================================================================\n');

let passed = 0;

function makeGeminiSuccessResponse(payloadObj) {
  return new Response(JSON.stringify({
    candidates: [{
      content: {
        parts: [{ text: JSON.stringify(payloadObj) }]
      }
    }],
    usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function makeOpenAISuccessResponse(payloadObj) {
  return new Response(JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify(payloadObj)
      }
    }],
    usage: { prompt_tokens: 150, completion_tokens: 200 }
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const origFetch = globalThis.fetch;

try {
  // --------------------------------------------------------------------------
  // 1. Single Primary AI Call Across All 3 Providers
  // --------------------------------------------------------------------------
  console.log('--- 1. Single Primary AI Call (calls === 1) Across Providers ---');

  // 1A: Gemini Provider
  {
    const fetchCalls = [];
    globalThis.fetch = async (url, opts) => {
      fetchCalls.push({ url: String(url), method: opts?.method });
      return makeGeminiSuccessResponse({
        responseKind: 'JOURNAL_ENTRY',
        transactionTitle: 'Office Equipment Purchase',
        accountingTreatmentSummary: 'Recognize office equipment at cost under SFRS(I) 1-16.',
        directGroups: [{
          id: 'grp-1',
          eventDate: '01/02/2025',
          title: 'Acquisition of Office Equipment',
          summary: 'Purchase of equipment for S$5,000 paid by bank transfer',
          lines: [
            { accountName: 'Office Equipment', category: 'ASSET', debit: 5000, credit: 0 },
            { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 5000 }
          ]
        }]
      });
    };

    const res = await processAccountingQuery(
      'Company bought office equipment for S$5,000 paid by bank transfer. What is the double entry?',
      null,
      'SFRS_I',
      {
        activeProvider: 'gemini',
        gemini: { apiKey: 'test-gemini-key-long-enough-12345', model: 'gemini-3.5-flash-lite' },
        openai: { apiKey: '', model: 'gpt-4o' },
        azure: { apiKey: '', endpoint: '', deploymentName: 'gpt-4o', apiVersion: '2024-08-01-preview' }
      },
      'gemini-3.5-flash-lite',
      [],
      { journal: true }
    );

    assert.equal(fetchCalls.length, 1, `Gemini must make exactly 1 HTTP request, got ${fetchCalls.length}`);
    assert.ok(fetchCalls[0].url.includes('streamGenerateContent') || fetchCalls[0].url.includes('generateContent'), 'Must call Gemini generateContent or streamGenerateContent endpoint directly');
    assert.equal(res.scenarioState.directGroups?.length, 1);
    assert.equal(res.scenarioState.directGroups[0].totalDebit, 5000);
    console.log('✓ 1A. Gemini single primary AI call verified');
    passed++;
  }

  // 1B: OpenAI Provider
  {
    const fetchCalls = [];
    globalThis.fetch = async (url, opts) => {
      fetchCalls.push({ url: String(url), method: opts?.method });
      return makeOpenAISuccessResponse({
        responseKind: 'JOURNAL_ENTRY',
        transactionTitle: 'Office Equipment Purchase',
        accountingTreatmentSummary: 'Recognize office equipment at cost under SFRS(I) 1-16.',
        directGroups: [{
          id: 'grp-1',
          eventDate: '01/02/2025',
          title: 'Acquisition of Office Equipment',
          summary: 'Purchase of equipment for S$5,000 paid by bank transfer',
          lines: [
            { accountName: 'Office Equipment', category: 'ASSET', debit: 5000, credit: 0 },
            { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 5000 }
          ]
        }]
      });
    };

    const res = await processAccountingQuery(
      'Company bought office equipment for S$5,000 paid by bank transfer. What is the double entry?',
      null,
      'SFRS_I',
      {
        activeProvider: 'openai',
        gemini: { apiKey: '', model: 'gemini-3.5-flash-lite' },
        openai: { apiKey: 'sk-test-openai-key-long-enough-12345', model: 'gpt-4o' },
        azure: { apiKey: '', endpoint: '', deploymentName: 'gpt-4o', apiVersion: '2024-08-01-preview' }
      },
      'gpt-4o',
      [],
      { journal: true }
    );

    assert.equal(fetchCalls.length, 1, `OpenAI must make exactly 1 HTTP request, got ${fetchCalls.length}`);
    assert.ok(fetchCalls[0].url.includes('api.openai.com/v1/chat/completions'), 'Must call OpenAI completions directly');
    assert.equal(res.scenarioState.directGroups?.length, 1);
    assert.equal(res.scenarioState.directGroups[0].totalDebit, 5000);
    console.log('✓ 1B. OpenAI single primary AI call verified');
    passed++;
  }

  // 1C: Azure OpenAI Provider
  {
    const fetchCalls = [];
    globalThis.fetch = async (url, opts) => {
      fetchCalls.push({ url: String(url), method: opts?.method });
      return makeOpenAISuccessResponse({
        responseKind: 'JOURNAL_ENTRY',
        transactionTitle: 'Office Equipment Purchase',
        accountingTreatmentSummary: 'Recognize office equipment at cost under SFRS(I) 1-16.',
        directGroups: [{
          id: 'grp-1',
          eventDate: '01/02/2025',
          title: 'Acquisition of Office Equipment',
          summary: 'Purchase of equipment for S$5,000 paid by bank transfer',
          lines: [
            { accountName: 'Office Equipment', category: 'ASSET', debit: 5000, credit: 0 },
            { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 5000 }
          ]
        }]
      });
    };

    const res = await processAccountingQuery(
      'Company bought office equipment for S$5,000 paid by bank transfer. What is the double entry?',
      null,
      'SFRS_I',
      {
        activeProvider: 'azure',
        gemini: { apiKey: '', model: 'gemini-3.5-flash-lite' },
        openai: { apiKey: '', model: 'gpt-4o' },
        azure: {
          apiKey: 'test-azure-key-12345',
          endpoint: 'https://test-resource.openai.azure.com',
          deploymentName: 'gpt-4o',
          apiVersion: '2024-08-01-preview'
        }
      },
      'gpt-4o',
      [],
      { journal: true }
    );

    assert.equal(fetchCalls.length, 1, `Azure OpenAI must make exactly 1 HTTP request, got ${fetchCalls.length}`);
    assert.ok(fetchCalls[0].url.includes('/openai/deployments/gpt-4o/chat/completions'), 'Must call Azure completions directly');
    assert.equal(res.scenarioState.directGroups?.length, 1);
    assert.equal(res.scenarioState.directGroups[0].totalDebit, 5000);
    console.log('✓ 1C. Azure OpenAI single primary AI call verified');
    passed++;
  }

  // --------------------------------------------------------------------------
  // 2. Unfamiliar Multi-Line / Multi-Event IFRS/SFRS(I) Scenarios
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Unfamiliar Multi-Line / Multi-Event IFRS/SFRS(I) Scenarios ---');

  // 2A: Hire Purchase Acquisition
  {
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Hire Purchase Acquisition of Motor Van',
      accountingTreatmentSummary: 'Recognize motor vehicle at cost with initial deposit paid and remaining obligation as hire purchase liability.',
      directGroups: [{
        id: 'grp-1',
        eventDate: '15/03/2025',
        title: 'Hire Purchase Acquisition',
        summary: 'Acquired delivery van for S$50,000: paid S$10,000 deposit by bank, S$40,000 financed via HP liability',
        lines: [
          { accountName: 'Delivery Van', category: 'ASSET', debit: 50000, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 10000 },
          { accountName: 'Hire Purchase Liability', category: 'LIABILITY', debit: 0, credit: 40000 }
        ]
      }]
    });

    const res = await processAccountingQuery(
      'Acquired a delivery van for S$50,000 on hire purchase, paying S$10,000 deposit from bank account with S$40,000 balance under hire purchase agreement.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res.scenarioState.directGroups?.length, 1);
    const grp = res.scenarioState.directGroups[0];
    assert.equal(grp.totalDebit, 50000);
    assert.equal(grp.totalCredit, 50000);
    assert.equal(grp.lines.find(l => l.accountName === 'Hire Purchase Liability')?.category, 'LIABILITY');
    assert.ok(grp.isBalanced);
    console.log('✓ 2A. Hire purchase acquisition compound entry verified');
    passed++;
  }

  // 2B: Intercompany Recharge & Settlement
  {
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Intercompany Service Recharge',
      accountingTreatmentSummary: 'Record recharge of shared service expenses to subsidiary as intercompany receivable and management fee income.',
      directGroups: [{
        id: 'grp-1',
        eventDate: '20/04/2025',
        title: 'Intercompany Recharge',
        summary: 'Recharged IT support costs of S$12,000 to related company',
        lines: [
          { accountName: 'Due from Related Company', category: 'ASSET', debit: 12000, credit: 0 },
          { accountName: 'Management Fee Revenue', category: 'REVENUE', debit: 0, credit: 12000 }
        ]
      }]
    });

    const res = await processAccountingQuery(
      'Recharged shared IT service costs of S$12,000 to related company on intercompany account.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res.scenarioState.directGroups?.length, 1);
    const grp = res.scenarioState.directGroups[0];
    assert.equal(grp.lines.find(l => l.accountName === 'Due from Related Company')?.category, 'ASSET');
    assert.equal(grp.totalDebit, 12000);
    console.log('✓ 2B. Intercompany recharge verified');
    passed++;
  }

  // 2C: Deferred Tax Liability Recognition (SFRS(I) 1-12)
  {
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Deferred Tax Provision on Accelerated Depreciation',
      accountingTreatmentSummary: 'Recognize deferred tax liability arising from taxable temporary difference between accounting depreciation and capital allowances under SFRS(I) 1-12.',
      directGroups: [{
        id: 'grp-1',
        eventDate: '31/12/2025',
        title: 'Deferred Tax Liability Provision',
        summary: 'Taxable temporary difference of S$30,000 at 17% corporate tax rate = S$5,100 deferred tax liability',
        lines: [
          { accountName: 'Income Tax Expense', category: 'EXPENSE', debit: 5100, credit: 0 },
          { accountName: 'Deferred Tax Liability — Accelerated Depreciation', category: 'LIABILITY', debit: 0, credit: 5100 }
        ]
      }]
    });

    const res = await processAccountingQuery(
      'Provide for deferred tax liability of S$5,100 on accelerated depreciation temporary difference of S$30,000 at 17% under SFRS(I) 1-12.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res.scenarioState.directGroups?.length, 1);
    const grp = res.scenarioState.directGroups[0];
    const dtlLine = grp.lines.find(l => l.accountName.includes('Deferred Tax Liability'));
    assert.equal(dtlLine?.category, 'LIABILITY', 'Deferred tax liability must be classified as LIABILITY despite containing the word depreciation');
    assert.equal(grp.totalDebit, 5100);
    console.log('✓ 2C. SFRS(I) 1-12 deferred tax liability category override verified');
    passed++;
  }

  // 2D: Multi-Step GST Sale & Collection
  {
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Standard-Rated Invoice with 9% GST',
      accountingTreatmentSummary: 'Recognize revenue net of GST with output GST payable under SFRS(I) 15 and Singapore GST Act.',
      directGroups: [{
        id: 'grp-1',
        eventDate: '10/05/2025',
        title: 'Customer Invoice (GST Inclusive)',
        summary: 'Issued invoice for S$10,900 inclusive of 9% GST (S$10,000 revenue + S$900 Output GST)',
        lines: [
          { accountName: 'Trade Receivables', category: 'ASSET', debit: 10900, credit: 0 },
          { accountName: 'Sales Revenue', category: 'REVENUE', debit: 0, credit: 10000 },
          { accountName: 'Output GST Payable', category: 'LIABILITY', debit: 0, credit: 900 }
        ]
      }]
    });

    const res = await processAccountingQuery(
      'Issued invoice for S$10,900 inclusive of 9% GST to customer on credit.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res.scenarioState.directGroups?.length, 1);
    const grp = res.scenarioState.directGroups[0];
    assert.equal(grp.totalDebit, 10900);
    assert.equal(grp.totalCredit, 10900);
    console.log('✓ 2D. Compound GST-inclusive invoice entry verified');
    passed++;
  }

  // --------------------------------------------------------------------------
  // 3. PR #26 Findings A, B, C, D & Adversarial Guardrails
  // --------------------------------------------------------------------------
  console.log('\n--- 3. PR #26 Findings A, B, C, D & Adversarial Guardrails ---');

  // Finding A: Bare nominal settlement phrase -> AI CLARIFICATION_REQUIRED
  {
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'CLARIFICATION_REQUIRED',
      transactionTitle: 'Pending Settlement Confirmation',
      accountingTreatmentSummary: 'A bare nominal statement of settlement does not confirm that payment has cleared bank accounts.',
      directGroups: [],
      missingFields: [{
        fieldKey: 'paymentConfirmation',
        fieldName: 'Payment Confirmation',
        prompt: 'Has the bank transfer of S$4,000 for salaries and S$1,850 for CPF been completed, or is payment still pending?',
        whyNeeded: 'Liabilities cannot be cleared from balance sheet until payment execution is confirmed.'
      }]
    });

    const res = await processAccountingQuery(
      'Settlement of salaries payable S$4,000 and CPF payable S$1,850 by bank transfer.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res.scenarioState.directGroups?.length, 0, 'CLARIFICATION_REQUIRED must not post journal groups');
    assert.equal(res.scenarioState.isComplete, false);
    assert.ok(res.scenarioState.missingFields.length > 0);
    assert.match(res.messageText, /Clarification Required/i);
    console.log('✓ 3A-1. Finding A nominal settlement phrase triggers CLARIFICATION_REQUIRED');
    passed++;
  }

  // Finding A: Zero-number query fabricating amounts rejected (UNSTATED_AMOUNT)
  {
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Settlement of Payroll Liabilities',
      directGroups: [{
        id: 'grp-1',
        eventDate: '01/03/2025',
        title: 'Settlement of Liabilities',
        summary: 'Paid liabilities by bank',
        lines: [
          { accountName: 'Salaries Payable', category: 'LIABILITY', debit: 4000, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 4000 }
        ]
      }]
    });

    const res = await processAccountingQuery(
      'Record the journal entry for settlement of salaries payable and CPF payable by bank transfer.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res.scenarioState.directGroups?.length, 0, 'Zero-number query fabricating amounts must be rejected');
    assert.match(res.messageText, /AI-Proposed Journal Rejected/i);
    assert.ok(res.scenarioState.missingFields.some(m => m.fieldKey === 'amount'));
    console.log('✓ 3A-2. Zero-number query fabricating amounts rejected (UNSTATED_AMOUNT)');
    passed++;
  }

  // Finding B: Mixed unrelated events with unstated rent amount
  {
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'CLARIFICATION_REQUIRED',
      transactionTitle: 'Separate Events & Missing Rent Amount',
      accountingTreatmentSummary: 'Two distinct events are described. Rent payment cannot be recorded without an amount, and payroll liabilities require payment status.',
      directGroups: [],
      missingFields: [
        {
          fieldKey: 'rentAmount',
          fieldName: 'Rent Amount',
          prompt: 'What was the amount paid for rent by bank transfer?',
          whyNeeded: 'Monetary amount is required to record the rent journal entry.'
        },
        {
          fieldKey: 'payrollStatus',
          fieldName: 'Payroll Liabilities Status',
          prompt: 'Were salaries payable (S$4,000) and CPF payable (S$1,850) also paid, or do they remain accrued?',
          whyNeeded: 'Status of existing liabilities must be established.'
        }
      ]
    });

    const res = await processAccountingQuery(
      'Salaries payable S$4,000 and CPF payable S$1,850; rent was paid by bank transfer.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res.scenarioState.directGroups?.length, 0);
    assert.equal(res.scenarioState.isComplete, false);
    assert.equal(res.scenarioState.missingFields.length, 2);
    console.log('✓ 3B-1. Finding B multi-event unstated rent prompts clarification');
    passed++;
  }

  // Finding B Adversarial: Zero-number query inventing Rent Expense amount of S$2,500 rejected
  {
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Rent Payment',
      directGroups: [{
        id: 'grp-1',
        eventDate: '01/03/2025',
        title: 'Rent Payment',
        summary: 'Paid rent',
        lines: [
          { accountName: 'Rent Expense', category: 'EXPENSE', debit: 2500, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 2500 }
        ]
      }]
    });

    const res = await processAccountingQuery(
      'Record the journal entry for rent paid by bank transfer.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res.scenarioState.directGroups?.length, 0, 'Invented 2,500 amount must be rejected by fact-provenance check');
    assert.match(res.messageText, /AI-Proposed Journal Rejected/i);
    assert.ok(res.scenarioState.missingFields.some(m => m.fieldKey === 'amount'));
    console.log('✓ 3B-2. Finding B adversarial invented amount rejected (UNSTATED_AMOUNT)');
    passed++;
  }

  // Finding C: Exact decimals & future scheduled item
  {
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Partial Payroll Settlement and Scheduled CPF',
      accountingTreatmentSummary: 'Record settlement of salaries payable in full today; CPF payable remains outstanding on balance sheet as it is scheduled for payment next week.',
      directGroups: [{
        id: 'grp-1',
        eventDate: '28/02/2025',
        title: 'Settlement of Salaries Payable',
        summary: 'Paid salaries payable of S$4,000.50 by bank transfer',
        lines: [
          { accountName: 'Salaries Payable', category: 'LIABILITY', debit: 4000.50, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 4000.50 }
        ]
      }],
      outstandingOrFutureItems: [
        'CPF payable S$1,850.25 scheduled for payment next week (remains as liability on balance sheet)'
      ]
    });

    const res = await processAccountingQuery(
      'Salaries payable S$4,000.50 paid by bank, CPF payable S$1,850.25 will be paid by bank next week.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res.scenarioState.directGroups?.length, 1);
    const grp = res.scenarioState.directGroups[0];
    assert.equal(grp.totalDebit, 4000.50);
    assert.equal(grp.totalCredit, 4000.50);
    assert.match(res.messageText, /4000\.50|4,000\.50/);
    assert.match(res.messageText, /Outstanding \/ Future Items/i);
    assert.match(res.messageText, /1850\.25|1,850\.25/);
    console.log('✓ 3C. Finding C exact decimals and future scheduled item rendered cleanly');
    passed++;
  }

  // Finding D: Multi-turn conversation carrying prior context facts
  {
    const turn1Scenario = {
      scenarioType: 'UNIVERSAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      rawQuery: 'Accrue monthly gross salaries S$4,000 and employer CPF S$1,850 for February 2025.',
      transactionTitle: 'February 2025 Payroll Accrual',
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      isComplete: true,
      committedDirectGroups: [{
        id: 'grp-1',
        eventDate: '28/02/2025',
        title: 'Payroll Accrual',
        summary: 'February 2025 payroll accrual',
        lines: [
          { accountName: 'Salaries Expense', category: 'EXPENSE', debit: 4000, credit: 0 },
          { accountName: 'Employer CPF Expense', category: 'EXPENSE', debit: 1850, credit: 0 },
          { accountName: 'Salaries Payable', category: 'LIABILITY', debit: 0, credit: 4000 },
          { accountName: 'CPF Payable', category: 'LIABILITY', debit: 0, credit: 1850 }
        ],
        totalDebit: 5850,
        totalCredit: 5850,
        isBalanced: true
      }]
    };

    let promptSeen = '';
    globalThis.fetch = async (url, opts) => {
      promptSeen = JSON.parse(opts.body).contents?.[0]?.parts?.[0]?.text || '';
      return makeGeminiSuccessResponse({
        responseKind: 'JOURNAL_ENTRY',
        transactionTitle: 'Payment of Salaries Payable',
        accountingTreatmentSummary: 'Debited Salaries Payable and credited Cash at Bank for S$4,000 confirmed paid. CPF Payable of S$1,850 remains outstanding.',
        directGroups: [{
          id: 'grp-2',
          eventDate: '05/03/2025',
          title: 'Settlement of Salaries Payable',
          summary: 'Paid salaries of S$4,000 by bank transfer',
          lines: [
            { accountName: 'Salaries Payable', category: 'LIABILITY', debit: 4000, credit: 0 },
            { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 4000 }
          ]
        }],
        outstandingOrFutureItems: [
          'CPF Payable S$1,850 remains outstanding and scheduled for next week.'
        ]
      });
    };

    const res = await processAccountingQuery(
      'Salaries were paid by bank, but CPF will be paid next week.',
      turn1Scenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.ok(promptSeen.includes('Salaries Payable'), 'Turn 2 prompt must receive Turn 1 active scenario context');
    assert.ok(promptSeen.includes('Prior User Query'), 'Turn 2 prompt must receive Prior User Query');
    assert.equal(res.scenarioState.directGroups?.length, 2, 'Must contain both Turn 1 accrual and Turn 2 settlement');
    assert.equal(res.scenarioState.committedDirectGroups?.length, 2, 'Committed groups must accumulate prior and current');
    assert.equal(res.scenarioState.directGroups[1].totalDebit, 4000);
    assert.match(res.messageText, /CPF Payable S\$1,850 remains outstanding/i);
    console.log('✓ 3D. Finding D multi-turn context propagation and group accumulation verified');
    passed++;
  }

  // Adversarial Core Category Contradiction Guardrail (CATEGORY_MISMATCH)
  {
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Prepaid Rent Advance Payment',
      directGroups: [{
        id: 'grp-1',
        eventDate: '05/03/2025',
        title: 'Prepaid Rent Advance Payment',
        summary: 'Paid rent in advance',
        lines: [
          { accountName: 'Prepaid Rent', category: 'EXPENSE', debit: 4000, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 4000 }
        ]
      }]
    });

    const res = await processAccountingQuery(
      'Prepare the journal entry for rent paid in advance of S$4,000 by bank transfer.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res.scenarioState.directGroups?.length, 0, 'Prepaid rent marked as EXPENSE must be rejected');
    assert.match(res.messageText, /AI-Proposed Journal Rejected/i);
    assert.ok(res.scenarioState.missingFields.some(m => m.whyNeeded.includes('valid and balance') || m.whyNeeded.includes('integer-cent')));
    console.log('✓ 3E. Adversarial core category contradiction rejected (CATEGORY_MISMATCH)');
    passed++;
  }

  // --------------------------------------------------------------------------
  // 4. Explicit Provider Failure Handling (No Silent Offline Fabrication)
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Explicit Provider Failure Handling (No Silent Fabrication) ---');

  // 4A: Gemini HTTP 500 Server Error
  {
    const fetchCalls = [];
    globalThis.fetch = async (url) => {
      fetchCalls.push(String(url));
      return new Response('Internal Server Error', { status: 500 });
    };
    const res = await processAccountingQuery(
      'Bought machinery for S$30,000 on credit. What is the double entry?',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [],
      { journal: true }
    );

    assert.equal(fetchCalls.length, 1, `Gemini HTTP 500 must fail in exactly 1 call without fallback double-fetch, got ${fetchCalls.length}`);
    assert.equal(res.scenarioState.directGroups?.length, 0, 'Must NOT fabricate a deterministic journal when configured provider fails');
    assert.equal(res.scenarioState.isComplete, false);
    assert.match(res.messageText, /AI Provider Unavailable/i);
    assert.ok(res.scenarioState.missingFields.some(m => m.fieldKey === 'providerFailure'));
    console.log('✓ 4A. Gemini HTTP 500 returns explicit AI Provider Unavailable');
    passed++;
  }

  // 4B: OpenAI HTTP 401 Unauthorized Error
  {
    const fetchCalls = [];
    globalThis.fetch = async (url) => {
      fetchCalls.push(String(url));
      return new Response('Unauthorized', { status: 401 });
    };
    const res = await processAccountingQuery(
      'Bought machinery for S$30,000 on credit. What is the double entry?',
      null,
      'SFRS_I',
      {
        activeProvider: 'openai',
        gemini: { apiKey: '', model: 'gemini-3.5-flash-lite' },
        openai: { apiKey: 'sk-invalid-test-key-long-enough-12345', model: 'gpt-4o' },
        azure: { apiKey: '', endpoint: '', deploymentName: 'gpt-4o', apiVersion: '2024-08-01-preview' }
      },
      'gpt-4o',
      [],
      { journal: true }
    );

    assert.equal(fetchCalls.length, 1, `OpenAI HTTP 401 must fail in exactly 1 call, got ${fetchCalls.length}`);
    assert.equal(res.scenarioState.directGroups?.length, 0);
    assert.match(res.messageText, /AI Provider Unavailable/i);
    console.log('✓ 4B. OpenAI HTTP 401 returns explicit AI Provider Unavailable');
    passed++;
  }

  // 4C: Azure Malformed JSON Provider Failure
  {
    const fetchCalls = [];
    globalThis.fetch = async (url) => {
      fetchCalls.push(String(url));
      return makeOpenAISuccessResponse('Not a json object');
    };
    const res = await processAccountingQuery(
      'Bought machinery for S$30,000 on credit. What is the double entry?',
      null,
      'SFRS_I',
      {
        activeProvider: 'azure',
        gemini: { apiKey: '', model: 'gemini-3.5-flash-lite' },
        openai: { apiKey: '', model: 'gpt-4o' },
        azure: {
          apiKey: 'test-azure-key-12345',
          endpoint: 'https://test-resource.openai.azure.com',
          deploymentName: 'gpt-4o',
          apiVersion: '2024-08-01-preview'
        }
      },
      'gpt-4o',
      [],
      { journal: true }
    );

    assert.equal(fetchCalls.length, 1, `Azure malformed response must fail in exactly 1 call, got ${fetchCalls.length}`);
    assert.equal(res.scenarioState.directGroups?.length, 0);
    assert.match(res.messageText, /AI Provider Unavailable/i);
    console.log('✓ 4C. Azure malformed non-JSON response returns explicit AI Provider Unavailable');
    passed++;
  }

  // --------------------------------------------------------------------------
  // 5. Accounting Advisory Question Without Journal Request
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Accounting Advisory Question Without Journal Request ---');
  {
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'ACCOUNTING_ADVISORY',
      transactionTitle: 'Measurement Models for Investment Property',
      accountingTreatmentSummary: 'Under SFRS(I) 1-40, an entity may choose either the fair value model or the cost model for all of its investment property. Under the fair value model, changes in fair value are recognized in profit or loss.',
      singaporeTaxTreatmentSummary: 'Capital gains on investment properties held on capital account are generally not taxable in Singapore.',
      directGroups: []
    });

    const res = await processAccountingQuery(
      'What is the accounting policy choice for investment property under SFRS(I) 1-40?',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res.scenarioState.directGroups?.length, 0, 'Pure advisory query must not force journal generation');
    assert.match(res.messageText, /Under SFRS\(I\) 1-40, an entity may choose either the fair value model/i);
    assert.match(res.messageText, /Singapore Tax & Statutory Considerations/i);
    console.log('✓ 5. Pure accounting advisory question rendered without journals');
    passed++;
  }

  // --------------------------------------------------------------------------
  // 6. Fix A (CAT-11) Multi-Term Derivation & Boundary Refinements
  // --------------------------------------------------------------------------
  console.log('\n--- 6. Fix A (CAT-11) Multi-Term Derivation & Boundary Refinements ---');
  {
    const query = 'Sold equipment for S$22,000 cash at bank. Original cost was S$80,000, and accumulated depreciation up to the date of disposal was S$62,000. Prepare the disposal journal entry.';
    const ppeDisposalGroups = [{
      id: 'grp-1',
      eventDate: '01/03/2025',
      title: 'Disposal of Equipment with Gain',
      eventType: 'DISPOSAL',
      summary: 'Derecognition of equipment, derecognition of accumulated depreciation, recognition of bank proceeds, and recognition of gain on disposal under SFRS(I) 1-16',
      totalDebit: 84000,
      totalCredit: 84000,
      isBalanced: true,
      lines: [
        { accountCode: '1010', accountName: 'Cash at Bank', category: 'ASSET', debit: 22000, credit: 0 },
        { accountCode: '1501', accountName: 'Accumulated Depreciation — Equipment', category: 'ASSET', debit: 62000, credit: 0 },
        { accountCode: '1500', accountName: 'Equipment — Cost', category: 'ASSET', debit: 0, credit: 80000 },
        { accountCode: '4200', accountName: 'Gain on Disposal of Equipment', category: 'REVENUE', debit: 0, credit: 4000 }
      ]
    }];

    // Direct fact-provenance validation (CAT-11 check: 22,000 + 62,000 - 80,000 = 4,000 must be derivable)
    const integrity = validateJournalGroups(ppeDisposalGroups, {
      rawQuery: query,
      enforceAmountProvenance: true
    });
    assert.ok(integrity.isValid, `PPE disposal gain must pass amount provenance: ${integrity.issues.map(i => i.message).join('; ')}`);

    // End-to-end query processing with mocked Gemini response
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Disposal of Equipment with Gain on Disposal',
      accountingTreatmentSummary: 'Under SFRS(I) 1-16 paragraph 67-72, the carrying amount of an item of property, plant and equipment is derecognised on disposal. The gain or loss arising from derecognition is calculated as the difference between the net disposal proceeds (S$22,000) and the carrying amount (S$18,000, being cost S$80,000 less accumulated depreciation S$62,000), resulting in a Gain on Disposal of S$4,000 recognised in profit or loss.',
      directGroups: ppeDisposalGroups
    });

    const res = await processAccountingQuery(
      query,
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res.scenarioState.directGroups?.length, 1, 'PPE disposal should yield 1 direct journal group');
    const group = res.scenarioState.directGroups[0];
    assert.equal(group.lines.length, 4, 'Disposal group must contain 4 lines (Cash, Acc Depn, Asset Cost, Gain)');
    assert.equal(group.totalDebit, 84000, 'Total debits must be 84,000');
    assert.equal(group.totalCredit, 84000, 'Total credits must be 84,000');
    assert.equal(group.totalDebit, group.totalCredit, 'Debits and credits must balance');
    console.log('✓ 6A. CAT-11 multi-term derivation (PPE disposal gain S$4,000) verified end-to-end');
    passed++;
  }

  // Statutory Advisory Boundary (EA Part IV)
  {
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'ACCOUNTING_ADVISORY',
      transactionTitle: 'Statutory Leave Entitlements under Employment Act Part IV',
      accountingTreatmentSummary: 'Part IV of the Singapore Employment Act 1968 governs rest days, hours of work, annual leave, and other conditions of service for covered employees. Under Section 43, employees who have served for at least 3 months are entitled to paid annual leave starting from 7 days for the first year, increasing by 1 day per additional year of service up to 14 days. Under Section 89, employees are entitled to paid outpatient sick leave up to 14 days and paid hospitalisation leave up to 60 days.',
      singaporeTaxTreatmentSummary: 'Statutory leave entitlements are employment rights and do not give rise to separate corporate tax adjustments until salaries or leave pay are incurred.',
      directGroups: []
    });

    const res = await processAccountingQuery(
      'What are the statutory annual leave and outpatient sick leave entitlements under Part IV of the Singapore Employment Act?',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res.scenarioState.directGroups?.length, 0, 'Statutory advisory query must never force directGroups or leak placeholder groups');
    assert.match(res.messageText, /Employment Act 1968/i);
    assert.match(res.messageText, /annual leave/i);
    console.log('✓ 6B. Statutory advisory boundary query returns directGroups.length === 0');
    passed++;
  }

  // 6C: CAT-02 Compound Payroll Recognition with Net Pay Settlement (DUPLICATE_RECOGNITION Refinement)
  {
    const payrollQuery = 'April 2026 payroll: Gross salaries S$20,000, employer CPF S$3,400, employee CPF S$4,000. Net take-home pay of S$16,000 paid by bank transfer today, total CPF of S$7,400 payable to CPF Board next month.';
    const compoundPayrollGroups = [{
      id: 'grp-payroll-1',
      eventDate: '30/04/2026',
      title: 'April 2026 Payroll Recognition and Net Pay Settlement',
      eventType: 'PAYROLL',
      summary: 'Net take-home pay of S$16,000 settled by bank transfer today; total CPF S$7,400 accrued',
      totalDebit: 23400,
      totalCredit: 23400,
      isBalanced: true,
      lines: [
        { accountCode: '5010', accountName: 'Salaries Expense', category: 'EXPENSE', debit: 20000, credit: 0 },
        { accountCode: '5020', accountName: 'Employer CPF Expense', category: 'EXPENSE', debit: 3400, credit: 0 },
        { accountCode: '1010', accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 16000 },
        { accountCode: '2020', accountName: 'CPF Payable', category: 'LIABILITY', debit: 0, credit: 7400 }
      ]
    }];

    const integrity = validateJournalGroups(compoundPayrollGroups, {
      rawQuery: payrollQuery,
      enforceAmountProvenance: true
    });
    assert.ok(integrity.isValid, `Compound payroll entry must pass validation without DUPLICATE_RECOGNITION: ${integrity.issues.map(i => i.message).join('; ')}`);
    assert.ok(!integrity.issues.some(i => i.code === 'DUPLICATE_RECOGNITION'), 'Compound payroll entry must not trigger DUPLICATE_RECOGNITION');

    // Also assert that an imbalanced entry fails validation
    const imbalancedGroups = [{
      id: 'grp-bad-settle',
      eventDate: '05/03/2025',
      title: 'Imbalanced Salaries Settlement',
      summary: 'Settlement of outstanding salaries',
      totalDebit: 4000,
      totalCredit: 3000,
      isBalanced: false,
      lines: [
        { accountCode: '5010', accountName: 'Salaries Payable', category: 'LIABILITY', debit: 4000, credit: 0 },
        { accountCode: '1010', accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 3000 }
      ]
    }];
    const badIntegrity = validateJournalGroups(imbalancedGroups);
    assert.equal(badIntegrity.isValid, false, 'Imbalanced entry must fail validation');
    assert.ok(badIntegrity.issues.some(i => i.code === 'IMBALANCED_GROUP'), 'Must flag IMBALANCED_GROUP');

    console.log('✓ 6C. CAT-02 compound payroll recognition passes validation while imbalanced entry fails');
    passed++;
  }

  // 6D: Account Category Normalization & Invariant Preservation
  {
    const query = 'Sold equipment for S$22,000 cash at bank. Original cost was S$80,000, and accumulated depreciation up to the date of disposal was S$62,000. Prepare the disposal journal entry.';
    const context = await buildGroundedReasoningContext(query);

    // Verify pure helper normalizeAccountCategory unit mappings
    assert.equal(normalizeAccountCategory('CONTRA_ASSET'), 'ASSET');
    assert.equal(normalizeAccountCategory('contra-asset'), 'ASSET');
    assert.equal(normalizeAccountCategory('CONTRA ASSET'), 'ASSET');
    assert.equal(normalizeAccountCategory('CONTRA_LIABILITY'), 'LIABILITY');
    assert.equal(normalizeAccountCategory('CONTRA_EQUITY'), 'EQUITY');
    assert.equal(normalizeAccountCategory('OTHER_INCOME'), 'REVENUE');
    assert.equal(normalizeAccountCategory('GAIN'), 'REVENUE');
    assert.equal(normalizeAccountCategory('LOSS'), 'EXPENSE');
    assert.equal(normalizeAccountCategory('FINANCE_COST'), 'EXPENSE');
    assert.equal(normalizeAccountCategory('OCI'), 'OTHER_COMPREHENSIVE_INCOME');
    assert.equal(normalizeAccountCategory('', 'Vendor Warranty Holdback Obligation'), '');
    assert.equal(normalizeAccountCategory(undefined, 'Unfamiliar Account'), '');
    assert.equal(normalizeAccountCategory('', 'Salaries Payable'), 'LIABILITY');
    assert.equal(normalizeAccountCategory(undefined, 'Cash at Bank'), 'ASSET');
    assert.equal(normalizeAccountCategory('BOGUS_CATEGORY'), 'BOGUS_CATEGORY');

    // End-to-end integration with postProcessAIResponse:
    // AI returns CONTRA_ASSET on Accumulated Depreciation and GAIN / OTHER_INCOME on Gain on Disposal
    const aiPayloadWithSynonyms = {
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Disposal of Equipment with Gain',
      accountingTreatmentSummary: 'Derecognition of equipment with gain under SFRS(I) 1-16',
      directGroups: [{
        id: 'grp-disposal-norm',
        eventDate: '01/03/2025',
        title: 'Disposal of Equipment with Gain',
        lines: [
          { accountCode: '1010', accountName: 'Cash at Bank', category: 'ASSET', debit: 22000, credit: 0 },
          { accountCode: '1501', accountName: 'Accumulated Depreciation - Equipment', category: 'CONTRA_ASSET', debit: 62000, credit: 0 },
          { accountCode: '1500', accountName: 'Equipment - Cost', category: 'ASSET', debit: 0, credit: 80000 },
          { accountCode: '4200', accountName: 'Gain on Disposal of Equipment', category: 'GAIN', debit: 0, credit: 4000 }
        ]
      }]
    };

    const processed = postProcessAIResponse(aiPayloadWithSynonyms, null, query, context);
    const grp = processed.scenarioState.directGroups?.[0];
    assert.ok(grp, 'Must return direct journal group');
    assert.equal(grp.lines[1].category, 'ASSET', 'CONTRA_ASSET must be normalized to ASSET');
    assert.equal(grp.lines[3].category, 'REVENUE', 'GAIN must be normalized to REVENUE');

    const integrity = validateJournalGroups(processed.scenarioState.directGroups, {
      rawQuery: query,
      enforceAmountProvenance: true
    });
    assert.ok(integrity.isValid, `Normalized disposal entry must pass validateJournalGroups: ${integrity.issues.map(i => i.message).join('; ')}`);

    // Verify that an unknown bogus category string is preserved and rejected by validateJournalGroups with INVALID_LINE
    const aiPayloadWithBogus = {
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Disposal of Equipment with Bogus Category',
      directGroups: [{
        id: 'grp-bogus',
        eventDate: '01/03/2025',
        title: 'Disposal of Equipment with Bogus Category',
        lines: [
          { accountCode: '1010', accountName: 'Cash at Bank', category: 'ASSET', debit: 22000, credit: 0 },
          { accountCode: '1501', accountName: 'Accumulated Depreciation - Equipment', category: 'CONTRA_ASSET', debit: 62000, credit: 0 },
          { accountCode: '1500', accountName: 'Equipment - Cost', category: 'ASSET', debit: 0, credit: 80000 },
          { accountCode: '4200', accountName: 'Gain on Disposal of Equipment', category: 'BOGUS_CATEGORY', debit: 0, credit: 4000 }
        ]
      }]
    };

    const bogusProcessed = postProcessAIResponse(aiPayloadWithBogus, null, query, context);
    const bogusGrp = bogusProcessed.scenarioState.directGroups?.[0];
    assert.ok(bogusGrp);
    assert.equal(bogusGrp.lines[3].category, 'BOGUS_CATEGORY', 'Unknown category must not be coerced to ASSET');

    const bogusIntegrity = validateJournalGroups(bogusProcessed.scenarioState.directGroups, {
      rawQuery: query
    });
    assert.equal(bogusIntegrity.isValid, false, 'Entry with BOGUS_CATEGORY must fail validation');
    assert.ok(bogusIntegrity.issues.some(i => i.code === 'INVALID_LINE'), 'Must flag INVALID_LINE for invalid category');

    console.log('✓ 6D. Account category normalization (CONTRA_ASSET -> ASSET, GAIN -> REVENUE) and bogus category rejection verified');
    passed++;
  }

  // 6E: Skip Fallback Semantic Noise on forceTransactionSchema Mode
  {
    const query = "Parent company paid S$12,000 audit fee on behalf of subsidiary via bank transfer. Record the intercompany recharge in parent's books.";
    const ctx = await buildGroundedReasoningContext(query, null, undefined, undefined, {
      forceTransactionSchema: true,
      localOnly: true
    });

    assert.equal(ctx.missingFacts.length, 0, 'Must not inject regex-guessed missingFacts when forceTransactionSchema is true');
    const prompt = formatGroundedSystemPrompt(ctx, 'SFRS_I');
    assert.ok(!prompt.includes('Reporting Entity: UNKNOWN'), 'Prompt must not contain fallback Reporting Entity: UNKNOWN');
    assert.ok(!prompt.includes('Settlement/payment timing is unspecified'), 'Prompt must not contain fallback missing fact noise');

    console.log('✓ 6E. Skip fallback semantic noise on forceTransactionSchema mode verified');
    passed++;
  }

  // 6F: Reject Truncated Half-JSON in isMeaningfulAIJsonPayload
  {
    const truncatedJson = '{\n  "responseKind": "JOURNAL_ENTRY",\n  "transactionTitle": "Recognition of Deferred Tax",\n  "accountingTreatmentSummary": "Under SFRS(I) 1-12';
    const parsedTruncated = repairAndParseAIJson(truncatedJson);
    assert.equal(
      isMeaningfulAIJsonPayload(parsedTruncated, truncatedJson),
      false,
      'Truncated half-JSON missing closing braces must be rejected by isMeaningfulAIJsonPayload'
    );

    // Also verify that a valid complete JSON payload passes
    const validJson = JSON.stringify({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Recognition of Deferred Tax',
      accountingTreatmentSummary: 'Under SFRS(I) 1-12, recognized deferred tax asset.',
      directGroups: [{
        id: 'grp-dt',
        eventDate: '31/12/2024',
        title: 'Deferred Tax Asset',
        lines: [
          { accountName: 'Deferred Tax Asset', category: 'ASSET', debit: 1700, credit: 0 },
          { accountName: 'Tax Expense (P&L)', category: 'EXPENSE', debit: 0, credit: 1700 }
        ]
      }]
    });
    const parsedValid = repairAndParseAIJson(validJson);
    assert.equal(
      isMeaningfulAIJsonPayload(parsedValid, validJson),
      true,
      'Complete valid JSON payload with directGroups must be accepted'
    );

    // Verify empty directGroups JOURNAL_ENTRY is rejected
    const hollowJson = JSON.stringify({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Empty Journal',
      directGroups: []
    });
    const parsedHollow = repairAndParseAIJson(hollowJson);
    assert.equal(
      isMeaningfulAIJsonPayload(parsedHollow, hollowJson),
      false,
      'JOURNAL_ENTRY with no directGroups and no missingFields must be rejected'
    );

    console.log('✓ 6F. Reject truncated half-JSON and hollow JOURNAL_ENTRY payloads in isMeaningfulAIJsonPayload verified');
    passed++;
  }

  // --------------------------------------------------------------------------
  // 7. Comprehensive Invariant Regressions (P1-A, P1-B, P1-C, P2-A, P2-B)
  // --------------------------------------------------------------------------
  console.log('\n--- 7. Comprehensive Invariant Regressions (P1-A, P1-B, P1-C, P2-A, P2-B) ---');

  // 7A: P1-A Self-Addition Fabrication Rejected
  {
    const query = 'Record the journal entry for purchase of office equipment paid by bank transfer.';
    const fabricatedGroup = [{
      id: 'grp-1',
      eventDate: '01/02/2025',
      title: 'Acquisition of Office Equipment',
      lines: [
        { accountName: 'Office Equipment', category: 'ASSET', debit: 2000, credit: 0 },
        { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 2000 }
      ],
      totalDebit: 2000,
      totalCredit: 2000,
      isBalanced: true
    }];

    // Direct validateJournalGroups check with enforceAmountProvenance
    const vResult = validateJournalGroups(fabricatedGroup, {
      rawQuery: query,
      enforceAmountProvenance: true
    });
    assert.equal(vResult.isValid, false, 'Self-addition S$2,000 from single stated S$1,000 must be rejected');
    assert.ok(vResult.issues.some(i => i.code === 'UNSTATED_AMOUNT'), 'Must flag UNSTATED_AMOUNT');

    // End-to-end processAccountingQuery rejection
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Office Equipment Purchase',
      directGroups: fabricatedGroup
    });

    const res = await processAccountingQuery(query, null, 'SFRS_I', 'test-gemini-key-long-enough-12345');
    assert.equal(res.scenarioState.directGroups?.length ?? 0, 0, 'Fabricated S$2,000 journal must be rejected');
    assert.match(res.messageText, /AI-Proposed Journal Rejected/i);
    assert.ok(res.scenarioState.missingFields.some(m => m.fieldKey === 'amount'));

    // Single-amount query with time/proration cue must allow derived straight-line depreciation (S$12,000 / 5 = S$2,400)
    const depQuery = 'Record 1 year of straight-line depreciation on equipment costing S$12,000 with a 5-year useful life.';
    const depGroup = [{
      id: 'grp-dep',
      eventDate: '31/12/2025',
      title: 'Depreciation Expense',
      lines: [
        { accountName: 'Depreciation Expense', category: 'EXPENSE', debit: 2400, credit: 0 },
        { accountName: 'Accumulated Depreciation', category: 'ASSET', debit: 0, credit: 2400 }
      ],
      totalDebit: 2400,
      totalCredit: 2400,
      isBalanced: true
    }];
    const vDep = validateJournalGroups(depGroup, {
      rawQuery: depQuery,
      enforceAmountProvenance: true
    });
    assert.equal(vDep.isValid, true, 'Straight-line depreciation S$2,400 on S$12,000 / 5 yrs must not be rejected by singleAmountQuery');

    console.log('✓ 7A. P1-A Self-addition fabrication rejected (UNSTATED_AMOUNT)');
    passed++;
  }

  // 7B: AI-First Planned / Conditional / Illustrative Journal Integrity
  {
    const plannedGroup = [{
      id: 'grp-1',
      eventDate: '01/03/2025',
      title: 'Scheduled Settlement of Salaries Payable',
      transactionStatus: 'planned',
      journalAction: 'illustrative',
      lines: [
        { accountName: 'Salaries Payable', category: 'LIABILITY', debit: 4000, credit: 0 },
        { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 4000 }
      ],
      totalDebit: 4000,
      totalCredit: 4000,
      isBalanced: true
    }];

    const vPlanned = validateJournalGroups(plannedGroup);
    assert.equal(vPlanned.isValid, true, 'Planned / illustrative settlement passes validation');

    // And invalid status fails
    const invalidStatusGroup = [{
      ...plannedGroup[0],
      transactionStatus: 'unknown_status'
    }];
    const vInvalid = validateJournalGroups(invalidStatusGroup);
    assert.equal(vInvalid.isValid, false, 'Invalid transaction status must fail validation');
    assert.ok(vInvalid.issues.some(i => i.code === 'INVALID_TRANSACTION_STATUS'));

    console.log('✓ 7B. AI-First planned/conditional/illustrative journal validation verified');
    passed++;
  }

  // 7C: P1-C Multi-Turn ID Collision & Journal Preservation
  {
    const turn1Scenario = {
      scenarioType: 'UNIVERSAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      rawQuery: 'Company acquired machinery for S$15,000 on 30-day supplier credit.',
      transactionTitle: 'Machinery Acquisition on Credit',
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      isComplete: true,
      committedDirectGroups: [{
        id: 'grp-1',
        eventDate: '01/02/2025',
        title: 'Acquisition of Machinery',
        summary: 'Purchased machinery for S$15,000 on credit',
        lines: [
          { accountName: 'Machinery', category: 'ASSET', debit: 15000, credit: 0 },
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 15000 }
        ],
        totalDebit: 15000,
        totalCredit: 15000,
        isBalanced: true
      }]
    };

    // AI in Turn 2 also returns id: 'grp-1' for partial payment
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Partial Payment of Supplier',
      directGroups: [{
        id: 'grp-1', // Colliding ID!
        eventDate: '15/02/2025',
        title: 'Partial Settlement of Trade Payables',
        summary: 'Paid S$6,000 by bank transfer',
        lines: [
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 6000, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 6000 }
        ]
      }]
    });

    const res = await processAccountingQuery(
      'We paid S$6,000 of the supplier balance by bank transfer.',
      turn1Scenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res.scenarioState.directGroups?.length, 2, 'Must preserve both Turn 1 acquisition and Turn 2 payment');
    assert.equal(res.scenarioState.committedDirectGroups?.length, 2, 'Committed groups must retain both groups');
    const ids = res.scenarioState.directGroups.map(g => g.id);
    assert.equal(new Set(ids).size, 2, 'Group IDs must be unique across turns, collision resolved');
    assert.equal(res.scenarioState.directGroups[0].totalDebit, 15000);
    assert.equal(res.scenarioState.directGroups[1].totalDebit, 6000);

    // Part 2: Turn 2 returns directGroups: [] (e.g. refused future payment or explanatory response)
    const turn1PayrollScenario = {
      scenarioType: 'UNIVERSAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      rawQuery: 'We accrued monthly staff salaries of S$4,000 for January 2025, unpaid at month-end.',
      transactionTitle: 'Salaries Accrual',
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      isComplete: true,
      committedDirectGroups: [{
        id: 'grp-sal-1',
        eventDate: '31/01/2025',
        title: 'Accrual of Salaries',
        summary: 'Accrued salaries S$4,000',
        lines: [
          { accountName: 'Salaries Expense', category: 'EXPENSE', debit: 4000, credit: 0 },
          { accountName: 'Salaries Payable', category: 'LIABILITY', debit: 0, credit: 4000 }
        ],
        totalDebit: 4000,
        totalCredit: 4000,
        isBalanced: true
      }]
    };

    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'CLARIFICATION_REQUIRED',
      transactionTitle: 'Future Payment Refusal',
      accountingTreatmentSummary: 'Salaries payable will be paid next week; no settlement entry is recorded until payment occurs.',
      missingFields: [{
        fieldKey: 'unconfirmedSettlement',
        fieldName: 'Settlement confirmation',
        prompt: 'Has the salaries payable payment actually been disbursed from the bank account?',
        whyNeeded: 'Journals cannot be posted for future or pending disbursements.'
      }],
      directGroups: []
    });

    const resRefusal = await processAccountingQuery(
      'The salaries payable of S$4,000 will be paid by bank next week.',
      turn1PayrollScenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(resRefusal.scenarioState.directGroups?.length, 1, 'Must preserve Turn 1 group when Turn 2 proposes no new groups');
    assert.equal(resRefusal.scenarioState.committedDirectGroups?.length, 1, 'Must retain committed Turn 1 group');
    assert.equal(resRefusal.scenarioState.directGroups[0].id, 'grp-sal-1', 'Must keep Turn 1 group intact');
    assert.ok(!resRefusal.scenarioState.missingFields.some(m => m.fieldKey === 'journalInvariants'), 'Must not trigger EMPTY_JOURNAL or invalid integrity');

    console.log('✓ 7C. P1-C Multi-turn ID collision avoided and prior journals preserved');
    passed++;
  }

  // 7D: P2-A Missing Account Category on Unfamiliar Account Rejects Fail-Closed
  {
    const query = 'Recognize warranty holdback obligation of S$5,000 on project completion.';
    const context = await buildGroundedReasoningContext(query);

    const unfamiliarPayload = {
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Warranty Holdback',
      directGroups: [{
        id: 'grp-holdback',
        eventDate: '01/03/2025',
        title: 'Warranty Holdback',
        lines: [
          { accountCode: '5000', accountName: 'Project Cost', category: 'EXPENSE', debit: 5000, credit: 0 },
          { accountCode: '2900', accountName: 'Vendor Warranty Holdback Obligation', category: '', debit: 0, credit: 5000 }
        ]
      }]
    };

    const processed = postProcessAIResponse(unfamiliarPayload, null, query, context);
    const grp = processed.scenarioState.directGroups?.[0];
    assert.ok(grp);
    assert.equal(grp.lines[1].category, '', 'Empty category on unfamiliar account must not default to ASSET');

    const vResult = validateJournalGroups(processed.scenarioState.directGroups, { rawQuery: query });
    assert.equal(vResult.isValid, false, 'Line with missing category must fail validation');
    assert.ok(vResult.issues.some(i => i.code === 'INVALID_LINE'), 'Must flag INVALID_LINE for empty category');

    console.log('✓ 7D. P2-A Missing account category on unfamiliar account rejected (INVALID_LINE)');
    passed++;
  }

  // 7E: P2-B Journal Completion Independent of Retrieved Statutory Evidence
  {
    const query = 'Purchased office computer for S$2,500 paid by bank transfer.';
    const context = await buildGroundedReasoningContext(query);
    context.primaryEvidence = [];
    context.officialGuidance = [];
    context.curatedSummaries = [];
    context.missingFacts = [];

    const validPayload = {
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Computer Purchase',
      directGroups: [{
        id: 'grp-comp',
        eventDate: '01/03/2025',
        title: 'Computer Purchase',
        lines: [
          { accountCode: '1500', accountName: 'Computer Equipment', category: 'ASSET', debit: 2500, credit: 0 },
          { accountCode: '1010', accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 2500 }
        ]
      }]
    };

    const processed = postProcessAIResponse(validPayload, null, query, context);
    assert.equal(processed.scenarioState.directGroups?.length, 1);
    assert.equal(processed.scenarioState.isComplete, true, 'Balanced journal must mark scenario complete even with empty statutory evidence');

    console.log('✓ 7E. P2-B Journal completion independent of retrieved evidence verified (isComplete === true)');
    passed++;
  }

  // --------------------------------------------------------------------------
  // 8. Review Findings Regressions (Findings 1 through 6)
  // --------------------------------------------------------------------------
  console.log('\n--- 8. Review Findings Regressions (Findings 1 through 6) ---');

  // 8A: AI-First Amount Provenance & Integer-Cent Invariant Validation
  {
    const query = 'Purchased office equipment for S$100, paid by bank.';

    // Valid S$100 entry passes
    const valid100Groups = [{
      id: 'grp-val-100',
      title: 'Office Equipment Purchase',
      eventDate: '01/03/2025',
      totalDebit: 100,
      totalCredit: 100,
      isBalanced: true,
      lines: [
        { accountName: 'Office Equipment', category: 'ASSET', debit: 100, credit: 0 },
        { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 100 }
      ]
    }];
    const vValid = validateJournalGroups(valid100Groups, { rawQuery: query, enforceAmountProvenance: true });
    assert.equal(vValid.isValid, true, 'Valid S$100 journal must pass');

    // Zero-number query fabricating amounts must be rejected (UNSTATED_AMOUNT)
    const unstatedQuery = 'Record the journal entry for office equipment purchase.';
    const vFab = validateJournalGroups(valid100Groups, { rawQuery: unstatedQuery, enforceAmountProvenance: true });
    assert.equal(vFab.isValid, false, 'Fabricated amount on zero-number query must fail validation');
    assert.ok(vFab.issues.some(i => i.code === 'UNSTATED_AMOUNT'), 'Must emit UNSTATED_AMOUNT');

    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Office Equipment Purchase',
      directGroups: valid100Groups
    });
    const res8A = await processAccountingQuery(unstatedQuery, null, 'SFRS_I', 'test-gemini-key-long-enough-12345');
    assert.equal(res8A.scenarioState.directGroups?.length, 0, 'Fabricated amount entry must be rejected');
    assert.match(res8A.messageText, /AI-Proposed Journal Rejected/i);

    console.log('✓ 8A. AI-First amount provenance & integer-cent invariant validation verified');
    passed++;
  }

  // 8B: Finding 2 — Recurring journal entries preserved across turns
  {
    // 1. Recurring rent
    const queryRent1 = 'Record January rent of S$2,000 paid by bank transfer.';
    const ctxRent1 = await buildGroundedReasoningContext(queryRent1);
    const grpRent1 = {
      id: 'grp-rent-1',
      eventDate: '31/01/2025',
      title: 'Monthly Rent Payment',
      lines: [
        { accountName: 'Rent Expense', category: 'EXPENSE', debit: 2000, credit: 0 },
        { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 2000 }
      ]
    };
    const pRent1 = postProcessAIResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Monthly Rent Payment',
      directGroups: [grpRent1]
    }, null, queryRent1, ctxRent1);
    assert.equal(pRent1.scenarioState.directGroups?.length, 1);

    const queryRent2 = 'Record February rent of S$2,000 paid by bank transfer.';
    const ctxRent2 = await buildGroundedReasoningContext(queryRent2);
    const grpRent2 = {
      id: 'grp-rent-1', // Same group ID to test collision avoidance
      eventDate: '28/02/2025',
      title: 'Monthly Rent Payment',
      lines: [
        { accountName: 'Rent Expense', category: 'EXPENSE', debit: 2000, credit: 0 },
        { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 2000 }
      ]
    };
    assert.notEqual(
      journalGroupFingerprint(pRent1.scenarioState.directGroups[0]),
      journalGroupFingerprint(grpRent2),
      'Fingerprints for different dates must be distinct'
    );
    const pRent2 = postProcessAIResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Monthly Rent Payment',
      directGroups: [grpRent2]
    }, pRent1.scenarioState, queryRent2, ctxRent2);

    assert.equal(pRent2.scenarioState.directGroups?.length, 2, 'Recurring rent must retain both January and February groups');
    assert.equal(pRent2.scenarioState.committedDirectGroups?.length, 2);
    assert.notEqual(pRent2.scenarioState.directGroups[0].id, pRent2.scenarioState.directGroups[1].id, 'Group IDs must be distinct');

    // 2. Recurring payroll
    const grpPay1 = {
      id: 'grp-pay-1',
      eventDate: '31/01/2025',
      title: 'Monthly Payroll',
      totalDebit: 5000,
      totalCredit: 5000,
      isBalanced: true,
      lines: [
        { accountName: 'Salaries and Wages', category: 'EXPENSE', debit: 5000, credit: 0 },
        { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 5000 }
      ]
    };
    const grpPay2 = {
      id: 'grp-pay-1',
      eventDate: '28/02/2025',
      title: 'Monthly Payroll',
      totalDebit: 5000,
      totalCredit: 5000,
      isBalanced: true,
      lines: [
        { accountName: 'Salaries and Wages', category: 'EXPENSE', debit: 5000, credit: 0 },
        { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 5000 }
      ]
    };
    assert.notEqual(journalGroupFingerprint(grpPay1), journalGroupFingerprint(grpPay2));

    // 3. Recurring CPF
    const grpCpf1 = {
      id: 'grp-cpf-1',
      eventDate: '14/02/2025',
      title: 'CPF Remittance',
      totalDebit: 1850,
      totalCredit: 1850,
      isBalanced: true,
      lines: [
        { accountName: 'CPF Payable', category: 'LIABILITY', debit: 1850, credit: 0 },
        { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 1850 }
      ]
    };
    const grpCpf2 = {
      id: 'grp-cpf-1',
      eventDate: '14/03/2025',
      title: 'CPF Remittance',
      totalDebit: 1850,
      totalCredit: 1850,
      isBalanced: true,
      lines: [
        { accountName: 'CPF Payable', category: 'LIABILITY', debit: 1850, credit: 0 },
        { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 1850 }
      ]
    };
    assert.notEqual(journalGroupFingerprint(grpCpf1), journalGroupFingerprint(grpCpf2));

    // 4. Recurring depreciation
    const grpDep1 = {
      id: 'grp-dep-1',
      eventDate: '31/12/2025',
      title: 'Annual Depreciation',
      totalDebit: 2400,
      totalCredit: 2400,
      isBalanced: true,
      lines: [
        { accountName: 'Depreciation Expense', category: 'EXPENSE', debit: 2400, credit: 0 },
        { accountName: 'Accumulated Depreciation', category: 'ASSET', debit: 0, credit: 2400 }
      ]
    };
    const grpDep2 = {
      id: 'grp-dep-1',
      eventDate: '31/12/2026',
      title: 'Annual Depreciation',
      totalDebit: 2400,
      totalCredit: 2400,
      isBalanced: true,
      lines: [
        { accountName: 'Depreciation Expense', category: 'EXPENSE', debit: 2400, credit: 0 },
        { accountName: 'Accumulated Depreciation', category: 'ASSET', debit: 0, credit: 2400 }
      ]
    };
    assert.notEqual(journalGroupFingerprint(grpDep1), journalGroupFingerprint(grpDep2));

    // Reviewer edge case 2: Recurring entry in Turn 2 without explicit calendar date
    const queryRentTurn1 = 'Record monthly rent of S$2,000 paid by bank transfer.';
    const ctxRentTurn1 = await buildGroundedReasoningContext(queryRentTurn1);
    const grpRentTurn1 = {
      id: 'grp-rent',
      eventDate: '01/01/2025',
      title: 'Rent Payment',
      lines: [
        { accountName: 'Rent Expense', category: 'EXPENSE', debit: 2000, credit: 0 },
        { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 2000 }
      ]
    };
    const pRentTurn1 = postProcessAIResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Rent Payment',
      directGroups: [grpRentTurn1]
    }, null, queryRentTurn1, ctxRentTurn1);
    assert.equal(pRentTurn1.scenarioState.directGroups?.length, 1);

    const queryRentTurn2 = 'Record another month of rent of S$2,000 paid by bank.';
    const ctxRentTurn2 = await buildGroundedReasoningContext(queryRentTurn2);
    // AI proposes single group with same eventDate and lines
    const grpRentTurn2 = {
      id: 'grp-rent',
      eventDate: '01/01/2025',
      title: 'Rent Payment',
      lines: [
        { accountName: 'Rent Expense', category: 'EXPENSE', debit: 2000, credit: 0 },
        { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 2000 }
      ]
    };
    const pRentTurn2 = postProcessAIResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Rent Payment',
      directGroups: [grpRentTurn2]
    }, pRentTurn1.scenarioState, queryRentTurn2, ctxRentTurn2);
    assert.equal(pRentTurn2.scenarioState.directGroups?.length, 2, 'Recurring rent without date must retain both Turn 1 and Turn 2');
    assert.notEqual(pRentTurn2.scenarioState.directGroups[0].id, pRentTurn2.scenarioState.directGroups[1].id, 'Turn 2 group must receive distinct ID');

    // Reviewer edge case 2b: AI echoes Turn 1 + includes Turn 2 in directGroups on recurring request
    const pRentTurn2Echoed = postProcessAIResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Rent Payment',
      directGroups: [grpRentTurn1, grpRentTurn2]
    }, pRentTurn1.scenarioState, queryRentTurn2, ctxRentTurn2);
    assert.equal(pRentTurn2Echoed.scenarioState.directGroups?.length, 2, 'Echoed history + recurring group must retain exactly 2 groups');

    console.log('✓ 8B. Finding 2 recurring journal entries preserved across turns verified');
    passed++;
  }

  // 8C: Core Double-Entry Invariant Validation (Structural & Mathematical)
  {
    // Dual-sided line must fail
    const dualSidedGroup = [{
      id: 'grp-dual',
      title: 'Invalid Line',
      totalDebit: 4000,
      totalCredit: 4000,
      isBalanced: true,
      lines: [
        { accountName: 'Salaries Payable', category: 'LIABILITY', debit: 4000, credit: 4000 },
        { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 0 }
      ]
    }];
    const vDual = validateJournalGroups(dualSidedGroup);
    assert.equal(vDual.isValid, false, 'Dual-sided line must fail');
    assert.ok(vDual.issues.some(i => i.code === 'ZERO_OR_DUAL_SIDED_LINE'));

    // Zero-number query fabricating amounts must fail
    const validLines = [{
      id: 'grp-zero-nums',
      title: 'Fabricated Numbers',
      totalDebit: 4000,
      totalCredit: 4000,
      isBalanced: true,
      lines: [
        { accountName: 'Trade Payables', category: 'LIABILITY', debit: 4000, credit: 0 },
        { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 4000 }
      ]
    }];
    const vZeroNums = validateJournalGroups(validLines, { rawQuery: 'Pay trade payables by bank transfer' });
    assert.equal(vZeroNums.isValid, false, 'Fabricated number on zero-number query must fail');
    assert.ok(vZeroNums.issues.some(i => i.code === 'UNSTATED_AMOUNT'));

    console.log('✓ 8C. Core double-entry invariant validation verified');
    passed++;
  }

  // 8D: Finding 4 — Prior journal amounts cannot be self-added & settlement bounded by outstanding balance
  {
    // Turn 1 scenario state: Supplier payable of S$1,000 recognised
    const turn1Scenario = {
      scenarioType: 'UNIVERSAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      rawQuery: 'Purchased inventory for S$1,000 on 30 days credit from supplier.',
      transactionTitle: 'Inventory Purchase on Credit',
      amount: 1000,
      isComplete: true,
      committedDirectGroups: [{
        id: 'grp-turn1-inv',
        title: 'Inventory Purchase',
        eventDate: '01/02/2025',
        totalDebit: 1000,
        totalCredit: 1000,
        isBalanced: true,
        lines: [
          { accountName: 'Inventory', category: 'ASSET', debit: 1000, credit: 0 },
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
        ]
      }],
      directGroups: [{
        id: 'grp-turn1-inv',
        title: 'Inventory Purchase',
        eventDate: '01/02/2025',
        totalDebit: 1000,
        totalCredit: 1000,
        isBalanced: true,
        lines: [
          { accountName: 'Inventory', category: 'ASSET', debit: 1000, credit: 0 },
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
        ]
      }]
    };

    // Turn 2: "We paid the supplier by bank."
    // Rogue AI hallucinates Dr Trade Payables S$2,000 / Cr Cash at Bank S$2,000
    const rogue2kGroups = [{
      id: 'grp-turn2-pay',
      title: 'Supplier Settlement',
      eventDate: '15/02/2025',
      totalDebit: 2000,
      totalCredit: 2000,
      isBalanced: true,
      lines: [
        { accountName: 'Trade Payables', category: 'LIABILITY', debit: 2000, credit: 0 },
        { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 2000 }
      ]
    }];

    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Supplier Settlement',
      directGroups: rogue2kGroups
    });

    const res8D1 = await processAccountingQuery(
      'We paid the supplier by bank.',
      turn1Scenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );
    assert.equal(res8D1.scenarioState.directGroups?.length, 1, 'Turn 2 rogue S$2,000 must be rejected and Turn 1 preserved');
    assert.match(res8D1.messageText, /AI-Proposed Journal Rejected/i);

    // Also test when Turn 2 mentions the S$1,000 amount explicitly: "We paid the S$1,000 supplier payable by bank."
    const res8D2 = await processAccountingQuery(
      'We paid the S$1,000 supplier payable by bank.',
      turn1Scenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );
    assert.equal(res8D2.scenarioState.directGroups?.length, 1, 'Restating S$1,000 in Turn 2 must not permit S$2,000 self-addition');
    assert.match(res8D2.messageText, /AI-Proposed Journal Rejected/i);

    // Valid S$1,000 full settlement is accepted
    const valid1kGroups = [{
      id: 'grp-turn2-pay-1k',
      title: 'Supplier Settlement',
      eventDate: '15/02/2025',
      totalDebit: 1000,
      totalCredit: 1000,
      isBalanced: true,
      lines: [
        { accountName: 'Trade Payables', category: 'LIABILITY', debit: 1000, credit: 0 },
        { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 1000 }
      ]
    }];
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Supplier Settlement',
      directGroups: valid1kGroups
    });
    const res8D3 = await processAccountingQuery(
      'We paid the supplier by bank.',
      turn1Scenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );
    assert.equal(res8D3.scenarioState.directGroups?.length, 2, 'Valid S$1,000 settlement must be accepted alongside Turn 1');

    // Partial settlement of S$600 is also accepted
    const valid600Groups = [{
      id: 'grp-turn2-pay-600',
      title: 'Partial Supplier Settlement',
      eventDate: '15/02/2025',
      totalDebit: 600,
      totalCredit: 600,
      isBalanced: true,
      lines: [
        { accountName: 'Trade Payables', category: 'LIABILITY', debit: 600, credit: 0 },
        { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
      ]
    }];
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Partial Supplier Settlement',
      directGroups: valid600Groups
    });
    const res8D4 = await processAccountingQuery(
      'We paid S$600 to the supplier by bank.',
      turn1Scenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );
    assert.equal(res8D4.scenarioState.directGroups?.length, 2, 'Stated partial settlement S$600 must be accepted');

    // Reviewer edge case 4a: Independent new transaction must not be polluted by prior turn amounts
    const independentQuery = 'This is a new question: record the journal entry for office equipment purchase paid by bank.';
    const fabricatedPriorAmountGroup = [{
      id: 'grp-fab-prior',
      title: 'Equipment Purchase',
      eventDate: '01/03/2025',
      totalDebit: 1000, // Fabricates Turn 1's S$1,000 instead of current S$500
      totalCredit: 1000,
      isBalanced: true,
      lines: [
        { accountName: 'Office Equipment', category: 'ASSET', debit: 1000, credit: 0 },
        { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 1000 }
      ]
    }];
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Equipment Purchase',
      directGroups: fabricatedPriorAmountGroup
    });
    const resIndependent = await processAccountingQuery(
      independentQuery,
      turn1Scenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );
    assert.equal(resIndependent.scenarioState.directGroups?.length, 0, 'Independent transaction must reject fabricated prior amount');
    assert.match(resIndependent.messageText, /AI-Proposed Journal Rejected/i);

    // Reviewer edge case 4b: Stating a single amount in follow-up constrains 2-line journal to current amount
    const followUpQuery = 'We paid S$600 to the supplier by bank.';
    const roguePriorIn2LineGroup = [{
      id: 'grp-rogue-2line',
      title: 'Supplier Settlement',
      eventDate: '15/02/2025',
      totalDebit: 1000, // Contradicts single stated current turn amount of S$600
      totalCredit: 1000,
      isBalanced: true,
      lines: [
        { accountName: 'Trade Payables', category: 'LIABILITY', debit: 1000, credit: 0 },
        { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 1000 }
      ]
    }];
    const vRogue2Line = validateJournalGroups(roguePriorIn2LineGroup, {
      rawQuery: followUpQuery,
      enforceAmountProvenance: true,
      outstandingBalances: [{
        balanceKey: 'bal-1',
        accountName: 'Trade Payables',
        category: 'LIABILITY',
        nature: 'PAYABLE',
        direction: 'payable',
        originalAmount: 600,
        settledAmount: 0,
        remainingAmount: 600,
        status: 'open',
        currency: 'SGD'
      }],
      isFollowUp: true
    });
    assert.equal(vRogue2Line.isValid, false, 'Settlement exceeding remaining balance must fail validation');
    assert.ok(vRogue2Line.issues.some(i => i.code === 'SETTLEMENT_EXCEEDS_BALANCE'));

    console.log('✓ 8D. Finding 4 self-addition across turns rejected & settlement bounded by outstanding balance');
    passed++;
  }

  // 8E: Finding 5 — Account-category inference prioritises specific relationships & fails closed on ambiguity
  {
    assert.equal(inferAccountCategoryFromName('Loan Receivable'), 'ASSET');
    assert.equal(inferAccountCategoryFromName('Loans Receivable'), 'ASSET');
    assert.equal(inferAccountCategoryFromName('Director Loan Receivable'), 'ASSET');
    assert.equal(inferAccountCategoryFromName('Notes Receivable'), 'ASSET');
    assert.equal(inferAccountCategoryFromName('Interest Receivable'), 'ASSET');
    assert.equal(inferAccountCategoryFromName('Deferred Tax Asset'), 'ASSET');

    // Misclassified Loan Receivable as LIABILITY fails validation with CATEGORY_MISMATCH
    const misclassifiedGroups = [{
      id: 'grp-loan-mis',
      title: 'Loan Disbursed',
      eventDate: '01/03/2025',
      totalDebit: 5000,
      totalCredit: 5000,
      isBalanced: true,
      lines: [
        { accountName: 'Loan Receivable', category: 'LIABILITY', debit: 5000, credit: 0 },
        { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 5000 }
      ]
    }];
    const vMis = validateJournalGroups(misclassifiedGroups);
    assert.equal(vMis.isValid, false);
    assert.ok(vMis.issues.some(i => i.code === 'CATEGORY_MISMATCH' && i.accountName === 'Loan Receivable'));

    // Ambiguous hybrid accounts fail closed (return undefined)
    assert.equal(inferAccountCategoryFromName('Loan Receivable / Payable Clearing'), undefined);
    assert.equal(inferAccountCategoryFromName('Custom Suspense Clearing'), undefined);

    // Reviewer edge case 5a: Bare ambiguous loans without receivable/payable/direction fail closed
    assert.equal(inferAccountCategoryFromName('Director Loan'), undefined, 'Bare "Director Loan" must return undefined');
    assert.equal(inferAccountCategoryFromName('Staff Loan'), undefined, 'Bare "Staff Loan" must return undefined');
    assert.equal(inferAccountCategoryFromName('Shareholder Loan'), undefined, 'Bare "Shareholder Loan" must return undefined');

    // Reviewer edge case 5b: Bare ambiguous "Deposit" fails closed
    assert.equal(inferAccountCategoryFromName('Deposit'), undefined, 'Bare "Deposit" must return undefined');
    assert.equal(inferAccountCategoryFromName('Deposits'), undefined, 'Bare "Deposits" must return undefined');

    // Reviewer edge case 5c: Explicit customer/tenant deposits and advances are LIABILITY
    assert.equal(inferAccountCategoryFromName('Customer Deposit'), 'LIABILITY');
    assert.equal(inferAccountCategoryFromName('Customer Deposits'), 'LIABILITY');
    assert.equal(inferAccountCategoryFromName('Tenant Deposit'), 'LIABILITY');
    assert.equal(inferAccountCategoryFromName('Advances from Customers'), 'LIABILITY');
    assert.equal(getMandatoryCategory('Customer Deposits'), 'LIABILITY');

    // Reviewer edge case 5d: Explicit directional loans
    assert.equal(inferAccountCategoryFromName('Director Loan Payable'), 'LIABILITY');
    assert.equal(inferAccountCategoryFromName('Loan from Director'), 'LIABILITY');
    assert.equal(inferAccountCategoryFromName('Loan from Shareholder'), 'LIABILITY');
    assert.equal(inferAccountCategoryFromName('Loan to Director'), 'ASSET');
    assert.equal(inferAccountCategoryFromName('Loan to Staff'), 'ASSET');
    assert.equal(inferAccountCategoryFromName('Security Deposit'), 'ASSET');
    assert.equal(inferAccountCategoryFromName('Rental Deposit'), 'ASSET');

    const emptyCategoryGroups = [{
      id: 'grp-ambig',
      title: 'Suspense Entry',
      eventDate: '01/03/2025',
      totalDebit: 500,
      totalCredit: 500,
      isBalanced: true,
      lines: [
        { accountName: 'Custom Suspense Clearing', category: '', debit: 500, credit: 0 },
        { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
      ]
    }];
    const vAmbig = validateJournalGroups(emptyCategoryGroups);
    assert.equal(vAmbig.isValid, false);
    assert.ok(vAmbig.issues.some(i => i.code === 'INVALID_LINE'));

    console.log('✓ 8E. Finding 5 account-category inference specific relationships & fail-closed verified');
    passed++;
  }

  // 8F: Finding 6 — Bounded amount-validation complexity benchmark
  {
    const lengthyQuery = 'Settlement of January rent S$3,500, office supplies S$450, and 9% GST over 12 months with S$150 deposit.';
    const priorTexts = [
      'Purchased equipment for S$24,000 with 5-year useful life.',
      'Recognised payroll of S$8,000 and employer CPF of S$1,360.',
      'Purchased inventory of S$12,500 subject to 9% GST on credit.',
      'Paid supplier S$5,000 by bank transfer on 30-day terms.'
    ];
    const priorAmounts = [24000, 8000, 1360, 12500, 5000, 150, 450, 3500];

    const t0 = performance.now();
    const groupsToValidate = [{
      id: 'grp-bench',
      title: 'Benchmark Group',
      eventDate: '01/03/2025',
      totalDebit: 3500,
      totalCredit: 3500,
      isBalanced: true,
      lines: [
        { accountName: 'Rent Expense', category: 'EXPENSE', debit: 3500, credit: 0 },
        { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 3500 }
      ]
    }];
    const vResult = validateJournalGroups(groupsToValidate, {
      rawQuery: lengthyQuery,
      enforceAmountProvenance: true,
      priorContextTexts: priorTexts,
      priorContextAmounts: priorAmounts,
      isFollowUp: true
    });
    const elapsedMs = performance.now() - t0;

    assert.ok(vResult.isValid, 'Benchmark entry must be valid');
    assert.ok(elapsedMs < 10, `Execution time (${elapsedMs.toFixed(2)}ms) must be strictly below 10ms budget`);

    console.log(`✓ 8F. Finding 6 bounded complexity benchmark completed in ${elapsedMs.toFixed(2)}ms (< 10ms budget)`);
    passed++;
  }

  // --------------------------------------------------------------------------
  // 9. Comprehensive 15-Scenario AI-First Double-Entry Architecture Verification
  // --------------------------------------------------------------------------
  console.log('\n--- 9. Comprehensive 15-Scenario AI-First Double-Entry Architecture Verification ---');

  // 9A: Multi-turn cumulative partial settlement & balance reconciliation (Turn 1 -> Turn 2 -> Turn 3a/3b)
  {
    // Turn 1: Purchased inventory on credit for S$1,000
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Inventory Purchase on Credit',
      directGroups: [{
        id: 'grp-inv-1',
        title: 'Inventory Purchase',
        eventDate: '01/03/2025',
        totalDebit: 1000,
        totalCredit: 1000,
        isBalanced: true,
        lines: [
          { accountName: 'Inventory', category: 'ASSET', debit: 1000, credit: 0 },
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
        ]
      }]
    });
    const res1 = await processAccountingQuery(
      'Purchased inventory on credit for S$1,000.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );
    assert.equal(res1.scenarioState.committedDirectGroups?.length, 1, 'Turn 1 must commit 1 journal group');
    const acctCtx1 = extractAccountingContext(res1.scenarioState);
    assert.equal(acctCtx1.outstandingBalances.length, 1, 'Turn 1 must track 1 outstanding balance');
    assert.equal(acctCtx1.outstandingBalances[0].accountName, 'Trade Payables');
    assert.equal(acctCtx1.outstandingBalances[0].remainingAmount, 1000);
    assert.equal(acctCtx1.outstandingBalances[0].status, 'open');

    // Turn 2: Paid supplier S$600 by bank transfer
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Supplier Partial Payment',
      directGroups: [{
        id: 'grp-settle-1',
        title: 'Supplier Settlement',
        eventDate: '15/03/2025',
        totalDebit: 600,
        totalCredit: 600,
        isBalanced: true,
        lines: [
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 600, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
        ]
      }]
    });
    const res2 = await processAccountingQuery(
      'Paid supplier S$600 by bank transfer.',
      res1.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );
    const acctCtx2 = extractAccountingContext(res2.scenarioState);
    assert.equal(acctCtx2.outstandingBalances[0].remainingAmount, 400, 'Remaining balance must be S$400 after S$600 settlement');
    assert.equal(acctCtx2.outstandingBalances[0].status, 'partial', 'Status must be partial');
    assert.match(res2.messageText, /Remaining balance \(Trade Payables\): (?:S\$|SGD)\s*400\.00/, 'Markdown table must display remaining balance 400.00');

    // Turn 3a (excess settlement rejected): Paid supplier another S$600 by bank transfer
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Supplier Excess Payment',
      directGroups: [{
        id: 'grp-settle-excess',
        title: 'Excess Supplier Settlement',
        eventDate: '20/03/2025',
        totalDebit: 600,
        totalCredit: 600,
        isBalanced: true,
        lines: [
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 600, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
        ]
      }]
    });
    const res3a = await processAccountingQuery(
      'Paid supplier another S$600 by bank transfer.',
      res2.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );
    assert.match(res3a.messageText, /AI-Proposed Journal Rejected/i, 'Excess settlement must be rejected');
    assert.equal(res3a.scenarioState.directGroups?.length, 2, 'Must preserve the 2 committed groups upon rejection');

    // Turn 3b (valid final settlement): Paid supplier the remaining S$400 by bank transfer
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Supplier Final Payment',
      directGroups: [{
        id: 'grp-settle-2',
        title: 'Final Supplier Settlement',
        eventDate: '25/03/2025',
        totalDebit: 400,
        totalCredit: 400,
        isBalanced: true,
        lines: [
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 400, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 400 }
        ]
      }]
    });
    const res3b = await processAccountingQuery(
      'Paid supplier the remaining S$400 by bank transfer.',
      res2.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );
    assert.equal(res3b.scenarioState.committedDirectGroups?.length, 3, 'Must have 3 committed groups after final settlement');
    const acctCtx3b = extractAccountingContext(res3b.scenarioState);
    assert.equal(acctCtx3b.outstandingBalances[0].remainingAmount, 0, 'Remaining balance must be 0 after full settlement');
    assert.equal(acctCtx3b.outstandingBalances[0].status, 'settled', 'Status must be settled');

    console.log('✓ 9A. Multi-turn cumulative partial settlement & balance reconciliation verified');
    passed++;
  }

  // 9B: Multi-group sale + COGS, Loan repayment with interest, FX gain/loss
  {
    // 1) Multi-group sale + COGS from one question
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Credit Sale and Inventory Cost Recognition',
      directGroups: [
        {
          id: 'grp-sale-1',
          title: 'Credit Sale Recognition',
          eventDate: '01/03/2025',
          totalDebit: 5450,
          totalCredit: 5450,
          isBalanced: true,
          lines: [
            { accountName: 'Trade Receivables', category: 'ASSET', debit: 5450, credit: 0 },
            { accountName: 'Sales Revenue', category: 'REVENUE', debit: 0, credit: 5000 },
            { accountName: 'Output GST Payable', category: 'LIABILITY', debit: 0, credit: 450 }
          ]
        },
        {
          id: 'grp-cogs-1',
          title: 'Cost of Goods Sold Recognition',
          eventDate: '01/03/2025',
          totalDebit: 3000,
          totalCredit: 3000,
          isBalanced: true,
          lines: [
            { accountName: 'Cost of Goods Sold', category: 'EXPENSE', debit: 3000, credit: 0 },
            { accountName: 'Inventory', category: 'ASSET', debit: 0, credit: 3000 }
          ]
        }
      ]
    });
    const resSale = await processAccountingQuery(
      'Sold goods on credit for S$5,000 plus 9% GST. Cost of inventory was S$3,000.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );
    assert.equal(resSale.scenarioState.directGroups?.length, 2, 'Must produce 2 direct groups');
    assert.match(resSale.messageText, /#### Journal 1 — Credit Sale Recognition/);
    assert.match(resSale.messageText, /#### Journal 2 — Cost of Goods Sold Recognition/);
    assert.match(resSale.messageText, /\|\s*\*\*Total\*\*\s*\|\s*\*\*5,450\.00\*\*\s*\|\s*\*\*5,450\.00\*\*\s*\|/);
    assert.match(resSale.messageText, /\|\s*\*\*Total\*\*\s*\|\s*\*\*3,000\.00\*\*\s*\|\s*\*\*3,000\.00\*\*\s*\|/);
    assert.match(resSale.messageText, /\|\s*—\s*\|/);

    // 2) Loan repayment with interest
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Bank Loan Repayment with Interest',
      directGroups: [{
        id: 'grp-loan-rep',
        title: 'Loan Principal and Interest Payment',
        eventDate: '01/03/2025',
        totalDebit: 5250,
        totalCredit: 5250,
        isBalanced: true,
        lines: [
          { accountName: 'Bank Loan', category: 'LIABILITY', debit: 5000, credit: 0 },
          { accountName: 'Interest Expense', category: 'EXPENSE', debit: 250, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 5250 }
        ]
      }]
    });
    const resLoan = await processAccountingQuery(
      'Repaid bank loan principal of S$5,000 along with S$250 interest from bank account.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );
    assert.equal(resLoan.scenarioState.directGroups?.length, 1);
    assert.equal(resLoan.scenarioState.directGroups[0].totalDebit, 5250);
    assert.equal(resLoan.scenarioState.directGroups[0].totalCredit, 5250);
    assert.equal(resLoan.scenarioState.directGroups[0].isBalanced, true);

    // 3) Foreign currency purchase & settlement with FX gain
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Settlement of Foreign Currency Payables',
      directGroups: [{
        id: 'grp-fx-settle',
        title: 'FX Trade Payables Settlement',
        eventDate: '01/03/2025',
        totalDebit: 13500,
        totalCredit: 13500,
        isBalanced: true,
        lines: [
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 13500, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 13200 },
          { accountName: 'Foreign Exchange Gain', category: 'REVENUE', debit: 0, credit: 300 }
        ]
      }]
    });
    const resFx = await processAccountingQuery(
      'Settled USD supplier liability booked at S$13,500 using bank transfer of S$13,200 with S$300 FX gain.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );
    assert.equal(resFx.scenarioState.directGroups?.length, 1);
    assert.equal(resFx.scenarioState.directGroups[0].totalDebit, 13500);
    assert.equal(resFx.scenarioState.directGroups[0].totalCredit, 13500);
    assert.equal(resFx.scenarioState.directGroups[0].isBalanced, true);

    console.log('✓ 9B. Credit sale + COGS multi-group, loan repayment, and FX gain entries verified');
    passed++;
  }

  // 9C: Hypothetical / Conditional accounting question (End-to-End)
  {
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Hypothetical Supplier Payment',
      transactionStatus: 'hypothetical',
      journalAction: 'illustrative',
      directGroups: [{
        id: 'grp-hypo-1',
        title: 'Hypothetical Settlement',
        eventDate: '01/04/2025',
        transactionStatus: 'hypothetical',
        journalAction: 'illustrative',
        totalDebit: 5000,
        totalCredit: 5000,
        isBalanced: true,
        lines: [
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 5000, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 5000 }
        ]
      }]
    });
    const resHypo = await processAccountingQuery(
      'If the company pays its supplier S$5,000 next month, what is the double entry?',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );
    assert.equal(resHypo.scenarioState.directGroups?.length, 1, 'Must have 1 illustrative direct group');
    assert.equal(resHypo.scenarioState.directGroups[0].isHypothetical, true, 'Group must be marked isHypothetical === true');
    assert.equal(resHypo.scenarioState.committedDirectGroups?.length ?? 0, 0, 'Hypothetical group must not be committed to ledger history');
    assert.match(resHypo.messageText, /\*\(Illustrative \/ Conditional\)\*/, 'Message markdown header must contain *(Illustrative / Conditional)*');

    console.log('✓ 9C. Hypothetical / conditional accounting question (End-to-End) verified');
    passed++;
  }

  // 9D: Follow-up transaction revision (journalAction: 'revised') & Display restatement (journalAction: 'restatement')
  {
    // Turn 1: Initial office supplies purchase of S$500
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Office Supplies Purchase',
      directGroups: [{
        id: 'grp-sup-1',
        title: 'Office Supplies Purchase',
        eventDate: '01/03/2025',
        totalDebit: 500,
        totalCredit: 500,
        isBalanced: true,
        lines: [
          { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
        ]
      }]
    });
    const resSup1 = await processAccountingQuery(
      'Purchased office supplies for S$500 by bank.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );
    assert.equal(resSup1.scenarioState.committedDirectGroups?.length, 1);
    assert.equal(resSup1.scenarioState.committedDirectGroups[0].totalDebit, 500);

    // Turn 2: Revision - Correction to S$650
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Revised Office Supplies Purchase',
      directGroups: [{
        id: 'grp-sup-1',
        title: 'Office Supplies Purchase (Revised)',
        eventDate: '01/03/2025',
        journalAction: 'revised',
        totalDebit: 650,
        totalCredit: 650,
        isBalanced: true,
        lines: [
          { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 650, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 650 }
        ]
      }]
    });
    const resRev = await processAccountingQuery(
      'Correction: the office supplies purchase was actually S$650, not S$500.',
      resSup1.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );
    assert.equal(resRev.scenarioState.committedDirectGroups?.length, 1, 'Revised entry must replace prior in-place without duplicating');
    assert.equal(resRev.scenarioState.committedDirectGroups[0].totalDebit, 650, 'Revised entry amount must be 650');

    // Turn 3: Display restatement
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Display Restatement',
      directGroups: [{
        id: 'grp-sup-1',
        title: 'Office Supplies Purchase',
        eventDate: '01/03/2025',
        journalAction: 'restatement',
        totalDebit: 650,
        totalCredit: 650,
        isBalanced: true,
        lines: [
          { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 650, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 650 }
        ]
      }]
    });
    const resRestate = await processAccountingQuery(
      'Show me the office supplies journal entry again.',
      resRev.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );
    assert.equal(resRestate.scenarioState.committedDirectGroups?.length, 1, 'Restatement must display journal without creating duplicate committed entry');

    console.log('✓ 9D. Follow-up transaction revision & display restatement verified');
    passed++;
  }

  // 9E: Incomplete period date handling (accountingPeriod vs eventDate)
  {
    const rentQuery = 'Accrue rent for February 2025';
    const rentContext = await buildGroundedReasoningContext(rentQuery);
    const rawAiPayload = {
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Monthly Rent Accrual',
      directGroups: [{
        id: 'grp-period-1',
        title: 'Monthly Rent Accrual',
        eventDate: 'February 2025',
        totalDebit: 3000,
        totalCredit: 3000,
        isBalanced: true,
        lines: [
          { accountName: 'Rent Expense', category: 'EXPENSE', debit: 3000, credit: 0 },
          { accountName: 'Accrued Operating Expenses', category: 'LIABILITY', debit: 0, credit: 3000 }
        ]
      }]
    };
    const processed = postProcessAIResponse(
      rawAiPayload,
      null,
      rentQuery,
      rentContext
    );
    assert.equal(processed.scenarioState.directGroups[0].eventDate, '', 'Incomplete period date must not invent day 01/02/2025 in eventDate');
    assert.equal(processed.scenarioState.directGroups[0].accountingPeriod, 'February 2025', 'Incomplete period date must populate accountingPeriod');
    assert.match(processed.messageText, /\(February 2025\)/, 'Markdown header must render (February 2025)');
    assert.doesNotMatch(processed.messageText, /01\/02\/2025/, 'Must not invent 01/02/2025');

    console.log('✓ 9E. Incomplete period date handling (accountingPeriod vs eventDate) verified');
    passed++;
  }

  // 9F: Bounded 1-Retry Self-Correction on Unbalanced AI Output
  {
    const fetchCalls = [];
    globalThis.fetch = async (_url, options) => {
      fetchCalls.push(options?.body ? JSON.parse(options.body) : null);
      if (fetchCalls.length === 1) {
        // First call returns an imbalanced journal entry
        return makeGeminiSuccessResponse({
          responseKind: 'JOURNAL_ENTRY',
          transactionTitle: 'Office Equipment Acquisition',
          directGroups: [{
            id: 'grp-equip-imbal',
            title: 'Equipment Acquisition',
            eventDate: '01/03/2025',
            totalDebit: 5000,
            totalCredit: 4500,
            isBalanced: false,
            lines: [
              { accountName: 'Office Equipment', category: 'ASSET', debit: 5000, credit: 0 },
              { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 4500 }
            ]
          }]
        });
      }
      // Second call (correction retry) returns the corrected balanced entry
      return makeGeminiSuccessResponse({
        responseKind: 'JOURNAL_ENTRY',
        transactionTitle: 'Office Equipment Acquisition',
        directGroups: [{
          id: 'grp-equip-bal',
          title: 'Equipment Acquisition',
          eventDate: '01/03/2025',
          totalDebit: 5000,
          totalCredit: 5000,
          isBalanced: true,
          lines: [
            { accountName: 'Office Equipment', category: 'ASSET', debit: 5000, credit: 0 },
            { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 5000 }
          ]
        }]
      });
    };

    const resRetry = await processAccountingQuery(
      'Purchased office equipment for S$5,000 paid by bank transfer.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );
    assert.equal(fetchCalls.length, 2, 'Must execute exactly 1 initial call + 1 bounded correction retry');
    assert.equal(resRetry.scenarioState.directGroups?.length, 1, 'Must accept the corrected journal group');
    assert.equal(resRetry.scenarioState.directGroups[0].totalDebit, 5000);
    assert.equal(resRetry.scenarioState.directGroups[0].totalCredit, 5000);
    assert.equal(resRetry.scenarioState.directGroups[0].isBalanced, true);
    assert.doesNotMatch(resRetry.messageText, /AI-Proposed Journal Rejected/i, 'Must not reject corrected entry');

    console.log('✓ 9F. Bounded 1-retry self-correction on unbalanced AI output verified');
    passed++;
  }

  console.log('\n--- 10. Review Findings 1–4 & Image Validation Regressions ---');

  // 10A: Finding 1 — Revised journal validation
  {
    const turn1Scenario = {
      scenarioType: 'UNIVERSAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      rawQuery: 'Purchased office supplies for S$500 paid by bank transfer.',
      transactionTitle: 'Office Supplies Purchase',
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      isComplete: true,
      committedDirectGroups: [{
        id: 'grp-sup-1',
        eventDate: '01/03/2025',
        title: 'Office Supplies Purchase',
        summary: 'Purchased office supplies for S$500',
        lines: [
          { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
        ],
        totalDebit: 500,
        totalCredit: 500,
        isBalanced: true
      }],
      directGroups: [{
        id: 'grp-sup-1',
        eventDate: '01/03/2025',
        title: 'Office Supplies Purchase',
        summary: 'Purchased office supplies for S$500',
        lines: [
          { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
        ],
        totalDebit: 500,
        totalCredit: 500,
        isBalanced: true
      }]
    };

    // Turn 2 returns revised entry with SAME ID 'grp-sup-1', but imbalanced (650 vs 600)
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Revised Office Supplies Purchase',
      directGroups: [{
        id: 'grp-sup-1',
        eventDate: '01/03/2025',
        title: 'Revised Office Supplies Purchase',
        summary: 'Correction to office supplies purchase',
        journalAction: 'revised',
        totalDebit: 650,
        totalCredit: 600,
        isBalanced: false,
        lines: [
          { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 650, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
        ]
      }]
    });

    const res10A = await processAccountingQuery(
      'Correction: the supplies were actually S$650.',
      turn1Scenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.match(res10A.messageText, /AI-Proposed Journal Rejected/i, 'Imbalanced revised journal must be rejected');
    assert.equal(res10A.scenarioState.isComplete, false, 'Must not be complete');
    assert.equal(res10A.scenarioState.committedDirectGroups?.length, 1, 'Must preserve Turn 1 committed direct group');
    assert.equal(res10A.scenarioState.committedDirectGroups[0].totalDebit, 500, 'Must preserve original S$500 amount');
    console.log('✓ 10A. Finding 1 revised journal validation verified');
    passed++;
  }

  // 10B: Finding 2 — Unidentified correction does not overwrite wrong transaction
  {
    const turn1Scenario = {
      scenarioType: 'UNIVERSAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      rawQuery: 'Purchased inventory for S$1,000 on credit, then paid supplier S$600 by bank transfer.',
      transactionTitle: 'Inventory Purchase & Payment',
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      isComplete: true,
      committedDirectGroups: [
        {
          id: 'grp-inv-1',
          transactionId: 'grp-inv-1',
          eventDate: '01/03/2025',
          title: 'Inventory Purchase',
          summary: 'Purchased inventory on credit',
          lines: [
            { accountName: 'Inventory', category: 'ASSET', debit: 1000, credit: 0 },
            { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
          ],
          totalDebit: 1000,
          totalCredit: 1000,
          isBalanced: true
        },
        {
          id: 'grp-pay-1',
          transactionId: 'grp-pay-1',
          eventDate: '05/03/2025',
          title: 'Supplier Settlement',
          summary: 'Partial payment to supplier',
          lines: [
            { accountName: 'Trade Payables', category: 'LIABILITY', debit: 600, credit: 0 },
            { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
          ],
          totalDebit: 600,
          totalCredit: 600,
          isBalanced: true
        }
      ],
      directGroups: [
        {
          id: 'grp-inv-1',
          transactionId: 'grp-inv-1',
          eventDate: '01/03/2025',
          title: 'Inventory Purchase',
          summary: 'Purchased inventory on credit',
          lines: [
            { accountName: 'Inventory', category: 'ASSET', debit: 1000, credit: 0 },
            { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
          ],
          totalDebit: 1000,
          totalCredit: 1000,
          isBalanced: true
        },
        {
          id: 'grp-pay-1',
          transactionId: 'grp-pay-1',
          eventDate: '05/03/2025',
          title: 'Supplier Settlement',
          summary: 'Partial payment to supplier',
          lines: [
            { accountName: 'Trade Payables', category: 'LIABILITY', debit: 600, credit: 0 },
            { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
          ],
          totalDebit: 600,
          totalCredit: 600,
          isBalanced: true
        }
      ]
    };

    // Subcase 1: Unidentified correction (generic accounts, unrecognised ID, no targetTransactionId)
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Transaction Correction',
      directGroups: [{
        id: 'grp-rev-unknown',
        eventDate: '01/03/2025',
        title: 'Correction Entry',
        summary: 'Correction of transaction amount',
        journalAction: 'revised',
        totalDebit: 1200,
        totalCredit: 1200,
        isBalanced: true,
        lines: [
          { accountName: 'General Expense', category: 'EXPENSE', debit: 1200, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 1200 }
        ]
      }]
    });

    const res10B1 = await processAccountingQuery(
      'Correction: it was actually S$1,200.',
      turn1Scenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res10B1.scenarioState.isComplete, false, 'Unidentified revision must prompt clarification');
    assert.match(res10B1.messageText, /Clarification Required — Ambiguous Revision Target/i);
    assert.ok(res10B1.scenarioState.missingFields?.some(f => f.fieldKey === 'revisionTarget'));
    assert.equal(res10B1.scenarioState.committedDirectGroups?.length, 2, 'Must preserve both committed groups');
    assert.equal(res10B1.scenarioState.committedDirectGroups[1].id, 'grp-pay-1', 'Must not overwrite Group 2');
    assert.equal(res10B1.scenarioState.committedDirectGroups[1].totalDebit, 600, 'Must preserve Group 2 amount');

    // Subcase 2: Valid identified correction with targetTransactionId: 'grp-inv-1'
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Inventory Purchase Revision',
      directGroups: [{
        id: 'grp-inv-revised',
        targetTransactionId: 'grp-inv-1',
        eventDate: '01/03/2025',
        title: 'Revised Inventory Purchase',
        summary: 'Revised inventory purchase cost',
        journalAction: 'revised',
        totalDebit: 1200,
        totalCredit: 1200,
        isBalanced: true,
        lines: [
          { accountName: 'Inventory', category: 'ASSET', debit: 1200, credit: 0 },
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1200 }
        ]
      }]
    });

    const res10B2 = await processAccountingQuery(
      'Correction: the inventory purchase was actually S$1,200.',
      turn1Scenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res10B2.scenarioState.committedDirectGroups?.length, 2, 'Must keep 2 committed groups');
    assert.equal(res10B2.scenarioState.committedDirectGroups[0].id, 'grp-inv-1', 'Group 1 id must remain grp-inv-1');
    assert.equal(res10B2.scenarioState.committedDirectGroups[0].transactionId, 'grp-inv-1', 'Group 1 transactionId must remain grp-inv-1');
    assert.equal(res10B2.scenarioState.committedDirectGroups[0].revisedFromId, 'grp-inv-revised', 'Group 1 revisedFromId must track revised payload ID');
    assert.equal(res10B2.scenarioState.committedDirectGroups[0].totalDebit, 1200, 'Group 1 must be revised to S$1,200');
    assert.equal(res10B2.scenarioState.committedDirectGroups[1].id, 'grp-pay-1', 'Group 2 must remain intact');
    assert.equal(res10B2.scenarioState.committedDirectGroups[1].totalDebit, 600, 'Group 2 amount must remain S$600');
    console.log('✓ 10B. Finding 2 unidentified correction does not overwrite wrong transaction verified');
    passed++;
  }

  // 10C: Finding 3 — AI-generated remainingBalances reconciled against committed movements
  {
    const turn1Scenario = {
      scenarioType: 'UNIVERSAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      rawQuery: 'Received supplier invoice for office supplies S$1,000 on credit.',
      transactionTitle: 'Office Supplies Invoice',
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      isComplete: true,
      committedDirectGroups: [{
        id: 'grp-inv-10c',
        eventDate: '10/03/2025',
        title: 'Supplier Invoice',
        summary: 'Received supplier invoice',
        lines: [
          { accountName: 'Office Supplies', category: 'EXPENSE', debit: 1000, credit: 0 },
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
        ],
        totalDebit: 1000,
        totalCredit: 1000,
        isBalanced: true
      }],
      directGroups: [{
        id: 'grp-inv-10c',
        eventDate: '10/03/2025',
        title: 'Supplier Invoice',
        summary: 'Received supplier invoice',
        lines: [
          { accountName: 'Office Supplies', category: 'EXPENSE', debit: 1000, credit: 0 },
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
        ],
        totalDebit: 1000,
        totalCredit: 1000,
        isBalanced: true
      }]
    };

    // Turn 2: Payment of S$600, but AI erroneously returns remainingBalances of 1000
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Supplier Payment',
      directGroups: [{
        id: 'grp-pay-10c',
        eventDate: '15/03/2025',
        title: 'Supplier Payment',
        summary: 'Paid supplier S$600',
        lines: [
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 600, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
        ],
        totalDebit: 600,
        totalCredit: 600,
        isBalanced: true
      }],
      remainingBalances: [
        { accountName: 'Trade Payables', amount: 1000, currency: 'SGD' }
      ]
    });

    const res10C = await processAccountingQuery(
      'Paid supplier S$600 by bank transfer.',
      turn1Scenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.ok(res10C.scenarioState.remainingBalances, 'remainingBalances should exist');
    assert.equal(res10C.scenarioState.remainingBalances[0].amount, 400, 'Reconciled remaining balance must be S$400, not 1000');
    assert.match(res10C.messageText, /Remaining balance \(Trade Payables\): [^\n]*400\.00/, 'Message text must render authoritative 400.00');
    assert.doesNotMatch(res10C.messageText, /Remaining balance \(Trade Payables\): [^\n]*1,?000\.00/, 'Remaining balance line must not claim unverified 1,000.00');
    console.log('✓ 10C. Finding 3 AI-generated remainingBalances reconciled against committed movements verified');
    passed++;
  }

  // 10D: Finding 4 — Multiple outstanding invoices under same Trade Payables account
  {
    const twoInvoicesScenario = {
      scenarioType: 'UNIVERSAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      rawQuery: 'Received invoice 1 for S$600 and invoice 2 for S$400.',
      transactionTitle: 'Two Supplier Invoices',
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      isComplete: true,
      committedDirectGroups: [
        {
          id: 'inv-1',
          transactionId: 'inv-1',
          eventDate: '01/03/2025',
          title: 'Supplier Invoice 1',
          summary: 'Invoice 1 from supplier',
          lines: [
            { accountName: 'Office Supplies', category: 'EXPENSE', debit: 600, credit: 0 },
            { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 600 }
          ],
          totalDebit: 600,
          totalCredit: 600,
          isBalanced: true
        },
        {
          id: 'inv-2',
          transactionId: 'inv-2',
          eventDate: '05/03/2025',
          title: 'Supplier Invoice 2',
          summary: 'Invoice 2 from supplier',
          lines: [
            { accountName: 'Office Equipment', category: 'ASSET', debit: 400, credit: 0 },
            { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 400 }
          ],
          totalDebit: 400,
          totalCredit: 400,
          isBalanced: true
        }
      ],
      directGroups: [
        {
          id: 'inv-1',
          transactionId: 'inv-1',
          eventDate: '01/03/2025',
          title: 'Supplier Invoice 1',
          summary: 'Invoice 1 from supplier',
          lines: [
            { accountName: 'Office Supplies', category: 'EXPENSE', debit: 600, credit: 0 },
            { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 600 }
          ],
          totalDebit: 600,
          totalCredit: 600,
          isBalanced: true
        },
        {
          id: 'inv-2',
          transactionId: 'inv-2',
          eventDate: '05/03/2025',
          title: 'Supplier Invoice 2',
          summary: 'Invoice 2 from supplier',
          lines: [
            { accountName: 'Office Equipment', category: 'ASSET', debit: 400, credit: 0 },
            { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 400 }
          ],
          totalDebit: 400,
          totalCredit: 400,
          isBalanced: true
        }
      ]
    };

    // Case 1: Full settlement of both invoices (S$1,000)
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Full Settlement of Invoices',
      directGroups: [{
        id: 'grp-pay-full',
        eventDate: '10/03/2025',
        title: 'Full Payment',
        summary: 'Paid both invoices in full',
        lines: [
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 1000, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 1000 }
        ],
        totalDebit: 1000,
        totalCredit: 1000,
        isBalanced: true
      }]
    });

    const res10D1 = await processAccountingQuery(
      'Paid both supplier invoices for S$1,000 by bank transfer.',
      twoInvoicesScenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );
    assert.doesNotMatch(res10D1.messageText, /AI-Proposed Journal Rejected/i, 'Full multi-invoice settlement must not be rejected');
    assert.equal(res10D1.scenarioState.remainingBalances, undefined, 'All balances should be fully settled');

    // Case 2: Explicitly referenced single invoice settlement (targetTransactionId: 'inv-2', S$400)
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Payment for Invoice 2',
      directGroups: [{
        id: 'grp-pay-inv2',
        targetTransactionId: 'inv-2',
        eventDate: '10/03/2025',
        title: 'Payment of Invoice 2',
        summary: 'Paid invoice 2',
        lines: [
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 400, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 400 }
        ],
        totalDebit: 400,
        totalCredit: 400,
        isBalanced: true
      }]
    });

    const res10D2 = await processAccountingQuery(
      'Paid invoice 2 for S$400 by bank transfer.',
      twoInvoicesScenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );
    assert.doesNotMatch(res10D2.messageText, /AI-Proposed Journal Rejected/i);
    assert.ok(res10D2.scenarioState.remainingBalances?.length === 1, 'One invoice remaining');
    assert.equal(res10D2.scenarioState.remainingBalances[0].amount, 600, 'Remaining balance must be S$600 for inv-1');

    // Case 3: Ambiguous partial settlement across multiple open invoices without target reference
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Ambiguous Payment',
      directGroups: [{
        id: 'grp-pay-ambig',
        eventDate: '10/03/2025',
        title: 'Payment without Reference',
        summary: 'Paid supplier S$300',
        lines: [
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 300, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 300 }
        ],
        totalDebit: 300,
        totalCredit: 300,
        isBalanced: true
      }]
    });

    const res10D3 = await processAccountingQuery(
      'Paid supplier S$300 by bank transfer.',
      twoInvoicesScenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );
    assert.match(res10D3.messageText, /Clarification Required — Ambiguous Settlement Target|AMBIGUOUS_SETTLEMENT_TARGET/i, 'Ambiguous settlement must be flagged for clarification');
    assert.equal(res10D3.scenarioState.isComplete, false, 'Must not be marked complete');
    assert.ok(res10D3.scenarioState.missingFields?.some(f => f.fieldKey === 'settlementTarget'), 'Missing field must be settlementTarget');

    console.log('✓ 10D. Finding 4 multiple outstanding invoices handling verified');
    passed++;
  }

  // 10E: Additional Issue — Image-based journals pass through final validation
  {
    const chatWithImage = [
      {
        id: 'msg-1',
        sender: 'user',
        text: 'Record the purchase shown in this invoice screenshot.',
        images: [
          {
            id: 'img-inv-1',
            name: 'invoice.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
          }
        ]
      }
    ];

    // Subcase 1: Imbalanced journal extracted from image evidence
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Invoice from Screenshot',
      imageEvidence: [
        {
          imageId: 'img-inv-1',
          journalLines: [
            { accountName: 'Office Equipment', debit: 500, credit: 0 },
            { accountName: 'Cash at Bank', debit: 0, credit: 400 }
          ],
          fields: [{ field: 'invoiceDate', value: '01/03/2025' }]
        }
      ],
      directGroups: [{
        id: 'grp-img-imbal',
        eventDate: '01/03/2025',
        title: 'Invoice Journal',
        summary: 'Extracted from screenshot',
        totalDebit: 500,
        totalCredit: 400,
        isBalanced: false,
        lines: [
          { accountName: 'Office Equipment', category: 'ASSET', debit: 500, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 400 }
        ]
      }]
    });

    const res10E1 = await processAccountingQuery(
      'Record the purchase shown in this invoice screenshot.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      chatWithImage
    );

    assert.equal(res10E1.scenarioState.isComplete, false, 'Imbalanced image-derived journal must not be marked complete');
    assert.equal(res10E1.scenarioState.directGroups?.length ?? 0, 0, 'Direct groups must be empty on failed validation');
    assert.equal(res10E1.scenarioState.committedDirectGroups?.length ?? 0, 0, 'Committed direct groups must be empty on failed validation');
    assert.ok(
      res10E1.messageText.includes('AI-Proposed Journal Rejected') ||
      res10E1.messageText.includes('failed accounting validation') ||
      res10E1.scenarioState.missingFields?.some(f => f.fieldKey.startsWith('imageGuardrail-') || f.fieldKey === 'journalValidation'),
      'Imbalanced image journal must fail validation and be rejected'
    );

    // Subcase 2: Valid balanced journal from screenshot passes validation
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Invoice from Screenshot',
      imageEvidence: [
        {
          imageId: 'img-inv-1',
          journalLines: [
            { accountName: 'Office Equipment', debit: 500, credit: 0 },
            { accountName: 'Cash at Bank', debit: 0, credit: 500 }
          ],
          fields: [{ field: 'invoiceDate', value: '01/03/2025' }]
        }
      ],
      directGroups: [{
        id: 'grp-img-bal',
        eventDate: '01/03/2025',
        title: 'Invoice Journal',
        summary: 'Extracted from screenshot',
        totalDebit: 500,
        totalCredit: 500,
        isBalanced: true,
        lines: [
          { accountName: 'Office Equipment', category: 'ASSET', debit: 500, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
        ]
      }]
    });

    const res10E2 = await processAccountingQuery(
      'Record the purchase shown in this invoice screenshot.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      chatWithImage
    );

    assert.equal(res10E2.scenarioState.isComplete, true, 'Valid balanced image journal must pass validation');
    assert.equal(res10E2.scenarioState.directGroups?.length, 1, 'Must have 1 journal group');
    assert.equal(res10E2.scenarioState.committedDirectGroups?.length, 1, 'Must have 1 committed group');
    assert.deepEqual(res10E2.scenarioState.directGroups, res10E2.scenarioState.committedDirectGroups, 'Direct and committed groups must be synchronized');
    assert.equal(res10E2.scenarioState.directGroups[0].totalDebit, 500);
    assert.equal(res10E2.scenarioState.directGroups[0].totalCredit, 500);

    console.log('✓ 10E. Image-based journals pass through final validation verified');
    passed++;
  }

  // 10F: AI structured journal conflicting with screenshot extracted journal
  {
    const chatWithImage = [
      {
        id: 'msg-1',
        sender: 'user',
        text: 'Record the purchase shown in this invoice screenshot.',
        images: [
          {
            id: 'img-inv-1',
            name: 'invoice.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
          }
        ]
      }
    ];

    // Case 1: Conflicting AI journal (SGD 800) vs Image-extracted journal (SGD 500)
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Invoice from Screenshot',
      imageEvidence: [
        {
          imageId: 'img-inv-1',
          journalLines: [
            { accountName: 'Office Equipment', debit: 500, credit: 0 },
            { accountName: 'Cash at Bank', debit: 0, credit: 500 }
          ],
          fields: [{ field: 'invoiceDate', value: '01/03/2025' }]
        }
      ],
      directGroups: [{
        id: 'grp-ai-800',
        eventDate: '01/03/2025',
        title: 'Invoice Journal',
        summary: 'AI invented 800 amount',
        totalDebit: 800,
        totalCredit: 800,
        isBalanced: true,
        lines: [
          { accountName: 'Office Equipment', category: 'ASSET', debit: 800, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 800 }
        ]
      }]
    });

    const res10F1 = await processAccountingQuery(
      'Record the purchase shown in this invoice screenshot.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      chatWithImage
    );

    assert.equal(res10F1.scenarioState.isComplete, false, 'Conflicting AI journal must not be marked complete');
    assert.ok(res10F1.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_JOURNAL_CONFLICT'), 'Must include IMAGE_JOURNAL_CONFLICT guardrail');
    assert.equal(res10F1.scenarioState.directGroups?.length ?? 0, 0, 'directGroups must be empty on conflict');
    assert.equal(res10F1.scenarioState.committedDirectGroups?.length ?? 0, 0, 'committedDirectGroups must be empty on conflict');

    // Case 2: Matching AI journal (SGD 500)
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Invoice from Screenshot',
      imageEvidence: [
        {
          imageId: 'img-inv-1',
          journalLines: [
            { accountName: 'Office Equipment', debit: 500, credit: 0 },
            { accountName: 'Cash at Bank', debit: 0, credit: 500 }
          ],
          fields: [{ field: 'invoiceDate', value: '01/03/2025' }]
        }
      ],
      directGroups: [{
        id: 'grp-ai-500',
        eventDate: '01/03/2025',
        title: 'Invoice Journal',
        summary: 'Matching 500 amount',
        totalDebit: 500,
        totalCredit: 500,
        isBalanced: true,
        lines: [
          { accountName: 'Office Equipment', category: 'ASSET', debit: 500, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
        ]
      }]
    });

    const res10F2 = await processAccountingQuery(
      'Record the purchase shown in this invoice screenshot.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      chatWithImage
    );

    assert.equal(res10F2.scenarioState.isComplete, true, 'Matching AI journal must pass validation');
    assert.equal(res10F2.scenarioState.directGroups?.length, 1);
    assert.equal(res10F2.scenarioState.committedDirectGroups?.length, 1);
    assert.equal(res10F2.scenarioState.directGroups[0].totalDebit, 500);

    console.log('✓ 10F. Conflicting AI journal vs screenshot journal rejected verified');
    passed++;
  }

  // 10G: Failed image validation on a follow-up turn restores Turn 1 committed groups
  {
    const turn1Scenario = {
      scenarioType: 'UNIVERSAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      rawQuery: 'Purchased inventory S$1,000 on credit.',
      transactionTitle: 'Inventory Purchase',
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      isComplete: true,
      committedDirectGroups: [{
        id: 'grp-inv-turn1',
        transactionId: 'grp-inv-turn1',
        eventDate: '01/03/2025',
        title: 'Inventory Purchase',
        summary: 'Purchased inventory',
        lines: [
          { accountName: 'Inventory', category: 'ASSET', debit: 1000, credit: 0 },
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
        ],
        totalDebit: 1000,
        totalCredit: 1000,
        isBalanced: true
      }],
      directGroups: [{
        id: 'grp-inv-turn1',
        transactionId: 'grp-inv-turn1',
        eventDate: '01/03/2025',
        title: 'Inventory Purchase',
        summary: 'Purchased inventory',
        lines: [
          { accountName: 'Inventory', category: 'ASSET', debit: 1000, credit: 0 },
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
        ],
        totalDebit: 1000,
        totalCredit: 1000,
        isBalanced: true
      }]
    };

    const chatWithImageFollowUp = [
      {
        id: 'msg-1',
        sender: 'user',
        text: 'Purchased inventory S$1,000 on credit.'
      },
      {
        id: 'msg-2',
        sender: 'user',
        text: 'Here is the payment receipt screenshot.',
        images: [
          {
            id: 'img-pay-1',
            name: 'payment.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
          }
        ]
      }
    ];

    // Image-derived journal is imbalanced (500 vs 400)
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Payment Receipt from Screenshot',
      imageEvidence: [
        {
          imageId: 'img-pay-1',
          journalLines: [
            { accountName: 'Trade Payables', debit: 500, credit: 0 },
            { accountName: 'Cash at Bank', debit: 0, credit: 400 }
          ],
          fields: [{ field: 'paymentDate', value: '05/03/2025' }]
        }
      ],
      directGroups: [{
        id: 'grp-img-imbal',
        eventDate: '05/03/2025',
        title: 'Payment Receipt',
        summary: 'Imbalanced payment',
        totalDebit: 500,
        totalCredit: 400,
        isBalanced: false,
        lines: [
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 500, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 400 }
        ]
      }]
    });

    const res10G = await processAccountingQuery(
      'Here is the payment receipt screenshot.',
      turn1Scenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      chatWithImageFollowUp
    );

    assert.equal(res10G.scenarioState.isComplete, false, 'Turn 2 must fail validation');
    assert.equal(res10G.scenarioState.directGroups?.length, 1, 'Must restore Turn 1 direct group');
    assert.equal(res10G.scenarioState.committedDirectGroups?.length, 1, 'Must restore Turn 1 committed group');
    assert.equal(res10G.scenarioState.committedDirectGroups[0].id, 'grp-inv-turn1', 'Must be Turn 1 inventory group');
    assert.equal(res10G.scenarioState.committedDirectGroups[0].totalDebit, 1000);

    console.log('✓ 10G. Failed image validation on follow-up preserves Turn 1 committed groups verified');
    passed++;
  }

  // 10H: Cumulative settlement validation across groups in same turn & no 0-capping
  {
    const turn1Scenario = {
      scenarioType: 'UNIVERSAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      rawQuery: 'Received supplier invoice for S$1,000 on credit.',
      transactionTitle: 'Supplier Invoice',
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      isComplete: true,
      committedDirectGroups: [{
        id: 'grp-inv-10h',
        transactionId: 'grp-inv-10h',
        eventDate: '01/03/2025',
        title: 'Supplier Invoice',
        summary: 'Invoice for S$1,000',
        lines: [
          { accountName: 'Office Supplies', category: 'EXPENSE', debit: 1000, credit: 0 },
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
        ],
        totalDebit: 1000,
        totalCredit: 1000,
        isBalanced: true
      }],
      directGroups: [{
        id: 'grp-inv-10h',
        transactionId: 'grp-inv-10h',
        eventDate: '01/03/2025',
        title: 'Supplier Invoice',
        summary: 'Invoice for S$1,000',
        lines: [
          { accountName: 'Office Supplies', category: 'EXPENSE', debit: 1000, credit: 0 },
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
        ],
        totalDebit: 1000,
        totalCredit: 1000,
        isBalanced: true
      }]
    };

    // AI proposes two payment groups in the same turn: Payment 1 = 600, Payment 2 = 600 (Total 1,200 > 1,000)
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Two Payments',
      directGroups: [
        {
          id: 'grp-pay-1',
          targetTransactionId: 'grp-inv-10h',
          eventDate: '05/03/2025',
          title: 'Payment 1',
          summary: 'Paid supplier S$600',
          lines: [
            { accountName: 'Trade Payables', category: 'LIABILITY', debit: 600, credit: 0 },
            { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
          ],
          totalDebit: 600,
          totalCredit: 600,
          isBalanced: true
        },
        {
          id: 'grp-pay-2',
          targetTransactionId: 'grp-inv-10h',
          eventDate: '06/03/2025',
          title: 'Payment 2',
          summary: 'Paid supplier S$600 again',
          lines: [
            { accountName: 'Trade Payables', category: 'LIABILITY', debit: 600, credit: 0 },
            { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
          ],
          totalDebit: 600,
          totalCredit: 600,
          isBalanced: true
        }
      ]
    });

    const res10H = await processAccountingQuery(
      'Paid supplier S$600 on 5 March and S$600 on 6 March by bank transfer.',
      turn1Scenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res10H.scenarioState.isComplete, false, 'Turn must be rejected due to cumulative over-settlement');
    assert.ok(res10H.scenarioState.missingFields?.some(f => f.fieldKey === 'journalValidation' && (f.prompt.includes('exceeds the outstanding balance') || f.prompt.includes('SETTLEMENT_EXCEEDS_BALANCE'))), 'Must flag SETTLEMENT_EXCEEDS_BALANCE');
    assert.equal(res10H.scenarioState.directGroups?.length, 1, 'Must preserve Turn 1 direct group');
    assert.equal(res10H.scenarioState.committedDirectGroups?.length, 1, 'Must preserve Turn 1 committed group');
    assert.equal(res10H.scenarioState.committedDirectGroups[0].id, 'grp-inv-10h');

    // Also verify deriveAccountingStateFromEvents does not cap over-settlements at 0
    const overSettleEvents = [
      {
        id: 'evt-inv',
        transactionId: 'tx-inv-1',
        type: 'initial_transaction',
        description: 'Supplier Invoice',
        amount: 1000,
        currency: 'SGD',
        affectedAccounts: ['Office Supplies', 'Trade Payables'],
        eventDate: '01/03/2025',
        journalLines: [
          { accountName: 'Office Supplies', category: 'EXPENSE', debit: 1000, credit: 0 },
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
        ]
      },
      {
        id: 'evt-pay',
        transactionId: 'tx-pay-1',
        targetTransactionId: 'tx-inv-1',
        type: 'settlement',
        description: 'Over-settlement payment',
        amount: 1200,
        currency: 'SGD',
        affectedAccounts: ['Trade Payables', 'Cash at Bank'],
        eventDate: '05/03/2025',
        journalLines: [
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 1200, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 1200 }
        ]
      }
    ];

    const stateFromEvents = deriveAccountingStateFromEvents(overSettleEvents, 'SGD');
    assert.equal(stateFromEvents.outstandingBalances.length, 1);
    const payBal = stateFromEvents.outstandingBalances[0];
    assert.equal(payBal.settledAmount, 1200, 'Settled amount must reflect actual 1200');
    assert.equal(payBal.remainingAmount, -200, 'Remaining amount must be negative -200, not capped at 0');

    console.log('✓ 10H. Cumulative settlement validation and uncapped over-settlement verified');
    passed++;
  }

  // 10I: Multi-turn event-history synchronisation & revision identity
  {
    // Part 1: Turn 1 with actualEvents (S$1,000 Trade Payables); Turn 2 commits S$600 payment
    const turn1Scenario = {
      scenarioType: 'UNIVERSAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      rawQuery: 'Received supplier invoice for S$1,000 on credit.',
      transactionTitle: 'Supplier Invoice',
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      isComplete: true,
      committedDirectGroups: [{
        id: 'grp-inv-10i',
        transactionId: 'grp-inv-10i',
        eventDate: '01/03/2025',
        title: 'Supplier Invoice',
        summary: 'Invoice for S$1,000',
        lines: [
          { accountName: 'Office Supplies', category: 'EXPENSE', debit: 1000, credit: 0 },
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
        ],
        totalDebit: 1000,
        totalCredit: 1000,
        isBalanced: true
      }],
      directGroups: [{
        id: 'grp-inv-10i',
        transactionId: 'grp-inv-10i',
        eventDate: '01/03/2025',
        title: 'Supplier Invoice',
        summary: 'Invoice for S$1,000',
        lines: [
          { accountName: 'Office Supplies', category: 'EXPENSE', debit: 1000, credit: 0 },
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
        ],
        totalDebit: 1000,
        totalCredit: 1000,
        isBalanced: true
      }],
      actualEvents: [{
        id: 'evt-inv-10i',
        transactionId: 'grp-inv-10i',
        type: 'initial_transaction',
        description: 'Supplier Invoice',
        amount: 1000,
        currency: 'SGD',
        affectedAccounts: ['Office Supplies', 'Trade Payables'],
        eventDate: '01/03/2025',
        journalLines: [
          { accountName: 'Office Supplies', category: 'EXPENSE', debit: 1000, credit: 0 },
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
        ]
      }]
    };

    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Supplier Payment',
      directGroups: [{
        id: 'grp-pay-10i',
        targetTransactionId: 'grp-inv-10i',
        eventDate: '05/03/2025',
        title: 'Supplier Settlement',
        summary: 'Paid supplier S$600',
        lines: [
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 600, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
        ],
        totalDebit: 600,
        totalCredit: 600,
        isBalanced: true
      }]
    });

    const res10I1 = await processAccountingQuery(
      'Paid supplier S$600 by bank transfer.',
      turn1Scenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res10I1.scenarioState.committedDirectGroups?.length, 2, 'Committed groups must have 2 entries');
    const acctCtx10I1 = extractAccountingContext(res10I1.scenarioState);
    assert.equal(acctCtx10I1.outstandingBalances.length, 1);
    assert.equal(acctCtx10I1.outstandingBalances[0].remainingAmount, 400, 'Context balance must be S$400, not stale 1000');
    assert.equal(res10I1.scenarioState.remainingBalances?.length, 1);
    assert.equal(res10I1.scenarioState.remainingBalances[0].amount, 400);
    assert.equal(res10I1.scenarioState.actualEvents?.length, 2, 'actualEvents must have 2 synchronized events');

    // Part 2: Revision and subsequent settlement
    // Turn 1: Invoice grp-inv-1 (S$1,000) and partial payment grp-pay-1 (S$600)
    const turn1RevisionScenario = {
      scenarioType: 'UNIVERSAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      rawQuery: 'Invoice S$1,000, paid S$600.',
      transactionTitle: 'Invoice and Partial Payment',
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      isComplete: true,
      committedDirectGroups: [
        {
          id: 'grp-inv-1',
          transactionId: 'grp-inv-1',
          eventDate: '01/03/2025',
          title: 'Inventory Purchase',
          summary: 'Purchased inventory',
          lines: [
            { accountName: 'Inventory', category: 'ASSET', debit: 1000, credit: 0 },
            { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
          ],
          totalDebit: 1000,
          totalCredit: 1000,
          isBalanced: true
        },
        {
          id: 'grp-pay-1',
          transactionId: 'grp-pay-1',
          targetTransactionId: 'grp-inv-1',
          eventDate: '05/03/2025',
          title: 'Supplier Settlement',
          summary: 'Partial payment',
          lines: [
            { accountName: 'Trade Payables', category: 'LIABILITY', debit: 600, credit: 0 },
            { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
          ],
          totalDebit: 600,
          totalCredit: 600,
          isBalanced: true
        }
      ],
      directGroups: [
        {
          id: 'grp-inv-1',
          transactionId: 'grp-inv-1',
          eventDate: '01/03/2025',
          title: 'Inventory Purchase',
          summary: 'Purchased inventory',
          lines: [
            { accountName: 'Inventory', category: 'ASSET', debit: 1000, credit: 0 },
            { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
          ],
          totalDebit: 1000,
          totalCredit: 1000,
          isBalanced: true
        },
        {
          id: 'grp-pay-1',
          transactionId: 'grp-pay-1',
          targetTransactionId: 'grp-inv-1',
          eventDate: '05/03/2025',
          title: 'Supplier Settlement',
          summary: 'Partial payment',
          lines: [
            { accountName: 'Trade Payables', category: 'LIABILITY', debit: 600, credit: 0 },
            { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
          ],
          totalDebit: 600,
          totalCredit: 600,
          isBalanced: true
        }
      ]
    };

    // Turn 2: Revise grp-inv-1 to S$1,200 with new id 'grp-inv-rev'
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Inventory Purchase Revision',
      directGroups: [{
        id: 'grp-inv-rev',
        targetTransactionId: 'grp-inv-1',
        eventDate: '01/03/2025',
        title: 'Revised Inventory Purchase',
        summary: 'Revised inventory purchase cost',
        journalAction: 'revised',
        totalDebit: 1200,
        totalCredit: 1200,
        isBalanced: true,
        lines: [
          { accountName: 'Inventory', category: 'ASSET', debit: 1200, credit: 0 },
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1200 }
        ]
      }]
    });

    const res10I2 = await processAccountingQuery(
      'Correction: the inventory purchase was actually S$1,200.',
      turn1RevisionScenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res10I2.scenarioState.committedDirectGroups?.length, 2);
    const revisedGrp = res10I2.scenarioState.committedDirectGroups[0];
    assert.equal(revisedGrp.id, 'grp-inv-1', 'Stable id must be preserved');
    assert.equal(revisedGrp.transactionId, 'grp-inv-1', 'Stable transactionId must be preserved');
    assert.equal(revisedGrp.revisedFromId, 'grp-inv-rev', 'revisedFromId must be grp-inv-rev');
    assert.equal(revisedGrp.totalDebit, 1200);

    const acctCtx10I2 = extractAccountingContext(res10I2.scenarioState);
    assert.equal(acctCtx10I2.outstandingBalances.length, 1);
    assert.equal(acctCtx10I2.outstandingBalances[0].remainingAmount, 600, 'Remaining balance must be S$1,200 - S$600 = S$600');
    assert.equal(res10I2.scenarioState.remainingBalances?.[0]?.amount, 600);

    // Turn 3: Settle the remaining S$600 referencing grp-inv-1
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Final Settlement',
      directGroups: [{
        id: 'grp-pay-final',
        targetTransactionId: 'grp-inv-1',
        eventDate: '10/03/2025',
        title: 'Supplier Settlement',
        summary: 'Final payment',
        lines: [
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 600, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
        ],
        totalDebit: 600,
        totalCredit: 600,
        isBalanced: true
      }]
    });

    const res10I3 = await processAccountingQuery(
      'Paid the remaining S$600 for the inventory purchase by bank transfer.',
      res10I2.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res10I3.scenarioState.isComplete, true, 'Final settlement must be marked complete');
    assert.equal(res10I3.scenarioState.remainingBalances, undefined, 'remainingBalances must be cleared to undefined');
    const acctCtx10I3 = extractAccountingContext(res10I3.scenarioState);
    assert.equal(acctCtx10I3.outstandingBalances[0].remainingAmount, 0, 'Remaining balance in context must be 0');

    console.log('✓ 10I. Multi-turn event-history synchronisation & revision identity verified');
    passed++;
  }

  // --- 10J. Atomic journal commits, multi-turn rejection rollback & image consistency ---
  {
    console.log('\n--- 10J. Atomic journal commits, multi-turn rejection rollback & image consistency ---');

    // 1. Initial-turn journal rejection followed by another conversation turn
    // Turn 1: AI proposes an invalid/imbalanced journal (Office Supplies Dr 1,000 / Trade Payables Cr 800)
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Office Supplies on Credit',
      directGroups: [{
        id: 'grp-bad-init',
        title: 'Office Supplies Purchase',
        eventDate: '01/03/2025',
        totalDebit: 1000,
        totalCredit: 800,
        isBalanced: false,
        lines: [
          { accountName: 'Office Supplies', category: 'EXPENSE', debit: 1000, credit: 0 },
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 800 }
        ]
      }]
    });

    const res10J1_t1 = await processAccountingQuery(
      'Received supplier invoice for S$1,000 office supplies on credit on 01/03/2025.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res10J1_t1.scenarioState.directGroups?.length, 0, 'Turn 1 rejected directGroups must be empty');
    assert.equal(res10J1_t1.scenarioState.committedDirectGroups?.length, 0, 'Turn 1 rejected committedDirectGroups must be empty');
    assert.equal(res10J1_t1.scenarioState.actualEvents?.length, 0, 'Turn 1 actualEvents must be empty');
    assert.equal(res10J1_t1.scenarioState.accountingEvents?.length, 0, 'Turn 1 accountingEvents must be empty');
    assert.equal(res10J1_t1.scenarioState.remainingBalances, undefined, 'Turn 1 remainingBalances must be undefined');
    const ctx10J1_t1 = extractAccountingContext(res10J1_t1.scenarioState);
    assert.equal(ctx10J1_t1.actualEvents.length, 0, 'Turn 1 context actualEvents must be empty');
    assert.equal(ctx10J1_t1.outstandingBalances.length, 0, 'Turn 1 context outstandingBalances must be empty');

    // Turn 2: Valid transaction facts, balanced proposal
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Office Supplies on Credit',
      directGroups: [{
        id: 'grp-supplies-t2',
        title: 'Office Supplies Purchase',
        eventDate: '01/03/2025',
        totalDebit: 1000,
        totalCredit: 1000,
        isBalanced: true,
        lines: [
          { accountName: 'Office Supplies', category: 'EXPENSE', debit: 1000, credit: 0 },
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
        ]
      }]
    });

    const res10J1_t2 = await processAccountingQuery(
      'Received supplier invoice for S$1,000 on 01/03/2025 on credit.',
      res10J1_t1.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res10J1_t2.scenarioState.committedDirectGroups?.length, 1, 'Turn 2 must have 1 committed group');
    assert.equal(res10J1_t2.scenarioState.actualEvents?.length, 1, 'Turn 2 must have 1 actual event');
    const ctx10J1_t2 = extractAccountingContext(res10J1_t2.scenarioState);
    assert.equal(ctx10J1_t2.outstandingBalances.length, 1, 'Must have only single balance from Turn 2');
    assert.equal(ctx10J1_t2.outstandingBalances[0].remainingAmount, 1000, 'Balance must be S$1,000');

    // 2. Follow-up journal rejection followed by another conversation turn
    // Turn 1: Valid committed invoice
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Inventory Purchase',
      directGroups: [{
        id: 'grp-inv-1',
        title: 'Inventory Purchase',
        eventDate: '01/03/2025',
        totalDebit: 1000,
        totalCredit: 1000,
        isBalanced: true,
        lines: [
          { accountName: 'Inventory', category: 'ASSET', debit: 1000, credit: 0 },
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
        ]
      }]
    });

    const res10J2_t1 = await processAccountingQuery(
      'Purchased inventory for S$1,000 on credit on 01/03/2025.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res10J2_t1.scenarioState.committedDirectGroups?.length, 1);
    assert.equal(res10J2_t1.scenarioState.actualEvents?.length, 1);
    assert.equal(res10J2_t1.scenarioState.remainingBalances?.[0]?.amount, 1000);

    // Turn 2: Rejected follow-up journal (imbalanced settlement Dr 600 / Cr 500)
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Supplier Payment',
      directGroups: [{
        id: 'grp-pay-bad',
        targetTransactionId: 'grp-inv-1',
        title: 'Supplier Settlement',
        eventDate: '05/03/2025',
        totalDebit: 600,
        totalCredit: 500,
        isBalanced: false,
        lines: [
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 600, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
        ]
      }]
    });

    const res10J2_t2 = await processAccountingQuery(
      'Paid supplier S$600 by bank on 05/03/2025.',
      res10J2_t1.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res10J2_t2.scenarioState.isComplete, false, 'Turn 2 must be incomplete due to rejection');
    assert.equal(res10J2_t2.scenarioState.committedDirectGroups?.length, 1, 'Turn 2 committedDirectGroups must remain 1');
    assert.equal(res10J2_t2.scenarioState.committedDirectGroups[0].id, 'grp-inv-1');
    assert.equal(res10J2_t2.scenarioState.actualEvents?.length, 1, 'Turn 2 actualEvents must remain 1');
    assert.equal(res10J2_t2.scenarioState.accountingEvents?.length, 1, 'Turn 2 accountingEvents must remain 1');
    assert.equal(res10J2_t2.scenarioState.remainingBalances?.[0]?.amount, 1000, 'Remaining balance must remain 1000');
    const ctx10J2_t2 = extractAccountingContext(res10J2_t2.scenarioState);
    assert.equal(ctx10J2_t2.actualEvents.length, 1);
    assert.equal(ctx10J2_t2.outstandingBalances[0].remainingAmount, 1000);

    // Turn 3 (using res10J2_t2.scenarioState from rejected Turn 2!): Valid partial settlement S$600
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Supplier Payment',
      directGroups: [{
        id: 'grp-pay-good',
        targetTransactionId: 'grp-inv-1',
        title: 'Supplier Settlement',
        eventDate: '06/03/2025',
        totalDebit: 600,
        totalCredit: 600,
        isBalanced: true,
        lines: [
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 600, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
        ]
      }]
    });

    const res10J2_t3 = await processAccountingQuery(
      'Please record S$600 paid by bank transfer to settle supplier invoice on 06/03/2025.',
      res10J2_t2.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res10J2_t3.scenarioState.isComplete, true, 'Turn 3 must succeed and be complete');
    assert.equal(res10J2_t3.scenarioState.committedDirectGroups?.length, 2, 'Must have 2 committed groups');
    assert.equal(res10J2_t3.scenarioState.actualEvents?.length, 2, 'Must have 2 actual events');
    assert.equal(res10J2_t3.scenarioState.remainingBalances?.[0]?.amount, 400, 'Remaining balance must be S$400');

    // 3. Image-derived journal follow-up handling
    // Subcase A: Valid follow-up with screenshot
    const turn1ImageBaseScenario = {
      scenarioType: 'UNIVERSAL',
      rawQuery: 'Purchased inventory for S$1,000 on credit on 01/03/2025.',
      transactionTitle: 'Inventory Purchase',
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      isComplete: true,
      committedDirectGroups: [{
        id: 'grp-inv-1',
        transactionId: 'grp-inv-1',
        title: 'Inventory Purchase',
        eventDate: '01/03/2025',
        totalDebit: 1000,
        totalCredit: 1000,
        isBalanced: true,
        lines: [
          { accountName: 'Inventory', category: 'ASSET', debit: 1000, credit: 0 },
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
        ]
      }],
      directGroups: [{
        id: 'grp-inv-1',
        transactionId: 'grp-inv-1',
        title: 'Inventory Purchase',
        eventDate: '01/03/2025',
        totalDebit: 1000,
        totalCredit: 1000,
        isBalanced: true,
        lines: [
          { accountName: 'Inventory', category: 'ASSET', debit: 1000, credit: 0 },
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
        ]
      }],
      remainingBalances: [{ accountName: 'Trade Payables', amount: 1000, currency: 'SGD' }]
    };

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Supplier Payment',
                directGroups: [{
                  id: 'grp-img-pay',
                  targetTransactionId: 'grp-inv-1',
                  title: 'Supplier Payment',
                  eventDate: '05/03/2025',
                  totalDebit: 600,
                  totalCredit: 600,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 600, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-pay-1',
                  fields: { paymentDate: '05/03/2025', totalAmount: 600 },
                  journalLines: [
                    { accountName: 'Trade Payables', debit: 600, credit: 0 },
                    { accountName: 'Cash at Bank', debit: 0, credit: 600 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const res10J3_subA = await processAccountingQuery(
      'Here is the payment confirmation voucher.',
      turn1ImageBaseScenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Here is the payment confirmation voucher.', images: [{ id: 'img-pay-1', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(res10J3_subA.scenarioState.committedDirectGroups?.length, 2, 'Subcase A: Must merge with Turn 1 (length 2)');
    assert.equal(res10J3_subA.scenarioState.actualEvents?.length, 2, 'Subcase A: actualEvents must be length 2');
    assert.equal(res10J3_subA.scenarioState.remainingBalances?.[0]?.amount, 400, 'Subcase A: remaining balance must be S$400');
    assert.equal(res10J3_subA.scenarioState.directGroups[1].eventDate, '05/03/2025', 'Subcase A: directGroups[1].eventDate must be 05/03/2025');
    assert.equal(res10J3_subA.scenarioState.actualEvents[1].eventDate, '05/03/2025', 'Subcase A: actualEvents[1].eventDate must be 05/03/2025');

    // Subcase B: Rejected follow-up screenshot -> rejected, actualEvents remains length 1, followed by clean Turn 3 settlement
    // Conflicting screenshot (Screenshot says S$500 Dr, AI says S$600 Dr)
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Supplier Payment',
                directGroups: [{
                  id: 'grp-img-pay-conflict',
                  targetTransactionId: 'grp-inv-1',
                  title: 'Supplier Payment',
                  eventDate: '05/03/2025',
                  totalDebit: 600,
                  totalCredit: 600,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 600, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-pay-conflict',
                  fields: { paymentDate: '05/03/2025', totalAmount: 500 },
                  journalLines: [
                    { accountName: 'Trade Payables', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const res10J3_subB_t2 = await processAccountingQuery(
      'Payment voucher attached.',
      turn1ImageBaseScenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Payment voucher attached.', images: [{ id: 'img-pay-conflict', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(res10J3_subB_t2.scenarioState.committedDirectGroups?.length, 1, 'Subcase B: committedDirectGroups must remain length 1');
    assert.equal(res10J3_subB_t2.scenarioState.actualEvents?.length, 1, 'Subcase B: actualEvents must remain length 1');
    assert.equal(res10J3_subB_t2.scenarioState.remainingBalances?.[0]?.amount, 1000, 'Subcase B: balance S$1,000 preserved');

    // Turn 3: Settle cleanly without screenshot
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Supplier Settlement',
      directGroups: [{
        id: 'grp-clean-settle',
        targetTransactionId: 'grp-inv-1',
        title: 'Supplier Settlement',
        eventDate: '06/03/2025',
        totalDebit: 600,
        totalCredit: 600,
        isBalanced: true,
        lines: [
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 600, credit: 0 },
          { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
        ]
      }]
    });

    const res10J3_subB_t3 = await processAccountingQuery(
      'Please record S$600 paid by bank transfer to settle supplier invoice on 06/03/2025.',
      res10J3_subB_t2.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345'
    );

    assert.equal(res10J3_subB_t3.scenarioState.committedDirectGroups?.length, 2, 'Subcase B Turn 3: Must have 2 committed groups');
    assert.equal(res10J3_subB_t3.scenarioState.actualEvents?.length, 2, 'Subcase B Turn 3: Must have 2 actual events');
    assert.equal(res10J3_subB_t3.scenarioState.remainingBalances?.[0]?.amount, 400, 'Subcase B Turn 3: Remaining balance must be S$400');

    // 4. Image-derived entry account identity and transaction date consistency
    // Subcase A: Account identity conflict (Screenshot has Trade Payables Cr 500, AI group has GST Payable Cr 500)
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice',
                directGroups: [{
                  id: 'grp-ai-gst',
                  eventDate: '15/03/2025',
                  title: 'Invoice',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'GST Payable', category: 'LIABILITY', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-acct-conflict',
                  fields: { invoiceDate: '15/03/2025' },
                  journalLines: [
                    { accountName: 'Office Supplies', debit: 500, credit: 0 },
                    { accountName: 'Trade Payables', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const res10J4_subA = await processAccountingQuery(
      'Invoice screenshot attached.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Invoice screenshot attached.', images: [{ id: 'img-acct-conflict', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.ok(
      res10J4_subA.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_JOURNAL_CONFLICT'),
      'Must reject Trade Payables vs GST Payable conflict with IMAGE_JOURNAL_CONFLICT'
    );
    assert.equal(res10J4_subA.scenarioState.directGroups?.length, 0, 'Direct groups must be empty on conflict');

    // Subcase B: Transaction date conflict (Screenshot has 15/03/2025, AI has 01/03/2025)
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice',
                directGroups: [{
                  id: 'grp-ai-date',
                  eventDate: '01/03/2025',
                  title: 'Invoice',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-date-conflict',
                  fields: { invoiceDate: '15/03/2025' },
                  journalLines: [
                    { accountName: 'Office Supplies', debit: 500, credit: 0 },
                    { accountName: 'Trade Payables', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const res10J4_subB = await processAccountingQuery(
      'Invoice screenshot attached.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Invoice screenshot attached.', images: [{ id: 'img-date-conflict', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.ok(
      res10J4_subB.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_JOURNAL_CONFLICT'),
      'Must reject date conflict with IMAGE_JOURNAL_CONFLICT'
    );
    assert.equal(res10J4_subB.scenarioState.directGroups?.length, 0, 'Direct groups must be empty on date conflict');

    // Subcase C: Consistent transaction date preserved (Screenshot has 15/03/2025, AI has 15/03/2025)
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Office Supplies Invoice',
                directGroups: [{
                  id: 'grp-ai-date-match',
                  eventDate: '15/03/2025',
                  title: 'Office Supplies Invoice',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-date-match',
                  fields: { invoiceDate: '15/03/2025' },
                  journalLines: [
                    { accountName: 'Office Supplies', debit: 500, credit: 0 },
                    { accountName: 'Trade Payables', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const res10J4_subC = await processAccountingQuery(
      'Invoice screenshot attached.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Invoice screenshot attached.', images: [{ id: 'img-date-match', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(res10J4_subC.scenarioState.directGroups?.length, 1, 'Subcase C: Must have 1 directGroup');
    assert.equal(res10J4_subC.scenarioState.directGroups[0].eventDate, '15/03/2025', 'Subcase C: eventDate must be 15/03/2025');
    assert.equal(res10J4_subC.scenarioState.actualEvents[0].eventDate, '15/03/2025', 'Subcase C: actualEvents[0].eventDate must be 15/03/2025');

    // Subcase D: Missing transaction date in image-derived entry (when image fields and user query have no transaction date, even if AI proposes a fabricated eventDate or omits eventDate)
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Office Supplies Invoice',
                directGroups: [{
                  id: 'grp-ai-date-missing',
                  eventDate: '20/03/2025',
                  title: 'Office Supplies Invoice',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-date-missing',
                  fields: { totalAmount: 500 },
                  journalLines: [
                    { accountName: 'Office Supplies', debit: 500, credit: 0 },
                    { accountName: 'Trade Payables', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const res10J4_subD = await processAccountingQuery(
      'Invoice screenshot attached.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Invoice screenshot attached.', images: [{ id: 'img-date-missing', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.ok(
      res10J4_subD.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_MISSING_TRANSACTION_DATE'),
      'Subcase D: Must reject missing transaction date with IMAGE_MISSING_TRANSACTION_DATE'
    );
    assert.equal(res10J4_subD.scenarioState.directGroups?.length, 0, 'Subcase D: directGroups must be rolled back to empty');
    assert.equal(res10J4_subD.scenarioState.committedDirectGroups?.length, 0, 'Subcase D: committedDirectGroups must be rolled back to empty');
    assert.equal(res10J4_subD.scenarioState.actualEvents?.length, 0, 'Subcase D: actualEvents must be rolled back to empty');

    console.log('✓ 10J. Atomic journal commits, multi-turn rejection rollback & image consistency verified');
    passed++;
  }

  // --------------------------------------------------------------------------
  // 10K. Advanced Image-Derived Entry Governance
  // --------------------------------------------------------------------------
  console.log('\n--- 10K. Advanced Image-Derived Entry Governance ---');

  // Subcase 1A: Image revision with stable ID replacement and subsequent settlement
  {
    // Turn 1: S$1,000 inventory on credit
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Inventory Purchase',
                directGroups: [{
                  id: 'grp-inv-1',
                  eventDate: '10/01/2025',
                  title: 'Inventory on Credit',
                  totalDebit: 1000,
                  totalCredit: 1000,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Inventory', category: 'ASSET', debit: 1000, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-inv-1',
                  fields: { invoiceDate: '10/01/2025', invoiceNumber: 'INV-100' },
                  journalLines: [
                    { accountName: 'Inventory', debit: 1000, credit: 0 },
                    { accountName: 'Trade Payables', debit: 0, credit: 1000 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    // Turn 1: Initial invoice S$1,000
    const res10K1_t1 = await processAccountingQuery(
      'Invoice attached for inventory purchase.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Invoice attached.', images: [{ id: 'img-inv-1', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(res10K1_t1.scenarioState.committedDirectGroups?.length, 1);
    assert.equal(res10K1_t1.scenarioState.committedDirectGroups[0].id, 'grp-inv-1');
    assert.equal(res10K1_t1.scenarioState.remainingBalances?.[0]?.amount, 1000);

    // Turn 2: Prior partial settlement of S$600
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Partial Payment for Invoice',
                directGroups: [{
                  id: 'grp-pay-1',
                  eventDate: '12/01/2025',
                  title: 'Partial Payment of Trade Payables',
                  totalDebit: 600,
                  totalCredit: 600,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 600, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-pay-1',
                  fields: { paymentDate: '12/01/2025', receiptNumber: 'RCP-500' },
                  journalLines: [
                    { accountName: 'Trade Payables', debit: 600, credit: 0 },
                    { accountName: 'Cash at Bank', debit: 0, credit: 600 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const res10K1_t2 = await processAccountingQuery(
      'Paid partial amount of S$600 for invoice by bank transfer.',
      res10K1_t1.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Partial payment receipt', images: [{ id: 'img-pay-1', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(res10K1_t2.scenarioState.committedDirectGroups?.length, 2, 'Must have 2 committed groups (invoice + partial payment)');
    assert.equal(res10K1_t2.scenarioState.remainingBalances?.[0]?.amount, 400, 'Remaining balance must be S$400 after partial payment');

    // Turn 3: Amended invoice to S$1,200 ("Actually the invoice was for S$1,200")
    // When revising an invoice that already has a prior partial settlement, imageRevisionGroups
    // must be validated with outstandingBalances: [] so the revised invoice replaces grp-inv-1 in place
    // and correctly recalculates the remaining balance to S$600.
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Inventory Purchase (Amended)',
                journalAction: 'revised',
                directGroups: [{
                  id: 'grp-inv-revised',
                  targetTransactionId: 'grp-inv-1',
                  eventDate: '10/01/2025',
                  title: 'Revised Inventory Purchase',
                  totalDebit: 1200,
                  totalCredit: 1200,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Inventory', category: 'ASSET', debit: 1200, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1200 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-inv-revised',
                  fields: { invoiceDate: '10/01/2025', invoiceNumber: 'INV-100-REV' },
                  journalLines: [
                    { accountName: 'Inventory', debit: 1200, credit: 0 },
                    { accountName: 'Trade Payables', debit: 0, credit: 1200 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const res10K1_t3 = await processAccountingQuery(
      'Actually the invoice was for S$1,200, here is the amended invoice.',
      res10K1_t2.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Amended invoice', images: [{ id: 'img-inv-revised', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(res10K1_t3.scenarioState.committedDirectGroups?.length, 2, 'Revised group replaces original invoice in place; prior settlement preserved (length 2)');
    assert.equal(res10K1_t3.scenarioState.committedDirectGroups[0].id, 'grp-inv-1', 'Must preserve stable id grp-inv-1');
    assert.equal(res10K1_t3.scenarioState.committedDirectGroups[0].totalDebit, 1200);
    assert.equal(res10K1_t3.scenarioState.committedDirectGroups[1].id, 'grp-pay-1');
    assert.equal(res10K1_t3.scenarioState.remainingBalances?.[0]?.amount, 600, 'Remaining balance must be revised to S$600 (S$1,200 - S$600)');

    // Turn 4: Final settlement of remaining S$600 balance
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Final Payment for Invoice',
                directGroups: [{
                  id: 'grp-pay-2',
                  eventDate: '15/01/2025',
                  title: 'Final Payment of Trade Payables',
                  totalDebit: 600,
                  totalCredit: 600,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 600, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-pay-2',
                  fields: { paymentDate: '15/01/2025', receiptNumber: 'RCP-600' },
                  journalLines: [
                    { accountName: 'Trade Payables', debit: 600, credit: 0 },
                    { accountName: 'Cash at Bank', debit: 0, credit: 600 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const res10K1_t4 = await processAccountingQuery(
      'Paid remaining balance of S$600 for invoice by bank transfer.',
      res10K1_t3.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Final payment receipt', images: [{ id: 'img-pay-2', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(res10K1_t4.scenarioState.committedDirectGroups?.length, 3, 'Must have 3 committed groups (revised invoice + 2 payments)');
    assert.equal(res10K1_t4.scenarioState.remainingBalances, undefined, 'Final S$600 settlement brings balance to zero');
    console.log('✓ 10K-1A. Image revision with prior partial settlement and subsequent balance clearance verified');
    passed++;
  }

  // Subcase 1B: Ambiguous image revision target with multiple prior transactions
  {
    const multiTxScenario = {
      scenarioType: 'UNIVERSAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      isComplete: true,
      committedDirectGroups: [
        {
          id: 'grp-inv-1',
          transactionId: 'grp-inv-1',
          eventDate: '01/01/2025',
          title: 'Office Supplies Purchase',
          totalDebit: 400,
          totalCredit: 400,
          isBalanced: true,
          lines: [
            { id: 'l1', accountName: 'Office Supplies', category: 'EXPENSE', debit: 400, credit: 0 },
            { id: 'l2', accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 400 }
          ]
        },
        {
          id: 'grp-inv-2',
          transactionId: 'grp-inv-2',
          eventDate: '05/01/2025',
          title: 'Cleaning Services',
          totalDebit: 500,
          totalCredit: 500,
          isBalanced: true,
          lines: [
            { id: 'l3', accountName: 'Cleaning Expenses', category: 'EXPENSE', debit: 500, credit: 0 },
            { id: 'l4', accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
          ]
        }
      ],
      directGroups: [],
      actualEvents: []
    };

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Amended Invoice',
                journalAction: 'revised',
                directGroups: [{
                  id: 'grp-rev-ambiguous',
                  eventDate: '01/01/2025',
                  title: 'Amended Trade Payables',
                  totalDebit: 600,
                  totalCredit: 600,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Miscellaneous Expenses', category: 'EXPENSE', debit: 600, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 600 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-rev-ambiguous',
                  fields: { invoiceDate: '01/01/2025' },
                  journalLines: [
                    { accountName: 'Miscellaneous Expenses', debit: 600, credit: 0 },
                    { accountName: 'Trade Payables', debit: 0, credit: 600 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const res10K1_subB = await processAccountingQuery(
      'Actually the invoice was for S$600, here is the amended invoice.',
      multiTxScenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Amended invoice', images: [{ id: 'img-rev-ambiguous', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.ok(
      res10K1_subB.scenarioState.missingFields?.some(f => f.fieldKey === 'revisionTarget'),
      'Must prompt for revisionTarget clarification when target cannot be uniquely identified'
    );
    assert.equal(res10K1_subB.scenarioState.committedDirectGroups?.length, 2, 'Committed groups must remain length 2 without duplicate or corruption');
    console.log('✓ 10K-1B. Ambiguous image revision target correctly triggers revisionTarget clarification rollback');
    passed++;
  }

  // Subcase 2: Idempotent image document processing
  {
    // Turn 1: S$1,000 inventory on credit
    const stateTurn1 = {
      scenarioType: 'UNIVERSAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      isComplete: true,
      committedDirectGroups: [{
        id: 'grp-inv-1',
        transactionId: 'grp-inv-1',
        eventDate: '10/01/2025',
        title: 'Inventory Purchase',
        totalDebit: 1000,
        totalCredit: 1000,
        isBalanced: true,
        lines: [
          { id: 'l1', accountName: 'Inventory', category: 'ASSET', debit: 1000, credit: 0 },
          { id: 'l2', accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
        ]
      }],
      directGroups: [],
      actualEvents: []
    };

    // Turn 2: First payment of S$600
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Payment for Invoice',
                directGroups: [{
                  id: 'grp-pay-600',
                  eventDate: '15/01/2025',
                  title: 'Partial Settlement',
                  totalDebit: 600,
                  totalCredit: 600,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 600, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-rcp-600',
                  fields: { paymentDate: '15/01/2025', receiptNumber: 'RCP-600' },
                  journalLines: [
                    { accountName: 'Trade Payables', debit: 600, credit: 0 },
                    { accountName: 'Cash at Bank', debit: 0, credit: 600 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const res10K2_t2 = await processAccountingQuery(
      'Payment receipt attached for S$600.',
      stateTurn1,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Payment receipt', images: [{ id: 'img-rcp-600', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(res10K2_t2.scenarioState.committedDirectGroups?.length, 2);
    assert.equal(res10K2_t2.scenarioState.remainingBalances?.[0]?.amount, 400, 'Remaining balance must be S$400');

    // Turn 3: User re-uploads the exact same S$600 receipt ("Here is the payment receipt again")
    const res10K2_t3 = await processAccountingQuery(
      'Here is the payment receipt again.',
      res10K2_t2.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Here is the payment receipt again.', images: [{ id: 'img-rcp-600', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(
      res10K2_t3.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-SETTLEMENT_EXCEEDS_BALANCE'),
      false,
      'Idempotent repeat upload of same receipt must NOT trigger SETTLEMENT_EXCEEDS_BALANCE'
    );
    assert.equal(res10K2_t3.scenarioState.committedDirectGroups?.length, 2, 'Committed groups must NOT duplicate (remain length 2)');
    assert.equal(res10K2_t3.scenarioState.remainingBalances?.[0]?.amount, 400, 'Remaining balance must remain S$400');

    // Turn 4: User sends legitimate second payment of S$300
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Second Payment',
                directGroups: [{
                  id: 'grp-pay-300',
                  eventDate: '20/01/2025',
                  title: 'Second Payment',
                  totalDebit: 300,
                  totalCredit: 300,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 300, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 300 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-rcp-300',
                  fields: { paymentDate: '20/01/2025', receiptNumber: 'RCP-300' },
                  journalLines: [
                    { accountName: 'Trade Payables', debit: 300, credit: 0 },
                    { accountName: 'Cash at Bank', debit: 0, credit: 300 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const res10K2_t4 = await processAccountingQuery(
      'Second payment of S$300 installment paid by bank transfer.',
      res10K2_t3.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Second payment', images: [{ id: 'img-rcp-300', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(res10K2_t4.scenarioState.committedDirectGroups?.length, 3, 'Must commit legitimate second payment (length 3)');
    assert.equal(res10K2_t4.scenarioState.remainingBalances?.[0]?.amount, 100, 'Remaining balance must be S$100 after second payment');
    console.log('✓ 10K-2. Idempotent receipt deduplication and legitimate recurring payment verified');
    passed++;
  }

  // Subcase 2B: Distinct receipts with identical date and amount but different voucher numbers (PV-001 vs PV-002)
  // With neutral text "Payment receipt attached.", PV-002 must NOT be dropped as duplicate.
  {
    const stateTurn1 = {
      scenarioType: 'UNIVERSAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      committedDirectGroups: [{
        id: 'grp-inv-distinct',
        transactionId: 'grp-inv-distinct',
        eventDate: '10/01/2025',
        title: 'Inventory Purchase',
        totalDebit: 2000,
        totalCredit: 2000,
        isBalanced: true,
        lines: [
          { id: 'l1', accountName: 'Inventory', category: 'ASSET', debit: 2000, credit: 0 },
          { id: 'l2', accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 2000 }
        ]
      }],
      directGroups: [],
      actualEvents: []
    };

    // Turn 2: First payment voucher PV-001 for S$500 on 15/01/2025
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Payment for Invoice',
                directGroups: [{
                  id: 'grp-pay-pv1',
                  eventDate: '15/01/2025',
                  title: 'Payment PV-001',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-pv-001',
                  fields: { paymentDate: '15/01/2025', paymentVoucherNo: 'PV-001' },
                  journalLines: [
                    { accountName: 'Trade Payables', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const res10K2B_t2 = await processAccountingQuery(
      'Payment receipt attached.',
      stateTurn1,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Payment receipt attached.', images: [{ id: 'img-pv-001', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(res10K2B_t2.scenarioState.committedDirectGroups?.length, 2);
    assert.equal(res10K2B_t2.scenarioState.remainingBalances?.[0]?.amount, 1500, 'Remaining balance must be S$1,500 after PV-001');

    // Turn 3: Second distinct payment voucher PV-002 for same S$500 on same date 15/01/2025 with neutral text "Payment receipt attached."
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Payment for Invoice',
                directGroups: [{
                  id: 'grp-pay-pv2',
                  eventDate: '15/01/2025',
                  title: 'Payment PV-002',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-pv-002',
                  fields: { paymentDate: '15/01/2025', paymentVoucherNo: 'PV-002' },
                  journalLines: [
                    { accountName: 'Trade Payables', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const res10K2B_t3 = await processAccountingQuery(
      'Payment receipt attached.',
      res10K2B_t2.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Payment receipt attached.', images: [{ id: 'img-pv-002', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(res10K2B_t3.scenarioState.committedDirectGroups?.length, 3, 'PV-002 has distinct voucher number and must NOT be dropped as duplicate (length 3)');
    assert.equal(res10K2B_t3.scenarioState.remainingBalances?.[0]?.amount, 1000, 'Remaining balance must be S$1,000 after PV-002');
    console.log('✓ 10K-2B. Distinct payment vouchers with identical date and amount verified');
    passed++;
  }

  // Subcase 3: Quotation screenshot handling
  {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Equipment Quotation',
                directGroups: [{
                  id: 'grp-quote-1',
                  eventDate: '01/02/2025',
                  title: 'Quotation for Office Equipment',
                  totalDebit: 8000,
                  totalCredit: 8000,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Equipment', category: 'ASSET', debit: 8000, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 8000 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-quote-1',
                  documentType: 'quotation',
                  fields: { quoteDate: '01/02/2025', quotationNumber: 'QT-999' },
                  journalLines: [
                    { accountName: 'Office Equipment', debit: 8000, credit: 0 },
                    { accountName: 'Trade Payables', debit: 0, credit: 8000 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const res10K3 = await processAccountingQuery(
      'Supplier quotation attached for office equipment.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Quotation attached', images: [{ id: 'img-quote-1', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(res10K3.scenarioState.directGroups?.length, 1, 'Quotation entry must be present in directGroups for display');
    assert.equal(res10K3.scenarioState.directGroups[0].isHypothetical, true, 'Quotation group must have isHypothetical === true');
    assert.equal(res10K3.scenarioState.directGroups[0].authorityStatus, 'CONDITIONAL', 'Quotation group must have authorityStatus === CONDITIONAL');
    assert.equal(res10K3.scenarioState.committedDirectGroups?.length, 0, 'Quotation must NOT be committed to committedDirectGroups');
    assert.equal(res10K3.scenarioState.actualEvents?.length, 0, 'Quotation must NOT create actualEvents');
    assert.equal(res10K3.scenarioState.remainingBalances, undefined, 'Quotation must NOT create remainingBalances');
    assert.equal(res10K3.scenarioState.isComplete, false, 'Quotation state must be incomplete');
    console.log('✓ 10K-3. Quotation screenshot resulting in conditional/hypothetical status verified');
    passed++;
  }

  // Subcase 4: Invalid calendar dates rejection
  {
    // 4A: 31/02/2025 in image fields
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice',
                directGroups: [{
                  id: 'grp-inv-bad-date',
                  eventDate: '31/02/2025',
                  title: 'Invoice',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-bad-date-1',
                  fields: { invoiceDate: '31/02/2025' },
                  journalLines: [
                    { accountName: 'Office Supplies', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const res10K4_subA = await processAccountingQuery(
      'Invoice attached.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Invoice', images: [{ id: 'img-bad-date-1', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.ok(
      res10K4_subA.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_INVALID_TRANSACTION_DATE'),
      'Must reject 31/02/2025 with IMAGE_INVALID_TRANSACTION_DATE'
    );
    assert.equal(res10K4_subA.scenarioState.directGroups?.length, 0);
    assert.equal(res10K4_subA.scenarioState.committedDirectGroups?.length, 0);

    // 4B: 29/02/2025 in user query (2025 is not a leap year)
    const res10K4_subB = await processAccountingQuery(
      'Invoice dated 29/02/2025 attached.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Invoice dated 29/02/2025', images: [{ id: 'img-bad-date-2', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.ok(
      res10K4_subB.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_INVALID_TRANSACTION_DATE'),
      'Must reject 29/02/2025 (non-leap year) with IMAGE_INVALID_TRANSACTION_DATE'
    );

    // 4C: 31 April 2025 in named month format (JS Date would overflow to 1 May)
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice',
                directGroups: [{
                  id: 'grp-inv-bad-date-3',
                  eventDate: '31 April 2025',
                  title: 'Invoice',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-bad-date-3',
                  fields: { invoiceDate: '31 April 2025' },
                  journalLines: [
                    { accountName: 'Office Supplies', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const res10K4_subC = await processAccountingQuery(
      'Invoice dated 31 April 2025 attached.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Invoice', images: [{ id: 'img-bad-date-3', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.ok(
      res10K4_subC.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_INVALID_TRANSACTION_DATE'),
      'Must reject 31 April 2025 with IMAGE_INVALID_TRANSACTION_DATE'
    );
    console.log('✓ 10K-4. Invalid calendar dates rejection verified across non-existent days and leap years');
    passed++;
  }

  // --- 10L. Review Findings Verification (5 Review Fixes) ---
  console.log('\n--- 10L. Review Findings Verification (5 Review Fixes) ---');

  // 10L-1 (P1 — Planned or conditional image-derived and AI entries cannot be committed)
  {
    // Planned status:
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Planned Equipment Purchase',
                directGroups: [{
                  id: 'grp-planned-1',
                  eventDate: '15/01/2025',
                  title: 'Planned Equipment Purchase',
                  totalDebit: 5000,
                  totalCredit: 5000,
                  isBalanced: true,
                  transactionStatus: 'planned',
                  lines: [
                    { accountName: 'Equipment', category: 'ASSET', debit: 5000, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 5000 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-planned-1',
                  fields: { invoiceDate: '15/01/2025' },
                  journalLines: [
                    { accountName: 'Equipment', debit: 5000, credit: 0 },
                    { accountName: 'Cash at Bank', debit: 0, credit: 5000 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const resPlanned = await processAccountingQuery(
      'Planned equipment purchase attached.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Planned equipment purchase attached.', images: [{ id: 'img-planned-1', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(resPlanned.scenarioState.directGroups?.[0]?.isHypothetical, true, 'Planned group must be marked isHypothetical: true');
    assert.equal(resPlanned.scenarioState.directGroups?.[0]?.authorityStatus, 'CONDITIONAL', 'Planned group must have CONDITIONAL authority');
    assert.equal(resPlanned.scenarioState.committedDirectGroups?.length, 0, 'Planned group must NOT be in committedDirectGroups');
    assert.equal((resPlanned.scenarioState.actualEvents || []).length, 0, 'Planned group must NOT generate actualEvents');
    assert.equal(resPlanned.scenarioState.remainingBalances, undefined, 'Planned group must NOT generate remaining balances');
    assert.equal(resPlanned.scenarioState.isComplete, false, 'Planned group scenario must have isComplete: false');

    // Conditional status:
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Conditional Purchase',
                directGroups: [{
                  id: 'grp-cond-1',
                  eventDate: '15/01/2025',
                  title: 'Conditional Purchase',
                  totalDebit: 3000,
                  totalCredit: 3000,
                  isBalanced: true,
                  transactionStatus: 'conditional',
                  lines: [
                    { accountName: 'Inventory', category: 'ASSET', debit: 3000, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 3000 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-cond-1',
                  fields: { invoiceDate: '15/01/2025' },
                  journalLines: [
                    { accountName: 'Inventory', debit: 3000, credit: 0 },
                    { accountName: 'Cash at Bank', debit: 0, credit: 3000 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const resCond = await processAccountingQuery(
      'Conditional purchase attached.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Conditional purchase attached.', images: [{ id: 'img-cond-1', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(resCond.scenarioState.directGroups?.[0]?.isHypothetical, true, 'Conditional group must be marked isHypothetical: true');
    assert.equal(resCond.scenarioState.directGroups?.[0]?.authorityStatus, 'CONDITIONAL', 'Conditional group must have CONDITIONAL authority');
    assert.equal(resCond.scenarioState.committedDirectGroups?.length, 0, 'Conditional group must NOT be in committedDirectGroups');
    assert.equal((resCond.scenarioState.actualEvents || []).length, 0, 'Conditional group must NOT generate actualEvents');
    assert.equal(resCond.scenarioState.remainingBalances, undefined, 'Conditional group must NOT generate remaining balances');
    assert.equal(resCond.scenarioState.isComplete, false, 'Conditional group scenario must have isComplete: false');

    console.log('✓ 10L-1. Planned and conditional entries cannot be committed');
    passed++;
  }

  // 10L-2 (P1 — Two separate S$500 bank payments on the same day without voucher numbers are both preserved)
  {
    // Turn 1: Committed S$2,000 invoice on credit
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Inventory Purchase on Credit',
                directGroups: [{
                  id: 'grp-inv-2000',
                  eventDate: '10/01/2025',
                  title: 'Inventory Purchase',
                  totalDebit: 2000,
                  totalCredit: 2000,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Inventory', category: 'ASSET', debit: 2000, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 2000 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn1 = await processAccountingQuery(
      'Purchased inventory for S$2,000 on credit.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );
    assert.equal(turn1.scenarioState.committedDirectGroups?.length, 1);
    assert.equal(turn1.scenarioState.remainingBalances?.[0]?.amount, 2000);

    // Turn 2: First S$500 bank payment screenshot (no voucher number)
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Bank Payment',
                directGroups: [{
                  id: 'grp-pay-1',
                  eventDate: '15/01/2025',
                  title: 'Bank Payment',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-bank-pay-1',
                  fields: { paymentDate: '15/01/2025', amount: 500 },
                  journalLines: [
                    { accountName: 'Trade Payables', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn2 = await processAccountingQuery(
      'Payment screenshot attached.',
      turn1.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Payment screenshot attached.', images: [{ id: 'img-bank-pay-1', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );
    assert.equal(turn2.scenarioState.committedDirectGroups?.length, 2, 'Turn 2 must commit second group');
    assert.equal(turn2.scenarioState.remainingBalances?.[0]?.amount, 1500, 'Remaining balance must be S$1,500');

    // Turn 3: Second S$500 bank payment screenshot on same day (no voucher number, neutral prompt)
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Bank Payment',
                directGroups: [{
                  id: 'grp-pay-2',
                  eventDate: '15/01/2025',
                  title: 'Bank Payment',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-bank-pay-2',
                  fields: { paymentDate: '15/01/2025', amount: 500 },
                  journalLines: [
                    { accountName: 'Trade Payables', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn3 = await processAccountingQuery(
      'Payment screenshot attached.',
      turn2.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Payment screenshot attached.', images: [{ id: 'img-bank-pay-2', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(turn3.scenarioState.committedDirectGroups?.length, 3, 'Turn 3 must NOT be suppressed as duplicate');
    assert.equal(turn3.scenarioState.remainingBalances?.[0]?.amount, 1000, 'Remaining balance must be S$1,000');
    console.log('✓ 10L-2. Two separate bank payments on the same day without voucher numbers are both preserved');
    passed++;
  }

  // 10L-3 (P1 — Preventing unintended journal replacement on new invoice & explicit wrong targetTransactionId)
  {
    // Subcase A: Existing S$500 invoice followed by "Actually, here is another invoice for S$700"
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice 1',
                directGroups: [{
                  id: 'grp-inv-500',
                  eventDate: '10/01/2025',
                  title: 'First Invoice',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const inv1 = await processAccountingQuery(
      'Received invoice for office supplies of S$500.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );
    assert.equal(inv1.scenarioState.committedDirectGroups?.length, 1);

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Second Invoice',
                journalAction: 'revised',
                directGroups: [{
                  id: 'grp-inv-700',
                  eventDate: '12/01/2025',
                  title: 'Second Invoice',
                  journalAction: 'revised',
                  totalDebit: 700,
                  totalCredit: 700,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies', category: 'EXPENSE', debit: 700, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 700 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const inv2 = await processAccountingQuery(
      'Actually, here is another invoice for S$700.',
      inv1.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );
    assert.equal(inv2.scenarioState.committedDirectGroups?.length, 2, 'Must add second invoice instead of replacing');
    const totalPayables = (inv2.scenarioState.remainingBalances || []).reduce((s, b) => s + b.amount, 0);
    assert.equal(totalPayables, 1200, 'Total payables must be S$1,200');

    // Subcase B: Revision with explicitly incorrect targetTransactionId
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Amended Invoice',
                journalAction: 'revised',
                directGroups: [{
                  id: 'grp-rev-1',
                  targetTransactionId: 'grp-wrong-id',
                  eventDate: '10/01/2025',
                  title: 'Amended Invoice',
                  journalAction: 'revised',
                  totalDebit: 600,
                  totalCredit: 600,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies', category: 'EXPENSE', debit: 600, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 600 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const revWrongTarget = await processAccountingQuery(
      'Actually, amend the invoice to S$600.',
      inv1.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );
    assert.ok(
      revWrongTarget.scenarioState.missingFields?.some(f => f.fieldKey === 'revisionTarget'),
      'Must reject with revisionTarget clarification when targetTransactionId is wrong'
    );
    assert.equal(revWrongTarget.scenarioState.committedDirectGroups?.length, 1, 'Prior committed group preserved untouched');
    assert.equal(revWrongTarget.scenarioState.committedDirectGroups?.[0]?.totalDebit, 500, 'Original amount preserved');

    // Direct check on resolveAndApplyJournalRevisions with 1 prior transaction
    const directRev1 = resolveAndApplyJournalRevisions(
      inv1.scenarioState.committedDirectGroups,
      [{ id: 'grp-rev-test', targetTransactionId: 'grp-wrong-id', totalDebit: 600, totalCredit: 600, lines: [] }],
      'amend invoice'
    );
    assert.equal(directRev1.unidentifiedRevision, true, 'Explicitly wrong targetTransactionId must fail with 1 prior transaction');

    // Direct check on resolveAndApplyJournalRevisions with 2 prior transactions
    const directRev2 = resolveAndApplyJournalRevisions(
      inv2.scenarioState.committedDirectGroups,
      [{ id: 'grp-rev-test', targetTransactionId: 'grp-wrong-id', totalDebit: 600, totalCredit: 600, lines: [] }],
      'amend invoice'
    );
    assert.equal(directRev2.unidentifiedRevision, true, 'Explicitly wrong targetTransactionId must fail with 2 prior transactions');

    console.log('✓ 10L-3. Unintended journal replacement prevented on new invoice & explicit wrong targetTransactionId rejected');
    passed++;
  }

  // 10L-4 (P2 — Rejected screenshot retained as pendingImageEvidence and completed on follow-up turn without re-upload)
  {
    // Turn 1: Invoice screenshot with missing transaction date
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice',
                directGroups: [{
                  id: 'grp-pending-1',
                  title: 'Invoice',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-pending-inv',
                  fields: { invoiceNo: 'INV-888' },
                  journalLines: [
                    { accountName: 'Office Supplies', debit: 500, credit: 0 },
                    { accountName: 'Trade Payables', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn1Pending = await processAccountingQuery(
      'Invoice attached.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Invoice attached.', images: [{ id: 'img-pending-inv', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.ok(
      turn1Pending.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_MISSING_TRANSACTION_DATE'),
      'Must reject with IMAGE_MISSING_TRANSACTION_DATE'
    );
    assert.equal(turn1Pending.scenarioState.imageEvidence?.length, 0, 'imageEvidence must not be committed');
    assert.equal(turn1Pending.scenarioState.committedDirectGroups?.length, 0, 'committedDirectGroups must be empty');
    assert.equal(turn1Pending.scenarioState.pendingImageEvidence?.length, 1, 'pendingImageEvidence must retain screenshot');
    assert.equal(turn1Pending.scenarioState.pendingImageEvidence?.[0]?.imageId, 'img-pending-inv');

    // Turn 2: User provides transaction date WITHOUT re-uploading the image
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice',
                directGroups: [{
                  id: 'grp-pending-1',
                  eventDate: '15/03/2025',
                  title: 'Invoice',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn2Completed = await processAccountingQuery(
      'The transaction date was 15/03/2025.',
      turn1Pending.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(turn2Completed.scenarioState.committedDirectGroups?.length, 1, 'Turn 2 must commit the journal entry');
    assert.equal(turn2Completed.scenarioState.committedDirectGroups?.[0]?.eventDate, '15/03/2025', 'Must have resolved eventDate 15/03/2025');
    assert.equal(turn2Completed.scenarioState.committedDirectGroups?.[0]?.totalDebit, 500, 'Must have totalDebit 500');
    assert.equal(turn2Completed.scenarioState.imageEvidence?.length, 1, 'imageEvidence must now be committed');
    assert.equal(turn2Completed.scenarioState.pendingImageEvidence, undefined, 'pendingImageEvidence must be cleared');
    console.log('✓ 10L-4. Rejected screenshot retained as pendingImageEvidence and completed on follow-up turn without re-upload');
    passed++;
  }

  // 10L-5 (P2 — ISO datetime validation rejects invalid calendar dates like 2025-02-29T12:00:00)
  {
    assert.equal(formatSingaporeDate('2025-02-29T12:00:00'), '', 'formatSingaporeDate must return empty for non-leap year 2025-02-29 ISO datetime');
    assert.equal(getSingaporeDateString('2025-02-29T12:00:00'), '', 'getSingaporeDateString must return empty for non-leap year 2025-02-29 ISO datetime');
    assert.equal(formatSingaporeDate('2024-02-29T12:00:00'), '29/02/2024', 'formatSingaporeDate must format valid leap year 2024-02-29 ISO datetime');
    assert.equal(formatSingaporeDate('2025-04-31T10:00:00Z'), '', 'formatSingaporeDate must return empty for non-existent 31 April ISO datetime');

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice',
                directGroups: [{
                  id: 'grp-iso-bad-date',
                  eventDate: '2025-02-29T12:00:00',
                  title: 'Invoice',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-iso-bad-date',
                  fields: { invoiceDate: '2025-02-29T12:00:00' },
                  journalLines: [
                    { accountName: 'Office Supplies', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const resIsoBadDate = await processAccountingQuery(
      'Invoice dated 2025-02-29T12:00:00 attached.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Invoice dated 2025-02-29T12:00:00 attached.', images: [{ id: 'img-iso-bad-date', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.ok(
      resIsoBadDate.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_INVALID_TRANSACTION_DATE'),
      'Must reject 2025-02-29T12:00:00 with IMAGE_INVALID_TRANSACTION_DATE'
    );
    console.log('✓ 10L-5. ISO datetime validation rejects invalid calendar dates like 2025-02-29T12:00:00');
    passed++;
  }

  // =================================================================
  // 10M. Second Review Findings Verification (5 Findings)
  // =================================================================

  // 10M-1 (P1 — Rejected screenshot conflict followed by non-resolution inquiry does not post; resolved follow-up turn commits)
  {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Office Supplies Invoice',
                directGroups: [{
                  id: 'grp-ai-m1',
                  eventDate: '10/01/2025',
                  title: 'Office Supplies',
                  totalDebit: 600,
                  totalCredit: 600,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies', category: 'EXPENSE', debit: 600, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 600 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-conflict-m1',
                  fields: { invoiceDate: '10/01/2025', totalAmount: 500 },
                  journalLines: [
                    { accountName: 'Office Supplies', debit: 500, credit: 0 },
                    { accountName: 'Trade Payables', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn1Conflict = await processAccountingQuery(
      'Invoice attached.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Invoice attached.', images: [{ id: 'img-conflict-m1', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.ok(
      turn1Conflict.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_JOURNAL_CONFLICT'),
      'Turn 1 must reject conflicting AI vs image entry with IMAGE_JOURNAL_CONFLICT'
    );
    assert.equal(turn1Conflict.scenarioState.committedDirectGroups?.length, 0, 'Turn 1 must have 0 committedDirectGroups');
    assert.equal(turn1Conflict.scenarioState.pendingImageEvidence?.length, 1, 'Turn 1 must retain screenshot in pendingImageEvidence');

    // Turn 2: User asks "Why was this journal rejected?"
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'ACCOUNTING_ADVISORY',
                transactionTitle: 'Rejection Explanation',
                directGroups: [],
                accountingTreatmentSummary: 'The journal entry extracted from the screenshot had total amount S$500, which conflicted with the AI suggested amount S$600.'
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn2Explain = await processAccountingQuery(
      'Why was this journal rejected?',
      turn1Conflict.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.deepEqual(turn2Explain.scenarioState.committedDirectGroups, [], 'Turn 2 explanation turn must keep committedDirectGroups empty');
    assert.deepEqual(turn2Explain.scenarioState.directGroups, [], 'Turn 2 explanation turn must keep directGroups empty');
    assert.equal(turn2Explain.scenarioState.isComplete, false, 'Turn 2 must keep isComplete false');
    assert.equal(turn2Explain.scenarioState.pendingImageEvidence?.length, 1, 'Turn 2 must retain pendingImageEvidence');
    assert.ok(
      turn2Explain.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_JOURNAL_CONFLICT'),
      'Turn 2 must retain imageGuardrail-IMAGE_JOURNAL_CONFLICT in missingFields'
    );
    assert.ok(!turn2Explain.messageText.includes('Journal Entry Confirmed'), 'Turn 2 messageText must not say Journal Entry Confirmed');
    assert.ok(!turn2Explain.messageText.includes('has been posted'), 'Turn 2 messageText must not say has been posted');

    // Turn 3: User resolves conflict: "Please post the screenshot journal with S$500 Office Supplies."
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Office Supplies Invoice',
                directGroups: [{
                  id: 'grp-ai-resolved',
                  eventDate: '10/01/2025',
                  title: 'Office Supplies',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn3Resolved = await processAccountingQuery(
      'Please post the screenshot journal with S$500 Office Supplies.',
      turn2Explain.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(turn3Resolved.scenarioState.committedDirectGroups?.length, 1, 'Turn 3 must commit the resolved journal');
    assert.equal(turn3Resolved.scenarioState.committedDirectGroups?.[0]?.totalDebit, 500, 'Turn 3 totalDebit must be 500');
    assert.equal(turn3Resolved.scenarioState.isComplete, true, 'Turn 3 isComplete must be true');
    assert.equal(turn3Resolved.scenarioState.pendingImageEvidence, undefined, 'Turn 3 pendingImageEvidence must be cleared');
    assert.ok(
      turn3Resolved.messageText.includes('Journal Entry Confirmed') || turn3Resolved.messageText.includes('has been posted'),
      'Turn 3 messageText must report journal entry confirmed / posted'
    );
    console.log('✓ 10M-1 (P1). Rejected screenshot conflict followed by non-resolution inquiry does not post; resolved follow-up turn commits');
    passed++;
  }

  // 10M-2 (P1 — Revision matching disambiguation between multiple prior identical-account transactions)
  {
    const priorRent1 = {
      id: 'rent-inv-101',
      transactionId: 'rent-inv-101',
      title: 'Rent Invoice INV-101',
      eventDate: '01/01/2025',
      totalDebit: 1000,
      totalCredit: 1000,
      isBalanced: true,
      lines: [
        { accountName: 'Rent Expense', category: 'EXPENSE', debit: 1000, credit: 0, lineExplanation: 'Office rent for Jan INV-101' },
        { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000, lineExplanation: 'Trade payables for INV-101' }
      ]
    };
    const priorRent2 = {
      id: 'rent-inv-102',
      transactionId: 'rent-inv-102',
      title: 'Rent Invoice INV-102',
      eventDate: '01/02/2025',
      totalDebit: 1200,
      totalCredit: 1200,
      isBalanced: true,
      lines: [
        { accountName: 'Rent Expense', category: 'EXPENSE', debit: 1200, credit: 0, lineExplanation: 'Office rent for Feb INV-102' },
        { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1200, lineExplanation: 'Trade payables for INV-102' }
      ]
    };

    const baseTwoInvoicesScenario = {
      scenarioType: 'UNIVERSAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      isComplete: true,
      missingFields: [],
      directGroups: [priorRent1, priorRent2],
      committedDirectGroups: [priorRent1, priorRent2]
    };

    // Revision with generic ID 'grp-1' and ambiguous target ("Amend the rent invoice to S$1,500")
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                journalAction: 'revised',
                transactionTitle: 'Revised Rent Invoice',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '01/02/2025',
                  title: 'Revised Rent',
                  totalDebit: 1500,
                  totalCredit: 1500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Rent Expense', category: 'EXPENSE', debit: 1500, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const resAmbiguous = await processAccountingQuery(
      'Amend the rent invoice to S$1,500',
      baseTwoInvoicesScenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.ok(
      resAmbiguous.scenarioState.missingFields?.some(f => f.fieldKey === 'revisionTarget'),
      'Must reject ambiguous revision target with revisionTarget clarification'
    );
    assert.equal(resAmbiguous.scenarioState.committedDirectGroups?.length, 2, 'Both prior rent invoices must remain untouched');
    assert.equal(resAmbiguous.scenarioState.committedDirectGroups?.[0]?.totalDebit, 1000, 'Invoice 1 must still be 1000');
    assert.equal(resAmbiguous.scenarioState.committedDirectGroups?.[1]?.totalDebit, 1200, 'Invoice 2 must still be 1200');

    // Follow-up: User specifies explicit document reference "INV-102"
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                journalAction: 'revised',
                transactionTitle: 'Revised Rent Invoice INV-102',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '01/02/2025',
                  title: 'Revised Rent INV-102',
                  totalDebit: 1500,
                  totalCredit: 1500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Rent Expense', category: 'EXPENSE', debit: 1500, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const resDisambiguated = await processAccountingQuery(
      'Amend rent invoice INV-102 to S$1,500',
      resAmbiguous.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(resDisambiguated.scenarioState.committedDirectGroups?.length, 2, 'Must still have 2 committed groups');
    assert.equal(resDisambiguated.scenarioState.committedDirectGroups?.[0]?.id, 'rent-inv-101', 'Invoice 1 ID must remain rent-inv-101');
    assert.equal(resDisambiguated.scenarioState.committedDirectGroups?.[0]?.totalDebit, 1000, 'Invoice 1 must remain 1000 untouched');
    assert.equal(resDisambiguated.scenarioState.committedDirectGroups?.[1]?.id, 'rent-inv-102', 'Invoice 2 ID must remain rent-inv-102');
    assert.equal(resDisambiguated.scenarioState.committedDirectGroups?.[1]?.totalDebit, 1500, 'Invoice 2 must be updated to 1500');
    assert.ok(
      !resDisambiguated.scenarioState.missingFields?.some(f => f.fieldKey === 'revisionTarget'),
      'revisionTarget must be resolved'
    );
    console.log('✓ 10M-2 (P1). Ambiguous revision target rejected; explicit invoice ref disambiguates and updates correct earlier transaction');
    passed++;
  }

  // 10M-3 (P1 — Planned / conditional image entry completed with date remains hypothetical and uncommitted)
  {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Quotation for Equipment Purchase',
                transactionStatus: 'planned',
                directGroups: [{
                  id: 'grp-quote-1',
                  eventDate: '',
                  transactionStatus: 'planned',
                  title: 'Quotation for Equipment Purchase',
                  totalDebit: 3000,
                  totalCredit: 3000,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Equipment', category: 'ASSET', debit: 3000, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 3000 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-quotation-m3',
                  documentType: 'quotation',
                  fields: { totalAmount: 3000, quotationRef: 'QUOTE-2025-01' },
                  journalLines: [
                    { accountName: 'Office Equipment', debit: 3000, credit: 0 },
                    { accountName: 'Trade Payables', debit: 0, credit: 3000 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn1Quote = await processAccountingQuery(
      'Attached quotation for proposed equipment purchase.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Attached quotation for proposed equipment purchase.', images: [{ id: 'img-quotation-m3', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(turn1Quote.scenarioState.pendingImageEvidence?.length, 1, 'Turn 1 quotation must be held in pendingImageEvidence');

    // Turn 2: User provides date for planned transaction
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Planned Equipment Purchase',
                transactionStatus: 'planned',
                directGroups: [{
                  id: 'grp-quote-1',
                  eventDate: '15/03/2025',
                  transactionStatus: 'planned',
                  title: 'Planned Equipment Purchase',
                  totalDebit: 3000,
                  totalCredit: 3000,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Equipment', category: 'ASSET', debit: 3000, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 3000 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn2Planned = await processAccountingQuery(
      'The planned purchase date is 15/03/2025.',
      turn1Quote.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(turn2Planned.scenarioState.committedDirectGroups?.length || 0, 0, 'Planned transaction must NOT commit direct groups');
    assert.equal(turn2Planned.scenarioState.isComplete, false, 'Planned transaction isComplete must be false');
    assert.equal(turn2Planned.scenarioState.directGroups?.[0]?.isHypothetical, true, 'directGroups[0] must be marked hypothetical');
    assert.equal(turn2Planned.scenarioState.authorityStatus, 'CONDITIONAL', 'authorityStatus must be CONDITIONAL');
    assert.ok(!turn2Planned.messageText.includes('Journal Entry Confirmed'), 'messageText must not state Journal Entry Confirmed');
    assert.ok(!turn2Planned.messageText.includes('has been posted'), 'messageText must not state has been posted');
    console.log('✓ 10M-3 (P1). Planned/conditional image entry completed with date remains hypothetical and uncommitted');
    passed++;
  }

  // 10M-4 (P2 — Screenshot with invalid calendar date 29/02/2025 successfully corrected on follow-up turn)
  {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Consulting Invoice',
                directGroups: [{
                  id: 'grp-bad-leap-1',
                  eventDate: '29/02/2025',
                  title: 'Consulting Services',
                  totalDebit: 750,
                  totalCredit: 750,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Consulting Fees', category: 'EXPENSE', debit: 750, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 750 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-bad-leap-m4',
                  fields: { invoiceDate: '29/02/2025', totalAmount: 750 },
                  journalLines: [
                    { accountName: 'Consulting Fees', debit: 750, credit: 0 },
                    { accountName: 'Trade Payables', debit: 0, credit: 750 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn1BadDate = await processAccountingQuery(
      'Consulting invoice attached.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Consulting invoice attached.', images: [{ id: 'img-bad-leap-m4', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.ok(
      turn1BadDate.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_INVALID_TRANSACTION_DATE'),
      'Turn 1 must reject invalid 29/02/2025 with IMAGE_INVALID_TRANSACTION_DATE'
    );
    assert.equal(turn1BadDate.scenarioState.pendingImageEvidence?.length, 1, 'Turn 1 must retain pendingImageEvidence');

    // Turn 2: User corrects date without re-uploading
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Consulting Invoice',
                directGroups: [{
                  id: 'grp-bad-leap-1',
                  eventDate: '28/02/2025',
                  title: 'Consulting Services',
                  totalDebit: 750,
                  totalCredit: 750,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Consulting Fees', category: 'EXPENSE', debit: 750, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 750 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn2GoodDate = await processAccountingQuery(
      'The correct transaction date is 28/02/2025.',
      turn1BadDate.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(turn2GoodDate.scenarioState.committedDirectGroups?.length, 1, 'Turn 2 must commit the journal entry');
    assert.equal(turn2GoodDate.scenarioState.committedDirectGroups?.[0]?.eventDate, '28/02/2025', 'eventDate must be 28/02/2025');
    assert.equal(turn2GoodDate.scenarioState.imageEvidence?.length, 1, 'imageEvidence must be committed');

    const dateField = turn2GoodDate.scenarioState.imageEvidence?.[0]?.fields?.find(f => /date/i.test(f.field));
    assert.ok(dateField, 'Must have a date field');
    assert.equal(dateField.value, '28/02/2025', 'Effective date field value must be updated to 28/02/2025');
    assert.equal(dateField.originalValue, '29/02/2025', 'originalValue must preserve the initial 29/02/2025');

    const origFields = turn2GoodDate.scenarioState.imageEvidence?.[0]?.originalFields;
    assert.ok(origFields && origFields.length > 0, 'Must have originalFields');
    const origDateField = origFields.find(f => /date/i.test(f.field));
    assert.equal(origDateField?.value, '29/02/2025', 'originalFields must retain 29/02/2025');
    console.log('✓ 10M-4 (P2). Invalid calendar date in pendingImageEvidence successfully corrected by follow-up user date');
    passed++;
  }

  // 10M-5 (P2 — Fields-only screenshot duplicate protection via sourceImageIds)
  {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Office Equipment Purchase',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '15/01/2025',
                  title: 'Office Equipment Purchase',
                  totalDebit: 1200,
                  totalCredit: 1200,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Equipment', category: 'ASSET', debit: 1200, credit: 0 },
                    { accountName: 'Cash / Bank', category: 'ASSET', debit: 0, credit: 400 },
                    { accountName: 'Accounts Payable', category: 'LIABILITY', debit: 0, credit: 800 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-fields-m5',
                  fields: [
                    { source: 'image', field: 'transactionType', value: 'equipment_purchase' },
                    { source: 'image', field: 'assetName', value: 'Office Equipment' },
                    { source: 'image', field: 'totalAmount', value: 1200 },
                    { source: 'image', field: 'immediatePayment', value: 400 },
                    { source: 'image', field: 'remainingPayable', value: 800 },
                    { source: 'image', field: 'invoiceDate', value: '15/01/2025' }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn1FieldsOnly = await processAccountingQuery(
      'Attached equipment purchase screenshot.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Attached equipment purchase screenshot.', images: [{ id: 'img-fields-m5', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(turn1FieldsOnly.scenarioState.committedDirectGroups?.length, 1, 'Turn 1 must commit 1 group');
    assert.equal(turn1FieldsOnly.scenarioState.committedDirectGroups?.[0]?.id, 'grp-1', 'Committed group ID must be grp-1');
    assert.ok(
      turn1FieldsOnly.scenarioState.committedDirectGroups?.[0]?.sourceImageIds?.includes('img-fields-m5'),
      'Committed group must have sourceImageIds containing img-fields-m5'
    );

    // Turn 2: Reprocess the same screenshot on follow-up turn (with ordinary id: 'grp-1')
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Office Equipment Purchase',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '15/01/2025',
                  title: 'Office Equipment Purchase',
                  totalDebit: 1200,
                  totalCredit: 1200,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Equipment', category: 'ASSET', debit: 1200, credit: 0 },
                    { accountName: 'Cash / Bank', category: 'ASSET', debit: 0, credit: 400 },
                    { accountName: 'Accounts Payable', category: 'LIABILITY', debit: 0, credit: 800 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-fields-m5',
                  fields: [
                    { source: 'image', field: 'transactionType', value: 'equipment_purchase' },
                    { source: 'image', field: 'assetName', value: 'Office Equipment' },
                    { source: 'image', field: 'totalAmount', value: 1200 },
                    { source: 'image', field: 'immediatePayment', value: 400 },
                    { source: 'image', field: 'remainingPayable', value: 800 },
                    { source: 'image', field: 'invoiceDate', value: '15/01/2025' }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn2Reprocess = await processAccountingQuery(
      'Here is the equipment purchase again.',
      turn1FieldsOnly.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Here is the equipment purchase again.', images: [{ id: 'img-fields-m5', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(
      turn2Reprocess.scenarioState.committedDirectGroups?.length,
      1,
      'Duplicate detection via sourceImageIds must prevent recording the transaction twice'
    );
    console.log('✓ 10M-5 (P2). Fields-only screenshot attaches sourceImageIds and deduplicates idempotent follow-up turn');
    passed++;
  }

  // --- 10N. Review Findings Verification (5 Review Fixes) ---
  // 10N-1 (P1 — Revision can still select the wrong invoice)
  {
    // Case A: Single prior recorded rent invoice (INV-101). User asks to "Amend INV-999 to S$1,500"
    const singleRentInvoiceScenario = {
      scenarioType: 'UNIVERSAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      rawQuery: 'Recorded rent invoice INV-101 for S$1,000.',
      transactionTitle: 'Rent Invoice INV-101',
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      isComplete: true,
      committedDirectGroups: [{
        id: 'rent-inv-101',
        transactionId: 'rent-inv-101',
        eventDate: '01/01/2025',
        title: 'Rent Invoice INV-101',
        summary: 'Rent invoice INV-101',
        totalDebit: 1000,
        totalCredit: 1000,
        isBalanced: true,
        lines: [
          { accountName: 'Rent Expense', category: 'EXPENSE', debit: 1000, credit: 0 },
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
        ]
      }],
      directGroups: [{
        id: 'rent-inv-101',
        transactionId: 'rent-inv-101',
        eventDate: '01/01/2025',
        title: 'Rent Invoice INV-101',
        summary: 'Rent invoice INV-101',
        totalDebit: 1000,
        totalCredit: 1000,
        isBalanced: true,
        lines: [
          { accountName: 'Rent Expense', category: 'EXPENSE', debit: 1000, credit: 0 },
          { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
        ]
      }]
    };

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                journalAction: 'revised',
                transactionTitle: 'Revised Rent Invoice',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '01/01/2025',
                  title: 'Revised Rent Invoice',
                  totalDebit: 1500,
                  totalCredit: 1500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Rent Expense', category: 'EXPENSE', debit: 1500, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const res10N1A = await processAccountingQuery(
      'Amend INV-999 to S$1,500',
      singleRentInvoiceScenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(res10N1A.scenarioState.isComplete, false, 'Must not be complete on non-existent invoice revision');
    assert.ok(
      res10N1A.scenarioState.missingFields?.some(f => f.fieldKey === 'revisionTarget'),
      'Must prompt revisionTarget clarification for INV-999'
    );
    assert.equal(res10N1A.scenarioState.committedDirectGroups?.length, 1, 'Must preserve original committed group');
    assert.equal(res10N1A.scenarioState.committedDirectGroups[0].id, 'rent-inv-101', 'Must not rename INV-101');
    assert.equal(res10N1A.scenarioState.committedDirectGroups[0].totalDebit, 1000, 'Must NOT revise INV-101 amount');

    // Case B: Partial reference check: prior recorded invoices are INV-101 and INV-1102. User asks to "Amend INV-102 to S$1,500"
    const twoInvoicesScenario = {
      scenarioType: 'UNIVERSAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      rawQuery: 'Recorded rent invoices INV-101 for S$1,000 and INV-1102 for S$1,200.',
      transactionTitle: 'Rent Invoices',
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      isComplete: true,
      committedDirectGroups: [
        {
          id: 'rent-inv-101',
          transactionId: 'rent-inv-101',
          eventDate: '01/01/2025',
          title: 'Rent Invoice INV-101',
          totalDebit: 1000,
          totalCredit: 1000,
          isBalanced: true,
          lines: [
            { accountName: 'Rent Expense', category: 'EXPENSE', debit: 1000, credit: 0 },
            { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
          ]
        },
        {
          id: 'rent-inv-1102',
          transactionId: 'rent-inv-1102',
          eventDate: '01/02/2025',
          title: 'Rent Invoice INV-1102',
          totalDebit: 1200,
          totalCredit: 1200,
          isBalanced: true,
          lines: [
            { accountName: 'Rent Expense', category: 'EXPENSE', debit: 1200, credit: 0 },
            { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1200 }
          ]
        }
      ],
      directGroups: [
        {
          id: 'rent-inv-101',
          transactionId: 'rent-inv-101',
          eventDate: '01/01/2025',
          title: 'Rent Invoice INV-101',
          totalDebit: 1000,
          totalCredit: 1000,
          isBalanced: true,
          lines: [
            { accountName: 'Rent Expense', category: 'EXPENSE', debit: 1000, credit: 0 },
            { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1000 }
          ]
        },
        {
          id: 'rent-inv-1102',
          transactionId: 'rent-inv-1102',
          eventDate: '01/02/2025',
          title: 'Rent Invoice INV-1102',
          totalDebit: 1200,
          totalCredit: 1200,
          isBalanced: true,
          lines: [
            { accountName: 'Rent Expense', category: 'EXPENSE', debit: 1200, credit: 0 },
            { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 1200 }
          ]
        }
      ]
    };

    const res10N1B = await processAccountingQuery(
      'Amend INV-102 to S$1,500',
      twoInvoicesScenario,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(res10N1B.scenarioState.isComplete, false, 'Must not be complete when INV-102 does not match INV-1102');
    assert.ok(
      res10N1B.scenarioState.missingFields?.some(f => f.fieldKey === 'revisionTarget'),
      'Must prompt revisionTarget clarification when INV-102 does not match INV-1102'
    );
    assert.equal(res10N1B.scenarioState.committedDirectGroups?.length, 2, 'Must preserve both committed groups');
    assert.equal(res10N1B.scenarioState.committedDirectGroups[1].totalDebit, 1200, 'INV-1102 must NOT be revised by INV-102');
    console.log('✓ 10N-1 (P1). Revision ref resolution requires exact document ref match and avoids substring or unverified matches');
    passed++;
  }

  // 10N-2 (P1 — Previous image conflict can still be cleared without user resolution)
  {
    // Turn 1: Screenshot conflict (screenshot S$500 vs AI S$600)
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Office Supplies Purchase',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '15/01/2025',
                  title: 'Office Supplies Purchase',
                  totalDebit: 600,
                  totalCredit: 600,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 600, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-conflict-n2',
                  fields: { invoiceNo: 'INV-500', invoiceDate: '15/01/2025', totalAmount: 500 },
                  journalLines: [
                    { accountName: 'Office Supplies Expense', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn1Res = await processAccountingQuery(
      'Attached invoice screenshot.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Attached invoice screenshot.', images: [{ id: 'img-conflict-n2', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(turn1Res.scenarioState.committedDirectGroups?.length || 0, 0, 'Turn 1 conflicting journal must not be committed');
    assert.equal(turn1Res.scenarioState.pendingImageEvidence?.length, 1, 'Screenshot must be retained in pendingImageEvidence');
    assert.ok(
      turn1Res.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_JOURNAL_CONFLICT'),
      'Must have IMAGE_JOURNAL_CONFLICT error in missingFields'
    );

    // Turn 2: User asks "Is this screenshot correct?" while AI returns S$500 journal
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Office Supplies Purchase',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '15/01/2025',
                  title: 'Office Supplies Purchase',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn2Res = await processAccountingQuery(
      'Is this screenshot correct?',
      turn1Res.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(turn2Res.scenarioState.committedDirectGroups?.length || 0, 0, 'Turn 2 question must not commit journal entry');
    assert.equal(turn2Res.scenarioState.isComplete, false, 'Turn 2 must remain incomplete');
    assert.equal(turn2Res.scenarioState.pendingImageEvidence?.length, 1, 'Turn 2 must retain pendingImageEvidence');
    assert.ok(
      turn2Res.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_JOURNAL_CONFLICT'),
      'Turn 2 must retain IMAGE_JOURNAL_CONFLICT guardrail error'
    );

    // Turn 3: User confirms "Yes, please post the screenshot journal for S$500."
    const turn3Res = await processAccountingQuery(
      'Yes, please post the screenshot journal for S$500.',
      turn2Res.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(turn3Res.scenarioState.committedDirectGroups?.length, 1, 'Turn 3 must commit confirmed journal entry');
    assert.equal(turn3Res.scenarioState.committedDirectGroups[0].totalDebit, 500, 'Turn 3 committed amount must be S$500');
    assert.equal(turn3Res.scenarioState.isComplete, true, 'Turn 3 must be marked complete');
    assert.ok(!turn3Res.scenarioState.pendingImageEvidence?.length, 'Turn 3 must clear pendingImageEvidence');
    console.log('✓ 10N-2 (P1). Inquiry alone cannot resolve IMAGE_JOURNAL_CONFLICT; explicit user directive resolves and posts');
    passed++;
  }

  // 10N-3 (P1 — Fields-only screenshots can bypass amount reconciliation)
  {
    // Subcase A: Fields-only screenshot for S$500, AI returns balanced S$600 entry
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Office Supplies Purchase',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '15/01/2025',
                  title: 'Office Supplies Purchase',
                  totalDebit: 600,
                  totalCredit: 600,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 600, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-fields-n3a',
                  fields: [
                    { source: 'image', field: 'invoiceNo', value: 'INV-500' },
                    { source: 'image', field: 'invoiceDate', value: '15/01/2025' },
                    { source: 'image', field: 'totalAmount', value: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const res10N3A = await processAccountingQuery(
      'Attached invoice screenshot.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Attached invoice screenshot.', images: [{ id: 'img-fields-n3a', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(res10N3A.scenarioState.committedDirectGroups?.length || 0, 0, 'Conflicting S$600 entry must not be committed');
    assert.equal(res10N3A.scenarioState.isComplete, false, 'Must be incomplete');
    assert.equal(res10N3A.scenarioState.pendingImageEvidence?.length, 1, 'Image must be held in pendingImageEvidence');
    assert.ok(
      res10N3A.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_JOURNAL_CONFLICT'),
      'Must push IMAGE_JOURNAL_CONFLICT for amount discrepancy with fields-only screenshot'
    );

    // Subcase B: Two fields-only screenshots with two matching AI groups
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Two Invoice Purchases',
                directGroups: [
                  {
                    id: 'grp-1',
                    eventDate: '15/01/2025',
                    title: 'Office Supplies Purchase',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                    ]
                  },
                  {
                    id: 'grp-2',
                    eventDate: '16/01/2025',
                    title: 'Rent Expense Payment',
                    totalDebit: 800,
                    totalCredit: 800,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Rent Expense', category: 'EXPENSE', debit: 800, credit: 0 },
                      { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 800 }
                    ]
                  }
                ],
                imageEvidence: [
                  {
                    imageId: 'img-f1',
                    fields: [
                      { source: 'image', field: 'invoiceNo', value: 'INV-501' },
                      { source: 'image', field: 'invoiceDate', value: '15/01/2025' },
                      { source: 'image', field: 'totalAmount', value: 500 }
                    ]
                  },
                  {
                    imageId: 'img-f2',
                    fields: [
                      { source: 'image', field: 'invoiceNo', value: 'INV-502' },
                      { source: 'image', field: 'invoiceDate', value: '16/01/2025' },
                      { source: 'image', field: 'totalAmount', value: 800 }
                    ]
                  }
                ]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const res10N3B = await processAccountingQuery(
      'Attached two invoices.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [
        {
          sender: 'user',
          text: 'Attached two invoices.',
          images: [
            { id: 'img-f1', dataUrl: 'data:image/png;base64,mock1', mimeType: 'image/png' },
            { id: 'img-f2', dataUrl: 'data:image/png;base64,mock2', mimeType: 'image/png' }
          ]
        }
      ]
    );

    assert.equal(res10N3B.scenarioState.committedDirectGroups?.length, 2, 'Must commit both matching groups');
    assert.deepEqual(res10N3B.scenarioState.committedDirectGroups[0].sourceImageIds, ['img-f1'], 'Group 1 must only attach img-f1');
    assert.deepEqual(res10N3B.scenarioState.committedDirectGroups[1].sourceImageIds, ['img-f2'], 'Group 2 must only attach img-f2');

    // Subcase C: Re-uploading the same true fields-only screenshot on Turn 2 (with invoiceNo omitted in Turn 2 extraction)
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Office Supplies Purchase',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '15/01/2025',
                  title: 'Office Supplies Purchase',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-fields-n3c',
                  fields: [
                    { source: 'image', field: 'invoiceNo', value: 'INV-505' },
                    { source: 'image', field: 'invoiceDate', value: '15/01/2025' },
                    { source: 'image', field: 'totalAmount', value: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const res10N3C_t1 = await processAccountingQuery(
      'Attached invoice screenshot.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Attached invoice screenshot.', images: [{ id: 'img-fields-n3c', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(res10N3C_t1.scenarioState.committedDirectGroups?.length, 1, 'Turn 1 must commit 1 group');
    assert.deepEqual(res10N3C_t1.scenarioState.committedDirectGroups[0].sourceImageIds, ['img-fields-n3c'], 'Turn 1 group must attach img-fields-n3c');
    assert.equal(res10N3C_t1.scenarioState.isComplete, true, 'Turn 1 must be complete');

    // Turn 2: Re-uploading the same screenshot img-fields-n3c with extraction omitting invoiceNo
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Office Supplies Purchase',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '15/01/2025',
                  title: 'Office Supplies Purchase',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-fields-n3c',
                  fields: [
                    { source: 'image', field: 'invoiceDate', value: '15/01/2025' },
                    { source: 'image', field: 'totalAmount', value: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const res10N3C_t2 = await processAccountingQuery(
      'Here is the invoice screenshot again.',
      res10N3C_t1.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Here is the invoice screenshot again.', images: [{ id: 'img-fields-n3c', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(res10N3C_t2.scenarioState.committedDirectGroups?.length, 1, 'Turn 2 deduplicates cleanly without duplicating committed groups');
    assert.deepEqual(res10N3C_t2.scenarioState.committedDirectGroups[0].sourceImageIds, ['img-fields-n3c'], 'Group retains img-fields-n3c in sourceImageIds');
    assert.ok(
      !res10N3C_t2.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_JOURNAL_CONFLICT'),
      'Must NOT flag IMAGE_JOURNAL_CONFLICT on idempotent fields-only re-upload'
    );

    console.log('✓ 10N-3 (P1). Fields-only screenshots reconcile amounts/dates against journals and attach only matching image IDs');
    passed++;
  }

  // 10N-4 (P2 — Date correction can overwrite unrelated document fields)
  {
    // Turn 1: Screenshot with invalid paymentDate (29/02/2025) and valid invoiceDate + invoiceNo resembling a date (2025-02-29)
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Supplies Purchase',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '29/02/2025',
                  title: 'Supplies Purchase',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-date-n4',
                  fields: [
                    { source: 'image', field: 'invoiceNo', value: '2025-02-29' },
                    { source: 'image', field: 'invoiceDate', value: '10/01/2025' },
                    { source: 'image', field: 'paymentDate', value: '29/02/2025' },
                    { source: 'image', field: 'totalAmount', value: 500 }
                  ],
                  journalLines: [
                    { accountName: 'Office Supplies Expense', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn1Res = await processAccountingQuery(
      'Attached invoice screenshot.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Attached invoice screenshot.', images: [{ id: 'img-date-n4', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(turn1Res.scenarioState.committedDirectGroups?.length || 0, 0, 'Invalid paymentDate must be rejected');
    assert.equal(turn1Res.scenarioState.pendingImageEvidence?.length, 1, 'Must hold in pendingImageEvidence');

    // Follow-up: User corrects the payment date
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Supplies Purchase',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '15/01/2025',
                  title: 'Supplies Purchase',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn2Res = await processAccountingQuery(
      'The payment date is 15/01/2025.',
      turn1Res.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(turn2Res.scenarioState.committedDirectGroups?.length, 1, 'Must commit entry with corrected date');
    const committedImg = turn2Res.scenarioState.imageEvidence?.[0];
    assert.ok(committedImg, 'imageEvidence must be preserved');
    const fieldList = Array.isArray(committedImg.fields)
      ? committedImg.fields
      : Object.entries(committedImg.fields || {}).map(([field, value]) => ({ field, value }));

    const invoiceNoField = fieldList.find(f => f.field === 'invoiceNo');
    const invoiceDateField = fieldList.find(f => f.field === 'invoiceDate');
    const paymentDateField = fieldList.find(f => f.field === 'paymentDate');

    assert.equal(invoiceNoField?.value, '2025-02-29', 'invoiceNo must remain 2025-02-29 untouched');
    assert.equal(invoiceDateField?.value, '10/01/2025', 'invoiceDate must remain 10/01/2025 untouched');
    assert.equal(paymentDateField?.value, '15/01/2025', 'paymentDate must be updated to 15/01/2025');
    assert.equal(paymentDateField?.originalValue, '29/02/2025', 'paymentDate originalValue must be recorded as 29/02/2025');
    console.log('✓ 10N-4 (P2). Targeted date correction updates only targeted invalid date without overwriting invoiceDate or invoiceNo');
    passed++;
  }

  // 10N-5 (P2 — Repeated screenshot detection can fail when extraction omits a reference)
  {
    // Turn 1: Commit screenshot img-dup-omit with full doc ref INV-777
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Office Supplies Purchase',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '15/01/2025',
                  title: 'Office Supplies Purchase',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-dup-omit',
                  fields: { invoiceDate: '15/01/2025', invoiceNo: 'INV-777', totalAmount: 500 },
                  journalLines: [
                    { accountName: 'Office Supplies Expense', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn1Res = await processAccountingQuery(
      'Attached invoice screenshot.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Attached invoice screenshot.', images: [{ id: 'img-dup-omit', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(turn1Res.scenarioState.committedDirectGroups?.length, 1, 'Turn 1 must commit 1 group');

    // Turn 2: Same screenshot re-submitted, extraction omits invoiceNo
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Office Supplies Purchase',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '15/01/2025',
                  title: 'Office Supplies Purchase',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-dup-omit',
                  fields: { invoiceDate: '15/01/2025', totalAmount: 500 },
                  journalLines: [
                    { accountName: 'Office Supplies Expense', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn2Res = await processAccountingQuery(
      'Here is the invoice again.',
      turn1Res.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Here is the invoice again.', images: [{ id: 'img-dup-omit', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(
      turn2Res.scenarioState.committedDirectGroups?.length,
      1,
      'Omitted reference in subsequent extraction must still deduplicate when image ID and facts match'
    );

    // Turn 3: Screenshot with conflicting invoiceNo (INV-778) is NOT treated as duplicate
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Another Office Supplies Purchase',
                directGroups: [{
                  id: 'grp-2',
                  eventDate: '15/01/2025',
                  title: 'Another Office Supplies Purchase',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-other-3',
                  fields: { invoiceDate: '15/01/2025', invoiceNo: 'INV-778', totalAmount: 500 },
                  journalLines: [
                    { accountName: 'Office Supplies Expense', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn3Res = await processAccountingQuery(
      'Here is a different invoice for S$500.',
      turn2Res.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Here is a different invoice for S$500.', images: [{ id: 'img-other-3', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(
      turn3Res.scenarioState.committedDirectGroups?.length,
      2,
      'Conflicting document reference INV-778 must NOT be deduplicated'
    );
    console.log('✓ 10N-5 (P2). Repeated screenshot deduplication succeeds when subsequent extraction omits reference; conflicts rejected');
    passed++;
  }

  // 10O-1 (P1 — Corrected amounts cannot bypass pending screenshot validation)
  {
    // Subcase A: Unconfirmed conflicting amount is retained as pending with rejection reason, not committed
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Supplies Purchase',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '29/02/2025',
                  title: 'Supplies Purchase',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-10o1-a',
                  fields: { invoiceDate: '29/02/2025', invoiceNo: 'INV-1001', totalAmount: 500 },
                  journalLines: [
                    { accountName: 'Office Supplies Expense', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn1Res = await processAccountingQuery(
      'Attached invoice screenshot.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Attached invoice screenshot.', images: [{ id: 'img-10o1-a', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(turn1Res.scenarioState.committedDirectGroups?.length || 0, 0, 'Invalid date must hold in pending');
    assert.equal(turn1Res.scenarioState.pendingImageEvidence?.length, 1, 'Must hold 1 pending image');

    // Turn 2: User provides conflicting amount S$600 without explicit correction intent
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Supplies Purchase',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '15/01/2025',
                  title: 'Supplies Purchase',
                  totalDebit: 600,
                  totalCredit: 600,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 600, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn2Res = await processAccountingQuery(
      'Paid S$600 by bank transfer on 15/01/2025.',
      turn1Res.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(turn2Res.scenarioState.committedDirectGroups?.length || 0, 0, 'Unconfirmed conflicting amount must NOT commit');
    assert.equal(turn2Res.scenarioState.pendingImageEvidence?.length, 1, 'Pending image evidence must be retained');
    const hasConflictReason = turn2Res.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_JOURNAL_CONFLICT') ||
      turn2Res.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_JOURNAL_CONFLICT');
    assert.ok(hasConflictReason, 'Must include IMAGE_JOURNAL_CONFLICT rejection reason');

    // Subcase B: Confirmed amount correction commits with corrected amount, updates evidence, preserves originals
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Supplies Purchase',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '15/01/2025',
                  title: 'Supplies Purchase',
                  totalDebit: 600,
                  totalCredit: 600,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 600, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn3Res = await processAccountingQuery(
      'The correct amount is S$600, not S$500, and the date is 15/01/2025.',
      turn1Res.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(turn3Res.scenarioState.committedDirectGroups?.length, 1, 'Must commit entry with corrected amount');
    assert.equal(turn3Res.scenarioState.committedDirectGroups[0].totalDebit, 600, 'Committed debit must be 600');
    assert.equal(turn3Res.scenarioState.committedDirectGroups[0].totalCredit, 600, 'Committed credit must be 600');

    const committedImg = turn3Res.scenarioState.imageEvidence?.[0];
    assert.ok(committedImg, 'Committed imageEvidence must be present');
    assert.ok(committedImg.originalFields, 'originalFields must be preserved');
    assert.ok(committedImg.originalJournalLines, 'originalJournalLines must be preserved');

    const fieldList = Array.isArray(committedImg.fields)
      ? committedImg.fields
      : Object.entries(committedImg.fields || {}).map(([field, value]) => ({ field, value }));
    const totalField = fieldList.find(f => f.field === 'totalAmount' || f.field === 'amount');
    assert.equal(totalField?.value, 600, 'totalAmount value must be 600');
    assert.equal(totalField?.originalValue, 500, 'totalAmount originalValue must be preserved as 500');
    assert.equal(totalField?.confidence, 1, 'user-corrected confidence must be 1');

    assert.equal(committedImg.originalJournalLines[0].debit, 500, 'originalJournalLines debit must be 500');
    assert.equal(committedImg.originalJournalLines[1].credit, 500, 'originalJournalLines credit must be 500');
    assert.equal(committedImg.journalLines[0].debit, 600, 'journalLines debit must be updated to 600');
    assert.equal(committedImg.journalLines[0].originalDebit, 500, 'originalDebit must be 500');

    console.log('✓ 10O-1 (P1). Corrected amounts cannot bypass pending screenshot validation; explicit user confirmation commits with preserved originals');
    passed++;
  }

  // 10O-2 (P1 — Missing screenshot facts cannot be supplied solely by the AI)
  {
    // Subcase A: Missing date in screenshot cannot be supplied solely by AI
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice Record',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '15/01/2025',
                  title: 'Invoice Record',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-10o2-a',
                  fields: { totalAmount: 500, invoiceNo: 'INV-2001' },
                  journalLines: []
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const resA = await processAccountingQuery(
      'Record this invoice.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Record this invoice.', images: [{ id: 'img-10o2-a', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(resA.scenarioState.committedDirectGroups?.length || 0, 0, 'Missing screenshot date must NOT commit');
    assert.equal(resA.scenarioState.pendingImageEvidence?.length, 1, 'Must hold in pending');
    const hasMissingDate = resA.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_MISSING_TRANSACTION_DATE') ||
      resA.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_MISSING_TRANSACTION_DATE');
    assert.ok(hasMissingDate, 'Must include IMAGE_MISSING_TRANSACTION_DATE error');

    // Subcase B: Missing amount in screenshot cannot be guessed by AI
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice Record',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '15/01/2025',
                  title: 'Invoice Record',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-10o2-b',
                  fields: { invoiceDate: '15/01/2025', invoiceNo: 'INV-2002' },
                  journalLines: []
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const resB = await processAccountingQuery(
      'Record this invoice.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Record this invoice.', images: [{ id: 'img-10o2-b', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(resB.scenarioState.committedDirectGroups?.length || 0, 0, 'Missing screenshot amount must NOT commit');
    assert.equal(resB.scenarioState.pendingImageEvidence?.length, 1, 'Must hold in pending');
    const hasMissingAmount = resB.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_MISSING_AMOUNT') ||
      resB.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_MISSING_AMOUNT');
    assert.ok(hasMissingAmount, 'Must include IMAGE_MISSING_AMOUNT error');

    console.log('✓ 10O-2 (P1). Missing screenshot facts cannot be supplied solely by the AI (rejected with IMAGE_MISSING_TRANSACTION_DATE and IMAGE_MISSING_AMOUNT)');
    passed++;
  }

  // 10O-3 (P1 — Identical invoices cannot be ambiguously associated with multiple journals)
  {
    // Subcase A: Two invoices for S$500 without invoice numbers and two different S$500 journals -> rejected with IMAGE_AMBIGUOUS_MATCH
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Two Purchases',
                directGroups: [
                  {
                    id: 'grp-1',
                    eventDate: '15/01/2025',
                    title: 'Office Supplies Purchase',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                    ]
                  },
                  {
                    id: 'grp-2',
                    eventDate: '15/01/2025',
                    title: 'Equipment Maintenance',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Maintenance Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                    ]
                  }
                ],
                imageEvidence: [
                  {
                    imageId: 'img-10o3-a1',
                    fields: { invoiceDate: '15/01/2025', totalAmount: 500 },
                    journalLines: []
                  },
                  {
                    imageId: 'img-10o3-a2',
                    fields: { invoiceDate: '15/01/2025', totalAmount: 500 },
                    journalLines: []
                  }
                ]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const resA = await processAccountingQuery(
      'Here are two receipts.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [
        {
          sender: 'user',
          text: 'Here are two receipts.',
          images: [
            { id: 'img-10o3-a1', dataUrl: 'data:image/png;base64,mock1', mimeType: 'image/png' },
            { id: 'img-10o3-a2', dataUrl: 'data:image/png;base64,mock2', mimeType: 'image/png' }
          ]
        }
      ]
    );

    assert.equal(resA.scenarioState.committedDirectGroups?.length || 0, 0, 'Ambiguous matching across multiple identical images must NOT commit');
    const hasAmbigA = resA.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_AMBIGUOUS_MATCH') ||
      resA.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_AMBIGUOUS_MATCH');
    assert.ok(hasAmbigA, 'Must reject with IMAGE_AMBIGUOUS_MATCH');

    // Subcase B: Two invoices provided but only one journal returned -> rejected
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Single Purchase',
                directGroups: [
                  {
                    id: 'grp-1',
                    eventDate: '15/01/2025',
                    title: 'Office Supplies Purchase',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                    ]
                  }
                ],
                imageEvidence: [
                  {
                    imageId: 'img-10o3-b1',
                    fields: { invoiceDate: '15/01/2025', totalAmount: 500, invoiceNo: 'INV-301' },
                    journalLines: []
                  },
                  {
                    imageId: 'img-10o3-b2',
                    fields: { invoiceDate: '15/01/2025', totalAmount: 700, invoiceNo: 'INV-302' },
                    journalLines: []
                  }
                ]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const resB = await processAccountingQuery(
      'Here are two invoices.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [
        {
          sender: 'user',
          text: 'Here are two invoices.',
          images: [
            { id: 'img-10o3-b1', dataUrl: 'data:image/png;base64,mock1', mimeType: 'image/png' },
            { id: 'img-10o3-b2', dataUrl: 'data:image/png;base64,mock2', mimeType: 'image/png' }
          ]
        }
      ]
    );

    assert.equal(resB.scenarioState.committedDirectGroups?.length || 0, 0, '2 invoices with 1 journal must NOT commit silently');
    const hasAmbigB = resB.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_AMBIGUOUS_MATCH') ||
      resB.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_AMBIGUOUS_MATCH');
    assert.ok(hasAmbigB, 'Must report IMAGE_AMBIGUOUS_MATCH when image count does not match journal group count');

    // Subcase C: Two invoices with distinct invoice numbers match their respective journals cleanly
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Two Documented Purchases',
                directGroups: [
                  {
                    id: 'grp-1',
                    eventDate: '15/01/2025',
                    title: 'Office Supplies INV-001',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                    ]
                  },
                  {
                    id: 'grp-2',
                    eventDate: '15/01/2025',
                    title: 'Equipment Maintenance INV-002',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Maintenance Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                    ]
                  }
                ],
                imageEvidence: [
                  {
                    imageId: 'img-10o3-c1',
                    fields: { invoiceDate: '15/01/2025', invoiceNo: 'INV-001', totalAmount: 500 },
                    journalLines: []
                  },
                  {
                    imageId: 'img-10o3-c2',
                    fields: { invoiceDate: '15/01/2025', invoiceNo: 'INV-002', totalAmount: 500 },
                    journalLines: []
                  }
                ]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const resC = await processAccountingQuery(
      'Here are two invoices: INV-001 and INV-002.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [
        {
          sender: 'user',
          text: 'Here are two invoices: INV-001 and INV-002.',
          images: [
            { id: 'img-10o3-c1', dataUrl: 'data:image/png;base64,mock1', mimeType: 'image/png' },
            { id: 'img-10o3-c2', dataUrl: 'data:image/png;base64,mock2', mimeType: 'image/png' }
          ]
        }
      ]
    );

    assert.equal(resC.scenarioState.committedDirectGroups?.length, 2, 'Unambiguous invoices with matching doc refs must commit both groups');
    assert.equal(resC.scenarioState.imageEvidence?.length, 2, 'Both image evidence entries must be stored');
    assert.deepEqual(resC.scenarioState.committedDirectGroups[0].sourceImageIds, ['img-10o3-c1'], 'Journal 1 must link to img-10o3-c1');
    assert.deepEqual(resC.scenarioState.committedDirectGroups[1].sourceImageIds, ['img-10o3-c2'], 'Journal 2 must link to img-10o3-c2');

    console.log('✓ 10O-3 (P1). Identical invoices cannot be ambiguously associated with multiple journals; distinct document references disambiguate cleanly');
    passed++;
  }

  // 10O-4 (P2 — One date correction cannot overwrite multiple pending documents)
  {
    // Subcase A: Two pending invoices, user sends date correction without specifying document -> AMBIGUOUS_DOCUMENT_CORRECTION
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Two Pending Purchases',
                directGroups: [
                  {
                    id: 'grp-1',
                    eventDate: '29/02/2025',
                    title: 'Invoice INV-101',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                    ]
                  },
                  {
                    id: 'grp-2',
                    eventDate: '30/02/2025',
                    title: 'Invoice INV-102',
                    totalDebit: 700,
                    totalCredit: 700,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Maintenance Expense', category: 'EXPENSE', debit: 700, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 700 }
                    ]
                  }
                ],
                imageEvidence: [
                  {
                    imageId: 'img-10o4-a1',
                    fields: { invoiceDate: '29/02/2025', invoiceNo: 'INV-101', totalAmount: 500 },
                    journalLines: [
                      { accountName: 'Office Supplies Expense', debit: 500, credit: 0 },
                      { accountName: 'Trade Payables', debit: 0, credit: 500 }
                    ]
                  },
                  {
                    imageId: 'img-10o4-a2',
                    fields: { invoiceDate: '30/02/2025', invoiceNo: 'INV-102', totalAmount: 700 },
                    journalLines: [
                      { accountName: 'Maintenance Expense', debit: 700, credit: 0 },
                      { accountName: 'Trade Payables', debit: 0, credit: 700 }
                    ]
                  }
                ]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn1Res = await processAccountingQuery(
      'Attached two invoices.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [
        {
          sender: 'user',
          text: 'Attached two invoices.',
          images: [
            { id: 'img-10o4-a1', dataUrl: 'data:image/png;base64,mock1', mimeType: 'image/png' },
            { id: 'img-10o4-a2', dataUrl: 'data:image/png;base64,mock2', mimeType: 'image/png' }
          ]
        }
      ]
    );

    assert.equal(turn1Res.scenarioState.committedDirectGroups?.length || 0, 0, 'Invalid dates must hold');
    assert.equal(turn1Res.scenarioState.pendingImageEvidence?.length, 2, 'Must hold 2 pending images');

    // User provides date without specifying which invoice
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice Record',
                directGroups: [
                  {
                    id: 'grp-1',
                    eventDate: '15/03/2025',
                    title: 'Invoice Record',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                    ]
                  }
                ]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn2Res = await processAccountingQuery(
      'The date is 15/03/2025.',
      turn1Res.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(turn2Res.scenarioState.committedDirectGroups?.length || 0, 0, 'Ambiguous date correction must NOT commit');
    assert.equal(turn2Res.scenarioState.pendingImageEvidence?.length, 2, 'Pending images must be retained');
    const hasAmbigDoc = turn2Res.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-AMBIGUOUS_DOCUMENT_CORRECTION') ||
      turn2Res.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'AMBIGUOUS_DOCUMENT_CORRECTION');
    assert.ok(hasAmbigDoc, 'Must reject with AMBIGUOUS_DOCUMENT_CORRECTION');

    // Subcase B: User specifies "For invoice INV-101, the date is 15/03/2025" -> only INV-101 is updated
    const pendingImages = [
      {
        imageId: 'img-10o4-b1',
        fields: [
          { source: 'image_extraction', imageId: 'img-10o4-b1', field: 'invoiceDate', value: '29/02/2025', confidence: 0.9 },
          { source: 'image_extraction', imageId: 'img-10o4-b1', field: 'invoiceNo', value: 'INV-101', confidence: 0.9 },
          { source: 'image_extraction', imageId: 'img-10o4-b1', field: 'totalAmount', value: 500, confidence: 0.9 }
        ],
        journalLines: [
          { accountName: 'Office Supplies Expense', debit: 500, credit: 0 },
          { accountName: 'Trade Payables', debit: 0, credit: 500 }
        ]
      },
      {
        imageId: 'img-10o4-b2',
        fields: [
          { source: 'image_extraction', imageId: 'img-10o4-b2', field: 'invoiceDate', value: '30/02/2025', confidence: 0.9 },
          { source: 'image_extraction', imageId: 'img-10o4-b2', field: 'invoiceNo', value: 'INV-102', confidence: 0.9 },
          { source: 'image_extraction', imageId: 'img-10o4-b2', field: 'totalAmount', value: 700, confidence: 0.9 }
        ],
        journalLines: [
          { accountName: 'Maintenance Expense', debit: 700, credit: 0 },
          { accountName: 'Trade Payables', debit: 0, credit: 700 }
        ]
      }
    ];

    const scenarioState = {
      messages: [],
      pendingImageEvidence: pendingImages
    };

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice Record',
                directGroups: [
                  {
                    id: 'grp-1',
                    eventDate: '15/03/2025',
                    title: 'Invoice Record',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                    ]
                  }
                ]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turnRes = await processAccountingQuery(
      'For invoice INV-101, the date is 15/03/2025.',
      scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    const pendingUpdated = turnRes.scenarioState.pendingImageEvidence;
    assert.ok(pendingUpdated, 'pendingImageEvidence must exist');
    const img1 = pendingUpdated.find(img => img.imageId === 'img-10o4-b1');
    const img2 = pendingUpdated.find(img => img.imageId === 'img-10o4-b2');
    assert.ok(img1 && img2, 'Both pending images must still be present');

    const img1Date = img1.fields.find(f => f.field === 'invoiceDate');
    const img2Date = img2.fields.find(f => f.field === 'invoiceDate');

    assert.equal(img1Date?.value, '15/03/2025', 'Targeted INV-101 date must be updated to 15/03/2025');
    assert.equal(img1Date?.originalValue, '29/02/2025', 'Targeted INV-101 originalValue must be preserved');
    assert.equal(img2Date?.value, '30/02/2025', 'Non-targeted INV-102 date must remain 30/02/2025 untouched');

    console.log('✓ 10O-4 (P2). Date correction on multiple pending documents requires target document disambiguation and updates only targeted document');
    passed++;
  }

  // 10P-1 (P1 — Correcting a date must not clear an unresolved amount or account conflict)
  {
    // Turn 1: Screenshot shows S$500, but Gemini proposes S$600 -> IMAGE_JOURNAL_CONFLICT
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Office Supplies Purchase',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '15/01/2025',
                  title: 'Office Supplies Purchase',
                  totalDebit: 600,
                  totalCredit: 600,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 600, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 600 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-10p1',
                  fields: { invoiceDate: '15/01/2025', invoiceNo: 'INV-501', totalAmount: 500 },
                  journalLines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn1Res = await processAccountingQuery(
      'Attached invoice screenshot for office supplies.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Attached invoice screenshot for office supplies.', images: [{ id: 'img-10p1', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(turn1Res.scenarioState.committedDirectGroups?.length || 0, 0, 'Turn 1 conflicting amount must not commit');
    assert.equal(turn1Res.scenarioState.pendingImageEvidence?.length, 1, 'Turn 1 must hold 1 pending image');
    const hasConflictTurn1 = turn1Res.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_JOURNAL_CONFLICT') ||
      turn1Res.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_JOURNAL_CONFLICT');
    assert.ok(hasConflictTurn1, 'Turn 1 must reject with IMAGE_JOURNAL_CONFLICT');

    // Turn 2: User corrects only the transaction date ("The invoice date is 20/01/2025.")
    // Gemini now proposes S$500 on 20/01/2025
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Office Supplies Purchase',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '20/01/2025',
                  title: 'Office Supplies Purchase',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn2Res = await processAccountingQuery(
      'The invoice date is 20/01/2025.',
      turn1Res.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(turn2Res.scenarioState.committedDirectGroups?.length || 0, 0, 'Turn 2 original amount conflict must NOT be cleared by date-only correction');
    assert.equal(turn2Res.scenarioState.isComplete, false, 'Turn 2 isComplete must be false');
    const hasConflictTurn2 = turn2Res.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_JOURNAL_CONFLICT') ||
      turn2Res.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_JOURNAL_CONFLICT');
    assert.ok(hasConflictTurn2, 'Turn 2 IMAGE_JOURNAL_CONFLICT must remain in missingFields / pendingImageRejectionReasons');
    assert.equal(turn2Res.scenarioState.pendingImageEvidence?.length, 1, 'Turn 2 must retain pending screenshot');
    const pendingImgTurn2 = turn2Res.scenarioState.pendingImageEvidence[0];
    const pendingDateTurn2 = (Array.isArray(pendingImgTurn2.fields) ? pendingImgTurn2.fields : []).find(f => /date/i.test(String(f.field || '')));
    assert.equal(pendingDateTurn2?.value, '20/01/2025', 'Pending image must have updated date 20/01/2025');

    // Turn 3: User explicitly resolves the amount discrepancy ("Yes, use the screenshot amount of S$500.")
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Office Supplies Purchase',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '20/01/2025',
                  title: 'Office Supplies Purchase',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn3Res = await processAccountingQuery(
      'Yes, use the screenshot amount of S$500.',
      turn2Res.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(turn3Res.scenarioState.committedDirectGroups?.length, 1, 'Turn 3 must commit entry after amount conflict resolution');
    assert.equal(turn3Res.scenarioState.committedDirectGroups[0].totalDebit, 500, 'Committed totalDebit must be 500');
    assert.equal(turn3Res.scenarioState.committedDirectGroups[0].eventDate, '20/01/2025', 'Committed eventDate must be 20/01/2025');

    // Subcase B: Amount-only correction with proceed directive cannot clear an unresolved date conflict
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Supplies Date Conflict',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '25/01/2025',
                  title: 'Supplies Date Conflict',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-10p1-b',
                  fields: { invoiceDate: '15/01/2025', invoiceNo: 'INV-502', totalAmount: 500 },
                  journalLines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const subBInit = await processAccountingQuery(
      'Attached invoice.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Attached invoice.', images: [{ id: 'img-10p1-b', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );
    assert.equal(subBInit.scenarioState.committedDirectGroups?.length || 0, 0, 'Date conflict must hold in pending');
    const hasDateConflict = subBInit.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_JOURNAL_CONFLICT') ||
      subBInit.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_JOURNAL_CONFLICT');
    assert.ok(hasDateConflict, 'Must reject with date IMAGE_JOURNAL_CONFLICT');

    // User provides an amount correction with proceed directive: "Please proceed with the amount of S$500."
    // Date conflict remains unresolved, so it must NOT commit!
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Supplies Date Conflict',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '25/01/2025',
                  title: 'Supplies Date Conflict',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const subBTurn2 = await processAccountingQuery(
      'Please proceed with the amount of S$500.',
      subBInit.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(subBTurn2.scenarioState.committedDirectGroups?.length || 0, 0, 'Amount-only correction with proceed directive must NOT clear unresolved date conflict');
    const hasDateConflictTurn2 = subBTurn2.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_JOURNAL_CONFLICT') ||
      subBTurn2.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_JOURNAL_CONFLICT');
    assert.ok(hasDateConflictTurn2, 'IMAGE_JOURNAL_CONFLICT must remain after amount-only proceed');

    console.log('✓ 10P-1 (P1). Correcting a date must not clear an unresolved amount or account conflict');
    passed++;
  }

  // 10P-2 (P1 — Correction with unmatched explicit invoice reference is rejected even with one pending image)
  {
    // Subcase A: Single pending image INV-101 (invalid date 29/02/2025, totalAmount: 500)
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Office Supplies Purchase',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '29/02/2025',
                  title: 'Office Supplies Purchase',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-10p2-a',
                  fields: { invoiceDate: '29/02/2025', invoiceNo: 'INV-101', totalAmount: 500 },
                  journalLines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const initA = await processAccountingQuery(
      'Attached invoice.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Attached invoice.', images: [{ id: 'img-10p2-a', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(initA.scenarioState.committedDirectGroups?.length || 0, 0, 'Invalid date must hold in pending');

    // Date correction targeting unmatched INV-999
    const dateCorrA = await processAccountingQuery(
      'For invoice INV-999, the date is 15/03/2025.',
      initA.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(dateCorrA.scenarioState.committedDirectGroups?.length || 0, 0, 'Must NOT commit');
    const hasAmbigDateA = dateCorrA.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-AMBIGUOUS_DOCUMENT_CORRECTION') ||
      dateCorrA.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'AMBIGUOUS_DOCUMENT_CORRECTION');
    assert.ok(hasAmbigDateA, 'Date correction on unmatched doc ref must report AMBIGUOUS_DOCUMENT_CORRECTION');
    const imgDateA = dateCorrA.scenarioState.pendingImageEvidence?.[0]?.fields?.find((f) => f.field === 'invoiceDate');
    assert.equal(imgDateA?.value, '29/02/2025', 'INV-101 invoiceDate must NOT be modified');

    // Amount correction targeting unmatched INV-999
    const amtCorrA = await processAccountingQuery(
      'For invoice INV-999, the correct amount is S$600, not S$500.',
      initA.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(amtCorrA.scenarioState.committedDirectGroups?.length || 0, 0, 'Must NOT commit');
    const hasAmbigAmtA = amtCorrA.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-AMBIGUOUS_DOCUMENT_CORRECTION') ||
      amtCorrA.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'AMBIGUOUS_DOCUMENT_CORRECTION');
    assert.ok(hasAmbigAmtA, 'Amount correction on unmatched doc ref must report AMBIGUOUS_DOCUMENT_CORRECTION');
    const imgAmtA = amtCorrA.scenarioState.pendingImageEvidence?.[0]?.fields?.find((f) => f.field === 'totalAmount');
    assert.equal(imgAmtA?.value, 500, 'INV-101 totalAmount must NOT be modified');

    // Subcase B: Multiple pending images INV-101 and INV-102
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Two Invoices',
                directGroups: [
                  {
                    id: 'grp-1',
                    eventDate: '29/02/2025',
                    title: 'Invoice 101',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                    ]
                  },
                  {
                    id: 'grp-2',
                    eventDate: '30/02/2025',
                    title: 'Invoice 102',
                    totalDebit: 700,
                    totalCredit: 700,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Equipment Expense', category: 'EXPENSE', debit: 700, credit: 0 },
                      { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 700 }
                    ]
                  }
                ],
                imageEvidence: [
                  {
                    imageId: 'img-10p2-b1',
                    fields: { invoiceDate: '29/02/2025', invoiceNo: 'INV-101', totalAmount: 500 },
                    journalLines: []
                  },
                  {
                    imageId: 'img-10p2-b2',
                    fields: { invoiceDate: '30/02/2025', invoiceNo: 'INV-102', totalAmount: 700 },
                    journalLines: []
                  }
                ]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const initB = await processAccountingQuery(
      'Two invoices attached.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [
        {
          sender: 'user',
          text: 'Two invoices attached.',
          images: [
            { id: 'img-10p2-b1', dataUrl: 'data:image/png;base64,mock1', mimeType: 'image/png' },
            { id: 'img-10p2-b2', dataUrl: 'data:image/png;base64,mock2', mimeType: 'image/png' }
          ]
        }
      ]
    );

    assert.equal(initB.scenarioState.pendingImageEvidence?.length, 2, 'Must hold 2 pending images');

    // User specifies "For first invoice INV-999, the date is 15/03/2025."
    const dateCorrB = await processAccountingQuery(
      'For first invoice INV-999, the date is 15/03/2025.',
      initB.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(dateCorrB.scenarioState.committedDirectGroups?.length || 0, 0, 'Must NOT commit');
    const hasAmbigDateB = dateCorrB.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-AMBIGUOUS_DOCUMENT_CORRECTION') ||
      dateCorrB.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'AMBIGUOUS_DOCUMENT_CORRECTION');
    assert.ok(hasAmbigDateB, 'Must report AMBIGUOUS_DOCUMENT_CORRECTION when explicit doc ref matches none, without falling back to ordinal');
    const b1Date = dateCorrB.scenarioState.pendingImageEvidence?.[0]?.fields?.find((f) => f.field === 'invoiceDate');
    const b2Date = dateCorrB.scenarioState.pendingImageEvidence?.[1]?.fields?.find((f) => f.field === 'invoiceDate');
    assert.equal(b1Date?.value, '29/02/2025', 'Neither image 1 nor image 2 must be modified');
    assert.equal(b2Date?.value, '30/02/2025', 'Neither image 1 nor image 2 must be modified');

    console.log('✓ 10P-2 (P1). Correction with unmatched explicit invoice reference is rejected even with one pending image');
    passed++;
  }

  // 10P-3 (P1 — Amount corrections update only the identified field and preserve subtotal, GST, and other values)
  {
    // Pending invoice has subtotal: 100, gst: 9, totalAmount: 109 (held in pending due to invalid date 29/02/2025)
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Supplies Invoice',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '29/02/2025',
                  title: 'Supplies Invoice',
                  totalDebit: 109,
                  totalCredit: 109,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 100, credit: 0 },
                    { accountName: 'GST Input Tax', category: 'ASSET', debit: 9, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 109 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-10p3',
                  fields: [
                    { field: 'invoiceDate', value: '29/02/2025' },
                    { field: 'invoiceNo', value: 'INV-109' },
                    { field: 'subtotal', value: 100 },
                    { field: 'gst', value: 9 },
                    { field: 'totalAmount', value: 109 }
                  ],
                  journalLines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 100, credit: 0 },
                    { accountName: 'GST Input Tax', category: 'ASSET', debit: 9, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 109 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const initRes = await processAccountingQuery(
      'Attached invoice.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Attached invoice.', images: [{ id: 'img-10p3', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(initRes.scenarioState.pendingImageEvidence?.length, 1, 'Must hold 1 pending image');

    // User corrects only the total to S$119
    // "The correct total amount is S$119, not S$109, and the date is 15/01/2025."
    // AI proposes matching S$119 total
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Supplies Invoice',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '15/01/2025',
                  title: 'Supplies Invoice',
                  totalDebit: 119,
                  totalCredit: 119,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 100, credit: 0 },
                    { accountName: 'GST Input Tax', category: 'ASSET', debit: 9, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 119 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const corrRes = await processAccountingQuery(
      'The correct total amount is S$119, not S$109, and the date is 15/01/2025.',
      initRes.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    // Verify fields on updated image evidence: totalAmount is 119 (with originalValue: 109), subtotal is 100 (originalValue undefined), gst is 9 (originalValue undefined)
    const updatedImg = corrRes.scenarioState.pendingImageEvidence?.[0] || corrRes.scenarioState.imageEvidence?.[0];
    assert.ok(updatedImg, 'Updated image evidence must exist');
    const fTotal = updatedImg.fields.find(f => f.field === 'totalAmount');
    const fSubtotal = updatedImg.fields.find(f => f.field === 'subtotal');
    const fGst = updatedImg.fields.find(f => f.field === 'gst');

    assert.equal(fTotal?.value, 119, 'totalAmount must be updated to 119');
    assert.equal(fTotal?.originalValue, 109, 'totalAmount originalValue must be 109');
    assert.equal(fSubtotal?.value, 100, 'subtotal must remain 100');
    assert.equal(fSubtotal?.originalValue, undefined, 'subtotal originalValue must remain undefined');
    assert.equal(fGst?.value, 9, 'gst must remain 9');
    assert.equal(fGst?.originalValue, undefined, 'gst originalValue must remain undefined');

    // And verify that resulting unbalanced journal (100 + 9 != 119) is NOT committed
    assert.equal(corrRes.scenarioState.committedDirectGroups?.length || 0, 0, 'Unbalanced journal with 100 + 9 != 119 must NOT be committed');

    // Subcase B: Multi-field amount correction (subtotal S$110 and total S$119, while gst remains 9 untouched)
    // Starting again from a pending invoice with subtotal: 100, gst: 9, totalAmount: 109 and invalid date 29/02/2025
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Supplies Invoice B',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '29/02/2025',
                  title: 'Supplies Invoice B',
                  totalDebit: 109,
                  totalCredit: 109,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 100, credit: 0 },
                    { accountName: 'GST Input Tax', category: 'ASSET', debit: 9, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 109 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-10p3-b',
                  fields: [
                    { field: 'invoiceDate', value: '29/02/2025' },
                    { field: 'subtotal', value: 100 },
                    { field: 'gst', value: 9 },
                    { field: 'totalAmount', value: 109 }
                  ],
                  journalLines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 100, credit: 0 },
                    { accountName: 'GST Input Tax', category: 'ASSET', debit: 9, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 109 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const initB = await processAccountingQuery(
      'Attached invoice.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Attached invoice.', images: [{ id: 'img-10p3-b', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );
    assert.equal(initB.scenarioState.committedDirectGroups?.length || 0, 0, 'Invalid date must hold in pending');

    // Turn 2: User corrects both subtotal and total in the same turn:
    // "The subtotal is S$110 and the total is S$119, and the date is 15/01/2025."
    // AI proposes matching balanced journal: 110 + 9 == 119
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Supplies Invoice B',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '15/01/2025',
                  title: 'Supplies Invoice B',
                  totalDebit: 119,
                  totalCredit: 119,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 110, credit: 0 },
                    { accountName: 'GST Input Tax', category: 'ASSET', debit: 9, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 119 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const multiCorrRes = await processAccountingQuery(
      'The subtotal is S$110 and the total is S$119, and the date is 15/01/2025.',
      initB.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    // Verify fields on updated image evidence:
    const multiUpdatedImg = multiCorrRes.scenarioState.imageEvidence?.[0] || multiCorrRes.scenarioState.pendingImageEvidence?.[0];
    assert.ok(multiUpdatedImg, 'Updated image evidence must exist');
    const bSubtotal = multiUpdatedImg.fields.find(f => f.field === 'subtotal');
    const bTotal = multiUpdatedImg.fields.find(f => f.field === 'totalAmount');
    const bGst = multiUpdatedImg.fields.find(f => f.field === 'gst');

    assert.equal(bSubtotal?.value, 110, 'subtotal must be updated to 110');
    assert.equal(bSubtotal?.originalValue, 100, 'subtotal originalValue must be 100');
    assert.equal(bTotal?.value, 119, 'totalAmount must be updated to 119');
    assert.equal(bTotal?.originalValue, 109, 'totalAmount originalValue must be 109');
    assert.equal(bGst?.value, 9, 'gst must remain 9 untouched');
    assert.equal(bGst?.originalValue, undefined, 'gst originalValue must remain undefined');

    // And verify that the balanced journal (110 + 9 == 119) commits successfully!
    assert.equal(multiCorrRes.scenarioState.committedDirectGroups?.length, 1, 'Balanced journal (110 + 9 == 119) must be committed');
    assert.equal(multiCorrRes.scenarioState.committedDirectGroups[0].totalDebit, 119, 'Committed totalDebit must be 119');
    assert.equal(multiCorrRes.scenarioState.committedDirectGroups[0].lines[0].debit, 110, 'Line 0 debit must be 110');
    assert.equal(multiCorrRes.scenarioState.committedDirectGroups[0].lines[1].debit, 9, 'Line 1 debit must be 9');
    assert.equal(multiCorrRes.scenarioState.committedDirectGroups[0].lines[2].credit, 119, 'Line 2 credit must be 119');

    console.log('✓ 10P-3 (P1). Amount corrections update only the identified field and preserve subtotal, GST, and other values');
    passed++;
  }

  // 10P-4 (P2 — Prior transaction facts cannot validate an unrelated follow-up screenshot missing date or amount)
  {
    // Turn 1: Commit a valid transaction (INV-101, 15/01/2025, S$500)
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice 101',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '15/01/2025',
                  title: 'Office Supplies',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-inv101',
                  fields: { invoiceDate: '15/01/2025', invoiceNo: 'INV-101', totalAmount: 500 },
                  journalLines: []
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn1 = await processAccountingQuery(
      'Here is invoice INV-101 for S$500 on 15/01/2025.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Here is invoice INV-101 for S$500 on 15/01/2025.', images: [{ id: 'img-inv101', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );

    assert.equal(turn1.scenarioState.committedDirectGroups?.length, 1, 'Turn 1 must commit INV-101');

    // Turn 2a: Unrelated screenshot missing date (img-unrelated-date, invoiceNo: 'INV-202', totalAmount: 500, no date in screenshot or message)
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice 202',
                directGroups: [{
                  id: 'grp-2',
                  eventDate: '15/01/2025',
                  title: 'Invoice 202',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-unrelated-date',
                  fields: { invoiceNo: 'INV-202', totalAmount: 500 },
                  journalLines: []
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn2a = await processAccountingQuery(
      'Here is another receipt.',
      turn1.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Here is another receipt.', images: [{ id: 'img-unrelated-date', dataUrl: 'data:image/png;base64,mock2', mimeType: 'image/png' }] }]
    );

    assert.equal(turn2a.scenarioState.committedDirectGroups?.length, 1, 'Turn 2a must NOT commit unrelated invoice with missing date');
    const hasMissingDate = turn2a.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_MISSING_TRANSACTION_DATE') ||
      turn2a.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_MISSING_TRANSACTION_DATE');
    assert.ok(hasMissingDate, 'Turn 2a must reject with IMAGE_MISSING_TRANSACTION_DATE without reusing Turn 1 date');

    // Turn 2b: Unrelated screenshot missing amount (img-unrelated-amt, invoiceNo: 'INV-203', invoiceDate: '20/01/2025', no amount in screenshot or message)
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice 203',
                directGroups: [{
                  id: 'grp-3',
                  eventDate: '20/01/2025',
                  title: 'Invoice 203',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-unrelated-amt',
                  fields: { invoiceNo: 'INV-203', invoiceDate: '20/01/2025' },
                  journalLines: []
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn2b = await processAccountingQuery(
      'Here is another document.',
      turn1.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Here is another document.', images: [{ id: 'img-unrelated-amt', dataUrl: 'data:image/png;base64,mock3', mimeType: 'image/png' }] }]
    );

    assert.equal(turn2b.scenarioState.committedDirectGroups?.length, 1, 'Turn 2b must NOT commit unrelated invoice with missing amount');
    const hasMissingAmt = turn2b.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_MISSING_AMOUNT') ||
      turn2b.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_MISSING_AMOUNT');
    assert.ok(hasMissingAmt, 'Turn 2b must reject with IMAGE_MISSING_AMOUNT without reusing Turn 1 amount');

    // Turn 2c: Positively linked screenshot (invoiceNo: 'INV-101', totalAmount: 500, omitting date)
    // Should successfully reuse Turn 1's date
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice 101 Followup',
                directGroups: [{
                  id: 'grp-1',
                  eventDate: '15/01/2025',
                  title: 'Office Supplies Followup',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-linked',
                  fields: { invoiceNo: 'INV-101', totalAmount: 500 },
                  journalLines: []
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn2c = await processAccountingQuery(
      'Followup on INV-101.',
      turn1.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Followup on INV-101.', images: [{ id: 'img-linked', dataUrl: 'data:image/png;base64,mock4', mimeType: 'image/png' }] }]
    );

    const hasMissingDate2c = turn2c.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_MISSING_TRANSACTION_DATE') ||
      turn2c.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_MISSING_TRANSACTION_DATE');
    assert.ok(!hasMissingDate2c, 'Turn 2c positively linked screenshot must not fail with IMAGE_MISSING_TRANSACTION_DATE');

    console.log('✓ 10P-4 (P2). Prior transaction facts cannot validate an unrelated follow-up screenshot missing date or amount');
    passed++;
  }

  // 10Q-1 (P1 — Pre-tax / amount before GST corrections isolate subtotal and do not mutate GST or total)
  {
    const setupPending10Q1 = async (imageId = 'img-10q1-a') => {
      globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  responseKind: 'JOURNAL_ENTRY',
                  transactionTitle: 'Invoice 801',
                  directGroups: [{
                    id: 'grp-801',
                    eventDate: '29/02/2025',
                    title: 'Invoice 801',
                    totalDebit: 109,
                    totalCredit: 109,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 100, credit: 0 },
                      { accountName: 'GST Input Tax', category: 'ASSET', debit: 9, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 109 }
                    ]
                  }],
                  imageEvidence: [{
                    imageId,
                    fields: [
                      { field: 'invoiceDate', value: '29/02/2025' },
                      { field: 'invoiceNo', value: 'INV-801' },
                      { field: 'subtotal', value: 100 },
                      { field: 'gst', value: 9 },
                      { field: 'totalAmount', value: 109 }
                    ],
                    journalLines: [
                      { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 100, credit: 0 },
                      { accountName: 'GST Input Tax', category: 'ASSET', debit: 9, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 109 }
                    ]
                  }]
                })
              }]
            }
          }],
          usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
        })
      });
      return await processAccountingQuery(
        'Here is invoice INV-801.',
        null,
        'SFRS_I',
        'test-gemini-key-long-enough-12345',
        'gemini-3.5-flash-lite',
        [{ sender: 'user', text: 'Here is invoice INV-801.', images: [{ id: imageId, dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
      );
    };

    // Turn 2a: "The pre-tax amount is S$110, not S$100, and the date is 15/01/2025."
    const init2a = await setupPending10Q1('img-10q1-a');
    assert.equal(init2a.scenarioState.committedDirectGroups?.length || 0, 0, 'Invalid date holds in pending');

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice 801 Updated',
                directGroups: [{
                  id: 'grp-801',
                  eventDate: '15/01/2025',
                  title: 'Invoice 801 Updated',
                  totalDebit: 110,
                  totalCredit: 110,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 110, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 110 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn2a = await processAccountingQuery(
      'The pre-tax amount is S$110, not S$100, and the date is 15/01/2025.',
      init2a.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    const img2a = turn2a.scenarioState.pendingImageEvidence?.[0] || turn2a.scenarioState.imageEvidence?.[0];
    assert.ok(img2a, 'Updated image evidence must exist');
    const fSubtotal2a = img2a.fields.find(f => f.field === 'subtotal');
    const fGst2a = img2a.fields.find(f => f.field === 'gst');
    const fTotal2a = img2a.fields.find(f => f.field === 'totalAmount');
    assert.equal(fSubtotal2a?.value, 110, 'subtotal must update to 110');
    assert.equal(fSubtotal2a?.originalValue, 100, 'subtotal originalValue must be 100');
    assert.equal(fGst2a?.value, 9, 'gst must remain 9');
    assert.equal(fGst2a?.originalValue, undefined, 'gst originalValue must remain undefined');
    assert.equal(fTotal2a?.value, 109, 'totalAmount must remain 109');
    assert.equal(fTotal2a?.originalValue, undefined, 'totalAmount originalValue must remain undefined');
    assert.equal(turn2a.scenarioState.committedDirectGroups?.length || 0, 0, 'Unbalanced 110 + 9 != 109 must NOT commit');

    // Turn 2b (fresh pending): "The amount before GST is S$110, not S$100, and the date is 15/01/2025."
    const init2b = await setupPending10Q1('img-10q1-b');
    assert.equal(init2b.scenarioState.committedDirectGroups?.length || 0, 0, 'Invalid date holds in pending');

    const turn2b = await processAccountingQuery(
      'The amount before GST is S$110, not S$100, and the date is 15/01/2025.',
      init2b.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    const img2b = turn2b.scenarioState.pendingImageEvidence?.[0] || turn2b.scenarioState.imageEvidence?.[0];
    assert.ok(img2b, 'Updated image evidence must exist');
    const fSubtotal2b = img2b.fields.find(f => f.field === 'subtotal');
    const fGst2b = img2b.fields.find(f => f.field === 'gst');
    assert.equal(fSubtotal2b?.value, 110, 'subtotal must update to 110');
    assert.equal(fGst2b?.value, 9, 'gst must remain 9');
    assert.equal(fGst2b?.originalValue, undefined, 'gst originalValue must remain undefined');

    // Turn 2c (fresh pending): "The amount before GST is S$110, GST is S$9.90, and the total is S$119.90, and the date is 15/01/2025."
    const init2c = await setupPending10Q1('img-10q1-c');
    assert.equal(init2c.scenarioState.committedDirectGroups?.length || 0, 0, 'Invalid date holds in pending');

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice 801 Corrected',
                directGroups: [{
                  id: 'grp-801',
                  eventDate: '15/01/2025',
                  title: 'Invoice 801 Corrected',
                  totalDebit: 119.9,
                  totalCredit: 119.9,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 110, credit: 0 },
                    { accountName: 'GST Input Tax', category: 'ASSET', debit: 9.9, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 119.9 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn2c = await processAccountingQuery(
      'The amount before GST is S$110, GST is S$9.90, and the total is S$119.90, and the date is 15/01/2025.',
      init2c.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    const img2c = turn2c.scenarioState.imageEvidence?.[0] || turn2c.scenarioState.pendingImageEvidence?.[0];
    assert.ok(img2c, 'Updated image evidence must exist');
    const fSubtotal2c = img2c.fields.find(f => f.field === 'subtotal');
    const fGst2c = img2c.fields.find(f => f.field === 'gst');
    const fTotal2c = img2c.fields.find(f => f.field === 'totalAmount');
    assert.equal(fSubtotal2c?.value, 110, 'subtotal must be 110');
    assert.equal(fGst2c?.value, 9.9, 'gst must be 9.9');
    assert.equal(fGst2c?.originalValue, 9, 'gst originalValue must be 9');
    assert.equal(fTotal2c?.value, 119.9, 'totalAmount must be 119.9');
    assert.equal(fTotal2c?.originalValue, 109, 'totalAmount originalValue must be 109');
    assert.equal(turn2c.scenarioState.committedDirectGroups?.length, 1, 'Balanced journal must commit');
    assert.equal(turn2c.scenarioState.committedDirectGroups[0].totalDebit, 119.9, 'Committed totalDebit must be 119.9');

    console.log('✓ 10Q-1 (P1). Pre-tax / amount before GST corrections isolate subtotal and do not mutate GST or total');
    passed++;
  }

  // 10Q-2 (P1 — Follow-up queries with screenshots missing date or amount do not borrow from unrelated committed transactions)
  {
    // Turn 1: Commit INV-101 on 15/01/2025 for S$500
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice 101',
                directGroups: [{
                  id: 'grp-101',
                  eventDate: '15/01/2025',
                  title: 'Invoice 101',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-10q2-inv101',
                  fields: { invoiceDate: '15/01/2025', invoiceNo: 'INV-101', totalAmount: 500 },
                  journalLines: []
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn1 = await processAccountingQuery(
      'Here is invoice INV-101 for S$500 on 15/01/2025.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Here is invoice INV-101 for S$500 on 15/01/2025.', images: [{ id: 'img-10q2-inv101', dataUrl: 'data:image/png;base64,mock', mimeType: 'image/png' }] }]
    );
    assert.equal(turn1.scenarioState.committedDirectGroups?.length, 1, 'Turn 1 must commit INV-101');

    // Turn 2a: Upload unrelated img-10q2-pend-date (invoiceNo: 'INV-202', totalAmount: 700, NO date)
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice 202',
                directGroups: [{
                  id: 'grp-202',
                  eventDate: '15/01/2025',
                  title: 'Invoice 202',
                  totalDebit: 700,
                  totalCredit: 700,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 700, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 700 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-10q2-pend-date',
                  fields: { invoiceNo: 'INV-202', totalAmount: 700 },
                  journalLines: []
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn2a = await processAccountingQuery(
      'Here is another invoice.',
      turn1.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Here is another invoice.', images: [{ id: 'img-10q2-pend-date', dataUrl: 'data:image/png;base64,mock2', mimeType: 'image/png' }] }]
    );
    assert.equal(turn2a.scenarioState.committedDirectGroups?.length, 1, 'Turn 2a must NOT commit unrelated invoice with missing date');
    const hasMissingDate2a = turn2a.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_MISSING_TRANSACTION_DATE') ||
      turn2a.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_MISSING_TRANSACTION_DATE');
    assert.ok(hasMissingDate2a, 'Turn 2a must reject with IMAGE_MISSING_TRANSACTION_DATE');

    // Turn 3a: Send "Please use the screenshot" (still NO date) with AI proposing 15/01/2025
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice 202 Followup',
                directGroups: [{
                  id: 'grp-202',
                  eventDate: '15/01/2025',
                  title: 'Invoice 202 Followup',
                  totalDebit: 700,
                  totalCredit: 700,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 700, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 700 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn3a = await processAccountingQuery(
      'Please use the screenshot',
      turn2a.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );
    assert.equal(turn3a.scenarioState.committedDirectGroups?.length, 1, 'Turn 3a must NOT commit without verified date');
    const hasMissingDate3a = turn3a.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_MISSING_TRANSACTION_DATE') ||
      turn3a.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_MISSING_TRANSACTION_DATE');
    assert.ok(hasMissingDate3a, 'Turn 3a MUST still reject with IMAGE_MISSING_TRANSACTION_DATE');

    // Turn 2b (from Turn 1 state): Upload unrelated img-10q2-pend-amt (invoiceNo: 'INV-203', invoiceDate: '20/01/2025', NO amount)
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice 203',
                directGroups: [{
                  id: 'grp-203',
                  eventDate: '20/01/2025',
                  title: 'Invoice 203',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-10q2-pend-amt',
                  fields: { invoiceNo: 'INV-203', invoiceDate: '20/01/2025' },
                  journalLines: []
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn2b = await processAccountingQuery(
      'Here is another document.',
      turn1.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Here is another document.', images: [{ id: 'img-10q2-pend-amt', dataUrl: 'data:image/png;base64,mock3', mimeType: 'image/png' }] }]
    );
    assert.equal(turn2b.scenarioState.committedDirectGroups?.length, 1, 'Turn 2b must NOT commit unrelated invoice with missing amount');
    const hasMissingAmt2b = turn2b.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_MISSING_AMOUNT') ||
      turn2b.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_MISSING_AMOUNT');
    assert.ok(hasMissingAmt2b, 'Turn 2b must reject with IMAGE_MISSING_AMOUNT');

    // Turn 3b: Send "Please use the screenshot" (still NO amount) with AI proposing S$500
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice 203 Followup',
                directGroups: [{
                  id: 'grp-203',
                  eventDate: '20/01/2025',
                  title: 'Invoice 203 Followup',
                  totalDebit: 500,
                  totalCredit: 500,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                    { accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 500 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn3b = await processAccountingQuery(
      'Please use the screenshot',
      turn2b.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );
    assert.equal(turn3b.scenarioState.committedDirectGroups?.length, 1, 'Turn 3b must NOT commit without verified amount');
    const hasMissingAmt3b = turn3b.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_MISSING_AMOUNT') ||
      turn3b.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_MISSING_AMOUNT');
    assert.ok(hasMissingAmt3b, 'Turn 3b MUST still reject with IMAGE_MISSING_AMOUNT');

    console.log('✓ 10Q-2 (P1). Follow-up queries with screenshots missing date or amount do not borrow from unrelated committed transactions');
    passed++;
  }

  // 10Q-3 (P2 — Shared monetary field extraction ignores doc refs and dates across multi-field corrections and pending amounts)
  {
    // Subcase A: Pending invoice { invoiceDate: '29/02/2025', invoiceNo: 'INV-109', subtotal: 100, gst: 9, totalAmount: 109 }
    // User says "The subtotal is S$110, the total is S$119, and the date is 15/01/2025." with AI proposing (110, 9, 119)
    // Must NOT be blocked at 109 by INV-109!
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice 109',
                directGroups: [{
                  id: 'grp-109',
                  eventDate: '29/02/2025',
                  title: 'Invoice 109',
                  totalDebit: 109,
                  totalCredit: 109,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 100, credit: 0 },
                    { accountName: 'GST Input Tax', category: 'ASSET', debit: 9, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 109 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-10q3-a',
                  fields: [
                    { field: 'invoiceDate', value: '29/02/2025' },
                    { field: 'invoiceNo', value: 'INV-109' },
                    { field: 'subtotal', value: 100 },
                    { field: 'gst', value: 9 },
                    { field: 'totalAmount', value: 109 }
                  ],
                  journalLines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 100, credit: 0 },
                    { accountName: 'GST Input Tax', category: 'ASSET', debit: 9, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 109 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const init10Q3a = await processAccountingQuery(
      'Here is invoice INV-109.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Here is invoice INV-109.', images: [{ id: 'img-10q3-a', dataUrl: 'data:image/png;base64,mock109', mimeType: 'image/png' }] }]
    );
    assert.equal(init10Q3a.scenarioState.committedDirectGroups?.length || 0, 0, 'Invalid date holds in pending');

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice 109 Corrected',
                directGroups: [{
                  id: 'grp-109',
                  eventDate: '15/01/2025',
                  title: 'Invoice 109 Corrected',
                  totalDebit: 119,
                  totalCredit: 119,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 110, credit: 0 },
                    { accountName: 'GST Input Tax', category: 'ASSET', debit: 9, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 119 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const res10Q3a = await processAccountingQuery(
      'The subtotal is S$110, the total is S$119, and the date is 15/01/2025.',
      init10Q3a.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(res10Q3a.scenarioState.committedDirectGroups?.length, 1, 'Committed direct groups must be 1');
    assert.equal(res10Q3a.scenarioState.committedDirectGroups[0].lines[2].credit, 119, 'Committed line 2 credit must be 119');
    assert.equal(res10Q3a.scenarioState.imageEvidence[0].journalLines[2].credit, 119, 'Image journalLines line 2 credit must be 119');

    // Subcase B: Pending invoice { invoiceDate: '29/02/2025', invoiceNo: 'INV-119', subtotal: 100, gst: 9, totalAmount: 109 }
    // User says "The correct total amount is S$119, and the date is 15/01/2025." with AI proposing (100, 9, 119)
    // INV-119 in pendingAmounts must NOT suppress detecting S$119 as a correction!
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice 119',
                directGroups: [{
                  id: 'grp-119',
                  eventDate: '29/02/2025',
                  title: 'Invoice 119',
                  totalDebit: 109,
                  totalCredit: 109,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 100, credit: 0 },
                    { accountName: 'GST Input Tax', category: 'ASSET', debit: 9, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 109 }
                  ]
                }],
                imageEvidence: [{
                  imageId: 'img-10q3-b',
                  fields: [
                    { field: 'invoiceDate', value: '29/02/2025' },
                    { field: 'invoiceNo', value: 'INV-119' },
                    { field: 'subtotal', value: 100 },
                    { field: 'gst', value: 9 },
                    { field: 'totalAmount', value: 109 }
                  ],
                  journalLines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 100, credit: 0 },
                    { accountName: 'GST Input Tax', category: 'ASSET', debit: 9, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 109 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const init10Q3b = await processAccountingQuery(
      'Here is invoice INV-119.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [{ sender: 'user', text: 'Here is invoice INV-119.', images: [{ id: 'img-10q3-b', dataUrl: 'data:image/png;base64,mock119', mimeType: 'image/png' }] }]
    );
    assert.equal(init10Q3b.scenarioState.committedDirectGroups?.length || 0, 0, 'Invalid date holds in pending');

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Invoice 119 Propose',
                directGroups: [{
                  id: 'grp-119',
                  eventDate: '15/01/2025',
                  title: 'Invoice 119 Propose',
                  totalDebit: 119,
                  totalCredit: 119,
                  isBalanced: true,
                  lines: [
                    { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 100, credit: 0 },
                    { accountName: 'GST Input Tax', category: 'ASSET', debit: 9, credit: 0 },
                    { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 119 }
                  ]
                }]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const res10Q3b = await processAccountingQuery(
      'The correct total amount is S$119, and the date is 15/01/2025.',
      init10Q3b.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    const pendingImg10Q3b = res10Q3b.scenarioState.pendingImageEvidence?.[0] || res10Q3b.scenarioState.imageEvidence?.[0];
    assert.ok(pendingImg10Q3b, 'Pending image evidence must exist');
    const fTotal10Q3b = pendingImg10Q3b.fields.find(f => f.field === 'totalAmount');
    assert.equal(fTotal10Q3b?.value, 119, 'totalAmount must be updated to 119');
    assert.equal(fTotal10Q3b?.originalValue, 109, 'totalAmount originalValue must be 109');

    console.log('✓ 10Q-3 (P2). Shared monetary field extraction ignores doc refs and dates across multi-field corrections and pending amounts');
    passed++;
  }

  // 10Q-4 (P1 — Multiple pending screenshots with no committed groups cannot inherit another document's date or amount from scenario or query)
  {
    // Subcase A:
    // Turn 1: Two screenshots submitted:
    //   - INV-101: invoiceDate: '15/01/2025', invoiceNo: 'INV-101', totalAmount: 500
    //   - INV-202: invoiceNo: 'INV-202' (date and amount unknown / omitted)
    // Query mentions both references and INV-101's facts:
    //   "Here are INV-101 for S$500 dated 15 January 2025 and INV-202."
    // AI proposes two balanced S$500 journals dated 15/01/2025 for INV-101 and INV-202.
    // Turn 1 must NOT commit, holds both in pendingImageEvidence, and flags both missing date and missing amount for INV-202.
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Two Invoices',
                directGroups: [
                  {
                    id: 'grp-inv101',
                    eventDate: '15/01/2025',
                    title: 'Invoice INV-101',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                    ]
                  },
                  {
                    id: 'grp-inv202',
                    eventDate: '15/01/2025',
                    title: 'Invoice INV-202',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Maintenance Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                    ]
                  }
                ],
                imageEvidence: [
                  {
                    imageId: 'img-10q4-inv101',
                    fields: { invoiceDate: '15/01/2025', invoiceNo: 'INV-101', totalAmount: 500 },
                    journalLines: []
                  },
                  {
                    imageId: 'img-10q4-inv202',
                    fields: { invoiceNo: 'INV-202' },
                    journalLines: []
                  }
                ]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn1Res = await processAccountingQuery(
      'Here are INV-101 for S$500 dated 15 January 2025 and INV-202.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [
        {
          sender: 'user',
          text: 'Here are INV-101 for S$500 dated 15 January 2025 and INV-202.',
          images: [
            { id: 'img-10q4-inv101', dataUrl: 'data:image/png;base64,mock101', mimeType: 'image/png' },
            { id: 'img-10q4-inv202', dataUrl: 'data:image/png;base64,mock202', mimeType: 'image/png' }
          ]
        }
      ]
    );

    assert.equal(turn1Res.scenarioState.committedDirectGroups?.length || 0, 0, 'Turn 1 must NOT commit without verified date and amount for INV-202');
    assert.equal(turn1Res.scenarioState.pendingImageEvidence?.length, 2, 'Turn 1 must hold both screenshots in pendingImageEvidence');
    const hasMissingDate1 = turn1Res.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_MISSING_TRANSACTION_DATE') ||
      turn1Res.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_MISSING_TRANSACTION_DATE');
    assert.ok(hasMissingDate1, 'Turn 1 must reject with IMAGE_MISSING_TRANSACTION_DATE');
    const hasMissingAmt1 = turn1Res.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_MISSING_AMOUNT') ||
      turn1Res.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_MISSING_AMOUNT');
    assert.ok(hasMissingAmt1, 'Turn 1 must reject with IMAGE_MISSING_AMOUNT');

    // Turn 2 (later posting request with no committed groups):
    // User sends "Please post the pending screenshots". AI proposes same two balanced S$500 journals.
    // Turn 2 must still NOT commit and reject with missing date and amount.
    const turn2Res = await processAccountingQuery(
      'Please post the pending screenshots',
      turn1Res.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(turn2Res.scenarioState.committedDirectGroups?.length || 0, 0, 'Turn 2 must NOT commit without verified date and amount for INV-202');
    assert.equal(turn2Res.scenarioState.pendingImageEvidence?.length, 2, 'Turn 2 must keep both screenshots in pendingImageEvidence');
    const hasMissingDate2 = turn2Res.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_MISSING_TRANSACTION_DATE') ||
      turn2Res.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_MISSING_TRANSACTION_DATE');
    assert.ok(hasMissingDate2, 'Turn 2 must still reject with IMAGE_MISSING_TRANSACTION_DATE');
    const hasMissingAmt2 = turn2Res.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_MISSING_AMOUNT') ||
      turn2Res.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_MISSING_AMOUNT');
    assert.ok(hasMissingAmt2, 'Turn 2 must still reject with IMAGE_MISSING_AMOUNT');

    // Turn 2b alternative: user says "Please use the screenshot and record both INV-101 and INV-202"
    const turn2bRes = await processAccountingQuery(
      'Please use the screenshot and record both INV-101 and INV-202',
      turn1Res.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(turn2bRes.scenarioState.committedDirectGroups?.length || 0, 0, 'Turn 2b must NOT commit without verified date and amount for INV-202');
    assert.equal(turn2bRes.scenarioState.pendingImageEvidence?.length, 2, 'Turn 2b must keep both screenshots in pendingImageEvidence');
    const hasMissingDate2b = turn2bRes.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_MISSING_TRANSACTION_DATE') ||
      turn2bRes.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_MISSING_TRANSACTION_DATE');
    assert.ok(hasMissingDate2b, 'Turn 2b must still reject with IMAGE_MISSING_TRANSACTION_DATE');
    const hasMissingAmt2b = turn2bRes.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_MISSING_AMOUNT') ||
      turn2bRes.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_MISSING_AMOUNT');
    assert.ok(hasMissingAmt2b, 'Turn 2b must still reject with IMAGE_MISSING_AMOUNT');

    // Subcase A3: Stated query facts for INV-101 do not leak to INV-202 even when INV-101 has no date/amount in image fields
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Two Bare Invoices',
                directGroups: [
                  {
                    id: 'grp-inv101-a3',
                    eventDate: '15/01/2025',
                    title: 'Invoice INV-101',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                    ]
                  },
                  {
                    id: 'grp-inv202-a3',
                    eventDate: '15/01/2025',
                    title: 'Invoice INV-202',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Maintenance Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                    ]
                  }
                ],
                imageEvidence: [
                  {
                    imageId: 'img-10q4-inv101-a3',
                    fields: { invoiceNo: 'INV-101' },
                    journalLines: []
                  },
                  {
                    imageId: 'img-10q4-inv202-a3',
                    fields: { invoiceNo: 'INV-202' },
                    journalLines: []
                  }
                ]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn1ResA3 = await processAccountingQuery(
      'INV-101: S$500, dated 15 January 2025. INV-202: please record both.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [
        {
          sender: 'user',
          text: 'INV-101: S$500, dated 15 January 2025. INV-202: please record both.',
          images: [
            { id: 'img-10q4-inv101-a3', dataUrl: 'data:image/png;base64,mock101a3', mimeType: 'image/png' },
            { id: 'img-10q4-inv202-a3', dataUrl: 'data:image/png;base64,mock202a3', mimeType: 'image/png' }
          ]
        }
      ]
    );

    assert.equal(turn1ResA3.scenarioState.committedDirectGroups?.length || 0, 0, 'Turn 1 A3 must not commit without verified facts for INV-202');
    assert.equal(turn1ResA3.scenarioState.pendingImageEvidence?.length, 2, 'Turn 1 A3 must hold both in pendingImageEvidence');
    assert.ok(
      turn1ResA3.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_MISSING_TRANSACTION_DATE') ||
      turn1ResA3.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_MISSING_TRANSACTION_DATE'),
      'Turn 1 A3 must reject with IMAGE_MISSING_TRANSACTION_DATE'
    );
    assert.ok(
      turn1ResA3.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_MISSING_AMOUNT') ||
      turn1ResA3.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_MISSING_AMOUNT'),
      'Turn 1 A3 must reject with IMAGE_MISSING_AMOUNT'
    );

    const turn2ResA3 = await processAccountingQuery(
      'Please post the pending screenshots',
      turn1ResA3.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(turn2ResA3.scenarioState.committedDirectGroups?.length || 0, 0, 'Turn 2 A3 must not commit without verified facts for INV-202');
    assert.equal(turn2ResA3.scenarioState.pendingImageEvidence?.length, 2, 'Turn 2 A3 must keep both in pendingImageEvidence');
    assert.ok(
      turn2ResA3.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_MISSING_TRANSACTION_DATE') ||
      turn2ResA3.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_MISSING_TRANSACTION_DATE'),
      'Turn 2 A3 must still reject with IMAGE_MISSING_TRANSACTION_DATE'
    );
    assert.ok(
      turn2ResA3.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_MISSING_AMOUNT') ||
      turn2ResA3.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_MISSING_AMOUNT'),
      'Turn 2 A3 must still reject with IMAGE_MISSING_AMOUNT'
    );

    // Subcase B1: Single pending screenshot positively linked to its own prior scenario facts works
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Single Invoice INV-888',
                directGroups: [
                  {
                    id: 'grp-inv888',
                    eventDate: '10/01/2025',
                    title: 'Invoice INV-888',
                    totalDebit: 400,
                    totalCredit: 400,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 400, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 400 }
                    ]
                  }
                ],
                imageEvidence: [
                  {
                    imageId: 'img-10q4-inv888',
                    fields: { invoiceNo: 'INV-888' },
                    journalLines: []
                  }
                ]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const singleTurn1 = await processAccountingQuery(
      'Here is invoice INV-888 for S$400 dated 10/01/2025.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [
        {
          sender: 'user',
          text: 'Here is invoice INV-888 for S$400 dated 10/01/2025.',
          images: [{ id: 'img-10q4-inv888', dataUrl: 'data:image/png;base64,mock888', mimeType: 'image/png' }]
        }
      ]
    );
    assert.equal(singleTurn1.scenarioState.committedDirectGroups?.length, 1, 'Single document scenario inherits query date and amount');

    // Subcase B2: When user explicitly supplies the date and amount attributed to INV-202:
    // "For INV-202, the date is 20/01/2025 and the total amount is S$300"
    // INV-202 updates its fields and both INV-101 (S$500 on 15/01/2025) and INV-202 (S$300 on 20/01/2025) post cleanly!
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Two Documented Invoices',
                directGroups: [
                  {
                    id: 'grp-inv101',
                    eventDate: '15/01/2025',
                    title: 'Invoice INV-101',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                    ]
                  },
                  {
                    id: 'grp-inv202',
                    eventDate: '20/01/2025',
                    title: 'Invoice INV-202',
                    totalDebit: 300,
                    totalCredit: 300,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Maintenance Expense', category: 'EXPENSE', debit: 300, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 300 }
                    ]
                  }
                ]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn3Res = await processAccountingQuery(
      'For INV-202, the date is 20/01/2025 and the total amount is S$300.',
      turn1Res.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(turn3Res.scenarioState.committedDirectGroups?.length, 2, 'Both invoices must be committed');
    assert.equal(turn3Res.scenarioState.committedDirectGroups[0].totalDebit, 500, 'INV-101 total must be 500');
    assert.equal(turn3Res.scenarioState.committedDirectGroups[1].totalDebit, 300, 'INV-202 total must be 300');
    assert.equal(turn3Res.scenarioState.committedDirectGroups[0].eventDate, '15/01/2025', 'INV-101 eventDate must be 15/01/2025');
    assert.equal(turn3Res.scenarioState.committedDirectGroups[1].eventDate, '20/01/2025', 'INV-202 eventDate must be 20/01/2025');

    // Subcase C: Journal-lines path (journalLines non-empty on both INV-101 and INV-202, where INV-202 has no invoiceDate field)
    // with query "Here are INV-101 dated 15/01/2025 and INV-202." — verify INV-202 does NOT inherit 15/01/2025 and is rejected with IMAGE_MISSING_TRANSACTION_DATE
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Two Documented Journal-Line Invoices',
                directGroups: [
                  {
                    id: 'grp-inv101-c',
                    eventDate: '15/01/2025',
                    title: 'Invoice INV-101',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                    ]
                  },
                  {
                    id: 'grp-inv202-c',
                    eventDate: '15/01/2025',
                    title: 'Invoice INV-202',
                    totalDebit: 300,
                    totalCredit: 300,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Maintenance Expense', category: 'EXPENSE', debit: 300, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 300 }
                    ]
                  }
                ],
                imageEvidence: [
                  {
                    imageId: 'img-10q4-c1',
                    fields: { invoiceDate: '15/01/2025', invoiceNo: 'INV-101', totalAmount: 500 },
                    journalLines: [
                      { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                    ]
                  },
                  {
                    imageId: 'img-10q4-c2',
                    fields: { invoiceNo: 'INV-202', totalAmount: 300 },
                    journalLines: [
                      { accountName: 'Maintenance Expense', category: 'EXPENSE', debit: 300, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 300 }
                    ]
                  }
                ]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const resC = await processAccountingQuery(
      'Here are INV-101 dated 15/01/2025 and INV-202.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [
        {
          sender: 'user',
          text: 'Here are INV-101 dated 15/01/2025 and INV-202.',
          images: [
            { id: 'img-10q4-c1', dataUrl: 'data:image/png;base64,mockC1', mimeType: 'image/png' },
            { id: 'img-10q4-c2', dataUrl: 'data:image/png;base64,mockC2', mimeType: 'image/png' }
          ]
        }
      ]
    );

    assert.equal(resC.scenarioState.committedDirectGroups?.length || 0, 0, 'Subcase C must not commit without verified date for INV-202');
    assert.equal(resC.scenarioState.pendingImageEvidence?.length, 2, 'Subcase C must hold both in pendingImageEvidence');
    assert.ok(
      resC.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_MISSING_TRANSACTION_DATE') ||
      resC.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_MISSING_TRANSACTION_DATE'),
      'Subcase C must reject with IMAGE_MISSING_TRANSACTION_DATE'
    );

    console.log('✓ 10Q-4 (P1). Multiple pending screenshots with no committed groups cannot inherit another document\'s date or amount from scenario or query');
    passed++;
  }

  // 10R-1. extractDocRefOccurrences & extractNormalizedDocRefs format coverage and stopword/date filtering
  {
    assert.deepEqual(
      Array.from(extractNormalizedDocRefs('INV-101, INV_ABC123, INV: 101, INV #101, Invoice 101, Invoice ABC123, Invoice AB-123')),
      ['101', 'abc123', 'ab123'],
      'Standard numeric and alphanumeric doc ref formats must normalize cleanly'
    );

    assert.deepEqual(
      Array.from(extractNormalizedDocRefs('Invoice No. ABC123, Invoice No: 101, Invoice Number ABC123, Receipt No. RCP-55, Voucher No. 88, Ref No. A1, Bill No. 12, Document No. DOC99, Payment Voucher No. PV10')),
      ['abc123', '101', '55', '88', 'a1', '12', '99', 'pv10'].map(v => v === 'pv10' ? '10' : v),
      'No./Number prefix formats must extract and normalize doc bodies'
    );

    assert.deepEqual(
      Array.from(extractNormalizedDocRefs('INV-ALPHA, Invoice #BETA, Invoice: GAMMA, Invoice No. DELTA, Invoice Number EPSILON')),
      ['alpha', 'beta', 'gamma', 'delta', 'epsilon'],
      'Explicitly introduced alphabetic code identifiers must be recognized'
    );

    // Stopwords, currency codes, month names, and date-shaped tokens must NOT be treated as doc refs
    const nonRefText = 'This invoice is missing. The invoice amount is S$500, invoice total S$500, invoice date 15-01-2025, invoice 2025-01-15, invoice 15-01-25, invoice pending, invoice alpha, Invoice: SGD 500, Receipt: USD 200, invoice 15 Jan 2025.';
    assert.deepEqual(
      Array.from(extractNormalizedDocRefs(nonRefText)),
      [],
      'Stopwords, currency codes, day-before-month dates, date-shaped tokens, and non-indicated lowercase words must not match as doc refs'
    );

    assert.deepEqual(
      Array.from(extractNormalizedDocRefs('invoice ref 101, Invoice number is ABC123, invoice: receipt 55')),
      ['101', 'abc123', '55'],
      'Stopword rewind and "number is" patterns must still extract adjacent doc refs'
    );

    assert.deepEqual(
      Array.from(extractDocRefsFromImages([{ imageId: 'img-alpha-mixed', fields: [{ field: 'invoiceNo', value: 'Alpha' }] }])),
      ['alpha'],
      'Mixed-case alphabetic invoiceNo in image fields must normalize consistently with "Invoice No. Alpha"'
    );
    assert.deepEqual(
      Array.from(extractNormalizedDocRefs('Invoice No. Alpha')),
      ['alpha'],
      'Mixed-case alphabetic Invoice No. Alpha must extract "alpha"'
    );

    const occs = extractDocRefOccurrences('See Invoice No. ABC123 and INV-ALPHA.');
    assert.equal(occs.length, 2, 'Must locate two occurrences');
    assert.equal(occs[0].cleanBody, 'abc123');
    assert.equal('See Invoice No. ABC123 and INV-ALPHA.'.slice(occs[0].startIndex, occs[0].endIndex), 'Invoice No. ABC123');
    assert.equal(occs[1].cleanBody, 'alpha');
    assert.equal('See Invoice No. ABC123 and INV-ALPHA.'.slice(occs[1].startIndex, occs[1].endIndex), 'INV-ALPHA');

    console.log('✓ 10R-1. extractDocRefOccurrences & extractNormalizedDocRefs handle alphanumeric/alphabetic formats and exclude stopwords/dates');
    passed++;
  }

  // 10R-2 (P1 — Single doc ref in multi-document scenario cannot inherit another document's facts)
  {
    const p1Msg = 'INV-202 is still missing its date and amount. The first screenshot was dated 15 January 2025 and totals S$500.';
    const p1Facts = extractDocAttributedTextFacts(p1Msg, new Set(['202']), false);
    assert.equal(p1Facts.date, '', 'P1 multi-doc must NOT attribute first screenshot date to INV-202');
    assert.equal(p1Facts.amountsCents.size, 0, 'P1 multi-doc must NOT attribute first screenshot amount to INV-202');

    const p1SameSentence = 'INV-202 is still missing its date and amount, while the first screenshot was dated 15 January 2025 and totals S$500.';
    const p1SameFacts = extractDocAttributedTextFacts(p1SameSentence, new Set(['202']), false);
    assert.equal(p1SameFacts.date, '', 'P1 single-sentence while-clause must NOT attribute first screenshot date to INV-202');
    assert.equal(p1SameFacts.amountsCents.size, 0, 'P1 single-sentence while-clause must NOT attribute first screenshot amount to INV-202');

    const p1PrefixOrdinal = 'Unlike the first screenshot (15 January 2025, S$500), INV-202 is still missing its date and amount.';
    const p1PrefixFacts = extractDocAttributedTextFacts(p1PrefixOrdinal, new Set(['202']), false);
    assert.equal(p1PrefixFacts.date, '', 'P1 prefix ordinal clause must NOT attribute first screenshot date to INV-202');
    assert.equal(p1PrefixFacts.amountsCents.size, 0, 'P1 prefix ordinal clause must NOT attribute first screenshot amount to INV-202');

    for (const ordinalLeakCase of [
      'INV-202 is missing its date: the first screenshot was dated 15/01/2025 and totals S$500',
      'INV-202 is still missing its date and the first screenshot was dated 15/01/2025 and totals S$500',
      'INV-202 is missing its date, while Screenshot 1 was dated 15/01/2025 and totals S$500'
    ]) {
      const f = extractDocAttributedTextFacts(ordinalLeakCase, new Set(['202']), false);
      assert.equal(f.date, '', `Must not leak date in "${ordinalLeakCase}"`);
      assert.equal(f.amountsCents.size, 0, `Must not leak amount in "${ordinalLeakCase}"`);
    }

    const singleDocMultiSent = extractDocAttributedTextFacts(
      'Here is INV-101. The amount is S$500 and the date is 15 January 2025.',
      new Set(['101']),
      true
    );
    assert.equal(singleDocMultiSent.date, '15/01/2025', 'Single-document scenario continues to inherit follow-up sentence date');
    assert.ok(singleDocMultiSent.amountsCents.has(50000), 'Single-document scenario continues to inherit follow-up sentence amount');

    // End-to-end check: two pending screenshots (INV-101 complete, INV-202 missing date and amount)
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Two Invoices',
                directGroups: [
                  {
                    id: 'grp-r2-101',
                    eventDate: '15/01/2025',
                    title: 'Invoice INV-101',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                    ]
                  },
                  {
                    id: 'grp-r2-202',
                    eventDate: '15/01/2025',
                    title: 'Invoice INV-202',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Maintenance Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                    ]
                  }
                ],
                imageEvidence: [
                  {
                    imageId: 'img-10r2-101',
                    fields: { invoiceDate: '15/01/2025', invoiceNo: 'INV-101', totalAmount: 500 },
                    journalLines: []
                  },
                  {
                    imageId: 'img-10r2-202',
                    fields: { invoiceNo: 'INV-202' },
                    journalLines: []
                  }
                ]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const turn1 = await processAccountingQuery(
      'Attached two invoices.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [
        {
          sender: 'user',
          text: 'Attached two invoices.',
          images: [
            { id: 'img-10r2-101', dataUrl: 'data:image/png;base64,mock101', mimeType: 'image/png' },
            { id: 'img-10r2-202', dataUrl: 'data:image/png;base64,mock202', mimeType: 'image/png' }
          ]
        }
      ]
    );

    assert.equal(turn1.scenarioState.committedDirectGroups?.length || 0, 0, 'Turn 1 must hold in pending');

    const turn2 = await processAccountingQuery(
      'INV-202 is still missing its date and amount. The first screenshot was dated 15 January 2025 and totals S$500.',
      turn1.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(turn2.scenarioState.committedDirectGroups?.length || 0, 0, 'Turn 2 must NOT commit INV-202 using first screenshot facts');
    assert.equal(turn2.scenarioState.pendingImageEvidence?.length, 2, 'Turn 2 must retain both screenshots in pendingImageEvidence');
    const pending202Fields = turn2.scenarioState.pendingImageEvidence?.[1]?.fields || [];
    const pending202FieldList = Array.isArray(pending202Fields) ? pending202Fields : Object.entries(pending202Fields).map(([field, value]) => ({ field, value }));
    assert.equal(
      pending202FieldList.some(f => /date/i.test(String(f.field || '')) && f.value),
      false,
      'INV-202 must NOT have a date injected from the first screenshot'
    );
    assert.equal(
      pending202FieldList.some(f => /amount|total/i.test(String(f.field || '')) && Number(f.value) > 0),
      false,
      'INV-202 must NOT have an amount injected from the first screenshot'
    );
    assert.ok(
      turn2.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_MISSING_TRANSACTION_DATE') ||
      turn2.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_MISSING_TRANSACTION_DATE'),
      'Turn 2 must report IMAGE_MISSING_TRANSACTION_DATE'
    );
    assert.ok(
      turn2.scenarioState.pendingImageRejectionReasons?.some(r => r.code === 'IMAGE_MISSING_AMOUNT') ||
      turn2.scenarioState.missingFields?.some(f => f.fieldKey === 'imageGuardrail-IMAGE_MISSING_AMOUNT'),
      'Turn 2 must report IMAGE_MISSING_AMOUNT'
    );

    console.log('✓ 10R-2 (P1). Multi-document follow-up with ordinal facts cannot leak into a named missing document');
    passed++;
  }

  // 10R-3 (P2 — Pre-reference fact attribution, sentence boundaries, fail-closed ambiguity, and end-to-end follow-up)
  {
    const p2TwoSent = 'INV-101 is unchanged. The amount S$300 and date 20/01/2025 are for INV-202.';
    const f101 = extractDocAttributedTextFacts(p2TwoSent, new Set(['101']), false);
    const f202 = extractDocAttributedTextFacts(p2TwoSent, new Set(['202']), false);
    assert.equal(f101.date, '', 'INV-101 must NOT steal INV-202 date across sentence boundary');
    assert.equal(f101.amountsCents.size, 0, 'INV-101 must NOT steal INV-202 amount across sentence boundary');
    assert.equal(f202.date, '20/01/2025', 'INV-202 must receive its preceding date 20/01/2025');
    assert.deepEqual(Array.from(f202.amountsCents), [30000], 'INV-202 must receive its preceding amount S$300');

    const p2OneSent = 'INV-101 is unchanged, and the amount S$300 and date 20/01/2025 are for INV-202.';
    assert.equal(extractDocAttributedTextFacts(p2OneSent, new Set(['101']), false).amountsCents.size, 0);
    assert.equal(extractDocAttributedTextFacts(p2OneSent, new Set(['202']), false).date, '20/01/2025');
    assert.deepEqual(Array.from(extractDocAttributedTextFacts(p2OneSent, new Set(['202']), false).amountsCents), [30000]);

    const p2AppositiveComma = 'INV-101 is unchanged, and the amount S$300, dated 20/01/2025, is for INV-202.';
    assert.equal(extractDocAttributedTextFacts(p2AppositiveComma, new Set(['101']), false).date, '');
    assert.equal(extractDocAttributedTextFacts(p2AppositiveComma, new Set(['101']), false).amountsCents.size, 0);
    assert.equal(extractDocAttributedTextFacts(p2AppositiveComma, new Set(['202']), false).date, '20/01/2025');
    assert.deepEqual(Array.from(extractDocAttributedTextFacts(p2AppositiveComma, new Set(['202']), false).amountsCents), [30000]);

    const p2BothPre = 'S$500 on 15/01/2025 is for INV-101, and S$300 on 20/01/2025 is for INV-202.';
    assert.equal(extractDocAttributedTextFacts(p2BothPre, new Set(['101']), false).date, '15/01/2025');
    assert.deepEqual(Array.from(extractDocAttributedTextFacts(p2BothPre, new Set(['101']), false).amountsCents), [50000]);
    assert.equal(extractDocAttributedTextFacts(p2BothPre, new Set(['202']), false).date, '20/01/2025');
    assert.deepEqual(Array.from(extractDocAttributedTextFacts(p2BothPre, new Set(['202']), false).amountsCents), [30000]);

    const p2WhileFor = 'For INV-101, the date is 15/01/2025 and the amount is S$500, while for INV-202 the date is 20/01/2025 and the amount is S$300.';
    assert.equal(extractDocAttributedTextFacts(p2WhileFor, new Set(['101']), false).date, '15/01/2025');
    assert.deepEqual(Array.from(extractDocAttributedTextFacts(p2WhileFor, new Set(['101']), false).amountsCents), [50000]);
    assert.equal(extractDocAttributedTextFacts(p2WhileFor, new Set(['202']), false).date, '20/01/2025');
    assert.deepEqual(Array.from(extractDocAttributedTextFacts(p2WhileFor, new Set(['202']), false).amountsCents), [30000]);

    const p2NoAbbr = 'Invoice No. ABC123 is S$500 on 15/01/2025. The amount S$300 and date 20/01/2025 are for Invoice No. DEF456.';
    assert.equal(extractDocAttributedTextFacts(p2NoAbbr, new Set(['abc123']), false).date, '15/01/2025');
    assert.deepEqual(Array.from(extractDocAttributedTextFacts(p2NoAbbr, new Set(['abc123']), false).amountsCents), [50000]);
    assert.equal(extractDocAttributedTextFacts(p2NoAbbr, new Set(['def456']), false).date, '20/01/2025');
    assert.deepEqual(Array.from(extractDocAttributedTextFacts(p2NoAbbr, new Set(['def456']), false).amountsCents), [30000]);

    // Ambiguous conjoined pairings must fail closed
    for (const ambigText of [
      'Here are INV-101 and INV-202 dated 15/01/2025 for S$500.',
      'S$300 on 20/01/2025 is for INV-101 and INV-202.',
      'INV-101 S$300 for INV-202'
    ]) {
      const a1 = extractDocAttributedTextFacts(ambigText, new Set(['101']), false);
      const a2 = extractDocAttributedTextFacts(ambigText, new Set(['202']), false);
      assert.equal(a1.date, '', `Ambiguous "${ambigText}" must fail closed for INV-101 date`);
      assert.equal(a1.amountsCents.size, 0, `Ambiguous "${ambigText}" must fail closed for INV-101 amount`);
      assert.equal(a2.date, '', `Ambiguous "${ambigText}" must fail closed for INV-202 date`);
      assert.equal(a2.amountsCents.size, 0, `Ambiguous "${ambigText}" must fail closed for INV-202 amount`);
    }

    // resolveTargetPendingImageIndices unit check on P2 phrasing
    const pendingPair = [
      { imageId: 'img-a', fields: [{ field: 'invoiceNo', value: 'INV-101' }, { field: 'invoiceDate', value: '15/01/2025' }, { field: 'totalAmount', value: 500 }] },
      { imageId: 'img-b', fields: [{ field: 'invoiceNo', value: 'INV-202' }] }
    ];
    assert.deepEqual(resolveTargetPendingImageIndices(pendingPair, p2TwoSent, 'date'), [1], 'Date target must resolve only to INV-202');
    assert.deepEqual(resolveTargetPendingImageIndices(pendingPair, p2TwoSent, 'amount'), [1], 'Amount target must resolve only to INV-202');

    // End-to-end Turn 1 -> Turn 2 with "INV-101 is unchanged. The amount S$300 and date 20/01/2025 are for INV-202."
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Two Pending Invoices',
                directGroups: [
                  {
                    id: 'grp-r3-101',
                    eventDate: '15/01/2025',
                    title: 'Invoice INV-101',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                    ]
                  },
                  {
                    id: 'grp-r3-202',
                    eventDate: '15/01/2025',
                    title: 'Invoice INV-202',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Maintenance Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                    ]
                  }
                ],
                imageEvidence: [
                  {
                    imageId: 'img-10r3-101',
                    fields: { invoiceDate: '15/01/2025', invoiceNo: 'INV-101', totalAmount: 500 },
                    journalLines: []
                  },
                  {
                    imageId: 'img-10r3-202',
                    fields: { invoiceNo: 'INV-202' },
                    journalLines: []
                  }
                ]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const r3Turn1 = await processAccountingQuery(
      'Two invoices attached.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [
        {
          sender: 'user',
          text: 'Two invoices attached.',
          images: [
            { id: 'img-10r3-101', dataUrl: 'data:image/png;base64,mock101', mimeType: 'image/png' },
            { id: 'img-10r3-202', dataUrl: 'data:image/png;base64,mock202', mimeType: 'image/png' }
          ]
        }
      ]
    );
    assert.equal(r3Turn1.scenarioState.committedDirectGroups?.length || 0, 0, 'Turn 1 must hold in pending');

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Two Resolved Invoices',
                directGroups: [
                  {
                    id: 'grp-r3-101',
                    eventDate: '15/01/2025',
                    title: 'Invoice INV-101',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                    ]
                  },
                  {
                    id: 'grp-r3-202',
                    eventDate: '20/01/2025',
                    title: 'Invoice INV-202',
                    totalDebit: 300,
                    totalCredit: 300,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Maintenance Expense', category: 'EXPENSE', debit: 300, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 300 }
                    ]
                  }
                ]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const r3Turn2 = await processAccountingQuery(
      'INV-101 is unchanged. The amount S$300 and date 20/01/2025 are for INV-202.',
      r3Turn1.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );

    assert.equal(r3Turn2.scenarioState.committedDirectGroups?.length, 2, 'Turn 2 must commit both INV-101 and INV-202');
    assert.equal(r3Turn2.scenarioState.committedDirectGroups[0].eventDate, '15/01/2025', 'INV-101 date must stay 15/01/2025');
    assert.equal(r3Turn2.scenarioState.committedDirectGroups[0].totalDebit, 500, 'INV-101 amount must stay 500');
    assert.equal(r3Turn2.scenarioState.committedDirectGroups[1].eventDate, '20/01/2025', 'INV-202 date must become 20/01/2025');
    assert.equal(r3Turn2.scenarioState.committedDirectGroups[1].totalDebit, 300, 'INV-202 amount must become 300');

    // End-to-end alphabetic document reference ("Invoice No. ALPHA")
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Alphabetic & Alphanumeric Invoices',
                directGroups: [
                  {
                    id: 'grp-r3-abc123',
                    eventDate: '15/01/2025',
                    title: 'Invoice No. ABC123',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                    ]
                  },
                  {
                    id: 'grp-r3-alpha',
                    eventDate: '20/01/2025',
                    title: 'Invoice No. ALPHA',
                    totalDebit: 300,
                    totalCredit: 300,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Maintenance Expense', category: 'EXPENSE', debit: 300, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 300 }
                    ]
                  }
                ],
                imageEvidence: [
                  {
                    imageId: 'img-r3-abc123',
                    fields: { invoiceDate: '15/01/2025', invoiceNo: 'ABC123', totalAmount: 500 },
                    journalLines: []
                  },
                  {
                    imageId: 'img-r3-alpha',
                    fields: { invoiceNo: 'ALPHA' },
                    journalLines: []
                  }
                ]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const alphaTurn1 = await processAccountingQuery(
      'Attached Invoice No. ABC123 and Invoice No. ALPHA.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [
        {
          sender: 'user',
          text: 'Attached Invoice No. ABC123 and Invoice No. ALPHA.',
          images: [
            { id: 'img-r3-abc123', dataUrl: 'data:image/png;base64,mockabc', mimeType: 'image/png' },
            { id: 'img-r3-alpha', dataUrl: 'data:image/png;base64,mockalpha', mimeType: 'image/png' }
          ]
        }
      ]
    );
    assert.equal(alphaTurn1.scenarioState.committedDirectGroups?.length || 0, 0, 'Alpha Turn 1 must hold pending');

    const alphaTurn2 = await processAccountingQuery(
      'Invoice No. ABC123 is unchanged. The amount S$300 and date 20/01/2025 are for Invoice No. ALPHA.',
      alphaTurn1.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );
    assert.equal(alphaTurn2.scenarioState.committedDirectGroups?.length, 2, 'Alpha Turn 2 must commit both Invoice No. ABC123 and Invoice No. ALPHA');
    assert.equal(alphaTurn2.scenarioState.committedDirectGroups[1].eventDate, '20/01/2025', 'Invoice No. ALPHA must receive 20/01/2025');
    assert.equal(alphaTurn2.scenarioState.committedDirectGroups[1].totalDebit, 300, 'Invoice No. ALPHA must receive S$300');

    // Cross-document amount collision: INV-101 is S$500, INV-202 is S$300 (with invalid date),
    // and user updates INV-202 to S$500 (same as INV-101's amount) and date 20/01/2025
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Two Pending Invoices Collision',
                directGroups: [
                  {
                    id: 'grp-col-101',
                    eventDate: '15/01/2025',
                    title: 'Invoice INV-101',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                    ]
                  },
                  {
                    id: 'grp-col-202',
                    eventDate: '29/02/2025',
                    title: 'Invoice INV-202',
                    totalDebit: 300,
                    totalCredit: 300,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Maintenance Expense', category: 'EXPENSE', debit: 300, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 300 }
                    ]
                  }
                ],
                imageEvidence: [
                  {
                    imageId: 'img-col-101',
                    fields: { invoiceDate: '15/01/2025', invoiceNo: 'INV-101', totalAmount: 500 },
                    journalLines: [
                      { accountName: 'Office Supplies Expense', debit: 500, credit: 0 },
                      { accountName: 'Trade Payables', debit: 0, credit: 500 }
                    ]
                  },
                  {
                    imageId: 'img-col-202',
                    fields: { invoiceDate: '29/02/2025', invoiceNo: 'INV-202', totalAmount: 300 },
                    journalLines: [
                      { accountName: 'Maintenance Expense', debit: 300, credit: 0 },
                      { accountName: 'Trade Payables', debit: 0, credit: 300 }
                    ]
                  }
                ]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const colTurn1 = await processAccountingQuery(
      'Attached INV-101 and INV-202.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [
        {
          sender: 'user',
          text: 'Attached INV-101 and INV-202.',
          images: [
            { id: 'img-col-101', dataUrl: 'data:image/png;base64,mockc1', mimeType: 'image/png' },
            { id: 'img-col-202', dataUrl: 'data:image/png;base64,mockc2', mimeType: 'image/png' }
          ]
        }
      ]
    );
    assert.equal(colTurn1.scenarioState.committedDirectGroups?.length || 0, 0, 'Collision Turn 1 must hold in pending');

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                responseKind: 'JOURNAL_ENTRY',
                transactionTitle: 'Two Resolved Invoices Collision',
                directGroups: [
                  {
                    id: 'grp-col-101',
                    eventDate: '15/01/2025',
                    title: 'Invoice INV-101',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                    ]
                  },
                  {
                    id: 'grp-col-202',
                    eventDate: '20/01/2025',
                    title: 'Invoice INV-202',
                    totalDebit: 500,
                    totalCredit: 500,
                    isBalanced: true,
                    lines: [
                      { accountName: 'Maintenance Expense', category: 'EXPENSE', debit: 500, credit: 0 },
                      { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
                    ]
                  }
                ]
              })
            }]
          }
        }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 }
      })
    });

    const colTurn2 = await processAccountingQuery(
      'For INV-202, the correct amount is S$500 and date is 20/01/2025.',
      colTurn1.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );
    assert.equal(colTurn2.scenarioState.committedDirectGroups?.length, 2, 'Cross-doc amount collision Turn 2 must commit both invoices');
    assert.equal(colTurn2.scenarioState.committedDirectGroups[1].eventDate, '20/01/2025', 'INV-202 must update to 20/01/2025');
    assert.equal(colTurn2.scenarioState.committedDirectGroups[1].totalDebit, 500, 'INV-202 must update from S$300 to S$500 even though INV-101 already had S$500');

    console.log('✓ 10R-3 (P2). Pre-reference facts ("for INV-202"), sentence boundaries, fail-closed ambiguity, and alphabetic doc refs verified');
    passed++;
  }

  // 10R-4 (P1/P2 — Negative/unrelated doc associations, !/? & internal conjunctions, and multiline/headed blocks)
  {
    const pendingPair = [
      { imageId: 'img-r4-a', fields: [{ field: 'invoiceNo', value: 'INV-101' }, { field: 'invoiceDate', value: '15/01/2025' }, { field: 'totalAmount', value: 500 }] },
      { imageId: 'img-r4-b', fields: [{ field: 'invoiceNo', value: 'INV-202' }] }
    ];

    // 1. Finding 1 (P1): Negative / unrelated document associations & ordinal + doc ref in same clause
    for (const negCase of [
      'The first screenshot S$500 on 15/01/2025 is unrelated to INV-202.',
      'The first screenshot S$500 on 15/01/2025 is not for INV-202.',
      'S$500 on 15/01/2025 is unrelated to INV-202.',
      'S$500 on 15/01/2025 does not belong to INV-202.',
      'INV-202 is unrelated to the first screenshot S$500 on 15/01/2025.',
      'INV-202 is not S$500 on 15/01/2025.'
    ]) {
      const f202 = extractDocAttributedTextFacts(negCase, new Set(['202']), false);
      assert.equal(f202.date, '', `Negative/unrelated "${negCase}" must NOT attribute date to INV-202`);
      assert.equal(f202.amountsCents.size, 0, `Negative/unrelated "${negCase}" must NOT attribute amount to INV-202`);
      assert.deepEqual(resolveTargetPendingImageIndices(pendingPair, negCase, 'date'), [], `Date target must be empty for "${negCase}"`);
      assert.deepEqual(resolveTargetPendingImageIndices(pendingPair, negCase, 'amount'), [], `Amount target must be empty for "${negCase}"`);
    }

    for (const posNegPair of [
      'S$500 on 15/01/2025 is for INV-101, not INV-202.',
      'INV-101 S$500 on 15/01/2025 is unrelated to INV-202.'
    ]) {
      const f101 = extractDocAttributedTextFacts(posNegPair, new Set(['101']), false);
      const f202 = extractDocAttributedTextFacts(posNegPair, new Set(['202']), false);
      assert.equal(f101.date, '15/01/2025', `INV-101 must receive date in "${posNegPair}"`);
      assert.deepEqual(Array.from(f101.amountsCents), [50000], `INV-101 must receive amount in "${posNegPair}"`);
      assert.equal(f202.date, '', `INV-202 must NOT receive date in "${posNegPair}"`);
      assert.equal(f202.amountsCents.size, 0, `INV-202 must NOT receive amount in "${posNegPair}"`);
    }

    const negPrefixWithPositiveRelative = 'The first screenshot S$500 on 15/01/2025 is unrelated to INV-202, which is S$300 on 20/01/2025.';
    const fRel202 = extractDocAttributedTextFacts(negPrefixWithPositiveRelative, new Set(['202']), false);
    assert.equal(fRel202.date, '20/01/2025', 'INV-202 must receive positive relative clause date 20/01/2025');
    assert.deepEqual(Array.from(fRel202.amountsCents), [30000], 'INV-202 must receive ONLY positive relative clause amount S$300');

    // End-to-end Turn 1 -> Turn 2 negative/unrelated follow-up
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Two Pending Invoices R4-F1',
      directGroups: [
        {
          id: 'grp-r4f1-101',
          eventDate: '15/01/2025',
          title: 'Invoice INV-101',
          totalDebit: 500,
          totalCredit: 500,
          isBalanced: true,
          lines: [
            { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
            { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
          ]
        },
        {
          id: 'grp-r4f1-202',
          eventDate: '15/01/2025',
          title: 'Invoice INV-202',
          totalDebit: 500,
          totalCredit: 500,
          isBalanced: true,
          lines: [
            { accountName: 'Maintenance Expense', category: 'EXPENSE', debit: 500, credit: 0 },
            { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
          ]
        }
      ],
      imageEvidence: [
        { imageId: 'img-r4f1-101', fields: { invoiceDate: '15/01/2025', invoiceNo: 'INV-101', totalAmount: 500 }, journalLines: [] },
        { imageId: 'img-r4f1-202', fields: { invoiceNo: 'INV-202' }, journalLines: [] }
      ]
    });

    const r4f1Turn1 = await processAccountingQuery(
      'Attached two invoices.',
      null,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite',
      [
        {
          sender: 'user',
          text: 'Attached two invoices.',
          images: [
            { id: 'img-r4f1-101', dataUrl: 'data:image/png;base64,mock101', mimeType: 'image/png' },
            { id: 'img-r4f1-202', dataUrl: 'data:image/png;base64,mock202', mimeType: 'image/png' }
          ]
        }
      ]
    );
    assert.equal(r4f1Turn1.scenarioState.committedDirectGroups?.length || 0, 0, 'R4-F1 Turn 1 must hold pending');

    const r4f1Turn2 = await processAccountingQuery(
      'The first screenshot S$500 on 15/01/2025 is unrelated to INV-202.',
      r4f1Turn1.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );
    assert.equal(r4f1Turn2.scenarioState.committedDirectGroups?.length || 0, 0, 'R4-F1 Turn 2 must NOT commit INV-202');
    const r4f1Pending202Fields = r4f1Turn2.scenarioState.pendingImageEvidence?.[1]?.fields || [];
    const r4f1Pending202List = Array.isArray(r4f1Pending202Fields)
      ? r4f1Pending202Fields
      : Object.entries(r4f1Pending202Fields).map(([field, value]) => ({ field, value }));
    assert.equal(r4f1Pending202List.some(f => /date/i.test(String(f.field || '')) && f.value), false, 'INV-202 must NOT receive 15/01/2025');
    assert.equal(r4f1Pending202List.some(f => /amount|total/i.test(String(f.field || '')) && Number(f.value) > 0), false, 'INV-202 must NOT receive 500');

    // 2. Finding 2 (P1): Sentence punctuation ! / ? and conjunctions inside amount/date descriptions
    const f2Cases = [
      'INV-101 is unchanged! The amount S$300 and date 20/01/2025 are for INV-202.',
      'Is INV-101 unchanged? The amount S$300 and date 20/01/2025 are for INV-202.',
      'INV-101 is unchanged, and the date 20/01/2025 and amount S$300 are for INV-202.',
      'INV-101 is unchanged and the amount S$300 and the date 20/01/2025 are for INV-202.',
      'INV-101 is unchanged: the amount S$300 and date 20/01/2025 are for INV-202.'
    ];
    for (const c of f2Cases) {
      const f101 = extractDocAttributedTextFacts(c, new Set(['101']), false);
      const f202 = extractDocAttributedTextFacts(c, new Set(['202']), false);
      assert.equal(f101.date, '', `INV-101 must NOT receive date in "${c}"`);
      assert.equal(f101.amountsCents.size, 0, `INV-101 must NOT receive amount in "${c}"`);
      assert.equal(f202.date, '20/01/2025', `INV-202 must receive 20/01/2025 in "${c}"`);
      assert.deepEqual(Array.from(f202.amountsCents), [30000], `INV-202 must receive S$300 in "${c}"`);
      assert.deepEqual(resolveTargetPendingImageIndices(pendingPair, c, 'date'), [1], `Date target must be INV-202 for "${c}"`);
      assert.deepEqual(resolveTargetPendingImageIndices(pendingPair, c, 'amount'), [1], `Amount target must be INV-202 for "${c}"`);
    }

    // End-to-end Turn 1 -> Turn 2 with "!" punctuation
    globalThis.fetch = async () => makeGeminiSuccessResponse({
      responseKind: 'JOURNAL_ENTRY',
      transactionTitle: 'Two Resolved Invoices R4-F2',
      directGroups: [
        {
          id: 'grp-r4f1-101',
          eventDate: '15/01/2025',
          title: 'Invoice INV-101',
          totalDebit: 500,
          totalCredit: 500,
          isBalanced: true,
          lines: [
            { accountName: 'Office Supplies Expense', category: 'EXPENSE', debit: 500, credit: 0 },
            { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 500 }
          ]
        },
        {
          id: 'grp-r4f1-202',
          eventDate: '20/01/2025',
          title: 'Invoice INV-202',
          totalDebit: 300,
          totalCredit: 300,
          isBalanced: true,
          lines: [
            { accountName: 'Maintenance Expense', category: 'EXPENSE', debit: 300, credit: 0 },
            { accountName: 'Trade Payables', category: 'LIABILITY', debit: 0, credit: 300 }
          ]
        }
      ]
    });

    const r4f2Turn2 = await processAccountingQuery(
      'INV-101 is unchanged! The amount S$300 and date 20/01/2025 are for INV-202.',
      r4f1Turn1.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );
    assert.equal(r4f2Turn2.scenarioState.committedDirectGroups?.length, 2, 'R4-F2 Turn 2 must commit both INV-101 and INV-202');
    assert.equal(r4f2Turn2.scenarioState.committedDirectGroups[0].eventDate, '15/01/2025', 'INV-101 date must stay 15/01/2025');
    assert.equal(r4f2Turn2.scenarioState.committedDirectGroups[0].totalDebit, 500, 'INV-101 amount must stay S$500');
    assert.equal(r4f2Turn2.scenarioState.committedDirectGroups[1].eventDate, '20/01/2025', 'INV-202 date must become 20/01/2025');
    assert.equal(r4f2Turn2.scenarioState.committedDirectGroups[1].totalDebit, 300, 'INV-202 amount must become S$300');

    // 3. Finding 3 (P2): Multiline and headed block invoice corrections
    const multilineSingleBlock = 'INV-202:\nDate: 20/01/2025\nAmount: S$300';
    assert.equal(extractDocAttributedTextFacts(multilineSingleBlock, new Set(['101']), false).date, '');
    assert.equal(extractDocAttributedTextFacts(multilineSingleBlock, new Set(['101']), false).amountsCents.size, 0);
    assert.equal(extractDocAttributedTextFacts(multilineSingleBlock, new Set(['202']), false).date, '20/01/2025');
    assert.deepEqual(Array.from(extractDocAttributedTextFacts(multilineSingleBlock, new Set(['202']), false).amountsCents), [30000]);
    assert.deepEqual(resolveTargetPendingImageIndices(pendingPair, multilineSingleBlock, 'date'), [1]);
    assert.deepEqual(resolveTargetPendingImageIndices(pendingPair, multilineSingleBlock, 'amount'), [1]);

    for (const twoBlock of [
      'INV-101:\nDate: 15/01/2025\nAmount: S$500\n\nINV-202:\nDate: 20/01/2025\nAmount: S$300',
      'INV-101:\nDate: 15/01/2025\nAmount: S$500\nINV-202:\nDate: 20/01/2025\nAmount: S$300',
      'INV-101: Date: 15/01/2025, Amount: S$500 INV-202: Date: 20/01/2025, Amount: S$300'
    ]) {
      const f101 = extractDocAttributedTextFacts(twoBlock, new Set(['101']), false);
      const f202 = extractDocAttributedTextFacts(twoBlock, new Set(['202']), false);
      assert.equal(f101.date, '15/01/2025', `INV-101 must get ONLY 15/01/2025 in "${twoBlock}"`);
      assert.deepEqual(Array.from(f101.amountsCents), [50000], `INV-101 must get ONLY S$500 in "${twoBlock}"`);
      assert.equal(f202.date, '20/01/2025', `INV-202 must get ONLY 20/01/2025 in "${twoBlock}"`);
      assert.deepEqual(Array.from(f202.amountsCents), [30000], `INV-202 must get ONLY S$300 in "${twoBlock}"`);
    }

    for (const singleHeaded of [
      'INV-202: Date: 20/01/2025 Amount: S$300',
      'INV-202: Date: 20/01/2025; Amount: S$300'
    ]) {
      const f202 = extractDocAttributedTextFacts(singleHeaded, new Set(['202']), false);
      assert.equal(f202.date, '20/01/2025', `Headed block "${singleHeaded}" must attribute date to INV-202`);
      assert.deepEqual(Array.from(f202.amountsCents), [30000], `Headed block "${singleHeaded}" must attribute amount to INV-202`);
    }

    // Guard checks: non-header prose and blank line after headed block must not leak in multi-doc scenario
    const nonHeaderProse = 'INV-101 is unchanged.\nDate: 20/01/2025\nAmount: S$300';
    assert.equal(extractDocAttributedTextFacts(nonHeaderProse, new Set(['101']), false).date, '', 'Non-header prose must NOT attribute following lines to INV-101');
    assert.equal(extractDocAttributedTextFacts(nonHeaderProse, new Set(['101']), false).amountsCents.size, 0, 'Non-header prose must NOT attribute following line amount to INV-101');

    const blankLineAfterBlock = 'INV-101:\nDate: 15/01/2025\n\nAmount: S$300';
    const fBlank101 = extractDocAttributedTextFacts(blankLineAfterBlock, new Set(['101']), false);
    assert.equal(fBlank101.date, '15/01/2025', 'Line before blank line belongs to INV-101');
    assert.equal(fBlank101.amountsCents.size, 0, 'Line after blank line must NOT attribute to INV-101 in multi-doc scenario');

    // End-to-end Turn 1 -> Turn 2 with multiline headed block
    const r4f3Turn2 = await processAccountingQuery(
      'INV-202:\nDate: 20/01/2025\nAmount: S$300',
      r4f1Turn1.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );
    assert.equal(r4f3Turn2.scenarioState.committedDirectGroups?.length, 2, 'R4-F3 Turn 2 multiline block must commit both INV-101 and INV-202');
    assert.equal(r4f3Turn2.scenarioState.committedDirectGroups[0].eventDate, '15/01/2025', 'INV-101 date must stay 15/01/2025');
    assert.equal(r4f3Turn2.scenarioState.committedDirectGroups[0].totalDebit, 500, 'INV-101 amount must stay S$500');
    assert.equal(r4f3Turn2.scenarioState.committedDirectGroups[1].eventDate, '20/01/2025', 'INV-202 date must become 20/01/2025');
    assert.equal(r4f3Turn2.scenarioState.committedDirectGroups[1].totalDebit, 300, 'INV-202 amount must become S$300');

    // Also verify label-free multiline headed block ("INV-202:\n20/01/2025\nS$300")
    const r4f3LabelFree = await processAccountingQuery(
      'INV-202:\n20/01/2025\nS$300',
      r4f1Turn1.scenarioState,
      'SFRS_I',
      'test-gemini-key-long-enough-12345',
      'gemini-3.5-flash-lite'
    );
    assert.equal(r4f3LabelFree.scenarioState.committedDirectGroups?.length, 2, 'R4-F3 label-free multiline block must commit both INV-101 and INV-202');
    assert.equal(r4f3LabelFree.scenarioState.committedDirectGroups[1].eventDate, '20/01/2025', 'INV-202 date must become 20/01/2025');
    assert.equal(r4f3LabelFree.scenarioState.committedDirectGroups[1].totalDebit, 300, 'INV-202 amount must become S$300');

    // 4. Reviewer edge-case regressions (Findings 1–5)
    // Edge case 1: Negated clause after boundary in multi-doc sentence must not leak to Doc 1 or Doc 2
    const negAfterBoundary = 'INV-101 is unchanged, and S$300 on 20/01/2025 is unrelated to INV-202.';
    assert.equal(extractDocAttributedTextFacts(negAfterBoundary, new Set(['101']), false).date, '', 'INV-101 must NOT receive negated date 20/01/2025');
    assert.equal(extractDocAttributedTextFacts(negAfterBoundary, new Set(['101']), false).amountsCents.size, 0, 'INV-101 must NOT receive negated amount S$300');
    assert.equal(extractDocAttributedTextFacts(negAfterBoundary, new Set(['202']), false).date, '', 'INV-202 must NOT receive negated date 20/01/2025');
    assert.equal(extractDocAttributedTextFacts(negAfterBoundary, new Set(['202']), false).amountsCents.size, 0, 'INV-202 must NOT receive negated amount S$300');

    const sameDocNegWhereas = 'INV-202 is S$300, whereas S$500 on 15/01/2025 is unrelated to INV-202.';
    const fSameDocNeg = extractDocAttributedTextFacts(sameDocNegWhereas, new Set(['202']), false);
    assert.equal(fSameDocNeg.date, '', 'INV-202 must NOT receive negated date 15/01/2025');
    assert.deepEqual(Array.from(fSameDocNeg.amountsCents), [30000], 'INV-202 must receive ONLY S$300');

    const bareAndNegUnrelated = 'INV-101 is S$500 and the date 20/01/2025 is unrelated to INV-202.';
    assert.equal(extractDocAttributedTextFacts(bareAndNegUnrelated, new Set(['101']), false).date, '', 'INV-101 must NOT receive unrelated date 20/01/2025 across bare and');
    assert.deepEqual(Array.from(extractDocAttributedTextFacts(bareAndNegUnrelated, new Set(['101']), false).amountsCents), [50000], 'INV-101 must receive S$500');
    assert.equal(extractDocAttributedTextFacts(bareAndNegUnrelated, new Set(['202']), false).date, '', 'INV-202 must NOT receive unrelated date 20/01/2025');

    // Edge case 2: Comma inside negated/imperative beforeDoc + additional negative participles
    for (const negCommaOrParticiple of [
      'S$500, dated 15/01/2025 is unrelated to INV-202.',
      "Don't use S$500, dated 15/01/2025, for INV-202.",
      'S$500 on 15/01/2025 is not associated with INV-202.',
      'S$500 on 15/01/2025 is not meant for INV-202.',
      'S$500 on 15/01/2025 is not intended for INV-202.'
    ]) {
      const f = extractDocAttributedTextFacts(negCommaOrParticiple, new Set(['202']), false);
      assert.equal(f.date, '', `Must reject negated date in "${negCommaOrParticiple}"`);
      assert.equal(f.amountsCents.size, 0, `Must reject negated amount in "${negCommaOrParticiple}"`);
    }

    // Edge case 3: Complementary single-fact clauses across two documents
    const comp1 = 'INV-101 is S$500 and the date 20/01/2025 is for INV-202.';
    assert.equal(extractDocAttributedTextFacts(comp1, new Set(['101']), false).date, '', 'INV-101 must NOT receive 20/01/2025 in comp1');
    assert.deepEqual(Array.from(extractDocAttributedTextFacts(comp1, new Set(['101']), false).amountsCents), [50000], 'INV-101 must receive S$500 in comp1');
    assert.equal(extractDocAttributedTextFacts(comp1, new Set(['202']), false).date, '20/01/2025', 'INV-202 must receive 20/01/2025 in comp1');
    assert.equal(extractDocAttributedTextFacts(comp1, new Set(['202']), false).amountsCents.size, 0, 'INV-202 must NOT receive S$500 in comp1');

    const comp2 = 'INV-101 is dated 15/01/2025 and the amount S$300 is for INV-202.';
    assert.equal(extractDocAttributedTextFacts(comp2, new Set(['101']), false).date, '15/01/2025', 'INV-101 must receive 15/01/2025 in comp2');
    assert.equal(extractDocAttributedTextFacts(comp2, new Set(['101']), false).amountsCents.size, 0, 'INV-101 must NOT receive S$300 in comp2');
    assert.equal(extractDocAttributedTextFacts(comp2, new Set(['202']), false).date, '', 'INV-202 must NOT receive 15/01/2025 in comp2');
    assert.deepEqual(Array.from(extractDocAttributedTextFacts(comp2, new Set(['202']), false).amountsCents), [30000], 'INV-202 must receive S$300 in comp2');

    const comp3 = 'For INV-101, S$500 and the date 20/01/2025 is for INV-202.';
    assert.equal(extractDocAttributedTextFacts(comp3, new Set(['101']), false).date, '', 'INV-101 must NOT receive 20/01/2025 in comp3');
    assert.deepEqual(Array.from(extractDocAttributedTextFacts(comp3, new Set(['101']), false).amountsCents), [50000], 'INV-101 must receive S$500 in comp3');
    assert.equal(extractDocAttributedTextFacts(comp3, new Set(['202']), false).date, '20/01/2025', 'INV-202 must receive 20/01/2025 in comp3');
    assert.equal(extractDocAttributedTextFacts(comp3, new Set(['202']), false).amountsCents.size, 0, 'INV-202 must NOT receive S$500 in comp3');

    // Edge case 4: Conflict-override phrases ("not <amount>" / "instead of <amount>")
    const overrideNotAmt = 'For INV-202, the correct amount is S$600, not S$500.';
    assert.deepEqual(Array.from(extractDocAttributedTextFacts(overrideNotAmt, new Set(['202']), false).amountsCents), [60000], 'INV-202 must keep S$600 and drop negated S$500');

    const overrideNotAmtAndDate = 'INV-202 is S$300, not S$500 on 15/01/2025.';
    const fOverride2 = extractDocAttributedTextFacts(overrideNotAmtAndDate, new Set(['202']), false);
    assert.equal(fOverride2.date, '', 'INV-202 must drop negated date 15/01/2025');
    assert.deepEqual(Array.from(fOverride2.amountsCents), [30000], 'INV-202 must keep S$300 and drop negated S$500');

    const overrideInsteadOf = 'INV-202 is S$600 instead of S$500.';
    assert.deepEqual(Array.from(extractDocAttributedTextFacts(overrideInsteadOf, new Set(['202']), false).amountsCents), [60000], 'INV-202 must keep S$600 and drop "instead of S$500"');

    // Edge case 5: Active headed block interrupted by "; ... , and INV-202:"
    const semicolonAndHeaded = 'INV-101: Date: 15/01/2025; Amount: S$500, and INV-202: Date: 20/01/2025; Amount: S$300';
    const fSemi101 = extractDocAttributedTextFacts(semicolonAndHeaded, new Set(['101']), false);
    const fSemi202 = extractDocAttributedTextFacts(semicolonAndHeaded, new Set(['202']), false);
    assert.equal(fSemi101.date, '15/01/2025', 'INV-101 must receive 15/01/2025');
    assert.deepEqual(Array.from(fSemi101.amountsCents), [50000], 'INV-101 must receive S$500 before ", and INV-202:"');
    assert.equal(fSemi202.date, '20/01/2025', 'INV-202 must receive 20/01/2025');
    assert.deepEqual(Array.from(fSemi202.amountsCents), [30000], 'INV-202 must receive ONLY S$300');

    console.log('✓ 10R-4 (P1/P2). Negative/unrelated doc associations, !/? & internal conjunctions, and multiline/headed blocks verified');
    passed++;
  }

} finally {
  globalThis.fetch = origFetch;
}

console.log('\n=============================================================');
console.log(`ALL AI-FIRST DOUBLE-ENTRY REGRESSION TESTS PASSED! (${passed}/${passed} GREEN)`);
console.log('=============================================================');
