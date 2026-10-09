import type {
  AccountingStandard,
  AccountingScenarioState,
  ExplicitAssumption,
  QueryDomain,
  StatutoryAuthority,
  JournalEntryGroup,
  StandardCitation,
  JournalAuthorityStatus
} from '../types/accounting';
import type { QuestionClassificationResult } from '../classification/questionClassifier';
import { classifyQuestion } from '../classification/questionClassifier';
import type { ProviderSettings } from '../types/provider';
import { defaultTransactionUnderstandingService, type TransactionUnderstanding } from './transactionUnderstandingService';
import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import { getCoverageTopicsByIds, type SingaporeCoverageTopic } from '../standards/coverageRegistry';
import type { ISourceRetriever, SourceRetrievalQuery } from '../retrieval/sourceRetriever';
import { defaultAdvancedSourceRetriever } from '../retrieval/advancedSourceRetriever';
import { defaultControlledWebRetriever, type ControlledFetchOptions, type ControlledWebRetriever } from '../retrieval/controlledWebRetriever';
import { defaultCitationVerifier } from '../verification/citationVerifier';
import { appendStatutorySourceFooter, getSafeOfficialUrl } from '../utils/statutoryLinkResolver';
import { formatSingaporeDate } from '../utils/dateUtils';
import { assembleDeterministicResponse, guardUnconditionalMealInputTaxClaim, hasUnresolvedMealInputTaxEligibility } from '../engine/responseAssembler';
import { extractAccountingContext } from './conversationAccountingState';
import { hasVerifiedSourceUrlProvenance, isApprovedSingaporeSourceUrl } from '../standards/approvedSourceRegistry';
import {
  getIrasTaxRouteArea,
  getOfficialSourceDiscoveryProviderConfig,
  isOfficialSourceCandidateMateriallyRelevant,
  isIrasSourceUrlAreaCompatible,
  OfficialDomainSearchAdapter as DefaultOfficialDomainSearchAdapter,
  OfficialSitemapDiscoveryAdapter
} from '../retrieval/officialSitemapDiscovery';
import { defaultTargetDateResolver, TargetDateResolver } from '../retrieval/targetDateResolver';
import { defaultExternalSourceValidator, matchesTopicContentTerm } from '../retrieval/externalSourceValidator';
import { evaluateEvidenceQuality, type EvidenceQualityAssessment } from '../retrieval/evidenceQualityGate';
import { supportGeneralIrasRuleConcept } from '../retrieval/irasRuleConceptSupport';
import { formatIrasEvidencePrompt, renderIrasEvidenceResponse, usesIrasEvidencePolicy } from './irasEvidencePolicy';
import { computeVerifiedStandardGst } from '../engine/verifiedGstCalculation';
import type { AuthorityEvidenceScope } from '../types/authorityEvidence';
import {
  buildSemanticDiscoveryQuery,
  getRequestedQuestionConcepts,
  getSemanticIrasDiscoveryContext,
  interpretSemanticQuestion,
  isShortSemanticFollowUp,
  reconcileQuestionUnderstanding,
  type RequestedQuestionConcept,
  type SemanticQuestionUnderstanding
} from './semanticQuestionUnderstanding';
import {
  createRequestCompletenessContext,
  ensureRequestCompletenessContext,
  readRequestCompletenessObservation,
  type RequestCompletenessContext
} from './requestCompleteness';

const APPROVED_ACCOUNTING_DISCOVERY_HOSTS = ['ifrs.org', 'www.ifrs.org', 'asc.acra.gov.sg', 'acra.gov.sg', 'www.acra.gov.sg'] as const;
const APPROVED_IRAS_DISCOVERY_HOSTS = ['www.iras.gov.sg', 'iras.gov.sg', 'sso.agc.gov.sg'] as const;

/**
 * Provider-neutral structured reasoning context.
 * Shared identically across Gemini, OpenAI, and Azure OpenAI adapters.
 */
export interface GroundedReasoningContext {
  evidenceQuality?: EvidenceQualityAssessment;
  classification: QuestionClassificationResult;
  userFacts: string[];
  missingFacts: string[];
  assumptions: ExplicitAssumption[];
  primaryEvidence: AuthoritativeSourceRecord[];
  officialGuidance: AuthoritativeSourceRecord[];
  curatedSummaries: AuthoritativeSourceRecord[];
  applicationRules: string[];
  currentInformationRequired: boolean;
  semanticUnderstanding?: TransactionUnderstanding;
  questionUnderstanding?: SemanticQuestionUnderstanding;
  /** Immutable exact-query representation diagnostics, separate from evidence scope. */
  requestCompletenessContext?: RequestCompletenessContext;
  sourceMapFallbackTrace?: SourceMapFallbackTrace;
}

export interface SourceMapFallbackAttempt {
  topicId: string;
  sourceMapId?: string;
  candidateUrl?: string;
  /** Official fetched page whose explicit anchor exposed a child candidate. */
  discoverySourceUrl?: string;
  fetchStatus: string;
  finalUrl?: string;
  pageTitle?: string;
  titleMatched: boolean;
  contentMatched: boolean;
  discoveryStage?: 'MAPPED_SOURCE' | 'SITEMAP_DISCOVERY' | 'OFFICIAL_DOMAIN_SEARCH';
  searchQueryVariant?: 'FULL_QUERY' | 'TOPIC_HINT_1' | 'TOPIC_HINT_2' | 'TOPIC_HINT_3';
  error?: string;
}

export interface SourceMapFallbackTrace {
  path: 'NOT_NEEDED' | 'MAPPED_SOURCE' | 'DISCOVERED_SOURCE' | 'MAPPED_SOURCE_REJECTED' | 'NO_VERIFIED_MAP';
  sourceMapIds: string[];
  selectedRecordIds: string[];
  finalVerifiedUrls: string[];
  candidateOnly: boolean;
  attempts: SourceMapFallbackAttempt[];
  /** Status-only sitemap/robots fetch metadata; never a fetched evidence candidate. */
  discoveryFetchAttempts?: Array<{ topicId: string; fetchStatus: string }>;
  /** Bounded snapshots explain which validated records were considered for each requested coverage scope. */
  coverageDecisions?: Array<{
    scope: 'TOPIC' | 'REGISTERED';
    targetTopicIds: string[];
    admissionTopicIds: string[];
    eligibleRecordIds: string[];
    rejectedRecords: Array<{ recordId: string; code: string; reason: string }>;
    uncoveredTopicIds: string[];
    uncoveredConcepts: string[];
  }>;
  stages?: Array<{ stage: 'LOCAL_VERIFIED' | 'MAPPED_SOURCE' | 'SITEMAP_DISCOVERY' | 'OFFICIAL_DOMAIN_SEARCH' | 'INSUFFICIENT'; status: 'SUFFICIENT' | 'ATTEMPTED' | 'EXHAUSTED' | 'SKIPPED'; reason: string }>;
}

export interface GroundingEvidenceTrace {
  recordId: string;
  lifecycleState?: string;
  groundingEligible: boolean;
  provenance: string;
  officialSourceUrl?: string;
  fetchStatus?: string;
  finalUrl?: string;
  topicMatched?: boolean;
  titleMatched?: boolean;
  contentMatched?: boolean;
  candidateOnly: boolean;
}

interface MappedCoverageTopic extends SingaporeCoverageTopic {
  effectiveFrom?: string;
  effectiveTo?: string;
  relatedTopicIds?: string[];
  paragraphHints?: string[];
  sectionHints?: string[];
  aliases?: string[];
  canonicalSourceId?: string;
  canonicalSourceUrl?: string;
  pageTitle?: string;
  /** Query-scoped evidence concepts; labels are discovery aids, never evidence. */
  requestedConcepts?: RequestedQuestionConcept[];
  mappedTopicIds?: string[];
}

const EMPLOYEE_BENEFIT_TAX_CONCEPT_IDS = new Set([
  'employee_benefit_tax_treatment',
  'employee_reimbursement_tax_treatment',
  'employee_housing_benefit_tax_treatment',
  'employee_personal_insurance_tax_treatment'
]);

function isEmployeeBenefitTaxTopic(topic: MappedCoverageTopic): boolean {
  return topic.id === 'iras-employment-benefits' ||
    topic.requestedConcepts?.some(concept => EMPLOYEE_BENEFIT_TAX_CONCEPT_IDS.has(concept.id)) === true;
}

function pageDiscussesEmployeeBenefitTaxTreatment(pageText: string): boolean {
  const normalized = normalizeEvidenceText(pageText);
  const subjects = /\b(?:benefits? in kind|perquisites?|employment benefits?|benefits?|reimbursements?|allowances?|insurance|housing|accommodation)\b/g;
  for (const match of normalized.matchAll(subjects)) {
    const index = match.index || 0;
    // IRAS tables often put the subject, employee context, and tax outcome in
    // adjacent cells or lines instead of a single sentence. Keep the window
    // tight enough that unrelated page sections cannot be combined.
    const start = Math.max(0, index - 180);
    const end = Math.min(normalized.length, index + match[0].length + 180);
    const context = normalized.slice(start, end);
    if (/\b(?:employee|employees|employment|staff|workers?)\b/.test(context) &&
        /\b(?:taxable|non taxable|not taxable|subject to tax|tax treatment|taxability|taxed)\b/.test(context)) return true;
  }
  return false;
}

interface SourceMapPointer extends AuthoritativeSourceRecord {
  recordRole?: 'EVIDENCE' | 'SOURCE_MAP_POINTER';
  groundingEligible?: boolean;
  sourceMapTopicIds?: string[];
  sourceMapScope?: 'STANDARD' | 'FRAMEWORK';
  retrievalHints?: string[];
  urlVerificationStatus?: 'VERIFIED' | 'CANDIDATE' | 'REJECTED';
}

export interface OfficialSourceDiscoveryRequest {
  query: string;
  authority?: string;
  topicId: string;
  topicDomainId?: string;
  scopeQuery?: string;
  topicTitle: string;
  standardOrAct: string;
  approvedHosts: readonly string[];
  /** Coverage-registry labels used only to rank discovery metadata. */
  topicHints?: readonly string[];
  /** Reviewed map titles help identify a moved page; they never establish evidence. */
  expectedTitles?: readonly string[];
  /** Explicitly mapped URLs may retain a cross-area declaration from the registry. */
  declaredSourceUrls?: readonly string[];
  /** Authority configuration for sitemap discovery; URLs remain metadata only. */
  sitemapUrls?: readonly string[];
  preferredHosts?: readonly string[];
  /** Exact approved hostname used to scope official-domain search. */
  searchSite?: string;
  searchEndpoint?: string;
  searchRedirectHost?: string;
  searchRedirectParameter?: string;
  lexicalDiscovery?: boolean;
  authorityLevelFallback?: boolean;
  maxCandidates?: number;
}

/** Trusted official-domain search adapter. Candidate URLs are always fetched and validated before use. */
export interface OfficialSourceDiscoveryAdapter {
  discoverOfficialSourceCandidates(request: OfficialSourceDiscoveryRequest): Promise<string[]>;
  getCandidateTitle?(url: string): string | undefined;
  /** Status-only transport trace for sitemap/robots fetches; never evidence. */
  getLastFetchTrace?(): Array<{ topicId: string; status: string }>;
}

/** Search returns candidate URLs only; every candidate is independently fetched and validated. */
export interface OfficialDomainSearchAdapter {
  searchOfficialDomainCandidates(request: OfficialSourceDiscoveryRequest): Promise<string[]>;
  getCandidateTitle?(url: string): string | undefined;
  getCandidateQueryVariant?(url: string): 'FULL_QUERY' | 'TOPIC_HINT_1' | 'TOPIC_HINT_2' | 'TOPIC_HINT_3' | undefined;
  getLastSearchTrace?(): Array<{ variant: 'FULL_QUERY' | 'TOPIC_HINT_1' | 'TOPIC_HINT_2' | 'TOPIC_HINT_3'; candidateUrls: string[]; status: 'RESULTS' | 'NO_CANDIDATES'; reason?: string }>;
}

export interface MappedFallbackOptions {
  webRetriever?: ControlledWebRetriever;
  fetchOptions?: Omit<ControlledFetchOptions, 'topicValidation'>;
  discoveryAdapter?: OfficialSourceDiscoveryAdapter;
  officialDomainSearchAdapter?: OfficialDomainSearchAdapter;
  /** Permit a transient authority-level query scope when no reviewed topic matches. */
  authorityLevelDiscovery?: boolean;
  /** Restrict this pass to reviewed local records; do not fetch mapped sources. */
  localOnly?: boolean;
  /** Stable date input used by target-date and freshness checks. */
  referenceDate?: string;
  /** The caller already found adequate reviewed local evidence. */
  localEvidenceAdequate?: boolean;
  /** Precomputed provider result; it is revalidated before it affects routing. */
  questionUnderstanding?: SemanticQuestionUnderstanding;
  /** Exact original query context; evidenceScope does not narrow its inventory. */
  requestCompletenessContext?: RequestCompletenessContext;
  /** Semantic intent terms used only for IRAS discovery/ranking, with original query retained. */
  semanticDiscoveryQuery?: string;
  /** Internal per-issue scope. Omitted callers retain the existing full-query behavior. */
  evidenceScope?: AuthorityEvidenceScope;
}

function topicMatchesEvidenceScope(topic: SingaporeCoverageTopic, scope?: AuthorityEvidenceScope): boolean {
  if (!scope) return true;
  if (!topic.authorities.includes(scope.authority)) return false;
  const expectedSourceDomain = scope.domain === 'IRAS_EMPLOYMENT_BENEFITS' || scope.domain === 'IRAS_EMPLOYER_REPORTING'
    ? 'IRAS_EMPLOYER_TAX'
    : scope.context.domainId;
  return topic.domainId === expectedSourceDomain;
}

const AUTHORITY_QUERY_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'did', 'do', 'does', 'for', 'from', 'has', 'have',
  'how', 'i', 'if', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'our', 'should', 'the', 'their', 'there',
  'these', 'this', 'to', 'under', 'was', 'we', 'what', 'when', 'where', 'which', 'while', 'who', 'will', 'with'
]);

function provisionalIrasDiscoveryTopic(query: string, semanticContext?: ReturnType<typeof getSemanticIrasDiscoveryContext>): MappedCoverageTopic {
  const lower = query.toLowerCase();
  // Select the taxpayer from the requested income/tax subject, not from a
  // background mention of an employee or an employer. Corporate income must
  // be attributed to the entity by an explicit subject phrase or income verb.
  const companyIncomeTarget = /\b(?:branch profits?|company profits?|company income|business income)\b/.test(lower) ||
    /\b(?:company|companies|corporation|business)\b.{0,60}\b(?:remit\w*|derive\w*|receive\w*|earn\w*|generate\w*|source\w*)\b.{0,60}\b(?:income|profits?)\b|\b(?:income|profits?)\b.{0,60}\b(?:of|from|received by|derived by|remitted by)\s+(?:a\s+)?(?:company|corporation|business)\b/.test(lower);
  const corporateTaxTarget = /\b(?:corporate income tax|corporate tax|company tax|business income tax)\b/.test(lower) ||
    companyIncomeTarget &&
    /\b(?:tax|taxable|exempt|chargeable|remit|relief)\b/.test(lower);
  const employmentBenefits = /\b(?:employee|employees|staff|workers?)\b/.test(lower) &&
    /\b(?:benefits?\s+in\s+kind|perquisites?|employment\s+benefits?|housing\s+allowances?|personal\s+insurance|reimbursements?)\b/.test(lower) &&
    /\b(?:tax(?:able|ability|ed)?|income\s+tax|perquisites?|benefits?\s+in\s+kind)\b/.test(lower);
  const individual = semanticContext
    ? semanticContext.population === 'INDIVIDUAL' || semanticContext.population === 'EMPLOYEE'
    : !corporateTaxTarget &&
    (employmentBenefits || /\b(?:individual|employee|employment income|salary|wages|tax resident|secondment|overseas posting)\b/.test(lower));
  const domainId = employmentBenefits ? 'IRAS_EMPLOYER_TAX' : semanticContext?.domainId || (individual ? 'IRAS_INDIVIDUAL_TAX'
    : corporateTaxTarget ? 'IRAS_CORPORATE_TAX'
      : /\b(?:gst|goods and services tax)\b/.test(lower) ? 'IRAS_GST'
        : /\b(?:company|companies|corporate|business|withholding tax|wht)\b/.test(lower) ? 'IRAS_CORPORATE_TAX' : 'IRAS_OTHER');
  const populationContext = employmentBenefits ? 'employee'
    : semanticContext
    ? semanticContext.population.toLowerCase().replace(/_/g, ' ')
    : individual ? 'individual employee' : domainId === 'IRAS_CORPORATE_TAX' ? 'company' : 'taxpayer';
  const semanticTerms = semanticContext ? [semanticContext.primarySubject, ...semanticContext.concepts].join(' ') : '';
  const normalized = normalizeEvidenceText(`${query} ${semanticTerms}`);
  const queryWords = [...new Set(normalized.split(' ').filter(word => word.length >= 4 && !AUTHORITY_QUERY_STOPWORDS.has(word)))];
  const phrases = new Set<string>();
  for (let index = 0; index < queryWords.length; index++) {
    phrases.add(queryWords[index]);
    if (queryWords[index + 1]) phrases.add(`${queryWords[index]} ${queryWords[index + 1]}`);
  }
  const meaningful = [...phrases].filter(phrase => phrase.length >= 7).slice(0, 32);
  const idSuffix = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'question';
  const topic = {
    id: `iras-authority-query-${idSuffix}`,
    title: `IRAS ${populationContext} guidance for ${semanticContext?.primarySubject || query.slice(0, 140)}`,
    domainId,
    priority: 'P1',
    status: 'MISSING',
    authorities: ['IRAS'],
    legacyDomains: [domainId === 'IRAS_GST' ? 'IRAS_GST' : 'IRAS_TAX'],
    sourceRecordIds: [],
    requiredChecks: ['SOURCE_PROVENANCE', 'RETRIEVAL_EVALUATION', 'TEMPORAL_VALIDITY'],
    keywords: meaningful,
    exclusionKeywords: [],
    aliases: [],
    actOrStandard: 'IRAS official guidance',
    shortDescription: `Transient ${populationContext} routing context derived from the complete user query and validated intent labels; not reviewed knowledge.`
  } as unknown as MappedCoverageTopic;
  return topic;
}

function provisionalIrasConceptTopics(
  query: string,
  semanticContext?: ReturnType<typeof getSemanticIrasDiscoveryContext>,
  requestedConcepts = semanticContext?.requestedConcepts || getRequestedQuestionConcepts(query)
): MappedCoverageTopic[] {
  const concepts = requestedConcepts;
  if (concepts.length === 0) return [provisionalIrasDiscoveryTopic(query, semanticContext)];
  const base = provisionalIrasDiscoveryTopic(query, semanticContext);
  return concepts.map(concept => {
    const slug = concept.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    const mappedTopics = getCoverageTopicsByIds(concept.topicIds);
    const preferredDomain = mappedTopics.find(topic => topic.domainId.startsWith('IRAS_'))?.domainId || base.domainId;
    const terms = [...new Set([concept.label, ...concept.terms].filter(Boolean))];
    return {
      ...base,
      id: `iras-authority-query-concept-${slug}`,
      title: String(preferredDomain) === 'IRAS_OTHER' && String(base.domainId) === 'IRAS_OTHER'
        ? `${base.title} — ${concept.label}`
        : `IRAS ${preferredDomain.replaceAll('_', ' ').replace(/^IRAS /, '')} — ${concept.label}`,
      domainId: preferredDomain,
      legacyDomains: ['IRAS_TAX'],
      keywords: terms,
      aliases: terms,
      requestedConcepts: [concept],
      mappedTopicIds: concept.topicIds
    } as MappedCoverageTopic;
  });
}

