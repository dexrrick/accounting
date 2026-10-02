import type { StatutoryAuthority, QueryDomain } from '../types/accounting';
import type {
  AuthorityApplicationStatus,
  AuthorityEvidenceGap,
  AuthorityEvidenceProvider,
  AuthorityEvidenceProviderResult,
  AuthorityEvidenceRequest,
  AuthorityEvidenceScope,
  AuthorityEvidenceStatus,
  AuthorityIssueEvidence,
  AuthorityIssueLifecycle,
  AuthorityOverallStatus,
  AuthorityRetrievalTrace,
  AuthorityWorkstreamDomain,
  AuthorityWorkstreamResult,
  AuthorityWorkstreamsResult,
  PlannedAuthorityWorkstream
} from '../types/authorityEvidence';
import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import { getCoverageTopicsByIds, type SingaporeCoverageTopic } from '../standards/coverageRegistry';
import { defaultAdvancedSourceRetriever } from '../retrieval/advancedSourceRetriever';
import type { ISourceRetriever } from '../retrieval/sourceRetriever';
import { defaultTargetDateResolver, TargetDateResolver } from '../retrieval/targetDateResolver';
import {
  evaluateEvidenceQuality,
  matchesReviewedLocalRegistryRecord,
  matchesRequestedQuestionConcept
} from '../retrieval/evidenceQualityGate';
import {
  findRecordEligibilityRejection,
  verifyEvidenceClaims,
  type VerifiedEvidenceClaim
} from '../verification/claimEvidenceVerifier';
import {
  buildGroundedReasoningContext,
  type MappedFallbackOptions,
  type SourceMapFallbackTrace
} from './groundingContextBuilder';
import { renderIrasEvidenceResponse } from './irasEvidencePolicy';
import {
  canonicalAccountingWorkstreamAuthority,
  getRequestedQuestionConcepts,
  type ReconciledSemanticQuestionIssue,
  type SemanticAuthority,
  type SemanticIssueReconciliation,
  type SemanticPopulation,
  type SemanticQuestionUnderstanding,
  type RequestedQuestionConcept
} from './semanticQuestionUnderstanding';

const SUPPORTED_LOCAL_AUTHORITIES = new Set<SemanticAuthority>([
  'ACCOUNTING_STANDARDS', 'ACRA', 'CPF', 'MOM', 'MAS'
]);

const GENERIC_SUPPORT_WORDS = new Set([
  'about', 'account', 'accounts', 'applicable', 'application', 'authority', 'based', 'business', 'businesses',
  'case', 'company', 'companies', 'condition', 'conditions', 'contribution', 'contributions', 'corporate',
  'determined', 'employee', 'employees', 'employer', 'employers', 'employment', 'entity', 'entities', 'for',
  'from', 'general', 'guidance', 'how', 'income', 'individual', 'information', 'issue', 'law', 'legal', 'local',
  'must', 'official', 'organization', 'person', 'persons', 'relevant', 'requirement', 'requirements', 'rule',
  'rules', 'singapore', 'source', 'standard', 'standards', 'subject', 'support', 'tax', 'taxes', 'that', 'the',
  'their', 'this', 'treatment', 'under', 'when', 'whether', 'which', 'with', 'work', 'worker', 'workers'
]);

export interface AuthorityWorkstreamOptions {
  retriever?: ISourceRetriever;
  /** Grounding controls for the IRAS adapter. Per-issue evidence scope is always supplied internally. */
  groundingOptions?: Omit<MappedFallbackOptions, 'evidenceScope' | 'questionUnderstanding' | 'semanticDiscoveryQuery'>;
  questionUnderstanding?: SemanticQuestionUnderstanding;
  providers?: Partial<Record<SemanticAuthority, AuthorityEvidenceProvider>>;
  localOnly?: boolean;
  referenceDate?: string;
}

interface PlannedIssue {
  issue: ReconciledSemanticQuestionIssue;
  topicIds: string[];
  sourceSections: string[];
}

interface InternalPlan extends PlannedAuthorityWorkstream {
  issuePlans: PlannedIssue[];
}

function workstreamId(authority: SemanticAuthority, domain: AuthorityWorkstreamDomain): string {
  return `${authority}:${domain}`;
}

function sourceDomainMatchesAuthority(topic: SingaporeCoverageTopic, authority: SemanticAuthority): boolean {
  if (authority === 'ACCOUNTING_STANDARDS') return topic.domainId.startsWith('ACCOUNTING_');
  return topic.authorities.includes(authority as StatutoryAuthority);
}

function irasDomainForTopic(topic: SingaporeCoverageTopic, population: SemanticPopulation): AuthorityWorkstreamDomain {
  switch (topic.domainId) {
    case 'IRAS_CORPORATE_TAX': return 'IRAS_CORPORATE_TAX';
    case 'IRAS_INDIVIDUAL_TAX': return 'IRAS_INDIVIDUAL_TAX';
    case 'IRAS_EMPLOYER_TAX':
      if (topic.id === 'iras-ais-employment-income' || topic.id === 'iras-employer-ir21') return 'IRAS_EMPLOYER_REPORTING';
      if (topic.id === 'iras-employment-benefits' || topic.id === 'iras-employee-bonus-timing' || topic.id === 'iras-stock-options') return 'IRAS_EMPLOYMENT_BENEFITS';
      if (population === 'EMPLOYER') return 'IRAS_EMPLOYER_REPORTING';
      if (population === 'EMPLOYEE') return 'IRAS_EMPLOYMENT_BENEFITS';
      return 'UNKNOWN';
    case 'IRAS_GST': return 'IRAS_GST';
    case 'IRAS_PROPERTY_TAX': return 'IRAS_PROPERTY_TAX';
    case 'IRAS_STAMP_DUTY': return 'IRAS_STAMP_DUTY';
    default: return 'UNKNOWN';
  }
}

