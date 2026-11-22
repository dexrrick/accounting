import type { AccountingScenarioState } from '../types/accounting';
import type { ChatMessage } from '../types/accounting';
import type { ConversationAccountingContext } from '../types/conversationState';
import { isSingleMonthlySalaryAmendment, resolveFactAmendment } from './factAmendmentService';

export type ConversationRelation = 'RELATED' | 'NEW' | 'AMBIGUOUS';

/** A journal-display request reads an existing result and should not be routed as a transaction. */
export function isJournalDisplayRequest(query: string): boolean {
  return /^\s*(?:(?:where(?:\s+is|\s*'s)|what(?:\s+is|\s*'s))\s+(?:your\s+|the\s+|last\s+)?(?:double\s+entry|journal(?:\s+entry)?)|(?:show|repeat|display|give(?:\s+me)?|provide)\s+(?:(?:me\s+)?|your\s+|the\s+|last\s+)?(?:double\s+entry|journal(?:\s+entry)?))\s*\?*\s*$/i.test(query);
}

const DISCOURSE_SUBJECT_NOUNS = '(?:facts?|details?|scenario|scenarios|situation|situations|case|cases|example|examples|calculation|calculations|journal|journals|entry|entries|answer|discussion|conversation|analysis)';
const ACCOUNTING_SUBJECT_NOUNS = '(?:transaction|expense|purchase|supply|invoice|amount|asset|equipment|machine|machinery|laptop|computer|software|licen[cs]e|subscription|vehicle|salary|payroll|employee|worker|staff|payment|contract|lease|arrangement|deadline|rate)';
export const PRIOR_SUBJECT_NOUNS = `(?:${DISCOURSE_SUBJECT_NOUNS}|${ACCOUNTING_SUBJECT_NOUNS}|transactions|expenses|purchases|supplies|invoices|amounts|assets|laptops|computers|licen[cs]es|subscriptions|vehicles|salaries|employees|workers|payments|contracts|leases|arrangements|deadlines|rates)`;

const MONTH_NAMES_SOURCE = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec';
const PERIOD_UNIT_LOOKAHEAD_WORDS = 'year|years|period|periods|month|months|quarter|quarters|week|weeks|day|days|decade|decades|half|halves|semester|semesters|trimester|trimesters|season|seasons|fy|ya|q[1-4]|h[1-2]';
const EXCLUDED_PRIOR_MODIFIER_WORDS =
  `${MONTH_NAMES_SOURCE}|${PERIOD_UNIT_LOOKAHEAD_WORDS}|` +
  'annual|annually|yearly|quarterly|weekly|daily|interim|opening|closing|historical|historic|past';

export const PRIOR_ADJECTIVE_MODIFIER = `(?:(?!(?:${EXCLUDED_PRIOR_MODIFIER_WORDS})\\b)[a-z]+\\s+){0,2}`;
export const HISTORICAL_PERIOD_QUALIFIER_LOOKAHEAD =
  `(?!\\s+(?:${PERIOD_UNIT_LOOKAHEAD_WORDS})\\b)` +
  `(?!(?:\\s+${PRIOR_SUBJECT_NOUNS}){0,2}(?:\\s+(?:incurred|paid|accrued|billed|invoiced|recorded|recognised|recognized|claimed|deducted|disallowed|allowed|exempted|assessed|granted|applied|made|earned|received|arising))?\\s+(?:for|in|from|during|of|under)\\s+(?:the\\s+)?(?:ya\\s*\\d{4}|fy\\s*\\d{4}|ya|fy|year\\s+of\\s+assessment|financial\\s+year|tax\\s+year|calendar\\s+year|q[1-4](?:\\s*\\d{4})?|h[1-2](?:\\s*\\d{4})?|(?:${MONTH_NAMES_SOURCE})(?:\\s+\\d{4})?|(?:month|quarter|year|period)\\s+of\\s+[a-z]+|(?:prior|previous|earlier|preceding|last)\\s+(?:years?|periods?|months?|quarters?|weeks?)|\\d{4})\\b)`;
const PRIOR_MODIFIER_ADJECTIVE_SUBJECT_SOURCE =
  `(?:` +
    `(?:(?:the|our|my|this|that|these|those)\\s+)?(?:earlier|previous|prior|last|preceding)\\s+${PRIOR_ADJECTIVE_MODIFIER}${DISCOURSE_SUBJECT_NOUNS}|` +
    `(?:the|our|my|this|that|these|those)\\s+(?:earlier|previous|prior|last|preceding)\\s+${PRIOR_ADJECTIVE_MODIFIER}${PRIOR_SUBJECT_NOUNS}` +
  `)\\b${HISTORICAL_PERIOD_QUALIFIER_LOOKAHEAD}`;
export const EXPLICIT_ADJECTIVE_SUBJECT_SOURCE =
  `(?:` +
    `(?:(?:the|our|my|this|that|these|those)\\s+)?(?:above|foregoing|aforementioned)\\s+${PRIOR_ADJECTIVE_MODIFIER}${PRIOR_SUBJECT_NOUNS}\\b${HISTORICAL_PERIOD_QUALIFIER_LOOKAHEAD}|` +
    `${PRIOR_MODIFIER_ADJECTIVE_SUBJECT_SOURCE}` +
  `)`;
export const SUBJECT_DISCUSSION_CLAUSE_SOURCE = `(?:the|our|my|this|that|these|those)\\s+(?:[a-z]+\\s+){0,2}${PRIOR_SUBJECT_NOUNS}\\s+(?:(?:that|which|whom|who)\\s+)?(?:(?:we|you|i)\\s+(?:just\\s+|earlier\\s+|previously\\s+)?(?:discussed|mentioned|described|covered|talked\\s+about|referred\\s+to|looked\\s+at|used|gave|calculated|established)|(?:was|were)\\s+(?:just\\s+|earlier\\s+|previously\\s+)?(?:discussed|mentioned|described|covered|provided|stated|established)\\b|(?:discussed|mentioned|described|provided|stated|noted|shown)\\s+(?:above|earlier|before|previously)\\b${HISTORICAL_PERIOD_QUALIFIER_LOOKAHEAD}|(?:above(?!\\s+(?:sgd|usd|eur|s\\$|\\$|\\d|the\\s+(?:[a-z]+\\s+)?(?:ceiling|limit|threshold|cap|rate|amount))\\b)|(?:previously|earlier)(?!\\s+(?:this|last|next|in|for|from|during|under|incurred|paid|accrued|billed|invoiced|recorded|recognised|recognized|claimed|deducted|disallowed|allowed|exempted|assessed|granted|applied|made|earned|received)\\b))\\b)`;

