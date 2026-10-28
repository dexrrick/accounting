import type { StatutoryAuthority, QueryDomain } from '../types/accounting';
import type {
  AuthorityApplicationStatus,
  AuthorityAdmissionPredicateResult,
  AuthorityCandidateAdmissionDiagnostic,
  AuthorityEvidenceGap,
  AuthorityEvidenceQualityTrace,
  AuthorityEvidenceProvider,
  AuthorityEvidenceProviderResult,
  AuthorityEvidenceRequest,
  AuthorityEvidenceScope,
  AuthorityCandidateProvenancePaths,
  AuthorityIssueAdmissionDiagnostics,
  AuthorityEvidenceStatus,
  AuthorityIssueEvidence,
  AuthorityIssueLifecycle,
  AuthorityOverallStatus,
  AuthorityRetrievalTrace,
  AuthorityTopicAdmissionDiagnostic,
  AuthorityWorkstreamDomain,
  AuthorityWorkstreamResult,
  AuthorityWorkstreamsResult,
  PlannedAuthorityWorkstream
} from '../types/authorityEvidence';
import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import {
  applyAcraAnnualReturnDeadline,
  identifyAcraAnnualReturnCompanyFacts,
  isAcraAnnualReturnApplicationQuestion
} from '../engine/acraAnnualReturnApplication';
import { getCoverageTopicsByIds, type SingaporeCoverageTopic } from '../standards/coverageRegistry';
import { defaultSourceVersioningManager, type SourceVersioningManager } from '../standards/sourceVersioning';
import { verifySharedDocumentAdmission } from '../standards/sharedDocumentAdmission';
import { defaultAdvancedSourceRetriever } from '../retrieval/advancedSourceRetriever';
import { isBoundedAcraAnnualReturnMissingFactsQuestion } from '../retrieval/queryTopicResolver';
import type { ISourceRetriever } from '../retrieval/sourceRetriever';
import { defaultTargetDateResolver, TargetDateResolver } from '../retrieval/targetDateResolver';
import {
  evaluateEvidenceQuality,
  matchesReviewedLocalRegistryRecord,
  matchesRequestedQuestionConcept
} from '../retrieval/evidenceQualityGate';
import { getGstMotorCarInputTaxExceptionKinds, supportGeneralIrasRuleConcept } from '../retrieval/irasRuleConceptSupport';
import { supportBoundedStatutoryAdvisory } from '../retrieval/statutoryAdvisorySupport';
import { supportMasCmsDefinition, supportMasCmsRule } from '../retrieval/masCmsRuleSupport';
import { isCpfMasPracticalRuleComponentQuote } from '../retrieval/cpfMasPracticalRules';
import { supportIrasAcraPracticalRuleSource } from '../retrieval/irasAcraPracticalRules';
import { isIrasCpfQualitativeRateFactorRequest, selectIrasCpfCoverageQuotes, supportIrasCpfCoverageRule } from '../retrieval/irasCpfCoverageRules';
import { selectMomAcraMasCoverageQuotes, supportMomAcraMasCoverageRule } from '../retrieval/momAcraMasCoverageRules';
import { hasPracticalExpansionContradiction, selectPracticalExpansionQuotes, supportPracticalExpansionRule } from '../retrieval/practicalStatutoryExpansion';
import { STATUTORY_KNOWLEDGE_RULES_20261027B, sourceProvesKnowledgeDate, supportStatutoryKnowledgeRule } from '../retrieval/statutoryKnowledge20261027b';

import {
  supportMomSalaryPaymentConcept,
  supportMomSalaryPaymentIssue,
  selectMomSalaryPaymentRuleQuote
} from '../retrieval/momSalaryPaymentRule';
import {
  isAcraAnnualReturnDeadlineIssue,
  isAcraAnnualReturnDeadlineQuestion,
  supportsAcraAnnualReturnDeadlineConcept,
  supportsAcraAnnualReturnDeadlineEvidence,
  supportsAcraAnnualReturnDeadlineTable,
  supportsAcraAnnualReturnFilingRule,
  requiresAcraAnnualReturnDeadlineEvidence,
  ACRA_2022_ANNUAL_RETURN_TIMELINES_URL
} from '../retrieval/acraAnnualReturnFilingRule';
import {
  completeIrasCpfCashTopUpEligibilityQuote,
  completeIrasCpfCashTopUpLimitQuotes,
  completeIrasGstMotorCarConnectedPersonExceptionQuote,
  findRecordEligibilityRejection,
  verifyEvidenceClaims,
  type BoundedCoverageRequest,
  type VerifiedEvidenceClaim,
  type VerifyEvidenceClaimsOptions
} from '../verification/claimEvidenceVerifier';
import {
  buildGroundedReasoningContext,
  resolveMappedOfficialSourceFallback,
  type MappedFallbackOptions,
  type SourceMapFallbackTrace
} from './groundingContextBuilder';
import { renderIrasEvidenceResponse } from './irasEvidencePolicy';
import { ensureRequestCompletenessContext, type RequestCompletenessContext } from './requestCompleteness';
import {
  canonicalAccountingWorkstreamAuthority,
  hasBoundedGstInputTaxRecoveryAnchors,
  getRequestedQuestionConcepts,
  getSemanticQueryClauses,
  type ReconciledSemanticQuestionIssue,
  type SemanticAuthority,
  type SemanticIssueReconciliation,
  type SemanticPopulation,
  type SemanticQuestionUnderstanding,
  type RequestedQuestionConcept,
  SEMANTIC_QUESTION_MIN_CONFIDENCE,
  validateSemanticQuestionInterpretation
} from './semanticQuestionUnderstanding';

const SUPPORTED_LOCAL_AUTHORITIES = new Set<SemanticAuthority>([
  'ACCOUNTING_STANDARDS', 'ACRA', 'CPF', 'MOM', 'MAS'
]);
// IRAS retains its specialist quality gate. These authorities now share the
// generic official-page discovery path and bounded evidence admission.
const SUPPORTED_OFFICIAL_DISCOVERY_AUTHORITIES = new Set(['ACRA', 'CPF', 'MOM', 'MAS'] as const);
type OfficialDiscoveryAuthority = typeof SUPPORTED_OFFICIAL_DISCOVERY_AUTHORITIES extends Set<infer Authority> ? Authority : never;

