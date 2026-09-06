import React, { useState } from 'react';
import {
  BookOpen,
  Sparkles,
  CheckCircle2,
  HelpCircle,
  Globe,
  Cpu,
  Type,
  Sun,
  Moon,
  Cloud,
  ShieldCheck,
  Server,
  Settings as SettingsIcon
} from 'lucide-react';
import type { ProviderSettings, AIProviderType } from '../types/provider';

export type AppFontSize = 'normal' | 'large' | 'xl';

interface HeaderProps {
  theme: 'light' | 'dark';
  onThemeToggle: () => void;
  fontSize: AppFontSize;
  onFontSizeChange: (size: AppFontSize) => void;
  providerSettings: ProviderSettings;
  onProviderSettingsSave: (settings: ProviderSettings) => void;
}

export const Header: React.FC<HeaderProps> = ({
  theme,
  onThemeToggle,
  fontSize,
  onFontSizeChange,
  providerSettings,
  onProviderSettingsSave
}) => {
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<AIProviderType>(providerSettings.activeProvider);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Local draft state
  const [azureEndpoint, setAzureEndpoint] = useState(providerSettings.azure.endpoint);
  const [azureDeployment, setAzureDeployment] = useState(providerSettings.azure.deploymentName);
  const [azureKey, setAzureKey] = useState(providerSettings.azure.apiKey);
  const [azureVersion, setAzureVersion] = useState(providerSettings.azure.apiVersion);

  const [geminiKey, setGeminiKey] = useState(providerSettings.gemini.apiKey);
  const [geminiModel, setGeminiModel] = useState(providerSettings.gemini.model);

  const [openaiKey, setOpenaiKey] = useState(providerSettings.openai.apiKey);
  const [openaiModel, setOpenaiModel] = useState(providerSettings.openai.model);

  const handleOpenSettings = () => {
    setActiveTab(providerSettings.activeProvider);
    setAzureEndpoint(providerSettings.azure.endpoint);
    setAzureDeployment(providerSettings.azure.deploymentName);
    setAzureKey(providerSettings.azure.apiKey);
    setAzureVersion(providerSettings.azure.apiVersion);

    setGeminiKey(providerSettings.gemini.apiKey);
    setGeminiModel(providerSettings.gemini.model);

    setOpenaiKey(providerSettings.openai.apiKey);
    setOpenaiModel(providerSettings.openai.model);

    setShowSettings(true);
  };

  const handleSave = () => {
    const updated: ProviderSettings = {
      activeProvider: activeTab,
      azure: {
        endpoint: azureEndpoint.trim(),
        deploymentName: azureDeployment.trim(),
        apiKey: azureKey.trim(),
        apiVersion: azureVersion.trim() || '2024-08-01-preview'
      },
      gemini: {
        apiKey: geminiKey.trim(),
        model: geminiModel
      },
      openai: {
        apiKey: openaiKey.trim(),
        model: openaiModel
      }
    };

    onProviderSettingsSave(updated);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      setShowSettings(false);
    }, 900);
  };

  // Helper badge text for the current provider
  const getProviderBadge = () => {
    const active = providerSettings.activeProvider;
    if (active === 'azure') {
      const hasKey = !!providerSettings.azure.apiKey;
      return {
        label: providerSettings.azure.deploymentName ? `Azure: ${providerSettings.azure.deploymentName}` : 'Azure OpenAI',
        connected: hasKey,
        icon: <Cloud className="w-3.5 h-3.5 text-sky-400 shrink-0" />
      };
    }
    if (active === 'gemini') {
      const hasKey = !!providerSettings.gemini.apiKey;
      return {
        label: providerSettings.gemini.model.replace('gemini-', 'Gemini '),
        connected: hasKey,
        icon: <Sparkles className="w-3.5 h-3.5 text-blue-400 shrink-0" />
      };
    }
    if (active === 'openai') {
      const hasKey = !!providerSettings.openai.apiKey;
      return {
        label: `OpenAI: ${providerSettings.openai.model}`,
        connected: hasKey,
        icon: <Server className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
      };
    }
    return {
      label: 'Offline Statutory Engine',
      connected: true,
      icon: <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
    };
  };

  const badgeInfo = getProviderBadge();

  return (
    <>
      <header className="bg-white/95 dark:bg-slate-900/95 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-40 backdrop-blur-md shadow-sm transition-colors duration-200">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-2">
          {/* App Brand & Title */}
          <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-ynab-navy dark:bg-slate-800 text-white flex items-center justify-center shadow-sm shrink-0 border border-slate-900/10 dark:border-slate-700/80">
              <BookOpen className="w-4 h-4 sm:w-5 sm:h-5 text-ynab-blue dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-base md:text-lg font-bold text-ynab-navy dark:text-white tracking-tight leading-tight truncate font-sans">
                  <span className="xs:hidden">Accounting AI</span>
                  <span className="hidden xs:inline">Accounting Assistant</span>
                </h1>
                <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-slate-800/90 dark:text-slate-300 dark:border-slate-700/80 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-ynab-green"></span>
                  SFRS(I) & IFRS Dual Compliant
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 hidden sm:block truncate">
                Universal Accounting Engine • IRAS • ACRA • CPF • MOM • MAS (Singapore DD/MM/YYYY)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {/* ECB FX Live Indicator */}
            <div
              className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-300 text-xs font-medium"
              title="Live foreign exchange rates powered by Frankfurter API (ECB)"
            >
              <Globe className="w-3.5 h-3.5 text-slate-400" />
              <span>ECB FX Live</span>
              <span className="w-1.5 h-1.5 rounded-full bg-ynab-green"></span>
            </div>

            {/* Font Size Adjuster */}
            <div
              className="flex items-center bg-slate-100 dark:bg-slate-800/90 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700/80 text-xs shadow-inner"
              title="Adjust application font size"
            >
              <span className="px-1 text-slate-400 hidden md:inline-flex items-center">
                <Type className="w-3 h-3 mr-0.5" />
              </span>
              <button
                onClick={() => onFontSizeChange('normal')}
                className={`px-1.5 sm:px-2 py-1 rounded font-semibold text-[11px] sm:text-xs transition-all ${
                  fontSize === 'normal'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
                title="Standard Font Size"
              >
                A-
              </button>
              <button
                onClick={() => onFontSizeChange('large')}
                className={`px-1.5 sm:px-2.5 py-1 rounded font-semibold text-[11px] sm:text-xs transition-all ${
                  fontSize === 'large'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
                title="Bigger Font Size (Default)"
              >
                A
              </button>
              <button
                onClick={() => onFontSizeChange('xl')}
                className={`px-1.5 sm:px-2 py-1 rounded font-semibold text-[11px] sm:text-xs transition-all ${
                  fontSize === 'xl'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
                title="Extra Large Font Size"
              >
                A+
              </button>
            </div>

            {/* Light / Dark Theme Switcher Button */}
            <button
              onClick={onThemeToggle}
              className="p-1.5 sm:p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-all shadow-sm"
              title={theme === 'dark' ? 'Switch to YNAB Light Mode' : 'Switch to Dark Mode'}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400 transition-transform duration-200 hover:rotate-45" />
              ) : (
                <Moon className="w-4 h-4 text-slate-700 transition-transform duration-200 hover:-rotate-12" />
              )}
            </button>

            {/* AI Provider Settings Button */}
            <button
              onClick={handleOpenSettings}
              className="flex items-center gap-1 sm:gap-2 px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/90 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-750 transition-all shadow-sm"
              title="Configure AI Provider (Azure OpenAI, Gemini, OpenAI, or Offline)"
            >
              {badgeInfo.icon}
              <span className="hidden sm:inline font-medium text-slate-700 dark:text-slate-200 truncate max-w-[140px]">
                {badgeInfo.label}
              </span>
              <span className="sm:hidden text-[11px] font-medium">AI</span>
              {badgeInfo.connected ? (
                <span className="w-1.5 h-1.5 rounded-full bg-ynab-green shrink-0" title="Connected"></span>
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-ynab-amber shrink-0" title="API Key Required"></span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Multi-Provider Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-5 sm:p-6 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between bg-slate-50/50 dark:bg-slate-900/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-ynab-blue/10 dark:bg-slate-800 text-ynab-blue dark:text-blue-400 flex items-center justify-center border border-ynab-blue/20 dark:border-slate-700">
                  <SettingsIcon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">AI Provider & API Settings</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Choose and configure your enterprise or local AI backend
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-2xl leading-none px-1"
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            {/* Provider Tabs */}
            <div className="px-5 pt-3 border-b border-slate-200 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-950/40 flex gap-2 overflow-x-auto no-scrollbar">
              <button
                onClick={() => setActiveTab('azure')}
                className={`pb-2.5 px-3 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-all whitespace-nowrap ${
                  activeTab === 'azure'
                    ? 'border-ynab-blue text-ynab-blue dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Cloud className="w-3.5 h-3.5" />
                Microsoft Azure
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300 font-medium ml-1">
                  Enterprise
                </span>
              </button>

              <button
                onClick={() => setActiveTab('gemini')}
                className={`pb-2.5 px-3 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-all whitespace-nowrap ${
                  activeTab === 'gemini'
                    ? 'border-ynab-blue text-ynab-blue dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Google Gemini
              </button>

              <button
                onClick={() => setActiveTab('openai')}
                className={`pb-2.5 px-3 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-all whitespace-nowrap ${
                  activeTab === 'openai'
                    ? 'border-ynab-blue text-ynab-blue dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Server className="w-3.5 h-3.5" />
                OpenAI Direct
              </button>

              <button
                onClick={() => setActiveTab('offline')}
                className={`pb-2.5 px-3 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-all whitespace-nowrap ${
                  activeTab === 'offline'
                    ? 'border-ynab-blue text-ynab-blue dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Offline Engine
              </button>
            </div>

            {/* Modal Tab Body */}
            <div className="p-5 sm:p-6 space-y-4 max-h-[60vh] overflow-y-auto">
              {/* AZURE OPENAI TAB */}
              {activeTab === 'azure' && (
                <div className="space-y-3.5 animate-in fade-in duration-150">
                  <div className="p-3 bg-sky-50 dark:bg-sky-950/40 rounded-xl border border-sky-100 dark:border-sky-900/50 text-xs text-sky-900 dark:text-sky-200">
                    <p className="font-semibold mb-1 flex items-center gap-1.5">
                      <Cloud className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                      Microsoft Azure OpenAI Enterprise Client
                    </p>
                    <p className="text-[11px] text-sky-800/90 dark:text-sky-300/90 leading-relaxed">
                      Direct HTTPS calls from your browser to your company's Azure tenant. Keys and prompts are never sent to third-party proxy servers.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Azure OpenAI Resource Endpoint <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={azureEndpoint}
                      onChange={(e) => setAzureEndpoint(e.target.value)}
                      placeholder="https://my-company.openai.azure.com"
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-ynab-blue"
                    />
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      Resource URL from Azure Portal or Azure AI Foundry (e.g. <code className="font-mono">https://&lt;resource&gt;.openai.azure.com</code>).
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Deployment Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={azureDeployment}
                        onChange={(e) => setAzureDeployment(e.target.value)}
                        placeholder="gpt-4o"
                        className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-ynab-blue"
                      />
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        Deployment name under Azure OpenAI Studio &gt; Deployments.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        API Version
                      </label>
                      <input
                        type="text"
                        value={azureVersion}
                        onChange={(e) => setAzureVersion(e.target.value)}
                        placeholder="2024-08-01-preview"
                        className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-ynab-blue"
                      />
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        Defaults to <code className="font-mono">2024-08-01-preview</code>.
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Azure API Key <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      value={azureKey}
                      onChange={(e) => setAzureKey(e.target.value)}
                      placeholder="Enter Azure 32-character key..."
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-ynab-blue"
                    />
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      Located in Azure Portal under <em>Keys and Endpoint</em> (Key 1 or Key 2). Stored securely in <code className="font-mono">localStorage</code>.
                    </p>
                  </div>
                </div>
              )}

              {/* GOOGLE GEMINI TAB */}
              {activeTab === 'gemini' && (
                <div className="space-y-3.5 animate-in fade-in duration-150">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Google Gemini API Key
                    </label>
                    <input
                      type="password"
                      value={geminiKey}
                      onChange={(e) => setGeminiKey(e.target.value)}
                      placeholder="AIzaSy..."
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-ynab-blue"
                    />
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      Obtain from Google AI Studio. Stored strictly in browser <code className="font-mono">localStorage</code>.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5 text-slate-400" />
                      <span>Gemini Model Selection</span>
                    </label>
                    <select
                      value={geminiModel}
                      onChange={(e) => setGeminiModel(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-ynab-blue"
                    >
                      <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite (Default - High Daily Quota, 500 RPD)</option>
                      <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (High Daily Quota - 500 RPD)</option>
                      <option value="gemini-3.8-flash">Gemini 3.8 Flash (High Capacity - 20 RPD)</option>
                    </select>
                  </div>
                </div>
              )}

              {/* OPENAI DIRECT TAB */}
              {activeTab === 'openai' && (
                <div className="space-y-3.5 animate-in fade-in duration-150">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      OpenAI API Key
                    </label>
                    <input
                      type="password"
                      value={openaiKey}
                      onChange={(e) => setOpenaiKey(e.target.value)}
                      placeholder="sk-proj-..."
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-ynab-blue"
                    />
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      Direct OpenAI API key from platform.openai.com.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      OpenAI Model
                    </label>
                    <select
                      value={openaiModel}
                      onChange={(e) => setOpenaiModel(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-ynab-blue"
                    >
                      <option value="gpt-4o">gpt-4o (Omni - Recommended)</option>
                      <option value="gpt-4o-mini">gpt-4o-mini (Fast & Low Cost)</option>
                      <option value="gpt-4-turbo">gpt-4-turbo</option>
                    </select>
                  </div>
                </div>
              )}

              {/* OFFLINE ENGINE TAB */}
              {activeTab === 'offline' && (
                <div className="space-y-3.5 animate-in fade-in duration-150">
                  <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl border border-emerald-200 dark:border-emerald-900/50 text-xs text-emerald-900 dark:text-emerald-200">
                    <p className="font-semibold mb-1 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      100% Offline Singapore Statutory Engine
                    </p>
                    <p className="text-[11px] text-emerald-800/90 dark:text-emerald-300/90 leading-relaxed">
                      No cloud API keys or external endpoints required. The system runs deterministic accounting rules, compound double-entry balancing, and Singapore regulatory directives (IRAS, ACRA, CPF Board, MOM, MAS) completely within your browser.
                    </p>
                  </div>

                  <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5 list-disc pl-5">
                    <li>Full compliance with SFRS(I) 1-16, SFRS(I) 9, SFRS(I) 16, and IAS 21.</li>
                    <li>Automatic Singapore 9% GST calculations with Regulation 26 car blockage rules.</li>
                    <li>ACRA Section 205C Small Company Audit Exemption criteria.</li>
                    <li>2026 CPF Ordinary Wage $8,000 ceiling calculations.</li>
                  </ul>
                </div>
              )}

              {/* Fallback info */}
              <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 flex items-start gap-2.5">
                <HelpCircle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-600 dark:text-slate-300 space-y-0.5">
                  <p className="font-semibold text-slate-800 dark:text-slate-200">Resilient Offline Fallback</p>
                  <p className="text-slate-500 dark:text-slate-400 text-[11px]">
                    If your chosen provider encounters quota or network errors, the application automatically falls back to the built-in Singapore Statutory Engine.
                  </p>
                </div>
              </div>

              {savedSuccess && (
                <div className="p-2.5 bg-emerald-50 text-emerald-800 dark:bg-slate-950 dark:text-emerald-300 border border-emerald-200 dark:border-slate-800 rounded-lg text-xs font-medium flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  Settings saved successfully! Active backend: <strong>{activeTab.toUpperCase()}</strong>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 sm:px-6 py-4 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Selected: <strong className="text-slate-700 dark:text-slate-200">{activeTab.toUpperCase()}</strong>
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowSettings(false)}
                  className="px-3.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-ynab-blue hover:bg-blue-600 rounded-lg shadow-sm transition-all"
                >
                  Save & Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
