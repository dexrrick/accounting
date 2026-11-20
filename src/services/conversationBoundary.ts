import type { AccountingScenarioState } from '../types/accounting';
import type { ChatMessage } from '../types/accounting';
import type { ConversationAccountingContext } from '../types/conversationState';
import { isSingleMonthlySalaryAmendment, resolveFactAmendment } from './factAmendmentService';

const ACTION_MODIFIER = '[a-z]+ly|also|again|still|instead|later|afterwards|then|not|even|just|already|ever|never|well';
const ACTION_MODIFIERS = String.raw`(?:\s+(?:${ACTION_MODIFIER}))*`;
const NEGATED_ACTION = new RegExp(
  String.raw`\b(?:never|not(?!\s+(?:only|just|merely|simply)\b)|[a-z]+n['’]t)\b(?:\s+(?:${ACTION_MODIFIER}|yet|in\s+fact)|\s*,\s*in\s+fact\s*,)*\s*$`,
  'i'
);
const HYPOTHETICAL_MODAL_ACTION = new RegExp(
  String.raw`\b(?:could|would|should|might|may|can)(?:\s+(?:i|we|they|he|she|it|the\s+company|our\s+company))?${ACTION_MODIFIERS}\s+(?:have|be)${ACTION_MODIFIERS}\s*$`,
  'i'
);
const ACTION_MODIFIERS_ONLY = new RegExp(`^(?:\\s+had)?${ACTION_MODIFIERS}\\s*$`, 'i');

const INTERROGATIVE_AUXILIARY_BASE = '(?:can|could|will|would|shall|should|may|might|do|does|did|is|are|was|were|has|have|had)';
const INTERROGATIVE_AUXILIARY = `(?:${INTERROGATIVE_AUXILIARY_BASE}|${INTERROGATIVE_AUXILIARY_BASE}n['’]t|can['’]t|cannot|won['’]t|shan['’]t)`;
const INTERROGATIVE_WORD = '(?:what|how|when|where|why|which|who)';
const CURRENT_INTERROGATIVE_HEAD = new RegExp(
  String.raw`(?:^|[,;.:])\s*(?:(?:how\s+(?:much|many)|what|which)(?:\s+(?!\b(?:${INTERROGATIVE_AUXILIARY}|i|we|you|they|he|she|it|that|whether|if)\b)[a-z]+){0,6}\s+${INTERROGATIVE_AUXILIARY}\s+(?!\b(?:whether|if|that)\b)\w+\b|(?:${INTERROGATIVE_WORD}\s+)?${INTERROGATIVE_AUXILIARY}\s+\w+\b[^.!?]*$)`,
  'i'
);

const MONTH_NAME = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const CALENDAR_DATE = String.raw`(?:\d{1,2}(?:st|nd|rd|th)?\s+${MONTH_NAME}(?:\s+\d{4})?|\d{1,2}[/-]\d{1,2}[/-]\d{4})`;
const PAST_TIME_ANCHOR = String.raw`(?:yesterday|last\s+(?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|on\s+(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|${CALENDAR_DATE}))`;
const REPORTED_QUESTION_ATTRIBUTION = new RegExp(
  String.raw`\b(?:wrote|asked|said|advised|emailed|messaged|told|reported|requested)(?:\s+(?:me|us|them|him|her))?(?:\s+(?:earlier|previously|${PAST_TIME_ANCHOR}))?\s*:\s*(?<quote>["\u201c\u2018'])?`,
  'i'
);
// Single marks within words or after possessive s before another word are apostrophes.
const REPORT_CLOSING_QUOTE = new Map([
  ['"', /"/],
  ["'", /'(?![\p{L}\p{N}]|(?<=s')\s+[\p{L}\p{N}])/u],
  ['\u201c', /\u201d/],
  ['\u2018', /\u2019(?![\p{L}\p{N}]|(?<=s\u2019)\s+[\p{L}\p{N}])/u]
]);
const DECLARATIVE_ACTION_SUBJECT = String.raw`(?:i|we|you|they|he|she|it|(?:the|our)\s+company)`;
const REPORTED_CONDITIONAL_HEAD = /^(?:(?:what\s+)?if|unless|suppose|assuming)\b/i;
const REPORTED_CONDITION = /\b(?:if|unless|suppose|assuming)\b/i;
const PURCHASE_CONFIRMATION_RECIPIENT = '(?:\\s+with\\s+(?:(?:the|our|my|your)\\s+)?[a-z]+(?:\\s+[a-z]+){0,2})?';
const PURCHASE_CONFIRMATION_PREFIX = new RegExp(
  '\\bconfirm' + PURCHASE_CONFIRMATION_RECIPIENT + '(?:\\s+(?:that|whether|if))?\\s*$',
  'i'
);
const ADDITIONAL_ASSET_OBJECT = String.raw`(?:(?:a|an|the)\s+)?(?:another|additional|second|different)\s+(?:new\s+)?(?<asset>machine|machinery|equipment|vehicle|asset)`;
const REPORTED_ADDITIONAL_PURCHASE = new RegExp(
  String.raw`\b${ADDITIONAL_ASSET_OBJECT}\s+(?:(?:that|which)\s+)?${DECLARATIVE_ACTION_SUBJECT}(?:\s+(?:have|had))?(?:\s+actually)?\s+(?:bought|purchased|acquired)\b`,
  'i'
);
const REPORTED_EXISTENTIAL_QUESTION_PREFIX = new RegExp(
  String.raw`\b${INTERROGATIVE_AUXILIARY}\s+there${ACTION_MODIFIERS}(?:\s+(?:be|been)${ACTION_MODIFIERS}|\s+have${ACTION_MODIFIERS}\s+been${ACTION_MODIFIERS})?\s*$`,
  'i'
);

