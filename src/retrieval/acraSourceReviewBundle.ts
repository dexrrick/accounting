import type { RegulatoryUpdatePackage } from './liveRegulatoryFeed';
import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import { ACRA_2022_ANNUAL_RETURN_TIMELINES_URL } from './acraAnnualReturnFilingRule';

export const ACRA_SOURCE_REVIEW_PATH = '/source-review/acra-annual-return-2022.json';

export interface AcraSourceReviewDocument {
  recordId: string;
  sourceUrl: string;
  finalUrl: string;
  contentType: string;
  httpStatus: number;
  retrievedAt: string;
  bodyBase64: string;
}

export interface AcraSourceReviewBundle {
  schemaVersion: 1;
  package: RegulatoryUpdatePackage;
  documents: AcraSourceReviewDocument[];
  approval: null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertBundle(value: unknown): asserts value is AcraSourceReviewBundle {
  if (!isObject(value) || value.schemaVersion !== 1 || value.approval !== null ||
      !isObject(value.package) || !Array.isArray(value.documents) || value.documents.length !== 1) {
    throw new Error('The captured ACRA source bundle has an unsupported shape or includes an approval.');
  }

  const pkg = value.package;
  const doc = value.documents[0];
  if (!isObject(doc) || pkg.authority !== 'ACRA' || typeof pkg.packageId !== 'string' ||
      !/^[a-f\d]{64}$/i.test(String(pkg.packageHash || '')) || !Array.isArray(pkg.updates) || pkg.updates.length !== 1 ||
      !isObject(pkg.extractionRequests) || !isObject(pkg.documentMetadata)) {
    throw new Error('The captured bundle is not a single hash-bound ACRA source package.');
  }

  const record = pkg.updates[0] as AuthoritativeSourceRecord;
  const recordId = record?.id;
  const request = pkg.extractionRequests[recordId];
  const metadata = pkg.documentMetadata[recordId];
  if (typeof recordId !== 'string' || doc.recordId !== recordId || !isObject(request) || !isObject(metadata) ||
      doc.sourceUrl !== ACRA_2022_ANNUAL_RETURN_TIMELINES_URL ||
      doc.finalUrl !== ACRA_2022_ANNUAL_RETURN_TIMELINES_URL ||
      request.url !== ACRA_2022_ANNUAL_RETURN_TIMELINES_URL || request.authority !== 'ACRA' ||
      request.domain !== 'ACRA_CORP' || request.documentKind !== 'HTML' ||
      request.sectionHeading !== 'Reminder to file Annual Returns (AR)' ||
      !Array.isArray(request.topicIds) || !request.topicIds.includes('acra_annual-returns') ||
      record.authority !== 'ACRA' || record.sourceAuthority !== 'ACRA' || record.domain !== 'ACRA_CORP' ||
      record.officialSourceUrl !== ACRA_2022_ANNUAL_RETURN_TIMELINES_URL ||
      record.canonicalSourceUrl !== ACRA_2022_ANNUAL_RETURN_TIMELINES_URL ||
      record.provenance !== 'LIVE_EXTERNAL' || record.relatedTopicIds?.includes('acra_annual-returns') !== true ||
      metadata.requestUrl !== ACRA_2022_ANNUAL_RETURN_TIMELINES_URL ||
      metadata.sourceUrl !== ACRA_2022_ANNUAL_RETURN_TIMELINES_URL ||
      metadata.finalUrl !== ACRA_2022_ANNUAL_RETURN_TIMELINES_URL ||
      metadata.contentType !== doc.contentType || metadata.httpStatus !== doc.httpStatus ||
      metadata.retrievedAt !== doc.retrievedAt || record.retrievedAt !== doc.retrievedAt ||
      typeof doc.contentType !== 'string' || !/^text\/html(?:\s*;|$)/i.test(doc.contentType) ||
      !Number.isInteger(doc.httpStatus) || (doc.httpStatus as number) < 200 || (doc.httpStatus as number) >= 300 ||
      typeof doc.retrievedAt !== 'string' || !Number.isFinite(Date.parse(doc.retrievedAt)) ||
      typeof doc.bodyBase64 !== 'string' || !doc.bodyBase64.trim() ||
      typeof record.sourceText !== 'string' || !record.sourceText.trim()) {
    throw new Error('The captured document, package, extraction request, or provenance metadata do not match the ACRA source.');
  }

  if (record.effectiveDate !== undefined || record.validFrom !== undefined || record.validTo !== undefined) {
    throw new Error('The captured ACRA evidence must not be represented as a general legal validity interval.');
  }
}

export async function loadAcraSourceReviewBundle(): Promise<AcraSourceReviewBundle> {
  const response = await fetch(ACRA_SOURCE_REVIEW_PATH, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error'
  });
  if (!response.ok) throw new Error(`Could not load the captured source bundle (HTTP ${response.status}).`);
  const responseUrl = new URL(response.url, window.location.href);
  if (responseUrl.origin !== window.location.origin || responseUrl.pathname !== ACRA_SOURCE_REVIEW_PATH) {
    throw new Error('The source bundle did not load from the expected same-origin path.');
  }
  const parsed: unknown = await response.json();
  assertBundle(parsed);
  return parsed;
}

export function decodeAcraSourceBytes(base64: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new Error('The captured ACRA source bytes are not valid base64.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
