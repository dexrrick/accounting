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
import {
  hasNegatedCalculationOutput,
  removeNegatedJournalDirectives,
  removeNegatedOutputDirectives
} from '../utils/journalRequestIntent';

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

interface ResidualFragment {
  text: string;
  startIndex: number;
}

type ContinuationFacet =
  | 'definition'
  | 'coverage'
  | 'licensing_filing_requirement'
  | 'eligibility_limits'
  | 'restriction_exceptions';

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

    const topicQuery = removeNegatedOutputDirectives(query);
    const qLower = topicQuery.toLowerCase();
    const hasNegatedCpfRateCalculation = hasNegatedCalculationOutput(query, /\b(?:contribution\s+)?rates?\b/i);
    const asksOrdinaryWageDefinition = /\b(?:what\s+makes?|what\s+constitutes?|definition|defined|meaning|how\s+are)\b[\s\S]{0,60}\bordinary\s+wages?\b/i.test(topicQuery);
    const hasAffirmativeCpfRateRequest = (
      /\b(?:cpf|central provident fund)\b[\s\S]{0,180}\b(?:contribution\s+)?(?:rates?|amounts?|percentage|percent|how\s+much)\b/i.test(topicQuery) ||
      /\b(?:rates?|amounts?|percentage|percent|how\s+much)\b[\s\S]{0,180}\b(?:cpf|central provident fund)\b/i.test(topicQuery) ||
      /\bcontribution\s+rates?\b/i.test(topicQuery) && /\b(?:cpf|central provident fund)\b/i.test(topicQuery)
    );
    const hasAffirmativeCpfCalculationRequest = (
      /\b(?:calculate|compute|estimate|work\s+out|quantify)\b[\s\S]{0,100}\b(?:cpf|central provident fund)\b/i.test(topicQuery) ||
      /\b(?:cpf|central provident fund)\b[\s\S]{0,100}\b(?:calculate|compute|estimate|work\s+out|quantify)\b/i.test(topicQuery)
    );

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
        !(topic.id === 'cpf_contribution_rates' && hasNegatedCpfRateCalculation &&
          asksOrdinaryWageDefinition && !hasAffirmativeCpfRateRequest && !hasAffirmativeCpfCalculationRequest) &&
        (topic.keywords.some((kw) => keywordMatches(qLower, kw)) ||
          (topic.queryPatterns ?? []).some((pattern) => new RegExp(pattern, 'i').test(topicQuery)) ||
          topic.id === 'iras-individual-cpf-cash-top-up-relief' && isCashTopUpReliefRequest(topicQuery) ||
          topic.id === 'acra_annual-returns' && isBoundedAcraAnnualReturnMissingFactsQuestion(topicQuery));

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
    // Strip explicitly excluded outputs before splitting so the negation itself
    // cannot create an unresolved secondary request.
    const residualQuery = removeNegatedOutputDirectives(query.toLowerCase())
      .replace(/(^|[.!?;])\s*this\s+is\s+a\s+general\s+rules\s+question(?=\s*[.!?;]|$)/gi, '$1 ');
    const residualFragments = splitResidualFragments(residualQuery, matchedTopics.length > 0);
    const unresolvedFragments = residualFragments
      .filter(fragment => !isNegatedOutputDirectiveOnly(fragment.text))
      .filter(fragment => !isPurelyDeclarativeGeneralRulesContext(fragment.text))
      .filter(fragment => !(matchedTopics.some(topic => topic.id === 'acra_annual-returns') &&
        isBoundedAcraAnnualReturnContextFragment(fragment.text)))
      .filter(fragment => !isBoundedSameTopicContinuation(fragment, residualQuery, matchedTopics))
      .filter(fragment => fragment.text.length > 5 && !matchedTopics.some(topic =>
        topicMatchesResidualFragment(topic, fragment, residualQuery)));
    const unresolvedTopics = unresolvedFragments
      .map(fragment => fragment.text)
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

function isNegatedOutputDirectiveOnly(fragment: string): boolean {
  return /^[\s\p{P}]*$/u.test(removeNegatedOutputDirectives(fragment));
}

function isPurelyDeclarativeGeneralRulesContext(fragment: string): boolean {
  return /^(?:this\s+is\s+a\s+general\s+rules\s+question|explain\s+(?:only\s+)?the\s+(?:general\s+)?rule(?:\s+only)?)[\s\p{P}]*$/iu.test(fragment);
}

