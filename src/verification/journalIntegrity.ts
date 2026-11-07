import type { AccountCategory, JournalEntryGroup } from '../types/accounting';

export interface JournalIntegrityIssue {
  code:
    | 'EMPTY_GROUPS'
    | 'EMPTY_JOURNAL'
    | 'INVALID_LINE_COUNT'
    | 'INVALID_LINE'
    | 'EMPTY_ACCOUNT_NAME'
    | 'INVALID_CATEGORY'
    | 'INVALID_LINE'
    | 'INVALID_TRANSACTION_STATUS'
    | 'CATEGORY_MISMATCH'
    | 'INVALID_MONETARY_AMOUNT'
    | 'ZERO_OR_DUAL_SIDED_LINE'
    | 'IMBALANCED_GROUP'
    | 'HEADER_TOTAL_MISMATCH'
    | 'TOTAL_MISMATCH'
    | 'DIRECTION_CONTRADICTION'
    | 'UNSTATED_AMOUNT'
    | 'SETTLEMENT_EXCEEDS_BALANCE'
    | 'DUPLICATE_RECOGNITION'
    | 'UNCONFIRMED_SETTLEMENT';
  message: string;
  groupTitle?: string;
  accountName?: string;
}

export interface JournalIntegrityResult {
  isValid: boolean;
  issues: JournalIntegrityIssue[];
}

export interface OutstandingBalanceContext {
  accountName: string;
  nature: 'RECEIVABLE' | 'PAYABLE' | 'DEPOSIT';
  remainingAmount: number;
}

export interface JournalValidationOptions {
  rawQuery?: string;
  hasPriorContextAmount?: boolean;
  enforceAmountProvenance?: boolean;
  priorContextTexts?: string[];
  priorContextAmounts?: number[];
  isFollowUp?: boolean;
  outstandingBalances?: OutstandingBalanceContext[];
}

export type ValidateJournalGroupsOptions = JournalValidationOptions;

export const VALID_CATEGORIES = new Set<AccountCategory>([
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'EXPENSE',
  'OTHER_COMPREHENSIVE_INCOME'
]);

/**
 * Converts a dollar amount to integer cents, or returns null if invalid/non-finite or has fractional sub-cents.
 */
export function toExactCents(value: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || isNaN(value)) {
    return null;
  }
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents)) {
    return null;
  }
  if (Math.abs(value * 100 - cents) > 1e-4) {
    return null;
  }
  return cents;
}

/**
 * Lightweight helper for inferring canonical categories for unambiguous core accounts.
 */
export function inferAccountCategoryFromName(accountName: string): AccountCategory | undefined {
  if (!accountName || typeof accountName !== 'string') return undefined;
  const n = accountName.trim().toLowerCase();

  // Ambiguous hybrid or bare loan/deposit terms fail closed
  if (
    n.includes('clearing') ||
    n.includes('suspense') ||
    n === 'director loan' ||
    n === 'staff loan' ||
    n === 'shareholder loan' ||
    n === 'deposit' ||
    n === 'deposits'
  ) {
    return undefined;
  }

  // Core liabilities
  if (
    n.includes('customer deposit') ||
    n.includes('tenant deposit') ||
    n.includes('advances from customer') ||
    n.includes('loan from director') ||
    n.includes('loan from shareholder') ||
    n.includes('director loan payable') ||
    n.includes('trade payable') ||
    n.includes('accounts payable') ||
    n.includes('deferred tax liabilit') ||
    n.startsWith('due to ') ||
    n.includes('lease liabilit') ||
    n.includes('salaries payable') ||
    n.includes('cpf payable') ||
    n.includes('gst payable')
  ) {
    return 'LIABILITY';
  }

  // Core assets
  if (
    n.startsWith('prepaid ') ||
    n.startsWith('prepayment') ||
    n.includes('deferred tax asset') ||
    n.includes('right-of-use') ||
    n.includes('security deposit') ||
    n.includes('rental deposit') ||
    n.includes('loan to director') ||
    n.includes('loan to staff') ||
    (n.includes('receivable') && !n.includes('payable')) ||
    n.startsWith('due from ') ||
    n.includes('cash') ||
    n.includes('bank') ||
    n.includes('inventory') ||
    n.includes('equipment') ||
    n.includes('accumulated depreciation')
  ) {
    return 'ASSET';
  }

  // Core equity
  if (
    n.includes('share capital') ||
    n.includes('retained earnings') ||
    n.includes('dividends declared')
  ) {
    return 'EQUITY';
  }

  // Core revenue
  if (
    n.includes('revenue') ||
    n.includes('sales') ||
    n.includes('discount received') ||
    n.includes('gain on')
  ) {
    return 'REVENUE';
  }

  // Core expense
  if (
    n.endsWith(' expense') ||
    n.endsWith(' expenses') ||
    n === 'cost of goods sold' ||
    n === 'cost of sales' ||
    n.includes('depreciation expense') ||
    n.includes('loss on')
  ) {
    return 'EXPENSE';
  }

  return undefined;
}