const SUBJECT_DOMAIN_PATTERNS: ReadonlyArray<{ domain: string; pattern: RegExp }> = [
  { domain: 'payroll', pattern: /\b(?:payroll|salar(?:y|ies)|wages?|cpf|employee|employees|worker|workers|staff|bonus(?:es)?|resignation)\b/i },
  { domain: 'asset_purchase', pattern: /\b(?:machines?|machinery|equipment|asset\s+purchase|capital\s+expenditure|ppe|property,\s*plant\s+and\s+equipment|(?:fixed|tangible)\s+assets?|computers?|laptops?|servers?|printers?|furniture|fixtures?)\b/i },
  { domain: 'intangible_asset', pattern: /\b(?:software|licen[cs]es?|subscriptions?|intangible\s+assets?|patents?|trademarks?|copyrights?)\b/i },
  { domain: 'vehicle', pattern: /\b(?:car|cars|vehicle|vehicles|motor\s+car|motor\s+vehicle|s[- ]?plate)\b/i },
  { domain: 'lease', pattern: /\b(?:lease|leases|leased|leasing|rou|right[- ]of[- ]use|rental|rent(?:ed|ing)?)\b/i },
  { domain: 'share_capital', pattern: /\b(?:share\s+capital|shareholders?|subscribers?|allotment|ordinary\s+shares?|own\s+shares?)\b/i },
  { domain: 'equity_investment', pattern: /\b(?:apple|aapl|tesla|tsla|microsoft|fvoci|fvtpl|amortised\s+cost|amortized\s+cost|equity\s+investment|foreign\s+shares?)\b/i },
  { domain: 'director_fine', pattern: /\b(?:fine|fines|penalt(?:y|ies)|traffic\s+offence)\b/i },
  { domain: 'trade_payable_receivable', pattern: /\b(?:suppliers?|vendors?|customers?|clients?|invoices?|bills?|(?:trade\s+)?payables?|(?:trade\s+)?receivables?|creditors?|debtors?|consulting|legal\s+fees?|audit\s+fees?)\b/i },
  { domain: 'financing', pattern: /\b(?:loans?|borrowings?|interest\s+expense|overdrafts?|debentures?)\b/i },
  { domain: 'inventory', pattern: /\b(?:inventor(?:y|ies)|merchandise|stock\s+purchase)\b/i },
  { domain: 'property', pattern: /\b(?:premises|office\s+space|warehouse|commercial\s+property|renovation|refurbishment)\b/i }
];

const TRANSACTION_TYPE_DOMAIN_MAP: Readonly<Record<string, string>> = {
  payroll_payment: 'payroll',
  asset_purchase: 'asset_purchase',
  trade_discount_purchase: 'asset_purchase',
  lease_contract: 'lease',
  lease_payment: 'lease',
  share_capital_issuance: 'share_capital',
  capital_reduction: 'share_capital',
  equity_investment_acquisition: 'equity_investment'
};

/** Extracts normalized accounting subject domains mentioned in free-form text. */
export function extractSubjectDomains(text: string): Set<string> {
  const domains = new Set<string>();
  for (const { domain, pattern } of SUBJECT_DOMAIN_PATTERNS) {
    if (pattern.test(text)) domains.add(domain);
  }
  return domains;
}

function resolveHeadNounDomains(phrase: string): Set<string> {
  const domains = extractSubjectDomains(phrase);
  if (domains.has('lease')) return new Set(['lease']);
  if (domains.has('intangible_asset')) return new Set(['intangible_asset']);
  if (domains.has('asset_purchase') || domains.has('vehicle')) {
    domains.delete('payroll');
  }
  return domains;
}

function hasDomainOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const domain of a) {
    if (b.has(domain)) return true;
  }
  return false;
}

function extractDescriptiveDomains(text: string): Set<string> {
  const domains = new Set<string>();
  for (const rawSegment of text.split(/[.!?;\n]+|(?<!\d),(?!\d)|\b(?:and|&)\b/i)) {
    const segment = rawSegment.trim();
    if (!segment) continue;
    const { transactionActions } = analyzeTransactionActions(segment.toLowerCase());
    if (transactionActions.length > 0) {
      for (const action of transactionActions) {
        for (const domain of action.domains) domains.add(domain);
      }
    } else {
      for (const domain of resolveHeadNounDomains(segment)) domains.add(domain);
    }
  }
  return domains;
}

