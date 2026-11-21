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
const ACCOUNTING_SUBJECT_NOUNS = '(?:transaction|expense|purchase|supply|invoice|amount|asset|equipment|machine|machinery|vehicle|salary|payroll|employee|worker|staff|payment|contract|lease|arrangement|deadline|rate)';
export const PRIOR_SUBJECT_NOUNS = `(?:${DISCOURSE_SUBJECT_NOUNS}|${ACCOUNTING_SUBJECT_NOUNS}|transactions|expenses|purchases|supplies|invoices|amounts|assets|vehicles|salaries|employees|workers|payments|contracts|leases|arrangements|deadlines|rates)`;

const MONTH_NAMES_SOURCE = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec';
const PERIOD_UNIT_LOOKAHEAD_WORDS = 'year|years|period|periods|month|months|quarter|quarters|week|weeks|day|days|decade|decades|half|halves|semester|semesters|trimester|trimesters|season|seasons|fy|ya|q[1-4]|h[1-2]';
const EXCLUDED_PRIOR_MODIFIER_WORDS =
  `${MONTH_NAMES_SOURCE}|${PERIOD_UNIT_LOOKAHEAD_WORDS}|` +
  'annual|annually|yearly|monthly|quarterly|weekly|daily|interim|opening|closing|historical|historic|past|old|aged|overdue|outstanding|unpaid|unsettled|accrued|prepaid|deferred|unbilled|unclaimed|unabsorbed|unutilised|unutilized';

export const PRIOR_ADJECTIVE_MODIFIER = `(?:(?!(?:${EXCLUDED_PRIOR_MODIFIER_WORDS})\\b)[a-z]+\\s+){0,2}`;
export const HISTORICAL_PERIOD_QUALIFIER_LOOKAHEAD =
  `(?!\\s+(?:${PERIOD_UNIT_LOOKAHEAD_WORDS})\\b)` +
  `(?!(?:\\s+${PRIOR_SUBJECT_NOUNS}){0,2}(?:\\s+(?:incurred|paid|accrued|billed|invoiced|recorded|recognised|recognized|claimed|deducted|disallowed|allowed|exempted|assessed|granted|applied|made|earned|received|arising))?\\s+(?:for|in|from|during|of|under)\\s+(?:ya\\s*\\d{4}|fy\\s*\\d{4}|ya|fy|year\\s+of\\s+assessment|financial\\s+year|tax\\s+year|calendar\\s+year|q[1-4](?:\\s*\\d{4})?|h[1-2](?:\\s*\\d{4})?|(?:${MONTH_NAMES_SOURCE})(?:\\s+\\d{4})?|(?:the\\s+)?(?:month|quarter|year|period)\\s+of\\s+[a-z]+|(?:the\\s+)?(?:prior|previous|earlier|preceding|last)\\s+(?:years?|periods?|months?|quarters?|weeks?)|\\d{4})\\b)`;
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
  { domain: 'asset_purchase', pattern: /\b(?:machines?|machinery|equipment|asset\s+purchase|capital\s+expenditure|ppe|property,\s*plant\s+and\s+equipment)\b/i },
  { domain: 'vehicle', pattern: /\b(?:car|cars|vehicle|vehicles|motor\s+car|motor\s+vehicle|s[- ]?plate)\b/i },
  { domain: 'lease', pattern: /\b(?:lease|leases|leased|leasing|rou|right[- ]of[- ]use|rental|rent(?:ed|ing)?)\b/i },
  { domain: 'share_capital', pattern: /\b(?:share\s+capital|shareholders?|subscribers?|allotment|ordinary\s+shares?|own\s+shares?)\b/i },
  { domain: 'equity_investment', pattern: /\b(?:apple|aapl|tesla|tsla|microsoft|fvoci|fvtpl|amortised\s+cost|amortized\s+cost|equity\s+investment|foreign\s+shares?)\b/i },
  { domain: 'director_fine', pattern: /\b(?:fine|fines|penalt(?:y|ies)|traffic\s+offence)\b/i },
  { domain: 'trade_payable_receivable', pattern: /\b(?:suppliers?|vendors?|customers?|clients?|invoices?|bills?|consulting|legal\s+fees?|audit\s+fees?)\b/i },
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

function hasDomainOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const domain of a) {
    if (b.has(domain)) return true;
  }
  return false;
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
    } else if (tag === 'PPE_ASSET_PURCHASE' || tag === 'CAPITALISATION_THRESHOLD' || tag.startsWith('PPE_')) {
      domains.add('asset_purchase');
    } else if (tag.startsWith('SHARE_CAPITAL')) {
      domains.add('share_capital');
    } else if (tag === 'EQUITY_INVESTMENT_FX') {
      domains.add('equity_investment');
    } else if (tag.startsWith('LEASE_')) {
      domains.add('lease');
    } else if (tag === 'DIRECTOR_PERSONAL_FINE') {
      domains.add('director_fine');
    }
  }

  const isUnclassifiedStub = currentScenario?.scenarioType === 'UNRECOGNIZED' && !currentScenario.rawQuery?.trim();
  const descriptiveText = [
    context?.underlyingTransaction?.subject,
    isUnclassifiedStub ? undefined : currentScenario?.transactionTitle,
    currentScenario?.rawQuery
  ].filter(Boolean).join(' ');
  for (const domain of extractSubjectDomains(descriptiveText)) {
    domains.add(domain);
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
    const phraseDomains = extractSubjectDomains(phrase);
    return phraseDomains.size > 0 && !hasDomainOverlap(phraseDomains, activeDomains);
  });
}

const GENERAL_LY_ADVERB = '(?!(?:only|early|apply|comply|imply|rely|reply|supply|multiply|family|likely|friendly|ugly|holy|lonely|lovely|silly)\\b)[a-z]+ly';
const RESET_ADVERBS = `(?:(?:please|ever|just|simply|still|even|yet|${GENERAL_LY_ADVERB})\\s+)*`;
const STRICT_RESET_ADVERBS = `(?:(?:ever|just|simply|still|even|yet|${GENERAL_LY_ADVERB})\\s+)*`;
const OPTIONAL_LY_NOT = `(?:(?:${GENERAL_LY_ADVERB}\\s+)?not)`;
const DIRECT_RESET_NEGATOR = `(?:do\\s+${OPTIONAL_LY_NOT}|don['’]?t|dont|does\\s+${OPTIONAL_LY_NOT}|doesn['’]?t|doesnt|did\\s+${OPTIONAL_LY_NOT}|didn['’]?t|didnt|cannot|can['’]?t|cant|should\\s+${OPTIONAL_LY_NOT}|shouldn['’]?t|shouldnt|must\\s+${OPTIONAL_LY_NOT}|mustn['’]?t|mustnt|need\\s+${OPTIONAL_LY_NOT}|needn['’]?t|neednt|would\\s+${OPTIONAL_LY_NOT}|wouldn['’]?t|wouldnt|could\\s+${OPTIONAL_LY_NOT}|couldn['’]?t|couldnt|will\\s+${OPTIONAL_LY_NOT}|won['’]?t|wont|may\\s+${OPTIONAL_LY_NOT}|might\\s+${OPTIONAL_LY_NOT}|shall\\s+${OPTIONAL_LY_NOT}|shan['’]?t|shant|never)`;
const CONTRACTED_STATE_OR_PERFECT_NEGATOR = `(?:i['’]?m|im|you['’]?re|youre|we['’]re|they['’]?re|theyre|he['’]?s|she['’]?s|it['’]?s|that['’]?s|there['’]?s|i['’]?ve|ive|you['’]?ve|youve|we['’]?ve|weve|they['’]?ve|theyve|i['’]d|you['’]?d|we['’]d|they['’]?d|he['’]d|she['’]d|i['’]ll|you['’]?ll|we['’]ll|they['’]?ll|he['’]ll|she['’]ll)\\s+${OPTIONAL_LY_NOT}`;
const STATE_OR_PERFECT_NEGATOR = `(?:(?:is|are|am|was|were|have|has|had)\\s+${OPTIONAL_LY_NOT}|isn['’]?t|isnt|aren['’]?t|arent|wasn['’]?t|wasnt|weren['’]?t|werent|haven['’]?t|havent|hasn['’]?t|hasnt|hadn['’]?t|hadnt|${CONTRACTED_STATE_OR_PERFECT_NEGATOR})`;
const RESET_TARGET_OBJECT = "(?:you|us|me|them|him|her|it|anyone|anybody|someone|somebody|everyone|everybody|yourself|ourselves|myself|(?:the|this|that|my|our|your)\\s+(?:assistant|model|system|ai))";
const BARE_CAUSATIVE_RESET_PART = `(?:let|letting|make|making|have|having|help|helping)\\s+(?:${RESET_TARGET_OBJECT}(?:\\s+to)?|['’]?s)`;
const TO_INFINITIVE_RESET_VERBS = '(?:want|need|have|try|attempt|intend|mean|plan|expect|wish|like|choose|decide|agree|ask|tell|instruct|direct|require|allow|permit|advise|recommend|remind|warn|caution|encourage|going|supposed|meant|intended|trying|attempting|asking|telling|instructing|planning|expecting|wishing|needing|having|able|ready|willing|prepared)';
const RESET_CLAUSE_NEGATION_PATTERNS = [
  new RegExp(`\\b${DIRECT_RESET_NEGATOR}\\s+${RESET_ADVERBS}$`, 'i'),
  new RegExp(`(?:\\bnot\\s+to\\s+${RESET_ADVERBS}|\\b(?:let['’]?s|let\\s+us|you|we|they|i|he|she|it)\\s+not\\s+${STRICT_RESET_ADVERBS}|^\\s*(?:please\\s+)?not\\s+${STRICT_RESET_ADVERBS}|\\bnor\\s+${RESET_ADVERBS}|\\bwithout\\s+(?:to\\s+)?${STRICT_RESET_ADVERBS}(?:${BARE_CAUSATIVE_RESET_PART}\\s+)?)$`, 'i'),
  new RegExp(`(?:\\b(?:${DIRECT_RESET_NEGATOR}|${STATE_OR_PERFECT_NEGATOR})\\s+${STRICT_RESET_ADVERBS}(?:going\\s+to\\s+|about\\s+to\\s+)?(?:${TO_INFINITIVE_RESET_VERBS}(?:\\s+${RESET_TARGET_OBJECT})?\\s+to|${BARE_CAUSATIVE_RESET_PART})|\\bno\\s+(?:need|reason|call|cause|grounds?|basis)(?:\\s+for\\s+${RESET_TARGET_OBJECT})?\\s+to|\\b(?:${DIRECT_RESET_NEGATOR}|${STATE_OR_PERFECT_NEGATOR})\\s+${STRICT_RESET_ADVERBS}(?:say|saying|said|tell|telling|told|write|writing|state|stating|assume|assuming|think|thinking|imply|implying|suggest|suggesting)(?:\\s+(?:me|us|you|them))?(?:\\s+to|\\s+(?:that\\s+)?(?:i|we|you|they)\\s+(?:should|must|need\\s+to|ought\\s+to|have\\s+to))?)\\s+${RESET_ADVERBS}$`, 'i'),
  new RegExp(`(?:^\\s*|[,;:]\\s*)\\bnot\\s+${STRICT_RESET_ADVERBS}(?:(?:asking|telling|wanting|trying|intending|meaning|planning|expecting|going|supposed|meant|intended)(?:\\s+${RESET_TARGET_OBJECT})?\\s+to|(?:letting|making|having|helping)\\s+(?:${RESET_TARGET_OBJECT}(?:\\s+to)?|['’]?s))\\s+${RESET_ADVERBS}$`, 'i'),
  new RegExp(`\\b(?:${DIRECT_RESET_NEGATOR}|not\\s+to)\\s+${STRICT_RESET_ADVERBS}[a-z]+(?:\\s+[a-z'’]+){0,4}\\s+or\\s+${STRICT_RESET_ADVERBS}$`, 'i')
];

