import type { AuthorityWorkstreamResult, AuthorityWorkstreamsResult, AuthorityOverallStatus } from '../types/authorityEvidence';
import type { AuthorityEvidenceStatus, AuthorityApplicationStatus } from '../types/authorityEvidence';
import type { SemanticAuthority } from '../services/semanticQuestionUnderstanding';
import type { VerifiedEvidenceClaim } from '../verification/claimEvidenceVerifier';
import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import { getSafeOfficialUrl } from './statutoryLinkResolver';

export interface AuthorityPresentedClaim {
  text: string;
  supportKind: VerifiedEvidenceClaim['supportKind'];
  issueIds: string[];
  provenance: AuthoritativeSourceRecord['provenance'];
  validFrom?: string;
  validTo?: string;
}

export interface AuthorityPresentedSource {
  key: string;
  title: string;
  publisher: string;
  documentTitle: string;
  officialUrl?: string;
  provenance: AuthoritativeSourceRecord['provenance'];
  validFrom?: string;
  validTo?: string;
  claims: AuthorityPresentedClaim[];
}

export interface AuthorityPresentedIssue {
  id: string;
  subject: string;
  population: string;
  operation: string;
  evidenceStatus: AuthorityEvidenceStatus;
  applicationStatus: AuthorityApplicationStatus;
  applicationReason?: string;
  claims: AuthorityPresentedClaim[];
  gaps: string[];
}

export interface AuthorityPresentedWorkstream {
  id: string;
  authority: SemanticAuthority;
  authorityLabel: string;
  domain: string;
  domainLabel: string;
  evidenceStatus: AuthorityEvidenceStatus;
  applicationStatus: AuthorityApplicationStatus;
  issues: AuthorityPresentedIssue[];
  sources: AuthorityPresentedSource[];
  gaps: string[];
}

/** A render-ready, query-bound projection. This contains no new accounting synthesis. */
export interface AuthorityEvidencePresentation {
  query: string;
  status: AuthorityOverallStatus;
  evidenceStatus: AuthorityEvidenceStatus;
  applicationStatus: AuthorityApplicationStatus;
  workstreams: AuthorityPresentedWorkstream[];
  gaps: string[];
}

function authorityLabel(authority: SemanticAuthority): string {
  switch (authority) {
    case 'IRAS': return 'IRAS';
    case 'CPF': return 'CPF Board';
    case 'ACRA': return 'ACRA';
    case 'MOM': return 'Ministry of Manpower';
    case 'MAS': return 'Monetary Authority of Singapore';
    case 'ACCOUNTING_STANDARDS': return 'Singapore accounting standards';
    case 'IFRS_FOUNDATION': return 'IFRS Foundation';
    case 'SSO':
    case 'UNKNOWN': return authority === 'SSO' ? 'Singapore Statutes Online' : 'Unresolved authority';
  }
}

function domainLabel(domain: string): string {
  const labels: Record<string, string> = {
    ACCOUNTING: 'Accounting treatment',
    IRAS_INCOME_TAX: 'Income tax',
    IRAS_INDIVIDUAL_TAX: 'Individual income tax',
    IRAS_CORPORATE_TAX: 'Corporate income tax',
    IRAS_EMPLOYMENT_BENEFITS: 'Employment income and benefits',
    IRAS_EMPLOYER_REPORTING: 'Employer reporting',
    IRAS_GST: 'GST',
    IRAS_PROPERTY_TAX: 'Property tax',
    IRAS_STAMP_DUTY: 'Stamp duty',
    IRAS_OTHER: 'Other IRAS guidance',
    CPF_PAYROLL: 'CPF contributions',
    MOM_EMPLOYMENT: 'Employment requirements',
    ACRA_CORPORATE: 'Corporate filing and governance',
    MAS_FUNDS: 'Financial regulation',
    UNKNOWN: 'Unresolved topic'
  };
  return labels[domain] || domain.replaceAll('_', ' ').toLowerCase();
}

function populationLabel(population: string): string {
  const labels: Record<string, string> = {
    INDIVIDUAL: 'Individual', EMPLOYEE: 'Employee', EMPLOYER: 'Employer',
    COMPANY: 'Company', SHAREHOLDER: 'Shareholder', FUND: 'Fund',
    PROPERTY_OWNER: 'Property owner', UNKNOWN: 'Not established'
  };
  return labels[population] || population;
}

