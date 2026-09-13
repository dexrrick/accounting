import React from 'react';
import { ArrowLeftRight, Info } from 'lucide-react';
import type { AccountingScenarioState } from '../types/accounting';

export const ShareTransferCalculator: React.FC<{ scenario: AccountingScenarioState | null }> = ({ scenario }) => {
  const analysis = scenario?.shareTransferAnalysis;
  return <section className="bg-white dark:bg-[#1C2538] rounded-2xl border border-slate-200 dark:border-[#2B374E] shadow-xl overflow-hidden">
    <div className="p-4 border-b border-slate-200 dark:border-[#2B374E] flex items-center gap-3"><div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center"><ArrowLeftRight className="w-4 h-4" /></div><div><h2 className="text-sm font-bold">Group Share-Transfer Calculator</h2><p className="text-xs text-slate-500 dark:text-slate-400">Ask a Share Structure question in plain language. This tool calculates holdings only; it does not create a journal.</p></div></div>
    {!analysis ? <div className="p-5 text-sm text-slate-600 dark:text-slate-300 flex gap-2"><Info className="w-4 h-4 shrink-0 text-indigo-500" /><span>Include the pre-transfer holdings, each transfer leg, and every company or individual involved. Example: “A holds 600 of C; B holds 400 of C; A transfers 300 C shares to B.”</span></div> : <>
      <div className="p-4 text-sm text-slate-700 dark:text-slate-200"><strong>Latest event:</strong> {analysis.eventSummary}</div>
      <div className="border-t border-slate-200 dark:border-[#2B374E] overflow-x-auto"><table className="w-full text-xs"><thead className="bg-slate-50 dark:bg-[#151D2C] text-left"><tr><th className="p-3">Company</th><th className="p-3">Holder</th><th className="p-3">Before</th><th className="p-3">After</th><th className="p-3">Change</th></tr></thead><tbody>{analysis.rows.map(row => { const delta = row.afterShares - row.beforeShares; return <tr key={`${row.company}-${row.holder}`} className="border-t border-slate-100 dark:border-[#2B374E]"><td className="p-3 font-medium">{row.company}</td><td className="p-3">{row.holder}</td><td className="p-3">{row.beforeShares.toLocaleString()} <span className="text-slate-500">({row.beforePercent.toFixed(2)}%)</span></td><td className="p-3">{row.afterShares.toLocaleString()} <span className="text-slate-500">({row.afterPercent.toFixed(2)}%)</span></td><td className={delta >= 0 ? 'p-3 text-emerald-600 font-semibold' : 'p-3 text-red-600 font-semibold'}>{delta >= 0 ? '+' : ''}{delta.toLocaleString()}</td></tr>; })}</tbody></table></div>
      <div className="p-4 space-y-1 text-xs text-slate-600 dark:text-slate-300">{analysis.notes.map(note => <p key={note}>• {note}</p>)}</div>
    </>}
  </section>;
};
