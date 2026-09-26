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
          (topic.queryPatterns ?? []).some((pattern) => new RegExp(pattern, 'i').test(query)));

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

    const isMultiTopic = matchedTopics.length > 1;

    // Detect if query asked about multiple questions via conjunctions (e.g. "and", "as well as", "plus")
    const unresolvedTopics: string[] = [];
    if (qLower.includes(' and ') || qLower.includes(' as well as ') || qLower.includes(' also ')) {
      const parts = qLower.split(/\band\b|\bas well as\b|\balso\b/);
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.length > 5) {
          const partMatched = matchedTopics.some((t) =>
            t.keywords.some((kw) => trimmed.includes(kw))
          );
          if (!partMatched) {
            unresolvedTopics.push(trimmed);
          }
        }
      }
    }

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