function isBoundedAcraAnnualReturnContextFragment(fragment: string): boolean {
  return /^\s*for\s+(?:a|the)\s+(?:(?:singapore(?:[\s-]+incorporated)?|singapore-incorporated)\s+)?(?:(?:non[\s-]?listed|unlisted|listed|private|public)\s+)?compan(?:y|ies)\s+(?:(?:with|and|that\s+has|which\s+has)\s+)?(?:(?:no|without|not\s+having|does\s+not\s+have|has\s+no)\s+)?(?:an?\s+|the\s+)?overseas\s+branch\s+register\s*$/i.test(fragment) ||
    /^\s*(?:show|give|provide)\s+(?:the\s+)?date\s+as\s+dd\s*\/\s*mm\s*\/\s*yyyy\s*$/i.test(fragment);
}

function classifyContinuationFacet(fragment: string): ContinuationFacet | undefined {
  const text = fragment.replace(/[\s\p{P}]+$/gu, '').trim();
  const explanatoryLead = /^(?:explain|outline|describe|summari[sz]e|state|set\s+out|identify)\b/i.test(text);

  if ((explanatoryLead && /\b(?:definition|meaning|what\s+makes?|test|criteria)\b/i.test(text)) ||
      /^(?:what\s+makes?|what\s+does)\b/i.test(text)) return 'definition';
  if ((explanatoryLead && /\b(?:coverage|covered|scope)\b/i.test(text)) ||
      /^(?:who|which\s+(?:employees|workers|people))\b[\s\S]{0,80}\bcovered\b/i.test(text)) return 'coverage';
  if (/^(?:when|under\s+what\s+circumstances)\s+(?:is|are|does|do)\s+it\s+(?:(?:generally|usually|normally)\s+)?(?:required|needed|necessary|due|filed)\b/i.test(text) ||
      (explanatoryLead && /\b(?:licen[cs]ing|filing)\s+(?:duty|obligation|requirement)\b/i.test(text)) ||
      /^(?:licen[cs]ing|filing)\s+(?:duty|obligation|requirement)\b/i.test(text)) return 'licensing_filing_requirement';
  if ((explanatoryLead && /\b(?:eligib\w*|qualif\w*|conditions?|limits?|caps?)\b/i.test(text)) ||
      /^(?:(?:relief|eligibility|contribution|claim)\s+)?(?:limits?|caps?|conditions?)\b/i.test(text)) return 'eligibility_limits';
  if ((explanatoryLead && /\b(?:restriction|exception|blocked|claimable)\b/i.test(text)) ||
      /^(?:relevant\s+)?(?:exceptions?|restrictions?)\b/i.test(text)) return 'restriction_exceptions';

  return undefined;
}

function getLocalAntecedentContext(query: string, startIndex: number): { previousClauses: string[]; currentPrefix: string; text: string } {
  const boundaries = [...query.matchAll(/[.!?;]/g)]
    .map(match => match.index ?? -1)
    .filter(index => index < startIndex);
  const previousBoundary = boundaries.at(-1) ?? -1;
  const earlierBoundary = boundaries.at(-2) ?? -1;
  const oldestBoundary = boundaries.at(-3) ?? -1;
  const currentClauseStart = previousBoundary + 1;
  const previousClause = previousBoundary >= 0
    ? query.slice(earlierBoundary + 1, previousBoundary).trim()
    : '';
  const precedingClause = earlierBoundary >= 0
    ? query.slice(oldestBoundary + 1, earlierBoundary).trim()
    : '';
  const currentPrefix = query.slice(currentClauseStart, startIndex).trim();
  const previousClauses = [precedingClause, previousClause].filter(Boolean);
  return { previousClauses, currentPrefix, text: [...previousClauses, currentPrefix].filter(Boolean).join(' ') };
}

function topicMatchesLocalContext(topic: QueryTopic, text: string): boolean {
  return Boolean(text) &&
    !(topic.exclusionKeywords ?? []).some(keyword => text.toLowerCase().includes(keyword.toLowerCase())) &&
    (topic.keywords.some(keyword => keywordMatches(text.toLowerCase(), keyword)) ||
      (topic.queryPatterns ?? []).some(pattern => new RegExp(pattern, 'i').test(text)));
}