const REPORTED_SUBJECT_FIRST_PURCHASE = new RegExp(
  String.raw`\b${DECLARATIVE_ACTION_SUBJECT}(?:\s+(?<perfectAuxiliary>have|had))?(?:\s+actually)?\s+(?:bought|purchased|acquired)\s+${ADDITIONAL_ASSET_OBJECT}\b`,
  'i'
);
const COMPLETED_TEMPORAL_PURCHASE_LEAD = /\b(?:after|once|when)\s*$/i;
const REPORTED_PURCHASE_ADJUNCT = /^\s*(?:(?:for|in|on|at|during|since|from|to|with|without|through|by|before|after|last|yesterday|today|recently|already|just|subsequently|later|outright|and)\b|[,.!?;]|$)/i;
const CONFIRMATION_QUESTION_TAG = /,\s*(?:correct|right)\s*\?\s*$/i;
const PURCHASE_CONFIRMATION_TAG_AUXILIARY = `(?:${INTERROGATIVE_AUXILIARY}|mustn['’]t)`;
const PURCHASE_CONFIRMATION_TAG = new RegExp(
  String.raw`,\s*(?:(?:correct|right)\s*\?|${PURCHASE_CONFIRMATION_TAG_AUXILIARY}\s+(?:i|we|you|they|he|she|it)(?:\s+(?:really|actually|definitely))?\s*\?)\s*$`,
  'i'
);
const PURCHASE_TAG_TIME = String.raw`(?:${PAST_TIME_ANCHOR}|this\s+(?:morning|afternoon|evening)|at\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))`;
const PURCHASE_TAG_ADJUNCT = new RegExp(
  String.raw`^(?:\s+(?:for\s+(?:(?:sgd|usd|eur|s?\$)\s*)?\d+(?:,\d{3})*(?:\.\d+)?|${PURCHASE_TAG_TIME})){0,2}\s*$`,
  'i'
);
const REPORTED_HYPOTHETICAL_PURCHASE_QUALIFIER =
  /\b(?:hypothetically|(?:in|as)\s+a\s+hypothetical\s+(?:scenario|case|example))\b/i;
const PURCHASE_UNCERTAINTY_ADJECTIVE = '(?:possible|impossible|sure|certain|likely|unlikely|clear|unclear|uncertain|doubtful)';
const HOW_LIKELY_PURCHASE_QUESTION = String.raw`how\s+(?:likely|possible|probable|unlikely)\s+(?:is|are|was|were)\s+(?:it|that)(?:\s+(?:that|whether|if))?`;
const PURCHASE_UNCERTAINTY_LEAD = new RegExp(
  String.raw`(?:\b${PURCHASE_UNCERTAINTY_ADJECTIVE}\s+(?:(?:that|whether|if)\s*)?|\b(?:could|can|might|may|would|should)\s+it\s+be\s+(?:that|whether|if)\s*|\b${HOW_LIKELY_PURCHASE_QUESTION}\s*)$`,
  'i'
);
const PURCHASE_UNCERTAINTY_QUESTION_HEAD = new RegExp(`^${HOW_LIKELY_PURCHASE_QUESTION}\\b`, 'i');

