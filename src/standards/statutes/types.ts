import type { StatutoryAuthority } from '../../types/accounting';

export interface SingaporeStatuteRule {
  id: string;
  authority: StatutoryAuthority;
  authorityName: string;
  sourcePublisher?: string;
  legalOrStandardInstrument?: string;
  actTitle: string;
  actCode: string;
  sectionOrSchedule: string;
  ruleTitle: string;
  category: 'TAX_INCOME' | 'TAX_GST' | 'ACRA_COMPLIANCE' | 'CPF_PAYROLL' | 'MOM_LABOUR' | 'MAS_FINANCE' | 'CUSTOMS_TRADE';
  principle: string;
  verbatimStatuteText?: string;
  application: string;
  practicalRules: string[];
  canonicalUrl: string;
  supplementaryOfficialSources?: Array<{ title: string; url: string; authority: StatutoryAuthority }>;
  tags: string[];
  sourceStatus?: 'VERIFIED' | 'NEEDS_REVIEW' | 'HISTORICAL';
  sourceType?: 'AUTHORITATIVE_SOURCE' | 'CURATED_SUMMARY' | 'APPLICATION_RULE';
  evidenceTier?: 'PRIMARY_SOURCE' | 'OFFICIAL_GUIDANCE' | 'CURATED_SUMMARY' | 'APPLICATION_RULE';
  isVerbatimText?: boolean;
  effectiveDate?: string;
  revisionDate?: string;
  validFrom?: string;
  validTo?: string;
  lastVerifiedDate?: string;
  reviewAuditCycleDays?: number;
  supersededByRecordId?: string;
  historicalPredecessorRecordId?: string;
}