/** Resolves the active accounting domains for the current scenario and context. */
export function resolveActiveScenarioDomains(
  currentScenario?: AccountingScenarioState | null,
  context?: ConversationAccountingContext
): Set<string> {
  const domains = new Set<string>();
  const transactionTypes = [
    context?.underlyingTransaction?.type,
    currentScenario?.semanticUnderstanding?.transactionType
  ];
  for (const txType of transactionTypes) {
    if (txType && TRANSACTION_TYPE_DOMAIN_MAP[txType]) {
      domains.add(TRANSACTION_TYPE_DOMAIN_MAP[txType]);
    }
  }

  for (const tag of [currentScenario?.scenarioType, currentScenario?.primaryDomain]) {
    if (!tag) continue;
    if (tag === 'PAYROLL_CPF_SALARY' || tag === 'CPF_BOARD' || tag === 'MOM_EMPLOYMENT') {
      domains.add('payroll');
    } else if (tag === 'PPE_ASSET_PURCHASE' || tag === 'BUSINESS_EQUIPMENT_ACQUISITION' ||
      tag === 'ASSET_PURCHASE_DISCOUNT' || tag === 'CAPITALISATION_THRESHOLD' || tag.startsWith('PPE_')) {
      domains.add('asset_purchase');
    } else if (tag.startsWith('SHARE_CAPITAL')) {
      domains.add('share_capital');
    } else if (tag === 'EQUITY_INVESTMENT_FX') {
      domains.add('equity_investment');
    } else if (tag.startsWith('LEASE_')) {
      domains.add('lease');
    } else if (tag === 'DIRECTOR_PERSONAL_FINE') {
      domains.add('director_fine');
    } else if (/(?:INVOICE|PAYABLE|RECEIVABLE|SUPPLIER|CUSTOMER)/.test(tag)) {
      domains.add('trade_payable_receivable');
    }
  }

  const isUnclassifiedStub = currentScenario?.scenarioType === 'UNRECOGNIZED' && !currentScenario.rawQuery?.trim();
  const descriptiveFields = [
    context?.underlyingTransaction?.subject,
    isUnclassifiedStub ? undefined : currentScenario?.transactionTitle,
    currentScenario?.rawQuery
  ];
  for (const field of descriptiveFields) {
    if (!field) continue;
    for (const domain of extractDescriptiveDomains(field)) {
      domains.add(domain);
    }
  }
  return domains;
}

function getPriorModifierMatches(text: string): Array<{ phrase: string; index: number }> {
  const priorModifierPattern = new RegExp(`\\b${PRIOR_MODIFIER_ADJECTIVE_SUBJECT_SOURCE}`, 'gi');
  const discussionClausePattern = new RegExp(`\\b${SUBJECT_DISCUSSION_CLAUSE_SOURCE}`, 'gi');
  const discussionRanges = [...text.matchAll(discussionClausePattern)].map(match => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length
  }));
  return [...text.matchAll(priorModifierPattern)]
    .map(match => ({ phrase: match[0], index: match.index ?? 0 }))
    .filter(({ index, phrase }) => {
      const end = index + phrase.length;
      return !discussionRanges.some(range => index >= range.start && end <= range.end);
    });
}

/**
 * Detects whether a query's prior-modifier subject phrase (e.g. "our previous car rental expense")
 * refers to an accounting domain disjoint from the active scenario.
 */
export function hasConflictingPriorSubject(
  text: string,
  currentScenario?: AccountingScenarioState | null
): boolean {
  const activeDomains = resolveActiveScenarioDomains(currentScenario);
  if (activeDomains.size === 0) return false;
  return getPriorModifierMatches(text).some(({ phrase }) => {
    const phraseDomains = resolveHeadNounDomains(phrase);
    return phraseDomains.size > 0 && !hasDomainOverlap(phraseDomains, activeDomains);
  });
}

const CLAUSE_NEGATION_PATTERN =
  /\b(?:not|never|no|nobody|none|neither|nor|without|[a-z]+n['’]?t|cannot|can['’]?t|dont|doesnt|didnt|wont|wouldnt|shouldnt|couldnt|isnt|arent|wasnt|werent|havent|hasnt|hadnt)\b/i;

function hasNegationInClausePrefix(prefix: string): boolean {
  return CLAUSE_NEGATION_PATTERN.test(prefix);
}

function isActionVerbNegated(normalizedActionLead: string): boolean {
  const localClause = normalizedActionLead
    .split(/[,;:]|\b(?:and|but|yet|however|instead|whereas|when|while|before|after|until|once)\b/i)
    .at(-1) ?? '';
  if (!hasNegationInClausePrefix(localClause)) return false;

  const subjectMatches = [...localClause.matchAll(/\b(?:i|we|you|they|he|she|it|the\s+company|our\s+company)\b/gi)];
  if (subjectMatches.length > 0) {
    const lastSubject = subjectMatches[subjectMatches.length - 1];
    const lastSubjectIndex = lastSubject.index ?? 0;
    const afterLastSubject = localClause.slice(lastSubjectIndex + lastSubject[0].length);
    if (hasNegationInClausePrefix(afterLastSubject)) return true;

    const beforeLastSubject = localClause.slice(0, lastSubjectIndex);
    return /\b(?:not|never|[a-z]+n['’]?t|cannot|can['’]?t|dont|doesnt|didnt|wont|wouldnt|shouldnt|couldnt|isnt|arent|wasnt|werent|havent|hasnt|hadnt)\b[^,;:]*\b(?:that|say|said|claim|claimed|mean|meant|imply|implied|suggest|suggested|assume|assumed|think|thought|believe|believed)\s+(?:that\s+)?$/i.test(beforeLastSubject);
  }

  return !/^\s*without\s+(?:a|an|the|any|our|their|his|her|its)?\s*[a-z]+\b/i.test(localClause);
}

