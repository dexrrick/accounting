import React, { useEffect, useState } from 'react';
import { Check, ExternalLink, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import {
  defaultLiveRegulatoryFeedService,
  type RegulatoryUpdatePackage
} from '../retrieval/liveRegulatoryFeed';
import {
  clearManualMasDiscoveryPackage,
  discoverManualMasDocuments,
  getManualMasPackageIds,
  getLastManualMasDiscovery,
  MANUAL_MAS_REVIEW_DOCUMENTS,
  type ManualMasDiscoverySnapshot
} from '../retrieval/manualMasDocumentReview';
import { defaultSourceVersioningManager } from '../standards/sourceVersioning';
import { notifySourceRegistryChanged } from '../retrieval/sourceRegistryEvents';

interface ManualMasReviewPanelProps {
  onWorkflowChange?: () => void;
}

const MANUAL_RECORD_IDS = new Set(MANUAL_MAS_REVIEW_DOCUMENTS.map(document => document.recordId));

function isManualMasPackage(pkg: RegulatoryUpdatePackage): boolean {
  return pkg.authority === 'MAS' && pkg.updates.length > 0 &&
    pkg.updates.every(record => MANUAL_RECORD_IDS.has(record.id));
}

function recordMetadata(pkg: RegulatoryUpdatePackage, recordId: string) {
  return pkg.documentMetadata?.[recordId];
}

function formatRetrievedAt(value?: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Unavailable';
  const parts = new Intl.DateTimeFormat('en-SG', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Singapore'
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '';
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}:${part('second')} SGT`;
}

function getPackageOwnedVersion(pkg: RegulatoryUpdatePackage, recordId: string) {
  return defaultSourceVersioningManager.getAllLedgerEntries()
    .filter(entry => entry.recordId === recordId &&
      entry.metadata.documentAdmissionPackageId === pkg.packageId &&
      entry.metadata.documentAdmissionPackageHash?.toLowerCase() === pkg.packageHash.toLowerCase() &&
      entry.metadata.reviewApproval?.packageId === pkg.packageId &&
      entry.metadata.reviewApproval.packageHash.toLowerCase() === pkg.packageHash.toLowerCase())
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt))
    .at(-1);
}

const ReviewPanelCard: React.FC<{
  pkg: RegulatoryUpdatePackage;
  onRefresh: () => void;
  onMessage: (message: string) => void;
  onBusy: (packageId: string | null) => void;
  busy: boolean;
}> = ({ pkg, onRefresh, onMessage, onBusy, busy }) => {
  const feed = defaultLiveRegulatoryFeedService;
  const isStaged = feed.getStagedPackages().some(item => item.packageId === pkg.packageId);
  const isVerified = feed.getVerifiedPackages().some(item => item.packageId === pkg.packageId);
  const approval = feed.getPackageApprovalReceipt(pkg.packageId);
  const [reviewer, setReviewer] = useState('');
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [expandedRecords, setExpandedRecords] = useState<Record<string, boolean>>({});
  const comparisonReceipts = feed.getPackageComparisonReceipt(pkg.packageId);
  const comparisonReceiptIdentity = comparisonReceipts.map(item => `${item.recordId}:${item.profileVersion}:${item.status}:${item.baselineDocumentHash}:${item.verificationDocumentHash || ''}:${item.comparisonHash}:${item.evidenceHash || ''}`).join('|');

  useEffect(() => {
    setReviewer('');
    setReason('');
    setAcknowledged(false);
  }, [pkg.packageId, comparisonReceiptIdentity]);

  const runAction = async (action: () => Promise<void>) => {
    onBusy(pkg.packageId);
    try {
      await action();
    } catch (error) {
      onMessage(`Action failed for ${pkg.packageId}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      onBusy(null);
      onRefresh();
    }
  };

  const handleStage = () => runAction(async () => {
    const result = await feed.stageUpdatePackage(pkg);
    onMessage(result.success
      ? `Staged ${result.stagedRecordsCount} MAS document provision(s). The active registry is unchanged.`
      : `Unable to stage ${pkg.packageId}: ${result.error || 'source gates rejected the package'}`);
  });

  const handleVerify = () => runAction(async () => {
    const result = await feed.retrieveAndVerifyStagedPackage(pkg.packageId);
    onMessage(result.isValid
      ? `Official re-fetch verified ${result.verifiedRecordsCount} MAS provision(s). Human approval is still required.`
      : `Official re-fetch verification failed for ${pkg.packageId}: ${result.rejectionReason || 'source gates rejected the package'}`);
  });

  const handleApprove = () => runAction(async () => {
    const accepted = feed.approveUpdatePackage(pkg.packageId, reviewer, reason);
    onMessage(accepted && feed.getPackageApprovalReceipt(pkg.packageId)
      ? `Approval receipt recorded for the currently verified package hash ${pkg.packageHash}. Activation remains a separate action.`
      : `Approval was not recorded. The verified package hash or candidate gates no longer match.`);
  });

  const handleActivate = () => runAction(async () => {
    if (!feed.getPackageApprovalReceipt(pkg.packageId)) {
      onMessage(`Activation blocked for ${pkg.packageId}: no current approval receipt matches its verified package hash.`);
      return;
    }
    const result = await feed.activateUpdatePackage(pkg.packageId);
    if (result.success) {
      clearManualMasDiscoveryPackage(pkg.packageId);
      notifySourceRegistryChanged();
    }
    onMessage(result.success
      ? `Activated ${result.activatedRecordsCount} explicitly approved MAS provision(s). Active versions are now available to grounded retrieval.`
      : `Unable to activate ${pkg.packageId}: ${result.error || 'source gates rejected the package'}`);
  });

  const handleReject = () => runAction(async () => {
    const rejected = feed.rejectUpdatePackage(pkg.packageId, 'Rejected during manual MAS source review');
    if (rejected) clearManualMasDiscoveryPackage(pkg.packageId);
    onMessage(rejected
      ? `Rejected ${pkg.packageId}. The active registry was not changed.`
      : `Unable to reject ${pkg.packageId}: it is no longer pending in the source service.`);
  });

  return (
    <article className="p-3 bg-workspace-panel border border-workspace-border rounded-lg space-y-3" aria-label={`MAS package ${pkg.packageId}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-xs text-slate-800 dark:text-workspace-text">{pkg.packageId}</p>
          <p className="text-[11px] text-workspace-muted">MAS · {pkg.updates.length} changed provision(s) · package SHA-256 {pkg.packageHash}</p>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${approval ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : isVerified ? 'text-blue-700 bg-blue-50 border-blue-200' : isStaged ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-slate-700 bg-workspace-raised border-workspace-border'}`}>
          {approval ? 'Approved · awaiting activation' : isVerified ? 'Verified · approval required' : isStaged ? 'Staged · re-fetch required' : 'Discovered · review required'}
        </span>
      </header>

      {pkg.updates.map(record => {
        const metadata = recordMetadata(pkg, record.id);
        const expanded = expandedRecords[record.id] !== false;
        return (
          <section key={record.id} className="border border-workspace-border rounded-lg bg-workspace-raised/60 p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h5 className="text-xs font-bold text-slate-800 dark:text-workspace-secondary">{record.documentTitle}</h5>
                <p className="text-[11px] text-workspace-muted">{record.standardOrActCode} · {record.paragraphOrSection}</p>
              </div>
              <button type="button" onClick={() => setExpandedRecords(value => ({ ...value, [record.id]: !expanded }))}
                className="text-[11px] text-workspace-accent-text hover:underline shrink-0" aria-expanded={expanded}>
                {expanded ? 'Hide exact text' : 'Review exact text'}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-slate-600 dark:text-workspace-secondary">
              <p><strong>Official URL:</strong> <a className="text-blue-600 dark:text-blue-300 hover:underline break-all" href={record.officialSourceUrl} target="_blank" rel="noopener noreferrer">{record.officialSourceUrl} <ExternalLink className="inline w-3 h-3" /></a></p>
              <p><strong>Retrieved:</strong> {formatRetrievedAt(record.retrievedAt || metadata?.retrievedAt)}</p>
              <p><strong>Extraction:</strong> {record.extractionStatus || 'unknown'} · {record.isVerbatimText ? 'verbatim text' : 'not marked verbatim'}</p>
              <p><strong>Effective date:</strong> {record.effectiveDate || 'Unknown; no effective date was established by retrieval.'}</p>
              <p className="sm:col-span-2"><strong>Document SHA-256:</strong> <span className="font-mono break-all">{record.documentHash || 'Unavailable'}</span></p>
              <p className="sm:col-span-2"><strong>Provision SHA-256:</strong> <span className="font-mono break-all">{record.provisionHash || 'Unavailable'}</span></p>
              <p className="sm:col-span-2"><strong>Locator:</strong></p>
            </div>
            <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded bg-workspace-panel p-2 text-[10px] text-slate-600 dark:text-workspace-secondary">{JSON.stringify(record.sourceLocator || {}, null, 2)}</pre>
            {expanded && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-workspace-muted mb-1">Exact extracted source text</p>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-workspace-border bg-workspace-panel p-3 text-[11px] leading-relaxed text-slate-700 dark:text-workspace-secondary">{record.sourceText}</pre>
              </div>
            )}
          </section>
        );
      })}

      {comparisonReceipts.map(receipt => (
        <div key={receipt.recordId} className="rounded-lg border border-violet-200 dark:border-violet-900 bg-violet-50/50 dark:bg-violet-950/10 p-2.5 space-y-1 text-[10px] text-slate-700 dark:text-workspace-secondary" aria-label={`MAS comparison receipt ${receipt.recordId}`}>
          <p className="font-semibold">Versioned comparison policy: {receipt.profileVersion}</p>
          <p>This exact MAS licensing HTML profile permits changes only to the generated VIcurrentDateTime value and the two __RequestVerificationToken value attributes. Every other document byte and the exact extracted guidance must match; source dates and locator boundaries must remain unchanged. The original and re-fetch raw document hashes are retained below. Generated values are not displayed.</p>
          <p className="font-mono break-all">Original staged snapshot raw document SHA-256: {receipt.baselineDocumentHash}</p>
          <p className="font-mono break-all">Comparison SHA-256: {receipt.comparisonHash}</p>
          <p>Verification status: {receipt.status === 'VERIFIED' ? `verified · ${formatRetrievedAt(receipt.retrievedAt)}` : 'awaiting official re-fetch verification'}</p>
          {receipt.verificationDocumentHash && <p className="font-mono break-all">Re-fetch raw document SHA-256: {receipt.verificationDocumentHash}</p>}
          {receipt.evidenceHash && <p className="font-mono break-all">Verification receipt SHA-256: {receipt.evidenceHash}</p>}
        </div>
      ))}

      {!isStaged && !isVerified && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleStage} disabled={busy} className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-[11px] font-semibold">Stage exact candidate</button>
        </div>
      )}

      {isStaged && !isVerified && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleVerify} disabled={busy} className="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded text-[11px] font-semibold">Re-fetch and verify official documents</button>
          <button type="button" onClick={handleReject} disabled={busy} className="px-2.5 py-1.5 border border-slate-300 dark:border-workspace-border hover:bg-workspace-hover text-slate-700 dark:text-workspace-secondary rounded text-[11px] font-semibold">Reject candidate</button>
        </div>
      )}

      {isVerified && !approval && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/20 p-3 space-y-2.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-blue-800 dark:text-blue-200"><ShieldCheck className="w-4 h-4" /> Explicit human source approval</div>
          <p className="text-[11px] text-blue-800/90 dark:text-blue-200/90">Review the exact text and official page above. Approval applies only to the verified package hash shown above. This action does not activate the source.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="text-[10px] font-semibold text-slate-700 dark:text-workspace-secondary">Reviewer name
              <input value={reviewer} onChange={event => setReviewer(event.target.value)} autoComplete="name" className="mt-1 w-full rounded border border-workspace-border bg-workspace-panel px-2.5 py-2 text-xs font-normal" />
            </label>
            <label className="text-[10px] font-semibold text-slate-700 dark:text-workspace-secondary">Review reason
              <input value={reason} onChange={event => setReason(event.target.value)} className="mt-1 w-full rounded border border-workspace-border bg-workspace-panel px-2.5 py-2 text-xs font-normal" />
            </label>
          </div>
          <label className="flex items-start gap-2 text-[10px] leading-relaxed text-slate-700 dark:text-workspace-secondary">
            <input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} className="mt-0.5" />
            <span>I reviewed the official source, exact extracted text, bounded locator, unknown effective date and verified comparison receipt above, and approve this current package hash and comparison receipt for activation.</span>
          </label>
          <button type="button" onClick={handleApprove} disabled={busy || !reviewer.trim() || !reason.trim() || !acknowledged}
            className="px-2.5 py-1.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white rounded text-[11px] font-semibold">Record explicit approval</button>
        </div>
      )}

      {approval && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/20 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-200"><Check className="w-4 h-4" /> Current approval receipt</div>
          <p className="text-[10px] text-emerald-800 dark:text-emerald-200">Reviewer: {approval.reviewer} · approved {formatRetrievedAt(approval.approvedAt)}</p>
          <p className="text-[10px] text-emerald-800 dark:text-emerald-200">Reason: {approval.reason}</p>
          <p className="text-[10px] font-mono break-all text-emerald-800 dark:text-emerald-200">Package SHA-256: {approval.packageHash}</p>
          {approval.comparisonEvidenceHash && <p className="text-[10px] font-mono break-all text-emerald-800 dark:text-emerald-200">Approved comparison receipt SHA-256: {approval.comparisonEvidenceHash}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={handleActivate} disabled={busy} className="px-2.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded text-[11px] font-semibold">Activate approved version</button>
            <button type="button" onClick={handleReject} disabled={busy} className="px-2.5 py-1.5 border border-slate-300 dark:border-workspace-border hover:bg-workspace-hover text-slate-700 dark:text-workspace-secondary rounded text-[11px] font-semibold">Reject approval</button>
          </div>
        </div>
      )}
    </article>
  );
};