function topicMatchesResidualFragment(topic: QueryTopic, fragment: ResidualFragment, query: string): boolean {
  const lowerFragment = fragment.text.toLowerCase();
  if (/^(?:(?:also|please)\s+)*(?:calculate|compute|estimate|work\s+out|quantify)\b/i.test(lowerFragment) ||
      /^(?:(?:also|please)\s+)*(?:prepare|create|make|generate|produce|provide|post|record|draft|show|include)\b[\s\S]{0,100}\b(?:journal(?:\s+entr(?:y|ies))?|accounting\s+entr(?:y|ies))\b/i.test(lowerFragment)) return false;
  const explanatoryLead = /^(?:explain|outline|describe|summari[sz]e|state|set\s+out|identify)\b/i.test(lowerFragment);
  if (explanatoryLead && classifyContinuationFacet(lowerFragment)) return false;
  if ((topic.exclusionKeywords ?? []).some(keyword => lowerFragment.includes(keyword.toLowerCase()))) return false;
  if (topic.keywords.some(keyword => keywordMatches(lowerFragment, keyword)) ||
      (topic.queryPatterns ?? []).some(pattern => new RegExp(pattern, 'i').test(lowerFragment))) return true;

  // A mixed question may place a concrete scenario fact in the immediately
  // preceding sentence and its recognized ask in the next one. Require both a
  // topic pattern over that local pair and a topic anchor in the ask itself so
  // earlier questions cannot absorb an unrelated residual.
  const genericTopicAnchors = new Set([
    'tax', 'income', 'company', 'companies', 'employee', 'employees', 'employer', 'employers',
    'business', 'businesses', 'rule', 'rules', 'general', 'treatment', 'requirement', 'requirements',
    'condition', 'conditions', 'claim', 'claims', 'reporting', 'obligation', 'obligations'
  ]);
  const topicAnchors = topic.keywords.flatMap(keyword => keyword.split(/[\s-]+/))
    .filter(anchor => anchor.length >= 3 && !genericTopicAnchors.has(anchor));
  if (!topicAnchors.some(anchor => keywordMatches(lowerFragment, anchor))) return false;

  const localContext = getLocalAntecedentContext(query, fragment.startIndex);
  const pairedText = `${localContext.text} ${lowerFragment}`.trim();
  return (topic.queryPatterns ?? []).some(pattern => new RegExp(pattern, 'i').test(pairedText));
}

function localContextSupportsFacet(facet: ContinuationFacet, text: string): boolean {
  switch (facet) {
    case 'definition':
      return /\b(?:definition|meaning|what\s+makes?|what\s+defines?|constitutes?|criteria|test|tax\s+resident)\b/i.test(text);
    case 'coverage':
      return /\b(?:coverage|covered|part\s+iv|employees?|workers?)\b/i.test(text);
    case 'licensing_filing_requirement':
      return /\b(?:licen[cs]e|licen[cs]ing|annual\s+returns?|filing|file|due|required)\b/i.test(text);
    case 'eligibility_limits':
      return /\b(?:eligib\w*|qualif\w*|relief|top[- ]?ups?|limit|cap|conditions?)\b/i.test(text);
    case 'restriction_exceptions':
      return /\b(?:restriction|exception|blocked|claimable|input\s+tax|passenger\s+(?:motor\s+)?car)\b/i.test(text);
  }
}

