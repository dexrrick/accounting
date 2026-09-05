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
      text: `Hello! I am your **Universal IFRS & SFRS(I) Accounting Assistant**.\n\nYou can ask **any accounting question** in business (e.g. *"i pay for entertainment expenses 3k with bank"*, office leases, salary with CPF, or foreign share trading).\n\n* **Universal Scope**: Handles any transaction without needing predefined scenarios.\n* **Live Spot Rates**: Powered by the **Frankfurter API (European Central Bank)**.\n* **Statutory Compliance**: Exact debit & credit rules with ASC Singapore & IASB citations.`
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

            {/* View Switcher Tabs (T-Account Removed) */}
            {scenario && computed.groups.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-1 sm:gap-2 border-b border-slate-800 bg-slate-900 px-2 sm:px-3 pt-2 rounded-t-xl overflow-x-auto no-scrollbar">
                  <button
                    onClick={() => setActiveTab('entries')}
                    className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 text-xs font-bold border-b-2 transition-all whitespace-nowrap ${
                      activeTab === 'entries'
                        ? 'border-blue-500 text-blue-400'
                        : 'border-transparent text-slate-400 hover:text-white'
                    }`}
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    Double Entry Journal
                  </button>

                  <button
                    onClick={() => setActiveTab('compliance')}
                    className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 text-xs font-bold border-b-2 transition-all whitespace-nowrap ${
                      activeTab === 'compliance'
                        ? 'border-blue-500 text-blue-400'
                        : 'border-transparent text-slate-400 hover:text-white'
                    }`}
                  >
                    <BookCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    Statutory Citations & "Why"
                  </button>
                </div>

                {/* Tab Content */}
                {activeTab === 'entries' && (
                  <JournalTable
                    groups={computed.groups}
                    standard={standard}
                    functionalCurrency={scenario.functionalCurrency}
                  />
                )}

                {activeTab === 'compliance' && (
                  <ComplianceRationale
                    citations={computed.groups.flatMap((g) => g.citations)}
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
          Universal IFRS & SFRS(I) Accounting Engine • Spot rates powered by Frankfurter API (ECB) • Compliant with ASC Singapore & IASB
        </p>
      </footer>
    </div>
  );
};

export default App;
