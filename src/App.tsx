import React, { useState, useEffect } from 'react';
import type {
  AccountingStandard,
  AccountingScenarioState,
  ChatMessage,
  ChatImageAttachment
} from './types/accounting';
import { Header, type AppFontSize } from './components/Header';
import { ChatPanel } from './components/ChatPanel';
import { InputHandlerPanel } from './components/InputHandlerPanel';
import { JournalTable } from './components/JournalTable';
import { ComplianceRationale } from './components/ComplianceRationale';
import { calculateDoubleEntries } from './engine/accountingEngine';
import { processAccountingQuery, type OutputPreference } from './services/geminiService';
import { loadProviderSettings, saveProviderSettings, type ProviderSettings } from './types/provider';
import { FileSpreadsheet, BookCheck } from 'lucide-react';
import { WorkspaceEmptyState } from './components/WorkspaceEmptyState';
import { getSingaporeTimestamp } from './utils/dateUtils';
import { createChatPreview, extractOfficialAnswerLinks } from './utils/chatPresentation';
import { hasCurrentIrasEvidencePresentation } from './utils/irasEvidencePresentation';
import { runDueRegulatoryChecks } from './retrieval/regulatoryUpdateScheduler';
import { FeedbackDialog } from './components/FeedbackDialog';
import { assessConversationRelation } from './services/conversationBoundary';
import { ShareTransferCalculator } from './components/ShareTransferCalculator';
import { ImageEvidencePanel } from './components/ImageEvidencePanel';

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

  useEffect(() => {
    void runDueRegulatoryChecks();
    const timer = window.setInterval(() => void runDueRegulatoryChecks(), 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Theme Management (Dark mode default with light mode toggle)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('app_theme') as 'light' | 'dark') || 'dark';
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
  const [outputPreference, setOutputPreference] = useState<OutputPreference>({ journal: false, statutory: false });
  const [appliedOutputPreference, setAppliedOutputPreference] = useState<OutputPreference>({ journal: false, statutory: false });
  const [pendingRelation, setPendingRelation] = useState<{ text: string; userMessage: ChatMessage } | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-msg',
      sender: 'assistant',
      timestamp: getSingaporeTimestamp(),
      text: 'Hello! Ask me about a transaction, payroll, tax, or compliance question. I can work through follow-ups with you and show the journal and sources alongside our chat.'
    }
  ]);

  const processMessage = async (text: string, activeScenario: AccountingScenarioState | null, userMsg: ChatMessage) => {
    setIsLoading(true);
    setAppliedOutputPreference(outputPreference);
    try {
      const response = await processAccountingQuery(
        text,
        activeScenario,
        standard,
        providerSettings,
        providerSettings.gemini.model,
        [...messages, userMsg],
        outputPreference
      );

      const answerState: AccountingScenarioState = {
        ...response.scenarioState,
        officialAnswerLinks: extractOfficialAnswerLinks(response.messageText)
      };
      setScenario(answerState);

      if (outputPreference.journal && !outputPreference.statutory) setActiveTab('entries');
      else if (outputPreference.statutory && !outputPreference.journal) setActiveTab('compliance');
      else if (
        answerState.queryIntent === 'STATUTORY_ADVISORY' ||
        (!answerState.directGroups?.some((g) => g.lines.length > 0) &&
          ((answerState.statutoryAdvisory && answerState.statutoryAdvisory.length > 0) ||
            answerState.accountingTreatmentSummary || answerState.singaporeTaxTreatmentSummary || answerState.regulatoryMandatesSummary))
      ) setActiveTab('compliance');
      else if (answerState.directGroups?.some((g) => g.lines.length > 0)) setActiveTab('entries');

      setMessages((prev) => [...prev, {
        id: `asst-${Date.now()}`, sender: 'assistant', timestamp: getSingaporeTimestamp(),
        text: createChatPreview(response.messageText, answerState, response.clarifications), fullText: response.messageText,
        scenarioSnapshot: answerState, clarificationPrompt: response.clarifications,
        retryPayload: response.imageAnalysisFailed ? { text, images: userMsg.images || [] } : undefined
      }]);
    } catch (err: any) {
      setMessages((prev) => [...prev, { id: `err-${Date.now()}`, sender: 'assistant', timestamp: getSingaporeTimestamp(), text: `⚠️ **Processing Error**: ${err?.message || 'Unable to process query'}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (text: string, images: ChatImageAttachment[] = []) => {
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      timestamp: getSingaporeTimestamp(),
      text,
      images: images.length > 0 ? images : undefined
    };

    setMessages((prev) => [...prev, userMsg]);
    if (assessConversationRelation(text, scenario) === 'AMBIGUOUS') {
      setPendingRelation({ text, userMessage: userMsg });
      setMessages((prev) => [...prev, {
        id: `relation-${Date.now()}`, sender: 'assistant', timestamp: getSingaporeTimestamp(), relationPrompt: true,
        text: 'Is this related to the previous transaction? I can continue its accounting treatment, or start a separate analysis.'
      }]);
      return;
    }
    await processMessage(text, scenario, userMsg);
  };

  const handleResolveRelation = (isRelated: boolean) => {
    if (!pendingRelation || isLoading) return;
    const pending = pendingRelation;
    setPendingRelation(null);
    void processMessage(pending.text, isRelated ? scenario : null, pending.userMessage);
  };

  const handleSelectSuggestion = (fieldKey: string, value: number | string) => {
    if (!scenario) return;
    void fieldKey;
    void handleSendMessage(String(value));
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
  const hasJournal = computed.groups.some((group) => group.lines.length > 0);
  const showJournal = hasJournal && !(appliedOutputPreference.statutory && !appliedOutputPreference.journal);
  const showStatutory = !(appliedOutputPreference.journal && !appliedOutputPreference.statutory);

  return (
    <div className="min-h-screen bg-workspace-canvas text-workspace-text flex flex-col font-sans transition-colors duration-200">
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
      <main className="flex-1 max-w-[1504px] w-full mx-auto px-3 sm:px-6 lg:px-8 pt-4 sm:pt-5 pb-10 sm:pb-8 space-y-4 sm:space-y-5">
        <section className="space-y-1">
          <h2 className="text-2xl sm:text-[1.65rem] font-semibold tracking-tight text-workspace-text">Accounting workspace</h2>
          <p className="text-sm sm:text-base text-workspace-muted">Work through transactions, journals, and statutory guidance in one place.</p>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6 items-stretch">
          <div className="h-[580px] sm:h-[680px] lg:h-[750px]">
            <ChatPanel
              messages={messages}
              onSendMessage={handleSendMessage}
              onRetryMessage={handleSendMessage}
              onSelectSuggestion={handleSelectSuggestion}
              onResolveRelation={handleResolveRelation}
              isLoading={isLoading}
              isAwaitingRelation={Boolean(pendingRelation)}
              outputPreference={outputPreference}
              onOutputPreferenceChange={setOutputPreference}
            />
          </div>

          <div className="min-w-0">
            {scenario ? (
              <div className="space-y-5 sm:space-y-6">
                {/* Structured Parameters Panel */}
                <InputHandlerPanel
                  scenario={scenario}
                  onScenarioChange={handleScenarioChange}
                  onResetToDefaults={handleResetToDefaults}
                />
                {scenario?.imageEvidence && scenario.imageEvidence.length > 0 && <ImageEvidencePanel evidence={scenario.imageEvidence} />}

                {/* View Switcher Tabs */}
                {scenario && (
                  showJournal ||
                  (scenario.statutoryAdvisory && scenario.statutoryAdvisory.length > 0) ||
                  hasCurrentIrasEvidencePresentation(scenario.irasEvidencePresentation, scenario.rawQuery, scenario.primaryDomain, scenario.queryIntent) ||
                  Boolean(scenario.accountingTreatmentSummary) ||
                  Boolean(scenario.singaporeTaxTreatmentSummary) ||
                  Boolean(scenario.regulatoryMandatesSummary)
                ) && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-1 sm:gap-2 border-b border-workspace-border dark:border-workspace-border bg-workspace-panel px-2 sm:px-3 pt-2 rounded-t-xl overflow-x-auto no-scrollbar shadow-xs">
                      {showJournal && (
                        <button
                          onClick={() => setActiveTab('entries')}
                          className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
                            activeTab === 'entries'
                              ? 'border-workspace-accent text-workspace-accent-text dark:border-workspace-accent dark:text-workspace-accent-text'
                              : 'border-transparent text-workspace-muted dark:text-workspace-muted hover:text-slate-800 dark:hover:text-slate-200'
                          }`}
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                          Double Entry Journal
                        </button>
                      )}

                      {showStatutory && <button
                        onClick={() => setActiveTab('compliance')}
                        className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
                          activeTab === 'compliance' || !computed.groups.some((g) => g.lines.length > 0)
                            ? 'border-workspace-accent text-workspace-accent-text dark:border-workspace-accent dark:text-workspace-accent-text'
                            : 'border-transparent text-workspace-muted dark:text-workspace-muted hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                      >
                        <BookCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        Statutory Citations & Directives
                      </button>}
                    </div>

                    {/* Tab Content */}
                    {activeTab === 'entries' && showJournal && (
                      <JournalTable
                        groups={computed.groups}
                        standard={standard}
                        functionalCurrency={scenario.functionalCurrency}
                        assumptions={scenario.assumptions}
                      />
                    )}

                    {showStatutory && (activeTab === 'compliance' || !showJournal) && (
                      <ComplianceRationale
                        citations={(() => {
                          const all = [
                            ...computed.groups.flatMap((g) => g.citations),
                            ...(scenario.directGroups?.[0]?.citations || [])
                          ];
                          const seen = new Set<string>();
                          return all.filter((c) => {
                            const k = `${(c.standard || '').toLowerCase()}-${(c.paragraph || '').toLowerCase()}-${(c.officialSourceUrl || '').toLowerCase()}`;
                            if (seen.has(k)) return false;
                            seen.add(k);
                            return true;
                          });
                        })()}
                        advisories={scenario.statutoryAdvisory}
                        officialAnswerLinks={scenario.officialAnswerLinks}
                        standard={standard}
                        classification={scenario.classification}
                        primaryDomain={scenario.primaryDomain}
                        assumptions={scenario.assumptions}
                        accountingTreatmentSummary={scenario.accountingTreatmentSummary}
                        singaporeTaxTreatmentSummary={scenario.singaporeTaxTreatmentSummary}
                        regulatoryMandatesSummary={scenario.regulatoryMandatesSummary}
                        effectiveDateOrTiming={scenario.effectiveDateOrTiming}
                        uncertaintyDisclaimer={scenario.uncertaintyDisclaimer}
                        irasEvidencePresentation={scenario.irasEvidencePresentation}
                        rawQuery={scenario.rawQuery}
                        queryIntent={scenario.queryIntent}
                      />
                    )}
                  </div>
                )}
              </div>
            ) : (
              <WorkspaceEmptyState />
            )}
          </div>
        </div>
      </main>
      {outputPreference.shareStructure && (
        <div className="max-w-[1504px] w-full mx-auto px-3 sm:px-6 lg:px-8 pb-12"><ShareTransferCalculator scenario={scenario} /></div>
      )}

            {/* Footer */}
      <footer className="bg-white/80 dark:bg-workspace-panel border-t border-workspace-border dark:border-workspace-border py-4 text-center text-xs text-workspace-muted dark:text-workspace-muted">
        <div className="max-w-[1504px] mx-auto flex flex-col items-center justify-between gap-3 px-4 sm:flex-row">
        <p className="text-center sm:text-left">
          Universal Accounting & Singapore Statutory Engine • Grounded in IRAS, ACRA, CPF Board, MOM, MAS & Singapore Statutes • ECB Spot rates via Frankfurter API
        </p>
        <FeedbackDialog messages={messages} scenario={scenario} providerSettings={providerSettings} theme={theme} fontSize={fontSize} outputPreference={outputPreference} />
        </div>
      </footer>
    </div>
  );
};

export default App;
