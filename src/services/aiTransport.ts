/**
 * Decoupled AI Transport Layer
 *
 * Provides a provider-neutral, low-level HTTP transport for executing structured LLM calls
 * (Gemini, Azure OpenAI, OpenAI) with explicit JSON mode, timeouts, and error handling.
 *
 * Eliminates circular dependencies between geminiService and transactionUnderstandingService.
 */

import type { ProviderSettings } from '../types/provider';

export interface StructuredLlmOptions {
  jsonMode?: boolean;
  model?: string;
  timeoutMs?: number;
  temperature?: number;
}

/**
 * Normalizes Azure OpenAI endpoint URL.
 */
export function normalizeAzureEndpointUrl(endpoint: string): string {
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

/**
 * Executes a structured prompt against the active AI provider and returns the raw response text.
 */
export async function executeStructuredLlmCall(
  prompt: string,
  systemInstruction: string,
  providerOrApiKey?: ProviderSettings | string,
  options: StructuredLlmOptions = {}
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 45000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // 1. Direct Gemini API Key String
    if (typeof providerOrApiKey === 'string' && providerOrApiKey.trim().length > 10) {
      const apiKey = providerOrApiKey.trim();
      const model = options.model || 'gemini-3.5-flash-lite';
      return await callGeminiDirect(apiKey, model, prompt, systemInstruction, controller.signal, options.temperature);
    }

    // 2. Structured ProviderSettings
    if (providerOrApiKey && typeof providerOrApiKey === 'object') {
      const active = providerOrApiKey.activeProvider;

      if (active === 'gemini') {
        const apiKey = providerOrApiKey.gemini?.apiKey?.trim();
        if (!apiKey || apiKey.length < 10) {
          throw new Error('Gemini API key is not configured or too short.');
        }
        const model = options.model || providerOrApiKey.gemini?.model || 'gemini-3.5-flash-lite';
        return await callGeminiDirect(apiKey, model, prompt, systemInstruction, controller.signal, options.temperature);
      }

      if (active === 'azure') {
        const azure = providerOrApiKey.azure;
        if (!azure?.apiKey || !azure?.endpoint) {
          throw new Error('Azure OpenAI endpoint or API key is not configured.');
        }
        const endpoint = normalizeAzureEndpointUrl(azure.endpoint);
        const deployment = azure.deploymentName || 'gpt-4o';
        const apiVersion = azure.apiVersion || '2024-08-01-preview';
        const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': azure.apiKey
          },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: prompt }
            ],
            response_format: options.jsonMode !== false ? { type: 'json_object' } : undefined,
            temperature: options.temperature ?? 0.1
          }),
          signal: controller.signal
        });

        if (!res.ok) {
          throw new Error(`Azure OpenAI HTTP ${res.status}: ${await res.text()}`);
        }
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (!text) throw new Error('Empty response from Azure OpenAI');
        return text;
      }

      if (active === 'openai') {
        const openai = providerOrApiKey.openai;
        if (!openai?.apiKey) {
          throw new Error('OpenAI API key is not configured.');
        }
        const baseUrl = openai.baseUrl?.trim().replace(/\/+$/, '') || 'https://api.openai.com/v1';
        const model = options.model || openai.model || 'gpt-4o';
        const url = `${baseUrl}/chat/completions`;

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openai.apiKey}`
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: prompt }
            ],
            response_format: options.jsonMode !== false ? { type: 'json_object' } : undefined,
            temperature: options.temperature ?? 0.1
          }),
          signal: controller.signal
        });

        if (!res.ok) {
          throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`);
        }
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (!text) throw new Error('Empty response from OpenAI');
        return text;
      }
    }

    throw new Error('No active AI provider configured or valid API key provided.');
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callGeminiDirect(
  apiKey: string,
  model: string,
  prompt: string,
  systemInstruction: string,
  signal: AbortSignal,
  temperature: number = 0.1
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const requestBody: any = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature
    }
  };

  if (systemInstruction) {
    requestBody.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    signal
  });

  if (!res.ok) {
    throw new Error(`Gemini API HTTP ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Empty response from Gemini API');
  }
  return text;
}
