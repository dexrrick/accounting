import type { StatutoryAuthority, QueryDomain } from '../types/accounting';
import { STANDARDS_REPOSITORY } from './standardsKnowledge';
import { SINGAPORE_STATUTORY_REPOSITORY } from './singaporeStatutesKnowledge';

export type SourceStatus = 'VERIFIED' | 'NEEDS_REVIEW' | 'HISTORICAL';

export type SourceType = 'AUTHORITATIVE_SOURCE' | 'OFFICIAL_GUIDANCE' | 'CURATED_SUMMARY' | 'APPLICATION_RULE';

export type EvidenceTier = 'PRIMARY_SOURCE' | 'OFFICIAL_GUIDANCE' | 'CURATED_SUMMARY' | 'APPLICATION_RULE';

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
 * Explicitly marks sourceStatus ('VERIFIED' vs 'NEEDS_REVIEW') and
 * sourceType ('AUTHORITATIVE_SOURCE' vs 'CURATED_SUMMARY' vs 'APPLICATION_RULE').
 */
export const UNIFIED_SOURCE_REGISTRY: Record<string, AuthoritativeSourceRecord> = {};

// 1. Ingest Statutory Rules from Singapore Statutes
for (const [key, rule] of Object.entries(SINGAPORE_STATUTORY_REPOSITORY)) {
  // CRITICAL PRINCIPLE:
  // Never infer primary verbatim authority from URL or text length.
  // Authority, publisher, and instrument are separated.
  // Source text must be authentic verbatim statute text, NOT a local editorial summary.
  // Unknown effective dates are undefined, NOT populated with generic fake dates.
  const hasVerbatimText = Boolean(rule.verbatimStatuteText && rule.verbatimStatuteText.trim().length > 0);
  const isVerbatim = rule.isVerbatimText === true && hasVerbatimText;
  const status: SourceStatus = isVerbatim && rule.sourceStatus === 'VERIFIED' ? 'VERIFIED' : 'NEEDS_REVIEW';
  const type: SourceType = isVerbatim && rule.sourceStatus === 'VERIFIED' ? 'AUTHORITATIVE_SOURCE' : 'CURATED_SUMMARY';
  const tier: EvidenceTier = isVerbatim && rule.sourceStatus === 'VERIFIED' ? 'PRIMARY_SOURCE' : 'CURATED_SUMMARY';

  UNIFIED_SOURCE_REGISTRY[key] = {
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
    effectiveDate: rule.effectiveDate, // Optional: undefined if unknown, NEVER hard-coded to fake dates!
    revisionDate: rule.revisionDate,
    officialSourceUrl: rule.canonicalUrl,
    domain: mapStatuteCategoryToDomain(rule.category),
    jurisdiction: 'Singapore',
    tags: rule.tags || [],
    sourceStatus: status,
    sourceType: type,
    evidenceTier: tier,
    isVerbatimText: isVerbatim
  };
}

// 2. Ingest Financial Reporting Standards from ACRA / ASC repository
for (const [key, std] of Object.entries(STANDARDS_REPOSITORY)) {
  // All standards repository entries in code are curated summaries until verbatim ASC text is ingested.
  // They are strictly tagged as NEEDS_REVIEW + CURATED_SUMMARY + CURATED_SUMMARY tier.
  // Effective date is undefined if not explicitly pinned, NEVER generic fake dates.
  UNIFIED_SOURCE_REGISTRY[key] = {
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
    effectiveDate: undefined, // Unknown/unpinned provision effective date must remain undefined!
    officialSourceUrl: 'https://www.acra.gov.sg/accountancy/accounting-standards',
    domain: 'ACCOUNTING_SFRS',
    jurisdiction: 'Singapore',
    tags: [std.standardTitle.toLowerCase(), std.paragraph.toLowerCase(), 'accounting standard', 'sfrs(i)'],
    sourceStatus: 'NEEDS_REVIEW',
    sourceType: 'CURATED_SUMMARY',
    evidenceTier: 'CURATED_SUMMARY',
    isVerbatimText: false
  };
}

/**
 * Helper to fetch all records in the registry as an array
 */
export function getAllAuthoritativeSources(): AuthoritativeSourceRecord[] {
  return Object.values(UNIFIED_SOURCE_REGISTRY);
}
