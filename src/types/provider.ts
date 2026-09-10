export type AIProviderType = 'azure' | 'gemini' | 'openai' | 'offline';

export interface AzureConfig {
  endpoint: string;        // e.g. "https://my-company.openai.azure.com" or "my-company"
  apiKey: string;          // 32-character Azure secret key
  deploymentName: string;  // e.g. "gpt-4o", "gpt-4o-mini"
  apiVersion: string;      // e.g. "2024-08-01-preview"
}

export interface GeminiConfig {
  apiKey: string;
  model: string;           // "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"
}

export interface OpenAIConfig {
  apiKey: string;
  model: string;           // "gpt-4o", "gpt-4o-mini"
  baseUrl?: string;        // Optional custom proxy e.g. "https://api.openai.com/v1" or local Ollama
}

export interface ProviderSettings {
  activeProvider: AIProviderType;
  azure: AzureConfig;
  gemini: GeminiConfig;
  openai: OpenAIConfig;
}

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  activeProvider: 'azure',
  azure: {
    endpoint: '',
    apiKey: '',
    deploymentName: 'gpt-4o',
    apiVersion: '2024-08-01-preview'
  },
  gemini: {
    apiKey: '',
    model: 'gemini-2.5-flash'
  },
  openai: {
    apiKey: '',
    model: 'gpt-4o'
  }
};

const SETTINGS_STORAGE_KEY = 'app_ai_provider_settings';

function normalizeGeminiModel(m?: string): string {
  if (!m || m.startsWith('gemini-3.') || m.includes('flash-lite')) {
    return 'gemini-2.5-flash';
  }
  return m;
}

export function loadProviderSettings(): ProviderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        activeProvider: parsed.activeProvider || 'azure',
        azure: {
          endpoint: parsed.azure?.endpoint || '',
          apiKey: parsed.azure?.apiKey || '',
          deploymentName: parsed.azure?.deploymentName || 'gpt-4o',
          apiVersion: parsed.azure?.apiVersion || '2024-08-01-preview'
        },
        gemini: {
          apiKey: parsed.gemini?.apiKey || localStorage.getItem('gemini_api_key') || '',
          model: normalizeGeminiModel(parsed.gemini?.model || localStorage.getItem('gemini_model'))
        },
        openai: {
          apiKey: parsed.openai?.apiKey || '',
          model: parsed.openai?.model || 'gpt-4o',
          baseUrl: parsed.openai?.baseUrl || ''
        }
      };
    }
  } catch (e) {
    console.warn('Failed to parse saved provider settings:', e);
  }

  // Fallback: migrate existing standalone gemini key if present
  const existingGeminiKey = localStorage.getItem('gemini_api_key') || '';
  const existingGeminiModel = normalizeGeminiModel(localStorage.getItem('gemini_model') || 'gemini-2.5-flash');
  
  return {
    ...DEFAULT_PROVIDER_SETTINGS,
    activeProvider: existingGeminiKey ? 'gemini' : 'azure',
    gemini: {
      apiKey: existingGeminiKey,
      model: existingGeminiModel
    }
  };
}

export function saveProviderSettings(settings: ProviderSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    // Keep backwards compatibility for legacy keys
    if (settings.gemini.apiKey) {
      localStorage.setItem('gemini_api_key', settings.gemini.apiKey);
      localStorage.setItem('gemini_model', settings.gemini.model);
    }
  } catch (e) {
    console.warn('Failed to save provider settings to localStorage:', e);
  }
}
