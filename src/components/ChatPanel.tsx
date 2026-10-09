import React, { useState, useRef, useEffect } from 'react';
import type { ChatImageAttachment, ChatMessage, MissingFieldInfo } from '../types/accounting';
import { Send, Bot, User, Sparkles, AlertCircle, ArrowRight, ArrowDown, ChevronLeft, ChevronRight, MoveHorizontal, Eye, EyeOff, ImagePlus } from 'lucide-react';
import { SAMPLE_PROMPTS } from '../data/sampleScenarios';
import type { OutputPreference } from '../services/geminiService';
import { createImageAttachment, validateImageFile } from '../utils/imageUtils';
import { ImageAttachmentPreview } from './ImageAttachmentPreview';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (text: string, images?: ChatImageAttachment[]) => void;
  onRetryMessage: (text: string, images: ChatImageAttachment[]) => void;
  onSelectSuggestion: (fieldKey: string, value: number | string) => void;
  onResolveRelation: (isRelated: boolean) => void;
  isLoading: boolean;
  isAwaitingRelation: boolean;
  outputPreference: OutputPreference;
  onOutputPreferenceChange: (preference: OutputPreference) => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  onSendMessage,
  onRetryMessage,
  onSelectSuggestion,
  onResolveRelation,
  isLoading,
  isAwaitingRelation,
  outputPreference,
  onOutputPreferenceChange
}) => {
  const [inputText, setInputText] = useState('');
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(() => {
    const saved = localStorage.getItem('chat_show_suggestions');
    return saved !== null ? saved === 'true' : true;
  });

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messageThreadRef = useRef<HTMLDivElement>(null);
  const stickToLatestRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const jumpToLatest = () => {
    const thread = messageThreadRef.current;
    if (!thread) return;
    thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
    stickToLatestRef.current = true;
    setShowJumpToLatest(false);
  };

  useEffect(() => {
    const thread = messageThreadRef.current;
    if (!thread) return;
    if (stickToLatestRef.current || messages.at(-1)?.sender === 'user') {
      thread.scrollTop = thread.scrollHeight;
      stickToLatestRef.current = true;
      setShowJumpToLatest(false);
    }
  }, [messages, isLoading]);

  const toggleSuggestions = () => {
    setShowSuggestions((prev) => {
      const next = !prev;
      localStorage.setItem('chat_show_suggestions', String(next));
      return next;
    });
  };

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
  }, [showSuggestions]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!inputText.trim() && attachments.length === 0) || isLoading || isAwaitingRelation) return;
    onSendMessage(inputText.trim(), attachments);
    setInputText('');
    setAttachments([]);
    setAttachmentError(null);
  };

  const addFiles = async (files: File[]) => {
    setAttachmentError(null);
    const available = 5 - attachments.length;
    if (files.length > available) {
      setAttachmentError(`You can attach a maximum of 5 images per message. Remove an image before adding more.`);
    }
    const selected = files.slice(0, Math.max(0, available));
    const invalid = selected.map(validateImageFile).find((error): error is string => Boolean(error));
    if (invalid) {
      setAttachmentError(invalid);
      return;
    }
    try {
      const created = await Promise.all(selected.map((file, index) => createImageAttachment(file, `image-${Date.now()}-${index}`)));
      setAttachments((current) => [...current, ...created].slice(0, 5));
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : 'Unable to add the image.');
    }
  };

  const scrollHorizontally = (offset: number) => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: offset, behavior: 'smooth' });
    }
  };

  return (
    <div className="flex flex-col h-full bg-workspace-panel rounded-xl border border-workspace-border dark:border-workspace-border shadow-none overflow-hidden transition-colors duration-200">
      {/* Panel Top Banner */}
      <div className="p-4 border-b border-workspace-border dark:border-workspace-border flex items-center justify-between bg-workspace-raised/80 dark:bg-workspace-panel">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-transparent text-workspace-accent-text dark:text-workspace-accent-text flex items-center justify-center">
            <Bot className="w-4 h-4 text-workspace-accent-text dark:text-workspace-accent-text" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white tracking-tight font-sans">
              Universal Query & Statutory Assistant
            </h2>
          </div>
        </div>
      </div>

      {/* Messages Thread */}
      <div ref={messageThreadRef}
        onScroll={() => {
          const thread = messageThreadRef.current;
          if (!thread) return;
          const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
          stickToLatestRef.current = nearBottom;
          setShowJumpToLatest(!nearBottom);
        }}
        className="flex-1 min-h-0 p-4 overflow-y-auto space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.sender !== 'user' && (
              <div className="w-8 h-8 rounded-xl bg-workspace-raised dark:bg-workspace-raised border border-slate-700/40 dark:border-workspace-border text-white flex items-center justify-center shrink-0 shadow-sm">
                <Bot className="w-4 h-4 text-workspace-accent-text dark:text-workspace-accent-text" />
              </div>
            )}

            <div
              className={`max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed ${
                msg.sender === 'user'
                  ? 'bg-blue-50 dark:bg-workspace-raised text-slate-800 dark:text-workspace-secondary border border-blue-200 dark:border-blue-900/60 rounded-br-none shadow-sm'
                  : 'bg-workspace-raised dark:bg-workspace-raised text-slate-800 dark:text-workspace-secondary rounded-bl-none border border-workspace-border dark:border-workspace-border shadow-xs'
              }`}
            >
              <div className="whitespace-pre-line font-normal">{msg.text}</div>
              {msg.retryPayload && (
                <button type="button" onClick={() => onRetryMessage(msg.retryPayload!.text, msg.retryPayload!.images)} disabled={isLoading || isAwaitingRelation} className="mt-3 rounded-lg border border-workspace-accent px-3 py-1.5 text-[11px] font-semibold text-workspace-accent-text hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-blue-950/30">
                  Retry image analysis
                </button>
              )}
              {msg.images && msg.images.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {msg.images.map((image) => (
                    <img key={image.id} src={image.dataUrl} alt={image.fileName} className="h-20 w-20 rounded-lg border border-blue-200 object-cover dark:border-blue-900/60" />
                  ))}
                </div>
              )}

              {msg.relationPrompt && (
                <div className="mt-3 pt-3 border-t border-workspace-border dark:border-workspace-border">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => onResolveRelation(true)}
                      className="px-3 py-1.5 rounded-lg bg-workspace-accent hover:bg-workspace-accent-hover text-white text-[11px] font-semibold transition-colors">
                      Yes, related
                    </button>
                    <button type="button" onClick={() => onResolveRelation(false)}
                      className="px-3 py-1.5 rounded-lg bg-white hover:bg-workspace-hover dark:bg-workspace-panel dark:hover:bg-workspace-hover text-slate-700 dark:text-workspace-secondary border border-slate-300 dark:border-workspace-border text-[11px] font-semibold transition-colors">
                      No, brand-new question
                    </button>
                  </div>
                </div>
              )}

              {/* Clarification prompt cards if info missing */}
              {msg.clarificationPrompt && msg.clarificationPrompt.length > 0 && (
                <div className="mt-3 pt-3 border-t border-workspace-border dark:border-workspace-border space-y-2.5">
                  <div className="flex items-center gap-1.5 text-slate-800 dark:text-workspace-secondary font-semibold text-[11px]">
                    <AlertCircle className="w-3.5 h-3.5 text-ynab-amber shrink-0" />
                    <span>Statutory Clarification:</span>
                  </div>

                  {msg.clarificationPrompt.map((field: MissingFieldInfo) => (
                    <div
                      key={field.fieldKey}
                      className="bg-workspace-panel border border-workspace-border dark:border-workspace-border rounded-xl p-3 text-slate-800 dark:text-workspace-secondary space-y-2 shadow-xs"
                    >
                      <div className="text-[11px] font-medium text-slate-900 dark:text-workspace-secondary">
                        {field.prompt}
                      </div>
                      <div className="text-[10px] text-workspace-muted dark:text-workspace-muted">
                        {field.whyNeeded}
                      </div>

                      {field.suggestions && field.suggestions.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {field.suggestions.map((sug, idx) => (
                            <button
                              key={idx}
                              onClick={() => onSelectSuggestion(field.fieldKey, sug.value)}
                              className="px-2.5 py-1 bg-workspace-raised hover:bg-slate-200 dark:bg-workspace-raised dark:hover:bg-workspace-hover text-slate-800 dark:text-workspace-secondary border border-workspace-border dark:border-workspace-border rounded-lg text-[11px] font-medium transition-colors flex items-center gap-1"
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
              <div className="w-8 h-8 rounded-xl bg-slate-200 dark:bg-workspace-raised text-slate-800 dark:text-white flex items-center justify-center shrink-0 shadow-sm border border-slate-300 dark:border-workspace-border">
                <User className="w-4 h-4" />
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-3 justify-start items-center text-workspace-muted dark:text-workspace-muted text-xs">
            <div className="w-8 h-8 rounded-xl bg-workspace-raised dark:bg-workspace-raised border border-slate-700/40 dark:border-workspace-border text-white flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-workspace-accent-text dark:text-workspace-accent-text" />
            </div>
            <div className="bg-workspace-raised dark:bg-workspace-raised px-4 py-2.5 rounded-2xl rounded-bl-none text-slate-800 dark:text-workspace-secondary flex items-center gap-2 border border-workspace-border dark:border-workspace-border shadow-xs">
              <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce"></span>
              <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:0.2s]"></span>
              <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:0.4s]"></span>
              <span className="text-[11px] font-medium ml-1">{messages.at(-1)?.images?.length ? 'Analysing screenshot and applying accounting treatment...' : 'Analyzing statutory citations under IRAS, ACRA & SFRS...'}</span>
            </div>
          </div>
        )}
        {showJumpToLatest && (
          <button type="button" onClick={jumpToLatest}
            className="sticky bottom-0 ml-auto flex items-center gap-1.5 rounded-full bg-workspace-accent text-white px-3 py-1.5 text-[11px] shadow-lg"
            aria-label="Jump to latest message">
            <ArrowDown className="w-3.5 h-3.5" /> Jump to latest
          </button>
        )}
      </div>

      {/* Sample Quick-Click Scenarios (Collapsible) */}
      {showSuggestions ? (
        <div className="px-3 sm:px-4 py-2 sm:py-2.5 bg-workspace-raised/90 dark:bg-workspace-panel border-t border-workspace-border dark:border-workspace-border transition-all">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-600 dark:text-workspace-muted uppercase tracking-wider">
              <MoveHorizontal className="w-3.5 h-3.5 text-workspace-muted" />
              <span>Query Suggestions</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => scrollHorizontally(-220)}
                  className="p-1 rounded-md text-workspace-muted hover:text-slate-800 dark:text-workspace-muted dark:hover:text-white hover:bg-slate-200 dark:hover:bg-workspace-hover border border-workspace-border dark:border-workspace-border transition-colors"
                  title="Scroll left"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollHorizontally(220)}
                  className="p-1 rounded-md text-workspace-muted hover:text-slate-800 dark:text-workspace-muted dark:hover:text-white hover:bg-slate-200 dark:hover:bg-workspace-hover border border-workspace-border dark:border-workspace-border transition-colors"
                  title="Scroll right"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <button
                type="button"
                onClick={toggleSuggestions}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-workspace-muted hover:text-slate-900 dark:text-workspace-muted dark:hover:text-white rounded-md hover:bg-slate-200 dark:hover:bg-workspace-hover border border-transparent hover:border-workspace-border dark:hover:border-workspace-border transition-colors cursor-pointer"
                title="Hide suggestions to expand chat screen"
              >
                <EyeOff className="w-3 h-3" />
                <span>Hide</span>
              </button>
            </div>
          </div>

          {/* Scrollable Container with Smooth Chevron and Wheel Scrolling */}
          <div
            ref={scrollContainerRef}
            className="flex gap-2 overflow-x-auto pb-1 scroll-smooth"
            style={{
              scrollbarWidth: 'thin'
            }}
          >
            {SAMPLE_PROMPTS.map((sample) => (
              <button
                key={sample.id}
                type="button"
                onClick={() => onSendMessage(sample.query)}
                className="shrink-0 w-48 sm:w-56 text-left p-2.5 bg-workspace-panel hover:bg-workspace-hover dark:hover:bg-workspace-hover border border-workspace-border dark:border-workspace-border hover:border-slate-300 dark:hover:border-workspace-border rounded-xl transition-all shadow-xs group flex flex-col justify-between min-h-[58px] cursor-pointer"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-semibold text-workspace-muted dark:text-workspace-muted uppercase tracking-wider truncate max-w-[110px]">
                    {sample.tag}
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 bg-workspace-raised dark:bg-workspace-raised text-slate-700 dark:text-workspace-secondary rounded font-mono leading-none border border-workspace-border dark:border-workspace-border shrink-0 truncate max-w-[80px]">
                    {sample.standard}
                  </span>
                </div>
                <p className="text-[11px] text-slate-800 dark:text-workspace-secondary group-hover:text-workspace-accent-text dark:group-hover:text-white mt-1 leading-snug line-clamp-2 font-medium">
                  {sample.title}
                </p>
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* Minimized Rail: Gives Maximum Room for Chat */
        <div className="px-3 sm:px-4 py-1.5 bg-workspace-raised/80 dark:bg-workspace-panel border-t border-workspace-border dark:border-workspace-border flex items-center justify-between">
          <button
            type="button"
            onClick={toggleSuggestions}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600 hover:text-workspace-accent-text dark:text-workspace-muted dark:hover:text-workspace-accent-text transition-colors cursor-pointer"
            title="Show Singapore query suggestions"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Show Query Suggestions ({SAMPLE_PROMPTS.length})</span>
          </button>
          <span className="text-[10px] text-workspace-muted dark:text-workspace-muted font-medium">
            Expanded Chat View Active
          </span>
        </div>
      )}

      {/* Input Form */}
      <form
        onSubmit={handleSubmit}
        onDragEnter={(event) => { event.preventDefault(); if (!isLoading && !isAwaitingRelation) setIsDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { if (event.currentTarget === event.target) setIsDragging(false); }}
        onDrop={(event) => { event.preventDefault(); setIsDragging(false); void addFiles(Array.from(event.dataTransfer.files)); }}
        className={`relative p-2.5 sm:p-3 border-t border-workspace-border dark:border-workspace-border bg-workspace-panel ${isDragging ? 'ring-2 ring-inset ring-workspace-accent bg-blue-50 dark:bg-blue-950/30' : ''}`}
      >
        <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(event) => { void addFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
        {isDragging && <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded bg-blue-50/95 text-sm font-semibold text-workspace-accent-text dark:bg-workspace-panel/95 dark:text-workspace-secondary">Drop screenshots here</div>}
        <ImageAttachmentPreview attachments={attachments} onRemove={(id) => setAttachments((current) => current.filter((attachment) => attachment.id !== id))} disabled={isLoading || isAwaitingRelation} />
        {attachmentError && <p role="alert" className="mb-2 text-[11px] text-red-600 dark:text-red-400">{attachmentError}</p>}
        <div className="relative flex items-center">
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isLoading || isAwaitingRelation || attachments.length >= 5} title="Attach PNG, JPEG or WEBP images" aria-label="Attach images" className="mr-2 rounded-lg p-2 text-workspace-muted hover:bg-workspace-hover hover:text-workspace-accent-text disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-workspace-hover">
            <ImagePlus className="h-4 w-4" />
          </button>
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.items)
                .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
                .map((item) => item.getAsFile())
                .filter((file): file is File => file !== null);
              if (files.length > 0) void addFiles(files);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="Describe your transaction or ask a question…"
            aria-label="Accounting question input"
            rows={2}
            className="w-full min-h-20 pl-3 pr-12 py-3 text-sm bg-workspace-raised dark:bg-workspace-input border border-slate-300 dark:border-workspace-border rounded-xl text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-workspace-accent focus:border-transparent resize-none leading-relaxed font-sans"
          />
          <button
            type="submit"
            disabled={(!inputText.trim() && attachments.length === 0) || isLoading || isAwaitingRelation}
            className={`absolute right-2 p-2 rounded-lg transition-all ${
              (inputText.trim() || attachments.length > 0) && !isLoading && !isAwaitingRelation
                ? 'bg-workspace-accent text-white hover:bg-workspace-accent-hover shadow-sm'
                : 'bg-slate-200 dark:bg-workspace-raised text-workspace-muted dark:text-workspace-muted cursor-not-allowed'
            }`}
            title="Send query"
            aria-label="Send query"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-3 px-1 text-[11px] text-slate-600 dark:text-workspace-secondary">
          <label className="inline-flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={outputPreference.journal} disabled={isLoading || isAwaitingRelation} onChange={(e) => onOutputPreferenceChange({ ...outputPreference, journal: e.target.checked })} /> Double Entry Journal</label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={outputPreference.statutory} disabled={isLoading || isAwaitingRelation} onChange={(e) => onOutputPreferenceChange({ ...outputPreference, statutory: e.target.checked })} /> Statutory Treatment</label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={Boolean(outputPreference.shareStructure)} disabled={isLoading || isAwaitingRelation} onChange={(e) => onOutputPreferenceChange({ ...outputPreference, shareStructure: e.target.checked })} /> Share Structure</label>
        </div>
        <div className="flex items-center mt-1 px-1 text-[10px] text-workspace-muted dark:text-workspace-muted">
          <span className="hidden sm:inline">{isAwaitingRelation ? 'Choose how to treat the pending question' : 'Press Enter to send, Shift+Enter for newline'}</span>
          <span className="sm:hidden">Tap send icon to calculate</span>
        </div>
      </form>
    </div>
  );
};
