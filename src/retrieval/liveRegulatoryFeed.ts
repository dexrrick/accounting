import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import { UNIFIED_SOURCE_REGISTRY } from '../standards/unifiedSourceModel';
import {
  defaultSourceVersioningManager,
  SourceVersioningManager,
  computeSha256,
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

export interface AmendmentSummary {
  recordId: string;
  title: string;
  changeType: VersionChange;
  summary: string;
}

export interface RegulatoryUpdatePackage {
  packageId: string;
  releaseDate: string;
  authority: 'AGC' | 'IRAS' | 'ACRA' | 'MOM' | 'CPF' | 'REFERENCE_API';
  updates: AuthoritativeSourceRecord[];
  amendments: AmendmentSummary[];
  packageHash: string; // SHA-256 of package contents
}

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

  // Mock / remote feed queue for update simulation
  private availableFeeds: RegulatoryUpdatePackage[] = [];

  // Official source update discovery adapters
  private adapters: IOfficialSourceAdapter[];
  private webRetriever: ControlledWebRetriever;

  private lastCheckDate: string = '2026-09-11T00:00:00Z';
  private lastVerificationDate: string = '2026-09-11T00:00:00Z';
  private syncState: LiveSyncState = 'SYNCED';

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

  public getAdapters(): IOfficialSourceAdapter[] {
    return [...this.adapters];
  }

  /**
   * Computes deterministic SHA-256 package hash over all constituent records
   */
  public computePackageHash(pkg: Omit<RegulatoryUpdatePackage, 'packageHash'>): string {
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
    this.availableFeeds.push(pkg);
    this.syncState = 'UPDATE_AVAILABLE';
  }

  /**
   * Checks for available regulatory update packages using registered official source adapters.
   */
  public async checkForUpdates(customRetriever?: ControlledWebRetriever): Promise<UpdateCheckResult> {
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

    // Register each update as an UNVERIFIED candidate in the versioning manager
    for (const rec of pkg.updates) {
      const versionId = `${pkg.packageId}-${rec.id}`;
      const contentHash = rec.contentHash || this.versioningManager.computeSourceHash(rec);
      rec.contentHash = contentHash;

      const metadata: SourceVersionMetadata = {
        versionId,
        contentHash,
        effectiveDate: rec.validFrom || rec.effectiveDate,
        validFrom: rec.validFrom,
        validTo: rec.validTo,
        publishedDate: pkg.releaseDate,
        canonicalSourceUrl: rec.officialSourceUrl,
        sourceAuthority: pkg.authority,
        verificationStatus: 'UNVERIFIED',
        retrievedAt: new Date().toISOString(),
        amendmentSummary: pkg.amendments.find((a) => a.recordId === rec.id)?.summary,
        // Preserve external provenance
        sourceUrl: provenanceDetails?.sourceUrl || rec.officialSourceUrl,
        httpStatus: provenanceDetails?.httpStatus || 200,
        etag: provenanceDetails?.etag,
        lastModified: provenanceDetails?.lastModified,
        documentHash: rec.documentHash,
        provisionHash: rec.provisionHash || rec.contentHash,
        extractionStatus: rec.extractionStatus,
        sourceLocator: rec.sourceLocator
      };

      this.versioningManager.registerCandidateVersion(rec, metadata);
    }

    this.stagedPackages.set(pkg.packageId, pkg);
    this.syncState = 'VERIFICATION_REQUIRED';

    return {
      success: true,
      packageId: pkg.packageId,
      stagedRecordsCount: pkg.updates.length
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
    rawDocuments: Record<string, string> | string
  ): Promise<PackageVerificationResult> {
    if (!rawDocuments || (typeof rawDocuments !== 'string' && typeof rawDocuments !== 'object')) {
      this.rejectedPackages.set(packageId, 'Raw document is required for package verification');
      return {
        isValid: false,
        packageId,
        verifiedRecordsCount: 0,
        rejectionReason: 'Raw document is strictly required to verify update package and validate source boundary'
      };
    }

    if (typeof rawDocuments === 'string' && rawDocuments.trim().length === 0) {
      this.rejectedPackages.set(packageId, 'Raw document is required for package verification');
      return {
        isValid: false,
        packageId,
        verifiedRecordsCount: 0,
        rejectionReason: 'Raw document is strictly required to verify update package and validate source boundary'
      };
    }

    const pkg = this.stagedPackages.get(packageId);
    if (!pkg) {
      return {
        isValid: false,
        packageId,
        verifiedRecordsCount: 0,
        rejectionReason: `Staged package '${packageId}' not found`
      };
    }

    // 1. Verify package hash integrity
    const expectedPackageHash = this.computePackageHash({
      packageId: pkg.packageId,
      releaseDate: pkg.releaseDate,
      authority: pkg.authority,
      updates: pkg.updates,
      amendments: pkg.amendments
    });

    if (pkg.packageHash && pkg.packageHash.toLowerCase() !== expectedPackageHash.toLowerCase()) {
      this.rejectedPackages.set(packageId, 'Package content hash mismatch');
      this.syncState = 'FETCH_FAILED';
      return {
        isValid: false,
        packageId,
        verifiedRecordsCount: 0,
        rejectionReason: `Package hash mismatch: expected '${expectedPackageHash}', received '${pkg.packageHash}'`
      };
    }

    // 2. Validate every record atomically
    for (let i = 0; i < pkg.updates.length; i++) {
      const rec = pkg.updates[i];

      // Retrieve record-specific raw document
      let rawDoc: string | undefined;
      if (typeof rawDocuments === 'string') {
        rawDoc = rawDocuments;
      } else {
        rawDoc = rawDocuments[rec.id];
      }

      if (!rawDoc || typeof rawDoc !== 'string' || rawDoc.trim().length === 0) {
        this.rejectedPackages.set(packageId, `Record #${i + 1} (${rec.id}): Missing record-specific raw document`);
        return {
          isValid: false,
          packageId,
          verifiedRecordsCount: 0,
          failedRecordId: rec.id,
          rejectionReason: `Atomic validation failure on record '${rec.id}': Missing record-specific raw document`
        };
      }

      // Verify record-specific document hash if record defines documentHash
      if (rec.documentHash) {
        const actualDocHash = computeSha256(rawDoc);
        if (actualDocHash.toLowerCase() !== rec.documentHash.toLowerCase()) {
          this.rejectedPackages.set(packageId, `Record #${i + 1} (${rec.id}): Document hash mismatch`);
          return {
            isValid: false,
            packageId,
            verifiedRecordsCount: 0,
            failedRecordId: rec.id,
            rejectionReason: `Atomic validation failure on record '${rec.id}': Document hash mismatch for record-specific raw document (expected '${rec.documentHash}', got '${actualDocHash}')`
          };
        }
      }

      // Structure check
      const structCheck = this.validator.validateDocumentStructure(rec);
      if (!structCheck.isValid) {
        this.rejectedPackages.set(packageId, `Record #${i + 1} (${rec.id}): ${structCheck.reason}`);
        return {
          isValid: false,
          packageId,
          verifiedRecordsCount: 0,
          failedRecordId: rec.id,
          rejectionReason: `Atomic validation failure on record '${rec.id}': ${structCheck.reason}`
        };
      }

      // URL and domain security check
      const urlCheck = this.validator.validateUrlSecurity(rec.officialSourceUrl);
      if (!urlCheck.isValid) {
        this.rejectedPackages.set(packageId, `Record #${i + 1} (${rec.id}): ${urlCheck.reason}`);
        return {
          isValid: false,
          packageId,
          verifiedRecordsCount: 0,
          failedRecordId: rec.id,
          rejectionReason: `Atomic validation failure on record '${rec.id}': ${urlCheck.reason}`
        };
      }

      // Canonical authority URL check
      const authCheck = this.validator.validateCanonicalUrl(rec.officialSourceUrl, pkg.authority);
      if (!authCheck.isValid) {
        this.rejectedPackages.set(packageId, `Record #${i + 1} (${rec.id}): ${authCheck.reason}`);
        return {
          isValid: false,
          packageId,
          verifiedRecordsCount: 0,
          failedRecordId: rec.id,
          rejectionReason: `Atomic validation failure on record '${rec.id}': ${authCheck.reason}`
        };
      }

      // Provenance check
      const provCheck = this.validator.validateProvenance(rec, rec.officialSourceUrl);
      if (!provCheck.isValid) {
        this.rejectedPackages.set(packageId, `Record #${i + 1} (${rec.id}): ${provCheck.reason}`);
        return {
          isValid: false,
          packageId,
          verifiedRecordsCount: 0,
          failedRecordId: rec.id,
          rejectionReason: `Atomic validation failure on record '${rec.id}': ${provCheck.reason}`
        };
      }

      // Source boundary verification (ties candidate sourceText back to raw document offsets)
      const boundaryCheck = this.validator.validateSourceBoundary(rec, rawDoc);
      if (!boundaryCheck.isValid) {
        this.rejectedPackages.set(packageId, `Record #${i + 1} (${rec.id}): ${boundaryCheck.reason}`);
        return {
          isValid: false,
          packageId,
          verifiedRecordsCount: 0,
          failedRecordId: rec.id,
          rejectionReason: `Atomic validation failure on record '${rec.id}': ${boundaryCheck.reason}`
        };
      }

      // Provision mapping & anti-truncation check
      const mappingCheck = this.validator.validateProvisionMapping(rec);
      if (!mappingCheck.isValid) {
        this.rejectedPackages.set(packageId, `Record #${i + 1} (${rec.id}): ${mappingCheck.reason}`);
        return {
          isValid: false,
          packageId,
          verifiedRecordsCount: 0,
          failedRecordId: rec.id,
          rejectionReason: `Atomic validation failure on record '${rec.id}': ${mappingCheck.reason}`
        };
      }
    }

    // All records passed verification! Promote candidate statuses to VERIFIED
    for (const rec of pkg.updates) {
      const versionId = `${pkg.packageId}-${rec.id}`;
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

    return {
      isValid: true,
      packageId,
      verifiedRecordsCount: pkg.updates.length
    };
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

    // Phase 1: Snapshot registry state for all affected record IDs
    const registrySnapshot: Record<string, AuthoritativeSourceRecord> = {};
    for (const rec of pkg.updates) {
      if (UNIFIED_SOURCE_REGISTRY[rec.id]) {
        registrySnapshot[rec.id] = { ...UNIFIED_SOURCE_REGISTRY[rec.id] };
      }
    }

    // Phase 2: Transactional activation
    const activatedVersionIds: string[] = [];
    let activationError: string | null = null;

    for (const rec of pkg.updates) {
      const versionId = `${pkg.packageId}-${rec.id}`;
      const actResult = this.versioningManager.activateVersion(versionId);
      if (!actResult.success) {
        activationError = `Failed to activate record '${rec.id}': ${actResult.error}`;
        break;
      }

      activatedVersionIds.push(versionId);

      // Update the active in-memory registry: preserve sourceType and evidenceTier intact
      const activeRecord: AuthoritativeSourceRecord = {
        ...rec,
        versionId,
        version: pkg.packageId,
        provenance: 'LIVE_PATCH',
        sourceStatus: 'VERIFIED',
        sourceType: rec.sourceType,
        evidenceTier: rec.evidenceTier
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

      return {
        success: false,
        packageId,
        activatedRecordsCount: 0, // Exactly 0 records activated!
        error: `Atomic activation failed: ${activationError}`
      };
    }

    this.activePackages.set(packageId, pkg);
    this.stagedPackages.delete(packageId);
    this.verifiedPackages.delete(packageId);

    // Remove from available feeds if present
    this.availableFeeds = this.availableFeeds.filter((f) => f.packageId !== packageId);
    this.syncState = 'SYNCED';

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

    let rolledBackCount = 0;
    for (const rec of pkg.updates) {
      const versionId = `${pkg.packageId}-${rec.id}`;
      const rollResult = this.versioningManager.rollbackVersion(versionId);
      if (rollResult.success) {
        // Restore prior snapshot in active registry
        const predecessorEntry = this.versioningManager.getLedgerEntry(rollResult.restoredVersionId);
        if (predecessorEntry) {
          UNIFIED_SOURCE_REGISTRY[rec.id] = { ...predecessorEntry.recordSnapshot };
        }
        rolledBackCount++;
      }
    }

    this.activePackages.delete(packageId);
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
    return Array.from(this.stagedPackages.values());
  }

  public getVerifiedPackages(): RegulatoryUpdatePackage[] {
    return Array.from(this.verifiedPackages.values());
  }

  public getActivePackages(): RegulatoryUpdatePackage[] {
    return Array.from(this.activePackages.values());
  }

  public getRejectedPackages(): Record<string, string> {
    const res: Record<string, string> = {};
    for (const [k, v] of this.rejectedPackages.entries()) {
      res[k] = v;
    }
    return res;
  }

  /**
   * Resets feed state (for test isolation)
   */
  public reset(): void {
    this.stagedPackages.clear();
    this.verifiedPackages.clear();
    this.activePackages.clear();
    this.rejectedPackages.clear();
    this.availableFeeds = [];
    this.syncState = 'SYNCED';
  }
}

/**
 * Singleton instance of LiveRegulatoryFeedService.
 */
export const defaultLiveRegulatoryFeedService = new LiveRegulatoryFeedService();