const REPORTED_EXISTENTIAL_QUESTION_WRAPPER = String.raw`${INTERROGATIVE_AUXILIARY}\s+(?:it|we|you|they|he|she)\s+(?:be(?:\s+${PURCHASE_UNCERTAINTY_ADJECTIVE})?|${PURCHASE_UNCERTAINTY_ADJECTIVE})\s+(?:(?:that|whether)\s+)?`;
const REPORTED_WRAPPED_EXISTENTIAL_QUESTION_PREFIX = new RegExp(
  String.raw`^\s*(?:(?:and|but|so)\s+)*(?:${REPORTED_EXISTENTIAL_QUESTION_WRAPPER}|${HOW_LIKELY_PURCHASE_QUESTION}\s+)there${ACTION_MODIFIERS}\s+(?:is|are|was|were|(?:has|have|had)${ACTION_MODIFIERS}\s+been)${ACTION_MODIFIERS}\s*$`,
  'i'
);

function findAttachedHypotheticalPurchaseQualifier(purchaseTail: string): RegExpExecArray | null {
  const qualifier = REPORTED_HYPOTHETICAL_PURCHASE_QUALIFIER.exec(purchaseTail);
  // A separate clause before the qualifier can describe its own hypothetical.
  return qualifier && PURCHASE_TAG_ADJUNCT.test(purchaseTail.slice(0, qualifier.index).replace(/,\s*$/, ''))
    ? qualifier
    : null;
}

function isSubjectFirstPurchaseQuestioned(
  subjectPrefix: string,
  allowCompletedTemporalPremise = false
): boolean {
  const prefix = subjectPrefix.trim().replace(/^(?:(?:and|but|so)\s+)+/i, '');
  const isExplicitlyQuestioned = /\bwhether\b|\b(?:if|could|would|should|might|may|can)\s*$/i.test(prefix) ||
    new RegExp('^\\s*' + INTERROGATIVE_AUXILIARY + '\\s*$', 'i').test(prefix) ||
    PURCHASE_CONFIRMATION_PREFIX.test(prefix) ||
    PURCHASE_UNCERTAINTY_QUESTION_HEAD.test(prefix);
  const isGeneralInterrogative = CURRENT_INTERROGATIVE_HEAD.exec(prefix)?.index === 0;
  const allowsTemporalPremise = allowCompletedTemporalPremise &&
    !/\b(?:would|hypothetical(?:ly)?)\b/i.test(prefix);
  const isQuestioned = isExplicitlyQuestioned || (isGeneralInterrogative && !allowsTemporalPremise);
  const assertedBackground = /\b(?:now\s+that|since|because|given\s+that)\s*$/i.test(prefix);
  return isQuestioned && !assertedBackground;
}

function isReportedPurchaseTagQuestion(sentence: string): boolean {
  const text = sentence.trimStart();
  const tag = PURCHASE_CONFIRMATION_TAG.exec(text);
  if (!tag) return false;
  const purchase = REPORTED_SUBJECT_FIRST_PURCHASE.exec(text);
  // A tag after another clause can ask about that clause while the purchase remains factual.
  return purchase?.index === 0 && PURCHASE_TAG_ADJUNCT.test(text.slice(purchase[0].length, tag.index));
}

const PURCHASE_NEGATION_ADVERB = '(?:actually|really|indeed|certainly|definitely|in fact)';
const REPORTED_CLAUSE_END = /[!?;]|(?<!approx)\.(?=\s|$)/;

function isSeparateQuestion(question: string, separator = ''): boolean {
  const text = question.trim();
  const isBareCommaWhichClause = /^,\s*$/.test(separator) &&
    new RegExp(`^which\\s+${INTERROGATIVE_AUXILIARY}\\b`, 'i').test(text);
  const allowsAnyFragment = !separator || /\b(?:but|so)\s*$/i.test(separator);
  return (!isBareCommaWhichClause && CURRENT_INTERROGATIVE_HEAD.exec(text)?.index === 0) ||
    /^(?:what|how|why)\b/i.test(text) ||
    (allowsAnyFragment && /^any\b/i.test(text));
}

