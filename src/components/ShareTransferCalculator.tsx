import React, { useState } from 'react';
import { ArrowLeftRight, Play, AlertTriangle } from 'lucide-react';
import { calculateShareTransfers, type CompanyCapTable, type ShareTransfer, type ShareTransferResult } from '../engine/shareTransferEngine';

const initialTables = `[
  {"company":"Company C","shareClass":"Ordinary","positions":[{"holder":"Company A","shares":600},{"holder":"Founder","shares":400}]},
  {"company":"Company B","shareClass":"Ordinary","positions":[{"holder":"Company B","shares":500},{"holder":"Investor","shares":500}]}
]`;
const initialTransfers = `[
  {"company":"Company C","from":"Company A","to":"Company B","shares":300},
  {"company":"Company B","from":"Company B","to":"Company A","shares":200}
]`;

export const ShareTransferCalculator: React.FC = () => {
  const [tablesText, setTablesText] = useState(initialTables);
  const [transfersText, setTransfersText] = useState(initialTransfers);
  const [result, setResult] = useState<ShareTransferResult>(() => calculateShareTransfers(JSON.parse(initialTables), JSON.parse(initialTransfers)));
  const [inputError, setInputError] = useState('');

  const calculate = () => {
    try {
      const tables = JSON.parse(tablesText) as CompanyCapTable[];
      const transfers = JSON.parse(transfersText) as ShareTransfer[];
      setResult(calculateShareTransfers(tables, transfers));
      setInputError('');
    } catch {
      setInputError('Enter valid JSON for both the cap tables and share transfers.');
    }
  };

  return <section className="bg-white dark:bg-[#1C2538] rounded-2xl border border-slate-200 dark:border-[#2B374E] shadow-xl overflow-hidden">
    <div className="p-4 border-b border-slate-200 dark:border-[#2B374E] flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center"><ArrowLeftRight className="w-4 h-4" /></div>
      <div><h2 className="text-sm font-bold">Group Share-Transfer Calculator</h2><p className="text-xs text-slate-500 dark:text-slate-400">Tracks legal share transfers and before/after ownership by company and share class. No journal entry is created.</p></div>
    </div>
    <div className="p-4 grid lg:grid-cols-2 gap-4">
      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Cap tables (JSON)<textarea value={tablesText} onChange={event => setTablesText(event.target.value)} className="mt-1 w-full h-48 p-3 font-mono text-xs rounded-lg border border-slate-300 dark:border-[#2B374E] bg-slate-50 dark:bg-[#111827]" /></label>
      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Transfer events (JSON)<textarea value={transfersText} onChange={event => setTransfersText(event.target.value)} className="mt-1 w-full h-48 p-3 font-mono text-xs rounded-lg border border-slate-300 dark:border-[#2B374E] bg-slate-50 dark:bg-[#111827]" /></label>
    </div>
    <div className="px-4 pb-4 flex flex-wrap items-center gap-3"><button onClick={calculate} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-500"><Play className="w-3.5 h-3.5" />Calculate ownership changes</button>{inputError && <span className="text-xs text-red-600">{inputError}</span>}</div>
    {(result.errors.length > 0) && <div className="mx-4 mb-4 p-3 text-xs text-red-700 dark:text-red-300 border border-red-200 rounded-lg"><AlertTriangle className="inline w-4 h-4 mr-1" />{result.errors.join(' ')}</div>}
    {result.changes.length > 0 && <div className="border-t border-slate-200 dark:border-[#2B374E] overflow-x-auto"><table className="w-full text-xs"><thead className="bg-slate-50 dark:bg-[#151D2C] text-left"><tr><th className="p-3">Company / class</th><th className="p-3">Holder</th><th className="p-3">Before</th><th className="p-3">After</th><th className="p-3">Change</th></tr></thead><tbody>{result.changes.map(change => <tr key={`${change.company}-${change.shareClass}-${change.holder}`} className="border-t border-slate-100 dark:border-[#2B374E]"><td className="p-3">{change.company}<br/><span className="text-slate-500">{change.shareClass}</span></td><td className="p-3 font-medium">{change.holder}</td><td className="p-3">{change.beforeShares.toLocaleString()} <span className="text-slate-500">({change.beforePercent}%)</span></td><td className="p-3">{change.afterShares.toLocaleString()} <span className="text-slate-500">({change.afterPercent}%)</span></td><td className={`p-3 font-semibold ${change.changeShares > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{change.changeShares > 0 ? '+' : ''}{change.changeShares.toLocaleString()} ({change.changePercent > 0 ? '+' : ''}{change.changePercent}%)</td></tr>)}</tbody></table></div>}
  </section>;
};
