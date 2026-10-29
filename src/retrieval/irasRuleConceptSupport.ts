import type { RequestedQuestionConcept } from '../services/semanticQuestionUnderstanding';
import { supportIrasCpfExpansionRule } from './irasCpfExpansionRules';
import { supportIrasCpfMasPracticalRule } from './irasCpfMasPracticalRules20261027';
import { hasIrasMasKnowledgeContradiction, supportIrasMasKnowledgeRule } from './irasMasKnowledge20261027b';
import { supportStatutoryWorkflowRule } from './statutoryWorkflows20261029';

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
  concepts?: readonly Pick<RequestedQuestionConcept, 'id' | 'label' | 'terms'>[];
}

type RuleFamily = 'FOREIGN_DIVIDEND' | 'GST_INPUT_TAX' | 'PRIVATE_EXPENSE_DEDUCTIBILITY' |
  'ROYALTY_WITHHOLDING_TAX' | 'COMPANY_TAX_RESIDENCY' | 'CPF_CASH_TOP_UP_RELIEF' | 'GST_MOTOR_CAR_INPUT_TAX';

const FOREIGN_DIVIDEND_TOPIC_IDS = new Set([
  'iras-foreign-sourced-income',
  'iras-section-13-exemptions'
]);
const GST_INPUT_TAX_TOPIC_IDS = new Set(['iras-gst-input-tax', 'iras-gst-blocked-input-tax']);
const PRIVATE_EXPENSE_TOPIC_IDS = new Set(['iras-cit-deductibility', 'iras-cit-disallowed-expenses']);
const ROYALTY_WITHHOLDING_TOPIC_IDS = new Set(['iras-withholding-tax-interest-royalties', 'iras-withholding-tax']);
const COMPANY_TAX_RESIDENCY_TOPIC_IDS = new Set(['iras-corporate-tax-residency']);
const CPF_CASH_TOP_UP_TOPIC_IDS = new Set(['iras-individual-cpf-cash-top-up-relief']);
const GST_MOTOR_CAR_TOPIC_IDS = new Set(['iras-gst-blocked-input-tax', 'iras-gst-motor-vehicles']);

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

const IRAS_GENERAL_QUESTION_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'from', 'in', 'on', 'to', 'by', 'with', 'as', 'is', 'are', 'be',
  'can', 'could', 'does', 'do', 'how', 'what', 'when', 'where', 'which', 'who', 'why', 'whether', 'may', 'must',
  'will', 'would', 'should', 'not', 'only', 'all', 'any', 'general', 'generally', 'rule', 'rules', 'guidance',
  'overview', 'explain', 'explanation', 'condition', 'conditions', 'eligibility', 'eligible', 'requirement',
  'requirements', 'criteria', 'supporting', 'document', 'documents', 'documentation', 'claim', 'claiming', 'recover',
  'recovery', 'recoverable', 'company', 'business', 'businesses', 'singapore'
]);
const IRAS_GST_OUTPUT_CATEGORY_TOPIC_IDS = new Set([
  'iras-gst-standard-rated-supplies', 'iras-gst-zero-rating', 'iras-gst-exempt-supplies', 'iras-gst-out-of-scope-supplies'
]);
const IRAS_GST_OUTPUT_CATEGORY_WORDS = new Set([
  ...IRAS_GENERAL_QUESTION_WORDS,
  'gst', 'goods', 'good', 'service', 'services', 'supply', 'supplies', 'sale', 'sales', 'taxable', 'standard',
  'rated', 'rating', 'rate', 'zero', 'exempt', 'exemption', 'scope', 'outside', 'out', 'charge', 'chargeable',
  'customer', 'customers', 'overseas', 'international', 'export', 'exported', 'compare', 'comparison', 'different',
  'difference', 'distinction', 'between', 'category', 'categories'
]);
const IRAS_ECI_GENERAL_TOPIC_IDS = new Set(['iras-cit-eci']);
const IRAS_ECI_GENERAL_WORDS = new Set([
  ...IRAS_GENERAL_QUESTION_WORDS,
  'eci', 'estimated', 'chargeable', 'income', 'tax', 'filing', 'file', 'submit', 'submission', 'deadline', 'due',
  'fye', 'financial', 'year', 'end', 'waiver', 'nil', 'revenue', 'annual', 'million', 'exemption', 'partial',
  'start-up', 'startup', 'profit', 'accounting', 'book', 'loss', 'skip', 'no', 'mean', 'means', 'establish', 'establishes',
  'established', 'qualify', 'qualification', 'assessment', 'ya'
]);

const PRIVATE_EXPENSE_SUBJECT_WORDS = new Set([
  'a', 'an', 'the', 'our', 'its', 's', 'company', 'corporate', 'business', 'singapore', 'income', 'tax', 'treatment',
  'rule', 'general', 'guidance', 'overview', 'private', 'personal', 'domestic', 'expense', 'director', 'holiday', 'travel',
  'trip', 'cost', 'payment', 'incurred', 'deductibility', 'deductible', 'deduction', 'disallowed',
  'wholly', 'exclusively', 'producing', 'income', 'for', 'of', 'from', 'in', 'by', 'on', 'to', 'whether', 'when',
  'if', 'is', 'are', 'be', 'and', 'or', 'as', 'may', 'explain', 'what', 'how', 'does', 'do', 'year', 'current'
]);

const ROYALTY_WITHHOLDING_SUBJECT_WORDS = new Set([
  'a', 'an', 'the', 'our', 'its', 's', 'company', 'companies', 'corporate', 'business', 'singapore', 'general', 'rule',
  'rules', 'guidance', 'overview', 'withholding', 'withhold', 'wht', 'tax', 'royalty', 'payment', 'pay', 'payer',
  'recipient', 'non', 'resident', 'nonresident', 'foreign', 'to', 'for', 'of', 'from', 'in', 'by', 'on', 'whether', 'when', 'if',
  'is', 'are', 'be', 'and', 'as', 'may', 'explain', 'what', 'how', 'does', 'do'
]);

const SPECIFIC_TOPIC_IDS = new Set(['iras-section-13-exemptions', 'iras-gst-blocked-input-tax']);

