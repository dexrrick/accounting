import React, { useState, useRef, useEffect } from 'react';
import type { ChatMessage, MissingFieldInfo } from '../types/accounting';
import { Send, Bot, User, Sparkles, AlertCircle, ArrowRight, ChevronLeft, ChevronRight, MoveHorizontal } from 'lucide-react';
import { SAMPLE_PROMPTS } from '../data/sampleScenarios';

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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);
  const hasMovedRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  // Non-passive wheel event listener to ensure smooth mouse-wheel horizontal sliding
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isLoading) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrollContainerRef.current) return;
    isDraggingRef.current = true;
    hasMovedRef.current = false;
    startXRef.current = e.pageX - scrollContainerRef.current.offsetLeft;
    scrollLeftRef.current = scrollContainerRef.current.scrollLeft;
    setIsDragging(true);
    try {
      scrollContainerRef.current.setPointerCapture(e.pointerId);
    } catch {}
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !scrollContainerRef.current) return;
    const x = e.pageX - scrollContainerRef.current.offsetLeft;
    const walk = (x - startXRef.current) * 1.4;
    if (Math.abs(walk) > 4) {
      hasMovedRef.current = true;
    }
    scrollContainerRef.current.scrollLeft = scrollLeftRef.current - walk;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = false;
    setIsDragging(false);
    try {
      if (scrollContainerRef.current?.hasPointerCapture(e.pointerId)) {
        scrollContainerRef.current.releasePointerCapture(e.pointerId);
      }
    } catch {}
    setTimeout(() => {
      hasMovedRef.current = false;
    }, 100);
  };

  const handleSampleClick = (query: string) => {
    if (hasMovedRef.current) return;
    onSendMessage(query);
  };

  const scrollHorizontally = (offset: number) => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: offset, behavior: 'smooth' });
    }
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#1C2538] rounded-2xl border border-slate-200 dark:border-[#2B374E] shadow-xl overflow-hidden transition-colors duration-200">
      {/* Panel Top Banner */}
      <div className="p-4 border-b border-slate-200 dark:border-[#2B374E] flex items-center justify-between bg-slate-50/80 dark:bg-[#151D2C]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-ynab-navy dark:bg-[#242F46] text-white flex items-center justify-center border border-slate-700/30 dark:border-[#2B374E] shadow-xs">
            <Bot className="w-4 h-4 text-ynab-blue dark:text-blue-400" />
          </div>
          <div>
            <h2 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider font-sans">
              Universal Query & Statutory Assistant
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              IFRS/SFRS(I) Double Entries • IRAS, ACRA, CPF Board & Singapore Statutes
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-[#1C2538] dark:text-emerald-300 dark:border-emerald-900/60 rounded-full text-[11px] font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-ynab-green"></span>
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
              <div className="w-8 h-8 rounded-xl bg-ynab-navy dark:bg-[#242F46] border border-slate-700/40 dark:border-[#2B374E] text-white flex items-center justify-center shrink-0 shadow-sm">
                <Bot className="w-4 h-4 text-ynab-blue dark:text-blue-400" />
              </div>
            )}

            <div
              className={`max-w-[85%] rounded-2xl p-4 text-xs leading-relaxed ${
                msg.sender === 'user'
                  ? 'bg-ynab-blue text-white rounded-br-none shadow-sm'
                  : 'bg-slate-100 dark:bg-[#242F46] text-slate-800 dark:text-slate-200 rounded-bl-none border border-slate-200 dark:border-[#2B374E] shadow-xs'
              }`}
            >
              <div className="whitespace-pre-line font-normal">{msg.text}</div>

              {/* Clarification prompt cards if info missing */}
              {msg.clarificationPrompt && msg.clarificationPrompt.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-200 dark:border-[#2B374E] space-y-2.5">
                  <div className="flex items-center gap-1.5 text-slate-800 dark:text-slate-300 font-semibold text-[11px]">
                    <AlertCircle className="w-3.5 h-3.5 text-ynab-amber shrink-0" />
                    <span>Statutory Clarification:</span>
                  </div>

                  {msg.clarificationPrompt.map((field: MissingFieldInfo) => (
                    <div
                      key={field.fieldKey}
                      className="bg-white dark:bg-[#1C2538] border border-slate-200 dark:border-[#2B374E] rounded-xl p-3 text-slate-800 dark:text-slate-200 space-y-2 shadow-xs"
                    >
                      <div className="text-[11px] font-medium text-slate-900 dark:text-slate-200">
                        {field.prompt}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400">
                        {field.whyNeeded}
                      </div>

                      {field.suggestions && field.suggestions.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {field.suggestions.map((sug, idx) => (
                            <button
                              key={idx}
                              onClick={() => onSelectSuggestion(field.fieldKey, sug.value)}
                              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-[#242F46] dark:hover:bg-[#2D3B58] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-[#2B374E] rounded-lg text-[11px] font-medium transition-colors flex items-center gap-1"
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
              <div className="w-8 h-8 rounded-xl bg-slate-200 dark:bg-[#242F46] text-slate-800 dark:text-white flex items-center justify-center shrink-0 shadow-sm border border-slate-300 dark:border-[#2B374E]">
                <User className="w-4 h-4" />
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-3 justify-start items-center text-slate-500 dark:text-slate-400 text-xs">
            <div className="w-8 h-8 rounded-xl bg-ynab-navy dark:bg-[#242F46] border border-slate-700/40 dark:border-[#2B374E] text-white flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-ynab-blue dark:text-blue-400" />
            </div>
            <div className="bg-slate-100 dark:bg-[#242F46] px-4 py-2.5 rounded-2xl rounded-bl-none text-slate-800 dark:text-slate-300 flex items-center gap-2 border border-slate-200 dark:border-[#2B374E] shadow-xs">
              <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce"></span>
              <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:0.2s]"></span>
              <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:0.4s]"></span>
              <span className="text-[11px] font-medium ml-1">Analyzing statutory citations under IRAS, ACRA & SFRS...</span>
            </div>
          </div>
        )}
      </div>

      {/* Sample Quick-Click Scenarios */}
      <div className="px-3 sm:px-4 py-2.5 sm:py-3 bg-slate-50/90 dark:bg-[#151D2C] border-t border-slate-200 dark:border-[#2B374E]">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
            <MoveHorizontal className="w-3.5 h-3.5 text-slate-400" />
            <span>Try Accounting or Singapore Statutory Queries:</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-slate-400 dark:text-slate-500 mr-1 hidden sm:inline select-none">Click & drag or wheel to slide</span>
            <button
              type="button"
              onClick={() => scrollHorizontally(-220)}
              className="p-1 rounded-md text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#242F46] border border-slate-200 dark:border-[#2B374E] transition-colors"
              title="Scroll left"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => scrollHorizontally(220)}
              className="p-1 rounded-md text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#242F46] border border-slate-200 dark:border-[#2B374E] transition-colors"
              title="Scroll right"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Scrollable Container with Pointer Drag & Wheel */}
        <div
          ref={scrollContainerRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className={`flex gap-2 overflow-x-auto pb-1.5 select-none transition-colors scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-[#2B374E] scrollbar-track-transparent ${
            isDragging ? 'cursor-grabbing select-none' : 'cursor-grab'
          }`}
          style={{
            scrollbarWidth: 'thin',
            touchAction: 'pan-x'
          }}
        >
          {SAMPLE_PROMPTS.map((sample) => (
            <button
              key={sample.id}
              type="button"
              onClick={() => handleSampleClick(sample.query)}
              className="shrink-0 w-48 sm:w-56 text-left p-2.5 bg-white dark:bg-[#1C2538] hover:bg-slate-50 dark:hover:bg-[#242F46] border border-slate-200 dark:border-[#2B374E] hover:border-slate-300 dark:hover:border-slate-500 rounded-xl transition-all shadow-xs group flex flex-col justify-between min-h-[58px] select-none cursor-pointer"
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate max-w-[110px]">
                  {sample.tag}
                </span>
                <span className="text-[9px] px-1.5 py-0.5 bg-slate-100 dark:bg-[#242F46] text-slate-700 dark:text-slate-300 rounded font-mono leading-none border border-slate-200 dark:border-[#2B374E] shrink-0 truncate max-w-[80px]">
                  {sample.standard}
                </span>
              </div>
              <p className="text-[11px] text-slate-800 dark:text-slate-300 group-hover:text-ynab-blue dark:group-hover:text-white mt-1 leading-snug line-clamp-2 font-medium">
                {sample.title}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="p-2.5 sm:p-3 border-t border-slate-200 dark:border-[#2B374E] bg-white dark:bg-[#1C2538]">
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
            className="w-full pl-3 pr-12 py-2 text-xs bg-slate-50 dark:bg-[#111827] border border-slate-300 dark:border-[#2B374E] rounded-xl text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-ynab-blue focus:border-transparent resize-none leading-relaxed font-sans"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || isLoading}
            className={`absolute right-2 p-2 rounded-lg transition-all ${
              inputText.trim() && !isLoading
                ? 'bg-ynab-blue text-white hover:bg-blue-600 shadow-sm'
                : 'bg-slate-200 dark:bg-[#242F46] text-slate-400 dark:text-slate-500 cursor-not-allowed'
            }`}
            title="Send query"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center justify-between mt-1 px-1 text-[10px] text-slate-400 dark:text-slate-500">
          <span className="hidden sm:inline">Press Enter to send, Shift+Enter for newline</span>
          <span className="sm:hidden">Tap send icon to calculate</span>
          <span className="truncate">Frankfurter ECB FX</span>
        </div>
      </form>
    </div>
  );
};