function findSeparateQuestionAfterCorrection(questionScope: string): string | undefined {
  const questionLeads = /(?:,\s*(?:(?:so|and|but)\s+)?|\s+(?:so|and|but)\s+)/gi;
  let questionLead: RegExpExecArray | null;
  while ((questionLead = questionLeads.exec(questionScope)) !== null) {
    const questionText = questionScope.slice(questionLead.index + questionLead[0].length).replace(/[.!?]+\s*$/, '');
    if (isSeparateQuestion(questionText, questionLead[0])) return questionText;
  }
  return undefined;
}

type ReportedPurchaseCorrection = { match: RegExpExecArray; followingQuestion?: string };

function findExplicitPurchaseCorrection(text: string, asset: string | undefined): ReportedPurchaseCorrection | null {
  if (!asset) return null;
  const negatedPurchaseOfReportedAsset = new RegExp(
    String.raw`\b(?:i|we|the company)\s+(?:(?:${PURCHASE_NEGATION_ADVERB})\s+)*(?:(?:have|had)\s+)?(?:(?:${PURCHASE_NEGATION_ADVERB})\s+)*(?:never|not|didn['’]t|did\s+not|hadn['’]t|had\s+not|haven['’]t|have\s+not)\s+(?:(?:${PURCHASE_NEGATION_ADVERB})\s+)*(?:buy|bought|purchase(?:d)?|acquire(?:d)?)\s+(?:(?:that|the|a|an|another)\s+)?(?:second\s+)?${asset}\b|\b(?:that|the|a|an|another)\s+(?:second\s+)?${asset}\s+(?:(?:was|is|has been|had been)\s+)?(?:(?:${PURCHASE_NEGATION_ADVERB})\s+)*(?:never|not)\s+(?:(?:${PURCHASE_NEGATION_ADVERB})\s+)*(?:bought|purchased|acquired)\b`,
    'gi'
  );
  for (const correction of text.matchAll(negatedPurchaseOfReportedAsset)) {
    const clauseLead = text.slice(0, correction.index).split(/[.!?;]/).at(-1) ?? '';
    const correctionEnd = (correction.index ?? 0) + correction[0].length;
    const correctionRemainder = text.slice(correctionEnd);
    const nextClauseBoundary = REPORTED_CLAUSE_END.exec(correctionRemainder);
    const correctionClauseEnd = nextClauseBoundary ? nextClauseBoundary.index + 1 : correctionRemainder.length;
    const questionScope = correctionRemainder.slice(0, correctionClauseEnd);
    const endsInQuestion = nextClauseBoundary?.[0] === '?';
    let followingQuestion = endsInQuestion ? findSeparateQuestionAfterCorrection(questionScope) : undefined;
    if (endsInQuestion && (PURCHASE_CONFIRMATION_TAG.test(questionScope) || !followingQuestion)) continue;
    if (isSubjectFirstPurchaseQuestioned(clauseLead) || REPORTED_CONDITION.test(clauseLead) ||
        PURCHASE_UNCERTAINTY_LEAD.test(clauseLead)) continue;

    // A separate question can start in the same sentence or immediately after
    // the correction. Its punctuation cannot change whether the retraction was asked.
    if (nextClauseBoundary && !endsInQuestion) {
      const nextClause = correctionRemainder.slice(correctionClauseEnd).trimStart();
      const nextQuestionEnd = REPORTED_CLAUSE_END.exec(nextClause);
      if (nextQuestionEnd?.[0] === '?') {
        const question = nextClause.slice(0, nextQuestionEnd.index);
        if (isSeparateQuestion(question)) followingQuestion = question;
      }
    }
    return { match: correction, followingQuestion };
  }
  return null;
}