function tokenize(value: string): string[] {
  return value.toLowerCase().normalize('NFKD')
    .replace(/\bnon(?:[\s\-\u2010-\u2015\u2212]+)?residents?\b/giu, 'nonresident')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

function canonicalWord(value: string): string {
  if (value === 'overseas') return value;
  if (value === 'pays') return 'pay';
  if (value === 'paid') return 'pay';
  if (value === 'establishes') return 'establish';
  if (value === 'claiming' || value === 'claimed' || value === 'claims') return 'claim';
  if (value === 'recovering' || value === 'recovered' || value === 'recovers') return 'recover';
  if (value === 'recovery' || value === 'recoveries') return 'recovery';
  if (value === 'received' || value === 'receiving' || value === 'receives') return 'receive';
  if (value.endsWith('ies') && value.length > 4) return `${value.slice(0, -3)}y`;
  if (value.endsWith('s') && !value.endsWith('ss') && value.length > 4) return value.slice(0, -1);
  return value;
}

function hasOppositeRoyaltyPaymentDirection(subject: string): boolean {
  const words = tokenize(subject).map(canonicalWord);
  const royaltyIndex = words.indexOf('royalty');
  if (royaltyIndex < 0) return false;
  const beforeRoyalty = words.slice(Math.max(0, royaltyIndex - 5), royaltyIndex);
  if (beforeRoyalty.includes('nonresident') && beforeRoyalty.includes('pay')) return true;

  const afterRoyalty = words.slice(royaltyIndex + 1);
  const hasNonresidentBeforeRecipientBoundary = (preposition: 'by' | 'from'): boolean => {
    const start = afterRoyalty.indexOf(preposition);
    if (start < 0) return false;
    const remainder = afterRoyalty.slice(start + 1);
    const boundary = remainder.indexOf('to');
    return (boundary < 0 ? remainder : remainder.slice(0, boundary)).includes('nonresident');
  };
  if (hasNonresidentBeforeRecipientBoundary('by') || hasNonresidentBeforeRecipientBoundary('from')) return true;

  const toIndex = afterRoyalty.indexOf('to');
  if (toIndex < 0) return false;
  const recipient = afterRoyalty.slice(toIndex + 1, toIndex + 5);
  return recipient.includes('resident') && !recipient.includes('nonresident');
}

function hasPhrase(words: readonly string[], phrase: readonly string[]): boolean {
  return words.some((_word, start) => start + phrase.length <= words.length &&
    phrase.every((expected, offset) => words[start + offset] === expected));
}

function includesAny(words: readonly string[], allowed: ReadonlySet<string>): boolean {
  return words.some(word => allowed.has(word));
}

function usesOnlyAllowedWords(phrases: readonly string[], allowed: ReadonlySet<string>): boolean {
  const words = phrases.flatMap(tokenize).map(canonicalWord);
  return words.length > 0 && words.every(word => allowed.has(word));
}

type RuleSourceUnit =
  | { kind: 'statement'; text: string }
  | { kind: 'headed-list'; heading: string; item: string };

function isListMarker(line: string): boolean {
  return /^\s*(?:[•●▪◦*-]|\(?\d+[.)]|[a-z][.)])\s+/i.test(line);
}

function sentenceParts(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z0-9“"'(])|(?<=;)\s+/u)
    .flatMap(sentence => sentence.split(/\s+\b(?:while|whereas|but|although)\b\s+/i))
    .map(part => part.trim()).filter(Boolean);
}

/**
 * Keep evidence relationships inside one complete statement. The only
 * cross-line unit is a colon-ended heading with its immediately attached
 * marked list; blank lines inside that list are allowed by the page format.
 */
function boundedRuleSourceUnits(sourceText: string): RuleSourceUnit[] {
  const lines = sourceText.normalize('NFC').replace(/\u00a0/g, ' ').split(/\r?\n/);
  const consumed = new Set<number>();
  const units: RuleSourceUnit[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].trim();
    if (!/:\s*$/.test(heading)) continue;
    let next = index + 1;
    while (next < lines.length && !lines[next].trim()) next += 1;
    if (next >= lines.length || !isListMarker(lines[next])) continue;

    consumed.add(index);
    const items: string[] = [];
    let lastItemIndex = -1;
    let cursor = index + 1;
    while (cursor < lines.length) {
      if (!lines[cursor].trim()) {
        cursor += 1;
        continue;
      }
      if (isListMarker(lines[cursor])) {
        const item = lines[cursor].replace(/^\s*(?:[•●▪◦*-]|\(?\d+[.)]|[a-z][.)])\s+/i, '').trim();
        items.push(item);
        lastItemIndex = items.length - 1;
        consumed.add(cursor);
        cursor += 1;
        continue;
      }
      if (lastItemIndex >= 0 && /^\s+\S/.test(lines[cursor])) {
        items[lastItemIndex] = `${items[lastItemIndex]} ${lines[cursor].trim()}`;
        consumed.add(cursor);
        cursor += 1;
        continue;
      }
      break;
    }
    for (const item of items) {
      for (const sentence of sentenceParts(item)) units.push({ kind: 'headed-list', heading, item: sentence });
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (consumed.has(index) || !line.trim()) continue;
    if (isListMarker(line)) {
      const item = line.replace(/^\s*(?:[•●▪◦*-]|\(?\d+[.)]|[a-z][.)])\s+/i, '').trim();
      for (const sentence of sentenceParts(item)) units.push({ kind: 'statement', text: sentence });
      continue;
    }
    for (const sentence of sentenceParts(line.trim())) units.push({ kind: 'statement', text: sentence });
  }
  return units;
}

function selectedFamily(input: GeneralIrasRuleSupportInput, words: readonly string[]): RuleFamily | undefined {
  const topics = new Set(input.topicIds);
  const concepts = input.concepts || [];
  const conceptIds = new Set(concepts.map(concept => concept.id));
  // The new topic-specific proof helpers establish only the canonical
  // propositions they were written for. Conceptless legacy requests continue
  // through their existing subject-scoped support paths.
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
  const companyTaxResidency = [...COMPANY_TAX_RESIDENCY_TOPIC_IDS].some(id => topics.has(id)) &&
    (conceptIds.has('company_tax_residency_rule') || conceptIds.has('company_tax_residency_incorporation'));
  const cpfCashTopUpRelief = [...CPF_CASH_TOP_UP_TOPIC_IDS].some(id => topics.has(id)) &&
    (conceptIds.has('cpf_cash_top_up_relief') || conceptIds.has('cpf_cash_top_up_relief_eligibility') ||
      conceptIds.has('cpf_cash_top_up_relief_limits'));
  const gstMotorCarInputTax = [...GST_MOTOR_CAR_TOPIC_IDS].some(id => topics.has(id)) &&
    (conceptIds.has('gst_blocked_motor_car_input_tax') || conceptIds.has('gst_motor_car_input_tax_exceptions'));
  const selected: RuleFamily[] = [];
  if (foreignDividend) selected.push('FOREIGN_DIVIDEND');
  if (gstMotorCarInputTax) selected.push('GST_MOTOR_CAR_INPUT_TAX');
  else if (gstInputTax) selected.push('GST_INPUT_TAX');
  if (privateExpense) selected.push('PRIVATE_EXPENSE_DEDUCTIBILITY');
  if (royaltyWithholding) selected.push('ROYALTY_WITHHOLDING_TAX');
  if (companyTaxResidency) selected.push('COMPANY_TAX_RESIDENCY');
  if (cpfCashTopUpRelief) selected.push('CPF_CASH_TOP_UP_RELIEF');
  return selected.length === 1 ? selected[0] : undefined;
}

