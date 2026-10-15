import type { AuthoritativeSourceRecord, SourceLocator, VerifiedDocumentBinding } from './unifiedSourceModel';
import { UNIFIED_SOURCE_REGISTRY } from './unifiedSourceModel';
import { hasVerifiedSourceUrlProvenance, isApprovedSingaporeSourceUrl } from './approvedSourceRegistry';
import { defaultExternalSourceValidator } from '../retrieval/externalSourceValidator';
import {
  computeProvisionHash,
  SourceVersioningManager,
  defaultSourceVersioningManager
} from './sourceVersioning';
import type { StatutoryAuthority } from '../types/accounting';
import type { QueryDomain } from '../types/accounting';
import { getSingaporeDateString } from '../utils/dateUtils';

export interface SharedDocumentAdmissionOptions {
  targetDate?: string;
  referenceDate?: string;
  expectedAuthority?: StatutoryAuthority;
  expectedDomain?: QueryDomain;
}

export type SharedDocumentAdmissionResult =
  | { required: false; admitted: true }
  | { required: true; admitted: false; reason: string }
  | { required: true; admitted: true; binding: VerifiedDocumentBinding };

const PUBLISHER_HOSTS: Record<string, readonly string[]> = {
  AGC: ['sso.agc.gov.sg'],
  IRAS: ['iras.gov.sg', 'www.iras.gov.sg'],
  ACRA: ['acra.gov.sg', 'www.acra.gov.sg'],
  MOM: ['mom.gov.sg', 'www.mom.gov.sg'],
  CPF: ['cpf.gov.sg', 'www.cpf.gov.sg'],
  MAS: ['mas.gov.sg', 'www.mas.gov.sg'],
  ASK_GOV_SG: ['ask.gov.sg']
};

function normalizeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !isApprovedSingaporeSourceUrl(value)) return undefined;
    return `${url.origin}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}

function hostMatchesPublisher(value: string | undefined, sourceAuthority: string | undefined): boolean {
  if (!value || !sourceAuthority) return false;
  const expectedHosts = PUBLISHER_HOSTS[sourceAuthority];
  if (!expectedHosts) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return expectedHosts.includes(host);
  } catch {
    return false;
  }
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function sameLocator(left: SourceLocator | undefined, right: SourceLocator | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableValue(child)}`).join(',')}}`;
  }
  if (value === undefined) return 'undefined';
  return JSON.stringify(value) ?? 'null';
}

function matchesApprovedActivation(
  record: AuthoritativeSourceRecord,
  snapshot: AuthoritativeSourceRecord,
  metadata: NonNullable<ReturnType<SourceVersioningManager['getLedgerEntry']>>['metadata']
): boolean {
  const approval = metadata.reviewApproval;
  if (!approval) return false;
  const expected = structuredClone(snapshot);
  const approvalDate = getSingaporeDateString(new Date(approval.approvedAt));
  Object.assign(expected, {
    versionId: metadata.versionId,
    version: metadata.documentAdmissionPackageId,
    lifecycleState: 'ACTIVE',
    provenance: 'LIVE_PATCH',
    sourceStatus: 'VERIFIED',
    groundingEligible: true,
    lastVerifiedDate: approvalDate,
    verificationMethod: 'OFFICIAL_STATUTORY_PACKAGE_VERIFICATION',
    urlVerificationStatus: 'VERIFIED',
    urlVerifiedDate: approvalDate,
    urlVerificationMethod: 'OFFICIAL_STATUTORY_PACKAGE_VERIFICATION',
    urlVerificationEvidence: `Document URL and byte-bound package verified before reviewer approval (${metadata.versionId})`
  });
  return stableValue(record) === stableValue(expected);
}

function isExactEligibleRegisteredBaseline(
  record: AuthoritativeSourceRecord,
  manager: SourceVersioningManager,
  activeVersionId: string | undefined,
  activeEntry: ReturnType<SourceVersioningManager['getLedgerEntry']>
): boolean {
  const baseline = UNIFIED_SOURCE_REGISTRY[record.id];
  if (!baseline || stableValue(record) !== stableValue(baseline) ||
      record.documentAdmissionRequired === true || baseline.documentAdmissionRequired === true ||
      baseline.lifecycleState !== 'ACTIVE' || baseline.sourceStatus !== 'VERIFIED' ||
      baseline.groundingEligible === false || baseline.recordRole === 'SOURCE_MAP_POINTER' ||
      !['LOCAL_STATIC', 'LIVE_PATCH'].includes(baseline.provenance)) return false;

  // A registered legacy row remains usable while a different extracted version
  // is staged, and after rollback restores that same row. Never let a registry
  // row mask a managed active pointer or a pending copy of the baseline itself.
  if (activeEntry?.metadata.documentAdmissionRequired === true ||
      (activeVersionId && (!activeEntry || activeEntry.versionId !== baseline.versionId))) return false;
  return !manager.getCandidates().some(candidate => candidate.record.id === record.id &&
    candidate.metadata.documentAdmissionRequired === true &&
    candidate.metadata.versionId === baseline.versionId);
}

function validLocator(record: AuthoritativeSourceRecord): boolean {
  const locator = record.sourceLocator;
  if (!locator || !['HTML', 'PDF', 'TEXT'].includes(locator.sourceType || '') ||
      locator.documentHash?.toLowerCase() !== record.documentHash?.toLowerCase() ||
      locator.tableStructure === 'AMBIGUOUS') return false;
  if (locator.sourceType === 'HTML' && locator.boundary &&
      (locator.boundary.startOffset < 0 || locator.boundary.endOffset <= locator.boundary.startOffset)) return false;
  if (locator.sourceType === 'PDF' && (!Number.isInteger(locator.pageNumber) || !Number.isInteger(locator.pageCount) ||
      (locator.pageNumber || 0) < 1 || (locator.pageNumber || 0) > (locator.pageCount || 0))) return false;
  return Boolean(locator.heading || locator.elementId || locator.sourceNode || locator.canonicalLocator || locator.pageNumber);
}

function isApprovalBound(entry: ReturnType<SourceVersioningManager['getLedgerEntry']>): boolean {
  const metadata = entry?.metadata;
  const approval = metadata?.reviewApproval;
  return Boolean(metadata?.documentAdmissionRequired === true && approval &&
    approval.packageId === metadata.documentAdmissionPackageId &&
    typeof approval.packageHash === 'string' && /^[a-f\d]{64}$/i.test(approval.packageHash) &&
    approval.packageHash.toLowerCase() === metadata.documentAdmissionPackageHash?.toLowerCase() &&
    typeof approval.reviewer === 'string' && approval.reviewer.trim() &&
    typeof approval.reason === 'string' && approval.reason.trim() && isIsoTimestamp(approval.approvedAt));
}

function dateRejection(record: AuthoritativeSourceRecord, targetDate: string | undefined): string | undefined {
  const validFrom = record.validFrom || record.effectiveDate;
  const validTo = record.validTo;
  if (targetDate !== undefined && !isIsoDate(targetDate)) return 'TARGET_DATE_INVALID';
  if ((validFrom !== undefined && !isIsoDate(validFrom)) || (validTo !== undefined && !isIsoDate(validTo)) ||
      (validFrom && validTo && validFrom > validTo) || (validTo && !validFrom)) return 'SOURCE_DATE_BOUNDS_INVALID';

  const capturedDate = record.retrievedAt ? getSingaporeDateString(new Date(record.retrievedAt)) : undefined;
  if (!isIsoDate(capturedDate)) return 'DOCUMENT_CAPTURE_DATE_INVALID';
  const requestedDate = targetDate || getSingaporeDateString();
  if (validFrom && requestedDate < validFrom) return 'SOURCE_NOT_IN_EFFECT_ON_TARGET_DATE';
  if (validTo && requestedDate > validTo) return 'SOURCE_NOT_IN_EFFECT_ON_TARGET_DATE';
  if (!validFrom && requestedDate !== capturedDate) return 'DOCUMENT_WITHOUT_EFFECTIVE_DATE_IS_CAPTURE_DAY_ONLY';
  if (requestedDate > capturedDate && !validFrom) return 'DOCUMENT_FUTURE_SCOPE_UNVERIFIED';
  return undefined;
}

/**
 * Validates extracted documents against the manager's active ledger entry and
 * returns the provenance receipt used by verified quotations and citations.
 * Ordinary curated records stay on their established evidence path.
 */
export function verifySharedDocumentAdmission(
  record: AuthoritativeSourceRecord,
  manager: SourceVersioningManager = defaultSourceVersioningManager,
  options: SharedDocumentAdmissionOptions = {}
): SharedDocumentAdmissionResult {
  const activeVersionId = manager.getActiveVersionId(record.id);
  const activeEntry = activeVersionId ? manager.getLedgerEntry(activeVersionId) : undefined;
  const hasPendingManagedCandidate = manager.getCandidates().some(candidate =>
    candidate.record.id === record.id && candidate.metadata.documentAdmissionRequired === true);
  const hasManagedHistory = manager.getAllLedgerEntries().some(entry =>
    entry.recordId === record.id && entry.metadata.documentAdmissionRequired === true);
  const registeredBaseline = !record.documentAdmissionRequired &&
    isExactEligibleRegisteredBaseline(record, manager, activeVersionId, activeEntry);
  const required = record.documentAdmissionRequired === true || activeEntry?.metadata.documentAdmissionRequired === true ||
    ((hasPendingManagedCandidate || hasManagedHistory) && !registeredBaseline);
  if (!required) return { required: false, admitted: true };

  if (!record.versionId || !activeVersionId || record.versionId !== activeVersionId || !activeEntry ||
      activeEntry.versionId !== activeVersionId || activeEntry.recordId !== record.id || !activeEntry.isActive ||
      activeEntry.metadata.verificationStatus !== 'VERIFIED' ||
      !isApprovalBound(activeEntry) || record.lifecycleState !== 'ACTIVE' || record.provenance !== 'LIVE_PATCH' ||
      record.sourceStatus !== 'VERIFIED' || record.groundingEligible !== true || record.recordRole === 'SOURCE_MAP_POINTER' ||
      record.documentAdmissionRequired !== true || activeEntry.recordSnapshot.documentAdmissionRequired !== true) {
    return { required: true, admitted: false, reason: 'DOCUMENT_VERSION_NOT_EXPLICITLY_APPROVED_AND_ACTIVE' };
  }

  const metadata = activeEntry.metadata;
  const snapshot = activeEntry.recordSnapshot;
  const approvalDate = metadata.reviewApproval?.approvedAt
    ? getSingaporeDateString(new Date(metadata.reviewApproval.approvedAt))
    : undefined;
  if (!matchesApprovedActivation(record, snapshot, metadata) || metadata.versionId !== record.versionId ||
      metadata.verificationMethod !== 'OFFICIAL_STATUTORY_PACKAGE_VERIFICATION' ||
      record.lastVerifiedDate !== approvalDate ||
      record.verificationMethod !== metadata.verificationMethod ||
      record.urlVerificationStatus !== 'VERIFIED' ||
      record.urlVerifiedDate !== approvalDate ||
      record.urlVerificationMethod !== metadata.verificationMethod ||
      record.urlVerificationEvidence !== `Document URL and byte-bound package verified before reviewer approval (${metadata.versionId})` ||
      metadata.documentAdmissionPackageId !== metadata.reviewApproval?.packageId ||
      metadata.documentAdmissionPackageHash !== metadata.reviewApproval?.packageHash ||
      metadata.governingAuthority !== record.authority || metadata.domain !== record.domain ||
      metadata.sourceAuthority !== record.sourceAuthority || metadata.sourceAuthority !== snapshot.sourceAuthority ||
      !/^[a-f\d]{64}$/i.test(record.documentHash || '') ||
      !/^[a-f\d]{64}$/i.test(record.provisionHash || '') ||
      metadata.documentHash?.toLowerCase() !== record.documentHash?.toLowerCase() ||
      metadata.provisionHash?.toLowerCase() !== record.provisionHash?.toLowerCase() ||
      record.provisionHash?.toLowerCase() !== computeProvisionHash(record.standardOrActCode, record.paragraphOrSection, record.sourceText).toLowerCase() ||
      metadata.contentHash?.toLowerCase() !== manager.computeSourceHash(snapshot).toLowerCase() ||
      metadata.contentHash?.toLowerCase() !== manager.computeSourceHash(record).toLowerCase() ||
      metadata.extractionStatus !== 'EXACT' || record.extractionStatus !== 'EXACT' || !record.isVerbatimText ||
      !record.sourceText.trim() || !validLocator(record) || !sameLocator(metadata.sourceLocator, record.sourceLocator) ||
      !isIsoTimestamp(record.retrievedAt) || metadata.retrievedAt !== record.retrievedAt ||
      metadata.canonicalSourceUrl !== record.canonicalSourceUrl) {
    return { required: true, admitted: false, reason: 'DOCUMENT_VERSION_PROVENANCE_OR_CONTENT_MISMATCH' };
  }

  if (options.expectedAuthority && record.authority !== options.expectedAuthority) {
    return { required: true, admitted: false, reason: 'DOCUMENT_GOVERNING_AUTHORITY_MISMATCH' };
  }
  if (options.expectedDomain && options.expectedDomain !== 'GENERAL' && record.domain !== options.expectedDomain) {
    return { required: true, admitted: false, reason: 'DOCUMENT_DOMAIN_MISMATCH' };
  }

  const officialUrl = normalizeUrl(record.officialSourceUrl);
  const canonicalUrl = normalizeUrl(record.canonicalSourceUrl);
  const retrievalUrl = normalizeUrl(metadata.sourceUrl);
  const urlsPassTransportAllowlist = [record.officialSourceUrl, record.canonicalSourceUrl, metadata.sourceUrl]
    .every(value => Boolean(value && defaultExternalSourceValidator.validateUrlSecurity(value).isValid));
  const canonicalPublisherPasses = record.sourceAuthority && record.sourceAuthority !== 'ASK_GOV_SG' &&
    record.sourceAuthority !== 'REFERENCE_API'
    ? defaultExternalSourceValidator.validateCanonicalUrl(record.officialSourceUrl, record.sourceAuthority).isValid
    : true;
  if (!officialUrl || officialUrl !== canonicalUrl || !retrievalUrl || !urlsPassTransportAllowlist || !canonicalPublisherPasses ||
      !hostMatchesPublisher(record.officialSourceUrl, record.sourceAuthority) ||
      !hostMatchesPublisher(metadata.sourceUrl, record.sourceAuthority) ||
      !hasVerifiedSourceUrlProvenance(record) || record.urlVerificationStatus !== 'VERIFIED') {
    return { required: true, admitted: false, reason: 'DOCUMENT_OFFICIAL_PUBLISHER_PROVENANCE_INVALID' };
  }

  const requestedDate = options.targetDate || options.referenceDate || getSingaporeDateString();
  const dateError = dateRejection(record, requestedDate);
  if (dateError) return { required: true, admitted: false, reason: dateError };

  if (options.referenceDate && isIsoDate(options.referenceDate) && options.targetDate && options.targetDate > options.referenceDate) {
    const supportedFutureStart = record.validFrom || record.effectiveDate;
    if (!supportedFutureStart || options.targetDate < supportedFutureStart) {
      return { required: true, admitted: false, reason: 'DOCUMENT_FUTURE_SCOPE_UNSUPPORTED' };
    }
  }

  return {
    required: true,
    admitted: true,
    binding: {
      recordId: record.id,
      versionId: activeVersionId,
      documentHash: record.documentHash!,
      provisionHash: record.provisionHash!,
      sourceLocator: structuredClone(record.sourceLocator!)
    }
  };
}

export function sameVerifiedDocumentBinding(
  left: VerifiedDocumentBinding | undefined,
  right: VerifiedDocumentBinding | undefined
): boolean {
  return Boolean(left && right && left.recordId === right.recordId && left.versionId === right.versionId &&
    left.documentHash === right.documentHash && left.provisionHash === right.provisionHash &&
    sameLocator(left.sourceLocator, right.sourceLocator));
}
