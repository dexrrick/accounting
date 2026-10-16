import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import { computeSha256, computeSha256Bytes } from '../standards/sourceVersioning';
import type { IOfficialSourceAdapter } from './sourceAdapters';
import type { ControlledFetchResult, ControlledWebRetriever } from './controlledWebRetriever';
import type { OfficialDocumentExtractionRequest } from './officialDocumentExtractor';
import { extractOfficialDocumentFromRetrieved } from './officialDocumentExtractor';
import type { AmendmentSummary, RegulatoryUpdatePackage } from './liveRegulatoryFeed';
import {
  createMasLicensingComparisonPolicy,
  MAS_LICENSING_COMPARISON_PROFILE_VERSION,
  MAS_LICENSING_HTML_URL,
  MAS_LICENSING_RECORD_ID,
  type MasLicensingComparisonPolicy
} from '../standards/masLicensingComparisonPolicy';

export interface MonitoredMasDocument {
  /** Stable registry identity retained across content revisions. */
  recordId: string;
  extractionRequest: OfficialDocumentExtractionRequest;
  amendmentTitle?: string;
  /** Explicitly enables the reviewed, versioned dynamic-field policy for one exact document. */
  comparisonProfile?: typeof MAS_LICENSING_COMPARISON_PROFILE_VERSION;
}

export interface MasDocumentRetrievalMetadata {
  requestUrl: string;
  sourceUrl: string;
  finalUrl: string;
  contentType: string;
  httpStatus: number;
  retrievedAt: string;
  etag?: string;
  lastModified?: string;
  comparisonPolicy?: MasLicensingComparisonPolicy;
}

export interface MasDocumentDiscoveryDiagnostic {
  recordId: string;
  requestUrl: string;
  fetchStatus: string;
  httpStatus?: number;
  retrievedAt?: string;
  extractionStatus?: 'EXACT' | 'PARTIAL' | 'FAILED' | 'REJECTED';
  extractionReason?: string;
  changed?: boolean;
  record?: AuthoritativeSourceRecord;
  metadata?: MasDocumentRetrievalMetadata;
}

export interface MasDocumentDiscoveryResult {
  updatePackage: RegulatoryUpdatePackage | null;
  documents: MasDocumentDiscoveryDiagnostic[];
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function normalizedRelatedTopicIds(record: Pick<AuthoritativeSourceRecord, 'relatedTopicIds'>): string[] {
  return [...new Set(record.relatedTopicIds || [])].sort();
}

/** Hashes all MAS request, provenance, applicability, locator, and record content. */
export function computeMasRegulatoryPackageHash(
  pkg: Omit<RegulatoryUpdatePackage, 'packageHash'>
): string {
  return computeSha256(stableStringify({
    packageId: pkg.packageId,
    releaseDate: pkg.releaseDate,
    authority: pkg.authority,
    updates: pkg.updates,
    amendments: pkg.amendments,
    extractionRequests: pkg.extractionRequests,
    documentMetadata: pkg.documentMetadata
  }));
}

function sameApplicableContent(left: AuthoritativeSourceRecord | undefined, right: AuthoritativeSourceRecord): boolean {
  return Boolean(left && left.documentHash === right.documentHash && left.provisionHash === right.provisionHash &&
    left.effectiveDate === right.effectiveDate && left.validFrom === right.validFrom && left.validTo === right.validTo &&
    left.authority === right.authority && left.sourceAuthority === right.sourceAuthority &&
    left.sourcePublisher === right.sourcePublisher && left.standardOrActCode === right.standardOrActCode &&
    left.paragraphOrSection === right.paragraphOrSection && left.domain === right.domain &&
    left.officialSourceUrl === right.officialSourceUrl && left.canonicalSourceUrl === right.canonicalSourceUrl &&
    stableStringify(normalizedRelatedTopicIds(left)) === stableStringify(normalizedRelatedTopicIds(right)) &&
    stableStringify(left.sourceLocator) === stableStringify(right.sourceLocator));
}

function amendmentFor(record: AuthoritativeSourceRecord, existing: AuthoritativeSourceRecord | undefined, title: string): AmendmentSummary {
  const dateChanged = Boolean(existing && (existing.effectiveDate !== record.effectiveDate || existing.validFrom !== record.validFrom || existing.validTo !== record.validTo));
  const citationChanged = Boolean(existing && (existing.paragraphOrSection !== record.paragraphOrSection || existing.standardOrActCode !== record.standardOrActCode));
  const changeType = !existing || record.documentHash !== existing.documentHash || record.provisionHash !== existing.provisionHash
    ? 'TEXT_CHANGE'
    : dateChanged ? 'EFFECTIVE_DATE_CHANGE' : citationChanged ? 'CITATION_CHANGE' : 'APPLICABILITY_CHANGE';
  return {
    recordId: record.id,
    title,
    changeType,
    summary: !existing
      ? `New MAS document content detected (document SHA-256 ${record.documentHash?.slice(0, 12) || 'missing'}…)`
      : `MAS document or provision changed (document SHA-256 ${record.documentHash?.slice(0, 12) || 'missing'}…, provision SHA-256 ${record.provisionHash?.slice(0, 12) || 'missing'}…)`
  };
}

/**
 * Opt-in MAS document lifecycle adapter. The caller must provide explicit
 * monitored documents; index and sitemap discovery results never become evidence.
 */
export class MASDocumentUpdateAdapter implements IOfficialSourceAdapter {
  public readonly authority = 'MAS' as const;
  public readonly sourceName = 'Monetary Authority of Singapore document updates';
  public readonly canonicalBaseUrl = 'https://www.mas.gov.sg';
  private readonly monitoredDocuments: ReadonlyArray<MonitoredMasDocument>;

