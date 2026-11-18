import type { AccountingScenarioState } from '../types/accounting';
import type { ChatMessage } from '../types/accounting';
import type { ConversationAccountingContext } from '../types/conversationState';
import { isSingleMonthlySalaryAmendment, resolveFactAmendment } from './factAmendmentService';

const ACTION_MODIFIERS = String.raw`(?:\s+(?:[a-z]+ly|also|again|still|instead|later|afterwards|then|not|even|just|already|ever|never|well))*`;
const HYPOTHETICAL_MODAL_ACTION = new RegExp(
  String.raw`\b(?:could|would|should|might|may|can)(?:\s+(?:i|we|they|he|she|it|the\s+company|our\s+company))?${ACTION_MODIFIERS}\s+(?:have|be)${ACTION_MODIFIERS}\s*$`,
  'i'
);
const ACTION_MODIFIERS_ONLY = new RegExp(`^(?:\\s+had)?${ACTION_MODIFIERS}\\s*$`, 'i');

export type ConversationRelation = 'RELATED' | 'NEW' | 'AMBIGUOUS';

/** A journal-display request reads an existing result and should not be routed as a transaction. */
export function isJournalDisplayRequest(query: string): boolean {
  return /^\s*(?:(?:where(?:\s+is|\s*'s)|what(?:\s+is|\s*'s))\s+(?:your\s+|the\s+|last\s+)?(?:double\s+entry|journal(?:\s+entry)?)|(?:show|repeat|display|give(?:\s+me)?|provide)\s+(?:(?:me\s+)?|your\s+|the\s+|last\s+)?(?:double\s+entry|journal(?:\s+entry)?))\s*\?*\s*$/i.test(query);
}

/** Recognizes a longer question that explicitly refers to facts from earlier turns. */
export function hasExplicitPriorFactReference(query: string): boolean {
  const text = query.trim();
  const isContextualQuestion = /^(?:(?:please\s+)?(?:regarding|about|concerning|as\s+for|in\s+relation\s+to|with\s+(?:regard|respect|reference)\s+to|for|explain|tell\s+me|describe|outline)|(?:what|how|can|could|would|should|does|do|is|are))\b/i.test(text);
  if (!text || !isContextualQuestion ||
      /\b(?:new|different|separate|unrelated)\s+(?:question|transaction|analysis|case|scenario|situation)\b|\b(?:separate|different|unrelated|distinct)\s+from\b|\b(?:ignore|disregard|forget)\b[^.!?]{0,100}\b(?:earlier|previous|prior|above|last|case|scenario|situation|question|context)\b/i.test(text)) {
    return false;
  }

  return /\b(?:earlier|previous|prior|above|last)\s+(?:(?:supplier|business|equipment|machine|company)\s+){0,2}(?:transaction|expense|purchase|invoice|amount|facts?|details?|asset|equipment|machine|salary|payroll|scenario|situation|case|answer|discussion|conversation)\b|\b(?:discussed|mentioned|provided|stated|described)\s+(?:earlier|previously|above)\b/i.test(text);
}

