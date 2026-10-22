import type {
  OwnershipContext,
  CounterpartyRole,
  TransactionNatureType,
  InstrumentType
} from '../types/conversationState';
import type { TransactionUnderstanding } from '../services/transactionUnderstandingService';
import {
  SINGAPORE_COVERAGE_REGISTRY,
  type SingaporeKnowledgeDomain,
  type CoverageStatus
} from '../standards/coverageRegistry';
import {
  type TopicSemanticCriteria,
  CANONICAL_TOPIC_SEMANTIC_CRITERIA
} from '../standards/semanticAccountingRules';
import { removeNegatedJournalDirectives } from '../utils/journalRequestIntent';

export type { TopicSemanticCriteria };

export interface QueryTopic {
  id: string;
  name: string;
  keywords: string[];
  /** Narrow query-only patterns for natural phrasings that need more than lexical aliases. */
  queryPatterns?: string[];
  exclusionKeywords?: string[];
  canonicalConceptId?: string;
  domainId: SingaporeKnowledgeDomain;
  authorities: string[];
  coverageStatus: CoverageStatus;
  actOrStandard?: string;
  sectionMatch?: string;
  semanticCriteria?: TopicSemanticCriteria;
}

export interface ResolvedTopic extends QueryTopic {
  matchSource?: 'semantic_primary' | 'semantic_corroborated' | 'lexical_only';
  primarySignalScore?: number;
}

export interface DecomposeQueryOptions {
  allowLexicalExpansion?: boolean;
}

export interface TopicDecompositionResult {
  isMultiTopic: boolean;
  topics: ResolvedTopic[];
  unresolvedTopics: string[];
}

function isCompanyAnnualReturnDeadlineClause(clause: string): boolean {
  const company = "(?:(?:(?:my|our|the)\\s+)?(?:singapore[\\s-]+incorporated\\s+)?company(?:['’]s)?|(?:my|our)\\s+company)";
  const annualReturn = "annual[-\\s]+returns?";
  const deadlinePatterns = [
    new RegExp('^when\\s+(?:is|are)\\s+' + company + '\\s+' + annualReturn + '\\s+(?:(?:filing\\s+)?(?:is\\s+)?(?:due|deadline)(?:\\s+date)?)\\??$', 'i'),
    new RegExp('^when\\s+(?:does|must|should)\\s+' + company + '\\s+file\\s+(?:(?:its|the)\\s+)?' + annualReturn + '\\??$', 'i'),
    new RegExp('^what\\s+(?:is|would\\s+be)\\s+(?:the\\s+)?' + company + '\\s+' + annualReturn + '\\s+(?:filing\\s+)?(?:deadline|due\\s+date)\\??$', 'i'),
    new RegExp('^what\\s+(?:is|would\\s+be)\\s+(?:the\\s+)?' + annualReturn + '\\s+(?:filing\\s+)?(?:deadline|due\\s+date)\\s+for\\s+' + company + '\\??$', 'i'),
    new RegExp('^what\\s+(?:is|would\\s+be)\\s+the\\s+filing\\s+deadline\\s+for\\s+' + company + '\\s+' + annualReturn + '\\??$', 'i'),
    new RegExp('^(?:when|what\\s+date)\\s+(?:is\\s+)?(?:the\\s+)?' + annualReturn + '\\s+(?:filing\\s+)?(?:for\\s+' + company + '\\s+)?(?:is\\s+)?due\\??$', 'i')
  ];
  return deadlinePatterns.some(pattern => pattern.test(clause));
}

function isAnnualReturnFactsRequestClause(clause: string): boolean {
  const direct = /^(?:(?:please\s+)?(?:identify|list|name|specify|tell\s+me|show\s+me)\s+(?:the\s+)?(?:company\s+)?(?:missing|required|necessary)\s+(?:company\s+)?(?:facts|information|details)|what\s+(?:company\s+)?(?:facts|information|details)\s+(?:do\s+you\s+need|required|are\s+needed|must\s+i\s+provide)(?:\s+to\s+(?:determine|work\s+out|calculate)\s+(?:the\s+)?(?:company\s+)?annual[-\s]+returns?(?:\s+(?:filing\s+)?(?:deadline|due\s+date))?)?)\??$/i;
  const company = "(?:(?:(?:my|our|the)\\s+)?(?:singapore[\\s-]+incorporated\\s+)?company(?:['’]s)?|(?:my|our)\\s+company)";
  const annualReturn = "annual[-\\s]+returns?";
  const combined = new RegExp('^what\\s+(?:company\\s+)?(?:facts|information|details)\\s+do\\s+you\\s+need\\s+to\\s+(?:determine|work\\s+out|calculate)\\s+(?:when\\s+' + company + '\\s+' + annualReturn + '\\s+(?:is\\s+)?due|(?:the\\s+)?' + annualReturn + '\\s+(?:filing\\s+)?(?:deadline|due\\s+date)\\s+for\\s+' + company + ')\\??$', 'i');
  return direct.test(clause) || combined.test(clause);
}