function hasCompanyTaxResidencyControlManagementRule(sourceText: string): boolean {
  return boundedRuleSourceUnits(sourceText).some(unit => {
    const text = unit.kind === 'statement' ? unit.text : `${unit.heading} ${unit.item}`;
    const taxResidencyRule = /\b(?:company|corporate)\b[^.!?;:]{0,55}\btax resident\b|\btax residenc(?:y|e) of (?:a|the) company\b/i.test(text);
    const testLink = /\bcontrol and management\b/i.test(text) &&
      (/\b(?:exercised|exercised in|is exercised)\b[^.!?;:]{0,55}\bin singapore\b|\bin singapore\b[^.!?;:]{0,55}\bcontrol and management\b/i.test(text) ||
        /\btax residenc(?:y|e) of (?:a|the) company\b[^.!?;:]{0,65}\bdetermined by where\b[^.!?;:]{0,45}\bbusiness is controlled and managed\b/i.test(text));
    return taxResidencyRule && testLink &&
      /\bcontrol and management\b/i.test(text) &&
      !/\b(?:not|never|no)\b[^.!?;:]{0,35}\b(?:tax resident|tax residency|control and management)\b/i.test(text);
  });
}

function hasCompanyTaxResidencyIncorporationQualification(sourceText: string): boolean {
  return boundedRuleSourceUnits(sourceText).some(unit => {
    const text = unit.kind === 'statement' ? unit.text : `${unit.heading} ${unit.item}`;
    return /\bplace of incorporation of (?:a|the) company\b/i.test(text) &&
      /\bnot necessarily indicative of\b/i.test(text) &&
      /\btax residenc(?:y|e) of (?:a|the) company\b/i.test(text);
  });
}

function hasCpfCashTopUpIntroduction(sourceText: string): boolean {
  return boundedRuleSourceUnits(sourceText).some(unit => {
    const text = unit.kind === 'statement' ? unit.text : `${unit.heading} ${unit.item}`;
    return /\bcpf cash top[ -]?up relief\b/i.test(text) &&
      /\bgiven to encourage\b/i.test(text) &&
      /\bsingaporeans? and permanent residents\b/i.test(text) &&
      /\bretirement needs\b/i.test(text);
  });
}

function hasCpfCashTopUpEligibility(sourceText: string): boolean {
  const units = boundedRuleSourceUnits(sourceText);
  const attachedItems = units.filter((unit): unit is Extract<RuleSourceUnit, { kind: 'headed-list' }> => unit.kind === 'headed-list' &&
    /\bto qualify for (?:the )?tax relief\b/i.test(unit.heading)).map(unit => unit.item);
  const text = attachedItems.join(' ');
  const mrssExcluded = /\bmatching grants? under the matched retirement savings scheme\s*\(mrss\)[^.!?]{0,100}\bwill not be eligible\b/i.test(sourceText);
  const mmssExcluded = /\bmatched medisave scheme\s*\(mmss\)[^.!?]{0,100}\bmatching grant\b[^.!?]{0,100}\bwill not qualify\b/i.test(sourceText);
  return /\bto qualify for (?:the )?tax relief\b/i.test(sourceText) && mrssExcluded && mmssExcluded &&
    /\bsingapore citizen\s*\/\s*permanent resident\b|\bsingapore citizen or permanent resident\b/i.test(text) &&
    /\bcash top[ -]?ups?\b/i.test(text) && /\b(?:previous|preceding) year\b|\bin 20\d{2}\b/i.test(text) &&
    /\bretirement sum topping[ -]?up scheme\b|\brstu\b/i.test(text);
}

function hasCpfCashTopUpLimits(sourceText: string): boolean {
  const text = sourceText.normalize('NFC').replace(/\u00a0/g, ' ');
  const combinedGrantExclusion = /\bdo not attract mrss and\/or mmss grants\b/i.test(text);
  const separateGrantExclusions = /\b(?:do not|must not) attract mrss matching grants?\b/i.test(text) &&
    /\b(?:do not|must not) attract mmss matching grants?\b/i.test(text);
  const excludesMatchingGrants = combinedGrantExclusion || separateGrantExclusions;
  const headlineCap = /\b(?:individuals? may continue to enjoy|maximum|up to)\b[^.!?;:]{0,180}\btax relief\b[^.!?;:]{0,180}\$\s*16,?000\b/i.test(text) &&
    /\$\s*8,?000\b[^.!?;:]{0,55}\bfor self\b/i.test(text) &&
    /\$\s*8,?000\b[^.!?;:]{0,75}\bfor family members\b/i.test(text) &&
    excludesMatchingGrants;
  const personalReliefCap = /\bpersonal income tax relief cap of \$\s*80,?000\b/i.test(text) &&
    /\btotal amount of all tax reliefs claimed\b/i.test(text);
  const ownSaLimit = /\brecipients below age 55\b/i.test(text) &&
    /\bspecial account\s*\(sa\)(?![a-z0-9])/i.test(text) &&
    /\b(?:full retirement sum|frs)\b/i.test(text) &&
    /\b(?:maximum allowed cash top[ -]?up|frs\s*[–-]\s*sa savings)\b/i.test(text);
  const ownRaLimit = /\brecipients aged 55 years and above\b/i.test(text) &&
    /\bretirement account\s*\(ra\)(?![a-z0-9])/i.test(text) &&
    /\b(?:full retirement sum|frs)\b/i.test(text) &&
    /\b(?:maximum allowed cash top[ -]?up|frs\s*[–-]\s*ra)\b/i.test(text);
  return headlineCap && personalReliefCap && ownSaLimit && ownRaLimit;
}

function hasGstMotorCarInputTaxRestriction(sourceText: string): boolean {
  return boundedRuleSourceUnits(sourceText).some(unit => {
    const text = unit.kind === 'statement' ? unit.text : `${unit.heading} ${unit.item}`;
    return /\b(?:input tax|gst)\b/i.test(text) && /\bmotor cars?\b/i.test(text) &&
      /\b(?:generally )?(?:blocked|disallow(?:ed)?|cannot claim|not claimable)\b/i.test(text) &&
      /\b(?:purchase|running expenses?)\b/i.test(text);
  });
}

export type GstMotorCarInputTaxExceptionKind = 'THIRD_PARTY' | 'CONNECTED_PERSON';