/** Detects an affirmative instruction to ignore, disregard, or forget prior conversation context. */
export function hasAffirmativeResetDirective(query: string): boolean {
  const withoutQuotedSpans = query
    .replace(/"[^"\r\n]*"|“[^”\r\n]*”|‘[^’\r\n]*’/g, ' ')
    .replace(/(?:^|(?<=[\s([{,:;-]))'(?:[^'\r\n]|'(?=[a-z]))*'(?=$|[\s.,!?;:)\]}])/gi, ' ');
  const collapsedCoordinatedVerbs = withoutQuotedSpans.replace(
    /\b(?:ignore|disregard|forget|omit|drop|discard)(?:\s*,\s*(?:ignore|disregard|forget|omit|drop|discard))*(?:\s*,?\s*(?:or|nor|and)\s+(?:ignore|disregard|forget|omit|drop|discard))+\b/gi,
    'forget'
  );
  const directivePattern = /\b(ignore|disregard|forget)\b[^.!?]{0,100}\b(?:earlier|previous|prior|above|last|case|scenario|situation|question|context|transaction|example|employee|employees|worker|workers|staff|discussion|analysis|discussed|mentioned|that|this|these|those)\b/gi;
  const postDirectiveConditionalPattern =
    /\b(?:if|unless|provided(?:\s+that)?|assuming(?:\s+that)?|in\s+case|on\s+condition(?:\s+that)?|as\s+long\s+as|so\s+long\s+as)\b|,\s*\b(?:when|where)\b|\b(?:when|where)\s+(?:it|that|this|they|those|these)\s+(?:is|are|isn['’]?t|aren['’]?t|does|do|doesn['’]?t|don['’]?t|seems?|appears?|turns?\s+out|proves?|happens?|becomes?|may|might|could|would|should)\b|\b(?:should|were)\s+(?:it|that|this|they|those|these)\b/i;
  for (const match of collapsedCoordinatedVerbs.matchAll(directivePattern)) {
    const matchIndex = match.index ?? 0;
    const verbEndIndex = matchIndex + match[1].length;
    const sentencePrefix = collapsedCoordinatedVerbs.slice(0, matchIndex).split(/(?<!\d)[.!?;](?!\d)/).at(-1) ?? '';
    const sentenceSuffix = collapsedCoordinatedVerbs.slice(verbEndIndex).split(/(?<!\d)[.!?;](?!\d)/, 1)[0] ?? '';
    const resetClauseSuffix = sentenceSuffix.split(
      /,?\s*\b(?:and|then)\s+(?:please\s+)?(?:tell|explain|show|calculate|compute|check|let|start|answer|what|how|which|who|when|where|why|can|could|would|should|does|do|did|is|are)\b|,\s*\b(?:what|how|which|who|why|can|could|would|should|does|do|did|is|are)\b/i,
      1
    )[0] ?? '';
    if (/\b(?:if|unless|when|where|suppose|assuming|provided|in\s+case)\b/i.test(sentencePrefix) ||
        /(?:^|[,;:]\s*)\b(?:should|were|can|could|would|may|might|shall|do|does|did)\s+(?:i|we|you|they|he|she|it|that|this|these|those|the\s+company|our\s+company)\b/i.test(sentencePrefix) ||
        postDirectiveConditionalPattern.test(resetClauseSuffix)) {
      continue;
    }
    let clausePrefix = sentencePrefix.split(/[,;:]/).at(-1) ?? '';
    if (/\bwithout\b.*\b(?:please|then)\b/i.test(clausePrefix)) {
      clausePrefix = clausePrefix.split(/\b(?:please|then)\b/i).at(-1) ?? '';
    }
    if (!hasNegationInClausePrefix(clausePrefix)) return true;
  }
  return false;
}

function matchesCompatibleExplicitPriorReference(
  text: string,
  currentScenario?: AccountingScenarioState | null
): boolean {
  if (!text ||
      hasAffirmativeResetDirective(text) ||
      /\b(?:new|different|separate)\s+(?:question|transaction|analysis|case|scenario|situation|example)\b|\bunrelated\b|\b(?:separate|different|unrelated|distinct)\s+from\b/i.test(text)) {
    return false;
  }

  const activeDomains = resolveActiveScenarioDomains(currentScenario);
  const discussionClausePattern = new RegExp(`\\b${SUBJECT_DISCUSSION_CLAUSE_SOURCE}`, 'gi');
  const discussionMatches = [...text.matchAll(discussionClausePattern)];
  const discussionRanges = discussionMatches.map(match => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length
  }));
  const explicitDiscussionVerb = new RegExp(`\\b(?:discussed|mentioned|provided|stated|described|noted|shown)\\s+(?:earlier|previously|above|before)\\b${HISTORICAL_PERIOD_QUALIFIER_LOOKAHEAD}`, 'i');

  if (discussionMatches.length > 0 || explicitDiscussionVerb.test(text)) {
    return true;
  }

  const explicitAdjectiveSubject = new RegExp(`\\b${EXPLICIT_ADJECTIVE_SUBJECT_SOURCE}`, 'gi');
  const priorModifierOnlyPattern = new RegExp(`^${PRIOR_MODIFIER_ADJECTIVE_SUBJECT_SOURCE}$`, 'i');
  for (const match of text.matchAll(explicitAdjectiveSubject)) {
    const matchStart = match.index ?? 0;
    const matchEnd = matchStart + match[0].length;
    const coveredByDiscussion = discussionRanges.some(range => matchStart >= range.start && matchEnd <= range.end);
    if (!coveredByDiscussion && activeDomains.size > 0 && priorModifierOnlyPattern.test(match[0])) {
      const phraseDomains = resolveHeadNounDomains(match[0]);
      if (phraseDomains.size > 0 && !hasDomainOverlap(phraseDomains, activeDomains)) {
        continue;
      }
    }
    return true;
  }

  return false;
}

/** Recognizes a longer question that explicitly refers to facts from earlier turns. */
export function hasExplicitPriorFactReference(
  query: string,
  currentScenario?: AccountingScenarioState | null
): boolean {
  const text = query.trim();
  const isContextualQuestion = /^(?:(?:please\s+)?(?:regarding|about|concerning|as\s+for|in\s+relation\s+to|with\s+(?:regard|respect|reference)\s+to|for|explain|tell\s+me|describe|outline)|(?:what|which|when|where|who|why|how|can|could|would|should|does|do|did|is|are|was|were))\b/i.test(text);
  if (!text || !isContextualQuestion) return false;
  return matchesCompatibleExplicitPriorReference(text, currentScenario);
}

function startsWithPriorFactReference(query: string, currentScenario?: AccountingScenarioState | null): boolean {
  const referenceLead = /^\s*(?:please\s+(?:explain|tell\s+me|describe|outline)\s+|(?:regarding|about|concerning|as\s+for|in\s+relation\s+to|with\s+(?:regard|respect|reference)\s+to|for)\s+)/i.exec(query);
  if (!referenceLead) return false;
  const remainder = query.slice(referenceLead[0].length);
  const leadingExplicitSubject = new RegExp(
    `^(?:${EXPLICIT_ADJECTIVE_SUBJECT_SOURCE}|${SUBJECT_DISCUSSION_CLAUSE_SOURCE})`,
    'i'
  );
  return leadingExplicitSubject.test(remainder) && hasExplicitPriorFactReference(query, currentScenario);
}

