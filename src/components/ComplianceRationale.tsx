import React from 'react';
import type { AccountingStandard, StandardCitation, StatutoryAdvisoryInfo } from '../types/accounting';
import { ShieldCheck, ExternalLink, BookCheck, Check, Scale, FileText } from 'lucide-react';
import { getAuthorityBadgeInfo } from '../utils/statutoryLinkResolver';

interface ComplianceRationaleProps {
  citations: StandardCitation[];
  advisories?: StatutoryAdvisoryInfo[];
  standard: AccountingStandard;
  classification?: 'FVTPL' | 'FVTOCI';
}

export const ComplianceRationale: React.FC<ComplianceRationaleProps> = ({
  citations,
  advisories = [],
  standard,
  classification = 'FVTPL'
}) => {
  const isSfrs = standard === 'SFRS_I';
  const authorityName = isSfrs 
    ? 'Accounting Standards Council (ASC) Singapore & IASB' 
    : 'International Accounting Standards Board (IASB)';

  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xl overflow-hidden space-y-6">
      {/* Statutory Header */}
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
              Grounded in IRAS, ACRA, CPF Board, MOM, MAS, and Singapore Statutes Online {classification ? `(${classification})` : ''}
            </p>
          </div>
        </div>

        <a
          href="https://sso.agc.gov.sg"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white text-[11px] font-medium transition-colors"
        >
          <span>Singapore Statutes Online</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Advisory Breakdown Cards (if available) */}
      {advisories && advisories.length > 0 && (
        <div className="px-5 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400">
            <Scale className="w-4 h-4 text-amber-400" />
            <span>Singapore Statutory & Tax Directives</span>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {advisories.map((adv, idx) => {
              const badge = getAuthorityBadgeInfo(adv.authority);
              return (
                <div
                  key={idx}
                  className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3 hover:border-slate-700 transition-colors"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge.badgeClass}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${badge.dotColor}`}></span>
                        {badge.label}
                      </span>
                      <span className="font-mono text-xs font-bold text-white">
                        {adv.statuteOrAct} • {adv.sectionOrSchedule}
                      </span>
                    </div>

                    {adv.officialUrl && (
                      <a
                        href={adv.officialUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        <span>Official Legislation</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>

                  <h4 className="font-semibold text-white text-xs">{adv.topic}</h4>
                  <p className="text-slate-300 text-[11px] leading-relaxed bg-slate-900/80 p-3 rounded-lg border border-slate-800">
                    {adv.summary}
                  </p>

                  {adv.keyRules && adv.keyRules.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                        Key Statutory Rules & Thresholds:
                      </div>
                      <ul className="space-y-1 text-[11px] text-slate-300">
                        {adv.keyRules.map((rule, rIdx) => (
                          <li key={rIdx} className="flex items-start gap-2">
                            <span className="text-blue-400 font-bold">•</span>
                            <span>{rule}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {(adv.isTaxDeductible !== undefined || adv.isGstClaimable !== undefined) && (
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800/80">
                      {adv.isTaxDeductible !== undefined && (
                        <span className={`text-[10px] px-2 py-0.5 rounded font-medium border ${
                          adv.isTaxDeductible
                            ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800'
                            : 'bg-rose-950/70 text-rose-300 border-rose-800'
                        }`}>
                          Corporate Tax: {adv.isTaxDeductible ? '✓ Fully Deductible (S14)' : '✗ Disallowed / Non-Deductible (S15)'}
                        </span>
                      )}
                      {adv.isGstClaimable !== undefined && (
                        <span className={`text-[10px] px-2 py-0.5 rounded font-medium border ${
                          adv.isGstClaimable
                            ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800'
                            : 'bg-rose-950/70 text-rose-300 border-rose-800'
                        }`}>
                          GST 9%: {adv.isGstClaimable ? '✓ Claimable Input Tax' : '✗ Blocked Input Tax (Reg 26)'}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Citations Grid */}
      <div className="p-5 pt-0 space-y-4 text-xs">
        {citations.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-400">
              <FileText className="w-4 h-4 text-blue-400" />
              <span>Standard Accounting & Statutory Citations</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {citations.map((cite, cIdx) => {
                const badge = getAuthorityBadgeInfo(cite.authority);
                return (
                  <div
                    key={cIdx}
                    className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-2 hover:border-blue-500/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold ${badge.badgeClass}`}>
                          {badge.label}
                        </span>
                        <span className="font-bold text-blue-400 font-mono text-xs">
                          {cite.standard} {cite.paragraph}
                        </span>
                      </div>
                      {cite.officialSourceUrl ? (
                        <a
                          href={cite.officialSourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"
                        >
                          <span>Source</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      ) : (
                        <span className="text-[10px] bg-blue-950 text-blue-300 px-1.5 py-0.2 rounded border border-blue-800 font-semibold">
                          Mandatory
                        </span>
                      )}
                    </div>
                    <h4 className="font-semibold text-white text-xs">{cite.title}</h4>
                    <p className="text-slate-400 text-[11px] leading-relaxed italic bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                      "{cite.text}"
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Technical In-Depth "Why" Deep Dive */}
        <div className="p-4 bg-indigo-950/40 border border-indigo-900/60 rounded-xl space-y-3">
          <div className="flex items-center gap-2 text-indigo-300 font-bold text-xs">
            <BookCheck className="w-4 h-4 text-indigo-400" />
            <span>Statutory Grounding & Axioms (Why these rules apply)</span>
          </div>

          <div className="space-y-2 text-[11px] text-slate-300 leading-relaxed">
            <div className="flex items-start gap-2">
              <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <strong>Statutory Precedence:</strong> In Singapore, corporate reporting follows {authorityName} pursuant to Section 201 of the Companies Act 1967. Tax computations must reconcile accounting profit to taxable profit under the Income Tax Act 1947.
              </div>
            </div>

            <div className="flex items-start gap-2">
              <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <strong>Tax Depreciation vs. Capital Allowances:</strong> Accounting depreciation is an internal estimate and is always added back in tax computation. Tax deductions for fixed assets are governed exclusively by Section 19/19A Capital Allowances.
              </div>
            </div>

            <div className="flex items-start gap-2">
              <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <strong>GST Recovery Divergence:</strong> Being a legitimate business expense under accounting standards does not guarantee GST claimability. Blocked categories under Regulation 26 (e.g. passenger cars, club memberships) must be recognized as non-claimable input GST.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
export default ComplianceRationale;
