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
const ACCOUNTING_SUBJECT_NOUNS = '(?:transaction|expense|purchase|supply|invoice|amount|asset|equipment|machine|machinery|salary|payroll|employee|worker|staff|payment|contract|lease|arrangement|deadline|rate)';
const PRIOR_SUBJECT_NOUNS = `(?:${DISCOURSE_SUBJECT_NOUNS}|${ACCOUNTING_SUBJECT_NOUNS}|transactions|expenses|purchases|supplies|invoices|amounts|assets|salaries|employees|workers|payments|contracts|leases|arrangements|deadlines|rates)`;
const PRIOR_SCENARIO_MODIFIER = '(?:(?:supplier|vendor|customer|client|business|company|equipment|machine|machinery|vehicle|asset|lease|rental|loan|employee|worker|staff|payroll|salary|cpf|gst|tax)\\s+){0,2}';
const HISTORICAL_PERIOD_QUALIFIER_LOOKAHEAD = '(?!(?:\\s+(?:incurred|paid|accrued|billed|invoiced|recorded|recognised|recognized|claimed|deducted|disallowed|allowed|exempted|assessed|granted|applied|made|earned|received|arising))?\\s+(?:for|in|from|during|of|under)\\s+(?:ya\\s*\\d{4}|fy\\s*\\d{4}|ya|fy|year\\s+of\\s+assessment|financial\\s+year|tax\\s+year|calendar\\s+year|(?:the\\s+)?(?:prior|previous|earlier|preceding|last)\\s+(?:years?|periods?|months?|quarters?)|\\d{4})\\b)';
const EXPLICIT_ADJECTIVE_SUBJECT_SOURCE =
  `(?:` +
    `(?:(?:the|our|my|this|that|these|those)\\s+)?(?:above|foregoing|aforementioned)\\s+${PRIOR_SCENARIO_MODIFIER}${PRIOR_SUBJECT_NOUNS}|` +
    `(?:(?:the|our|my|this|that|these|those)\\s+)?(?:earlier|previous|prior|last|preceding)\\s+${PRIOR_SCENARIO_MODIFIER}${DISCOURSE_SUBJECT_NOUNS}|` +
    `(?:the|our|my|this|that|these|those)\\s+(?:earlier|previous|prior|last|preceding)\\s+${PRIOR_SCENARIO_MODIFIER}${PRIOR_SUBJECT_NOUNS}` +
  `)\\b${HISTORICAL_PERIOD_QUALIFIER_LOOKAHEAD}`;
const SUBJECT_DISCUSSION_CLAUSE_SOURCE = `(?:the|our|my|this|that|these|those)\\s+(?:[a-z]+\\s+){0,2}${PRIOR_SUBJECT_NOUNS}\\s+(?:(?:that|which|whom|who)\\s+)?(?:(?:we|you|i)\\s+(?:just\\s+|earlier\\s+|previously\\s+)?(?:discussed|mentioned|described|covered|talked\\s+about|referred\\s+to|looked\\s+at|used|gave|calculated|established)|(?:was|were)\\s+(?:just\\s+|earlier\\s+|previously\\s+)?(?:discussed|mentioned|described|covered|provided|stated|established)\\b|(?:discussed|mentioned|described|provided|stated|noted|shown)\\s+(?:above|earlier|before|previously)\\b${HISTORICAL_PERIOD_QUALIFIER_LOOKAHEAD}|(?:above(?!\\s+(?:sgd|usd|eur|s\\$|\\$|\\d|the\\s+(?:[a-z]+\\s+)?(?:ceiling|limit|threshold|cap|rate|amount))\\b)|(?:previously|earlier)(?!\\s+(?:this|last|next|in|for|from|during|under|incurred|paid|accrued|billed|invoiced|recorded|recognised|recognized|claimed|deducted|disallowed|allowed|exempted|assessed|granted|applied|made|earned|received)\\b))\\b)`;

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
    const isNegatedClause = /\b(?:not|do\s+not|don['’]?t|dont|does\s+not|doesn['’]?t|doesnt|did\s+not|didn['’]?t|didnt|have\s+not|haven['’]?t|havent|has\s+not|hasn['’]?t|hasnt|had\s+not|hadn['’]?t|hadnt|never|cannot|can['’]?t|cant|should\s+not|shouldn['’]?t|shouldnt|must\s+not|mustn['’]?t|mustnt|need\s+not|needn['’]?t|neednt|would\s+not|wouldn['’]?t|wouldnt|could\s+not|couldn['’]?t|couldnt|will\s+not|won['’]?t|wont|is\s+not|isn['’]?t|isnt|are\s+not|aren['’]?t|arent|was\s+not|wasn['’]?t|wasnt|were\s+not|weren['’]?t|werent|no\s+(?:need|reason|call|cause)|without)\b(?:(?!\b(?:and|but|so|however|instead|rather)\b)\s+[a-z'’]+){0,8}\s*$/i.test(clausePrefix);
    if (!isNegatedClause) return true;
  }
  return false;
}

