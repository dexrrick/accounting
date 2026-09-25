import type { StatutoryAuthority, QueryDomain } from '../types/accounting';
import { STANDARDS_REPOSITORY } from './standardsKnowledge';
import { SINGAPORE_STATUTORY_REPOSITORY } from './singaporeStatutesKnowledge';
import {
  type FreshnessStatus,
  SourceFreshnessManager,
  defaultSourceFreshnessManager
} from './sourceFreshnessManager';
import { defaultSourceVersioningManager } from './sourceVersioning';
import { isAskGovSingaporeUrl } from './approvedSourceRegistry';

export type SourceStatus = 'VERIFIED' | 'NEEDS_REVIEW' | 'HISTORICAL';

export type SourceType = 'AUTHORITATIVE_SOURCE' | 'OFFICIAL_GUIDANCE' | 'CURATED_SUMMARY' | 'APPLICATION_RULE';

export type EvidenceTier = 'PRIMARY_SOURCE' | 'OFFICIAL_GUIDANCE' | 'CURATED_SUMMARY' | 'APPLICATION_RULE';

export { type FreshnessStatus } from './sourceFreshnessManager';

export interface AuthoritativeSourceRecord {
  id: string;
  authority: StatutoryAuthority;
  authorityName: string;
  sourcePublisher: string; // Official publisher e.g. "Singapore Statutes Online / AGC", "Accounting Standards Council"
  legalOrStandardInstrument: string; // Instrument e.g. "Income Tax Act 1947", "SFRS(I) 1-38 Intangible Assets"
  documentTitle: string;
  standardOrActCode: string;
  paragraphOrSection: string;
  sourceText: string;
  principleSummary: string;
  effectiveDate?: string; // Optional: unknown effective dates must remain undefined, NEVER generic fake dates
  revisionDate?: string;
  officialSourceUrl: string;
  domain: QueryDomain;
  jurisdiction: 'Singapore' | string;
  tags: string[];
  sourceStatus: SourceStatus;
  sourceType: SourceType;
  evidenceTier: EvidenceTier; // Explicitly declared provenance tier
  isVerbatimText: boolean; // Explicitly declared, NEVER inferred from length or URL
  // Phase 3 Temporal & Freshness Properties
  validFrom?: string; // ISO YYYY-MM-DD
  validTo?: string; // ISO YYYY-MM-DD (open-ended if active indefinitely)
  lastVerifiedDate: string; // Date of last statutory audit verification
  reviewAuditCycleDays?: number; // Audit review interval (default 365 days)
  freshnessStatus?: FreshnessStatus; // Explicit freshness status against reference date
  supersededByRecordId?: string;
  historicalPredecessorRecordId?: string;
  // Phase 4 Versioning & Provenance Properties
  lifecycleState?: 'ACTIVE' | 'CANDIDATE' | 'STAGED' | 'REJECTED';
  version?: string;
  documentHash?: string; // SHA-256 of complete raw HTTP response payload
  provisionHash?: string; // Canonical integrity hash: SHA-256 of extracted normalized provision
  /**
   * Deprecated compatibility field.
   * provisionHash is the canonical integrity hash for new records.
   */
  contentHash?: string; // 64-character hex SHA-256
  extractionStatus?: 'EXACT' | 'PARTIAL' | 'FAILED';
  sourceLocator?: SourceLocator;
  provenance: 'LOCAL_STATIC' | 'LIVE_EXTERNAL' | 'LIVE_PATCH';
  canonicalSourceUrl?: string;
  sourceAuthority?: 'AGC' | 'IRAS' | 'ACRA' | 'MOM' | 'CPF' | 'MAS' | 'ASK_GOV_SG' | 'REFERENCE_API';
  retrievedAt?: string;
  verificationMethod?: string;
  versionId?: string;
  legislationCode?: string;
  amendmentInstrument?: string;
  fxObservation?: any;
}

export interface SourceLocator {
  heading?: string;
  elementId?: string;
  startOffset?: number;
  endOffset?: number;
  document?: string;
  act?: string;
  section?: string;
  subsection?: string;
  sourceNode?: string;
  boundary?: {
    startOffset: number;
    endOffset: number;
  };
  sourceType?: 'HTML' | 'JSON';
  canonicalLocator?: string;
}

/**
 * Maps statutory categories to canonical QueryDomain
 */
function mapStatuteCategoryToDomain(category: string): QueryDomain {
  switch (category) {
    case 'TAX_INCOME':
      return 'IRAS_TAX';
    case 'TAX_GST':
      return 'IRAS_GST';
    case 'ACRA_COMPLIANCE':
      return 'ACRA_CORP';
    case 'MOM_LABOUR':
      return 'MOM_EMPLOYMENT';
    case 'CPF_PAYROLL':
      return 'CPF_BOARD';
    case 'MAS_FINANCE':
      return 'MAS_FUNDS';
    default:
      return 'GENERAL';
  }
}

