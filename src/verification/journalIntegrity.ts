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
export function getMandatoryCategory(accountName: string): AccountCategory | undefined {
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
  if (
    /\b(?:receivables?|recoverables?|due\s+from|contract\s+assets?|prepaid|prepayments?|right-of-use\s+assets?|rou\s+assets?|deferred\s+tax\s+assets?)\b/i.test(n) &&
    !n.includes('payable') &&
    !n.includes('liability') &&
    !n.includes('liabilities') &&
    !n.includes('deferred revenue') &&
    !n.includes('unearned')
  ) {
    return 'ASSET';
  }
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
    /\b(?:customer\s+deposits?|tenant\s+deposits?|deposits?\s+(?:received|from\s+customers?|from\s+tenants?)|advances?\s+from\s+customers?|unearned\s+deposits?)\b/i.test(n)
  ) {
    return 'LIABILITY';
  }
  if (
    (liabilityNames.includes(n) ||
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
    n === 'corporate tax payable') &&
    !/\b(?:receivables?|recoverables?|due\s+from|prepaid|asset|assets)\b/i.test(n)
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

/**
 * Infers the canonical AccountCategory from an account name using mandatory dictionary rules
 * and standard accounting taxonomy regex patterns. Returns undefined if the account name cannot
 * be unambiguously resolved.
 */
export function inferAccountCategoryFromName(accountName: string): AccountCategory | undefined {
  if (!accountName || typeof accountName !== 'string') return undefined;
  const direct = getMandatoryCategory(accountName);
  if (direct) return direct;

  const n = accountName.trim().toLowerCase();

  // Next, check for conflicting/ambiguous category signals before applying regex heuristics
  const hasAssetRelationship = /\b(?:receivables?|recoverables?|due\s+from|prepaid|prepayments?|contract\s+assets?|deferred\s+tax\s+assets?|right-of-use|rou\s+assets?|cash|bank|petty\s+cash|current\s+account|savings\s+account|inventory|inventories|equipment|machinery|motor\s+vehicles?|delivery\s+van|furniture|fixtures|buildings?|land|intangible|software|patent|goodwill|investment|financial\s+assets?|input\s+gst|accumulated\s+depreciation|accumulated\s+amorti[sz]ation|loss\s+allowance|allowance\s+for\s+(?:doubtful|impairment|expected\s+credit)|refundable\s+deposits?|security\s+deposits?|rental\s+deposits?|utility\s+deposits?|deposits?\s+paid|fixed\s+deposits?|bank\s+deposits?|time\s+deposits?|call\s+deposits?)\b/i.test(n);
  const hasExplicitLiabilityRelationship = /\b(?:payables?|liabilit(?:y|ies)|accrued|unearned|deferred\s+revenue|deferred\s+income|deferred\s+tax\s+liabilit\w*|provisions?|due\s+to|creditors?|output\s+gst|overdraft|customer\s+deposits?|tenant\s+deposits?|deposits?\s+(?:received|from\s+customers?|from\s+tenants?)|advances?\s+from\s+customers?|unearned\s+deposits?)\b/i.test(n);

  if (hasAssetRelationship && hasExplicitLiabilityRelationship) {
    return undefined;
  }

  // Check specific Asset relationships BEFORE generic liability keywords
  if (
    /\b(?:receivables?|recoverables?|due\s+from|prepaid|prepayments?|contract\s+assets?|deferred\s+tax\s+assets?|loan\s+receivables?|loans\s+receivables?|notes?\s+receivables?|advances?\s+to|deposits?\s+paid|security\s+deposits?|rental\s+deposits?|refundable\s+deposits?|utility\s+deposits?|fixed\s+deposits?|bank\s+deposits?|time\s+deposits?|call\s+deposits?|loans?\s+to\s+(?:staff|directors?|employees?|shareholders?|subsidiary|related\s+part\w*))\b/i.test(n) &&
    !n.includes('payable') &&
    !n.includes('liability') &&
    !n.includes('liabilities') &&
    !n.includes('due to') &&
    !n.includes('from')
  ) {
    return 'ASSET';
  }

  // Liability patterns
  if (
    /\b(?:customer\s+deposits?|tenant\s+deposits?|deposits?\s+(?:received|from\s+customers?|from\s+tenants?)|advances?\s+from\s+customers?|unearned\s+deposits?|loans?\s+from\s+(?:directors?|shareholders?|staff|employees?|bank|parent|related\s+part\w*))\b/i.test(n) ||
    /\b(?:payables?|liabilit(?:y|ies)|accrued|unearned|deferred\s+revenue|deferred\s+income|deferred\s+tax\s+liabilit\w*|provisions?|hire\s+purchase\s+(?:liabilit\w*|creditor\w*)|lease\s+liabilit\w*|due\s+to|creditors?|output\s+gst|gst\s+payable|tax\s+payable|cpf\s+payable|salaries\s+payable|wages\s+payable|bonds?\s+payable|notes?\s+payable|overdraft)\b/i.test(n) ||
    (/\b(?:loan|loans|borrowings?|bonds?|notes?)\b/i.test(n) &&
     !/\b(?:receivables?|recoverables?|due\s+from|to\s+staff|to\s+director|to\s+employee|to\s+related|to\s+subsidiary|asset|assets)\b/i.test(n) &&
     !/\b(?:director'?s?|shareholder'?s?|staff|employee|intercompany|related\s+party)\s+loans?\b/i.test(n))
  ) {
    return 'LIABILITY';
  }

  // Equity patterns
  if (
    !n.includes('unpaid') &&
    !n.includes('receivable') &&
    !n.includes('due from') &&
    !n.includes('income') &&
    !n.includes('revenue') &&
    /\b(?:share\s+capital|ordinary\s+shares?|preference\s+shares?|retained\s+earnings|accumulated\s+profits?|capital\s+reserve|translation\s+reserve|fair\s+value\s+reserve|revaluation\s+reserve|hedging\s+reserve|other\s+reserves?|treasury\s+shares|share\s+buyback\s+reserve|owner'?s?\s+capital|owner'?s?\s+equity|owner'?s?\s+drawings|drawings|dividends?\s+declared)\b/i.test(n)
  ) {
    return 'EQUITY';
  }

  // Revenue patterns
  if (
    !n.startsWith('unearned') &&
    !n.startsWith('deferred') &&
    !n.includes('receivable') &&
    !n.startsWith('accrued') &&
    /\b(?:revenue|sales|service\s+income|fee\s+income|management\s+fee\s+income|interest\s+income|dividend\s+income|rental\s+income|other\s+income|discount\s+received|gain\s+on)\b/i.test(n)
  ) {
    return 'REVENUE';
  }

  // Expense patterns
  if (
    !n.startsWith('prepaid') &&
    !n.startsWith('accrued') &&
    !n.includes('payable') &&
    !n.includes('liability') &&
    !n.includes('accumulated') &&
    !n.includes('allowance') &&
    !n.includes('provision') &&
    !n.includes('deferred tax') &&
    /\b(?:expense|expenses|cost\s+of\s+goods\s+sold|cost\s+of\s+sales|cogs|depreciation|amortisation|amortization|impairment\s+loss|expected\s+credit\s+loss\w*|bad\s+debts?|discount\s+allowed|loss\s+on|salaries\s+and\s+wages|staff\s+costs?|employer\s+cpf|audit\s+fees?|legal\s+fees?|professional\s+fees?|bank\s+charges?|finance\s+costs?|interest\s+expense|rent|utilities|repairs?\s+and\s+maintenance|insurance)\b/i.test(n)
  ) {
    return 'EXPENSE';
  }

  // Asset patterns
  if (
    /\b(?:cash|bank|current\s+account|petty\s+cash|receivables?|debtors?|inventory|inventories|stock|prepaid|prepayments?|refundable\s+deposits?|security\s+deposits?|rental\s+deposits?|utility\s+deposits?|deposits?\s+paid|fixed\s+deposits?|bank\s+deposits?|time\s+deposits?|call\s+deposits?|equipment|machinery|motor\s+vehicles?|delivery\s+van|furniture|fixtures|buildings?|land|property,\s*plant|right-of-use|rou\s+assets?|intangible|software|patent|goodwill|investment|financial\s+assets?|deferred\s+tax\s+assets?|input\s+gst|tax\s+recoverable|due\s+from|accumulated\s+depreciation|accumulated\s+amorti[sz]ation|loss\s+allowance|allowance\s+for\s+(?:doubtful|impairment|expected\s+credit))\b/i.test(n)
  ) {
    return 'ASSET';
  }

  // OCI patterns
  if (/\b(?:other\s+comprehensive\s+income|oci)\b/i.test(n)) {
    return 'OTHER_COMPREHENSIVE_INCOME';
  }

  return undefined;
}

export interface OutstandingBalanceContext {
  accountName: string;
  nature: 'RECEIVABLE' | 'PAYABLE' | 'DEPOSIT';
  remainingAmount: number;
}

export interface ValidateJournalGroupsOptions {
  rawQuery?: string;
  hasPriorContextAmount?: boolean;
  enforceAmountProvenance?: boolean;
  priorContextTexts?: string[];
  priorContextAmounts?: number[];
  isFollowUp?: boolean;
  outstandingBalances?: OutstandingBalanceContext[];
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

export interface DerivableNumbersResult {
  baseNumbers: number[];
  monetaryOccurrences: number[];
  currentMonetaryOccurrences: number[];
  priorMonetaryOccurrences: number[];
  timeOrQuantityFactors: number[];
  statedPercentages: number[];
  allCombinedText: string;
}

export function extractDerivableNumbers(
  rawQuery: string,
  priorContextTexts: string[] = [],
  priorContextAmounts: number[] = []
): DerivableNumbersResult {
  const strippedQuery = stripNonMonetaryTokens(rawQuery || '');
  const strippedPrior = priorContextTexts.map(t => stripNonMonetaryTokens(t || ''));
  const allTexts = [strippedQuery, ...strippedPrior];
  const allCombinedText = allTexts.join(' ');

  const monetaryOccurrences: number[] = [];
  const timeOrQuantityFactors: number[] = [];

  const WORD_TO_INT: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12
  };

  function extractFromText(text: string): { monetary: number[]; factors: number[] } {
    if (!text) return { monetary: [], factors: [] };
    const matchedSpans: Array<{ start: number; end: number }> = [];
    const isSpanOverlapping = (start: number, end: number) => {
      return matchedSpans.some(span => Math.max(start, span.start) < Math.min(end, span.end));
    };
    const addSpan = (start: number, end: number) => {
      matchedSpans.push({ start, end });
    };

    interface ExtractedCandidate {
      val: number;
      start: number;
      end: number;
      hasCurrencyPrefix: boolean;
      hasDecimal: boolean;
      rawStr: string;
      index: number;
    }
    const candidates: ExtractedCandidate[] = [];

    // 1) Word phrases: 50 cents, half a dollar, one dollar, two dollars
    const phraseRegex = /\b(?:50\s*cents?|half\s+a\s+dollar|one\s+dollar|a\s+dollar|two\s+dollars)\b/gi;
    for (const m of text.matchAll(phraseRegex)) {
      const start = m.index!;
      const end = start + m[0].length;
      if (!isSpanOverlapping(start, end)) {
        addSpan(start, end);
        const lower = m[0].toLowerCase();
        const val = (lower.includes('50') || lower.includes('half')) ? 0.5 : (lower.includes('two') ? 2 : 1);
        candidates.push({ val, start, end, hasCurrencyPrefix: true, hasDecimal: true, rawStr: m[0], index: candidates.length });
      }
    }

    // 2) cents matches: (\d+(?:\.\d+)?)\s*cents?\b
    const centsMatches = text.matchAll(/\b(\d+(?:\.\d+)?)\s*cents?\b/gi);
    for (const m of centsMatches) {
      const start = m.index!;
      const end = start + m[0].length;
      if (!isSpanOverlapping(start, end)) {
        addSpan(start, end);
        const val = parseFloat(m[1]);
        if (Number.isFinite(val) && val > 0) {
          candidates.push({ val: val / 100, start, end, hasCurrencyPrefix: true, hasDecimal: true, rawStr: m[0], index: candidates.length });
        }
      }
    }

    // 3) k / thousand
    const kMatches = text.matchAll(/(?:(?:\$|SGD|S\$|\bS\$)\s*)?(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:k|thousand)\b/gi);
    for (const m of kMatches) {
      const start = m.index!;
      const end = start + m[0].length;
      if (!isSpanOverlapping(start, end)) {
        addSpan(start, end);
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (Number.isFinite(val) && val > 0) {
          candidates.push({ val: val * 1000, start, end, hasCurrencyPrefix: true, hasDecimal: false, rawStr: m[0], index: candidates.length });
        }
      }
    }

    // 4) m / million
    const mMatches = text.matchAll(/(?:(?:\$|SGD|S\$|\bS\$)\s*)?(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:m|million)\b/gi);
    for (const m of mMatches) {
      const start = m.index!;
      const end = start + m[0].length;
      if (!isSpanOverlapping(start, end)) {
        addSpan(start, end);
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (Number.isFinite(val) && val > 0) {
          candidates.push({ val: val * 1000000, start, end, hasCurrencyPrefix: true, hasDecimal: false, rawStr: m[0], index: candidates.length });
        }
      }
    }

    // 5) General monetary & numeric values (including suffix currency notations like "50 SGD" or "100 dollars")
    const numMatches = text.matchAll(/(?:(?:\$|SGD|S\$|\bS\$)\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?))|(?:\b(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:SGD|S\$|USD|EUR|GBP|dollars?)\b)|(?:\b(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\b)/gi);
    for (const m of numMatches) {
      const start = m.index!;
      const end = start + m[0].length;
      if (!isSpanOverlapping(start, end)) {
        addSpan(start, end);
        const rawNumStr = (m[1] || m[2] || m[3] || '').replace(/,/g, '');
        const val = parseFloat(rawNumStr);
        if (Number.isFinite(val) && val > 0) {
          const hasCurrencyPrefix = Boolean(m[1]) || /[\$]|SGD|S\$|USD|EUR|GBP|dollars?/i.test(m[0]);
          const hasDecimal = rawNumStr.includes('.');
          candidates.push({ val, start, end, hasCurrencyPrefix, hasDecimal, rawStr: m[0], index: candidates.length });
        }
      }
    }

    const textFactors: number[] = [];
    const textMonetary: number[] = [];

    // Word numbers 1..12 followed by duration/quantity units
    const wordMatches = text.matchAll(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s*[-–]\s*|\s+)(?:years?|yrs?|months?|mos?|quarters?|weeks?|days?|units?|items?|shares?|instalments?|installments?)\b/gi);
    for (const wm of wordMatches) {
      const wVal = WORD_TO_INT[wm[1].toLowerCase()];
      if (wVal) textFactors.push(wVal);
    }

    const hasMajorMonetaryInText = candidates.some(c => c.val >= 100 || c.hasCurrencyPrefix || c.hasDecimal) ||
      priorContextAmounts.some(a => a >= 100);

    for (const c of candidates) {
      const isInteger = Number.isInteger(c.val);
      const beforeText = text.slice(Math.max(0, c.start - 25), c.start);
      const afterText = text.slice(c.end, Math.min(text.length, c.end + 30));

      const hasSuffixCurrency = /^\s*(?:SGD|S\$|USD|EUR|GBP|dollars?)\b/i.test(afterText);
      const isCurrency = c.hasCurrencyPrefix || hasSuffixCurrency;

      const isFactorCandidate = !isCurrency && (
        /^\s*(?:[-–]\s*)?(?:years?|yrs?|months?|mos?|quarters?|qtrs?|weeks?|wks?|days?|hours?|hrs?|units?|items?|pieces?|pcs|shares?|lots?|seats?|licen[cs]es?|laptops?|computers?|machines?|vehicles?|vans?|instalments?|installments?|payments?|times?|x\b|employees?|staff|workers?|headcount|persons?|people|tonnes?|tons?|kg|litres?|liters?|sq\s*ft|sqm|periods?)\b/i.test(afterText) ||
        /\b(?:×|x|qty|quantity|duration|term|useful\s+life(?:\s+of)?|life\s+of|period\s+of)\s*$/i.test(beforeText) ||
        (c.val > 0 && c.val <= 20 && (
          /\b(?:rate|fx|exchange\s+rate|spot\s+rate)\s*(?:of|=|:)?\s*$/i.test(beforeText) ||
          /^\s*(?:per\b|\/)/i.test(afterText)
        ))
      );

      if (isFactorCandidate && isInteger && c.val >= 1 && c.val <= 365) {
        textFactors.push(c.val);
      }

      // If pure integer duration/quantity factor, do NOT add to monetaryOccurrences if there is already monetary context
      if (!isCurrency && !c.hasDecimal && isFactorCandidate && (hasMajorMonetaryInText || candidates.some(other => other.hasCurrencyPrefix))) {
        continue;
      }

      const isBareSmallInteger = !isCurrency && !c.hasDecimal && isInteger && c.val <= 60;
      if (hasMajorMonetaryInText && isBareSmallInteger) {
        continue;
      }

      textMonetary.push(c.val);
    }

    return { monetary: textMonetary, factors: textFactors };
  }

  // 1. Extract from current query (rawQuery)
  const currentExtracted = extractFromText(strippedQuery);
  const currentMonetaryOccurrences = [...currentExtracted.monetary];
  timeOrQuantityFactors.push(...currentExtracted.factors);

  // 2. Extract from prior context (texts and amounts), deduplicated by cent value
  const currentCents = new Set(currentExtracted.monetary.map(m => Math.round(m * 100)));
  const priorCentsSet = new Set<number>();

  for (const amt of priorContextAmounts) {
    if (typeof amt === 'number' && Number.isFinite(amt) && amt > 0) {
      priorCentsSet.add(Math.round(amt * 100));
    }
  }

  for (const pt of strippedPrior) {
    const priorExt = extractFromText(pt);
    timeOrQuantityFactors.push(...priorExt.factors);
    for (const m of priorExt.monetary) {
      priorCentsSet.add(Math.round(m * 100));
    }
  }

  // Prior amounts only contribute values that are not already present in the current turn
  const priorMonetaryOccurrences: number[] = [];
  for (const c of priorCentsSet) {
    if (!currentCents.has(c)) {
      priorMonetaryOccurrences.push(c / 100);
    }
  }

  monetaryOccurrences.push(...currentMonetaryOccurrences, ...priorMonetaryOccurrences);

  // Stated percentages
  const percentages = new Set<number>();
  const pctMatches = allCombinedText.matchAll(/\b(\d+(?:\.\d+)?)\s*%/g);
  for (const m of pctMatches) {
    const val = parseFloat(m[1]);
    if (Number.isFinite(val) && val > 0) percentages.add(val);
  }
  if (/\bgst\b/i.test(allCombinedText)) {
    percentages.add(9);
    if (/\b2023\b/.test(allCombinedText)) {
      percentages.add(8);
    }
  }

  const baseNumbers = Array.from(new Set([...monetaryOccurrences, ...timeOrQuantityFactors].filter(n => Number.isFinite(n) && n > 0)));

  return {
    baseNumbers,
    monetaryOccurrences,
    currentMonetaryOccurrences,
    priorMonetaryOccurrences,
    timeOrQuantityFactors: Array.from(new Set(timeOrQuantityFactors)),
    statedPercentages: Array.from(percentages),
    allCombinedText
  };
}

const MAX_OCCURRENCES = 12;
const MAX_BUCKET_SIZE = 16;
const MAX_TIME_FRACTION_OPS = 500;
const MAX_PAIR_OPS = 800;
const MAX_TRIPLE_OPS = 1000;
const MAX_QUAD_OPS = 700;

export function buildDerivableCents(
  baseNumbers: number[],
  percentages: number[],
  priorAmounts: number[] = [],
  options?: {
    monetaryOccurrences?: number[];
    currentMonetaryOccurrences?: number[];
    priorMonetaryOccurrences?: number[];
    timeOrQuantityFactors?: number[];
    allCombinedText?: string;
  }
): Set<number> {
  const derivedCents = new Set<number>();

  function toCents(val: number): number | undefined {
    if (Number.isFinite(val) && val > 0) {
      const c = Math.round(val * 100);
      if (Number.isSafeInteger(c) && c > 0) {
        return c;
      }
    }
    return undefined;
  }

  function addVal(val: number) {
    const c = toCents(val);
    if (c !== undefined) derivedCents.add(c);
  }

  const currentOccurrences = (options?.currentMonetaryOccurrences || []).slice(0, MAX_OCCURRENCES);
  const priorOccurrences = (options?.priorMonetaryOccurrences || priorAmounts || []).slice(0, MAX_OCCURRENCES);

  const rawOccurrences = (options?.monetaryOccurrences && options.monetaryOccurrences.length > 0)
    ? options.monetaryOccurrences
    : (currentOccurrences.length > 0 || priorOccurrences.length > 0)
      ? [...currentOccurrences, ...priorOccurrences]
      : [...baseNumbers, ...priorAmounts];
  const occurrences = rawOccurrences.slice(0, MAX_OCCURRENCES);

  const factors = (options?.timeOrQuantityFactors !== undefined)
    ? options.timeOrQuantityFactors
    : baseNumbers.filter(n => Number.isInteger(n) && n >= 1 && n <= 365);

  const text = options?.allCombinedText || '';

  // 1) Base values in dollars -> cents & percentage/factor derivations for each occurrence
  const buckets: number[][] = [];

  for (let i = 0; i < occurrences.length; i++) {
    const b = occurrences[i];
    const bSet = new Set<number>();
    const c = toCents(b);
    if (c !== undefined) {
      bSet.add(c);
      derivedCents.add(c);
    }

    for (const p of percentages) {
      const v1 = toCents(b * (p / 100));
      const v2 = toCents(b * (1 + p / 100));
      const v3 = toCents(b * (1 - p / 100));
      const v4 = toCents((b * 100) / (100 + p));
      const v5 = toCents((b * p) / (100 + p));
      if (v1) { bSet.add(v1); derivedCents.add(v1); }
      if (v2) { bSet.add(v2); derivedCents.add(v2); }
      if (v3) { bSet.add(v3); derivedCents.add(v3); }
      if (v4) { bSet.add(v4); derivedCents.add(v4); }
      if (v5) { bSet.add(v5); derivedCents.add(v5); }
    }

    // Multiply/divide with factors (e.g. quantities or time units)
    for (const f of factors) {
      if (f > 0 && f <= 10000) {
        const prod = toCents(b * f);
        const quot = toCents(b / f);
        if (prod && b <= 100000) { bSet.add(prod); derivedCents.add(prod); }
        if (quot) { bSet.add(quot); derivedCents.add(quot); }
      }
    }

    buckets.push(Array.from(bSet).slice(0, MAX_BUCKET_SIZE));
  }

  // Also include prior amounts directly
  for (const a of priorAmounts) {
    addVal(a);
  }

  // 2) First-order accounting time fractions (/ 12, / 4, * m / 12, * d / 365, * d / 360)
  // RUN BEFORE multi-term combinations with dedicated budget MAX_TIME_FRACTION_OPS (500)
  const hasTimeCues = Boolean(text) && /\b(?:month\w*|quarter\w*|year\w*|annual\w*|p\.?a\.?|day\w*|prorat\w*|depreciat\w*|amorti[sz]\w*|interest|lease|prepaid|accru\w*|unearned|defer\w*)\b/i.test(text);

  if (hasTimeCues) {
    let timeOps = 0;
    const statedMonths = factors.filter(n => n >= 1 && n <= 60);
    const statedDays = factors.filter(n => n >= 1 && n <= 365);
    const candidateCents = Array.from(derivedCents).slice(0, 150);
    const hasHalfCue = /\b(?:half|semi[-\s]?annual\w*)\b/i.test(text);

    for (const c of candidateCents) {
      const dollars = c / 100;
      addVal(dollars / 12);
      addVal(dollars / 4);
      if (hasHalfCue) {
        addVal(dollars / 2);
      }
      for (const m of statedMonths) {
        addVal((dollars * m) / 12);
      }
      for (const d of statedDays) {
        addVal((dollars * d) / 365);
        addVal((dollars * d) / 360);
      }
      timeOps += 4 + statedMonths.length + (statedDays.length * 2);
      if (timeOps >= MAX_TIME_FRACTION_OPS) break;
    }
  }

  // Straight-line depreciation: (cost - salvage) / useful_life
  const occLen = occurrences.length;
  for (let i = 0; i < occLen; i++) {
    const a = occurrences[i];
    for (let j = 0; j < occLen; j++) {
      if (i === j) continue;
      const b = occurrences[j];
      if (a > b) {
        for (const f of factors) {
          if (f > 0 && f <= 365) {
            addVal((a - b) / f);
          }
        }
      }
    }
  }

  // 3) Multi-term linear combinations with per-tier operation budgets
  // Cap at MAX_PAIR_OPS, MAX_TRIPLE_OPS, MAX_QUAD_OPS
  const currentLen = currentOccurrences.length;
  const isMultiTurnWithCurrent = currentLen > 0 && priorOccurrences.length > 0;

  // Pairwise combinations (2-term): cap at MAX_PAIR_OPS = 800
  if (occLen >= 2) {
    let pairOps = 0;
    for (let i = 0; i < occLen; i++) {
      const isCurrentI = i < currentLen;
      const bucketI = buckets[i];
      for (let j = 0; j < i; j++) {
        const isCurrentJ = j < currentLen;
        const bucketJ = buckets[j];

        // Per Finding 4: If one is current and one is prior, or both are prior when current is non-empty:
        // ONLY allow difference (|ci - cj|), do NOT add prior to current or prior to prior!
        const allowSum = !isMultiTurnWithCurrent || (isCurrentI && isCurrentJ);

        for (const ci of bucketI) {
          for (const cj of bucketJ) {
            if (allowSum) {
              const sum2 = ci + cj;
              if (sum2 > 0) derivedCents.add(sum2);
            }
            const diff2 = Math.abs(ci - cj);
            if (diff2 > 0) derivedCents.add(diff2);
            pairOps++;
            if (pairOps >= MAX_PAIR_OPS) break;
          }
          if (pairOps >= MAX_PAIR_OPS) break;
        }
        if (pairOps >= MAX_PAIR_OPS) break;
      }
      if (pairOps >= MAX_PAIR_OPS) break;
    }
  }

  // Triple combinations (3-term): cap at MAX_TRIPLE_OPS = 1000
  // When currentLen > 0, restrict to current occurrences so prior amounts don't participate in 3-way sums
  const tripleSourceLen = isMultiTurnWithCurrent ? currentLen : occLen;
  if (tripleSourceLen >= 3) {
    let tripleOps = 0;
    const tripleCap = Math.min(tripleSourceLen, 8);
    for (let i = 0; i < tripleCap; i++) {
      const bucketI = buckets[i].slice(0, 8);
      for (let j = 0; j < i; j++) {
        const bucketJ = buckets[j].slice(0, 8);
        for (let k = 0; k < j; k++) {
          const bucketK = buckets[k].slice(0, 8);
          for (const ci of bucketI) {
            for (const cj of bucketJ) {
              for (const ck of bucketK) {
                const sum3 = ci + cj + ck;
                const diff3a = Math.abs(ci + cj - ck);
                const diff3b = Math.abs(ci + ck - cj);
                const diff3c = Math.abs(cj + ck - ci);
                if (sum3 > 0) derivedCents.add(sum3);
                if (diff3a > 0) derivedCents.add(diff3a);
                if (diff3b > 0) derivedCents.add(diff3b);
                if (diff3c > 0) derivedCents.add(diff3c);
                tripleOps++;
                if (tripleOps >= MAX_TRIPLE_OPS) break;
              }
              if (tripleOps >= MAX_TRIPLE_OPS) break;
            }
            if (tripleOps >= MAX_TRIPLE_OPS) break;
          }
          if (tripleOps >= MAX_TRIPLE_OPS) break;
        }
        if (tripleOps >= MAX_TRIPLE_OPS) break;
      }
      if (tripleOps >= MAX_TRIPLE_OPS) break;
    }
  }

  // Quadruple combinations (4-term): cap at MAX_QUAD_OPS = 700
  const quadSourceLen = isMultiTurnWithCurrent ? currentLen : occLen;
  if (quadSourceLen >= 4) {
    let quadOps = 0;
    const quadCap = Math.min(quadSourceLen, 6);
    for (let i = 0; i < quadCap; i++) {
      const bucketI = buckets[i].slice(0, 6);
      for (let j = 0; j < i; j++) {
        const bucketJ = buckets[j].slice(0, 6);
        for (let k = 0; k < j; k++) {
          const bucketK = buckets[k].slice(0, 6);
          for (let l = 0; l < k; l++) {
            const bucketL = buckets[l].slice(0, 6);
            for (const a of bucketI) {
              for (const b of bucketJ) {
                for (const c of bucketK) {
                  for (const d of bucketL) {
                    const sum4 = a + b + c + d;
                    const diff4a = Math.abs(a + b + c - d);
                    const diff4b = Math.abs(a + b - c - d);
                    if (sum4 > 0) derivedCents.add(sum4);
                    if (diff4a > 0) derivedCents.add(diff4a);
                    if (diff4b > 0) derivedCents.add(diff4b);
                    quadOps++;
                    if (quadOps >= MAX_QUAD_OPS) break;
                  }
                  if (quadOps >= MAX_QUAD_OPS) break;
                }
                if (quadOps >= MAX_QUAD_OPS) break;
              }
              if (quadOps >= MAX_QUAD_OPS) break;
            }
            if (quadOps >= MAX_QUAD_OPS) break;
          }
          if (quadOps >= MAX_QUAD_OPS) break;
        }
        if (quadOps >= MAX_QUAD_OPS) break;
      }
      if (quadOps >= MAX_QUAD_OPS) break;
    }
  }

  return derivedCents;
}

/**
 * Splits query text into semantic clauses around punctuation and contrastive conjunctions.
 */
export function splitQueryIntoClauses(text: string): string[] {
  if (!text) return [];
  const rawSplits = text.split(/(?:;\s*|\n+|\.(?!\d)\s*|\b(?:while|whereas|but|however|although|though)\b\s*)/gi);
  const clauses: string[] = [];
  for (const part of rawSplits) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // Don't split on a comma when the part contains a conditional subordinator
    if (/\b(?:if|when|once|unless|until|provided\s+that|assuming|suppose|contingent|conditional|subject\s+to)\b/i.test(trimmed)) {
      clauses.push(trimmed);
      continue;
    }
    const subSplits = trimmed.split(/,\s+(?:(?:and|while|whereas|but)\s+)?(?=[^;]{1,120}?\b(?:will|shall|is\s+to|are\s+to|was|were|has\s+been|have\s+been|to\s+be|scheduled|pending|paid|settled|transferred|remitted|cleared|disbursed|not\s+paid|unpaid)\b)/gi);
    for (const sub of subSplits) {
      const subTrimmed = sub.trim();
      if (subTrimmed) clauses.push(subTrimmed);
    }
  }
  return clauses.length > 0 ? clauses : [text.trim()];
}