/** Rebuilds the history that existed when a failed user turn was first sent. */
export function buildRetryConversationHistory(history: ChatMessage[], originalUserMessageId: string): ChatMessage[] {
  const originalTurnIndex = history.findIndex(message => message.id === originalUserMessageId && message.sender === 'user');
  return originalTurnIndex < 0 ? [] : history.slice(0, originalTurnIndex + 1);
}

/** Restricts model history to the current analysis; a missing boundary fails closed. */
export function buildAnalysisConversationHistory(history: ChatMessage[], boundaryMessageId: string | null): ChatMessage[] {
  if (!boundaryMessageId) return [];
  const boundaryIndex = history.findIndex(message => message.id === boundaryMessageId && message.sender === 'user');
  return boundaryIndex < 0 ? [] : history.slice(boundaryIndex).filter(message => !message.relationPrompt);
}

/** A failed turn can only be retried while it is still the latest user request. */
export function canRetryFailedAnswer(history: ChatMessage[], originalUserMessageId: string): boolean {
  const originalTurnIndex = history.findIndex(message => message.id === originalUserMessageId && message.sender === 'user');
  return originalTurnIndex >= 0 && !history.slice(originalTurnIndex + 1).some(message => message.sender === 'user');
}

/** A self-contained income-tax accounting question must not inherit a PPE journal. */
export function isDeferredTaxInquiry(query: string): boolean {
  return /\bdeferred\s+tax\s+(?:liabilit(?:y|ies)|assets?|accounting)\b/i.test(query) &&
    /\b(?:tax\s+depreciation|accelerated\s+(?:tax\s+)?(?:depreciation|write[ -]?off)|capital\s+allowances?|tax\s+base|temporary\s+differences?)\b/i.test(query);
}

const TRANSACTION_ACTION_VERB_SOURCE =
  '(?:bought|purchased|acquired|sold|disposed of|entered into|signed|leased|issued|subscribed|borrowed|took out|hired)';
const TRANSACTION_ACTION_PATTERN = new RegExp(`\\b(${TRANSACTION_ACTION_VERB_SOURCE})\\b`, 'gi');
const HAS_TRANSACTION_ACTION_PATTERN = new RegExp(`\\b${TRANSACTION_ACTION_VERB_SOURCE}\\b`, 'i');
const ELIDED_VP_CONTINUATION_PATTERN =
  /^\s*(?:(?:then|also|subsequently|later|next)\s+)?(?:bought|purchased|acquired|sold|disposed\s+of|entered\s+into|signed|leased|issued|subscribed|borrowed|took\s+out|hired)\b/i;
const TRANSACTION_DETAIL_PATTERN = /(?:\b(?:sgd|usd|eur|s\$)\s*[\d,]+|\$\s*[\d,]+|\b\d+(?:\.\d+)?\s*(?:k|million|years?|months?|%))\b/;
const TRANSACTION_SUBJECT_NOUNS =
  'machines?|machinery|equipment|laptops?|computers?|servers?|printers?|furniture|software|licen[cs]es?|subscriptions?|vehicles?|cars?|assets?|leases?|premises|loans?|shares?|customers?|suppliers?|invoices?|bills?|employees?|workers?|staff';
const NEW_SUBJECT_PATTERN = new RegExp(
  `\\b((?:new|another|additional|second|different|separate)\\s+(?:[a-z]+\\s+)?(?:${TRANSACTION_SUBJECT_NOUNS})|machines?|machinery|equipment|laptops?|computers?|servers?|printers?|furniture|software|licen[cs]es?|subscriptions?|vehicles?|cars?|leases?|premises|share\\s+capital|payroll|salar(?:y|ies)|customers?|suppliers?)\\b`,
  'i'
);



const CLAUSE_COORDINATION_BOUNDARY = /(?:,\s*)?\b(?:and|but|however|whereas)\b(?=\s+(?:(?:we|i|they|he|she|it|you|the\s+company|our\s+company)\s+)?(?:[a-z]+\s+){0,2}(?:bought|purchased|acquired|sold|disposed|entered|signed|leased|issued|subscribed|borrowed|took|hired)\b)/gi;

