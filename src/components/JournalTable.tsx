import React, { useState } from 'react';
import type { JournalEntryGroup, AccountingStandard, ExplicitAssumption } from '../types/accounting';
import { AlertOctagon, Calendar, BookOpen, Info, AlertTriangle, CheckCircle2, Cpu } from 'lucide-react';
import { formatSingaporeDate } from '../utils/dateUtils';

interface JournalTableProps {
  groups: JournalEntryGroup[];
  standard: AccountingStandard;
  functionalCurrency: string;
  assumptions?: ExplicitAssumption[];
}

export const JournalTable: React.FC<JournalTableProps> = ({
  groups,
  standard,
  functionalCurrency,
  assumptions = []
}) => {
  const [showMobileNotes, setShowMobileNotes] = useState(false);

  if (!groups || groups.length === 0) {
    return null;
  }

  return (
    <div className="space-y-6">
      {groups.map((group, gIdx) => {
        const status = group.authorityStatus || 'DETERMINISTIC';
        const highMaterialityAssumptions = assumptions.filter((assumption) =>
          assumption.materiality === 'HIGH' && group.lines.some((line) => line.assumptionId === assumption.id)
        );
        return (
        <div
          key={group.id}
          className="bg-workspace-panel rounded-2xl border border-workspace-border dark:border-workspace-border shadow-none overflow-hidden transition-colors duration-200"
        >
          {/* Header of Journal Event */}
          <div className="p-3 sm:p-4 bg-workspace-raised/80 dark:bg-workspace-panel border-b border-workspace-border dark:border-workspace-border flex flex-wrap items-center justify-between gap-2 sm:gap-3">
            <div className="flex items-center gap-2 sm:gap-2.5">
              <span className="w-5 h-5 sm:w-6 sm:h-6 rounded-md bg-workspace-raised dark:bg-workspace-raised border border-slate-700/20 dark:border-workspace-border text-workspace-text font-mono text-[10px] sm:text-xs font-bold flex items-center justify-center shadow-xs shrink-0">
                #{gIdx + 1}
              </span>
              <div>
                <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white leading-snug font-sans">
                  {group.title}
                </h4>
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-3 text-[11px] sm:text-xs text-workspace-muted dark:text-workspace-muted mt-0.5">
                  <span className="flex items-center gap-1 font-medium">
                    <Calendar className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-workspace-muted" />
                    {formatSingaporeDate(group.eventDate)}
                  </span>
                  <span className="hidden xs:inline">•</span>
                  <span className="hidden xs:inline">{group.summary}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Authority Status Badge */}
              {status === 'DETERMINISTIC' && (
                <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  <span>Deterministic</span>
                </span>
              )}
              {status === 'AI_PROPOSED' && (
                <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full border bg-purple-50 text-purple-700 border-purple-300 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800">
                  <Cpu className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                  <span>AI Proposed</span>
                </span>
              )}
              {status === 'CONDITIONAL' && (
                <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800">
                  <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                  <span>Conditional</span>
                </span>
              )}

              {/* Mobile Line Notes Toggle */}
              <button
                onClick={() => setShowMobileNotes(!showMobileNotes)}
                className="sm:hidden inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 dark:text-workspace-secondary hover:text-slate-900 dark:hover:text-white bg-workspace-raised dark:bg-workspace-raised px-2 py-1 rounded-md border border-workspace-border dark:border-workspace-border transition-colors"
                title="Toggle line explanations"
              >
                <Info className="w-3 h-3" />
                <span>{showMobileNotes ? 'Hide Notes' : 'Show Notes'}</span>
              </button>

              {/* Imbalance Alert */}
              {!group.isBalanced && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 sm:px-2.5 sm:py-1 bg-rose-50 text-rose-700 border border-rose-200 dark:bg-workspace-raised dark:text-rose-400 dark:border-rose-800/80 rounded-full text-[10px] sm:text-xs font-medium">
                  <AlertOctagon className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
                  <span>Imbalance</span>
                </div>
              )}
            </div>
          </div>

          {/* Prominent Warning Callout for AI Proposed Journals */}
          {status === 'AI_PROPOSED' && (
            <div className="p-3 sm:p-3.5 bg-purple-50/90 dark:bg-purple-950/40 border-b border-purple-200 dark:border-purple-900/60 flex items-start gap-2.5 text-xs text-purple-900 dark:text-purple-200">
              <AlertTriangle className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold uppercase tracking-wider text-[10px] text-purple-800 dark:text-purple-300 block">
                  AI-Synthesized Proposal (Not Authoritative)
                </span>
                <p className="mt-0.5 leading-relaxed text-[11px] text-purple-950 dark:text-purple-200">
                  This double entry was synthesized by AI for an uncatalogued transaction pattern. It has not been calculated or certified by the deterministic accounting engine. Review and verify before recording.
                </p>
              </div>
            </div>
          )}

          {/* Prominent Warning Callout for Conditional Journals */}
          {status === 'CONDITIONAL' && (
            <div className="p-3 sm:p-3.5 bg-amber-50/90 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/60 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold uppercase tracking-wider text-[10px] text-amber-800 dark:text-amber-300 block">
                  Conditional Illustrative Entry (Subject to Verification)
                </span>
                <p className="mt-0.5 leading-relaxed text-[11px] text-amber-950 dark:text-amber-200">
                  This entry is illustrative and conditional upon establishing material facts or satisfying statutory recognition criteria. Do not record as final until all required facts are established.
                </p>
              </div>
            </div>
          )}

          {/* Journal Entries Table - Clean ledger styling with tabular-nums */}
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm border-collapse table-auto sm:table-fixed">
              <thead>
                <tr className="border-b border-workspace-border dark:border-workspace-border bg-workspace-raised/60 dark:bg-workspace-panel text-[10px] sm:text-xs font-semibold text-workspace-muted dark:text-workspace-muted uppercase tracking-wider">
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
              <tbody className="divide-y divide-slate-100 dark:divide-[#2B374E]/60 font-sans">
                {(group.lines || []).map((line) => {
                  const isCredit = line.credit > 0;
                  const isAssumed = Boolean(line.assumptionId);
                  return (
                    <tr
                      key={line.id}
                      className={`hover:bg-workspace-hover/80 dark:hover:bg-workspace-hover/60 transition-colors ${
                        isCredit ? 'bg-workspace-raised/40 dark:bg-workspace-panel/40' : ''
                      }`}
                    >
                      {/* Account Title */}
                      <td className="py-2.5 sm:py-3.5 px-2 sm:px-4 align-top">
                        <div className={`${isCredit ? 'pl-2 sm:pl-6' : 'pl-0'}`}>
                          <div className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm flex flex-wrap items-center gap-1 sm:gap-2">
                            {isCredit && <span className="text-workspace-muted font-normal text-[11px] sm:text-xs">To:</span>}
                            <span className={`break-words leading-tight ${isAssumed ? 'text-rose-600 dark:text-rose-400' : ''}`}>{line.accountName}</span>
                            {isAssumed && <span className="text-[9px] sm:text-[10px] px-1.5 py-0.5 font-semibold uppercase rounded-md border bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800">Assumed</span>}
                            <span
                              className={`text-[9px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 font-mono uppercase rounded-md border font-medium ${
                                line.category === 'ASSET'
                                  ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800'
                                  : line.category === 'REVENUE'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                                  : line.category === 'EXPENSE'
                                  ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
                                  : line.category === 'LIABILITY'
                                  ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
                                  : 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800'
                              }`}
                            >
                              {line.category}
                            </span>
                          </div>

                          {/* Line comment */}
                          {line.lineExplanation && (
                            <p className={`text-[10px] sm:text-xs text-workspace-muted dark:text-workspace-muted mt-1 leading-relaxed ${showMobileNotes ? 'block' : 'hidden sm:block'}`}>
                              {line.lineExplanation}
                            </p>
                          )}

                          {line.foreignCurrency && line.exchangeRate && (
                            <div className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-workspace-raised dark:bg-workspace-input text-[10px] sm:text-xs font-mono text-slate-700 dark:text-workspace-secondary border border-workspace-border dark:border-workspace-border">
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
                <tr className="border-t-2 border-slate-300 dark:border-workspace-border bg-workspace-raised dark:bg-workspace-panel font-bold text-slate-900 dark:text-white">
                  <td className="py-2.5 sm:py-3 px-2 sm:px-4 text-right uppercase text-[10px] sm:text-xs tracking-wider text-workspace-muted dark:text-workspace-muted">
                    Totals
                  </td>
                  <td className="py-2.5 sm:py-3 px-1.5 sm:px-4 text-right font-mono tabular-nums text-xs sm:text-sm text-slate-900 dark:text-white border-b-2 border-double border-slate-400 dark:border-slate-500 whitespace-nowrap">
                    {group.totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-2.5 sm:py-3 px-1.5 sm:px-4 text-right font-mono tabular-nums text-xs sm:text-sm text-slate-900 dark:text-white border-b-2 border-double border-slate-400 dark:border-slate-500 whitespace-nowrap">
                    {group.totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {highMaterialityAssumptions.length > 0 && (
            <div className="p-3 sm:p-4 border-t border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/20">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-rose-800 dark:text-rose-300">
                <AlertTriangle className="w-3.5 h-3.5" /> High-materiality assumptions used in this journal
              </div>
              <div className="mt-2 space-y-1.5">
                {highMaterialityAssumptions.map((assumption) => (
                  <div key={assumption.id} className="text-xs text-rose-900 dark:text-rose-100">
                    <span className="font-semibold">{assumption.field}:</span> assumed {String(assumption.assumedValue)}. <span className="text-rose-700 dark:text-rose-300">{assumption.basisOrRationale}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Rationale & Standard References Accordion Summary */}
          <div className="p-4 bg-workspace-raised/60 dark:bg-workspace-panel/60 border-t border-workspace-border dark:border-workspace-border">
            <div className="text-[11px] font-semibold text-slate-700 dark:text-workspace-secondary flex items-center gap-1.5 mb-2 font-sans">
              <BookOpen className="w-3.5 h-3.5 text-workspace-muted" />
              <span>Accounting Rationale & Statutory Basis ({standard === 'SFRS_I' ? 'SFRS(I)' : 'IFRS'}):</span>
            </div>
            <ul className="space-y-1.5">
              {group.rationalePoints.map((point, pIdx) => (
                <li key={pIdx} className="text-xs text-slate-600 dark:text-workspace-muted flex items-start gap-2 leading-relaxed">
                  <span className="text-workspace-muted font-bold shrink-0 mt-0.5">•</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      );
    })}
    </div>
  );
};
