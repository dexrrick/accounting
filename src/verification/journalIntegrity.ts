import type { AccountCategory, JournalEntryGroup } from '../types/accounting';

export interface JournalIntegrityIssue {
  code:
    | 'EMPTY_JOURNAL'
    | 'INVALID_LINE'
    | 'IMBALANCED_GROUP'
    | 'TOTAL_MISMATCH'
    | 'CATEGORY_MISMATCH'
    | 'DIRECTION_CONTRADICTION'
    | 'UNSTATED_AMOUNT'
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

  // Multi-word overrides and specific IFRS/SFRS(I) accounts
  if (n.startsWith('deferred tax liabilit')) {
    return 'LIABILITY';
  }
  if (n.startsWith('deferred tax asset')) {
    return 'ASSET';
  }
  if (n.startsWith('right-of-use asset')) {
    return 'ASSET';
  }
  if (
    n.startsWith('due to ') ||
    n.startsWith('amount due to ') ||
    n.startsWith('amounts due to ') ||
    n.includes('intercompany payable')
  ) {
    return 'LIABILITY';
  }
  if (
    n.startsWith('due from ') ||
    n.startsWith('amount due from ') ||
    n.startsWith('amounts due from ') ||
    n.includes('intercompany receivable')
  ) {
    return 'ASSET';
  }
  if (
    n.startsWith('loss allowance') ||
    n.startsWith('allowance for doubtful') ||
    n.startsWith('allowance for expected credit') ||
    n.startsWith('allowance for impairment') ||
    n.startsWith('accumulated impairment')
  ) {
    return 'ASSET';
  }
  if (
    n.includes('hire purchase') &&
    (n.includes('liabilit') || n.includes('payable') || n.includes('creditor'))
  ) {
    return 'LIABILITY';
  }

  // EXPENSE
  if (
    (n.endsWith(' expense') || n.endsWith(' expenses')) &&
    !n.startsWith('prepaid ') &&
    !n.startsWith('accrued ') &&
    !n.startsWith('provision for ') &&
    !n.startsWith('allowance for ') &&
    !n.includes('payable') &&
    !n.includes('liability')
  ) {
    return 'EXPENSE';
  }
  if (
    n === 'cost of goods sold' ||
    n === 'cost of sales' ||
    (n.includes('depreciation') && !n.includes('accumulated') && !n.includes('deferred tax') && !n.includes('payable') && !n.includes('liability'))
  ) {
    return 'EXPENSE';
  }
  if (
    n === 'discount allowed' ||
    n === 'expected credit loss' ||
    n === 'expected credit losses' ||
    n.startsWith('impairment loss')
  ) {
    return 'EXPENSE';
  }
  if (
    (n.includes('amortisation') || n.includes('amortization')) &&
    !n.includes('accumulated') &&
    !n.startsWith('unamorti') &&
    !n.includes('deferred tax') &&
    !n.includes('payable') &&
    !n.includes('liability')
  ) {
    return 'EXPENSE';
  }
  if (n.startsWith('employer cpf') && !n.includes('payable')) {
    return 'EXPENSE';
  }
  if (n.startsWith('income tax expense')) {
    return 'EXPENSE';
  }
  if (n === 'salaries and wages' || (n.startsWith('staff costs') && !n.includes('accrued') && !n.includes('payable'))) {
    return 'EXPENSE';
  }
  if (n.startsWith('loss on ') && !n.startsWith('loss allowance')) {
    return 'EXPENSE';
  }

  // ASSET
  if (n.startsWith('prepaid ') || n === 'prepayments' || n === 'prepayment') {
    return 'ASSET';
  }
  if (
    n.includes('accumulated depreciation') ||
    n.includes('accumulated amortisation') ||
    n.includes('accumulated amortization')
  ) {
    return 'ASSET';
  }
  const assetNames = [
    'trade receivables', 'trade receivable', 'accounts receivable', 'account receivable',
    'other receivables', 'other receivable', 'input gst receivable', 'input gst receivables',
    'refundable deposits', 'refundable deposit', 'security deposit', 'security deposits',
    'rental deposit', 'rental deposits', 'cash', 'cash on hand', 'petty cash',
    'cash at bank', 'current account', 'savings account', 'checking account',
    'cheque account', 'operating account', 'business account', 'inventory',
    'merchandise inventory',
    'current tax asset', 'current tax assets', 'income tax recoverable', 'tax recoverable'
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
    (n.startsWith('provision for ') && !n.includes('doubtful') && !n.includes('bad debt')) ||
    n.startsWith('cpf payable') ||
    n.includes('salaries payable') ||
    n.includes('wages payable') ||
    n === 'sdl payable' ||
    n === 'skills development levy payable' ||
    n === 'current tax payable' ||
    n === 'income tax payable' ||
    n === 'corporate tax payable'
  ) {
    return 'LIABILITY';
  }

