import type { AccountCategory, JournalEntryGroup } from '../types/accounting';

export interface JournalIntegrityIssue {
  code:
    | 'EMPTY_JOURNAL'
    | 'INVALID_LINE'
    | 'IMBALANCED_GROUP'
    | 'TOTAL_MISMATCH'
    | 'CATEGORY_MISMATCH'
    | 'DIRECTION_CONTRADICTION'
    | 'UNSTATED_AMOUNT';
  message: string;
  groupTitle?: string;
  accountName?: string;
}

export interface JournalIntegrityResult {
  isValid: boolean;
  issues: JournalIntegrityIssue[];
}

const VALID_CATEGORIES = new Set<AccountCategory>([
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'EXPENSE',
  'OTHER_COMPREHENSIVE_INCOME'
]);

/**
 * Maps known account names to their mandatory standard accounting category.
 */
function getMandatoryCategory(accountName: string): AccountCategory | undefined {
  const n = accountName.trim().toLowerCase();

  // EXPENSE
  if ((n.endsWith(' expense') || n.endsWith(' expenses')) && !n.startsWith('prepaid ') && !n.startsWith('accrued ')) {
    return 'EXPENSE';
  }
  if (n === 'cost of goods sold' || n === 'cost of sales' || (n.includes('depreciation') && !n.includes('accumulated'))) {
    return 'EXPENSE';
  }
  if (n === 'discount allowed' || n === 'expected credit loss' || n === 'expected credit losses' || n.startsWith('impairment loss')) {
    return 'EXPENSE';
  }

  // ASSET
  if (n.startsWith('prepaid ') || n === 'prepayments' || n === 'prepayment') {
    return 'ASSET';
  }
  const assetNames = [
    'trade receivables', 'trade receivable', 'accounts receivable', 'account receivable',
    'other receivables', 'other receivable', 'input gst receivable', 'input gst receivables',
    'refundable deposits', 'refundable deposit', 'security deposit', 'security deposits',
    'rental deposit', 'rental deposits', 'cash', 'cash on hand', 'petty cash',
    'cash at bank', 'current account', 'savings account', 'checking account',
    'cheque account', 'operating account', 'business account', 'inventory',
    'merchandise inventory', 'right-of-use asset', 'right-of-use assets',
    'allowance for doubtful debts', 'allowance for doubtful accounts',
    'loss allowance — trade receivables', 'loss allowance - trade receivables'
  ];
  if (assetNames.includes(n)) {
    return 'ASSET';
  }

  // LIABILITY
  const liabilityNames = [
    'trade payables', 'trade payable', 'accounts payable', 'account payable',
    'other payables', 'other payable', 'output gst payable', 'output gst payables',
    'gst payable', 'bank loan', 'bank loans', 'loan payable', 'loans payable',
    'lease liability', 'lease liabilities'
  ];
  if (
    liabilityNames.includes(n) ||
    n.startsWith('accrued ') ||
    n.startsWith('unearned ') ||
    n.startsWith('deferred revenue') ||
    n === 'contract liability' ||
    n === 'provisions' ||
    n === 'warranty provision' ||
    (n.startsWith('provision for ') && !n.includes('doubtful') && !n.includes('bad debt'))
  ) {
    return 'LIABILITY';
  }

  // EQUITY
  if (!n.includes('unpaid') && !n.includes('receivable') && !n.includes('due from')) {
    const equityNames = [
      'share capital', 'ordinary share capital', "owner's capital", "owner's drawings",
      'drawings', 'retained earnings'
    ];
    if (equityNames.includes(n)) {
      return 'EQUITY';
    }
  }

  // REVENUE
  if (
    (n === 'revenue' || n === 'sales revenue' || n === 'service revenue') &&
    !n.startsWith('unearned ') &&
    !n.startsWith('deferred ')
  ) {
    return 'REVENUE';
  }
  if (
    n === 'sales returns and allowances' ||
    n === 'sales returns' ||
    n === 'sales allowances' ||
    n === 'discount received'
  ) {
    return 'REVENUE';
  }

  return undefined;
}

