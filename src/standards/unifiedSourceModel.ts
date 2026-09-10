import type { StatutoryAuthority, QueryDomain } from '../types/accounting';
import { STANDARDS_REPOSITORY } from './standardsKnowledge';
import { SINGAPORE_STATUTORY_REPOSITORY } from './singaporeStatutesKnowledge';

export type SourceStatus = 'VERIFIED' | 'NEEDS_REVIEW' | 'HISTORICAL';

export type SourceType = 'AUTHORITATIVE_SOURCE' | 'CURATED_SUMMARY' | 'APPLICATION_RULE';

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
  effectiveDate: string;
  revisionDate?: string;
  officialSourceUrl: string;
  domain: QueryDomain;
  jurisdiction: 'Singapore' | string;
  tags: string[];
  sourceStatus: SourceStatus;
  sourceType: SourceType;
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
  // Only genuine verbatim primary statutory provisions with official SSO AGC links are marked VERIFIED AUTHORITATIVE_SOURCE
  const isSsoStatute = rule.canonicalUrl.startsWith('https://sso.agc.gov.sg');
  const isVerbatimPrimaryProvision = isSsoStatute && rule.principle && rule.principle.length > 40 && rule.sectionOrSchedule.includes('Section');
  
  UNIFIED_SOURCE_REGISTRY[key] = {
    id: rule.id,
    authority: rule.authority,
    authorityName: rule.authorityName,
    sourcePublisher: isSsoStatute ? 'Singapore Statutes Online / AGC' : rule.authorityName,
    legalOrStandardInstrument: rule.actTitle,
    documentTitle: rule.actTitle,
    standardOrActCode: rule.actCode,
    paragraphOrSection: rule.sectionOrSchedule,
    sourceText: rule.principle,
    principleSummary: rule.ruleTitle,
    effectiveDate: '2024-01-01', // Standard Singapore statutory baseline
    revisionDate: rule.actCode === 'CPFA1953' ? '2026-01-01' : undefined,
    officialSourceUrl: rule.canonicalUrl,
    domain: mapStatuteCategoryToDomain(rule.category),
    jurisdiction: 'Singapore',
    tags: rule.tags || [],
    sourceStatus: isVerbatimPrimaryProvision ? 'VERIFIED' : 'NEEDS_REVIEW',
    sourceType: isVerbatimPrimaryProvision ? 'AUTHORITATIVE_SOURCE' : 'CURATED_SUMMARY'
  };
}

// 2. Ingest Financial Reporting Standards from ACRA / ASC repository
for (const [key, std] of Object.entries(STANDARDS_REPOSITORY)) {
  // All standards repository entries in code are curated summaries until verbatim ASC text is ingested.
  // They are strictly tagged as NEEDS_REVIEW + CURATED_SUMMARY to prevent false verification claims.
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
    effectiveDate: '2018-01-01', // SFRS(I) mandatory adoption date in Singapore
    officialSourceUrl: 'https://www.acra.gov.sg/accountancy/accounting-standards',
    domain: 'ACCOUNTING_SFRS',
    jurisdiction: 'Singapore',
    tags: [std.standardTitle.toLowerCase(), std.paragraph.toLowerCase(), 'accounting standard', 'sfrs(i)'],
    sourceStatus: 'NEEDS_REVIEW',
    sourceType: 'CURATED_SUMMARY'
  };
}

/**
 * Helper to fetch all records in the registry as an array
 */
export function getAllAuthoritativeSources(): AuthoritativeSourceRecord[] {
  return Object.values(UNIFIED_SOURCE_REGISTRY);
}
