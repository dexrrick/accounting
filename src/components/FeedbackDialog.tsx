import React, { useState } from 'react';
import { Bug, CheckCircle2, Copy, Send, X } from 'lucide-react';
import type { AccountingScenarioState, ChatMessage } from '../types/accounting';
import type { ProviderSettings } from '../types/provider';
import { compileFeedbackReport, submitFeedbackReport } from '../services/feedback';

interface FeedbackDialogProps {
  messages: ChatMessage[];
  scenario: AccountingScenarioState | null;
  providerSettings: ProviderSettings;
  theme: 'light' | 'dark';
  fontSize: string;
}

export const FeedbackDialog: React.FC<FeedbackDialogProps> = (props) => {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  const report = () => compileFeedbackReport({ ...props, description, contactEmail });
  const handleSubmit = async () => {
    if (!description.trim()) return;
    setStatus('sending'); setError('');
    try { await submitFeedbackReport(report()); setStatus('sent'); }
    catch (err) { setStatus('error'); setError(err instanceof Error ? err.message : 'Feedback could not be sent.'); }
  };
  const handleCopy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(report(), null, 2));
    setError('Diagnostic report copied to your clipboard.');
  };
  const close = () => { setOpen(false); setStatus('idle'); setError(''); };

  return <>
    <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-ynab-blue hover:bg-blue-600 text-white font-semibold shadow-lg transition-colors" aria-label="Send feedback">
      <Bug className="w-4 h-4" /> Send feedback
    </button>
    {open && <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && close()}>
      <section role="dialog" aria-modal="true" aria-labelledby="feedback-title" className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#1C2538] shadow-2xl border border-slate-200 dark:border-[#2B374E] overflow-hidden">
        <div className="flex justify-between items-center px-5 py-4 border-b border-slate-200 dark:border-[#2B374E]"><div><h2 id="feedback-title" className="font-bold text-slate-900 dark:text-white">Report an issue</h2><p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Your description is sent with recent chat and safe diagnostic context.</p></div><button onClick={close} aria-label="Close feedback form" className="p-1 rounded hover:bg-slate-100 dark:hover:bg-[#242F46]"><X className="w-5 h-5" /></button></div>
        <div className="p-5 space-y-4"><label className="block text-sm font-semibold">What went wrong?<textarea autoFocus value={description} onChange={(e) => setDescription(e.target.value)} rows={5} placeholder="Tell us what you expected and what happened." className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#151D2C] p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></label><label className="block text-sm font-semibold">Email for a reply <span className="font-normal text-slate-500">optional</span><input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="you@example.com" className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#151D2C] p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></label><p className="text-xs text-slate-500 dark:text-slate-400">Includes the last 12 chat messages, current scenario summary, app settings, browser details, and request timing. It never includes API keys.</p>{status === 'sent' && <p className="flex gap-1.5 items-center text-sm text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="w-4 h-4" />Thank you — your feedback was sent.</p>}{status === 'error' && <p className="text-sm text-amber-700 dark:text-amber-300">{error}</p>}</div>
        <div className="px-5 py-4 bg-slate-50 dark:bg-[#151D2C] border-t border-slate-200 dark:border-[#2B374E] flex justify-between gap-3"><button onClick={() => void handleCopy()} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300"><Copy className="w-3.5 h-3.5" />Copy report</button><button disabled={!description.trim() || status === 'sending' || status === 'sent'} onClick={() => void handleSubmit()} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-ynab-blue hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-semibold"><Send className="w-4 h-4" />{status === 'sending' ? 'Sending…' : 'Submit feedback'}</button></div>
      </section>
    </div>}
  </>;
};
