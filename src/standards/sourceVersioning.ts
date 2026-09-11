import type { AuthoritativeSourceRecord } from './unifiedSourceModel';

export interface SourceVersionMetadata {
  versionId: string;
  contentHash: string; // 64-character hexadecimal SHA-256 hash
  effectiveDate?: string;
  validFrom?: string;
  validTo?: string;
  publishedDate?: string;
  supersedesVersionId?: string;
  supersededByVersionId?: string;
  amendmentSummary?: string;
  canonicalSourceUrl: string;
  sourceAuthority:
    | 'AGC'
    | 'IRAS'
    | 'ACRA'
    | 'MOM'
    | 'CPF'
    | 'REFERENCE_API';
  verificationStatus:
    | 'UNVERIFIED'
    | 'VERIFIED'
    | 'REJECTED';
  verificationMethod?: string;
  retrievedAt: string;
  // Source-native legislation identity
  legislationCode?: string;
  revisionDate?: string;
  amendmentInstrument?: string;
}

export type VersionChange =
  | 'TEXT_CHANGE'
  | 'RATE_CHANGE'
  | 'THRESHOLD_CHANGE'
  | 'EFFECTIVE_DATE_CHANGE'
  | 'APPLICABILITY_CHANGE'
  | 'CITATION_CHANGE';

export interface VersionComparison {
  textChanged: boolean;
  rateChanged: boolean;
  thresholdChanged: boolean;
  effectiveDateChanged: boolean;
  applicabilityChanged: boolean;
  citationChanged: boolean;
  changes: VersionChange[];
  diffSummary: string[];
}

export interface ActivationResult {
  success: boolean;
  versionId: string;
  activatedRecordId: string;
  error?: string;
}

export interface RollbackResult {
  success: boolean;
  rolledBackVersionId: string;
  restoredVersionId: string;
  error?: string;
}

/**
 * Deterministic Pure-TypeScript SHA-256 implementation (FIPS 180-4).
 * Runs synchronously in any JavaScript/TypeScript runtime (Node.js, Browser, Web Worker)
 * with zero external dependencies. Always produces a 64-char lowercase hex digest.
 */
export function computeSha256(message: string): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  // UTF-8 encode
  const bytes: number[] = [];
  for (let i = 0; i < message.length; i++) {
    let charCode = message.charCodeAt(i);
    if (charCode < 0x80) {
      bytes.push(charCode);
    } else if (charCode < 0x800) {
      bytes.push(0xc0 | (charCode >> 6), 0x80 | (charCode & 0x3f));
    } else if (charCode < 0xd800 || charCode >= 0xe000) {
      bytes.push(0xe0 | (charCode >> 12), 0x80 | ((charCode >> 6) & 0x3f), 0x80 | (charCode & 0x3f));
    } else {
      i++;
      charCode = 0x10000 + (((charCode & 0x3ff) << 10) | (message.charCodeAt(i) & 0x3ff));
      bytes.push(
        0xf0 | (charCode >> 18),
        0x80 | ((charCode >> 12) & 0x3f),
        0x80 | ((charCode >> 6) & 0x3f),
        0x80 | (charCode & 0x3f)
      );
    }
  }

  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) {
    bytes.push(0);
  }

  // 64-bit big-endian length
  for (let i = 7; i >= 0; i--) {
    bytes.push((bitLength >>> (i * 8)) & 0xff);
  }

  let H0 = 0x6a09e667;
  let H1 = 0xbb67ae85;
  let H2 = 0x3c6ef372;
  let H3 = 0xa54ff53a;
  let H4 = 0x510e527f;
  let H5 = 0x9b05688c;
  let H6 = 0x1f83d9ab;
  let H7 = 0x5be0cd19;

  const W = new Int32Array(64);

  for (let i = 0; i < bytes.length; i += 64) {
    for (let t = 0; t < 16; t++) {
      W[t] =
        (bytes[i + t * 4] << 24) |
        (bytes[i + t * 4 + 1] << 16) |
        (bytes[i + t * 4 + 2] << 8) |
        bytes[i + t * 4 + 3];
    }

    for (let t = 16; t < 64; t++) {
      const s0 =
        (((W[t - 15] >>> 7) | (W[t - 15] << 25)) ^
          ((W[t - 15] >>> 18) | (W[t - 15] << 14)) ^
          (W[t - 15] >>> 3)) |
        0;
      const s1 =
        (((W[t - 2] >>> 17) | (W[t - 2] << 15)) ^
          ((W[t - 2] >>> 19) | (W[t - 2] << 13)) ^
          (W[t - 2] >>> 10)) |
        0;
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
    }

    let a = H0;
    let b = H1;
    let c = H2;
    let d = H3;
    let e = H4;
    let f = H5;
    let g = H6;
    let h = H7;

    for (let t = 0; t < 64; t++) {
      const S1 =
        (((e >>> 6) | (e << 26)) ^
          ((e >>> 11) | (e << 21)) ^
          ((e >>> 25) | (e << 7))) |
        0;
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + W[t]) | 0;
      const S0 =
        (((a >>> 2) | (a << 30)) ^
          ((a >>> 13) | (a << 19)) ^
          ((a >>> 22) | (a << 10))) |
        0;
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    H0 = (H0 + a) | 0;
    H1 = (H1 + b) | 0;
    H2 = (H2 + c) | 0;
    H3 = (H3 + d) | 0;
    H4 = (H4 + e) | 0;
    H5 = (H5 + f) | 0;
    H6 = (H6 + g) | 0;
    H7 = (H7 + h) | 0;
  }

  const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `${toHex(H0)}${toHex(H1)}${toHex(H2)}${toHex(H3)}${toHex(H4)}${toHex(H5)}${toHex(H6)}${toHex(H7)}`;
}