/** Identify only complete, bounded exception passages; cross-references and examples do not qualify. */
export function getGstMotorCarInputTaxExceptionKinds(sourceText: string): GstMotorCarInputTaxExceptionKind[] {
  const paragraphs = sourceText.normalize('NFC').replace(/\u00a0/g, ' ').split(/\r?\n[\t ]*\r?\n+/);
  const kinds = new Set<GstMotorCarInputTaxExceptionKind>();
  for (const paragraph of paragraphs) {
    if (paragraph.length > 3_200) continue;
    const sentences = sentenceParts(paragraph);
    const legacyThirdParty = sentences.some(text =>
      /\b(?:from|on or after) 1 jan(?:uary)? 2023\b/i.test(text) &&
      /\bmotor.car costs? incurred for a third party\b|\bmotor car\b[^.!?;:]{0,65}\bused by a third party\b/i.test(text) &&
      /\bcost and running expenses of the motor car incurred\b/i.test(text) &&
      /\b(?:may|can)\s+(?:be\s+)?claimed\b|\bwill be allowed\b[^.!?;:]{0,55}\bclaim(?:s)?\b/i.test(text) &&
      /\b(?:ordinary )?conditions for claiming input tax\b|\bconditions for input tax claim\b/i.test(text));
    const currentThirdParty = sentences.some(text =>
      /\bfrom 1 jan(?:uary)? 2023\b/i.test(text) &&
      /\byou can claim input tax on the cost and running expenses of a motor car used by a third party\b/i.test(text) &&
      /\bif you meet the conditions for claiming input tax\b/i.test(text)) &&
      sentences.some(text =>
        /^a third party does not include you or your employees, or a connected person\b/i.test(text));
    if (legacyThirdParty || currentThirdParty) {
      kinds.add('THIRD_PARTY');
    }
  }
  for (let index = 0; index < paragraphs.length; index += 1) {
    const boundedPassage = paragraphs.slice(index, index + 4).join(' ');
    if (boundedPassage.length > 3_200) continue;
    if (/\bexpenses on motor car used by a connected person\b/i.test(boundedPassage) &&
        /\bfrom 1 jan(?:uary)? 2023\b/i.test(boundedPassage) &&
        /\bcannot claim input tax on the cost and running expenses of the motor car\b/i.test(boundedPassage) &&
        /\bunless you satisfy both of the following conditions\b/i.test(boundedPassage) &&
        /\bin addition to the conditions for claiming input tax\b/i.test(boundedPassage) &&
        /\b1[.)]\s*you recover the motor car expenses from the connected person\b/i.test(boundedPassage) &&
        /\brecover only a portion\b[^.!?;:]{0,100}\bclaim input tax to the extent of the portion recovered\b/i.test(boundedPassage) &&
        /\b2[.)]\s*the recovery is not ancillary to any primary supply made by you to the connected person\b/i.test(boundedPassage)) {
      kinds.add('CONNECTED_PERSON');
    }
    const currentConnectedPersonPassage = paragraphs.slice(index, index + 5).join(' ');
    if (currentConnectedPersonPassage.length <= 3_200 &&
        /^motor car used by a connected person\b/i.test(paragraphs[index]) &&
        /\bfrom 1 jan(?:uary)? 2023\b[^.!?;:]{0,180}\bwhere a motor car is used by a connected person\b/i.test(currentConnectedPersonPassage) &&
        /\bgst incurred on the motor car expenses is generally not claimable\b/i.test(currentConnectedPersonPassage) &&
        /\ban exception applies only if you satisfy both of the following conditions\b/i.test(currentConnectedPersonPassage) &&
        /\byou recover the motor car expenses from the connected person\b/i.test(currentConnectedPersonPassage) &&
        /\brecover only a portion\b[^.!?;:]{0,100}\bonly claim input tax to the extent of the portion recovered\b/i.test(currentConnectedPersonPassage) &&
        /\bthe recovery is not ancillary to (?:any primary supply made by you to the connected person|any primary supply you make to them)\b/i.test(currentConnectedPersonPassage) &&
        /\bwhere the connected person is gst-registered, the input tax claim on the motor car expenses recovered by you is disallowed under regulation 27\b/i.test(currentConnectedPersonPassage)) {
      kinds.add('CONNECTED_PERSON');
    }
  }
  return [...kinds];
}

function hasSubstantiveGstMotorCarInputTaxExceptions(sourceText: string): boolean {
  const kinds = new Set(getGstMotorCarInputTaxExceptionKinds(sourceText));
  return kinds.has('THIRD_PARTY') && kinds.has('CONNECTED_PERSON');
}

function hasForeignDividendReceiptTaxRule(sourceText: string): boolean {
  const units = boundedRuleSourceUnits(sourceText);
  const hasForeignOrigin = (text: string) =>
    /\b(?:foreign[ -]sourced|foreign|overseas)\s+dividends?\b|\bdividends?\s+(?:from|sourced|derived|arising)\s+(?:overseas|abroad|outside singapore|a foreign source)\b/i.test(text);
  const hasForeignIncomeSubject = (text: string) => /\b(?:foreign[ -]sourced|foreign)\s+income\b/i.test(text);
  const dividendSubject = String.raw`(?:\b(?:foreign[ -]sourced|foreign|overseas)\s+dividends?\b|\bdividends?\s+(?:from|sourced|derived|arising)\s+(?:overseas|abroad|outside singapore|a foreign source)\b)`;
  const taxTreatment = String.raw`(?:(?:are|is|may be|can be|will be)\s+(?:taxable|exempt(?:ed)?(?: from tax)?|subject to tax|liable to tax)|may qualify for exemption)`;
  const singaporeReceipt = String.raw`(?:received|remitted)\s+(?:in|into|to) singapore`;
  const hasDividendSingaporeReceiptAndTax = (text: string) =>
    new RegExp(`${dividendSubject}(?:\\s+(?:that|which)\\s+are)?\\s+${singaporeReceipt}\\s+${taxTreatment}`, 'i').test(text) ||
    new RegExp(`${dividendSubject}(?:\\s+(?:that|which)\\s+are)?\\s+${taxTreatment}\\s+(?:(?:only\\s+)?(?:when|if|upon)\\s+)?(?:(?:they|these dividends?)\\s+)?(?:are\\s+)?${singaporeReceipt}`, 'i').test(text) ||
    /\b(?:specified\s+)?foreign[ -]sourced income\s+(?:that is\s+)?received\s+(?:in|into) singapore,?\s+including\s+(?:a\s+)?foreign dividend(?:\s+from\s+(?:an?\s+)?(?:overseas|foreign) subsidiary)?,?\s+(?:may qualify for exemption|may be exempt(?: from tax)?|is taxable|is exempt(?: from tax)?)\b/i.test(text);
  const headingOwnsSingaporeReceipt = (text: string) =>
    /\b(?:foreign[ -]sourced|foreign)\s+income\s+(?:that\s+is\s+|which\s+is\s+)?(?:received|remitted)\s+(?:in|into) singapore\b/i.test(text);
  const hasTaxTreatment = (text: string) =>
    /\b(?:taxable|exempt(?:ed)?(?: from tax)?|subject to tax|liable to tax|tax applies|may qualify for exemption|may be exempt)\b/i.test(text);
  const hasForeignPayerConfusion = (text: string) =>
    /\b(?:domestic|local)\b.{0,50}\bdividends?\b.{0,50}\b(?:foreign|overseas)\s+(?:company|subsidiary|payer)\b|\bdividends?\b.{0,40}\b(?:paid|issued|distributed)\b.{0,25}\bby\b.{0,20}\b(?:foreign|overseas)\s+(?:company|subsidiary|payer)\b/i.test(text);

  return units.some(unit => {
    if (unit.kind === 'statement') {
      const statement = unit.text;
      return hasDividendSingaporeReceiptAndTax(statement) && hasForeignOrigin(statement) && !hasForeignPayerConfusion(statement);
    }
    // A complete heading can qualify the dividend category that immediately
    // follows it. The heading itself must carry foreign origin, Singapore
    // receipt, and tax-rule meaning; a bare or orphan dividend label cannot.
    const heading = unit.heading;
    return /\b(?:income|dividends?)\b/i.test(heading) && (hasForeignOrigin(heading) || hasForeignIncomeSubject(heading)) &&
      headingOwnsSingaporeReceipt(heading) && /\btax\b/i.test(heading) &&
      /\bdividends?\b/i.test(unit.item) &&
      (hasTaxTreatment(heading) || hasTaxTreatment(unit.item) && hasDividendSingaporeReceiptAndTax(unit.item)) &&
      !hasForeignPayerConfusion(`${heading} ${unit.item}`);
  });
}