/** Recognizes a longer question that explicitly refers to facts from earlier turns. */
export function hasExplicitPriorFactReference(query: string): boolean {
  const text = query.trim();
  const isContextualQuestion = /^(?:(?:please\s+)?(?:regarding|about|concerning|as\s+for|in\s+relation\s+to|with\s+(?:regard|respect|reference)\s+to|for|explain|tell\s+me|describe|outline)|(?:what|which|when|where|who|why|how|can|could|would|should|does|do|did|is|are|was|were))\b/i.test(text);
  if (!text || !isContextualQuestion ||
      hasAffirmativeResetDirective(text) ||
      /\b(?:new|different|separate)\s+(?:question|transaction|analysis|case|scenario|situation|example)\b|\bunrelated\b|\b(?:separate|different|unrelated|distinct)\s+from\b/i.test(text)) {
    return false;
  }

  const explicitAdjectiveSubject = new RegExp(`\\b${EXPLICIT_ADJECTIVE_SUBJECT_SOURCE}`, 'i');
  const subjectDiscussionClause = new RegExp(`\\b${SUBJECT_DISCUSSION_CLAUSE_SOURCE}`, 'i');
  const explicitDiscussionVerb = new RegExp(`\\b(?:discussed|mentioned|provided|stated|described|noted|shown)\\s+(?:earlier|previously|above|before)\\b${HISTORICAL_PERIOD_QUALIFIER_LOOKAHEAD}`, 'i');

  return explicitAdjectiveSubject.test(text) ||
    subjectDiscussionClause.test(text) ||
    explicitDiscussionVerb.test(text);
}

