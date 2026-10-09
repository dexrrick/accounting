import { isExpectedIssue as isLegacyExpectedIssue } from './multi-authority-issue-scoring.mjs';

function words(value) {
  return String(value || '').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

function hasCompanyEntity(tokens) {
  return tokens.some(word => ['company', 'companies', 'corporate', 'corporation', 'corporations'].includes(word)) ||
    tokens.some((word, index) => word === 'business' && ['entity', 'entities'].includes(tokens[index + 1]));
}

function hasSequence(tokens, sequence) {
  return tokens.some((_word, start) => start + sequence.length <= tokens.length &&
    sequence.every((term, index) => tokens[start + index] === term));
}

function hasAny(tokens, values) {
  return tokens.some(word => values.includes(word));
}

function hasAnyPrefix(tokens, prefixes) {
  return tokens.some(word => prefixes.some(prefix => word.startsWith(prefix)));
}

function isExplicitlyUnregistered(tokens) {
  return hasAny(tokens, ['unregistered', 'nonregistered']) || hasSequence(tokens, ['un', 'registered']) ||
    hasSequence(tokens, ['not', 'registered']) || hasSequence(tokens, ['not', 'gst', 'registered']);
}

function hasGstRegistration(tokens) {
  return hasAny(tokens, ['registered']) && !isExplicitlyUnregistered(tokens);
}

const FOREIGN_DIVIDEND_WORDS = new Set([
  'a', 'an', 'the', 'this', 'that', 'its', 'their', 'our', 's', 'whether', 'company', 'companies', 'corporate', 'corporation',
  'corporations', 'business', 'businesses', 'entity', 'entities', 'singapore', 'foreign', 'overseas', 'source',
  'sourced', 'subsidiary', 'subsidiaries', 'dividend', 'dividends', 'receipt', 'receipts', 'receive', 'receives',
  'received', 'receiving', 'income', 'tax', 'taxes', 'taxation', 'taxable', 'treatment', 'rule', 'rules', 'general',
  'of', 'and', 'or', 'to', 'for', 'on', 'by', 'from', 'in', 'as', 'with', 'may', 'be', 'is', 'are', 'subject',
  'liable', 'apply', 'applies', 'payer', 'pay', 'pays', 'paid', 'paying', 'distribute', 'distributes', 'distributed', 'under'
]);
const GST_INPUT_RECOVERY_WORDS = new Set([
  'a', 'an', 'the', 'this', 'that', 'its', 'their', 'our', 's', 'whether', 'gst', 'input', 'tax', 'taxes', 'claim', 'claims',
  'claiming', 'claimed', 'recover', 'recovery', 'recoverable', 'recovering', 'recovered', 'purchase', 'purchases',
  'purchasing', 'acquisition', 'acquisitions', 'acquire', 'acquired', 'business', 'businesses', 'company', 'companies',
  'corporate', 'corporation', 'corporations', 'entity', 'entities', 'singapore', 'registered', 'registration', 'general', 'rule',
  'rules', 'condition', 'conditions', 'treatment', 'of', 'and', 'or', 'to', 'for', 'on', 'by', 'from', 'in', 'as', 'under',
  'with', 'may', 'be', 'is', 'are', 'subject'
]);

function withinVocabulary(tokens, family) {
  const allowed = family === 'FOREIGN_DIVIDEND_RECEIPT' ? FOREIGN_DIVIDEND_WORDS : GST_INPUT_RECOVERY_WORDS;
  return tokens.every(word => allowed.has(word));
}

function rejectsExpectedTerm(issue, expected) {
  const subjectWords = words(issue?.subject);
  return expected.rejectAny?.some(term => words(term).every(word => subjectWords.some(actual => actual.startsWith(word)))) || false;
}

function hasNegation(text, objectPattern) {
  return new RegExp(`\\b(?:no|not|never|without|cannot|can't|unable to)\\b.{0,55}\\b(?:${objectPattern})\\b`, 'i').test(text) ||
    new RegExp(`\\b(?:${objectPattern})\\b.{0,45}\\b(?:not|never|non recoverable|cannot be recovered|isn't recoverable)\\b`, 'i').test(text);
}

function foreignDividendReceiptScope(expectedSubject) {
  const text = words(expectedSubject);
  const normalized = text.join(' ');
  return withinVocabulary(text, 'FOREIGN_DIVIDEND_RECEIPT') &&
    !hasNarrowingOrMixedQualifier(text, normalized, 'FOREIGN_DIVIDEND_RECEIPT') &&
    hasCompanyEntity(text) && hasAny(text, ['tax', 'taxes', 'taxation', 'taxable']) &&
    hasAny(text, ['foreign', 'overseas']) && hasAny(text, ['dividend', 'dividends']) &&
    (hasAny(text, ['receipt', 'receipts', 'income']) || hasAnyPrefix(text, ['receiv']));
}

function gstInputRecoveryScope(expectedSubject) {
  const text = words(expectedSubject);
  const normalized = text.join(' ');
  return withinVocabulary(text, 'GST_INPUT_RECOVERY') &&
    !hasNarrowingOrMixedQualifier(text, normalized, 'GST_INPUT_RECOVERY') &&
    hasAny(text, ['gst']) && hasSequence(text, ['input', 'tax']) &&
    hasAnyPrefix(text, ['recover', 'claim']) && hasAnyPrefix(text, ['purchas', 'acquisit', 'acquir']) &&
    hasCompanyEntity(text) && hasAny(text, ['business', 'businesses']) && hasGstRegistration(text);
}

function hasNarrowingOrMixedQualifier(tokens, text, family) {
  if (tokens.some(word => word.startsWith('exempt') || word.startsWith('eligib') || word.startsWith('qualif'))) return true;
  if (family === 'FOREIGN_DIVIDEND_RECEIPT' && hasAny(tokens, ['credit', 'credits'])) return true;
  if (family === 'GST_INPUT_RECOVERY' && hasAny(tokens, ['blocked', 'disallowed', 'disallowance'])) return true;
  if (family === 'GST_INPUT_RECOVERY' && hasAny(tokens, ['private', 'personal'])) return true;
  if (hasAny(tokens, ['interest', 'cpf', 'wht', 'withholding', 'accounting', 'journal', 'payroll'])) return true;
  if (family === 'FOREIGN_DIVIDEND_RECEIPT' && hasAny(tokens,
    ['gst', 'input', 'output', 'residency', 'residence', 'resident', 'filing', 'reporting'])) return true;
  if (family === 'GST_INPUT_RECOVERY' && hasAny(tokens,
    ['dividend', 'dividends', 'residency', 'residence', 'resident', 'filing', 'reporting'])) return true;
  if (/\b(?:domestic|local|singapore sourced|singapore source)\b/.test(text)) return true;
  if (/\b(?:and|or|versus|vs)\b/.test(text) && (
    family === 'FOREIGN_DIVIDEND_RECEIPT' && /\b(?:residen(?:ce|cy|t)|expense|payroll|employee|loan|income stream)\b/.test(text) ||
    family === 'GST_INPUT_RECOVERY' && /\b(?:dividend|interest|output tax|private expense|withholding|residen(?:ce|cy|t))\b/.test(text)
  )) return true;
  return false;
}

function foreignDividendReceiptMatch(subject) {
  const text = words(subject).join(' ');
  const tokens = words(subject);
  if (!withinVocabulary(tokens, 'FOREIGN_DIVIDEND_RECEIPT')) return false;
  if (hasNarrowingOrMixedQualifier(tokens, text, 'FOREIGN_DIVIDEND_RECEIPT')) return false;
  if (!hasAny(tokens, ['tax', 'taxes', 'taxation', 'taxable'])) return false;
  if (!hasCompanyEntity(tokens) || !hasAny(tokens, ['dividend', 'dividends'])) return false;
  const dividendReceivedFromForeignSubsidiary = /\bdividends?\b.{0,30}\breceiv\w*\b.{0,45}\bfrom\b.{0,25}\b(?:a|an|the)?\s*(?:foreign|overseas)\s+subsidiar(?:y|ies)\b/.test(text);
  const foreignSource = /\b(?:foreign|overseas)\s+(?:(?:sourced|source)\s+)?dividends?\b/.test(text) ||
    /\bdividends?\b.{0,45}\bfrom\b.{0,30}\b(?:foreign|overseas)\b/.test(text) ||
    /\b(?:foreign|overseas)\s+subsidiar(?:y|ies)\b.{0,45}\bdividends?\b/.test(text) ||
    dividendReceivedFromForeignSubsidiary;
  if (!foreignSource) return false;

  const companyReceipt = /\b(?:company|companies|corporate|corporation|corporations|business entity|business entities)\b.{0,55}\b(?:receiv\w*|receipt|receipts|income)\b.{0,45}\bdividends?\b/.test(text) ||
    /\bdividends?\b.{0,45}\b(?:receiv\w*|receipt|receipts)\b.{0,35}\b(?:by|for|of)\b.{0,25}\b(?:company|companies|corporate|corporation|corporations|business entity|business entities)\b/.test(text) ||
    /\b(?:company|companies|corporate|corporation|corporations|business entity|business entities)\b.{0,45}\b(?:foreign|overseas)\b.{0,20}\bdividends?\b.{0,25}\b(?:receipt|receipts|income)\b/.test(text) ||
    (hasCompanyEntity(tokens) && dividendReceivedFromForeignSubsidiary) ||
    /\b(?:foreign|overseas)\s+subsidiar(?:y|ies)\b.{0,45}\b(?:pay\w*|distribut\w*)\b.{0,35}\b(?:to|for)\b.{0,25}\b(?:company|companies|corporate|corporation|corporations|business entity|business entities)\b/.test(text);
  if (!companyReceipt) return false;

  const companyPaysDividend = /\b(?:company|companies|corporate|corporation|corporations|business entity|business entities)\b.{0,45}\b(?:pay\w*|distribut\w*)\b.{0,40}\bdividends?\b.{0,45}\b(?:to|for)\b/.test(text) ||
    /\bdividends?\b.{0,30}\b(?:paid|distributed)\b.{0,25}\bby\b.{0,25}\b(?:company|companies|corporation|corporations)\b/.test(text);
  if (companyPaysDividend) return false;
  return !hasNegation(text, 'foreign|overseas|dividends?|receiv\\w*|receipt|income');
}

function gstInputRecoveryMatch(subject) {
  const text = words(subject).join(' ');
  const tokens = words(subject);
  if (!withinVocabulary(tokens, 'GST_INPUT_RECOVERY')) return false;
  if (hasNarrowingOrMixedQualifier(tokens, text, 'GST_INPUT_RECOVERY')) return false;
  if (hasAnyPrefix(tokens, ['nonrecover', 'nonclaim'])) return false;
  if (!hasAny(tokens, ['gst']) || !hasSequence(tokens, ['input', 'tax']) ||
      !(hasCompanyEntity(tokens) || hasAny(tokens, ['business', 'businesses']))) return false;
  if (!hasAnyPrefix(tokens, ['recover', 'claim'])) return false;
  if (!hasAnyPrefix(tokens, ['purchas', 'acquisit', 'acquir'])) return false;
  if (hasAny(tokens, ['output'])) return false;
  if (hasAny(tokens, ['private', 'personal'])) return false;
  if (!hasGstRegistration(tokens)) return false;
  if (!hasAny(tokens, ['business', 'businesses'])) return false;
  return !hasNegation(text, 'input tax|recover\\w*|claim\\w*');
}

function specializedFamily(expected) {
  if (foreignDividendReceiptScope(expected.subject)) return 'FOREIGN_DIVIDEND_RECEIPT';
  if (gstInputRecoveryScope(expected.subject)) return 'GST_INPUT_RECOVERY';
  return undefined;
}

function specializedMatch(issue, family) {
  const subject = issue?.subject;
  if (typeof subject !== 'string') return false;
  if (family === 'FOREIGN_DIVIDEND_RECEIPT') return foreignDividendReceiptMatch(subject);
  return gstInputRecoveryMatch(subject);
}

/**
 * Prospective subject scorer V2. Foreign-dividend receipt and GST input-recovery
 * contracts are terminal: a rejected specialized match never falls through to
 * the legacy anchor matcher. Other bounded legacy contracts retain their prior
 * subject-only matching behavior. Expected issue dimensions are not consulted.
 */
export function isExpectedIssueV2(issue, expected) {
  if (!expected || typeof expected !== 'object') return false;
  if (rejectsExpectedTerm(issue, expected)) return false;
  const family = specializedFamily(expected || {});
  return family ? specializedMatch(issue, family) : isLegacyExpectedIssue(issue, expected);
}

/** Maximum one-to-one matching uses the V2 subject predicate for every pair. */
export function matchIssuesV2(expectedIssues, actualIssues) {
  const ownerByExpected = new Map();
  const visit = (actualIndex, seen) => {
    for (let expectedIndex = 0; expectedIndex < expectedIssues.length; expectedIndex += 1) {
      if (seen.has(expectedIndex) || !isExpectedIssueV2(actualIssues[actualIndex], expectedIssues[expectedIndex])) continue;
      seen.add(expectedIndex);
      const previous = ownerByExpected.get(expectedIndex);
      if (previous === undefined || visit(previous, seen)) {
        ownerByExpected.set(expectedIndex, actualIndex);
        return true;
      }
    }
    return false;
  };
  for (let index = 0; index < actualIssues.length; index += 1) visit(index, new Set());
  const expectedByActual = new Map([...ownerByExpected.entries()].map(([expectedIndex, actualIndex]) => [actualIndex, expectedIndex]));
  return { ownerByExpected, expectedByActual };
}

function sameSet(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length &&
    [...actual].sort().every((item, index) => item === [...expected].sort()[index]);
}

/** Dimension scoring stays independent after a V2 subject match. */
export function scoreIssueDimensionsV2(actual, expected) {
  return {
    governingAuthority: sameSet(actual.governingAuthorities, expected.governingAuthorities),
    contextualAuthority: expected.contextualAuthoritiesAnyOf.some(candidate => sameSet(actual.contextualAuthorities, candidate)),
    domain: expected.domain.includes(actual.domain),
    population: expected.population.includes(actual.population),
    operation: expected.operation.includes(actual.operation)
  };
}