/** Masks indirect-question "if" (e.g. "asked if", "asked the candidate if") so it is not misclassified as a conditional. */
function maskIndirectQuestionIf(text: string): string {
  return text.replace(
    /\b((?:ask(?:ed|ing|s)?|wonder(?:ed|ing|s)?|inquir(?:ed|ing|es)?|enquir(?:ed|ing|es)?|check(?:ed|ing|s)?|confirm(?:ed|ing|s)?|discuss(?:ed|ing|es)?|see(?:ing|s)?|saw|know(?:n|ing|s)?|knew|sure|unsure|uncertain|determin(?:e|ed|ing|es)?|decid(?:e|ed|ing|es)?)(?:\s+(?!(?:and|or|but|because|when|while|that)\b)[a-z'’]+){0,5})\s+if\b/gi,
    '$1 whether'
  );
}

interface AnalyzedTransactionAction {
  action: RegExpMatchArray;
  isNegated: boolean;
  isHypothetical: boolean;
  isAffirmative: boolean;
  clauseText: string;
  domains: Set<string>;
  hasTransactionDetail: boolean;
  hasNewSubject: boolean;
}

interface ExtractedActionClause {
  clauseText: string;
  subjectBeforeVerb: string;
  objectAfterAction: string;
}

const PRICE_CONSIDERATION_PHRASE_PATTERN =
  /\b(?:for|at|of|worth)\s+(?:(?:sgd|usd|eur|s\$)\s*[\d,]+(?:\.\d+)?|\$\s*[\d,]+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:k|million|thousand))\b(?:\s*(?:per|a|each)\s+(?:month|year|annum|week|day)|\s*monthly|\s*annually)?/gi;
const STANDALONE_AMOUNT_PHRASE_PATTERN =
  /(?:\b(?:sgd|usd|eur|s\$)\s*[\d,]+(?:\.\d+)?|\$\s*[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)?\s*(?:k|million|thousand))\b(?:\s*(?:per|a|each)\s+(?:month|year|annum|week|day)|\s*monthly|\s*annually)?/gi;
const ACTION_OBJECT_TRUNCATION_PATTERN =
  /(?<!\d)[,;:](?!\d)|\b(?:in\s+order\s+to|so\s+as\s+to|to\s+(?:assist|manage|operate|support|run|use|help|process|handle|replace|pay|settle)|for\s+(?:our|the|their|his|her|its)\s+(?:payroll|staff|employees?|workers?|team|department|company|office|business)|from\s+(?:a|an|the|our|their|his|her|its|my|your)|because|since|while|when|where|which|that|who)\b/i;

/** Resolves the primary accounting domains of a transaction action from its verb, direct object, or subject. */
function resolveActionDomains(
  actionVerb: string,
  objectAfterAction: string,
  clauseText: string,
  subjectBeforeVerb: string
): Set<string> {
  if (/^leased$/i.test(actionVerb) || /\b(?:entered\s+into|signed)\s+(?:a|an|the|our|new|another)?\s*(?:[a-z]+\s+){0,2}lease\b/i.test(clauseText)) {
    return new Set(['lease']);
  }
  if (/^hired$/i.test(actionVerb)) return new Set(['payroll']);
  if (/^(?:borrowed|took\s+out)$/i.test(actionVerb)) return new Set(['financing']);

  const strippedObject = objectAfterAction
    .replace(PRICE_CONSIDERATION_PHRASE_PATTERN, ' ')
    .replace(STANDALONE_AMOUNT_PHRASE_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cutoffMatch = ACTION_OBJECT_TRUNCATION_PATTERN.exec(strippedObject);
  const objectSpan = (cutoffMatch ? strippedObject.slice(0, cutoffMatch.index) : strippedObject).trim();
  const objectDomains = resolveHeadNounDomains(objectSpan);
  if (objectDomains.size > 0) return objectDomains;

  return resolveHeadNounDomains(subjectBeforeVerb);
}

const HYPOTHETICAL_CONDITIONAL_PATTERN =
  /\b(?:what\s+if|if|suppose(?:\s+that)?|assuming(?:\s+that)?|provided(?:\s+that)?|in\s+case|say(?:\s+that)?|imagine(?:\s+that)?)\b/i;
const HYPOTHETICAL_MODAL_PATTERN =
  /(?:\b(?:could|would|should|might|may|can)(?:\s+(?:i|we|they|he|she|it|the\s+company|our\s+company))?(?:\s+not)?(?:\s+(?:subsequently|later|afterwards|then|possibly|potentially|still|instead|also))*\s+(?:have|be)(?:\s+(?:subsequently|later|afterwards|then|possibly|potentially|still|instead|also))*\s*$|^\s*\bhad\s+(?:i|we|they|he|she|it|the\s+company|our\s+company)\b)/i;
const HYPOTHETICAL_SCOPE_INTRO_PATTERN =
  /(?:^|[,;:]\s*|\b(?:and|or|but)\s+)(?:what\s+if|if|suppose(?:\s+that)?|assuming(?:\s+that)?|provided(?:\s+that)?|in\s+case|say(?:\s+that)?|imagine(?:\s+that)?|(?:what|how|which|where|who|when|would|could|should)\b[^.!?;,:]*\b(?:if|suppose(?:\s+that)?|assuming(?:\s+that)?)|(?:could|would|should|might|may|can)\s+(?:i|we|they|he|she|it|the\s+company|our\s+company)\s+(?:not\s+)?(?:have|be))\b/gi;

function isHypotheticalAction(sentenceBeforeAction: string, immediateClauseBeforeAction: string): boolean {
  if (HYPOTHETICAL_CONDITIONAL_PATTERN.test(immediateClauseBeforeAction) ||
      HYPOTHETICAL_MODAL_PATTERN.test(immediateClauseBeforeAction)) {
    return true;
  }
  let lastIntroEnd = -1;
  for (const match of sentenceBeforeAction.matchAll(HYPOTHETICAL_SCOPE_INTRO_PATTERN)) {
    lastIntroEnd = Math.max(lastIntroEnd, (match.index ?? 0) + match[0].length);
  }
  if (lastIntroEnd < 0) return false;
  const afterIntro = sentenceBeforeAction.slice(lastIntroEnd);
  if (/[;:]|\b(?:but\s+(?:actually|in\s+reality|in\s+fact|really|we\s+actually)|however|whereas|on\s+the\s+other\s+hand|(?:and|or)\s+(?:actually|in\s+fact|in\s+reality))\b/i.test(afterIntro)) {
    return false;
  }
  for (const commaMatch of afterIntro.matchAll(/,/g)) {
    const idx = commaMatch.index ?? 0;
    const beforeComma = afterIntro.slice(0, idx);
    const afterComma = afterIntro.slice(idx + 1);
    const isCoordinating = /^\s*(?:and|or)\b/i.test(afterComma);
    const isElidedVp = HAS_TRANSACTION_ACTION_PATTERN.test(beforeComma) &&
      (afterComma.trim().length === 0 || ELIDED_VP_CONTINUATION_PATTERN.test(afterComma));
    if (!isCoordinating && !isElidedVp) return false;
  }
  return true;
}

function extractActionClauseParts(q: string, actionIndex: number, actionEnd: number): ExtractedActionClause {
  const prefix = q.slice(0, actionIndex);
  let sentenceStart = 0;
  for (const match of prefix.matchAll(/(?<!\d)[.!?;](?!\d)/g)) {
    sentenceStart = (match.index ?? 0) + 1;
  }
  let clauseStart = sentenceStart;
  for (const match of q.slice(sentenceStart, actionIndex).matchAll(CLAUSE_COORDINATION_BOUNDARY)) {
    clauseStart = sentenceStart + (match.index ?? 0) + match[0].length;
  }

  const suffix = q.slice(actionEnd);
  const endPunctMatch = /(?<!\d)[.!?;](?!\d)/.exec(suffix);
  const coordMatches = [...suffix.matchAll(CLAUSE_COORDINATION_BOUNDARY)];
  let clauseEnd = q.length;
  if (endPunctMatch) {
    clauseEnd = Math.min(clauseEnd, actionEnd + endPunctMatch.index);
  }
  if (coordMatches.length > 0) {
    clauseEnd = Math.min(clauseEnd, actionEnd + (coordMatches[0].index ?? 0));
  }

  const rawClause = q.slice(clauseStart, clauseEnd);
  const leadingWs = rawClause.length - rawClause.trimStart().length;
  const clauseText = rawClause.trim();
  const actionOffsetInClause = Math.max(0, actionIndex - clauseStart - leadingWs);
  const actionEndOffsetInClause = Math.min(clauseText.length, actionOffsetInClause + (actionEnd - actionIndex));
  return {
    clauseText,
    subjectBeforeVerb: clauseText.slice(0, actionOffsetInClause),
    objectAfterAction: clauseText.slice(actionEndOffsetInClause)
  };
}

function evaluateTransactionAction(q: string, action: RegExpMatchArray): AnalyzedTransactionAction {
  const actionIndex = action.index ?? 0;
  const actionEnd = actionIndex + action[0].length;
  const rawActionLead = q.slice(0, actionIndex).split(/(?<!\d)[.!?;](?!\d)/).at(-1) ?? '';
  const actionLead = maskIndirectQuestionIf(rawActionLead);
  const normalizedActionLead = actionLead.replace(/(?<=\d),(?=\d)/g, '');
  const conditionalClauseBeforeAction = normalizedActionLead.split(/[,;:]|\b(?:and|or|but|yet|however|instead|whereas)\b/i).at(-1) ?? '';

  const isNegated = isActionVerbNegated(normalizedActionLead);
  const isHypothetical = !isNegated && isHypotheticalAction(normalizedActionLead, conditionalClauseBeforeAction);
  const isAffirmative = !isNegated && !isHypothetical;
  const { clauseText, subjectBeforeVerb, objectAfterAction } = extractActionClauseParts(q, actionIndex, actionEnd);

  return {
    action,
    isNegated,
    isHypothetical,
    isAffirmative,
    clauseText,
    domains: resolveActionDomains(action[0], objectAfterAction, clauseText, subjectBeforeVerb),
    hasTransactionDetail: TRANSACTION_DETAIL_PATTERN.test(clauseText),
    hasNewSubject: NEW_SUBJECT_PATTERN.test(clauseText)
  };
}

function analyzeTransactionActions(q: string) {
  const actions = [...q.matchAll(TRANSACTION_ACTION_PATTERN)].map(match => evaluateTransactionAction(q, match));
  return {
    transactionActions: actions,
    affirmativeActions: actions.filter(item => item.isAffirmative),
    hypotheticalActions: actions.filter(item => item.isHypothetical)
  };
}

/**
 * A deliberately conservative UI safeguard. Most messages are routed
 * automatically; only a substantial transaction-like message that has no
 * reliable continuation or new-scenario signal asks the user to decide.
 */
export function assessConversationRelation(
  query: string,
  currentScenario?: AccountingScenarioState | null,
  committedScenario?: AccountingScenarioState | null
): ConversationRelation {
  const relationScenario = currentScenario || committedScenario;
  if (!relationScenario) return 'NEW';
  if (startsNewAccountingScenario(query, relationScenario)) return 'NEW';

  const q = query.toLowerCase().trim();
  const qForConditionals = maskIndirectQuestionIf(q);
  const wordCount = q.split(/\s+/).filter(Boolean).length;
  const isShortFactReply = wordCount <= 4 || /^(?:sgd|usd|eur|s\$|\$)?\s*[\d,]+(?:\.\d+)?\s*(?:k|m|million|thousand)?$/i.test(q);
  const { transactionActions, affirmativeActions } = analyzeTransactionActions(q);
  const continuationSignal = /\b(what if|instead|then|also|same|above|that|this|these|those|it|they|discussed|mentioned|settle|settlement|recover|show|repeat|clarif)/i.test(q) ||
    /\b(?:suppose(?:\s+that)?|assuming(?:\s+that)?|if\s+(?:i|we|they|the\s+company|our\s+company))\b/i.test(qForConditionals) ||
    (transactionActions.length > 0 && affirmativeActions.length === 0);
  const explicitNewSignal = /\b(new (?:case|scenario|situation|question|transaction|analysis|example)|unrelated|(?:separate|different) (?:case|scenario|situation|analysis|question|transaction|example))\b/i.test(q) ||
    hasAffirmativeResetDirective(query);

  if (explicitNewSignal) return 'NEW';
  if (hasConflictingPriorSubject(query, relationScenario)) return 'AMBIGUOUS';
  if (isJournalDisplayRequest(query) || (!explicitNewSignal && matchesCompatibleExplicitPriorReference(query.trim(), relationScenario))) return 'RELATED';
  const payrollScenario = currentScenario?.scenarioType === 'PAYROLL_CPF_SALARY'
    ? currentScenario
    : committedScenario?.scenarioType === 'PAYROLL_CPF_SALARY' ? committedScenario : null;
  const salaryCorrection = payrollScenario && isSingleMonthlySalaryAmendment(query)
    ? resolveFactAmendment(query, payrollScenario).amendments
    : undefined;
  if (salaryCorrection?.length === 1 && salaryCorrection[0].field === 'monthlySalary') return 'RELATED';
  if (relationScenario.missingFields?.length || isShortFactReply || continuationSignal) return 'RELATED';

  // Only ask where a complete existing scenario is followed by another
  // sufficiently detailed accounting-looking narrative. General questions
  // and short replies remain automatic to avoid unnecessary interruptions.
  const transactionLike = /\b(paid|pay|received|invoice|expense|fine|salary|wage|supplier|customer|director|shareholder|loan|lease|asset|equipment|bank|cash|gst|cpf)\b/i.test(q);
  return relationScenario.isComplete && transactionLike && wordCount >= 5
    ? 'AMBIGUOUS'
    : 'RELATED';
}

/** Determines whether a message is a self-contained transaction, not a follow-up. */
export function startsNewAccountingScenario(
  query: string,
  currentScenario?: AccountingScenarioState | null,
  context?: ConversationAccountingContext
): boolean {
  if (!currentScenario && !context?.underlyingTransaction) return false;

  if (isDeferredTaxInquiry(query)) return true;
  if (hasAffirmativeResetDirective(query)) return true;

  const q = query.toLowerCase();
  const activeDomains = resolveActiveScenarioDomains(currentScenario, context);
  const { affirmativeActions, hypotheticalActions } = analyzeTransactionActions(q);
  // "$2,000" begins with a non-word character, so it cannot have a word
  // boundary immediately before it. Keep currency codes word-bounded while
  // accepting the standalone dollar symbol as an amount marker.
  const hasTransactionDetail = TRANSACTION_DETAIL_PATTERN.test(q);

  // A company-paid fine or private/director cost is a new transaction even
  // when its narrative uses “paid”; it must never be attached to an earlier
  // payable merely because both messages describe cash outflows.
  const isIndependentPersonalCost = /\b(fine|penalt(?:y|ies)|traffic offence|personal expense|private expense)\b/.test(q) &&
    /\b(director|shareholder|owner|company)\b/.test(q) && hasTransactionDetail;
  if (isIndependentPersonalCost) return true;

  // A contextual statutory question may repeat the transaction wording and
  // amount while asking about its treatment.
  if (startsWithPriorFactReference(query, currentScenario)) {
    const leadingReferenceClause = query.split(/[,.;:!?]/, 1)[0];
    const leadingReferenceCanRestateAction = /\b(?:purchase|transaction|asset|equipment|machine|machinery|vehicle|lease|contract|arrangement|loan|shares?|employee|worker|staff|salary|payroll|scenario|situation|case|example|facts?|details?|discussion|conversation|analysis)\b/i.test(leadingReferenceClause);
    const hasSubsequentFollowUpReference = /\b(?:the|this|that|our)\s+(?:additional|second|subsequent)\s+(?:purchase|acquisition|transaction)\b/i.test(q);
    return affirmativeActions.some(item => {
      const actionIndex = item.action.index ?? 0;
      const actionEnd = actionIndex + item.action[0].length;
      const actionObject = q.slice(actionEnd);
      const actionClauseAfter = actionObject.split(/(?<!\d)[.!?;](?!\d)/, 1)[0];
      const actionLead = q.slice(0, actionIndex).split(/(?<!\d)[.!?;](?!\d)/).at(-1) ?? '';
      const hasSeparateObject = new RegExp(`\\b(?:new|another|additional|second|different|separate)\\s+(?:[a-z]+\\s+)?(?:${TRANSACTION_SUBJECT_NOUNS}|purchases?|acquisitions?|transactions?)\\b`, 'i').test(actionClauseAfter.split(/[,:]/, 1)[0]);
      const hasIndefiniteOrQuantifiedObject = new RegExp(`^\\s+(?:(?:a|an|some|new|more|additional|two|three|four|five|\\d+)\\s+)?(?:[a-z]+\\s+){0,2}(?:${TRANSACTION_SUBJECT_NOUNS}|purchases?|acquisitions?|transactions?)\\b`, 'i').test(actionClauseAfter);
      const hasSubsequentOrAdditiveAction = /\b(?:(?:we|the company|our company|i)\s+)?(?:subsequently|later|afterwards|then|again|also|additionally|separately)(?:,\s*)?\s+(?:(?:we|the company|our company|i)\s+)?$/i.test(actionLead);
      if (hasSeparateObject && (item.hasTransactionDetail || item.hasNewSubject || hasSubsequentOrAdditiveAction)) return true;
      if ((hasSubsequentOrAdditiveAction || hasSubsequentFollowUpReference) && hasIndefiniteOrQuantifiedObject) return true;
      return !leadingReferenceCanRestateAction && item.hasTransactionDetail && item.hasNewSubject && hasIndefiniteOrQuantifiedObject;
    });
  }

  const isDisjointFromActiveDomains = (actionDomains: Set<string>): boolean =>
    actionDomains.size > 0 && activeDomains.size > 0 && !hasDomainOverlap(actionDomains, activeDomains);

  // A complete narrative supersedes the active workflow even when both
  // transactions are in the same accounting domain.
  if (affirmativeActions.some(item =>
    (item.hasTransactionDetail && item.hasNewSubject) || isDisjointFromActiveDomains(item.domains)
  )) {
    return true;
  }

  // A hypothetical action in a disjoint domain starts a new scenario unless it
  // explicitly contrasts ("instead"/"rather") against an anaphoric prior object.
  const isAnaphoricInsteadVariation = (item: AnalyzedTransactionAction): boolean => {
    const objectAfterVerb = q.slice((item.action.index ?? 0) + item.action[0].length).split(/[.!?;,]/, 1)[0];
    return /\b(?:instead|rather)\b/i.test(item.clauseText) &&
      !/\b(?:new|another|additional|second|different)\b/i.test(item.clauseText) &&
      /^\s+(?:the|that|this|these|those|it|they|them)\b/i.test(objectAfterVerb);
  };
  if (hypotheticalActions.some(item =>
    isDisjointFromActiveDomains(item.domains) &&
    !isAnaphoricInsteadVariation(item) &&
    !hasExplicitPriorFactReference(query, currentScenario)
  )) {
    return true;
  }

  return false;
}
