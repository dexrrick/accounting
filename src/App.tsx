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

  const [apiKey, setApiKey] = useState<string>(() => {
    return localStorage.getItem('gemini_api_key') || '';
  });
  const [modelName, setModelName] = useState<string>(() => {
    const saved = localStorage.getItem('gemini_model');
    const migrated = localStorage.getItem('gemini_model_v3');
    const allowed = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
    if (!migrated || !saved || !allowed.includes(saved)) {
      localStorage.setItem('gemini_model', 'gemini-3.5-flash-lite');
      localStorage.setItem('gemini_model_v3', 'true');
      return 'gemini-3.5-flash-lite';
    }
    return saved;
  });

  const [scenario, setScenario] = useState<AccountingScenarioState | null>(null);
  const [activeTab, setActiveTab] = useState<'entries' | 'compliance'>('entries');
  const [isLoading, setIsLoading] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-msg',
      sender: 'assistant',
      timestamp: getSingaporeTimestamp(),
      text: `Hello! I am your **Universal Accounting & Singapore Statutory Assistant**.\n\nYou can ask **any business transaction or regulatory compliance question**:\n* **Double Entry Accounting**: Exact debits & credits under SFRS(I) & IFRS (e.g. *"entertainment 3k with bank"*, office leases, shares with forex).\n* **IRAS Tax Directives**: Section 14/15 tax deductibility, Capital Allowances, SUTE/PTE, Form C-S, and 9% GST blocked rules.\n* **ACRA Compliance**: Small Company Audit Exemption (Section 205C), AGM & Annual Return statutory timelines.\n* **CPF Board & MOM**: 2026 Ordinary Wage ceiling ($8,000 cap), SDL calculations, and Employment Act payment deadlines.\n* **MAS & Trade**: Payment Services Act, zero foreign exchange controls, and Singapore Customs import GST.`
    }
  ]);

  const handleApiKeySave = (newKey: string) => {
    setApiKey(newKey);
    localStorage.setItem('gemini_api_key', newKey);
  };

  const handleModelChange = (newModel: string) => {
    setModelName(newModel);
    localStorage.setItem('gemini_model', newModel);
  };

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
      const response = await processAccountingQuery(text, scenario, standard, apiKey, modelName, [...messages, userMsg]);

      setScenario(response.scenarioState);

      // Auto-switch tabs based on query intent
      if (
        response.scenarioState?.queryIntent === 'STATUTORY_ADVISORY' ||
        (!response.scenarioState?.directGroups?.some((g) => g.lines.length > 0) &&
          response.scenarioState?.statutoryAdvisory &&
          response.scenarioState.statutoryAdvisory.length > 0)
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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans transition-all">
      {/* App Header */}
      <Header
        apiKey={apiKey}
        onApiKeySave={handleApiKeySave}
        modelName={modelName}
        onModelChange={handleModelChange}
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
            {scenario && (computed.groups.some((g) => g.lines.length > 0) || (scenario.statutoryAdvisory && scenario.statutoryAdvisory.length > 0)) && (
              <div className="space-y-4">
                <div className="flex items-center gap-1 sm:gap-2 border-b border-slate-800 bg-slate-900 px-2 sm:px-3 pt-2 rounded-t-xl overflow-x-auto no-scrollbar">
                  {computed.groups.some((g) => g.lines.length > 0) && (
                    <button
                      onClick={() => setActiveTab('entries')}
                      className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
                        activeTab === 'entries'
                          ? 'border-blue-500 text-white'
                          : 'border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400" />
                      Double Entry Journal
                    </button>
                  )}

                  <button
                    onClick={() => setActiveTab('compliance')}
                    className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
                      activeTab === 'compliance' || !computed.groups.some((g) => g.lines.length > 0)
                        ? 'border-blue-500 text-white'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <BookCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400" />
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
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-slate-900/60 border-t border-slate-800/80 py-4 text-center text-xs text-slate-500">
        <p>
          Universal Accounting & Singapore Statutory Engine • Grounded in IRAS, ACRA, CPF Board, MOM, MAS & Singapore Statutes • ECB Spot rates via Frankfurter API
        </p>
      </footer>
    </div>
  );
};

export default App;
