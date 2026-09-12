import type { AccountingStandard, StandardCitation, StatutoryAdvisoryInfo, QueryDomain, ExplicitAssumption } from '../types/accounting';
import React from 'react';
import { ShieldCheck, ExternalLink, Scale, FileText, Calendar, AlertTriangle, Building, Landmark, Info } from 'lucide-react';
import { getAuthorityBadgeInfo, getSafeOfficialUrl } from '../utils/statutoryLinkResolver';
import { defaultCitationVerifier } from '../verification/citationVerifier';
import type { OfficialAnswerLink } from '../utils/chatPresentation';

interface ComplianceRationaleProps {
  citations: StandardCitation[];
  advisories?: StatutoryAdvisoryInfo[];
  officialAnswerLinks?: OfficialAnswerLink[];
  standard: AccountingStandard;
  classification?: 'FVTPL' | 'FVTOCI';
  primaryDomain?: QueryDomain;
  assumptions?: ExplicitAssumption[];
  accountingTreatmentSummary?: string;
  singaporeTaxTreatmentSummary?: string;
  regulatoryMandatesSummary?: string;
  effectiveDateOrTiming?: string;
  uncertaintyDisclaimer?: string;
}

export const ComplianceRationale: React.FC<ComplianceRationaleProps> = ({
  citations,
  advisories = [],
  officialAnswerLinks = [],
  standard,
  classification = 'FVTPL',
  primaryDomain,
  assumptions = [],
  accountingTreatmentSummary,
  singaporeTaxTreatmentSummary,
  regulatoryMandatesSummary,
  effectiveDateOrTiming,
  uncertaintyDisclaimer
}) => {
  const evidenceIncomplete = citations.length === 0 || Boolean(uncertaintyDisclaimer);
  const hasProjection = effectiveDateOrTiming?.toLowerCase().includes('projection') || false;
  const showTaxTreatment = Boolean(singaporeTaxTreatmentSummary);
  const directivesLabel = primaryDomain === 'ACCOUNTING_SFRS'
    ? 'Singapore Financial Reporting Directives'
    : 'Singapore Statutory & Tax Directives';

  return (
    <div className="bg-white dark:bg-[#1C2538] rounded-2xl border border-slate-200 dark:border-[#2B374E] shadow-xl overflow-hidden space-y-6 transition-colors duration-200">
      {/* Statutory Header */}
      <div className="p-4 bg-slate-50/80 dark:bg-[#151D2C] text-slate-900 dark:text-white flex items-center justify-between border-b border-slate-200 dark:border-[#2B374E]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-ynab-navy dark:bg-[#242F46] flex items-center justify-center text-white border border-slate-700/20 dark:border-[#2B374E] shadow-xs">
            <ShieldCheck className="w-4 h-4 text-ynab-blue dark:text-blue-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100 font-sans">
                Statutory Compliance & Legal Authority
              </h3>
              {primaryDomain && (
                <span className="text-[9px] font-mono px-2 py-0.5 rounded-md bg-slate-100 dark:bg-[#242F46] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#2B374E] font-medium">
                  {primaryDomain}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Grounded in IRAS, ACRA, CPF Board, MOM, MAS, and Singapore Statutes Online {classification ? `(${classification})` : ''}
            </p>
          </div>
        </div>

        <a
          href="https://sso.agc.gov.sg"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-[#242F46] dark:hover:bg-[#2D3B58] text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-[#2B374E] text-[11px] font-medium transition-colors"
        >
          <span>Singapore Statutes Online</span>
          <ExternalLink className="w-3 h-3 text-slate-400" />
        </a>
      </div>

      {/* Decision-status legend: users should never infer certainty from presentation alone. */}
      <div className="px-5 -mb-2 flex flex-wrap gap-2">
        {!evidenceIncomplete && (
          <span className="text-[10px] px-2.5 py-1 rounded-md font-semibold border bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
            ✓ Evidence Grounded
          </span>
        )}
        {assumptions.length > 0 && (
          <span className="text-[10px] px-2.5 py-1 rounded-md font-semibold border bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800">
            ⚠ Assumptions Require Confirmation
          </span>
        )}
        {hasProjection && (
          <span className="text-[10px] px-2.5 py-1 rounded-md font-semibold border bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800">
            ◇ Illustrative Projection
          </span>
        )}
        {evidenceIncomplete && (
          <span className="text-[10px] px-2.5 py-1 rounded-md font-semibold border bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800">
            ! Evidence Incomplete — Review Required
          </span>
        )}
      </div>

      {/* Effective Timing Banner */}
      {effectiveDateOrTiming && (
        <div className="mx-5 p-3.5 bg-blue-50/90 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 rounded-xl flex items-start gap-3">
          <div className="w-6 h-6 rounded-md bg-blue-100 dark:bg-blue-900/70 flex items-center justify-center shrink-0 mt-0.5">
            <Calendar className="w-3.5 h-3.5 text-blue-600 dark:text-blue-300" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-800 dark:text-blue-300">
              Current Applicable Period & Threshold Status
            </span>
            <p className="text-xs text-blue-900 dark:text-blue-200 mt-0.5 leading-relaxed font-medium">
              {effectiveDateOrTiming}
            </p>
          </div>
        </div>
      )}

      {/* Dual Authority Comparison: Financial Reporting (SFRS(I)) vs Singapore Tax Treatment (IRAS) */}
      {(accountingTreatmentSummary || singaporeTaxTreatmentSummary) && (
        <div className="px-5 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 font-sans">
            <Scale className="w-4 h-4 text-slate-400" />
            <span>Financial Reporting vs Singapore Tax Bifurcation</span>
          </div>

          <div className={`grid grid-cols-1 ${showTaxTreatment ? 'md:grid-cols-2' : ''} gap-4`}>
            {/* Column 1: Financial Reporting Treatment */}
            <div className="p-4 bg-indigo-50/50 dark:bg-[#1A2234] border border-indigo-200/80 dark:border-indigo-900/50 rounded-xl space-y-2.5 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-900/70 text-indigo-800 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800">
                    <Building className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                    ASC / SFRS(I) Treatment
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">Financial Reporting</span>
              </div>
              <h4 className="text-xs font-bold text-slate-900 dark:text-white">Financial Statement Recognition & Policies</h4>
              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed bg-white/90 dark:bg-[#151D2C] p-3 rounded-lg border border-indigo-100 dark:border-indigo-950">
                {accountingTreatmentSummary || 'Standard SFRS(I) double entry recognition applies according to accrual basis accounting.'}
              </p>
            </div>

            {/* Only display a tax analysis when the answer contains a tax analysis. */}
            {showTaxTreatment && <div className="p-4 bg-emerald-50/50 dark:bg-[#162724] border border-emerald-200/80 dark:border-emerald-900/50 rounded-xl space-y-2.5 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/70 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800">
                    <Landmark className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                    IRAS Tax & GST Treatment
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">Tax Computation</span>
              </div>
              <h4 className="text-xs font-bold text-slate-900 dark:text-white">Tax Deductibility, Capital Allowances & GST</h4>
              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed bg-white/90 dark:bg-[#151D2C] p-3 rounded-lg border border-emerald-100 dark:border-emerald-950">
                {singaporeTaxTreatmentSummary}
              </p>
            </div>
            }
          </div>
        </div>
      )}

      {/* Regulatory Mandates (ACRA / MOM / CPF) */}
      {regulatoryMandatesSummary && (
        <div className="mx-5 p-4 bg-slate-50 dark:bg-[#151D2C] border border-slate-200 dark:border-[#2B374E] rounded-xl space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 font-sans">
            <ShieldCheck className="w-4 h-4 text-ynab-blue dark:text-blue-400" />
            <span>Singapore Regulatory Compliance Mandates</span>
          </div>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed bg-white dark:bg-[#1C2538] p-3 rounded-lg border border-slate-200 dark:border-[#2B374E]">
            {regulatoryMandatesSummary}
          </p>
        </div>
      )}

      {/* Advisory Breakdown Cards (if available) */}
      {advisories && advisories.length > 0 && (
        <div className="px-5 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 font-sans">
            <Scale className="w-4 h-4 text-slate-400" />
            <span>{directivesLabel}</span>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {advisories.map((adv, idx) => {
              const badge = getAuthorityBadgeInfo(adv.authority);
              return (
                <div
                  key={idx}
                  className="p-4 bg-slate-50/70 dark:bg-[#151D2C] border border-slate-200 dark:border-[#2B374E] rounded-xl space-y-3 hover:border-slate-300 dark:hover:border-slate-600 transition-colors shadow-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-0.5 rounded-md border ${badge.badgeClass}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${badge.dotColor}`}></span>
                        {badge.label}
                      </span>
                      <span className="font-mono text-xs font-semibold text-slate-900 dark:text-white">
                        {adv.statuteOrAct} • {adv.sectionOrSchedule}
                      </span>
                    </div>

                    {(() => {
                      const safeUrl = getSafeOfficialUrl(adv.officialUrl, adv.statuteOrAct, adv.sectionOrSchedule, adv.authority);
                      return safeUrl ? (
                        <a
                          href={safeUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-ynab-blue dark:text-blue-400 hover:underline transition-colors"
                        >
                          <span>Official Legislation</span>
                          <ExternalLink className="w-3 h-3 text-slate-400" />
                        </a>
                      ) : null;
                    })()}
                  </div>

                  <h4 className="font-semibold text-slate-900 dark:text-white text-xs">{adv.topic}</h4>
                  <p className="text-slate-700 dark:text-slate-300 text-[11px] leading-relaxed bg-white dark:bg-[#1C2538] p-3 rounded-lg border border-slate-200 dark:border-[#2B374E]">
                    {adv.summary}
                  </p>

                  {adv.keyRules && adv.keyRules.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider">
                        Key Statutory Rules & Thresholds:
                      </div>
                      <ul className="space-y-1 text-[11px] text-slate-700 dark:text-slate-300">
                        {adv.keyRules.map((rule, rIdx) => (
                          <li key={rIdx} className="flex items-start gap-2 leading-relaxed">
                            <span className="text-slate-400 font-bold">•</span>
                            <span>{rule}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {(adv.isTaxDeductible !== undefined || adv.isGstClaimable !== undefined) && (
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200 dark:border-[#2B374E]">
                      {adv.isTaxDeductible !== undefined && (
                        <span className={`text-[10px] px-2.5 py-0.5 rounded-md font-medium border ${
                          adv.isTaxDeductible
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                            : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
                        }`}>
                          Corporate Tax: {adv.isTaxDeductible ? '✓ Fully Deductible (S14)' : '✗ Disallowed / Non-Deductible (S15)'}
                        </span>
                      )}
                      {adv.isGstClaimable !== undefined && (
                        <span className={`text-[10px] px-2.5 py-0.5 rounded-md font-medium border ${
                          adv.isGstClaimable
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                            : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
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
        {officialAnswerLinks.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              <ExternalLink className="w-4 h-4" /> Official links supplied with this answer
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              An official destination alone does not verify every claim. Review the citation status below where available.
            </p>
            <div className="flex flex-wrap gap-2">
              {officialAnswerLinks.map(link => (
                <a key={link.url} href={link.url} target="_blank" rel="noreferrer"
                  className="text-[11px] text-ynab-blue dark:text-blue-400 hover:underline border border-slate-200 dark:border-[#2B374E] rounded-lg px-2.5 py-1.5">
                  {link.title} ↗
                </a>
              ))}
            </div>
          </div>
        )}
        {citations.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 font-sans">
              <FileText className="w-4 h-4 text-slate-400" />
              <span>Standard Accounting & Statutory Citations</span>
            </div>

            {/* Prominent Structural Verification Disclosure Notice */}
            <div className="p-3 bg-slate-100/90 dark:bg-[#151D2C] border border-slate-200 dark:border-[#2B374E] rounded-xl text-[11px] text-slate-600 dark:text-slate-400 flex items-start gap-2.5 leading-relaxed">
              <Info className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-slate-800 dark:text-slate-200">Structural Verification Notice:</span>{' '}
                Structural verification checks that the statute, section, governing authority, and official URL exist in verified Singapore repositories and match the retrieved evidence scope. It confirms anti-fabrication and structural validity, but does <strong>NOT</strong> certify semantic claim validity or replace professional accounting advice.
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(() => {
                const seen = new Set<string>();
                const uniqueCitations = citations.filter((c) => {
                  const key = `${(c.standard || '').toLowerCase()}-${(c.paragraph || '').toLowerCase()}-${(c.officialSourceUrl || '').toLowerCase()}`;
                  if (seen.has(key)) return false;
                  seen.add(key);
                  return true;
                });
                return uniqueCitations.map((cite, cIdx) => {
                  const badge = getAuthorityBadgeInfo(cite.authority);
                  return (
                    <div
                      key={cIdx}
                      className="p-3.5 bg-slate-50/70 dark:bg-[#151D2C] border border-slate-200 dark:border-[#2B374E] rounded-xl space-y-2 hover:border-slate-300 dark:hover:border-slate-600 transition-colors shadow-xs"
                    >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-[9px] px-2 py-0.5 rounded-md border font-medium ${badge.badgeClass}`}>
                          {badge.label}
                        </span>
                        <span className="font-semibold text-slate-900 dark:text-slate-200 font-mono text-xs">
                          {cite.standard} {cite.paragraph}
                        </span>
                        {(() => {
                          const verification = defaultCitationVerifier.verifyCitation(cite);
                          const matched = verification.matchedRecord;
                          const freshness = matched?.freshnessStatus;

                          return (
                            <>
                              {verification.status === 'VERIFIED_PRIMARY_SOURCE' && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded font-medium border bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
                                  ✓ Primary Source
                                </span>
                              )}
                              {(verification.status === 'SOURCE_NEEDS_REVIEW' || verification.status === 'STRUCTURALLY_VERIFIED_SUMMARY') && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded font-medium border bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800">
                                  📝 Curated Summary
                                </span>
                              )}
                              {(!verification.isValid && verification.status === 'UNVERIFIED') && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded font-medium border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800">
                                  ⚠️ Unverified Citation
                                </span>
                              )}

                              {/* Temporal Freshness Indicators */}
                              {freshness === 'ACTIVE_CURRENT' && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded font-medium border bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800">
                                  🟢 Active / In Force
                                </span>
                              )}
                              {freshness === 'HISTORICAL_SUPERSEDED' && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded font-medium border bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">
                                  📜 Historical {matched?.validTo ? `(to ${matched.validTo})` : '(Superseded)'}
                                </span>
                              )}
                              {freshness === 'PENDING_EFFECTIVE' && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded font-medium border bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800">
                                  ⏳ Pending Effective ({matched?.validFrom})
                                </span>
                              )}
                              {freshness === 'AUDIT_OVERDUE' && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded font-medium border bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800">
                                  ⚠️ Verification Review Due
                                </span>
                              )}
                            </>
                          );
                        })()}
                      </div>
                      {(() => {
                        const safeCiteUrl = cite.officialSourceUrl
                          ? getSafeOfficialUrl(cite.officialSourceUrl, cite.standard, cite.paragraph, cite.authority)
                          : null;
                        return safeCiteUrl ? (
                          <a
                            href={safeCiteUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] text-ynab-blue dark:text-blue-400 hover:underline flex items-center gap-1 transition-colors"
                          >
                            <span>Source</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        ) : (
                          <span className="text-[10px] bg-slate-100 dark:bg-[#242F46] text-slate-700 dark:text-slate-300 px-1.5 py-0.2 rounded border border-slate-200 dark:border-[#2B374E] font-medium">
                            Mandatory
                          </span>
                        );
                      })()}
                    </div>
                    <h4 className="font-semibold text-slate-900 dark:text-white text-xs">{cite.title}</h4>
                    {(() => {
                      const matched = defaultCitationVerifier.verifyCitation(cite).matchedRecord;
                      if (matched?.validFrom || matched?.validTo) {
                        return (
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                            Applicability Window: {matched.validFrom || 'Initial'} to {matched.validTo || 'Present (In Force)'}
                          </div>
                        );
                      }
                      return null;
                    })()}
                    <p className="text-slate-600 dark:text-slate-400 text-[11px] leading-relaxed italic bg-white dark:bg-[#1C2538] p-2.5 rounded-lg border border-slate-200 dark:border-[#2B374E]">
                      "{cite.text}"
                    </p>
                  </div>
                );
              });
            })()}
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 italic mt-1.5">
              * Structural verification confirms the cited standard, section/paragraph, governing authority, and official source URL exist in verified repositories. It does not constitute legal or audit sign-off or prove semantic claim validity.
            </p>
          </div>
        )}

        {/* Supporting notices are available when needed without interrupting the primary analysis. */}
        {assumptions.length > 0 && (
          <details className="group rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/90 dark:bg-amber-950/40">
            <summary className="cursor-pointer list-none p-3.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-amber-900 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span>Explicit Accounting Assumptions (Missing Facts Identified)</span>
              <span className="ml-auto normal-case font-medium text-amber-700 dark:text-amber-300/80 group-open:hidden">Show details</span>
              <span className="ml-auto normal-case font-medium text-amber-700 dark:text-amber-300/80 hidden group-open:inline">Hide details</span>
            </summary>
            <div className="px-3.5 pb-3.5 space-y-2 border-t border-amber-200/70 dark:border-amber-900/40">
              <p className="pt-3 text-[11px] text-amber-800 dark:text-amber-200/90 leading-relaxed">
                The following parameters were assumed because specific transaction facts were omitted. Accounting conclusions depend on verifying these assumptions:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                {assumptions.map((a) => (
                  <div key={a.id} className="p-2.5 rounded-lg bg-white/80 dark:bg-[#1C2538] border border-amber-200/70 dark:border-amber-900/40 text-[11px] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 dark:text-white capitalize">{a.field}</span>
                      <span className={`text-[9px] px-1.5 py-0.2 rounded font-medium border ${a.materiality === 'HIGH'
                        ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300'
                        : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300'}`}>
                        {a.materiality} Materiality
                      </span>
                    </div>
                    <div className="text-slate-700 dark:text-slate-300">
                      <span className="text-slate-500 dark:text-slate-400">Assumed Value: </span>
                      <strong className="font-mono">{String(a.assumedValue)}</strong>
                    </div>
                    <p className="text-slate-500 dark:text-slate-400 text-[10px] leading-tight">{a.basisOrRationale}</p>
                  </div>
                ))}
              </div>
            </div>
          </details>
        )}

        {uncertaintyDisclaimer && (
          <details className="group rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/90 dark:bg-amber-950/40">
            <summary className="cursor-pointer list-none p-3.5 flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>Professional Advisory Caveat</span>
              <span className="ml-auto text-[10px] font-medium text-amber-700 dark:text-amber-300/80 group-open:hidden">Show details</span>
              <span className="ml-auto text-[10px] font-medium text-amber-700 dark:text-amber-300/80 hidden group-open:inline">Hide details</span>
            </summary>
            <p className="px-3.5 pb-3.5 pt-3 border-t border-amber-200/70 dark:border-amber-900/40 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
              {uncertaintyDisclaimer}
            </p>
          </details>
        )}
      </div>
    </div>
  );
};

export default ComplianceRationale;
