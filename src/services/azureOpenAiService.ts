import type { AccountingStandard, AccountingScenarioState, ChatMessage, JournalEntryGroup } from '../types/accounting';
import type { GuardrailViolation } from '../engine/accountingGuardrails';
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
import { toSafeProviderError } from './aiTransport';
import { isMeaningfulAIJsonPayload, getDeterministicFallbackGroups } from './geminiService';
import { isDeterministicFixture } from '../engine/scenarioParser';
import { defaultAccountingGuardrails } from '../engine/accountingGuardrails';
import type { TransactionUnderstanding } from './transactionUnderstandingService';

function getGuardrailErrorViolations(
  groups: JournalEntryGroup[],
  semanticUnderstanding?: TransactionUnderstanding
): GuardrailViolation[] {
  if (!semanticUnderstanding || groups.length === 0) return [];
  const validation = defaultAccountingGuardrails.validate(semanticUnderstanding, groups);
  return validation.violations.filter((v) => v.severity === 'ERROR');
}

function buildGuardrailValidationMessage(violations: GuardrailViolation[]): string {
  const errors = violations.filter((v) => v.severity === 'ERROR');
  if (errors.length === 0) return '';
  const list = errors.map((v) => `- ${v.code}: ${v.message}`).join('\n');
  const prefix = errors.length === 1 ? 'This entry has been rejected' : 'These entries have been rejected';
  return `### Accounting Validation Issue${errors.length > 1 ? 's' : ''}\n\nThe proposed journal failed one or more accounting safety checks:\n${list}\n\n${prefix} to prevent an incorrect accounting record.`;
}

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
Prior User Query: ${currentScenario.rawQuery || 'N/A'}
Prior Accounting Summary: ${currentScenario.accountingTreatmentSummary || 'N/A'}
Functional Currency: ${currentScenario.functionalCurrency || 'SGD'}
Pending Clarifications: ${currentScenario.missingFields?.map(m => `${m.fieldName}: ${m.prompt}`).join(' | ') || 'None'}
Active Parameters:
${JSON.stringify(currentScenario.keyParameters || [], null, 2)}
Committed / Active Double Entry Journal Groups:
${(currentScenario.committedDirectGroups?.length ? currentScenario.committedDirectGroups : currentScenario.directGroups)?.map((g, idx) => `Group #${idx + 1} (${g.eventDate}) - ${g.title}:\n` + g.lines.map(l => `  ${l.debit > 0 ? `Debit: ${l.accountName} (${l.accountCode || ''}) - SGD ${l.debit}` : `Credit: ${l.accountName} (${l.accountCode || ''}) - SGD ${l.credit}`}`).join('\n')).join('\n') || 'None'}
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
  if (!isMeaningfulAIJsonPayload(parsed, rawJsonText)) {
    throw new Error('AI provider returned malformed JSON.');
  }

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

  const result = postProcessAIResponse(parsed, currentScenario, userInput, fallbackContext, deterministicScenario, standard);

  // Validate AI proposed groups against deterministic accounting guardrails and fail-closed on ERROR violations
  const aiProposedGroups = result.scenarioState.directGroups;
  if (aiProposedGroups && aiProposedGroups.length > 0) {
    const aiErrors = getGuardrailErrorViolations(aiProposedGroups, fallbackContext.semanticUnderstanding);
    if (aiErrors.length > 0) {
      const deterministicFallback = getDeterministicFallbackGroups(currentScenario, deterministicScenario);
      if (isDeterministicFixture(userInput) && deterministicFallback && deterministicFallback.length > 0) {
        result.scenarioState.directGroups = deterministicFallback;
        result.scenarioState.isComplete = true;
        result.scenarioState.missingFields = result.scenarioState.missingFields?.filter((m) => !m.fieldKey.startsWith('guardrail-')) || [];
        result.messageText = `### AI-Proposed Journal Rejected\n\n${buildGuardrailValidationMessage(aiErrors)}\n\nThe AI-proposed journal was rejected. The deterministic journal has been restored.` +
          (result.messageText ? `\n\n---\n\n${result.messageText}` : '');
      } else {
        const priorCommitted = currentScenario?.committedDirectGroups ||
          (currentScenario?.isComplete ? (currentScenario?.directGroups || []).filter(g => !g.isHypothetical && g.isBalanced && g.totalDebit > 0) : undefined);
        result.scenarioState.directGroups = [];
        result.scenarioState.committedDirectGroups = priorCommitted;
        result.scenarioState.projectedGroups = [];
        result.scenarioState.isComplete = false;
        result.scenarioState.missingFields = [
          ...(result.scenarioState.missingFields || []),
          ...aiErrors.map((v) => ({
            fieldKey: `guardrail-${v.code}`,
            fieldName: 'Accounting Guardrail Violation',
            prompt: `${v.code}: ${v.message}`,
            whyNeeded: 'The AI-proposed journal violates fundamental double-entry or statutory accounting rules.'
          }))
        ];
        result.messageText = `### AI-Proposed Journal Rejected\n\n${buildGuardrailValidationMessage(aiErrors)}\n\nThe AI-proposed journal violates fundamental accounting rules and was not applied. Clarification is required.`;
      }
    }
  }

  return result;
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

  // 45-second AbortController timeout to guarantee reliable completion of complex statutory reasoning
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);

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
      throw new Error(`Azure OpenAI request timed out after 45s. Reverting to deterministic accounting engine.`);
    }
    throw new Error(`Azure OpenAI Connection Failed: Network error reaching ${endpoint}. Check endpoint address or CORS settings (${netErr?.message})`);
  } finally {
    clearTimeout(timeoutId);
  }

  profiler.recordStage('gemini_request', Date.now() - tReq0);

  if (!res.ok) {
    throw toSafeProviderError('Azure OpenAI', res.status);
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

  // 45-second AbortController timeout to guarantee reliable completion of complex statutory reasoning
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);

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
      throw new Error(`OpenAI request timed out after 45s. Reverting to deterministic accounting engine.`);
    }
    throw new Error(`OpenAI Connection Failed: Network error reaching ${url} (${netErr?.message})`);
  } finally {
    clearTimeout(timeoutId);
  }

  profiler.recordStage('gemini_request', Date.now() - tReq0);

  if (!res.ok) {
    throw toSafeProviderError('OpenAI', res.status);
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