export interface ValidateJournalGroupsOptions {
  rawQuery?: string;
  hasPriorContextAmount?: boolean;
  hasImageEvidence?: boolean;
  evidenceTexts?: string[];
}

const CURRENCY_PREFIXED_AMOUNT_REGEX = /(?:\b(?:sgd|usd|eur|gbp|aud|myr|rmb|cny|jpy|hkd|nzd|cad|chf|idr|thb|php|vnd|inr|krw|twd)\b|s\$|us\$|hk\$|au\$|nz\$|ca\$|\brm\b|£|€|¥|\$)\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:k|m|bn|thousand|million|billion))?\b/i;
const CURRENCY_SUFFIXED_AMOUNT_REGEX = /\b\d[\d,]*(?:\.\d+)?(?:\s*(?:k|m|bn|thousand|million|billion))?\s*(?:sgd|usd|eur|gbp|aud|myr|rmb|cny|jpy|hkd|nzd|cad|chf|dollars?|cents?)\b/i;
const ABBREVIATED_AMOUNT_REGEX = /\b\d[\d,]*(?:\.\d+)?\s*(?:k|m|bn|thousand|million|billion|cents?)\b/i;
const SPELLED_CURRENCY_AMOUNT_REGEX = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)(?:[\s-]+(?:and|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion))*\s+(?:dollars?|cents?|sgd|usd|eur|gbp)\b/i;
const STANDALONE_MONETARY_REPLY_REGEX = /^(?:\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?\s*(?:k|m|bn|thousand|million|billion)|\d+\.\d{2}|(?!19\d{2}$|20\d{2}$)\d+(?:\.\d+)?)$/i;
const MONETARY_PREDICATE_BEFORE_REGEX = /\b(?:paid|pay(?:s|ing)?|payment|cost(?:s|ing)?|price(?:d)?|list\s+price|amount|total(?:s|ing)?|subtotal|worth|value(?:d)?|salary|salaries|wage(?:s)?|bonus|rent(?:al)?|fee(?:s)?|charge(?:d|s)?|bill(?:ed)?|invoic(?:e|ed)|receiv(?:e|ed|es)|collected|deposit(?:ed)?|balance|payable|receivable|loan|principal|proceeds|consideration|discount|gst|tax|capital|equity|dividend|refund|allowance|outlay|spent|spend(?:ing)?|expense|revenue|sales|income|transfer(?:red)?|remit(?:ted)?|settl(?:e|ed|ement)|contribution|levy|debit|credit)\s+(?:(?:of|is|was|at|for|to|=|:|about|around|approximately|up\s+to|via\s+bank(?:\s+transfer)?|by\s+bank(?:\s+transfer)?|in\s+cash|cash|immediately|upfront)\s+){0,2}\d[\d,]*(?:\.\d+)?\b/i;
const MONETARY_PREDICATE_AFTER_REGEX = /\b\d[\d,]*(?:\.\d+)?\s+(?:in\s+cash|cash|paid|payable|receivable|deposit|down\s*payment|salary|rent(?:al)?|fee(?:s)?|bonus|loan|dividend|refund|gst|tax|discount|per\s+month|monthly|a\s+month|per\s+year|annually|p\.a\.)\b/i;
const TRANSACTION_FOR_AMOUNT_REGEX = /\b(?:sold|sell(?:s|ing)?|bought|buy(?:s|ing)?|purchas(?:e|es|ed|ing)|acquir(?:e|es|ed|ing)|dispos(?:e|es|ed|ing)|borrow(?:s|ed|ing)?|lent|lend(?:s|ing)?|invoic(?:e|es|ed|ing)|bill(?:s|ed|ing)?)\b[^.!?;]{0,40}\b(?:for|at)\s+\d[\d,]*(?:\.\d+)?(?=$|[\s,.;:!?]+(?:on|in|by|via|to|from|and|with|plus|less|each|per|cash|bank|credit|cheque|check|immediately|upfront|excluding|exclusive|including|inclusive)\b|[\s,.;:!?]*$)/i;