/**
 * Detects future, scheduled, pending, conditional, or negated settlement phrasing.
 */
export function hasNonExecutedSettlementCue(text: string): boolean {
  if (!text) return false;

  // 1. Future modals & infinitives
  if (/\b(?:will|shall|going\s+to|is\s+to|are\s+to|to)\s+(?:be\s+)?(?:paid|settled|transferred|remitted|cleared|disbursed|made)\b/i.test(text)) return true;
  if (/\b(?:will|shall)\s+(?:pay|settle|transfer|remit|clear|disburse|make\s+payment)\b/i.test(text)) return true;

  // 2. Modal / conditional / uncertain / hypothetical
  if (/\b(?:should|would|could|might|may|must|can|ought\s+to|needs?\s+to)\s+(?:be\s+)?(?:paid|settled|transferred|remitted|cleared|disbursed|made|pay|settle)\b/i.test(text)) return true;
  if (/\b(?:hypothetical(?:ly)?|what\s+if|illustrat(?:e|ive))\b/i.test(text)) return true;

  // 3. Conditional subordinators
  if (/\b(?:if|once|when|whenever|unless|until|provided\s+that|assuming(?:\s+that)?|suppose|supposing|in\s+case|in\s+the\s+event(?:\s+that)?|on\s+condition\s+that|where\s+.*?\b(?:is|are)\s+(?:paid|settled))\b/i.test(text)) return true;

  // 4. Pending / scheduled / unexecuted / approval / contingent / conditional
  if (/\b(?:contingent\s+(?:up)?on|conditional\s+(?:up)?on|subject\s+to\b|upon\s+(?:receipt|delivery|completion|inspection|signing|verification|clearance|approval)|pending\s+(?:payment|settlement|transfer|remittance|approval|bank|receipt|delivery|completion|inspection|verification|clearance)|awaiting\s+(?:payment|settlement|transfer|remittance|approval|bank)|yet\s+to\s+be|has\s+yet\s+to\s+be|have\s+yet\s+to\s+be|remains?\s+to\s+be|scheduled\s+(?:for|to)|planned\s+(?:for|to)|slated\s+(?:for|to)|subject\s+to\s+approval|upon\s+approval|once\s+approved)\b/i.test(text)) return true;

  // 5. Explicit negation
  if (/\b(?:no\s+(?:payment|settlement)|not\s+(?:yet\s+)?(?:paid|settled|transferred|remitted|cleared|made)|(?:was|were|is|are|has|have)\s+not\s+(?:been\s+)?(?:paid|settled|transferred|remitted|cleared|made)|unpaid|unsettled|outstanding)\b/i.test(text)) return true;

  // 6. Future time markers when not paired with confirmed past verb
  if (/\b(?:next\s+(?:week|month|quarter|year|monday|tuesday|wednesday|thursday|friday)|tomorrow|in\s+due\s+course|later)\b/i.test(text)) {
    if (!/\b(?:paid|settled|transferred|remitted|cleared)\s+(?:yesterday|today|this\s+morning|already)\b/i.test(text)) {
      return true;
    }
  }

  return false;
}