function hasDefinedForeignIncomeReceiptTaxRule(sourceText: string): boolean {
  const definition = /^\s*Foreign income refers to income derived from outside Singapore\.?\s*$/i;
  const generalTaxRule = /^\s*Generally, such income is taxable in Singapore when remitted to and received in Singapore\.?\s*$/i;
  const tradeBusinessQualification = /^\s*Where the foreign income arises from a trade or business carried on in Singapore, it is taxable in Singapore upon accrual, regardless of whether it is received in Singapore\.?\s*$/i;
  const paragraphs = sourceText.normalize('NFC').replace(/\u00a0/g, ' ')
    .split(/\r?\n[\t ]*\r?\n+/).map(paragraph => paragraph.trim()).filter(Boolean);
  const dividend = String.raw`(?:(?:foreign(?:[ -]sourced)?|overseas)\s+)?dividends?`;
  const ruleReference = String.raw`(?:this|the)\s+(?:(?:general|foreign income)\s+)?(?:definition|rule|category)`;
  const dividendExclusion = new RegExp([
    String.raw`\b${dividend}\b[^.!?]{0,40}\b(?:are|is)\s+(?:not\s+(?:included|covered)\s+(?:in|under|by)|(?!(?:not|never)\b)(?:expressly\s+)?excluded\s+(?:from|in|under|by))\s+${ruleReference}\b`,
    String.raw`\b${ruleReference}[^.!?]{0,45}\b(?:expressly\s+)?(?:excludes?|does\s+not\s+(?:include|cover)|doesn't\s+(?:include|cover))\b[^.!?]{0,25}\b${dividend}\b`,
    String.raw`\b${dividend}\s+(?:are|is)\s+(?!(?:not|never)\b)(?:expressly\s+)?excluded\b`
  ].join('|'), 'i');
  if (dividendExclusion.test(sourceText)) return false;

  return paragraphs.some(paragraph => {
    // The saved excerpt title may be joined to the paragraph by a renderer,
    // so discard only that exact title when it appears as a prefix. The three
    // source sentences themselves must still be the complete paragraph.
    const paragraphWithoutTitle = paragraph.replace(/^Tax Reliefs on Foreign Income\s+/i, '');
    const sentences = sentenceParts(paragraphWithoutTitle);
    return sentences.length === 3 && definition.test(sentences[0]) && generalTaxRule.test(sentences[1]) &&
      tradeBusinessQualification.test(sentences[2]);
  });
}