/**
 * Immutable Version Ledger Entry
 */
export interface VersionLedgerEntry {
  versionId: string;
  recordId: string;
  metadata: SourceVersionMetadata;
  recordSnapshot: AuthoritativeSourceRecord;
  recordedAt: string;
  isActive: boolean;
}

/**
 * Source Versioning and Immutable Ledger Manager.
 * Preserves append-only history of regulatory provisions.
 */
export class SourceVersioningManager {
  // Append-only immutable ledger: versionId -> VersionLedgerEntry
  private ledger: Map<string, VersionLedgerEntry> = new Map();
  // Candidate versions waiting for validation/verification: versionId -> SourceVersionMetadata
  private candidates: Map<string, { record: AuthoritativeSourceRecord; metadata: SourceVersionMetadata }> = new Map();
  // Active pointer: recordId -> versionId
  private activeVersionPointers: Map<string, string> = new Map();

  /**
   * Deterministically calculates canonical SHA-256 content hash from standard fields:
   * standardOrActCode | paragraphOrSection | sourceText | validFrom | validTo
   */
  public computeSourceHash(record: AuthoritativeSourceRecord): string {
    const canonicalPayload = [
      record.standardOrActCode.trim().toLowerCase(),
      record.paragraphOrSection.trim().toLowerCase(),
      record.sourceText.trim(),
      (record.validFrom || '').trim(),
      (record.validTo || '').trim()
    ].join('||');

    return computeSha256(canonicalPayload);
  }

  /**
   * Registers a newly fetched or proposed source version as an UNVERIFIED candidate.
   * Does NOT activate the version into the active ledger.
   */
  public registerCandidateVersion(
    record: AuthoritativeSourceRecord,
    metadata: SourceVersionMetadata
  ): SourceVersionMetadata {
    const computedHash = this.computeSourceHash(record);
    const finalizedMetadata: SourceVersionMetadata = {
      ...metadata,
      contentHash: computedHash,
      verificationStatus: metadata.verificationStatus || 'UNVERIFIED',
      retrievedAt: metadata.retrievedAt || new Date().toISOString()
    };

    this.candidates.set(metadata.versionId, {
      record: { ...record, contentHash: computedHash, versionId: metadata.versionId },
      metadata: finalizedMetadata
    });

    return finalizedMetadata;
  }

  /**
   * Verifies content integrity: checks if the record's current content matches its declared SHA-256 hash.
   */
  public verifySourceIntegrity(
    record: AuthoritativeSourceRecord,
    expectedHash: string
  ): boolean {
    const actualHash = this.computeSourceHash(record);
    return actualHash.toLowerCase() === expectedHash.toLowerCase();
  }

