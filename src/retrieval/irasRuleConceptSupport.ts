import type { RequestedQuestionConcept } from '../services/semanticQuestionUnderstanding';

export type GeneralIrasRuleSupport = true | false | undefined;

export interface GeneralIrasRuleSupportInput {
  sourceText: string;
  /** Canonical source-map/coverage topic domain, such as IRAS_CORPORATE_TAX. */
  domainId: string;
  /** Canonical coverage-topic associations for this request/concept. */
  topicIds: readonly string[];
  /** Bounded issue or request subject, not source metadata or a URL. */
  subject: string;
  population?: string;
  concepts?: readonly Pick<RequestedQuestionConcept, 'label' | 'terms'>[];
}

type RuleFamily = 'FOREIGN_DIVIDEND' | 'GST_INPUT_TAX' | 'PRIVATE_EXPENSE_DEDUCTIBILITY' | 'ROYALTY_WITHHOLDING_TAX';

const FOREIGN_DIVIDEND_TOPIC_IDS = new Set([
  'iras-foreign-sourced-income',
  'iras-section-13-exemptions'
]);
const GST_INPUT_TAX_TOPIC_IDS = new Set(['iras-gst-input-tax', 'iras-gst-blocked-input-tax']);
const PRIVATE_EXPENSE_TOPIC_IDS = new Set(['iras-cit-deductibility', 'iras-cit-disallowed-expenses']);
const ROYALTY_WITHHOLDING_TOPIC_IDS = new Set(['iras-withholding-tax-interest-royalties', 'iras-withholding-tax']);

const FOREIGN_DIVIDEND_SUBJECT_WORDS = new Set([
  'a', 'an', 'the', 'our', 'its', 's', 'company', 'corporate', 'business', 'singapore', 'foreign', 'sourced', 'overseas',
  'dividend', 'income', 'tax', 'treatment', 'rule', 'general', 'guidance', 'overview', 'receipt', 'receive', 'current',
  'year', 'from', 'in', 'of', 'for', 'by', 'on', 'to', 'whether', 'when', 'if', 'upon', 'is', 'are', 'be', 'and',
  'as', 'may', 'explain', 'what', 'how', 'does', 'do', 'received', 'receiving', 'taxable', 'taxation', 'subsidiary',
  'subsidiaries', 'outside', 'singaporean'
]);

const GST_INPUT_TAX_SUBJECT_WORDS = new Set([
  'a', 'an', 'the', 'our', 's', 'company', 'companies', 'corporate', 'business', 'businesses', 'singapore', 'gst', 'goods',
  'service', 'services', 'and', 'input', 'tax', 'claim', 'claiming', 'claimed', 'claims', 'recover', 'recovering',
  'recovered', 'recovery', 'recoverable', 'general', 'rule', 'rules', 'guidance', 'overview', 'purchase', 'purchases',
  'condition', 'conditions', 'taxable', 'supply', 'supplies', 'used', 'use', 'registered', 'registration', 'for', 'of', 'on', 'by',
  'in', 'to', 'with', 'where', 'when', 'if', 'is', 'are', 'be', 'may', 'what', 'how', 'does', 'do', 'explain',
  'input-tax'
]);

const PRIVATE_EXPENSE_SUBJECT_WORDS = new Set([
  'a', 'an', 'the', 'our', 'its', 's', 'company', 'corporate', 'business', 'singapore', 'income', 'tax', 'treatment',
  'rule', 'general', 'guidance', 'overview', 'private', 'personal', 'expense', 'director', 'holiday', 'travel',
  'trip', 'cost', 'payment', 'incurred', 'deductibility', 'deductible', 'deduction', 'disallowed',
  'wholly', 'exclusively', 'producing', 'income', 'for', 'of', 'from', 'in', 'by', 'on', 'to', 'whether', 'when',
  'if', 'is', 'are', 'be', 'and', 'as', 'may', 'explain', 'what', 'how', 'does', 'do', 'year', 'current'
]);

const ROYALTY_WITHHOLDING_SUBJECT_WORDS = new Set([
  'a', 'an', 'the', 'our', 'its', 's', 'company', 'companies', 'corporate', 'business', 'singapore', 'general', 'rule',
  'rules', 'guidance', 'overview', 'withholding', 'withhold', 'wht', 'tax', 'royalty', 'payment', 'pay', 'payer',
  'recipient', 'non', 'resident', 'foreign', 'to', 'for', 'of', 'from', 'in', 'by', 'on', 'whether', 'when', 'if',
  'is', 'are', 'be', 'and', 'as', 'may', 'explain', 'what', 'how', 'does', 'do'
]);