function startsWithPriorFactReference(query: string): boolean {
  const referenceLead = /^\s*(?:please\s+(?:explain|tell\s+me|describe|outline)\s+|(?:regarding|about|concerning|as\s+for|in\s+relation\s+to|with\s+(?:regard|respect|reference)\s+to|for)\s+)/i.exec(query);
  return Boolean(referenceLead &&
    /^(?:(?:the|our|my|this|that)\s+)?(?:earlier|previous|prior|above|last)\s+(?:(?:supplier|business|equipment|machine|company)\s+){0,2}(?:transaction|expense|purchase|invoice|amount|facts?|details?|asset|equipment|machine|salary|payroll|scenario|situation|case|answer|discussion|conversation)\b/i.test(query.slice(referenceLead[0].length)) &&
    hasExplicitPriorFactReference(query));
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
  const continuationSignal = /\b(what if|instead|then|also|same|previous|prior|earlier|above|that|this|these|those|it|they|discussed|mentioned|settle|settlement|recover|double entry|journal entry|show|repeat|clarif)/i.test(q);
  const explicitNewSignal = /\b(new (?:case|scenario|situation|question|transaction|analysis|example)|unrelated|(?:separate|different) (?:case|scenario|situation|analysis|question|transaction|example)|(?:ignore|disregard|forget)\b[^.!?]{0,100}\b(?:earlier|previous|prior|above|last|case|scenario|situation|question|context|transaction|example|employee|employees|discussion|analysis|discussed|mentioned|that|this|these|those))\b/i.test(q);

  if (explicitNewSignal) return 'NEW';
  if (hasExplicitPriorFactReference(query)) return 'RELATED';
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
  const transactionActionPattern = /\b(bought|purchased|acquired|sold|disposed of|entered into|signed|issued|subscribed|borrowed|took out|hired)\b/gi;
  const transactionActions = [...q.matchAll(transactionActionPattern)];
  const startsNewTransaction = transactionActions.length > 0;
  // "$2,000" begins with a non-word character, so it cannot have a word
  // boundary immediately before it. Keep currency codes word-bounded while
  // accepting the standalone dollar symbol as an amount marker.
  const hasTransactionDetail = /(?:\b(?:sgd|usd|eur|s\$)\s*[\d,]+|\$\s*[\d,]+|\b\d+(?:\.\d+)?\s*(?:k|million|years?|months?|%))\b/.test(q);
  const hasNewSubject = /\b(new\s+(?:machine|machinery|equipment|vehicle|asset|lease|loan|shares?)|machine|machinery|equipment|vehicle|lease|share capital|payroll|salary|customer|supplier)\b/.test(q);

  // A company-paid fine or private/director cost is a new transaction even
  // when its narrative uses “paid”; it must never be attached to an earlier
  // payable merely because both messages describe cash outflows.
  const isIndependentPersonalCost = /\b(fine|penalt(?:y|ies)|traffic offence|personal expense|private expense)\b/.test(q) &&
    /\b(director|shareholder|owner|company)\b/.test(q) && hasTransactionDetail;
  if (isIndependentPersonalCost) return true;

  // An opening reference to an earlier transaction makes a later “new
  // machine” ambiguous. Reset only for an explicitly additional object or a
  // subsequent action with its own identifiable object.
  if (startsWithPriorFactReference(query)) {
    return transactionActions.some(action => {
      const actionIndex = action.index ?? 0;
      const actionEnd = actionIndex + action[0].length;
      const actionObject = q.slice(actionEnd);
      const actionLead = q.slice(0, actionIndex).split(/[.!?;](?=\s+)/).at(-1) ?? '';
      const hasSeparateObject = /^\s+(?:(?:a|an|the)\s+)?(?:another|additional|second|different)\s+(?:new\s+)?(?:machine|machinery|equipment|vehicle|asset|lease|loan|shares?|purchase|acquisition|transaction)\b/i.test(actionObject);
      const hasIndefiniteObject = /^\s+a(?:n)?\s+(?:new\s+)?(?:machine|machinery|equipment|vehicle|asset|lease|loan|shares?|purchase|acquisition|transaction)\b/i.test(actionObject) ||
        /^\s+(?:(?:some|new)\s+)?(?:equipment|machinery)\b/i.test(actionObject);
      const hasDefiniteNewObject = /^\s+(?:(?:the|our|your|my|its|their|his|her)\s+)new\s+(?:machine|machinery|equipment|vehicle|asset|lease|loan|shares?|purchase|acquisition|transaction)\b/i.test(actionObject);
      const hasSubsequentAction = /\b(?:(?:we|the company)\s+)?(?:subsequently|later|afterwards|then|again)(?:,\s*)?\s+(?:(?:we|the company)\s+)?$/i.test(actionLead);
      const frontedConditionalAction = /(?:^\s*|[,;]\s*|\b(?:and|but)\s+)((?:what\s+)?if|suppose|assuming)\b[^.!?;]*$/i.exec(actionLead);
      const ifClauseLead = actionLead.split(/\bif\b/i).slice(1).at(-1) ?? '';
      const hasCompletedIfBeforeContrast = /,[^,]+,\s*but\b/i.test(ifClauseLead);
      const ifClauseAfterContrast = ifClauseLead.split(/,\s*but\b/i).slice(1).at(-1) ?? '';
      const hasIndependentIfContrast = !ACTION_MODIFIERS_ONLY.test(ifClauseAfterContrast);
      const frontedMarkerIsIf = /^(?:what\s+)?if$/i.test(frontedConditionalAction?.[1] ?? '');
      const isFrontedConditionalAction = Boolean(frontedConditionalAction &&
        !(frontedMarkerIsIf && hasCompletedIfBeforeContrast));
      const actionLeadWithIfAsideRemoved = actionLead.replace(/\bif\s*,\s*[^,]+,\s*/gi, 'if ');
      const finalActionClause = actionLeadWithIfAsideRemoved.split(/[,;]|\b(?:and|but)\b/i).at(-1) ?? '';
      // A contrast that shares the subject can still be part of the embedded condition.
      const isEmbeddedConditionalAction = /\bif\b/i.test(finalActionClause) ||
        (!hasIndependentIfContrast && Boolean(ifClauseLead.match(transactionActionPattern)));
      // Keep the modal tied to an auxiliary immediately before the purchase verb.
      const isModalAction = HYPOTHETICAL_MODAL_ACTION.test(actionLead);
      const isHypothetical = isFrontedConditionalAction || isEmbeddedConditionalAction || isModalAction;
      return !isHypothetical && (hasSeparateObject ||
        (hasSubsequentAction && (hasIndefiniteObject || hasDefiniteNewObject)));
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
