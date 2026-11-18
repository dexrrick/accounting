import type { AccountingScenarioState } from '../types/accounting';
import type { ChatMessage } from '../types/accounting';
import type { ConversationAccountingContext } from '../types/conversationState';
import { isSingleMonthlySalaryAmendment, resolveFactAmendment } from './factAmendmentService';

export type ConversationRelation = 'RELATED' | 'NEW' | 'AMBIGUOUS';

/** A journal-display request reads an existing result and should not be routed as a transaction. */
export function isJournalDisplayRequest(query: string): boolean {
  return /^\s*(?:(?:where(?:\s+is|\s*'s)|what(?:\s+is|\s*'s))\s+(?:your\s+|the\s+|last\s+)?(?:double\s+entry|journal(?:\s+entry)?)|(?:show|repeat|display|give(?:\s+me)?|provide)\s+(?:(?:me\s+)?|your\s+|the\s+|last\s+)?(?:double\s+entry|journal(?:\s+entry)?))\s*\?*\s*$/i.test(query);
}

const PRIOR_SUBJECT_NOUNS = '(?:transaction|transactions|expense|expenses|purchase|purchases|supply|supplies|invoice|invoices|amount|amounts|facts?|details?|asset|assets|equipment|machine|machinery|salary|salaries|payroll|employee|employees|worker|workers|staff|scenario|scenarios|situation|situations|case|cases|example|examples|payment|payments|contract|contracts|lease|leases|arrangement|arrangements|deadline|deadlines|rate|rates|calculation|calculations|journal|journals|entry|entries|answer|discussion|conversation|analysis)';
const PRIOR_ADJECTIVE_MODIFIER = '(?:(?!year\\b|years\\b|period\\b|periods\\b|month\\b|months\\b|quarter\\b|quarters\\b|fy\\b|ya\\b)[a-z]+\\s+){0,2}';
const EXPLICIT_ADJECTIVE_SUBJECT_SOURCE = `(?:earlier|previous|prior|above|last|foregoing|aforementioned|preceding)\\s+${PRIOR_ADJECTIVE_MODIFIER}${PRIOR_SUBJECT_NOUNS}\\b`;
const SUBJECT_DISCUSSION_CLAUSE_SOURCE = `(?:the|our|my|this|that|these|those)\\s+(?:[a-z]+\\s+){0,2}${PRIOR_SUBJECT_NOUNS}\\s+(?:(?:that|which|whom|who)\\s+)?(?:(?:we|you|i)\\s+(?:just\\s+|earlier\\s+|previously\\s+)?(?:discussed|mentioned|described|covered|talked\\s+about|referred\\s+to|looked\\s+at|used|gave|calculated|established)|(?:was|were)\\s+(?:just\\s+|earlier\\s+|previously\\s+)?(?:discussed|mentioned|described|covered|provided|stated|established)\\b|(?:discussed|mentioned|described|provided|stated|noted|shown)\\s+(?:above|earlier|before|previously)\\b|(?:above|previously|earlier(?!\\s+(?:this|last|next|in)\\s+(?:year|month|quarter|week|period)\\b))\\b)`;

/** Detects an affirmative instruction to ignore, disregard, or forget prior conversation context. */
export function hasAffirmativeResetDirective(query: string): boolean {
  const withoutNegatedReset = query.replace(
    /\b(?:(?:do\s+not|don['’]?t|dont|never|cannot|can['’]?t|cant|should\s+not|shouldn['’]?t|shouldnt|must\s+not|mustn['’]?t|mustnt|need\s+not|needn['’]?t|neednt)|not\s+to)\s+(?:(?:please|ever|just|simply|accidentally)\s+)*(?:ignore|disregard|forget|omit|drop|discard)(?:\s+(?:or|nor)\s+(?:ignore|disregard|forget|omit|drop|discard))*\b/gi,
    ' '
  );
  return /\b(?:ignore|disregard|forget)\b[^.!?]{0,100}\b(?:earlier|previous|prior|above|last|case|scenario|situation|question|context|transaction|example|employee|employees|worker|workers|staff|discussion|analysis|discussed|mentioned|that|this|these|those)\b/i.test(withoutNegatedReset);
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
  const explicitDiscussionVerb = /\b(?:discussed|mentioned|provided|stated|described|noted|shown)\s+(?:earlier|previously|above|before)\b/i;

  return explicitAdjectiveSubject.test(text) ||
    subjectDiscussionClause.test(text) ||
    explicitDiscussionVerb.test(text);
}

function startsWithPriorFactReference(query: string): boolean {
  const referenceLead = /^\s*(?:please\s+(?:explain|tell\s+me|describe|outline)\s+|(?:regarding|about|concerning|as\s+for|in\s+relation\s+to|with\s+(?:regard|respect|reference)\s+to|for)\s+)/i.exec(query);
  if (!referenceLead) return false;
  const remainder = query.slice(referenceLead[0].length);
  const leadingExplicitSubject = new RegExp(
    `^(?:(?:(?:the|our|my|this|that|these|those)\\s+)?${EXPLICIT_ADJECTIVE_SUBJECT_SOURCE}|${SUBJECT_DISCUSSION_CLAUSE_SOURCE})`,
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
  const transactionAction = /\b(bought|purchased|acquired|sold|disposed of|entered into|signed|issued|subscribed|borrowed|took out|hired)\b/i.exec(query);
  const startsNewTransaction = Boolean(transactionAction);
  // "$2,000" begins with a non-word character, so it cannot have a word
  // boundary immediately before it. Keep currency codes word-bounded while
  // accepting the standalone dollar symbol as an amount marker.
  const hasTransactionDetail = /(?:\b(?:sgd|usd|eur|s\$)\s*[\d,]+|\$\s*[\d,]+|\b\d+(?:\.\d+)?\s*(?:k|million|years?|months?|%))\b/.test(q);
  const hasNewSubject = /\b(new\s+(?:machine|machinery|equipment|vehicle|asset|lease|loan|shares?|employee|worker)|machine|machinery|equipment|vehicle|lease|share capital|payroll|salary|customer|supplier)\b/.test(q);

  // A company-paid fine or private/director cost is a new transaction even
  // when its narrative uses “paid”; it must never be attached to an earlier
  // payable merely because both messages describe cash outflows.
  const isIndependentPersonalCost = /\b(fine|penalt(?:y|ies)|traffic offence|personal expense|private expense)\b/.test(q) &&
    /\b(director|shareholder|owner|company)\b/.test(q) && hasTransactionDetail;
  if (isIndependentPersonalCost) return true;

  const actionFollowedByNewSubject = Boolean(transactionAction &&
    /\b(?:new|another)\s+(?:machine|machinery|equipment|vehicle|asset|lease|loan|shares?|customer|supplier|employee|worker)\b/i.test(
      query.slice(transactionAction.index + transactionAction[0].length).split(/[,.!?;:]/, 1)[0]
    ));
  if (actionFollowedByNewSubject && hasTransactionDetail && hasNewSubject) return true;

  // A contextual statutory question may repeat the transaction wording and
  // amount while asking about its treatment.
  if (startsWithPriorFactReference(query)) return false;

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