function isRecognizedReportedQuestionHead(quoteContent: string): boolean {
  const quoteHead = quoteContent.replace(/[.!?]+\s*$/, '').trim().replace(/^(?:(?:and|but|so)\s+)+/i, '');
  const startsReportedRequest = /^(?:please\s+)?(?:advise|explain|tell|confirm|indicate|describe|outline|clarify)\b[^.!?]*\b(?:whether|if)\b/i.test(quoteHead);
  const startsReportedConfirmation = new RegExp(
    '^\\s*(?:please\\s+)?confirm' + PURCHASE_CONFIRMATION_RECIPIENT +
      '\\s+(?:(?:that|whether|if)\\s+)?' + DECLARATIVE_ACTION_SUBJECT + '\\b',
    'i'
  ).test(quoteHead);
  const startsInterrogativeQuestion = CURRENT_INTERROGATIVE_HEAD.exec(quoteHead)?.index === 0;
  return REPORTED_CONDITIONAL_HEAD.test(quoteHead) || startsReportedRequest ||
    startsReportedConfirmation || startsInterrogativeQuestion || PURCHASE_UNCERTAINTY_QUESTION_HEAD.test(quoteHead);
}

type PreparedBoundaryQuery = {
  text: string;
  hasReportedPurchase: boolean;
  earlierPurchaseFollowUp?: string;
  isReportedHypotheticalPurchaseFollowUp: boolean;
};

