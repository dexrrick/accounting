import React, { useState } from 'react';
import type { ChatMessage, MissingFieldInfo } from '../types/accounting';
import { Send, Bot, User, Sparkles, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  onSelectSuggestion: (fieldKey: string, value: number | string) => void;
  isLoading: boolean;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  onSendMessage,
  onSelectSuggestion,
  isLoading
}) => {
  const [inputText, setInputText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isLoading) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const handleSampleClick = (query: string) => {
    onSendMessage(query);
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-2xl border border-slate-800 shadow-xl overflow-hidden">
      {/* Panel Top Banner */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-950 text-blue-400 flex items-center justify-center border border-blue-800/60">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-bold text-white uppercase tracking-wider">
              Universal Query & Statutory Assistant
            </h2>
            <p className="text-[11px] text-slate-400">
              IFRS/SFRS(I) Double Entries • IRAS, ACRA, CPF Board & Singapore Statutes
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/70 text-emerald-400 rounded-full text-[11px] font-medium border border-emerald-800/60">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          Statutory Grounding Active
        </div>
      </div>

      {/* Messages Thread */}
      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.sender !== 'user' && (
              <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-blue-500/20">
                <Bot className="w-4 h-4" />
              </div>
            )}

            <div
              className={`max-w-[85%] rounded-2xl p-4 text-xs leading-relaxed ${
                msg.sender === 'user'
                  ? 'bg-blue-600 text-white rounded-br-none shadow-md'
                  : 'bg-slate-800/80 text-slate-200 rounded-bl-none border border-slate-700/60'
              }`}
            >
              <div className="whitespace-pre-line font-normal">{msg.text}</div>

              {/* Clarification prompt cards if info missing */}
              {msg.clarificationPrompt && msg.clarificationPrompt.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-700 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-amber-400 font-semibold text-[11px]">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>Statutory Clarification:</span>
                  </div>

                  {msg.clarificationPrompt.map((field: MissingFieldInfo) => (
                    <div
                      key={field.fieldKey}
                      className="bg-amber-950/50 border border-amber-800/80 rounded-xl p-3 text-slate-200 space-y-2"
                    >
                      <div className="text-[11px] font-medium text-amber-200">
                        {field.prompt}
                      </div>
                      <div className="text-[10px] text-amber-300/80">
                        {field.whyNeeded}
                      </div>

                      {field.suggestions && field.suggestions.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {field.suggestions.map((sug, idx) => (
                            <button
                              key={idx}
                              onClick={() => onSelectSuggestion(field.fieldKey, sug.value)}
                              className="px-2.5 py-1 bg-slate-900 hover:bg-amber-900/60 text-amber-300 border border-amber-700/60 rounded-lg text-[11px] font-medium transition-colors flex items-center gap-1"
                            >
                              <span>{sug.label}</span>
                              <ArrowRight className="w-2.5 h-2.5 opacity-60" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {msg.sender === 'user' && (
              <div className="w-8 h-8 rounded-xl bg-slate-700 text-white flex items-center justify-center shrink-0 shadow-md">
                <User className="w-4 h-4" />
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-3 justify-start items-center text-slate-400 text-xs">
            <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 animate-pulse">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="bg-slate-800 px-4 py-2.5 rounded-2xl rounded-bl-none text-slate-300 flex items-center gap-2 border border-slate-700">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-bounce"></span>
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-bounce [animation-delay:0.2s]"></span>
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-bounce [animation-delay:0.4s]"></span>
              <span className="text-[11px] font-medium ml-1">Analyzing statutory citations under IRAS, ACRA & SFRS...</span>
            </div>
          </div>
        )}
      </div>

      {/* Sample Quick-Click Scenarios */}
      <div className="px-3 sm:px-4 py-2.5 sm:py-3 bg-slate-950/70 border-t border-slate-800">
        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
          Try Accounting or Singapore Statutory Queries:
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {/* Chip 1: ACRA Audit Exemption */}
          <button
            onClick={() => handleSampleClick('What are the ACRA requirements for small company audit exemption?')}
            className="shrink-0 w-44 sm:w-auto text-left p-2 bg-slate-900/90 hover:bg-slate-800 border border-slate-800 hover:border-indigo-500 rounded-xl transition-all shadow-sm group flex flex-col justify-between min-h-[58px]"
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">ACRA</span>
              <span className="text-[9px] px-1.5 py-0.5 bg-indigo-950 text-indigo-300 rounded font-mono leading-none border border-indigo-800">
                §205C
              </span>
            </div>
            <p className="text-[11px] text-slate-300 group-hover:text-white mt-1 leading-snug line-clamp-2">
              Small Company Audit Exemption
            </p>
          </button>

          {/* Chip 2: CPF Ceiling 2026 */}
          <button
            onClick={() => handleSampleClick('What is the 2026 CPF Ordinary Wage ceiling and monthly contribution rate?')}
            className="shrink-0 w-44 sm:w-auto text-left p-2 bg-slate-900/90 hover:bg-slate-800 border border-slate-800 hover:border-blue-500 rounded-xl transition-all shadow-sm group flex flex-col justify-between min-h-[58px]"
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">CPF Board</span>
              <span className="text-[9px] px-1.5 py-0.5 bg-blue-950 text-blue-300 rounded font-mono leading-none border border-blue-800">
                $8,000 OW
              </span>
            </div>
            <p className="text-[11px] text-slate-300 group-hover:text-white mt-1 leading-snug line-clamp-2">
              2026 CPF Ceilings & Deductions
            </p>
          </button>

          {/* Chip 3: Passenger Car Blocked Tax */}
          <button
            onClick={() => handleSampleClick('I bought a company car for SGD 120k with bank. How to record double entries and can I claim 9% GST under IRAS?')}
            className="shrink-0 w-44 sm:w-auto text-left p-2 bg-slate-900/90 hover:bg-slate-800 border border-slate-800 hover:border-emerald-500 rounded-xl transition-all shadow-sm group flex flex-col justify-between min-h-[58px]"
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">IRAS Tax</span>
              <span className="text-[9px] px-1.5 py-0.5 bg-emerald-950 text-emerald-300 rounded font-mono leading-none border border-emerald-800">
                Reg 26
              </span>
            </div>
            <p className="text-[11px] text-slate-300 group-hover:text-white mt-1 leading-snug line-clamp-2">
              Company Car: Blocked GST & Tax
            </p>
          </button>

          {/* Chip 4: Entertainment Expense */}
          <button
            onClick={() => handleSampleClick('i pay for entertainment expenses 3k with bank')}
            className="shrink-0 w-40 sm:w-auto text-left p-2 bg-slate-900/90 hover:bg-slate-800 border border-slate-800 hover:border-amber-500 rounded-xl transition-all shadow-sm group flex flex-col justify-between min-h-[58px]"
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Expense</span>
              <span className="text-[9px] px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded font-mono leading-none">
                IAS 1 / S14
              </span>
            </div>
            <p className="text-[11px] text-slate-300 group-hover:text-white mt-1 leading-snug line-clamp-2">
              Entertainment 3k with bank
            </p>
          </button>

          {/* Chip 5: FX Shares */}
          <button
            onClick={() => handleSampleClick('a company primary currency is SGD, it invested USD300k into 300 apple shares on 13/11/2026, subsequently the company sold 300 shares for USD400k on 15/12/2026. What are the double entries and FX gain?')}
            className="shrink-0 w-44 sm:w-auto text-left p-2 bg-slate-900/90 hover:bg-slate-800 border border-slate-800 hover:border-purple-500 rounded-xl transition-all shadow-sm group flex flex-col justify-between min-h-[58px]"
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider">FX Shares</span>
              <span className="text-[9px] px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded font-mono leading-none">
                IFRS 9
              </span>
            </div>
            <p className="text-[11px] text-slate-300 group-hover:text-white mt-1 leading-snug line-clamp-2">
              Apple Shares (USD 300k to 400k)
            </p>
          </button>
        </div>
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="p-2.5 sm:p-3 border-t border-slate-800 bg-slate-900">
        <div className="relative flex items-center">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="Ask any accounting or tax question (e.g. 'ACRA audit exemption', 'CPF ceiling 2026', 'bought company car 120k', 'entertainment 3k')..."
            rows={2}
            className="w-full pl-3 pr-12 py-2 text-xs bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none leading-relaxed"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || isLoading}
            className={`absolute right-2 p-2 rounded-lg transition-all ${
              inputText.trim() && !isLoading
                ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-500/30'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
            title="Send query"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center justify-between mt-1 px-1 text-[10px] text-slate-500">
          <span className="hidden sm:inline">Press Enter to send, Shift+Enter for newline</span>
          <span className="sm:hidden">Tap send icon to calculate</span>
          <span className="truncate">Frankfurter ECB FX</span>
        </div>
      </form>
    </div>
  );
};