  // EQUITY
  if (!n.includes('unpaid') && !n.includes('receivable') && !n.includes('due from')) {
    const equityNames = [
      'share capital', 'ordinary share capital', "owner's capital", "owner's drawings",
      'drawings', 'retained earnings', 'capital reserve', 'convertible debt equity reserve',
      'treasury shares', 'share buyback reserve'
    ];
    if (equityNames.includes(n) || n === 'treasury shares' || n === 'share buyback reserve') {
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
  if (n.startsWith('gain on ')) {
    return 'REVENUE';
  }

  // OTHER COMPREHENSIVE INCOME
  if (n.startsWith('oci —') || n.startsWith('oci -') || n.startsWith('oci ') || n.endsWith('(oci)')) {
    return 'OTHER_COMPREHENSIVE_INCOME';
  }

  return undefined;
}

export interface ValidateJournalGroupsOptions {
  rawQuery?: string;
  hasPriorContextAmount?: boolean;
  enforceAmountProvenance?: boolean;
  priorContextTexts?: string[];
  priorContextAmounts?: number[];
  isFollowUp?: boolean;
}

export function stripNonMonetaryTokens(text: string): string {
  if (!text) return '';
  return text
    // Standard/act references
    .replace(/\b(?:SFRS\(I\)|IFRS|IAS)\s*\d+(?:\s*[-–]\s*\d+)?(?:\s*§?\s*\d+[A-Za-z0-9().-]*)?/gi, ' ')
    .replace(/\b(?:Section|Sec|Part|Schedule|Para(?:graph)?)\s+[IVX0-9A-Za-z().-]+/gi, ' ')
    .replace(/§\s*\d+[A-Za-z0-9().-]*/g, ' ')
    // Calendar dates & periods
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\s+\d{2,4})?\b/gi, ' ')
    .replace(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?\b/gi, ' ')
    .replace(/\b(?:FY|YA|CY)\s*20\d{2}\b/gi, ' ')
    .replace(/\bQ[1-4]\s*20\d{2}\b/gi, ' ')
    .replace(/\b(?:in|for|year)\s+20\d{2}\b/gi, ' ')
    // GL codes
    .replace(/\b(?:GL|code|account)\s*#?\s*\d{3,5}\b/gi, ' ');
}

export function extractDerivableNumbers(
  rawQuery: string,
  priorContextTexts: string[] = [],
  priorContextAmounts: number[] = []
): { baseNumbers: number[]; statedPercentages: number[]; allCombinedText: string } {
  const strippedQuery = stripNonMonetaryTokens(rawQuery || '');
  const strippedPrior = priorContextTexts.map(t => stripNonMonetaryTokens(t || ''));
  const allTexts = [strippedQuery, ...strippedPrior];
  const allCombinedText = allTexts.join(' ');

  const numbers: number[] = [...priorContextAmounts];

  for (const text of allTexts) {
    if (/\b50\s*cents?\b|\bhalf\s+a\s+dollar\b/i.test(text)) numbers.push(0.5);
    if (/\b(?:one|a)\s+dollar\b/i.test(text)) numbers.push(1);
    if (/\btwo\s+dollars\b/i.test(text)) numbers.push(2);

    // cents: (\d+(?:\.\d+)?)\s*cents?
    const centsMatches = text.matchAll(/\b(\d+(?:\.\d+)?)\s*cents?\b/gi);
    for (const m of centsMatches) {
      const val = parseFloat(m[1]);
      if (Number.isFinite(val) && val > 0) numbers.push(val / 100);
    }

    // k / thousand
    const kMatches = text.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:k|thousand)\b/gi);
    for (const m of kMatches) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (Number.isFinite(val) && val > 0) numbers.push(val * 1000);
    }

    // m / million
    const mMatches = text.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:m|million)\b/gi);
    for (const m of mMatches) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (Number.isFinite(val) && val > 0) numbers.push(val * 1000000);
    }

    // general monetary & numeric values
    const numMatches = text.matchAll(/(?:\b|\$|SGD|S\$|\bS\$)(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\b/gi);
    for (const m of numMatches) {
      const cleanStr = m[1].replace(/,/g, '');
      const val = parseFloat(cleanStr);
      if (Number.isFinite(val) && val > 0) {
        numbers.push(val);
      }
    }
  }

  // Raw integers from strippedQuery (1..365)
  const intMatches = strippedQuery.matchAll(/\b([1-9]\d{0,2})\b/g);
  for (const m of intMatches) {
    const val = parseInt(m[1], 10);
    if (val >= 1 && val <= 365) {
      numbers.push(val);
    }
  }

  // Stated percentages
  const percentages = new Set<number>();
  const pctMatches = allCombinedText.matchAll(/\b(\d+(?:\.\d+)?)\s*%/g);
  for (const m of pctMatches) {
    const val = parseFloat(m[1]);
    if (Number.isFinite(val) && val > 0) percentages.add(val);
  }
  if (/\bgst\b/i.test(allCombinedText)) {
    percentages.add(9);
  }
  if (/\b2023\b/.test(allCombinedText)) {
    percentages.add(8);
  }

  return {
    baseNumbers: Array.from(new Set(numbers.filter(n => Number.isFinite(n) && n > 0))),
    statedPercentages: Array.from(percentages),
    allCombinedText
  };
}

