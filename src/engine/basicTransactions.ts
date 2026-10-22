import type {
  AccountCategory,
  AccountingScenarioState,
  JournalEntryGroup,
  JournalLine,
  MissingFieldInfo
} from '../types/accounting';
import { formatSingaporeDate } from '../utils/dateUtils';

/**
 * Narrow, evidence-based bookkeeping patterns. Unknown or ambiguous facts are
 * not filled using guesses or a provider. All calculations use integer cents.
 * This is not a general-purpose natural-language journal generator.
 */
type Account = { name: string; code: string; category: AccountCategory };
type Pair = { debit?: Account; credit?: Account; missing?: MissingFieldInfo[] };
type Template = {
  id: string;
  title: string;
  patterns: RegExp[];
  accounts: (query: string) => Pair;
  rationale: string;
};
const asset = (name: string, code = '1010'): Account => ({ name, code, category: 'ASSET' });
const liability = (name: string, code = '2100'): Account => ({ name, code, category: 'LIABILITY' });
const expense = (name: string, code = '5300'): Account => ({ name, code, category: 'EXPENSE' });
const equity = (name: string, code = '3100'): Account => ({ name, code, category: 'EQUITY' });
const revenue = (): Account => ({ name: 'Revenue', code: '4000', category: 'REVENUE' });
const bank = () => asset('Cash at Bank');
const cash = () => asset('Cash', '1000');
const receivable = () => asset('Trade Receivables', '1100');
const loan = () => liability('Bank Loan', '2100');

const need = (key: string, name: string, prompt: string): MissingFieldInfo => ({
  fieldKey: key,
  fieldName: name,
  prompt,
  whyNeeded: 'A journal cannot be posted without the stated transaction facts.'
});

