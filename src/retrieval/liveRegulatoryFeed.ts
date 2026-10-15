import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import type { StatutoryAuthority } from '../types/accounting';
import { UNIFIED_SOURCE_REGISTRY } from '../standards/unifiedSourceModel';
import {
  defaultSourceVersioningManager,
  SourceVersioningManager,
  computeSha256,
  computeSha256Bytes,
  computeProvisionHash,
  type SourceVersionMetadata,
  type VersionChange
} from '../standards/sourceVersioning';
import { defaultExternalSourceValidator, ExternalSourceValidator } from './externalSourceValidator';
import { defaultControlledWebRetriever, ControlledWebRetriever } from './controlledWebRetriever';
import {
  type IOfficialSourceAdapter,
  SSOUpdateAdapter,
  IRASUpdateAdapter,
  ACRAUpdateAdapter,
  MOMUpdateAdapter,
  CPFUpdateAdapter,
  FrankfurterReferenceAdapter
} from './sourceAdapters';
import { computeMasRegulatoryPackageHash, type MasDocumentRetrievalMetadata } from './masDocumentUpdateAdapter';
import type { OfficialDocumentExtractionRequest } from './officialDocumentExtractor';
import { extractOfficialDocumentFromRetrieved } from './officialDocumentExtractor';
import type { ControlledFetchResult } from './controlledWebRetriever';
import { getSingaporeDateString } from '../utils/dateUtils';

export interface AmendmentSummary {
  recordId: string;
  title: string;
  changeType: VersionChange;
  summary: string;
}

export interface RegulatoryUpdatePackage {
  packageId: string;
  releaseDate: string;
  authority: 'AGC' | 'IRAS' | 'ACRA' | 'MOM' | 'CPF' | 'MAS' | 'REFERENCE_API';
  updates: AuthoritativeSourceRecord[];
  amendments: AmendmentSummary[];
  packageHash: string; // SHA-256 of package contents
  /** MAS-only bindings needed to replay extraction from raw document bytes. */
  extractionRequests?: Record<string, OfficialDocumentExtractionRequest>;
  documentMetadata?: Record<string, MasDocumentRetrievalMetadata>;
}

export interface RetrievedOfficialDocument {
  sourceUrl: string;
  finalUrl: string;
  contentType: string;
  contentBytes: Uint8Array;
  httpStatus: number;
  etag?: string;
  lastModified?: string;
  retrievedAt?: string;
}

export type PackageVerificationDocuments = string | Record<string, string | Uint8Array | RetrievedOfficialDocument>;

export type LiveSyncState =
  | 'SYNCED'
  | 'UPDATE_AVAILABLE'
  | 'VERIFICATION_REQUIRED'
  | 'OFFLINE'
  | 'FETCH_FAILED';

export interface UpdateCheckResult {
  hasUpdates: boolean;
  packages: RegulatoryUpdatePackage[];
  syncState: LiveSyncState;
  checkedAt: string;
  error?: string;
}

export interface UpdateCheckOptions {
  authorities?: StatutoryAuthority[];
}

export interface StageResult {
  success: boolean;
  packageId: string;
  stagedRecordsCount: number;
  error?: string;
}

export interface PackageVerificationResult {
  isValid: boolean;
  packageId: string;
  verifiedRecordsCount: number;
  failedRecordId?: string;
  rejectionReason?: string;
}

export interface PackageActivationResult {
  success: boolean;
  packageId: string;
  activatedRecordsCount: number;
  error?: string;
}

export interface PackageRollbackResult {
  success: boolean;
  packageId: string;
  rolledBackRecordsCount: number;
  error?: string;
}

export interface RegulatoryReviewAuditEvent {
  packageId: string;
  action: 'STAGED' | 'VERIFIED' | 'APPROVED' | 'REJECTED' | 'ACTIVATED' | 'ROLLED_BACK' | 'REVIEW_RECORDED';
  occurredAt: string;
  actor: string;
  reason?: string;
}

/**
 * Official government and regulatory endpoints registry.
 */
export const OFFICIAL_SOURCE_ENDPOINTS = {
  AGC_SSO: 'https://sso.agc.gov.sg',
  IRAS: 'https://www.iras.gov.sg',
  ACRA: 'https://www.acra.gov.sg',
  MOM: 'https://www.mom.gov.sg',
  CPF: 'https://www.cpf.gov.sg',
  ECB_FRANKFURTER: 'https://api.frankfurter.dev'
} as const;

function packageClone(pkg: RegulatoryUpdatePackage): RegulatoryUpdatePackage {
  return structuredClone(pkg);
}

function recordClone(record: AuthoritativeSourceRecord): AuthoritativeSourceRecord {
  return structuredClone(record);
}

function packageSnapshot(pkg: RegulatoryUpdatePackage): RegulatoryUpdatePackage {
  const snapshot = packageClone(pkg);
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  };
  freeze(snapshot);
  return snapshot;
}

function isRetrievedOfficialDocument(value: unknown): value is RetrievedOfficialDocument {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as RetrievedOfficialDocument;
  return typeof candidate.sourceUrl === 'string' && typeof candidate.finalUrl === 'string' &&
    typeof candidate.contentType === 'string' && candidate.contentBytes instanceof Uint8Array &&
    typeof candidate.httpStatus === 'number';
}

function normalizedUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch { return undefined; }
}

function isMasHost(value: string): boolean {
  try { return /(^|\.)mas\.gov\.sg$/i.test(new URL(value).hostname); }
  catch { return false; }
}