export function buildDerivableCents(
  baseNumbers: number[],
  percentages: number[],
  priorAmounts: number[] = []
): Set<number> {
  const derivedCents = new Set<number>();

  function addCents(val: number) {
    if (Number.isFinite(val) && val > 0) {
      const c = Math.round(val * 100);
      if (Number.isSafeInteger(c) && c > 0) {
        derivedCents.add(c);
      }
    }
  }

  // 1) Base values in dollars -> cents & prior context amounts
  for (const v of baseNumbers) addCents(v);
  for (const a of priorAmounts) addCents(a);

  // 2) Percentage / tax / discount derivations
  for (const b of baseNumbers) {
    for (const p of percentages) {
      addCents(b * (p / 100));
      addCents(b * (1 + p / 100));
      addCents(b * (1 - p / 100));
      addCents(b * 100 / (100 + p));
      addCents(b * p / (100 + p));
    }
  }

  // 3) Products & quotients of pairs (a, b) and straight-line depreciation
  const baseLen = baseNumbers.length;
  for (let i = 0; i < baseLen; i++) {
    const a = baseNumbers[i];
    for (let j = 0; j < baseLen; j++) {
      if (i === j) continue;
      const b = baseNumbers[j];
      if (Math.min(a, b) <= 1000) {
        addCents(a * b);
      }
      if (b > 0) {
        addCents(a / b);
      }
      // Straight-line: (a - b) / c
      if (a > b) {
        for (let k = 0; k < baseLen; k++) {
          const c = baseNumbers[k];
          if (c > 0 && c <= 100) {
            addCents((a - b) / c);
          }
        }
      }
    }
  }

  // Multi-term priority combinations from core numbers before time-fraction expansion
  const coreCents = Array.from(derivedCents).slice(0, 24);
  const coreLen = coreCents.length;
  for (let i = 0; i < coreLen; i++) {
    const ci = coreCents[i];
    for (let j = 0; j <= i; j++) {
      const cj = coreCents[j];
      const sum2 = ci + cj;
      const diff2 = Math.abs(ci - cj);
      if (sum2 > 0) derivedCents.add(sum2);
      if (diff2 > 0) derivedCents.add(diff2);

      for (let k = 0; k <= j; k++) {
        const ck = coreCents[k];
        const sum3 = ci + cj + ck;
        const diff3a = Math.abs(ci + cj - ck);
        const diff3b = Math.abs(ci - cj - ck);
        if (sum3 > 0) derivedCents.add(sum3);
        if (diff3a > 0) derivedCents.add(diff3a);
        if (diff3b > 0) derivedCents.add(diff3b);
      }
    }
  }

  const quadSlice = coreCents.slice(0, 12);
  const quadLen = quadSlice.length;
  for (let i = 0; i < quadLen; i++) {
    const a = quadSlice[i];
    for (let j = 0; j <= i; j++) {
      const b = quadSlice[j];
      for (let k = 0; k <= j; k++) {
        const c = quadSlice[k];
        for (let l = 0; l <= k; l++) {
          const d = quadSlice[l];
          const sum4 = a + b + c + d;
          const diff4a = Math.abs(a + b + c - d);
          const diff4b = Math.abs(a + b - c - d);
          if (sum4 > 0) derivedCents.add(sum4);
          if (diff4a > 0) derivedCents.add(diff4a);
          if (diff4b > 0) derivedCents.add(diff4b);
        }
      }
    }
  }

  // Common accounting time fractions on all derived cents so far:
  const statedMonths = baseNumbers.filter(n => Number.isInteger(n) && n >= 1 && n <= 60);
  const statedDays = baseNumbers.filter(n => Number.isInteger(n) && n >= 1 && n <= 365);
  const initialCents = Array.from(derivedCents).slice(0, 120);

  for (const c of initialCents) {
    const dollars = c / 100;
    addCents(dollars / 12);
    addCents(dollars / 4);
    addCents(dollars / 2);
    for (const m of statedMonths) {
      addCents(dollars * m / 12);
    }
    for (const d of statedDays) {
      addCents(dollars * d / 365);
      addCents(dollars * d / 360);
    }
  }

  // 4) Multi-step sums and absolute differences (up to 2 closure passes, capped at 4000)
  for (let pass = 0; pass < 2; pass++) {
    const current = Array.from(derivedCents);
    const len = current.length;
    for (let i = 0; i < len; i++) {
      const ci = current[i];
      for (let j = 0; j <= i; j++) {
        const cj = current[j];
        const sum = ci + cj;
        const diff = Math.abs(ci - cj);
        if (sum > 0) derivedCents.add(sum);
        if (diff > 0) derivedCents.add(diff);
        if (derivedCents.size >= 4000) break;
      }
      if (derivedCents.size >= 4000) break;
    }
    if (derivedCents.size >= 4000) break;
  }

  return derivedCents;
}