export function getMandatoryCategory(accountName: string): AccountCategory | undefined {
  return inferAccountCategoryFromName(accountName);
}

// Deprecated stubs retained for backward compatibility with older test harnesses
export function extractDerivableNumbers(
  _query: string,
  _priorTexts?: string[],
  _priorAmounts?: number[]
): { monetaryOccurrences: number[]; timeOrQuantityFactors: number[] } {
  return { monetaryOccurrences: [], timeOrQuantityFactors: [] };
}

export function buildDerivableCents(
  _extracted?: unknown,
  _priorTexts?: string[],
  _priorAmounts?: number[]
): Set<number> {
  return new Set<number>();
}

export function stripNonMonetaryTokens(text: string): string {
  return text;
}

/**
 * Validates journal entry groups against structural and mathematical double-entry invariants.
 */
export function validateJournalGroups(
  groups: JournalEntryGroup[],
  options?: JournalValidationOptions
): JournalIntegrityResult {
  const issues: JournalIntegrityIssue[] = [];

  // 1. Verify Array.isArray(groups) && groups.length > 0 (EMPTY_GROUPS / EMPTY_JOURNAL)
  if (!Array.isArray(groups) || groups.length === 0) {
    return {
      isValid: false,
      issues: [{
        code: 'EMPTY_GROUPS',
        message: 'The journal entry contains no groups.'
      }]
    };
  }

  // 2. Track group IDs across groups: check for duplicate non-empty group.id
  const seenGroupIds = new Set<string>();
  for (const group of groups) {
    if (group.id) {
      if (seenGroupIds.has(group.id)) {
        issues.push({
          code: 'INVALID_LINE_COUNT',
          message: `Duplicate group id '${group.id}' in the same journal groups array.`,
          groupTitle: group.title
        });
      } else {
        seenGroupIds.add(group.id);
      }
    }
  }

  // 7. For UNSTATED_AMOUNT: ONLY check if options?.rawQuery is provided and non-empty,
  // enforceAmountProvenance !== false, and the query + prior context texts/amounts contain zero numbers at all.
  const rawQuery = (options?.rawQuery ?? '').trim();
  if (rawQuery.length > 0 && options?.enforceAmountProvenance !== false) {
    const combinedText = [rawQuery, ...(options?.priorContextTexts ?? [])].join(' ');
    const hasAnyStatedNumber =
      /\d/.test(combinedText) ||
      (options?.priorContextAmounts && options.priorContextAmounts.length > 0) ||
      (options?.outstandingBalances && options.outstandingBalances.length > 0);
    if (!hasAnyStatedNumber) {
      for (const group of groups) {
        for (const line of group.lines || []) {
          if ((line.debit && line.debit > 0) || (line.credit && line.credit > 0)) {
            issues.push({
              code: 'UNSTATED_AMOUNT',
              message: `Query contains no stated monetary amounts, but AI proposed an amount for '${line.accountName}'.`,
              groupTitle: group.title,
              accountName: line.accountName
            });
            break;
          }
        }
      }
    }
  }

  for (const group of groups) {
    const groupTitle = group.title || 'Untitled Group';

    // 3. Verify Array.isArray(group.lines) && group.lines.length >= 2 (INVALID_LINE_COUNT)
    if (!Array.isArray(group.lines) || group.lines.length < 2) {
      issues.push({
        code: 'INVALID_LINE_COUNT',
        message: `Group '${groupTitle}' must contain at least 2 journal lines.`,
        groupTitle
      });
      continue;
    }

    // 4. Validate transactionStatus and journalAction if present
    if (group.transactionStatus && !['actual', 'hypothetical', 'planned', 'conditional'].includes(group.transactionStatus)) {
      issues.push({
        code: 'INVALID_TRANSACTION_STATUS',
        message: `Group '${groupTitle}' has invalid transactionStatus: '${group.transactionStatus}'.`,
        groupTitle
      });
      issues.push({
        code: 'INVALID_LINE',
        message: `Group '${groupTitle}' has invalid transactionStatus: '${group.transactionStatus}'.`,
        groupTitle
      });
    }
    if (group.journalAction && !['new', 'revised', 'restatement', 'illustrative'].includes(group.journalAction)) {
      issues.push({
        code: 'INVALID_LINE',
        message: `Group '${groupTitle}' has invalid journalAction: '${group.journalAction}'.`,
        groupTitle
      });
    }

    let totalDebitCents = 0;
    let totalCreditCents = 0;
    let groupLinesValid = true;

    // 5. Line-level validations
    for (const line of group.lines) {
      const lineAccountName = typeof line.accountName === 'string' ? line.accountName.trim() : '';

      // Verify line.accountName is a non-empty string (EMPTY_ACCOUNT_NAME)
      if (!lineAccountName) {
        issues.push({
          code: 'EMPTY_ACCOUNT_NAME',
          message: `A journal line in group '${groupTitle}' is missing an account name.`,
          groupTitle
        });
        groupLinesValid = false;
        continue;
      }

      // Verify VALID_CATEGORIES.has(line.category) (INVALID_CATEGORY / INVALID_LINE)
      if (!line.category || !VALID_CATEGORIES.has(line.category)) {
        issues.push({
          code: 'INVALID_CATEGORY',
          message: `Line '${lineAccountName}' in group '${groupTitle}' has an invalid account category '${line.category}'.`,
          groupTitle,
          accountName: lineAccountName
        });
        issues.push({
          code: 'INVALID_LINE',
          message: `Line '${lineAccountName}' in group '${groupTitle}' has an invalid account category '${line.category}'.`,
          groupTitle,
          accountName: lineAccountName
        });
        groupLinesValid = false;
        continue;
      }

      // Obvious core contradictions: Prepaid ... marked EXPENSE, or Trade Payables / Accounts Payable marked ASSET (CATEGORY_MISMATCH)
      const lowerName = lineAccountName.toLowerCase();
      if ((lowerName.startsWith('prepaid ') || lowerName === 'prepaid rent') && line.category === 'EXPENSE') {
        issues.push({
          code: 'CATEGORY_MISMATCH',
          message: `Account '${lineAccountName}' is an asset (prepayment), but was categorized as EXPENSE.`,
          groupTitle,
          accountName: lineAccountName
        });
      } else if ((lowerName.includes('trade payable') || lowerName.includes('accounts payable')) && line.category === 'ASSET') {
        issues.push({
          code: 'CATEGORY_MISMATCH',
          message: `Account '${lineAccountName}' is a liability, but was categorized as ASSET.`,
          groupTitle,
          accountName: lineAccountName
        });
      } else if (lowerName.includes('receivable') && !lowerName.includes('payable') && line.category === 'LIABILITY') {
        issues.push({
          code: 'CATEGORY_MISMATCH',
          message: `Account '${lineAccountName}' is an asset (receivable), but was categorized as LIABILITY.`,
          groupTitle,
          accountName: lineAccountName
        });
      }

      // Verify toExactCents(line.debit) and toExactCents(line.credit) are non-null and >= 0 (INVALID_MONETARY_AMOUNT)
      const debitCents = toExactCents(line.debit);
      const creditCents = toExactCents(line.credit);

      if (debitCents === null || debitCents < 0 || creditCents === null || creditCents < 0) {
        issues.push({
          code: 'INVALID_MONETARY_AMOUNT',
          message: `Line '${lineAccountName}' in group '${groupTitle}' has invalid or non-finite monetary amounts.`,
          groupTitle,
          accountName: lineAccountName
        });
        groupLinesValid = false;
        continue;
      }

      // Verify single-sided non-zero per line: (debitCents > 0) !== (creditCents > 0) (ZERO_OR_DUAL_SIDED_LINE)
      if ((debitCents > 0) === (creditCents > 0)) {
        issues.push({
          code: 'ZERO_OR_DUAL_SIDED_LINE',
          message: `Line '${lineAccountName}' in group '${groupTitle}' must have a single-sided non-zero amount.`,
          groupTitle,
          accountName: lineAccountName
        });
        groupLinesValid = false;
        continue;
      }

      totalDebitCents += debitCents;
      totalCreditCents += creditCents;
    }

    if (!groupLinesValid) {
      continue;
    }

    // 6. Verify group totals:
    // totalDebitCents === totalCreditCents && totalDebitCents > 0 (IMBALANCED_GROUP)
    if (totalDebitCents <= 0 || totalCreditCents <= 0 || totalDebitCents !== totalCreditCents) {
      issues.push({
        code: 'IMBALANCED_GROUP',
        message: `Group '${groupTitle}' is imbalanced: Total Dr (${(totalDebitCents / 100).toFixed(2)}) != Total Cr (${(totalCreditCents / 100).toFixed(2)}).`,
        groupTitle
      });
    }

    // Header totals and isBalanced flag match computed amounts (HEADER_TOTAL_MISMATCH)
    const headerDrCents = toExactCents(group.totalDebit ?? 0);
    const headerCrCents = toExactCents(group.totalCredit ?? 0);
    if (
      headerDrCents !== totalDebitCents ||
      headerCrCents !== totalCreditCents ||
      group.isBalanced !== true
    ) {
      issues.push({
        code: 'HEADER_TOTAL_MISMATCH',
        message: `Group '${groupTitle}' header totals or balance flag do not match computed line amounts.`,
        groupTitle
      });
    }

    // SETTLEMENT_EXCEEDS_BALANCE check when options?.outstandingBalances is non-empty and group is not hypothetical/conditional/illustrative
    const isHypotheticalGroup = Boolean(
      group.isHypothetical ||
      group.transactionStatus === 'hypothetical' ||
      group.transactionStatus === 'conditional' ||
      group.transactionStatus === 'planned' ||
      group.journalAction === 'illustrative'
    );
    if (!isHypotheticalGroup && options?.outstandingBalances && options.outstandingBalances.length > 0) {
      const creditsCash = group.lines.some(l => l.credit > 0 && /\b(?:cash|bank|current\s*account|cheque|check|giro|paynow)\b/i.test(l.accountName));
      if (creditsCash) {
        for (const line of group.lines) {
          if (line.debit > 0 && (line.category === 'LIABILITY' || /\b(?:payable|payables|accrued|liability|liabilities)\b/i.test(line.accountName))) {
            const lineNameLower = line.accountName.toLowerCase();
            const payableBalances = options.outstandingBalances.filter(b => b.nature === 'PAYABLE');
            const matched = payableBalances.find(b =>
              b.accountName.toLowerCase() === lineNameLower ||
              b.accountName.toLowerCase().includes(lineNameLower) ||
              lineNameLower.includes(b.accountName.toLowerCase())
            );
            const remaining = matched
              ? matched.remainingAmount
              : payableBalances.reduce((sum, b) => sum + (b.remainingAmount || 0), 0);
            if (remaining > 0 && line.debit > remaining + 0.01) {
              issues.push({
                code: 'SETTLEMENT_EXCEEDS_BALANCE',
                message: `Settlement amount S$${line.debit.toFixed(2)} for '${line.accountName}' exceeds the outstanding balance of S$${remaining.toFixed(2)}.`,
                groupTitle,
                accountName: line.accountName
              });
            }
          }
        }
      }
    }
  }

  return {
    isValid: issues.length === 0,
    issues
  };
}