function isNegatedResetClausePrefix(clausePrefix: string): boolean {
  return RESET_CLAUSE_NEGATION_PATTERNS.some(pattern => pattern.test(clausePrefix));
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
  for (const match of collapsedCoordinatedVerbs.matchAll(directivePattern)) {
    const matchIndex = match.index ?? 0;
    const clausePrefix = collapsedCoordinatedVerbs.slice(0, matchIndex).split(/[.!?;,:]/).at(-1) ?? '';
    if (!isNegatedResetClausePrefix(clausePrefix)) return true;
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
      const phraseDomains = extractSubjectDomains(match[0]);
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

const TRANSACTION_ACTION_PATTERN = /\b(bought|purchased|acquired|sold|disposed of|entered into|signed|leased|issued|subscribed|borrowed|took out|hired)\b/gi;
const TRANSACTION_DETAIL_PATTERN = /(?:\b(?:sgd|usd|eur|s\$)\s*[\d,]+|\$\s*[\d,]+|\b\d+(?:\.\d+)?\s*(?:k|million|years?|months?|%))\b/;
const NEW_SUBJECT_PATTERN = /\b((?:new|another|additional|second|different)\s+(?:[a-z]+\s+)?(?:machines?|machinery|equipment|vehicles?|assets?|leases?|premises|loans?|shares?|customers?|suppliers?|employees?|workers?|staff)|machine|machinery|equipment|vehicle|lease|premises|share capital|payroll|salary|customer|supplier)\b/;

const NEGATION_MODIFIER_TOKEN =
  '(?:have|has|had|having|been|be|was|were|is|are|am|did|do|does|' +
  '(?!(?:only|early|apply|comply|imply|rely|reply|supply|multiply|family|likely|friendly|ugly|holy|lonely|lovely|silly)\\b)[a-z]+ly|' +
  'ever|yet|even|still|also|just|simply|already|before|prior|either|later|afterwards|then|again|longer|anymore|' +
  'at\\s+all|so\\s+far|to\\s+date|in\\s+(?:fact|effect|reality|practice)|as\\s+yet|by\\s+then|up\\s+to\\s+now|any\\s+longer)';
const COORDINATED_NEGATION_MODIFIERS = `(?:(?:\\s+(?:and|or))?\\s+${NEGATION_MODIFIER_TOKEN})*`;
const OPTIONAL_PRECEDING_NEGATED_VERB = `(?:(?:[a-z]+(?:ed|en|t)|bought|sold|hired|leased|signed|issued|borrowed|acquired|purchased|entered\\s+into|disposed\\s+of|took\\s+out)\\s+(?:or|nor)\\s+(?:${NEGATION_MODIFIER_TOKEN}\\s+)*)?`;

const NEGATED_ACTION_PATTERNS = [
  new RegExp(`\\b(?:never|neither|nor|not|no\\s+one|nobody|none\\s+of\\s+us|haven['’]?t|havent|hasn['’]?t|hasnt|hadn['’]?t|hadnt|didn['’]?t|didnt|don['’]?t|dont|doesn['’]?t|doesnt|wasn['’]?t|wasnt|weren['’]?t|werent|isn['’]?t|isnt|aren['’]?t|arent|cannot|can['’]?t|cant|couldn['’]?t|couldnt|wouldn['’]?t|wouldnt|shouldn['’]?t|shouldnt|mustn['’]?t|mustnt|won['’]?t|wont)\\b${COORDINATED_NEGATION_MODIFIERS}\\s+${OPTIONAL_PRECEDING_NEGATED_VERB}$`, 'i'),
  new RegExp(`\\b(?:not|never|didn['’]?t|didnt|don['’]?t|dont|doesn['’]?t|doesnt|isn['’]?t|isnt|aren['’]?t|arent|wasn['’]?t|wasnt|weren['’]?t|werent)\\b[^,;:]*\\b(?:that|say|said|claim|claimed|mean|meant|imply|implied|suggest|suggested|assume|assumed)\\s+(?:that\\s+)?(?:i|we|they|he|she|it|the\\s+company|our\\s+company)${COORDINATED_NEGATION_MODIFIERS}\\s+${OPTIONAL_PRECEDING_NEGATED_VERB}$`, 'i'),
  new RegExp(`(?:^\\s*|\\b(?:and|but|or)\\s+)(?:no|neither)\\s+(?:[a-z]+\\s+){0,3}(?:was|were|has\\s+been|have\\s+been|had\\s+been)?\\s*(?:${NEGATION_MODIFIER_TOKEN}(?:\\s+(?:and|or)\\s+${NEGATION_MODIFIER_TOKEN})*\\s+)*$`, 'i')
];

const CLAUSE_COORDINATION_BOUNDARY = /(?:,\s*)?\b(?:and|but|however|whereas)\b(?=\s+(?:(?:we|i|they|he|she|it|you|the\s+company|our\s+company)\s+)?(?:[a-z]+\s+){0,2}(?:bought|purchased|acquired|sold|disposed|entered|signed|leased|issued|subscribed|borrowed|took|hired)\b)/gi;

/** Masks indirect-question "if" (e.g. "asked if", "asked the candidate if") so it is not misclassified as a conditional. */
function maskIndirectQuestionIf(text: string): string {
  return text.replace(
    /\b((?:ask(?:ed|ing|s)?|wonder(?:ed|ing|s)?|inquir(?:ed|ing|es)?|enquir(?:ed|ing|es)?|check(?:ed|ing|s)?|confirm(?:ed|ing|s)?|discuss(?:ed|ing|es)?|see(?:ing|s)?|saw|know(?:n|ing|s)?|knew|unsure|uncertain|determin(?:e|ed|ing|es)?|decid(?:e|ed|ing|es)?)(?:\s+(?!(?:and|or|but|because|when|while|that)\b)[a-z'’]+){0,3})\s+if\b/gi,
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

function extractActionClauseText(q: string, actionIndex: number, actionEnd: number): string {
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
  return q.slice(clauseStart, clauseEnd).trim();
}

function evaluateTransactionAction(q: string, action: RegExpMatchArray): AnalyzedTransactionAction {
  const actionIndex = action.index ?? 0;
  const actionEnd = actionIndex + action[0].length;
  const rawActionLead = q.slice(0, actionIndex).split(/(?<!\d)[.!?;](?!\d)/).at(-1) ?? '';
  const actionLead = maskIndirectQuestionIf(rawActionLead);
  const negationClauseBeforeAction = actionLead.split(/[,;:]|\b(?:but|yet|however|instead|whereas)\b/i).at(-1) ?? '';
  const conditionalClauseBeforeAction = actionLead.split(/[,;:]|\b(?:and|or|but|yet|however|instead|whereas)\b/i).at(-1) ?? '';

  const isNegated = NEGATED_ACTION_PATTERNS.some(pattern => pattern.test(negationClauseBeforeAction));

  const hasUnclosedTopLevelConditional =
    !/[,;:]/.test(actionLead) &&
    (/^\s*(?:what\s+if|if|suppose(?:\s+that)?|assuming(?:\s+that)?|provided(?:\s+that)?|in\s+case|say(?:\s+that)?|imagine(?:\s+that)?)\b/i.test(actionLead) ||
      /^\s*(?:what|how|which|where|who|when|would|could|should)\b[^.!?;,:]*\b(?:if|suppose(?:\s+that)?|assuming(?:\s+that)?)\b/i.test(actionLead));
  const isConditionalAction =
    /\b(?:what\s+if|if|suppose(?:\s+that)?|assuming(?:\s+that)?|provided(?:\s+that)?|in\s+case|say(?:\s+that)?|imagine(?:\s+that)?)\b/i.test(conditionalClauseBeforeAction) ||
    hasUnclosedTopLevelConditional;
  const isInterrogativeConditionalAction =
    /\b(?:what|how|which|where|who|when|would|could|should)\b[^.!?;,:]*\b(?:if|suppose(?:\s+that)?|assuming(?:\s+that)?)\b[^.!?;,:]*$/i.test(conditionalClauseBeforeAction) ||
    hasUnclosedTopLevelConditional;
  const hasUnclosedTopLevelModal =
    !/[,;:]/.test(actionLead) &&
    /^\s*(?:could|would|should|might|may|can)\s+(?:i|we|they|he|she|it|the\s+company|our\s+company)\s+(?:not\s+)?(?:have|be)\b/i.test(actionLead);
  const isModalAction =
    /\b(?:could|would|should|might|may|can)(?:\s+(?:i|we|they|he|she|it|the\s+company|our\s+company))?(?:\s+not)?(?:\s+(?:subsequently|later|afterwards|then|possibly|potentially|still|instead|also))*\s+(?:have|be)(?:\s+(?:subsequently|later|afterwards|then|possibly|potentially|still|instead|also))*\s*$/i.test(conditionalClauseBeforeAction) ||
    /(?:^\s*|[,;:]\s*)\bhad\s+(?:i|we|they|he|she|it|the\s+company|our\s+company)\s+(?:(?:subsequently|later|afterwards|then|also|instead|ever)\s+)*$/i.test(conditionalClauseBeforeAction) ||
    hasUnclosedTopLevelModal;

  const isHypothetical = !isNegated && (isConditionalAction || isInterrogativeConditionalAction || isModalAction);
  const isAffirmative = !isNegated && !isHypothetical;
  const clauseText = extractActionClauseText(q, actionIndex, actionEnd);

  return {
    action,
    isNegated,
    isHypothetical,
    isAffirmative,
    clauseText,
    domains: extractSubjectDomains(clauseText),
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
      const hasSeparateObject = /\b(?:new|another|additional|second|different)\s+(?:[a-z]+\s+)?(?:machines?|machinery|equipment|vehicles?|assets?|leases?|premises|loans?|shares?|customers?|suppliers?|employees?|workers?|staff|purchases?|acquisitions?|transactions?)\b/i.test(actionClauseAfter.split(/[,:]/, 1)[0]);
      const hasIndefiniteOrQuantifiedObject = /^\s+(?:(?:a|an|some|new|more|additional|two|three|four|five|\d+)\s+)?(?:[a-z]+\s+){0,2}(?:machines?|machinery|equipment|vehicles?|assets?|leases?|premises|loans?|shares?|customers?|suppliers?|employees?|workers?|staff|purchases?|acquisitions?|transactions?)\b/i.test(actionClauseAfter);
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