function isBoundedMissingCompanyFactsStatement(clause: string): boolean {
  const factPattern = /\b(?:financial\s+year\s+end|FYE|listing\s+status|listed\s+status|whether\s+(?:the\s+)?(?:company|it)\s+is\s+(?:non[-\s]?listed|unlisted|listed)|whether\s+(?:the\s+)?(?:company|it)\s+(?:has|keeps|maintains)\s+(?:an?\s+)?overseas\s+branch\s+register|overseas\s+branch\s+register(?:\s+status)?)\b/i;
  const missingPattern = /\b(?:not\s+(?:provided|supplied|given|stated|specified|known)|haven['’]?t\s+(?:provided|supplied|given|stated|specified)|have\s+not\s+(?:provided|supplied|given|stated|specified)|did\s+not\s+(?:provide|supply|give|state|specify)|unknown|unspecified|missing|do\s+not\s+know|don['’]?t\s+know|not\s+sure\s+whether)\b/i;
  if (!factPattern.test(clause) || !missingPattern.test(clause)) return false;
  const remainder = clause
    .replace(/\b(?:financial\s+year\s+end|FYE|listing\s+status|listed\s+status|whether\s+(?:the\s+)?(?:company|it)\s+is\s+(?:non[-\s]?listed|unlisted|listed)|whether\s+(?:the\s+)?(?:company|it)\s+(?:has|keeps|maintains)\s+(?:an?\s+)?overseas\s+branch\s+register|overseas\s+branch\s+register(?:\s+status)?)\b/gi, ' ')
    .replace(/\b(?:not\s+(?:provided|supplied|given|stated|specified|known)|haven['’]?t\s+(?:provided|supplied|given|stated|specified)|have\s+not\s+(?:provided|supplied|given|stated|specified)|did\s+not\s+(?:provide|supply|give|state|specify)|unknown|unspecified|missing|do\s+not\s+know|don['’]?t\s+know|not\s+sure\s+whether)\b/gi, ' ')
    .replace(/\b(?:i|we|the|our|its|it|company(?:['’]s)?|whether|is|are|has|have|been|and|or|a|an|to|as|of|status)\b/gi, ' ')
    .replace(/[\s,.;:!?'"’()-]+/g, '');
  return remainder.length === 0;
}

function isCashTopUpReliefRequest(query: string): boolean {
  return /\bcash\s+top[- ]ups?\b/i.test(query) &&
    /\b(?:cpf|special account|retirement account|medisave account)\b/i.test(query) &&
    /\b(?:tax\s+)?relief\b/i.test(query);
}

/** Prunes two cross-caller false positives while retaining separately asked workstreams. */
function filterContextualTopics<T extends QueryTopic>(query: string, topics: readonly T[]): T[] {
  const q = query.toLowerCase();
  const passengerCarInputTaxContext = /\b(?:s-plate|passenger (?:motor )?car)\b/i.test(q) &&
    /\b(?:gst|goods and services tax|input tax|input gst)\b/i.test(q);
  const hasAdditionalOrdinaryInputTaxWorkstream = /\b(?:input\s+(?:tax|gst)|gst)\b/i.test(q) &&
    /\b(?:equipment|office|supplies|asset|services?|vans?|commercial vehicles?)\b/i.test(
      q.replace(/\bgoods\s+and\s+services\s+tax\b/gi, ' ')
    );
  const hasSeparateGstWorkstream = /\b(?:gst registration|register(?:ed|ing)? for gst|registration threshold|taxable turnover|output tax|tax invoice|invoic\w*|zero[ -]?rated?|exempt supplies?|reverse charge)\b/i.test(q) ||
    hasAdditionalOrdinaryInputTaxWorkstream;
  const hasCashTopUpReliefRequest = isCashTopUpReliefRequest(query);
  const hasSeparateCompulsoryCpfReliefRequest = /\bcpf\s+relief\s+for\s+employees?\b|\bemployee\s+cpf\s+relief\b/i.test(q) ||
    /\b(?:compulsory|mandatory)\b[^.!?;]{0,80}\bcpf\b/i.test(q) ||
    /\bcpf\b[^.!?;]{0,80}\b(?:compulsory|mandatory)\b/i.test(q);
  return topics.filter(topic =>
    !(passengerCarInputTaxContext && !hasSeparateGstWorkstream && topic.domainId === 'IRAS_GST' &&
      !['iras-gst-blocked-input-tax', 'iras-gst-motor-vehicles'].includes(topic.id)) &&
    !(hasCashTopUpReliefRequest && !hasSeparateCompulsoryCpfReliefRequest && topic.id === 'iras-individual-cpf-relief')
  );
}

/** Binds only fully recognized ordinary-company annual-return fact requests. */
export function isBoundedAcraAnnualReturnMissingFactsQuestion(query: string): boolean {
  const normalized = removeNegatedJournalDirectives(query).trim();
  if (!normalized || /\b(?:vcc|variable[\s-]+capital\s+compan(?:y|ies)|foreign(?:[\s-]+incorporated)?|overseas\s+company|incorporated\s+outside\s+singapore|extension|extended\s+deadline|waiver|special\s+order)\b/i.test(normalized)) return false;
  if (!/\bcompan(?:y|ies)\b/i.test(normalized)) return false;
  const clauses = normalized.split(/[.!?;]+/).map(clause => clause.trim()).filter(Boolean);
  if (!clauses.length) return false;
  let hasDeadline = false;
  let hasFactsRequest = false;
  for (const clause of clauses) {
    const deadline = isCompanyAnnualReturnDeadlineClause(clause);
    const factsRequest = isAnnualReturnFactsRequestClause(clause);
    if (deadline || factsRequest && /\bannual[-\s]+returns?\b/i.test(clause) && /\b(?:when|deadline|due\s+date|is\s+due)\b/i.test(clause)) hasDeadline = true;
    if (factsRequest) hasFactsRequest = true;
    if (deadline || factsRequest || isBoundedMissingCompanyFactsStatement(clause) ||
        /^do\s+not\s+assume\s+(?:them|those\s+facts|these\s+facts|the\s+missing\s+facts)$/i.test(clause)) continue;
    return false;
  }
  return hasDeadline && hasFactsRequest;
}

export class QueryTopicResolver {
  public static readonly CANONICAL_TOPICS: QueryTopic[] = SINGAPORE_COVERAGE_REGISTRY.map((metadata) => ({
    id: metadata.id,
    name: metadata.title,
    keywords: metadata.keywords,
    queryPatterns: metadata.queryPatterns,
    exclusionKeywords: metadata.exclusionKeywords,
    domainId: metadata.domainId,
    authorities: metadata.authorities,
    coverageStatus: metadata.status,
    ...(metadata.canonicalConceptId ? { canonicalConceptId: metadata.canonicalConceptId } : {}),
    ...(metadata.actOrStandard ? { actOrStandard: metadata.actOrStandard } : {}),
    ...(metadata.sectionMatch ? { sectionMatch: metadata.sectionMatch } : {}),
    ...(metadata.semanticCriteriaKey && metadata.semanticCriteriaKey in CANONICAL_TOPIC_SEMANTIC_CRITERIA
      ? { semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA[metadata.semanticCriteriaKey as keyof typeof CANONICAL_TOPIC_SEMANTIC_CRITERIA] }
      : {})
  }));

  /** Resolve canonical IDs for callers that already classified the query. */
  public resolveTopicIds(topicIds: readonly string[]): QueryTopic[] {
    const wanted = new Set(topicIds);
    return QueryTopicResolver.CANONICAL_TOPICS.filter(topic => wanted.has(topic.id));
  }

  /**
   * Decomposes user query into identified statutory and accounting topics.
   *
   * Semantic Architecture & Rules:
   * 1. Semantic criteria act as the PRIMARY topic signal.
   * 2. 'semantic_corroborated' is defined as lexical evidence consistent with the topic's specific semantic classification.
   * 3. When a usable semantic context exists, uncorroborated 'lexical_only' matches are prevented from expanding the topic list.
   * 4. If no semantic topics match, 'lexical_only' activates as a controlled fallback.
   * 5. 'unknown' attributes are strictly neutral.
   */
  public decomposeQuery(
    query: string,
    semanticContext?: TransactionUnderstanding,
    options?: DecomposeQueryOptions
  ): TopicDecompositionResult {
    if (!query || typeof query !== 'string') {
      return { isMultiTopic: false, topics: [], unresolvedTopics: [] };
    }

    const qLower = query.toLowerCase();

    // Extract structured semantics if provided, ensuring strict neutrality for 'unknown'
    const sem = semanticContext;
    const hasSem = Boolean(sem);

    const semOwnContext: OwnershipContext | undefined = (sem?.ownershipContext && sem.ownershipContext !== 'unknown' && sem.ownershipContext !== 'not_applicable')
      ? sem.ownershipContext
      : undefined;

    const semTxType: TransactionNatureType | undefined = (sem?.transactionType && sem.transactionType !== 'unclassified_transaction')
      ? sem.transactionType
      : undefined;

    const semInstrument: InstrumentType | undefined = (sem?.instrument && sem.instrument !== 'unknown')
      ? sem.instrument
      : undefined;

    const semCounterpartyRole: CounterpartyRole | undefined = (sem?.counterparty?.role && sem.counterparty.role !== 'unknown')
      ? sem.counterparty.role
      : undefined;

    // Usable semantic context: identifiable transaction type or ownership context with >= 0.50 confidence
    const hasUsableSemanticContext = hasSem && (semTxType !== undefined || semOwnContext !== undefined) && (sem?.confidence ?? 0) >= 0.50;

    const semMatchedTopics: ResolvedTopic[] = [];
    const lexicalOnlyTopics: ResolvedTopic[] = [];

    for (const topic of QueryTopicResolver.CANONICAL_TOPICS) {
      const criteria = topic.semanticCriteria;

      // 1. Primary-topic pruning filter
      if (semTxType && criteria?.blockedByTransactionTypes?.includes(semTxType)) {
        continue;
      }

      // 2. Primary Semantic Evaluation
      let hasSemanticMatch = false;
      if (criteria && hasSem) {
        if (semOwnContext && criteria.ownershipContexts?.includes(semOwnContext)) {
          hasSemanticMatch = true;
        }
        if (semTxType && criteria.transactionTypes?.includes(semTxType)) {
          hasSemanticMatch = true;
        }
        if (semInstrument && criteria.instruments?.includes(semInstrument)) {
          hasSemanticMatch = true;
        }
        if (semCounterpartyRole && criteria.counterpartyRoles?.includes(semCounterpartyRole)) {
          hasSemanticMatch = true;
        }
      }

      // 3. Supporting Lexical Matching
      const hasLexicalMatch =
        !(topic.exclusionKeywords ?? []).some((phrase) => qLower.includes(phrase.toLowerCase())) &&
        (topic.keywords.some((kw) => keywordMatches(qLower, kw)) ||
          (topic.queryPatterns ?? []).some((pattern) => new RegExp(pattern, 'i').test(query)) ||
          topic.id === 'iras-individual-cpf-cash-top-up-relief' && isCashTopUpReliefRequest(query) ||
          topic.id === 'acra_annual-returns' && isBoundedAcraAnnualReturnMissingFactsQuestion(query));

      // 4. Topic Resolution & Attribution
      if (hasSemanticMatch && hasLexicalMatch) {
        // True semantic corroboration: semantic classification matched AND lexical keywords directly corroborate this topic
        semMatchedTopics.push({
          ...topic,
          matchSource: 'semantic_corroborated',
          primarySignalScore: 1.0
        });
      } else if (hasSemanticMatch) {
        // Primary semantic topic without explicit topic keywords in query
        semMatchedTopics.push({
          ...topic,
          matchSource: 'semantic_primary',
          primarySignalScore: sem?.confidence ?? 0.9
        });
      } else if (hasLexicalMatch) {
        // Lexical keyword hit without semantic backing
        lexicalOnlyTopics.push({
          ...topic,
          matchSource: 'lexical_only',
          primarySignalScore: 0.5
        });
      }
    }

    let matchedTopics: ResolvedTopic[] = [];

    // Controlled Lexical Expansion Logic:
    // When a usable semantic context exists, suppress lexical_only topics to avoid false expansion from incidental words.
    // However, if 0 semantic topics matched, activate lexical_only as a controlled fallback so the query is not left empty.
    if (hasUsableSemanticContext && !options?.allowLexicalExpansion) {
      if (semMatchedTopics.length > 0) {
        matchedTopics = semMatchedTopics;
      } else {
        matchedTopics = lexicalOnlyTopics;
      }
    } else {
      matchedTopics = [...semMatchedTopics, ...lexicalOnlyTopics];
    }

    matchedTopics = filterContextualTopics(query, matchedTopics);

    const isMultiTopic = matchedTopics.length > 1;

    // Request conjunctions are residual boundaries; a payment followed by
    // recording that payment as an expense is factual context for the ask.
    const residualFragments = splitResidualFragments(qLower);
    const unresolvedTopics = residualFragments
      .filter(fragment => !isNegatedJournalDirectiveOnly(fragment))
      .filter((fragment) => fragment.length > 5 && !matchedTopics.some(topic =>
        !(topic.exclusionKeywords ?? []).some(keyword => fragment.includes(keyword.toLowerCase())) &&
        (topic.keywords.some(keyword => keywordMatches(fragment, keyword)) ||
          (topic.queryPatterns ?? []).some(pattern => new RegExp(pattern, 'i').test(fragment)))))
      .filter((fragment, index, fragments) => fragments.indexOf(fragment) === index);

    return {
      isMultiTopic,
      topics: matchedTopics,
      unresolvedTopics
    };
  }

  /**
   * Checks whether a chunk satisfies an identified topic.
   */
  public chunkMatchesTopic(chunkText: string, topic: QueryTopic): boolean {
    const textLower = chunkText.toLowerCase();
    return !(topic.exclusionKeywords ?? []).some((phrase) => textLower.includes(phrase.toLowerCase())) &&
      topic.keywords.some((kw) => keywordMatches(textLower, kw));
  }
}

function isNegatedJournalDirectiveOnly(fragment: string): boolean {
  return /^[\s\p{P}]*$/u.test(removeNegatedJournalDirectives(fragment));
}

const PRIMARY_REQUEST_START = /(?:^|[.!?;])\s*(?:(?:also|please)\s+)?(?:what|which|how|can|could|should|would|does|do|is|are|must|explain|determine|assess|evaluate|calculate|prepare|identify|list|whether|tell\s+me)\b/i;
const REQUEST_LANGUAGE = /\b(?:what|which|how|can|could|should|would|does|do|is|are|must|explain|determine|assess|evaluate|calculate|prepare|identify|list|whether|treatment|deductible|eligibility|reporting)\b/i;

function isPaymentRecordingFactJoin(query: string, index: number, separatorLength: number): boolean {
  const precedingBoundary = Math.max(
    query.lastIndexOf('.', index), query.lastIndexOf('?', index), query.lastIndexOf(';', index)
  );
  const followingBoundaryCandidates = ['.', '?', ';']
    .map(boundary => query.indexOf(boundary, index + separatorLength))
    .filter(boundary => boundary >= 0);
  const followingBoundary = followingBoundaryCandidates.length ? Math.min(...followingBoundaryCandidates) : query.length;
  const factualPayment = query.slice(precedingBoundary + 1, index);
  const factualRecording = query.slice(index + separatorLength, followingBoundary);

  return /\bpaid\b/i.test(factualPayment) &&
    /^\s*recorded\s+it\s+as\b[\s\S]*\bexpense\s*$/i.test(factualRecording) &&
    !REQUEST_LANGUAGE.test(factualPayment) && !REQUEST_LANGUAGE.test(factualRecording);
}

function splitResidualFragments(query: string): string[] {
  const fragments: string[] = [];
  const conjunction = /\band\b|\bas well as\b|\balso\b/g;
  let fragmentStart = 0;
  let hasRequestConjunction = false;
  for (const match of query.matchAll(conjunction)) {
    const index = match.index ?? 0;
    if (match[0] === 'and' && isPaymentRecordingFactJoin(query, index, match[0].length)) continue;
    fragments.push(query.slice(fragmentStart, index).trim());
    fragmentStart = index + match[0].length;
    hasRequestConjunction = true;
  }
  if (hasRequestConjunction) fragments.push(query.slice(fragmentStart).trim());

  // Preserve the factual lead-in and first ask for query-pattern matching;
  // every later punctuation-delimited clause is checked independently.
  const primaryRequest = PRIMARY_REQUEST_START.exec(query);
  if (primaryRequest) {
    const firstTerminator = /[.!?;](?=\s|$)/g;
    firstTerminator.lastIndex = (primaryRequest.index ?? 0) + primaryRequest[0].length;
    const requestEnd = firstTerminator.exec(query);
    if (requestEnd) {
      const suffix = query.slice(requestEnd.index + 1);
      fragments.push(...suffix.split(/[.!?;](?=\s|$)/).map(fragment => fragment.trim()).filter(Boolean));
    }
  }
  return fragments;
}

function keywordMatches(text: string, keyword: string): boolean {
  const normalizedKeyword = keyword.toLowerCase();
  // Statute section labels are identifiers: section 14 must not match
  // section 14N, which is a distinct Income Tax Act provision.
  if (normalizedKeyword === 'section 14') {
    return /\bsection\s+14\b/i.test(text);
  }
  // Short statutory acronyms are tokens, not substrings (e.g. ECI must not
  // match “specific”, NCI must not match “dependencies”, or AIS “raising”).
  if (/^[a-z0-9]{2,4}$/i.test(normalizedKeyword)) {
    const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
  }
  return text.includes(normalizedKeyword);
}

export const defaultQueryTopicResolver = new QueryTopicResolver();