/**
 * The query-only evidence scope may be closed by the deterministic GST
 * calculator only when the sole requested outcome is the output GST and
 * invoice total. The calculator separately verifies the stated facts and the
 * admitted dated Section 16 rate record.
 */
export function isStandaloneOutputGstCalculationRequest(query: string): boolean {
  const text = query.normalize('NFC').trim();
  const requestStart = /\b(?:what|which|when|where|why|how|whether|if|can|could|should|do|does|did|will|would|explain|advise|assess|determine|confirm|calculate|compute|work\s+out)\b/i.exec(text);
  if (!requestStart || requestStart.index === undefined) return false;

  // Positively account for every clause before the request. This lets the
  // calculator facts pass without maintaining a growing list of forbidden
  // verbs or silently discarding arbitrary preceding text.
  const rawPrefix = text.slice(0, requestStart.index).trim();
  if (rawPrefix.includes('?')) return false;
  const prefix = rawPrefix.replace(/[.!]+$/g, '');
  // Keep decimal points in amounts such as SGD 1,000.50 intact.
  const factClauses = prefix.split(/[;]|(?<!\d)\.(?!\d)|[!\n]+/).map(clause => clause.trim()).filter(Boolean);
  if (factClauses.length !== 2 || !isSupportedStandardRatedSupplyFact(factClauses[0]) ||
      !isSupportedAlignedInvoicePaymentFact(factClauses[1])) return false;

  const request = text.slice(requestStart.index).trim().replace(/[?.!]+$/g, '').replace(/\s+/g, ' ').toLowerCase();
  const outputTax = '(?:output\\s+(?:gst|tax)(?:\\s+amount)?|gst\\s+amount)';
  const invoiceTotal = '(?:invoice\\s+total|total\\s+invoice\\s+amount)';
  const article = '(?:the\\s+)?';
  const calculationRequests = [
    new RegExp(`^what\\s+(?:is|are)\\s+${article}${outputTax}(?:\\s+and\\s+${article}${invoiceTotal})?$`, 'i'),
    new RegExp(`^what\\s+(?:is|are)\\s+${article}${invoiceTotal}(?:\\s+and\\s+${article}${outputTax})?$`, 'i'),
    new RegExp(`^(?:calculate|compute|work\\s+out|determine)\\s+${article}${outputTax}(?:\\s+and\\s+${article}${invoiceTotal})?$`, 'i'),
    new RegExp(`^how\\s+much\\s+(?:output\\s+)?(?:gst|tax)(?:\\s+amount)?(?:\\s+(?:should|must)\\s+(?:we|i|the\\s+supplier)\\s+(?:charge|collect))?(?:,?\\s+and\\s+what\\s+(?:is|are)\\s+${article}${invoiceTotal})?$`, 'i')
  ];
  // The whole request tail must consist of supported calculator outputs.
  // Additional requested concepts before or after them keep the full-query
  // provisional scope uncovered.
  return calculationRequests.some(pattern => pattern.test(request));
}

function isSupportedStandardRatedSupplyFact(clause: string): boolean {
  const amount = '(?:SGD\\s*|S\\$\\s*)(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?';
  const month = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
  const date = `(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}\\/\\d{4}|\\d{1,2}\\s+${month}\\s+\\d{4}|${month}\\s+\\d{1,2},?\\s+\\d{4})`;
  return new RegExp(
    `^(?:a\\s+|the\\s+)?GST[ -]registered(?:\\s+Singapore)?\\s+supplier\\s+(?:made|makes|supplied|provided)\\s+(?:a\\s+)?(?:standard[ -]rated\\s+(?:domestic\\s+)?|domestic\\s+standard[ -]rated\\s+)(?:taxable\\s+)?supply\\s+(?:for|of)\\s+${amount}\\s+tax[ -]exclusive\\s+(?:on|dated)\\s+${date}$`,
    'i'
  ).test(clause);
}

function isSupportedAlignedInvoicePaymentFact(clause: string): boolean {
  const sameDate = '(?:that|this|same|the same)\\s+(?:date|day)';
  const invoiceAndPayment = new RegExp(
    `^(?:the\\s+)?invoice\\s+and\\s+(?:the\\s+)?payment\\s+(?:(?:both\\s+)?were(?:\\s+made)?|occurred|took\\s+place)\\s+(?:on\\s+)?${sameDate}$`,
    'i'
  );
  const issuedAndPaid = new RegExp(
    `^(?:the\\s+)?invoice\\s+(?:was\\s+)?(?:issued|dated)\\s+(?:on\\s+)?${sameDate}\\s+and\\s+(?:the\\s+)?payment\\s+(?:was\\s+)?(?:made|paid|received)\\s+(?:on\\s+)?${sameDate}$`,
    'i'
  );
  return invoiceAndPayment.test(clause) || issuedAndPaid.test(clause);
}

function applyStandaloneGstCalculationCoverage(
  query: string,
  assessment: EvidenceQualityAssessment,
  missingFacts: string[]
): EvidenceQualityAssessment {
  const uncoveredProvisionalIds = assessment.uncoveredTopicIds.filter(id => id.startsWith('iras-authority-query-'));
  if (uncoveredProvisionalIds.length !== 1 || !isStandaloneOutputGstCalculationRequest(query) ||
      !computeVerifiedStandardGst(query, assessment.eligibleRecords, assessment.targetDate, missingFacts)) {
    return assessment;
  }

  const covered = new Set(uncoveredProvisionalIds);
  const uncoveredTopicIds = assessment.uncoveredTopicIds.filter(id => !covered.has(id));
  const uncoveredConceptGroups = assessment.uncoveredConceptGroups
    ? Object.fromEntries(Object.entries(assessment.uncoveredConceptGroups).filter(([id]) => !covered.has(id)))
    : undefined;
  const status: EvidenceQualityAssessment['status'] = assessment.missingFacts.length > 0 || uncoveredTopicIds.length > 0
    ? 'LIMITED'
    : assessment.eligibleRecords.every(record => record.provenance === 'LOCAL_STATIC')
      ? 'LOCAL_SUFFICIENT'
      : 'RETRIEVED_SUFFICIENT';
  return {
    ...assessment,
    status,
    coveredTopicIds: [...assessment.coveredTopicIds, ...uncoveredProvisionalIds],
    uncoveredTopicIds,
    ...(uncoveredConceptGroups && Object.keys(uncoveredConceptGroups).length > 0
      ? { uncoveredConceptGroups }
      : { uncoveredConceptGroups: undefined })
  };
}

interface CachedDiscoveryAdapters {
  defaultAdapter?: OfficialSourceDiscoveryAdapter;
  adaptersByCustomFetch: WeakMap<Function, Map<number | undefined, OfficialSourceDiscoveryAdapter>>;
}

const discoveryAdaptersByRetriever = new WeakMap<ControlledWebRetriever, CachedDiscoveryAdapters>();

function getDefaultDiscoveryAdapter(
  webRetriever: ControlledWebRetriever,
  fetchOptions?: MappedFallbackOptions['fetchOptions']
): OfficialSourceDiscoveryAdapter {
  let cached = discoveryAdaptersByRetriever.get(webRetriever);
  if (!cached) {
    cached = { adaptersByCustomFetch: new WeakMap() };
    discoveryAdaptersByRetriever.set(webRetriever, cached);
  }

  const customFetch = fetchOptions?.customFetch;
  if (customFetch) {
    let adaptersByTimeout = cached.adaptersByCustomFetch.get(customFetch);
    if (!adaptersByTimeout) {
      adaptersByTimeout = new Map();
      cached.adaptersByCustomFetch.set(customFetch, adaptersByTimeout);
    }
    const timeoutMs = fetchOptions.timeoutMs;
    let adapter = adaptersByTimeout.get(timeoutMs);
    if (!adapter) {
      adapter = new OfficialSitemapDiscoveryAdapter(webRetriever, fetchOptions);
      adaptersByTimeout.set(timeoutMs, adapter);
    }
    return adapter;
  }

  if (!cached.defaultAdapter) {
    cached.defaultAdapter = new OfficialSitemapDiscoveryAdapter(webRetriever, fetchOptions);
  }
  return cached.defaultAdapter;
}

function getDefaultOfficialDomainSearchAdapter(
  webRetriever: ControlledWebRetriever,
  fetchOptions?: MappedFallbackOptions['fetchOptions']
): OfficialDomainSearchAdapter {
  return new DefaultOfficialDomainSearchAdapter(webRetriever, fetchOptions);
}

/** Maximum number of source records requested by production grounding. */
export const GROUNDING_SOURCE_MAX_RESULTS = 6;

/**
 * Maps query canonical domain to source retriever domain
 */
function mapCanonicalDomainToQueryDomain(domain: string): QueryDomain {
  switch (domain) {
    case 'ACCOUNTING':
      return 'ACCOUNTING_SFRS';
    case 'TAX':
      return 'IRAS_TAX';
    case 'GST':
      return 'IRAS_GST';
    case 'CORPORATE_REGULATORY':
      return 'ACRA_CORP';
    case 'EMPLOYMENT':
      return 'MOM_EMPLOYMENT';
    case 'PAYROLL':
      return 'CPF_BOARD';
    case 'MAS_FUNDS':
      return 'MAS_FUNDS';
    default:
      return 'GENERAL';
  }
}

/** Build shared, conflict-safe retrieval hints for production and evaluation callers. */
export function buildClassificationRetrievalHints(
  classification: QuestionClassificationResult
): Pick<SourceRetrievalQuery, 'domain' | 'authorities' | 'topicIds'> {
  const matchedCoverageTopics = getCoverageTopicsByIds(classification.topicIds);
  const topicLegacyDomains = [...new Set(matchedCoverageTopics.flatMap(topic => topic.legacyDomains))];
  const legacyPrimaryDomain = mapCanonicalDomainToQueryDomain(classification.primaryDomain);
  const hasTopicDomainConflict = topicLegacyDomains.length === 1 &&
    classification.primaryDomain !== 'GENERAL' &&
    topicLegacyDomains[0] !== legacyPrimaryDomain;
  const targetDomain = classification.multiAuthority || hasTopicDomainConflict
    ? undefined
    : topicLegacyDomains.length === 1
      ? topicLegacyDomains[0]
      : topicLegacyDomains.length === 0
        ? legacyPrimaryDomain
        : undefined;
  const authorities = [...new Set(classification.authorities as StatutoryAuthority[])];

  return {
    domain: targetDomain && targetDomain !== 'GENERAL' ? targetDomain : undefined,
    authorities: authorities.length > 0 ? authorities : undefined,
    topicIds: classification.topicIds
  };
}

function normalizeEvidenceText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const TOPIC_TERM_STOPWORDS = new Set(['a', 'an', 'and', 'of', 'the']);

function normalizeTopicTerm(text: string): string {
  return normalizeEvidenceText(text)
    .split(/\s+/)
    .filter(token => token && !TOPIC_TERM_STOPWORDS.has(token))
    .join(' ');
}

function containsTopicTerm(text: string, term: string): boolean {
  const normalizedText = normalizeTopicTerm(text);
  const normalizedTerm = normalizeTopicTerm(term);
  return Boolean(normalizedTerm && ` ${normalizedText} `.includes(` ${normalizedTerm} `));
}

function containsRequiredContentTermsInOneBlock(text: string, terms: string[]): boolean {
  if (terms.length === 0) return true;
  return text.split(/\n{2,}/).some(block => terms.every(term => containsTopicTerm(block, term)));
}

function isRelatedTopicRelevant(topic: MappedCoverageTopic, query: string): boolean {
  const q = normalizeEvidenceText(query);
  const phrases = [topic.title, ...(topic.aliases || []), ...topic.keywords]
    .map(normalizeEvidenceText)
    .filter(value => value.length > 3);
  if (phrases.some(phrase => q.includes(phrase))) return true;

  // Related-topic expansion is supplementary routing. Require a focused
  // topic pattern rather than a small token overlap: generic words such as
  // "control", "acquisition", or "interest" otherwise pull unrelated
  // standards into the source selection.
  return (topic.queryPatterns || []).some(pattern => {
    try {
      return new RegExp(pattern, 'i').test(query);
    } catch {
      return false;
    }
  });
}

function isSourceMapRelevantToQuery(pointer: SourceMapPointer, query: string): boolean {
  const title = normalizeEvidenceText(pointer.documentTitle);
  const asksAboutServices = /\bservices?\b/i.test(query);
  const asksAboutGoodsOrExports = /\b(?:goods?|exports?|exporting|shipments?)\b/i.test(query);
  const asksPaymentSpecificWht = /\b(?:interest|royalt(?:y|ies)|management fees?|service fees?|consultancy fees?)\b/i.test(query) &&
    /\b(?:wht|withholding tax)\b/i.test(query);
  if (title.includes('exporting of goods') && asksAboutServices && !asksAboutGoodsOrExports) return false;
  if (title.includes('providing international services') && asksAboutGoodsOrExports && !asksAboutServices) return false;
  if (title.includes('overview of withholding tax') && asksPaymentSpecificWht) return false;
  return true;
}

function irasCandidateDomainMismatch(query: string, topic: MappedCoverageTopic, candidateUrl: string): string | undefined {
  let approvedIrasUrl = false;
  try {
    const candidate = new URL(candidateUrl);
    approvedIrasUrl = candidate.protocol === 'https:' && isApprovedSingaporeSourceUrl(candidate.toString());
  } catch { /* an invalid URL is rejected by the surrounding URL/provenance gates */ }
  if (!approvedIrasUrl) return undefined;
  const routeArea = getIrasTaxRouteArea(candidateUrl);
  const pageIsIndividualIncomeTaxRoute = routeArea === 'INDIVIDUAL';
  const pageIsCorporateIncomeTaxRoute = routeArea === 'CORPORATE';
  const pageIsGstRoute = routeArea === 'GST';
  const pageIsWithholdingTaxRoute = routeArea === 'WITHHOLDING';
  const pageIsPropertyTaxRoute = routeArea === 'PROPERTY';
  const pageIsStampDutyRoute = routeArea === 'STAMP_DUTY';
  const queryExplicitlyConcernsWithholdingTax = /\b(?:withholding[-\s]+tax|wht|withhold(?:ing)? monies|payer)\b/i.test(query);
  if (isEmployeeBenefitTaxTopic(topic) && pageIsCorporateIncomeTaxRoute) {
    return 'The fetched IRAS page is in the corporate income-tax domain, which does not match employee benefit tax treatment.';
  }
  if (pageIsGstRoute && topic.domainId !== 'IRAS_GST') {
    return 'The fetched IRAS page is in the GST domain, which does not match the unresolved tax topic.';
  }
  if (topic.domainId === 'IRAS_CORPORATE_TAX' && pageIsIndividualIncomeTaxRoute) {
    return 'The fetched IRAS page is in the individual income-tax domain, which does not match the corporate-tax topic.';
  }
  if (topic.domainId === 'IRAS_INDIVIDUAL_TAX' && pageIsCorporateIncomeTaxRoute) {
    return 'The fetched IRAS page is in the corporate income-tax domain, which does not match the individual-tax topic.';
  }
  if (topic.domainId === 'IRAS_CORPORATE_TAX' && pageIsWithholdingTaxRoute && !queryExplicitlyConcernsWithholdingTax) {
    return 'The fetched IRAS page is in the withholding-tax domain, which does not match the corporate-income topic.';
  }
  if ((topic.domainId === 'IRAS_CORPORATE_TAX' || topic.domainId === 'IRAS_INDIVIDUAL_TAX') &&
      (pageIsPropertyTaxRoute || pageIsStampDutyRoute)) {
    return 'The fetched IRAS page is in a different tax domain from the unresolved income-tax topic.';
  }
  return undefined;
}

function candidateMatchesIrasPopulation(query: string, topic: MappedCoverageTopic, pageTitle: string, pageText: string, candidateUrl: string): boolean {
  const text = `${pageTitle}\n${pageText}`.toLowerCase();
  let path = '';
  try {
    const candidate = new URL(candidateUrl);
    if (candidate.protocol === 'https:' && isApprovedSingaporeSourceUrl(candidate.toString())) {
      path = decodeURIComponent(candidate.pathname).toLowerCase();
    }
  } catch { /* an invalid URL is rejected by the surrounding URL/provenance gates */ }
  const queryIsEmployee = /\b(?:employee|employment income|salary|wages|secondment|overseas posting)\b/i.test(query);
  const queryIsEmployer = /\b(?:employer|payroll|ir8a|ir21|withhold monies)\b/i.test(query);
  const queryIsNonResidentRecipient = /\bnon[ -]resident\b/i.test(query) && /\b(?:recipient|consultant|professional|royalt(?:y|ies)|interest payment|service fee)\b/i.test(query);
  const pageIsIndividualIncomeTaxRoute = /^\/taxes\/individual-income-tax(?:\/|$)/.test(path);
  const pageIsEmployerRoute = /\/employers(?:\/|$)/.test(path);
  const pageIsWithholdingTaxRoute = /^\/taxes\/withholding-tax(?:\/|$)/.test(path);
  const pageHasEmployeeContext = /\b(?:employee|employees|employment|employment income|salary|wages)\b/i.test(text);
  const pageHasIndividualContext = /\b(?:individual|personal income|individual income tax|tax resident|resident individual|taxpayer)\b/i.test(text) ||
    (pageIsIndividualIncomeTaxRoute && !pageIsEmployerRoute);
  const pageHasEmployerContext = /\b(?:employer|payroll|ir8a|ir21|employee)\b/i.test(text);
  const pageHasRecipientContext = /\b(?:non[ -]resident|consultant|professional|recipient|royalt(?:y|ies)|interest payment|service fee)\b/i.test(text);
  const pageTitleIsCorporate = /\b(?:companies receiving|corporate income tax|company tax|corporate tax|business income)\b/i.test(pageTitle);
  const pageIsCorporateTaxRoute = /^\/taxes\/corporate-income-tax(?:\/|$)/.test(path);
  const topicRequiresEmploymentPage = topic.id === 'iras-individual-overseas-employment' ||
    topic.id === 'iras-individual-foreign-employment-income';
  const queryExplicitlyConcernsWithholdingTax = /\b(?:withholding[-\s]+tax|wht|withhold(?:ing)? monies|payer)\b/i.test(query);
  // Individual residence and foreign-tax-credit guidance can apply to an
  // employment query without repeating employee wording on every page. Require
  // employment-specific page content only for the employment topics themselves.
  if (topic.domainId === 'IRAS_INDIVIDUAL_TAX' && queryIsEmployee && topicRequiresEmploymentPage &&
      (!pageHasEmployeeContext || pageIsEmployerRoute)) return false;
  if (topic.domainId === 'IRAS_INDIVIDUAL_TAX' && !queryIsEmployee && !pageHasIndividualContext) return false;
  if (topic.domainId === 'IRAS_INDIVIDUAL_TAX' && queryIsEmployer && !pageHasEmployerContext) return false;
  if (topic.domainId === 'IRAS_INDIVIDUAL_TAX' && !queryIsEmployer && pageIsEmployerRoute) return false;
  if (topic.domainId === 'IRAS_INDIVIDUAL_TAX' && pageIsCorporateTaxRoute) return false;
  if (topic.domainId === 'IRAS_INDIVIDUAL_TAX' && pageIsWithholdingTaxRoute && !queryExplicitlyConcernsWithholdingTax) return false;
  if (topic.domainId === 'IRAS_INDIVIDUAL_TAX' && pageTitleIsCorporate && !pageHasIndividualContext && !pageHasEmployeeContext) return false;
  if (topic.domainId === 'IRAS_EMPLOYER_TAX' && queryIsEmployer && !pageHasEmployerContext) return false;
  if (isEmployeeBenefitTaxTopic(topic) && !pageDiscussesEmployeeBenefitTaxTreatment(pageText)) return false;
  if (topic.domainId === 'IRAS_CORPORATE_TAX' && queryIsNonResidentRecipient && !pageHasRecipientContext) return false;
  return true;
}