function isTypedContinuationClause(fragment: string, facet: ContinuationFacet): boolean {
  const text = fragment.replace(/[\s\p{P}]+$/gu, '').trim().toLowerCase();
  const withoutSourceSuffix = text.replace(/\s+using\s+official(?:\s+[a-z]+){0,3}\s+guidance$/i, '').trim();
  const pairedLicensingContinuation = withoutSourceSuffix.match(
    /^(when|under\s+what\s+circumstances)\s+(?:is|are|does|do)\s+it\s+(?:(?:generally|usually|normally)\s+)?(?:required|needed|necessary|due|filed)\?\s*(explain|outline|describe|summari[sz]e|state|set\s+out|identify)\s+(?:the\s+)?general\s+licen[cs]ing\s+(?:duty|obligation|requirement)$/i
  );
  if (facet === 'licensing_filing_requirement' && pairedLicensingContinuation) {
    return isTypedContinuationClause(pairedLicensingContinuation[0].split('?')[0], facet) &&
      isTypedContinuationClause(pairedLicensingContinuation[0].slice(pairedLicensingContinuation[0].indexOf('?') + 1).trim(), facet);
  }
  const anaphoricPhrase = facet === 'licensing_filing_requirement'
    ? /^(?:when|under what circumstances)\s+(?:is|are|does|do)\s+it\s+(?:(?:generally|usually|normally)\s+)?(?:required|needed|necessary|due|filed)$/i.test(withoutSourceSuffix)
    : facet === 'eligibility_limits'
      ? /^(?:(?:general|eligibility|relief|tax|claim|contribution)\s+)*(?:limits?|caps?|conditions?)$/i.test(withoutSourceSuffix)
      : facet === 'restriction_exceptions'
        ? /^(?:(?:relevant|applicable|general|input\s+tax)\s+)*(?:exceptions?|restrictions?)$/i.test(withoutSourceSuffix)
        : false;
  if (anaphoricPhrase) return true;

  const lead = /^(?:explain|outline|describe|summari[sz]e|state|set\s+out|identify)\s+/i;
  if (!lead.test(withoutSourceSuffix)) return false;
  const words = withoutSourceSuffix.replace(lead, '').match(/[a-z]+/gi) ?? [];
  if (!words.length) return false;

  const allowedWords: Record<ContinuationFacet, Set<string>> = {
    definition: new Set('the a an of for using general definition meaning test criteria control and management what makes constitute ordinary wage wages acra cpf board mom mas iras official guidance'.split(' ')),
    coverage: new Set('the a an of for and using general coverage covered scope employee employees worker workers part iv overtime hours acra cpf board mom mas iras official guidance'.split(' ')),
    licensing_filing_requirement: new Set('the a an of for and using general licensing license licence filing file annual return returns duty obligation requirement required due deadline acra cpf board mom mas iras official guidance'.split(' ')),
    eligibility_limits: new Set('the a an of for and using general eligibility eligible condition conditions requirement requirements qualify qualifies limit limits maximum max cap caps relief tax topup topups cash cpf special account retirement contribution claim iras official guidance'.split(' ')),
    restriction_exceptions: new Set('the a an of for and using general restriction restrictions exception exceptions relevant applicable blocked claimable input tax private passenger motor car iras official guidance'.split(' '))
  };
  return words.every(word => allowedWords[facet].has(word.toLowerCase()));
}

function isPartOfTypedContinuationClause(query: string, index: number, conjunctionLength: number): boolean {
  const precedingBoundary = Math.max(
    query.lastIndexOf('.', index), query.lastIndexOf('?', index), query.lastIndexOf(';', index)
  );
  const followingBoundaryCandidates = ['.', '?', ';']
    .map(boundary => query.indexOf(boundary, index + conjunctionLength))
    .filter(boundary => boundary >= 0);
  const followingBoundary = followingBoundaryCandidates.length ? Math.min(...followingBoundaryCandidates) : query.length;
  const clause = query.slice(precedingBoundary + 1, followingBoundary).trim();
  const facet = classifyContinuationFacet(clause);
  return Boolean(facet && isTypedContinuationClause(clause, facet));
}

function declaredContinuationAuthority(fragment: string): string | undefined {
  const match = fragment.match(/\busing\s+(?:official\s+)?(acra|cpf(?:\s+board)?|mom|mas|iras)\s+guidance\b/i);
  return match?.[1].toLowerCase().replace(/\s+/g, ' ');
}

function declaredAntecedentAuthority(fragment: string): string | undefined {
  const match = fragment.match(/\b(?:under|according\s+to)\s+(?:official\s+)?(acra|cpf(?:\s+board)?|mom|mas|iras)\s+(?:guidance|rules)\b/i);
  return match ? normalizeAgency(match[1]) : undefined;
}

function normalizeAgency(agency: string): string {
  const normalized = agency.toLowerCase().replace(/\s+/g, ' ').trim();
  return normalized === 'cpf' || normalized === 'cpf board' ? 'CPF_BOARD' : normalized.toUpperCase();
}

function continuationAuthorityCompatible(
  fragment: string,
  antecedent: string,
  localTopics: readonly QueryTopic[]
): boolean {
  const source = declaredContinuationAuthority(fragment);
  const continuationAuthority = source ? normalizeAgency(source) : undefined;
  const antecedentAuthority = declaredAntecedentAuthority(antecedent);
  if (!continuationAuthority) return true;
  if (antecedentAuthority && continuationAuthority !== antecedentAuthority) return false;
  const localAuthorities = localTopics.flatMap(topic => topic.authorities.map(normalizeAgency));
  return !localAuthorities.length || localAuthorities.includes(continuationAuthority);
}

