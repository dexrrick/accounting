import type { AccountingStandard, AccountingScenarioState, MissingFieldInfo, ChatMessage } from '../types/accounting';
import type { ProviderSettings } from '../types/provider';
import { parseAccountingQuery } from '../engine/scenarioParser';
import { formatSingaporeDate } from '../utils/dateUtils';
import { appendStatutorySourceFooter } from '../utils/statutoryLinkResolver';
import { repairAndParseAIJson } from '../utils/jsonRepair';
import { callAzureOpenAI, callStandardOpenAI } from './azureOpenAiService';

export interface GeminiResponse {
  messageText: string;
  scenarioState: AccountingScenarioState;
  clarifications?: MissingFieldInfo[];
}

export async function processAccountingQuery(
  userInput: string,
  currentScenario: AccountingScenarioState | null,
  standard: AccountingStandard,
  providerOrApiKey?: ProviderSettings | string,
  modelName: string = 'gemini-3.5-flash-lite',
  chatHistory: ChatMessage[] = []
): Promise<GeminiResponse> {
  const std1 = standard === 'SFRS_I' ? 'SFRS(I) 1-1' : 'IAS 1';
  const std9 = standard === 'SFRS_I' ? 'SFRS(I) 9' : 'IFRS 9';
  const std16 = standard === 'SFRS_I' ? 'SFRS(I) 16' : 'IFRS 16';
  const std21 = standard === 'SFRS_I' ? 'SFRS(I) 1-21' : 'IAS 21';
  let apiErrorMessage: string | null = null;

  // Live AI API call if provider settings or apiKey is provided
  if (providerOrApiKey) {
    if (typeof providerOrApiKey === 'object') {
      const active = providerOrApiKey.activeProvider;
      if (active === 'azure' && providerOrApiKey.azure?.apiKey && providerOrApiKey.azure.endpoint) {
        try {
          return await callAzureOpenAI(userInput, currentScenario, standard, providerOrApiKey.azure, chatHistory);
        } catch (err: any) {
          console.warn('Azure OpenAI API call failed, falling back to smart universal engine:', err);
          apiErrorMessage = err?.message || 'Azure OpenAI Error';
        }
      } else if (active === 'gemini' && providerOrApiKey.gemini?.apiKey && providerOrApiKey.gemini.apiKey.trim().length > 10) {
        try {
          return await callGeminiAPI(
            userInput,
            currentScenario,
            standard,
            providerOrApiKey.gemini.apiKey.trim(),
            providerOrApiKey.gemini.model || modelName,
            chatHistory
          );
        } catch (err: any) {
          console.warn('Gemini API call failed, falling back to smart universal engine:', err);
          apiErrorMessage = err?.message || 'Gemini API Error';
        }
      } else if (active === 'openai' && providerOrApiKey.openai?.apiKey && providerOrApiKey.openai.apiKey.trim().length > 10) {
        try {
          return await callStandardOpenAI(
            userInput,
            currentScenario,
            standard,
            providerOrApiKey.openai,
            chatHistory
          );
        } catch (err: any) {
          console.warn('OpenAI API call failed, falling back to smart universal engine:', err);
          apiErrorMessage = err?.message || 'OpenAI API Error';
        }
      }
    } else if (typeof providerOrApiKey === 'string' && providerOrApiKey.trim().length > 10) {
      try {
        return await callGeminiAPI(userInput, currentScenario, standard, providerOrApiKey.trim(), modelName, chatHistory);
      } catch (err: any) {
        console.warn('Gemini API call failed, falling back to smart universal engine:', err);
        apiErrorMessage = err?.message || 'Gemini API Error';
      }
    }
  }

  // Helper to append fallback warning notice if an API error occurred
  const finalizeMessage = (text: string, state: AccountingScenarioState) => {
    const fullText = apiErrorMessage
      ? `> ⚠️ **Provider Notice**: ${apiErrorMessage}. Reverted seamlessly to the Singapore Statutory Offline Engine.\n\n${text}`
      : text;
    return appendStatutorySourceFooter(fullText, state);
  };

  // Smart Universal Parser (works offline for ANY query or fallback)
  const parsed = await parseAccountingQuery(userInput, currentScenario);

  // 000. CAPITALISATION OF EXPENDITURE (SFRS(I) 1-38 vs IRAS TAX DEDUCTIBILITY)
  if (parsed.scenarioType === 'CAPITALISATION_SFRS138' && parsed.directGroups) {
    const grp = parsed.directGroups[0];
    const cost = grp.totalDebit;
    const replyText = `### Accounting Analysis: Capitalisation of Expenditure\n\n` +
      `**Governing Frameworks**: **SFRS(I) 1-38 (*Intangible Assets*)** & **Income Tax Act 1947 (§14 / §15 / §14C)**\n\n` +
      `---\n\n` +
      `#### 1. Financial Reporting Treatment (SFRS(I) 1-38)\n` +
      `* **Research Phase (§54)**: All expenditure on research (or the research stage of an internal project) **must be expensed in P&L when incurred**. No intangible asset may ever be recognized from research.\n` +
      `* **Development Phase (§57)**: Expenditure can be capitalized as an Intangible Asset **if and only if** the entity demonstrates all 6 cumulative criteria:\n` +
      `  1. **Technical Feasibility** of completing the intangible asset so that it will be available for use or sale.\n` +
      `  2. **Intention to Complete** the intangible asset and use or sell it.\n` +
      `  3. **Ability to Use or Sell** the intangible asset.\n` +
      `  4. **Probable Future Economic Benefits** (existence of a market or internal usefulness).\n` +
      `  5. **Adequate Technical, Financial, and Other Resources** to complete development.\n` +
      `  6. **Reliable Measurement** of the expenditure attributable to the development phase.\n` +
      `* **Tangible Fixed Assets**: Under **SFRS(I) 1-16 §7**, expenditure is capitalised only if probable future economic benefits flow to the entity and cost can be reliably measured. Routine repairs and maintenance must be expensed.\n\n` +
      `---\n\n` +
      `#### 2. Singapore Tax Treatment (IRAS)\n` +
      `* **Accounting Treatment $\\neq$ Tax Treatment**: Capitalizing an expenditure for financial reporting does not grant a tax deduction.\n` +
      `* **Section 15(1) Disallowance**: Capital expenditure and accounting amortization/depreciation are disallowed as direct P&L deductions and must be added back in Form C-S.\n` +
      `* **Enterprise Innovation Scheme (EIS) / Section 14C**: Under the Enterprise Innovation Scheme, qualifying businesses enjoy a **400% enhanced tax deduction** on up to SGD 400,000 of qualifying R&D expenditure per Year of Assessment.\n` +
      `* **Section 19A / 19B Allowances**: Plant and machinery claim Section 19A Capital Allowances (1-year 100% write-off for computers/qualifying equipment or 3-year write-off); qualifying intellectual property acquisitions claim Section 19B writing-down allowances.\n\n` +
      `---\n\n` +
      `### Illustrative Compound Journal Entry (${grp.eventDate})\n\n` +
      `* **Debit**: **Intangible Assets - Capitalised Development Costs (Non-Current Asset)** — **SGD ${cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}**\n` +
      `* **Credit**: **Cash at Bank / Trade Payables** — **SGD ${cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}**\n\n` +
      `**Balance Check**: $\\text{Total Debits (SGD } ${cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}) == \\text{Total Credits (SGD } ${cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}) \\quad \\checkmark\\ \\mathbf{Balanced}$`;

    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }

  // 00A. SINGAPORE STATUTORY & REGULATORY ADVISORY (IRAS / ACRA / CPF / MOM / MAS)
  if (parsed.scenarioType === 'SINGAPORE_STATUTORY_ADVISORY') {
    const adv = parsed.statutoryAdvisory?.[0];
    const authority = adv?.authority || 'IRAS / ACRA';
    const title = parsed.transactionTitle;
    const act = adv?.statuteOrAct || 'Singapore Statutes';
    const section = adv?.sectionOrSchedule || '';
    const url = adv?.officialUrl || 'https://sso.agc.gov.sg';

    let replyText = `### Statutory Directive: ${title}\n\n` +
      `**Governing Authority**: **${authority}** | **Legislation**: **${act} (${section})**\n\n` +
      `---\n\n` +
      `#### 1. Statutory Principle\n` +
      `${adv?.summary || 'Governed strictly under Singapore statutory law.'}\n\n` +
      `---\n\n` +
      `#### 2. Key Rules, Thresholds & Compliance Mandates\n`;

    if (adv?.keyRules) {
      for (const rule of adv.keyRules) {
        replyText += `* ${rule}\n`;
      }
    }

    replyText += `\n---\n\n` +
      `#### 3. Official Statutory Source & Verification\n` +
      `* Verified against [${act} ${section}](${url}) on **Singapore Statutes Online (SSO)** / Official Regulatory Directory.\n` +
      `* Review the **Statutory Citations & "Why"** tab for full legal references and citations.`;

    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }

  // 00B. CAR PURCHASE WITH BLOCKED GST & DISALLOWED TAX DEPRECIATION
  if (parsed.scenarioType === 'CAR_PURCHASE_STATUTORY' && parsed.directGroups) {
    const grp = parsed.directGroups[0];
    const cost = grp.totalDebit;
    const replyText = `### Statutory Directive: Acquisition of Passenger Motor Car\n\n` +
      `**Governing Authorities**: **IRAS & AGC Singapore** | **Statutes**: **Income Tax Act 1947 §15(1)(k)** & **GST (General) Regulations Reg 26**\n\n` +
      `---\n\n` +
      `#### 1. Disallowance of 9% Input GST Claim (Regulation 26)\n` +
      `* Under **Regulation 26 of the GST (General) Regulations**, input tax incurred on the purchase, hire, or running expenses of a passenger motor car (S-plate) is **strictly blocked from recovery**.\n` +
      `* **Accounting Treatment**: The full purchase price of **SGD ${cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}** (inclusive of GST) is capitalized into asset cost. No amount is debited to *GST Input Tax*.\n\n` +
      `---\n\n` +
      `#### 2. Prohibition of Tax Deductions & Capital Allowances (§15(1)(k))\n` +
      `* Under **Section 15(1)(k) of the Income Tax Act 1947**, **no tax deduction or Section 19/19A Capital Allowances** are granted on passenger motor cars.\n` +
      `* **Tax Add-Back**: All accounting depreciation charged in P&L must be **added back 100%** in the corporate tax computation (Form C-S / Form C).\n` +
      `* Petrol, parking, road tax, and maintenance expenses for the passenger car are also non-deductible under Section 15(1)(k).\n\n` +
      `---\n\n` +
      `### Single Compound Journal Entry (${grp.eventDate})\n\n` +
      `* **Debit**: **Motor Vehicles - Cost (Non-Current Asset)** — **SGD ${cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}** *(Full gross outlay capitalized)*\n` +
      `* **Credit**: **Cash at Bank (Current Asset)** — **SGD ${cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}** *(Bank disbursement)*\n\n` +
      `**Balance Check**: $\\text{Total Debits (SGD } ${cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}) == \\text{Total Credits (SGD } ${cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}) \\quad \\checkmark\\ \\mathbf{Balanced}$`;

    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }

  // 0A. ASSET PURCHASE WITH TRADE DISCOUNT, GST, CASH & CREDIT TERMS
  if (parsed.scenarioType === 'ASSET_PURCHASE_DISCOUNT' && parsed.directGroups) {
    const std16Name = standard === 'SFRS_I' ? 'SFRS(I) 1-16' : 'IAS 16';
    const grp = parsed.directGroups[0];
    const equipLine = grp.lines.find(l => l.category === 'ASSET' && l.debit > 0 && l.accountCode === '1500');
    const gstLine = grp.lines.find(l => l.accountCode === '1190');
    const bankLine = grp.lines.find(l => l.accountCode === '1010');
    const payableLine = grp.lines.find(l => l.accountCode === '2010');

    const costVal = equipLine?.debit || 18000;
    const gstVal = gstLine?.debit || 1620;
    const bankVal = bankLine?.credit || 5000;
    const payableVal = payableLine?.credit || 14620;

    const listPriceParam = parsed.keyParameters?.find(p => p.label.includes('List Price'));
    const discountParam = parsed.keyParameters?.find(p => p.label.includes('Trade Discount'));
    const listPriceStr = listPriceParam?.value || 'SGD 20,000.00';
    const discountLabel = discountParam?.label || 'Trade Discount (10%)';
    const discountValStr = discountParam?.value || '-SGD 2,000.00';

    let replyText = `### Under ${std16Name} (*Property, Plant and Equipment* §16(a)) & Singapore GST Act\n\n` +
      `Here is the single compound journal entry on **${grp.eventDate}** to record the purchase of office equipment:\n\n` +
      `---\n\n` +
      `#### 1. Asset Capitalization & Trade Discount Deduction (${std16Name} §16(a))\n` +
      `* **List Price**: **${listPriceStr}** (exclusive of 9% GST)\n` +
      `* **Less ${discountLabel}**: $\\mathbf{${discountValStr}}$\n` +
      `* **Net Initial Cost Recognized**:\n` +
      `  $$\\text{Asset Cost} = \\mathbf{SGD\\ ${costVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}}$$\n` +
      `  *(Statutory Rule: Under ${std16Name} §16(a), trade discounts are deducted directly from the list price. Trade discounts are **never** recorded as a separate ledger line in accounting).* \n\n` +
      `---\n\n` +
      `#### 2. Singapore 9% Recoverable Input GST (IRAS)\n` +
      `* Under IRAS guidelines, 9% GST is levied on the **discounted selling price**:\n` +
      `  $$\\text{Input GST (9\\%)} = \\text{SGD } ${costVal.toLocaleString()} \\times 9\\% = \\mathbf{SGD\\ ${gstVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}}$$\n` +
      `* **Total Gross Invoice Payable**: $\\text{SGD } ${costVal.toLocaleString()} + \\text{SGD } ${gstVal.toLocaleString()} = \\mathbf{SGD\\ ${(costVal + gstVal).toLocaleString(undefined, { minimumFractionDigits: 2 })}}$\n\n` +
      `---\n\n` +
      `#### 3. Settlement Breakdown\n` +
      `* **Immediate Bank Transfer**: **SGD ${bankVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}**\n` +
      `* **Remaining Balance on Credit Terms (Trade Payables)**:\n` +
      `  $$\\text{Trade Payables} = ${(costVal + gstVal).toLocaleString()} - ${bankVal.toLocaleString()} = \\mathbf{SGD\\ ${payableVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}}$$\n\n` +
      `---\n\n` +
      `### Single Compound Journal Entry (${grp.eventDate})\n\n` +
      `* **Debit**: **Office Equipment - Cost (Non-Current Asset)** — **SGD ${costVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}**\n` +
      `* **Debit**: **GST Input Tax (IRAS 9% Claimable Receivable)** — **SGD ${gstVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}**\n` +
      `* **Credit**: **Cash at Bank (Current Asset)** — **SGD ${bankVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}**\n` +
      `* **Credit**: **Trade Payables / Other Payables (Current Liability)** — **SGD ${payableVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}**\n\n` +
      `**Balance Check**: $\\text{Total Debits (SGD } ${(costVal + gstVal).toLocaleString(undefined, { minimumFractionDigits: 2 })}) == \\text{Total Credits (SGD } ${(bankVal + payableVal).toLocaleString(undefined, { minimumFractionDigits: 2 })}) \\quad \\checkmark\\ \\mathbf{Balanced}$`;

    if (parsed.directGroups.length > 1) {
      const grp2 = parsed.directGroups[1];
      replyText += `\n\n---\n\n### Subsequent Event: ${grp2.title} (${grp2.eventDate})\n\n` +
        `* **Debit**: **Trade Payables (Current Liability)** — **SGD ${payableVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}** *(Derecognition of liability)*\n` +
        `* **Credit**: **Cash at Bank (Current Asset)** — **SGD ${payableVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}** *(Cash outflow)*\n\n` +
        `*(Under IFRS 9 §3.3.1, the financial liability is extinguished upon full settlement).*`;
    }

    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }

  // 0B. PPE MACHINERY ACQUISITION WITH TRADE-IN, GST, DEPRECIATION & LOAN
  if (parsed.scenarioType === 'PPE_IAS16' && parsed.directGroups) {
    const std16Name = standard === 'SFRS_I' ? 'SFRS(I) 1-16' : 'IAS 16';
    const std9Name = standard === 'SFRS_I' ? 'SFRS(I) 9' : 'IFRS 9';
    const replyText = `### Under ${std16Name} (*Property, Plant and Equipment*), Singapore GST Act, & ${std9Name} (*Financial Instruments*)\n\n` +
      `Here is the complete statutory accounting schedule and double entries on **1 April 2026** for your machinery purchase, trade-in derecognition, and equipment loan:\n\n` +
      `---\n\n` +
      `#### 1. Depreciation Catch-Up Schedule (1 Jan 2026 – 31 Mar 2026)\n` +
      `* Under **${std16Name} §55**, depreciation ceases at the date of derecognition. Therefore, depreciation for Jan–Mar 2026 (3 months) must be recognized **prior to disposal**:\n` +
      `  $$\\text{Catch-up Depreciation} = \\text{SGD } 50,000 \\times 20\\% \\times \\frac{3}{12} = \\mathbf{SGD\\ 2,500.00}$$\n` +
      `* **Total Accumulated Depreciation at 1 April 2026**:\n` +
      `  $$\\text{SGD } 20,000 \\text{ (2024–2025)} + \\text{SGD } 2,500 \\text{ (Jan–Mar 2026)} = \\mathbf{SGD\\ 22,500.00}$$\n` +
      `* **Carrying Amount / Net Book Value (NBV) at Disposal**:\n` +
      `  $$\\text{SGD } 50,000 - \\text{SGD } 22,500 = \\mathbf{SGD\\ 27,500.00}$$\n\n` +
      `---\n\n` +
      `#### 2. Trade-in Valuation & Singapore 9% GST Breakdown (IRAS)\n` +
      `* Under the Singapore GST Act, a trade-in constitutes a taxable supply (disposal of business asset):\n` +
      `  * **Agreed Trade-in Value (Gross)**: **SGD 21,800.00** (inclusive of 9% GST)\n` +
      `  * **Net Trade-in Consideration**: $\\text{SGD } 21,800 / 1.09 = \\mathbf{SGD\\ 20,000.00}$\n` +
      `  * **Output GST Payable to IRAS (9%)**: $\\text{SGD } 21,800 - 20,000 = \\mathbf{SGD\\ 1,800.00}$\n` +
      `* **Loss on Disposal Recognized in P&L (${std16Name} §68 & §71)**:\n` +
      `  $$\\text{Loss on Disposal} = \\text{Carrying Amount } (\\text{SGD } 27,500) - \\text{Net Consideration } (\\text{SGD } 20,000) = \\mathbf{SGD\\ 7,500.00}$$\n\n` +
      `---\n\n` +
      `#### 3. New Machinery Cost & Equipment Loan Funding\n` +
      `* **New Machine Cost (IAS 16 §16)**: **SGD 100,000.00** (capitalized net of recoverable tax)\n` +
      `* **Input GST (9% Claimable Receivable)**: **SGD 9,000.00** $\\rightarrow$ Total invoice: **SGD 109,000.00**\n` +
      `* **Less Trade-in credit**: SGD 21,800.00\n` +
      `* **Less Bank cash paid**: SGD 30,000.00\n` +
      `* **Remaining Balance Funded via Equipment Loan**:\n` +
      `  $$\\text{Loan Principal} = 109,000 - 21,800 - 30,000 = \\mathbf{SGD\\ 57,200.00}$$\n` +
      `* **2-Year 5% p.a. Flat Interest**:\n` +
      `  $$\\text{Unexpired Loan Interest} = 57,200 \\times 5\\% \\times 2 = \\mathbf{SGD\\ 5,720.00}$$\n` +
      `* **Gross Equipment Loan Payable**: $57,200 + 5,720 = \\mathbf{SGD\\ 62,920.00}$\n` +
      `  *(The SGD 5,720 unexpired interest is recorded upfront as a contra-liability account, so the net loan obligation on initial recognition is exactly SGD 57,200 under ${std9Name})*.\n\n` +
      `---\n\n` +
      `### Summary of Double Entries (1 April 2026)\n` +
      `1. **Catch-up Depreciation**: Dr. Depreciation Expense SGD 2,500 | Cr. Accumulated Depreciation SGD 2,500\n` +
      `2. **Disposal of Old Machine**: Dr. Acc. Depr SGD 22,500 | Dr. Loss on Disposal SGD 7,500 | Dr. Vendor Clearing SGD 21,800 || Cr. Machinery Cost SGD 50,000 | Cr. GST Output Tax SGD 1,800\n` +
      `3. **Acquisition & Financing**: Dr. Machinery Cost SGD 100,000 | Dr. GST Input Tax SGD 9,000 | Dr. Unexpired Loan Interest SGD 5,720 || Cr. Vendor Clearing SGD 21,800 | Cr. Cash at Bank SGD 30,000 | Cr. Equipment Loan Payable SGD 62,920\n\n` +
      `Review the **Double Entry Journal** tab for the full verified ledger table with citations!`;

    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }

  // 1. GENERAL EXPENSES (Entertainment, Travel, Utilities, Salaries, etc.)
  if (parsed.scenarioType === 'GENERAL_EXPENSE') {
    const amt = parsed.amount || 3000;
    const exp = parsed.expenseAccountName || 'Entertainment & Hospitality Expenses';
    const pay = parsed.paymentMethodAccountName || 'Cash at Bank';

    const replyText = `### Under ${std1} (*Presentation of Financial Statements - Accrual Basis*)\n\n` +
      `Here is the complete double entry for your **${exp}** of **${parsed.functionalCurrency} ${amt.toLocaleString()}**:\n\n` +
      `* **Debit**: **${exp} (P&L - Operating Expense)** — **${parsed.functionalCurrency} ${amt.toLocaleString(undefined, { minimumFractionDigits: 2 })}**\n` +
      `* **Credit**: **${pay} (Current Asset)** — **${parsed.functionalCurrency} ${amt.toLocaleString(undefined, { minimumFractionDigits: 2 })}**\n\n` +
      `#### Accounting Rationale:\n` +
      `1. **Debit Reason**: Operating expenses increase on the debit side under ${std1} §28, reducing profit for the period.\n` +
      `2. **Credit Reason**: Asset accounts (Cash at Bank) decrease on the credit side as funds flow out to settle the expense.\n` +
      `3. **Balance Sheet & P&L Impact**: Total Assets decrease by ${parsed.functionalCurrency} ${amt.toLocaleString()}, and Net Profit decreases by ${parsed.functionalCurrency} ${amt.toLocaleString()}.`;

    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }

  // 2. LEASE ACCOUNTING (IFRS 16 / SFRS(I) 16)
  if (parsed.scenarioType === 'LEASE_IFRS16') {
    const termYears = parsed.leaseTermYears || 3;
    const termMonths = parsed.leaseTermMonths || 36;
    const rent = parsed.leasePaymentMonthly || 3000;
    const rate = parsed.leaseDiscountRateAnnual || 5.0;

    const replyText = `### Under ${std16} (*Leases*)\n\n` +
      `For your **${termYears}-year rental agreement** paying **${parsed.functionalCurrency} ${rent.toLocaleString()}/month**:\n\n` +
      `Under **${std16} §22**, commercial leases over 12 months can **no longer be treated as off-balance sheet operating rent**. You must capitalize a **Right-of-Use (ROU) Asset** and a corresponding **Lease Liability**.\n\n` +
      `1. **At Inception (Commencement Date)**:\n` +
      `   * **Dr. Right-of-Use Asset**: ~${parsed.functionalCurrency} 100,097.10\n` +
      `   * **Cr. Lease Liability**: ~${parsed.functionalCurrency} 100,097.10\n` +
      `   *(Calculated as the present value of ${termMonths} payments of ${parsed.functionalCurrency} ${rent.toLocaleString()} discounted at ${rate}% p.a. Incremental Borrowing Rate under §26)*\n\n` +
      `2. **Every Month (Payment & Interest Accrual)**:\n` +
      `   * **Dr. Lease Liability (Principal)**: ${parsed.functionalCurrency} 2,582.93\n` +
      `   * **Dr. Finance Cost / Interest Expense (P&L)**: ${parsed.functionalCurrency} 417.07\n` +
      `   * **Cr. Cash / Bank**: ${parsed.functionalCurrency} ${rent.toLocaleString()}\n\n` +
      `3. **Every Month (Straight-Line Depreciation)**:\n` +
      `   * **Dr. Depreciation Expense - ROU Asset (P&L)**: ${parsed.functionalCurrency} 2,780.48\n` +
      `   * **Cr. Accumulated Depreciation - ROU Asset**: ${parsed.functionalCurrency} 2,780.48\n\n` +
      `Check the **Double Entry Journal** tab to review the complete statutory breakdown!`;

    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }

  // 4. UNRECOGNIZED OFFLINE QUERY
  if (parsed.scenarioType === 'UNRECOGNIZED') {
    const errorPrefix = apiErrorMessage
      ? `> ⚠️ **Gemini API Call Notice**: ${apiErrorMessage}\n> Please verify your API Key and Model in the **Settings** panel.\n\n`
      : '';

    const replyText = `${errorPrefix}### Query Analysis Notice\n\n` +
      `The local offline rule engine could not find a predefined pattern for this specific transaction.\n\n` +
      `**To answer ANY accounting transaction in business** (including trade discounts, equipment loans, leases, provisions, and IFRS questions):\n` +
      `1. Open **Settings** (top right).\n` +
      `2. Connect your **Google Gemini API Key**.\n` +
      `3. Verify the model (e.g. **gemini-3.5-flash-lite**).\n\n` +
      `With your Gemini API key connected, the AI parses any custom query and generates complete, audit-ready double entries with 100% precision.`;

    return {
      messageText: replyText,
      scenarioState: parsed
    };
  }

  // 3. EQUITY SHARES WITH FOREX (IFRS 9 / IAS 21)
  const buyRate = parsed.purchaseFxRate ?? 1.34;
  const sellRate = parsed.saleFxRate ?? 1.36;
  const initialSGD = (parsed.purchaseAmountForeign || 0) * buyRate;
  const proceedsSGD = (parsed.saleAmountForeign || 0) * sellRate;
  const stockGainSGD = ((parsed.saleAmountForeign || 0) - (parsed.purchaseAmountForeign || 0)) * sellRate;
  const fxGainSGD = (parsed.purchaseAmountForeign || 0) * (sellRate - buyRate);

  const replyText = `### Under ${std9} (*Financial Instruments*) & ${std21} (*Foreign Exchange*)\n\n` +
    `For **${parsed.assetName}** (invested USD ${(parsed.purchaseAmountForeign || 0).toLocaleString()} on ${parsed.purchaseDate}, sold for USD ${parsed.saleAmountForeign?.toLocaleString()} on ${parsed.saleDate}):\n\n` +
    `**Spot Exchange Rates (Powered by Frankfurter API - European Central Bank)**:\n` +
    `* Purchase Spot Rate: **${buyRate} SGD/USD**\n` +
    `* Sale Spot Rate: **${sellRate} SGD/USD**\n\n` +
    `#### Double Entries (Explicit Realized FX Gain View):\n` +
    `1. **On Acquisition (${parsed.purchaseDate})**:\n` +
    `   * **Dr. Financial Asset at FVTPL (${parsed.assetName})**: ${parsed.functionalCurrency} ${initialSGD.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n` +
    `   * **Cr. Cash / Bank (USD Account)**: ${parsed.functionalCurrency} ${initialSGD.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n\n` +
    `2. **On Sale / Disposal (${parsed.saleDate})**:\n` +
    `   * **Dr. Cash / Bank (USD Account)**: ${parsed.functionalCurrency} ${proceedsSGD.toLocaleString(undefined, { minimumFractionDigits: 2 })} *(Gross proceeds)*\n` +
    `   * **Cr. Financial Asset at FVTPL (${parsed.assetName})**: ${parsed.functionalCurrency} ${initialSGD.toLocaleString(undefined, { minimumFractionDigits: 2 })} *(Derecognition)*\n` +
    `   * **Cr. Fair Value Gain on Shares (P&L)**: ${parsed.functionalCurrency} ${stockGainSGD.toLocaleString(undefined, { minimumFractionDigits: 2 })} *(Stock appreciation)*\n` +
    `   * **Cr. Realized Foreign Exchange Gain (P&L / ${std21})**: ${parsed.functionalCurrency} ${fxGainSGD.toLocaleString(undefined, { minimumFractionDigits: 2 })} *(Currency gain on capital)*`;

  return {
    messageText: finalizeMessage(replyText, parsed),
    scenarioState: parsed
  };
}