/**
 * Deterministically validates journal entry groups against exact double-entry,
 * integer-cent precision, account classification, unstated amounts, and settlement invariants.
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

    // Duplicate Recognition Check:
    // If a group's title/summary explicitly describes settling/paying an existing liability
    // and credits Cash/Bank while debiting an EXPENSE account (without debiting any LIABILITY account, and not an interest/bank-fee line),
    // emit DUPLICATE_RECOGNITION.
    const groupContext = `${groupTitle} ${group.summary || ''}`;
    const creditsNewLiability = group.lines.some(l => l.credit > 0 && l.category === 'LIABILITY');
    const describesCurrentRecognition = /\b(?:recognition|recognis\w*|recogniz\w*|accrual\s+of|incurred)\b/i.test(groupContext);
    const isSettlingExistingLiability =
      !creditsNewLiability &&
      !describesCurrentRecognition &&
      /\b(?:settle(?:ment|d)?\s+of|settle(?:ment|d)?\s+(?:accrued|outstanding|payable|prior)|pay(?:ment|ing)?\s+of\s+(?:outstanding|accrued|payable)|clear(?:ing|ed)?\s+(?:payable|liability))\b/i.test(groupContext);
    if (isSettlingExistingLiability) {
      const creditsCashOrBank = group.lines.some(l => l.credit > 0 && /\b(?:cash|bank|current account)\b/i.test(l.accountName));
      const debitsLiability = group.lines.some(l => l.debit > 0 && l.category === 'LIABILITY');
      if (creditsCashOrBank && !debitsLiability) {
        for (const line of group.lines) {
          if (line.debit > 0 && line.category === 'EXPENSE') {
            const isInterestOrFee = /\b(?:interest|bank\s*charge|bank\s*fee|finance\s*charge)\b/i.test(line.accountName);
            if (!isInterestOrFee) {
              issues.push({
                code: 'DUPLICATE_RECOGNITION',
                message: `Group '${groupTitle}' describes settling an existing liability but debits expense account '${line.accountName}' instead of clearing the liability.`,
                groupTitle,
                accountName: line.accountName
              });
            }
          }
        }
      }
    }

    // Unconfirmed Settlement Check:
    // If !options?.isFollowUp and options?.rawQuery starts with a bare nominal settlement phrase
    // and lacks any finite completion verb, and any group credits Cash/Bank while debiting a Liability, emit UNCONFIRMED_SETTLEMENT.
    if (!options?.isFollowUp && options?.rawQuery) {
      const isBareNominalSettlement = /^\s*(?:settlement|payment|clearing|discharge)\s+of\b/i.test(options.rawQuery);
      const hasFiniteCompletion =
        /\b(?:was|were|has\s+been|have\s+been|had\s+been|is\s+now|are\s+now)\s+(?:paid|settled|transferred|remitted|cleared|completed|made)\b/i.test(options.rawQuery) ||
        /\b(?:we|company|entity|employer)\s+(?:paid|settled|transferred|remitted|cleared)\b/i.test(options.rawQuery) ||
        /\b(?:paid|settled|transferred|remitted|cleared)\s+(?:on\s+\d|yesterday|today|this\s+morning|in\s+full)\b/i.test(options.rawQuery);

      if (isBareNominalSettlement && !hasFiniteCompletion) {
        const creditsCashOrBank = group.lines.some(l => l.credit > 0 && /\b(?:cash|bank|current account)\b/i.test(l.accountName));
        const debitsLiability = group.lines.some(l => l.debit > 0 && l.category === 'LIABILITY');
        if (creditsCashOrBank && debitsLiability) {
          issues.push({
            code: 'UNCONFIRMED_SETTLEMENT',
            message: `Group '${groupTitle}' records a settlement of a liability based on a bare nominal phrase without confirmation that payment was completed. Clarification is required.`,
            groupTitle
          });
        }
      }
    }
  }

  // Rule 6: Calendar/Citation-Safe Unstated amount check
  if (options?.rawQuery && !options?.hasPriorContextAmount) {
    const strippedQuery = stripNonMonetaryTokens(options.rawQuery);
    const hasDigit = /\d/.test(strippedQuery);
    const hasNumberWord = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand|million)\b/i.test(strippedQuery);
    if (!hasDigit && !hasNumberWord) {
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

  // Fact-Amount Provenance Check (enforceAmountProvenance)
  if (options?.enforceAmountProvenance) {
    const { baseNumbers, statedPercentages } = extractDerivableNumbers(
      options.rawQuery || '',
      options.priorContextTexts,
      options.priorContextAmounts
    );

    if (baseNumbers.length === 0) {
      const hasNonHypotheticalAmount = groups.some(
        g => !g.isHypothetical && (g.totalDebit > 0 || (g.lines && g.lines.some(l => l.debit > 0)))
      );
      if (hasNonHypotheticalAmount) {
        issues.push({
          code: 'UNSTATED_AMOUNT',
          message: 'The proposed journal uses monetary amounts, but no monetary or numeric values were stated in the user transaction or prior context.'
        });
      }
    } else {
      const derivedCents = buildDerivableCents(baseNumbers, statedPercentages, options.priorContextAmounts);

      for (const group of groups) {
        if (group.isHypothetical) continue;
        const groupTitle = group.title || 'Untitled Group';
        for (const line of group.lines || []) {
          const debitCents = Math.round((line.debit || 0) * 100);
          const creditCents = Math.round((line.credit || 0) * 100);
          const amountCents = debitCents > 0 ? debitCents : creditCents;
          if (amountCents <= 0) continue;

          // Check if candidate is in derivedCents (+/- 2 cents tolerance)
          const isSupported =
            derivedCents.has(amountCents) ||
            derivedCents.has(amountCents - 1) ||
            derivedCents.has(amountCents + 1) ||
            derivedCents.has(amountCents - 2) ||
            derivedCents.has(amountCents + 2);

          if (!isSupported) {
            issues.push({
              code: 'UNSTATED_AMOUNT',
              message: `Line '${line.accountName}' in group '${groupTitle}' uses an unstated amount S$${(amountCents / 100).toFixed(2)} that cannot be derived from stated transaction facts.`,
              groupTitle,
              accountName: line.accountName
            });
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