function isLocalGstRateRecord(record: AuthoritativeSourceRecord): boolean {
  return record.authority === 'IRAS' &&
    record.domain === 'IRAS_GST' &&
    record.standardOrActCode === 'GSTA1993' &&
    /\bsection\s*16\b/i.test(record.paragraphOrSection) &&
    record.provenance === 'LOCAL_STATIC' &&
    record.lifecycleState === 'ACTIVE' &&
    (record.sourceStatus === 'VERIFIED' || record.sourceStatus === 'HISTORICAL') &&
    Boolean(record.validFrom);
}

/**
 * A cross-year invoice/payment question can require both sides of an explicit
 * GST rate boundary. Follow only a local statutory predecessor/successor link
 * when the query names the two adjacent validity years; never infer a rate or
 * add neighboring versions for a single-date/current-rate question.
 */
function getExplicitlyLinkedGstRateRecords(
  query: string,
  retrieved: AuthoritativeSourceRecord[],
  retriever: ISourceRetriever
): AuthoritativeSourceRecord[] {
  if (!/\b(?:gst|goods\s+and\s+services\s+tax)\b/i.test(query) ||
      !/\b(?:invoice|invoiced|payment|paid|time\s+of\s+supply)\b/i.test(query)) return [];

  const years = [...new Set((query.match(/\b20\d{2}\b/g) || []).map(Number))].sort((a, b) => a - b);
  if (years.length !== 2 || years[1] !== years[0] + 1) return [];
  const [earlierYear, laterYear] = years;
  const rateRecords = retrieved.filter(isLocalGstRateRecord);
  const additions = new Map<string, AuthoritativeSourceRecord>();

  for (const base of rateRecords) {
    const linkedIds = [base.supersededByRecordId, base.historicalPredecessorRecordId].filter((id): id is string => Boolean(id));
    for (const linkedId of linkedIds) {
      const linked = retriever.getSourceById(linkedId);
      if (!linked || !isLocalGstRateRecord(linked) || rateRecords.some(record => record.id === linked.id)) continue;

      const earlier = base.validTo && base.validTo.slice(0, 4) === String(earlierYear) ? base
        : linked.validTo && linked.validTo.slice(0, 4) === String(earlierYear) ? linked
          : undefined;
      const later = base.validFrom && base.validFrom.slice(0, 4) === String(laterYear) ? base
        : linked.validFrom && linked.validFrom.slice(0, 4) === String(laterYear) ? linked
          : undefined;
      const linkedBoundaryCrossesYears = Boolean(
        earlier?.validTo?.slice(0, 4) === String(earlierYear) &&
        later?.validFrom?.slice(0, 4) === String(laterYear) &&
        (earlier.supersededByRecordId === later.id || earlier.historicalPredecessorRecordId === later.id ||
          later.supersededByRecordId === earlier.id || later.historicalPredecessorRecordId === earlier.id)
      );
      if (linkedBoundaryCrossesYears) additions.set(linked.id, linked);
    }
  }

  return [...additions.values()];
}

function isAssociateToSubsidiaryTransitionQuestion(query: string): boolean {
  const hasAssociateContext = /\b(?:associate|equity[\s-]*accounted|previously held|existing investment)\b/i.test(query);
  const hasAdditionalAcquisition = /\b(?:acquir\w*|purchas\w*|additional|further|increas\w*)\b/i.test(query);
  const hasControlTransition = /\b(?:control|subsidiar\w*)\b/i.test(query);
  return hasAssociateContext && hasAdditionalAcquisition && hasControlTransition;
}

function getTopicStandardIdentifiers(topic: MappedCoverageTopic, pointer?: SourceMapPointer): string[] {
  const instruments = [pointer?.standardOrActCode, pointer?.documentTitle, topic.pageTitle, topic.actOrStandard]
    .filter((value): value is string => Boolean(value));
  const identifiers = new Set<string>();
  for (const instrument of instruments) {
    for (const match of instrument.matchAll(/\b(?:SFRS\s*\(\s*I\s*\)|IFRS|IAS)\s*\d+(?:\s*[-/]\s*\d+)?/gi)) {
      identifiers.add(match[0].replace(/\s+/g, ' ').trim());
    }
  }
  if (pointer?.standardOrActCode) identifiers.add(pointer.standardOrActCode);
  // An exact reviewed IRAS page title identifies the mapped guidance when its
  // article text does not spell out the full GST or Income Tax Act name.
  if (topic.domainId.startsWith('IRAS_') && pointer?.documentTitle) identifiers.add(pointer.documentTitle);
  return [...identifiers];
}

// CPF indexes use umbrella article titles rather than registry topic labels.
// These aliases rank discovery metadata and identify page titles; fetched text must still contain
// the original topic's specific content terms before it can become evidence.
const CPF_DISCOVERY_TITLE_HINTS: Readonly<Record<string, readonly string[]>> = {
  'cpf-ordinary-wages': ['What constitutes wages for CPF contributions'],
  'cpf-additional-wages': ['What constitutes wages for CPF contributions'],
  'cpf-bonus-backpay': ['What constitutes wages for CPF contributions'],
  'cpf-notice-pay-leave-encashment': ['What constitutes wages for CPF contributions'],
  'cpf-allowances': ['What constitutes wages for CPF contributions'],
  'cpf_wage_ceiling': ['How much CPF contributions to pay'],
  'cpf_contribution_rates': ['How much CPF contributions to pay'],
  'cpf-pr-contribution-rates': ['How much CPF contributions to pay'],
  'cpf-additional-wage-ceiling': ['How much CPF contributions to pay'],
  'cpf-contribution-due-dates': ['Enforcement and penalties for non-compliance'],
  'cpf-cash-top-up-tax-relief': ['Top up to enjoy higher retirement payouts', 'Top up your MediSave savings']
};

function getTopicDiscoveryHints(topic: MappedCoverageTopic): string[] {
  return [...(topic.aliases || []), ...topic.keywords, ...(CPF_DISCOVERY_TITLE_HINTS[topic.id] || [])];
}

function getTopicContentTerms(topic: MappedCoverageTopic): string[] {
  const allTerms = [...new Set([
    topic.title,
    ...(topic.aliases || []),
    ...topic.keywords,
    // CPF's enforcement article states the due date with this official wording.
    ...(topic.id === 'cpf-contribution-due-dates' ? ['due date for CPF contributions', 'late payment interest'] : []),
    // The member retirement article calls these cash top-ups without a CPF prefix.
    ...(topic.id === 'cpf-cash-top-up-tax-relief' ? ['cash top-up', 'cash top-ups'] : []),
    ...(topic.requiredContentTerms || []),
    ...(topic.paragraphHints || []),
    ...(topic.sectionHints || [])
  ].filter(term => term.trim().length > 2))];
  // A generic one-word title such as "control" or "goodwill" is not enough
  // to validate a live overview for a specific subtopic. Require a focused
  // topic phrase whenever one is available.
  const focusedTerms = allTerms.filter(term => normalizeEvidenceText(term).split(/\s+/).filter(Boolean).length >= 2);
  // Authority-level scopes are built from the complete user query, not from
  // reviewed topic labels. Keep distinctive single query terms as well as
  // phrases so a valid official page is not rejected just because its wording
  // does not preserve the query's adjacent word order.
  if (topic.id.startsWith('iras-authority-query-')) return allTerms;
  return focusedTerms.length > 0 ? focusedTerms : allTerms;
}

interface LinkedOfficialCandidate {
  url: string;
  title?: string;
  discoverySourceUrl: string;
}

function rankRelevantOfficialPageLinks(
  links: readonly { href: string; text: string }[],
  parentUrl: string,
  topic: MappedCoverageTopic,
  query: string,
  approvedHosts: readonly string[]
): LinkedOfficialCandidate[] {
  let parent: URL;
  try { parent = new URL(parentUrl); } catch { return []; }
  if (parent.protocol !== 'https:' || !approvedHosts.includes(parent.hostname.toLowerCase())) return [];
  const stopWords = new Set(['iras', 'singapore', 'tax', 'taxes', 'income', 'individual', 'employee', 'employment', 'official', 'guidance', 'the', 'and', 'for', 'from', 'with', 'under', 'what', 'when', 'how']);
  const hints = [topic.title, ...(topic.aliases || []), ...topic.keywords, ...(topic.requiredContentTerms || [])];
  const hintWords = new Set(normalizeEvidenceText(`${hints.join(' ')} ${query}`).split(' ')
    .filter(word => word.length >= 4 && !stopWords.has(word)));
  const candidates = new Map<string, { title?: string; score: number }>();
  for (const link of links) {
    let candidate: URL;
    try { candidate = new URL(link.href, parent); } catch { continue; }
    if (candidate.protocol !== 'https:' || candidate.username || candidate.password ||
        !approvedHosts.includes(candidate.hostname.toLowerCase())) continue;
    candidate.hash = '';
    if (candidate.toString() === parent.toString()) continue;
    const searchable = normalizeEvidenceText(`${candidate.pathname} ${link.text}`);
    const phraseMatch = hints.some(hint => {
      const phrase = normalizeEvidenceText(hint);
      return phrase.split(' ').length >= 2 && phrase.length >= 9 && searchable.includes(phrase);
    });
    const overlap = [...hintWords].filter(word => searchable.split(' ').includes(word)).length;
    if (!phraseMatch && overlap < 2) continue;
    const score = (phraseMatch ? 100 : 0) + overlap;
    const url = candidate.toString();
    const current = candidates.get(url);
    if (!current || score > current.score) candidates.set(url, { title: link.text.trim() || undefined, score });
  }
  return [...candidates.entries()]
    .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([url, candidate]) => ({ url, title: candidate.title, discoverySourceUrl: parent.toString() }));
}

function candidateTitlePhrases(title: string | undefined): string[] {
  if (!title) return [];
  const stopwords = new Set(['iras', 'tax', 'the', 'and', 'for', 'from', 'my', 'want', 'know', 'to', 'on', 'of']);
  const words = normalizeEvidenceText(title).split(' ').filter(word => word && !stopwords.has(word));
  const phrases = new Set<string>();
  for (let index = 0; index < words.length; index++) {
    if (words[index + 1]) phrases.add(`${words[index]} ${words[index + 1]}`);
    if (words[index + 1] && words[index + 2]) phrases.add(`${words[index]} ${words[index + 1]} ${words[index + 2]}`);
  }
  return [...phrases].slice(-12);
}

function completeScopedRulePassage(
  pageText: string,
  topic: MappedCoverageTopic,
  subject: string | undefined,
  population: string | undefined,
  concepts: RequestedQuestionConcept[],
  maxChars: number
): string | undefined {
  if (!subject || population !== 'COMPANY' || topic.id !== 'iras-foreign-sourced-income' ||
      !concepts.some(concept => concept.id === 'foreign_dividend_receipt_tax_treatment')) return undefined;
  const conceptScope = concepts.filter(concept => concept.topicIds.includes(topic.id));
  const paragraphs = pageText.split(/\r?\n[\t ]*\r?\n+/).map(value => value.trim()).filter(Boolean);
  return paragraphs.find(paragraph => paragraph.length <= maxChars &&
    supportGeneralIrasRuleConcept({
      sourceText: paragraph,
      domainId: topic.domainId,
      topicIds: [topic.id],
      subject,
      population,
      concepts: conceptScope
    }) === true);
}

