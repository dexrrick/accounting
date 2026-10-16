import React, { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, ShieldCheck } from 'lucide-react';
import type { AuthorityEvidencePresentation, AuthorityPresentedClaim, AuthorityPresentedWorkstream } from '../utils/authorityEvidencePresentation';
import { defaultSourceRetriever } from '../retrieval/sourceRetriever';
import { sameVerifiedDocumentBinding, verifySharedDocumentAdmission } from '../standards/sharedDocumentAdmission';
import { SOURCE_REGISTRY_CHANGE_EVENT } from '../retrieval/sourceRegistryEvents';
import { formatSingaporeDate } from '../utils/dateUtils';

interface AuthorityCompliancePanelProps {
  presentation: AuthorityEvidencePresentation;
}

function statusLabel(status: AuthorityEvidencePresentation['status']): string {
  if (status === 'VERIFIED') return 'All requested evidence verified';
  if (status === 'CONDITIONAL') return 'Evidence verified; application unresolved';
  return 'Evidence incomplete';
}

function statusStyle(status: AuthorityEvidencePresentation['status']): string {
  if (status === 'VERIFIED') return 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800';
  if (status === 'CONDITIONAL') return 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800';
  return 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800';
}

function workstreamStatus(stream: AuthorityPresentedWorkstream, staleBinding: boolean): string {
  if (staleBinding || stream.evidenceStatus === 'INSUFFICIENT') return 'Evidence incomplete';
  return stream.applicationStatus === 'UNRESOLVED' ? 'Application unresolved' : 'Evidence verified';
}

function bindingStatus(claim: AuthorityPresentedClaim): { current: boolean; status: string } | undefined {
  const binding = claim.sourceBinding;
  if (!binding) return undefined;
  const source = defaultSourceRetriever.getSourceById(binding.recordId);
  if (!source) return { current: false, status: 'SOURCE_NOT_FOUND' };
  const admission = verifySharedDocumentAdmission(source);
  if (!admission.required) return { current: false, status: 'ADMISSION_NOT_REQUIRED' };
  if (!admission.admitted) return { current: false, status: admission.reason };
  const matches = sameVerifiedDocumentBinding(binding, admission.binding);
  return {
    current: matches,
    status: matches ? 'CURRENT_VERSION_MATCH' : 'VERSION_BINDING_MISMATCH'
  };
}