function hasGstInputTaxClaimRule(sourceText: string): boolean {
  const blockedSpecificException = (text: string) =>
    /\b(?:motor cars?|vehicles?|clubs?|staff medical|medical expenses?|blocked input tax|exceptions?|(?:special|specific|particular) exceptions?|limited restrictions?|only under this exception)\b/i.test(text);
  const negatesEntitlement = (text: string) =>
    /\bnot true that\b|\b(?:cannot|can't|does not|do not|doesn't|don't)\b.{0,45}\b(?:claim|recover|entitled)\b|\b(?:may|can) not\s+(?:claim|recover)\b/i.test(text);
  const meaningfulGeneralScope = (text: string) =>
    /\btaxable supplies\b|\bbusiness (?:purchases?|purposes?|expenses?)\b|\bused for (?:the )?(?:business|taxable supplies)\b|\b(?:conditions?|provided that|if the following)\b/i.test(text);
  const affirmativeEntitlement = (text: string) =>
    /\b(?:may|can|is entitled to|are entitled to|is allowed to|are allowed to)\s+(?:claim|recover)\b.{0,55}\binput[ -]tax\b|\b(?:may|can|is entitled to|are entitled to|is allowed to|are allowed to)\s+make\s+(?:an?\s+)?input[ -]tax\s+claims?\b|\binput[ -]tax\b.{0,55}\b(?:may|can) be (?:claimed|recovered)\b/i.test(text);

  return boundedRuleSourceUnits(sourceText).some(unit => {
    if (blockedSpecificException(unit.kind === 'statement' ? unit.text : `${unit.heading} ${unit.item}`)) return false;
    if (unit.kind === 'statement') {
      return hasPhrase(tokenize(unit.text), ['input', 'tax']) && affirmativeEntitlement(unit.text) &&
        meaningfulGeneralScope(unit.text) && !negatesEntitlement(unit.text);
    }
    const headingRequestsClaim = /^\s*(?:to|in order to)\s+(?:claim|recover)\s+input[ -]tax\s*:/i.test(unit.heading);
    const itemStatesCondition = /\b(?:must|need to|required to|should)\b/i.test(unit.item) &&
      /\b(?:taxable supplies|business purposes?|used for|purchases?)\b/i.test(unit.item);
    return headingRequestsClaim && itemStatesCondition && !negatesEntitlement(unit.item);
  });
}

function hasPrivateExpenseDeductibilityRule(sourceText: string): boolean {
  const directlyStatesRule = boundedRuleSourceUnits(sourceText).some(unit => {
    if (unit.kind !== 'statement') return false;
    const clause = unit.text;
    const words = tokenize(clause).map(canonicalWord);
    const privateExpense = includesAny(words, new Set(['private', 'personal'])) && includesAny(words, new Set(['expense', 'cost']));
    const explicitDisallowance =
      /\b(?:private|personal)\b[^.;:]{0,18}\bexpenses?\s+(?:are|is|will be|shall be|remain|considered|treated as)\s+(?:(?:generally|usually|normally)\s+)*(?:disallowed|non[ -]deductible|not (?:tax )?deductible|not allowed as (?:a )?deduction)\b/i.test(clause) ||
      /\b(?:private|personal)\b[^.;:]{0,18}\bexpenses?\s+cannot be deducted\b/i.test(clause) ||
      /\b(?:income )?tax treatment of (?:a|the)\s+(?:private|personal)\s+expense is that it is not (?:tax )?deductible\b/i.test(clause);
    const reversesDisallowance = /\b(?:not|never)\s+(?:be\s+)?disallowed\b|\bnot\s+non[ -]deductible\b|\bnot\s+true\s+that\b|\b(?:it is )?false that\b|\bnot\s+(?:a|an|the)?\s*private expenses?\b/i.test(clause);
    const enumerativeDisallowance =
      /\b(?:disallows?|prohibits?|bars?)\b[^.;:!?]{0,85}\b(?:deductions?|expenses?)\b[^.;:!?]{0,65}\b(?:including|such as|which include|among(?:st)? other things)\b[^.;:!?]{0,75}\b(?:private|personal|domestic)\b[^.;:!?]{0,30}\b(?:expenses?|costs?)\b/i.test(clause);
    const reversesEnumerativeDisallowance =
      /\b(?:it is )?(?:not true|false) that\b[^.;:!?]{0,65}\b(?:disallows?|prohibits?|bars?)\b|\b(?:does not|do not|did not|has not|have not|doesn't|don't|didn't|hasn't|haven't|cannot|can't|never|no longer|fails? to)\s+(?:disallow|prohibit|bar)\b/i.test(clause) ||
      /\b(?:whether|if|may|might|could|would|should|possibly|apparently|seemingly)\b[^.;:!?]{0,65}\b(?:disallows?|prohibits?|bars?)\b/i.test(clause) ||
      /\b(?:not|never|except|excluding|other than|but not|unless)\b[^.;:!?]{0,65}\b(?:private|personal|domestic)\s+(?:expenses?|costs?)\b/i.test(clause) ||
      /\b(?:private|personal|domestic)\s+(?:expenses?|costs?)\b[^.;:!?]{0,65}\b(?:are|is|may be|can be|could be|remain|remains)\s+(?:deductible|deducted|claimable|allowed as a deduction|not disallowed|not non[ -]deductible)\b/i.test(clause);
    return privateExpense && (explicitDisallowance && !reversesDisallowance ||
      enumerativeDisallowance && !reversesEnumerativeDisallowance);
  });
  if (directlyStatesRule) return true;

  // IRAS also states the general category first, then names private/personal
  // expenses in an immediately following "These include" sentence. Keep this
  // relationship within one paragraph and two consecutive sentences so a
  // nearby but unrelated example cannot supply the category's antecedent.
  const paragraphs = sourceText.normalize('NFC').replace(/\u00a0/g, ' ')
    .split(/\r?\n[\t ]*\r?\n+/).map(paragraph => paragraph.trim()).filter(Boolean);
  return paragraphs.some(paragraph => {
    const sentences = sentenceParts(paragraph);
    for (let index = 0; index + 1 < sentences.length; index += 1) {
      const categoryDefinition = sentences[index];
      const inclusion = sentences[index + 1];
      const definesNonDeductibleCategory = /^\s*non[ -]deductible business expenses?\s+(?:are|mean|refer to)\s+(?:expenses?|costs?)\b[^.!?;:]{0,180}\b(?:do not|does not|fail to)\s+(?:fulfil|fulfill|meet|satisfy)\b[^.!?;:]{0,45}\bconditions?(?:\s+above)?[.!?]?\s*$/i.test(categoryDefinition);
      const inclusionMatch = /^\s*these include\b[^.!?;:]{0,100}\b(?:private|personal)\s+expenses?\b/i.exec(inclusion);
      if (!definesNonDeductibleCategory || !inclusionMatch) continue;
      const privateExpenseMatch = /\b(?:private|personal)\s+expenses?\b/i.exec(inclusionMatch[0]);
      if (!privateExpenseMatch) continue;
      const privateExpenseStart = privateExpenseMatch.index;
      const privateExpenseEnd = privateExpenseStart + privateExpenseMatch[0].length;
      const beforeExpense = inclusion.slice(0, privateExpenseStart);
      const afterExpense = inclusion.slice(privateExpenseEnd);
      const excludesPrivateExpense = /\b(?:no|not|never|except|excluding|other than)\b/i.test(beforeExpense) ||
        /\b(?:except|excluding|other than|but not|unless|not included|excluded|not disallowed|not deductible)\b/i.test(afterExpense) ||
        /\b(?:are|is|may be|can be|could be|remain|remains)\b[^.!?;:]{0,35}\b(?:deductible|deducted|claimable|allowed as a deduction|not disallowed|not non[ -]deductible)\b/i.test(afterExpense);
      if (excludesPrivateExpense) continue;
      return true;
    }
    return false;
  });
}

function hasRoyaltyWithholdingRule(sourceText: string, requiresNonResident: boolean): boolean {
  return boundedRuleSourceUnits(sourceText).some(unit => {
    if (unit.kind !== 'statement') return false;
    const clause = unit.text;
    const royalty = /\broyalt(?:y|ies)\b/i.test(clause);
    const recipient = String.raw`(?:to|for)\s+(?:(?:a|an|the)\s+)?non[ -]?resident(?:\s+(?:companies?|entities?|persons?|individuals?|recipients?|payees?))?`;
    const royaltyRecipient = String.raw`\broyalt(?:y|ies)\b(?:\s+(?:payments?|paid|payable|made|is|are|received|receivable)){0,4}\s+${recipient}`;
    const existingWithholdingRule = requiresNonResident
      ? new RegExp(
          `\\b(?:withholding tax|wht)\\s+(?:may\\s+)?appl(?:y|ies)\\s+(?:to|on)\\s+${royaltyRecipient}\\b|${royaltyRecipient}(?:\\s+(?:and\\s+)?(?:are|is|may be|will be|shall be))?\\s+(?:subject to|liable to)\\s+(?:withholding tax|wht)\\b|\\broyalty withholding tax\\s+(?:may\\s+)?apply\\s+when\\s+(?:(?:a|the)\\s+)?(?:(?:singapore\\s+)?(?:payer|company|business))\\s+pays\\s+royalties\\s+${recipient}\\b`,
          'i'
        ).test(clause)
      : /\b(?:withholding tax|wht)\s+(?:may\s+)?appl(?:y|ies)\s+(?:to|on)\s+(?:royalt(?:y|ies)|(?:the )?royalty payments?)\b|\broyalt(?:y|ies)\b(?:\s+(?:payments?|paid|payable|made|is|are|received|receivable)){0,3}\s+(?:are|is|may be|will be|shall be)\s+(?:subject to|liable to)\s+(?:withholding tax|wht)\b|\b(?:payer|company)\s+(?:must|is required to)\s+withhold\s+(?:the )?tax\s+on\s+(?:that )?royalt(?:y|ies)\s+payments?\b/i.test(clause);
    const specifiedNaturePayment = /^\s*(?:(?:a|an|the)\s+)?(?:person|payer|company|business)\b(?:\s*\(\s*known as (?:the\s+)?payer\s*\))?(?:\s+(?:who\s+)?(?:makes?|making))\s+(?:(?:payments?|a payment)\s+of\s+(?:a\s+)?specified\s+nature|specified\s+payments?)\b/i.exec(clause);
    let specifiedNatureRoyaltyRule = false;
    if (specifiedNaturePayment) {
      const afterPayment = clause.slice(specifiedNaturePayment.index + specifiedNaturePayment[0].length);
      const royaltyExample = /(?:\be\.g\.|\bfor example\b|\bsuch as\b|\bincluding\b)[^.;:)]{0,70}\broyalt(?:y|ies)\b/i.exec(afterPayment);
      if (royaltyExample) {
        const afterRoyaltyExample = afterPayment.slice(royaltyExample.index + royaltyExample[0].length);
        const payeeBridge = /^\s*(?:,\s*(?:(?:interest|technical service fees?|service fees?|etc\.?)\s*,?\s*){0,4})?\)?\s*to\s+(?:(?:a|an|the)\s+)?non[ -]?resident\b/i.exec(afterRoyaltyExample);
        if (payeeBridge) {
          const afterPayee = afterRoyaltyExample.slice(payeeBridge[0].length);
          const obligation = /\b(?:must|shall|will|is required to|are required to|has to|have to)\s+withhold\b/i.exec(afterPayee.slice(0, 120));
          if (obligation) {
            const obligationObject = afterPayee.slice(obligation.index + obligation[0].length, obligation.index + obligation[0].length + 45);
            const obligationTail = afterPayee.slice(obligation.index);
            const recipientBridge = afterPayee.slice(0, obligation.index);
            const payeeType = '(?:companies|company|entities|entity|persons?|individuals?|recipients?|payees?)';
            const recognizedPayeeBridge = new RegExp(`^\\s*(?:${payeeType}\\b(?:\\s+or\\s+(?:(?:a|an|the)\\s+)?${payeeType}\\b)?)?(?:\\s*\\(\\s*known as (?:the\\s+)?payee\\s*\\))?(?:\\s*,?\\s+and)?\\s*$`, 'i').test(recipientBridge);
            const explicitTaxObjectMatch = /^\s+(?:(?:a|the)\s+)?(?:withholding\s+tax|tax|wht)\b/i.exec(obligationObject);
            const taxObjectRemainder = explicitTaxObjectMatch
              ? obligationTail.slice(obligation[0].length + explicitTaxObjectMatch[0].length)
              : '';
            const taxObjectEndsHere = /^\s*[.!?)]?\s*$/.test(taxObjectRemainder);
            const taxObjectTargetsSamePayment = /^\s+(?:on|for)\s+(?:(?:the|this|that|such)\s+)?(?:royalt(?:y|ies)|payment|amount)\b(?:\s+payment)?\s*[.!?)]?\s*$/i.test(taxObjectRemainder);
            const taxObjectSamePaymentRemittance = /^\s*(?:and\s+)?pay(?:s|ing)?\s+(?:the\s+)?amount withheld\b[^.;:]{0,50}\b(?:to iras|as (?:wht|withholding tax))\b\s*[.!?)]?\s*$/i.test(taxObjectRemainder);
            const explicitTaxObject = Boolean(explicitTaxObjectMatch &&
              (taxObjectEndsHere || taxObjectTargetsSamePayment || taxObjectSamePaymentRemittance));
            const paymentLinkedAmountObjectMatch = /^\s+(?:(?:a|the)\s+)?(?:percentage|amount|portion|part)\b[^.;:]{0,45}\bof\s+(?:(?:the|such)\s+)?(?:royalt(?:y|ies)\s+)?payment\b/i.exec(obligationObject);
            const afterPaymentObject = paymentLinkedAmountObjectMatch
              ? obligationTail.slice(obligation[0].length + paymentLinkedAmountObjectMatch[0].length)
              : '';
            const samePaymentRemittance = /^\s*(?:and\s+)?pay(?:s|ing)?\s+(?:the\s+)?amount withheld\b[^.;:]{0,50}\b(?:to iras|as (?:wht|withholding tax))\b/i.test(afterPaymentObject);
            specifiedNatureRoyaltyRule = recognizedPayeeBridge &&
              (explicitTaxObject || Boolean(paymentLinkedAmountObjectMatch && samePaymentRemittance));
          }
        }
        const exampleClose = afterPayment.indexOf(')', royaltyExample.index);
        const exampleContextEnd = exampleClose >= 0 && exampleClose - royaltyExample.index <= 100
          ? exampleClose + 1
          : Math.min(afterPayment.length, royaltyExample.index + 100);
        const exampleContext = afterPayment.slice(royaltyExample.index, exampleContextEnd);
        const exampleWithRoyaltyNegated = /\b(?:not|excluding|exclude|except|other than)\b[^.;:)]{0,40}\broyalt(?:y|ies)\b|\broyalt(?:y|ies)\b[^.;:)]{0,30}\b(?:excluded|not included)\b/i.test(exampleContext);
        if (exampleWithRoyaltyNegated) specifiedNatureRoyaltyRule = false;
      }
    }
    const withholdingRule = existingWithholdingRule || specifiedNatureRoyaltyRule;
    const negatesRule = /\bnot true that\b|\b(?:not|never|no)\b[^.;:]{0,35}\b(?:withholding tax|wht)\b[^.;:]{0,35}\b(?:apply|applies|applicable|due|payable)\b|\b(?:withholding tax|wht)\b[^.;:]{0,20}\b(?:does not|doesn't|never|not)\s+apply\b|\b(?:must|shall|will|should|may)\s+not\s+withhold\b|\b(?:is|are)\s+not\s+required\s+to\s+withhold\b|\b(?:does|do)\s+not\s+require\s+withholding\b/i.test(clause);
    return royalty && withholdingRule && !negatesRule;
  });
}