function canonicalDomainForIssue(
  issue: ReconciledSemanticQuestionIssue,
  authority: SemanticAuthority,
  topics: SingaporeCoverageTopic[]
): AuthorityWorkstreamDomain {
  if (authority !== 'IRAS') return issue.domain;
  const mappedAreas = [...new Set(topics.map(topic => irasDomainForTopic(topic, issue.population)).filter(area => area !== 'UNKNOWN'))];
  if (mappedAreas.length === 1) return mappedAreas[0];
  if (mappedAreas.length > 1) return 'UNKNOWN';
  if (issue.domain === 'IRAS_GST' || issue.domain === 'IRAS_PROPERTY_TAX' || issue.domain === 'IRAS_STAMP_DUTY') return issue.domain;
  if (issue.domain !== 'IRAS_INCOME_TAX') return 'UNKNOWN';

  // Without a mapped topic, use only an explicit subject clue. Population is
  // insufficient to distinguish an employee's personal tax from benefit tax,
  // or to identify who is responsible for an ambiguous reporting request.
  const subject = issue.subject.toLowerCase();
  const explicitReporting = /\b(?:report(?:ing)?|filings?|ais|ir21|tax clearance|withholding)\b/.test(subject);
  const employmentReportingSubject = /\b(?:employee|staff|employment income|foreign worker|workforce)\b/.test(subject);
  const explicitEmployerReporting = explicitReporting && (
    /\bemployer\b/.test(subject) || /\b(?:company|business)\b/.test(subject) && employmentReportingSubject
  );
  const companyDeduction = /\b(?:company|corporate|business)\b/.test(subject) &&
    /\b(?:deductibility|deductible|deduction|chargeable income|taxable profits?)\b/.test(subject);
  const personalRelief = /\b(?:personal|individual)\s+(?:income\s+)?tax\s+relief\b|\b(?:tax|cpf|srs) relief\b/.test(subject);
  const benefitSubject = /\b(?:benefits?|perquisites?|accommodation|housing allowance|reimbursements?|stock options?|bonus)\b/.test(subject);
  const employeeIsTaxSubject = issue.population === 'EMPLOYEE' ||
    /\b(?:benefit|accommodation|housing allowance|perquisite)\b[^.!?]{0,45}\b(?:for|to) (?:the )?employee\b|\b(?:for|to) (?:the )?employee\b[^.!?]{0,45}\b(?:benefit|accommodation|housing allowance|perquisite)\b/.test(subject);
  const explicitEmployeeTaxOutcome = /\b(?:taxability|taxable|taxed|tax treatment|tax liability)\b[^.!?]{0,55}\b(?:to|for) (?:the )?employee\b|\b(?:employee(?:'s)?|employee personal)\b[^.!?]{0,55}\b(?:taxability|tax treatment|tax liability|taxable|taxed)\b/.test(subject);
  const employeeBenefitTaxOutcome = companyDeduction
    ? explicitEmployeeTaxOutcome
    : /\b(?:tax|taxable|taxability|income)\b/.test(subject);
  const employeeBenefit = benefitSubject && employeeIsTaxSubject && employeeBenefitTaxOutcome;
  const personalSalaryTax = /\b(?:salary|wages?|employment income)\b/.test(subject) &&
    /\b(?:personal|individual|employee|salary|wages?|employment income)\b/.test(subject);

  const explicitAreas = [
    explicitEmployerReporting && 'IRAS_EMPLOYER_REPORTING',
    companyDeduction && 'IRAS_CORPORATE_TAX',
    personalRelief && 'IRAS_INDIVIDUAL_TAX',
    employeeBenefit && 'IRAS_EMPLOYMENT_BENEFITS'
  ].filter((area): area is AuthorityWorkstreamDomain => Boolean(area));
  const distinctExplicitAreas = [...new Set(explicitAreas)];
  if (distinctExplicitAreas.length > 1) return 'UNKNOWN';
  if (distinctExplicitAreas.length === 1) return distinctExplicitAreas[0];

  if (personalSalaryTax || issue.population === 'INDIVIDUAL') return 'IRAS_INDIVIDUAL_TAX';
  if (issue.population === 'COMPANY' || issue.population === 'FUND') return 'IRAS_CORPORATE_TAX';
  return 'UNKNOWN';
}

function topicMatchesCanonicalWorkstream(topic: SingaporeCoverageTopic, authority: SemanticAuthority, domain: AuthorityWorkstreamDomain): boolean {
  if (!sourceDomainMatchesAuthority(topic, authority)) return false;
  if (authority !== 'IRAS') return true;
  const topicArea = irasDomainForTopic(topic, domain === 'IRAS_EMPLOYER_REPORTING' ? 'EMPLOYER' : 'EMPLOYEE');
  return topicArea === domain;
}

function toInternalPlan(issuePlan: SemanticIssueReconciliation): InternalPlan[] {
  const grouped = new Map<string, InternalPlan>();
  for (const issue of issuePlan.issues) {
    // An unassigned topic records taxonomy residue and an evidence gap. It is
    // not a requested workstream from the validated semantic interpretation.
    if (issue.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC') continue;
    const allTopics = getCoverageTopicsByIds(issue.mappedTopicIds);
    const authorities = [...new Set(issue.governingAuthorities
      .map(authority => canonicalAccountingWorkstreamAuthority(issue.domain, authority))
      .filter(authority => authority !== 'UNKNOWN'))];
    for (const authority of authorities) {
      const authorityTopics = allTopics.filter(topic => sourceDomainMatchesAuthority(topic, authority));
      const domain = canonicalDomainForIssue(issue, authority, authorityTopics);
      const topicIds = authorityTopics.filter(topic => topicMatchesCanonicalWorkstream(topic, authority, domain)).map(topic => topic.id);
      const sourceSections = [...new Set(getCoverageTopicsByIds(topicIds).map(topic => topic.domainId))];
      const id = workstreamId(authority, domain);
      const current = grouped.get(id) || {
        id,
        authority,
        domain,
        sourceSections: [],
        populations: [],
        issueIds: [],
        issuePlans: []
      };
      current.sourceSections = [...new Set([...current.sourceSections, ...sourceSections])];
      current.populations = [...new Set([...current.populations, issue.population])];
      current.issueIds.push(issue.id);
      current.issuePlans.push({ issue, topicIds, sourceSections });
      grouped.set(id, current);
    }
  }
  return [...grouped.values()];
}

/** Creates the stable governor + canonical area plan; contextual authorities are ignored. */
export function planAuthorityWorkstreams(issuePlan: SemanticIssueReconciliation): PlannedAuthorityWorkstream[] {
  return toInternalPlan(issuePlan).map(({ issuePlans: _issuePlans, ...plan }) => plan);
}

function topiclessConceptBelongsToIssue(concept: RequestedQuestionConcept, issue: ReconciledSemanticQuestionIssue, authority: SemanticAuthority): boolean {
  if (authority !== 'IRAS' || issue.domain !== 'IRAS_INCOME_TAX') return false;
  if (concept.id === 'relief_claim_prioritization') {
    return issue.population === 'INDIVIDUAL' || issue.population === 'EMPLOYEE' ||
      issue.mappedTopicIds.some(id => id.startsWith('iras-individual-'));
  }
  const issueText = `${issue.subject} ${issue.mappedTopicIds.join(' ')}`;
  const uniqueTerms = [...new Set([...concept.terms, concept.label].flatMap(distinctiveTerms))];
  const normalizedIssue = new Set(normalizeEvidenceText(issueText).split(' ').map(normalizeWord));
  return uniqueTerms.length > 0 && uniqueTerms.filter(term => normalizedIssue.has(term)).length >= Math.min(2, uniqueTerms.length);
}

function requestedConceptsForIssue(query: string, issue: ReconciledSemanticQuestionIssue, authority: SemanticAuthority, topicIds: string[], understanding?: SemanticQuestionUnderstanding): RequestedQuestionConcept[] {
  const topicSet = new Set(topicIds);
  return getRequestedQuestionConcepts(query, understanding).filter(concept =>
    concept.topicIds.some(topicId => topicSet.has(topicId)) ||
    concept.topicIds.length === 0 && topiclessConceptBelongsToIssue(concept, issue, authority)
  );
}

function sourceQueryDomain(topicIds: string[]): QueryDomain | undefined {
  const topics = getCoverageTopicsByIds(topicIds);
  const domains = [...new Set(topics.flatMap(topic => topic.legacyDomains))];
  return domains.length === 1 ? domains[0] : undefined;
}

function retrievalAuthority(authority: SemanticAuthority): StatutoryAuthority | undefined {
  if (authority === 'ACCOUNTING_STANDARDS') return 'ACRA';
  if (authority === 'IRAS' || authority === 'ACRA' || authority === 'CPF' || authority === 'MOM' || authority === 'MAS') return authority;
  return undefined;
}

function issueScope(issue: ReconciledSemanticQuestionIssue, plan: InternalPlan, topicIds: string[], concepts: RequestedQuestionConcept[]): AuthorityEvidenceScope | undefined {
  if (plan.authority !== 'IRAS') return undefined;
  const sourceDomain = getCoverageTopicsByIds(topicIds)[0]?.domainId;
  if (!sourceDomain) return undefined;
  return {
    authority: 'IRAS',
    domain: plan.domain,
    topicIds,
    requestedConcepts: concepts,
    context: {
      domainId: sourceDomain,
      population: issue.population,
      primarySubject: issue.subject,
      concepts: [issue.subject],
      requestedOperation: issue.operation
    }
  };
}

function mapSourceMapTrace(trace?: SourceMapFallbackTrace): AuthorityRetrievalTrace | undefined {
  if (!trace) return undefined;
  const stages = (trace.stages || []).map(stage => ({
    stage: stage.stage,
    status: stage.status,
    reason: stage.status === 'SKIPPED'
      ? 'This retrieval stage was skipped by the configured scope.'
      : stage.status === 'SUFFICIENT'
        ? 'The stage supplied reviewed evidence candidates.'
        : stage.status === 'ATTEMPTED'
          ? 'The stage was attempted and requires evidence admission.'
          : 'The stage was exhausted without sufficient admitted evidence.'
  }));
  return {
    stages,
    attempts: trace.attempts.map(attempt => ({
      topicId: attempt.topicId,
      fetchStatus: attempt.fetchStatus,
      ...(attempt.pageTitle ? { pageTitle: attempt.pageTitle } : {})
    }))
  };
}

function getDefaultTrace(hasCandidates: boolean): AuthorityRetrievalTrace {
  return {
    stages: [
      { stage: 'LOCAL_VERIFIED', status: hasCandidates ? 'ATTEMPTED' : 'EXHAUSTED', reason: hasCandidates ? 'Reviewed local records were retrieved for admission.' : 'No reviewed local records were retrieved.' },
      { stage: 'MAPPED_SOURCE', status: 'SKIPPED', reason: 'This provider is bounded to reviewed local evidence.' },
      { stage: 'SITEMAP_DISCOVERY', status: 'SKIPPED', reason: 'This provider is bounded to reviewed local evidence.' },
      { stage: 'OFFICIAL_DOMAIN_SEARCH', status: 'SKIPPED', reason: 'This provider is bounded to reviewed local evidence.' }
    ]
  };
}

function safeProviderTrace(value: unknown, hasCandidates: boolean): AuthorityRetrievalTrace {
  if (!value || typeof value !== 'object' || !Array.isArray((value as AuthorityRetrievalTrace).stages)) {
    return getDefaultTrace(hasCandidates);
  }
  const allowedStages = new Set(['LOCAL_VERIFIED', 'MAPPED_SOURCE', 'SITEMAP_DISCOVERY', 'OFFICIAL_DOMAIN_SEARCH', 'INSUFFICIENT']);
  const allowedStatuses = new Set(['SUFFICIENT', 'ATTEMPTED', 'EXHAUSTED', 'SKIPPED']);
  const stages = (value as AuthorityRetrievalTrace).stages.filter(item =>
    item && allowedStages.has(item.stage) && allowedStatuses.has(item.status)
  ).map(item => ({
    stage: item.stage,
    status: item.status,
    reason: item.status === 'SKIPPED' ? 'This retrieval stage was skipped by the configured scope.'
      : item.status === 'SUFFICIENT' ? 'The stage supplied reviewed evidence candidates.'
        : item.status === 'ATTEMPTED' ? 'The stage was attempted and requires evidence admission.'
          : 'The stage was exhausted without sufficient admitted evidence.'
  }));
  if (stages.length === 0) return getDefaultTrace(hasCandidates);
  const attempts = Array.isArray((value as AuthorityRetrievalTrace).attempts)
    ? (value as AuthorityRetrievalTrace).attempts!.filter(item => item && typeof item.topicId === 'string' && typeof item.fetchStatus === 'string')
      .map(item => ({ topicId: item.topicId.slice(0, 120), fetchStatus: item.fetchStatus.slice(0, 80),
        ...(typeof item.pageTitle === 'string' ? { pageTitle: item.pageTitle.slice(0, 180) } : {}) }))
    : undefined;
  return { stages, ...(attempts ? { attempts } : {}) };
}

function safeEvidenceQualityTrace(value: unknown): SourceMapFallbackTrace | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const trace = value as SourceMapFallbackTrace;
  if (!Array.isArray(trace.attempts) || trace.attempts.some(attempt =>
    !attempt || typeof attempt.topicId !== 'string' || typeof attempt.fetchStatus !== 'string' ||
    typeof attempt.titleMatched !== 'boolean' || typeof attempt.contentMatched !== 'boolean'
  )) return undefined;
  return trace;
}

function defaultLocalProvider(authority: SemanticAuthority, retriever: ISourceRetriever, referenceDate: string): AuthorityEvidenceProvider {
  return {
    authority,
    async retrieve(request: AuthorityEvidenceRequest): Promise<AuthorityEvidenceProviderResult> {
      const retrieverAuthority = authority ? retrievalAuthority(authority) : undefined;
      const topics = getCoverageTopicsByIds(request.retrievalIntent.topicIds);
      const domain = sourceQueryDomain(request.retrievalIntent.topicIds);
      if (!authority || !retrieverAuthority || topics.length === 0 || !domain) return { candidates: [], trace: getDefaultTrace(false) };
      const candidates = await retriever.retrieveSources({
        query: request.originalQuery,
        domain,
        authorities: [retrieverAuthority],
        topicIds: request.retrievalIntent.topicIds,
        requestedConcepts: request.retrievalIntent.requestedConcepts,
        maxResults: 40,
        referenceDate
      });
      return { candidates, trace: getDefaultTrace(candidates.length > 0) };
    }
  };
}

function defaultIrasProvider(
  query: string,
  plan: InternalPlan,
  options: AuthorityWorkstreamOptions,
  retriever: ISourceRetriever,
  understanding: SemanticQuestionUnderstanding,
  referenceDate: string
): AuthorityEvidenceProvider {
  return {
    authority: 'IRAS',
    async retrieve(request: AuthorityEvidenceRequest): Promise<AuthorityEvidenceProviderResult> {
      const scope = issueScope(request.issue, plan, request.retrievalIntent.topicIds, request.retrievalIntent.requestedConcepts);
      if (!scope) return { candidates: [], trace: getDefaultTrace(false) };
      const groundingContext = await buildGroundedReasoningContext(
        query,
        null,
        retriever,
        undefined,
        {
          ...options.groundingOptions,
          localOnly: options.localOnly ?? options.groundingOptions?.localOnly,
          referenceDate,
          questionUnderstanding: understanding,
          evidenceScope: scope,
          fetchOptions: options.groundingOptions?.fetchOptions
        }
      );
      const quality = groundingContext.evidenceQuality;
      if (!quality) return { candidates: [], trace: mapSourceMapTrace(groundingContext.sourceMapFallbackTrace) };
      const rendered = renderIrasEvidenceResponse({}, groundingContext, query, null, 'SFRS_I', 'LOCAL');
      return {
        candidates: quality.eligibleRecords,
        claims: rendered.claimVerification.accepted,
        trace: mapSourceMapTrace(groundingContext.sourceMapFallbackTrace),
        evidenceQualityTrace: groundingContext.sourceMapFallbackTrace
      };
    }
  };
}

function normalizeEvidenceText(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9%]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeWord(value: string): string {
  if (value.endsWith('ies') && value.length > 4) return `${value.slice(0, -3)}y`;
  if (/(?:sses|shes|ches|xes|zes)$/.test(value) && value.length > 4) return value.slice(0, -2);
  if (value.endsWith('s') && !value.endsWith('ss') && value.length > 4) return value.slice(0, -1);
  if (value.endsWith('ing') && value.length > 6) return value.slice(0, -3);
  return value;
}

function distinctiveTerms(value: string): string[] {
  return [...new Set(normalizeEvidenceText(value).split(' ')
    .filter(word => word.length >= 4 && !GENERIC_SUPPORT_WORDS.has(word) && !GENERIC_SUPPORT_WORDS.has(normalizeWord(word)))
    .map(normalizeWord))];
}

function textSupportsPhrase(text: string, phrase: string): boolean {
  const terms = distinctiveTerms(phrase);
  if (terms.length === 0) return false;
  const normalized = new Set(normalizeEvidenceText(text).split(' ').map(normalizeWord));
  const matches = terms.filter(term => normalized.has(term)).length;
  return matches >= Math.min(2, Math.ceil(terms.length * 0.6));
}

function textSupportsTopic(text: string, topic: SingaporeCoverageTopic): boolean {
  return [topic.title, ...(topic.aliases || []), ...topic.keywords].some(phrase => textSupportsPhrase(text, phrase));
}

function topicBoundToRecord(record: AuthoritativeSourceRecord, topic: SingaporeCoverageTopic): boolean {
  return topic.sourceRecordIds.includes(record.id) ||
    (record.tags || []).includes(topic.id) ||
    (record.relatedTopicIds || []).includes(topic.id) ||
    (record.sourceMapTopicIds || []).includes(topic.id) ||
    (record.retrievalHints || []).includes(topic.id);
}

function recordMatchesGovernorAndDomain(record: AuthoritativeSourceRecord, authority: SemanticAuthority, topic: SingaporeCoverageTopic): boolean {
  if (!topic.legacyDomains.includes(record.domain)) return false;
  if (authority === 'ACCOUNTING_STANDARDS') {
    return topic.domainId.startsWith('ACCOUNTING_') && record.domain === 'ACCOUNTING_SFRS' &&
      record.authority === 'ACRA' && /\bacra\b/i.test(record.sourcePublisher);
  }
  return record.authority === authority;
}

function eligibleLocalRecords(
  records: AuthoritativeSourceRecord[],
  issue: ReconciledSemanticQuestionIssue,
  authority: SemanticAuthority,
  topics: SingaporeCoverageTopic[],
  targetDate: string | undefined,
  referenceDate: string
): { admitted: AuthoritativeSourceRecord[]; rejectedCount: number } {
  const admitted: AuthoritativeSourceRecord[] = [];
  let rejectedCount = 0;
  for (const record of new Map(records.map(item => [item.id, item])).values()) {
    if (!matchesReviewedLocalRegistryRecord(record) || record.provenance !== 'LOCAL_STATIC' ||
        record.recordRole === 'SOURCE_MAP_POINTER' || record.groundingEligible === false ||
        !record.sourceText?.trim() || findRecordEligibilityRejection(record, targetDate, referenceDate)) {
      rejectedCount += 1;
      continue;
    }
    const matchingTopic = topics.find(topic => topicBoundToRecord(record, topic) &&
      recordMatchesGovernorAndDomain(record, authority, topic) && textSupportsTopic(record.sourceText, topic) &&
      textSupportsPhrase(record.sourceText, issue.subject));
    if (!matchingTopic) {
      rejectedCount += 1;
      continue;
    }
    admitted.push(record);
  }
  return { admitted, rejectedCount };
}

function ruleClaimsForRecords(records: AuthoritativeSourceRecord[]): Array<{ kind: 'RULE'; text: string; quote: string; recordId: string; citationUrl?: string }> {
  const claims: Array<{ kind: 'RULE'; text: string; quote: string; recordId: string; citationUrl?: string }> = [];
  for (const record of records) {
    const quoteCandidates = [...new Set([record.sourceText.trim(), ...record.sourceText
      .split(/\r?\n[\t ]*\r?\n+/).map(block => block.trim()).filter(Boolean)])];
    for (const quote of quoteCandidates) claims.push({
      kind: 'RULE', text: quote, quote, recordId: record.id
    });
  }
  return claims;
}

function issueClaimCoverage(
  claims: VerifiedEvidenceClaim[],
  records: AuthoritativeSourceRecord[],
  topics: SingaporeCoverageTopic[],
  concepts: RequestedQuestionConcept[],
  issue: ReconciledSemanticQuestionIssue
): { covered: boolean; missing: string[] } {
  const missing: string[] = [];
  const recordById = new Map(records.map(record => [record.id, record]));
  for (const topic of topics) {
    const topicClaim = claims.some(claim => {
      const record = recordById.get(claim.recordId);
      return Boolean(record && topicBoundToRecord(record, topic) &&
        textSupportsTopic(claim.quote, topic) && textSupportsPhrase(claim.quote, issue.subject));
    });
    if (!topicClaim) missing.push(`topic:${topic.id}`);
  }
  for (const concept of concepts) {
    const conceptClaim = claims.some(claim =>
      issue.domain === 'IRAS_INCOME_TAX'
        ? matchesRequestedQuestionConcept(claim.quote, concept)
        : [concept.label, ...concept.terms].some(term => textSupportsPhrase(claim.quote, term)) && textSupportsPhrase(claim.quote, issue.subject));
    if (!conceptClaim) missing.push(`concept:${concept.id}`);
  }
  return { covered: topics.length > 0 && missing.length === 0, missing };
}

function initialLifecycle(issue: ReconciledSemanticQuestionIssue, mapped: boolean): AuthorityIssueLifecycle {
  return {
    requested: true,
    mapped: issue.status === 'MAPPED' && mapped,
    retrievalAttempted: false,
    evidenceFound: false,
    admitted: false,
    verified: false,
    covered: false
  };
}

function applicationForIssue(issue: ReconciledSemanticQuestionIssue): { status: AuthorityApplicationStatus; reason?: string } {
  const needsCaseFacts = issue.evidenceRequirement === 'CASE_FACTS' ||
    issue.evidenceRequirement === 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' ||
    issue.evidenceRequirement === 'UNRESOLVED' && ['DETERMINE_TREATMENT', 'CHECK_ELIGIBILITY', 'CALCULATE', 'PREPARE_JOURNAL'].includes(issue.operation);
  if (!needsCaseFacts) return { status: 'NOT_REQUIRED' };
  return {
    status: 'UNRESOLVED',
    reason: `For ${issue.subject}, case-specific treatment or calculation has not been verified. The relevant facts and statutory conditions still need to be established.`
  };
}

function makeGap(
  issue: ReconciledSemanticQuestionIssue,
  authority: SemanticAuthority,
  domain: AuthorityWorkstreamDomain,
  stage: AuthorityEvidenceGap['stage'],
  code: string,
  reason: string
): AuthorityEvidenceGap {
  return { issueId: issue.id, authority, domain, subject: issue.subject, operation: issue.operation, stage, code, reason };
}

async function evaluateIssue(
  query: string,
  plan: InternalPlan,
  plannedIssue: PlannedIssue,
  options: AuthorityWorkstreamOptions,
  retriever: ISourceRetriever,
  understanding: SemanticQuestionUnderstanding,
  referenceDate: string
): Promise<AuthorityIssueEvidence> {
  const issue = plannedIssue.issue;
  const topicIds = plannedIssue.topicIds;
  const topics = getCoverageTopicsByIds(topicIds);
  const evidenceTopics = plan.authority === 'IRAS' ? topics.filter(topic => !topic.routingOnly) : topics;
  const evidenceTopicIds = evidenceTopics.map(topic => topic.id);
  const concepts = requestedConceptsForIssue(query, issue, plan.authority, topicIds, understanding);
  const mapped = topicIds.length > 0 && plan.domain !== 'UNKNOWN';
  const lifecycle = initialLifecycle(issue, mapped);
  const application = applicationForIssue(issue);
  const base: Omit<AuthorityIssueEvidence, 'evidenceStatus' | 'verifiedClaims' | 'sources' | 'gaps'> = {
    issueId: issue.id,
    subject: issue.subject,
    population: issue.population,
    domain: issue.domain,
    operation: issue.operation,
    evidenceRequirement: issue.evidenceRequirement,
    governingAuthority: plan.authority,
    sourceSections: plannedIssue.sourceSections,
    lifecycle,
    applicationStatus: application.status,
    ...(application.reason ? { applicationReason: application.reason } : {})
  };
  const gaps: AuthorityEvidenceGap[] = [];
  if (issue.status !== 'MAPPED' || !mapped) {
    gaps.push(makeGap(issue, plan.authority, plan.domain, 'mapped', issue.unresolvedReason || (plan.domain === 'UNKNOWN' ? 'CANONICAL_AREA_UNRESOLVED' : 'ISSUE_UNMAPPED'),
      'The issue has no resolved authority and topic mapping for this workstream.'));
    return { ...base, evidenceStatus: 'INSUFFICIENT', verifiedClaims: [], sources: [], gaps };
  }

  const request: AuthorityEvidenceRequest = {
    originalQuery: query,
    issue,
    retrievalIntent: { topicIds, requestedConcepts: concepts }
  };
  const provider = options.providers?.[plan.authority] || (plan.authority === 'IRAS'
    ? defaultIrasProvider(query, plan, options, retriever, understanding, referenceDate)
    : SUPPORTED_LOCAL_AUTHORITIES.has(plan.authority) ? defaultLocalProvider(plan.authority, retriever, referenceDate) : undefined);
  if (!provider || plan.domain === 'UNKNOWN') {
    gaps.push(makeGap(issue, plan.authority, plan.domain, 'retrievalAttempted', 'PROVIDER_UNAVAILABLE',
      'No evidence provider is available for this authority and mapped area.'));
    return { ...base, evidenceStatus: 'INSUFFICIENT', verifiedClaims: [], sources: [], gaps,
      retrievalTrace: getDefaultTrace(false) };
  }
  if (provider.authority !== plan.authority) {
    gaps.push(makeGap(issue, plan.authority, plan.domain, 'retrievalAttempted', 'PROVIDER_AUTHORITY_MISMATCH',
      'The configured provider does not match this workstream authority.'));
    return { ...base, evidenceStatus: 'INSUFFICIENT', verifiedClaims: [], sources: [], gaps,
      retrievalTrace: getDefaultTrace(false) };
  }

  lifecycle.retrievalAttempted = true;
  let providerResult: AuthorityEvidenceProviderResult;
  try {
    const rawResult: unknown = await provider.retrieve(request);
    const candidateResult = rawResult as AuthorityEvidenceProviderResult | undefined;
    const candidatesAreValid = Array.isArray(candidateResult?.candidates) && candidateResult.candidates.every(record =>
      record && typeof record.id === 'string' && typeof record.authority === 'string' && typeof record.domain === 'string' &&
      typeof record.sourceText === 'string' && typeof record.documentTitle === 'string' && typeof record.officialSourceUrl === 'string' &&
      Array.isArray(record.tags) && (record.relatedTopicIds === undefined || Array.isArray(record.relatedTopicIds)) &&
      (record.sourceMapTopicIds === undefined || Array.isArray(record.sourceMapTopicIds)) &&
      (record.retrievalHints === undefined || Array.isArray(record.retrievalHints))
    );
    const claimsAreValid = candidateResult?.claims === undefined || Array.isArray(candidateResult.claims) && candidateResult.claims.every(claim =>
      claim && typeof claim.text === 'string' && typeof claim.quote === 'string' && typeof claim.recordId === 'string' &&
      (claim.canonicalUrl === undefined || typeof claim.canonicalUrl === 'string')
    );
    if (!rawResult || typeof rawResult !== 'object' || !candidatesAreValid || !claimsAreValid) {
      providerResult = { candidates: [], error: 'MALFORMED_PROVIDER_RESPONSE' };
    } else {
      providerResult = rawResult as AuthorityEvidenceProviderResult;
    }
  } catch {
    providerResult = { candidates: [], error: 'PROVIDER_ERROR' };
  }
  const retrievalTrace = safeProviderTrace(providerResult.trace, providerResult.candidates.length > 0);
  const uniqueCandidates = [...new Map(providerResult.candidates.map(record => [record.id, record])).values()];
  lifecycle.evidenceFound = uniqueCandidates.length > 0;
  if (providerResult.error) {
    gaps.push(makeGap(issue, plan.authority, plan.domain, 'retrievalAttempted', 'PROVIDER_ERROR',
      'The evidence provider failed while retrieving this issue.'));
    return { ...base, evidenceStatus: 'INSUFFICIENT', verifiedClaims: [], sources: [], gaps, retrievalTrace };
  }
  if (uniqueCandidates.length === 0) gaps.push(makeGap(issue, plan.authority, plan.domain, 'evidenceFound', 'NO_CANDIDATE_EVIDENCE',
    'No source evidence was found for this issue.'));

  let admitted: AuthoritativeSourceRecord[] = [];
  let localRejectedCount = 0;
  let irasQuality = undefined as ReturnType<typeof evaluateEvidenceQuality> | undefined;
  const targetDate = defaultTargetDateResolver.resolveTargetDate(query, referenceDate).targetDate;
  if (plan.authority === 'IRAS') {
    irasQuality = evaluateEvidenceQuality({
      query,
      topicIds: evidenceTopicIds,
      records: uniqueCandidates,
      missingFacts: [],
      targetDate,
      referenceDate,
      authorities: ['IRAS'],
      requestedConcepts: concepts,
      sourceMapFallbackTrace: safeEvidenceQualityTrace(providerResult.evidenceQualityTrace)
    });
    admitted = irasQuality.eligibleRecords;
    localRejectedCount = irasQuality.rejectedRecords.length;
  } else {
    const result = eligibleLocalRecords(uniqueCandidates, issue, plan.authority, topics, targetDate, referenceDate);
    admitted = result.admitted;
    localRejectedCount = result.rejectedCount;
  }
  lifecycle.admitted = admitted.length > 0;
  if (localRejectedCount > 0 && admitted.length === 0) gaps.push(makeGap(issue, plan.authority, plan.domain, 'admitted', 'CANDIDATE_REJECTED',
    'Candidates failed authority, domain, provenance, date, topic, or source-text checks.'));
  if (admitted.length === 0 && uniqueCandidates.length > 0) gaps.push(makeGap(issue, plan.authority, plan.domain, 'admitted', 'NO_ADMITTED_EVIDENCE',
    'No candidate passed the evidence admission checks for this issue.'));

  const suggestedClaims = providerResult.claims?.map(claim => ({
    kind: 'RULE', text: claim.text, quote: claim.quote, recordId: claim.recordId,
    ...(claim.canonicalUrl ? { citationUrl: claim.canonicalUrl } : {})
  })) || ruleClaimsForRecords(admitted);
  const verification = verifyEvidenceClaims(suggestedClaims, admitted, {
    missingFacts: [], targetDate
  });
  const verifiedClaims = verification.accepted.filter(claim => {
    const record = admitted.find(item => item.id === claim.recordId);
    if (!record) return false;
    const supportsTopic = evidenceTopics.some(topic => topicBoundToRecord(record, topic) &&
      textSupportsTopic(claim.quote, topic) && textSupportsPhrase(claim.quote, issue.subject));
    const supportsConcept = concepts.some(concept => issue.domain === 'IRAS_INCOME_TAX'
      ? matchesRequestedQuestionConcept(claim.quote, concept)
      : [concept.label, ...concept.terms].some(term => textSupportsPhrase(claim.quote, term)) && textSupportsPhrase(claim.quote, issue.subject));
    return supportsTopic || supportsConcept;
  });
  if (plan.authority === 'IRAS' && irasQuality) {
    // The per-issue IRAS gate must cover its own topics and concepts; global query coverage is never substituted.
    const uncoveredForScope = evidenceTopicIds.some(topicId => irasQuality!.uncoveredTopicIds.includes(topicId)) ||
      (irasQuality.uncoveredConcepts?.length || 0) > 0;
    if (uncoveredForScope) {
      gaps.push(makeGap(issue, plan.authority, plan.domain, 'covered', 'IRAS_SCOPE_NOT_COVERED',
        'IRAS admission did not cover every scoped topic and requested concept for this issue.'));
    }
  }
  lifecycle.verified = verifiedClaims.length > 0;
  if (!lifecycle.verified) gaps.push(makeGap(issue, plan.authority, plan.domain, 'verified', 'NO_VERIFIED_CLAIM',
    'No complete source quotation passed claim verification for this issue.'));

  const coverage = issueClaimCoverage(verifiedClaims, admitted, evidenceTopics, concepts, issue);
  lifecycle.covered = coverage.covered && !(plan.authority === 'IRAS' && irasQuality &&
    (evidenceTopicIds.some(topicId => irasQuality!.uncoveredTopicIds.includes(topicId)) || (irasQuality.uncoveredConcepts?.length || 0) > 0));
  for (const missing of coverage.missing) gaps.push(makeGap(issue, plan.authority, plan.domain, 'covered', 'ISSUE_CONCEPT_UNCOVERED',
    `Verified quotations do not support the requested ${missing.replace(':', ' ')}.`));
  const sourceIds = new Set(verifiedClaims.map(claim => claim.recordId));
  const sources = admitted.filter(record => sourceIds.has(record.id));
  return {
    ...base,
    evidenceStatus: lifecycle.covered && gaps.length === 0 ? 'VERIFIED' : 'INSUFFICIENT',
    verifiedClaims,
    sources,
    gaps,
    retrievalTrace
  };
}

function issueGapForUnplanned(issue: ReconciledSemanticQuestionIssue): AuthorityEvidenceGap {
  return makeGap(issue, 'UNKNOWN', 'UNKNOWN', 'mapped', 'NO_GOVERNING_AUTHORITY',
    'No governing authority was resolved for this material issue.');
}

/** Resolves each material issue independently, then aggregates all scoped evidence and application gaps. */
export async function buildAuthorityWorkstreams(
  query: string,
  issuePlan: SemanticIssueReconciliation,
  options: AuthorityWorkstreamOptions = {}
): Promise<AuthorityWorkstreamsResult> {
  const referenceDate = options.referenceDate || TargetDateResolver.CURRENT_SYSTEM_DATE;
  const understanding = options.questionUnderstanding || { mode: 'DETERMINISTIC_FALLBACK' as const };
  const retriever = options.retriever || defaultAdvancedSourceRetriever;
  const internalPlans = toInternalPlan(issuePlan);
  const plannedIssueIds = new Set(internalPlans.flatMap(plan => plan.issueIds));
  const plannedIssueCount = internalPlans.reduce((count, plan) => count + plan.issuePlans.length, 0);
  const workstreams: AuthorityWorkstreamResult[] = [];
  const topLevelGaps: AuthorityEvidenceGap[] = [];

  if (issuePlan.issues.length === 0) {
    topLevelGaps.push({ issueId: 'issue-plan', authority: 'UNKNOWN', domain: 'UNKNOWN', subject: 'Issue plan', operation: 'OTHER',
      stage: 'requested', code: 'EMPTY_ISSUE_PLAN', reason: 'No material issues were supplied for evidence retrieval.' });
  }
  if (!issuePlan.coverageEstablished || issuePlan.hasUnmappedResidual) {
    topLevelGaps.push({ issueId: 'issue-plan', authority: 'UNKNOWN', domain: 'UNKNOWN', subject: 'Issue plan', operation: 'OTHER',
      stage: 'covered', code: issuePlan.hasUnmappedResidual ? 'ISSUE_PLAN_HAS_UNMAPPED_RESIDUAL' : 'ISSUE_PLAN_COVERAGE_UNESTABLISHED',
      reason: 'The reconciled issue plan does not establish coverage of the complete question.' });
  }

  for (const plan of internalPlans) {
    const results = await Promise.all(plan.issuePlans.map(issuePlanItem => evaluateIssue(
      query, plan, issuePlanItem, options, retriever, understanding, referenceDate
    )));
    const verifiedClaims = [...new Map(results.flatMap(item => item.verifiedClaims).map(claim =>
      [`${claim.recordId}\n${claim.quote}`, claim]
    )).values()];
    const sourceIds = new Set(verifiedClaims.map(claim => claim.recordId));
    const sources = [...new Map(results.flatMap(item => item.sources).filter(record => sourceIds.has(record.id)).map(record => [record.id, record])).values()];
    const gaps = results.flatMap(item => item.gaps);
    workstreams.push({
      id: plan.id,
      authority: plan.authority,
      domain: plan.domain,
      sourceSections: plan.sourceSections,
      populations: plan.populations,
      issues: results,
      evidenceStatus: results.length > 0 && results.every(item => item.evidenceStatus === 'VERIFIED') ? 'VERIFIED' : 'INSUFFICIENT',
      applicationStatus: results.some(item => item.applicationStatus === 'UNRESOLVED') ? 'UNRESOLVED' : 'NOT_REQUIRED',
      verifiedClaims,
      sources,
      gaps
    });
  }

  for (const issue of issuePlan.issues) {
    if (!plannedIssueIds.has(issue.id) && issue.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC') {
      topLevelGaps.push(makeGap(issue, issue.governingAuthorities[0] || 'UNKNOWN', issue.domain, 'mapped',
        'UNASSIGNED_QUERY_TOPIC', 'A taxonomy topic remained unresolved because no validated requested issue claimed it.'));
    } else if (!plannedIssueIds.has(issue.id)) {
      topLevelGaps.push(issueGapForUnplanned(issue));
    }
  }
  for (const concept of getRequestedQuestionConcepts(query, understanding).filter(item => item.topicIds.length === 0)) {
    const assigned = internalPlans.some(plan => plan.authority === 'IRAS' && plan.issuePlans.some(item =>
      topiclessConceptBelongsToIssue(concept, item.issue, plan.authority)));
    if (!assigned) topLevelGaps.push({
      issueId: 'issue-plan', authority: 'IRAS', domain: 'IRAS_INCOME_TAX', subject: concept.label,
      operation: 'OTHER', stage: 'mapped', code: 'UNROUTED_MATERIAL_CONCEPT',
      reason: 'A material IRAS concept without a reviewed topic was not assigned to an income-tax issue.'
    });
  }

  const allIssues = workstreams.flatMap(workstream => workstream.issues);
  const evidenceStatus: AuthorityEvidenceStatus = issuePlan.coverageEstablished && topLevelGaps.length === 0 &&
    allIssues.length > 0 && allIssues.length === plannedIssueCount && allIssues.every(issue => issue.evidenceStatus === 'VERIFIED')
    ? 'VERIFIED' : 'INSUFFICIENT';
  const applicationStatus: AuthorityApplicationStatus = allIssues.some(issue => issue.applicationStatus === 'UNRESOLVED')
    ? 'UNRESOLVED' : 'NOT_REQUIRED';
  const gaps = [...topLevelGaps, ...workstreams.flatMap(workstream => workstream.gaps)];
  const status: AuthorityOverallStatus = gaps.length > 0 || evidenceStatus !== 'VERIFIED'
    ? 'INSUFFICIENT'
    : applicationStatus === 'UNRESOLVED' ? 'CONDITIONAL' : 'VERIFIED';
  return { query, issuePlan, workstreams, evidenceStatus, applicationStatus, status, gaps };
}
