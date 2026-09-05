import React from 'react';
import type { AccountingStandard, StandardCitation } from '../types/accounting';
import { ShieldCheck, ExternalLink, BookCheck, Check } from 'lucide-react';

interface ComplianceRationaleProps {
  citations: StandardCitation[];
  standard: AccountingStandard;
  classification?: 'FVTPL' | 'FVTOCI';
}

export const ComplianceRationale: React.FC<ComplianceRationaleProps> = ({
  citations,
  standard,
  classification = 'FVTPL'
}) => {
  const isSfrs = standard === 'SFRS_I';
  const authorityName = isSfrs 
    ? 'Accounting Standards Council (ASC) Singapore' 
    : 'International Accounting Standards Board (IASB)';
  const authorityUrl = isSfrs ? 'https://www.asc.gov.sg' : 'https://www.ifrs.org';

  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xl overflow-hidden">
      {/* Header */}
      <div className="p-4 bg-gradient-to-r from-slate-950 via-indigo-950 to-slate-950 text-white flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-emerald-400 border border-white/10">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-100">
              Statutory Compliance & Legal Authority
            </h3>
            <p className="text-[11px] text-slate-400">
              Verified against {authorityName} pronouncements (Current: {classification})
            </p>
          </div>
        </div>

        <a
          href={authorityUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white text-[11px] font-medium transition-colors"
        >
          <span>Official Source</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Citations Grid */}
      <div className="p-5 space-y-4 text-xs">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {citations.map((cite, cIdx) => (
            <div
              key={cIdx}
              className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-2 hover:border-blue-500/50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-blue-400 font-mono text-xs">
                  {cite.standard} {cite.paragraph}
                </span>
                <span className="text-[10px] bg-blue-950 text-blue-300 px-1.5 py-0.2 rounded border border-blue-800 font-semibold">
                  Mandatory
                </span>
              </div>
              <h4 className="font-semibold text-white text-xs">{cite.title}</h4>
              <p className="text-slate-400 text-[11px] leading-relaxed italic bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                "{cite.text}"
              </p>
            </div>
          ))}
        </div>

        {/* Technical In-Depth "Why" Deep Dive */}
        <div className="mt-4 p-4 bg-indigo-950/40 border border-indigo-900/60 rounded-xl space-y-3">
          <div className="flex items-center gap-2 text-indigo-300 font-bold text-xs">
            <BookCheck className="w-4 h-4 text-indigo-400" />
            <span>Why are these accounts debited & credited? (Accounting Axioms)</span>
          </div>

          <div className="space-y-2 text-[11px] text-slate-300 leading-relaxed">
            <div className="flex items-start gap-2">
              <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <strong>The Fundamental Accounting Equation:</strong> Assets = Liabilities + Equity. Every transaction impacts at least two accounts in opposing debit/credit positions to maintain absolute balance.
              </div>
            </div>

            <div className="flex items-start gap-2">
              <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <strong>Operating Expense Recognition:</strong> Under {isSfrs ? 'SFRS(I) 1-1' : 'IAS 1'}, expenses reduce equity via profit or loss, so they are debited. Settlement reduces asset resources (bank), which is credited.
              </div>
            </div>

            <div className="flex items-start gap-2">
              <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <strong>Foreign Exchange Translation:</strong> Under {isSfrs ? 'SFRS(I) 1-21' : 'IAS 21'}, transactions must be translated at the spot rate at transaction date. Rates are verified via official ECB reference feeds (Frankfurter API).
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