function containsMasAuthorityIdentity(pkg: RegulatoryUpdatePackage): boolean {
  return pkg.updates.some(record => record.authority === 'MAS' || record.sourceAuthority === 'MAS' || isMasHost(record.officialSourceUrl));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Live Regulatory Feed & Update Service.
 * Implements the rigorous multi-stage trust lifecycle:
 * CHECK -> FETCH -> STAGE -> VALIDATE -> HASH -> COMPARE -> VERIFY -> APPROVE -> ACTIVATE
 * with atomic transactions (all-or-nothing activation) and rollback support.
 */
export class LiveRegulatoryFeedService {
  private versioningManager: SourceVersioningManager;
  private validator: ExternalSourceValidator;

  // Staged packages awaiting verification: packageId -> RegulatoryUpdatePackage
  private stagedPackages: Map<string, RegulatoryUpdatePackage> = new Map();
  // Verified packages approved for activation: packageId -> RegulatoryUpdatePackage
  private verifiedPackages: Map<string, RegulatoryUpdatePackage> = new Map();
  // Active activated packages: packageId -> RegulatoryUpdatePackage
  private activePackages: Map<string, RegulatoryUpdatePackage> = new Map();
  // Rejected packages: packageId -> reason
  private rejectedPackages: Map<string, string> = new Map();
  private packageApprovals: Map<string, { packageHash: string; reviewer: string; reason: string; approvedAt: string }> = new Map();
  private packageVersionIds: Map<string, Map<string, string>> = new Map();
  private packageCandidateSnapshots = new Map<string, Map<string, { record: AuthoritativeSourceRecord; metadata: SourceVersionMetadata }>>();
  private packageRegistrySnapshots: Map<string, Record<string, AuthoritativeSourceRecord | null>> = new Map();
  private packageGenerations = new Map<string, number>();
  private reviewAuditEvents: RegulatoryReviewAuditEvent[] = [];

  // Mock / remote feed queue for update simulation
  private availableFeeds: RegulatoryUpdatePackage[] = [];

  // Official source update discovery adapters
  private adapters: IOfficialSourceAdapter[];
  private webRetriever: ControlledWebRetriever;

  private lastCheckDate: string = '2026-09-11T00:00:00Z';
  private lastVerificationDate: string = '2026-09-11T00:00:00Z';
  private syncState: LiveSyncState = 'SYNCED';

  private bumpPackageGeneration(packageId: string): number {
    const generation = (this.packageGenerations.get(packageId) || 0) + 1;
    this.packageGenerations.set(packageId, generation);
    return generation;
  }

  private packageOperationIsCurrent(
    packageId: string,
    pkg: RegulatoryUpdatePackage,
    generation: number,
    versionIds: Map<string, string>
  ): boolean {
    if (this.packageGenerations.get(packageId) !== generation || this.stagedPackages.get(packageId) !== pkg) return false;
    const currentVersionIds = this.packageVersionIds.get(packageId);
    if (!currentVersionIds || currentVersionIds.size !== versionIds.size) return false;
    return [...versionIds].every(([recordId, versionId]) => currentVersionIds.get(recordId) === versionId);
  }

  private staleVerificationResult(packageId: string): PackageVerificationResult {
    return {
      isValid: false,
      packageId,
      verifiedRecordsCount: 0,
      rejectionReason: 'Stale verification was discarded because the staged package changed'
    };
  }

  private masCandidatesMatchStageSnapshot(packageId: string, pkg: RegulatoryUpdatePackage, requireVerified = false): boolean {
    const snapshots = this.packageCandidateSnapshots.get(packageId);
    const versionIds = this.packageVersionIds.get(packageId);
    if (!snapshots || !versionIds || snapshots.size !== pkg.updates.length || versionIds.size !== pkg.updates.length) return false;
    for (const record of pkg.updates) {
      const versionId = versionIds.get(record.id);
      const snapshot = versionId ? snapshots.get(versionId) : undefined;
      const candidate = versionId && this.versioningManager.getCandidates().find(item => item.metadata.versionId === versionId);
      if (!versionId || !snapshot || !candidate || stableJson(candidate.record) !== stableJson(snapshot.record)) return false;

      const actualMetadata = structuredClone(candidate.metadata);
      const expectedMetadata = structuredClone(snapshot.metadata);
      if (actualMetadata.verificationStatus === 'VERIFIED' &&
          actualMetadata.verificationMethod === 'OFFICIAL_STATUTORY_PACKAGE_VERIFICATION') {
        if (requireVerified === false && expectedMetadata.verificationStatus !== 'UNVERIFIED') return false;
        actualMetadata.verificationStatus = expectedMetadata.verificationStatus;
        delete actualMetadata.verificationMethod;
      } else if (requireVerified || actualMetadata.verificationStatus !== expectedMetadata.verificationStatus || actualMetadata.verificationMethod) {
        return false;
      }
      if (stableJson(actualMetadata) !== stableJson(expectedMetadata)) return false;
    }
    return true;
  }

  constructor(
    versioningManager: SourceVersioningManager = defaultSourceVersioningManager,
    validator: ExternalSourceValidator = defaultExternalSourceValidator,
    webRetriever: ControlledWebRetriever = defaultControlledWebRetriever,
    adapters: IOfficialSourceAdapter[] = [
      new SSOUpdateAdapter(),
      new IRASUpdateAdapter(),
      new ACRAUpdateAdapter(),
      new MOMUpdateAdapter(),
      new CPFUpdateAdapter(),
      new FrankfurterReferenceAdapter()
    ]
  ) {
    this.versioningManager = versioningManager;
    this.validator = validator;
    this.webRetriever = webRetriever;
    this.adapters = [...adapters];
  }

  public registerAdapter(adapter: IOfficialSourceAdapter): void {
    this.adapters.push(adapter);
  }

  private recordAuditEvent(packageId: string, action: RegulatoryReviewAuditEvent['action'], actor: string, reason?: string): void {
    this.reviewAuditEvents.push({ packageId, action, actor, reason, occurredAt: new Date().toISOString() });
  }

  /** Records an accountable human review decision without changing package state. */
  public recordReviewDecision(packageId: string, reviewer: string, reason: string): boolean {
    const exists = this.stagedPackages.has(packageId) || this.verifiedPackages.has(packageId) || this.activePackages.has(packageId);
    if (!exists || !reviewer.trim() || !reason.trim()) return false;
    this.recordAuditEvent(packageId, 'REVIEW_RECORDED', reviewer.trim(), reason.trim());
    return true;
  }

  public getAdapters(): IOfficialSourceAdapter[] {
    return [...this.adapters];
  }

  private validateMasPackageShape(pkg: RegulatoryUpdatePackage): string | undefined {
    const requests = pkg.extractionRequests;
    const metadata = pkg.documentMetadata;
    if (!requests || !metadata || pkg.authority !== 'MAS' || pkg.releaseDate !== 'undated' && !/^\d{4}-\d{2}-\d{2}$/.test(pkg.releaseDate)) {
      return 'MAS package is missing its extraction requests, retrieval metadata, or a supported release date';
    }
    const recordIds = new Set(pkg.updates.map(record => record.id));
    if (recordIds.size !== pkg.updates.length || Object.keys(requests).length !== recordIds.size || Object.keys(metadata).length !== recordIds.size ||
        [...recordIds].some(id => !requests[id] || !metadata[id])) {
      return 'MAS package requires exactly one request and provenance entry per stable record id';
    }
    for (const record of pkg.updates) {
      const registryRecord = UNIFIED_SOURCE_REGISTRY[record.id];
      const request = requests[record.id];
      const source = metadata[record.id];
      if (registryRecord && (registryRecord.authority !== 'MAS' || registryRecord.sourceAuthority && registryRecord.sourceAuthority !== 'MAS')) {
        return `MAS record id '${record.id}' collides with an active record owned by another authority`;
      }
      if (!request || !source || request.authority !== record.authority || request.authority !== 'MAS' || request.domain !== 'MAS_FUNDS' ||
          request.domain !== record.domain || normalizedUrl(request.url) !== normalizedUrl(source.requestUrl) ||
          normalizedUrl(source.sourceUrl) !== normalizedUrl(request.url) || normalizedUrl(source.finalUrl) !== normalizedUrl(record.officialSourceUrl) ||
          source.httpStatus < 200 || source.httpStatus >= 300 || !source.contentType ||
          !source.retrievedAt || !Number.isFinite(Date.parse(source.retrievedAt)) || source.retrievedAt !== record.retrievedAt ||
          record.sourceAuthority !== 'MAS' || !record.sourcePublisher || record.provenance !== 'LIVE_EXTERNAL' ||
          record.extractionStatus !== 'EXACT' || record.isVerbatimText !== true || record.groundingEligible !== false ||
          !record.documentHash || !/^[a-f0-9]{64}$/i.test(record.documentHash) ||
          !record.provisionHash || !/^[a-f0-9]{64}$/i.test(record.provisionHash) ||
          record.contentHash !== record.provisionHash ||
          record.provisionHash !== computeProvisionHash(record.standardOrActCode, record.paragraphOrSection, record.sourceText) ||
          !record.sourceLocator || record.sourceLocator.documentHash !== record.documentHash ||
          !record.sourceLocator.sourceType || !['HTML', 'PDF'].includes(record.sourceLocator.sourceType) ||
          record.sourceLocator.mediaType !== source.contentType || record.sourceLocator.tableStructure === 'AMBIGUOUS' ||
          (record.sourceLocator.sourceType === 'HTML' && (!record.sourceLocator.boundary ||
            record.sourceLocator.boundary.startOffset < 0 || record.sourceLocator.boundary.endOffset <= record.sourceLocator.boundary.startOffset)) ||
          (record.sourceLocator.sourceType === 'PDF' && (!record.sourceLocator.pageNumber || !record.sourceLocator.pageCount ||
            record.sourceLocator.pageNumber < 1 || record.sourceLocator.pageNumber > record.sourceLocator.pageCount))) {
        return `MAS record '${record.id}' is incomplete, ambiguous, or inconsistent with its bound extraction request and provenance`;
      }
    }
    const expectedHash = this.computePackageHash({
      packageId: pkg.packageId,
      releaseDate: pkg.releaseDate,
      authority: pkg.authority,
      updates: pkg.updates,
      amendments: pkg.amendments,
      extractionRequests: requests,
      documentMetadata: metadata
    });
    if (!pkg.packageHash || pkg.packageHash.toLowerCase() !== expectedHash.toLowerCase()) return 'MAS package content hash mismatch';
    return undefined;
  }

  private rejectPackageVerification(packageId: string, reason: string, failedRecordId?: string): PackageVerificationResult {
    this.bumpPackageGeneration(packageId);
    this.rejectedPackages.set(packageId, reason);
    this.verifiedPackages.delete(packageId);
    this.packageApprovals.delete(packageId);
    const pkg = this.stagedPackages.get(packageId);
    if (pkg?.authority === 'MAS') {
      const ids = this.packageVersionIds.get(packageId);
      for (const versionId of ids?.values() || []) {
        const candidate = this.versioningManager.getCandidates().find(item => item.metadata.versionId === versionId);
        if (candidate) candidate.metadata.verificationStatus = 'REJECTED';
      }
    }
    this.recordAuditEvent(packageId, 'REJECTED', 'system', reason);
    return { isValid: false, packageId, verifiedRecordsCount: 0, failedRecordId, rejectionReason: reason };
  }

  private masRecordMatchesExtraction(candidate: AuthoritativeSourceRecord, extracted: AuthoritativeSourceRecord): boolean {
    const left = structuredClone(candidate) as AuthoritativeSourceRecord & { retrievedAt?: string };
    const right = structuredClone(extracted) as AuthoritativeSourceRecord & { retrievedAt?: string };
    delete left.retrievedAt;
    delete right.retrievedAt;
    return stableJson(left) === stableJson(right);
  }

  /**
   * Computes deterministic SHA-256 package hash over all constituent records
   */
  public computePackageHash(pkg: Omit<RegulatoryUpdatePackage, 'packageHash'>): string {
    if (pkg.authority === 'MAS') return computeMasRegulatoryPackageHash(pkg);
    const payload = [
      pkg.packageId,
      pkg.releaseDate,
      pkg.authority,
      ...pkg.updates.map((u) => `${u.id}:${u.standardOrActCode}:${u.paragraphOrSection}:${u.sourceText}`)
    ].join('|||');

    return computeSha256(payload);
  }

  /**
   * Registers a mock update package to be discovered during check
   */
  public enqueueRemoteFeedPackage(pkg: RegulatoryUpdatePackage): void {
    this.availableFeeds.push(packageSnapshot(pkg));
    this.syncState = 'UPDATE_AVAILABLE';
  }

  /**
   * Checks for available regulatory update packages using registered official source adapters.
   */
  public async checkForUpdates(customRetriever?: ControlledWebRetriever, options: UpdateCheckOptions = {}): Promise<UpdateCheckResult> {
    const checkedAt = new Date().toISOString();
    this.lastCheckDate = checkedAt;

    if (this.syncState === 'OFFLINE') {
      return {
        hasUpdates: false,
        packages: [],
        syncState: 'OFFLINE',
        checkedAt,
        error: 'Offline mode active: external feed check unavailable'
      };
    }

    const discoveredPackages: RegulatoryUpdatePackage[] = [...this.availableFeeds];
    const activeRetriever = customRetriever || this.webRetriever;
    const currentSources = Object.values(UNIFIED_SOURCE_REGISTRY);

    // Execute registered source adapters
    for (const adapter of this.adapters) {
      if (options.authorities && !options.authorities.includes(adapter.authority)) continue;
      try {
        const pkg = await adapter.checkForUpdates(activeRetriever, currentSources);
        if (pkg && !discoveredPackages.some((p) => p.packageId === pkg.packageId)) {
          discoveredPackages.push(pkg);
        }
      } catch {
        // Individual adapter failure never contaminates or throws
      }
    }

    if (discoveredPackages.length > 0) {
      this.syncState = 'UPDATE_AVAILABLE';
      return {
        hasUpdates: true,
        packages: discoveredPackages,
        syncState: 'UPDATE_AVAILABLE',
        checkedAt
      };
    }

    this.syncState = 'SYNCED';
    return {
      hasUpdates: false,
      packages: [],
      syncState: 'SYNCED',
      checkedAt
    };
  }

  /**
   * Stages a regulatory update package into the candidate holding area.
   * Staging does NOT mutate the active registry or active retrieval.
   * Preserves full external provenance (sourceUrl, httpStatus, etag, lastModified).
   */
  public async stageUpdatePackage(
    pkg: RegulatoryUpdatePackage,
    provenanceDetails?: { sourceUrl?: string; httpStatus?: number; etag?: string; lastModified?: string }
  ): Promise<StageResult> {
    if (!pkg.packageId || !pkg.updates || pkg.updates.length === 0) {
      return { success: false, packageId: pkg.packageId, stagedRecordsCount: 0, error: 'Empty or invalid package' };
    }

    if (this.activePackages.get(pkg.packageId)?.authority === 'MAS') {
      return { success: false, packageId: pkg.packageId, stagedRecordsCount: 0, error: 'An active MAS package ID cannot be staged again' };
    }
    const stagedPackage = packageClone(pkg);
    if (stagedPackage.authority !== 'MAS' && containsMasAuthorityIdentity(stagedPackage)) {
      return { success: false, packageId: stagedPackage.packageId, stagedRecordsCount: 0, error: 'Non-MAS packages cannot contain MAS-governed records or MAS-published source URLs' };
    }
    this.bumpPackageGeneration(stagedPackage.packageId);
    if (stagedPackage.authority === 'MAS') {
      this.packageApprovals.delete(stagedPackage.packageId);
      this.verifiedPackages.delete(stagedPackage.packageId);
      this.stagedPackages.delete(stagedPackage.packageId);
      const previousVersionIds = this.packageVersionIds.get(stagedPackage.packageId);
      for (const versionId of previousVersionIds?.values() || []) {
        const candidate = this.versioningManager.getCandidates().find(item => item.metadata.versionId === versionId);
        if (candidate) candidate.metadata.verificationStatus = 'REJECTED';
      }
      this.packageVersionIds.delete(stagedPackage.packageId);
      this.packageCandidateSnapshots.delete(stagedPackage.packageId);
      const masValidationError = this.validateMasPackageShape(stagedPackage);
      if (masValidationError) {
        this.rejectedPackages.set(stagedPackage.packageId, masValidationError);
        this.recordAuditEvent(stagedPackage.packageId, 'REJECTED', 'system', masValidationError);
        return { success: false, packageId: stagedPackage.packageId, stagedRecordsCount: 0, error: masValidationError };
      }
    }
    const versionIds = new Map<string, string>();
    const candidateSnapshots = new Map<string, { record: AuthoritativeSourceRecord; metadata: SourceVersionMetadata }>();

    // Register each update as an UNVERIFIED candidate in the versioning manager
    for (const rec of stagedPackage.updates) {
      const baseVersionId = `${stagedPackage.packageId}-${rec.id}`;
      let versionId = baseVersionId;
      if (stagedPackage.authority === 'MAS') {
        const ledgerIds = new Set(this.versioningManager.getAllLedgerEntries().map(entry => entry.versionId));
        const candidateIds = new Set(this.versioningManager.getCandidates().map(entry => entry.metadata.versionId));
        let suffix = 2;
        while (ledgerIds.has(versionId) || candidateIds.has(versionId)) versionId = `${baseVersionId}-activation-${suffix++}`;
      }
      versionIds.set(rec.id, versionId);
      const contentHash = stagedPackage.authority === 'MAS'
        ? (rec.provisionHash || rec.contentHash || this.versioningManager.computeSourceHash(rec))
        : (rec.contentHash || this.versioningManager.computeSourceHash(rec));
      rec.contentHash = contentHash;
      const masRetrieval = stagedPackage.authority === 'MAS'
        ? stagedPackage.documentMetadata?.[rec.id]
        : undefined;

      const metadata: SourceVersionMetadata = {
        versionId,
        contentHash,
        effectiveDate: rec.validFrom || rec.effectiveDate,
        validFrom: rec.validFrom,
        validTo: rec.validTo,
        publishedDate: stagedPackage.releaseDate === 'undated' ? undefined : stagedPackage.releaseDate,
        canonicalSourceUrl: rec.officialSourceUrl,
        sourceAuthority: rec.sourceAuthority || stagedPackage.authority,
        verificationStatus: 'UNVERIFIED',
        retrievedAt: stagedPackage.authority === 'MAS'
          ? masRetrieval!.retrievedAt
          : rec.retrievedAt || new Date().toISOString(),
        amendmentSummary: stagedPackage.amendments.find((a) => a.recordId === rec.id)?.summary,
        // Preserve external provenance
        sourceUrl: stagedPackage.authority === 'MAS'
          ? masRetrieval!.sourceUrl
          : provenanceDetails?.sourceUrl || rec.officialSourceUrl,
        httpStatus: stagedPackage.authority === 'MAS'
          ? masRetrieval!.httpStatus
          : provenanceDetails?.httpStatus || 200,
        etag: stagedPackage.authority === 'MAS' ? masRetrieval!.etag : provenanceDetails?.etag,
        lastModified: stagedPackage.authority === 'MAS' ? masRetrieval!.lastModified : provenanceDetails?.lastModified,
        documentHash: rec.documentHash,
        provisionHash: rec.provisionHash || rec.contentHash,
        extractionStatus: rec.extractionStatus,
        sourceLocator: rec.sourceLocator
      };

      const requiresDocumentAdmission = stagedPackage.authority === 'MAS' && Boolean(stagedPackage.extractionRequests?.[rec.id]);
      const candidateRecord = requiresDocumentAdmission ? { ...rec, documentAdmissionRequired: true as const } : rec;
      if (requiresDocumentAdmission) {
        Object.assign(metadata, {
          documentAdmissionRequired: true as const,
          documentAdmissionPackageId: stagedPackage.packageId,
          documentAdmissionPackageHash: stagedPackage.packageHash,
          governingAuthority: rec.authority,
          domain: rec.domain
        });
      }

      this.versioningManager.registerCandidateVersion(candidateRecord, metadata);
      if (stagedPackage.authority === 'MAS') {
        const candidate = this.versioningManager.getCandidates().find(item => item.metadata.versionId === versionId);
        if (!candidate) return { success: false, packageId: stagedPackage.packageId, stagedRecordsCount: 0, error: `MAS candidate '${versionId}' was not registered` };
        candidateSnapshots.set(versionId, {
          record: recordClone(candidate.record),
          metadata: structuredClone(candidate.metadata)
        });
      }
    }

    this.packageVersionIds.set(stagedPackage.packageId, versionIds);
    if (stagedPackage.authority === 'MAS') this.packageCandidateSnapshots.set(stagedPackage.packageId, candidateSnapshots);
    else this.packageCandidateSnapshots.delete(stagedPackage.packageId);
    const immutablePackage = packageSnapshot(stagedPackage);
    this.stagedPackages.set(immutablePackage.packageId, immutablePackage);
    this.syncState = 'VERIFICATION_REQUIRED';
    this.recordAuditEvent(immutablePackage.packageId, 'STAGED', 'system', 'Package isolated pending verification');

    return {
      success: true,
      packageId: immutablePackage.packageId,
      stagedRecordsCount: immutablePackage.updates.length
    };
  }

  /**
   * Verifies an entire update package.
   * Security invariant: rawDocuments is mandatory. A candidate record must never reach VERIFIED
   * without proving that candidate sourceText matches content reconstructed from raw document boundary.
   * Atomic rule: If even 1 record fails validation, structural check, or raw boundary verification, the entire package is REJECTED.
   * rawDocuments can be passed as a record-specific mapping (Record<string, string> keyed by recordId)
   * or a single string (if all records in the package share the identical document).
   */
  public async verifyUpdatePackage(
    packageId: string,
    rawDocuments: PackageVerificationDocuments
  ): Promise<PackageVerificationResult> {
    const generation = this.bumpPackageGeneration(packageId);
    const pkg = this.stagedPackages.get(packageId);
    if (!pkg) {
      return {
        isValid: false,
        packageId,
        verifiedRecordsCount: 0,
        rejectionReason: `Staged package '${packageId}' not found`
      };
    }
    const versionIds = new Map(this.packageVersionIds.get(packageId) || []);
    const isCurrent = (): boolean => this.packageOperationIsCurrent(packageId, pkg, generation, versionIds);
    const reject = (reason: string, failedRecordId?: string): PackageVerificationResult =>
      isCurrent() ? this.rejectPackageVerification(packageId, reason, failedRecordId) : this.staleVerificationResult(packageId);
    this.packageApprovals.delete(packageId);
    this.verifiedPackages.delete(packageId);

    if (pkg.authority === 'MAS') {
      if (!this.masCandidatesMatchStageSnapshot(packageId, pkg)) {
        return reject('MAS candidate records or metadata differ from the package-bound stage snapshot');
      }
      for (const versionId of versionIds.values()) {
        const candidate = this.versioningManager.getCandidates().find(item => item.metadata.versionId === versionId);
        if (candidate) {
          candidate.metadata.verificationStatus = 'UNVERIFIED';
          delete candidate.metadata.verificationMethod;
        }
      }
      const masValidationError = this.validateMasPackageShape(pkg);
      if (masValidationError) return reject(masValidationError);
    } else if (containsMasAuthorityIdentity(pkg)) {
      return reject('Non-MAS packages cannot contain MAS-governed records or MAS-published source URLs');
    }

    if (!rawDocuments || (typeof rawDocuments !== 'string' && typeof rawDocuments !== 'object')) {
      return reject('Raw document is strictly required to verify update package and validate source boundary');
    }
    if (typeof rawDocuments === 'string' && rawDocuments.trim().length === 0) {
      return reject('Raw document is strictly required to verify update package and validate source boundary');
    }

    // 1. Verify package hash integrity
    const expectedPackageHash = this.computePackageHash({
      packageId: pkg.packageId,
      releaseDate: pkg.releaseDate,
      authority: pkg.authority,
      updates: pkg.updates,
      amendments: pkg.amendments,
      ...(pkg.extractionRequests ? { extractionRequests: pkg.extractionRequests } : {}),
      ...(pkg.documentMetadata ? { documentMetadata: pkg.documentMetadata } : {})
    });

    if ((pkg.authority === 'MAS' || pkg.packageHash) && pkg.packageHash?.toLowerCase() !== expectedPackageHash.toLowerCase()) {
      const result = reject('Package content hash mismatch');
      this.syncState = 'FETCH_FAILED';
      return { ...result, rejectionReason: `Package hash mismatch: expected '${expectedPackageHash}', received '${pkg.packageHash || 'missing'}'` };
    }

    // 2. Validate every record atomically
    for (let i = 0; i < pkg.updates.length; i++) {
      const rec = pkg.updates[i];
      let rawDoc: string | undefined;
      let masDocument: RetrievedOfficialDocument | undefined;
      if (pkg.authority === 'MAS') {
        const supplied = typeof rawDocuments === 'string' ? undefined : rawDocuments[rec.id];
        const request = pkg.extractionRequests?.[rec.id];
        const metadata = pkg.documentMetadata?.[rec.id];
        if (!isRetrievedOfficialDocument(supplied) || !request || !metadata) {
          return reject(`Atomic validation failure on record '${rec.id}': Raw MAS document bytes and bound request provenance are required`, rec.id);
        }
        masDocument = supplied;
        const actualDocumentHash = computeSha256Bytes(masDocument.contentBytes);
        if (actualDocumentHash.toLowerCase() !== (rec.documentHash || '').toLowerCase() ||
            normalizedUrl(masDocument.sourceUrl) !== normalizedUrl(request.url) ||
            normalizedUrl(masDocument.finalUrl) !== normalizedUrl(metadata.finalUrl) ||
            normalizedUrl(masDocument.finalUrl) !== normalizedUrl(rec.officialSourceUrl) ||
            masDocument.contentType !== metadata.contentType || masDocument.httpStatus !== metadata.httpStatus) {
          return reject(`Atomic validation failure on record '${rec.id}': Raw bytes, URL, MIME type, status, or document hash differs from the staged provenance`, rec.id);
        }
        const replay: ControlledFetchResult = {
          status: 'SUCCESS',
          sourceUrl: masDocument.sourceUrl,
          finalUrl: masDocument.finalUrl,
          contentBytes: new Uint8Array(masDocument.contentBytes),
          contentType: masDocument.contentType,
          httpStatus: masDocument.httpStatus,
          retrievedAt: masDocument.retrievedAt || rec.retrievedAt || new Date().toISOString(),
          etag: masDocument.etag,
          lastModified: masDocument.lastModified
        };
        const extracted = await extractOfficialDocumentFromRetrieved(request, replay);
        if (!isCurrent()) return this.staleVerificationResult(packageId);
        if (extracted.status !== 'SUCCESS') {
          return reject(`Atomic validation failure on record '${rec.id}': Shared extraction replay rejected the document (${extracted.code}: ${extracted.reason})`, rec.id);
        }
        const replayedRecord = { ...extracted.record, id: rec.id };
        if (!this.masRecordMatchesExtraction(rec, replayedRecord)) {
          return reject(`Atomic validation failure on record '${rec.id}': Re-extracted body, authority, date, hash, or locator differs from the staged record`, rec.id);
        }
        if (rec.sourceLocator?.sourceType === 'HTML' || rec.sourceLocator?.sourceType === 'TEXT') {
          try { rawDoc = new TextDecoder('utf-8', { fatal: true }).decode(masDocument.contentBytes); }
          catch { return reject(`Atomic validation failure on record '${rec.id}': HTML bytes are not valid UTF-8`, rec.id); }
        }
      } else {
        const supplied = typeof rawDocuments === 'string' ? rawDocuments : rawDocuments[rec.id];
        if (typeof supplied !== 'string' || supplied.trim().length === 0) {
          return reject(`Atomic validation failure on record '${rec.id}': Missing record-specific raw document`, rec.id);
        }
        rawDoc = supplied;
        if (rec.documentHash) {
          const actualDocHash = computeSha256(rawDoc);
          if (actualDocHash.toLowerCase() !== rec.documentHash.toLowerCase()) {
            return reject(`Atomic validation failure on record '${rec.id}': Document hash mismatch (expected '${rec.documentHash}', received '${actualDocHash}')`, rec.id);
          }
        }
      }

      // Structure check
      const structCheck = this.validator.validateDocumentStructure(rec);
      if (!structCheck.isValid) {
        return reject(`Atomic validation failure on record '${rec.id}': ${structCheck.reason}`, rec.id);
      }

      // URL and domain security check
      const urlCheck = this.validator.validateUrlSecurity(rec.officialSourceUrl);
      if (!urlCheck.isValid) {
        return reject(`Atomic validation failure on record '${rec.id}': ${urlCheck.reason}`, rec.id);
      }

      // Canonical authority URL check
      const authCheck = this.validator.validateCanonicalUrl(rec.officialSourceUrl, rec.sourceAuthority || pkg.authority);
      if (!authCheck.isValid) {
        return reject(`Atomic validation failure on record '${rec.id}': ${authCheck.reason}`, rec.id);
      }

      // Provenance check
      const provCheck = this.validator.validateProvenance(rec, rec.officialSourceUrl);
      if (!provCheck.isValid) {
        return reject(`Atomic validation failure on record '${rec.id}': ${provCheck.reason}`, rec.id);
      }

      // Source boundary verification (ties candidate sourceText back to raw document offsets)
      if (rawDoc) {
        const boundaryCheck = this.validator.validateSourceBoundary(rec, rawDoc);
        if (!boundaryCheck.isValid) {
          return reject(`Atomic validation failure on record '${rec.id}': ${boundaryCheck.reason}`, rec.id);
        }
      }

      // Provision mapping & anti-truncation check
      const mappingCheck = this.validator.validateProvisionMapping(rec);
      if (!mappingCheck.isValid) {
        return reject(`Atomic validation failure on record '${rec.id}': ${mappingCheck.reason}`, rec.id);
      }
    }

    // All records passed verification! Promote candidate statuses to VERIFIED
    if (!isCurrent()) return this.staleVerificationResult(packageId);
    if (pkg.authority === 'MAS' && !this.masCandidatesMatchStageSnapshot(packageId, pkg)) {
      return reject('MAS candidate records or metadata changed during verification');
    }
    for (const rec of pkg.updates) {
      const versionId = versionIds.get(rec.id) || `${pkg.packageId}-${rec.id}`;
      const candidateEntry = this.versioningManager.getCandidates().find((c) => c.metadata.versionId === versionId);
      if (candidateEntry) {
        candidateEntry.metadata.verificationStatus = 'VERIFIED';
        candidateEntry.metadata.verificationMethod = 'OFFICIAL_STATUTORY_PACKAGE_VERIFICATION';
        candidateEntry.metadata.documentHash = rec.documentHash;
        candidateEntry.metadata.provisionHash = rec.provisionHash;
        candidateEntry.metadata.extractionStatus = rec.extractionStatus;
        candidateEntry.metadata.sourceLocator = rec.sourceLocator;
      }
    }

    this.verifiedPackages.set(packageId, pkg);
    this.lastVerificationDate = new Date().toISOString();
    this.recordAuditEvent(packageId, 'VERIFIED', 'system', 'All records passed atomic source, provenance, and boundary checks');

    return {
      isValid: true,
      packageId,
      verifiedRecordsCount: pkg.updates.length
    };
  }

  /**
   * Re-fetches each staged record from its allowlisted official URL and verifies
   * the raw documents before they can be activated.  Keeping this here (rather
   * than in the UI) ensures every caller gets the same provenance safeguards.
   */
  public async retrieveAndVerifyStagedPackage(packageId: string): Promise<PackageVerificationResult> {
    const pkg = this.stagedPackages.get(packageId);
    if (!pkg) {
      return {
        isValid: false,
        packageId,
        verifiedRecordsCount: 0,
        rejectionReason: `Staged package '${packageId}' not found`
      };
    }

    const generation = this.bumpPackageGeneration(packageId);
    const versionIds = new Map(this.packageVersionIds.get(packageId) || []);
    const isCurrent = (): boolean => this.packageOperationIsCurrent(packageId, pkg, generation, versionIds);
    const reject = (reason: string, failedRecordId?: string): PackageVerificationResult =>
      isCurrent() ? this.rejectPackageVerification(packageId, reason, failedRecordId) : this.staleVerificationResult(packageId);
    this.packageApprovals.delete(packageId);
    this.verifiedPackages.delete(packageId);

    if (pkg.authority === 'MAS') {
      if (!this.masCandidatesMatchStageSnapshot(packageId, pkg)) {
        return reject('MAS candidate records or metadata differ from the package-bound stage snapshot');
      }
      const masValidationError = this.validateMasPackageShape(pkg);
      if (masValidationError) return reject(masValidationError);
    } else if (containsMasAuthorityIdentity(pkg)) {
      return reject('Non-MAS packages cannot contain MAS-governed records or MAS-published source URLs');
    }

    const rawDocuments: Record<string, string | RetrievedOfficialDocument> = {};
    for (const rec of pkg.updates) {
      if (pkg.authority === 'MAS') {
        const request = pkg.extractionRequests?.[rec.id];
        if (!request) return reject(`Missing extraction request for MAS record '${rec.id}'`, rec.id);
        const result = await this.webRetriever.fetchOfficialDocument(request.url, {
          timeoutMs: 5000,
          maxResponseBytes: request.maxResponseBytes,
          expectedHash: rec.documentHash
        });
        if (!isCurrent()) return this.staleVerificationResult(packageId);
        if (result.status !== 'SUCCESS' || !result.contentBytes || !result.contentType || !result.finalUrl || !result.httpStatus) {
          return reject(`Could not retrieve an unchanged official MAS document for '${rec.id}': ${result.error || result.status}`, rec.id);
        }
        rawDocuments[rec.id] = {
          sourceUrl: result.sourceUrl,
          finalUrl: result.finalUrl,
          contentType: result.contentType,
          contentBytes: new Uint8Array(result.contentBytes),
          httpStatus: result.httpStatus,
          etag: result.etag,
          lastModified: result.lastModified,
          retrievedAt: result.retrievedAt
        };
        continue;
      }
      const result = await this.webRetriever.fetchOfficialSource(rec.officialSourceUrl, {
        timeoutMs: 5000,
        useCache: false,
        expectedHash: rec.documentHash
      });
      if (!isCurrent()) return this.staleVerificationResult(packageId);
      if (result.status !== 'SUCCESS' || !result.content) {
        return {
          isValid: false,
          packageId,
          verifiedRecordsCount: 0,
          failedRecordId: rec.id,
          rejectionReason: `Could not retrieve an unchanged official document for '${rec.id}': ${result.error || result.status}`
        };
      }
      rawDocuments[rec.id] = result.content;
    }

    if (!isCurrent()) return this.staleVerificationResult(packageId);
    return this.verifyUpdatePackage(packageId, rawDocuments);
  }

  /** Rejects a candidate without changing the active registry. */
  public rejectUpdatePackage(packageId: string, reason = 'Rejected during human review'): boolean {
    const exists = this.stagedPackages.has(packageId) || this.availableFeeds.some((pkg) => pkg.packageId === packageId);
    if (!exists) return false;
    this.bumpPackageGeneration(packageId);
    this.stagedPackages.delete(packageId);
    this.verifiedPackages.delete(packageId);
    this.packageApprovals.delete(packageId);
    for (const versionId of this.packageVersionIds.get(packageId)?.values() || []) {
      const candidate = this.versioningManager.getCandidates().find(item => item.metadata.versionId === versionId);
      if (candidate) candidate.metadata.verificationStatus = 'REJECTED';
    }
    this.availableFeeds = this.availableFeeds.filter((pkg) => pkg.packageId !== packageId);
    this.rejectedPackages.set(packageId, reason);
    this.recordAuditEvent(packageId, 'REJECTED', 'reviewer', reason);
    this.syncState = this.availableFeeds.length > 0 ? 'UPDATE_AVAILABLE' : 'SYNCED';
    return true;
  }

  /** Explicit human approval required before any MAS candidate can be activated. */
  public approveUpdatePackage(packageId: string, reviewer: string, reason: string): boolean {
    const pkg = this.verifiedPackages.get(packageId);
    if (!pkg || pkg.authority !== 'MAS' || !reviewer.trim() || !reason.trim()) return false;
    const packageWithoutHash = { ...pkg } as RegulatoryUpdatePackage;
    delete (packageWithoutHash as Partial<RegulatoryUpdatePackage>).packageHash;
    const currentHash = this.computePackageHash(packageWithoutHash);
    if (currentHash.toLowerCase() !== pkg.packageHash.toLowerCase()) {
      this.packageApprovals.delete(packageId);
      this.verifiedPackages.delete(packageId);
      return false;
    }
    this.packageApprovals.set(packageId, {
      packageHash: currentHash,
      reviewer: reviewer.trim(),
      reason: reason.trim(),
      approvedAt: new Date().toISOString()
    });
    this.recordAuditEvent(packageId, 'APPROVED', reviewer.trim(), reason.trim());
    return true;
  }

  /**
   * Activates a verified update package into the active UNIFIED_SOURCE_REGISTRY.
   * ACID Transaction Guarantee: All updates are activated atomically.
   * If any record activation fails in the ledger, all previously activated records
   * in this transaction are automatically rolled back, and the active registry is restored
   * to its exact pre-activation snapshot.
   */
  public async activateUpdatePackage(packageId: string): Promise<PackageActivationResult> {
    const pkg = this.verifiedPackages.get(packageId);
    if (!pkg) {
      return {
        success: false,
        packageId,
        activatedRecordsCount: 0,
        error: `Package '${packageId}' must be verified before activation`
      };
    }

    if (pkg.authority === 'MAS') {
      const masValidationError = this.validateMasPackageShape(pkg);
      if (masValidationError || !this.masCandidatesMatchStageSnapshot(packageId, pkg, true)) {
        return {
          success: false,
          packageId,
          activatedRecordsCount: 0,
          error: masValidationError || 'MAS candidate records or metadata differ from the package-bound stage snapshot'
        };
      }
    } else if (containsMasAuthorityIdentity(pkg)) {
      return {
        success: false,
        packageId,
        activatedRecordsCount: 0,
        error: 'Non-MAS packages cannot contain MAS-governed records or MAS-published source URLs'
      };
    }

    const masApproval = pkg.authority === 'MAS' ? this.packageApprovals.get(packageId) : undefined;
    if (pkg.authority === 'MAS') {
      const packageWithoutHash = { ...pkg } as RegulatoryUpdatePackage;
      delete (packageWithoutHash as Partial<RegulatoryUpdatePackage>).packageHash;
      const currentHash = this.computePackageHash(packageWithoutHash);
      if (!masApproval || masApproval.packageHash !== currentHash || pkg.packageHash !== currentHash) {
        return {
          success: false,
          packageId,
          activatedRecordsCount: 0,
          error: 'MAS package requires current explicit reviewer approval after verification'
        };
      }
    }

    // Phase 1: Snapshot registry state for all affected record IDs
    const registrySnapshot: Record<string, AuthoritativeSourceRecord> = {};
    const packageRegistrySnapshot: Record<string, AuthoritativeSourceRecord | null> = {};
    const approvedCandidateRecords = new Map<string, AuthoritativeSourceRecord>();
    for (const rec of pkg.updates) {
      if (pkg.authority === 'MAS') {
        const versionId = this.packageVersionIds.get(pkg.packageId)?.get(rec.id);
        const candidate = versionId && this.versioningManager.getCandidates().find(item => item.metadata.versionId === versionId);
        if (candidate) approvedCandidateRecords.set(rec.id, recordClone(candidate.record));
      }
      if (UNIFIED_SOURCE_REGISTRY[rec.id]) {
        registrySnapshot[rec.id] = recordClone(UNIFIED_SOURCE_REGISTRY[rec.id]);
        packageRegistrySnapshot[rec.id] = recordClone(UNIFIED_SOURCE_REGISTRY[rec.id]);
      } else {
        packageRegistrySnapshot[rec.id] = null;
      }
    }

    // Phase 2: Transactional activation
    const activatedVersionIds: string[] = [];
    let activationError: string | null = null;

    for (const rec of pkg.updates) {
      const versionId = this.packageVersionIds.get(pkg.packageId)?.get(rec.id) || `${pkg.packageId}-${rec.id}`;
      if (pkg.authority === 'MAS' && (!masApproval || !this.versioningManager.recordDocumentReviewApproval(versionId, {
        packageId: pkg.packageId,
        packageHash: masApproval.packageHash,
        reviewer: masApproval.reviewer,
        reason: masApproval.reason,
        approvedAt: masApproval.approvedAt
      }))) {
        activationError = `Failed to bind explicit document review approval to record '${rec.id}'`;
        break;
      }
      const actResult = this.versioningManager.activateVersion(versionId);
      if (!actResult.success) {
        activationError = `Failed to activate record '${rec.id}': ${actResult.error}`;
        break;
      }

      activatedVersionIds.push(versionId);

      // Update the active in-memory registry: preserve sourceType and evidenceTier intact
      const activeRecord: AuthoritativeSourceRecord = {
        ...(pkg.authority === 'MAS' ? approvedCandidateRecords.get(rec.id)! : rec),
        versionId,
        version: pkg.packageId,
        provenance: 'LIVE_PATCH',
        sourceStatus: 'VERIFIED',
        sourceType: rec.sourceType,
        evidenceTier: rec.evidenceTier,
        ...(pkg.authority === 'MAS' ? {
          lifecycleState: 'ACTIVE' as const,
          documentAdmissionRequired: true as const,
          groundingEligible: true,
          lastVerifiedDate: masApproval ? getSingaporeDateString(new Date(masApproval.approvedAt)) : undefined,
          verificationMethod: 'OFFICIAL_STATUTORY_PACKAGE_VERIFICATION',
          urlVerificationStatus: 'VERIFIED' as const,
          urlVerifiedDate: masApproval ? getSingaporeDateString(new Date(masApproval.approvedAt)) : undefined,
          urlVerificationMethod: 'OFFICIAL_STATUTORY_PACKAGE_VERIFICATION',
          urlVerificationEvidence: `Document URL and byte-bound package verified before reviewer approval (${versionId})`
        } : {})
      };

      UNIFIED_SOURCE_REGISTRY[rec.id] = activeRecord;
    }

    // Phase 3: Rollback on any failure
    if (activationError) {
      // Roll back all ledger activations in this transaction
      for (const vId of activatedVersionIds.reverse()) {
        this.versioningManager.rollbackVersion(vId);
      }

      // Restore active registry to pristine snapshot
      for (const rec of pkg.updates) {
        if (registrySnapshot[rec.id]) {
          UNIFIED_SOURCE_REGISTRY[rec.id] = registrySnapshot[rec.id];
        } else {
          delete UNIFIED_SOURCE_REGISTRY[rec.id];
        }
      }

      this.rejectedPackages.set(packageId, `Atomic activation failure: ${activationError}`);
      if (pkg.authority === 'MAS') {
        this.packageApprovals.delete(packageId);
        this.verifiedPackages.delete(packageId);
      }

      return {
        success: false,
        packageId,
        activatedRecordsCount: 0, // Exactly 0 records activated!
        error: `Atomic activation failed: ${activationError}`
      };
    }

    this.activePackages.set(packageId, pkg);
    if (pkg.authority === 'MAS') this.packageRegistrySnapshots.set(packageId, packageRegistrySnapshot);
    this.stagedPackages.delete(packageId);
    this.verifiedPackages.delete(packageId);
    this.packageApprovals.delete(packageId);

    // Remove from available feeds if present
    this.availableFeeds = this.availableFeeds.filter((f) => f.packageId !== packageId);
    this.syncState = 'SYNCED';
    this.recordAuditEvent(packageId, 'ACTIVATED', masApproval?.reviewer || 'system', masApproval?.reason || 'Verified package activated atomically');

    return {
      success: true,
      packageId,
      activatedRecordsCount: pkg.updates.length
    };
  }

  /**
   * Rolls back an activated update package.
   * Restores prior versions in both the versioning manager and active registry.
   */
  public async rollbackUpdatePackage(packageId: string): Promise<PackageRollbackResult> {
    const pkg = this.activePackages.get(packageId);
    if (!pkg) {
      return {
        success: false,
        packageId,
        rolledBackRecordsCount: 0,
        error: `Active package '${packageId}' not found for rollback`
      };
    }

    const packageVersionIds = this.packageVersionIds.get(packageId);
    if (pkg.authority === 'MAS' && pkg.updates.some(record => {
      const versionId = packageVersionIds?.get(record.id);
      return !versionId || this.versioningManager.getActiveVersionId(record.id) !== versionId;
    })) {
      return {
        success: false,
        packageId,
        rolledBackRecordsCount: 0,
        error: 'An older MAS package cannot be rolled back while a newer version is active'
      };
    }

    let rolledBackCount = 0;
    for (const rec of pkg.updates) {
      const versionId = packageVersionIds?.get(rec.id) || `${pkg.packageId}-${rec.id}`;
      const rollResult = this.versioningManager.rollbackVersion(versionId);
      if (rollResult.success) {
        if (pkg.authority === 'MAS') {
          const previousRecord = this.packageRegistrySnapshots.get(packageId)?.[rec.id];
          if (previousRecord) UNIFIED_SOURCE_REGISTRY[rec.id] = recordClone(previousRecord);
          else delete UNIFIED_SOURCE_REGISTRY[rec.id];
        } else {
          // Restore prior snapshot in active registry
          const predecessorEntry = this.versioningManager.getLedgerEntry(rollResult.restoredVersionId);
          if (predecessorEntry) UNIFIED_SOURCE_REGISTRY[rec.id] = recordClone(predecessorEntry.recordSnapshot);
        }
        rolledBackCount++;
      }
    }

    this.activePackages.delete(packageId);
    this.packageRegistrySnapshots.delete(packageId);
    this.recordAuditEvent(packageId, 'ROLLED_BACK', 'system', 'Active package rolled back to predecessor versions');
    return {
      success: true,
      packageId,
      rolledBackRecordsCount: rolledBackCount
    };
  }

  public setSyncState(state: LiveSyncState): void {
    this.syncState = state;
  }

  public getSyncState(): LiveSyncState {
    return this.syncState;
  }

  public getLastCheckDate(): string {
    return this.lastCheckDate;
  }

  public getLastVerificationDate(): string {
    return this.lastVerificationDate;
  }

  public getStagedPackages(): RegulatoryUpdatePackage[] {
    return Array.from(this.stagedPackages.values(), packageClone);
  }

  public getVerifiedPackages(): RegulatoryUpdatePackage[] {
    return Array.from(this.verifiedPackages.values(), packageClone);
  }

  public getActivePackages(): RegulatoryUpdatePackage[] {
    return Array.from(this.activePackages.values(), packageClone);
  }

  public getRejectedPackages(): Record<string, string> {
    const res: Record<string, string> = {};
    for (const [k, v] of this.rejectedPackages.entries()) {
      res[k] = v;
    }
    return res;
  }

  public getReviewAuditEvents(packageId?: string): RegulatoryReviewAuditEvent[] {
    return this.reviewAuditEvents
      .filter(event => !packageId || event.packageId === packageId)
      .map(event => ({ ...event }));
  }

  /**
   * Resets feed state (for test isolation)
   */
  public reset(): void {
    this.stagedPackages.clear();
    this.verifiedPackages.clear();
    this.activePackages.clear();
    this.rejectedPackages.clear();
    this.packageApprovals.clear();
    this.packageVersionIds.clear();
    this.packageCandidateSnapshots.clear();
    this.packageRegistrySnapshots.clear();
    this.packageGenerations.clear();
    this.reviewAuditEvents = [];
    this.availableFeeds = [];
    this.syncState = 'SYNCED';
  }
}

/**
 * Singleton instance of LiveRegulatoryFeedService.
 */
export const defaultLiveRegulatoryFeedService = new LiveRegulatoryFeedService();