/**
 * Curated list of verified primary statutory and standards records.
 * Explicitly marks sourceStatus ('VERIFIED' vs 'NEEDS_REVIEW' vs 'HISTORICAL') and
 * sourceType ('AUTHORITATIVE_SOURCE' vs 'CURATED_SUMMARY' vs 'APPLICATION_RULE').
 */
export const UNIFIED_SOURCE_REGISTRY: Record<string, AuthoritativeSourceRecord> = {};

/**
 * Extracts the standard identifier from an SFRS(I) code, stripping trailing
 * paragraph/section annotations without collapsing the standard number.
 * e.g. "SFRS(I) 1-38 §57" -> "SFRS(I) 1-38"
 */
function extractStandardCode(sfrsCode: string | undefined): string {
  if (!sfrsCode) return 'SFRS(I)';
  return sfrsCode.replace(/\s*§.*$/, '').trim();
}

/**
 * Builds or rebuilds the unified source registry against an explicit reference date.
 */
export function buildUnifiedSourceRegistry(
  referenceDate: string = SourceFreshnessManager.DEFAULT_REFERENCE_DATE
): Record<string, AuthoritativeSourceRecord> {
  // Clear existing registry
  for (const k of Object.keys(UNIFIED_SOURCE_REGISTRY)) {
    delete UNIFIED_SOURCE_REGISTRY[k];
  }

  // 1. Ingest Statutory Rules from Singapore Statutes
  for (const [key, rule] of Object.entries(SINGAPORE_STATUTORY_REPOSITORY)) {
    const hasVerbatimText = Boolean(rule.verbatimStatuteText && rule.verbatimStatuteText.trim().length > 0);
    const isVerbatim = rule.isVerbatimText === true && hasVerbatimText;
    const isHistorical = rule.sourceStatus === 'HISTORICAL';

    let status: SourceStatus = 'NEEDS_REVIEW';
    if (isHistorical) {
      status = 'HISTORICAL';
    } else if (isVerbatim && rule.sourceStatus === 'VERIFIED') {
      status = 'VERIFIED';
    }

    const isAskGov = isAskGovSingaporeUrl(rule.canonicalUrl);

    const type: SourceType = isAskGov
      ? 'OFFICIAL_GUIDANCE'
      : isVerbatim && (rule.sourceStatus === 'VERIFIED' || isHistorical)
      ? 'AUTHORITATIVE_SOURCE'
      : 'CURATED_SUMMARY';
    const tier: EvidenceTier = isAskGov
      ? 'OFFICIAL_GUIDANCE'
      : isVerbatim && (rule.sourceStatus === 'VERIFIED' || isHistorical)
      ? 'PRIMARY_SOURCE'
      : 'CURATED_SUMMARY';

    const validFrom = rule.validFrom || rule.effectiveDate;
    const validTo = rule.validTo;
    const lastVerified = rule.lastVerifiedDate || '2026-09-01';
    const auditDays = rule.reviewAuditCycleDays ?? SourceFreshnessManager.DEFAULT_AUDIT_CYCLE_DAYS;

    const record: AuthoritativeSourceRecord = {
      id: rule.id,
      authority: rule.authority,
      authorityName: rule.authorityName,
      sourcePublisher: rule.sourcePublisher || (rule.canonicalUrl.includes('sso.agc.gov.sg') ? 'Singapore Statutes Online / AGC' : rule.authorityName),
      legalOrStandardInstrument: rule.legalOrStandardInstrument || rule.actTitle,
      documentTitle: rule.actTitle,
      standardOrActCode: rule.actCode,
      paragraphOrSection: rule.sectionOrSchedule,
      sourceText: rule.verbatimStatuteText || rule.principle,
      principleSummary: rule.ruleTitle,
      effectiveDate: rule.effectiveDate,
      revisionDate: rule.revisionDate,
      officialSourceUrl: rule.canonicalUrl,
      domain: mapStatuteCategoryToDomain(rule.category),
      jurisdiction: 'Singapore',
      tags: rule.tags || [],
      sourceStatus: status,
      sourceType: type,
      evidenceTier: tier,
      isVerbatimText: isVerbatim,
      validFrom,
      validTo,
      lastVerifiedDate: lastVerified,
      reviewAuditCycleDays: auditDays,
      supersededByRecordId: rule.supersededByRecordId,
      historicalPredecessorRecordId: rule.historicalPredecessorRecordId,
      provenance: 'LOCAL_STATIC',
      lifecycleState: 'ACTIVE',
      version: '2026.09',
      canonicalSourceUrl: rule.canonicalUrl,
      sourceAuthority: rule.canonicalUrl.includes('ask.gov.sg') ? 'ASK_GOV_SG' : rule.authority === 'IRAS' ? 'IRAS' : rule.authority === 'ACRA' ? 'ACRA' : rule.authority === 'MOM' ? 'MOM' : rule.authority === 'CPF' ? 'CPF' : rule.authority === 'MAS' ? 'MAS' : 'AGC',
      retrievedAt: '2026-09-01T00:00:00Z',
      verificationMethod: isVerbatim && rule.sourceStatus === 'VERIFIED' ? 'STATUTORY_LEGISLATION_AUDIT' : 'CURATED_EDITORIAL_REVIEW'
    };

    record.contentHash = defaultSourceVersioningManager.computeSourceHash(record);
    record.provisionHash = record.contentHash;
    record.extractionStatus = isVerbatim && rule.sourceStatus === 'VERIFIED' ? 'EXACT' : 'PARTIAL';
    if (isVerbatim) {
      record.sourceLocator = {
        heading: rule.sectionOrSchedule,
        elementId: rule.canonicalUrl.includes('#') ? rule.canonicalUrl.split('#')[1] : undefined
      };
    }
    record.freshnessStatus = defaultSourceFreshnessManager.evaluateSourceFreshness(record, referenceDate);
    UNIFIED_SOURCE_REGISTRY[key] = record;
  }

  // 2. Ingest Financial Reporting Standards from ACRA / ASC repository
  for (const [key, std] of Object.entries(STANDARDS_REPOSITORY)) {
    const validFrom = std.validFrom;
    const validTo = std.validTo;
    const lastVerified = std.lastVerifiedDate || '2026-09-01';
    const auditDays = std.reviewAuditCycleDays ?? SourceFreshnessManager.DEFAULT_AUDIT_CYCLE_DAYS;

    const record: AuthoritativeSourceRecord = {
      id: key,
      // `authority` is the existing Singapore routing bucket. The document
      // publisher is recorded separately so IFRS-hosted summaries are not
      // presented as if ACRA published the underlying IFRS material.
      authority: 'ACRA',
      authorityName: std.officialSourceUrl?.includes('ifrs.org')
        ? 'IFRS Foundation'
        : std.officialSourceUrl?.includes('acra.gov.sg')
          ? 'Accounting Standards Committee / ACRA'
          : 'Accounting Standards Council (ACRA) & IASB',
      sourcePublisher: std.officialSourceUrl?.includes('ifrs.org')
        ? 'IFRS Foundation'
        : std.officialSourceUrl?.includes('acra.gov.sg')
          ? 'Accounting Standards Committee / ACRA'
          : 'Accounting Standards Council (Singapore) / IFRS Foundation',
      legalOrStandardInstrument: std.sfrsCode ? `${std.sfrsCode} ${std.standardTitle}` : std.standardTitle,
      documentTitle: std.standardTitle,
      standardOrActCode: extractStandardCode(std.sfrsCode),
      paragraphOrSection: std.paragraph,
      sourceText: std.principle,
      principleSummary: std.standardTitle,
      effectiveDate: std.effectiveDate || std.validFrom || undefined,
      officialSourceUrl: std.officialSourceUrl || 'https://www.acra.gov.sg/accountancy/accounting-standards',
      domain: 'ACCOUNTING_SFRS',
      jurisdiction: 'Singapore',
      tags: [std.standardTitle.toLowerCase(), std.paragraph.toLowerCase(), 'accounting standard', 'sfrs(i)'],
      sourceStatus: 'NEEDS_REVIEW',
      sourceType: 'CURATED_SUMMARY',
      evidenceTier: 'CURATED_SUMMARY',
      isVerbatimText: false,
      validFrom,
      validTo,
      lastVerifiedDate: lastVerified,
      reviewAuditCycleDays: auditDays,
      supersededByRecordId: std.supersededByRecordId,
      historicalPredecessorRecordId: std.historicalPredecessorRecordId,
      provenance: 'LOCAL_STATIC',
      lifecycleState: 'ACTIVE',
      version: '2026.09',
      canonicalSourceUrl: std.officialSourceUrl || 'https://www.acra.gov.sg/accountancy/accounting-standards',
      ...(std.officialSourceUrl?.includes('ifrs.org') ? {} : { sourceAuthority: 'ACRA' as const }),
      retrievedAt: '2026-09-01T00:00:00Z',
      verificationMethod: 'CURATED_EDITORIAL_REVIEW'
    };

    record.contentHash = defaultSourceVersioningManager.computeSourceHash(record);
    record.provisionHash = record.contentHash;
    record.extractionStatus = 'PARTIAL';
    record.freshnessStatus = defaultSourceFreshnessManager.evaluateSourceFreshness(record, referenceDate);
    UNIFIED_SOURCE_REGISTRY[key] = record;
  }

  return UNIFIED_SOURCE_REGISTRY;
}

// Initial bootstrap of registry
buildUnifiedSourceRegistry();

/**
 * Helper to fetch all records in the registry as an array
 */
export function getAllAuthoritativeSources(): AuthoritativeSourceRecord[] {
  return Object.values(UNIFIED_SOURCE_REGISTRY);
}
