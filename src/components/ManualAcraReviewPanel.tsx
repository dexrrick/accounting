import React, { useState } from 'react';
import { CheckCircle2, Download, FileCheck2, ShieldCheck } from 'lucide-react';
import { defaultLiveRegulatoryFeedService } from '../retrieval/liveRegulatoryFeed';
import { notifySourceRegistryChanged } from '../retrieval/sourceRegistryEvents';
import {
  decodeAcraSourceBytes,
  loadAcraSourceReviewBundle,
  type AcraSourceReviewBundle
} from '../retrieval/acraSourceReviewBundle';

interface ManualAcraReviewPanelProps {
  onWorkflowChange: () => void;
}

type WorkflowState = 'EMPTY' | 'LOADED' | 'STAGED' | 'VERIFIED' | 'APPROVED' | 'ACTIVE';

function formatDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : date;
}

function formatCaptureDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return `${new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(date)} SGT`;
}

function packageHashMatches(bundle: AcraSourceReviewBundle): boolean {
  const { package: pkg } = bundle;
  const withoutHash = { ...pkg } as typeof pkg;
  delete (withoutHash as Partial<typeof pkg>).packageHash;
  return defaultLiveRegulatoryFeedService.computePackageHash(withoutHash).toLowerCase() === pkg.packageHash.toLowerCase();
}

