import type { StatutoryAuthority, QueryDomain } from '../types/accounting';
import { STANDARDS_REPOSITORY } from './standardsKnowledge';
import { SINGAPORE_STATUTORY_REPOSITORY } from './singaporeStatutesKnowledge';
import {
  type FreshnessStatus,
  SourceFreshnessManager,
  defaultSourceFreshnessManager
} from './sourceFreshnessManager';

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

    const type: SourceType = isVerbatim && (rule.sourceStatus === 'VERIFIED' || isHistorical) ? 'AUTHORITATIVE_SOURCE' : 'CURATED_SUMMARY';
    const tier: EvidenceTier = isVerbatim && (rule.sourceStatus === 'VERIFIED' || isHistorical) ? 'PRIMARY_SOURCE' : 'CURATED_SUMMARY';

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
      historicalPredecessorRecordId: rule.historicalPredecessorRecordId
    };

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
      authority: 'ACRA',
      authorityName: 'Accounting Standards Council (ACRA) & IASB',
      sourcePublisher: 'Accounting Standards Council (Singapore) / IFRS Foundation',
      legalOrStandardInstrument: std.sfrsCode ? `${std.sfrsCode} ${std.standardTitle}` : std.standardTitle,
      documentTitle: std.standardTitle,
      standardOrActCode: std.sfrsCode.split(' ')[0] || 'SFRS(I)',
      paragraphOrSection: std.paragraph,
      sourceText: std.principle,
      principleSummary: std.standardTitle,
      effectiveDate: std.validFrom || undefined,
      officialSourceUrl: 'https://www.acra.gov.sg/accountancy/accounting-standards',
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
      historicalPredecessorRecordId: std.historicalPredecessorRecordId
    };

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