function startsWithPriorFactReference(query: string): boolean {
  const referenceLead = /^\s*(?:please\s+(?:explain|tell\s+me|describe|outline)\s+|(?:regarding|about|concerning|as\s+for|in\s+relation\s+to|with\s+(?:regard|respect|reference)\s+to|for)\s+)/i.exec(query);
  if (!referenceLead) return false;
  const remainder = query.slice(referenceLead[0].length);
  const leadingExplicitSubject = new RegExp(
    `^(?:${EXPLICIT_ADJECTIVE_SUBJECT_SOURCE}|${SUBJECT_DISCUSSION_CLAUSE_SOURCE})`,
    'i'
  );
  return leadingExplicitSubject.test(remainder) && hasExplicitPriorFactReference(query);
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
  const wordCount = q.split(/\s+/).filter(Boolean).length;
  const isShortFactReply = wordCount <= 4 || /^(?:sgd|usd|eur|s\$|\$)?\s*[\d,]+(?:\.\d+)?\s*(?:k|m|million|thousand)?$/i.test(q);
  const continuationSignal = /\b(what if|instead|then|also|same|above|that|this|these|those|it|they|discussed|mentioned|settle|settlement|recover|show|repeat|clarif)/i.test(q);
  const explicitNewSignal = /\b(new (?:case|scenario|situation|question|transaction|analysis|example)|unrelated|(?:separate|different) (?:case|scenario|situation|analysis|question|transaction|example))\b/i.test(q) ||
    hasAffirmativeResetDirective(query);

  if (explicitNewSignal) return 'NEW';
  if (isJournalDisplayRequest(query) || hasExplicitPriorFactReference(query)) return 'RELATED';
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
  const transactionActionPattern = /\b(bought|purchased|acquired|sold|disposed of|entered into|signed|leased|issued|subscribed|borrowed|took out|hired)\b/gi;
  const transactionActions = [...q.matchAll(transactionActionPattern)];
  const startsNewTransaction = transactionActions.length > 0;
  // "$2,000" begins with a non-word character, so it cannot have a word
  // boundary immediately before it. Keep currency codes word-bounded while
  // accepting the standalone dollar symbol as an amount marker.
  const hasTransactionDetail = /(?:\b(?:sgd|usd|eur|s\$)\s*[\d,]+|\$\s*[\d,]+|\b\d+(?:\.\d+)?\s*(?:k|million|years?|months?|%))\b/.test(q);
  const hasNewSubject = /\b((?:new|another|additional|second|different)\s+(?:[a-z]+\s+)?(?:machines?|machinery|equipment|vehicles?|assets?|leases?|premises|loans?|shares?|customers?|suppliers?|employees?|workers?|staff)|machine|machinery|equipment|vehicle|lease|premises|share capital|payroll|salary|customer|supplier)\b/.test(q);

  // A company-paid fine or private/director cost is a new transaction even
  // when its narrative uses “paid”; it must never be attached to an earlier
  // payable merely because both messages describe cash outflows.
  const isIndependentPersonalCost = /\b(fine|penalt(?:y|ies)|traffic offence|personal expense|private expense)\b/.test(q) &&
    /\b(director|shareholder|owner|company)\b/.test(q) && hasTransactionDetail;
  if (isIndependentPersonalCost) return true;

  // A contextual statutory question may repeat the transaction wording and
  // amount while asking about its treatment.
  if (startsWithPriorFactReference(query)) {
    const leadingReferenceClause = query.split(/[,.;:!?]/, 1)[0];
    const leadingReferenceCanRestateAction = /\b(?:purchase|transaction|asset|equipment|machine|machinery|vehicle|lease|contract|arrangement|loan|shares?|employee|worker|staff|salary|payroll|scenario|situation|case|example|facts?|details?|discussion|conversation|analysis)\b/i.test(leadingReferenceClause);
    const hasSubsequentFollowUpReference = /\b(?:the|this|that|our)\s+(?:additional|second|subsequent)\s+(?:purchase|acquisition|transaction)\b/i.test(q);
    return transactionActions.some(action => {
      const actionIndex = action.index ?? 0;
      const actionEnd = actionIndex + action[0].length;
      const actionObject = q.slice(actionEnd);
      const actionClauseAfter = actionObject.split(/[.!?;]/, 1)[0];
      const actionLead = q.slice(0, actionIndex).split(/[.!?;](?=\s+)/).at(-1) ?? '';
      const hasSeparateObject = /\b(?:new|another|additional|second|different)\s+(?:[a-z]+\s+)?(?:machines?|machinery|equipment|vehicles?|assets?|leases?|premises|loans?|shares?|customers?|suppliers?|employees?|workers?|staff|purchases?|acquisitions?|transactions?)\b/i.test(actionClauseAfter.split(/[,:]/, 1)[0]);
      const hasIndefiniteOrQuantifiedObject = /^\s+(?:(?:a|an|some|new|more|additional|two|three|four|five|\d+)\s+)?(?:[a-z]+\s+){0,2}(?:machines?|machinery|equipment|vehicles?|assets?|leases?|premises|loans?|shares?|customers?|suppliers?|employees?|workers?|staff|purchases?|acquisitions?|transactions?)\b/i.test(actionClauseAfter);
      const hasSubsequentOrAdditiveAction = /\b(?:(?:we|the company|our company|i)\s+)?(?:subsequently|later|afterwards|then|again|also|additionally|separately)(?:,\s*)?\s+(?:(?:we|the company|our company|i)\s+)?$/i.test(actionLead);
      const isConditionalAction = /(?:^\s*|[,;]\s*|\b(?:and|but)\s+)(?:what\s+if|if|suppose(?:\s+that)?|assuming(?:\s+that)?)\b[^.!?;]*$/i.test(actionLead);
      const isInterrogativeConditionalAction = /\b(?:what|how)\b[^.!?;]*\bif\s+(?:[a-z]+\s+){0,3}(?:subsequently|later|afterwards|then|also)?\s*$/i.test(actionLead);
      const isModalAction = /\b(?:could|would|should|might|may|can)(?:\s+(?:i|we|they|he|she|it|the\s+company|our\s+company))?(?:\s+not)?(?:\s+(?:subsequently|later|afterwards|then|possibly|potentially|still|instead|also))*\s+(?:have|be)(?:\s+(?:subsequently|later|afterwards|then|possibly|potentially|still|instead|also))*\s*$/i.test(actionLead);
      const isHypothetical = isConditionalAction || isInterrogativeConditionalAction || isModalAction;
      if (isHypothetical) return false;
      if (hasSeparateObject && (hasTransactionDetail || hasNewSubject || hasSubsequentOrAdditiveAction)) return true;
      if ((hasSubsequentOrAdditiveAction || hasSubsequentFollowUpReference) && hasIndefiniteOrQuantifiedObject) return true;
      return !leadingReferenceCanRestateAction && hasTransactionDetail && hasNewSubject && hasIndefiniteOrQuantifiedObject;
    });
  }

  // A complete narrative supersedes the active workflow even when both
  // transactions are in the same accounting domain.
  if (startsNewTransaction && hasTransactionDetail && hasNewSubject) return true;

  const activeType = context?.underlyingTransaction?.type || currentScenario?.semanticUnderstanding?.transactionType;
  const newDomain = q.includes('machine') || q.includes('machinery') || q.includes('equipment') || q.includes('vehicle')
    ? 'asset_purchase'
    : q.includes('share capital') || q.includes('shareholder') || q.includes('subscriber')
      ? 'share_capital_issuance'
      : q.includes('lease') || q.includes('rental')
        ? 'lease_contract'
        : q.includes('payroll') || q.includes('salary') || q.includes('cpf')
          ? 'payroll_payment'
          : undefined;

  return Boolean(startsNewTransaction && newDomain && activeType && newDomain !== activeType);
}