/**
 * Checks only bounded, general IRAS rule concepts. Undefined means this is not
 * one of the selected topic/concept families and legacy matching may proceed.
 * False means a recognized family was requested but its scope or source text
 * does not establish the general rule.
 */
export function supportGeneralIrasRuleConcept(input: GeneralIrasRuleSupportInput): GeneralIrasRuleSupport {
  const concepts = input.concepts || [];
  if ((input.population === undefined || input.population === 'COMPANY') &&
      ['IRAS_GST', 'IRAS_CORPORATE_TAX'].includes(input.domainId)) {
    for (const topicId of input.topicIds) {
      const request = { authority: 'IRAS', topicId, query: input.subject, subject: input.subject,
        sourceText: input.sourceText };
      const support = supportIrasMasKnowledgeRule(request) ?? supportStatutoryWorkflowRule(request);
      if (support === true && concepts.every(concept => (supportIrasMasKnowledgeRule({ ...request,
        subject: [concept.label, ...concept.terms].join(' ') }) ?? supportStatutoryWorkflowRule({ ...request,
        subject: [concept.label, ...concept.terms].join(' ') })) === true)) return true;
      // Incomplete new-family proof may use the bounded legacy semantic proof;
      // only an explicit new-family contradiction/scope veto blocks fallback.
      if (support === false && hasIrasMasKnowledgeContradiction(request)) return false;
    }
  }
  // Full-family proof is limited to general concepts. A checklist cannot prove
  // a specific blocked-input exception, supply classification, or entity case.
  if (input.population === undefined || input.population === 'COMPANY') {
    const requestedPhrases = [input.subject, ...concepts.flatMap(concept => [concept.label, ...concept.terms])];
    const topics = new Set(input.topicIds);
    let adapterTopicIds: string[] = [];
    if (input.domainId === 'IRAS_GST' && topics.size === 1 && topics.has('iras-gst-input-tax') &&
        usesOnlyAllowedWords(requestedPhrases, new Set([...GST_INPUT_TAX_SUBJECT_WORDS, ...IRAS_GENERAL_QUESTION_WORDS]))) {
      adapterTopicIds = ['iras-gst-input-tax'];
    } else if (input.domainId === 'IRAS_GST' && topics.size > 0 &&
        [...topics].every(topicId => IRAS_GST_OUTPUT_CATEGORY_TOPIC_IDS.has(topicId)) &&
        usesOnlyAllowedWords(requestedPhrases, IRAS_GST_OUTPUT_CATEGORY_WORDS)) {
      adapterTopicIds = [...topics];
    } else if (input.domainId === 'IRAS_CORPORATE_TAX' && topics.size === 1 &&
        [...topics].every(topicId => IRAS_ECI_GENERAL_TOPIC_IDS.has(topicId)) &&
        usesOnlyAllowedWords(requestedPhrases, IRAS_ECI_GENERAL_WORDS)) {
      adapterTopicIds = [...topics];
    }
    for (const topicId of adapterTopicIds) {
      const support = (subject: string): boolean | undefined => {
        const request = { authority: 'IRAS', topicId, query: subject, subject, sourceText: input.sourceText };
        return supportIrasCpfExpansionRule(request) ?? supportIrasCpfMasPracticalRule(request);
      };
      if (support(input.subject) === true && concepts.every(concept =>
        support([concept.label, ...concept.terms].join(' ')) === true)) return true;
    }
  }
  const subjectWords = tokenize(input.subject);
  const conceptWords = concepts.flatMap(concept => [concept.label, ...concept.terms].flatMap(tokenize));
  const words = [...subjectWords, ...conceptWords].map(canonicalWord);
  const family = selectedFamily(input, words);
  if (!family) return undefined;

  const populationAllowed = family === 'CPF_CASH_TOP_UP_RELIEF'
    ? input.population === undefined || input.population === 'INDIVIDUAL' || input.population === 'EMPLOYEE'
    : family === 'COMPANY_TAX_RESIDENCY' || family === 'GST_MOTOR_CAR_INPUT_TAX'
      ? input.population === undefined || input.population === 'COMPANY'
      : input.population === undefined || input.population === 'COMPANY';
  if (!populationAllowed) return family === 'CPF_CASH_TOP_UP_RELIEF' ? false : undefined;

  if (family === 'ROYALTY_WITHHOLDING_TAX' && hasOppositeRoyaltyPaymentDirection(input.subject)) return false;

  const expectedDomain = family === 'GST_INPUT_TAX' || family === 'GST_MOTOR_CAR_INPUT_TAX' ? 'IRAS_GST'
    : family === 'CPF_CASH_TOP_UP_RELIEF' ? 'IRAS_INDIVIDUAL_TAX' : 'IRAS_CORPORATE_TAX';
  if (input.domainId !== expectedDomain) return undefined;

  if (family !== 'GST_MOTOR_CAR_INPUT_TAX' && [...SPECIFIC_TOPIC_IDS].some(id => input.topicIds.includes(id))) return undefined;
  if (family === 'COMPANY_TAX_RESIDENCY') {
    const incorporationRequested = concepts.some(concept => concept.id === 'company_tax_residency_incorporation');
    return incorporationRequested
      ? hasCompanyTaxResidencyIncorporationQualification(input.sourceText)
      : hasCompanyTaxResidencyControlManagementRule(input.sourceText);
  }
  if (family === 'CPF_CASH_TOP_UP_RELIEF') {
    const ids = new Set(concepts.map(concept => concept.id));
    if (ids.has('cpf_cash_top_up_relief_eligibility')) return hasCpfCashTopUpEligibility(input.sourceText);
    if (ids.has('cpf_cash_top_up_relief_limits')) return hasCpfCashTopUpLimits(input.sourceText);
    return hasCpfCashTopUpIntroduction(input.sourceText);
  }
  if (family === 'GST_MOTOR_CAR_INPUT_TAX') {
    const exceptionsRequested = concepts.some(concept => concept.id === 'gst_motor_car_input_tax_exceptions');
    return exceptionsRequested
      ? hasSubstantiveGstMotorCarInputTaxExceptions(input.sourceText)
      : hasGstMotorCarInputTaxRestriction(input.sourceText);
  }
  if (family === 'ROYALTY_WITHHOLDING_TAX') {
    const requestedPhrases = [input.subject, ...concepts.flatMap(concept => [concept.label, ...concept.terms])];
    const hasResidentWithoutNonresidentQualifier = requestedPhrases.some(phrase => {
      const phraseWords = tokenize(phrase).map(canonicalWord);
      return phraseWords.some((word, index) => word === 'resident' && phraseWords[index - 1] !== 'non' &&
        !(index > 0 && phraseWords[index - 1] === 'nonresident'));
    });
    if (hasResidentWithoutNonresidentQualifier) return undefined;
  }
  const allowedWords = family === 'FOREIGN_DIVIDEND' ? FOREIGN_DIVIDEND_SUBJECT_WORDS
    : family === 'GST_INPUT_TAX' ? GST_INPUT_TAX_SUBJECT_WORDS
      : family === 'PRIVATE_EXPENSE_DEDUCTIBILITY' ? PRIVATE_EXPENSE_SUBJECT_WORDS
        : family === 'ROYALTY_WITHHOLDING_TAX' ? ROYALTY_WITHHOLDING_SUBJECT_WORDS : undefined;
  if (allowedWords && words.some(word => !allowedWords.has(word))) return undefined;

  const requiresNonResident = family === 'ROYALTY_WITHHOLDING_TAX' &&
    (words.includes('nonresident') || hasPhrase(words, ['non', 'resident']));

  switch (family) {
    case 'FOREIGN_DIVIDEND': return hasForeignDividendReceiptTaxRule(input.sourceText) ||
      hasDefinedForeignIncomeReceiptTaxRule(input.sourceText);
    case 'GST_INPUT_TAX': return hasGstInputTaxClaimRule(input.sourceText) ||
      input.topicIds.includes('iras-gst-input-tax') && supportIrasCpfExpansionRule({
        authority: 'IRAS', topicId: 'iras-gst-input-tax', query: input.subject,
        subject: input.subject, sourceText: input.sourceText }) === true;
    case 'PRIVATE_EXPENSE_DEDUCTIBILITY': return hasPrivateExpenseDeductibilityRule(input.sourceText);
    case 'ROYALTY_WITHHOLDING_TAX': return hasRoyaltyWithholdingRule(input.sourceText, requiresNonResident);
  }
}