  constructor(monitoredDocuments: readonly MonitoredMasDocument[]) {
    const ids = new Set<string>();
    this.monitoredDocuments = Object.freeze(monitoredDocuments.map(item => {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(item.recordId) || ids.has(item.recordId)) {
        throw new Error(`MAS monitored document recordId is invalid or duplicated: '${item.recordId}'`);
      }
      ids.add(item.recordId);
      if (item.extractionRequest.authority !== 'MAS' || item.extractionRequest.domain !== 'MAS_FUNDS') {
        throw new Error(`MAS document '${item.recordId}' must be MAS governed and use the MAS_FUNDS domain`);
      }
      if (item.comparisonProfile && (item.comparisonProfile !== MAS_LICENSING_COMPARISON_PROFILE_VERSION ||
          item.recordId !== MAS_LICENSING_RECORD_ID || item.extractionRequest.url !== MAS_LICENSING_HTML_URL ||
          item.extractionRequest.documentKind !== 'HTML')) {
        throw new Error('The MAS licensing comparison profile is restricted to its exact reviewed HTML record and URL');
      }
      return Object.freeze({
        ...item,
        extractionRequest: Object.freeze(structuredClone(item.extractionRequest))
      });
    }));
  }

  public async checkForUpdates(
    retriever: ControlledWebRetriever,
    currentSources: AuthoritativeSourceRecord[] = []
  ): Promise<RegulatoryUpdatePackage | null> {
    return (await this.checkForUpdatesWithDiagnostics(retriever, currentSources)).updatePackage;
  }

