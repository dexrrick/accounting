import React from 'react';
import type { JournalEntryGroup, AccountingStandard } from '../types/accounting';
import { AlertOctagon, Calendar, BookOpen } from 'lucide-react';
import { formatSingaporeDate } from '../utils/dateUtils';

interface JournalTableProps {
  groups: JournalEntryGroup[];
  standard: AccountingStandard;
  functionalCurrency: string;
}

export const JournalTable: React.FC<JournalTableProps> = ({
  groups,
  standard,
  functionalCurrency
}) => {
  if (!groups || groups.length === 0) {
    return null;
  }

  return (
    <div className="space-y-6">
      {groups.map((group, gIdx) => (
        <div
          key={group.id}
          className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xl overflow-hidden"
        >
          {/* Header of Journal Event */}
          <div className="p-4 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="w-6 h-6 rounded-md bg-blue-600 text-white font-mono text-xs font-bold flex items-center justify-center shadow-sm">
                #{gIdx + 1}
              </span>
              <div>
                <h4 className="text-sm font-bold text-white">{group.title}</h4>
                <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
                  <span className="flex items-center gap-1 font-medium">
                    <Calendar className="w-3.5 h-3.5 text-slate-500" />
                    {formatSingaporeDate(group.eventDate)}
                  </span>
                  <span>•</span>
                  <span>{group.summary}</span>
                </div>
              </div>
            </div>

            {/* Imbalance Alert (Only shown if entry does not balance) */}
            {!group.isBalanced && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-rose-950/80 text-rose-400 border border-rose-800/80 rounded-full text-xs font-semibold">
                <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />
                <span>Imbalance Detected</span>
              </div>
            )}
          </div>

          {/* Journal Entries Table (Code column removed per user request) */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/40 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-4">Account Title & Statutory Description</th>
                  <th className="py-3 px-4 text-right w-44">
                    Debit ({functionalCurrency})
                  </th>
                  <th className="py-3 px-4 text-right w-44">
                    Credit ({functionalCurrency})
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 font-sans">
                {group.lines.map((line) => {
                  const isCredit = line.credit > 0;
                  return (
                    <tr
                      key={line.id}
                      className={`hover:bg-slate-800/40 transition-colors ${
                        isCredit ? 'bg-slate-950/20' : ''
                      }`}
                    >
                      {/* Account Title & Explanation */}
                      <td className="py-3.5 px-4">
                        <div className={`${isCredit ? 'pl-6' : 'pl-0'}`}>
                          <div className="font-bold text-white text-sm flex items-center gap-2">
                            {isCredit && <span className="text-slate-500 font-normal">To:</span>}
                            <span>{line.accountName}</span>
                            <span
                              className={`text-[10px] px-2 py-0.5 font-mono uppercase rounded-full border ${
                                line.category === 'ASSET'
                                  ? 'bg-blue-950 text-blue-400 border-blue-800'
                                  : line.category === 'REVENUE'
                                  ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                                  : line.category === 'EXPENSE'
                                  ? 'bg-rose-950 text-rose-400 border-rose-800'
                                  : 'bg-purple-950 text-purple-400 border-purple-800'
                              }`}
                            >
                              {line.category}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                            {line.lineExplanation}
                          </p>
                          {line.foreignCurrency && line.exchangeRate && (
                            <div className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-800 text-xs font-mono text-blue-300 border border-slate-700">
                              <span>
                                FX: {line.foreignCurrency} {(line.foreignDebit || line.foreignCredit || 0).toLocaleString()} @ {line.exchangeRate} {functionalCurrency}/{line.foreignCurrency}
                              </span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Debit */}
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-white align-top text-sm">
                        {line.debit > 0
                          ? line.debit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          : '-'}
                      </td>

                      {/* Credit */}
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-white align-top text-sm">
                        {line.credit > 0
                          ? line.credit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          : '-'}
                      </td>
                    </tr>
                  );
                })}

                {/* Total Row */}
                <tr className="border-t-2 border-slate-700 bg-slate-950/70 font-bold text-white">
                  <td className="py-3 px-4 text-right uppercase text-xs tracking-wider text-slate-400">
                    Totals
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-sm text-blue-400 border-b-2 border-double border-slate-600">
                    {group.totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-sm text-blue-400 border-b-2 border-double border-slate-600">
                    {group.totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Rationale & Standard References Accordion Summary */}
          <div className="p-4 bg-slate-950/60 border-t border-slate-800">
            <div className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5 mb-2">
              <BookOpen className="w-3.5 h-3.5 text-blue-400" />
              <span>Accounting Rationale & Statutory Basis ({standard === 'SFRS_I' ? 'SFRS(I)' : 'IFRS'}):</span>
            </div>
            <ul className="space-y-1.5">
              {group.rationalePoints.map((point, pIdx) => (
                <li key={pIdx} className="text-xs text-slate-400 flex items-start gap-2">
                  <span className="text-blue-400 font-bold shrink-0 mt-0.5">•</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
};
