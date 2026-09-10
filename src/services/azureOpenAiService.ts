import type { AccountingStandard, AccountingScenarioState, ChatMessage } from '../types/accounting';
import type { AzureConfig, OpenAIConfig } from '../types/provider';
import type { GeminiResponse } from './geminiService';
import { formatSingaporeDate } from '../utils/dateUtils';
import { appendStatutorySourceFooter } from '../utils/statutoryLinkResolver';
import { repairAndParseAIJson } from '../utils/jsonRepair';

/**
 * Normalizes an Azure OpenAI endpoint input into a valid URL base.
 * Accepts:
 * - "my-company" -> "https://my-company.openai.azure.com"
 * - "https://my-company.openai.azure.com/" -> "https://my-company.openai.azure.com"
 */
export function normalizeAzureEndpoint(endpoint: string): string {
  let cleaned = (endpoint || '').trim().replace(/\/+$/, '');
  if (!cleaned) return '';

  if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
    if (!cleaned.includes('.')) {
      cleaned = `https://${cleaned}.openai.azure.com`;
    } else {
      cleaned = `https://${cleaned}`;
    }
  }
  return cleaned;
}


export function buildAccountingMessages(
  userInput: string,
  currentScenario: AccountingScenarioState | null,
  standard: AccountingStandard,
  chatHistory: ChatMessage[] = []
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const stdLabel = standard === 'SFRS_I'
    ? 'Singapore Financial Reporting Standards (International) [SFRS(I)]'
    : 'International Financial Reporting Standards [IFRS]';

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

4. CURRENT TIME-SENSITIVE INFORMATION:
   - GST: 9% standard rate (effective 1 January 2024). Compulsory registration threshold is SGD 1,000,000 taxable turnover.
   - CPF Ceilings (2026): Ordinary Wage (OW) monthly ceiling is SGD 8,000 (effective 1 January 2026). Additional Wage (AW) ceiling formula is $102,000 - Total OW subject to CPF.
   - Corporate Tax: 17% headline rate. Start-Up Tax Exemption (SUTE) max SGD 125,000; Partial Tax Exemption (PTE) max SGD 102,500. Form C-S threshold is revenue <= SGD 5,000,000.
   - ACRA Small Company Audit Exemption: 2 of 3 criteria (Revenue <= $10M, Gross Assets <= $10M, Employees <= 50) for past 2 consecutive FYs.

5. JOURNAL ENTRIES AS ANALYSIS OUTPUT:
   - For transaction questions, journal entries are generated as the final output of the analysis.
   - Every journal entry group MUST be strictly balanced: Sum(Debits) == Sum(Credits).
   - Trade discounts are deducted from asset cost (SFRS(I) 1-16 §16(a)); never recorded as separate accounts.
   - Foreign exchange differences on monetary items and foreign equity disposals MUST be explicitly recognized under SFRS(I) 1-21.

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

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemInstruction }
  ];

  const conversationTurns = (chatHistory || [])
    .filter((m) => m.id !== 'welcome-msg' && m.text && !m.text.startsWith('⚠️ **Processing Error**'))
    .slice(-8);

  for (const m of conversationTurns) {
    messages.push({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text
    });
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
  messages.push({ role: 'user', content: currentTurnText });

  return messages;
}