const SPECIFIC_TOPIC_IDS = new Set(['iras-section-13-exemptions', 'iras-gst-blocked-input-tax']);

function tokenize(value: string): string[] {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

function canonicalWord(value: string): string {
  if (value === 'overseas') return value;
  if (value === 'pays') return 'pay';
  if (value === 'claiming' || value === 'claimed' || value === 'claims') return 'claim';
  if (value === 'recovering' || value === 'recovered' || value === 'recovers') return 'recover';
  if (value === 'recovery' || value === 'recoveries') return 'recovery';
  if (value === 'received' || value === 'receiving' || value === 'receives') return 'receive';
  if (value.endsWith('ies') && value.length > 4) return `${value.slice(0, -3)}y`;
  if (value.endsWith('s') && !value.endsWith('ss') && value.length > 4) return value.slice(0, -1);
  return value;
}

function hasPhrase(words: readonly string[], phrase: readonly string[]): boolean {
  return words.some((_word, start) => start + phrase.length <= words.length &&
    phrase.every((expected, offset) => words[start + offset] === expected));
}

function includesAny(words: readonly string[], allowed: ReadonlySet<string>): boolean {
  return words.some(word => allowed.has(word));
}

function boundedRuleSourceUnits(sourceText: string, family: RuleFamily): string[] {
  const paragraphs = sourceText.normalize('NFC').replace(/\u00a0/g, ' ')
    .split(/\r?\n[\t ]*\r?\n+/).map(paragraph => paragraph.trim()).filter(Boolean);
  const anchorPattern = family === 'FOREIGN_DIVIDEND' ? /foreign|overseas|dividend/gi
    : family === 'GST_INPUT_TAX' ? /input[ -]tax/gi
      : family === 'PRIVATE_EXPENSE_DEDUCTIBILITY' ? /private|personal|expense/gi
        : /royalt|withholding|\bwht\b/gi;
  const continuationPattern = family === 'FOREIGN_DIVIDEND' ? /dividend|foreign|overseas|receipt|receiv|tax|condition|exempt/i
    : family === 'GST_INPUT_TAX' ? /input[ -]tax|claim|recover|condition|invoice|business|purchase|taxable|suppl/i
      : family === 'PRIVATE_EXPENSE_DEDUCTIBILITY' ? /private|personal|expense|deduct|disallow/i
        : /royalt|withholding|\bwht\b|non[ -]resident/i;
  const units = new Set<string>();
  const addBounded = (text: string) => {
    if (text.length <= 1800) units.add(text);
    else {
      anchorPattern.lastIndex = 0;
      for (const match of text.matchAll(anchorPattern)) {
        const start = Math.max(0, (match.index || 0) - 300);
        units.add(text.slice(start, Math.min(text.length, start + 1800)));
      }
    }
  };

  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    addBounded(paragraph);
    let attached = paragraph;
    for (let next = index + 1; next < Math.min(paragraphs.length, index + 3); next += 1) {
      const continuation = paragraphs[next];
      anchorPattern.lastIndex = 0;
      if (attached.length + continuation.length > 1800 || !anchorPattern.test(attached) || !continuationPattern.test(continuation)) break;
      anchorPattern.lastIndex = 0;
      attached = `${attached}\n${continuation}`;
      addBounded(attached);
    }
  }
  return [...units];
}

function selectedFamily(input: GeneralIrasRuleSupportInput, words: readonly string[]): RuleFamily | undefined {
  const topics = new Set(input.topicIds);
  const foreignDividend = [...FOREIGN_DIVIDEND_TOPIC_IDS].some(id => topics.has(id)) &&
    (includesAny(words, new Set(['foreign', 'overseas'])) || hasPhrase(words, ['outside', 'singapore'])) &&
    includesAny(words, new Set(['dividend']));
  const gstInputTax = [...GST_INPUT_TAX_TOPIC_IDS].some(id => topics.has(id)) &&
    hasPhrase(words, ['input', 'tax']) && includesAny(words, new Set(['claim', 'recover', 'recovery']));
  const privateExpense = [...PRIVATE_EXPENSE_TOPIC_IDS].some(id => topics.has(id)) &&
    includesAny(words, new Set(['private', 'personal'])) && includesAny(words, new Set(['expense', 'cost'])) &&
    includesAny(words, new Set(['tax', 'deductibility', 'deductible', 'deduction']));
  const royaltyWithholding = [...ROYALTY_WITHHOLDING_TOPIC_IDS].some(id => topics.has(id)) &&
    includesAny(words, new Set(['royalty'])) && includesAny(words, new Set(['withholding', 'withhold', 'wht']));
  const selected: RuleFamily[] = [];
  if (foreignDividend) selected.push('FOREIGN_DIVIDEND');
  if (gstInputTax) selected.push('GST_INPUT_TAX');
  if (privateExpense) selected.push('PRIVATE_EXPENSE_DEDUCTIBILITY');
  if (royaltyWithholding) selected.push('ROYALTY_WITHHOLDING_TAX');
  return selected.length === 1 ? selected[0] : undefined;
}