  /**
   * Compares two source versions and extracts structured accounting/statutory diffs:
   * (e.g. TEXT_CHANGE, RATE_CHANGE, THRESHOLD_CHANGE, EFFECTIVE_DATE_CHANGE, APPLICABILITY_CHANGE, CITATION_CHANGE).
   */
  public compareVersions(
    oldVersion: SourceVersionMetadata,
    newVersion: SourceVersionMetadata,
    oldRecord?: AuthoritativeSourceRecord,
    newRecord?: AuthoritativeSourceRecord
  ): VersionComparison {
    const changes: VersionChange[] = [];
    const diffSummary: string[] = [];

    // 1. Text change
    const textChanged = oldVersion.contentHash !== newVersion.contentHash;
    if (textChanged) {
      changes.push('TEXT_CHANGE');
      diffSummary.push(`Content modified: SHA-256 changed from ${oldVersion.contentHash.slice(0, 8)}... to ${newVersion.contentHash.slice(0, 8)}...`);
    }

    // 2. Effective date change
    const effectiveDateChanged =
      oldVersion.effectiveDate !== newVersion.effectiveDate ||
      oldVersion.validFrom !== newVersion.validFrom ||
      oldVersion.validTo !== newVersion.validTo;
    if (effectiveDateChanged) {
      changes.push('EFFECTIVE_DATE_CHANGE');
      diffSummary.push(
        `Validity window shifted: [${oldVersion.validFrom || 'open'} - ${oldVersion.validTo || 'open'}] -> [${newVersion.validFrom || 'open'} - ${newVersion.validTo || 'open'}]`
      );
    }

    // 3. Citation change
    const citationChanged =
      oldRecord && newRecord && (
        oldRecord.paragraphOrSection !== newRecord.paragraphOrSection ||
        oldRecord.standardOrActCode !== newRecord.standardOrActCode
      );
    if (citationChanged) {
      changes.push('CITATION_CHANGE');
      diffSummary.push(`Citation provision adjusted: ${oldRecord?.paragraphOrSection} -> ${newRecord?.paragraphOrSection}`);
    }

    // 4. Rate & Threshold inspection if records are supplied
    let rateChanged = false;
    let thresholdChanged = false;

    if (oldRecord && newRecord) {
      // Rates: percentages e.g. 7%, 8%, 9%, 17%, 20%
      const oldRates = (oldRecord.sourceText.match(/\b\d+(?:\.\d+)?%/g) || []).sort().join(',');
      const newRates = (newRecord.sourceText.match(/\b\d+(?:\.\d+)?%/g) || []).sort().join(',');
      if (oldRates !== newRates) {
        rateChanged = true;
        changes.push('RATE_CHANGE');
        diffSummary.push(`Statutory rate shift detected: [${oldRates}] -> [${newRates}]`);
      }

      // Thresholds: monetary quantities e.g. $1,000,000, $8,000, $6,800
      const oldAmounts = (oldRecord.sourceText.match(/(?:sgd|\$)\s*[\d,]+(?:\.\d+)?/gi) || []).sort().join(',');
      const newAmounts = (newRecord.sourceText.match(/(?:sgd|\$)\s*[\d,]+(?:\.\d+)?/gi) || []).sort().join(',');
      if (oldAmounts !== newAmounts) {
        thresholdChanged = true;
        changes.push('THRESHOLD_CHANGE');
        diffSummary.push(`Monetary threshold altered: [${oldAmounts}] -> [${newAmounts}]`);
      }
    }

    // 5. Applicability change
    const applicabilityChanged = Boolean(
      (oldRecord?.tags || []).join(',') !== (newRecord?.tags || []).join(',') ||
      oldRecord?.domain !== newRecord?.domain
    );
    if (applicabilityChanged) {
      changes.push('APPLICABILITY_CHANGE');
      diffSummary.push('Domain applicability or regulatory tags altered');
    }

    return {
      textChanged,
      rateChanged,
      thresholdChanged,
      effectiveDateChanged,
      applicabilityChanged,
      citationChanged: Boolean(citationChanged),
      changes,
      diffSummary
    };
  }

