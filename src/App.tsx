import React, { useState, useEffect } from 'react';
import type {
  AccountingStandard,
  AccountingScenarioState,
  ChatMessage
} from './types/accounting';
import { Header, type AppFontSize } from './components/Header';
import { ChatPanel } from './components/ChatPanel';
import { InputHandlerPanel } from './components/InputHandlerPanel';
import { JournalTable } from './components/JournalTable';
import { ComplianceRationale } from './components/ComplianceRationale';
import { calculateDoubleEntries } from './engine/accountingEngine';
import { processAccountingQuery } from './services/geminiService';
import { loadProviderSettings, saveProviderSettings, type ProviderSettings } from './types/provider';
import { FileSpreadsheet, BookCheck } from 'lucide-react';
import { getSingaporeTimestamp } from './utils/dateUtils';

export const App: React.FC = () => {
  // SFRS follows IFRS - unified standard framework
  const standard: AccountingStandard = 'SFRS_I';

  // Font Size Management (Default: bigger / 'large')
  const [fontSize, setFontSize] = useState<AppFontSize>(() => {
    return (localStorage.getItem('app_font_size') as AppFontSize) || 'large';
  });

  useEffect(() => {
    document.documentElement.classList.remove('font-normal', 'font-large', 'font-xl');
    document.documentElement.classList.add(`font-${fontSize}`);
    localStorage.setItem('app_font_size', fontSize);
  }, [fontSize]);

  // Theme Management (Light mode default with YNAB styling, seamless Dark mode toggle)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('app_theme') as 'light' | 'dark') || 'light';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('app_theme', theme);
  }, [theme]);

  const handleThemeToggle = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Provider Settings Management (Azure OpenAI, Gemini, OpenAI, Offline)
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(() => {
    return loadProviderSettings();
  });

  const handleProviderSettingsSave = (newSettings: ProviderSettings) => {
    setProviderSettings(newSettings);
    saveProviderSettings(newSettings);
  };

  const [scenario, setScenario] = useState<AccountingScenarioState | null>(null);
  const [activeTab, setActiveTab] = useState<'entries' | 'compliance'>('entries');
  const [isLoading, setIsLoading] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-msg',
      sender: 'assistant',
      timestamp: getSingaporeTimestamp(),
      text: `Hello! I am your authoritative **Singapore Accounting, Tax & Regulatory Research Assistant**.\n\nI provide correct, traceable guidance for Singapore accounting professionals grounded in official legislation and accounting standards:\n* **SFRS(I) & Financial Reporting**: Capitalisation criteria (SFRS(I) 1-38 §57), revenue recognition (SFRS(I) 15), provisions, leases, and balanced double entries.\n* **IRAS Corporate Tax & GST**: Section 14 deductibility vs Section 15 disallowance, Enterprise Innovation Scheme (EIS 400%), Capital Allowances (S19/19A), and 9% GST registration ($1M) / blocked input tax (Reg 26).\n* **ACRA Compliance**: Small company audit exemption criteria (Companies Act §205C 2-of-3 criteria), AGM and annual return statutory timelines.\n* **CPF Board & MOM**: 2026 CPF Ordinary Wage monthly ceiling ($8,000 cap), tiered age rates, and Employment Act statutory leave & overtime rules.\n* **Dual View Grounding**: Systematic bifurcation of Financial Reporting Treatment from Singapore Tax Treatment with verified statutory citations.`
    }
  ]);

  const handleSendMessage = async (text: string) => {
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      timestamp: getSingaporeTimestamp(),
      text
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const response = await processAccountingQuery(
        text,
        scenario,
        standard,
        providerSettings,
        providerSettings.gemini.model,
        [...messages, userMsg]
      );

      setScenario(response.scenarioState);

      // Auto-switch tabs based on query intent
      if (
        response.scenarioState?.queryIntent === 'STATUTORY_ADVISORY' ||
        (!response.scenarioState?.directGroups?.some((g) => g.lines.length > 0) &&
          ((response.scenarioState?.statutoryAdvisory && response.scenarioState.statutoryAdvisory.length > 0) ||
            response.scenarioState?.accountingTreatmentSummary ||
            response.scenarioState?.singaporeTaxTreatmentSummary ||
            response.scenarioState?.regulatoryMandatesSummary))
      ) {
        setActiveTab('compliance');
      } else if (response.scenarioState?.directGroups?.some((g) => g.lines.length > 0)) {
        setActiveTab('entries');
      }

      const assistantMsg: ChatMessage = {
        id: `asst-${Date.now()}`,
        sender: 'assistant',
        timestamp: getSingaporeTimestamp(),
        text: response.messageText,
        scenarioSnapshot: response.scenarioState,
        clarificationPrompt: response.clarifications
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        sender: 'assistant',
        timestamp: getSingaporeTimestamp(),
        text: `⚠️ **Processing Error**: ${err?.message || 'Unable to process query'}`
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectSuggestion = (fieldKey: string, value: number | string) => {
    if (!scenario) return;

    const updated = { ...scenario, [fieldKey]: value };
    updated.missingFields = updated.missingFields.filter((f) => f.fieldKey !== fieldKey);
    updated.isComplete = updated.missingFields.length === 0;

    setScenario(updated);

    const userFollowUp: ChatMessage = {
      id: `user-reply-${Date.now()}`,
      sender: 'user',
      timestamp: getSingaporeTimestamp(),
      text: `Set ${fieldKey} to ${value}`
    };

    const confirmMsg: ChatMessage = {
      id: `asst-confirm-${Date.now()}`,
      sender: 'assistant',
      timestamp: getSingaporeTimestamp(),
      text: `Recorded **${value}** for ${fieldKey}. Double entries recalculated in real time.`,
      scenarioSnapshot: updated
    };

    setMessages((prev) => [...prev, userFollowUp, confirmMsg]);
  };

  const handleScenarioChange = (updated: AccountingScenarioState) => {
    setScenario(updated);
  };

  const handleResetToDefaults = () => {
    setScenario(null);
  };

  const computed = scenario
    ? calculateDoubleEntries(scenario, standard)
    : { groups: [], financialImpact: { totalAssetsDelta: 0, totalLiabilitiesDelta: 0, totalEquityDelta: 0, pnlImpact: 0, ociImpact: 0, functionalCurrency: 'SGD' } };

  return (
    <div className="min-h-screen bg-[#F4F7FA] dark:bg-[#131A29] text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors duration-200">
      {/* App Header */}
      <Header
        theme={theme}
        onThemeToggle={handleThemeToggle}
        providerSettings={providerSettings}
        onProviderSettingsSave={handleProviderSettingsSave}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-6 lg:p-8 space-y-5 sm:space-y-6 pb-12 sm:pb-8">
        {/* Top Grid: Chat on Left, Input Handlers + Journal on Right */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-start">
          {/* Left Column: Conversational AI Panel (5 cols) */}
          <div className="lg:col-span-5 h-[520px] sm:h-[620px]">
            <ChatPanel
              messages={messages}
              onSendMessage={handleSendMessage}
              onSelectSuggestion={handleSelectSuggestion}
              isLoading={isLoading}
            />
          </div>

          {/* Right Column: Parameters + Journal (7 cols) */}
          <div className="lg:col-span-7 space-y-5 sm:space-y-6">
            {/* Structured Parameters Panel */}
            <InputHandlerPanel
              scenario={scenario}
              onScenarioChange={handleScenarioChange}
              onResetToDefaults={handleResetToDefaults}
            />

            {/* View Switcher Tabs */}
            {scenario && (
              computed.groups.some((g) => g.lines.length > 0) ||
              (scenario.statutoryAdvisory && scenario.statutoryAdvisory.length > 0) ||
              Boolean(scenario.accountingTreatmentSummary) ||
              Boolean(scenario.singaporeTaxTreatmentSummary) ||
              Boolean(scenario.regulatoryMandatesSummary)
            ) && (
              <div className="space-y-4">
                <div className="flex items-center gap-1 sm:gap-2 border-b border-slate-200 dark:border-[#2B374E] bg-white dark:bg-[#1C2538] px-2 sm:px-3 pt-2 rounded-t-xl overflow-x-auto no-scrollbar shadow-xs">
                  {computed.groups.some((g) => g.lines.length > 0) && (
                    <button
                      onClick={() => setActiveTab('entries')}
                      className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
                        activeTab === 'entries'
                          ? 'border-ynab-blue text-ynab-blue dark:border-blue-400 dark:text-blue-400'
                          : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                      }`}
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      Double Entry Journal
                    </button>
                  )}

                  <button
                    onClick={() => setActiveTab('compliance')}
                    className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
                      activeTab === 'compliance' || !computed.groups.some((g) => g.lines.length > 0)
                        ? 'border-ynab-blue text-ynab-blue dark:border-blue-400 dark:text-blue-400'
                        : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    <BookCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    Statutory Citations & Directives
                  </button>
                </div>

                {/* Tab Content */}
                {activeTab === 'entries' && computed.groups.some((g) => g.lines.length > 0) && (
                  <JournalTable
                    groups={computed.groups}
                    standard={standard}
                    functionalCurrency={scenario.functionalCurrency}
                  />
                )}

                {(activeTab === 'compliance' || !computed.groups.some((g) => g.lines.length > 0)) && (
                  <ComplianceRationale
                    citations={[
                      ...computed.groups.flatMap((g) => g.citations),
                      ...(scenario.directGroups?.[0]?.citations || [])
                    ]}
                    advisories={scenario.statutoryAdvisory}
                    standard={standard}
                    classification={scenario.classification}
                    primaryDomain={scenario.primaryDomain}
                    accountingTreatmentSummary={scenario.accountingTreatmentSummary}
                    singaporeTaxTreatmentSummary={scenario.singaporeTaxTreatmentSummary}
                    regulatoryMandatesSummary={scenario.regulatoryMandatesSummary}
                    effectiveDateOrTiming={scenario.effectiveDateOrTiming}
                    uncertaintyDisclaimer={scenario.uncertaintyDisclaimer}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white/80 dark:bg-[#151D2C] border-t border-slate-200 dark:border-[#2B374E] py-4 text-center text-xs text-slate-500 dark:text-slate-400">
        <p>
          Universal Accounting & Singapore Statutory Engine • Grounded in IRAS, ACRA, CPF Board, MOM, MAS & Singapore Statutes • ECB Spot rates via Frankfurter API
        </p>
      </footer>
    </div>
  );
};

export default App;
