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

const CURRENCY_PREFIXED_AMOUNT_REGEX = /\b(?:sgd|usd|eur|gbp|aud|myr|rmb|cny|jpy|hkd|s\$|us\$|\$)\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:k|m|bn|thousand|million|billion))?\b|\$\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:k|m|bn|thousand|million|billion))?/i;
const ABBREVIATED_AMOUNT_REGEX = /\b\d[\d,]*(?:\.\d+)?\s*(?:k|m|bn|thousand|million|billion|cents?)\b/i;
const SPELLED_CURRENCY_AMOUNT_REGEX = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)(?:[\s-]+(?:and|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion))*\s+(?:dollars?|cents?|sgd|usd|eur|gbp)\b/i;

function stripNonMonetaryTokens(text: string): string {
  return text
    // ISO and slash/dash dates: 2026-07-01, 01/08/2026, 01-08-2026
    .replace(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g, ' ')
    // Month-name dates: 15 May 2026, May 15, 2026, September 2026, 15th May
    .replace(/\b(?:\d{1,2}(?:st|nd|rd|th)?\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{1,2}(?:st|nd|rd|th)?,?)?(?:\s+\d{4})?\b/gi, ' ')
    // Reference / invoice / receipt / PO / GL / standard / section numbers
    .replace(/\b(?:sfrs\(i\)|frs|ias|ifrs)\s*\d+(?:-\d+)?(?:\s*(?:§|para(?:graph)?|p\.?)\s*\d+(?:\.\d+)*)?\b/gi, ' ')
    .replace(/§\s*\d+[a-z0-9()./-]*/gi, ' ')
    .replace(/(?<!['’])\b(?:section|sec\.?|s\.|regulation|reg\.?|schedule|sched\.?|article|art\.?|paragraph|para\.?)\s*\d+[a-z0-9()./-]*\b/gi, ' ')
    .replace(/(?:\b(?:inv(?:oice)?|receipt|rcpt|ref(?:erence)?|po|gl|acct|account|doc|voucher|cheque|check|order|no\.?)\s*[:#-]?\s*|#\s*)[a-z]*\d+[a-z0-9-]*\b/gi, ' ')
    .replace(/\b[a-z]{1,6}-\d[\d-]*\b/gi, ' ')
    // Percentages
    .replace(/\b\d+(?:\.\d+)?\s*%/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*percent\b/gi, ' ')
    // Ages and durations
    .replace(/\b(?:age\s*[:=]?\s*\d+|aged\s*[:=]?\s*\d+|\d+\s*-?\s*year(?:s)?[\s-]*old)\b/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*-?\s*(?:years?|yrs?|months?|mos?|weeks?|wks?|days?|hours?|hrs?)\b/gi, ' ')
    // Share/unit counts (e.g., "100 shares", "5k shares", "100 thousand shares", "300 apple shares")
    .replace(/\b\d[\d,]*(?:\.\d+)?(?:\s*(?:k|m|bn|thousand|million|billion))?\s+(?:[a-z]+\s+)?shares?\b/gi, ' ')
    // Standalone 4-digit years (1900-2099)
    .replace(/\b(?:19|20)\d{2}\b/g, ' ');
}

/**
 * Returns true when `text` contains genuine monetary evidence rather than only
 * dates, years, percentages, ages, durations, or reference/section numbers.
 */
export function hasMonetaryEvidence(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (
    CURRENCY_PREFIXED_AMOUNT_REGEX.test(trimmed) ||
    SPELLED_CURRENCY_AMOUNT_REGEX.test(trimmed)
  ) {
    return true;
  }

  const stripped = stripNonMonetaryTokens(trimmed);
  if (ABBREVIATED_AMOUNT_REGEX.test(stripped)) {
    return true;
  }
  return /\b\d[\d,]*(?:\.\d+)?\b/.test(stripped);
}

function hasPositiveNumericValue(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Returns true when verified image or extracted evidence supplies at least one
 * finite positive monetary figure.
 */
export function hasVerifiedNumericImageEvidence(imageEvidence?: unknown, extractedEvidence?: unknown): boolean {
  if (Array.isArray(imageEvidence)) {
    for (const item of imageEvidence) {
      if (!item || typeof item !== 'object') continue;
      const record = item as { fields?: unknown; journalLines?: unknown };
      if (Array.isArray(record.fields)) {
        for (const field of record.fields) {
          if (field && typeof field === 'object' && hasPositiveNumericValue((field as { value?: unknown }).value)) {
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
      const ev = item as { source?: unknown; value?: unknown };
      if (ev.source === 'image' && hasPositiveNumericValue(ev.value)) {
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