export const ManualMasReviewPanel: React.FC<ManualMasReviewPanelProps> = ({ onWorkflowChange }) => {
  const [discovery, setDiscovery] = useState<ManualMasDiscoverySnapshot>(() => getLastManualMasDiscovery());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [message, setMessage] = useState('');

  const manualPackages = (packages: RegulatoryUpdatePackage[]) => packages.filter(isManualMasPackage);
  const staged = manualPackages(defaultLiveRegulatoryFeedService.getStagedPackages());
  const verified = manualPackages(defaultLiveRegulatoryFeedService.getVerifiedPackages());
  const active = manualPackages(defaultLiveRegulatoryFeedService.getActivePackages());
  const activePackageIds = new Set(active.map(pkg => pkg.packageId));
  const pendingById = new Map<string, RegulatoryUpdatePackage>();
  for (const pkg of [...staged, ...verified]) {
    if (!activePackageIds.has(pkg.packageId)) pendingById.set(pkg.packageId, pkg);
  }
  const candidate = discovery.package && !pendingById.has(discovery.package.packageId) &&
    !activePackageIds.has(discovery.package.packageId) &&
    !defaultLiveRegulatoryFeedService.getRejectedPackages()[discovery.package.packageId]
    ? discovery.package : null;
  if (candidate) pendingById.set(candidate.packageId, candidate);
  const pending = [...pendingById.values()];

  const refresh = () => {
    setDiscovery(getLastManualMasDiscovery());
    onWorkflowChange?.();
  };

  const handleDiscover = async () => {
    setIsDiscovering(true);
    setMessage('');
    try {
      const next = await discoverManualMasDocuments();
      setDiscovery(next);
      setMessage(next.message || 'Manual MAS document discovery completed.');
    } catch (error) {
      setMessage(`Manual MAS discovery failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsDiscovering(false);
      refresh();
    }
  };

  const handleRollback = async (pkg: RegulatoryUpdatePackage) => {
    setBusyId(pkg.packageId);
    try {
      const result = await defaultLiveRegulatoryFeedService.rollbackUpdatePackage(pkg.packageId);
      if (result.success) {
        clearManualMasDiscoveryPackage(pkg.packageId);
        notifySourceRegistryChanged();
      }
      setMessage(result.success
        ? `Rolled back ${result.rolledBackRecordsCount} record(s) from ${pkg.packageId}; predecessor versions and citation bindings were restored.`
        : `Unable to roll back ${pkg.packageId}: ${result.error || 'rollback gates rejected the request'}`);
    } catch (error) {
      setMessage(`Rollback failed for ${pkg.packageId}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyId(null);
      refresh();
    }
  };

  const rejected = defaultLiveRegulatoryFeedService.getRejectedPackages();
  const knownManualPackageIds = new Set(getManualMasPackageIds());
  const manualRejected = Object.entries(rejected).filter(([packageId]) => knownManualPackageIds.has(packageId));

  return (
    <section className="p-4 bg-workspace-raised dark:bg-workspace-panel rounded-xl border border-workspace-border space-y-3" aria-label="Manual MAS document review">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-bold text-slate-800 dark:text-workspace-secondary">Manual MAS Document Review</h4>
          <p className="mt-0.5 text-[11px] text-workspace-muted">On-demand browser discovery for two bounded official documents. These candidates are not included in scheduled or default feed checks.</p>
          <p className="mt-0.5 text-[10px] text-workspace-muted">Discovery, review, activation and rollback state lasts for this browser session; re-open this panel to recover the current session’s pending and active lists.</p>
        </div>
        <button type="button" onClick={handleDiscover} disabled={isDiscovering || staged.length > 0 || verified.length > 0}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-workspace-accent hover:bg-workspace-accent-hover disabled:opacity-50 text-white rounded-lg text-xs font-semibold">
          <RefreshCw className={`w-3.5 h-3.5 ${isDiscovering ? 'animate-spin' : ''}`} />
          {isDiscovering ? 'Checking official pages…' : 'Discover MAS documents'}
        </button>
      </div>

      {(message || discovery.message) && (
        <div role="status" className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/20 p-2.5 text-[11px] text-blue-800 dark:text-blue-200">
          {message || discovery.message}
        </div>
      )}

      {discovery.status !== 'NOT_CHECKED' && (
        <div className="space-y-2">
          <p className="text-[10px] text-workspace-muted">Last manual discovery: {formatRetrievedAt(discovery.checkedAt)}</p>
          {discovery.documents.map(document => (
            <div key={document.recordId} className="rounded-lg border border-workspace-border bg-workspace-panel p-2.5 text-[10px] text-slate-600 dark:text-workspace-secondary">
              <div className="font-semibold">{document.recordId} · fetch {document.fetchStatus} · extraction {document.extractionStatus || 'not run'}</div>
              <div className="break-all">{document.requestUrl}</div>
              {document.extractionReason && <div className="text-amber-700 dark:text-amber-300">{document.extractionReason}</div>}
              {document.record && <div>Document {document.record.documentHash} · provision {document.record.provisionHash} · effective date {document.record.effectiveDate || 'unknown'}</div>}
            </div>
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <div className="space-y-2" aria-label="Pending manual MAS review packages">
          <h5 className="text-[11px] font-bold uppercase tracking-wide text-workspace-muted">Pending review and activation</h5>
          {pending.map(pkg => (
            <ReviewPanelCard key={pkg.packageId} pkg={pkg} busy={busyId === pkg.packageId}
              onBusy={setBusyId} onMessage={setMessage} onRefresh={refresh} />
          ))}
        </div>
      )}

      {active.length > 0 && (
        <div className="space-y-2" aria-label="Active reviewed MAS packages">
          <h5 className="text-[11px] font-bold uppercase tracking-wide text-workspace-muted">Activated MAS package history</h5>
          {active.map(pkg => {
            const approval = defaultLiveRegulatoryFeedService.getReviewAuditEvents(pkg.packageId)
              .filter(event => event.action === 'APPROVED' && event.packageHash?.toLowerCase() === pkg.packageHash.toLowerCase())
              .at(-1);
            const packageVersions = pkg.updates.map(record => {
              const ownedVersion = getPackageOwnedVersion(pkg, record.id);
              const activeVersionId = defaultSourceVersioningManager.getActiveVersionId(record.id);
              return { record, ownedVersion, activeVersionId,
                isCurrent: Boolean(ownedVersion?.isActive && activeVersionId === ownedVersion.versionId) };
            });
            const ownedVersionCount = packageVersions.filter(item => item.ownedVersion).length;
            const currentVersionCount = packageVersions.filter(item => item.isCurrent).length;
            const packageStatus = ownedVersionCount !== pkg.updates.length
              ? 'Activation receipt unavailable'
              : currentVersionCount === pkg.updates.length
                ? 'Active'
                : currentVersionCount > 0 ? 'Partially superseded' : 'Superseded';
            const canRollback = ownedVersionCount === pkg.updates.length && currentVersionCount === pkg.updates.length;
            const ledgerApproval = packageVersions.find(item => item.ownedVersion)?.ownedVersion?.metadata.reviewApproval;
            const approvalActor = approval?.actor || ledgerApproval?.reviewer;
            const approvalAt = approval?.occurredAt || ledgerApproval?.approvedAt;
            const approvalReason = approval?.reason || ledgerApproval?.reason;
            return (
              <article key={pkg.packageId} aria-label={`Activated manual MAS package ${pkg.packageId}`} className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/10 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-emerald-800 dark:text-emerald-200">{pkg.packageId}</p>
                    <p className="text-[10px] font-mono break-all text-emerald-800 dark:text-emerald-200">Package SHA-256: {pkg.packageHash}</p>
                  </div>
                  <span className="text-[10px] rounded border border-emerald-300 px-2 py-0.5 font-semibold text-emerald-800 dark:text-emerald-200">{packageStatus}</span>
                </div>
                {approvalActor && approvalAt && approvalReason && (
                  <div className="text-[10px] text-slate-700 dark:text-workspace-secondary">
                    <strong>Approval receipt:</strong> {approvalActor} · {formatRetrievedAt(approvalAt)} · {approvalReason}
                    <div className="font-mono break-all">Approved package SHA-256: {approval?.packageHash || ledgerApproval?.packageHash || 'Unavailable in receipt'}</div>
                  </div>
                )}
                {defaultLiveRegulatoryFeedService.getPackageComparisonReceipt(pkg.packageId).map(receipt => (
                  <p key={receipt.recordId} className="text-[10px] font-mono break-all text-emerald-800 dark:text-emerald-200">
                    {receipt.recordId} · {receipt.profileVersion} · approved raw {receipt.baselineDocumentHash} · re-fetch raw {receipt.verificationDocumentHash || 'Unavailable'} · comparison {receipt.comparisonHash} · receipt {receipt.evidenceHash || 'Unavailable'}
                  </p>
                ))}
                <div className="space-y-1">
                  {packageVersions.map(({ record, ownedVersion, activeVersionId, isCurrent }) => {
                    const documentHash = ownedVersion?.metadata.documentHash || ownedVersion?.recordSnapshot.documentHash || 'Unavailable';
                    const provisionHash = ownedVersion?.metadata.provisionHash || ownedVersion?.recordSnapshot.provisionHash || 'Unavailable';
                    return <p key={record.id} className="text-[10px] font-mono break-all text-slate-700 dark:text-workspace-secondary">
                      {record.id} · package version {ownedVersion?.versionId || 'Unavailable'} · document {documentHash} · provision {provisionHash} · {isCurrent ? 'current' : 'not current'}
                      {activeVersionId && !isCurrent ? ` · current pointer ${activeVersionId}` : ''}
                    </p>;
                  })}
                </div>
                <button type="button" onClick={() => void handleRollback(pkg)} disabled={busyId === pkg.packageId || !canRollback}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-rose-300 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50 text-rose-700 dark:text-rose-300 rounded text-[11px] font-semibold">
                  <RotateCcw className="w-3 h-3" /> {canRollback ? 'Roll back to prior versions' : 'Rollback unavailable · package versions are not all current'}
                </button>
              </article>
            );
          })}
        </div>
      )}

      {manualRejected.length > 0 && (
        <div className="space-y-1" aria-label="Rejected manual MAS packages">
          <h5 className="text-[11px] font-bold uppercase tracking-wide text-workspace-muted">Rejected MAS packages</h5>
          {manualRejected.map(([packageId, reason]) => <p key={packageId} className="rounded border border-rose-200 bg-rose-50 p-2 text-[10px] text-rose-800 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-300">{packageId}: {reason}</p>)}
        </div>
      )}
    </section>
  );
};