function hasForeignDividendReceiptTaxRule(sourceText: string): boolean {
  return boundedRuleSourceUnits(sourceText, 'FOREIGN_DIVIDEND').some(unit => {
    const clause = unit.replace(/[\r\n]+/g, ' ');
    const words = tokenize(clause);
    const dividend = includesAny(words, new Set(['dividend', 'dividends']));
    const foreignDividendRelation =
      /\bforeign[ -]sourced\b.{0,120}\bdividends?\b|\bforeign\b.{0,45}\bdividends?\b|\boverseas\b.{0,45}\bdividends?\b|\bdividends?\b.{0,45}\b(?:from|sourced|derived|arising)\b.{0,30}\b(?:overseas|abroad|outside singapore|foreign source|foreign[ -]sourced)\b/i.test(clause) &&
      !/\b(?:domestic|local)\b.{0,50}\bdividends?\b.{0,50}\b(?:foreign|overseas)\s+(?:company|subsidiary|payer)\b/i.test(clause) &&
      !/\bdividends?\b.{0,40}\b(?:paid|issued|distributed)\b.{0,25}\bby\b.{0,20}\b(?:foreign|overseas)\s+(?:company|subsidiary|payer)\b/i.test(clause);
    const receipt = includesAny(words, new Set(['receive', 'received', 'receiving', 'receipt', 'remit', 'remitted', 'remittance']));
    const singapore = includesAny(words, new Set(['singapore'])) &&
      /(?:receiv\w*|receipt|remitt\w*).{0,80}(?:in|into|to) singapore|(?:in|into|to) singapore.{0,80}(?:receiv\w*|receipt|remitt\w*)/i.test(clause);
    const tax = includesAny(words, new Set(['tax', 'taxable', 'taxation']));
    const conditional = includesAny(words, new Set(['if', 'when', 'upon', 'unless', 'provided', 'subject', 'only']));
    const taxAndReceiptConnected = /\b(?:tax(?:able|ation)?|subject to tax)\b.{0,100}\b(?:receiv\w*|receipt|remitt\w*)\b|\b(?:receiv\w*|receipt|remitt\w*)\b.{0,100}\b(?:tax(?:able|ation)?|subject to tax)\b/i.test(clause);
    return foreignDividendRelation && dividend && receipt && singapore && tax && (conditional || taxAndReceiptConnected);
  });
}

function hasGstInputTaxClaimRule(sourceText: string): boolean {
  return boundedRuleSourceUnits(sourceText, 'GST_INPUT_TAX').some(unit => {
    const normalized = tokenize(unit);
    const hasClaimOrRecovery = includesAny(normalized, new Set(['claim', 'claiming', 'claimed', 'claims', 'recover', 'recovering', 'recovered', 'recovery']));
    const meaningfulScope = includesAny(normalized, new Set([
      'business', 'purchase', 'condition', 'document', 'invoice', 'record', 'taxable', 'supply', 'supplies'
    ]));
    // Require an affirmative general entitlement/conditions statement. A
    // restriction such as "business purpose alone does not make a blocked
    // claim recoverable" discusses input tax and business use, but does not
    // establish the ordinary claim conditions.
    const affirmativeRule =
      /\b(?:may|can|is entitled to|are entitled to|is allowed to|are allowed to)\b.{0,100}\b(?:claim|recover)\b.{0,100}\binput[ -]tax\b/i.test(unit) ||
      /\binput[ -]tax\b.{0,100}\b(?:may|can)\s+be\s+(?:claimed|recovered)\b/i.test(unit) ||
      /\bto\s+(?:claim|recover)\s+input[ -]tax\b.{0,160}\b(?:following|these|conditions|must|where|if|provided|subject to)\b/i.test(unit);
    return hasPhrase(normalized, ['input', 'tax']) && hasClaimOrRecovery && meaningfulScope && affirmativeRule;
  });
}

