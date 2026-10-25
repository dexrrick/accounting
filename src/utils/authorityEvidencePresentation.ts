import type { AuthorityWorkstreamResult, AuthorityWorkstreamsResult, AuthorityOverallStatus } from '../types/authorityEvidence';
import type { AuthorityEvidenceStatus, AuthorityApplicationStatus } from '../types/authorityEvidence';
import type { SemanticAuthority } from '../services/semanticQuestionUnderstanding';
import type { VerifiedEvidenceClaim } from '../verification/claimEvidenceVerifier';
import type { AuthoritativeSourceRecord, VerifiedDocumentBinding } from '../standards/unifiedSourceModel';
import {
  isCurrentRequestCompletenessContext,
  type RequestCompletenessContext
} from '../services/requestCompleteness';
import { getSafeOfficialUrl } from './statutoryLinkResolver';

export interface AuthorityPresentedClaim {
  text: string;
  supportKind: VerifiedEvidenceClaim['supportKind'];
  sourceBinding?: VerifiedDocumentBinding;
  fetchedSourceBinding?: FetchedSourceBinding;
  sourceAdmissionOptions?: VerifiedEvidenceClaim['sourceAdmissionOptions'];
  issueIds: string[];
  provenance: AuthoritativeSourceRecord['provenance'];
  validFrom?: string;
  validTo?: string;
}

