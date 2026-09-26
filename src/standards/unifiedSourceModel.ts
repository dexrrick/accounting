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
import { SINGAPORE_COVERAGE_REGISTRY } from './coverageRegistry';

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
  /** A source-map pointer routes official retrieval but is never itself answer evidence. */
  recordRole?: 'EVIDENCE' | 'SOURCE_MAP_POINTER';
  groundingEligible?: boolean;
  sourceMapTopicIds?: string[];
  sourceMapScope?: 'STANDARD' | 'FRAMEWORK';
  retrievalHints?: string[];
  relatedTopicIds?: string[];
  /** Verifies URL identity/reachability only; it does not verify page claims or standard paragraphs. */
  urlVerificationStatus?: 'VERIFIED' | 'CANDIDATE' | 'REJECTED';
  urlVerifiedDate?: string;
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

    // URL verification is tracked separately from evidence/content review.
    // This one MAS FAQ URL was checked directly; its curated summary remains
    // NEEDS_REVIEW and must not be promoted to verified content.
    if (rule.id === 'MAS_SFO_LICENSING_EXEMPTION_2026') {
      record.urlVerificationStatus = 'VERIFIED';
      record.urlVerifiedDate = '2026-09-26';
    }

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
      // Missing publisher URLs remain absent. Never synthesize an official URL from
      // the authority or standard name.
      officialSourceUrl: std.officialSourceUrl || '',
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
      ...(std.officialSourceUrl ? { canonicalSourceUrl: std.officialSourceUrl } : {}),
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

  // 3. Verified source-map pointers. These records identify official pages for
  // retrieval only. They contain no extracted standard text and cannot be used
  // as answer-grounding evidence even though the URLs were manually checked.
  const mapTopics = SINGAPORE_COVERAGE_REGISTRY.filter(topic => topic.canonicalSourceId && topic.canonicalSourceUrl);
  const mapDefinitions = [
    { id: 'SFRSI10_SOURCE_MAP', code: 'SFRS(I) 10', title: 'IFRS 10 Consolidated Financial Statements', instrument: 'SFRS(I) 10 — Consolidated Financial Statements' },
    { id: 'SFRSI3_SOURCE_MAP', code: 'SFRS(I) 3', title: 'IFRS 3 Business Combinations', instrument: 'SFRS(I) 3 — Business Combinations' },
    { id: 'SFRSI128_SOURCE_MAP', code: 'SFRS(I) 1-28', title: 'IAS 28 Investments in Associates and Joint Ventures', instrument: 'SFRS(I) 1-28 — Investments in Associates and Joint Ventures' },
    { id: 'SFRSI11_SOURCE_MAP', code: 'SFRS(I) 11', title: 'IFRS 11 Joint Arrangements', instrument: 'SFRS(I) 11 — Joint Arrangements' }
  ] as const;
  for (const definition of mapDefinitions) {
    const topics = mapTopics.filter(topic => topic.sourceRecordIds.includes(definition.id));
    const canonicalTopic = mapTopics.find(topic => topic.canonicalSourceId === definition.id);
    if (!topics.length || !canonicalTopic) continue;
    const first = canonicalTopic;
    const record: AuthoritativeSourceRecord = {
      id: definition.id,
      authority: 'ACRA',
      authorityName: 'IFRS Foundation (official standard overview)',
      sourcePublisher: 'IFRS Foundation',
      legalOrStandardInstrument: definition.instrument,
      documentTitle: definition.title,
      standardOrActCode: definition.code,
      paragraphOrSection: 'Official standard overview / source-map pointer',
      sourceText: '',
      principleSummary: 'URL-verified official overview pointer only. Fetch and verify topic-specific material before grounding an answer; this record is not the full SFRS(I) standard or paragraph evidence.',
      officialSourceUrl: first.canonicalSourceUrl!,
      domain: 'ACCOUNTING_SFRS',
      jurisdiction: 'Singapore',
      tags: [...new Set(topics.flatMap(topic => [...topic.keywords, ...(topic.aliases ?? [])]))],
      sourceStatus: 'NEEDS_REVIEW',
      sourceType: 'OFFICIAL_GUIDANCE',
      evidenceTier: 'OFFICIAL_GUIDANCE',
      isVerbatimText: false,
      lastVerifiedDate: '2026-09-25',
      reviewAuditCycleDays: 90,
      provenance: 'LOCAL_STATIC',
      lifecycleState: 'ACTIVE',
      canonicalSourceUrl: first.canonicalSourceUrl!,
      verificationMethod: 'MANUAL_OFFICIAL_URL_AND_PAGE_TITLE_CHECK',
      recordRole: 'SOURCE_MAP_POINTER',
      groundingEligible: false,
      sourceMapScope: 'STANDARD',
      sourceMapTopicIds: topics.map(topic => topic.id),
      retrievalHints: [...new Set(topics.flatMap(topic => [...topic.sectionHints ?? [], ...topic.keywords]))],
      relatedTopicIds: [...new Set(topics.flatMap(topic => topic.relatedTopicIds ?? []))],
      urlVerificationStatus: 'VERIFIED',
      urlVerifiedDate: '2026-09-25',
      extractionStatus: 'PARTIAL'
    };
    record.freshnessStatus = defaultSourceFreshnessManager.evaluateSourceFreshness(record, referenceDate);
    UNIFIED_SOURCE_REGISTRY[definition.id] = record;
  }

  const frameworkTopics = mapTopics.filter(topic => topic.sourceRecordIds.includes('SFRSI_FRAMEWORK_ACRA'));
  const frameworkUrl = 'https://www.acra.gov.sg/regulations/accounting-standards-financial-reporting-surveillance/accounting-standards/';
  const frameworkRecord: AuthoritativeSourceRecord = {
    id: 'SFRSI_FRAMEWORK_ACRA',
    authority: 'ACRA',
    authorityName: 'Accounting Standards Committee / ACRA',
    sourcePublisher: 'ACRA',
    legalOrStandardInstrument: 'Singapore SFRS(I) financial reporting framework',
    documentTitle: 'Accounting Standards — Singapore framework overview',
    standardOrActCode: 'SFRS(I)',
    paragraphOrSection: 'Official framework overview / source-map pointer',
    sourceText: '',
    principleSummary: 'URL-verified ACRA framework overview pointer only. It identifies the Singapore framework; it is not paragraph-level evidence for an individual standard.',
    officialSourceUrl: frameworkUrl,
    domain: 'ACCOUNTING_SFRS',
    jurisdiction: 'Singapore',
    tags: ['sfrs(i)', 'singapore accounting standards', 'accounting standards committee', 'acra'],
    sourceStatus: 'NEEDS_REVIEW',
    sourceType: 'OFFICIAL_GUIDANCE',
    evidenceTier: 'OFFICIAL_GUIDANCE',
    isVerbatimText: false,
    lastVerifiedDate: '2026-09-25',
    reviewAuditCycleDays: 90,
    provenance: 'LOCAL_STATIC',
    lifecycleState: 'ACTIVE',
    canonicalSourceUrl: frameworkUrl,
    verificationMethod: 'MANUAL_OFFICIAL_URL_AND_PAGE_TITLE_CHECK',
    recordRole: 'SOURCE_MAP_POINTER',
    groundingEligible: false,
    sourceMapScope: 'FRAMEWORK',
    sourceMapTopicIds: frameworkTopics.map(topic => topic.id),
    retrievalHints: ['Singapore framework', 'SFRS(I)', 'Accounting Standards Committee', 'ACRA accounting standards'],
    relatedTopicIds: [...new Set(frameworkTopics.flatMap(topic => topic.relatedTopicIds ?? []))],
    urlVerificationStatus: 'VERIFIED',
    urlVerifiedDate: '2026-09-25',
    extractionStatus: 'PARTIAL'
  };
  frameworkRecord.freshnessStatus = defaultSourceFreshnessManager.evaluateSourceFreshness(frameworkRecord, referenceDate);
  UNIFIED_SOURCE_REGISTRY.SFRSI_FRAMEWORK_ACRA = frameworkRecord;

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