function hasPrivateExpenseDeductibilityRule(sourceText: string): boolean {
  return boundedRuleSourceUnits(sourceText, 'PRIVATE_EXPENSE_DEDUCTIBILITY').some(clause => {
    const words = tokenize(clause).map(canonicalWord);
    const privateExpense = includesAny(words, new Set(['private', 'personal'])) && includesAny(words, new Set(['expense', 'cost']));
    const explicitDisallowance = /\b(?:disallowed|non[ -]deductible|not deductible|not allowed as (?:a )?deduction)\b/i.test(clause);
    return privateExpense && explicitDisallowance;
  });
}

function hasRoyaltyWithholdingRule(sourceText: string, requiresNonResident: boolean): boolean {
  return boundedRuleSourceUnits(sourceText, 'ROYALTY_WITHHOLDING_TAX').some(clause => {
    const words = tokenize(clause);
    const royalty = includesAny(words, new Set(['royalty', 'royalties']));
    const withholding = includesAny(words, new Set(['withholding', 'wht'])) && includesAny(words, new Set(['tax', 'wht']));
    const nonResident = /\bnon[ -]resident\b/i.test(clause);
    return royalty && withholding && (!requiresNonResident || nonResident);
  });
}

/**
 * Checks only bounded, general IRAS rule concepts. Undefined means this is not
 * one of the selected topic/concept families and legacy matching may proceed.
 * False means a recognized family was requested but its scope or source text
 * does not establish the general rule.
 */
export function supportGeneralIrasRuleConcept(input: GeneralIrasRuleSupportInput): GeneralIrasRuleSupport {
  if (input.population !== undefined && input.population !== 'COMPANY') return undefined;
  const concepts = input.concepts || [];
  const subjectWords = tokenize(input.subject);
  const conceptWords = concepts.flatMap(concept => [concept.label, ...concept.terms].flatMap(tokenize));
  const words = [...subjectWords, ...conceptWords].map(canonicalWord);
  const family = selectedFamily(input, words);
  if (!family) return undefined;

  const expectedDomain = family === 'GST_INPUT_TAX' ? 'IRAS_GST' : 'IRAS_CORPORATE_TAX';
  if (input.domainId !== expectedDomain) return undefined;

  if ([...SPECIFIC_TOPIC_IDS].some(id => input.topicIds.includes(id))) return undefined;
  if (family === 'ROYALTY_WITHHOLDING_TAX') {
    const requestedPhrases = [input.subject, ...concepts.flatMap(concept => [concept.label, ...concept.terms])];
    const hasResidentWithoutNonresidentQualifier = requestedPhrases.some(phrase => {
      const phraseWords = tokenize(phrase).map(canonicalWord);
      return phraseWords.some((word, index) => word === 'resident' && phraseWords[index - 1] !== 'non');
    });
    if (hasResidentWithoutNonresidentQualifier) return undefined;
  }
  const allowedWords = family === 'FOREIGN_DIVIDEND' ? FOREIGN_DIVIDEND_SUBJECT_WORDS
    : family === 'GST_INPUT_TAX' ? GST_INPUT_TAX_SUBJECT_WORDS
      : family === 'PRIVATE_EXPENSE_DEDUCTIBILITY' ? PRIVATE_EXPENSE_SUBJECT_WORDS : ROYALTY_WITHHOLDING_SUBJECT_WORDS;
  if (words.some(word => !allowedWords.has(word))) return undefined;

  const requiresNonResident = family === 'ROYALTY_WITHHOLDING_TAX' && hasPhrase(words, ['non', 'resident']);

  switch (family) {
    case 'FOREIGN_DIVIDEND': return hasForeignDividendReceiptTaxRule(input.sourceText);
    case 'GST_INPUT_TAX': return hasGstInputTaxClaimRule(input.sourceText);
    case 'PRIVATE_EXPENSE_DEDUCTIBILITY': return hasPrivateExpenseDeductibilityRule(input.sourceText);
    case 'ROYALTY_WITHHOLDING_TAX': return hasRoyaltyWithholdingRule(input.sourceText, requiresNonResident);
  }
}