function isOfficialDiscoveryAuthority(authority: SemanticAuthority): authority is OfficialDiscoveryAuthority {
  return SUPPORTED_OFFICIAL_DISCOVERY_AUTHORITIES.has(authority as OfficialDiscoveryAuthority);
}
const MANAGED_MAS_DOCUMENT_RECORD_IDS = new Set([
  'MAS_FUND_MANAGEMENT_LICENSING_SUBSECTION_RECHECK',
  'MAS_IID_04_2025_SUBSECTION_RECHECK'
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
const INDIVIDUAL_CPF_CASH_TOP_UP_TOPIC_ID = 'iras-individual-cpf-cash-top-up-relief';
const INDIVIDUAL_CPF_CASH_TOP_UP_CONCEPT_IDS = new Set([
  'cpf_cash_top_up_relief', 'cpf_cash_top_up_relief_eligibility', 'cpf_cash_top_up_relief_limits'
]);

export interface AuthorityWorkstreamOptions {
  retriever?: ISourceRetriever;
  /** Grounding controls for the IRAS adapter. Per-issue evidence scope is always supplied internally. */
  groundingOptions?: Omit<MappedFallbackOptions, 'evidenceScope' | 'questionUnderstanding' | 'requestCompletenessContext' | 'semanticDiscoveryQuery'>;
  questionUnderstanding?: SemanticQuestionUnderstanding;
  requestCompletenessContext?: RequestCompletenessContext;
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

const CORPORATE_TAX_DESCRIPTOR_LABELS = new Set([
  'corporate income tax treatment', 'corporate income tax', 'corporate tax', 'corporate taxation',
  'corporate taxation treatment', 'company tax', 'company income tax', 'company tax treatment',
  'company income tax treatment'
]);

function isCorporateIncomeTaxTreatmentConcept(concept: RequestedQuestionConcept): boolean {
  return CORPORATE_TAX_DESCRIPTOR_LABELS.has(normalizeEvidenceText(concept.label));
}

function isGenericIncomeTaxConcept(concept: RequestedQuestionConcept): boolean {
  return normalizeEvidenceText(concept.label) === 'income tax';
}

function corporateIncomeTaxConceptAnchor(concept: RequestedQuestionConcept): string | undefined {
  const label = normalizeEvidenceText(concept.label);
  return CORPORATE_TAX_DESCRIPTOR_LABELS.has(label) ? label : undefined;
}

function isIssueDescriptorConcept(concept: RequestedQuestionConcept): boolean {
  const label = normalizeEvidenceText(concept.label);
  return label === 'director benefits' || label === 'business purchases' ||
    isPrivateTravelExpenseDescriptor(concept) || CORPORATE_TAX_DESCRIPTOR_LABELS.has(label);
}

function hasAdditionalRequestedOutcome(query: string): boolean {
  const normalized = normalizeEvidenceText(query);
  return /\band\s+(?:also\s+)?(?:explain|determine|assess|calculate|compute|prepare|what|how|whether)\b/.test(normalized) ||
    /\band\s+(?:what|how)\s+about\b/.test(normalized) ||
    /\band\s+(?:prepare|post|draft|provide|show|give)\b.{0,35}\b(?:journal|entry|entries)\b/.test(normalized) ||
    /\band\b.{0,30}\b(?:journal|journalize|journalise|accounting entry|accounting entries)\b/.test(normalized);
}

function hasSeparatePersonalTaxRequest(query: string): boolean {
  const normalized = normalizeEvidenceText(query);
  return /\b(?:director|employee|individual|person)(?:s)?\s+(?:own\s+)?(?:personal|individual)\s+(?:income\s+)?tax\b/.test(normalized) ||
    /\b(?:personal|individual)\s+(?:income\s+)?tax\b.{0,45}\b(?:director|employee|individual|person)\b/.test(normalized) ||
    /\b(?:director|employee)\b.{0,35}\b(?:own|personal)\s+(?:income\s+)?tax\b/.test(normalized);
}

function hasCompanyIncomeTaxRequest(query: string): boolean {
  const normalized = normalizeEvidenceText(query);
  return /\b(?:company|companies|corporate)\b/.test(normalized) &&
    /\btax\b/.test(normalized) && /\b(?:treatment|taxation|taxability|deductibility|deductible|income|chargeable|tax rules?|tax liabilities?)\b/.test(normalized) &&
    !hasSeparatePersonalTaxRequest(query) && !hasAdditionalRequestedOutcome(query);
}

function soleMappedCompanyGstInputTaxIssue(
  issue: ReconciledSemanticQuestionIssue,
  candidateIssues: ReconciledSemanticQuestionIssue[],
  query: string
): boolean {
  const mappedIssues = candidateIssues.filter(candidate => candidate.status === 'MAPPED' &&
    candidate.domain === 'IRAS_GST' && candidate.population === 'COMPANY' &&
    candidate.governingAuthorities.length === 1 && candidate.governingAuthorities[0] === 'IRAS' &&
    candidate.operation === 'EXPLAIN_RULE' && candidate.mappedTopicIds.includes('iras-gst-input-tax'));
  return candidateIssues.length === 1 && mappedIssues.length === 1 && mappedIssues[0].id === issue.id &&
    issue.domain === 'IRAS_GST' && issue.population === 'COMPANY' &&
    issue.governingAuthorities.length === 1 && issue.governingAuthorities[0] === 'IRAS' &&
    issue.operation === 'EXPLAIN_RULE' && issue.mappedTopicIds.includes('iras-gst-input-tax') &&
    hasBoundedGstInputTaxRecoveryAnchors(query, issue.subject);
}

function hasBoundedCompanyWhtRoyaltyPaymentAnchors(query: string, subject: string): boolean {
  const normalizedQuery = normalizeEvidenceText(query);
  const normalizedSubject = normalizeEvidenceText(subject);
  const hasWhtMarker = (text: string) => /\bwithholding tax\b/.test(text);
  const hasRoyaltyReceiptDirection = (text: string) =>
    /\broya\w*.{0,45}\breceiv\w*/.test(text) || /\breceiv\w*.{0,45}\broya\w*/.test(text);
  const queryPaymentDirection =
    /\bcompany\b.{0,35}\bpay\w*\b.{0,30}\broya\w*\b.{0,45}\bto\b.{0,20}\bnon resident company\b/.test(normalizedQuery);
  const subjectPaymentDirection =
    /\broya\w*.{0,35}\b(?:paid|pay\w*|payment\w*)\b.{0,45}\bto\b.{0,20}\bnon resident company\b/.test(normalizedSubject);
  const companyMentions = normalizedQuery.match(/\bcompan(?:y|ies)\b/g) || [];
  const separateRegistrationRequest =
    /\b(?:gst|withholding tax|wht) registration\b|\bregistration requirements?\b|\bregister with iras\b/.test(normalizedQuery);
  return hasWhtMarker(normalizedQuery) && hasWhtMarker(normalizedSubject) &&
    queryPaymentDirection && subjectPaymentDirection && companyMentions.length === 2 &&
    !hasRoyaltyReceiptDirection(normalizedQuery) && !hasRoyaltyReceiptDirection(normalizedSubject) &&
    !hasAdditionalRequestedOutcome(query) && !hasSeparatePersonalTaxRequest(query) && !separateRegistrationRequest;
}

function soleMappedCompanyWhtRoyaltyIssue(
  issue: ReconciledSemanticQuestionIssue,
  candidateIssues: ReconciledSemanticQuestionIssue[],
  query: string
): boolean {
  const requiredTopics = ['iras-withholding-tax', 'iras-withholding-tax-interest-royalties'];
  const topics = getCoverageTopicsByIds(issue.mappedTopicIds).filter(topic => topic.domainId.startsWith('IRAS_'));
  return candidateIssues.length === 1 && candidateIssues[0].id === issue.id &&
    issue.status === 'MAPPED' && issue.domain === 'IRAS_INCOME_TAX' && issue.population === 'COMPANY' &&
    issue.governingAuthorities.length === 1 && issue.governingAuthorities[0] === 'IRAS' &&
    issue.operation === 'EXPLAIN_RULE' && requiredTopics.every(topicId => issue.mappedTopicIds.includes(topicId)) &&
    issue.mappedTopicIds.every(topicId => topicId.startsWith('iras-withholding-tax')) &&
    topics.length === issue.mappedTopicIds.length && topics.every(topic => topic.domainId === 'IRAS_CORPORATE_TAX') &&
    canonicalDomainForIssue(issue, 'IRAS', topics) === 'IRAS_CORPORATE_TAX' &&
    hasBoundedCompanyWhtRoyaltyPaymentAnchors(query, issue.subject);
}

function isCompanyTaxResidencyRequest(query: string): boolean {
  const normalized = normalizeEvidenceText(query);
  return /\b(?:company|companies|corporate|business entity)\b/.test(normalized) &&
    /\b(?:tax residency|tax residence|tax resident|residency|residence)\b/.test(normalized) &&
    !hasSeparatePersonalTaxRequest(query) && !hasAdditionalRequestedOutcome(query);
}

function soleMappedCompanyTaxResidencyIssue(
  issue: ReconciledSemanticQuestionIssue,
  authority: SemanticAuthority,
  candidateIssues: ReconciledSemanticQuestionIssue[],
  query: string
): boolean {
  const normalizedSubject = normalizeEvidenceText(issue.subject);
  return authority === 'IRAS' && candidateIssues.length === 1 && candidateIssues[0].id === issue.id &&
    issue.status === 'MAPPED' && issue.domain === 'IRAS_INCOME_TAX' && issue.population === 'COMPANY' &&
    issue.governingAuthorities.includes('IRAS') && issue.mappedTopicIds.includes('iras-corporate-tax-residency') &&
    /\b(?:tax residency|tax residence|tax resident|residency|residence)\b/.test(normalizedSubject) &&
    isCompanyTaxResidencyRequest(query);
}

function isPrivateTravelExpenseDescriptor(concept: RequestedQuestionConcept): boolean {
  return /^(?:(?:business|company) )?travel (?:expenses?|costs?|expenditures?)$/.test(normalizeEvidenceText(concept.label));
}

function privateTravelExpenseBelongsToCompanyIssue(
  issue: ReconciledSemanticQuestionIssue,
  authority: SemanticAuthority,
  candidateIssues: ReconciledSemanticQuestionIssue[],
  query: string
): boolean {
  const normalizedQuery = normalizeEvidenceText(query);
  const normalizedSubject = normalizeEvidenceText(issue.subject);
  const travelClassification = /\b(?:recorded|classified|booked|coded|charged)\b.{0,45}\btravel (?:expenses?|costs?|expenditures?)\b/.test(normalizedQuery);
  return soleMappedCompanyIncomeTaxIssue(issue, authority, candidateIssues, query) &&
    /\b(?:company|corporate)\b/.test(normalizedQuery) && /\btax\b/.test(normalizedQuery) &&
    /\bdirector\b/.test(normalizedQuery) && /\b(?:private|personal)\b/.test(normalizedQuery) &&
    /\bholiday\b/.test(normalizedQuery) && travelClassification &&
    /\bdirector\b/.test(normalizedSubject) && /\b(?:private|personal)\b/.test(normalizedSubject) &&
    /\bholiday\b/.test(normalizedSubject) &&
    issue.mappedTopicIds.some(id => ['iras-cit-deductibility', 'iras-cit-disallowed-expenses'].includes(id));
}

function queryAnchorsCompanyIssue(query: string, issue: ReconciledSemanticQuestionIssue): boolean {
  const queryTerms = new Set(conceptOwnershipTerms(query));
  const issueTerms = conceptOwnershipTerms(issue.subject);
  const matchingTerms = issueTerms.filter(term => queryTerms.has(term));
  return issueTerms.length > 0 && matchingTerms.length >= Math.min(2, issueTerms.length);
}

function hasOpposingForeignDividendPaymentDirection(issue: ReconciledSemanticQuestionIssue): boolean {
  if (!issue.mappedTopicIds.includes('iras-foreign-sourced-income')) return false;
  const normalizedSubject = normalizeEvidenceText(issue.subject);
  return /\b(?:pay\w*|paid|distribut\w*)\b/.test(normalizedSubject) &&
    !/\breceiv\w*\b.{0,40}\bfrom\b.{0,30}\bforeign payer\b/.test(normalizedSubject);
}

function isBoundedForeignDividendReceiptForIssue(
  query: string,
  issue: ReconciledSemanticQuestionIssue
): boolean {
  const normalizedQuery = normalizeEvidenceText(query);
  const normalizedSubject = normalizeEvidenceText(issue.subject);
  const explicitSingaporeCompanyReceiptFromThaiSubsidiary =
    /\bsingapore company\b.{0,65}\breceiv\w*\b.{0,60}\bdividends?\b.{0,80}\bthai subsidiary\b/.test(normalizedQuery);
  return issue.population === 'COMPANY' && issue.mappedTopicIds.includes('iras-foreign-sourced-income') &&
    /\b(?:foreign|overseas)\b/.test(normalizedSubject) && /\bdividends?\b/.test(normalizedSubject) &&
    /\btax\b/.test(normalizedSubject) && !hasOpposingForeignDividendPaymentDirection(issue) &&
    explicitSingaporeCompanyReceiptFromThaiSubsidiary;
}

function isRelatedSubsidiaryDescriptor(concept: RequestedQuestionConcept): boolean {
  return concept.role === 'RELATED' && normalizeEvidenceText(concept.label) === 'subsidiary';
}

function hasSeparateSubsidiaryOutcome(query: string): boolean {
  const normalized = normalizeEvidenceText(query);
  return /\band\b[^.!?]{0,80}\bsubsidiar(?:y|ies)\b[^.!?]{0,80}\b(?:tax|journal|accounting|consolidat\w*)\b/.test(normalized) ||
    /\bsubsidiar(?:y|ies)\b[^.!?]{0,65}\b(?:separate(?:ly)?|own|independent)\b[^.!?]{0,40}\b(?:tax|journal|accounting|consolidat\w*)\b/.test(normalized);
}

function boundedForeignDividendSubsidiaryDescriptorBelongsToIssue(
  concept: RequestedQuestionConcept,
  issue: ReconciledSemanticQuestionIssue,
  authority: SemanticAuthority,
  candidateIssues: ReconciledSemanticQuestionIssue[],
  query: string
): boolean {
  return isRelatedSubsidiaryDescriptor(concept) && authority === 'IRAS' &&
    issue.mappedTopicIds.length === 1 && issue.mappedTopicIds[0] === 'iras-foreign-sourced-income' &&
    soleMappedCompanyIncomeTaxIssue(issue, authority, candidateIssues, query) &&
    isBoundedForeignDividendReceiptForIssue(query, issue) && !hasAdditionalRequestedOutcome(query) &&
    !hasSeparateSubsidiaryOutcome(query);
}

function soleMappedCompanyIncomeTaxIssue(
  issue: ReconciledSemanticQuestionIssue,
  authority: SemanticAuthority,
  candidateIssues: ReconciledSemanticQuestionIssue[],
  query: string
): boolean {
  if (authority !== 'IRAS' || candidateIssues.length !== 1 || candidateIssues[0].id !== issue.id ||
      issue.status !== 'MAPPED' || issue.domain !== 'IRAS_INCOME_TAX' || issue.population !== 'COMPANY' ||
      !issue.governingAuthorities.includes('IRAS') || !hasCompanyIncomeTaxRequest(query)) return false;
  const topics = getCoverageTopicsByIds(issue.mappedTopicIds).filter(topic => topic.domainId.startsWith('IRAS_'));
  const issueBound = !hasOpposingForeignDividendPaymentDirection(issue) &&
    (queryAnchorsCompanyIssue(query, issue) || isBoundedForeignDividendReceiptForIssue(query, issue));
  return issueBound && topics.length > 0 && topics.every(topic => topic.domainId === 'IRAS_CORPORATE_TAX') &&
    canonicalDomainForIssue(issue, 'IRAS', topics) === 'IRAS_CORPORATE_TAX';
}

function topiclessConceptBelongsToIssue(
  concept: RequestedQuestionConcept,
  issue: ReconciledSemanticQuestionIssue,
  authority: SemanticAuthority,
  candidateIssues: ReconciledSemanticQuestionIssue[] = [],
  query = ''
): boolean {
  if (concept.id.startsWith('acra_annual_return_')) {
    return isAcraAnnualReturnDeadlineIssue(query, authority, issue, candidateIssues);
  }
  const normalizedLabel = normalizeEvidenceText(concept.label);
  if (authority === 'IRAS') {
    if (isRelatedSubsidiaryDescriptor(concept)) {
      return boundedForeignDividendSubsidiaryDescriptorBelongsToIssue(concept, issue, authority, candidateIssues, query);
    }
    if (normalizedLabel === 'gst input tax' && (concept.role === 'PRIMARY' || concept.role === 'RELATED')) {
      return soleMappedCompanyGstInputTaxIssue(issue, candidateIssues, query);
    }
    if (normalizedLabel === 'royalty payment' && (concept.role === 'PRIMARY' || concept.role === 'RELATED')) {
      return soleMappedCompanyWhtRoyaltyIssue(issue, candidateIssues, query);
    }
    if (normalizedLabel === 'gst registration' && concept.role === 'RELATED') {
      return soleMappedCompanyGstInputTaxIssue(issue, candidateIssues, query);
    }
  }
  if (authority !== 'IRAS' && concept.role && concept.role !== 'CONTEXT_ONLY') {
    return topiclessSemanticConceptOwner(concept, query, candidateIssues)?.id === issue.id;
  }
  if (authority !== 'IRAS') return false;
  if (normalizedLabel === 'input tax') {
    return soleMappedCompanyGstInputTaxIssue(issue, candidateIssues, query);
  }
  if (normalizedLabel === 'business purchases') {
    return soleMappedCompanyGstInputTaxIssue(issue, candidateIssues, query);
  }
  if (normalizedLabel === 'gst registration') {
    return false;
  }
  if (issue.domain !== 'IRAS_INCOME_TAX') return false;
  if (concept.id === 'relief_claim_prioritization') {
    return issue.population === 'INDIVIDUAL' || issue.population === 'EMPLOYEE' ||
      issue.mappedTopicIds.some(id => id.startsWith('iras-individual-'));
  }
  // This generic semantic label has no distinctive ownership terms after the
  // tax vocabulary is removed. Assign it only to a sole mapped company
  // income-tax issue whose population, authority and mapped topics agree.
  // Ambiguous or unrelated issue sets therefore retain the top-level gap.
  if (isCorporateIncomeTaxTreatmentConcept(concept)) {
    return Boolean(corporateIncomeTaxConceptAnchor(concept)) && (
      soleMappedCompanyTaxResidencyIssue(issue, authority, candidateIssues, query) ||
      soleMappedCompanyIncomeTaxIssue(issue, authority, candidateIssues, query));
  }
  if (isPrivateTravelExpenseDescriptor(concept)) {
    return privateTravelExpenseBelongsToCompanyIssue(issue, authority, candidateIssues, query);
  }
  if (isGenericIncomeTaxConcept(concept)) {
    // The exact generic label has no distinctive ownership terms. Treat every
    // governing income-tax issue as a possible owner for ambiguity purposes,
    // including an unresolved or unmapped issue. Only a sole, mapped issue
    // with population-consistent income-tax topics can own the concept.
    const plausibleIssues = candidateIssues.filter(candidate =>
      candidate.domain === 'IRAS_INCOME_TAX' && candidate.governingAuthorities.includes('IRAS'));
    if (plausibleIssues.length !== 1 || plausibleIssues[0].id !== issue.id || issue.status !== 'MAPPED') return false;
    const topics = getCoverageTopicsByIds(issue.mappedTopicIds).filter(topic => topic.domainId.startsWith('IRAS_'));
    const expectedDomain = issue.population === 'INDIVIDUAL' || issue.population === 'EMPLOYEE'
      ? 'IRAS_INDIVIDUAL_TAX'
      : issue.population === 'COMPANY' || issue.population === 'FUND'
        ? 'IRAS_CORPORATE_TAX'
        : undefined;
    return Boolean(expectedDomain && topics.length > 0 &&
      topics.every(topic => topic.domainId === expectedDomain) &&
      canonicalDomainForIssue(issue, 'IRAS', topics) === expectedDomain);
  }
  if (normalizedLabel === 'director benefits') {
    const normalizedQuery = normalizeEvidenceText(query);
    return soleMappedCompanyIncomeTaxIssue(issue, authority, candidateIssues, query) &&
      /\b(?:company|corporate)\b/.test(normalizedQuery) && /\btax\b/.test(normalizedQuery) &&
      /\bdirector\b/.test(normalizedQuery) && /\b(?:private|personal|holiday|benefit|perquisite)\b/.test(normalizedQuery) &&
      /\b(?:expense|paid|recorded)\b/.test(normalizedQuery) &&
      /\b(?:private|personal|holiday|benefit|perquisite)\b/.test(normalizeEvidenceText(issue.subject)) &&
      issue.mappedTopicIds.some(id => ['iras-cit-deductibility', 'iras-cit-disallowed-expenses'].includes(id));
  }
  const issueText = `${issue.subject} ${issue.mappedTopicIds.join(' ')}`;
  const uniqueTerms = [...new Set([...concept.terms, concept.label].flatMap(conceptOwnershipTerms))];
  const normalizedIssue = new Set(conceptOwnershipTerms(issueText));
  return uniqueTerms.length > 0 && uniqueTerms.filter(term => normalizedIssue.has(term)).length >= Math.min(2, uniqueTerms.length);
}

function semanticOwnerToken(value: string): string {
  const normalized = normalizeWord(value);
  // Singapore sources use both "licence" and "license"; the related
  // semantic concept often uses "licensing".
  if (/^licen[cs](?:e|es|ing|ed)?$/.test(normalized)) return 'licens';
  if (normalized.length > 4 && normalized.endsWith('ies')) return `${normalized.slice(0, -3)}y`;
  if (/(?:ches|shes|xes|zes|sses)$/.test(normalized)) return normalized.slice(0, -2);
  if (normalized.length > 3 && normalized.endsWith('s') && !normalized.endsWith('ss')) return normalized.slice(0, -1);
  return normalized;
}

function semanticOwnerAnchors(value: string): string[] {
  const normalized = normalizeEvidenceText(value);
  const anchors = normalized.split(' ')
    .map(semanticOwnerToken)
    .filter(word => word.length >= 4 && !GENERIC_SUPPORT_WORDS.has(word) && !GENERIC_SUPPORT_WORDS.has(normalizeWord(word)));
  // Keep short authority names as anchors so a contextual mention such as
  // “CPF contributions” can be bound to the matching local payroll issue.
  for (const authority of ['acra', 'cpf', 'iras', 'mas', 'mom']) {
    if (new RegExp(`\\b${authority}\\b`).test(normalized)) anchors.push(authority);
  }
  // Preserve the legal subpart as a single anchor: "part" alone is too broad.
  if (/\bpart\s+iv\b/.test(normalized)) anchors.push('part iv');
  // "Employment" and "Act" are individually generic/short, but the exact
  // instrument name is a useful bounded anchor for the MOM publisher context.
  if (/\bemployment\s+act\b/.test(normalized)) anchors.push('employment act');
  return [...new Set(anchors)];
}

function hasSemanticOwnerAnchor(text: string, anchor: string): boolean {
  const normalized = normalizeEvidenceText(text);
  if (anchor.includes(' ')) return normalized.includes(anchor);
  return new Set(normalized.split(' ').map(semanticOwnerToken)).has(anchor);
}

function isBoundedMomPartIvEmploymentActConcept(
  concept: RequestedQuestionConcept,
  issue: ReconciledSemanticQuestionIssue,
  compatibleTopics: SingaporeCoverageTopic[],
  clause: string
): boolean {
  const semanticAuthorities = (concept.semanticAuthorities || []).filter(authority => authority !== 'UNKNOWN');
  const isSupportedCoverageLabel = isGenericMomPartIvCoverageConcept(concept);
  const hasCanonicalMomPartIvTopic = compatibleTopics.some(topic =>
    topic.domainId === 'MOM_EMPLOYMENT' && topic.authorities.includes('MOM') &&
    (topic.id === 'mom-part-iv-overtime' ||
      topic.id === 'mom_overtime' && topic.canonicalConceptId === 'mom-part-iv-overtime'));
  return (normalizeEvidenceText(concept.label) === 'employment act' || isSupportedCoverageLabel) &&
    concept.role !== 'CONTEXT_ONLY' &&
    (semanticAuthorities.length === 0 || semanticAuthorities.includes('MOM') &&
      semanticAuthorities.every(authority => authority === 'MOM' || authority === 'SSO')) &&
    issue.domain === 'MOM_EMPLOYMENT' && issue.population === 'EMPLOYEE' &&
    issue.operation === 'EXPLAIN_RULE' && issue.status === 'MAPPED' &&
    issue.governingAuthorities.length === 1 && issue.governingAuthorities[0] === 'MOM' &&
    issue.mappedTopicIds.includes('mom-part-iv-overtime') && hasCanonicalMomPartIvTopic &&
    hasSemanticOwnerAnchor(issue.subject, 'part iv') &&
    hasSemanticOwnerAnchor(issue.subject, 'coverage') &&
    hasSemanticOwnerAnchor(clause, 'employment act') && hasSemanticOwnerAnchor(clause, 'part iv') &&
    /\b(?:coverage|covered)\b/i.test(clause);
}

function isGenericIrasRestrictionConcept(concept: RequestedQuestionConcept): boolean {
  const allowed = new Set(['iras restriction', 'iras restrictions']);
  return allowed.has(normalizeEvidenceText(concept.label)) &&
    concept.terms.every(term => allowed.has(normalizeEvidenceText(term)));
}

function hasIndependentSsoPublisherRequest(query: string): boolean {
  return getSemanticQueryClauses(query).some(clause =>
    /\b(?:sso|singapore\s+statutes\s+online)\b/i.test(clause) &&
    /\b(?:separately|independently|what|how|which|who|explain|describe|compare|does|do|is|are)\b/i.test(clause) &&
    !/\b(?:employment\s+act|part\s+(?:iv|4)|working\s+hours?|overtime)\b/i.test(clause));
}

function topiclessExactSemanticConceptCouldBelongToIssue(
  concept: RequestedQuestionConcept,
  issue: ReconciledSemanticQuestionIssue,
  query: string
): boolean {
  if (!concept.role || concept.role === 'CONTEXT_ONLY' || issue.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC') return false;
  if (concept.semanticDomain && concept.semanticDomain !== 'UNKNOWN' && concept.semanticDomain !== issue.domain) return false;
  if (concept.semanticPopulation && concept.semanticPopulation !== 'UNKNOWN' && issue.population !== 'UNKNOWN' &&
      concept.semanticPopulation !== issue.population) return false;
  const requestedAuthorities = (concept.semanticAuthorities || []).filter(authority => authority !== 'UNKNOWN');
  // Preserve exact phrase ownership for non-discovery standards authorities,
  // while requiring an explicit authority so missing semantics cannot grant it.
  const nonDiscoveryAuthorities = requestedAuthorities.filter(authority =>
    authority === 'ACCOUNTING_STANDARDS' || authority === 'IFRS_FOUNDATION' || authority === 'SSO');
  if (nonDiscoveryAuthorities.length === 0 ||
      !nonDiscoveryAuthorities.some(authority => issue.governingAuthorities.includes(authority))) return false;
  const phrase = normalizeEvidenceText(concept.label);
  return phrase.length >= 5 && normalizeEvidenceText(query).includes(phrase) &&
    normalizeEvidenceText(issue.subject).includes(phrase);
}

function genericIrasRestrictionFollowsIssueLocally(
  concept: RequestedQuestionConcept,
  issue: ReconciledSemanticQuestionIssue,
  query: string,
  issueAnchors: string[]
): boolean {
  if (!isGenericIrasRestrictionConcept(concept) || issue.domain !== 'IRAS_GST' ||
      issue.governingAuthorities.length !== 1 || issue.governingAuthorities[0] !== 'IRAS') return false;
  const clauses = getSemanticQueryClauses(query);
  let searchFrom = 0;
  for (let index = 0; index + 1 < clauses.length; index += 1) {
    const subjectClause = clauses[index];
    const followOn = clauses[index + 1];
    const subjectMatches = issueAnchors.filter(anchor => hasSemanticOwnerAnchor(subjectClause, anchor)).length;
    if (subjectMatches < Math.min(2, issueAnchors.length) ||
        !/\b(?:explain|describe|outline|summari[sz]e)\b/i.test(followOn) ||
        !/\biras\b/i.test(followOn) || !/\brestrictions?\b/i.test(followOn) ||
        !/\bexceptions?\b/i.test(followOn) || /\b(?:acra|cpf|mas|mom)\b/i.test(followOn)) continue;
    const subjectStart = query.indexOf(subjectClause, searchFrom);
    if (subjectStart < 0) continue;
    const subjectEnd = subjectStart + subjectClause.length;
    const followOnStart = query.indexOf(followOn, subjectEnd);
    if (followOnStart < 0) continue;
    const transition = query.slice(subjectEnd, followOnStart);
    if (/\b(?:separately|also|however|whereas|but also)\b/i.test(transition) ||
        /\b(?:acra|cpf|mas|mom)\b/i.test(transition)) continue;
    return true;
  }
  return false;
}

function topiclessSemanticConceptCouldBelongToIssue(
  concept: RequestedQuestionConcept,
  issue: ReconciledSemanticQuestionIssue,
  query: string
): boolean {
  if (!concept.role || concept.role === 'CONTEXT_ONLY' || issue.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC') return false;
  const issueAuthorities = issue.governingAuthorities.filter(authority =>
    SUPPORTED_LOCAL_AUTHORITIES.has(authority) || authority === 'IRAS');
  if (issueAuthorities.length !== 1) {
    return topiclessExactSemanticConceptCouldBelongToIssue(concept, issue, query);
  }
  const authority = issueAuthorities[0];
  if (authority === 'ACCOUNTING_STANDARDS' || authority === 'IFRS_FOUNDATION' || authority === 'SSO') {
    return topiclessExactSemanticConceptCouldBelongToIssue(concept, issue, query);
  }
  const issueAuthorityScopeMatches = authority === 'ACRA'
    ? issue.domain === 'ACRA_CORPORATE' && issue.population === 'COMPANY'
    : authority === 'CPF'
      ? issue.domain === 'CPF_PAYROLL' && ['EMPLOYER', 'EMPLOYEE'].includes(issue.population)
      : authority === 'MOM'
        ? issue.domain === 'MOM_EMPLOYMENT' && ['EMPLOYEE', 'EMPLOYER'].includes(issue.population)
        : authority === 'MAS'
          ? issue.domain === 'MAS_FUNDS' && (['COMPANY', 'FUND'].includes(issue.population) ||
            issue.population === 'UNKNOWN' && isNeutralGeneralMasCmsRuleIssue(issue, query))
          : authority === 'IRAS' && issue.domain.startsWith('IRAS_') && issue.population !== 'UNKNOWN';
  if (!issueAuthorityScopeMatches) return false;
  const semanticAuthorities = (concept.semanticAuthorities || []).filter(candidate => candidate !== 'UNKNOWN');
  const semanticAuthorityScopeMatches = semanticAuthorities.length === 0 ||
    semanticAuthorities.length === 1 && semanticAuthorities[0] === authority ||
    authority === 'MOM' && issue.governingAuthorities.length === 1 && issue.governingAuthorities[0] === 'MOM' &&
      semanticAuthorities.includes('MOM') && semanticAuthorities.every(candidate => candidate === 'MOM' || candidate === 'SSO');
  if (!semanticAuthorityScopeMatches || authority === 'MOM' &&
      (issue.governingAuthorities.length !== 1 || issue.governingAuthorities[0] !== 'MOM')) return false;
  if (concept.semanticDomain && concept.semanticDomain !== 'UNKNOWN' && concept.semanticDomain !== issue.domain) return false;
  if (concept.semanticPopulation && concept.semanticPopulation !== 'UNKNOWN' && concept.semanticPopulation !== issue.population) return false;
  const conceptText = [concept.label, ...concept.terms].join(' ');
  if (authority === 'MOM' && /\b(?:sso|singapore\s+statutes\s+online)\b/i.test(concept.label) &&
      hasIndependentSsoPublisherRequest(query)) return false;
  const conceptAnchors = semanticOwnerAnchors(conceptText);
  // Support the standard acronym only when it is an alias of the full CMS
  // identity in this concept; authority/domain still come from the issue.
  if (/\bcapital\s+markets\s+services\s+licen[cs]e\b/i.test(conceptText)) conceptAnchors.push('cms');
  const distinctConceptAnchors = [...new Set(conceptAnchors)];
  const hasPublisherContext = authority === 'MOM' && semanticAuthorities.includes('SSO');
  const issueAnchors = semanticOwnerAnchors(issue.subject);
  if (distinctConceptAnchors.length === 0 || issueAnchors.length === 0) return false;

  const reviewedTopics = getCoverageTopicsByIds(issue.mappedTopicIds);
  const compatibleTopics = reviewedTopics.filter(topic => sourceDomainMatchesAuthority(topic, authority) &&
    (authority === 'ACRA' ? topic.domainId === 'ACRA_COMPANIES'
      : authority === 'CPF' ? topic.domainId === 'CPF_CONTRIBUTIONS'
        : authority === 'MOM' ? topic.domainId === 'MOM_EMPLOYMENT'
          : authority === 'MAS' ? topic.domainId === 'MAS_FUND_MANAGEMENT'
            : canonicalDomainForIssue(issue, 'IRAS', [topic]) !== 'UNKNOWN'));
  if (compatibleTopics.length === 0 && issue.status !== 'UNRESOLVED') return false;
  const issueTopicMatches = compatibleTopics.some(topic => {
    const topicText = `${topic.title} ${topic.keywords.join(' ')} ${(topic.paragraphHints || []).join(' ')}`;
    return issueAnchors.filter(anchor => hasSemanticOwnerAnchor(topicText, anchor)).length >= Math.min(2, issueAnchors.length);
  });
  const boundedMomPartIvEmploymentActIssue = authority === 'MOM' && getSemanticQueryClauses(query).some(clause =>
    isBoundedMomPartIvEmploymentActConcept(concept, issue, compatibleTopics, clause));
  if (!issueTopicMatches && issue.status !== 'UNRESOLVED' && !boundedMomPartIvEmploymentActIssue) return false;

  // Bind a semantic label to one punctuation/conjunction-bounded raw clause.
  // Root-level authorities, populations and the union of mixed query words
  // cannot establish ownership. Topic metadata is only a compatibility check.
  const hasLocalFollowOn = issueTopicMatches && genericIrasRestrictionFollowsIssueLocally(
    concept, issue, query, issueAnchors
  );
  return hasLocalFollowOn || getSemanticQueryClauses(query).some(clause => {
    const conceptMatches = distinctConceptAnchors.filter(anchor => hasSemanticOwnerAnchor(clause, anchor));
    const issueMatches = issueAnchors.filter(anchor => hasSemanticOwnerAnchor(clause, anchor));
    const boundedMomPartIvCoverage = authority === 'MOM' &&
      isBoundedMomPartIvEmploymentActConcept(concept, issue, compatibleTopics, clause);
    // A validated paraphrase can contribute one distinctive content anchor
    // (for example “overtime” for a working-hours concept); the raw clause
    // must still match at least two anchors from the issue's local subject.
    if ((conceptMatches.length < Math.min(2, distinctConceptAnchors.length) ||
        issueMatches.length < Math.min(2, issueAnchors.length)) && !boundedMomPartIvCoverage) return false;
    if (hasPublisherContext && (!hasSemanticOwnerAnchor(clause, 'employment act') ||
        !hasSemanticOwnerAnchor(issue.subject, 'employment act'))) return false;
    if (compatibleTopics.length === 0) return issue.status === 'UNRESOLVED';
    const conceptTopicMatches = compatibleTopics.some(topic => {
      const topicText = `${topic.title} ${topic.keywords.join(' ')} ${(topic.paragraphHints || []).join(' ')}`;
      return conceptMatches.some(anchor => hasSemanticOwnerAnchor(topicText, anchor)) ||
        authority === 'MOM' && conceptMatches.includes('employment act') &&
          hasSemanticOwnerAnchor(topic.actOrStandard || '', 'employment act') ||
        boundedMomPartIvCoverage;
    });
    // "IRAS restriction" is a generic continuation label, so its local issue
    // subject and independently mapped topic establish the owner while the
    // raw clause must still contain the label itself.
    return conceptTopicMatches || isGenericIrasRestrictionConcept(concept) || boundedMomPartIvCoverage;
  });
}

function topiclessSemanticConceptOwner(
  concept: RequestedQuestionConcept,
  query: string,
  candidateIssues: ReconciledSemanticQuestionIssue[]
): ReconciledSemanticQuestionIssue | undefined {
  const plausibleOwners = candidateIssues.filter(issue => topiclessSemanticConceptCouldBelongToIssue(concept, issue, query));
  if (plausibleOwners.length !== 1 || plausibleOwners[0].status !== 'MAPPED') return undefined;
  return plausibleOwners[0];
}

function topiclessConceptGapScope(concept: RequestedQuestionConcept): {
  authority: SemanticAuthority;
  domain: AuthorityWorkstreamDomain;
} {
  const authorities = [...new Set((concept.semanticAuthorities || []).filter(authority => authority !== 'UNKNOWN'))];
  const authorityFor = (expected: SemanticAuthority): SemanticAuthority =>
    authorities.length === 0 || authorities.some(authority => authority === expected) ? expected : 'UNKNOWN';
  switch (concept.semanticDomain) {
    case 'ACCOUNTING': return { authority: authorityFor('ACCOUNTING_STANDARDS'), domain: 'ACCOUNTING' };
    case 'IRAS_GST': return { authority: authorityFor('IRAS'), domain: 'IRAS_GST' };
    case 'IRAS_PROPERTY_TAX': return { authority: authorityFor('IRAS'), domain: 'IRAS_PROPERTY_TAX' };
    case 'IRAS_STAMP_DUTY': return { authority: authorityFor('IRAS'), domain: 'IRAS_STAMP_DUTY' };
    case 'IRAS_OTHER': return { authority: authorityFor('IRAS'), domain: 'IRAS_OTHER' };
    case 'IRAS_INCOME_TAX': {
      const domain = concept.semanticPopulation === 'INDIVIDUAL' || concept.semanticPopulation === 'EMPLOYEE'
        ? 'IRAS_INDIVIDUAL_TAX'
        : concept.semanticPopulation === 'COMPANY' || concept.semanticPopulation === 'FUND'
          ? 'IRAS_CORPORATE_TAX' : 'IRAS_INCOME_TAX';
      return { authority: authorityFor('IRAS'), domain };
    }
    case 'CPF_PAYROLL': return { authority: authorityFor('CPF'), domain: 'CPF_PAYROLL' };
    case 'MOM_EMPLOYMENT': return { authority: authorityFor('MOM'), domain: 'MOM_EMPLOYMENT' };
    case 'ACRA_CORPORATE': return { authority: authorityFor('ACRA'), domain: 'ACRA_CORPORATE' };
    case 'MAS_FUNDS': return { authority: authorityFor('MAS'), domain: 'MAS_FUNDS' };
    default:
      return authorities.length === 1
        ? { authority: authorities[0], domain: 'UNKNOWN' }
        : { authority: 'UNKNOWN', domain: 'UNKNOWN' };
  }
}

function requestedConceptsForIssue(
  query: string,
  issue: ReconciledSemanticQuestionIssue,
  authority: SemanticAuthority,
  topicIds: string[],
  understanding: SemanticQuestionUnderstanding | undefined,
  candidateIssues: ReconciledSemanticQuestionIssue[],
  semanticOwnerCandidates: ReconciledSemanticQuestionIssue[],
  acraCandidateIssues: ReconciledSemanticQuestionIssue[] = candidateIssues
): RequestedQuestionConcept[] {
  const topicSet = new Set(topicIds);
  return getRequestedQuestionConcepts(query, understanding).filter(concept => {
    if (authority === 'ACRA' && concept.role && concept.role !== 'CONTEXT_ONLY' &&
        isGenericAcraAnnualReturnDutyConcept(concept)) {
      const plausibleOwners = acraCandidateIssues.filter(candidate =>
        topiclessSemanticConceptCouldBelongToIssue(concept, candidate, query));
      return topicSet.has('acra_annual-returns') && isAcraAnnualReturnFilingDutyIssue(query, 'ACRA', issue, getCoverageTopicsByIds(topicIds)) && plausibleOwners.length === 1 && plausibleOwners[0].id === issue.id;
    }
    if (authority !== 'IRAS' && concept.role && concept.role !== 'CONTEXT_ONLY') {
      return topiclessSemanticConceptOwner(concept, query, semanticOwnerCandidates)?.id === issue.id;
    }
    if (concept.id.startsWith('acra_annual_return_')) {
      return topicSet.has('acra_annual-returns') &&
        !isAcraAnnualReturnFilingDutyIssue(query, authority, issue, getCoverageTopicsByIds(topicIds)) &&
        isAcraAnnualReturnDeadlineIssue(query, authority, issue, acraCandidateIssues);
    }
    const topiclessOwner = authority === 'IRAS'
      ? topiclessConceptBelongsToIssue(concept, issue, authority, candidateIssues, query)
      : topiclessSemanticConceptOwner(concept, query, semanticOwnerCandidates)?.id === issue.id;
    return concept.topicIds.some(topicId => topicSet.has(topicId)) ||
    concept.topicIds.length === 0 && !isCorporateIncomeTaxTreatmentConcept(concept) && !isGenericIncomeTaxConcept(concept) &&
      !isIssueDescriptorConcept(concept) &&
      !boundedForeignDividendSubsidiaryDescriptorBelongsToIssue(concept, issue, authority, candidateIssues, query) &&
      topiclessOwner
  });
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
  const authority = plan.authority === 'IRAS' ? 'IRAS'
    : isOfficialDiscoveryAuthority(plan.authority) ? plan.authority : undefined;
  if (!authority) return undefined;
  const sourceDomain = getCoverageTopicsByIds(topicIds)[0]?.domainId;
  if (!sourceDomain) return undefined;
  return {
    authority,
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

function hasAdmissionCriticalTraceShape(value: unknown): value is AuthorityEvidenceQualityTrace {
  if (!value || typeof value !== 'object') return false;
  const trace = value as AuthorityEvidenceQualityTrace;
  return (trace.selectedRecordIds === undefined || Array.isArray(trace.selectedRecordIds) &&
      trace.selectedRecordIds.every(id => typeof id === 'string')) &&
    (trace.finalVerifiedUrls === undefined || Array.isArray(trace.finalVerifiedUrls) &&
      trace.finalVerifiedUrls.every(url => typeof url === 'string')) &&
    Array.isArray(trace.attempts) && trace.attempts.every(attempt => Boolean(attempt) &&
      typeof attempt.topicId === 'string' && typeof attempt.fetchStatus === 'string' &&
      typeof attempt.titleMatched === 'boolean' && typeof attempt.contentMatched === 'boolean' &&
      (attempt.finalUrl === undefined || typeof attempt.finalUrl === 'string'));
}

function hasValidOptionalTraceMetadata(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const trace = value as AuthorityEvidenceQualityTrace;
  return Array.isArray(trace.attempts) &&
    (trace.path === undefined || ['NOT_NEEDED', 'MAPPED_SOURCE', 'DISCOVERED_SOURCE', 'MAPPED_SOURCE_REJECTED', 'NO_VERIFIED_MAP'].includes(trace.path)) &&
    (trace.sourceMapIds === undefined || Array.isArray(trace.sourceMapIds) && trace.sourceMapIds.every(id => typeof id === 'string')) &&
    (trace.candidateOnly === undefined || typeof trace.candidateOnly === 'boolean') &&
    trace.attempts.every(attempt => Boolean(attempt) && typeof attempt === 'object' &&
      (attempt.sourceMapId === undefined || typeof attempt.sourceMapId === 'string') &&
      (attempt.candidateUrl === undefined || typeof attempt.candidateUrl === 'string') &&
      (attempt.discoverySourceUrl === undefined || typeof attempt.discoverySourceUrl === 'string') &&
      (attempt.pageTitle === undefined || typeof attempt.pageTitle === 'string') &&
      (attempt.error === undefined || typeof attempt.error === 'string') &&
      (attempt.discoveryStage === undefined || ['MAPPED_SOURCE', 'SITEMAP_DISCOVERY', 'OFFICIAL_DOMAIN_SEARCH'].includes(attempt.discoveryStage)) &&
      (attempt.searchQueryVariant === undefined || ['FULL_QUERY', 'TOPIC_HINT_1', 'TOPIC_HINT_2', 'TOPIC_HINT_3'].includes(attempt.searchQueryVariant))
    );
}

function safeEvidenceQualityTrace(value: unknown): AuthorityEvidenceQualityTrace | undefined {
  return hasAdmissionCriticalTraceShape(value) ? value : undefined;
}

function admissionTraceAssessment(value: unknown): Pick<AuthorityIssueAdmissionDiagnostics,
  'retrievalTraceStatus' | 'retrievalTraceOptionalMetadataStatus' | 'retrievalEvidenceQualityTrace'> {
  if (value === undefined || value === null) return {
    retrievalTraceStatus: 'UNAVAILABLE', retrievalTraceOptionalMetadataStatus: 'NOT_PROVIDED'
  };
  const hasOptionalMetadata = Boolean(value && typeof value === 'object' && Object.keys(value).some(key => key !== 'attempts') ||
    Array.isArray((value as { attempts?: unknown[] } | null)?.attempts) &&
      (value as { attempts: unknown[] }).attempts.some(attempt => attempt && typeof attempt === 'object' &&
        Object.keys(attempt).some(key => !['topicId', 'fetchStatus', 'titleMatched', 'contentMatched', 'finalUrl'].includes(key))));
  const optionalMetadataStatus = !hasOptionalMetadata ? 'NOT_PROVIDED' as const
    : hasValidOptionalTraceMetadata(value) ? 'VALID' as const : 'INVALID' as const;
  const trace = safeEvidenceQualityTrace(value);
  return {
    retrievalTraceStatus: trace ? 'AVAILABLE' : 'INVALID',
    retrievalTraceOptionalMetadataStatus: optionalMetadataStatus,
    ...(trace ? { retrievalEvidenceQualityTrace: trace } : {})
  };
}

function defaultLocalProvider(authority: SemanticAuthority, retriever: ISourceRetriever, referenceDate: string): AuthorityEvidenceProvider {
  return {
    authority,
    async retrieve(request: AuthorityEvidenceRequest): Promise<AuthorityEvidenceProviderResult> {
      const retrieverAuthority = authority ? retrievalAuthority(authority) : undefined;
      const topics = getCoverageTopicsByIds(request.retrievalIntent.topicIds);
      const domain = sourceQueryDomain(request.retrievalIntent.topicIds);
      if (!authority || !retrieverAuthority || topics.length === 0 || !domain) return { candidates: [], trace: getDefaultTrace(false) };
      const acraFacts = authority === 'ACRA' ? identifyAcraAnnualReturnCompanyFacts(request.originalQuery) : undefined;
      const resolvedTarget = authority === 'ACRA'
        ? defaultTargetDateResolver.resolveTargetDate(request.originalQuery, referenceDate)
        : undefined;
      const applicabilityTarget = authority === 'ACRA' &&
        requiresAcraAnnualReturnDeadlineEvidence(request.originalQuery, authority, request.issue) &&
        resolvedTarget?.source === 'EXPLICIT' && acraFacts?.financialYearEnd === resolvedTarget.targetDate
        ? 'ACRA_FYE' as const
        : undefined;
      const candidates = await retriever.retrieveSources({
        query: request.originalQuery,
        domain,
        authorities: [retrieverAuthority],
        topicIds: request.retrievalIntent.topicIds,
        requestedConcepts: request.retrievalIntent.requestedConcepts,
        ...(resolvedTarget?.targetDate ? { targetDate: resolvedTarget.targetDate } : {}),
        ...(applicabilityTarget ? { applicabilityTarget } : {}),
        maxResults: 40,
        referenceDate
      });
      return { candidates, trace: getDefaultTrace(candidates.length > 0) };
    }
  };
}

export { defaultLocalProvider as createLocalAuthorityEvidenceProvider };

function versioningManagerFor(retriever: ISourceRetriever): SourceVersioningManager {
  return retriever.getVersioningManager?.() || defaultSourceVersioningManager;
}


/**
 * Apply the same official sitemap -> fetched page -> topic validator fallback to
 * ACRA, CPF, MOM and MAS. Only the current request's missing evidence is fetched.
 * Live candidate records remain CANDIDATE; the per-issue claim gate below must
 * independently admit them using the exact retrieval trace.
 */
function defaultOfficialStatutoryProvider(
  authority: OfficialDiscoveryAuthority,
  plan: InternalPlan,
  options: AuthorityWorkstreamOptions,
  retriever: ISourceRetriever,
  referenceDate: string
): AuthorityEvidenceProvider {
  const localProvider = defaultLocalProvider(authority, retriever, referenceDate);
  return {
    authority,
    async retrieve(request: AuthorityEvidenceRequest): Promise<AuthorityEvidenceProviderResult> {
      const local = await localProvider.retrieve(request);
      if (options.localOnly || options.groundingOptions?.localOnly) return local;
      const topics = getCoverageTopicsByIds(request.retrievalIntent.topicIds);
      const requireAcraDeadlineEvidence = requiresAcraAnnualReturnDeadlineEvidence(
        request.originalQuery, authority, request.issue
      );
      const targetDate = defaultTargetDateResolver.resolveTargetDate(request.originalQuery, referenceDate).targetDate;
      const versioningManager = versioningManagerFor(retriever);
      const localAdmission = eligibleLocalRecords(
        local.candidates, request.issue, authority, topics,
        request.retrievalIntent.requestedConcepts, request.originalQuery, targetDate, referenceDate, undefined, versioningManager,
        requireAcraDeadlineEvidence
      );
      const localCoverage = localAdmission.admitted.length > 0 && topics.every(topic =>
        localAdmission.admitted.some(record => topicBoundToRecord(record, topic))
      ) && (!requireAcraDeadlineEvidence || localAdmission.admitted.some(record =>
        supportsAcraAnnualReturnDeadlineEvidence(record.sourceText)
      )) && request.retrievalIntent.requestedConcepts.every(concept =>
        localAdmission.admitted.some(record => [concept.label, ...concept.terms]
          .some(term => term.trim() && textSupportsPhrase(record.sourceText, term)))
      );
      if (localCoverage) return local;
      const scope = issueScope(request.issue, plan,
        request.retrievalIntent.topicIds, request.retrievalIntent.requestedConcepts);
      if (!scope) return local;
      const fetched = await resolveMappedOfficialSourceFallback(
        request.retrievalIntent.topicIds, request.originalQuery, retriever, {
          ...options.groundingOptions,
          referenceDate,
          evidenceScope: scope,
          // Injected first-party transports stay under the same shared allowlist.
          localOnly: false
        }
      );
      return {
        candidates: [...local.candidates, ...fetched.records],
        trace: mapSourceMapTrace(fetched.trace),
        evidenceQualityTrace: fetched.trace
      };
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
          requestCompletenessContext: options.requestCompletenessContext,
          evidenceScope: scope,
          authorityIssue: validatedIrasAuthorityIssue(request.issue, request.retrievalIntent.requestedConcepts, understanding, query),
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

/** Carry an IRAS explanation issue to rendering only when it matches one validated raw semantic child. */
function validatedIrasAuthorityIssue(
  issue: ReconciledSemanticQuestionIssue,
  requestedConcepts: RequestedQuestionConcept[],
  understanding: SemanticQuestionUnderstanding,
  query: string
): { authority: 'IRAS'; issue: ReconciledSemanticQuestionIssue; requestedConcepts: RequestedQuestionConcept[] } | undefined {
  const interpretation = understanding.interpretation;
  const rawIssues = interpretation?.issues;
  if (understanding.assessmentStatus !== 'PASSED' || !interpretation || !rawIssues ||
      !validateSemanticQuestionInterpretation(interpretation, query) || issue.status !== 'MAPPED' ||
      issue.operation !== 'EXPLAIN_RULE' || issue.domain === 'UNKNOWN' || !issue.domain.startsWith('IRAS_') ||
      issue.governingAuthorities.length !== 1 || issue.governingAuthorities[0] !== 'IRAS' ||
      !Number.isFinite(issue.confidence) || issue.confidence < SEMANTIC_QUESTION_MIN_CONFIDENCE) return undefined;

  const matchingRawIssues = rawIssues.filter(raw => raw.subject === issue.subject && raw.population === issue.population &&
    raw.domain === issue.domain && raw.operation === issue.operation && raw.confidence === issue.confidence &&
    raw.governingAuthorities.length === 1 && raw.governingAuthorities[0] === 'IRAS' &&
    raw.contextualAuthorities.length === issue.contextualAuthorities.length &&
    raw.contextualAuthorities.every((authority, index) => authority === issue.contextualAuthorities[index]));
  if (matchingRawIssues.length !== 1 || matchingRawIssues[0].confidence < SEMANTIC_QUESTION_MIN_CONFIDENCE) return undefined;
  return { authority: 'IRAS', issue, requestedConcepts };
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

function conceptOwnershipTerms(value: string): string[] {
  // Treat the joined and hyphenated spellings as the same recipient qualifier
  // without collapsing ordinary "resident" into the non-resident concept.
  const normalized = normalizeEvidenceText(value).replace(/\bnon\s+resident\b/g, 'nonresident');
  return [...new Set(normalized.split(' ')
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

const GENERIC_ACRA_ANNUAL_RETURN_DUTY_CONCEPT_LABELS = new Set([
  'annual return', 'annual returns', 'annual return filing', 'annual returns filing',
  'filing requirement', 'filing requirements', 'filing duty', 'filing duties', 'filing obligation', 'filing obligations',
  'annual return filing requirement', 'annual return filing requirements',
  'annual return filing duty', 'annual return filing duties',
  'annual return filing obligation', 'annual return filing obligations'
]);

const GENERIC_MAS_CMS_RULE_CONCEPT_LABELS = new Set([
  'licensing requirement', 'general licensing requirement', 'cms licensing requirement', 'cms licence requirement',
  'capital markets services licence requirement', 'capital markets services license requirement',
  'capital markets services licence and general requirement', 'capital markets services license and general requirement'
]);

const GENERIC_MOM_PART_IV_COVERAGE_CONCEPT_LABELS = new Set([
  'part iv coverage', 'part 4 coverage', 'employee coverage',
  'part iv employee coverage', 'part 4 employee coverage'
]);

function isGenericMasCmsRuleConcept(concept: RequestedQuestionConcept): boolean {
  return GENERIC_MAS_CMS_RULE_CONCEPT_LABELS.has(normalizeEvidenceText(concept.label)) &&
    concept.terms.every(term => GENERIC_MAS_CMS_RULE_CONCEPT_LABELS.has(normalizeEvidenceText(term)));
}

function isMasCmsDefinitionConcept(concept: RequestedQuestionConcept): boolean {
  return concept.id === 'mas_cms_licence_definition';
}

function isGenericMomPartIvCoverageConcept(concept: RequestedQuestionConcept): boolean {
  return concept.role !== 'CONTEXT_ONLY' &&
    GENERIC_MOM_PART_IV_COVERAGE_CONCEPT_LABELS.has(normalizeEvidenceText(concept.label)) &&
    concept.terms.every(term => GENERIC_MOM_PART_IV_COVERAGE_CONCEPT_LABELS.has(normalizeEvidenceText(term)));
}

/** Scope generic coverage labels to the mapped MOM Part IV employee coverage rule. */
function momPartIvCoverageConceptSupport(
  text: string,
  issue: ReconciledSemanticQuestionIssue,
  topics: SingaporeCoverageTopic[],
  concept: RequestedQuestionConcept,
  originalQuery: string
): boolean {
  const allowedTopicIds = new Set(['mom-part-iv-overtime', 'mom_overtime']);
  const requestedAuthorities = (concept.semanticAuthorities || []).filter(authority => authority !== 'UNKNOWN');
  const conceptTopicIdsAreCompatible = concept.topicIds.every(topicId => allowedTopicIds.has(topicId));
  if (!isGenericMomPartIvCoverageConcept(concept) || issue.domain !== 'MOM_EMPLOYMENT' ||
      issue.population !== 'EMPLOYEE' || issue.operation !== 'EXPLAIN_RULE' || issue.status !== 'MAPPED' ||
      issue.governingAuthorities.length !== 1 || issue.governingAuthorities[0] !== 'MOM' ||
      !issue.mappedTopicIds.includes('mom-part-iv-overtime') || topics.length === 0 ||
      !topics.some(topic => topic.id === 'mom-part-iv-overtime' && topic.domainId === 'MOM_EMPLOYMENT') ||
      !topics.every(topic => allowedTopicIds.has(topic.id) && topic.domainId === 'MOM_EMPLOYMENT') ||
      (concept.semanticDomain !== undefined && concept.semanticDomain !== 'UNKNOWN' && concept.semanticDomain !== 'MOM_EMPLOYMENT') ||
      (concept.semanticPopulation !== undefined && concept.semanticPopulation !== 'UNKNOWN' && concept.semanticPopulation !== 'EMPLOYEE') ||
      (requestedAuthorities.length > 0 && !requestedAuthorities.includes('MOM')) || !conceptTopicIdsAreCompatible) return false;

  return supportBoundedStatutoryAdvisory({
    authority: 'MOM',
    topicId: 'mom-part-iv-overtime',
    subject: issue.subject,
    originalQuery,
    sourceText: text
  }) === true;
}

/** Scope acronym-based CMS support to the mapped MAS company general-rule issue. */
function masCmsGeneralRuleSupport(
  text: string,
  issue: ReconciledSemanticQuestionIssue,
  topics: SingaporeCoverageTopic[],
  originalQuery: string
): boolean | undefined {
  if (!isMappedMasCmsRuleIssue(issue, topics)) return undefined;
  if (issue.population === 'UNKNOWN' && !isNeutralGeneralMasCmsRuleIssue(issue, originalQuery)) return false;
  if (issue.population !== 'COMPANY' && issue.population !== 'UNKNOWN') return undefined;
  return supportMasCmsRule({
    authority: 'MAS',
    topicId: 'mas-cms-licence',
    subject: issue.subject,
    originalQuery,
    sourceText: text
  });
}

/** Keep the SFA definition request separate from the general licensing duty. */
function masCmsDefinitionSupport(
  text: string,
  issue: ReconciledSemanticQuestionIssue,
  topics: SingaporeCoverageTopic[],
  originalQuery: string
): boolean | undefined {
  if (!isMappedMasCmsRuleIssue(issue, topics)) return undefined;
  if (issue.population === 'UNKNOWN' && !isNeutralGeneralMasCmsRuleIssue(issue, originalQuery)) return false;
  if (issue.population !== 'COMPANY' && issue.population !== 'UNKNOWN') return undefined;
  return supportMasCmsDefinition({
    authority: 'MAS',
    topicId: 'mas-cms-licence',
    subject: issue.subject,
    originalQuery,
    sourceText: text
  });
}

function isMappedMasCmsRuleIssue(
  issue: ReconciledSemanticQuestionIssue,
  topics: SingaporeCoverageTopic[]
): boolean {
  return issue.domain === 'MAS_FUNDS' && issue.operation === 'EXPLAIN_RULE' && issue.status === 'MAPPED' &&
    issue.governingAuthorities.length === 1 && issue.governingAuthorities[0] === 'MAS' &&
    issue.mappedTopicIds.includes('mas-cms-licence') &&
    topics.some(topic => topic.id === 'mas-cms-licence' && topic.domainId === 'MAS_FUND_MANAGEMENT');
}

/** The bounded MAS recognizer validates neutral request scope without source text. */
function isNeutralGeneralMasCmsRuleIssue(
  issue: ReconciledSemanticQuestionIssue,
  originalQuery: string
): boolean {
  if (issue.domain !== 'MAS_FUNDS' || issue.operation !== 'EXPLAIN_RULE' || issue.status !== 'MAPPED' ||
      issue.governingAuthorities.length !== 1 || issue.governingAuthorities[0] !== 'MAS' ||
      !issue.mappedTopicIds.includes('mas-cms-licence')) return false;
  const request = {
    authority: 'MAS', topicId: 'mas-cms-licence', subject: issue.subject, originalQuery, sourceText: ''
  };
  return supportMasCmsRule(request) !== undefined || supportMasCmsDefinition(request) !== undefined;
}

function hasAnnualReturnFilingDutyAnchors(text: string): boolean {
  const normalized = normalizeEvidenceText(text);
  return /\bannual returns?\b/.test(normalized) &&
    /\b(?:filing|file|filed|lodge|lodged|submit|submitted)\b/.test(normalized) &&
    /\b(?:duty|duties|obligation|obligations|requirement|requirements|required|must|shall|need to|needs to|have to|has to)\b/.test(normalized);
}

function hasAcraAnnualReturnPenaltyOrFeeAsk(query: string, issue: ReconciledSemanticQuestionIssue): boolean {
  const issueSubject = normalizeEvidenceText(issue.subject);
  if (/\b(?:penalt(?:y|ies)|fine|fines|fee|fees|extension of time|enforcement action)\b/.test(issueSubject)) return true;
  const clauses = query.replace(/,?\s+and\s+(?=(?:what|when|how|which|calculate|explain|determine|assess)\b)/gi, '\n')
    .split(/[.!?;\n]+/).map(normalizeEvidenceText).filter(Boolean);
  return clauses.some(clause => /\bannual returns?\b/.test(clause) &&
    /\b(?:penalt(?:y|ies)|fine|fines|fee|fees|extension of time|enforcement action)\b/.test(clause));
}

function hasAffirmativeAcraAnnualReturnDeadlineAsk(query: string): boolean {
  const queryWithoutExcludedTiming = query.replace(
    /\b(?:do not|don't|never)\s+(?:calculate|compute|determine|provide|explain|state|give)\b[^.!?;]*\b(?:deadline|due date|filing date|filing time|timeframe|time frame|when|how many months?|how long|how soon|what date|by what date)\b[^.!?;]*/gi,
    ' '
  );
  return isAcraAnnualReturnDeadlineQuestion(queryWithoutExcludedTiming);
}

/** Scope the general ACRA duty rule to its own mapped explanation issue. */
function isAcraAnnualReturnFilingDutyIssue(
  query: string,
  authority: SemanticAuthority,
  issue: ReconciledSemanticQuestionIssue,
  topics: SingaporeCoverageTopic[]
): boolean {
  const issueSubject = normalizeEvidenceText(issue.subject);
  const issueAnchors = semanticOwnerAnchors(issue.subject);
  const generalDutyClause = getSemanticQueryClauses(query).some(clause => {
    const matchingIssueAnchors = issueAnchors.filter(anchor => hasSemanticOwnerAnchor(clause, anchor));
    return hasAnnualReturnFilingDutyAnchors(clause) && /\bcompan(?:y|ies)\b/i.test(clause) &&
      matchingIssueAnchors.length >= Math.min(2, issueAnchors.length) &&
      !hasAcraSpecificAnnualReturnRegimeAsk(clause) &&
      !hasAffirmativeAcraAnnualReturnDeadlineAsk(clause) &&
      !hasAcraAnnualReturnPenaltyOrFeeAsk(clause, issue);
  });
  return authority === 'ACRA' && issue.domain === 'ACRA_CORPORATE' && issue.population === 'COMPANY' &&
    ['EXPLAIN_RULE', 'FILING_REQUIREMENT'].includes(issue.operation) && issue.status === 'MAPPED' &&
    issue.governingAuthorities.length === 1 && issue.governingAuthorities[0] === 'ACRA' &&
    issue.mappedTopicIds.includes('acra_annual-returns') && topics.length === 1 &&
    topics[0].id === 'acra_annual-returns' &&
    generalDutyClause && hasAnnualReturnFilingDutyAnchors(issue.subject) &&
    !hasAcraSpecificAnnualReturnRegimeAsk(issueSubject) &&
    !hasAffirmativeAcraAnnualReturnDeadlineAsk(issueSubject) &&
    !hasAcraAnnualReturnPenaltyOrFeeAsk(issueSubject, issue);
}

function hasAcraSpecificAnnualReturnRegimeAsk(value: string): boolean {
  return /\b(?:foreign|overseas|variable\s+capital\s+company|vcc|xbrl)\b/i.test(value);
}

function isGenericAcraAnnualReturnDutyConcept(concept: RequestedQuestionConcept): boolean {
  return GENERIC_ACRA_ANNUAL_RETURN_DUTY_CONCEPT_LABELS.has(normalizeEvidenceText(concept.label));
}

function hasIrasTaxFilingContentInParagraph(text: string): boolean {
  const normalized = normalizeEvidenceText(text);
  const mentionsIras = /\b(?:iras|inland revenue authority of singapore)\b/.test(normalized);
  const mentionsTaxFilingSubject = /\b(?:taxes|tax returns?|income tax|corporate income tax|tax filing)\b/.test(normalized);
  const mentionsFilingAction = /\b(?:file|filed|filing|lodge|lodged|lodge|submit|submitted|submission)\b/.test(normalized);
  return mentionsIras && mentionsTaxFilingSubject && mentionsFilingAction;
}

function isExactAcraAnnualReturnDutyParagraph(sourceText: string, quote: string): boolean {
  const normalizedQuote = quote.trim();
  const isIndividualSourceBlock = sourceText.split(/\r?\n[\t ]*\r?\n+/)
    .map(block => block.trim()).filter(Boolean).includes(normalizedQuote);
  const hasSeparateFilingSpecificity = /\b(?:deadlines?|due dates?|filing dates?|filing times?|on time|penalt(?:y|ies)|fines?|fees?|enforcement action|extension of time|within\s+(?:\d+|[a-z -]+)\s+months?|months?\s+after\s+fye|fye)\b/i.test(normalizedQuote);
  if (isIndividualSourceBlock && supportsAcraAnnualReturnFilingRule(normalizedQuote) &&
      !hasSeparateFilingSpecificity && !hasIrasTaxFilingContentInParagraph(normalizedQuote)) return true;

  // ACRA's live late-filing page puts its operative duty first, followed by
  // two separately stated sentences about late-filing context. Permit the
  // exact leading sentence only for those known ancillary sentences. Any
  // added exception or applicability condition stays attached to the quote.
  const sourceBlock = sourceText.split(/\r?\n[\t ]*\r?\n+/)
    .map(block => block.trim()).find(block => block.startsWith(`${normalizedQuote} `));
  if (!sourceBlock || hasIrasTaxFilingContentInParagraph(sourceBlock)) return false;
  const match = sourceBlock.match(/^(.+?[.!?])\s+([\s\S]+)$/);
  if (!match || match[1] !== normalizedQuote || !supportsAcraAnnualReturnFilingRule(normalizedQuote)) return false;
  const ancillarySentences = match[2].split(/(?<=[.!?])\s+/).map(sentence => sentence.trim()).filter(Boolean);
  const knownAncillarySentences = new Set([
    'if you have missed the deadline for annual returns it is important to act quickly',
    'filing late can lead to enforcement action against your company and its officers'
  ]);
  return ancillarySentences.length > 0 && ancillarySentences.every(sentence =>
    knownAncillarySentences.has(normalizeEvidenceText(sentence)));
}

function hasCompanyTaxResidencyAnchors(text: string): boolean {
  const normalized = normalizeEvidenceText(text);
  return /\b(?:company|companies|corporate|corporation)\b/.test(normalized) &&
    /\btax\b/.test(normalized) && /\b(?:residence|residency|resident)\b/.test(normalized);
}

const GENERAL_COMPANY_TAX_RESIDENCY_CONCEPT_WORDS = new Set([
  'a', 'and', 'assessment', 'business', 'company', 'companies', 'control', 'corporate', 'corporation', 'criteria', 'determination', 'general',
  'criterion', 'determine', 'determined', 'determines', 'does', 'exercise', 'exercised', 'for', 'here', 'how', 'in',
  'is', 'management', 'of', 'place', 'residence', 'residency', 'resident', 'rule', 'rules', 'singapore', 'tax',
  'test', 'the', 'whether', 'where', 'year'
]);

function isGeneralCompanyTaxResidencyConcept(concept: RequestedQuestionConcept): boolean {
  const normalized = normalizeEvidenceText([concept.label, ...concept.terms].join(' '));
  const words = normalized.split(' ').filter(Boolean);
  return hasCompanyTaxResidencyAnchors(normalized) && words.every(word => GENERAL_COMPANY_TAX_RESIDENCY_CONCEPT_WORDS.has(word));
}

function isGeneralCompanyTaxResidencySubject(subject: string): boolean {
  const normalized = normalizeEvidenceText(subject);
  const words = normalized.split(' ').filter(Boolean);
  return hasCompanyTaxResidencyAnchors(normalized) && words.every(word => GENERAL_COMPANY_TAX_RESIDENCY_CONCEPT_WORDS.has(word));
}

function generalIrasRuleConceptSupport(
  text: string,
  issue: ReconciledSemanticQuestionIssue,
  topics: SingaporeCoverageTopic[],
  concepts: RequestedQuestionConcept[] = []
): boolean | undefined {
  if (!issue.governingAuthorities.includes('IRAS')) return undefined;
  const individualCpfCashTopUpScope = issue.domain === 'IRAS_INCOME_TAX' && issue.population === 'INDIVIDUAL' &&
    concepts.length > 0 && concepts.every(concept => INDIVIDUAL_CPF_CASH_TOP_UP_CONCEPT_IDS.has(concept.id) &&
      concept.topicIds.includes(INDIVIDUAL_CPF_CASH_TOP_UP_TOPIC_ID)) &&
    topics.some(topic => topic.id === INDIVIDUAL_CPF_CASH_TOP_UP_TOPIC_ID && topic.domainId === 'IRAS_INDIVIDUAL_TAX');
  if (issue.population !== 'COMPANY' && !individualCpfCashTopUpScope) return undefined;
  const expectedDomainId = individualCpfCashTopUpScope ? 'IRAS_INDIVIDUAL_TAX'
    : issue.domain === 'IRAS_INCOME_TAX' ? 'IRAS_CORPORATE_TAX'
      : issue.domain === 'IRAS_GST' ? 'IRAS_GST' : undefined;
  if (!expectedDomainId) return undefined;
  for (const topic of topics) {
    if (topic.domainId !== expectedDomainId) continue;
    const associatedTopicIds = [...new Set([...issue.mappedTopicIds, topic.id, ...concepts.flatMap(concept => concept.topicIds)])];
    const support = supportGeneralIrasRuleConcept({
      sourceText: text,
      domainId: topic.domainId,
      topicIds: associatedTopicIds,
      subject: issue.subject,
      population: issue.population,
      concepts
    });
    if (support !== undefined) return support;
  }
  return undefined;
}

function practicalRuleAuthorityForTopic(topic: SingaporeCoverageTopic): SemanticAuthority | undefined {
  if (topic.id === 'iras-cit-eci' && topic.domainId === 'IRAS_CORPORATE_TAX') return 'IRAS';
  if (topic.id === 'acra_company-secretary' && topic.domainId === 'ACRA_COMPANIES') return 'ACRA';
  return undefined;
}

function practicalRuleIssueScopeMatches(
  issue: ReconciledSemanticQuestionIssue,
  topic: SingaporeCoverageTopic,
  authority: SemanticAuthority
): boolean {
  const expectedIssueDomain = authority === 'IRAS' ? 'IRAS_INCOME_TAX' : 'ACRA_CORPORATE';
  return issue.status === 'MAPPED' && issue.domain === expectedIssueDomain && issue.population === 'COMPANY' &&
    issue.operation === 'EXPLAIN_RULE' && issue.governingAuthorities.length === 1 &&
    issue.governingAuthorities[0] === authority && issue.mappedTopicIds.includes(topic.id);
}

function practicalRuleIssueTextSupport(
  text: string,
  query: string,
  issue: ReconciledSemanticQuestionIssue,
  topic: SingaporeCoverageTopic,
  concept?: RequestedQuestionConcept
): boolean | undefined {
  const coverageRequest = {
    authority: topic.authorities[0] || '', topicId: topic.id,
    query, subject: issue.subject, sourceText: text
  };
  if (hasPracticalExpansionContradiction(coverageRequest)) return false;
  const expansionSupport = supportPracticalExpansionRule(coverageRequest);
  // Incomplete evidence may still establish an older, narrower rule. Only a
  // complete expansion proof supplements scope support; contradiction vetoes it.
  const coverageSupport = (expansionSupport === true ? true : undefined) ?? supportIrasCpfCoverageRule(coverageRequest) ??
    supportMomAcraMasCoverageRule(coverageRequest);
  if (coverageSupport !== undefined) {
    const topicAuthority = topic.authorities[0] as SemanticAuthority | undefined;
    const expectedDomain: Readonly<Record<string, string>> = {
      IRAS: topic.domainId === 'IRAS_CORPORATE_TAX' ? 'IRAS_INCOME_TAX' : 'IRAS_GST', CPF: 'CPF_PAYROLL', MOM: 'MOM_EMPLOYMENT',
      ACRA: 'ACRA_CORPORATE', MAS: 'MAS_FUNDS'
    };
    const expectedPopulation = topicAuthority === 'CPF' ? 'EMPLOYER'
      : topicAuthority === 'IRAS' || topicAuthority === 'ACRA' || topicAuthority === 'MAS' ? 'COMPANY'
        : undefined;
    const allowedOperations = expansionSupport === true || topicAuthority === 'ACRA' || topicAuthority === 'MAS'
      ? ['EXPLAIN_RULE', 'CHECK_ELIGIBILITY', 'FILING_REQUIREMENT',
          ...(topicAuthority === 'CPF' && supportStatutoryKnowledgeRule(coverageRequest) === true ? ['CALCULATE'] : [])]
      : ['EXPLAIN_RULE', 'FILING_REQUIREMENT'];
    const hasSpecificMOMPopulationRequest = /\b(?:my|our|this|that|a specific|named)\s+(?:employee|worker|person|annual leave|leave entitlement|leave balance)\b/i
      .test(`${query}\n${issue.subject}`);
    const unknownMOMGeneralRule = topicAuthority === 'MOM' && issue.population === 'UNKNOWN' &&
      expansionSupport === true && ['EXPLAIN_RULE', 'CHECK_ELIGIBILITY'].includes(issue.operation) &&
      !hasSpecificMOMPopulationRequest;
    const populationMatches = topicAuthority === 'MOM'
      ? ['EMPLOYEE', 'EMPLOYER'].includes(issue.population) || unknownMOMGeneralRule
      : issue.population === expectedPopulation;
    const scopeMatches = issue.status === 'MAPPED' && topicAuthority &&
      issue.domain === expectedDomain[topicAuthority] && issue.governingAuthorities.length === 1 &&
      issue.governingAuthorities[0] === topicAuthority && issue.mappedTopicIds.includes(topic.id) &&
      allowedOperations.includes(issue.operation) &&
      populationMatches;
    if (!scopeMatches || coverageSupport !== true) return false;
    // This receives only concepts already uniquely assigned to this issue by requestedConceptsForIssue.
    if (concept && (concept.role === 'CONTEXT_ONLY' ||
        !concept.topicIds.includes(topic.id) && concept.topicIds.length > 0 ||
        concept.semanticDomain !== undefined && concept.semanticDomain !== issue.domain ||
        concept.semanticPopulation !== undefined && concept.semanticPopulation !== issue.population ||
        concept.semanticAuthorities !== undefined &&
          (concept.semanticAuthorities.length !== 1 || concept.semanticAuthorities[0] !== topicAuthority))) return false;
    if (concept) {
      const conceptRequest = { ...coverageRequest, subject: [concept.label, ...concept.terms].join(' ') };
      const conceptSupport = supportPracticalExpansionRule(conceptRequest) ?? supportIrasCpfCoverageRule(conceptRequest) ??
        supportMomAcraMasCoverageRule(conceptRequest);
      if (conceptSupport !== true) return false;
    }
    return true;
  }

  const authority = practicalRuleAuthorityForTopic(topic);
  if (!authority) return undefined;
  const issueSubjectProof = supportIrasAcraPracticalRuleSource(query, authority, topic.id, issue.subject, text);
  if (issueSubjectProof === undefined) return undefined;
  if (!practicalRuleIssueScopeMatches(issue, topic, authority)) return false;
  if (issueSubjectProof !== true) return false;
  if (concept) {
    if (concept.role === 'CONTEXT_ONLY' || !concept.topicIds.includes(topic.id) ||
        concept.semanticDomain !== undefined && concept.semanticDomain !== issue.domain ||
        concept.semanticPopulation !== undefined && concept.semanticPopulation !== issue.population ||
        concept.semanticAuthorities !== undefined &&
          (concept.semanticAuthorities.length !== 1 || concept.semanticAuthorities[0] !== authority)) return false;
    const conceptSubjectProof = supportIrasAcraPracticalRuleSource(query, authority, topic.id,
      [concept.label, ...concept.terms].join(' '), text);
    if (conceptSubjectProof !== true) return false;
  }
  return true;
}

function supportsIssueSubject(
  text: string,
  issue: ReconciledSemanticQuestionIssue,
  topic: SingaporeCoverageTopic,
  concepts: RequestedQuestionConcept[] = [],
  originalQuery = ''
): boolean {
  const practicalRuleSupport = practicalRuleIssueTextSupport(text, originalQuery, issue, topic);
  if (practicalRuleSupport !== undefined) return practicalRuleSupport;
  if (topic.id === 'mom-salary-payment' && topic.domainId === 'MOM_EMPLOYMENT' &&
      issue.mappedTopicIds.includes(topic.id)) {
    const momSalarySupport = momSalaryPaymentIssueSupport(text, issue, 'MOM', originalQuery);
    if (momSalarySupport !== undefined) return momSalarySupport;
  }
  const requestedCmsDefinition = concepts.some(isMasCmsDefinitionConcept);
  if (requestedCmsDefinition &&
      masCmsDefinitionSupport(text, issue, [topic], originalQuery) === true) return true;
  const masRuleSupport = masCmsGeneralRuleSupport(text, issue, [topic], originalQuery);
  if (masRuleSupport !== undefined) return masRuleSupport;
  const generalRuleSupport = generalIrasRuleConceptSupport(text, issue, [topic], concepts);
  if (generalRuleSupport !== undefined) return generalRuleSupport;
  const companyTaxResidencyScope = issue.domain === 'IRAS_INCOME_TAX' && issue.population === 'COMPANY' &&
    topic.id === 'iras-corporate-tax-residency' && topic.domainId === 'IRAS_CORPORATE_TAX';
  if (companyTaxResidencyScope && isGeneralCompanyTaxResidencySubject(issue.subject)) {
    return hasCompanyTaxResidencyAnchors(text);
  }
  return textSupportsPhrase(text, issue.subject);
}

function momSalaryPaymentIssueSupport(
  text: string,
  issue: ReconciledSemanticQuestionIssue,
  authority: SemanticAuthority,
  query: string
): boolean | undefined {
  if (authority !== 'MOM' || issue.domain !== 'MOM_EMPLOYMENT' || issue.operation !== 'EXPLAIN_RULE' ||
      !issue.mappedTopicIds.includes('mom-salary-payment') || /\bovertime\b/i.test(query)) return undefined;
  const sourceSupport = supportMomSalaryPaymentIssue(query, issue.subject, text);
  if (sourceSupport === undefined) return undefined;
  if (issue.status !== 'MAPPED' || issue.governingAuthorities.length !== 1 || issue.governingAuthorities[0] !== 'MOM') return false;
  return sourceSupport;
}

function momSalaryPaymentConceptSupport(
  text: string,
  issue: ReconciledSemanticQuestionIssue,
  authority: SemanticAuthority,
  query: string,
  concept: RequestedQuestionConcept
): boolean | undefined {
  if (authority !== 'MOM' || issue.domain !== 'MOM_EMPLOYMENT' || issue.operation !== 'EXPLAIN_RULE' ||
      !issue.mappedTopicIds.includes('mom-salary-payment') || /\bovertime\b/i.test(query)) return undefined;
  const sourceSupport = supportMomSalaryPaymentConcept(query, issue.subject, concept.label, concept.terms, text);
  if (sourceSupport === undefined) return undefined;
  if (issue.status !== 'MAPPED' || issue.governingAuthorities.length !== 1 || issue.governingAuthorities[0] !== 'MOM') return false;
  return sourceSupport;
}

function passesBoundedStatutoryAdvisorySupport(
  text: string,
  authority: SemanticAuthority,
  issue: ReconciledSemanticQuestionIssue,
  topics: SingaporeCoverageTopic[],
  originalQuery: string
): boolean {
  return topics.every(topic => supportBoundedStatutoryAdvisory({
    authority,
    topicId: topic.id,
    subject: issue.subject,
    sourceText: text,
    originalQuery
  }) !== false);
}

function textSupportsTopic(text: string, topic: SingaporeCoverageTopic, requireAcraDeadlineTable = false): boolean {
  if (topic.id === 'acra_annual-returns') {
    if (requireAcraDeadlineTable) return supportsAcraAnnualReturnDeadlineTable(text);
    if (!supportsAcraAnnualReturnFilingRule(text)) return false;
  }
  const sourceFacingHints = topic.domainId.startsWith('IRAS_')
    ? [...(topic.paragraphHints || []), ...(topic.sectionHints || [])]
    : [];
  return [topic.title, ...(topic.aliases || []), ...topic.keywords, ...sourceFacingHints]
    .some(phrase => textSupportsPhrase(text, phrase));
}

function requiresUnverifiedCpfRateSchedule(
  query: string,
  issue: ReconciledSemanticQuestionIssue,
  authority: SemanticAuthority,
  topics: SingaporeCoverageTopic[]
): boolean {
  const hasTightlyBoundCpfRateAsk = (text: string) =>
    /\bCPF(?:\s+(?:employer|employee|contribution|contributions|payroll)){0,3}\s+rates?\b|\brates?\s+(?:for\s+(?:the\s+)?CPF(?:\s+contributions?)?|apply\s+to\s+(?:the\s+)?CPF(?:\s+contributions?)?)\b/i.test(text);
  const subjectRequestsRates = /\brates?\b|\bpercentages?\b/i.test(issue.subject);
  const requestedByScopedText = subjectRequestsRates ||
    query.split(/[.!?;\n]+/).some(clause => hasTightlyBoundCpfRateAsk(clause));
  const qualitativeRateFactorQuestion = issue.operation === 'EXPLAIN_RULE' &&
    /\b(?:factor|depend|determin|vary|information|why)\b/i.test(query) &&
    !/\b(?:what\s+(?:are|is)\s+(?:the\s+)?(?:current\s+)?rates?|what\s+(?:rate|percentage)|how much|calculate|compute|estimate|rate table|rate schedule)\b|\b\d+(?:\.\d+)?\s*%?|\$\s*\d/i.test(query);
  return authority === 'CPF' && issue.domain === 'CPF_PAYROLL' && issue.governingAuthorities.length === 1 &&
    issue.governingAuthorities[0] === 'CPF' && topics.some(topic => topic.id === 'cpf_contribution_rates') &&
    requestedByScopedText && !qualitativeRateFactorQuestion;
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

/** Lets only the bounded MOM Part IV issue count a canonical quote for its legacy alias topic. */
function supportsMomPartIvCanonicalAliasClaim(
  record: AuthoritativeSourceRecord,
  aliasTopic: SingaporeCoverageTopic,
  quote: string,
  authority: SemanticAuthority,
  issue: ReconciledSemanticQuestionIssue,
  originalQuery: string
): boolean {
  const canonicalTopicId = aliasTopic.canonicalConceptId;
  if (authority !== 'MOM' || issue.domain !== 'MOM_EMPLOYMENT' || issue.population !== 'EMPLOYEE' ||
      issue.operation !== 'EXPLAIN_RULE' || issue.status !== 'MAPPED' ||
      issue.governingAuthorities.length !== 1 || issue.governingAuthorities[0] !== 'MOM' ||
      !issue.mappedTopicIds.includes('mom-part-iv-overtime') || aliasTopic.id !== 'mom_overtime' ||
      canonicalTopicId !== 'mom-part-iv-overtime' || !issue.mappedTopicIds.includes(canonicalTopicId)) return false;

  const canonicalTopic = getCoverageTopicsByIds([canonicalTopicId]).find(topic => topic.id === canonicalTopicId);
  if (!canonicalTopic || canonicalTopic.canonicalConceptId !== canonicalTopicId ||
      aliasTopic.domainId !== issue.domain || canonicalTopic.domainId !== issue.domain ||
      aliasTopic.domainId !== canonicalTopic.domainId || !aliasTopic.authorities.includes('MOM') ||
      !canonicalTopic.authorities.includes('MOM') || !topicBoundToRecord(record, canonicalTopic) ||
      !recordMatchesGovernorAndDomain(record, authority, aliasTopic) ||
      !recordMatchesGovernorAndDomain(record, authority, canonicalTopic)) return false;

  const supportsCompleteCoverage = (sourceText: string) => supportBoundedStatutoryAdvisory({
    authority: 'MOM',
    topicId: canonicalTopicId,
    subject: issue.subject,
    originalQuery,
    sourceText
  }) === true;
  return supportsCompleteCoverage(record.sourceText) && supportsCompleteCoverage(quote);
}

function eligibleLocalRecords(
  records: AuthoritativeSourceRecord[],
  issue: ReconciledSemanticQuestionIssue,
  authority: SemanticAuthority,
  topics: SingaporeCoverageTopic[],
  concepts: RequestedQuestionConcept[],
  originalQuery: string,
  targetDate: string | undefined,
  referenceDate: string,
  officialRetrievalTrace?: AuthorityEvidenceQualityTrace,
  versioningManager: SourceVersioningManager = defaultSourceVersioningManager,
  requireAcraDeadlineEvidence = false
): { admitted: AuthoritativeSourceRecord[]; rejectedCount: number; diagnostics: AuthorityCandidateAdmissionDiagnostic[] } {
  const admitted: AuthoritativeSourceRecord[] = [];
  const diagnostics: AuthorityCandidateAdmissionDiagnostic[] = [];
  let rejectedCount = 0;
  for (const record of new Map(records.map(item => [item.id, item])).values()) {
    const reviewedLocalAttempted = record.provenance === 'LOCAL_STATIC';
    const reviewedLocalRegistryMatch = reviewedLocalAttempted ? matchesReviewedLocalRegistryRecord(record) : undefined;
    const isReviewedLocal = reviewedLocalAttempted && reviewedLocalRegistryMatch === true;
    // A live record is acceptable only if this very provider call fetched and
    // validated the exact URL for the same topic. An injected candidate with a
    // plausible URL, labels or hash but no retrieval trace is insufficient.
    const matchingFetch = officialRetrievalTrace?.attempts.find(attempt =>
      attempt.fetchStatus === 'SUCCESS' && attempt.titleMatched && attempt.contentMatched &&
      attempt.finalUrl === record.officialSourceUrl && topics.some(topic => attempt.topicId === topic.id &&
        topicBoundToRecord(record, topic))
    );
    const liveExternalAttempted = record.provenance === 'LIVE_EXTERNAL';
    const liveAuthorityAllowed = isOfficialDiscoveryAuthority(authority);
    const liveCandidateLifecycle = record.lifecycleState === 'CANDIDATE';
    const liveNeedsReview = record.sourceStatus === 'NEEDS_REVIEW';
    const livePartialExtraction = record.extractionStatus === 'PARTIAL';
    const liveVerificationMethod = record.verificationMethod === 'LIVE_OFFICIAL_TOPIC_VERIFIED';
    const liveSourceAuthority = record.sourceAuthority === authority ||
      (record.sourceAuthority === 'AGC' && record.officialSourceUrl.startsWith('https://sso.agc.gov.sg/'));
    const liveSelectedRecordId = officialRetrievalTrace?.selectedRecordIds?.includes(record.id) === true;
    const liveVerifiedUrl = officialRetrievalTrace?.finalVerifiedUrls?.includes(record.officialSourceUrl) === true;
    const liveSuccessfulTopicFetch = Boolean(matchingFetch);
    const isValidatedLive = record.provenance === 'LIVE_EXTERNAL' &&
      liveAuthorityAllowed &&
      liveCandidateLifecycle && liveNeedsReview &&
      livePartialExtraction && liveVerificationMethod &&
      liveSourceAuthority &&
      liveSelectedRecordId &&
      liveVerifiedUrl &&
      Boolean(matchingFetch);
    const exactManagedTopic = authority === 'MAS' && record.provenance === 'LIVE_PATCH' &&
      MANAGED_MAS_DOCUMENT_RECORD_IDS.has(record.id)
      ? topics.find(topic => topicBoundToRecord(record, topic) &&
        recordMatchesGovernorAndDomain(record, authority, topic))
      : authority === 'ACRA' && record.provenance === 'LIVE_PATCH' && record.documentAdmissionRequired === true &&
        record.authority === 'ACRA' && record.sourceAuthority === 'ACRA' && record.domain === 'ACRA_CORP' &&
        record.officialSourceUrl === ACRA_2022_ANNUAL_RETURN_TIMELINES_URL &&
        record.canonicalSourceUrl === ACRA_2022_ANNUAL_RETURN_TIMELINES_URL &&
        record.relatedTopicIds?.includes('acra_annual-returns')
        ? topics.find(topic => topic.id === 'acra_annual-returns' && topicBoundToRecord(record, topic) &&
          recordMatchesGovernorAndDomain(record, authority, topic))
        : undefined;
    const managedAdmission = exactManagedTopic
      ? verifySharedDocumentAdmission(record, versioningManager, {
        targetDate,
        referenceDate,
        expectedAuthority: authority === 'MAS' ? 'MAS' : 'ACRA',
        expectedDomain: exactManagedTopic.legacyDomains[0],
        ...(authority === 'ACRA' && requireAcraDeadlineEvidence ? { applicabilityTarget: 'ACRA_FYE' as const } : {})
      })
      : undefined;
    const isApprovedManagedDocument = Boolean(managedAdmission?.required && managedAdmission.admitted);
    const managedPathAttempted = authority === 'MAS' && record.provenance === 'LIVE_PATCH' &&
      MANAGED_MAS_DOCUMENT_RECORD_IDS.has(record.id) ||
      authority === 'ACRA' && record.provenance === 'LIVE_PATCH' && record.documentAdmissionRequired === true;
    const reviewedLocalPredicates = reviewedLocalAttempted ? [
      { predicate: 'reviewedRegistryMatch', passed: reviewedLocalRegistryMatch === true,
        result: reviewedLocalRegistryMatch ? 'MATCH' : 'NO_MATCH' }
    ] : [];
    const liveExternalPredicates: AuthorityAdmissionPredicateResult[] = liveExternalAttempted ? [
      { predicate: 'officialDiscoveryAuthority', passed: liveAuthorityAllowed },
      { predicate: 'lifecycleState', passed: liveCandidateLifecycle,
        result: record.lifecycleState || 'MISSING' },
      { predicate: 'sourceStatus', passed: liveNeedsReview,
        result: record.sourceStatus || 'MISSING' },
      { predicate: 'extractionStatus', passed: livePartialExtraction,
        result: record.extractionStatus || 'MISSING' },
      { predicate: 'verificationMethod', passed: liveVerificationMethod,
        result: record.verificationMethod || 'MISSING' },
      { predicate: 'sourceAuthority', passed: liveSourceAuthority,
        result: record.sourceAuthority || 'MISSING' },
      { predicate: 'selectedRecordId', passed: liveSelectedRecordId },
      { predicate: 'finalVerifiedUrl', passed: liveVerifiedUrl },
      { predicate: 'successfulTitleContentFetch', passed: liveSuccessfulTopicFetch,
        result: matchingFetch?.topicId || 'NO_MATCHING_SUCCESSFUL_TOPIC_FETCH' }
    ] : [];
    const managedDocumentPredicates: AuthorityAdmissionPredicateResult[] = managedPathAttempted ? [
      { predicate: 'exactManagedRecordAndTopic', passed: Boolean(exactManagedTopic),
        result: exactManagedTopic?.id || 'NO_EXACT_MANAGED_TOPIC' },
      ...(exactManagedTopic && managedAdmission ? [
        { predicate: 'admissionRequired', passed: managedAdmission.required,
          result: managedAdmission.required ? 'REQUIRED' : 'NOT_REQUIRED' },
        { predicate: 'admissionOutcome', passed: managedAdmission.admitted,
          result: managedAdmission.admitted ? 'ADMITTED' : 'REJECTED' }
      ] : [])
    ] : [];
    const provenancePaths: AuthorityCandidateProvenancePaths = {
      reviewedLocal: {
        attempted: reviewedLocalAttempted,
        admitted: isReviewedLocal,
        predicates: reviewedLocalPredicates,
        ...(!isReviewedLocal && reviewedLocalPredicates.some(predicate => !predicate.passed)
          ? { firstFailedPredicate: reviewedLocalPredicates.find(predicate => !predicate.passed)!.predicate } : {})
      },
      liveExternal: {
        attempted: liveExternalAttempted,
        admitted: isValidatedLive,
        predicates: liveExternalPredicates,
        ...(!isValidatedLive && liveExternalPredicates.some(predicate => !predicate.passed)
          ? { firstFailedPredicate: liveExternalPredicates.find(predicate => !predicate.passed)!.predicate } : {})
      },
      managedDocument: {
        attempted: managedPathAttempted,
        admitted: isApprovedManagedDocument,
        predicates: managedDocumentPredicates,
        ...(managedAdmission?.required === true && managedAdmission.admitted === false
          ? { admissionReason: managedAdmission.reason } : {}),
        ...(managedAdmission ? { admissionRequired: managedAdmission.required } : {}),
        ...(!isApprovedManagedDocument && managedDocumentPredicates.some(predicate => !predicate.passed)
          ? { firstFailedPredicate: managedDocumentPredicates.find(predicate => !predicate.passed)!.predicate } : {})
      }
    };
    const predicates: AuthorityAdmissionPredicateResult[] = [
      { predicate: 'provenance', passed: isReviewedLocal || isValidatedLive || isApprovedManagedDocument,
        result: isReviewedLocal ? 'REVIEWED_LOCAL' : isValidatedLive ? 'VALIDATED_CURRENT_FETCH' :
          isApprovedManagedDocument ? 'APPROVED_MANAGED_DOCUMENT' : 'NO_ADMISSIBLE_PROVENANCE' },
      { predicate: 'recordRole', passed: record.recordRole !== 'SOURCE_MAP_POINTER',
        result: record.recordRole === 'SOURCE_MAP_POINTER' ? 'SOURCE_MAP_POINTER' : 'EVIDENCE' },
      { predicate: 'groundingEligible', passed: record.groundingEligible !== false,
        result: record.groundingEligible === false ? 'EXPLICITLY_INELIGIBLE' : 'ELIGIBLE' },
      { predicate: 'requiredDeadlineEvidence', passed: !requireAcraDeadlineEvidence ||
        supportsAcraAnnualReturnDeadlineEvidence(record.sourceText),
        result: requireAcraDeadlineEvidence ? 'CHECKED' : 'NOT_REQUIRED' },
      { predicate: 'sourceTextPresent', passed: Boolean(record.sourceText?.trim()),
        result: record.sourceText?.trim() ? 'PRESENT' : 'EMPTY' }
    ];
    let eligibilityRejection: string | undefined;
    if (predicates.every(predicate => predicate.passed)) {
      eligibilityRejection = findRecordEligibilityRejection(record, targetDate, referenceDate,
        versioningManager, exactManagedTopic ? (authority === 'MAS' ? 'MAS' : 'ACRA') : undefined,
        exactManagedTopic?.legacyDomains[0],
        authority === 'ACRA' && requireAcraDeadlineEvidence ? 'ACRA_FYE' : undefined,
        topics.map(topic => ({ authority: topic.authorities[0], topicId: topic.id,
          query: originalQuery, subject: issue.subject })).find(request => sourceProvesKnowledgeDate({ ...request,
            sourceText: record.sourceText, officialUrl: record.officialSourceUrl }, targetDate)));
      predicates.push({ predicate: 'recordEligibility', passed: !eligibilityRejection,
        ...(eligibilityRejection ? { result: eligibilityRejection } : { result: 'ELIGIBLE' }) });
    }
    const firstSharedFailure = predicates.find(predicate => !predicate.passed)?.predicate;
    const topicDiagnostics: AuthorityTopicAdmissionDiagnostic[] = [];
    let firstTopicFailure: string | undefined;
    if (!firstSharedFailure) {
      const substantiveSupport = passesBoundedStatutoryAdvisorySupport(record.sourceText, authority, issue, topics, originalQuery);
      for (const topic of topics) {
        const topicPredicates: AuthorityAdmissionPredicateResult[] = [
          { predicate: 'topicBoundToRecord', passed: topicBoundToRecord(record, topic) },
          { predicate: 'governorAndDomain', passed: recordMatchesGovernorAndDomain(record, authority, topic) },
          { predicate: 'textSupportsTopic', passed: supportPracticalExpansionRule({
            authority: authority, topicId: topic.id, query: originalQuery, subject: issue.subject,
            sourceText: record.sourceText, officialUrl: record.officialSourceUrl
          }) === true || textSupportsTopic(record.sourceText, topic) },
          { predicate: 'boundedSubstantiveSupport', passed: substantiveSupport },
          { predicate: 'issueSubjectSupport', passed: supportsIssueSubject(record.sourceText, issue, topic, concepts, originalQuery) }
        ];
        const topicFailure = topicPredicates.find(predicate => !predicate.passed)?.predicate;
        const topicAdmitted = topicFailure === undefined;
        topicDiagnostics.push({ topicId: topic.id, predicates: topicPredicates, admitted: topicAdmitted,
          ...(topicFailure ? { firstFailedPredicate: topicFailure } : {}) });
        if (!firstTopicFailure && topicFailure) firstTopicFailure = `topic:${topic.id}.${topicFailure}`;
        if (topicAdmitted) {
          admitted.push(record);
          break;
        }
      }
    }
    const candidateAdmitted = !firstSharedFailure && topicDiagnostics.some(topic => topic.admitted);
    if (!candidateAdmitted) {
      rejectedCount += 1;
    }
    const firstFailedPredicate = candidateAdmitted ? undefined : firstSharedFailure || firstTopicFailure ||
      (topics.length === 0 ? 'topicSupport.noTopics' : undefined);
    diagnostics.push({
      recordId: record.id,
      ...(typeof record.documentHash === 'string' ? { documentHash: record.documentHash } : {}),
      admitted: candidateAdmitted,
      ...(firstFailedPredicate ? { firstFailedPredicate } : {}),
      provenancePaths,
      predicates,
      topics: topicDiagnostics
    });
  }
  return { admitted, rejectedCount, diagnostics };
}

interface RuleClaimSelectionScope {
  includeAcraDutySentence?: boolean;
  issue?: ReconciledSemanticQuestionIssue;
  topics?: SingaporeCoverageTopic[];
  concepts?: RequestedQuestionConcept[];
  originalQuery?: string;
}

function completeGstMotorCarThirdPartyQuote(sourceText: string): string | undefined {
  return sourceText.split(/\r?\n[\t ]*\r?\n+/).map(block => block.trim()).filter(Boolean)
    .find(block => block.length <= 3_200 &&
      getGstMotorCarInputTaxExceptionKinds(block).includes('THIRD_PARTY'));
}

function ruleClaimsForRecords(records: AuthoritativeSourceRecord[], scope: RuleClaimSelectionScope = {}): Array<{ kind: 'RULE'; text: string; quote: string; recordId: string; citationUrl?: string }> {
  const claims: Array<{ kind: 'RULE'; text: string; quote: string; recordId: string; citationUrl?: string }> = [];
  for (const record of records) {
    const quoteCandidates = [...new Set([record.sourceText.trim(), ...record.sourceText
      .split(/\r?\n[\t ]*\r?\n+/).map(block => block.trim()).filter(Boolean)])];
    if (scope.includeAcraDutySentence) {
      for (const block of quoteCandidates) {
        const firstSentence = block.match(/^(.+?[.!?])\s+/)?.[1];
        if (firstSentence && isExactAcraAnnualReturnDutyParagraph(record.sourceText, firstSentence)) {
          quoteCandidates.push(firstSentence);
        }
      }
    }
    if (scope.issue && scope.topics && scope.concepts && scope.originalQuery) {
      const issue = scope.issue;
      for (const topic of scope.topics) {
        const topicAuthority = issue.governingAuthorities.find(authority =>
          topic.authorities.includes(authority as StatutoryAuthority)
        );
        if (!topicAuthority || !topicBoundToRecord(record, topic) ||
            !recordMatchesGovernorAndDomain(record, topicAuthority, topic)) continue;
        const request = {
          authority: topicAuthority, topicId: topic.id,
          query: scope.originalQuery, subject: issue.subject, sourceText: record.sourceText,
          officialUrl: record.officialSourceUrl || record.canonicalSourceUrl
        };
        quoteCandidates.push(...selectIrasCpfCoverageQuotes(request));
        quoteCandidates.push(...selectMomAcraMasCoverageQuotes(request));
      }
      if (issue.population === 'INDIVIDUAL' && issue.domain === 'IRAS_INCOME_TAX' &&
          issue.governingAuthorities.includes('IRAS')) {
        const cpfTopic = scope.topics.find(topic => topic.id === INDIVIDUAL_CPF_CASH_TOP_UP_TOPIC_ID &&
          topic.domainId === 'IRAS_INDIVIDUAL_TAX');
        const requestedCpfConcepts = scope.concepts.some(concept =>
          INDIVIDUAL_CPF_CASH_TOP_UP_CONCEPT_IDS.has(concept.id) && concept.topicIds.includes(INDIVIDUAL_CPF_CASH_TOP_UP_TOPIC_ID));
        if (cpfTopic && requestedCpfConcepts && record.authority === 'IRAS' && record.domain === 'IRAS_TAX' &&
            topicBoundToRecord(record, cpfTopic)) {
          const eligibilityQuote = completeIrasCpfCashTopUpEligibilityQuote(record.sourceText);
          if (eligibilityQuote) quoteCandidates.push(eligibilityQuote);
          quoteCandidates.push(...completeIrasCpfCashTopUpLimitQuotes(record.sourceText));
        }
      }
      const requestedMotorCarException = scope.concepts.some(concept => concept.id === 'gst_motor_car_input_tax_exceptions');
      const motorCarTopic = scope.topics.find(topic =>
        ['iras-gst-blocked-input-tax', 'iras-gst-motor-vehicles'].includes(topic.id) && topic.domainId === 'IRAS_GST');
      if (issue.governingAuthorities.includes('IRAS') && issue.domain === 'IRAS_GST' &&
          issue.population === 'COMPANY' && requestedMotorCarException && motorCarTopic &&
          record.authority === 'IRAS' && record.domain === 'IRAS_GST' && topicBoundToRecord(record, motorCarTopic)) {
        const connectedPersonQuote = completeIrasGstMotorCarConnectedPersonExceptionQuote(record.sourceText);
        const thirdPartyQuote = completeGstMotorCarThirdPartyQuote(record.sourceText);
        if (connectedPersonQuote) quoteCandidates.push(connectedPersonQuote);
        if (thirdPartyQuote) quoteCandidates.push(thirdPartyQuote);
      }
    }
    for (const quote of new Set(quoteCandidates)) claims.push({
      kind: 'RULE', text: quote, quote, recordId: record.id
    });
  }
  return claims;
}

const MOM_PAYING_SALARY_URL = 'https://www.mom.gov.sg/employment-practices/salary/paying-salary';

function normalizedExactMomPayingSalaryUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'www.mom.gov.sg' || url.username || url.password || url.port ||
        url.search || url.hash || url.pathname.replace(/\/$/, '') !== '/employment-practices/salary/paying-salary') return undefined;
    return `${url.origin}/employment-practices/salary/paying-salary`;
  } catch {
    return undefined;
  }
}

function isExactMomSalaryPaymentRecord(record: AuthoritativeSourceRecord): boolean {
  return record.provenance === 'LIVE_EXTERNAL' && !record.validTo && record.authority === 'MOM' &&
    record.sourceAuthority === 'MOM' && record.domain === 'MOM_EMPLOYMENT' &&
    normalizedExactMomPayingSalaryUrl(record.officialSourceUrl) === MOM_PAYING_SALARY_URL &&
    normalizedExactMomPayingSalaryUrl(record.canonicalSourceUrl) === MOM_PAYING_SALARY_URL;
}

function practicalCoverageRuleClaimsForRecords(
  records: AuthoritativeSourceRecord[],
  scope: RuleClaimSelectionScope
): Array<{
  claim: { kind: 'RULE'; text: string; quote: string; recordId: string };
  request: BoundedCoverageRequest;
}> {
  if (!scope.issue || !scope.topics || !scope.originalQuery) return [];
  const claims: Array<{
    claim: { kind: 'RULE'; text: string; quote: string; recordId: string };
    request: BoundedCoverageRequest;
  }> = [];
  for (const record of records) {
    for (const topic of scope.topics) {
      if (!topicBoundToRecord(record, topic)) continue;
      const topicAuthority = scope.issue.governingAuthorities.find(authority =>
        topic.authorities.includes(authority as StatutoryAuthority)
      );
      const statutoryAuthority = topicAuthority ? retrievalAuthority(topicAuthority) : undefined;
      if (!topicAuthority || !statutoryAuthority || !recordMatchesGovernorAndDomain(record, topicAuthority, topic)) continue;
      const request = {
        authority: statutoryAuthority, topicId: topic.id,
        query: scope.originalQuery, subject: scope.issue.subject, sourceText: record.sourceText,
        officialUrl: record.officialSourceUrl || record.canonicalSourceUrl
      };
      const regularSalaryIssueOwned = statutoryAuthority === 'MOM' && topic.id === 'mom-salary-payment' &&
        scope.issue.domain === 'MOM_EMPLOYMENT' && scope.issue.operation === 'EXPLAIN_RULE' &&
        ['EMPLOYEE', 'EMPLOYER'].includes(scope.issue.population) && scope.issue.status === 'MAPPED' &&
        scope.issue.governingAuthorities.length === 1 && scope.issue.governingAuthorities[0] === 'MOM' &&
        scope.issue.mappedTopicIds.includes(topic.id) && isExactMomSalaryPaymentRecord(record) &&
        supportMomSalaryPaymentIssue(scope.originalQuery, scope.issue.subject, record.sourceText) === true;
      const regularSalaryQuote = regularSalaryIssueOwned
        ? selectMomSalaryPaymentRuleQuote(scope.originalQuery, record.sourceText)
        : undefined;
      const quotes = [
        ...selectPracticalExpansionQuotes(request),
        ...selectIrasCpfCoverageQuotes(request),
        ...selectMomAcraMasCoverageQuotes(request),
        ...(regularSalaryQuote ? [regularSalaryQuote] : [])
      ];
      for (const quote of new Set(quotes)) claims.push({
        claim: { kind: 'RULE', text: quote, quote, recordId: record.id },
        request: { authority: statutoryAuthority, topicId: request.topicId,
          query: request.query, subject: request.subject }
      });
    }
  }
  return claims;
}

/** Complete component evidence may only be assembled within one fetched record. */
function completeExpansionClaimText(
  claim: VerifiedEvidenceClaim,
  claims: VerifiedEvidenceClaim[],
  record: AuthoritativeSourceRecord,
  topic: SingaporeCoverageTopic,
  query: string,
  subject: string
): string | undefined {
  if (!topicBoundToRecord(record, topic)) return undefined;
  const request = { authority: topic.authorities[0] || '', topicId: topic.id,
    query, subject, sourceText: record.sourceText,
    officialUrl: record.officialSourceUrl || record.canonicalSourceUrl };
  const proof = supportPracticalExpansionRule(request);
  if (proof !== true) return undefined;
  const selected = [...selectPracticalExpansionQuotes(request)];
  const normalizedQuote = (text: string): string => text.replace(/\s+/g, ' ').trim();
  const sameRecordQuotes = new Set(claims.filter(item => item.recordId === record.id && item.supportKind === 'EXACT_SOURCE_QUOTE')
    .map(item => normalizedQuote(item.quote)));
  if (selected.length === 0 || !selected.some(text => normalizedQuote(text) === normalizedQuote(claim.quote)) ||
      !selected.every(text => sameRecordQuotes.has(normalizedQuote(text)))) return undefined;
  const joined = selected.join('\n\n');
  return (supportPracticalExpansionRule({ ...request, sourceText: joined })) === true ? joined : undefined;
}

function isCpfCashTopUpLimitComponentQuote(record: AuthoritativeSourceRecord, quote: string): boolean {
  return record.authority === 'IRAS' && record.domain === 'IRAS_TAX' &&
    [...(record.tags || []), ...(record.relatedTopicIds || []), ...(record.sourceMapTopicIds || [])]
      .includes(INDIVIDUAL_CPF_CASH_TOP_UP_TOPIC_ID) &&
    completeIrasCpfCashTopUpLimitQuotes(record.sourceText).includes(quote);
}

function isGstMotorCarExceptionComponentQuote(
  record: AuthoritativeSourceRecord,
  quote: string,
  kind: 'THIRD_PARTY' | 'CONNECTED_PERSON'
): boolean {
  const hasMotorCarTopic = [...(record.tags || []), ...(record.relatedTopicIds || []), ...(record.sourceMapTopicIds || [])]
    .some(topicId => ['iras-gst-blocked-input-tax', 'iras-gst-motor-vehicles'].includes(topicId));
  if (record.authority !== 'IRAS' || record.domain !== 'IRAS_GST' || !hasMotorCarTopic) return false;
  if (kind === 'CONNECTED_PERSON') {
    return completeIrasGstMotorCarConnectedPersonExceptionQuote(record.sourceText) === quote &&
      getGstMotorCarInputTaxExceptionKinds(quote).includes(kind);
  }
  return record.sourceText.split(/\r?\n[\t ]*\r?\n+/).map(block => block.trim()).filter(Boolean)
    .some(block => block === quote && getGstMotorCarInputTaxExceptionKinds(block).includes(kind));
}

function hasCompleteVerifiedCpfCashTopUpLimitEvidence(
  claims: VerifiedEvidenceClaim[],
  records: AuthoritativeSourceRecord[],
  topic: SingaporeCoverageTopic,
  issue: ReconciledSemanticQuestionIssue,
  concept: RequestedQuestionConcept,
  originalQuery: string
): boolean {
  return records.some(record => {
    if (record.authority !== 'IRAS' || record.domain !== 'IRAS_TAX' || !topicBoundToRecord(record, topic) ||
        generalIrasRuleConceptSupport(record.sourceText, issue, [topic], [concept]) !== true) return false;
    const completeQuotes = completeIrasCpfCashTopUpLimitQuotes(record.sourceText);
    return completeQuotes.length === 2 && completeQuotes.every(quote =>
      claims.some(claim => claim.recordId === record.id && claim.quote === quote &&
        passesBoundedStatutoryAdvisorySupport(claim.quote, 'IRAS', issue, [topic], originalQuery)));
  });
}

function hasCompleteVerifiedGstMotorCarExceptionEvidence(
  claims: VerifiedEvidenceClaim[],
  records: AuthoritativeSourceRecord[],
  topic: SingaporeCoverageTopic,
  issue: ReconciledSemanticQuestionIssue,
  concept: RequestedQuestionConcept,
  originalQuery: string
): boolean {
  return records.some(record => {
    if (record.authority !== 'IRAS' || record.domain !== 'IRAS_GST' || !topicBoundToRecord(record, topic) ||
        generalIrasRuleConceptSupport(record.sourceText, issue, [topic], [concept]) !== true) return false;
    const connectedQuote = completeIrasGstMotorCarConnectedPersonExceptionQuote(record.sourceText);
    const thirdPartyQuote = completeGstMotorCarThirdPartyQuote(record.sourceText);
    if (!connectedQuote || !thirdPartyQuote) return false;
    const connectedVerified = claims.some(claim => claim.recordId === record.id && claim.quote === connectedQuote &&
      isGstMotorCarExceptionComponentQuote(record, claim.quote, 'CONNECTED_PERSON') &&
      passesBoundedStatutoryAdvisorySupport(claim.quote, 'IRAS', issue, [topic], originalQuery));
    const thirdPartyVerified = claims.some(claim => claim.recordId === record.id && claim.quote === thirdPartyQuote &&
      isGstMotorCarExceptionComponentQuote(record, claim.quote, 'THIRD_PARTY') &&
      passesBoundedStatutoryAdvisorySupport(claim.quote, 'IRAS', issue, [topic], originalQuery));
    return connectedVerified && thirdPartyVerified;
  });
}

function issueClaimCoverage(
  claims: VerifiedEvidenceClaim[],
  records: AuthoritativeSourceRecord[],
  topics: SingaporeCoverageTopic[],
  concepts: RequestedQuestionConcept[],
  issue: ReconciledSemanticQuestionIssue,
  authority: SemanticAuthority,
  originalQuery: string,
  requireAcraDeadlineTable = false
): { covered: boolean; missing: string[] } {
  const missing: string[] = [];
  const recordById = new Map(records.map(record => [record.id, record]));
  const acraAnnualReturnDutyScope = isAcraAnnualReturnFilingDutyIssue(originalQuery, authority, issue, topics);
  const residencySubjectClaim = issue.domain === 'IRAS_INCOME_TAX' && issue.population === 'COMPANY' &&
    topics.some(topic => topic.id === 'iras-corporate-tax-residency' && topic.domainId === 'IRAS_CORPORATE_TAX' &&
      claims.some(claim => {
        const record = recordById.get(claim.recordId);
        return Boolean(record && topicBoundToRecord(record, topic) && textSupportsTopic(claim.quote, topic) &&
          passesBoundedStatutoryAdvisorySupport(claim.quote, authority, issue, topics, originalQuery) &&
          supportsIssueSubject(claim.quote, issue, topic, concepts, originalQuery));
      }));
  for (const topic of topics) {
    const topicClaim = claims.some(claim => {
      const record = recordById.get(claim.recordId);
      const expansionText = record && completeExpansionClaimText(claim, claims, record, topic, originalQuery, issue.subject);
      if (expansionText) return practicalRuleIssueTextSupport(expansionText, originalQuery, issue, topic) === true;
      const tableOwnsDeadlineIssue = requireAcraDeadlineTable && topic.id === 'acra_annual-returns' &&
        supportsAcraAnnualReturnDeadlineTable(claim.quote);
      const momCanonicalAliasClaim = Boolean(record && supportsMomPartIvCanonicalAliasClaim(
        record, topic, claim.quote, authority, issue, originalQuery
      ));
      const momSalarySupport = momSalaryPaymentIssueSupport(claim.quote, issue, authority, originalQuery);
      const practicalRuleSupport = record && topicBoundToRecord(record, topic)
        ? practicalRuleIssueTextSupport(claim.quote, originalQuery, issue, topic)
        : undefined;
      const supportsTopic = practicalRuleSupport !== undefined
        ? practicalRuleSupport
        : momSalarySupport !== undefined
        ? momSalarySupport
        : acraAnnualReturnDutyScope
        ? isExactAcraAnnualReturnDutyParagraph(record?.sourceText || '', claim.quote)
        : practicalRuleSupport !== undefined
          ? practicalRuleSupport
          : textSupportsTopic(claim.quote, topic, requireAcraDeadlineTable) &&
            supportsIssueSubject(claim.quote, issue, topic, concepts, originalQuery) ||
            authority === 'IRAS' && concepts.some(concept => concept.topicIds.includes(topic.id) &&
              generalIrasRuleConceptSupport(claim.quote, issue, [topic], [concept]) === true);
      return Boolean(record && passesBoundedStatutoryAdvisorySupport(claim.quote, authority, issue, topics, originalQuery) &&
        (topicBoundToRecord(record, topic) && (tableOwnsDeadlineIssue || supportsTopic) || momCanonicalAliasClaim));
    });
    if (!topicClaim) missing.push(`topic:${topic.id}`);
  }
  for (const concept of concepts) {
    const conceptClaim = claims.some(claim => {
      if (!passesBoundedStatutoryAdvisorySupport(claim.quote, authority, issue, topics, originalQuery)) return false;
      const record = recordById.get(claim.recordId);
      if (record) {
        for (const topic of topics) {
          if (!topicBoundToRecord(record, topic)) continue;
          const expansionText = completeExpansionClaimText(claim, claims, record, topic, originalQuery, issue.subject);
          if (expansionText) return practicalRuleIssueTextSupport(expansionText, originalQuery, issue, topic, concept) === true;
          const practicalRuleConceptSupport = practicalRuleIssueTextSupport(claim.quote, originalQuery, issue, topic, concept);
          if (practicalRuleConceptSupport !== undefined) return practicalRuleConceptSupport;
        }
      }
      if (acraAnnualReturnDutyScope) {
        return isGenericAcraAnnualReturnDutyConcept(concept) && record !== undefined &&
          isExactAcraAnnualReturnDutyParagraph(record.sourceText, claim.quote);
      }
      if (concept.id === 'cpf_cash_top_up_relief_limits') {
        return topics.some(topic => topic.id === INDIVIDUAL_CPF_CASH_TOP_UP_TOPIC_ID &&
          hasCompleteVerifiedCpfCashTopUpLimitEvidence(claims, records, topic, issue, concept, originalQuery));
      }
      if (concept.id === 'gst_motor_car_input_tax_exceptions') {
        return topics.some(topic => ['iras-gst-blocked-input-tax', 'iras-gst-motor-vehicles'].includes(topic.id) &&
          hasCompleteVerifiedGstMotorCarExceptionEvidence(claims, records, topic, issue, concept, originalQuery));
      }
      const momSalarySupport = momSalaryPaymentConceptSupport(claim.quote, issue, authority, originalQuery, concept);
      if (momSalarySupport !== undefined) return momSalarySupport;
      const masDefinitionSupport = masCmsDefinitionSupport(claim.quote, issue, topics, originalQuery);
      if (isMasCmsDefinitionConcept(concept)) return masDefinitionSupport === true;
      const masRuleSupport = masCmsGeneralRuleSupport(claim.quote, issue, topics, originalQuery);
      if (masRuleSupport !== undefined) return isGenericMasCmsRuleConcept(concept) && masRuleSupport;
      if (isGenericMomPartIvCoverageConcept(concept)) {
        return momPartIvCoverageConceptSupport(claim.quote, issue, topics, concept, originalQuery);
      }
      if (concept.id.startsWith('acra_annual_return_')) {
        return supportsAcraAnnualReturnDeadlineConcept(claim.quote, concept.id);
      }
      const ruleSupport = generalIrasRuleConceptSupport(claim.quote, issue, topics, [concept]);
      if (ruleSupport !== undefined) return ruleSupport;
      return issue.domain === 'IRAS_INCOME_TAX'
        ? matchesRequestedQuestionConcept(claim.quote, concept)
        : [concept.label, ...concept.terms].some(term => textSupportsPhrase(claim.quote, term)) && textSupportsPhrase(claim.quote, issue.subject);
    });
    const companyTaxResidencyConcept = isGeneralCompanyTaxResidencyConcept(concept);
    if (!conceptClaim && !(residencySubjectClaim && companyTaxResidencyConcept)) missing.push(`concept:${concept.id}`);
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

function isAcraAnnualReturnApplicationIntent(query: string, operation: string): boolean {
  return ['EXPLAIN_RULE', 'FILING_REQUIREMENT', 'DETERMINE_TREATMENT', 'CALCULATE'].includes(operation) &&
    (isAcraAnnualReturnApplicationQuestion(query, operation) ||
      isBoundedAcraAnnualReturnMissingFactsQuestion(query));
}

function applicationForIssue(
  query: string,
  issue: ReconciledSemanticQuestionIssue,
  authority: SemanticAuthority,
  candidateIssues: ReconciledSemanticQuestionIssue[]
): { status: AuthorityApplicationStatus; reason?: string } {
  if (isAcraAnnualReturnDeadlineIssue(query, authority, issue, candidateIssues) &&
      isAcraAnnualReturnApplicationIntent(query, issue.operation)) {
    const application = applyAcraAnnualReturnDeadline(query);
    return { status: application.applicationStatus, reason: application.applicationReason };
  }
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

function canonicalSourceIdentity(record: AuthoritativeSourceRecord): string | undefined {
  if (!record.canonicalSourceUrl) return undefined;
  try {
    const url = new URL(record.canonicalSourceUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined;
    url.hash = '';
    return url.href;
  } catch {
    return undefined;
  }
}

function sameLiveIrasPage(left: AuthoritativeSourceRecord, right: AuthoritativeSourceRecord): boolean {
  if (left.provenance !== 'LIVE_EXTERNAL' || right.provenance !== 'LIVE_EXTERNAL' ||
      left.authority !== 'IRAS' || right.authority !== 'IRAS' ||
      left.sourceAuthority !== 'IRAS' || right.sourceAuthority !== 'IRAS' ||
      left.domain !== right.domain) return false;

  const leftUrl = canonicalSourceIdentity(left);
  const rightUrl = canonicalSourceIdentity(right);
  if (!leftUrl || leftUrl !== rightUrl) return false;

  let comparableHashFound = false;
  let matchingHashFound = false;
  for (const field of ['documentHash', 'contentHash'] as const) {
    const leftHash = left[field];
    const rightHash = right[field];
    if (!/^[a-f\d]{64}$/i.test(leftHash || '') || !/^[a-f\d]{64}$/i.test(rightHash || '')) continue;
    comparableHashFound = true;
    if (leftHash!.toLowerCase() !== rightHash!.toLowerCase()) return false;
    matchingHashFound = true;
  }
  return comparableHashFound && matchingHashFound;
}

function bindAcceptedIrasQuotesToSiblingPageRecords(
  accepted: VerifiedEvidenceClaim[],
  records: AuthoritativeSourceRecord[],
  targetDate: string | undefined
): VerifiedEvidenceClaim[] {
  const recordById = new Map(records.map(record => [record.id, record]));
  const additionalBindings: Array<{ kind: 'RULE'; text: string; quote: string; recordId: string; citationUrl?: string }> = [];
  const attemptedBindings = new Set<string>();

  // Only independently accepted original claims can seed sibling bindings.
  // Added bindings are verified once and never become seeds themselves.
  for (const claim of accepted) {
    const originalRecord = recordById.get(claim.recordId);
    if (!originalRecord || originalRecord.provenance !== 'LIVE_EXTERNAL' || originalRecord.authority !== 'IRAS') continue;
    for (const sibling of records) {
      if (sibling.id === originalRecord.id || !sameLiveIrasPage(originalRecord, sibling)) continue;
      const bindingKey = JSON.stringify([sibling.id, claim.quote]);
      if (attemptedBindings.has(bindingKey)) continue;
      attemptedBindings.add(bindingKey);
      additionalBindings.push({
        kind: 'RULE',
        text: claim.text,
        quote: claim.quote,
        recordId: sibling.id,
        ...(claim.canonicalUrl ? { citationUrl: claim.canonicalUrl } : {})
      });
    }
  }

  const rebound = additionalBindings.length > 0
    ? verifyEvidenceClaims(additionalBindings, records, { missingFacts: [], targetDate }).accepted
    : [];
  return [...new Map([...accepted, ...rebound].map(claim => [JSON.stringify([claim.recordId, claim.quote]), claim])).values()];
}

async function evaluateIssue(
  query: string,
  plan: InternalPlan,
  plannedIssue: PlannedIssue,
  options: AuthorityWorkstreamOptions,
  retriever: ISourceRetriever,
  understanding: SemanticQuestionUnderstanding,
  referenceDate: string,
  candidateIssues: ReconciledSemanticQuestionIssue[],
  semanticOwnerCandidates: ReconciledSemanticQuestionIssue[],
  acraCandidateIssues: ReconciledSemanticQuestionIssue[]
): Promise<AuthorityIssueEvidence> {
  const issue = plannedIssue.issue;
  const topicIds = plannedIssue.topicIds;
  const topics = getCoverageTopicsByIds(topicIds);
  const evidenceTopics = plan.authority === 'IRAS' ? topics.filter(topic => !topic.routingOnly) : topics;
  const evidenceTopicIds = evidenceTopics.map(topic => topic.id);
  const concepts = requestedConceptsForIssue(query, issue, plan.authority, topicIds, understanding, candidateIssues,
    semanticOwnerCandidates, acraCandidateIssues);
  const acraAnnualReturnDutyScope = isAcraAnnualReturnFilingDutyIssue(query, plan.authority, issue, topics);
  const requireAcraDeadlineEvidence = !acraAnnualReturnDutyScope &&
    requiresAcraAnnualReturnDeadlineEvidence(query, plan.authority, issue);
  const mapped = topicIds.length > 0 && plan.domain !== 'UNKNOWN';
  const lifecycle = initialLifecycle(issue, mapped);
  const application = applicationForIssue(query, issue, plan.authority, acraCandidateIssues);
  let cpfRateScheduleUnverified = requiresUnverifiedCpfRateSchedule(query, issue, plan.authority, evidenceTopics);
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
    : isOfficialDiscoveryAuthority(plan.authority)
      ? defaultOfficialStatutoryProvider(plan.authority, plan, options, retriever, referenceDate)
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
  const admissionTrace = admissionTraceAssessment(providerResult.evidenceQualityTrace);
  const officialRetrievalTrace = safeEvidenceQualityTrace(providerResult.evidenceQualityTrace);
  const uniqueCandidates = [...new Map(providerResult.candidates.map(record => [record.id, record])).values()];
  lifecycle.evidenceFound = uniqueCandidates.length > 0;
  if (providerResult.error) {
    gaps.push(makeGap(issue, plan.authority, plan.domain, 'retrievalAttempted', 'PROVIDER_ERROR',
      'The evidence provider failed while retrieving this issue.'));
    return { ...base, evidenceStatus: 'INSUFFICIENT', verifiedClaims: [], sources: [], gaps, retrievalTrace,
      admissionDiagnostics: { ...admissionTrace, candidates: [] } };
  }
  if (uniqueCandidates.length === 0) gaps.push(makeGap(issue, plan.authority, plan.domain, 'evidenceFound', 'NO_CANDIDATE_EVIDENCE',
    'No source evidence was found for this issue.'));

  let admitted: AuthoritativeSourceRecord[] = [];
  let localRejectedCount = 0;
  let candidateDiagnostics: AuthorityCandidateAdmissionDiagnostic[] = [];
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
      scopedSubject: issue.subject,
      scopedPopulation: issue.population,
      sourceMapFallbackTrace: officialRetrievalTrace
    });
    admitted = irasQuality.eligibleRecords;
    localRejectedCount = irasQuality.rejectedRecords.length;
    const admittedIds = new Set(admitted.map(record => record.id));
    const rejectedById = new Map(irasQuality.rejectedRecords.map(rejection => [rejection.recordId, rejection]));
    candidateDiagnostics = uniqueCandidates.map(record => {
      const rejection = rejectedById.get(record.id);
      const isAdmitted = admittedIds.has(record.id);
      const predicates: AuthorityAdmissionPredicateResult[] = [{
        predicate: 'irasEvidenceQualityGate', passed: isAdmitted,
        result: rejection ? `${rejection.code}: ${rejection.reason}` : isAdmitted ? 'ELIGIBLE' : 'NOT_REPORTED'
      }];
      return {
        recordId: record.id,
        ...(typeof record.documentHash === 'string' ? { documentHash: record.documentHash } : {}),
        admitted: isAdmitted,
        ...(!isAdmitted ? { firstFailedPredicate: 'irasEvidenceQualityGate' } : {}),
        predicates,
        // The specialist IRAS gate reports issue-level topic coverage, not a
        // record-to-topic attribution; do not invent per-record topic results.
        topics: []
      };
    });
  } else {
    const versioningManager = versioningManagerFor(retriever);
    const result = eligibleLocalRecords(uniqueCandidates, issue, plan.authority, topics, concepts, query, targetDate, referenceDate,
      officialRetrievalTrace, versioningManager, requireAcraDeadlineEvidence);
    admitted = result.admitted;
    localRejectedCount = result.rejectedCount;
    candidateDiagnostics = result.diagnostics;
  }
  const admissionDiagnostics: AuthorityIssueAdmissionDiagnostics = { ...admissionTrace, candidates: candidateDiagnostics };
  if (cpfRateScheduleUnverified) {
    const table = STATUTORY_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'CPF_2026_CONTRIBUTION_TABLES');
    const completeTableAdmitted = table && admitted.some(record => record.authority === 'CPF'
      && record.sourceAuthority === 'CPF' && record.domain === 'CPF_BOARD'
      && record.officialSourceUrl === table.officialUrl && record.canonicalSourceUrl === table.officialUrl
      && evidenceTopics.some(topic => topicBoundToRecord(record, topic)
        && supportStatutoryKnowledgeRule({ authority: 'CPF', topicId: topic.id, query,
          subject: issue.subject, sourceText: record.sourceText, officialUrl: record.officialSourceUrl }) === true));
    cpfRateScheduleUnverified = !completeTableAdmitted;
    if (cpfRateScheduleUnverified) gaps.push(makeGap(issue, plan.authority, plan.domain, 'verified', 'CPF_RATE_SCHEDULE_UNVERIFIED',
      'No independently validated CPF rate-schedule parser covers the requested period and population with the admitted evidence.'));
  }
  lifecycle.admitted = admitted.length > 0;
  if (localRejectedCount > 0 && admitted.length === 0) gaps.push(makeGap(issue, plan.authority, plan.domain, 'admitted', 'CANDIDATE_REJECTED',
    'Candidates failed authority, domain, provenance, date, topic, or source-text checks.'));
  if (admitted.length === 0 && uniqueCandidates.length > 0) gaps.push(makeGap(issue, plan.authority, plan.domain, 'admitted', 'NO_ADMITTED_EVIDENCE',
    'No candidate passed the evidence admission checks for this issue.'));

  const providerClaims = (providerResult.claims || []).map(claim => ({
    kind: 'RULE', text: claim.text, quote: claim.quote, recordId: claim.recordId,
    ...(claim.canonicalUrl ? { citationUrl: claim.canonicalUrl } : {})
  }));
  const claimScope: RuleClaimSelectionScope = {
    includeAcraDutySentence: acraAnnualReturnDutyScope,
    issue,
    topics: evidenceTopics,
    concepts,
    originalQuery: query
  };
  const sourceRuleClaims = providerResult.claims === undefined
    ? ruleClaimsForRecords(admitted, claimScope) : [];
  const selectedPracticalRuleClaims = practicalCoverageRuleClaimsForRecords(admitted, claimScope);
  const qualitativeCpfRateFactorRequest = {
    authority: 'CPF', topicId: evidenceTopics.find(topic =>
      ['cpf_contribution_rates', 'cpf-pr-contribution-rates'].includes(topic.id))?.id || 'cpf_contribution_rates',
    query, subject: issue.subject, sourceText: ''
  };
  const qualitativeCpfRateFactorScope = plan.authority === 'CPF' && issue.domain === 'CPF_PAYROLL' &&
    issue.operation === 'EXPLAIN_RULE' && isIrasCpfQualitativeRateFactorRequest(qualitativeCpfRateFactorRequest);
  const suggestedClaims = [...providerClaims, ...sourceRuleClaims, ...selectedPracticalRuleClaims.map(item => item.claim)]
    .filter((claim, index, all) => all.findIndex(candidate =>
      candidate.recordId === claim.recordId && candidate.quote === claim.quote
    ) === index);
  const verificationOptions: VerifyEvidenceClaimsOptions = {
    missingFacts: [], targetDate, referenceDate,
    expectedAuthority: plan.authority === 'MAS' ? 'MAS' :
      plan.authority === 'ACRA' && requireAcraDeadlineEvidence ? 'ACRA' : undefined,
    expectedDomain: plan.authority === 'MAS' && plan.domain === 'MAS_FUNDS' ? 'MAS_FUNDS' :
      plan.authority === 'ACRA' && requireAcraDeadlineEvidence ? 'ACRA_CORP' : undefined,
    ...(plan.authority === 'ACRA' && requireAcraDeadlineEvidence ? { applicabilityTarget: 'ACRA_FYE' as const } : {}),
    versioningManager: versioningManagerFor(retriever)
  };
  const verification = verifyEvidenceClaims(suggestedClaims, admitted, verificationOptions);
  const boundedCoverageAccepted = selectedPracticalRuleClaims.flatMap(({ claim, request: boundedCoverageRequest }) =>
    verifyEvidenceClaims([claim], admitted, { ...verificationOptions, boundedCoverageRequest }).accepted
  );
  // Keep selected rule components in source-rule order before incidental
  // generic excerpts so complete list premises remain together in presentation.
  const allAcceptedClaims = [...boundedCoverageAccepted, ...verification.accepted]
    .filter((claim, index, all) => all.findIndex(candidate =>
      candidate.recordId === claim.recordId && candidate.quote === claim.quote
    ) === index);
  const acceptedClaims = plan.authority === 'IRAS'
    ? bindAcceptedIrasQuotesToSiblingPageRecords(allAcceptedClaims, admitted, targetDate)
    : allAcceptedClaims;
  const verifiedClaims = cpfRateScheduleUnverified ? [] : acceptedClaims.filter(claim => {
    const record = admitted.find(item => item.id === claim.recordId);
    if (!record) return false;
    for (const topic of evidenceTopics) {
      const expansionText = completeExpansionClaimText(claim, acceptedClaims, record, topic, query, issue.subject);
      if (expansionText) return practicalRuleIssueTextSupport(expansionText, query, issue, topic) === true;
    }
    if (qualitativeCpfRateFactorScope) {
      const request = { ...qualitativeCpfRateFactorRequest, sourceText: record.sourceText };
      const completeNarrativeSpan = selectIrasCpfCoverageQuotes(request);
      if (!completeNarrativeSpan.includes(claim.quote)) return false;
    }
    if (plan.authority === 'MAS' && issue.domain === 'MAS_FUNDS' && issue.status === 'MAPPED' &&
        issue.operation === 'EXPLAIN_RULE' && issue.governingAuthorities.length === 1 &&
        issue.governingAuthorities[0] === 'MAS' && evidenceTopics.some(topic =>
          topic.id === 'mas-lfmc' && topicBoundToRecord(record, topic)) &&
        isCpfMasPracticalRuleComponentQuote({ authority: 'MAS', topicId: 'mas-lfmc',
          subject: issue.subject, query, sourceText: record.sourceText }, claim.quote)) return true;
    if (!passesBoundedStatutoryAdvisorySupport(claim.quote, plan.authority, issue, evidenceTopics, query)) return false;
    if (acraAnnualReturnDutyScope && !isExactAcraAnnualReturnDutyParagraph(record.sourceText, claim.quote)) return false;
    if (requireAcraDeadlineEvidence && (!supportsAcraAnnualReturnDeadlineEvidence(record.sourceText) ||
        !supportsAcraAnnualReturnDeadlineTable(claim.quote))) return false;
    const tableOwnsDeadlineIssue = requireAcraDeadlineEvidence &&
      supportsAcraAnnualReturnDeadlineTable(claim.quote) && evidenceTopics.some(topic =>
        topic.id === 'acra_annual-returns' && topicBoundToRecord(record, topic));
    if (tableOwnsDeadlineIssue) return true;
    const practicalRuleSupport = evidenceTopics
      .filter(topic => topicBoundToRecord(record, topic))
      .map(topic => practicalRuleIssueTextSupport(claim.quote, query, issue, topic))
      .find(support => support !== undefined);
    if (practicalRuleSupport !== undefined) return practicalRuleSupport;
    const momSalarySupport = momSalaryPaymentIssueSupport(claim.quote, issue, plan.authority, query);
    if (momSalarySupport !== undefined) return momSalarySupport;
    const supportsTopic = evidenceTopics.some(topic => {
      if (!topicBoundToRecord(record, topic)) return false;
      if (acraAnnualReturnDutyScope) return isExactAcraAnnualReturnDutyParagraph(record.sourceText, claim.quote);
      const practicalRuleSupport = practicalRuleIssueTextSupport(claim.quote, query, issue, topic);
      if (practicalRuleSupport !== undefined) return practicalRuleSupport;
      return textSupportsTopic(claim.quote, topic) && supportsIssueSubject(claim.quote, issue, topic, concepts, query);
    });
    const supportsConcept = concepts.some(concept => {
      if (acraAnnualReturnDutyScope) {
        return isGenericAcraAnnualReturnDutyConcept(concept) &&
          supportsAcraAnnualReturnFilingRule(claim.quote);
      }
      for (const topic of evidenceTopics) {
        if (!topicBoundToRecord(record, topic)) continue;
        const practicalRuleConceptSupport = practicalRuleIssueTextSupport(claim.quote, query, issue, topic, concept);
        if (practicalRuleConceptSupport !== undefined) return practicalRuleConceptSupport;
      }
      if (concept.id === 'cpf_cash_top_up_relief_limits') {
        return isCpfCashTopUpLimitComponentQuote(record, claim.quote);
      }
      if (concept.id === 'gst_motor_car_input_tax_exceptions') {
        return isGstMotorCarExceptionComponentQuote(record, claim.quote, 'THIRD_PARTY') ||
          isGstMotorCarExceptionComponentQuote(record, claim.quote, 'CONNECTED_PERSON');
      }
      const momSalarySupport = momSalaryPaymentConceptSupport(claim.quote, issue, plan.authority, query, concept);
      if (momSalarySupport !== undefined) return momSalarySupport;
      const masDefinitionSupport = masCmsDefinitionSupport(claim.quote, issue, evidenceTopics, query);
      if (isMasCmsDefinitionConcept(concept)) return masDefinitionSupport === true;
      const masRuleSupport = masCmsGeneralRuleSupport(claim.quote, issue, evidenceTopics, query);
      if (masRuleSupport !== undefined) return isGenericMasCmsRuleConcept(concept) && masRuleSupport;
      if (isGenericMomPartIvCoverageConcept(concept)) {
        return momPartIvCoverageConceptSupport(claim.quote, issue, evidenceTopics, concept, query);
      }
      const ruleSupport = generalIrasRuleConceptSupport(claim.quote, issue, evidenceTopics, [concept]);
      if (ruleSupport !== undefined) return ruleSupport;
      return issue.domain === 'IRAS_INCOME_TAX'
        ? matchesRequestedQuestionConcept(claim.quote, concept)
        : [concept.label, ...concept.terms].some(term => textSupportsPhrase(claim.quote, term)) && textSupportsPhrase(claim.quote, issue.subject);
    });
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

  const coverage = issueClaimCoverage(verifiedClaims, admitted, evidenceTopics, concepts, issue,
    plan.authority, query, requireAcraDeadlineEvidence);
  lifecycle.covered = coverage.covered && !(plan.authority === 'IRAS' && irasQuality &&
    (evidenceTopicIds.some(topicId => irasQuality!.uncoveredTopicIds.includes(topicId)) || (irasQuality.uncoveredConcepts?.length || 0) > 0));
  for (const missing of coverage.missing) gaps.push(makeGap(issue, plan.authority, plan.domain, 'covered', 'ISSUE_CONCEPT_UNCOVERED',
    `Verified quotations do not support the requested ${missing.replace(':', ' ')}.`));
  const sourceIds = new Set(verifiedClaims.map(claim => claim.recordId));
  const sources = admitted.filter(record => sourceIds.has(record.id));
  const acraApplication = plan.authority === 'ACRA' &&
    isAcraAnnualReturnDeadlineIssue(query, plan.authority, issue, acraCandidateIssues) &&
    isAcraAnnualReturnApplicationIntent(query, issue.operation)
    ? applyAcraAnnualReturnDeadline(query, { evidenceStatus: lifecycle.covered && lifecycle.verified && lifecycle.admitted && gaps.length === 0
      ? 'VERIFIED' : 'INSUFFICIENT', targetDate, lifecycle, sources, verifiedClaims })
    : undefined;
  return {
    ...base,
    ...(acraApplication ? { applicationStatus: acraApplication.applicationStatus, applicationReason: acraApplication.applicationReason } : {}),
    evidenceStatus: lifecycle.covered && gaps.length === 0 ? 'VERIFIED' : 'INSUFFICIENT',
    verifiedClaims,
    sources,
    gaps,
    retrievalTrace,
    admissionDiagnostics
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
  const requestCompletenessContext = ensureRequestCompletenessContext(
    query, options.requestCompletenessContext, options.questionUnderstanding
  );
  const retriever = options.retriever || defaultAdvancedSourceRetriever;
  const internalPlans = toInternalPlan(issuePlan);
  const candidateIssues = [...new Map(issuePlan.issues
    // Taxonomy residuals remain visible as plan gaps but do not compete with
    // validated semantic issues for ownership of a descriptive concept.
    .filter(issue => issue.governingAuthorities.includes('IRAS') && issue.unresolvedReason !== 'UNASSIGNED_QUERY_TOPIC')
    .map(issue => [issue.id, issue])).values()];
  const acraCandidateIssues = [...new Map(issuePlan.issues
    .filter(issue => issue.governingAuthorities.includes('ACRA') && issue.unresolvedReason !== 'UNASSIGNED_QUERY_TOPIC')
    .map(issue => [issue.id, issue])).values()];
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
      query, plan, issuePlanItem, options, retriever, understanding, referenceDate, candidateIssues,
      issuePlan.issues, acraCandidateIssues
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
      applicationStatus: results.some(item => item.applicationStatus === 'UNRESOLVED') ? 'UNRESOLVED'
        : results.some(item => item.applicationStatus === 'VERIFIED') ? 'VERIFIED' : 'NOT_REQUIRED',
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
    const irasOwners = issuePlan.issues.filter(issue => issue.governingAuthorities.includes('IRAS') &&
      issue.unresolvedReason !== 'UNASSIGNED_QUERY_TOPIC' &&
      topiclessConceptBelongsToIssue(concept, issue, 'IRAS', candidateIssues, query));
    const semanticOwnerCandidates = issuePlan.issues.filter(issue => !issue.governingAuthorities.includes('IRAS'));
    const semanticOwner = topiclessSemanticConceptOwner(concept, query, semanticOwnerCandidates);
    const owners = [...new Map([...irasOwners, ...(semanticOwner ? [semanticOwner] : [])]
      .map(owner => [owner.id, owner])).values()];
    if (owners.length !== 1) {
      const scope = topiclessConceptGapScope(concept);
      topLevelGaps.push({
      issueId: 'issue-plan', authority: scope.authority, domain: scope.domain, subject: concept.label,
      operation: 'OTHER', stage: 'mapped', code: 'UNROUTED_MATERIAL_CONCEPT',
      reason: 'A material concept without a reviewed topic was not assigned to a uniquely matching requested issue.'
      });
    }
  }
  for (const concept of getRequestedQuestionConcepts(query, understanding).filter(item => item.id.startsWith('acra_annual_return_'))) {
    const owners = issuePlan.issues.filter(issue => issue.unresolvedReason !== 'UNASSIGNED_QUERY_TOPIC' &&
      isAcraAnnualReturnDeadlineIssue(query, 'ACRA', issue, acraCandidateIssues));
    if (owners.length !== 1) {
      topLevelGaps.push({
        issueId: 'issue-plan', authority: 'ACRA', domain: 'ACRA_CORPORATE', subject: concept.label,
        operation: 'OTHER', stage: 'mapped', code: 'UNROUTED_MATERIAL_CONCEPT',
        reason: 'An ACRA annual-return deadline concept was not assigned to one uniquely matching company issue.'
      });
    }
  }

  const allIssues = workstreams.flatMap(workstream => workstream.issues);
  const evidenceStatus: AuthorityEvidenceStatus = issuePlan.coverageEstablished && topLevelGaps.length === 0 &&
    allIssues.length > 0 && allIssues.length === plannedIssueCount && allIssues.every(issue => issue.evidenceStatus === 'VERIFIED')
    ? 'VERIFIED' : 'INSUFFICIENT';
  const applicationStatus: AuthorityApplicationStatus = allIssues.some(issue => issue.applicationStatus === 'UNRESOLVED')
    ? 'UNRESOLVED' : allIssues.some(issue => issue.applicationStatus === 'VERIFIED') ? 'VERIFIED' : 'NOT_REQUIRED';
  const gaps = [...topLevelGaps, ...workstreams.flatMap(workstream => workstream.gaps)];
  const requestRepresentationComplete = requestCompletenessContext.evaluation.status === 'COMPLETE';
  const status: AuthorityOverallStatus = gaps.length > 0 || evidenceStatus !== 'VERIFIED'
    ? 'INSUFFICIENT'
    : applicationStatus === 'UNRESOLVED' || !requestRepresentationComplete ? 'CONDITIONAL' : 'VERIFIED';
  return { query, issuePlan, requestCompletenessContext, workstreams, evidenceStatus, applicationStatus, status, gaps };
}
