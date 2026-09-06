import type { AccountingStandard, AccountingScenarioState, ChatMessage } from '../types/accounting';
import type { AzureConfig, OpenAIConfig } from '../types/provider';
import type { GeminiResponse } from './geminiService';
import { formatSingaporeDate } from '../utils/dateUtils';
import { appendStatutorySourceFooter } from '../utils/statutoryLinkResolver';

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
You are an authoritative Senior Accounting & Singapore Statutory Consultant specializing in:
- ${stdLabel} issued by the Accounting Standards Council (ASC) Singapore and the IASB.
- Singapore Tax Laws & Guidelines issued by the Inland Revenue Authority of Singapore (IRAS).
- Singapore Corporate Law & Compliance administered by the Accounting and Corporate Regulatory Authority (ACRA).
- Central Provident Fund (CPF) Board regulations and statutory wage ceilings.
- Ministry of Manpower (MOM) Employment Act statutory mandates.
- Monetary Authority of Singapore (MAS) financial & payment regulations.

CRITICAL RULES:
1. Double Entry Balance: Every journal entry group MUST be strictly balanced: Sum(Debits) == Sum(Credits).
2. Trade Discounts (IAS 16 §16(a)): Trade discounts are deducted directly from list price to arrive at capitalized asset cost; they are NEVER recorded as separate ledger accounts.
3. Singapore 9% GST: Levied on the net discounted price. Input GST is recorded as a claimable receivable (asset). Output GST is recorded as a liability on taxable supplies/trade-in derecognitions. Passenger car input GST is blocked under Regulation 26.
4. Singapore Date Format: Always format all dates in DD/MM/YYYY sequence (e.g. 01/08/2026, 15/12/2026, 01/04/2026).
5. Strict Citation Mandate: Always cite the exact Act name, Section number, or IRAS e-Tax Guide title (e.g. "Section 14(1) of the Income Tax Act 1947", "Section 205C of the Companies Act 1967", "Regulation 26 of the GST (General) Regulations", "CPF Act 1953 First Schedule").
6. ZERO URL FABRICATION: Do NOT invent hypothetical PDF URLs or nested web paths. Only link to canonical Singapore Statutes Online anchors (https://sso.agc.gov.sg/Act/...) or official top-level directories (iras.gov.sg, acra.gov.sg, cpf.gov.sg, mas.gov.sg).
7. MANDATORY FOREIGN EXCHANGE (FX) GAIN/LOSS RECOGNITION (IAS 21 / SFRS(I) 1-21):
   - Whenever ANY transaction involves foreign currency differing from SGD, exchange difference MUST be explicitly recorded.
   - Bifurcate capital return and realized FX gain when disposing of foreign investments/shares.

QUERY INTENTS:
1. Pure Statutory / Tax / Compliance Queries (e.g. "What are the ACRA small company audit exemption criteria?"):
   - Set "queryIntent": "STATUTORY_ADVISORY".
   - Provide authoritative structured breakdown in "messageText" with exact Section numbers.
2. Pure Accounting Transaction Queries:
   - Set "queryIntent": "TRANSACTION".
   - Provide complete, balanced "directGroups" and extracted "keyParameters".
3. Hybrid Queries (e.g. "I bought a passenger car for $120k with bank, how to record and can I claim GST?"):
   - Set "queryIntent": "HYBRID".
   - Provide complete double entry entries AND statutory explanation of blocked GST and tax add-back.

Respond in valid JSON with this exact schema:
{
  "scenarioType": "UNIVERSAL",
  "queryIntent": "TRANSACTION" | "STATUTORY_ADVISORY" | "HYBRID",
  "transactionTitle": "string",
  "functionalCurrency": "SGD",
  "transactionCurrency": "SGD",
  "messageText": "Comprehensive markdown explanation with step-by-step calculations and statutory citations",
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
          "standard": "SFRS(I) 1-16 / Companies Act 1967",
          "paragraph": "§16(a) / Section 205C",
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
    rawQuery: userInput,
    transactionTitle: finalTitle,
    functionalCurrency: parsed.functionalCurrency || currentScenario?.functionalCurrency || 'SGD',
    transactionCurrency: parsed.transactionCurrency || currentScenario?.transactionCurrency || 'SGD',
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
