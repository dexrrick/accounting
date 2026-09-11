import type { AccountingStandard, AccountingScenarioState, ChatMessage } from '../types/accounting';
import type { AzureConfig, OpenAIConfig } from '../types/provider';
import type { GeminiResponse } from './geminiService';
import { repairAndParseAIJson } from '../utils/jsonRepair';
import { classifyQuestion } from '../classification/questionClassifier';
import {
  buildGroundedReasoningContext,
  formatGroundedSystemPrompt,
  postProcessAIResponse,
  type GroundedReasoningContext
} from './groundingContextBuilder';
import { RequestProfiler } from './telemetry';

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
  chatHistory: ChatMessage[] = [],
  groundedContext?: GroundedReasoningContext
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const systemInstruction = groundedContext
    ? formatGroundedSystemPrompt(groundedContext, standard)
    : formatGroundedSystemPrompt({
        classification: classifyQuestion(userInput),
        userFacts: [],
        missingFacts: [],
        assumptions: [],
        primaryEvidence: [],
        officialGuidance: [],
        curatedSummaries: [],
        applicationRules: [],
        currentInformationRequired: false
      }, standard);

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
  userInput: string,
  groundedContext?: GroundedReasoningContext,
  deterministicScenario?: AccountingScenarioState | null,
  standard: AccountingStandard = 'SFRS_I'
): GeminiResponse {
  if (!rawJsonText) {
    throw new Error('No content returned by AI provider.');
  }

  const parsed = repairAndParseAIJson(rawJsonText);
  const fallbackContext: GroundedReasoningContext = groundedContext || {
    classification: classifyQuestion(userInput),
    userFacts: [],
    missingFacts: [],
    assumptions: [],
    primaryEvidence: [],
    officialGuidance: [],
    curatedSummaries: [],
    applicationRules: [],
    currentInformationRequired: false
  };

  return postProcessAIResponse(parsed, currentScenario, userInput, fallbackContext, deterministicScenario, standard);
}

export async function callAzureOpenAI(
  userInput: string,
  currentScenario: AccountingScenarioState | null,
  standard: AccountingStandard,
  azureConfig: AzureConfig,
  chatHistory: ChatMessage[] = [],
  groundedContext?: GroundedReasoningContext,
  deterministicScenario?: AccountingScenarioState | null
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
  const profiler = new RequestProfiler(userInput, `azure-${deployment}`);
  const tGround0 = Date.now();
  const context = groundedContext || await buildGroundedReasoningContext(userInput, currentScenario, undefined, { activeProvider: 'azure', azure: azureConfig } as any);
  const apiVersion = (azureConfig.apiVersion || '2024-08-01-preview').trim();
  const url = `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

  const messages = buildAccountingMessages(userInput, currentScenario, standard, chatHistory, context);
  profiler.recordStage('grounding', Date.now() - tGround0);

  const requestPayload = {
    messages,
    temperature: 0.1,
    response_format: { type: 'json_object' }
  };

  // 12-second AbortController timeout to guarantee fast interactive latency
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  const tReq0 = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': azureConfig.apiKey.trim()
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal
    });
  } catch (netErr: any) {
    clearTimeout(timeoutId);
    if (netErr.name === 'AbortError' || controller.signal.aborted) {
      throw new Error(`Azure OpenAI request timed out after 12s. Reverting to deterministic accounting engine.`);
    }
    throw new Error(`Azure OpenAI Connection Failed: Network error reaching ${endpoint}. Check endpoint address or CORS settings (${netErr?.message})`);
  } finally {
    clearTimeout(timeoutId);
  }

  profiler.recordStage('gemini_request', Date.now() - tReq0);

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
  if (data?.usage) {
    profiler.setTokenCounts(data.usage.prompt_tokens || 0, data.usage.completion_tokens || 0);
  }

  const rawJsonText = data?.choices?.[0]?.message?.content;
  const tPost0 = Date.now();
  const result = parseAccountingAIResponse(rawJsonText, currentScenario, userInput, context, deterministicScenario, standard);
  profiler.recordStage('assembly', Date.now() - tPost0);

  profiler.logSummary();
  return result;
}

export async function callStandardOpenAI(
  userInput: string,
  currentScenario: AccountingScenarioState | null,
  standard: AccountingStandard,
  openaiConfig: OpenAIConfig,
  chatHistory: ChatMessage[] = [],
  groundedContext?: GroundedReasoningContext,
  deterministicScenario?: AccountingScenarioState | null
): Promise<GeminiResponse> {
  if (!openaiConfig.apiKey || openaiConfig.apiKey.trim().length < 10) {
    throw new Error('Valid OpenAI API Key is required. Please configure in Settings.');
  }

  const model = openaiConfig.model || 'gpt-4o';
  const profiler = new RequestProfiler(userInput, `openai-${model}`);
  const tGround0 = Date.now();
  const context = groundedContext || await buildGroundedReasoningContext(userInput, currentScenario, undefined, { activeProvider: 'openai', openai: openaiConfig } as any);
  const url = 'https://api.openai.com/v1/chat/completions';
  const messages = buildAccountingMessages(userInput, currentScenario, standard, chatHistory, context);
  profiler.recordStage('grounding', Date.now() - tGround0);

  const requestPayload = {
    model,
    messages,
    temperature: 0.1,
    response_format: { type: 'json_object' }
  };

  // 12-second AbortController timeout to guarantee fast interactive latency
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  const tReq0 = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiConfig.apiKey.trim()}`
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal
    });
  } catch (netErr: any) {
    clearTimeout(timeoutId);
    if (netErr.name === 'AbortError' || controller.signal.aborted) {
      throw new Error(`OpenAI request timed out after 12s. Reverting to deterministic accounting engine.`);
    }
    throw new Error(`OpenAI Connection Failed: Network error reaching ${url} (${netErr?.message})`);
  } finally {
    clearTimeout(timeoutId);
  }

  profiler.recordStage('gemini_request', Date.now() - tReq0);

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
  if (data?.usage) {
    profiler.setTokenCounts(data.usage.prompt_tokens || 0, data.usage.completion_tokens || 0);
  }

  const rawJsonText = data?.choices?.[0]?.message?.content;
  const tPost0 = Date.now();
  const result = parseAccountingAIResponse(rawJsonText, currentScenario, userInput, context, deterministicScenario, standard);
  profiler.recordStage('assembly', Date.now() - tPost0);

  profiler.logSummary();
  return result;
}
