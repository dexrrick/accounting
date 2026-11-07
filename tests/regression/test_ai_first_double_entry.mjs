import assert from 'node:assert/strict';
import { processAccountingQuery, isMeaningfulAIJsonPayload } from '../../src/services/geminiService.ts';
import { repairAndParseAIJson } from '../../src/utils/jsonRepair.ts';
import {
  validateJournalGroups,
  inferAccountCategoryFromName,
  getMandatoryCategory,
  extractDerivableNumbers,
  buildDerivableCents
} from '../../src/verification/journalIntegrity.ts';
import { extractAccountingContext } from '../../src/services/conversationAccountingState.ts';
import {
  postProcessAIResponse,
  normalizeAccountCategory,
  buildGroundedReasoningContext,
  formatGroundedSystemPrompt,
  journalGroupFingerprint
} from '../../src/services/groundingContextBuilder.ts';

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
          fields: []
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
          fields: []
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
    assert.equal(res10E2.scenarioState.directGroups[0].totalDebit, 500);
    assert.equal(res10E2.scenarioState.directGroups[0].totalCredit, 500);

    console.log('✓ 10E. Image-based journals pass through final validation verified');
    passed++;
  }

} finally {
  globalThis.fetch = origFetch;
}

console.log('\n=============================================================');
console.log(`ALL AI-FIRST DOUBLE-ENTRY REGRESSION TESTS PASSED! (${passed}/${passed} GREEN)`);
console.log('=============================================================');