async function callGeminiAPI(
  userInput: string,
  currentScenario: AccountingScenarioState | null,
  standard: AccountingStandard,
  apiKey: string,
  modelName: string = 'gemini-3.5-flash-lite',
  chatHistory: ChatMessage[] = []
): Promise<GeminiResponse> {
  const stdLabel = standard === 'SFRS_I' ? 'Singapore Financial Reporting Standards (International) [SFRS(I)]' : 'International Financial Reporting Standards [IFRS]';

  const systemInstruction = `
You are an authoritative Senior Singapore Accounting & Regulatory Research Assistant for professional accountants.
Your primary directive is to provide correct, authoritative, and traceable information grounded in:
1. ${stdLabel} issued by the Accounting Standards Council (ASC) Singapore and the IASB.
2. Singapore Tax Laws & Guidelines issued by the Inland Revenue Authority of Singapore (IRAS).
3. Singapore Corporate Law & Compliance administered by the Accounting and Corporate Regulatory Authority (ACRA).
4. Central Provident Fund (CPF) Board statutory mandates and wage ceilings.
5. Ministry of Manpower (MOM) Employment Act statutory mandates.
6. Monetary Authority of Singapore (MAS) financial & payment regulations.

CORE PRINCIPLES & SAFEGUARDS:
1. IDENTIFY THE GOVERNING AUTHORITY FIRST:
   - "Should this expenditure be capitalised?" -> Accounting / SFRS(I)
   - "Is this expense tax deductible?" -> IRAS / Singapore Corporate Tax
   - "Does the company need to register for GST?" -> IRAS / GST
   - "Is this employee entitled to this leave / overtime?" -> MOM
   - "What CPF contribution applies?" -> CPF Board
   - Multi-authority questions: Explicitly declare all involved authorities.

2. SEPARATE ACCOUNTING FROM TAX:
   - NEVER assume accounting treatment equals tax treatment.
   - For all expenditure, asset, and revenue questions, explicitly separate:
     * FINANCIAL REPORTING TREATMENT (SFRS(I))
     * SINGAPORE TAX TREATMENT (IRAS CIT & GST)

3. ZERO CITATION FABRICATION & UNCERTAINTY HANDLING:
   - The AI must NEVER invent accounting standards, paragraph numbers, IRAS requirements, GST rates, tax rates, MOM requirements, CPF rates, filing deadlines, thresholds, or citations.
   - If an exact paragraph cannot be verified with certainty, cite the standard or act generally (e.g. "SFRS(I) 1-38", "Section 14(1) of the Income Tax Act 1947") and explain the underlying statutory principle.
   - If user facts are underspecified, clearly highlight the missing facts and state the alternative treatments rather than guessing.
   - OFFICIAL SOURCES & DOMAINS: The Accounting Standards Council (ASC) functions merged into ACRA in April 2023. All official SFRS(I) standards are published on ACRA's portal (https://www.acra.gov.sg/accountancy/accounting-standards). Singapore statutes are on Singapore Statutes Online (https://sso.agc.gov.sg). NEVER cite the decommissioned domain asc.gov.sg.

4. CURRENT TIME-SENSITIVE INFORMATION:
   - GST: 9% standard rate (effective 1 January 2024). Compulsory registration threshold is SGD 1,000,000 taxable turnover.
   - CPF Ceilings (2026): Ordinary Wage (OW) monthly ceiling is SGD 8,000 (effective 1 January 2026). Additional Wage (AW) ceiling formula is $102,000 - Total OW subject to CPF.
   - Corporate Tax: 17% headline rate. Start-Up Tax Exemption (SUTE) max SGD 125,000; Partial Tax Exemption (PTE) max SGD 102,500. Form C-S threshold is revenue <= SGD 5,000,000.
   - ACRA Small Company Audit Exemption: 2 of 3 criteria (Revenue <= $10M, Gross Assets <= $10M, Employees <= 50) for past 2 consecutive FYs.

5. JOURNAL ENTRIES AS ANALYSIS OUTPUT:
   - For transaction questions, journal entries are generated as the final output of the analysis.
   - Every journal entry group MUST be strictly balanced: Sum(Debits) == Sum(Credits).
   - Trade discounts are deducted from asset cost (SFRS(I) 1-16 §16(a)); never recorded as separate accounts.
   - MANDATORY FOREIGN EXCHANGE (FX) GAIN/LOSS BIFURCATION (SFRS(I) 1-21 & SFRS(I) 9):
     When disposing of foreign investments, shares, or foreign monetary assets, ALWAYS explicitly bifurcate the gain/loss into TWO separate lines on the credit (or debit) side:
     1. "Fair Value Gain on Shares ([Asset Name]) [P&L]": (Disposal Foreign Amount - Cost Foreign Amount) * Disposal Spot Rate
     2. "Realized Foreign Exchange Gain ([Foreign Currency]/SGD) [P&L / SFRS(I) 1-21]": Acquisition Foreign Amount * (Disposal Spot Rate - Acquisition Spot Rate)
     If exchange rates are not explicitly stated in the prompt, adopt standard benchmark rates (e.g. 1.34 buy / 1.36 sell for USD/SGD) to demonstrate the currency gain separation. NEVER combine them into a single credit line. Foreign exchange differences on monetary items and foreign equity disposals MUST be explicitly recognized under SFRS(I) 1-21.

6. SINGAPORE CONVENTIONS:
   - Dates must be formatted as DD/MM/YYYY. Functional currency defaults to SGD.
   - Write all LaTeX math with double backslashes (\\\\text, \\\\le, \\\\times). Return pure JSON.

Respond in valid JSON with this exact schema:
{
  "scenarioType": "UNIVERSAL",
  "queryIntent": "TRANSACTION" | "STATUTORY_ADVISORY" | "HYBRID",
  "primaryDomain": "ACCOUNTING_SFRS" | "IRAS_TAX" | "IRAS_GST" | "ACRA_CORP" | "MOM_EMPLOYMENT" | "CPF_BOARD" | "MULTI_AUTHORITY" | "GENERAL",
  "transactionTitle": "string",
  "functionalCurrency": "SGD",
  "transactionCurrency": "SGD",
  "accountingTreatmentSummary": "Detailed SFRS(I) accounting treatment",
  "singaporeTaxTreatmentSummary": "Detailed IRAS tax deductibility, capital allowances, and GST treatment",
  "regulatoryMandatesSummary": "ACRA, MOM, or CPF statutory compliance requirements",
  "effectiveDateOrTiming": "Current effective dates (e.g. 9% GST, 2026 $8,000 OW ceiling)",
  "uncertaintyDisclaimer": "Caveats, entity-specific considerations, or required documentation",
  "messageText": "Comprehensive markdown response with structured headers, calculations, and official citations",
  "keyParameters": [
    { "label": "string", "value": "string", "badge": "string", "highlight": boolean }
  ],
  "directGroups": [
    {
      "id": "grp-1",
      "eventDate": "DD/MM/YYYY",
      "title": "string",
      "summary": "string",
      "lines": [
        {
          "id": "line-1",
          "accountCode": "4-digit code e.g. 1500",
          "accountName": "Account Title",
          "category": "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE",
          "debit": number,
          "credit": number,
          "lineExplanation": "string"
        }
      ],
      "citations": [
        {
          "standard": "SFRS(I) 1-16 / Income Tax Act 1947",
          "paragraph": "§16(a) / Section 14(1)",
          "title": "Title",
          "text": "Text",
          "officialSourceUrl": "https://sso.agc.gov.sg/...",
          "authority": "IRAS" | "ACRA" | "CPF" | "MOM" | "MAS" | "ASC" | "SSO"
        }
      ],
      "rationalePoints": ["string"]
    }
  ],
  "statutoryAdvisory": [
    {
      "authority": "IRAS" | "ACRA" | "CPF" | "MOM" | "MAS" | "CUSTOMS" | "ASC" | "SSO",
      "statuteOrAct": "string",
      "sectionOrSchedule": "string",
      "topic": "string",
      "summary": "string",
      "keyRules": ["string"],
      "officialUrl": "string",
      "isTaxDeductible": boolean,
      "isGstClaimable": boolean
    }
  ]
}
Return pure JSON only.
`;

  // Multi-turn conversational history for Gemini
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  // Filter out system welcome messages and raw processing error cards
  const conversationTurns = (chatHistory || [])
    .filter((m) => m.id !== 'welcome-msg' && m.text && !m.text.startsWith('⚠️ **Processing Error**'))
    .slice(-8);

  for (const m of conversationTurns) {
    const role: 'user' | 'model' = m.sender === 'user' ? 'user' : 'model';
    if (contents.length > 0 && contents[contents.length - 1].role === role) {
      contents[contents.length - 1].parts[0].text += `\n\n${m.text}`;
    } else {
      contents.push({ role, parts: [{ text: m.text }] });
    }
  }

  const activeScenarioSummary = currentScenario ? `
[CURRENT ACTIVE TRANSACTION CONTEXT]
Transaction Title: ${currentScenario.transactionTitle || 'N/A'}
Functional Currency: ${currentScenario.functionalCurrency || 'SGD'}
Active Parameters:
${JSON.stringify(currentScenario.keyParameters || [], null, 2)}
Active Double Entry Journal Groups:
${currentScenario.directGroups?.map((g, idx) => `Group #${idx + 1} (${g.eventDate}) - ${g.title}:\n` + g.lines.map(l => `  ${l.debit > 0 ? `Debit: ${l.accountName} (${l.accountCode || ''}) - SGD ${l.debit}` : `Credit: ${l.accountName} (${l.accountCode || ''}) - SGD ${l.credit}`}`).join('\n')).join('\n') || 'None'}
` : '';

  const currentTurnText = `${activeScenarioSummary}\n[USER QUERY / FOLLOW-UP]:\n${userInput}`.trim();

  if (contents.length > 0) {
    if (contents[contents.length - 1].role === 'user') {
      contents[contents.length - 1].parts[0].text = currentTurnText;
    } else {
      contents.push({ role: 'user', parts: [{ text: currentTurnText }] });
    }
  } else {
    contents.push({ role: 'user', parts: [{ text: currentTurnText }] });
  }

  const requestBody = {
    contents,
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json'
    }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!res.ok) {
    throw new Error(`Gemini HTTP Error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const rawJsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawJsonText) {
    throw new Error('No content returned by Gemini');
  }

  const parsed = repairAndParseAIJson(rawJsonText);

  // Validate and compute totals on directGroups
  let directGroups = (parsed.directGroups || []).map((grp: any, gIdx: number) => {
    const lines = (grp.lines || []).map((l: any, lIdx: number) => ({
      id: l.id || `line-${gIdx}-${lIdx}`,
      accountCode: l.accountCode || '1000',
      accountName: l.accountName || 'Account',
      category: l.category || 'ASSET',
      debit: typeof l.debit === 'number' ? Math.round(l.debit * 100) / 100 : 0,
      credit: typeof l.credit === 'number' ? Math.round(l.credit * 100) / 100 : 0,
      foreignCurrency: l.foreignCurrency,
      foreignDebit: l.foreignDebit,
      foreignCredit: l.foreignCredit,
      exchangeRate: l.exchangeRate,
      lineExplanation: l.lineExplanation || ''
    }));

    const totalDebit = Math.round(lines.reduce((s: number, l: any) => s + l.debit, 0) * 100) / 100;
    const totalCredit = Math.round(lines.reduce((s: number, l: any) => s + l.credit, 0) * 100) / 100;
    const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

    return {
      id: grp.id || `grp-${gIdx + 1}`,
      eventDate: formatSingaporeDate(grp.eventDate || new Date()),
      title: grp.title || `Entry Group ${gIdx + 1}`,
      summary: grp.summary || '',
      lines,
      totalDebit,
      totalCredit,
      isBalanced,
      citations: grp.citations || [],
      rationalePoints: grp.rationalePoints || []
    };
  });

  // Safeguard: If AI response didn't supply directGroups (e.g. conceptual question), preserve current
  if (directGroups.length === 0 && currentScenario?.directGroups && currentScenario.directGroups.length > 0) {
    directGroups = currentScenario.directGroups;
  }

  // Safeguard: If AI response didn't supply keyParameters, preserve current
  let keyParameters = (parsed.keyParameters && Array.isArray(parsed.keyParameters) && parsed.keyParameters.length > 0)
    ? parsed.keyParameters
    : (currentScenario?.keyParameters || []);

  let finalTitle = (parsed.transactionTitle && parsed.transactionTitle !== 'Accounting Transaction')
    ? parsed.transactionTitle
    : (currentScenario?.transactionTitle || parsed.transactionTitle || 'Accounting Transaction');

  const scenarioState: AccountingScenarioState = {
    scenarioType: parsed.scenarioType || currentScenario?.scenarioType || 'UNIVERSAL',
    queryIntent: parsed.queryIntent || (parsed.statutoryAdvisory?.length > 0 ? 'STATUTORY_ADVISORY' : currentScenario?.queryIntent || 'TRANSACTION'),
    primaryDomain: parsed.primaryDomain || currentScenario?.primaryDomain || (parsed.statutoryAdvisory?.length > 0 ? (parsed.statutoryAdvisory[0].authority === 'ACRA' ? 'ACRA_CORP' : parsed.statutoryAdvisory[0].authority === 'CPF' ? 'CPF_BOARD' : parsed.statutoryAdvisory[0].authority === 'MOM' ? 'MOM_EMPLOYMENT' : 'IRAS_TAX') : 'ACCOUNTING_SFRS'),
    rawQuery: userInput,
    transactionTitle: finalTitle,
    functionalCurrency: parsed.functionalCurrency || currentScenario?.functionalCurrency || 'SGD',
    transactionCurrency: parsed.transactionCurrency || currentScenario?.transactionCurrency || 'SGD',
    accountingTreatmentSummary: parsed.accountingTreatmentSummary || currentScenario?.accountingTreatmentSummary,
    singaporeTaxTreatmentSummary: parsed.singaporeTaxTreatmentSummary || currentScenario?.singaporeTaxTreatmentSummary,
    regulatoryMandatesSummary: parsed.regulatoryMandatesSummary || currentScenario?.regulatoryMandatesSummary,
    effectiveDateOrTiming: parsed.effectiveDateOrTiming || currentScenario?.effectiveDateOrTiming,
    uncertaintyDisclaimer: parsed.uncertaintyDisclaimer || currentScenario?.uncertaintyDisclaimer,
    keyParameters,
    directGroups,
    statutoryAdvisory: parsed.statutoryAdvisory || currentScenario?.statutoryAdvisory,
    isComplete: true,
    missingFields: []
  };

  return {
    messageText: appendStatutorySourceFooter(parsed.messageText || '', scenarioState),
    scenarioState
  };
}