function continuationObjectsFitLocalTopics(fragment: string, topics: readonly QueryTopic[], localSubject: string): boolean {
  const withoutLeadOrSource = fragment.toLowerCase()
    .replace(/^(?:explain|outline|describe|summari[sz]e|state|set\s+out|identify)\s+/i, '')
    .replace(/\s+using\s+(?:official\s+)?(?:acra|cpf(?:\s+board)?|mom|mas|iras)\s+guidance\b/i, ' ');
  const genericTerms = new Set([
    'the', 'a', 'an', 'of', 'for', 'and', 'to', 'using', 'official', 'guidance',
    'explain', 'outline', 'describe', 'summarize', 'summarise', 'state', 'set', 'out', 'identify', 'when', 'under',
    'what', 'circumstance', 'circumstances', 'is', 'are', 'does', 'do', 'it', 'generally', 'usually', 'normally', 'needed', 'necessary',
    'general', 'definition', 'meaning', 'test', 'criteria', 'makes', 'constitute', 'coverage', 'covered', 'scope',
    'licensing', 'filing', 'file', 'duty', 'obligation', 'requirement', 'required', 'due', 'deadline', 'eligibility',
    'eligible', 'condition', 'conditions', 'qualify', 'qualifies', 'limit', 'limits', 'maximum', 'max', 'cap', 'caps',
    'restriction', 'restrictions', 'exception', 'exceptions', 'relevant', 'applicable', 'blocked', 'claimable', 'filed'
  ]);
  const normalizeTerm = (term: string): string => term.endsWith('ies')
    ? `${term.slice(0, -3)}y`
    : term.length > 3 && term.endsWith('s') && !term.endsWith('ss') ? term.slice(0, -1) : term;
  const contentAnchors = (withoutLeadOrSource.match(/[a-z]+/g) ?? [])
    .map(normalizeTerm)
    .filter(term => !genericTerms.has(term));
  if (!contentAnchors.length) return true;
  const localSubjectTokens = new Set((localSubject.toLowerCase().match(/[a-z]+/g) ?? []).map(normalizeTerm));
  if (contentAnchors.every(anchor => localSubjectTokens.has(anchor))) return true;

  const topicTokenSets = topics.map(topic => {
    const coverageRow = SINGAPORE_COVERAGE_REGISTRY.find(row => row.id === topic.id);
    const metadata = `${topic.id} ${topic.name} ${topic.canonicalConceptId ?? ''} ${topic.domainId} ${topic.keywords.join(' ')} ${(coverageRow?.paragraphHints ?? []).join(' ')}`;
    return new Set((metadata.toLowerCase().match(/[a-z]+/g) ?? []).map(normalizeTerm));
  });
  if (topicTokenSets.some(tokens => contentAnchors.every(anchor => tokens.has(anchor)))) return true;
  return false;
}

function isBoundedSameTopicContinuation(
  fragment: ResidualFragment,
  query: string,
  topics: readonly QueryTopic[]
): boolean {
  const facet = classifyContinuationFacet(fragment.text);
  if (!facet || !isTypedContinuationClause(fragment.text, facet)) return false;

  const localContext = getLocalAntecedentContext(query, fragment.startIndex);
  if (!localContext.text) return false;

  const questionHead = /\b(?:what|which|who|how|can|could|is|are|must|whether)\b/i;
  const explanatoryLead = /^(?:explain|outline|describe|summari[sz]e|state|set\s+out|identify)\b/i;
  const currentPrefixIsQuestion = questionHead.test(localContext.currentPrefix) &&
    !explanatoryLead.test(localContext.currentPrefix);

  if (currentPrefixIsQuestion) {
    const compatibleTopics = topics.filter(topic => topicMatchesLocalContext(topic, localContext.currentPrefix));
    // Topic registries can contain overlapping entries for one agency issue;
    // the antecedent is the single local request clause, not a single registry row.
    return compatibleTopics.length > 0 &&
      continuationObjectsFitLocalTopics(fragment.text, compatibleTopics, localContext.currentPrefix) &&
      continuationAuthorityCompatible(fragment.text, localContext.currentPrefix, compatibleTopics) &&
      localContextSupportsFacet(facet, localContext.currentPrefix);
  }

  const compatibleQuestionClauses = localContext.previousClauses
    .map((clause, index) => ({ clause, index }))
    .filter(entry => questionHead.test(entry.clause) &&
      topics.some(topic => topicMatchesLocalContext(topic,
        [localContext.previousClauses[entry.index - 1], entry.clause].filter(Boolean).join(' '))));
  if (compatibleQuestionClauses.length !== 1) return false;
  const nearestQuestionIndex = compatibleQuestionClauses[0];

  const antecedentClauses = [
    localContext.previousClauses[nearestQuestionIndex.index - 1],
    nearestQuestionIndex.clause
  ].filter((clause): clause is string => Boolean(clause));
  const antecedentText = antecedentClauses.join(' ');
  const compatibleTopics = topics.filter(topic => topicMatchesLocalContext(topic, antecedentText));
  return compatibleTopics.length > 0 &&
    continuationObjectsFitLocalTopics(fragment.text, compatibleTopics, antecedentText) &&
    continuationAuthorityCompatible(fragment.text, antecedentText, compatibleTopics) &&
    localContextSupportsFacet(facet, antecedentText);
}