export function parseAccountingAIResponse(
  rawJsonText: string,
  currentScenario: AccountingScenarioState | null,
  userInput: string
): GeminiResponse {
  if (!rawJsonText) {
    throw new Error('No content returned by AI provider.');
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

  if (directGroups.length === 0 && currentScenario?.directGroups && currentScenario.directGroups.length > 0) {
    directGroups = currentScenario.directGroups;
  }

  const keyParameters = (parsed.keyParameters && Array.isArray(parsed.keyParameters) && parsed.keyParameters.length > 0)
    ? parsed.keyParameters
    : (currentScenario?.keyParameters || []);

  const finalTitle = (parsed.transactionTitle && parsed.transactionTitle !== 'Accounting Transaction')
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

export async function callAzureOpenAI(
  userInput: string,
  currentScenario: AccountingScenarioState | null,
  standard: AccountingStandard,
  azureConfig: AzureConfig,
  chatHistory: ChatMessage[] = []
): Promise<GeminiResponse> {
  const endpoint = normalizeAzureEndpoint(azureConfig.endpoint);
  if (!endpoint) {
    throw new Error('Azure OpenAI Endpoint is required. Please configure in Settings (e.g. https://<resource>.openai.azure.com).');
  }
  if (!azureConfig.apiKey || azureConfig.apiKey.trim().length < 10) {
    throw new Error('Valid Azure OpenAI API Key is required. Please configure in Settings.');
  }
  if (!azureConfig.deploymentName || !azureConfig.deploymentName.trim()) {
    throw new Error('Azure OpenAI Deployment Name is required (e.g. gpt-4o). Please configure in Settings.');
  }

  const deployment = azureConfig.deploymentName.trim();
  const apiVersion = (azureConfig.apiVersion || '2024-08-01-preview').trim();
  const url = `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

  const messages = buildAccountingMessages(userInput, currentScenario, standard, chatHistory);

  const requestPayload = {
    messages,
    temperature: 0.1,
    response_format: { type: 'json_object' }
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': azureConfig.apiKey.trim()
      },
      body: JSON.stringify(requestPayload)
    });
  } catch (netErr: any) {
    throw new Error(`Azure OpenAI Connection Failed: Network error reaching ${endpoint}. Check endpoint address or CORS settings (${netErr?.message})`);
  }

  if (!res.ok) {
    const errorText = await res.text();
    if (res.status === 401) {
      throw new Error(`Azure Authentication Error (401): Invalid or expired Azure OpenAI API Key. Please verify your key in Settings.`);
    } else if (res.status === 404) {
      throw new Error(`Azure Deployment Error (404): Deployment "${deployment}" was not found at ${endpoint}. Check Azure OpenAI Studio > Deployments.`);
    } else if (res.status === 429) {
      throw new Error(`Azure Quota Error (429): Rate limit (TPM/RPM) exceeded for deployment "${deployment}". Try again shortly or check Azure quota.`);
    } else if (res.status === 400) {
      throw new Error(`Azure Request Error (400): ${errorText}`);
    }
    throw new Error(`Azure OpenAI Error (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  const rawJsonText = data?.choices?.[0]?.message?.content;
  return parseAccountingAIResponse(rawJsonText, currentScenario, userInput);
}

export async function callStandardOpenAI(
  userInput: string,
  currentScenario: AccountingScenarioState | null,
  standard: AccountingStandard,
  openaiConfig: OpenAIConfig,
  chatHistory: ChatMessage[] = []
): Promise<GeminiResponse> {
  if (!openaiConfig.apiKey || openaiConfig.apiKey.trim().length < 10) {
    throw new Error('Valid OpenAI API Key is required. Please configure in Settings.');
  }

  const model = openaiConfig.model || 'gpt-4o';
  const url = 'https://api.openai.com/v1/chat/completions';
  const messages = buildAccountingMessages(userInput, currentScenario, standard, chatHistory);

  const requestPayload = {
    model,
    messages,
    temperature: 0.1,
    response_format: { type: 'json_object' }
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiConfig.apiKey.trim()}`
      },
      body: JSON.stringify(requestPayload)
    });
  } catch (netErr: any) {
    throw new Error(`OpenAI Connection Failed: Network error reaching ${url} (${netErr?.message})`);
  }

  if (!res.ok) {
    const errorText = await res.text();
    if (res.status === 401) {
      throw new Error(`OpenAI Authentication Error (401): Invalid API Key.`);
    } else if (res.status === 429) {
      throw new Error(`OpenAI Rate Limit (429): Quota exceeded.`);
    }
    throw new Error(`OpenAI Error (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  const rawJsonText = data?.choices?.[0]?.message?.content;
  return parseAccountingAIResponse(rawJsonText, currentScenario, userInput);
}