export function selectRelevantFetchedText(pageText: string, terms: string[], maxChars = 5_000, query = '', preferredPassages: string[] = []): string {
  const text = pageText.trim();
  if (text.length <= maxChars) return text;
  const completePageBlocks = new Set(text.split(/\r?\n[\t ]*\r?\n+/).map(block => block.trim()));
  const preferred = preferredPassages.find(passage => passage.trim().length > 0 && passage.trim().length <= maxChars &&
    completePageBlocks.has(passage.trim()))?.trim() || '';
  const prefixLength = preferred ? preferred.length + 2 : 0;
  const sentences: Array<{ text: string; paragraphIndex: number }> = [];
  let paragraphIndex = 0;
  for (const part of text.split(/((?<=[.!?])\s+|\n+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      if (/\n/.test(part)) paragraphIndex++;
      continue;
    }
    const sentence = part.trim();
    if (sentence) sentences.push({ text: sentence, paragraphIndex });
  }
  const normalizedTerms = terms.map(normalizeTopicTerm).filter(term => term.length > 2);
  const genericTerms = new Set(['the', 'and', 'for', 'can', 'with', 'from', 'what', 'which', 'under', 'this', 'that', 'are', 'our', 'claim', 'claimed', 'tax', 'gst', 'input', 'company', 'singapore']);
  const queryTerms = [...new Set(normalizeTopicTerm(query).split(/\s+/).filter(term => term.length >= 3 && !genericTerms.has(term)))];
  const matches = sentences
    .map(({ text: sentence, paragraphIndex }, index) => ({ sentence, paragraphIndex, index,
      topicMatches: normalizedTerms.reduce((score, term) => score + (containsTopicTerm(sentence, term) ? 1 : 0), 0),
      queryMatches: queryTerms.reduce((score, term) => score + (containsTopicTerm(sentence, term) ? 1 : 0), 0)
    }))
    .filter(item => item.topicMatches > 0 || item.queryMatches > 0)
    // Keep at least one exact topic phrase in the excerpt even when generic
    // query terms occur more often elsewhere on a long page.
    .sort((a, b) => b.topicMatches - a.topicMatches || b.queryMatches - a.queryMatches || a.index - b.index);
  if (matches.length === 0) return preferred;

  const chosen = new Map<number, { text: string; paragraphIndex: number }>();
  const renderChosen = (segments: Map<number, { text: string; paragraphIndex: number }>): string => {
    let output = '';
    let previousIndex: number | undefined;
    let previousParagraph: number | undefined;
    for (const [index, segment] of [...segments.entries()].sort((a, b) => a[0] - b[0])) {
      const separator = output
        ? index === previousIndex! + 1 && segment.paragraphIndex === previousParagraph ? ' ' : '\n\n'
        : '';
      output += `${separator}${segment.text}`;
      previousIndex = index;
      previousParagraph = segment.paragraphIndex;
    }
    return output;
  };

  for (const match of matches) {
    // Try the matched sentence first. Context is added only when it fits, so
    // high-volume surrounding prose cannot crowd a topic phrase out.
    const window = [match.index, match.index - 1, match.index + 1];
    for (const index of window) {
      const sentence = sentences[index];
      if (!sentence || chosen.has(index)) continue;
      const proposed = new Map(chosen);
      proposed.set(index, sentence);
      if (prefixLength + renderChosen(proposed).length <= maxChars) chosen.set(index, sentence);
    }
  }
  const relevant = renderChosen(chosen);
  return preferred ? `${preferred}${relevant ? `\n\n${relevant}` : ''}` : relevant;
}

function approvedHostsForTopic(topic: MappedCoverageTopic): string[] {
  if (topic.domainId === 'ACCOUNTING_SFRS') return [...APPROVED_ACCOUNTING_DISCOVERY_HOSTS];
  if (topic.domainId.startsWith('IRAS_')) return [...APPROVED_IRAS_DISCOVERY_HOSTS];
  if (topic.domainId.startsWith('CPF_')) return [...(getOfficialSourceDiscoveryProviderConfig('CPF')?.approvedHosts || [])];
  return [];
}

function discoveryHostsForTopic(topic: MappedCoverageTopic): string[] {
  const providerConfig = getOfficialSourceDiscoveryProviderConfig(topic.authorities[0]);
  if (providerConfig) return [...providerConfig.approvedHosts];
  return approvedHostsForTopic(topic);
}

function isApprovedDiscoveryCandidateUrl(candidateUrl: string, approvedHosts: readonly string[]): boolean {
  try {
    const parsed = new URL(candidateUrl);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && approvedHosts.includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function cloneOfficialSourceDiscoveryRequest(request: OfficialSourceDiscoveryRequest): OfficialSourceDiscoveryRequest {
  return {
    ...request,
    approvedHosts: [...request.approvedHosts],
    topicHints: request.topicHints ? [...request.topicHints] : undefined,
    expectedTitles: request.expectedTitles ? [...request.expectedTitles] : undefined,
    declaredSourceUrls: request.declaredSourceUrls ? [...request.declaredSourceUrls] : undefined,
    sitemapUrls: request.sitemapUrls ? [...request.sitemapUrls] : undefined,
    preferredHosts: request.preferredHosts ? [...request.preferredHosts] : undefined
  };
}

const UNRESOLVED_RELATIVE_HISTORICAL_PERIOD = /\b(?:last|previous|prior|preceding)[\s-]+(?:(?:calendar|financial|basis|tax|assessment)\s+)*(?:year|ya|period)\b|\b(?:year|ya|period)\s+before\s+last\b|\b(?:one|two|three|\d+)\s+years?\s+ago\b|\b(?:old(?:er)?|previous|former|superseded)\s+(?:(?:corporate|income|withholding|wht|tax|gst)\s+){0,3}rates?\b|\b(?:historical|historic)\s+(?:(?:corporate|income|withholding|wht|tax|gst)\s+){0,3}rates?\b|\bprior to (?:the )?(?:(?:ya|year of assessment)\s*)?20\d{2}\b/i;

/** Present-day statutory guidance cannot establish a prior period without reviewed validity dates. */
function hasVerifiedHistoricalStatutoryScope(
  topic: MappedCoverageTopic,
  pointer: SourceMapPointer | undefined,
  targetDate: string | undefined,
  targetIsHistorical: boolean,
  query: string
): boolean {
  if (!topic.domainId.startsWith('IRAS_') && !topic.domainId.startsWith('CPF_')) return true;
  if (isUndatedHistoricalStatutoryRequest(topic, query)) return false;
  if (!targetIsHistorical || !targetDate) return true;
  return Boolean(pointer?.validFrom && pointer.validTo && targetDate >= pointer.validFrom && targetDate <= pointer.validTo);
}

function isUndatedHistoricalStatutoryRequest(topic: MappedCoverageTopic, query: string): boolean {
  if (!UNRESOLVED_RELATIVE_HISTORICAL_PERIOD.test(query) &&
      !(topic.domainId.startsWith('CPF_') && /\b(?:historical|historic|old|previous|former|superseded)\s+(?:cpf\s+)?(?:contribution\s+|wage\s+)?(?:rates?|ceilings?|rules?)\b/i.test(query))) return false;
  // “Prior-year losses” identifies the vintage of a loss balance, not a
  // request for a superseded rule. Current carry-forward guidance may be
  // retrieved, while eligibility still waits on the YA and continuity facts.
  const lossCarryForwardTopic = topic.id === 'iras-cit-loss-carry-forward' || topic.id === 'iras-substantial-shareholding-test';
  const describesPriorYearLosses = /\b(?:prior|previous|preceding|last)[\s-]+(?:financial\s+|basis\s+|tax\s+)?(?:year|ya)\s+(?:trade\s+)?losses?\b|\b(?:trade\s+)?losses?\b[\s\S]{0,80}\b(?:from|of)\s+(?:the\s+)?(?:prior|previous|preceding|last)[\s-]+(?:financial\s+|basis\s+|tax\s+)?(?:year|ya)\b/i.test(query);
  return !(lossCarryForwardTopic && describesPriorYearLosses);
}

function makeLiveCandidateEvidence(
  topic: MappedCoverageTopic,
  pointer: SourceMapPointer | undefined,
  pageTitle: string,
  url: string,
  excerpt: string,
  contentHash: string | undefined,
  retrievedAt: string
): AuthoritativeSourceRecord {
  const currentDate = new Date().toISOString().slice(0, 10);
  const host = new URL(url).hostname.toLowerCase();
  const discoveredPublisher = host === 'ifrs.org' || host === 'www.ifrs.org'
    ? 'IFRS Foundation'
    : host === 'iras.gov.sg' || host === 'www.iras.gov.sg'
      ? 'Inland Revenue Authority of Singapore (IRAS)'
      : host === 'sso.agc.gov.sg'
        ? 'Singapore Statutes Online / AGC'
    : host === 'asc.acra.gov.sg'
      ? 'Accounting Standards Committee / ACRA'
      : host === 'acra.gov.sg' || host === 'www.acra.gov.sg'
        ? 'ACRA'
        : host === 'cpf.gov.sg' || host === 'www.cpf.gov.sg'
          ? 'Central Provident Fund Board (CPF Board)'
          : 'Official source';
  const record = {
    id: `LIVE_TOPIC_${topic.id}_${contentHash?.slice(0, 12) || Date.now()}`,
    authority: (pointer?.authority || topic.authorities[0] || 'ACRA') as StatutoryAuthority,
    // The final URL may belong to a different approved publisher than the
    // mapped pointer. Keep the framework authority in `authority`, and use the
    // final page publisher for names presented to the answer/citation paths.
    authorityName: discoveredPublisher,
    // A verified redirect can cross approved first-party hosts. Attribute the
    // citation to the publisher of the final fetched URL, never the original
    // source-map pointer's host.
    sourcePublisher: discoveredPublisher,
    legalOrStandardInstrument: pointer?.legalOrStandardInstrument || topic.actOrStandard || topic.title,
    documentTitle: pageTitle,
    standardOrActCode: pointer?.standardOrActCode || topic.actOrStandard || topic.title,
    paragraphOrSection: topic.paragraphHints?.[0] || topic.sectionHints?.[0] || topic.title,
    sourceText: excerpt,
    principleSummary: topic.shortDescription || topic.title,
    effectiveDate: pointer
      ? pointer.effectiveDate || pointer.validFrom
      : topic.effectiveFrom,
    validFrom: pointer ? pointer.validFrom : topic.effectiveFrom,
    validTo: pointer ? pointer.validTo : topic.effectiveTo,
    officialSourceUrl: url,
    domain: (pointer?.domain || topic.legacyDomains[0] || 'ACCOUNTING_SFRS') as QueryDomain,
    jurisdiction: 'Singapore',
    // A discovered record is associated only with topics whose own page and
    // excerpt checks passed. Registry keywords remain routing metadata.
    tags: [topic.id, ...(topic.mappedTopicIds || [])],
    sourceStatus: 'NEEDS_REVIEW' as const,
    sourceType: 'OFFICIAL_GUIDANCE' as const,
    evidenceTier: 'OFFICIAL_GUIDANCE' as const,
    isVerbatimText: false,
    lastVerifiedDate: currentDate,
    provenance: 'LIVE_EXTERNAL' as const,
    canonicalSourceUrl: url,
    sourceAuthority: host === 'sso.agc.gov.sg' ? 'AGC' : topic.domainId.startsWith('IRAS_') ? 'IRAS' : topic.domainId.startsWith('CPF_') ? 'CPF' : 'ACRA',
    retrievedAt,
    verificationMethod: 'LIVE_OFFICIAL_TOPIC_VERIFIED',
    extractionStatus: 'PARTIAL' as const,
    documentHash: contentHash,
    contentHash,
    lifecycleState: 'CANDIDATE' as const,
    recordRole: 'DISCOVERED_EVIDENCE' as const,
    groundingEligible: true,
    urlVerificationStatus: 'VERIFIED' as const,
    urlVerifiedDate: currentDate,
    sourceLocator: { heading: pageTitle, document: pageTitle, sourceType: 'HTML' as const }
  } as unknown as AuthoritativeSourceRecord;
  return record;
}

/**
 * Resolves partial/missing coverage through verified source-map pointers, then
 * optionally through a trusted official-domain discovery adapter. It never
 * registers or promotes fetched records: successful fetches remain CANDIDATE.
 */
export async function resolveMappedOfficialSourceFallback(
  topicIds: readonly string[],
  query: string,
  retriever: ISourceRetriever,
  options: MappedFallbackOptions = {}
): Promise<{ records: AuthoritativeSourceRecord[]; trace: SourceMapFallbackTrace; provisionalTopics: MappedCoverageTopic[] }> {
  const webRetriever = options.webRetriever || defaultControlledWebRetriever;
  const discoveryAdapter = options.discoveryAdapter || getDefaultDiscoveryAdapter(webRetriever, options.fetchOptions);
  const scopedTopicIds = options.evidenceScope
    ? topicIds.filter(id => options.evidenceScope!.topicIds.includes(id))
    : topicIds;
  const expectedSourceDomains = options.evidenceScope?.domain === 'IRAS_EMPLOYMENT_BENEFITS' ||
      options.evidenceScope?.domain === 'IRAS_EMPLOYER_REPORTING'
    ? new Set(['IRAS_EMPLOYER_TAX'])
    : options.evidenceScope?.domain && options.evidenceScope.domain.startsWith('IRAS_')
      ? new Set([options.evidenceScope.context.domainId])
      : undefined;
  const directTopics = getCoverageTopicsByIds(scopedTopicIds)
    .filter(topic => topicMatchesEvidenceScope(topic, options.evidenceScope))
    .filter(topic => !expectedSourceDomains || expectedSourceDomains.has(topic.domainId))
    .map(topic => topic as MappedCoverageTopic);
  const expandedTopics = new Map(directTopics.map(topic => [topic.id, topic]));
  for (const directTopic of directTopics) {
    for (const relatedId of directTopic.relatedTopicIds || []) {
      const related = getCoverageTopicsByIds([relatedId])[0] as MappedCoverageTopic | undefined;
      if (related && topicMatchesEvidenceScope(related, options.evidenceScope) && isRelatedTopicRelevant(related, query)) expandedTopics.set(related.id, related);
    }
  }
  if (!options.evidenceScope && isAssociateToSubsidiaryTransitionQuestion(query)) {
    // Cross-standard transition routing is deliberately gated on all three
    // signals: an associate/equity-accounted holding, a further acquisition,
    // and control/subsidiary wording. Resolve the IDs through the coverage
    // registry so source IDs remain explicit data, never URL-derived guesses.
    for (const transitionTopicId of [
      'sfrsi-associate-to-subsidiary',
      'sfrsi128-to-subsidiary',
      'sfrsi3-step-acquisition',
      'sfrsi10-acquisition-control-date'
    ]) {
      const transitionTopic = getCoverageTopicsByIds([transitionTopicId])[0] as MappedCoverageTopic | undefined;
      if (transitionTopic) expandedTopics.set(transitionTopic.id, transitionTopic);
    }
  }

  const referenceDate = options.referenceDate || TargetDateResolver.CURRENT_SYSTEM_DATE;
  const targetDateResolution = defaultTargetDateResolver.resolveTargetDate(query, referenceDate);
  const targetDate = targetDateResolution.targetDate;
  const currentSingaporeYear = referenceDate.slice(0, 4);
  const currentYearYaProxy = targetDateResolution.source === 'INFERRED' &&
    /\b(?:ya|year of assessment)\s*20\d{2}\b/i.test(targetDateResolution.rawMatchedText || '') &&
    targetDate?.slice(0, 4) === currentSingaporeYear;
  const targetIsHistorical = targetDateResolution.isHistorical === true && !currentYearYaProxy;
  const registeredIrasTopics = [...expandedTopics.values()].filter(topic => topic.domainId.startsWith('IRAS_'));
  const historicalIrasScopeRequested = targetIsHistorical || registeredIrasTopics.some(topic =>
    topic.status === 'HISTORICAL' || isUndatedHistoricalStatutoryRequest(topic, query)
  ) || (registeredIrasTopics.length === 0 && UNRESOLVED_RELATIVE_HISTORICAL_PERIOD.test(query));

  // Determine historical scope before constructing a provisional topic. An
  // unmatched historical question cannot use a query-only context to bypass
  // the period-vetted source-map requirement.
  const authorityFallbackPermitted = options.authorityLevelDiscovery === true &&
    !options.localEvidenceAdequate && !historicalIrasScopeRequested;
  const topicsRequiringFallback = [...expandedTopics.values()].filter(topic => topic.status !== 'HISTORICAL');
  const semanticIrasContext = options.evidenceScope ? {
    domainId: options.evidenceScope.context.domainId,
    population: options.evidenceScope.context.population,
    primarySubject: options.evidenceScope.context.primarySubject,
    concepts: options.evidenceScope.context.concepts,
    requestedConcepts: options.evidenceScope.requestedConcepts,
    mappedTopicIds: options.evidenceScope.topicIds,
    requestedOperation: options.evidenceScope.context.requestedOperation
  } : getSemanticIrasDiscoveryContext(options.questionUnderstanding, query);
  const scopedEvidenceRuleInput = {
    ...(options.evidenceScope?.context.primarySubject.trim()
      ? { scopedSubject: options.evidenceScope.context.primarySubject }
      : semanticIrasContext?.primarySubject?.trim() ? { scopedSubject: semanticIrasContext.primarySubject } : {}),
    ...(options.evidenceScope?.context.population
      ? { scopedPopulation: options.evidenceScope.context.population }
      : semanticIrasContext?.population ? { scopedPopulation: semanticIrasContext.population } : {})
  };
  const requestedConcepts = options.evidenceScope?.requestedConcepts ||
    semanticIrasContext?.requestedConcepts || getRequestedQuestionConcepts(query, options.questionUnderstanding);
  const authorityDiscoveryTopics = authorityFallbackPermitted
    ? provisionalIrasConceptTopics(query, semanticIrasContext, requestedConcepts)
    : [];
  const provisionalTopics: MappedCoverageTopic[] = [...authorityDiscoveryTopics];

  if (topicsRequiringFallback.length === 0 && authorityDiscoveryTopics.length === 0) {
    const historicalBlocked = options.authorityLevelDiscovery === true && !options.localEvidenceAdequate && historicalIrasScopeRequested;
    if (historicalBlocked) {
      return { records: [], provisionalTopics: [], trace: {
        path: 'NO_VERIFIED_MAP', sourceMapIds: [], selectedRecordIds: [], finalVerifiedUrls: [], candidateOnly: false,
        attempts: [{ topicId: 'iras-authority-query-historical-unresolved', fetchStatus: 'HISTORICAL_SCOPE_UNVERIFIED', titleMatched: false, contentMatched: false,
          error: 'No registered topic or period-vetted source-map pointer establishes the requested historical IRAS scope; live discovery is not permitted.' }],
        stages: [
          { stage: 'LOCAL_VERIFIED', status: 'EXHAUSTED', reason: 'Local reviewed evidence was insufficient for this unmatched historical request.' },
          { stage: 'MAPPED_SOURCE', status: 'SKIPPED', reason: 'No matched topic provides an applicable period-vetted source-map pointer.' },
          { stage: 'SITEMAP_DISCOVERY', status: 'SKIPPED', reason: 'Sitemap discovery cannot establish historical scope without a vetted period-specific pointer.' },
          { stage: 'OFFICIAL_DOMAIN_SEARCH', status: 'SKIPPED', reason: 'Online discovery cannot establish historical scope without a vetted period-specific pointer.' },
          { stage: 'INSUFFICIENT', status: 'EXHAUSTED', reason: 'Permitted historical IRAS evidence routes were exhausted without an applicable vetted source.' }
        ]
      } };
    }
    return { records: [], provisionalTopics, trace: { path: 'NOT_NEEDED', sourceMapIds: [], selectedRecordIds: [], finalVerifiedUrls: [], candidateOnly: false, attempts: [], stages: [
      { stage: 'LOCAL_VERIFIED', status: options.localEvidenceAdequate ? 'SUFFICIENT' : 'SKIPPED', reason: options.localEvidenceAdequate ? 'Reviewed local evidence covers the matched topics.' : 'No fallback was requested for a routed topic.' },
      { stage: 'MAPPED_SOURCE', status: 'SKIPPED', reason: 'A source-map fetch was not needed.' },
      { stage: 'SITEMAP_DISCOVERY', status: 'SKIPPED', reason: 'Sitemap discovery was not needed.' },
      { stage: 'OFFICIAL_DOMAIN_SEARCH', status: 'SKIPPED', reason: 'Official-domain search was not needed.' }
    ] } };
  }

  const records: AuthoritativeSourceRecord[] = [];
  const attempts: SourceMapFallbackAttempt[] = [];
  const discoveryFetchAttempts: NonNullable<SourceMapFallbackTrace['discoveryFetchAttempts']> = [];
  const coverageDecisions: NonNullable<SourceMapFallbackTrace['coverageDecisions']> = [];
  const sourceMapIds = new Set<string>();
  const finalVerifiedUrls = new Set<string>();
  const discoveredEvidenceIds = new Set<string>();
  const sitemapLinkedCandidates = new Map<string, LinkedOfficialCandidate[]>();
  const successfulPageFetches = new Map<string, Awaited<ReturnType<ControlledWebRetriever['fetchOfficialSource']>>>();
  let mappedStageAttempted = false;
  let sitemapStageAttempted = false;
  let onlineSearchStageAttempted = false;

  const tryFetch = async (
    topic: MappedCoverageTopic,
    candidateUrl: string,
    pointer?: SourceMapPointer,
    discoveryStage: SourceMapFallbackAttempt['discoveryStage'] = 'SITEMAP_DISCOVERY',
    discoveredPageTitle?: string,
    discoverySourceUrl?: string
  ): Promise<AuthoritativeSourceRecord | undefined> => {
    const irasDiscovery = topic.domainId.startsWith('IRAS_') && !pointer;
    const cpfDiscovery = topic.domainId.startsWith('CPF_') && !pointer;
    const focusedStatutoryTitles = irasDiscovery || cpfDiscovery
      ? [topic.title, ...(topic.aliases || []), ...topic.keywords, ...(cpfDiscovery ? CPF_DISCOVERY_TITLE_HINTS[topic.id] || [] : [])]
        .filter(value => normalizeEvidenceText(value).split(' ').filter(Boolean).length >= 2)
      : [];
    const expectation = {
      standardIdentifiers: [...getTopicStandardIdentifiers(topic, pointer), ...(irasDiscovery ? ['IRAS', 'Singapore Statutes Online'] : cpfDiscovery ? ['CPF', 'Central Provident Fund'] : [])],
      expectedTitles: [pointer?.documentTitle, topic.pageTitle, ...(topic.actOrStandard || '').split(';').map(s => s.trim()), ...focusedStatutoryTitles,
        discoveredPageTitle, ...candidateTitlePhrases(discoveredPageTitle)]
        .filter((value): value is string => Boolean(value)),
      topicTerms: getTopicContentTerms(topic),
      minimumTopicTermMatches: (topic.id.startsWith('iras-authority-query-') && !topic.requestedConcepts?.length) ||
        topic.id === 'iras-individual-foreign-tax-credit' ? 2 : 1,
      allowIrasTopicTokenEquivalence: topic.domainId.startsWith('IRAS_')
    };
    let result = successfulPageFetches.get(candidateUrl);
    if (!result) {
      result = await webRetriever.fetchOfficialSource(candidateUrl, {
        ...options.fetchOptions,
        topicValidation: expectation
      });
      if (result.status === 'SUCCESS' && result.content) successfulPageFetches.set(candidateUrl, result);
    }
    const attempt: SourceMapFallbackAttempt = {
      topicId: topic.id,
      sourceMapId: pointer?.id,
      candidateUrl,
      discoverySourceUrl,
      fetchStatus: result.status,
      finalUrl: result.finalUrl,
      pageTitle: result.pageTitle,
      titleMatched: result.titleMatched === true,
      contentMatched: result.contentMatched === true,
      discoveryStage: pointer ? 'MAPPED_SOURCE' : discoveryStage,
      error: result.error
    };
    attempts.push(attempt);
    if (discoveryStage === 'SITEMAP_DISCOVERY' && !pointer && result.finalUrl && result.discoveredLinks?.length) {
      const linked = rankRelevantOfficialPageLinks(result.discoveredLinks, result.finalUrl, topic, query, approvedHostsForTopic(topic));
      if (linked.length > 0) sitemapLinkedCandidates.set(`${topic.id}|${candidateUrl}`, linked);
    }
    let finalHost = '';
    try { finalHost = new URL(result.finalUrl || '').hostname.toLowerCase(); } catch { /* rejected below */ }
    if (result.status !== 'SUCCESS' || !result.content || !result.finalUrl || !result.topicMatched ||
        !isApprovedSingaporeSourceUrl(result.finalUrl) || !approvedHostsForTopic(topic).includes(finalHost)) return undefined;

    // Recheck the raw HTML at this boundary as well as in ControlledWebRetriever.
    // Injected adapters and cached/custom retrievers must not make navigation
    // labels or a generic shell sufficient topic evidence.
    const contentValidation = defaultExternalSourceValidator.validateTopicContent(result.content, expectation);
    if (!contentValidation.isValid) {
      attempt.fetchStatus = 'TOPIC_MISMATCH';
      attempt.titleMatched = false;
      attempt.contentMatched = false;
      attempt.error = contentValidation.reason || 'Fetched page lacks visible topic-specific body content.';
      return undefined;
    }

    const domainMismatch = topic.domainId.startsWith('IRAS_')
      ? irasCandidateDomainMismatch(query, topic, result.finalUrl)
      : undefined;
    if (domainMismatch) {
      attempt.fetchStatus = 'DOMAIN_MISMATCH';
      attempt.titleMatched = false;
      attempt.contentMatched = false;
      attempt.error = domainMismatch;
      return undefined;
    }
    if (topic.domainId.startsWith('IRAS_') && !candidateMatchesIrasPopulation(query, topic, result.pageTitle || '', contentValidation.substantiveText || '', result.finalUrl)) {
      attempt.fetchStatus = 'POPULATION_MISMATCH';
      attempt.titleMatched = false;
      attempt.contentMatched = false;
      attempt.error = 'Fetched IRAS guidance addresses a different taxpayer or recipient population than the query.';
      return undefined;
    }

    const requiredContentTerms = topic.requiredContentTerms || [];
    const scopedSubject = options.evidenceScope?.context.primarySubject || semanticIrasContext?.primarySubject;
    const scopedPopulation = options.evidenceScope?.context.population || semanticIrasContext?.population;
    const preferredRulePassage = completeScopedRulePassage(
      contentValidation.substantiveText || '', topic, scopedSubject, scopedPopulation, requestedConcepts, 5_000
    );
    const excerpt = selectRelevantFetchedText(contentValidation.substantiveText || '',
      [...expectation.topicTerms, ...requiredContentTerms], 5_000, query,
      preferredRulePassage ? [preferredRulePassage] : []);
    const requiredContentPresent = containsRequiredContentTermsInOneBlock(contentValidation.substantiveText || '', requiredContentTerms) &&
      containsRequiredContentTermsInOneBlock(excerpt, requiredContentTerms);
    const excerptTopicMatches = expectation.topicTerms.filter(term => matchesTopicContentTerm(
      excerpt,
      term,
      expectation.allowIrasTopicTokenEquivalence === true
    )).length;
    if (!excerpt || excerptTopicMatches < (expectation.minimumTopicTermMatches ?? 1) || !requiredContentPresent) {
      attempt.fetchStatus = 'TOPIC_MISMATCH';
      attempt.contentMatched = false;
      attempt.error = requiredContentPresent
        ? 'Validated page did not yield a relevant topic section for grounding.'
        : 'Fetched page does not contain all required topic-specific section phrases for grounding.';
      return undefined;
    }
    const fetchedRecord = makeLiveCandidateEvidence(topic, pointer, result.pageTitle || pointer?.documentTitle || topic.title, result.finalUrl, excerpt, result.contentHash, result.retrievedAt);
    const isTransientTopic = (topicId: string): boolean => topicId.startsWith('iras-authority-query-');
    const canMergeAcrossTopicScopes = isTransientTopic(topic.id);
    const existingRecordIndex = records.findIndex(existing => existing.canonicalSourceUrl === fetchedRecord.canonicalSourceUrl &&
      existing.contentHash === fetchedRecord.contentHash &&
      // A single official page may serve multiple transient concept queries;
      // keep their validated associations on one record. Registered topics
      // retain separate records so each topic's source-map trace stays intact.
      (canMergeAcrossTopicScopes || (existing.tags || []).some(isTransientTopic)));
    let record = fetchedRecord;
    if (existingRecordIndex >= 0) {
      const existing = records[existingRecordIndex];
      record = {
        ...existing,
        sourceText: [...new Set([existing.sourceText, fetchedRecord.sourceText].filter(Boolean))].join('\n\n'),
        tags: [...new Set([...(existing.tags || []), ...(fetchedRecord.tags || [])])]
      };
      records[existingRecordIndex] = record;
    } else {
      records.push(record);
    }
    if (!pointer) discoveredEvidenceIds.add(record.id);
    finalVerifiedUrls.add(result.finalUrl);
    return record;
  };

  const topicWork = topicsRequiringFallback.map(topic => {
    const pointers = [...new Set(topic.sourceRecordIds)]
      .map(id => retriever.getSourceById(id) as SourceMapPointer | undefined)
      .filter((record): record is SourceMapPointer => Boolean(
        record && record.recordRole === 'SOURCE_MAP_POINTER' && record.groundingEligible === false &&
        record.lifecycleState === 'ACTIVE' && record.urlVerificationStatus === 'VERIFIED' &&
        hasVerifiedSourceUrlProvenance(record) &&
        record.sourceMapTopicIds?.includes(topic.id) &&
        isSourceMapRelevantToQuery(record, query) &&
        // A framework overview can route framework-level questions only. It
        // cannot be used as a substitute for one of this registry's narrow
        // mapped standard topics.
        record.sourceMapScope !== 'FRAMEWORK'
      ));
    const historicalStatutoryQuery = (topic.domainId.startsWith('IRAS_') || topic.domainId.startsWith('CPF_')) && Boolean(
      isUndatedHistoricalStatutoryRequest(topic, query) ||
      targetIsHistorical
    );
    const applicablePointers = pointers.filter(pointer => hasVerifiedHistoricalStatutoryScope(topic, pointer, targetDate, targetIsHistorical, query));
    return { topic, pointers, applicablePointers, historicalStatutoryQuery };
  });

  const currentTrace = (): SourceMapFallbackTrace => ({
    path: records.length ? (discoveredEvidenceIds.size ? 'DISCOVERED_SOURCE' : 'MAPPED_SOURCE') : sourceMapIds.size ? 'MAPPED_SOURCE_REJECTED' : 'NO_VERIFIED_MAP',
    sourceMapIds: [...sourceMapIds],
    selectedRecordIds: records.map(record => record.id),
    finalVerifiedUrls: [...finalVerifiedUrls],
    candidateOnly: records.length > 0,
    attempts,
    discoveryFetchAttempts,
    coverageDecisions
  });
  const captureCoverageDecision = (
    scope: 'TOPIC' | 'REGISTERED',
    targetTopics: readonly MappedCoverageTopic[],
    admissionTopics: readonly MappedCoverageTopic[],
    assessment: EvidenceQualityAssessment
  ): void => {
    coverageDecisions.push({
      scope,
      targetTopicIds: targetTopics.map(topic => topic.id).slice(0, 20),
      admissionTopicIds: admissionTopics.map(topic => topic.id).slice(0, 20),
      eligibleRecordIds: assessment.eligibleRecords.map(record => record.id).slice(0, 20),
      rejectedRecords: assessment.rejectedRecords.slice(0, 12).map(rejection => ({
        recordId: rejection.recordId,
        code: rejection.code,
        reason: rejection.reason.slice(0, 240)
      })),
      uncoveredTopicIds: assessment.uncoveredTopicIds.slice(0, 20),
      uncoveredConcepts: (assessment.uncoveredConcepts || []).slice(0, 20)
    });
    if (coverageDecisions.length > 24) coverageDecisions.shift();
  };
  const hasAdequateCoverage = (topics: readonly MappedCoverageTopic[]): boolean => {
    if (topics.length === 0) return false;
    const registeredTopics = topics.filter(topic => !topic.id.startsWith('iras-authority-query-'));
    const provisional = topics.filter(topic => topic.id.startsWith('iras-authority-query-'));
    const irasTopics = registeredTopics.filter(topic => topic.domainId.startsWith('IRAS_'));
    const nonIrasTopics = registeredTopics.filter(topic => !topic.domainId.startsWith('IRAS_'));
    const nonIrasCovered = nonIrasTopics.every(topic => records.some(record => record.tags.includes(topic.id) &&
        attempts.some(attempt => attempt.topicId === topic.id && attempt.fetchStatus === 'SUCCESS' &&
          attempt.titleMatched && attempt.contentMatched && attempt.finalUrl === record.canonicalSourceUrl)));
    if (!nonIrasCovered) return false;
    if (irasTopics.length === 0 && provisional.length === 0) return registeredTopics.length > 0;
    // A concept-only provisional target can be supported by a fetched record
    // admitted through its registered topic in the same already-routed IRAS
    // domain. Include those registered topics for evidence admission, while
    // retaining `topics` as the only requested target for this decision.
    const provisionalAdmissionTopics = provisional.length > 0
      ? topicsRequiringFallback.filter(topic => topic.domainId === provisional[0].domainId && topic.domainId.startsWith('IRAS_'))
      : [];
    const admissionTopics = [...new Map([...irasTopics, ...provisionalAdmissionTopics].map(topic => [topic.id, topic])).values()];
    const assessment = evaluateEvidenceQuality({
      query,
      topicIds: admissionTopics.map(topic => topic.id),
      provisionalTopics: provisional,
      records,
      missingFacts: [],
      requestedConcepts,
      ...scopedEvidenceRuleInput,
      authorities: ['IRAS'],
      referenceDate: options.referenceDate || TargetDateResolver.CURRENT_SYSTEM_DATE,
      sourceMapFallbackTrace: currentTrace()
    });
    captureCoverageDecision('TOPIC', topics, admissionTopics, assessment);
    const requestedTargetsCovered = topics.every(topic =>
      !topic.domainId.startsWith('IRAS_') || assessment.coveredTopicIds.includes(topic.id)
    );
    return requestedTargetsCovered && assessment.eligibleRecords.length > 0;
  };
  const topicCovered = (topic: MappedCoverageTopic): boolean => hasAdequateCoverage([topic]);
  const registeredCoverageAssessment = (): EvidenceQualityAssessment => {
    const registeredTopics = topicsRequiringFallback.filter(topic => topic.domainId.startsWith('IRAS_'));
    const assessment = evaluateEvidenceQuality({
      query,
      topicIds: registeredTopics.map(topic => topic.id),
      provisionalTopics,
      records,
      missingFacts: [],
      requestedConcepts,
      ...scopedEvidenceRuleInput,
      authorities: ['IRAS'],
      referenceDate: options.referenceDate || TargetDateResolver.CURRENT_SYSTEM_DATE,
      sourceMapFallbackTrace: currentTrace()
    });
    captureCoverageDecision('REGISTERED', [...registeredTopics, ...provisionalTopics], registeredTopics, assessment);
    return assessment;
  };
  const unresolvedRegisteredTopics = (): MappedCoverageTopic[] => {
    const uncovered = new Set(registeredCoverageAssessment().uncoveredTopicIds);
    return topicsRequiringFallback.filter(topic => topic.domainId.startsWith('IRAS_')
      ? uncovered.has(topic.id)
      : !hasAdequateCoverage([topic]));
  };
  const registeredCoverageAdequate = (): boolean => topicsRequiringFallback.length === 0 ||
    unresolvedRegisteredTopics().length === 0;
  const provisionalCoverageAdequate = (): boolean => provisionalTopics.length === 0 ||
    provisionalTopics.every(topic => topicCovered(topic));
  const allRequiredCoverageAdequate = (): boolean => registeredCoverageAdequate() && provisionalCoverageAdequate();

  // Stage 1: try every applicable reviewed map before beginning any discovery.
  for (const { topic, applicablePointers, historicalStatutoryQuery } of topicWork) {
    mappedStageAttempted ||= applicablePointers.length > 0;
    if (historicalStatutoryQuery && applicablePointers.length === 0) {
      attempts.push({ topicId: topic.id, fetchStatus: 'HISTORICAL_SCOPE_UNVERIFIED', titleMatched: false, contentMatched: false,
        error: 'No reviewed source-map pointer validity window covers the requested historical statutory period.' });
      continue;
    }
    for (const pointer of applicablePointers) {
      sourceMapIds.add(pointer.id);
      if (!isApprovedSingaporeSourceUrl(pointer.officialSourceUrl)) {
        attempts.push({ topicId: topic.id, sourceMapId: pointer.id, fetchStatus: 'UNAUTHORIZED_DOMAIN_ACCESS', titleMatched: false, contentMatched: false, error: 'Mapped URL is outside approved official sources.' });
        continue;
      }
      await tryFetch(topic, pointer.officialSourceUrl, pointer, 'MAPPED_SOURCE');
    }
  }
  const mappedCoverageAdequate = topicsRequiringFallback.length > 0 && registeredCoverageAdequate();

  const sitemapTopics = (): MappedCoverageTopic[] =>
    !registeredCoverageAdequate() ? unresolvedRegisteredTopics() : [];
  const discoverSitemapForTopic = async (topic: MappedCoverageTopic, isAuthorityQuery: boolean): Promise<void> => {
    const work = topicWork.find(item => item.topic.id === topic.id);
    // Discovered pages have no reviewed period-specific validity metadata.
    if (work?.historicalStatutoryQuery) return;
    const approvedHosts = discoveryHostsForTopic(topic);
    if (approvedHosts.length === 0) return;
    const expectedPointers = work?.pointers || [];
    const declaredSourceUrls = expectedPointers.map(pointer => pointer.officialSourceUrl)
      .filter((url): url is string => Boolean(url));
    const providerConfig = getOfficialSourceDiscoveryProviderConfig(topic.authorities[0]);
    const discoveryRequest: OfficialSourceDiscoveryRequest = {
      query: options.semanticDiscoveryQuery || query,
      scopeQuery: query,
      authority: topic.authorities[0],
      topicId: topic.id,
      topicDomainId: topic.domainId,
      topicTitle: topic.title,
      standardOrAct: topic.actOrStandard || topic.title,
      approvedHosts,
      topicHints: getTopicDiscoveryHints(topic),
      expectedTitles: expectedPointers.map(pointer => pointer.documentTitle),
      declaredSourceUrls,
      sitemapUrls: providerConfig?.sitemapUrls,
      preferredHosts: providerConfig?.preferredHosts,
      searchSite: providerConfig?.searchSite,
      searchEndpoint: providerConfig?.searchEndpoint,
      searchRedirectHost: providerConfig?.searchRedirectHost,
      searchRedirectParameter: providerConfig?.searchRedirectParameter,
      lexicalDiscovery: providerConfig?.lexicalDiscovery,
      authorityLevelFallback: isAuthorityQuery,
      maxCandidates: 4
    };
    let discoveredCandidates: string[] = [];
    try {
      sitemapStageAttempted = true;
      discoveredCandidates = await discoveryAdapter.discoverOfficialSourceCandidates(
        cloneOfficialSourceDiscoveryRequest(discoveryRequest)
      );
    } catch {
      // First-party discovery is optional and fail-closed. Mapped retrieval
      // results already collected remain available if the sitemap is down.
      discoveredCandidates = [];
    }
    for (const candidateUrl of discoveredCandidates) {
      if (!isApprovedDiscoveryCandidateUrl(candidateUrl, approvedHosts)) {
        attempts.push({ topicId: topic.id, candidateUrl, fetchStatus: 'UNAUTHORIZED_DOMAIN_ACCESS', titleMatched: false, contentMatched: false,
          discoveryStage: 'SITEMAP_DISCOVERY', error: 'Discovery candidate was not an HTTPS URL on an approved authority hostname.' });
      } else if (!isIrasSourceUrlAreaCompatible(topic.domainId, candidateUrl, declaredSourceUrls, query)) {
        attempts.push({ topicId: topic.id, candidateUrl, fetchStatus: 'DOMAIN_MISMATCH', titleMatched: false, contentMatched: false,
          discoveryStage: 'SITEMAP_DISCOVERY', error: 'Discovered IRAS URL tax area conflicts with the requested topic domain.' });
      } else if (!isOfficialSourceCandidateMateriallyRelevant(candidateUrl, discoveryRequest, discoveryAdapter.getCandidateTitle?.(candidateUrl))) {
        attempts.push({ topicId: topic.id, candidateUrl, fetchStatus: 'METADATA_IRRELEVANT', titleMatched: false, contentMatched: false,
          discoveryStage: 'SITEMAP_DISCOVERY', error: 'Candidate URL metadata does not materially match the requested topic.' });
      }
    }
    discoveredCandidates = discoveredCandidates.filter(candidateUrl =>
      isApprovedDiscoveryCandidateUrl(candidateUrl, approvedHosts) &&
      isIrasSourceUrlAreaCompatible(topic.domainId, candidateUrl, declaredSourceUrls, query) &&
      isOfficialSourceCandidateMateriallyRelevant(candidateUrl, discoveryRequest, discoveryAdapter.getCandidateTitle?.(candidateUrl))
    );
    for (const fetchAttempt of discoveryAdapter.getLastFetchTrace?.() || []) {
      discoveryFetchAttempts.push({
        topicId: fetchAttempt.topicId || topic.id,
        fetchStatus: fetchAttempt.status
      });
    }
    const candidateQueue: Array<LinkedOfficialCandidate & { depth: number }> = discoveredCandidates.slice(0, 4)
      .map(url => ({ url, title: discoveryAdapter.getCandidateTitle?.(url), discoverySourceUrl: '', depth: 0 }));
    const queuedUrls = new Set(candidateQueue.map(candidate => candidate.url));
    let linkedCandidateFetches = 0;
    let candidateFetches = 0;
    while (candidateQueue.length > 0 && candidateFetches < 12) {
      const candidate = candidateQueue.shift()!;
      const candidateUrl = candidate.url;
      let host = '';
      let protocol = '';
      try { const parsed = new URL(candidateUrl); host = parsed.hostname.toLowerCase(); protocol = parsed.protocol; } catch { /* reject below */ }
      if (protocol !== 'https:' || !approvedHosts.includes(host as typeof approvedHosts[number])) {
        attempts.push({ topicId: topic.id, fetchStatus: 'UNAUTHORIZED_DOMAIN_ACCESS', titleMatched: false, contentMatched: false, error: 'Discovery candidate was not from the restricted official-domain set.' });
        continue;
      }
      candidateFetches++;
      const candidateRecord = await tryFetch(topic, candidateUrl, undefined, 'SITEMAP_DISCOVERY', candidate.title, candidate.discoverySourceUrl || undefined);
      // Stop as soon as this independently fetched page satisfies the routed
      // evidence scope. Related links are discovery aids, not a reason to
      // continue fetching after the request is already adequately covered.
      if (candidateRecord && topicCovered(topic)) break;
      // This is one bounded parent-to-leaf expansion. A fetched child that
      // supplies adequate topical evidence ends this route without crawling
      // that leaf's own related-content links.
      const children = candidate.depth >= 1 || linkedCandidateFetches >= 8
        ? []
        : sitemapLinkedCandidates.get(`${topic.id}|${candidateUrl}`) || [];
      for (const child of children) {
        if (linkedCandidateFetches >= 8 || queuedUrls.has(child.url)) continue;
        queuedUrls.add(child.url);
        candidateQueue.unshift({ ...child, depth: candidate.depth + 1 });
        linkedCandidateFetches++;
      }
      // A fetched index page that lacks adequate content has already queued
      // its bounded explicit first-party leaves above.
    }
  };

  // Stage 2: discover from official indexes for each topic that remains
  // uncovered after the complete mapped-source pass.
  for (const topic of sitemapTopics()) await discoverSitemapForTopic(topic, false);

  // Each unresolved material concept receives its own official discovery
  // scope, even when a registered topic such as the relief cap already matched.
  for (const topic of provisionalTopics.filter(candidate => !topicCovered(candidate))) {
    await discoverSitemapForTopic(topic, true);
  }
  const sitemapCoverageAdequate = allRequiredCoverageAdequate();

  const discoverOnlineForTopic = async (topic: MappedCoverageTopic, isAuthorityQuery: boolean): Promise<void> => {
    const work = topicWork.find(item => item.topic.id === topic.id);
    if (work?.historicalStatutoryQuery || topicCovered(topic)) return;
    const approvedHosts = discoveryHostsForTopic(topic);
    const providerConfig = getOfficialSourceDiscoveryProviderConfig(topic.authorities[0]);
    if (!providerConfig?.searchSite || !approvedHosts.includes(providerConfig.searchSite)) return;
    const expectedPointers = work?.pointers || [];
    const declaredSourceUrls = expectedPointers.map(pointer => pointer.officialSourceUrl)
      .filter((url): url is string => Boolean(url));
    const officialDomainSearchAdapter = options.officialDomainSearchAdapter || getDefaultOfficialDomainSearchAdapter(webRetriever, options.fetchOptions);
    const searchRequest: OfficialSourceDiscoveryRequest = {
      query: options.semanticDiscoveryQuery || query,
      scopeQuery: query,
      authority: topic.authorities[0],
      topicId: topic.id,
      topicDomainId: topic.domainId,
      topicTitle: topic.title,
      standardOrAct: topic.actOrStandard || topic.title,
      approvedHosts,
      topicHints: getTopicDiscoveryHints(topic),
      expectedTitles: expectedPointers.map(pointer => pointer.documentTitle),
      declaredSourceUrls,
      searchSite: providerConfig.searchSite,
      searchEndpoint: providerConfig.searchEndpoint,
      searchRedirectHost: providerConfig.searchRedirectHost,
      searchRedirectParameter: providerConfig.searchRedirectParameter,
      lexicalDiscovery: providerConfig.lexicalDiscovery,
      authorityLevelFallback: isAuthorityQuery,
      maxCandidates: 4
    };
    let searchCandidates: string[] = [];
    try {
      onlineSearchStageAttempted = true;
      searchCandidates = await officialDomainSearchAdapter.searchOfficialDomainCandidates(
        cloneOfficialSourceDiscoveryRequest(searchRequest)
      );
    } catch {
      searchCandidates = [];
    }
    for (const searchTrace of officialDomainSearchAdapter.getLastSearchTrace?.() || []) {
      if (searchTrace.status === 'NO_CANDIDATES') {
        attempts.push({ topicId: topic.id, fetchStatus: 'NO_CANDIDATES', titleMatched: false, contentMatched: false,
          discoveryStage: 'OFFICIAL_DOMAIN_SEARCH', searchQueryVariant: searchTrace.variant,
          error: searchTrace.reason || 'The restricted query variant produced no approved official URL candidates.' });
      }
    }
    for (const candidateUrl of searchCandidates) {
      if (!isApprovedDiscoveryCandidateUrl(candidateUrl, approvedHosts)) {
        attempts.push({ topicId: topic.id, candidateUrl, fetchStatus: 'UNAUTHORIZED_DOMAIN_ACCESS', titleMatched: false, contentMatched: false,
          discoveryStage: 'OFFICIAL_DOMAIN_SEARCH', searchQueryVariant: officialDomainSearchAdapter.getCandidateQueryVariant?.(candidateUrl),
          error: 'Online search candidate was not an HTTPS URL on an approved authority hostname.' });
      } else if (!isIrasSourceUrlAreaCompatible(topic.domainId, candidateUrl, declaredSourceUrls, query)) {
        attempts.push({ topicId: topic.id, candidateUrl, fetchStatus: 'DOMAIN_MISMATCH', titleMatched: false, contentMatched: false,
          discoveryStage: 'OFFICIAL_DOMAIN_SEARCH', searchQueryVariant: officialDomainSearchAdapter.getCandidateQueryVariant?.(candidateUrl),
          error: 'Discovered IRAS URL tax area conflicts with the requested topic domain.' });
      } else if (!isOfficialSourceCandidateMateriallyRelevant(candidateUrl, searchRequest, officialDomainSearchAdapter.getCandidateTitle?.(candidateUrl))) {
        attempts.push({ topicId: topic.id, candidateUrl, fetchStatus: 'METADATA_IRRELEVANT', titleMatched: false, contentMatched: false,
          discoveryStage: 'OFFICIAL_DOMAIN_SEARCH', searchQueryVariant: officialDomainSearchAdapter.getCandidateQueryVariant?.(candidateUrl),
          error: 'Candidate URL metadata does not materially match the requested topic.' });
      }
    }
    for (const candidateUrl of searchCandidates.filter(candidateUrl =>
      isApprovedDiscoveryCandidateUrl(candidateUrl, approvedHosts) &&
      isIrasSourceUrlAreaCompatible(topic.domainId, candidateUrl, declaredSourceUrls, query) &&
      isOfficialSourceCandidateMateriallyRelevant(candidateUrl, searchRequest, officialDomainSearchAdapter.getCandidateTitle?.(candidateUrl))
    ).slice(0, 4)) {
      let host = '';
      let protocol = '';
      try {
        const parsed = new URL(candidateUrl);
        host = parsed.hostname.toLowerCase();
        protocol = parsed.protocol;
      } catch { /* reject below */ }
      if (protocol !== 'https:' || !approvedHosts.includes(host as typeof approvedHosts[number])) {
        attempts.push({ topicId: topic.id, fetchStatus: 'UNAUTHORIZED_DOMAIN_ACCESS', titleMatched: false, contentMatched: false,
          discoveryStage: 'OFFICIAL_DOMAIN_SEARCH', searchQueryVariant: officialDomainSearchAdapter.getCandidateQueryVariant?.(candidateUrl),
          error: 'Online search candidate was not an HTTPS URL on an approved authority hostname.' });
        continue;
      }
      const candidateRecord = await tryFetch(topic, candidateUrl, undefined, 'OFFICIAL_DOMAIN_SEARCH', officialDomainSearchAdapter.getCandidateTitle?.(candidateUrl));
      const candidateAttempt = attempts[attempts.length - 1];
      if (candidateAttempt?.candidateUrl === candidateUrl && candidateAttempt.discoveryStage === 'OFFICIAL_DOMAIN_SEARCH') {
        candidateAttempt.searchQueryVariant = officialDomainSearchAdapter.getCandidateQueryVariant?.(candidateUrl);
      }
      if (candidateRecord && topicCovered(topic)) break;
    }
  };

  // Stage 3 is reached only after all applicable sitemap candidates have been
  // attempted and at least one required scope remains uncovered.
  if (!allRequiredCoverageAdequate()) {
    const unresolved = [
      ...(!registeredCoverageAdequate() ? unresolvedRegisteredTopics() : []),
      ...provisionalTopics.filter(topic => !topicCovered(topic))
    ];
    for (const topic of unresolved) await discoverOnlineForTopic(topic, topic.id.startsWith('iras-authority-query-'));
  }

  const anyMappedAttempt = sourceMapIds.size > 0;
  const path: SourceMapFallbackTrace['path'] = records.length > 0
    ? (discoveredEvidenceIds.size > 0 ? 'DISCOVERED_SOURCE' : 'MAPPED_SOURCE')
    : anyMappedAttempt
      ? 'MAPPED_SOURCE_REJECTED'
      : 'NO_VERIFIED_MAP';
  const finalCoverageAdequate = allRequiredCoverageAdequate();
  const stages: NonNullable<SourceMapFallbackTrace['stages']> = [
    { stage: 'LOCAL_VERIFIED', status: options.localEvidenceAdequate ? 'SUFFICIENT' : 'EXHAUSTED', reason: options.localEvidenceAdequate ? 'Reviewed local evidence covered the routed request; live discovery was not needed.' : 'Local retrieval was insufficient for at least one routed topic.' },
    { stage: 'MAPPED_SOURCE', status: mappedCoverageAdequate ? 'SUFFICIENT' : mappedStageAttempted ? 'EXHAUSTED' : 'SKIPPED', reason: mappedStageAttempted ? 'Every applicable reviewed source-map pointer was attempted before discovery; adequacy was checked against each routed topic.' : 'No applicable reviewed source-map pointer was available.' },
    { stage: 'SITEMAP_DISCOVERY', status: sitemapCoverageAdequate && sitemapStageAttempted ? 'SUFFICIENT' : sitemapStageAttempted ? 'EXHAUSTED' : 'SKIPPED', reason: sitemapStageAttempted ? 'Official sitemap candidates were separately fetched and evidence-gated for each still-uncovered scope.' : 'Sitemap discovery was not attempted for this request.' },
    { stage: 'OFFICIAL_DOMAIN_SEARCH', status: finalCoverageAdequate && onlineSearchStageAttempted ? 'SUFFICIENT' : onlineSearchStageAttempted ? 'EXHAUSTED' : 'SKIPPED', reason: onlineSearchStageAttempted ? 'Official-domain search candidates were separately fetched and evidence-gated after sitemap discovery.' : 'Official-domain search was not attempted for this request.' },
    ...(!finalCoverageAdequate ? [{ stage: 'INSUFFICIENT' as const, status: 'EXHAUSTED' as const, reason: 'Permitted official-source routes were exhausted without evidence covering every required topic scope.' }] : [])
  ];
  return {
    records,
    provisionalTopics,
    trace: {
      path,
      sourceMapIds: [...sourceMapIds],
      selectedRecordIds: records.map(record => record.id),
      finalVerifiedUrls: [...finalVerifiedUrls],
      candidateOnly: records.length > 0,
      attempts,
      discoveryFetchAttempts,
      coverageDecisions,
      stages
    }
  };
}

export function buildGroundingEvidenceTrace(context: GroundedReasoningContext): GroundingEvidenceTrace[] {
  const records = [...context.primaryEvidence, ...context.officialGuidance, ...context.curatedSummaries];
  return records.map(record => {
    const metadata = record as unknown as { groundingEligible?: boolean; recordRole?: string };
    const isCandidate = record.lifecycleState === 'CANDIDATE';
    return {
      recordId: record.id,
      lifecycleState: record.lifecycleState,
      groundingEligible: metadata.groundingEligible !== false && metadata.recordRole !== 'SOURCE_MAP_POINTER',
      provenance: record.provenance,
      officialSourceUrl: record.officialSourceUrl,
      ...(isCandidate ? { fetchStatus: 'SUCCESS', finalUrl: record.officialSourceUrl, topicMatched: true, titleMatched: true, contentMatched: true } : {}),
      candidateOnly: isCandidate
    };
  });
}

/**
 * Extracts facts explicitly stated in user input.
 */
export function extractUserFacts(
  query: string,
  scenario?: AccountingScenarioState | null,
  semanticUnderstanding?: TransactionUnderstanding | null
): string[] {
  const facts: string[] = [];
  const q = query.trim();

  // Currencies and amounts
  const amountMatches = q.match(/(?:sgd|\$|usd|eur|gbp)?\s*[\d,]+(?:\.\d+)?\s*(?:k|m|thousand|million|billion)?\b/gi);
  if (amountMatches && amountMatches.length > 0) {
    facts.push(`Numerical quantities stated: ${amountMatches.map(m => m.trim()).join(', ')}`);
  }

  // Dates
  const dateMatches = q.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g);
  if (dateMatches && dateMatches.length > 0) {
    facts.push(`Transaction dates specified: ${dateMatches.join(', ')}`);
  }

  // Resolve semantic understanding: explicit parameter > scenario attached > synchronous deterministic parse
  const understanding = semanticUnderstanding || scenario?.semanticUnderstanding || defaultTransactionUnderstandingService.understandTransactionSync(query, scenario?.functionalCurrency || 'SGD');

  // Currency from structured understanding
  if (understanding?.currency?.value) {
    if (understanding.currency.value === 'USD') {
      facts.push('Foreign currency involved: USD');
    } else if (understanding.currency.value === 'SGD') {
      facts.push('Singapore Dollar (SGD) referenced');
    } else {
      facts.push(`Currency involved: ${understanding.currency.value}`);
    }
  }

  // Structured facts from understanding
  if (understanding) {
    if (understanding.transactionType && understanding.transactionType !== 'unclassified_transaction') {
      facts.push(`Transaction type: ${understanding.transactionType}`);
    }
    if (understanding.ownershipContext && understanding.ownershipContext !== 'unknown') {
      facts.push(`Ownership context: ${understanding.ownershipContext}`);
    }
    if (understanding.counterparty?.role && understanding.counterparty.role !== 'unknown') {
      facts.push(`Counterparty role: ${understanding.counterparty.role}`);
    }
    if (understanding.subject) {
      facts.push(`Transaction subject: ${understanding.subject}`);
    }
    if (understanding.amount !== undefined) {
      facts.push(`Stated transaction amount: ${understanding.amount}`);
    }
    if (understanding.paymentStatus && understanding.paymentStatus !== 'unknown') {
      facts.push(`Payment status: ${understanding.paymentStatus}`);
    }
  }

  if (scenario?.keyParameters) {
    for (const p of scenario.keyParameters) {
      if (p.badge !== 'Assumed Parameter' && !facts.some(f => f.includes(p.label))) {
        facts.push(`${p.label}: ${p.value}`);
      }
    }
  }

  return facts;
}

/**
 * Formulates deterministic application and calculation rules relevant to query.
 * Eliminates domain cross-contamination (e.g. no FX or lease rules in tax/employment queries).
 */
export function formulateApplicationRules(
  classification: QuestionClassificationResult,
  query: string
): string[] {
  const rules: string[] = [];
  const q = query.toLowerCase();

  // Computational double-entry balancing convention (strictly for transactions / journal requests)
  if (
    (q.includes('journal') || q.includes('entry') || q.includes('debit') || q.includes('credit') || classification.journalEntryRequired) &&
    (classification.intent === 'TRANSACTION' || classification.intent === 'HYBRID' || classification.journalEntryRequired)
  ) {
    rules.push('Calculation Rule: Sum of Debits must equal Sum of Credits exactly. Double-entry journals must balance to 2 decimal places.');
  }

  // Acquisition consideration arithmetic convention (strictly for trade discount purchase queries)
  if (q.includes('trade discount') || (q.includes('discount') && (q.includes('supplier') || q.includes('purchase') || q.includes('equipment') || q.includes('goods') || q.includes('invoice')))) {
    rules.push('Calculation Convention: Supplier trade discounts are deducted directly from the gross purchase price to derive initial cost consideration; trade discounts are not recorded as operating expenses.');
  }

  // Foreign currency transaction bifurcation arithmetic convention (strictly for forex / foreign currency queries)
  if (
    (q.includes('fx') || q.includes('forex') || q.includes('exchange rate') || (q.includes('foreign') && q.includes('currency')) || (q.includes('usd') && (q.includes('share') || q.includes('stock') || q.includes('gain')))) &&
    (classification.intent === 'TRANSACTION' || classification.accountingAnalysisRequired)
  ) {
    rules.push('Calculation Convention: Currency variance on monetary settlement is calculated as Foreign Amount * (Spot_disposal - Spot_acquisition); asset valuation variance is calculated as (Disposal_price - Cost_price) * Spot_disposal.');
  }

  // Cost allocation calculation convention (strictly for depreciation/amortization queries)
  if (
    (q.includes('depreciation') || q.includes('amortis') || q.includes('amortiz')) &&
    (classification.intent === 'TRANSACTION' || classification.accountingAnalysisRequired)
  ) {
    rules.push('Calculation Convention: Straight-line cost allocation formula is (Initial Cost - Residual Value) / Useful Life.');
  }

  return rules;
}

/**
 * Builds the provider-neutral GroundedReasoningContext.
 */
export async function buildGroundedReasoningContext(
  userInput: string,
  currentScenario?: AccountingScenarioState | null,
  retriever: ISourceRetriever = defaultAdvancedSourceRetriever,
  providerOrApiKey?: ProviderSettings | string,
  retrievalOptions: MappedFallbackOptions = {}
): Promise<GroundedReasoningContext> {
  // 1. Inventory the exact original query before the existing interpretation
  // call. A supplied context/observation is reused without another call.
  let requestCompletenessContext = retrievalOptions.requestCompletenessContext;
  let initialQuestionUnderstanding = retrievalOptions.questionUnderstanding;
  if (!initialQuestionUnderstanding && requestCompletenessContext) {
    initialQuestionUnderstanding = readRequestCompletenessObservation(requestCompletenessContext, userInput) as SemanticQuestionUnderstanding | undefined;
    if (!initialQuestionUnderstanding) initialQuestionUnderstanding = { mode: 'DETERMINISTIC_FALLBACK' };
  }
  if (!initialQuestionUnderstanding) {
    if (requestCompletenessContext) {
      initialQuestionUnderstanding = { mode: 'DETERMINISTIC_FALLBACK' };
    } else {
      requestCompletenessContext = createRequestCompletenessContext(userInput);
      initialQuestionUnderstanding = await interpretSemanticQuestion(userInput, providerOrApiKey);
    }
  }
  requestCompletenessContext = ensureRequestCompletenessContext(userInput, requestCompletenessContext, initialQuestionUnderstanding);
  const deterministicClassification = classifyQuestion(userInput);
  const reconciledQuestion = reconcileQuestionUnderstanding(
    userInput, deterministicClassification, initialQuestionUnderstanding, requestCompletenessContext
  );
  requestCompletenessContext = reconciledQuestion.requestCompletenessContext;
  const classification = retrievalOptions.evidenceScope
    ? {
      ...reconciledQuestion.classification,
      primaryDomain: retrievalOptions.evidenceScope.domain === 'IRAS_GST' ? 'GST' as const : 'TAX' as const,
      domains: [...new Set(getCoverageTopicsByIds(retrievalOptions.evidenceScope.topicIds)
        .filter(topic => topicMatchesEvidenceScope(topic, retrievalOptions.evidenceScope))
        .map(topic => topic.domainId))],
      topicIds: [...retrievalOptions.evidenceScope.topicIds],
      authorities: ['IRAS' as const],
      multiAuthority: false,
      accountingAnalysisRequired: false,
      taxAnalysisRequired: true,
      regulatoryAnalysisRequired: false,
      calculationRequired: false,
      journalEntryRequired: false,
      intent: 'STATUTORY_ADVISORY' as const,
      missingFacts: []
    }
    : reconciledQuestion.classification;
  const questionUnderstanding = reconciledQuestion.understanding;
  const irasPolicy = usesIrasEvidencePolicy(classification, userInput);
  const ignorePriorAccountingContext = Boolean(irasPolicy &&
    !classification.accountingAnalysisRequired && !classification.journalEntryRequired &&
    (!questionUnderstanding.interpretation || questionUnderstanding.interpretation.requestedOperation !== 'PREPARE_JOURNAL') &&
    !isShortSemanticFollowUp(userInput));
  const relevantScenario = ignorePriorAccountingContext ? null : currentScenario;
  const conversationContext = extractAccountingContext(relevantScenario);
  const semanticUnderstanding = await defaultTransactionUnderstandingService.understandTransaction(
    userInput,
    relevantScenario?.functionalCurrency || 'SGD',
    'SG',
    irasPolicy ? undefined : providerOrApiKey,
    conversationContext
  );

  // 2. Share the conflict-safe canonical routing hints with evaluation tooling.
  const retrievalHints = buildClassificationRetrievalHints(classification);
  // The governed response covers IRAS evidence only. Keep mixed-domain
  // classification for the answer, but rank local candidates inside the IRAS
  // topic/authority scope before the retriever applies its result limit.
  const evidenceTopicIds = getCoverageTopicsByIds(retrievalOptions.evidenceScope?.topicIds || retrievalHints.topicIds || [])
    .filter(topic => topicMatchesEvidenceScope(topic, retrievalOptions.evidenceScope))
    .filter(topic => !topic.routingOnly).map(topic => topic.id);
  const irasTopicIds = getCoverageTopicsByIds(evidenceTopicIds)
    .filter(topic => topic.domainId.startsWith('IRAS_')).map(topic => topic.id);
  // Keep a transient full-query scope beside any registered routing topics.
  // The registry is a routing aid: a lexical topic hit can cover one concept
  // while the rest of the user's IRAS question still needs discovery.
  const semanticIrasContext = irasPolicy ? retrievalOptions.evidenceScope ? {
    domainId: retrievalOptions.evidenceScope.context.domainId,
    population: retrievalOptions.evidenceScope.context.population,
    primarySubject: retrievalOptions.evidenceScope.context.primarySubject,
    concepts: retrievalOptions.evidenceScope.context.concepts,
    requestedConcepts: retrievalOptions.evidenceScope.requestedConcepts,
    mappedTopicIds: retrievalOptions.evidenceScope.topicIds,
    requestedOperation: retrievalOptions.evidenceScope.context.requestedOperation
  } : getSemanticIrasDiscoveryContext(questionUnderstanding, userInput) : undefined;
  const scopedEvidenceRuleInput = {
    ...(retrievalOptions.evidenceScope?.context.primarySubject.trim()
      ? { scopedSubject: retrievalOptions.evidenceScope.context.primarySubject }
      : semanticIrasContext?.primarySubject?.trim() ? { scopedSubject: semanticIrasContext.primarySubject } : {}),
    ...(retrievalOptions.evidenceScope?.context.population
      ? { scopedPopulation: retrievalOptions.evidenceScope.context.population }
      : semanticIrasContext?.population ? { scopedPopulation: semanticIrasContext.population } : {})
  };
  const requestedConcepts = retrievalOptions.evidenceScope?.requestedConcepts ||
    semanticIrasContext?.requestedConcepts || getRequestedQuestionConcepts(userInput, questionUnderstanding);
  const semanticDiscoveryQuery = retrievalOptions.semanticDiscoveryQuery || (retrievalOptions.evidenceScope
    ? [userInput, retrievalOptions.evidenceScope.context.primarySubject, ...retrievalOptions.evidenceScope.context.concepts,
      ...requestedConcepts.map(concept => concept.label)].filter(Boolean).join(' ')
    : buildSemanticDiscoveryQuery(userInput, questionUnderstanding.interpretation));
  const authorityDiscoveryContexts = irasPolicy
    ? provisionalIrasConceptTopics(userInput, semanticIrasContext, requestedConcepts)
    : [];
  const localRetrievalHints = irasPolicy
    ? { ...retrievalHints, domain: undefined, authorities: ['IRAS' as const], topicIds: irasTopicIds }
    : retrievalHints;
  const localRetrieved = await retriever.retrieveSources({
    query: userInput,
    ...(semanticIrasContext ? { semanticQuery: semanticDiscoveryQuery } : {}),
    ...(irasPolicy ? { requestedConcepts } : {}),
    ...localRetrievalHints,
    maxResults: GROUNDING_SOURCE_MAX_RESULTS,
    semanticContext: semanticUnderstanding
  });
  const contextualLocalRetrieved = [
    ...localRetrieved,
    ...getExplicitlyLinkedGstRateRecords(userInput, localRetrieved, retriever)
  ];
  const initiallyMatchedCoverage = getCoverageTopicsByIds(evidenceTopicIds) as MappedCoverageTopic[];
  const localQuality = irasPolicy ? applyStandaloneGstCalculationCoverage(userInput, evaluateEvidenceQuality({
    query: userInput, topicIds: evidenceTopicIds, records: contextualLocalRetrieved,
    missingFacts: classification.missingFacts,
    provisionalTopics: authorityDiscoveryContexts,
    requestedConcepts,
    ...scopedEvidenceRuleInput,
    authorities: ['IRAS'],
    referenceDate: retrievalOptions.referenceDate || TargetDateResolver.CURRENT_SYSTEM_DATE
  }), classification.missingFacts) : undefined;
  const localRetrievedIds = new Set(contextualLocalRetrieved.map(record => record.id));
  const locallyUncoveredConcepts = new Set(localQuality?.uncoveredConcepts || []);
  const uncoveredProvisionalDomains = new Set(authorityDiscoveryContexts
    .filter(topic => localQuality?.uncoveredTopicIds.includes(topic.id))
    .map(topic => topic.domainId));
  const normalFallbackTopicIds = [...new Set(retrievalOptions.localOnly ? [] : initiallyMatchedCoverage
    .filter(topic => !irasPolicy || topic.id.startsWith('iras-'))
    .filter(topic => localQuality && topic.id.startsWith('iras-')
      ? localQuality.uncoveredTopicIds.includes(topic.id) ||
        requestedConcepts.some(concept => locallyUncoveredConcepts.has(concept.label) &&
          evidenceTopicIds.includes(topic.id) &&
          (concept.topicIds.length === 0 || concept.topicIds.includes(topic.id)))
      : topic.status !== 'VALIDATED' || !topic.sourceRecordIds.some(id => localRetrievedIds.has(id)))
    .map(topic => topic.id))];
  const selectedFallbackDomains = new Set(getCoverageTopicsByIds(normalFallbackTopicIds)
    .filter(topic => topic.id.startsWith('iras-'))
    .map(topic => topic.domainId));
  const registeredTopicsForUncoveredProvisionalScope = retrievalOptions.localOnly ? [] : initiallyMatchedCoverage
    .filter(topic => topic.id.startsWith('iras-') && uncoveredProvisionalDomains.has(topic.domainId) &&
      !selectedFallbackDomains.has(topic.domainId))
    .map(topic => topic.id);
  const fallbackTopicIds = [...new Set([...normalFallbackTopicIds, ...registeredTopicsForUncoveredProvisionalScope])];
  const needsAuthorityFallback = Boolean(irasPolicy && localQuality &&
    (localQuality.status === 'INSUFFICIENT' || localQuality.uncoveredTopicIds.length > 0));
  const mappedFallback = await resolveMappedOfficialSourceFallback(fallbackTopicIds, userInput, retriever, {
    ...retrievalOptions,
    questionUnderstanding,
    semanticDiscoveryQuery: semanticIrasContext ? semanticDiscoveryQuery : undefined,
    authorityLevelDiscovery: retrievalOptions.localOnly ? false : retrievalOptions.authorityLevelDiscovery ?? needsAuthorityFallback,
    localEvidenceAdequate: localQuality
      ? localQuality.uncoveredTopicIds.length === 0 && (localQuality.uncoveredConcepts?.length || 0) === 0 &&
        localQuality.eligibleRecords.length > 0
      : false
  });
  const allRetrieved = [...contextualLocalRetrieved, ...mappedFallback.records];
  const evidenceQuality = irasPolicy ? applyStandaloneGstCalculationCoverage(userInput, evaluateEvidenceQuality({
    query: userInput, topicIds: evidenceTopicIds, records: allRetrieved,
    missingFacts: classification.missingFacts, sourceMapFallbackTrace: mappedFallback.trace,
    provisionalTopics: mappedFallback.provisionalTopics.length ? mappedFallback.provisionalTopics : authorityDiscoveryContexts,
    requestedConcepts,
    ...scopedEvidenceRuleInput,
    authorities: ['IRAS'],
    referenceDate: retrievalOptions.referenceDate || TargetDateResolver.CURRENT_SYSTEM_DATE
  }), classification.missingFacts) : undefined;
  const retrieved = evidenceQuality ? evidenceQuality.eligibleRecords : allRetrieved;

  // 3. Four-Tier Evidence Sorting based explicitly on evidenceTier
  const primaryEvidence: AuthoritativeSourceRecord[] = [];
  const officialGuidance: AuthoritativeSourceRecord[] = [];
  const curatedSummaries: AuthoritativeSourceRecord[] = [];

  for (const record of retrieved) {
    if (
      record.evidenceTier === 'PRIMARY_SOURCE' &&
      (record.sourceStatus === 'VERIFIED' || record.sourceStatus === 'HISTORICAL') &&
      record.isVerbatimText === true
    ) {
      primaryEvidence.push(record);
    } else if (record.evidenceTier === 'OFFICIAL_GUIDANCE') {
      officialGuidance.push(record);
    } else {
      curatedSummaries.push(record);
    }
  }

  // 4. Facts, Missing Facts, and Assumptions
  const userFacts = extractUserFacts(userInput, relevantScenario, semanticUnderstanding);
  const missingFacts = [...classification.missingFacts];

  const isTransactionQuery =
    classification.intent === 'TRANSACTION' ||
    classification.intent === 'HYBRID' ||
    classification.journalEntryRequired;

  if (isTransactionQuery && semanticUnderstanding.factsMissing) {
    for (const mf of semanticUnderstanding.factsMissing) {
      if (!missingFacts.includes(mf)) {
        missingFacts.push(mf);
      }
    }
  }

  // Assumptions: only when genuinely needed for an illustrative calculation/scenario
  const assumptions: ExplicitAssumption[] = [];
  if (relevantScenario?.assumptions) {
    assumptions.push(...relevantScenario.assumptions);
  }

  if (semanticUnderstanding.assumptions) {
    for (const asm of semanticUnderstanding.assumptions) {
      if (!assumptions.some(a => a.field === 'currency_assumption' || a.basisOrRationale === asm)) {
        assumptions.push({
          id: `sem-asm-${assumptions.length + 1}`,
          field: 'currency_or_transaction_parameter',
          assumedValue: asm,
          basisOrRationale: asm,
          materiality: 'LOW',
          userClarificationPrompt: 'Please confirm currency or transaction parameters if different.'
        });
      }
    }
  }

  // 5. Application and Calculation Rules
  const applicationRules = formulateApplicationRules(classification, userInput);

  return {
    classification,
    userFacts,
    missingFacts,
    assumptions,
    primaryEvidence,
    officialGuidance,
    curatedSummaries,
    applicationRules,
    currentInformationRequired: classification.currentInformationRequired,
    semanticUnderstanding,
    questionUnderstanding,
    requestCompletenessContext,
    evidenceQuality,
    sourceMapFallbackTrace: mappedFallback.trace
  };
}

/**
 * Formats the GroundedReasoningContext into a comprehensive, evidence-first system prompt
 * shared identically by Gemini, OpenAI, and Azure OpenAI adapters.
 */
export function formatGroundedSystemPrompt(
  context: GroundedReasoningContext,
  standard: AccountingStandard
): string {
  if (context.evidenceQuality) return formatIrasEvidencePrompt(context);
  const stdLabel = standard === 'SFRS_I'
    ? 'Singapore Financial Reporting Standards (International) [SFRS(I)]'
    : 'International Financial Reporting Standards [IFRS]';

  let prompt = `You are an authoritative Senior Singapore Accounting & Statutory Research Assistant for professional accountants.
Your primary directive is to provide correct, authoritative, and traceable information under ${stdLabel} and Singapore statutory law.

================================================================================
EVIDENCE-FIRST REASONING PRINCIPLES (MANDATORY SAFEGUARDS)
================================================================================
1. EVIDENCE GROUNDING: Use the supplied evidence for authoritative legal and accounting claims.
2. ANSWER PRIORITY: Apply validated local rules and evidence first. Use live-fetched candidate pages only to fill an identified local coverage gap; they may supplement but must not override validated local knowledge.
3. LIVE CANDIDATE LIMIT: A live-fetched candidate page supports only what its fetched, topic-matched text actually says. An overview page does not establish paragraph-level requirements, detailed calculations, or other facts absent from that page.
4. ANTI-FABRICATION: You must NEVER invent standards, paragraph numbers, statutory sections, rates, thresholds, deadlines, or citations.
5. CURATED SUMMARY STATUS: Never treat a curated summary as verified primary-source text.
6. APPLICATION RULES: Never treat an application/calculation rule as statutory authority.
7. STRICT SEPARATION: Clearly distinguish in your reasoning and output:
   - User Facts: Stated explicitly by the user.
   - Missing Facts: Required to confirm accounting treatment but omitted by user.
   - Assumptions: Introduced SOLELY for illustrative calculations; never silently convert a missing fact into an established fact.
   - Evidence: Grounded in retrieved primary sources or curated standards.
   - Professional Analysis: Applying the evidence to facts.
   - Conclusion: Recommended accounting or tax treatment.
   - Illustrative Journal Entry: Presented ONLY if facts and recognition criteria support it (or marked strictly conditional).
8. TIME-SENSITIVITY & UNCERTAINTY HANDLING:
   When current information is required but available evidence is insufficient or unverified, state:
   "I couldn't verify the applicable current source from the available evidence."
   Do not silently answer from unverified model memory.
9. CITATION INTEGRITY: Do not invent a citation merely because the user asks for one. Tie citations strictly to verified records.
10. INCOMPLETE EVIDENCE: If evidence conflicts or is incomplete, state the limitation instead of guessing.
11. CONCEPTUAL EXPLANATIONS: General model knowledge may be used for explanatory context, but must NOT be presented as verified authoritative evidence or given fabricated citations.
12. SIMPLE-QUESTION DEFAULT: For a short request to define or explain a term, answer the question directly even when no repository record is retrieved. Give a concise general explanation, explicitly label it as general explanatory context, and do not invent a statute, regulator, section, rate, threshold, deadline, eligibility condition, or source link. Do NOT respond only with "I couldn't verify the applicable current source from the available evidence." That wording is reserved for a request that actually requires a current legal, regulatory, tax, rate, threshold, deadline, or eligibility conclusion.

================================================================================
GROUNDED REASONING CONTEXT SUPPLIED TO YOU
================================================================================
`;

  // Section 1: User-Provided Facts
  prompt += `\n[1. USER-PROVIDED FACTS]\n`;
  if (context.userFacts.length > 0) {
    for (const fact of context.userFacts) {
      prompt += `• ${fact}\n`;
    }
  } else {
    prompt += `• None explicitly extracted from query.\n`;
  }

  // Section 1.1: Semantic Transaction Facts & Mandatory Guardrails
  if (context.semanticUnderstanding) {
    const sem = context.semanticUnderstanding;
    prompt += `\n[1.1 UNDERSTOOD TRANSACTION FACTS & MANDATORY ACCOUNTING GUARDRAILS]\n`;
    prompt += `• Reporting Entity: ${sem.reportingEntity.type.toUpperCase()}${sem.reportingEntity.description ? ` (${sem.reportingEntity.description})` : ''}\n`;
    if (sem.counterparty) {
      prompt += `• Counterparty Role: ${sem.counterparty.role.toUpperCase()}${sem.counterparty.description ? ` (${sem.counterparty.description})` : ''}\n`;
    }
    prompt += `• Ownership Context: ${(sem.ownershipContext || 'unknown').toUpperCase()}\n`;
    prompt += `• Payment Status: ${(sem.paymentStatus || 'unknown').toUpperCase()}\n`;
    prompt += `• Currency Fact: ${sem.currency.value || 'UNSPECIFIED'} (Source: ${sem.currency.source}, Confidence: ${sem.currency.confidence})\n`;
    if (sem.ownershipContext === 'own_equity') {
      prompt += `⚠️ MANDATORY GUARDRAIL (SFRS(I) 1-32 §33): The reporting entity is issuing its own equity. An entity's own shares can NEVER be recognized as a Financial Asset at FVTPL/FVTOCI. Credit Share Capital under Equity.\n`;
    }
    if (sem.currency.value === null || sem.currency.source === 'unknown') {
      prompt += `⚠️ MANDATORY GUARDRAIL: Currency is unspecified. Do NOT invent USD or execute foreign exchange translation.\n`;
    }
  }

  // Section 2: Missing Facts
  prompt += `\n[2. MISSING FACTS (FACTS REQUIRED BEFORE REACHING FINAL CONCLUSION)]\n`;
  if (context.missingFacts.length > 0) {
    for (const mf of context.missingFacts) {
      prompt += `⚠️ Missing Fact: ${mf}\n`;
    }
  } else {
    prompt += `• No material facts currently missing for general evaluation.\n`;
  }

  // Section 3: Explicit Assumptions
  prompt += `\n[3. EXPLICIT ASSUMPTIONS (ILLUSTRATIVE SCENARIO USE ONLY)]\n`;
  if (context.assumptions.length > 0) {
    for (const a of context.assumptions) {
      prompt += `• [${a.materiality} Materiality] ${a.field}: Assumed '${String(a.assumedValue)}' (${a.basisOrRationale})\n`;
    }
  } else {
    prompt += `• None assumed. Do not assume missing criteria are satisfied without explicitly marking them.\n`;
  }

  // Section 4: Authoritative Primary Source Evidence
  prompt += `\n[4. AUTHORITATIVE PRIMARY SOURCE EVIDENCE (VERBATIM STATUTES)]\n`;
  if (context.primaryEvidence.length > 0) {
    for (const p of context.primaryEvidence) {
      const freshnessLabel = p.freshnessStatus === 'HISTORICAL_SUPERSEDED'
        ? '[HISTORICAL / SUPERSEDED PROVISION]'
        : p.freshnessStatus === 'PENDING_EFFECTIVE'
        ? '[PENDING EFFECTIVE]'
        : p.freshnessStatus === 'AUDIT_OVERDUE'
        ? '[VERIFICATION REVIEW DUE]'
        : '[CURRENT PROVISION]';
      prompt += `### Primary Source: ${p.documentTitle} (${p.paragraphOrSection}) ${freshnessLabel}\n`;
      if (p.validFrom || p.validTo) {
        prompt += `Temporal Validity: ${p.validFrom || 'Initial'} to ${p.validTo || 'Present (In Force)'}\n`;
      }
      prompt += `Authority: ${p.authorityName} | Publisher: ${p.sourcePublisher}\n`;
      prompt += `Official URL: ${p.officialSourceUrl}\n`;
      prompt += `Verbatim Statutory Text:\n"${p.sourceText}"\n\n`;
    }
  } else {
    prompt += `• No verbatim primary statutory provision retrieved for this specific query.\n`;
  }

  // Section 5: Official Guidance
  prompt += `\n[5. OFFICIAL / CURATED GUIDANCE]\n`;
  if (context.officialGuidance.length > 0) {
    for (const g of context.officialGuidance) {
      const gMetadata = g as unknown as { recordRole?: string; lifecycleState?: string; sourceText?: string };
      const isLiveCandidate = gMetadata.recordRole === 'DISCOVERED_EVIDENCE' && gMetadata.lifecycleState === 'CANDIDATE';
      prompt += `### Guidance: ${g.documentTitle} (${g.paragraphOrSection})${isLiveCandidate ? ' [LIVE-FETCHED CANDIDATE — NOT LOCALLY VALIDATED]' : ''}\n`;
      prompt += `Authority: ${g.authorityName} | Publisher: ${g.sourcePublisher}\n`;
      prompt += `Summary: ${g.principleSummary}\n`;
      prompt += isLiveCandidate
        ? `Fetched page text (topic-matched overview only; do not infer detailed paragraph requirements or calculations absent from this text): ${g.sourceText}\n\n`
        : `Guidance Text: ${g.sourceText}\n\n`;
    }
  } else {
    prompt += `• No specific administrative guidance documents retrieved.\n`;
  }

  // Section 6: Curated Summaries (Needs Review)
  prompt += `\n[6. CURATED SUMMARIES (SFRS(I) STANDARDS & ACT SUMMARIES - NEEDS REVIEW)]\n`;
  if (context.curatedSummaries.length > 0) {
    for (const c of context.curatedSummaries) {
      const freshnessLabel = c.freshnessStatus === 'HISTORICAL_SUPERSEDED'
        ? '[HISTORICAL / SUPERSEDED PROVISION]'
        : c.freshnessStatus === 'PENDING_EFFECTIVE'
        ? '[PENDING EFFECTIVE]'
        : c.freshnessStatus === 'AUDIT_OVERDUE'
        ? '[VERIFICATION REVIEW DUE]'
        : '[CURRENT PROVISION]';
      prompt += `### Curated Standard/Statute Summary: ${c.documentTitle} (${c.paragraphOrSection}) ${freshnessLabel}\n`;
      if (c.validFrom || c.validTo) {
        prompt += `Temporal Validity: ${c.validFrom || 'Initial'} to ${c.validTo || 'Present (In Force)'}\n`;
      }
      prompt += `Authority: ${c.authorityName} | Instrument: ${c.legalOrStandardInstrument}\n`;
      prompt += `Official Source Portal: ${c.officialSourceUrl}\n`;
      prompt += `Status: ${c.sourceStatus} (${c.sourceType})\n`;
      prompt += `Principle / Summary: ${c.sourceText}\n\n`;
    }
  } else {
    prompt += `• No curated standard summaries retrieved.\n`;
  }

  // Section 7: Application & Calculation Rules
  prompt += `\n[7. APPLICATION & CALCULATION RULES (DETERMINISTIC LOGIC)]\n`;
  if (context.applicationRules.length > 0) {
    for (const r of context.applicationRules) {
      prompt += `• ${r}\n`;
    }
  } else {
    prompt += `• Standard accounting accrual and math balancing conventions apply.\n`;
  }

  // Section 8: Compact Decision Schema Specification
  if (context.classification.intent === 'STATUTORY_ADVISORY') {
    prompt += `
================================================================================
RESPONSE FORMAT SPECIFICATION (COMPACT STATUTORY DECISION SCHEMA)
================================================================================
CRITICAL FOR LATENCY & ACCURACY:
Do NOT write verbose markdown essays or redundant nested structures in JSON.
Deterministic application code automatically renders the markdown headers, citation badges, and UI cards.
Return ONLY this concise, compact JSON payload:
{
  "directAnswer": "Clear, direct answer. If no supplied evidence supports a legal claim, provide a general explanation clearly labelled as non-authoritative explanatory context rather than inventing a citation or returning only a verification disclaimer.",
  "keyRules": [
    "Specific statutory rule 1 with statutory numbers/thresholds/formula",
    "Specific statutory rule 2..."
  ],
  "caveats": [
    "Qualifying condition or exception 1..."
  ],
  "statuteReferences": [
    {
      "standard": "Act Name (e.g. Employment Act 1968)",
      "paragraph": "Section or Part (e.g. Part IV §38)",
      "authority": "MOM" | "CPF" | "IRAS" | "ACRA",
      "officialSourceUrl": "https://sso.agc.gov.sg/..."
    }
  ]
}
Return pure JSON only.
`;
  } else if (context.classification.intent === 'TRANSACTION' || context.classification.journalEntryRequired) {
    prompt += `
================================================================================
RESPONSE FORMAT SPECIFICATION (COMPACT TRANSACTION & JOURNAL DECISION SCHEMA)
================================================================================
CRITICAL FOR LATENCY & ACCURACY:
Do NOT write verbose markdown essays, redundant nested structures, or monetary amounts in JSON.
The deterministic accounting engine automatically computes debit/credit balancing, monetary amounts, foreign exchange rates, and UI parameters.
Gemini must NOT calculate amounts, balances, or invent placeholder numbers ($1,000, $50,000, etc.). Focus strictly on accounting classification, applicable standard, required account names, categories, debit/credit orientation, and missing valuation facts.
Return ONLY this concise, compact JSON payload:
{
  "transactionNature": "Brief title/nature of the transaction",
  "treatment": "Authoritative financial reporting treatment under ${stdLabel}",
  "requiredAccounts": [
    {
      "accountName": "Account Name (e.g. Office Equipment)",
      "category": "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE",
      "debitCredit": "DEBIT" | "CREDIT",
      "rationale": "Why debited/credited"
    }
  ],
  "bifurcateFx": true | false,
  "tradeDiscountHandling": "string",
  "missingFacts": ["Any missing facts required to establish final treatment"],
  "assumptions": [
    { "field": "string", "assumedValue": "string", "basis": "string", "materiality": "HIGH" | "MEDIUM" | "LOW" }
  ],
  "citations": [
    {
      "standard": "SFRS(I) Standard or Act Name",
      "paragraph": "§Paragraph or Section",
      "authority": "ASC" | "ACRA" | "IRAS" | "MOM" | "CPF",
      "officialSourceUrl": "string"
    }
  ]
}
Return pure JSON only.
`;
  } else {
    prompt += `
================================================================================
RESPONSE FORMAT SPECIFICATION (COMPACT ACCOUNTING REASONING SCHEMA)
================================================================================
CRITICAL FOR LATENCY & ACCURACY:
Do NOT write verbose markdown essays or duplicate boilerplate. Focus strictly on professional reasoning and technical treatment.
Return ONLY this concise, compact JSON payload:
{
  "decision": "Core conclusion on recognition, measurement, or compliance",
  "treatment": "Detailed financial reporting treatment under ${stdLabel}",
  "reasoning": "Technical rationale applying the standard or statutory provision to user facts",
  "singaporeTaxImpact": "Tax deductibility under Income Tax Act, capital allowances, or GST impact",
  "missingFacts": ["Any missing material facts required before reaching final conclusion"],
  "assumptions": [
    { "field": "string", "assumedValue": "string", "basis": "string", "materiality": "HIGH" | "MEDIUM" | "LOW" }
  ],
  "citations": [
    {
      "standard": "Standard or Act Name",
      "paragraph": "§Paragraph or Section",
      "authority": "ASC" | "ACRA" | "IRAS" | "MOM" | "CPF",
      "officialSourceUrl": "string"
    }
  ]
}
Return pure JSON only.
`;
  }

  return prompt;
}

/**
 * Post-processes an AI-generated accounting response:
 * 1. Executes post-generation citation verification on all returned citations.
 * 2. Applies deterministic accounting engine guardrails (balancing, FX bifurcation, trade discounts).
 * 3. Enforces uncertainty disclaimers when time-sensitive information is missing.
 * 4. Ensures strict separation of user facts, missing facts, and assumptions.
 */
export function postProcessAIResponse(
  parsed: any,
  currentScenario: AccountingScenarioState | null,
  userInput: string,
  groundedContext: GroundedReasoningContext,
  deterministicScenario?: AccountingScenarioState | null,
  standard: AccountingStandard = 'SFRS_I'
): {
  messageText: string;
  scenarioState: AccountingScenarioState;
  sourceMapFallbackTrace?: SourceMapFallbackTrace;
  groundingEvidence?: GroundingEvidenceTrace[];
} {
  if (groundedContext.evidenceQuality) {
    const taxClaimsWereOmitted = parsed?.taxClaims === undefined ||
      (Array.isArray(parsed.taxClaims) && parsed.taxClaims.length === 0);
    const canShowVerifiedSourceParagraphs = taxClaimsWereOmitted && groundedContext.evidenceQuality.eligibleRecords.length > 0;
    return renderIrasEvidenceResponse(parsed, groundedContext, userInput, deterministicScenario || null, standard,
      canShowVerifiedSourceParagraphs ? 'PROVIDER_NO_CLAIMS' : 'PROVIDER');
  }
  // If parsed is a compact decision (has directAnswer, treatment, decision, requiredAccounts, or lacks directGroups and messageText),
  // delegate to assembleDeterministicResponse which compiles the complete verified markdown, journal entries, and scenario state.
  const isCompactPayload = Boolean(
    parsed &&
    (parsed.directAnswer !== undefined ||
     parsed.requiredAccounts !== undefined ||
     (parsed.treatment !== undefined && (!parsed.directGroups || parsed.directGroups.length === 0)) ||
     (parsed.decision !== undefined && (!parsed.directGroups || parsed.directGroups.length === 0)) ||
     (!parsed.messageText && (!parsed.directGroups || parsed.directGroups.length === 0)))
  );

  // A settlement is a state transition, not an invitation for the model to
  // propose a fresh journal.  In particular, an AI payload may use the right
  // title while supplying unrelated lines (for example an entertainment
  // expense).  Route *all* settlement payload shapes through the deterministic
  // assembler, which resolves the target against committed balances first.
  const isSettlementFollowUp =
    groundedContext.semanticUnderstanding?.followUpAnalysis?.eventType === 'settlement' ||
    groundedContext.semanticUnderstanding?.followUpAnalysis?.eventType === 'partial_settlement';

  if (isCompactPayload || isSettlementFollowUp) {
    return assembleDeterministicResponse(
      parsed,
      userInput,
      currentScenario,
      groundedContext,
      deterministicScenario || null,
      standard
    );
  }

  const retrievedEvidenceScope: AuthoritativeSourceRecord[] = [
    ...groundedContext.primaryEvidence,
    ...groundedContext.officialGuidance,
    ...groundedContext.curatedSummaries
  ];

  // 1. Deterministic Accounting Engine Governance:
  // If the deterministic accounting engine recognized this transaction and calculated authoritative entries,
  // the deterministic engine's directGroups and calculations govern the journal output.
  // Gemini is responsible for accounting interpretation, tax summaries, and narrative advisory.
  const hasAuthoritativeDeterministicEntries =
    deterministicScenario &&
    deterministicScenario.scenarioType !== 'UNRECOGNIZED' &&
    deterministicScenario.directGroups &&
    deterministicScenario.directGroups.length > 0;

  // Enforce Phase 2.2 Hardening: Authority status triad
  // Deterministic engine recognized transaction -> DETERMINISTIC (or CONDITIONAL if missing facts exist)
  // Unrecognized transaction (AI proposed entries) -> strictly AI_PROPOSED (or CONDITIONAL if missing facts exist)
  // Missing facts ALWAYS trigger CONDITIONAL status.
  const hasMissingFacts = Boolean(groundedContext.missingFacts && groundedContext.missingFacts.length > 0);
  const computedAuthorityStatus: JournalAuthorityStatus = hasMissingFacts
    ? 'CONDITIONAL'
    : (hasAuthoritativeDeterministicEntries
        ? (deterministicScenario.authorityStatus || 'DETERMINISTIC')
        : 'AI_PROPOSED');

  let directGroups: JournalEntryGroup[];

  if (hasAuthoritativeDeterministicEntries) {
    directGroups = deterministicScenario.directGroups!.map((grp) => ({
      ...grp,
      authorityStatus: grp.authorityStatus || computedAuthorityStatus
    }));
  } else {
    // Validate and compute totals on AI-supplied directGroups
    directGroups = (Array.isArray(parsed.directGroups) ? parsed.directGroups : []).map((grp: any, gIdx: number) => {
      const lines = (Array.isArray(grp?.lines) ? grp.lines : []).map((l: any, lIdx: number) => ({
        id: l.id || `line-${gIdx}-${lIdx}`,
        accountCode: l.accountCode || '1000',
        accountName: l.accountName || 'Account',
        category: l.category || 'ASSET',
        debit: typeof l.debit === 'number' ? Math.round(l.debit * 100) / 100 : 0,
        credit: typeof l.credit === 'number' ? Math.round(l.credit * 100) / 100 : 0,
        foreignCurrency: l.foreignCurrency,
        foreignDebit: l.foreignDebit,
        foreignCredit: l.foreignCredit,
        exchangeRate: l.exchangeRate,
        lineExplanation: l.lineExplanation || ''
      }));

      // Trade discount guardrail: Deducted directly from asset purchase cost (SFRS(I) 1-16 §16(a))
      // If an expense line was mistakenly generated for a trade discount, remove it
      const tradeDiscountExpenseIdx = lines.findIndex(
        (l: any) => l.accountName.toLowerCase().includes('trade discount') && l.category === 'EXPENSE'
      );
      if (tradeDiscountExpenseIdx !== -1) {
        lines.splice(tradeDiscountExpenseIdx, 1);
      }

      const totalDebit = Math.round(lines.reduce((s: number, l: any) => s + l.debit, 0) * 100) / 100;
      const totalCredit = Math.round(lines.reduce((s: number, l: any) => s + l.credit, 0) * 100) / 100;
      const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

      // Post-generation citation verification on all citations in this group
      const verifiedCitations: StandardCitation[] = (grp.citations || []).flatMap((cite: any) => {
        const verification = defaultCitationVerifier.verifyCitation(cite, cite.authority, retrievedEvidenceScope);
        if (!verification.isValid || !verification.matchedRecord?.officialSourceUrl) return [];
        const safeUrl = verification.matchedRecord.officialSourceUrl;

        return [{
          standard: cite.standard || '',
          paragraph: cite.paragraph || '',
          title: cite.title || '',
          text: cite.text || '',
          authority: verification.matchedRecord.authority,
          sourcePublisher: verification.matchedRecord.sourcePublisher,
          officialSourceUrl: safeUrl,
          verificationStatus: verification.status,
          isAuthoritativePrimarySource: verification.isAuthoritativePrimarySource,
          isStructurallyValid: verification.isStructurallyValid,
          verificationReason: verification.reason,
          structuralVerificationOnly: true
        }];
      });

      return {
        id: grp.id || `grp-${gIdx + 1}`,
        eventDate: formatSingaporeDate(grp.eventDate || new Date()),
        title: grp.title || `Entry Group ${gIdx + 1}`,
        summary: grp.summary || '',
        lines,
        totalDebit,
        totalCredit,
        isBalanced,
        citations: verifiedCitations,
        rationalePoints: grp.rationalePoints || [],
        authorityStatus: computedAuthorityStatus
      };
    });
  }

  // Safeguard: If AI response didn't supply directGroups (e.g. conceptual advisory query), preserve current
  if (directGroups.length === 0 && currentScenario?.directGroups && currentScenario.directGroups.length > 0) {
    directGroups = currentScenario.directGroups.map((grp) => ({
      ...grp,
      authorityStatus: grp.authorityStatus || computedAuthorityStatus
    }));
  }

  // If deterministic scenario provided keyParameters, prioritize them
  const keyParameters = (hasAuthoritativeDeterministicEntries && deterministicScenario.keyParameters && deterministicScenario.keyParameters.length > 0)
    ? deterministicScenario.keyParameters
    : ((parsed.keyParameters && Array.isArray(parsed.keyParameters) && parsed.keyParameters.length > 0)
      ? parsed.keyParameters
      : (currentScenario?.keyParameters || []));

  const finalTitle = (parsed.transactionTitle && parsed.transactionTitle !== 'Accounting Transaction')
    ? parsed.transactionTitle
    : (deterministicScenario?.transactionTitle || currentScenario?.transactionTitle || 'Accounting Transaction');

  // Verify and normalize statutory advisories
  const statutoryAdvisory = (parsed.statutoryAdvisory || deterministicScenario?.statutoryAdvisory || currentScenario?.statutoryAdvisory || []).map((adv: any) => ({
    ...adv,
    ...(typeof adv.summary === 'string' ? {
      summary: guardUnconditionalMealInputTaxClaim(adv.summary, userInput, groundedContext, groundedContext.missingFacts)
    } : {}),
    ...(Array.isArray(adv.keyRules) ? {
      keyRules: adv.keyRules.map((rule: string) =>
        guardUnconditionalMealInputTaxClaim(rule, userInput, groundedContext, groundedContext.missingFacts)
      )
    } : {}),
    ...(hasUnresolvedMealInputTaxEligibility(userInput, groundedContext.missingFacts) && typeof adv.isGstClaimable === 'boolean'
      ? { isGstClaimable: undefined }
      : {}),
    officialUrl: getSafeOfficialUrl(adv.officialUrl, adv.statuteOrAct, adv.sectionOrSchedule, adv.authority, retrievedEvidenceScope) || undefined
  }));

  const selectedAccountingTreatmentSummary = parsed.accountingTreatmentSummary ||
    deterministicScenario?.accountingTreatmentSummary || currentScenario?.accountingTreatmentSummary;
  const selectedSingaporeTaxTreatmentSummary = parsed.singaporeTaxTreatmentSummary ||
    deterministicScenario?.singaporeTaxTreatmentSummary || currentScenario?.singaporeTaxTreatmentSummary;
  const selectedRegulatoryMandatesSummary = parsed.regulatoryMandatesSummary ||
    deterministicScenario?.regulatoryMandatesSummary || currentScenario?.regulatoryMandatesSummary;

  // Uncertainty handling & conditional conclusions
  let uncertaintyDisclaimer = parsed.uncertaintyDisclaimer || currentScenario?.uncertaintyDisclaimer || '';

  // 1. Missing material facts produce conditional conclusions
  if (groundedContext.missingFacts && groundedContext.missingFacts.length > 0) {
    const missingConditionNotice = `Conclusion is conditional upon establishing: ${groundedContext.missingFacts.join('; ')}.`;
    if (!uncertaintyDisclaimer.includes('conditional upon establishing') && !uncertaintyDisclaimer.includes(missingConditionNotice)) {
      uncertaintyDisclaimer = uncertaintyDisclaimer ? `${missingConditionNotice} ${uncertaintyDisclaimer}` : missingConditionNotice;
    }
  }

  // 2. No retrieved evidence -> no claim presented as authoritative
  if (retrievedEvidenceScope.length === 0) {
    const noEvidenceNotice = "No authoritative evidence was retrieved from the verified repository to support this claim.";
    if (!uncertaintyDisclaimer.includes(noEvidenceNotice) && !(parsed.messageText || '').includes(noEvidenceNotice)) {
      uncertaintyDisclaimer = uncertaintyDisclaimer ? `${noEvidenceNotice} ${uncertaintyDisclaimer}` : noEvidenceNotice;
    }
  }

  // 3. Time-sensitivity fallback
  if (groundedContext.currentInformationRequired && groundedContext.primaryEvidence.length === 0) {
    const fallbackNotice = "I couldn't verify the applicable current source from the available evidence.";
    if (!uncertaintyDisclaimer.includes(fallbackNotice) && !(parsed.messageText || '').includes(fallbackNotice)) {
      uncertaintyDisclaimer = uncertaintyDisclaimer ? `${fallbackNotice} ${uncertaintyDisclaimer}` : fallbackNotice;
    }
  }

  uncertaintyDisclaimer = guardUnconditionalMealInputTaxClaim(
    uncertaintyDisclaimer,
    userInput,
    groundedContext,
    groundedContext.missingFacts
  );

  // Ensure assumptions are explicit and separated from missing facts
  const assumptions: ExplicitAssumption[] = [
    ...(parsed.assumptions || []),
    ...(deterministicScenario?.assumptions || []),
    ...groundedContext.assumptions.filter(
      (ga) => !(parsed.assumptions || []).some((pa: any) => pa.field === ga.field)
    )
  ];

  const scenarioState: AccountingScenarioState = {
    scenarioType: parsed.scenarioType || deterministicScenario?.scenarioType || currentScenario?.scenarioType || 'UNIVERSAL',
    queryIntent: parsed.queryIntent || (statutoryAdvisory.length > 0 ? 'STATUTORY_ADVISORY' : currentScenario?.queryIntent || 'TRANSACTION'),
    primaryDomain: parsed.primaryDomain || deterministicScenario?.primaryDomain || currentScenario?.primaryDomain || (statutoryAdvisory.length > 0 ? (statutoryAdvisory[0].authority === 'ACRA' ? 'ACRA_CORP' : statutoryAdvisory[0].authority === 'CPF' ? 'CPF_BOARD' : statutoryAdvisory[0].authority === 'MOM' ? 'MOM_EMPLOYMENT' : statutoryAdvisory[0].authority === 'MAS' ? 'MAS_FUNDS' : 'IRAS_TAX') : 'ACCOUNTING_SFRS'),
    rawQuery: userInput,
    transactionTitle: finalTitle,
    functionalCurrency: parsed.functionalCurrency || deterministicScenario?.functionalCurrency || currentScenario?.functionalCurrency || 'SGD',
    transactionCurrency: parsed.transactionCurrency || deterministicScenario?.transactionCurrency || currentScenario?.transactionCurrency || 'SGD',
    accountingTreatmentSummary: typeof selectedAccountingTreatmentSummary === 'string'
      ? guardUnconditionalMealInputTaxClaim(selectedAccountingTreatmentSummary, userInput, groundedContext, groundedContext.missingFacts)
      : selectedAccountingTreatmentSummary,
    singaporeTaxTreatmentSummary: typeof selectedSingaporeTaxTreatmentSummary === 'string'
      ? guardUnconditionalMealInputTaxClaim(selectedSingaporeTaxTreatmentSummary, userInput, groundedContext, groundedContext.missingFacts)
      : selectedSingaporeTaxTreatmentSummary,
    regulatoryMandatesSummary: typeof selectedRegulatoryMandatesSummary === 'string'
      ? guardUnconditionalMealInputTaxClaim(selectedRegulatoryMandatesSummary, userInput, groundedContext, groundedContext.missingFacts)
      : selectedRegulatoryMandatesSummary,
    effectiveDateOrTiming: parsed.effectiveDateOrTiming || deterministicScenario?.effectiveDateOrTiming || currentScenario?.effectiveDateOrTiming,
    uncertaintyDisclaimer: uncertaintyDisclaimer || undefined,
    authorityStatus: computedAuthorityStatus,
    keyParameters,
    directGroups,
    statutoryAdvisory: statutoryAdvisory.length > 0 ? statutoryAdvisory : undefined,
    assumptions: assumptions.length > 0 ? assumptions : undefined,
    missingFacts: groundedContext.missingFacts.length > 0 ? groundedContext.missingFacts : undefined,
    ownershipContext: deterministicScenario?.ownershipContext || groundedContext.semanticUnderstanding?.ownershipContext || currentScenario?.ownershipContext,
    semanticUnderstanding: groundedContext.semanticUnderstanding || currentScenario?.semanticUnderstanding,
    isComplete: groundedContext.missingFacts.length === 0 && retrievedEvidenceScope.length > 0,
    missingFields: []
  };

  return {
    messageText: appendStatutorySourceFooter(
      guardUnconditionalMealInputTaxClaim(parsed.messageText || '', userInput, groundedContext, groundedContext.missingFacts),
      scenarioState,
      retrievedEvidenceScope
    ),
    scenarioState,
    sourceMapFallbackTrace: groundedContext.sourceMapFallbackTrace,
    groundingEvidence: buildGroundingEvidenceTrace(groundedContext)
  };
}