/** Identifies the actual fetched page revision without implying shared admission. */
export interface FetchedSourceBinding {
  recordId: string;
  documentHash: string;
  canonicalUrl: string;
  retrievedAt: string;
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

/** Keep complete-rule premises inside one verified document revision and issue. */
export function groupExactIssueClaimsByDocument(
  source: AuthorityPresentedSource,
  issueId: string
): AuthorityPresentedClaim[][] {
  const groups = new Map<string, AuthorityPresentedClaim[]>();
  for (const claim of source.claims) {
    if (!claim.issueIds.includes(issueId) || claim.supportKind !== 'EXACT_SOURCE_QUOTE' ||
        claim.provenance !== 'LIVE_EXTERNAL' || claim.validTo) continue;
    let key: string;
    if (claim.sourceBinding !== undefined) {
      const binding = validFormalSourceBinding(claim.sourceBinding);
      if (!binding) continue;
      key = JSON.stringify(['FORMAL', binding.recordId, binding.documentHash.toLowerCase(), binding.versionId]);
    } else {
      const binding = validFetchedSourceBinding(claim.fetchedSourceBinding);
      if (!binding || !source.officialUrl || binding.canonicalUrl !== source.officialUrl) continue;
      key = JSON.stringify(['FETCHED', binding.recordId, binding.documentHash.toLowerCase(),
        binding.canonicalUrl, binding.retrievedAt]);
    }
    const group = groups.get(key) || [];
    group.push(claim);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function isHexSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function validFormalSourceBinding(value: unknown): VerifiedDocumentBinding | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const binding = value as Partial<VerifiedDocumentBinding>;
  return typeof binding.recordId === 'string' && binding.recordId.trim() &&
    typeof binding.versionId === 'string' && binding.versionId.trim() &&
    isHexSha256(binding.documentHash) && isHexSha256(binding.provisionHash) &&
    Boolean(binding.sourceLocator && typeof binding.sourceLocator === 'object')
    ? binding as VerifiedDocumentBinding : undefined;
}

function validFetchedSourceBinding(value: unknown): FetchedSourceBinding | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const binding = value as Partial<FetchedSourceBinding>;
  if (typeof binding.recordId !== 'string' || !binding.recordId.trim() || !isHexSha256(binding.documentHash) ||
      typeof binding.canonicalUrl !== 'string' || typeof binding.retrievedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(binding.retrievedAt) ||
      !Number.isFinite(Date.parse(binding.retrievedAt))) return undefined;
  try {
    const url = new URL(binding.canonicalUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return undefined;
  } catch {
    return undefined;
  }
  return binding as FetchedSourceBinding;
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
  requestCompletenessContext?: RequestCompletenessContext;
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

const trustedPresentations = new WeakSet<object>();

function freezeOwnedPresentation<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeOwnedPresentation(child);
    Object.freeze(value);
  }
  return value;
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

function fetchedSourceBindingForClaim(
  claim: VerifiedEvidenceClaim,
  source: AuthoritativeSourceRecord,
  displayedOfficialUrl?: string
): FetchedSourceBinding | undefined {
  if (claim.supportKind !== 'EXACT_SOURCE_QUOTE' || claim.recordId !== source.id ||
      source.provenance !== 'LIVE_EXTERNAL' || source.validTo || !source.canonicalSourceUrl ||
      !source.retrievedAt || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(source.retrievedAt) ||
      !Number.isFinite(Date.parse(source.retrievedAt))) return undefined;

  const documentHash = source.documentHash;
  const contentHash = source.contentHash;
  if (documentHash !== undefined && !isHexSha256(documentHash) ||
      contentHash !== undefined && !isHexSha256(contentHash) ||
      documentHash !== undefined && contentHash !== undefined && documentHash.toLowerCase() !== contentHash.toLowerCase()) return undefined;
  const hash = documentHash || contentHash;
  if (!isHexSha256(hash)) return undefined;

  const canonicalUrl = getSafeOfficialUrl(source.canonicalSourceUrl, undefined, undefined, source.authority, [source]);
  if (!canonicalUrl || canonicalUrl !== displayedOfficialUrl) return undefined;
  if (claim.canonicalUrl) {
    const claimCanonicalUrl = getSafeOfficialUrl(claim.canonicalUrl, undefined, undefined, source.authority, [source]);
    if (claimCanonicalUrl !== canonicalUrl) return undefined;
  }
  return {
    recordId: source.id,
    documentHash: hash.toLowerCase(),
    canonicalUrl,
    retrievedAt: source.retrievedAt
  };
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
    stream.issues.some(issue => issue.applicationStatus === 'UNRESOLVED') ? 'UNRESOLVED'
    : stream.applicationStatus === 'VERIFIED' || stream.issues.some(issue => issue.applicationStatus === 'VERIFIED')
      ? 'VERIFIED' : 'NOT_REQUIRED';
  return { evidenceStatus, applicationStatus };
}

function overallStatus(result: AuthorityWorkstreamsResult): AuthorityOverallStatus {
  const requestRepresentationComplete = isCurrentRequestCompletenessContext(result.requestCompletenessContext, result.query) &&
    result.requestCompletenessContext.evaluation.status === 'COMPLETE';
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
  if (!requestRepresentationComplete) return 'CONDITIONAL';
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
      const bindingIdentity = verifiedClaim.sourceBinding ? JSON.stringify(verifiedClaim.sourceBinding) : '';
      const fetchedBinding = fetchedSourceBindingForClaim(verifiedClaim, source, officialUrl);
      const fetchedBindingIdentity = fetchedBinding ? JSON.stringify(fetchedBinding) : '';
      const admissionIdentity = verifiedClaim.sourceAdmissionOptions ? JSON.stringify(verifiedClaim.sourceAdmissionOptions) : '';
      const identity = `${key}\n${verifiedClaim.supportKind}\n${text}\n${bindingIdentity}\n${fetchedBindingIdentity}\n${admissionIdentity}`;
      let presented = issueClaims.get(identity);
      if (!presented) {
        presented = {
          text,
          supportKind: verifiedClaim.supportKind,
          ...(verifiedClaim.sourceBinding ? { sourceBinding: structuredClone(verifiedClaim.sourceBinding) } : {}),
          ...(fetchedBinding ? { fetchedSourceBinding: structuredClone(fetchedBinding) } : {}),
          ...(verifiedClaim.sourceAdmissionOptions ? { sourceAdmissionOptions: structuredClone(verifiedClaim.sourceAdmissionOptions) } : {}),
          issueIds: [],
          provenance: source.provenance,
          ...(source.validFrom ? { validFrom: source.validFrom } : {}),
          ...(source.validTo ? { validTo: source.validTo } : {})
        };
        issueClaims.set(identity, presented);
      }
      if (!presented.issueIds.includes(issue.issueId)) presented.issueIds.push(issue.issueId);
      if (!claims.some(candidate => candidate.text === text && candidate.supportKind === verifiedClaim.supportKind &&
        candidate.provenance === source.provenance && candidate.validFrom === source.validFrom && candidate.validTo === source.validTo &&
        JSON.stringify(candidate.sourceBinding || null) === JSON.stringify(verifiedClaim.sourceBinding || null) &&
        JSON.stringify(candidate.fetchedSourceBinding || null) === JSON.stringify(fetchedBinding || null) &&
        JSON.stringify(candidate.sourceAdmissionOptions || null) === JSON.stringify(verifiedClaim.sourceAdmissionOptions || null))) claims.push(presented);
      const sourceClaim = sourceGroup.claims.find(candidate => candidate.text === text && candidate.supportKind === verifiedClaim.supportKind &&
        JSON.stringify(candidate.sourceBinding || null) === JSON.stringify(verifiedClaim.sourceBinding || null) &&
        JSON.stringify(candidate.fetchedSourceBinding || null) === JSON.stringify(fetchedBinding || null) &&
        JSON.stringify(candidate.sourceAdmissionOptions || null) === JSON.stringify(verifiedClaim.sourceAdmissionOptions || null));
      if (sourceClaim) {
        if (!sourceClaim.issueIds.includes(issue.issueId)) sourceClaim.issueIds.push(issue.issueId);
      } else {
        sourceGroup.claims.push({
          text,
          supportKind: verifiedClaim.supportKind,
          ...(verifiedClaim.sourceBinding ? { sourceBinding: structuredClone(verifiedClaim.sourceBinding) } : {}),
          ...(fetchedBinding ? { fetchedSourceBinding: structuredClone(fetchedBinding) } : {}),
          ...(verifiedClaim.sourceAdmissionOptions ? { sourceAdmissionOptions: structuredClone(verifiedClaim.sourceAdmissionOptions) } : {}),
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
  const requestCompletenessContext = isCurrentRequestCompletenessContext(result.requestCompletenessContext, result.query)
    ? result.requestCompletenessContext : undefined;
  const presentation: AuthorityEvidencePresentation = {
    query: result.query,
    ...(requestCompletenessContext ? { requestCompletenessContext } : {}),
    status,
    evidenceStatus,
    applicationStatus,
    workstreams,
    gaps: [...new Set(gaps)]
  };
  const frozen = freezeOwnedPresentation(presentation);
  if (requestCompletenessContext) trustedPresentations.add(frozen as object);
  return frozen;
}

/** True only when the presentation carries a trusted, exact-query COMPLETE evaluation. */
export function hasCompleteRequestRepresentation(presentation: AuthorityEvidencePresentation): boolean {
  return isCurrentRequestCompletenessContext(presentation.requestCompletenessContext, presentation.query) &&
    presentation.requestCompletenessContext.evaluation.status === 'COMPLETE';
}

export function hasCurrentAuthorityEvidencePresentation(
  presentation: AuthorityEvidencePresentation | undefined,
  rawQuery: string | undefined
): presentation is AuthorityEvidencePresentation {
  return Boolean(presentation && rawQuery && trustedPresentations.has(presentation as object) &&
    presentation.query === rawQuery &&
    isCurrentRequestCompletenessContext(presentation.requestCompletenessContext, rawQuery));
}
