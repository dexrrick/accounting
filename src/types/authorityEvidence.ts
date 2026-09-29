import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import type {
  ReconciledSemanticQuestionIssue,
  SemanticAuthority,
  SemanticEvidenceRequirement,
  SemanticIssueReconciliation,
  SemanticPopulation,
  SemanticQuestionDomain,
  SemanticQuestionOperation,
  RequestedQuestionConcept
} from '../services/semanticQuestionUnderstanding';
import type { VerifiedEvidenceClaim } from '../verification/claimEvidenceVerifier';

export type AuthorityEvidenceStatus = 'VERIFIED' | 'INSUFFICIENT';
export type AuthorityApplicationStatus = 'NOT_REQUIRED' | 'UNRESOLVED';
export type AuthorityOverallStatus = 'VERIFIED' | 'CONDITIONAL' | 'INSUFFICIENT';

/** Canonical tax/regulatory areas used to group governing-authority workstreams. */
export type AuthorityWorkstreamDomain = SemanticQuestionDomain |
  'IRAS_CORPORATE_TAX' |
  'IRAS_EMPLOYMENT_BENEFITS' |
  'IRAS_EMPLOYER_REPORTING' |
  'IRAS_INDIVIDUAL_TAX';

export type AuthorityIssueStage =
  | 'requested'
  | 'mapped'
  | 'retrievalAttempted'
  | 'evidenceFound'
  | 'admitted'
  | 'verified'
  | 'covered';

export type AuthorityIssueLifecycle = Record<AuthorityIssueStage, boolean>;

export interface AuthorityEvidenceGap {
  issueId: string;
  authority: SemanticAuthority;
  domain: AuthorityWorkstreamDomain;
  subject: string;
  operation: SemanticQuestionOperation;
  stage: AuthorityIssueStage;
  code: string;
  reason: string;
}

export interface AuthorityIssueEvidence {
  issueId: string;
  subject: string;
  population: SemanticPopulation;
  /** Semantic issue domain before authority-specific workstream grouping. */
  domain: SemanticQuestionDomain;
  operation: SemanticQuestionOperation;
  evidenceRequirement: SemanticEvidenceRequirement;
  governingAuthority: SemanticAuthority;
  /** Coverage registry sections used to collect evidence; these are metadata, not the workstream key. */
  sourceSections: string[];
  lifecycle: AuthorityIssueLifecycle;
  evidenceStatus: AuthorityEvidenceStatus;
  applicationStatus: AuthorityApplicationStatus;
  applicationReason?: string;
  retrievalTrace?: AuthorityRetrievalTrace;
  verifiedClaims: VerifiedEvidenceClaim[];
  /** Only admitted records supporting at least one verified claim. */
  sources: AuthoritativeSourceRecord[];
  gaps: AuthorityEvidenceGap[];
}

export interface AuthorityRetrievalTrace {
  stages: Array<{
    stage: 'LOCAL_VERIFIED' | 'MAPPED_SOURCE' | 'SITEMAP_DISCOVERY' | 'OFFICIAL_DOMAIN_SEARCH' | 'INSUFFICIENT';
    status: 'SUFFICIENT' | 'ATTEMPTED' | 'EXHAUSTED' | 'SKIPPED';
    reason: string;
  }>;
  attempts?: Array<{
    topicId: string;
    fetchStatus: string;
    candidateUrl?: string;
    finalUrl?: string;
    pageTitle?: string;
    error?: string;
  }>;
}

export interface AuthorityWorkstreamResult {
  id: string;
  authority: SemanticAuthority;
  domain: AuthorityWorkstreamDomain;
  sourceSections: string[];
  populations: SemanticPopulation[];
  issues: AuthorityIssueEvidence[];
  evidenceStatus: AuthorityEvidenceStatus;
  applicationStatus: AuthorityApplicationStatus;
  verifiedClaims: VerifiedEvidenceClaim[];
  /** Only admitted records supporting at least one verified claim. */
  sources: AuthoritativeSourceRecord[];
  gaps: AuthorityEvidenceGap[];
}

export interface PlannedAuthorityWorkstream {
  id: string;
  authority: SemanticAuthority;
  domain: AuthorityWorkstreamDomain;
  sourceSections: string[];
  populations: SemanticPopulation[];
  issueIds: string[];
}

export interface AuthorityWorkstreamsResult {
  query: string;
  issuePlan: SemanticIssueReconciliation;
  workstreams: AuthorityWorkstreamResult[];
  evidenceStatus: AuthorityEvidenceStatus;
  applicationStatus: AuthorityApplicationStatus;
  status: AuthorityOverallStatus;
  gaps: AuthorityEvidenceGap[];
}

export interface AuthorityRetrievalIntent {
  topicIds: string[];
  requestedConcepts: RequestedQuestionConcept[];
}

/** Original query is preserved for every provenance, relevance, and claim check. */
export interface AuthorityEvidenceRequest {
  originalQuery: string;
  issue: ReconciledSemanticQuestionIssue;
  retrievalIntent: AuthorityRetrievalIntent;
}

export interface AuthorityEvidenceProviderResult {
  candidates: AuthoritativeSourceRecord[];
  /** Optional IRAS retrieval/admission trace; metadata fields never establish coverage. */
  trace?: AuthorityRetrievalTrace;
  /** Raw retrieval trace passed only to the existing IRAS evidence quality gate. */
  evidenceQualityTrace?: {
    path?: string;
    sourceMapIds?: string[];
    selectedRecordIds?: string[];
    finalVerifiedUrls?: string[];
    attempts?: Array<{
      topicId: string;
      sourceMapId?: string;
      fetchStatus: string;
      finalUrl?: string;
      pageTitle?: string;
      titleMatched: boolean;
      contentMatched: boolean;
    }>;
  };
  /** Claims are suggestions to the central verifier and are always revalidated. */
  claims?: VerifiedEvidenceClaim[];
  /** Provider-level failures are converted into an explicit issue gap. */
  error?: string;
}

export interface AuthorityEvidenceProvider {
  authority: SemanticAuthority;
  retrieve(request: AuthorityEvidenceRequest): Promise<AuthorityEvidenceProviderResult>;
}

/** Internal IRAS scope passed into the established grounding pipeline. */
export interface AuthorityEvidenceScope {
  authority: 'IRAS';
  domain: AuthorityWorkstreamDomain;
  topicIds: string[];
  requestedConcepts: RequestedQuestionConcept[];
  context: {
    domainId: string;
    population: SemanticPopulation;
    primarySubject: string;
    concepts: string[];
    requestedOperation: SemanticQuestionOperation;
  };
}
