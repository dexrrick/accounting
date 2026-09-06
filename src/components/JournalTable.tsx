import React, { useState } from 'react';
import type { JournalEntryGroup, AccountingStandard } from '../types/accounting';
import { AlertOctagon, Calendar, BookOpen, Info } from 'lucide-react';
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
  const [showMobileNotes, setShowMobileNotes] = useState(false);

  if (!groups || groups.length === 0) {
    return null;
  }

  return (
    <div className="space-y-6">
      {groups.map((group, gIdx) => (
        <div
          key={group.id}
          className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden transition-colors duration-200"
        >
          {/* Header of Journal Event */}
          <div className="p-3 sm:p-4 bg-slate-50/80 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 sm:gap-3">
            <div className="flex items-center gap-2 sm:gap-2.5">
              <span className="w-5 h-5 sm:w-6 sm:h-6 rounded-md bg-ynab-navy dark:bg-slate-800 border border-slate-700/20 dark:border-slate-700 text-white font-mono text-[10px] sm:text-xs font-bold flex items-center justify-center shadow-xs shrink-0">
                #{gIdx + 1}
              </span>
              <div>
                <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white leading-snug font-sans">
                  {group.title}
                </h4>
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-3 text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  <span className="flex items-center gap-1 font-medium">
                    <Calendar className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-slate-400" />
                    {formatSingaporeDate(group.eventDate)}
                  </span>
                  <span className="hidden xs:inline">•</span>
                  <span className="hidden xs:inline">{group.summary}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Mobile Line Notes Toggle */}
              <button
                onClick={() => setShowMobileNotes(!showMobileNotes)}
                className="sm:hidden inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800/80 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 transition-colors"
                title="Toggle line explanations"
              >
                <Info className="w-3 h-3" />
                <span>{showMobileNotes ? 'Hide Notes' : 'Show Notes'}</span>
              </button>

              {/* Imbalance Alert (Only shown if entry does not balance) */}
              {!group.isBalanced && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 sm:px-2.5 sm:py-1 bg-rose-50 text-rose-700 border border-rose-200 dark:bg-slate-900 dark:text-rose-400 dark:border-rose-800/80 rounded-full text-[10px] sm:text-xs font-medium">
                  <AlertOctagon className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
                  <span>Imbalance</span>
                </div>
              )}
            </div>
          </div>

          {/* Journal Entries Table - Clean ledger styling with tabular-nums */}
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm border-collapse table-auto sm:table-fixed">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-100/60 dark:bg-slate-950/40 text-[10px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  <th className="py-2.5 sm:py-3 px-2 sm:px-4">Account Title</th>
                  <th className="py-2.5 sm:py-3 px-1.5 sm:px-4 text-right w-24 sm:w-32 md:w-36">
                    <span className="sm:hidden">Dr</span>
                    <span className="hidden sm:inline">Debit ({functionalCurrency})</span>
                  </th>
                  <th className="py-2.5 sm:py-3 px-1.5 sm:px-4 text-right w-24 sm:w-32 md:w-36">
                    <span className="sm:hidden">Cr</span>
                    <span className="hidden sm:inline">Credit ({functionalCurrency})</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-sans">
                {group.lines.map((line) => {
                  const isCredit = line.credit > 0;
                  return (
                    <tr
                      key={line.id}
                      className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors ${
                        isCredit ? 'bg-slate-50/40 dark:bg-slate-950/20' : ''
                      }`}
                    >
                      {/* Account Title */}
                      <td className="py-2.5 sm:py-3.5 px-2 sm:px-4 align-top">
                        <div className={`${isCredit ? 'pl-2 sm:pl-6' : 'pl-0'}`}>
                          <div className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm flex flex-wrap items-center gap-1 sm:gap-2">
                            {isCredit && <span className="text-slate-400 font-normal text-[11px] sm:text-xs">To:</span>}
                            <span className="break-words leading-tight">{line.accountName}</span>
                            <span
                              className={`text-[9px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 font-mono uppercase rounded-md border font-medium ${
                                line.category === 'ASSET'
                                  ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-slate-800/90 dark:text-slate-300 dark:border-slate-700/70'
                                  : line.category === 'REVENUE'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-slate-800/90 dark:text-emerald-300/90 dark:border-slate-700/70'
                                  : line.category === 'EXPENSE'
                                  ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-slate-800/90 dark:text-rose-300/90 dark:border-slate-700/70'
                                  : line.category === 'LIABILITY'
                                  ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-slate-800/90 dark:text-amber-300/90 dark:border-slate-700/70'
                                  : 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-slate-800/90 dark:text-purple-300/90 dark:border-slate-700/70'
                              }`}
                            >
                              {line.category}
                            </span>
                          </div>

                          {/* Line comment */}
                          {line.lineExplanation && (
                            <p className={`text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed ${showMobileNotes ? 'block' : 'hidden sm:block'}`}>
                              {line.lineExplanation}
                            </p>
                          )}

                          {line.foreignCurrency && line.exchangeRate && (
                            <div className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800/80 text-[10px] sm:text-xs font-mono text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                              <span>
                                FX: {line.foreignCurrency} {(line.foreignDebit || line.foreignCredit || 0).toLocaleString()} @ {line.exchangeRate}
                              </span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Debit */}
                      <td className="py-2.5 sm:py-3.5 px-1.5 sm:px-4 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white align-top text-xs sm:text-sm whitespace-nowrap">
                        {line.debit > 0
                          ? line.debit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          : '-'}
                      </td>

                      {/* Credit */}
                      <td className="py-2.5 sm:py-3.5 px-1.5 sm:px-4 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white align-top text-xs sm:text-sm whitespace-nowrap">
                        {line.credit > 0
                          ? line.credit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          : '-'}
                      </td>
                    </tr>
                  );
                })}

                {/* Total Row */}
                <tr className="border-t-2 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/70 font-bold text-slate-900 dark:text-white">
                  <td className="py-2.5 sm:py-3 px-2 sm:px-4 text-right uppercase text-[10px] sm:text-xs tracking-wider text-slate-500 dark:text-slate-400">
                    Totals
                  </td>
                  <td className="py-2.5 sm:py-3 px-1.5 sm:px-4 text-right font-mono tabular-nums text-xs sm:text-sm text-slate-900 dark:text-white border-b-2 border-double border-slate-400 dark:border-slate-600 whitespace-nowrap">
                    {group.totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-2.5 sm:py-3 px-1.5 sm:px-4 text-right font-mono tabular-nums text-xs sm:text-sm text-slate-900 dark:text-white border-b-2 border-double border-slate-400 dark:border-slate-600 whitespace-nowrap">
                    {group.totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Rationale & Standard References Accordion Summary */}
          <div className="p-4 bg-slate-50/60 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800">
            <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 mb-2 font-sans">
              <BookOpen className="w-3.5 h-3.5 text-slate-400" />
              <span>Accounting Rationale & Statutory Basis ({standard === 'SFRS_I' ? 'SFRS(I)' : 'IFRS'}):</span>
            </div>
            <ul className="space-y-1.5">
              {group.rationalePoints.map((point, pIdx) => (
                <li key={pIdx} className="text-xs text-slate-600 dark:text-slate-400 flex items-start gap-2 leading-relaxed">
                  <span className="text-slate-400 font-bold shrink-0 mt-0.5">•</span>
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