function normalizedQuery(query: string): string {
  return query.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function gapLabel(subject: string, reason: string): string {
  return `${subject}: ${reason}`;
}

function userFacingPlanGap(issue: AuthorityWorkstreamsResult['issuePlan']['issues'][number]): string {
  const reason = issue.unresolvedReason;
  const explanation = reason === 'NO_COVERAGE_TOPIC'
    ? 'No reviewed topic was resolved for this issue'
    : reason === 'UNASSIGNED_QUERY_TOPIC'
      ? 'A requested issue was not assigned to a supported topic'
      : reason === 'UNKNOWN_DOMAIN'
        ? 'The governing area is unresolved'
        : 'The material issue could not be mapped to a supported topic';
  return gapLabel(issue.subject, explanation);
}

function sourceIdentity(source: AuthoritativeSourceRecord, officialUrl?: string): string {
  const sourceId = officialUrl ? `url:${officialUrl.toLowerCase()}` : `record:${source.id}`;
  return `${sourceId}|${source.provenance}|${source.validFrom || ''}|${source.validTo || ''}`;
}

function sourceForClaim(
  claim: VerifiedEvidenceClaim,
  sources: readonly AuthoritativeSourceRecord[]
): AuthoritativeSourceRecord | undefined {
  return sources.find(source => source.id === claim.recordId);
}

function sourceMatchesAuthority(source: AuthoritativeSourceRecord, authority: SemanticAuthority): boolean {
  if (authority === 'ACCOUNTING_STANDARDS') return source.authority === 'ASC' || source.authority === 'ACRA';
  if (authority === 'IFRS_FOUNDATION') return /\bIFRS Foundation\b/i.test(source.sourcePublisher);
  if (authority === 'SSO') return source.authority === 'SSO' || source.authority === 'AGC';
  return source.authority === authority;
}

function isCovered(issue: AuthorityWorkstreamResult['issues'][number]): boolean {
  const hasClaimBackedSource = issue.verifiedClaims.some(claim => issue.sources.some(source =>
    source.id === claim.recordId && sourceMatchesAuthority(source, issue.governingAuthority)));
  return issue.evidenceStatus === 'VERIFIED' && issue.lifecycle.covered && issue.lifecycle.verified && hasClaimBackedSource;
}

function workstreamStatus(stream: AuthorityWorkstreamResult): { evidenceStatus: AuthorityEvidenceStatus; applicationStatus: AuthorityApplicationStatus } {
  const evidenceStatus = stream.issues.length > 0 && stream.issues.every(isCovered) && stream.evidenceStatus === 'VERIFIED'
    ? 'VERIFIED' : 'INSUFFICIENT';
  const applicationStatus = stream.applicationStatus === 'UNRESOLVED' ||
    stream.issues.some(issue => issue.applicationStatus === 'UNRESOLVED') ? 'UNRESOLVED' : 'NOT_REQUIRED';
  return { evidenceStatus, applicationStatus };
}

function overallStatus(result: AuthorityWorkstreamsResult): AuthorityOverallStatus {
  const everyIssueCovered = result.workstreams.length > 0 &&
    result.workstreams.every(stream => stream.issues.length > 0 && stream.issues.every(isCovered));
  const resultIssueScopes = new Set(result.workstreams.flatMap(stream => stream.issues.map(issue =>
    `${issue.issueId}|${issue.governingAuthority}|${issue.domain}`)));
  const everyPlannedIssueReturned = result.issuePlan.issues.length > 0 && result.issuePlan.issues.every(issue => {
    const authorities = issue.governingAuthorities.filter(authority => authority !== 'UNKNOWN');
    return authorities.length > 0 && authorities.every(authority =>
      resultIssueScopes.has(`${issue.id}|${authority}|${issue.domain}`));
  });
  if (!result.issuePlan.coverageEstablished || result.issuePlan.hasUnmappedResidual || !everyIssueCovered ||
      !everyPlannedIssueReturned || result.workstreams.some(stream => stream.evidenceStatus !== 'VERIFIED') || result.evidenceStatus !== 'VERIFIED') {
    return 'INSUFFICIENT';
  }
  if (result.applicationStatus === 'UNRESOLVED' || result.workstreams.some(stream =>
    stream.applicationStatus === 'UNRESOLVED' || stream.issues.some(issue => issue.applicationStatus === 'UNRESOLVED'))) {
    return 'CONDITIONAL';
  }
  return result.status === 'VERIFIED' ? 'VERIFIED' : 'INSUFFICIENT';
}

function buildWorkstream(stream: AuthorityWorkstreamResult): AuthorityPresentedWorkstream {
  const issueClaims = new Map<string, AuthorityPresentedClaim>();
  const sourceGroups = new Map<string, AuthorityPresentedSource>();
  const issueRows: AuthorityPresentedIssue[] = stream.issues.map(issue => {
    const claims: AuthorityPresentedClaim[] = [];
    for (const verifiedClaim of issue.verifiedClaims) {
      const source = sourceForClaim(verifiedClaim, issue.sources);
      if (!source || !sourceMatchesAuthority(source, issue.governingAuthority)) continue;
      const officialUrl = getSafeOfficialUrl(
        verifiedClaim.canonicalUrl || source.officialSourceUrl,
        undefined, undefined, source.authority, [source]
      ) || undefined;
      const key = sourceIdentity(source, officialUrl);
      let sourceGroup = sourceGroups.get(key);
      if (!sourceGroup) {
        sourceGroup = {
          key,
          title: source.documentTitle || source.legalOrStandardInstrument,
          publisher: source.sourcePublisher,
          documentTitle: source.documentTitle,
          ...(officialUrl ? { officialUrl } : {}),
          provenance: source.provenance,
          ...(source.validFrom ? { validFrom: source.validFrom } : {}),
          ...(source.validTo ? { validTo: source.validTo } : {}),
          claims: []
        };
        sourceGroups.set(key, sourceGroup);
      }
      // Display the verifier's whole admitted source span for exact quotes.
      // Editorial summaries are explicitly labeled and never presented as quotations.
      const text = verifiedClaim.supportKind === 'EXACT_SOURCE_QUOTE' ? verifiedClaim.quote : verifiedClaim.text;
      const identity = `${key}\n${verifiedClaim.supportKind}\n${text}`;
      let presented = issueClaims.get(identity);
      if (!presented) {
        presented = {
          text,
          supportKind: verifiedClaim.supportKind,
          issueIds: [],
          provenance: source.provenance,
          ...(source.validFrom ? { validFrom: source.validFrom } : {}),
          ...(source.validTo ? { validTo: source.validTo } : {})
        };
        issueClaims.set(identity, presented);
      }
      if (!presented.issueIds.includes(issue.issueId)) presented.issueIds.push(issue.issueId);
      if (!claims.some(candidate => candidate.text === text && candidate.supportKind === verifiedClaim.supportKind &&
        candidate.provenance === source.provenance && candidate.validFrom === source.validFrom && candidate.validTo === source.validTo)) claims.push(presented);
      const sourceClaim = sourceGroup.claims.find(candidate => candidate.text === text && candidate.supportKind === verifiedClaim.supportKind);
      if (sourceClaim) {
        if (!sourceClaim.issueIds.includes(issue.issueId)) sourceClaim.issueIds.push(issue.issueId);
      } else {
        sourceGroup.claims.push({
          text,
          supportKind: verifiedClaim.supportKind,
          issueIds: [issue.issueId],
          provenance: source.provenance,
          ...(source.validFrom ? { validFrom: source.validFrom } : {}),
          ...(source.validTo ? { validTo: source.validTo } : {})
        });
      }
    }
    return {
      id: issue.issueId,
      subject: issue.subject,
      population: populationLabel(issue.population),
      operation: issue.operation,
      evidenceStatus: issue.evidenceStatus,
      applicationStatus: issue.applicationStatus,
      ...(issue.applicationReason ? { applicationReason: issue.applicationReason } : {}),
      claims,
      gaps: issue.gaps.map(gap => gap.reason)
    };
  });
  const status = workstreamStatus(stream);
  const gaps = stream.gaps.map(gap => gapLabel(gap.subject, gap.reason));
  return {
    id: stream.id,
    authority: stream.authority,
    authorityLabel: authorityLabel(stream.authority),
    domain: stream.domain,
    domainLabel: domainLabel(stream.domain),
    ...status,
    issues: issueRows,
    sources: [...sourceGroups.values()],
    gaps
  };
}

/** Converts only admitted, claim-backed workstream results into a UI projection. */
export function createAuthorityEvidencePresentation(result: AuthorityWorkstreamsResult): AuthorityEvidencePresentation {
  const workstreams = result.workstreams.map(buildWorkstream);
  const status = overallStatus(result);
  const evidenceStatus: AuthorityEvidenceStatus = status === 'INSUFFICIENT' ? 'INSUFFICIENT' : 'VERIFIED';
  const applicationStatus = result.applicationStatus;
  const issueGaps = result.gaps.map(gap => gapLabel(gap.subject, gap.reason));
  const planGaps = result.issuePlan.issues
    .filter(issue => issue.status !== 'MAPPED')
    .map(userFacingPlanGap);
  const gaps = [...issueGaps, ...planGaps];
  return {
    query: result.query,
    status,
    evidenceStatus,
    applicationStatus,
    workstreams,
    gaps: [...new Set(gaps)]
  };
}

export function hasCurrentAuthorityEvidencePresentation(
  presentation: AuthorityEvidencePresentation | undefined,
  rawQuery: string | undefined
): presentation is AuthorityEvidencePresentation {
  return Boolean(presentation && rawQuery && normalizedQuery(presentation.query) === normalizedQuery(rawQuery));
}