  public async checkForUpdatesWithDiagnostics(
    retriever: ControlledWebRetriever,
    currentSources: AuthoritativeSourceRecord[] = []
  ): Promise<MasDocumentDiscoveryResult> {
    if (this.monitoredDocuments.length === 0) return { updatePackage: null, documents: [] };

    const changedRecords: AuthoritativeSourceRecord[] = [];
    const extractionRequests: NonNullable<RegulatoryUpdatePackage['extractionRequests']> = {};
    const documentMetadata: NonNullable<RegulatoryUpdatePackage['documentMetadata']> = {};
    const amendments: AmendmentSummary[] = [];
    const diagnostics: MasDocumentDiscoveryDiagnostic[] = [];

    for (const monitored of this.monitoredDocuments) {
      const request = structuredClone(monitored.extractionRequest);
      const fetched = await retriever.fetchOfficialDocument(request.url, {
        timeoutMs: request.timeoutMs,
        maxResponseBytes: request.maxResponseBytes
      });
      if (fetched.status !== 'SUCCESS' || !fetched.contentBytes || !fetched.contentType || !fetched.finalUrl || !fetched.httpStatus) {
        diagnostics.push({
          recordId: monitored.recordId,
          requestUrl: request.url,
          fetchStatus: fetched.status,
          httpStatus: fetched.httpStatus,
          retrievedAt: fetched.retrievedAt,
          extractionStatus: 'FAILED',
          extractionReason: fetched.error || 'Official document fetch did not return a complete response'
        });
        return { updatePackage: null, documents: diagnostics };
      }

      const extracted = await extractOfficialDocumentFromRetrieved(request, fetched);
      if (extracted.status !== 'SUCCESS' || extracted.record.extractionStatus !== 'EXACT' || !extracted.record.isVerbatimText) {
        diagnostics.push({
          recordId: monitored.recordId,
          requestUrl: request.url,
          fetchStatus: fetched.status,
          httpStatus: fetched.httpStatus,
          retrievedAt: fetched.retrievedAt,
          extractionStatus: extracted.status === 'REJECTED' ? 'REJECTED' : extracted.record.extractionStatus,
          extractionReason: extracted.status === 'REJECTED'
            ? `${extracted.code}: ${extracted.reason}`
            : 'The extracted document was not exact verbatim text'
        });
        return { updatePackage: null, documents: diagnostics };
      }
      const record = { ...extracted.record, id: monitored.recordId, groundingEligible: false };
      const existing = currentSources.find(candidate => candidate.id === monitored.recordId);
      if (existing && (existing.authority !== 'MAS' || existing.sourceAuthority && existing.sourceAuthority !== 'MAS')) {
        diagnostics.push({
          recordId: monitored.recordId,
          requestUrl: request.url,
          fetchStatus: fetched.status,
          httpStatus: fetched.httpStatus,
          retrievedAt: fetched.retrievedAt,
          extractionStatus: 'REJECTED',
          extractionReason: 'The stable MAS record id is currently owned by another authority'
        });
        return { updatePackage: null, documents: diagnostics };
      }
      const metadata = retrievalMetadata(request, fetched);
      if (monitored.comparisonProfile) {
        const policy = request.authority === 'MAS' && request.domain === 'MAS_FUNDS' &&
          request.documentKind === 'HTML' && request.url === MAS_LICENSING_HTML_URL &&
          record.id === MAS_LICENSING_RECORD_ID && record.sourceLocator?.sourceType === 'HTML' &&
          fetched.sourceUrl === MAS_LICENSING_HTML_URL && fetched.finalUrl === MAS_LICENSING_HTML_URL &&
          fetched.contentType?.toLowerCase().startsWith('text/html')
          ? createMasLicensingComparisonPolicy(fetched.contentBytes, record.documentHash || '', computeSha256Bytes)
          : undefined;
        if (!policy) {
          diagnostics.push({
            recordId: monitored.recordId,
            requestUrl: request.url,
            fetchStatus: fetched.status,
            httpStatus: fetched.httpStatus,
            retrievedAt: fetched.retrievedAt,
            extractionStatus: 'REJECTED',
            extractionReason: 'The opted-in MAS licensing page failed its exact dynamic-field profile or raw-byte binding check'
          });
          return { updatePackage: null, documents: diagnostics };
        }
        metadata.comparisonPolicy = policy;
      }
      const changed = !sameApplicableContent(existing, record);
      diagnostics.push({
        recordId: monitored.recordId,
        requestUrl: request.url,
        fetchStatus: fetched.status,
        httpStatus: fetched.httpStatus,
        retrievedAt: fetched.retrievedAt,
        extractionStatus: record.extractionStatus,
        changed,
        record,
        metadata
      });
      if (!changed) continue;

      changedRecords.push(record);
      extractionRequests[record.id] = request;
      documentMetadata[record.id] = metadata;
      amendments.push(amendmentFor(record, existing, monitored.amendmentTitle || record.documentTitle));
    }

    if (changedRecords.length === 0) return { updatePackage: null, documents: diagnostics };
    const identityHash = computeSha256(stableStringify(changedRecords.map(record => {
      const relatedTopicIds = normalizedRelatedTopicIds(record);
      return {
        id: record.id,
        documentHash: record.documentHash,
        provisionHash: record.provisionHash,
        effectiveDate: record.effectiveDate,
        validFrom: record.validFrom,
        validTo: record.validTo,
        ...(relatedTopicIds.length > 0 ? { relatedTopicIds } : {})
      };
    })));
    const pkgWithoutHash: Omit<RegulatoryUpdatePackage, 'packageHash'> = {
      packageId: `MAS-${identityHash}`,
      releaseDate: 'undated',
      authority: 'MAS',
      updates: changedRecords,
      amendments,
      extractionRequests,
      documentMetadata
    };
    return {
      updatePackage: { ...pkgWithoutHash, packageHash: computeMasRegulatoryPackageHash(pkgWithoutHash) },
      documents: diagnostics
    };
  }
}

function retrievalMetadata(request: OfficialDocumentExtractionRequest, fetched: ControlledFetchResult): MasDocumentRetrievalMetadata {
  return {
    requestUrl: request.url,
    sourceUrl: fetched.sourceUrl,
    finalUrl: fetched.finalUrl || fetched.sourceUrl,
    contentType: fetched.contentType || '',
    httpStatus: fetched.httpStatus || 0,
    retrievedAt: fetched.retrievedAt,
    ...(fetched.etag ? { etag: fetched.etag } : {}),
    ...(fetched.lastModified ? { lastModified: fetched.lastModified } : {})
  };
}