export const ManualAcraReviewPanel: React.FC<ManualAcraReviewPanelProps> = ({ onWorkflowChange }) => {
  const [bundle, setBundle] = useState<AcraSourceReviewBundle | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowState>('EMPTY');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [reason, setReason] = useState('');
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);

  const loadBundle = async () => {
    setBusy(true);
    setMessage('');
    try {
      const loaded = await loadAcraSourceReviewBundle();
      if (!packageHashMatches(loaded)) throw new Error('Package SHA-256 does not match the captured package contents.');
      setBundle(loaded);
      setWorkflow('LOADED');
      setMessage('Captured official source bytes loaded and package hash checked. No source state has changed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const stageBundle = async () => {
    if (!bundle || !packageHashMatches(bundle)) {
      setMessage('The package hash is missing or no longer matches. Reload the captured bundle before staging.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const result = await defaultLiveRegulatoryFeedService.stageUpdatePackage(bundle.package);
      if (!result.success) throw new Error(result.error || 'The source package did not pass the staging gate.');
      setWorkflow('STAGED');
      setMessage(`Staged ${result.stagedRecordsCount} captured ACRA record for verification.`);
      onWorkflowChange();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const verifyBundle = async () => {
    if (!bundle) return;
    const captured = bundle.documents[0];
    setBusy(true);
    setMessage('');
    try {
      const contentBytes = decodeAcraSourceBytes(captured.bodyBase64);
      const result = await defaultLiveRegulatoryFeedService.verifyUpdatePackage(bundle.package.packageId, {
        [captured.recordId]: {
          sourceUrl: captured.sourceUrl,
          finalUrl: captured.finalUrl,
          contentType: captured.contentType,
          contentBytes,
          httpStatus: captured.httpStatus,
          retrievedAt: captured.retrievedAt
        }
      });
      if (!result.isValid) throw new Error(result.rejectionReason || 'The captured document did not pass verification.');
      setWorkflow('VERIFIED');
      setMessage(`Verified ${result.verifiedRecordsCount} record by replaying the captured official bytes.`);
      onWorkflowChange();
    } catch (error) {
      setWorkflow('STAGED');
      setMessage(error instanceof Error ? error.message : String(error));
      onWorkflowChange();
    } finally {
      setBusy(false);
    }
  };

  const approveBundle = () => {
    if (!bundle || !reviewAcknowledged || !reviewer.trim() || !reason.trim()) {
      setMessage('Enter a reviewer and reason, then confirm that you reviewed the captured source and scope.');
      return;
    }
    if (!packageHashMatches(bundle)) {
      setWorkflow('LOADED');
      setMessage('The package hash no longer matches. Reload the captured bundle and verify it again.');
      return;
    }
    const approved = defaultLiveRegulatoryFeedService.approveUpdatePackage(bundle.package.packageId, reviewer, reason);
    if (!approved) {
      setMessage('The service did not accept approval. The package may no longer be verified or its contents may have changed.');
      return;
    }
    setWorkflow('APPROVED');
    setMessage(`Approval recorded for package ${bundle.package.packageId}. Activation remains a separate step.`);
    onWorkflowChange();
  };

  const activateBundle = async () => {
    if (!bundle || workflow !== 'APPROVED') return;
    setBusy(true);
    setMessage('');
    try {
      const result = await defaultLiveRegulatoryFeedService.activateUpdatePackage(bundle.package.packageId);
      if (!result.success) throw new Error(result.error || 'Activation failed at the source registry gate.');
      setWorkflow('ACTIVE');
      setMessage(`Activated ${result.activatedRecordsCount} approved ACRA record in this browser session.`);
      notifySourceRegistryChanged();
      onWorkflowChange();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const record = bundle?.package.updates[0];
  const sourceMetadata = record && bundle?.package.documentMetadata?.[record.id];
  const cohort = record?.acraFyeCohortApplicability;
  const canVerify = workflow === 'STAGED';
  const canApprove = workflow === 'VERIFIED';

  return (
    <section className="p-4 bg-workspace-raised dark:bg-workspace-panel rounded-xl border border-workspace-border space-y-3" aria-label="Manual ACRA source review">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-bold text-slate-800 dark:text-workspace-secondary">Manual ACRA Source Review</h4>
          <p className="mt-0.5 text-[11px] text-workspace-muted">Load the captured ACRA 2022 annual-return source on demand. The bundle contains source bytes and an unapproved candidate only.</p>
          <p className="mt-0.5 text-[10px] text-workspace-muted">Staging, verification, approval and activation are separate actions. State lasts for this browser session.</p>
        </div>
        {workflow === 'EMPTY' && <button type="button" onClick={() => void loadBundle()} disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-workspace-accent hover:bg-workspace-accent-hover disabled:opacity-50 text-white rounded-lg text-xs font-semibold">
          <Download className="w-3.5 h-3.5" /> {busy ? 'Loading captured source…' : 'Load captured ACRA source'}
        </button>}
      </div>

      {message && <div role="status" className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/20 p-2.5 text-[11px] text-blue-800 dark:text-blue-200">{message}</div>}

      {bundle && record && sourceMetadata && (
        <div className="space-y-3">
          <div className="rounded-lg border border-workspace-border bg-workspace-panel p-3 space-y-1.5 text-[10px] text-slate-700 dark:text-workspace-secondary">
            <p><strong>Official publication:</strong> <a className="text-blue-700 dark:text-blue-300 underline" href={record.officialSourceUrl} target="_blank" rel="noopener noreferrer">ACRA newsletter, published {formatDate(bundle.package.releaseDate)}</a></p>
            <p><strong>Captured:</strong> {formatCaptureDate(sourceMetadata.retrievedAt)} · HTTP {sourceMetadata.httpStatus} · {sourceMetadata.contentType}</p>
            <p className="break-all"><strong>Package:</strong> {bundle.package.packageId} · SHA-256 {bundle.package.packageHash}</p>
            <p className="break-all"><strong>Record:</strong> {record.id} · document SHA-256 {record.documentHash} · provision SHA-256 {record.provisionHash}</p>
            <p><strong>Source locator:</strong> {record.sourceLocator?.heading || 'section'} · {record.sourceLocator?.sourceType || 'unknown'} · table {record.sourceLocator?.tableStructure || 'unknown'} · HTML offsets {record.sourceLocator?.boundary?.startOffset ?? '—'}–{record.sourceLocator?.boundary?.endOffset ?? '—'}</p>
            {cohort && <div className="pt-1"><strong>Source-stated FYE cohort:</strong> FYE on or after {formatDate(cohort.fyeStartDate)}. This identifies the cohort stated in the quotation; it is not a general effective-date interval.<blockquote className="mt-1 border-l-2 border-workspace-border pl-2 italic">{cohort.sourceQuote}</blockquote></div>}
            <p className="pt-1">Publication date, capture date and the source’s FYE cohort are distinct. Company categories follow the source qualification, and blank table cells remain unknown.</p>
          </div>

          <details open className="rounded-lg border border-workspace-border bg-workspace-panel p-3">
            <summary className="cursor-pointer text-[11px] font-semibold text-slate-800 dark:text-workspace-secondary">Exact extracted source text and full company-category deadline table</summary>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-relaxed text-slate-700 dark:text-workspace-secondary">{record.sourceText}</pre>
          </details>

          <div className="flex flex-wrap items-center gap-2">
            {workflow === 'LOADED' && <button type="button" onClick={() => void stageBundle()} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-[11px] font-semibold"><FileCheck2 className="w-3.5 h-3.5" /> Stage for verification</button>}
            {canVerify && <button type="button" onClick={() => void verifyBundle()} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg text-[11px] font-semibold"><ShieldCheck className="w-3.5 h-3.5" /> Replay captured bytes and verify</button>}
            {workflow === 'ACTIVE' && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="w-4 h-4" /> Active for this browser session</span>}
          </div>

          {canApprove && <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/10 p-3 space-y-2">
            <p className="text-[11px] font-semibold text-amber-900 dark:text-amber-200">Independent reviewer approval</p>
            <label className="block text-[10px] text-slate-700 dark:text-workspace-secondary">Reviewer
              <input value={reviewer} onChange={event => setReviewer(event.target.value)} autoComplete="name" className="mt-1 w-full rounded border border-workspace-border bg-workspace-panel px-2 py-1.5 text-[11px]" />
            </label>
            <label className="block text-[10px] text-slate-700 dark:text-workspace-secondary">Review reason
              <textarea value={reason} onChange={event => setReason(event.target.value)} rows={2} className="mt-1 w-full rounded border border-workspace-border bg-workspace-panel px-2 py-1.5 text-[11px]" />
            </label>
            <label className="flex items-start gap-2 text-[10px] text-slate-700 dark:text-workspace-secondary">
              <input type="checkbox" checked={reviewAcknowledged} onChange={event => setReviewAcknowledged(event.target.checked)} className="mt-0.5" />
              <span>I reviewed the official quotation, table qualifications, cohort wording and captured source provenance for this package.</span>
            </label>
            <button type="button" onClick={approveBundle} disabled={busy || !reviewer.trim() || !reason.trim() || !reviewAcknowledged}
              className="px-3 py-1.5 bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white rounded-lg text-[11px] font-semibold">Approve verified source</button>
          </div>}

          {workflow === 'APPROVED' && <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/10 p-3 space-y-2">
            <p className="text-[11px] text-emerald-900 dark:text-emerald-200">Approval is recorded. Activate only after reviewing the displayed package and evidence hashes.</p>
            <button type="button" onClick={() => void activateBundle()} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-lg text-[11px] font-semibold"><CheckCircle2 className="w-3.5 h-3.5" /> Activate approved source</button>
          </div>}
        </div>
      )}
    </section>
  );
};