const PRIMARY_REQUEST_START = /(?:^|[.!?,;])\s*(?:(?:also|please)\s+)?(?:what|which|how|can|could|should|would|does|do|is|are|must|explain|determine|assess|evaluate|calculate|prepare|identify|list|whether|tell\s+me)\b/i;
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

function splitResidualFragments(query: string, hasMatchedTopics: boolean): ResidualFragment[] {
  const fragments: ResidualFragment[] = [];
  const pushFragment = (startIndex: number, endIndex: number): void => {
    const raw = query.slice(startIndex, endIndex);
    const text = raw.trim();
    if (!text) return;
    fragments.push({ text, startIndex: startIndex + raw.indexOf(text) });
  };
  const conjunction = /\band\b|\bas well as\b|\balso\b|\bbut\b/g;
  let fragmentStart = 0;
  let hasRequestConjunction = false;
  for (const match of query.matchAll(conjunction)) {
    const index = match.index ?? 0;
    if (match[0] === 'and' && isHyphenatedLexicalConjunction(query, index, match[0].length)) continue;
    if (match[0] === 'and' && isPartOfTypedContinuationClause(query, index, match[0].length)) continue;
    if (match[0] === 'and' && isPaymentRecordingFactJoin(query, index, match[0].length)) continue;
    pushFragment(fragmentStart, index);
    fragmentStart = index + match[0].length;
    hasRequestConjunction = true;
  }
  if (hasRequestConjunction) pushFragment(fragmentStart, query.length);

  // Keep explicit request clauses available for residual classification. This
  // also preserves a genuine question that follows an excluded-output sentence;
  // recognized main asks and bounded same-topic explanations are filtered by
  // the caller after this split.
  const requestPattern = new RegExp(PRIMARY_REQUEST_START.source, 'gi');
  const requestMatches = [...query.matchAll(requestPattern)];
  const relevantRequestMatches = requestMatches.length > 1
    ? requestMatches.slice(1)
    : requestMatches.length === 1 && !hasMatchedTopics ? requestMatches : [];
  for (const match of relevantRequestMatches) {
    const matchText = match[0];
    const requestText = matchText.replace(/^[\s.!?,;]+/u, '').trim();
    if (!requestText) continue;
    const requestStart = (match.index ?? 0) + matchText.indexOf(requestText);
    const clauseEnd = /[.!?;](?=\s|$)/g;
    clauseEnd.lastIndex = requestStart + requestText.length;
    const terminator = clauseEnd.exec(query);
    pushFragment(requestStart, terminator?.index ?? query.length);
  }

  // Preserve the factual lead-in and first ask for query-pattern matching;
  // every later punctuation-delimited clause is checked independently.
  const primaryRequest = PRIMARY_REQUEST_START.exec(query);
  if (primaryRequest) {
    const firstTerminator = /[.!?;](?=\s|$)/g;
    firstTerminator.lastIndex = (primaryRequest.index ?? 0) + primaryRequest[0].length;
    const requestEnd = firstTerminator.exec(query);
    if (requestEnd) {
      const suffixStart = requestEnd.index + 1;
      const suffix = query.slice(suffixStart);
      const suffixBoundaries = /[.!?;](?=\s|$)/g;
      let fragmentStart = suffixStart;
      for (const boundary of suffix.matchAll(suffixBoundaries)) {
        const boundaryIndex = suffixStart + (boundary.index ?? 0);
        pushFragment(fragmentStart, boundaryIndex);
        fragmentStart = boundaryIndex + 1;
      }
      pushFragment(fragmentStart, query.length);
    }
  }
  return fragments;
}

function isHyphenatedLexicalConjunction(query: string, index: number, conjunctionLength: number): boolean {
  return query[index - 1] === '-' && query[index + conjunctionLength] === '-';
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
