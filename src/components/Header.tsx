import React, { useState, useEffect } from 'react';
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

  // Stop background scrolling when a modal window is open ("windows up front")
  useEffect(() => {
    if (showSettings) {
      const prevOverflow = document.body.style.overflow;
      const prevPaddingRight = document.body.style.paddingRight;
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
      }
      document.body.style.overflow = 'hidden';

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setShowSettings(false);
        }
      };
      window.addEventListener('keydown', handleKeyDown);

      return () => {
        document.body.style.overflow = prevOverflow || '';
        document.body.style.paddingRight = prevPaddingRight || '';
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [showSettings]);

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
      <header className="bg-white/95 dark:bg-[#0F1626]/95 border-b border-slate-200 dark:border-[#2B374E] sticky top-0 z-40 backdrop-blur-md shadow-sm transition-colors duration-200">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-2">
          {/* App Brand & Title */}
          <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-ynab-navy dark:bg-[#1C2538] text-white flex items-center justify-center shadow-sm shrink-0 border border-slate-900/10 dark:border-[#2B374E]">
              <BookOpen className="w-4 h-4 sm:w-5 sm:h-5 text-ynab-blue dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-base md:text-lg font-bold text-ynab-navy dark:text-white tracking-tight leading-tight truncate font-sans">
                  <span className="xs:hidden">SG Accounting AI</span>
                  <span className="hidden xs:inline">Singapore Accounting & Statutory Assistant</span>
                </h1>
                <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-[#1C2538] dark:text-emerald-300 dark:border-emerald-900/60 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-ynab-green"></span>
                  SFRS(I) • IRAS • ACRA • MOM • CPF
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 hidden sm:block truncate">
                Singapore Authoritative Accounting, Tax & Regulatory Research Engine • DD/MM/YYYY • SGD
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {/* ECB FX Live Indicator */}
            <div
              className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-[#1C2538] border border-slate-200 dark:border-[#2B374E] text-slate-700 dark:text-slate-300 text-xs font-medium"
              title="Live foreign exchange rates powered by Frankfurter API (ECB)"
            >
              <Globe className="w-3.5 h-3.5 text-slate-400" />
              <span>ECB FX Live</span>
              <span className="w-1.5 h-1.5 rounded-full bg-ynab-green"></span>
            </div>

            {/* Font Size Adjuster */}
            <div
              className="flex items-center bg-slate-100 dark:bg-[#1C2538] p-0.5 rounded-lg border border-slate-200 dark:border-[#2B374E] text-xs shadow-inner"
              title="Adjust application font size"
            >
              <span className="px-1 text-slate-400 hidden md:inline-flex items-center">
                <Type className="w-3 h-3 mr-0.5" />
              </span>
              <button
                onClick={() => onFontSizeChange('normal')}
                className={`px-1.5 sm:px-2 py-1 rounded font-semibold text-[11px] sm:text-xs transition-all ${
                  fontSize === 'normal'
                    ? 'bg-white dark:bg-[#242F46] text-slate-900 dark:text-white shadow-xs'
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
                    ? 'bg-white dark:bg-[#242F46] text-slate-900 dark:text-white shadow-xs'
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
                    ? 'bg-white dark:bg-[#242F46] text-slate-900 dark:text-white shadow-xs'
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
              className="p-1.5 sm:p-2 rounded-lg border border-slate-200 dark:border-[#2B374E] bg-slate-100 hover:bg-slate-200 dark:bg-[#1C2538] dark:hover:bg-[#242F46] text-slate-700 dark:text-slate-200 transition-all shadow-xs"
              title={theme === 'dark' ? 'Switch to YNAB Light Mode' : 'Switch to YNAB Dark Mode'}
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
              className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-[#2B374E] bg-slate-50 dark:bg-[#1C2538] text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#242F46] transition-all shadow-xs"
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowSettings(false);
            }
          }}
        >
          <div
            className="bg-white dark:bg-[#1C2538] rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 dark:border-[#2B374E] overflow-hidden animate-in zoom-in-95 duration-150 my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-[#2B374E] flex items-start justify-between bg-slate-50/70 dark:bg-[#151D2C]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-ynab-blue/10 dark:bg-[#242F46] text-ynab-blue dark:text-blue-400 flex items-center justify-center border border-ynab-blue/20 dark:border-[#2B374E] shrink-0">
                  <SettingsIcon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    AI Provider & API Settings
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Choose and configure your enterprise or local AI backend
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-2xl leading-none px-1 transition-colors"
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            {/* Provider Tabs - 4-Segment Grid: 100% visible, no scrolling needed! */}
            <div className="p-3 sm:p-4 border-b border-slate-200 dark:border-[#2B374E] bg-slate-50 dark:bg-[#151D2C]">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {/* Tab 1: Microsoft Azure */}
                <button
                  type="button"
                  onClick={() => setActiveTab('azure')}
                  className={`p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between min-h-[64px] shadow-xs cursor-pointer ${
                    activeTab === 'azure'
                      ? 'bg-white dark:bg-[#242F46] border-ynab-blue dark:border-blue-400 text-ynab-blue dark:text-white ring-2 ring-ynab-blue/20'
                      : 'bg-slate-100/80 dark:bg-[#1C2538] border-slate-200 dark:border-[#2B374E] text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-[#242F46]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <Cloud className="w-4 h-4 text-sky-500" />
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-sky-100 dark:bg-sky-950/90 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                      Enterprise
                    </span>
                  </div>
                  <div>
                    <div className="text-xs font-bold leading-tight">MS Azure</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">OpenAI Tenant</div>
                  </div>
                </button>

                {/* Tab 2: Google Gemini */}
                <button
                  type="button"
                  onClick={() => setActiveTab('gemini')}
                  className={`p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between min-h-[64px] shadow-xs cursor-pointer ${
                    activeTab === 'gemini'
                      ? 'bg-white dark:bg-[#242F46] border-ynab-blue dark:border-blue-400 text-ynab-blue dark:text-white ring-2 ring-ynab-blue/20'
                      : 'bg-slate-100/80 dark:bg-[#1C2538] border-slate-200 dark:border-[#2B374E] text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-[#242F46]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <Sparkles className="w-4 h-4 text-blue-500" />
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-blue-100 dark:bg-blue-950/90 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                      Google
                    </span>
                  </div>
                  <div>
                    <div className="text-xs font-bold leading-tight">Gemini</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">3.5 Flash Lite</div>
                  </div>
                </button>

                {/* Tab 3: OpenAI Direct */}
                <button
                  type="button"
                  onClick={() => setActiveTab('openai')}
                  className={`p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between min-h-[64px] shadow-xs cursor-pointer ${
                    activeTab === 'openai'
                      ? 'bg-white dark:bg-[#242F46] border-ynab-blue dark:border-blue-400 text-ynab-blue dark:text-white ring-2 ring-ynab-blue/20'
                      : 'bg-slate-100/80 dark:bg-[#1C2538] border-slate-200 dark:border-[#2B374E] text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-[#242F46]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <Server className="w-4 h-4 text-emerald-500" />
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950/90 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      Direct
                    </span>
                  </div>
                  <div>
                    <div className="text-xs font-bold leading-tight">OpenAI</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">gpt-4o</div>
                  </div>
                </button>

                {/* Tab 4: Offline Engine */}
                <button
                  type="button"
                  onClick={() => setActiveTab('offline')}
                  className={`p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between min-h-[64px] shadow-xs cursor-pointer ${
                    activeTab === 'offline'
                      ? 'bg-white dark:bg-[#242F46] border-ynab-blue dark:border-blue-400 text-ynab-blue dark:text-white ring-2 ring-ynab-blue/20'
                      : 'bg-slate-100/80 dark:bg-[#1C2538] border-slate-200 dark:border-[#2B374E] text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-[#242F46]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <ShieldCheck className="w-4 h-4 text-ynab-green" />
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950/90 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      100% Local
                    </span>
                  </div>
                  <div>
                    <div className="text-xs font-bold leading-tight">Offline</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">Singapore Law</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Modal Tab Body */}
            <div className="p-4 sm:p-6 space-y-4 max-h-[62vh] overflow-y-auto">
              {/* AZURE OPENAI TAB */}
              {activeTab === 'azure' && (
                <div className="space-y-3.5 animate-in fade-in duration-150">
                  <div className="p-3.5 bg-sky-50 dark:bg-[#151D2C] rounded-xl border border-sky-100 dark:border-[#2B374E] text-xs text-sky-900 dark:text-sky-200">
                    <p className="font-semibold mb-1 flex items-center gap-1.5">
                      <Cloud className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                      Microsoft Azure OpenAI Enterprise Client
                    </p>
                    <p className="text-[11px] text-sky-800/90 dark:text-sky-300/90 leading-relaxed">
                      Direct client-to-tenant HTTPS calls to your company's Azure OpenAI resource. Zero intermediate proxy servers. Keys are kept strictly in your local browser storage.
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
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-[#2B374E] rounded-lg text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-ynab-blue"
                    />
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      Resource URL from Azure Portal or Azure AI Foundry (e.g. <code className="font-mono">https://&lt;resource&gt;.openai.azure.com</code> or just resource name).
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
                        className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-[#2B374E] rounded-lg text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-ynab-blue"
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
                        className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-[#2B374E] rounded-lg text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-ynab-blue"
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
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-[#2B374E] rounded-lg text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-ynab-blue"
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
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-[#2B374E] rounded-lg text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-ynab-blue"
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
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-[#2B374E] rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-ynab-blue"
                    >
                      <option value="gemini-2.5-flash">Gemini 2.5 Flash (Recommended - Ultra-Fast Grounded Reasoning)</option>
                      <option value="gemini-2.0-flash">Gemini 2.0 Flash (Fast Interactive - Low Latency)</option>
                      <option value="gemini-1.5-flash">Gemini 1.5 Flash (High Stability & Quota)</option>
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
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-[#2B374E] rounded-lg text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-ynab-blue"
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
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-[#2B374E] rounded-lg text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-ynab-blue"
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
                  <div className="p-3.5 bg-emerald-50 dark:bg-[#151D2C] rounded-xl border border-emerald-200 dark:border-[#2B374E] text-xs text-emerald-900 dark:text-emerald-200">
                    <p className="font-semibold mb-1 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      100% Offline Singapore Statutory Engine
                    </p>
                    <p className="text-[11px] text-emerald-800/90 dark:text-emerald-300/90 leading-relaxed">
                      Zero cloud API keys or external endpoints required. The system runs deterministic accounting rules, compound double-entry balancing, and Singapore regulatory directives completely within your local browser.
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

              {/* Resilient fallback notice */}
              <div className="p-3 bg-slate-50 dark:bg-[#151D2C] rounded-xl border border-slate-200 dark:border-[#2B374E] flex items-start gap-2.5">
                <HelpCircle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-600 dark:text-slate-300 space-y-0.5">
                  <p className="font-semibold text-slate-800 dark:text-slate-200">Resilient Offline Fallback</p>
                  <p className="text-slate-500 dark:text-slate-400 text-[11px]">
                    If your chosen provider encounters quota or network errors, the application automatically falls back to the built-in Singapore Statutory Engine.
                  </p>
                </div>
              </div>

              {savedSuccess && (
                <div className="p-2.5 bg-emerald-50 text-emerald-800 dark:bg-[#151D2C] dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-lg text-xs font-medium flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  Settings saved successfully! Active backend: <strong>{activeTab.toUpperCase()}</strong>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 sm:px-6 py-4 bg-slate-50 dark:bg-[#151D2C] border-t border-slate-200 dark:border-[#2B374E] flex items-center justify-between gap-2">
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
