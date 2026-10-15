import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import { computeSha256 } from '../standards/sourceVersioning';
import type { IOfficialSourceAdapter } from './sourceAdapters';
import type { ControlledFetchResult, ControlledWebRetriever } from './controlledWebRetriever';
import type { OfficialDocumentExtractionRequest } from './officialDocumentExtractor';
import { extractOfficialDocumentFromRetrieved } from './officialDocumentExtractor';
import type { AmendmentSummary, RegulatoryUpdatePackage } from './liveRegulatoryFeed';

export interface MonitoredMasDocument {
  /** Stable registry identity retained across content revisions. */
  recordId: string;
  extractionRequest: OfficialDocumentExtractionRequest;
  amendmentTitle?: string;
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
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
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
    if (this.monitoredDocuments.length === 0) return null;

    const changedRecords: AuthoritativeSourceRecord[] = [];
    const extractionRequests: NonNullable<RegulatoryUpdatePackage['extractionRequests']> = {};
    const documentMetadata: NonNullable<RegulatoryUpdatePackage['documentMetadata']> = {};
    const amendments: AmendmentSummary[] = [];

    for (const monitored of this.monitoredDocuments) {
      const request = structuredClone(monitored.extractionRequest);
      const fetched = await retriever.fetchOfficialDocument(request.url, {
        timeoutMs: request.timeoutMs,
        maxResponseBytes: request.maxResponseBytes
      });
      if (fetched.status !== 'SUCCESS' || !fetched.contentBytes || !fetched.contentType || !fetched.finalUrl || !fetched.httpStatus) return null;

      const extracted = await extractOfficialDocumentFromRetrieved(request, fetched);
      if (extracted.status !== 'SUCCESS' || extracted.record.extractionStatus !== 'EXACT' || !extracted.record.isVerbatimText) return null;
      const record = { ...extracted.record, id: monitored.recordId, groundingEligible: false };
      const existing = currentSources.find(candidate => candidate.id === monitored.recordId);
      if (existing && (existing.authority !== 'MAS' || existing.sourceAuthority && existing.sourceAuthority !== 'MAS')) return null;
      if (sameApplicableContent(existing, record)) continue;

      changedRecords.push(record);
      extractionRequests[record.id] = request;
      documentMetadata[record.id] = retrievalMetadata(request, fetched);
      amendments.push(amendmentFor(record, existing, monitored.amendmentTitle || record.documentTitle));
    }

    if (changedRecords.length === 0) return null;
    const identityHash = computeSha256(stableStringify(changedRecords.map(record => ({
      id: record.id,
      documentHash: record.documentHash,
      provisionHash: record.provisionHash,
      effectiveDate: record.effectiveDate,
      validFrom: record.validFrom,
      validTo: record.validTo
    }))));
    const pkgWithoutHash: Omit<RegulatoryUpdatePackage, 'packageHash'> = {
      packageId: `MAS-${identityHash}`,
      releaseDate: 'undated',
      authority: 'MAS',
      updates: changedRecords,
      amendments,
      extractionRequests,
      documentMetadata
    };
    return { ...pkgWithoutHash, packageHash: computeMasRegulatoryPackageHash(pkgWithoutHash) };
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