function prepareBoundaryQuery(query: string): PreparedBoundaryQuery {
  const normalizedQuery = query.toLowerCase();
  const attributedQuestions = new RegExp(REPORTED_QUESTION_ATTRIBUTION.source, 'gi');
  const rangesToMask: Array<{ start: number; end: number }> = [];
  let hasReportedPurchase = false;
  let earlierPurchaseFollowUp: string | undefined;
  let isReportedHypotheticalPurchaseFollowUp = false;
  let attribution: RegExpExecArray | null;

  while ((attribution = attributedQuestions.exec(normalizedQuery)) !== null) {
    const openingQuote = attribution.groups?.quote;
    const closingQuotePattern = openingQuote ? REPORT_CLOSING_QUOTE.get(openingQuote) : undefined;
    if (!openingQuote || !closingQuotePattern) continue;

    const quoteContentStart = attribution.index + attribution[0].length;
    const closingQuote = closingQuotePattern.exec(normalizedQuery.slice(quoteContentStart));
    if (!closingQuote) break;

    const quoteContent = normalizedQuery.slice(quoteContentStart, quoteContentStart + closingQuote.index);
    let blockStart = quoteContentStart;
    for (const block of quoteContent.split(/(?<=\?)/)) {
      let sentenceOffset = 0;
      for (const sentence of block.split(/(?<=[.!])(?=\s|$)/)) {
        const isPurchaseTagQuestion = isReportedPurchaseTagQuestion(sentence);
        if (isPurchaseTagQuestion || isRecognizedReportedQuestionHead(sentence)) {
          // Preserve preceding statements. Once a reported question or premise begins,
          // keep its scope through the question mark, including periods in abbreviations.
          rangesToMask.push({ start: blockStart + sentenceOffset, end: blockStart + block.length });
          if (isPurchaseTagQuestion) break;
          const reportedQuestion = block.slice(sentenceOffset);
          const condition = REPORTED_CONDITION.exec(reportedQuestion);
          const beforeCondition = reportedQuestion.slice(0, condition?.index);
          const relativePurchase = REPORTED_ADDITIONAL_PURCHASE.exec(beforeCondition);
          const relativePurchasePrefix = relativePurchase
            ? beforeCondition.slice(0, relativePurchase.index)
            : '';
          // A relative clause cannot establish a purchase when the question asks whether the asset exists.
          const relativePurchaseIsFactual = relativePurchase &&
            !REPORTED_EXISTENTIAL_QUESTION_PREFIX.test(relativePurchasePrefix) &&
            !REPORTED_WRAPPED_EXISTENTIAL_QUESTION_PREFIX.test(relativePurchasePrefix) &&
            REPORTED_PURCHASE_ADJUNCT.test(beforeCondition.slice(relativePurchase.index + relativePurchase[0].length));
          const subjectFirstPurchase = REPORTED_SUBJECT_FIRST_PURCHASE.exec(beforeCondition);
          const subjectFirstPrefix = subjectFirstPurchase
            ? beforeCondition.slice(0, subjectFirstPurchase.index)
            : '';
          const hasTemporalPremise = COMPLETED_TEMPORAL_PURCHASE_LEAD.test(subjectFirstPrefix);
          const purchaseTail = subjectFirstPurchase
            ? reportedQuestion.slice(subjectFirstPurchase.index + subjectFirstPurchase[0].length)
            : '';
          const hypotheticalQualifier = hasTemporalPremise ? findAttachedHypotheticalPurchaseQualifier(purchaseTail) : null;
          const subjectFirstIsQuestionedOrHypothetical = Boolean(hypotheticalQualifier) ||
            isSubjectFirstPurchaseQuestioned(
              subjectFirstPrefix, hasTemporalPremise && subjectFirstPurchase?.groups?.perfectAuxiliary !== 'have'
            );
          const quoteEnd = quoteContentStart + closingQuote.index + closingQuote[0].length;
          // A separate question in the same turn can establish its own advisory scope.
          if (hypotheticalQualifier && /^[\s.!?]*$/.test(purchaseTail.slice(hypotheticalQualifier.index + hypotheticalQualifier[0].length)) &&
              block.length === quoteContent.length && sentenceOffset === 0 &&
              !REPORTED_CLAUSE_END.test(normalizedQuery.slice(0, attribution.index)) &&
              /^[\s.!?]*$/.test(normalizedQuery.slice(quoteEnd))) {
            isReportedHypotheticalPurchaseFollowUp = true;
          }
          const followingReport = new RegExp(REPORTED_QUESTION_ATTRIBUTION.source, 'i').exec(normalizedQuery.slice(quoteEnd));
          const correctionWindow = normalizedQuery.slice(quoteEnd, followingReport ? quoteEnd + followingReport.index : undefined);
          const reportedPurchaseAsset = relativePurchase?.groups?.asset || subjectFirstPurchase?.groups?.asset;
          const correction = findExplicitPurchaseCorrection(correctionWindow, reportedPurchaseAsset);
          if (correction) {
            const correctionStart = quoteEnd + correction.match.index;
            const correctionEnd = correctionStart + correction.match[0].length;
            if (!rangesToMask.some(range => range.start === correctionStart && range.end === correctionEnd)) {
              rangesToMask.push({ start: correctionStart, end: correctionEnd });
            }
            if (correction.followingQuestion && reportedPurchaseAsset) {
              const earlierAssetReference = new RegExp(
                String.raw`\b(?:first|original|earlier|previous|prior)\s+${reportedPurchaseAsset}\b`
              );
              if (earlierAssetReference.test(correction.followingQuestion)) {
                earlierPurchaseFollowUp = correction.followingQuestion;
              }
            }
          }
          hasReportedPurchase ||= !correction && Boolean(
            relativePurchaseIsFactual || (subjectFirstPurchase && !subjectFirstIsQuestionedOrHypothetical)
          );
          break;
        }
        sentenceOffset += sentence.length;
      }
      blockStart += block.length;
    }

    attributedQuestions.lastIndex = blockStart + closingQuote[0].length;
  }

  let text = '';
  let unmaskedStart = 0;
  rangesToMask.sort((left, right) => left.start - right.start);
  for (const { start, end } of rangesToMask) {
    text += normalizedQuery.slice(unmaskedStart, start) + ' '.repeat(end - start);
    unmaskedStart = end;
  }
  return {
    text: text + normalizedQuery.slice(unmaskedStart),
    hasReportedPurchase,
    earlierPurchaseFollowUp,
    isReportedHypotheticalPurchaseFollowUp
  };
}
const TIME_ANCHORED_ACTION_LEAD = new RegExp(
  String.raw`^\s*(?:${PAST_TIME_ANCHOR}\s*,?\s+${DECLARATIVE_ACTION_SUBJECT}|${DECLARATIVE_ACTION_SUBJECT}\s+${PAST_TIME_ANCHOR})(?:\s+had)?${ACTION_MODIFIERS}\s*$`,
  'i'
);

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
  const routingQuery = prepareBoundaryQuery(query);
  const q = routingQuery.text.trim();
  if (startsNewAccountingScenarioFromPreparedQuery(routingQuery, relationScenario)) return 'NEW';

  const wordCount = q.split(/\s+/).filter(Boolean).length;
  const isShortFactReply = wordCount <= 4 || /^(?:sgd|usd|eur|s\$|\$)?\s*[\d,]+(?:\.\d+)?\s*(?:k|m|million|thousand)?$/i.test(q);
  const continuationSignal = /\b(what if|instead|then|also|same|previous|prior|earlier|above|that|this|these|those|it|they|discussed|mentioned|settle|settlement|recover|double entry|journal entry|show|repeat|clarif)/i.test(q);
  const explicitNewSignal = /\b(new (?:case|scenario|situation|question|transaction|analysis|example)|unrelated|(?:separate|different) (?:case|scenario|situation|analysis|question|transaction|example)|(?:ignore|disregard|forget)\b[^.!?]{0,100}\b(?:earlier|previous|prior|above|last|case|scenario|situation|question|context|transaction|example|employee|employees|discussion|analysis|discussed|mentioned|that|this|these|those))\b/i.test(q);

  if (explicitNewSignal) return 'NEW';
  if (hasExplicitPriorFactReference(q)) return 'RELATED';
  const payrollScenario = currentScenario?.scenarioType === 'PAYROLL_CPF_SALARY'
    ? currentScenario
    : committedScenario?.scenarioType === 'PAYROLL_CPF_SALARY' ? committedScenario : null;
  const salaryCorrection = payrollScenario && isSingleMonthlySalaryAmendment(q)
    ? resolveFactAmendment(q, payrollScenario).amendments
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
  return startsNewAccountingScenarioFromPreparedQuery(prepareBoundaryQuery(query), currentScenario, context);
}