export const AuthorityCompliancePanel: React.FC<AuthorityCompliancePanelProps> = ({ presentation }) => {
  const [, setRegistryRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRegistryRevision(revision => revision + 1);
    window.addEventListener(SOURCE_REGISTRY_CHANGE_EVENT, refresh);
    return () => window.removeEventListener(SOURCE_REGISTRY_CHANGE_EVENT, refresh);
  }, []);

  const renderedStreams = presentation.workstreams.map(stream => {
    const claimStatuses = new Map(stream.sources.flatMap(source => source.claims)
      .flatMap(claim => {
        const status = bindingStatus(claim);
        return status ? [[claim, status] as const] : [];
      }));
    const hasStaleBinding = [...claimStatuses.values()].some(status => !status.current);
    return { stream, claimStatuses, hasStaleBinding };
  });
  const hasInvalidatedBinding = renderedStreams.some(item => item.hasStaleBinding);
  const displayedStatus = hasInvalidatedBinding ? 'INSUFFICIENT' : presentation.status;

  return (
  <section className="bg-white dark:bg-[#1C2538] rounded-2xl border border-slate-200 dark:border-[#2B374E] shadow-xl overflow-hidden flex flex-col">
    <header className="p-4 bg-slate-50/80 dark:bg-[#151D2C] text-slate-900 dark:text-white flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-[#2B374E]">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-ynab-navy dark:bg-[#242F46] flex items-center justify-center text-white border border-slate-700/20 dark:border-[#2B374E]">
          <ShieldCheck className="w-4 h-4 text-ynab-blue dark:text-blue-400" />
        </div>
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">Statutory Compliance &amp; Legal Authority</h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Whole-question evidence is grouped by governing authority, topic, and the party in scope.</p>
        </div>
      </div>
      <span className={`inline-flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-md font-semibold border ${statusStyle(displayedStatus)}`}>
        {(displayedStatus === 'INSUFFICIENT' || hasInvalidatedBinding) && <AlertTriangle className="w-3 h-3" />}
        {hasInvalidatedBinding ? 'Source version changed; review required' : statusLabel(displayedStatus)}
      </span>
    </header>

    <div className="p-4 sm:p-5 space-y-4">
      {renderedStreams.map(({ stream, claimStatuses, hasStaleBinding }) => (
        <article key={stream.id} className="rounded-xl border border-slate-200 dark:border-[#2B374E] overflow-hidden">
          <div className="px-4 py-3 bg-slate-50/70 dark:bg-[#151D2C] flex flex-wrap items-start justify-between gap-2 border-b border-slate-200 dark:border-[#2B374E]">
            <div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">{stream.domainLabel}</h4>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">Governing authority: {stream.authorityLabel}</p>
            </div>
            <span className={`text-[10px] font-semibold px-2 py-1 rounded border ${statusStyle(hasStaleBinding || stream.evidenceStatus === 'INSUFFICIENT' ? 'INSUFFICIENT' : stream.applicationStatus === 'UNRESOLVED' ? 'CONDITIONAL' : 'VERIFIED')}`}>
              {hasStaleBinding ? 'Source version changed' : workstreamStatus(stream, false)}
            </span>
          </div>

          <div className="p-4 space-y-4">
            <div className="space-y-2">
              <h5 className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400">Material issues</h5>
              {stream.issues.map(issue => (
                <div key={issue.id} className="rounded-lg bg-slate-50 dark:bg-[#111827] border border-slate-200 dark:border-[#2B374E] p-3">
                  {(() => {
                    const issueHasStaleBinding = issue.claims.some(claim => {
                      const status = claimStatuses.get(claim) || bindingStatus(claim);
                      return status ? !status.current : false;
                    });
                    const issueInsufficient = issueHasStaleBinding || issue.evidenceStatus === 'INSUFFICIENT';
                    return (
                      <>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-slate-900 dark:text-white">{issue.subject}</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">Party in scope: {issue.population}</p>
                    </div>
                    <span className={`text-[9px] px-2 py-0.5 rounded border font-semibold ${statusStyle(issueInsufficient ? 'INSUFFICIENT' : issue.applicationStatus === 'UNRESOLVED' ? 'CONDITIONAL' : 'VERIFIED')}`}>
                      {issueHasStaleBinding ? 'Source version changed' : issue.evidenceStatus === 'INSUFFICIENT' ? 'Evidence gap' : issue.applicationStatus === 'UNRESOLVED' ? 'Facts / application unresolved' : 'Covered'}
                    </span>
                  </div>
                  {issue.applicationReason && <p className="text-xs text-amber-800 dark:text-amber-300 mt-2">{issue.applicationReason}</p>}
                  {issue.gaps.length > 0 && <ul className="text-xs text-rose-800 dark:text-rose-300 mt-2 list-disc pl-4 space-y-1">{issue.gaps.map((gap, index) => <li key={`${issue.id}-gap-${index}`}>{gap}</li>)}</ul>}
                      </>
                    );
                  })()}
                </div>
              ))}
            </div>

            {stream.sources.length > 0 && (
              <div className="space-y-2">
                <h5 className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400">{hasStaleBinding ? 'Supporting sources · historical version requires review' : 'Verified supporting sources'}</h5>
                {stream.sources.map(source => (
                  <section key={source.key} className="rounded-lg border border-slate-200 dark:border-[#2B374E] overflow-hidden">
                    <div className="px-3 py-2 flex flex-wrap items-start justify-between gap-2 bg-white dark:bg-[#1C2538]">
                      <div>
                        <p className="text-xs font-semibold text-slate-900 dark:text-white">{source.title}</p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{source.publisher}</p>
                        <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                          {source.provenance.replaceAll('_', ' ').toLowerCase()}
                          {(source.validFrom || source.validTo) && ` · ${source.validFrom ? `from ${formatSingaporeDate(source.validFrom)}` : ''}${source.validTo ? ` through ${formatSingaporeDate(source.validTo)}` : ''}`}
                        </p>
                      </div>
                      {source.officialUrl && (
                        <a href={source.officialUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-semibold text-ynab-blue dark:text-blue-400 hover:underline">
                          Official source <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    <div className="border-t border-slate-200 dark:border-[#2B374E] divide-y divide-slate-200 dark:divide-[#2B374E]">
                      {source.claims.map((claim, index) => {
                        const issueNames = claim.issueIds.map(id => stream.issues.find(issue => issue.id === id)?.subject || id);
                        const claimBindingStatus = claimStatuses.get(claim);
                        return (
                          <div key={`${source.key}-${index}`} className="p-3 space-y-2">
                            <span className="inline-flex text-[9px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                              {claimBindingStatus && !claimBindingStatus.current
                                ? 'Historical official source excerpt · no longer current'
                                : claim.sourceBinding
                                  ? (claim.supportKind === 'EXACT_SOURCE_QUOTE' ? 'Current verified official source excerpt' : 'Current reviewed summary')
                                  : claim.supportKind === 'EXACT_SOURCE_QUOTE' ? 'Verified official source excerpt' : 'Reviewed local summary'}
                            </span>
                            <p className="text-[11px] leading-relaxed text-slate-700 dark:text-slate-200">{claim.text}</p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">Supports: {issueNames.join('; ')}</p>
                            {(claim.validFrom || claim.validTo) && <p className="text-[9px] text-slate-400 dark:text-slate-500">Evidence period: {claim.validFrom ? `from ${formatSingaporeDate(claim.validFrom)}` : ''}{claim.validTo ? ` through ${formatSingaporeDate(claim.validTo)}` : ''}</p>}
                            {claim.sourceBinding && claimBindingStatus && (
                              <details className="rounded border border-slate-200 dark:border-[#2B374E] p-2">
                                <summary className="cursor-pointer text-[9px] font-semibold text-slate-600 dark:text-slate-300">
                                  {claimBindingStatus.current ? 'Current document version binding' : 'Historical document binding · no longer current'} · {claimBindingStatus.status}
                                </summary>
                                <div className="mt-2 space-y-1 text-[9px] text-slate-500 dark:text-slate-400">
                                  <p>Record: <span className="font-mono">{claim.sourceBinding.recordId}</span></p>
                                  <p>Bound version: <span className="font-mono break-all">{claim.sourceBinding.versionId}</span></p>
                                  <p>Document SHA-256: <span className="font-mono break-all">{claim.sourceBinding.documentHash}</span></p>
                                  <p>Provision SHA-256: <span className="font-mono break-all">{claim.sourceBinding.provisionHash}</span></p>
                                  <p>Bound locator:</p>
                                  <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 dark:bg-[#111827] p-2 text-[9px]">{JSON.stringify(claim.sourceBinding.sourceLocator, null, 2)}</pre>
                                  {!claimBindingStatus.current && <p>This answer preserves the version used at answer time; it is not evidence that this version remains active.</p>}
                                </div>
                              </details>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}

            {stream.gaps.length > 0 && (
              <div className="rounded-lg border border-rose-200 dark:border-rose-900/70 bg-rose-50/70 dark:bg-rose-950/30 p-3">
                <h5 className="text-[10px] uppercase tracking-wider font-bold text-rose-800 dark:text-rose-300">Open evidence gaps</h5>
                <ul className="text-xs text-rose-800 dark:text-rose-300 mt-2 list-disc pl-4 space-y-1">{stream.gaps.map((gap, index) => <li key={`${stream.id}-gap-${index}`}>{gap}</li>)}</ul>
              </div>
            )}
          </div>
        </article>
      ))}

      {presentation.workstreams.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-300">No material workstreams were resolved from this question.</p>}
      {presentation.gaps.length > 0 && <div className="rounded-lg border border-rose-200 dark:border-rose-900/70 bg-rose-50/70 dark:bg-rose-950/30 p-3"><h4 className="text-[10px] uppercase tracking-wider font-bold text-rose-800 dark:text-rose-300">Whole-question gaps</h4><ul className="text-xs text-rose-800 dark:text-rose-300 mt-2 list-disc pl-4 space-y-1">{presentation.gaps.map((gap, index) => <li key={`whole-gap-${index}`}>{gap}</li>)}</ul></div>}
    </div>
  </section>
  );
};