const NON_MONETARY_IMAGE_FIELD_REGEX = /\b(?:qty|quantity|count|pieces?|pcs|shares?|lots?|rate|rates|percent(?:age)?|pct|ratio|index|number|no|num|code|ref(?:erence)?|id|page|line|row|col(?:umn)?|confidence|score|age|term|tenure|months?|years?|days?|weeks?|hours?|date|year|month|day|serial|batch|floor|room|phone|tel|fax|postal|zip|uen)\b/i;
const MONETARY_IMAGE_FIELD_REGEX = /\b(?:amount|amt|total|sub\s*total|subtotal|price|cost|payment|paid|payable|receivable|cash|bank|balance|deposit|proceeds|value|consideration|gst|tax|vat|discount|salary|salaries|wage|wages|cpf|sdl|bonus|rent|rental|fee|fees|charge|charges|expense|expenses|revenue|sales|income|loan|principal|interest|debit|credit|net|gross|capital|equity|dividend|refund|allowance|provision|carrying|nbv|depreciation|amorti[sz]ation|premium|commission|settlement|reimbursement|outlay|spend|budget|limit|contribution|levy)\b/i;

function stripNonMonetaryTokens(text: string): string {
  return text
    // ISO and slash/dash dates: 2026-07-01, 01/08/2026, 01-08-2026
    .replace(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g, ' ')
    // Month-name dates: 15 May 2026, May 15, 2026, September 2026, 15th May
    .replace(/\b(?:\d{1,2}(?:st|nd|rd|th)?\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{1,2}(?:st|nd|rd|th)?,?)?(?:\s+\d{4})?\b/gi, ' ')
    // Reference / invoice / receipt / PO / GL / account / code / serial / batch / floor / room / page / standard / section numbers
    .replace(/\b(?:sfrs\(i\)|frs|ias|ifrs)\s*\d+(?:-\d+)?(?:\s*(?:§|para(?:graph)?|p\.?)\s*\d+(?:\.\d+)*)?\b/gi, ' ')
    .replace(/§\s*\d+[a-z0-9()./-]*/gi, ' ')
    .replace(/(?<!['’])\b(?:section|sec\.?|s\.|regulation|reg\.?|schedule|sched\.?|article|art\.?|paragraph|para\.?)\s*\d+[a-z0-9()./-]*\b/gi, ' ')
    .replace(/(?:\b(?:inv(?:oice)?|receipt|rcpt|ref(?:erence)?|po|gl|acct|account(?:\s+code)?|code|doc|voucher|cheque|check|order|serial(?:\s+(?:no|num|number))?|batch(?:\s+(?:no|num|number))?|floor|level|room|suite|unit(?:\s+(?:no|num|number))?|page|line|item(?:\s+(?:no|num|number))?|qty|quantity|no\.?)\s*[:#=-]?\s*|#\s*)[a-z]*\d+[a-z0-9-]*\b/gi, ' ')
    .replace(/\b[a-z]{1,6}-\d[\d-]*\b/gi, ' ')
    // Exchange / FX / spot / closing / interest / tax / GST rates
    .replace(/\b(?:(?:spot|fx|exchange|closing|average|historical|conversion|interest|tax|gst|discount)\s+rate|rate(?:\s+of)?)\s*(?:is|was|at|of|=|:)?\s*\d[\d,]*(?:\.\d+)?\b/gi, ' ')
    // Percentages
    .replace(/\b\d+(?:\.\d+)?\s*%/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*percent\b/gi, ' ')
    // Ages and durations
    .replace(/\b(?:age\s*[:=]?\s*\d+|aged\s*[:=]?\s*\d+|\d+\s*-?\s*year(?:s)?[\s-]*old)\b/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*-?\s*(?:years?|yrs?|months?|mos?|weeks?|wks?|days?|hours?|hrs?)\b/gi, ' ')
    // Share, quantity, and counted physical-unit expressions (e.g., "100 shares", "5k shares", "50 laptops", "200 units")
    .replace(/\b\d[\d,]*(?:\.\d+)?(?:\s*(?:k|m|bn|thousand|million|billion))?\s+(?:[a-z]+\s+)?(?:shares?|units?|pieces?|pcs|items?|boxes?|cartons?|pallets?|packs?|sets?|lots?|laptops?|computers?|monitors?|desks?|chairs?|machines?|vehicles?|cars?|trucks?|printers?|servers?|phones?|employees?|workers?|staff|directors?|shareholders?|invoices?|receipts?|pages?|lines?|kg|g|litres?|liters?|metres?|meters?|sqft|sqm|km)\b/gi, ' ')
    // Standalone 4-digit years (1900-2099)
    .replace(/\b(?:19|20)\d{2}\b/g, ' ');
}

/**
 * Returns true when an extracted image/evidence field name denotes a genuine
 * monetary figure rather than a quantity, code, identifier, rate, or date.
 */
export function isMonetaryImageFieldName(fieldName: unknown): boolean {
  if (typeof fieldName !== 'string') return false;
  const normalized = fieldName
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  if (NON_MONETARY_IMAGE_FIELD_REGEX.test(normalized)) return false;
  if (/\bunits?\b/i.test(normalized) && !/\b(?:price|cost|amount|value|fee|charge)\b/i.test(normalized)) {
    return false;
  }
  return MONETARY_IMAGE_FIELD_REGEX.test(normalized);
}

/**
 * Returns true when `text` contains genuine monetary evidence rather than only
 * dates, years, percentages, ages, durations, quantities, rates, or reference numbers.
 */
export function hasMonetaryEvidence(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (
    CURRENCY_PREFIXED_AMOUNT_REGEX.test(trimmed) ||
    CURRENCY_SUFFIXED_AMOUNT_REGEX.test(trimmed) ||
    SPELLED_CURRENCY_AMOUNT_REGEX.test(trimmed) ||
    STANDALONE_MONETARY_REPLY_REGEX.test(trimmed)
  ) {
    return true;
  }

  const stripped = stripNonMonetaryTokens(trimmed);
  if (ABBREVIATED_AMOUNT_REGEX.test(stripped)) {
    return true;
  }
  return (
    MONETARY_PREDICATE_BEFORE_REGEX.test(stripped) ||
    MONETARY_PREDICATE_AFTER_REGEX.test(stripped) ||
    TRANSACTION_FOR_AMOUNT_REGEX.test(stripped)
  );
}

function hasPositiveNumericValue(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function hasPositiveMonetaryFieldValue(value: unknown): boolean {
  if (hasPositiveNumericValue(value)) return true;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (CURRENCY_PREFIXED_AMOUNT_REGEX.test(trimmed) || CURRENCY_SUFFIXED_AMOUNT_REGEX.test(trimmed)) {
      const numeric = Number(trimmed.replace(/[^0-9.-]/g, ''));
      return Number.isFinite(numeric) && numeric > 0;
    }
  }
  return false;
}

/**
 * Returns true when verified image or extracted evidence supplies at least one
 * finite positive monetary figure in a monetary field or extracted journal line.
 */
export function hasVerifiedNumericImageEvidence(imageEvidence?: unknown, extractedEvidence?: unknown): boolean {
  if (Array.isArray(imageEvidence)) {
    for (const item of imageEvidence) {
      if (!item || typeof item !== 'object') continue;
      const record = item as { fields?: unknown; journalLines?: unknown };
      if (Array.isArray(record.fields)) {
        for (const field of record.fields) {
          if (!field || typeof field !== 'object') continue;
          const f = field as { field?: unknown; name?: unknown; label?: unknown; value?: unknown };
          const fieldName = f.field ?? f.name ?? f.label;
          if (isMonetaryImageFieldName(fieldName) && hasPositiveMonetaryFieldValue(f.value)) {
            return true;
          }
        }
      }
      if (Array.isArray(record.journalLines)) {
        for (const line of record.journalLines) {
          if (!line || typeof line !== 'object') continue;
          const jl = line as { debit?: unknown; credit?: unknown };
          if (hasPositiveNumericValue(jl.debit) || hasPositiveNumericValue(jl.credit)) {
            return true;
          }
        }
      }
    }
  }

  if (Array.isArray(extractedEvidence)) {
    for (const item of extractedEvidence) {
      if (!item || typeof item !== 'object') continue;
      const ev = item as { source?: unknown; field?: unknown; name?: unknown; label?: unknown; value?: unknown };
      const fieldName = ev.field ?? ev.name ?? ev.label;
      if (ev.source === 'image' && isMonetaryImageFieldName(fieldName) && hasPositiveMonetaryFieldValue(ev.value)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Deterministically validates journal entry groups against exact double-entry,
 * integer-cent precision, account classification, and unstated amount invariants.
 */
export function validateJournalGroups(
  groups: JournalEntryGroup[],
  options?: ValidateJournalGroupsOptions
): JournalIntegrityResult {
  const issues: JournalIntegrityIssue[] = [];

  // Rule 1: groups must be a non-empty array
  if (!Array.isArray(groups) || groups.length === 0) {
    return {
      isValid: false,
      issues: [{
        code: 'EMPTY_JOURNAL',
        message: 'The journal entry contains no groups.'
      }]
    };
  }

  for (const group of groups) {
    const groupTitle = group.title || 'Untitled Group';
    if (!Array.isArray(group.lines) || group.lines.length < 2) {
      issues.push({
        code: 'INVALID_LINE',
        message: `Group '${groupTitle}' must contain at least 2 journal lines.`,
        groupTitle
      });
      continue;
    }

    let totalDebitCents = 0;
    let totalCreditCents = 0;
    let groupLinesValid = true;

    for (const line of group.lines) {
      const lineAccountName = typeof line.accountName === 'string' ? line.accountName.trim() : '';

      // Rule 2: accountName non-empty, category valid, finite amounts >= 0
      if (!lineAccountName || !VALID_CATEGORIES.has(line.category)) {
        issues.push({
          code: 'INVALID_LINE',
          message: `Line '${lineAccountName || 'Unknown'}' in group '${groupTitle}' has an invalid account name or category.`,
          groupTitle,
          accountName: lineAccountName
        });
        groupLinesValid = false;
        continue;
      }

      if (
        typeof line.debit !== 'number' ||
        !Number.isFinite(line.debit) ||
        line.debit < 0 ||
        typeof line.credit !== 'number' ||
        !Number.isFinite(line.credit) ||
        line.credit < 0
      ) {
        issues.push({
          code: 'INVALID_LINE',
          message: `Line '${lineAccountName}' in group '${groupTitle}' has negative or non-finite debit/credit amounts.`,
          groupTitle,
          accountName: lineAccountName
        });
        groupLinesValid = false;
        continue;
      }

      const debitCents = Math.round(line.debit * 100);
      const creditCents = Math.round(line.credit * 100);

      if (
        !Number.isSafeInteger(debitCents) ||
        !Number.isSafeInteger(creditCents) ||
        debitCents / 100 !== line.debit ||
        creditCents / 100 !== line.credit
      ) {
        issues.push({
          code: 'INVALID_LINE',
          message: `Line '${lineAccountName}' in group '${groupTitle}' does not use exact integer cents.`,
          groupTitle,
          accountName: lineAccountName
        });
        groupLinesValid = false;
        continue;
      }

      // One-sided non-zero amount: (debitCents > 0) !== (creditCents > 0)
      if ((debitCents > 0) === (creditCents > 0)) {
        issues.push({
          code: 'INVALID_LINE',
          message: `Line '${lineAccountName}' in group '${groupTitle}' must have a single-sided non-zero amount (cannot have both debit and credit, or both zero).`,
          groupTitle,
          accountName: lineAccountName
        });
        groupLinesValid = false;
        continue;
      }

      totalDebitCents += debitCents;
      totalCreditCents += creditCents;

      // Rule 4: Account category classification rules
      const mandatoryCategory = getMandatoryCategory(lineAccountName);
      if (mandatoryCategory && line.category !== mandatoryCategory) {
        issues.push({
          code: 'CATEGORY_MISMATCH',
          message: `Account '${lineAccountName}' must be classified as ${mandatoryCategory}, but was given as ${line.category}.`,
          groupTitle,
          accountName: lineAccountName
        });
      }

      // Rule 5: Fundamental direction check
      const n = lineAccountName.toLowerCase();
      const groupContext = `${groupTitle} ${group.summary || ''}`;
      const isReturnOrReversal = /\b(?:return|reversal|refund|correcting|reversing|credit\s+note)\b/i.test(groupContext);
      const isDrawingsClosing = /\b(?:close|closing|reversal|reversing|reversed)\b/i.test(groupContext);

      if ((n === 'cost of goods sold' || n === 'cost of sales') && creditCents > 0 && !isReturnOrReversal) {
        issues.push({
          code: 'DIRECTION_CONTRADICTION',
          message: `Account '${lineAccountName}' cannot be credited unless recording a return or reversal.`,
          groupTitle,
          accountName: lineAccountName
        });
      }

      if ((n === "owner's drawings" || n === 'drawings') && creditCents > 0 && !isDrawingsClosing) {
        issues.push({
          code: 'DIRECTION_CONTRADICTION',
          message: `Account '${lineAccountName}' cannot be credited unless closing drawings or recording a reversal.`,
          groupTitle,
          accountName: lineAccountName
        });
      }
    }

    if (!groupLinesValid) {
      continue;
    }

    // Rule 3: Group totals & balance
    if (
      totalDebitCents <= 0 ||
      totalCreditCents <= 0 ||
      !Number.isSafeInteger(totalDebitCents) ||
      !Number.isSafeInteger(totalCreditCents) ||
      totalDebitCents !== totalCreditCents
    ) {
      issues.push({
        code: 'IMBALANCED_GROUP',
        message: `Group '${groupTitle}' is imbalanced: Total Dr (${(totalDebitCents / 100).toFixed(2)}) != Total Cr (${(totalCreditCents / 100).toFixed(2)}).`,
        groupTitle
      });
    }

    const headerDrCents = Math.round((group.totalDebit ?? 0) * 100);
    const headerCrCents = Math.round((group.totalCredit ?? 0) * 100);

    if (
      headerDrCents !== totalDebitCents ||
      headerCrCents !== totalCreditCents ||
      group.isBalanced !== true
    ) {
      issues.push({
        code: 'TOTAL_MISMATCH',
        message: `Group '${groupTitle}' header totals or balance flag do not match computed line amounts.`,
        groupTitle
      });
    }
  }

  // Rule 6: Unstated amount check
  if (options?.rawQuery && !options?.hasPriorContextAmount && !options?.hasImageEvidence) {
    const hasQueryMonetary = hasMonetaryEvidence(options.rawQuery);
    const hasEvidenceMonetary = (options.evidenceTexts || []).some(hasMonetaryEvidence);
    if (!hasQueryMonetary && !hasEvidenceMonetary) {
      const hasNonHypotheticalAmount = groups.some(
        g => !g.isHypothetical && (g.totalDebit > 0 || (g.lines && g.lines.some(l => l.debit > 0)))
      );
      if (hasNonHypotheticalAmount) {
        issues.push({
          code: 'UNSTATED_AMOUNT',
          message: 'The proposed journal uses a monetary amount that was not stated in the transaction description.'
        });
      }
    }
  }

  return {
    isValid: issues.length === 0,
    issues
  };
}