/**
 * Detects affirmative completed settlement verbs with appropriate subjects, methods, or dates.
 */
export function hasConfirmedSettlementVerb(text: string): boolean {
  if (!text) return false;
  if (hasNonExecutedSettlementCue(text)) return false;

  // Passive past/completed
  if (/\b(?:was|were|has\s+been|have\s+been|had\s+been|is\s+now|are\s+now)\s+(?:(?:already|duly|fully|partially|actually|promptly)\s+)*(?:paid|settled|transferred|remitted|cleared|disbursed|completed|made|executed)\b/i.test(text)) {
    return true;
  }

  // Active past/completed: [we|company|entity|employer|firm|business|management|parent|subsidiary|customer|client]? paid|settled|transferred|remitted|cleared|disbursed
  // excluding when preceded by negative/modal/future markers
  const activeRegex = /\b(?:(we|company|entity|employer|firm|business|management|parent|subsidiary|customer|client)\s+)?(paid|settled|transferred|remitted|cleared|disbursed)\b/gi;
  for (const m of text.matchAll(activeRegex)) {
    const precedingText = text.substring(0, m.index!).trim();
    if (!/\b(?:not|never|if|whether|will|shall|should|would|could|might|may|must|to|yet\s+to|pending|before|until)$/i.test(precedingText)) {
      return true;
    }
  }

  // Imperative settlement instruction for previously accrued liabilities with payment method
  if (/^\s*(?:pay|settle|transfer|remit|clear|disburse)\b.*?\b(?:previously\s+accrued|accrued)\b.*?\b(?:by|via|in|from|using)\b/i.test(text.trim())) {
    return true;
  }

  // Participle completion with payment method/date:
  // Must NOT be preceded by auxiliary passive verbs (is/are/be/being) or conditional subordinators (if/when/once/unless/until)
  const participleRegex = /\b(?:paid|settled|transferred|remitted|cleared|disbursed)\b.*?\b(?:by\s+(?:bank|cash|cheque|check|giro|paynow|wire|transfer)|in\s+(?:cash|full)|via\s+(?:bank|giro|paynow|wire)|from\s+bank|on\s+\d|yesterday|today|this\s+morning)\b/gi;
  for (const m of text.matchAll(participleRegex)) {
    const preceding = text.substring(0, m.index!).trim();
    if (!/\b(?:is|are|be|being|if|when|once|unless|until|not|never|to)$/i.test(preceding)) {
      return true;
    }
  }

  return false;
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

    // Outstanding Balance Settlement Check
    if (options?.isFollowUp && Array.isArray(options.outstandingBalances) && options.outstandingBalances.length > 0) {
      const creditsCash = group.lines.some(l => l.credit > 0 && /\b(?:cash|bank|current account|cheque|check|giro|paynow)\b/i.test(l.accountName));
      const debitsCash = group.lines.some(l => l.debit > 0 && /\b(?:cash|bank|current account|cheque|check|giro|paynow)\b/i.test(l.accountName));

      if (creditsCash) {
        // Settling liabilities
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
                code: 'UNSTATED_AMOUNT',
                message: `Settlement amount S$${line.debit.toFixed(2)} for '${line.accountName}' exceeds the outstanding balance of S$${remaining.toFixed(2)}.`,
                groupTitle,
                accountName: line.accountName
              });
            }
          }
        }
      }

      if (debitsCash) {
        // Settling receivables
        for (const line of group.lines) {
          if (line.credit > 0 && (line.category === 'ASSET' || /\b(?:receivable|receivables|recoverable|due from)\b/i.test(line.accountName)) && !/\b(?:cash|bank|current account)\b/i.test(line.accountName)) {
            const lineNameLower = line.accountName.toLowerCase();
            const receivableBalances = options.outstandingBalances.filter(b => b.nature === 'RECEIVABLE');
            const matched = receivableBalances.find(b =>
              b.accountName.toLowerCase() === lineNameLower ||
              b.accountName.toLowerCase().includes(lineNameLower) ||
              lineNameLower.includes(b.accountName.toLowerCase())
            );
            const remaining = matched
              ? matched.remainingAmount
              : receivableBalances.reduce((sum, b) => sum + (b.remainingAmount || 0), 0);

            if (remaining > 0 && line.credit > remaining + 0.01) {
              issues.push({
                code: 'UNSTATED_AMOUNT',
                message: `Settlement amount S$${line.credit.toFixed(2)} for '${line.accountName}' exceeds the outstanding balance of S$${remaining.toFixed(2)}.`,
                groupTitle,
                accountName: line.accountName
              });
            }
          }
        }
      }
    }

    // Unconfirmed Settlement Check:
    // Check if the group credits Cash/Bank while debiting any Liability account.
    const creditsCashOrBank = group.lines.some(l => l.credit > 0 && /\b(?:cash|bank|current account|cheque|check|giro|paynow)\b/i.test(l.accountName));
    const debitedLiabilityLines = group.lines.filter(l => l.debit > 0 && (l.category === 'LIABILITY' || /\b(?:payable|payables|accrued|liability|liabilities)\b/i.test(l.accountName)));

    if (creditsCashOrBank && debitedLiabilityLines.length > 0 && options?.rawQuery) {
      const rawQuery = options.rawQuery;
      const clauses = splitQueryIntoClauses(rawQuery);
      const sentences = rawQuery.split(/(?:;\s*|\n+|\.(?!\d)\s*)/gi).map(s => s.trim()).filter(Boolean);

      for (const line of debitedLiabilityLines) {
        const accLower = line.accountName.toLowerCase();
        let legKeywords: RegExp;
        if (/salaries|salary|wage|payroll|staff/i.test(accLower)) {
          legKeywords = /\b(?:salaries|salary|wages?|payroll|staff)\b/i;
        } else if (/cpf/i.test(accLower)) {
          legKeywords = /\bcpf\b/i;
        } else if (/trade\s+payable|supplier|vendor/i.test(accLower)) {
          legKeywords = /\b(?:trade\s+payables?|suppliers?|vendors?)\b/i;
        } else if (/gst/i.test(accLower)) {
          legKeywords = /\bgst\b/i;
        } else {
          legKeywords = new RegExp(`\\b${line.accountName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        }

        const matchingClauses = clauses.filter(c => legKeywords.test(c));
        const legText = matchingClauses.length > 0 ? matchingClauses.join('; ') : rawQuery;

        const enclosingSentence = sentences.find(s => legKeywords.test(s)) || rawQuery;
        const sentenceClauses = splitQueryIntoClauses(enclosingSentence);
        const hasBareConditionInSentence = sentenceClauses.some(sc =>
          /\b(?:if|unless|until|provided\s+that|assuming|suppose|what\s+if|in\s+the\s+event|on\s+condition\s+that|contingent|conditional|subject\s+to)\b/i.test(sc) &&
          !/\b(?:salaries|salary|wages?|payroll|staff|cpf|payables?|accrued|liabilit(?:y|ies)|creditors?|suppliers?|vendors?|tax|taxes|gst|rent|bills?|invoices?)\b/i.test(sc)
        );

        const hasUnexecuted = hasNonExecutedSettlementCue(legText) || hasBareConditionInSentence;
        const hasConfirmed = !hasUnexecuted && hasConfirmedSettlementVerb(legText);

        if (hasUnexecuted) {
          issues.push({
            code: 'UNCONFIRMED_SETTLEMENT',
            message: `Group '${groupTitle}' debits liability account '${line.accountName}' as a settlement, but the transaction indicates payment is future-dated, pending, scheduled, conditional, or not yet executed: "${legText}". Settlement cannot be posted as a completed transaction.`,
            groupTitle,
            accountName: line.accountName
          });
        } else if (!hasConfirmed) {
          issues.push({
            code: 'UNCONFIRMED_SETTLEMENT',
            message: `Group '${groupTitle}' records a settlement of liability '${line.accountName}', but lacks confirmation that payment was completed. Clarification is required.`,
            groupTitle,
            accountName: line.accountName
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
    const derivable = extractDerivableNumbers(
      options.rawQuery || '',
      options.priorContextTexts,
      options.priorContextAmounts
    );

    if (derivable.baseNumbers.length === 0) {
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
      const derivedCents = buildDerivableCents(
        derivable.baseNumbers,
        derivable.statedPercentages,
        options.priorContextAmounts,
        {
          monetaryOccurrences: derivable.monetaryOccurrences,
          currentMonetaryOccurrences: derivable.currentMonetaryOccurrences,
          priorMonetaryOccurrences: derivable.priorMonetaryOccurrences,
          timeOrQuantityFactors: derivable.timeOrQuantityFactors,
          allCombinedText: derivable.allCombinedText
        }
      );

      const currentMonetary = derivable.currentMonetaryOccurrences || [];
      const hasTimeOrProrationCue = /\b(?:month\w*|quarter\w*|year\w*|annual\w*|p\.?a\.?|day\w*|prorat\w*|depreciat\w*|amorti[sz]\w*|interest|lease|prepaid|accru\w*|unearned|defer\w*|partial|instal\w*|half)\b/i.test(derivable.allCombinedText);
      const singleAmountQuery = (currentMonetary.length > 0 ? currentMonetary.length === 1 : derivable.monetaryOccurrences.length === 1) &&
        derivable.statedPercentages.length === 0 &&
        derivable.timeOrQuantityFactors.length === 0 &&
        !hasTimeOrProrationCue;
      const expectedCents = singleAmountQuery
        ? (currentMonetary.length === 1 ? Math.round(currentMonetary[0] * 100) : Math.round(derivable.monetaryOccurrences[0] * 100))
        : 0;

      for (const group of groups) {
        if (group.isHypothetical) continue;
        const groupTitle = group.title || 'Untitled Group';
        const lines = group.lines || [];

        // Check line-level semantic consistency for single-amount queries
        if (singleAmountQuery && lines.length === 2 && expectedCents > 0) {
          for (const line of lines) {
            const debitCents = Math.round((line.debit || 0) * 100);
            const creditCents = Math.round((line.credit || 0) * 100);
            const lineCents = debitCents > 0 ? debitCents : creditCents;
            if (lineCents > 0 && Math.abs(lineCents - expectedCents) > 2) {
              issues.push({
                code: 'UNSTATED_AMOUNT',
                message: `Line '${line.accountName}' in group '${groupTitle}' uses amount S$${(lineCents / 100).toFixed(2)} which contradicts the single stated transaction amount S$${(expectedCents / 100).toFixed(2)}.`,
                groupTitle,
                accountName: line.accountName
              });
            }
          }
        }

        for (const line of lines) {
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