/** Provides the public query service with the scoped follow-up as well as the transaction boundary. */
export function evaluateAccountingScenarioBoundary(query: string, currentScenario: AccountingScenarioState | null) {
  const prepared = prepareBoundaryQuery(query);
  return {
    startsNewScenario: startsNewAccountingScenarioFromPreparedQuery(prepared, currentScenario),
    earlierPurchaseFollowUp: prepared.earlierPurchaseFollowUp,
    isReportedHypotheticalPurchaseFollowUp: prepared.isReportedHypotheticalPurchaseFollowUp
  };
}

function startsNewAccountingScenarioFromPreparedQuery(
  { text: q, hasReportedPurchase }: PreparedBoundaryQuery,
  currentScenario?: AccountingScenarioState | null,
  context?: ConversationAccountingContext
): boolean {
  if (!currentScenario && !context?.underlyingTransaction) return false;

  if (hasReportedPurchase || isDeferredTaxInquiry(q)) return true;
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
  if (startsWithPriorFactReference(q)) {
    return transactionActions.some(action => {
      const actionIndex = action.index ?? 0;
      const actionEnd = actionIndex + action[0].length;
      const actionObject = q.slice(actionEnd);
      const actionLead = q.slice(0, actionIndex).split(/[.!?;](?=\s+)/).at(-1) ?? '';
      if (NEGATED_ACTION.test(actionLead)) return false;
      const hasSeparateObject = /^\s+(?:(?:a|an|the)\s+)?(?:another|additional|second|different)\s+(?:new\s+)?(?:machine|machinery|equipment|vehicle|asset|lease|loan|shares?|purchase|acquisition|transaction)\b/i.test(actionObject);
      const hasIndefiniteObject = /^\s+a(?:n)?\s+(?:new\s+)?(?:machine|machinery|equipment|vehicle|asset|lease|loan|shares?|purchase|acquisition|transaction)\b/i.test(actionObject) ||
        /^\s+(?:(?:some|new)\s+)?(?:equipment|machinery)\b/i.test(actionObject);
      const hasDefiniteNewObject = /^\s+(?:(?:the|our|your|my|its|their|his|her)\s+)new\s+(?:machine|machinery|equipment|vehicle|asset|lease|loan|shares?|purchase|acquisition|transaction)\b/i.test(actionObject);
      const hasSubsequentAction = /\b(?:(?:we|the company)\s+)?(?:subsequently|later|afterwards|then|again)(?:,\s*)?\s+(?:(?:we|the company)\s+)?$/i.test(actionLead);
      const frontedConditionalAction = /(?:^\s*|[,;]\s*|\b(?:and|but)\s+)((?:what\s+)?if|suppose|assuming)\b[^.!?;]*$/i.exec(actionLead);
      const ifSegments = actionLead.split(/\bif\b/i);
      const ifClauseLead = ifSegments.slice(1).at(-1) ?? '';
      const hasCompletedIfBeforeContrast = /,[^,]+,\s*but\b/i.test(ifClauseLead);
      const ifContrastClauses = ifClauseLead.split(/,\s*but\b/i);
      const ifClauseAfterContrast = ifContrastClauses.length > 1 ? ifContrastClauses.at(-1) ?? '' : '';
      const ifQuestionLead = ifSegments.at(-2) ?? '';
      const currentQuestionLead = ifQuestionLead.split(/[.!?;](?=\s|$)/).at(-1) ?? ifQuestionLead;
      const actionSentenceTerminatorMatch = /[.!?;](?=\s|$)/.exec(actionObject);
      const actionSentenceTerminator = actionSentenceTerminatorMatch?.[0];
      const actionTextThroughTerminator = actionSentenceTerminatorMatch
        ? actionObject.slice(0, actionSentenceTerminatorMatch.index + 1)
        : actionObject;
      const attribution = REPORTED_QUESTION_ATTRIBUTION.exec(currentQuestionLead);
      const questionLead = attribution
        ? currentQuestionLead.slice(attribution.index + attribution[0].length)
        : currentQuestionLead;
      const isReportedPassiveQuestion = /\bwhat\s+(?:is|are|was|were)\s+\w+\s+(?:is|are|was|were)\s*$/i.test(questionLead);
      const hasInterrogative = !isReportedPassiveQuestion && CURRENT_INTERROGATIVE_HEAD.test(questionLead);
      const hasIndirectRequest = /(?:^|[,;.:])\s*(?:please\s+)?(?:advise|explain|tell|confirm|indicate|describe|outline|clarify)\b[^.!?]*\b(?:whether|if)\b[^.!?]*$/i.test(questionLead);
      const hasReportedConditionalQuestion = attribution !== null &&
        (hasInterrogative || hasIndirectRequest || /^\s*what\s*$/i.test(questionLead));
      const hasConditionalQuestion = hasReportedConditionalQuestion ||
        hasIndirectRequest || (hasInterrogative && actionSentenceTerminator === '?');
      const hasExplicitFactualContrast = /\b(?:in fact|actually)\b/i.test(ifClauseAfterContrast);
      const actionEndsWithQuestionTag = actionSentenceTerminator === '?' &&
        CONFIRMATION_QUESTION_TAG.test(actionTextThroughTerminator);
      const hasDatedReportedContrast = hasReportedConditionalQuestion &&
        (actionSentenceTerminator !== '?' || actionEndsWithQuestionTag) &&
        TIME_ANCHORED_ACTION_LEAD.test(ifClauseAfterContrast);
      const closingQuotePattern = REPORT_CLOSING_QUOTE.get(attribution?.groups?.quote ?? '');
      // Wording inside a quotation cannot end the reported condition before the quote closes.
      const hasIndependentIfContrast = hasReportedConditionalQuestion && closingQuotePattern
        ? ifContrastClauses.slice(0, -1).some(clause => closingQuotePattern.test(clause))
        : hasExplicitFactualContrast || hasDatedReportedContrast ||
          (!ACTION_MODIFIERS_ONLY.test(ifClauseAfterContrast) && !hasConditionalQuestion);
      const frontedMarkerIsIf = /^(?:what\s+)?if$/i.test(frontedConditionalAction?.[1] ?? '');
      const isFrontedConditionalAction = Boolean(frontedConditionalAction &&
        !(frontedMarkerIsIf && hasCompletedIfBeforeContrast));
      const actionLeadWithIfAsideRemoved = actionLead.replace(/\bif\s*,\s*[^,]+,\s*/gi, 'if ');
      const finalActionClause = actionLeadWithIfAsideRemoved.split(/[,;]|\b(?:and|but)\b/i).at(-1) ?? '';
      // A contrast that shares the subject can still be part of the embedded condition.
      const isEmbeddedConditionalAction = /\bif\b/i.test(finalActionClause) ||
        (!hasIndependentIfContrast && (hasReportedConditionalQuestion || Boolean(ifClauseLead.match(transactionActionPattern))));
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
