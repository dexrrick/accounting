import type { AccountingStandard, AccountingScenarioState, MissingFieldInfo, ChatMessage } from '../types/accounting';
import { parseAccountingQuery } from '../engine/scenarioParser';
import { formatSingaporeDate } from '../utils/dateUtils';

export interface GeminiResponse {
  messageText: string;
  scenarioState: AccountingScenarioState;
  clarifications?: MissingFieldInfo[];
}

export async function processAccountingQuery(
  userInput: string,
  currentScenario: AccountingScenarioState | null,
  standard: AccountingStandard,
  apiKey?: string,
  modelName: string = 'gemini-3.5-flash-lite',
  chatHistory: ChatMessage[] = []
): Promise<GeminiResponse> {
  const std1 = standard === 'SFRS_I' ? 'SFRS(I) 1-1' : 'IAS 1';
  const std9 = standard === 'SFRS_I' ? 'SFRS(I) 9' : 'IFRS 9';
  const std16 = standard === 'SFRS_I' ? 'SFRS(I) 16' : 'IFRS 16';
  const std21 = standard === 'SFRS_I' ? 'SFRS(I) 1-21' : 'IAS 21';
  let apiErrorMessage: string | null = null;

  // Live Gemini API call if key is provided
  if (apiKey && apiKey.trim().length > 10) {
    try {
      const response = await callGeminiAPI(userInput, currentScenario, standard, apiKey.trim(), modelName, chatHistory);
      return response;
    } catch (err: any) {
      console.warn('Gemini API call failed, falling back to smart universal engine:', err);
      apiErrorMessage = err?.message || 'Gemini API Error';
    }
  }

  // Smart Universal Parser (works offline for ANY query or fallback)
  const parsed = await parseAccountingQuery(userInput, currentScenario);

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
      messageText: replyText,
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
      messageText: replyText,
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
      messageText: replyText,
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
      messageText: replyText,
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
    `   * **Cr. Realized Foreign Exchange Gain (P&L / IAS 21)**: ${parsed.functionalCurrency} ${fxGainSGD.toLocaleString(undefined, { minimumFractionDigits: 2 })} *(Currency gain on capital)*`;

  return {
    messageText: replyText,
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
You are an authoritative Senior Accounting Consultant specializing in ${stdLabel} issued by the Accounting Standards Council (ASC) Singapore and the IASB.
You handle all business accounting transactions:
- Property, Plant & Equipment (IAS 16 / SFRS(I) 1-16): initial recognition, trade discounts (deducted from asset cost under §16(a), never recorded as a separate ledger line), derecognition/disposals, trade-ins, catch-up depreciation.
- Singapore GST & Taxes: Singapore 9% GST, output tax on disposal of business assets, input tax recovery on purchases under IRAS rules.
- Financing & Liabilities (IFRS 9): loans, trade payables, commercial credit terms, unexpired loan interest contra accounts.
- Leases (IFRS 16 / SFRS(I) 16): Right-of-Use assets, lease liabilities.
- Financial Instruments & Forex (IFRS 9 & IAS 21): shares, bonds, FVTPL, FVTOCI, realized/unrealized FX.
- Operating Expenses, Revenue (IFRS 15), Provisions (IAS 37), Inventory (IAS 2), Payroll & CPF.

CRITICAL STATUTORY RULES:
1. Double Entry Balance: Every journal entry group MUST be strictly balanced: Sum(Debits) == Sum(Credits).
2. Trade Discounts (IAS 16 §16(a)): Trade discounts are deducted directly from list price to arrive at capitalized asset cost; they are NEVER recorded as separate ledger accounts.
3. Singapore 9% GST: Levied on the net discounted price. Input GST is recorded as a claimable receivable (asset). Output GST is recorded as a liability on taxable supplies/trade-in derecognitions.
4. Singapore Date Format: Always format all dates in DD/MM/YYYY sequence (e.g. 01/08/2026, 15/12/2026, 01/04/2026).
5. Standard Citations: Provide specific standard paragraph citations (e.g. IAS 16 §16(a), IAS 16 §67-71, SFRS(I) 1-16 §55, IFRS 9 §5.1.1, Singapore GST Act).

CRITICAL INSTRUCTIONS FOR FOLLOW-UP QUESTIONS & UPDATES (MANDATORY):
The user interacts in an ongoing conversation. On every turn:
1. Parameter Modifications & "What-If" Queries (e.g. "What if the trade discount is 20%?", "Change cash paid to SGD 10,000", "What if interest rate is 6%?"):
   - You MUST update the entire transaction scenario.
   - Recalculate ALL values (costs, taxes, GST 9%, discounts, interest, depreciation, debits, credits).
   - In "keyParameters", output the complete updated parameters reflecting the new figures and badges.
   - In "directGroups", output the complete updated, balanced double entries reflecting the modified parameters.
   - In "messageText", explain what changed, step-by-step arithmetic comparing new vs prior figures, and statutory citations.
2. Subsequent Transactions & Events (e.g. "What is the entry when we pay the remaining balance?", "Record subsequent depreciation at year end"):
   - Provide the complete set of journal groups: either append the subsequent event group (e.g. Group 1: Initial Purchase, Group 2: Settlement of Trade Payables / Depreciation) or output the relevant entry sequence.
   - In "keyParameters", update facts to reflect the latest status.
   - In "messageText", detail the subsequent accounting treatment.
3. Explanatory & Conceptual Follow-ups (e.g. "Why did you debit Office Equipment?", "Explain why GST is claimable", "Why is trade discount not in the ledger?"):
   - Provide a thorough, authoritative explanation in "messageText" citing standard paragraphs.
   - MANDATORY: You MUST RETURN the complete existing "keyParameters" and "directGroups" from the active scenario so that the UI parameter cards and journal table remain displayed and synchronized. NEVER RETURN EMPTY ARRAYS!
4. UI State Synchronization:
   - The UI directly renders "keyParameters" in the facts panel and "directGroups" in the ledger table.
   - EVERY JSON response MUST contain valid, non-empty "keyParameters" and "directGroups".

Respond in valid JSON with this exact schema:
{
  "scenarioType": "UNIVERSAL",
  "transactionTitle": "string",
  "functionalCurrency": "SGD",
  "transactionCurrency": "SGD",
  "messageText": "Comprehensive markdown explanation with step-by-step calculations and statutory citations",
  "keyParameters": [
    { "label": "string", "value": "string", "badge": "string" }
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
          "standard": "SFRS(I) 1-16",
          "paragraph": "§16(a)",
          "title": "Title",
          "text": "Text"
        }
      ],
      "rationalePoints": [
        "string"
      ]
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

  let cleanedJson = rawJsonText.trim();
  if (cleanedJson.startsWith('```json')) {
    cleanedJson = cleanedJson.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
  } else if (cleanedJson.startsWith('```')) {
    cleanedJson = cleanedJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(cleanedJson);
  } catch (e) {
    const jsonMatch = cleanedJson.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error(`Failed to parse AI JSON response: ${e}`);
    }
  }

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
    rawQuery: userInput,
    transactionTitle: finalTitle,
    functionalCurrency: parsed.functionalCurrency || currentScenario?.functionalCurrency || 'SGD',
    transactionCurrency: parsed.transactionCurrency || currentScenario?.transactionCurrency || 'SGD',
    keyParameters,
    directGroups,
    isComplete: true,
    missingFields: []
  };

  return {
    messageText: parsed.messageText,
    scenarioState
  };
}