function getAllAmounts(query: string) {
  return [...query.matchAll(/(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/gi)].map(m => {
    const whole = m[1].replace(/,/g, '');
    const fraction = (m[2] || '').padEnd(2, '0');
    const cents = BigInt(whole) * 100n + BigInt(fraction || '0');
    return {
      raw: m[0],
      index: m.index ?? 0,
      whole,
      fraction,
      cents,
      amount: Number(cents) / 100
    };
  }).filter(a => a.cents > 0n && a.cents <= BigInt(Number.MAX_SAFE_INTEGER));
}

/** A single explicit SGD value only. Reject multiple, invalid and unsafe amounts. */
function amountCents(query: string): bigint | undefined {
  const amounts = getAllAmounts(query);
  if (amounts.length !== 1) return undefined;
  return amounts[0].cents;
}

function extractLoanRepaymentAmounts(query: string): { principalCents: bigint; interestCents: bigint } | undefined {
  const pMatch = query.match(/\bprincipal\s+(?:of\s+)?(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/i)
    || query.match(/(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s+(?:of\s+)?principal\b/i);
  const iMatch = query.match(/\binterest\s+(?:of\s+)?(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/i)
    || query.match(/(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s+(?:of\s+)?interest\b/i);

  if (!pMatch || !iMatch) return undefined;
  const pWhole = pMatch[1].replace(/,/g, '');
  const pFrac = (pMatch[2] || '').padEnd(2, '0');
  const pCents = BigInt(pWhole) * 100n + BigInt(pFrac || '0');

  const iWhole = iMatch[1].replace(/,/g, '');
  const iFrac = (iMatch[2] || '').padEnd(2, '0');
  const iCents = BigInt(iWhole) * 100n + BigInt(iFrac || '0');

  if (pCents <= 0n || iCents <= 0n) return undefined;
  return { principalCents: pCents, interestCents: iCents };
}

function extractSaleAndCostAmounts(query: string): { saleCents: bigint; costCents: bigint } | undefined {
  const all = getAllAmounts(query);
  if (all.length !== 2) return undefined;
  const costRegex = /\b(?:cost(?:\s+of\s+goods\s+sold)?|carrying\s+(?:cost|amount))\s+(?:is\s+|of\s+|was\s+)?(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/i;
  const costMatch = query.match(costRegex);
  if (!costMatch) return undefined;

  const cWhole = costMatch[1].replace(/,/g, '');
  const cFrac = (costMatch[2] || '').padEnd(2, '0');
  const costCents = BigInt(cWhole) * 100n + BigInt(cFrac || '0');

  const saleItem = all.find(a => a.cents !== costCents) || all[0];
  if (!saleItem || saleItem.cents <= 0n || costCents <= 0n) return undefined;

  return { saleCents: saleItem.cents, costCents };
}

function extractCustomerReceiptDiscountAmounts(query: string): { grossCents: bigint; discountCents: bigint; netCents: bigint } | undefined {
  const all = getAllAmounts(query);
  if (all.length < 2 || all.length > 3) return undefined;

  const dMatch = query.match(/\b(?:discount(?:\s+allowed)?|rebate)\s+(?:of\s+|is\s+|was\s+)?(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/i)
    || query.match(/(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s+(?:settlement\s+|cash\s+|early\s+payment\s+)?(?:discount|rebate)\b/i);
  if (!dMatch) return undefined;

  const dWhole = dMatch[1].replace(/,/g, '');
  const dFrac = (dMatch[2] || '').padEnd(2, '0');
  const discountCents = BigInt(dWhole) * 100n + BigInt(dFrac || '0');
  if (discountCents <= 0n) return undefined;

  if (all.length === 3) {
    const sorted = [...all].map(a => a.cents).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const grossCents = sorted[2];
    let netCents: bigint | undefined;
    if (sorted[0] === discountCents) {
      netCents = sorted[1];
    } else if (sorted[1] === discountCents) {
      netCents = sorted[0];
    } else {
      return undefined;
    }
    if (grossCents !== netCents + discountCents || grossCents <= 0n || discountCents <= 0n || netCents <= 0n) {
      return undefined;
    }
    return { grossCents, discountCents, netCents };
  }

  if (all.length === 2) {
    const otherItem = all.find(a => a.cents !== discountCents) || all[0];
    const otherCents = otherItem.cents;

    const invMatch = query.match(/\b(?:invoice|receivable|outstanding(?:\s+invoice|\s+balance)?|gross(?:\s+invoice|\s+amount)?)\s+(?:of\s+|for\s+|was\s+|is\s+)?(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/i);
    const recMatch = query.match(/\b(?:received|collected|paid|net(?:\s+receipt|\s+cash|\s+amount)?)\s+(?:of\s+)?(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/i);

    let invCents: bigint | undefined;
    if (invMatch) {
      const whole = invMatch[1].replace(/,/g, '');
      const frac = (invMatch[2] || '').padEnd(2, '0');
      invCents = BigInt(whole) * 100n + BigInt(frac || '0');
    }

    let recCents: bigint | undefined;
    if (recMatch) {
      const whole = recMatch[1].replace(/,/g, '');
      const frac = (recMatch[2] || '').padEnd(2, '0');
      recCents = BigInt(whole) * 100n + BigInt(frac || '0');
    }

    let grossCents: bigint;
    let netCents: bigint;

    if (invCents === otherCents && (!recMatch || recCents !== otherCents || invCents !== discountCents)) {
      grossCents = otherCents;
      netCents = grossCents - discountCents;
    } else if (recCents === otherCents) {
      netCents = otherCents;
      grossCents = netCents + discountCents;
    } else {
      return undefined;
    }

    if (grossCents <= discountCents || discountCents <= 0n || netCents <= 0n || grossCents !== netCents + discountCents) {
      return undefined;
    }

    return { grossCents, discountCents, netCents };
  }

  return undefined;
}

function extractSupplierPaymentDiscountAmounts(query: string): { grossCents: bigint; discountCents: bigint; netCents: bigint } | undefined {
  const all = getAllAmounts(query);
  if (all.length < 2 || all.length > 3) return undefined;

  const dMatch = query.match(/\b(?:discount(?:\s+received)?|rebate)\s+(?:of\s+|is\s+|was\s+)?(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/i)
    || query.match(/(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)\s+(?:settlement\s+|cash\s+|early\s+(?:payment|settlement)\s+)?(?:discount|rebate)\b/i);
  if (!dMatch) return undefined;

  const dWhole = dMatch[1].replace(/,/g, '');
  const dFrac = (dMatch[2] || '').padEnd(2, '0');
  const discountCents = BigInt(dWhole) * 100n + BigInt(dFrac || '0');
  if (discountCents <= 0n) return undefined;

  if (all.length === 3) {
    const sorted = [...all].map(a => a.cents).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const grossCents = sorted[2];
    let netCents: bigint | undefined;
    if (sorted[0] === discountCents) {
      netCents = sorted[1];
    } else if (sorted[1] === discountCents) {
      netCents = sorted[0];
    } else {
      return undefined;
    }
    if (grossCents !== netCents + discountCents || grossCents <= 0n || discountCents <= 0n || netCents <= 0n) {
      return undefined;
    }
    return { grossCents, discountCents, netCents };
  }

  if (all.length === 2) {
    const otherItem = all.find(a => a.cents !== discountCents) || all[0];
    const otherCents = otherItem.cents;

    const invMatch = query.match(/\b(?:invoice|payable|payables|outstanding(?:\s+invoice|\s+balance|\s+payable)?|gross(?:\s+invoice|\s+payable|\s+amount)?|owed)\s+(?:of\s+|for\s+|was\s+|is\s+)?(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/i);
    const paidMatch = query.match(/\b(?:paid|remitted|transferred|net(?:\s+payment|\s+cash|\s+amount)?)\s+(?:of\s+)?(?:\bSGD\s*|S\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|,\d|\.\d)/i);

    let invCents: bigint | undefined;
    if (invMatch) {
      const whole = invMatch[1].replace(/,/g, '');
      const frac = (invMatch[2] || '').padEnd(2, '0');
      invCents = BigInt(whole) * 100n + BigInt(frac || '0');
    }

    let paidCents: bigint | undefined;
    if (paidMatch) {
      const whole = paidMatch[1].replace(/,/g, '');
      const frac = (paidMatch[2] || '').padEnd(2, '0');
      paidCents = BigInt(whole) * 100n + BigInt(frac || '0');
    }

    let grossCents: bigint;
    let netCents: bigint;

    if (invCents === otherCents && (!paidMatch || paidCents !== otherCents || invCents !== discountCents)) {
      grossCents = otherCents;
      netCents = grossCents - discountCents;
    } else if (paidCents === otherCents) {
      netCents = otherCents;
      grossCents = netCents + discountCents;
    } else {
      return undefined;
    }

    if (grossCents <= discountCents || discountCents <= 0n || netCents <= 0n || grossCents !== netCents + discountCents) {
      return undefined;
    }

    return { grossCents, discountCents, netCents };
  }

  return undefined;
}

function isUnearnedRecognition(query: string): boolean {
  return /\b(?:unearned\s+revenue|deferred\s+revenue|customer\s+advance|advance\s+(?:payment\s+)?from\s+(?:a\s+|the\s+)?customer)\b/i.test(query) &&
    /\b(?:earn(?:ed|s|ing)?|recogni[sz](?:e|ed|es|ing)|releas(?:e|ed|es|ing)|satisf(?:y|ied|ies|ying)|deliver(?:ed|s|ing)|perform(?:ed|s|ing)|complet(?:e|ed|es|ing)|render(?:ed|s|ing))\b/i.test(query) &&
    !/\b(?:before\s+(?:delivery|delivering|performing|providing|completing)|to\s+be\s+(?:delivered|performed|provided|rendered)|not\s+yet\s+(?:delivered|performed|earned))\b/i.test(query);
}

function isExpenseAccrualRecognition(query: string): boolean {
  return /\b(?:accrue[ds]?|accrual|incurred\s+but\s+(?:not\s+yet\s+(?:paid|billed)|unpaid|unbilled)|unpaid\s+at\s+(?:month|quarter|year|period)[- ]end)\b/i.test(query) &&
    !/\b(?:accrued\s+(?:last|previous)\s+(?:month|period|year)|previously\s+accrued|settling\s+an?\s+accrued|paid\s+(?:the\s+)?accrued|settle[ds]?\s+(?:the\s+)?accrued)\b/i.test(query);
}

function bankAccount(query: string, side: 'from' | 'to'): Account | undefined {
  const expression = side === 'from'
    ? /\bfrom\s+(?:(?:the|our|business)\s+)?(current|savings?|checking|cheque|operating|business)\s+(?:bank\s+)?account\b/i
    : /\bto\s+(?:(?:the|our|business)\s+)?(current|savings?|checking|cheque|operating|business)\s+(?:bank\s+)?account\b/i;
  const kind = query.match(expression)?.[1]?.toLowerCase();
  if (!kind) return undefined;
  const names: Record<string, string> = {
    current: 'Current Account', savings: 'Savings Account', saving: 'Savings Account',
    checking: 'Checking Account', cheque: 'Cheque Account',
    operating: 'Operating Account', business: 'Business Account'
  };
  return asset(names[kind], side === 'from' ? '1010' : '1020');
}

function bankTransfer(query: string): Pair {
  const debit = bankAccount(query, 'to');
  const credit = bankAccount(query, 'from');
  const missing = [
    ...(!credit ? [need('sourceAccount', 'Source bank account', 'Which bank account is the transfer from?')] : []),
    ...(!debit ? [need('destinationAccount', 'Destination bank account', 'Which bank account is the transfer to?')] : [])
  ];
  if (debit && credit && debit.name === credit.name) {
    missing.push(need('distinctAccounts', 'Two different bank accounts', 'Which two distinct bank accounts are involved?'));
  }
  return { debit, credit, missing };
}

function isBankTransfer(query: string): boolean {
  if (!/\b(?:transfer|transferred|moving|move|moved)\b/i.test(query)) return false;
  if (!/\b(?:bank|account)\b/i.test(query)) return false;
  if (/\b(?:rent|rental|utilities|utility|electricity|water\s+bill|office\s+supplies|stationery|deposit|loan|principal|interest|invoice|bill|goods|products|services|merchandise|inventory|salary|salaries|wages|expense|purchase|purchased|bought|sold|sale|unearned|deferred|advance|payable|payables|receivable|receivables|provision|warranty|return|returned|refund|allowance|bad\s+debt|doubtful|impairment|accrue|accrued|accrual)\b/i.test(query)) return false;
  if (/\b(?:by|via|through|using|paid\s+by|pay\s+by)\s+(?:a\s+)?bank\s+transfer\b/i.test(query)) return false;
  return true;
}

function expenseAccounts(query: string): Pair {
  let debitAccount: Account;
  if (/\b(?:refundable|security|rental)\s+deposit\b/i.test(query)) {
    debitAccount = asset('Refundable Deposits', '1350');
  } else if (/\b(?:prepaid|paid\s+in\s+advance|in\s+advance)\b/i.test(query)) {
    debitAccount = /\brent\b/i.test(query) ? asset('Prepaid Rent', '1300') : asset('Prepaid Expenses', '1300');
  } else if (/\b(?:accrued\s+(?:last|previous)\s+(?:month|period|year)|previously\s+accrued|settling\s+an?\s+accrued)\b/i.test(query)) {
    debitAccount = liability('Accrued Expenses', '2100');
  } else {
    const kind = /\boffice supplies\b|\bstationery\b/i.test(query) ? 'Office Supplies Expense'
      : /\b(?:rent|rental payment)\b/i.test(query) ? 'Rent Expense'
      : /\b(?:utilities|utility|electricity|water bill)\b/i.test(query) ? 'Utilities Expense'
      : 'Operating Expense';
    debitAccount = expense(kind);
  }

  const isDeposit = /\b(?:refundable|security|rental)\s+deposit\b/i.test(query);
  const isAccrualSettlement = /\b(?:accrued\s+(?:last|previous)\s+(?:month|period|year)|previously\s+accrued|settling\s+an?\s+accrued)\b/i.test(query);

  const onCredit = /\b(?:on\s+(?:(?:\d+\s*[-–]?\s*days?\s+)?credit|account)|\d+\s*[-–]?\s*days?\s+(?:credit|payment\s+terms?)|credit\s+terms?)\b/i.test(query) &&
    !/\b(?:paid|by\s+bank|in\s+cash|with\s+cash)\b/i.test(query);

  if (onCredit && !isDeposit && !isAccrualSettlement) {
    return { debit: debitAccount, credit: { name: 'Trade Payables', code: '2000', category: 'LIABILITY' } };
  }

  const cashPaid = /\b(?:in cash|with cash|by cash|cash payment|cash paid)\b/i.test(query);
  const bankPaid = /\b(?:by bank|via bank|from (?:the |our )?bank|bank transfer|bank payment|paid (?:online|electronically))\b/i.test(query);

  if (cashPaid === bankPaid) {
    return {
      debit: debitAccount,
      missing: [need('paymentMethod', 'Payment method', 'Was the payment made in cash or from a bank account?')]
    };
  }

  return { debit: debitAccount, credit: cashPaid ? cash() : bank() };
}

// Owner drawings are an equity transaction for sole proprietors, but "owner"
// alone does not identify the legal form of the business. Never default a
// company's director/shareholder withdrawal to proprietor drawings.
const personalOwnerWithdrawal = (query: string): boolean =>
  /\b(?:owner|sole proprietor|sole proprietorship)\b/i.test(query) &&
  /\b(?:personal use|private use|personal expense|drawings)\b/i.test(query) &&
  /\b(?:business|firm|company)\b/i.test(query) &&
  !/\b(?:contribut(?:e|ion)|invest(?:ed|ment)?|put into|deposit(?:ed)?)\b/i.test(query);

const customerPaymentOutflow = (query: string): boolean =>
  /\b(?:refund|reimburse|repay|return)\w*\b/i.test(query) ||
  /\b(?:we|i|(?:(?:our|the)\s+)?(?:business|company))\s+(?:(?:have|has|are|is)\s+)?(?:pay|paid|pays|paying|send|sent|transfer|transferred|remit|remitted|settle|settled|settling)\b/i.test(query) ||
  /\b(?:paid|sent|transferred|remitted|settled)\b.{0,60}\bby\s+(?:us|(?:(?:the|our)\s+)?(?:business|company))\b/i.test(query) ||
  /\b(?:pay|paid|pays|paying|send|sent|transfer|transferred|remit|remitted)\b.{0,80}\b(?:to|for)\s+(?:(?:the|a|an|our|my)\s+)?(?:customer|client)\b/i.test(query);

const customerReceiptDirection = (query: string): boolean =>
  /\b(?:receipt|received|receives|receiving|receive|collect|collected|settled|settles|settling|settlement|settlements)\b/i.test(query) ||
  /\b(?:(?:the|a|our|my)\s+)?(?:customer|client)\s+(?:(?:has|have|had)\s+)?(?:paid|pays|pay)\b/i.test(query) ||
  /\b(?:paid|pays|pay)\b.{0,80}\bby\s+(?:the\s+)?(?:customer|client)\b/i.test(query);

const officeEquipmentPurchasePatterns = [
  /\boffice\s+equipment\b/i,
  /\b(?:buy|buys|bought|purchase|purchases|purchased|acquire|acquires|acquired)\b/i,
  /\b(?:pay|pays|paid|paying)\b/i,
  /\b(?:full|entire)\s+(?:purchase\s+)?amount\b/i,
  /\bimmediately\b/i,
  /\b(?:no\s+GST\s+(?:applies?|is\s+(?:applicable|charged))|GST\s+(?:does\s+not\s+apply|is\s+not\s+(?:applicable|charged)))\b/i
];
const officeEquipmentNoGstStatement = /\b(?:no\s+gst\s+(?:applies?|is\s+(?:applicable|charged|payable))|gst\s+(?:(?:does\s+not|doesn't|doesnt)\s+apply|(?:(?:is\s+not|isn't|isnt)\s+(?:applicable|charged|payable))))\b/i;
const officeEquipmentPurchaseExclusions = /\b(?:partial(?:ly)?|deposit|instal(?:l)?ments?|financ\w*|loan|trade[-\s]?in|exchange|on\s+credit|credit\s+terms?|unpaid|payable|deferred\s+payment|remaining\s+(?:amount|balance)|pay\s+later)\b/i;
const officeEquipmentBankPayment = /\b(?:from|using|via|through)\s+(?:(?:the|its|our)\s+)?(?:business\s+)?bank(?:\s+account|\s+transfer)?\b/i;
const officeEquipmentCashPayment = /\b(?:in|with|using|by)\s+(?:physical\s+)?cash\b|\bphysical\s+cash\b|\bcash\s+on\s+hand\b/i;
const officeEquipmentNegatedPayment = /\b(?:do|does|did|will|can)\s+not\s+pay\b|\b(?:don't|doesn't|didn't|won't|can't)\s+pay\b|\bnot\s+(?:paid|paying)\b|\bunpaid\b/i;
const officeEquipmentSpecializedContext = /\b(?:CPF|central\s+provident\s+fund|payroll|salary|salaries|wages?|bonus|employee|employer|lease|leasing|tenancy|rental|share(?:s|holder)?|investment|invested|dividend|FVTPL|FVOCI|forex|foreign\s+exchange|FX|bond|GST)\b/i;
const officeEquipmentConflictingGstContext = /\b(?:gst|goods\s+and\s+services\s+tax|input\s+tax|output\s+tax|taxable|exempt|zero[ -]?rated|out[ -]of[ -]scope|tax\s+invoice|invoic\w*|registration\s+threshold|taxable\s+turnover|reverse\s+charge)\b/i;
const officeEquipmentExplicitDate = /\b(?:on|dated)\s+((?:\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}-\d{1,2}-\d{1,2}))\b/i;
const officeEquipmentPurchaseCandidate = (query: string): boolean =>
  officeEquipmentPurchasePatterns.slice(0, 5).every(pattern => pattern.test(query));

function isCalendarDateToken(token: string): boolean {
  const dmy = token.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const ymd = token.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!dmy && !ymd) return false;
  const year = Number(dmy?.[3] ?? ymd?.[1]);
  const month = Number(dmy?.[2] ?? ymd?.[2]);
  const day = Number(dmy?.[1] ?? ymd?.[3]);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= daysInMonth;
}

const isSimpleOfficeEquipmentPurchase = (query: string): boolean => {
  const hasBankPayment = officeEquipmentBankPayment.test(query);
  const hasCashPayment = officeEquipmentCashPayment.test(query);
  const remainingAfterNoGstStatement = query.replace(officeEquipmentNoGstStatement, ' ');
  return officeEquipmentPurchasePatterns.every(pattern => pattern.test(query)) &&
    hasBankPayment !== hasCashPayment &&
    !officeEquipmentPurchaseExclusions.test(query) &&
    !officeEquipmentNegatedPayment.test(query) &&
    !officeEquipmentSpecializedContext.test(remainingAfterNoGstStatement) &&
    !officeEquipmentConflictingGstContext.test(remainingAfterNoGstStatement);
};

const ownerDrawingsTemplate: Template = {
  id: 'SOLE_PROPRIETOR_DRAWINGS', title: 'Owner cash withdrawal for personal use',
  patterns: [],
  accounts: query => {
    if (!/\bsole propriet(?:or|orship)\b/i.test(query)) {
      return { missing: [need('entityType', 'Business entity type',
        /\b(?:company|pte\.? ltd\.?|limited)\b/i.test(query)
          ? 'Is this a recoverable advance to the director/shareholder, an approved dividend, or another type of payment?'
          : 'Is this business a sole proprietorship or a company?')] };
    }
    const fromCash = /\b(?:cash on hand|petty cash|cash)\b/i.test(query) && !/\bbank\b/i.test(query);
    const fromBank = /\b(?:bank|current account|savings account)\b/i.test(query) && !fromCash;
    if (!fromCash && !fromBank) return { debit: equity("Owner's Drawings"), missing: [
      need('paymentAccount', 'Payment source', 'Was the money taken from physical cash or a business bank account?')
    ] };
    return { debit: equity("Owner's Drawings"), credit: fromCash ? cash() : bank() };
  },
  rationale: 'SGD amount is provided if shown below. For a sole proprietorship, personal withdrawal is Dr Owner\'s Drawings / Cr Cash or Cash at Bank. For a company, the debit depends on the nature of the payment; it must not automatically be treated as proprietor drawings.'
};

const templates: Template[] = [
  {
    id: 'PETTY_CASH_WITHDRAWAL', title: 'Cash withdrawal to petty cash',
    patterns: [/\b(?:withdraw|withdrew|withdrawal|take|took|transfer|transferred|move|moved)\b/i, /\b(?:petty cash|cash box|cash drawer)\b/i],
    accounts: () => ({ debit: asset('Petty Cash', '1005'), credit: bank() }),
    rationale: 'Internal transfer between two asset accounts; no revenue or expense and no GST arises merely from moving cash.'
  },
  {
    id: 'UNEARNED_REVENUE_RECOGNITION',
    title: 'Recognition of earned unearned revenue',
    patterns: [
      /\b(?:unearned\s+revenue|deferred\s+revenue|customer\s+advance|advance\s+(?:payment\s+)?from\s+(?:a\s+|the\s+)?customer)\b/i,
      /\b(?:earn(?:ed|s|ing)?|recogni[sz](?:e|ed|es|ing)|releas(?:e|ed|es|ing)|satisf(?:y|ied|ies|ying)|deliver(?:ed|s|ing)|perform(?:ed|s|ing)|complet(?:e|ed|es|ing)|render(?:ed|s|ing))\b/i
    ],
    accounts: () => ({ debit: liability('Unearned Revenue', '2200'), credit: revenue() }),
    rationale: 'Derecognise the unearned revenue contract liability and recognize revenue in profit or loss as the performance obligation is satisfied under SFRS(I) 15.'
  },
  {
    id: 'UNEARNED_REVENUE_RECEIPT',
    title: 'Customer advance received (unearned revenue)',
    patterns: [
      /\b(?:received?|receives|receiving|receipt|collected|collect|paid|pays|pay|deposited)\b/i,
      /\b(?:customer|client|unearned\s+revenue|deferred\s+revenue|contract\s+liability)\b/i,
      /\b(?:in\s+advance|upfront|advance\s+(?:payment|receipt|deposit|fee|billing)|customer\s+(?:advance|deposit)|unearned\s+revenue|deferred\s+revenue|before\s+(?:delivery|delivering|performing|providing|completing)|to\s+be\s+(?:delivered|performed|provided|rendered)\b|not\s+yet\s+(?:delivered|performed|earned))\b/i
    ],
    accounts: q => ({
      debit: /\b(?:in\s+cash|cash\s+in\s+hand|physical\s+cash|received\s+cash)\b/i.test(q) ? cash() : bank(),
      credit: liability('Unearned Revenue', '2200')
    }),
    rationale: 'Consideration received from a customer before transferring promised goods or services is recognized as a contract liability (unearned revenue) under SFRS(I) 15, not immediate revenue.'
  },
  {
    id: 'BAD_DEBT_WRITE_OFF',
    title: 'Write-off of uncollectible trade receivable',
    patterns: [
      /\b(?:writ(?:e|ten|ing)\s+off|write-off)\b/i,
      /\b(?:bad\s+debts?|doubtful\s+debts?|uncollectible|irrecoverable|bankrupt\s+customer|customer\s+(?:receivable|invoice|balance|debt)|trade\s+receivables?|accounts?\s+receivable)\b/i
    ],
    accounts: q => {
      const againstAllowance = /\b(?:against|using|from)\s+(?:the\s+|an?\s+|existing\s+)?(?:allowance|provision|loss\s+allowance)\b/i.test(q);
      const directWriteOff = /\b(?:direct(?:ly)?(?:\s+to\s+(?:bad\s+debt\s+)?expense|\s+write[- ]?off)?|to\s+bad\s+debt\s+expense|no\s+(?:prior\s+|existing\s+)?allowance)\b/i.test(q);
      if (againstAllowance && !directWriteOff) {
        return { debit: asset('Allowance for Doubtful Debts', '1105'), credit: receivable() };
      }
      if (directWriteOff && !againstAllowance) {
        return { debit: expense('Bad Debt Expense', '5510'), credit: receivable() };
      }
      return {
        missing: [need('writeOffMethod', 'Write-off method', 'Is the uncollectible receivable being written off against an existing allowance for doubtful debts, or directly to bad debt expense?')]
      };
    },
    rationale: 'Derecognise the uncollectible trade receivable against the existing allowance for doubtful debts (or directly to bad debt expense when no allowance exists).'
  },
  {
    id: 'BAD_DEBT_ALLOWANCE',
    title: 'Expected credit loss / allowance for doubtful debts',
    patterns: [
      /\b(?:allowance\s+for\s+(?:doubtful|bad)\s+(?:debts?|accounts?|receivables?)|provision\s+for\s+(?:doubtful|bad)\s+(?:debts?|accounts?|receivables?)|expected\s+credit\s+loss(?:es)?|loss\s+allowance|impairment\s+loss\s+on\s+(?:trade\s+)?receivables?)\b/i,
      /\b(?:record|recogni[sz](?:e|ed|ing)|create|establish|book|post|increase|adjust|estimate[ds]?|journal|double\s+entry|debit|credit)\b/i
    ],
    accounts: () => ({ debit: expense('Impairment Loss on Trade Receivables', '5500'), credit: asset('Allowance for Doubtful Debts', '1105') }),
    rationale: 'Recognise expected credit loss (impairment loss) in profit or loss and credit the contra-asset allowance for doubtful debts against trade receivables under SFRS(I) 9.'
  },
  {
    id: 'SALES_RETURN',
    title: 'Sales return / customer credit note',
    patterns: [
      /\b(?:sales?\s+returns?|return(?:ed|s)?\s+(?:of\s+)?(?:(?:defective|damaged|faulty|unwanted)\s+)?(?:goods|products|merchandise|inventory|items)?(?:\s+of\s+(?:\bSGD\s*|S\$\s*|\$\s*)[\d,.]*)?\s*(?:by|from)\s+(?:a\s+|the\s+|our\s+)?(?:customer|client)|(?:customer|client)\s+returned\s+(?:(?:defective|damaged|faulty|unwanted)\s+)?(?:goods|products|merchandise|inventory|items)|(?:issued?|grant(?:ed)?)\s+(?:a\s+)?credit\s+note\s+to\s+(?:a\s+|the\s+|our\s+)?(?:customer|client))\b/i
    ],
    accounts: q => ({
      debit: { name: 'Sales Returns and Allowances', code: '4050', category: 'REVENUE' as AccountCategory },
      credit: /\b(?:cash\s+refund|refund(?:ed)?\s+in\s+cash|paid\s+in\s+cash)\b/i.test(q)
        ? cash()
        : /\b(?:bank\s+transfer|refund(?:ed)?\s+(?:by|via|from)\s+(?:the\s+|our\s+)?bank)\b/i.test(q)
          ? bank()
          : receivable()
    }),
    rationale: 'Record the sales return or customer credit note as a contra-revenue reduction and reduce Trade Receivables (or record cash/bank refund).'
  },
  {
    id: 'PURCHASE_RETURN',
    title: 'Purchase return to supplier',
    patterns: [
      /\b(?:purchase\s+returns?|return(?:ed|s)?\s+(?:(?:defective|damaged|faulty|unwanted)\s+)?(?:goods|products|merchandise|inventory|items|office\s+supplies|supplies|stationery)(?:\s+of\s+(?:\bSGD\s*|S\$\s*|\$\s*)[\d,.]*)?\s+(?:to|back\s+to)\s+(?:a\s+|the\s+|our\s+)?(?:supplier|vendor)|received?\s+(?:a\s+)?credit\s+note\s+from\s+(?:a\s+|the\s+|our\s+)?(?:supplier|vendor))\b/i
    ],
    accounts: q => ({
      debit: liability('Trade Payables', '2000'),
      credit: /\b(?:office\s+supplies|stationery)\b/i.test(q)
        ? expense('Office Supplies Expense', '5300')
        : asset('Inventory', '1200')
    }),
    rationale: 'Returning goods or supplies to a supplier on credit reduces Trade Payables and derecognises the returned Inventory or expense.'
  },
  {
    id: 'SUPPLIER_PAYMENT',
    title: 'Settlement of supplier payable',
    patterns: [
      /\b(?:pay|paid|pays|paying|settle|settled|settles|settling|settlement|remit|remitted)\b/i,
      /\b(?:supplier|vendor|creditor|trade\s+payables?|accounts?\s+payable)\b/i,
      /\b(?:invoice|payable|payables|balance|owed|owing|account|bill)\b/i
    ],
    accounts: q => {
      if (/\b(?:discount|rebate|less\s+\d+%)\b/i.test(q)) {
        const discountSplit = extractSupplierPaymentDiscountAmounts(q);
        if (!discountSplit) {
          return {
            missing: [need('discountBreakdown', 'Discount and gross payable amounts', 'What is the gross payable amount being settled and the discount received?')]
          };
        }
      }
      return {
        debit: liability('Trade Payables', '2000'),
        credit: /\b(?:in\s+cash|with\s+cash|by\s+cash|physical\s+cash|cash\s+payment)\b/i.test(q) ? cash() : bank()
      };
    },
    rationale: 'Settlement of an existing supplier payable reduces Trade Payables and Cash or Cash at Bank.'
  },
  {
    id: 'PROVISION_RECOGNITION',
    title: 'Provision recognition (SFRS(I) 1-37)',
    patterns: [
      /\b(?:warranty\s+provision|provision\s+for\s+(?:warrant(?:y|ies)|legal\s+(?:claims?|disputes?|proceedings?|litigation|settlements?)|restructuring|reinstatement|dilapidations?|decommissioning)|recogni[sz](?:e|ed|ing)\s+(?:a\s+)?provision\s+for)\b/i,
      /\b(?:record|recogni[sz](?:e|ed|ing)|book|post|create|make|prepare|journal|double\s+entry|debit|credit|SGD|S\$|\$)\b/i
    ],
    accounts: q => {
      if (/\b(?:not\s+probable|possible\s+obligation|contingent\s+liability|remote)\b/i.test(q)) {
        return {
          missing: [need('probableOutflow', 'Probable outflow requirement (SFRS(I) 1-37)', 'Under SFRS(I) 1-37, a provision is recognised only when a present obligation makes an outflow of resources probable. Is an outflow of economic benefits probable, or is this a contingent liability for disclosure only?')]
        };
      }
      if (/\bwarrant(?:y|ies)\b/i.test(q)) {
        return { debit: expense('Warranty Expense', '5600'), credit: liability('Provision for Warranties', '2300') };
      }
      if (/\b(?:legal|litigation|lawsuit|claim|dispute)\b/i.test(q)) {
        return { debit: expense('Legal Claims Expense', '5610'), credit: liability('Provision for Legal Claims', '2310') };
      }
      if (/\brestructuring\b/i.test(q)) {
        return { debit: expense('Restructuring Expense', '5620'), credit: liability('Provision for Restructuring', '2320') };
      }
      return { debit: expense('Provision Expense', '5600'), credit: liability('Provisions', '2300') };
    },
    rationale: 'Under SFRS(I) 1-37 §14, recognise a provision when the entity has a present obligation from a past event, a probable outflow of economic benefits, and a reliable estimate of the obligation.'
  },
  {
    id: 'ACCRUED_EXPENSE_RECOGNITION',
    title: 'Accrued expense recognition',
    patterns: [
      /\b(?:accrue[ds]?|accrual|incurred\s+but\s+(?:not\s+yet\s+(?:paid|billed)|unpaid|unbilled)|unpaid\s+at\s+(?:month|quarter|year|period)[- ]end)\b/i,
      /\b(?:rent|office\s+supplies|stationery|utilities|utility|electricity|water\s+bill|audit\s+fees?|professional\s+fees?|interest|operating\s+expenses?|expenses?)\b/i
    ],
    accounts: q => {
      const kind = /\boffice supplies\b|\bstationery\b/i.test(q) ? 'Office Supplies Expense'
        : /\b(?:rent|rental)\b/i.test(q) ? 'Rent Expense'
        : /\b(?:utilities|utility|electricity|water bill)\b/i.test(q) ? 'Utilities Expense'
        : /\baudit fees?\b/i.test(q) ? 'Audit Fees Expense'
        : /\bprofessional fees?\b/i.test(q) ? 'Professional Fees Expense'
        : /\binterest\b/i.test(q) ? 'Interest Expense'
        : 'Operating Expense';
      return { debit: expense(kind), credit: liability('Accrued Expenses', '2100') };
    },
    rationale: 'Under the accrual basis of accounting (SFRS(I) 1-1), expenses are recognized in profit or loss when incurred together with an accrued expense liability before cash settlement.'
  },
  {
    id: 'CUSTOMER_RECEIPT', title: 'Receipt of outstanding customer invoice',
    patterns: [/\b(?:receipt|received|receives|receiving|receive|collect|collected|settle|settled|settles|settling|settlement|settlements|paid)\b/i, /\b(?:customer|client)\b/i, /\b(?:invoice|receivable|outstanding)\b/i],
    accounts: q => {
      if (/\b(?:discount|rebate|less\s+\d+%)\b/i.test(q)) {
        const discountSplit = extractCustomerReceiptDiscountAmounts(q);
        if (!discountSplit) {
          return {
            missing: [need('discountBreakdown', 'Discount and gross invoice amounts', 'What is the gross receivable amount being settled and the discount allowed?')]
          };
        }
      }
      return { debit: /\b(?:in cash|cash in hand)\b/i.test(q) ? cash() : bank(), credit: receivable() };
    },
    rationale: 'Settlement of an existing receivable is not a second sale or second revenue recognition.'
  },
  {
    id: 'BANK_TRANSFER', title: 'Bank-to-bank transfer',
    patterns: [/\b(?:transfer|transferred|moving|move|moved)\b/i, /\b(?:bank|account)\b/i],
    accounts: bankTransfer,
    rationale: 'Internal transfer between bank asset accounts; no profit-or-loss impact and no GST.'
  },
  {
    id: 'CREDIT_SALE', title: 'Credit sale',
    patterns: [/\b(?:sold|sell|sells|selling|sale|sales)\b/i, /\b(?:goods|products|services|merchandise|inventory)\b/i, /\b(?:on\s+(?:(?:\d+\s*[-–]?\s*days?\s+)?credit|account)|\d+\s*[-–]?\s*days?\s+(?:credit|payment\s+terms?)|credit\s+(?:sale|terms?|period))\b/i],
    accounts: () => ({ debit: receivable(), credit: revenue() }),
    rationale: 'Recognise the customer receivable and revenue when control passes to the customer (subject to SFRS(I) 15). If inventory is delivered, also debit Cost of Goods Sold and credit Inventory at its carrying cost; that separate cost entry cannot be calculated unless the carrying cost is stated. Assumes the stated sales amount excludes any GST not specified.'
  },
  {
    id: 'CASH_SALE', title: 'Cash sale',
    patterns: [/\b(?:sold|sell|sells|selling|sale|sales)\b/i, /\b(?:goods|products|services|merchandise|inventory)\b/i, /\b(?:cash sale|for cash|cash payment|paid in cash|received cash)\b/i],
    accounts: () => ({ debit: bank(), credit: revenue() }),
    rationale: 'Immediate cash sale (assumed deposited to bank); confirm whether the proceeds instead remain as cash on hand.'
  },
  {
    id: 'LOAN_REPAYMENT', title: 'Bank loan principal repayment',
    patterns: [
      /\b(?:repay|repaid|repayment|paid)\b/i,
      /\b(?:bank loan|loan principal|principal of (?:the |a )?loan)\b/i
    ],
    accounts: query => {
      if (/\binterest\b/i.test(query)) {
        const split = extractLoanRepaymentAmounts(query);
        if (!split) {
          return {
            missing: [need('interestSplit', 'Principal and interest breakdown', 'How much of the repayment is loan principal and how much is interest expense?')]
          };
        }
      }
      return { debit: loan(), credit: bank() };
    },
    rationale: 'Principal repayment decreases the loan liability; interest is recognized as interest expense.'
  },
  {
    id: 'LOAN_DRAWDOWN', title: 'Bank loan drawdown',
    patterns: [/\b(?:loan|borrow|borrowed|drawdown|drawn down)\b/i, /\b(?:from (?:the |a )?bank|bank loan|borrowed from bank|loan received)\b/i],
    accounts: () => ({ debit: bank(), credit: loan() }),
    rationale: 'Loan proceeds increase bank assets and create a loan liability; this is not revenue.'
  },
  {
    id: 'OFFICE_EQUIPMENT_PURCHASE', title: 'Office equipment purchase',
    patterns: officeEquipmentPurchasePatterns,
    accounts: query => ({
      debit: asset('Office Equipment', '1500'),
      credit: officeEquipmentCashPayment.test(query) ? cash() : bank()
    }),
    rationale: 'Recognise office equipment at its purchase cost and credit the cash or bank account used for the full immediate payment; the query states that no GST applies.'
  },
  {
    id: 'EXPENSE_PAYMENT', title: 'Operating expense payment',
    patterns: [
      /\b(?:pay|paid|prepaid|purchase|purchased|bought|payment|record)\b/i,
      /\b(?:rent|office supplies|stationery|utilities|utility|electricity|water bill)\b|\b(?:refundable|security|rental)\s+deposit\b|\b(?:prepaid\s+(?:rent|insurance|expenses?)|(?:rent|insurance|expenses?)\s+in\s+advance)\b/i
    ],
    accounts: expenseAccounts,
    rationale: 'Recognise the transaction and the corresponding payment or payable liability.'
  },
  {
    id: 'SOLE_PROPRIETOR_CAPITAL', title: 'Sole proprietor capital introduced',
    patterns: [/\bsole propriet(?:or|orship)\b/i, /\b(?:capital introduced|introduced capital|owner contribution|owner invested)\b/i],
    accounts: () => ({ debit: bank(), credit: equity("Owner's Capital") }),
    rationale: 'An introduction of capital by a sole proprietor increases cash and owner equity.'
  },
  {
    id: 'SOLE_PROPRIETOR_DRAWINGS', title: 'Sole proprietor drawings',
    patterns: [/\bsole propriet(?:or|orship)\b/i, /\b(?:drawings|owner withdrawal|owner withdrew|personal withdrawal)\b/i],
    accounts: () => ({ debit: equity("Owner's Drawings"), credit: bank() }),
    rationale: 'Sole proprietor drawings are an equity withdrawal, not a business expense.'
  }
];

/**
 * Call before generic expense and lease routing. A missing fact is a pending
 * scenario, never a zero-amount or invented entry.
 */
export function matchBasicTransaction(query: string): AccountingScenarioState | undefined {
  // Never override the specialized GST, salary, lease, investment or FX routes.
  // The narrow equipment template is admitted only when the query explicitly
  // rules out GST and states a single immediate payment source.
  const existingSpecializedRouteContext = /\b(?:GST|CPF|payroll|salar(?:y|ies)|share(?:s|holder)?|FVTPL|FVOCI|forex|foreign exchange|FX|lease|tenancy)\b/i.test(query);
  const additionalEquipmentSpecializedContext = officeEquipmentPurchaseCandidate(query) &&
    officeEquipmentSpecializedContext.test(query.replace(officeEquipmentNoGstStatement, ' '));
  if ((existingSpecializedRouteContext && !isSimpleOfficeEquipmentPurchase(query)) ||
      (additionalEquipmentSpecializedContext && !isSimpleOfficeEquipmentPurchase(query)) ||
      /\brental agreement\b/i.test(query) ||
      /\b(?:USD|EUR|GBP|AUD|MYR|JPY|CNY)\b/i.test(query) ||
      /\btransaction\s*[12]\b/i.test(query) ||
      /\b(?:bond|non[- ]?poci|poci|significant\s+increase\s+in\s+credit\s+risk|sppi|12-month\s+or\s+lifetime)\b/i.test(query)) return undefined;

  // Customer invoice settlements take priority over a generic "bank transfer".
  // A third-party payment is not a transfer between the entity's own accounts.
  const externalParty = /\b(?:customer|client|supplier|vendor|third.party)\b/i.test(query);
  const customerReceiptAllowed = customerReceiptDirection(query) && !customerPaymentOutflow(query);
  const template = personalOwnerWithdrawal(query) ? ownerDrawingsTemplate :
    templates.find(item => (!externalParty || item.id !== 'BANK_TRANSFER') &&
      (item.id !== 'CUSTOMER_RECEIPT' || customerReceiptAllowed) &&
      (item.id !== 'BANK_TRANSFER' || isBankTransfer(query)) &&
      (item.id !== 'UNEARNED_REVENUE_RECOGNITION' || isUnearnedRecognition(query)) &&
      (item.id !== 'UNEARNED_REVENUE_RECEIPT' || (customerReceiptAllowed && !isUnearnedRecognition(query))) &&
      (item.id !== 'BAD_DEBT_ALLOWANCE' || !/\b(?:writ(?:e|ten|ing)\s+off|write-off)\b/i.test(query)) &&
      (item.id !== 'SUPPLIER_PAYMENT' || (!isSimpleOfficeEquipmentPurchase(query) &&
        !/\b(?:bought|purchased|purchase\s+of|acquired|incurred|return(?:ed|s)?|credit\s+note)\b/i.test(query))) &&
      (item.id !== 'PROVISION_RECOGNITION' || (!/\b(?:doubtful|bad\s+debt|receivables?|ecl|income\s+tax|corporate\s+tax|deferred\s+tax|mom|employment\s+act|overtime)\b/i.test(query) && !(/^should\s+we\b/i.test(query.trim()) && getAllAmounts(query).length === 0 && !/\b(?:journal|double\s+entry|debit|credit)\b/i.test(query)))) &&
      (item.id !== 'ACCRUED_EXPENSE_RECOGNITION' || isExpenseAccrualRecognition(query)) &&
      item.patterns.every(pattern => pattern.test(query)));
  if (!template) return undefined;

  const allAmounts = getAllAmounts(query);
  const pair = template.accounts(query);

  // Check for specialized multi-amount patterns:
  // 1. Loan repayment with principal and interest
  const isLoanWithInterest = template.id === 'LOAN_REPAYMENT' && /\binterest\b/i.test(query);
  const loanSplit = isLoanWithInterest ? extractLoanRepaymentAmounts(query) : undefined;

  // 2. Sale with explicit inventory carrying cost
  const isSale = template.id === 'CREDIT_SALE' || template.id === 'CASH_SALE';
  const saleAndCost = isSale ? extractSaleAndCostAmounts(query) : undefined;

  // 3. Customer receipt with explicit settlement discount
  const isCustomerDiscount = template.id === 'CUSTOMER_RECEIPT' && /\b(?:discount|rebate|less\s+\d+%)\b/i.test(query);
  const discountSplit = isCustomerDiscount ? extractCustomerReceiptDiscountAmounts(query) : undefined;

  // 4. Sales return with inventory cost restoration
  const isSalesReturn = template.id === 'SALES_RETURN';
  const salesReturnAndCost = isSalesReturn ? extractSaleAndCostAmounts(query) : undefined;

  // 5. Supplier payment with settlement discount
  const isSupplierDiscount = template.id === 'SUPPLIER_PAYMENT' && /\b(?:discount|rebate|less\s+\d+%)\b/i.test(query);
  const supplierDiscountSplit = isSupplierDiscount ? extractSupplierPaymentDiscountAmounts(query) : undefined;

  const missingFields: MissingFieldInfo[] = [];

  if (allAmounts.length === 0) {
    missingFields.push(need('amount', 'Transaction amount', 'What is the transaction amount in SGD?'));
  } else if (
    allAmounts.length > 1 &&
    !loanSplit &&
    !saleAndCost &&
    !discountSplit &&
    !isCustomerDiscount &&
    !salesReturnAndCost &&
    !supplierDiscountSplit &&
    !isSupplierDiscount
  ) {
    missingFields.push(need('amount', 'Transaction amount', 'Multiple SGD amounts were stated; please clarify which amount applies to each part of the transaction.'));
  }

  if (pair.missing) {
    missingFields.push(...pair.missing);
  }

  const isComplete = missingFields.length === 0 && (
    Boolean(loanSplit) ||
    Boolean(saleAndCost && pair.debit && pair.credit) ||
    Boolean(discountSplit && pair.debit && pair.credit) ||
    Boolean(salesReturnAndCost && pair.debit && pair.credit) ||
    Boolean(supplierDiscountSplit && pair.debit && pair.credit) ||
    (allAmounts.length === 1 && Boolean(pair.debit && pair.credit))
  );

  const explicitEquipmentDate = template.id === 'OFFICE_EQUIPMENT_PURCHASE'
    ? query.match(officeEquipmentExplicitDate)?.[1]
    : undefined;
  if (explicitEquipmentDate && !isCalendarDateToken(explicitEquipmentDate)) return undefined;
  const eventDate = explicitEquipmentDate
    ? formatSingaporeDate(explicitEquipmentDate)
    : formatSingaporeDate(new Date());

  // Branch A: Loan repayment with explicit principal and interest breakdown
  if (loanSplit) {
    const pAmount = Number(loanSplit.principalCents) / 100;
    const iAmount = Number(loanSplit.interestCents) / 100;
    const totalCents = loanSplit.principalCents + loanSplit.interestCents;
    const totalAmount = Number(totalCents) / 100;
    const rationale = 'Principal repayment decreases loan liability; interest is recognized as interest expense.';

    const lines: JournalLine[] = isComplete ? [
      {
        id: 'basic-loan-principal',
        accountCode: '2100',
        accountName: 'Bank Loan',
        category: 'LIABILITY',
        debit: pAmount,
        credit: 0,
        lineExplanation: 'Principal repayment of bank loan.'
      },
      {
        id: 'basic-loan-interest',
        accountCode: '5400',
        accountName: 'Interest Expense',
        category: 'EXPENSE',
        debit: iAmount,
        credit: 0,
        lineExplanation: 'Interest expense incurred on loan.'
      },
      {
        id: 'basic-loan-bank',
        accountCode: '1010',
        accountName: 'Cash at Bank',
        category: 'ASSET',
        debit: 0,
        credit: totalAmount,
        lineExplanation: 'Settlement of principal and interest from bank account.'
      }
    ] : [];

    return {
      scenarioType: 'BASIC_BOOKKEEPING',
      authorityStatus: isComplete ? 'DETERMINISTIC' : 'CONDITIONAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      rawQuery: query,
      transactionTitle: 'Bank loan principal and interest repayment',
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      amount: totalAmount,
      accountingTreatmentSummary: rationale,
      directGroups: isComplete ? [{
        id: 'basic-loan_repayment',
        eventDate,
        title: 'Bank loan principal and interest repayment',
        summary: 'Bank loan principal and interest repayment — SGD ' + totalAmount.toFixed(2),
        lines,
        totalDebit: totalAmount,
        totalCredit: totalAmount,
        isBalanced: true,
        citations: [],
        rationalePoints: [rationale],
        authorityStatus: 'DETERMINISTIC'
      }] : [],
      isComplete,
      missingFields
    };
  }

  // Branch B: Credit sale or cash sale with explicit inventory carrying cost
  if (saleAndCost) {
    const saleAmount = Number(saleAndCost.saleCents) / 100;
    const costAmount = Number(saleAndCost.costCents) / 100;
    const rationale = template.rationale + ' No GST has been recorded because GST registration and tax treatment were not established; assess GST separately if applicable.';

    const directGroups: JournalEntryGroup[] = isComplete ? [
      {
        id: 'basic-' + template.id.toLowerCase(),
        eventDate,
        title: template.title,
        summary: template.title + ' — SGD ' + saleAmount.toFixed(2),
        lines: [
          {
            id: 'basic-sale-debit',
            accountCode: pair.debit!.code,
            accountName: pair.debit!.name,
            category: pair.debit!.category,
            debit: saleAmount,
            credit: 0,
            lineExplanation: rationale
          },
          {
            id: 'basic-sale-credit',
            accountCode: pair.credit!.code,
            accountName: pair.credit!.name,
            category: pair.credit!.category,
            debit: 0,
            credit: saleAmount,
            lineExplanation: rationale
          }
        ],
        totalDebit: saleAmount,
        totalCredit: saleAmount,
        isBalanced: true,
        citations: [],
        rationalePoints: [rationale],
        authorityStatus: 'DETERMINISTIC'
      },
      {
        id: 'basic-' + template.id.toLowerCase() + '-cost',
        eventDate,
        title: 'Cost of goods sold',
        summary: 'Cost of goods sold — SGD ' + costAmount.toFixed(2),
        lines: [
          {
            id: 'basic-cost-debit',
            accountCode: '5000',
            accountName: 'Cost of Goods Sold',
            category: 'EXPENSE',
            debit: costAmount,
            credit: 0,
            lineExplanation: 'Derecognition of inventory carrying cost sold to customer.'
          },
          {
            id: 'basic-cost-credit',
            accountCode: '1200',
            accountName: 'Inventory',
            category: 'ASSET',
            debit: 0,
            credit: costAmount,
            lineExplanation: 'Reduction in inventory asset balance.'
          }
        ],
        totalDebit: costAmount,
        totalCredit: costAmount,
        isBalanced: true,
        citations: [],
        rationalePoints: ['Derecognise inventory at carrying cost and recognize cost of goods sold.'],
        authorityStatus: 'DETERMINISTIC'
      }
    ] : [];

    return {
      scenarioType: 'BASIC_BOOKKEEPING',
      authorityStatus: isComplete ? 'DETERMINISTIC' : 'CONDITIONAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      rawQuery: query,
      transactionTitle: template.title,
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      amount: saleAmount,
      accountingTreatmentSummary: rationale,
      directGroups,
      isComplete,
      missingFields
    };
  }

  // Branch C: Customer receipt with settlement discount
  if (discountSplit) {
    const netAmount = Number(discountSplit.netCents) / 100;
    const discountAmount = Number(discountSplit.discountCents) / 100;
    const grossAmount = Number(discountSplit.grossCents) / 100;
    const rationale = template.rationale + ' Settlement discount allowed on early/agreed invoice settlement is recognized as an expense; derecognise the gross trade receivable settled.';

    const lines: JournalLine[] = isComplete && pair.debit && pair.credit ? [
      {
        id: 'basic-receipt-cash',
        accountCode: pair.debit.code,
        accountName: pair.debit.name,
        category: pair.debit.category,
        debit: netAmount,
        credit: 0,
        lineExplanation: 'Net cash received from customer after settlement discount.'
      },
      {
        id: 'basic-receipt-discount',
        accountCode: '4100',
        accountName: 'Discount Allowed',
        category: 'EXPENSE',
        debit: discountAmount,
        credit: 0,
        lineExplanation: 'Settlement discount allowed on early/agreed invoice settlement.'
      },
      {
        id: 'basic-receipt-receivable',
        accountCode: '1100',
        accountName: 'Trade Receivables',
        category: 'ASSET',
        debit: 0,
        credit: grossAmount,
        lineExplanation: 'Derecognition of gross customer trade receivable settled.'
      }
    ] : [];

    return {
      scenarioType: 'BASIC_BOOKKEEPING',
      authorityStatus: isComplete ? 'DETERMINISTIC' : 'CONDITIONAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      rawQuery: query,
      transactionTitle: template.title,
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      amount: grossAmount,
      accountingTreatmentSummary: rationale,
      directGroups: isComplete ? [{
        id: 'basic-' + template.id.toLowerCase(),
        eventDate,
        title: template.title,
        summary: template.title + ' — SGD ' + grossAmount.toFixed(2),
        lines,
        totalDebit: grossAmount,
        totalCredit: grossAmount,
        isBalanced: true,
        citations: [],
        rationalePoints: [rationale],
        authorityStatus: 'DETERMINISTIC'
      }] : [],
      isComplete,
      missingFields
    };
  }

  // Branch: Sales return with explicit inventory cost restoration
  if (salesReturnAndCost) {
    const saleAmount = Number(salesReturnAndCost.saleCents) / 100;
    const costAmount = Number(salesReturnAndCost.costCents) / 100;
    const rationale = template.rationale + ' Record sales return contra-revenue and reduce receivable/cash; restore returned inventory at cost and reverse cost of goods sold.';

    const directGroups: JournalEntryGroup[] = isComplete && pair.debit && pair.credit ? [
      {
        id: 'basic-sales_return',
        eventDate,
        title: template.title,
        summary: template.title + ' — SGD ' + saleAmount.toFixed(2),
        lines: [
          {
            id: 'basic-return-revenue',
            accountCode: pair.debit.code,
            accountName: pair.debit.name,
            category: pair.debit.category,
            debit: saleAmount,
            credit: 0,
            lineExplanation: 'Sales return / contra-revenue reduction.'
          },
          {
            id: 'basic-return-credit',
            accountCode: pair.credit.code,
            accountName: pair.credit.name,
            category: pair.credit.category,
            debit: 0,
            credit: saleAmount,
            lineExplanation: 'Reduction in trade receivables (or cash refund).'
          }
        ],
        totalDebit: saleAmount,
        totalCredit: saleAmount,
        isBalanced: true,
        citations: [],
        rationalePoints: [rationale],
        authorityStatus: 'DETERMINISTIC'
      },
      {
        id: 'basic-sales_return-cost',
        eventDate,
        title: 'Inventory return restoration',
        summary: 'Inventory return restoration — SGD ' + costAmount.toFixed(2),
        lines: [
          {
            id: 'basic-return-inventory',
            accountCode: '1200',
            accountName: 'Inventory',
            category: 'ASSET',
            debit: costAmount,
            credit: 0,
            lineExplanation: 'Restoration of returned inventory asset at carrying cost.'
          },
          {
            id: 'basic-return-cogs',
            accountCode: '5000',
            accountName: 'Cost of Goods Sold',
            category: 'EXPENSE',
            debit: 0,
            credit: costAmount,
            lineExplanation: 'Reversal of cost of goods sold on returned goods.'
          }
        ],
        totalDebit: costAmount,
        totalCredit: costAmount,
        isBalanced: true,
        citations: [],
        rationalePoints: ['Restore returned inventory to asset at cost and reverse cost of goods sold.'],
        authorityStatus: 'DETERMINISTIC'
      }
    ] : [];

    return {
      scenarioType: 'BASIC_BOOKKEEPING',
      authorityStatus: isComplete ? 'DETERMINISTIC' : 'CONDITIONAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      rawQuery: query,
      transactionTitle: template.title,
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      amount: saleAmount,
      accountingTreatmentSummary: rationale,
      directGroups,
      isComplete,
      missingFields
    };
  }

  // Branch: Supplier payment with settlement discount
  if (supplierDiscountSplit) {
    const netAmount = Number(supplierDiscountSplit.netCents) / 100;
    const discountAmount = Number(supplierDiscountSplit.discountCents) / 100;
    const grossAmount = Number(supplierDiscountSplit.grossCents) / 100;
    const rationale = template.rationale + ' Settlement discount received on prompt payment reduces the payable liability and is recognized as discount received revenue / income.';

    const lines: JournalLine[] = isComplete && pair.debit && pair.credit ? [
      {
        id: 'basic-supplier-payable',
        accountCode: pair.debit.code,
        accountName: pair.debit.name,
        category: pair.debit.category,
        debit: grossAmount,
        credit: 0,
        lineExplanation: 'Derecognition of gross supplier trade payable settled.'
      },
      {
        id: 'basic-supplier-cash',
        accountCode: pair.credit.code,
        accountName: pair.credit.name,
        category: pair.credit.category,
        debit: 0,
        credit: netAmount,
        lineExplanation: 'Net payment to supplier from bank/cash account.'
      },
      {
        id: 'basic-supplier-discount',
        accountCode: '4150',
        accountName: 'Discount Received',
        category: 'REVENUE',
        debit: 0,
        credit: discountAmount,
        lineExplanation: 'Settlement discount received on prompt payment of invoice.'
      }
    ] : [];

    return {
      scenarioType: 'BASIC_BOOKKEEPING',
      authorityStatus: isComplete ? 'DETERMINISTIC' : 'CONDITIONAL',
      queryIntent: 'TRANSACTION',
      primaryDomain: 'ACCOUNTING_SFRS',
      rawQuery: query,
      transactionTitle: template.title,
      functionalCurrency: 'SGD',
      transactionCurrency: 'SGD',
      amount: grossAmount,
      accountingTreatmentSummary: rationale,
      directGroups: isComplete ? [{
        id: 'basic-' + template.id.toLowerCase(),
        eventDate,
        title: template.title,
        summary: template.title + ' — SGD ' + grossAmount.toFixed(2),
        lines,
        totalDebit: grossAmount,
        totalCredit: grossAmount,
        isBalanced: true,
        citations: [],
        rationalePoints: [rationale],
        authorityStatus: 'DETERMINISTIC'
      }] : [],
      isComplete,
      missingFields
    };
  }

  // Branch D: Standard single-amount transaction
  const cents = amountCents(query);
  const amount = cents ? Number(cents) / 100 : undefined;
  const rationale = template.id === 'OFFICE_EQUIPMENT_PURCHASE' || /\b(?:WITHDRAWAL|TRANSFER)\b/.test(template.id)
    ? template.rationale
    : template.rationale + ' No GST has been recorded because GST registration and tax treatment were not established; assess GST separately if applicable.';

  const lines: JournalLine[] = !isComplete || amount === undefined ? [] : [
    {
      id: 'basic-debit',
      accountCode: pair.debit!.code,
      accountName: pair.debit!.name,
      category: pair.debit!.category,
      debit: amount,
      credit: 0,
      lineExplanation: rationale
    },
    {
      id: 'basic-credit',
      accountCode: pair.credit!.code,
      accountName: pair.credit!.name,
      category: pair.credit!.category,
      debit: 0,
      credit: amount,
      lineExplanation: rationale
    }
  ];

  return {
    scenarioType: 'BASIC_BOOKKEEPING',
    authorityStatus: isComplete ? 'DETERMINISTIC' : 'CONDITIONAL',
    queryIntent: 'TRANSACTION',
    primaryDomain: 'ACCOUNTING_SFRS',
    rawQuery: query,
    transactionTitle: template.title,
    functionalCurrency: 'SGD',
    transactionCurrency: 'SGD',
    amount,
    accountingTreatmentSummary: rationale,
    directGroups: isComplete && amount !== undefined ? [{
      id: 'basic-' + template.id.toLowerCase(),
      eventDate,
      title: template.title,
      summary: template.title + ' — SGD ' + amount.toFixed(2),
      lines,
      totalDebit: amount,
      totalCredit: amount,
      isBalanced: true,
      citations: [],
      rationalePoints: [rationale],
      authorityStatus: 'DETERMINISTIC'
    }] : [],
    isComplete,
    missingFields
  };
}

/** Resolve only short, explicit answers to a pending owner-drawings or basic bookkeeping field. */
export function resolveBasicOwnerDrawingsFollowUp(
  query: string,
  currentScenario?: AccountingScenarioState | null
): AccountingScenarioState | undefined {
  if (currentScenario?.scenarioType !== 'BASIC_BOOKKEEPING' || !currentScenario.missingFields?.length) {
    return undefined;
  }

  const answer = query.trim().replace(/[.!?]+$/, '').trim();
  const missingKeys = new Set(currentScenario.missingFields.map(field => field.fieldKey));
  const original = currentScenario.rawQuery;

  // 1. Existing owner drawings follow-up logic
  if (personalOwnerWithdrawal(original) && (missingKeys.has('entityType') || missingKeys.has('paymentAccount'))) {
    const originalSoleProprietor = /\bsole propriet(?:or|orship)\b/i.test(original);
    const originalCompany = /\b(?:company|pte\.?\s*ltd\.?|limited)\b/i.test(original);
    let confirmedFact: string | undefined;

    const entityAnswer = answer.match(/^(?:(?:it|this|the business)\s+is\s+)?(?:a\s+)?(sole proprietorship|sole proprietor|company)$/i)?.[1];
    if (missingKeys.has('entityType') && entityAnswer) {
      const isSoleProprietor = /sole proprietor/i.test(entityAnswer);
      if ((isSoleProprietor && originalCompany) || (!isSoleProprietor && originalSoleProprietor)) {
        return { ...currentScenario, directGroups: [], isComplete: false };
      }
      confirmedFact = isSoleProprietor ? 'sole proprietorship' : 'company';
    } else if (missingKeys.has('paymentAccount')) {
      const cashAnswer = /^(?:(?:it was|taken|withdrawn|paid)\s+)?(?:(?:from|by|via|using|in)\s+)?(?:physical\s+)?(?:petty cash|cash on hand|cash)$/i.test(answer);
      const bankAnswer = /^(?:(?:it was|taken|withdrawn|paid)\s+)?(?:(?:from|by|via|using)\s+)?(?:(?:the|our)\s+)?(?:business\s+)?(?:bank(?:\s+account)?|current\s+account|savings\s+account)$/i.test(answer);
      if (cashAnswer) confirmedFact = 'physical cash';
      else if (bankAnswer) confirmedFact = 'business bank account';
    }

    if (!confirmedFact) return undefined;
    return matchBasicTransaction(`${original} ${confirmedFact}`) ?? {
      ...currentScenario,
      directGroups: [],
      isComplete: false
    };
  }

  // 2. Generic BASIC_BOOKKEEPING follow-ups
  const baseQuery = original.trim().replace(/[.!?]+$/, '');

  // writeOffMethod follow-up
  if (missingKeys.has('writeOffMethod')) {
    const isAgainstAllowance = /^(?:(?:written\s+off\s+)?(?:against|using|from)\s+)?(?:the\s+|an?\s+|existing\s+)?(?:allowance(?:\s+for\s+doubtful\s+debts)?|provision(?:\s+for\s+doubtful\s+debts)?|loss\s+allowance)$/i.test(answer);
    const isDirectWriteOff = /^(?:direct(?:ly)?(?:\s+to\s+(?:bad\s+debt\s+)?expense|\s+write[- ]?off)?|(?:to\s+)?bad\s+debt\s+expense|no\s+(?:prior\s+|existing\s+)?allowance)$/i.test(answer);
    if (isAgainstAllowance) {
      return matchBasicTransaction(`${baseQuery} against the allowance for doubtful debts`);
    }
    if (isDirectWriteOff) {
      return matchBasicTransaction(`${baseQuery} directly to bad debt expense`);
    }
  }

  // paymentMethod follow-up
  if (missingKeys.has('paymentMethod')) {
    const isCash = /^(?:(?:paid\s+)?in\s+cash|(?:with|by)\s+cash|cash)$/i.test(answer);
    const isBank = /^(?:(?:paid\s+)?(?:by|via|through)\s+(?:a\s+)?bank\s+transfer|bank\s+transfer|from\s+(?:the\s+|our\s+)?bank(?:\s+account)?|bank\s+account|from\s+bank)$/i.test(answer);
    const isCredit = /^(?:on\s+credit|on\s+account|credit)$/i.test(answer);

    let normalizedPhrase: string | undefined;
    if (isCash) normalizedPhrase = 'paid in cash';
    else if (isBank) normalizedPhrase = 'by bank transfer';
    else if (isCredit) normalizedPhrase = 'on credit';

    if (normalizedPhrase) {
      return matchBasicTransaction(`${baseQuery} ${normalizedPhrase}`);
    }
  }

  // amount follow-up
  if (missingKeys.has('amount')) {
    const amountMatch = answer.match(/^(?:SGD\s*|S\$\s*|\$\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?:\s*SGD)?$/i);
    if (amountMatch) {
      const digits = amountMatch[1] + (amountMatch[2] ? '.' + amountMatch[2] : '');
      return matchBasicTransaction(`${baseQuery} for SGD ${digits}`);
    }
  }

  return undefined;
}