  /**
   * Activates a candidate version after verification gate approval.
   * The version is immutably appended to the ledger and marked active.
   */
  public activateVersion(versionId: string): ActivationResult {
    const candidate = this.candidates.get(versionId);
    if (!candidate) {
      return { success: false, versionId, activatedRecordId: '', error: `Candidate version '${versionId}' not found` };
    }

    if (candidate.metadata.verificationStatus !== 'VERIFIED') {
      return {
        success: false,
        versionId,
        activatedRecordId: candidate.record.id,
        error: `Cannot activate version '${versionId}' with status '${candidate.metadata.verificationStatus}' (Must be VERIFIED)`
      };
    }

    const recordId = candidate.record.id;
    const currentActiveVersionId = this.activeVersionPointers.get(recordId);

    // If there was an existing active version, mark it inactive in the ledger
    if (currentActiveVersionId) {
      const existingEntry = this.ledger.get(currentActiveVersionId);
      if (existingEntry) {
        existingEntry.isActive = false;
        existingEntry.metadata = {
          ...existingEntry.metadata,
          supersededByVersionId: versionId
        };
      }
    }

    // Set predecessor on new metadata if applicable
    if (currentActiveVersionId) {
      candidate.metadata.supersedesVersionId = currentActiveVersionId;
    }

    // Append to immutable ledger
    const ledgerEntry: VersionLedgerEntry = {
      versionId,
      recordId,
      metadata: { ...candidate.metadata },
      recordSnapshot: { ...candidate.record },
      recordedAt: new Date().toISOString(),
      isActive: true
    };

    this.ledger.set(versionId, ledgerEntry);
    this.activeVersionPointers.set(recordId, versionId);
    this.candidates.delete(versionId);

    return {
      success: true,
      versionId,
      activatedRecordId: recordId
    };
  }

  /**
   * Rolls back an active version to its predecessor.
   * Preserves append-only ledger immutability (the rolled-back version remains in the ledger).
   */
  public rollbackVersion(versionId: string): RollbackResult {
    const targetEntry = this.ledger.get(versionId);
    if (!targetEntry) {
      return { success: false, rolledBackVersionId: versionId, restoredVersionId: '', error: `Version '${versionId}' not found in ledger` };
    }

    const predecessorVersionId = targetEntry.metadata.supersedesVersionId;
    if (!predecessorVersionId) {
      return {
        success: false,
        rolledBackVersionId: versionId,
        restoredVersionId: '',
        error: `Version '${versionId}' has no recorded predecessor to roll back to`
      };
    }

    const predecessorEntry = this.ledger.get(predecessorVersionId);
    if (!predecessorEntry) {
      return {
        success: false,
        rolledBackVersionId: versionId,
        restoredVersionId: predecessorVersionId,
        error: `Predecessor version '${predecessorVersionId}' not found in ledger`
      };
    }

    // Switch active pointer back to predecessor
    targetEntry.isActive = false;
    predecessorEntry.isActive = true;
    const { supersededByVersionId: _unused, ...restoredMeta } = predecessorEntry.metadata;
    predecessorEntry.metadata = restoredMeta;
    this.activeVersionPointers.set(targetEntry.recordId, predecessorVersionId);

    return {
      success: true,
      rolledBackVersionId: versionId,
      restoredVersionId: predecessorVersionId
    };
  }

  /**
   * Retrieves an immutable snapshot of an entry from the ledger.
   */
  public getLedgerEntry(versionId: string): VersionLedgerEntry | undefined {
    return this.ledger.get(versionId);
  }

  /**
   * Gets the currently active version ID for a given record.
   */
  public getActiveVersionId(recordId: string): string | undefined {
    return this.activeVersionPointers.get(recordId);
  }

  /**
   * Gets all entries in the ledger for audit review.
   */
  public getAllLedgerEntries(): VersionLedgerEntry[] {
    return Array.from(this.ledger.values());
  }

  /**
   * Gets all pending candidates.
   */
  public getCandidates(): Array<{ record: AuthoritativeSourceRecord; metadata: SourceVersionMetadata }> {
    return Array.from(this.candidates.values());
  }

  /**
   * Clears ledger and candidate state (for test isolation).
   */
  public reset(): void {
    this.ledger.clear();
    this.candidates.clear();
    this.activeVersionPointers.clear();
  }
}

/**
 * Singleton instance of SourceVersioningManager.
 */
export const defaultSourceVersioningManager = new SourceVersioningManager();
